from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import cv2

from app.models.lot_schemas import (
    BoundingBox,
    DetectedItem,
    DetectionEvidence,
    ImageQualityMetrics,
    LotAnalysisResponse,
    LotAssumptions,
    LotEconomics,
    LotSourceImage,
    Point,
)
from app.services.comps import comps_service
from app.services.centering_engine import assess_centering
from app.services.identity_engine import identity_engine
from app.services.imaging.barcode import decode_barcodes
from app.services.imaging.card_detector import decode_image
from app.services.imaging.detector_router import detect_card_objects
from app.services.imaging.fingerprint import difference_hash
from app.services.imaging.reconciliation import PhysicalItemReconciler
from app.services.imaging.quality import analyze_image_quality
from app.services.imaging.surface_classifier import analyze_surface
from app.services.lot_economics import ItemValue, calculate_lot_economics
from app.services.lot_repository import lot_repository
from app.services.storage import image_storage


class LotEngine:
    async def analyze(
        self,
        uploads: list[tuple[str, str, bytes]],
        *,
        listing_price: Decimal,
        inbound_shipping: Decimal,
        sales_tax: Decimal,
        source_type: str,
        source_url: str | None,
        marketplace_fee_rate: Decimal,
        payment_fee_fixed: Decimal,
        outbound_shipping_per_item: Decimal,
        target_roi: Decimal,
    ) -> LotAnalysisResponse:
        job_id = uuid4()
        created_at = datetime.now(timezone.utc)
        source_results: list[LotSourceImage] = []
        all_items: list[DetectedItem] = []
        reconciler = PhysicalItemReconciler()
        warnings: list[str] = []

        for filename, content_type, image_bytes in uploads:
            source_image_id = uuid4()
            image = decode_image(image_bytes)
            quality = analyze_image_quality(image)
            source_url_result = await image_storage.save_scan_image(image_bytes, content_type)
            detections = detect_card_objects(image)

            if not detections:
                warnings.append(f"No card-shaped objects were confidently detected in {filename}.")

            source_items: list[DetectedItem] = []
            image_h, image_w = image.shape[:2]
            for index, detection in enumerate(detections):
                crop = detection.crop
                crop_quality = analyze_image_quality(crop)
                fingerprint = difference_hash(crop)
                ok, encoded = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
                crop_url = None
                if ok:
                    crop_url = await image_storage.save_scan_image(encoded.tobytes(), "image/jpeg")

                surface_analysis = None
                centering_assessment = None
                try:
                    surface_analysis = analyze_surface(crop)
                except ValueError:
                    surface_analysis = None
                try:
                    centering_assessment = assess_centering(crop)
                except ValueError:
                    centering_assessment = None

                barcode_values = decode_barcodes(crop)
                identity = await identity_engine.identify(
                    encoded.tobytes() if ok else image_bytes,
                    None,
                    media_type="image/jpeg" if ok else content_type,
                    barcode_values=barcode_values,
                )
                pricing = await comps_service.pricing_for_card(identity.card)
                grouping = reconciler.register(
                    source_image_id=source_image_id,
                    fingerprint=fingerprint,
                    card=identity.card,
                    identity_confidence=identity.identity_confidence,
                    card_side=identity.card_side,
                )

                x, y, width, height = detection.bounding_box_px
                polygon = [
                    Point(x=float(point[0]) / image_w, y=float(point[1]) / image_h)
                    for point in detection.polygon_px
                ]
                item_warnings = list(crop_quality.warnings)
                if detection.fallback_whole_image:
                    item_warnings.append("Whole-image fallback used; object boundary needs confirmation.")
                if detection.rectangularity < 0.72:
                    item_warnings.append(
                        "The object may be partly hidden or irregular; exact identification needs another angle."
                    )
                item_warnings.extend(identity.warnings)
                if surface_analysis:
                    item_warnings.extend(surface_analysis.warnings)
                if centering_assessment:
                    item_warnings.extend(centering_assessment.warnings)
                if identity.identity_confidence <= 0:
                    item_warnings.append(
                        "Card object was detected, but identity was not verified by OCR, vision, cert, or user evidence."
                    )
                if identity.is_trading_card is False:
                    item_warnings.append(
                        "The configured visual provider rejected this crop as a trading card; exclude it unless manually corrected."
                    )
                if grouping.method in {"visual_duplicate", "front_back_identity"}:
                    item_warnings.append(
                        f"Repeated-view grouping used {grouping.method}; confirm that separate copies were not merged."
                    )

                if identity.card.grader or identity.card.cert_number:
                    detected_kind = "slab"
                elif detection.kind_hint != "unknown_card_object":
                    detected_kind = detection.kind_hint
                elif identity.is_trading_card is True:
                    detected_kind = "raw_card"
                else:
                    detected_kind = "unknown_card_object"

                item = DetectedItem(
                    item_id=uuid4(),
                    source_image_id=source_image_id,
                    instance_index=index,
                    physical_item_group=grouping.group_id,
                    grouping_method=grouping.method,
                    grouping_confidence=grouping.confidence,
                    kind=detected_kind,
                    detection_confidence=detection.confidence,
                    visibility_fraction=min(1.0, max(0.05, detection.rectangularity)),
                    bounding_box=BoundingBox(
                        x=max(0.0, x / image_w),
                        y=max(0.0, y / image_h),
                        width=min(1.0, width / image_w),
                        height=min(1.0, height / image_h),
                    ),
                    polygon=polygon,
                    crop_image_url=crop_url,
                    fingerprint=fingerprint,
                    crop_quality=ImageQualityMetrics(**crop_quality.to_dict()),
                    predicted_card=identity.card,
                    identity_confidence=identity.identity_confidence,
                    variant_confidence=identity.variant_confidence,
                    pricing_status=pricing["pricing_status"],
                    value_low=pricing["value_low"],
                    value_mid=pricing["value_mid"],
                    value_high=pricing["value_high"],
                    pricing_confidence=pricing["confidence_score"],
                    surface_analysis=surface_analysis.to_dict() if surface_analysis else None,
                    centering_assessment=centering_assessment.to_dict() if centering_assessment else None,
                    evidence=DetectionEvidence(
                        detector=detection.detector_name,
                        rectangularity=detection.rectangularity,
                        aspect_ratio=detection.aspect_ratio,
                        area_fraction=detection.area_fraction,
                        fallback_whole_image=detection.fallback_whole_image,
                        identity_provider=identity.provider,
                        image_processed_remotely=identity.processed_remotely,
                        card_side=identity.card_side,
                        is_trading_card=identity.is_trading_card,
                        barcode_values=identity.barcode_values,
                        visible_text=identity.visible_text,
                    ),
                    warnings=list(dict.fromkeys(item_warnings)),
                )
                source_items.append(item)
                all_items.append(item)

            source_results.append(
                LotSourceImage(
                    source_image_id=source_image_id,
                    filename=filename,
                    image_url=source_url_result,
                    quality=ImageQualityMetrics(**quality.to_dict()),
                    detections=source_items,
                )
            )

        # Economics count one physical group once. Until stronger cross-view reconciliation exists,
        # the most confident instance in each visual group represents the item.
        representatives: dict[str, DetectedItem] = {}
        for item in all_items:
            current = representatives.get(item.physical_item_group)
            if current is None or item.detection_confidence > current.detection_confidence:
                representatives[item.physical_item_group] = item

        countable_representatives = {
            group: item
            for group, item in representatives.items()
            if item.evidence.is_trading_card is not False
        }
        rejected_objects = len(representatives) - len(countable_representatives)
        if rejected_objects:
            warnings.append(
                f"{rejected_objects} detected rectangle(s) were rejected as non-card objects by the configured identity provider."
            )

        economics_raw = calculate_lot_economics(
            [
                ItemValue(
                    value_low=item.value_low,
                    value_mid=item.value_mid,
                    value_high=item.value_high,
                    identity_confidence=item.identity_confidence,
                )
                for item in countable_representatives.values()
            ],
            listing_price=listing_price,
            inbound_shipping=inbound_shipping,
            sales_tax=sales_tax,
            marketplace_fee_rate=marketplace_fee_rate,
            payment_fee_fixed=payment_fee_fixed,
            outbound_shipping_per_item=outbound_shipping_per_item,
            target_roi=target_roi,
        )

        response = LotAnalysisResponse(
            job_id=job_id,
            status="completed",
            source_type=source_type,
            source_url=source_url,
            created_at=created_at,
            completed_at=datetime.now(timezone.utc),
            images=source_results,
            physical_item_count=len(countable_representatives),
            assumptions=LotAssumptions(
                marketplace_fee_rate=marketplace_fee_rate,
                payment_fee_fixed=payment_fee_fixed,
                outbound_shipping_per_item=outbound_shipping_per_item,
                target_roi=target_roi,
            ),
            economics=LotEconomics(**economics_raw.to_dict()),
            warnings=warnings,
        )
        lot_repository.save_job(job_id, response.model_dump(mode="json"))
        return response


lot_engine = LotEngine()
