from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from app.core.config import settings
from app.services.imaging.card_detector import CardDetection
from app.services.imaging.rectify import rectify_quadrilateral
from maneflow_vision.gpu.runtime import (
    ComputeDecision,
    configure_torch_memory,
    resolve_compute_device,
    run_with_oom_recovery,
)


_ALLOWED_KINDS = {
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
}


class LearnedCardDetector:
    """
    Optional Ultralytics detector/segmenter adapter.

    Train or export weights with classes such as raw_card, slab, toploader,
    one_touch, sealed_pack, and unknown_card_object. Segmentation masks are used
    when available, enabling overlapping-card instance separation.
    """

    def __init__(self, model_path: str) -> None:
        path = Path(model_path).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Detector model was not found: {path}")
        try:
            from ultralytics import YOLO
        except ImportError as exc:  # pragma: no cover - optional deployment dependency
            raise RuntimeError(
                "Ultralytics is not installed; install backend/requirements-vision.txt."
            ) from exc
        self.path = path
        self.model = YOLO(str(path))
        self.compute_decision = resolve_compute_device(
            "card_detection",
            gpu_device_id=settings.maneflow_gpu_device_id,
            allow_cpu_fallback=settings.maneflow_gpu_allow_cpu_fallback,
        )
        try:
            import torch
            configure_torch_memory(torch, self.compute_decision)
        except ImportError:
            pass

    @staticmethod
    def _polygon_from_mask(mask_xy: object) -> np.ndarray | None:
        if mask_xy is None:
            return None
        points = np.asarray(mask_xy, dtype=np.float32).reshape(-1, 2)
        if len(points) < 4:
            return None
        rect = cv2.minAreaRect(points)
        return cv2.boxPoints(rect).astype(np.float32)

    def _predict(self, image: np.ndarray, decision: ComputeDecision):
        return self.model.predict(
            source=image,
            conf=settings.card_detector_confidence,
            iou=settings.card_detector_iou,
            max_det=settings.max_detections_per_image,
            device=decision.ultralytics_device,
            half=bool(settings.maneflow_gpu_mixed_precision and decision.is_cuda),
            verbose=False,
        )

    def readiness(self) -> dict[str, object]:
        return {
            "model_path": str(self.path),
            "compute": self.compute_decision.to_dict(),
        }

    def detect(self, image: np.ndarray) -> list[CardDetection]:
        result_list, actual_decision = run_with_oom_recovery(
            lambda decision: self._predict(image, decision),
            self.compute_decision,
            allow_cpu_fallback=settings.maneflow_gpu_allow_cpu_fallback,
        )
        self.compute_decision = actual_decision
        if not result_list:
            return []
        result = result_list[0]
        boxes = getattr(result, "boxes", None)
        if boxes is None or len(boxes) == 0:
            return []

        image_h, image_w = image.shape[:2]
        image_area = float(image_h * image_w)
        names = getattr(result, "names", {}) or {}
        masks = getattr(result, "masks", None)
        mask_polygons = getattr(masks, "xy", None) if masks is not None else None

        detections: list[CardDetection] = []
        xyxy = boxes.xyxy.cpu().numpy()
        confidences = boxes.conf.cpu().numpy()
        classes = boxes.cls.cpu().numpy().astype(int)

        for index, (coords, confidence, class_id) in enumerate(
            zip(xyxy, confidences, classes, strict=False)
        ):
            x1, y1, x2, y2 = [float(value) for value in coords]
            if x2 <= x1 or y2 <= y1:
                continue
            polygon = None
            if mask_polygons is not None and index < len(mask_polygons):
                polygon = self._polygon_from_mask(mask_polygons[index])
            if polygon is None:
                polygon = np.array(
                    [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float32
                )

            rect = cv2.minAreaRect(polygon)
            (_, _), (rect_w, rect_h), _ = rect
            if rect_w <= 1 or rect_h <= 1:
                continue
            long_side = max(rect_w, rect_h)
            short_side = min(rect_w, rect_h)
            aspect_ratio = short_side / long_side
            area = rect_w * rect_h
            area_fraction = min(1.0, area / image_area) if image_area else 0.0
            contour_area = abs(float(cv2.contourArea(polygon)))
            rectangularity = min(1.0, contour_area / area) if area else 0.0

            crop = rectify_quadrilateral(image, polygon)
            bx, by, bw, bh = cv2.boundingRect(polygon.astype(np.int32))
            label = str(names.get(class_id, "unknown_card_object")).lower().strip()
            label = label.replace(" ", "_").replace("-", "_")
            kind_hint = label if label in _ALLOWED_KINDS else "unknown_card_object"
            detections.append(
                CardDetection(
                    polygon_px=polygon,
                    bounding_box_px=(max(0, bx), max(0, by), max(1, bw), max(1, bh)),
                    confidence=round(float(confidence), 4),
                    rectangularity=round(float(rectangularity), 4),
                    aspect_ratio=round(float(aspect_ratio), 4),
                    area_fraction=round(float(area_fraction), 4),
                    fallback_whole_image=False,
                    crop=crop,
                    detector_name=f"ultralytics:{self.path.name}",
                    kind_hint=kind_hint,
                )
            )
        return detections
