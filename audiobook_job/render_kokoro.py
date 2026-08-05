#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent
PARTS_DIR = ROOT / "kokoro_source_parts"
SOURCE_ZIP = ROOT / "source" / "chapters.zip"
SOURCE_DIR = ROOT / "source"
CHAPTERS_DIR = SOURCE_DIR / "chapters"
BUILD = ROOT / "build"
MODEL = ROOT / "models" / "kokoro-v1.0.int8.onnx"
VOICES = ROOT / "models" / "voices-v1.0.bin"
VOICE = os.getenv("KOKORO_VOICE", "am_michael")
SPEED = float(os.getenv("KOKORO_SPEED", "0.92"))
LANG = "en-us"
ARCHIVE_SHA256 = "2f5d4daf3466de0abeabac38afbcaf51677a8e474cacb66d00197d40776f0bec"
PART_HASHES = [
    "1300da95ee1434171a794e21b3d81ed2637a70e8545510019fe2af09b3121799",
    "34e21cd0d05abfb6826fd2536783bdec422b64e56ee5fe80e71b1ef15450b3c9",
    "c102c85318fdf94d992bf14570a8002851f502390392efa37da5e7bfba0f9195",
    "8db5bb0cbc00c4f2abb60737a87ca8367a19093ee3c3b9d63074e23ded31bd9c",
    "de3e2747520e87dba79496ea3675347d37b1373fbeadc906546aeae331d28d94",
    "578c8389af8128f5c39ab23a02a89935913a986ad03439d50860302c4e8f9487",
    "a5c755d02e754b3c169c713c1546e73d9d5d21575ea44c507cdb9a0cec33d60c",
    "8b920a8d1f2af5dfd4e76002b4ae33902f71b194676427d1315491c588274b73",
]
TOTAL_CHAPTERS = 23
GROUPS = 12
MAX_SEGMENT_CHARS = 420


def run(cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess:
    print("+", " ".join(map(str, cmd)), flush=True)
    return subprocess.run([str(x) for x in cmd], check=check)


def capture(cmd: list[str]) -> str:
    return subprocess.check_output([str(x) for x in cmd], text=True).strip()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def normalize_spoken(text: str) -> str:
    lines: list[str] = []
    for line in text.replace("\ufeff", "").replace("\r\n", "\n").splitlines():
        stripped = line.strip()
        if stripped in {"***", "* * *"}:
            continue
        if stripped:
            lines.append(stripped)
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


def reconstruct_source() -> None:
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    encoded_parts: list[str] = []
    for idx, expected in enumerate(PART_HASHES):
        path = PARTS_DIR / f"part_{idx:03d}.b64"
        if not path.exists():
            raise FileNotFoundError(f"Missing source payload part: {path}")
        content = path.read_text(encoding="utf-8").strip()
        actual = hashlib.sha256(content.encode("utf-8")).hexdigest()
        if actual != expected:
            raise RuntimeError(f"Source part {idx:03d} checksum mismatch: expected {expected}, got {actual}")
        encoded_parts.append(content)

    import base64
    raw = base64.b64decode("".join(encoded_parts), validate=True)
    actual_archive = sha256_bytes(raw)
    if actual_archive != ARCHIVE_SHA256:
        raise RuntimeError(f"Archive checksum mismatch: expected {ARCHIVE_SHA256}, got {actual_archive}")
    SOURCE_ZIP.write_bytes(raw)

    if CHAPTERS_DIR.exists():
        shutil.rmtree(CHAPTERS_DIR)
    with zipfile.ZipFile(SOURCE_ZIP) as zf:
        bad = zf.testzip()
        if bad:
            raise RuntimeError(f"Corrupt source archive member: {bad}")
        zf.extractall(SOURCE_DIR)

    chapters = sorted(CHAPTERS_DIR.glob("chapter_*.txt"))
    if len(chapters) != TOTAL_CHAPTERS:
        raise RuntimeError(f"Expected {TOTAL_CHAPTERS} chapters, found {len(chapters)}")
    for i, path in enumerate(chapters, 1):
        if path.name != f"chapter_{i:02d}.txt":
            raise RuntimeError(f"Unexpected chapter order/name: {path.name}")
        if len(normalize_spoken(path.read_text(encoding="utf-8"))) < 100:
            raise RuntimeError(f"Chapter {i} is implausibly short")

    manifest = {
        "archive": SOURCE_ZIP.name,
        "archive_bytes": len(raw),
        "archive_sha256": actual_archive,
        "chapters": TOTAL_CHAPTERS,
        "source_files": [
            {
                "chapter": i,
                "name": p.name,
                "bytes": p.stat().st_size,
                "sha256": sha256_file(p),
                "spoken_words": len(normalize_spoken(p.read_text(encoding="utf-8")).split()),
            }
            for i, p in enumerate(chapters, 1)
        ],
    }
    (SOURCE_DIR / "source_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"source_verified": True, **manifest}, indent=2))


def split_hard(text: str, max_chars: int) -> list[str]:
    words = text.split()
    out: list[str] = []
    current: list[str] = []
    length = 0
    for word in words:
        addition = len(word) + (1 if current else 0)
        if current and length + addition > max_chars:
            out.append(" ".join(current))
            current = [word]
            length = len(word)
        else:
            current.append(word)
            length += addition
    if current:
        out.append(" ".join(current))
    return out


def split_text(text: str, max_chars: int = MAX_SEGMENT_CHARS) -> list[dict]:
    normalized_target = normalize_spoken(text)
    segments: list[dict] = []
    paragraphs = re.split(r"\n\s*\n", text.replace("\r\n", "\n"))
    for paragraph in paragraphs:
        stripped = paragraph.strip()
        if not stripped:
            continue
        if stripped in {"***", "* * *"}:
            if segments:
                segments[-1]["scene_break_after"] = True
            continue
        clean = re.sub(r"\s+", " ", stripped).strip()
        if len(clean) <= max_chars:
            chunks = [clean]
        else:
            sentences = re.split(r"(?<=[.!?])\s+", clean)
            chunks = []
            current = ""
            for sentence in sentences:
                sentence = sentence.strip()
                if not sentence:
                    continue
                if len(sentence) > max_chars:
                    if current:
                        chunks.append(current)
                        current = ""
                    chunks.extend(split_hard(sentence, max_chars))
                    continue
                candidate = sentence if not current else f"{current} {sentence}"
                if len(candidate) > max_chars:
                    chunks.append(current)
                    current = sentence
                else:
                    current = candidate
            if current:
                chunks.append(current)
        for chunk in chunks:
            segments.append({"text": chunk, "scene_break_after": False})

    rebuilt = re.sub(r"\s+", " ", " ".join(s["text"] for s in segments)).strip()
    if rebuilt != normalized_target:
        raise RuntimeError("Text segmentation changed source words or order")
    return segments


def retry_synthesis(kokoro, text: str, attempts: int = 3) -> tuple[np.ndarray, int]:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            samples, sample_rate = kokoro.create(text, voice=VOICE, speed=SPEED, lang=LANG)
            audio = np.asarray(samples, dtype=np.float32).reshape(-1)
            if sample_rate < 16000 or audio.size < sample_rate // 5:
                raise RuntimeError(f"Implausible synthesis output: sr={sample_rate}, samples={audio.size}")
            if not np.isfinite(audio).all():
                raise RuntimeError("Synthesis produced non-finite samples")
            return audio, int(sample_rate)
        except Exception as exc:
            last_error = exc
            print(f"Synthesis attempt {attempt}/{attempts} failed: {exc}", file=sys.stderr)
            time.sleep(attempt * 2)
    assert last_error is not None
    raise last_error


def chapter_numbers_for_group(group: int) -> list[int]:
    if group < 0 or group >= GROUPS:
        raise ValueError(f"group must be 0..{GROUPS - 1}")
    start = group * 2 + 1
    return [n for n in (start, start + 1) if n <= TOTAL_CHAPTERS]


def render_chapter(kokoro, chapter: int) -> dict:
    source_path = CHAPTERS_DIR / f"chapter_{chapter:02d}.txt"
    source_text = source_path.read_text(encoding="utf-8")
    segments = split_text(source_text)
    out_dir = BUILD / "chapters" / f"chapter_{chapter:02d}"
    segment_dir = out_dir / "segments"
    segment_dir.mkdir(parents=True, exist_ok=True)

    segment_records: list[dict] = []
    audio_parts: list[np.ndarray] = []
    sample_rate: int | None = None

    for idx, item in enumerate(segments, 1):
        seg_path = segment_dir / f"segment_{idx:04d}.wav"
        started = time.time()
        if seg_path.exists() and seg_path.stat().st_size > 1000:
            audio, sr = sf.read(seg_path, dtype="float32")
            audio = np.asarray(audio).reshape(-1)
        else:
            audio, sr = retry_synthesis(kokoro, item["text"])
            sf.write(seg_path, audio, sr, subtype="PCM_16")
        if sample_rate is None:
            sample_rate = int(sr)
        elif int(sr) != sample_rate:
            raise RuntimeError(f"Sample-rate drift in chapter {chapter}")
        audio_parts.append(audio)
        pause_seconds = 1.0 if item["scene_break_after"] else 0.28
        if idx != len(segments):
            audio_parts.append(np.zeros(int(sample_rate * pause_seconds), dtype=np.float32))
        segment_records.append({
            "chapter": chapter,
            "segment": idx,
            "characters": len(item["text"]),
            "words": len(item["text"].split()),
            "source_sha256": hashlib.sha256(item["text"].encode()).hexdigest(),
            "scene_break_after": item["scene_break_after"],
            "audio_file": str(seg_path.relative_to(ROOT)),
            "audio_sha256": sha256_file(seg_path),
            "duration_seconds": round(audio.size / sr, 3),
            "render_seconds": round(time.time() - started, 3),
            "status": "validated",
        })

    assert sample_rate is not None
    chapter_audio = np.concatenate(audio_parts)
    peak = float(np.max(np.abs(chapter_audio)))
    if peak > 0.98:
        chapter_audio = chapter_audio * (0.98 / peak)

    raw_wav = out_dir / f"chapter_{chapter:02d}_raw.wav"
    sf.write(raw_wav, chapter_audio, sample_rate, subtype="PCM_16")
    master_flac = out_dir / f"chapter_{chapter:02d}_master.flac"
    chapter_m4a = out_dir / f"chapter_{chapter:02d}.m4a"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(raw_wav), "-af", "highpass=f=55,loudnorm=I=-20:TP=-3:LRA=11", "-ar", "44100", "-ac", "1", "-c:a", "flac", "-compression_level", "8", str(master_flac)])
    run(["ffmpeg", "-y", "-v", "error", "-i", str(master_flac), "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-metadata", f"title=Chapter {chapter}", "-metadata", "album=The Son of Belle Starr", "-metadata", "artist=J. W. Hunter", str(chapter_m4a)])
    raw_wav.unlink(missing_ok=True)

    with (out_dir / "segment_manifest.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(segment_records[0].keys()))
        writer.writeheader()
        writer.writerows(segment_records)

    duration = float(json.loads(capture(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(master_flac)]))["format"]["duration"])
    summary = {
        "chapter": chapter,
        "source_file": source_path.name,
        "source_sha256": sha256_file(source_path),
        "source_words": len(normalize_spoken(source_text).split()),
        "segments": len(segments),
        "voice": VOICE,
        "speed": SPEED,
        "model": MODEL.name,
        "master_file": master_flac.name,
        "master_sha256": sha256_file(master_flac),
        "duration_seconds": round(duration, 3),
        "status": "rendered_and_technically_validated",
    }
    (out_dir / "chapter_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return summary


def render_group(group: int) -> None:
    reconstruct_source()
    if not MODEL.exists() or not VOICES.exists():
        raise FileNotFoundError("Kokoro model/voice files are missing")
    from kokoro_onnx import Kokoro
    kokoro = Kokoro(str(MODEL), str(VOICES))
    summaries = [render_chapter(kokoro, chapter) for chapter in chapter_numbers_for_group(group)]
    report_dir = BUILD / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / f"group_{group:02d}_summary.json").write_text(json.dumps(summaries, indent=2), encoding="utf-8")


def make_cover(path: Path) -> None:
    from PIL import Image, ImageDraw, ImageFont
    size = 2400
    image = Image.new("RGB", (size, size), "#13100c")
    draw = ImageDraw.Draw(image)
    draw.rectangle((110, 110, 2290, 2290), outline="#c49b52", width=10)
    draw.rectangle((160, 160, 2240, 2240), outline="#4a3a25", width=3)
    def font(sz: int, bold: bool = False):
        candidates = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
            "/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf",
        ]
        for candidate in candidates:
            if Path(candidate).exists():
                return ImageFont.truetype(candidate, sz)
        return ImageFont.load_default()
    def center(text: str, y: int, fnt, fill: str):
        box = draw.textbbox((0, 0), text, font=fnt)
        x = (size - (box[2] - box[0])) // 2
        draw.text((x, y), text, font=fnt, fill=fill)
    center("THE SON OF", 500, font(170, True), "#eadcb7")
    center("BELLE STARR", 750, font(240, True), "#d3aa60")
    center("A WESTERN NOVEL", 1130, font(78), "#eadcb7")
    center("J. W. HUNTER", 1740, font(110, True), "#eadcb7")
    center("NEURAL NARRATOR EDITION", 1950, font(48), "#9f8b68")
    image.save(path, quality=95)


def full_decode_check(path: Path) -> None:
    result = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Full decode failed for {path.name}: {result.stderr[-3000:]}")


def assemble() -> None:
    reconstruct_source()
    final_dir = BUILD / "final"
    reports_dir = BUILD / "reports"
    final_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)
    chapters: list[dict] = []
    for chapter in range(1, TOTAL_CHAPTERS + 1):
        chapter_dir = BUILD / "chapters" / f"chapter_{chapter:02d}"
        master = chapter_dir / f"chapter_{chapter:02d}_master.flac"
        summary_path = chapter_dir / "chapter_summary.json"
        if not master.exists() or not summary_path.exists():
            raise FileNotFoundError(f"Missing completed chapter {chapter}")
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        duration = float(json.loads(capture(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(master)]))["format"]["duration"])
        if duration < 60:
            raise RuntimeError(f"Implausible duration for chapter {chapter}: {duration}")
        chapters.append({"chapter": chapter, "path": master, "duration_seconds": duration, "sha256": sha256_file(master), "source_words": summary["source_words"]})

    cover = final_dir / "cover.jpg"
    make_cover(cover)
    concat = final_dir / "chapters.ffconcat"
    concat.write_text("ffconcat version 1.0\n" + "\n".join(f"file '{c['path'].resolve()}'" for c in chapters) + "\n", encoding="utf-8")
    metadata_lines = [";FFMETADATA1", "title=The Son of Belle Starr", "artist=J. W. Hunter", "album=The Son of Belle Starr", "genre=Western / Audiobook", f"comment=Unabridged neural narration; Kokoro voice {VOICE}"]
    cursor_ms = 0
    for c in chapters:
        start = cursor_ms
        end = start + int(round(c["duration_seconds"] * 1000))
        cursor_ms = end
        metadata_lines.extend(["[CHAPTER]", "TIMEBASE=1/1000", f"START={start}", f"END={end}", f"title=Chapter {c['chapter']}"])
    metadata = final_dir / "chapters.ffmetadata"
    metadata.write_text("\n".join(metadata_lines) + "\n", encoding="utf-8")
    m4b = final_dir / "The Son of Belle Starr - Complete Neural Narrator.m4b"
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(concat), "-i", str(metadata), "-i", str(cover), "-map", "0:a", "-map", "2:v", "-map_metadata", "1", "-c:a", "aac", "-b:a", "96k", "-c:v", "mjpeg", "-disposition:v", "attached_pic", "-movflags", "+faststart", str(m4b)])
    universal = final_dir / "The Son of Belle Starr - Complete Neural Narrator.m4a"
    shutil.copy2(m4b, universal)
    full_decode_check(m4b)
    probe = json.loads(capture(["ffprobe", "-v", "error", "-show_entries", "format=duration,size:format_tags=title,artist,album", "-show_entries", "stream=codec_name,sample_rate,channels:chapter=start_time,end_time,tags", "-of", "json", str(m4b)]))
    if len(probe.get("chapters") or []) != TOTAL_CHAPTERS:
        raise RuntimeError(f"Expected {TOTAL_CHAPTERS} embedded chapters, found {len(probe.get('chapters') or [])}")

    delivery = {
        "title": "The Son of Belle Starr",
        "author": "J. W. Hunter",
        "edition": "Complete Neural Narrator",
        "chapters": TOTAL_CHAPTERS,
        "source_archive_sha256": ARCHIVE_SHA256,
        "voice_engine": "kokoro-onnx 0.5.0",
        "model": MODEL.name,
        "voice": VOICE,
        "speed": SPEED,
        "source_words": sum(c["source_words"] for c in chapters),
        "duration_seconds": float(probe["format"]["duration"]),
        "m4b_file": m4b.name,
        "m4b_bytes": m4b.stat().st_size,
        "m4b_sha256": sha256_file(m4b),
        "universal_file": universal.name,
        "universal_sha256": sha256_file(universal),
        "embedded_chapters": len(probe["chapters"]),
        "full_decode_ok": True,
        "chapter_masters": [{"chapter": c["chapter"], "duration_seconds": round(c["duration_seconds"], 3), "sha256": c["sha256"]} for c in chapters],
        "publication_note": "Technically validated by source checksum, chapter count, manifests, embedded chapter verification, and beginning-to-end FFmpeg decode. A complete human proof-listen remains required before commercial publication.",
    }
    (reports_dir / "delivery_summary.json").write_text(json.dumps(delivery, indent=2), encoding="utf-8")
    (reports_dir / "SHA256SUMS.txt").write_text("\n".join(f"{sha256_file(path)}  {path.name}" for path in [m4b, universal, cover]) + "\n", encoding="utf-8")
    (reports_dir / "VOICE_AND_LICENSE.txt").write_text(f"Narration engine: kokoro-onnx 0.5.0 (MIT)\nKokoro model license: Apache 2.0\nModel: {MODEL.name}\nVoice: {VOICE}\nSpeed: {SPEED}\n", encoding="utf-8")

    chapter_zip = final_dir / "The Son of Belle Starr - Chapter Masters.zip"
    with zipfile.ZipFile(chapter_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for c in chapters:
            chapter_dir = c["path"].parent
            for path in [c["path"], chapter_dir / f"chapter_{c['chapter']:02d}.m4a", chapter_dir / "chapter_summary.json", chapter_dir / "segment_manifest.csv"]:
                zf.write(path, f"chapter_{c['chapter']:02d}/{path.name}")
    package = final_dir / "The Son of Belle Starr - Complete Neural Audiobook Package.zip"
    with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in [m4b, universal, chapter_zip, cover]:
            zf.write(path, path.name)
        for path in sorted(reports_dir.glob("*")):
            if path.is_file():
                zf.write(path, f"reports/{path.name}")
        zf.write(SOURCE_DIR / "source_manifest.json", "reports/source_manifest.json")
    delivery["chapter_masters_zip"] = chapter_zip.name
    delivery["chapter_masters_zip_sha256"] = sha256_file(chapter_zip)
    delivery["package_file"] = package.name
    delivery["package_bytes"] = package.stat().st_size
    delivery["package_sha256"] = sha256_file(package)
    (reports_dir / "delivery_summary.json").write_text(json.dumps(delivery, indent=2), encoding="utf-8")
    print(json.dumps(delivery, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    render = sub.add_parser("render")
    render.add_argument("--group", type=int, required=True)
    sub.add_parser("assemble")
    sub.add_parser("verify-source")
    args = parser.parse_args()
    if args.command == "render":
        render_group(args.group)
    elif args.command == "assemble":
        assemble()
    else:
        reconstruct_source()


if __name__ == "__main__":
    main()
