// Pure functions for the portal: the key, the label, the node document, and
// the install package. No DOM, no network, no storage. portal.js drives them.
//
// Threats: a weak or biased key, a label the API will refuse, a node document
// the machine will refuse after the key is already spent, and a key written
// anywhere but the screen and the files the person chooses to save.
// The key only exists in memory here. Nothing in this file logs.

// Crockford base32, lowercase. No i, l, o, u. Matches lib/blunix/keyfmt.py.
export const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export const KEY_LENGTH = 20; // 20 * 5 bits = 100 bits
export const GROUP = 5;

// Rejection sampling over single CSPRNG bytes. A byte is kept only when it is
// below the largest multiple of the alphabet size that fits in 256, so every
// character is equally likely. The alphabet has 32 characters and 256 % 32 is
// 0, so the limit is 256 and no byte is ever rejected: taking the byte modulo
// 32 is the same as keeping its low 5 bits, with no bias. The loop stays so
// the function remains correct if the alphabet ever changes size.
export function generateKey(getRandomValues = (b) => crypto.getRandomValues(b)) {
  if (ALPHABET.length !== 32 || new Set(ALPHABET).size !== 32) {
    throw new Error("key alphabet is wrong");
  }
  const limit = 256 - (256 % ALPHABET.length);
  const out = [];
  const buf = new Uint8Array(32);
  while (out.length < KEY_LENGTH) {
    getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < KEY_LENGTH; i++) {
      if (buf[i] < limit) out.push(ALPHABET[buf[i] % ALPHABET.length]);
    }
  }
  buf.fill(0);
  const key = out.join("");
  if (!isCanonical(key)) throw new Error("key generation failed");
  return key;
}

export function isCanonical(value) {
  if (typeof value !== "string" || value.length !== KEY_LENGTH) return false;
  for (const ch of value) if (!ALPHABET.includes(ch)) return false;
  return true;
}

// xxxxx-xxxxx-xxxxx-xxxxx, the form on the install card.
export function displayKey(canonical) {
  if (!isCanonical(canonical)) throw new Error("not a canonical key");
  return keyGroups(canonical).join("-");
}

export function keyGroups(canonical) {
  const groups = [];
  for (let i = 0; i < KEY_LENGTH; i += GROUP) groups.push(canonical.slice(i, i + GROUP));
  return groups;
}

// "k 7 m 2 q" per group, so a screen reader spells instead of guessing a word.
export function spellGroup(group) {
  return group.split("").join(" ");
}

// ---- Labels ----------------------------------------------------------------

export const LABEL_RE = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;
export const RESERVED = [
  "www", "api", "updates", "log", "mail", "build", "portal",
  "admin", "root", "blunix", "proxy", "status",
];

// Returns null when the label is acceptable, or one sentence saying why not.
export function labelProblem(label) {
  if (typeof label !== "string" || label === "") return "Type a label.";
  if (label.length < 2) return "A label is at least 2 characters.";
  if (label.length > 32) return "A label is at most 32 characters.";
  if (/[A-Z]/.test(label)) return "Use lowercase letters only.";
  if (!/^[a-z]/.test(label)) return "A label starts with a letter.";
  if (/-$/.test(label)) return "A label ends with a letter or a digit.";
  if (label.includes("--")) return "A label cannot contain two hyphens in a row.";
  if (!LABEL_RE.test(label)) return "Use only lowercase letters, digits, and hyphens.";
  if (RESERVED.includes(label)) return label + " is reserved.";
  if (/^v[0-9]+$/.test(label)) return "A label cannot be v followed by digits. Those names are versions.";
  return null;
}

// ---- Node document ---------------------------------------------------------

export const API_VERSION = "blunix.dev/v1";
export const DISKS = ["cloud-vm", "metal-luks"];
export const ACCESS = ["regular", "full-speech", "console-speech", "large-print", "advanced"];
export const UPDATE_URL = "https://updates.blunix.io/blunix";
export const MAX_DOCUMENT = 64 * 1024;
export const MAX_CIPHER = 256 * 1024;

// Same rule as schema.require_name: /etc/hostname.
const NAME_RE = /^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;
const MATCH_RE = /^(en[a-z0-9]{1,14}|eth[0-9]{1,4})$/;

export function hostnameProblem(value) {
  if (typeof value !== "string" || value === "") return "Type a hostname.";
  if (!NAME_RE.test(value)) {
    return "A hostname is lowercase letters, digits, and hyphens, starts with a letter, does not end with a hyphen, and is at most 63 characters.";
  }
  return null;
}

// "en*, eth*" -> ["en*", "eth*"], or a sentence.
export function parseMatch(text) {
  const items = splitList(text);
  if (items.length === 0) return { problem: "Name at least one interface, such as en*." };
  if (items.length > 8) return { problem: "Name at most 8 interfaces." };
  for (const item of items) {
    if (item !== "en*" && item !== "eth*" && !MATCH_RE.test(item)) {
      return { problem: item + " is not an interface this host accepts. Use en*, eth*, or a name like ens3." };
    }
  }
  return { value: items };
}

function splitList(text) {
  return String(text || "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseIPv4(text) {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const out = [];
  for (const p of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function isIPv6(text) {
  if (!/^[0-9a-fA-F:.]+$/.test(text) || !text.includes(":")) return false;
  try {
    return new URL("http://[" + text + "]/").hostname !== "";
  } catch {
    return false;
  }
}

// Returns {family, canonical} or null. Refuses unspecified and multicast,
// like network.py.
function parseHost(text) {
  const v4 = parseIPv4(text);
  if (v4) {
    if (v4.every((n) => n === 0)) return null;
    if (v4[0] >= 224 && v4[0] <= 239) return null;
    return { family: 4, canonical: v4.join(".") };
  }
  if (isIPv6(text)) {
    const canonical = new URL("http://[" + text + "]/").hostname.slice(1, -1);
    if (canonical === "::") return null;
    if (/^ff/i.test(canonical)) return null;
    return { family: 6, canonical };
  }
  return null;
}

export function addressProblem(value) {
  const text = String(value || "").trim();
  if (text === "") return "Type an address with a prefix, such as 10.0.0.5/24.";
  const slash = text.indexOf("/");
  if (slash < 0) return "Add the prefix length, such as /24.";
  const host = parseHost(text.slice(0, slash));
  if (!host) return "That is not a usable IP address.";
  const prefix = text.slice(slash + 1);
  const max = host.family === 4 ? 32 : 128;
  if (!/^[0-9]{1,3}$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > max) {
    return "The prefix length is 1 to " + max + ".";
  }
  return null;
}

export function hostProblem(value, what) {
  const text = String(value || "").trim();
  if (text === "") return "Type the " + what + " address.";
  if (text.includes("/")) return "The " + what + " is an address without a prefix.";
  if (!parseHost(text)) return "The " + what + " is not a usable IP address.";
  return null;
}

export function parseDns(text) {
  const items = splitList(text);
  if (items.length === 0) return { problem: "Name at least one DNS server." };
  if (items.length > 4) return { problem: "Name at most 4 DNS servers." };
  for (const item of items) {
    const p = hostProblem(item, "DNS server");
    if (p) return { problem: item + ": " + p };
  }
  return { value: items };
}

// A double-quoted YAML scalar. Every user value is quoted, so a label such as
// "no" or "on" cannot turn into a boolean. JSON strings of ASCII are valid
// YAML double-quoted scalars.
function q(value) {
  if (!/^[\x20-\x7e]*$/.test(value)) throw new Error("non-ASCII value");
  return JSON.stringify(value);
}

// Check every field and return {errors: {field: sentence}} or {yaml}.
// input: {label, hostname, disk, access, network: {mode, match, address, gateway, dns}}
export function buildNode(input) {
  const errors = {};
  const lp = labelProblem(input.label);
  if (lp) errors.label = lp;
  const hp = hostnameProblem(input.hostname);
  if (hp) errors.hostname = hp;
  if (!DISKS.includes(input.disk)) errors.disk = "Pick a disk layout.";
  if (!ACCESS.includes(input.access)) errors.access = "Pick an access profile.";
  const net = input.network || {};
  const match = parseMatch(net.match);
  if (match.problem) errors.match = match.problem;
  let dns = null;
  if (net.mode === "static") {
    const ap = addressProblem(net.address);
    if (ap) errors.address = ap;
    const gp = hostProblem(net.gateway, "gateway");
    if (gp) errors.gateway = gp;
    dns = parseDns(net.dns);
    if (dns.problem) errors.dns = dns.problem;
    if (!ap && !gp) {
      const ip = String(net.address).trim().split("/")[0];
      const a = parseHost(ip);
      const g = parseHost(String(net.gateway).trim());
      if (a && g && a.canonical === g.canonical) errors.gateway = "The gateway cannot be this machine's own address.";
    }
  } else if (net.mode !== "dhcp") {
    errors.network = "Pick DHCP or a static address.";
  }
  if (Object.keys(errors).length) return { errors };

  const lines = [
    "apiVersion: " + API_VERSION,
    "kind: Node",
    "name: " + q(input.label),
    "hostname: " + q(input.hostname),
    "disk: " + input.disk,
    "network:",
    "  match:",
    ...match.value.map((m) => "    - " + q(m)),
  ];
  if (net.mode === "dhcp") {
    lines.push("  dhcp: true");
  } else {
    lines.push("  address: " + q(String(net.address).trim()));
    lines.push("  gateway: " + q(String(net.gateway).trim()));
    lines.push("  dns:");
    for (const d of dns.value) lines.push("    - " + q(d));
  }
  lines.push(
    "access: " + input.access,
    "ai: default",
    "update:",
    "  url: " + UPDATE_URL,
    "  channel: stable",
    "sysexts: []",
  );
  const yaml = lines.join("\n") + "\n";
  if (new TextEncoder().encode(yaml).length > MAX_DOCUMENT) {
    return { errors: { form: "The document is larger than 64 KiB." } };
  }
  return { yaml };
}

// ---- Install package -------------------------------------------------------

export function latestUrl(label) {
  return "https://" + label + ".blnx.io/";
}

export function pinnedUrl(label, version) {
  return "https://v" + version + "." + label + ".blnx.io/";
}

export function validVersion(n) {
  return Number.isInteger(n) && n >= 1 && n <= 999999;
}

// `pinned` is the pinned URL, or null while pinned hosts have no certificate.
export function installCardText({ label, version, pinned = null, key, sha256, date }) {
  const groups = keyGroups(key);
  return [
    "blunix install card.",
    "",
    "Label: " + label + ". Version: " + version + ".",
    "Latest URL: " + latestUrl(label),
    ...(pinned ? ["Pinned URL: " + pinned] : []),
    "Key: " + displayKey(key),
    "Key, spelled: " + groups.map((g, i) => "group " + (i + 1) + ", " + spellGroup(g)).join("; ") + ".",
    "Ciphertext sha256: " + sha256,
    "Date: " + date + ".",
    "",
    pinned
      ? "At the installer, type the hostname " + label + ".blnx.io, or v" + version + "." + label + ".blnx.io for this exact version."
      : "At the installer, type the hostname " + label + ".blnx.io.",
    "Then type the key. Hyphens and spaces are optional.",
    "Keep this card private. Anyone with the URL and this key can read the build.",
    "",
  ].join("\n");
}

export function installBundle({ label, version, sha256, armored }) {
  return JSON.stringify({
    apiVersion: "blunix.io/v1",
    kind: "InstallBundle",
    label,
    version,
    document: { encoding: "age", sha256, body: armored },
  }, null, 2) + "\n";
}

export function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
