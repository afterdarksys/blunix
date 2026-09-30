# portal/ (build.blunix.io)

The portal, served at the root of `https://build.blunix.io/` as its own Cloudflare Pages project. It is the working half of blunix.io: sign in, reserve a label, compose a node document, encrypt it with age in the browser, and upload only the ciphertext. The contract is `blunix-idea/docs/designs/blunix-install-plane.md`.

## Files

- `index.html`: the page. Nav links go back to `https://blunix.io/`. One `h1`, a polite status region, and forms with labels and `aria-describedby` problems.
- `portal.js`: DOM and API calls. ES module.
- `lib.js`: pure functions. The key, the label rules, the node document, the install card, the bundle. No DOM, no network, so Node can import it.
- `portal.css`: controls. Colors come from `css/site.css`, a copy of the blunix.io stylesheet, with its `fonts/` and `assets/`, so this site stands alone.
- `vendor/age-encryption.js`: typage, bundled. Version and sha256 in `vendor/VENDOR.md`.

## The key

`lib.js` `generateKey()` draws bytes from `crypto.getRandomValues` and keeps bytes below `256 - 256 % 32`, which is 256, so no byte is rejected and `byte % 32` has no bias. 20 characters of `0123456789abcdefghjkmnpqrstvwxyz`, 100 bits, the same alphabet and length as `lib/blunix/keyfmt.py`. The canonical 20-character string is the age passphrase. The card shows it as four groups of five.

The key lives in one variable while the install card is open. It is not written to storage, a URL, the console, or a request. Closing the card, signing out, starting the next build, or leaving the page drops it. The two downloads are made from a `Blob` in this page. The copy button puts the key on the system clipboard, which other apps can read; the page says so under the button.

## Run it locally

```sh
python3 scripts/serve-portal-dev.py
```

The deployed page names only `https://api.blunix.io`: in its CSP `connect-src` and in `<meta name="blunix-api">`, which `portal.js` reads. The dev server serves this directory on port 8765 and rewrites those two in `index.html` on the way out, so the page talks to `wrangler dev` for the API Worker on port 8787. Nothing in this directory names a dev host. The script's header has the Worker settings it needs (`DEV_ORIGINS`, the session cookie).

Without a Worker the page loads, says `blunix: the API did not answer.`, and shows the sign-in link.

## Deploy

A separate Cloudflare Pages project, `build-blunix-io`, for `build.blunix.io`. `.github/workflows/site.yml` deploys it on a push to main that touches `portal/`, `site/`, or `brand/`; `scripts/deploy-site.sh` does the same from a laptop. `css/site.css` must stay byte-identical to `site/css/site.css`; both the workflow and the script check it. `_headers` adds `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `nosniff` for every path. The same CSP is also a `<meta>` in the page.

## API shapes the page assumes

The contract fixes routes, not every response body. The page reads:

- `GET /v1/me`: `{account: {email | name | sub | id}, labels}`.
- `GET /v1/hosts`: an array, or `{hosts: [...]}`, of `{label, latest}` where `latest` is a version number or `{version}`.
- `GET /v1/hosts/{label}`: `{label, created, versions: [{version, sha256, size, created, pinnedUrl}]}`.
- `POST /v1/hosts/{label}/builds`: `{version, sha256, size, url, pinnedUrl}`. The page refuses to show a card unless `sha256` equals its own digest of the bytes it sent. It builds the latest URL itself, `https://{label}.blnx.io/`. `pinnedUrl` is `null` until the API's `PINNED_HOSTS_TLS` is on; the card and the version list show a pinned URL only when the API names one and it equals `https://v{n}.{label}.blnx.io/`. `blnx.io` is a separate registrable domain, so build files never share cookies with this portal, the site, or the API.
- `POST /v1/keys`: `{key, fingerprint}`, with `key` matching `blx_` plus 43 base64url characters.
- `GET /v1/keys`: an array, or `{keys: [...]}`, of `{fingerprint, name, scopes}`.
