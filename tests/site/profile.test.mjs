// The portal's profile import must agree with the blunix CLI on the shared
// cases in tests/fixtures/profiles/cases.json (synced from blunix-utils).
// Run: node --test tests/site/profile.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildNode, importProfile } from "../../portal/lib.js";

const DIR = new URL("../fixtures/profiles/", import.meta.url);
const read = (name) => readFileSync(new URL(name, DIR), "utf8");
const { cases } = JSON.parse(read("cases.json"));

test("every JSON case gets the same outcome as the CLI", () => {
  const json = cases.filter((c) => c.file.endsWith(".json"));
  assert.ok(json.length >= 3);
  for (const c of json) {
    const out = importProfile(read(c.file), c.file);
    if (c.ok) {
      assert.equal(out.error, undefined, c.file + ": " + out.error);
      assert.equal(out.kind, c.kind, c.file);
    } else {
      assert.equal(out.error, c.error, c.file);
    }
  }
});

test("YAML files are refused with the conversion command, never half-read", () => {
  for (const c of cases.filter((x) => x.file.endsWith(".yaml"))) {
    const out = importProfile(read(c.file), c.file);
    assert.match(out.error, /blunix profile render --format json/, c.file);
  }
});

test("an imported profile builds a node document with the profile's choices", () => {
  const out = importProfile(read("lab-speech.json"), "lab-speech.json");
  const built = buildNode({ label: "ada", ...out.values, hostname: "ada-1" });
  assert.equal(built.errors, undefined);
  assert.match(built.yaml, /^kind: Node$/m);
  assert.match(built.yaml, /^disk: metal-luks$/m);
  assert.match(built.yaml, /^access: full-speech$/m);
  assert.match(built.yaml, /^  dhcp: true$/m);
});

test("an imported node keeps its hostname and static network", () => {
  const node = {
    apiVersion: "blunix.dev/v1", kind: "Node", name: "grace", hostname: "grace-1", disk: "cloud-vm",
    network: { match: ["en*"], address: "192.0.2.22/24", gateway: "192.0.2.1", dns: ["192.0.2.53"] },
    access: "regular", ai: "default",
    update: { url: "https://updates.blunix.io/blunix", channel: "stable" }, sysexts: [],
  };
  const out = importProfile(JSON.stringify(node), "grace.json");
  assert.equal(out.values.hostname, "grace-1");
  const built = buildNode({ label: "grace", ...out.values });
  assert.equal(built.errors, undefined);
  assert.match(built.yaml, /address: "192\.0\.2\.22\/24"/);
});

test("fields the form cannot show are refused, not dropped", () => {
  const base = JSON.parse(read("lab-speech.json"));
  const cases2 = [
    [{ ...base, ai: "other" }, "model not found"],
    [{ ...base, update: { ...base.update, url: "https://mirror.example/blunix" } }, "refused update"],
    [{ ...base, sysexts: ["x"] }, "refused sysexts"],
    [{ ...base, network: "static-single" }, "network model not available in the portal"],
    [{ ...base, kind: "Node", hostname: "ada-1", target: "nvme0n1", distribution: undefined }, "refused target"],
    [{ ...base, nested: { wifi_psk: "x" } }, "refused field"],
  ];
  for (const [doc, error] of cases2) {
    assert.equal(importProfile(JSON.stringify(doc), "x.json").error, error);
  }
});

test("a repeated key nested anywhere is refused", () => {
  const text = read("lab-speech.json").replace('"channel": "stable"', '"channel": "stable", "channel": "stable"');
  assert.equal(importProfile(text, "x.json").error, "duplicate key");
});
