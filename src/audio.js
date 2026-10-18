const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('./middleware');
const { toId, getChat, canMessage } = require('./chatlib');
const { createAndDispatch } = require('./messaging');
const { probeAudio, transcodeAudio } = require('./ffmpeg');
const { UPLOAD_DIR, TMP_DIR } = require('./paths');

const router = express.Router();
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// Las notas de voz NO tienen limite de duracion. Solo hay un tope generoso de tamano del
// archivo (VOICE_MAX_UPLOAD_MB, por defecto 500 MB; con 0 se quita).
const envMb = process.env.VOICE_MAX_UPLOAD_MB;
const parsedMb = Number(envMb);
const MAX_MB = envMb === undefined || envMb === '' || Number.isNaN(parsedMb) ? 500 : Math.max(0, parsedMb);
const MAX_ACTIVE = 3;
let active = 0;

const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + '.upload')
  }),
  limits: MAX_MB > 0 ? { fileSize: MAX_MB * 1024 * 1024, files: 1 } : { files: 1 }
}).single('file');

const limiter = rateLimit({
  windowMs: 60 * 1000, limit: 30,
  message: { error: 'Demasiadas notas de voz. Espera un momento.' }
});

function mediaError(e, res) {
  if (e.code === 'FFMPEG_MISSING') {
    console.error('FFmpeg no encontrado');
    return res.status(500).json({ error: 'FFmpeg no esta instalado en el servidor' });
  }
  if (e.code === 'INVALID_AUDIO') return res.status(400).json({ error: 'El archivo no es un audio valido' });
  console.error(e);
  return res.status(400).json({ error: 'No se pudo procesar la nota de voz' });
}

// Enviar una nota de voz: multipart/form-data con el campo "file"
router.post('/chats/:id/audio', requireAuth, limiter, async (req, res) => {
  let release = () => {};
  try {
    const me = req.userId;
    const chatId = toId(req.params.id);
    const info = chatId && (await getChat(chatId, me));
    if (!info) return res.status(404).json({ error: 'Chat no encontrado' });
    if (!(await canMessage(me, info.other))) {
      return res.status(403).json({ error: 'No puedes enviar mensajes a este usuario' });
    }
    if (active >= MAX_ACTIVE) {
      return res.status(503).json({ error: 'Servidor ocupado. Intenta en unos segundos' });
    }

    active++;
    let released = false;
    release = () => { if (!released) { released = true; active--; } };
    res.on('close', release);

    upload(req, res, async (err) => {
      let outPath = null;
      try {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `El audio supera ${MAX_MB} MB` });
          return res.status(400).json({ error: 'Archivo invalido' });
        }
        if (!req.file) return res.status(400).json({ error: 'Falta el audio (campo "file")' });

        try { await probeAudio(req.file.path); } catch (e) { return mediaError(e, res); }

        const name = crypto.randomBytes(16).toString('hex') + '.m4a';
        outPath = path.join(UPLOAD_DIR, name);
        try { await transcodeAudio(req.file.path, outPath); } catch (e) { return mediaError(e, res); }

        // La duracion real se lee del archivo ya convertido (las grabaciones del navegador no la traen)
        let meta;
        try { meta = await probeAudio(outPath); } catch (e) { return mediaError(e, res); }
        if (!meta.duration || meta.duration < 0.5) {
          return res.status(400).json({ error: 'La nota de voz es demasiado corta' });
        }

        const message = await createAndDispatch(req.app.get('io'), {
          chatId, me, other: info.other, type: 'audio', body: null,
          mediaUrl: '/uploads/' + name, durationSec: Math.max(1, Math.round(meta.duration))
        });
        outPath = null;
        res.status(201).json({ ok: true, message });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error del servidor' });
      } finally {
        release();
        if (req.file) fsp.unlink(req.file.path).catch(() => {});
        if (outPath) fsp.unlink(outPath).catch(() => {});
      }
    });
  } catch (e) {
    release();
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
