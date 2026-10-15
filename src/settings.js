const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { requireAuth } = require('./middleware');
const { wrap } = require('./chatlib');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const OWN_BG_RE = /^\/uploads\/bg_[a-f0-9]{32}\.webp$/;
const MAX_PIXELS = 50 * 1000 * 1000;
const ALLOWED = new Set(['jpeg', 'png', 'webp', 'gif']);
const DEFAULT = { chat_bg_type: 'color', chat_bg_value: '#FFFFFF' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 }
}).single('file');

const limiter = rateLimit({
  windowMs: 60 * 1000, limit: 60,
  message: { error: 'Demasiados cambios. Espera un momento.' }
});

async function getSettings(userId) {
  const [rows] = await db.query(
    'SELECT chat_bg_type, chat_bg_value FROM user_settings WHERE user_id = ?',
    [userId]
  );
  return rows[0] || { ...DEFAULT };
}

async function saveBackground(userId, type, value) {
  await db.query('INSERT IGNORE INTO user_settings (user_id) VALUES (?)', [userId]);
  await db.query(
    'UPDATE user_settings SET chat_bg_type = ?, chat_bg_value = ? WHERE user_id = ?',
    [type, value, userId]
  );
}

// Borra del disco el fondo anterior, solo si es una imagen propia de la app
async function removeOldImage(value) {
  if (!OWN_BG_RE.test(value || '')) return;
  await fs.unlink(path.join(UPLOAD_DIR, path.basename(value))).catch(() => {});
}

// Ver mis ajustes
router.get('/settings', requireAuth, wrap(async (req, res) => {
  res.json(await getSettings(req.userId));
}));

// Fondo de color: { "type": "color", "value": "#1A73E8" }
router.put('/settings/background', requireAuth, limiter, wrap(async (req, res) => {
  const type = req.body.type;
  const value = String(req.body.value || '');
  if (type !== 'color' || !COLOR_RE.test(value)) {
    return res.status(400).json({ error: 'Color invalido. Usa el formato #RRGGBB' });
  }
  const old = await getSettings(req.userId);
  await saveBackground(req.userId, 'color', value.toUpperCase());
  await removeOldImage(old.chat_bg_value);
  res.json(await getSettings(req.userId));
}));

// Fondo con imagen propia: multipart/form-data, campo "file"
router.post('/settings/background/image', requireAuth, limiter, (req, res) => {
  upload(req, res, async (err) => {
    try {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'La imagen supera 8 MB' });
        return res.status(400).json({ error: 'Archivo invalido' });
      }
      if (!req.file) return res.status(400).json({ error: 'Falta la imagen (campo "file")' });

      const opts = { limitInputPixels: MAX_PIXELS };
      let meta;
      try {
        meta = await sharp(req.file.buffer, opts).metadata();
      } catch {
        return res.status(400).json({ error: 'El archivo no es una imagen valida' });
      }
      if (!ALLOWED.has(meta.format)) {
        return res.status(400).json({ error: 'Formato no permitido. Usa JPG, PNG, WebP o GIF' });
      }

      const name = 'bg_' + crypto.randomBytes(16).toString('hex') + '.webp';
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      try {
        await sharp(req.file.buffer, opts)
          .rotate()
          .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 70 })
          .toFile(path.join(UPLOAD_DIR, name));
      } catch (e) {
        console.error(e);
        return res.status(400).json({ error: 'No se pudo procesar la imagen' });
      }

      const old = await getSettings(req.userId);
      await saveBackground(req.userId, 'image', '/uploads/' + name);
      await removeOldImage(old.chat_bg_value);
      res.json(await getSettings(req.userId));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error del servidor' });
    }
  });
});

// Volver al fondo por defecto
router.delete('/settings/background', requireAuth, wrap(async (req, res) => {
  const old = await getSettings(req.userId);
  await saveBackground(req.userId, DEFAULT.chat_bg_type, DEFAULT.chat_bg_value);
  await removeOldImage(old.chat_bg_value);
  res.json(await getSettings(req.userId));
}));

module.exports = router;
