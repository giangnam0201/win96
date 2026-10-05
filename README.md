# Windows 96 with automatic online/offline mode

Double-click **Start-Offline.bat**, or run `python offline-server.py` from this folder.
Open **http://127.0.0.1:8192/** and keep the server window open. Python 3.10 or newer
and a modern browser are required. No pip/npm install or internet connection is
needed to run the site. Keep this entire folder together. Use the same port each
time: the browser stores your virtual C: drive separately for each origin.

The same files can be hosted at the root of a static HTTPS site, including GitHub
Pages with a custom domain. The page loads its connection runtime directly; a
Python backend is not needed for hosted mode. Mirrored package and antivirus URLs
also fall back through the service worker, including requests made by older apps.

This bundle includes the boot kernel, system drive, game binaries, editor workers,
Flash emulation, DOSBox, antivirus definitions, and all 19 package archives. The
server serves the desktop and app assets locally in both modes. At startup JavaScript
checks whether windows96.net is reachable (with a 2.5-second timeout). If it is,
online services, websites and network connections are enabled. Otherwise the site
uses the bundled repository and antivirus definitions. Failed online fetches for
mirrored resources fall back to the local files. Analytics remain removed.

The small **Online / Offline** indicator shows the active mode. Automatic mode also
rechecks reachability every 30 seconds. Losing connectivity
switches requests to local resources and closes network sockets. If internet returns
after an offline startup with the local Python launcher, click **Online available ·
Reload** after saving your work to enable online services. Static hosting switches
back online directly; returning connectivity never discards open apps silently.

To force a mode, open `http://127.0.0.1:8192/?network=offline`, `?network=online`, or
`?network=auto`. The preference persists in this browser. Forced offline mode makes
no internet probe and blocks outside resources and sockets. Automatic mode may make
small reachability requests even when the browser reports a working network.
The file-system service worker applies the selected policy to virtual-drive pages.

The desktop and bundled apps operate without internet. External websites, Discord,
P3 multiplayer/remote connections, Dropbox, live music catalogs, and downloads not
included here are unavailable while offline. In online mode they can use their
original endpoints, subject to those services' availability, CORS and iframe rules.
Antivirus definitions are the bundled snapshot when offline.

Do not open index.html directly: browser security prevents the virtual filesystem,
fetches, and workers from operating correctly with file:// URLs. This is an offline
local-server bundle; it does not cache the whole installation for use after the
server has stopped.

Run `python verify-offline.py` to check bundle integrity, local routes, and the
offline policy. `scraper.py` is an optional **online maintenance tool**, not a startup
requirement; do not run it to launch the page.

The original Windows 96 and dependency copyright/license notices are preserved.
