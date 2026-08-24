const express = require('express');
const path = require('path');
const https = require('https');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// URL de la app en Render
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://saychat.onrender.com';

// Permitir recepción de JSON en el cuerpo de las peticiones (con límite extendido para imágenes grandes)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Soporte dual: Detecta si los archivos están en la raíz o en una carpeta 'public'
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

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

  // Agrupamiento inteligente del historial para evitar el error de alternancia estricta del SDK
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
      // Gemini exige que el historial empiece obligatoriamente con el rol 'user'
      if (cleanHistory.length > 0 && cleanHistory[0].role === 'model') {
          cleanHistory.shift();
      }
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  
  // SOLUCIÓN A ERROR 503 / LENTITUD:
   const models = [

    'gemini-3.6-flash',
    'gemini-3.1-flash-lite'
  ];
  
  // Prompt maestro actualizado para KLAIN
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
      
      // Armamos el mensaje final. Si hay imagen, la insertamos junta al texto.
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

// =========================================================================
// API DE ADMIN CONTROL (CHATCONTROL)
// =========================================================================
app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  // Comparamos con la variable de entorno 'saidpass' de Render
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
