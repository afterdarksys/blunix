import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { b64url, sha256, sha256Hex } from "../src/crypto";
import { resetOidcCache } from "../src/oidc";
import { API, call, env, PORTAL } from "./helpers";

// Generated per run. Nothing here is a real secret.
const ISSUER = "https://issuer.test/application/o/blunix/";
const CLIENT = "blunix-test-client";

type Alg = "RS256" | "ES256" | "EdDSA";
const keys: Record<string, { privateKey: CryptoKey; jwk: JWK }> = {};

async function makeKey(alg: Alg | "RS384", kid: string) {
  const pair = await generateKeyPair(alg, { extractable: true });
  const jwk = { ...(await exportJWK(pair.publicKey)), kid, alg, use: "sig" };
  keys[kid] = { privateKey: pair.privateKey as CryptoKey, jwk };
}

interface Claims {
  alg?: Alg | "RS384";
  kid?: string;
  iss?: string;
  aud?: string | string[];
  azp?: string;
  sub?: string;
  nonce?: string;
  exp?: number;
}

async function idToken(nonce: string, c: Claims = {}): Promise<string> {
  const kid = c.kid ?? "rs";
  const claims: Record<string, unknown> = { nonce: c.nonce ?? nonce };
  if (c.azp) claims.azp = c.azp;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: c.alg ?? keys[kid].jwk.alg!, kid })
    .setIssuer(c.iss ?? ISSUER)
    .setAudience(c.aud ?? CLIENT)
    .setSubject(c.sub ?? "user-1")
    .setIssuedAt()
    .setExpirationTime(c.exp ?? Math.floor(Date.now() / 1000) + 300)
    .sign(keys[kid].privateKey);
}

function unsigned(nonce: string): string {
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const t = Math.floor(Date.now() / 1000);
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({ iss: ISSUER, aud: CLIENT, sub: "user-1", nonce, iat: t, exp: t + 300 })}.`;
}

// The fake issuer. `token` decides what the token endpoint hands back.
let discovery: Record<string, unknown> | null;
let discoveryStatus = 200;
let published: string[] = [];
let token: (form: URLSearchParams) => Promise<string>;
let lastForm: URLSearchParams | null;
let lastAuth: string | null;

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  return (async () => {
    const url = req.url;
    if (url === `${ISSUER}.well-known/openid-configuration`) {
      if (discovery === null) throw new TypeError("network down");
      return Response.json(discovery, { status: discoveryStatus });
    }
    if (url === "https://issuer.test/jwks") {
      return Response.json({ keys: published.map((k) => keys[k].jwk) });
    }
    if (url === "https://issuer.test/token" && req.method === "POST") {
      lastForm = new URLSearchParams(new TextDecoder().decode(await req.arrayBuffer()));
      lastAuth = req.headers.get("authorization");
      return Response.json({ access_token: "at", token_type: "Bearer", id_token: await token(lastForm) });
    }
    return new Response("not found", { status: 404 });
  })();
}

let ipCounter = 0;

async function startLogin() {
  ipCounter++;
  const res = await call(`${API}/v1/auth/login`, { headers: { "cf-connecting-ip": `198.51.100.${ipCounter % 250}` } });
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get("location")!);
  const cookie = res.headers.get("set-cookie")!;
  const state = loc.searchParams.get("state")!;
  return { res, loc, cookie, state, nonce: loc.searchParams.get("nonce")!, challenge: loc.searchParams.get("code_challenge")! };
}

function finish(state: string, cookieState: string | null, extra = ""): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookieState !== null) headers.cookie = `__Host-blx_oidc=${cookieState}`;
  return call(`${API}/v1/auth/callback?code=code-123&state=${encodeURIComponent(state)}${extra}`, { headers });
}

async function loginWith(c: Claims | ((nonce: string) => Promise<string>)): Promise<Response> {
  const s = await startLogin();
  token = typeof c === "function" ? () => c(s.nonce) : () => idToken(s.nonce, c);
  return finish(s.state, s.state);
}

async function expectRefused(res: Response) {
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "sign-in failed" });
  expect(res.headers.get("set-cookie") ?? "").not.toContain("__Host-blx_session=");
}

beforeAll(async () => {
  await makeKey("RS256", "rs");
  await makeKey("ES256", "es");
  await makeKey("EdDSA", "ed");
  await makeKey("RS256", "stranger");
  await makeKey("RS384", "rs384");
});

beforeEach(() => {
  resetOidcCache();
  discovery = {
    issuer: ISSUER,
    authorization_endpoint: "https://issuer.test/authorize",
    token_endpoint: "https://issuer.test/token",
    jwks_uri: "https://issuer.test/jwks",
  };
  discoveryStatus = 200;
  published = ["rs", "es", "ed", "rs384"];
  lastForm = null;
  lastAuth = null;
  vi.stubGlobal("fetch", fakeFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OIDC login start", () => {
  it("redirects to the issuer with PKCE S256, state, nonce, and a bound state cookie", async () => {
    const s = await startLogin();
    expect(s.loc.origin + s.loc.pathname).toBe("https://issuer.test/authorize");
    const q = s.loc.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe(CLIENT);
    expect(q.get("redirect_uri")).toBe("https://api.blunix.io/v1/auth/callback");
    expect(q.get("scope")).toBe("openid");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(s.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.cookie).toBe(`__Host-blx_oidc=${s.state}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);

    const row = await env.DB.prepare("SELECT * FROM oidc_pending WHERE state = ?").bind(await sha256Hex(s.state)).first<{ expires: number }>();
    expect(row).not.toBeNull();
    expect(row!.expires - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(600);
    const raw = await env.DB.prepare("SELECT COUNT(*) AS n FROM oidc_pending WHERE state = ?").bind(s.state).first<{ n: number }>();
    expect(raw!.n).toBe(0);
  });

  it("fails closed when discovery is missing, broken, or names another issuer", async () => {
    discovery = null;
    let res = await call(`${API}/v1/auth/login`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "sign-in unavailable" });

    resetOidcCache();
    discovery = { issuer: ISSUER };
    discoveryStatus = 404;
    expect((await call(`${API}/v1/auth/login`)).status).toBe(503);

    resetOidcCache();
    discoveryStatus = 200;
    discovery = {
      issuer: "https://evil.test/",
      authorization_endpoint: "https://issuer.test/authorize",
      token_endpoint: "https://issuer.test/token",
      jwks_uri: "https://issuer.test/jwks",
    };
    expect((await call(`${API}/v1/auth/login`)).status).toBe(503);

    resetOidcCache();
    discovery = {
      issuer: ISSUER,
      authorization_endpoint: "http://issuer.test/authorize",
      token_endpoint: "https://issuer.test/token",
      jwks_uri: "https://issuer.test/jwks",
    };
    expect((await call(`${API}/v1/auth/login`)).status).toBe(503);
  });

  it("rate-limits login starts at 60 per IP per hour", async () => {
    const headers = { "cf-connecting-ip": "203.0.113.77" };
    for (let i = 0; i < 60; i++) expect((await call(`${API}/v1/auth/login`, { headers })).status).toBe(302);
    const res = await call(`${API}/v1/auth/login`, { headers });
    expect(res.status).toBe(429);
    expect((await call(`${API}/v1/auth/login`, { headers: { "cf-connecting-ip": "203.0.113.78" } })).status).toBe(302);
    const rows = await env.DB.prepare("SELECT key FROM rate_limits WHERE key LIKE 'login:%'").all<{ key: string }>();
    expect(JSON.stringify(rows.results)).not.toContain("203.0.113.77");
  });
});

describe("OIDC callback", () => {
  it("signs in with RS256: PKCE verifier matches, session cookie set, redirect to the portal", async () => {
    const s = await startLogin();
    token = () => idToken(s.nonce);
    const res = await finish(s.state, s.state);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${PORTAL}/`);
    expect(b64url(await sha256(lastForm!.get("code_verifier")!))).toBe(s.challenge);
    expect(lastForm!.get("grant_type")).toBe("authorization_code");
    expect(lastForm!.get("redirect_uri")).toBe("https://api.blunix.io/v1/auth/callback");
    expect(lastAuth).toBe(`Basic ${btoa(`${CLIENT}:test-only-not-a-secret`)}`);

    const cookies = res.headers.getSetCookie();
    const sessionCookie = cookies.find((c) => c.startsWith("__Host-blx_session="))!;
    expect(sessionCookie).toMatch(/^__Host-blx_session=[A-Za-z0-9_-]{43}; Secure; HttpOnly; SameSite=Lax; Path=\/; Max-Age=43200$/);
    expect(cookies.some((c) => c.startsWith("__Host-blx_oidc=;"))).toBe(true);

    const value = sessionCookie.split(";")[0].split("=")[1];
    const me = await call(`${API}/v1/me`, { headers: { cookie: `__Host-blx_session=${value}` } });
    expect(me.status).toBe(200);
    const stored = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?").bind(value).first<{ n: number }>();
    expect(stored!.n).toBe(0);
  });

  it("accepts ES256 and EdDSA", async () => {
    expect((await loginWith({ kid: "es" })).status).toBe(302);
    expect((await loginWith({ kid: "ed" })).status).toBe(302);
  });

  it("upserts one account per (iss, sub)", async () => {
    await loginWith({ sub: "same-person" });
    await loginWith({ sub: "same-person" });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts WHERE sub = 'same-person'").first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("rejects alg none", async () => {
    await expectRefused(await loginWith((nonce) => Promise.resolve(unsigned(nonce))));
  });

  it("rejects an algorithm outside the allowlist, even with a published key", async () => {
    await expectRefused(await loginWith({ kid: "rs384" }));
  });

  it("rejects a token signed by a key the issuer does not publish", async () => {
    await expectRefused(await loginWith({ kid: "stranger" }));
  });

  it("rejects a tampered signature", async () => {
    await expectRefused(
      await loginWith(async (nonce) => {
        const t = await idToken(nonce);
        const [h, p] = t.split(".");
        const other = await idToken(nonce, { sub: "someone-else" });
        return `${h}.${other.split(".")[1]}.${t.split(".")[2]}`.replace(p, other.split(".")[1]);
      }),
    );
  });

  it("rejects the wrong audience", async () => {
    await expectRefused(await loginWith({ aud: "some-other-client" }));
  });

  it("rejects multiple audiences without a matching azp", async () => {
    await expectRefused(await loginWith({ aud: [CLIENT, "other"] }));
    await expectRefused(await loginWith({ aud: [CLIENT, "other"], azp: "other" }));
    expect((await loginWith({ aud: [CLIENT, "other"], azp: CLIENT })).status).toBe(302);
  });

  it("rejects the wrong issuer", async () => {
    await expectRefused(await loginWith({ iss: "https://evil.test/" }));
  });

  it("rejects an expired token", async () => {
    await expectRefused(await loginWith({ exp: Math.floor(Date.now() / 1000) - 3600 }));
  });

  it("rejects the wrong nonce", async () => {
    await expectRefused(await loginWith({ nonce: "A".repeat(43) }));
  });

  it("rejects a state that does not match the browser's state cookie", async () => {
    const s = await startLogin();
    const other = await startLogin();
    token = () => idToken(s.nonce);
    await expectRefused(await finish(s.state, other.state));
    await expectRefused(await finish(s.state, null));
  });

  it("rejects a replayed state", async () => {
    const s = await startLogin();
    token = () => idToken(s.nonce);
    expect((await finish(s.state, s.state)).status).toBe(302);
    await expectRefused(await finish(s.state, s.state));
  });

  it("rejects an unknown or expired state", async () => {
    const fake = "B".repeat(43);
    await expectRefused(await finish(fake, fake));
    const s = await startLogin();
    token = () => idToken(s.nonce);
    await env.DB.prepare("UPDATE oidc_pending SET expires = 1 WHERE state = ?").bind(await sha256Hex(s.state)).run();
    await expectRefused(await finish(s.state, s.state));
  });

  it("rejects an error response from the issuer, and missing parameters", async () => {
    const s = await startLogin();
    token = () => idToken(s.nonce);
    await expectRefused(await finish(s.state, s.state, "&error=access_denied"));
    await expectRefused(await call(`${API}/v1/auth/callback`));
    await expectRefused(await call(`${API}/v1/auth/callback?state=${s.state}`, { headers: { cookie: `__Host-blx_oidc=${s.state}` } }));
  });

  it("does not touch the token endpoint when the state check fails", async () => {
    const s = await startLogin();
    token = () => idToken(s.nonce);
    await finish(s.state, "C".repeat(43));
    expect(lastForm).toBeNull();
  });

  it("refetches the JWKS once when the issuer rotates", async () => {
    published = ["es"];
    expect((await loginWith({ kid: "es" })).status).toBe(302);
    published = ["rs"];
    // The cached set no longer has the signing key. The refetch floor is 60 s, so the
    // cache is aged by hand.
    resetOidcCache();
    expect((await loginWith({ kid: "rs" })).status).toBe(302);
  });
});
