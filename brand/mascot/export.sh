#!/bin/bash
# Finish the picked raw candidates into final/, optimise them, and copy them
# into the site and portal. The picks live in picks.json:
#   { "<final name>": { "raw": "<raw file>", "crop": "x,y,w,h" (optional),
#                       "dir": "gallery" (optional), "portal": true (optional) } }
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
set -euo pipefail
D=$(cd "$(dirname "$0")"; pwd)
ROOT=$(cd "$D/../.."; pwd)
cd "$D"
mkdir -p final/gallery
python3 - <<'EOF'
import json, subprocess
picks = json.load(open("picks.json"))
for name, p in picks.items():
    if name.startswith("_"):
        continue
    sub = p.get("dir", "")
    out = f"final/{sub + '/' if sub else ''}{name}.svg"
    args = ["python3", "finish.py", "raw/" + p["raw"], out]
    if p.get("crop"):
        args += ["--crop", p["crop"]]
    if p.get("fit"):
        args += ["--fit", p["fit"]]
    subprocess.run(args, check=True)
EOF
npx --yes svgo@3 --quiet -r -f final --multipass
mkdir -p "$ROOT/site/assets/cat" "$ROOT/portal/assets/cat"
rm -f "$ROOT/site/assets/cat/"*.svg "$ROOT/portal/assets/cat/"*.svg
cp final/*.svg final/gallery/*.svg "$ROOT/site/assets/cat/"
python3 - "$ROOT" <<'EOF'
import json, shutil, sys
root = sys.argv[1]
for name, p in json.load(open("picks.json")).items():
    if not name.startswith("_") and p.get("portal"):
        shutil.copy(f"final/{name}.svg", f"{root}/portal/assets/cat/{name}.svg")
EOF
ls -l final final/gallery | awk '{print $5, $9}'
