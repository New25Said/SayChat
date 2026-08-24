// sw.js - Service Worker mínimo para habilitar Notificaciones Móviles y PWA
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    // Si usaras un servidor Push avanzado en el futuro, iría aquí.
    // Por ahora, usamos notificaciones locales desde app.js mediante el Service Worker.
});
