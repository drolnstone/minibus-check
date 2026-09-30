"""Every phrase the manual quotes in dark bold must be words the app, the live
server or the sheet actually shows. Dynamic parts (names, buses, times, stops,
counts) are cut out and every literal piece left must be in the code.

    python3 manual/check_quotes.py      after pdf.py, which lists the quotes

A phrase the app builds from parts ("2" + " minutes behind schedule") cannot
be found whole. Those were read in the code by hand and are listed in ACCEPT
with where they are built. The run ends with how many are left unexplained,
which must be 0; a new one is either a wrong quote or a new ACCEPT line,
after reading the code."""
import json, re, os, sys, html

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
BUILD = os.environ.get("MANUAL_BUILD") or os.path.join(HERE, "build")
FILES = ["index.html", "sw.js", "server/worker.js", "Code.gs", "config.js"]

def unescape_js(s):
    s = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), s)
    s = re.sub(r"\\x([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), s)
    s = s.replace("\\'", "'").replace('\\"', '"')
    return s

corpus = ""
for f in FILES:
    t = open(os.path.join(REPO, f), encoding="utf-8").read()
    t = unescape_js(t)
    t = html.unescape(t)
    # join string literals split by + across lines: 'abc '+\n  'def'
    t = re.sub(r"""(['"])\s*\+\s*\n?\s*(['"])""", "", t)
    t = re.sub(r"<[^>]{0,200}>", " ", t)          # markup inside strings
    corpus += "\n" + t
def norm(s):
    s = s.replace("’", "'").replace("‘", "'").replace("&nbsp;", " ")
    s = re.sub(r"\s+", " ", s)
    return s.lower()
C = norm(corpus)

real = json.load(open(os.path.join(BUILD, "real.json")))
phone = re.sub(r"\D", "", real["coordinator"]["phone"])
names = [d["name"] for d in real["drivers"]] + ["Bro Sample"]
stops = sorted({s["stop"] for s in real["stops"]}, key=len, reverse=True)
DYN = [re.escape(x) for x in names + stops] + [
    r"NH56 FWP", r"YS70 PWE", re.escape(phone[:5] + " " + phone[5:]), r"North Liverpool", r"South Liverpool",
    r"\d{1,2}:\d{2}", r"\d{1,2}/\d{2}/\d{4}", r"\d{1,3}(?:,\d{3})+", r"\d+", r"\bNorth\b", r"\bSouth\b",
    r"L\d{1,2} \d[A-Z]{2}", r"↗", r"…",
    r"September|October|January|Sunday \d+", r"Harvest Sunday", r"Holiday / planned leave",
]
DYNRE = re.compile("|".join("(?:%s)" % d for d in DYN), re.I)

quoted = json.load(open(os.path.join(BUILD, "quoted.json")))
bad = []
for q in quoted:
    q2 = q.replace("·", "|")  # the manual joins title · body of notifications
    pieces = []
    for part in q2.split("|"):
        for piece in DYNRE.split(part):
            piece = piece.strip(" .,:;()/!?'’—-")
            if len(piece) >= 3 and re.search(r"[a-zA-Z]{2}", piece):
                pieces.append(piece)
    missing = [p for p in pieces if norm(p) not in C]
    if missing:
        bad.append((q, missing))
for q, m in bad:
    print("NOT FOUND:", repr(q), "->", m)
print("\n%d quoted phrases, %d with a piece not found in the code" % (len(quoted), len(bad)))

# Read in the code by hand: each is built from parts, sits in an attribute, or is
# an example a driver types. index.html line numbers are at v1.87.0.
ACCEPT = {
 "advisory note": "index.html:2738 t.adv+' advisory'+' note'", "defect noted": "index.html:2737",
 "check not sent yet": "index.html:3802", "behind schedule": "scheduleWords index.html:8670", "ahead of schedule": "scheduleWords",
 "person booked": "index.html:7283", "people booked there": "index.html:7231", "taps waiting to send": "index.html:8061",
 "authorised it. The defect stays open. You can take it out": "worker.js:5421", "Describe what you found on": "index.html:3051",
 "Every stop marked. End trip when you are back": "index.html tripHeaderHtml", "days ago": "index.html:2257",
 "is authorised to run by": "index.html:7903 with showWhoAuthorised", "Nearside rear wearing": "example note",
 "No signal right now. It will send itself": "index.html:3989+3930", "Nothing here is real": "index.html:7158-7160",
 "since you set off": "index.html:5846-5847", "yd. You are": "index.html:3298-3302", "from where the buses are kept": "index.html:3300",
 "Small chip in the screen": "example note", "Tell the coordinator what they need to know": "placeholder index.html:8153",
 "before it pauses": "index.html:9147-9149", "tries left": "index.html:4763", "You set off less than a minute ago": "index.html:5845",
 "run is due to leave church at": "worker.js:5428", "run was due at": "worker.js:5434", "Your full name": "placeholder index.html:1059",
 "dark bold": "the manual's own convention",
}
left = [(q, m) for q, m in bad if not all(any(norm(a) in norm(p) or norm(p) in norm(a) for a in ACCEPT) for p in m)]
print("unexplained after the hand-read list: %d" % len(left))
for q, m in left: print("  ", repr(q), m)
sys.exit(1 if left else 0)
