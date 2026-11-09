// The service worker of Cockpit (decision 072): pushes and their buttons, and the last answers kept for when the server does not answer.
// shortcut: the cache is never trimmed (one entry per address visited), upgrade when it grows. Its name is also in Shell.tsx (logout empties it).
const CACHE = "cockpit-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  const message = event.data?.json();
  if (!message) return;
  const { title, body, url, actions } = message;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      data: { url },
      actions,
    }),
  );
});

// A tap opens the page, or focuses it when it is already open.
async function open(path) {
  const href = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const there = windows.find((w) => w.url === href);
  return there ? there.focus() : self.clients.openWindow(href);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url } = event.notification.data;
  if (!event.action) return event.waitUntil(open(url));
  // A button is `<question id>:<answer>` (decision 072 G): the answer goes with the session cookie, without opening Cockpit; if it fails, the page opens.
  const [id, ...answer] = event.action.split(":");
  event.waitUntil(
    fetch(`/api/questions/${id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer: answer.join(":") }),
    })
      .then((res) => (res.ok ? undefined : open(url)))
      .catch(() => open(url)),
  );
});

// Network first, the last good answer when the network fails (decision 072 I). Never /api/health nor /api/events: the page must see the cut itself.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const { origin, pathname } = new URL(request.url);
  if (
    request.method !== "GET" ||
    origin !== self.location.origin ||
    pathname === "/api/health" ||
    pathname === "/api/events"
  )
    return;
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(
            caches.open(CACHE).then((cache) => cache.put(request, copy)),
          );
        }
        return res;
      })
      .catch(async () => (await caches.match(request)) ?? Response.error()),
  );
});
