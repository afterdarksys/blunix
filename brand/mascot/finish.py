#!/usr/bin/env python3
"""Finish a raw Recraft SVG into a Blunix illustration.

    python3 finish.py raw/hero-2.svg final/hero.svg [--keep-bg] [--crop x,y,w,h]

1. Drops the C2PA metadata block (it is most of the file size).
2. Removes the full-canvas background path, so the art sits on the page's own
   Night background with no visible box.
3. Snaps every fill and gradient stop to the Blunix illustration palette:
   green-hued colours go to the eye greens, everything else goes to the slate
   ramp by perceived lightness. This is what makes candidates from different
   runs read as one set.
4. Optionally crops the viewBox.

Stdlib only. Run svgo on the output afterwards (see optimise.sh).
"""
import colorsys
import re
import sys

# Dark to light. Night and Raise are the page surfaces; the slate tones are the
# mark's own; Ink is kept for small highlights (eye glints, paper).
RAMP = ["#12161a", "#1b2127", "#262d35", "#3a434d", "#56626f", "#6f7c8b",
        "#8e9aa8", "#a9b4c1", "#c9d0d8", "#f3efe6"]
GREENS = ["#8fae5c", "#d2ee9a"]


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lstar(c):
    def lin(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    y = 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
    return 116 * (y ** (1 / 3)) - 16 if y > 0.008856 else 903.3 * y


RAMP_L = [(lstar(rgb(h)), h) for h in RAMP]
GREEN_L = [(lstar(rgb(h)), h) for h in GREENS]


def snap(c, frac=0.0, aspect=1.0):
    """Nearest palette colour. frac is the shape's bounding-box share of the
    canvas: green is kept for small shapes (eyes, lights), and Ink only for
    glints, so big areas always stay in the slate ramp."""
    h, l, s = colorsys.rgb_to_hls(*(v / 255 for v in c))
    hue = h * 360
    L = lstar(c)
    pool = RAMP_L
    # Eyes measure 0.7-1.5 wide per tall (0.7 on a tilted head); inner ears
    # 0.5-0.65; ruled lines are far wider. Tiny dots (indicator lights) keep
    # green whatever their shape.
    eyeish = frac < GREEN_MAX and 0.7 <= aspect <= 2.0
    if 55 <= hue <= 150 and s > 0.35 and 0.3 < l < 0.9 and (eyeish or frac < 0.0005):
        pool = GREEN_L
    elif frac > INK_MAX:
        pool = RAMP_L[:-1]
    return min(pool, key=lambda p: abs(p[0] - L))[1]


GREEN_MAX = 0.02
INK_MAX = 0.002


def parse_colour(v):
    m = re.match(r"rgb\((\d+),\s*(\d+),\s*(\d+)\)", v)
    if m:
        return tuple(int(x) for x in m.groups())
    m = re.match(r"#([0-9a-fA-F]{6})$", v)
    if m:
        return rgb(v)
    return None


def bbox_frac(d, area):
    """Bounding-box share of the canvas, and width over height."""
    nums = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", d)]
    xs, ys = nums[0::2], nums[1::2]
    if not xs or not ys:
        return 0.0, 1.0
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    return w * h / area, (w / h if h else 99.0)


def replace_colours(s, area):
    def colour(v, frac, aspect=1.0):
        c = parse_colour(v)
        return snap(c, frac, aspect) if c else v

    def path(m):
        el = m.group(0)
        d = re.search(r'\sd="([^"]+)"', el)
        frac, aspect = bbox_frac(d.group(1), area) if d else (0.0, 1.0)
        return re.sub(r'fill="([^"]+)"', lambda f: 'fill="%s"' % colour(f.group(1), frac, aspect), el)

    s = re.sub(r"<path[^>]*/>", path, s)
    return re.sub(r'stop-color="([^"]+)"', lambda f: 'stop-color="%s"' % colour(f.group(1), 0.0), s)


def fit_box(s, W, H, mode, pad=0.05):
    """Tight viewBox around what is left after the background is gone.
    Every Recraft path is absolute (translate(0,0)), so the path numbers are
    the drawing's coordinates; control points can overshoot a little, which
    only adds margin. mode "square" centres the art in a square box."""
    xs, ys = [], []
    for d in re.findall(r'<path[^>]*\sd="([^"]+)"', s):
        nums = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", d)]
        xs += nums[0::2]
        ys += nums[1::2]
    x0, x1 = max(0, min(xs)), min(W, max(xs))
    y0, y1 = max(0, min(ys)), min(H, max(ys))
    w, h = x1 - x0, y1 - y0
    p = pad * max(w, h)
    x0, y0, w, h = x0 - p, y0 - p, w + 2 * p, h + 2 * p
    if mode == "square":
        side = max(w, h)
        x0 -= (side - w) / 2
        y0 -= (side - h) / 2
        w = h = side
    return "%.0f,%.0f,%.0f,%.0f" % (x0, y0, w, h)


def main():
    a = sys.argv[1:]
    src, dst = a[0], a[1]
    keep_bg = "--keep-bg" in a
    crop = None
    fit = a[a.index("--fit") + 1] if "--fit" in a else None
    if "--crop" in a:
        crop = a[a.index("--crop") + 1]
    s = open(src).read()
    s = re.sub(r"<metadata>.*?</metadata>", "", s, flags=re.S)
    s = s.replace(' xmlns:c2pa="http://c2pa.org/manifest"', "")
    vb = [float(x) for x in re.search(r'viewBox="([^"]+)"', s).group(1).split()]
    W, H = vb[2], vb[3]
    if not keep_bg:
        # The background is the first path whose outline touches all four
        # canvas corners.
        for m in re.finditer(r"<path[^>]*/>", s):
            d = re.search(r'd="([^"]+)"', m.group(0)).group(1)
            nums = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", d)]
            pts = list(zip(nums[0::2], nums[1::2]))
            corners = {(0, 0), (W, 0), (W, H), (0, H)}
            if corners <= {(round(x), round(y)) for x, y in pts}:
                s = s.replace(m.group(0), "", 1)
            break
        # Backdrop panels: big shapes that touch three or more canvas edges
        # (walls, floors, colour fields behind the cat). Recraft ignores the
        # background colour in the prompt, so these go too.
        for m in list(re.finditer(r"<path[^>]*/>", s)):
            d = re.search(r'\sd="([^"]+)"', m.group(0))
            if not d:
                continue
            nums = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", d.group(1))]
            xs, ys = nums[0::2], nums[1::2]
            if not xs:
                continue
            edges = sum([min(xs) <= 2, max(xs) >= W - 2, min(ys) <= 2, max(ys) >= H - 2])
            frac = (max(xs) - min(xs)) * (max(ys) - min(ys)) / (W * H)
            if edges >= 3 and frac > 0.04:
                s = s.replace(m.group(0), "", 1)
    s = replace_colours(s, W * H)
    s = re.sub(r'style="display: block;"\s*', "", s)
    s = re.sub(r'\s(width|height)="\d+"', "", s, count=2)
    s = s.replace('preserveAspectRatio="none"', "")
    if fit:
        crop = fit_box(s, W, H, fit)
    if crop:
        s = re.sub(r'viewBox="[^"]+"', 'viewBox="%s"' % crop.replace(",", " "), s, count=1)
    with open(dst, "w") as f:
        f.write(s)


if __name__ == "__main__":
    main()
