#!/bin/bash
# render.sh in.html out.png W H
CH="${CH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CH" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=${SCALE:-1} --default-background-color=00000000 --screenshot="$2" --window-size=$3,$4 "file://$1" >/dev/null 2>&1
