// The configuration library: an account's Profile templates, kept as immutable
// revisions. Ported from draft PR #1, with recipes replaced by Profile documents
// (src/profile.ts) and the community side behind COMMUNITY=on.
//
// Threats: a template that carries personal settings (only kind: Profile is stored,
// and a Profile cannot hold a hostname, admin, install or target), an edit that lands
// on a revision someone else already replaced (the expected head is checked inside
// the same write and a stale edit gets 409), a program key or another account that
// reads or edits a template (session only, and every query names the account), a
// duplicate JSON key that hides a value (the raw body is checked), and a public
// library with nobody to moderate it (closed by default). Titles and messages are free
// text the author chose; they can contain anything the author typed.

import type { Principal } from "./auth";
import { withinLimit } from "./db";
import type { Env } from "./env";
import { error, iso, json, JSON_LIMIT, noContent, now, readCapped } from "./http";
import { checkProfile, refuseDuplicateKeys, Refused } from "./profile";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const LIMITS = {
  templates: 100,
  revisions: 100,
  writesPerHour: 30,
  publicationsPerHour: 30,
  reportsPerHour: 10,
  page: 50,
};
const REASONS = ["spam", "abuse", "unsafe"];

interface Config {
  id: string;
  account_id: number;
  title: string;
  visibility: string;
  head: number;
  source_id: string | null;
  source_revision: number | null;
  created: number;
  updated: number;
}

export function communityOpen(env: Env): boolean {
  return env.COMMUNITY === "on";
}

function sessionOnly(p: Principal): Response | null {
  return p.kind === "session" ? null : error(403, "forbidden");
}

function text(value: unknown, max: number, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    (allowEmpty || value.trim().length > 0) &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}

type Body = { ok: true; value: Record<string, unknown> } | { ok: false; response: Response };

// Like readJson, and also refuses a repeated key anywhere in the body.
async function readStrictJson(req: Request): Promise<Body> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return { ok: false, response: error(415, "unsupported media type") };
  const bytes = await readCapped(req, JSON_LIMIT);
  if (bytes === null) return { ok: false, response: error(413, "payload too large") };
  let textBody: string;
  let value: unknown;
  try {
    textBody = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    value = JSON.parse(textBody);
  } catch {
    return { ok: false, response: error(400, "bad request") };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, response: error(400, "bad request") };
  }
  try {
    refuseDuplicateKeys(textBody);
  } catch (e) {
    if (e instanceof Refused) return { ok: false, response: error(400, "invalid profile: duplicate key") };
    throw e;
  }
  return { ok: true, value: value as Record<string, unknown> };
}

function profileOrError(value: unknown): { ok: true; profile: Record<string, unknown> } | { ok: false; response: Response } {
  try {
    return { ok: true, profile: checkProfile(value) };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, response: error(400, "invalid profile: " + e.message) };
    throw e;
  }
}

function summary(c: Config) {
  return {
    id: c.id,
    title: c.title,
    visibility: c.visibility,
    revision: c.head,
    source: c.source_id ? { id: c.source_id, revision: c.source_revision } : null,
    created: iso(c.created),
    updated: iso(c.updated),
  };
}

// The owner's live template, or (when the community is open) any public one.
async function readable(env: Env, id: string, accountId: number | null): Promise<Config | null> {
  if (!ID.test(id)) return null;
  const pub = communityOpen(env) ? "visibility = 'public' OR " : "";
  return env.DB.prepare(
    `SELECT * FROM configurations WHERE id = ? AND deleted_at IS NULL AND (${pub}account_id = ?)`,
  )
    .bind(id, accountId ?? -1)
    .first<Config>();
}

function offsetOf(req: Request): number | null {
  const raw = new URL(req.url).searchParams.get("offset") ?? "0";
  if (!/^[0-9]{1,6}$/.test(raw)) return null;
  return Number(raw);
}

async function page(env: Env, where: string, binds: unknown[], offset: number): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM configurations WHERE ${where} AND deleted_at IS NULL ORDER BY updated DESC, id LIMIT ? OFFSET ?`,
  )
    .bind(...binds, LIMITS.page + 1, offset)
    .all<Config>();
  return json(200, {
    configurations: results.slice(0, LIMITS.page).map(summary),
    nextOffset: results.length > LIMITS.page ? offset + LIMITS.page : null,
  });
}

async function revisions(env: Env, c: Config): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT revision, profile, message, created FROM configuration_revisions WHERE configuration_id = ? ORDER BY revision DESC LIMIT ?",
  )
    .bind(c.id, LIMITS.revisions)
    .all<{ revision: number; profile: string; message: string; created: number }>();
  return json(200, {
    ...summary(c),
    revisions: results.map((r) => ({
      revision: r.revision,
      profile: JSON.parse(r.profile),
      message: r.message,
      created: iso(r.created),
    })),
  });
}

export async function listConfigurations(req: Request, env: Env, p: Principal): Promise<Response> {
  const denied = sessionOnly(p);
  if (denied) return denied;
  const offset = offsetOf(req);
  if (offset === null) return error(400, "bad offset");
  return page(env, "account_id = ?", [p.accountId], offset);
}

export async function showConfiguration(env: Env, p: Principal, id: string): Promise<Response> {
  const denied = sessionOnly(p);
  if (denied) return denied;
  const c = await readable(env, id, p.accountId);
  if (!c || c.account_id !== p.accountId) return error(404, "not found");
  return revisions(env, c);
}

export async function createConfiguration(req: Request, env: Env, p: Principal): Promise<Response> {
  const denied = sessionOnly(p);
  if (denied) return denied;
  if (!(await withinLimit(env.DB, `library:${p.accountId}`, LIMITS.writesPerHour))) return error(429, "rate limited");
  const body = await readStrictJson(req);
  if (!body.ok) return body.response;
  const b = body.value;
  if (Object.keys(b).some((k) => !["title", "profile", "source"].includes(k)) || !text(b.title, 100)) {
    return error(400, "bad request");
  }
  let profile: Record<string, unknown>;
  let sourceId: string | null = null;
  let sourceRevision: number | null = null;
  if (b.source !== undefined) {
    const s = b.source as Record<string, unknown> | null;
    if (b.profile !== undefined || !s || typeof s !== "object" || typeof s.id !== "string" || !Number.isInteger(s.revision)) {
      return error(400, "bad request");
    }
    const source = await readable(env, s.id, p.accountId);
    if (!source) return error(404, "not found");
    const rev = await env.DB.prepare(
      "SELECT profile FROM configuration_revisions WHERE configuration_id = ? AND revision = ?",
    )
      .bind(source.id, s.revision)
      .first<{ profile: string }>();
    if (!rev) return error(404, "not found");
    profile = JSON.parse(rev.profile);
    sourceId = source.id;
    sourceRevision = s.revision as number;
  } else {
    const checked = profileOrError(b.profile);
    if (!checked.ok) return checked.response;
    profile = checked.profile;
  }
  const id = crypto.randomUUID();
  const t = now();
  const result = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO configurations (id, account_id, title, source_id, source_revision, created, updated) " +
        "SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM configurations WHERE account_id = ? AND deleted_at IS NULL) < ?",
    ).bind(id, p.accountId, (b.title as string).trim(), sourceId, sourceRevision, t, t, p.accountId, LIMITS.templates),
    env.DB.prepare(
      "INSERT INTO configuration_revisions (configuration_id, revision, profile, message, created) " +
        "SELECT id, 1, ?, '', ? FROM configurations WHERE id = ?",
    ).bind(JSON.stringify(profile), t, id),
  ]);
  if (result[0].meta.changes !== 1) return error(403, "template limit reached");
  return json(201, { id, revision: 1, visibility: "private" });
}

export async function reviseConfiguration(req: Request, env: Env, p: Principal, id: string): Promise<Response> {
  const denied = sessionOnly(p);
  if (denied) return denied;
  const c = await readable(env, id, p.accountId);
  if (!c || c.account_id !== p.accountId) return error(404, "not found");
  if (!(await withinLimit(env.DB, `library:${p.accountId}`, LIMITS.writesPerHour))) return error(429, "rate limited");
  const body = await readStrictJson(req);
  if (!body.ok) return body.response;
  const b = body.value;
  if (
    Object.keys(b).some((k) => !["profile", "revision", "message"].includes(k)) ||
    !Number.isInteger(b.revision) ||
    !text(b.message ?? "", 240, true)
  ) {
    return error(400, "bad request");
  }
  const checked = profileOrError(b.profile);
  if (!checked.ok) return checked.response;
  if (b.revision !== c.head) return error(409, "revision changed; reload before saving");
  if (c.head >= LIMITS.revisions) return error(403, "revision limit reached");
  const t = now();
  // Both statements name the expected head, so a concurrent edit changes nothing.
  const result = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO configuration_revisions (configuration_id, revision, profile, message, created) " +
        "SELECT id, head + 1, ?, ?, ? FROM configurations WHERE id = ? AND account_id = ? AND head = ? AND deleted_at IS NULL",
    ).bind(JSON.stringify(checked.profile), ((b.message as string | undefined) ?? "").trim(), t, id, p.accountId, c.head),
    env.DB.prepare(
      "UPDATE configurations SET head = head + 1, updated = ? WHERE id = ? AND account_id = ? AND head = ? AND deleted_at IS NULL",
    ).bind(t, id, p.accountId, c.head),
  ]);
  if (result[0].meta.changes !== 1) return error(409, "revision changed; reload before saving");
  return json(201, { id, revision: c.head + 1 });
}

export async function deleteConfiguration(env: Env, p: Principal, id: string): Promise<Response> {
  const denied = sessionOnly(p);
  if (denied) return denied;
  if (!ID.test(id)) return error(404, "not found");
  const r = await env.DB.prepare(
    "UPDATE configurations SET deleted_at = ? WHERE id = ? AND account_id = ? AND deleted_at IS NULL",
  )
    .bind(now(), id, p.accountId)
    .run();
  return r.meta.changes === 1 ? noContent() : error(404, "not found");
}

// ---- Community: closed unless COMMUNITY=on --------------------------------

export async function publishConfiguration(req: Request, env: Env, p: Principal, id: string): Promise<Response> {
  const denied = sessionOnly(p);
  if (denied) return denied;
  if (!communityOpen(env)) return error(403, "the community library is closed");
  if (!ID.test(id)) return error(404, "not found");
  if (!(await withinLimit(env.DB, `publication:${p.accountId}`, LIMITS.publicationsPerHour))) return error(429, "rate limited");
  const body = await readStrictJson(req);
  if (!body.ok) return body.response;
  const v = body.value.visibility;
  if (Object.keys(body.value).length !== 1 || (v !== "private" && v !== "public")) return error(400, "bad request");
  // Setting the same visibility again does not move the template up the public list.
  const r = await env.DB.prepare(
    "UPDATE configurations SET updated = CASE WHEN visibility != ? THEN ? ELSE updated END, visibility = ? " +
      "WHERE id = ? AND account_id = ? AND deleted_at IS NULL",
  )
    .bind(v, now(), v, id, p.accountId)
    .run();
  return r.meta.changes === 1 ? json(200, { visibility: v }) : error(404, "not found");
}

export async function communityList(req: Request, env: Env): Promise<Response> {
  if (!communityOpen(env)) return error(404, "not found");
  const offset = offsetOf(req);
  if (offset === null) return error(400, "bad offset");
  return page(env, "visibility = 'public'", [], offset);
}

export async function communityShow(env: Env, id: string): Promise<Response> {
  if (!communityOpen(env)) return error(404, "not found");
  const c = await readable(env, id, null);
  if (!c) return error(404, "not found");
  return revisions(env, c);
}

export async function reportConfiguration(req: Request, env: Env, p: Principal, id: string): Promise<Response> {
  const denied = sessionOnly(p);
  if (denied) return denied;
  if (!communityOpen(env)) return error(404, "not found");
  const c = await readable(env, id, null);
  if (!c) return error(404, "not found");
  if (!(await withinLimit(env.DB, `report:${p.accountId}`, LIMITS.reportsPerHour))) return error(429, "rate limited");
  const body = await readStrictJson(req);
  if (!body.ok) return body.response;
  const reason = body.value.reason;
  if (Object.keys(body.value).length !== 1 || typeof reason !== "string" || !REASONS.includes(reason)) {
    return error(400, "bad request");
  }
  // Stored for a person to review. Nothing is hidden automatically.
  await env.DB.prepare(
    "INSERT INTO community_reports (configuration_id, account_id, reason, created) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT (configuration_id, account_id) DO UPDATE SET reason = excluded.reason, created = excluded.created",
  )
    .bind(id, p.accountId, reason, now())
    .run();
  return noContent();
}
