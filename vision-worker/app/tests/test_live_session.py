from __future__ import annotations

from io import BytesIO
import asyncio
from dataclasses import replace

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.live_schemas import LiveSessionCreate
from app.models.schemas import PredictedCard
from app.services.identity_engine import IdentityResult
from app.services.imaging.card_detector import CardDetection
from app.services.live_session import LiveSession, LiveSessionManager, _identity_payload, _merge_temporal_identity
from app.services import live_session as live_session_module


AUTH_HEADERS = {"Authorization": "Bearer test-maneflow-service-token"}


def _frame(seed: int) -> bytes:
    rng = np.random.default_rng(seed)
    image = rng.integers(0, 255, size=(480, 640, 3), dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok
    return encoded.tobytes()


def _detection(x: int = 120, y: int = 80) -> CardDetection:
    polygon = np.array(
        [[x, y], [x + 160, y], [x + 160, y + 220], [x, y + 220]],
        dtype=np.float32,
    )
    crop = np.full((220, 160, 3), 120, dtype=np.uint8)
    return CardDetection(
        polygon_px=polygon,
        bounding_box_px=(x, y, 160, 220),
        confidence=0.82,
        rectangularity=0.9,
        aspect_ratio=0.72,
        area_fraction=0.12,
        fallback_whole_image=False,
        crop=crop,
    )


def test_global_assignment_avoids_raster_order_track_theft():
    session = LiveSession(__import__("uuid").uuid4(), LiveSessionCreate())
    first = _detection(x=100, y=80)
    second = _detection(x=220, y=80)
    for number, detection in enumerate((first, second), start=1):
        track = live_session_module._Track(
            track_id=f"track_{number}",
            bounding_box_px=detection.bounding_box_px,
            polygon_px=detection.polygon_px,
            detector_confidence=0.8,
            appearance_hash="0" * 16,
            first_frame=1,
            last_frame=1,
        )
        session._tracks[track.track_id] = track
    # The first raster-order detection prefers track_1, but the second is an
    # exact fit for track_1. A greedy matcher would steal it for the first.
    detections = [_detection(x=140, y=50), _detection(x=100, y=80)]
    assigned = session._assign_detections(detections, ["0" * 16] * 2, image_width=640, image_height=480)
    assert [track.track_id if track else None for track in assigned] == ["track_2", "track_1"]


def test_motion_prediction_recovers_fast_moving_track():
    session = LiveSession(__import__("uuid").uuid4(), LiveSessionCreate())
    prior = _detection(x=100, y=80)
    track = live_session_module._Track(
        track_id="track_1",
        bounding_box_px=prior.bounding_box_px,
        polygon_px=prior.polygon_px,
        detector_confidence=0.8,
        appearance_hash="0" * 16,
        first_frame=1,
        last_frame=2,
        velocity_px=(160, 0),
    )
    session._tracks[track.track_id] = track
    assigned = session._assign_detections([_detection(x=260, y=80)], ["0" * 16], image_width=640, image_height=480)
    assert assigned == [track]


def test_temporal_identity_recovers_from_unavailable_and_weak_frames_without_repetition_boost():
    def observation(confidence: float, number: str | None = "A-1") -> IdentityResult:
        return IdentityResult(
            card=PredictedCard(card_number=number), identity_confidence=confidence,
            variant_confidence=confidence, provider="test-local", processed_remotely=False,
            is_trading_card=True,
        )

    result = observation(0.95)
    result = _merge_temporal_identity(result, observation(0.0, None))
    assert result.identity_confidence == 0.95
    result = _merge_temporal_identity(result, observation(0.4))
    assert result.identity_confidence == 0.4
    result = _merge_temporal_identity(result, observation(0.97))
    assert result.identity_confidence == 0.97
    repeated = observation(0.88)
    for _ in range(20):
        repeated = _merge_temporal_identity(repeated, observation(0.88))
    assert repeated.identity_confidence == 0.88


def test_temporal_conflict_abstains_instead_of_pinning_the_first_wrong_field():
    def observation(player: str, confidence: float) -> IdentityResult:
        return IdentityResult(
            card=PredictedCard(player_name=player, card_number="12"),
            identity_confidence=confidence, variant_confidence=confidence,
            provider="test-local", processed_remotely=False, is_trading_card=True,
        )

    result = observation("Wrong Player", 0.6)
    for _ in range(20):
        result = _merge_temporal_identity(result, observation("Josh Allen", 0.97))
    assert result.card.player_name is None
    assert result.card.card_number == "12"
    assert result.card.card_id is None
    assert result.identity_confidence <= 0.74
    assert any("Temporal evidence conflicts on: player_name" in warning for warning in result.warnings)


def test_live_identity_payload_abstains_until_canonical_id_and_variant_are_supported():
    weak = IdentityResult(card=PredictedCard(card_id=__import__("uuid").uuid4(), card_number="A-1"),
                          identity_confidence=0.96, variant_confidence=0.3, provider="test",
                          processed_remotely=False, is_trading_card=True, needs_back_image=False)
    payload = _identity_payload(weak)
    assert payload["card"]["card_id"] is None
    assert payload["needs_manual_confirmation"] is True
    strong = IdentityResult(**{**weak.__dict__, "variant_confidence": 0.91})
    payload = _identity_payload(strong)
    assert payload["card"]["card_id"] == str(strong.card.card_id)
    assert payload["needs_manual_confirmation"] is False


@pytest.mark.asyncio
async def test_live_session_gates_duplicates_tracks_temporal_identity_and_emits_events(monkeypatch):
    calls = []
    frame_number = 0

    def detect(image, **kwargs):
        del image, kwargs
        nonlocal frame_number
        frame_number += 1
        if frame_number <= 3:
            return [_detection(x=120 + frame_number * 4)]
        return []

    async def recognize(crop):
        del crop
        calls.append(True)
        return IdentityResult(
            card=PredictedCard(card_number="A-1"),
            identity_confidence=0.78,
            variant_confidence=0.25,
            provider="test-live",
            processed_remotely=False,
            is_trading_card=True,
            card_side="front",
            needs_back_image=True,
        )

    monkeypatch.setattr(live_session_module, "detect_card_objects", detect)
    session = LiveSession(
        session_id=__import__("uuid").uuid4(),
        options=LiveSessionCreate(
            frame_similarity_threshold=0,
            max_missed_frames=2,
            stable_after_frames=3,
        ),
    )
    monkeypatch.setattr(session, "_recognize_crop", recognize)

    first = await session.process_frame(_frame(1))
    duplicate = await session.process_frame(_frame(1))
    second = await session.process_frame(_frame(2))
    third = await session.process_frame(_frame(3))
    fourth = await session.process_frame(_frame(4))
    fifth = await session.process_frame(_frame(5))

    assert first.skipped is False
    assert [event.event_type for event in first.events] == ["new_card", "identity_update"]
    assert duplicate.skipped is True
    assert duplicate.skip_reason == "near_duplicate_frame"
    assert [track.track_id for track in third.tracks] == ["track_1"]
    assert not any(event.event_type == "track_stable" for event in second.events)
    assert any(event.event_type == "track_stable" for event in third.events)
    assert third.tracks[0].frames_seen == 3
    assert len(calls) == 2
    assert [event.event_type for event in fourth.events] == []
    assert fourth.events == []
    assert any(event.event_type == "card_left" for event in fifth.events)


def test_live_session_http_lifecycle_requires_service_auth():
    client = TestClient(app, headers=AUTH_HEADERS)
    created = client.post("/v1/live/sessions", json={"mode": "sweep", "identity_refresh_interval": 1})
    assert created.status_code == 200, created.text
    payload = created.json()
    session_id = payload["session_id"]
    assert payload["mode"] == "sweep"
    assert live_session_module.live_session_manager.get(__import__("uuid").UUID(session_id)).identity_refresh_interval == 3
    assert client.get(f"/v1/live/sessions/{session_id}").json()["status"] == "active"
    deleted = client.delete(f"/v1/live/sessions/{session_id}")
    assert deleted.status_code == 200
    assert client.get(f"/v1/live/sessions/{session_id}").status_code == 404
    assert TestClient(app).post("/v1/live/sessions", json={}).status_code == 401


def test_unrelayed_live_websocket_surface_is_not_registered():
    assert not any(route.__class__.__name__.endswith("WebSocketRoute") and "/live/sessions/" in getattr(route, "path", "") for route in app.routes)


@pytest.mark.asyncio
async def test_live_crop_uses_the_still_image_identity_engine(monkeypatch):
    calls = []
    async def identify(payload, filename, *, media_type, barcode_values):
        calls.append((payload, filename, media_type, barcode_values))
        return IdentityResult(card=PredictedCard(card_number="A-1"), identity_confidence=0.6,
                              variant_confidence=0.2, provider="canonical-test", processed_remotely=False,
                              is_trading_card=True)
    monkeypatch.setattr(live_session_module.identity_engine, "identify", identify)
    session = LiveSession(__import__("uuid").uuid4(), LiveSessionCreate())
    result = await session._recognize_crop(_detection().crop)
    assert result.provider == "canonical-test"
    assert calls[0][1:3] == ("live-frame.jpg", "image/jpeg")


def test_live_session_manager_prunes_idle_sessions_and_enforces_capacity():
    from datetime import timedelta

    manager = LiveSessionManager()
    manager.max_sessions = 1
    first = manager.create(LiveSessionCreate())
    with pytest.raises(RuntimeError, match="capacity"):
        manager.create(LiveSessionCreate())
    first.created_at -= timedelta(minutes=31)
    second = manager.create(LiveSessionCreate())
    assert manager.get(first.session_id) is None
    assert manager.get(second.session_id) is second


@pytest.mark.asyncio
async def test_live_track_fuses_front_and_back_only_without_conflicting_identity(monkeypatch):
    monkeypatch.setattr(live_session_module, "detect_card_objects", lambda *_args, **_kwargs: [_detection()])
    sides = iter(["front", "back"])

    async def recognize(_crop):
        return IdentityResult(
            card=PredictedCard(card_number="A-1", player_name="Same Card"),
            identity_confidence=0.8,
            variant_confidence=0.4,
            provider="test-live",
            processed_remotely=False,
            is_trading_card=True,
            card_side=next(sides),
            needs_back_image=False,
        )

    session = LiveSession(
        session_id=__import__("uuid").uuid4(),
        options=LiveSessionCreate(identity_refresh_interval=1, frame_similarity_threshold=0),
    )
    monkeypatch.setattr(session, "_recognize_crop", recognize)
    first = await session.process_frame(_frame(10))
    second = await session.process_frame(_frame(11))
    assert first.tracks[0].sides_seen == ["front"]
    assert first.tracks[0].front_back_fused is False
    assert second.tracks[0].track_id == first.tracks[0].track_id
    assert second.tracks[0].sides_seen == ["front", "back"]
    assert second.tracks[0].front_back_observed is True
    assert second.tracks[0].front_back_fused is False
    assert any(event.event_type == "identity_update" for event in second.events)


@pytest.mark.asyncio
async def test_live_track_exposes_front_back_conflict_instead_of_claiming_fusion(monkeypatch):
    monkeypatch.setattr(live_session_module, "detect_card_objects", lambda *_args, **_kwargs: [_detection()])
    observations = iter([("front", "A-1"), ("back", "B-2")])

    async def recognize(_crop):
        side, number = next(observations)
        return IdentityResult(
            card=PredictedCard(card_number=number),
            identity_confidence=0.9,
            variant_confidence=0.6,
            provider="test-live",
            processed_remotely=False,
            is_trading_card=True,
            card_side=side,
            needs_back_image=False,
        )

    session = LiveSession(
        session_id=__import__("uuid").uuid4(),
        options=LiveSessionCreate(identity_refresh_interval=1, frame_similarity_threshold=0),
    )
    monkeypatch.setattr(session, "_recognize_crop", recognize)
    await session.process_frame(_frame(21))
    second = await session.process_frame(_frame(22))
    assert second.tracks[0].sides_seen == ["front", "back"]
    assert second.tracks[0].front_back_fused is False
    assert any("conflicts" in warning for warning in second.tracks[0].identity["warnings"])


@pytest.mark.asyncio
async def test_departed_card_reappears_as_new_track(monkeypatch):
    observations = iter([[_detection()], [], [], [_detection()]])
    monkeypatch.setattr(live_session_module, "detect_card_objects", lambda *_args, **_kwargs: next(observations))
    session = LiveSession(__import__("uuid").uuid4(), LiveSessionCreate(max_missed_frames=2, frame_similarity_threshold=0))
    async def recognize(_crop):
        return IdentityResult(card=PredictedCard(card_number="A-1"), identity_confidence=0.7,
                              variant_confidence=0.3, provider="test", processed_remotely=False, is_trading_card=True)
    monkeypatch.setattr(session, "_recognize_crop", recognize)
    first = await session.process_frame(_frame(101))
    await session.process_frame(_frame(102))
    left = await session.process_frame(_frame(103))
    returned = await session.process_frame(_frame(104))
    assert any(event.event_type == "card_left" for event in left.events)
    assert returned.tracks[0].track_id != first.tracks[0].track_id
    assert any(event.event_type == "new_card" for event in returned.events)
    assert session.status().unique_card_count == 2


@pytest.mark.asyncio
async def test_different_appearance_in_same_box_starts_new_track(monkeypatch):
    gradient = np.tile(np.linspace(0, 255, 160, dtype=np.uint8), (220, 1))
    changed = replace(_detection(), crop=cv2.cvtColor(gradient, cv2.COLOR_GRAY2BGR))
    observations = iter([[_detection()], [changed]])
    monkeypatch.setattr(live_session_module, "detect_card_objects", lambda *_args, **_kwargs: next(observations))
    session = LiveSession(__import__("uuid").uuid4(), LiveSessionCreate(frame_similarity_threshold=0))
    async def recognize(_crop):
        return IdentityResult(card=PredictedCard(), identity_confidence=0, variant_confidence=0,
                              provider="test", processed_remotely=False, is_trading_card=None)
    monkeypatch.setattr(session, "_recognize_crop", recognize)
    first = await session.process_frame(_frame(601))
    second = await session.process_frame(_frame(602))
    assert second.tracks[-1].track_id != first.tracks[0].track_id
    assert any(event.event_type == "new_card" for event in second.events)


@pytest.mark.asyncio
async def test_static_frame_gate_forces_periodic_detection_of_a_swap(monkeypatch):
    gradient = np.tile(np.linspace(0, 255, 160, dtype=np.uint8), (220, 1))
    changed = replace(_detection(), crop=cv2.cvtColor(gradient, cv2.COLOR_GRAY2BGR))
    observations = iter([[_detection()], [changed]])
    monkeypatch.setattr(live_session_module, "detect_card_objects", lambda *_args, **_kwargs: next(observations))
    monkeypatch.setattr(live_session_module, "are_near_duplicates", lambda *_args, **_kwargs: True)
    session = LiveSession(__import__("uuid").uuid4(), LiveSessionCreate())
    async def recognize(_crop):
        return IdentityResult(card=PredictedCard(), identity_confidence=0, variant_confidence=0,
                              provider="test", processed_remotely=False, is_trading_card=None)
    monkeypatch.setattr(session, "_recognize_crop", recognize)
    first = await session.process_frame(_frame(701))
    for index in range(3):
        skipped = await session.process_frame(_frame(702 + index))
        assert skipped.skipped is True
    forced = await session.process_frame(_frame(705))
    assert forced.skipped is False
    assert any(event.event_type == "new_card" and event.track_id != first.tracks[0].track_id for event in forced.events)


@pytest.mark.asyncio
async def test_concurrent_frames_do_not_create_duplicate_tracks(monkeypatch):
    monkeypatch.setattr(live_session_module, "detect_card_objects", lambda *_args, **_kwargs: [_detection()])
    session = LiveSession(__import__("uuid").uuid4(), LiveSessionCreate(frame_similarity_threshold=0))
    async def recognize(_crop):
        await asyncio.sleep(0.01)
        return IdentityResult(card=PredictedCard(card_number="A-1"), identity_confidence=0.7,
                              variant_confidence=0.3, provider="test", processed_remotely=False, is_trading_card=True)
    monkeypatch.setattr(session, "_recognize_crop", recognize)
    results = await asyncio.gather(session.process_frame(_frame(201)), session.process_frame(_frame(202)))
    assert [result.frame_index for result in results] == [1, 2]
    assert len(session._tracks) == 1
    assert sum(event.event_type == "new_card" for result in results for event in result.events) == 1


@pytest.mark.asyncio
async def test_repeated_identity_does_not_manufacture_confidence_and_conflict_sticks(monkeypatch):
    monkeypatch.setattr(live_session_module, "detect_card_objects", lambda *_args, **_kwargs: [_detection()])
    session = LiveSession(__import__("uuid").uuid4(), LiveSessionCreate(identity_refresh_interval=1, frame_similarity_threshold=0))
    observed = 0
    async def recognize(_crop):
        nonlocal observed
        observed += 1
        number = "B-2" if observed == 21 else "A-1"
        return IdentityResult(card=PredictedCard(card_number=number), identity_confidence=0.88,
                              variant_confidence=0.7, provider="test", processed_remotely=False, is_trading_card=True)
    monkeypatch.setattr(session, "_recognize_crop", recognize)
    for index in range(20):
        result = await session.process_frame(_frame(300 + index))
        assert result.tracks[0].identity["identity_confidence"] <= 0.88
    for index in range(4):
        result = await session.process_frame(_frame(400 + index))
        assert result.tracks[0].identity["identity_confidence"] <= 0.74
        assert result.tracks[0].identity["card"]["card_number"] is None


def test_live_http_rejects_oversized_frame_and_missing_session(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "max_upload_bytes", 64)
    client = TestClient(app, headers=AUTH_HEADERS)
    created = client.post("/v1/live/sessions", json={}).json()
    session_id = created["session_id"]
    oversized = client.post(f"/v1/live/sessions/{session_id}/frames", files={"frame": ("frame.jpg", b"x" * 65, "image/jpeg")})
    assert oversized.status_code == 413
    client.delete(f"/v1/live/sessions/{session_id}")
    missing = client.post(f"/v1/live/sessions/{session_id}/frames", files={"frame": ("frame.jpg", b"x" * 65, "image/jpeg")})
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_live_http_bounded_read_and_closed_session_maps_to_gone(monkeypatch):
    from fastapi import HTTPException
    from app.api import live as live_api
    from app.core.config import settings
    monkeypatch.setattr(settings, "max_upload_bytes", 64)
    session = LiveSession(__import__("uuid").uuid4(), LiveSessionCreate())
    monkeypatch.setattr(live_api, "_session_or_404", lambda _session_id: session)
    class Frame:
        content_type = "image/jpeg"
        read_limit = None
        async def read(self, limit):
            self.read_limit = limit
            return b"x" * limit
    frame = Frame()
    with pytest.raises(HTTPException) as oversized:
        await live_api.process_live_frame(session.session_id, frame)
    assert oversized.value.status_code == 413
    assert frame.read_limit == 65
    session.close()
    class SmallFrame(Frame):
        async def read(self, limit):
            self.read_limit = limit
            return b"x" * 10
    with pytest.raises(HTTPException) as gone:
        await live_api.process_live_frame(session.session_id, SmallFrame())
    assert gone.value.status_code == 410


