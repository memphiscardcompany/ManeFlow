import cv2
import numpy as np

from app.services.imaging.detector_router import detect_card_objects


def _textured_card_image() -> np.ndarray:
    rng = np.random.default_rng(7)
    image = np.empty((1000, 714, 3), dtype=np.uint8)
    yy, xx = np.mgrid[0:1000, 0:714]
    image[:, :, 0] = np.clip(35 + (xx / 713) * 180 + rng.normal(0, 20, (1000, 714)), 0, 255)
    image[:, :, 1] = np.clip(55 + (yy / 999) * 170 + rng.normal(0, 20, (1000, 714)), 0, 255)
    image[:, :, 2] = np.clip(220 - (xx / 713) * 130 + rng.normal(0, 20, (1000, 714)), 0, 255)
    cv2.rectangle(image, (18, 18), (695, 981), (250, 250, 250), 10)
    cv2.rectangle(image, (45, 70), (668, 915), (10, 10, 10), 5)
    cv2.circle(image, (357, 430), 200, (35, 175, 235), -1)
    cv2.putText(image, "MANEFLOW", (135, 850), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (255, 255, 255), 4)
    return image


def test_router_falls_back_to_classical_detector_without_weights():
    detections = detect_card_objects(_textured_card_image(), allow_whole_image_fallback=True)
    assert len(detections) == 1
    assert detections[0].detector_name == "opencv_contour_v2.16"
    assert detections[0].kind_hint == "unknown_card_object"


def test_router_does_not_use_whole_image_fallback_for_general_scene_mode():
    image = np.full((1000, 714, 3), 100, dtype=np.uint8)
    assert detect_card_objects(image) == []
