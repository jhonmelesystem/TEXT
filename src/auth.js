const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { sendCode } = require('./mailer');
const { TERMS_VERSION } = require('./legal');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

const requestLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5,
  message: { error: 'Demasiados intentos. Espera unos minutos.' } });
const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10,
  message: { error: 'Demasiados intentos. Espera unos minutos.' } });

function signToken(userId) {
  return jwt.sign({ uid: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// 1) Pedir codigo al correo
router.post('/request-code', requestLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 255) {
      return res.status(400).json({ error: 'Correo invalido' });
    }
    const code = String(crypto.randomInt(100000, 1000000));
    const hash = await bcrypt.hash(code, 10);

    await db.query('UPDATE email_codes SET used = 1 WHERE email = ? AND used = 0', [email]);
    await db.query(
      'INSERT INTO email_codes (email, code_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))',
      [email, hash]
    );
    await sendCode(email, code);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// 2) Verificar codigo. Si el usuario es nuevo, hay que enviar tambien username y display_name
router.post('/verify-code', verifyLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Datos invalidos' });
    }

    const [rows] = await db.query(
      'SELECT id, code_hash FROM email_codes WHERE email = ? AND used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1',
      [email]
    );
    if (!rows.length || !(await bcrypt.compare(code, rows[0].code_hash))) {
      return res.status(400).json({ error: 'Codigo incorrecto o vencido' });
    }
    const codeId = rows[0].id;

    const [users] = await db.query('SELECT id, username, display_name FROM users WHERE email = ?', [email]);

    // Usuario existente: iniciar sesion
    if (users.length) {
      await db.query('UPDATE email_codes SET used = 1 WHERE id = ?', [codeId]);
      return res.json({ token: signToken(users[0].id), user: users[0], new_user: false });
    }

    // Usuario nuevo: pedir perfil si aun no lo envio
    const username = String(req.body.username || '').trim().toLowerCase();
    const displayName = String(req.body.display_name || '').trim();
    if (!username || !displayName) {
      return res.json({ new_user: true, needs_profile: true });
    }
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'El ID debe tener 3-30 caracteres: letras minusculas, numeros o _' });
    }
    if (displayName.length > 60) {
      return res.status(400).json({ error: 'Nombre demasiado largo' });
    }
    if (req.body.accept_terms !== true) {
      return res.status(400).json({ error: 'Debes aceptar los Terminos y la Politica de Privacidad' });
    }
    const [taken] = await db.query('SELECT id FROM users WHERE username = ?', [username]);
    if (taken.length) return res.status(409).json({ error: 'Ese ID ya esta en uso' });

    const [result] = await db.query(
      'INSERT INTO users (email, username, display_name, email_verified, terms_version, terms_accepted_at) VALUES (?, ?, ?, 1, ?, NOW())',
      [email, username, displayName, TERMS_VERSION]
    );
    await db.query('INSERT INTO user_settings (user_id) VALUES (?)', [result.insertId]);
    await db.query('UPDATE email_codes SET used = 1 WHERE id = ?', [codeId]);

    res.status(201).json({
      token: signToken(result.insertId),
      user: { id: result.insertId, username, display_name: displayName },
      new_user: true
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
