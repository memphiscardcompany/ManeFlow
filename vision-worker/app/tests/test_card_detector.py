import cv2
import numpy as np

from app.services.imaging.card_detector import analyze_card_appearance, detect_cards


def _paint_textured_card(
    image: np.ndarray,
    top_left: tuple[int, int],
    bottom_right: tuple[int, int],
    index: int,
) -> None:
    x1, y1 = top_left
    x2, y2 = bottom_right
    width = x2 - x1
    height = y2 - y1

    rng = np.random.default_rng(index + 100)
    yy, xx = np.mgrid[0:height, 0:width]
    base = np.empty((height, width, 3), dtype=np.float32)
    base[:, :, 0] = 40 + (xx / max(1, width - 1)) * 130 + index * 5
    base[:, :, 1] = 60 + (yy / max(1, height - 1)) * 150
    base[:, :, 2] = 180 - (xx / max(1, width - 1)) * 80 + index * 3
    noise = rng.normal(0, 16, size=base.shape)
    textured = np.clip(base + noise, 0, 255).astype(np.uint8)
    image[y1:y2, x1:x2] = textured

    cv2.rectangle(image, top_left, bottom_right, (248, 248, 248), 8)
    cv2.rectangle(image, (x1 + 18, y1 + 20), (x2 - 18, y2 - 20), (20, 20, 20), 4)
    cv2.circle(image, (x1 + width // 2, y1 + height // 2), min(width, height) // 4, (220, 140, 45), -1)
    cv2.putText(
        image,
        f"CARD {index + 1}",
        (x1 + 35, y1 + height - 70),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.0,
        (245, 245, 245),
        3,
    )


def _synthetic_spread() -> np.ndarray:
    image = np.full((1000, 1400, 3), 35, dtype=np.uint8)
    cards = [
        ((80, 100), (360, 500)),
        ((430, 90), (710, 490)),
        ((790, 120), (1070, 520)),
        ((220, 560), (500, 960)),
        ((600, 550), (880, 950)),
        ((980, 560), (1260, 960)),
    ]
    for index, (top_left, bottom_right) in enumerate(cards):
        _paint_textured_card(image, top_left, bottom_right, index)
    return image


def _synthetic_close_grid() -> np.ndarray:
    image = np.full((1260, 1500, 3), 28, dtype=np.uint8)
    card_width = 300
    card_height = 400
    gap = 8
    start_x = 132
    start_y = 22
    index = 0
    for row in range(3):
        for column in range(4):
            x1 = start_x + column * (card_width + gap)
            y1 = start_y + row * (card_height + gap)
            _paint_textured_card(
                image,
                (x1, y1),
                (x1 + card_width, y1 + card_height),
                index,
            )
            index += 1
    return image


def _synthetic_full_frame_card() -> np.ndarray:
    image = np.empty((1000, 714, 3), dtype=np.uint8)
    rng = np.random.default_rng(42)
    yy, xx = np.mgrid[0:1000, 0:714]
    image[:, :, 0] = np.clip(30 + (xx / 713) * 190 + rng.normal(0, 18, (1000, 714)), 0, 255)
    image[:, :, 1] = np.clip(50 + (yy / 999) * 160 + rng.normal(0, 18, (1000, 714)), 0, 255)
    image[:, :, 2] = np.clip(210 - (xx / 713) * 120 + rng.normal(0, 18, (1000, 714)), 0, 255)
    cv2.rectangle(image, (18, 18), (695, 981), (245, 245, 245), 10)
    cv2.rectangle(image, (45, 70), (668, 915), (15, 15, 15), 5)
    cv2.circle(image, (357, 440), 190, (40, 180, 230), -1)
    cv2.putText(image, "MANEFLOW TEST CARD", (75, 850), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)
    return image


def _synthetic_desktop_screenshot() -> np.ndarray:
    image = np.full((720, 1280, 3), 245, dtype=np.uint8)
    cv2.rectangle(image, (0, 0), (1279, 58), (230, 230, 230), -1)
    cv2.rectangle(image, (20, 90), (260, 690), (235, 235, 235), -1)
    cv2.rectangle(image, (300, 110), (1240, 670), (255, 255, 255), -1)
    for row in range(12):
        y = 135 + row * 38
        cv2.rectangle(image, (330, y), (920, y + 12), (205, 205, 205), -1)
    cv2.rectangle(image, (1000, 520), (1190, 590), (70, 120, 220), -1)
    return image


def test_detects_multiple_textured_card_objects():
    detections = detect_cards(_synthetic_spread())
    assert len(detections) >= 6
    assert all(detection.confidence >= 0.5 for detection in detections)
    assert all(detection.crop.shape[0] > detection.crop.shape[1] for detection in detections)


def test_detects_close_grid_without_merging_neighboring_cards():
    detections = detect_cards(_synthetic_close_grid())
    assert len(detections) >= 12
    assert all(detection.fallback_whole_image is False for detection in detections)


def test_whole_image_fallback_requires_visual_card_evidence():
    detections = detect_cards(_synthetic_full_frame_card(), allow_whole_image_fallback=True)
    assert len(detections) == 1
    assert detections[0].fallback_whole_image is True or detections[0].area_fraction > 0.70


def test_blank_card_ratio_image_is_not_accepted():
    image = np.full((1000, 714, 3), 120, dtype=np.uint8)
    assert detect_cards(image) == []


def test_desktop_screenshot_is_not_accepted_as_a_card():
    assert detect_cards(_synthetic_desktop_screenshot()) == []


def test_appearance_metrics_are_bounded():
    metrics = analyze_card_appearance(_synthetic_full_frame_card())
    assert 0.0 <= metrics.appearance_score <= 1.0
    assert 0.0 <= metrics.gradient_edge_density <= 1.0
    assert 0.0 <= metrics.flat_pixel_fraction <= 1.0
    assert metrics.quantized_color_count > 0
