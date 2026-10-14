#!/bin/bash
# render.sh in.html out.png W H
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
CH="${CH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CH" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=${SCALE:-1} --default-background-color=00000000 --screenshot="$2" --window-size=$3,$4 "file://$1" >/dev/null 2>&1
