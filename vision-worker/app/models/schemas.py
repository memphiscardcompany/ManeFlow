from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


PricingStatus = Literal["verified", "price_unverifiable", "insufficient_comps"]
CorrectionStatus = Literal["pending", "reviewed", "accepted", "rejected"]


class PredictedCard(BaseModel):
    card_id: UUID | None = None
    year: int | None = None
    brand: str | None = None
    set_name: str | None = None
    insert_name: str | None = None
    player_name: str | None = None
    team: str | None = None
    sport: str | None = None
    card_number: str | None = None
    parallel: str | None = None
    serial_number: str | None = None
    rookie: bool | None = None
    autograph: bool | None = None
    memorabilia: bool | None = None
    language: str | None = None
    grader: str | None = None
    grade: str | None = None
    cert_number: str | None = None


class PricingResult(BaseModel):
    pricing_status: PricingStatus
    value_low: Decimal | None = None
    value_mid: Decimal | None = None
    value_high: Decimal | None = None
    confidence_score: float = Field(ge=0, le=1)
    recommended_cash_offer_low: Decimal | None = None
    recommended_cash_offer_high: Decimal | None = None
    recommended_list_price: Decimal | None = None
    comps_used: int = 0
    outliers_removed: int = 0
    explanation: str


class ScanImageQuality(BaseModel):
    width: int
    height: int
    blur_score: float
    glare_fraction: float = Field(ge=0, le=1)
    brightness: float = Field(ge=0, le=255)
    quality_score: int = Field(ge=0, le=100)
    warnings: list[str] = Field(default_factory=list)




class SurfaceAnalysisPayload(BaseModel):
    detected_surface_type: Literal[
        "BASE", "SILVER_HOLOFRACTOR", "GOLD_REFRACTOR", "CRACKED_ICE", "MOJO", "WAVE"
    ]
    refractor_confidence: float = Field(ge=0, le=1)
    rainbow_variance: float = Field(ge=0, le=1)
    reflectivity_score: float = Field(ge=0, le=1)
    texture_entropy: float = Field(ge=0, le=1)
    high_reflectivity_patches: int = Field(ge=0)
    classifier_mode: str
    warnings: list[str] = Field(default_factory=list)


class VisualEmbeddingPayload(BaseModel):
    vector: list[float] = Field(min_length=1152, max_length=1152)
    model_name: str
    provider: str
    dimensions: Literal[1152] = 1152
    normalized: bool = True


class CenteringAssessmentPayload(BaseModel):
    centering_lr: str
    centering_tb: str
    estimated_centering_score: float = Field(ge=1, le=10)
    edge_wear_detected: bool
    corner_wear_score: float = Field(ge=1, le=10)
    left_border_px: int = Field(ge=0)
    right_border_px: int = Field(ge=0)
    top_border_px: int = Field(ge=0)
    bottom_border_px: int = Field(ge=0)
    confidence: float = Field(ge=0, le=1)
    warnings: list[str] = Field(default_factory=list)


class DetectedCardResult(BaseModel):
    """Independent identity result for one card detected in a scene."""

    detection_index: int = Field(ge=0)
    bounding_box_px: tuple[int, int, int, int]
    detection_confidence: float = Field(ge=0, le=1)
    fallback_whole_image: bool = False
    predicted_card: PredictedCard
    identity_confidence: float = Field(ge=0, le=1)
    variant_confidence: float = Field(default=0, ge=0, le=1)
    identity_provider: str = "unconfigured"
    image_processed_remotely: bool = False
    needs_back_image: bool = True
    needs_manual_confirmation: bool = True
    barcode_values: list[str] = Field(default_factory=list)
    visible_text: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ScanResponse(PricingResult):
    contract_version: Literal["vision-extraction.v1"] = "vision-extraction.v1"
    scan_id: UUID
    predicted_card: PredictedCard
    identity_confidence: float = Field(ge=0, le=1)
    variant_confidence: float = Field(default=0, ge=0, le=1)
    detected_object_count: int = 0
    detected_cards: list[DetectedCardResult] = Field(default_factory=list)
    selected_detection_confidence: float = Field(default=0, ge=0, le=1)
    quality: ScanImageQuality | None = None
    identity_provider: str = "unconfigured"
    image_processed_remotely: bool = False
    needs_back_image: bool = True
    needs_manual_confirmation: bool = True
    barcode_values: list[str] = Field(default_factory=list)
    visible_text: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    surface_analysis: SurfaceAnalysisPayload | None = None
    centering_assessment: CenteringAssessmentPayload | None = None
    detected_surface_type: str | None = None
    refractor_confidence: float = Field(default=0, ge=0, le=1)
    visual_embedding: VisualEmbeddingPayload | None = None
    image_url: str | None = None
    created_at: datetime


class CorrectionRequest(BaseModel):
    corrected_card_id: UUID | None = None
    corrected_fields: dict[str, Any]
    notes: str | None = None


class CorrectionResponse(BaseModel):
    correction_id: UUID
    scan_id: UUID
    status: CorrectionStatus
    created_at: datetime


class CompInput(BaseModel):
    price: Decimal
    shipping: Decimal = Decimal("0")
    sold_at: datetime | None = None
    marketplace: str = "unknown"
    verified: bool = True
    title: str | None = None
    raw_payload: dict[str, Any] | None = None
