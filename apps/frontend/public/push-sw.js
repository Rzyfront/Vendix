/**
 * Vendix Push Notification Service Worker
 *
 * Handles background push events and notification clicks.
 * Anti-spam: tag 'vendix-latest' ensures only the most recent notification is shown.
 */

self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : { title: "Vendix" };

  event.waitUntil(
    self.registration.showNotification(payload.title || "Vendix", {
      body: payload.body || "",
      icon: "/vlogo.png",
      tag: "vendix-latest",
      renotify: true,
      data: payload.data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route =
    event.notification.data?.route || event.notification.data?.url || "/";
  const target_url =
    typeof route === "string" &&
    route.startsWith("/") &&
    !route.startsWith("//")
      ? new URL(route, self.location.origin).href
      : new URL("/", self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((client_list) => {
        for (const client of client_list) {
          if (new URL(client.url).origin !== self.location.origin) continue;
          if ("navigate" in client && client.url !== target_url) {
            return client.navigate(target_url).then((navigated_client) => {
              return navigated_client?.focus();
            });
          }
          if ("focus" in client) return client.focus();
        }
        return clients.openWindow(target_url);
      }),
  );
});
