#!/bin/bash
# Rebuilds SignOffBooth-program-and-guide.pdf from docs/src/guide.html. Needs Google Chrome and an internet connection (Google Fonts).
cd "$(dirname "$0")/../.." || exit 1
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless --disable-gpu --no-pdf-header-footer --virtual-time-budget=10000 \
  --print-to-pdf="$PWD/SignOffBooth-program-and-guide.pdf" "file://$PWD/docs/src/guide.html"
