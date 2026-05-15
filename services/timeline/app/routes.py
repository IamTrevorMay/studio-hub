import json
import logging
import subprocess
from pathlib import Path

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.models import (
    AlignRequest, AlignResponse, AAFRequest, BeatSheet, ProcessByPathRequest,
)
from app.transcribe import transcribe_video
from app.align import align_beats
from app.aaf_gen import create_aaf
from app.concat import concat_videos, get_duration

logger = logging.getLogger("timeline")
logging.basicConfig(level=logging.INFO)

router = APIRouter()


@router.get("/health")
async def health():
    return {"status": "ok", "service": "timeline"}


@router.get("/video")
async def stream_video(path: str = Query(...)):
    """Stream a local video file to the browser for preview playback."""
    video_path = Path(path)
    if not video_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    suffix = video_path.suffix.lower()
    media_types = {
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".mkv": "video/x-matroska",
        ".webm": "video/webm",
    }
    return FileResponse(str(video_path), media_type=media_types.get(suffix, "video/mp4"))


@router.post("/align", response_model=AlignResponse)
async def align_endpoint(request: AlignRequest):
    """Accept transcript + beat sheet, return aligned beats with confidence."""
    return align_beats(request.beat_sheet, request.transcript)


@router.post("/generate-aaf")
async def generate_aaf_endpoint(request: AAFRequest):
    """Accept aligned beats + source metadata, return AAF file."""
    try:
        aaf_path = create_aaf(
            aligned_beats=request.aligned_beats,
            source_filename=request.source_filename,
            duration_s=request.duration_s,
        )
        name = Path(request.source_filename).stem
        return FileResponse(
            aaf_path,
            media_type="application/octet-stream",
            filename=f"{name}_timeline.aaf",
        )
    except Exception as e:
        import traceback
        logger.error("AAF generation failed: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/process-steps")
async def process_steps_endpoint(request: ProcessByPathRequest):
    """
    Process one or more video files: concat → transcribe → align → return JSON.

    Accepts local file paths (no upload). Multiple files are concatenated
    in the order provided before transcription.
    """
    # Validate all files exist
    for fp in request.file_paths:
        if not Path(fp).is_file():
            raise HTTPException(status_code=400, detail=f"File not found: {fp}")

    file_count = len(request.file_paths)
    first_name = Path(request.file_paths[0]).name
    total_size = sum(Path(fp).stat().st_size for fp in request.file_paths)
    logger.info("Processing %d file(s): %s (%.0f MB total)",
                file_count, first_name, total_size / 1e6)

    concat_output = None
    try:
        # Step 0: Concat if multiple files
        if file_count > 1:
            logger.info("Step 0: Concatenating %d files...", file_count)
            video_path, duration_s = concat_videos(request.file_paths)
            concat_output = video_path  # track for cleanup
            logger.info("Concat complete: %.1fs", duration_s)
        else:
            video_path = request.file_paths[0]

        # Step 1: Transcribe
        logger.info("Step 1/3: Transcribing with Whisper (%s)...", request.whisper_model)
        transcript = transcribe_video(video_path, request.whisper_model)
        logger.info("Transcription complete: %d segments, %.1fs duration",
                     len(transcript.segments), transcript.duration)

        # Step 2: Align (with optional LLM fallback)
        logger.info("Step 2/3: Aligning %d beats (LLM fallback=%s)...",
                     len(request.beat_sheet.beats), request.use_llm_fallback)
        align_result = align_beats(
            request.beat_sheet, transcript,
            use_llm_fallback=request.use_llm_fallback,
        )
        matched = len(align_result.aligned_beats) - len(align_result.unmatched_beat_ids)
        logger.info("Alignment complete: %d/%d matched", matched, len(align_result.aligned_beats))

        # Step 3: Get accurate duration via ffprobe
        duration_s = transcript.duration
        probe_cmd = [
            "ffprobe", "-v", "quiet", "-show_entries", "format=duration",
            "-of", "json", video_path
        ]
        probe = subprocess.run(probe_cmd, capture_output=True, text=True)
        if probe.returncode == 0:
            probe_data = json.loads(probe.stdout)
            duration_s = float(probe_data["format"]["duration"])

        # Multi-take summary
        multi_take_beats = {k: v for k, v in align_result.take_counts.items() if v > 1}
        if multi_take_beats:
            logger.info("Multi-take beats: %d (using last take for each)", len(multi_take_beats))

        logger.info("Done. Duration: %.1fs", duration_s)

        return {
            "transcript": transcript.model_dump(),
            "alignment": align_result.model_dump(),
            "duration_s": duration_s,
            "source_filename": first_name,
            "file_count": file_count,
            "multi_take_count": len(multi_take_beats),
        }
    except FileNotFoundError as e:
        logger.error("Error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    except RuntimeError as e:
        logger.error("Error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Cleanup concat temp file
        if concat_output and concat_output != request.file_paths[0]:
            Path(concat_output).unlink(missing_ok=True)
