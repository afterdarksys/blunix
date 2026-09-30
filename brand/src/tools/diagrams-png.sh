#!/bin/bash
# diagrams-png.sh: render brand/diagrams/*.svg to 2x PNG next to them, and copy
# each PNG to site/assets/diagrams/ for the architecture page's links.
#   brand/src/tools/diagrams-png.sh [name ...]
# Uses Playwright's chrome-headless-shell, never the system Chrome.
set -eu
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
SHELL_BIN=${CHROME_SHELL:-$(ls -d "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-*/chrome-headless-shell 2>/dev/null | tail -n 1)}
if [ ! -x "$SHELL_BIN" ]; then
  echo "diagrams-png: chrome-headless-shell not found; set CHROME_SHELL" >&2
  exit 1
fi
T=$(mktemp -d "${TMPDIR:-/tmp}/diagrams.XXXX")
trap 'rm -rf "$T"' EXIT
if [ "$#" -eq 0 ]; then
  set -- "$ROOT"/brand/diagrams/*.svg
fi
for svg in "$@"; do
  svg=$(cd "$(dirname "$svg")" && pwd)/$(basename "$svg")
  png=${svg%.svg}.png
  read -r w h < <(python3 - "$svg" <<'PY'
import re, sys
m = re.search(r'viewBox="0 0 (\d+) (\d+)"', open(sys.argv[1], encoding="utf-8").read())
print(m.group(1), m.group(2))
PY
)
  printf '<!doctype html><html><body style="margin:0;background:#12161a"><img src="file://%s" width="%s" height="%s" style="display:block"></body></html>' "$svg" "$w" "$h" > "$T/p.html"
  timeout 60 "$SHELL_BIN" --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --screenshot="$png" --window-size="$w,$h" "file://$T/p.html" >/dev/null 2>&1
  mkdir -p "$ROOT/site/assets/diagrams"
  cp "$png" "$ROOT/site/assets/diagrams/$(basename "$png")"
  echo "diagrams-png: $(basename "$png") $((w * 2))x$((h * 2)), copied to site/assets/diagrams/"
done
