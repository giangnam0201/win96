"""Serve Windows 96 locally, with automatic online/offline operation."""
import argparse
import io
import mimetypes
import json
from http.cookies import SimpleCookie
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser
from urllib.parse import urlsplit, urlunsplit, parse_qs

ROOT = Path(__file__).resolve().parent
# Replace resource endpoints in scripts/CSS, including dependencies loaded by workers.
REPLACEMENTS = {
    "https://packages.windows96.net/r3-main": "/r3-main",
    "https://etc.windows96.net/notron/virdefs.json": "/notron/virdefs.json",
    "http://cdn.windows96.net/credits/default.png": "/system/resource/offline/credits.png",
    "https://cdn.windows96.net/credits/default.png": "/system/resource/offline/credits.png",
    "https://cdn.jsdelivr.net/jquery.ui.rotatable/1.0.1/rotate.png": "/system/libraries/extern/jquery/rotate.png",
    "https://js-dos.com/6.22/current/": "/system/libraries/extern/js-dos/",
    "https://cdnjs.cloudflare.com/ajax/libs/three.js/103/three.min.js": "/system/libraries/extern/three/three-r103.min.js",
    "//mrdoob.github.io/stats.js/build/stats.min.js": "/system/libraries/extern/three/stats.min.js",
}
POLICY = "; ".join([
    "default-src 'self' data: blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline' data:",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data: blob:",
    "connect-src 'self' data: blob:",
    "frame-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "form-action 'self'",
    "base-uri 'self'",
])
ONLINE_POLICY = POLICY.replace("'self' data: blob:", "'self' data: blob: http: https:").replace(
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: http: https:"
).replace("style-src 'self' 'unsafe-inline' data:", "style-src 'self' 'unsafe-inline' data: http: https:").replace(
    "connect-src 'self' data: blob: http: https:", "connect-src 'self' data: blob: http: https: ws: wss:"
).replace("form-action 'self'", "form-action 'self' http: https:")


class LocalServer(ThreadingHTTPServer):
    # Windows otherwise permits a second process to bind over the running launcher.
    allow_reuse_address = False


class OfflineHandler(SimpleHTTPRequestHandler):
    def network_config(self):
        cookies = SimpleCookie(self.headers.get("Cookie", ""))
        preference = cookies["w96-preference"].value if "w96-preference" in cookies else "auto"
        online = "w96-network" in cookies and cookies["w96-network"].value == "online"
        requested = parse_qs(urlsplit(self.path).query).get("network", [None])[0]
        if requested in {"auto", "online", "offline"}:
            preference = requested
        if preference != "auto":
            online = preference == "online"
        return {"online": online, "preference": preference,
                "offlinePolicy": POLICY, "onlinePolicy": ONLINE_POLICY}

    def guess_type(self, path):
        # js-dos 6 names its binary WebAssembly payload "wdosbox.wasm.js".
        if path.endswith(".wasm.js"):
            return "application/wasm"
        return super().guess_type(path)

    def end_headers(self):
        config = self.network_config()
        policy = ONLINE_POLICY if config["online"] else POLICY
        if config["preference"] == "auto" and not config["online"]:
            # The only permitted external request in automatic offline startup.
            policy = policy.replace("connect-src 'self' data: blob:",
                                    "connect-src 'self' data: blob: https://windows96.net")
        self.send_header("Content-Security-Policy", policy)
        requested = parse_qs(urlsplit(self.path).query).get("network", [None])[0]
        if requested in {"auto", "online", "offline"}:
            self.send_header("Set-Cookie", f"w96-preference={requested}; Path=/; SameSite=Strict; HttpOnly")
            if requested != "auto":
                self.send_header("Set-Cookie", f"w96-network={requested}; Path=/; SameSite=Strict; HttpOnly")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def send_head(self):
        if urlsplit(self.path).path == "/network-mode":
            mode = parse_qs(urlsplit(self.path).query).get("mode", [""])[0]
            if mode not in {"online", "offline"}:
                self.send_error(400)
                return None
            self.send_response(204)
            self.send_header("Set-Cookie", f"w96-network={mode}; Path=/; SameSite=Strict; HttpOnly")
            self.end_headers()
            return None
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            url = urlsplit(self.path)
            if not url.path.endswith("/"):
                self.send_response(301)
                self.send_header("Location", urlunsplit(("", "", url.path + "/", url.query, url.fragment)))
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
            path /= "index.html"
        # Never expose .git, credentials or the development server source.
        if not path.resolve().is_relative_to(ROOT) or any(
            part.startswith(".") and part != ".meta" for part in path.relative_to(ROOT).parts
        ) or path.suffix in {".py", ".bat"}:
            self.send_error(403)
            return None
        if not path.is_file():
            self.send_error(404, "This resource is not in the offline bundle")
            return None
        if path.suffix in {".html", ".js", ".css", ".json"} and not path.name.endswith(".wasm.js"):
            text = path.read_text(encoding="utf-8-sig")
            config = self.network_config()
            for old, new in REPLACEMENTS.items():
                if config["online"] and old.startswith(("https://packages.", "https://etc.")):
                    continue
                text = text.replace(old, new)
            if path.name == "sw.js" and config["online"]:
                text = text.replace("let NETWORK_ONLINE = false;", "let NETWORK_ONLINE = true;")
                text = text.replace(json.dumps(POLICY), json.dumps(ONLINE_POLICY))
            if path.suffix == ".html" and "<head>" in text:
                settings = json.dumps(config).replace("<", "\\u003c")
                text = text.replace("<head>", '<head><script>window.W96_NETWORK_CONFIG=' + settings +
                                    ';</script><script src="/offline-runtime.js"></script>', 1)
            data = text.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(str(path)) + "; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return io.BytesIO(data)
        return super().send_head()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8192)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    mimetypes.add_type("application/wasm", ".wasm")
    try:
        server = LocalServer(("127.0.0.1", args.port), partial(OfflineHandler, directory=str(ROOT)))
    except OSError as error:
        raise SystemExit(f"Cannot start on port {args.port}. Close the previous launcher window and try again. ({error})")
    url = f"http://127.0.0.1:{server.server_port}/"
    print(f"Windows 96 (automatic online/offline): {url}\nKeep this window open. Press Ctrl+C to stop.", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
