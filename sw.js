/* Malta Bouldering — service worker.

   Lives at the repo root, not in /js/, so its scope covers the whole site. A
   worker served from /js/ can only control /js/, and GitHub Pages cannot send
   the Service-Worker-Allowed header needed to widen that.

   There is no constant to bump. The cache is named from meta.version in
   data.json, which the editor stamps on every save, and data.json is fetched
   network-first while online. A save therefore invalidates the offline cache
   by itself: the worker notices the new version, re-precaches, drops the old
   cache and tells the page to offer a reload. */

var VERSION_CACHE = "mb-version";
var VERSION_KEY = "./__data-version";

/* Everything the page needs to boot with no network. Images come from
   data.json, so they are added at precache time rather than listed here. */
var SHELL = [
  "./",
  "index.html",
  "css/style.css",
  "css/print.css",
  "js/app.js",
  "js/render.js",
  "shared/schema.js",
  "shared/grades.js",
  "data/data.json"
];

function cacheNameFor(version) {
  return "mb-" + version;
}

/* Hero and every topo. Action photos are deliberately left out: they are the
   bulk of the weight and none of the navigational value, exactly as they are
   left out of print. They still cache on demand once viewed. */
function imagePaths(data) {
  var paths = [];
  if (data.meta && data.meta.hero && data.meta.hero.src) paths.push(data.meta.hero.src);
  (data.sectors || []).forEach(function (sector) {
    (sector.boulders || []).forEach(function (boulder) {
      if (boulder.topo && boulder.topo.src) paths.push(boulder.topo.src);
    });
  });
  return paths;
}

function fetchData() {
  return fetch("data/data.json", { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  });
}

function storedVersion() {
  return caches.open(VERSION_CACHE).then(function (cache) {
    return cache.match(VERSION_KEY);
  }).then(function (res) {
    return res ? res.text() : null;
  });
}

function storeVersion(version) {
  return caches.open(VERSION_CACHE).then(function (cache) {
    return cache.put(VERSION_KEY, new Response(version));
  });
}

function precache(data) {
  var version = data.meta.version;
  var urls = SHELL.concat(imagePaths(data));

  return caches.open(cacheNameFor(version)).then(function (cache) {
    // Added one by one: a single missing file should not fail the whole install.
    return Promise.all(urls.map(function (url) {
      return cache.add(url).catch(function () {
        console.warn("Precache skipped:", url);
      });
    }));
  }).then(function () {
    return storeVersion(version);
  }).then(function () {
    return version;
  });
}

function dropStaleCaches(keep) {
  return caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (key) {
      if (key === VERSION_CACHE || key === keep) return null;
      return caches.delete(key);
    }));
  });
}

function tellClients(message) {
  return self.clients.matchAll({ includeUncontrolled: true }).then(function (clients) {
    clients.forEach(function (client) { client.postMessage(message); });
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    fetchData()
      .then(precache)
      .catch(function (err) { console.warn("Precache failed:", err); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    storedVersion()
      .then(function (version) { return dropStaleCaches(version ? cacheNameFor(version) : null); })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isDataRequest(url) {
  return url.pathname.replace(/^.*\//, "") === "data.json";
}

/* Network-first, and the one request that can change the cache's identity. */
function handleData(request) {
  return fetch(request).then(function (res) {
    if (!res || !res.ok) throw new Error("bad response");

    return res.clone().json().then(function (data) {
      var version = data.meta.version;

      return storedVersion().then(function (known) {
        if (known === version) {
          return caches.open(cacheNameFor(version)).then(function (cache) {
            return cache.put(request, res.clone());
          }).then(function () { return res; });
        }

        // New content: rebuild the cache under the new name, bin the old one,
        // and let the page offer a reload.
        return precache(data)
          .then(function () { return dropStaleCaches(cacheNameFor(version)); })
          .then(function () { return tellClients({ type: "DATA_UPDATED", version: version }); })
          .then(function () { return res; });
      });
    });
  }).catch(function () {
    return caches.match(request).then(function (cached) {
      return cached || Response.error();
    });
  });
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // The editor is a local authoring tool. Serving it from cache would hand you
  // a stale build of the thing you are editing with, so it always goes to the
  // network.
  if (url.pathname.indexOf("/editor/") !== -1) return;

  if (isDataRequest(url)) {
    event.respondWith(handleData(req));
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          storedVersion().then(function (version) {
            if (!version) return;
            caches.open(cacheNameFor(version)).then(function (c) { c.put(req, copy); });
          });
        }
        return res;
      }).catch(function () { return cached; });

      // Cache first, revalidate in the background.
      return cached || network;
    })
  );
});
