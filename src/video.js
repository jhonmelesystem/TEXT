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
const { probeVideo, transcodeVideo, makeThumbnail } = require('./ffmpeg');

const router = express.Router();

const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const TMP_DIR = path.join(ROOT, 'tmp');      // archivos temporales, se borran al terminar
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// Tamano maximo del archivo ORIGINAL. Por defecto 1024 MB (1 GB), que cubre un video de
// 60 s hasta en 4K. Con VIDEO_MAX_UPLOAD_MB=0 en el .env se quita el limite por completo.
const envMb = process.env.VIDEO_MAX_UPLOAD_MB;
const parsedMb = Number(envMb);
const MAX_MB = envMb === undefined || envMb === '' || Number.isNaN(parsedMb) ? 1024 : Math.max(0, parsedMb);
const MAX_ACTIVE = 2;                         // videos procesandose a la vez
let active = 0;

// Duracion maxima en segundos (configurable con VIDEO_MAX_SECONDS en el .env)
const maxSeconds = () => Math.max(1, Number(process.env.VIDEO_MAX_SECONDS) || 60);

const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + '.upload')
  }),
  limits: MAX_MB > 0 ? { fileSize: MAX_MB * 1024 * 1024, files: 1 } : { files: 1 }
}).single('file');

const limiter = rateLimit({
  windowMs: 60 * 1000, limit: 6,
  message: { error: 'Demasiados videos. Espera un momento.' }
});

function mediaError(e, res) {
  if (e.code === 'FFMPEG_MISSING') {
    console.error('FFmpeg no encontrado. Instalalo o define FFMPEG_PATH y FFPROBE_PATH en el .env');
    return res.status(500).json({ error: 'FFmpeg no esta instalado en el servidor' });
  }
  if (e.code === 'INVALID_VIDEO') return res.status(400).json({ error: 'El archivo no es un video valido' });
  console.error(e);
  return res.status(400).json({ error: 'No se pudo procesar el video' });
}

// Enviar un video a un chat: multipart/form-data con campo "file" y opcional "caption"
router.post('/chats/:id/video', requireAuth, limiter, async (req, res) => {
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
      return res.status(503).json({ error: 'Servidor ocupado procesando videos. Intenta en unos segundos' });
    }

    active++;
    let released = false;
    release = () => { if (!released) { released = true; active--; } };
    res.on('close', release);

    upload(req, res, async (err) => {
      let outPath = null;
      let thumbPath = null;
      try {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `El video supera ${MAX_MB} MB` });
          return res.status(400).json({ error: 'Archivo invalido' });
        }
        if (!req.file) return res.status(400).json({ error: 'Falta el video (campo "file")' });

        // Se valida el contenido real y la duracion
        let meta;
        try { meta = await probeVideo(req.file.path); } catch (e) { return mediaError(e, res); }
        const max = maxSeconds();
        if (meta.duration > max + 0.5) {
          return res.status(400).json({ error: `El video dura mas de ${max} segundos` });
        }

        const base = crypto.randomBytes(16).toString('hex');
        outPath = path.join(UPLOAD_DIR, base + '.mp4');
        thumbPath = path.join(UPLOAD_DIR, base + '.jpg');
        try { await transcodeVideo(req.file.path, outPath, max); } catch (e) { return mediaError(e, res); }
        await makeThumbnail(outPath, thumbPath, meta.duration);

        const caption = String(req.body.caption || '').trim().slice(0, 1000) || null;
        const message = await createAndDispatch(req.app.get('io'), {
          chatId, me, other: info.other, type: 'video', body: caption,
          mediaUrl: '/uploads/' + base + '.mp4',
          durationSec: Math.min(Math.round(meta.duration), max)
        });
        outPath = null; thumbPath = null; // exito: no borrar los archivos finales
        res.status(201).json({ ok: true, message });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error del servidor' });
      } finally {
        release();
        if (req.file) fsp.unlink(req.file.path).catch(() => {});
        if (outPath) fsp.unlink(outPath).catch(() => {});
        if (thumbPath) fsp.unlink(thumbPath).catch(() => {});
      }
    });
  } catch (e) {
    release();
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Limites que el cliente consulta para avisar ANTES de subir un video demasiado largo
router.get('/limits', (req, res) => {
  res.json({ video_max_seconds: maxSeconds(), video_max_upload_mb: MAX_MB });
});

module.exports = router;