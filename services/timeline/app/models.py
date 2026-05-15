from pydantic import BaseModel
from typing import Optional


class Beat(BaseModel):
    id: str
    title: str
    context: str = ""
    videos: list = []  # b-roll items: strings or {type, name, url}
    graphics: list = []
    notes: str = ""


class BeatSheet(BaseModel):
    id: str
    title: str
    beats: list[Beat]


class TranscriptWord(BaseModel):
    word: str
    start: float  # seconds
    end: float


class TranscriptSegment(BaseModel):
    text: str
    start: float
    end: float
    words: list[TranscriptWord] = []


class Transcript(BaseModel):
    segments: list[TranscriptSegment]
    duration: float  # total duration in seconds


class AlignedBeat(BaseModel):
    beat_id: str
    title: str
    b_roll: list[str]  # extracted b-roll label strings
    start_tc: float  # seconds
    end_tc: float  # seconds
    confidence: float  # 0.0 - 1.0
    manual: bool = False  # was this manually placed?


class AlignRequest(BaseModel):
    transcript: Transcript
    beat_sheet: BeatSheet


class AlignResponse(BaseModel):
    aligned_beats: list[AlignedBeat]
    unmatched_beat_ids: list[str]


class AAFRequest(BaseModel):
    aligned_beats: list[AlignedBeat]
    source_filename: str
    duration_s: float
    frame_rate: str = "29.97"
    whisper_model: str = "medium"


class ProcessRequest(BaseModel):
    beat_sheet: BeatSheet
    whisper_model: str = "medium"
