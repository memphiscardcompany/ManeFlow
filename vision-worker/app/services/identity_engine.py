from __future__ import annotations

import base64
import re
from dataclasses import dataclass, field
from typing import Literal, Protocol

from pydantic import BaseModel, Field

from app.core.config import settings
from app.models.schemas import PredictedCard
from app.services.reference_matcher import reference_matcher
from app.services.psa_client import psa_client
from app.services.imaging.barcode import extract_numeric_cert_candidates


class VisionCardExtraction(BaseModel):
    """Strict extraction contract for a single normalized card/slab crop."""

    is_trading_card: bool = False
    card_side: Literal["front", "back", "unknown"] = "unknown"
    is_graded: bool = False
    sport_or_game: str | None = None
    year: int | None = None
    manufacturer: str | None = None
    brand: str | None = None
    set_name: str | None = None
    insert_name: str | None = None
    player_name: str | None = None
    team: str | None = None
    card_number: str | None = None
    parallel: str | None = None
    serial_number: str | None = None
    rookie: bool | None = None
    autograph: bool | None = None
    memorabilia: bool | None = None
    language: str | None = None
    grader: str | None = None
    grade: str | None = None
    cert_number: str | None = None
    visible_text: list[str] = Field(default_factory=list)
    identity_confidence: float = Field(default=0.0, ge=0, le=1)
    variant_confidence: float = Field(default=0.0, ge=0, le=1)
    needs_back_image: bool = True
    warnings: list[str] = Field(default_factory=list)


@dataclass(frozen=True)
class IdentityResult:
    card: PredictedCard
    identity_confidence: float
    variant_confidence: float
    provider: str
    processed_remotely: bool
    is_trading_card: bool | None
    card_side: str = "unknown"
    needs_back_image: bool = True
    visible_text: list[str] = field(default_factory=list)
    barcode_values: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class IdentityProvider(Protocol):
    async def identify(
        self,
        image_bytes: bytes,
        *,
        media_type: str,
        barcode_values: list[str],
    ) -> IdentityResult: ...


class OpenAIVisionIdentityProvider:
    """Optional structured vision adapter. It is never initialized in frontend code."""

    SYSTEM_PROMPT = """
You extract trading-card metadata from one normalized card or graded-slab image.
Return only evidence visible in the card design, printed text, logos, card number,
copyright line, serial stamp, autograph/memorabilia markings, or grading label.

Important rules:
- Do not identify any person from facial appearance or biometric similarity.
- A player name may be returned only when it is visibly printed, read from a
  grading label, or unambiguously established by non-biometric card metadata.
- Never invent a year, set, parallel, card number, grade, certification number,
  autograph, serial number, or price.
- Similar artwork is not enough to claim an exact parallel.
- Leave uncertain fields null and lower confidence.
- If this is not a trading card or slab, set is_trading_card=false.
- If a back image is needed to confirm the exact issue or parallel, say so.
""".strip()

    def __init__(self, *, api_key: str, model: str) -> None:
        self.api_key = api_key
        self.model = model

    async def identify(
        self,
        image_bytes: bytes,
        *,
        media_type: str,
        barcode_values: list[str],
    ) -> IdentityResult:
        try:
            from openai import AsyncOpenAI
        except ImportError as exc:  # pragma: no cover - deployment dependency check
            raise RuntimeError("The OpenAI Python package is not installed.") from exc

        encoded = base64.b64encode(image_bytes).decode("ascii")
        barcode_context = (
            "Barcode values decoded locally: " + ", ".join(barcode_values)
            if barcode_values
            else "No barcode was decoded locally."
        )
        client = AsyncOpenAI(api_key=self.api_key)
        response = await client.responses.parse(
            model=self.model,
            input=[
                {"role": "system", "content": self.SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": (
                                "Extract the card fields conservatively. "
                                f"{barcode_context} Do not provide any market price."
                            ),
                        },
                        {
                            "type": "input_image",
                            "image_url": f"data:{media_type};base64,{encoded}",
                            "detail": "high",
                        },
                    ],
                },
            ],
            text_format=VisionCardExtraction,
        )
        parsed = response.output_parsed
        if parsed is None:
            raise RuntimeError("Vision provider returned no structured extraction.")

        card = PredictedCard(
            year=parsed.year,
            brand=parsed.brand or parsed.manufacturer,
            set_name=parsed.set_name,
            insert_name=parsed.insert_name,
            player_name=parsed.player_name,
            team=parsed.team,
            sport=parsed.sport_or_game,
            card_number=parsed.card_number,
            parallel=parsed.parallel,
            serial_number=parsed.serial_number,
            rookie=parsed.rookie,
            autograph=parsed.autograph,
            memorabilia=parsed.memorabilia,
            language=parsed.language,
            grader=parsed.grader,
            grade=parsed.grade,
            cert_number=parsed.cert_number,
        )
        warnings = list(parsed.warnings)
        if not parsed.is_trading_card:
            warnings.append("The visual provider did not classify this crop as a trading card.")
            card = PredictedCard()

        return IdentityResult(
            card=card,
            identity_confidence=round(parsed.identity_confidence, 4),
            variant_confidence=round(parsed.variant_confidence, 4),
            provider=f"openai:{self.model}",
            processed_remotely=True,
            is_trading_card=parsed.is_trading_card,
            card_side=parsed.card_side,
            needs_back_image=parsed.needs_back_image,
            visible_text=parsed.visible_text,
            barcode_values=barcode_values,
            warnings=warnings,
        )


class IdentityEngine:
    """
    Safe provider router for the production identity pipeline:
    detector -> crop -> barcode/OCR/vision extraction -> SQL/pgvector candidates
    -> reranking -> cert verification.

    Filenames are accepted for API compatibility but are never identity evidence.
    """

    def __init__(self, provider: IdentityProvider | None = None) -> None:
        self._provider = provider

    @staticmethod
    def _psa_cert_candidate(card: PredictedCard, barcode_values: list[str]) -> str | None:
        if card.cert_number and (str(card.grader or "").upper() == "PSA" or not card.grader):
            cert = "".join(ch for ch in str(card.cert_number) if ch.isdigit())
            if 6 <= len(cert) <= 12:
                return cert
        psa_values = [value for value in barcode_values if re.search(r"psa|psacard|cert", value, re.I)]
        candidates = extract_numeric_cert_candidates(psa_values)
        return candidates[0] if candidates else None

    @staticmethod
    def _merge_psa_card(base: PredictedCard, verified: PredictedCard) -> PredictedCard:
        base_data = base.model_dump()
        psa_data = verified.model_dump()
        authoritative = {"year", "brand", "set_name", "player_name", "sport", "card_number", "parallel", "grader", "grade", "cert_number"}
        merged = {}
        for key in PredictedCard.model_fields:
            psa_value = psa_data.get(key)
            base_value = base_data.get(key)
            merged[key] = psa_value if key in authoritative and psa_value not in (None, "") else base_value
        return PredictedCard.model_validate(merged)

    async def _enrich_with_psa(self, result: IdentityResult) -> IdentityResult:
        if not settings.effective_psa_api_key:
            return result
        cert = self._psa_cert_candidate(result.card, result.barcode_values)
        if not cert:
            return result
        try:
            verification = await psa_client.verify(cert)
        except Exception as exc:
            return IdentityResult(**{**result.__dict__, "warnings": result.warnings + [f"PSA cert verification failed safely: {type(exc).__name__}."]})
        if not verification.get("verified") or not verification.get("card"):
            return IdentityResult(**{**result.__dict__, "warnings": result.warnings + ["PSA did not verify the decoded certification number."]})
        psa_card = PredictedCard.model_validate(verification["card"])
        return IdentityResult(
            card=self._merge_psa_card(result.card, psa_card),
            identity_confidence=max(result.identity_confidence, 0.995),
            variant_confidence=max(result.variant_confidence, 0.97),
            provider=f"{result.provider}+psa_partner_verified",
            processed_remotely=True,
            is_trading_card=True,
            card_side=result.card_side,
            needs_back_image=False,
            visible_text=result.visible_text,
            barcode_values=result.barcode_values,
            warnings=result.warnings + [f"PSA partner API verified certification {cert}."],
        )

    def _configured_provider(self) -> IdentityProvider | None:
        if self._provider is not None:
            return self._provider
        if settings.openai_api_key and settings.openai_vision_model:
            return OpenAIVisionIdentityProvider(
                api_key=settings.openai_api_key,
                model=settings.openai_vision_model,
            )
        return None

    @staticmethod
    def unavailable_result(barcode_values: list[str] | None = None) -> IdentityResult:
        values = barcode_values or []
        warnings = [
            "Card object was accepted but no configured identity provider analyzed it.",
            "Exact player, set, parallel, grade, and certification require visual/OCR/cert evidence.",
        ]
        if values:
            warnings.append(
                "A barcode was decoded, but it was not treated as verified card identity without cert lookup."
            )
        return IdentityResult(
            card=PredictedCard(),
            identity_confidence=0.0,
            variant_confidence=0.0,
            provider="unconfigured",
            processed_remotely=False,
            is_trading_card=None,
            needs_back_image=True,
            barcode_values=values,
            warnings=warnings,
        )

    @staticmethod
    def _merge_pair_results(front: IdentityResult, back: IdentityResult) -> IdentityResult:
        front_card = front.card.model_dump()
        back_card = back.card.model_dump()
        comparison_keys = [
            "player_name", "year", "brand", "set_name", "card_number",
            "parallel", "serial_number", "grader", "grade", "cert_number",
        ]
        agreements: list[str] = []
        conflicts: list[str] = []
        for key in comparison_keys:
            front_value = front_card.get(key)
            back_value = back_card.get(key)
            if front_value in (None, "") or back_value in (None, ""):
                continue
            if str(front_value).strip().lower() == str(back_value).strip().lower():
                agreements.append(key)
            else:
                conflicts.append(key)

        merged = {
            key: front_card.get(key) if front_card.get(key) not in (None, "") else back_card.get(key)
            for key in PredictedCard.model_fields
        }
        base_identity = max(front.identity_confidence, back.identity_confidence)
        base_variant = max(front.variant_confidence, back.variant_confidence)
        warnings = list(dict.fromkeys(front.warnings + back.warnings))

        if conflicts:
            identity_confidence = round(min(base_identity, 0.74), 4)
            variant_confidence = round(min(base_variant, 0.48), 4)
            warnings.append(
                "Front/back evidence conflicts on: " + ", ".join(conflicts) + ". Manual review is required."
            )
            needs_back_image = True
        else:
            agreement_boost = min(0.08, len(agreements) * 0.015)
            identity_confidence = round(min(0.995, base_identity + agreement_boost), 4)
            variant_confidence = round(
                min(0.97, base_variant + min(0.07, len(agreements) * 0.012)),
                4,
            )
            needs_back_image = (
                not any(back_card.get(key) not in (None, "") for key in comparison_keys)
                or variant_confidence < 0.85
            )
            if agreements:
                warnings.append(
                    "Front/back evidence agreed on: " + ", ".join(agreements) + "."
                )

        return IdentityResult(
            card=PredictedCard.model_validate(merged),
            identity_confidence=identity_confidence,
            variant_confidence=variant_confidence,
            provider=f"front[{front.provider}]+back[{back.provider}]",
            processed_remotely=front.processed_remotely or back.processed_remotely,
            is_trading_card=(front.is_trading_card is True or back.is_trading_card is True),
            card_side="front",
            needs_back_image=needs_back_image,
            visible_text=list(dict.fromkeys(front.visible_text + back.visible_text)),
            barcode_values=list(dict.fromkeys(front.barcode_values + back.barcode_values)),
            warnings=warnings,
        )

    async def identify_pair(
        self,
        front_bytes: bytes,
        back_bytes: bytes | None = None,
        *,
        front_media_type: str = "image/jpeg",
        back_media_type: str = "image/jpeg",
        front_barcode_values: list[str] | None = None,
        back_barcode_values: list[str] | None = None,
    ) -> IdentityResult:
        front = await self.identify(
            front_bytes,
            media_type=front_media_type,
            barcode_values=front_barcode_values or [],
        )
        if not back_bytes:
            return await self._enrich_with_psa(front)
        back = await self.identify(
            back_bytes,
            media_type=back_media_type,
            barcode_values=back_barcode_values or [],
        )
        return await self._enrich_with_psa(self._merge_pair_results(front, back))

    async def identify(
        self,
        image_bytes: bytes,
        filename: str | None = None,
        *,
        media_type: str = "image/jpeg",
        barcode_values: list[str] | None = None,
    ) -> IdentityResult:
        del filename  # Generic camera/UUID filenames must never influence identity.
        values = barcode_values or []
        local_reference = reference_matcher.match(image_bytes)
        provider = self._configured_provider()
        if provider is None:
            if local_reference is not None:
                return IdentityResult(
                    card=local_reference.card,
                    identity_confidence=local_reference.identity_confidence,
                    variant_confidence=local_reference.variant_confidence,
                    provider=f"in_house_reference:{local_reference.method}",
                    processed_remotely=False,
                    is_trading_card=True,
                    card_side=local_reference.card_side,
                    needs_back_image=local_reference.card_side != "back" or local_reference.variant_confidence < 0.85,
                    barcode_values=values,
                    warnings=local_reference.warnings,
                )
            return self.unavailable_result(values)

        try:
            provider_result = await provider.identify(
                image_bytes,
                media_type=media_type,
                barcode_values=values,
            )
            if local_reference is None:
                return provider_result

            provider_card = provider_result.card.model_dump()
            local_card = local_reference.card.model_dump()
            comparison_keys = ["player_name", "year", "brand", "set_name", "card_number", "parallel", "cert_number"]
            agreements = sum(
                1 for key in comparison_keys
                if provider_card.get(key) not in (None, "")
                and local_card.get(key) not in (None, "")
                and str(provider_card[key]).strip().lower() == str(local_card[key]).strip().lower()
            )
            conflicts = [
                key for key in comparison_keys
                if provider_card.get(key) not in (None, "")
                and local_card.get(key) not in (None, "")
                and str(provider_card[key]).strip().lower() != str(local_card[key]).strip().lower()
            ]
            if conflicts:
                conflicted_card = provider_result.card.model_copy()
                conflicted_card.card_id = None
                return IdentityResult(
                    card=conflicted_card,
                    identity_confidence=min(provider_result.identity_confidence, 0.74),
                    variant_confidence=min(provider_result.variant_confidence, 0.48),
                    provider=f"{provider_result.provider}+in_house_reference_conflict",
                    processed_remotely=provider_result.processed_remotely,
                    is_trading_card=provider_result.is_trading_card,
                    card_side=provider_result.card_side if provider_result.card_side != "unknown" else local_reference.card_side,
                    needs_back_image=True,
                    visible_text=provider_result.visible_text,
                    barcode_values=values,
                    warnings=provider_result.warnings + local_reference.warnings + [
                        "The live vision result conflicts with an in-house reference on: " + ", ".join(conflicts) + ". Manual review is required."
                    ],
                )

            merged = {
                key: provider_card.get(key) if provider_card.get(key) not in (None, "") else local_card.get(key)
                for key in PredictedCard.model_fields
            }
            boost = 0.03 if agreements >= 3 else 0.0
            return IdentityResult(
                card=PredictedCard.model_validate(merged),
                identity_confidence=min(0.995, max(provider_result.identity_confidence, local_reference.identity_confidence) + boost),
                variant_confidence=min(0.98, max(provider_result.variant_confidence, local_reference.variant_confidence) + (0.03 if agreements >= 4 else 0.0)),
                provider=f"{provider_result.provider}+in_house_reference",
                processed_remotely=provider_result.processed_remotely,
                is_trading_card=provider_result.is_trading_card,
                card_side=provider_result.card_side if provider_result.card_side != "unknown" else local_reference.card_side,
                needs_back_image=provider_result.needs_back_image and local_reference.variant_confidence < 0.85,
                visible_text=provider_result.visible_text,
                barcode_values=values,
                warnings=provider_result.warnings + local_reference.warnings + [
                    f"Live extraction agreed with {agreements} curated reference field(s)."
                ],
            )
        except Exception as exc:
            fallback = self.unavailable_result(values)
            return IdentityResult(
                **{
                    **fallback.__dict__,
                    "provider": "provider_error",
                    "warnings": fallback.warnings
                    + [f"Identity provider failed safely: {type(exc).__name__}."],
                }
            )


identity_engine = IdentityEngine()
