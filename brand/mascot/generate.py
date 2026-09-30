#!/usr/bin/env python3
"""Generate Blunix cat illustration candidates from prompts.json.

Usage:
    python3 generate.py            # every scene in prompts.json
    python3 generate.py hero key   # only these ids

Idempotent: a candidate whose file already exists in raw/ is skipped. Delete a
file to re-roll it. Raise a scene's "n" to add more candidates.

The fal.ai key is read at run time from the FAL_KEY= line of the env file named
by $BLUNIX_FAL_ENV (default: the brooklyncats.show .env.local). It is only ever
sent as the Authorization header. It is never printed or written anywhere.
"""
import fcntl
import json
import os
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
PROMPTS = os.path.join(HERE, "prompts.json")
PROV = os.path.join(HERE, "provenance.json")
ENV_FILE = os.environ.get(
    "BLUNIX_FAL_ENV", os.path.expanduser("~/development/brooklyncats.show/.env.local"))


def read_key():
    with open(ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if line.startswith("FAL_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("generate.py: no FAL_KEY= line in the env file")


def hex_rgb(h):
    h = h.lstrip("#")
    return {"r": int(h[0:2], 16), "g": int(h[2:4], 16), "b": int(h[4:6], 16)}


def build_prompt(spec, scene):
    parts = [scene["prompt"]]
    if scene.get("cat", True):
        parts.append(spec["identity"])
    parts.append(spec["style_lock"])
    return " ".join(parts)


def call(model, body, key):
    req = urllib.request.Request(
        "https://fal.run/" + model,
        data=json.dumps(body).encode(),
        headers={"Authorization": "Key " + key, "Content-Type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def fetch(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read(), r.headers.get("Content-Type", "")


def ext_for(ctype, url):
    if "svg" in ctype or url.endswith(".svg"):
        return "svg"
    if "webp" in ctype or url.endswith(".webp"):
        return "webp"
    if "jpeg" in ctype or url.endswith(".jpg"):
        return "jpg"
    return "png"


def existing(sid, n):
    for e in ("svg", "png", "webp", "jpg"):
        p = os.path.join(RAW, f"{sid}-{n}.{e}")
        if os.path.exists(p):
            return p
    return None


def save_prov(prov):
    """Merge into provenance.json under a lock, so parallel runs don't clobber."""
    with open(PROV + ".lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        cur = json.load(open(PROV)) if os.path.exists(PROV) else {"candidates": {}}
        cur["candidates"].update(prov["candidates"])
        with open(PROV, "w") as f:
            json.dump(cur, f, indent=2, sort_keys=True)


def main():
    spec = json.load(open(PROMPTS))
    spec = spec.get("legacy_v6", spec)  # v7 moved the flat-vector prompts here
    prov = json.load(open(PROV)) if os.path.exists(PROV) else {"candidates": {}}
    want = set(sys.argv[1:])
    os.makedirs(RAW, exist_ok=True)
    key = None
    made = 0
    for sid, scene in spec["scenes"].items():
        if want and sid not in want:
            continue
        for n in range(1, scene.get("n", 3) + 1):
            if existing(sid, n):
                continue
            if key is None:
                key = read_key()
            model = scene.get("model", spec["model"])
            prompt = build_prompt(spec, scene)
            if len(prompt) > 1000:
                sys.exit(f"{sid}: prompt is {len(prompt)} chars; Recraft's limit is 1000")
            body = {"prompt": prompt,
                    "image_size": scene.get("image_size", "square_hd"),
                    "style": scene.get("style", spec["style"])}
            if model.startswith("fal-ai/recraft"):
                body["colors"] = [hex_rgb(c) for c in spec["colors"]]
            try:
                res = call(model, body, key)
                url = res["images"][0]["url"]
                data, ctype = fetch(url)
            except (urllib.error.URLError, KeyError, IndexError) as e:
                print(f"{sid}-{n}: failed ({type(e).__name__})", file=sys.stderr)
                continue
            out = os.path.join(RAW, f"{sid}-{n}.{ext_for(ctype, url)}")
            with open(out, "wb") as f:
                f.write(data)
            prov["candidates"][os.path.basename(out)] = {
                "id": sid, "n": n, "model": model, "style": body["style"],
                "image_size": body["image_size"], "seed": res.get("seed"),
                "prompt_version": spec["version"], "prompt": body["prompt"],
                "generated": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
            save_prov(prov)
            made += 1
            print(f"{os.path.basename(out)}  {len(data)} bytes")
    print(f"generated {made}")


if __name__ == "__main__":
    main()
