"""Contact sheets for looking the manual over: eight pages to a sheet, and the
pictures five to a sheet. Needs pdftoppm (poppler-utils) for the pages.

    python3 manual/preview.py pages  manual/build/minibus-driver-manual-v1.87.0.pdf
    python3 manual/preview.py shots  [name name ...]                      """
import glob, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.environ.get("MANUAL_BUILD") or os.path.join(HERE, "build")
OUT = os.path.join(BUILD, "preview"); os.makedirs(OUT, exist_ok=True)

if sys.argv[1] == "pages":
    tmp = tempfile.mkdtemp()
    subprocess.run(["pdftoppm", "-r", "60", "-png", sys.argv[2], tmp + "/p"], check=True)
    fs = sorted(glob.glob(tmp + "/p-*.png"))
    w, h = Image.open(fs[0]).size
    for k in range(0, len(fs), 8):
        sheet = Image.new("RGB", (w * 4, h * 2), "white")
        for j, f in enumerate(fs[k:k + 8]):
            sheet.paste(Image.open(f), ((j % 4) * w, (j // 4) * h))
        sheet.save(os.path.join(OUT, "pages-%02d.png" % (k // 8 + 1)))
    print("%d pages, sheets in %s" % (len(fs), OUT))
else:
    shots = os.path.join(BUILD, "shots")
    names = sys.argv[2:] or sorted(os.path.basename(f)[:-4] for f in glob.glob(shots + "/*.png"))
    for k in range(0, len(names), 5):
        ims = []
        for n in names[k:k + 5]:
            im = Image.open(os.path.join(shots, n + ".png")).convert("RGB")
            ims.append((n, im.resize((300, int(im.height * 300 / im.width)))))
        H = max(i.height for _, i in ims) + 18
        sheet = Image.new("RGB", (len(ims) * 306, H), "white"); dr = ImageDraw.Draw(sheet)
        for j, (n, im) in enumerate(ims):
            sheet.paste(im, (j * 306, 16)); dr.text((j * 306 + 2, 2), n, fill="red")
        sheet.save(os.path.join(OUT, "shots-%02d.png" % (k // 5 + 1)))
    print("%d pictures, sheets in %s" % (len(names), OUT))
