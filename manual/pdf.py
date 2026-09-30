"""Builds the manual from what shots.mjs and checklist.mjs have left in
manual/build, and lists every phrase it quotes for check_quotes.py.

    python3 manual/pdf.py            -> manual/build/minibus-driver-manual-<app version>.pdf"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit
from kit import Doc, BUILD, CAST
import content

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BUILD, "minibus-driver-manual-%s.pdf" % CAST["app"])
doc = Doc(out)
doc.multiBuild(content.S)
json.dump(sorted(set(kit.QUOTED)), open(os.path.join(BUILD, "quoted.json"), "w"), indent=0, ensure_ascii=False)
print("%s: %d pages, %.1f MB" % (out, doc.page, os.path.getsize(out) / 1e6))
