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

// Crea las tablas que falten (CREATE TABLE IF NOT EXISTS). Reintenta si la base aun no responde.
module.exports = async function migrate() {
  const list = await statements();
  for (let attempt = 1; ; attempt++) {
    try {
      for (const s of list) await db.query(s);
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
