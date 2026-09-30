// GET /releases.json: the GitHub releases of afterdarksys/blunix, trimmed for the site.
//
// Threats: a GitHub outage or rate limit that turns the page into an error (the answer
// is always 200 JSON: fresh, stale from cache, or an empty list with error
// "unavailable"), markup or links smuggled in through release text (the page writes
// text only, and every URL here must be a github.com URL for this repo), and a large
// upstream body (the SHA256SUMS read is capped). GITHUB_TOKEN is optional, only raises
// the rate limit, and is never echoed.

const REPO = "afterdarksys/blunix";
const UPSTREAM = `https://api.github.com/repos/${REPO}/releases?per_page=10`;
const RELEASE_PREFIX = `https://github.com/${REPO}/releases/`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
const FRESH_SECONDS = 300;
const KEEP_SECONDS = 7 * 24 * 3600;
const BODY_CHARS = 2000;
const SUMS_MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 5000;
const HEX64 = /^[0-9a-f]{64}$/;

function answer(payload, maxAge = FRESH_SECONDS) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
      "x-content-type-options": "nosniff",
    },
  });
}

function text(value, max) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function ghHeaders(env) {
  const h = {
    "user-agent": "blunix.io-releases",
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  if (env && typeof env.GITHUB_TOKEN === "string" && env.GITHUB_TOKEN) {
    h.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }
  return h;
}

// "hex  name" or "hex *name" per line, as sha256sum writes it.
export function parseSums(body) {
  const out = {};
  for (const line of body.split("\n")) {
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim());
    if (m) out[m[2].trim()] = m[1].toLowerCase();
  }
  return out;
}

async function readSums(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, {
      headers: { "user-agent": "blunix.io-releases" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return {};
    const declared = Number(res.headers.get("content-length") || "0");
    if (declared > SUMS_MAX_BYTES) return {};
    const buf = await res.arrayBuffer();
    if (buf.byteLength > SUMS_MAX_BYTES) return {};
    return parseSums(new TextDecoder().decode(buf));
  } catch {
    return {};
  }
}

// GitHub's own asset digest, when it is there, is "sha256:<hex>".
function assetDigest(asset) {
  const d = typeof asset.digest === "string" ? asset.digest.toLowerCase() : "";
  const hex = d.startsWith("sha256:") ? d.slice(7) : "";
  return HEX64.test(hex) ? hex : null;
}

export async function trim(raw, fetchImpl) {
  if (!Array.isArray(raw)) throw new Error("not a list");
  const releases = [];
  for (const r of raw) {
    if (!r || typeof r !== "object" || r.draft === true) continue;
    const tag = text(r.tag_name, 100);
    const html = text(r.html_url, 300);
    if (!tag || !html.startsWith(RELEASE_PREFIX)) continue;
    const assets = [];
    let sumsUrl = null;
    for (const a of Array.isArray(r.assets) ? r.assets : []) {
      const url = text(a && a.browser_download_url, 400);
      const name = text(a && a.name, 200);
      if (!name || !url.startsWith(DOWNLOAD_PREFIX)) continue;
      if (/^SHA256SUMS(\.txt)?$/i.test(name)) sumsUrl = url;
      const item = { name, size: Number.isSafeInteger(a.size) ? a.size : null, browser_download_url: url };
      const sha = assetDigest(a);
      if (sha) item.sha256 = sha;
      assets.push(item);
    }
    if (sumsUrl && assets.some((a) => !a.sha256)) {
      const sums = await readSums(sumsUrl, fetchImpl);
      for (const a of assets) if (!a.sha256 && sums[a.name]) a.sha256 = sums[a.name];
    }
    releases.push({
      tag,
      name: text(r.name, 200) || tag,
      published_at: text(r.published_at, 40) || null,
      prerelease: r.prerelease === true,
      html_url: html,
      body: text(r.body, BODY_CHARS),
      assets,
    });
  }
  return releases;
}

// Cached with a long lifetime so a stale copy exists when GitHub fails. Freshness is
// the x-fetched-at header, not the cache's own expiry.
export async function handle(request, env, { cache, fetchImpl = fetch, waitUntil = () => {} } = {}) {
  const key = new Request(new URL("/releases.json?v=1", request.url).toString(), { method: "GET" });
  let stale = null;
  try {
    stale = cache ? await cache.match(key) : null;
  } catch {
    stale = null;
  }
  if (stale) {
    const at = Number(stale.headers.get("x-fetched-at") || "0");
    const age = Math.floor(Date.now() / 1000) - at;
    if (age >= 0 && age < FRESH_SECONDS) {
      return answer(await stale.json(), FRESH_SECONDS - age);
    }
  }
  try {
    const res = await fetchImpl(UPSTREAM, { headers: ghHeaders(env), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error("upstream " + res.status);
    const releases = await trim(await res.json(), fetchImpl);
    const fetched = Math.floor(Date.now() / 1000);
    const payload = { releases, fetched_at: new Date(fetched * 1000).toISOString() };
    if (cache) {
      const stored = new Response(JSON.stringify(payload), {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${KEEP_SECONDS}`,
          "x-fetched-at": String(fetched),
        },
      });
      waitUntil(cache.put(key, stored).catch(() => {}));
    }
    return answer(payload);
  } catch {
    if (stale) {
      try {
        const payload = await stale.json();
        return answer({ ...payload, stale: true }, 60);
      } catch {
        // fall through to the empty answer
      }
    }
    return answer({ releases: [], error: "unavailable" }, 60);
  }
}

export async function onRequestGet(context) {
  try {
    const cache = typeof caches !== "undefined" ? caches.default : null;
    return await handle(context.request, context.env, {
      cache,
      waitUntil: (p) => context.waitUntil(p),
    });
  } catch {
    return answer({ releases: [], error: "unavailable" }, 60);
  }
}
