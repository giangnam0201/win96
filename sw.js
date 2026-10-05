// Keep virtual-drive pages subject to the same offline policy as static pages.
function offlineResponse(body, options = {}) {
    const headers = new Headers(options.headers);
    headers.set('Content-Security-Policy', POLICY);
    return new Response(body, { ...options, headers });
}
let NETWORK_ONLINE = false;
let POLICY = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline' data:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self' data: blob:; frame-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; form-action 'self'; base-uri 'self'";
/**
 * Windows 96 File System Proxy worker.
 *
 * Copyright (C) windows96.net 2022.
 */

function htmlEncode(str) {
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#39;");
}

const DIR_REGEX = /^\/([a-zA-Z])\//i;

function toW96Path(path) {
    return path.replace(DIR_REGEX, "$1:/");
}

self.addEventListener("install", event => {
    event.waitUntil(self.skipWaiting());
});


self.addEventListener("activate", event => {
    event.waitUntil(self.clients.claim());
});

const messageCallbacks = new Map();
self.addEventListener("message", event => {
    if (event.data?.type === "w96-network" && event.source &&
        new URL(event.source.url).origin === self.location.origin) {
        NETWORK_ONLINE = event.data.online === true;
        if (typeof event.data.policy === 'string') POLICY = event.data.policy;
        return;
    }
    if (!Array.isArray(event.data))
        return;
    const [id, ...args] = event.data;
    const func = messageCallbacks.get(id);
    if (func)
        func(args);
    else
        console.warn("got message", event.data, "but nothing to handle it, possible id dupe?");
});

let _id = 0;
function callClient(client, ...args) {
    return new Promise((resolve, reject) => {
        const id = client.id + "#" + (_id++);
        client.postMessage([id, ...args]);
        console.log("%c%s %c<%c %o", "color:grey", id, "color:#09f", "", args);

        const timeout = setTimeout(() => {
            messageCallbacks.delete(id);
            reject("timed out");
        }, 10000);

        messageCallbacks.set(id, data => {
            console.log("%c%s %c>%c %o", "color:grey", id, "color:#0f9", "", data);
            clearTimeout(timeout);
            messageCallbacks.delete(id);
            resolve(data);
        });
    });
}

async function getClient(maybeId) {
    const client = await clients.get(maybeId);
    if (client && client.type === "window" && new URL(client.url).pathname === "/")
        return client;

    for (const client of await self.clients.matchAll({type: "window"}))
        if (client.type === "window" && new URL(client.url).pathname === "/")
            return client;
}

function indexOf(url, ents) {
    let out = `<h1>Index of ${htmlEncode(url)}</h1><ul>`;

    for (let [link, name] of ents) {
        out += `<li><a href="${htmlEncode(link)}">${htmlEncode(name)}</a></li>`;
    }

    out += "</ul><hr><address>windows96.net</address>";
    return out;
}

self.addEventListener("fetch", event => {
    const url = new URL(event.request.url);

    let mirror;
    if (url.hostname === 'packages.windows96.net' && /^\/r3-main(?:\/|$)/.test(url.pathname)) mirror = url.pathname;
    if (url.hostname === 'etc.windows96.net' && url.pathname === '/notron/virdefs.json') mirror = url.pathname;
    if (url.hostname === 'windows96.net' && /^\/(system|dl)\//.test(url.pathname) && !url.searchParams.has('w96probe')) mirror = url.pathname;
    if (url.hostname === 'cdn.windows96.net' && url.pathname === '/credits/default.png') mirror = '/system/resource/offline/credits.png';
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname === '/jquery.ui.rotatable/1.0.1/rotate.png') mirror = '/system/libraries/extern/jquery/rotate.png';
    if (url.hostname === 'js-dos.com' && url.pathname.startsWith('/6.22/current/')) mirror = '/system/libraries/extern/js-dos/' + url.pathname.slice('/6.22/current/'.length);
    if (mirror) {
        event.respondWith((async () => {
            if (NETWORK_ONLINE && ['packages.windows96.net', 'etc.windows96.net'].includes(url.hostname)) {
                try {
                    const response = await fetch(event.request.clone());
                    if (response.ok || response.type === 'opaque') return response;
                } catch (_) { /* Use the bundled snapshot when this endpoint is down. */ }
            }
            return fetch(new URL(mirror + url.search, self.location.origin));
        })());
        return;
    }

    const probe = url.origin === "https://windows96.net" &&
        url.pathname === "/system/resource/app/appletouch-icon.png" && url.searchParams.has("w96probe");
    if (url.origin !== self.location.origin && !NETWORK_ONLINE && !probe) {
        event.respondWith(Promise.resolve(offlineResponse(JSON.stringify({error:'offline',message:'Unavailable offline'}),
            {status: 503, headers: {'Content-Type':'application/json'}})));
        return;
    }
    if (url.origin === self.location.origin && url.pathname.startsWith("/_/")) {
        event.respondWith((async function() {
            if (/^\/_\/[a-z]+$/i.test(url.pathname)) {
                return offlineResponse("", {
                    status: 302,
                    headers: {"Location": url.pathname + "/"}
                });
            }

            const client = await getClient(event.clientId);
            if (!client) {
                return offlineResponse(`<h1>503 Service Unavailable</h1>Please open a <a href="/">Windows 96</a> window to access this resource.`, {
                    status: 503,
                    headers: {"Content-Type": "text/html"}
                });
            }

            const filename = toW96Path(decodeURI(url.pathname.slice(2)));

            const [type, ...rest] = await callClient(client, "get", filename);
            if (type === "data") {
                const [data, mime] = rest;
                return offlineResponse(data, {
                    status: 200,
                    headers: {
                        "Content-Type": mime
                    }
                });
            } else if (type === "disks") {
                const ents = rest[0].map(v => [v.replace(/:$/, "") + "/", v + "/"]);
                return offlineResponse(indexOf("computer://", ents), {headers: {"Content-Type": "text/html"}});
            } else if (type === "dir") {
                if (!url.pathname.endsWith("/")) {
                    return offlineResponse("", {
                        status: 302,
                        headers: {"Location": url.pathname + "/"}
                    })
                }

                const ents = [
                    ["..", ".."],
                    ...(rest[0].map(ent => {
                        const name = ent.substring(ent.lastIndexOf("/") + 1)
                        return [name, name];
                    }))
                ];

                return offlineResponse(indexOf(filename, ents), {headers: {"Content-Type": "text/html"}});
            } else if (type === "error") {
                const [error, name] = rest;

                if (typeof error === "number") { // FSErrno
                    return offlineResponse(name, {status: error === 2 ? 404 : 500});
                } else {
                    return offlineResponse(error, {status: 500});
                }
            }
        })());
    }
});
