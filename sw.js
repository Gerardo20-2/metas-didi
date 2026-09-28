/* Service Worker de DiDi Analytics & Tracker.
   - Precarga el "app shell" al instalarse: la app abre sin conexión.
   - Stale-while-revalidate: responde al instante desde caché y actualiza en segundo plano,
     así la siguiente apertura ya trae la versión nueva.
   - El despliegue sustituye __BUILD_ID__ por el SHA del commit: cada versión usa su propia
     caché y la anterior se borra al activarse. */
const BUILD_ID = '__BUILD_ID__';
const CACHE = `didi-tracker-${BUILD_ID}`;

const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './css/styles.css',
    './js/app.js',
    './js/vendor/react.production.min.js',
    './js/vendor/react-dom.production.min.js',
    './icons/icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png',
    './icons/apple-touch-icon.png',
    './icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'reload' }))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys
                .filter(key => key.startsWith('didi-tracker-') && key !== CACHE)
                .map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        /* Las navegaciones (con o sin ?query) se sirven con el index precargado */
        const key = request.mode === 'navigate' ? './index.html' : request;
        const cached = await cache.match(key, { ignoreSearch: request.mode === 'navigate' });

        const network = fetch(request)
            .then(response => {
                if (response && response.ok && response.type === 'basic') {
                    cache.put(key, response.clone());
                }
                return response;
            })
            .catch(() => null);

        if (cached) {
            event.waitUntil(network);
            return cached;
        }
        const fresh = await network;
        return fresh || new Response('Sin conexión', { status: 503, statusText: 'Offline' });
    })());
});
