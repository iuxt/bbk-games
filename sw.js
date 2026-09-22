"use strict";

const CACHE_VERSION = "bbk-games-v1";
const SHELL_CACHE = CACHE_VERSION + "-shell";
const RUNTIME_CACHE = CACHE_VERSION + "-runtime";
const CACHE_NAMES = new Set([SHELL_CACHE, RUNTIME_CACHE]);

// 只预缓存轻量应用外壳。大型引擎、固件和 ROM 在真正使用后缓存，
// 避免用户只看首页就下载一百多 MB 的游戏数据。
const APP_SHELL = [
    "/",
    "/index.html",
    "/manifest.webmanifest",
    "/favicon.png",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/css/portal.css",
    "/js/pwa.js",
    "/js/game-page.js",
    "/rpg/index.html",
    "/sanguobaye/index.html",
    "/mota/index.html",
    "/eebbk/index.html"
];

self.addEventListener("install", function (event) {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(function (cache) {
                return Promise.all(APP_SHELL.map(function (url) {
                    return cache.add(url).catch(function () {
                        // 单个可选资源失败时仍允许 Service Worker 安装。
                    });
                }));
            })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener("activate", function (event) {
    event.waitUntil(
        caches.keys()
            .then(function (names) {
                return Promise.all(names.map(function (name) {
                    if (name.indexOf("bbk-games-") === 0 && !CACHE_NAMES.has(name)) {
                        return caches.delete(name);
                    }
                }));
            })
            .then(function () { return self.clients.claim(); })
    );
});

function canCache(response) {
    return response && response.status === 200 && (response.type === "basic" || response.type === "default");
}

function store(cacheName, request, response) {
    if (!canCache(response)) return Promise.resolve(response);
    return caches.open(cacheName)
        .then(function (cache) {
            return cache.put(request, response.clone());
        })
        .then(function () { return response; })
        .catch(function () { return response; });
}

function networkFirst(request) {
    return fetch(request)
        .then(function (response) { return store(RUNTIME_CACHE, request, response); })
        .catch(function () {
            return caches.match(request).then(function (cached) {
                if (cached) return cached;
                if (request.mode === "navigate") return caches.match("/index.html");
                return Response.error();
            });
        });
}

function staleWhileRevalidate(request, event) {
    return caches.match(request).then(function (cached) {
        var freshRequest = new Request(request, { cache: "no-cache" });
        var update = fetch(freshRequest).then(function (response) {
            return store(RUNTIME_CACHE, request, response);
        }).catch(function () {
            return cached || Response.error();
        });
        if (cached) event.waitUntil(update);
        return cached || update;
    });
}

self.addEventListener("fetch", function (event) {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (request.mode === "navigate") {
        event.respondWith(networkFirst(request));
        return;
    }

    // 游戏包和大型二进制立即从缓存启动，同时在后台校验是否有新版本。
    if (/\/(?:roms|libs)\/.+\.(?:gam|lib)$/.test(url.pathname) ||
        /\.(?:wasm|data\.[0-9]+)$/.test(url.pathname)) {
        event.respondWith(staleWhileRevalidate(request, event));
        return;
    }

    // 目录必须优先联网，确保新增游戏能立即出现；断网时回退到缓存。
    if (/\/(?:catalog|libs)\.json$/.test(url.pathname)) {
        event.respondWith(networkFirst(request));
        return;
    }

    event.respondWith(staleWhileRevalidate(request, event));
});

self.addEventListener("message", function (event) {
    if (!event.data || event.data.type !== "CACHE_URLS" || !Array.isArray(event.data.urls)) return;

    const requests = event.data.urls.slice(0, 200).map(function (value) {
        try {
            const url = new URL(value, self.location.origin);
            if (url.origin !== self.location.origin) return null;
            return new Request(url.href, { credentials: "same-origin" });
        } catch (_) {
            return null;
        }
    }).filter(Boolean);

    event.waitUntil(
        caches.open(RUNTIME_CACHE).then(function (cache) {
            return Promise.all(requests.map(function (request) {
                return cache.match(request).then(function (cached) {
                    if (cached) return;
                    return fetch(request).then(function (response) {
                        if (canCache(response)) return cache.put(request, response);
                    }).catch(function () {
                        // 页面补缓存失败不会影响游戏运行。
                    });
                });
            }));
        })
    );
});
