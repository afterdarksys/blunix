#!/usr/bin/env python3
"""Generate Blubie candidates in the two v7 looks (storybook and 3D).

Usage:
    python3 generate_v2.py                    # every v7 scene in prompts.json
    python3 generate_v2.py hero 404           # only these scene ids
    python3 generate_v2.py --create-style a.png b.png ...
                                              # make a Recraft style from up to
                                              # 5 PNGs; prints the style_id
    python3 generate_v2.py --cutout raw-v2/x.png out.png
                                              # background removal (BiRefNet)

Looks (prompts.json -> "looks"):
  storybook  fal-ai/recraft/v3/text-to-image, digital_illustration, and the
             style_id from create-style when one is recorded.
  3d         fal-ai/flux-pro/kontext, conditioned on ref/3d-approved.png so the
             same 3D cat lands in each new scene. A scene may set
             "model": "fal-ai/flux-pro/v1.1-ultra" to fall back to text only.

Idempotent: raw-v2/<look>-<id>-<n>.png is skipped when it exists. Delete a file
to re-roll it, or raise the scene's "n".

The fal.ai key is read at run time from the FAL_KEY= line of the env file named
by $BLUNIX_FAL_ENV (default: the brooklyncats.show .env.local). It is only ever
sent as the Authorization header, never printed or written anywhere.
"""
import concurrent.futures as cf
import fcntl
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw-v2")
PROMPTS = os.path.join(HERE, "prompts.json")
PROV = os.path.join(HERE, "provenance.json")
ENV_FILE = os.environ.get(
    "BLUNIX_FAL_ENV", os.path.expanduser("~/development/brooklyncats.show/.env.local"))
_KEY = None


def key():
    global _KEY
    if _KEY is None:
        with open(ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line.startswith("FAL_KEY="):
                    _KEY = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
        if not _KEY:
            sys.exit("generate_v2.py: no FAL_KEY= line in the env file")
    return _KEY


def post(url, body, timeout=600):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Authorization": "Key " + key(), "Content-Type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def call(model, body):
    return post("https://fal.run/" + model, body)


def upload(data, content_type, name):
    """Put bytes on the fal CDN and return a URL the models can read."""
    init = post("https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
                {"content_type": content_type, "file_name": name}, timeout=60)
    req = urllib.request.Request(init["upload_url"], data=data, method="PUT",
                                 headers={"Content-Type": content_type})
    urllib.request.urlopen(req, timeout=300).read()
    return init["file_url"]


def fetch(url):
    with urllib.request.urlopen(url, timeout=180) as r:
        return r.read()


_REF_URLS = {}


def ref_url(path):
    if path not in _REF_URLS:
        with open(os.path.join(HERE, path), "rb") as f:
            _REF_URLS[path] = upload(f.read(), "image/png", os.path.basename(path))
    return _REF_URLS[path]


def save_prov(entries):
    with open(PROV + ".lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        cur = json.load(open(PROV)) if os.path.exists(PROV) else {"candidates": {}}
        cur["candidates"].update(entries)
        with open(PROV, "w") as f:
            json.dump(cur, f, indent=2, sort_keys=True)


def build(spec, sid, scene, n):
    look = spec["looks"][scene["look"]]
    cat = scene.get("cat", spec["cat"])
    prompt = look["template"].format(cat=cat, scene=scene["prompt"])
    model = scene.get("model", look["model"])
    if model.startswith("fal-ai/recraft"):
        if len(prompt) > 1000:
            sys.exit(f"{sid}: prompt is {len(prompt)} chars; Recraft's limit is 1000")
        body = {"prompt": prompt, "image_size": scene.get("image_size", look["image_size"])}
        if look.get("style_id") and not scene.get("no_style_id"):
            body["style_id"] = look["style_id"]
        else:
            body["style"] = look["style"]
    elif "kontext" in model:
        prompt = look["kontext_template"].format(cat=cat, scene=scene["prompt"])
        body = {"prompt": prompt, "image_url": ref_url(scene.get("ref", look["reference"])),
                "aspect_ratio": scene.get("aspect_ratio", look["aspect_ratio"]),
                "num_images": 1, "output_format": "png", "safety_tolerance": "2",
                "guidance_scale": look.get("guidance_scale", 3.5)}
    else:
        body = {"prompt": prompt, "aspect_ratio": scene.get("aspect_ratio", look["aspect_ratio"]),
                "num_images": 1, "output_format": "png", "safety_tolerance": "2"}
    return model, body


def one(spec, sid, scene, n):
    name = f"{scene['look']}-{sid}-{n}.png"
    out = os.path.join(RAW, name)
    model, body = build(spec, sid, scene, n)
    try:
        res = call(model, body)
        data = fetch(res["images"][0]["url"])
    except (urllib.error.URLError, KeyError, IndexError, TimeoutError) as e:
        detail = ""
        if isinstance(e, urllib.error.HTTPError):
            detail = e.read().decode(errors="replace")[:300]
        return name, None, f"failed ({type(e).__name__}) {detail}"
    with open(out, "wb") as f:
        f.write(data)
    rec = {k: v for k, v in body.items() if k != "image_url"}
    if "image_url" in body:
        rec["reference"] = scene.get("ref", spec["looks"][scene["look"]]["reference"])
    rec.update({"id": sid, "n": n, "look": scene["look"], "model": model,
                "seed": res.get("seed"), "prompt_version": spec["version"],
                "generated": time.strftime("%Y-%m-%dT%H:%M:%S%z")})
    return name, rec, f"{len(data)} bytes"


def generate(ids):
    spec = json.load(open(PROMPTS))
    os.makedirs(RAW, exist_ok=True)
    jobs = []
    for sid, scene in spec["scenes"].items():
        if ids and sid not in ids:
            continue
        for n in range(1, scene.get("n", 2) + 1):
            if not os.path.exists(os.path.join(RAW, f"{scene['look']}-{sid}-{n}.png")):
                jobs.append((sid, scene, n))
    made = 0
    with cf.ThreadPoolExecutor(6) as ex:
        futs = [ex.submit(one, spec, sid, scene, n) for sid, scene, n in jobs]
        for f in cf.as_completed(futs):
            name, rec, msg = f.result()
            print(f"{name}  {msg}", flush=True)
            if rec:
                save_prov({"raw-v2/" + name: rec})
                made += 1
    print(f"generated {made}")


def create_style(paths):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for p in paths[:5]:
            z.write(p, os.path.basename(p))
    url = upload(buf.getvalue(), "application/zip", "blubie-style.zip")
    res = call("fal-ai/recraft/v3/create-style",
               {"images_data_url": url, "base_style": "digital_illustration"})
    print(res["style_id"])


def cutout(src, dst):
    with open(src, "rb") as f:
        url = upload(f.read(), "image/png", os.path.basename(src))
    res = call("fal-ai/birefnet/v2", {"image_url": url, "model": "General Use (Heavy)",
                                      "operating_resolution": "2048x2048",
                                      "output_format": "png", "refine_foreground": True})
    with open(dst, "wb") as f:
        f.write(fetch(res["image"]["url"]))
    print(dst)


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["--create-style"]:
        create_style(a[1:])
    elif a[:1] == ["--cutout"]:
        cutout(a[1], a[2])
    else:
        generate(set(a))
