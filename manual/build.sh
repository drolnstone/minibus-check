#!/usr/bin/env bash
# THE DRIVER'S MANUAL, from a download of the spreadsheet to a checked PDF.
#
#   manual/build.sh "Minibus checks.xlsx"              everything
#   manual/build.sh "Minibus checks.xlsx" 'run*,hub'   only those pictures again
#
# Leaves manual/build/minibus-driver-manual-<app version>.pdf. See README.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export MANUAL_BUILD="${MANUAL_BUILD:-$HERE/build}"
XLSX="${1:?Give the spreadsheet download: manual/build.sh "Minibus checks.xlsx"}"
mkdir -p "$MANUAL_BUILD/shots"

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

python3 "$HERE/export.py" "$XLSX" "$MANUAL_BUILD/real.json"
python3 "$HERE/fonts.py"
node "$HERE/checklist.mjs" "$MANUAL_BUILD/checklist.json"
MINIBUS_REAL="$MANUAL_BUILD/real.json" SHOTS="$MANUAL_BUILD/shots" MINIBUS_PORT="${MINIBUS_PORT:-8123}" \
  node "$HERE/shots.mjs" "${2:-}"
python3 "$HERE/pdf.py"
python3 "$HERE/check_quotes.py"
