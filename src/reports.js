const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { requireAuth } = require('./middleware');
const { toId, wrap, getChat } = require('./chatlib');

const router = express.Router();

// Motivos disponibles (la app muestra estos nombres)
const CATEGORIES = ['spam', 'acoso', 'sexual', 'violencia', 'odio', 'menores', 'otro'];

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 20,
  message: { error: 'Demasiados reportes. Intenta mas tarde.' }
});

// Reportar un mensaje { message_id, category, reason? } o a una persona { user_id, category, reason? }
router.post('/reports', requireAuth, limiter, wrap(async (req, res) => {
  const me = req.userId;
  const b = req.body || {};
  const category = CATEGORIES.includes(b.category) ? b.category : null;
  const reason = String(b.reason || '').trim().slice(0, 255);
  if (!category && !reason) return res.status(400).json({ error: 'Elige un motivo' });

  let reportedId = toId(b.user_id);
  let chatId = null;
  let messageId = null;
  let messageType = null;
  let evidence = null;

  if (b.message_id) {
    const id = toId(b.message_id);
    const [rows] = await db.query(
      'SELECT id, chat_id, sender_id, type, body, media_url FROM messages WHERE id = ?',
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Mensaje no encontrado' });
    const m = rows[0];
    // Solo se puede reportar lo que uno puede ver (ser parte de esa conversacion)
    if (!(await getChat(m.chat_id, me))) return res.status(404).json({ error: 'Mensaje no encontrado' });
    if (m.sender_id === me) return res.status(400).json({ error: 'No puedes reportar tus propios mensajes' });

    const [dup] = await db.query('SELECT id FROM reports WHERE reporter_id = ? AND message_id = ? LIMIT 1', [me, m.id]);
    if (dup.length) return res.json({ ok: true, duplicate: true });

    reportedId = m.sender_id;
    chatId = m.chat_id;
    messageId = m.id;
    messageType = m.type;
    // Copia del contenido: queda como prueba aunque el mensaje se borre despues
    evidence = JSON.stringify({ body: m.body, media_url: m.media_url });
  }

  if (!reportedId || reportedId === me) return res.status(400).json({ error: 'Usuario invalido' });
  const [u] = await db.query('SELECT id FROM users WHERE id = ?', [reportedId]);
  if (!u.length) return res.status(404).json({ error: 'Usuario no encontrado' });

  await db.query(
    'INSERT INTO reports (reporter_id, reported_id, reason, category, message_id, chat_id, message_type, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [me, reportedId, reason || null, category || 'otro', messageId, chatId, messageType, evidence]
  );
  res.status(201).json({ ok: true });
}));

module.exports = router;
