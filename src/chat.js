const express = require('express');
const db = require('./db');
const { requireAuth } = require('./middleware');
const { toId, wrap, getChat } = require('./chatlib');

const router = express.Router();

// Lista de conversaciones (solo las que tienen mensajes), con ultimo mensaje y no leidos
router.get('/chats', requireAuth, wrap(async (req, res) => {
  const me = req.userId;
  const [rows] = await db.query(
    `SELECT ch.id AS chat_id, u.id AS user_id, u.username, u.display_name, u.avatar_url,
            lm.type AS last_type, lm.body AS last_body, lm.created_at AS last_at, lm.sender_id AS last_sender,
            (SELECT COUNT(*) FROM messages m
              WHERE m.chat_id = ch.id AND m.sender_id <> ? AND m.status <> 'read') AS unread
       FROM chats ch
       JOIN users u ON u.id = IF(ch.user_a = ?, ch.user_b, ch.user_a)
       JOIN messages lm ON lm.id = (SELECT MAX(id) FROM messages WHERE chat_id = ch.id)
      WHERE (ch.user_a = ? OR ch.user_b = ?)
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
           WHERE (b.blocker_id = u.id AND b.blocked_id = ?)
              OR (b.blocker_id = ? AND b.blocked_id = u.id))
      ORDER BY lm.created_at DESC, ch.id DESC`,
    [me, me, me, me, me, me]
  );
  res.json(rows);
}));

// Historial de un chat. Paginacion: ?before=<id del mensaje mas antiguo cargado>&limit=50
router.get('/chats/:id/messages', requireAuth, wrap(async (req, res) => {
  const chatId = toId(req.params.id);
  const info = chatId && (await getChat(chatId, req.userId));
  if (!info) return res.status(404).json({ error: 'Chat no encontrado' });

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const before = toId(req.query.before);
  const params = [chatId];
  let sql = `SELECT id, chat_id, sender_id, type, body, media_url, duration_sec, status, created_at
               FROM messages WHERE chat_id = ?`;
  if (before) { sql += ' AND id < ?'; params.push(before); }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);

  const [rows] = await db.query(sql, params);
  res.json(rows.reverse()); // del mas antiguo al mas nuevo
}));

module.exports = router;
