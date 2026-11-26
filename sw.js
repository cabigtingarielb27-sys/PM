// PadalaPay service worker — offline app shell + Web Push delivery.
//
// Offline: navigations are network-first with a cached app-shell fallback, and
// same-origin static assets use stale-while-revalidate. This lets the installed
// app open and browse cached data with no connection. Data still comes from the
// live backend when online; nothing here fakes server responses.
//
// Push: a native tray notification is shown via self.registration.showNotification
// so alerts land even when the app is fully closed or the device is locked.
// Foreground: also broadcast to the app for a tappable in-app toast. A system
// notification is always displayed to honor the userVisibleOnly push contract.

const PUSH_CHANNEL = "padalapay-push";
const APP_ICON =
  "https://media.base44.com/images/public/6ae33e133c707cd42b242cb3/5cb05c5c1_GlossyBlueWalletPaymentIcon.png";
const SHELL_CACHE = "padalapay-shell-v1";
const ASSET_CACHE = "padalapay-assets-v1";
const NAV_FALLBACK = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.add(NAV_FALLBACK).catch(() => {});
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Navigations: network-first, fall back to the cached app shell so the app
  // opens offline and hydrates from IndexedDB.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put(NAV_FALLBACK, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const cached = await cache.match(NAV_FALLBACK);
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  // Same-origin static assets: stale-while-revalidate (offline-capable).
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((fresh) => {
            cache.put(req, fresh.clone()).catch(() => {});
            return fresh;
          })
          .catch(() => null);
        return cached || (await network) || Response.error();
      })(),
    );
  }
});

async function broadcastPush(message) {
  try {
    const channel = new BroadcastChannel(PUSH_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {}
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "PadalaPay", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "PadalaPay";
  const body = data.body || "";
  const url = data.url || data.link || "/dashboard";
  const tag = data.tag || `pp-${Date.now()}`;
  const basic = { body, icon: APP_ICON, badge: APP_ICON, data: { url }, tag };

  event.waitUntil((async () => {
    try {
      try {
        await self.registration.showNotification(title, {
          ...basic, image: data.image || undefined,
          vibrate: [60, 30, 60], requireInteraction: false,
          actions: data.actions || [{ action: "open", title: "Open" }],
        });
      } catch {
        await self.registration.showNotification(title, basic);
      }
    } catch (error) {
      if (data.testId) await broadcastPush({ type: "push-status", testId: data.testId, shown: false, error: error.message || "The device blocked notification display." });
      throw error;
    }
    if (data.testId) await broadcastPush({ type: "push-status", testId: data.testId, shown: true });
    await broadcastPush({ type: "push", payload: { title, body, url, type: data.type || "system" } });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action && event.action !== "open") return;
  const url = event.notification.data?.url || "/dashboard";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          if (url !== "/dashboard") {
            try { await client.navigate(url); } catch {}
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
