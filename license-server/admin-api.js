/**
 * Admin API: key bản quyền, khách hàng, thanh toán, tài khoản admin + phân quyền.
 *
 * Đăng nhập: tài khoản admin (username/mật khẩu → token phiên 12h, header Authorization: Bearer)
 * hoặc ADMIN_SECRET (header x-admin-secret) — luôn có quyền Chủ, dùng để khởi tạo và không bao giờ bị khóa ngoài.
 *
 * Quyền: VIEWER (chỉ xem) < STAFF (tạo/gia hạn/khóa key, quản lý khách) < OWNER (xóa, quản lý admin).
 */
const crypto = require('crypto');

const ROLE_RANK = { VIEWER: 1, STAFF: 2, OWNER: 3 };
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// SQLite CURRENT_TIMESTAMP lưu giờ UTC dạng "YYYY-MM-DD HH:MM:SS" (không có Z) → trình duyệt/Node
// hiểu nhầm thành giờ địa phương, lệch 7 tiếng ở VN. Trả về ISO có Z cho mọi cột thời gian.
function sqliteUtcToIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return value;
  return `${value.replace(' ', 'T')}Z`;
}

function fixTimes(row, cols) {
  if (!row) return row;
  const out = { ...row };
  for (const c of cols) out[c] = sqliteUtcToIso(out[c]);
  return out;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

function str(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function intInRange(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      zalo TEXT,
      email TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_id INTEGER,
      customer_id INTEGER,
      amount INTEGER DEFAULT 0,
      days INTEGER,
      note TEXT,
      actor TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'STAFF',
      active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  const addColumns = (table, cols) => {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    for (const [col, def] of cols) {
      if (!existing.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  };
  addColumns('licenses', [['customer_id', 'INTEGER'], ['max_users', 'INTEGER DEFAULT 1']]);
  addColumns('audit_logs', [['actor', 'TEXT']]);

  // Key cũ chưa gắn khách → tạo hồ sơ khách theo tên đã nhập
  const orphans = db.prepare('SELECT DISTINCT client_name FROM licenses WHERE customer_id IS NULL').all();
  for (const { client_name } of orphans) {
    const existing = db.prepare('SELECT id FROM customers WHERE name = ?').get(client_name);
    const id = existing ? existing.id : db.prepare('INSERT INTO customers (name) VALUES (?)').run(client_name).lastInsertRowid;
    db.prepare('UPDATE licenses SET customer_id = ? WHERE customer_id IS NULL AND client_name = ?').run(id, client_name);
  }
  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(Date.now());
}

module.exports = function mountAdminApi({ app, db, adminSecret, logAudit, generateLicenseKey, rateLimit }) {
  migrate(db);

  const loginLimiter = rateLimit(10, 10 * 60 * 1000);
  const failLimiter = rateLimit(30, 10 * 60 * 1000);
  const secretHash = crypto.createHash('sha256').update(adminSecret).digest();

  function authenticate(req) {
    const secret = String(req.headers['x-admin-secret'] || '');
    if (secret) {
      const given = crypto.createHash('sha256').update(secret).digest();
      return crypto.timingSafeEqual(given, secretHash)
        ? { id: 0, username: 'owner-secret', displayName: 'Chủ (Admin Secret)', role: 'OWNER' }
        : null;
    }
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!bearer) return null;
    const row = db.prepare(`
      SELECT a.* FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND a.active = 1
    `).get(sha256(bearer), Date.now());
    return row ? { id: row.id, username: row.username, displayName: row.display_name || row.username, role: row.role } : null;
  }

  const requireRole = (minRole) => (req, res, next) => {
    const admin = authenticate(req);
    if (!admin) {
      return failLimiter(req, res, () => res.status(401).json({ success: false, message: 'Chưa đăng nhập hoặc phiên đã hết hạn' }));
    }
    if (ROLE_RANK[admin.role] < ROLE_RANK[minRole]) {
      return res.status(403).json({ success: false, message: 'Tài khoản của bạn không có quyền thực hiện thao tác này' });
    }
    req.admin = admin;
    next();
  };
  const VIEWER = requireRole('VIEWER');
  const STAFF = requireRole('STAFF');
  const OWNER = requireRole('OWNER');

  const audit = (req, licenseKey, action, hwid, details = '') =>
    logAudit(licenseKey, action, hwid, req.ip, details, req.admin?.username);

  const findLicense = (id) => db.prepare('SELECT * FROM licenses WHERE id = ?').get(id);

  // ===== Đăng nhập =====
  app.post('/api/admin/login', loginLimiter, (req, res) => {
    const username = str(req.body?.username, 50).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const admin = db.prepare('SELECT * FROM admins WHERE username = ? AND active = 1').get(username);
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      logAudit(null, 'ADMIN_LOGIN_FAIL', null, req.ip, username, username);
      return res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)')
      .run(sha256(token), admin.id, Date.now() + SESSION_TTL_MS);
    db.prepare('UPDATE admins SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(admin.id);
    logAudit(null, 'ADMIN_LOGIN', null, req.ip, '', admin.username);
    res.json({
      success: true,
      token,
      admin: { username: admin.username, displayName: admin.display_name || admin.username, role: admin.role },
    });
  });

  app.post('/api/admin/logout', (req, res) => {
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (bearer) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(bearer));
    res.json({ success: true });
  });

  app.get('/api/admin/me', VIEWER, (req, res) => res.json({ success: true, admin: req.admin }));

  // ===== License =====
  app.get('/api/admin/licenses', VIEWER, (req, res) => {
    const licenses = db.prepare(`
      SELECT l.*, c.name AS customer_name, c.phone AS customer_phone, c.zalo AS customer_zalo
      FROM licenses l LEFT JOIN customers c ON c.id = l.customer_id
      ORDER BY l.id DESC
    `).all().map((l) => fixTimes(l, ['created_at', 'last_ping_at']));

    const now = Date.now();
    const stats = {
      total: licenses.length,
      active: licenses.filter((l) => l.status === 'ACTIVE').length,
      locked: licenses.filter((l) => l.status === 'LOCKED').length,
      onlineNow: licenses.filter((l) => l.last_ping_at && new Date(l.last_ping_at).getTime() > now - 5 * 60 * 1000).length,
      expiringSoon: licenses.filter((l) => l.status === 'ACTIVE' && l.expires_at
        && new Date(l.expires_at).getTime() > now && new Date(l.expires_at).getTime() < now + 7 * DAY_MS).length,
    };
    res.json({ success: true, stats, licenses });
  });

  app.post('/api/admin/licenses/create', STAFF, (req, res) => {
    const durationDays = intInRange(req.body?.durationDays ?? 30, 1, 9999);
    const maxAccounts = intInRange(req.body?.maxAccounts ?? 10, 1, 1000);
    const maxUsers = intInRange(req.body?.maxUsers ?? 1, 1, 100);
    const notes = str(req.body?.notes, 300);
    if (!durationDays || !maxAccounts || !maxUsers) {
      return res.status(400).json({ success: false, message: 'Thời hạn / số tài khoản / số người dùng không hợp lệ' });
    }

    // Chọn khách có sẵn, hoặc nhập tên mới → tạo hồ sơ khách
    let customer = req.body?.customerId ? db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(req.body.customerId)) : null;
    if (!customer) {
      const name = str(req.body?.clientName, 120);
      if (!name) return res.status(400).json({ success: false, message: 'Vui lòng chọn hoặc nhập tên khách hàng' });
      const id = db.prepare('INSERT INTO customers (name, phone, zalo) VALUES (?, ?, ?)')
        .run(name, str(req.body?.phone, 30) || null, str(req.body?.zalo, 60) || null).lastInsertRowid;
      customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    }

    const key = generateLicenseKey('ZTR');
    const expiresAt = durationDays === 9999 ? null : new Date(Date.now() + durationDays * DAY_MS).toISOString();
    const licenseId = db.prepare(`
      INSERT INTO licenses (license_key, client_name, customer_id, hwid, status, duration_days, max_accounts, max_users, notes, expires_at)
      VALUES (?, ?, ?, NULL, 'ACTIVE', ?, ?, ?, ?, ?)
    `).run(key, customer.name, customer.id, durationDays, maxAccounts, maxUsers, notes, expiresAt).lastInsertRowid;

    const amount = intInRange(req.body?.amount ?? 0, 0, 1_000_000_000) ?? 0;
    if (amount > 0) {
      db.prepare('INSERT INTO payments (license_id, customer_id, amount, days, note, actor) VALUES (?, ?, ?, ?, ?, ?)')
        .run(licenseId, customer.id, amount, durationDays === 9999 ? null : durationDays, 'Mua mới', req.admin.username);
    }
    audit(req, key, 'ADMIN_CREATE_KEY', '', `Khách: ${customer.name}, ${durationDays === 9999 ? 'vĩnh viễn' : `${durationDays} ngày`}, ${maxAccounts} TK, ${maxUsers} người dùng`);
    res.json({ success: true, message: 'Tạo License Key thành công!', licenseKey: key });
  });

  // Đổi gói: số tài khoản, số người dùng, ghi chú, chuyển sang khách khác
  app.patch('/api/admin/licenses/:id', STAFF, (req, res) => {
    const license = findLicense(req.params.id);
    if (!license) return res.status(404).json({ success: false, message: 'Không tìm thấy license' });

    const maxAccounts = req.body?.maxAccounts !== undefined ? intInRange(req.body.maxAccounts, 1, 1000) : license.max_accounts;
    const maxUsers = req.body?.maxUsers !== undefined ? intInRange(req.body.maxUsers, 1, 100) : license.max_users;
    if (!maxAccounts || !maxUsers) {
      return res.status(400).json({ success: false, message: 'Số tài khoản (1-1000) hoặc số người dùng (1-100) không hợp lệ' });
    }
    const notes = req.body?.notes !== undefined ? str(req.body.notes, 300) : license.notes;
    let customerId = license.customer_id;
    let clientName = license.client_name;
    if (req.body?.customerId !== undefined) {
      const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(req.body.customerId));
      if (!c) return res.status(400).json({ success: false, message: 'Không tìm thấy khách hàng' });
      customerId = c.id;
      clientName = c.name;
    }
    db.prepare('UPDATE licenses SET max_accounts = ?, max_users = ?, notes = ?, customer_id = ?, client_name = ? WHERE id = ?')
      .run(maxAccounts, maxUsers, notes, customerId, clientName, license.id);
    audit(req, license.license_key, 'UPDATE_PLAN', license.hwid,
      `TK ${license.max_accounts}→${maxAccounts}, người dùng ${license.max_users}→${maxUsers}`);
    res.json({ success: true, message: 'Đã cập nhật gói. App khách nhận giới hạn mới trong vòng 3 phút.' });
  });

  app.post('/api/admin/licenses/:id/toggle', STAFF, (req, res) => {
    const license = findLicense(req.params.id);
    if (!license) return res.status(404).json({ success: false, message: 'Không tìm thấy license' });
    const newStatus = license.status === 'ACTIVE' ? 'LOCKED' : 'ACTIVE';
    db.prepare('UPDATE licenses SET status = ? WHERE id = ?').run(newStatus, license.id);
    audit(req, license.license_key, newStatus === 'LOCKED' ? 'KILL_SWITCH_ACTIVATED' : 'UNLOCKED', license.hwid);
    res.json({
      success: true,
      message: newStatus === 'LOCKED' ? 'Đã kích hoạt Kill-Switch: Khóa máy khách tức thì!' : 'Đã mở khóa license thành công!',
      status: newStatus,
    });
  });

  /**
   * Gia hạn: cộng thêm ngày từ hạn hiện tại (hoặc từ hôm nay nếu đã hết hạn), hoặc chuyển vĩnh viễn.
   * Body: { days } | { lifetime: true }, kèm { amount?, note? } để ghi vào lịch sử thanh toán.
   */
  app.post('/api/admin/licenses/:id/extend', STAFF, (req, res) => {
    const license = findLicense(req.params.id);
    if (!license) return res.status(404).json({ success: false, message: 'Không tìm thấy license' });

    const lifetime = req.body?.lifetime === true;
    const days = intInRange(req.body?.days, 1, 3650);
    if (!lifetime && !days) {
      return res.status(400).json({ success: false, message: 'Số ngày gia hạn không hợp lệ (1 - 3650)' });
    }
    const amount = intInRange(req.body?.amount ?? 0, 0, 1_000_000_000);
    if (amount === null) return res.status(400).json({ success: false, message: 'Số tiền không hợp lệ' });

    let newExpires = null;
    if (!lifetime) {
      if (!license.expires_at) {
        return res.status(400).json({ success: false, message: 'Key này đang là vĩnh viễn, không cần gia hạn' });
      }
      const base = Math.max(Date.now(), new Date(license.expires_at).getTime());
      newExpires = new Date(base + days * DAY_MS).toISOString();
    }

    // Key đã hết hạn thì mở lại; key đang bị khóa tay vẫn giữ khóa
    const newStatus = license.status === 'EXPIRED' ? 'ACTIVE' : license.status;
    db.prepare('UPDATE licenses SET expires_at = ?, status = ? WHERE id = ?').run(newExpires, newStatus, license.id);
    db.prepare('INSERT INTO payments (license_id, customer_id, amount, days, note, actor) VALUES (?, ?, ?, ?, ?, ?)')
      .run(license.id, license.customer_id, amount, lifetime ? null : days, str(req.body?.note, 200) || (lifetime ? 'Nâng vĩnh viễn' : 'Gia hạn'), req.admin.username);

    const from = license.expires_at ? new Date(license.expires_at).toLocaleDateString('vi-VN') : 'vĩnh viễn';
    const to = newExpires ? new Date(newExpires).toLocaleDateString('vi-VN') : 'vĩnh viễn';
    audit(req, license.license_key, 'EXTEND', license.hwid,
      `${from} → ${to}${lifetime ? '' : ` (+${days} ngày)`}${amount ? `, ${amount.toLocaleString('vi-VN')}đ` : ''}`);
    res.json({ success: true, message: `Đã gia hạn ${license.client_name}: ${from} → ${to}`, expiresAt: newExpires, status: newStatus });
  });

  app.post('/api/admin/licenses/:id/reset-hwid', STAFF, (req, res) => {
    const license = findLicense(req.params.id);
    if (!license) return res.status(404).json({ success: false, message: 'Không tìm thấy license' });
    db.prepare('UPDATE licenses SET hwid = NULL WHERE id = ?').run(license.id);
    audit(req, license.license_key, 'RESET_HWID', license.hwid, 'Cho phép kích hoạt trên máy mới');
    res.json({ success: true, message: `Đã xóa khóa phần cứng cho ${license.client_name}. Khách có thể kích hoạt trên máy mới!` });
  });

  app.delete('/api/admin/licenses/:id', OWNER, (req, res) => {
    const license = findLicense(req.params.id);
    if (!license) return res.status(404).json({ success: false, message: 'Không tìm thấy license' });
    db.prepare('DELETE FROM licenses WHERE id = ?').run(license.id);
    audit(req, license.license_key, 'DELETE_KEY', license.hwid, `Khách: ${license.client_name}`);
    res.json({ success: true, message: 'Đã xóa license thành công' });
  });

  app.get('/api/admin/logs', VIEWER, (req, res) => {
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200').all()
      .map((l) => fixTimes(l, ['timestamp']));
    res.json({ success: true, logs });
  });

  // ===== Khách hàng =====
  app.get('/api/admin/customers', VIEWER, (req, res) => {
    const customers = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM licenses l WHERE l.customer_id = c.id) AS license_count,
        (SELECT COUNT(*) FROM licenses l WHERE l.customer_id = c.id AND l.status = 'ACTIVE') AS active_count,
        (SELECT MIN(l.expires_at) FROM licenses l WHERE l.customer_id = c.id AND l.status = 'ACTIVE' AND l.expires_at IS NOT NULL) AS next_expiry,
        (SELECT MAX(l.last_ping_at) FROM licenses l WHERE l.customer_id = c.id) AS last_seen,
        (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.customer_id = c.id) AS total_paid
      FROM customers c ORDER BY c.id DESC
    `).all().map((c) => fixTimes(c, ['created_at', 'last_seen']));
    res.json({ success: true, customers });
  });

  app.get('/api/admin/customers/:id', VIEWER, (req, res) => {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng' });
    const licenses = db.prepare('SELECT * FROM licenses WHERE customer_id = ? ORDER BY id DESC').all(customer.id)
      .map((l) => fixTimes(l, ['created_at', 'last_ping_at']));
    const payments = db.prepare(`
      SELECT p.*, l.license_key FROM payments p LEFT JOIN licenses l ON l.id = p.license_id
      WHERE p.customer_id = ? ORDER BY p.id DESC
    `).all(customer.id).map((p) => fixTimes(p, ['created_at']));
    const keys = licenses.map((l) => l.license_key);
    const logs = keys.length
      ? db.prepare(`SELECT * FROM audit_logs WHERE license_key IN (${keys.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 100`)
        .all(...keys).map((l) => fixTimes(l, ['timestamp']))
      : [];
    res.json({ success: true, customer: fixTimes(customer, ['created_at']), licenses, payments, logs });
  });

  const customerFields = (body) => ({
    name: str(body?.name, 120),
    phone: str(body?.phone, 30) || null,
    zalo: str(body?.zalo, 60) || null,
    email: str(body?.email, 120) || null,
    notes: str(body?.notes, 500) || null,
  });

  app.post('/api/admin/customers', STAFF, (req, res) => {
    const c = customerFields(req.body);
    if (!c.name) return res.status(400).json({ success: false, message: 'Vui lòng nhập tên khách hàng' });
    const id = db.prepare('INSERT INTO customers (name, phone, zalo, email, notes) VALUES (?, ?, ?, ?, ?)')
      .run(c.name, c.phone, c.zalo, c.email, c.notes).lastInsertRowid;
    audit(req, null, 'CUSTOMER_CREATE', null, c.name);
    res.json({ success: true, message: 'Đã thêm khách hàng', id });
  });

  app.patch('/api/admin/customers/:id', STAFF, (req, res) => {
    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng' });
    const c = customerFields({ ...existing, ...req.body });
    if (!c.name) return res.status(400).json({ success: false, message: 'Tên khách hàng không được trống' });
    db.prepare('UPDATE customers SET name = ?, phone = ?, zalo = ?, email = ?, notes = ? WHERE id = ?')
      .run(c.name, c.phone, c.zalo, c.email, c.notes, existing.id);
    // Tên hiển thị trên key đi theo hồ sơ khách (cũng là tên trong token gửi xuống app)
    db.prepare('UPDATE licenses SET client_name = ? WHERE customer_id = ?').run(c.name, existing.id);
    audit(req, null, 'CUSTOMER_UPDATE', null, c.name);
    res.json({ success: true, message: 'Đã cập nhật khách hàng' });
  });

  app.delete('/api/admin/customers/:id', OWNER, (req, res) => {
    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng' });
    const count = db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE customer_id = ?').get(existing.id).n;
    if (count > 0) {
      return res.status(400).json({ success: false, message: `Khách còn ${count} key. Xóa hoặc chuyển key sang khách khác trước.` });
    }
    db.prepare('DELETE FROM customers WHERE id = ?').run(existing.id);
    audit(req, null, 'CUSTOMER_DELETE', null, existing.name);
    res.json({ success: true, message: 'Đã xóa khách hàng' });
  });

  // ===== Tài khoản admin (chỉ Chủ) =====
  const publicAdmin = (a) => fixTimes({
    id: a.id, username: a.username, display_name: a.display_name, role: a.role,
    active: !!a.active, created_at: a.created_at, last_login_at: a.last_login_at,
  }, ['created_at', 'last_login_at']);

  app.get('/api/admin/admins', OWNER, (req, res) => {
    res.json({ success: true, admins: db.prepare('SELECT * FROM admins ORDER BY id').all().map(publicAdmin) });
  });

  app.post('/api/admin/admins', OWNER, (req, res) => {
    const username = str(req.body?.username, 50).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const role = ROLE_RANK[req.body?.role] ? req.body.role : 'STAFF';
    if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
      return res.status(400).json({ success: false, message: 'Tên đăng nhập 3-50 ký tự: chữ thường, số, . _ -' });
    }
    if (password.length < 8) return res.status(400).json({ success: false, message: 'Mật khẩu tối thiểu 8 ký tự' });
    if (db.prepare('SELECT id FROM admins WHERE username = ?').get(username)) {
      return res.status(400).json({ success: false, message: 'Tên đăng nhập đã tồn tại' });
    }
    db.prepare('INSERT INTO admins (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(username, str(req.body?.displayName, 80) || username, hashPassword(password), role);
    audit(req, null, 'ADMIN_CREATE', null, `${username} (${role})`);
    res.json({ success: true, message: `Đã tạo tài khoản ${username}` });
  });

  app.patch('/api/admin/admins/:id', OWNER, (req, res) => {
    const target = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
    const role = req.body?.role !== undefined ? (ROLE_RANK[req.body.role] ? req.body.role : null) : target.role;
    if (!role) return res.status(400).json({ success: false, message: 'Quyền không hợp lệ' });
    const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : target.active;
    if (target.id === req.admin.id && (!active || role !== 'OWNER')) {
      return res.status(400).json({ success: false, message: 'Không thể tự khóa hoặc tự hạ quyền của chính mình' });
    }
    let hash = target.password_hash;
    if (req.body?.password !== undefined) {
      if (typeof req.body.password !== 'string' || req.body.password.length < 8) {
        return res.status(400).json({ success: false, message: 'Mật khẩu tối thiểu 8 ký tự' });
      }
      hash = hashPassword(req.body.password);
    }
    db.prepare('UPDATE admins SET role = ?, active = ?, password_hash = ?, display_name = ? WHERE id = ?')
      .run(role, active, hash, str(req.body?.displayName ?? target.display_name, 80) || target.username, target.id);
    // Đổi mật khẩu / khóa / đổi quyền → đăng xuất mọi phiên đang mở của tài khoản đó
    if (hash !== target.password_hash || !active || role !== target.role) {
      db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(target.id);
    }
    audit(req, null, 'ADMIN_UPDATE', null, `${target.username}: quyền ${role}, ${active ? 'hoạt động' : 'đã khóa'}${hash !== target.password_hash ? ', đổi mật khẩu' : ''}`);
    res.json({ success: true, message: `Đã cập nhật ${target.username}` });
  });

  app.delete('/api/admin/admins/:id', OWNER, (req, res) => {
    const target = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
    if (target.id === req.admin.id) return res.status(400).json({ success: false, message: 'Không thể tự xóa chính mình' });
    db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(target.id);
    db.prepare('DELETE FROM admins WHERE id = ?').run(target.id);
    audit(req, null, 'ADMIN_DELETE', null, target.username);
    res.json({ success: true, message: `Đã xóa ${target.username}` });
  });
};

module.exports.sqliteUtcToIso = sqliteUtcToIso;
