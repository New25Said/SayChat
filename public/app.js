import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, push, onChildAdded, onChildChanged, onChildRemoved, get, child, set, update, remove, onValue, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";

// REGISTRO DE SERVICE WORKER PARA NOTIFICACIONES MÓVILES PWA
let swRegistration = null;
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(reg => { swRegistration = reg; })
        .catch(err => console.log('Error SW:', err));
}

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
let allMessagesCache = []; 
let baseTitle = "SayChat";
let originalFavicon = null;
let tempRegisterAvatar = "";
let tempModalAvatarBase64 = ""; 
let tempGroupAvatarBase64 = ""; 
let loginTimeMark = Date.now(); 
let currentUsersCachedMap = {}; 
let isMessageListenerAttached = false;
let selectedMsgIdForContext = null;
let selectedGroupIdForContext = null;
let isEditingGroupId = null;
let oldGroupData = null;
let typingUnsubscribe = null;
let typingTimeout = null;

const DEFAULT_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='%23e61955'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/></svg>";
const GEMINI_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23e61955'><path d='M12 22 L7.5 14.5 L16.5 14.5 Z'/><path d='M11.2 13.5 C5 12.5 2.5 5 2.5 5 C4.5 9 8 10.5 10.8 12.2 Z'/><path d='M12.8 13.5 C19 12.5 21.5 5 21.5 5 C19.5 9 16 10.5 13.2 12.2 Z'/><path d='M12 11.5 L8.5 6 L10.5 7 L12 2 L13.5 7 L15.5 6 Z'/></svg>";

const imageToConvert64 = (file, callback) => {
    const reader = new FileReader();
    reader.onloadend = () => callback(reader.result);
    reader.onerror = () => callback(DEFAULT_AVATAR);
    reader.readAsDataURL(file);
};

const optimizeAndCompressMedia = (file, callback) => {
    if (!file) return callback(DEFAULT_AVATAR);

    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const max_size = 400; 
                let width = img.width; let height = img.height;
                if (width > height) {
                    if (width > max_size) { height *= max_size / width; width = max_size; }
                } else {
                    if (height > max_size) { width *= max_size / height; height = max_size; }
                }
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                callback(canvas.toDataURL('image/jpeg', 0.6)); 
            };
            img.onerror = () => callback(DEFAULT_AVATAR);
            img.src = event.target.result;
        };
        reader.onerror = () => callback(DEFAULT_AVATAR);
        reader.readAsDataURL(file);
    } else if (file.type.startsWith('video/')) {
        const reader = new FileReader();
        reader.onloadend = () => { callback(reader.result); };
        reader.readAsDataURL(file);
    } else {
        callback(DEFAULT_AVATAR);
    }
};

const parseMarkdown = (text) => {
    if (!text) return "";
    let html = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/\*\*(.*?)\*\*/g, "<span class='md-bold'>$1</span>");
    html = html.replace(/\*(.*?)\*/g, "<span class='md-italic'>$1</span>");
    html = html.replace(/~(.*?)~/g, "<span class='md-strike'>$1</span>");
    html = html.replace(/`(.*?)`/g, "<span class='md-code'>$1</span>");
    html = html.replace(/\n/g, "<br>");
    html = html.replace(/!\[([^\]]*)\]\((.*?)\)/g, "<img src='$2' class='msg-media-expanded previewable-media-click' alt='$1' style='margin-top:5px;'>");
    return html;
};

const parseMentions = (text) => {
    if (!text) return "";
    return text.replace(/@([\w]+)/g, "<span class='mentioned-text'>@$1</span>");
};

// ==========================================================================
// NOTIFICACIONES (Soporte Sonido Nativo y Web Push sin Duplicados)
// ==========================================================================
const NotificationSystem = {
    trigger(bodyText = "Tienes mensajes nuevos", title = baseTitle) {
        
        // RESTAURADO EL SONIDO NOTI.MP3 PARA CUANDO LA APP ESTÁ ABIERTA EN EL NAVEGADOR
        const sound = document.getElementById('noti-sound');
        if (sound) {
            sound.currentTime = 0;
            const playPromise = sound.play();
            if (playPromise !== undefined) {
                playPromise.catch(e => console.log(e));
            }
        }

        if (!document.hasFocus()) {
            unreadCountGlobal++;
            document.title = `(${unreadCountGlobal}) ${baseTitle}`;
            this.updateFaviconBadge();
            
            if (Notification.permission === 'granted') {
                new Notification(title, { 
                    body: bodyText, 
                    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nI2U2MTk1NSc+PHBhdGggZD0nTTEyIDIyIEw3LjUgMTQuNSBMMTYuNSAxNC41IFonLz48cGF0aCBkPSdNMTEuMiAxMy41IEM1IDEyLjUgMi41IDUgMi41IDUgQzQuNSA5IDggMTAuNSAxMC44IDEyLjIgWicvPjxwYXRoIGQ9J00xMi44IDEzLjUgQzE5IDEyLjUgMjEuNSA1IDIxLjUgNSBDMTkuNSA5IDE2IDEwLjUgMTMuMiAxMi4yIFonLz48cGF0aCBkPSdNMTIgMTEuNSBMOC41IDYgTDEwLjUgNyBMMTIgMiBMMTMuNSA3IEwxNS41IDYgWicvPjwvc3ZnPg==",
                    silent: false
                    // ELIMINADA LA PARTICULA TAG AQUI
                });
            }
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
        if (toast) {
            toast.textContent = text; toast.classList.remove('hidden');
            setTimeout(() => toast.classList.add('hidden'), 2000);
        }
    }
};

window.addEventListener('focus', () => NotificationSystem.reset());

// ==========================================================================
// NOTIFICAR AL BACKEND PARA QUE ENVÍE EL PUSH AL CELULAR CERRADO
// ==========================================================================
const notifyBackendPush = async (payload) => {
    try {
        let tokens = [];
        const myKey = currentUser.nickname.replace('@', '');
        
        if (payload.channel === 'global') {
            Object.keys(currentUsersCachedMap).forEach(k => {
                if (k !== myKey && currentUsersCachedMap[k].fcmToken) tokens.push(currentUsersCachedMap[k].fcmToken);
            });
        } else if (payload.channel === 'private') {
            const target = currentUsersCachedMap[payload.receiver];
            if (target && target.fcmToken) tokens.push(target.fcmToken);
        } else if (payload.channel === 'group') {
            const snapG = await get(child(dbRef, `groups/${payload.receiver}`));
            const gData = snapG.val();
            if (gData && gData.members) {
                gData.members.forEach(k => {
                    if (k !== myKey && currentUsersCachedMap[k] && currentUsersCachedMap[k].fcmToken) {
                        tokens.push(currentUsersCachedMap[k].fcmToken);
                    }
                });
            }
        }

        if (tokens.length > 0) {
            let textPreview = payload.type === 'text' ? payload.message : (payload.type === 'image' ? '📷 Foto' : (payload.type === 'video' ? '🎥 Video' : '🏷️ Sticker'));
            await fetch('/api/send-push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: `${currentUser.name} (SayChat)`,
                    body: textPreview,
                    tokens: tokens
                })
            });
        }
    } catch(e) { console.log('Push api error', e); }
};

// ==========================================================================
// PRESENCIA Y LISTAS CON TIMEOUT DE 5 MINUTOS Y LIMPIEZA
// ==========================================================================
const PresenceSystem = {
    idleTimer: null,
    updateState(status) {
        if (!currentUser) return;
        const userKey = currentUser.nickname.replace('@', '');
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        set(ref(db, `presence/${userKey}`), { status: status, lastSeen: Date.now(), device: isMobile ? 'mobile' : 'desktop' });
    },
    init() {
        this.updateState("online");
        
        document.addEventListener("visibilitychange", () => { 
            if (document.visibilityState === "visible") {
                clearTimeout(this.idleTimer);
                this.updateState("online"); 
            } else {
                this.updateState("idle");
                this.idleTimer = setTimeout(() => {
                    this.updateState("offline");
                }, 5 * 60 * 1000); // 5 minutos de idle = offline
            }
        });
        
        const userKey = currentUser.nickname.replace('@', '');
        const userRef = ref(db, `presence/${userKey}`);
        onDisconnect(userRef).set({ status: "offline", lastSeen: Date.now(), device: null });
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
        const allGroups = snapGroups.exists() ? snapGroups.val() : {};

        document.querySelectorAll('.contact-list-row').forEach(row => {
            if (row.id.startsWith('group-row-')) {
                const gKey = row.id.replace('group-row-', '');
                const myKey = currentUser.nickname.replace('@', '');
                if (!allGroups[gKey] || !allGroups[gKey].members || !allGroups[gKey].members.includes(myKey)) {
                    row.remove();
                }
            }
        });

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
                    <div class="contact-avatar-wrapper"><img src="${group.avatar || DEFAULT_AVATAR}" class="custom-avatar" alt="Group"></div>
                    <div class="contact-info-block"><h4>${group.name}</h4><p class="contact-sub" style="color:var(--accent)">👥 Grupo de SayChat</p></div>
                    <span class="private-unread-badge hidden" id="unread-badge-${gKey}">0</span>
                `;
                existingRow.addEventListener('click', () => {
                    setTyping(false); // Limpiar escritura del chat anterior
                    currentChatTarget = gKey; chatTargetType = "group";
                    document.getElementById('btn-nav-global').classList.remove('active');
                    const gmBtn = document.getElementById('btn-nav-gemini'); if (gmBtn) gmBtn.classList.remove('active');
                    document.querySelectorAll('.contact-list-row').forEach(r => r.classList.remove('active'));
                    existingRow.classList.add('active');
                    document.getElementById('header-channel-title').textContent = `${group.name} (Grupo)`;
                    document.getElementById('header-channel-avatar').classList.add('hidden');
                    document.getElementById('header-channel-status').classList.add('hidden');
                    document.getElementById('btn-edit-active-group').classList.remove('hidden');
                    document.getElementById('btn-clear-gemini').classList.add('hidden');
                    privateUnreadCounts[gKey] = 0; 
                    const badge = document.getElementById(`unread-badge-${gKey}`);
                    if (badge) badge.classList.add('hidden');
                    reloadMessagesUI();
                    subscribeToTyping(); // Suscribir al nuevo canal
                });
                
                existingRow.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    selectedGroupIdForContext = gKey;
                    const gMenu = document.getElementById('group-context-menu');
                    if (gMenu) {
                        gMenu.style.left = `${e.pageX}px`;
                        gMenu.style.top = `${e.pageY}px`;
                        gMenu.classList.remove('hidden');
                    }
                });

                listContainer.appendChild(existingRow);
            } else {
                const textName = existingRow.querySelector('h4'); if (textName) textName.textContent = group.name;
                const imgAv = existingRow.querySelector('.custom-avatar'); if (imgAv) imgAv.src = group.avatar || DEFAULT_AVATAR;
            }
            const badge = document.getElementById(`unread-badge-${gKey}`);
            if (badge && privateUnreadCounts[gKey] > 0) { badge.textContent = privateUnreadCounts[gKey]; badge.classList.remove('hidden'); }
        });

        Object.keys(currentUsersCachedMap).forEach(key => {
            const user = currentUsersCachedMap[key];
            if (currentUser && user.nickname === currentUser.nickname) return;

            const userState = presenceData[key] ? presenceData[key].status : "offline";
            let deviceIcon = "";
            if (userState !== "offline" && presenceData[key] && presenceData[key].device) {
                deviceIcon = presenceData[key].device === 'mobile' ? " 📱" : " 💻";
            }
            
            let existingRow = document.getElementById(`user-row-${key}`);

            if (!existingRow) {
                existingRow = document.createElement('div'); existingRow.id = `user-row-${key}`; existingRow.classList.add('contact-list-row');
                existingRow.innerHTML = `
                    <div class="contact-avatar-wrapper">
                        <img src="${user.avatar || DEFAULT_AVATAR}" class="custom-avatar target-user-img" alt="Avatar">
                        <span class="status-indicator-dot ${userState}"></span>
                    </div>
                    <div class="contact-info-block"><h4 class="target-user-name">${user.name}${deviceIcon}</h4><p class="contact-sub">${user.nickname}</p></div>
                    <span class="private-unread-badge hidden" id="unread-badge-${key}">0</span>
                `;
                existingRow.addEventListener('click', () => {
                    setTyping(false); // Limpiar escritura
                    currentChatTarget = key; chatTargetType = "private";
                    document.getElementById('btn-nav-global').classList.remove('active');
                    const gmBtn = document.getElementById('btn-nav-gemini'); if (gmBtn) gmBtn.classList.remove('active');
                    document.querySelectorAll('.contact-list-row').forEach(r => r.classList.remove('active'));
                    existingRow.classList.add('active');
                    document.getElementById('header-channel-title').textContent = `${user.name} (@${key})`;
                    document.getElementById('btn-edit-active-group').classList.add('hidden');
                    document.getElementById('btn-clear-gemini').classList.add('hidden');
                    
                    const headAv = document.getElementById('header-channel-avatar');
                    const headSt = document.getElementById('header-channel-status');
                    if (headAv) { headAv.src = user.avatar || DEFAULT_AVATAR; headAv.classList.remove('hidden'); }
                    if (headSt) {
                        if (user.statusText) { headSt.textContent = user.statusText; headSt.classList.remove('hidden'); }
                        else { headSt.classList.add('hidden'); }
                    }

                    privateUnreadCounts[key] = 0; 
                    const badge = document.getElementById(`unread-badge-${key}`);
                    if (badge) badge.classList.add('hidden');
                    reloadMessagesUI();
                    subscribeToTyping(); // Suscribir al nuevo canal
                });
                listContainer.appendChild(existingRow);
            } else {
                const dot = existingRow.querySelector('.status-indicator-dot'); if (dot) dot.className = `status-indicator-dot ${userState}`;
                const textName = existingRow.querySelector('.target-user-name'); if (textName) textName.textContent = user.name + deviceIcon;
                const imgAv = existingRow.querySelector('.target-user-img'); if (imgAv) imgAv.src = user.avatar || DEFAULT_AVATAR;
            }
            const badge = document.getElementById(`unread-badge-${key}`);
            if (badge && privateUnreadCounts[key] > 0) { badge.textContent = privateUnreadCounts[key]; badge.classList.remove('hidden'); }
        });
    }
};

// ==========================================================================
// INDICADOR DE ESCRITURA EN TIEMPO REAL (Animación persistente y timer IA)
// ==========================================================================
const getTypingChannelId = () => {
    if (chatTargetType === 'global') return 'global';
    if (chatTargetType === 'group') return currentChatTarget;
    if (chatTargetType === 'gemini') {
        const myKey = currentUser.nickname.replace('@', '');
        return `gemini_${myKey}`;
    }
    const myKey = currentUser.nickname.replace('@', '');
    const keys = [myKey, currentChatTarget].sort();
    return `private_${keys[0]}_${keys[1]}`;
};

const subscribeToTyping = () => {
    if (typingUnsubscribe) typingUnsubscribe();
    if (!currentUser) return;
    const channelId = getTypingChannelId();
    typingUnsubscribe = onValue(ref(db, `typing/${channelId}`), (snapshot) => {
        renderTypingIndicators(snapshot.val() || {});
    });
};

const renderTypingIndicators = (typingData) => {
    const container = document.getElementById('typing-container');
    if (!container) return;
    
    // Filtrar quién está escribiendo (IA tiene 60s, humanos 6s)
    const typingUsers = Object.keys(typingData).filter(key => {
        if (currentUser && key === currentUser.nickname.replace('@', '')) return false;
        const timeout = key === 'gemini' ? 60000 : 6000;
        return (Date.now() - typingData[key]) < timeout;
    });

    if (typingUsers.length === 0) {
        container.classList.add('hidden');
        container.innerHTML = ''; // Limpieza segura si no hay nadie
        return;
    }

    container.classList.remove('hidden');
    
    // Eliminar del DOM a los que ya NO están escribiendo
    Array.from(container.children).forEach(child => {
        if (!typingUsers.includes(child.dataset.userKey)) {
            child.remove();
        }
    });

    // Agregar solo a los NUEVOS que no están en el DOM
    typingUsers.forEach(key => {
        if (!container.querySelector(`[data-user-key="${key}"]`)) {
            let user;
            if (key === 'gemini') {
                user = { name: "Klain IA", avatar: GEMINI_AVATAR };
            } else {
                user = currentUsersCachedMap[key] || { name: "Usuario", avatar: DEFAULT_AVATAR };
            }
            
            const wrapper = document.createElement('div');
            wrapper.dataset.userKey = key;
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.gap = '8px';
            wrapper.innerHTML = `
                <img src="${user.avatar}" class="typing-avatar" title="${user.name} está escribiendo...">
                <div class="typing-dots"><span></span><span></span><span></span></div>
            `;
            container.appendChild(wrapper);
        }
    });
    
    const box = document.getElementById('chat-box');
    if (box) box.scrollTop = box.scrollHeight;
};

const setTyping = (isTyping) => {
    if(!currentUser) return;
    const myKey = currentUser.nickname.replace('@', '');
    const channelId = getTypingChannelId();
    
    if (isTyping) {
        set(ref(db, `typing/${channelId}/${myKey}`), Date.now());
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            remove(ref(db, `typing/${channelId}/${myKey}`));
        }, 4000);
    } else {
        remove(ref(db, `typing/${channelId}/${myKey}`));
        clearTimeout(typingTimeout);
    }
};

window.addEventListener('beforeunload', () => {
    if (currentUser) {
        setTyping(false);
    }
});

// ==========================================================================
// RENDERIZADO DE MENSAJES Y CONTEXTO
// ==========================================================================
const ctxMenu = document.getElementById('msg-context-menu');
const groupCtxMenu = document.getElementById('group-context-menu');

document.addEventListener('click', () => { 
    if (ctxMenu) ctxMenu.classList.add('hidden'); 
    if (groupCtxMenu) groupCtxMenu.classList.add('hidden');
});

const btnDeleteGroup = document.getElementById('btn-delete-group');
if (btnDeleteGroup) {
    btnDeleteGroup.onclick = async () => {
        if (selectedGroupIdForContext) {
            const confirmDelete = confirm("¿Estás seguro de que deseas eliminar este grupo para todos?");
            if (confirmDelete) {
                await remove(ref(db, `groups/${selectedGroupIdForContext}`));
                if (currentChatTarget === selectedGroupIdForContext) {
                    document.getElementById('btn-nav-global').click();
                }
            }
        }
    };
}

const btnClearGemini = document.getElementById('btn-clear-gemini');
if (btnClearGemini) {
    btnClearGemini.onclick = async () => {
        if(confirm("¿Seguro que quieres vaciar tu historial con la Inteligencia Artificial? (Esto es irreversible)")) {
            const myKey = currentUser.nickname.replace('@', '');
            const updates = {};
            let count = 0;
            allMessagesCache.forEach(m => {
                if (m.channel === 'gemini' && (m.sender === myKey || m.receiver === myKey)) {
                    updates[m.key] = null;
                    count++;
                }
            });
            if (count > 0) {
                await update(ref(db, 'messages'), updates);
                NotificationSystem.showLocalToast("Historial Vaciado");
            }
        }
    };
}

const renderSingleMessageAppend = (msgData) => {
    let shouldRender = false;
    if (currentChatTarget === "global" && msgData.channel === "global") shouldRender = true;
    else if (chatTargetType === "private" && msgData.channel === "private") {
        const myKey = currentUser ? currentUser.nickname.replace('@', '') : '';
        if ((msgData.sender === myKey && msgData.receiver === currentChatTarget) || (msgData.sender === currentChatTarget && msgData.receiver === myKey)) shouldRender = true;
    } else if (chatTargetType === "group" && msgData.channel === "group" && msgData.receiver === currentChatTarget) shouldRender = true;
    else if (chatTargetType === "gemini" && msgData.channel === "gemini") {
        const myKey = currentUser ? currentUser.nickname.replace('@', '') : '';
        if ((msgData.sender === myKey && msgData.receiver === 'gemini') || (msgData.sender === 'gemini' && msgData.receiver === myKey)) shouldRender = true;
    }

    if (!shouldRender) return;

    const box = document.getElementById('chat-box');
    if (!box) return;

    if (msgData.type === 'system') {
        const sysDiv = document.createElement('div'); sysDiv.classList.add('msg-system-line'); sysDiv.textContent = msgData.message;
        box.appendChild(sysDiv); box.scrollTop = box.scrollHeight; return;
    }

    if (msgData.type === 'system-html') {
        const sysDiv = document.createElement('div'); sysDiv.classList.add('msg-system-line'); sysDiv.innerHTML = msgData.message;
        box.appendChild(sysDiv); box.scrollTop = box.scrollHeight; return;
    }

    let liveAuthor;
    if (msgData.sender === 'gemini') {
        liveAuthor = { name: "Klain IA", nickname: "@klain", avatar: GEMINI_AVATAR };
    } else {
        liveAuthor = currentUsersCachedMap[msgData.sender] || { name: "Usuario", nickname: "@" + msgData.sender, avatar: DEFAULT_AVATAR };
    }

    const msgRow = document.createElement('div'); msgRow.classList.add('msg-row');
    
    let isMe = false;
    if (currentUser && liveAuthor.nickname.toLowerCase() === currentUser.nickname.toLowerCase()) {
        msgRow.classList.add('msg-row-me');
        isMe = true;
    }

    const time = new Date(msgData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let contentHTML = "";
    let isMentioned = false;

    if (currentUser && msgData.type === 'text' && msgData.message && !msgData.isDeleted) {
        const myNick = currentUser.nickname.replace('@', '');
        const mentionRegex = new RegExp(`@${myNick}(?!\\w)`, 'i');
        if (mentionRegex.test(msgData.message)) {
            isMentioned = true;
        }
    }

    if (msgData.isDeleted) {
        contentHTML = `<p class="msg-body" style="font-style:italic; color:var(--text-muted);">Mensaje eliminado</p>`;
    } else {
        if (msgData.type === 'sticker') {
            contentHTML = `<img src="${msgData.stickerUrl}" class="msg-sticker previewable-media-click" alt="Sticker">`;
        } else if (msgData.type === 'image') {
            contentHTML = `<img src="${msgData.mediaUrl}" class="msg-media-expanded previewable-media-click" alt="Foto">`;
        } else if (msgData.type === 'video') {
            contentHTML = `<video src="${msgData.mediaUrl}" controls playsinline muted class="msg-media-expanded previewable-media-click-video"></video>`;
        } else {
            contentHTML = `<p class="msg-body">${parseMentions(parseMarkdown(msgData.message))}</p>`;
        }
    }

    let editedTag = (!msgData.isDeleted && msgData.isEdited) ? `<div class="msg-edited-tag" style="font-size:10px; color:var(--text-muted); text-align:right; margin-top:3px; font-style:italic;">Mensaje Editado</div>` : "";
    let glowClass = isMentioned ? "msg-mention-glow" : "";

    msgRow.innerHTML = `
        <img src="${liveAuthor.avatar || DEFAULT_AVATAR}" class="custom-avatar" style="width:24px; height:24px; margin-bottom:2px;" alt="Avatar">
        <div class="msg-bubble ${glowClass}">
            <div class="msg-meta"><span class="meta-name">${liveAuthor.name}</span><span class="meta-nick">${liveAuthor.nickname}</span></div>
            ${contentHTML}
            ${editedTag}
            <span class="msg-time">${time}</span>
        </div>
    `;

    if (isMe && !msgData.isDeleted) {
        msgRow.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            selectedMsgIdForContext = msgData.key;
            if (ctxMenu) {
                ctxMenu.style.left = `${e.pageX}px`;
                ctxMenu.style.top = `${e.pageY}px`;
                ctxMenu.classList.remove('hidden');
            }
        });
    }

    box.appendChild(msgRow);
    box.scrollTop = box.scrollHeight;
    
    if (isMentioned) {
        setTimeout(() => {
            const bubble = msgRow.querySelector('.msg-mention-glow');
            if (bubble) bubble.classList.remove('msg-mention-glow');
        }, 5 * 60 * 1000); 
    }

    attachUniversalMediaPreviewEvents();
};

const btnDeleteMsg = document.getElementById('btn-delete-msg');
if (btnDeleteMsg) {
    btnDeleteMsg.onclick = () => {
        if (selectedMsgIdForContext) update(ref(db, `messages/${selectedMsgIdForContext}`), { isDeleted: true });
    };
}
const btnEditMsg = document.getElementById('btn-edit-msg');
if (btnEditMsg) {
    btnEditMsg.onclick = () => {
        if (selectedMsgIdForContext) {
            const newText = prompt("Edita tu mensaje:");
            if (newText) update(ref(db, `messages/${selectedMsgIdForContext}`), { message: newText, isEdited: true });
        }
    };
}

const reloadMessagesUI = () => {
    const box = document.getElementById('chat-box');
    if (box) {
        box.innerHTML = "";
        allMessagesCache.forEach(msg => renderSingleMessageAppend(msg));
    }
};

const attachUniversalMediaPreviewEvents = () => {
    document.querySelectorAll('.previewable-media-click').forEach(element => {
        element.onclick = (e) => {
            e.stopPropagation();
            const container = document.getElementById('media-viewer-container');
            if (container) {
                container.innerHTML = `<img src="${element.src}">`;
                document.getElementById('sticker-viewer-overlay').classList.remove('hidden');
            }
        };
    });
    document.querySelectorAll('.previewable-media-click-video').forEach(element => {
        element.onclick = (e) => {
            e.stopPropagation();
            const container = document.getElementById('media-viewer-container');
            if (container) {
                container.innerHTML = `<video src="${element.src}" controls autoplay playsinline></video>`;
                document.getElementById('sticker-viewer-overlay').classList.remove('hidden');
            }
        };
    });
};

const stickerOverlay = document.getElementById('sticker-viewer-overlay');
if (stickerOverlay) {
    stickerOverlay.onclick = () => {
        const container = document.getElementById('media-viewer-container');
        if (container) container.innerHTML = "";
        stickerOverlay.classList.add('hidden');
    };
}

// ==========================================================================
// MODALES CENTRALES Y GRUPOS
// ==========================================================================
const modalOverlay = document.getElementById('profile-edit-modal');
const openModalBtn = document.getElementById('open-profile-modal-btn');
const closeModalBtn = document.getElementById('close-profile-modal-btn');
const saveProfileBtn = document.getElementById('btn-save-profile-modal');
const modalAvatarImg = document.getElementById('modal-user-avatar');
const modalNameInput = document.getElementById('edit-name-input');
const modalStatusInput = document.getElementById('edit-status-input');
const removeStatusBtn = document.getElementById('btn-remove-status');

if (openModalBtn) {
    openModalBtn.addEventListener('click', () => {
        if (currentUser) {
            modalAvatarImg.src = currentUser.avatar || DEFAULT_AVATAR; 
            modalNameInput.value = currentUser.name;
            if(modalStatusInput) modalStatusInput.value = currentUser.statusText || "";
            tempModalAvatarBase64 = currentUser.avatar || DEFAULT_AVATAR; 
            modalOverlay.classList.remove('hidden');
        }
    });
}
if (closeModalBtn) closeModalBtn.addEventListener('click', () => modalOverlay.classList.add('hidden'));

if (removeStatusBtn) removeStatusBtn.addEventListener('click', () => { if(modalStatusInput) modalStatusInput.value = ""; });

const editAvatarInput = document.getElementById('edit-avatar');
if (editAvatarInput) {
    editAvatarInput.addEventListener('change', (e) => {
        if (e.target.files[0]) optimizeAndCompressMedia(e.target.files[0], (b64) => { tempModalAvatarBase64 = b64; modalAvatarImg.src = b64; });
    });
}

if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', async () => {
        const newName = modalNameInput.value.trim();
        const newStatus = modalStatusInput ? modalStatusInput.value.trim() : "";
        if (newName.length < 3 || newName.length > 50) return alert("El nombre debe tener entre 3 y 50 letras.");
        if (currentUser) {
            const userKey = currentUser.nickname.replace('@', '');
            await update(ref(db, `users/${userKey}`), { name: newName, avatar: tempModalAvatarBase64, statusText: newStatus });
            currentUser.name = newName; currentUser.avatar = tempModalAvatarBase64; currentUser.statusText = newStatus;
            localStorage.setItem('chat_session_v5', JSON.stringify(currentUser));
            
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            document.getElementById('current-user-avatar').src = currentUser.avatar;
            document.getElementById('current-user-name').textContent = currentUser.name + (isMobile ? " 📱" : " 💻");
            
            modalOverlay.classList.add('hidden');
            NotificationSystem.showLocalToast("Perfil Guardado");
            reloadMessagesUI();
        }
    });
}

const groupModal = document.getElementById('group-create-modal');
const openGroupBtn = document.getElementById('open-group-modal-btn');
const btnEditActiveGroup = document.getElementById('btn-edit-active-group');

if (openGroupBtn) {
    openGroupBtn.onclick = () => {
        isEditingGroupId = null; oldGroupData = null;
        document.getElementById('group-modal-title').textContent = "Crear Nuevo Grupo";
        document.getElementById('btn-save-group-submit').textContent = "Construir Grupo";
        const checklist = document.getElementById('group-members-checklist'); checklist.innerHTML = "";
        tempGroupAvatarBase64 = ""; document.getElementById('group-avatar-preview').innerHTML = "👥"; document.getElementById('group-name-input').value = "";

        Object.keys(currentUsersCachedMap).forEach(key => {
            if (currentUser && "@" + key === currentUser.nickname) return;
            const row = document.createElement('label'); row.classList.add('checklist-row-item');
            row.innerHTML = `<input type="checkbox" value="${key}"> <span>${currentUsersCachedMap[key].name} (@${key})</span>`;
            checklist.appendChild(row);
        });
        groupModal.classList.remove('hidden');
    };
}

if (btnEditActiveGroup) {
    btnEditActiveGroup.onclick = async () => {
        if (chatTargetType !== 'group') return;
        isEditingGroupId = currentChatTarget;
        
        const snapG = await get(child(dbRef, `groups/${currentChatTarget}`));
        oldGroupData = snapG.val();
        if(!oldGroupData) return;

        document.getElementById('group-modal-title').textContent = "Editar Grupo";
        document.getElementById('btn-save-group-submit').textContent = "Guardar Cambios";
        
        document.getElementById('group-name-input').value = oldGroupData.name;
        tempGroupAvatarBase64 = oldGroupData.avatar || DEFAULT_AVATAR;
        document.getElementById('group-avatar-preview').innerHTML = `<img src="${tempGroupAvatarBase64}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;

        const checklist = document.getElementById('group-members-checklist'); checklist.innerHTML = "";
        Object.keys(currentUsersCachedMap).forEach(key => {
            if (currentUser && "@" + key === currentUser.nickname) return;
            const row = document.createElement('label'); row.classList.add('checklist-row-item');
            const isChecked = oldGroupData.members && oldGroupData.members.includes(key) ? "checked" : "";
            row.innerHTML = `<input type="checkbox" value="${key}" ${isChecked}> <span>${currentUsersCachedMap[key].name} (@${key})</span>`;
            checklist.appendChild(row);
        });
        groupModal.classList.remove('hidden');
    }
}

const closeGroupBtn = document.getElementById('close-group-modal-btn');
if (closeGroupBtn) closeGroupBtn.onclick = () => groupModal.classList.add('hidden');

const groupAvatarInput = document.getElementById('group-avatar-input');
if (groupAvatarInput) {
    groupAvatarInput.onchange = (e) => {
        if (e.target.files[0]) { imageToConvert64(e.target.files[0], (b64) => { tempGroupAvatarBase64 = b64; document.getElementById('group-avatar-preview').innerHTML = `<img src="${b64}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`; }); }
    };
}

const saveGroupBtn = document.getElementById('btn-save-group-submit');
if (saveGroupBtn) {
    saveGroupBtn.onclick = async () => {
        const gName = document.getElementById('group-name-input').value.trim();
        if (!gName) return alert("Ponle un nombre al grupo.");
        if (!tempGroupAvatarBase64) tempGroupAvatarBase64 = DEFAULT_AVATAR;
        const marked = []; document.querySelectorAll('#group-members-checklist input:checked').forEach(i => marked.push(i.value));
        const myKey = currentUser.nickname.replace('@', ''); marked.push(myKey);
        
        if (isEditingGroupId && oldGroupData) {
            await update(ref(db, `groups/${isEditingGroupId}`), { name: gName, avatar: tempGroupAvatarBase64, members: marked });
            
            if (oldGroupData.name !== gName) {
                push(ref(db, 'messages'), { sender: myKey, message: `${currentUser.name} ha cambiado el nombre del grupo de ${oldGroupData.name} a ${gName}`, type: "system", channel: "group", receiver: isEditingGroupId, timestamp: Date.now() });
            }
            if (oldGroupData.avatar !== tempGroupAvatarBase64 && tempGroupAvatarBase64 !== DEFAULT_AVATAR) {
                push(ref(db, 'messages'), { sender: myKey, message: `Icono cambiado <img src='${oldGroupData.avatar}' class='sys-avatar-chg'> ➡️ <img src='${tempGroupAvatarBase64}' class='sys-avatar-chg'> por ${currentUser.name}`, type: "system-html", channel: "group", receiver: isEditingGroupId, timestamp: Date.now() });
            }
            
            if (currentChatTarget === isEditingGroupId) document.getElementById('header-channel-title').textContent = `${gName} (Grupo)`;

            groupModal.classList.add('hidden'); NotificationSystem.showLocalToast("Grupo Editado");
        } else {
            const groupKey = "group_" + Date.now();
            await set(ref(db, `groups/${groupKey}`), { name: gName, avatar: tempGroupAvatarBase64, members: marked });
            groupModal.classList.add('hidden'); NotificationSystem.showLocalToast("Grupo Creado");
        }
    };
}

// ==========================================================================
// REGISTRO, LOGIN Y NAVEGACIÓN
// ==========================================================================
const goToRegister = document.getElementById('go-to-register');
if (goToRegister) {
    goToRegister.addEventListener('click', () => {
        document.getElementById('login-area').classList.add('hidden');
        document.getElementById('register-area').classList.remove('hidden');
    });
}

const goToLogin = document.getElementById('go-to-login');
if (goToLogin) {
    goToLogin.addEventListener('click', () => {
        document.getElementById('register-area').classList.add('hidden');
        document.getElementById('login-area').classList.remove('hidden');
    });
}

const regAvatar = document.getElementById('reg-avatar');
if (regAvatar) {
    regAvatar.addEventListener('change', (e) => {
        if (e.target.files[0]) {
            optimizeAndCompressMedia(e.target.files[0], (base64) => {
                tempRegisterAvatar = base64;
                const preview = document.getElementById('reg-preview');
                if (preview) {
                    preview.src = base64; 
                    preview.classList.remove('hidden');
                }
                const label = document.getElementById('label-reg-avatar');
                if (label) label.textContent = "Foto Lista ✓";
            });
        }
    });
}

const triggerGeminiReply = (myKey, textMsg, mediaB64 = null) => {
    const channelId = getTypingChannelId();
    set(ref(db, `typing/${channelId}/gemini`), Date.now());

    const historyForGemini = allMessagesCache
        .filter(m => m.channel === 'gemini' && !m.isDeleted && ((m.sender === myKey && m.receiver === 'gemini') || (m.sender === 'gemini' && m.receiver === myKey)))
        .map(m => {
            let parts = [];
            if (m.type === 'text') {
                parts.push({ text: m.message });
            } else if (m.type === 'image' || m.type === 'sticker') {
                if (m.mediaUrl || m.stickerUrl) {
                    parts.push({ inlineData: { data: (m.mediaUrl || m.stickerUrl).split(',')[1], mimeType: 'image/jpeg' } });
                }
                parts.push({ text: m.message || "Imagen adjunta" });
            }
            return {
                role: m.sender === 'gemini' ? 'model' : 'user',
                parts: parts
            };
        });
    
    if(historyForGemini.length > 0 && historyForGemini[historyForGemini.length - 1].role === 'user') {
        historyForGemini.pop();
    }

    fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: textMsg, mediaBase64: mediaB64, history: historyForGemini })
    })
    .then(res => res.json())
    .then(data => {
        if(data.reply) {
            push(ref(db, 'messages'), { sender: 'gemini', receiver: myKey, channel: 'gemini', message: data.reply, type: 'text', timestamp: Date.now() });
        }
    }).catch(console.error).finally(() => {
        remove(ref(db, `typing/${channelId}/gemini`));
    });
};

const executeMessageSend = () => {
    const input = document.getElementById('message-input'); 
    const msg = input.value.trim();
    if (msg && currentUser) {
        const myKey = currentUser.nickname.replace('@', '');
        const payload = { sender: myKey, message: msg, type: 'text', timestamp: Date.now() };
        
        if (currentChatTarget === "global") payload.channel = "global";
        else if (chatTargetType === "group") { payload.channel = "group"; payload.receiver = currentChatTarget; }
        else if (chatTargetType === "gemini") { payload.channel = "gemini"; payload.receiver = "gemini"; }
        else { payload.channel = "private"; payload.receiver = currentChatTarget; }
        
        push(ref(db, 'messages'), payload)
            .then(() => { 
                input.value = ''; document.getElementById('mentions-dropdown').classList.add('hidden');
                setTyping(false); 
                notifyBackendPush(payload); 
                if (chatTargetType === "gemini") {
                    triggerGeminiReply(myKey, msg, null);
                }
            })
            .catch((err) => { alert("Error al enviar mensaje: " + err.message); });
    }
};

const sendMsgBtn = document.getElementById('btn-send-message');
if (sendMsgBtn) sendMsgBtn.onclick = executeMessageSend;

const msgInput = document.getElementById('message-input');
const mentionsDropdown = document.getElementById('mentions-dropdown');

if (msgInput) {
    msgInput.onkeydown = (e) => { if (e.key === 'Enter') executeMessageSend(); };
    msgInput.addEventListener('input', async () => {
        const val = msgInput.value;
        
        if (val.trim().length > 0) {
            setTyping(true);
        } else {
            setTyping(false);
        }

        const cursorStart = msgInput.selectionStart;
        const textBeforeCursor = val.slice(0, cursorStart);
        const match = textBeforeCursor.match(/@([\w]*)$/); 

        if (match && currentUser) {
            const searchStr = match[1].toLowerCase();
            let availableUsers = Object.keys(currentUsersCachedMap).filter(k => k !== currentUser.nickname.replace('@',''));

            if (chatTargetType === 'group') {
                const snapG = await get(child(dbRef, `groups/${currentChatTarget}`));
                const gData = snapG.val();
                if (gData && gData.members) {
                    availableUsers = availableUsers.filter(k => gData.members.includes(k));
                }
            } else if (chatTargetType === 'private') {
                 availableUsers = availableUsers.filter(k => k === currentChatTarget);
            }

            const filtered = availableUsers.filter(k => k.toLowerCase().includes(searchStr) || currentUsersCachedMap[k].name.toLowerCase().includes(searchStr));

            if (filtered.length > 0 && mentionsDropdown) {
                mentionsDropdown.innerHTML = '';
                filtered.forEach(k => {
                    const u = currentUsersCachedMap[k];
                    const div = document.createElement('div');
                    div.className = 'mention-item';
                    div.innerHTML = `<img src="${u.avatar||DEFAULT_AVATAR}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;"> <span>${u.name} <span style="color:var(--text-muted); font-size:10px;">(@${k})</span></span>`;
                    div.onclick = () => {
                        const before = val.slice(0, cursorStart - match[0].length);
                        const after = val.slice(cursorStart);
                        msgInput.value = before + '@' + k + ' ' + after;
                        mentionsDropdown.classList.add('hidden');
                        msgInput.focus();
                    };
                    mentionsDropdown.appendChild(div);
                });
                mentionsDropdown.classList.remove('hidden');
            } else if(mentionsDropdown) {
                mentionsDropdown.classList.add('hidden');
            }
        } else if(mentionsDropdown) {
            mentionsDropdown.classList.add('hidden');
        }
    });
}

document.addEventListener('click', (e) => {
    if (mentionsDropdown && !mentionsDropdown.contains(e.target) && e.target !== msgInput) {
        mentionsDropdown.classList.add('hidden');
    }
});

const chatMediaInput = document.getElementById('chat-media-input');
if (chatMediaInput) {
    chatMediaInput.onchange = (e) => {
        if (e.target.files[0] && currentUser) {
            const file = e.target.files[0]; const isVideo = file.type.startsWith('video/');
            NotificationSystem.showLocalToast(isVideo ? "Procesando video..." : "Subiendo imagen...");
            
            optimizeAndCompressMedia(file, (b64) => {
                const myKey = currentUser.nickname.replace('@', '');
                const payload = { sender: myKey, message: isVideo ? "[Video]" : "[Foto]", type: isVideo ? "video" : "image", mediaUrl: b64, timestamp: Date.now() };
                
                if (currentChatTarget === "global") payload.channel = "global";
                else if (chatTargetType === "group") { payload.channel = "group"; payload.receiver = currentChatTarget; }
                else if (chatTargetType === "gemini") { payload.channel = "gemini"; payload.receiver = "gemini"; }
                else { payload.channel = "private"; payload.receiver = currentChatTarget; }
                
                push(ref(db, 'messages'), payload).then(() => {
                    notifyBackendPush(payload); 
                    if (chatTargetType === "gemini") {
                        triggerGeminiReply(myKey, isVideo ? "[Video adjunto. Klain, avísame que aún no puedes ver videos fluidamente.]" : "[Foto adjunta. Describe qué ves]", isVideo ? null : b64);
                    }
                });
            });
        }
    };
}

const navGlobalBtn = document.getElementById('btn-nav-global');
if (navGlobalBtn) {
    navGlobalBtn.onclick = () => {
        setTyping(false);
        currentChatTarget = "global"; chatTargetType = "global";
        navGlobalBtn.classList.add('active');
        const gmBtn = document.getElementById('btn-nav-gemini'); if (gmBtn) gmBtn.classList.remove('active');
        document.querySelectorAll('.contact-list-row').forEach(r => { if(r.id !== 'btn-nav-global') r.classList.remove('active'); });
        document.getElementById('header-channel-title').textContent = "SayChat // Global";
        document.getElementById('header-channel-avatar').classList.add('hidden');
        document.getElementById('header-channel-status').classList.add('hidden');
        document.getElementById('btn-edit-active-group').classList.add('hidden');
        document.getElementById('btn-clear-gemini').classList.add('hidden');
        privateUnreadCounts["global"] = 0; 
        const badge = document.getElementById('unread-badge-global');
        if (badge) badge.classList.add('hidden');
        reloadMessagesUI();
        subscribeToTyping();
    };
}

const navGeminiBtn = document.getElementById('btn-nav-gemini');
if (navGeminiBtn) {
    navGeminiBtn.onclick = () => {
        setTyping(false);
        currentChatTarget = "gemini"; chatTargetType = "gemini";
        navGeminiBtn.classList.add('active');
        document.querySelectorAll('.contact-list-row').forEach(r => { if(r.id !== 'btn-nav-gemini') r.classList.remove('active'); });
        document.getElementById('header-channel-title').textContent = "SayChat // Klain IA";
        const headAv = document.getElementById('header-channel-avatar');
        headAv.src = GEMINI_AVATAR;
        headAv.classList.remove('hidden');
        const headSt = document.getElementById('header-channel-status');
        headSt.textContent = "IA Oficial";
        headSt.classList.remove('hidden');
        document.getElementById('btn-edit-active-group').classList.add('hidden');
        document.getElementById('btn-clear-gemini').classList.remove('hidden'); 
        privateUnreadCounts["gemini"] = 0; 
        const badge = document.getElementById('unread-badge-gemini');
        if (badge) badge.classList.add('hidden');
        reloadMessagesUI();
        subscribeToTyping();
    };
}

const toggleStickersBtn = document.getElementById('btn-toggle-stickers');
if (toggleStickersBtn) toggleStickersBtn.onclick = () => document.getElementById('stickers-panel').classList.toggle('hidden');

const uploadStickerInput = document.getElementById('upload-sticker-input');
if (uploadStickerInput) uploadStickerInput.onchange = (e) => { if (e.target.files[0]) imageToConvert64(e.target.files[0], (b64) => push(ref(db, 'stickers'), { base64: b64 })); };

onChildAdded(ref(db, 'stickers'), (snap) => {
    const b64 = snap.val().base64; const grid = document.getElementById('stickers-grid'); 
    if (grid) {
        const img = document.createElement('img'); img.src = b64; img.classList.add('grid-stk-img');
        img.onclick = () => {
            if (currentUser) {
                const myKey = currentUser.nickname.replace('@', '');
                const payload = { sender: myKey, message: '[Sticker]', type: 'sticker', stickerUrl: b64, timestamp: Date.now() };
                
                if (currentChatTarget === "global") payload.channel = "global";
                else if (chatTargetType === "group") { payload.channel = "group"; payload.receiver = currentChatTarget; }
                else if (chatTargetType === "gemini") { payload.channel = "gemini"; payload.receiver = "gemini"; }
                else { payload.channel = "private"; payload.receiver = currentChatTarget; }
                
                push(ref(db, 'messages'), payload).then(() => {
                    notifyBackendPush(payload); 
                    if (chatTargetType === "gemini") {
                        triggerGeminiReply(myKey, '[Te he enviado un Sticker adjunto. Obsérvalo y dime qué te parece]', b64);
                    }
                });
                
                document.getElementById('stickers-panel').classList.add('hidden');
            }
        };
        grid.appendChild(img);
    }
});

// ESCUCHA DE MENSAJES EN TIEMPO REAL
const initMessagesLiveStreamListener = () => {
    if (isMessageListenerAttached) return;
    isMessageListenerAttached = true;

    onChildAdded(ref(db, 'messages'), (snapshot) => {
        const data = { key: snapshot.key, ...snapshot.val() };
        allMessagesCache.push(data);

        const isNewRealtimeMessage = data.timestamp > loginTimeMark && (Date.now() - data.timestamp) < 5000;
        const isMe = currentUser && ("@" + data.sender).toLowerCase() === currentUser.nickname.toLowerCase();

        if (isNewRealtimeMessage) {
            const myKey = currentUser ? currentUser.nickname.replace('@', '') : '';
            
            let isForMe = false;
            if (data.channel === 'global') isForMe = true;
            else if (data.channel === 'group' && document.getElementById(`group-row-${data.receiver}`)) isForMe = true;
            else if (data.channel === 'private' && (data.receiver === myKey || data.sender === myKey)) isForMe = true;
            else if (data.channel === 'gemini' && (data.receiver === myKey || data.sender === myKey)) isForMe = true;

            if (isForMe) {
                let liveAuthor;
                if (data.sender === 'gemini') liveAuthor = { name: "Klain IA" };
                else liveAuthor = currentUsersCachedMap[data.sender] || { name: "Usuario" };

                if (!isMe) NotificationSystem.trigger(data.message, liveAuthor.name);

                if (data.channel === "global" && currentChatTarget !== "global") {
                    privateUnreadCounts["global"] = (privateUnreadCounts["global"] || 0) + 1;
                    const gb = document.getElementById('unread-badge-global'); if (gb) { gb.textContent = privateUnreadCounts["global"]; gb.classList.remove('hidden'); }
                } else if (data.channel === "group" && currentChatTarget !== data.receiver && !isMe) { 
                    privateUnreadCounts[data.receiver] = (privateUnreadCounts[data.receiver] || 0) + 1; 
                    const gb = document.getElementById(`unread-badge-${data.receiver}`); if (gb) { gb.textContent = privateUnreadCounts[data.receiver]; gb.classList.remove('hidden'); }
                } else if (data.channel === "private" && data.sender !== currentChatTarget && !isMe) { 
                    privateUnreadCounts[data.sender] = (privateUnreadCounts[data.sender] || 0) + 1; 
                    const gb = document.getElementById(`unread-badge-${data.sender}`); if (gb) { gb.textContent = privateUnreadCounts[data.sender]; gb.classList.remove('hidden'); }
                } else if (data.channel === "gemini" && data.sender === "gemini" && currentChatTarget !== "gemini" && data.receiver === myKey) { 
                    privateUnreadCounts["gemini"] = (privateUnreadCounts["gemini"] || 0) + 1; 
                    const gb = document.getElementById('unread-badge-gemini'); if (gb) { gb.textContent = privateUnreadCounts["gemini"]; gb.classList.remove('hidden'); }
                }
            }
        }
        renderSingleMessageAppend(data);
    });

    onChildChanged(ref(db, 'messages'), (snapshot) => {
        const data = { key: snapshot.key, ...snapshot.val() };
        const index = allMessagesCache.findIndex(m => m.key === snapshot.key);
        if (index !== -1) {
            allMessagesCache[index] = data;
            reloadMessagesUI();
        }
    });

    onChildRemoved(ref(db, 'messages'), (snapshot) => {
        allMessagesCache = allMessagesCache.filter(m => m.key !== snapshot.key);
        reloadMessagesUI();
    });
};

const btnRegister = document.getElementById('btn-register-submit');
if (btnRegister) {
    btnRegister.onclick = async () => {
        const name = document.getElementById('reg-name').value.trim(); 
        const rawNickname = document.getElementById('reg-nickname').value.trim().toLowerCase().replace('@', ''); 
        const password = document.getElementById('reg-password').value;
        
        if (!name || !rawNickname || !password) {
            return alert("Por favor ingresa tu Nombre, Username y Contraseña.");
        }

        const finalAvatar = tempRegisterAvatar || DEFAULT_AVATAR;

        try {
            const snap = await get(child(dbRef, `users/${rawNickname}`)); 
            if (snap.exists()) return alert("El nombre de usuario @" + rawNickname + " ya existe.");
            
            const userData = { name, nickname: '@' + rawNickname, password, avatar: finalAvatar, statusText: "" };
            await set(ref(db, `users/${rawNickname}`), userData);
            
            push(ref(db, 'messages'), { sender: "system", message: `✨ ¡${name} se ha unido a SayChat! Denle una cálida bienvenida.`, type: "system", channel: "global", timestamp: Date.now() });
            
            currentUser = userData; 
            loginTimeMark = Date.now(); 
            localStorage.setItem('chat_session_v5', JSON.stringify(currentUser)); 
            await initAppAfterLogin();
        } catch (err) { 
            console.error(err);
            alert("Error de Firebase: " + err.message + "\n\nAsegúrate de actualizar las Reglas de Firebase a públicas."); 
        }
    };
}

const btnLogin = document.getElementById('btn-login-submit');
if (btnLogin) {
    btnLogin.onclick = async () => {
        const nickname = document.getElementById('login-nickname').value.trim().toLowerCase().replace('@', ''); 
        const password = document.getElementById('login-password').value;
        try {
            const snap = await get(child(dbRef, `users/${nickname}`)); 
            if (!snap.exists()) return alert("Usuario no encontrado.");
            const userData = snap.val(); 
            if (userData.password !== password) return alert("Contraseña incorrecta.");
            
            currentUser = userData; 
            loginTimeMark = Date.now(); 
            localStorage.setItem('chat_session_v5', JSON.stringify(currentUser)); 
            await initAppAfterLogin();
        } catch (err) { alert("Error al iniciar sesión: " + err.message); }
    };
}

const initAppAfterLogin = async () => {
    document.getElementById('auth-screen').classList.add('hidden'); 
    document.getElementById('chat-screen').classList.remove('hidden');
    
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    document.getElementById('current-user-avatar').src = currentUser.avatar || DEFAULT_AVATAR; 
    document.getElementById('current-user-name').textContent = currentUser.name + (isMobile ? " 📱" : " 💻"); 
    document.getElementById('current-user-nickname').textContent = currentUser.nickname;
    
    if (window.innerWidth <= 768) {
        const sb = document.querySelector('.whatsapp-sidebar');
        if (sb) sb.classList.add('sidebar-hidden');
    }

    const messaging = getMessaging(app);
    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted' && swRegistration) {
            const token = await getToken(messaging, { 
                vapidKey: "BNSVK5j4QOhpaqQgvkExMKvrq4Bwc50deeuIc3brEZyWlw9xSiC7sl0zoA3iSnWrj-6ImDL8pWkz_S0G-t0wj58", // <-- VAPID ACTUALIZADO A PETICIÓN
                serviceWorkerRegistration: swRegistration 
            });
            if (token) {
                await update(ref(db, `users/${currentUser.nickname.replace('@', '')}`), { fcmToken: token });
            }
        }
    } catch (e) {
        console.log("No se pudo obtener token de notificaciones FCM:", e);
    }

    const snapUsers = await get(child(dbRef, 'users'));
    currentUsersCachedMap = snapUsers.val() || {};
    
    initMessagesLiveStreamListener();
    subscribeToTyping(); 
    
    PresenceSystem.init(); 
    PresenceSystem.listenPresence();
};

const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.onclick = () => {
        setTyping(false); 
        PresenceSystem.updateState("offline"); 
        currentUser = null; 
        allMessagesCache = []; 
        privateUnreadCounts = {}; 
        isMessageListenerAttached = false;
        if(typingUnsubscribe) typingUnsubscribe();
        localStorage.removeItem('chat_session_v5'); 
        document.getElementById('chat-screen').classList.add('hidden'); 
        document.getElementById('auth-screen').classList.remove('hidden');
    };
}

const savedSession = localStorage.getItem('chat_session_v5');
if (savedSession) { 
    currentUser = JSON.parse(savedSession); 
    initAppAfterLogin(); 
}

const mobileBackBtn = document.getElementById('mobile-back-btn');
const mobileCloseSidebarBtn = document.getElementById('mobile-close-sidebar');
const sidebar = document.querySelector('.whatsapp-sidebar');

if (mobileBackBtn && sidebar) {
    mobileBackBtn.addEventListener('click', () => {
        sidebar.classList.remove('sidebar-hidden');
    });
}

if (mobileCloseSidebarBtn && sidebar) {
    mobileCloseSidebarBtn.addEventListener('click', () => {
        sidebar.classList.add('sidebar-hidden');
    });
}

document.addEventListener('click', (e) => {
    const isContactRow = e.target.closest('.contact-list-row');
    if (isContactRow && window.innerWidth <= 768) {
        if (sidebar) sidebar.classList.add('sidebar-hidden');
    }
});
