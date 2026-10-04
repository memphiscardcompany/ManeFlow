from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import asyncio
import math
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import cv2
import numpy as np

from app.models.live_schemas import (
    LiveEventResponse,
    LiveFrameResponse,
    LiveSessionCreate,
    LiveSessionResponse,
    LiveTrackResponse,
)
from app.services.identity_engine import IdentityResult, identity_engine
from app.services.imaging.barcode import decode_barcodes
from app.services.imaging.card_detector import CardDetection, decode_image
from app.services.imaging.detector_router import detect_card_objects
from app.services.imaging.fingerprint import are_near_duplicates, difference_hash, hamming_distance
from app.services.imaging.quality import analyze_image_quality


class SessionClosedError(RuntimeError):
    pass


class SessionCapacityError(RuntimeError):
    pass


def _prepare_frame(image_bytes: bytes):
    image = decode_image(image_bytes)
    return image, difference_hash(image), analyze_image_quality(image)


def _encode_crop(crop: np.ndarray) -> tuple[bytes, list[str]]:
    ok, encoded = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    return (encoded.tobytes() if ok else b""), decode_barcodes(crop)


def _box_iou(left: tuple[int, int, int, int], right: tuple[int, int, int, int]) -> float:
    lx, ly, lw, lh = left
    rx, ry, rw, rh = right
    x1, y1 = max(lx, rx), max(ly, ry)
    x2, y2 = min(lx + lw, rx + rw), min(ly + lh, ry + rh)
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    union = (lw * lh) + (rw * rh) - intersection
    return intersection / union if union else 0.0


def _center_distance(
    left: tuple[int, int, int, int],
    right: tuple[int, int, int, int],
    *,
    image_width: int,
    image_height: int,
) -> float:
    lx, ly, lw, lh = left
    rx, ry, rw, rh = right
    left_center = (lx + lw / 2.0, ly + lh / 2.0)
    right_center = (rx + rw / 2.0, ry + rh / 2.0)
    distance = math.hypot(left_center[0] - right_center[0], left_center[1] - right_center[1])
    diagonal = math.hypot(max(1, image_width), max(1, image_height))
    return distance / diagonal


def _maximum_weight_assignment(scores: list[list[float]]) -> list[int | None]:
    """Globally assign rows to distinct columns; zero/negative scores stay unmatched."""
    if not scores:
        return []
    row_count = len(scores)
    real_columns = len(scores[0])
    # One zero-cost dummy per detection lets any number of detections abstain.
    column_count = real_columns + row_count
    costs = [
        [-score if score > 0 else 1.0 for score in row] + [0.0] * row_count
        for row in scores
    ]
    potential_rows = [0.0] * (row_count + 1)
    potential_columns = [0.0] * (column_count + 1)
    matched_row = [0] * (column_count + 1)
    predecessor = [0] * (column_count + 1)
    for row_index in range(1, row_count + 1):
        matched_row[0] = row_index
        minimum = [math.inf] * (column_count + 1)
        used = [False] * (column_count + 1)
        column = 0
        while True:
            used[column] = True
            current_row = matched_row[column]
            delta = math.inf
            next_column = 0
            for candidate in range(1, column_count + 1):
                if used[candidate]:
                    continue
                reduced = costs[current_row - 1][candidate - 1] - potential_rows[current_row] - potential_columns[candidate]
                if reduced < minimum[candidate]:
                    minimum[candidate] = reduced
                    predecessor[candidate] = column
                if minimum[candidate] < delta:
                    delta = minimum[candidate]
                    next_column = candidate
            for candidate in range(column_count + 1):
                if used[candidate]:
                    potential_rows[matched_row[candidate]] += delta
                    potential_columns[candidate] -= delta
                else:
                    minimum[candidate] -= delta
            column = next_column
            if matched_row[column] == 0:
                break
        while True:
            previous = predecessor[column]
            matched_row[column] = matched_row[previous]
            column = previous
            if column == 0:
                break
    assignment: list[int | None] = [None] * row_count
    for column in range(1, column_count + 1):
        row = matched_row[column]
        if row and column <= real_columns and scores[row - 1][column - 1] > 0:
            assignment[row - 1] = column - 1
    return assignment


def _normalized_geometry(
    detection: CardDetection,
    *,
    image_width: int,
    image_height: int,
) -> tuple[list[list[float]], list[float]]:
    polygon = [
        [
            max(0.0, min(1.0, round(float(point[0]) / max(1, image_width), 6))),
            max(0.0, min(1.0, round(float(point[1]) / max(1, image_height), 6))),
        ]
        for point in detection.polygon_px
    ]
    x, y, width, height = detection.bounding_box_px
    return polygon, [
        max(0.0, min(1.0, round(x / max(1, image_width), 6))),
        max(0.0, min(1.0, round(y / max(1, image_height), 6))),
        max(0.0, min(1.0, round(width / max(1, image_width), 6))),
        max(0.0, min(1.0, round(height / max(1, image_height), 6))),
    ]


def _identity_payload(identity: IdentityResult) -> dict[str, Any]:
    confirmed = (
        identity.card.card_id is not None
        and identity.identity_confidence >= 0.92
        and identity.variant_confidence >= 0.85
        and not identity.needs_back_image
        and not any("conflict" in warning.lower() for warning in identity.warnings)
    )
    card = identity.card.model_dump(mode="json")
    if not confirmed:
        card["card_id"] = None
    return {
        "card": card,
        "identity_confidence": identity.identity_confidence,
        "variant_confidence": identity.variant_confidence,
        "provider": identity.provider,
        "card_side": identity.card_side,
        "needs_back_image": identity.needs_back_image,
        "barcode_values": identity.barcode_values,
        "visible_text": identity.visible_text,
        "warnings": identity.warnings,
        "needs_manual_confirmation": not confirmed,
    }


def _merge_temporal_identity(previous: IdentityResult, current: IdentityResult) -> IdentityResult:
    previous_card = previous.card.model_dump()
    current_card = current.card.model_dump()
    comparable_fields = [
        "player_name", "year", "brand", "set_name", "card_number", "parallel",
        "serial_number", "grader", "grade", "cert_number", "language",
    ]
    warning_prefix = "Temporal evidence conflicts on: "
    prior_conflicts: set[str] = set()
    for warning in previous.warnings:
        if warning.startswith(warning_prefix):
            fields = warning[len(warning_prefix):].split(". Manual review", 1)[0]
            prior_conflicts.update(name.strip() for name in fields.split(",") if name.strip() in comparable_fields)

    def has_evidence(identity: IdentityResult, card: dict[str, Any]) -> bool:
        return identity.identity_confidence > 0 and any(card.get(name) not in (None, "") for name in comparable_fields)

    # A local matcher miss is not a negative identity observation. In particular,
    # it must not permanently turn an earlier supported identity into confidence 0.
    if not has_evidence(current, current_card):
        return previous
    if not has_evidence(previous, previous_card) and not prior_conflicts:
        return current
    conflicts = [
        field_name
        for field_name in comparable_fields
        if previous_card.get(field_name) not in (None, "")
        and current_card.get(field_name) not in (None, "")
        and str(previous_card[field_name]).strip().lower() != str(current_card[field_name]).strip().lower()
    ]
    conflicted_fields = prior_conflicts.union(conflicts)
    merged_card = {
        field_name: None if field_name in conflicted_fields else (
            current_card.get(field_name) if current_card.get(field_name) not in (None, "") else previous_card.get(field_name)
        )
        for field_name in previous_card
    }
    if conflicted_fields:
        merged_card["card_id"] = None
    warnings = list(dict.fromkeys(previous.warnings + current.warnings))
    # Use the latest supported observation, never a repetition bonus or a
    # minimum over all history: a single blurry frame should be recoverable.
    identity_confidence = current.identity_confidence
    variant_confidence = current.variant_confidence
    if conflicted_fields:
        identity_confidence = min(identity_confidence, 0.74)
        variant_confidence = min(variant_confidence, 0.48)
        if conflicts:
            warning = warning_prefix + ", ".join(sorted(conflicted_fields)) + ". Manual review is required."
            if warning not in warnings:
                warnings.append(warning)
    return IdentityResult(
        card=type(previous.card).model_validate(merged_card),
        identity_confidence=round(identity_confidence, 4),
        variant_confidence=round(variant_confidence, 4),
        provider=f"temporal[{current.provider}]",
        processed_remotely=previous.processed_remotely or current.processed_remotely,
        is_trading_card=current.is_trading_card if current.is_trading_card is not None else previous.is_trading_card,
        card_side=current.card_side if current.card_side != "unknown" else previous.card_side,
        needs_back_image=previous.needs_back_image and current.needs_back_image,
        visible_text=list(dict.fromkeys(previous.visible_text + current.visible_text)),
        barcode_values=list(dict.fromkeys(previous.barcode_values + current.barcode_values)),
        warnings=warnings,
    )


@dataclass
class _Track:
    track_id: str
    bounding_box_px: tuple[int, int, int, int]
    polygon_px: np.ndarray
    detector_confidence: float
    appearance_hash: str
    first_frame: int
    last_frame: int
    velocity_px: tuple[float, float] = (0.0, 0.0)
    frames_seen: int = 1
    missed_frames: int = 0
    stable_emitted: bool = False
    last_emitted_identity_confidence: float = 0.0
    last_identity_frame: int = 0
    identity: IdentityResult | None = None
    sides_seen: set[str] = field(default_factory=set)
    fusion_conflicted: bool = False
    warnings: list[str] = field(default_factory=list)

    @property
    def status(self) -> str:
        return "stable" if self.stable_emitted else "tentative"


class LiveSession:
    """Frame gate, physical-card tracker, and temporal identity accumulator."""

    def __init__(self, session_id: UUID, options: LiveSessionCreate) -> None:
        self.session_id = session_id
        self.mode = options.mode
        self.frame_similarity_threshold = options.frame_similarity_threshold
        self.max_missed_frames = options.max_missed_frames
        self.stable_after_frames = options.stable_after_frames
        self.identity_refresh_interval = options.identity_refresh_interval
        self.created_at = datetime.now(timezone.utc)
        self.last_frame_at: datetime | None = None
        self.frame_count = 0
        self._closed = False
        self._frame_lock = asyncio.Lock()
        self._last_frame_hash: str | None = None
        self._tracks: dict[str, _Track] = {}
        self._next_track_number = 1

    def close(self) -> None:
        self._closed = True
        for track in self._tracks.values():
            track.missed_frames = self.max_missed_frames

    def status(self) -> LiveSessionResponse:
        return LiveSessionResponse(
            session_id=self.session_id,
            mode=self.mode,
            status="closed" if self._closed else "active",
            created_at=self.created_at,
            last_frame_at=self.last_frame_at,
            frame_count=self.frame_count,
            unique_card_count=self._next_track_number - 1,
            active_track_count=len(self._active_tracks()),
        )

    async def _recognize_crop(self, crop: np.ndarray) -> IdentityResult:
        payload, barcodes = await asyncio.to_thread(_encode_crop, crop)
        if not payload:
            return identity_engine.unavailable_result(barcodes)
        return await asyncio.wait_for(
            identity_engine.identify(payload, "live-frame.jpg", media_type="image/jpeg", barcode_values=barcodes),
            timeout=10.0,
        )

    def _assign_detections(
        self,
        detections: list[CardDetection],
        appearance_hashes: list[str],
        *,
        image_width: int,
        image_height: int,
    ) -> list[_Track | None]:
        tracks = [track for track in self._tracks.values() if track.missed_frames < self.max_missed_frames]
        scores: list[list[float]] = []
        for detection, appearance_hash in zip(detections, appearance_hashes, strict=True):
            row: list[float] = []
            for track in tracks:
                if hamming_distance(track.appearance_hash, appearance_hash) > 20:
                    row.append(0.0)
                    continue
                x, y, width, height = track.bounding_box_px
                dx, dy = track.velocity_px
                predicted = (round(x + dx * (track.missed_frames + 1)), round(y + dy * (track.missed_frames + 1)), width, height)
                iou = max(_box_iou(detection.bounding_box_px, track.bounding_box_px), _box_iou(detection.bounding_box_px, predicted))
                distance = min(
                    _center_distance(detection.bounding_box_px, box, image_width=image_width, image_height=image_height)
                    for box in (track.bounding_box_px, predicted)
                )
                row.append(max(iou, 1.0 - min(distance / 0.12, 1.0)) if iou >= 0.08 or distance <= 0.12 else 0.0)
            scores.append(row)
        return [tracks[index] if index is not None else None for index in _maximum_weight_assignment(scores)]

    async def process_frame(self, image_bytes: bytes, content_type: str = "image/jpeg") -> LiveFrameResponse:
        async with self._frame_lock:
            return await self._process_frame_locked(image_bytes, content_type)

    async def _process_frame_locked(self, image_bytes: bytes, content_type: str) -> LiveFrameResponse:
        if self._closed:
            raise SessionClosedError("Live session is closed.")
        image, frame_hash, quality = await asyncio.to_thread(_prepare_frame, image_bytes)
        self.frame_count += 1
        frame_index = self.frame_count
        self.last_frame_at = datetime.now(timezone.utc)

        if (
            self._last_frame_hash is not None
            and frame_index % 5 != 0
            and are_near_duplicates(
                self._last_frame_hash,
                frame_hash,
                max_distance=self.frame_similarity_threshold,
            )
        ):
            return LiveFrameResponse(
                session_id=self.session_id,
                frame_index=frame_index,
                skipped=True,
                skip_reason="near_duplicate_frame",
                image_quality=quality.to_dict(),
                tracks=[self._track_response(track, image.shape[1], image.shape[0]) for track in self._active_tracks()],
                events=[],
            )

        self._last_frame_hash = frame_hash
        detections = sorted(
            await asyncio.to_thread(detect_card_objects, image, allow_whole_image_fallback=False),
            key=lambda detection: (detection.bounding_box_px[1], detection.bounding_box_px[0]),
        )
        appearance_hashes = await asyncio.to_thread(lambda: [difference_hash(detection.crop) for detection in detections])
        assigned_tracks = await asyncio.to_thread(
            self._assign_detections,
            detections,
            appearance_hashes,
            image_width=image.shape[1],
            image_height=image.shape[0],
        )
        matched_ids: set[str] = set()
        events: list[LiveEventResponse] = []
        for detection, appearance_hash, track in zip(detections, appearance_hashes, assigned_tracks, strict=True):
            is_new = track is None
            if track is None:
                track = _Track(
                    track_id=f"track_{self._next_track_number}",
                    bounding_box_px=detection.bounding_box_px,
                    polygon_px=detection.polygon_px.copy(),
                    detector_confidence=detection.confidence,
                    appearance_hash=appearance_hash,
                    first_frame=frame_index,
                    last_frame=frame_index,
                )
                self._next_track_number += 1
                self._tracks[track.track_id] = track
            else:
                old_x, old_y, _, _ = track.bounding_box_px
                elapsed = max(1, frame_index - track.last_frame)
                track.velocity_px = ((detection.bounding_box_px[0] - old_x) / elapsed, (detection.bounding_box_px[1] - old_y) / elapsed)
                track.bounding_box_px = detection.bounding_box_px
                track.polygon_px = detection.polygon_px.copy()
                track.detector_confidence = max(track.detector_confidence, detection.confidence)
                track.appearance_hash = appearance_hash
                track.last_frame = frame_index
                track.frames_seen += 1
                track.missed_frames = 0
            matched_ids.add(track.track_id)

            if is_new:
                events.append(
                    LiveEventResponse(
                        event_type="new_card",
                        track_id=track.track_id,
                        frame_index=frame_index,
                        payload={"detector_confidence": detection.confidence},
                    )
                )

            should_refresh_identity = (
                track.identity is None
                or frame_index - track.last_identity_frame >= self.identity_refresh_interval
            )
            if should_refresh_identity:
                try:
                    current_identity = await self._recognize_crop(detection.crop)
                    previous_identity = track.identity
                    prior_sides = set(track.sides_seen)
                    if current_identity.card_side in {"front", "back"}:
                        track.sides_seen.add(current_identity.card_side)
                    track.identity = (
                        _merge_temporal_identity(previous_identity, current_identity)
                        if previous_identity is not None
                        else current_identity
                    )
                    if any(warning.startswith("Temporal evidence conflicts on:") for warning in track.identity.warnings):
                        track.fusion_conflicted = True
                    track.last_identity_frame = frame_index
                    identity_confidence = track.identity.identity_confidence
                    materially_changed = previous_identity is None or (
                        track.identity.card.model_dump(exclude_none=True)
                        != previous_identity.card.model_dump(exclude_none=True)
                        or abs(identity_confidence - track.last_emitted_identity_confidence) > 0.01
                        or track.sides_seen != prior_sides
                    )
                    if identity_confidence > 0 and materially_changed:
                        track.last_emitted_identity_confidence = identity_confidence
                        events.append(
                            LiveEventResponse(
                                event_type="identity_update",
                                track_id=track.track_id,
                                frame_index=frame_index,
                                payload=_identity_payload(track.identity),
                            )
                        )
                except Exception as exc:
                    warning = f"Live identity analysis deferred safely: {type(exc).__name__}."
                    if warning not in track.warnings:
                        track.warnings.append(warning)

            if not track.stable_emitted and track.frames_seen >= self.stable_after_frames:
                track.stable_emitted = True
                events.append(
                    LiveEventResponse(
                        event_type="track_stable",
                        track_id=track.track_id,
                        frame_index=frame_index,
                        payload={"frames_seen": track.frames_seen},
                    )
                )

        for track in list(self._tracks.values()):
            if track.track_id not in matched_ids:
                track.missed_frames += 1
                if track.missed_frames == self.max_missed_frames:
                    events.append(
                        LiveEventResponse(
                            event_type="card_left",
                            track_id=track.track_id,
                            frame_index=frame_index,
                            payload={"frames_seen": track.frames_seen},
                        )
                    )
                    self._tracks.pop(track.track_id, None)

        return LiveFrameResponse(
            session_id=self.session_id,
            frame_index=frame_index,
            image_quality=quality.to_dict(),
            tracks=[self._track_response(track, image.shape[1], image.shape[0]) for track in self._active_tracks()],
            events=events,
        )

    def _active_tracks(self) -> list[_Track]:
        return [track for track in self._tracks.values() if track.missed_frames < self.max_missed_frames]

    def _track_response(self, track: _Track, image_width: int, image_height: int) -> LiveTrackResponse:
        view = SimpleNamespace(
            bounding_box_px=track.bounding_box_px,
            polygon_px=track.polygon_px,
        )
        _, bounding_box = _normalized_geometry(
            view, image_width=image_width, image_height=image_height
        )
        if np.asarray(track.polygon_px).shape != (4, 2):
            x, y, width, height = track.bounding_box_px
            view.polygon_px = np.array([[x, y], [x + width, y], [x + width, y + height], [x, y + height]], dtype=np.float32)
        polygon, _ = _normalized_geometry(view, image_width=image_width, image_height=image_height)
        return LiveTrackResponse(
            track_id=track.track_id,
            status=track.status,
            bounding_box=bounding_box,
            bounding_polygon=polygon,
            detector_confidence=track.detector_confidence,
            frames_seen=track.frames_seen,
            identity=_identity_payload(track.identity) if track.identity else None,
            sides_seen=[side for side in ("front", "back") if side in track.sides_seen],
            front_back_observed={"front", "back"}.issubset(track.sides_seen),
            front_back_fused=False,
            warnings=list(dict.fromkeys(track.warnings)),
        )


class LiveSessionManager:
    def __init__(self) -> None:
        self._sessions: dict[UUID, LiveSession] = {}
        self.max_sessions = 128
        self.idle_ttl = timedelta(minutes=30)

    def _prune(self) -> None:
        now = datetime.now(timezone.utc)
        for session_id, session in list(self._sessions.items()):
            last_activity = session.last_frame_at or session.created_at
            if session._closed or now - last_activity > self.idle_ttl:
                session.close()
                self._sessions.pop(session_id, None)

    def create(self, options: LiveSessionCreate) -> LiveSession:
        self._prune()
        if len(self._sessions) >= self.max_sessions:
            raise SessionCapacityError("Live session capacity reached; close a session and retry.")
        session = LiveSession(uuid4(), options)
        self._sessions[session.session_id] = session
        return session

    def get(self, session_id: UUID) -> LiveSession | None:
        self._prune()
        return self._sessions.get(session_id)

    def close(self, session_id: UUID) -> bool:
        session = self._sessions.get(session_id)
        if session is None:
            return False
        session.close()
        self._sessions.pop(session_id, None)
        return True


live_session_manager = LiveSessionManager()
