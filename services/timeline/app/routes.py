import json
import logging
import subprocess
from pathlib import Path

from fastapi import APIRouter, File, Form, Query, UploadFile, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from app.models import (
    AlignRequest, AlignResponse, AAFRequest, BeatSheet, Transcript,
)
from app.transcribe import transcribe_video
from app.align import align_beats
from app.aaf_gen import create_aaf

logger = logging.getLogger("timeline")
logging.basicConfig(level=logging.INFO)

router = APIRouter()


class ProcessByPathRequest(BaseModel):
    file_path: str
    beat_sheet: BeatSheet
    whisper_model: str = "medium"


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
    media_type = media_types.get(suffix, "video/mp4")
    return FileResponse(str(video_path), media_type=media_type)


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
        download_name = f"{name}_timeline.aaf"
        return FileResponse(
            aaf_path,
            media_type="application/octet-stream",
            filename=download_name,
        )
    except Exception as e:
        import traceback
        logger.error("AAF generation failed: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/process-steps")
async def process_steps_endpoint(request: ProcessByPathRequest):
    """
    Accepts a local file path + beat sheet. Reads the video directly
    from disk (no upload needed). Returns transcript + alignment JSON.
    """
    video_path = Path(request.file_path)
    if not video_path.is_file():
        raise HTTPException(status_code=400, detail=f"File not found: {request.file_path}")

    logger.info(f"Processing: {video_path.name} ({video_path.stat().st_size / 1e6:.0f} MB)")

    try:
        # Step 1: Transcribe
        logger.info("Step 1/3: Transcribing with Whisper (%s)...", request.whisper_model)
        transcript = transcribe_video(str(video_path), request.whisper_model)
        logger.info("Transcription complete: %d segments, %.1fs duration",
                     len(transcript.segments), transcript.duration)

        # Step 2: Align
        logger.info("Step 2/3: Aligning %d beats...", len(request.beat_sheet.beats))
        align_result = align_beats(request.beat_sheet, transcript)
        matched = len(align_result.aligned_beats) - len(align_result.unmatched_beat_ids)
        logger.info("Alignment complete: %d/%d matched", matched, len(align_result.aligned_beats))

        # Step 3: Get duration via ffprobe
        duration_s = transcript.duration
        probe_cmd = [
            "ffprobe", "-v", "quiet", "-show_entries", "format=duration",
            "-of", "json", str(video_path)
        ]
        probe = subprocess.run(probe_cmd, capture_output=True, text=True)
        if probe.returncode == 0:
            probe_data = json.loads(probe.stdout)
            duration_s = float(probe_data["format"]["duration"])

        logger.info("Done. Duration: %.1fs", duration_s)

        return {
            "transcript": transcript.model_dump(),
            "alignment": align_result.model_dump(),
            "duration_s": duration_s,
            "source_filename": video_path.name,
        }
    except FileNotFoundError as e:
        logger.error("Error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    except RuntimeError as e:
        logger.error("Error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
