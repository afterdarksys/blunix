#!/usr/bin/env python3
"""Architecture diagrams for Blunix, hand-placed SVG.

    python3 brand/src/tools/diagrams.py           # from the repo root

Writes:
  brand/diagrams/NN-name.svg      standalone, Atkinson embedded as a data: font
  site/architecture.html          the inline copies, between <!-- diagram:NAME --> markers
  site/architecture.html          the walk-throughs, between <!-- walk:NAME --> markers
  docs/architecture.md            the same walk-throughs, for GitHub readers

PNG export is brand/src/tools/diagrams-png.sh.

The inline copies carry no <style> element and no style attribute, because the
site's CSP is style-src 'self'. Everything is a presentation attribute. Text is
measured with the real Atkinson metrics, and a line that does not fit its box
stops the build, so nothing is clipped silently. Every text colour is checked
against 7:1 on every surface it sits on.
"""

from __future__ import annotations

import base64
import html
import os
import re
import sys

from fontTools.ttLib import TTFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
FONTS = os.path.join(ROOT, "brand", "src", "fonts")
OUT = os.path.join(ROOT, "brand", "diagrams")
PAGE = os.path.join(ROOT, "site", "architecture.html")
DOC = os.path.join(ROOT, "docs", "architecture.md")

# Brand tokens (brand/BRAND.md).
NIGHT = "#12161a"
RAISE = "#1b2127"
ZONE = "#161b20"
INK = "#f3efe6"
MUTED = "#c9c3b6"
SLATE_T = "#a9b4c1"
SLATE = "#8e9aa8"
SLATE_D = "#6f7c8b"
LINE = "#3a434d"
GREEN = "#d2ee9a"

FAMILY = "Atkinson, 'Atkinson Hyperlegible', 'Helvetica Neue', Arial, sans-serif"

# Every size here is at or above 15 px in the viewBox. The page never draws a
# diagram narrower than 1080 px for a 1120 px viewBox, so the smallest text is
# 15 * 1080 / 1120 = 14.5 px on screen.
T_TITLE = 26
T_BOX = 18
T_LINE = 16
T_TAG = 15
T_LABEL = 16


# ---- contrast ---------------------------------------------------------------

def _lum(hexcolor):
    h = hexcolor.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]


def contrast(a, b):
    la, lb = sorted((_lum(a), _lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


for fg in (INK, MUTED, SLATE_T, GREEN):
    for bg in (NIGHT, RAISE, ZONE):
        if contrast(fg, bg) < 7:
            sys.exit("diagrams: %s on %s is %.2f:1, under 7:1" % (fg, bg, contrast(fg, bg)))


# ---- text metrics -----------------------------------------------------------

class _Face:
    def __init__(self, path):
        font = TTFont(path)
        self.cmap = font.getBestCmap()
        self.hmtx = font["hmtx"]
        self.upm = font["head"].unitsPerEm
        self.space = self.hmtx[self.cmap[32]][0]

    def width(self, text, size, spacing=0.0):
        total = 0
        for ch in text:
            name = self.cmap.get(ord(ch))
            total += self.hmtx[name][0] if name else self.space
        return total * size / self.upm + spacing * len(text)


REGULAR = _Face(os.path.join(FONTS, "atkinson-400.woff2"))
BOLD = _Face(os.path.join(FONTS, "atkinson-700.woff2"))


def text_width(text, size, bold=False, spacing=0.0):
    return (BOLD if bold else REGULAR).width(text, size, spacing)


def esc(s):
    return html.escape(s, quote=True)


# ---- the drawing ------------------------------------------------------------

STATUS = {
    # kind: (default tag, stroke, width, dasharray)
    "deployed": ("DEPLOYED", SLATE_T, 3.5, None),
    "built": ("BUILT, NOT DEPLOYED", SLATE, 2, None),
    "designed": ("DESIGNED, NOT BUILT", SLATE, 2.5, "11 7"),
    None: (None, SLATE, 2, None),
}


class Diagram:
    def __init__(self, slug, w, h, title, desc):
        self.slug = slug
        self.w = w
        self.h = h
        self.title = title
        self.desc = desc
        self.back = []    # zones
        self.lines = []   # arrows, drawn under boxes
        self.front = []   # boxes, labels, badges
        self.badges = []
        self.errors = []

    # -- primitives

    def text(self, x, y, s, size=T_LINE, bold=False, fill=MUTED, anchor="start", spacing=0.0, layer=None):
        attrs = 'x="%.1f" y="%.1f" font-size="%d" fill="%s"' % (x, y, size, fill)
        if bold:
            attrs += ' font-weight="700"'
        if anchor != "start":
            attrs += ' text-anchor="%s"' % anchor
        if spacing:
            attrs += ' letter-spacing="%.2f"' % spacing
        (layer if layer is not None else self.front).append("<text %s>%s</text>" % (attrs, esc(s)))

    def fits(self, where, s, size, bold, room, spacing=0.0):
        w = text_width(s, size, bold, spacing)
        if w > room + 0.5:
            self.errors.append("%s: %r is %.0f px, room %.0f" % (where, s, w, room))

    # -- zones: a filled region with a tab label. Trust boundaries and domains.

    def zone(self, x, y, w, h, label, sub=None, key=False, right=False):
        self.back.append(
            '<rect x="%d" y="%d" width="%d" height="%d" rx="14" fill="%s" stroke="%s" stroke-width="2"/>'
            % (x, y, w, h, ZONE, SLATE_D))
        self.fits("zone " + label, label, T_TAG, True, w - 28, 1.2)
        if right:
            self.text(x + w - 14, y + 26, label, T_TAG, True, SLATE_T, anchor="end", spacing=1.2, layer=self.back)
        else:
            self.text(x + 14, y + 26, label, T_TAG, True, SLATE_T, spacing=1.2, layer=self.back)
        if sub:
            self.fits("zone sub " + label, sub, T_TAG, False, w - 28)
            self.text(x + 14, y + 47, sub, T_TAG, False, MUTED, layer=self.back)
        if key:
            self.key_badge(x + w - 14, y + 10, anchor="end", layer=self.back)
        return dict(x=x, y=y, w=w, h=h)

    def key_badge(self, x, y, anchor="start", label="KEY HERE", layer=None):
        layer = layer if layer is not None else self.front
        tw = text_width(label, T_TAG, True, 1.0)
        bw = tw + 26
        bx = x - bw if anchor == "end" else x
        layer.append(
            '<rect x="%.1f" y="%.1f" width="%.1f" height="26" rx="13" fill="%s" stroke="%s" stroke-width="2.5"/>'
            % (bx, y, bw, NIGHT, GREEN))
        self.text(bx + 13, y + 18.5, label, T_TAG, True, GREEN, spacing=1.0, layer=layer)
        return bw

    # -- boxes

    def box(self, x, y, w, title, lines=(), status=None, tag=None, h=None, key=False,
            gate=False, title_size=T_BOX, line_size=T_LINE, mark=False, fill=RAISE, pad=14):
        kind = status
        default_tag, stroke, sw, dash = STATUS[kind]
        tag = tag or default_tag
        titles = list(title) if isinstance(title, (list, tuple)) else [title]
        name = titles[0] if titles else (tag or "box")
        lh = round(line_size * 1.38)
        th = round(title_size * 1.3)
        content = pad + (24 if tag else 0) + th * len(titles) + lh * len(lines) + pad - 4
        if h is None:
            h = content
        elif h < content - 0.5:
            self.errors.append("box %r: height %d < content %d" % (name, h, content))
        mark_w = 44 if mark else 0
        if gate:
            c = 14
            pts = [(x + c, y), (x + w - c, y), (x + w, y + c), (x + w, y + h - c), (x + w - c, y + h),
                   (x + c, y + h), (x, y + h - c), (x, y + c)]
            shape = '<polygon points="%s" fill="%s" stroke="%s" stroke-width="%s"%s/>' % (
                " ".join("%.1f,%.1f" % p for p in pts), fill, stroke, sw,
                ' stroke-dasharray="%s"' % dash if dash else "")
        else:
            shape = '<rect x="%d" y="%d" width="%d" height="%d" rx="8" fill="%s" stroke="%s" stroke-width="%s"%s/>' % (
                x, y, w, h, fill, stroke, sw, ' stroke-dasharray="%s"' % dash if dash else "")
        self.front.append(shape)
        cy = y + pad
        inner = w - 2 * pad
        if tag:
            tx = x + pad
            if kind == "deployed":
                self.front.append('<circle cx="%.1f" cy="%.1f" r="5.5" fill="%s"/>' % (tx + 5.5, cy + 9, SLATE_T))
                tx += 17
            elif kind == "built":
                self.front.append('<rect x="%.1f" y="%.1f" width="11" height="11" fill="none" stroke="%s" stroke-width="2"/>'
                                  % (tx + 0.5, cy + 3.5, SLATE_T))
                tx += 17
            elif kind == "designed":
                self.front.append('<rect x="%.1f" y="%.1f" width="11" height="11" fill="none" stroke="%s" stroke-width="2" stroke-dasharray="3 2.5"/>'
                                  % (tx + 0.5, cy + 3.5, SLATE_T))
                tx += 17
            room = x + w - pad - tx
            if key:
                room -= self.key_badge(x + w - pad + 4, cy - 4, anchor="end") + 10
            self.fits("tag of %r" % name, tag, T_TAG, True, room, 0.8)
            self.text(tx, cy + 15, tag, T_TAG, True, SLATE_T, spacing=0.8)
            cy += 24
        if key and not tag:
            self.key_badge(x + w - pad + 4, y + pad - 4, anchor="end")
            mark_w = max(mark_w, 130)
        for t in titles:
            cy += th
            self.fits("title", t, title_size, True, inner - mark_w)
            self.text(x + pad, cy - 6, t, title_size, True, INK)
        for ln in lines:
            cy += lh
            room = inner - (mark_w if cy < y + pad + 24 + th + 44 else 0)
            self.fits("line of %r" % name, ln, line_size, False, room)
            self.text(x + pad, cy - 5, ln, line_size, False, MUTED)
        if mark:
            self.logo(x + w - pad - 34, y + pad + (24 if tag else 0) + 2, 34)
        return dict(x=x, y=y, w=w, h=h, cx=x + w / 2, cy=y + h / 2, r=x + w, b=y + h)

    def logo(self, x, y, width):
        s = width / 371.82
        self.front.append('<g transform="translate(%.1f %.1f) scale(%.4f) translate(-70.09 -35.94)">%s</g>'
                          % (x, y, s, LOGO))

    # -- arrows

    def arrow(self, pts, kind="solid", start=False, end=True, num=None, num_at=None, label=None,
              label_at=None, anchor="start", label_bg=NIGHT):
        d = "M" + " L".join("%.1f %.1f" % p for p in pts)
        m_end = ' marker-end="url(#%s-head)"' % self.slug if end else ""
        m_start = ' marker-start="url(#%s-head)"' % self.slug if start else ""
        if kind == "cipher":
            # Two rails: a wide slate stroke with a night core. Only ciphertext rides it.
            self.lines.append('<path d="%s" fill="none" stroke="%s" stroke-width="9" stroke-linejoin="round"/>' % (d, SLATE))
            self.lines.append('<path d="%s" fill="none" stroke="%s" stroke-width="3.5" stroke-linejoin="round"/>' % (d, NIGHT))
            # Heads ride on an invisible path so they sit on the rails' tip.
            self.lines.append('<path d="%s" fill="none" stroke="none" stroke-width="1"%s%s/>'
                              % (d, m_end.replace("-head", "-bighead"), m_start.replace("-head", "-bighead")))
        elif kind == "designed":
            self.lines.append('<path d="%s" fill="none" stroke="%s" stroke-width="2.5" stroke-dasharray="10 7"%s%s/>'
                              % (d, SLATE, m_end, m_start))
        else:
            self.lines.append('<path d="%s" fill="none" stroke="%s" stroke-width="2.5" stroke-linejoin="round"%s%s/>'
                              % (d, SLATE, m_end, m_start))
        if num is not None:
            if num_at is None:
                (x1, y1), (x2, y2) = pts[0], pts[1]
                num_at = ((x1 + x2) / 2, (y1 + y2) / 2)
            self.badge(num_at[0], num_at[1], num)
        if label:
            self.label(label_at, label, anchor=anchor, bg=label_bg)

    def badge(self, cx, cy, num):
        s = str(num)
        r = 14 if len(s) == 1 else 16
        self.badges.append('<circle cx="%.1f" cy="%.1f" r="%d" fill="%s" stroke="%s" stroke-width="2.5"/>' % (cx, cy, r, NIGHT, SLATE_T))
        self.badges.append('<text x="%.1f" y="%.1f" font-size="16" font-weight="700" fill="%s" text-anchor="middle">%s</text>'
                           % (cx, cy + 5.5, INK, s))

    def label(self, at, lines, anchor="start", bg=NIGHT, size=T_LABEL, fill=MUTED, bold_first=False):
        lines = lines if isinstance(lines, (list, tuple)) else [lines]
        x, y = at
        lh = round(size * 1.35)
        widths = [text_width(l, size, bold_first and i == 0) for i, l in enumerate(lines)]
        w = max(widths) + 12
        h = lh * (len(lines) - 1) + size + 9
        bx = x - 6 if anchor == "start" else (x - w + 6 if anchor == "end" else x - w / 2)
        if bg:
            self.front.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="4" fill="%s"/>'
                              % (bx, y - size - 3, w, h, bg))
        for i, l in enumerate(lines):
            self.text(x, y + i * lh, l, size, bold_first and i == 0, INK if (bold_first and i == 0) else fill, anchor=anchor)

    # -- output

    def svg(self, standalone):
        tid = "%s-title" % self.slug
        did = "%s-desc" % self.slug
        head = []
        attrs = ('xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" role="img" '
                 'aria-labelledby="%s %s" font-family="%s"' % (self.w, self.h, self.w, self.h, tid, did, esc(FAMILY)))
        head.append("<svg %s>" % attrs)
        head.append('<title id="%s">%s</title>' % (tid, esc(self.title)))
        head.append('<desc id="%s">%s</desc>' % (did, esc(self.desc)))
        if standalone:
            head.append("<style>%s</style>" % FONT_FACE)
        head.append(
            '<defs><marker id="%s-head" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="15" markerHeight="15" '
            'markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0 L12 6 L0 12 Z" fill="%s"/></marker></defs>'
            % (self.slug, SLATE))
        head.append(
            '<defs><marker id="%s-bighead" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="22" markerHeight="22" '
            'markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0 L12 6 L0 12 Z" fill="%s"/></marker></defs>'
            % (self.slug, SLATE))
        head.append('<rect width="%d" height="%d" fill="%s"/>' % (self.w, self.h, NIGHT))
        body = self.back + self.lines + self.front + self.badges
        return "\n".join(head + body + ["</svg>"]) + "\n"


def _font_face():
    out = []
    for weight, name in ((400, "atkinson-400.woff2"), (700, "atkinson-700.woff2")):
        with open(os.path.join(FONTS, name), "rb") as fh:
            data = base64.b64encode(fh.read()).decode("ascii")
        out.append("@font-face{font-family:Atkinson;font-weight:%d;src:url(data:font/woff2;base64,%s) format('woff2')}"
                   % (weight, data))
    return "".join(out)


FONT_FACE = _font_face()


def _logo():
    with open(os.path.join(ROOT, "brand", "logo-mark.svg"), encoding="utf-8") as fh:
        text = fh.read()
    return "".join(re.findall(r"<path [^>]*/>", text))


LOGO = _logo()


def legend(d, x, y, w, extra=True, key=True, gate=False, cipher=True, states=True, designed=True, gate_words="Gate: the build stops, fails closed"):
    """The honest legend: shape and line style, never colour alone."""
    d.front.append('<rect x="%d" y="%d" width="%d" height="%d" rx="10" fill="%s" stroke="%s" stroke-width="2"/>'
                   % (x, y, w, 96 if (extra and states) else 52, RAISE, LINE))
    d.text(x + 16, y + 27, "LEGEND", T_TAG, True, SLATE_T, spacing=1.2)
    cx = x + 110
    items = [("deployed", "Deployed, live today"), ("built", "Built and tested in the repo"),
             ("designed", "Designed, not built")] if states else []
    for kind, words in items:
        _, stroke, sw, dash = STATUS[kind]
        d.front.append('<rect x="%d" y="%d" width="40" height="24" rx="5" fill="%s" stroke="%s" stroke-width="%s"%s/>'
                       % (cx, y + 10, RAISE, stroke, sw, ' stroke-dasharray="7 5"' if dash else ""))
        d.text(cx + 52, y + 28, words, T_LABEL, False, INK)
        cx += 52 + text_width(words, T_LABEL) + 34
    if not extra:
        return
    y2 = y + 52 if states else y + 12
    cx = x + 110
    # line styles
    d.front.append('<path d="M%d %d L%d %d" stroke="%s" stroke-width="2.5"/>' % (cx, y2 + 12, cx + 44, y2 + 12, SLATE))
    d.text(cx + 54, y2 + 18, "Call or data", T_LABEL, False, INK)
    cx += 54 + text_width("Call or data", T_LABEL) + 30
    if cipher:
        d.front.append('<path d="M%d %d L%d %d" stroke="%s" stroke-width="9"/>' % (cx, y2 + 12, cx + 44, y2 + 12, SLATE))
        d.front.append('<path d="M%d %d L%d %d" stroke="%s" stroke-width="3.5"/>' % (cx - 1, y2 + 12, cx + 45, y2 + 12, RAISE))
        d.text(cx + 54, y2 + 18, "Ciphertext only", T_LABEL, False, INK)
        cx += 54 + text_width("Ciphertext only", T_LABEL) + 30
    if designed:
        d.front.append('<path d="M%d %d L%d %d" stroke="%s" stroke-width="2.5" stroke-dasharray="10 7"/>'
                       % (cx, y2 + 12, cx + 44, y2 + 12, SLATE))
        d.text(cx + 54, y2 + 18, "Designed path", T_LABEL, False, INK)
        cx += 54 + text_width("Designed path", T_LABEL) + 30
    end = cx
    if gate:
        c = 7
        pts = [(cx + c, y2), (cx + 44 - c, y2), (cx + 44, y2 + c), (cx + 44, y2 + 24 - c), (cx + 44 - c, y2 + 24),
               (cx + c, y2 + 24), (cx, y2 + 24 - c), (cx, y2 + c)]
        d.front.append('<polygon points="%s" fill="%s" stroke="%s" stroke-width="2"/>'
                       % (" ".join("%.1f,%.1f" % q for q in pts), RAISE, SLATE))
        words = gate_words
        d.text(cx + 54, y2 + 18, words, T_LABEL, False, INK)
        cx += 54 + text_width(words, T_LABEL) + 30
        end = cx
    if key:
        bw = d.key_badge(cx, y2 - 1)
        d.text(cx + bw + 10, y2 + 18, "The key exists here", T_LABEL, False, INK)
        end = cx + bw + 10 + text_width("The key exists here", T_LABEL)
    if end > x + w - 10:
        d.errors.append("legend overflows by %.0f" % (end - x - w + 10))


# ---- 1. Ecosystem overview --------------------------------------------------

def d1():
    d = Diagram(
        "eco", 1120, 1200,
        "Blunix ecosystem: who talks to whom",
        "Zones for the operator's browser, After Dark Systems SSO at adsas.id, Cloudflare, GitHub, the release "
        "build server, the offline signing key, the customer LAN and the machine at the console, joined by 16 "
        "numbered connections. The website, portal, API, build hosts, sign-in, GitHub repo and release build "
        "server run today; the installer and proxy are built and tested; the release signing key is set up, and "
        "no signed release exists yet. The numbered walk-through after this figure says everything the diagram "
        "shows.")
    d.text(28, 44, "Blunix ecosystem: who talks to whom", T_TITLE, True, INK)
    d.text(28, 72, "As it stands on 2026-10-03. Numbers match the walk-through.", T_LINE, False, MUTED)

    # Left column
    d.zone(20, 100, 300, 240, "OPERATOR'S DEVICE")
    browser = d.box(36, 150, 268, "Operator's browser", [
        "Runs the portal's JavaScript.",
        "Composes the node document,",
        "makes the key, encrypts with",
        "age. Sends only ciphertext.",
    ], status="deployed", tag="LIVE", key=True)
    d.zone(20, 380, 300, 200, "ADSAS.ID")
    authentik = d.box(36, 425, 268, "After Dark Systems SSO", [
        "Signs the operator in.",
        "OpenID Connect with PKCE.",
        "The Blunix client is live.",
    ], status="deployed", tag="RUNS TODAY")

    # Cloudflare
    d.zone(340, 100, 430, 720, "CLOUDFLARE", "Holds records and ciphertext. Never a key.")
    site = d.box(356, 160, 398, "blunix.io website (Pages)", [
        "Function /releases.json reads GitHub.",
        "Its page asks api.blunix.io/v1/health.",
    ], status="deployed")
    portal = d.box(356, 290, 398, "build.blunix.io portal (Pages)", [
        "A separate Pages project. Same-site",
        "with the API, so the cookie rides fetch.",
    ], status="deployed")
    worker = d.box(356, 420, 398, "api.blunix.io Worker (/v1)", [
        "Sign-in, labels, builds, API keys.",
        "Checks the age header. Never decrypts.",
    ], status="deployed")
    d1b = d.box(356, 570, 193, "D1 records", [
        "accounts, labels,",
        "versions, hashed",
        "sessions and keys,",
        "audit rows",
    ], status=None)
    r2 = d.box(561, 570, 193, "R2 ciphertext", [
        "builds/{id}/{n}:",
        "the age binary,",
        "sha256 checked",
        "before serving",
    ], status=None)
    blnx = d.box(356, 716, 398, "{label}.blnx.io (the same Worker)", [
        "GET / only. A separate registrable domain.",
    ], status="deployed", tag="DEPLOYED: LATEST VERSION ONLY")

    # Right column
    d.zone(790, 100, 290, 330, "GITHUB")
    repo = d.box(806, 150, 258, "afterdarksys/blunix", [
        "Actions job in the",
        "production environment",
        "deploys site/ and portal/.",
    ], status="deployed", tag="REPO IS LIVE")
    releases = d.box(806, 300, 258, "Releases", [
        "ISO, blunix.raw.zst, netboot",
        "media, SHA256SUMS.",
    ], status="built", tag="v0.1.0: UNSIGNED TEST")
    d.zone(790, 470, 290, 175, "BUILD SERVER")
    builder = d.box(806, 512, 258, "Release builder", [
        "Signed tags only. No keys.",
        "Unsigned images to staging.",
    ], status="deployed", tag="RUNS TODAY")
    d.zone(790, 685, 290, 175, "OFFLINE")
    signer = d.box(806, 727, 258, "Release signing key", [
        "Held by the maintainer.",
        "No signed release yet.",
    ], status="built", tag="SET UP, NOT USED YET")

    # Bottom row
    d.zone(20, 880, 520, 205, "CUSTOMER LAN")
    proxy = d.box(36, 925, 488, "blunix proxy (operator's Linux or Mac)", [
        "publish: encrypts per machine, uploads ciphertext.",
        "serve: relays *.blnx.io, netboot media, boot.ipxe.",
        "keys.txt (mode 0600) stays on this computer.",
    ], status="built", tag="BUILT AND TESTED", key=True)
    d.zone(560, 880, 520, 205, "THE MACHINE AT THE CONSOLE", right=True)
    machine = d.box(576, 925, 488, "Installer, or first-boot bootstrap", [
        "Installer: ISO, USB or netboot. Bootstrap: raw",
        "image. Asks the hostname, then the key, echo",
        "off. Fetches, decrypts on the machine, applies.",
    ], status="built", tag="BUILT, BOOTS IN A VM", key=True)

    # 1 browser -> portal (page load)
    d.arrow([(browser["r"], 300), (portal["x"], 300)], num=1, num_at=(330, 300))
    # 2 browser -> worker: session calls; the upload is ciphertext
    d.arrow([(284, browser["b"]), (284, 362), (330, 362), (330, 452), (worker["x"], 452)],
            kind="cipher", num=2, num_at=(330, 405))
    # 3 browser <-> authentik: sign-in redirect
    d.arrow([(190, browser["b"]), (190, authentik["y"])], start=True, num=3, num_at=(190, 380))
    # 4 worker <-> authentik: code exchange, JWKS
    d.arrow([(worker["x"], 495), (authentik["r"], 495)], start=True, num=4, num_at=(330, 495))
    # 5 worker -> D1, R2
    d.arrow([(452, worker["b"]), (452, d1b["y"])], num=5, num_at=(555, 540))
    d.arrow([(657, worker["b"]), (657, r2["y"])])
    # 6 D1, R2 -> blnx
    d.arrow([(452, d1b["b"]), (452, blnx["y"])])
    d.arrow([(657, r2["b"]), (657, blnx["y"])], num=6, num_at=(555, 700))
    # 7 blnx -> machine (direct TLS)
    d.arrow([(700, blnx["b"]), (700, machine["y"])], kind="cipher", num=7, num_at=(700, 850))
    # 8 blnx -> proxy (relay fetch, TLS)
    d.arrow([(440, blnx["b"]), (440, proxy["y"])], kind="cipher", num=8, num_at=(440, 850))
    # 9 proxy -> machine (LAN http)
    d.arrow([(proxy["r"], 1040), (machine["x"], 1040)], kind="cipher", num=9, num_at=(550, 1040))
    # 10 proxy -> worker: publish with a blx_ key
    d.arrow([(250, proxy["y"]), (250, 860), (330, 860), (330, 530), (worker["x"], 530)], kind="cipher",
            num=10, num_at=(330, 700))
    # 11 site -> releases API
    d.arrow([(site["r"], 235), (780, 235), (780, 360), (releases["x"], 360)], num=11, num_at=(780, 300))
    # 12 actions -> site (and the portal, same job)
    d.arrow([(repo["x"], 190), (site["r"], 190)], num=12, num_at=(780, 190))
    # 13 GitHub -> builder: the build server polls for signed tags (pull-only)
    d.arrow([(1000, releases["b"]), (1000, builder["y"])], num=13, num_at=(1000, 450))
    # 14 machine -> releases: image by release pin, sha256 must match
    d.arrow([(machine["r"], 1000), (1100, 1000), (1100, 360), (releases["r"], 360)], num=14, num_at=(1100, 680))
    # 15 builder -> maintainer: unsigned images through the staging bucket, signed offline
    d.arrow([(1000, builder["b"]), (1000, signer["y"])], num=15, num_at=(1000, 665))
    # 16 maintainer -> releases: publishes the signed release
    d.arrow([(signer["r"], 790), (1086, 790), (1086, 395), (releases["r"], 395)], num=16, num_at=(1086, 560))
    legend(d, 20, 1090, 1080, designed=False)
    return d


# ---- 2. Web bootstrapping sequence ------------------------------------------

class Seq:
    def __init__(self, d, cols, top):
        self.d = d
        self.cols = cols
        self.y = top
        self.n = 0
        self.bands = {}

    def step(self):
        self.n += 1
        return self.n

    def msg(self, a, b, lines, kind="solid", room=None):
        d = self.d
        lines = lines if isinstance(lines, list) else [lines]
        xa, xb = self.cols[a], self.cols[b]
        lo, hi = min(xa, xb), max(xa, xb)
        lh = 21
        self.y += 8 + lh * len(lines)
        ay = self.y
        room = room or (hi - lo - 62)
        for i, l in enumerate(lines):
            d.fits("seq label", l, T_LABEL, False, room)
        d.label((lo + 54, ay - 10 - lh * (len(lines) - 1)), lines, bg=NIGHT)
        d.arrow([(xa, ay), (xb, ay)], kind=kind)
        n = self.step()
        d.badge(lo + 32, ay, n)
        self.y += 12
        return n

    def note(self, x, w, lines, key=False):
        d = self.d
        lines = lines if isinstance(lines, list) else [lines]
        lh = 21
        h = 16 + lh * len(lines) + 4
        self.y += 10
        y = self.y
        d.front.append('<rect x="%d" y="%d" width="%d" height="%d" rx="6" fill="%s" stroke="%s" stroke-width="%s"/>'
                       % (x, y, w, h, RAISE, GREEN if key else SLATE, 2.5 if key else 2))
        for i, l in enumerate(lines):
            d.fits("note", l, T_LABEL, False, w - 52)
            d.text(x + 38, y + 26 + i * lh, l, T_LABEL, False, INK if key else MUTED)
        n = self.step()
        d.badge(x, y + h / 2, n)
        self.y += h + 2
        return n

    def section(self, text):
        self.y += 58
        tw = text_width(text, T_TAG, True, 1.2)
        self.d.front.append('<rect x="20" y="%d" width="%.1f" height="26" fill="%s"/>' % (self.y - 19, tw + 16, NIGHT))
        self.d.text(28, self.y, text, T_TAG, True, SLATE_T, spacing=1.2)
        self.d.front.append('<path d="M%d %d L%d %d" stroke="%s" stroke-width="2"/>'
                            % (28 + text_width(text, T_TAG, True, 1.2) + 16, self.y - 5, self.d.w - 28, self.y - 5, LINE))
        self.y += 4

    def band(self, col, y0, y1, label):
        x = self.cols[col]
        self.d.lines.append('<rect x="%.1f" y="%.1f" width="10" height="%.1f" rx="3" fill="%s"/>'
                            % (x - 5, y0, y1 - y0, GREEN))


def d2():
    d = Diagram(
        "seq", 1120, 1700,
        "Web bootstrapping: from sign-in to an applied node document",
        "A sequence diagram across six participants: the operator, the browser running the portal, After Dark "
        "Systems SSO at adsas.id, the api.blunix.io Worker, the {label}.blnx.io build host, and the machine at the console. "
        "A green bar marks where the key exists: the browser from the moment it is made until the install card "
        "closes, the operator's install card, and the machine from typing until decryption. The server side "
        "never holds it. The numbered walk-through after this figure lists every step.")
    d.text(28, 44, "Web bootstrapping: sign-in to an applied document", T_TITLE, True, INK)
    d.text(28, 72, "Green bars: where the key exists. It never exists on a server. Double lines carry only ciphertext.", T_LINE, False, MUTED)
    cols = {"op": 90, "br": 270, "au": 450, "api": 630, "bh": 815, "m": 1025}
    heads = {
        "op": ("Operator", "a person"),
        "br": ("Browser", "portal JS"),
        "au": ("After Dark SSO", "adsas.id"),
        "api": ("api.blunix.io", "Worker, D1, R2"),
        "bh": ("{label}.blnx.io", "same Worker"),
        "m": ("Machine", "at the console"),
    }
    top = 100
    for k, x in cols.items():
        w = 164
        d.front.append('<rect x="%d" y="%d" width="%d" height="64" rx="8" fill="%s" stroke="%s" stroke-width="2"/>'
                       % (x - w / 2, top, w, RAISE, SLATE))
        d.fits("head", heads[k][0], T_BOX - 1, True, w - 16)
        d.text(x, top + 27, heads[k][0], T_BOX - 1, True, INK, anchor="middle")
        d.text(x, top + 50, heads[k][1], T_LINE, False, MUTED, anchor="middle")
    s = Seq(d, cols, top + 64)

    s.section("IN THE BROWSER, AT BUILD.BLUNIX.IO")
    s.msg("op", "br", "Sign in", room=120)
    s.msg("br", "api", ["GET /v1/auth/login. Stores state, nonce", "and PKCE verifier for 10 minutes."])
    s.msg("api", "br", "302 to the SSO, code_challenge S256")
    s.msg("br", "au", "Sign in at adsas.id", room=200)
    s.msg("au", "br", ["302 to /v1/auth/callback", "with code and state"], room=200)
    s.msg("br", "api", "GET /v1/auth/callback")
    s.msg("api", "au", ["Code and verifier for", "the ID token; JWKS"], room=320)
    s.note(480, 330, ["Check the ID token: RS256, ES256", "or EdDSA; iss, aud, exp, nonce.", "Upsert the account by (iss, sub)."])
    s.msg("api", "br", ["Cookie __Host-blx_session, 12 h,", "HttpOnly; 302 to build.blunix.io"])
    s.msg("op", "br", "Form", room=120)
    s.msg("br", "api", ["POST /v1/hosts {label}, with", "x-blunix-csrf: 1 and the portal Origin"])
    s.msg("api", "br", ["201. Or 409 taken, 400 invalid", "or reserved, 429 rate limited."])
    s.note(300, 320, ["Compose the node document", "and check every field."])
    y_key0 = s.y + 14
    s.note(300, 320, ["Make the key: 100 bits from", "crypto.getRandomValues, 20", "Crockford base32 characters."], key=True)
    s.note(300, 320, ["Encrypt with age, scrypt", "passphrase mode."])
    s.msg("br", "api", ["POST /v1/hosts/{label}/builds:", "ciphertext only, up to 256 KiB"], kind="cipher")
    s.note(480, 330, ["Refuse all but one scrypt stanza.", "Body to R2; version, sha256 and", "an audit row to D1."])
    s.msg("api", "br", ["201 {version, sha256, size, url,", "pinnedUrl or null}"])
    s.note(300, 320, ["The sha256 must match what", "this browser sent, or no card."])
    y_op0 = s.y + 14
    s.msg("br", "op", ["Card"], room=120)
    s.note(300, 320, ["Install card, shown once: URL, key,", "sha256. Download .txt and .json.", "Closing it wipes the key."], key=True)
    y_key1 = s.y - 2
    y_op = s.y - 2

    s.section("AT THE MACHINE: INSTALLER OR FIRST-BOOT BOOTSTRAP")
    s.note(660, 330, ["The operator types the hostname:", "ada becomes ada.blnx.io. It is", "read back; the operator says yes."])
    y_m0 = s.y + 14
    s.note(660, 330, ["The operator types the key from", "the card. Echo off. Never spoken."], key=True)
    s.msg("m", "bh", ["GET https://", "ada.blnx.io/,", "verified TLS 1.2+"], kind="cipher")
    s.note(580, 340, ["Latest version from D1 and R2.", "The body's sha256 is checked", "before it leaves."])
    s.msg("bh", "m", ["200, the", "ciphertext and", "x-blunix-sha256"], kind="cipher")
    s.note(660, 330, ["Decrypt on the machine. Then", "check the schema. A wrong key", "or a refusal applies nothing."], key=True)
    y_m1 = s.y - 6
    s.note(660, 330, ["Apply. The installer writes the disk", "first; the bootstrap applies the", "document to the running disk."])

    s.band("br", y_key0, y_key1, "")
    s.band("op", y_op0, y_op, "")
    s.band("m", y_m0, y_m1, "")
    d.key_badge(cols["op"] + 14, y_op - 30)
    # The server lanes carry the key's absence as words.
    ny = s.y + 30
    d.front.append('<rect x="%d" y="%d" width="%d" height="60" rx="8" fill="%s" stroke="%s" stroke-width="2"/>'
                   % (cols["au"] - 60, ny, cols["bh"] - cols["au"] + 120, NIGHT, SLATE))
    d.text((cols["au"] + cols["bh"]) / 2, ny + 25, "No key on this side: not sent, stored or logged.", T_LABEL, True, INK, anchor="middle")
    d.text((cols["au"] + cols["bh"]) / 2, ny + 47, "The Worker holds only ciphertext and its sha256.", T_LABEL, False, MUTED, anchor="middle")
    d.h = int(ny + 60 + 30)
    for x in cols.values():
        d.back.append('<path d="M%d %d L%d %d" stroke="%s" stroke-width="2"/>' % (x, top + 64, x, ny - 10, LINE))
    return d


# ---- 3. Build and release pipeline ------------------------------------------

def chain(d, x, y, w, items, gap=34):
    """Stack boxes top to bottom with an arrow between each. Returns the boxes."""
    out = []
    for it in items:
        it = dict(it)
        title = it.pop("title")
        lines = it.pop("lines", [])
        b = d.box(x, y, w, title, lines, **it)
        if out:
            d.arrow([(x + w / 2, out[-1]["b"]), (x + w / 2, b["y"])])
        out.append(b)
        y = b["b"] + gap
    return out


GATE = dict(gate=True, tag="GATE: STOPS THE BUILD")


def d3():
    d = Diagram(
        "pipe", 1120, 2000,
        "Build and release pipeline",
        "The release build server builds only tags signed by the pinned release key. Two build scripts run in a "
        "privileged container pinned by digest. build-test-disk.sh --release turns Debian 13 packages into "
        "build/blunix-release.raw through mmdebstrap, a strip step, a GPT disk, a root scan, zerofree and a raw "
        "byte scan. build-installer.sh --release scans that disk again, compresses it, pins its digest, and makes "
        "the ISO, netboot media and SHA256SUMS. Seven gates stop the build. The build server uploads the unsigned "
        "assets to a staging bucket that expires after 30 days. The maintainer verifies them, signs SHA256SUMS "
        "offline and publishes the GitHub release. Below, the site and portal deploy through the GitHub Actions "
        "production environment to Cloudflare Pages, and the API deploys from a laptop script. All of these are "
        "live. The numbered walk-through after this figure says everything the diagram shows.")
    d.text(28, 44, "Build and release pipeline", T_TITLE, True, INK)
    d.text(28, 72, "Octagons are gates: the build stops there and writes no release.", T_LINE, False, MUTED)

    a = chain(d, 36, 170, 488, [
        dict(title="1. Debian 13 packages", lines=["Official packages, listed in image/packages.txt."], status="built", tag="BUILT"),
        dict(title="2. mmdebstrap root filesystem", lines=["amd64, variant apt, cached by a stamp."], status="built", tag="BUILT"),
        dict(title="3. Strip host keys and secrets", lines=[
            "SSH host keys, random-seed, credential.secret;",
            "machine-id emptied. A host key left: stop."], **GATE),
        dict(title="4. GPT disk: ESP and ext4 blunix-root", lines=[
            "Copy root, overlay and tools; grub-install.",
            "Release: root locked, fixture removed."], status="built", tag="BUILT"),
        dict(title="5. scan-root.py --release", lines=[
            "Refuses test secrets, the fixture, an unlocked",
            "account, root or password SSH, a shipped host",
            "key, and vendor binaries."], **GATE),
        dict(title="6. zerofree", lines=["Zeroes the free blocks of blunix-root."], status="built", tag="BUILT"),
        dict(title="7. scan-raw.py over every byte", lines=[
            "Private keys, age secret keys, the fixture's",
            "age header, the two test secrets."], **GATE),
        dict(title="8. build/blunix-release.raw", lines=["The release disk."], status="built", tag="BUILT"),
    ])
    b = chain(d, 596, 170, 488, [
        dict(title="9. Version and disk present", lines=[
            "No version, the word latest, or no release",
            "disk: stop."], **GATE),
        dict(title="10. Scan the release disk again", lines=[
            "Mounted read-only: scan-root.py --release.",
            "Then scan-raw.py over the raw file."], **GATE),
        dict(title="11. zstd, then scan-raw.py on it", lines=[
            "blunix.raw.zst. Its decompressed stream",
            "is scanned byte by byte."], **GATE),
        dict(title="12. Digest and release pin", lines=[
            "blunix.raw.zst.sha256, and blunix.release",
            "(version, sha256, size) in the live root."], status="built", tag="BUILT"),
        dict(title="13. scan-root.py on the live root", lines=[
            "The installer's own filesystem."], **GATE),
        dict(title="14. ISO and netboot media", lines=[
            "squashfs; boot menu keys 1 to 5; hybrid ISO,",
            "volume BLUNIX_INSTALL; vmlinuz, initrd.img,",
            "blunix.squashfs, blunix.ipxe."], status="built", tag="BUILT"),
        dict(title="15. Every asset under 2 GiB", lines=["GitHub's per-file limit."], **GATE),
        dict(title="16. SHA256SUMS, build/release/", lines=[
            "ISO, blunix.raw.zst, vmlinuz, initrd.img,",
            "blunix.squashfs. Plus SOURCES.md."], status="built", tag="BUILT"),
    ])
    d.arrow([(a[-1]["r"], a[-1]["cy"]), (560, a[-1]["cy"]), (560, b[0]["cy"]), (b[0]["x"], b[0]["cy"])])
    zb = max(a[-1]["b"], b[-1]["b"]) + 20
    d.zone(20, 100, 520, zb - 100, "IMAGE/BUILD-TEST-DISK.SH --RELEASE", "Build server, signed tags only. Privileged trixie-slim.")
    d.zone(580, 100, 520, zb - 100, "IMAGE/BUILD-INSTALLER.SH --RELEASE", "Same container. BLUNIX_RELEASE_VERSION is the tag.")

    y = zb + 60
    lane = zb + 30
    d.zone(20, y, 1080, 200, "PUBLISH")
    stage = d.box(36, y + 50, 330, "17. Upload to staging", [
        "Unsigned, to one R2 bucket.", "Objects expire after 30 days."], status="built", tag="BUILT")
    sign = d.box(395, y + 50, 330, "18. Verify and sign", [
        "The maintainer signs SHA256SUMS", "with the release key, offline."], status="built",
        tag="MANUAL STEP, OFFLINE")
    rel = d.box(754, y + 50, 330, "19. GitHub release", [
        "The maintainer publishes it.", "blunix.io lists /releases.json."], status="built",
        tag="v0.1.0: UNSIGNED TEST")
    d.arrow([(b[-1]["cx"], b[-1]["b"]), (b[-1]["cx"], lane), (200, lane), (200, stage["y"])])
    d.arrow([(stage["r"], stage["cy"]), (sign["x"], stage["cy"])])
    d.arrow([(sign["r"], sign["cy"]), (rel["x"], sign["cy"])])

    y = y + 240
    s1 = chain(d, 36, y + 76, 488, [
        dict(title="20. GitHub Actions, environment production", lines=[
            "Job runs only on refs/heads/main. Actions", "pinned to commit SHAs; token contents: read."],
             status="built", tag="WORKFLOW BUILT"),
        dict(title="21. Stylesheet and tests", lines=[
            "site.css equals portal.css; node --test."], **dict(GATE, tag="GATE: STOPS THE DEPLOY")),
        dict(title="22. wrangler pages deploy", lines=[
            "site/ to blunix-io, portal/ to build-blunix-io."], status="deployed",
             tag="DEPLOYED: BLUNIX.IO AND THE PORTAL"),
    ], gap=28)

    s2 = chain(d, 596, y + 76, 488, [
        dict(title="23. Production config", lines=[
            "Real D1 id, empty DEV_ORIGINS, OIDC issuer and", "client id set, the client secret on the Worker."],
             **dict(GATE, tag="GATE: STOPS THE DEPLOY")),
        dict(title="24. Typecheck and tests", lines=["npm ci, tsc, vitest in the Workers runtime."],
             **dict(GATE, tag="GATE: STOPS THE DEPLOY")),
        dict(title="25. D1 migrations, wrangler deploy", lines=[
            "api.blunix.io and *.blnx.io."], status="deployed"),
    ], gap=28)
    zb = max(s1[-1]["b"], s2[-1]["b"]) + 20
    d.zone(20, y, 520, zb - y, "SITE AND PORTAL", "Push to main in site/, portal/ or brand/, or a manual run.")
    d.zone(580, y, 520, zb - y, "API WORKER", "scripts/deploy-api.sh, a laptop only. Refuses in CI.")
    legend(d, 20, zb + 30, 1080, key=False, gate=True, cipher=False, designed=False)
    d.h = zb + 30 + 96 + 20
    return d


# ---- 4. Installer flow ------------------------------------------------------

def d4():
    d = Diagram(
        "inst", 1120, 2000,
        "Installer flow: blunix install",
        "Thirteen steps from the boot menu to the reboot question, top to bottom on the left. Each step that can "
        "refuse has an arrow to an octagon on the right with the exact sentence the installer says. Every exit "
        "before the disk is written ends with Nothing applied; the two after it say the disk is not bootable. "
        "The key exists from step 6 to step 8. The numbered walk-through after this figure says everything the "
        "diagram shows.")
    d.text(28, 44, "Installer flow: blunix install", T_TITLE, True, INK)
    d.text(28, 72, "All built; it boots in a VM. Octagons are the sentences it says when it stops.", T_LINE, False, MUTED)
    steps = [
        ("1. Boot menu, keys 1 to 5", ["1 full speech, 2 console speech, 3 large print,",
                                       "4 regular (default after 3 s), 5 advanced. It",
                                       "beeps when ready. Netboot boots 4, no menu."], None),
        ("2. Find the image", ["blunix.raw.zst with its .sha256 on the medium,",
                               "or else a release pin: version, sha256, size."],
         (["no image on this medium."], "Nothing applied.")),
        ("3. Read blunix.proxy= from the kernel line", ["Netboot sets it. It changes only where the",
                                                        "document is fetched from."],
         (["refused proxy."], "Nothing applied.")),
        ("4. Network", ["DHCP on en* and eth* for 30 s. No lease: type an",
                        "address like 10.0.0.5/24, a gateway and a DNS",
                        "server. Enter tries DHCP again. Loops until up."], None),
        ("5. Hostname", ["ada, ada.blnx.io or v3.ada.blnx.io. It is read",
                         "back; say yes. Three tries."],
         (["no hostname."], "Nothing applied.")),
        ("6. Key", ["Typed with echo off. Never spoken or logged."],
         (["no key."], "Nothing applied.")),
        ("7. Fetch", ["Direct: https://{host}/, verified TLS 1.2+, 256 KiB.",
                      "With a proxy: http://{proxy}/v1/build/{host}."],
         (["document too large.", "tls verify disabled.", "fetch failed."], "Nothing applied.")),
        ("8. Decrypt and check", ["Canonical key first, then the raw text. Then the",
                                  "schema. Says the name and digest; through a proxy,",
                                  "the full sha256 to compare with the card."],
         (["could not decrypt.", "document refused."], "Nothing applied.")),
        ("9. Pick the disk", ["Never the boot medium (live medium, live-media=,",
                              "bootfrom=, fromiso=, label BLUNIX_INSTALL), a disk",
                              "in use, read-only or too small. Several: type a",
                              "number. Erase needs yes, asked twice; silence is",
                              "no. Only a named, blank target skips the question."],
         (["could not list disks.", "target disk sdb is not usable.", "no disk fits the image.",
          "no disk chosen.", "disk sda kept."], "Nothing applied.")),
        ("10. Check the disk again", ["Same name, serial and size as when chosen. Open",
                                      "it by /dev/disk/by-id; the size must match."],
         (["disk sda changed since it was chosen."], "Nothing applied.")),
        ("11. Write and verify", ["From the medium: sha256 before the first byte and",
                                  "again after, zstd -dc onto the disk. From a pin: a",
                                  "GitHub release over verified TLS, redirects only to",
                                  "GitHub; the stream's sha256 must match the pin."],
         (["image digest did not match.", "image write failed."],
          ["A digest wrong before the write:", "Nothing applied. Otherwise:", "The disk is not bootable."])),
        ("12. Grow, apply, bootloader", ["sgdisk, growpart, resize2fs; apply the node",
                                         "document into the new root; grub for EFI and BIOS."],
         (["install failed on sda."], "The disk is not bootable.")),
        ("13. Reboot?", ["installed ada-1. Remove the stick. Say yes to",
                         "reboot. Anything else: not rebooting."], None),
    ]
    y = 110
    ex_bottom = 0
    prev = None
    for i, (title, lines, exits) in enumerate(steps):
        key = i in (5, 6, 7)
        b = d.box(36, y, 560, title, lines, status=None, key=key)
        if prev:
            d.arrow([(316, prev["b"]), (316, b["y"])])
        if i == 3:
            # the network loop
            d.arrow([(36, b["cy"] + 20), (22, b["cy"] + 20), (22, b["cy"] - 20), (36, b["cy"] - 20)])
        if exits:
            outcome = exits[1] if isinstance(exits[1], list) else [exits[1]]
            words = ["blunix: " + e for e in exits[0]] + outcome
            tag = "STOPS"
            eh = 14 + 24 + 22 * len(words) + 10
            ey = max(b["cy"] - eh / 2, ex_bottom + 14)
            e = d.box(680, ey, 404, [], [], status=None, gate=True, tag=tag, h=eh)
            for k, wline in enumerate(words):
                last = k >= len(words) - len(outcome)
                d.fits("exit", wline, T_LINE, last, 404 - 28)
                d.text(694, ey + 14 + 24 + 22 * (k + 1) - 5, wline, T_LINE, last, INK)
            ex_bottom = e["b"]
            ay = min(max(b["cy"], ey + 20), b["b"] - 12)
            if abs(ay - e["cy"]) < 2 or (e["y"] + 10 <= ay <= e["b"] - 10):
                d.arrow([(596, ay), (680, ay)])
            else:
                d.arrow([(596, ay), (640, ay), (640, e["cy"]), (680, e["cy"])])
        prev = b
        y = max(b["b"] + 30, y + 0)
    legend(d, 20, y + 10, 1080, key=True, gate=True, cipher=False, states=False, designed=False,
           gate_words="Octagon: it stops and says this")
    d.h = int(y + 10 + 52 + 20)
    return d


# ---- 5. Build-proxy on a LAN ------------------------------------------------

def d5():
    d = Diagram(
        "proxy", 1120, 2000,
        "blunix proxy on an install LAN",
        "Cloudflare at the top holds the API and the build hosts. On the customer LAN, the operator's Linux or "
        "macOS computer runs blunix proxy: init, a site file, plan, publish (which reserves labels and uploads "
        "ciphertext, and keeps the keys in keys.txt, mode 0600), dnsmasq (which renders a config), and serve "
        "(which relays only *.blnx.io, serves verified netboot media and boot.ipxe). Bare-metal machines get "
        "DHCP and a PXE chainload from dnsmasq, netboot the installer from serve, and fetch their ciphertext "
        "through serve. Netboot is for trusted LANs only until images are signed. The numbered walk-through "
        "after this figure says everything the diagram shows.")
    d.text(28, 44, "blunix proxy on an install LAN", T_TITLE, True, INK)
    d.text(28, 72, "The proxy is built and tested. The key stays in keys.txt and on the printed card.", T_LINE, False, MUTED)

    d.zone(20, 100, 1080, 170, "CLOUDFLARE")
    api = d.box(36, 146, 480, "api.blunix.io", [
        "POST /v1/hosts reserves; POST .../builds uploads."], status="deployed")
    bh = d.box(604, 146, 480, "{label}.blnx.io", [
        "GET / serves the ciphertext, verified TLS."], status="deployed")

    oz_y = 350
    L, LW = 52, 470
    R, RW = 580, 488
    col = chain(d, L, oz_y + 70, LW, [
        dict(title="1. blunix proxy init", lines=[
            "Writes proxy.yaml (0600): API URL, key file,",
            "listen address. The blx_ key (hosts:write) is",
            "read with echo off into a 0600 file. A",
            "blx_join_ token or a key argument is refused."], status="built", tag="BUILT"),
        dict(title="2. site.yaml", lines=[
            "Per MAC: label, hostname, a static address or",
            "dhcp: true, disk, access, optional target.",
            "Strict parser: unknown keys, duplicates, aliases",
            "and multicast MACs are refused."], status="built", tag="BUILT"),
        dict(title="3. blunix proxy plan", lines=[
            "Renders and validates every node document.",
            "No network, unless --check reads GET /v1/hosts."], status="built", tag="BUILT"),
        dict(title="4. blunix proxy publish", lines=[
            "All documents validate first, or nothing is sent.",
            "Per machine: reserve the label, render with the",
            "inline static network, make a 100-bit key,",
            "age --passphrase, write the pending card, upload,",
            "check the sha256 and size. state.json: no keys."], status="built", tag="BUILT"),
        dict(title="5. keys.txt", lines=[
            "O_EXCL, mode 0600, one card per machine. Never",
            "served; not in the media allowlist. Print the",
            "cards, then delete the file."], status="built", tag="BUILT", key=True),
        dict(title="6. blunix proxy dnsmasq", lines=[
            "Renders a config to stdout. It does not start",
            "dnsmasq."], status="built", tag="BUILT"),
    ], gap=30)
    serve = d.box(R, oz_y + 70, RW, "7. blunix proxy serve", [
        "GET and HEAD only; 64 connections; 60 requests",
        "per IP, refilled 1 a second; no bodies logged.",
        "",
        "/v1/build/{host}: relays only {label}.blnx.io and",
        "v{n}.{label}.blnx.io over verified TLS 1.2+. No",
        "redirects, 256 KiB, 20 s, age bodies only. Cache:",
        "latest 60 s, pinned 1 h. TLS failure: 502.",
        "",
        "/media/: vmlinuz, initrd.img, blunix.squashfs,",
        "hashed against SHA256SUMS at startup. A changed",
        "file is not served. /v1/boot.ipxe names the",
        "advertise address, never the Host header.",
        "/v1/netconfig/{mac}, /healthz.",
    ], status="built", tag="BUILT")
    oz_b = col[-1]["b"] + 20
    d.zone(36, oz_y, 1048, oz_b - oz_y, "OPERATOR'S COMPUTER, LINUX OR MACOS",
           "Python stdlib, PyYAML, and age on the PATH.")

    by = oz_b + 60
    dns = d.box(36, by, 430, "8. dnsmasq, run by the operator", [
        "DNS off (port=0). A DHCP reservation per",
        "MAC; PXE only for listed MACs. iPXE gets",
        "http://PROXY/v1/boot.ipxe; others get",
        "ipxe.efi or undionly.kpxe over TFTP from",
        "/srv/tftp, which the operator supplies."], status="built", tag="CONFIG RENDERED")
    mach = d.box(R, by, RW, "9. Bare-metal machines", [
        "PXE, then iPXE, then the live installer with",
        "blunix.proxy= on its kernel line. The operator",
        "types the hostname, then the key from the card.",
        "Decrypted on the machine."], status="built", tag="BUILT", key=True, mark=False)
    warn = d.box(36, max(dns["b"], mach["b"]) + 30, 1048, "Trusted LANs only until images are signed", [
        "Kernel, initrd and squashfs travel as plain http. serve's startup check proves they match the",
        "SHA256SUMS you trusted, not who built them. iPXE and live-boot verify nothing. No signed release yet.",
    ], status="built", tag="SIGNING: SET UP, NO SIGNED RELEASE YET")

    pub = col[3]
    # 10: publish -> api (ciphertext + Bearer)
    d.arrow([(pub["r"], pub["y"] + 40), (551, pub["y"] + 40), (551, 230), (api["r"], 230)], kind="cipher",
            num=10, num_at=(551, 300))
    # 11: serve -> blnx (verified TLS fetch)
    d.arrow([(serve["cx"], serve["y"]), (serve["cx"], bh["b"])], kind="cipher", num=11, num_at=(serve["cx"], 300))
    # 12: dnsmasq render -> dnsmasq
    d.arrow([(col[-1]["cx"], col[-1]["b"]), (col[-1]["cx"], dns["y"])], num=12, num_at=(col[-1]["cx"], oz_b + 30))
    # 13: dnsmasq -> machines
    d.arrow([(dns["r"], dns["cy"]), (mach["x"], dns["cy"])], num=13, num_at=(523, dns["cy"]))
    # 14, 15, 16: machine <-> serve
    xs = [R + 90, R + 244, R + 398]
    d.arrow([(xs[0], mach["y"]), (xs[0], serve["b"])], num=14, num_at=(xs[0], (serve["b"] + mach["y"]) / 2))
    d.arrow([(xs[1], mach["y"]), (xs[1], serve["b"])], num=15, num_at=(xs[1], (serve["b"] + mach["y"]) / 2))
    d.arrow([(xs[2], mach["y"]), (xs[2], serve["b"])], kind="cipher", num=16,
            num_at=(xs[2], (serve["b"] + mach["y"]) / 2))
    mid = (serve["b"] + mach["y"]) / 2
    d.label((xs[0], mid + 40), ["boot.ipxe"], anchor="middle", bg=ZONE)
    d.label((xs[1], mid + 40), ["/media/", "plain http"], anchor="middle", bg=ZONE)
    d.label((xs[2], mid + 40), ["/v1/build/", "{host}"], anchor="middle", bg=ZONE)
    d.label((523, dns["cy"] + 38), ["DHCP,", "PXE"], anchor="middle", bg=ZONE)
    d.label((565, 262), ["Bearer blx_ key"], anchor="start", bg=NIGHT)
    d.label((serve["cx"] + 14, 262), ["verified TLS"], anchor="start", bg=NIGHT)
    lanb = warn["b"] + 20
    # Zones sit on the back layer, so the LAN is drawn first even though it is sized last.
    outer = Diagram("tmp", 1, 1, "", "")
    outer.zone(20, 300, 1080, lanb - 300, "CUSTOMER LAN, THE INSTALL VLAN")
    d.back = outer.back + d.back
    legend(d, 20, lanb + 30, 1080, key=True, gate=False, cipher=True, states=True)
    d.h = lanb + 30 + 96 + 20
    return d


# ---- 6. The future plane (designed, not built) ------------------------------

def d6():
    d = Diagram(
        "future", 1120, 2000,
        "The future plane: designed, not built",
        "Everything on this diagram is designed, not built, except one box: the live API already refuses every "
        "blx_join_ token with 401. Clients (the web, the laptop CLI, Terraform, Ansible, support) call "
        "api.blunix.io. An enrolled machine runs blunixservice, which dials out only: it enrolls once with a "
        "join token, then signs check-ins with its Ed25519 key and gets back a desired generation, fetches the "
        "ciphertext, applies it, and stages images with systemd-sysupdate from a manifest generated from the "
        "Blunix Log. A cloud builder appends log rows and an offline key signs them. Troubleshoot is a fixed "
        "collect that rides the check-in response and needs a spoken yes on speech and large-print machines. "
        "The numbered walk-through after this figure says everything the diagram shows.")
    d.text(28, 44, "The future plane", T_TITLE, True, INK)
    d.text(28, 72, "DESIGNED, NOT BUILT: docs/designs/blunix-service.md and blunix-platform.md. Dashed throughout.",
           T_LINE, False, MUTED)

    d.zone(20, 100, 1080, 150, "CLIENTS OF ONE API")
    clients = d.box(36, 146, 1048, "Web console, laptop CLI, Terraform, Ansible, support desk", [
        "No second control plane. Keys by scope: hosts:write, machines:read, troubleshoot:request, log:publish."],
        status="designed")

    # the API
    api = [
        d.box(600, 330, 484, "api.blunix.io/v1, new routes", [
            "PUT /v1/hosts/{label}: visibility public or",
            "enrolled. POST .../join-tokens mints blx_join_.",
            "POST /v1/machines: bind a public key, consume",
            "the token. POST .../checkin, GET .../desired.",
            "GET /v1/machines?channel=stable&behind=1.",
        ], status="designed"),
    ]
    today = d.box(600, api[0]["b"] + 22, 484, "Built today: the refusal", [
        "Any blx_join_ bearer token is a 401 on every route."], status="deployed", tag="BUILT AND LIVE")
    host = d.box(600, today["b"] + 22, 484, "{label}.blnx.io, visibility enrolled", [
        "Only a bound machine signature fetches the",
        "ciphertext. public keeps the anonymous GET."], status="designed")
    trouble = d.box(600, host["b"] + 22, 484, "Troubleshoot jobs", [
        "troubleshoot:request mints one: hostname, reason",
        "(behind, decrypt, network, speech, other), expiry.",
        "No shell scope; a command field is refused.",
        "Report read needs troubleshoot:read."], status="designed")
    d.zone(580, 280, 520, trouble["b"] + 20 - 280, "API.BLUNIX.IO")

    # the machine
    m = chain(d, 36, 330, 484, [
        dict(title="blunixservice.service", lines=[
            "Dials out only; no TCP listener. Local control",
            "on /run/blunix/service.sock (0660). Boot does",
            "not wait for it."], status="designed"),
        dict(title="Enroll once", lines=[
            "Ed25519 key made on first start, machine.key",
            "0600. A blx_join_ token (single use, expiry)",
            "is sent once over TLS, then discarded."], status="designed"),
        dict(title="Check in, signed", lines=[
            "Signature over method, path, time and body",
            "sha256; 5-minute skew; 64 KiB; jitter, backoff.",
            "Reply: the desired generation."], status="designed"),
        dict(title="Apply inside the window", lines=[
            "Fetch the ciphertext, decrypt with the local",
            "credential blunix.build-passphrase, run",
            "blunix node apply. On failure keep the old one."], status="designed", key=True),
        dict(title="systemd-sysupdate, A/B", lines=[
            "Stage the image in the other slot; the old slot",
            "still boots. Reboot only in the window; speech",
            "and large print ask and wait."], status="designed"),
        dict(title="Troubleshoot collect", lines=[
            "blunix: troubleshoot requested for lab-3. Say",
            "yes to start. A fixed collector, an allowlisted",
            "report of 64 KiB, signed. No journal, no keys."], status="designed"),
    ], gap=26)
    d.zone(20, 280, 520, m[-1]["b"] + 20 - 280, "ENROLLED MACHINE")

    # log, builder, signer
    ly = max(m[-1]["b"], trouble["b"]) + 70
    log = d.box(36, ly + 50, 484, "Blunix Log, append-only", [
        "Row: version, channel, artifact sha256,",
        "signature, predecessor, files. Withdraw is a new",
        "row. GET is public; the site renders it."], status="designed")
    man = d.box(36, log["b"] + 26, 484, "Manifest, updates.blunix.io/blunix", [
        "Generated from current rows, never hand-edited.",
        "Mirrors are caches of one digest."], status="designed")
    d.arrow([(log["cx"], log["b"]), (log["cx"], man["y"])], kind="designed")
    d.zone(20, ly, 520, man["b"] + 20 - ly, "BLUNIX LOG")
    builder = d.box(600, ly + 50, 484, "Cloud builder", [
        "Runs the build the repo specifies. Its only",
        "output is a log row, through log:publish."], status="designed")
    signer = d.box(600, builder["b"] + 26, 484, "Offline signing key", [
        "Signs images and rows. Never on the builder",
        "or on Cloudflare."], status="designed")
    d.zone(580, ly, 520, signer["b"] + 20 - ly, "BUILD AND SIGN")

    # arrows, all designed
    d.arrow([(310, clients["b"]), (310, 265), (840, 265), (840, api[0]["y"])], kind="designed", num=1, num_at=(560, 265))
    top = api[0]
    d.arrow([(m[1]["r"], m[1]["cy"]), (548, m[1]["cy"]), (548, top["y"] + 50), (600, top["y"] + 50)], kind="designed",
            num=2, num_at=(548, (m[1]["cy"] + top["y"] + 50) / 2))
    d.arrow([(m[2]["r"], m[2]["cy"]), (572, m[2]["cy"]), (572, top["y"] + 100), (600, top["y"] + 100)], kind="designed",
            start=True, num=3, num_at=(572, (m[2]["cy"] + top["y"] + 100) / 2 + 30))
    d.arrow([(host["x"], host["cy"]), (586, host["cy"]), (586, m[3]["cy"]), (m[3]["r"], m[3]["cy"])], kind="designed",
            num=4, num_at=(586, (host["cy"] + m[3]["cy"]) / 2 + 20))
    d.arrow([(m[5]["r"], m[5]["cy"]), (560, m[5]["cy"]), (560, trouble["b"] - 20), (trouble["x"], trouble["b"] - 20)],
            kind="designed", num=5, num_at=(560, (m[5]["cy"] + trouble["b"]) / 2 - 10))
    d.arrow([(builder["x"], builder["cy"]), (log["r"], builder["cy"])], kind="designed", num=6,
            num_at=(560, builder["cy"]))
    d.arrow([(signer["x"], signer["cy"]), (560, signer["cy"]), (560, log["b"] - 20), (log["r"], log["b"] - 20)],
            kind="designed", num=7, num_at=(560, signer["cy"]))
    d.arrow([(m[4]["x"], m[4]["cy"]), (26, m[4]["cy"])], kind="designed", end=False)
    d.arrow([(26, m[4]["cy"]), (26, man["cy"]), (36, man["cy"])], kind="designed", start=False, end=False)
    d.badge(26, (m[4]["cy"] + man["cy"]) / 2, 8)
    # arrowhead toward the machine: sysupdate reads the manifest
    d.lines.append('<path d="M26 %.1f L%.1f %.1f" fill="none" stroke="none" marker-end="url(#%s-head)"/>'
                   % (m[4]["cy"], m[4]["x"], m[4]["cy"], d.slug))
    legend(d, 20, signer["b"] + 60 if signer["b"] > man["b"] else man["b"] + 60, 1080, key=True, cipher=False)
    d.h = int(max(signer["b"], man["b"]) + 60 + 96 + 20)
    return d


# ---- walk-throughs: the primary content --------------------------------------
# One source for site/architecture.html and docs/architecture.md. Backticks mark code.

WALK = {}

WALK["01-ecosystem"] = [
    ("h3", "What each zone holds"),
    ("ul", [
        "**Operator's device.** The operator's browser runs the portal's JavaScript, which is live. It composes the node document, makes the key, and encrypts with age. The key exists here. The browser sends only ciphertext.",
        "**adsas.id.** After Dark Systems SSO, the OpenID Connect identity provider, runs today, and the Blunix client on it is live. It signs the operator in to the portal.",
        "**Cloudflare** holds records and ciphertext, never a key. The blunix.io website on Pages is deployed. Its function `/releases.json` reads GitHub, and its page asks `api.blunix.io/v1/health` whether the API is up.",
        "**Cloudflare, continued.** The build.blunix.io portal is a separate Pages project, and it is live. It is same-site with the API, so the session cookie rides the portal's `fetch` calls.",
        "**Cloudflare, continued.** The api.blunix.io Worker (`/v1`) is live. `/v1/health` answers, and the site's portal status line comes from that check. It handles sign-in, labels, builds and API keys. It checks the age header and never decrypts. D1 holds accounts, labels, versions, hashed sessions and hashed API keys, audit rows and rate limits. R2 holds each build at `builds/{label id}/{version}` as the binary age file, and its sha256 is checked before it is served.",
        "**Cloudflare, continued.** `{label}.blnx.io` is the same Worker: `GET` and `HEAD` on `/` only. blnx.io is a separate registrable domain, so build hosts never share cookies with the site, the portal or the API. Live, with wildcard DNS and TLS. Only the latest version is served for now: pinned version hosts, `v{n}.{label}.blnx.io`, have no certificates yet.",
        "**GitHub.** The repo `afterdarksys/blunix` is live. Its Actions job, in the `production` environment, deploys `site/` and `portal/`. Releases hold the ISO, `blunix.raw.zst`, the netboot media and `SHA256SUMS`. v0.1.0 is an unsigned test release on Debian 13: its checksums prove the bytes match, not who built them.",
        "**Release build server.** A separate server, not on Cloudflare. It builds only tags signed by the pinned release key, in a privileged `debian:trixie-slim` container pinned by digest. It is pull-only and holds no signing key. It uploads the images, unsigned, to a staging bucket where objects expire after 30 days.",
        "**Offline.** The release signing key, an OpenPGP ed25519 key, on the maintainer's machine. It is never on the build server and never on Cloudflare. It is set up; the first signed release is next.",
        "**Customer LAN.** `blunix proxy` on the operator's Linux or Mac, built. `publish` encrypts per machine and uploads ciphertext. `serve` relays `*.blnx.io` and serves netboot media and `boot.ipxe`. The keys are in `keys.txt`, mode 0600, on this computer. The key exists here.",
        "**The machine at the console.** The installer (ISO, USB or netboot) or the first-boot bootstrap (raw image), built and booting in a VM. It asks the hostname, then the key with echo off, fetches, decrypts on the machine, and applies. The key exists here while it is typed.",
    ]),
    ("h3", "The numbered connections"),
    ("ol", [
        "The browser loads the portal page from build.blunix.io.",
        "The browser calls api.blunix.io with the session cookie (`credentials: 'include'`). The build upload on this path is ciphertext only.",
        "The browser and After Dark Systems SSO: the sign-in redirects, both ways.",
        "The Worker and After Dark Systems SSO: the Worker trades the code and the PKCE verifier for an ID token, and fetches the JWKS to check it.",
        "The Worker reads and writes D1 and R2.",
        "The build hosts read D1 and R2.",
        "`{label}.blnx.io` to the machine: HTTPS `GET /` over verified TLS. Ciphertext only.",
        "`{label}.blnx.io` to the proxy: the proxy fetches over verified TLS. Ciphertext only.",
        "The proxy to the machine: plain http on the LAN. Ciphertext only. It is safe because age is authenticated; through a proxy the installer also says the full sha256 to compare with the install card.",
        "The proxy to the Worker: `publish` reserves labels and uploads ciphertext with a `blx_` API key.",
        "The site's `/releases.json` function reads the GitHub Releases API and each release's `SHA256SUMS`.",
        "GitHub Actions deploys the site and the portal to Cloudflare Pages.",
        "The release build server polls GitHub every 10 minutes and fetches new tags. It builds a tag only if its signature checks against the pinned release key.",
        "The installer streams the image from a GitHub release when its medium carries only a release pin. The stream's sha256 must match the pin.",
        "The build server uploads the unsigned images to the staging bucket. The maintainer pulls them from there, verifies them, and signs `SHA256SUMS` offline.",
        "The maintainer publishes the signed GitHub release. The build server cannot publish.",
    ]),
]

WALK["02-web-bootstrap"] = [
    ("p", "Six participants: the operator, the browser running the portal, After Dark Systems SSO at adsas.id, the api.blunix.io Worker (with D1 and R2), the `{label}.blnx.io` build host (the same Worker), and the machine at the console. The key exists in three places only: the browser, from step 14 until the install card closes in step 21; the operator's install card, from step 20; and the machine, from step 23 until it decrypts in step 27. It is never on a server."),
    ("h3", "In the browser, at build.blunix.io"),
    ("ol", [
        "The operator asks the browser to sign in.",
        "The browser calls `GET /v1/auth/login`. The Worker stores the state, the nonce and the PKCE verifier for 10 minutes.",
        "The Worker answers 302 to After Dark Systems SSO, with `code_challenge` and method `S256`, the state and the nonce. The scopes are `openid email profile`.",
        "The operator signs in at adsas.id.",
        "After Dark Systems SSO answers 302 to `/v1/auth/callback` with the code and the state.",
        "The browser calls `GET /v1/auth/callback`.",
        "The Worker sends After Dark Systems SSO the code and the verifier for the ID token, and fetches the JWKS.",
        "The Worker checks the ID token: algorithm RS256, ES256 or EdDSA only; `iss`, `aud`, `exp` and `nonce`. It upserts the account by `(iss, sub)`.",
        "The Worker sets the cookie `__Host-blx_session` (12 hours, `HttpOnly`, `Secure`, `SameSite=Lax`) and answers 302 to build.blunix.io. The portal shows the signed-in person's name.",
        "The operator fills in the form: a label and the node document fields.",
        "The browser calls `POST /v1/hosts {label}` with `x-blunix-csrf: 1` and the portal's `Origin`.",
        "The Worker answers 201. Or 409 if the label is taken, 400 if it is invalid or reserved, 429 if rate limited.",
        "The browser composes the node document and checks every field.",
        "The browser makes the key: 100 bits from `crypto.getRandomValues`, 20 Crockford base32 characters. The key now exists in the browser.",
        "The browser encrypts the document with age, scrypt passphrase mode.",
        "The browser calls `POST /v1/hosts/{label}/builds` with ciphertext only, up to 256 KiB.",
        "The Worker refuses anything but an age file with one scrypt stanza. It stores the body in R2, and the version, the sha256 and an audit row in D1.",
        "The Worker answers 201 with the version, sha256, size, URL, and a pinned URL, or null while pinned hosts have no certificates.",
        "The browser checks that the sha256 matches what it sent. If not, no card is shown.",
        "The browser hands the operator the install card. The key now exists on the card.",
        "The card is shown once: the URL, the key and the sha256, with .txt and .json downloads. Closing it wipes the key from the page.",
    ]),
    ("h3", "At the machine: the installer or the first-boot bootstrap"),
    ("ol_start", 22, [
        "The operator types the hostname. `ada` becomes `ada.blnx.io`. It is read back, and the operator says yes.",
        "The operator types the key from the card. Echo is off and it is never spoken. The key now exists on the machine.",
        "The machine calls `GET https://ada.blnx.io/` over verified TLS 1.2 or higher, capped at 256 KiB.",
        "The build host takes the latest version from D1 and R2, and checks the body's sha256 before it leaves.",
        "The build host answers 200 with the ciphertext and `x-blunix-sha256`.",
        "The machine decrypts on the machine, then checks the schema. A wrong key or a refusal applies nothing. The key is dropped after decryption.",
        "The machine applies. The installer writes the disk first; the bootstrap applies the document to the disk it is running on.",
    ]),
    ("p", "The note at the bottom of the diagram says it plainly: no key on the server side. It is not sent, stored or logged. The Worker holds only ciphertext and its sha256."),
]

WALK["03-build-release"] = [
    ("p", "Octagons are gates: the build stops there and writes no release. The first two columns run on the separate release build server, in a privileged `debian:trixie-slim` container pinned by digest. Before any of it, the server checks the tag. It builds only a tag signed by the pinned release key. An unsigned or lightweight tag is refused. No credential is passed into the container, and a release starts from an empty `build/`."),
    ("h3", "image/build-test-disk.sh --release"),
    ("ol", [
        "Debian 13 packages: official packages, listed in `image/packages.txt`.",
        "mmdebstrap builds the root filesystem: amd64, variant apt, cached by a stamp.",
        "Gate: strip SSH host keys, the random seed and `credential.secret`, and empty the machine-id. A host key left behind stops the build.",
        "A GPT disk with an ESP and an ext4 `blunix-root`. The root, the overlay and the tools are copied in, and grub is installed. For a release, root is locked and the test fixture is removed.",
        "Gate: `scan-root.py --release` refuses test secrets, the fixture, an unlocked account, root or password SSH, a shipped host key, and vendor binaries.",
        "zerofree zeroes the free blocks of `blunix-root`.",
        "Gate: `scan-raw.py` reads every byte of the disk for private keys, age secret keys, the fixture's age header and the two test secrets.",
        "The output is `build/blunix-release.raw`, the release disk. It feeds step 9.",
    ]),
    ("h3", "image/build-installer.sh --release (BLUNIX_RELEASE_VERSION is the tag)"),
    ("ol_start", 9, [
        "Gate: no version, the word `latest`, or no release disk stops the build.",
        "Gate: the release disk is scanned again. It is mounted read-only for `scan-root.py --release`, then `scan-raw.py` reads the raw file.",
        "Gate: zstd compresses it to `blunix.raw.zst`, and `scan-raw.py` scans the decompressed stream byte by byte.",
        "The digest `blunix.raw.zst.sha256` and the release pin `blunix.release` (version, sha256, size) go into the live root.",
        "Gate: `scan-root.py` scans the installer's own filesystem.",
        "The ISO and netboot media: a squashfs, the boot menu with keys 1 to 5, a hybrid ISO with volume label `BLUNIX_INSTALL`, and `vmlinuz`, `initrd.img`, `blunix.squashfs` and `blunix.ipxe`.",
        "Gate: every asset must be under 2 GiB, GitHub's per-file limit.",
        "`SHA256SUMS` in `build/release/` covers the ISO, `blunix.raw.zst`, `vmlinuz`, `initrd.img` and `blunix.squashfs`. `image/gpl-sources.py` then writes `SOURCES.md`, the GPL source notice that every release attaches. The build scripts do not upload.",
    ]),
    ("h3", "Publish"),
    ("ol_start", 17, [
        "The build server uploads the images, unsigned, to a staging bucket on R2. Its only credential can write to that one bucket. Objects expire after 30 days.",
        "A manual step, offline. The maintainer pulls the images from staging, verifies them, and signs `SHA256SUMS` with the release key on their own machine. `scripts/release-sign.py` pins full key fingerprints. The key is never on the build server or Cloudflare.",
        "The maintainer publishes the GitHub release on `afterdarksys/blunix`. blunix.io lists it through `/releases.json`. v0.1.0 is an unsigned test release; the first signed release is next.",
    ]),
    ("h3", "Site and portal: push to main in site/, portal/ or brand/, or a manual run"),
    ("ol_start", 20, [
        "GitHub Actions, environment `production` (the workflow is built). The job runs only on `refs/heads/main`. Actions are pinned to commit SHAs, and the token is `contents: read`.",
        "Gate: `site/css/site.css` must equal `portal/css/site.css`, and the node tests must pass.",
        "`wrangler pages deploy`: `site/` to the Pages project `blunix-io`, `portal/` to `build-blunix-io`. Both are live. `scripts/deploy-site.sh` is the same path from a laptop.",
    ]),
    ("h3", "API Worker: scripts/deploy-api.sh, a laptop only, refuses in CI"),
    ("ol_start", 23, [
        "Gate: a production config. A real D1 id, an empty `DEV_ORIGINS`, the OIDC issuer and client id set, and the client secret on the Worker.",
        "Gate: `npm ci`, the typecheck, and the vitest suite in the Workers runtime.",
        "D1 migrations, then `wrangler deploy` for api.blunix.io and `*.blnx.io`. Both are live.",
    ]),
]

WALK["04-installer"] = [
    ("p", "All of this is built and boots in a VM. Each exit is the exact sentence the installer says. Every exit before the disk is written ends with Nothing applied. The key exists from step 6 to step 8."),
    ("ol", [
        "Boot menu, keys 1 to 5: 1 full speech, 2 console speech, 3 large print, 4 regular (the default after 3 seconds), 5 advanced. The menu beeps when it is ready. Netboot boots regular, with no menu.",
        "Find the image: `blunix.raw.zst` with its `.sha256` on the medium, or else a release pin (version, sha256, size). Exit: `blunix: no image on this medium. Nothing applied.`",
        "Read `blunix.proxy=` from the kernel command line. Netboot sets it. It changes only where the document is fetched from. Exit: `blunix: refused proxy. Nothing applied.`",
        "Network: DHCP on `en*` and `eth*` for 30 seconds. With no lease, type an address like `10.0.0.5/24`, then a gateway and a DNS server. Enter tries DHCP again. It loops until the network is up; there is no exit here.",
        "Hostname: `ada`, `ada.blnx.io` or `v3.ada.blnx.io`. It is read back; say yes. Three tries. Exit: `blunix: no hostname. Nothing applied.`",
        "Key: typed with echo off, never spoken or logged. The key now exists here. Exit, for an empty key: `blunix: no key. Nothing applied.`",
        "Fetch: directly from `https://{host}/` over verified TLS 1.2 or higher, capped at 256 KiB, or with a proxy from `http://{proxy}/v1/build/{host}`. Exits: `blunix: document too large.`, `blunix: tls verify disabled.`, `blunix: fetch failed.`, each followed by Nothing applied.",
        "Decrypt and check: the canonical key first, then the raw text as typed, then the schema. It says the document name and digest; through a proxy it says the full sha256 to compare with the install card. The key is dropped after this step. Exits: `blunix: could not decrypt.` or `blunix: document refused.`, then Nothing applied.",
        "Pick the disk. Never the boot medium (the live medium, any disk named by `live-media=`, `bootfrom=` or `fromiso=`, or a disk labelled `BLUNIX_INSTALL`), a disk in use, a read-only disk, or one too small. With several, type a number. Erasing needs yes, asked twice; silence is no. Only a target named in the document that is blank skips the question. Exits: `could not list disks`, `target disk sdb is not usable`, `no disk fits the image`, `no disk chosen`, `disk sda kept`, each as a `blunix:` sentence followed by Nothing applied.",
        "Check the disk again: the same name, serial and size as when it was chosen. It is opened by `/dev/disk/by-id`, and the opened size must match. Exit: `blunix: disk sda changed since it was chosen. Nothing applied.`",
        "Write and verify. From the medium: the sha256 is checked before the first byte and again after, and `zstd -dc` writes the disk. From a release pin: the image streams from a GitHub release over verified TLS, redirects stay on GitHub, and the stream's sha256 must match the pin. Exits: `blunix: image digest did not match.` A digest found wrong before the write says Nothing applied; after the write, and for `blunix: image write failed.`, it says The disk is not bootable.",
        "Grow, apply, bootloader: `sgdisk`, `growpart` and `resize2fs`; apply the node document into the new root; grub for EFI and BIOS. Exit: `blunix: install failed on sda. The disk is not bootable.`",
        "Reboot: `blunix: installed ada-1. Remove the stick. Say yes to reboot.` Anything else: `blunix: not rebooting.`",
    ]),
    ("p", "Not drawn, but in the code: any answer typed at a second console stops with `blunix: another console is installing.`, and any unexpected error stops with `blunix: install failed.`"),
]

WALK["05-build-proxy"] = [
    ("p", "The proxy is built and tested, and the API and build hosts it talks to are live. Release signing is set up, but no signed release exists yet, so the trusted-LAN rule still holds. The key stays in `keys.txt` and on the printed card."),
    ("h3", "Cloudflare"),
    ("ul", [
        "api.blunix.io, live: `POST /v1/hosts` reserves a label; `POST /v1/hosts/{label}/builds` uploads.",
        "`{label}.blnx.io`, live: `GET /` serves the ciphertext over verified TLS.",
    ]),
    ("h3", "The operator's computer, Linux or macOS (Python stdlib, PyYAML, and age on the PATH)"),
    ("ol", [
        "`blunix proxy init` writes `proxy.yaml` (mode 0600): the API URL, the key file and the listen address. The `blx_` API key (scope `hosts:write`) is read with echo off into a 0600 file. A `blx_join_` token, or a key given as an argument, is refused.",
        "`site.yaml` lists, per MAC: the label, the hostname, a static address or `dhcp: true`, the disk, the access profile, and an optional target disk. The parser refuses unknown keys, duplicate keys, aliases and multicast MACs.",
        "`blunix proxy plan` renders and validates every node document. It makes no network call unless `--check` reads `GET /v1/hosts`.",
        "`blunix proxy publish` validates every document first, or sends nothing. Then, per machine: reserve the label, render the document with its inline static network, make a 100-bit key, encrypt with `age --passphrase`, write the pending card, upload, and check the returned sha256 and size. `state.json` holds no keys.",
        "`keys.txt`: created with `O_EXCL`, mode 0600, one card per machine. It is never served and is not in the media allowlist. The key exists here. Print the cards, then delete the file.",
        "`blunix proxy dnsmasq` renders a dnsmasq config to stdout. It does not start dnsmasq.",
        "`blunix proxy serve`: `GET` and `HEAD` only, at most 64 connections, 60 requests per IP refilled at one a second, and no bodies logged. `/v1/build/{host}` relays only `{label}.blnx.io` and `v{n}.{label}.blnx.io` (pinned hosts are not on yet) over verified TLS 1.2 or higher, with no redirects, a 256 KiB cap, a 20-second limit and age bodies only, cached 60 seconds for latest and 1 hour for pinned; a TLS failure is a 502. `/media/` serves `vmlinuz`, `initrd.img` and `blunix.squashfs`, hashed against `SHA256SUMS` at startup; a file that changes later is not served. `/v1/boot.ipxe` names the advertise address, never the Host header. Also `/v1/netconfig/{mac}` and `/healthz`.",
    ]),
    ("h3", "On the install VLAN"),
    ("ol_start", 8, [
        "dnsmasq, run by the operator with the rendered config: DNS off (`port=0`), a DHCP reservation per MAC, and PXE only for listed MACs. iPXE clients get `http://PROXY/v1/boot.ipxe`; others get `ipxe.efi` or `undionly.kpxe` over TFTP from `/srv/tftp`, which the operator supplies.",
        "Bare-metal machines: PXE, then iPXE, then the live installer with `blunix.proxy=` on its kernel line. The operator types the hostname, then the key from the card. The key exists here. The document is decrypted on the machine.",
    ]),
    ("h3", "The numbered arrows"),
    ("ol_start", 10, [
        "`publish` to api.blunix.io: reserve and upload, ciphertext only, with the `Bearer blx_` key.",
        "`serve` to `{label}.blnx.io`: verified TLS, ciphertext only.",
        "The rendered config goes to dnsmasq, which the operator starts.",
        "dnsmasq to the machines: DHCP and the PXE boot file.",
        "The machines fetch `boot.ipxe` from `serve`.",
        "The machines fetch the kernel, initrd and squashfs from `/media/` over plain http.",
        "The installer fetches `/v1/build/{host}` from `serve`: ciphertext only.",
    ]),
    ("p", "Trusted LANs only until images are signed. The kernel, initrd and squashfs travel as plain http. `serve`'s startup check proves they match the `SHA256SUMS` you trusted, not who built them. iPXE and live-boot verify nothing. Release signing is set up; the first signed release is next."),
]

WALK["06-future-plane"] = [
    ("p", "Everything on this diagram is designed, not built, from `docs/designs/blunix-service.md` and `docs/designs/blunix-platform.md`. One box is the exception: the API already refuses every `blx_join_` bearer token with 401 on every route. That refusal is built and live."),
    ("h3", "The boxes"),
    ("ul", [
        "**Clients of one API.** The web console, the laptop CLI, Terraform, Ansible and the support desk. There is no second control plane. Keys by scope: `hosts:write`, `machines:read`, `troubleshoot:request`, `log:publish`.",
        "**api.blunix.io, new routes.** `PUT /v1/hosts/{label}` sets visibility to public or enrolled. `POST /v1/hosts/{label}/join-tokens` mints a `blx_join_` token. `POST /v1/machines` binds a public key and consumes the token. `POST /v1/machines/{hostname}/checkin` and `GET .../desired`. `GET /v1/machines?channel=stable&behind=1` lists machines behind the channel head.",
        "**`{label}.blnx.io` with visibility enrolled.** Only a bound machine's signature fetches the ciphertext. Public keeps the anonymous `GET`.",
        "**Troubleshoot jobs.** `troubleshoot:request` mints one: a hostname, a reason (behind, decrypt, network, speech, other) and an expiry. There is no shell scope, and a command field is refused. Reading the report needs `troubleshoot:read`.",
        "**Enrolled machine, blunixservice.service.** It dials out only and has no TCP listener. Local control is on `/run/blunix/service.sock` (0660). Boot does not wait for it.",
        "**Enroll once.** An Ed25519 key is made on first start, in `machine.key`, mode 0600. A `blx_join_` token (single use, with an expiry) is sent once over TLS, then discarded.",
        "**Check in, signed.** The signature covers the method, the path, the time and the body's sha256, with a 5-minute skew, a 64 KiB cap, jitter and backoff. The reply is the desired generation.",
        "**Apply inside the window.** Fetch the ciphertext, decrypt with the local credential `blunix.build-passphrase`, run `blunix node apply`. On failure, keep the old document. The key exists here, as that credential.",
        "**systemd-sysupdate, A/B.** Stage the image in the other slot; the old slot still boots. Reboot only in the window. Speech and large-print machines ask and wait.",
        "**Troubleshoot collect.** `blunix: troubleshoot requested for lab-3. Say yes to start.` A fixed collector, an allowlisted report of 64 KiB, signed. No journal text and no keys.",
        "**Blunix Log, append-only.** A row holds the version, channel, artifact sha256, signature, predecessor and file names. Withdrawing is a new row. `GET` is public; the site renders it.",
        "**Manifest at `updates.blunix.io/blunix`.** Generated from the current rows, never edited by hand. Mirrors are caches of one digest.",
        "**Cloud builder.** Runs the build the repo specifies. Its only output is a log row, through `log:publish`. Today the separate release build server stages unsigned images instead; the log row is designed.",
        "**Offline signing key.** Signs images and rows. Never on the builder or on Cloudflare. The release key exists today and will sign `SHA256SUMS`; signing log rows is designed.",
    ]),
    ("h3", "The numbered arrows, all designed"),
    ("ol", [
        "The clients call api.blunix.io.",
        "The machine enrolls with its join token.",
        "Check-in and the desired generation, both ways.",
        "The build host sends the ciphertext to the apply step.",
        "The collect sends its signed report to the troubleshoot job.",
        "The cloud builder appends a log row.",
        "The offline key signs the rows.",
        "systemd-sysupdate reads the manifest.",
    ]),
]


def _inline(text, html_mode):
    parts = re.split(r"(`[^`]+`|\*\*[^*]+\*\*)", text)
    out = []
    for p in parts:
        if p.startswith("`") and p.endswith("`"):
            out.append("<code>%s</code>" % esc(p[1:-1]) if html_mode else p)
        elif p.startswith("**") and p.endswith("**"):
            out.append("<strong>%s</strong>" % _inline(p[2:-2], True) if html_mode else p)
        else:
            out.append(esc(p) if html_mode else p)
    return "".join(out)


def walk_html(name):
    out = []
    for block in WALK[name]:
        kind = block[0]
        if kind == "p":
            out.append("<p>%s</p>" % _inline(block[1], True))
        elif kind == "h3":
            out.append("<h3>%s</h3>" % esc(block[1]))
        elif kind in ("ol", "ul", "ol_start"):
            start = block[1] if kind == "ol_start" else 1
            items = block[2] if kind == "ol_start" else block[1]
            tag = "ul" if kind == "ul" else "ol"
            attr = ' start="%d"' % start if tag == "ol" and start != 1 else ""
            out.append("<%s%s>" % (tag, attr))
            out.extend("  <li>%s</li>" % _inline(i, True) for i in items)
            out.append("</%s>" % tag)
    return "\n".join(out)


def walk_md(name):
    out = []
    for block in WALK[name]:
        kind = block[0]
        if kind == "p":
            out.append(block[1] + "\n")
        elif kind == "h3":
            out.append("#### " + block[1] + "\n")
        elif kind in ("ol", "ul", "ol_start"):
            start = block[1] if kind == "ol_start" else 1
            items = block[2] if kind == "ol_start" else block[1]
            for n, i in enumerate(items, start):
                out.append(("- " if kind == "ul" else "%d. " % n) + i)
            out.append("")
    return "\n".join(out)


DIAGRAMS = [("01-ecosystem", d1), ("02-web-bootstrap", d2), ("03-build-release", d3), ("04-installer", d4), ("05-build-proxy", d5), ("06-future-plane", d6)]


SECTIONS = {
    "01-ecosystem": "1. Who talks to whom",
    "02-web-bootstrap": "2. From sign-in to an applied document",
    "03-build-release": "3. Build and release",
    "04-installer": "4. The installer",
    "05-build-proxy": "5. The build-proxy on a LAN",
    "06-future-plane": "6. Later: the future plane (designed, not built)",
}

# Where the code and docs/designs/blunix-install-plane.md (or the site) disagree.
# The diagrams follow the code.
DISAGREE = [
    "**Network fallback.** The contract says that with no DHCP lease the installer uses the proxy from `blunix.proxy=`. In the code, `blunix.proxy=` is read before the network and changes only where the document is fetched from. The network is DHCP for 30 s, then a typed static address, in a loop. The proxy never gives the installer an address; on a netboot LAN, dnsmasq's DHCP reservation does. The contract and `site/install.html` were corrected on 2026-09-30 to match the code.",
    "**`/v1/netconfig/{mac}` has no caller.** `blunix proxy serve` answers it, as the contract says, but neither the installer nor the bootstrap requests it.",
    "**The erase question.** The contract asks for a yes when a disk already has partitions. The code asks whenever the document names no `target`, even for a blank disk, and skips the question only for a named target that is blank. The code is stricter.",
    "**keys.txt order.** The contract lists writing `keys.txt` last. The code appends a pending card and fsyncs it before the upload, then appends `Published:` or `Not confirmed:`. That is deliberate, so a lost API answer never loses a key.",
    "**Proxy command names.** The contract writes `blunix proxy site.yaml`. The code has `blunix proxy plan` and `blunix proxy publish` (the contract names these too, a line later).",
    "**The legacy host form.** The contract keeps `name-1042.build.blunix.io` so the fixture boots, and the installer accepts it. The proxy relay refuses it, so a legacy host installs directly but not through a proxy.",
    "**Pinned URLs.** The contract's hand-off always shows `https://v3.ada.blnx.io/`. The Worker returns `pinnedUrl: null` until `PINNED_HOSTS_TLS` is `on`, and the portal and the card then leave it out. The contract's deploy notes explain why; its hand-off section does not.",
    "**Routes not in the contract.** The Worker answers `GET /v1/health` (public, CORS for blunix.io only), which the site's `js/live.js` calls. An upload with the wrong content type is `415 unsupported media type`, not the contract's `400 refused ciphertext`. Reserving past 20 labels is `403 label limit`.",
    "**Image source.** The contract says the medium's image, \"or updates.blunix.io later\". The code falls back to a GitHub release named by a pin on the medium, over verified TLS, checked against the pinned sha256.",
    "**The builder.** The contract places the builder on our servers, on a clean host, using mkosi or Docker. Release images are now built on a separate release build server, from signed tags only, in a privileged container pinned by digest; `image/mkosi/` is not used by these scripts. The build scripts never upload. The build server stages unsigned images in a bucket that expires after 30 days, and the maintainer signs and publishes the release offline.",
    "**Two apiVersion domains.** Node documents are `apiVersion: blunix.dev/v1`; the offline `InstallBundle` is `apiVersion: blunix.io/v1`. Both match the contract, but the two domains differ.",
    "**The first-boot bootstrap.** The raw image's bootstrap has no proxy and no typed static address. It waits for a DHCP address (18 checks, 5 s apart), then fails closed. Only the live installer has the fallbacks.",
    "**Deployment, as of 2026-10-03.** blunix.io and `/releases.json`, build.blunix.io, api.blunix.io and the `{label}.blnx.io` build hosts are live, with sign-in through After Dark Systems SSO. Pinned version hosts are not on yet, so the Worker returns `pinnedUrl: null`. v0.1.0 is an unsigned test release; release signing is set up and the first signed release is next. If the contract's status line still says BUILDING, it is behind.",
]


def _replace(text, start, end, body):
    i = text.index(start) + len(start)
    j = text.index(end)
    return text[:i] + "\n" + body + "\n" + text[j:]


def write_page(built):
    with open(PAGE, encoding="utf-8") as fh:
        page = fh.read()
    for name, d in built.items():
        page = _replace(page, "<!-- diagram:%s -->" % name, "<!-- /diagram:%s -->" % name, d.svg(standalone=False).rstrip())
        page = _replace(page, "<!-- walk:%s -->" % name, "<!-- /walk:%s -->" % name, walk_html(name))
    with open(PAGE, "w", encoding="utf-8") as fh:
        fh.write(page)


def write_doc():
    out = [
        "# Architecture",
        "",
        "How the Blunix install plane fits together, drawn from the code and the running services as they stand on 2026-10-03. "
        "The same drawings and walk-throughs are on `site/architecture.html`. The walk-through under each "
        "drawing says everything the drawing says.",
        "",
        "Sources: `brand/src/tools/diagrams.py` draws them (`python3 brand/src/tools/diagrams.py`), and "
        "`brand/src/tools/diagrams-png.sh` renders the PNGs at 2x.",
        "",
        "## Reading the drawings",
        "",
        "- **Deployed, live today:** a heavy solid border and a filled dot.",
        "- **Built and tested in the repo:** a thin solid border and a hollow square.",
        "- **Designed, not built:** a dashed border and a dashed square. A dashed line is a designed path.",
        "- **A double line carries only ciphertext.** A single line is any other call or data.",
        "- **An octagon is a gate or a stop:** the build, deploy or install stops there and says why.",
        "- **KEY HERE** marks where the key exists. It never exists on a server.",
        "",
    ]
    for name, title in SECTIONS.items():
        out += ["## " + title, "", "![%s](../brand/diagrams/%s.svg)" % (title, name), "",
                "PNG at 2x: [`brand/diagrams/%s.png`](../brand/diagrams/%s.png)" % (name, name), "",
                walk_md(name), ""]
    out += ["## Where the code and the contract disagree", "",
            "The contract is `docs/designs/blunix-install-plane.md`. The drawings follow the code.", ""]
    out += ["%d. %s" % (i, t) for i, t in enumerate(DISAGREE, 1)]
    with open(DOC, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out).rstrip() + "\n")


def main():
    os.makedirs(OUT, exist_ok=True)
    failed = False
    built = {}
    for name, fn in DIAGRAMS:
        d = fn()
        if d.errors:
            failed = True
            for e in d.errors:
                print("diagrams: %s: %s" % (name, e), file=sys.stderr)
        with open(os.path.join(OUT, name + ".svg"), "w", encoding="utf-8") as fh:
            fh.write(d.svg(standalone=True))
        built[name] = d
        print("diagrams: wrote brand/diagrams/%s.svg (%dx%d)" % (name, d.w, d.h))
    if failed:
        return 1
    write_page(built)
    write_doc()
    print("diagrams: wrote site/architecture.html and docs/architecture.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
