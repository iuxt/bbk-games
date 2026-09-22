(function () {
    "use strict";

    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(function (registration) {
        // 首次安装时，当前页面的静态资源可能早于 Service Worker 加载完成。
        // 页面加载结束后把实际用到的同源资源补进离线缓存。
        function cacheLoadedResources() {
            navigator.serviceWorker.ready.then(function () {
                var worker = navigator.serviceWorker.controller || registration.active;
                if (!worker || !performance.getEntriesByType) return;

                var urls = [location.href];
                performance.getEntriesByType("resource").forEach(function (entry) {
                    try {
                        var url = new URL(entry.name, location.href);
                        if (url.origin === location.origin) urls.push(url.href);
                    } catch (_) {
                        // 忽略浏览器无法解析的 performance 条目。
                    }
                });
                worker.postMessage({ type: "CACHE_URLS", urls: urls });
            });
        }

        if (document.readyState === "complete") cacheLoadedResources();
        else window.addEventListener("load", cacheLoadedResources, { once: true });
    }).catch(function (error) {
        console.warn("PWA 离线缓存注册失败：", error);
    });
})();
