import cv2
import numpy as np

from app.services.imaging.fingerprint import are_near_duplicates, difference_hash, hamming_distance


def test_identical_images_have_zero_distance():
    image = np.zeros((200, 140, 3), dtype=np.uint8)
    cv2.rectangle(image, (20, 20), (120, 180), (255, 255, 255), -1)
    first = difference_hash(image)
    second = difference_hash(image.copy())
    assert hamming_distance(first, second) == 0
    assert are_near_duplicates(first, second)


def test_different_images_are_not_forced_into_same_group():
    left = np.zeros((200, 140, 3), dtype=np.uint8)
    right = np.zeros((200, 140, 3), dtype=np.uint8)
    cv2.rectangle(left, (5, 5), (60, 195), (255, 255, 255), -1)
    cv2.rectangle(right, (80, 5), (135, 195), (255, 255, 255), -1)
    assert hamming_distance(difference_hash(left), difference_hash(right)) > 7
