"""Build the Blunix logo system as outlined SVG files."""
import os
import json
import geom
from geom import (head_path, eyes, pupils, isect, union, diff, half, to_d, BG, GREEN)
from outline import text_path

OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)

INK = "#f3efe6"
PAPER = "#f3efe6"
NIGHT = "#12161a"

# head tones: (lit half, shaded half)
TONES_DARK_BG = ("#8e9aa8", "#6f7c8b")
TONES_LIGHT_BG = ("#6f7c8b", "#56626f")


def set_eyes(small=False):
    if small:  # optical size for <= 48 px: larger eyes, heavier slit
        geom.EYE_W, geom.EYE_H, geom.EYE_TILT, geom.EYE_DX, geom.EYE_Y = 62, 28, 6, 88, 292
        return 12, 11
    geom.EYE_W, geom.EYE_H, geom.EYE_TILT, geom.EYE_DX, geom.EYE_Y = 44, 18, 8, 80, 290
    return 4.5, 5.5


def mark_paths(tones=TONES_DARK_BG, small=False):
    if small == "micro":  # 16 px: no pupils, big rimmed eyes
        geom.EYE_W, geom.EYE_H, geom.EYE_TILT, geom.EYE_DX, geom.EYE_Y = 70, 32, 6, 92, 292
        H = head_path()
        return (f'<path fill="{tones[0]}" d="{to_d(isect(H, half("l")))}"/>'
                f'<path fill="{tones[1]}" d="{to_d(isect(H, half("r")))}"/>'
                f'<path fill="{NIGHT}" d="{to_d(eyes(16))}"/>'
                f'<path fill="{GREEN}" d="{to_d(eyes())}"/>')
    rim, pw = set_eyes(small)
    H = head_path()
    L, R = isect(H, half("l")), isect(H, half("r"))
    E, RIM, P = eyes(), eyes(rim), pupils(pw)
    return (f'<path fill="{tones[0]}" d="{to_d(L)}"/>'
            f'<path fill="{tones[1]}" d="{to_d(R)}"/>'
            f'<path fill="{NIGHT}" d="{to_d(RIM)}"/>'
            f'<path fill="{GREEN}" d="{to_d(E)}"/>'
            f'<path fill="{NIGHT}" d="{to_d(P)}"/>')


def mono_path(small=False):
    rim, pw = set_eyes(small)
    if small:  # mono: moderate eyes so it stays a face, not a mask
        geom.EYE_W, geom.EYE_H, geom.EYE_DX = 48, 20, 82
        rim, pw = 5, 7.5
    H = head_path()
    shape = diff(H, eyes(rim))
    shape = union(shape, pupils(pw))
    return to_d(shape)


H_BOUNDS = head_path().bounds  # (xmin, ymin, xmax, ymax)
HX0, HY0, HX1, HY1 = H_BOUNDS
HW, HH = HX1 - HX0, HY1 - HY0


def svg(w, h, body, title="Blunix", vb=None, extra=""):
    vb = vb or f"0 0 {fmt(w)} {fmt(h)}"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{fmt(w)}" height="{fmt(h)}" '
            f'role="img" aria-label="{title}"{extra}>\n<title>{title}</title>\n{body}\n</svg>\n')


def fmt(v):
    return (f"{v:.2f}").rstrip("0").rstrip(".")


def mark_group(x, y, height, body):
    """Place the head so its bounds top-left is at (x, y) with given height."""
    s = height / HH
    return f'<g transform="translate({fmt(x - HX0 * s)} {fmt(y - HY0 * s)}) scale({s:.5f})">{body}</g>'


# ---------------------------------------------------------------- wordmark
WM_FONT, WM_WGHT, WM_TRACK = "fraunces", 600, -0.012
WM_SIZE = 200.0


def wordmark(size=WM_SIZE, x=0.0, y=0.0):
    return text_path("blunix", WM_FONT, size, x=x, y=y, wght=WM_WGHT, tracking=WM_TRACK)


def write(name, content):
    with open(os.path.join(OUT, name), "w") as f:
        f.write(content)


def build():
    pad = 16
    # --- mark
    for name, body in [
        ("logo-mark.svg", mark_paths(TONES_DARK_BG)),
        ("logo-mark-on-light.svg", mark_paths(TONES_LIGHT_BG)),
    ]:
        write(name, svg(HW + 2 * pad, HH + 2 * pad, body,
                        vb=f"{fmt(HX0 - pad)} {fmt(HY0 - pad)} {fmt(HW + 2 * pad)} {fmt(HH + 2 * pad)}"))
    for name, col in [("logo-mark-mono-light.svg", INK), ("logo-mark-mono-dark.svg", NIGHT)]:
        write(name, svg(HW + 2 * pad, HH + 2 * pad, f'<path fill="{col}" d="{mono_path(small=True)}"/>',
                        vb=f"{fmt(HX0 - pad)} {fmt(HY0 - pad)} {fmt(HW + 2 * pad)} {fmt(HH + 2 * pad)}"))

    # --- wordmark (tight, with small margin)
    d, adv, (bx0, by0, bx1, by1) = wordmark()
    m = 12
    for name, col in [("wordmark.svg", INK), ("wordmark-on-light.svg", NIGHT)]:
        write(name, svg(bx1 - bx0 + 2 * m, by1 - by0 + 2 * m, f'<path fill="{col}" d="{d}"/>',
                        vb=f"{fmt(bx0 - m)} {fmt(by0 - m)} {fmt(bx1 - bx0 + 2 * m)} {fmt(by1 - by0 + 2 * m)}"))

    # --- horizontal lockup. baseline at y=0. mark spans ascender top -> slightly below baseline
    asc_top = by0                      # top of 'b'/'l' ascender (negative)
    mark_h = (-asc_top) * 1.30
    mark_top = asc_top * 1.20
    gap = mark_h * 0.30
    mark_w = HW * mark_h / HH
    tx = mark_w + gap
    right = tx + bx1
    bottom = max(mark_top + mark_h, by1)
    cs = mark_h * 0.25              # clear space inside file
    W = right + 2 * cs
    Hh = bottom - mark_top + 2 * cs
    vb = f"{fmt(-cs)} {fmt(mark_top - cs)} {fmt(W)} {fmt(Hh)}"
    for name, tones, col in [("logo-horizontal.svg", TONES_DARK_BG, INK),
                             ("logo-horizontal-on-light.svg", TONES_LIGHT_BG, NIGHT)]:
        body = mark_group(0, mark_top, mark_h, mark_paths(tones)) + \
            f'<path fill="{col}" d="{d}" transform="translate({fmt(tx)} 0)"/>'
        write(name, svg(W, Hh, body, vb=vb))
    lockup_h = dict(mark_h=mark_h, mark_top=mark_top, tx=tx, right=right, bottom=bottom, W=W, H=Hh, cs=cs)

    # --- stacked lockup
    s_mark_h = (-asc_top) * 2.1
    s_gap = s_mark_h * 0.20
    s_mark_w = HW * s_mark_h / HH
    word_w = bx1 - bx0
    width = max(word_w, s_mark_w)
    cx = width / 2
    mark_x = cx - s_mark_w / 2
    word_x = cx - (bx0 + bx1) / 2
    baseline = s_mark_h + s_gap + (-asc_top)
    total_h = baseline + by1
    cs = s_mark_h * 0.2
    vb = f"{fmt(-cs)} {fmt(-cs)} {fmt(width + 2 * cs)} {fmt(total_h + 2 * cs)}"
    for name, tones, col in [("logo-stacked.svg", TONES_DARK_BG, INK),
                             ("logo-stacked-on-light.svg", TONES_LIGHT_BG, NIGHT)]:
        body = mark_group(mark_x, 0, s_mark_h, mark_paths(tones)) + \
            f'<path fill="{col}" d="{d}" transform="translate({fmt(word_x)} {fmt(baseline)})"/>'
        write(name, svg(width + 2 * cs, total_h + 2 * cs, body, vb=vb))

    # --- favicon.svg: optical small mark on a night tile

    # helpers for raster tiles (square, full-bleed and maskable)
    def tile(size_mark_frac, rx, small):
        mh = 512 * size_mark_frac
        x = (512 - HW * mh / HH) / 2
        y = (512 - mh) / 2 + mh * 0.015
        bg = f'<rect width="512" height="512" rx="{rx}" fill="{NIGHT}"/>'
        return svg(512, 512, bg + mark_group(x, y, mh, mark_paths(TONES_DARK_BG, small=small)))

    write("_tile-small.svg", tile(0.86, 96, True))
    write("favicon.svg", tile(0.86, 96, True))
    write("_tile-micro.svg", tile(0.90, 80, "micro"))       # 16/32 px
    write("_tile-rounded.svg", tile(0.66, 112, False))    # 192/512 "any"
    write("_tile-square.svg", tile(0.66, 0, False))       # apple-touch (iOS rounds it)
    write("_tile-maskable.svg", tile(0.52, 0, False))     # safe zone 80%

    # snippet files for promo templates
    json.dump(dict(
        mark=mark_paths(TONES_DARK_BG), mark_light=mark_paths(TONES_LIGHT_BG),
        mono=mono_path(), head_bounds=H_BOUNDS, wordmark_d=d,
        wordmark_bounds=[bx0, by0, bx1, by1], wordmark_size=WM_SIZE, lockup=lockup_h,
    ), open(os.path.join(OUT, "_snippets.json"), "w"))
    set_eyes(False)


if __name__ == "__main__":
    build()
    print(os.listdir(OUT))
