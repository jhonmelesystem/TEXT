require('dotenv').config();
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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`text backend en http://localhost:${port}`));
