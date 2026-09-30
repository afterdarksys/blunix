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
def cells(files, cls=""):
    return "".join(
        f'<figure class="{cls}"><img src="file://{f}"><figcaption>{os.path.basename(f).rsplit(".", 1)[0]}</figcaption></figure>'
        for f in files)
order = ["hero", "held-still", "shell", "speech", "install", "key", "log", "proxy", "quiet", "lands-on-feet",
         "at-computer", "reading-docs", "debugging", "coffee-no", "braille", "cloud", "packing", "stargazing"]
story = [d + f"/final-storybook/{n}.jpg" for n in order]
three = [d + f"/final-3d/{n}.jpg" for n in ("404", "access", "social")]
spots = sorted(glob.glob(d + "/final-3d/spot-*.png")) + [d + "/final-3d/empty-basket.png"]
open(out, "w").write(f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Fraunces; src: url("file://{fonts}/fraunces-latin.woff2"); font-weight: 100 900; }}
@font-face {{ font-family: Atkinson; src: url("file://{fonts}/atkinson-400.woff2"); }}
body {{ margin: 0; padding: 56px 64px; background: #12161a; color: #c9c3b6; font: 20px Atkinson, sans-serif; width: 1600px; box-sizing: border-box; }}
h1 {{ font: 500 52px Fraunces, serif; color: #f3efe6; margin: 0 0 6px; letter-spacing: -0.02em; }}
h2 {{ font: 500 30px Fraunces, serif; color: #f3efe6; margin: 44px 0 6px; }}
h2 + p {{ margin-bottom: 18px; }}
p {{ margin: 0; }}
.g {{ display: grid; grid-template-columns: repeat(6, 1fr); gap: 24px 20px; align-items: start; }}
.g.w {{ grid-template-columns: repeat(3, 1fr); }}
.g.s {{ grid-template-columns: repeat(7, 1fr); }}
figure {{ margin: 0; }}
img {{ width: 100%; display: block; border: 1px solid #3a434d; border-radius: 12px; }}
.cut img {{ border: 0; }}
figcaption {{ margin-top: 6px; font-size: 16px; color: #a9b4c1; }}
</style></head><body>
<h1>Blubie, the Blunix cat</h1>
<p>v7 finals, shown on Night #12161a. Two looks, one cat: a Russian Blue with a short, even silver-blue coat and lime-green eyes.</p>
<h2>Storybook (main look)</h2><p>Recraft V3 digital_illustration with a created style. Site scene art and the home gallery. mascot/final-storybook/</p>
<div class="g">{cells(story)}</div>
<h2>3D (secondary look)</h2><p>FLUX.1 Kontext [pro], conditioned on the approved 3D render. 404, Access hero, social card. mascot/final-3d/</p>
<div class="g w">{cells(three)}</div>
<h2>3D spots and empty state</h2><p>Cut out on a transparent ground. Home trait list and the portal's empty hostnames state.</p>
<div class="g s">{cells(spots, "cut")}</div>
</body></html>""")
EOF
# Tall window, then trim the empty bottom.
timeout 60 "$CH" --disable-gpu --hide-scrollbars --screenshot="$T/full.png" --window-size=1600,6000 "file://$T/sheet.html" >/dev/null 2>&1
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
