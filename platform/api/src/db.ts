// Threats: a flood of reservations, uploads, or login starts, and an audit trail that
// leaks what it records. Audit rows hold ids, labels, versions, digests and key
// fingerprints only: never a body, a key, or a token. Rate-limit rows for IPs hold a
// SHA-256 of the address, not the address.

import { now } from "./http";

export interface AuditEvent {
  accountId: number;
  event: "host.reserve" | "host.delete" | "build.upload" | "build.delete" | "key.create" | "key.revoke";
  label?: string | null;
  version?: number | null;
  sha256?: string | null;
  keyFingerprint?: string | null;
}

export function auditStatement(db: D1Database, e: AuditEvent): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO audit (at, account_id, event, label, version, sha256, key_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(now(), e.accountId, e.event, e.label ?? null, e.version ?? null, e.sha256 ?? null, e.keyFingerprint ?? null);
}

// One call in PRUNE_ODDS also prunes, so the tables stay small without a cron.
const PRUNE_ODDS = 64;

// Drops rate-limit windows older than the last one, and expired sign-in and session rows.
export async function prune(db: D1Database): Promise<void> {
  const t = now();
  await db.batch([
    db.prepare("DELETE FROM rate_limits WHERE win < ?").bind(Math.floor(t / 3600) - 1),
    db.prepare("DELETE FROM oidc_pending WHERE expires < ?").bind(t),
    db.prepare("DELETE FROM sessions WHERE expires < ?").bind(t),
  ]);
}

// Fixed one-hour windows. Counts the attempt, then answers whether it is within the limit.
export async function withinLimit(db: D1Database, key: string, limit: number): Promise<boolean> {
  const win = Math.floor(now() / 3600);
  if (crypto.getRandomValues(new Uint32Array(1))[0] % PRUNE_ODDS === 0) await prune(db);
  const row = await db
    .prepare(
      "INSERT INTO rate_limits (key, win, count) VALUES (?, ?, 1) ON CONFLICT (key, win) DO UPDATE SET count = count + 1 RETURNING count",
    )
    .bind(key, win)
    .first<{ count: number }>();
  if (!row) return false;
  return row.count <= limit;
}
