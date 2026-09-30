"""Carlito, the manual's typeface, fetched once into manual/build/fonts.

It is on npm as @fontsource/carlito, in web formats; this takes the Latin
files and turns them into the TrueType fonts ReportLab needs. Carlito is
under the SIL Open Font Licence. Needs npm and fontTools (pip install fonttools).

    python3 manual/fonts.py"""
import os, subprocess, sys, tarfile, tempfile
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
F = os.path.join(os.environ.get("MANUAL_BUILD") or os.path.join(HERE, "build"), "fonts")
NAMES = {("400", "normal"): "Regular", ("700", "normal"): "Bold", ("400", "italic"): "Italic", ("700", "italic"): "BoldItalic"}

if all(os.path.exists(os.path.join(F, "Carlito-%s.ttf" % n)) for n in NAMES.values()):
    print("fonts already here"); sys.exit(0)
os.makedirs(F, exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(["npm", "pack", "--silent", "@fontsource/carlito@5.3.0"], cwd=tmp, check=True)
    tgz = [f for f in os.listdir(tmp) if f.endswith(".tgz")][0]
    with tarfile.open(os.path.join(tmp, tgz)) as t:
        t.extractall(tmp)
    for (w, s), name in NAMES.items():
        f = TTFont(os.path.join(tmp, "package", "files", "carlito-latin-%s-%s.woff" % (w, s)))
        f.flavor = None
        f.save(os.path.join(F, "Carlito-%s.ttf" % name))
print("Carlito in " + F)
