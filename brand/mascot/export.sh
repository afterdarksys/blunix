#!/bin/bash
# Finish the picked raw candidates into final/, optimise them, and copy them
# into the site and portal. The picks live in picks.json:
#   { "<final name>": { "raw": "<raw file>", "crop": "x,y,w,h" (optional),
#                       "dir": "gallery" (optional), "portal": true (optional) } }
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
