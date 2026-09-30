import { afterEach, describe, expect, it, vi } from "vitest";
import { prune, withinLimit } from "../src/db";
import { API, call, env } from "./helpers";

const hour = () => Math.floor(Date.now() / 1000 / 3600);
const t = () => Math.floor(Date.now() / 1000);

async function seed(tag: string): Promise<void> {
  const acct = await env.DB.prepare("INSERT INTO accounts (iss, sub, created) VALUES (?, ?, ?) RETURNING id")
    .bind("https://prune.test/", crypto.randomUUID(), t())
    .first<{ id: number }>();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO rate_limits (key, win, count) VALUES (?, ?, 1)").bind(`${tag}:old`, hour() - 5),
    env.DB.prepare("INSERT INTO rate_limits (key, win, count) VALUES (?, ?, 1)").bind(`${tag}:prev`, hour() - 1),
    env.DB.prepare("INSERT INTO rate_limits (key, win, count) VALUES (?, ?, 1)").bind(`${tag}:now`, hour()),
    env.DB.prepare("INSERT INTO oidc_pending (state, verifier, nonce, expires) VALUES (?, 'v', 'n', ?)").bind(`${tag}:gone`, t() - 1),
    env.DB.prepare("INSERT INTO oidc_pending (state, verifier, nonce, expires) VALUES (?, 'v', 'n', ?)").bind(`${tag}:live`, t() + 600),
    env.DB.prepare("INSERT INTO sessions (token_hash, account_id, created, expires) VALUES (?, ?, ?, ?)").bind(`${tag}:gone`, acct!.id, t() - 99, t() - 1),
    env.DB.prepare("INSERT INTO sessions (token_hash, account_id, created, expires) VALUES (?, ?, ?, ?)").bind(`${tag}:live`, acct!.id, t(), t() + 600),
  ]);
}

async function left(tag: string): Promise<string[]> {
  const q = async (sql: string) => (await env.DB.prepare(sql).bind(`${tag}:%`).all<{ k: string }>()).results.map((r) => r.k);
  return [
    ...(await q("SELECT 'rl ' || key AS k FROM rate_limits WHERE key LIKE ?")),
    ...(await q("SELECT 'op ' || state AS k FROM oidc_pending WHERE state LIKE ?")),
    ...(await q("SELECT 's ' || token_hash AS k FROM sessions WHERE token_hash LIKE ?")),
  ].sort();
}

const KEPT = (tag: string) => [`op ${tag}:live`, `rl ${tag}:now`, `rl ${tag}:prev`, `s ${tag}:live`].sort();

describe("pruning", () => {
  afterEach(() => vi.restoreAllMocks());

  it("drops old rate-limit windows and expired pending and session rows, keeps the rest", async () => {
    await seed("p1");
    await prune(env.DB);
    expect(await left("p1")).toEqual(KEPT("p1"));
  });

  it("prunes on every login start, even when sign-in is not configured", async () => {
    await seed("p2");
    const res = await call(`${API}/v1/auth/login`, { headers: { "cf-connecting-ip": "192.0.2.201" } }, { OIDC_ISSUER: "" });
    expect(res.status).toBe(503);
    expect(await left("p2")).toEqual(KEPT("p2"));
  });

  it("prunes from the rate limiter when the draw is 0 mod 64, and not otherwise", async () => {
    await seed("p3");
    const draw = vi.spyOn(crypto, "getRandomValues");
    const fix = (n: number) =>
      draw.mockImplementation(((a: Uint32Array) => {
        a[0] = n;
        return a;
      }) as unknown as typeof crypto.getRandomValues);
    fix(65);
    expect(await withinLimit(env.DB, "p3:probe", 10)).toBe(true);
    expect(await left("p3")).toContain("rl p3:old");
    fix(128);
    expect(await withinLimit(env.DB, "p3:probe", 10)).toBe(true);
    expect(await left("p3")).toEqual([...KEPT("p3"), "rl p3:probe"].sort());
  });
});
