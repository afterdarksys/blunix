// Threats: a program key minted or revoked by something other than a signed-in person,
// a key shown twice, and a key that outlives its revoke. The key is returned once and
// stored only as its SHA-256. A key can never mint or list keys. This does not stop a
// key copied before it was revoked from being used until the revoke lands.

import { SCOPES, type Principal, type Scope } from "./auth";
import { randomToken, sha256Hex } from "./crypto";
import { auditStatement } from "./db";
import type { Env } from "./env";
import { error, iso, json, noContent, now, readJson } from "./http";

const NAME = /^[\x20-\x7e]{1,64}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;

function sessionOnly(p: Principal): Response | null {
  return p.kind === "session" ? null : error(403, "forbidden");
}

function parseScopes(v: unknown): Scope[] | null {
  if (v === undefined) return ["hosts:write"];
  if (!Array.isArray(v) || v.length === 0 || v.length > SCOPES.length) return null;
  const out: Scope[] = [];
  for (const s of v) {
    if (typeof s !== "string" || !(SCOPES as readonly string[]).includes(s) || out.includes(s as Scope)) return null;
    out.push(s as Scope);
  }
  return out;
}

export async function createKey(req: Request, env: Env, p: Principal): Promise<Response> {
  const denied = sessionOnly(p);
  if (denied) return denied;
  const body = await readJson(req);
  if (!body.ok) return body.response;
  const name = body.value.name;
  const scopes = parseScopes(body.value.scopes);
  if (typeof name !== "string" || !NAME.test(name) || name.trim() === "" || scopes === null) {
    return error(400, "bad request");
  }
  // blx_join_ is refused everywhere, so a key must never begin that way by chance.
  let token = randomToken();
  while (token.startsWith("join_")) token = randomToken();
  const key = `blx_${token}`;
  const fingerprint = await sha256Hex(key);
  const t = now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO api_keys (fingerprint, account_id, name, scopes, created) VALUES (?, ?, ?, ?, ?)").bind(
      fingerprint,
      p.accountId,
      name,
      scopes.join(","),
      t,
    ),
    auditStatement(env.DB, { accountId: p.accountId, event: "key.create", keyFingerprint: fingerprint }),
  ]);
  return json(201, { key, fingerprint, name, scopes, created: iso(t) });
}

export async function listKeys(env: Env, p: Principal): Promise<Response> {
  const denied = sessionOnly(p);
  if (denied) return denied;
  const { results } = await env.DB.prepare(
    "SELECT fingerprint, name, scopes, created FROM api_keys WHERE account_id = ? AND revoked_at IS NULL ORDER BY created, fingerprint",
  )
    .bind(p.accountId)
    .all<{ fingerprint: string; name: string; scopes: string; created: number }>();
  return json(200, {
    keys: results.map((k) => ({ fingerprint: k.fingerprint, name: k.name, scopes: k.scopes.split(","), created: iso(k.created) })),
  });
}

export async function revokeKey(env: Env, p: Principal, fingerprint: string): Promise<Response> {
  const denied = sessionOnly(p);
  if (denied) return denied;
  if (!FINGERPRINT.test(fingerprint)) return error(404, "not found");
  const r = await env.DB.prepare(
    "UPDATE api_keys SET revoked_at = ? WHERE fingerprint = ? AND account_id = ? AND revoked_at IS NULL",
  )
    .bind(now(), fingerprint, p.accountId)
    .run();
  if (r.meta.changes !== 1) return error(404, "not found");
  await auditStatement(env.DB, { accountId: p.accountId, event: "key.revoke", keyFingerprint: fingerprint }).run();
  return noContent();
}
