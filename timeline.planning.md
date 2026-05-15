# Timeline Tool — Planning Spec

> Beat sheet + recorded video + Whisper transcript → AAF file with b-roll slugs for Premiere Pro.

---

## 1. Overview

The Timeline tool takes a finished beat sheet, one or more recorded video files, and auto-generates a Whisper transcript with word-level timestamps. It aligns each beat to the timecode where it was spoken, presents a review UI for manual adjustment, then exports an AAF file. On import into Premiere Pro, the AAF produces colored slug clips on V4 (and V5/V6 for stacked b-roll) labeled with the b-roll notes from each beat, spanning from that beat's timecode to the next beat's start.

**Location:** New page in the sidebar, grouped under a Post-Production folder alongside Clipping Tool, Teleprompter, Telestrator, and Organize.

---

## 2. User Flow

```
1. Open Timeline tool
2. Select a beat sheet (dropdown, from Supabase beat_sheets table)
3. Upload/select source video(s)
   - Local file upload (drag & drop or file picker)
   - OR select from Google Drive (existing drive picker integration)
   - If multiple files: reorder them in a drag-sortable list
4. Click "Process" → local Python service:
   a. Concatenates multi-file input (ffmpeg)
   b. Runs Whisper.cpp → word-level transcript JSON
   c. Runs hybrid alignment (fuzzy match → Claude API fallback)
   d. Returns aligned beats with timecodes + confidence scores
5. Review UI appears:
   - Mini-timeline showing source video waveform/thumbnails
   - Aligned beats rendered as draggable blocks on the timeline
   - Unmatched beats flagged in red, manually placeable
   - Each beat shows: title, b-roll items, matched timecode, confidence
6. User adjusts any beats, then clicks "Export AAF"
7. AAF generated locally → two delivery paths:
   a. Browser download (immediate)
   b. Upload to project's Google Drive folder (async)
```

---

## 3. AAF Generation

### 3.1 Library: pyaaf2

`pyaaf2` is the only maintained Python library for writing AAF. No real alternatives exist — the AAF SDK (C++) is Avid's reference but impractical for this use case. `pyaaf2` handles Premiere Pro import well for basic compositions.

**Install:** `pip install pyaaf2`

### 3.2 Minimal AAF Structure

```
AAF File
└── Composition Mob (sequence)
    ├── Timeline Slot 1 — V1 (main video)
    │   └── Source Clip → Master Mob → Source Mob (references .mp4/.mov)
    ├── Timeline Slot 2 — V2 (empty, reserved)
    ├── Timeline Slot 3 — V3 (empty, reserved)
    ├── Timeline Slot 4 — V4 (b-roll slugs, primary)
    │   └── Sequence of: Filler → Slug → Filler → Slug → ...
    ├── Timeline Slot 5 — V5 (overflow for stacked b-roll)
    │   └── (only populated when a beat has 2+ b-roll items)
    └── Timeline Slot 6 — V6 (overflow for 3+ b-roll items)
        └── (only populated when a beat has 3+ b-roll items)
```

### 3.3 Placeholder Representation: Colored Slugs

**Why slugs over alternatives:**

| Option | Premiere Behavior | Verdict |
|--------|-------------------|---------|
| Markers/Locators | Import reliably but no visual presence on timeline; easy to miss | Too subtle |
| Generator clips | AAF generator mob support is inconsistent across NLEs | Fragile |
| Title clips | Require rendering a title mob in AAF; complex, often loses text on import | Unreliable |
| **Colored slugs** | **Import as solid-color clips with editable clip names; highly visible on V4** | **Best option** |

**Slug details:**
- Each slug is a `Filler` mob in AAF with a `ConstantValue` color parameter
- Clip name = b-roll label from the beat (e.g., "Wide shot of mound")
- Duration = timecode of current beat to timecode of next beat (last beat gets 5s default or extends to end of source)
- Color coding by beat type/priority (TBD, can default to a single accent color like indigo `#6366f1`)
- Slugs placed on V4; if a beat has 2 b-roll items, second goes on V5; third on V6

**Premiere Pro import result:**
- Editor sees colored bars on V4 above the main edit
- Each bar is labeled with the b-roll description
- Editor can right-click → Replace With Clip to swap in actual footage

### 3.4 Technical Parameters

- **Frame rate:** 29.97 fps (NTSC drop-frame)
- **Edit rate:** `aaf.util.AAFRational(30000, 1001)` in pyaaf2
- **Sample rate:** 48000 Hz (standard for video production)
- **Timecode base:** Drop-frame to match 29.97

---

## 4. Alignment Strategy

### 4.1 Hybrid Approach: Fuzzy Match + LLM Fallback

**Phase 1 — Fuzzy text matching (local, fast):**
1. Extract key phrases from each beat's `title` + `context` fields
2. Sliding window over transcript words (window size = beat phrase word count +/- 30%)
3. Score each window using `difflib.SequenceMatcher` ratio
4. Accept matches with confidence >= 0.65
5. Enforce monotonicity: beats must appear in order; if a match would violate beat order, skip it for LLM fallback

**Phase 2 — LLM-assisted alignment (Claude API, for unmatched beats):**
1. Send to Claude: the full transcript text, the unmatched beat titles/context, and the already-anchored beat timecodes as reference points
2. Prompt: "Given this transcript with word-level timestamps and these beat descriptions, identify the timecode range where each beat is discussed. Return JSON."
3. Claude returns `{ beat_id: { start_tc: float, end_tc: float, confidence: float } }`
4. Cost: ~$0.01–0.05 per run (15–40 beats, 15–45 min transcript)

**Phase 3 — Multi-take handling ("last take wins"):**
1. After alignment, if the same beat matches multiple locations in the transcript, keep the last occurrence
2. This handles the natural pattern of re-recording: the final take is the keeper

### 4.2 Confidence Scoring

Each aligned beat gets a confidence score:
- **High (>= 0.8):** Strong fuzzy match, shown in green in review UI
- **Medium (0.5–0.8):** Partial match or LLM-aligned, shown in yellow
- **Low (< 0.5):** Weak match, shown in orange — review recommended
- **Unmatched (0):** No match found, shown in red — manual placement required

---

## 5. Review UI (React, in Mayday Studio)

### 5.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│  Timeline Tool                              [Export AAF] │
├─────────────────────────────────────────────────────────┤
│  Beat Sheet: [Dropdown ▾]    Source: filename.mp4       │
│                               Status: Aligned (32/35)   │
├─────────────────────────────────────────────────────────┤
│  ┌─ Timeline ─────────────────────────────────────────┐ │
│  │ [▶] ──────────●─────────────────────────── 00:32:15│ │
│  │                                                     │ │
│  │ V1 ███████████████████████████████████████████████ │ │
│  │ V4 ██ slug ██  ██ slug ██  ██ slug ██  ██ slug ██ │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ Beat List ────────────────────────────────────────┐ │
│  │ ● Beat 1: "Opening hook"         00:00:12  ✓ High │ │
│  │   └─ B-roll: Wide shot of studio                   │ │
│  │ ● Beat 2: "Introduce topic"      00:01:34  ✓ High │ │
│  │   └─ B-roll: Screen recording                      │ │
│  │ ▲ Beat 3: "Stats comparison"     00:03:22  ⚠ Med  │ │
│  │   └─ B-roll: Infographic overlay                   │ │
│  │ ✖ Beat 4: "B-roll moment"        --:--:--  ✖ None │ │
│  │   └─ B-roll: Slow-mo pitch       [Place manually]  │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Interactions

- **Drag beats** on the timeline to adjust timecode
- **Click unmatched beat** → enters placement mode, click on timeline to set timecode
- **Hover slug** on timeline → tooltip with beat title + b-roll list
- **Play from beat** → click beat in list to scrub video to that timecode
- Video player (basic HTML5 `<video>`) for reference — not a full NLE

---

## 6. Edge Cases

### 6.1 Variable Speech Pace
Fuzzy matching uses word-count-proportional windows, not fixed durations. If someone speaks slowly through beat 5 and fast through beat 6, the windows adapt.

### 6.2 Beats Spanning Multiple Sentences
The beat's timecode = start of the first matched sentence. The slug duration extends to the next beat's start, so multi-sentence beats are naturally covered.

### 6.3 Empty B-Roll Fields
If a beat has no items in its `videos` array, still place a slug on V4 with the beat title as the label (the editor may want to add b-roll there anyway). Color it differently (gray) to distinguish from explicit b-roll cues.

### 6.4 Out-of-Order Beats
Monotonicity enforcement in fuzzy matching handles minor reordering. If the speaker significantly reorders the beat sheet:
- Fuzzy match will skip out-of-order beats
- LLM fallback will identify them and flag with lower confidence
- Review UI lets the user see and correct

### 6.5 Multi-File Source
User orders files in the UI before processing. The Python service:
1. Validates files (codec check via ffprobe)
2. Concatenates with ffmpeg (`-filter_complex concat`)
3. Generates a single transcript against the concatenated file
4. All timecodes reference the concatenated timeline

### 6.6 Last-Take Preference
When the same beat text appears multiple times in the transcript (re-takes), the aligner keeps the last occurrence. The review UI shows all occurrences with a "take" indicator so the user can override.

### 6.7 Multi-B-Roll Stacking
Beat with 3 b-roll items → slugs on V4, V5, V6 at the same timecode. AAF tracks are pre-created up to V6 (3 overflow tracks). If a beat has >3 b-roll items, items 4+ are concatenated into the V6 slug label.

---

## 7. Pipeline Architecture

### 7.1 Components

```
┌─────────────────────┐         ┌──────────────────────────────┐
│   Mayday Studio     │  HTTP   │   Local Python Service        │
│   (React frontend)  │◄──────►│   (FastAPI on localhost)       │
│                     │         │                                │
│  - Beat sheet fetch │         │  1. ffmpeg concat (if multi)   │
│  - File upload      │         │  2. whisper.cpp transcription  │
│  - Review UI        │         │  3. Fuzzy alignment            │
│  - AAF download     │         │  4. Claude API fallback        │
│                     │         │  5. pyaaf2 AAF generation      │
└────────┬────────────┘         └──────────────────────────────┘
         │
         │ Supabase
         ▼
┌─────────────────────┐
│  beat_sheets table   │
│  timeline_sessions   │ (new)
│  Google Drive API    │
└─────────────────────┘
```

### 7.2 Local Python Service (FastAPI)

Runs on the editor's machine (or a shared studio machine). Endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /transcribe` | POST | Accept video file(s), run whisper.cpp, return transcript JSON |
| `POST /align` | POST | Accept transcript + beat sheet, run hybrid alignment, return aligned beats |
| `POST /generate-aaf` | POST | Accept aligned beats + source video metadata, return AAF file |
| `POST /process` | POST | All-in-one: video(s) → transcript → alignment → AAF |
| `GET /health` | GET | Service status check |

**Why FastAPI:** Lightweight, async-capable, easy file handling, good for local services. The Mayday Studio React app calls these endpoints via fetch.

### 7.3 New Supabase Table: `timeline_sessions`

Stores session metadata for history/re-export:

```sql
CREATE TABLE timeline_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beat_sheet_id UUID REFERENCES beat_sheets(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  source_files JSONB NOT NULL DEFAULT '[]',
  -- [{ name, drive_id?, duration_s, order }]
  transcript JSONB,
  -- Full Whisper output with word-level timestamps
  aligned_beats JSONB,
  -- [{ beat_id, title, b_roll[], start_tc, end_tc, confidence, manual }]
  aaf_drive_id TEXT,
  -- Google Drive file ID of exported AAF
  frame_rate TEXT DEFAULT '29.97',
  status TEXT DEFAULT 'pending',
  -- pending | transcribing | aligning | review | exported | error
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE timeline_sessions ENABLE ROW LEVEL SECURITY;
-- RLS: admin and assistant roles can read/write
```

### 7.4 Delivery

1. **In-app download:** After export, the AAF binary is returned to the browser and offered as a download (`<a download>` blob URL)
2. **Drive upload:** If the beat sheet or project has a `drive_folder_id`, the AAF is also uploaded there via the existing `drive-upload-init` edge function
3. **Filename convention:** `{beat_sheet_title}_timeline_{YYYY-MM-DD}.aaf`

---

## 8. Dependencies

### Python Service
- `pyaaf2` — AAF file writing
- `fastapi` + `uvicorn` — HTTP server
- `whisper.cpp` — local transcription (called as subprocess)
- `anthropic` — Claude API for LLM alignment fallback
- `ffmpeg` / `ffprobe` — video concat + codec inspection (system install)
- `difflib` (stdlib) — fuzzy text matching

### Frontend (React)
- No new npm packages — uses existing patterns (inline styles, Supabase hooks, etc.)
- HTML5 `<video>` for playback
- Drag interactions via native HTML drag events (no library needed for the scale of this UI)

---

## 9. Scope & Phases

### Phase 1 (MVP)
- Single-file video upload (local only)
- Whisper transcription
- Fuzzy-match-only alignment (no LLM fallback)
- Basic review UI (beat list with timecodes, no timeline viz)
- AAF export with slugs on V4
- Browser download only

### Phase 2
- Multi-file video support with ordering UI
- LLM fallback alignment via Claude API
- Full review UI with mini-timeline and drag-to-adjust
- Google Drive source file picker
- Drive upload of AAF
- `timeline_sessions` table for history

### Phase 3
- Multi-take detection with "last take wins" + take selector
- Slug color coding by category/priority
- Waveform visualization on timeline
- Session re-export (load previous alignment, re-generate AAF)
- Video thumbnail strip on timeline

---

## 10. Resolved Questions

1. **Whisper model size** — Configurable dropdown per session. Default to `medium`. Options: `base`, `small`, `medium`, `large-v3`.
2. **Slug colors** — Color-coded by alignment confidence: green (high >= 0.8), yellow (medium 0.5-0.8), orange (low < 0.5), red (manually placed).
3. **Audio tracks in AAF** — Yes, include source audio on A1/A2 for editor sync verification.
4. **Python service distribution** — Start with pip install + run script for dev. Decide on distribution method (Docker, PyInstaller, etc.) after MVP is validated.
