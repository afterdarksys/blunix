// Threats: an upload that is not age ciphertext (plaintext, a script, YAML), an age file
// encrypted to a recipient key instead of a passphrase, and a header built to confuse a
// loose parser. The header is parsed, never decrypted. Armor is unwrapped, so what is
// stored, hashed and served is always the binary file. This does not prove the payload
// decrypts, and it does not know the passphrase.

export const UPLOAD_LIMIT = 256 * 1024;

const MAGIC = "age-encryption.org/v1";
const ARMOR_BEGIN = "-----BEGIN AGE ENCRYPTED FILE-----";
const ARMOR_END = "-----END AGE ENCRYPTED FILE-----";
const COLUMNS = 64;
const MAX_HEADER_LINES = 16;
// age refuses scrypt work factors above 22 by default, so the installer would too.
const MAX_LOG_N = 22;
const B64_RAW = /^[A-Za-z0-9+/]*$/;
const B64_PADDED = /^[A-Za-z0-9+/]*={0,2}$/;

function decodeRaw(s: string): Uint8Array | null {
  if (!B64_RAW.test(s) || s.length % 4 === 1) return null;
  return decodeCanonical(s, s.padEnd(Math.ceil(s.length / 4) * 4, "="), false);
}

function decodePadded(s: string): Uint8Array | null {
  if (!B64_PADDED.test(s) || s.length % 4 !== 0) return null;
  return decodeCanonical(s, s, true);
}

// Rejects non-canonical encodings: stray bits in the last character decode, but do not
// re-encode to the same text.
function decodeCanonical(original: string, padded: string, keepPad: boolean): Uint8Array | null {
  let bin: string;
  try {
    bin = atob(padded);
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  let again = btoa(bin);
  if (!keepPad) again = again.replace(/=+$/, "");
  return again === original ? out : null;
}

class Lines {
  pos = 0;
  constructor(private readonly b: Uint8Array) {}

  // One LF-terminated line of printable ASCII, or null.
  next(): string | null {
    let s = "";
    for (let i = this.pos; i < this.b.length; i++) {
      const c = this.b[i];
      if (c === 0x0a) {
        this.pos = i + 1;
        return s;
      }
      if (c < 0x20 || c > 0x7e) return null;
      s += String.fromCharCode(c);
      if (s.length > 1024) return null;
    }
    return null;
  }
}

interface Stanza {
  type: string;
  args: string[];
  body: Uint8Array;
}

export function isScryptAgeBinary(b: Uint8Array): boolean {
  const lines = new Lines(b);
  if (lines.next() !== MAGIC) return false;
  const stanzas: Stanza[] = [];
  let sawMac = false;
  for (let n = 0; n < MAX_HEADER_LINES; n++) {
    const line = lines.next();
    if (line === null) return false;
    if (line.startsWith("--- ")) {
      const mac = decodeRaw(line.slice(4));
      if (!mac || mac.length !== 32) return false;
      sawMac = true;
      break;
    }
    if (!line.startsWith("-> ")) return false;
    if (stanzas.length > 0) return false;
    const args = line.slice(3).split(" ");
    if (args.some((a) => a.length === 0)) return false;
    const parts: string[] = [];
    for (;;) {
      const body = lines.next();
      if (body === null || body.length > COLUMNS) return false;
      parts.push(body);
      n++;
      if (body.length < COLUMNS) break;
      if (n >= MAX_HEADER_LINES) return false;
    }
    const decoded = decodeRaw(parts.join(""));
    if (!decoded) return false;
    stanzas.push({ type: args[0], args: args.slice(1), body: decoded });
  }
  if (!sawMac || stanzas.length !== 1) return false;
  const s = stanzas[0];
  if (s.type !== "scrypt" || s.args.length !== 2) return false;
  const salt = decodeRaw(s.args[0]);
  if (!salt || salt.length !== 16) return false;
  if (!/^[1-9][0-9]?$/.test(s.args[1]) || Number(s.args[1]) > MAX_LOG_N) return false;
  if (s.body.length !== 32) return false;
  // Payload: a 16-byte nonce, then at least one chunk with its 16-byte tag.
  return b.length - lines.pos >= 32;
}

// The binary file inside the armor, or null.
export function dearmorScryptAge(b: Uint8Array): Uint8Array | null {
  let text = "";
  for (const c of b) {
    if (c > 0x7e || (c < 0x20 && c !== 0x0a && c !== 0x0d && c !== 0x09)) return null;
    text += String.fromCharCode(c);
  }
  const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  if (lines[0] !== ARMOR_BEGIN) return null;
  const end = lines.indexOf(ARMOR_END);
  if (end < 2) return null;
  if (lines.slice(end + 1).some((l) => l.trim() !== "")) return null;
  const body = lines.slice(1, end);
  for (let i = 0; i < body.length; i++) {
    const last = i === body.length - 1;
    if (last ? body[i].length === 0 || body[i].length > COLUMNS : body[i].length !== COLUMNS) return null;
  }
  const decoded = decodePadded(body.join(""));
  return decoded !== null && isScryptAgeBinary(decoded) ? decoded : null;
}

// The only question the API asks of an upload. Returns the binary age file to store,
// or null for anything refused.
export function acceptCiphertext(b: Uint8Array): Uint8Array | null {
  if (b.length === 0 || b.length > UPLOAD_LIMIT) return null;
  const head = new TextDecoder().decode(b.subarray(0, 64));
  if (head.startsWith(MAGIC + "\n")) return isScryptAgeBinary(b) ? b : null;
  if (head.startsWith(ARMOR_BEGIN)) return dearmorScryptAge(b);
  return null;
}
