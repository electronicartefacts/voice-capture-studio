const CACHE_NAME = "voice-capture-studio-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll([
          self.registration.scope,
          `${self.registration.scope}manifest.webmanifest`,
          `${self.registration.scope}icon.svg`,
        ]),
      ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  if (
    event.request.method !== "GET" ||
    requestUrl.origin !== self.location.origin
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse.ok) {
          const responseClone = networkResponse.clone();

          event.waitUntil(
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, responseClone)),
          );
        }

        return networkResponse;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then(
            (cachedResponse) =>
              cachedResponse ?? caches.match(self.registration.scope),
          ),
      ),
  );
});
