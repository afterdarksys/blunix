// The API's Profile validator (platform/api/src/profile.ts) keeps its own copies of
// the model names and the package allowlist. This fails when they drift from
// models/ and lib/blunix/personal.py, which the installer actually uses.
// Run: node --test tests/site/library-models.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const ROOT = new URL("../../", import.meta.url).pathname;
const ts = readFileSync(ROOT + "platform/api/src/profile.ts", "utf8");

function tsList(name) {
  const m = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`, "s").exec(ts);
  assert.ok(m, "no " + name + " in profile.ts");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
}

function models(kind) {
  return readdirSync(ROOT + "models/" + kind)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.slice(0, -5))
    .sort();
}

test("model names match models/", () => {
  assert.deepEqual(tsList("DISKS"), models("disk"));
  assert.deepEqual(tsList("ACCESS"), models("access"));
  assert.deepEqual(tsList("AI"), models("ai"));
  assert.deepEqual(tsList("NETWORKS"), models("network"));
});

test("the package allowlist matches lib/blunix/personal.py", () => {
  const py = readFileSync(ROOT + "lib/blunix/personal.py", "utf8");
  const m = /^PACKAGES = \(([^)]*)\)/ms.exec(py);
  assert.ok(m, "no PACKAGES in personal.py");
  const names = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(tsList("PACKAGES"), names);
});
