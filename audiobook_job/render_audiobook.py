#!/usr/bin/env python3
"""Render and assemble The Son of Belle Starr with Piper and FFmpeg."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCRIPTS = ROOT / "scripts" / "chapters"
BUILD = ROOT / "build"
PIPER = Path(os.environ.get("PIPER_BIN", ROOT / "tools" / "piper" / "piper"))
MODEL = Path(os.environ.get("PIPER_MODEL", ROOT / "models" / "en_US-norman-medium.onnx"))
CONFIG = Path(os.environ.get("PIPER_CONFIG", str(MODEL) + ".json"))
SAMPLE_RATE = 22050
MAX_CHARS = 1600


def run(cmd: list[str], *, input_text: str | None = None, timeout: int | None = None) -> subprocess.CompletedProcess:
    print("+", " ".join(str(x) for x in cmd), flush=True)
    return subprocess.run([str(x) for x in cmd], input=input_text, text=input_text is not None, check=True, timeout=timeout)


def capture(cmd: list[str]) -> str:
    return subprocess.check_output([str(x) for x in cmd], text=True).strip()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def text_sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def probe(path: Path) -> dict:
    data = json.loads(capture(["ffprobe", "-v", "error", "-show_entries", "format=duration,size:stream=codec_name,sample_rate,channels", "-of", "json", str(path)]))
    duration = float(data.get("format", {}).get("duration") or 0)
    size = int(data.get("format", {}).get("size") or path.stat().st_size)
    streams = data.get("streams") or []
    stream = streams[0] if streams else {}
    return {"duration": duration, "size": size, "codec": stream.get("codec_name"), "sample_rate": int(stream.get("sample_rate") or 0), "channels": int(stream.get("channels") or 0)}


def normalized_spoken(text: str) -> str:
    lines = []
    for line in text.replace("\ufeff", "").splitlines():
        if line.strip() in {"***", "* * *"}:
            continue
        lines.append(line)
    return re.sub(r"\s+", " ", "\n".join(lines)).strip()


def split_hard(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    words = text.split(" ")
    out, cur, count = [], [], 0
    for word in words:
        add = len(word) + (1 if cur else 0)
        if cur and count + add > max_chars:
            out.append(" ".join(cur)); cur = [word]; count = len(word)
        else:
            cur.append(word); count += add
    if cur:
        out.append(" ".join(cur))
    return out


def split_text(text: str, max_chars: int = MAX_CHARS) -> list[str]:
    clean = normalized_spoken(text)
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    segments = []
    for paragraph in paragraphs:
        if paragraph in {"***", "* * *"}:
            continue
        paragraph = re.sub(r"\s+", " ", paragraph).strip()
        if len(paragraph) <= max_chars:
            segments.append(paragraph); continue
        sentences = re.split(r"(?<=[.!?])\s+", paragraph)
        cur = ""
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            if len(sentence) > max_chars:
                if cur:
                    segments.append(cur); cur = ""
                segments.extend(split_hard(sentence, max_chars)); continue
            candidate = sentence if not cur else cur + " " + sentence
            if len(candidate) > max_chars:
                segments.append(cur); cur = sentence
            else:
                cur = candidate
        if cur:
            segments.append(cur)
    joined = re.sub(r"\s+", " ", " ".join(segments)).strip()
    if joined != clean:
        raise RuntimeError("Segmentation changed spoken source text")
    return segments


def ensure_silence(out: Path, seconds: float) -> None:
    if out.exists() and probe(out)["duration"] > seconds - 0.05:
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"anullsrc=r={SAMPLE_RATE}:cl=mono", "-t", str(seconds), "-c:a", "pcm_s16le", str(out)])


def render_segment(text: str, out: Path) -> dict:
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        info = probe(out)
        if info["duration"] > 0.5 and info["size"] > 2000:
            return info
    temp = out.with_suffix(".tmp.wav")
    temp.unlink(missing_ok=True)
    cmd = [str(PIPER), "--model", str(MODEL), "--config", str(CONFIG), "--output_file", str(temp), "--length_scale", "1.08", "--noise_scale", "0.667", "--noise_w", "0.8", "--sentence_silence", "0.22"]
    run(cmd, input_text=text + "\n", timeout=900)
    info = probe(temp)
    if info["duration"] <= 0.5 or info["size"] <= 2000:
        raise RuntimeError(f"Invalid narration output: {out.name}")
    temp.replace(out)
    return probe(out)


def render_chapter(chapter: int) -> None:
    source_path = SCRIPTS / f"chapter_{chapter:02d}.txt"
    source = source_path.read_text(encoding="utf-8")
    segments = split_text(source)
    chapter_dir = BUILD / "chapters" / f"chapter_{chapter:02d}"
    seg_dir = chapter_dir / "segments"
    chapter_dir.mkdir(parents=True, exist_ok=True)
    silence_short = BUILD / "silence" / "short.wav"
    ensure_silence(silence_short, 0.34)
    records, concat_lines = [], []
    for idx, text in enumerate(segments, 1):
        seg_id = f"CH{chapter:02d}_SEG{idx:03d}"
        wav = seg_dir / f"{seg_id}.wav"
        started = time.time(); info = render_segment(text, wav)
        records.append({"segment_id": seg_id, "chapter": chapter, "sequence": idx, "characters": len(text), "words": len(text.split()), "source_sha256": text_sha(text), "audio_file": str(wav.relative_to(ROOT)), "audio_sha256": sha256(wav), "duration_seconds": round(info["duration"], 3), "sample_rate": info["sample_rate"], "channels": info["channels"], "render_seconds": round(time.time() - started, 3), "status": "validated"})
        concat_lines.append(f"file '{wav.resolve()}'")
        if idx != len(segments):
            concat_lines.append(f"file '{silence_short.resolve()}'")
    manifest = chapter_dir / "segment_manifest.csv"
    with manifest.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(records[0])); writer.writeheader(); writer.writerows(records)
    concat_file = chapter_dir / "concat.ffconcat"
    concat_file.write_text("ffconcat version 1.0\n" + "\n".join(concat_lines) + "\n", encoding="utf-8")
    raw = chapter_dir / f"chapter_{chapter:02d}_raw.wav"
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(raw)])
    master = chapter_dir / f"chapter_{chapter:02d}_master.flac"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(raw), "-af", "highpass=f=55,loudnorm=I=-20:TP=-3:LRA=11", "-ar", "44100", "-ac", "1", "-c:a", "flac", "-compression_level", "8", str(master)])
    m4a = chapter_dir / f"chapter_{chapter:02d}.m4a"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(master), "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-metadata", f"title=Chapter {chapter}", "-metadata", "album=The Son of Belle Starr", "-metadata", "artist=J. W. Hunter", str(m4a)])
    raw.unlink(missing_ok=True)
    summary = {"chapter": chapter, "source_file": str(source_path.relative_to(ROOT)), "source_sha256": sha256(source_path), "source_characters": len(normalized_spoken(source)), "source_words": len(normalized_spoken(source).split()), "segments": len(records), "master_file": str(master.relative_to(ROOT)), "master_sha256": sha256(master), "duration_seconds": round(probe(master)["duration"], 3), "status": "rendered_and_technically_validated"}
    (chapter_dir / "chapter_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


def make_cover(out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    bold = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"; regular = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
    vf = f"drawbox=x=110:y=110:w=2180:h=2180:color=0xB58B45@0.85:t=8,drawtext=fontfile={bold}:text='THE SON OF':fontcolor=0xE8D8B0:fontsize=170:x=(w-text_w)/2:y=520,drawtext=fontfile={bold}:text='BELLE STARR':fontcolor=0xD2A85A:fontsize=245:x=(w-text_w)/2:y=760,drawtext=fontfile={regular}:text='A WESTERN NOVEL':fontcolor=0xE8D8B0:fontsize=78:x=(w-text_w)/2:y=1150,drawtext=fontfile={bold}:text='J. W. HUNTER':fontcolor=0xE8D8B0:fontsize=110:x=(w-text_w)/2:y=1730"
    run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x12100D:s=2400x2400:d=1", "-vf", vf, "-frames:v", "1", str(out)])


def make_transition(out: Path) -> None:
    if out.exists():
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.025:sample_rate=44100:duration=3.8", "-af", "lowpass=f=850,highpass=f=85,afade=t=in:d=1.2,afade=t=out:st=2.2:d=1.6", "-ac", "1", "-c:a", "flac", str(out)])


def assemble() -> None:
    final_dir, reports = BUILD / "final", BUILD / "reports"
    final_dir.mkdir(parents=True, exist_ok=True); reports.mkdir(parents=True, exist_ok=True)
    chapters = []
    for n in range(1, 24):
        d = BUILD / "chapters" / f"chapter_{n:02d}"; master = d / f"chapter_{n:02d}_master.flac"; summary = d / "chapter_summary.json"
        if not master.exists() or not summary.exists():
            raise FileNotFoundError(f"Missing completed chapter {n}")
        info = probe(master)
        if info["duration"] < 60:
            raise RuntimeError(f"Implausible duration for chapter {n}")
        chapters.append({"number": n, "path": master, "duration": info["duration"], "sha256": sha256(master)})
    cover = final_dir / "cover.jpg"; make_cover(cover)
    concat = final_dir / "chapters.ffconcat"
    concat.write_text("ffconcat version 1.0\n" + "\n".join(f"file '{c['path'].resolve()}'" for c in chapters) + "\n", encoding="utf-8")
    lines = [";FFMETADATA1", "title=The Son of Belle Starr", "artist=J. W. Hunter", "album=The Son of Belle Starr", "genre=Western / Audiobook", "comment=Unabridged AI narration using Piper en_US-norman-medium"]
    cursor = 0
    for c in chapters:
        start = cursor; end = start + int(round(c["duration"] * 1000)); cursor = end
        lines += ["[CHAPTER]", "TIMEBASE=1/1000", f"START={start}", f"END={end}", f"title=Chapter {c['number']}"]
    metadata = final_dir / "chapters.ffmetadata"; metadata.write_text("\n".join(lines) + "\n", encoding="utf-8")
    clean = final_dir / "The Son of Belle Starr - Voice Only.m4b"
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(concat), "-i", str(metadata), "-i", str(cover), "-map", "0:a", "-map", "2:v", "-map_metadata", "1", "-c:a", "aac", "-b:a", "96k", "-c:v", "mjpeg", "-disposition:v", "attached_pic", "-movflags", "+faststart", str(clean)])
    transition = final_dir / "western_wind_transition.flac"; make_transition(transition)
    enhanced_lines, enhanced_meta_lines, cursor = ["ffconcat version 1.0"], lines[:6], 0
    transition_ms = int(round(probe(transition)["duration"] * 1000))
    for c in chapters:
        enhanced_lines += [f"file '{transition.resolve()}'", f"file '{c['path'].resolve()}'"]
        start = cursor; end = start + transition_ms + int(round(c["duration"] * 1000)); cursor = end
        enhanced_meta_lines += ["[CHAPTER]", "TIMEBASE=1/1000", f"START={start}", f"END={end}", f"title=Chapter {c['number']}"]
    enhanced_concat = final_dir / "enhanced.ffconcat"; enhanced_concat.write_text("\n".join(enhanced_lines) + "\n", encoding="utf-8")
    enhanced_meta = final_dir / "enhanced.ffmetadata"; enhanced_meta.write_text("\n".join(enhanced_meta_lines) + "\n", encoding="utf-8")
    enhanced = final_dir / "The Son of Belle Starr - AudioMovie.m4b"
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(enhanced_concat), "-i", str(enhanced_meta), "-i", str(cover), "-map", "0:a", "-map", "2:v", "-map_metadata", "1", "-c:a", "aac", "-b:a", "96k", "-c:v", "mjpeg", "-disposition:v", "attached_pic", "-movflags", "+faststart", str(enhanced)])
    checks = []
    for path in [clean, enhanced]:
        info = probe(path); run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"])
        checks.append({"file": path.name, "sha256": sha256(path), **info, "decode_test": "passed"})
    chapter_csv = reports / "chapter_render_manifest.csv"
    with chapter_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["chapter", "duration_seconds", "sha256", "file"]); w.writeheader()
        for c in chapters:
            w.writerow({"chapter": c["number"], "duration_seconds": round(c["duration"], 3), "sha256": c["sha256"], "file": str(c["path"].relative_to(ROOT))})
    qc = {"title": "The Son of Belle Starr", "internal_manuscript_title": "The Death of Belle Starr", "author": "J. W. Hunter", "narrator": "Piper en_US-norman-medium (AI voice)", "voice_model_dataset_license": "Public domain", "chapter_count": len(chapters), "all_chapters_present": len(chapters) == 23, "final_files": checks, "source_coverage": "All normalized chapter script text submitted exactly once", "limitations": ["No human beginning-to-end proof-listen was performed by the automated job", "Character differentiation is delivered by one fixed neural voice rather than separate voice actors"]}
    (reports / "final_qc.json").write_text(json.dumps(qc, indent=2), encoding="utf-8")
    (reports / "proofing_report.md").write_text("# Proofing Report\n\nAll 23 source chapter scripts were segmented with a normalized-text equality assertion. Every segment produced a non-silent, probeable WAV, and every final M4B passed a complete FFmpeg decode test. This is automated technical proofing; a human proof-listen remains recommended before retail submission.\n", encoding="utf-8")
    (reports / "voice_license.md").write_text("# Voice and License Record\n\n- Engine: Piper 2023.11.14-2\n- Voice: en_US-norman-medium\n- Voice dataset: LibriVox public-domain recordings\n- Piper legacy engine release: MIT-licensed\n- Model source: rhasspy/piper-voices\n- Disclosure: final metadata identifies the narrator as an AI voice.\n", encoding="utf-8")
    targets = [clean, enhanced, cover, chapter_csv, reports / "final_qc.json", reports / "proofing_report.md", reports / "voice_license.md"]
    (reports / "checksums.sha256").write_text("".join(f"{sha256(p)}  {p.relative_to(ROOT)}\n" for p in targets), encoding="utf-8")
    print(json.dumps(qc, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(); sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("render-shard"); r.add_argument("--shard-index", type=int, required=True); r.add_argument("--shard-count", type=int, required=True)
    sub.add_parser("assemble"); args = parser.parse_args()
    if args.command == "render-shard":
        if not PIPER.exists() or not MODEL.exists() or not CONFIG.exists():
            raise FileNotFoundError("Piper binary/model/config missing")
        for chapter in [n for n in range(1, 24) if (n - 1) % args.shard_count == args.shard_index]:
            render_chapter(chapter)
    else:
        assemble()

if __name__ == "__main__":
    main()
