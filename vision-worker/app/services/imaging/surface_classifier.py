from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Final, Literal

import cv2
import numpy as np

SurfaceType = Literal[
    "BASE",
    "SILVER_HOLOFRACTOR",
    "GOLD_REFRACTOR",
    "CRACKED_ICE",
    "MOJO",
    "WAVE",
]

_PATCH_SIZE: Final[int] = 64
_MAX_ANALYSIS_DIMENSION: Final[int] = 384


@dataclass(frozen=True)
class SurfaceAnalysis:
    detected_surface_type: SurfaceType
    refractor_confidence: float
    rainbow_variance: float
    reflectivity_score: float
    texture_entropy: float
    high_reflectivity_patches: int
    classifier_mode: str = "opencv_single_frame_heuristic_v3_bounded"
    warnings: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["warnings"] = list(self.warnings)
        return payload


def _portrait(image: np.ndarray) -> np.ndarray:
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("Surface analysis requires a BGR color image.")
    if min(image.shape[:2]) < 96:
        raise ValueError("Image is too small for surface analysis.")
    return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE) if image.shape[1] > image.shape[0] else image


def _bounded_analysis_image(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    maximum = max(height, width)
    if maximum <= _MAX_ANALYSIS_DIMENSION:
        return image
    scale = _MAX_ANALYSIS_DIMENSION / float(maximum)
    return cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)


def _border_mask(height: int, width: int) -> np.ndarray:
    mask = np.ones((height, width), dtype=np.uint8)
    y1, y2 = int(height * 0.19), int(height * 0.81)
    x1, x2 = int(width * 0.19), int(width * 0.81)
    mask[y1:y2, x1:x2] = 0
    return mask


def _lbp(gray: np.ndarray) -> np.ndarray:
    center = gray[1:-1, 1:-1]
    neighbors = [
        gray[:-2, :-2], gray[:-2, 1:-1], gray[:-2, 2:], gray[1:-1, 2:],
        gray[2:, 2:], gray[2:, 1:-1], gray[2:, :-2], gray[1:-1, :-2],
    ]
    result = np.zeros_like(center, dtype=np.uint8)
    for bit, neighbor in enumerate(neighbors):
        result |= ((neighbor >= center).astype(np.uint8) << bit)
    return result


def _entropy(values: np.ndarray, bins: int = 256) -> float:
    if values.size == 0:
        return 0.0
    histogram = np.histogram(values, bins=bins, range=(0, bins), density=False)[0].astype(np.float64)
    probabilities = histogram / max(1.0, float(histogram.sum()))
    probabilities = probabilities[probabilities > 0]
    return float(-np.sum(probabilities * np.log2(probabilities)) / max(1.0, np.log2(bins)))


def _orientation_metrics(gray: np.ndarray, mask: np.ndarray) -> tuple[float, float, float]:
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    magnitude, angle = cv2.cartToPolar(gx, gy, angleInDegrees=True)
    selected = (mask > 0) & (magnitude >= np.percentile(magnitude[mask > 0], 72))
    if not np.any(selected):
        return 0.0, 0.0, 0.0
    angles = np.mod(angle[selected], 180.0)
    histogram = np.histogram(angles, bins=18, range=(0, 180), weights=magnitude[selected])[0].astype(np.float64)
    probability = histogram / max(1.0, histogram.sum())
    orientation_entropy = float(-np.sum(probability[probability > 0] * np.log2(probability[probability > 0])) / np.log2(18))
    coherence = float(np.max(probability))
    edge_density = float(np.mean(selected))
    return orientation_entropy, coherence, edge_density


def _spectral_periodicity(gray: np.ndarray, mask: np.ndarray) -> float:
    working = gray.astype(np.float32) * mask.astype(np.float32)
    working -= float(np.mean(working[mask > 0])) if np.any(mask > 0) else 0.0
    spectrum = np.abs(np.fft.fftshift(np.fft.fft2(working)))
    height, width = spectrum.shape
    cy, cx = height // 2, width // 2
    spectrum[max(0, cy - 4): cy + 5, max(0, cx - 4): cx + 5] = 0
    flat = spectrum.ravel()
    if flat.size < 10:
        return 0.0
    top = np.partition(flat, -10)[-10:]
    return float(np.clip(np.mean(top) / (np.mean(flat) + 1e-6) / 25.0, 0.0, 1.0))


def _extract_reflective_patches(image: np.ndarray, reflectivity: np.ndarray, mask: np.ndarray) -> list[np.ndarray]:
    height, width = mask.shape
    score = reflectivity.copy()
    score[mask == 0] = 0
    patches: list[np.ndarray] = []
    suppressed = np.zeros_like(mask, dtype=np.uint8)
    for _ in range(8):
        candidate = score.copy()
        candidate[suppressed > 0] = 0
        _, max_value, _, max_location = cv2.minMaxLoc(candidate)
        if max_value <= 0:
            break
        x, y = max_location
        half = _PATCH_SIZE // 2
        x1, x2 = max(0, x - half), min(width, x + half)
        y1, y2 = max(0, y - half), min(height, y + half)
        patch = image[y1:y2, x1:x2]
        if patch.size:
            patches.append(cv2.resize(patch, (_PATCH_SIZE, _PATCH_SIZE), interpolation=cv2.INTER_AREA))
        cv2.circle(suppressed, (x, y), _PATCH_SIZE, 1, -1)
    return patches


def analyze_surface(image: np.ndarray) -> SurfaceAnalysis:
    normalized = _bounded_analysis_image(_portrait(image))
    height, width = normalized.shape[:2]
    mask = _border_mask(height, width)
    hsv = cv2.cvtColor(normalized, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(normalized, cv2.COLOR_BGR2LAB)
    gray = cv2.cvtColor(normalized, cv2.COLOR_BGR2GRAY)

    hue = hsv[:, :, 0].astype(np.float32)
    saturation = hsv[:, :, 1].astype(np.float32)
    value = hsv[:, :, 2].astype(np.float32)
    luminance = lab[:, :, 0].astype(np.float32)
    chroma_a = lab[:, :, 1].astype(np.float32) - 128.0
    chroma_b = lab[:, :, 2].astype(np.float32) - 128.0

    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    gradient = cv2.magnitude(gx, gy)
    border_gradient = gradient[mask > 0]
    high_threshold = float(np.percentile(border_gradient, 72)) if border_gradient.size else 0.0
    high_frequency = (gradient >= high_threshold) & (mask > 0)

    hue_dx = np.abs(cv2.Sobel(hue, cv2.CV_32F, 1, 0, ksize=3))
    hue_dy = np.abs(cv2.Sobel(hue, cv2.CV_32F, 0, 1, ksize=3))
    hue_shift = cv2.magnitude(hue_dx, hue_dy)
    rainbow_variance = float(np.clip(np.std(hue_shift[high_frequency]) / 65.0, 0.0, 1.0)) if np.any(high_frequency) else 0.0

    reflectivity_map = np.clip((luminance - 150.0) / 105.0, 0.0, 1.0) * np.clip(gradient / 96.0, 0.0, 1.0)
    reflectivity_score = float(np.mean(reflectivity_map[mask > 0])) if np.any(mask > 0) else 0.0
    patches = _extract_reflective_patches(normalized, reflectivity_map, mask)

    lbp_values = _lbp(gray)
    lbp_mask = mask[1:-1, 1:-1] > 0
    texture_entropy = _entropy(lbp_values[lbp_mask]) if np.any(lbp_mask) else 0.0
    orientation_entropy, orientation_coherence, edge_density = _orientation_metrics(gray, mask)
    periodicity = _spectral_periodicity(gray, mask)

    border = mask > 0
    gold_fraction = float(np.mean(((hue >= 6) & (hue <= 30) & (saturation >= 55) & (value >= 115))[border]))
    silver_fraction = float(np.mean(((saturation <= 50) & (luminance >= 150))[border]))
    chroma_variance = float(np.clip((np.std(chroma_a[border]) + np.std(chroma_b[border])) / 75.0, 0.0, 1.0))

    scores: dict[SurfaceType, float] = {
        "BASE": float(np.clip(0.72 - 0.75 * rainbow_variance - 0.9 * reflectivity_score, 0.05, 0.85)),
        "SILVER_HOLOFRACTOR": float(np.clip(0.45 * silver_fraction + 0.36 * rainbow_variance + 0.30 * reflectivity_score, 0.0, 1.0)),
        "GOLD_REFRACTOR": float(np.clip(0.62 * gold_fraction + 0.30 * rainbow_variance + 0.24 * reflectivity_score, 0.0, 1.0)),
        "CRACKED_ICE": float(np.clip(0.42 * edge_density * 8.0 + 0.28 * orientation_entropy + 0.22 * reflectivity_score + 0.18 * texture_entropy, 0.0, 1.0)),
        "MOJO": float(np.clip(0.42 * periodicity + 0.25 * texture_entropy + 0.18 * reflectivity_score + 0.12 * chroma_variance, 0.0, 1.0)),
        "WAVE": float(np.clip(0.48 * orientation_coherence * 5.0 + 0.30 * periodicity + 0.18 * reflectivity_score + 0.12 * rainbow_variance, 0.0, 1.0)),
    }
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    detected, top_score = ranked[0]
    second_score = ranked[1][1]
    margin = max(0.0, top_score - second_score)

    # A single still image cannot prove a refractor finish. Require converging
    # specular, color-shift, and texture evidence before returning a non-base
    # family, and deliberately cap confidence below exact-variant thresholds.
    non_base_evidence = max(
        rainbow_variance,
        min(1.0, reflectivity_score * 7.0),
        min(1.0, periodicity),
        min(1.0, edge_density * 8.0),
    )
    weak_non_base = (
        detected != "BASE"
        and (
            top_score < 0.50
            or margin < 0.055
            or non_base_evidence < 0.32
            or (reflectivity_score < 0.028 and rainbow_variance < 0.20)
        )
    )
    if weak_non_base:
        detected = "BASE"
        top_score = scores["BASE"]
        margin = max(0.0, top_score - max(value for key, value in scores.items() if key != "BASE"))

    confidence = float(np.clip(0.24 + 0.40 * top_score + 0.22 * margin + 0.10 * non_base_evidence, 0.20, 0.74))
    warnings: list[str] = []
    if weak_non_base:
        warnings.append("Reflective evidence was not strong enough to assign a refractor family; BASE is a conservative fallback.")
    if confidence < 0.62:
        warnings.append("Surface classification is low-confidence; confirm the parallel from a second angle or catalog match.")
    if reflectivity_score < 0.025 and detected != "BASE":
        warnings.append("The image contains limited specular evidence; the detected refractor family may be incorrect.")
        confidence = min(confidence, 0.50)
    if len(patches) < 2:
        warnings.append("Few high-reflectivity micro-patches were available for texture analysis.")
    if detected != "BASE":
        warnings.append("A single photograph can only suggest a surface family; do not treat this result as an exact parallel confirmation.")

    return SurfaceAnalysis(
        detected_surface_type=detected,
        refractor_confidence=round(confidence, 4),
        rainbow_variance=round(rainbow_variance, 4),
        reflectivity_score=round(reflectivity_score, 4),
        texture_entropy=round(texture_entropy, 4),
        high_reflectivity_patches=len(patches),
        warnings=tuple(warnings),
    )
