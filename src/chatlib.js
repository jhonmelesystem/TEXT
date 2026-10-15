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

// Devuelve el chat y el otro participante, o null si el usuario no pertenece al chat
async function getChat(chatId, userId) {
  const [rows] = await db.query(
    'SELECT id, user_a, user_b FROM chats WHERE id = ? AND (user_a = ? OR user_b = ?)',
    [chatId, userId, userId]
  );
  if (!rows.length) return null;
  const chat = rows[0];
  return { chat, other: chat.user_a === userId ? chat.user_b : chat.user_a };
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

module.exports = { toId, wrap, getChat, canMessage };
