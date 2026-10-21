const express = require('express');
const db = require('./db');
const { requireAuth } = require('./middleware');
const { TERMS_VERSION } = require('./legal');

const router = express.Router();

// Mi perfil
router.get('/me', requireAuth, async (req, res) => {
  const [rows] = await db.query(
    'SELECT id, email, username, display_name, avatar_url, cover_url, terms_version, created_at FROM users WHERE id = ?',
    [req.userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
  const me = rows[0];
  me.terms_current = TERMS_VERSION;
  me.needs_terms = (me.terms_version || 0) < TERMS_VERSION;
  res.json(me);
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

// Aceptar los terminos y la politica vigentes: { "accept": true }
router.post('/me/accept-terms', requireAuth, async (req, res) => {
  if (!req.body || req.body.accept !== true) {
    return res.status(400).json({ error: 'Debes aceptar los Terminos y la Politica de Privacidad' });
  }
  await db.query('UPDATE users SET terms_version = ?, terms_accepted_at = NOW() WHERE id = ?', [TERMS_VERSION, req.userId]);
  res.json({ ok: true, terms_version: TERMS_VERSION });
});

module.exports = router;
