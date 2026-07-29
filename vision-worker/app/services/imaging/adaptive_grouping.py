from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from app.core.config import settings
from app.services.imaging.card_detector import decode_image
from app.services.imaging.detector_router import detect_card_objects
from app.services.imaging.fingerprint import difference_hash, hamming_distance


@dataclass(frozen=True)
class AdaptiveMatchEvidence:
    accepted: bool
    score: float
    dhash_distance: int
    histogram_similarity: float
    good_matches: int
    match_ratio: float
    homography_inliers: int
    homography_inlier_ratio: float
    threshold: float


_DEFAULT = {
    'schema_version': '1.0',
    'status': 'conservative_default',
    'acceptance_threshold': 0.82,
    'max_dhash_distance': 18,
    'min_good_matches': 12,
    'min_homography_inliers': 8,
    'min_homography_inlier_ratio': 0.42,
}


def _project_root() -> Path:
    return Path(__file__).resolve().parents[4]


def calibration_path() -> Path:
    configured = getattr(settings, 'grouping_calibration_path', None)
    if configured:
        return Path(configured).expanduser().resolve()
    runtime = settings.data_dir / 'training' / 'grouping-calibration.json'
    if runtime.is_file():
        return runtime
    return _project_root() / 'data' / 'training' / 'grouping-calibration.json'


def load_calibration() -> dict:
    path = calibration_path()
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return {**_DEFAULT, **data, 'path': str(path)}
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return {**_DEFAULT, 'path': str(path)}


def normalize_card_image(image: np.ndarray) -> np.ndarray:
    if image is None or image.size == 0:
        raise ValueError('Cannot normalize an empty image.')
    detections = detect_card_objects(image, allow_whole_image_fallback=True)
    if detections:
        selected = max(
            detections,
            key=lambda item: (item.confidence * max(item.area_fraction, 0.01), item.confidence),
        )
        image = selected.crop
    if image.shape[1] > image.shape[0]:
        image = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    return cv2.resize(image, (448, 640), interpolation=cv2.INTER_AREA)


def _histogram_similarity(a: np.ndarray, b: np.ndarray) -> float:
    hsv_a = cv2.cvtColor(a, cv2.COLOR_BGR2HSV)
    hsv_b = cv2.cvtColor(b, cv2.COLOR_BGR2HSV)
    hist_a = cv2.calcHist([hsv_a], [0, 1], None, [24, 24], [0, 180, 0, 256])
    hist_b = cv2.calcHist([hsv_b], [0, 1], None, [24, 24], [0, 180, 0, 256])
    cv2.normalize(hist_a, hist_a)
    cv2.normalize(hist_b, hist_b)
    correlation = float(cv2.compareHist(hist_a, hist_b, cv2.HISTCMP_CORREL))
    return max(0.0, min(1.0, (correlation + 1.0) / 2.0))


def _orb_evidence(a: np.ndarray, b: np.ndarray) -> tuple[int, int, float, int, float]:
    gray_a = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
    gray_b = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
    orb = cv2.ORB_create(
        nfeatures=1400,
        scaleFactor=1.2,
        nlevels=8,
        edgeThreshold=19,
        fastThreshold=12,
    )
    points_a, descriptors_a = orb.detectAndCompute(gray_a, None)
    points_b, descriptors_b = orb.detectAndCompute(gray_b, None)
    count_a = len(points_a or [])
    count_b = len(points_b or [])
    if descriptors_a is None or descriptors_b is None:
        return 0, min(count_a, count_b), 0.0, 0, 0.0

    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    good: list[cv2.DMatch] = []
    for candidates in matcher.knnMatch(descriptors_a, descriptors_b, k=2):
        if len(candidates) != 2:
            continue
        best, second = candidates
        if best.distance < 0.75 * second.distance:
            good.append(best)

    denominator = max(20, min(count_a, count_b))
    ratio = len(good) / denominator
    inliers = 0
    inlier_ratio = 0.0
    if len(good) >= 8:
        source = np.float32([points_a[item.queryIdx].pt for item in good]).reshape(-1, 1, 2)
        target = np.float32([points_b[item.trainIdx].pt for item in good]).reshape(-1, 1, 2)
        try:
            _, mask = cv2.findHomography(source, target, cv2.RANSAC, 4.0)
        except cv2.error:
            mask = None
        if mask is not None:
            inliers = int(mask.ravel().sum())
            inlier_ratio = inliers / len(good)
    return len(good), min(count_a, count_b), float(ratio), inliers, float(inlier_ratio)


def pair_evidence(a: np.ndarray, b: np.ndarray, calibration: dict | None = None) -> AdaptiveMatchEvidence:
    calibration = calibration or load_calibration()
    a = normalize_card_image(a)
    b = normalize_card_image(b)
    distance = hamming_distance(difference_hash(a), difference_hash(b))
    histogram = _histogram_similarity(a, b)
    good, keypoints, match_ratio, inliers, inlier_ratio = _orb_evidence(a, b)

    dhash_score = max(0.0, 1.0 - distance / 24.0)
    match_score = min(1.0, match_ratio / 0.40)
    inlier_score = min(1.0, inlier_ratio / 0.85)
    keypoint_support = min(1.0, keypoints / 80.0)
    score = (
        0.12 * dhash_score
        + 0.16 * histogram
        + 0.23 * match_score
        + 0.43 * inlier_score
        + 0.06 * keypoint_support
    )
    threshold = float(calibration.get('acceptance_threshold', _DEFAULT['acceptance_threshold']))
    accepted = (
        distance <= int(calibration.get('max_dhash_distance', _DEFAULT['max_dhash_distance']))
        and good >= int(calibration.get('min_good_matches', _DEFAULT['min_good_matches']))
        and inliers >= int(calibration.get('min_homography_inliers', _DEFAULT['min_homography_inliers']))
        and inlier_ratio >= float(calibration.get('min_homography_inlier_ratio', _DEFAULT['min_homography_inlier_ratio']))
        and score >= threshold
    )
    return AdaptiveMatchEvidence(
        accepted=accepted,
        score=round(float(score), 6),
        dhash_distance=distance,
        histogram_similarity=round(histogram, 6),
        good_matches=good,
        match_ratio=round(match_ratio, 6),
        homography_inliers=inliers,
        homography_inlier_ratio=round(inlier_ratio, 6),
        threshold=threshold,
    )


def match_paths(current: str | Path, reference: str | Path) -> AdaptiveMatchEvidence | None:
    try:
        current_image = cv2.imread(str(current), cv2.IMREAD_COLOR)
        reference_image = cv2.imread(str(reference), cv2.IMREAD_COLOR)
        if current_image is None or reference_image is None:
            return None
        return pair_evidence(current_image, reference_image)
    except (OSError, ValueError, cv2.error, TypeError):
        return None
