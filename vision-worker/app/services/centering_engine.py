from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Final

import cv2
import numpy as np

_MIN_DIMENSION: Final[int] = 96
_MAX_ANALYSIS_DIMENSION: Final[int] = 512


@dataclass(frozen=True)
class CenteringAssessment:
    centering_lr: str
    centering_tb: str
    estimated_centering_score: float
    edge_wear_detected: bool
    corner_wear_score: float
    left_border_px: int
    right_border_px: int
    top_border_px: int
    bottom_border_px: int
    confidence: float
    warnings: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["warnings"] = list(self.warnings)
        return payload


def _ensure_portrait(image: np.ndarray) -> np.ndarray:
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("Centering assessment requires a BGR color image.")
    if min(image.shape[:2]) < _MIN_DIMENSION:
        raise ValueError("Image is too small for centering assessment.")
    return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE) if image.shape[1] > image.shape[0] else image


def _bounded_analysis_image(image: np.ndarray) -> tuple[np.ndarray, float]:
    height, width = image.shape[:2]
    maximum = max(height, width)
    if maximum <= _MAX_ANALYSIS_DIMENSION:
        return image, 1.0
    scale = _MAX_ANALYSIS_DIMENSION / float(maximum)
    resized = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return resized, scale


def _smooth_profile(profile: np.ndarray, kernel: int = 11) -> np.ndarray:
    if profile.size < 3:
        return profile.astype(np.float32)
    kernel = max(3, min(kernel, profile.size if profile.size % 2 else profile.size - 1))
    kernel = kernel if kernel % 2 else kernel - 1
    return cv2.GaussianBlur(profile.astype(np.float32).reshape(1, -1), (kernel, 1), 0).reshape(-1)


def _strongest_index(profile: np.ndarray, start_fraction: float, end_fraction: float) -> tuple[int, float]:
    size = int(profile.size)
    start = max(1, min(size - 2, int(round(size * start_fraction))))
    end = max(start + 1, min(size - 1, int(round(size * end_fraction))))
    window = profile[start:end]
    if window.size == 0:
        return start, 0.0
    relative = int(np.argmax(window))
    peak = float(window[relative])
    baseline = float(np.median(window)) + 1e-6
    return start + relative, peak / baseline


def _ratio_string(first: int, second: int) -> tuple[str, float]:
    total = max(1, first + second)
    first_percent = float(first) / total * 100.0
    rounded = int(np.clip(round(first_percent / 5.0) * 5, 0, 100))
    return f"{rounded}/{100 - rounded}", first_percent


def _edge_profiles(image: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    grad_x = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))
    grad_y = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3))
    height, width = gray.shape
    row_slice = slice(int(height * 0.14), max(int(height * 0.86), int(height * 0.14) + 1))
    col_slice = slice(int(width * 0.14), max(int(width * 0.86), int(width * 0.14) + 1))
    vertical = _smooth_profile(np.mean(grad_x[row_slice, :], axis=0))
    horizontal = _smooth_profile(np.mean(grad_y[:, col_slice], axis=1))
    return vertical, horizontal


def _wear_metrics(image: np.ndarray, patch_size: int = 30) -> tuple[bool, float, list[str]]:
    height, width = image.shape[:2]
    patch = max(12, min(patch_size, height // 6, width // 6))
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    luminance = lab[:, :, 0].astype(np.float32)
    saturation = hsv[:, :, 1].astype(np.float32)

    outer_mask = np.zeros((height, width), dtype=np.uint8)
    thickness = max(6, min(height, width) // 16)
    outer_mask[:thickness, :] = 1
    outer_mask[-thickness:, :] = 1
    outer_mask[:, :thickness] = 1
    outer_mask[:, -thickness:] = 1
    border_l = luminance[outer_mask == 1]
    border_s = saturation[outer_mask == 1]
    median_l = float(np.median(border_l)) if border_l.size else 128.0
    median_s = float(np.median(border_s)) if border_s.size else 64.0

    warnings: list[str] = []
    if median_l > 205 and median_s < 45:
        warnings.append("The card has a light border; whitening detection is low-confidence.")

    bright_threshold = float(np.clip(median_l + 42.0, 170.0, 242.0))
    anomalous = (luminance >= bright_threshold) & (saturation <= max(70.0, median_s + 20.0))

    corners = [
        anomalous[:patch, :patch],
        anomalous[:patch, width - patch :],
        anomalous[height - patch :, :patch],
        anomalous[height - patch :, width - patch :],
    ]
    edge_regions = [
        anomalous[:thickness, patch : width - patch],
        anomalous[height - thickness :, patch : width - patch],
        anomalous[patch : height - patch, :thickness],
        anomalous[patch : height - patch, width - thickness :],
    ]
    corner_densities = [float(np.mean(region)) if region.size else 0.0 for region in corners]
    edge_densities = [float(np.mean(region)) if region.size else 0.0 for region in edge_regions]
    corner_density = float(np.mean(corner_densities))
    corner_variance = float(np.var(corner_densities))
    edge_density = float(np.mean(edge_densities))

    light_border_penalty = 0.35 if median_l > 205 and median_s < 45 else 1.0
    wear_signal = light_border_penalty * (0.64 * corner_density + 0.24 * edge_density + 0.12 * min(1.0, corner_variance * 20.0))
    edge_wear = bool(edge_density * light_border_penalty >= 0.025 or max(corner_densities, default=0.0) * light_border_penalty >= 0.06)
    score = round(float(np.clip(10.0 - wear_signal * 32.0, 1.0, 10.0)), 1)
    return edge_wear, score, warnings


def assess_centering(image: np.ndarray) -> CenteringAssessment:
    normalized = _ensure_portrait(image)
    analysis_image, analysis_scale = _bounded_analysis_image(normalized)
    height, width = analysis_image.shape[:2]
    vertical, horizontal = _edge_profiles(analysis_image)

    left, left_strength = _strongest_index(vertical, 0.025, 0.34)
    right, right_strength = _strongest_index(vertical, 0.66, 0.975)
    top, top_strength = _strongest_index(horizontal, 0.025, 0.34)
    bottom, bottom_strength = _strongest_index(horizontal, 0.66, 0.975)

    left_border_analysis = max(1, left)
    right_border_analysis = max(1, width - 1 - right)
    top_border_analysis = max(1, top)
    bottom_border_analysis = max(1, height - 1 - bottom)

    lr_text, left_percent = _ratio_string(left_border_analysis, right_border_analysis)
    tb_text, top_percent = _ratio_string(top_border_analysis, bottom_border_analysis)
    worst_deviation = max(abs(left_percent - 50.0), abs(top_percent - 50.0))
    centering_score = round(float(np.clip(10.0 - worst_deviation / 10.0, 1.0, 10.0)), 1)

    inverse_scale = 1.0 / analysis_scale
    left_border = max(1, int(round(left_border_analysis * inverse_scale)))
    right_border = max(1, int(round(right_border_analysis * inverse_scale)))
    top_border = max(1, int(round(top_border_analysis * inverse_scale)))
    bottom_border = max(1, int(round(bottom_border_analysis * inverse_scale)))

    edge_wear, corner_score, wear_warnings = _wear_metrics(analysis_image)
    strengths = np.asarray([left_strength, right_strength, top_strength, bottom_strength], dtype=np.float32)
    confidence = float(np.clip(np.mean(np.minimum(strengths / 4.0, 1.0)), 0.15, 0.99))
    warnings = list(wear_warnings)
    if right <= left or bottom <= top:
        warnings.append("Inner frame boundaries were weak or inconsistent; confirm centering manually.")
        confidence = min(confidence, 0.35)

    return CenteringAssessment(
        centering_lr=lr_text,
        centering_tb=tb_text,
        estimated_centering_score=centering_score,
        edge_wear_detected=edge_wear,
        corner_wear_score=corner_score,
        left_border_px=left_border,
        right_border_px=right_border,
        top_border_px=top_border,
        bottom_border_px=bottom_border,
        confidence=round(confidence, 4),
        warnings=tuple(warnings),
    )
