const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('./middleware');
const { toId, getChat, canMessage } = require('./chatlib');
const { createAndDispatch } = require('./messaging');

const router = express.Router();

const { UPLOAD_DIR } = require('./paths');
const MAX_BYTES = 10 * 1024 * 1024;           // 10 MB de entrada
const MAX_PIXELS = 50 * 1000 * 1000;          // evita imagenes gigantes que agoten la memoria
const ALLOWED = new Set(['jpeg', 'png', 'webp', 'gif']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 }
}).single('file');

const limiter = rateLimit({
  windowMs: 60 * 1000, limit: 30,
  message: { error: 'Demasiados envios. Espera un momento.' }
});

// Enviar una imagen a un chat: multipart/form-data con campo "file" y opcional "caption"
router.post('/chats/:id/media', requireAuth, limiter, async (req, res) => {
  try {
    const me = req.userId;
    const chatId = toId(req.params.id);
    const info = chatId && (await getChat(chatId, me));
    if (!info) return res.status(404).json({ error: 'Chat no encontrado' });
    if (!(await canMessage(me, info.other))) {
      return res.status(403).json({ error: 'No puedes enviar mensajes a este usuario' });
    }

    upload(req, res, async (err) => {
      try {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'La imagen supera 10 MB' });
          return res.status(400).json({ error: 'Archivo invalido' });
        }
        if (!req.file) return res.status(400).json({ error: 'Falta la imagen (campo "file")' });

        // Se valida el contenido real del archivo, no su extension ni su tipo declarado
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

        // Comprimir: maximo 1280 px, WebP calidad 80. Se corrige la rotacion y
        // se eliminan los metadatos (incluida la ubicacion GPS).
        const name = crypto.randomBytes(16).toString('hex') + '.webp';
        await fs.mkdir(UPLOAD_DIR, { recursive: true });
        try {
          await sharp(req.file.buffer, opts)
            .rotate()
            .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(path.join(UPLOAD_DIR, name));
        } catch (e) {
          console.error(e);
          return res.status(400).json({ error: 'No se pudo procesar la imagen' });
        }

        const caption = String(req.body.caption || '').trim().slice(0, 1000) || null;
        const message = await createAndDispatch(req.app.get('io'), {
          chatId, me, other: info.other, type: 'image', body: caption, mediaUrl: '/uploads/' + name
        });
        res.status(201).json({ ok: true, message });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error del servidor' });
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
