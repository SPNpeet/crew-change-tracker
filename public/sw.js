const CACHE = 'cct-shell-v1';
const SHELL = ['/', '/app.css', '/app2.css', '/fonts/fonts.css', '/js/app.js', '/js/api.js', '/js/core.js', '/js/ui.js',
  '/js/views/auth.js', '/js/views/jobs.js', '/js/views/office.js', '/js/views/field.js', '/js/views/owner.js', '/js/views/admin.js', '/js/views/report.js',
  '/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && (SHELL.includes(url.pathname) || url.pathname.startsWith('/fonts/'))) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('/') : Response.error())))
  );
});
