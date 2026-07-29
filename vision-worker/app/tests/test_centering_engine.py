import cv2
import numpy as np

from app.services.centering_engine import assess_centering


def synthetic_card(left: int = 36, right: int = 36, top: int = 48, bottom: int = 48) -> np.ndarray:
    height, width = 700, 500
    image = np.full((height, width, 3), 28, dtype=np.uint8)
    cv2.rectangle(image, (left, top), (width - right - 1, height - bottom - 1), (180, 110, 45), -1)
    cv2.rectangle(image, (left, top), (width - right - 1, height - bottom - 1), (245, 245, 245), 4)
    return image


def test_centered_card_reports_near_even_ratios() -> None:
    result = assess_centering(synthetic_card())
    assert result.centering_lr in {"45/55", "50/50", "55/45"}
    assert result.centering_tb in {"45/55", "50/50", "55/45"}
    assert 8.5 <= result.estimated_centering_score <= 10.0
    assert 0.0 <= result.confidence <= 1.0


def test_shifted_frame_reduces_centering_score() -> None:
    centered = assess_centering(synthetic_card())
    shifted = assess_centering(synthetic_card(left=70, right=20, top=75, bottom=25))
    assert shifted.estimated_centering_score < centered.estimated_centering_score
    assert shifted.left_border_px > shifted.right_border_px
    assert shifted.top_border_px > shifted.bottom_border_px
