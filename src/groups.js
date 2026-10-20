const express = require('express');
const db = require('./db');
const { requireAuth } = require('./middleware');
const { toId, wrap, getChat } = require('./chatlib');

const router = express.Router();

const MAX_MEMBERS = 200;
const room = (userId) => `user:${userId}`;

// Ids de mis contactos aceptados (solo a ellos puedo agregar a un grupo)
async function myContactIds(me) {
  const [rows] = await db.query(
    "SELECT IF(user_id = ?, contact_id, user_id) AS id FROM contacts WHERE status = 'accepted' AND (user_id = ? OR contact_id = ?)",
    [me, me, me]
  );
  return new Set(rows.map((r) => r.id));
}

function cleanIds(list, me) {
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    const id = toId(v);
    if (id && id !== me && !out.includes(id)) out.push(id);
  }
  return out;
}

// Avisa a los miembros (y a quien salio o fue quitado) para que actualicen su lista de chats
async function notify(io, chatId, extraIds = []) {
  const [m] = await db.query('SELECT user_id FROM chat_members WHERE chat_id = ?', [chatId]);
  const ids = new Set([...m.map((x) => x.user_id), ...extraIds]);
  for (const id of ids) io.to(room(id)).emit('chat:update', { chat_id: chatId });
}

async function groupOf(req, res) {
  const chatId = toId(req.params.id);
  const info = chatId && (await getChat(chatId, req.userId));
  if (!info || !info.group) {
    res.status(404).json({ error: 'Grupo no encontrado' });
    return null;
  }
  return { chatId, info };
}

// Crear un grupo: { "name": "Familia", "member_ids": [2, 3] }
router.post('/groups', requireAuth, wrap(async (req, res) => {
  const me = req.userId;
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 60) return res.status(400).json({ error: 'El nombre debe tener de 1 a 60 caracteres' });

  const ids = cleanIds(req.body.member_ids, me);
  if (!ids.length) return res.status(400).json({ error: 'Elige al menos un contacto' });
  if (ids.length + 1 > MAX_MEMBERS) return res.status(400).json({ error: `Un grupo admite hasta ${MAX_MEMBERS} personas` });

  const contacts = await myContactIds(me);
  if (ids.some((id) => !contacts.has(id))) {
    return res.status(400).json({ error: 'Solo puedes agregar a tus contactos' });
  }

  const [r] = await db.query("INSERT INTO chats (type, name, created_by) VALUES ('group', ?, ?)", [name, me]);
  const chatId = r.insertId;
  const rows = [[chatId, me, 'admin'], ...ids.map((id) => [chatId, id, 'member'])];
  await db.query('INSERT INTO chat_members (chat_id, user_id, role) VALUES ?', [rows]);

  await notify(req.app.get('io'), chatId);
  res.status(201).json({ chat_id: chatId, name, member_count: ids.length + 1 });
}));

// Datos del grupo y sus miembros
router.get('/groups/:id', requireAuth, wrap(async (req, res) => {
  const g = await groupOf(req, res);
  if (!g) return;
  const [members] = await db.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, cm.role
       FROM chat_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.chat_id = ?
      ORDER BY (cm.role = 'admin') DESC, u.display_name`,
    [g.chatId]
  );
  res.json({
    chat_id: g.chatId,
    name: g.info.chat.name,
    avatar_url: g.info.chat.avatar_url,
    created_by: g.info.chat.created_by,
    my_role: g.info.role,
    members
  });
}));

// Cambiar el nombre (solo administradores)
router.patch('/groups/:id', requireAuth, wrap(async (req, res) => {
  const g = await groupOf(req, res);
  if (!g) return;
  if (g.info.role !== 'admin') return res.status(403).json({ error: 'Solo los administradores pueden cambiar el grupo' });
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 60) return res.status(400).json({ error: 'El nombre debe tener de 1 a 60 caracteres' });
  await db.query('UPDATE chats SET name = ? WHERE id = ?', [name, g.chatId]);
  await notify(req.app.get('io'), g.chatId);
  res.json({ ok: true, name });
}));

// Agregar personas (solo administradores, y solo contactos de quien agrega)
router.post('/groups/:id/members', requireAuth, wrap(async (req, res) => {
  const me = req.userId;
  const g = await groupOf(req, res);
  if (!g) return;
  if (g.info.role !== 'admin') return res.status(403).json({ error: 'Solo los administradores pueden agregar personas' });

  const ids = cleanIds(req.body.user_ids, me);
  if (!ids.length) return res.status(400).json({ error: 'Elige al menos un contacto' });
  const contacts = await myContactIds(me);
  if (ids.some((id) => !contacts.has(id))) return res.status(400).json({ error: 'Solo puedes agregar a tus contactos' });

  const [cur] = await db.query('SELECT user_id FROM chat_members WHERE chat_id = ?', [g.chatId]);
  const have = new Set(cur.map((x) => x.user_id));
  const fresh = ids.filter((id) => !have.has(id));
  if (cur.length + fresh.length > MAX_MEMBERS) return res.status(400).json({ error: `Un grupo admite hasta ${MAX_MEMBERS} personas` });

  if (fresh.length) {
    await db.query('INSERT IGNORE INTO chat_members (chat_id, user_id, role) VALUES ?', [fresh.map((id) => [g.chatId, id, 'member'])]);
  }
  await notify(req.app.get('io'), g.chatId);
  res.json({ ok: true, added: fresh.length });
}));

// Quitar a alguien, o salir uno mismo
async function removeMember(req, res, targetId) {
  const me = req.userId;
  const g = await groupOf(req, res);
  if (!g) return;
  if (!targetId) return res.status(400).json({ error: 'Persona invalida' });

  const [t] = await db.query('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?', [g.chatId, targetId]);
  if (!t.length) return res.status(404).json({ error: 'Esa persona no esta en el grupo' });

  if (targetId !== me) {
    if (g.info.role !== 'admin') return res.status(403).json({ error: 'Solo los administradores pueden quitar personas' });
    if (t[0].role === 'admin' && g.info.chat.created_by !== me) {
      return res.status(403).json({ error: 'Solo quien creo el grupo puede quitar administradores' });
    }
  }

  await db.query('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?', [g.chatId, targetId]);

  const [left] = await db.query('SELECT user_id, role FROM chat_members WHERE chat_id = ?', [g.chatId]);
  if (!left.length) {
    // Nadie queda: se borra el grupo
    await db.query('DELETE FROM messages WHERE chat_id = ?', [g.chatId]);
    await db.query('DELETE FROM chats WHERE id = ?', [g.chatId]);
  } else if (!left.some((x) => x.role === 'admin')) {
    // Si se fue el ultimo administrador, el miembro mas antiguo pasa a serlo
    await db.query("UPDATE chat_members SET role = 'admin' WHERE chat_id = ? ORDER BY joined_at, user_id LIMIT 1", [g.chatId]);
  }

  await notify(req.app.get('io'), g.chatId, [targetId]);
  res.json({ ok: true });
}

router.delete('/groups/:id/members/:userId', requireAuth, wrap((req, res) => removeMember(req, res, toId(req.params.userId))));
router.post('/groups/:id/leave', requireAuth, wrap((req, res) => removeMember(req, res, req.userId)));

module.exports = router;
