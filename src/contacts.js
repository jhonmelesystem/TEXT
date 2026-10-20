const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { requireAuth: auth } = require('./middleware');

const router = express.Router();

// ---------- utilidades ----------
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  });

const toId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const appUrl = () => process.env.APP_URL || 'http://localhost:3000';

async function isBlocked(a, b) {
  const [rows] = await db.query(
    'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1',
    [a, b, b, a]
  );
  return rows.length > 0;
}

async function relationRows(a, b) {
  const [rows] = await db.query(
    'SELECT user_id, contact_id, status FROM contacts WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)',
    [a, b, b, a]
  );
  return rows;
}

// Un solo chat por pareja: user_a siempre es el id menor
async function ensureChat(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  await db.query('INSERT IGNORE INTO chats (user_a, user_b) VALUES (?, ?)', [lo, hi]);
  const [rows] = await db.query('SELECT id FROM chats WHERE user_a = ? AND user_b = ?', [lo, hi]);
  try {
    await db.query('INSERT IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?), (?, ?)',
      [rows[0].id, lo, rows[0].id, hi]);
  } catch (e) {
    console.error('chat_members:', e.message);
  }
  return rows[0].id;
}

// ---------- buscar usuarios ----------
router.get('/users/search', auth, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().replace(/^@/, '');
  if (q.length < 2) return res.status(400).json({ error: 'Escribe al menos 2 caracteres' });
  const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';

  const [users] = await db.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_url
       FROM users u
      WHERE u.id <> ?
        AND (u.username LIKE ? OR u.display_name LIKE ?)
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
           WHERE (b.blocker_id = u.id AND b.blocked_id = ?)
              OR (b.blocker_id = ? AND b.blocked_id = u.id))
      ORDER BY (u.username = ?) DESC, u.username
      LIMIT 20`,
    [req.userId, like, like, req.userId, req.userId, q]
  );

  const rel = {};
  if (users.length) {
    const ids = users.map((u) => u.id);
    const [rows] = await db.query(
      'SELECT user_id, contact_id, status FROM contacts WHERE (user_id = ? AND contact_id IN (?)) OR (contact_id = ? AND user_id IN (?))',
      [req.userId, ids, req.userId, ids]
    );
    for (const r of rows) {
      const other = r.user_id === req.userId ? r.contact_id : r.user_id;
      if (r.status === 'accepted') rel[other] = 'contact';
      else rel[other] = r.user_id === req.userId ? 'request_sent' : 'request_received';
    }
  }
  res.json(users.map((u) => ({ ...u, relation: rel[u.id] || 'none' })));
}));

// ---------- invitacion directa por ID (username) ----------
router.post('/contacts/request', auth, wrap(async (req, res) => {
  const me = req.userId;
  const username = String(req.body.username || '').trim().toLowerCase().replace(/^@/, '');
  const [found] = await db.query('SELECT id, username, display_name FROM users WHERE username = ?', [username]);
  if (!found.length || (await isBlocked(me, found[0].id))) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }
  const target = found[0];
  if (target.id === me) return res.status(400).json({ error: 'No puedes agregarte a ti mismo' });

  const rows = await relationRows(me, target.id);
  if (rows.some((r) => r.status === 'accepted')) return res.status(409).json({ error: 'Ya son contactos' });
  if (rows.some((r) => r.user_id === me)) return res.status(409).json({ error: 'Solicitud ya enviada' });

  // Si el otro ya me habia invitado, se acepta automaticamente
  if (rows.some((r) => r.user_id === target.id)) {
    await db.query("UPDATE contacts SET status = 'accepted' WHERE user_id = ? AND contact_id = ?", [target.id, me]);
    const chatId = await ensureChat(me, target.id);
    return res.json({ status: 'accepted', chat_id: chatId, user: target });
  }

  await db.query("INSERT INTO contacts (user_id, contact_id, status) VALUES (?, ?, 'pending')", [me, target.id]);
  res.status(201).json({ status: 'pending', user: target });
}));

// Solicitudes recibidas
router.get('/contacts/requests', auth, wrap(async (req, res) => {
  const [rows] = await db.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_url
       FROM contacts c JOIN users u ON u.id = c.user_id
      WHERE c.contact_id = ? AND c.status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
           WHERE (b.blocker_id = u.id AND b.blocked_id = ?)
              OR (b.blocker_id = ? AND b.blocked_id = u.id))
      ORDER BY u.display_name`,
    [req.userId, req.userId, req.userId]
  );
  res.json(rows);
}));

router.post('/contacts/:userId/accept', auth, wrap(async (req, res) => {
  const me = req.userId;
  const other = toId(req.params.userId);
  if (!other || (await isBlocked(me, other))) return res.status(404).json({ error: 'Solicitud no encontrada' });
  const [result] = await db.query(
    "UPDATE contacts SET status = 'accepted' WHERE user_id = ? AND contact_id = ? AND status = 'pending'",
    [other, me]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Solicitud no encontrada' });
  const chatId = await ensureChat(me, other);
  res.json({ ok: true, chat_id: chatId });
}));

router.post('/contacts/:userId/reject', auth, wrap(async (req, res) => {
  const other = toId(req.params.userId);
  if (!other) return res.status(404).json({ error: 'Solicitud no encontrada' });
  await db.query("DELETE FROM contacts WHERE user_id = ? AND contact_id = ? AND status = 'pending'", [other, req.userId]);
  res.json({ ok: true });
}));

// Mis contactos
router.get('/contacts', auth, wrap(async (req, res) => {
  const me = req.userId;
  const [rows] = await db.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, ch.id AS chat_id
       FROM contacts c
       JOIN users u ON u.id = IF(c.user_id = ?, c.contact_id, c.user_id)
       LEFT JOIN chats ch ON ch.user_a = LEAST(u.id, ?) AND ch.user_b = GREATEST(u.id, ?)
      WHERE c.status = 'accepted' AND (c.user_id = ? OR c.contact_id = ?)
      ORDER BY u.display_name`,
    [me, me, me, me, me]
  );
  res.json(rows);
}));

router.delete('/contacts/:userId', auth, wrap(async (req, res) => {
  const other = toId(req.params.userId);
  if (!other) return res.status(404).json({ error: 'Contacto no encontrado' });
  await db.query(
    'DELETE FROM contacts WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)',
    [req.userId, other, other, req.userId]
  );
  res.json({ ok: true });
}));

// ---------- link y QR de invitacion ----------
// El link devuelto es lo que se convierte en QR en el frontend.
router.post('/invites', auth, wrap(async (req, res) => {
  const me = req.userId;
  const [existing] = await db.query(
    'SELECT token, expires_at FROM invites WHERE user_id = ? AND expires_at > NOW() ORDER BY id DESC LIMIT 1',
    [me]
  );
  let token, expires;
  if (existing.length) {
    token = existing[0].token;
    expires = existing[0].expires_at;
  } else {
    token = crypto.randomBytes(24).toString('hex');
    await db.query(
      'INSERT INTO invites (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
      [me, token]
    );
    const [row] = await db.query('SELECT expires_at FROM invites WHERE token = ?', [token]);
    expires = row[0].expires_at;
  }
  const link = `${appUrl()}/invite/${token}`;
  const qr = await QRCode.toDataURL(link, { margin: 1, width: 240 });
  res.json({ token, link, qr, expires_at: expires });
}));

// Revocar mis links (el siguiente POST /invites genera uno nuevo)
router.delete('/invites', auth, wrap(async (req, res) => {
  await db.query('DELETE FROM invites WHERE user_id = ?', [req.userId]);
  res.json({ ok: true });
}));

// Vista previa publica: quien invita (sin datos privados)
router.get('/invites/:token', wrap(async (req, res) => {
  if (!/^[a-f0-9]{48}$/.test(req.params.token)) return res.status(404).json({ error: 'Invitacion no valida' });
  const [rows] = await db.query(
    `SELECT u.username, u.display_name, u.avatar_url
       FROM invites i JOIN users u ON u.id = i.user_id
      WHERE i.token = ? AND i.expires_at > NOW()`,
    [req.params.token]
  );
  if (!rows.length) return res.status(404).json({ error: 'Invitacion no valida o vencida' });
  res.json(rows[0]);
}));

// Aceptar invitacion por link o QR: queda como contacto de inmediato
router.post('/invites/:token/accept', auth, wrap(async (req, res) => {
  const me = req.userId;
  if (!/^[a-f0-9]{48}$/.test(req.params.token)) return res.status(404).json({ error: 'Invitacion no valida' });
  const [rows] = await db.query(
    `SELECT u.id, u.username, u.display_name
       FROM invites i JOIN users u ON u.id = i.user_id
      WHERE i.token = ? AND i.expires_at > NOW()`,
    [req.params.token]
  );
  if (!rows.length) return res.status(404).json({ error: 'Invitacion no valida o vencida' });
  const inviter = rows[0];
  if (inviter.id === me) return res.status(400).json({ error: 'Es tu propia invitacion' });
  if (await isBlocked(me, inviter.id)) return res.status(404).json({ error: 'Invitacion no valida o vencida' });

  await db.query(
    'DELETE FROM contacts WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)',
    [me, inviter.id, inviter.id, me]
  );
  await db.query("INSERT INTO contacts (user_id, contact_id, status) VALUES (?, ?, 'accepted')", [inviter.id, me]);
  const chatId = await ensureChat(me, inviter.id);
  res.json({ status: 'accepted', chat_id: chatId, user: inviter });
}));

// ---------- bloquear ----------
router.get('/blocks', auth, wrap(async (req, res) => {
  const [rows] = await db.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_url
       FROM blocks b JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = ? ORDER BY u.display_name`,
    [req.userId]
  );
  res.json(rows);
}));

router.post('/blocks', auth, wrap(async (req, res) => {
  const me = req.userId;
  const other = toId(req.body.user_id);
  if (!other || other === me) return res.status(400).json({ error: 'Usuario invalido' });
  const [u] = await db.query('SELECT id FROM users WHERE id = ?', [other]);
  if (!u.length) return res.status(404).json({ error: 'Usuario no encontrado' });

  await db.query('INSERT IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)', [me, other]);
  await db.query(
    'DELETE FROM contacts WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)',
    [me, other, other, me]
  );
  res.json({ ok: true });
}));

router.delete('/blocks/:userId', auth, wrap(async (req, res) => {
  const other = toId(req.params.userId);
  if (!other) return res.status(404).json({ error: 'Usuario no encontrado' });
  await db.query('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [req.userId, other]);
  res.json({ ok: true });
}));

// ---------- reportar ----------
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 10,
  message: { error: 'Demasiados reportes. Intenta mas tarde.' }
});

router.post('/reports', auth, reportLimiter, wrap(async (req, res) => {
  const me = req.userId;
  const other = toId(req.body.user_id);
  const reason = String(req.body.reason || '').trim().slice(0, 255);
  if (!other || other === me) return res.status(400).json({ error: 'Usuario invalido' });
  if (!reason) return res.status(400).json({ error: 'Indica el motivo' });
  const [u] = await db.query('SELECT id FROM users WHERE id = ?', [other]);
  if (!u.length) return res.status(404).json({ error: 'Usuario no encontrado' });

  await db.query('INSERT INTO reports (reporter_id, reported_id, reason) VALUES (?, ?, ?)', [me, other, reason]);
  res.status(201).json({ ok: true });
}));

module.exports = router;
