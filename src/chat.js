const express = require('express');
const db = require('./db');
const { requireAuth } = require('./middleware');
const { toId, wrap, getChat, MSG_SELECT } = require('./chatlib');

const router = express.Router();

// Lista de conversaciones: las de dos personas (solo las que tienen mensajes) y los grupos
router.get('/chats', requireAuth, wrap(async (req, res) => {
  const me = req.userId;

  const [direct] = await db.query(
    `SELECT ch.id AS chat_id, 'direct' AS type, u.id AS user_id, u.username, u.display_name, u.avatar_url,
            lm.type AS last_type, lm.body AS last_body, lm.created_at AS last_at, lm.sender_id AS last_sender,
            NULL AS last_sender_name, lm.created_at AS sort_at,
            (SELECT COUNT(*) FROM messages m
              WHERE m.chat_id = ch.id AND m.sender_id <> ? AND m.status <> 'read') AS unread
       FROM chats ch
       JOIN users u ON u.id = IF(ch.user_a = ?, ch.user_b, ch.user_a)
       JOIN messages lm ON lm.id = (SELECT MAX(id) FROM messages WHERE chat_id = ch.id)
      WHERE (ch.user_a = ? OR ch.user_b = ?)
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
           WHERE (b.blocker_id = u.id AND b.blocked_id = ?)
              OR (b.blocker_id = ? AND b.blocked_id = u.id))`,
    [me, me, me, me, me, me]
  );

  // Si algo de los grupos fallara, las conversaciones de dos personas siguen funcionando
  let groups = [];
  try {
    [groups] = await db.query(
      `SELECT ch.id AS chat_id, 'group' AS type, NULL AS user_id, NULL AS username,
              ch.name AS display_name, ch.avatar_url,
              lm.type AS last_type, lm.body AS last_body, lm.created_at AS last_at,
              lm.sender_id AS last_sender, lu.display_name AS last_sender_name,
              COALESCE(lm.created_at, ch.created_at) AS sort_at,
              (SELECT COUNT(*) FROM messages m
                WHERE m.chat_id = ch.id AND m.sender_id <> ? AND m.id > cm.last_read_id) AS unread,
              (SELECT COUNT(*) FROM chat_members x WHERE x.chat_id = ch.id) AS member_count
         FROM chat_members cm
         JOIN chats ch ON ch.id = cm.chat_id AND ch.type = 'group'
         LEFT JOIN messages lm ON lm.id = (SELECT MAX(id) FROM messages WHERE chat_id = ch.id)
         LEFT JOIN users lu ON lu.id = lm.sender_id
        WHERE cm.user_id = ?`,
      [me, me]
    );
  } catch (err) {
    console.error('Lista de grupos:', err.message);
  }

  const all = [...direct, ...groups].sort((a, b) => new Date(b.sort_at) - new Date(a.sort_at));
  res.json(all);
}));

// Historial de un chat o grupo. Paginacion: ?before=<id del mensaje mas antiguo cargado>&limit=50
router.get('/chats/:id/messages', requireAuth, wrap(async (req, res) => {
  const chatId = toId(req.params.id);
  const info = chatId && (await getChat(chatId, req.userId));
  if (!info) return res.status(404).json({ error: 'Chat no encontrado' });

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const before = toId(req.query.before);
  const params = [chatId];
  let sql = `${MSG_SELECT} WHERE m.chat_id = ?`;
  if (before) { sql += ' AND m.id < ?'; params.push(before); }
  sql += ' ORDER BY m.id DESC LIMIT ?';
  params.push(limit);

  const [rows] = await db.query(sql, params);
  res.json(rows.reverse()); // del mas antiguo al mas nuevo
}));

module.exports = router;
