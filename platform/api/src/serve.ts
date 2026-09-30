// Threats: a build host that serves something other than the recorded ciphertext, a
// deleted version that keeps serving, a path or query that reaches anything else, and a
// browser that sniffs ciphertext into something runnable. The body is checked against
// its recorded SHA-256 before it leaves. This does not hide that a label exists: anyone
// who knows the name can fetch the ciphertext. The key is what protects it.

import type { Env } from "./env";
import { sha256Hex } from "./crypto";
import { labelShape, parseVersion } from "./labels";

function empty(status: number, extra: Record<string, string> = {}): Response {
  return new Response(null, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
  });
}

// `name` is the host with `.blnx.io` removed: `ada` or `v3.ada`.
export async function serveBuild(req: Request, env: Env, name: string): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== "/" || url.search !== "") return empty(404);
  if (req.method !== "GET" && req.method !== "HEAD") return empty(405, { allow: "GET, HEAD" });

  const parts = name.split(".");
  let label: string;
  let version: number | null = null;
  if (parts.length === 1) {
    label = parts[0];
  } else if (parts.length === 2 && parts[0].startsWith("v")) {
    version = parseVersion(parts[0].slice(1));
    if (version === null) return empty(404);
    label = parts[1];
  } else {
    return empty(404);
  }
  if (!labelShape(label)) return empty(404);

  const base = `SELECT b.version, b.sha256, b.size, b.r2_key FROM builds b JOIN labels l ON b.label_id = l.id
    WHERE l.label = ? AND l.deleted_at IS NULL AND b.deleted_at IS NULL`;
  const row =
    version === null
      ? await env.DB.prepare(`${base} ORDER BY b.version DESC LIMIT 1`).bind(label).first<Build>()
      : await env.DB.prepare(`${base} AND b.version = ?`).bind(label, version).first<Build>();
  if (!row) return empty(404);

  const obj = await env.BUILDS.get(row.r2_key);
  if (!obj) {
    console.error("blunix-api: missing body for", row.r2_key);
    return empty(404);
  }
  const body = new Uint8Array(await obj.arrayBuffer());
  if (body.length !== row.size || (await sha256Hex(body)) !== row.sha256) {
    console.error("blunix-api: digest mismatch for", row.r2_key);
    return empty(500);
  }
  const headers = {
    "content-type": "application/octet-stream",
    "x-content-type-options": "nosniff",
    "x-blunix-sha256": row.sha256,
    "content-length": String(row.size),
    "cache-control": version === null ? "no-store" : "public, max-age=31536000, immutable",
  };
  return new Response(req.method === "HEAD" ? null : body, { status: 200, headers });
}

interface Build {
  version: number;
  sha256: string;
  size: number;
  r2_key: string;
}
