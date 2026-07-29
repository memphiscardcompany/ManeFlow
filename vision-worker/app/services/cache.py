import json
from typing import Any

from app.core.config import settings

try:
    from redis.asyncio import Redis
except ImportError:
    Redis = None


class PriceCache:
    def __init__(self) -> None:
        self._client = (
            Redis.from_url(settings.redis_url, decode_responses=True)
            if Redis is not None and settings.redis_url
            else None
        )

    async def get_snapshot(self, cache_key: str) -> dict[str, Any] | None:
        if not self._client:
            return None
        payload = await self._client.get(f"price_snapshot:{cache_key}")
        return json.loads(payload) if payload else None

    async def set_snapshot(self, cache_key: str, payload: dict[str, Any], ttl_seconds: int = 1800) -> None:
        if self._client:
            await self._client.setex(
                f"price_snapshot:{cache_key}",
                ttl_seconds,
                json.dumps(payload, default=str),
            )


price_cache = PriceCache()
