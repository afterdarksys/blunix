import { Encrypter, armor, generateX25519Identity, identityToRecipient } from "age-encryption";
import { env } from "cloudflare:workers";
import { randomToken, sha256Hex } from "../src/crypto";
import worker from "../src/index";

export { env };
export const PORTAL = "https://build.blunix.io";
export const API = "https://api.blunix.io";

export function call(url: string, init?: RequestInit, overrides: Partial<typeof env> = {}): Promise<Response> {
  return worker.fetch(new Request(url, init), { ...env, ...overrides });
}

let counter = 0;
export function uniqueLabel(prefix = "t"): string {
  counter++;
  return `${prefix}${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}${counter}`;
}

// An account with a live session, made directly in D1. The OIDC path has its own tests.
export async function newAccount(): Promise<{ id: number; cookie: string }> {
  const t = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("INSERT INTO accounts (iss, sub, created) VALUES (?, ?, ?) RETURNING id")
    .bind(env.OIDC_ISSUER, crypto.randomUUID(), t)
    .first<{ id: number }>();
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (token_hash, account_id, created, expires) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), row!.id, t, t + 3600)
    .run();
  return { id: row!.id, cookie: token };
}

export function session(cookie: string, extra: Record<string, string> = {}): Record<string, string> {
  return { cookie: `__Host-blx_session=${cookie}`, origin: PORTAL, "x-blunix-csrf": "1", ...extra };
}

export function bearer(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${key}`, ...extra };
}

export function jsonInit(method: string, headers: Record<string, string>, body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export async function reserve(cookie: string, label: string): Promise<Response> {
  return call(`${API}/v1/hosts`, jsonInit("POST", session(cookie), { label }));
}

export async function newKey(cookie: string, scopes?: string[]): Promise<{ key: string; fingerprint: string }> {
  const res = await call(`${API}/v1/keys`, jsonInit("POST", session(cookie), { name: "test", scopes }));
  if (res.status !== 201) throw new Error(`newKey: ${res.status}`);
  return res.json();
}

// Real age output, from the reference TypeScript implementation. The passphrase is a
// throwaway test value.
export async function ageScrypt(opts: { armored?: boolean; text?: string } = {}): Promise<Uint8Array> {
  const e = new Encrypter();
  e.setPassphrase("k7m2q9dx4tab3fz0wnr8");
  e.setScryptWorkFactor(10);
  const bytes = await e.encrypt(opts.text ?? "hostname: ada-1\n");
  return opts.armored ? new TextEncoder().encode(armor.encode(bytes)) : bytes;
}

export async function ageX25519(): Promise<Uint8Array> {
  const e = new Encrypter();
  e.addRecipient(await identityToRecipient(await generateX25519Identity()));
  return e.encrypt("hostname: ada-1\n");
}

export async function upload(auth: Record<string, string>, label: string, body: Uint8Array | string): Promise<Response> {
  return call(`${API}/v1/hosts/${label}/builds`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/octet-stream" },
    body,
  });
}
