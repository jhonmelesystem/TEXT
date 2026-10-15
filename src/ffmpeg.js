const { execFile } = require('child_process');

// Si FFmpeg no esta en el PATH, define FFMPEG_PATH y FFPROBE_PATH en el .env
const FFMPEG = () => process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = () => process.env.FFPROBE_PATH || 'ffprobe';

const fail = (code, msg) => Object.assign(new Error(msg), { code });

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd, args,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    );
  });
}

// Lee la duracion y comprueba que el archivo sea realmente un video
async function probeVideo(file) {
  let out;
  try {
    out = await run(FFPROBE(), [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file
    ], 20000);
  } catch (err) {
    if (err.code === 'ENOENT') throw fail('FFMPEG_MISSING', 'ffprobe no encontrado');
    throw fail('INVALID_VIDEO', 'video invalido');
  }
  let info;
  try { info = JSON.parse(out); } catch { throw fail('INVALID_VIDEO', 'video invalido'); }

  const v = (info.streams || []).find((s) => s.codec_type === 'video');
  const duration = parseFloat(info.format && info.format.duration);
  // Una imagen suelta aparece como "video" de ~0.04 s, por eso se exige un minimo
  if (!v || !Number.isFinite(duration) || duration < 0.5) throw fail('INVALID_VIDEO', 'video invalido');
  return { duration, width: v.width, height: v.height };
}

// Comprime a MP4 (H.264 + AAC), maximo 720p, y recorta a maxSeconds por seguridad
async function transcodeVideo(input, output, maxSeconds) {
  const args = [
    '-y', '-i', input,
    '-t', String(maxSeconds),
    '-map', '0:v:0', '-map', '0:a:0?',
    '-map_metadata', '-1',
    '-vf', 'scale=-2:min(720\\,ih)',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    output
  ];
  try {
    await run(FFMPEG(), args, 10 * 60 * 1000); // hasta 10 min para videos grandes
  } catch (err) {
    if (err.code === 'ENOENT') throw fail('FFMPEG_MISSING', 'ffmpeg no encontrado');
    throw fail('TRANSCODE_FAILED', 'no se pudo procesar el video');
  }
}

// Miniatura JPG (si falla, no pasa nada: el video se envia igual)
async function makeThumbnail(video, output, duration) {
  const t = duration > 1 ? '0.5' : '0';
  try {
    await run(FFMPEG(), [
      '-y', '-ss', t, '-i', video, '-frames:v', '1',
      '-vf', 'scale=min(480\\,iw):-2', '-q:v', '5', output
    ], 20000);
    return true;
  } catch {
    return false;
  }
}

module.exports = { probeVideo, transcodeVideo, makeThumbnail };