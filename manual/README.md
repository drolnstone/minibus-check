# The driver's manual

The scripts that make the Minibus Driver's Manual: photographs of the real
app, the text, and the checks that hold the text to the code. One command
turns a download of the spreadsheet into a checked PDF.

**Nothing from the spreadsheet is kept here.** The coordinator's name and
number, the stops, the buses and the rota are read from a fresh download each
time, into `manual/build/`, which git ignores. Do not commit that folder or
share what is in it: `real.json` there holds the rota and the coordinator's
number, and the pictures show them.

## What it needs

- Node 22 and Chromium with `playwright-core`, as for `tests/browser`.
- Python 3 with `pip install openpyxl reportlab pillow fonttools`.
- npm, to fetch the Carlito typeface the first time.
- DejaVu Sans (`fonts-dejavu`), for the two symbols Carlito lacks.
- `pdftoppm` (`poppler-utils`), only to preview the pages.

## Making it

1. Download the spreadsheet: File, Download, Microsoft Excel (.xlsx).
2. `manual/build.sh "Minibus checks.xlsx"`. About ten minutes, most of it
   the pictures. It ends with the quote check, which must say
   `unexplained after the hand-read list: 0`.
3. Look it over: `python3 manual/preview.py pages manual/build/minibus-driver-manual-v1.87.0.pdf`
   writes contact sheets of the pages to `manual/build/preview/`.

The PDF is `manual/build/minibus-driver-manual-<app version>.pdf`, about
5 MB, small enough to send on WhatsApp. To retake only some pictures:
`manual/build.sh "Minibus checks.xlsx" 'run*,hub'`.

## The files

| File | What it does |
|---|---|
| `build.sh` | Runs everything below, in order. |
| `export.py` | Reads the download into `build/real.json`: stops, buses and their renewal dates, drivers (name, role, route; no PINs or emails), the rota, and the coordinator from the Drivers tab. |
| `fonts.py` | Fetches Carlito once into `build/fonts/`. |
| `checklist.mjs` | The checklist as `index.html` and `config.js` build it, with the counts per bus, for Appendix A. |
| `shots.mjs` | Every picture, one scene each, on the real app with `tests/browser/lib.mjs` standing in for the live server and the sheet. Records where each red callout points. |
| `kit.py` | The page: A5, the running header and foot, headings, phone pictures with callouts, tables and boxes. |
| `content.py` | The text. `**words**` are exactly what the app shows; `{COORD}`, `{PHONE}`, `{OTHER}` and `{LEADS}` are filled in from the download. |
| `pdf.py` | Builds the PDF and lists every quoted phrase. |
| `check_quotes.py` | Holds every quoted phrase to the code of the app, the live server and the sheet. |
| `preview.py` | Contact sheets of the pages or the pictures. |

## For the next release

- **Read `content.py` against what changed**, section by section, and rewrite
  "New since the last manual" on page 2. The quote check catches wording the
  app no longer shows; it cannot catch a behaviour that changed.
- **A new screen needs a new scene** in `shots.mjs`. A picture's callouts
  and its numbered notes in `content.py` must agree in number, or the build
  stops and says which picture.
- **A new flag from `check_quotes.py`** means one of two things: the manual
  quotes words the app does not show, so fix the text; or the app builds the
  sentence from parts, so read the code and add an `ACCEPT` line saying where.
- **The pictures are staged on Sunday 27 September 2026**, the `KEY` in
  `tests/browser/lib.mjs`. `export.py` stops if the Rota tab no longer has
  that Sunday. The example names in the text (Bro Adebola on North, Bro Tunde
  on South) are that Sunday's rota.
- **The coordinator titles** are `COORDINATOR_ROLES` in the sheet's Script
  Properties, which are not in the download. `shots.mjs` assumes Coordinator,
  Minister in Charge and Assistant Coordinator; set `COORDINATOR_ROLES` in the
  environment if the sheet's list changes.

The browser checks in `tests/browser` run exactly as before. The harness
gained a few switches the manual turns on (another export, London time, the
coordinator on every answer, the versions the stand-in claims) and nothing
else changed for them.
