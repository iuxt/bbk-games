var CACHE_VERSION = "cache_v0.0.3";
var COMMON_CACHE_VERSION = "common_cache_v0.0.1";
var whiteSourceUrlList = ["/click.mp3"];

this.addEventListener("install", function (event) {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  var cacheWhitelist = [CACHE_VERSION];
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
        return (
          resp ||
          fetch(event.request).then(function (response) {
            return caches.open(currentChache).then(function (cache) {
              cache.put(event.request, response.clone());
              return response;
            });
          })
        );
      })
    );
  }
});
