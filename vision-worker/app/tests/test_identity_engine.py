from app.models.schemas import PredictedCard
from app.services.identity_engine import IdentityEngine, IdentityResult, OpenAIVisionIdentityProvider


def test_unconfigured_identity_engine_abstains_and_ignores_filename():
    engine = IdentityEngine()
    result = __import__("asyncio").run(
        engine.identify(b"not-used", "2018 Topps Famous Player PSA 10.jpg")
    )
    assert result.card == PredictedCard()
    assert result.identity_confidence == 0
    assert result.variant_confidence == 0
    assert result.processed_remotely is False
    assert result.provider == "unconfigured"


def test_prompt_forbids_face_based_identification():
    prompt = OpenAIVisionIdentityProvider.SYSTEM_PROMPT.lower()
    assert "do not identify any person from facial appearance" in prompt
    assert "never invent" in prompt


def test_provider_error_fails_safe():
    class BrokenProvider:
        async def identify(self, image_bytes, *, media_type, barcode_values):
            raise TimeoutError("provider unavailable")

    engine = IdentityEngine(provider=BrokenProvider())
    result = __import__("asyncio").run(engine.identify(b"image", "IMG_0001.jpg"))
    assert result.identity_confidence == 0
    assert result.provider == "provider_error"
    assert any("failed safely" in warning for warning in result.warnings)


def test_injected_provider_result_is_preserved():
    class FakeProvider:
        async def identify(self, image_bytes, *, media_type, barcode_values):
            return IdentityResult(
                card=PredictedCard(year=2025, card_number="US1"),
                identity_confidence=0.91,
                variant_confidence=0.72,
                provider="fake",
                processed_remotely=False,
                is_trading_card=True,
                needs_back_image=True,
                barcode_values=barcode_values,
            )

    result = __import__("asyncio").run(
        IdentityEngine(provider=FakeProvider()).identify(
            b"image", "random-uuid.jpeg", barcode_values=["12345678"]
        )
    )
    assert result.card.card_number == "US1"
    assert result.identity_confidence == 0.91
    assert result.barcode_values == ["12345678"]


def test_front_back_pair_merges_agreeing_evidence_and_boosts_confidence():
    class PairProvider:
        async def identify(self, image_bytes, *, media_type, barcode_values):
            if image_bytes == b"front":
                return IdentityResult(
                    card=PredictedCard(player_name="Shohei Ohtani", year=2018, brand="Topps"),
                    identity_confidence=0.88,
                    variant_confidence=0.66,
                    provider="fake-front",
                    processed_remotely=False,
                    is_trading_card=True,
                    card_side="front",
                    needs_back_image=True,
                    barcode_values=barcode_values,
                )
            return IdentityResult(
                card=PredictedCard(player_name="Shohei Ohtani", year=2018, card_number="US1"),
                identity_confidence=0.90,
                variant_confidence=0.78,
                provider="fake-back",
                processed_remotely=False,
                is_trading_card=True,
                card_side="back",
                needs_back_image=False,
                barcode_values=barcode_values,
            )

    result = __import__("asyncio").run(
        IdentityEngine(provider=PairProvider()).identify_pair(b"front", b"back")
    )
    assert result.card.player_name == "Shohei Ohtani"
    assert result.card.brand == "Topps"
    assert result.card.card_number == "US1"
    assert result.identity_confidence > 0.90
    assert any("agreed" in warning.lower() for warning in result.warnings)


def test_front_back_pair_conflict_forces_manual_confidence():
    class ConflictProvider:
        async def identify(self, image_bytes, *, media_type, barcode_values):
            player = "Player A" if image_bytes == b"front" else "Player B"
            return IdentityResult(
                card=PredictedCard(player_name=player, year=2026),
                identity_confidence=0.97,
                variant_confidence=0.91,
                provider="fake",
                processed_remotely=False,
                is_trading_card=True,
                card_side="front" if image_bytes == b"front" else "back",
                needs_back_image=False,
                barcode_values=barcode_values,
            )

    result = __import__("asyncio").run(
        IdentityEngine(provider=ConflictProvider()).identify_pair(b"front", b"back")
    )
    assert result.identity_confidence <= 0.74
    assert result.variant_confidence <= 0.48
    assert result.needs_back_image is True
    assert any("conflicts" in warning.lower() for warning in result.warnings)
