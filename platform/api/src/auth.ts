// Threats: a replayed or forged session cookie, a stolen program key after revoke, a join
// token used as an account key, a cross-site request riding the session cookie, and a
// timing probe against stored hashes. Auth rejects by default: a request is anonymous
// until a session or key is proven. This does not stop a key or cookie that is stolen
// and used before it is revoked or expires.

import { constantTimeEqual, sha256Hex } from "./crypto";
import { trustedOrigin, type Env } from "./env";
import { error, getCookie, now } from "./http";

export const SESSION_COOKIE = "__Host-blx_session";
export const SESSION_SECONDS = 12 * 3600;
export const SCOPES = ["hosts:write", "hosts:read"] as const;
export type Scope = (typeof SCOPES)[number];

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const KEY = /^blx_[A-Za-z0-9_-]{43}$/;

export type Principal =
  | { kind: "session"; accountId: number; tokenHash: string }
  | { kind: "key"; accountId: number; fingerprint: string; scopes: Scope[] };

export async function authenticate(req: Request, env: Env): Promise<Principal | Response> {
  const authz = req.headers.get("authorization");
  if (authz !== null) {
    const m = /^Bearer ([\x21-\x7e]{1,256})$/.exec(authz);
    if (!m) return error(401, "unauthorized");
    const token = m[1];
    // Join tokens belong to a later pass. Until then they open nothing.
    if (token.startsWith("blx_join_")) return error(401, "unauthorized");
    if (!KEY.test(token)) return error(401, "unauthorized");
    const fp = await sha256Hex(token);
    const row = await env.DB.prepare(
      "SELECT fingerprint, account_id, scopes FROM api_keys WHERE fingerprint = ? AND revoked_at IS NULL",
    )
      .bind(fp)
      .first<{ fingerprint: string; account_id: number; scopes: string }>();
    if (!row || !(await constantTimeEqual(row.fingerprint, fp))) return error(401, "unauthorized");
    const scopes = row.scopes.split(",").filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
    return { kind: "key", accountId: row.account_id, fingerprint: fp, scopes };
  }
  const cookie = getCookie(req, SESSION_COOKIE);
  if (cookie === null || !TOKEN.test(cookie)) return error(401, "unauthorized");
  const hash = await sha256Hex(cookie);
  const row = await env.DB.prepare("SELECT token_hash, account_id FROM sessions WHERE token_hash = ? AND expires > ?")
    .bind(hash, now())
    .first<{ token_hash: string; account_id: number }>();
  if (!row || !(await constantTimeEqual(row.token_hash, hash))) return error(401, "unauthorized");
  return { kind: "session", accountId: row.account_id, tokenHash: hash };
}

// A state-changing session request must prove it came from the portal.
// A bearer request needs neither header: a browser cannot attach one cross-site.
export function csrfFailure(req: Request, env: Env, p: Principal): Response | null {
  if (p.kind !== "session") return null;
  if (req.method === "GET" || req.method === "HEAD") return null;
  if (req.headers.get("x-blunix-csrf") !== "1") return error(403, "csrf");
  if (!trustedOrigin(env, req.headers.get("origin"))) return error(403, "csrf");
  return null;
}

export function canRead(p: Principal): boolean {
  return p.kind === "session" || p.scopes.includes("hosts:read") || p.scopes.includes("hosts:write");
}

export function canWrite(p: Principal): boolean {
  return p.kind === "session" || p.scopes.includes("hosts:write");
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
