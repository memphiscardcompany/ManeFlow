from __future__ import annotations

from typing import Any

import httpx

from app.core.config import settings
from app.models.schemas import PredictedCard
from app.services.pricing_engine import calculate_pricing


class CompsService:
    def __init__(self) -> None:
        self._base_url = settings.maneflow_core_url.rstrip("/")
        self._token = settings.maneflow_service_token
        self._timeout = max(2.0, float(settings.maneflow_core_timeout_seconds))

    @property
    def configured(self) -> bool:
        return bool(self._base_url and self._token)

    async def pricing_for_card(self, card: PredictedCard | None) -> dict[str, Any]:
        if card is None or not self.configured:
            result = calculate_pricing([]).to_dict()
            result["explanation"] = (
                "The canonical ManeFlow pricing service is not configured; no value was fabricated."
                if not self.configured
                else "No card identity was supplied to the pricing service."
            )
            return result

        payload = {
            "cardId": str(card.card_id) if card.card_id else None,
            "predictedCard": card.model_dump(mode="json"),
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(
                    f"{self._base_url}/api/internal/card-pricing",
                    headers={"authorization": f"Bearer {self._token}"},
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            result = calculate_pricing([]).to_dict()
            result["explanation"] = (
                f"The canonical pricing service could not be reached safely ({type(exc).__name__}); "
                "no price was fabricated."
            )
            return result

        required = {
            "pricing_status",
            "value_low",
            "value_mid",
            "value_high",
            "confidence_score",
            "recommended_cash_offer_low",
            "recommended_cash_offer_high",
            "recommended_list_price",
            "comps_used",
            "outliers_removed",
            "explanation",
        }
        if not isinstance(data, dict) or not required.issubset(data):
            result = calculate_pricing([]).to_dict()
            result["explanation"] = "The canonical pricing service returned an invalid contract; no price was fabricated."
            return result
        return {key: data[key] for key in required}


comps_service = CompsService()
