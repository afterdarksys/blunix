import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/crypto";
import { ageScrypt, API, bearer, call, env, jsonInit, newAccount, newKey, reserve, session, uniqueLabel, upload } from "./helpers";

describe("program keys", () => {
  it("returns a blx_ key once, with its fingerprint, and never again", async () => {
    const a = await newAccount();
    const res = await call(`${API}/v1/keys`, jsonInit("POST", session(a.cookie), { name: "ci" }));
    expect(res.status).toBe(201);
    const out = (await res.json()) as { key: string; fingerprint: string; scopes: string[] };
    expect(out.key).toMatch(/^blx_[A-Za-z0-9_-]{43}$/);
    expect(out.key.startsWith("blx_join_")).toBe(false);
    expect(out.fingerprint).toBe(await sha256Hex(out.key));
    expect(out.scopes).toEqual(["hosts:write"]);

    const list = await call(`${API}/v1/keys`, { headers: session(a.cookie) });
    const text = await list.text();
    expect(text).not.toContain(out.key);
    expect(text).not.toContain(out.key.slice(4));
    expect(JSON.parse(text)).toEqual({
      keys: [{ fingerprint: out.fingerprint, name: "ci", scopes: ["hosts:write"], created: expect.any(String) }],
    });

    const row = await env.DB.prepare("SELECT * FROM api_keys WHERE account_id = ?").bind(a.id).first();
    expect(JSON.stringify(row)).not.toContain(out.key.slice(4));
  });

  it("authenticates a key for /v1/me and hosts", async () => {
    const a = await newAccount();
    const { key } = await newKey(a.cookie);
    expect((await call(`${API}/v1/me`, { headers: bearer(key) })).status).toBe(200);
    expect((await call(`${API}/v1/hosts`, { headers: bearer(key) })).status).toBe(200);
  });

  it("limits a hosts:read key to reads", async () => {
    const a = await newAccount();
    const label = uniqueLabel();
    await reserve(a.cookie, label);
    const { key } = await newKey(a.cookie, ["hosts:read"]);
    expect((await call(`${API}/v1/hosts`, { headers: bearer(key) })).status).toBe(200);
    expect((await call(`${API}/v1/hosts/${label}`, { headers: bearer(key) })).status).toBe(200);
    expect((await call(`${API}/v1/hosts`, jsonInit("POST", bearer(key), { label: uniqueLabel() }))).status).toBe(403);
    expect((await upload(bearer(key), label, await ageScrypt())).status).toBe(403);
    expect((await call(`${API}/v1/hosts/${label}`, { method: "DELETE", headers: bearer(key) })).status).toBe(403);
  });

  it("keeps key management session-only", async () => {
    const a = await newAccount();
    const { key, fingerprint } = await newKey(a.cookie);
    expect((await call(`${API}/v1/keys`, { headers: bearer(key) })).status).toBe(403);
    expect((await call(`${API}/v1/keys`, jsonInit("POST", bearer(key), { name: "x" }))).status).toBe(403);
    expect((await call(`${API}/v1/keys/${fingerprint}`, { method: "DELETE", headers: bearer(key) })).status).toBe(403);
    expect((await call(`${API}/v1/auth/logout`, { method: "POST", headers: bearer(key) })).status).toBe(403);
  });

  it("revokes immediately", async () => {
    const a = await newAccount();
    const { key, fingerprint } = await newKey(a.cookie);
    const res = await call(`${API}/v1/keys/${fingerprint}`, { method: "DELETE", headers: session(a.cookie) });
    expect(res.status).toBe(204);
    const after = await call(`${API}/v1/me`, { headers: bearer(key) });
    expect(after.status).toBe(401);
    expect(await after.json()).toEqual({ error: "unauthorized" });
    expect((await call(`${API}/v1/keys/${fingerprint}`, { method: "DELETE", headers: session(a.cookie) })).status).toBe(404);
    const list = (await (await call(`${API}/v1/keys`, { headers: session(a.cookie) })).json()) as { keys: unknown[] };
    expect(list.keys).toEqual([]);
  });

  it("will not revoke another account's key", async () => {
    const a = await newAccount();
    const b = await newAccount();
    const { key, fingerprint } = await newKey(a.cookie);
    expect((await call(`${API}/v1/keys/${fingerprint}`, { method: "DELETE", headers: session(b.cookie) })).status).toBe(404);
    expect((await call(`${API}/v1/me`, { headers: bearer(key) })).status).toBe(200);
  });

  it("refuses blx_join_ tokens everywhere with 401", async () => {
    const join = "blx_join_" + "A".repeat(38);
    for (const path of ["/v1/me", "/v1/hosts", "/v1/keys"]) {
      expect((await call(`${API}${path}`, { headers: bearer(join) })).status, path).toBe(401);
    }
    // Even if a row with its hash existed.
    const a = await newAccount();
    await env.DB.prepare("INSERT INTO api_keys (fingerprint, account_id, name, scopes, created) VALUES (?, ?, 'j', 'hosts:write', 0)")
      .bind(await sha256Hex(join), a.id)
      .run();
    expect((await call(`${API}/v1/me`, { headers: bearer(join) })).status).toBe(401);
    expect((await call(`${API}/v1/hosts`, jsonInit("POST", bearer(join), { label: uniqueLabel() }))).status).toBe(401);
  });

  it("refuses malformed and unknown bearer values with 401", async () => {
    const values = ["blx_short", "blx_" + "A".repeat(44), "blx_" + "!".repeat(43), "blx_" + "A".repeat(43), "Basic abc"];
    for (const v of values) {
      expect((await call(`${API}/v1/me`, { headers: { authorization: v.startsWith("Basic") ? v : `Bearer ${v}` } })).status, v).toBe(401);
    }
  });

  it("does not fall back to the cookie when a bad bearer is present", async () => {
    const a = await newAccount();
    const res = await call(`${API}/v1/me`, { headers: { ...session(a.cookie), authorization: "Bearer blx_nope" } });
    expect(res.status).toBe(401);
  });

  it("validates name and scopes", async () => {
    const a = await newAccount();
    const bad = [
      {},
      { name: "" },
      { name: "   " },
      { name: "x".repeat(65) },
      { name: "tab\there" },
      { name: "ok", scopes: [] },
      { name: "ok", scopes: ["admin"] },
      { name: "ok", scopes: ["hosts:read", "hosts:read"] },
      { name: "ok", scopes: "hosts:read" },
    ];
    for (const body of bad) {
      expect((await call(`${API}/v1/keys`, jsonInit("POST", session(a.cookie), body))).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("audits key events by fingerprint only", async () => {
    const a = await newAccount();
    const { key, fingerprint } = await newKey(a.cookie);
    await call(`${API}/v1/keys/${fingerprint}`, { method: "DELETE", headers: session(a.cookie) });
    const { results } = await env.DB.prepare("SELECT event, key_fingerprint FROM audit WHERE account_id = ? ORDER BY id").bind(a.id).all();
    expect(results).toEqual([
      { event: "key.create", key_fingerprint: fingerprint },
      { event: "key.revoke", key_fingerprint: fingerprint },
    ]);
    expect(JSON.stringify(results)).not.toContain(key.slice(4));
  });
});
