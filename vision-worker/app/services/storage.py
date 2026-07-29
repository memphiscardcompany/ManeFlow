from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.core.config import settings

try:
    import boto3
except ImportError:
    boto3 = None


class ImageStorage:
    def __init__(self) -> None:
        self._client = None
        if (
            boto3
            and settings.r2_endpoint_url
            and settings.r2_access_key_id
            and settings.r2_secret_access_key
        ):
            self._client = boto3.client(
                "s3",
                endpoint_url=settings.r2_endpoint_url,
                aws_access_key_id=settings.r2_access_key_id,
                aws_secret_access_key=settings.r2_secret_access_key,
            )

    async def save_scan_image(self, image_bytes: bytes, content_type: str) -> str | None:
        now = datetime.now(timezone.utc)
        suffix = ".png" if "png" in content_type else ".webp" if "webp" in content_type else ".jpg"
        local_dir = settings.images_dir / f"{now:%Y}" / f"{now:%m}" / f"{now:%d}"
        local_dir.mkdir(parents=True, exist_ok=True)
        local_path = local_dir / f"{uuid4()}{suffix}"
        local_path.write_bytes(image_bytes)

        if self._client:
            key = f"scans/{now:%Y/%m/%d}/{local_path.name}"
            self._client.put_object(
                Bucket=settings.r2_bucket_name,
                Key=key,
                Body=image_bytes,
                ContentType=content_type,
            )
        return str(local_path)


image_storage = ImageStorage()
