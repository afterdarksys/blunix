// The install plane. One Worker answers two kinds of host:
//   api.blunix.io    the /v1 API
//   *.blnx.io        ciphertext, by label and by version
// blnx.io and www.blnx.io send people to the website. Anything else is still not open.
//
// Threats: a request that reaches a route it should not (routes reject by default and
// auth runs before every handler), a cross-origin page that reads or writes with the
// portal's cookie (CORS names one origin, and writes need the CSRF header and Origin),
// and an internal error that leaks detail (it becomes a fixed 500).

import { listConfigurations, showConfiguration, createConfiguration, reviseConfiguration, publishConfiguration, deleteConfiguration, reportConfiguration } from "./configurations";
import { authenticate, csrfFailure, type Principal } from "./auth";
import { API_HOST, BUILD_APEX, BUILD_SUFFIX, devOrigins, trustedOrigin, type Env } from "./env";
import { list, me, removeBuild, removeHost, reserve, show, upload } from "./hosts";
import { error, json } from "./http";
import { createKey, listKeys, revokeKey } from "./keys";
import { callback, login, logout } from "./oidc";
import { serveBuild } from "./serve";

const CLOSED = "This name is not open.\n";

function closed(): Response {
  return new Response(CLOSED, {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function home(): Response {
  return new Response(null, {
    status: 301,
    headers: { location: "https://blunix.io/", "cache-control": "public, max-age=3600" },
  });
}

type Handler = (req: Request, env: Env, p: Principal, params: string[]) => Promise<Response>;

interface Route {
  pattern: RegExp;
  methods: Record<string, Handler | "public">;
}

const SEG = "([^/]+)";

const routes: Route[] = [
  { pattern: /^\/v1\/configurations$/, methods: {
    GET: (req, env, p) => listConfigurations(req, env, p),
    POST: createConfiguration,
  } },
  { pattern: new RegExp(`^/v1/configurations/${SEG}$`), methods: {
    GET: (_req, env, p, [id]) => showConfiguration(env, id, p),
    DELETE: (_req, env, p, [id]) => deleteConfiguration(env, p, id),
  } },
  { pattern: new RegExp(`^/v1/configurations/${SEG}/revisions$`), methods: { POST: (req, env, p, [id]) => reviseConfiguration(req, env, p, id) } },
  { pattern: new RegExp(`^/v1/configurations/${SEG}/publication$`), methods: { POST: (req, env, p, [id]) => publishConfiguration(req, env, p, id) } },
  { pattern: new RegExp(`^/v1/community/${SEG}/reports$`), methods: { POST: (req, env, p, [id]) => reportConfiguration(req, env, p, id) } },
  { pattern: /^\/v1\/auth\/login$/, methods: { GET: "public" } },
  { pattern: /^\/v1\/auth\/callback$/, methods: { GET: "public" } },
  {
    pattern: /^\/v1\/auth\/logout$/,
    methods: {
      POST: async (_req, env, p) => (p.kind === "session" ? logout(env, p.tokenHash) : error(403, "forbidden")),
    },
  },
  { pattern: /^\/v1\/me$/, methods: { GET: (_req, env, p) => me(env, p) } },
  {
    pattern: /^\/v1\/hosts$/,
    methods: { GET: (_req, env, p) => list(env, p), POST: (req, env, p) => reserve(req, env, p) },
  },
  {
    pattern: new RegExp(`^/v1/hosts/${SEG}$`),
    methods: {
      GET: (_req, env, p, [label]) => show(env, p, label),
      DELETE: (_req, env, p, [label]) => removeHost(env, p, label),
    },
  },
  {
    pattern: new RegExp(`^/v1/hosts/${SEG}/builds$`),
    methods: { POST: (req, env, p, [label]) => upload(req, env, p, label) },
  },
  {
    pattern: new RegExp(`^/v1/hosts/${SEG}/builds/${SEG}$`),
    methods: { DELETE: (_req, env, p, [label, n]) => removeBuild(env, p, label, n) },
  },
  {
    pattern: /^\/v1\/keys$/,
    methods: { GET: (_req, env, p) => listKeys(env, p), POST: (req, env, p) => createKey(req, env, p) },
  },
  {
    pattern: new RegExp(`^/v1/keys/${SEG}$`),
    methods: { DELETE: (_req, env, p, [fp]) => revokeKey(env, p, fp) },
  },
];

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("origin");
  if (origin === null || !trustedOrigin(env, origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    vary: "Origin",
  };
}

// The website asks whether the API is up. Public, no auth, no cookie, no body beyond {ok}.
// CORS names https://blunix.io only, without credentials.
const SITE_ORIGIN = "https://blunix.io";

function health(req: Request): Response {
  if (req.method !== "GET" && req.method !== "HEAD") return error(405, "method not allowed", { allow: "GET, HEAD" });
  const headers: Record<string, string> = { vary: "Origin" };
  if (req.headers.get("origin") === SITE_ORIGIN) headers["access-control-allow-origin"] = SITE_ORIGIN;
  const res = json(200, { ok: true }, headers);
  return req.method === "HEAD" ? new Response(null, res) : res;
}

async function api(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/v1/health") return health(req);
  const cors = corsHeaders(req, env);

  if (req.method === "OPTIONS") {
    if (!("access-control-allow-origin" in cors)) return error(403, "forbidden");
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "access-control-allow-methods": "GET, POST, DELETE",
        "access-control-allow-headers": "content-type, x-blunix-csrf, authorization",
        "access-control-max-age": "600",
        "cache-control": "no-store",
      },
    });
  }

  let res: Response;
  const publicConfig = /^\/v1\/community(?:\/([a-f0-9-]{36}))?$/.exec(url.pathname);
  if (publicConfig && req.method === "GET") {
    res = publicConfig[1] ? await showConfiguration(env, publicConfig[1]) : await listConfigurations(req, env);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  }
  const route = routes.find((r) => r.pattern.test(url.pathname));
  if (!route) {
    res = error(404, "not found");
  } else {
    const handler = route.methods[req.method];
    if (!handler) {
      res = error(405, "method not allowed", { allow: Object.keys(route.methods).join(", ") });
    } else if (handler === "public") {
      res = url.pathname === "/v1/auth/login" ? await login(req, env) : await callback(req, env);
    } else {
      const p = await authenticate(req, env);
      if (p instanceof Response) {
        res = p;
      } else {
        const params = (route.pattern.exec(url.pathname) ?? []).slice(1).map((s) => {
          try {
            return decodeURIComponent(s);
          } catch {
            return "";
          }
        });
        res = csrfFailure(req, env, p) ?? (await handler(req, env, p, params));
      }
    }
  }
  if (Object.keys(cors).length === 0) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const host = new URL(req.url).hostname;
    // wrangler dev answers on localhost. Only when DEV_ORIGINS is set, never in production.
    const isApi = host === API_HOST || (devOrigins(env).length > 0 && (host === "localhost" || host === "127.0.0.1"));
    try {
      if (isApi) return await api(req, env);
      if (host === BUILD_APEX || host === "www." + BUILD_APEX) return home();
      if (host.endsWith(BUILD_SUFFIX)) return await serveBuild(req, env, host.slice(0, -BUILD_SUFFIX.length));
      return closed();
    } catch (e) {
      console.error("blunix-api: unhandled", e instanceof Error ? e.message : "error");
      if (isApi) return error(500, "internal error");
      return new Response(null, { status: 500, headers: { "cache-control": "no-store" } });
    }
  },
} satisfies ExportedHandler<Env>;
