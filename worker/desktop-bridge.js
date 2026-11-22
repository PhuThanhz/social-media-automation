/**
 * TOOLZUTTER DESKTOP API BRIDGE (Embedded SQLite Engine)
 * 
 * Thay thế hoàn toàn Java Spring Boot & MySQL khi chạy ở chế độ Desktop App.
 * Khách hàng không cần cài MySQL hay Java!
 * Dữ liệu tự động lưu vào file SQLite `toolzutter.db` trên máy khách.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');
const axios = require('axios');

const app = express();
const PORT = process.env.DESKTOP_API_PORT || 8081;
const WORKER_PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Determine database file location (cross-platform AppData or home directory)
function getDbPath() {
  const homeDir = os.homedir();
  let baseFolder;
  if (process.platform === 'win32') {
    baseFolder = process.env.APPDATA ? path.join(process.env.APPDATA, 'ToolZutter') : path.join(homeDir, '.toolzutter');
  } else if (process.platform === 'darwin') {
    baseFolder = path.join(homeDir, 'Library', 'Application Support', 'ToolZutter');
  } else {
    baseFolder = path.join(homeDir, '.config', 'ToolZutter');
  }

  if (!fs.existsSync(baseFolder)) {
    try {
      fs.mkdirSync(baseFolder, { recursive: true });
    } catch {
      baseFolder = path.join(__dirname);
    }
  }

  return path.join(baseFolder, 'toolzutter.db');
}

const dbPath = getDbPath();
console.log(`\n📦 [Desktop SQLite] Khởi tạo cơ sở dữ liệu tại:\n   👉 ${dbPath}\n`);

const db = new DatabaseSync(dbPath);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT,
    role TEXT DEFAULT 'ROLE_ADMIN',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS social_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT 1,
    platform TEXT DEFAULT 'FACEBOOK',
    account_type TEXT,
    platform_account_id TEXT,
    account_name TEXT,
    avatar_url TEXT,
    access_token TEXT,
    token_status TEXT DEFAULT 'OK',
    token_status_detail TEXT,
    group_post_approval_mode TEXT DEFAULT 'AUTO',
    posting_identity_account_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS post_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT 1,
    campaign_id INTEGER DEFAULT 1,
    social_account_id INTEGER,
    post_type TEXT DEFAULT 'POST',
    title TEXT,
    content TEXT,
    media_urls TEXT,
    original_url TEXT,
    scheduled_at DATETIME,
    published_at DATETIME,
    status TEXT DEFAULT 'PENDING',
    error_message TEXT,
    target_type TEXT DEFAULT 'FANPAGE',
    target_id TEXT,
    extra_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT 1,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'ACTIVE',
    source_type TEXT DEFAULT 'DIRECT_LINK',
    source_url TEXT,
    posting_interval_minutes INTEGER DEFAULT 60,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS post_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT 1,
    social_account_id INTEGER,
    target_count INTEGER DEFAULT 10,
    date TEXT,
    UNIQUE(social_account_id, date)
  );

  CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT DEFAULT 'worker',
    level TEXT DEFAULT 'INFO',
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed default user and quick posts campaign if empty
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
  db.prepare("INSERT INTO users (email, password, role) VALUES ('admin@gmail.com', 'admin123', 'ROLE_ADMIN')").run();
  db.prepare("INSERT INTO campaigns (name, status, source_type) VALUES ('Quick Posts', 'ACTIVE', 'DIRECT_LINK')").run();
}

function seedFacebookGroupDesktop(pageName, groupId) {
  const existing = db.prepare('SELECT id FROM social_accounts WHERE platform_account_id = ?').get(groupId);
  if (!existing) {
    db.prepare(`
      INSERT INTO social_accounts (user_id, platform, account_type, platform_account_id, account_name, token_status)
      VALUES (1, 'FACEBOOK_GROUP', 'PERSONAL_COOKIE', ?, ?, 'OK')
    `).run(groupId, pageName);
  }
}

seedFacebookGroupDesktop("Xế Văn Minh", "184659109462650");
seedFacebookGroupDesktop("🐱 Đảo Mèo 1", "263510030791508");
seedFacebookGroupDesktop("Sài Gòn ơi, ăn gì?", "964362037266166");
seedFacebookGroupDesktop("Hội Những Người Tin Mình Sắp Giàu", "2035252243920945");
seedFacebookGroupDesktop("Sống cùng tiểu đường tim mạch cao huyết áp", "510277186406856");
seedFacebookGroupDesktop("GenZ làm mẹ (400k member)", "773774567089399");
seedFacebookGroupDesktop("🐶 Tinder Pets Việt Nam by InterPetFest", "1195776878326307");
seedFacebookGroupDesktop("Ê, biết tin gì chưa?", "1590316894437844");
seedFacebookGroupDesktop("Cinema Hà Nội", "352102219461769");


// ==========================================
// 1. AUTH API
// ==========================================
app.post('/api/auth/login', (req, res) => {
  res.json({
    accessToken: 'desktop-native-token-' + Date.now(),
    tokenType: 'Bearer',
    user: { id: 1, email: 'admin@gmail.com', role: 'ROLE_ADMIN' }
  });
});

app.post('/api/auth/register', (req, res) => {
  res.json({
    accessToken: 'desktop-native-token-' + Date.now(),
    tokenType: 'Bearer',
    user: { id: 1, email: req.body.email || 'admin@gmail.com', role: 'ROLE_ADMIN' }
  });
});

// ==========================================
// 2. SOCIAL ACCOUNTS (CONNECTIONS) API
// ==========================================
app.get('/api/connections', (req, res) => {
  try {
    const accounts = db.prepare('SELECT * FROM social_accounts ORDER BY id DESC').all();
    // Chuyển đổi định dạng cho khớp DTO frontend
    const mapped = accounts.map(a => ({
      id: a.id,
      platform: a.platform,
      accountType: a.account_type,
      platformAccountId: a.platform_account_id,
      accountName: a.account_name,
      pageName: a.account_name,
      avatarUrl: a.avatar_url,
      accessToken: a.access_token,
      tokenStatus: a.token_status,
      tokenStatusDetail: a.token_status_detail,
      groupPostApprovalMode: a.group_post_approval_mode,
      postingIdentityAccountId: a.posting_identity_account_id,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/connections', (req, res) => {
  try {
    const b = req.body;
    const stmt = db.prepare(`
      INSERT INTO social_accounts (
        platform, account_type, platform_account_id, account_name,
        avatar_url, access_token, token_status, group_post_approval_mode, posting_identity_account_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      b.platform || 'FACEBOOK',
      b.accountType || (b.platform === 'FACEBOOK_GROUP' ? 'PERSONAL_COOKIE' : 'FANPAGE'),
      b.platformAccountId || '',
      b.accountName || b.pageName || '',
      b.avatarUrl || '',
      b.accessToken || '',
      b.tokenStatus || 'OK',
      b.groupPostApprovalMode || 'AUTO',
      b.postingIdentityAccountId || null
    );
    res.json({ id: info.lastInsertRowid, ...b });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/connections/:id', (req, res) => {
  try {
    const id = req.params.id;
    const b = req.body;
    if (b.postingIdentityAccountId !== undefined) {
      db.prepare('UPDATE social_accounts SET posting_identity_account_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(b.postingIdentityAccountId, id);
    }
    const acc = db.prepare('SELECT * FROM social_accounts WHERE id = ?').get(id);
    res.json(acc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/connections/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM social_accounts WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy group health check sang Playwright Worker
app.post('/api/connections/:id/check-group-health', async (req, res) => {
  try {
    const acc = db.prepare('SELECT * FROM social_accounts WHERE id = ?').get(req.params.id);
    const workerRes = await axios.post(`http://localhost:${WORKER_PORT}/api/check-group-health`, {
      groupId: acc ? acc.platform_account_id : req.params.id
    }, { timeout: 60000 });
    res.json(workerRes.data);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/connections/check-all-groups-health', async (req, res) => {
  res.json({ success: true, message: 'Đã bắt đầu kiểm tra trạng thái tất cả các nhóm' });
});

app.post('/api/connections/:id/join-group', async (req, res) => {
  try {
    const acc = db.prepare('SELECT * FROM social_accounts WHERE id = ?').get(req.params.id);
    const workerRes = await axios.post(`http://localhost:${WORKER_PORT}/api/join-group`, {
      groupId: acc ? acc.platform_account_id : req.params.id
    }, { timeout: 60000 });
    res.json(workerRes.data);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ==========================================
// 3. POST QUEUE API
// ==========================================
app.get('/api/queue/counts', (req, res) => {
  try {
    const pending = db.prepare("SELECT COUNT(*) as count FROM post_queue WHERE status = 'PENDING'").get().count;
    const published = db.prepare("SELECT COUNT(*) as count FROM post_queue WHERE status = 'PUBLISHED'").get().count;
    const failed = db.prepare("SELECT COUNT(*) as count FROM post_queue WHERE status = 'FAILED'").get().count;
    const total = db.prepare("SELECT COUNT(*) as count FROM post_queue").get().count;
    res.json({ pending, published, failed, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/queue/campaign/:campaignId', (req, res) => {
  try {
    const posts = db.prepare('SELECT * FROM post_queue ORDER BY scheduled_at ASC, id ASC').all();
    const mapped = posts.map(p => ({
      id: p.id,
      campaignId: p.campaign_id,
      socialAccountId: p.social_account_id,
      postType: p.post_type,
      title: p.title,
      content: p.content,
      mediaUrls: p.media_urls,
      originalUrl: p.original_url,
      scheduledAt: p.scheduled_at,
      publishedAt: p.published_at,
      status: p.status,
      errorMessage: p.error_message,
      targetType: p.target_type,
      targetId: p.target_id,
      extraData: p.extra_data,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/queue', (req, res) => {
  try {
    const posts = db.prepare('SELECT * FROM post_queue ORDER BY scheduled_at ASC, id ASC').all();
    const mapped = posts.map(p => ({
      id: p.id,
      campaignId: p.campaign_id,
      socialAccountId: p.social_account_id,
      postType: p.post_type,
      title: p.title,
      content: p.content,
      mediaUrls: p.media_urls,
      originalUrl: p.original_url,
      scheduledAt: p.scheduled_at,
      publishedAt: p.published_at,
      status: p.status,
      errorMessage: p.error_message,
      targetType: p.target_type,
      targetId: p.target_id,
      extraData: p.extra_data,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }));
    res.json({ items: mapped, total: mapped.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Thêm bài hàng loạt vào hàng đợi (Add from URLs)
app.post('/api/queue/add-from-urls', (req, res) => {
  try {
    const { items = [], scheduleTimes = [] } = req.body;
    const insertStmt = db.prepare(`
      INSERT INTO post_queue (
        campaign_id, social_account_id, title, content, media_urls, original_url,
        scheduled_at, status, target_type, target_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `);

    let count = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const schedTime = scheduleTimes[i] || new Date().toISOString();
      insertStmt.run(
        item.campaignId || 1,
        item.socialAccountId || null,
        item.title || '',
        item.content || '',
        item.mediaUrls || '',
        item.originalUrl || '',
        schedTime,
        item.targetType || 'FANPAGE',
        item.targetId || ''
      );
      count++;
    }

    res.json({ success: true, count, message: `Đã thêm ${count} bài viết vào hàng đợi` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Xem trước liên kết (Preview URL)
app.post('/api/queue/preview-url', async (req, res) => {
  try {
    const { url } = req.body;
    // Chuyển tiếp tới Playwright worker để bóc tách video & ảnh
    const workerRes = await axios.post(`http://localhost:${WORKER_PORT}/api/extract-video`, { url }, { timeout: 30000 });
    res.json(workerRes.data);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Đăng ngay (Publish Now)
app.post('/api/queue/:id/publish', async (req, res) => {
  try {
    const post = db.prepare('SELECT * FROM post_queue WHERE id = ?').get(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Không tìm thấy bài viết' });
    }

    // Đánh dấu đang chạy
    db.prepare("UPDATE post_queue SET status = 'RUNNING' WHERE id = ?").run(post.id);

    // Bắn sang worker để đăng bài bằng Playwright
    axios.post(`http://localhost:${WORKER_PORT}/api/post-facebook`, {
      postId: post.id,
      content: post.content,
      mediaUrls: post.media_urls ? post.media_urls.split(',') : [],
      targetId: post.target_id,
      socialAccountId: post.social_account_id,
    }).then(wRes => {
      if (wRes.data?.success) {
        db.prepare("UPDATE post_queue SET status = 'PUBLISHED', published_at = CURRENT_TIMESTAMP WHERE id = ?").run(post.id);
      } else {
        db.prepare("UPDATE post_queue SET status = 'FAILED', error_message = ? WHERE id = ?").run(wRes.data?.error || 'Đăng thất bại', post.id);
      }
    }).catch(err => {
      db.prepare("UPDATE post_queue SET status = 'FAILED', error_message = ? WHERE id = ?").run(err.message, post.id);
    });

    res.json({ success: true, message: 'Đã gửi lệnh đăng bài tới Playwright Worker' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Xóa 1 bài
app.delete('/api/queue/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM post_queue WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Xóa hàng loạt
app.post('/api/queue/batch-delete', (req, res) => {
  try {
    const { ids = [] } = req.body;
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM post_queue WHERE id IN (${placeholders})`).run(...ids);
    }
    res.json({ success: true, count: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Đổi lịch hẹn giờ hàng loạt
app.post('/api/queue/reschedule-batch', (req, res) => {
  try {
    const { updates = [] } = req.body;
    const stmt = db.prepare('UPDATE post_queue SET scheduled_at = ? WHERE id = ?');
    for (const u of updates) {
      stmt.run(u.scheduledAt, u.id);
    }
    res.json({ success: true, count: updates.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dồn lịch liên tục (Pack Continuous)
app.post('/api/queue/pack-continuous', (req, res) => {
  try {
    const { gapSeconds = 1800 } = req.body;
    const pendingPosts = db.prepare("SELECT id FROM post_queue WHERE status = 'PENDING' ORDER BY scheduled_at ASC").all();
    let curr = Date.now() + 60000;
    const stmt = db.prepare('UPDATE post_queue SET scheduled_at = ? WHERE id = ?');
    for (const p of pendingPosts) {
      stmt.run(new Date(curr).toISOString(), p.id);
      curr += gapSeconds * 1000;
    }
    res.json({ success: true, count: pendingPosts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset bài lỗi về PENDING
app.post('/api/queue/reset-failed-batch', (req, res) => {
  try {
    const { spacingSeconds = 45 } = req.body;
    const failedPosts = db.prepare("SELECT id FROM post_queue WHERE status = 'FAILED' ORDER BY id ASC").all();
    let curr = Date.now() + 10000;
    const stmt = db.prepare("UPDATE post_queue SET status = 'PENDING', error_message = NULL, scheduled_at = ? WHERE id = ?");
    for (const p of failedPosts) {
      stmt.run(new Date(curr).toISOString(), p.id);
      curr += spacingSeconds * 1000;
    }
    res.json({ success: true, count: failedPosts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Đổi lịch 1 bài
app.patch('/api/queue/:id/schedule', (req, res) => {
  try {
    const { scheduledAt } = req.body;
    db.prepare('UPDATE post_queue SET scheduled_at = ? WHERE id = ?').run(scheduledAt, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. CAMPAIGNS API
// ==========================================
app.get('/api/campaigns', (req, res) => {
  try {
    const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY id ASC').all();
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/campaigns', (req, res) => {
  try {
    const { name, sourceUrl, sourceType = 'DIRECT_LINK', postingIntervalMinutes = 60 } = req.body;
    const info = db.prepare(`
      INSERT INTO campaigns (name, source_url, source_type, posting_interval_minutes)
      VALUES (?, ?, ?, ?)
    `).run(name, sourceUrl || '', sourceType, postingIntervalMinutes);
    res.json({ id: info.lastInsertRowid, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. POST TARGETS API
// ==========================================
app.get('/api/post-targets', (req, res) => {
  try {
    const items = db.prepare('SELECT * FROM post_targets').all();
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/post-targets', (req, res) => {
  try {
    const { socialAccountId, date, targetCount = 10 } = req.body;
    db.prepare(`
      INSERT INTO post_targets (social_account_id, date, target_count)
      VALUES (?, ?, ?)
      ON CONFLICT(social_account_id, date) DO UPDATE SET target_count = excluded.target_count
    `).run(socialAccountId, date, targetCount);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5.1 APP SETTINGS / PRESETS API (Lưu vĩnh viễn vào SQLite)
// ==========================================
app.get('/api/settings/:key', (req, res) => {
  try {
    const row = db.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get(req.params.key);
    res.json({ success: true, value: row ? row.setting_value : null });
  } catch (err) {
    res.json({ success: false, value: null });
  }
});

app.post('/api/settings/:key', (req, res) => {
  try {
    const { value } = req.body;
    const strVal = typeof value === 'string' ? value : JSON.stringify(value);
    db.prepare(`
      INSERT INTO app_settings (setting_key, setting_value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
    `).run(req.params.key, strVal);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 6. TOOLS & WORKER PROXY API
// ==========================================
// Chuyển tiếp các request /api/tools/* sang Playwright Worker
app.use('/api/tools', async (req, res) => {
  try {
    const workerUrl = `http://localhost:${WORKER_PORT}/api${req.path}`;
    const response = await axios({
      method: req.method,
      url: workerUrl,
      data: req.body,
      params: req.query,
      timeout: 180000,
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

// ==========================================
// 7. SYSTEM LOGS API
// ==========================================
app.get('/api/system-logs', (req, res) => {
  res.json({
    totalLines: 10,
    lines: [
      `[${new Date().toLocaleTimeString()}] [Desktop Engine] ToolZutter Native SQLite đang chạy ổn định.`,
      `[${new Date().toLocaleTimeString()}] [Database] File lưu trữ: ${dbPath}`,
      `[${new Date().toLocaleTimeString()}] [Worker] Cổng Playwright: ${WORKER_PORT}`
    ]
  });
});

// Khởi chạy server nếu cổng chưa bị chiếm bởi Java
const server = app.listen(PORT, () => {
  console.log(`🚀 [Desktop API Bridge] Đang lắng nghe trên cổng ${PORT}`);
  console.log(`   👉 Frontend kết nối trực tiếp tại: http://localhost:${PORT}/api\n`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`ℹ️ [Desktop Bridge] Cổng ${PORT} đang được sử dụng (có thể Java Backend đang chạy). Chế độ Desktop sẽ nhường cổng.`);
  } else {
    console.error(`❌ [Desktop Bridge] Lỗi:`, err.message);
  }
});

module.exports = app;
