// Threats: a build host that serves something other than the recorded ciphertext, a
// deleted version that keeps serving, a path or query that reaches anything else, and a
// browser that sniffs ciphertext into something runnable. The body is checked against
// its recorded SHA-256 before it leaves. This does not hide that a label exists: anyone
// who knows the name can fetch the ciphertext. The key is what protects it.

import type { Env } from "./env";
import { sha256Hex } from "./crypto";
import { withinLimit } from "./db";
import { labelReserved, labelShape, parseVersion } from "./labels";

function empty(status: number, extra: Record<string, string> = {}): Response {
  return new Response(null, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
  });
}

// The netboot media base: https, a host, a path ending in "/", nothing else.
export function netbootBase(env: Env): string | null {
  const raw = env.NETBOOT_MEDIA ?? "";
  if (raw === "") return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || !u.pathname.endsWith("/")) return null;
  if (u.href !== raw || /[^\x21-\x7e]/.test(raw)) return null;
  return raw;
}

// https://{label}.blnx.io/boot.ipxe: an iPXE script that boots the installer from the
// published netboot media and offers this label's build address. Any well-formed label
// gets the same script without a lookup, so the route does not say which labels exist.
// It carries no secret: the key is still typed at the installer. Off (404) until
// NETBOOT_MEDIA names where the media is published.
async function serveBootScript(req: Request, env: Env, label: string): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return empty(405, { allow: "GET, HEAD" });
  if (!labelShape(label) || labelReserved(label)) return empty(404);
  const base = netbootBase(env);
  if (base === null) {
    if ((env.NETBOOT_MEDIA ?? "") !== "") console.error("blunix-api: NETBOOT_MEDIA is not a usable https base");
    return empty(404);
  }
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await withinLimit(env.DB, `bootscript:${ip}`, BOOT_SCRIPT_LIMIT))) return empty(429);
  const host = `${label}.blnx.io`;
  const script = [
    "#!ipxe",
    `echo blunix: netboot for ${host}`,
    `kernel ${base}vmlinuz initrd=initrd.img boot=live noeject fetch=${base}blunix.squashfs ` +
      `blunix.build=${host} blunix.access=regular console=tty0 console=ttyS0,115200`,
    `initrd ${base}initrd.img`,
    "boot",
    "",
  ].join("\n");
  const headers = {
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  };
  return new Response(req.method === "HEAD" ? null : script, { status: 200, headers });
}

export const BOOT_SCRIPT_LIMIT = 120;

// `name` is the host with `.blnx.io` removed: `ada` or `v3.ada`.
export async function serveBuild(req: Request, env: Env, name: string): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/boot.ipxe" && url.search === "") {
    // Latest only: pinned v{n} hosts have no boot script.
    return name.includes(".") ? empty(404) : serveBootScript(req, env, name);
  }
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
