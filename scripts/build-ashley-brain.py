#!/usr/bin/env python3
"""Regenerate supabase/functions/generate-ashley-read/brain.ts from Ashley's brain docs.

Edge functions can't read the repo /Ashley dir at runtime, so the docs that ground
Ashley's Analytics read are vendored into the function as a base64-embedded const.
Run from the repo root after any of the source docs change:

    python3 scripts/build-ashley-brain.py
"""
import base64, os

DOCS = [
    "Ashley/ASHLEY.md",
    "Ashley/README.md",
    "Ashley/applied/youtube-longform-playbook.md",
    "Ashley/youtube-shorts/03-shorts-channel-strategy-funnel.md",
    "Ashley/cross-platform/06-shortform-analytics-benchmarks.md",
    "Ashley/tiktok/01-algorithm-distribution.md",
    "Ashley/audit/more-mayday-channel-audit.md",
    "Ashley/audit/trevor-may-baseball-channel-audit.md",
    "Carl/context/mayday-context.md",
]
OUT = "supabase/functions/generate-ashley-read/brain.ts"


def main():
    parts = []
    for d in DOCS:
        with open(d, "r", encoding="utf-8") as f:
            parts.append(f"\n\n===== BRAIN DOC: {d} =====\n\n{f.read()}")
    blob = "".join(parts)
    b64 = base64.b64encode(blob.encode("utf-8")).decode("ascii")
    lines = [b64[i:i + 120] for i in range(0, len(b64), 120)]
    arr = ",\n  ".join(f'"{ln}"' for ln in lines)
    header = "// AUTO-GENERATED — do not edit by hand.\n"
    header += "// Vendored copy of Ashley's brain docs (edge runtime cannot read the repo /Ashley dir).\n"
    header += "// Source docs (regenerate via scripts/build-ashley-brain.py if they change):\n"
    for d in DOCS:
        header += f"//   - {d}\n"
    header += "// Decodes to the concatenated markdown used as Ashley's system context.\n\n"
    out = header + "const B64_CHUNKS = [\n  " + arr + "\n];\n\n"
    out += "export const ASHLEY_BRAIN = new TextDecoder().decode(\n"
    out += "  Uint8Array.from(atob(B64_CHUNKS.join(\"\")), (c) => c.charCodeAt(0)),\n);\n"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes, {len(blob)} decoded chars)")


if __name__ == "__main__":
    main()
