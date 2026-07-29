from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.schemas import CenteringAssessmentPayload, PredictedCard, PricingStatus, SurfaceAnalysisPayload


LotStatus = Literal["queued", "processing", "completed", "failed"]
LotPricingStatus = Literal["priced", "partially_priced", "unpriced"]
DetectionKind = Literal[
    "raw_card",
    "slab",
    "toploader",
    "one_touch",
    "sealed_pack",
    "partial_card",
    "card_stack",
    "team_bag",
    "sealed_box",
    "unknown_card_object",
]


class Point(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class BoundingBox(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class ImageQualityMetrics(BaseModel):
    width: int
    height: int
    blur_score: float
    glare_fraction: float = Field(ge=0, le=1)
    brightness: float = Field(ge=0, le=255)
    quality_score: int = Field(ge=0, le=100)
    warnings: list[str] = Field(default_factory=list)


class DetectionEvidence(BaseModel):
    detector: str
    rectangularity: float = Field(ge=0, le=1)
    aspect_ratio: float
    area_fraction: float = Field(ge=0, le=1)
    fallback_whole_image: bool = False
    identity_provider: str = "unconfigured"
    image_processed_remotely: bool = False
    card_side: str = "unknown"
    is_trading_card: bool | None = None
    barcode_values: list[str] = Field(default_factory=list)
    visible_text: list[str] = Field(default_factory=list)


class DetectedItem(BaseModel):
    item_id: UUID
    source_image_id: UUID
    instance_index: int
    physical_item_group: str
    grouping_method: str = "unique"
    grouping_confidence: float = Field(default=1.0, ge=0, le=1)
    kind: DetectionKind
    detection_confidence: float = Field(ge=0, le=1)
    visibility_fraction: float = Field(ge=0, le=1)
    bounding_box: BoundingBox
    polygon: list[Point]
    crop_image_url: str | None = None
    fingerprint: str
    crop_quality: ImageQualityMetrics
    predicted_card: PredictedCard
    identity_confidence: float = Field(ge=0, le=1)
    variant_confidence: float = Field(ge=0, le=1)
    pricing_status: PricingStatus
    value_low: Decimal | None = None
    value_mid: Decimal | None = None
    value_high: Decimal | None = None
    pricing_confidence: float = Field(ge=0, le=1)
    surface_analysis: SurfaceAnalysisPayload | None = None
    centering_assessment: CenteringAssessmentPayload | None = None
    evidence: DetectionEvidence
    warnings: list[str] = Field(default_factory=list)


class LotSourceImage(BaseModel):
    source_image_id: UUID
    filename: str
    image_url: str | None = None
    quality: ImageQualityMetrics
    detections: list[DetectedItem]


class LotAssumptions(BaseModel):
    marketplace_fee_rate: Decimal
    payment_fee_fixed: Decimal
    outbound_shipping_per_item: Decimal
    target_roi: Decimal


class LotEconomics(BaseModel):
    pricing_status: LotPricingStatus
    listing_price: Decimal
    inbound_shipping: Decimal
    sales_tax: Decimal
    acquisition_total: Decimal
    detected_physical_items: int
    exact_or_likely_items: int
    priced_items: int
    unresolved_items: int
    conservative_gross_value: Decimal | None = None
    expected_gross_value: Decimal | None = None
    optimistic_gross_value: Decimal | None = None
    expected_marketplace_fees: Decimal | None = None
    expected_outbound_shipping: Decimal | None = None
    expected_net_resale: Decimal | None = None
    expected_profit: Decimal | None = None
    expected_roi: float | None = None
    recommended_max_purchase: Decimal | None = None
    decision: str
    explanation: str


class LotAnalysisResponse(BaseModel):
    job_id: UUID
    status: LotStatus
    source_type: str
    source_url: str | None = None
    created_at: datetime
    completed_at: datetime | None = None
    images: list[LotSourceImage]
    physical_item_count: int
    assumptions: LotAssumptions
    economics: LotEconomics
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None


class LotCorrectionRequest(BaseModel):
    item_id: UUID
    corrected_fields: dict[str, Any] = Field(default_factory=dict)
    value_low: Decimal | None = None
    value_mid: Decimal | None = None
    value_high: Decimal | None = None
    notes: str | None = None


class LotCorrectionResponse(BaseModel):
    job_id: UUID
    item_id: UUID
    status: str
    updated_at: datetime
