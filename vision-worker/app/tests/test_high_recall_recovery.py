import cv2
import numpy as np

from app.services.imaging.high_recall_recovery import recover_card_objects


def _full_frame_card() -> np.ndarray:
    image = np.empty((1000, 714, 3), dtype=np.uint8)
    rng = np.random.default_rng(42)
    yy, xx = np.mgrid[0:1000, 0:714]
    image[:, :, 0] = np.clip(30 + (xx / 713) * 190 + rng.normal(0, 18, (1000, 714)), 0, 255)
    image[:, :, 1] = np.clip(50 + (yy / 999) * 160 + rng.normal(0, 18, (1000, 714)), 0, 255)
    image[:, :, 2] = np.clip(210 - (xx / 713) * 120 + rng.normal(0, 18, (1000, 714)), 0, 255)
    cv2.circle(image, (357, 440), 190, (40, 180, 230), -1)
    cv2.putText(image, "MANEFLOW TEST CARD", (75, 850), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)
    return image


def test_whole_image_recovery_is_review_only_and_bounded():
    detections = recover_card_objects(_full_frame_card())
    assert len(detections) == 1
    detection = detections[0]
    assert detection.detector_name == "opencv_recovery_v1.0"
    assert detection.kind_hint == "possible_card_requires_review"
    assert detection.confidence <= 0.72


def test_blank_card_ratio_image_is_not_recovered():
    image = np.full((1000, 714, 3), 120, dtype=np.uint8)
    assert recover_card_objects(image) == []


def test_ultrawide_banner_is_not_recovered():
    image = np.random.default_rng(1).integers(0, 255, size=(300, 1200, 3), dtype=np.uint8)
    assert recover_card_objects(image) == []
