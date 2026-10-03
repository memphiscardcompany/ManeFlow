from io import BytesIO

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.models.schemas import PredictedCard
from app.services.identity_engine import IdentityResult, identity_engine
from app.services.comps import comps_service
from app.services.pricing_engine import calculate_pricing

AUTH_HEADERS = {"Authorization": "Bearer test-maneflow-service-token"}
client = TestClient(app, headers=AUTH_HEADERS)


def _single_card_jpeg() -> bytes:
    image = np.full((1200, 900, 3), 30, dtype=np.uint8)
    rng = np.random.default_rng(1234)
    y1, y2, x1, x2 = 110, 870, 180, 720
    height, width = y2 - y1, x2 - x1
    yy, xx = np.mgrid[0:height, 0:width]
    card = np.empty((height, width, 3), dtype=np.float32)
    card[:, :, 0] = 30 + (xx / (width - 1)) * 180
    card[:, :, 1] = 55 + (yy / (height - 1)) * 170
    card[:, :, 2] = 220 - (xx / (width - 1)) * 130
    card += rng.normal(0, 19, size=card.shape)
    image[y1:y2, x1:x2] = np.clip(card, 0, 255).astype(np.uint8)
    cv2.rectangle(image, (x1, y1), (x2, y2), (250, 250, 250), 10)
    cv2.rectangle(image, (x1 + 24, y1 + 28), (x2 - 24, y2 - 28), (12, 12, 12), 5)
    cv2.circle(image, (450, 400), 170, (35, 175, 235), -1)
    cv2.putText(image, "CARD 123", (280, 760), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (255, 255, 255), 4)
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok
    return encoded.tobytes()


def test_single_scan_detects_object_but_does_not_invent_identity_or_price():
    response = client.post(
        "/v1/scan",
        files={"image": ("IMG_1234.jpeg", BytesIO(_single_card_jpeg()), "image/jpeg")},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["detected_object_count"] >= 1
    assert len(payload["detected_cards"]) == payload["detected_object_count"]
    assert payload["detected_cards"][0]["identity_provider"] == "unconfigured"
    assert payload["identity_provider"] == "unconfigured"
    assert payload["identity_confidence"] == 0
    assert payload["predicted_card"]["player_name"] is None
    assert payload["pricing_status"] == "price_unverifiable"
    assert payload["needs_manual_confirmation"] is True
    assert payload["image_processed_remotely"] is False


def test_scan_rejects_undecodable_payload():
    response = client.post(
        "/v1/scan",
        files={"image": ("broken.jpg", BytesIO(b"not-an-image"), "image/jpeg")},
    )
    assert response.status_code == 400


def test_provider_confidence_without_canonical_card_id_cannot_trigger_pricing(monkeypatch):
    priced_cards = []

    async def identify_candidate(*_args, **_kwargs):
        return IdentityResult(
            card=PredictedCard(player_name="Candidate", year=2024, brand="Topps", card_number="1"),
            identity_confidence=0.99,
            variant_confidence=0.99,
            provider="test-provider",
            processed_remotely=False,
            is_trading_card=True,
            needs_back_image=False,
        )

    async def no_enrichment(result):
        return result

    async def record_pricing(card):
        priced_cards.append(card)
        return calculate_pricing([]).to_dict()

    monkeypatch.setattr(identity_engine, "identify", identify_candidate)
    monkeypatch.setattr(identity_engine, "_enrich_with_psa", no_enrichment)
    monkeypatch.setattr(comps_service, "pricing_for_card", record_pricing)
    response = client.post(
        "/v1/scan",
        files={"image": ("candidate.jpg", BytesIO(_single_card_jpeg()), "image/jpeg")},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert priced_cards and all(card is None for card in priced_cards)
    assert payload["needs_manual_confirmation"] is True
    assert all(card["needs_manual_confirmation"] for card in payload["detected_cards"])
