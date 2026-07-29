from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter

from app.db.supabase import db
from app.models.schemas import CorrectionRequest, CorrectionResponse

router = APIRouter(tags=["corrections"])


@router.post("/cards/{scan_id}/correct", response_model=CorrectionResponse)
async def correct_scan(scan_id: UUID, request: CorrectionRequest) -> CorrectionResponse:
    correction_id = uuid4()
    created_at = datetime.now(timezone.utc)

    await db.insert_correction(
        {
            "id": str(correction_id),
            "scan_id": str(scan_id),
            "corrected_card_id": str(request.corrected_card_id) if request.corrected_card_id else None,
            "corrected_fields": request.corrected_fields,
            "notes": request.notes,
            "status": "pending",
            "created_at": created_at.isoformat(),
        }
    )

    return CorrectionResponse(
        correction_id=correction_id,
        scan_id=scan_id,
        status="pending",
        created_at=created_at,
    )
