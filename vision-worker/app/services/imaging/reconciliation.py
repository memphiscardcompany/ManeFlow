from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from uuid import UUID

from app.models.schemas import PredictedCard
from app.services.imaging.adaptive_grouping import match_paths
from app.services.imaging.fingerprint import are_near_duplicates, hamming_distance


_SERIAL_UNIQUE_PATTERN = re.compile(r"(?<!\d)\d{1,6}\s*/\s*\d{1,7}(?!\d)")


@dataclass(frozen=True)
class GroupDecision:
    group_id: str
    method: str
    confidence: float


@dataclass(frozen=True)
class _View:
    source_image_id: UUID
    fingerprint: str
    content_hash: str | None
    image_path: str | None
    captured_at: datetime | None
    group_id: str
    identity_key: tuple[str, ...] | None
    card_side: str
    cert_number: str | None
    unique_serial: str | None


def _normalize(value: object) -> str:
    return " ".join(str(value or "").lower().strip().split())


def identity_key(card: PredictedCard) -> tuple[str, ...] | None:
    parts = (
        _normalize(card.year),
        _normalize(card.brand),
        _normalize(card.set_name),
        _normalize(card.insert_name),
        _normalize(card.player_name),
        _normalize(card.card_number),
        _normalize(card.parallel),
    )
    populated = sum(bool(part) for part in parts)
    # Prevent grouping on a generic player or brand alone.
    if populated < 3 or not (_normalize(card.card_number) or _normalize(card.cert_number)):
        return None
    return parts


def unique_serial_number(value: str | None) -> str | None:
    normalized = _normalize(value)
    match = _SERIAL_UNIQUE_PATTERN.search(normalized)
    return match.group(0).replace(" ", "") if match else None


def _capture_close(left: datetime | None, right: datetime | None, maximum_seconds: float = 240.0) -> bool:
    if left is None or right is None:
        return False
    return abs((left - right).total_seconds()) <= maximum_seconds


class PhysicalItemReconciler:
    """Conservatively groups repeated views without relying on upload order.

    Exact content duplicates, certs, serial numbers, corroborated front/back
    identities, and calibrated visual evidence may group photos. Visual grouping
    also requires nearby original capture timestamps so two pristine copies of
    the same card are less likely to be collapsed into one physical item.
    """

    def __init__(self) -> None:
        self._views: list[_View] = []
        self._next_group = 1

    def _new_group(self) -> str:
        group = f"physical-{self._next_group:04d}"
        self._next_group += 1
        return group

    def register(
        self,
        *,
        source_image_id: UUID,
        fingerprint: str,
        card: PredictedCard,
        identity_confidence: float,
        card_side: str,
        content_hash: str | None = None,
        image_path: str | Path | None = None,
        captured_at: datetime | None = None,
    ) -> GroupDecision:
        key = identity_key(card)
        cert = _normalize(card.cert_number) or None
        serial = unique_serial_number(card.serial_number)
        other_views = [view for view in self._views if view.source_image_id != source_image_id]

        decision: GroupDecision | None = None
        if content_hash:
            match = next((view for view in other_views if view.content_hash == content_hash), None)
            if match:
                decision = GroupDecision(match.group_id, "exact_content_duplicate", 0.999)

        if decision is None and cert:
            match = next((view for view in other_views if view.cert_number == cert), None)
            if match:
                decision = GroupDecision(match.group_id, "cert_match", 0.995)

        if decision is None and serial and key:
            match = next(
                (
                    view
                    for view in other_views
                    if view.unique_serial == serial and view.identity_key == key
                ),
                None,
            )
            if match:
                decision = GroupDecision(match.group_id, "serial_match", 0.98)

        # Legacy perceptual duplicates are accepted only when capture metadata
        # supports one photo session. Upload order and filenames are ignored.
        if decision is None:
            match = next(
                (
                    view
                    for view in other_views
                    if are_near_duplicates(fingerprint, view.fingerprint, max_distance=5)
                    and _capture_close(captured_at, view.captured_at)
                ),
                None,
            )
            if match:
                decision = GroupDecision(match.group_id, "visual_duplicate_with_capture_time", 0.90)

        # Calibrated owner-corpus matching catches angle/glare changes, but only
        # when original capture times are close. This is deliberately stricter
        # than catalog identity matching because two separate copies can share
        # the same card design.
        if decision is None and image_path and captured_at:
            shortlisted = sorted(
                (
                    view for view in other_views
                    if view.image_path
                    and view.captured_at
                    and _capture_close(captured_at, view.captured_at)
                    and hamming_distance(fingerprint, view.fingerprint) <= 24
                ),
                key=lambda view: hamming_distance(fingerprint, view.fingerprint),
            )[:8]
            for view in shortlisted:
                evidence = match_paths(image_path, view.image_path or '')
                if evidence and evidence.accepted:
                    confidence = min(0.97, max(0.88, 0.78 + evidence.score * 0.20))
                    decision = GroupDecision(view.group_id, "adaptive_visual_capture_match", round(confidence, 4))
                    break

        if (
            decision is None
            and key
            and identity_confidence >= 0.90
            and card_side in {"front", "back"}
        ):
            opposite = "back" if card_side == "front" else "front"
            match = next(
                (
                    view
                    for view in other_views
                    if view.identity_key == key
                    and view.card_side == opposite
                    and not any(
                        existing.group_id == view.group_id
                        and existing.card_side == card_side
                        for existing in self._views
                    )
                ),
                None,
            )
            if match:
                decision = GroupDecision(match.group_id, "front_back_identity", 0.88)

        if decision is None:
            decision = GroupDecision(self._new_group(), "unique", 1.0)

        self._views.append(
            _View(
                source_image_id=source_image_id,
                fingerprint=fingerprint,
                content_hash=content_hash,
                image_path=str(image_path) if image_path else None,
                captured_at=captured_at,
                group_id=decision.group_id,
                identity_key=key,
                card_side=card_side,
                cert_number=cert,
                unique_serial=serial,
            )
        )
        return decision
