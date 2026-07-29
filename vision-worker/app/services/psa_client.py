from __future__ import annotations

import re
from typing import Any

import httpx

from app.core.config import settings
from app.models.schemas import PredictedCard


class PSAClient:
    DEFAULT_BASE_URL = "https://api.psacard.com/publicapi/cert/GetByCertNumber"

    @staticmethod
    def _clean_cert(cert_number: str) -> str:
        cert = re.sub(r"\D", "", cert_number or "")
        if not 6 <= len(cert) <= 12:
            raise ValueError("Enter a valid numeric PSA certification number.")
        return cert

    @staticmethod
    def _flatten(value: Any, prefix: str = "", output: dict[str, str] | None = None, depth: int = 0) -> dict[str, str]:
        if output is None:
            output = {}
        if depth > 9 or value is None:
            return output
        if isinstance(value, list):
            for index, item in enumerate(value):
                PSAClient._flatten(item, f"{prefix}[{index}]", output, depth + 1)
            return output
        if isinstance(value, dict):
            for key, item in value.items():
                next_key = f"{prefix}.{key}" if prefix else str(key)
                PSAClient._flatten(item, next_key, output, depth + 1)
            return output
        output[prefix.lower()] = str(value).strip()
        return output

    @staticmethod
    def _pick(flat: dict[str, str], *suffixes: str) -> str:
        for suffix in suffixes:
            target = suffix.lower()
            for key, value in flat.items():
                if value and key.endswith(target):
                    return value
        return ""

    @classmethod
    def normalize(cls, payload: dict) -> dict:
        flat = cls._flatten(payload)
        valid_raw = cls._pick(flat, "isvalidrequest")
        message = cls._pick(flat, "servermessage", "message")
        valid = str(valid_raw).lower() in {"true", "1", "yes"}
        if not valid_raw:
            valid = "successful" in message.lower() or bool(cls._pick(flat, "certnumber", "certificationnumber"))
        return {
            "verified": valid and "invalid" not in message.lower(),
            "message": message,
            "cert_number": cls._pick(flat, "certnumber", "certificationnumber", "certificatenumber", ".cert"),
            "year": cls._pick(flat, "cardyear", ".year"),
            "subject": cls._pick(flat, "subject", "subjectname", "player", "playername"),
            "brand": cls._pick(flat, "brand", "manufacturer"),
            "set_name": cls._pick(flat, "setname", "cardset", "set", "specdescription", "carddescription", "description"),
            "card_number": cls._pick(flat, "cardnumber", "specnumber"),
            "variety": cls._pick(flat, "variety", "parallel", "variation"),
            "grade": cls._pick(flat, "cardgrade", "grade", "gradedescription"),
            "category": cls._pick(flat, "category", "sport"),
        }

    @staticmethod
    def _year(value: str) -> int | None:
        match = re.search(r"\b(18|19|20)\d{2}\b", value or "")
        return int(match.group(0)) if match else None

    @classmethod
    def to_card(cls, normalized: dict) -> PredictedCard:
        set_name = normalized.get("set_name") or None
        return PredictedCard(
            year=cls._year(str(normalized.get("year") or set_name or "")),
            brand=normalized.get("brand") or None,
            set_name=set_name,
            player_name=normalized.get("subject") or None,
            sport=normalized.get("category") or None,
            card_number=normalized.get("card_number") or None,
            parallel=normalized.get("variety") or None,
            grader="PSA",
            grade=normalized.get("grade") or None,
            cert_number=normalized.get("cert_number") or None,
        )

    async def verify(self, cert_number: str) -> dict:
        cert = self._clean_cert(cert_number)
        token = settings.effective_psa_api_key
        if not token:
            raise RuntimeError("PSA partner access is not configured in ManeFlow Settings.")

        base_url = (settings.psa_api_base_url or self.DEFAULT_BASE_URL).rstrip("/")
        scheme = (settings.psa_auth_scheme or "bearer").strip()
        headers = {"Authorization": f"{scheme} {token}".strip(), "Accept": "application/json", "User-Agent": "ManeFlow/2.18"}
        async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as client:
            response = await client.get(f"{base_url}/{cert}", headers=headers)
        if response.status_code == 204:
            return {"cert_number": cert, "verified": False, "message": "PSA returned no cert data.", "normalized": {}, "raw": None}
        if response.status_code in {401, 403}:
            raise RuntimeError("PSA rejected the saved credential. Rotate or re-enter the partner key in ManeFlow Settings.")
        if response.status_code >= 400:
            raise RuntimeError(f"PSA verification failed with HTTP {response.status_code}.")
        payload = response.json()
        normalized = self.normalize(payload)
        normalized["cert_number"] = normalized.get("cert_number") or cert
        return {
            "cert_number": cert,
            "verified": bool(normalized.get("verified")),
            "message": normalized.get("message") or ("Verified" if normalized.get("verified") else "No data found"),
            "normalized": normalized,
            "card": self.to_card(normalized).model_dump(mode="json"),
            "raw": payload,
        }

    async def health(self) -> dict:
        return {
            "configured": bool(settings.effective_psa_api_key),
            "base_url": settings.psa_api_base_url or self.DEFAULT_BASE_URL,
            "auth_scheme": settings.psa_auth_scheme or "bearer",
        }


psa_client = PSAClient()
