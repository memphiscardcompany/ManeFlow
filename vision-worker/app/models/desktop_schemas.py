from __future__ import annotations

from typing import Any
from uuid import UUID
from pydantic import BaseModel, Field


class VaultItemUpsert(BaseModel):
    id: UUID | None = None
    scan_id: str | None = None
    player_name: str | None = None
    year: int | None = None
    brand: str | None = None
    set_name: str | None = None
    insert_name: str | None = None
    card_number: str | None = None
    parallel: str | None = None
    serial_number: str | None = None
    sport: str | None = None
    team: str | None = None
    grader: str | None = None
    grade: str | None = None
    cert_number: str | None = None
    rookie: bool | None = None
    autograph: bool | None = None
    memorabilia: bool | None = None
    value_low: float | None = None
    value_mid: float | None = None
    value_high: float | None = None
    acquisition_cost: float | None = None
    status: str = "owned"
    front_image_path: str | None = None
    back_image_path: str | None = None
    notes: str | None = None
    source: dict[str, Any] = Field(default_factory=dict)


class GradingItemCreate(BaseModel):
    vault_item_id: UUID | None = None
    grader: str = "PSA"
    service_level: str | None = None
    status: str = "pre_grade"
    grading_fee: float | None = None
    outbound_tracking: str | None = None
    submission_number: str | None = None
    expected_return: str | None = None
    notes: str | None = None


class GradingItemUpdate(BaseModel):
    grader: str | None = None
    service_level: str | None = None
    status: str | None = None
    grading_fee: float | None = None
    outbound_tracking: str | None = None
    submission_number: str | None = None
    expected_return: str | None = None
    notes: str | None = None


class PricingCalculationRequest(BaseModel):
    prices: list[float | int | str]
    minimum_verified_comps: int = Field(default=3, ge=1, le=20)
