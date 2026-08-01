from __future__ import annotations

"""Bounded local recovery for clear card photos missed by the primary detector.

This module is intentionally review-only. It never promotes an exact identity and it
never calls a remote model. Its purpose is to preserve physical-card evidence when
low contrast, glare, sleeves, top loaders, or screenshot chrome obscure the strict
primary contour detector.
"""

from dataclasses import dataclass

import cv2
import numpy as np

from app.core.config import settings
from app.services.imaging.card_detector import CardDetection, analyze_card_appearance
from app.services.imaging.rectify import rectify_quadrilateral

RECOVERY_DETECTOR_NAME = "opencv_recovery_v1.0"
RECOVERY_KIND_HINT = "possible_card_requires_review"


@dataclass(frozen=True)
class _Proposal:
    score: float
    polygon: np.ndarray
    bounding_box: tuple[int, int, int, int]
    rectangularity: float
    aspect_ratio: float
    area_fraction: float


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _resize(image: np.ndarray) -> tuple[np.ndarray, float]:
    height, width = image.shape[:2]
    maximum = max(height, width)
    limit = min(settings.detector_max_dimension, 1400)
    if maximum <= limit:
        return image, 1.0
    scale = limit / maximum
    resized = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return resized, scale


def _edge_maps(image: np.ndarray) -> list[np.ndarray]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(blurred)

    maps = [
        cv2.Canny(blurred, 28, 100),
        cv2.Canny(blurred, 50, 160),
        cv2.Canny(clahe, 32, 118),
    ]

    gradient_x = cv2.Sobel(clahe, cv2.CV_32F, 1, 0, ksize=3)
    gradient_y = cv2.Sobel(clahe, cv2.CV_32F, 0, 1, ksize=3)
    magnitude = cv2.magnitude(gradient_x, gradient_y)
    threshold = max(22.0, float(np.percentile(magnitude, 78.0)))
    maps.append(np.where(magnitude >= threshold, 255, 0).astype(np.uint8))

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    output: list[np.ndarray] = []
    for edge in maps:
        edge = cv2.morphologyEx(edge, cv2.MORPH_CLOSE, kernel, iterations=2)
        edge = cv2.dilate(edge, np.ones((3, 3), np.uint8), iterations=1)
        output.append(edge)
    return output


def _center_score(box: tuple[int, int, int, int], width: int, height: int) -> float:
    x, y, box_width, box_height = box
    center_x = x + (box_width / 2.0)
    center_y = y + (box_height / 2.0)
    dx = abs(center_x - (width / 2.0)) / max(1.0, width / 2.0)
    dy = abs(center_y - (height / 2.0)) / max(1.0, height / 2.0)
    return _clamp01(1.0 - ((dx + dy) / 2.0))


def _line_structure_score(image: np.ndarray) -> float:
    height, width = image.shape[:2]
    maximum = max(height, width)
    if maximum > 800:
        scale = 800.0 / maximum
        sample = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    else:
        sample = image

    gray = cv2.cvtColor(sample, cv2.COLOR_BGR2GRAY)
    edge = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 34, 124)
    minimum = max(36, int(round(min(sample.shape[:2]) * 0.26)))
    lines = cv2.HoughLinesP(
        edge,
        1,
        np.pi / 180.0,
        threshold=42,
        minLineLength=minimum,
        maxLineGap=22,
    )
    if lines is None:
        return 0.0

    horizontal = 0
    vertical = 0
    angle_buckets: dict[int, int] = {}
    for raw in lines[:160]:
        x1, y1, x2, y2 = (int(value) for value in raw[0])
        angle = abs(float(np.degrees(np.arctan2(y2 - y1, x2 - x1)))) % 180.0
        if angle <= 15.0 or angle >= 165.0:
            horizontal += 1
        elif 75.0 <= angle <= 105.0:
            vertical += 1
        else:
            bucket = int(round((angle % 90.0) / 10.0))
            angle_buckets[bucket] = angle_buckets.get(bucket, 0) + 1

    axis = min(1.0, horizontal / 2.0) * min(1.0, vertical / 2.0)
    diagonal = min(1.0, max(angle_buckets.values(), default=0) / 4.0)
    return float(max(axis, diagonal * 0.55))


def _overlap(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> tuple[float, float]:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    union = (aw * ah) + (bw * bh) - intersection
    minimum = min(aw * ah, bw * bh)
    return (
        intersection / union if union else 0.0,
        intersection / minimum if minimum else 0.0,
    )


def _proposals(image: np.ndarray) -> tuple[list[_Proposal], float]:
    working, scale = _resize(image)
    height, width = working.shape[:2]
    image_area = float(max(1, height * width))
    proposals: list[_Proposal] = []

    for edge in _edge_maps(working):
        contours, _ = cv2.findContours(edge, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            contour_area = float(cv2.contourArea(contour))
            area_fraction = contour_area / image_area
            if not 0.04 <= area_fraction <= 0.94:
                continue

            rect = cv2.minAreaRect(contour)
            (_, _), (rect_width, rect_height), _ = rect
            if min(rect_width, rect_height) < 28:
                continue
            long_side = max(rect_width, rect_height)
            short_side = min(rect_width, rect_height)
            aspect_ratio = short_side / max(1.0, long_side)
            if not 0.43 <= aspect_ratio <= 0.96:
                continue

            rectangle_area = float(rect_width * rect_height)
            rectangularity = contour_area / rectangle_area if rectangle_area else 0.0
            if rectangularity < 0.28:
                continue

            polygon = cv2.boxPoints(rect).astype(np.float32)
            bounding_box = cv2.boundingRect(polygon.astype(np.int32))
            center = _center_score(bounding_box, width, height)
            aspect = _clamp01(1.0 - (abs(aspect_ratio - 0.714) / 0.31))
            area = _clamp01(area_fraction / 0.42)
            score = (0.31 * center) + (0.27 * aspect) + (0.23 * _clamp01(rectangularity)) + (0.19 * area)
            if score >= 0.50:
                proposals.append(
                    _Proposal(
                        score=score,
                        polygon=polygon,
                        bounding_box=bounding_box,
                        rectangularity=rectangularity,
                        aspect_ratio=aspect_ratio,
                        area_fraction=area_fraction,
                    )
                )

    proposals.sort(key=lambda item: item.score, reverse=True)
    deduplicated: list[_Proposal] = []
    for proposal in proposals:
        if any(
            (lambda metrics: metrics[0] > 0.58 or metrics[1] > 0.78)(
                _overlap(proposal.bounding_box, previous.bounding_box)
            )
            for previous in deduplicated
        ):
            continue
        deduplicated.append(proposal)
        if len(deduplicated) >= min(settings.max_detections_per_image, 12):
            break
    return deduplicated, scale


def _supported_crop(crop: np.ndarray) -> tuple[bool, float]:
    metrics = analyze_card_appearance(crop)
    line_structure = _line_structure_score(crop)
    supported = (
        metrics.grayscale_entropy >= 5.0
        and metrics.quantized_color_count >= 32
        and metrics.flat_pixel_fraction <= 0.78
        and (metrics.appearance_score >= 0.14 or line_structure >= 0.38)
    )
    evidence_score = max(metrics.appearance_score, line_structure * 0.75)
    return bool(supported), float(evidence_score)


def _recover_proposals(image: np.ndarray) -> list[CardDetection]:
    proposals, scale = _proposals(image)
    inverse = 1.0 / scale
    detections: list[CardDetection] = []

    for proposal in proposals:
        polygon = proposal.polygon * inverse
        crop = rectify_quadrilateral(image, polygon)
        supported, evidence_score = _supported_crop(crop)
        if not supported:
            continue

        x, y, width, height = proposal.bounding_box
        bounding_box = (
            max(0, int(round(x * inverse))),
            max(0, int(round(y * inverse))),
            max(1, int(round(width * inverse))),
            max(1, int(round(height * inverse))),
        )
        confidence = min(0.72, 0.39 + (0.22 * proposal.score) + (0.10 * evidence_score))
        detections.append(
            CardDetection(
                polygon_px=polygon,
                bounding_box_px=bounding_box,
                confidence=round(float(confidence), 4),
                rectangularity=round(float(proposal.rectangularity), 4),
                aspect_ratio=round(float(proposal.aspect_ratio), 4),
                area_fraction=round(float(proposal.area_fraction), 4),
                fallback_whole_image=False,
                crop=crop,
                detector_name=RECOVERY_DETECTOR_NAME,
                kind_hint=RECOVERY_KIND_HINT,
            )
        )
    return detections


def _recover_whole_image(image: np.ndarray) -> list[CardDetection]:
    height, width = image.shape[:2]
    aspect_ratio = min(width, height) / max(width, height)
    if not 0.50 <= aspect_ratio <= 0.86:
        return []

    crop = image.copy()
    if crop.shape[1] > crop.shape[0]:
        crop = cv2.rotate(crop, cv2.ROTATE_90_CLOCKWISE)

    metrics = analyze_card_appearance(crop)
    line_structure = _line_structure_score(crop)
    strong_appearance = (
        metrics.grayscale_entropy >= 7.05
        and metrics.gradient_edge_density >= 0.34
        and metrics.flat_pixel_fraction <= 0.38
        and metrics.quantized_color_count >= 90
    )
    card_like_structure = (
        metrics.grayscale_entropy >= 5.45
        and metrics.gradient_edge_density >= 0.075
        and metrics.flat_pixel_fraction <= 0.72
        and metrics.quantized_color_count >= 45
        and metrics.appearance_score >= 0.17
        and line_structure >= 0.35
    )
    colorful_card_surface = (
        metrics.grayscale_entropy >= 6.10
        and metrics.mean_saturation >= 0.32
        and metrics.flat_pixel_fraction <= 0.52
        and metrics.quantized_color_count >= 75
        and metrics.appearance_score >= 0.30
    )
    if not (strong_appearance or card_like_structure or colorful_card_surface):
        return []

    polygon = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype=np.float32,
    )
    confidence = min(0.68, 0.45 + (0.15 * max(metrics.appearance_score, line_structure * 0.75)))
    return [
        CardDetection(
            polygon_px=polygon,
            bounding_box_px=(0, 0, width, height),
            confidence=round(float(confidence), 4),
            rectangularity=1.0,
            aspect_ratio=round(float(aspect_ratio), 4),
            area_fraction=1.0,
            fallback_whole_image=True,
            crop=crop,
            detector_name=RECOVERY_DETECTOR_NAME,
            kind_hint=RECOVERY_KIND_HINT,
        )
    ]


def recover_card_objects(image: np.ndarray) -> list[CardDetection]:
    """Return review-only local recovery detections or an empty list.

    Proposal recovery is preferred. A whole-image result is permitted only for an
    image whose own dimensions are card-compatible and whose visual structure
    supplies independent evidence. The returned confidence is intentionally capped.
    """

    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("Card recovery requires a BGR color image.")
    height, width = image.shape[:2]
    if min(height, width) < 32:
        return []
    if width / max(1, height) > 2.0:
        return []

    recovered = _recover_proposals(image)
    if recovered:
        return recovered
    return _recover_whole_image(image)
