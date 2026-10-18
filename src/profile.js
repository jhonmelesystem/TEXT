const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { requireAuth } = require('./middleware');
const { wrap, toId } = require('./chatlib');
const { UPLOAD_DIR } = require('./paths');

const router = express.Router();

const MAX_PIXELS = 50 * 1000 * 1000;
const ALLOWED = new Set(['jpeg', 'png', 'webp', 'gif']);

// avatar: cuadrada 512x512 | cover: panoramica 1280x480
const KINDS = {
  avatar: { col: 'avatar_url', prefix: 'av_', w: 512, h: 512, q: 82 },
  cover: { col: 'cover_url', prefix: 'cv_', w: 1280, h: 480, q: 78 }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 }
}).single('file');

const limiter = rateLimit({
  windowMs: 60 * 1000, limit: 20,
  message: { error: 'Demasiados cambios. Espera un momento.' }
});

async function getMe(userId) {
  const [rows] = await db.query(
    'SELECT id, email, username, display_name, avatar_url, cover_url, created_at FROM users WHERE id = ?',
    [userId]
  );
  return rows[0];
}

// Borra del disco la imagen anterior, solo si es una imagen propia de la app
async function removeOld(value, prefix) {
  if (!new RegExp(`^/uploads/${prefix}[a-f0-9]{32}\\.webp$`).test(value || '')) return;
  await fs.unlink(path.join(UPLOAD_DIR, path.basename(value))).catch(() => {});
}

function setImage(kind) {
  const k = KINDS[kind];
  return (req, res) => upload(req, res, async (err) => {
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

      const name = k.prefix + crypto.randomBytes(16).toString('hex') + '.webp';
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      try {
        await sharp(req.file.buffer, opts)
          .rotate()
          .resize({ width: k.w, height: k.h, fit: 'cover', position: 'attention' })
          .webp({ quality: k.q })
          .toFile(path.join(UPLOAD_DIR, name));
      } catch (e) {
        console.error(e);
        return res.status(400).json({ error: 'No se pudo procesar la imagen' });
      }

      const old = (await getMe(req.userId))[k.col];
      await db.query(`UPDATE users SET ${k.col} = ? WHERE id = ?`, ['/uploads/' + name, req.userId]);
      await removeOld(old, k.prefix);
      res.json(await getMe(req.userId));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error del servidor' });
    }
  });
}

function clearImage(kind) {
  const k = KINDS[kind];
  return wrap(async (req, res) => {
    const old = (await getMe(req.userId))[k.col];
    await db.query(`UPDATE users SET ${k.col} = NULL WHERE id = ?`, [req.userId]);
    await removeOld(old, k.prefix);
    res.json(await getMe(req.userId));
  });
}

router.post('/me/avatar', requireAuth, limiter, setImage('avatar'));
router.post('/me/cover', requireAuth, limiter, setImage('cover'));
router.delete('/me/avatar', requireAuth, clearImage('avatar'));
router.delete('/me/cover', requireAuth, clearImage('cover'));

// Perfil de otra persona (foto, portada, nombre). No se muestra si hay un bloqueo entre ambos.
router.get('/users/:id/profile', requireAuth, wrap(async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Usuario no encontrado' });
  const [rows] = await db.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.cover_url
       FROM users u
      WHERE u.id = ?
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
           WHERE (b.blocker_id = u.id AND b.blocked_id = ?)
              OR (b.blocker_id = ? AND b.blocked_id = u.id))`,
    [id, req.userId, req.userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(rows[0]);
}));

module.exports = router;
