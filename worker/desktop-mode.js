/**
 * Chế độ Desktop (app Tauri tự khởi động worker với các biến môi trường dưới đây).
 * Không có DESKTOP_SESSION_TOKEN → mọi giá trị giữ nguyên như bản chạy dev/server cũ.
 *
 * DESKTOP_SESSION_TOKEN  token phiên ngẫu nhiên, bắt buộc với mọi request (header X-Session-Token hoặc ?st=)
 * BACKEND_TOKEN          token riêng khi worker gọi ngược về backend (backend bỏ qua bước đăng nhập người dùng)
 * BACKEND_URL            địa chỉ backend (mặc định http://localhost:8081)
 * WORKER_PUBLIC_URL      địa chỉ công khai của worker để tạo link file tải về (mặc định http://localhost:3001)
 * BIND_HOST              chỉ nghe trên host này (Desktop: 127.0.0.1)
 * PARENT_PID             pid app Tauri; app tắt thì worker tự thoát
 */
const crypto = require('crypto');

const SESSION_TOKEN = process.env.DESKTOP_SESSION_TOKEN || '';
const DESKTOP = Boolean(SESSION_TOKEN);
const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:8081').replace(/\/$/, '');
const WORKER_PUBLIC_URL = (process.env.WORKER_PUBLIC_URL || 'http://localhost:3001').replace(/\/$/, '');
const SESSION_HEADER = 'x-session-token';

function tokenMatches(token) {
  if (typeof token !== 'string') return false;
  const a = crypto.createHash('sha256').update(token).digest();
  const b = crypto.createHash('sha256').update(SESSION_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

function sessionTokenMiddleware(req, res, next) {
  if (!DESKTOP || req.method === 'OPTIONS') return next();
  // <img>/<video> không gửi được header → file tĩnh trong downloads/ và health check được miễn
  if ((req.method === 'GET' || req.method === 'HEAD') && (req.path.startsWith('/downloads/') || req.path === '/api/health')) {
    return next();
  }
  if (tokenMatches(req.headers[SESSION_HEADER] || req.query.st)) return next();
  return res.status(401).json({ success: false, error: 'SESSION_TOKEN_REQUIRED' });
}

/** Header gắn vào request worker → backend */
function backendHeaders() {
  return DESKTOP ? { 'X-Session-Token': process.env.BACKEND_TOKEN || SESSION_TOKEN } : {};
}

/**
 * Mở kết nối DB. Bản thường: MySQL như cũ. Bản Desktop: DB là H2 bên trong backend,
 * nên câu lệnh được chuyển qua POST /api/internal/worker-sql (chỉ cho SELECT/UPDATE bảng social_accounts).
 * Trả về object có execute(sql, params) → [rows] và end(), giống mysql2/promise.
 */
async function openDb(mysqlConfig) {
  if (!DESKTOP) {
    const mysql = require('mysql2/promise');
    return mysql.createConnection(mysqlConfig);
  }
  return {
    async execute(sql, params = []) {
      const res = await fetch(`${BACKEND_URL}/api/internal/worker-sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...backendHeaders() },
        body: JSON.stringify({ sql, params }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`worker-sql ${res.status}: ${data.error || ''}`);
      if (!data.rows) return [{ affectedRows: data.affectedRows || 0 }];
      // H2 trả tên cột viết thường; khôi phục đúng alias "AS viaName" như MySQL
      const aliases = [...sql.matchAll(/\bas\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map((m) => m[1]);
      const rows = data.rows.map((row) => {
        for (const alias of aliases) {
          const lower = alias.toLowerCase();
          if (!(alias in row) && lower in row) row[alias] = row[lower];
        }
        return row;
      });
      return [rows];
    },
    async end() {},
  };
}

/** App Tauri tắt (kể cả force quit) thì worker tự thoát để không giữ cổng và chạy ngầm */
function startParentWatchdog(onParentGone) {
  const parentPid = Number(process.env.PARENT_PID || 0);
  if (!parentPid) return;
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch (_) {
      console.warn(`[Desktop] App đã tắt (PARENT_PID=${parentPid}), worker tự thoát`);
      onParentGone();
    }
  }, 5000).unref();
}

module.exports = {
  DESKTOP,
  BACKEND_URL,
  WORKER_PUBLIC_URL,
  BIND_HOST: process.env.BIND_HOST || '',
  sessionTokenMiddleware,
  backendHeaders,
  openDb,
  startParentWatchdog,
};
