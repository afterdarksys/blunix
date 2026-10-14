/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { checkProfile, Refused } from "../src/profile";
import { API, bearer, call, env, jsonInit, newAccount, newKey, session } from "./helpers";
import cases from "../../../tests/fixtures/profiles/cases.json";

// Raw fixture text, so a duplicate key reaches the server as written.
const RAW = import.meta.glob("../../../tests/fixtures/profiles/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function raw(file: string): string {
  const key = Object.keys(RAW).find((k) => k.endsWith("/" + file));
  if (!key) throw new Error("missing fixture " + file);
  return RAW[key];
}

const PROFILE = JSON.parse(raw("lab-speech.json"));
const OPEN = { COMMUNITY: "on" };

function create(cookie: string, body: unknown, overrides = {}) {
  return call(`${API}/v1/configurations`, jsonInit("POST", session(cookie), body), overrides);
}

function createRaw(cookie: string, text: string) {
  return call(`${API}/v1/configurations`, {
    method: "POST",
    headers: { ...session(cookie), "content-type": "application/json" },
    body: text,
  });
}

async function newTemplate(cookie: string, title = "lab", profile = PROFILE, overrides = {}) {
  const res = await create(cookie, { title, profile }, overrides);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; revision: number };
}

describe("profile validator", () => {
  it("gives the CLI's answer for every shared JSON case", async () => {
    const a = await newAccount();
    const json = (cases as { cases: { file: string; ok: boolean; kind?: string; error?: string }[] }).cases.filter((c) =>
      c.file.endsWith(".json"),
    );
    expect(json.length).toBeGreaterThanOrEqual(3);
    for (const c of json) {
      const res = await createRaw(a.cookie, `{"title":"case","profile":${raw(c.file)}}`);
      const out = (await res.json()) as { error?: string };
      const isNode = (JSON.parse(raw(c.file)) as { kind?: string }).kind === "Node";
      if (c.ok && c.kind === "Profile") {
        expect(res.status, c.file).toBe(201);
      } else if (isNode) {
        // A Node is personal and never enters the library, valid or not. The refusal
        // can come before the field the CLI would name (often "unknown field").
        expect(res.status, c.file).toBe(400);
        expect(out.error, c.file).toMatch(/^invalid profile: /);
      } else {
        expect(res.status, c.file).toBe(400);
        expect(out.error, c.file).toBe("invalid profile: " + c.error);
      }
    }
  });

  it("refuses what a shared template must never carry", () => {
    const refusals: [Record<string, unknown>, string][] = [
      [{ ...PROFILE, hostname: "ada-1" }, "unknown field"],
      [{ ...PROFILE, admin: { name: "operator", sshPublicKey: "x" } }, "unknown field"],
      [{ ...PROFILE, install: { erase: true, reboot: false } }, "unknown field"],
      [{ ...PROFILE, target: "S1" }, "unknown field"],
      [{ ...PROFILE, network: { match: ["en*"], address: "192.0.2.2/24", gateway: "192.0.2.1", dns: ["192.0.2.53"] } }, "refused network"],
      [{ ...PROFILE, notes: { wifi_psk: "x" } }, "refused field"],
      [{ ...PROFILE, distribution: "rocky" }, "refused distribution"],
      [{ ...PROFILE, packages: ["git", "--allow-unauthenticated"] }, "refused packages"],
      [{ ...PROFILE, packages: ["git", "git"] }, "refused packages"],
      [{ ...PROFILE, update: { url: "https://user@mirror.example/blunix", channel: "stable" } }, "refused update"],
      [{ ...PROFILE, update: { url: "http://updates.blunix.io/blunix", channel: "stable" } }, "refused update"],
      [{ ...PROFILE, ai: "other" }, "model not found"],
      [{ ...PROFILE, sysexts: ["x"] }, "refused sysexts"],
    ];
    for (const [doc, message] of refusals) {
      expect(() => checkProfile(doc), message).toThrow(Refused);
      try {
        checkProfile(doc);
      } catch (e) {
        expect((e as Error).message).toBe(message);
      }
    }
  });

  it("keeps an inline DHCP network and sorts packages", () => {
    const out = checkProfile({ ...PROFILE, network: { match: ["ens3"], dhcp: true }, packages: ["vim", "git"] });
    expect(out.packages).toEqual(["git", "vim"]);
    expect(out.network).toEqual({ match: ["ens3"], dhcp: true });
  });
});

describe("configuration library", () => {
  it("creates, lists, shows, revises and deletes the owner's templates", async () => {
    const a = await newAccount();
    const t = await newTemplate(a.cookie, "classroom");
    expect(t.revision).toBe(1);

    const list = (await (await call(`${API}/v1/configurations`, { headers: session(a.cookie) })).json()) as {
      configurations: { id: string; title: string; visibility: string }[];
      nextOffset: number | null;
    };
    expect(list.configurations.map((c) => c.id)).toEqual([t.id]);
    expect(list.configurations[0].visibility).toBe("private");
    expect(list.nextOffset).toBeNull();

    const next = { ...PROFILE, access: "full-speech", packages: ["git"] };
    const rev = await call(`${API}/v1/configurations/${t.id}/revisions`, jsonInit("POST", session(a.cookie), { revision: 1, profile: next, message: "speech" }));
    expect(rev.status).toBe(201);
    expect(await rev.json()).toEqual({ id: t.id, revision: 2 });

    const shown = (await (await call(`${API}/v1/configurations/${t.id}`, { headers: session(a.cookie) })).json()) as {
      revision: number;
      revisions: { revision: number; profile: Record<string, unknown>; message: string }[];
    };
    expect(shown.revision).toBe(2);
    expect(shown.revisions.map((r) => r.revision)).toEqual([2, 1]);
    expect(shown.revisions[0].profile.access).toBe("full-speech");
    expect(shown.revisions[1].profile.access).toBe(PROFILE.access);

    expect((await call(`${API}/v1/configurations/${t.id}`, { method: "DELETE", headers: session(a.cookie) })).status).toBe(204);
    expect((await call(`${API}/v1/configurations/${t.id}`, { headers: session(a.cookie) })).status).toBe(404);
    expect((await call(`${API}/v1/configurations/${t.id}`, { method: "DELETE", headers: session(a.cookie) })).status).toBe(404);
  });

  it("refuses a stale edit with 409 and keeps the newer revision", async () => {
    const a = await newAccount();
    const t = await newTemplate(a.cookie);
    const first = await call(`${API}/v1/configurations/${t.id}/revisions`, jsonInit("POST", session(a.cookie), { revision: 1, profile: PROFILE }));
    expect(first.status).toBe(201);
    const stale = await call(`${API}/v1/configurations/${t.id}/revisions`, jsonInit("POST", session(a.cookie), { revision: 1, profile: { ...PROFILE, access: "advanced" } }));
    expect(stale.status).toBe(409);
    const row = await env.DB.prepare("SELECT head FROM configurations WHERE id = ?").bind(t.id).first<{ head: number }>();
    expect(row!.head).toBe(2);
  });

  it("forks a revision with its provenance", async () => {
    const a = await newAccount();
    const t = await newTemplate(a.cookie);
    const res = await create(a.cookie, { title: "copy", source: { id: t.id, revision: 1 } });
    expect(res.status).toBe(201);
    const fork = (await res.json()) as { id: string };
    const shown = (await (await call(`${API}/v1/configurations/${fork.id}`, { headers: session(a.cookie) })).json()) as {
      source: { id: string; revision: number };
      revisions: { profile: unknown }[];
    };
    expect(shown.source).toEqual({ id: t.id, revision: 1 });
    expect(shown.revisions[0].profile).toEqual(PROFILE);
    expect((await create(a.cookie, { title: "x", source: { id: t.id, revision: 9 } })).status).toBe(404);
    expect((await create(a.cookie, { title: "x", source: { id: t.id, revision: 1 }, profile: PROFILE })).status).toBe(400);
  });

  it("keeps each account's templates to itself", async () => {
    const a = await newAccount();
    const b = await newAccount();
    const t = await newTemplate(a.cookie);
    expect((await call(`${API}/v1/configurations/${t.id}`, { headers: session(b.cookie) })).status).toBe(404);
    expect((await call(`${API}/v1/configurations/${t.id}/revisions`, jsonInit("POST", session(b.cookie), { revision: 1, profile: PROFILE }))).status).toBe(404);
    expect((await call(`${API}/v1/configurations/${t.id}`, { method: "DELETE", headers: session(b.cookie) })).status).toBe(404);
    expect((await create(b.cookie, { title: "steal", source: { id: t.id, revision: 1 } })).status).toBe(404);
    const list = (await (await call(`${API}/v1/configurations`, { headers: session(b.cookie) })).json()) as { configurations: unknown[] };
    expect(list.configurations).toEqual([]);
  });

  it("is session only and needs the CSRF header for writes", async () => {
    const a = await newAccount();
    const { key } = await newKey(a.cookie);
    const t = await newTemplate(a.cookie);
    expect((await call(`${API}/v1/configurations`, { headers: bearer(key) })).status).toBe(403);
    expect((await call(`${API}/v1/configurations`, jsonInit("POST", bearer(key), { title: "x", profile: PROFILE }))).status).toBe(403);
    expect((await call(`${API}/v1/configurations/${t.id}`, { headers: bearer(key) })).status).toBe(403);
    const noCsrf = { cookie: `__Host-blx_session=${a.cookie}`, origin: "https://build.blunix.io" };
    expect((await call(`${API}/v1/configurations`, jsonInit("POST", noCsrf, { title: "x", profile: PROFILE }))).status).toBe(403);
    expect((await call(`${API}/v1/configurations`)).status).toBe(401);
  });

  it("checks bodies", async () => {
    const a = await newAccount();
    expect((await create(a.cookie, { title: "x", profile: PROFILE, extra: 1 })).status).toBe(400);
    expect((await create(a.cookie, { title: "bad\u0007title", profile: PROFILE })).status).toBe(400);
    expect((await create(a.cookie, { title: " ", profile: PROFILE })).status).toBe(400);
    expect((await create(a.cookie, { title: "x".repeat(101), profile: PROFILE })).status).toBe(400);
    const dup = await createRaw(a.cookie, `{"title":"a","title":"b","profile":${raw("lab-speech.json")}}`);
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as { error: string }).error).toBe("invalid profile: duplicate key");
    const text = await call(`${API}/v1/configurations`, { method: "POST", headers: { ...session(a.cookie), "content-type": "text/plain" }, body: "{}" });
    expect(text.status).toBe(415);
    const big = await createRaw(a.cookie, JSON.stringify({ title: "x", profile: PROFILE, pad: "x".repeat(9000) }));
    expect(big.status).toBe(413);
  });

  it("enforces the template and revision limits", async () => {
    const a = await newAccount();
    const t = Math.floor(Date.now() / 1000);
    const stmts = [];
    for (let i = 0; i < 100; i++) {
      stmts.push(
        env.DB.prepare("INSERT INTO configurations (id, account_id, title, created, updated) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), a.id, "t" + i, t, t),
      );
    }
    await env.DB.batch(stmts);
    const full = await create(a.cookie, { title: "one more", profile: PROFILE });
    expect(full.status).toBe(403);

    const b = await newAccount();
    const tpl = await newTemplate(b.cookie);
    await env.DB.prepare("UPDATE configurations SET head = 100 WHERE id = ?").bind(tpl.id).run();
    const rev = await call(`${API}/v1/configurations/${tpl.id}/revisions`, jsonInit("POST", session(b.cookie), { revision: 100, profile: PROFILE }));
    expect(rev.status).toBe(403);
  });

  it("rate limits writes", async () => {
    const a = await newAccount();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await create(a.cookie, { title: "r" + i, profile: PROFILE })).status;
    expect(last).toBe(429);
  });
});

describe("community library", () => {
  it("is closed by default", async () => {
    const a = await newAccount();
    const t = await newTemplate(a.cookie);
    const pub = await call(`${API}/v1/configurations/${t.id}/publication`, jsonInit("POST", session(a.cookie), { visibility: "public" }));
    expect(pub.status).toBe(403);
    expect((await call(`${API}/v1/community`)).status).toBe(404);
    expect((await call(`${API}/v1/community/${t.id}`)).status).toBe(404);
    const b = await newAccount();
    expect((await call(`${API}/v1/community/${t.id}/reports`, jsonInit("POST", session(b.cookie), { reason: "spam" }))).status).toBe(404);
    // A template marked public in the database still stays private while closed.
    await env.DB.prepare("UPDATE configurations SET visibility = 'public' WHERE id = ?").bind(t.id).run();
    expect((await create(b.cookie, { title: "fork", source: { id: t.id, revision: 1 } })).status).toBe(404);
  });

  it("publishes, lists without account ids, forks and reports when open", async () => {
    const a = await newAccount();
    const b = await newAccount();
    const t = await newTemplate(a.cookie, "shared lab", PROFILE, OPEN);
    const pub = await call(`${API}/v1/configurations/${t.id}/publication`, jsonInit("POST", session(a.cookie), { visibility: "public" }), OPEN);
    expect(pub.status).toBe(200);
    const before = await env.DB.prepare("SELECT updated FROM configurations WHERE id = ?").bind(t.id).first<{ updated: number }>();
    await env.DB.prepare("UPDATE configurations SET updated = updated - 100 WHERE id = ?").bind(t.id).run();
    await call(`${API}/v1/configurations/${t.id}/publication`, jsonInit("POST", session(a.cookie), { visibility: "public" }), OPEN);
    const after = await env.DB.prepare("SELECT updated FROM configurations WHERE id = ?").bind(t.id).first<{ updated: number }>();
    expect(after!.updated).toBe(before!.updated - 100);

    const listRes = await call(`${API}/v1/community`, {}, OPEN);
    expect(listRes.status).toBe(200);
    const listText = await listRes.text();
    expect(listText).toContain(t.id);
    expect(listText).not.toContain("account");
    const shown = await call(`${API}/v1/community/${t.id}`, {}, OPEN);
    expect(shown.status).toBe(200);
    expect(await shown.text()).not.toContain("account");

    const fork = await create(b.cookie, { title: "my copy", source: { id: t.id, revision: 1 } }, OPEN);
    expect(fork.status).toBe(201);
    const report = await call(`${API}/v1/community/${t.id}/reports`, jsonInit("POST", session(b.cookie), { reason: "spam" }), OPEN);
    expect(report.status).toBe(204);
    const stored = await env.DB.prepare("SELECT reason FROM community_reports WHERE configuration_id = ? AND account_id = ?").bind(t.id, b.id).first<{ reason: string }>();
    expect(stored!.reason).toBe("spam");
    expect((await call(`${API}/v1/community/${t.id}/reports`, jsonInit("POST", session(b.cookie), { reason: "rude" }), OPEN)).status).toBe(400);

    // The owner can still revise; others cannot, even when it is public.
    expect((await call(`${API}/v1/configurations/${t.id}/revisions`, jsonInit("POST", session(b.cookie), { revision: 1, profile: PROFILE }), OPEN)).status).toBe(404);
    // Unpublishing hides it from the community again.
    await call(`${API}/v1/configurations/${t.id}/publication`, jsonInit("POST", session(a.cookie), { visibility: "private" }), OPEN);
    expect((await call(`${API}/v1/community/${t.id}`, {}, OPEN)).status).toBe(404);
  });
});
