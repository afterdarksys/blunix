import { describe, expect, it } from "vitest";
import { API, bearer, call, env, jsonInit, newAccount, newKey, PORTAL, reserve, session, uniqueLabel } from "./helpers";

describe("host names", () => {
  it("reserves a label, shows it, lists it, and reports it in /v1/me", async () => {
    const a = await newAccount();
    const label = uniqueLabel();
    const res = await reserve(a.cookie, label);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ label, url: `https://${label}.blnx.io/` });

    const show = await call(`${API}/v1/hosts/${label}`, { headers: session(a.cookie) });
    expect(show.status).toBe(200);
    expect(await show.json()).toMatchObject({ label, versions: [] });

    const list = await call(`${API}/v1/hosts`, { headers: session(a.cookie) });
    const body = (await list.json()) as { hosts: { label: string; latest: unknown }[] };
    expect(body.hosts).toEqual([expect.objectContaining({ label, latest: null })]);

    const me = await call(`${API}/v1/me`, { headers: session(a.cookie) });
    expect(await me.json()).toMatchObject({ account: { id: String(a.id) }, labels: [label] });
  });

  it("refuses invalid labels with 400", async () => {
    const bad = ["a", "a".repeat(33), "xn--80ak6aa92e", "a--b", "Ada", "-ab", "ab-", "1ab", "a.b", 7, null];
    let a = await newAccount();
    for (const [i, label] of bad.entries()) {
      // Attempts count toward the hourly limit, so spread them over two accounts.
      if (i === 6) a = await newAccount();
      const res = await call(`${API}/v1/hosts`, jsonInit("POST", session(a.cookie), { label }));
      expect(res.status, String(label)).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid label" });
    }
  });

  it("refuses reserved labels and every v{n} with 400", async () => {
    const a = await newAccount();
    for (const label of ["www", "api", "build", "portal", "status", "v1", "v42", "v007"]) {
      const res = await reserve(a.cookie, label);
      expect(res.status, label).toBe(400);
      expect(await res.json()).toEqual({ error: "reserved label" });
    }
  });

  it("answers 409 for a label someone else holds", async () => {
    const a = await newAccount();
    const b = await newAccount();
    const label = uniqueLabel();
    expect((await reserve(a.cookie, label)).status).toBe(201);
    const res = await reserve(b.cookie, label);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "label taken" });
    expect((await reserve(a.cookie, label)).status).toBe(409);
  });

  it("holds a deleted label for 30 days, then frees it", async () => {
    const a = await newAccount();
    const b = await newAccount();
    const label = uniqueLabel();
    await reserve(a.cookie, label);
    const del = await call(`${API}/v1/hosts/${label}`, { method: "DELETE", headers: session(a.cookie) });
    expect(del.status).toBe(204);
    expect((await reserve(b.cookie, label)).status).toBe(409);
    expect((await reserve(a.cookie, label)).status).toBe(409);

    const t = Math.floor(Date.now() / 1000);
    await env.DB.prepare("UPDATE labels SET deleted_at = ? WHERE label = ?").bind(t - 29 * 86400, label).run();
    expect((await reserve(b.cookie, label)).status).toBe(409);
    await env.DB.prepare("UPDATE labels SET deleted_at = ? WHERE label = ?").bind(t - 31 * 86400, label).run();
    expect((await reserve(b.cookie, label)).status).toBe(201);
  });

  it("caps an account at 20 live labels", async () => {
    const a = await newAccount();
    const t = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 19; i++) {
      await env.DB.prepare("INSERT INTO labels (label, account_id, created) VALUES (?, ?, ?)")
        .bind(uniqueLabel("cap"), a.id, t)
        .run();
    }
    expect((await reserve(a.cookie, uniqueLabel())).status).toBe(201);
    const res = await reserve(a.cookie, uniqueLabel());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "label limit" });
  });

  it("rate-limits reservations at 10 per account per hour", async () => {
    const a = await newAccount();
    for (let i = 0; i < 10; i++) expect((await reserve(a.cookie, "www")).status).toBe(400);
    const res = await reserve(a.cookie, uniqueLabel());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate limited" });
  });

  it("answers 404, not 403, for another account's label", async () => {
    const a = await newAccount();
    const b = await newAccount();
    const label = uniqueLabel();
    await reserve(a.cookie, label);
    const missing = await call(`${API}/v1/hosts/${uniqueLabel()}`, { headers: session(b.cookie) });
    const theirs = await call(`${API}/v1/hosts/${label}`, { headers: session(b.cookie) });
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect((await call(`${API}/v1/hosts/${label}`, { method: "DELETE", headers: session(b.cookie) })).status).toBe(404);
    expect((await call(`${API}/v1/hosts/${label}/builds/1`, { method: "DELETE", headers: session(b.cookie) })).status).toBe(404);
    const list = (await (await call(`${API}/v1/hosts`, { headers: session(b.cookie) })).json()) as { hosts: unknown[] };
    expect(list.hosts).toEqual([]);
    // Still there for its owner.
    expect((await call(`${API}/v1/hosts/${label}`, { headers: session(a.cookie) })).status).toBe(200);
  });

  it("refuses JSON bodies over 8 KiB and non-JSON bodies", async () => {
    const a = await newAccount();
    const big = await call(`${API}/v1/hosts`, jsonInit("POST", session(a.cookie), { label: "ada", pad: "x".repeat(9000) }));
    expect(big.status).toBe(413);
    const text = await call(`${API}/v1/hosts`, {
      method: "POST",
      headers: { ...session(a.cookie), "content-type": "text/plain" },
      body: "label=ada",
    });
    expect(text.status).toBe(415);
    const broken = await call(`${API}/v1/hosts`, {
      method: "POST",
      headers: { ...session(a.cookie), "content-type": "application/json" },
      body: "{not json <script>",
    });
    expect(broken.status).toBe(400);
    expect(await broken.text()).toBe('{"error":"bad request"}');
  });
});

describe("session CSRF and CORS", () => {
  it("refuses a session write without x-blunix-csrf", async () => {
    const a = await newAccount();
    const headers = session(a.cookie);
    delete headers["x-blunix-csrf"];
    const res = await call(`${API}/v1/hosts`, jsonInit("POST", headers, { label: uniqueLabel() }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "csrf" });
  });

  it("refuses a session write with a wrong csrf value", async () => {
    const a = await newAccount();
    const res = await call(`${API}/v1/hosts`, jsonInit("POST", session(a.cookie, { "x-blunix-csrf": "true" }), { label: uniqueLabel() }));
    expect(res.status).toBe(403);
  });

  it("refuses a session write from the wrong Origin, or none", async () => {
    const a = await newAccount();
    for (const origin of ["https://evil.example", "https://blunix.io", "https://build.blunix.io.evil.example", "http://build.blunix.io", "https://api.blunix.io", "https://ada.blnx.io", "null"]) {
      const res = await call(`${API}/v1/hosts`, jsonInit("POST", session(a.cookie, { origin }), { label: uniqueLabel() }));
      expect(res.status, origin).toBe(403);
    }
    const headers = session(a.cookie);
    delete headers.origin;
    expect((await call(`${API}/v1/hosts`, jsonInit("POST", headers, { label: uniqueLabel() }))).status).toBe(403);
  });

  it("refuses session DELETE and logout without CSRF", async () => {
    const a = await newAccount();
    const label = uniqueLabel();
    await reserve(a.cookie, label);
    const bare = { cookie: `__Host-blx_session=${a.cookie}` };
    expect((await call(`${API}/v1/hosts/${label}`, { method: "DELETE", headers: bare })).status).toBe(403);
    expect((await call(`${API}/v1/auth/logout`, { method: "POST", headers: bare })).status).toBe(403);
    expect((await call(`${API}/v1/hosts/${label}`, { headers: session(a.cookie) })).status).toBe(200);
  });

  it("lets a session read without the CSRF header", async () => {
    const a = await newAccount();
    const res = await call(`${API}/v1/me`, { headers: { cookie: `__Host-blx_session=${a.cookie}` } });
    expect(res.status).toBe(200);
  });

  it("does not need CSRF headers for a bearer key", async () => {
    const a = await newAccount();
    const { key } = await newKey(a.cookie);
    const res = await call(`${API}/v1/hosts`, jsonInit("POST", bearer(key), { label: uniqueLabel() }));
    expect(res.status).toBe(201);
  });

  it("allows only the portal origin, with credentials, and answers preflight", async () => {
    const pre = await call(`${API}/v1/hosts`, {
      method: "OPTIONS",
      headers: { origin: PORTAL, "access-control-request-method": "POST" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(PORTAL);
    expect(pre.headers.get("access-control-allow-credentials")).toBe("true");
    expect(pre.headers.get("access-control-allow-headers")).toContain("x-blunix-csrf");

    const evil = await call(`${API}/v1/hosts`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(evil.status).toBe(403);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();

    const a = await newAccount();
    const ok = await call(`${API}/v1/me`, { headers: session(a.cookie) });
    expect(ok.headers.get("access-control-allow-origin")).toBe(PORTAL);
    const other = await call(`${API}/v1/me`, { headers: session(a.cookie, { origin: "https://evil.example" }) });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("routing", () => {
  it("answers 401 without credentials, 404 for unknown routes, 405 for wrong methods", async () => {
    expect((await call(`${API}/v1/me`)).status).toBe(401);
    expect((await call(`${API}/v1/hosts`)).status).toBe(401);
    expect((await call(`${API}/v1/nope`)).status).toBe(404);
    expect((await call(`${API}/`)).status).toBe(404);
    const res = await call(`${API}/v1/me`, { method: "PUT" });
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "method not allowed" });
  });

  it("keeps every other host closed", async () => {
    const hosts = [
      "https://blunix.io/",
      "https://build.blunix.io/",
      "https://ada.build.blunix.io/",
      "https://v1.ada.build.blunix.io/",
      "https://localhost/v1/me",
      "https://evil.example/v1/me",
    ];
    for (const host of hosts) {
      const res = await call(host);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("This name is not open.\n");
    }
  });

  it("sends blnx.io and www.blnx.io to the website", async () => {
    for (const url of ["https://blnx.io/", "https://www.blnx.io/", "https://blnx.io/anything?x=1"]) {
      const res = await call(url);
      expect(res.status, url).toBe(301);
      expect(res.headers.get("location")).toBe("https://blunix.io/");
    }
  });

  it("accepts DEV_ORIGINS for CORS and CSRF only when set, and answers the API on localhost", async () => {
    const dev = "http://localhost:8765";
    const a = await newAccount();
    const init = jsonInit("POST", session(a.cookie, { origin: dev }), { label: uniqueLabel() });
    expect((await call(`${API}/v1/hosts`, init)).status).toBe(403);
    const res = await call("http://localhost:8787/v1/hosts", jsonInit("POST", session(a.cookie, { origin: dev }), { label: uniqueLabel() }), {
      DEV_ORIGINS: `${dev}, http://127.0.0.1:8765`,
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("access-control-allow-origin")).toBe(dev);
    const pre = await call(`${API}/v1/hosts`, { method: "OPTIONS", headers: { origin: dev } }, { DEV_ORIGINS: dev });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(dev);
    const other = await call(`${API}/v1/hosts`, { method: "OPTIONS", headers: { origin: "http://localhost:9999" } }, { DEV_ORIGINS: dev });
    expect(other.status).toBe(403);
  });

  it("refuses an expired or unknown session", async () => {
    const a = await newAccount();
    await env.DB.prepare("UPDATE sessions SET expires = 1 WHERE account_id = ?").bind(a.id).run();
    expect((await call(`${API}/v1/me`, { headers: session(a.cookie) })).status).toBe(401);
    expect((await call(`${API}/v1/me`, { headers: session("A".repeat(43)) })).status).toBe(401);
    expect((await call(`${API}/v1/me`, { headers: session("short") })).status).toBe(401);
  });

  it("logs out: the session stops working and the cookie is cleared", async () => {
    const a = await newAccount();
    const res = await call(`${API}/v1/auth/logout`, { method: "POST", headers: session(a.cookie) });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("__Host-blx_session=;");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await call(`${API}/v1/me`, { headers: session(a.cookie) })).status).toBe(401);
  });
});
