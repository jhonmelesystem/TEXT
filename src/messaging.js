const db = require('./db');

const room = (userId) => `user:${userId}`;

// Guarda un mensaje (texto o imagen) y lo envia en tiempo real a los dos usuarios.
async function createAndDispatch(io, { chatId, me, other, type = 'text', body = null, mediaUrl = null, durationSec = null, originSocket = null }) {
  const [result] = await db.query(
    'INSERT INTO messages (chat_id, sender_id, type, body, media_url, duration_sec) VALUES (?, ?, ?, ?, ?, ?)',
    [chatId, me, type, body, mediaUrl, durationSec]
  );
  const [rows] = await db.query(
    'SELECT id, chat_id, sender_id, type, body, media_url, duration_sec, status, created_at FROM messages WHERE id = ?',
    [result.insertId]
  );
  const message = rows[0];

  // Si el destinatario esta conectado, queda "entregado" al instante
  const online = (await io.in(room(other)).fetchSockets()).length > 0;
  if (online) {
    await db.query("UPDATE messages SET status = 'delivered' WHERE id = ?", [message.id]);
    message.status = 'delivered';
  }

  io.to(room(other)).emit('message:new', message);
  if (originSocket) originSocket.to(room(me)).emit('message:new', message); // mis otros dispositivos
  else io.to(room(me)).emit('message:new', message);

  return message;
}

module.exports = { createAndDispatch };
