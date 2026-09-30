#!/usr/bin/env python3
"""Serve portal/ for local work against `wrangler dev`.

    python3 scripts/serve-portal-dev.py        # then open http://localhost:8765/

The deployed portal names only https://api.blunix.io. This server rewrites two things
in index.html as it serves it: the CSP connect-src and <meta name="blunix-api">, both
to the dev Worker at http://localhost:8787. Nothing is written to disk, and nothing in
portal/ names a dev host.

The dev Worker (cd platform/api && npx wrangler dev) must set DEV_ORIGINS to
http://localhost:8765, so CORS allows credentials and the CSRF check passes. The
__Host- session cookie needs Secure, which Chrome and Firefox allow on localhost.

Binds 127.0.0.1 only.
"""

import functools
import http.server
from pathlib import Path

PORT = 8765
API = "http://localhost:8787"
PORTAL = Path(__file__).resolve().parent.parent / "portal"
PROD_CSP = "connect-src https://api.blunix.io;"
PROD_META = '<meta name="blunix-api" content="https://api.blunix.io/v1">'


def dev_index() -> bytes:
    page = (PORTAL / "index.html").read_text(encoding="utf-8")
    if PROD_CSP not in page or PROD_META not in page:
        raise SystemExit("serve-portal-dev: index.html no longer has the production CSP or API meta.")
    page = page.replace(PROD_CSP, f"connect-src https://api.blunix.io {API};")
    page = page.replace(PROD_META, f'<meta name="blunix-api" content="{API}/v1">')
    return page.encode("utf-8")


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?", 1)[0] in ("/", "/index.html"):
            body = dev_index()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


if __name__ == "__main__":
    dev_index()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Handler, directory=str(PORTAL)))
    print(f"serve-portal-dev: http://localhost:{PORT}/ against {API}")
    server.serve_forever()
