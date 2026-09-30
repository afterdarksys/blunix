export interface Env {
  DB: D1Database;
  BUILDS: R2Bucket;
  OIDC_ISSUER: string;
  OIDC_CLIENT_ID: string;
  OIDC_CLIENT_SECRET: string;
  PORTAL_ORIGIN: string;
  // Comma list of extra origins for wrangler dev. Empty in production.
  DEV_ORIGINS?: string;
  // "on" once v{n}.{label}.blnx.io has certificates. Anything else hides pinned URLs.
  PINNED_HOSTS_TLS?: string;
}

export const API_HOST = "api.blunix.io";
export const BUILD_APEX = "blnx.io";
export const BUILD_SUFFIX = ".blnx.io";
export const CALLBACK_URL = "https://api.blunix.io/v1/auth/callback";

// The portal, plus any dev origins. Exact string match only.
export function trustedOrigin(env: Env, origin: string | null): boolean {
  if (origin === null) return false;
  if (env.PORTAL_ORIGIN && origin === env.PORTAL_ORIGIN) return true;
  return devOrigins(env).includes(origin);
}

export function devOrigins(env: Env): string[] {
  return (env.DEV_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
