#!/usr/bin/env python3
"""HOLDS THE VIDEOS' WORDS TO THE CODE.

   Every **phrase in stars** in clips.js is something the passenger page says,
   so it must be in sunday/index.html (or its manifest); in clips-driver.js it
   is something the driver app says, so it must be in index.html (or its
   manifest). Every notification (a.note) is something the live server sends,
   so its words must be in server/worker.js.

   Numbers, stop names and route names are what the code fills in, so they
   are cut out first and the pieces between them are what is looked for. A
   piece the code assembles some other way goes in ACCEPT with where it comes
   from, after reading the code. Anything else is a phrase the app no longer
   says: fix the caption.

     python3 video/check_words.py        exit 1 if anything is unexplained
"""
import json, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
# The code only, not what its comments say about it.
code = lambda f: re.sub(r"/\*.*?\*/", "", (HERE / f).read_text(encoding="utf-8"), flags=re.S)
read = lambda *fs: "".join((ROOT / f).read_text(encoding="utf-8") for f in fs)
VIDEOS = [
    ("clips.js", read("sunday/index.html", "sunday/manifest.webmanifest"), "page"),
    ("clips-driver.js", read("index.html", "manifest.webmanifest"), "driver app"),
]
SERVER = (ROOT / "server/worker.js").read_text(encoding="utf-8")
REAL = json.loads((ROOT / "tests/browser/real.json").read_text(encoding="utf-8"))
FILLED = sorted({s["stop"] for s in REAL["stops"]} | {s["route"] for s in REAL["stops"]}
                | {b["reg"] for b in REAL["buses"]}, key=len, reverse=True)

# Read by hand: the words, and where they come from.
ACCEPT = {
    "North": "a route name, from the Stops tab",
    "South": "a route name, from the Stops tab",
    "+": "the stepper's button beside How many of you?",
    "6 min": "paintLive: minutes + \" min\", the big line on Your stop",
    "Allow": "the phone's own permission question, not the page's",
    "next Sunday": "emphasis, not a quote: the page says \"Everything below is for Sunday 4 October\"",
    "Bookings close Sunday": "worker.js seatWords: \"Bookings close \" + cutoffWords(), which is \"Sunday 09:30\"",
    "Start trip ·": "index.html tripPaint: 'Start trip · ' + the bus's registration, on the button",
    "run is due to leave church at": "worker.js pushWhat, tag go: \" run is due to leave church\" + \" at \" + the Depart time",
    "Driver": "the app's name on the home screen, short_name in manifest.webmanifest",
}


def pieces(s):
    for name in FILLED:
        s = s.replace(name, "|")
    s = re.sub(r"\d[\d:.]*", "|", s)
    out = []
    for p in re.split(r"\||(?<=[.?!])\s+", s):
        p = p.strip(" ,.;:()")
        if len(p) >= 3 or p in ACCEPT:
            out.append(p)
    return out


checked, bad, used, nb, nn = 0, [], set(), 0, 0


def hold(phrase, source, where):
    global checked
    checked += 1
    if phrase in ACCEPT:
        used.add(phrase)
        return
    ps = pieces(phrase)
    if not ps:
        bad.append((where, phrase, "nothing left to look for once numbers and names are cut out"))
        return
    for p in ps:
        if p in source:
            continue
        if p in ACCEPT:
            used.add(p)
            continue
        bad.append((where, phrase, p))


for f, page, where in VIDEOS:
    clips = code(f)
    bold = re.findall(r"\*\*(.+?)\*\*", clips)
    notes = re.findall(r"\.note\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*\"([^\"]*)\",\s*\"([^\"]*)\"", clips)
    nb += len(set(bold)); nn += len(notes)
    for b in dict.fromkeys(bold):
        hold(b, page, f + ", " + where)
    for title, body in notes:
        hold(title, SERVER, f + ", notification")
        hold(body, SERVER, f + ", notification")

for where, phrase, piece in bad:
    print(f"  {where}: \"{phrase}\"" + ("" if piece == phrase else f"\n      not found: \"{piece}\""))
stale = [k for k in ACCEPT if k not in used]
if stale:
    print("  (no longer needed in ACCEPT: " + ", ".join(f'"{k}"' for k in stale) + ")")
print(f"checked {checked} phrases ({nb} on the screens, {nn} notifications); unexplained after the hand-read list: {len(bad)}")
sys.exit(1 if bad else 0)
