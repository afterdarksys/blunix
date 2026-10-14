// The portal's profile import must agree with the blunix CLI on the shared
// cases in tests/fixtures/profiles/cases.json (synced from blunix-utils).
// Run: node --test tests/site/profile.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  adminNameProblem, buildNode, importProfile, profileFromForm, sshKeyProblem, targetProblem,
} from "../../portal/lib.js";

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
    [{ ...base, kind: "Node", hostname: "ada-1", target: "/dev/sda", distribution: undefined }, "refused target"],
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

const KEY = JSON.parse(read("personal-node.json")).admin.sshPublicKey;
const FORM = {
  label: "ada", hostname: "ada-1", disk: "cloud-vm", access: "regular",
  network: { mode: "dhcp", match: "en*, eth*" },
};

test("an imported personal node fills every personal field", () => {
  const out = importProfile(read("personal-node.json"), "personal-node.json");
  assert.equal(out.error, undefined);
  assert.deepEqual(out.values.packages, ["curl", "git"]);
  assert.deepEqual(out.values.admin, { name: "operator", key: KEY });
  assert.deepEqual(out.values.install, { target: "S1", erase: true, reboot: false });
  const built = buildNode({ label: "ada", ...out.values });
  assert.equal(built.errors, undefined);
  assert.match(built.yaml, /^target: "S1"$/m);
  assert.match(built.yaml, /^install:\n  erase: true\n  reboot: false$/m);
  assert.match(built.yaml, /^admin:\n  name: "operator"\n  sshPublicKey: "ssh-ed25519 /m);
  assert.match(built.yaml, /^packages:\n  - "curl"\n  - "git"$/m);
});

test("the build form checks the personal fields", () => {
  const cases = [
    [{ packages: ["git", "netcat"] }, "packages"],
    [{ admin: { name: "root", key: KEY } }, "adminName"],
    [{ admin: { name: "operator", key: "" } }, "adminKey"],
    [{ admin: { name: "", key: KEY } }, "adminName"],
    [{ admin: { name: "operator", key: KEY + " me@laptop" } }, "adminKey"],
    [{ install: { target: "", erase: true } }, "target"],
    [{ install: { target: "/dev/sda", erase: false } }, "target"],
  ];
  for (const [extra, field] of cases) {
    const out = buildNode({ ...FORM, ...extra });
    assert.ok(out.errors && out.errors[field], JSON.stringify(extra));
  }
  const plain = buildNode(FORM);
  assert.equal(plain.errors, undefined);
  assert.doesNotMatch(plain.yaml, /^(packages|admin|install|target):/m);
  const askFirst = buildNode({ ...FORM, install: { target: "nvme0n1", erase: false } });
  assert.match(askFirst.yaml, /^target: "nvme0n1"$/m);
  assert.doesNotMatch(askFirst.yaml, /^install:/m);
});

test("key, name and target checks", () => {
  assert.equal(sshKeyProblem(KEY), null);
  for (const bad of ["ssh-rsa AAAA", "ssh-ed25519 " + "A".repeat(68), "-----BEGIN OPENSSH PRIVATE KEY-----", ""]) {
    assert.ok(sshKeyProblem(bad), bad);
  }
  assert.equal(adminNameProblem("operator"), null);
  for (const bad of ["root", "Operator", "1op", "", "a".repeat(32)]) assert.ok(adminNameProblem(bad), bad);
  assert.equal(targetProblem("nvme0n1"), null);
  assert.ok(targetProblem("/dev/sda"));
});

test("a template from the form is a Profile with nothing personal", () => {
  const out = profileFromForm({ ...FORM, packages: ["vim", "git"], admin: { name: "operator", key: KEY },
    install: { target: "S1", erase: true } }, "lab");
  assert.equal(out.error, undefined);
  assert.equal(out.profile.kind, "Profile");
  assert.equal(out.profile.network, "dhcp-any");
  assert.deepEqual(out.profile.packages, ["git", "vim"]);
  for (const key of ["hostname", "admin", "install", "target"]) assert.ok(!(key in out.profile), key);
  assert.deepEqual(importProfile(JSON.stringify(out.profile), "x.json").values.packages, ["git", "vim"]);
  const ens = profileFromForm({ ...FORM, network: { mode: "dhcp", match: "ens3" } }, "lab");
  assert.deepEqual(ens.profile.network, { match: ["ens3"], dhcp: true });
  assert.match(profileFromForm({ ...FORM, network: { mode: "static" } }, "lab").error, /static address/);
  assert.match(profileFromForm(FORM, "Bad Name").error, /template name/);
});
