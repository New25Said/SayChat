const express = require('express');
const path = require('path');
const https = require('https'); // Importamos https para realizar las peticiones
const app = express();
const PORT = process.env.PORT || 3000;

// URL de tu aplicación en Render
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://saychat.onrender.com';

// Servir los archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Ruta de comprobación de estado para el auto-ping
app.get('/ping', (req, res) => {
  res.status(200).send('SayChat Ping OK');
});

// Ruta principal (debe ir después de /ping)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);

  // =========================================================================
  // CÓDIGO AUTO-PING (KEEP-ALIVE)
  // =========================================================================
  const PING_INTERVAL = 10 * 60 * 1000; // 10 minutos (en milisegundos)

  setInterval(() => {
    https.get(`${RENDER_URL}/ping`, (res) => {
      console.log(`[Auto-Ping] Estado del servidor: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error('[Auto-Ping] Error al realizar el ping:', err.message);
    });
  }, PING_INTERVAL);
});
