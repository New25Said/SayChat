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
let currentChatTarget = "global"; // "global" o el key del usuario privado
let unreadCount = 0;
let baseTitle = "SayChat";
let originalFavicon = null;
let tempRegisterAvatar = "";
let loginTimeMark = Date.now(); // Marca temporal local para ignorar notificaciones antiguas

const imageToConvert64 = (file, callback) => {
    const reader = new FileReader();
    reader.onloadend = () => callback(reader.result);
    reader.readAsDataURL(file);
};

// ==========================================================================
// NOTIFICACIONES EN PESTAÑA
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
// SUBSISTEMA DE PRESENCIA AVANZADO (ONLINE, IDLE, OFFLINE)
// ==========================================================================
const PresenceSystem = {
    updateState(status) {
        if (!currentUser) return;
        const userKey = currentUser.nickname.replace('@', '');
        set(ref(db, `presence/${userKey}`), { status: status, lastSeen: Date.now() });
    },
    init() {
        // Verde al estar activo en la pestaña
        this.updateState("online");
        
        // Detección en vivo de foco y pestañas secundarias
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                this.updateState("online"); // Verde
            } else {
                this.updateState("idle"); // Naranja
            }
        });

        // Desconectado por desvinculación o cierre total del navegador
        const userKey = currentUser.nickname.replace('@', '');
        window.addEventListener('beforeunload', () => {
            set(ref(db, `presence/${userKey}`), { status: "offline", lastSeen: Date.now() });
        });
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
                    if (currentUser && user.nickname === currentUser.nickname) return; // Omitirse a sí mismo
                    
                    const userState = presenceData[key] ? presenceData[key].status : "offline";
                    
                    const row = document.createElement('div');
                    row.classList.add('user-status-row');
                    if (currentChatTarget === key) row.classList.add('active-private');
                    
                    row.innerHTML = `
                        <span class="status-indicator-dot ${userState}"></span>
                        <span style="font-weight: 500;">${user.name}</span>
                        <span style="font-size:10px; color:var(--text-muted); margin-left:4px;">${user.nickname}</span>
                    `;
                    
                    // Al darle click abre el chat privado exclusivo
                    row.addEventListener('click', () => {
                        currentChatTarget = key;
                        document.getElementById('btn-nav-global').classList.remove('active');
                        document.querySelectorAll('.user-status-row').forEach(r => r.classList.remove('active-private'));
                        row.classList.add('active-private');
                        document.getElementById('header-channel-title').textContent = `Chat Privado con ${user.name}`;
                        reloadMessagesUI();
                    });

                    listContainer.appendChild(row);
                });
            }
        });
    }
};

// ==========================================================================
// CONTROLADORES DE RENDERIZADO
// ==========================================================================
let allMessagesCache = [];

const reloadMessagesUI = () => {
    const box = document.getElementById('chat-box');
    box.innerHTML = "";
    
    allMessagesCache.forEach(msgData => {
        let shouldRender = false;
        
        if (currentChatTarget === "global" && msgData.channel === "global") {
            shouldRender = true;
        } else if (currentChatTarget !== "global" && msgData.channel === "private") {
            const myKey = currentUser.nickname.replace('@', '');
            if ((msgData.sender === myKey && msgData.receiver === currentChatTarget) || 
                (msgData.sender === currentChatTarget && msgData.receiver === myKey)) {
                shouldRender = true;
            }
        }

        if (shouldRender) {
            const msgRow = document.createElement('div');
            msgRow.classList.add('msg-row');
            if (currentUser && msgData.authorNickname.toLowerCase() === currentUser.nickname.toLowerCase()) {
                msgRow.classList.add('msg-row-me');
            }

            const time = new Date(msgData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            let contentHTML = `<p class="msg-body">${msgData.message}</p>`;
            if (msgData.type === 'sticker') {
                contentHTML = `<img src="${msgData.stickerUrl}" class="msg-sticker" alt="Sticker">`;
            }

            msgRow.innerHTML = `
                <img src="${msgData.authorAvatar || ''}" class="msg-img custom-avatar" alt="Avatar">
                <div class="msg-bubble">
                    <div class="msg-meta">
                        <span class="meta-name">${msgData.authorName}</span>
                        <span class="meta-nick">${msgData.authorNickname}</span>
                    </div>
                    ${contentHTML}
                    <span class="msg-time">${time}</span>
                </div>
            `;
            box.appendChild(msgRow);
        }
    });
    box.scrollTop = box.scrollHeight;
};

// ==========================================================================
// LISTENERS Y ACCIONES MOCK
// ==========================================================================

document.getElementById('go-to-register').addEventListener('click', () => {
    document.getElementById('login-area').classList.add('hidden');
    document.getElementById('register-area').classList.remove('hidden');
});
document.getElementById('go-to-login').addEventListener('click', () => {
    document.getElementById('register-area').classList.add('hidden');
    document.getElementById('login-area').classList.remove('hidden');
});

document.getElementById('toggle-settings-btn').addEventListener('click', () => {
    document.getElementById('settings-area').classList.toggle('collapsed');
});

document.getElementById('btn-nav-global').addEventListener('click', () => {
    currentChatTarget = "global";
    document.getElementById('btn-nav-global').classList.add('active');
    document.querySelectorAll('.user-status-row').forEach(r => r.classList.remove('active-private'));
    document.getElementById('header-channel-title').textContent = "SayChat // Global";
    reloadMessagesUI();
});

document.getElementById('reg-avatar').addEventListener('change', (e) => {
    if (e.target.files[0]) {
        imageToConvert64(e.target.files[0], (base64) => {
            tempRegisterAvatar = base64;
            const preview = document.getElementById('reg-preview');
            preview.src = base64; preview.classList.remove('hidden');
            document.getElementById('label-reg-avatar').textContent = "Foto Lista ✓";
        });
    }
});

document.getElementById('btn-register-submit').addEventListener('click', async () => {
    const name = document.getElementById('reg-name').value.trim();
    const nickname = document.getElementById('reg-nickname').value.trim();
    const password = document.getElementById('reg-password').value;

    if (!name || !nickname || !password || !tempRegisterAvatar) return alert("Completa todos los datos.");
    if (/[A-Z\s]/.test(nickname)) return alert("Username sin mayúsculas ni espacios.");

    try {
        const snapshot = await get(child(dbRef, `users/${nickname}`));
        if (snapshot.exists()) return alert("Username ocupado.");

        const userData = { name, nickname: '@' + nickname, password, avatar: tempRegisterAvatar };
        await set(ref(db, `users/${nickname}`), userData);
        currentUser = userData;
        localStorage.setItem('chat_session_v5', JSON.stringify(currentUser));
        location.reload();
    } catch (err) { alert("Error."); }
});

document.getElementById('btn-login-submit').addEventListener('click', async () => {
    const nickname = document.getElementById('login-nickname').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;

    try {
        const snapshot = await get(child(dbRef, `users/${nickname}`));
        if (!snapshot.exists()) return alert("No existe.");
        const userData = snapshot.val();
        if (userData.password !== password) return alert("Incorrecto.");

        currentUser = userData;
        localStorage.setItem('chat_session_v5', JSON.stringify(currentUser));
        location.reload();
    } catch (err) { alert("Error."); }
});

// MENSAJERÍA COMPUESTA CON FILTRADO DE LLAVES PRIVADAS
const executeMessageSend = () => {
    const input = document.getElementById('message-input');
    const msg = input.value.trim();
    if (msg && currentUser) {
        const myKey = currentUser.nickname.replace('@', '');
        const payload = {
            sender: myKey,
            message: msg,
            type: 'text',
            timestamp: Date.now()
        };

        if (currentChatTarget === "global") {
            payload.channel = "global";
        } else {
            payload.channel = "private";
            payload.receiver = currentChatTarget;
        }
        push(ref(db, 'messages'), payload);
        input.value = '';
    }
};

document.getElementById('btn-send-message').addEventListener('click', executeMessageSend);
document.getElementById('message-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') executeMessageSend(); });

// EDITAR CAMPOS EN VIVO
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
            NotificationSystem.showLocalToast("Perfil guardado");
        }
        editNameInput.classList.add('hidden');
        userNameElement.classList.remove('hidden');
    }
});

// STICKERS
document.getElementById('btn-toggle-stickers').addEventListener('click', () => {
    document.getElementById('stickers-panel').classList.toggle('hidden');
});
document.getElementById('upload-sticker-input').addEventListener('change', (e) => {
    if (e.target.files[0]) {
        imageToConvert64(e.target.files[0], (base64) => {
            push(ref(db, 'stickers'), { base64 });
        });
    }
});
onChildAdded(ref(db, 'stickers'), (snapshot) => {
    const base64 = snapshot.val().base64;
    const grid = document.getElementById('stickers-grid');
    const img = document.createElement('img');
    img.src = base64; img.classList.add('grid-stk-img');
    img.addEventListener('click', () => {
        if (currentUser) {
            const myKey = currentUser.nickname.replace('@', '');
            const payload = { sender: myKey, message: '[Sticker]', type: 'sticker', stickerUrl: base64, timestamp: Date.now() };
            if (currentChatTarget === "global") payload.channel = "global";
            else { payload.channel = "private"; payload.receiver = currentChatTarget; }
            push(ref(db, 'messages'), payload);
            document.getElementById('stickers-panel').classList.add('hidden');
        }
    });
    grid.appendChild(img);
});

// ESCUCHAR MENSAJES Y EVITAR DUPLICADO AUDIBLE AL ENTRAR
onChildAdded(ref(db, 'messages'), async (snapshot) => {
    const data = snapshot.val();
    const authorSnap = await get(child(dbRef, `users/${data.sender}`));
    let authorData = { name: "Usuario", nickname: "@unknown", avatar: "" };
    if (authorSnap.exists()) authorData = authorSnap.val();

    const cachePayload = {
        ...data,
        authorName: authorData.name,
        authorNickname: authorData.nickname,
        authorAvatar: authorData.avatar
    };

    allMessagesCache.push(cachePayload);

    // Evitar que el timbre suene con mensajes antiguos del historial
    const isNewMessage = data.timestamp > loginTimeMark;
    const isMe = currentUser && authorData.nickname.toLowerCase() === currentUser.nickname.toLowerCase();

    if (isNewMessage && !isMe) {
        NotificationSystem.trigger();
    }

    reloadMessagesUI();
});

// TEMAS
document.querySelectorAll('[data-set-theme]').forEach(dot => {
    dot.addEventListener('click', (e) => {
        document.body.setAttribute('data-theme', e.target.getAttribute('data-set-theme'));
        document.querySelectorAll('.theme-circle').forEach(d => d.classList.remove('active'));
        e.target.classList.add('active');
    });
});

document.getElementById('logout-btn').addEventListener('click', () => {
    PresenceSystem.updateState("offline");
    localStorage.removeItem('chat_session_v5');
    location.reload();
});

// AUTO-LOGIN
const savedSession = localStorage.getItem('chat_session_v5');
if (savedSession) {
    currentUser = JSON.parse(savedSession);
    
    // Forzamos interfaz
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('chat-screen').classList.remove('hidden');
    document.getElementById('current-user-avatar').src = currentUser.avatar;
    document.getElementById('current-user-name').textContent = currentUser.name;
    document.getElementById('current-user-nickname').textContent = currentUser.nickname;
    
    PresenceSystem.init();
    PresenceSystem.listenPresence();
}
