from typing import Any
from uuid import UUID

from app.core.config import settings

try:
    from supabase import Client, create_client
except ImportError:
    Client = Any
    create_client = None


class Database:
    def __init__(self) -> None:
        self.client: Client | None = None
        if create_client and settings.supabase_url and settings.supabase_service_role_key:
            self.client = create_client(
                settings.supabase_url,
                settings.supabase_service_role_key,
            )

    async def insert_scan_event(self, payload: dict[str, Any]) -> None:
        if self.client:
            self.client.table("scan_events").insert(payload).execute()

    async def insert_correction(self, payload: dict[str, Any]) -> None:
        if self.client:
            self.client.table("corrections_queue").insert(payload).execute()


db = Database()
