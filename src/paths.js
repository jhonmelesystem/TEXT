const path = require('path');

const ROOT = path.join(__dirname, '..');

// En Railway se apuntan a un volumen persistente (ej. /data/uploads y /data/tmp)
module.exports = {
  ROOT,
  UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'),
  TMP_DIR: process.env.TMP_DIR || path.join(ROOT, 'tmp')
};
