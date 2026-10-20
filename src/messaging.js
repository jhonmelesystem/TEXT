const db = require('./db');
const { MSG_SELECT } = require('./chatlib');

const room = (userId) => `user:${userId}`;

// Guarda un mensaje (texto, imagen, video, audio o ubicacion) y lo envia en tiempo real
// a todas las personas de la conversacion (dos o un grupo).
async function createAndDispatch(io, {
  chatId, me, type = 'text', body = null, mediaUrl = null, durationSec = null,
  lat = null, lng = null, replyTo = null, originSocket = null
}) {
  const [chatRows] = await db.query('SELECT * FROM chats WHERE id = ?', [chatId]);
  const chat = chatRows[0];
  const isGroup = chat.type === 'group';

  // Solo se puede responder a un mensaje de esta misma conversacion
  let replyId = null;
  if (replyTo) {
    const [r] = await db.query('SELECT id FROM messages WHERE id = ? AND chat_id = ?', [replyTo, chatId]);
    if (r.length) replyId = r[0].id;
  }

  const [result] = await db.query(
    'INSERT INTO messages (chat_id, sender_id, type, body, media_url, duration_sec, lat, lng, reply_to_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [chatId, me, type, body, mediaUrl, durationSec, lat, lng, replyId]
  );
  const [rows] = await db.query(`${MSG_SELECT} WHERE m.id = ?`, [result.insertId]);
  const message = rows[0];

  let targets;
  if (isGroup) {
    const [m] = await db.query('SELECT user_id FROM chat_members WHERE chat_id = ?', [chatId]);
    targets = m.map((x) => x.user_id);
  } else {
    targets = [chat.user_a === me ? chat.user_b : chat.user_a];
  }
  targets = targets.filter((id) => id !== me);

  // En conversaciones de dos, si la otra persona esta conectada queda "entregado" al instante
  if (!isGroup && targets.length) {
    const online = (await io.in(room(targets[0])).fetchSockets()).length > 0;
    if (online) {
      await db.query("UPDATE messages SET status = 'delivered' WHERE id = ?", [message.id]);
      message.status = 'delivered';
    }
  }

  for (const id of targets) io.to(room(id)).emit('message:new', message);
  if (originSocket) originSocket.to(room(me)).emit('message:new', message); // mis otros dispositivos
  else io.to(room(me)).emit('message:new', message);

  return message;
}

module.exports = { createAndDispatch };
