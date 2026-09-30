#!/bin/bash
D=$(cd "$(dirname "$0")"; pwd)
cd $D && ./venv/bin/python promo.py >/dev/null
mkdir -p $D/png
r(){ "$D/render.sh" "$D/src/$1.html" "$D/png/$2.png" $3 $4; }
r og-image og-image 1200 630
r github-social github-social 1280 640
r x-header x-header 1500 500
r linkedin-banner linkedin-banner 1584 396
r square-1080 square-1080 1080 1080
r portrait-1080x1350 portrait-1080x1350 1080 1350
r slide-1920x1080 slide-1920x1080 1920 1080
SCALE=2 r one-sheet one-sheet-preview 816 1056
