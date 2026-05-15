#!/bin/bash
# Timeline Service — local Python service for Whisper + alignment + AAF generation
# Prerequisites: Python 3.10+, ffmpeg, whisper.cpp (main binary)

set -e

cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
fi

source venv/bin/activate
pip install -q -r requirements.txt

echo "Starting Timeline service on http://localhost:8420"
uvicorn app.main:app --host 0.0.0.0 --port 8420 --reload
