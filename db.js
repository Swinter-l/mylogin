const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool(config.db);

// 启动时建表：所有账号数据都落在 usedatas.users
const INIT_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(50)  NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name  VARCHAR(100) NULL,
  status        TINYINT NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
`;

async function initDatabase() {
  const conn = await pool.getConnection();
  try {
    await conn.query(INIT_SQL);
    console.log(`[DB] 已连接 MySQL ${config.db.host}:${config.db.port}/${config.db.database}，users 表就绪`);
  } finally {
    conn.release();
  }
}

async function checkConnection() {
  const [rows] = await pool.query('SELECT 1 AS ok');
  return rows && rows[0] && rows[0].ok === 1;
}

module.exports = { pool, initDatabase, checkConnection };
