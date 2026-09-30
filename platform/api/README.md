# blunix-api

The install plane Worker. The contract is `docs/designs/blunix-install-plane.md`: this directory implements its API, Domains and Names sections.

- `api.blunix.io/v1`: sign-in, labels, builds, program keys.
- `{label}.blnx.io` and `v{n}.{label}.blnx.io`: the ciphertext, GET and HEAD on `/` only.
- `blnx.io` and `www.blnx.io`: 301 to `https://blunix.io/`.
- Any other host: 404, `This name is not open.`

D1 holds accounts, sessions, labels, builds, keys, audit and rate limits. Every login start, and one rate-limited call in 64, prunes rate-limit windows older than the last hour and expired sign-in and session rows. A label reserved again after its hold carries on from the highest version counter it ever had, so `v{n}` never names a different owner's bytes. R2 holds bodies at `builds/{label_id}/{version}`. An armored upload is unwrapped: what is stored, hashed and served is the binary age file.

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
