from __future__ import annotations

from functools import lru_cache
import logging

import numpy as np

from app.core.config import settings
from app.services.imaging.card_detector import CardDetection, detect_cards
from app.services.imaging.high_recall_recovery import recover_card_objects
from app.services.imaging.learned_detector import LearnedCardDetector
from app.services.imaging.roboflow_detector import RoboflowCardDetector, RoboflowDetectorError

LOGGER = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _learned_detector() -> LearnedCardDetector | None:
    backend = settings.card_detector_backend.strip().lower()
    if backend in {"classical", "roboflow"}:
        return None
    if not settings.card_detector_model_path:
        return None
    try:
        return LearnedCardDetector(settings.card_detector_model_path)
    except Exception:
        if backend in {"learned", "ultralytics"}:
            raise
        LOGGER.warning("Local learned detector initialization failed; fallback remains available.", exc_info=True)
        return None


@lru_cache(maxsize=1)
def _roboflow_detector() -> RoboflowCardDetector | None:
    backend = settings.card_detector_backend.strip().lower()
    if backend in {"classical", "learned", "ultralytics"}:
        return None
    if not settings.roboflow_detection_enabled:
        return None
    if not settings.roboflow_model_endpoint:
        if backend == "roboflow":
            raise RoboflowDetectorError("ROBOFLOW_MODEL_ENDPOINT is required for the Roboflow backend.")
        return None
    try:
        return RoboflowCardDetector()
    except Exception:
        if backend == "roboflow":
            raise
        LOGGER.warning("Roboflow detector initialization failed; fallback remains available.", exc_info=True)
        return None


def detector_readiness() -> dict[str, object]:
    backend = settings.card_detector_backend.strip().lower()
    learned = _learned_detector()
    roboflow = _roboflow_detector()
    return {
        "backend": backend,
        "local_learned_configured": bool(settings.card_detector_model_path),
        "local_learned_ready": learned is not None,
        "local_learned": learned.readiness() if learned is not None else None,
        "roboflow": roboflow.readiness().to_dict() if roboflow is not None else {
            "enabled": settings.roboflow_detection_enabled,
            "configured": bool(settings.roboflow_model_endpoint),
            "model_name": settings.roboflow_model_name,
            "endpoint_host": None,
            "error": None,
        },
        "classical_fallback_available": True,
        "high_recall_recovery_available": True,
    }


def detect_card_objects(
    image: np.ndarray,
    *,
    allow_whole_image_fallback: bool = False,
) -> list[CardDetection]:
    backend = settings.card_detector_backend.strip().lower()

    local_detector = _learned_detector()
    if local_detector is not None:
        detections = local_detector.detect(image)
        if detections or backend in {"learned", "ultralytics"}:
            return detections

    remote_detector = _roboflow_detector()
    if remote_detector is not None:
        try:
            detections = remote_detector.detect(image)
            if detections or backend == "roboflow":
                return detections
        except RoboflowDetectorError:
            if backend == "roboflow" or not settings.roboflow_fail_open:
                raise
            LOGGER.warning("Roboflow inference failed; using classical fallback.", exc_info=True)

    # Preserve the strict contour detector as the normal local path. When callers
    # explicitly allow single-image recovery and the primary detector finds no
    # region, run the bounded review-only recovery detector instead of the old
    # permissive whole-image fallback. Recovery detections are capped below exact
    # identity thresholds and carry an explicit review-only kind hint.
    classical = detect_cards(image, allow_whole_image_fallback=False)
    if classical or not allow_whole_image_fallback:
        return classical
    return recover_card_objects(image)
