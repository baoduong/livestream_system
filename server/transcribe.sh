#!/bin/bash
# Transcribe audio file using faster-whisper
# Usage: ./transcribe.sh /path/to/audio.ogg
export KMP_DUPLICATE_LIB_OK=TRUE
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
python3 "$SCRIPT_DIR/whisper-server.py" "$1"
