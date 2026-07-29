from __future__ import annotations

import base64
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

import cv2
import httpx
import numpy as np

from app.core.config import settings
from app.services.imaging.card_detector import CardDetection
from app.services.imaging.rectify import rectify_quadrilateral


class RoboflowDetectorError(RuntimeError):
    """Raised when the configured Roboflow segmentation endpoint cannot be used safely."""


class PredictionRequest(Protocol):
    def __call__(self, encoded_image: str) -> Mapping[str, Any]: ...


@dataclass(frozen=True)
class RoboflowDetectorReadiness:
    enabled: bool
    configured: bool
    model_name: str
    endpoint_host: str | None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "configured": self.configured,
            "model_name": self.model_name,
            "endpoint_host": self.endpoint_host,
            "error": self.error,
        }


_KIND_ALIASES: dict[str, str] = {
    "raw_card": "raw_card",
    "card": "raw_card",
    "trading_card": "raw_card",
    "graded_slab": "slab",
    "slab": "slab",
    "psa_slab": "slab",
    "bgs_slab": "slab",
    "sgc_slab": "slab",
    "cgc_slab": "slab",
    "toploader": "toploader",
    "top_loader": "toploader",
    "one_touch": "one_touch",
    "one_touch_holder": "one_touch",
    "sealed_pack": "sealed_pack",
    "pack": "sealed_pack",
    "card_stack": "card_stack",
    "stack": "card_stack",
    "partial_card": "partial_card",
    "team_bag": "team_bag",
    "sealed_box": "sealed_box",
    "box": "sealed_box",
}


def _normalize_label(value: object) -> str:
    label = str(value or "unknown_card_object").strip().lower()
    label = "_".join(part for part in label.replace("-", " ").split() if part)
    return _KIND_ALIASES.get(label, "unknown_card_object")


def _finite_float(value: object, *, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise RoboflowDetectorError(f"Roboflow prediction field '{name}' is not numeric.") from exc
    if not np.isfinite(number):
        raise RoboflowDetectorError(f"Roboflow prediction field '{name}' is not finite.")
    return number


def _polygon_from_prediction(prediction: Mapping[str, Any]) -> np.ndarray:
    points = prediction.get("points")
    if isinstance(points, list) and len(points) >= 3:
        parsed: list[list[float]] = []
        for point in points:
            if not isinstance(point, Mapping):
                raise RoboflowDetectorError("Roboflow polygon points must be objects with x/y fields.")
            parsed.append(
                [
                    _finite_float(point.get("x"), name="points[].x"),
                    _finite_float(point.get("y"), name="points[].y"),
                ]
            )
        polygon = np.asarray(parsed, dtype=np.float32)
        if abs(float(cv2.contourArea(polygon))) >= 4.0:
            rect = cv2.minAreaRect(polygon)
            return cv2.boxPoints(rect).astype(np.float32)

    center_x = _finite_float(prediction.get("x"), name="x")
    center_y = _finite_float(prediction.get("y"), name="y")
    width = _finite_float(prediction.get("width"), name="width")
    height = _finite_float(prediction.get("height"), name="height")
    if width <= 1.0 or height <= 1.0:
        raise RoboflowDetectorError("Roboflow prediction has a non-positive bounding box.")
    half_width = width / 2.0
    half_height = height / 2.0
    return np.asarray(
        [
            [center_x - half_width, center_y - half_height],
            [center_x + half_width, center_y - half_height],
            [center_x + half_width, center_y + half_height],
            [center_x - half_width, center_y + half_height],
        ],
        dtype=np.float32,
    )


class RoboflowCardDetector:
    """
    Adapter for a trained Roboflow instance-segmentation model.

    The endpoint must be the exact model URL copied from Roboflow's deployment UI,
    for example ``https://outline.roboflow.com/project-slug/1``. Credentials remain
    server-side. The adapter accepts the documented instance-segmentation response
    shape and normalizes it to ManeFlow's CardDetection contract.
    """

    def __init__(
        self,
        *,
        endpoint: str | None = None,
        api_key: str | None = None,
        model_name: str | None = None,
        request: PredictionRequest | None = None,
    ) -> None:
        self.endpoint = str(endpoint or settings.roboflow_model_endpoint or "").strip().rstrip("/")
        self.api_key = str(api_key or settings.roboflow_api_key or "").strip()
        self.model_name = str(model_name or settings.roboflow_model_name).strip()
        self._request_override = request
        self._last_error: str | None = None

        if request is None and not self.endpoint:
            raise RoboflowDetectorError("ROBOFLOW_MODEL_ENDPOINT is not configured.")
        if request is None and self.endpoint.startswith("https://") and not self.api_key:
            raise RoboflowDetectorError("ROBOFLOW_API_KEY is required for the hosted endpoint.")

    @property
    def last_error(self) -> str | None:
        return self._last_error

    def _request(self, encoded_image: str) -> Mapping[str, Any]:
        if self._request_override is not None:
            return self._request_override(encoded_image)

        params: dict[str, str | int] = {
            "confidence": max(1, min(100, int(round(settings.roboflow_confidence * 100)))),
            "overlap": max(0, min(100, int(settings.roboflow_overlap))),
        }
        if self.api_key:
            params["api_key"] = self.api_key

        timeout = httpx.Timeout(
            connect=min(10.0, settings.roboflow_timeout_seconds),
            read=settings.roboflow_timeout_seconds,
            write=settings.roboflow_timeout_seconds,
            pool=min(10.0, settings.roboflow_timeout_seconds),
        )
        try:
            with httpx.Client(timeout=timeout, follow_redirects=False) as client:
                response = client.post(
                    self.endpoint,
                    params=params,
                    content=encoded_image,
                    headers={
                        "accept": "application/json",
                        "content-type": "application/x-www-form-urlencoded",
                        "user-agent": "ManeFlow-Vision/2.15",
                    },
                )
            if response.is_redirect:
                raise RoboflowDetectorError(
                    f"Roboflow endpoint returned an unexpected redirect ({response.status_code})."
                )
            try:
                payload = response.json()
            except ValueError as exc:
                raise RoboflowDetectorError(
                    f"Roboflow endpoint returned non-JSON content (HTTP {response.status_code})."
                ) from exc
            if response.status_code < 200 or response.status_code >= 300:
                detail = payload.get("message") or payload.get("error") or "request failed"
                raise RoboflowDetectorError(
                    f"Roboflow inference failed with HTTP {response.status_code}: {detail}"
                )
            if not isinstance(payload, Mapping):
                raise RoboflowDetectorError("Roboflow response must be a JSON object.")
            return payload
        except httpx.TimeoutException as exc:
            raise RoboflowDetectorError("Roboflow inference timed out.") from exc
        except httpx.HTTPError as exc:
            raise RoboflowDetectorError(f"Roboflow inference transport failure: {exc}") from exc

    def detect(self, image: np.ndarray) -> list[CardDetection]:
        if image.ndim != 3 or image.shape[2] not in (3, 4):
            raise RoboflowDetectorError("Roboflow detector input must be a BGR or BGRA image.")
        bgr = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR) if image.shape[2] == 4 else image
        ok, encoded = cv2.imencode(
            ".jpg",
            bgr,
            [int(cv2.IMWRITE_JPEG_QUALITY), max(70, min(100, settings.roboflow_jpeg_quality))],
        )
        if not ok:
            raise RoboflowDetectorError("Failed to encode the image for Roboflow inference.")

        payload = self._request(base64.b64encode(encoded.tobytes()).decode("ascii"))
        predictions = payload.get("predictions", [])
        if not isinstance(predictions, list):
            raise RoboflowDetectorError("Roboflow response field 'predictions' must be an array.")

        image_height, image_width = bgr.shape[:2]
        image_area = float(image_height * image_width)
        detections: list[CardDetection] = []

        for prediction in predictions:
            if not isinstance(prediction, Mapping):
                continue
            confidence = _finite_float(prediction.get("confidence", 0.0), name="confidence")
            if confidence < settings.roboflow_confidence:
                continue
            polygon = _polygon_from_prediction(prediction)
            polygon[:, 0] = np.clip(polygon[:, 0], 0.0, max(0.0, image_width - 1.0))
            polygon[:, 1] = np.clip(polygon[:, 1], 0.0, max(0.0, image_height - 1.0))

            rect = cv2.minAreaRect(polygon)
            (_, _), (rect_width, rect_height), _ = rect
            if rect_width <= 1.0 or rect_height <= 1.0:
                continue
            long_side = max(rect_width, rect_height)
            short_side = min(rect_width, rect_height)
            area = rect_width * rect_height
            contour_area = abs(float(cv2.contourArea(polygon)))
            area_fraction = min(1.0, area / image_area) if image_area > 0 else 0.0
            rectangularity = min(1.0, contour_area / area) if area > 0 else 0.0

            bounding_x, bounding_y, bounding_width, bounding_height = cv2.boundingRect(
                polygon.astype(np.int32)
            )
            crop = rectify_quadrilateral(bgr, polygon)
            detections.append(
                CardDetection(
                    polygon_px=polygon,
                    bounding_box_px=(
                        max(0, bounding_x),
                        max(0, bounding_y),
                        max(1, bounding_width),
                        max(1, bounding_height),
                    ),
                    confidence=round(max(0.0, min(1.0, confidence)), 4),
                    rectangularity=round(max(0.0, min(1.0, rectangularity)), 4),
                    aspect_ratio=round(short_side / long_side, 4),
                    area_fraction=round(area_fraction, 4),
                    fallback_whole_image=False,
                    crop=crop,
                    detector_name=f"roboflow:{self.model_name}",
                    kind_hint=_normalize_label(prediction.get("class")),
                )
            )

        detections.sort(
            key=lambda item: (item.confidence, item.area_fraction),
            reverse=True,
        )
        self._last_error = None
        return detections[: settings.max_detections_per_image]

    def readiness(self) -> RoboflowDetectorReadiness:
        host: str | None = None
        if self.endpoint:
            try:
                host = httpx.URL(self.endpoint).host
            except Exception:
                host = None
        return RoboflowDetectorReadiness(
            enabled=settings.roboflow_detection_enabled,
            configured=bool(self.endpoint and (self.api_key or not self.endpoint.startswith("https://"))),
            model_name=self.model_name,
            endpoint_host=host,
            error=self._last_error,
        )
