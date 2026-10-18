const express = require('express');
const db = require('./db');
const { requireAuth } = require('./middleware');

const router = express.Router();

// Mi perfil
router.get('/me', requireAuth, async (req, res) => {
  const [rows] = await db.query(
    'SELECT id, email, username, display_name, avatar_url, cover_url, created_at FROM users WHERE id = ?',
    [req.userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(rows[0]);
});

// Cambiar nombre visible
router.patch('/me', requireAuth, async (req, res) => {
  const displayName = String(req.body.display_name || '').trim();
  if (!displayName || displayName.length > 60) {
    return res.status(400).json({ error: 'Nombre invalido' });
  }
  await db.query('UPDATE users SET display_name = ? WHERE id = ?', [displayName, req.userId]);
  res.json({ ok: true, display_name: displayName });
});

module.exports = router;