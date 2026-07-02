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

// ==========================================================================
// MÓDULO SUBSISTEMA DE NOTIFICACIONES REALES Y BURBUJAS EN PESTAÑA
// ==========================================================================
const NotificationSystem = {
    trigger() {
        const sound = document.getElementById('noti-sound');
        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(e => console.log("Audio en espera de interacción de usuario."));
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
        // Subsistema dinámico de burbuja roja en la pestaña usando Canvas
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
        // Quitar de online al cerrar pestaña de forma nativa en la nube
        const presenceRef = ref(db, `presence/${userKey}`);
        window.addEventListener('beforeunload', () => set(presenceRef, { online: false, lastSeen: Date.now() }));
    },
    setOffline(userKey) {
        if (!userKey) return;
        set(ref(db, `presence/${userKey}`), { online: false, lastSeen: Date.now() });
    },
    listenPresence() {
        onValue(ref(db, 'presence'), async (snapshot) => {
            document.getElementById('users-connected-list').innerHTML = "";
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
// 4. MÓDULO DE SERVICIOS (FIREBASE & AUTENTICACIÓN AVANZADA)
// ==========================================================================
const AuthService = {
    async register(name, nickname, password, avatarBase64) {
        // Filtro estricto solicitado: No espacios, no mayúsculas
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
        
        return userData;
    }
};

const ChatService = {
    sendMessage(userKey, message, type = 'text', stickerUrl = '') {
        push(ref(db, 'messages'), {
            userKey: userKey,
            message: message,
            type: type,
            stickerUrl: stickerUrl,
            timestamp: Date.now()
        });
    },

    listenMessages(callback) {
        let initialLoad = true;
        // Evitamos disparar notificaciones masivas de mensajes históricos al iniciar la app
        setTimeout(() => { initialLoad = false; }, 2000);

        onChildAdded(ref(db, 'messages'), async (snapshot) => {
            const data = snapshot.val();
            const authorSnap = await get(child(dbRef, `users/${data.userKey}`));
            let authorData = { name: "Usuario", nickname: "@unknown", avatar: "" };
            
            if (authorSnap.exists()) authorData = authorSnap.val();
            
            const isMe = currentUser && authorData.nickname.toLowerCase() === currentUser.nickname.toLowerCase();
            
            if (!initialLoad && !isMe) {
                NotificationSystem.trigger();
            }
            callback(data, authorData, isMe);
        });
    }
};

const StickerService = {
    uploadSticker(base64) {
        push(ref(db, 'stickers'), { base64: base64 });
    },
    listenStickers(callback) {
        onChildAdded(ref(db, 'stickers'), (snapshot) => {
            callback(snapshot.val().base64);
        });
    }
};

// ==========================================================================
// 5. LISTENERS DE ACCIÓN COMPLETA
// ==========================================================================

document.getElementById('toggle-sidebar-btn').addEventListener('click', () => UI.toggleSidebar());
document.getElementById('go-to-register').addEventListener('click', () => UI.switchAuthMode('register'));
document.getElementById('go-to-login').addEventListener('click', () => UI.switchAuthMode('login'));

// Tabs de Navegación en Barra Lateral
document.getElementById('btn-nav-global').addEventListener('click', (e) => {
    document.getElementById('btn-nav-global').classList.add('active');
    document.getElementById('btn-nav-users').classList.remove('active');
    document.getElementById('settings-area').classList.remove('hidden');
    document.getElementById('users-list-area').classList.add('hidden');
});

document.getElementById('btn-nav-users').addEventListener('click', (e) => {
    document.getElementById('btn-nav-users').classList.add('active');
    document.getElementById('btn-nav-global').classList.remove('active');
    document.getElementById('settings-area').classList.add('hidden');
    document.getElementById('users-list-area').classList.remove('hidden');
});

// Manejo de Fotos e inputs
document.getElementById('reg-avatar').addEventListener('change', (e) => {
    if (e.target.files[0]) {
        UI.utils.getBase64(e.target.files[0], (base64) => {
            tempRegisterAvatar = base64;
            const preview = document.getElementById('reg-preview');
            preview.src = base64; preview.classList.remove('hidden');
        });
    }
});

// EVENTO: EDITAR FOTO SOBRE LA PROPIA IMAGEN EN VIVO
document.getElementById('edit-avatar').addEventListener('change', (e) => {
    if (e.target.files[0] && currentUser) {
        UI.utils.getBase64(e.target.files[0], async (base64) => {
            const userKey = currentUser.nickname.replace('@', '');
            await update(ref(db, `users/${userKey}`), { avatar: base64 });
            currentUser.avatar = base64;
            localStorage.setItem('chat_session_v4', JSON.stringify(currentUser));
            document.getElementById('current-user-avatar').src = base64;
            NotificationSystem.showLocalToast("Avatar actualizado");
        });
    }
});

// EVENTO IN-LINE: DAR CLICK AL NOMBRE PARA EDITAR CON ENTER
const userNameElement = document.getElementById('current-user-name');
const editNameInput = document.getElementById('edit-name-input');

userNameElement.addEventListener('click', () => {
    editNameInput.value = userNameElement.textContent;
    userNameElement.classList.add('hidden');
    editNameInput.classList.remove('hidden');
    editNameInput.focus();
});

editNameInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
        const val = editNameInput.value.trim();
        if (val.length >= 3 && val.length <= 50 && currentUser) {
            const userKey = currentUser.nickname.replace('@', '');
            await update(ref(db, `users/${userKey}`), { name: val });
            currentUser.name = val;
            localStorage.setItem('chat_session_v4', JSON.stringify(currentUser));
            userNameElement.textContent = val;
            NotificationSystem.showLocalToast("Nombre cambiado");
        } else {
            alert("El nombre debe tener entre 3 y 50 letras.");
        }
        editNameInput.classList.add('hidden');
        userNameElement.classList.remove('hidden');
    }
});

// ENVIAR MENSAJES
const triggerSend = () => {
    const msg = UI.inputs.message.value.trim();
    if (msg && currentUser) {
        ChatService.sendMessage(currentUser.nickname.replace('@', ''), msg);
        UI.inputs.message.value = '';
    }
};
document.getElementById('btn-send-message').addEventListener('click', triggerSend);
UI.inputs.message.addEventListener('keydown', (e) => { if (e.key === 'Enter') triggerSend(); });

// ACCIONES DE REGISTRO / LOGIN
document.getElementById('btn-register-submit').addEventListener('click', async () => {
    const name = document.getElementById('reg-name').value.trim();
    const nickname = document.getElementById('reg-nickname').value.trim();
    const password = document.getElementById('reg-password').value;
    if (!tempRegisterAvatar) return alert("Sube un avatar.");

    try {
        currentUser = await AuthService.register(name, nickname, password, tempRegisterAvatar);
        localStorage.setItem('chat_session_v4', JSON.stringify(currentUser));
        PresenceSystem.setOnline(currentUser.nickname.replace('@', ''));
        UI.showChat(currentUser);
        location.reload();
    } catch (err) {
        if (err.message === "VALIDATION_FAILED") alert("El Username/ID no puede contener mayúsculas ni espacios.");
        else if (err.message === "LEN_USER_ERROR") alert("El Username/ID debe tener entre 4 y 15 letras.");
        else if (err.message === "LEN_NICK_ERROR") alert("Tu nombre real debe tener entre 3 y 50 letras.");
        else alert("ID en uso.");
    }
});

document.getElementById('btn-login-submit').addEventListener('click', async () => {
    const nickname = document.getElementById('login-nickname').value.trim();
    const password = document.getElementById('login-password').value;

    try {
        currentUser = await AuthService.login(nickname, password);
        localStorage.setItem('chat_session_v4', JSON.stringify(currentUser));
        PresenceSystem.setOnline(currentUser.nickname.replace('@', ''));
        UI.showChat(currentUser);
        location.reload();
    } catch (err) { alert("Credenciales incorrectas."); }
});

// STICKERS COMPACTOS SUBIDA Y ENVÍO
document.getElementById('btn-toggle-stickers').addEventListener('click', () => {
    document.getElementById('stickers-panel').classList.toggle('hidden');
});

document.getElementById('upload-sticker-input').addEventListener('change', (e) => {
    if (e.target.files[0]) {
        UI.utils.getBase64(e.target.files[0], (base64) => {
            StickerService.uploadSticker(base64);
            NotificationSystem.showLocalToast("Sticker añadido");
        });
    }
});

StickerService.listenStickers((base64) => {
    const grid = document.getElementById('stickers-grid');
    const img = document.createElement('img');
    img.src = base64;
    img.classList.add('grid-stk-img');
    img.addEventListener('click', () => {
        if (currentUser) {
            ChatService.sendMessage(currentUser.nickname.replace('@', ''), '[Sticker]', 'sticker', base64);
            document.getElementById('stickers-panel').classList.add('hidden');
        }
    });
    grid.appendChild(img);
});

// LOGOUT
document.getElementById('logout-btn').addEventListener('click', () => {
    if (currentUser) PresenceSystem.setOffline(currentUser.nickname.replace('@', ''));
    localStorage.removeItem('chat_session_v4');
    location.reload();
});

// TEMAS
document.querySelectorAll('[data-set-theme]').forEach(dot => {
    dot.addEventListener('click', (e) => {
        document.body.setAttribute('data-theme', e.target.getAttribute('data-set-theme'));
        document.querySelectorAll('.theme-circle').forEach(d => d.classList.remove('active'));
        e.target.classList.add('active');
    });
});

// INICIALIZACIÓN CORE
ChatService.listenMessages((data, authorData, isMe) => UI.renderMessage(data, authorData, isMe));

const saved = localStorage.getItem('chat_session_v4');
if (saved) {
    currentUser = JSON.parse(saved);
    PresenceSystem.setOnline(currentUser.nickname.replace('@', ''));
    PresenceSystem.listenPresence();
    UI.showChat(currentUser);
}
