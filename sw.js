// sw.js - Service Worker nativo para Firebase Cloud Messaging
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyBz2zHkMLxDFwha_h51SjAoYzQtoUgqiiY",
    authDomain: "seichato.firebaseapp.com",
    projectId: "seichato",
    messagingSenderId: "141497749351",
    appId: "1:141497749351:web:163d6a94738bf5acdfe9c2"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || "SayChat";
    const options = {
        body: payload.notification?.body || "Tienes un nuevo mensaje",
        icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nI2U2MTk1NSc+PHBhdGggZD0nTTEyIDIyIEw3LjUgMTQuNSBMMTYuNSAxNC41IFonLz48cGF0aCBkPSdNMTEuMiAxMy41IEM1IDEyLjUgMi41IDUgMi41IDUgQzQuNSA5IDggMTAuNSAxMC44IDEyLjIgWicvPjxwYXRoIGQ9J00xMi44IDEzLjUgQzE5IDEyLjUgMjEuNSA1IDIxLjUgNSBDMTkuNSA5IDE2IDEwLjUgMTMuMiAxMi4yIFonLz48cGF0aCBkPSdNMTIgMTEuNSBMOC41IDYgTDEwLjUgNyBMMTIgMiBMMTMuNSA3IEwxNS41IDYgWicvPjwvc3ZnPg==",
        vibrate: [200, 100, 200],
        sound: "/noti.mp3"
    };
    self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            if (windowClients.length > 0) {
                windowClients[0].focus();
            } else {
                clients.openWindow('/');
            }
        })
    );
});
