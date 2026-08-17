const express = require('express');
const path = require('path');
const https = require('https');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// URL de la app en Render
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://saychat.onrender.com';

// Permitir recepción de JSON en el cuerpo de las peticiones
app.use(express.json());

// Servir los archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Ruta de comprobación de estado para el auto-ping
app.get('/ping', (req, res) => {
  res.status(200).send('SayChat Ping OK');
});

// =========================================================================
// API DE GEMINI CON SISTEMA FALLBACK
// =========================================================================
app.post('/api/gemini', async (req, res) => {
  const { message, history } = req.body;
  const apiKey = process.env.GEMINI_API;
  
  if (!apiKey) {
    return res.status(500).json({ reply: "⚠️ La variable de entorno GEMINI_API no está configurada en Render." });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  // Lista de modelos Fallback (Del más capaz hasta la familia 1)
  const models = ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'];
  
  let responseText = "";
  let success = false;

  for (const modelName of models) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const chat = model.startChat({ history: history || [] });
      const result = await chat.sendMessage(message);
      responseText = result.response.text();
      success = true;
      break; // Detener el ciclo si este modelo funcionó correctamente
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

// Ruta principal
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
