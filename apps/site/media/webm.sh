#!/usr/bin/env bash
# WebM (VP9) copies of every clip, for browsers without H.264 (and Chromium builds used in checks).
# The page lists the mp4 first; each browser plays the first one it can.
set -euo pipefail
cd "$(dirname "$0")/out"
for f in *.mp4; do
  w="${f%.mp4}.webm"
  [ "$w" -nt "$f" ] && continue
  ffmpeg -v error -y -i "$f" -c:v libvpx-vp9 -b:v 0 -crf 40 -row-mt 1 -deadline good -cpu-used 4 -an "$w"
  echo "$w $(( $(stat -c %s "$w") / 1024 )) KB"
done
