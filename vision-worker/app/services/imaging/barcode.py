from __future__ import annotations

import re

import cv2
import numpy as np


_CERT_PATTERN = re.compile(r"(?<!\d)(\d{6,10})(?!\d)")


def decode_barcodes(image: np.ndarray) -> list[str]:
    """Decode common 1D/2D slab labels when optional zxing-cpp is installed."""
    if image is None or image.size == 0:
        return []
    try:
        import zxingcpp
    except ImportError:
        return []

    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    results = zxingcpp.read_barcodes(rgb)
    values: list[str] = []
    for result in results:
        text = (getattr(result, "text", "") or "").strip()
        if text and text not in values:
            values.append(text)
    return values


def extract_numeric_cert_candidates(values: list[str]) -> list[str]:
    candidates: list[str] = []
    for value in values:
        for match in _CERT_PATTERN.findall(value):
            normalized = match.lstrip("0") or "0"
            if normalized not in candidates:
                candidates.append(normalized)
    return candidates
