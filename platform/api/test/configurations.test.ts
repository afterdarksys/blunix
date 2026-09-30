import { describe, expect, it } from "vitest";
import { API, bearer, call, env, jsonInit, newAccount, newKey, session } from "./helpers";
const recipe = { packages: ["git", "curl"], access: "regular" };
async function create(cookie: string, body: unknown = { title: "Web tools", recipe }) {
  return call(`${API}/v1/configurations`, jsonInit("POST", session(cookie), body));
}
async function publish(cookie: string, id: string, visibility = "public") {
  return call(`${API}/v1/configurations/${id}/publication`, jsonInit("POST", session(cookie), { visibility }));
}

describe("configuration library", () => {
  it("keeps personal recipes private, permits explicit sharing and exact-revision forks", async () => {
    const a = await newAccount(), b = await newAccount();
    const created = await create(a.cookie); expect(created.status).toBe(201);
    const c = await created.json<{ id: string; revision: number }>();
    expect((await call(`${API}/v1/community/${c.id}`)).status).toBe(404);
    expect((await call(`${API}/v1/configurations/${c.id}`, { headers: session(b.cookie) })).status).toBe(404);
    expect((await create(b.cookie, { title: "Copy", source: { id: c.id, revision: 1 } })).status).toBe(404);
    expect((await publish(a.cookie, c.id)).status).toBe(200);
    const detail = await (await call(`${API}/v1/community/${c.id}`)).json<Record<string, any>>();
    expect(detail).not.toHaveProperty("account_id");
    expect(detail.revisions[0].recipe).toEqual({ access: "regular", packages: ["curl", "git"] });
    const revision = await call(`${API}/v1/configurations/${c.id}/revisions`, jsonInit("POST", session(a.cookie), { revision: 1, recipe: { packages: ["nginx"], access: "large-print" }, message: "Web server" }));
    expect(revision.status).toBe(201);
    const forkResponse = await create(b.cookie, { title: "Copy", source: { id: c.id, revision: 1 } });
    expect(forkResponse.status).toBe(201);
    const fork = await forkResponse.json<{ id: string }>();
    const copied = await (await call(`${API}/v1/configurations/${fork.id}`, { headers: session(b.cookie) })).json<Record<string, any>>();
    expect(copied.visibility).toBe("private");
    expect(copied.source).toEqual({ id: c.id, revision: 1 });
    expect(copied.revisions[0].recipe.packages).toEqual(["curl", "git"]);
    await publish(a.cookie, c.id, "private");
    expect((await call(`${API}/v1/community/${c.id}`)).status).toBe(404);
    expect((await call(`${API}/v1/configurations/${fork.id}`, { headers: session(b.cookie) })).status).toBe(200);
  });

  it("rejects personal fields, scripts, arbitrary packages, malformed recipes and injected metadata", async () => {
    const a = await newAccount();
    for (const field of ["hostname", "network", "admin", "password", "target", "install", "script"]) {
      expect((await create(a.cookie, { title: "No", recipe: { ...recipe, [field]: "private" } })).status).toBe(400);
    }
    for (const r of [null, [], { ...recipe, packages: ["curl; rm -rf /"] }, { ...recipe, packages: ["curl", "curl"] }, { ...recipe, access: "unknown" }]) {
      expect((await create(a.cookie, { title: "No", recipe: r })).status).toBe(400);
    }
    expect((await create(a.cookie, { title: "No", recipe, password: "private" })).status).toBe(400);
  });

  it("enforces owner writes, session-only community permissions and CSRF", async () => {
    const a = await newAccount(), b = await newAccount();
    const c = await (await create(a.cookie)).json<{ id: string }>();
    await publish(a.cookie, c.id);
    expect((await publish(b.cookie, c.id, "private")).status).toBe(404);
    expect((await call(`${API}/v1/configurations/${c.id}`, { method: "DELETE", headers: session(b.cookie) })).status).toBe(404);
    expect((await call(`${API}/v1/configurations/${c.id}/revisions`, jsonInit("POST", session(b.cookie), { revision: 1, recipe, message: "" }))).status).toBe(404);
    const key = await newKey(a.cookie);
    expect((await call(`${API}/v1/configurations`, jsonInit("POST", bearer(key.key), { title: "Key", recipe }))).status).toBe(403);
    expect((await call(`${API}/v1/configurations`, jsonInit("POST", { cookie: `__Host-blx_session=${a.cookie}` }, { title: "No csrf", recipe }))).status).toBe(403);
    expect((await call(`${API}/v1/configurations`)).status).toBe(401);
  });

  it("keeps revisions immutable and rejects concurrent stale edits", async () => {
    const a = await newAccount();
    const c = await (await create(a.cookie)).json<{ id: string }>();
    const responses = await Promise.all(["first", "second"].map(message => call(`${API}/v1/configurations/${c.id}/revisions`, jsonInit("POST", session(a.cookie), { revision: 1, recipe, message }))));
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    const detail = await (await call(`${API}/v1/configurations/${c.id}`, { headers: session(a.cookie) })).json<Record<string, any>>();
    expect(detail.revision).toBe(2);
    expect(detail.revisions.map((r: any) => r.revision)).toEqual([2, 1]);
    expect(detail.revisions[1].message).toBe("");
  });

  it("records reports and removes deleted configurations from public access", async () => {
    const a = await newAccount(), b = await newAccount();
    const c = await (await create(a.cookie)).json<{ id: string }>();
    await publish(a.cookie, c.id);
    expect((await call(`${API}/v1/community/${c.id}/reports`, jsonInit("POST", session(b.cookie), { reason: "abuse" }))).status).toBe(204);
    expect((await call(`${API}/v1/configurations/${c.id}`, { method: "DELETE", headers: session(a.cookie) })).status).toBe(204);
    expect((await call(`${API}/v1/community/${c.id}`)).status).toBe(404);
    expect((await create(b.cookie, { title: "Gone", source: { id: c.id, revision: 1 } })).status).toBe(404);
    expect((await call(`${API}/v1/community?offset=-1`)).status).toBe(400);
    const list = await (await call(`${API}/v1/configurations`, { headers: session(a.cookie) })).json<{ configurations: unknown[] }>();
    expect(list.configurations).toEqual([]);
  });
  it("enforces the quota atomically under concurrent creates", async () => {
    const a = await newAccount();
    await env.DB.batch(Array.from({length: 99}, () => env.DB.prepare("INSERT INTO configurations (id, account_id, title, created, updated) VALUES (?, ?, 'Fixture', 1, 1)").bind(crypto.randomUUID(), a.id)));
    const results = await Promise.all([create(a.cookie), create(a.cookie)]);
    expect(results.map(r => r.status).sort()).toEqual([201, 403]);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM configurations WHERE account_id = ?").bind(a.id).first<{n:number}>();
    expect(count?.n).toBe(100);
  });

  it("does not bump the feed on duplicate publication and rate limits toggles", async () => {
    const a = await newAccount();
    const c = await (await create(a.cookie)).json<{id:string}>();
    await publish(a.cookie, c.id);
    await env.DB.prepare("UPDATE configurations SET updated = 1 WHERE id = ?").bind(c.id).run();
    await publish(a.cookie, c.id);
    const row = await env.DB.prepare("SELECT updated FROM configurations WHERE id = ?").bind(c.id).first<{updated:number}>();
    expect(row?.updated).toBe(1);
    for (let i=0; i<28; i++) expect((await publish(a.cookie,c.id,i%2 ? "public" : "private")).status).toBe(200);
    expect((await publish(a.cookie,c.id)).status).toBe(429);
  });

});
