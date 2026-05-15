import os
import struct
import tempfile

import aaf2
from aaf2.misc import AAFRational

from app.models import AlignedBeat

# 29.97 fps NTSC drop-frame
EDIT_RATE = AAFRational(30000, 1001)

# Confidence-based slug colors (R, G, B) 0-255
SLUG_COLORS = {
    "high":   (34, 197, 94),    # green
    "medium": (234, 179, 8),    # yellow
    "low":    (249, 115, 22),   # orange
    "manual": (239, 68, 68),    # red
    "empty":  (107, 114, 128),  # gray
}

PIXEL_LAYOUT = [
    {"Code": "CompRed",   "Size": 8},
    {"Code": "CompGreen", "Size": 8},
    {"Code": "CompBlue",  "Size": 8},
    {"Code": "CompAlpha", "Size": 8},
]

# Pre-generate raw frame files per color (cached on disk in temp dir)
_RAW_CACHE = {}
FRAME_W, FRAME_H = 32, 18
NUM_FRAMES = 2  # minimal frames needed


def _get_raw_file(color: tuple) -> str:
    """Get or create a tiny raw RGBA video file for the given color."""
    if color in _RAW_CACHE and os.path.exists(_RAW_CACHE[color]):
        return _RAW_CACHE[color]

    r, g, b = color
    pixel = struct.pack("BBBB", r, g, b, 255)
    frame = pixel * (FRAME_W * FRAME_H)

    path = tempfile.mktemp(suffix=".raw")
    with open(path, "wb") as fp:
        for _ in range(NUM_FRAMES):
            fp.write(frame)

    _RAW_CACHE[color] = path
    return path


def confidence_tier(beat: AlignedBeat) -> str:
    if beat.manual:
        return "manual"
    if beat.confidence >= 0.8:
        return "high"
    if beat.confidence >= 0.5:
        return "medium"
    if beat.confidence > 0:
        return "low"
    return "manual"


def seconds_to_edit_units(seconds: float) -> int:
    """Convert seconds to edit units at 29.97fps."""
    return int(round(seconds * 30000 / 1001))


def _make_slug_mob(factory, content, name, length, color):
    """
    Create a MasterMob + SourceMob with embedded solid-color video essence.
    Premiere displays these as actual colored clips with the mob name as clip name.
    """
    raw_path = _get_raw_file(color)

    # Source mob with imported raw video essence
    src_mob = factory.create.SourceMob()
    slot = src_mob.import_rawvideo_essence(
        raw_path,
        edit_rate=EDIT_RATE,
        width=FRAME_W,
        height=FRAME_H,
        pixel_layout=PIXEL_LAYOUT,
    )
    # Override descriptor to 1920x1080 so Premiere creates a full-HD sequence
    desc = src_mob.descriptor
    desc["StoredWidth"].value = 1920
    desc["StoredHeight"].value = 1080
    desc["ImageAspectRatio"].value = AAFRational(16, 9)

    content.mobs.append(src_mob)

    # Master mob — its name becomes the clip name in Premiere
    master = factory.create.MasterMob(name)
    ms = master.create_timeline_slot(EDIT_RATE)
    clip = factory.create.SourceClip(
        start=0, length=length,
        mob_id=src_mob.mob_id, slot_id=slot.slot_id,
        media_kind="Picture",
    )
    ms.segment = clip
    content.mobs.append(master)
    return master


def create_aaf(
    aligned_beats: list[AlignedBeat],
    source_filename: str,
    duration_s: float,
) -> str:
    """
    Generate an AAF file with placeholder clips on V4+ for each beat's b-roll.

    Each clip has embedded solid-color video essence so Premiere renders it
    as a visible colored block on the timeline. The clip name is the b-roll
    file name from the beat sheet's videos array.

    Returns path to the generated AAF file.
    """
    output_path = tempfile.mktemp(suffix=".aaf")
    total_eu = seconds_to_edit_units(duration_s)

    with aaf2.open(output_path, "w") as f:

        comp_mob = f.create.CompositionMob()
        comp_mob.name = f"Timeline - {source_filename}"
        comp_mob.usage = "Usage_TopLevel"
        f.content.mobs.append(comp_mob)

        # V1
        v1_slot = comp_mob.create_timeline_slot(EDIT_RATE)
        v1_slot.name = "V1"
        v1_seq = f.create.Sequence("Picture")
        v1_seq.components.append(f.create.Filler("Picture", total_eu))
        v1_slot.segment = v1_seq

        # A1, A2
        for i in range(2):
            a_slot = comp_mob.create_timeline_slot(EDIT_RATE)
            a_slot.name = f"A{i + 1}"
            a_seq = f.create.Sequence("Sound")
            a_seq.components.append(f.create.Filler("Sound", total_eu))
            a_slot.segment = a_seq

        # V2, V3
        for tn in [2, 3]:
            vn_slot = comp_mob.create_timeline_slot(EDIT_RATE)
            vn_slot.name = f"V{tn}"
            vn_seq = f.create.Sequence("Picture")
            vn_seq.components.append(f.create.Filler("Picture", total_eu))
            vn_slot.segment = vn_seq

        # Only beats with b-roll from videos array
        matched_beats = sorted(
            [b for b in aligned_beats
             if (b.confidence > 0 or b.manual) and b.b_roll],
            key=lambda b: b.start_tc,
        )

        max_depth = min(
            max((len(b.b_roll) for b in matched_beats), default=1),
            3,
        )

        # V4, V5, V6
        for track_offset in range(max_depth):
            vn_slot = comp_mob.create_timeline_slot(EDIT_RATE)
            vn_slot.name = f"V{4 + track_offset}"
            vn_seq = f.create.Sequence("Picture")
            cursor = 0

            for beat in matched_beats:
                if track_offset >= len(beat.b_roll):
                    continue

                label = beat.b_roll[track_offset]
                start_eu = seconds_to_edit_units(beat.start_tc)
                end_eu = seconds_to_edit_units(beat.end_tc)
                slug_len = end_eu - start_eu

                if slug_len <= 0 or start_eu < cursor:
                    continue

                if start_eu > cursor:
                    vn_seq.components.append(
                        f.create.Filler("Picture", start_eu - cursor)
                    )
                    cursor = start_eu

                tier = confidence_tier(beat)
                color = SLUG_COLORS[tier]
                slug_mob = _make_slug_mob(f, f.content, label, slug_len, color)

                slug_clip = f.create.SourceClip(
                    start=0, length=slug_len,
                    mob_id=slug_mob.mob_id,
                    slot_id=slug_mob.slots[0].slot_id,
                    media_kind="Picture",
                )
                vn_seq.components.append(slug_clip)
                cursor += slug_len

            if cursor < total_eu:
                vn_seq.components.append(
                    f.create.Filler("Picture", total_eu - cursor)
                )
            vn_slot.segment = vn_seq

        f.save()

    return output_path
