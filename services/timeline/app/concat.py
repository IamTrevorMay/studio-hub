import json
import subprocess
import tempfile
from pathlib import Path


def get_duration(video_path: str) -> float:
    """Get video duration in seconds via ffprobe."""
    cmd = [
        "ffprobe", "-v", "quiet", "-show_entries", "format=duration",
        "-of", "json", video_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {video_path}: {result.stderr}")
    data = json.loads(result.stdout)
    return float(data["format"]["duration"])


def concat_videos(file_paths: list[str]) -> tuple[str, float]:
    """
    Concatenate multiple video files using ffmpeg concat demuxer.

    Returns (output_path, total_duration_seconds).
    The caller is responsible for cleaning up the output file.
    """
    if len(file_paths) == 1:
        # Single file — no concat needed, return as-is
        dur = get_duration(file_paths[0])
        return file_paths[0], dur

    # Validate all files exist
    for p in file_paths:
        if not Path(p).is_file():
            raise FileNotFoundError(f"Video file not found: {p}")

    # Create concat list file
    list_file = tempfile.mktemp(suffix=".txt")
    with open(list_file, "w") as f:
        for p in file_paths:
            # Escape single quotes in paths for ffmpeg concat
            escaped = p.replace("'", "'\\''")
            f.write(f"file '{escaped}'\n")

    # Output to temp file
    output_path = tempfile.mktemp(suffix=".mp4")

    cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", list_file,
        "-c", "copy",  # stream copy — fast, no re-encode
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    Path(list_file).unlink(missing_ok=True)

    if result.returncode != 0:
        Path(output_path).unlink(missing_ok=True)
        raise RuntimeError(f"ffmpeg concat failed: {result.stderr}")

    dur = get_duration(output_path)
    return output_path, dur
