import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, push, onChildAdded, get, child, set, update, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// ==========================================================================
// 1. CONFIGURACIÓN E INICIALIZACIÓN
// ==========================================================================
const firebaseConfig = {
    apiKey: "AIzaSyBz2zHkMLxDFwha_h51SjAoYzQtoUgqiiY",
    authDomain: "seichato.firebaseapp.com",
    databaseURL: "https://seichato-default-rtdb.firebaseio.com",
    projectId: "seichato",
    storageBucket: "seichato.firebasestorage.app",
    messagingSenderId: "141497749351",
    appId: "1:141497749351:web:163d6a94738bf5acdfe9c2",
    measurementId: "G-9635Z02KGL"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const dbRef = ref(db);

let currentUser = null;
let unreadCount = 0;
let baseTitle = "SayChat";
let originalFavicon = null;
let tempRegisterAvatar = "";
let tempEditAvatar = "";

// Función helper global para la conversión segura de imágenes
const convertFileToBase64 = (file, callback) => {
    const reader = new FileReader();
    reader.onloadend = () => callback(reader.result);
    reader.readAsDataURL(file);
};

// ==========================================================================
// MÓDULO SUBSISTEMA DE NOTIFICACIONES REALES Y BURBUJAS EN PESTAÑA
// ==========================================================================
const NotificationSystem = {
    trigger() {
        const sound = document.getElementById('noti-sound');
        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(e => console.log("Audio en espera de interacción."));
        }
        
        if (!document.hasFocus()) {
            unreadCount++;
            document.title = `(${unreadCount}) ${baseTitle}`;
            this.updateFaviconBadge();
        }
    },
    reset() {
        unreadCount = 0;
        document.title = baseTitle;
        this.restoreFavicon();
    },
    updateFaviconBadge() {
        if (!originalFavicon) {
            const currentFav = document.querySelector("link[rel*='icon']");
            originalFavicon = currentFav ? currentFav.href : "";
        }
        const canvas = document.createElement('canvas');
        canvas.width = 32; canvas.height = 32;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#ff2a5f';
        ctx.beginPath();
        ctx.arc(16, 16, 14, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(unreadCount > 9 ? '9+' : unreadCount, 16, 16);
        
        let link = document.querySelector("link[rel*='icon']");
        if (!link) {
            link = document.createElement('link');
            link.rel = 'shortcut icon';
            document.getElementsByTagName('head')[0].appendChild(link);
        }
        link.href = canvas.toDataURL();
    },
    restoreFavicon() {
        if (originalFavicon) {
            const link = document.querySelector("link[rel*='icon']");
            if (link) link.href = originalFavicon;
        }
    },
    showLocalToast(text) {
        const toast = document.getElementById('toast-notification');
        toast.textContent = text;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 2000);
    }
};

window.addEventListener('focus', () => NotificationSystem.reset());

// ==========================================================================
// 2. MÓDULO DE INTERFAZ DE USUARIO (UI CONTROLLER)
// ==========================================================================
const UI = {
    screens: {
        auth: document.getElementById('auth-screen'),
        chat: document.getElementById('chat-screen'),
        loginArea: document.getElementById('login-area'),
        registerArea: document.getElementById('register-area'),
        sidebar: document.getElementById('sidebar-panel')
    },
    inputs: {
        message: document.getElementById('message-input'),
        chatBox: document.getElementById('chat-box')
    },

    switchAuthMode(mode) {
        if (mode === 'register') {
            this.screens.loginArea.classList.add('hidden');
            this.screens.registerArea.classList.remove('hidden');
        } else {
            this.screens.registerArea.classList.add('hidden');
            this.screens.loginArea.classList.remove('hidden');
        }
    },

    showChat(user) {
        this.screens.auth.classList.add('hidden');
        this.screens.chat.classList.remove('hidden');
        
        document.getElementById('current-user-avatar').src = user.avatar;
        document.getElementById('current-user-name').textContent = user.name;
        document.getElementById('current-user-nickname').textContent = user.nickname;
    },

    toggleSidebar() {
        this.screens.sidebar.classList.toggle('collapsed');
    },

    renderMessage(data, authorData, isMe) {
        const msgRow = document.createElement('div');
        msgRow.classList.add('msg-row');
        if (isMe) msgRow.classList.add('msg-row-me');

        const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        let contentHTML = `<p class="msg-body">${data.message}</p>`;
        if (data.type === 'sticker') {
            contentHTML = `<img src="${data.stickerUrl}" class="msg-sticker" alt="Sticker">`;
        }

        msgRow.innerHTML = `
            <img src="${authorData.avatar || ''}" class="msg-img custom-avatar" alt="Avatar">
            <div class="msg-bubble">
                <div class="msg-meta">
                    <span class="meta-name">${authorData.name}</span>
                    <span class="meta-nick">${authorData.nickname}</span>
                </div>
                ${contentHTML}
                <span class="msg-time">${time}</span>
            </div>
        `;

        this.inputs.chatBox.appendChild(msgRow);
        this.inputs.chatBox.scrollTop = this.inputs.chatBox.scrollHeight;
    },

    renderUserRow(user, isOnline) {
        const list = document.getElementById('users-connected-list');
        const row = document.createElement('div');
        row.classList.add('user-status-row');
        row.innerHTML = `
            <span class="status-indicator-dot ${isOnline ? 'online' : ''}"></span>
            <span style="font-weight: 500;">${user.name}</span>
            <span style="font-size:10px; color:var(--text-muted)">${user.nickname}</span>
        `;
        list.appendChild(row);
    }
};

// ==========================================================================
// 3. PRESENCIA DE USUARIOS ACTIVA (ESTILO DISCORD)
// ==========================================================================
const PresenceSystem = {
    setOnline(userKey) {
        if (!userKey) return;
        set(ref(db, `presence/${userKey}`), { online: true, lastSeen: Date.now() });
        const presenceRef = ref(db, `presence/${userKey}`);
        window.addEventListener('beforeunload', () => set(presenceRef, { online: false, lastSeen: Date.now() }));
    },
    setOffline(userKey) {
        if (!userKey) return;
        set(ref(db, `presence/${userKey}`), { online: false, lastSeen: Date.now() });
    },
    listenPresence() {
        onValue(ref(db, 'presence'), async (snapshot) => {
            const listContainer = document.getElementById('users-connected-list');
            if (!listContainer) return;
            listContainer.innerHTML = "";
            const presenceData = snapshot.val() || {};
            
            const usersSnap = await get(child(dbRef, 'users'));
            if (usersSnap.exists()) {
                const allUsers = usersSnap.val();
                Object.keys(allUsers).forEach(key => {
                    const user = allUsers[key];
                    const isOnline = presenceData[key] && presenceData[key].online === true;
                    UI.renderUserRow(user, isOnline);
                });
            }
        });
    }
};

// ==========================================================================
// 4. MÓDULO DE SERVICIOS (FIREBASE & AUTENTICACIÓN)
// ==========================================================================
const AuthService = {
    async register(name, nickname, password, avatarBase64) {
        const cleanNick = nickname.trim();
        if (/[A-Z\s]/.test(cleanNick)) {
            throw new Error("VALIDATION_FAILED");
        }
        if (cleanNick.length < 4 || cleanNick.length > 15) throw new Error("LEN_USER_ERROR");
        if (name.length < 3 || name.length > 50) throw new Error("LEN_NICK_ERROR");

        const snapshot = await get(child(dbRef, `users/${cleanNick}`));
        if (snapshot.exists()) throw new Error("ID_EXISTENTE");

        const userData = { name, nickname: '@' + cleanNick, password, avatar: avatarBase64 };
        await set(ref(db, `users/${cleanNick}`), userData);
        return userData;
    },

    async login(nickname, password) {
        const cleanNick = nickname.replace('@', '').toLowerCase().trim();
        const snapshot = await get(child(dbRef, `users/${cleanNick}`));

        if (!snapshot.exists()) throw new Error("USER_NOT_FOUND");
        
        const userData = snapshot.val();
        if (userData.password !== password) throw new Error("INVALID_PASSWORD");
