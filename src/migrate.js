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

async function columnInfo(table, column) {
  const [rows] = await db.query(
    'SELECT COLUMN_TYPE AS t, IS_NULLABLE AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column]
  );
  return rows[0] || null;
}

async function addColumn(table, column, ddl) {
  if (await columnInfo(table, column)) return;
  await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  console.log(`Tabla ${table}: agregada la columna ${column}`);
}

// Cada mejora es independiente: si una falla se avisa en el log, pero el servidor sigue arrancando
async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`La mejora "${name}" fallo: ${err.message}`);
  }
}

// Mejoras para bases creadas con versiones anteriores. Solo agregan; no borran datos.
async function upgrades() {
  await step('users.cover_url', () => addColumn('users', 'cover_url', 'VARCHAR(255) NULL'));

  await step('messages.type', async () => {
    const t = await columnInfo('messages', 'type');
    if (t && !/location/.test(t.t)) {
      await db.query("ALTER TABLE messages MODIFY type ENUM('text','image','video','audio','location') DEFAULT 'text'");
      console.log('Tabla messages: tipos de mensaje actualizados (audio y ubicacion)');
    }
  });
  await step('messages.reply_to_id', () => addColumn('messages', 'reply_to_id', 'BIGINT NULL'));
  await step('messages.lat', () => addColumn('messages', 'lat', 'DOUBLE NULL'));
  await step('messages.lng', () => addColumn('messages', 'lng', 'DOUBLE NULL'));

  await step('chats.type', () => addColumn('chats', 'type', "ENUM('direct','group') NOT NULL DEFAULT 'direct'"));
  await step('chats.name', () => addColumn('chats', 'name', 'VARCHAR(60) NULL'));
  await step('chats.avatar_url', () => addColumn('chats', 'avatar_url', 'VARCHAR(255) NULL'));
  await step('chats.created_by', () => addColumn('chats', 'created_by', 'BIGINT NULL'));
  await step('chats.created_at', () => addColumn('chats', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'));
  await step('chats.user_a/user_b', async () => {
    const a = await columnInfo('chats', 'user_a');
    if (a && a.n === 'NO') {
      await db.query('ALTER TABLE chats MODIFY user_a BIGINT NULL, MODIFY user_b BIGINT NULL');
      console.log('Tabla chats: user_a y user_b ahora admiten vacio (grupos)');
    }
  });

  // Las conversaciones de dos personas tambien se registran como miembros
  await step('chat_members (conversaciones existentes)', async () => {
    await db.query('INSERT IGNORE INTO chat_members (chat_id, user_id) SELECT id, user_a FROM chats WHERE user_a IS NOT NULL');
    await db.query('INSERT IGNORE INTO chat_members (chat_id, user_id) SELECT id, user_b FROM chats WHERE user_b IS NOT NULL');
  });
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
