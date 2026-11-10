#!/usr/bin/env bash
# Re-render one help video end to end: capture Storybook screens, build the
# HyperFrames project, render, and install the MP4 + poster in public/help/.
#
#   pnpm storybook            # in another terminal (or set STORYBOOK_URL)
#   scripts/help-videos/render.sh welcome [poster_seconds]
#   HELP_VIDEO_MOBILE=1 scripts/help-videos/render.sh welcome   # phone cut
#
# The phone cut is portrait 1080x1920, captured at phone size with each
# beat's `mobile:` overrides, and installs as <name>.mobile.mp4.
#
# Edit scripts/help-videos/<name>.beats.yaml, never the generated project.
set -euo pipefail

NAME="${1:?usage: render.sh <name> [poster_seconds]}"
POSTER_AT="${2:-1.0}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SB="${STORYBOOK_URL:-http://localhost:6006}"
WORK="${HELP_VIDEO_WORK:-$ROOT/.help-videos}"
BEATS="$HERE/$NAME.beats.yaml"
SUFFIX=""
[ "${HELP_VIDEO_MOBILE:-}" = "1" ] && SUFFIX=".mobile"
OUT="$NAME$SUFFIX"
PROJ="$WORK/projects/${NAME}${SUFFIX:+-mobile}"

cd "$ROOT"
node "$HERE/capture.mjs" "$BEATS" "$WORK/cap/$OUT" "$SB"
node "$HERE/build.mjs" "$BEATS" "$WORK/cap/$OUT" "$PROJ"

(cd "$PROJ" && npx --yes hyperframes@0.8.77 check && npx --yes hyperframes@0.8.77 render -q high --crf 18 -o renders/raw.mp4)

# Finish: sRGB tag + faststart so it starts playing before it fully loads.
ffmpeg -v error -y -i "$PROJ/renders/raw.mp4" -c copy -movflags +faststart \
  -color_primaries bt709 -color_trc iec61966-2-1 -colorspace bt709 "$ROOT/public/help/$OUT.mp4"
ffmpeg -v error -y -ss "$POSTER_AT" -i "$ROOT/public/help/$OUT.mp4" -frames:v 1 -q:v 3 "$ROOT/public/help/$OUT.jpg"
echo "installed public/help/$OUT.mp4 and $OUT.jpg"
