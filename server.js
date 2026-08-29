const express = require('express');
const path = require('path');
const https = require('https');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin'); 

const app = express();
const PORT = process.env.PORT || 3000;

// URL de la app en Render
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://saychat.onrender.com';

// Permitir recepción de JSON en el cuerpo de las peticiones
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Soporte dual: Detecta si los archivos están en la raíz o en una carpeta 'public'
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================================
// CONFIGURACIÓN DE FIREBASE ADMIN (PARA PUSH NOTIFICATIONS EN SEGUNDO PLANO)
// =========================================================================
let adminInitialized = false;
try {
    if (process.env.FIREBASE_ADMIN_JSON) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_JSON);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        adminInitialized = true;
        console.log("🔥 Firebase Admin (Push Notifications) inicializado correctamente.");
    } else {
        console.warn("⚠️ Falta la variable FIREBASE_ADMIN_JSON en Render. Las notificaciones Push en segundo plano no funcionarán.");
    }
} catch (e) {
    console.error("Error inicializando Firebase Admin:", e);
}

// ENDPOINT PARA DISPARAR LAS NOTIFICACIONES A LOS CELULARES
app.post('/api/send-push', async (req, res) => {
    if (!adminInitialized) return res.status(500).json({ error: "Admin SDK no configurado" });

    const { title, body, tokens } = req.body;
    if (!tokens || tokens.length === 0) return res.json({ success: true, message: "Nadie a quien notificar" });

    try {
        const message = {
            notification: { title, body },
            webpush: {
                notification: {
                    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nI2U2MTk1NSc+PHBhdGggZD0nTTEyIDIyIEw3LjUgMTQuNSBMMTYuNSAxNC41IFonLz48cGF0aCBkPSdNMTEuMiAxMy41IEM1IDEyLjUgMi41IDUgMi41IDUgQzQuNSA5IDggMTAuNSAxMC44IDEyLjIgWicvPjxwYXRoIGQ9J00xMi44IDEzLjUgQzE5IDEyLjUgMjEuNSA1IDIxLjUgNSBDMTkuNSA5IDE2IDEwLjUgMTMuMiAxMi4yIFonLz48cGF0aCBkPSdNMTIgMTEuNSBMOC41IDYgTDEwLjUgNyBMMTIgMiBMMTMuNSA3IEwxNS41IDYgWicvPjwvc3ZnPg==",
                    vibrate: [200, 100, 200],
                    sound: "/noti.mp3",
                    requireInteraction: true
                }
            },
            tokens: tokens 
        };
        const response = await admin.messaging().sendEachForMulticast(message);
        res.json({ success: true, response });
    } catch (error) {
        console.error("Error enviando push:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/ping', (req, res) => {
  res.status(200).send('SayChat Ping OK');
});

// =========================================================================
// API DE GEMINI CON SOPORTE MULTIMODAL Y GENERACIÓN DE IMÁGENES
// =========================================================================
app.post('/api/gemini', async (req, res) => {
  const { message, history, mediaBase64 } = req.body;
  const apiKey = process.env.GEMINI_API;
  
  if (!apiKey) {
    return res.status(500).json({ reply: "⚠️ La variable de entorno GEMINI_API no está configurada en Render." });
  }

  let cleanHistory = [];
  let currentRole = null;
  let currentParts = [];

  if (history && Array.isArray(history)) {
      for (const msg of history) {
          if (msg.role !== currentRole) {
              if (currentRole !== null) {
                  cleanHistory.push({ role: currentRole, parts: currentParts });
              }
              currentRole = msg.role;
              currentParts = [...msg.parts];
          } else {
              currentParts.push(...msg.parts);
          }
      }
      if (currentRole !== null) {
          cleanHistory.push({ role: currentRole, parts: currentParts });
      }
      if (cleanHistory.length > 0 && cleanHistory[0].role === 'model') {
          cleanHistory.shift();
      }
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  
  const models = [
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash-8b',
    'gemini-3.7-flash',       
    'gemini-3.6-flash'
  ];
  
  const systemPrompt = `Eres Klain, el asistente virtual de SayChat. Estás estructurada en base a la tecnología de Gemini, pero tu nombre oficial aquí es Klain. MUY IMPORTANTE:
1. Para dar formato usa Negrita (**texto**), Cursiva (*texto*), Tachado (~texto~) y Código (\`texto\`).
2. Puedes usar saltos de línea (enters) libremente. Para hacer listas, usa viñetas normales (•) o guiones (-), se verán perfectamente bien en el chat.
3. SI EL USUARIO TE PIDE GENERAR, CREAR O DIBUJAR UNA IMAGEN: NO digas que no puedes. DEBES responder obligatoriamente con este formato exacto de Markdown:
![Imagen Generada](https://image.pollinations.ai/prompt/AQUI_LA_DESCRIPCION_EN_INGLES_SEPARADA_POR_GUIONES?nologo=true)
Ejemplo: si piden un perro espacial, respondes: ¡Claro! Aquí tienes: ![Perro Espacial](https://image.pollinations.ai/prompt/space-dog-astronaut-galaxy?nologo=true)
4. Si el usuario te envía una foto, descríbela y responde en base a ella.`;

  let responseText = "";
  let success = false;

  for (const modelName of models) {
    try {
      let modelConfig = { 
          model: modelName,
          systemInstruction: systemPrompt
      };

      const model = genAI.getGenerativeModel(modelConfig);
      const chat = model.startChat({ history: cleanHistory });
      
      let sendParts = [];
      if (message) sendParts.push({ text: message });
      if (mediaBase64) {
          sendParts.push({
              inlineData: {
                  data: mediaBase64.split(',')[1], 
                  mimeType: 'image/jpeg' 
              }
          });
      }

      const result = await chat.sendMessage(sendParts);
      responseText = result.response.text();
      success = true;
      break; 
    } catch (error) {
      console.error(`[Gemini Fallback] El modelo ${modelName} falló:`, error.message);
    }
  }

  if (success) {
    res.json({ reply: responseText });
  } else {
    res.json({ reply: "⚠️ Mis circuitos están saturados en este momento o la imagen era muy pesada. Por favor, intenta de nuevo en unos segundos." });
  }
});

app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  const truePass = process.env.saidpass;
  
  if (password === truePass) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
  }
});

app.get('*', (req, res) => {
  const publicPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(publicPath)) {
      res.sendFile(publicPath);
  } else {
      res.sendFile(path.join(__dirname, 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
