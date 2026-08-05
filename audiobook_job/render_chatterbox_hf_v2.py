#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import shutil
import zipfile
from pathlib import Path

import render_chatterbox_hf as renderer

ROOT = Path(__file__).resolve().parent
ARCHIVE_PARTS = ROOT / "chapter_archive_parts"
EXPECTED_SHA256 = "2f5d4daf3466de0abeabac38afbcaf51677a8e474cacb66d00197d40776f0bec"


def natural_key(path: Path) -> tuple[int, ...]:
    return tuple(int(n) for n in re.findall(r"\d+", path.stem))


def reconstruct_exact() -> None:
    parts = sorted(ARCHIVE_PARTS.glob("part_*.b64"), key=natural_key)
    if not parts:
        raise RuntimeError(f"No archive parts found in {ARCHIVE_PARTS}")
    encoded = "".join(p.read_text(encoding="utf-8").strip() for p in parts)
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise RuntimeError(f"Complete chapter archive Base64 is invalid: {exc}") from exc
    actual = hashlib.sha256(raw).hexdigest()
    print(json.dumps({
        "transport": "chapter_archive_parts",
        "part_count": len(parts),
        "parts": [p.name for p in parts],
        "encoded_characters": len(encoded),
        "archive_bytes": len(raw),
        "archive_sha256": actual,
        "expected_sha256": EXPECTED_SHA256,
    }, indent=2), flush=True)
    if actual != EXPECTED_SHA256:
        raise RuntimeError(f"Exact source archive checksum mismatch: expected {EXPECTED_SHA256}, got {actual}")

    source_dir = renderer.base.SOURCE_DIR
    source_zip = renderer.base.SOURCE_ZIP
    chapters_dir = renderer.base.CHAPTERS_DIR
    source_dir.mkdir(parents=True, exist_ok=True)
    source_zip.write_bytes(raw)
    if chapters_dir.exists():
        shutil.rmtree(chapters_dir)
    with zipfile.ZipFile(source_zip) as zf:
        bad = zf.testzip()
        if bad:
            raise RuntimeError(f"Corrupt archive member: {bad}")
        zf.extractall(source_dir)

    chapters = sorted(chapters_dir.glob("chapter_*.txt"))
    if len(chapters) != 23:
        raise RuntimeError(f"Expected 23 chapters, found {len(chapters)}")
    for number, path in enumerate(chapters, 1):
        expected = f"chapter_{number:02d}.txt"
        if path.name != expected:
            raise RuntimeError(f"Chapter order mismatch: expected {expected}, got {path.name}")
        text = renderer.base.normalize_spoken(path.read_text(encoding="utf-8"))
        if len(text.split()) < 100:
            raise RuntimeError(f"Chapter {number} is implausibly short")

    manifest = {
        "archive": source_zip.name,
        "archive_bytes": len(raw),
        "archive_sha256": actual,
        "chapters": 23,
        "source_files": [
            {
                "chapter": i,
                "name": p.name,
                "bytes": p.stat().st_size,
                "sha256": renderer.sha256(p),
                "spoken_words": len(renderer.base.normalize_spoken(p.read_text(encoding="utf-8")).split()),
            }
            for i, p in enumerate(chapters, 1)
        ],
    }
    (source_dir / "source_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"source_verified": True, **manifest}, indent=2), flush=True)


def main() -> None:
    renderer.reconstruct = reconstruct_exact
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    render = sub.add_parser("render")
    render.add_argument("--group", type=int, required=True)
    sub.add_parser("assemble")
    sub.add_parser("verify-source")
    args = parser.parse_args()
    if args.command == "render":
        renderer.render_group(args.group)
    elif args.command == "assemble":
        renderer.assemble()
    else:
        reconstruct_exact()


if __name__ == "__main__":
    main()
