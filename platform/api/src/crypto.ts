// Threats: predictable tokens and timing-leaky comparison of hashes and tokens.
// Every secret here comes from crypto.getRandomValues. Every comparison hashes both
// sides to 32 bytes first, so neither content nor length shapes the timing.
// This file does not store, expire, or rotate anything.

const enc = new TextEncoder();

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 32 random bytes, base64url, 43 characters.
export function randomToken(): string {
  return b64url(randomBytes(32));
}

export function hex(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of u) s += x.toString(16).padStart(2, "0");
  return s;
}

export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const input = typeof data === "string" ? enc.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return hex(await sha256(data));
}

export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  return crypto.subtle.timingSafeEqual(ha, hb) && a.length === b.length;
}
