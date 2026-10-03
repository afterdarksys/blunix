// build.blunix.io -> the build-blunix-io Pages project. Pages stays the one place
// the portal is deployed (scripts/deploy-site.sh, .github/workflows/site.yml); this
// Worker only gives it the build.blunix.io name until a Pages custom domain is set.
// Remove with: npx wrangler delete (in this directory).
const ORIGIN = "build-blunix-io.pages.dev";

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const host = url.host;
    url.hostname = ORIGIN;
    url.port = "";
    const res = await fetch(new Request(url.toString(), req), { redirect: "manual" });
    const loc = res.headers.get("location");
    if (!loc) return res;
    const out = new Response(res.body, res);
    const target = new URL(loc, url);
    if (target.hostname === ORIGIN) {
      target.hostname = host;
      out.headers.set("location", target.toString());
    }
    return out;
  },
};
