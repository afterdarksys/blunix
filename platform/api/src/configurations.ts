// Threats: private metadata leakage, unauthorized edits, and concurrent writes.
// Shareable templates deliberately cannot contain personal machine settings.
// Each edit appends a revision. Optimistic writes run in one D1 transaction.
import type { Principal } from "./auth";
import { withinLimit } from "./db";
import type { Env } from "./env";
import { error, iso, json, noContent, now, readJson } from "./http";

export const PACKAGES = ["curl", "git", "htop", "jq", "tmux", "vim", "wget", "rsync", "python3", "podman", "nginx", "postgresql-client", "dnsutils", "tcpdump", "strace"];
const ACCESS = ["regular", "full-speech", "console-speech", "large-print", "advanced"];
const ID = /^[a-f0-9-]{36}$/;
type Recipe = { packages: string[]; access: string };
type Config = { id: string; account_id: number; title: string; visibility: string; head: number; source_id: string | null; source_revision: number | null; created: number; updated: number };

export function recipe(value: unknown): Recipe | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some(k => !["packages", "access"].includes(k))) return null;
  if (typeof r.access !== "string" || !ACCESS.includes(r.access) || !Array.isArray(r.packages)) return null;
  if (r.packages.length > PACKAGES.length || r.packages.some(p => typeof p !== "string" || !PACKAGES.includes(p))) return null;
  if (new Set(r.packages).size !== r.packages.length) return null;
  return { packages: [...r.packages].sort(), access: r.access };
}
function text(value: unknown, max: number, empty = false): value is string {
  return typeof value === "string" && value.length <= max && (empty || value.trim().length > 0) && !/[\x00-\x1f\x7f]/.test(value);
}
function summary(c: Config) {
  return { id: c.id, title: c.title, visibility: c.visibility, revision: c.head,
    source: c.source_id ? { id: c.source_id, revision: c.source_revision } : null,
    created: iso(c.created), updated: iso(c.updated) };
}
async function accessible(env: Env, id: string, accountId?: number): Promise<Config | null> {
  if (!ID.test(id)) return null;
  return env.DB.prepare("SELECT * FROM configurations WHERE id = ? AND deleted_at IS NULL AND (visibility = 'public' OR account_id = ?)")
    .bind(id, accountId ?? -1).first<Config>();
}
export async function listConfigurations(req: Request, env: Env, p?: Principal): Promise<Response> {
  if (p && p.kind !== "session") return error(403, "forbidden");
  const url = new URL(req.url);
  const offset = Number(url.searchParams.get("offset") || "0");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return error(400, "invalid offset");
  const filter = p ? "account_id = ?" : "visibility = 'public'";
  const stmt = env.DB.prepare(`SELECT * FROM configurations WHERE ${filter} AND deleted_at IS NULL ORDER BY updated DESC, id LIMIT 51 OFFSET ?`);
  const { results } = await (p ? stmt.bind(p.accountId, offset) : stmt.bind(offset)).all<Config>();
  return json(200, { configurations: results.slice(0, 50).map(summary), nextOffset: results.length > 50 ? offset + 50 : null });
}
export async function showConfiguration(env: Env, id: string, p?: Principal): Promise<Response> {
  if (p && p.kind !== "session") return error(403, "forbidden");
  const c = await accessible(env, id, p?.accountId);
  if (!c || (p && c.account_id !== p.accountId)) return error(404, "not found");
  const { results } = await env.DB.prepare("SELECT revision, recipe, message, created FROM configuration_revisions WHERE configuration_id = ? ORDER BY revision DESC LIMIT 100")
    .bind(id).all<{ revision: number; recipe: string; message: string; created: number }>();
  return json(200, { ...summary(c), revisions: results.map(r => ({ ...r, recipe: JSON.parse(r.recipe), created: iso(r.created) })) });
}
export async function createConfiguration(req: Request, env: Env, p: Principal): Promise<Response> {
  if (p.kind !== "session") return error(403, "forbidden");
  if (!await withinLimit(env.DB, `config:${p.accountId}`, 30)) return error(429, "rate limited");
  const body = await readJson(req);
  if (!body.ok) return body.response;
  const b = body.value;
  if (Object.keys(b).some(k => !["title", "recipe", "source"].includes(k)) || !text(b.title, 100)) return error(400, "invalid configuration");
  let r = recipe(b.recipe);
  let sourceId: string | null = null;
  let sourceRevision: number | null = null;
  if (b.source !== undefined) {
    const s = b.source as Record<string, unknown>;
    if (!s || typeof s !== "object" || typeof s.id !== "string" || !Number.isInteger(s.revision) || b.recipe !== undefined) return error(400, "invalid source");
    const source = await accessible(env, s.id, p.accountId);
    if (!source) return error(404, "not found");
    const rev = await env.DB.prepare("SELECT recipe FROM configuration_revisions WHERE configuration_id = ? AND revision = ?")
      .bind(source.id, s.revision).first<{ recipe: string }>();
    if (!rev) return error(404, "not found");
    r = recipe(JSON.parse(rev.recipe));
    sourceId = source.id;
    sourceRevision = s.revision as number;
  }
  if (!r) return error(400, "invalid recipe");
  const id = crypto.randomUUID(), t = now();
  const result = await env.DB.batch([
    env.DB.prepare("INSERT INTO configurations (id, account_id, title, source_id, source_revision, created, updated) SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM configurations WHERE account_id = ? AND deleted_at IS NULL) < 100")
      .bind(id, p.accountId, b.title.trim(), sourceId, sourceRevision, t, t, p.accountId),
    env.DB.prepare("INSERT INTO configuration_revisions SELECT id, 1, ?, '', ? FROM configurations WHERE id = ?").bind(JSON.stringify(r), t, id),
  ]);
  if (result[0].meta.changes !== 1) return error(403, "configuration limit");
  return json(201, { id, revision: 1, visibility: "private" });
}
export async function reviseConfiguration(req: Request, env: Env, p: Principal, id: string): Promise<Response> {
  if (p.kind !== "session") return error(403, "forbidden");
  const c = await accessible(env, id, p.accountId);
  if (!c || c.account_id !== p.accountId) return error(404, "not found");
  if (!await withinLimit(env.DB, `config:${p.accountId}`, 30)) return error(429, "rate limited");
  const body = await readJson(req);
  if (!body.ok) return body.response;
  const b = body.value, r = recipe(b.recipe);
  if (Object.keys(b).some(k => !["recipe", "revision", "message"].includes(k)) || !r || !Number.isInteger(b.revision) || !text(b.message, 240, true)) return error(400, "invalid revision");
  if (b.revision !== c.head) return error(409, "revision changed; reload before saving");
  if (c.head >= 100) return error(403, "revision limit");
  const t = now();
  const result = await env.DB.batch([
    env.DB.prepare("INSERT INTO configuration_revisions SELECT id, head + 1, ?, ?, ? FROM configurations WHERE id = ? AND account_id = ? AND head = ? AND deleted_at IS NULL")
      .bind(JSON.stringify(r), b.message.trim(), t, id, p.accountId, c.head),
    env.DB.prepare("UPDATE configurations SET head = head + 1, updated = ? WHERE id = ? AND account_id = ? AND head = ? AND deleted_at IS NULL")
      .bind(t, id, p.accountId, c.head),
  ]);
  if (result[0].meta.changes !== 1) return error(409, "revision changed; reload before saving");
  return json(201, { id, revision: c.head + 1 });
}
export async function publishConfiguration(req: Request, env: Env, p: Principal, id: string): Promise<Response> {
  if (p.kind !== "session") return error(403, "forbidden");
  if (!await withinLimit(env.DB, `publication:${p.accountId}`, 30)) return error(429, "rate limited");
  const b = await readJson(req);
  if (!b.ok) return b.response;
  if (Object.keys(b.value).length !== 1 || !["private", "public"].includes(b.value.visibility as string)) return error(400, "invalid visibility");
  const result = await env.DB.prepare("UPDATE configurations SET updated = CASE WHEN visibility != ? THEN ? ELSE updated END, visibility = ? WHERE id = ? AND account_id = ? AND deleted_at IS NULL")
    .bind(b.value.visibility, now(), b.value.visibility, id, p.accountId).run();
  return result.meta.changes === 1 ? json(200, { visibility: b.value.visibility }) : error(404, "not found");
}
export async function deleteConfiguration(env: Env, p: Principal, id: string): Promise<Response> {
  if (p.kind !== "session") return error(403, "forbidden");
  const r = await env.DB.prepare("UPDATE configurations SET deleted_at = ? WHERE id = ? AND account_id = ? AND deleted_at IS NULL").bind(now(), id, p.accountId).run();
  return r.meta.changes === 1 ? noContent() : error(404, "not found");
}
export async function reportConfiguration(req: Request, env: Env, p: Principal, id: string): Promise<Response> {
  if (p.kind !== "session") return error(403, "forbidden");
  const c = await accessible(env, id);
  if (!c) return error(404, "not found");
  if (!await withinLimit(env.DB, `report:${p.accountId}`, 10)) return error(429, "rate limited");
  const b = await readJson(req);
  if (!b.ok) return b.response;
  if (!["spam", "abuse", "unsafe"].includes(b.value.reason as string)) return error(400, "invalid reason");
  await env.DB.prepare("INSERT INTO community_reports VALUES (?, ?, ?, ?) ON CONFLICT(configuration_id, account_id) DO UPDATE SET reason = excluded.reason, created = excluded.created")
    .bind(id, p.accountId, b.value.reason, now()).run();
  return noContent();
}
