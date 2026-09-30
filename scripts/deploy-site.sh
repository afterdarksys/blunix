#!/usr/bin/env bash
# Deploy blunix.io (site/) and build.blunix.io (portal/) to Cloudflare Pages from
# this laptop, the same way .github/workflows/site.yml does.
#
#   scripts/deploy-site.sh
#
# Needs wrangler to be logged in (npx wrangler login) or CLOUDFLARE_API_TOKEN and
# CLOUDFLARE_ACCOUNT_ID in the environment. Creates the build-blunix-io project the
# first time. It is for a person at a terminal, so it refuses to run in CI.
set -euo pipefail

if [[ -n "${CI:-}" || -n "${GITHUB_ACTIONS:-}" ]]; then
  echo "deploy-site: this is the laptop path. CI uses .github/workflows/site.yml." >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
wrangler=(npx --yes wrangler@4.144.0)

cmp "$root/site/css/site.css" "$root/portal/css/site.css" || {
  echo "deploy-site: site/css/site.css and portal/css/site.css differ. Copy one over the other first." >&2
  exit 1
}

node --test "$root/tests/site/releases.test.mjs" "$root/tests/site/portal.test.mjs"

if ! "${wrangler[@]}" pages project list 2>/dev/null | grep -qw "build-blunix-io"; then
  echo "deploy-site: creating the Pages project build-blunix-io."
  "${wrangler[@]}" pages project create build-blunix-io --production-branch=main
fi

(cd "$root/site" && "${wrangler[@]}" pages deploy . --project-name=blunix-io --branch=main)
(cd "$root/portal" && "${wrangler[@]}" pages deploy . --project-name=build-blunix-io --branch=main)

echo "deploy-site: done. blunix.io and build.blunix.io are deployed."
