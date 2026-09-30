#!/usr/bin/env bash
# Deploy the install plane Worker (platform/api -> api.blunix.io and *.blnx.io) from
# this laptop. One command:
#
#   scripts/deploy-api.sh
#
# Refuses, with one sentence, unless the config is production-ready: a real D1
# database_id, DEV_ORIGINS empty, OIDC_ISSUER and OIDC_CLIENT_ID set, and the
# OIDC_CLIENT_SECRET secret present on the Worker. Then it runs npm ci, the typecheck
# and the tests, applies D1 migrations to the remote database, and deploys.
#
# Needs wrangler to be logged in (npx wrangler login) or CLOUDFLARE_API_TOKEN and
# CLOUDFLARE_ACCOUNT_ID in the environment. It is for a person at a terminal, so it
# refuses to run in CI.
set -euo pipefail

die() { echo "deploy-api: $*" >&2; exit 1; }

if [[ -n "${CI:-}" || -n "${GITHUB_ACTIONS:-}" ]]; then
  echo "deploy-api: this is the laptop path, not for CI." >&2
  exit 2
fi

api="$(cd "$(dirname "${BASH_SOURCE[0]}")/../platform/api" && pwd)"
cd "$api"

# wrangler.jsonc, full-line comments dropped, parsed as JSON. Anything else fails closed.
read_config() {
  node -e '
    const fs = require("fs");
    const text = fs.readFileSync("wrangler.jsonc", "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    let c;
    try { c = JSON.parse(text); } catch { console.error("deploy-api: wrangler.jsonc did not parse."); process.exit(1); }
    const v = c.vars || {};
    const db = (c.d1_databases || [])[0] || {};
    for (const x of [db.database_id, v.DEV_ORIGINS, v.OIDC_ISSUER, v.OIDC_CLIENT_ID]) console.log(String(x ?? "").trim());
  '
}
config="$(read_config)" || exit 1
{ read -r db_id; read -r dev_origins; read -r issuer; read -r client_id; } <<<"$config"

[[ -n "$db_id" && ! "$db_id" =~ ^[0-]+$ ]] || die "wrangler.jsonc still has the all-zero database_id; set it from 'wrangler d1 create blunix-install-plane'."
[[ -z "$dev_origins" ]] || die "DEV_ORIGINS is '$dev_origins'; it must be empty in production."
[[ -n "$issuer" ]] || die "OIDC_ISSUER is empty; set it to the Authentik issuer URL in wrangler.jsonc."
[[ -n "$client_id" ]] || die "OIDC_CLIENT_ID is empty; set it to the Authentik client id in wrangler.jsonc."

npm ci
wrangler=(npx --no-install wrangler)

secrets="$("${wrangler[@]}" secret list --format json)" || die "could not list Worker secrets; is wrangler logged in?"
node -e '
  const list = JSON.parse(process.argv[1]);
  process.exit(Array.isArray(list) && list.some((s) => s && s.name === "OIDC_CLIENT_SECRET") ? 0 : 1);
' "$secrets" || die "the OIDC_CLIENT_SECRET secret is not set; run 'npx wrangler secret put OIDC_CLIENT_SECRET' in platform/api."

npm run typecheck
npm test

"${wrangler[@]}" d1 migrations apply blunix-install-plane --remote
"${wrangler[@]}" deploy

echo "deploy-api: done. api.blunix.io and *.blnx.io are deployed."
