// Generated from sw.template.js by scripts/publish.sh. Edit the template, not this file.
// Source for sw.js, the worker that keeps a copy of the app on the device so it opens with no signal.
// scripts/publish.sh copies this file to sw.js with the two placeholders filled in. A new BUILD on
// every publish is what makes each device fetch the new files the next time it is online.

const BUILD = 'dev';
const FILES = ['./', 'css/app.css', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg', 'index.html', 'js/main.js', 'js/model.js', 'js/sample.js', 'js/store.js', 'js/theme.js', 'js/ui/dom.js', 'js/ui/editor.js', 'js/ui/home.js', 'js/ui/recipe.js', 'js/ui/settings.js', 'js/ui/state.js', 'js/version.js', 'manifest.webmanifest', 'proofs/timer.html'];
const CACHE = 'recipes-' + BUILD;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('recipes-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match('index.html'))));
});
