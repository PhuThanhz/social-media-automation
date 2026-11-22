const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 5050;
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
if (ADMIN_SECRET.length < 12) {
  console.error('[License Server] Thiếu ADMIN_SECRET (>= 12 ký tự). Đặt trong license-server/.env hoặc biến môi trường.');
  process.exit(1);
}

// Token offline hợp lệ bao lâu kể từ lần ping thành công cuối (mặc định 72h)
const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL_HOURS || 72) * 3600;

// Khóa ký Ed25519: ưu tiên env LICENSE_PRIVATE_KEY (PEM), không có thì đọc/tạo keys/private.pem
const keysDir = path.join(__dirname, 'keys');
function loadSigningKey() {
  if (process.env.LICENSE_PRIVATE_KEY) {
    return crypto.createPrivateKey(process.env.LICENSE_PRIVATE_KEY.replace(/\\n/g, '\n'));
  }
  const privPath = path.join(keysDir, 'private.pem');
  if (!fs.existsSync(privPath)) {
    fs.mkdirSync(keysDir, { recursive: true });
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    console.log('[License Server] Đã tạo khóa ký mới: keys/private.pem (GIỮ BÍ MẬT, sao lưu cẩn thận)');
  }
  return crypto.createPrivateKey(fs.readFileSync(privPath));
}
const signingKey = loadSigningKey();
const PUBLIC_KEY_B64URL = crypto.createPublicKey(signingKey).export({ format: 'jwk' }).x;
fs.mkdirSync(keysDir, { recursive: true });
fs.writeFileSync(path.join(keysDir, 'public.b64'), PUBLIC_KEY_B64URL);

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

// Token = base64url(payload JSON) + "." + base64url(chữ ký Ed25519 trên bytes payload)
function issueToken(license, hwid) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    key: license.license_key,
    hwid,
    client: license.client_name,
    maxAccounts: license.max_accounts,
    maxUsers: license.max_users || 1,
    licenseExp: license.expires_at ? Math.floor(new Date(license.expires_at).getTime() / 1000) : null,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  }));
  return `${b64url(payload)}.${b64url(crypto.sign(null, payload, signingKey))}`;
}

// Chỉ tin X-Forwarded-For khi chạy sau reverse proxy (TRUST_PROXY=1)
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

// Client API được gọi từ Rust (không qua trình duyệt) nên không cần CORS; chỉ mở cho trang admin
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '16kb' }));

// Rate limit đơn giản theo IP (in-memory)
function rateLimit(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const entry = hits.get(req.ip) || { count: 0, reset: now + windowMs };
    if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
    entry.count++;
    hits.set(req.ip, entry);
    if (hits.size > 10000) hits.clear();
    if (entry.count > max) {
      return res.status(429).json({ success: false, valid: false, message: 'Quá nhiều yêu cầu, thử lại sau ít phút.' });
    }
    next();
  };
}
app.use('/admin', express.static(path.join(__dirname, 'public')));

// Chẩn đoán: người gọi xem IP server nhận được của chính mình (kiểm tra cấu hình proxy)
app.get('/api/client-ip', (req, res) => {
  res.json({
    ip: req.ip,
    ips: req.ips,
    socket: req.socket.remoteAddress,
    xff: req.get('x-forwarded-for') || null,
    cfConnectingIp: req.get('cf-connecting-ip') || null,
    trueClientIp: req.get('true-client-ip') || null,
    xRealIp: req.get('x-real-ip') || null,
  });
});

// SQLite Database Setup
const dbPath = process.env.DB_PATH || path.join(__dirname, 'licenses.db');
const db = new DatabaseSync(dbPath);

// Initialize Tables & Performance Tuning
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA cache_size = -64000;

  CREATE TABLE IF NOT EXISTS licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT UNIQUE NOT NULL,
    client_name TEXT NOT NULL,
    hwid TEXT,
    status TEXT DEFAULT 'ACTIVE', -- ACTIVE, LOCKED, EXPIRED
    duration_days INTEGER DEFAULT 30,
    max_accounts INTEGER DEFAULT 10,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    last_ping_at DATETIME,
    last_ip TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);
  CREATE INDEX IF NOT EXISTS idx_licenses_hwid ON licenses(hwid);
  CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT,
    action TEXT,
    hwid TEXT,
    ip TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    details TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_audit_key ON audit_logs(license_key);
`);

// Cột thêm sau: hệ điều hành + phiên bản app của khách (DB cũ tự được bổ sung)
const licenseColumns = db.prepare('PRAGMA table_info(licenses)').all().map((c) => c.name);
for (const [col, type] of [['client_os', 'TEXT'], ['app_version', 'TEXT']]) {
  if (!licenseColumns.includes(col)) db.exec(`ALTER TABLE licenses ADD COLUMN ${col} ${type}`);
}

// clientInfo do app khách tự gửi → chỉ nhận chuỗi ngắn, ký tự an toàn
function clientField(value) {
  return typeof value === 'string' ? value.replace(/[^\w .\-]/g, '').slice(0, 32) : null;
}

// Helper to log audit events
// actor: tài khoản admin thực hiện (null = do app khách gửi lên)
function logAudit(licenseKey, action, hwid, ip, details = '', actor = null) {
  try {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (license_key, action, hwid, ip, details, actor)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(licenseKey, action, hwid, ip, details, actor);
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

// Generate formatted key: ZTR-XXXX-XXXX-XXXX
function generateLicenseKey(prefix = 'ZTR') {
  const seg1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const seg2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const seg3 = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}-${seg1}-${seg2}-${seg3}`;
}


// ==========================================
// 1. CLIENT API (App gọi để kích hoạt & ping)
// ==========================================

/**
 * Kích hoạt bản quyền cho thiết bị
 * POST /api/license/activate
 * Body: { licenseKey, hwid, clientInfo }
 */
app.post('/api/license/activate', rateLimit(20, 10 * 60 * 1000), (req, res) => {
  const licenseKey = req.body.licenseKey || req.body.key;
  const { hwid, clientInfo } = req.body;
  const ip = req.ip || 'unknown';

  if (typeof licenseKey !== 'string' || typeof hwid !== 'string' || !licenseKey.trim() || !hwid.trim() || hwid.length > 64) {
    return res.status(400).json({ success: false, message: 'Thiếu mã License Key hoặc mã HWID thiết bị' });
  }

  const findStmt = db.prepare('SELECT * FROM licenses WHERE license_key = ?');
  const license = findStmt.get(licenseKey.trim().toUpperCase());

  if (!license) {
    logAudit(licenseKey, 'ACTIVATE_FAIL_NOT_FOUND', hwid, ip);
    return res.status(404).json({ success: false, message: 'Mã License Key không tồn tại trên hệ thống' });
  }

  if (license.status === 'LOCKED') {
    logAudit(licenseKey, 'ACTIVATE_BLOCKED_LOCKED', hwid, ip);
    return res.status(403).json({ success: false, message: 'Bản quyền này đã bị khóa từ xa bởi quản trị viên!' });
  }

  // Kiểm tra hạn sử dụng
  if (license.expires_at) {
    const expireTime = new Date(license.expires_at).getTime();
    if (Date.now() > expireTime) {
      db.prepare("UPDATE licenses SET status = 'EXPIRED' WHERE id = ?").run(license.id);
      logAudit(licenseKey, 'ACTIVATE_EXPIRED', hwid, ip);
      return res.status(403).json({ success: false, message: 'Mã License Key đã hết hạn sử dụng' });
    }
  }

  // Kiểm tra khóa cứng phần cứng (HWID Lock)
  if (!license.hwid) {
    // Kích hoạt lần đầu trên máy này -> khóa cứng HWID
    const updateStmt = db.prepare(`
      UPDATE licenses 
      SET hwid = ?, last_ping_at = CURRENT_TIMESTAMP, last_ip = ?, client_os = ?, app_version = ?
      WHERE id = ?
    `);
    updateStmt.run(hwid.trim(), ip, clientField(clientInfo?.os), clientField(clientInfo?.app), license.id);
    logAudit(licenseKey, 'ACTIVATE_BIND_HWID', hwid, ip, `Bound to machine: ${JSON.stringify(clientInfo || {})}`);
    
    return res.json({
      success: true,
      token: issueToken(license, hwid.trim()),
      message: 'Kích hoạt bản quyền thành công!',
      clientName: license.client_name,
      status: 'ACTIVE',
      expiresAt: license.expires_at,
      maxAccounts: license.max_accounts,
    maxUsers: license.max_users || 1,
    });
  }

  // Máy đã từng kích hoạt: kiểm tra HWID có khớp không
  if (license.hwid !== hwid.trim()) {
    logAudit(licenseKey, 'ACTIVATE_HWID_MISMATCH', hwid, ip, `Key belongs to ${license.hwid}, attempted by ${hwid}`);
    return res.status(403).json({
      success: false,
      message: 'License Key này đã được gắn với máy tính khác! Không thể kích hoạt trên thiết bị này. Vui lòng liên hệ Admin để đổi máy.',
    });
  }

  // Cùng máy kích hoạt lại
  db.prepare('UPDATE licenses SET last_ping_at = CURRENT_TIMESTAMP, last_ip = ?, client_os = ?, app_version = ? WHERE id = ?')
    .run(ip, clientField(clientInfo?.os), clientField(clientInfo?.app), license.id);
  logAudit(licenseKey, 'ACTIVATE_REBIND_OK', hwid, ip);

  return res.json({
    success: true,
    token: issueToken(license, hwid.trim()),
    message: 'Xác thực bản quyền thành công!',
    clientName: license.client_name,
    status: 'ACTIVE',
    expiresAt: license.expires_at,
    maxAccounts: license.max_accounts,
    maxUsers: license.max_users || 1,
  });
});

/**
 * Heartbeat định kỳ (Ping kiểm tra bản quyền & khóa từ xa)
 * POST /api/license/ping
 * Body: { licenseKey, hwid }
 */
app.post('/api/license/ping', rateLimit(180, 10 * 60 * 1000), (req, res) => {
  const licenseKey = req.body.licenseKey || req.body.key;
  const { hwid, clientInfo } = req.body;
  const ip = req.ip || 'unknown';

  if (typeof licenseKey !== 'string' || typeof hwid !== 'string' || !licenseKey.trim() || !hwid.trim()) {
    return res.status(400).json({ valid: false, message: 'Thiếu thông tin licenseKey hoặc hwid' });
  }

  const findStmt = db.prepare('SELECT * FROM licenses WHERE license_key = ?');
  const license = findStmt.get(licenseKey.trim().toUpperCase());

  if (!license) {
    return res.status(404).json({ valid: false, status: 'NOT_FOUND', message: 'License không tồn tại' });
  }

  // NẾU ADMIN ĐÃ BẤM KHÓA TRÊN DASHBOARD
  if (license.status === 'LOCKED') {
    logAudit(licenseKey, 'HEARTBEAT_KILL_SWITCH_HIT', hwid, ip);
    return res.json({
      valid: false,
      status: 'LOCKED',
      message: 'Bản quyền đã bị khóa hoặc thu hồi từ xa bởi Quản Trị Viên! Ứng dụng sẽ tự động đóng.',
    });
  }

  // Kiểm tra hạn sử dụng
  if (license.expires_at && Date.now() > new Date(license.expires_at).getTime()) {
    db.prepare("UPDATE licenses SET status = 'EXPIRED' WHERE id = ?").run(license.id);
    return res.json({
      valid: false,
      status: 'EXPIRED',
      message: 'Bản quyền của bạn đã hết hạn. Vui lòng gia hạn để tiếp tục sử dụng.',
    });
  }

  // Kiểm tra HWID (admin đã Reset HWID thì máy cũ cũng mất quyền cho tới khi kích hoạt lại)
  if (!license.hwid) {
    return res.json({
      valid: false,
      status: 'NOT_ACTIVATED',
      message: 'Bản quyền đã được đặt lại mã máy. Vui lòng nhập lại License Key để kích hoạt.',
    });
  }
  if (license.hwid !== hwid.trim()) {
    return res.json({
      valid: false,
      status: 'HWID_MISMATCH',
      message: 'Phát hiện thiết bị không hợp lệ (HWID giả mạo).',
    });
  }

  // Cập nhật trạng thái sống (Alive); app cũ chưa gửi clientInfo thì giữ giá trị đã có
  db.prepare(`UPDATE licenses SET last_ping_at = CURRENT_TIMESTAMP, last_ip = ?,
    client_os = COALESCE(?, client_os), app_version = COALESCE(?, app_version) WHERE id = ?`)
    .run(ip, clientField(clientInfo?.os), clientField(clientInfo?.app), license.id);

  return res.json({
    valid: true,
    token: issueToken(license, hwid.trim()),
    status: 'ACTIVE',
    clientName: license.client_name,
    expiresAt: license.expires_at,
  });
});

// Public key để nhúng vào app lúc build (LICENSE_PUBLIC_KEY)
app.get('/api/license/public-key', (req, res) => {
  res.json({ alg: 'Ed25519', publicKey: PUBLIC_KEY_B64URL });
});

// ==========================================
// 2. ADMIN API (admin-api.js): key, khách hàng, thanh toán, tài khoản admin
// ==========================================
require('./admin-api')({ app, db, adminSecret: ADMIN_SECRET, logAudit, generateLicenseKey, rateLimit });

// Chuyển hướng trang chủ về /admin
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// Khởi động server
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 [ToolZutter License Server] Đang chạy tại:`);
  console.log(`   👉 Admin Dashboard: http://localhost:${PORT}/admin`);
  console.log(`   👉 Public key:      ${PUBLIC_KEY_B64URL}`);
  console.log(`   👉 Client API:      http://localhost:${PORT}/api/license/activate`);
  console.log(`======================================================\n`);
});
