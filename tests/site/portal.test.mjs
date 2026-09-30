// Tests for the portal's install card text and the production CSP.
// Run: node --test tests/site/portal.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { installCardText } from "../../portal/lib.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const CARD = { label: "ada", version: 3, key: "k7m2q9dx4tab3fz0wnr8", sha256: "a".repeat(64), date: "2026-09-29" };

test("the card names no pinned URL while the API names none", () => {
  for (const pinned of [undefined, null]) {
    const text = installCardText({ ...CARD, pinned });
    assert.doesNotMatch(text, /v3\.ada\.blnx\.io/);
    assert.doesNotMatch(text, /Pinned URL/);
    assert.match(text, /Latest URL: https:\/\/ada\.blnx\.io\//);
    assert.match(text, /type the hostname ada\.blnx\.io\.\n/);
  }
});

test("the card names the pinned URL when the API names it", () => {
  const text = installCardText({ ...CARD, pinned: "https://v3.ada.blnx.io/" });
  assert.match(text, /Pinned URL: https:\/\/v3\.ada\.blnx\.io\//);
  assert.match(text, /or v3\.ada\.blnx\.io for this exact version/);
});

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

test("no deployed portal or site file names localhost", () => {
  const hits = [...files(join(ROOT, "portal")), ...files(join(ROOT, "site"))].filter((p) =>
    readFileSync(p).includes("localhost"),
  );
  assert.deepEqual(hits, []);
});

test("the portal CSP allows only the production API", () => {
  const headers = readFileSync(join(ROOT, "portal/_headers"), "utf8");
  const page = readFileSync(join(ROOT, "portal/index.html"), "utf8");
  for (const csp of [headers, page]) assert.match(csp, /connect-src https:\/\/api\.blunix\.io;/);
  assert.match(page, /<meta name="blunix-api" content="https:\/\/api\.blunix\.io\/v1">/);
});
