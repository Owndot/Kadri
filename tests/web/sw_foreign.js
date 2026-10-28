// Service Worker einer fremden Webseite (Test): führt auf Zuruf eine Anfrage aus und meldet das Ergebnis.
// Seine Anfragen haben keinen Tab (wie Kadris eigene) – Kadris Schutzregeln dürfen sie trotzdem nicht berühren.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('message', (e) => {
  const { id, url, init } = e.data || {};
  fetch(url, Object.assign({ cache: 'no-store' }, init || {}))
    .then((r) => (r.type === 'opaque' ? 'opaque' : 'status ' + r.status), (err) => 'error ' + err.message)
    .then((res) => e.source.postMessage({ id, res }));
});
