#!/usr/bin/env bash
# Contact sheet for reviewing a recorded clip: 8 frames across its length, in a 4x2 grid.
# Usage: media/sheet.sh <name> <out.png>
set -euo pipefail
f="$(dirname "$0")/out/$1.mp4"
d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
ffmpeg -v error -y -i "$f" -vf "fps=8/${d},scale=640:-2,tile=4x2:padding=6:color=white" -frames:v 1 "$2"
echo "$1: ${d}s"
