from __future__ import annotations

import csv
import io
import json
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from app.core.config import settings


class DesktopRepository:
    def __init__(self) -> None:
        self._path = settings.dev_database_file
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript(
                """
                create table if not exists vault_items (
                    id text primary key,
                    scan_id text,
                    player_name text,
                    year integer,
                    brand text,
                    set_name text,
                    insert_name text,
                    card_number text,
                    parallel text,
                    serial_number text,
                    sport text,
                    team text,
                    grader text,
                    grade text,
                    cert_number text,
                    rookie integer,
                    autograph integer,
                    memorabilia integer,
                    value_low real,
                    value_mid real,
                    value_high real,
                    acquisition_cost real,
                    status text not null default 'owned',
                    front_image_path text,
                    back_image_path text,
                    notes text,
                    source_json text not null default '{}',
                    created_at text not null,
                    updated_at text not null
                );
                create index if not exists vault_player_idx on vault_items(player_name);
                create index if not exists vault_cert_idx on vault_items(cert_number);

                create table if not exists grading_items (
                    id text primary key,
                    vault_item_id text,
                    grader text not null default 'PSA',
                    service_level text,
                    status text not null default 'pre_grade',
                    grading_fee real,
                    outbound_tracking text,
                    submission_number text,
                    expected_return text,
                    notes text,
                    created_at text not null,
                    updated_at text not null,
                    foreign key(vault_item_id) references vault_items(id)
                );
                """
            )
            db.commit()

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def save_vault_item(self, payload: dict[str, Any]) -> dict[str, Any]:
        now = self._now()
        item_id = str(payload.get("id") or uuid4())
        fields = {
            "id": item_id,
            "scan_id": payload.get("scan_id"),
            "player_name": payload.get("player_name"),
            "year": payload.get("year"),
            "brand": payload.get("brand"),
            "set_name": payload.get("set_name"),
            "insert_name": payload.get("insert_name"),
            "card_number": payload.get("card_number"),
            "parallel": payload.get("parallel"),
            "serial_number": payload.get("serial_number"),
            "sport": payload.get("sport"),
            "team": payload.get("team"),
            "grader": payload.get("grader"),
            "grade": payload.get("grade"),
            "cert_number": payload.get("cert_number"),
            "rookie": None if payload.get("rookie") is None else int(bool(payload.get("rookie"))),
            "autograph": None if payload.get("autograph") is None else int(bool(payload.get("autograph"))),
            "memorabilia": None if payload.get("memorabilia") is None else int(bool(payload.get("memorabilia"))),
            "value_low": payload.get("value_low"),
            "value_mid": payload.get("value_mid"),
            "value_high": payload.get("value_high"),
            "acquisition_cost": payload.get("acquisition_cost"),
            "status": payload.get("status") or "owned",
            "front_image_path": payload.get("front_image_path"),
            "back_image_path": payload.get("back_image_path"),
            "notes": payload.get("notes"),
            "source_json": json.dumps(payload.get("source") or {}, default=str),
            "created_at": payload.get("created_at") or now,
            "updated_at": now,
        }
        columns = list(fields)
        placeholders = ",".join("?" for _ in columns)
        updates = ",".join(f"{name}=excluded.{name}" for name in columns if name not in {"id", "created_at"})
        with self._lock, self._connect() as db:
            db.execute(
                f"insert into vault_items ({','.join(columns)}) values ({placeholders}) "
                f"on conflict(id) do update set {updates}",
                [fields[name] for name in columns],
            )
            db.commit()
        return self.get_vault_item(UUID(item_id))

    def list_vault_items(self, search: str | None = None) -> list[dict[str, Any]]:
        query = "select * from vault_items"
        args: list[Any] = []
        if search:
            query += " where lower(coalesce(player_name,'') || ' ' || coalesce(set_name,'') || ' ' || coalesce(cert_number,'') || ' ' || coalesce(card_number,'')) like ?"
            args.append(f"%{search.lower()}%")
        query += " order by updated_at desc"
        with self._connect() as db:
            rows = db.execute(query, args).fetchall()
        return [self._vault_row(row) for row in rows]

    def get_vault_item(self, item_id: UUID) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("select * from vault_items where id=?", (str(item_id),)).fetchone()
        if row is None:
            raise KeyError(str(item_id))
        return self._vault_row(row)

    def delete_vault_item(self, item_id: UUID) -> bool:
        with self._lock, self._connect() as db:
            db.execute("delete from grading_items where vault_item_id=?", (str(item_id),))
            cursor = db.execute("delete from vault_items where id=?", (str(item_id),))
            db.commit()
        return cursor.rowcount > 0

    @staticmethod
    def _vault_row(row: sqlite3.Row) -> dict[str, Any]:
        payload = dict(row)
        for name in ("rookie", "autograph", "memorabilia"):
            payload[name] = None if payload[name] is None else bool(payload[name])
        payload["source"] = json.loads(payload.pop("source_json") or "{}")
        return payload

    def create_grading_item(self, payload: dict[str, Any]) -> dict[str, Any]:
        now = self._now()
        item_id = str(payload.get("id") or uuid4())
        fields = {
            "id": item_id,
            "vault_item_id": payload.get("vault_item_id"),
            "grader": payload.get("grader") or "PSA",
            "service_level": payload.get("service_level"),
            "status": payload.get("status") or "pre_grade",
            "grading_fee": payload.get("grading_fee"),
            "outbound_tracking": payload.get("outbound_tracking"),
            "submission_number": payload.get("submission_number"),
            "expected_return": payload.get("expected_return"),
            "notes": payload.get("notes"),
            "created_at": payload.get("created_at") or now,
            "updated_at": now,
        }
        columns = list(fields)
        with self._lock, self._connect() as db:
            db.execute(
                f"insert into grading_items ({','.join(columns)}) values ({','.join('?' for _ in columns)})",
                [fields[name] for name in columns],
            )
            db.commit()
        return self.get_grading_item(UUID(item_id))

    def update_grading_item(self, item_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
        allowed = {"grader", "service_level", "status", "grading_fee", "outbound_tracking", "submission_number", "expected_return", "notes"}
        changes = {key: value for key, value in payload.items() if key in allowed}
        changes["updated_at"] = self._now()
        assignments = ",".join(f"{key}=?" for key in changes)
        with self._lock, self._connect() as db:
            cursor = db.execute(
                f"update grading_items set {assignments} where id=?",
                [*changes.values(), str(item_id)],
            )
            db.commit()
        if cursor.rowcount == 0:
            raise KeyError(str(item_id))
        return self.get_grading_item(item_id)

    def list_grading_items(self) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                """
                select g.*, v.player_name, v.year, v.brand, v.set_name, v.card_number,
                       v.parallel, v.grader as current_grader, v.grade as current_grade,
                       v.cert_number, v.front_image_path
                from grading_items g
                left join vault_items v on v.id = g.vault_item_id
                order by g.updated_at desc
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def get_grading_item(self, item_id: UUID) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("select * from grading_items where id=?", (str(item_id),)).fetchone()
        if row is None:
            raise KeyError(str(item_id))
        return dict(row)

    def export_vault_csv(self) -> str:
        items = self.list_vault_items()
        output = io.StringIO()
        if not items:
            output.write("id,player_name,year,brand,set_name,card_number,parallel,grader,grade,cert_number,value_mid,acquisition_cost,status\n")
            return output.getvalue()
        columns = [key for key in items[0].keys() if key != "source"]
        writer = csv.DictWriter(output, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(items)
        return output.getvalue()

    def stats(self) -> dict[str, Any]:
        with self._connect() as db:
            vault = db.execute(
                "select count(*) as count, coalesce(sum(value_mid),0) as value, coalesce(sum(acquisition_cost),0) as cost from vault_items"
            ).fetchone()
            grading = db.execute(
                "select count(*) as count from grading_items where status not in ('returned','complete','cancelled')"
            ).fetchone()
            lots = db.execute("select count(*) as count from local_lot_jobs").fetchone()
        return {
            "vault_count": int(vault["count"]),
            "vault_value": float(vault["value"]),
            "cost_basis": float(vault["cost"]),
            "grading_active": int(grading["count"]),
            "lot_jobs": int(lots["count"]),
        }


desktop_repository = DesktopRepository()
