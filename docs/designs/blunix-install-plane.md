# Design: the install plane

Date: 2026-09-29
Status: BUILDING. This file is the contract between four pieces built in parallel: the API, the website, the installer, and the build-proxy. When a piece disagrees with this file, this file wins and the piece changes.
Other designs: `blunix-os.md` (host), `blunix-service.md` (enrolled machines, later), `blunix-platform.md` (builder, collect, later).
Threats: a label taken by someone else, a guessed public label, a key that leaves the browser, a server that reads a document, a proxy on the LAN that swaps or replays a document, an installer that erases the wrong disk, TLS that does not verify, an oversized or non-age upload, a session cookie replayed cross-site. This design does not stop a person who has both the URL and the key, a malicious hypervisor, or an unsigned image (image signing is still `blunix-os.md`).

## The flow

1. **Setup over the web.** The person signs in at `https://build.blunix.io/` (Authentik at adsas.id first, as an OIDC relying party).
2. **Reserve a hostname.** They reserve a label, such as `ada`. That label owns `ada.blnx.io`.
3. **Build.** The browser composes the node document, generates the key, encrypts with age passphrase mode, and uploads only the ciphertext. Each upload is a new version: `v1`, `v2`, and so on.
4. **Hand-off.** The site shows the install card once:
   - `https://ada.blnx.io/` is the latest version.
   - `https://v3.ada.blnx.io/` is pinned to version 3.
   - The key, in the key format below.
5. **Install.** The installer asks for the hostname, then the key. The network comes up by DHCP. If there is no DHCP, a build-proxy on the LAN supplies it, or the operator types a static address at the console.

## Domains

| Domain | Role | Hosting |
|---|---|---|
| `blunix.io` | The public website | Cloudflare Pages |
| `api.blunix.io` | The API (`/v1`) | Cloudflare Worker |
| `build.blunix.io` | The portal: sign in, reserve, build | Cloudflare Pages, a separate project |
| `blnx.io` | User build hosts: `{label}.blnx.io` | The same Worker as the API |

User build hosts live on `blnx.io`, a separate registrable domain, so ciphertext hosts never share cookies or origin with the website, the portal, or the API. `build.blunix.io` and `api.blunix.io` are same-site, so the session cookie on `api.blunix.io` rides portal `fetch` calls with `credentials: 'include'`. The apex `blnx.io` and `www.blnx.io` redirect to `https://blunix.io/`.

## Placement

Decided 2026-09-29.

| Where | What |
|---|---|
| Cloudflare | `blunix.io` website (Pages); `build.blunix.io` portal (Pages); `api.blunix.io` API and `*.blnx.io` user build hosts (one Worker, D1 for records, R2 for ciphertext). |
| Our servers | The image builder only: mkosi or Docker builds, privileged, on a clean host. None of the four hosts named in the 2026-09 incident. Authentik at adsas.id stays where it is. |
| GitHub | The source repo (`afterdarksys/blunix`) and the packages: installer ISO, raw and compressed images, `SHA256SUMS`, and the proxy, all as release assets. Each asset is under GitHub's 2 GiB per-file limit, so images ship `zstd`-compressed. `updates.blunix.io` publishes the manifest, and its mirrors point at the GitHub release URLs. |
| Offline | The image signing key. Never on the builder, never on Cloudflare. The builder produces unsigned artifacts plus digests; signing is a separate step. |
| Customer LAN | `blunix proxy`. |

The machine trusts a digest, never a host. A GitHub release asset whose bytes do not match the digest is refused, the same as any mirror.

## Names

The label is one ASCII DNS label: `^[a-z][a-z0-9-]{0,30}[a-z0-9]$`, 2 to 32 characters, no `--`, no punycode. Reserved labels are `www api updates log mail build portal admin root blunix proxy status`, plus any label that matches `^v[0-9]+$`. That last rule stops `v1.ada` from ever being ambiguous.

| Host | Serves |
|---|---|
| `{label}.blnx.io` | The latest version's ciphertext. `cache-control: no-store`. |
| `v{n}.{label}.blnx.io` | Version n, forever or until deleted. `cache-control: public, max-age=31536000, immutable`. |

`n` is a decimal integer from 1 to 999999, with no leading zero.

- **Methods.** Only `GET` and `HEAD` on path `/`. Anything else is `405`. Any other path, and any query string, is `404`.
- **Response.** `content-type: application/octet-stream`, `x-content-type-options: nosniff`, and `x-blunix-sha256: <hex>`, the ciphertext digest.
- **Unknown or empty.** An unknown label, an unknown version, or a label with no build is `404` with an empty body.

On the machine, `require_build_host` accepts three forms:
- `{label}.blnx.io`
- `v{n}.{label}.blnx.io`
- the legacy `name-1042.build.blunix.io` form, kept only so the fixture still boots.

The machine hostname written to `/etc/hostname` still comes from the document's `hostname`, never from the label.

## The key

The browser generates the key. People do not choose it.
- **Randomness.** 100 bits from `crypto.getRandomValues`.
- **Format.** Crockford base32, lowercase, with the alphabet `0123456789abcdefghjkmnpqrstvwxyz`. It is 20 characters, shown as four groups of five: `k7m2q-9dx4t-ab3fz-0wnr8`.
- **What gets encrypted.** The age passphrase is the canonical form: 20 lowercase characters, no hyphens.
- **Input on the installer.** It canonicalizes what the person types: lowercase it, drop spaces and hyphens, map `i` and `l` to `1`, map `o` to `0`. If the result is exactly 20 characters of the alphabet, it tries that canonical string. Otherwise it tries the raw input, so documents encrypted by hand with a chosen passphrase still work.
- **Where it lives.** The key never leaves the browser. It is not uploaded, not stored, and not logged. The site shows it once and offers the install card as a download.

## Install package

The website produces two files, both generated client-side.
- **Install card** (`{label}-v{n}-install.txt`): plain sentences a screen reader reads top to bottom. It holds the latest URL, the pinned URL, the key, the sha256 of the ciphertext, and the date.
- **Offline bundle** (`{label}-v{n}.json`): the `ServiceBundle` shape from `blunix-service.md`, minus the enrolled fields. For a USB stick, when the machine has no route out.

```json
{"apiVersion":"blunix.io/v1","kind":"InstallBundle","label":"ada","version":3,
 "document":{"encoding":"age","sha256":"<hex>","body":"<age armor>"}}
```

`document.sha256` is the SHA-256 of the binary ciphertext, the same value as the upload response and `x-blunix-sha256`, not of the armor text. The key is never a field in the bundle.

## API: `https://api.blunix.io/v1`

It runs on a Cloudflare Worker. D1 holds accounts, labels, versions, sessions and keys. R2 holds the ciphertext bodies. The same Worker serves `*.blnx.io`.

**Auth.**
- **Browser sessions** use OIDC authorization code with PKCE S256, plus `state` and `nonce`.
- **The ID token** is verified against the issuer's JWKS. Algorithm allowlist: `RS256`, `ES256`, `EdDSA`. `none` is rejected, and so are `iss`, `aud` or `exp` mismatches.
- **Session token.** 32 random bytes, stored as its SHA-256. The cookie is `__Host-blx_session`, `Secure; HttpOnly; SameSite=Lax; Path=/`, with a 12h lifetime.
- **CSRF.** Every state-changing request must carry `x-blunix-csrf: 1` AND an `Origin` of exactly `https://build.blunix.io`. A bearer-key request needs neither.
- **Program keys.** `Authorization: Bearer blx_<43 base64url chars>`. Stored as SHA-256 and compared in constant time. Scopes are `hosts:write` (the default) and `hosts:read`. A `blx_join_` token is a 401 everywhere in this pass.

**Routes.** JSON in and out, except the ciphertext upload.

| Call | Who | Result |
|---|---|---|
| `GET /v1/auth/login` | anyone | 302 to the issuer, with the PKCE state stored server side, expiring in 10 min. |
| `GET /v1/auth/callback` | the issuer | Verify, upsert the account by `(iss, sub)`, set the cookie, then 302 to `https://build.blunix.io/`. |
| `POST /v1/auth/logout` | session | Delete the session. |
| `GET /v1/me` | session or key | `{account, labels}`. |
| `POST /v1/hosts` `{label}` | session, or `hosts:write` | 201, 409 if taken, 400 if the label is invalid or reserved. The limit is 20 labels per account. |
| `GET /v1/hosts` | session, or `hosts:read`/`hosts:write` | The account's labels, with the latest version of each. |
| `GET /v1/hosts/{label}` | owner | Label, created time, and versions `[{version, sha256, size, created}]`. |
| `DELETE /v1/hosts/{label}` | owner | The label and every version stop serving. The name is held 30 days before anyone can reserve it again. |
| `POST /v1/hosts/{label}/builds` | owner | Body is the raw age ciphertext, `content-type: application/octet-stream`. Returns 201 `{version, sha256, size, url, pinnedUrl}`. |
| `DELETE /v1/hosts/{label}/builds/{n}` | owner | That version stops serving. The latest moves back to the highest remaining version. |
| `POST /v1/keys` `{name, scopes}` | session only | Returns the `blx_` key once, plus its fingerprint. |
| `GET /v1/keys` | session only | Fingerprints, names and scopes. Never the key. |
| `DELETE /v1/keys/{fingerprint}` | session only | Immediate revoke. |

**What an upload must be.**
- The body is at most 256 KiB.
- It is either age binary, starting with `age-encryption.org/v1\n`, or age armor, starting with `-----BEGIN AGE ENCRYPTED FILE-----`.
- Its header has exactly one stanza, and that stanza is `scrypt`. A recipient-key stanza is refused, so the passphrase rule holds.
- Anything else is `400 {"error":"refused ciphertext"}`. That includes plaintext, a shell script, YAML, and an empty body.
- The server never decrypts.

**Dev.** When the Worker var `DEV_ORIGINS` is set (for example `http://localhost:8765`), those origins are also accepted for CORS and CSRF. It is empty in production.

**Errors** are fixed strings: `{"error":"..."}`. The server never echoes the request body.

**Rate limits.**
- 10 label reservations per account per hour.
- 30 build uploads per account per hour.
- 60 login starts per IP per hour, keyed on `cf-connecting-ip`.

**Audit.** A D1 row for each reserve, upload, delete and key event. It records the time, the account id, the label, the version, the sha256, and the key fingerprint. It never holds a body, a key or a token.

## The installer (bare metal, anything)

One flow runs from any medium:

| Medium | How it boots |
|---|---|
| USB stick or ISO | Hybrid: UEFI plus BIOS. |
| Netboot | iPXE script, served by a build-proxy or by any HTTP server. |
| VM or cloud | The raw image. It keeps the first-boot bootstrap that already exists. |

The live installer runs `blunix install`:

1. Boot menu keys 1 to 5, exactly as today.
2. **Network.**
   - Try DHCP on every wired interface for 30 s.
   - If there is no lease, and the kernel command line has `blunix.proxy=HOST:PORT`, use that proxy.
   - Otherwise ask: `blunix: no network. Type an address like 10.0.0.5/24, or press enter to try again.` Then ask for the gateway and the DNS server.
   - Speech rules apply.
3. **Hostname.** `blunix: build hostname.` The operator types `ada.blnx.io` or `v3.ada.blnx.io`. A bare `ada` expands to `ada.blnx.io`. The installer reads it back and waits for yes.
4. **Key.** `blunix: key. Type it. It will not be spoken.` Echo is off.
5. **Fetch.**
   - Directly: `https://{host}/` with the default verifier, TLS 1.2 or higher, capped at 256 KiB.
   - Through a proxy, if one is set: `http://{proxy}/v1/build/{host}`. That path is safe only because age is authenticated encryption. A swapped body does not decrypt, and the installer says the version it applied.
6. **Decrypt and check.** Decrypt, then parse against the schema. A refusal applies nothing.
7. **Pick the disk** from the document's disk model.
   - Never the boot medium.
   - Never a disk smaller than the image.
   - A disk that already has partitions needs a spoken yes: `blunix: erase disk sda, 480 gigabytes, Samsung SSD. Say yes to erase.` Silence means no.
   - More than one candidate disk and no `target` in the document: the installer lists them and asks.
8. **Write.**
   - Stream the image to the disk and verify its sha256 against the image digest.
   - Image source: the medium's `blunix.raw.zst` with its `.sha256`, or `updates.blunix.io` later.
   - Grow the root, apply the node document into the target root, and install the bootloader.
9. `blunix: installed ada-1. Remove the stick. Say yes to reboot.`

The node schema gains one optional form: `network:` may be a model name (as today) or an inline mapping with the same fields as a Network model (`match`, `dhcp` or `address`/`gateway`/`dns`). The inline form is validated by the same rules. This is how a build carries a real static address.

## The build-proxy

`blunix proxy` runs on an operator's Linux or macOS machine on the install LAN. It is the same Python package as `blunix`, with the stdlib only plus PyYAML, and it shells out to `age`.

- **`blunix proxy init`.** Writes `~/.config/blunix/proxy.yaml`: the API URL, the path to the account key file (mode 0600), and the listen address.
- **`blunix proxy site.yaml`.** A site file lists machines as MAC → label, hostname, inline network (a static address), disk, and access. `blunix proxy plan site.yaml` shows what it would do. `blunix proxy publish site.yaml`:
  - reserves each label through the API,
  - renders each node document,
  - validates it with the same schema,
  - generates a key per machine,
  - encrypts with `age`,
  - uploads the build,
  - writes keys to `keys.txt`, mode 0600, one install card per machine.

  Keys are never sent to the API.
- **`blunix proxy serve`.** A LAN HTTP server with these routes:
  - `GET /v1/build/{host}` fetches `https://{host}/` with full TLS verification and relays the bytes, with a cache keyed by host and a 256 KiB cap. It only relays hosts under `blnx.io`, so it is not an open proxy.
  - `GET /v1/boot.ipxe` serves the iPXE script.
  - `GET /v1/netconfig/{mac}` returns the install-time address for that MAC, taken from the site file, as JSON.
  - `GET /healthz`.
- **`blunix proxy dnsmasq site.yaml`.** Renders a dnsmasq config for the install VLAN: DHCP reservations per MAC, a PXE/iPXE chainload to the proxy, and `blunix.proxy=` on the kernel line. It renders the file. It does not start dnsmasq. The operator runs it.
- **Keys and the proxy.** The proxy never serves a key over the network. The operator types the key at the console. An unattended install that takes the key from the proxy is an open question, not built.

## Not in this pass

These wait for later passes:
- enrolled visibility, join tokens and machine keys
- check-in and troubleshoot
- the image builder and log publishing
- Google and GitHub sign-in (Authentik first)
- signed images

## Deploy notes

- **TLS certificates.** `{label}.blnx.io` is covered by the free Universal SSL wildcard `*.blnx.io`. `v{n}.{label}.blnx.io` is two levels deep, so no single wildcard covers it: each label would need its own `*.{label}.blnx.io`. Pinned hosts need Cloudflare for SaaS custom hostnames (a certificate per hostname, issued automatically) or Advanced Certificate Manager. The code serves both forms either way. Until pinned certificates exist, the latest host works on day one.
- **Authentik.** The client id, the client secret and the issuer URL come from the Authentik app. They are Worker secrets, never in the tree.
