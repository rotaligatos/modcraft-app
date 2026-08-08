/* Modcraft Approvals — service worker.
 *
 * ⚠ THIS WORKER DELIBERATELY HAS NO `fetch` HANDLER, AND MUST NOT GAIN ONE.
 *
 * A service worker that caches responses would serve a stale index.html, and this app has
 * already been bitten twice by cached JS where a plain hard-refresh was not enough to clear it
 * (2026-07-02, and again 2026-08-08). A caching worker turns that from an occasional nuisance
 * into a permanent one: the fix ships, the browser keeps the old copy, and the user has no
 * obvious way out. GitHub Pages already serves these files with sensible caching.
 *
 * Its only jobs are to receive a push and to open the right request when the notification is
 * tapped. Registration is scoped to approve.html specifically, so even if this rule were ever
 * broken the main app would stay out of its reach.
 */
'use strict';

// Take over promptly so a newly-installed worker can receive pushes without waiting for every
// tab to close. Safe precisely because nothing is cached — there is no stale content to hand out.
self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function(event){
  var d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) {
    // A push that is not JSON still deserves to arrive rather than be swallowed.
    try { d = { body: event.data ? event.data.text() : '' }; } catch (e2) { d = {}; }
  }
  var title = d.title || 'Modcraft approval';
  var opts = {
    body: d.body || 'A request needs your decision.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    // Same tag per request id: a re-send REPLACES the old notification instead of stacking a
    // second copy of the same job on the lock screen.
    tag: d.reqId || 'modcraft-approval',
    renotify: true,
    requireInteraction: !!d.urgent,
    data: { url: d.url || './approve.html', reqId: d.reqId || '' }
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || './approve.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
      // Reuse a window that is already showing this request rather than opening a second one.
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf('approve.html') > -1 && 'focus' in c) {
          if ('navigate' in c && c.url.indexOf(target) === -1) { try { c.navigate(target); } catch (e) {} }
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
