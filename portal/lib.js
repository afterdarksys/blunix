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
// Must match lib/blunix/personal.py; tests/site/library-models.test.mjs checks it.
export const PACKAGES = [
  "curl", "dnsutils", "git", "htop", "jq", "nginx", "podman", "postgresql-client",
  "python3", "rsync", "strace", "tcpdump", "tmux", "vim", "wget",
];
const ADMIN_RE = /^[a-z][a-z0-9-]{0,30}$/;
const RESERVED_ADMINS = ["root", "daemon", "bin", "sys", "sync", "games", "man", "lp", "mail", "news", "uucp",
  "proxy", "www-data", "backup", "list", "irc", "nobody", "systemd-network", "systemd-resolve",
  "systemd-timesync", "messagebus", "sshd", "_apt", "blunix"];
const ED25519_RE = /^ssh-ed25519 [A-Za-z0-9+/]{68}$/;
const ED25519_BLOB = [0, 0, 0, 11, 115, 115, 104, 45, 101, 100, 50, 53, 53, 49, 57, 0, 0, 0, 32];
const TARGET_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

// ---- Personal build fields (lib/blunix/personal.py) -------------------------

export function adminNameProblem(value) {
  if (!ADMIN_RE.test(value || "")) {
    return "An administrator name is lowercase letters, digits and hyphens, starts with a letter, and is at most 31 characters.";
  }
  if (RESERVED_ADMINS.includes(value)) return value + " is a system account. Pick another name.";
  return null;
}

// An Ed25519 public key in OpenSSH form, nothing before or after it.
export function sshKeyProblem(value) {
  const key = String(value || "").trim();
  if (!ED25519_RE.test(key)) {
    return "Paste one ssh-ed25519 public key, such as the line in ~/.ssh/id_ed25519.pub, without the comment at the end.";
  }
  let blob;
  try {
    blob = atob(key.split(" ")[1]);
  } catch {
    return "That key is not valid base64.";
  }
  if (blob.length !== 51 || ED25519_BLOB.some((b, i) => blob.charCodeAt(i) !== b)) {
    return "That is not an Ed25519 public key.";
  }
  return null;
}

export function targetProblem(value) {
  if (!TARGET_RE.test(value || "")) return "A disk is a kernel name such as nvme0n1, or a serial. Not a path.";
  return null;
}

function packagesValid(value) {
  return Array.isArray(value) && value.length <= PACKAGES.length &&
    value.every((p) => typeof p === "string" && PACKAGES.includes(p)) && new Set(value).size === value.length;
}
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
  const packages = Array.isArray(input.packages) ? [...input.packages].sort() : [];
  if (!packagesValid(packages)) errors.packages = "Pick packages from the list only.";
  const admin = input.admin || {};
  const adminName = String(admin.name || "").trim();
  const adminKey = String(admin.key || "").trim();
  if (adminName || adminKey) {
    const np = adminNameProblem(adminName);
    if (np) errors.adminName = np;
    const kp = sshKeyProblem(adminKey);
    if (kp) errors.adminKey = kp;
  }
  const install = input.install || {};
  const target = String(install.target || "").trim();
  if (target) {
    const tp = targetProblem(target);
    if (tp) errors.target = tp;
  }
  if (install.erase && !target) errors.target = "Name the disk to erase, or untick the erase permission.";
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
  if (packages.length) {
    lines.push("packages:");
    for (const p of packages) lines.push("  - " + q(p));
  }
  if (target) lines.push("target: " + q(target));
  if (target && install.erase) {
    lines.push("install:", "  erase: true", "  reboot: " + (install.reboot ? "true" : "false"));
  }
  if (adminName) {
    lines.push("admin:", "  name: " + q(adminName), "  sshPublicKey: " + q(adminKey));
  }
  const yaml = lines.join("\n") + "\n";
  if (new TextEncoder().encode(yaml).length > MAX_DOCUMENT) {
    return { errors: { form: "The document is larger than 64 KiB." } };
  }
  return { yaml };
}

// ---- Profile import --------------------------------------------------------
//
// Reads a Profile or Node document as JSON and returns form values. The refusal
// messages match the blunix CLI (lib/blunix/profile.py), and
// tests/fixtures/profiles/cases.json holds the outcomes both must give.
// YAML is converted with `blunix profile render --format json`; this page has no
// YAML parser, and one that cannot refuse aliases would weaken the CLI's rules.

const BANNED = ["private_key", "psk", "password", "token", "api_key", "passphrase",
  "recovery_token", "key_file", "secret", "wifi_psk"];
const PROFILE_KEYS = ["apiVersion", "kind", "name", "distribution", "disk", "network",
  "access", "ai", "update", "sysexts", "packages"];
const NODE_KEYS = ["apiVersion", "kind", "name", "hostname", "disk", "network", "access",
  "ai", "update", "sysexts", "target", "packages", "admin", "install"];
const INLINE_NET_KEYS = ["match", "dhcp", "address", "gateway", "dns"];

class Refused extends Error {}

// JSON.parse keeps the last of two equal keys without a word. This walks the
// text once and refuses a repeated key in any object, as the CLI loader does.
function refuseDuplicateKeys(text) {
  const stack = [];
  let i = 0;
  let expectKey = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (expectKey && stack.length && stack[stack.length - 1]) {
        const key = JSON.parse(text.slice(i, j + 1));
        const seen = stack[stack.length - 1];
        if (seen.has(key)) throw new Refused("duplicate key");
        seen.add(key);
      }
      expectKey = false;
      i = j + 1;
      continue;
    }
    if (ch === "{") { stack.push(new Set()); expectKey = true; }
    else if (ch === "[") { stack.push(null); }
    else if (ch === "}" || ch === "]") { stack.pop(); }
    else if (ch === ",") { expectKey = Boolean(stack.length && stack[stack.length - 1]); }
    i += 1;
  }
}

function isBanned(key) {
  const norm = String(key).trim().toLowerCase().replace(/-/g, "_");
  return BANNED.some((w) => new RegExp("(^|_)" + w + "($|_)").test(norm));
}

function refuseBanned(value) {
  if (Array.isArray(value)) value.forEach(refuseBanned);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (isBanned(k)) throw new Refused("refused field");
      refuseBanned(v);
    }
  }
}

function onlyKeys(obj, allowed) {
  if (Object.keys(obj).some((k) => !allowed.includes(k))) throw new Refused("unknown field");
}

function modelName(value, what, known) {
  if (typeof value !== "string" || !NAME_RE.test(value)) throw new Refused("refused " + what);
  if (!known.includes(value)) throw new Refused("model not found");
  return value;
}

function importNetwork(value) {
  if (value === "dhcp-any") return { mode: "dhcp", match: "en*, eth*", address: "", gateway: "", dns: "" };
  if (typeof value === "string") {
    if (!NAME_RE.test(value)) throw new Refused("refused network");
    throw new Refused("network model not available in the portal");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Refused("refused network");
  onlyKeys(value, INLINE_NET_KEYS);
  const list = (v) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? v.join(", ") : null);
  const match = list(value.match);
  if (match === null) throw new Refused("refused network");
  if (value.dhcp === true) return { mode: "dhcp", match, address: "", gateway: "", dns: "" };
  const dns = list(value.dns);
  if (typeof value.address !== "string" || typeof value.gateway !== "string" || dns === null) {
    throw new Refused("refused network");
  }
  return { mode: "static", match, address: value.address, gateway: value.gateway, dns };
}

// Returns {kind, values: {hostname, disk, access, network, packages, admin, install}}
// or {error}. Fields the form cannot show (another AI model, update URL or
// channel, sysexts) are refused rather than dropped.
export function importProfile(text, fileName = "") {
  try {
    if (/\.ya?ml$/i.test(fileName)) {
      throw new Refused("YAML is not read here. Convert it with blunix profile render --format json.");
    }
    if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_DOCUMENT) {
      throw new Refused("document too large");
    }
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      throw new Refused("rejected plaintext");
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Refused("rejected plaintext");
    refuseDuplicateKeys(text);
    refuseBanned(doc);
    const kind = doc.kind;
    onlyKeys(doc, kind === "Node" ? NODE_KEYS : PROFILE_KEYS);
    if (doc.apiVersion !== API_VERSION) throw new Refused("refused apiVersion");
    if (kind !== "Profile" && kind !== "Node") throw new Refused("refused kind");
    if (typeof doc.name !== "string" || !NAME_RE.test(doc.name)) throw new Refused("refused name");
    if (kind === "Profile" && "distribution" in doc && doc.distribution !== "debian") {
      throw new Refused("refused distribution");
    }
    for (const key of ["disk", "network", "access", "ai", "update", "sysexts"]) {
      if (!(key in doc)) throw new Refused("refused " + key);
    }
    if (kind === "Profile" && "packages" in doc && !packagesValid(doc.packages)) throw new Refused("refused packages");
    let hostname = "";
    if (kind === "Node") {
      if (typeof doc.hostname !== "string" || !NAME_RE.test(doc.hostname)) throw new Refused("refused hostname");
      hostname = doc.hostname;
    }
    const disk = modelName(doc.disk, "disk", DISKS);
    const network = importNetwork(doc.network);
    const access = modelName(doc.access, "access", ACCESS);
    modelName(doc.ai, "ai", ["default"]);
    const up = doc.update;
    if (!up || typeof up !== "object" || Array.isArray(up)) throw new Refused("refused update");
    onlyKeys(up, ["url", "channel"]);
    if (up.channel !== "stable") throw new Refused("refused channel");
    if (up.url !== UPDATE_URL) throw new Refused("refused update");
    if (!Array.isArray(doc.sysexts) || doc.sysexts.length !== 0) throw new Refused("refused sysexts");
    // The personal fields, in parse_node's order: target, packages, admin, install.
    let target = "";
    if ("target" in doc && doc.target !== null) {
      if (typeof doc.target !== "string" || targetProblem(doc.target)) throw new Refused("refused target");
      target = doc.target;
    }
    const packages = "packages" in doc && doc.packages !== null ? doc.packages : [];
    if (!packagesValid(packages)) throw new Refused("refused packages");
    let admin = { name: "", key: "" };
    if ("admin" in doc && doc.admin !== null) {
      const a = doc.admin;
      if (!a || typeof a !== "object" || Array.isArray(a)) throw new Refused("refused admin");
      onlyKeys(a, ["name", "sshPublicKey"]);
      if (typeof a.name !== "string" || adminNameProblem(a.name)) throw new Refused("refused admin");
      if (typeof a.sshPublicKey !== "string" || a.sshPublicKey !== a.sshPublicKey.trim() || sshKeyProblem(a.sshPublicKey)) {
        throw new Refused("refused public key");
      }
      admin = { name: a.name, key: a.sshPublicKey };
    }
    let install = { erase: false, reboot: false };
    if ("install" in doc && doc.install !== null) {
      const i = doc.install;
      if (!i || typeof i !== "object" || Array.isArray(i)) throw new Refused("refused install");
      onlyKeys(i, ["erase", "reboot"]);
      if (i.erase !== true || typeof i.reboot !== "boolean" || !target) throw new Refused("refused install");
      install = { erase: true, reboot: i.reboot };
    }
    return {
      kind,
      name: doc.name,
      values: { hostname, disk, access, network, packages: [...packages].sort(), admin, install: { target, ...install } },
    };
  } catch (err) {
    if (err instanceof Refused) return { error: err.message };
    throw err;
  }
}

// A Profile for the library from the form's shareable choices: never the
// hostname, label, disk target, administrator or install permission.
export function profileFromForm(input, name) {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    return { error: "A template name is lowercase letters, digits and hyphens, and starts with a letter." };
  }
  if (!DISKS.includes(input.disk)) return { error: "Pick a disk layout." };
  if (!ACCESS.includes(input.access)) return { error: "Pick an access profile." };
  const net = input.network || {};
  if (net.mode !== "dhcp") return { error: "A template uses DHCP. A static address belongs to one machine." };
  const match = parseMatch(net.match);
  if (match.problem) return { error: match.problem };
  const packages = Array.isArray(input.packages) ? [...input.packages].sort() : [];
  if (!packagesValid(packages)) return { error: "Pick packages from the list only." };
  const dhcpAny = match.value.length === 2 && match.value.includes("en*") && match.value.includes("eth*");
  const profile = {
    apiVersion: API_VERSION,
    kind: "Profile",
    name,
    disk: input.disk,
    network: dhcpAny ? "dhcp-any" : { match: match.value, dhcp: true },
    access: input.access,
    ai: "default",
    update: { url: UPDATE_URL, channel: "stable" },
    sysexts: [],
  };
  if (packages.length) profile.packages = packages;
  return { profile };
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
