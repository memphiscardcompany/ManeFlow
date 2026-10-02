from io import BytesIO

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.main import app

AUTH_HEADERS = {"Authorization": "Bearer test-maneflow-service-token"}
client = TestClient(app, headers=AUTH_HEADERS)


def _jpeg_bytes() -> bytes:
    image = np.full((900, 1300, 3), 30, dtype=np.uint8)
    rng = np.random.default_rng(2026)
    for index, x in enumerate((80, 430, 780)):
        x2, y1, y2 = x + 280, 100, 500
        height, width = y2 - y1, x2 - x
        yy, xx = np.mgrid[0:height, 0:width]
        card = np.empty((height, width, 3), dtype=np.float32)
        card[:, :, 0] = 35 + (xx / (width - 1)) * 170 + index * 8
        card[:, :, 1] = 60 + (yy / (height - 1)) * 150
        card[:, :, 2] = 210 - (xx / (width - 1)) * 120
        card += rng.normal(0, 18, size=card.shape)
        image[y1:y2, x:x2] = np.clip(card, 0, 255).astype(np.uint8)
        cv2.rectangle(image, (x, y1), (x2, y2), (250, 250, 250), 8)
        cv2.rectangle(image, (x + 18, y1 + 20), (x2 - 18, y2 - 20), (15, 15, 15), 4)
        cv2.circle(image, (x + width // 2, y1 + 170), 75, (40 + index * 25, 165, 230), -1)
        cv2.putText(image, f"CARD {index + 1}", (x + 45, y2 - 55), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 3)
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok
    return encoded.tobytes()


def test_lot_endpoint_returns_detected_items_without_fake_prices(tmp_path, monkeypatch):
    response = client.post(
        "/v1/lots/analyze",
        files=[("images", ("spread.jpg", BytesIO(_jpeg_bytes()), "image/jpeg"))],
        data={"listing_price": "125", "inbound_shipping": "12"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["physical_item_count"] >= 3
    assert payload["economics"]["pricing_status"] == "unpriced"
    assert payload["economics"]["expected_profit"] is None
    assert all(
        item["identity_confidence"] == 0
        for source in payload["images"]
        for item in source["detections"]
    )
