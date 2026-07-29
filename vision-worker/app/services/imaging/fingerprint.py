from __future__ import annotations

import cv2
import numpy as np


def difference_hash(image: np.ndarray, hash_size: int = 8) -> str:
    if image is None or image.size == 0:
        raise ValueError("Cannot fingerprint an empty image.")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (hash_size + 1, hash_size), interpolation=cv2.INTER_AREA)
    diff = resized[:, 1:] > resized[:, :-1]
    bits = "".join("1" if value else "0" for value in diff.flatten())
    return f"{int(bits, 2):0{hash_size * hash_size // 4}x}"


def hamming_distance(hash_a: str, hash_b: str) -> int:
    if len(hash_a) != len(hash_b):
        raise ValueError("Hashes must have the same length.")
    return (int(hash_a, 16) ^ int(hash_b, 16)).bit_count()


def are_near_duplicates(hash_a: str, hash_b: str, max_distance: int = 8) -> bool:
    return hamming_distance(hash_a, hash_b) <= max_distance
