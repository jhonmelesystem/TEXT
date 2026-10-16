require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true, db: 'conectada' });
  } catch (err) {
    res.status(500).json({ ok: false, db: err.message });
  }
});

app.use('/api/auth', require('./auth'));
app.use('/api', require('./users'));
app.use('/api', require('./contacts'));
app.use('/api', require('./chat'));
app.use('/api', require('./media'));
app.use('/api', require('./video'));
app.use('/api', require('./settings'));

// Imagenes enviadas (nombres aleatorios e imposibles de adivinar)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), {
  maxAge: '30d', immutable: true, index: false
}));

// Enlace de invitacion (el que lleva el QR): abre la app con el token
app.get('/invite/:token', (req, res) => {
  const ok = /^[a-f0-9]{48}$/.test(req.params.token);
  res.redirect('/app/' + (ok ? '#invite=' + req.params.token : ''));
});

// App real: http://localhost:3000/app
app.use('/app', express.static(path.join(__dirname, '..', 'public', 'app')));
app.get('/', (req, res) => res.redirect('/app/'));

// Pagina de prueba del chat (solo desarrollo): http://localhost:3000/test
app.use('/test', express.static(path.join(__dirname, '..', 'public')));

const port = process.env.PORT || 3000;
const server = http.createServer(app);
server.requestTimeout = 30 * 60 * 1000; // permite subidas grandes en conexiones lentas (30 min)
app.set('io', require('./socket')(server));
server.listen(port, () => console.log(`text backend en http://localhost:${port}`));