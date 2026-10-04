import os
import json
import time
import urllib.request
import io
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_URL = "https://windows96.net"
PKG_BASE_URL = "https://packages.windows96.net/r3-main"

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}
DOWNLOAD_FAILURES = []

def download_url(url, target_file, max_attempts=5):
    if os.path.exists(target_file) and os.path.getsize(target_file) > 0:
        return target_file, True, "Already exists"
    
    dirname = os.path.dirname(target_file)
    if dirname:
        os.makedirs(dirname, exist_ok=True)
    
    for attempt in range(max_attempts):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as res:
                data = res.read()
                if target_file.endswith('.zip'):
                    with zipfile.ZipFile(io.BytesIO(data)) as archive:
                        if archive.testzip():
                            raise ValueError('Corrupt ZIP download')
                # A failed download must never become an apparently cached file.
                temporary_file = target_file + '.download'
                with open(temporary_file, "wb") as f:
                    f.write(data)
                os.replace(temporary_file, target_file)
                return target_file, True, f"{len(data)} bytes"
        except Exception as e:
            if attempt < max_attempts - 1:
                time.sleep(0.5 * (attempt + 1))
            else:
                DOWNLOAD_FAILURES.append((target_file, str(e)))
                return target_file, False, str(e)

def main():
    print("=== STARTING WINDOWS 96 SCRAPER ===")
    
    # 1. Base files
    static_files = [
        ("index.html", f"{BASE_URL}/index.html"),
        ("system/resource/stylesheets/normalize.css", f"{BASE_URL}/system/resource/stylesheets/normalize.css"),
        ("system/libraries/extern/jquery/jquery-ui.min.css", f"{BASE_URL}/system/libraries/extern/jquery/jquery-ui.min.css"),
        ("system/libraries/extern/codemirror/codemirror.css", f"{BASE_URL}/system/libraries/extern/codemirror/codemirror.css"),
        ("system/libraries/extern/jszip/jszip.min.js", f"{BASE_URL}/system/libraries/extern/jszip/jszip.min.js"),
        ("system/libraries/kernel/ldb-async.js", f"{BASE_URL}/system/libraries/kernel/ldb-async.js"),
        ("system/libraries/extern/jquery/jquery-3.5.1.min.js", f"{BASE_URL}/system/libraries/extern/jquery/jquery-3.5.1.min.js"),
        ("system/libraries/extern/jquery/jquery-ui.min.js", f"{BASE_URL}/system/libraries/extern/jquery/jquery-ui.min.js"),
        ("system/libraries/extern/jquery/jquerydestroyer.js", f"{BASE_URL}/system/libraries/extern/jquery/jquerydestroyer.js"),
        ("system/libraries/extern/showdown/showdown.min.js", f"{BASE_URL}/system/libraries/extern/showdown/showdown.min.js"),
        ("system/libraries/extern/socket.io/socket.io.min.js", f"{BASE_URL}/system/libraries/extern/socket.io/socket.io.min.js"),
        ("system/libraries/kernel/stage0.js", f"{BASE_URL}/system/libraries/kernel/stage0.js"),
        ("system/libraries/kernel/kl.js", f"{BASE_URL}/system/libraries/kernel/kl.js"),
        ("system/libraries/kernel/sys-base/kernel.js", f"{BASE_URL}/system/libraries/kernel/sys-base/kernel.js"),
        ("system/images/rofs.json", f"{BASE_URL}/system/images/rofs.json"),
        ("system/images/bstr.json", f"{BASE_URL}/system/images/bstr.json"),
        ("system/images/rootfs/rootfs.zip", f"{BASE_URL}/system/images/rootfs/rootfs.zip"),
        ("system/images/rootfs/oobe.zip", f"{BASE_URL}/system/images/rootfs/oobe.zip"),
        ("system/images/rootfs/recovery.zip", f"{BASE_URL}/system/images/rootfs/recovery.zip"),
        ("system/images/mobsupport-generic.zip", f"{BASE_URL}/system/images/mobsupport-generic.zip"),
        ("system/images/mobsupport-ios.zip", f"{BASE_URL}/system/images/mobsupport-ios.zip"),
        ("system/resource/app/appletouch-icon.png", f"{BASE_URL}/system/resource/app/appletouch-icon.png"),
        ("notron/virdefs.json", "https://etc.windows96.net/notron/virdefs.json"),
        ("system/libraries/extern/jquery/rotate.png", "https://cdn.jsdelivr.net/jquery.ui.rotatable/1.0.1/rotate.png")
    ]

    print("Downloading static base files...")
    for target_file, url in static_files:
        path, success, msg = download_url(url, target_file)
        print(f"[{'OK' if success else 'FAIL'}] {path}: {msg}")

    # Dummy ct.js
    os.makedirs("vc", exist_ok=True)
    with open("vc/ct.js", "w") as f:
        f.write("// Dummy analytics script\n")

    # 2. ROFS files
    with open("system/images/rofs.json", "r") as f:
        rofs = json.load(f)

    # README belongs to this offline project; Git markers are not site assets.
    rofs_files = [k for k, v in rofs.items() if v.get('type') == 0
                  and k not in ['/README.md', '/system/apps/.git',
                                '/system/libraries/kernel/sys-base/.gitkeep']]
    print(f"\nDownloading {len(rofs_files)} ROFS files...")

    tasks = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        for rpath in rofs_files:
            rel_path = rpath.lstrip('/')
            url = f"{BASE_URL}/{rel_path}"
            tasks.append(executor.submit(download_url, url, rel_path))

        success_count = 0
        fail_count = 0
        for future in as_completed(tasks):
            path, success, msg = future.result()
            if success:
                success_count += 1
            else:
                fail_count += 1
                print(f"[ROFS FAIL] {path}: {msg}")

    print(f"ROFS download complete: {success_count} succeeded, {fail_count} failed.")

    # 3. Packages
    print("\nDownloading Package Manager repository...")
    download_url(f"{PKG_BASE_URL}/Release.json", "r3-main/Release.json")
    _, success, msg = download_url(f"{PKG_BASE_URL}/Packages.json", "r3-main/Packages.json")

    if success:
        with open("r3-main/Packages.json", "r") as f:
            packages = json.load(f)

        print(f"Found {len(packages)} packages in r3-main. Downloading content zips...")
        pkg_tasks = []
        with ThreadPoolExecutor(max_workers=6) as executor:
            for p in packages:
                pkg_root = p['packageRoot'].replace('$REPO_PATH$', PKG_BASE_URL)
                for icon_url in set(p.get('iconFiles', {}).values()):
                    icon_target = icon_url.replace('$REPO_PATH$', 'r3-main')
                    pkg_tasks.append(executor.submit(download_url,
                        icon_url.replace('$REPO_PATH$', PKG_BASE_URL), icon_target))
                ver_val = p['version']
                ver_str = str(ver_val)
                if '.' not in ver_str:
                    ver_str += '.0'

                zip_url = f"{pkg_root}/content@{ver_str}.zip"
                rel_dir = p['packageRoot'].replace('$REPO_PATH$', 'r3-main')
                target_zip = f"{rel_dir}/content@{ver_str}.zip"
                
                pkg_tasks.append(executor.submit(download_url, zip_url, target_zip))

            for future in as_completed(pkg_tasks):
                path, success, msg = future.result()
                print(f"[{'PKG OK' if success else 'PKG FAIL'}] {path}: {msg}")

    if DOWNLOAD_FAILURES:
        print(f"\nDOWNLOAD INCOMPLETE: {len(DOWNLOAD_FAILURES)} failed files")
        raise SystemExit(1)
    print("\n=== DOWNLOAD COMPLETE ===")

if __name__ == "__main__":
    main()
