"""Regression check for static hosting; requires Playwright and installed Chrome."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=True,
                args=["--autoplay-policy=user-gesture-required"])
            for preference, reachable in [("offline", False), ("auto", False), ("auto", True)]:
                context = browser.new_context()
                context.add_init_script("window.rawFetch = window.fetch.bind(window)")
                errors, outbound, backend = [], [], []

                def remote(route):
                    outbound.append(route.request.url)
                    if "w96probe=" in route.request.url:
                        if reachable:
                            route.fulfill(status=200, body="reachable")
                        else:
                            route.abort()
                    else:
                        route.fulfill(status=503, body="Unavailable offline")

                context.route("https://**/*", remote)
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("request", lambda request: backend.append(request.url)
                    if "/network-mode?" in request.url else None)
                page.goto(base + "/?network=" + preference)
                page.get_by_text("Computer", exact=True).wait_for(timeout=45000)
                page.wait_for_timeout(500)
                # The second boot reproduces the bug with an existing controlling worker.
                page.reload()
                page.get_by_text("Computer", exact=True).wait_for(timeout=45000)
                page.wait_for_timeout(500)
                expected = "online" if reachable else "offline"
                assert page.evaluate("W96_NETWORK_MODE") == expected
                assert page.locator("#w96-connection-status").count() == 1
                assert not backend, backend
                for endpoint in ["https://packages.windows96.net/r3-main/Release.json",
                                 "https://etc.windows96.net/notron/virdefs.json"]:
                    result = page.evaluate("""async url => {
                        const response = await rawFetch(url);
                        return {status: response.status, data: await response.json()};
                    }""", endpoint)
                    assert result["status"] == 200, result
                    assert isinstance(result["data"], (dict, list)), result
                assert not errors, errors
                if preference == "offline":
                    assert not outbound, outbound
                print(f"PASS static {preference}/{expected}: boot, worker JSON fallback, blocked autoplay", flush=True)
                context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
