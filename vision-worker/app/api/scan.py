from datetime import datetime, timezone
from uuid import uuid4

import cv2
from fastapi import APIRouter, File, HTTPException, UploadFile

from app.core.config import settings
from app.db.supabase import db
from app.models.schemas import (
    CenteringAssessmentPayload,
    DetectedCardResult,
    ScanImageQuality,
    ScanResponse,
    SurfaceAnalysisPayload,
    VisualEmbeddingPayload,
)
from app.services.comps import comps_service
from app.services.centering_engine import assess_centering
from app.services.identity_engine import identity_engine
from app.services.imaging.barcode import decode_barcodes
from app.services.imaging.card_detector import decode_image
from app.services.imaging.detector_router import detect_card_objects
from app.services.imaging.embedding_engine import EmbeddingEngineError, embedding_engine
from app.services.imaging.quality import analyze_image_quality
from app.services.imaging.surface_classifier import analyze_surface
from app.services.storage import image_storage

router = APIRouter(tags=["scan"])
_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}


@router.post("/scan", response_model=ScanResponse)
async def scan_card(image: UploadFile = File(...)) -> ScanResponse:
    if image.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported image type.")

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Image file is empty.")
    if len(image_bytes) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Image exceeds upload limit.")

    try:
        decoded = decode_image(image_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    scan_id = uuid4()
    created_at = datetime.now(timezone.utc)
    image_url = await image_storage.save_scan_image(image_bytes, image.content_type)
    quality = analyze_image_quality(decoded)
    detections = detect_card_objects(decoded, allow_whole_image_fallback=True)
    warnings = list(quality.warnings)

    selected_confidence = 0.0
    identity_payload = image_bytes
    identity_media_type = image.content_type
    barcode_source = decoded
    detected_cards: list[DetectedCardResult] = []
    primary_identity = None

    # A scene is a set of independent cards, not one image-level identity.
    # Put the strongest card first for backwards-compatible top-level fields,
    # then identify every remaining crop independently.
    ordered_detections = sorted(
        detections,
        key=lambda item: (item.confidence * max(item.area_fraction, 0.01), item.confidence),
        reverse=True,
    )

    if ordered_detections:
        selected = ordered_detections[0]
        selected_confidence = selected.confidence
        barcode_source = selected.crop
        ok, encoded = cv2.imencode(
            ".jpg", selected.crop, [int(cv2.IMWRITE_JPEG_QUALITY), 92]
        )
        if ok:
            identity_payload = encoded.tobytes()
            identity_media_type = "image/jpeg"
        if selected.fallback_whole_image:
            warnings.append("Whole-image boundary fallback used; confirm the crop.")
    else:
        warnings.append(
            "No card boundary was detected; the full image was passed only to a configured identity provider."
        )

    # Identify every detected card. The top-level response below remains the
    # strongest card so existing single-card clients keep working.
    for detection_index, detection in enumerate(ordered_detections):
        ok, encoded = cv2.imencode(
            ".jpg", detection.crop, [int(cv2.IMWRITE_JPEG_QUALITY), 92]
        )
        crop_bytes = encoded.tobytes() if ok else image_bytes
        crop_media_type = "image/jpeg" if ok else image.content_type
        crop_barcodes = decode_barcodes(detection.crop)
        crop_identity = await identity_engine.identify(
            crop_bytes,
            image.filename,
            media_type=crop_media_type,
            barcode_values=crop_barcodes,
        )
        crop_identity = await identity_engine._enrich_with_psa(crop_identity)
        if detection_index == 0:
            primary_identity = crop_identity
        crop_manual = (
            crop_identity.identity_confidence < 0.92
            or crop_identity.variant_confidence < 0.85
            or crop_identity.needs_back_image
        )
        detected_cards.append(
            DetectedCardResult(
                detection_index=detection_index,
                bounding_box_px=detection.bounding_box_px,
                detection_confidence=detection.confidence,
                predicted_card=crop_identity.card,
                identity_confidence=crop_identity.identity_confidence,
                variant_confidence=crop_identity.variant_confidence,
                identity_provider=crop_identity.provider,
                image_processed_remotely=crop_identity.processed_remotely,
                needs_back_image=crop_identity.needs_back_image,
                needs_manual_confirmation=crop_manual,
                barcode_values=crop_identity.barcode_values,
                visible_text=crop_identity.visible_text,
                warnings=crop_identity.warnings,
            )
        )

    surface_analysis = None
    centering_assessment = None
    visual_embedding = None
    try:
        surface_analysis = analyze_surface(barcode_source)
        warnings.extend(surface_analysis.warnings)
    except ValueError as exc:
        warnings.append(f"Surface analysis skipped: {exc}")
    try:
        centering_assessment = assess_centering(barcode_source)
        warnings.extend(centering_assessment.warnings)
    except ValueError as exc:
        warnings.append(f"Centering assessment skipped: {exc}")

    if settings.embedding_enabled:
        try:
            visual_embedding = embedding_engine.extract(barcode_source)
        except EmbeddingEngineError as exc:
            warnings.append(f"Local embedding extraction unavailable: {exc}")

    if detected_cards and primary_identity is not None:
        barcode_values = detected_cards[0].barcode_values
        identity = primary_identity
    else:
        barcode_values = decode_barcodes(barcode_source)
        identity = await identity_engine.identify(
            identity_payload,
            image.filename,
            media_type=identity_media_type,
            barcode_values=barcode_values,
        )
        identity = await identity_engine._enrich_with_psa(identity)
    warnings.extend(identity.warnings)

    pricing = await comps_service.pricing_for_card(identity.card)
    needs_manual_confirmation = (
        identity.identity_confidence < 0.92
        or identity.variant_confidence < 0.85
        or identity.needs_back_image
        or pricing["pricing_status"] != "verified"
    )
    if needs_manual_confirmation:
        warnings.append(
            "Manual confirmation is required before adding, pricing, listing, or purchasing this card."
        )

    predicted_fields = identity.card.model_dump(mode="json")
    await db.insert_scan_event(
        {
            "id": str(scan_id),
            "image_url": image_url,
            "filename": image.filename,
            "mime_type": image.content_type,
            "identity_confidence": identity.identity_confidence,
            "predicted_card_id": str(identity.card.card_id) if identity.card.card_id else None,
            "predicted_fields": predicted_fields,
            "pricing_status": pricing["pricing_status"],
            "device_metadata": {
                "detected_object_count": len(detections),
                "selected_detection_confidence": selected_confidence,
                "quality": quality.to_dict(),
                "identity_provider": identity.provider,
                "image_processed_remotely": identity.processed_remotely,
                "variant_confidence": identity.variant_confidence,
                "barcode_values": identity.barcode_values,
                "visible_text": identity.visible_text,
                "warnings": warnings,
                "surface_analysis": surface_analysis.to_dict() if surface_analysis else None,
                "centering_assessment": centering_assessment.to_dict() if centering_assessment else None,
                "visual_embedding": {
                    "model_name": visual_embedding.model_name,
                    "provider": visual_embedding.provider,
                    "dimensions": visual_embedding.dimensions,
                    "normalized": visual_embedding.normalized,
                } if visual_embedding else None,
            },
            "created_at": created_at.isoformat(),
        }
    )

    return ScanResponse(
        scan_id=scan_id,
        predicted_card=identity.card,
        identity_confidence=identity.identity_confidence,
        variant_confidence=identity.variant_confidence,
        detected_object_count=len(detections),
        detected_cards=detected_cards,
        selected_detection_confidence=selected_confidence,
        quality=ScanImageQuality(**quality.to_dict()),
        identity_provider=identity.provider,
        image_processed_remotely=identity.processed_remotely,
        needs_back_image=identity.needs_back_image,
        needs_manual_confirmation=needs_manual_confirmation,
        barcode_values=identity.barcode_values,
        visible_text=identity.visible_text,
        warnings=list(dict.fromkeys(warnings)),
        surface_analysis=SurfaceAnalysisPayload(**surface_analysis.to_dict()) if surface_analysis else None,
        centering_assessment=CenteringAssessmentPayload(**centering_assessment.to_dict()) if centering_assessment else None,
        detected_surface_type=surface_analysis.detected_surface_type if surface_analysis else None,
        refractor_confidence=surface_analysis.refractor_confidence if surface_analysis else 0.0,
        visual_embedding=VisualEmbeddingPayload(**visual_embedding.to_dict()) if visual_embedding else None,
        image_url=image_url,
        created_at=created_at,
        **pricing,
    )
