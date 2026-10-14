import { describe, expect, it } from "vitest";
import { call, env, uniqueLabel } from "./helpers";
import { BOOT_SCRIPT_LIMIT } from "../src/serve";

const MEDIA = "https://media.example.test/blunix/v0.1.1/";
const ON = { NETBOOT_MEDIA: MEDIA };

function boot(label: string, overrides = {}, init: RequestInit = {}, path = "/boot.ipxe") {
  return call(`https://${label}.blnx.io${path}`, init, overrides);
}

describe("hosted boot scripts", () => {
  it("is off until NETBOOT_MEDIA is set", async () => {
    expect((await boot("ada")).status).toBe(404);
  });

  it("boots the published media and offers the label's address", async () => {
    const res = await boot("ada", ON);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text.startsWith("#!ipxe\n")).toBe(true);
    expect(text).toContain(`kernel ${MEDIA}vmlinuz initrd=initrd.img boot=live noeject fetch=${MEDIA}blunix.squashfs blunix.build=ada.blnx.io `);
    expect(text).toContain(`initrd ${MEDIA}initrd.img`);
    expect(text).not.toMatch(/key|passphrase/i);
  });

  it("answers the same for a label nobody reserved, so it lists nothing", async () => {
    const unknown = uniqueLabel("nobody");
    const a = await (await boot(unknown, ON)).text();
    expect(a).toContain(`blunix.build=${unknown}.blnx.io`);
    expect(a.replaceAll(unknown, "X")).toBe((await (await boot("ada", ON)).text()).replaceAll("ada", "X"));
  });

  it("refuses bad labels, pinned hosts, other paths and methods", async () => {
    for (const label of ["api", "v3", "a", "x--y", "x_y"]) {
      expect((await boot(label, ON)).status, label).toBe(404);
    }
    expect((await call("https://v2.ada.blnx.io/boot.ipxe", {}, ON)).status).toBe(404);
    expect((await boot("ada", ON, {}, "/boot.ipxe?x=1")).status).toBe(404);
    expect((await boot("ada", ON, {}, "/boot.ipxe/")).status).toBe(404);
    expect((await boot("ada", ON, { method: "POST" })).status).toBe(405);
    const head = await boot("ada", ON, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("stays off when NETBOOT_MEDIA is not a plain https base", async () => {
    for (const bad of ["http://media.example.test/", "https://media.example.test/x", "https://u:p@media.example.test/",
                       "https://media.example.test/?a=1", "not a url", "https://media.example.test/a b/"]) {
      expect((await boot("ada", { NETBOOT_MEDIA: bad })).status, bad).toBe(404);
    }
  });

  it("rate limits per address", async () => {
    const ip = "198.51.100." + Math.floor(Math.random() * 200 + 1);
    const t = Math.floor(Date.now() / 1000 / 3600);
    await env.DB.prepare("INSERT INTO rate_limits (key, win, count) VALUES (?, ?, ?)")
      .bind(`bootscript:${ip}`, t, BOOT_SCRIPT_LIMIT)
      .run();
    expect((await boot("ada", ON, { headers: { "cf-connecting-ip": ip } })).status).toBe(429);
  });

  it("leaves the ciphertext route alone", async () => {
    expect((await call("https://ada.blnx.io/", {}, ON)).status).toBe(404);
  });
});
