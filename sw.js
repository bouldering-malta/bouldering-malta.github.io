/* Malta Bouldering — service worker.
   Lives at the repo root, not in /js/, so its scope covers the whole site.
   A worker served from /js/ can only control /js/, and GitHub Pages cannot
   send the Service-Worker-Allowed header needed to widen that.

   Bump CACHE_VERSION on every content change. */

var CACHE_VERSION = "mb-2026-09-07-1";

var PRECACHE = [
  "./",
  "index.html",
  "css/style.css",
  "css/print.css",
  "js/app.js",
  "data/data.json"
  // Add hero and topo paths here once real images land, e.g.
  // "images/hero/ghar-hassan-dawn.jpg",
  // "images/topos/ghar-hassan-cave-block.jpg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // Added one by one: a single missing file should not fail the whole install.
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(url).catch(function () {
          console.warn("Precache skipped:", url);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return key === CACHE_VERSION ? null : caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });

      // Cache first, revalidate in the background.
      return cached || network;
    })
  );
});
