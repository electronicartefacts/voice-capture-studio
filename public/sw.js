// Bump these revisions whenever the application shell or shipped ML models
// change. Keeping application and model caches separate avoids retaining a
// previous release's modules after an offline restart.
const CACHE_NAME = "voice-capture-studio-app-v11";
const MODEL_CACHE_NAME = "voice-capture-studio-models-v3";

function isModelAsset(requestUrl) {
  const scopePath = new URL(self.registration.scope).pathname;

  return (
    requestUrl.pathname.startsWith(`${scopePath}models/`) ||
    requestUrl.pathname.startsWith(`${scopePath}ort/`)
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll([
          self.registration.scope,
          `${self.registration.scope}manifest.webmanifest`,
          `${self.registration.scope}icon.svg`,
          `${self.registration.scope}icon-192.png`,
          `${self.registration.scope}icon-512.png`,
          `${self.registration.scope}apple-touch-icon.png`,
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
            .filter((key) => key !== CACHE_NAME && key !== MODEL_CACHE_NAME)
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

  // Model weights and the WASM runtime are large and immutable per release:
  // cache-first so they only ever download once per device.
  if (isModelAsset(requestUrl)) {
    event.respondWith(
      caches.open(MODEL_CACHE_NAME).then((cache) =>
        cache.match(event.request).then(
          (cachedResponse) =>
            cachedResponse ??
            fetch(event.request).then((networkResponse) => {
              if (networkResponse.ok) {
                event.waitUntil(
                  cache.put(event.request, networkResponse.clone()),
                );
              }

              return networkResponse;
            }),
        ),
      ),
    );
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
      .catch(async () => {
        const cachedResponse = await caches.match(event.request);

        if (cachedResponse !== undefined) {
          return cachedResponse;
        }

        // Never answer a failed script, worker, stylesheet, or model request
        // with index.html: browsers interpret that as a broken module/chunk.
        // The application shell is only a valid offline fallback for a page
        // navigation.
        if (event.request.mode === "navigate") {
          return caches.match(self.registration.scope);
        }

        throw new Error(`Offline asset unavailable: ${requestUrl.pathname}`);
      }),
  );
});
