#!/usr/bin/env bash
# THE DOODLE VIDEOS, from the repo to MP4s: the three for passengers, the driver's and the overview.
#
#   video/build.sh                 word check, photographs, a still of every scene, all four videos
#   video/build.sh preview         the same but stills only: a couple of minutes, to look before the long part
#   video/build.sh 3               only the third video (or 1,3)
#   video/build.sh driver          only the driver video (preview-driver for its stills only)
#   video/build.sh overview        only the overview of the whole system, for showing someone new
#                                  (preview-overview for its stills only; it photographs all three apps,
#                                  the coordinator's through its browser checks, about 15 minutes)
#   NOSHOTS=1 video/build.sh ...   keep last time's photographs (only captions or timing changed)
#
# Leaves video/build/out/*.mp4 and video/build/preview/. See README.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
B="$HERE/build"
WHAT="${1:-1,2,3,driver}"
CLIPS="$WHAT"
case "$WHAT" in preview) CLIPS=1,2,3,driver ;; preview-driver) CLIPS=driver ;; preview-overview) CLIPS=overview ;; esac
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
# Made-up stop names and postcodes (same times and ids as the real timetable), so no real address is shown.
export MINIBUS_REAL="${MINIBUS_REAL:-$HERE/fake-stops.json}"

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

# The word check holds the passenger and driver videos to the pages; the
# overview has no star words for it to hold.
case ",$CLIPS," in *,1,*|*,2,*|*,3,*|*,driver,*) python3 "$HERE/check_words.py" ;; esac
# Every photograph through mask.mjs: made-up registrations, and made-up stops
# on the coordinator's pictures too.
MASK=(--import "$HERE/mask.mjs")
if [ -z "${NOSHOTS:-}" ]; then
  [ "$CLIPS" != "1,2,3,driver" ] || rm -f "$B/shots/marks.json"
  [ "$CLIPS" = driver ] || SHOTS="$B/shots" MINIBUS_PORT="${MINIBUS_PORT:-8133}" node "${MASK[@]}" "$HERE/shots.mjs"
  case ",$CLIPS," in *,driver,*|*,overview,*) SHOTS="$B/shots" MINIBUS_PORT="${MINIBUS_PORT:-8133}" node "${MASK[@]}" "$HERE/shots-driver.mjs" ;; esac
  # The coordinator app, for the overview: its browser checks run on the real
  # timetable (they look for its stop names), so MINIBUS_REAL is emptied for
  # them and mask.mjs swaps the names in each picture. The screens the
  # overview shows are copied in as c-*.png.
  case ",$CLIPS," in *,overview,*)
    rm -rf "$B/coord-shots"; mkdir -p "$B/coord-shots"
    (cd "$HERE/.." && MINIBUS_REAL= SHOTS="$B/coord-shots" MINIBUS_PORT="${MINIBUS_PORT:-8133}" node "${MASK[@]}" tests/browser/coordinator.mjs)
    for p in C1-home:home C37-rota:rota C2a-sunday:cover C1a-wrong-pin:wrong-pin C42-drivers:drivers C7a-bookings:bookings \
             C13a-stopped:stopped C37-runs:runs C8a-defects:defects C37-bus:bus C29h-fuel-bought:fuel C56a-message:message \
             C52-pick:calls C10a-look:look; do
      cp "$B/coord-shots/${p%%:*}.png" "$B/shots/c-${p##*:}.png"
    done ;;
  esac
fi
node "$HERE/render.mjs" preview "$CLIPS"
case "$WHAT" in preview*) ;; *) node "$HERE/render.mjs" video "$CLIPS" ;; esac
