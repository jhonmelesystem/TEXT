const db = require('./db');

const toId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  });

// Devuelve la conversacion si el usuario participa en ella, o null.
//  - conversacion de dos: { chat, group: false, other: <id de la otra persona> }
//  - grupo:               { chat, group: true, other: null, role: 'admin' | 'member' }
async function getChat(chatId, userId) {
  const [rows] = await db.query('SELECT * FROM chats WHERE id = ?', [chatId]);
  if (!rows.length) return null;
  const chat = rows[0];
  if (chat.type === 'group') {
    const [m] = await db.query('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?', [chatId, userId]);
    if (!m.length) return null;
    return { chat, group: true, other: null, role: m[0].role };
  }
  if (chat.user_a !== userId && chat.user_b !== userId) return null;
  return { chat, group: false, other: chat.user_a === userId ? chat.user_b : chat.user_a, role: 'member' };
}

async function memberIds(chatId) {
  const [rows] = await db.query('SELECT user_id FROM chat_members WHERE chat_id = ?', [chatId]);
  return rows.map((r) => r.user_id);
}

// Solo se puede escribir a contactos aceptados y no bloqueados
async function canMessage(me, other) {
  const [blocks] = await db.query(
    'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1',
    [me, other, other, me]
  );
  if (blocks.length) return false;
  const [rows] = await db.query(
    "SELECT 1 FROM contacts WHERE status = 'accepted' AND ((user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)) LIMIT 1",
    [me, other, other, me]
  );
  return rows.length > 0;
}

// En un grupo basta con ser miembro (getChat ya lo comprobo)
async function canSend(me, info) {
  return info.group ? true : canMessage(me, info.other);
}

// Consulta de mensajes: incluye quien lo envio y, si responde a otro, una vista previa de ese
const MSG_SELECT = `SELECT m.id, m.chat_id, m.sender_id, m.type, m.body, m.media_url, m.duration_sec,
       m.lat, m.lng, m.status, m.created_at, m.reply_to_id,
       u.display_name AS sender_name, u.avatar_url AS sender_avatar,
       r.type AS reply_type, r.body AS reply_body, r.sender_id AS reply_sender_id,
       ru.display_name AS reply_sender_name
  FROM messages m
  JOIN users u ON u.id = m.sender_id
  LEFT JOIN messages r ON r.id = m.reply_to_id
  LEFT JOIN users ru ON ru.id = r.sender_id`;

module.exports = { toId, wrap, getChat, memberIds, canMessage, canSend, MSG_SELECT };
