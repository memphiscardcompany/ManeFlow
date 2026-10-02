from __future__ import annotations

import hmac
from pathlib import Path

from app.core.config import settings


def bearer_token_matches(authorization: str | None) -> bool:
    expected = (settings.maneflow_service_token or "").strip()
    if not expected or not authorization:
        return False
    scheme, separator, presented = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer":
        return False
    presented = presented.strip()
    if not presented:
        return False
    return hmac.compare_digest(presented, expected)


def resolve_import_folder(folder_path: str) -> Path:
    candidate = Path(folder_path).expanduser().resolve()
    allowed_root = settings.import_allowed_root
    if not candidate.is_relative_to(allowed_root):
        raise ValueError(
            f"Import folder must be inside the configured allowed root: {allowed_root}"
        )
    return candidate
