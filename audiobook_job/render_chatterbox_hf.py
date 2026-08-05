#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

import render_kokoro as base

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"
HF_BASE = os.getenv("CHATTERBOX_SPACE", "https://resembleai-chatterbox-nano-demo.hf.space").rstrip("/")
REFERENCE_URL = os.getenv("CHATTERBOX_REFERENCE_URL", "https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/ca2c4c0b-626c-4e79-a2c7-b8c1eaa0b957.mp3")
MAX_CHARS = int(os.getenv("CHATTERBOX_MAX_CHARS", "285"))
TEMP = float(os.getenv("CHATTERBOX_TEMPERATURE", "0.72"))
TOP_P = float(os.getenv("CHATTERBOX_TOP_P", "0.92"))
TOP_K = int(os.getenv("CHATTERBOX_TOP_K", "800"))
REP = float(os.getenv("CHATTERBOX_REPETITION_PENALTY", "1.25"))
SEED = int(os.getenv("CHATTERBOX_SEED", "314159"))
ENGINE = "Chatterbox Nano 110M via official Hugging Face ZeroGPU Space"
VOICE = "Approved Deep Western Narrator"
_prev_url = REFERENCE_URL
_call_index = 0
_original_split = base.split_text


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def reconstruct() -> None:
    parts = sorted((ROOT / "kokoro_source_parts").glob("part_*.b64"))
    if len(parts) != 8:
        raise RuntimeError(f"Expected 8 source parts, found {len(parts)}")
    base.PART_HASHES = [hashlib.sha256(p.read_text(encoding="utf-8").strip().encode()).hexdigest() for p in parts]
    base.reconstruct_source()


def split_exact(text: str, max_chars: int = MAX_CHARS):
    return _original_split(text, max_chars=MAX_CHARS)


def request_text(url: str, method: str = "GET", payload: dict[str, Any] | None = None, timeout: int = 600) -> tuple[int, str]:
    data = None if payload is None else json.dumps(payload).encode()
    headers = {"User-Agent": "BelleStarrAudiobook/2.0", "Accept": "application/json,text/event-stream,*/*"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return int(r.status), r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return int(e.code), e.read().decode("utf-8", errors="replace")


def parse_sse(text: str) -> list[Any]:
    out: list[Any] = []
    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        raw = line[5:].strip()
        try:
            out.append(json.loads(raw))
        except json.JSONDecodeError:
            out.append(raw)
    return out


def find_audio(value: Any) -> str | None:
    if isinstance(value, str):
        return value if value.startswith("http") and re.search(r"\.(wav|mp3)(\?|$)", value, re.I) else None
    if isinstance(value, list):
        for item in value:
            hit = find_audio(item)
            if hit:
                return hit
    if isinstance(value, dict):
        for item in value.values():
            hit = find_audio(item)
            if hit:
                return hit
    return None


def fetch_wav(url: str) -> tuple[np.ndarray, int]:
    req = urllib.request.Request(url, headers={"User-Agent": "BelleStarrAudiobook/2.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        raw = r.read()
    tmp = ROOT / "build" / "download.wav"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_bytes(raw)
    audio, sr = sf.read(tmp, dtype="float32")
    tmp.unlink(missing_ok=True)
    audio = np.asarray(audio).reshape(-1)
    if len(raw) < 10000 or sr < 16000 or audio.size < sr // 2 or not np.isfinite(audio).all():
        raise RuntimeError(f"Invalid renderer output bytes={len(raw)} sr={sr} samples={audio.size}")
    peak = float(np.max(np.abs(audio)))
    if peak < 0.005:
        raise RuntimeError("Renderer output is silent")
    threshold = max(2e-4, peak * 0.002)
    active = np.flatnonzero(np.abs(audio) > threshold)
    if active.size:
        pad = int(sr * 0.045)
        audio = audio[max(0, active[0] - pad):min(audio.size, active[-1] + pad + 1)]
    n = min(int(sr * 0.012), audio.size // 3)
    if n > 1:
        ramp = np.linspace(0, 1, n, dtype=np.float32)
        audio[:n] *= ramp
        audio[-n:] *= ramp[::-1]
    return audio, int(sr)


def synthesize(_unused, text: str, attempts: int = 7) -> tuple[np.ndarray, int]:
    global _prev_url, _call_index
    _call_index += 1
    prompt = REFERENCE_URL if _call_index == 1 or (_call_index - 1) % 8 == 0 else _prev_url
    file_data = {"path": prompt, "url": prompt, "orig_name": "deep-western-reference.mp3", "size": None, "mime_type": "audio/mpeg", "meta": {"_type": "gradio.FileData"}}
    payload = {"data": [text, file_data, TEMP, SEED + _call_index, 0, TOP_P, TOP_K, REP, True]}
    last = ""
    for attempt in range(1, attempts + 1):
        try:
            status, body = request_text(f"{HF_BASE}/gradio_api/call/generate", "POST", payload, 180)
            if status not in (200, 201):
                raise RuntimeError(f"start HTTP {status}: {body[-500:]}")
            event_id = json.loads(body).get("event_id")
            if not event_id:
                raise RuntimeError("Renderer returned no event ID")
            status, body = request_text(f"{HF_BASE}/gradio_api/call/generate/{event_id}", timeout=600)
            if status != 200:
                raise RuntimeError(f"result HTTP {status}: {body[-900:]}")
            url = find_audio(parse_sse(body))
            if not url:
                raise RuntimeError(f"Renderer returned no WAV URL: {body[-1200:]}")
            audio, sr = fetch_wav(url)
            _prev_url = url
            return audio, sr
        except Exception as exc:
            last = str(exc)
            delay = min(90, 3 * 2 ** (attempt - 1)) + random.random() * 2
            print(f"attempt {attempt}/{attempts} failed: {last}; retry in {delay:.1f}s", file=sys.stderr, flush=True)
            time.sleep(delay)
    raise RuntimeError(f"Neural render failed after {attempts} attempts: {last}")


def render_group(group: int) -> None:
    global _prev_url, _call_index
    reconstruct()
    base.split_text = split_exact
    base.retry_synthesis = synthesize
    base.MODEL = Path("chatterbox-nano-110m")
    base.VOICE = VOICE
    base.SPEED = 1.0
    summaries = []
    for chapter in base.chapter_numbers_for_group(group):
        _prev_url = REFERENCE_URL
        _call_index = 0
        summary = base.render_chapter(None, chapter)
        summary.update({"engine": ENGINE, "voice": VOICE, "reference_url": REFERENCE_URL})
        p = BUILD / "chapters" / f"chapter_{chapter:02d}" / "chapter_summary.json"
        p.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        summaries.append(summary)
    reports = BUILD / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    (reports / f"group_{group:02d}_summary.json").write_text(json.dumps(summaries, indent=2), encoding="utf-8")


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def assemble() -> None:
    reconstruct()
    base.VOICE = "Chatterbox Nano - Approved Deep Western Narrator"
    base.SPEED = 1.0
    base.MODEL = Path("chatterbox-nano-110m")
    base.assemble()
    final = BUILD / "final"
    reports = BUILD / "reports"
    m4b = final / "The Son of Belle Starr - Complete Neural Narrator.m4b"
    remux = final / "remux.m4b"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(m4b), "-map", "0", "-c", "copy", "-metadata", "comment=Unabridged Chatterbox Nano narration using the approved deep Western narrator reference", str(remux)])
    remux.replace(m4b)
    m4a = final / "The Son of Belle Starr - Complete Neural Narrator.m4a"
    shutil.copy2(m4b, m4a)
    base.full_decode_check(m4b)
    delivery_path = reports / "delivery_summary.json"
    delivery = json.loads(delivery_path.read_text(encoding="utf-8"))
    delivery.update({"edition": "Complete Deep Western Neural Narrator", "voice_engine": ENGINE, "model": "Chatterbox Nano 110M", "voice": VOICE, "m4b_bytes": m4b.stat().st_size, "m4b_sha256": sha256(m4b), "universal_sha256": sha256(m4a), "full_decode_ok": True, "publication_note": "Automated source, chapter, checksum, file-integrity, and full-decode QC passed. A beginning-to-end human proof-listen and confirmation of commercial-use rights for the approved reference voice remain required before retail publication."})
    delivery_path.write_text(json.dumps(delivery, indent=2), encoding="utf-8")
    (reports / "VOICE_AND_LICENSE.txt").write_text(f"Engine: {ENGINE}\nVoice: {VOICE}\nReference: {REFERENCE_URL}\nModel license: MIT; verify current upstream terms and reference-voice rights before publication.\n", encoding="utf-8")
    (reports / "SHA256SUMS.txt").write_text("\n".join(f"{sha256(p)}  {p.name}" for p in [m4b, m4a, final / "cover.jpg"]) + "\n", encoding="utf-8")
    package = final / "The Son of Belle Starr - Complete Neural Audiobook Package.zip"
    chapter_zip = final / "The Son of Belle Starr - Chapter Masters.zip"
    with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for p in [m4b, m4a, chapter_zip, final / "cover.jpg"]:
            zf.write(p, p.name)
        for p in sorted(reports.glob("*")):
            if p.is_file():
                zf.write(p, f"reports/{p.name}")
        zf.write(ROOT / "source" / "source_manifest.json", "reports/source_manifest.json")
    delivery["package_bytes"] = package.stat().st_size
    delivery["package_sha256"] = sha256(package)
    delivery_path.write_text(json.dumps(delivery, indent=2), encoding="utf-8")
    print(json.dumps(delivery, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("render")
    r.add_argument("--group", required=True, type=int)
    sub.add_parser("assemble")
    sub.add_parser("verify-source")
    args = parser.parse_args()
    if args.command == "render":
        render_group(args.group)
    elif args.command == "assemble":
        assemble()
    else:
        reconstruct()


if __name__ == "__main__":
    main()
