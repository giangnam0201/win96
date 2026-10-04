/* Local desktop, with automatic access to live internet services. */
(() => {
    "use strict";
    const config = window.W96_NETWORK_CONFIG || {online: false, preference: "offline"};
    const origin = location.origin;
    const nativeFetch = window.fetch.bind(window);
    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeWindowOpen = window.open.bind(window);
    const sockets = new Set();
    let online = config.online;
    let checking = false;
    let badge;

    function bundledURL(input) {
        const url = new URL(input, location.href);
        if (url.origin === origin || ["data:", "blob:"].includes(url.protocol)) return url.href;
        if (["windows96.net", "packages.windows96.net"].includes(url.hostname)) {
            return origin + url.pathname + url.search + url.hash;
        }
        if (url.hostname === "etc.windows96.net" && url.pathname === "/notron/virdefs.json") {
            return origin + url.pathname + url.search;
        }
        throw new TypeError("Unavailable offline: " + url.hostname);
    }
    function serviceURL(input) {
        const url = new URL(input, location.href);
        if (url.origin === origin && /^\/r3-main(?:\/|$)/.test(url.pathname)) {
            return "https://packages.windows96.net" + url.pathname + url.search;
        }
        if (url.origin === origin && url.pathname === "/notron/virdefs.json") {
            return "https://etc.windows96.net" + url.pathname + url.search;
        }
        return url.href;
    }
    function workerMode() {
        if (!navigator.serviceWorker) return;
        const message = {type: "w96-network", online,
            policy: online ? config.onlinePolicy : config.offlinePolicy};
        navigator.serviceWorker.controller?.postMessage(message);
        navigator.serviceWorker.getRegistration().then(reg => reg?.active?.postMessage(message));
    }
    function publishMode(reloadNeeded = false) {
        window.W96_OFFLINE = !online;
        window.W96_NETWORK_MODE = online ? "online" : "offline";
        workerMode();
        if (badge) {
            badge.textContent = reloadNeeded ? "Online available · Reload" : online ? "Online" : "Offline";
            badge.title = reloadNeeded ? "Save your work, then reload to enable online services." :
                online ? "Internet services enabled; desktop served locally." : "Using the local offline copy.";
            badge.onclick = reloadNeeded ? () => location.reload() : null;
            badge.style.cursor = reloadNeeded ? "pointer" : "default";
        }
    }
    async function detectInternet() {
        if (!navigator.onLine) return false;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        try {
            const response = await nativeFetch("https://windows96.net/system/resource/app/appletouch-icon.png?w96probe=" + Date.now(),
                {mode: "no-cors", cache: "no-store", credentials: "omit", signal: controller.signal});
            return response.ok || response.type === "opaque";
        } catch (_) { return false; }
        finally { clearTimeout(timeout); }
    }
    async function saveMode(value) {
        const response = await nativeFetch("/network-mode?mode=" + (value ? "online" : "offline"), {cache: "no-store"});
        if (!response.ok) throw new Error("Could not update connection mode");
    }
    async function start() {
        if (window.top !== window || config.preference !== "auto") { publishMode(); return; }
        // Update the old strictly-offline worker before it handles the reachability probe.
        if (navigator.serviceWorker?.controller) {
            try {
                const registration = await navigator.serviceWorker.getRegistration();
                await registration?.update();
                if (registration?.installing || registration?.waiting) {
                    await new Promise(resolve => {
                        const changed = () => { clearTimeout(timeout); resolve(); };
                        const timeout = setTimeout(() => {
                            navigator.serviceWorker.removeEventListener("controllerchange", changed);
                            resolve();
                        }, 2500);
                        navigator.serviceWorker.addEventListener("controllerchange", changed, {once: true});
                    });
                }
            } catch (_) { /* The local desktop can still boot without a worker. */ }
        }
        const available = await detectInternet();
        if (available !== config.online) {
            await saveMode(available);
            location.reload();
            await new Promise(() => {});
        }
        online = available;
        publishMode();
    }
    window.W96_NETWORK_READY = start();
    window.fetch = async (input, init) => {
        await window.W96_NETWORK_READY;
        const original = input instanceof Request ? input.url : input;
        const url = online ? serviceURL(original) : bundledURL(original);
        const request = target => input instanceof Request ? new Request(target, input.clone()) : target;
        if (!online || new URL(url).origin === origin || !/^https?:/.test(url)) return nativeFetch(request(url), init);
        try {
            const response = await nativeFetch(request(url), init);
            if (response.ok || response.type === "opaque") return response;
            let fallback;
            try { fallback = bundledURL(original); } catch (_) { return response; }
            const local = await nativeFetch(request(fallback), init);
            return local.ok ? local : response;
        } catch (error) {
            if (error.name === "AbortError" || init?.signal?.aborted ||
                (input instanceof Request && input.signal.aborted)) throw error;
            return nativeFetch(request(bundledURL(original)), init);
        }
    };
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        return nativeOpen.call(this, method, online ? serviceURL(url) : bundledURL(url), ...args);
    };
    window.open = function(url, ...args) {
        try { return nativeWindowOpen(url && !online ? bundledURL(url) : url, ...args); }
        catch (error) { alert(error.message); return null; }
    };
    document.addEventListener("click", event => {
        if (online) return;
        const link = event.target.closest?.("a[href]");
        if (!link || /^(?:mailto:|tel:|javascript:)/i.test(link.getAttribute("href"))) return;
        try { link.href = bundledURL(link.href); }
        catch (error) { event.preventDefault(); alert(error.message); }
    }, true);
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
        constructor(url, ...args) {
            if (!online) throw new TypeError("Network connections are unavailable offline");
            super(url, ...args);
            sockets.add(this);
            this.addEventListener("close", () => sockets.delete(this));
        }
    };
    navigator.serviceWorker?.addEventListener("controllerchange", () => publishMode());
    if (window.top === window) {
        document.addEventListener("DOMContentLoaded", () => {
            badge = document.createElement("button");
            badge.id = "w96-connection-status";
            badge.style.cssText = "position:fixed;right:8px;top:8px;z-index:99999;font:11px sans-serif;padding:4px 8px;border:1px solid #777;border-radius:3px;background:#e8e8e8;color:#222";
            document.body.appendChild(badge);
            publishMode();
        });
        if (config.preference === "auto") {
            window.addEventListener("offline", () => {
                online = false;
                for (const socket of sockets) socket.close();
                saveMode(false).catch(console.warn);
                publishMode();
            });
            const refreshConnection = async () => {
                if (checking) return;
                checking = true;
                try {
                    const available = await detectInternet();
                    if (!available) {
                        if (online) {
                            online = false;
                            for (const socket of sockets) socket.close();
                            await saveMode(false);
                        }
                        publishMode();
                    } else if (!online) {
                        if (!config.online) publishMode(true);
                        else { await saveMode(true); online = true; publishMode(); }
                    }
                } finally { checking = false; }
            };
            window.addEventListener("online", refreshConnection);
            setInterval(() => refreshConnection().catch(console.warn), 30000);
        }
    }
})();
