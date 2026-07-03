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
let currentChatTarget = "global"; 
let unreadCountGlobal = 0;
let privateUnreadCounts = {}; 
let baseTitle = "SayChat";
let originalFavicon = null;
let tempRegisterAvatar = "";
let tempModalAvatarBase64 = ""; // Almacén temporal para foto cargada en modal
let loginTimeMark = Date.now(); 

const imageToConvert64 = (file, callback) => {
    const reader = new FileReader();
    reader.onloadend = () => callback(reader.result);
    reader.readAsDataURL(file);
};

// ==========================================================================
// NOTIFICACIONES GENERALES
// ==========================================================================
const NotificationSystem = {
    trigger() {
        const sound = document.getElementById('noti-sound');
        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(() => {});
        }
        if (!document.hasFocus()) {
            unreadCountGlobal++;
            document.title = `(${unreadCountGlobal}) ${baseTitle}`;
            this.updateFaviconBadge();
        }
    },
    reset() {
        unreadCountGlobal = 0;
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
        ctx.fillText(unreadCountGlobal > 9 ? '9+' : unreadCountGlobal, 16, 16);
        
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
// SUBSISTEMA DE PRESENCIA ACTIVA AVANZADA
// ==========================================================================
const PresenceSystem = {
    updateState(status) {
        if (!currentUser) return;
        const userKey = currentUser.nickname.replace('@', '');
        set(ref(db, `presence/${userKey}`), { status: status, lastSeen: Date.now() });
    },
    init() {
        this.updateState("online");
        document.addEventListener("visibilitychange", () => {
            this.updateState(document.visibilityState === "visible" ? "online" : "idle");
        });
        const userKey = currentUser.nickname.replace('@', '');
        window.addEventListener('beforeunload', () => {
            set(ref(db, `presence/${userKey}`), { status: "offline", lastSeen: Date.now() });
        });
    },
    listenPresence() {
        onValue(ref(db, 'presence'), async (snapshot) => {
            const listContainer = document.getElementById('users-connected-list');
            if (!listContainer) return;
            
            const presenceData = snapshot.val() || {};
            const usersSnap = await get(child(dbRef, 'users'));
            
            if (usersSnap.exists()) {
                const allUsers = usersSnap.val();
                
                Object.keys(allUsers).forEach(key => {
                    const user = allUsers[key];
                    if (currentUser && user.nickname === currentUser.nickname) return;

                    const userState = presenceData[key] ? presenceData[key].status : "offline";
                    let existingRow = document.getElementById(`user-row-${key}`);

                    if (!existingRow) {
                        existingRow = document.createElement('div');
                        existingRow.id = `user-row-${key}`;
                        existingRow.classList.add('contact-list-row');
                        
                        existingRow.innerHTML = `
                            <div class="contact-avatar-wrapper">
                                <img src="${user.avatar}" class="custom-avatar" alt="Avatar">
                                <span class="status-indicator-dot ${userState}"></span>
                            </div>
                            <div class="contact-info-block">
                                <div class="contact-row-top">
                                    <h4>${user.name}</h4>
                                </div>
                                <p class="contact-sub">${user.nickname}</p>
                            </div>
                            <span class="private-unread-badge hidden" id="unread-badge-${key}">0</span>
                        `;

                        existingRow.addEventListener('click', () => {
                            currentChatTarget = key;
                            document.getElementById('btn-nav-global').classList.remove('active');
                            document.querySelectorAll('.contact-list-row').forEach(r => r.classList.remove('active'));
                            existingRow.classList.add('active');
                            document.getElementById('header-channel-title').textContent = `${user.name} (@${key})`;
                            
                            privateUnreadCounts[key] = 0;
                            const badge = document.getElementById(`unread-badge-${key}`);
                            if (badge) { badge.classList.add('hidden'); }
                            
                            reloadMessagesUI();
                        });

                        listContainer.appendChild(existingRow);
                    } else {
                        const dot = existingRow.querySelector('.status-indicator-dot');
                        if (dot) { dot.className = `status-indicator-dot ${userState}`; }
                    }

                    const badge = document.getElementById(`unread-badge-${key}`);
                    if (badge && privateUnreadCounts[key] > 0) {
                        badge.textContent = privateUnreadCounts[key];
                        badge.classList.remove('hidden');
                    }
                });
            }
        });
    }
};

// ==========================================================================
// CONTROLADORES DE RENDERIZADO DE MENSAJES
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
// GESTIÓN DEL MODAL CENTRAL DE PERFIL
// ==========================================================================
const modalOverlay = document.getElementById('profile-edit-modal');
const openModalBtn = document.getElementById('open-profile-modal-btn');
const closeModalBtn = document.getElementById('close-profile-modal-btn');
const saveProfileBtn = document.getElementById('btn-save-profile-modal');
const modalAvatarImg = document.getElementById('modal-user-avatar');
const modalNameInput = document.getElementById('edit-name-input');

if (openModalBtn) {
    openModalBtn.addEventListener('click', () => {
        if (currentUser) {
            modalAvatarImg.src = currentUser.avatar;
            modalNameInput.value = currentUser.name;
            tempModalAvatarBase64 = currentUser.avatar; // Inicializa con el avatar actual
            modalOverlay.classList.remove('hidden');
        }
    });
}

if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => modalOverlay.classList.add('hidden'));
}

document.getElementById('edit-avatar').addEventListener('change', (e) => {
    if (e.target.files[0]) {
        imageToConvert64(e.target.files[0], (base64) => {
            tempModalAvatarBase64 = base64;
            modalAvatarImg.src = base64;
        });
    }
});

if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', async () => {
        const newName = modalNameInput.value.trim();
        if (newName.length < 3 || newName.length > 50) {
            return alert("El nombre debe tener entre 3 y 50 letras.");
        }
        if (currentUser) {
            const userKey = currentUser.nickname.replace('@', '');
            await update(ref(db, `users/${userKey}`), { 
                name: newName, 
                avatar: tempModalAvatarBase64 
            });
            
            currentUser.name = newName;
            currentUser.avatar = tempModalAvatarBase64;
            localStorage.setItem('chat_session_v5', JSON.stringify(currentUser));
            
            // Actualizar interfaz principal
            document.getElementById('current-user-avatar').src = currentUser.avatar;
            document.getElementById('current-user-name').textContent = currentUser.name;
            
            modalOverlay.classList.add('hidden');
            NotificationSystem.showLocalToast("Perfil Guardado");
            reloadMessagesUI();
        }
    });
}

// ==========================================================================
// FILTROS, ENTRADAS Y MENSAJERÍA
// ==========================================================================

document.getElementById('go-to-register').addEventListener('click', () => {
    document.getElementById('login-area').classList.add('hidden');
    document.getElementById('register-area').classList.remove('hidden');
});
document.getElementById('go-to-login').addEventListener('click', () => {
    document.getElementById('register-area').classList.add('hidden');
    document.getElementById('login-area').classList.remove('hidden');
});

document.getElementById('btn-nav-global').addEventListener('click', () => {
    currentChatTarget = "global";
    document.getElementById('btn-nav-global').classList.add('active');
    document.querySelectorAll('.contact-list-row').forEach(r => { if(r.id !== 'btn-nav-global') r.classList.remove('active'); });
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

const executeMessageSend = () => {
    const input = document.getElementById('message-input');
    const msg = input.value.trim();
    if (msg && currentUser) {
        const myKey = currentUser.nickname.replace('@', '');
        const payload = { sender: myKey, message: msg, type: 'text', timestamp: Date.now() };

        if (currentChatTarget === "global") payload.channel = "global";
        else { payload.channel = "private"; payload.receiver = currentChatTarget; }
        
        push(ref(db, 'messages'), payload);
        input.value = '';
    }
};

document.getElementById('btn-send-message').addEventListener('click', executeMessageSend);
document.getElementById('message-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') executeMessageSend(); });

// STICKERS
document.getElementById('btn-toggle-stickers').addEventListener('click', () => {
    document.getElementById('stickers-panel').classList.toggle('hidden');
});
document.getElementById('upload-sticker-input').addEventListener('change', (e) => {
    if (e.target.files[0]) {
        imageToConvert64(e.target.files[0], (base64) => { push(ref(db, 'stickers'), { base64 }); });
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

// TRANSMISIÓN DE MENSAJES
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

    const isNewMessage = data.timestamp > loginTimeMark;
    const isMe = currentUser && authorData.nickname.toLowerCase() === currentUser.nickname.toLowerCase();

    if (isNewMessage) {
        if (!isMe) { NotificationSystem.trigger(); }

        if (data.channel === "private" && data.sender !== currentChatTarget) {
            const senderKey = data.sender;
            privateUnreadCounts[senderKey] = (privateUnreadCounts[senderKey] || 0) + 1;
            
            const badge = document.getElementById(`unread-badge-${senderKey}`);
            if (badge) {
                badge.textContent = privateUnreadCounts[senderKey];
                badge.classList.remove('hidden');
            }
        }
    }

    reloadMessagesUI();
});

document.getElementById('logout-btn').addEventListener('click', () => {
    PresenceSystem.updateState("offline");
    localStorage.removeItem('chat_session_v5');
    location.reload();
});

// EVALUAR SESIÓN
const savedSession = localStorage.getItem('chat_session_v5');
if (savedSession) {
    currentUser = JSON.parse(savedSession);
    
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('chat-screen').classList.remove('hidden');
    document.getElementById('current-user-avatar').src = currentUser.avatar;
    document.getElementById('current-user-name').textContent = currentUser.name;
    document.getElementById('current-user-nickname').textContent = currentUser.nickname;
    
    PresenceSystem.init();
    PresenceSystem.listenPresence();
}
