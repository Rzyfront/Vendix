/**
 * Vendix Push Notification Service Worker
 *
 * Handles background push events and notification clicks.
 * Anti-spam: tag 'vendix-latest' ensures only the most recent notification is shown.
 */

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : { title: 'Vendix' };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Vendix', {
      body: payload.body || '',
      icon: '/vlogo.png',
      tag: 'vendix-latest',
      renotify: true,
      data: payload.data,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((client_list) => {
      for (const client of client_list) {
        if ('focus' in client) return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});
