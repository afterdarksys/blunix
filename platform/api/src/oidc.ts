// Threats: a forged or unsigned ID token (alg none, a key not in the issuer's JWKS, an
// algorithm outside RS256/ES256/EdDSA), a token for another client or issuer, an expired
// token, a replayed or swapped authorization response (state, nonce, PKCE), login CSRF
// that signs a browser into someone else's account, and an issuer that is down or lying
// about its own name. Missing discovery fails closed. This does not stop a compromised
// issuer, which is trusted by design.

import { createLocalJWKSet, errors as joseErrors, jwtVerify, type JSONWebKeySet } from "jose";
import { clearSessionCookie, sessionCookie, SESSION_SECONDS } from "./auth";
import { b64url, constantTimeEqual, randomToken, sha256, sha256Hex } from "./crypto";
import { prune, withinLimit } from "./db";
import { CALLBACK_URL, type Env } from "./env";
import { error, getCookie, now, readCapped } from "./http";

export const STATE_COOKIE = "__Host-blx_oidc";
export const ALGORITHMS = ["RS256", "ES256", "EdDSA"];
const PENDING_SECONDS = 600;
const CACHE_SECONDS = 600;
const JWKS_REFETCH_FLOOR = 60;
const FETCH_TIMEOUT_MS = 5000;
const FETCH_LIMIT = 64 * 1024;
const LOGIN_LIMIT = 60;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

let discoveryCache: { issuer: string; doc: Discovery; at: number } | null = null;
let jwksCache: { uri: string; jwks: JSONWebKeySet; at: number } | null = null;

export function resetOidcCache(): void {
  discoveryCache = null;
  jwksCache = null;
}

function configured(env: Env): boolean {
  return Boolean(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET && env.PORTAL_ORIGIN);
}

function httpsUrl(s: unknown): s is string {
  if (typeof s !== "string") return false;
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (res.status !== 200) throw new Error(`oidc: ${new URL(url).pathname} returned ${res.status}`);
  const bytes = await readCapped(res, FETCH_LIMIT);
  if (bytes === null) throw new Error("oidc: response too large");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
}

async function discovery(env: Env): Promise<Discovery> {
  const t = now();
  if (discoveryCache && discoveryCache.issuer === env.OIDC_ISSUER && t - discoveryCache.at < CACHE_SECONDS) {
    return discoveryCache.doc;
  }
  const base = env.OIDC_ISSUER.endsWith("/") ? env.OIDC_ISSUER : env.OIDC_ISSUER + "/";
  const doc = (await fetchJson(base + ".well-known/openid-configuration")) as Partial<Discovery> | null;
  if (
    !doc ||
    doc.issuer !== env.OIDC_ISSUER ||
    !httpsUrl(doc.authorization_endpoint) ||
    !httpsUrl(doc.token_endpoint) ||
    !httpsUrl(doc.jwks_uri)
  ) {
    throw new Error("oidc: discovery document refused");
  }
  const clean: Discovery = {
    issuer: doc.issuer,
    authorization_endpoint: doc.authorization_endpoint,
    token_endpoint: doc.token_endpoint,
    jwks_uri: doc.jwks_uri,
  };
  discoveryCache = { issuer: env.OIDC_ISSUER, doc: clean, at: t };
  return clean;
}

async function jwks(uri: string, force: boolean): Promise<JSONWebKeySet> {
  const t = now();
  if (jwksCache && jwksCache.uri === uri) {
    const age = t - jwksCache.at;
    if (!force && age < CACHE_SECONDS) return jwksCache.jwks;
    if (force && age < JWKS_REFETCH_FLOOR) return jwksCache.jwks;
  }
  const set = (await fetchJson(uri)) as JSONWebKeySet | null;
  if (!set || !Array.isArray(set.keys)) throw new Error("oidc: jwks refused");
  jwksCache = { uri, jwks: set, at: t };
  return set;
}

function redirect(location: string, cookies: string[]): Response {
  const h = new Headers({ location, "cache-control": "no-store" });
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(null, { status: 302, headers: h });
}

function stateCookie(state: string): string {
  return `${STATE_COOKIE}=${state}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${PENDING_SECONDS}`;
}

function clearStateCookie(): string {
  return `${STATE_COOKIE}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function failed(): Response {
  return error(400, "sign-in failed", { "set-cookie": clearStateCookie() });
}

export async function login(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await withinLimit(env.DB, "login:" + (await sha256Hex(ip)), LOGIN_LIMIT))) return error(429, "rate limited");
  // Every login start prunes: old rate-limit windows, and expired pending and session rows.
  await prune(env.DB);
  if (!configured(env)) return error(503, "sign-in unavailable");
  let doc: Discovery;
  try {
    doc = await discovery(env);
  } catch (e) {
    console.error("blunix-api:", e instanceof Error ? e.message : "oidc discovery failed");
    return error(503, "sign-in unavailable");
  }
  const state = randomToken();
  const verifier = randomToken();
  const nonce = randomToken();
  const t = now();
  await env.DB.prepare("INSERT INTO oidc_pending (state, verifier, nonce, expires) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(state), verifier, nonce, t + PENDING_SECONDS)
    .run();
  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.OIDC_CLIENT_ID);
  url.searchParams.set("redirect_uri", CALLBACK_URL);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", b64url(await sha256(verifier)));
  url.searchParams.set("code_challenge_method", "S256");
  return redirect(url.toString(), [stateCookie(state)]);
}

// What the portal shows as "Signed in as ...": name, else preferred_username, else
// email, from the already-verified ID token. Display only: never used for identity
// (that is iss + sub) or authorization. Control and format characters are dropped and
// the result is capped, so a hostile claim cannot forge layout or bloat the row.
const DISPLAY_MAX = 100;
export function displayName(p: Record<string, unknown>): string | null {
  for (const k of ["name", "preferred_username", "email"]) {
    const v = p[k];
    if (typeof v !== "string") continue;
    const clean = v.normalize("NFC").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "").replace(/\s+/g, " ").trim();
    if (clean) return [...clean].slice(0, DISPLAY_MAX).join("");
  }
  return null;
}

async function verifyIdToken(
  env: Env,
  doc: Discovery,
  idToken: string,
  nonce: string,
): Promise<{ sub: string; name: string | null } | null> {
  const options = {
    issuer: env.OIDC_ISSUER,
    audience: env.OIDC_CLIENT_ID,
    algorithms: ALGORITHMS,
    requiredClaims: ["exp", "iat", "sub", "nonce"],
    clockTolerance: 60,
  };
  let result;
  try {
    result = await jwtVerify(idToken, createLocalJWKSet(await jwks(doc.jwks_uri, false)), options);
  } catch (e) {
    if (!(e instanceof joseErrors.JWKSNoMatchingKey)) throw e;
    // The issuer may have rotated. Refetch once, no more than once a minute.
    result = await jwtVerify(idToken, createLocalJWKSet(await jwks(doc.jwks_uri, true)), options);
  }
  const p = result.payload;
  if (typeof p.nonce !== "string" || !(await constantTimeEqual(p.nonce, nonce))) return null;
  const multi = Array.isArray(p.aud) && p.aud.length > 1;
  if ((multi || p.azp !== undefined) && p.azp !== env.OIDC_CLIENT_ID) return null;
  if (typeof p.sub !== "string" || p.sub.length === 0 || p.sub.length > 255) return null;
  return { sub: p.sub, name: displayName(p) };
}

export async function callback(req: Request, env: Env): Promise<Response> {
  if (!configured(env)) return error(503, "sign-in unavailable");
  const q = new URL(req.url).searchParams;
  const state = q.get("state");
  const code = q.get("code");
  if (q.has("error") || state === null || code === null) return failed();
  if (!TOKEN.test(state) || !/^[\x21-\x7e]{1,2048}$/.test(code)) return failed();
  const bound = getCookie(req, STATE_COOKIE);
  if (bound === null || !(await constantTimeEqual(bound, state))) return failed();

  // Single use: the row is gone before the code is spent.
  const pending = await env.DB.prepare("DELETE FROM oidc_pending WHERE state = ? RETURNING verifier, nonce, expires")
    .bind(await sha256Hex(state))
    .first<{ verifier: string; nonce: string; expires: number }>();
  if (!pending || pending.expires < now()) return failed();

  let who: { sub: string; name: string | null } | null;
  try {
    const doc = await discovery(env);
    const basic = btoa(`${encodeURIComponent(env.OIDC_CLIENT_ID)}:${encodeURIComponent(env.OIDC_CLIENT_SECRET)}`);
    const tokens = (await fetchJson(doc.token_endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: CALLBACK_URL,
        code_verifier: pending.verifier,
        client_id: env.OIDC_CLIENT_ID,
      }),
    })) as { id_token?: unknown } | null;
    if (!tokens || typeof tokens.id_token !== "string") return failed();
    who = await verifyIdToken(env, doc, tokens.id_token, pending.nonce);
  } catch (e) {
    console.error("blunix-api: sign-in refused:", e instanceof Error ? e.name : "error");
    return failed();
  }
  if (who === null) return failed();

  const t = now();
  const account = await env.DB.prepare(
    "INSERT INTO accounts (iss, sub, display_name, created) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT (iss, sub) DO UPDATE SET display_name = excluded.display_name RETURNING id",
  )
    .bind(env.OIDC_ISSUER, who.sub, who.name, t)
    .first<{ id: number }>();
  if (!account) return error(500, "internal error");
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires < ?").bind(t),
    env.DB.prepare("INSERT INTO sessions (token_hash, account_id, created, expires) VALUES (?, ?, ?, ?)").bind(
      await sha256Hex(token),
      account.id,
      t,
      t + SESSION_SECONDS,
    ),
  ]);
  return redirect(`${env.PORTAL_ORIGIN}/`, [sessionCookie(token), clearStateCookie()]);
}

export async function logout(env: Env, tokenHash: string): Promise<Response> {
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": clearSessionCookie(), "cache-control": "no-store" },
  });
}
