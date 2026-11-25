const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { pool, initDatabase, checkConnection } = require('./db');

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE_NAME = 'auth_token';

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

/* ---------------- 工具函数 ---------------- */

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function parseCookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    result[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return result;
}

function signToken(userId) {
  const now = Date.now();
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, iat: now, exp: now + config.tokenMaxAge })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(payload)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isFinite(data.uid) || !Number.isFinite(data.exp)) return null;
    if (Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  return verifyToken(token);
}

function setAuthCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(
      config.tokenMaxAge / 1000
    )}`
  );
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name || row.username,
    createdAt: row.created_at,
  };
}

const USERNAME_RE = /^[\w\u4e00-\u9fa5]{2,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 仅对登录密码错误做计数，避免被当成注册冲突的暴力尝试 */
const loginAttempts = new Map();
function isLocked(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec) return false;
  if (Date.now() >= rec.until) {
    loginAttempts.delete(ip);
    return false;
  }
  return rec.fails >= 8;
}
function recordLoginFail(ip) {
  const rec = loginAttempts.get(ip) || { fails: 0, until: Date.now() + 15 * 60 * 1000 };
  rec.fails += 1;
  loginAttempts.set(ip, rec);
}
function clearLoginFails(ip) {
  loginAttempts.delete(ip);
}

/* ---------------- API 路由 ---------------- */

app.get('/api/health', asyncHandler(async (req, res) => {
  const dbOk = await checkConnection();
  send(res, 200, { ok: true, database: dbOk });
}));

app.post('/api/register', asyncHandler(async (req, res) => {
  const { username, email, password, displayName } = req.body || {};

  if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) {
    return send(res, 400, { error: '用户名需为 2-30 位的字母、数字、下划线或中文' });
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || email.length > 255) {
    return send(res, 400, { error: '请输入有效的邮箱地址' });
  }
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) {
    return send(res, 400, { error: '密码长度需在 8-72 位之间' });
  }

  const cleanUsername = username.trim();
  const cleanEmail = email.trim().toLowerCase();
  const cleanDisplayName =
    typeof displayName === 'string' && displayName.trim()
      ? displayName.trim().slice(0, 100)
      : cleanUsername;

  const [existing] = await pool.query(
    'SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1',
    [cleanUsername, cleanEmail]
  );
  if (existing.length) {
    return send(res, 409, { error: '该用户名或邮箱已被注册' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  let insertId;
  try {
    const [result] = await pool.query(
      'INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)',
      [cleanUsername, cleanEmail, passwordHash, cleanDisplayName]
    );
    insertId = result.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return send(res, 409, { error: '该用户名或邮箱已被注册' });
    }
    throw err;
  }

  const [rows] = await pool.query(
    'SELECT id, username, email, display_name, created_at FROM users WHERE id = ?',
    [insertId]
  );
  const user = publicUser(rows[0]);
  setAuthCookie(res, signToken(user.id)); // 注册后自动登录
  return send(res, 201, { user, message: '注册成功，账号已保存到数据库' });
}));

app.post('/api/login', asyncHandler(async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (isLocked(ip)) {
    return send(res, 429, { error: '尝试次数过多，请 15 分钟后再试' });
  }

  const { account, password } = req.body || {};
  if (typeof account !== 'string' || !account.trim() || typeof password !== 'string' || !password) {
    return send(res, 400, { error: '请输入账号和密码' });
  }

  const [rows] = await pool.query(
    'SELECT id, username, email, password_hash, display_name, status, created_at FROM users WHERE username = ? OR email = ? LIMIT 1',
    [account.trim(), account.trim().toLowerCase()]
  );
  const userRow = rows[0];

  const isValid = userRow && (await bcrypt.compare(password, userRow.password_hash));
  if (!isValid) {
    recordLoginFail(ip);
    return send(res, 401, { error: '账号或密码错误' });
  }
  if (!userRow.status) {
    return send(res, 403, { error: '该账号已被禁用' });
  }

  clearLoginFails(ip);
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [userRow.id]);
  setAuthCookie(res, signToken(userRow.id));
  return send(res, 200, {
    user: publicUser(userRow),
    message: '登录成功',
  });
}));

app.get('/api/me', asyncHandler(async (req, res) => {
  const session = currentUser(req);
  if (!session) return send(res, 401, { error: '未登录或会话已过期' });

  const [rows] = await pool.query(
    'SELECT id, username, email, display_name, status, created_at FROM users WHERE id = ? LIMIT 1',
    [session.uid]
  );
  const row = rows[0];
  if (!row || !row.status) return send(res, 401, { error: '账号不可用，请重新登录' });
  return send(res, 200, { user: publicUser(row) });
}));

app.post('/api/logout', (req, res) => {
  clearAuthCookie(res);
  return send(res, 200, { message: '已退出登录' });
});

/* ---------------- 静态页面 ---------------- */

app.use(express.static(PUBLIC_DIR, { index: false }));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return send(res, 404, { error: '接口不存在' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

/* ---------------- 错误处理 ---------------- */

app.use((err, req, res, next) => {
  console.error('[ERROR]', err && err.message ? err.message : err);
  if (res.headersSent) return next(err);
  if (err && err.code === 'ECONNREFUSED') {
    return send(res, 503, { error: '无法连接数据库，请确认 MySQL 已启动' });
  }
  return send(res, 500, { error: '服务器内部错误，请稍后重试' });
});

/* ---------------- 启动 ---------------- */

(async () => {
  try {
    await initDatabase();
    app.listen(config.port, '0.0.0.0', () => {
      console.log(`[APP] 服务已启动: http://localhost:${config.port}`);
    });
  } catch (err) {
    console.error('[FATAL] 启动失败：', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
