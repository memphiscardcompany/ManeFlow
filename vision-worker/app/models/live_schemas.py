from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


LiveMode = Literal["live", "sweep", "binder", "break", "show_intake", "shop_counter"]


class LiveSessionCreate(BaseModel):
    mode: LiveMode = "live"
    frame_similarity_threshold: int = Field(default=4, ge=0, le=64)
    max_missed_frames: int = Field(default=8, ge=1, le=60)
    stable_after_frames: int = Field(default=3, ge=1, le=30)
    identity_refresh_interval: int = Field(default=3, ge=1, le=30)


class LiveSessionResponse(BaseModel):
    session_id: UUID
    mode: LiveMode
    status: Literal["active", "closed"]
    created_at: datetime
    last_frame_at: datetime | None = None
    frame_count: int = 0
    unique_card_count: int = 0
    active_track_count: int = 0


class LiveTrackResponse(BaseModel):
    track_id: str
    status: Literal["tentative", "stable", "left"]
    bounding_box: list[float] = Field(min_length=4, max_length=4)
    bounding_polygon: list[list[float]] = Field(min_length=4, max_length=4)
    detector_confidence: float = Field(ge=0, le=1)
    frames_seen: int = Field(ge=1)
    identity: dict[str, Any] | None = None
    sides_seen: list[Literal["front", "back"]] = Field(default_factory=list)
    front_back_observed: bool = False
    front_back_fused: bool = False
    warnings: list[str] = Field(default_factory=list)


class LiveEventResponse(BaseModel):
    event_type: Literal["new_card", "identity_update", "track_stable", "card_left"]
    track_id: str
    frame_index: int = Field(ge=1)
    payload: dict[str, Any] = Field(default_factory=dict)


class LiveFrameResponse(BaseModel):
    session_id: UUID
    frame_index: int = Field(ge=1)
    skipped: bool = False
    skip_reason: str | None = None
    image_quality: dict[str, Any] | None = None
    tracks: list[LiveTrackResponse] = Field(default_factory=list)
    events: list[LiveEventResponse] = Field(default_factory=list)
