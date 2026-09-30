#!/usr/bin/env python3
"""Finish the v7 picks (picks-v2.json) and write the web copies.

    python3 export_v2.py

1. Writes the master finals: final-storybook/<name>.jpg and final-3d/<name>.jpg
   (full source resolution), or final-3d/<name>.png for cutouts (transparent,
   trimmed and padded to a square).
2. Writes the web copies into site/assets/cat (and portal/assets/cat for the
   portal's two): <name>-<w>.avif and .webp at 1x and 2x, plus a .jpg fallback
   (.png for transparent art). Encoding goes through ImageMagick.
3. Removes the v6 SVGs from site/assets/cat and portal/assets/cat. The v6 set
   stays archived in final/.
"""
import concurrent.futures as cf
import glob
import json
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SITE = os.path.join(ROOT, "site", "assets", "cat")
PORTAL = os.path.join(ROOT, "portal", "assets", "cat")
LEDGE = (58, 67, 77, 255)      # Line #3a434d
AVIF_Q, WEBP_Q, JPG_Q = 52, 80, 82


def square_cutout(im, ledge=False):
    box = im.getchannel("A").point(lambda a: 255 if a > 12 else 0).getbbox()
    im = im.crop(box)
    w, h = im.size
    side = int(max(w, h) * 1.08)
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    x, y = (side - w) // 2, (side - h) // 2
    if ledge:
        # A slate ledge in front of the paws, so the peek reads at 96 px.
        bar = max(8, side // 20)
        y = side - h - side // 14
        out.alpha_composite(im, (x, y))
        ImageDraw.Draw(out).rounded_rectangle(
            (side * 0.06, y + h - bar, side * 0.94, y + h + bar // 3), radius=bar // 2, fill=LEDGE)
    else:
        out.alpha_composite(im, (x, y))
    return out


def magick(src, dst, q):
    subprocess.run(["magick", src, "-strip", "-quality", str(q), dst], check=True)


def web(name, im, widths, dests):
    alpha = im.mode == "RGBA"
    with tempfile.TemporaryDirectory() as t:
        for w in widths:
            h = round(im.height * w / im.width)
            small = im.resize((w, h), Image.LANCZOS)
            tmp = os.path.join(t, f"{name}-{w}.png")
            small.save(tmp)
            base = os.path.join(t, f"{name}-{w}")
            magick(tmp, base + ".avif", AVIF_Q)
            magick(tmp, base + ".webp", WEBP_Q)
            if alpha:
                small.save(base + ".fallback.png", optimize=True)
                os.replace(base + ".fallback.png", base + ".png")
            else:
                small.convert("RGB").save(base + ".jpg", quality=JPG_Q, optimize=True, progressive=True)
            for d in dests:
                for ext in ("avif", "webp", "png" if alpha else "jpg"):
                    subprocess.run(["cp", f"{base}.{ext}", d], check=True)
    return name


def main():
    picks = {k: v for k, v in json.load(open(os.path.join(HERE, "picks-v2.json"))).items()
             if not k.startswith("_")}
    for d in (SITE, PORTAL, os.path.join(HERE, "final-storybook"), os.path.join(HERE, "final-3d")):
        os.makedirs(d, exist_ok=True)
    for f in glob.glob(os.path.join(SITE, "*")) + glob.glob(os.path.join(PORTAL, "*")):
        os.remove(f)
    jobs = []
    for name, p in picks.items():
        folder = os.path.join(HERE, "final-storybook" if p["look"] == "storybook" else "final-3d")
        if p.get("cutout"):
            im = square_cutout(Image.open(os.path.join(HERE, "raw-v2", "cutout", p["raw"])).convert("RGBA"),
                               p.get("ledge", False))
            if im.width > 1024:
                im = im.resize((1024, 1024), Image.LANCZOS)
            im.save(os.path.join(folder, name + ".png"), optimize=True)
        else:
            im = Image.open(os.path.join(HERE, "raw-v2", p["raw"])).convert("RGB")
            im.save(os.path.join(folder, name + ".jpg"), quality=92, optimize=True, progressive=True)
        dests = []
        if p.get("site", True) and p["widths"]:
            dests.append(SITE)
        if p.get("portal"):
            dests.append(PORTAL)
        if dests:
            jobs.append((name, im, p["widths"], dests))
    with cf.ThreadPoolExecutor(4) as ex:
        for n in ex.map(lambda j: web(*j), jobs):
            print("web", n, flush=True)


if __name__ == "__main__":
    main()
