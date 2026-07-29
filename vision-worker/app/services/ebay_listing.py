from __future__ import annotations

import asyncio
import base64
import re
import time
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qs, urlparse

import httpx

from app.core.config import settings


_EBAY_ITEM_PATTERNS = (
    re.compile(r"/itm/(?:[^/?#]+/)?(?P<id>\d{9,15})(?:[/?#]|$)", re.IGNORECASE),
    re.compile(r"(?:^|[?&])item=(?P<id>\d{9,15})(?:&|$)", re.IGNORECASE),
)


@dataclass(frozen=True)
class EbayListing:
    legacy_item_id: str
    title: str | None
    source_url: str
    listing_price: Decimal
    shipping_price: Decimal
    image_urls: list[str]
    raw_payload: dict


class EbayListingClient:
    TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
    ITEM_URL = "https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id"
    SCOPE = "https://api.ebay.com/oauth/api_scope"

    def __init__(self) -> None:
        self._access_token: str | None = None
        self._token_expires_at = 0.0
        self._token_lock = asyncio.Lock()

    @staticmethod
    def parse_legacy_item_id(value: str) -> str:
        stripped = value.strip()
        if stripped.isdigit() and 9 <= len(stripped) <= 15:
            return stripped
        for pattern in _EBAY_ITEM_PATTERNS:
            match = pattern.search(stripped)
            if match:
                return match.group("id")
        raise ValueError("Could not find an eBay legacy item ID in the supplied URL.")

    @staticmethod
    def _decimal(payload: object, default: Decimal = Decimal("0")) -> Decimal:
        try:
            if isinstance(payload, dict):
                payload = payload.get("value")
            if payload is None:
                return default
            return Decimal(str(payload))
        except (InvalidOperation, ValueError, TypeError):
            return default

    @staticmethod
    def _trusted_image_url(url: str) -> bool:
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.hostname:
            return False
        host = parsed.hostname.lower().rstrip(".")
        return host == "ebayimg.com" or host.endswith(".ebayimg.com")

    async def _get_access_token(self) -> str:
        if self._access_token and time.time() < self._token_expires_at - 60:
            return self._access_token
        if not settings.ebay_client_id or not settings.ebay_client_secret:
            raise RuntimeError("eBay API credentials are not configured.")

        async with self._token_lock:
            if self._access_token and time.time() < self._token_expires_at - 60:
                return self._access_token
            credentials = base64.b64encode(
                f"{settings.ebay_client_id}:{settings.ebay_client_secret}".encode("utf-8")
            ).decode("ascii")
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(
                    self.TOKEN_URL,
                    headers={
                        "Authorization": f"Basic {credentials}",
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    data={"grant_type": "client_credentials", "scope": self.SCOPE},
                )
                response.raise_for_status()
                payload = response.json()
            token = payload.get("access_token")
            if not token:
                raise RuntimeError("eBay token response did not contain an access token.")
            expires_in = int(payload.get("expires_in", 7200))
            self._access_token = token
            self._token_expires_at = time.time() + expires_in
            return token

    async def fetch_listing(self, source_url_or_id: str) -> EbayListing:
        legacy_item_id = self.parse_legacy_item_id(source_url_or_id)
        token = await self._get_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "X-EBAY-C-MARKETPLACE-ID": settings.ebay_marketplace_id,
        }
        async with httpx.AsyncClient(timeout=25.0) as client:
            response = await client.get(
                self.ITEM_URL,
                headers=headers,
                params={"legacy_item_id": legacy_item_id},
            )
            response.raise_for_status()
            payload = response.json()

        image_urls: list[str] = []
        primary = (payload.get("image") or {}).get("imageUrl")
        if isinstance(primary, str) and self._trusted_image_url(primary):
            image_urls.append(primary)
        for entry in payload.get("additionalImages") or []:
            url = entry.get("imageUrl") if isinstance(entry, dict) else None
            if isinstance(url, str) and self._trusted_image_url(url) and url not in image_urls:
                image_urls.append(url)

        shipping_price = Decimal("0")
        shipping_options = payload.get("shippingOptions") or []
        if shipping_options:
            shipping_price = self._decimal((shipping_options[0] or {}).get("shippingCost"))

        source_url = payload.get("itemWebUrl") or source_url_or_id
        return EbayListing(
            legacy_item_id=legacy_item_id,
            title=payload.get("title"),
            source_url=source_url,
            listing_price=self._decimal(payload.get("price")),
            shipping_price=shipping_price,
            image_urls=image_urls,
            raw_payload=payload,
        )

    async def download_images(self, listing: EbayListing) -> list[tuple[str, str, bytes]]:
        if not listing.image_urls:
            raise RuntimeError("The eBay listing did not return any trusted listing images.")
        uploads: list[tuple[str, str, bytes]] = []
        limits = httpx.Limits(max_connections=6, max_keepalive_connections=3)
        async with httpx.AsyncClient(timeout=25.0, limits=limits, follow_redirects=False) as client:
            for index, url in enumerate(listing.image_urls[: settings.max_lot_images]):
                if not self._trusted_image_url(url):
                    continue
                response = await client.get(url, headers={"User-Agent": "ManeFlow/2.7"})
                response.raise_for_status()
                content_type = response.headers.get("content-type", "image/jpeg").split(";", 1)[0]
                if content_type not in {"image/jpeg", "image/jpg", "image/png", "image/webp"}:
                    continue
                payload = response.content
                if not payload or len(payload) > settings.max_upload_bytes:
                    continue
                extension = {
                    "image/png": "png",
                    "image/webp": "webp",
                }.get(content_type, "jpg")
                uploads.append(
                    (f"ebay-{listing.legacy_item_id}-{index + 1}.{extension}", content_type, payload)
                )
        if not uploads:
            raise RuntimeError("No valid eBay listing images could be downloaded.")
        return uploads


# One token cache per backend process.
ebay_listing_client = EbayListingClient()
