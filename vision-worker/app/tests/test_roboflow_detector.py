from __future__ import annotations

import numpy as np
import pytest

from app.services.imaging.roboflow_detector import RoboflowCardDetector, RoboflowDetectorError


def test_roboflow_instance_segmentation_response_is_normalized_to_card_detection():
    image = np.full((600, 400, 3), 220, dtype=np.uint8)

    def request(encoded_image: str):
        assert len(encoded_image) > 100
        return {
            "predictions": [
                {
                    "x": 200,
                    "y": 300,
                    "width": 240,
                    "height": 420,
                    "confidence": 0.97,
                    "class": "graded_slab",
                    "points": [
                        {"x": 80, "y": 90},
                        {"x": 320, "y": 90},
                        {"x": 320, "y": 510},
                        {"x": 80, "y": 510},
                    ],
                }
            ]
        }

    detector = RoboflowCardDetector(
        endpoint="test://roboflow",
        api_key="test-key",
        model_name="maneflow-test-v1",
        request=request,
    )
    detections = detector.detect(image)

    assert len(detections) == 1
    detection = detections[0]
    assert detection.kind_hint == "slab"
    assert detection.confidence == 0.97
    assert detection.detector_name == "roboflow:maneflow-test-v1"
    assert detection.crop.shape[0] > detection.crop.shape[1]
    assert detection.area_fraction > 0.30


def test_roboflow_detector_rejects_invalid_prediction_shape():
    image = np.full((200, 200, 3), 255, dtype=np.uint8)
    detector = RoboflowCardDetector(
        endpoint="test://roboflow",
        request=lambda _: {"predictions": [{"confidence": 0.9, "class": "raw_card"}]},
    )

    with pytest.raises(RoboflowDetectorError, match="not numeric"):
        detector.detect(image)


def test_roboflow_detector_requires_hosted_api_key():
    with pytest.raises(RoboflowDetectorError, match="ROBOFLOW_API_KEY"):
        RoboflowCardDetector(endpoint="https://outline.roboflow.com/project/1", api_key="")
