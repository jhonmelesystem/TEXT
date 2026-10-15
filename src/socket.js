const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { toId, getChat, canMessage } = require('./chatlib');
const { createAndDispatch } = require('./messaging');

const room = (userId) => `user:${userId}`;
const MAX_BODY = 4000;

module.exports = function initSocket(httpServer) {
  // En produccion, cambia origin '*' por el dominio real de la app
  const io = new Server(httpServer, { cors: { origin: '*' } });

  // Autenticacion: el cliente envia el token en el handshake
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = payload.uid;
      next();
    } catch {
      next(new Error('No autorizado'));
    }
  });

  // Al conectarse, los mensajes pendientes pasan a "entregado"
  async function markPendingDelivered(me) {
    const [rows] = await db.query(
      `SELECT m.id, m.chat_id, m.sender_id
         FROM messages m JOIN chats c ON c.id = m.chat_id
        WHERE m.status = 'sent' AND m.sender_id <> ? AND (c.user_a = ? OR c.user_b = ?)`,
      [me, me, me]
    );
    if (!rows.length) return;
    await db.query("UPDATE messages SET status = 'delivered' WHERE id IN (?)", [rows.map((r) => r.id)]);
    const groups = {};
    for (const r of rows) {
      if (!groups[r.chat_id]) groups[r.chat_id] = { sender: r.sender_id, ids: [] };
      groups[r.chat_id].ids.push(r.id);
    }
    for (const [chatId, g] of Object.entries(groups)) {
      io.to(room(g.sender)).emit('message:status', {
        chat_id: Number(chatId), message_ids: g.ids, status: 'delivered'
      });
    }
  }

  io.on('connection', (socket) => {
    const me = socket.userId;
    socket.join(room(me));
    markPendingDelivered(me).catch((e) => console.error(e));

    // Enviar mensaje de texto (las imagenes se envian por POST /api/chats/:id/media)
    socket.on('message:send', async (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const chatId = toId(data && data.chat_id);
        const body = String((data && data.body) || '').trim();
        if (!chatId || !body || body.length > MAX_BODY) {
          return reply({ ok: false, error: 'Mensaje invalido' });
        }
        const info = await getChat(chatId, me);
        if (!info) return reply({ ok: false, error: 'Chat no encontrado' });
        if (!(await canMessage(me, info.other))) {
          return reply({ ok: false, error: 'No puedes enviar mensajes a este usuario' });
        }
        const message = await createAndDispatch(io, {
          chatId, me, other: info.other, type: 'text', body, originSocket: socket
        });
        reply({ ok: true, message });
      } catch (err) {
        console.error(err);
        reply({ ok: false, error: 'Error del servidor' });
      }
    });

    // Marcar como leidos los mensajes que recibi en un chat
    socket.on('message:read', async (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const chatId = toId(data && data.chat_id);
        const info = chatId && (await getChat(chatId, me));
        if (!info) return reply({ ok: false, error: 'Chat no encontrado' });

        const [rows] = await db.query(
          "SELECT id FROM messages WHERE chat_id = ? AND sender_id <> ? AND status <> 'read'",
          [chatId, me]
        );
        if (rows.length) {
          const ids = rows.map((r) => r.id);
          await db.query("UPDATE messages SET status = 'read' WHERE id IN (?)", [ids]);
          io.to(room(info.other)).emit('message:status', {
            chat_id: chatId, message_ids: ids, status: 'read'
          });
        }
        reply({ ok: true, count: rows.length });
      } catch (err) {
        console.error(err);
        reply({ ok: false, error: 'Error del servidor' });
      }
    });

    // "Escribiendo..."
    socket.on('typing', async (data) => {
      try {
        const chatId = toId(data && data.chat_id);
        const info = chatId && (await getChat(chatId, me));
        if (!info) return;
        io.to(room(info.other)).emit('typing', {
          chat_id: chatId, user_id: me, is_typing: !!data.is_typing
        });
      } catch (err) {
        console.error(err);
      }
    });
  });

  return io;
};

