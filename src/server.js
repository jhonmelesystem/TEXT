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

// Pagina de prueba del chat (solo desarrollo): http://localhost:3000/test
app.use('/test', express.static(path.join(__dirname, '..', 'public')));

const port = process.env.PORT || 3000;
const server = http.createServer(app);
require('./socket')(server);
server.listen(port, () => console.log(`text backend en http://localhost:${port}`));