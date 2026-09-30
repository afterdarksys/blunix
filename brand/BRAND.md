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

## Mascot: Blubie, the Blunix cat

Blubie is the Blunix cat, a Russian Blue, drawn in Blunix's own flat editorial vector style. It is the same cat as the mark's head: slate coat, green eyes, nothing loud. In alt text, say "Blubie, the Blunix cat" the first time on a page and "Blubie" after that.

### Identity lock

The one source of truth is `mascot/prompts.json` (versioned, with a dated drift log). Every scene prompt is the scene text plus the same `identity` and `style_lock`.

- A Russian Blue. One solid, even silver-blue-grey coat. No white patches, no bib, no stripes, not a tabby, not black, not a hairless Sphynx.
- Lime-green almond eyes with thin dark pupils. Never white or grey eyes.
- Slender, upright, elegant. Large wide-set pointed ears. Dark slate nose. Calm and faintly amused.
- A real cat on four legs. No clothing, no collar, no accessories.
- Style: Recraft V3 `vector_illustration/segmented_colors`, true SVG output. Flat colour fields and fine linework.
- `mascot/finish.py` locks the palette after generation. It drops the background and any backdrop panel touching three canvas edges (so the art sits on Night with no box), then snaps every colour to the slate ramp (`#12161a` to `#c9d0d8`, the mark's own `#8e9aa8` / `#6f7c8b` / `#56626f` in the middle). Green (`#d2ee9a`, `#8fae5c`) survives only on small shapes: eyes and indicator lights. Ink survives only on glints.

### Do / don't

Do: use one scene per page, next to the text it illustrates. Keep art on Night or Raise. Give every meaningful image real alt text; spot art beside a labelled list item is decorative (`alt=""`). Set `width`, `height`, and `decoding="async"`; use `loading="lazy"` below the fold.

Don't: put words, numbers, or UI text inside an illustration (screens and scrolls stay blank). Don't recolour the cat, add green outside the eyes and small lights, or add glows and drop shadows. Don't use the art in place of the logo mark: the mark stays in the header. Don't stack several cats on one screen outside the gallery. No speech bubbles, no puns in status text.

### Pipeline

1. `python3 mascot/generate.py [ids]`: reads `prompts.json`, writes candidates to `mascot/raw/<id>-<n>.svg`, and records model, style, prompt and time in `mascot/provenance.json` (no key; Recraft returns no seed). It skips files that exist: delete a file to re-roll it, or raise the scene's `n`. The fal.ai key is read at run time from the env file in `$BLUNIX_FAL_ENV`, and only ever sent as the `Authorization` header.
2. Review every candidate on Night, then record the pick in `mascot/picks.json`.
3. `mascot/export.sh`: runs `finish.py` on each pick, optimises with svgo, writes `mascot/final/` and copies the files to `site/assets/cat/` (and the portal's two to `portal/assets/cat/`).
4. `mascot/sheet.sh`: renders `mascot/mascot-sheet.png`.

### File index

| File | Source | Size | Used on |
|---|---|---|---|
| `mascot/final/hero.svg` | `raw/hero-2.svg` | 33 KB | Home hero, beside the headline (the header keeps the logo mark) |
| `mascot/final/quiet.svg` | `raw/quiet-1.svg` | 20 KB | Home, "Quiet by default" trait spot |
| `mascot/final/held-still.svg` | `raw/held-still-3.svg` | 12 KB | Home, "Debian, held still" rule |
| `mascot/final/shell.svg` | `raw/shell-2.svg` | 12 KB | Home, "A shell when it is sick" rule; Service hero |
| `mascot/final/speech.svg` | `raw/speech-3.svg` | 12 KB | Home, "Speech before questions" rule; Access hero |
| `mascot/final/lands-on-feet.svg` | `raw/lands-on-feet-2.svg` | 11 KB | Home, "Lands on its feet" trait spot |
| `mascot/final/install.svg` | `raw/install-3.svg` | 16 KB | Install hero |
| `mascot/final/key.svg` | `raw/key-4.svg` | 15 KB | Account hero |
| `mascot/final/log.svg` | `raw/log-2.svg` | 18 KB | Log hero |
| `mascot/final/proxy.svg` | `raw/proxy-3.svg` | 21 KB | Platform hero |
| `mascot/final/404.svg` | `raw/404-1.svg` | 12 KB | Site 404 and portal 404 |
| `mascot/final/empty-basket.svg` | `raw/empty-basket-4.svg` | 61 KB | Portal, empty hostnames state |
| `mascot/final/sticker-sit.svg` | `raw/sticker-sit-1.svg` | 22 KB | Home, "Small footprint" trait spot |
| `mascot/final/sticker-paw.svg` | `raw/sticker-paw-3.svg` | 16 KB | Home, "Speaks when you ask" trait spot |
| `mascot/final/sticker-stretch.svg` | `raw/sticker-stretch-2.svg` | 14 KB | Home, "Nine lives" trait spot |
| `mascot/final/sticker-sleep.svg` | `raw/sticker-sleep-1.svg` | 10 KB | Spare spot (empty states, social) |
| `mascot/final/gallery/at-computer.svg` | `raw/at-computer-4.svg` | 13 KB | Home, "Blubie at work" gallery |
| `mascot/final/gallery/debugging.svg` | `raw/debugging-3.svg` | 11 KB | Home, "Blubie at work" gallery |
| `mascot/final/gallery/cloud.svg` | `raw/cloud-2.svg` | 18 KB | Home, "Blubie at work" gallery |
| `mascot/final/gallery/packing.svg` | `raw/packing-2.svg` | 9 KB | Home, "Blubie at work" gallery |
| `mascot/final/gallery/stargazing.svg` | `raw/stargazing-2.svg` | 33 KB | Home, "Blubie at work" gallery |
| `mascot/final/sticker-peek.svg` | `raw/sticker-peek-5.svg` | 12 KB | Home, "Watchful" trait spot |
| `mascot/final/gallery/reading-docs.svg` | `raw/reading-docs-4.svg` | 14 KB | Home, "Blubie at work" gallery |
| `mascot/final/gallery/braille.svg` | `raw/braille-8.svg` | 41 KB | Home, "Blubie at work" gallery |
| `mascot/final/gallery/coffee-no.svg` | `raw/coffee-no-2.svg` | 13 KB | Home, "Blubie at work" gallery |

Also: `mascot/prompts.json` (identity lock and drift log), `mascot/picks.json`, `mascot/provenance.json`, `mascot/raw/` (every candidate, kept as the record of what was rejected), `mascot/mascot-sheet.png` (contact sheet). The site copies live in `site/assets/cat/`; the portal carries `404.svg` and `empty-basket.svg` in `portal/assets/cat/`.

Promo: `promo/mascot-social-1200x630.png` (sources `src/mascot-social-1200x630.html`) and `promo/readme-banner-1280x400.png` (`src/readme-banner-1280x400.html`). Render with `src/tools/render.sh`; set `CH` to a headless Chromium.

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
