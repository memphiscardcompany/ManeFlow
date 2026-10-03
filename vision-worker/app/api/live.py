from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.core.config import settings
from app.models.live_schemas import LiveFrameResponse, LiveSessionCreate, LiveSessionResponse
from app.services.live_session import SessionCapacityError, SessionClosedError, live_session_manager

router = APIRouter(tags=["live"])
_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}


def _session_or_404(session_id: UUID):
    session = live_session_manager.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Live session not found.")
    return session


@router.post("/live/sessions", response_model=LiveSessionResponse)
def create_live_session(request: LiveSessionCreate) -> LiveSessionResponse:
    try:
        # Client hints cannot force an identity attempt on every frame.
        safe_request = request.model_copy(update={"identity_refresh_interval": max(3, request.identity_refresh_interval)})
        return live_session_manager.create(safe_request).status()
    except SessionCapacityError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc


@router.get("/live/sessions/{session_id}", response_model=LiveSessionResponse)
def get_live_session(session_id: UUID) -> LiveSessionResponse:
    return _session_or_404(session_id).status()


@router.delete("/live/sessions/{session_id}")
def delete_live_session(session_id: UUID) -> dict[str, object]:
    if not live_session_manager.close(session_id):
        raise HTTPException(status_code=404, detail="Live session not found.")
    return {"deleted": True, "session_id": str(session_id)}


@router.post("/live/sessions/{session_id}/frames", response_model=LiveFrameResponse)
async def process_live_frame(
    session_id: UUID,
    frame: UploadFile = File(...),
) -> LiveFrameResponse:
    session = _session_or_404(session_id)
    if frame.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported frame type.")
    image_bytes = await frame.read(settings.max_upload_bytes + 1)
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Frame is empty.")
    if len(image_bytes) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Frame exceeds upload limit.")
    try:
        return await session.process_frame(image_bytes, frame.content_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SessionClosedError as exc:
        raise HTTPException(status_code=410, detail=str(exc)) from exc


