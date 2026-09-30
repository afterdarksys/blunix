"""Shape text with HarfBuzz and emit outlined SVG path data (y-down)."""
import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

FONTS = {
    "fraunces": "fraunces-latin.ttf",
    "fraunces-italic": "fraunces-italic.ttf",
    "atkinson": "atkinson-400.ttf",
    "atkinson-bold": "atkinson-700.ttf",
}

_cache = {}


def _font(name, wght=None):
    key = (name, wght)
    if key not in _cache:
        blob = hb.Blob.from_file_path(FONTS[name])
        face = hb.Face(blob)
        font = hb.Font(face)
        if wght is not None:
            font.set_variations({"wght": wght})
        upem = face.upem
        _cache[key] = (font, upem)
    return _cache[key]


def metrics(name):
    f = TTFont(FONTS[name])
    os2 = f["OS/2"]
    return dict(upem=f["head"].unitsPerEm, cap=os2.sCapHeight, xh=os2.sxHeight,
                asc=f["hhea"].ascent, desc=f["hhea"].descent)


def text_path(text, name, size, x=0.0, y=0.0, wght=None, tracking=0.0, features=None):
    """Return (d, advance_width, bounds) for text with baseline at (x, y).
    tracking is in em units (e.g. 0.02 = +2%)."""
    font, upem = _font(name, wght)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, features or {"kern": True, "liga": True})
    s = size / upem
    pen = SVGPathPen(None, ntos=lambda v: (f"{v:.2f}").rstrip("0").rstrip("."))
    bpen = BoundsPen(None)
    cx = 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        ox = x + (cx + pos.x_offset) * s
        oy = y - pos.y_offset * s
        t = (s, 0, 0, -s, ox, oy)
        font.draw_glyph_with_pen(info.codepoint, TransformPen(pen, t))
        font.draw_glyph_with_pen(info.codepoint, TransformPen(bpen, t))
        cx += pos.x_advance + tracking * upem
    adv = (cx - tracking * upem) * s
    return pen.getCommands(), adv, bpen.bounds
