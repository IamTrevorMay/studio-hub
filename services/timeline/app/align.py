import re
from difflib import SequenceMatcher

from app.models import (
    AlignedBeat, AlignResponse, Beat, BeatSheet, Transcript,
)


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


def align_beats(beat_sheet: BeatSheet, transcript: Transcript) -> AlignResponse:
    """
    Align beats to transcript segments using keyword overlap scoring.

    Fast approach: instead of sliding a word-level window with SequenceMatcher
    (O(n^2) per beat × per window), we score each transcript segment against
    each beat using keyword overlap + subsequence bonus. This is O(beats × segments).
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

    # Build multi-segment windows (1-3 consecutive segments) for broader matching
    windows = []
    for i, seg in enumerate(segments):
        # Single segment
        windows.append({
            "text": seg["text"],
            "keywords": seg["keywords"],
            "start": seg["start"],
            "end": seg["end"],
            "seg_idx": i,
        })
        # Two consecutive segments
        if i + 1 < len(segments):
            combined_text = seg["text"] + " " + segments[i + 1]["text"]
            combined_kw = seg["keywords"] | segments[i + 1]["keywords"]
            windows.append({
                "text": combined_text,
                "keywords": combined_kw,
                "start": seg["start"],
                "end": segments[i + 1]["end"],
                "seg_idx": i,
            })
        # Three consecutive segments
        if i + 2 < len(segments):
            combined_text = seg["text"] + " " + segments[i + 1]["text"] + " " + segments[i + 2]["text"]
            combined_kw = seg["keywords"] | segments[i + 1]["keywords"] | segments[i + 2]["keywords"]
            windows.append({
                "text": combined_text,
                "keywords": combined_kw,
                "start": seg["start"],
                "end": segments[i + 2]["end"],
                "seg_idx": i,
            })

    aligned = []
    unmatched_ids = []
    last_matched_seg_idx = -1

    for beat in beat_sheet.beats:
        phrase = beat.title
        if beat.context:
            phrase += " " + beat.context

        beat_norm = normalize_text(phrase)
        beat_keywords = extract_keywords(phrase)
        b_roll = extract_b_roll_labels(beat)

        if not beat_keywords:
            # No meaningful keywords to match
            unmatched_ids.append(beat.id)
            aligned.append(AlignedBeat(
                beat_id=beat.id, title=beat.title,
                b_roll=b_roll,
                start_tc=0.0, end_tc=0.0, confidence=0.0,
            ))
            continue

        best_score = 0.0
        best_window = None
        all_matches = []  # for multi-take: collect all good matches

        for win in windows:
            if not win["keywords"]:
                continue

            # Keyword overlap (Jaccard-like, weighted toward beat coverage)
            overlap = beat_keywords & win["keywords"]
            if not overlap:
                continue

            # Beat coverage: what fraction of beat keywords appear in this window
            coverage = len(overlap) / len(beat_keywords)

            # Precision: what fraction of window keywords match the beat
            precision = len(overlap) / len(win["keywords"])

            # Combined score: emphasize coverage (we want to find WHERE the beat is)
            score = coverage * 0.7 + precision * 0.3

            # Bonus for subsequence match (first few words of beat appear in order)
            beat_words = beat_norm.split()[:5]
            if len(beat_words) >= 2:
                subseq = " ".join(beat_words[:3])
                if subseq in win["text"]:
                    score = min(1.0, score + 0.15)

            if score >= 0.35:
                all_matches.append((win, score))

            if score > best_score:
                best_score = score
                best_window = win

        if all_matches:
            # Last take wins: among good matches, prefer the latest one
            # But enforce monotonicity with last_matched_seg_idx
            forward_matches = [(w, s) for w, s in all_matches if w["seg_idx"] >= last_matched_seg_idx]
            if forward_matches:
                # Take the last occurrence among forward matches with decent score
                best_forward = max(forward_matches, key=lambda x: (x[0]["seg_idx"], x[1]))
                best_window, best_score = best_forward

            if best_window:
                last_matched_seg_idx = best_window["seg_idx"]
                aligned.append(AlignedBeat(
                    beat_id=beat.id, title=beat.title,
                    b_roll=b_roll,
                    start_tc=best_window["start"],
                    end_tc=best_window["end"],
                    confidence=min(1.0, best_score),
                ))
            else:
                unmatched_ids.append(beat.id)
                aligned.append(AlignedBeat(
                    beat_id=beat.id, title=beat.title,
                    b_roll=b_roll,
                    start_tc=0.0, end_tc=0.0, confidence=0.0,
                ))
        else:
            unmatched_ids.append(beat.id)
            aligned.append(AlignedBeat(
                beat_id=beat.id, title=beat.title,
                b_roll=b_roll,
                start_tc=0.0, end_tc=0.0, confidence=0.0,
            ))

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

    return AlignResponse(aligned_beats=aligned, unmatched_beat_ids=unmatched_ids)
