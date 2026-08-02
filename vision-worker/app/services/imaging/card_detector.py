from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import cv2
import numpy as np

from app.core.config import settings
from app.services.imaging.rectify import rectify_quadrilateral

CLASSICAL_DETECTOR_NAME = "opencv_contour_v2.17_multimap"


@dataclass(frozen=True)
class CardDetection:
    polygon_px: np.ndarray
    bounding_box_px: tuple[int, int, int, int]
    confidence: float
    rectangularity: float
    aspect_ratio: float
    area_fraction: float
    fallback_whole_image: bool
    crop: np.ndarray
    detector_name: str = CLASSICAL_DETECTOR_NAME
    kind_hint: str = "unknown_card_object"


@dataclass(frozen=True)
class CardAppearanceMetrics:
    grayscale_entropy: float
    mean_saturation: float
    saturation_stddev: float
    gradient_edge_density: float
    axis_aligned_edge_fraction: float
    flat_pixel_fraction: float
    quantized_color_count: int
    appearance_score: float


def decode_image(image_bytes: bytes) -> np.ndarray:
    array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Image could not be decoded.")
    return image


def _resize_for_detection(image: np.ndarray) -> tuple[np.ndarray, float]:
    height, width = image.shape[:2]
    maximum = max(height, width)
    if maximum <= settings.detector_max_dimension:
        return image, 1.0
    scale = settings.detector_max_dimension / maximum
    return cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA), scale


def _box_overlap_metrics(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> tuple[float, float]:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    union = aw * ah + bw * bh - intersection
    iou = intersection / union if union else 0.0
    containment = intersection / min(aw * ah, bw * bh) if min(aw * ah, bw * bh) else 0.0
    return iou, containment


def _candidate_contours(image: np.ndarray) -> Iterable[tuple[np.ndarray, bool]]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    edge = cv2.Canny(gray, 45, 145)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    edge = cv2.morphologyEx(edge, cv2.MORPH_CLOSE, kernel, iterations=2)
    edge = cv2.dilate(edge, np.ones((3, 3), np.uint8), iterations=1)

    # A strongly closed edge map remains the precision-first path. It can merge
    # neighboring cards in binder pages and tabletop spreads, so independent,
    # less-connected maps provide bounded high-recall proposals. Every proposal
    # still passes geometry, appearance, and cross-map deduplication below.
    raw_edge = cv2.Canny(gray, 35, 130)
    close3 = cv2.morphologyEx(
        raw_edge,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)),
        iterations=1,
    )
    adaptive = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        41,
        3,
    )
    bright_threshold = max(115, int(round(float(np.percentile(gray, 68.0)))))
    bright = cv2.threshold(gray, bright_threshold, 255, cv2.THRESH_BINARY)[1]

    output: list[tuple[np.ndarray, bool]] = []
    for candidate_map, auxiliary in (
        (edge, False),
        (raw_edge, True),
        (close3, True),
        (adaptive, True),
        (bright, True),
    ):
        contours, _ = cv2.findContours(candidate_map, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        output.extend((contour, auxiliary) for contour in contours)
    return output


def _entropy(gray: np.ndarray) -> float:
    histogram = cv2.calcHist([gray], [0], None, [256], [0, 256]).reshape(-1)
    total = float(histogram.sum())
    if total <= 0:
        return 0.0
    probabilities = histogram / total
    positive = probabilities[probabilities > 0]
    return float(-np.sum(positive * np.log2(positive)))


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def analyze_card_appearance(crop: np.ndarray) -> CardAppearanceMetrics:
    if crop.ndim != 3 or crop.shape[2] != 3:
        raise ValueError("Card appearance analysis requires a BGR color image.")
    if crop.shape[0] < 16 or crop.shape[1] < 16:
        raise ValueError("Card appearance analysis requires an image of at least 16x16 pixels.")

    sample = cv2.resize(crop, (256, 256), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(sample, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(sample, cv2.COLOR_BGR2HSV)

    saturation = hsv[:, :, 1].astype(np.float32) / 255.0
    gradient_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gradient_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    gradient_magnitude = cv2.magnitude(gradient_x, gradient_y)
    gradient_angles = cv2.phase(gradient_x, gradient_y, angleInDegrees=True)

    edge_mask = gradient_magnitude > 40.0
    edge_count = int(np.count_nonzero(edge_mask))
    edge_density = float(edge_count / edge_mask.size)

    folded_angles = np.mod(gradient_angles, 90.0)
    axis_aligned = (folded_angles <= 10.0) | (folded_angles >= 80.0)
    axis_fraction = (
        float(np.count_nonzero(axis_aligned & edge_mask) / edge_count)
        if edge_count > 0
        else 1.0
    )

    flat_fraction = float(np.mean(gradient_magnitude < 8.0))
    quantized = (sample.astype(np.uint16) >> 5)
    color_codes = (quantized[:, :, 0] << 6) | (quantized[:, :, 1] << 3) | quantized[:, :, 2]
    quantized_colors = int(np.count_nonzero(np.bincount(color_codes.reshape(-1), minlength=512)))
    grayscale_entropy = _entropy(gray)
    mean_saturation = float(np.mean(saturation))
    saturation_stddev = float(np.std(saturation))

    entropy_component = _clamp01((grayscale_entropy - 5.6) / 2.0)
    edge_component = _clamp01((edge_density - 0.24) / 0.42)
    flat_component = _clamp01((0.52 - flat_fraction) / 0.42)
    color_component = _clamp01((mean_saturation - 0.04) / 0.34)
    diversity_component = _clamp01((quantized_colors - 35.0) / 150.0)
    axis_component = _clamp01((0.78 - axis_fraction) / 0.48)

    score = (
        (0.24 * entropy_component)
        + (0.25 * edge_component)
        + (0.20 * flat_component)
        + (0.12 * color_component)
        + (0.10 * diversity_component)
        + (0.09 * axis_component)
    )

    return CardAppearanceMetrics(
        grayscale_entropy=round(grayscale_entropy, 6),
        mean_saturation=round(mean_saturation, 6),
        saturation_stddev=round(saturation_stddev, 6),
        gradient_edge_density=round(edge_density, 6),
        axis_aligned_edge_fraction=round(axis_fraction, 6),
        flat_pixel_fraction=round(flat_fraction, 6),
        quantized_color_count=quantized_colors,
        appearance_score=round(float(score), 6),
    )


def _touches_image_frame(
    bounding_box: tuple[int, int, int, int],
    image_width: int,
    image_height: int,
) -> int:
    x, y, width, height = bounding_box
    margin = max(4, int(round(min(image_width, image_height) * 0.01)))
    return sum(
        (
            x <= margin,
            y <= margin,
            x + width >= image_width - margin,
            y + height >= image_height - margin,
        )
    )


def _is_plausible_card_crop(
    crop: np.ndarray,
    *,
    area_fraction: float,
    bounding_box: tuple[int, int, int, int],
    image_width: int,
    image_height: int,
    fallback_whole_image: bool,
) -> tuple[bool, CardAppearanceMetrics]:
    metrics = analyze_card_appearance(crop)

    if fallback_whole_image:
        accepted = (
            (
                metrics.grayscale_entropy >= 7.35
                and metrics.gradient_edge_density >= 0.50
                and metrics.flat_pixel_fraction <= 0.22
                and metrics.mean_saturation >= 0.18
            )
            or (
                metrics.grayscale_entropy >= 6.30
                and metrics.mean_saturation >= 0.40
                and metrics.flat_pixel_fraction <= 0.35
            )
        )
        return accepted, metrics

    if area_fraction >= 0.85 and _touches_image_frame(bounding_box, image_width, image_height) >= 3:
        return False, metrics

    accepted = (
        metrics.grayscale_entropy >= 5.80
        and metrics.gradient_edge_density >= 0.15
        and metrics.flat_pixel_fraction <= 0.42
        and metrics.appearance_score >= 0.38
    )
    return accepted, metrics


def detect_cards(
    image: np.ndarray,
    *,
    allow_whole_image_fallback: bool = False,
) -> list[CardDetection]:
    original_h, original_w = image.shape[:2]
    # The classical fallback is intentionally conservative on ultra-wide banners and
    # desktop splash panels. Learned segmentation remains the supported path for
    # panoramic lot scenes. This prevents sports photography and UI panels from
    # being mistaken for card-shaped objects.
    if original_w / max(1, original_h) > 2.0:
        return []

    working, scale = _resize_for_detection(image)
    h, w = working.shape[:2]
    image_area = float(w * h)
    candidates: list[tuple[float, np.ndarray, tuple[int, int, int, int], float, float, float]] = []

    for contour, auxiliary in _candidate_contours(working):
        contour_area = float(cv2.contourArea(contour))
        area_fraction = contour_area / image_area if image_area else 0.0
        if not (settings.detector_min_area_fraction <= area_fraction <= settings.detector_max_area_fraction):
            continue

        rect = cv2.minAreaRect(contour)
        (_, _), (rect_w, rect_h), _ = rect
        if rect_w < 25 or rect_h < 25:
            continue
        long_side = max(rect_w, rect_h)
        short_side = min(rect_w, rect_h)
        aspect_ratio = short_side / long_side
        minimum_aspect = 0.45 if auxiliary else 0.50
        maximum_aspect = 0.95 if auxiliary else 0.92
        if not minimum_aspect <= aspect_ratio <= maximum_aspect:
            continue

        rect_area = rect_w * rect_h
        rectangularity = contour_area / rect_area if rect_area else 0.0
        minimum_rectangularity = 0.30 if auxiliary else 0.48
        if rectangularity < minimum_rectangularity:
            continue
        if aspect_ratio > 0.90 and (area_fraction < 0.015 or rectangularity < 0.40):
            continue
        if not auxiliary and aspect_ratio > 0.86 and (area_fraction < 0.10 or rectangularity < 0.55):
            continue

        box = cv2.boxPoints(rect).astype(np.float32)
        x, y, bw, bh = cv2.boundingRect(box.astype(np.int32))
        aspect_score = max(0.0, 1.0 - abs(aspect_ratio - 0.714) / 0.24)
        confidence = min(
            0.98,
            0.34
            + (0.36 * min(rectangularity, 1.0))
            + (0.23 * aspect_score)
            + (0.07 * min(area_fraction / 0.18, 1.0))
            - (0.03 if auxiliary else 0.0),
            # Connected auxiliary contours are useful proposals but should not
            # outrank clean individual-card rectangles merely because they span
            # several neighboring cards.
            0.94 - (0.18 * max(0.0, min(1.0, (area_fraction - 0.18) / 0.42)))
            if auxiliary
            else 0.98,
        )
        candidates.append((confidence, box, (x, y, bw, bh), rectangularity, aspect_ratio, area_fraction))

    # Prefer card-like geometry over the largest contour. Sorting by area first
    # caused connected rows of cards to suppress their individual proposals.
    candidates.sort(key=lambda item: (item[0], item[5]), reverse=True)
    inverse = 1.0 / scale
    # Appearance validation must happen before non-maximum suppression. A large
    # connected contour may score well geometrically but fail the card-appearance
    # gate; suppressing its nested individual cards first caused entire clear
    # grids to disappear.
    candidate_limit = max(200, settings.max_detections_per_image * 8)
    plausible_candidates: list[
        tuple[
            float,
            np.ndarray,
            tuple[int, int, int, int],
            np.ndarray,
            tuple[int, int, int, int],
            float,
            float,
            float,
            np.ndarray,
            CardAppearanceMetrics,
        ]
    ] = []
    for confidence, box, bbox, rectangularity, aspect_ratio, area_fraction in candidates[:candidate_limit]:
        original_box = box * inverse
        crop = rectify_quadrilateral(image, original_box)
        x, y, bw, bh = bbox
        original_bbox = (
            max(0, int(round(x * inverse))),
            max(0, int(round(y * inverse))),
            max(1, int(round(bw * inverse))),
            max(1, int(round(bh * inverse))),
        )

        plausible, appearance = _is_plausible_card_crop(
            crop,
            area_fraction=area_fraction,
            bounding_box=original_bbox,
            image_width=original_w,
            image_height=original_h,
            fallback_whole_image=False,
        )
        if not plausible:
            continue
        plausible_candidates.append((
            confidence,
            box,
            bbox,
            original_box,
            original_bbox,
            rectangularity,
            aspect_ratio,
            area_fraction,
            crop,
            appearance,
        ))

    # Scene containers and connected card rows can themselves look richly
    # textured. If a large proposal contains at least three independent,
    # plausible card-scale anchors, treat the large contour as their container
    # rather than one physical card.
    small_anchor_boxes: list[tuple[int, int, int, int]] = []
    for candidate in plausible_candidates:
        bbox = candidate[2]
        area_fraction = candidate[7]
        if area_fraction > 0.25:
            continue
        if any(
            (lambda overlap: overlap[0] > 0.52 or overlap[1] > 0.72)(
                _box_overlap_metrics(bbox, previous)
            )
            for previous in small_anchor_boxes
        ):
            continue
        small_anchor_boxes.append(bbox)

    detections: list[CardDetection] = []
    accepted_boxes: list[tuple[int, int, int, int]] = []
    for (
        confidence,
        box,
        bbox,
        original_box,
        original_bbox,
        rectangularity,
        aspect_ratio,
        area_fraction,
        crop,
        appearance,
    ) in plausible_candidates:
        if area_fraction > 0.35:
            x, y, width, height = bbox
            nested_anchors = 0
            for anchor_x, anchor_y, anchor_width, anchor_height in small_anchor_boxes:
                center_x = anchor_x + (anchor_width / 2.0)
                center_y = anchor_y + (anchor_height / 2.0)
                if (
                    x <= center_x <= x + width
                    and y <= center_y <= y + height
                    and (anchor_width * anchor_height) <= (width * height) / 3.0
                ):
                    nested_anchors += 1
            if nested_anchors >= 3:
                continue
        duplicate_or_nested = False
        for previous_box in accepted_boxes:
            iou, containment = _box_overlap_metrics(bbox, previous_box)
            if iou > 0.52 or containment > 0.72:
                duplicate_or_nested = True
                break
        if duplicate_or_nested:
            continue
        accepted_boxes.append(bbox)

        calibrated_confidence = min(
            0.99,
            max(0.0, (0.78 * confidence) + (0.22 * appearance.appearance_score)),
        )
        detections.append(
            CardDetection(
                polygon_px=original_box,
                bounding_box_px=original_bbox,
                confidence=round(float(calibrated_confidence), 4),
                rectangularity=round(float(rectangularity), 4),
                aspect_ratio=round(float(aspect_ratio), 4),
                area_fraction=round(float(area_fraction), 4),
                fallback_whole_image=False,
                crop=crop,
                detector_name=CLASSICAL_DETECTOR_NAME,
            )
        )
        if len(detections) >= settings.max_detections_per_image:
            break

    if detections:
        return detections

    if not allow_whole_image_fallback:
        return []

    ratio = min(original_w, original_h) / max(original_w, original_h)
    if 0.50 <= ratio <= 0.86:
        polygon = np.array(
            [[0, 0], [original_w - 1, 0], [original_w - 1, original_h - 1], [0, original_h - 1]],
            dtype=np.float32,
        )
        crop = image.copy()
        if crop.shape[1] > crop.shape[0]:
            crop = cv2.rotate(crop, cv2.ROTATE_90_CLOCKWISE)

        plausible, appearance = _is_plausible_card_crop(
            crop,
            area_fraction=1.0,
            bounding_box=(0, 0, original_w, original_h),
            image_width=original_w,
            image_height=original_h,
            fallback_whole_image=True,
        )
        if plausible:
            confidence = 0.48 + (0.22 * appearance.appearance_score)
            return [
                CardDetection(
                    polygon_px=polygon,
                    bounding_box_px=(0, 0, original_w, original_h),
                    confidence=round(float(min(0.70, confidence)), 4),
                    rectangularity=1.0,
                    aspect_ratio=round(float(ratio), 4),
                    area_fraction=1.0,
                    fallback_whole_image=True,
                    crop=crop,
                    detector_name=CLASSICAL_DETECTOR_NAME,
                )
            ]
    return []
