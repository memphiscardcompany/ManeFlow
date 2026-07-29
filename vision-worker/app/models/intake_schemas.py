from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


ContributionScope = Literal[
    "private",
    "labels_only",
    "images_and_labels",
    "reference_catalog",
]
PairingStrategy = Literal["auto", "filename", "alternating"]
ReviewStatus = Literal["unreviewed", "confirmed", "corrected", "rejected"]


class ContributorConsentUpsert(BaseModel):
    contributor_id: UUID | None = None
    display_name: str | None = Field(default=None, max_length=120)
    consent_scope: ContributionScope = "private"
    consent_version: str = Field(default="2026-07-beta-1", max_length=80)
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("display_name", "notes")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class ContributorConsentResponse(BaseModel):
    contributor_id: UUID
    display_name: str | None
    consent_scope: ContributionScope
    consent_version: str
    consented_at: str
    revoked_at: str | None = None


class RicohFolderImportRequest(BaseModel):
    folder_path: str
    batch_name: str | None = Field(default=None, max_length=160)
    contributor_id: UUID | None = None
    scanner_model: str = Field(default="Ricoh duplex scanner", max_length=160)
    pairing_strategy: PairingStrategy = "auto"
    copy_into_maneflow: bool = True
    process_immediately: bool = True
    max_items: int = Field(default=5000, ge=1, le=50000)

    @field_validator("folder_path")
    @classmethod
    def require_folder(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("folder_path is required")
        return cleaned


class PhotoFolderImportRequest(BaseModel):
    folder_path: str
    batch_name: str | None = Field(default=None, max_length=160)
    contributor_id: UUID | None = None
    capture_device: str = Field(default="Phone / camera folder", max_length=160)
    copy_into_maneflow: bool = True
    owner_authorized_learning: bool = True
    max_images: int = Field(default=10000, ge=1, le=50000)

    @field_validator("folder_path")
    @classmethod
    def require_photo_folder(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("folder_path is required")
        return cleaned


class BulkItemReviewRequest(BaseModel):
    confirmed_fields: dict[str, Any] = Field(default_factory=dict)
    review_status: ReviewStatus = "confirmed"
    notes: str | None = Field(default=None, max_length=2000)


class BulkBatchStatusUpdate(BaseModel):
    status: Literal["imported", "processing", "review", "complete", "cancelled"]


class ContributionPackImportResponse(BaseModel):
    imported_examples: int
    duplicates_skipped: int
    rejected_examples: int


class ContributionCurationRequest(BaseModel):
    curation_status: Literal["pending", "approved", "rejected"]
    notes: str | None = Field(default=None, max_length=2000)
