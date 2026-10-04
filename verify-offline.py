"""Check the offline bundle with only the Python standard library."""
import importlib.util
import json
from pathlib import Path
import threading
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent


def main():
    failures = []
    rofs = json.loads((ROOT / "system/images/rofs.json").read_text())
    files = [name for name, entry in rofs.items() if entry["type"] == 0]
    for name in files:
        if not (ROOT / name.lstrip("/")).is_file():
            failures.append("Missing system file: " + name)
    packages = json.loads((ROOT / "r3-main/Packages.json").read_text())
    for package in packages:
        version = str(package["version"])
        if "." not in version:
            version += ".0"
        folder = package["packageRoot"].replace("$REPO_PATH$", "r3-main")
        path = ROOT / folder / ("content@" + version + ".zip")
        if not path.is_file() or not zipfile.is_zipfile(path):
            failures.append("Missing/invalid package: " + str(path))
        for icon in package.get("iconFiles", {}).values():
            if not (ROOT / icon.replace("$REPO_PATH$", "r3-main")).is_file():
                failures.append("Missing package icon: " + icon)
    archives = list((ROOT / "system/images").rglob("*.zip")) + list((ROOT / "r3-main").rglob("*.zip"))
    for path in archives:
        try:
            with zipfile.ZipFile(path) as archive:
                bad = archive.testzip()
                if bad:
                    failures.append(str(path) + ": corrupt entry " + bad)
        except (OSError, zipfile.BadZipFile) as error:
            failures.append(str(path) + ": " + str(error))
    spec = importlib.util.spec_from_file_location("offline_server", ROOT / "offline-server.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    handler = module.partial(module.OfflineHandler, directory=str(ROOT))
    server = module.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}"
    try:
        for path in ["/", "/.meta", "/sw.js", "/offline-runtime.js", "/r3-main/Packages.json",
                     "/notron/virdefs.json", "/system/libraries/kernel/sys-base/kernel.js",
                     "/system/libraries/extern/js-dos/wdosbox.wasm.js"]:
            with urllib.request.urlopen(url + path) as response:
                data = response.read()
                policy = response.headers.get("Content-Security-Policy", "")
                if "connect-src 'self' data: blob:" not in policy:
                    failures.append("Missing offline policy: " + path)
                if path.endswith("kernel.js") and b'"https://packages.windows96.net/r3-main"' in data:
                    failures.append("Remote package endpoint was not rewritten")
                if path == "/" and (b"popeyes.sys36.net" in data or b"fetch('/vc/ct.js'" in data):
                    failures.append("Analytics are still enabled")
                if path.endswith("wasm.js") and data[:4] != b"\0asm":
                    failures.append("Invalid DOSBox WebAssembly")
        with urllib.request.urlopen(url + "/system/apps/blocks") as response:
            if not response.url.endswith("/system/apps/blocks/"):
                failures.append("App directory redirect is missing; relative assets will break")
        for mode in ["offline", "online"]:
            request = urllib.request.Request(url + "/", headers={"Cookie": "w96-preference=" + mode})
            with urllib.request.urlopen(request) as response:
                policy = response.headers["Content-Security-Policy"]
                if mode == "offline" and policy != module.POLICY:
                    failures.append("Forced offline policy permits outside connections")
                if mode == "online" and "https: ws: wss:" not in policy:
                    failures.append("Online policy blocks live services")
        with urllib.request.urlopen(url + "/network-mode?mode=online") as response:
            if response.status != 204 or "w96-network=online" not in response.headers.get("Set-Cookie", ""):
                failures.append("Connection mode cannot be saved")
    finally:
        server.shutdown()
        server.server_close()
    if failures:
        print("\n".join(failures))
        raise SystemExit(1)
    print(f"PASS: {len(files)} system files, {len(packages)} packages, {len(archives)} archives, local routes and offline policy")


if __name__ == "__main__":
    main()
