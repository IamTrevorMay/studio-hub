import json
import logging
import os

from app.models import AlignedBeat, BeatSheet, Transcript

logger = logging.getLogger("timeline")


def llm_align_beats(
    unmatched_beats: list[dict],
    transcript: Transcript,
    anchored_beats: list[AlignedBeat],
) -> dict[str, dict]:
    """
    Use Claude API to align beats that fuzzy matching couldn't place.

    Args:
        unmatched_beats: list of {beat_id, title, context} dicts
        transcript: full transcript with segments
        anchored_beats: already-aligned beats for context

    Returns:
        dict mapping beat_id -> {start_tc, end_tc, confidence}
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.warning("ANTHROPIC_API_KEY not set — skipping LLM alignment")
        return {}

    try:
        import anthropic
    except ImportError:
        logger.warning("anthropic package not installed — skipping LLM alignment")
        return {}

    # Build transcript text with timestamps
    transcript_lines = []
    for seg in transcript.segments:
        mins = int(seg.start // 60)
        secs = int(seg.start % 60)
        transcript_lines.append(f"[{mins:02d}:{secs:02d}] {seg.text}")
    transcript_text = "\n".join(transcript_lines)

    # Build context from anchored beats
    anchor_lines = []
    for ab in sorted(anchored_beats, key=lambda b: b.start_tc):
        if ab.confidence > 0:
            mins = int(ab.start_tc // 60)
            secs = int(ab.start_tc % 60)
            anchor_lines.append(f"  [{mins:02d}:{secs:02d}] Beat: {ab.title}")
    anchors_text = "\n".join(anchor_lines) if anchor_lines else "(none yet)"

    # Build unmatched beats list
    unmatched_lines = []
    for b in unmatched_beats:
        text = b["title"]
        if b.get("context"):
            text += f" — {b['context']}"
        unmatched_lines.append(f"  - beat_id={b['beat_id']}: \"{text}\"")
    unmatched_text = "\n".join(unmatched_lines)

    prompt = f"""You are aligning a video beat sheet to a transcript. Some beats could not be matched automatically.

TRANSCRIPT (with timestamps):
{transcript_text}

ALREADY ANCHORED BEATS:
{anchors_text}

UNMATCHED BEATS TO PLACE:
{unmatched_text}

For each unmatched beat, find the timestamp in the transcript where that topic is discussed.
Return ONLY valid JSON — no markdown, no explanation:
{{
  "<beat_id>": {{"start_tc": <seconds>, "end_tc": <seconds>, "confidence": <0.0-1.0>}},
  ...
}}

If a beat genuinely doesn't appear in the transcript, set confidence to 0 and start_tc/end_tc to 0.
Use the anchored beats as reference points for ordering."""

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )

        result_text = response.content[0].text.strip()
        # Strip markdown code fences if present
        if result_text.startswith("```"):
            result_text = result_text.split("\n", 1)[1]
            if result_text.endswith("```"):
                result_text = result_text[:-3]

        result = json.loads(result_text)
        logger.info("LLM alignment returned %d results", len(result))
        return result

    except json.JSONDecodeError as e:
        logger.error("LLM returned invalid JSON: %s", e)
        return {}
    except Exception as e:
        logger.error("LLM alignment failed: %s", e)
        return {}
