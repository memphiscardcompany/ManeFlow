from __future__ import annotations

from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response

from app.models.desktop_schemas import (
    GradingItemCreate,
    GradingItemUpdate,
    PricingCalculationRequest,
    VaultItemUpsert,
)
from app.services.desktop_repository import desktop_repository
from app.services.pricing_engine import calculate_pricing
from app.services.psa_client import psa_client

router = APIRouter(tags=["desktop"])


@router.get("/desktop/stats")
def desktop_stats() -> dict:
    return desktop_repository.stats()


@router.get("/vault")
def list_vault(search: str | None = None) -> list[dict]:
    return desktop_repository.list_vault_items(search)


@router.post("/vault")
def save_vault(request: VaultItemUpsert) -> dict:
    return desktop_repository.save_vault_item(request.model_dump(mode="json", exclude_none=False))


@router.delete("/vault/{item_id}")
def delete_vault(item_id: UUID) -> dict:
    if not desktop_repository.delete_vault_item(item_id):
        raise HTTPException(status_code=404, detail="Vault item not found.")
    return {"deleted": True, "id": str(item_id)}


@router.get("/vault/export.csv")
def export_vault() -> Response:
    return Response(
        desktop_repository.export_vault_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=maneflow-vault.csv"},
    )


@router.get("/grading")
def list_grading() -> list[dict]:
    return desktop_repository.list_grading_items()


@router.post("/grading")
def create_grading(request: GradingItemCreate) -> dict:
    return desktop_repository.create_grading_item(request.model_dump(mode="json"))


@router.patch("/grading/{item_id}")
def update_grading(item_id: UUID, request: GradingItemUpdate) -> dict:
    try:
        return desktop_repository.update_grading_item(item_id, request.model_dump(exclude_none=True))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Grading item not found.") from exc


@router.post("/pricing/calculate")
def pricing_calculate(request: PricingCalculationRequest) -> dict:
    return calculate_pricing(
        request.prices,
        minimum_verified_comps=request.minimum_verified_comps,
    ).to_dict()


@router.get("/psa/health")
async def health_psa() -> dict:
    return await psa_client.health()


@router.get("/psa/verify/{cert_number}")
async def verify_psa(cert_number: str) -> dict:
    try:
        return await psa_client.verify(cert_number)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
