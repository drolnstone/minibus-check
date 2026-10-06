#!/usr/bin/env bash
# THE DOODLE VIDEOS, from the repo to MP4s: the three for passengers and the driver's.
#
#   video/build.sh                 word check, photographs, a still of every scene, all four videos
#   video/build.sh preview         the same but stills only: a couple of minutes, to look before the long part
#   video/build.sh 3               only the third video (or 1,3)
#   video/build.sh driver          only the driver video (preview-driver for its stills only)
#   NOSHOTS=1 video/build.sh ...   keep last time's photographs (only captions or timing changed)
#
# Leaves video/build/out/*.mp4 and video/build/preview/. See README.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
B="$HERE/build"
WHAT="${1:-1,2,3,driver}"
CLIPS="$WHAT"
case "$WHAT" in preview) CLIPS=1,2,3,driver ;; preview-driver) CLIPS=driver ;; esac
mkdir -p "$B/shots" "$B/fonts"

if [ -z "${PLAYWRIGHT_CORE:-}" ]; then
  G="$(npm root -g 2>/dev/null || true)"
  for p in "$HERE/../node_modules/playwright-core/index.mjs" "$G/playwright-core/index.mjs" \
           "$G/playwright/node_modules/playwright-core/index.mjs"; do
    if [ -f "$p" ]; then export PLAYWRIGHT_CORE="$p"; break; fi
  done
fi
: "${PLAYWRIGHT_CORE:?playwright-core not found. npm i -g playwright-core, or set PLAYWRIGHT_CORE to its index.mjs}"

# The church's clock, whatever this machine's is.
export TZ=Europe/London

# rough.js and the two typefaces, once, from npm.
if [ ! -f "$B/rough.js" ] || [ ! -f "$B/fonts/barlow-latin-700-normal.woff2" ]; then
  T="$(mktemp -d)"
  (cd "$T" && npm pack --silent roughjs@4.6.6 @fontsource/patrick-hand@5.3.0 @fontsource/barlow@5.3.0 >/dev/null)
  for f in "$T"/*.tgz; do mkdir -p "${f%.tgz}" && tar xzf "$f" -C "${f%.tgz}"; done
  cp "$T"/roughjs-*/package/bundled/rough.js "$B/"
  cp "$T"/fontsource-patrick-hand-*/package/files/patrick-hand-latin-400-normal.woff2 "$B/fonts/"
  for w in 300 400 700; do cp "$T"/fontsource-barlow-*/package/files/barlow-latin-$w-normal.woff2 "$B/fonts/"; done
  rm -rf "$T"
fi

# An ffmpeg with H.264: this machine's, or a copy fetched once from PyPI.
if [ -z "${FFMPEG:-}" ]; then
  if command -v ffmpeg >/dev/null && ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libx264; then
    FFMPEG="$(command -v ffmpeg)"
  else
    [ -d "$B/py/imageio_ffmpeg" ] || python3 -m pip install --quiet --target "$B/py" imageio-ffmpeg
    FFMPEG="$(PYTHONPATH="$B/py" python3 -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')"
  fi
fi
export FFMPEG

python3 "$HERE/check_words.py"
if [ -z "${NOSHOTS:-}" ]; then
  [ "$CLIPS" != "1,2,3,driver" ] || rm -f "$B/shots/marks.json"
  [ "$CLIPS" = driver ] || SHOTS="$B/shots" MINIBUS_PORT="${MINIBUS_PORT:-8133}" node "$HERE/shots.mjs"
  case ",$CLIPS," in *,driver,*) SHOTS="$B/shots" MINIBUS_PORT="${MINIBUS_PORT:-8133}" node "$HERE/shots-driver.mjs" ;; esac
fi
node "$HERE/render.mjs" preview "$CLIPS"
case "$WHAT" in preview*) ;; *) node "$HERE/render.mjs" video "$CLIPS" ;; esac
