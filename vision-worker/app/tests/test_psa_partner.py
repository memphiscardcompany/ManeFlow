from app.services.psa_client import PSAClient


def test_psa_nested_response_normalizes_to_card():
    payload = {
        "IsValidRequest": True,
        "ServerMessage": "Request Successful",
        "Cert": {
            "CertNumber": "12345678",
            "Year": "2018",
            "Subject": "Shohei Ohtani",
            "Brand": "Topps Update",
            "CardNumber": "US1",
            "CardGrade": "10",
            "CardDescription": "2018 Topps Update",
        },
    }
    normalized = PSAClient.normalize(payload)
    card = PSAClient.to_card(normalized)
    assert normalized["verified"] is True
    assert card.player_name == "Shohei Ohtani"
    assert card.cert_number == "12345678"
    assert card.card_number == "US1"
    assert card.grade == "10"


def test_psa_cert_validation_is_conservative():
    assert PSAClient._clean_cert("12-345-678") == "12345678"

import importlib
import pytest
from app.core.config import settings
from app.models.schemas import PredictedCard
from app.services.identity_engine import IdentityEngine, IdentityResult


@pytest.mark.asyncio
async def test_identity_result_is_enriched_by_verified_psa_cert(monkeypatch):
    engine = IdentityEngine()
    original = settings.psa_api_key
    settings.psa_api_key = "test-partner-key"
    identity_module = importlib.import_module("app.services.identity_engine")

    async def fake_verify(cert):
        assert cert == "12345678"
        return {
            "verified": True,
            "card": PredictedCard(
                year=2018,
                brand="Topps Update",
                set_name="2018 Topps Update",
                player_name="Shohei Ohtani",
                card_number="US1",
                grader="PSA",
                grade="10",
                cert_number="12345678",
            ).model_dump(mode="json"),
        }

    monkeypatch.setattr(identity_module.psa_client, "verify", fake_verify)
    result = IdentityResult(
        card=PredictedCard(),
        identity_confidence=0.0,
        variant_confidence=0.0,
        provider="unconfigured",
        processed_remotely=False,
        is_trading_card=None,
        barcode_values=["https://www.psacard.com/cert/12345678"],
    )
    try:
        enriched = await engine._enrich_with_psa(result)
    finally:
        settings.psa_api_key = original
    assert enriched.card.player_name == "Shohei Ohtani"
    assert enriched.card.grade == "10"
    assert enriched.identity_confidence >= 0.995
    assert "psa_partner_verified" in enriched.provider
