import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, push, onChildAdded, get, child, set, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

// Estado de la aplicación
let currentUser = null;
let tempRegisterAvatar = "";
let tempEditAvatar = "";

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
        
        if (isMe) {
            msgRow.classList.add('msg-row-me');
        }

        const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        msgRow.innerHTML = `
            <img src="${authorData.avatar || ''}" class="msg-img custom-avatar" alt="Avatar">
            <div class="msg-bubble">
                <div class="msg-meta">
                    <span class="meta-name">${authorData.name}</span>
                    <span class="meta-nick">${authorData.nickname}</span>
                </div>
                <p class="msg-body">${data.message}</p>
                <span class="msg-time">${time}</span>
            </div>
        `;

        this.inputs.chatBox.appendChild(msgRow);
        this.inputs.chatBox.scrollTop = this.inputs.chatBox.scrollHeight;
    },

    utils: {
        getBase64(file, callback) {
            const reader = new FileReader();
            reader.onloadend = () => callback(reader.result);
            reader.readAsDataURL(file);
        }
    }
};

// ==========================================================================
// 3. MÓDULO DE SERVICIOS (FIREBASE)
// ==========================================================================
const AuthService = {
    async register(name, nickname, password, avatarBase64) {
        const cleanNick = nickname.replace('@', '').toLowerCase().trim();
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
    },

    async updateProfile(userKey, newName, avatarBase64) {
        const updates = {};
        if (newName) updates.name = newName;
        if (avatarBase64) updates.avatar = avatarBase64;

        await update(ref(db, `users/${userKey}`), updates);
    }
};

const ChatService = {
    sendMessage(userKey, message) {
        push(ref(db, 'messages'), {
            userKey: userKey,
            message: message,
            timestamp: Date.now()
        });
    },

    listenMessages(callback) {
        onChildAdded(ref(db, 'messages'), async (snapshot) => {
            const data = snapshot.val();
            const authorSnap = await get(child(dbRef, `users/${data.userKey}`));
            let authorData = { name: "Usuario", nickname: "@unknown", avatar: "" };
            
            if (authorSnap.exists()) authorData = authorSnap.val();
            
            const isMe = currentUser && authorData.nickname.toLowerCase() === currentUser.nickname.toLowerCase();
            callback(data, authorData, isMe);
        });
    }
};

// ==========================================================================
// 4. CONTROLADORES DE EVENTOS (LISTENERS)
// ==========================================================================

// Ocultar o Mostrar barra lateral
document.getElementById('toggle-sidebar-btn').addEventListener('click', () => UI.toggleSidebar());

// Cambios de Vista de Autenticación
document.getElementById('go-to-register').addEventListener('click', () => UI.switchAuthMode('register'));
document.getElementById('go-to-login').addEventListener('click', () => UI.switchAuthMode('login'));

// Captura de Imágenes
document.getElementById('reg-avatar').addEventListener('change', (e) => {
    if (e.target.files[0]) {
        UI.utils.getBase64(e.target.files[0], (base64) => {
            tempRegisterAvatar = base64;
            const preview = document.getElementById('reg-preview');
            preview.src = base64;
            preview.classList.remove('hidden');
        });
    }
});

document.getElementById('edit-avatar').addEventListener('change', (e) => {
    if (e.target.files[0]) UI.utils.getBase64(e.target.files[0], (base64) => tempEditAvatar = base64);
});

// Acción: Registro
document.getElementById('btn-register-submit').addEventListener('click', async () => {
    const name = document.getElementById('reg-name').value.trim();
    const nickname = document.getElementById('reg-nickname').value.trim();
    const password = document.getElementById('reg-password').value;

    if (!name || !nickname || !password || !tempRegisterAvatar) return alert("Completa todos los datos.");

    try {
        currentUser = await AuthService.register(name, nickname, password, tempRegisterAvatar);
        localStorage.setItem('chat_session_v4', JSON.stringify(currentUser));
        UI.showChat(currentUser);
        location.reload();
    } catch (err) {
        alert(err.message === "ID_EXISTENTE" ? "El ID de usuario ya está ocupado." : "Error de red.");
    }
});

// Acción: Inicio de Sesión
document.getElementById('btn-login-submit').addEventListener('click', async () => {
    const nickname = document.getElementById('login-nickname').value.trim();
    const password = document.getElementById('login-password').value;

    if (!nickname || !password) return alert("Ingresa tus credenciales.");

    try {
        currentUser = await AuthService.login(nickname, password);
        localStorage.setItem('chat_session_v4', JSON.stringify(currentUser));
        UI.showChat(currentUser);
        location.reload();
    } catch (err) {
        alert(err.message === "USER_NOT_FOUND" ? "El ID no existe." : "Contraseña incorrecta.");
    }
});

// Acción: Actualizar Cuenta
document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const newName = document.getElementById('edit-name').value.trim();
    const userKey = currentUser.nickname.replace('@', '');

    if (!newName && !tempEditAvatar) return alert("No hay cambios.");

    try {
        await AuthService.updateProfile(userKey, newName, tempEditAvatar);
        if (newName) currentUser.name = newName;
        if (tempEditAvatar) currentUser.avatar = tempEditAvatar;

        localStorage.setItem('chat_session_v4', JSON.stringify(currentUser));
        UI.showChat(currentUser);
        document.getElementById('edit-name').value = "";
        alert("Perfil actualizado.");
    } catch (err) { alert("Error al guardar."); }
});

// Flujo de Mensajería
const triggerSend = () => {
    const msg = UI.inputs.message.value.trim();
    if (msg && currentUser) {
        ChatService.sendMessage(currentUser.nickname.replace('@', ''), msg);
        UI.inputs.message.value = '';
    }
};

document.getElementById('btn-send-message').addEventListener('click', triggerSend);
UI.inputs.message.addEventListener('keydown', (e) => { if (e.key === 'Enter') triggerSend(); });

// Inicialización de Escucha en Tiempo Real
ChatService.listenMessages((data, authorData, isMe) => {
    UI.renderMessage(data, authorData, isMe);
});

// Temas y Logout
document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('chat_session_v4');
    location.reload();
});

document.querySelectorAll('[data-set-theme]').forEach(dot => {
    dot.addEventListener('click', (e) => {
        document.body.setAttribute('data-theme', e.target.getAttribute('data-set-theme'));
        document.querySelectorAll('.theme-dot').forEach(d => d.classList.remove('active'));
        e.target.classList.add('active');
    });
});

// Auto-Login mediante sesión guardada
const saved = localStorage.getItem('chat_session_v4');
if (saved) {
    currentUser = JSON.parse(saved);
    UI.showChat(currentUser);
}
