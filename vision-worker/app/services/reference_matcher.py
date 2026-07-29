from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from app.core.config import settings
from app.models.schemas import PredictedCard
from app.services.bulk_intake_repository import bulk_intake_repository
from app.services.imaging.card_detector import decode_image
from app.services.imaging.detector_router import detect_card_objects
from app.services.imaging.fingerprint import difference_hash, hamming_distance


@dataclass(frozen=True)
class ReferenceCandidate:
    card: PredictedCard
    identity_confidence: float
    variant_confidence: float
    card_side: str
    method: str
    distance: int
    warnings: list[str]


@dataclass(frozen=True)
class _FeatureEvidence:
    dhash_distance: int
    keypoints_current: int
    keypoints_reference: int
    good_matches: int
    match_ratio: float
    homography_inliers: int
    homography_inlier_ratio: float

    @property
    def accepted(self) -> bool:
        """Require repeatable local features and geometric agreement.

        Perceptual hashes are only a cheap candidate pre-filter. They are not
        sufficient identity evidence because unrelated card-shaped objects can
        share nearly identical low-frequency layouts.
        """
        minimum_keypoints = min(self.keypoints_current, self.keypoints_reference)
        return (
            self.dhash_distance <= 12
            and minimum_keypoints >= 30
            and self.good_matches >= 12
            and self.match_ratio >= 0.12
            and self.homography_inliers >= 10
            and self.homography_inlier_ratio >= 0.45
            and (self.dhash_distance <= 8 or self.match_ratio >= 0.25)
        )

    @property
    def score(self) -> float:
        if not self.accepted:
            return 0.0
        distance_score = max(0.0, 1.0 - (self.dhash_distance / 12.0))
        ratio_score = min(1.0, self.match_ratio / 0.40)
        inlier_score = min(1.0, self.homography_inlier_ratio / 0.85)
        return round((0.20 * distance_score) + (0.35 * ratio_score) + (0.45 * inlier_score), 6)


@dataclass(frozen=True)
class _IndexedReference:
    example: dict
    side: str
    image_path: str | None
    content_hash: str | None
    perceptual_hash: str | None


class ReferenceMatcher:
    """Conservative matcher over owner-curated, consented reference examples.

    Exact byte hashes are authoritative for an already-curated source image.
    All transformed/re-scanned matches require ORB feature correspondence plus
    a RANSAC homography. This prevents a plain rectangle, common card layout,
    or similar color palette from becoming a false exact card identity.
    """

    _NORMALIZED_SIZE = (448, 640)

    def __init__(self) -> None:
        self._index_lock = threading.RLock()
        self._index_token: tuple[int, int] | None = None
        self._index: list[_IndexedReference] = []
        self._exact_index: dict[str, _IndexedReference] = {}

    @staticmethod
    def _database_token() -> tuple[int, int]:
        try:
            stat = settings.dev_database_file.stat()
            return stat.st_mtime_ns, stat.st_size
        except OSError:
            return 0, 0

    def _reference_index(self) -> tuple[list[_IndexedReference], dict[str, _IndexedReference]]:
        token = self._database_token()
        with self._index_lock:
            if self._index_token == token:
                return self._index, self._exact_index
            entries: list[_IndexedReference] = []
            exact: dict[str, _IndexedReference] = {}
            for example in bulk_intake_repository.curated_reference_examples():
                evidence = example.get("evidence") or {}
                for side in ("front", "back"):
                    image_path = example.get(f"{side}_image_path")
                    content_hash = example.get(f"{side}_sha256")
                    perceptual_hash = evidence.get(f"{side}_dhash")
                    if not image_path and not content_hash:
                        continue
                    entry = _IndexedReference(
                        example=example,
                        side=side,
                        image_path=image_path,
                        content_hash=content_hash,
                        perceptual_hash=perceptual_hash,
                    )
                    entries.append(entry)
                    if content_hash:
                        exact[content_hash] = entry
            self._index_token = token
            self._index = entries
            self._exact_index = exact
            return entries, exact

    @staticmethod
    def _card(label: dict) -> PredictedCard:
        allowed = set(PredictedCard.model_fields)
        return PredictedCard.model_validate({key: value for key, value in label.items() if key in allowed})

    @classmethod
    def _normalize_card_image(cls, image: np.ndarray) -> np.ndarray:
        if image is None or image.size == 0:
            raise ValueError("Cannot normalize an empty image.")

        detections = detect_card_objects(image, allow_whole_image_fallback=True)
        if detections:
            selected = max(
                detections,
                key=lambda item: (item.confidence * max(item.area_fraction, 0.01), item.confidence),
            )
            image = selected.crop

        if image.shape[1] > image.shape[0]:
            image = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)

        height, width = image.shape[:2]
        # Remove a very small scanner/crop border without deleting card text.
        margin_x = max(1, int(round(width * 0.015)))
        margin_y = max(1, int(round(height * 0.015)))
        if width > (margin_x * 2 + 20) and height > (margin_y * 2 + 20):
            image = image[margin_y : height - margin_y, margin_x : width - margin_x]

        return cv2.resize(image, cls._NORMALIZED_SIZE, interpolation=cv2.INTER_AREA)

    @staticmethod
    def _feature_evidence(current: np.ndarray, reference: np.ndarray) -> _FeatureEvidence:
        current_gray = cv2.cvtColor(current, cv2.COLOR_BGR2GRAY)
        reference_gray = cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY)
        current_hash = difference_hash(current)
        reference_hash = difference_hash(reference)
        distance = hamming_distance(current_hash, reference_hash)

        # A low FAST threshold retains text/logo details from lower-resolution
        # scanner images while RANSAC rejects spatially inconsistent matches.
        orb = cv2.ORB_create(
            nfeatures=1400,
            scaleFactor=1.2,
            nlevels=8,
            edgeThreshold=19,
            fastThreshold=12,
        )
        current_points, current_descriptors = orb.detectAndCompute(current_gray, None)
        reference_points, reference_descriptors = orb.detectAndCompute(reference_gray, None)
        current_count = len(current_points or [])
        reference_count = len(reference_points or [])

        if current_descriptors is None or reference_descriptors is None:
            return _FeatureEvidence(distance, current_count, reference_count, 0, 0.0, 0, 0.0)

        matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
        good_matches: list[cv2.DMatch] = []
        for candidates in matcher.knnMatch(current_descriptors, reference_descriptors, k=2):
            if len(candidates) != 2:
                continue
            best, second = candidates
            if best.distance < 0.75 * second.distance:
                good_matches.append(best)

        denominator = max(20, min(current_count, reference_count))
        match_ratio = len(good_matches) / denominator
        inlier_count = 0
        inlier_ratio = 0.0
        if len(good_matches) >= 8:
            source_points = np.float32(
                [current_points[match.queryIdx].pt for match in good_matches]
            ).reshape(-1, 1, 2)
            target_points = np.float32(
                [reference_points[match.trainIdx].pt for match in good_matches]
            ).reshape(-1, 1, 2)
            try:
                _, mask = cv2.findHomography(
                    source_points,
                    target_points,
                    cv2.RANSAC,
                    4.0,
                )
            except cv2.error:
                mask = None
            if mask is not None:
                inlier_count = int(mask.ravel().sum())
                inlier_ratio = inlier_count / len(good_matches)

        return _FeatureEvidence(
            dhash_distance=distance,
            keypoints_current=current_count,
            keypoints_reference=reference_count,
            good_matches=len(good_matches),
            match_ratio=round(float(match_ratio), 6),
            homography_inliers=inlier_count,
            homography_inlier_ratio=round(float(inlier_ratio), 6),
        )

    @staticmethod
    def _load_reference(path_value: str | None) -> np.ndarray | None:
        if not path_value:
            return None
        path = Path(path_value).expanduser()
        if not path.is_file():
            return None
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        return image if image is not None and image.size else None

    def match(self, image_bytes: bytes) -> ReferenceCandidate | None:
        try:
            decoded = decode_image(image_bytes)
            current = self._normalize_card_image(decoded)
        except Exception:
            return None

        content_hash = hashlib.sha256(image_bytes).hexdigest()
        current_raw_hash = difference_hash(decoded)
        current_normalized_hash = difference_hash(current)
        entries, exact_index = self._reference_index()
        exact = exact_index.get(content_hash)
        if exact is not None:
            best: tuple[float, dict, str, str, _FeatureEvidence | None] | None = (
                1.0,
                exact.example,
                exact.side,
                "exact_content_hash",
                None,
            )
        else:
            best = None
            # The stored dHash is a cheap index only. Final acceptance still
            # requires local feature matches and geometric consistency.
            for entry in entries:
                if entry.perceptual_hash:
                    try:
                        prefilter_distance = min(
                            hamming_distance(current_raw_hash, entry.perceptual_hash),
                            hamming_distance(current_normalized_hash, entry.perceptual_hash),
                        )
                    except ValueError:
                        continue
                    if prefilter_distance > 16:
                        continue
                reference_image = self._load_reference(entry.image_path)
                if reference_image is None:
                    continue
                try:
                    reference = self._normalize_card_image(reference_image)
                    evidence = self._feature_evidence(current, reference)
                except Exception:
                    continue
                if not evidence.accepted:
                    continue
                candidate = (
                    evidence.score,
                    entry.example,
                    entry.side,
                    "geometric_feature_match",
                    evidence,
                )
                if best is None or candidate[0] > best[0]:
                    best = candidate

        if best is None:
            return None

        score, example, side, method, evidence = best
        card = self._card(example.get("label") or {})
        if not any(card.model_dump().values()):
            return None

        if method == "exact_content_hash":
            identity_confidence = 0.995
            variant_confidence = 0.93
            warnings = [
                "Identity matched an owner-curated reference image by exact content hash.",
                "Confirm physical condition and any serial-number details before transacting.",
            ]
            distance_value = 0
        else:
            assert evidence is not None
            # A strong geometric repeat match can establish card identity, but
            # exact finish/serial details remain slightly more conservative.
            identity_confidence = round(min(0.992, 0.90 + (0.092 * score)), 4)
            variant_confidence = round(min(0.92, 0.76 + (0.16 * score)), 4)
            warnings = [
                (
                    "Identity matched an owner-curated reference using local visual features "
                    f"({evidence.good_matches} matches; "
                    f"{evidence.homography_inliers} geometric inliers)."
                ),
                "Reference matching is opt-in and owner-curated; confirm serial number, finish, and condition before transacting.",
            ]
            distance_value = evidence.dhash_distance

        return ReferenceCandidate(
            card=card,
            identity_confidence=identity_confidence,
            variant_confidence=variant_confidence,
            card_side=side,
            method=method,
            distance=distance_value,
            warnings=warnings,
        )


reference_matcher = ReferenceMatcher()
