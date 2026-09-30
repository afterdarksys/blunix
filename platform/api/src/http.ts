// Threats: unbounded bodies, echoed input, and error text that varies with what was sent.
// Every error is a fixed string. Bodies are read through a byte cap, never whole.

export const JSON_LIMIT = 8 * 1024;

export function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("content-type", "application/json; charset=utf-8");
  h.set("cache-control", "no-store");
  h.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function error(status: number, message: string, headers: HeadersInit = {}): Response {
  return json(status, { error: message }, headers);
}

export function noContent(headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("cache-control", "no-store");
  return new Response(null, { status: 204, headers: h });
}

// Reads at most `max` bytes. Returns null past the cap, whatever content-length said.
export async function readCapped(req: Request | Response, max: number): Promise<Uint8Array | null> {
  const declared = req.headers.get("content-length");
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > max)) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

export type JsonResult = { ok: true; value: Record<string, unknown> } | { ok: false; response: Response };

// JSON object body, 8 KiB cap, application/json only.
export async function readJson(req: Request): Promise<JsonResult> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return { ok: false, response: error(415, "unsupported media type") };
  const bytes = await readCapped(req, JSON_LIMIT);
  if (bytes === null) return { ok: false, response: error(413, "payload too large") };
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return { ok: false, response: error(400, "bad request") };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, response: error(400, "bad request") };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

export function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}
