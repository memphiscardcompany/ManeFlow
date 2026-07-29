from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.core.config import settings
from app.models.lot_schemas import (
    LotAnalysisResponse,
    LotCorrectionRequest,
    LotCorrectionResponse,
)
from app.services.ebay_listing import ebay_listing_client
from app.services.lot_engine import lot_engine
from app.services.lot_economics import ItemValue, calculate_lot_economics
from app.services.lot_repository import lot_repository

router = APIRouter(prefix="/lots", tags=["lots"])

_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}


@router.post("/analyze", response_model=LotAnalysisResponse)
async def analyze_lot(
    images: list[UploadFile] = File(...),
    listing_price: Decimal = Form(...),
    inbound_shipping: Decimal = Form(Decimal("0")),
    sales_tax: Decimal = Form(Decimal("0")),
    source_type: str = Form("ebay_listing"),
    source_url: str | None = Form(None),
    marketplace_fee_rate: Decimal = Form(Decimal(str(settings.default_marketplace_fee_rate))),
    payment_fee_fixed: Decimal = Form(Decimal(str(settings.default_payment_fee_fixed))),
    outbound_shipping_per_item: Decimal = Form(Decimal("0")),
    target_roi: Decimal = Form(Decimal(str(settings.default_target_roi))),
) -> LotAnalysisResponse:
    if not images:
        raise HTTPException(status_code=400, detail="At least one image is required.")
    if len(images) > settings.max_lot_images:
        raise HTTPException(
            status_code=413,
            detail=f"A lot may contain at most {settings.max_lot_images} source images per request.",
        )
    if listing_price < 0 or inbound_shipping < 0 or sales_tax < 0:
        raise HTTPException(status_code=422, detail="Lot costs cannot be negative.")

    uploads: list[tuple[str, str, bytes]] = []
    for upload in images:
        if upload.content_type not in _ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=415, detail=f"Unsupported image type: {upload.content_type}")
        payload = await upload.read()
        if not payload:
            raise HTTPException(status_code=400, detail=f"Image {upload.filename} is empty.")
        if len(payload) > settings.max_upload_bytes:
            raise HTTPException(status_code=413, detail=f"Image {upload.filename} exceeds upload limit.")
        uploads.append((upload.filename or "lot-image.jpg", upload.content_type, payload))

    return await lot_engine.analyze(
        uploads,
        listing_price=listing_price,
        inbound_shipping=inbound_shipping,
        sales_tax=sales_tax,
        source_type=source_type,
        source_url=source_url,
        marketplace_fee_rate=marketplace_fee_rate,
        payment_fee_fixed=payment_fee_fixed,
        outbound_shipping_per_item=outbound_shipping_per_item,
        target_roi=target_roi,
    )


@router.post("/analyze-ebay", response_model=LotAnalysisResponse)
async def analyze_ebay_listing(
    source_url: str = Form(...),
    listing_price_override: Decimal | None = Form(None),
    inbound_shipping_override: Decimal | None = Form(None),
    sales_tax: Decimal = Form(Decimal("0")),
    marketplace_fee_rate: Decimal = Form(Decimal(str(settings.default_marketplace_fee_rate))),
    payment_fee_fixed: Decimal = Form(Decimal(str(settings.default_payment_fee_fixed))),
    outbound_shipping_per_item: Decimal = Form(Decimal("0")),
    target_roi: Decimal = Form(Decimal(str(settings.default_target_roi))),
) -> LotAnalysisResponse:
    """Import listing photos and current ask data through eBay's configured API access."""
    try:
        listing = await ebay_listing_client.fetch_listing(source_url)
        uploads = await ebay_listing_client.download_images(listing)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        status_code = 503 if "credentials" in str(exc).lower() else 502
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"eBay listing import failed safely: {type(exc).__name__}.",
        ) from exc

    listing_price = listing_price_override if listing_price_override is not None else listing.listing_price
    inbound_shipping = (
        inbound_shipping_override
        if inbound_shipping_override is not None
        else listing.shipping_price
    )
    if listing_price < 0 or inbound_shipping < 0 or sales_tax < 0:
        raise HTTPException(status_code=422, detail="Lot costs cannot be negative.")

    result = await lot_engine.analyze(
        uploads,
        listing_price=listing_price,
        inbound_shipping=inbound_shipping,
        sales_tax=sales_tax,
        source_type="ebay_api_listing",
        source_url=listing.source_url,
        marketplace_fee_rate=marketplace_fee_rate,
        payment_fee_fixed=payment_fee_fixed,
        outbound_shipping_per_item=outbound_shipping_per_item,
        target_roi=target_roi,
    )
    if listing.title:
        result.warnings.insert(0, f"Imported eBay listing: {listing.title}")
        lot_repository.save_job(result.job_id, result.model_dump(mode="json"))
    return result


@router.get("/{job_id}", response_model=LotAnalysisResponse)
def get_lot(job_id: UUID) -> LotAnalysisResponse:
    payload = lot_repository.get_job(job_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Lot analysis job not found.")
    return LotAnalysisResponse.model_validate(payload)


@router.post("/{job_id}/correct", response_model=LotCorrectionResponse)
def correct_lot_item(job_id: UUID, request: LotCorrectionRequest) -> LotCorrectionResponse:
    payload = lot_repository.get_job(job_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Lot analysis job not found.")

    target_group: str | None = None
    for source_image in payload.get("images", []):
        for item in source_image.get("detections", []):
            if item.get("item_id") == str(request.item_id):
                target_group = item.get("physical_item_group")
                break
        if target_group:
            break

    if target_group is None:
        raise HTTPException(status_code=404, detail="Detected item not found in lot.")

    # Apply the correction to every repeated view of the same physical item.
    for source_image in payload.get("images", []):
        for item in source_image.get("detections", []):
            if item.get("physical_item_group") != target_group:
                continue
            item.setdefault("predicted_card", {}).update(request.corrected_fields)
            if request.corrected_fields:
                item["identity_confidence"] = 1.0
                item.setdefault("evidence", {})["is_trading_card"] = True
                item["kind"] = "slab" if (
                    item.get("predicted_card", {}).get("grader")
                    or item.get("predicted_card", {}).get("cert_number")
                ) else "raw_card"
            if request.value_low is not None:
                item["value_low"] = str(request.value_low)
            if request.value_mid is not None:
                item["value_mid"] = str(request.value_mid)
            if request.value_high is not None:
                item["value_high"] = str(request.value_high)
            if request.value_mid is not None:
                item["pricing_status"] = "verified"
                item["pricing_confidence"] = max(float(item.get("pricing_confidence", 0)), 0.5)
            item.setdefault("warnings", []).append(
                "User correction recorded; review before publishing or purchasing."
            )

    representatives: dict[str, dict] = {}
    for source_image in payload.get("images", []):
        for item in source_image.get("detections", []):
            group = item["physical_item_group"]
            current = representatives.get(group)
            if current is None or float(item.get("detection_confidence", 0)) > float(
                current.get("detection_confidence", 0)
            ):
                representatives[group] = item

    countable_representatives = {
        group: item
        for group, item in representatives.items()
        if item.get("evidence", {}).get("is_trading_card") is not False
    }
    payload["physical_item_count"] = len(countable_representatives)

    economics_before = payload["economics"]
    assumptions = payload["assumptions"]
    economics = calculate_lot_economics(
        [
            ItemValue(
                value_low=Decimal(str(item["value_low"])) if item.get("value_low") is not None else None,
                value_mid=Decimal(str(item["value_mid"])) if item.get("value_mid") is not None else None,
                value_high=Decimal(str(item["value_high"])) if item.get("value_high") is not None else None,
                identity_confidence=float(item.get("identity_confidence", 0)),
            )
            for item in countable_representatives.values()
        ],
        listing_price=Decimal(str(economics_before["listing_price"])),
        inbound_shipping=Decimal(str(economics_before["inbound_shipping"])),
        sales_tax=Decimal(str(economics_before["sales_tax"])),
        marketplace_fee_rate=Decimal(str(assumptions["marketplace_fee_rate"])),
        payment_fee_fixed=Decimal(str(assumptions["payment_fee_fixed"])),
        outbound_shipping_per_item=Decimal(str(assumptions["outbound_shipping_per_item"])),
        target_roi=Decimal(str(assumptions["target_roi"])),
    )
    payload["economics"] = economics.to_dict()

    lot_repository.save_job(job_id, payload)
    lot_repository.save_correction(job_id, request.item_id, request.model_dump(mode="json"))
    return LotCorrectionResponse(
        job_id=job_id,
        item_id=request.item_id,
        status="recorded_and_repriced",
        updated_at=datetime.now(timezone.utc),
    )
