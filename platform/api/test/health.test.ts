import { describe, expect, it } from "vitest";
import { API, call, PORTAL } from "./helpers";

describe("health", () => {
  it("answers {ok:true} with no auth and allows https://blunix.io to read it", async () => {
    const res = await call(`${API}/v1/health`, { headers: { origin: "https://blunix.io" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://blunix.io");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("does not grant other origins, including the portal", async () => {
    for (const origin of ["https://evil.example", PORTAL, "http://blunix.io"]) {
      const res = await call(`${API}/v1/health`, { headers: { origin } });
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin"), origin).toBeNull();
    }
  });

  it("refuses writes with 405", async () => {
    const res = await call(`${API}/v1/health`, { method: "POST", headers: { origin: "https://blunix.io" } });
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "method not allowed" });
  });

  it("is not served on a build host", async () => {
    const res = await call("https://health.blnx.io/v1/health");
    expect(res.status).toBe(404);
  });
});
