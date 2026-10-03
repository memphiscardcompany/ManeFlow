"""Replay rights-cleared, independently labeled video frames through the live detector.

Usage (from vision-worker):
    python replay_live_sequence.py --manifest video.json --root /private/media --output run.json

Only evidence-bounded canonical identity can populate catalog_card_id.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
from uuid import uuid4

import cv2

from app.models.live_schemas import LiveSessionCreate
from app.services.live_session import LiveSession

ALLOWED_RIGHTS = {
    "owner-controlled", "explicitly-licensed", "partner-approved", "public-domain",
    "permissive-open-license", "transient-evaluation",
}


def verified_asset_path(root: Path, asset: dict, split: str) -> Path:
    root = root.resolve(strict=True)
    candidate = (root / str(asset.get("source_path") or "")).resolve(strict=True)
    if not candidate.is_relative_to(root) or candidate == root:
        raise ValueError("Video asset path escapes the authorized root")
    if asset.get("rights_status") not in ALLOWED_RIGHTS:
        raise ValueError("Video asset rights are not approved")
    if split in {"test", "locked_test"} and asset.get("training_use_allowed") is not False:
        raise ValueError("Test video asset must disallow training")
    if asset.get("rights_status") == "transient-evaluation" and (
        split not in {"test", "locked_test"} or asset.get("retention_policy") != "delete_after_evaluation"
    ):
        raise ValueError("Transient video asset policy is invalid")
    expected = str(asset.get("sha256") or "")
    digest = hashlib.sha256()
    with candidate.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected:
        raise ValueError("Video asset SHA-256 mismatch")
    return candidate


async def replay_sequence(sequence: dict, root: Path) -> dict:
    frames = sequence.get("frames") or []
    if not frames or len(frames) > 10_000:
        raise ValueError("Replay requires 1..10000 labeled frame timestamps")
    asset = sequence["asset"]
    source_path = verified_asset_path(root, asset, sequence["split"])
    capture = cv2.VideoCapture(str(source_path))
    if not capture.isOpened():
        raise ValueError("Video decoder could not open authorized asset")
    session = LiveSession(uuid4(), LiveSessionCreate(mode="live"))
    output_frames = []
    previous = -1
    try:
        fps = capture.get(cv2.CAP_PROP_FPS)
        tolerance_ms = max(50.0, 500.0 / fps) if fps > 0 else 50.0
        for labeled in frames:
            timestamp = labeled.get("timestamp_ms")
            if not isinstance(timestamp, (int, float)) or timestamp < 0 or timestamp <= previous:
                raise ValueError("Labeled video timestamps must be increasing")
            previous = timestamp
            capture.set(cv2.CAP_PROP_POS_MSEC, float(timestamp))
            ok, image = capture.read()
            if not ok or image is None:
                raise ValueError(f"Video frame could not be decoded at {timestamp} ms")
            actual_ms = capture.get(cv2.CAP_PROP_POS_MSEC)
            if abs(actual_ms - timestamp) > tolerance_ms:
                raise ValueError(f"Video seek missed labeled timestamp {timestamp} ms")
            encoded_ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if not encoded_ok:
                raise ValueError("Video frame could not be encoded for replay")
            result = await session.process_frame(encoded.tobytes(), "image/jpeg")
            output_frames.append({
                "timestamp_ms": timestamp,
                "tracks": [{
                    "track_id": track.track_id,
                    "bounding_box": track.bounding_box,
                    "status": track.status,
                    "catalog_card_id": (track.identity or {}).get("card", {}).get("card_id"),
                    "identity_confidence": (track.identity or {}).get("identity_confidence"),
                    "needs_manual_confirmation": (track.identity or {}).get("needs_manual_confirmation", True),
                } for track in result.tracks],
                "events": [{"event_type": event.event_type, "track_id": event.track_id} for event in result.events],
                "skipped": result.skipped,
            })
    finally:
        session.close()
        capture.release()
    return {"sequence_id": sequence["sequence_id"], "asset_id": asset["asset_id"], "sha256": asset["sha256"], "frames": output_frames}


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != "maneflow-vision-3-video-v1":
        raise ValueError("Unsupported video manifest")
    policy = manifest.get("rights_policy") or {}
    if policy.get("ground_truth_policy") != "independent_labels_only" or policy.get("competitor_output_policy") != "never_ground_truth":
        raise ValueError("Independent ground-truth policy is required")
    sequences = manifest.get("sequences") or []
    if not sequences:
        raise ValueError("No labeled video sequences")
    predictions = [await replay_sequence(sequence, args.root) for sequence in sequences]
    payload = {"benchmark_id": manifest["benchmark_id"], "sequences": predictions}
    if args.output.exists():
        raise ValueError("Refusing to overwrite an existing replay output")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
