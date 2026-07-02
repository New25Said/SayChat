import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, push, onChildAdded, get, child, set, update, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// ==========================================================================
// CONFIGURACIÓN DE FIREBASE
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

// Convertidor Helper Global de Imagenes
const imageToConvert64 = (file, callback) => {
    const reader = new FileReader();
    reader.onloadend = () => callback(reader.result);
    reader.readAsDataURL(file);
};

// ==========================================================================
// NOTIFICACIONES Y CANVAS PESTAÑA
// ==========================================================================
const NotificationSystem = {
    trigger() {
        const sound = document.getElementById('noti-sound');
        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(() => {});
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
// CONTROLADORES DE INTERFAZ (UI)
// ==========================================================================
const UI = {
    screens: {
        auth: document.getElementById('auth-screen'),
        chat: document.getElementById('chat-screen'),
        loginArea: document.getElementById('login-area'),
        registerArea: document.getElementById('register-area'),
        sidebar: document.getElementById('sidebar-panel')
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

        const box = document.getElementById('chat-box');
        box.appendChild(msgRow);
        box.scrollTop = box.scrollHeight;
    },
    renderUserRow(user, isOnline) {
        const list = document.getElementById('users-connected-list');
        const row = document.createElement('div');
        row.classList.add('user-status-row');
        row.innerHTML = `
            <span class="status-indicator-dot ${isOnline ? 'online' : ''}"></span>
            <span style="font-weight: 500;">${user.name}</span>
            <span style="font-size:10px; color:var(--text-muted); margin-left:4px;">${user.nickname}</span>
        `;
        list.appendChild(row);
    }
};

// ==========================================================================
// PRESENCIA DE USUARIOS (ESTILO DISCORD)
// ==========================================================================
const PresenceSystem = {
    setOnline(userKey) {
        if (!userKey) return;
        set(ref(db, `presence/${userKey}`), { online: true, lastSeen: Date.now() });
        window.addEventListener('beforeunload', () => set(ref(db, `presence/${userKey}`), { online: false, lastSeen: Date.now() }));
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
// EVENTOS Y ENLACES DIRECTOS DE ACCIÓN (MANUAL CLICKS)
// ==========================================================================

// Cambios de pantallas de login/registro
document.getElementById('go-to-register').addEventListener('click', () => UI.switchAuthMode('register'));
document.getElementById('go-to-login').addEventListener('click', () => UI.switchAuthMode('login'));
document.getElementById('toggle-sidebar-btn').addEventListener('click', () => UI.screens.sidebar.classList.toggle('collapsed'));

// Subpestañas Barra lateral
document.getElementById('btn-nav-global').addEventListener('click', () => {
    document.getElementById('btn-nav-global').classList.add('active');
    document.getElementById('btn-nav-users').classList.remove('active');
    document.getElementById('settings-area').classList.remove('hidden');
    document.getElementById('users-list-area').classList.add('hidden');
});

document.getElementById('btn-nav-users').addEventListener('click', () => {
    document.getElementById('btn-nav-users').classList.add('active');
    document.getElementById('btn-nav-global').classList.remove('active');
    document.getElementById('settings-area').classList.add('hidden');
    document.getElementById('users-list-area').classList.remove('hidden');
});

// Carga de imágenes en registro
document.getElementById('reg-avatar').addEventListener('change', (e) => {
    if (e.target.files[0]) {
        imageToConvert64(e.target.files[0], (base64) => {
            tempRegisterAvatar = base64;
            const preview = document.getElementById('reg-preview');
            preview.src = base64; 
            preview.classList.remove('hidden');
            document.getElementById('label-reg-avatar').textContent = "Foto Lista ✓";
        });
    }
});

// BOTÓN ACCIÓN: REGISTRARSE
document.getElementById('btn-register-submit').addEventListener('click', async () => {
    const name = document.getElementById('reg-name').value.trim();
    const nickname = document.getElementById('reg-nickname').value.trim();
    const password = document.getElementById('reg-password').value;

    if (!name || !nickname || !password || !tempRegisterAvatar) {
        alert("Completa todos los datos y selecciona una foto.");
        return;
    }

    // Validaciones de límites solicitadas
    if (/[A-Z\s]/.test(nickname)) return alert("El Username/ID no puede contener mayúsculas ni espacios.");
    if (nickname.length < 4 || nickname.length > 15) return alert("El Username/ID debe tener entre 4 y 15 caracteres.");
    if (name.length < 3 || name.length > 50) return alert("Tu nombre debe tener entre 3 y 50 caracteres.");

    try {
        const snapshot = await get(child(dbRef, `users/${nickname}`));
        if (snapshot.exists()) return alert("Este Username/ID ya está ocupado.");

        const userData = { name, nickname: '@' + nickname, password, avatar: tempRegisterAvatar };
        await set(ref(db, `users/${nickname}`), userData);

        currentUser = userData;
        localStorage.setItem('chat_session_v5', JSON.stringify(currentUser));
        PresenceSystem.setOnline(nickname);
        UI.showChat(currentUser);
        location.reload();
    } catch (err) { alert("Error de registro."); }
});

// BOTÓN ACCIÓN: INICIAR SESIÓN
document.getElementById('btn-login-submit').addEventListener('click', async () => {
    const nickname = document.getElementById('login-nickname').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;

    if (!nickname || !password) return alert("Rellena las credenciales.");

    try {
        const snapshot = await get(child(dbRef, `users/${nickname}`));
        if (!snapshot.exists()) return alert("El usuario no existe.");

        const userData = snapshot.val();
        if (userData.password !== password) return alert("Contraseña incorrecta.");

        currentUser = userData;
        localStorage.setItem('chat_session_v5', JSON.stringify(currentUser));
        PresenceSystem.setOnline(nickname);
        UI.showChat(currentUser);
        location.reload();
    } catch (err) { alert("Error al entrar."); }
});

// ACCIÓN: CAMBIAR FOTO EN VIVO
document.getElementById('edit-avatar').addEventListener('change', (e) => {
    if (e.target.files[0] && currentUser) {
        imageToConvert64(e.target.files[0], async (base64) => {
            const userKey = currentUser.nickname.replace('@', '');
            await update(ref(db, `users/${userKey}`), { avatar: base64 });
            currentUser.avatar = base64;
            localStorage.setItem('chat_session_v5', JSON.stringify(currentUser));
            document.getElementById('current-user-avatar').src = base64;
            NotificationSystem.showLocalToast("Avatar actualizado");
        });
    }
});

// ACCIÓN IN-LINE: EDITAR NOMBRE CON UN CLICK Y ENTER
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
            localStorage.setItem('chat_session_v5', JSON.stringify(currentUser));
            userNameElement.textContent = val;
            NotificationSystem.showLocalToast("Nombre cambiado");
        } else { alert("Debe tener entre 3 y 50 letras."); }
        editNameInput.classList.add('hidden');
        userNameElement.classList.remove('hidden');
    }
});

// ENVIAR MENSAJES Y STICKERS
const executeMessageSend = () => {
    const input = document.getElementById('message-input');
    const msg = input.value.trim();
    if (msg && currentUser) {
        const userKey = currentUser.nickname.replace('@', '');
        push(ref(db, 'messages'), { userKey, message: msg, type: 'text', timestamp: Date.now() });
        input.value = '';
    }
};

document.getElementById('btn-send-message').addEventListener('click', executeMessageSend);
document.getElementById('message-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') executeMessageSend(); });

document.getElementById('btn-toggle-stickers').addEventListener('click', () => {
    document.getElementById('stickers-panel').classList.toggle('hidden');
});

document.getElementById('upload-sticker-input').addEventListener('change', (e) => {
    if (e.target.files[0]) {
        imageToConvert64(e.target.files[0], (base64) => {
            push(ref(db, 'stickers'), { base64 });
            NotificationSystem.showLocalToast("Sticker añadido");
        });
    }
});

onChildAdded(ref(db, 'stickers'), (snapshot) => {
    const base64 = snapshot.val().base64;
    const grid = document.getElementById('stickers-grid');
    const img = document.createElement('img');
    img.src = base64;
    img.classList.add('grid-stk-img');
    img.addEventListener('click', () => {
        if (currentUser) {
            const userKey = currentUser.nickname.replace('@', '');
            push(ref(db, 'messages'), { userKey, message: '[Sticker]', type: 'sticker', stickerUrl: base64, timestamp: Date.now() });
            document.getElementById('stickers-panel').classList.add('hidden');
        }
    });
    grid.appendChild(img);
});

// ESCUCHAR MENSAJES DE FIREBASE EN TIEMPO REAL
let appInitializing = true;
setTimeout(() => { appInitializing = false; }, 2000);

onChildAdded(ref(db, 'messages'), async (snapshot) => {
    const data = snapshot.val();
    const authorSnap = await get(child(dbRef, `users/${data.userKey}`));
    let authorData = { name: "Usuario", nickname: "@unknown", avatar: "" };
    
    if (authorSnap.exists()) authorData = authorSnap.val();
    const isMe = currentUser && authorData.nickname.toLowerCase() === currentUser.nickname.toLowerCase();
    
    if (!appInitializing && !isMe) {
        NotificationSystem.trigger();
    }
    UI.renderMessage(data, authorData, isMe);
});

// LOGOUT
document.getElementById('logout-btn').addEventListener('click', () => {
    if (currentUser) PresenceSystem.setOffline(currentUser.nickname.replace('@', ''));
    localStorage.removeItem('chat_session_v5');
    location.reload();
});

// SELECCIÓN DE TEMAS
document.querySelectorAll('[data-set-theme]').forEach(dot => {
    dot.addEventListener('click', (e) => {
        document.body.setAttribute('data-theme', e.target.getAttribute('data-set-theme'));
        document.querySelectorAll('.theme-circle').forEach(d => d.classList.remove('active'));
        e.target.classList.add('active');
    });
});

// EVALUAR AUTO-LOGIN AL CARGAR
const savedSession = localStorage.getItem('chat_session_v5');
if (savedSession) {
    currentUser = JSON.parse(savedSession);
    const cleanKey = currentUser.nickname.replace('@', '');
    PresenceSystem.setOnline(cleanKey);
    PresenceSystem.listenPresence();
    UI.showChat(currentUser);
}
