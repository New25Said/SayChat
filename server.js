const express = require('express');
const path = require('path');
const https = require('https');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// URL de la app en Render
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://saychat.onrender.com';

// Permitir recepción de JSON en el cuerpo de las peticiones
app.use(express.json());

// Soporte dual: Detecta si los archivos están en la raíz o en una carpeta 'public'
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// Ruta de comprobación de estado para el auto-ping
app.get('/ping', (req, res) => {
  res.status(200).send('SayChat Ping OK');
});

// =========================================================================
// API DE GEMINI CON SISTEMA FALLBACK, FORMATO CUSTOM Y SANITIZACIÓN
// =========================================================================
app.post('/api/gemini', async (req, res) => {
  const { message, history } = req.body;
  const apiKey = process.env.GEMINI_API;
  
  if (!apiKey) {
    return res.status(500).json({ reply: "⚠️ La variable de entorno GEMINI_API no está configurada en Render." });
  }

  // Limpieza de historial para asegurar alternancia estricta (user -> model)
  let cleanHistory = [];
  if (history && Array.isArray(history)) {
      let expectedRole = 'user';
      for (const msg of history) {
          if (msg.role === expectedRole) {
              cleanHistory.push(msg);
              expectedRole = expectedRole === 'user' ? 'model' : 'user';
          }
      }
      if (cleanHistory.length > 0 && cleanHistory[cleanHistory.length - 1].role === 'user') {
          cleanHistory.pop();
      }
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  
  const models = [
    // --- GENERACIÓN FRONTERA ACTUAL (Gemini 3.x) ---
    'gemini-3.7-flash',       
    'gemini-3.6-flash',       
    'gemini-3.5-flash',       
    'gemini-3.5-flash-lite',  
    'gemini-3.1-flash-lite',  
  ];
  
  // Forzamos a la IA a solo usar el markdown de SayChat
  const systemPrompt = "Eres Gemini, el asistente virtual de SayChat. MUY IMPORTANTE: Para dar formato a tus respuestas, SOLO tienes permitido usar estas 4 reglas de Markdown personalizado:\n- Negrita: **texto**\n- Cursiva: *texto*\n- Tachado: ~texto~\n- Código en línea: `texto`\nESTÁ ESTRICTAMENTE PROHIBIDO usar cualquier otro Markdown estándar como almohadillas (#) para títulos, asteriscos/guiones al inicio de línea para listas, o bloques de código de tres comillas (```). Escribe como en un chat normal.";

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
      
      const result = await chat.sendMessage(message);
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
    res.json({ reply: "⚠️ Mis circuitos están saturados en todos los modelos en este momento. Por favor, intenta de nuevo en unos segundos." });
  }
});

// Ruta principal (Soporte dual de rutas)
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

  // =========================================================================
  // AUTOMATIC KEEP-ALIVE PING
  // =========================================================================
  const PING_INTERVAL = 10 * 60 * 1000; // Cada 10 minutos

  setInterval(() => {
    https.get(`${RENDER_URL}/ping`, (res) => {
      console.log(`[Auto-Ping] Estado del servidor: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error('[Auto-Ping] Error al realizar el ping:', err.message);
    });
  }, PING_INTERVAL);
});
