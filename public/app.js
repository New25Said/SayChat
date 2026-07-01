import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, push, onChildAdded, get, child, update, set } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

// Estados locales globales
let currentUser = null;
let tempRegisterAvatar = "";
let tempEditAvatar = "";

// Elementos de Navegación entre vistas
const loginArea = document.getElementById('login-area');
const registerArea = document.getElementById('register-area');
const authScreen = document.getElementById('auth-screen');
const chatScreen = document.getElementById('chat-screen');

document.getElementById('go-to-register').addEventListener('click', () => {
    loginArea.classList.add('hidden');
    registerArea.classList.remove('hidden');
});

document.getElementById('go-to-login').addEventListener('click', () => {
    registerArea.classList.add('hidden');
    loginArea.classList.remove('hidden');
});

// Convertidor de archivos de imagen a Base64 text strings
document.getElementById('reg-avatar').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
            tempRegisterAvatar = reader.result;
            const preview = document.getElementById('reg-preview');
            preview.src = reader.result;
            preview.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }
});

document.getElementById('edit-avatar').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
            tempEditAvatar = reader.result;
        };
        reader.readAsDataURL(file);
    }
});

// PROCESO DE REGISTRO (CON CONTROL DE CLICKS SEGURO)
document.getElementById('btn-register-submit').addEventListener('click', async () => {
    const name = document.getElementById('reg-name').value.trim();
    let nickname = document.getElementById('reg-nickname').value.trim().toLowerCase().replace('@', '');
    const password = document.getElementById('reg-password').value;

    if (!name || !nickname || !password) {
        alert("Por favor rellena todos los campos.");
        return;
    }
    if (!tempRegisterAvatar) {
        alert("Por favor selecciona una foto de perfil.");
        return;
    }

    try {
        const snapshot = await get(child(dbRef, `users/${nickname}`));
        if (snapshot.exists()) {
            alert("Este ID/Nickname ya está en uso.");
            return;
        }

        const userData = { name, nickname: '@' + nickname, password, avatar: tempRegisterAvatar };
        await set(ref(db, `users/${nickname}`), userData);

        currentUser = userData;
        localStorage.setItem('chat_session_v3', JSON.stringify(currentUser));
        loadChatInterface();
    } catch (err) {
        console.error(err);
        alert("Error de escritura en base de datos.");
    }
});

// PROCESO DE LOGIN
document.getElementById('btn-login-submit').addEventListener('click', async () => {
    let nickname = document.getElementById('login-nickname').value.trim().toLowerCase().replace('@', '');
    const password = document.getElementById('login-password').value;

    if (!nickname || !password) {
        alert("Campos incompletos.");
        return;
    }

    try {
        const snapshot = await get(child(dbRef, `users/${nickname}`));
        if (snapshot.exists()) {
            const userData = snapshot.val();
            if (userData.password === password) {
                currentUser = userData;
                localStorage.setItem('chat_session_v3', JSON.stringify(currentUser));
                loadChatInterface();
            } else {
                alert("Contraseña incorrecta.");
            }
        } else {
            alert("El usuario no existe.");
        }
    } catch (err) {
        console.error(err);
        alert("Error de autenticación.");
    }
});

// ACTUALIZAR PERFIL (SÓLO NOMBRE VISUAL Y FOTO)
document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const newName = document.getElementById('edit-name').value.trim();
    const userKey = currentUser.nickname.replace('@', '');

    if (!newName && !tempEditAvatar) {
        alert("No has realizado ningún cambio.");
        return;
    }

    if (newName) currentUser.name = newName;
    if (tempEditAvatar) currentUser.avatar = tempEditAvatar;

    try {
        await update(ref(db, `users/${userKey}`), {
            name: currentUser.name,
            avatar: currentUser.avatar
        });
        localStorage.setItem('chat_session_v3', JSON.stringify(currentUser));
        
        document.getElementById('current-user-name').textContent = currentUser.name;
        document.getElementById('current-user-avatar').src = currentUser.avatar;
        document.getElementById('edit-name').value = "";
        alert("Cambios guardados con éxito.");
    } catch (err) {
        alert("Error de sincronización.");
    }
});

// ENVIAR MENSAJES (PREVENCIÓN DE ACTUALIZACIÓN FORZADA)
const sendMessage = () => {
    const input = document.getElementById('message-input');
    const msg = input.value.trim();

    if (msg && currentUser) {
        push(ref(db, 'messages'), {
            userKey: currentUser.nickname.replace('@', ''),
            message: msg,
            timestamp: Date.now()
        });
        input.value = '';
    }
};

document.getElementById('btn-send-message').addEventListener('click', sendMessage);
document.getElementById('message-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// ESCUCHAR MENSAJES EN ENTRADA
onChildAdded(ref(db, 'messages'), async (snapshot) => {
    const data = snapshot.val();
    
    try {
        const authorSnap = await get(child(dbRef, `users/${data.userKey}`));
        let authorData = { name: "Usuario", nickname: "@unknown", avatar: "" };
        
        if (authorSnap.exists()) {
            authorData = authorSnap.val();
        }

        const msgRow = document.createElement('div');
        msgRow.classList.add('msg-row');
        
        const isMe = currentUser && authorData.nickname === currentUser.nickname;
        if (isMe) msgRow.classList.add('msg-row-me');

        const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        msgRow.innerHTML = `
            <img src="${authorData.avatar || ''}" class="msg-img custom-avatar">
            <div class="msg-bubble">
                <div class="msg-meta">
                    <span class="meta-name">${authorData.name}</span>
                    <span class="meta-nick">${authorData.nickname}</span>
                </div>
                <p class="msg-body">${data.message}</p>
                <span class="msg-time">${time}</span>
            </div>
        `;

        const box = document.getElementById('chat-box');
        box.appendChild(msgRow);
        box.scrollTop = box.scrollHeight;
    } catch (err) {
        console.error(err);
    }
});

// CAMBIAR PANTALLA
function loadChatInterface() {
    authScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');

    document.getElementById('current-user-avatar').src = currentUser.avatar;
    document.getElementById('current-user-name').textContent = currentUser.name;
    document.getElementById('current-user-nickname').textContent = currentUser.nickname;
}

// LOGOUT
document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('chat_session_v3');
    location.reload();
});

// MANEJO DE TEMAS
document.querySelectorAll('[data-set-theme]').forEach(dot => {
    dot.addEventListener('click', (e) => {
        const targetTheme = e.target.getAttribute('data-set-theme');
        document.body.setAttribute('data-theme', targetTheme);
        document.querySelectorAll('.theme-dot').forEach(d => d.classList.remove('active'));
        e.target.classList.add('active');
    });
});

// CARGA DE SESIONES ACTIVAS AUTOMÁTICAS
const activeSession = localStorage.getItem('chat_session_v3');
if (activeSession) {
    currentUser = JSON.parse(activeSession);
    loadChatInterface();
}
