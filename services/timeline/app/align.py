import logging
import re

from app.models import (
    AlignedBeat, AlignResponse, Beat, BeatSheet, Transcript,
)
from app.llm_align import llm_align_beats

logger = logging.getLogger("timeline")


def extract_b_roll_labels(beat: Beat) -> list[str]:
    """Extract human-readable b-roll labels from a beat's videos array."""
    labels = []
    for item in beat.videos:
        if isinstance(item, str):
            labels.append(item)
        elif isinstance(item, dict) and item.get("name"):
            labels.append(item["name"])
    return labels


def normalize_text(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    text = text.lower()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def extract_keywords(text: str, min_len: int = 3) -> set[str]:
    """Extract meaningful keywords from text (skip short/common words)."""
    stop = {"the", "and", "for", "are", "but", "not", "you", "all", "can",
            "her", "was", "one", "our", "out", "has", "his", "how", "its",
            "let", "may", "who", "did", "got", "had", "has", "him",
            "this", "that", "with", "have", "from", "they", "been", "will",
            "what", "when", "your", "said", "each", "make", "like", "just",
            "into", "than", "them", "then", "some", "about", "would", "there",
            "their", "which", "could", "other", "were", "more", "very"}
    words = normalize_text(text).split()
    return {w for w in words if len(w) >= min_len and w not in stop}


def align_beats(
    beat_sheet: BeatSheet,
    transcript: Transcript,
    use_llm_fallback: bool = True,
) -> AlignResponse:
    """
    Align beats to transcript using keyword overlap + optional LLM fallback.

    Phase 1: Keyword overlap on transcript segment windows (fast).
    Phase 2: LLM fallback for unmatched beats via Claude API.
    Multi-take: tracks all matches per beat, defaults to last occurrence.
    """
    # Pre-process segments
    segments = []
    for seg in transcript.segments:
        norm = normalize_text(seg.text)
        keywords = extract_keywords(seg.text)
        segments.append({
            "text": norm,
            "keywords": keywords,
            "start": seg.start,
            "end": seg.end,
        })

    # Build multi-segment windows (1-3 consecutive segments)
    windows = []
    for i, seg in enumerate(segments):
        windows.append({
            "text": seg["text"], "keywords": seg["keywords"],
            "start": seg["start"], "end": seg["end"], "seg_idx": i,
        })
        if i + 1 < len(segments):
            windows.append({
                "text": seg["text"] + " " + segments[i + 1]["text"],
                "keywords": seg["keywords"] | segments[i + 1]["keywords"],
                "start": seg["start"], "end": segments[i + 1]["end"], "seg_idx": i,
            })
        if i + 2 < len(segments):
            windows.append({
                "text": seg["text"] + " " + segments[i + 1]["text"] + " " + segments[i + 2]["text"],
                "keywords": seg["keywords"] | segments[i + 1]["keywords"] | segments[i + 2]["keywords"],
                "start": seg["start"], "end": segments[i + 2]["end"], "seg_idx": i,
            })

    aligned = []
    unmatched_ids = []
    last_matched_seg_idx = -1
    take_counts = {}  # beat_id -> number of matches found

    for beat in beat_sheet.beats:
        phrase = beat.title
        if beat.context:
            phrase += " " + beat.context

        beat_norm = normalize_text(phrase)
        beat_keywords = extract_keywords(phrase)
        b_roll = extract_b_roll_labels(beat)

        if not beat_keywords:
            unmatched_ids.append(beat.id)
            aligned.append(AlignedBeat(
                beat_id=beat.id, title=beat.title, b_roll=b_roll,
                start_tc=0.0, end_tc=0.0, confidence=0.0,
            ))
            take_counts[beat.id] = 0
            continue

        all_matches = []

        for win in windows:
            if not win["keywords"]:
                continue

            overlap = beat_keywords & win["keywords"]
            if not overlap:
                continue

            coverage = len(overlap) / len(beat_keywords)
            precision = len(overlap) / len(win["keywords"])
            score = coverage * 0.7 + precision * 0.3

            beat_words = beat_norm.split()[:5]
            if len(beat_words) >= 2:
                subseq = " ".join(beat_words[:3])
                if subseq in win["text"]:
                    score = min(1.0, score + 0.15)

            if score >= 0.35:
                all_matches.append((win, score))

        # Track multi-take count
        take_counts[beat.id] = len(all_matches)

        if all_matches:
            # Last take wins with monotonicity enforcement
            forward_matches = [(w, s) for w, s in all_matches if w["seg_idx"] >= last_matched_seg_idx]
            if forward_matches:
                best_window, best_score = max(forward_matches, key=lambda x: (x[0]["seg_idx"], x[1]))
            else:
                best_window, best_score = max(all_matches, key=lambda x: x[1])

            last_matched_seg_idx = best_window["seg_idx"]
            aligned.append(AlignedBeat(
                beat_id=beat.id, title=beat.title, b_roll=b_roll,
                start_tc=best_window["start"], end_tc=best_window["end"],
                confidence=min(1.0, best_score),
            ))
        else:
            unmatched_ids.append(beat.id)
            aligned.append(AlignedBeat(
                beat_id=beat.id, title=beat.title, b_roll=b_roll,
                start_tc=0.0, end_tc=0.0, confidence=0.0,
            ))

    # --- Phase 2: LLM fallback for unmatched beats ---
    if unmatched_ids and use_llm_fallback:
        logger.info("Running LLM fallback for %d unmatched beats...", len(unmatched_ids))
        unmatched_beat_data = []
        for beat in beat_sheet.beats:
            if beat.id in unmatched_ids:
                unmatched_beat_data.append({
                    "beat_id": beat.id,
                    "title": beat.title,
                    "context": beat.context,
                })

        anchored = [ab for ab in aligned if ab.confidence > 0]
        llm_results = llm_align_beats(unmatched_beat_data, transcript, anchored)

        for beat_id, result in llm_results.items():
            start = result.get("start_tc", 0)
            end = result.get("end_tc", 0)
            conf = result.get("confidence", 0)
            if conf > 0 and start > 0:
                # Update the aligned beat
                for ab in aligned:
                    if ab.beat_id == beat_id:
                        ab.start_tc = float(start)
                        ab.end_tc = float(end)
                        ab.confidence = float(conf)
                        break
                if beat_id in unmatched_ids:
                    unmatched_ids.remove(beat_id)
                logger.info("  LLM placed beat '%s' at %.1fs (conf %.2f)",
                           beat_id[:8], start, conf)

    # Set end timecodes: each beat extends to the start of the next matched beat
    matched_indices = [i for i, ab in enumerate(aligned) if ab.confidence > 0]
    for idx, pos in enumerate(matched_indices):
        if idx + 1 < len(matched_indices):
            next_pos = matched_indices[idx + 1]
            aligned[pos].end_tc = aligned[next_pos].start_tc
        else:
            aligned[pos].end_tc = min(
                aligned[pos].start_tc + 5.0,
                transcript.duration,
            )

    return AlignResponse(
        aligned_beats=aligned,
        unmatched_beat_ids=unmatched_ids,
        take_counts=take_counts,
    )
