"""Blunix mark geometry. Builds clean, filleted outlines with skia-pathops."""
import math
import pathops
from pathops import Path, PathOp, LineJoin, LineCap
from fontTools.svgLib.path import parse_path
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

BG = "#12161a"
HEAD = "#8e9aa8"
HEAD_SHADE = "#6f7c8b"
GREEN = "#d2ee9a"


def from_d(d, transform=None):
    p = Path()
    pen = p.getPen()
    if transform:
        pen = TransformPen(pen, transform)
    parse_path(d, pen)
    return p


def to_d(p, prec=2):
    pen = SVGPathPen(None, ntos=lambda v: (f"{v:.{prec}f}").rstrip("0").rstrip("."))
    p.draw(pen)
    return pen.getCommands()


def op(a, b, kind):
    r = pathops.op(a, b, kind)
    r.convertConicsToQuads()
    return r


def union(*ps):
    out = ps[0]
    for q in ps[1:]:
        out = op(out, q, PathOp.UNION)
    return out


def diff(a, b):
    return op(a, b, PathOp.DIFFERENCE)


def isect(a, b):
    return op(a, b, PathOp.INTERSECTION)


def _stroked(p, r):
    s = Path()
    s.addPath(p)
    s.stroke(2 * r, LineCap.ROUND_CAP, LineJoin.ROUND_JOIN, 4)
    s.convertConicsToQuads()
    s.simplify()
    return s


def outset(p, r):
    return union(p, _stroked(p, r))


def inset(p, r):
    return diff(p, _stroked(p, r))


def round_convex(p, r):
    return outset(inset(p, r), r)


def round_concave(p, r):
    return inset(outset(p, r), r)


# ---------------------------------------------------------------- head
# 512 x 512 design space, symmetric about x = 256.
HEAD_D = (
    "M256 466 "
    "C 196 448 110 396 96 306 "
    "L 86 178 "
    "L 118 44 "
    "L 212 122 "
    "Q 256 112 300 122 "
    "L 394 44 "
    "L 426 178 "
    "L 416 306 "
    "C 402 396 316 448 256 466 Z"
)


def head_path():
    p = from_d(HEAD_D)
    p = round_convex(p, 10)   # ear tips, cheek corners, chin
    p = round_concave(p, 14)  # ear inner bases
    return p


def almond(cx, cy, w, h, angle_deg, k=1.40, kb=1.12):
    """Almond / lens: two cubic arcs meeting in points at +-w."""
    d = (f"M {-w} 0 C {-w*0.42} {-h*k} {w*0.42} {-h*k} {w} 0 "
         f"C {w*0.42} {h*kb} {-w*0.42} {h*kb} {-w} 0 Z")
    a = math.radians(angle_deg)
    t = (math.cos(a), math.sin(a), -math.sin(a), math.cos(a), cx, cy)
    return from_d(d, t)


def slit(cx, cy, w, h, angle_deg=0):
    d = (f"M 0 {-h} C {w} {-h*0.3} {w} {h*0.3} 0 {h} "
         f"C {-w} {h*0.3} {-w} {-h*0.3} 0 {-h} Z")
    a = math.radians(angle_deg)
    t = (math.cos(a), math.sin(a), -math.sin(a), math.cos(a), cx, cy)
    return from_d(d, t)


EYE_Y = 290
EYE_DX = 80
EYE_W = 44
EYE_H = 18
EYE_TILT = 8


def eyes(rim=0.0):
    l = almond(256 - EYE_DX, EYE_Y, EYE_W + rim, EYE_H + rim * 0.9, EYE_TILT)
    r = almond(256 + EYE_DX, EYE_Y, EYE_W + rim, EYE_H + rim * 0.9, -EYE_TILT)
    return union(l, r)


def pupils(w=6.5, h=None):
    h = h or EYE_H * 1.02
    return union(slit(256 - EYE_DX, EYE_Y, w, h, EYE_TILT * 0.25),
                 slit(256 + EYE_DX, EYE_Y, w, h, -EYE_TILT * 0.25))


def nose():
    return from_d("M 240 372 L 272 372 L 256 392 Z")


def half(side):
    x0, x1 = (0, 256) if side == "l" else (256, 512)
    return from_d(f"M {x0} 0 H {x1} V 512 H {x0} Z")
