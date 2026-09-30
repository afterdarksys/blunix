from contrast import cr
B="/Users/ryan/development/blunix-idea/brand"
sw=[("Night","#12161a","Background"),("Raise","#1b2127","Raised panels, console strip"),("Ink","#f3efe6","Primary text; light surface"),
    ("Muted","#c9c3b6","Secondary text"),("Slate text","#a9b4c1","Numerals, labels"),("Slate","#8e9aa8","Mark, lit half (not for text)"),
    ("Slate deep","#6f7c8b","Mark, shaded half; rules"),("Line","#3a434d","Decorative rules only"),("Eye green","#d2ee9a","The eyes. Nothing else in the mark.")]
def swatch(n,h,u):
    c1=cr(h,"#12161a"); c2=cr(h,"#f3efe6")
    fg="#12161a" if c2<c1 and False else ("#12161a" if cr("#12161a",h)>cr("#f3efe6",h) else "#f3efe6")
    return f'''<div class="sw"><div class="chip" style="background:{h};color:{fg}">{n}</div><div class="meta"><b>{h}</b><br>{u}<br><span>on Night {c1:.2f}:1 · on Ink {c2:.2f}:1</span></div></div>'''
promos=[("og-image.png","og-image.png · 1200×630"),("github-social.png","github-social.png · 1280×640"),("x-header.png","x-header.png · 1500×500"),
("linkedin-banner.png","linkedin-banner.png · 1584×396"),("square-1080.png","square-1080.png · 1080×1080"),("portrait-1080x1350.png","portrait-1080x1350.png · 1080×1350"),
("slide-1920x1080.png","slide-1920x1080.png · 1920×1080"),("one-sheet-preview.png","one-sheet.pdf · US Letter")]
html=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Blunix brand sheet</title><style>
@font-face{{font-family:Fraunces;src:url("src/fonts/fraunces-latin.woff2") format("woff2");font-weight:100 900}}
@font-face{{font-family:Atkinson;src:url("src/fonts/atkinson-400.woff2") format("woff2");font-weight:400}}
@font-face{{font-family:Atkinson;src:url("src/fonts/atkinson-700.woff2") format("woff2");font-weight:700}}
:root{{--bg:#12161a;--raise:#1b2127;--ink:#f3efe6;--muted:#c9c3b6;--line:#3a434d;--st:#a9b4c1}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:var(--bg);color:var(--ink);font:400 20px/1.5 Atkinson,sans-serif;-webkit-font-smoothing:antialiased;width:1600px}}
main{{padding:80px 96px 96px}}
h1{{font:500 72px/1.05 Fraunces,serif;letter-spacing:-.012em}}
h2{{font:500 40px/1.1 Fraunces,serif;margin:0 0 28px;padding-top:56px;border-top:2px solid var(--line);margin-top:64px}}
h3{{font-weight:700;font-size:20px;margin-bottom:10px}}
p,.m{{color:var(--muted)}}
.n{{font:500 22px Fraunces,serif;color:var(--st)}}
.row{{display:flex;gap:28px;align-items:stretch;flex-wrap:wrap}}
.card{{border-radius:14px;padding:40px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px}}
.dark{{background:var(--raise)}} .light{{background:#f3efe6;color:#12161a}}
.cap{{font-size:19px;color:var(--muted)}} .light .cap{{color:#3d4650}}
.sw{{width:440px;display:flex;gap:18px;align-items:center}}
.chip{{width:150px;height:96px;border-radius:10px;display:flex;align-items:flex-end;padding:10px 12px;font-weight:700;font-size:17px;border:2px solid var(--line)}}
.meta{{font-size:17px;line-height:1.4;color:var(--muted)}} .meta b{{color:var(--ink);font-size:19px}} .meta span{{color:var(--st)}}
.grid2{{display:grid;grid-template-columns:1fr 1fr;gap:28px}}
.promo img{{width:100%;display:block;border-radius:8px;border:2px solid var(--line)}} .promo .cap{{margin-top:8px}}
.dd{{display:grid;grid-template-columns:1fr 1fr;gap:28px}} .dd ul{{padding-left:22px;color:var(--muted)}} .dd li{{margin:6px 0}}
</style></head><body><main>
<div class="row" style="justify-content:space-between;align-items:center"><img src="logo-horizontal.svg" alt="blunix" style="height:96px"><div class="m">Brand sheet</div></div>
<h1 style="margin-top:64px;max-width:1100px">A quiet Debian host. A small, watchful mark.</h1>
<p style="margin-top:20px;max-width:1000px;font-size:23px">A geometric head that also reads as a shield: split per pale into a lit and a shaded half, ears as the only points, and two green almond eyes with slit pupils as the single colour accent. The symbol carries no letters, so it survives a rename.</p>

<h2>Mark</h2>
<div class="grid2">
<div class="card dark" style="height:460px"><img src="logo-mark.svg" alt="" style="height:340px"><div class="cap">logo-mark.svg · on dark</div></div>
<div class="card light" style="height:460px"><img src="logo-mark-on-light.svg" alt="" style="height:340px"><div class="cap">logo-mark-on-light.svg · on light</div></div>
</div>
<div class="row" style="margin-top:28px">
<div class="card dark" style="flex:1"><div class="row" style="align-items:flex-end;gap:24px"><img src="logo-mark-mono-light.svg" style="height:120px"><img src="logo-mark-mono-light.svg" style="height:48px"><img src="logo-mark-mono-light.svg" style="height:24px"><img src="logo-mark-mono-light.svg" style="height:16px"></div><div class="cap">logo-mark-mono-light.svg · 120 / 48 / 24 / 16 px</div></div>
<div class="card light" style="flex:1"><div class="row" style="align-items:flex-end;gap:24px"><img src="logo-mark-mono-dark.svg" style="height:120px"><img src="logo-mark-mono-dark.svg" style="height:48px"><img src="logo-mark-mono-dark.svg" style="height:24px"><img src="logo-mark-mono-dark.svg" style="height:16px"></div><div class="cap">logo-mark-mono-dark.svg · 120 / 48 / 24 / 16 px</div></div>
</div>

<h2>Lockups</h2>
<div class="grid2">
<div class="card dark"><img src="logo-horizontal.svg" style="height:110px"><div class="cap">logo-horizontal.svg</div></div>
<div class="card light"><img src="logo-horizontal-on-light.svg" style="height:110px"><div class="cap">logo-horizontal-on-light.svg</div></div>
<div class="card dark"><img src="logo-stacked.svg" style="height:250px"><div class="cap">logo-stacked.svg</div></div>
<div class="card light"><img src="logo-stacked-on-light.svg" style="height:250px"><div class="cap">logo-stacked-on-light.svg</div></div>
</div>
<div class="grid2" style="margin-top:28px">
<div class="card dark" style="position:relative"><div style="position:relative;padding:0"><img src="logo-horizontal.svg" style="height:110px;display:block;outline:2px dashed #6f7c8b"></div><div class="cap">Clear space: the file bounds. Keep a quarter of the mark height free on every side.</div></div>
<div class="card dark"><div class="row" style="align-items:center;gap:40px"><img src="logo-horizontal.svg" style="height:40px"><img src="logo-mark.svg" style="height:24px"></div><div class="cap">Minimum: lockup 24 px mark height (about 40 px file height) · mark 16 px; below 32 px use the icon tiles</div></div>
</div>

<h2>Wordmark</h2>
<img src="wordmark-options.png" alt="Three wordmark options compared; option A, Fraunces 600 lowercase, chosen" style="width:100%;border-radius:12px;border:2px solid var(--line)">

<h2>Colour</h2>
<div class="row" style="gap:28px 36px">{''.join(swatch(*s) for s in sw)}</div>
<p style="margin-top:28px">Text uses Ink, Muted, or Slate text only: every pair is 7:1 or better on Night and on Raise. Slate and Slate deep are shape colours (over 3:1 against Night) and never carry words. Green stays in the eyes.</p>

<h2>Type</h2>
<div class="grid2">
<div class="card dark" style="align-items:flex-start"><div style="font:500 64px/1.05 Fraunces,serif">Speech before questions.</div><div class="cap">Fraunces 500–600 · display, headlines, numerals · -1.2% tracking</div></div>
<div class="card dark" style="align-items:flex-start"><div style="font-size:26px;line-height:1.45">The boot menu is five numbered entries. <b>blunix:</b> hostname ada.blnx.io. Say yes to keep it.</div><div class="cap">Atkinson Hyperlegible 400 / 700 · body, UI, console lines · 20 px minimum on screen graphics</div></div>
</div>

<h2>Icons</h2>
<div class="card dark"><div class="row" style="align-items:flex-end;gap:40px">
<img src="icon-512.png" style="width:192px"><img src="maskable-512.png" style="width:192px;border-radius:50%"><img src="apple-touch-icon.png" style="width:120px;border-radius:26px"><img src="icon-192.png" style="width:96px"><img src="favicon-32.png" style="width:32px;height:32px"><img src="favicon-16.png" style="width:16px;height:16px"></div>
<div class="cap">icon-512 · maskable-512 (shown in a circle mask) · apple-touch-icon · icon-192 · favicon-32 · favicon-16 (drawn with larger eyes, no pupils)</div></div>

<h2>Promotional</h2>
<div class="grid2">{''.join(f'<div class="promo"><img src="promo/{f}" alt=""><div class="cap">{c}</div></div>' for f,c in promos)}</div>

<h2>Do and don't</h2>
<div class="dd"><div><h3>Do</h3><ul><li>Put the mark on Night, Raise, or Ink.</li><li>Use the mono files for one-colour print, stamps, and etching.</li><li>Set all running text in Atkinson Hyperlegible, 20 px or larger in graphics.</li><li>Leave space. One idea per graphic.</li></ul></div>
<div><h3>Don't</h3><ul><li>Recolour the head, add gradients, glows, or outlines to the mark.</li><li>Use green anywhere else in the mark, or for body text.</li><li>Set text over the mark or over any image.</li><li>Write "cat" or "Russian" in public copy. Retype the wordmark in a live font.</li></ul></div></div>
</main></body></html>'''
open(f"{B}/brand-sheet.html","w").write(html)
