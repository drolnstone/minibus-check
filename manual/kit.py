"""The page kit for the driver's manual: A5, Carlito, the running header and
foot, headings that feed the contents, and the phone pictures with their red
numbered callouts. content.py writes the manual with these.

Everything it reads is in manual/build (MANUAL_BUILD to move it): the
pictures and marks.json from shots.mjs, cast.json with the versions and the
coordinator, the fonts from fonts.py."""
import json, os, re
from PIL import Image as PILImage
from reportlab.lib.pagesizes import A5
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.fonts import addMapping
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table,
                                TableStyle, Flowable, KeepTogether, PageBreak, CondPageBreak,
                                NextPageTemplate, ListFlowable, ListItem)
from reportlab.platypus.tableofcontents import TableOfContents

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.environ.get("MANUAL_BUILD") or os.path.join(HERE, "build")
SHOTS = os.path.join(BUILD, "shots")
JPG = os.path.join(BUILD, "jpg")
os.makedirs(JPG, exist_ok=True)
MARKS = json.load(open(os.path.join(SHOTS, "marks.json")))
CAST = json.load(open(os.path.join(SHOTS, "cast.json")))

def _pretty(p):
    p = re.sub(r"\D", "", p or "")
    return p[:5] + " " + p[5:] if len(p) == 11 else p

def _names(ns):
    ns = ["**%s**" % n for n in ns]
    return ns[0] if len(ns) == 1 else ", ".join(ns[:-1]) + " and " + ns[-1]

# The coordinator and the coordinator titles, from the download by way of
# shots.mjs. The text says {COORD} and the page says his name.
FILL = {"{COORD}": CAST["coordinator"]["name"], "{PHONE}": _pretty(CAST["coordinator"]["phone"]),
        "{OTHER}": CAST["other"], "{LEADS}": _names(CAST["leads"])}

VERSION = "app %s · server %s · sheet %s" % (CAST["app"], CAST["server"], CAST["sheet"])

# ---- fonts -----------------------------------------------------------------
F = os.path.join(BUILD, "fonts")
pdfmetrics.registerFont(TTFont("Carlito", os.path.join(F, "Carlito-Regular.ttf")))
pdfmetrics.registerFont(TTFont("Carlito-Bold", os.path.join(F, "Carlito-Bold.ttf")))
pdfmetrics.registerFont(TTFont("Carlito-Italic", os.path.join(F, "Carlito-Italic.ttf")))
pdfmetrics.registerFont(TTFont("Carlito-BoldItalic", os.path.join(F, "Carlito-BoldItalic.ttf")))
addMapping("Carlito", 0, 0, "Carlito"); addMapping("Carlito", 1, 0, "Carlito-Bold")
addMapping("Carlito", 0, 1, "Carlito-Italic"); addMapping("Carlito", 1, 1, "Carlito-BoldItalic")
# For the two symbols Carlito lacks, ↗ and ⋮.
DEJAVU = next((p for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf",
                           "/Library/Fonts/DejaVuSans.ttf", os.path.join(F, "DejaVuSans.ttf")] if os.path.exists(p)), None)
if not DEJAVU: raise SystemExit("DejaVuSans.ttf not found: install fonts-dejavu, or put it in " + F)
pdfmetrics.registerFont(TTFont("DejaVu", DEJAVU))

# ---- colours ---------------------------------------------------------------
INK = colors.HexColor("#111827")      # the words the app shows
TEXT = colors.HexColor("#1f2937")
MUTED = colors.HexColor("#6b7280")
HAIR = colors.HexColor("#d1d5db")
DARK = colors.HexColor("#1f2937")     # table heads, phone frame, cover
RED = colors.HexColor("#b91c1c")
RED_BG = colors.HexColor("#fdecec")
GREEN = colors.HexColor("#166534")
GREEN_BG = colors.HexColor("#eaf6ee")
BLUE = colors.HexColor("#1e40af")
BLUE_BG = colors.HexColor("#eaf0fb")
YELLOW = colors.HexColor("#f5c518")

PAGE_W, PAGE_H = A5
ML, MR, MT, MB = 34, 34, 42, 40
TW = PAGE_W - ML - MR                 # text width

# ---- styles ----------------------------------------------------------------
BODY = ParagraphStyle("body", fontName="Carlito", fontSize=8.6, leading=11.6, textColor=TEXT, spaceAfter=5)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=7.8, leading=10.2, spaceAfter=0)
CELL = ParagraphStyle("cell", parent=BODY, fontSize=7.8, leading=10, spaceAfter=0)
CELLH = ParagraphStyle("cellh", parent=CELL, fontName="Carlito-Bold", textColor=colors.white)
CAP = ParagraphStyle("cap", parent=BODY, fontSize=7, leading=8.6, textColor=MUTED, alignment=TA_CENTER, spaceAfter=0)
H1 = ParagraphStyle("h1", parent=BODY, fontName="Carlito-Bold", fontSize=16, leading=19, textColor=INK, spaceBefore=0, spaceAfter=8, keepWithNext=1)
H2 = ParagraphStyle("h2", parent=BODY, fontName="Carlito-Bold", fontSize=11, leading=13.5, textColor=INK, spaceBefore=7, spaceAfter=4, keepWithNext=1)
H3 = ParagraphStyle("h3", parent=BODY, fontName="Carlito-Bold", fontSize=9.2, leading=11.5, textColor=INK, spaceBefore=5, spaceAfter=3, keepWithNext=1)
NOTE = ParagraphStyle("note", parent=BODY, fontSize=8.2, leading=10.6, spaceAfter=0)
MONO = ParagraphStyle("mono", parent=BODY, fontName="Courier", fontSize=7.2, leading=9, textColor=INK, spaceAfter=0)

QUOTED = []
def md(s):
    """**app words** in dark bold; the two symbols Carlito lacks from DejaVu."""
    for a, b in FILL.items(): s = s.replace(a, b)
    QUOTED.extend(re.findall(r"\*\*(.+?)\*\*", s))
    s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    s = re.sub(r"\*\*(.+?)\*\*", r'<font name="Carlito-Bold" color="#111827">\1</font>', s)
    s = re.sub(r"__(.+?)__", r"<b>\1</b>", s)
    for ch in "↗⋮✓":
        s = s.replace(ch, '<font name="DejaVu">%s</font>' % ch)
    return s

def P(s, style=BODY):
    return Paragraph(md(s), style)

# ---- the document ----------------------------------------------------------
class Doc(BaseDocTemplate):
    def __init__(self, path, **kw):
        super().__init__(path, pagesize=A5, leftMargin=ML, rightMargin=MR, topMargin=MT, bottomMargin=MB,
                         title="Minibus Driver's Manual", author="RCCG Dominion Assembly Liverpool",
                         subject="The driver app, " + VERSION, **kw)
        self.section = ""
        frame = Frame(ML, MB, TW, PAGE_H - MT - MB, id="f", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        cover = Frame(0, 0, PAGE_W, PAGE_H, id="c", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate("cover", [cover], onPageEnd=self.coverPage),
                               PageTemplate("body", [frame], onPageEnd=self.bodyPage)])

    def coverPage(self, c, doc):
        pass

    def bodyPage(self, c, doc):
        c.saveState()
        c.setFont("Carlito", 6.2); c.setFillColor(MUTED)
        c.drawString(ML, PAGE_H - 24, "MINIBUS DRIVER’S MANUAL")
        c.drawRightString(PAGE_W - MR, PAGE_H - 24, self.section.upper())
        c.setStrokeColor(HAIR); c.setLineWidth(0.4)
        c.line(ML, PAGE_H - 28, PAGE_W - MR, PAGE_H - 28)
        c.drawString(ML, 22, VERSION)
        c.setFont("Carlito-Bold", 7.5); c.setFillColor(TEXT)
        c.drawRightString(PAGE_W - MR, 22, str(doc.page))
        c.restoreState()

    def afterFlowable(self, f):
        if isinstance(f, Section):
            self.section = f.name
        if getattr(f, "toc", None):
            lvl, text, key = f.toc
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text, key, level=lvl, closed=(lvl > 0))
            self.notify("TOCEntry", (lvl, text, self.page, key))

class Section(Flowable):
    """Sets the running header's section from here on."""
    def __init__(self, name): super().__init__(); self.name = name
    def wrap(self, w, h): return (0, 0)
    def draw(self): pass

_key = [0]
def heading(text, style, lvl):
    _key[0] += 1
    p = Paragraph(md(text), style)
    p.toc = (lvl, text.replace("**", ""), "h%d" % _key[0])
    return p

# ---- pictures --------------------------------------------------------------
def jpg(name, width_px=450, crop=None):
    """The screenshot as a JPEG the size the old manual used."""
    src = os.path.join(SHOTS, name + ".png")
    out = os.path.join(JPG, name + ".jpg")
    im = PILImage.open(src).convert("RGB")
    if crop: im = im.crop(crop)
    h = round(im.height * width_px / im.width)
    if name.startswith("bar-"): width_px, h = im.width, im.height
    im.resize((width_px, h), PILImage.LANCZOS).save(out, "JPEG", quality=74, optimize=True, progressive=True)
    return out, im.width, im.height

class Phone(Flowable):
    """A screenshot in a dark phone frame, with red numbered callouts pointing
    at what the notes describe. Marks are in CSS pixels of a 390 wide screen."""
    def __init__(self, name, width=118, marks=True, frame=True):
        super().__init__()
        self.name, self.w = name, width
        self.path, pw, ph = jpg(name)
        self.h = width * ph / pw
        self.marks = [m for m in MARKS.get(name, []) if "miss" not in m] if marks else []
        self.gl = 14 if any(m.get("side", "") != "right" for m in self.marks) else 0
        self.gr = 14 if any(m.get("side", "") == "right" for m in self.marks) else 0
        self.fr = 2.2 if frame else 0
    def wrap(self, aw, ah):
        return (self.w + self.gl + self.gr + 2 * self.fr, self.h + 2 * self.fr)
    def draw(self):
        c = self.canv
        x0, y0 = self.gl + self.fr, self.fr
        if self.fr:
            c.setFillColor(DARK); c.roundRect(self.gl, 0, self.w + 2 * self.fr, self.h + 2 * self.fr, 5, stroke=0, fill=1)
        c.drawImage(self.path, x0, y0, self.w, self.h)
        s = self.w / 390.0
        for m in self.marks:
            cy = y0 + self.h - (m["y"] + m["h"] / 2) * s
            cy = max(y0 + 5, min(y0 + self.h - 5, cy))
            right = m.get("side", "") == "right"
            ex = x0 + (m["x"] + m["w"]) * s - 2 if right else x0 + m["x"] * s + 2
            ex = max(x0 + 2, min(x0 + self.w - 2, ex))
            cx = x0 + self.w + self.fr + 7 if right else self.gl - 7
            c.setStrokeColor(RED); c.setLineWidth(0.7)
            c.line(cx + (-4 if right else 4), cy, ex, cy)
            c.setFillColor(colors.white); c.circle(ex, cy, 1.1, stroke=0, fill=1)
            c.setFillColor(RED); c.circle(ex, cy, 0.8, stroke=0, fill=1)
            num(c, cx, cy, m["n"])

def num(c, cx, cy, n, r=4.6):
    c.setFillColor(RED); c.circle(cx, cy, r, stroke=0, fill=1)
    c.setFillColor(colors.white); c.setFont("Carlito-Bold", 6.4)
    c.drawCentredString(cx, cy - 2.2, str(n))

class Num(Flowable):
    def __init__(self, n): super().__init__(); self.n = n
    def wrap(self, aw, ah): return (11, 10)
    def draw(self): num(self.canv, 5, 6, self.n)

def notes(items, width):
    """Numbered notes, to sit beside a picture."""
    rows = [[Num(i + 1), P(t, NOTE)] for i, t in enumerate(items)]
    t = Table(rows, colWidths=[13, width - 13])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 3.2)]))
    return t

def note(n, t, width):
    t = Table([[Num(n), P(t, NOTE)]], colWidths=[13, width - 13])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 3.2)]))
    return t

def figure(name, caption, right=None, width=118, marks=True):
    """A picture on the left with notes or text on the right. right is a list
    of note strings (numbered to match the callouts) or of flowables."""
    ph = Phone(name, width, marks)
    pw = ph.wrap(0, 0)[0]
    col = [ph, Spacer(1, 3), P(caption, CAP)]
    rw = TW - pw - 10
    body, n = [], 0
    for r in (right or []):
        if isinstance(r, str):
            n += 1
            body.append(note(n, r, rw))
        else:
            body.append(r)
    have = len(Phone(name, width, marks).marks)
    assert n == have, "%s: %d notes for %d callouts" % (name, n, have)
    t = Table([[col, body]], colWidths=[pw + 6, rw + 4])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 0), ("LEFTPADDING", (1, 0), (1, 0), 8)]))
    t.spaceBefore, t.spaceAfter = 3, 8
    return [t]

def figures(items, width=None):
    """Two or three pictures side by side, each with its caption."""
    n = len(items)
    width = width or {1: 130, 2: 118, 3: 102}[n]
    cells = []
    for it in items:
        name, cap = it[0], it[1]
        ph = Phone(name, width, marks=(it[2] if len(it) > 2 else False))
        cells.append([ph, Spacer(1, 3), P(cap, CAP)])
    t = Table([cells], colWidths=[TW / n] * n)
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                           ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    t.spaceBefore, t.spaceAfter = 3, 8
    return [t]

class Strip(Flowable):
    """A crop of the top bar, full text width."""
    def __init__(self, name, width=TW * 0.8):
        super().__init__()
        self.path, pw, ph = jpg(name)
        self.w = width; self.h = width * ph / pw
    def wrap(self, aw, ah): return (self.w, self.h)
    def draw(self): self.canv.drawImage(self.path, 0, 0, self.w, self.h)

def strip(name, caption):
    s = Strip(name)
    t = Table([[s], [P(caption, CAP)]], colWidths=[TW])
    t.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 1),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    return [KeepTogether([t])]

# ---- text blocks -----------------------------------------------------------
def bullets(items, style=BODY):
    return [ListFlowable([ListItem(P(t, style), leftIndent=10, value="•") for t in items],
                         bulletType="bullet", start="•", leftIndent=10, bulletFontSize=7,
                         bulletOffsetY=-0.5, spaceAfter=5)]

def numbered(items, style=BODY):
    return [ListFlowable([ListItem(P(t, style), leftIndent=12) for t in items],
                         bulletType="1", leftIndent=12, bulletFontName="Carlito-Bold", bulletFontSize=8, spaceAfter=5)]

def table(head, rows, widths=None, bold_first=False):
    widths = widths or [TW / len(head)] * len(head)
    widths = [w * TW / sum(widths) for w in widths]
    data = [[Paragraph(md(h), CELLH) for h in head]]
    for r in rows:
        data.append([P(("__%s__" % c if (bold_first and i == 0 and c and "**" not in c) else c), CELL) for i, c in enumerate(r)])
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, HAIR),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3.2), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.6)]))
    t.spaceBefore, t.spaceAfter = 2, 8
    return [t]

def box(kind, text):
    lab, fg, bg = {"important": ("Important.", RED, RED_BG), "good": ("Good to know.", GREEN, GREEN_BG),
                   "coord": ("Coordinators.", BLUE, BLUE_BG)}[kind]
    p = Paragraph('<font name="Carlito-Bold" color="%s">%s</font> ' % (fg.hexval().replace("0x", "#"), lab) + md(text), NOTE)
    t = Table([[p]], colWidths=[TW])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bg), ("LINEBEFORE", (0, 0), (0, -1), 2, fg),
                           ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                           ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    t.spaceBefore, t.spaceAfter = 2, 8
    return [t]

def mono(text):
    lines = [Paragraph(md(l) if l else "&nbsp;", MONO) for l in text.split("\n")]
    t = Table([[lines]], colWidths=[TW * 0.86])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f3f4f6")),
                           ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 6),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    t.spaceAfter = 8
    return [t]

def toc():
    t = TableOfContents()
    t.levelStyles = [
        ParagraphStyle("t0", parent=BODY, fontName="Carlito-Bold", fontSize=8.6, leading=11, leftIndent=0, firstLineIndent=0, spaceBefore=3, spaceAfter=0),
        ParagraphStyle("t1", parent=BODY, fontSize=8, leading=10.2, leftIndent=10, firstLineIndent=0, spaceAfter=0)]
    t.dotsMinLevel = 0
    return t
