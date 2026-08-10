/* Modcraft Approvals — service worker.
 *
 * ⚠ THIS WORKER MUST NEVER CACHE ANYTHING. Read the fetch handler before touching it.
 *
 * A worker that caches responses would serve a stale approve.html, and this app has twice been
 * bitten by cached JS that a plain hard-refresh could not clear (2026-07-02, 2026-08-08). Caching
 * turns that from an occasional nuisance into a permanent trap: the fix ships, the browser keeps
 * the old copy, and the user has no obvious way out. GitHub Pages already handles caching.
 *
 * There IS a fetch handler, and it exists only because Chrome will not offer to install the app
 * without one — verified: with no handler, beforeinstallprompt never fired. It always goes to the
 * network and stores nothing; its sole extra behaviour is a plain "you are offline" page when a
 * NAVIGATION genuinely fails. No cache is opened anywhere in this file, and none should be.
 *
 * Its other jobs are to receive a push and to open the right request when the notification is
 * tapped.
 *
 * SCOPE — this file now serves TWO registrations, deliberately:
 *   ./approve.html  (from approve.html)  — narrower, so it wins for that path. Push subscriptions
 *                                          are bound to it; do not disturb it.
 *   ./              (from index.html)    — makes the whole app installable, which is what lets us
 *                                          leave the Google Sites embed behind.
 * Nothing here is path-specific except the notification target, so one file serving both is safe.
 * It caches nothing either way, which is what makes overlapping scopes harmless.
 */
'use strict';

// Take over promptly so a newly-installed worker can receive pushes without waiting for every
// tab to close. Safe precisely because nothing is cached — there is no stale content to hand out.
self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });

// Network-only, with a plain notice if a page navigation fails outright.
// NOTHING IS CACHED — caches.open() appears nowhere in this file and must not be added. Assets
// are passed straight through untouched, so a deployed fix is picked up on the next load exactly
// as it would be without a worker.
var OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>Offline</title>'+
  '<body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b1220;'+
  'color:#e5e9f0;font:15px/1.5 -apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif">'+
  '<div style="text-align:center;padding:24px">'+
  '<div style="font-size:18px;font-weight:600;margin-bottom:6px">No connection</div>'+
  '<div style="color:#9aa5b5">Modcraft reads and writes live — quotations, orders and approval '+
  'figures all come from the database, so there is nothing useful to show offline. Reconnect and '+
  'reload.</div></div>';

self.addEventListener('fetch', function(event){
  // Only navigations. Assets are left entirely alone.
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(function(){
      return new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    })
  );
});

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
