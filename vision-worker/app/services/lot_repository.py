from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from app.core.config import settings


class LotRepository:
    def __init__(self) -> None:
        settings.dev_database_file.parent.mkdir(parents=True, exist_ok=True)
        self._path = settings.dev_database_file
        self._lock = threading.Lock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                create table if not exists local_lot_jobs (
                    job_id text primary key,
                    payload_json text not null,
                    created_at text not null,
                    updated_at text not null
                )
                """
            )
            connection.execute(
                """
                create table if not exists local_lot_corrections (
                    id integer primary key autoincrement,
                    job_id text not null,
                    item_id text not null,
                    payload_json text not null,
                    created_at text not null
                )
                """
            )
            connection.commit()

    def save_job(self, job_id: UUID, payload: dict[str, Any]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        encoded = json.dumps(payload, default=str)
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                insert into local_lot_jobs(job_id, payload_json, created_at, updated_at)
                values (?, ?, ?, ?)
                on conflict(job_id) do update set
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                """,
                (str(job_id), encoded, now, now),
            )
            connection.commit()

    def get_job(self, job_id: UUID) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "select payload_json from local_lot_jobs where job_id = ?",
                (str(job_id),),
            ).fetchone()
        return json.loads(row["payload_json"]) if row else None

    def save_correction(self, job_id: UUID, item_id: UUID, payload: dict[str, Any]) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                insert into local_lot_corrections(job_id, item_id, payload_json, created_at)
                values (?, ?, ?, ?)
                """,
                (
                    str(job_id),
                    str(item_id),
                    json.dumps(payload, default=str),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            connection.commit()


lot_repository = LotRepository()
