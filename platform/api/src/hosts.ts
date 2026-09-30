// Threats: a label taken from its owner, a read or write across accounts, a version
// number reused so a pinned URL changes meaning, a deleted label that someone else
// reserves the next minute, and an upload that is not a passphrase age file. Another
// account's label is 404, the same as a label that does not exist. This does not stop
// an owner from publishing a document that fails to decrypt with their own key.

import { acceptCiphertext, UPLOAD_LIMIT } from "./age";
import { canRead, canWrite, type Principal } from "./auth";
import { sha256Hex } from "./crypto";
import { auditStatement, withinLimit } from "./db";
import type { Env } from "./env";
import { error, iso, json, noContent, now, readCapped, readJson } from "./http";
import { HOLD_SECONDS, labelReserved, labelShape, latestUrl, MAX_VERSION, parseVersion, pinnedUrl } from "./labels";

const MAX_LABELS = 20;
const RESERVE_LIMIT = 10;
const UPLOAD_RATE = 30;

interface LabelRow {
  id: number;
  label: string;
  created: number;
}

// v{n}.{label}.blnx.io needs a certificate per label. Until PINNED_HOSTS_TLS is on, the
// API names no pinned URL, so nobody is handed one that fails TLS.
function pinned(env: Env, label: string, version: number): string | null {
  return env.PINNED_HOSTS_TLS === "on" ? pinnedUrl(label, version) : null;
}

function keyFp(p: Principal): string | null {
  return p.kind === "key" ? p.fingerprint : null;
}

async function owned(env: Env, p: Principal, label: string): Promise<LabelRow | null> {
  if (!labelShape(label)) return null;
  return env.DB.prepare("SELECT id, label, created FROM labels WHERE label = ? AND account_id = ? AND deleted_at IS NULL")
    .bind(label, p.accountId)
    .first<LabelRow>();
}

export async function me(env: Env, p: Principal): Promise<Response> {
  const account = await env.DB.prepare("SELECT id, created FROM accounts WHERE id = ?")
    .bind(p.accountId)
    .first<{ id: number; created: number }>();
  if (!account) return error(401, "unauthorized");
  const { results } = await env.DB.prepare(
    "SELECT label FROM labels WHERE account_id = ? AND deleted_at IS NULL ORDER BY label",
  )
    .bind(p.accountId)
    .all<{ label: string }>();
  // The id is a string because the portal shows the first string field it finds.
  return json(200, {
    account: { id: String(account.id), created: iso(account.created) },
    labels: results.map((r) => r.label),
  });
}

export async function reserve(req: Request, env: Env, p: Principal): Promise<Response> {
  if (!canWrite(p)) return error(403, "forbidden");
  // Attempts count, not successes, so 409 is not a free oracle for taken names.
  if (!(await withinLimit(env.DB, `reserve:${p.accountId}`, RESERVE_LIMIT))) return error(429, "rate limited");
  const body = await readJson(req);
  if (!body.ok) return body.response;
  const label = body.value.label;
  if (!labelShape(label)) return error(400, "invalid label");
  if (labelReserved(label)) return error(400, "reserved label");
  const t = now();
  let changes = 0;
  try {
    const r = await env.DB.prepare(
      // A label reserved again carries on from the highest counter it ever had, so a
      // pinned URL from an earlier owner never names the new owner's bytes.
      `INSERT INTO labels (label, account_id, created, next_version)
       SELECT ?1, ?2, ?3, COALESCE((SELECT MAX(next_version) FROM labels WHERE label = ?1), 1)
       WHERE NOT EXISTS (SELECT 1 FROM labels WHERE label = ?1 AND (deleted_at IS NULL OR deleted_at > ?4))
         AND (SELECT COUNT(*) FROM labels WHERE account_id = ?2 AND deleted_at IS NULL) < ?5`,
    )
      .bind(label, p.accountId, t, t - HOLD_SECONDS, MAX_LABELS)
      .run();
    changes = r.meta.changes;
  } catch (e) {
    // The unique index on live labels is the backstop for a race between two reservations.
    if (!(e instanceof Error && /UNIQUE/i.test(e.message))) throw e;
  }
  if (changes !== 1) {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM labels WHERE account_id = ? AND deleted_at IS NULL")
      .bind(p.accountId)
      .first<{ n: number }>();
    if (count && count.n >= MAX_LABELS) return error(403, "label limit");
    return error(409, "label taken");
  }
  await auditStatement(env.DB, { accountId: p.accountId, event: "host.reserve", label, keyFingerprint: keyFp(p) }).run();
  return json(201, { label, created: iso(t), url: latestUrl(label) });
}

export async function list(env: Env, p: Principal): Promise<Response> {
  if (!canRead(p)) return error(403, "forbidden");
  const { results } = await env.DB.prepare(
    `SELECT l.label, l.created, b.version, b.sha256, b.size, b.created AS built
     FROM labels l
     LEFT JOIN builds b ON b.id = (
       SELECT id FROM builds WHERE label_id = l.id AND deleted_at IS NULL ORDER BY version DESC LIMIT 1)
     WHERE l.account_id = ? AND l.deleted_at IS NULL
     ORDER BY l.label`,
  )
    .bind(p.accountId)
    .all<{ label: string; created: number; version: number | null; sha256: string | null; size: number | null; built: number | null }>();
  return json(200, {
    hosts: results.map((r) => ({
      label: r.label,
      created: iso(r.created),
      url: latestUrl(r.label),
      latest:
        r.version === null
          ? null
          : { version: r.version, sha256: r.sha256, size: r.size, created: iso(r.built as number), pinnedUrl: pinned(env, r.label, r.version) },
    })),
  });
}

export async function show(env: Env, p: Principal, label: string): Promise<Response> {
  if (!canRead(p)) return error(403, "forbidden");
  const row = await owned(env, p, label);
  if (!row) return error(404, "not found");
  const { results } = await env.DB.prepare(
    "SELECT version, sha256, size, created FROM builds WHERE label_id = ? AND deleted_at IS NULL ORDER BY version",
  )
    .bind(row.id)
    .all<{ version: number; sha256: string; size: number; created: number }>();
  return json(200, {
    label: row.label,
    created: iso(row.created),
    versions: results.map((v) => ({
      version: v.version,
      sha256: v.sha256,
      size: v.size,
      created: iso(v.created),
      pinnedUrl: pinned(env, row.label, v.version),
    })),
  });
}

export async function removeHost(env: Env, p: Principal, label: string): Promise<Response> {
  if (!canWrite(p)) return error(403, "forbidden");
  if (!labelShape(label)) return error(404, "not found");
  const t = now();
  const row = await env.DB.prepare(
    "UPDATE labels SET deleted_at = ? WHERE label = ? AND account_id = ? AND deleted_at IS NULL RETURNING id",
  )
    .bind(t, label, p.accountId)
    .first<{ id: number }>();
  if (!row) return error(404, "not found");
  const { results } = await env.DB.prepare(
    "UPDATE builds SET deleted_at = ? WHERE label_id = ? AND deleted_at IS NULL RETURNING r2_key",
  )
    .bind(t, row.id)
    .all<{ r2_key: string }>();
  // Serving reads D1 first, so these bodies are already unreachable. Removing them is hygiene.
  if (results.length > 0) await env.BUILDS.delete(results.map((r) => r.r2_key));
  await auditStatement(env.DB, { accountId: p.accountId, event: "host.delete", label, keyFingerprint: keyFp(p) }).run();
  return noContent();
}

export async function upload(req: Request, env: Env, p: Principal, label: string): Promise<Response> {
  if (!canWrite(p)) return error(403, "forbidden");
  const row = await owned(env, p, label);
  if (!row) return error(404, "not found");
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/octet-stream") return error(415, "unsupported media type");
  if (!(await withinLimit(env.DB, `upload:${p.accountId}`, UPLOAD_RATE))) return error(429, "rate limited");
  const raw = await readCapped(req, UPLOAD_LIMIT);
  // Armor is unwrapped here: the stored, hashed and served bytes are the binary file.
  const body = raw === null ? null : acceptCiphertext(raw);
  if (body === null) return error(400, "refused ciphertext");

  // The counter only climbs, so a number is never handed out twice.
  const alloc = await env.DB.prepare(
    "UPDATE labels SET next_version = next_version + 1 WHERE id = ? AND deleted_at IS NULL AND next_version <= ? RETURNING next_version - 1 AS version",
  )
    .bind(row.id, MAX_VERSION)
    .first<{ version: number }>();
  if (!alloc) return error(409, "version limit");
  const version = alloc.version;
  const digest = await sha256Hex(body);
  const key = `builds/${row.id}/${version}`;
  await env.BUILDS.put(key, body, { httpMetadata: { contentType: "application/octet-stream" }, sha256: digest });
  const t = now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO builds (label_id, version, sha256, size, r2_key, created) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(row.id, version, digest, body.length, key, t),
    auditStatement(env.DB, {
      accountId: p.accountId,
      event: "build.upload",
      label,
      version,
      sha256: digest,
      keyFingerprint: keyFp(p),
    }),
  ]);
  return json(201, { version, sha256: digest, size: body.length, url: latestUrl(label), pinnedUrl: pinned(env, label, version) });
}

export async function removeBuild(env: Env, p: Principal, label: string, n: string): Promise<Response> {
  if (!canWrite(p)) return error(403, "forbidden");
  const row = await owned(env, p, label);
  const version = parseVersion(n);
  if (!row || version === null) return error(404, "not found");
  const b = await env.DB.prepare(
    "UPDATE builds SET deleted_at = ? WHERE label_id = ? AND version = ? AND deleted_at IS NULL RETURNING r2_key, sha256",
  )
    .bind(now(), row.id, version)
    .first<{ r2_key: string; sha256: string }>();
  if (!b) return error(404, "not found");
  await env.BUILDS.delete(b.r2_key);
  await auditStatement(env.DB, {
    accountId: p.accountId,
    event: "build.delete",
    label,
    version,
    sha256: b.sha256,
    keyFingerprint: keyFp(p),
  }).run();
  return noContent();
}
