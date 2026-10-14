#!/bin/bash
# Apple's /bin/bash is 3.2. Re-run under bash 4 or newer when one is installed.
if [ -z "${BASH_VERSINFO:-}" ] || [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
  for candidate in /usr/local/bin/bash /opt/homebrew/bin/bash /opt/local/bin/bash; do
    if [ -x "$candidate" ] && [ "$("$candidate" -c 'echo "${BASH_VERSINFO[0]}"')" -ge 4 ] 2>/dev/null; then
      exec "$candidate" "$0" "$@"
    fi
  done
  echo "blunix: this script needs bash 4 or newer, and /bin/bash on macOS is 3.2. Install one (brew install bash) and run it again." >&2
  exit 2
fi
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
