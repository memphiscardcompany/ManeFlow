import cv2
import numpy as np

from app.services.imaging.surface_classifier import analyze_surface


def test_surface_classifier_returns_typed_conservative_result() -> None:
    image = np.full((700, 500, 3), 90, dtype=np.uint8)
    cv2.rectangle(image, (30, 40), (470, 660), (120, 120, 120), 12)
    result = analyze_surface(image)
    assert result.detected_surface_type == "BASE"
    assert 0.0 <= result.refractor_confidence <= 1.0
    assert result.high_reflectivity_patches >= 0


def test_holographic_gradient_increases_rainbow_signal() -> None:
    height, width = 700, 500
    plain = np.full((height, width, 3), 80, dtype=np.uint8)
    holo = np.zeros((height, width, 3), dtype=np.uint8)
    for x in range(width):
        hue = int((x / max(1, width - 1)) * 179)
        holo[:, x] = cv2.cvtColor(np.uint8([[[hue, 220, 235]]]), cv2.COLOR_HSV2BGR)[0, 0]
    for y in range(0, height, 12):
        cv2.line(holo, (0, y), (width - 1, min(height - 1, y + 60)), (255, 255, 255), 2)
    plain_result = analyze_surface(plain)
    holo_result = analyze_surface(holo)
    assert holo_result.rainbow_variance >= plain_result.rainbow_variance
