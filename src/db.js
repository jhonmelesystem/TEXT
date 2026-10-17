require('dotenv').config();
const mysql = require('mysql2/promise');

const env = process.env;

// Acepta las variables DB_* (desarrollo) o las MYSQL* que crea Railway
const pool = mysql.createPool({
  host: env.DB_HOST || env.MYSQLHOST,
  port: Number(env.DB_PORT || env.MYSQLPORT || 3306),
  user: env.DB_USER || env.MYSQLUSER,
  password: env.DB_PASSWORD || env.MYSQLPASSWORD,
  database: env.DB_NAME || env.MYSQLDATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

module.exports = pool;
