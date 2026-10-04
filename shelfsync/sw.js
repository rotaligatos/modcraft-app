// ShelfSync moved to https://rotaligatos.github.io/shelfsync/ (2026-10-04).
// This replaces the old background worker on any device that still has it: it takes over, removes
// itself, and reloads open ShelfSync windows so they reach the new address. It handles no requests
// and deletes no stored data (the new app at the new address uses the same browser storage).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil(self.registration.unregister()
    .then(() => self.clients.matchAll({ type: "window" }))
    .then(list => Promise.all(list.map(c => c.navigate(c.url).catch(() => {}))))
    .catch(() => {}));
});
