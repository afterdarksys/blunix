#!/bin/bash
# Render mascot-sheet.png: every final on the site background (Night #12161a).
# Uses the Playwright headless shell; set CH to use another Chromium.
set -euo pipefail
D=$(cd "$(dirname "$0")"; pwd)
CH="${CH:-$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-x64/chrome-headless-shell}"
T=$(mktemp -d "$D/.sheet.XXXX")
trap 'rm -rf "$T"' EXIT
python3 - "$D" "$T/sheet.html" <<'EOF'
import glob, os, sys
d, out = sys.argv[1], sys.argv[2]
fonts = os.path.join(d, "..", "src", "fonts")
def cells(files):
    return "".join(
        f'<figure><img src="file://{f}"><figcaption>{os.path.relpath(f, d + "/final")}</figcaption></figure>'
        for f in files)
scenes = sorted(f for f in glob.glob(d + "/final/*.svg") if "sticker-" not in f)
stickers = sorted(glob.glob(d + "/final/sticker-*.svg"))
gallery = sorted(glob.glob(d + "/final/gallery/*.svg"))
open(out, "w").write(f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Fraunces; src: url("file://{fonts}/fraunces-latin.woff2"); font-weight: 100 900; }}
@font-face {{ font-family: Atkinson; src: url("file://{fonts}/atkinson-400.woff2"); }}
body {{ margin: 0; padding: 56px 64px; background: #12161a; color: #c9c3b6; font: 20px Atkinson, sans-serif; width: 1600px; box-sizing: border-box; }}
h1 {{ font: 500 52px Fraunces, serif; color: #f3efe6; margin: 0 0 6px; letter-spacing: -0.02em; }}
h2 {{ font: 500 30px Fraunces, serif; color: #f3efe6; margin: 44px 0 16px; }}
p {{ margin: 0; }}
.g {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px 24px; }}
.g.s {{ grid-template-columns: repeat(6, 1fr); }}
figure {{ margin: 0; }} img {{ width: 100%; display: block; }}
figcaption {{ margin-top: 6px; font-size: 17px; color: #a9b4c1; }}
</style></head><body>
<h1>Blubie, the Blunix cat</h1>
<p>Finals from brand/mascot/final, shown on Night #12161a. Flat SVG, transparent ground.</p>
<h2>Scenes</h2><div class="g">{cells(scenes)}</div>
<h2>Spots</h2><div class="g s">{cells(stickers)}</div>
<h2>Blubie at work</h2><div class="g">{cells(gallery)}</div>
</body></html>""")
EOF
# Tall window, then trim the empty bottom.
timeout 60 "$CH" --disable-gpu --hide-scrollbars --screenshot="$T/full.png" --window-size=1600,4200 "file://$T/sheet.html" >/dev/null 2>&1
python3 - "$T/full.png" "$D/mascot-sheet.png" <<'EOF'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
w, h = im.size
px = im.load()
bottom = h
for y in range(h - 1, 0, -4):
    if any(px[x, y] != (18, 22, 26) for x in range(0, w, 7)):
        bottom = min(h, y + 56)
        break
im.crop((0, 0, w, bottom)).save(sys.argv[2], optimize=True)
EOF
echo "$D/mascot-sheet.png"
