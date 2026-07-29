from __future__ import annotations

import argparse
import csv
import hashlib
import json
import statistics
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

import cv2

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.bulk_intake import SUPPORTED_EXTENSIONS, pair_scan_files  # noqa: E402
from app.services.imaging.card_detector import decode_image  # noqa: E402
from app.services.imaging.detector_router import detect_card_objects, detector_readiness  # noqa: E402
from app.services.imaging.fingerprint import difference_hash  # noqa: E402
from app.services.imaging.quality import analyze_image_quality  # noqa: E402


@dataclass(frozen=True)
class ImageMetric:
    path: str
    side: str
    pair_index: int
    width: int | None
    height: int | None
    dpi_x: float | None
    dpi_y: float | None
    file_bytes: int
    sha256: str
    difference_hash: str | None
    decode_ms: float
    quality_ms: float
    detection_ms: float | None
    quality_score: int | None
    blur_score: float | None
    glare_fraction: float | None
    brightness: float | None
    warnings: list[str]
    detected_objects: int | None
    detector_provider: str | None
    error: str | None


@dataclass(frozen=True)
class PairMetric:
    pair_index: int
    front_path: str
    back_path: str | None
    complete: bool
    front_sha256: str
    back_sha256: str | None
    duplicate_front_sha256: bool
    duplicate_back_sha256: bool
    front_back_same_sha256: bool
    front_back_same_dhash: bool


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    index = (len(ordered) - 1) * percentile
    lower = int(index)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = index - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction


def _mean(values: Iterable[float | int | None]) -> float:
    clean = [float(value) for value in values if value is not None]
    return round(statistics.fmean(clean), 3) if clean else 0.0


def _safe_dpi(image_path: Path) -> tuple[float | None, float | None]:
    try:
        from PIL import Image

        with Image.open(image_path) as image:
            raw = image.info.get("dpi")
            if isinstance(raw, tuple) and len(raw) >= 2:
                return float(raw[0]), float(raw[1])
    except Exception:
        pass
    return None, None


def _detector_result(image: Any) -> tuple[int | None, str | None]:
    detections = detect_card_objects(image)
    readiness = detector_readiness()
    backend = str(readiness.get("backend") or "auto")
    if readiness.get("local_learned_ready"):
        provider = "local_learned"
    elif isinstance(readiness.get("roboflow"), dict) and readiness["roboflow"].get("configured"):
        provider = "roboflow_or_fallback"
    else:
        provider = "classical"
    return len(detections), f"{backend}:{provider}"


def _analyze_image(image_path: Path, side: str, pair_index: int, run_detector: bool) -> ImageMetric:
    raw = image_path.read_bytes()
    digest = _sha256(raw)
    decode_started = time.perf_counter()
    try:
        image = decode_image(raw)
        decode_ms = (time.perf_counter() - decode_started) * 1000.0
        height, width = image.shape[:2]
        dpi_x, dpi_y = _safe_dpi(image_path)

        quality_started = time.perf_counter()
        quality = analyze_image_quality(image)
        quality_ms = (time.perf_counter() - quality_started) * 1000.0

        detection_ms: float | None = None
        detected_objects: int | None = None
        detector_provider: str | None = None
        if run_detector:
            detection_started = time.perf_counter()
            detected_objects, detector_provider = _detector_result(image)
            detection_ms = (time.perf_counter() - detection_started) * 1000.0

        try:
            dhash = difference_hash(image)
        except Exception:
            dhash = None

        return ImageMetric(
            path=str(image_path),
            side=side,
            pair_index=pair_index,
            width=int(width),
            height=int(height),
            dpi_x=dpi_x,
            dpi_y=dpi_y,
            file_bytes=len(raw),
            sha256=digest,
            difference_hash=dhash,
            decode_ms=round(decode_ms, 3),
            quality_ms=round(quality_ms, 3),
            detection_ms=round(detection_ms, 3) if detection_ms is not None else None,
            quality_score=quality.quality_score,
            blur_score=quality.blur_score,
            glare_fraction=quality.glare_fraction,
            brightness=quality.brightness,
            warnings=list(quality.warnings),
            detected_objects=detected_objects,
            detector_provider=detector_provider,
            error=None,
        )
    except Exception as exc:
        return ImageMetric(
            path=str(image_path),
            side=side,
            pair_index=pair_index,
            width=None,
            height=None,
            dpi_x=None,
            dpi_y=None,
            file_bytes=len(raw),
            sha256=digest,
            difference_hash=None,
            decode_ms=round((time.perf_counter() - decode_started) * 1000.0, 3),
            quality_ms=0.0,
            detection_ms=None,
            quality_score=None,
            blur_score=None,
            glare_fraction=None,
            brightness=None,
            warnings=[],
            detected_objects=None,
            detector_provider=None,
            error=f"{type(exc).__name__}: {exc}",
        )


def _write_csv(path: Path, rows: list[ImageMetric]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(asdict(rows[0]).keys()) if rows else list(ImageMetric.__annotations__.keys())
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            payload = asdict(row)
            payload["warnings"] = " | ".join(payload["warnings"])
            writer.writerow(payload)


def _recommendations(summary: dict[str, Any]) -> list[str]:
    notes: list[str] = []
    if summary["pairing_coverage_percent"] < 99.0:
        notes.append("Resolve missing or misordered back images before production bulk intake.")
    if summary["decode_failure_count"]:
        notes.append("Replace or re-export images that cannot be decoded reliably.")
    if summary["low_quality_image_percent"] > 5.0:
        notes.append("Adjust Ricoh brightness, resolution, or feeder setup; more than 5% of images scored below 70.")
    if summary["duplicate_hash_count"]:
        notes.append("Review duplicate hashes for scanner retries or accidental duplicate imports.")
    if summary["same_front_back_count"]:
        notes.append("Inspect front/back pairs that are identical; scanner-side duplex ordering may be incorrect.")
    if summary.get("measured_cards_per_minute") and summary["measured_cards_per_minute"] < 40.0:
        notes.append("Throughput is below the initial 40 cards/minute beta target; profile disk, OCR, and detector queues.")
    if not notes:
        notes.append("The folder passed the initial Ricoh intake quality gate. Continue with a larger labeled production batch.")
    return notes


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark a Ricoh duplex scan folder for ManeFlow beta readiness.")
    parser.add_argument("--folder", required=True, type=Path)
    parser.add_argument("--pairing-strategy", choices=["auto", "filename", "alternating"], default="auto")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--csv", type=Path)
    parser.add_argument("--run-detector", action="store_true")
    parser.add_argument("--elapsed-seconds", type=float, help="Optional physical scanning duration for cards/minute calculation.")
    parser.add_argument("--limit-pairs", type=int, default=0)
    args = parser.parse_args()

    folder = args.folder.expanduser().resolve()
    if not folder.is_dir():
        raise SystemExit(f"Folder does not exist: {folder}")

    files = sorted(
        [item for item in folder.iterdir() if item.is_file() and item.suffix.lower() in SUPPORTED_EXTENSIONS],
        key=lambda item: item.name.lower(),
    )
    if not files:
        raise SystemExit("No supported images were found.")

    pairs, pairing_warnings, selected_strategy = pair_scan_files(files, args.pairing_strategy)
    if args.limit_pairs > 0:
        pairs = pairs[: args.limit_pairs]

    started = time.perf_counter()
    images: list[ImageMetric] = []
    pair_rows: list[PairMetric] = []
    seen_sha256: set[str] = set()
    duplicate_hashes: set[str] = set()

    for pair_index, (front, back) in enumerate(pairs, start=1):
        front_metric = _analyze_image(front, "front", pair_index, args.run_detector)
        images.append(front_metric)
        if front_metric.sha256 in seen_sha256:
            duplicate_hashes.add(front_metric.sha256)
        seen_sha256.add(front_metric.sha256)

        back_metric: ImageMetric | None = None
        if back is not None:
            back_metric = _analyze_image(back, "back", pair_index, args.run_detector)
            images.append(back_metric)
            if back_metric.sha256 in seen_sha256:
                duplicate_hashes.add(back_metric.sha256)
            seen_sha256.add(back_metric.sha256)

        pair_rows.append(
            PairMetric(
                pair_index=pair_index,
                front_path=str(front),
                back_path=str(back) if back else None,
                complete=back is not None,
                front_sha256=front_metric.sha256,
                back_sha256=back_metric.sha256 if back_metric else None,
                duplicate_front_sha256=front_metric.sha256 in duplicate_hashes,
                duplicate_back_sha256=bool(back_metric and back_metric.sha256 in duplicate_hashes),
                front_back_same_sha256=bool(back_metric and front_metric.sha256 == back_metric.sha256),
                front_back_same_dhash=bool(
                    back_metric
                    and front_metric.difference_hash
                    and front_metric.difference_hash == back_metric.difference_hash
                ),
            )
        )

    elapsed = time.perf_counter() - started
    completed_pairs = sum(1 for item in pair_rows if item.complete)
    decode_failures = [item for item in images if item.error]
    valid_images = [item for item in images if not item.error]
    low_quality = [item for item in valid_images if (item.quality_score or 0) < 70]
    detection_latencies = [item.detection_ms for item in valid_images if item.detection_ms is not None]
    measured_cards_per_minute = None
    if args.elapsed_seconds and args.elapsed_seconds > 0:
        measured_cards_per_minute = round((len(pair_rows) / args.elapsed_seconds) * 60.0, 3)

    summary = {
        "folder": str(folder),
        "pairing_strategy_requested": args.pairing_strategy,
        "pairing_strategy_selected": selected_strategy,
        "files_found": len(files),
        "physical_items": len(pair_rows),
        "complete_duplex_pairs": completed_pairs,
        "missing_back_count": len(pair_rows) - completed_pairs,
        "pairing_coverage_percent": round((completed_pairs / len(pair_rows)) * 100.0, 3) if pair_rows else 0.0,
        "images_analyzed": len(images),
        "decode_failure_count": len(decode_failures),
        "low_quality_image_count": len(low_quality),
        "low_quality_image_percent": round((len(low_quality) / len(valid_images)) * 100.0, 3) if valid_images else 0.0,
        "duplicate_hash_count": len(duplicate_hashes),
        "same_front_back_count": sum(1 for item in pair_rows if item.front_back_same_sha256 or item.front_back_same_dhash),
        "average_quality_score": _mean(item.quality_score for item in valid_images),
        "average_blur_score": _mean(item.blur_score for item in valid_images),
        "average_glare_fraction": _mean(item.glare_fraction for item in valid_images),
        "average_decode_ms": _mean(item.decode_ms for item in valid_images),
        "average_quality_ms": _mean(item.quality_ms for item in valid_images),
        "average_detection_ms": _mean(detection_latencies),
        "p95_detection_ms": round(_percentile([float(value) for value in detection_latencies], 0.95), 3),
        "analysis_elapsed_seconds": round(elapsed, 3),
        "analysis_items_per_minute": round((len(pair_rows) / elapsed) * 60.0, 3) if elapsed > 0 else 0.0,
        "physical_scan_elapsed_seconds": args.elapsed_seconds,
        "measured_cards_per_minute": measured_cards_per_minute,
        "detector_executed": args.run_detector,
    }

    report = {
        "schema_version": "maneflow-ricoh-benchmark-v1.0",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "summary": summary,
        "pairing_warnings": pairing_warnings,
        "recommendations": _recommendations(summary),
        "pairs": [asdict(item) for item in pair_rows],
        "images": [asdict(item) for item in images],
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if args.csv:
        _write_csv(args.csv, images)
    print(json.dumps({"summary": summary, "recommendations": report["recommendations"]}, indent=2))
    return 0 if summary["decode_failure_count"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
