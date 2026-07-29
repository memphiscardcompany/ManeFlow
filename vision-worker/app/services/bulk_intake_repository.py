from __future__ import annotations

import csv
import hashlib
import io
import json
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from app.core.config import settings


_RECOGNITION_LABEL_FIELDS = {
    "year", "brand", "set_name", "insert_name", "player_name", "team", "sport",
    "card_number", "parallel", "serial_number", "rookie", "autograph", "memorabilia",
    "language", "grader", "grade", "cert_number",
}
_SAFE_EVIDENCE_FIELDS = {
    "source", "original_front_filename", "original_back_filename", "pairing_strategy",
    "front_dhash", "back_dhash", "front_quality", "back_quality", "barcode_values",
    "visible_text", "provider", "processed_remotely", "card_side", "warnings",
    "front_provider", "back_provider", "front_identity_confidence", "back_identity_confidence",
    "front_variant_confidence", "back_variant_confidence", "pair_agreements", "pair_conflicts",
}


def _sanitize_recognition_label(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Keep portable recognition facts separate from inventory and financial data."""
    output: dict[str, Any] = {}
    for key, value in (payload or {}).items():
        if key not in _RECOGNITION_LABEL_FIELDS or value is None:
            continue
        if isinstance(value, str):
            value = value.strip()
            if not value:
                continue
            output[key] = value[:500]
        elif isinstance(value, (bool, int, float)):
            output[key] = value
    return output


def _sanitize_recognition_evidence(payload: dict[str, Any] | None) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for key, value in (payload or {}).items():
        if key in _SAFE_EVIDENCE_FIELDS:
            output[key] = value
    return output


class BulkIntakeRepository:
    def __init__(self) -> None:
        self._path = settings.dev_database_file
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("pragma foreign_keys=on")
        return connection

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript(
                """
                create table if not exists contributors (
                    id text primary key,
                    display_name text,
                    consent_scope text not null default 'private',
                    consent_version text not null,
                    consented_at text not null,
                    revoked_at text,
                    notes text
                );

                create table if not exists bulk_intake_batches (
                    id text primary key,
                    contributor_id text,
                    batch_name text,
                    scanner_model text,
                    source_folder text,
                    pairing_strategy text not null,
                    status text not null default 'imported',
                    file_count integer not null default 0,
                    item_count integer not null default 0,
                    warnings_json text not null default '[]',
                    metadata_json text not null default '{}',
                    created_at text not null,
                    updated_at text not null,
                    foreign key(contributor_id) references contributors(id)
                );

                create table if not exists bulk_intake_items (
                    id text primary key,
                    batch_id text not null,
                    sequence_no integer not null,
                    front_image_path text,
                    back_image_path text,
                    front_sha256 text,
                    back_sha256 text,
                    predicted_json text not null default '{}',
                    confirmed_json text not null default '{}',
                    evidence_json text not null default '{}',
                    identity_confidence real not null default 0,
                    variant_confidence real not null default 0,
                    review_status text not null default 'unreviewed',
                    notes text,
                    created_at text not null,
                    updated_at text not null,
                    foreign key(batch_id) references bulk_intake_batches(id) on delete cascade,
                    unique(batch_id, sequence_no)
                );

                create index if not exists bulk_intake_items_batch_idx
                    on bulk_intake_items(batch_id, sequence_no);
                create index if not exists bulk_intake_items_front_hash_idx
                    on bulk_intake_items(front_sha256);
                create index if not exists bulk_intake_items_back_hash_idx
                    on bulk_intake_items(back_sha256);

                create table if not exists training_examples (
                    id text primary key,
                    source_item_id text,
                    contributor_id text,
                    consent_scope text not null,
                    front_image_path text,
                    back_image_path text,
                    front_sha256 text,
                    back_sha256 text,
                    label_json text not null,
                    evidence_json text not null default '{}',
                    reference_eligible integer not null default 0,
                    status text not null default 'approved',
                    source_pack_id text,
                    curation_status text not null default 'pending',
                    curation_notes text,
                    curated_at text,
                    created_at text not null,
                    revoked_at text,
                    foreign key(source_item_id) references bulk_intake_items(id),
                    foreign key(contributor_id) references contributors(id)
                );

                drop index if exists training_example_hash_label_idx;
                create unique index if not exists training_example_hash_label_idx
                    on training_examples(
                        coalesce(front_sha256,''),
                        coalesce(back_sha256,''),
                        label_json
                    ) where status='approved' and revoked_at is null;
                """
            )
            training_columns = {row[1] for row in db.execute("pragma table_info(training_examples)").fetchall()}
            if "curation_status" not in training_columns:
                db.execute("alter table training_examples add column curation_status text not null default 'pending'")
            if "curation_notes" not in training_columns:
                db.execute("alter table training_examples add column curation_notes text")
            if "curated_at" not in training_columns:
                db.execute("alter table training_examples add column curated_at text")
            db.commit()

    def upsert_contributor(self, payload: dict[str, Any]) -> dict[str, Any]:
        contributor_id = str(payload.get("contributor_id") or uuid4())
        now = self._now()
        with self._lock, self._connect() as db:
            existing = db.execute("select * from contributors where id=?", (contributor_id,)).fetchone()
            consented_at = existing["consented_at"] if existing else now
            db.execute(
                """
                insert into contributors(id, display_name, consent_scope, consent_version, consented_at, revoked_at, notes)
                values (?, ?, ?, ?, ?, null, ?)
                on conflict(id) do update set
                    display_name=excluded.display_name,
                    consent_scope=excluded.consent_scope,
                    consent_version=excluded.consent_version,
                    revoked_at=null,
                    notes=excluded.notes
                """,
                (
                    contributor_id,
                    payload.get("display_name"),
                    payload.get("consent_scope") or "private",
                    payload.get("consent_version") or "2026-07-beta-1",
                    consented_at,
                    payload.get("notes"),
                ),
            )
            db.commit()
        return self.get_contributor(UUID(contributor_id))

    def get_contributor(self, contributor_id: UUID) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("select * from contributors where id=?", (str(contributor_id),)).fetchone()
        if row is None:
            raise KeyError(str(contributor_id))
        return dict(row)

    def list_contributors(self) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("select * from contributors order by consented_at desc").fetchall()
        return [dict(row) for row in rows]

    def revoke_contributor(self, contributor_id: UUID) -> dict[str, Any]:
        now = self._now()
        with self._lock, self._connect() as db:
            cursor = db.execute(
                "update contributors set revoked_at=?, consent_scope='private' where id=?",
                (now, str(contributor_id)),
            )
            if cursor.rowcount == 0:
                raise KeyError(str(contributor_id))
            db.execute(
                "update training_examples set status='revoked', revoked_at=? where contributor_id=? and status='approved'",
                (now, str(contributor_id)),
            )
            db.commit()
        return self.get_contributor(contributor_id)

    def create_batch(self, payload: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any]:
        batch_id = str(payload.get("id") or uuid4())
        now = self._now()
        with self._lock, self._connect() as db:
            db.execute(
                """
                insert into bulk_intake_batches(
                    id, contributor_id, batch_name, scanner_model, source_folder,
                    pairing_strategy, status, file_count, item_count, warnings_json,
                    metadata_json, created_at, updated_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    batch_id,
                    payload.get("contributor_id"),
                    payload.get("batch_name"),
                    payload.get("scanner_model"),
                    payload.get("source_folder"),
                    payload.get("pairing_strategy") or "auto",
                    payload.get("status") or "imported",
                    int(payload.get("file_count") or 0),
                    len(items),
                    json.dumps(payload.get("warnings") or []),
                    json.dumps(payload.get("metadata") or {}, default=str),
                    now,
                    now,
                ),
            )
            for item in items:
                item_id = str(item.get("id") or uuid4())
                db.execute(
                    """
                    insert into bulk_intake_items(
                        id, batch_id, sequence_no, front_image_path, back_image_path,
                        front_sha256, back_sha256, predicted_json, confirmed_json,
                        evidence_json, identity_confidence, variant_confidence,
                        review_status, notes, created_at, updated_at
                    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item_id,
                        batch_id,
                        int(item["sequence_no"]),
                        item.get("front_image_path"),
                        item.get("back_image_path"),
                        item.get("front_sha256"),
                        item.get("back_sha256"),
                        json.dumps(item.get("predicted") or {}, default=str),
                        json.dumps(item.get("confirmed") or {}, default=str),
                        json.dumps(item.get("evidence") or {}, default=str),
                        float(item.get("identity_confidence") or 0),
                        float(item.get("variant_confidence") or 0),
                        item.get("review_status") or "unreviewed",
                        item.get("notes"),
                        now,
                        now,
                    ),
                )
            db.commit()
        return self.get_batch(UUID(batch_id), include_items=True)

    def update_batch_status(self, batch_id: UUID, status: str) -> dict[str, Any]:
        with self._lock, self._connect() as db:
            cursor = db.execute(
                "update bulk_intake_batches set status=?, updated_at=? where id=?",
                (status, self._now(), str(batch_id)),
            )
            db.commit()
        if cursor.rowcount == 0:
            raise KeyError(str(batch_id))
        return self.get_batch(batch_id, include_items=False)

    def list_batches(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                """
                select b.*, c.display_name as contributor_name, c.consent_scope
                from bulk_intake_batches b
                left join contributors c on c.id=b.contributor_id
                order by b.updated_at desc
                limit ?
                """,
                (limit,),
            ).fetchall()
        return [self._batch_row(row) for row in rows]

    def get_batch(self, batch_id: UUID, *, include_items: bool = True) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute(
                """
                select b.*, c.display_name as contributor_name, c.consent_scope
                from bulk_intake_batches b
                left join contributors c on c.id=b.contributor_id
                where b.id=?
                """,
                (str(batch_id),),
            ).fetchone()
            if row is None:
                raise KeyError(str(batch_id))
            payload = self._batch_row(row)
            if include_items:
                item_rows = db.execute(
                    "select * from bulk_intake_items where batch_id=? order by sequence_no",
                    (str(batch_id),),
                ).fetchall()
                payload["items"] = [self._item_row(item) for item in item_rows]
        return payload

    @staticmethod
    def _batch_row(row: sqlite3.Row) -> dict[str, Any]:
        payload = dict(row)
        payload["warnings"] = json.loads(payload.pop("warnings_json") or "[]")
        payload["metadata"] = json.loads(payload.pop("metadata_json") or "{}")
        return payload

    @staticmethod
    def _item_row(row: sqlite3.Row) -> dict[str, Any]:
        payload = dict(row)
        payload["predicted"] = json.loads(payload.pop("predicted_json") or "{}")
        payload["confirmed"] = json.loads(payload.pop("confirmed_json") or "{}")
        payload["evidence"] = json.loads(payload.pop("evidence_json") or "{}")
        return payload

    def get_item(self, item_id: UUID) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("select * from bulk_intake_items where id=?", (str(item_id),)).fetchone()
        if row is None:
            raise KeyError(str(item_id))
        return self._item_row(row)

    def update_item_prediction(self, item_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock, self._connect() as db:
            cursor = db.execute(
                """
                update bulk_intake_items set
                    predicted_json=?, evidence_json=?, identity_confidence=?,
                    variant_confidence=?, updated_at=?
                where id=?
                """,
                (
                    json.dumps(payload.get("predicted") or {}, default=str),
                    json.dumps(payload.get("evidence") or {}, default=str),
                    float(payload.get("identity_confidence") or 0),
                    float(payload.get("variant_confidence") or 0),
                    self._now(),
                    str(item_id),
                ),
            )
            db.commit()
        if cursor.rowcount == 0:
            raise KeyError(str(item_id))
        return self.get_item(item_id)

    def review_item(self, item_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock, self._connect() as db:
            row = db.execute(
                """
                select i.*, b.contributor_id, c.consent_scope, c.revoked_at
                from bulk_intake_items i
                join bulk_intake_batches b on b.id=i.batch_id
                left join contributors c on c.id=b.contributor_id
                where i.id=?
                """,
                (str(item_id),),
            ).fetchone()
            if row is None:
                raise KeyError(str(item_id))

            predicted = json.loads(row["predicted_json"] or "{}")
            confirmed = {**predicted, **(payload.get("confirmed_fields") or {})}
            status = payload.get("review_status") or "confirmed"
            now = self._now()
            db.execute(
                """
                update bulk_intake_items set confirmed_json=?, review_status=?, notes=?, updated_at=?
                where id=?
                """,
                (
                    json.dumps(confirmed, default=str),
                    status,
                    payload.get("notes"),
                    now,
                    str(item_id),
                ),
            )

            consent_scope = row["consent_scope"] or "private"
            contributor_id = row["contributor_id"]
            can_contribute = (
                contributor_id
                and not row["revoked_at"]
                and consent_scope != "private"
                and status in {"confirmed", "corrected"}
                and bool(confirmed)
            )
            if can_contribute:
                recognition_label = _sanitize_recognition_label(confirmed)
                can_contribute = bool(recognition_label)
            if can_contribute:
                label_json = json.dumps(recognition_label, sort_keys=True, separators=(",", ":"), default=str)
                evidence_json = json.dumps(
                    _sanitize_recognition_evidence(json.loads(row["evidence_json"] or "{}")),
                    default=str,
                )
                front_path = row["front_image_path"] if consent_scope in {"images_and_labels", "reference_catalog"} else None
                back_path = row["back_image_path"] if consent_scope in {"images_and_labels", "reference_catalog"} else None
                try:
                    db.execute(
                        """
                        insert into training_examples(
                            id, source_item_id, contributor_id, consent_scope,
                            front_image_path, back_image_path, front_sha256, back_sha256,
                            label_json, evidence_json, reference_eligible, status, created_at
                        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)
                        """,
                        (
                            str(uuid4()),
                            str(item_id),
                            contributor_id,
                            consent_scope,
                            front_path,
                            back_path,
                            row["front_sha256"],
                            row["back_sha256"],
                            label_json,
                            evidence_json,
                            1 if consent_scope == "reference_catalog" else 0,
                            now,
                        ),
                    )
                except sqlite3.IntegrityError:
                    pass
            db.commit()
        return self.get_item(item_id)

    def approved_training_examples(self) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                """
                select t.*, c.display_name
                from training_examples t
                left join contributors c on c.id=t.contributor_id
                where t.status='approved' and t.revoked_at is null
                order by t.created_at
                """
            ).fetchall()
        result = []
        for row in rows:
            payload = dict(row)
            payload["label"] = json.loads(payload.pop("label_json") or "{}")
            payload["evidence"] = json.loads(payload.pop("evidence_json") or "{}")
            payload["reference_eligible"] = bool(payload["reference_eligible"])
            result.append(payload)
        return result

    def list_training_examples(self, *, limit: int = 200, curation_status: str | None = None) -> list[dict[str, Any]]:
        query = """
            select t.*, c.display_name
            from training_examples t
            left join contributors c on c.id=t.contributor_id
            where t.status='approved' and t.revoked_at is null
        """
        args: list[Any] = []
        if curation_status:
            query += " and t.curation_status=?"
            args.append(curation_status)
        query += " order by t.created_at desc limit ?"
        args.append(max(1, min(int(limit), 5000)))
        with self._connect() as db:
            rows = db.execute(query, args).fetchall()
        result = []
        for row in rows:
            payload = dict(row)
            payload["label"] = json.loads(payload.pop("label_json") or "{}")
            payload["evidence"] = json.loads(payload.pop("evidence_json") or "{}")
            payload["reference_eligible"] = bool(payload["reference_eligible"])
            result.append(payload)
        return result

    def curate_training_example(self, example_id: UUID, status: str, notes: str | None = None) -> dict[str, Any]:
        if status not in {"pending", "approved", "rejected"}:
            raise ValueError("Invalid curation status.")
        curated_at = self._now() if status in {"approved", "rejected"} else None
        with self._lock, self._connect() as db:
            cursor = db.execute(
                "update training_examples set curation_status=?, curation_notes=?, curated_at=? where id=? and status='approved' and revoked_at is null",
                (status, notes, curated_at, str(example_id)),
            )
            db.commit()
        if cursor.rowcount == 0:
            raise KeyError(str(example_id))
        return next(item for item in self.list_training_examples(limit=5000) if item["id"] == str(example_id))

    @staticmethod
    def _dataset_split(example: dict[str, Any]) -> str:
        """Assign a stable split without leaking the same physical card across runs.

        The image content hash is preferred so front/back pairs and re-imported packs stay in
        the same split. The example id is only a fallback for labels-only records.
        """
        seed = str(example.get("front_sha256") or example.get("back_sha256") or example.get("id") or "")
        digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
        bucket = int(digest[:8], 16) % 100
        if bucket < 80:
            return "train"
        if bucket < 90:
            return "validation"
        return "test"

    def approved_dataset_manifest(self) -> dict[str, Any]:
        """Return an internal, privacy-sanitized manifest for training/evaluation.

        Only owner-approved, non-revoked examples are included. Contributor names/ids,
        inventory values, seller data, and private notes are deliberately omitted.
        """
        rows = self.list_training_examples(limit=5000, curation_status="approved")
        examples: list[dict[str, Any]] = []
        split_counts = {"train": 0, "validation": 0, "test": 0}
        image_counts = {"with_images": 0, "labels_only": 0}
        for row in sorted(rows, key=lambda item: (item.get("front_sha256") or item.get("back_sha256") or item["id"])):
            split = self._dataset_split(row)
            split_counts[split] += 1
            has_front = bool(row.get("front_image_path"))
            has_back = bool(row.get("back_image_path"))
            image_counts["with_images" if (has_front or has_back) else "labels_only"] += 1
            examples.append({
                "schema_version": "1.0",
                "example_id": row["id"],
                "split": split,
                "front_sha256": row.get("front_sha256"),
                "back_sha256": row.get("back_sha256"),
                "front_image_available": has_front,
                "back_image_available": has_back,
                "label": _sanitize_recognition_label(row.get("label") or {}),
                "evidence": _sanitize_recognition_evidence(row.get("evidence") or {}),
                "reference_eligible": bool(row.get("reference_eligible")),
                "consent_scope": row.get("consent_scope") or "labels_only",
                "source_pack_id": row.get("source_pack_id"),
                "created_at": row.get("created_at"),
            })
        return {
            "schema_version": "1.0",
            "generated_at": self._now(),
            "policy": {
                "owner_approved_only": True,
                "revoked_examples_excluded": True,
                "private_inventory_fields_excluded": True,
                "split_strategy": "stable_sha256_80_10_10",
            },
            "summary": {
                "approved_examples": len(examples),
                **split_counts,
                **image_counts,
                "reference_eligible": sum(1 for item in examples if item["reference_eligible"]),
            },
            "examples": examples,
        }

    def curated_reference_examples(self) -> list[dict[str, Any]]:
        return [
            item for item in self.list_training_examples(limit=5000, curation_status="approved")
            if item.get("reference_eligible") and item.get("front_image_path")
        ]

    def exportable_training_examples(self, *, mode: str = "review_queue") -> list[dict[str, Any]]:
        """Return only consented examples appropriate for a portable learning pack.

        review_queue: confirmed contributions that have not been owner-rejected.
        approved: owner-curated examples only.
        pending: only examples still awaiting owner curation.
        """
        if mode not in {"review_queue", "approved", "pending"}:
            raise ValueError("Invalid contribution export mode.")
        examples = self.list_training_examples(limit=5000)
        if mode == "approved":
            return [item for item in examples if item.get("curation_status") == "approved"]
        if mode == "pending":
            return [item for item in examples if item.get("curation_status") == "pending"]
        return [item for item in examples if item.get("curation_status") != "rejected"]

    def mark_pack_imported(self, example_id: str, pack_id: str) -> None:
        with self._lock, self._connect() as db:
            db.execute("update training_examples set source_pack_id=? where id=?", (pack_id, example_id))
            db.commit()

    def import_training_example(self, payload: dict[str, Any], *, source_pack_id: str) -> bool:
        safe_label = _sanitize_recognition_label(payload.get("label") or {})
        if not safe_label:
            return False
        label_json = json.dumps(safe_label, sort_keys=True, separators=(",", ":"), default=str)
        evidence_json = json.dumps(_sanitize_recognition_evidence(payload.get("evidence") or {}), default=str)
        with self._lock, self._connect() as db:
            try:
                db.execute(
                    """
                    insert into training_examples(
                        id, source_item_id, contributor_id, consent_scope,
                        front_image_path, back_image_path, front_sha256, back_sha256,
                        label_json, evidence_json, reference_eligible, status,
                        source_pack_id, created_at
                    ) values (?, null, null, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
                    """,
                    (
                        str(uuid4()),
                        payload.get("consent_scope") or "labels_only",
                        payload.get("front_image_path"),
                        payload.get("back_image_path"),
                        payload.get("front_sha256"),
                        payload.get("back_sha256"),
                        label_json,
                        evidence_json,
                        int(bool(payload.get("reference_eligible"))),
                        source_pack_id,
                        self._now(),
                    ),
                )
                db.commit()
                return True
            except sqlite3.IntegrityError:
                return False

    def export_batch_csv(self, batch_id: UUID) -> str:
        batch = self.get_batch(batch_id, include_items=True)
        output = io.StringIO()
        fields = [
            "sequence_no", "review_status", "identity_confidence", "variant_confidence",
            "player_name", "year", "brand", "set_name", "card_number", "parallel",
            "serial_number", "grader", "grade", "cert_number", "front_image_path",
            "back_image_path", "notes",
        ]
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for item in batch["items"]:
            identity = item["confirmed"] or item["predicted"] or {}
            writer.writerow({
                "sequence_no": item["sequence_no"],
                "review_status": item["review_status"],
                "identity_confidence": item["identity_confidence"],
                "variant_confidence": item["variant_confidence"],
                "player_name": identity.get("player_name"),
                "year": identity.get("year"),
                "brand": identity.get("brand"),
                "set_name": identity.get("set_name"),
                "card_number": identity.get("card_number"),
                "parallel": identity.get("parallel"),
                "serial_number": identity.get("serial_number"),
                "grader": identity.get("grader"),
                "grade": identity.get("grade"),
                "cert_number": identity.get("cert_number"),
                "front_image_path": item["front_image_path"],
                "back_image_path": item["back_image_path"],
                "notes": item["notes"],
            })
        return output.getvalue()


bulk_intake_repository = BulkIntakeRepository()
