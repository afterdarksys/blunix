# blunix-api

The install plane Worker. The contract is `docs/designs/blunix-install-plane.md`: this directory implements its API, Domains and Names sections.

- `api.blunix.io/v1`: sign-in, labels, builds, program keys, and the configuration library.
- `{label}.blnx.io` and `v{n}.{label}.blnx.io`: the ciphertext, GET and HEAD on `/` only.
- `blnx.io` and `www.blnx.io`: 301 to `https://blunix.io/`.
- Any other host: 404, `This name is not open.`

D1 holds accounts, sessions, labels, builds, keys, audit, rate limits, and the configuration library. Every login start, and one rate-limited call in 64, prunes rate-limit windows older than the last hour and expired sign-in and session rows. A label reserved again after its hold carries on from the highest version counter it ever had, so `v{n}` never names a different owner's bytes. R2 holds bodies at `builds/{label_id}/{version}`. An armored upload is unwrapped: what is stored, hashed and served is the binary age file.

## Configuration library

An account's Profile templates (`kind: Profile`, see `docs/designs/blunix-personal-builds.md`), kept as immutable revisions. Session only: a program key gets 403. Writes need the CSRF header and the portal Origin, like every other session write.

| Method | Route | What |
|---|---|---|
| GET | `/v1/configurations?offset=N` | The caller's live templates, 50 a page, with `nextOffset`. |
| POST | `/v1/configurations` | `{title, profile}` creates a template, or `{title, source: {id, revision}}` forks one revision (with its provenance). |
| GET | `/v1/configurations/{id}` | The owner's template and its revisions, newest first. |
| POST | `/v1/configurations/{id}/revisions` | `{revision, profile, message}`. `revision` is the head you read; a stale one gets 409. |
| DELETE | `/v1/configurations/{id}` | Soft delete. |
| POST | `/v1/configurations/{id}/publication` | `{visibility: "public" or "private"}`. Only when `COMMUNITY` is `on`; otherwise 403. |
| GET | `/v1/community?offset=N`, `/v1/community/{id}` | Public templates, no sign-in, no account ids. 404 unless `COMMUNITY` is `on`. |
| POST | `/v1/community/{id}/reports` | `{reason: "spam", "abuse" or "unsafe"}`, session only. Stored for a person to review; nothing is hidden automatically. 404 unless `COMMUNITY` is `on`. |

`src/profile.ts` checks every profile the way `lib/blunix/profile.py` does, with the same refusal messages; `test/library.test.ts` runs the shared cases in `tests/fixtures/profiles/cases.json`, and `tests/site/library-models.test.mjs` fails if its model names or package list drift from `models/` and `lib/blunix/personal.py`. One difference: a template's network must be a model name or an inline DHCP network, because an address belongs to one machine. The raw body is checked for repeated keys, which `JSON.parse` would hide.

Limits: 100 live templates per account, 100 revisions per template, 30 creates or revisions an hour, 30 publication changes an hour, 10 reports an hour, 8 KiB per body.

## Test

```sh
npm ci
npm test
npx tsc --noEmit
```

Tests run in the Workers runtime with a local D1 and R2. The OIDC tests use a fake issuer and keys generated per run.

## Configuration

| Name | Kind | Value |
|---|---|---|
| `OIDC_ISSUER` | var | The Authentik issuer URL, exactly as its discovery document names it. Empty means sign-in answers 503. |
| `OIDC_CLIENT_ID` | var | The Authentik client id. |
| `OIDC_CLIENT_SECRET` | secret | `wrangler secret put OIDC_CLIENT_SECRET`. Never in the tree. |
| `PORTAL_ORIGIN` | var | `https://build.blunix.io`. CORS, CSRF and the post-login redirect use it. |
| `PINNED_HOSTS_TLS` | var | Empty until `v{n}.{label}.blnx.io` has certificates. Only `on` makes the API name pinned URLs; otherwise `pinnedUrl` is `null` and the portal hides it. |
| `COMMUNITY` | var | Empty keeps every template private. Only `on` opens publishing, the public `/v1/community` reads and reports. Leave it empty until someone owns moderation. |
| `DEV_ORIGINS` | var | Empty in production. For `wrangler dev`, a comma list such as `http://localhost:8765`. When set, the Worker also answers the API on `localhost`. |

The Authentik app's redirect URI is `https://api.blunix.io/v1/auth/callback`.

## Deploy

Not done from here. Once, by hand:

```sh
npx wrangler d1 create blunix-install-plane      # put the id in wrangler.jsonc
npx wrangler r2 bucket create blunix-builds
npx wrangler secret put OIDC_CLIENT_SECRET
```

Then, from the repo root, one command:

```sh
scripts/deploy-api.sh
```

It refuses unless `database_id` is real, `DEV_ORIGINS` is empty, `OIDC_ISSUER` and `OIDC_CLIENT_ID` are set, and `wrangler secret list` shows `OIDC_CLIENT_SECRET`. Then it runs `npm ci`, the typecheck and the tests, applies migrations to the remote D1, and deploys.

`blnx.io` must be a zone on the same account. `v{n}.{label}.blnx.io` needs a certificate per label (Cloudflare for SaaS custom hostnames or Advanced Certificate Manager). See the contract's Deploy notes.
