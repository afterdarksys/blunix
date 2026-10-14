// A Profile document: a node document with no hostname, label, target, admin or
// install, so it can be shared. This mirrors lib/blunix/profile.py and gives the same
// refusal messages, in the same order, for the shared cases in
// tests/fixtures/profiles/cases.json.
//
// Threats: a template that carries personal or secret fields into the library, a
// duplicate key that hides one value behind another, an update URL that points a
// machine elsewhere, and a package name that is really an option. The library stores
// only documents that pass here. One deliberate difference from the CLI: an inline
// static network is refused, because an address belongs to one machine, never to a
// shared template.

export const API_VERSION = "blunix.dev/v1";
// Must match blunix-utils models/ and lib/blunix/personal.py.
export const DISKS = ["cloud-vm", "metal-luks"];
export const ACCESS = ["regular", "full-speech", "console-speech", "large-print", "advanced"];
export const AI = ["default"];
export const NETWORKS = ["dhcp-any", "static-single"];
export const PACKAGES = [
  "curl", "dnsutils", "git", "htop", "jq", "nginx", "podman", "postgresql-client",
  "python3", "rsync", "strace", "tcpdump", "tmux", "vim", "wget",
];
export const DISTRIBUTIONS = ["debian"];

const PROFILE_KEYS = ["apiVersion", "kind", "name", "distribution", "disk", "network", "access", "ai", "update", "sysexts", "packages"];
const CARRIED = ["disk", "network", "access", "ai", "update", "sysexts"];
const BANNED = ["private_key", "psk", "password", "token", "api_key", "passphrase", "recovery_token", "key_file", "secret", "wifi_psk"];
const NAME = /^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;
const SPECIFIC = /^(en[a-z0-9]{1,14}|eth[0-9]{1,4})$/;

export class Refused extends Error {}

function refuse(message: string): never {
  throw new Refused(message);
}

// JSON.parse keeps the last of two equal keys without a word. This walks the text and
// refuses a repeated key in any object, as the CLI's YAML loader does.
export function refuseDuplicateKeys(text: string): void {
  const stack: (Set<string> | null)[] = [];
  let expectKey = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const seen = stack.length ? stack[stack.length - 1] : null;
      if (expectKey && seen) {
        const key = JSON.parse(text.slice(i, j + 1)) as string;
        if (seen.has(key)) refuse("duplicate key");
        seen.add(key);
      }
      expectKey = false;
      i = j;
      continue;
    }
    if (ch === "{") {
      stack.push(new Set());
      expectKey = true;
    } else if (ch === "[") {
      stack.push(null);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    } else if (ch === ",") {
      expectKey = stack.length > 0 && stack[stack.length - 1] !== null;
    }
  }
}

function banned(key: string): boolean {
  const norm = key.trim().toLowerCase().replace(/-/g, "_");
  return BANNED.some((w) => new RegExp("(^|_)" + w + "($|_)").test(norm));
}

function refuseBanned(value: unknown): void {
  if (Array.isArray(value)) value.forEach(refuseBanned);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (banned(k)) refuse("refused field");
      refuseBanned(v);
    }
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function name(v: unknown, what: string): string {
  if (typeof v !== "string" || !NAME.test(v)) refuse("refused " + what);
  return v;
}

function packages(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > PACKAGES.length) refuse("refused packages");
  if (v.some((p) => typeof p !== "string" || !PACKAGES.includes(p))) refuse("refused packages");
  if (new Set(v).size !== v.length) refuse("refused packages");
  return [...(v as string[])].sort();
}

function network(v: unknown): void {
  if (isObject(v)) {
    if (Object.keys(v).some((k) => !["match", "dhcp", "address", "gateway", "dns"].includes(k))) refuse("unknown field");
    const match = v.match;
    if (!Array.isArray(match) || match.length === 0 || match.length > 8) refuse("refused interface match");
    for (const m of match) {
      if (m !== "en*" && m !== "eth*" && !(typeof m === "string" && SPECIFIC.test(m))) refuse("refused interface match");
    }
    if (v.dhcp !== true || "address" in v || "gateway" in v || "dns" in v) refuse("refused network");
    return;
  }
  name(v, "network");
}

function update(v: unknown): void {
  if (!isObject(v)) refuse("refused update");
  if (Object.keys(v).some((k) => k !== "url" && k !== "channel")) refuse("unknown field");
  const url = v.url;
  if (typeof url !== "string" || !url.startsWith("https://") || url.length > 256) refuse("refused update");
  const host = url.slice("https://".length).split("/")[0];
  if (!host || host.includes("@") || url.includes("\\") || url.includes(" ")) refuse("refused update");
  if ([...url].some((c) => c.charCodeAt(0) < 33 || c.charCodeAt(0) > 126)) refuse("refused update");
  if (v.channel !== "stable") refuse("refused channel");
}

function model(value: string, known: string[]): void {
  if (!known.includes(value)) refuse("model not found");
}

// Returns the profile to store, or throws Refused with the CLI's message.
export function checkProfile(doc: unknown): Record<string, unknown> {
  if (!isObject(doc)) refuse("rejected plaintext");
  refuseBanned(doc);
  if (Object.keys(doc).some((k) => !PROFILE_KEYS.includes(k))) refuse("unknown field");
  if (doc.apiVersion !== API_VERSION) refuse("refused apiVersion");
  if (doc.kind !== "Profile") refuse("refused kind");
  name(doc.name, "name");
  const distribution = doc.distribution ?? "debian";
  if (!DISTRIBUTIONS.includes(distribution as string)) refuse("refused distribution");
  for (const key of CARRIED) if (!(key in doc)) refuse("refused " + key);
  if ("packages" in doc) packages(doc.packages);
  // The order parse_node uses on the rendered node.
  const disk = name(doc.disk, "disk");
  network(doc.network);
  const access = name(doc.access, "access");
  const ai = name(doc.ai, "ai");
  update(doc.update);
  if (!Array.isArray(doc.sysexts) || doc.sysexts.length !== 0) refuse("refused sysexts");
  model(disk, DISKS);
  if (typeof doc.network === "string") model(doc.network, NETWORKS);
  model(access, ACCESS);
  model(ai, AI);
  const out: Record<string, unknown> = {};
  for (const key of PROFILE_KEYS) if (key in doc) out[key] = doc[key];
  if ("packages" in out) out.packages = packages(out.packages);
  return out;
}

export function checkProfileText(text: string): Record<string, unknown> {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    refuse("rejected plaintext");
  }
  if (!isObject(doc)) refuse("rejected plaintext");
  refuseDuplicateKeys(text);
  return checkProfile(doc);
}
