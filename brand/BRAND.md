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

Blubie is the Blunix cat, a Russian Blue. It is the same cat as the mark's head: slate coat, green eyes, nothing loud. In alt text, say "Blubie, the Blunix cat" the first time on a page and "Blubie" after that, and describe what the picture actually shows.

Since v7 (2026-09-30) Blubie comes in two looks. The v6 flat-vector SVGs are archived in `mascot/final/` and are no longer on the site.

### The two looks

| Look | Model | Used for |
|---|---|---|
| Storybook (main) | Recraft V3 `digital_illustration` with a created style (`style_id` in `prompts.json`) | Site scene art: the home hero, the three rules, the page heroes (Install, Account, Log, Service, Platform) and the "Blubie at work" gallery; the README banner |
| 3D (secondary) | FLUX.1 Kontext [pro], conditioned on `mascot/ref/3d-approved.png` | The 404 (site and portal), the Access hero, the home trait spots, the portal's empty state, the social card |

Storybook scenes carry their own charcoal backdrop with a soft oval glow, so the site shows them as framed tiles: `--radius` (16px) corners, a 1px Line border, Raise behind while loading. The 3D spots and the empty state are cut out (BiRefNet) and sit straight on Night; the 3D 404 and Access art are framed like the storybook tiles.

### Identity lock

The one source of truth is `mascot/prompts.json` (version 7: both looks, every scene, and a dated drift log). Every prompt is the look's template with the same `cat` string.

- A Russian Blue. One solid, even silver-blue-grey coat. Short and plush: a Russian Blue is not long-haired. No white patches, no bib, no stripes, not a tabby, not black.
- Lime-green eyes. Pale yellow, white or grey eyes are a reject.
- Slender and composed in the storybook look; the 3D look keeps the approved render's rounder, younger face. Calm, faintly amused. Dark slate nose (storybook), small pink nose (3D, as approved).
- A real cat on four legs. No clothes, no collar, no straps, no human hands, never standing like a person.
- Tail of normal length, smooth. Not a long wavy plume (the fix Ryan asked for on the reference).

### Do / don't

Do: use one scene per page, next to the text it illustrates. Keep art on Night or Raise. Serve every image through `<picture>` (AVIF, WebP, then JPEG or PNG) with `width`, `height` and `decoding="async"`, and `loading="lazy"` below the fold. Spot art beside a labelled list item is decorative (`alt=""`).

Don't: ship a render with any text, letters, pseudo-text, signature, watermark or corner mark (screens, scrolls, books and cans stay blank). Don't ship wrong-coat or wrong-eye renders, extra or missing limbs, ears or tails. Don't mix the looks inside one component (the trait list is all 3D, the gallery all storybook). Don't recolour the cat or add glows and drop shadows. Don't use the art in place of the logo mark: the mark stays in the header. No speech bubbles, no puns in status text.

### Pipeline

1. `python3 mascot/generate_v2.py [ids]`: reads `prompts.json`, writes candidates to `mascot/raw-v2/<look>-<id>-<n>.png` (gitignored) and records model, prompt, style_id or reference, seed and time in `mascot/provenance.json`. It skips files that exist: delete one to re-roll it, or raise the scene's `n`. `--create-style a.png b.png ...` makes a Recraft style from up to five PNGs; `--cutout in.png out.png` removes a background. The fal.ai key is read at run time from the env file in `$BLUNIX_FAL_ENV` and only ever sent as the `Authorization` header.
2. Look at every candidate on Night, reject against the lists above, log the reasons in `prompts.json` `_log`, and record the pick in `mascot/picks-v2.json`.
3. `python3 mascot/export_v2.py`: writes the masters to `mascot/final-storybook/` and `mascot/final-3d/`, and the web copies (`<name>-<w>.avif/.webp/.jpg|.png` at 1x and 2x: hero 560/1100, scenes and gallery 320/640, 404 300/600, spots 96/192, empty state 128/256) to `site/assets/cat/` and the portal's two to `portal/assets/cat/`.
4. `mascot/sheet.sh`: renders `mascot/mascot-sheet.png` (both looks, labelled). The promo cards render from `src/` with the Playwright headless shell.

References: `mascot/ref/storybook-approved.png` (the approved storybook test), `mascot/ref/storybook-approved-dark.png` (the same with the white surround filled charcoal and the corner mark patched out, used as a style reference), `mascot/ref/3d-approved.png` (the approved 3D test, the Kontext identity reference).

### File index

| File | Source | Size | Used on |
|---|---|---|---|
| `mascot/final-storybook/hero.jpg` | `raw-v2/storybook-hero-6.png` | 441 KB | Home hero, beside the headline (the header keeps the logo mark); README banner |
| `mascot/final-storybook/held-still.jpg` | `raw-v2/storybook-held-still-3.png` | 339 KB | Home, "Debian, held still" rule |
| `mascot/final-storybook/shell.jpg` | `raw-v2/storybook-shell-1.png` | 384 KB | Home, "A shell when it is sick" rule; Service hero |
| `mascot/final-storybook/speech.jpg` | `raw-v2/storybook-speech-3.png` | 336 KB | Home, "Speech before questions" rule |
| `mascot/final-storybook/install.jpg` | `raw-v2/storybook-install-1.png` | 333 KB | Install hero |
| `mascot/final-storybook/key.jpg` | `raw-v2/storybook-key-4.png` | 339 KB | Account hero |
| `mascot/final-storybook/log.jpg` | `raw-v2/storybook-log-1.png` | 342 KB | Log hero |
| `mascot/final-storybook/proxy.jpg` | `raw-v2/storybook-proxy-6.png` | 387 KB | Platform hero |
| `mascot/final-storybook/quiet.jpg` | `raw-v2/storybook-quiet-6.png` | 361 KB | Brand library only (the trait list uses the 3D sleep spot) |
| `mascot/final-storybook/lands-on-feet.jpg` | `raw-v2/storybook-lands-on-feet-4.png` | 323 KB | Brand library only (the trait list uses the 3D land spot) |
| `mascot/final-storybook/at-computer.jpg` | `raw-v2/storybook-at-computer-2.png` | 336 KB | Home, "Blubie at work" gallery |
| `mascot/final-storybook/reading-docs.jpg` | `raw-v2/storybook-reading-docs-1.png` | 336 KB | Home gallery |
| `mascot/final-storybook/debugging.jpg` | `raw-v2/storybook-debugging-4.png` | 374 KB | Home gallery |
| `mascot/final-storybook/coffee-no.jpg` | `raw-v2/storybook-coffee-no-3.png` | 375 KB | Home gallery |
| `mascot/final-storybook/braille.jpg` | `raw-v2/storybook-braille-5.png` | 377 KB | Home gallery |
| `mascot/final-storybook/cloud.jpg` | `raw-v2/storybook-cloud-2.png` | 331 KB | Home gallery |
| `mascot/final-storybook/packing.jpg` | `raw-v2/storybook-packing-2.png` | 337 KB | Home gallery |
| `mascot/final-storybook/stargazing.jpg` | `raw-v2/storybook-stargazing-4.png` | 371 KB | Home gallery |
| `mascot/final-3d/404.jpg` | `raw-v2/3d-404-2.png` | 125 KB | Site 404 and portal 404 |
| `mascot/final-3d/access.jpg` | `raw-v2/3d-access-3.png` | 121 KB | Access hero |
| `mascot/final-3d/social.jpg` | `raw-v2/3d-social-2.png` | 94 KB | promo/mascot-social-1200x630.png |
| `mascot/final-3d/empty-basket.png` | `raw-v2/3d-empty-basket-2.png (cut out)` | 580 KB | Portal, empty hostnames state |
| `mascot/final-3d/spot-sleep.png` | `raw-v2/3d-spot-sleep-2.png (cut out)` | 553 KB | Home, "Quiet by default" trait spot |
| `mascot/final-3d/spot-sit.png` | `raw-v2/3d-spot-sit-1.png (cut out)` | 522 KB | Home, "Small footprint" trait spot |
| `mascot/final-3d/spot-paw.png` | `raw-v2/3d-spot-paw-1.png (cut out)` | 582 KB | Home, "Speaks when you ask" trait spot |
| `mascot/final-3d/spot-peek.png` | `raw-v2/3d-spot-peek-3.png (cut out, slate ledge added)` | 265 KB | Home, "Watchful" trait spot |
| `mascot/final-3d/spot-land.png` | `raw-v2/3d-spot-land-1.png (cut out)` | 450 KB | Home, "Lands on its feet" trait spot |
| `mascot/final-3d/spot-stretch.png` | `raw-v2/3d-spot-stretch-4.png (cut out)` | 477 KB | Home, "Nine lives, within reason" trait spot |

Also: `mascot/prompts.json` (identity lock, both looks, drift log; the v6 prompts live under `legacy_v6` for `generate.py`), `mascot/picks-v2.json`, `mascot/provenance.json`, `mascot/mascot-sheet.png`. Archived v6: `mascot/final/*.svg`, `mascot/picks.json`, `mascot/generate.py`, `mascot/finish.py`, `mascot/export.sh`.

Promo: `promo/mascot-social-1200x630.png` (3D, from `src/mascot-social-1200x630.html`) and `promo/readme-banner-1280x400.png` (storybook hero, from `src/readme-banner-1280x400.html`).

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
