// Threats: a label that collides with a service name, a punycode lookalike, and a label
// that makes v{n}.{label} ambiguous. Lookalikes made of plain ASCII are not rejected.

const LABEL = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;
const VERSION_LABEL = /^v[0-9]+$/;
const VERSION = /^[1-9][0-9]{0,5}$/;

export const RESERVED = new Set([
  "www", "api", "updates", "log", "mail", "build", "portal", "admin", "root", "blunix", "proxy", "status",
]);

export const HOLD_SECONDS = 30 * 24 * 3600;
export const MAX_VERSION = 999999;

// The shape alone. Reserved names still have this shape.
export function labelShape(s: unknown): s is string {
  return typeof s === "string" && LABEL.test(s) && !s.includes("--");
}

export function labelReserved(s: string): boolean {
  return RESERVED.has(s) || VERSION_LABEL.test(s);
}

export function parseVersion(s: string): number | null {
  return VERSION.test(s) ? Number(s) : null;
}

export function latestUrl(label: string): string {
  return `https://${label}.blnx.io/`;
}

export function pinnedUrl(label: string, version: number): string {
  return `https://v${version}.${label}.blnx.io/`;
}
