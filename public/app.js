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
let chatTargetType = "global"; // "global", "private", "group"
let unreadCountGlobal = 0;
let privateUnreadCounts = {}; 
let baseTitle = "SayChat";
let originalFavicon = null;
let tempRegisterAvatar = "";
let tempModalAvatarBase64 = ""; 
let tempGroupAvatarBase64 = ""; // Almacén temporal foto de grupo
let loginTimeMark = Date.now(); 

const imageToConvert64 = (file, callback) => {
    const reader = new FileReader();
    reader.onloadend = () => callback(reader.result);
    reader.readAsDataURL(file);
};

// ==========================================================================
// SISTEMA DE NOTIFICACIONES
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
        ctx.fillStyle = '#ff2a5f'; ctx.beginPath(); ctx.arc(16, 16, 14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(unreadCountGlobal > 9 ? '9+' : unreadCountGlobal, 16, 16);
        let link = document.querySelector("link[rel*='icon']");
        if (!link) { link = document.createElement('link'); link.rel = 'shortcut icon'; document.getElementsByTagName('head')[0].appendChild(link); }
        link.href = canvas.toDataURL();
    },
    restoreFavicon() {
        if (originalFavicon) { const link = document.querySelector("link[rel*='icon']"); if (link) link.href = originalFavicon; }
    },
    showLocalToast(text) {
        const toast = document.getElementById('toast-notification');
        toast.textContent = text; toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 2000);
    }
};

window.addEventListener('focus', () => NotificationSystem.reset());

// ==========================================================================
// PRESENCIA Y CHATS CON FILTRADO RELACIONAL COMPLETO (DIFFING REAL)
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
        onValue(ref(db, 'users'), () => { if (currentUser) reloadMessagesUI(); });
        onValue(ref(db, 'groups'), () => { if (currentUser) this.renderListsAndPresence(); });

        onValue(ref(db, 'presence'), () => {
            if (currentUser) this.renderListsAndPresence();
        });
    },
    async renderListsAndPresence() {
        const listContainer = document.getElementById('users-connected-list');
        if (!listContainer) return;

        const snapPresence = await get(child(dbRef, 'presence'));
        const presenceData = snapPresence.val() || {};

        const snapUsers = await get(child(dbRef, 'users'));
        if (!snapUsers.exists()) return;
        const allUsers = snapUsers.val();

        // 1. INYECTAR/ACTUALIZAR GRUPOS PERTENECIENTES v4
        const snapGroups = await get(child(dbRef, 'groups'));
        if (snapGroups.exists()) {
            const allGroups = snapGroups.val();
            Object.keys(allGroups).forEach(gKey => {
                const group = allGroups[gKey];
                const myKey = currentUser.nickname.replace('@', '');
                
                // Filtro estricto: Solo lo ven los que están en el grupo
                if (!group.members || !group.members.includes(myKey)) {
                    const rowOld = document.getElementById(`group-row-${gKey}`);
                    if (rowOld) rowOld.remove();
                    return;
                }

                let existingRow = document.getElementById(`group-row-${gKey}`);
                if (!existingRow) {
                    existingRow = document.createElement('div');
                    existingRow.id = `group-row-${gKey}`;
                    existingRow.classList.add('contact-list-row');
                    existingRow.innerHTML = `
                        <div class="contact-avatar-wrapper">
                            <img src="${group.avatar}" class="custom-avatar" alt="Group">
                        </div>
                        <div class="contact-info-block">
                            <h4>${group.name}</h4>
                            <p class="contact-sub" style="color:var(--accent)">👥 Grupo de SayChat</p>
                        </div>
                        <span class="private-unread-badge hidden" id="unread-badge-${gKey}">0</span>
                    `;
                    existingRow.addEventListener('click', () => {
                        currentChatTarget = gKey; chatTargetType = "group";
                        document.getElementById('btn-nav-global').classList.remove('active');
                        document.querySelectorAll('.contact-list-row').forEach(r => r.classList.remove('active'));
                        existingRow.classList.add('active');
                        document.getElementById('header-channel-title').textContent = `${group.name} (Grupo)`;
                        privateUnreadCounts[gKey] = 0;
                        document.getElementById(`unread-badge-${gKey}`).classList.add('hidden');
                        reloadMessagesUI();
                    });
                    listContainer.appendChild(existingRow);
                }
                
                const badge = document.getElementById(`unread-badge-${gKey}`);
                if (badge && privateUnreadCounts[gKey] > 0) {
                    badge.textContent = privateUnreadCounts[gKey]; badge.classList.remove('hidden');
                }
            });
        }

        // 2. INYECTAR/ACTUALIZAR USUARIOS DIRECTOS
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
                        <img src="${user.avatar}" class="custom-avatar target-user-img" alt="Avatar">
                        <span class="status-indicator-dot ${userState}"></span>
                    </div>
                    <div class="contact-info-block">
                        <h4 class="target-user-name">${user.name}</h4>
                        <p class="contact-sub">${user.nickname}</p>
                    </div>
                    <span class="private-unread-badge hidden" id="unread-badge-${key}">0</span>
                `;
                existingRow.addEventListener('click', () => {
                    currentChatTarget = key; chatTargetType = "private";
                    document.getElementById('btn-nav-global').classList.remove('active');
                    document.querySelectorAll('.contact-list-row').forEach(r => r.classList.remove('active'));
                    existingRow.classList.add('active');
                    document.getElementById('header-channel-title').textContent = `${user.name} (@${key})`;
                    privateUnreadCounts[key] = 0;
                    document.getElementById(`unread-badge-${key}`).classList.add('hidden');
                    reloadMessagesUI();
                });
                listContainer.appendChild(existingRow);
            } else {
                const dot = existingRow.querySelector('.status-indicator-dot');
                if (dot) dot.className = `status-indicator-dot ${userState}`;
                const textName = existingRow.querySelector('.target-user-name');
                if (textName) textName.textContent = user.name;
                const imgAv = existingRow.querySelector('.target-user-img');
                if (imgAv) imgAv.src = user.avatar;
            }

            const badge = document.getElementById(`unread-badge-${key}`);
            if (badge && privateUnreadCounts[key] > 0) {
                badge.textContent = privateUnreadCounts[key]; badge.classList.remove('hidden');
            }
        });
    }
};

// ==========================================================================
// RENDERIZADOR DE MENSAJES FLUIDO EN CACHÉ (CORREGIDO PARPADO)
// ==========================================================================
let allMessagesCache = [];

const reloadMessagesUI = async () => {
    const box = document.getElementById('chat-box');
    box.innerHTML = "";
    
    const usersSnapshot = await get(child(dbRef, 'users'));
    if (!usersSnapshot.exists()) return;
    const currentUsersDB = usersSnapshot.val();

    allMessagesCache.forEach(msgData => {
        let shouldRender = false;
        
        if (currentChatTarget === "global" && msgData.channel === "global") {
            shouldRender = true;
        } else if (chatTargetType === "private" && msgData.channel === "private") {
            const myKey = currentUser.nickname.replace('@', '');
            if ((msgData.sender === myKey && msgData.receiver === currentChatTarget) || 
                (msgData.sender === currentChatTarget && msgData.receiver === myKey)) {
                shouldRender = true;
            }
        } else if (chatTargetType === "group" && msgData.channel === "group" && msgData.receiver === currentChatTarget) {
            shouldRender = true;
        }

        if (shouldRender) {
            if (msgData.type === 'system') {
                const sysDiv = document.createElement('div');
                sysDiv.classList.add('msg-system-line');
                sysDiv.textContent = msgData.message;
                box.appendChild(sysDiv);
                return;
            }

            const liveAuthor = currentUsersDB[msgData.sender] || { name: "Usuario", nickname: "@" + msgData.sender, avatar: "" };
            const msgRow = document.createElement('div');
            msgRow.classList.add('msg-row');
            if (currentUser && liveAuthor.nickname.toLowerCase() === currentUser.nickname.toLowerCase()) msgRow.classList.add('msg-row-me');

            const time = new Date(msgData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            let contentHTML = `<p class="msg-body">${msgData.message}</p>`;
            if (msgData.type === 'sticker') {
                contentHTML = `<img src="${msgData.stickerUrl}" class="msg-sticker previewable-sticker" alt="Sticker">`;
            } else if (msgData.type === 'image') {
                contentHTML = `<img src="${msgData.mediaUrl}" class="msg-media-expanded" alt="Foto adjuntada">`;
            } else if (msgData.type === 'video') {
                contentHTML = `<video src="${msgData.mediaUrl}" controls class="msg-media-expanded"></video>`;
            }

            msgRow.innerHTML = `
                <img src="${liveAuthor.avatar || ''}" class="custom-avatar" style="width:28px; height:28px; margin-bottom:4px;" alt="Avatar">
                <div class="msg-bubble">
                    <div class="msg-meta">
                        <span class="meta-name">${liveAuthor.name}</span>
                        <span class="meta-nick">${liveAuthor.nickname}</span>
                    </div>
                    ${contentHTML}
                    <span class="msg-time">${time}</span>
                </div>
            `;
            box.appendChild(msgRow);
        }
    });
    box.scrollTop = box.scrollHeight;
    attachStickerPreviewEvents();
};

// PREVIEW MEDIANO DE STICKERS v4
const attachStickerPreviewEvents = () => {
    document.querySelectorAll('.previewable-sticker').forEach(stk => {
        stk.onclick = (e) => {
            e.stopPropagation();
            const viewer = document.getElementById('sticker-viewer-overlay');
            document.getElementById('sticker-viewer-img').src = stk.src;
            viewer.classList.remove('hidden');
        };
    });
};
document.getElementById('sticker-viewer-overlay').onclick = () => {
    document.getElementById('sticker-viewer-overlay').classList.add('hidden');
};

// ==========================================================================
// MODALES CENTRALES (PERFIL Y CREACIÓN DE GRUPOS)
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
            modalAvatarImg.src = currentUser.avatar; modalNameInput.value = currentUser.name;
            tempModalAvatarBase64 = currentUser.avatar; modalOverlay.classList.remove('hidden');
        }
    });
}
if (closeModalBtn) closeModalBtn.addEventListener('click', () => modalOverlay.classList.add('hidden'));

document.getElementById('edit-avatar').addEventListener('change', (e) => {
    if (e.target.files[0]) imageToConvert64(e.target.files[0], (b64) => { tempModalAvatarBase64 = b64; modalAvatarImg.src = b64; });
});

if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', async () => {
        const newName = modalNameInput.value.trim();
        if (newName.length < 3 || newName.length > 50) return alert("El nombre debe tener entre 3 y 50 letras.");
        if (currentUser) {
            const userKey = currentUser.nickname.replace('@', '');
            await update(ref(db, `users/${userKey}`), { name: newName, avatar: tempModalAvatarBase64 });
            currentUser.name = newName; currentUser.avatar = tempModalAvatarBase64;
            localStorage.setItem('chat_session_v5', JSON.stringify(currentUser));
            document.getElementById('current-user-avatar').src = currentUser.avatar;
            document.getElementById('current-user-name').textContent = currentUser.name;
            modalOverlay.classList.add('hidden');
            NotificationSystem.showLocalToast("Perfil Guardado");
            await reloadMessagesUI();
        }
    });
}

// CREACIÓN DE GRUPOS DINÁMICOS v4
const groupModal = document.getElementById('group-create-modal');
document.getElementById('open-group-modal-btn').onclick = async () => {
    const checklist = document.getElementById('group-members-checklist');
    checklist.innerHTML = "";
    tempGroupAvatarBase64 = "";
    document.getElementById('group-avatar-preview').textContent = "👥";
    document.getElementById('group-name-input').value = "";

    const snapUsers = await get(child(dbRef, 'users'));
    if (snapUsers.exists()) {
        const allUsers = snapUsers.val();
        Object.keys(allUsers).forEach(key => {
            if (currentUser && "@" + key === currentUser.nickname) return;
            const row = document.createElement('label');
            row.classList.add('checklist-row-item');
            row.innerHTML = `<input type="checkbox" value="${key}"> <span>${allUsers[key].name} (@${key})</span>`;
            checklist.appendChild(row);
        });
    }
    groupModal.classList.remove('hidden');
};
document.getElementById('close-group-modal-btn').onclick = () => groupModal.classList.add('hidden');

document.getElementById('group-avatar-input').onchange = (e) => {
    if (e.target.files[0]) {
        imageToConvert64(e.target.files[0], (b64) => {
            tempGroupAvatarBase64 = b64;
            const holder = document.getElementById('group-avatar-preview');
            holder.innerHTML = `<img src="${b64}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
        });
    }
};

document.getElementById('btn-save-group-submit').onclick = async () => {
    const gName = document.getElementById('group-name-input').value.trim();
    if (!gName) return alert("Ponle un nombre al grupo.");
    if (!tempGroupAvatarBase64) return alert("Sube una foto para el grupo.");

    const marked = [];
    document.querySelectorAll('#group-members-checklist input:checked').forEach(i => marked.push(i.value));
    const myKey = currentUser.nickname.replace('@', '');
    marked.push(myKey); // Se incluye el creador automáticamente

    const groupKey = "group_" + Date.now();
    await set(ref(db, `groups/${groupKey}`), { name: gName, avatar: tempGroupAvatarBase64, members: marked });
    groupModal.classList.add('hidden');
    NotificationSystem.showLocalToast("Grupo Creado");
};

// ==========================================================================
// ENVÍO DE CONTENIDO (MENSAJES, FOTOS Y VIDEOS EN BASE64)
// ==========================================================================
const executeMessageSend = () => {
    const input = document.getElementById('message-input');
    const msg = input.value.trim();
    if (msg && currentUser) {
        const myKey = currentUser.nickname.replace('@', '');
        const payload = { sender: myKey, message: msg, type: 'text', timestamp: Date.now() };
        if (currentChatTarget === "global") payload.channel = "global";
        else if (chatTargetType === "group") { payload.channel = "group"; payload.receiver = currentChatTarget; }
        else { payload.channel = "private"; payload.receiver = currentChatTarget; }
        push(ref(db, 'messages'), payload);
        input.value = '';
    }
};
document.getElementById('btn-send-message').onclick = executeMessageSend;
document.getElementById('message-input').onkeydown = (e) => { if (e.key === 'Enter') executeMessageSend(); };

// SUBIR FOTO/VIDEO EN BASE64 v4
document.getElementById('chat-media-input').onchange = (e) => {
    if (e.target.files[0] && currentUser) {
        const file = e.target.files[0];
        const isVideo = file.type.startsWith('video/');
        imageToConvert64(file, (b64) => {
            const myKey = currentUser.nickname.replace('@', '');
            const payload = { 
                sender: myKey, 
                message: isVideo ? "[Video]" : "[Foto]", 
                type: isVideo ? "video" : "image", 
                mediaUrl: b64, 
                timestamp: Date.now() 
            };
            if (currentChatTarget === "global") payload.channel = "global";
            else if (chatTargetType === "group") { payload.channel = "group"; payload.receiver = currentChatTarget; }
            else { payload.channel = "private"; payload.receiver = currentChatTarget; }
            push(ref(db, 'messages'), payload);
        });
    }
};

document.getElementById('btn-nav-global').onclick = () => {
    currentChatTarget = "global"; chatTargetType = "global";
    document.getElementById('btn-nav-global').classList.add('active');
    document.querySelectorAll('.contact-list-row').forEach(r => { if(r.id !== 'btn-nav-global') r.classList.remove('active'); });
    document.getElementById('header-channel-title').textContent = "SayChat // Global";
    privateUnreadCounts["global"] = 0;
    document.getElementById('unread-badge-global').classList.add('hidden');
    reloadMessagesUI();
};

// STICKERS LÓGICA
document.getElementById('btn-toggle-stickers').onclick = () => document.getElementById('stickers-panel').classList.toggle('hidden');
document.getElementById('upload-sticker-input').onchange = (e) => {
    if (e.target.files[0]) imageToConvert64(e.target.files[0], (b64) => push(ref(db, 'stickers'), { base64: b64 }));
};
onChildAdded(ref(db, 'stickers'), (snap) => {
    const b64 = snap.val().base64;
    const grid = document.getElementById('stickers-grid');
    const img = document.createElement('img'); img.src = b64; img.classList.add('grid-stk-img');
    img.onclick = () => {
        if (currentUser) {
            const myKey = currentUser.nickname.replace('@', '');
            const payload = { sender: myKey, message: '[Sticker]', type: 'sticker', stickerUrl: b64, timestamp: Date.now() };
            if (currentChatTarget === "global") payload.channel = "global";
            else if (chatTargetType === "group") { payload.channel = "group"; payload.receiver = currentChatTarget; }
            else { payload.channel = "private"; payload.receiver = currentChatTarget; }
            push(ref(db, 'messages'), payload);
            document.getElementById('stickers-panel').classList.add('hidden');
        }
    };
    grid.appendChild(img);
});

// TRANSMISIÓN CENTRAL DE MENSAJES Y FILTRADO DE CONTADORES ROJOS
onChildAdded(ref(db, 'messages'), async (snapshot) => {
    const data = snapshot.val();
    allMessagesCache.push(data);

    const isNewMessage = data.timestamp > loginTimeMark;
    const isMe = currentUser && ("@" + data.sender).toLowerCase() === currentUser.nickname.toLowerCase();

    if (isNewMessage) {
        if (!isMe) NotificationSystem.trigger();

        // Control dinámico de bolitas rojas
        if (data.channel === "global" && currentChatTarget !== "global") {
            privateUnreadCounts["global"] = (privateUnreadCounts["global"] || 0) + 1;
            const gb = document.getElementById('unread-badge-global');
            if (gb) { gb.textContent = privateUnreadCounts["global"]; gb.classList.remove('hidden'); }
        } else if (data.channel === "group" && currentChatTarget !== data.receiver) {
            const gKey = data.receiver;
            privateUnreadCounts[gKey] = (privateUnreadCounts[gKey] || 0) + 1;
        } else if (data.channel === "private" && data.sender !== currentChatTarget) {
            const senderKey = data.sender;
            privateUnreadCounts[senderKey] = (privateUnreadCounts[senderKey] || 0) + 1;
        }
    }
    await reloadMessagesUI();
});

// ==========================================================================
// REGISTRO Y LOGIN CORREGIDO (RESUELVE COMPORTAMIENTO CONGELADO)
// ==========================================================================
document.getElementById('btn-register-submit').onclick = async () => {
    const name = document.getElementById('reg-name').value.trim();
    const nickname = document.getElementById('reg-nickname').value.trim();
    const password = document.getElementById('reg-password').value;
    if (!name || !nickname || !password || !tempRegisterAvatar) return alert("Rellena todo.");

    try {
        const snap = await get(child(dbRef, `users/${nickname}`));
        if (snap.exists()) return alert("Username ocupado.");

        const userData = { name, nickname: '@' + nickname, password, avatar: tempRegisterAvatar };
        await set(ref(db, `users/${nickname}`), userData);
        
        // Alerta de notificación en el chat público global cuando se une alguien nuevo
        push(ref(db, 'messages'), { sender: "system", message: `✨ ¡${name} se ha unido a SayChat! Denle una cálida bienvenida.`, type: "system", channel: "global", timestamp: Date.now() });

        currentUser = userData; loginTimeMark = Date.now();
        localStorage.setItem('chat_session_v5', JSON.stringify(currentUser));
        initAppAfterLogin();
    } catch (err) { alert("Error."); }
};

document.getElementById('btn-login-submit').onclick = async () => {
    const nickname = document.getElementById('login-nickname').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;

    try {
        const snap = await get(child(dbRef, `users/${nickname}`));
        if (!snap.exists()) return alert("No existe.");
        const userData = snap.val();
        if (userData.password !== password) return alert("Incorrecto.");

        currentUser = userData; loginTimeMark = Date.now();
        localStorage.setItem('chat_session_v5', JSON.stringify(currentUser));
        initAppAfterLogin();
    } catch (err) { alert("Error."); }
};

const initAppAfterLogin = () => {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('chat-screen').classList.remove('hidden');
    document.getElementById('current-user-avatar').src = currentUser.avatar;
    document.getElementById('current-user-name').textContent = currentUser.name;
    document.getElementById('current-user-nickname').textContent = currentUser.nickname;
    
    PresenceSystem.init();
    PresenceSystem.listenPresence();
};

document.getElementById('logout-btn').onclick = () => {
    PresenceSystem.updateState("offline");
    currentUser = null; allMessagesCache = []; privateUnreadCounts = {};
    localStorage.removeItem('chat_session_v5');
    document.getElementById('chat-screen').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
};

const savedSession = localStorage.getItem('chat_session_v5');
if (savedSession) { currentUser = JSON.parse(savedSession); initAppAfterLogin(); }
