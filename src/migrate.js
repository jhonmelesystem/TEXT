const fs = require('fs/promises');
const path = require('path');
const db = require('./db');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lee database/schema.sql y devuelve las sentencias, sin CREATE DATABASE ni USE
// (se crean las tablas en la base a la que ya esta conectado el servidor)
async function statements() {
  const sql = await fs.readFile(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
  return sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !/^(CREATE DATABASE|USE)\b/i.test(s));
}

// Mejoras para bases creadas con versiones anteriores (se aplican una sola vez)
async function upgrades() {
  const [t] = await db.query(
    "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'type'"
  );
  if (t.length && !/audio/.test(t[0].t)) {
    await db.query("ALTER TABLE messages MODIFY type ENUM('text','image','video','audio') DEFAULT 'text'");
    console.log('Tabla messages: agregado el tipo audio');
  }
  const [c] = await db.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'cover_url'"
  );
  if (!c.length) {
    await db.query('ALTER TABLE users ADD COLUMN cover_url VARCHAR(255) NULL');
    console.log('Tabla users: agregada la columna cover_url');
  }
}

// Crea las tablas que falten y aplica las mejoras. Reintenta si la base aun no responde.
module.exports = async function migrate() {
  const list = await statements();
  for (let attempt = 1; ; attempt++) {
    try {
      for (const s of list) await db.query(s);
      await upgrades();
      console.log(`Base de datos lista (${list.length} sentencias)`);
      return;
    } catch (err) {
      if (attempt >= 6) throw err;
      console.error(`Base de datos no disponible (${err.code || err.message}). Reintentando en 5 s...`);
      await sleep(5000);
    }
  }
};
module.exports.statements = statements;