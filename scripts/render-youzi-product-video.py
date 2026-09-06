#!/usr/bin/env python3
"""Render 柚子樂器 branded YouTube and Shopee product videos.

The fixed profile and assets live in assets/product-video-brand. This program
does not upload anywhere or overwrite the source. It creates deterministic
local deliverables for the existing Codex media handoff to verify and upload.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ASSET_DIR = ROOT / "assets" / "product-video-brand"


def run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(command, check=True, **kwargs)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def probe(path: Path) -> dict:
    result = run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels",
        "-of", "json", str(path),
    ], capture_output=True, text=True)
    return json.loads(result.stdout)


def duration(info: dict) -> float:
    return float(info.get("format", {}).get("duration") or 0)


def has_audio(info: dict) -> bool:
    return any(row.get("codec_type") == "audio" for row in info.get("streams", []))


def asset(profile: dict, asset_dir: Path, section: str) -> Path:
    path = asset_dir / profile[section]["asset"]
    if not path.is_file():
        raise FileNotFoundError(f"missing fixed {section} asset: {path}")
    actual = sha256(path)
    expected = profile[section]["sha256"]
    if actual != expected:
        raise RuntimeError(f"fixed {section} asset SHA-256 mismatch: {actual}")
    return path


def filter_graph(
    *, start: float, main_duration: float, profile: dict, source_has_audio: bool,
    silent_input_index: int | None, watermark_corner: str,
) -> str:
    width = int(profile["output"]["width"])
    height = int(profile["output"]["height"])
    fps = int(profile["output"]["frameRate"])
    intro_duration = float(profile["intro"]["durationSeconds"])
    outro_duration = float(profile["outro"]["durationSeconds"])
    mark_width = round(width * float(profile["watermark"]["widthRatio"]))
    margin_x = round(width * float(profile["watermark"]["marginRatio"]))
    margin_y = round(height * float(profile["watermark"]["marginRatio"]))
    mark_x = str(margin_x) if watermark_corner == "top-left" else f"W-w-{margin_x}"
    opacity = float(profile["watermark"]["opacity"])
    audio_source = "[0:a]" if source_has_audio else f"[{silent_input_index}:a]"
    lines = [
        f"[1:v]trim=duration={intro_duration:.6f},setpts=PTS-STARTPTS,"
        f"scale={width}:{height}:flags=lanczos,fps={fps},format=yuv420p[introv]",
        f"[1:a]atrim=duration={intro_duration:.6f},asetpts=PTS-STARTPTS,"
        "aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[introa]",
        f"[0:v]trim=start={start:.6f}:duration={main_duration:.6f},setpts=PTS-STARTPTS,"
        f"scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=0xF8F4EB,"
        f"fps={fps},format=yuv420p,setsar=1[mainbase]",
        f"[2:v]scale={mark_width}:-1:flags=lanczos,format=rgba,"
        f"colorchannelmixer=aa={opacity:.4f}[watermark]",
        f"[mainbase][watermark]overlay=x={mark_x}:y={margin_y}:shortest=1:eof_action=pass[mainv]",
        f"{audio_source}atrim=start={start:.6f}:duration={main_duration:.6f},"
        "asetpts=PTS-STARTPTS,aresample=48000,"
        "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[maina]",
        f"[3:v]trim=duration={outro_duration:.6f},setpts=PTS-STARTPTS,"
        f"scale={width}:{height}:flags=lanczos,fps={fps},format=yuv420p[outrov]",
        f"[3:a]atrim=duration={outro_duration:.6f},asetpts=PTS-STARTPTS,"
        "aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[outroa]",
        "[introv][introa][mainv][maina][outrov][outroa]concat=n=3:v=1:a=1[v][a]",
    ]
    return ";\n".join(lines)


def render(
    *, source: Path, output: Path, start: float, main_duration: float,
    profile: dict, intro: Path, watermark: Path, outro: Path,
    source_has_audio: bool, shopee: bool, watermark_corner: str,
) -> dict:
    output.parent.mkdir(parents=True, exist_ok=True)
    expected_duration = profile["intro"]["durationSeconds"] + main_duration + profile["outro"]["durationSeconds"]
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
        "-i", str(source), "-i", str(intro),
        "-loop", "1", "-framerate", str(profile["output"]["frameRate"]), "-i", str(watermark),
        "-i", str(outro),
    ]
    silent_input_index = None
    if not source_has_audio:
        silent_input_index = 4
        command += [
            "-f", "lavfi", "-t", f"{main_duration:.6f}", "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
        ]
    graph = filter_graph(
        start=start, main_duration=main_duration, profile=profile,
        source_has_audio=source_has_audio, silent_input_index=silent_input_index,
        watermark_corner=watermark_corner,
    )
    with tempfile.NamedTemporaryFile("w", suffix=".ffgraph", encoding="utf-8") as graph_file:
        graph_file.write(graph)
        graph_file.flush()
        command += [
            "-filter_complex_script", graph_file.name, "-map", "[v]", "-map", "[a]",
            "-t", f"{expected_duration:.6f}", "-r", str(profile["output"]["frameRate"]),
            "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p",
        ]
        if shopee:
            command += ["-b:v", "2800k", "-maxrate", "3000k", "-bufsize", "6000k", "-c:a", "aac", "-b:a", "128k"]
        else:
            command += ["-crf", "18", "-c:a", "aac", "-b:a", "192k"]
        command += ["-ar", "48000", "-movflags", "+faststart", str(output)]
        run(command)

    info = probe(output)
    actual_duration = duration(info)
    size = output.stat().st_size
    if actual_duration > expected_duration + .04:
        raise RuntimeError(f"output duration exceeds composition: {actual_duration:.3f}s")
    if shopee:
        if actual_duration > float(profile["shopee"]["maximumDurationSeconds"]) + .001:
            raise RuntimeError(f"Shopee output exceeds 59 seconds: {actual_duration:.3f}s")
        if size > int(profile["shopee"]["maximumBytes"]):
            raise RuntimeError(f"Shopee output exceeds 30,000,000 bytes: {size}")
    return {
        "path": str(output.resolve()), "sha256": sha256(output),
        "durationSeconds": actual_duration, "sizeBytes": size,
        "brandProfileVersion": profile["version"], "watermarkCorner": watermark_corner,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--asset-dir", type=Path, default=DEFAULT_ASSET_DIR)
    parser.add_argument("--youtube-output", type=Path)
    parser.add_argument("--shopee-output", type=Path)
    parser.add_argument("--shopee-start", type=float)
    parser.add_argument("--watermark-corner", choices=["top-right", "top-left"], default="top-right")
    args = parser.parse_args()
    source = args.source.resolve()
    asset_dir = args.asset_dir.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    profile = json.loads((asset_dir / "profile-v1.json").read_text(encoding="utf-8"))
    intro = asset(profile, asset_dir, "intro")
    watermark = asset(profile, asset_dir, "watermark")
    outro = asset(profile, asset_dir, "outro")
    source_info = probe(source)
    source_duration = duration(source_info)
    if source_duration <= 0:
        raise RuntimeError("source video has no valid duration")
    source_audio = has_audio(source_info)
    stem = source.with_suffix("").name
    youtube_output = (args.youtube_output or source.with_name(stem + "-youtube-branded.mp4")).resolve()
    shopee_output = (args.shopee_output or source.with_name(stem + "-shopee-branded.mp4")).resolve()
    maximum_main = float(profile["shopee"]["maximumMainContentSeconds"])
    if source_duration > maximum_main and args.shopee_start is None:
        raise RuntimeError("source exceeds 54.7 seconds; inspect content and pass --shopee-start")
    shopee_start = max(0, float(args.shopee_start or 0))
    shopee_duration = min(maximum_main, source_duration - shopee_start)
    if shopee_duration <= 0:
        raise RuntimeError("Shopee selection starts after the source ends")
    receipts = {
        "source": {"path": str(source), "sha256": sha256(source), "durationSeconds": source_duration},
        "youtube": render(
            source=source, output=youtube_output, start=0, main_duration=source_duration,
            profile=profile, intro=intro, watermark=watermark, outro=outro,
            source_has_audio=source_audio, shopee=False, watermark_corner=args.watermark_corner,
        ),
        "shopee": render(
            source=source, output=shopee_output, start=shopee_start, main_duration=shopee_duration,
            profile=profile, intro=intro, watermark=watermark, outro=outro,
            source_has_audio=source_audio, shopee=True, watermark_corner=args.watermark_corner,
        ),
    }
    print(json.dumps(receipts, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
