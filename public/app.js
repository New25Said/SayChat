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
let chatTargetType = "global"; 
let unreadCountGlobal = 0;
let privateUnreadCounts = {}; 
let baseTitle = "SayChat";
let originalFavicon = null;
let tempRegisterAvatar = "";
let tempModalAvatarBase64 = ""; 
let tempGroupAvatarBase64 = ""; 
let loginTimeMark = Date.now(); 
let currentUsersCachedMap = {}; 

const imageToConvert64 = (file, callback) => {
    const reader = new FileReader();
    reader.onloadend = () => callback(reader.result);
    reader.readAsDataURL(file);
};

// COMPRESOR MULTIMEDIA
const optimizeAndCompressMedia = (file, callback) => {
    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const max_size = 800; 
                let width = img.width; let height = img.height;
                if (width > height) {
                    if (width > max_size) { height *= max_size / width; width = max_size; }
                } else {
                    if (height > max_size) { width *= max_size / height; height = max_size; }
                }
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                callback(canvas.toDataURL('image/jpeg', 0.7)); 
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    } else if (file.type.startsWith('video/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
            callback(reader.result); 
        };
        reader.readAsDataURL(file);
    }
};

// ==========================================================================
// NOTIFICACIONES
// ==========================================================================
const NotificationSystem = {
    trigger() {
        const sound = document.getElementById('noti-sound');
        if (sound) { sound.currentTime = 0; sound.play().catch(() => {}); }
        if (!document.hasFocus()) {
            unreadCountGlobal++;
            document.title = `(${unreadCountGlobal}) ${baseTitle}`;
            this.updateFaviconBadge();
        }
    },
    reset() { unreadCountGlobal = 0; document.title = baseTitle; this.restoreFavicon(); },
    updateFaviconBadge() {
        if (!originalFavicon) { const currentFav = document.querySelector("link[rel*='icon']"); originalFavicon = currentFav ? currentFav.href : ""; }
        const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ff2a5f'; ctx.beginPath(); ctx.arc(16, 16, 14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(unreadCountGlobal > 9 ? '9+' : unreadCountGlobal, 16, 16);
        let link = document.querySelector("link[rel*='icon']");
        if (!link) { link = document.createElement('link'); link.rel = 'shortcut icon'; document.getElementsByTagName('head')[0].appendChild(link); }
        link.href = canvas.toDataURL();
    },
    restoreFavicon() { if (originalFavicon) { const link = document.querySelector("link[rel*='icon']"); if (link) link.href = originalFavicon; } },
    showLocalToast(text) {
        const toast = document.getElementById('toast-notification');
        toast.textContent = text; toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 2000);
    }
};

window.addEventListener('focus', () => NotificationSystem.reset());

// ==========================================================================
// PRESENCIA Y LISTAS
// ==========================================================================
const PresenceSystem = {
    updateState(status) {
        if (!currentUser) return;
        const userKey = currentUser.nickname.replace('@', '');
        set(ref(db, `presence/${userKey}`), { status: status, lastSeen: Date.now() });
    },
    init() {
        this.updateState("online");
        document.addEventListener("visibilitychange", () => { this.updateState(document.visibilityState === "visible" ? "online" : "idle"); });
        const userKey = currentUser.nickname.replace('@', '');
        window.addEventListener('beforeunload', () => { set(ref(db, `presence/${userKey}`), { status: "offline", lastSeen: Date.now() }); });
    },
    listenPresence() {
        onValue(ref(db, 'users'), (snapshot) => { 
            currentUsersCachedMap = snapshot.val() || {};
            if (currentUser) reloadMessagesUI(); 
        });
        onValue(ref(db, 'groups'), () => { if (currentUser) this.renderListsAndPresence(); });
        onValue(ref(db, 'presence'), () => { if (currentUser) this.renderListsAndPresence(); });
    },
    async renderListsAndPresence() {
        const listContainer = document.getElementById('users-connected-list');
        if (!listContainer) return;

        const snapPresence = await get(child(dbRef, 'presence'));
        const presenceData = snapPresence.val() || {};

        const snapGroups = await get(child(dbRef, 'groups'));
        if (snapGroups.exists()) {
            const allGroups = snapGroups.val();
            Object.keys(allGroups).forEach(gKey => {
                const group = allGroups[gKey];
                const myKey = currentUser.nickname.replace('@', '');
                if (!group.members || !group.members.includes(myKey)) {
                    const rowOld = document.getElementById(`group-row-${gKey}`); if (rowOld) rowOld.remove(); return;
                }
                let existingRow = document.getElementById(`group-row-${gKey}`);
                if (!existingRow) {
                    existingRow = document.createElement('div'); existingRow.id = `group-row-${gKey}`; existingRow.classList.add('contact-list-row');
                    existingRow.innerHTML = `
                        <div class="contact-avatar-wrapper"><img src="${group.avatar}" class="custom-avatar" alt="Group"></div>
                        <div class="contact-info-block"><h4>${group.name}</h4><p class="contact-sub" style="color:var(--accent)">👥 Grupo de SayChat</p></div>
                        <span class="private-unread-badge hidden" id="unread-badge-${gKey}">0</span>
                    `;
                    existingRow.addEventListener('click', () => {
                        currentChatTarget = gKey; chatTargetType = "group";
                        document.getElementById('btn-nav-global').classList.remove('active');
                        document.querySelectorAll('.contact-list-row').forEach(r => r.classList.remove('active'));
                        existingRow.classList.add('active');
                        document.getElementById('header-channel-title').textContent = `${group.name} (Grupo)`;
                        privateUnreadCounts[gKey] = 0; document.getElementById(`unread-badge-${gKey}`).classList.add('hidden');
                        reloadMessagesUI();
                    });
                    listContainer.appendChild(existingRow);
                }
                const badge = document.getElementById(`unread-badge-${gKey}`);
                if (badge && privateUnreadCounts[gKey] > 0) { badge.textContent = privateUnreadCounts[gKey]; badge.classList.remove('hidden'); }
            });
        }

        Object.keys(currentUsersCachedMap).forEach(key => {
            const user = currentUsersCachedMap[key];
            if (currentUser && user.nickname === currentUser.nickname) return;

            const userState = presenceData[key] ? presenceData[key].status : "offline";
            let existingRow = document.getElementById(`user-row-${key}`);

            if (!existingRow) {
                existingRow = document.createElement('div'); existingRow.id = `user-row-${key}`; existingRow.classList.add('contact-list-row');
                existingRow.innerHTML = `
                    <div class="contact-avatar-wrapper">
                        <img src="${user.avatar}" class="custom-avatar target-user-img" alt="Avatar">
                        <span class="status-indicator-dot ${userState}"></span>
                    </div>
                    <div class="contact-info-block"><h4 class="target-user-name">${user.name}</h4><p class="contact-sub">${user.nickname}</p></div>
                    <span class="private-unread-badge hidden" id="unread-badge-${key}">0</span>
                `;
                existingRow.addEventListener('click', () => {
                    currentChatTarget = key; chatTargetType = "private";
                    document.getElementById('btn-nav-global').classList.remove('active');
                    document.querySelectorAll('.contact-list-row').forEach(r => r.classList.remove('active'));
                    existingRow.classList.add('active');
                    document.getElementById('header-channel-title').textContent = `${user.name} (@${key})`;
                    privateUnreadCounts[key] = 0; document.getElementById(`unread-badge-${key}`).classList.add('hidden');
                    reloadMessagesUI();
                });
                listContainer.appendChild(existingRow);
            } else {
                const dot = existingRow.querySelector('.status-indicator-dot'); if (dot) dot.className = `status-indicator-dot ${userState}`;
                const textName = existingRow.querySelector('.target-user-name'); if (textName) textName.textContent = user.name;
                const imgAv = existingRow.querySelector('.target-user-img'); if (imgAv) imgAv.src = user.avatar;
            }
            const badge = document.getElementById(`unread-badge-${key}`);
            if (badge && privateUnreadCounts[key] > 0) { badge.textContent = privateUnreadCounts[key]; badge.classList.remove('hidden'); }
        });
    }
};

// ==========================================================================
// INYECCIÓN DE MENSAJES UNITARIOS EN TIEMPO REAL
// ==========================================================================
const renderSingleMessageAppend = (msgData) => {
    let shouldRender = false;
    if (currentChatTarget === "global" && msgData.channel === "global") shouldRender = true;
    else if (chatTargetType === "private" && msgData.channel === "private") {
        const myKey = currentUser.nickname.replace('@', '');
        if ((msgData.sender === myKey && msgData.receiver === currentChatTarget) || (msgData.sender === currentChatTarget && msgData.receiver === myKey)) shouldRender = true;
    } else if (chatTargetType === "group" && msgData.channel === "group" && msgData.receiver === currentChatTarget) shouldRender = true;

    if (!shouldRender) return;

    const box = document.getElementById('chat-box');
    if (msgData.type === 'system') {
        const sysDiv = document.createElement('div'); sysDiv.classList.add('msg-system-line'); sysDiv.textContent = msgData.message;
        box.appendChild(sysDiv); box.scrollTop = box.scrollHeight; return;
    }

    const liveAuthor = currentUsersCachedMap[msgData.sender] || { name: "Usuario", nickname: "@" + msgData.sender, avatar: "" };
    const msgRow = document.createElement('div'); msgRow.classList.add('msg-row');
    if (currentUser && liveAuthor.nickname.toLowerCase() === currentUser.nickname.toLowerCase()) msgRow.classList.add('msg-row-me');

    const time = new Date(msgData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let contentHTML = `<p class="msg-body">${msgData.message}</p>`;
    if (msgData.type === 'sticker') {
        contentHTML = `<img src="${msgData.stickerUrl}" class="msg-sticker previewable-media-click" alt="Sticker">`;
    } else if (msgData.type === 'image') {
        contentHTML = `<img src="${msgData.mediaUrl}" class="msg-media-expanded previewable-media-click" alt="Foto">`;
    } else if (msgData.type === 'video') {
        contentHTML = `<video src="${msgData.mediaUrl}" controls playsinline muted class="msg-media-expanded previewable-media-click-video"></video>`;
    }

    msgRow.innerHTML = `
        <img src="${liveAuthor.avatar || ''}" class="custom-avatar" style="width:28px; height:28px; margin-bottom:4px;" alt="Avatar">
        <div class="msg-bubble">
            <div class="msg-meta"><span class="meta-name">${liveAuthor.name}</span><span class="meta-nick">${liveAuthor.nickname}</span></div>
            ${contentHTML}
            <span class="msg-time">${time}</span>
        </div>
    `;
    box.appendChild(msgRow);
    box.scrollTop = box.scrollHeight;
    attachUniversalMediaPreviewEvents();
};

const reloadMessagesUI = () => {
    document.getElementById('chat-box').innerHTML = "";
    allMessagesCache.forEach(msg => renderSingleMessageAppend(msg));
};

const attachUniversalMediaPreviewEvents = () => {
    document.querySelectorAll('.previewable-media-click').forEach(element => {
        element.onclick = (e) => {
            e.stopPropagation();
            const container = document.getElementById('media-viewer-container');
            container.innerHTML = `<img src="${element.src}">`;
            document.getElementById('sticker-viewer-overlay').classList.remove('hidden');
        };
    });
    document.querySelectorAll('.previewable-media-click-video').forEach(element => {
        element.onclick = (e) => {
            e.stopPropagation();
            const container = document.getElementById('media-viewer-container');
            container.innerHTML = `<video src="${element.src}" controls autoplay playsinline></video>`;
            document.getElementById('sticker-viewer-overlay').classList.remove('hidden');
        };
    });
};

document.getElementById('sticker-viewer-overlay').onclick = () => {
    document.getElementById('media-viewer-container').innerHTML = "";
    document.getElementById('sticker-viewer-overlay').classList.add('hidden');
};

// ==========================================================================
// MODALES CENTRALES
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
    if (e.target.files[0]) optimizeAndCompressMedia(e.target.files[0], (b64) => { tempModalAvatarBase64 = b64; modalAvatarImg.src = b64; });
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
            reloadMessagesUI();
        }
    });
}

const groupModal = document.getElementById('group-create-modal');
document.getElementById('open-group-modal-btn').onclick = async () => {
    const checklist = document.getElementById('group-members-checklist'); checklist.innerHTML = "";
    tempGroupAvatarBase64 = ""; document.getElementById('group-avatar-preview').textContent = "👥"; document.getElementById('group-name-input').value = "";

    Object.keys(currentUsersCachedMap).forEach(key => {
        if (currentUser && "@" + key === currentUser.nickname) return;
        const row = document.createElement('label'); row.classList.add('checklist-row-item');
        row.innerHTML = `<input type="checkbox" value="${key}"> <span>${currentUsersCachedMap[key].name} (@${key})</span>`;
        checklist.appendChild(row);
    });
    groupModal.classList.remove('hidden');
};
document.getElementById('close-group-modal-btn').onclick = () => groupModal.classList.add('hidden');

document.getElementById('group-avatar-input').onchange = (e) => {
    if (e.target.files[0]) { imageToConvert64(e.target.files[0], (b64) => { tempGroupAvatarBase64 = b64; document.getElementById('group-avatar-preview').innerHTML = `<img src="${b64}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`; }); }
};

document.getElementById('btn-save-group-submit').onclick = async () => {
    const gName = document.getElementById('group-name-input').value.trim();
    if (!gName) return alert("Ponle un nombre al grupo.");
    if (!tempGroupAvatarBase64) return alert("Sube una foto para el grupo.");
    const marked = []; document.querySelectorAll('#group-members-checklist input:checked').forEach(i => marked.push(i.value));
    const myKey = currentUser.nickname.replace('@', ''); marked.push(myKey);
    const groupKey = "group_" + Date.now();
    await set(ref(db, `groups/${groupKey}`), { name: gName, avatar: tempGroupAvatarBase64, members: marked });
    groupModal.classList.add('hidden'); NotificationSystem.showLocalToast("Grupo Creado");
};

// ==========================================================================
// REGISTRO Y LOGIN (ESCUDO ANTIBUGS REPARADO)
// ==========================================================================
document.getElementById('go-to-register').addEventListener('click', () => {
    document.getElementById('login-area').classList.add('hidden');
    document.getElementById('register-area').classList.remove('hidden');
});
document.getElementById('go-to-login').addEventListener('click', () => {
    document.getElementById('register-area').classList.add('hidden');
    document.getElementById('login-area').classList.remove('hidden');
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

const executeMessageSend = () => {
    const input = document.getElementById('message-input'); const msg = input.value.trim();
    if (msg && currentUser) {
        const myKey = currentUser.nickname.replace('@', '');
        const payload = { sender: myKey, message: msg, type: 'text', timestamp: Date.now() };
        if (currentChatTarget === "global") payload.channel = "global";
        else if (chatTargetType === "group") { payload.channel = "group"; payload.receiver = currentChatTarget; }
        else { payload.channel = "private"; payload.receiver = currentChatTarget; }
        push(ref(db, 'messages'), payload); input.value = '';
    }
};
document.getElementById('btn-send-message').onclick = executeMessageSend;
document.getElementById('message-input').onkeydown = (e) => { if (e.key === 'Enter') executeMessageSend(); };

document.getElementById('chat-media-input').onchange = (e) => {
    if (e.target.files[0] && currentUser) {
        const file = e.target.files[0]; const isVideo = file.type.startsWith('video/');
        NotificationSystem.showLocalToast(isVideo ? "Procesando video..." : "Subiendo imagen...");
        
        optimizeAndCompressMedia(file, (b64) => {
            const myKey = currentUser.nickname.replace('@', '');
            const payload = { sender: myKey, message: isVideo ? "[Video]" : "[Foto]", type: isVideo ? "video" : "image", mediaUrl: b64, timestamp: Date.now() };
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
    privateUnreadCounts["global"] = 0; document.getElementById('unread-badge-global').classList.add('hidden');
    reloadMessagesUI();
};

document.getElementById('btn-toggle-stickers').onclick = () => document.getElementById('stickers-panel').classList.toggle('hidden');
document.getElementById('upload-sticker-input').onchange = (e) => { if (e.target.files[0]) imageToConvert64(e.target.files[0], (b64) => push(ref(db, 'stickers'), { base64: b64 })); };

onChildAdded(ref(db, 'stickers'), (snap) => {
    const b64 = snap.val().base64; const grid = document.getElementById('stickers-grid'); const img = document.createElement('img'); img.src = b64; img.classList.add('grid-stk-img');
    img.onclick = () => {
        if (currentUser) {
            const myKey = currentUser.nickname.replace('@', '');
            const payload = { sender: myKey, message: '[Sticker]', type: 'sticker', stickerUrl: b64, timestamp: Date.now() };
            if (currentChatTarget === "global") payload.channel = "global";
            else if (chatTargetType === "group") { payload.channel = "group"; payload.receiver = currentChatTarget; }
            else { payload.channel = "private"; payload.receiver = currentChatTarget; }
            push(ref(db, 'messages'), payload); document.getElementById('stickers-panel').classList.add('hidden');
        }
    };
    grid.appendChild(img);
});

// ESCUCHA ASÍNCRONA CORREGIDA (SOLUCIONA SÍNCO DE MENSAJES AL INICIAR)
onChildAdded(ref(db, 'messages'), async (snapshot) => {
    const data = snapshot.val();
    allMessagesCache.push(data);

    const isNewMessage = data.timestamp > loginTimeMark;
    const isMe = currentUser && ("@" + data.sender).toLowerCase() === currentUser.nickname.toLowerCase();

    if (isNewMessage) {
        if (!isMe) NotificationSystem.trigger();
        if (data.channel === "global" && currentChatTarget !== "global") {
            privateUnreadCounts["global"] = (privateUnreadCounts["global"] || 0) + 1;
            const gb = document.getElementById('unread-badge-global'); if (gb) { gb.textContent = privateUnreadCounts["global"]; gb.classList.remove('hidden'); }
        } else if (data.channel === "group" && currentChatTarget !== data.receiver) { privateUnreadCounts[data.receiver] = (privateUnreadCounts[data.receiver] || 0) + 1; }
        else if (data.channel === "private" && data.sender !== currentChatTarget) { privateUnreadCounts[data.sender] = (privateUnreadCounts[data.sender] || 0) + 1; }
    }
    
    // Si el mapa de usuarios local todavía está vacío, forzar una lectura rápida para no dejar la pantalla en blanco
    if (Object.keys(currentUsersCachedMap).length === 0) {
        const snapUsers = await get(child(dbRef, 'users'));
        currentUsersCachedMap = snapUsers.val() || {};
    }
    renderSingleMessageAppend(data);
});

document.getElementById('btn-register-submit').onclick = async () => {
    const name = document.getElementById('reg-name').value.trim(); const nickname = document.getElementById('reg-nickname').value.trim(); const password = document.getElementById('reg-password').value;
    if (!name || !nickname || !password || !tempRegisterAvatar) return alert("Rellena todo.");
    try {
        const snap = await get(child(dbRef, `users/${nickname}`)); if (snap.exists()) return alert("Username ocupado.");
        const userData = { name, nickname: '@' + nickname, password, avatar: tempRegisterAvatar };
        await set(ref(db, `users/${nickname}`), userData);
        push(ref(db, 'messages'), { sender: "system", message: `✨ ¡${name} se ha unido a SayChat! Denle una cálida bienvenida.`, type: "system", channel: "global", timestamp: Date.now() });
        currentUser = userData; loginTimeMark = Date.now(); localStorage.setItem('chat_session_v5', JSON.stringify(currentUser)); initAppAfterLogin();
    } catch (err) { alert("Error."); }
};

document.getElementById('btn-login-submit').onclick = async () => {
    const nickname = document.getElementById('login-nickname').value.trim().toLowerCase(); const password = document.getElementById('login-password').value;
    try {
        const snap = await get(child(dbRef, `users/${nickname}`)); if (!snap.exists()) return alert("No existe.");
        const userData = snap.val(); if (userData.password !== password) return alert("Incorrecto.");
        currentUser = userData; loginTimeMark = Date.now(); localStorage.setItem('chat_session_v5', JSON.stringify(currentUser)); initAppAfterLogin();
    } catch (err) { alert("Error."); }
};

const initAppAfterLogin = async () => {
    document.getElementById('auth-screen').classList.add('hidden'); document.getElementById('chat-screen').classList.remove('hidden');
    document.getElementById('current-user-avatar').src = currentUser.avatar; document.getElementById('current-user-name').textContent = currentUser.name; document.getElementById('current-user-nickname').textContent = currentUser.nickname;
    
    // Forzar llenado inmediato de la caché antes de arrancar los oyentes
    const snapUsers = await get(child(dbRef, 'users'));
    currentUsersCachedMap = snapUsers.val() || {};
    
    PresenceSystem.init(); PresenceSystem.listenPresence();
};

document.getElementById('logout-btn').onclick = () => {
    PresenceSystem.updateState("offline"); currentUser = null; allMessagesCache = []; privateUnreadCounts = {};
    localStorage.removeItem('chat_session_v5'); document.getElementById('chat-screen').classList.add('hidden'); document.getElementById('auth-screen').classList.remove('hidden');
};

const savedSession = localStorage.getItem('chat_session_v5');
if (savedSession) { currentUser = JSON.parse(savedSession); initAppAfterLogin(); }
