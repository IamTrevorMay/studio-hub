import json
import subprocess
import shutil
import tempfile
from pathlib import Path

from app.models import Transcript, TranscriptSegment, TranscriptWord

# whisper.cpp binary — looks for 'whisper-cpp' or 'main' in PATH,
# or set WHISPER_CPP_PATH env var
WHISPER_BIN_NAMES = ["whisper-cli", "whisper-cpp", "main"]
WHISPER_MODELS_DIR = Path.home() / ".cache" / "whisper-cpp" / "models"


def find_whisper_binary() -> str:
    import os
    env_path = os.environ.get("WHISPER_CPP_PATH")
    if env_path and Path(env_path).is_file():
        return env_path
    for name in WHISPER_BIN_NAMES:
        found = shutil.which(name)
        if found:
            return found
    raise FileNotFoundError(
        "whisper.cpp binary not found. Install whisper.cpp and ensure "
        "'whisper-cpp' or 'main' is in your PATH, or set WHISPER_CPP_PATH."
    )


def find_model_path(model_name: str) -> str:
    """Locate the whisper model file (ggml format)."""
    import os
    env_model = os.environ.get("WHISPER_MODEL_PATH")
    if env_model and Path(env_model).is_file():
        return env_model

    filename = f"ggml-{model_name}.bin"
    candidates = [
        WHISPER_MODELS_DIR / filename,
        Path.home() / ".cache" / "whisper" / filename,
        Path("/usr/local/share/whisper") / filename,
        Path("models") / filename,
    ]
    for p in candidates:
        if p.is_file():
            return str(p)
    raise FileNotFoundError(
        f"Whisper model '{filename}' not found. Download it to "
        f"{WHISPER_MODELS_DIR}/ or set WHISPER_MODEL_PATH."
    )


def extract_audio(video_path: str, output_path: str) -> None:
    """Extract 16kHz mono WAV from video using ffmpeg."""
    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr}")


def run_whisper(audio_path: str, model_name: str = "medium") -> dict:
    """Run whisper.cpp and return raw JSON output."""
    whisper_bin = find_whisper_binary()
    model_path = find_model_path(model_name)

    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        output_path = tmp.name

    cmd = [
        whisper_bin,
        "-m", model_path,
        "-f", audio_path,
        "--output-json-full",
        "-of", output_path.replace(".json", ""),
        "--no-prints",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if result.returncode != 0:
        raise RuntimeError(f"whisper.cpp failed: {result.stderr}")

    with open(output_path, "r") as f:
        return json.load(f)


def parse_whisper_output(raw: dict) -> Transcript:
    """Convert whisper.cpp JSON output to our Transcript model."""
    segments = []
    total_end = 0.0

    for seg in raw.get("transcription", []):
        words = []
        for token in seg.get("tokens", []):
            text = token.get("text", "").strip()
            if not text or text.startswith("["):
                continue
            t_start = token["offsets"]["from"] / 1000.0
            t_end = token["offsets"]["to"] / 1000.0
            words.append(TranscriptWord(word=text, start=t_start, end=t_end))

        seg_start = seg["offsets"]["from"] / 1000.0
        seg_end = seg["offsets"]["to"] / 1000.0
        total_end = max(total_end, seg_end)

        segments.append(TranscriptSegment(
            text=seg.get("text", "").strip(),
            start=seg_start,
            end=seg_end,
            words=words,
        ))

    return Transcript(segments=segments, duration=total_end)


def transcribe_video(video_path: str, model_name: str = "medium") -> Transcript:
    """Full pipeline: video → audio extraction → whisper → transcript."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav_path = tmp.name

    try:
        extract_audio(video_path, wav_path)
        raw = run_whisper(wav_path, model_name)
        return parse_whisper_output(raw)
    finally:
        Path(wav_path).unlink(missing_ok=True)
