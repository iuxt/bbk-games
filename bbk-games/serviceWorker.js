var CACHE_VERSION = "cache_v0.0.4";
var COMMON_CACHE_VERSION = "common_cache_v0.0.1";
var whiteSourceUrlList = ["/click.mp3"];

this.addEventListener("install", function (event) {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  // 白名单必须同时包含普通缓存与 ROM 共用缓存，否则每次升级会清空全部已下载的 ROM
  var cacheWhitelist = [CACHE_VERSION, COMMON_CACHE_VERSION];
  event.waitUntil(
    caches.keys().then(function (keyList) {
      return Promise.all(
        keyList.map(function (key) {
          if (cacheWhitelist.indexOf(key) === -1) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  event.waitUntil(clients.claim());
});

self.addEventListener("fetch", function (event) {
  if (
    !whiteSourceUrlList.find((url) => event.request.url.indexOf(url) !== -1) &&
    event.request.url.indexOf("chrome-extension") == -1
  ) {
    var currentChache =
      event.request.url.indexOf("/roms/") !== -1
        ? COMMON_CACHE_VERSION
        : CACHE_VERSION;

    event.respondWith(
      caches.match(event.request).then(function (resp) {
        if (resp) {
          return resp;
        }
        return fetch(event.request)
          .then(function (response) {
            // Cache.put 规范要求 request.method 必须为 GET，否则 reject TypeError
            if (event.request.method === "GET" && response.ok) {
              var clone = response.clone();
              caches.open(currentChache).then(function (cache) {
                cache.put(event.request, clone);
              });
            }
            return response;
          })
          .catch(function () {
            // 离线/网络错误兜底：导航请求回退到已缓存的应用外壳，避免空白页
            if (event.request.mode === "navigate") {
              return caches.match("/").then(function (fallback) {
                return fallback || Response.error();
              });
            }
            return Response.error();
          });
      })
    );
  }
});
