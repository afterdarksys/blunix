"""Generate HTML sources for Blunix promotional graphics."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
S = json.load(open(os.path.join(HERE, "out", "_snippets.json")))
HX0, HY0, HX1, HY1 = S["head_bounds"]
BX0, BY0, BX1, BY1 = S["wordmark_bounds"]

CSS = """
@font-face { font-family: Fraunces; src: url("fonts/fraunces-latin.woff2") format("woff2"); font-weight: 100 900; font-style: normal; }
@font-face { font-family: Fraunces; src: url("fonts/fraunces-italic.woff2") format("woff2"); font-weight: 100 900; font-style: italic; }
@font-face { font-family: Atkinson; src: url("fonts/atkinson-400.woff2") format("woff2"); font-weight: 400; }
@font-face { font-family: Atkinson; src: url("fonts/atkinson-700.woff2") format("woff2"); font-weight: 700; }
:root {
  --bg: #12161a; --raise: #1b2127; --ink: #f3efe6; --muted: #c9c3b6;
  --line: #3a434d; --slate: #8e9aa8; --slate-text: #a9b4c1; --slate-2: #6f7c8b; --green: #d2ee9a;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
@page { size: 8.5in 11in; margin: 0; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { width: %(w)dpx; height: %(h)dpx; overflow: hidden; }
body {
  background: var(--bg); color: var(--ink);
  font-family: Atkinson, sans-serif; -webkit-font-smoothing: antialiased;
  position: relative;
}
.display { font-family: Fraunces, serif; font-weight: 500; letter-spacing: -0.012em; color: var(--ink); }
.muted { color: var(--muted); }
.abs { position: absolute; }
.console {
  font-family: Atkinson, sans-serif; color: var(--muted);
  background: var(--raise); border-left: 4px solid var(--slate-2);
  display: inline-block; white-space: nowrap;
}
.console b { color: var(--ink); font-weight: 700; }
.glow { position: absolute; border-radius: 50%%;
  background: radial-gradient(closest-side, rgba(120, 140, 162, 0.16), rgba(120, 140, 162, 0.05) 55%%, transparent); }
.num { font-family: Fraunces, serif; font-weight: 500; color: var(--slate-text); font-variant-numeric: lining-nums; }
"""


def mark(height, light=False, cls="", style=""):
    pad = 0
    w = (HX1 - HX0) * height / (HY1 - HY0)
    body = S["mark_light"] if light else S["mark"]
    return (f'<svg class="{cls}" style="{style}" width="{w:.1f}" height="{height}" '
            f'viewBox="{HX0 - pad} {HY0 - pad} {HX1 - HX0 + 2 * pad} {HY1 - HY0 + 2 * pad}" aria-hidden="true">{body}</svg>')


def mark_w(height):
    return (HX1 - HX0) * height / (HY1 - HY0)


def wordmark(xheight_px, color="#f3efe6", cls="", style=""):
    """Size the outlined wordmark by its ascender-to-baseline height in px."""
    asc = -BY0
    s = xheight_px / asc
    w = (BX1 - BX0) * s
    h = (BY1 - BY0) * s
    return (f'<svg class="{cls}" style="{style}" width="{w:.1f}" height="{h:.1f}" '
            f'viewBox="{BX0} {BY0} {BX1 - BX0} {BY1 - BY0}" role="img" aria-label="blunix">'
            f'<path fill="{color}" d="{S["wordmark_d"]}"/></svg>')


def lockup(height, color="#f3efe6", light=False, style=""):
    """Horizontal lockup; height = mark height."""
    L = S["lockup"]
    asc_px = height / 1.30
    gap = height * 0.30
    return (f'<div style="display:flex;align-items:flex-start;gap:{gap:.1f}px;{style}">'
            f'{mark(height, light)}'
            f'<div style="padding-top:{asc_px * 0.20:.1f}px">{wordmark(asc_px, color)}</div></div>')


def page(name, w, h, body, title):
    html = (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{title}</title>'
            f'<style>{CSS % dict(w=w, h=h)}</style></head><body>{body}</body></html>')
    with open(os.path.join(SRC, name), "w") as f:
        f.write(html)
    return name


CONSOLE = '<b>blunix:</b> hostname ada.blnx.io. Say yes to keep it.'
TAG1 = "A quiet Debian host for cloud nodes."
TAG2 = "Small by default. Signed when it boots. Able to speak, if you ask it to, before it asks you anything."
INSTALL = "TLS proves the hostname is ours. The key proves the file is yours."
PILLARS = [
    ("Debian, held still",
     "Packages come from Debian stable. An update is a new signed image, and the previous one still boots."),
    ("A shell when it is sick",
     "A default set small enough to read on one screen. Root stays available for a person who has to see why a node failed."),
    ("Speech before questions",
     "Five numbered boot entries. Speech starts after the kernel, so a blind operator can answer the install prompts."),
]


def og():
    mh = 400
    body = f"""
<div class="glow" style="left:690px;top:-10px;width:640px;height:640px"></div>
{mark(mh, cls="abs", style=f"right:92px;top:{(630 - mh) / 2 + 4}px")}
{wordmark(46, cls="abs", style="left:80px;top:74px")}
<h1 class="display abs" style="left:80px;top:188px;font-size:66px;line-height:1.08;width:640px">A quiet Debian host for cloud nodes.</h1>
<p class="abs muted" style="left:80px;top:352px;font-size:27px;line-height:1.42;width:600px">Small by default. Signed when it boots. Able to speak, if you ask it to, before it asks you anything.</p>
<div class="console abs" style="left:80px;bottom:72px;font-size:23px;padding:13px 20px">{CONSOLE}</div>
"""
    return page("og-image.html", 1200, 630, body, "Blunix social card")


def github():
    mh = 236
    body = f"""
<div class="glow" style="left:340px;top:-150px;width:600px;height:600px"></div>
<div class="abs" style="left:0;right:0;top:64px;display:flex;flex-direction:column;align-items:center">
  {mark(mh)}
  <div style="height:34px"></div>
  {wordmark(62)}
  <p class="muted" style="margin-top:28px;font-size:29px;line-height:1.4;text-align:center;width:980px">A quiet, signed Debian host for cloud nodes and bare metal.<br>Speech, braille, and large print at the boot console.</p>
</div>
<div class="abs" style="left:0;right:0;bottom:56px;display:flex;justify-content:center;gap:52px;font-size:23px">
  {''.join(f'<span><span class="num" style="margin-right:12px">0{i + 1}</span>{t}</span>' for i, (t, _) in enumerate(PILLARS))}
</div>
"""
    return page("github-social.html", 1280, 640, body, "Blunix repository preview")


def xheader():
    mh = 360
    body = f"""
<div class="glow" style="left:980px;top:-150px;width:720px;height:720px"></div>
{mark(mh, cls="abs", style=f"right:150px;top:{(500 - mh) / 2 + 2}px")}
<div class="abs" style="left:470px;top:118px;width:600px">
  <h1 class="display" style="font-size:60px;line-height:1.08">Speech before<br>questions.</h1>
  <div class="console" style="margin-top:34px;font-size:23px;padding:12px 18px">{CONSOLE}</div>
</div>
"""
    return page("x-header.html", 1500, 500, body, "Blunix header")


def linkedin():
    mh = 280
    body = f"""
<div class="glow" style="left:1080px;top:-200px;width:640px;height:640px"></div>
{mark(mh, cls="abs", style=f"right:120px;top:{(396 - mh) / 2 + 2}px")}
<div class="abs" style="left:600px;top:112px;width:560px">
  {wordmark(58)}
  <p class="muted" style="margin-top:22px;font-size:28px;line-height:1.4">A quiet Debian host for cloud nodes.<br>Small by default. Signed when it boots.</p>
</div>
"""
    return page("linkedin-banner.html", 1584, 396, body, "Blunix banner")


def square():
    body = f"""
<div class="glow" style="left:560px;top:-260px;width:820px;height:820px"></div>
{mark(150, cls="abs", style="right:88px;top:88px")}
<div class="abs" style="left:88px;top:92px">
  <div class="num" style="font-size:34px">03</div>
  <h1 class="display" style="margin-top:14px;font-size:104px;line-height:1.0">Speech<br>before<br>questions.</h1>
</div>
<div class="abs" style="left:88px;top:520px;right:88px">
  <div style="background:var(--raise);border-left:6px solid var(--slate-2);padding:30px 36px;font-size:44px;line-height:1.36;color:var(--muted)">
    <div><b style="color:var(--ink)">blunix:</b> hostname ada.blnx.io.</div>
    <div>Say yes to keep it.</div>
    <div style="color:var(--ink);font-weight:700">yes</div>
  </div>
  <p class="muted" style="margin-top:40px;font-size:30px;line-height:1.45">The boot menu is five numbered entries. Speech starts after the kernel, so a blind operator can answer the install prompts.</p>
</div>
{wordmark(40, cls="abs", style="left:88px;bottom:84px")}
<div class="abs muted" style="right:88px;bottom:82px;font-size:26px">blunix.io</div>
"""
    return page("square-1080.html", 1080, 1080, body, "Speech before questions")


def portrait():
    items = "".join(f"""
  <div style="display:grid;grid-template-columns:92px 1fr;padding:44px 0;border-top:2px solid var(--line)">
    <div class="num" style="font-size:44px;line-height:1.1">0{i + 1}</div>
    <div>
      <h2 class="display" style="font-size:52px;line-height:1.1">{t}</h2>
      <p class="muted" style="margin-top:16px;font-size:29px;line-height:1.45">{b}</p>
    </div>
  </div>""" for i, (t, b) in enumerate(PILLARS))
    body = f"""
<div class="glow" style="left:520px;top:-300px;width:860px;height:860px"></div>
<div class="abs" style="left:88px;right:88px;top:88px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    {wordmark(46)}
    {mark(110)}
  </div>
  <h1 class="display" style="margin-top:34px;font-size:72px;line-height:1.06;width:820px">A quiet Debian host,<br>in three rules.</h1>
  <div style="margin-top:52px">{items}</div>
</div>
<div class="abs muted" style="left:88px;bottom:80px;font-size:26px">blunix.io</div>
"""
    return page("portrait-1080x1350.html", 1080, 1350, body, "Blunix pillars")


def slide():
    mh = 560
    body = f"""
<div class="glow" style="left:60px;top:40px;width:1000px;height:1000px"></div>
{mark(mh, cls="abs", style=f"left:{560 - mark_w(mh) / 2:.0f}px;top:{(1080 - mh) / 2 + 4}px")}
<div class="abs" style="left:1000px;top:268px;width:800px">
  {wordmark(92)}
  <h1 class="display" style="margin-top:48px;font-size:68px;line-height:1.08">A quiet Debian host<br>for cloud nodes.</h1>
  <p class="muted" style="margin-top:30px;font-size:34px;line-height:1.45;width:760px">Small by default. Signed when it boots. Able to speak, if you ask it to, before it asks you anything.</p>
  <div style="margin-top:48px;border-top:2px solid var(--line);padding-top:30px;font-size:30px;line-height:1.45;color:var(--ink);width:780px">TLS proves the hostname is ours.<br>The key proves the file is yours.</div>
</div>
"""
    return page("slide-1920x1080.html", 1920, 1080, body, "Blunix")


def poster():
    steps = [
        ("Say the hostname", '<b>blunix:</b> hostname ada.blnx.io. Say yes to keep it.',
         "It reads the name back and waits. Silence does not fetch."),
        ("Type the key", '<b>blunix:</b> key',
         "Echo is off. Never spoken, never sent to the server. The file decrypts on the box."),
        ("It builds", None,
         "Disk, network, access profile, pinned tools. Unknown fields and shell scripts are refused."),
    ]
    step_html = "".join(f"""
    <div style="position:relative;padding:16px 0 0;border-top:2px solid var(--line)">
      <div style="display:flex;align-items:baseline;gap:10px">
        <span class="num" style="font-size:26px">{i + 1}</span>
        <h3 class="display" style="font-size:22px;line-height:1.2">{t}</h3>
      </div>
      {f'<div class="console" style="margin-top:10px;font-size:16px;line-height:1.4;padding:7px 11px;white-space:normal">{c}</div>' if c else ''}
      <p class="muted" style="margin-top:9px;font-size:16px;line-height:1.45">{b}</p>
      {'<div aria-hidden="true" style="position:absolute;right:-22px;top:12px;font-size:24px;color:var(--slate-text)">&rarr;</div>' if i < 2 else ''}
    </div>""" for i, (t, c, b) in enumerate(steps))
    pillars = "".join(f"""
    <div>
      <div class="num" style="font-size:22px">0{i + 1}</div>
      <h3 class="display" style="margin-top:4px;font-size:22px;line-height:1.18">{t}</h3>
      <p class="muted" style="margin-top:8px;font-size:16px;line-height:1.45">{b}</p>
    </div>""" for i, (t, b) in enumerate(PILLARS))
    body = f"""
<div class="glow" style="left:380px;top:-240px;width:640px;height:640px"></div>
<div class="abs" style="left:56px;right:56px;top:52px">
  <div style="display:flex;justify-content:space-between;align-items:center">
    {lockup(58)}
    <div class="muted" style="font-size:18px">blunix.io</div>
  </div>
  <h1 class="display" style="margin-top:40px;font-size:46px;line-height:1.08;width:704px">A quiet Debian host for cloud nodes and bare metal.</h1>
  <p class="muted" style="margin-top:16px;font-size:18px;line-height:1.5;width:680px">Small by default. Signed when it boots. Able to speak, if you ask it to, before it asks you anything. Designed from the start for blind and low-vision operators: speech, braille, and large print at the boot console.</p>
  <div style="margin-top:28px;display:grid;grid-template-columns:repeat(3,1fr);gap:36px">{pillars}</div>
  <h2 class="display" style="margin-top:34px;font-size:28px">Two prompts, then it builds.</h2>
  <div style="margin-top:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:36px">{step_html}</div>
  <div style="margin-top:22px;border-top:2px solid var(--line);padding-top:16px;font-size:19px;line-height:1.45;color:var(--ink)">{INSTALL}</div>
</div>
<div class="abs muted" style="left:56px;right:56px;bottom:34px;font-size:14px;line-height:1.4">blunix.io is this project. blunix.com is Blunix GmbH in Berlin, a different company.</div>
"""
    return page("one-sheet.html", 816, 1056, body, "Blunix one-sheet")


if __name__ == "__main__":
    for fn in (og, github, xheader, linkedin, square, portrait, slide, poster):
        print(fn())
