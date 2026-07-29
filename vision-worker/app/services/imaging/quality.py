from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class QualityResult:
    width: int
    height: int
    blur_score: float
    glare_fraction: float
    brightness: float
    quality_score: int
    warnings: list[str]

    def to_dict(self) -> dict:
        return self.__dict__.copy()


def analyze_image_quality(image: np.ndarray) -> QualityResult:
    if image is None or image.size == 0:
        raise ValueError("Image is empty.")

    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

    blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(gray.mean())
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    glare_mask = (value >= 245) & (saturation <= 45)
    glare_fraction = float(glare_mask.mean())

    score = 100.0
    warnings: list[str] = []

    if min(width, height) < 700:
        score -= 18
        warnings.append("Low resolution may hide card numbers, serials, or parallel details.")
    if blur_score < 55:
        score -= 30
        warnings.append("Image is blurry; hold the camera steady or rescan.")
    elif blur_score < 110:
        score -= 12
        warnings.append("Image is slightly soft; small print may be unreliable.")
    if glare_fraction > 0.12:
        score -= 28
        warnings.append("Heavy glare may obscure foil, labels, or card text.")
    elif glare_fraction > 0.05:
        score -= 12
        warnings.append("Some glare is present; tilt the card or diffuse the light.")
    if brightness < 55:
        score -= 20
        warnings.append("Image is too dark.")
    elif brightness > 220:
        score -= 15
        warnings.append("Image is overexposed.")

    return QualityResult(
        width=width,
        height=height,
        blur_score=round(blur_score, 2),
        glare_fraction=round(glare_fraction, 4),
        brightness=round(brightness, 2),
        quality_score=max(0, min(100, int(round(score)))),
        warnings=warnings,
    )
