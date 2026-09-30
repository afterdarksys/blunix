import json
from outline import text_path
S=json.load(open("out/_snippets.json")); HX0,HY0,HX1,HY1=S["head_bounds"]
def mark(h):
    w=(HX1-HX0)*h/(HY1-HY0); return f'<svg width="{w:.1f}" height="{h}" viewBox="{HX0} {HY0} {HX1-HX0} {HY1-HY0}" aria-hidden="true">{S["mark"]}</svg>'
opts=[("A","Fraunces 600, lowercase, -1.2% tracking","fraunces",600,"blunix",-0.012,True,
 "Matches the site's display face. Heavy enough stroke for low vision; soft wedge serifs give the quiet, held-still tone. Lowercase keeps it from reading as a corporate caps logo."),
("B","Atkinson Hyperlegible Bold, lowercase","atkinson-bold",None,"blunix",0.0,False,
 "Most legible and on-message for accessibility, but generic as a mark; it is the body voice, so the wordmark would not stand apart from the text around it."),
("C","Atkinson Hyperlegible Bold, caps, +12% tracking","atkinson-bold",None,"BLUNIX",0.12,False,
 "Institutional and sturdy, but loud. Caps also sit closer to Blunix GmbH's own identity, which the project needs distance from.")]
rows=""
for k,label,f,w,t,tr,chosen,why in opts:
    d,adv,(x0,y0,x1,y1)=text_path(t,f,100,wght=w,tracking=tr)
    s=64/(-y0)
    wm=f'<svg width="{(x1-x0)*s:.0f}" height="{(y1-y0)*s:.0f}" viewBox="{x0} {y0} {x1-x0} {y1-y0}"><path fill="#f3efe6" d="{d}"/></svg>'
    rows+=f'''<section style="display:grid;grid-template-columns:60px 430px 1fr;gap:28px;align-items:center;padding:34px 0;border-top:2px solid #3a434d">
<div style="font:500 40px Fraunces;color:{'#f3efe6' if chosen else '#a9b4c1'}">{k}</div>
<div style="display:flex;gap:20px;align-items:flex-end">{mark(84)}{wm}</div>
<div><div style="font-weight:700;font-size:22px">{label}{' &nbsp;(chosen)' if chosen else ''}</div><p style="color:#c9c3b6;font-size:20px;line-height:1.45;margin-top:8px">{why}</p></div></section>'''
css=open("promo.py").read().split('CSS = """')[1].split('"""')[0] % dict(w=1400,h=780)
open("src/wordmark-options.html","w").write(f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Wordmark options</title><style>{css}</style></head><body><div style="padding:56px 64px"><h1 class="display" style="font-size:44px;margin-bottom:28px">Wordmark options</h1>{rows}</div></body></html>')
