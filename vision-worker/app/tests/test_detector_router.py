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


def _low_contrast_holder_image() -> np.ndarray:
    image = np.full((1200, 900, 3), (44, 47, 50), dtype=np.uint8)
    cv2.rectangle(image, (145, 85), (755, 1115), (66, 69, 72), 9)
    cv2.rectangle(image, (190, 150), (710, 1050), (76, 78, 80), -1)
    yy, xx = np.mgrid[0:900, 0:520]
    card = np.empty((900, 520, 3), dtype=np.float32)
    card[:, :, 0] = 35 + (xx / 519) * 170
    card[:, :, 1] = 55 + (yy / 899) * 130
    card[:, :, 2] = 190 - (xx / 519) * 85
    rng = np.random.default_rng(777)
    card += rng.normal(0, 11, size=card.shape)
    image[150:1050, 190:710] = np.clip(card, 0, 255).astype(np.uint8)
    cv2.circle(image, (450, 515), 170, (210, 145, 45), -1)
    cv2.putText(image, "PLAYER", (265, 945), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (245, 245, 245), 4)
    cv2.line(image, (210, 175), (660, 930), (250, 250, 250), 12)
    return image


def test_router_recovers_low_contrast_card_as_review_only():
    image = _low_contrast_holder_image()
    primary = detect_card_objects(image, allow_whole_image_fallback=False)
    recovered = detect_card_objects(image, allow_whole_image_fallback=True)
    assert primary == [] or all(item.detector_name == "opencv_contour_v2.16" for item in primary)
    assert len(recovered) >= 1
    if primary == []:
        assert recovered[0].detector_name == "opencv_recovery_v1.0"
        assert recovered[0].kind_hint == "possible_card_requires_review"
        assert recovered[0].confidence <= 0.72


def test_router_recovery_keeps_generic_desktop_panel_rejected():
    image = np.full((720, 1280, 3), 245, dtype=np.uint8)
    cv2.rectangle(image, (0, 0), (1279, 58), (230, 230, 230), -1)
    cv2.rectangle(image, (20, 90), (260, 690), (235, 235, 235), -1)
    cv2.rectangle(image, (300, 110), (1240, 670), (255, 255, 255), -1)
    for row in range(12):
        y = 135 + row * 38
        cv2.rectangle(image, (330, y), (920, y + 12), (205, 205, 205), -1)
    assert detect_card_objects(image, allow_whole_image_fallback=True) == []
