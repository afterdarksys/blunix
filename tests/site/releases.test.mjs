// Tests for site/functions/releases.json.js and the pure helpers in site/js/live.js.
// Run: node --test tests/site/releases.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { handle, parseSums, trim } from "../../site/functions/releases.json.js";
import { day, size } from "../../site/js/live.js";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);
const DL = "https://github.com/afterdarksys/blunix/releases/download/v0.1.0/";

function release(extra = {}) {
  return {
    tag_name: "v0.1.0",
    name: "First light",
    published_at: "2026-09-30T12:00:00Z",
    html_url: "https://github.com/afterdarksys/blunix/releases/tag/v0.1.0",
    body: "Unsigned test image.\n" + "x".repeat(5000),
    draft: false,
    prerelease: true,
    assets: [
      { name: "blunix-installer.iso", size: 734003200, browser_download_url: DL + "blunix-installer.iso", digest: "sha256:" + HEX_A },
      { name: "blunix.raw.zst", size: 402653184, browser_download_url: DL + "blunix.raw.zst" },
      { name: "SHA256SUMS", size: 200, browser_download_url: DL + "SHA256SUMS" },
    ],
    ...extra,
  };
}

function memoryCache() {
  const store = new Map();
  return {
    store,
    async match(req) {
      const r = store.get(req.url);
      return r ? r.clone() : undefined;
    },
    async put(req, res) {
      store.set(req.url, res.clone());
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeFetch(routes, calls = []) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    const r = routes[String(url)];
    if (r instanceof Error) throw r;
    if (!r) return new Response("nope", { status: 404 });
    return typeof r === "function" ? r(init) : r.clone();
  };
}

const UPSTREAM = "https://api.github.com/repos/afterdarksys/blunix/releases?per_page=10";
const REQ = new Request("https://blunix.io/releases.json");

test("parseSums reads sha256sum output, text and binary mode", () => {
  const sums = parseSums(`${HEX_B}  blunix.raw.zst\n${HEX_C} *blunix-installer.iso\nnot a line\n`);
  assert.deepEqual(sums, { "blunix.raw.zst": HEX_B, "blunix-installer.iso": HEX_C });
});

test("trim keeps the documented fields, caps the body, and fills sha256", async () => {
  const f = fakeFetch({ [DL + "SHA256SUMS"]: new Response(`${HEX_B}  blunix.raw.zst\n${HEX_C}  blunix-installer.iso\n`) });
  const [r] = await trim([release()], f);
  assert.equal(r.tag, "v0.1.0");
  assert.equal(r.name, "First light");
  assert.equal(r.published_at, "2026-09-30T12:00:00Z");
  assert.equal(r.prerelease, true);
  assert.equal(r.body.length, 2000);
  assert.deepEqual(Object.keys(r).sort(), ["assets", "body", "html_url", "name", "prerelease", "published_at", "tag"]);
  // GitHub's own digest wins over the sums file; the sums file fills the gap.
  assert.equal(r.assets[0].sha256, HEX_A);
  assert.equal(r.assets[1].sha256, HEX_B);
  assert.equal(r.assets[1].size, 402653184);
  assert.equal(r.assets[1].browser_download_url, DL + "blunix.raw.zst");
});

test("trim drops drafts, foreign links, and non-list input", async () => {
  const f = fakeFetch({});
  const out = await trim([
    release({ draft: true }),
    release({ html_url: "https://evil.example/x" }),
    release({ tag_name: "v0.2.0", assets: [{ name: "x", size: 1, browser_download_url: "https://evil.example/x" }] }),
  ], f);
  assert.equal(out.length, 1);
  assert.equal(out[0].tag, "v0.2.0");
  assert.deepEqual(out[0].assets, []);
  await assert.rejects(trim({ message: "rate limited" }, f));
});

test("handle serves fresh data, sends a User-Agent, and uses GITHUB_TOKEN when set", async () => {
  const calls = [];
  const cache = memoryCache();
  const pending = [];
  const f = fakeFetch({ [UPSTREAM]: jsonResponse([release({ assets: [] })]) }, calls);
  const res = await handle(REQ, { GITHUB_TOKEN: "tok" }, { cache, fetchImpl: f, waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "public, max-age=300");
  const body = await res.json();
  assert.equal(body.releases[0].tag, "v0.1.0");
  assert.equal(calls[0].init.headers["user-agent"], "blunix.io-releases");
  assert.equal(calls[0].init.headers.authorization, "Bearer tok");
  assert.equal(cache.store.size, 1);

  const again = await handle(REQ, {}, { cache, fetchImpl: fakeFetch({}, calls) });
  assert.equal(calls.length, 1, "a fresh cache entry is served without calling GitHub");
  assert.equal((await again.json()).releases[0].tag, "v0.1.0");
});

test("handle sends no authorization header without a token", async () => {
  const calls = [];
  await handle(REQ, {}, { cache: memoryCache(), fetchImpl: fakeFetch({ [UPSTREAM]: jsonResponse([]) }, calls) });
  assert.equal(calls[0].init.headers.authorization, undefined);
});

test("an empty list is an empty list, not an error", async () => {
  const res = await handle(REQ, {}, { cache: memoryCache(), fetchImpl: fakeFetch({ [UPSTREAM]: jsonResponse([]) }) });
  assert.deepEqual((await res.json()).releases, []);
});

test("a GitHub error serves the stale copy", async () => {
  const cache = memoryCache();
  const old = Math.floor(Date.now() / 1000) - 3600;
  await cache.put(new Request("https://blunix.io/releases.json?v=1"), new Response(JSON.stringify({ releases: [{ tag: "v0.1.0" }], fetched_at: "then" }), { headers: { "x-fetched-at": String(old) } }));
  const res = await handle(REQ, {}, { cache, fetchImpl: fakeFetch({ [UPSTREAM]: jsonResponse({ message: "API rate limit exceeded" }, 403) }) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.stale, true);
  assert.equal(body.releases[0].tag, "v0.1.0");
});

test("a GitHub error with no cache is 200 {releases: [], error: 'unavailable'}", async () => {
  for (const upstream of [new Error("network"), jsonResponse({}, 500), new Response("<html>", { status: 200 })]) {
    const res = await handle(REQ, {}, { cache: memoryCache(), fetchImpl: fakeFetch({ [UPSTREAM]: upstream }) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { releases: [], error: "unavailable" });
  }
  const res = await handle(REQ, {}, { cache: null, fetchImpl: fakeFetch({}) });
  assert.deepEqual(await res.json(), { releases: [], error: "unavailable" });
});

test("live.js formats sizes and dates", () => {
  assert.equal(size(512), "512 bytes");
  assert.equal(size(734003200), "700 MiB");
  assert.equal(size(1536), "1.5 KiB");
  assert.equal(size(null), "size unknown");
  assert.equal(day("2026-09-30T12:00:00Z"), "30 September 2026");
  assert.equal(day("nonsense"), "date unknown");
});
