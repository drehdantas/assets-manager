/* Assets Manager service worker — caches the app shell so it works offline. Bump VERSION on every release. */
const VERSION = 'am-v2.0.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './vendor/mp4-muxer.js', './vendor/webm-muxer.js',
  './js/core.js', './js/storage.js', './js/player.js', './js/media.js', './js/app.js', './js/tools.js', './js/trim_batch.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png'
];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // network first for navigation (get updates), cache first for static files
    if (req.mode === 'navigate') { e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put('./index.html', c)); return r; }).catch(() => caches.match('./index.html'))); return; }
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); return r; })));
  } else if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); return r; }).catch(() => hit)));
  }
});
