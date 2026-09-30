# Blunix brand

A quiet, watchful mark for a quiet Debian host. See `brand-sheet.html` (or `brand-sheet.png`) for everything on one page.

## The mark

A geometric head that also reads as a shield. It is split down the middle ("per pale") into a lit half and a shaded half. The ears are the only points. The two green almond eyes with slit pupils are the single colour accent. The symbol has no letters in it, so it still works if the product is renamed. It is a Russian Blue. As of 2026-09-29 the cat is the public theme: name it, tell the story, keep the tone editorial.

- Built from vector geometry (`src/tools/geom.py`), filleted with boolean path ops. It is not traced.
- Optical sizes: the master is for 48 px and up. `favicon.svg` and the 32 px tile use larger eyes. The 16 px favicon drops the pupils and uses bigger rimmed eyes so the green still reads.
- `mark.jpg` (the painted portrait) stays as an illustration. It is not the logo.

## Colour

Contrast is WCAG 2.x relative luminance, computed by `src/tools/contrast.py`.

| Token | Hex | Role | on Night #12161a | on Raise #1b2127 | on Ink #f3efe6 |
|---|---|---|---|---|---|
| Night | `#12161a` | Background | — | 1.12 | 15.84 |
| Raise | `#1b2127` | Panels, console strip | 1.12 | — | 14.15 |
| Ink | `#f3efe6` | Primary text; light surface | **15.84** | **14.15** | — |
| Muted | `#c9c3b6` | Secondary text | **10.36** | **9.25** | 1.53 |
| Slate text | `#a9b4c1` | Numerals, labels | **8.64** | **7.72** | 1.83 |
| Slate | `#8e9aa8` | Mark, lit half (dark bg). Never text. | 6.35 | 5.67 | 2.49 |
| Slate deep | `#6f7c8b` | Mark, shaded half (dark bg); lit half (light bg); console rule | 4.27 | 3.81 | 3.71 |
| Slate night | `#56626f` | Mark, shaded half (light bg) | 2.92 | 2.61 | 5.43 |
| Line | `#3a434d` | Decorative rules only | 1.81 | 1.62 | 8.76 |
| Eye green | `#d2ee9a` | The eyes. Nothing else in the mark. | 14.23 | 12.71 | 1.11 |
| Caption on light | `#3d4650` | Small text on Ink | — | — | **8.36** |

Rules:
- Text is only Ink, Muted, or Slate text on Night or Raise, or Night / `#3d4650` on Ink. Every text pair is 7:1 or better. The worst case is Slate text on the brightest point of the background glow (`#22292f`), which measures 7.00:1. Never set Slate-text numerals inside a glow.
- The Slate tones are shape colours only. They are at least 3:1 against their background and never carry words.
- Green is the eyes. The website may use it for focus and links, but graphics do not.
- No hairlines carry meaning. Rules are 2 px or more and only decorate.

## Type

- **Wordmark:** Fraunces 600, lowercase `blunix`, tracking −1.2%, outlined to paths. Never retype it in a live font.
- **Display:** Fraunces 500 for headlines and numerals, tracking −1.2%.
- **Body, UI, console lines:** Atkinson Hyperlegible 400/700. Use at least 20 px in screen graphics and 16 px in print. Console lines are set in Atkinson, not a monospace, because the boot console is large print.
- Fonts are in `src/fonts/` (SIL OFL; licences included).

### Why Fraunces for the wordmark (`wordmark-options.png`)
- **A, Fraunces 600 lowercase (chosen):** it matches the site's display face. The stroke is heavy enough for low vision, and the soft wedge serifs give the calm, held-still tone. Lowercase keeps it from reading as a corporate caps logo.
- **B, Atkinson Bold lowercase:** the most legible and the most on-message, but it is the body voice, so the name would not stand apart from the text around it. It reads generic as a mark.
- **C, Atkinson Bold caps, tracked:** sturdy but loud. Caps also sit closer to Blunix GmbH's identity, which this project needs distance from.

## Clear space and minimum size

- Clear space is a quarter of the mark height on every side. The lockup SVGs already include it in their bounds, so do not crop them.
- The minimum horizontal lockup is 24 px mark height (about 40 px file height).
- The minimum mark is 16 px, using `logo-mark-mono-*.svg`. The full-colour mark is 24 px minimum. Below 32 px, use the icon tiles.

## Do / don't

Do: put the mark on Night, Raise, or Ink. Use the mono files for one-colour print, stamps, and etching. Leave space and give each graphic one idea.

Don't: recolour the head, or add gradients, glows, strokes, or shadows to the mark. Don't put green anywhere else in the mark. Don't set text over the mark or over images. Don't overdo the cat: no emoji walls, no paw-print clutter, no puns in status sentences. Don't stretch, rotate, or re-space the wordmark.

## File index

Logo (SVG, outlined, no font dependency):

| File | Use |
|---|---|
| `logo-mark.svg` | Full-colour mark, transparent, for dark backgrounds (372×446 viewBox) |
| `logo-mark-on-light.svg` | Full-colour mark with darker slate tones, for light backgrounds |
| `logo-mark-mono-light.svg` | Single colour Ink `#f3efe6`, for dark backgrounds; works at 16 px |
| `logo-mark-mono-dark.svg` | Single colour Night `#12161a`, for light backgrounds; works at 16 px |
| `logo-horizontal.svg` / `logo-horizontal-on-light.svg` | Mark and wordmark side by side (913×290) |
| `logo-stacked.svg` / `logo-stacked-on-light.svg` | Mark above the wordmark (722×651) |
| `wordmark.svg` / `wordmark-on-light.svg` | Wordmark alone (621×175) |
| `wordmark-v0.svg` | Previous Georgia italic wordmark, kept for reference |
| `favicon.svg` | Night tile with the small-optical mark, 512 viewBox |

Icons (PNG): `favicon-16.png` 16×16, `favicon-32.png` 32×32, `apple-touch-icon.png` 180×180 (opaque, square; iOS rounds it), `icon-192.png` 192×192 and `icon-512.png` 512×512 (rounded tile, transparent corners), `maskable-512.png` 512×512 (opaque, mark inside the 80% safe zone).

Suggested head tags:
```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="icon" href="/favicon-16.png" sizes="16x16">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:image" content="https://blunix.io/og-image.png">
```

Promotional (`promo/`):

| File | Size |
|---|---|
| `og-image.png` | 1200×630, site social card |
| `github-social.png` | 1280×640, repo preview |
| `x-header.png` | 1500×500; the bottom-left avatar area is left empty |
| `linkedin-banner.png` | 1584×396; the left avatar area is left empty |
| `square-1080.png` | 1080×1080, "Speech before questions" |
| `portrait-1080x1350.png` | 1080×1350, the three pillars |
| `slide-1920x1080.png` | 1920×1080, hero / title slide |
| `one-sheet.pdf` | US Letter, one page: what it is, pillars, and the install flow (hostname → key → it builds) |
| `one-sheet-preview.png` | 1632×2112 (2×) render of the one-sheet |

Sheets: `brand-sheet.html` and `brand-sheet.png` (1600×8299), `wordmark-options.png` (1400×700).

Sources (`src/`): an HTML source for every promo graphic (open it in a browser; fonts load from `src/fonts/`), `icons/_tile-*.svg` (icon masters), and `tools/` (the Python generators: `geom.py` mark geometry, `outline.py` HarfBuzz text-to-path, `build.py` logo files, `promo.py` promo HTML, `options.py`, `sheet.py`, `contrast.py`, plus Chrome headless render scripts). The generators expect a working directory holding decompressed `.ttf` copies of the fonts and `out/` / `png/` folders. They need `fonttools`, `brotli`, `skia-pathops`, and `uharfbuzz`.
