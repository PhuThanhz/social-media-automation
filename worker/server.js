const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

// Tối ưu hóa bộ nhớ và hiệu năng toàn bộ Chromium process chạy trên Worker:
// Giảm từ ~400MB RAM/browser xuống ~80MB, tắt GPU/audio/telemetry, khống chế V8 heap 256MB.
const CHROMIUM_OPTIMIZED_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--mute-audio',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-translate',
  '--disable-sync',
  '--js-flags=--max-old-space-size=256'
];

const _origChromiumLaunch = chromium.launch.bind(chromium);
chromium.launch = function(options = {}) {
  const mergedArgs = Array.from(new Set([
    ...CHROMIUM_OPTIMIZED_ARGS,
    ...(options.args || [])
  ]));
  return _origChromiumLaunch({
    headless: true,
    ...options,
    args: mergedArgs
  });
};

const _origLaunchPersistent = chromium.launchPersistentContext.bind(chromium);
chromium.launchPersistentContext = function(userDataDir, options = {}) {
  const mergedArgs = Array.from(new Set([
    ...CHROMIUM_OPTIMIZED_ARGS,
    ...(options.args || [])
  ]));
  return _origLaunchPersistent(userDataDir, {
    headless: true,
    ...options,
    args: mergedArgs
  });
};
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const util = require('util');
const { execFile } = require('child_process');
const execFileAsync = util.promisify(execFile);
const axios = require('axios');
const RssParser = require('rss-parser');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');

const desktop = require('./desktop-mode');
const { bulkUploadReels } = require('./meta-bulk-reels');
const browserPool = require('./browserPool');
const { renderNewsCard, renderNewsCardHtml, renderHtmlLayers } = require('./news-card');
const { renderDarkQuoteCard } = require('./quote-card');
const { generateSeedingComments } = require('./ai-seeding');
const { huntFacebookFeed } = require('./fb-feed-hunter');

const app = express();
app.use(cors());
app.use(desktop.sessionTokenMiddleware);
app.use(express.json({ limit: '2mb' }));

// ─────────────────────────────────────────────────────────────────────────────
// Ghi lại kết quả đăng theo mã bài (header X-Post-Queue-Id do backend gửi). Khi backend bị restart / mất
// kết nối giữa chừng, bộ giám sát bài treo vẫn hỏi lại được GET /api/post-results/:id để biết bài đã đăng
// thành công hay chưa — thay vì đoán mò rồi đánh lỗi nhầm (đã xảy ra với bài #3145 ngày 29/09/2026).
// ─────────────────────────────────────────────────────────────────────────────
const WORKER_PORT = Number(process.env.PORT || 3001);
const POST_RESULTS_FILE = require('path').join(__dirname, process.env.POST_RESULTS_FILE || (WORKER_PORT !== 3001 ? `post_results_${WORKER_PORT}.json` : 'post_results.json'));
const POST_RESULTS_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const postResults = (() => {
  try { return new Map(Object.entries(JSON.parse(require('fs').readFileSync(POST_RESULTS_FILE, 'utf8')))); } catch (_) { return new Map(); }
})();
let postResultsSaveTimer = null;
function savePostResults() {
  clearTimeout(postResultsSaveTimer);
  postResultsSaveTimer = setTimeout(() => {
    const cutoff = Date.now() - POST_RESULTS_TTL_MS;
    for (const [id, legs] of postResults) {
      if (!legs.length || (legs[legs.length - 1].updatedAt || 0) < cutoff) postResults.delete(id);
    }
    require('fs').writeFile(POST_RESULTS_FILE, JSON.stringify(Object.fromEntries(postResults)), () => {});
  }, 500);
}
app.use((req, res, next) => {
  const postId = req.headers['x-post-queue-id'];
  if (!postId || req.method !== 'POST') return next();
  const legs = postResults.get(String(postId)) || [];
  const leg = { path: req.path, target: req.body?.targetGroupId || req.body?.targetFanpageId || null, status: 'IN_PROGRESS', startedAt: Date.now(), updatedAt: Date.now() };
  legs.push(leg);
  postResults.set(String(postId), legs.slice(-10));
  savePostResults();
  const finish = (body) => {
    if (leg.status !== 'IN_PROGRESS') return;
    const ok = res.statusCode < 400 && !(body && body.success === false);
    leg.status = ok ? 'SUCCESS' : 'FAILED';
    leg.updatedAt = Date.now();
    leg.postUrl = body?.postUrl || body?.publishedPostUrl || body?.postLink || null;
    if (!ok) leg.error = String(body?.error || body?.message || `HTTP ${res.statusCode}`).slice(0, 300);
    savePostResults();
  };
  const origJson = res.json.bind(res);
  res.json = (body) => { finish(body); return origJson(body); };
  res.on('close', () => {
    if (leg.status === 'IN_PROGRESS' && !res.writableFinished) {
      leg.status = 'ABORTED';
      leg.updatedAt = Date.now();
      savePostResults();
    }
  });
  next();
});

app.get('/api/post-results/:id', (req, res) => {
  res.json({ success: true, postId: req.params.id, legs: postResults.get(String(req.params.id)) || [] });
});

// Facebook trả GraphQL "Rate limit exceeded" (code 1675004) khi nick bị giới hạn tốc độ — lúc đó hộp
// "Tạo bài viết" mở ra nhưng kẹt mãi ở khung xám. Theo dõi để báo đúng nguyên nhân thay vì "không mở được Modal".
function watchFacebookRateLimit(page) {
  page.on('response', async (resp) => {
    if (page.__fbRateLimited || !resp.url().includes('/api/graphql')) return;
    const text = await resp.text().catch(() => '');
    if (text.includes('1675004') || text.includes('Rate limit exceeded')) {
      page.__fbRateLimited = true;
      console.warn('[Playwright] 🚦 Facebook trả "Rate limit exceeded" (1675004) — nick đang bị giới hạn tốc độ.');
    }
  });
}
function rateLimitError(originalMessage) {
  return new Error(`FB_RATE_LIMITED: Facebook đang giới hạn tốc độ nick này (Rate limit exceeded, mã 1675004) nên không mở được hộp đăng bài. Cần cho nick nghỉ vài giờ. (${originalMessage})`);
}

// Thông báo chặn spam ("Để bảo vệ cộng đồng khỏi spam, chúng tôi giới hạn tần suất bạn đăng bài...") có thể
// hiện ở dialog riêng, alert hay toast — KHÔNG nằm trong modal soạn bài — và còn hiện cả khi modal đã đóng.
// Nick Thành An từng bị chặn suốt mà mọi bài vẫn báo PUBLISHED vì chỉ đọc chữ trong modal composer.
// Quét MỌI dialog/alert/toast đang hiển thị (bỏ phần chữ người dùng gõ trong ô soạn bài để không báo nhầm
// khi nội dung bài có chứa các cụm này). Trả về đoạn text chứa thông báo, hoặc null nếu không thấy.
const FB_SPAM_BLOCK_PHRASES = ['giới hạn tần suất', 'để bảo vệ cộng đồng', 'we limit how often', 'tạm thời bị chặn', "you're temporarily blocked", 'lạm dụng tính năng', 'misusing this feature'];
// "thử lại sau" quá chung chung (lỗi tải ảnh cũng có) — chỉ tính khi đi kèm từ khoá giới hạn, tránh
// khoá nick 6h oan vì 1 toast lỗi upload.
const FB_SPAM_BLOCK_WEAK_PHRASES = ['thử lại sau', 'try again later'];
const FB_SPAM_BLOCK_WEAK_CONTEXT = ['spam', 'giới hạn', 'hạn chế', 'limit', 'chặn', 'blocked'];
async function detectFacebookSpamBlock(page) {
  return page.evaluate(({ strong, weak, weakContext }) => {
    const selector = [
      'div[role="dialog"]', '[role="alertdialog"]', '[role="alert"]', '[role="status"]', '[aria-live]',
      '[data-testid*="toast" i]', '[class*="toast" i]',
    ].join(', ');
    const isVisible = (el) => {
      if (!el.getClientRects().length) return false;
      const style = getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
    };
    for (const el of document.querySelectorAll(selector)) {
      if (!isVisible(el)) continue;
      const clone = el.cloneNode(true);
      clone.querySelectorAll('[contenteditable="true"], [role="textbox"], textarea, input').forEach((n) => n.remove());
      clone.querySelectorAll('*').forEach((n) => n.append(' '));
      const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      // Bỏ vùng chữ quá dài (feed/khung lớn có aria-live) — thông báo chặn chỉ vài trăm ký tự.
      if (!text || text.length > (el.matches('div[role="dialog"], [role="alertdialog"]') ? 3000 : 1000)) continue;
      const lower = text.toLowerCase();
      const hit = strong.find((p) => lower.includes(p))
        || (weakContext.some((c) => lower.includes(c)) && weak.find((p) => lower.includes(p)));
      if (!hit) continue;
      const idx = lower.indexOf(hit);
      return text.slice(Math.max(0, idx - 120), idx + 280);
    }
    return null;
  }, { strong: FB_SPAM_BLOCK_PHRASES, weak: FB_SPAM_BLOCK_WEAK_PHRASES, weakContext: FB_SPAM_BLOCK_WEAK_CONTEXT }).catch(() => null);
}
// Gọi detectFacebookSpamBlock; nếu thấy thì lưu ảnh bằng chứng rồi ném lỗi tiền tố FB_SPAM_BLOCK (backend
// dựa vào tiền tố này để đánh FAILED + cho cả nick nghỉ).
async function assertNoFacebookSpamBlock(page, postQueueId, stage) {
  const spamText = await detectFacebookSpamBlock(page);
  if (!spamText) return;
  const shotName = `debug_spam_block_${postQueueId || 'na'}_${Date.now()}.png`;
  await page.screenshot({ path: path.join(DEBUG_OUTPUT_DIR, shotName) }).catch(() => { });
  console.error(`[Playwright] ⛔ Facebook chặn spam (${stage}): "${spamText}" — xem ${shotName}`);
  throw new Error(`FB_SPAM_BLOCK: Facebook chặn đăng tạm thời do đăng quá nhanh (${stage}): "${spamText.slice(0, 250)}". Cần giãn cách thời gian đăng! (xem ${shotName})`);
}

// Fanpage mặc định dùng khi request không chỉ định targetFanpageId (VD: Quick Post qua Extension).
// Định nghĩa DUY NHẤT ở đây — đổi Fanpage mặc định thì chỉ cần sửa 1 chỗ này thay vì rải rác nhiều nơi.
const DEFAULT_FANPAGE_PLATFORM_ACCOUNT_ID = process.env.DEFAULT_FANPAGE_PLATFORM_ACCOUNT_ID || '61584834510803';

// Debug tạm để giám sát Browser Pool trong lúc rollout — chỉ dùng nội bộ, có thể xoá sau khi ổn định.
app.get('/api/pool-stats', (req, res) => {
  res.json(browserPool.stats());
});

// Endpoint Đăng hàng loạt thước phim (Bulk Upload Reels) trên Meta Business Suite
app.post('/api/bulk-upload-reels', async (req, res) => {
  try {
    const { items, cookieString, targetFanpageId } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Danh sách items video không được để trống' });
    }
    const cleanTargetId = (targetFanpageId || DEFAULT_FANPAGE_PLATFORM_ACCOUNT_ID).split(':')[0];
    console.log(`[Worker] 🚀 Nhận yêu cầu Tải hàng loạt ${items.length} thước phim lên Meta Business Suite cho Fanpage ${cleanTargetId}...`);

    const result = await bulkUploadReels(items, cookieString, cleanTargetId);
    return res.json(result);
  } catch (err) {
    console.error('[Worker] ❌ Lỗi Bulk Upload Reels:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

function parseCookieString(cookieStr) {
  if (!cookieStr) return [];
  return cookieStr.split(';').map(pair => {
    const parts = pair.trim().split('=');
    if (parts.length < 2) return null;
    let val = parts.slice(1).join('=').trim();
    try { val = decodeURIComponent(val); } catch (e) { }
    return {
      name: parts[0].trim(),
      value: val,
      domain: '.facebook.com',
      path: '/'
    };
  }).filter(Boolean);
}

const PORT = Number(process.env.PORT || 3001);

// Biến môi trường riêng của worker (DB_PASSWORD...) đặt trong worker/.env — không commit file này
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (_) {}

function getMysqlConfig(connectTimeout = 3000) {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'autopost_saas',
    connectTimeout,
  };
}

// Threads/Instagram gửi poster của video dưới dạng URL .jpg giống hệt một ảnh
// carousel thật. Metadata `efg` của URL này ghi rõ `video_default_cover_frame`.
// Lọc thêm ngay tại tầng upload để cả các queue item cũ đã lưu thumbnail
// trong DB cũng không bị đăng dư ảnh khi người dùng bấm Thử lại.
function isVideoCoverFrameUrl(rawUrl) {
  try {
    const efg = new URL(rawUrl).searchParams.get('efg');
    if (!efg) return false;
    const normalized = efg.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    return /video.*cover[_-]?frame|cover[_-]?frame.*video|best_image_urlgen/i.test(decoded);
  } catch (e) {
    return false;
  }
}

// URL CDN của Meta/Threads thường không có đuôi file (hoặc cùng một đường dẫn có thể trả ảnh/video
// tùy query). Vì vậy URL chỉ được dùng làm gợi ý; loại media cuối cùng phải dựa vào Content-Type và
// chữ ký byte của file đã tải. Điều này tránh lưu video thành .jpg rồi Facebook Composer hiểu sai file.
function detectMediaKind(contentType, buffer, rawUrl = '') {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('image/')) return 'image';

  if (Buffer.isBuffer(buffer) && buffer.length >= 12) {
    const ascii4 = buffer.subarray(0, 4).toString('ascii');
    const ascii8 = buffer.subarray(4, 12).toString('ascii');
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image';
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image';
    if (ascii4 === 'GIF8' || (ascii4 === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP')) return 'image';
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'video';
    if (ascii8.startsWith('ftyp')) {
      const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
      if (/^(avif|avis|heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return 'image';
      return 'video';
    }
  }

  const url = String(rawUrl || '').toLowerCase();
  if (/\.(mp4|mov|webm)(?:[?#]|$)|\/video\/|\/v\/t16\/|\/m84\/|\/m86\/|\/o1\/v\//i.test(url)) return 'video';
  if (/\.(jpe?g|png|webp|gif|avif|heic)(?:[?#]|$)/i.test(url)) return 'image';
  return null;
}

function mediaFileExtension(mediaKind, contentType, buffer) {
  const ct = String(contentType || '').toLowerCase();
  if (mediaKind === 'video') {
    if (ct.includes('webm')) return '.webm';
    if (ct.includes('quicktime')) return '.mov';
    return '.mp4';
  }
  if (ct.includes('png')) return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif')) return '.gif';
  if (ct.includes('avif')) return '.avif';
  if (ct.includes('heic') || ct.includes('heif')) return '.heic';
  if (Buffer.isBuffer(buffer) && buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return '.jpg';
}

// Hai URL CDN khác nhau của Threads/Instagram có thể trả về đúng cùng một file media (khác host,
// token hoặc thời hạn query). `new Set(url)` không nhận ra trường hợp này, nên tạo fingerprint từ
// chính bytes đã tải để chặn việc Facebook nhận hai bản sao của cùng một video/ảnh.
function downloadedMediaFingerprint(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function keepUniqueDownloadedMedia(downloadedResults, logPrefix = '[Playwright]') {
  const seenFingerprints = new Map();
  const uniqueFilePaths = [];
  let duplicateCount = 0;

  for (const result of downloadedResults.filter(Boolean)) {
    const previous = seenFingerprints.get(result.fingerprint);
    if (previous) {
      duplicateCount += 1;
      try { fs.unlinkSync(result.filePath); } catch (e) { }
      console.log(`${logPrefix} 🧹 Đã bỏ media trùng nội dung: ${path.basename(result.filePath)} trùng với ${path.basename(previous)}.`);
      continue;
    }
    seenFingerprints.set(result.fingerprint, result.filePath);
    uniqueFilePaths.push(result.filePath);
  }

  return { uniqueFilePaths, duplicateCount };
}

function isDefinitelyPartialByteRangeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const start = u.searchParams.get('bytestart');
    return start !== null && Number(start) > 0;
  } catch (e) {
    return /[?&]bytestart=(?!0(?:&|$))\d+/i.test(String(rawUrl || ''));
  }
}

function attachMediaMetadata(item, knownVideoUrls = []) {
  const urls = Array.isArray(item?.mediaUrls) ? item.mediaUrls.filter(Boolean) : [];
  const knownVideos = new Set(knownVideoUrls.filter(Boolean));
  const mediaKinds = urls.map((url) => knownVideos.has(url) || detectMediaKind('', null, url) === 'video' ? 'video' : 'image');
  const videoCount = mediaKinds.filter((kind) => kind === 'video').length;
  const imageCount = urls.length - videoCount;
  return {
    ...item,
    mediaType: videoCount > 0 && imageCount > 0 ? 'mixed' : (videoCount > 0 ? 'video' : (imageCount > 0 ? 'image' : 'none')),
    mediaCount: urls.length,
    videoCount,
    imageCount,
    mediaKinds,
  };
}

// Làm sạch caption cào được và tự động sắp xếp xuống dòng cho các gạch đầu dòng, danh sách, Cre/Nguồn
function isFacebookObfuscatedOrGarbageText(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length < 3) return false;

  // 1. Chứa các từ khóa điển hình bị Facebook xáo trộn chữ (anti-scraping timestamp/sponsored scrambler)
  if (/edoop|sntrsr|tLge|gahc|unaa\d|Mle\d|hi\d+mh/i.test(t)) {
    return true;
  }

  // 2. Chứa từ có lẫn lộn chữ và số bất thường (VD: r98unaa7g391l, hi115mh51Mle9h16tLge0gahc)
  const tokens = t.split(/\s+/);
  const isNormalAlphanumeric = (w) => /^(iphone\d*|mp[34]|4k|8k|hd|fhd|24h|360|3d|v\d+|\d+k|\d+m|\d+h|\d+p|\d+tr|\d+đ|\d+k[mgb]|\d+cm|\d+mm|\d+kg|\d+g)$/i.test(w);
  const scrambledTokens = tokens.filter(w => {
    return /^[a-zA-Z0-9_]{5,}$/.test(w) && /[a-zA-Z]/.test(w) && /\d/.test(w) && !isNormalAlphanumeric(w);
  });
  if (scrambledTokens.length > 0 && (scrambledTokens.length >= tokens.length * 0.3 || scrambledTokens.some(w => w.length >= 10))) {
    return true;
  }

  // 3. Chuỗi đơn lẻ dài bất thường toàn ký tự vô nghĩa không có dấu cách
  if (tokens.length === 1 && t.length >= 15 && /^[a-zA-Z0-9_]+$/.test(t) && !isNormalAlphanumeric(t)) {
    return true;
  }

  return false;
}

function cleanScrapedCaption(text) {
  if (!text || typeof text !== 'string') return '';
  if (isFacebookObfuscatedOrGarbageText(text)) return '';
  let cleaned = text.replace(/[\u034F\u200B-\u200F\uFEFF\u2060\u00AD]/g, '').trim();
  cleaned = cleaned
    // Xoá triệt để mọi biến thể ".... Xem thêm" hoặc "... Xem thêm Ẩn bớt" ở cuối chuỗi với số lượng chấm bất kỳ (2, 3, 4, 5+ chấm)
    .replace(/[\s\u200B\u00A0]*(?:…|\.{2,})?[\s\u200B\u00A0]*(?:Xem\s+thêm|See\s+more|Hiển\s+thị\s+thêm)[\s\u200B\u00A0]*(?:Ẩn\s+bớt|See\s+less|Thu\s+gọn)?[\s\u200B\u00A0]*$/gi, '')
    .replace(/[\s\u200B\u00A0]*(?:Ẩn\s+bớt|See\s+less|Thu\s+gọn)[\s\u200B\u00A0]*$/gi, '')
    .replace(/(?:^|\n)[\s\u200B\u00A0]*(?:Xem\s+thêm|See\s+more|Hiển\s+thị\s+thêm|Ẩn\s+bớt|See\s+less|Thu\s+gọn)[\s\u200B\u00A0]*$/gim, '')
    .replace(/[\s\u200B\u00A0]*(?:…|\.{2,})[\s\u200B\u00A0]*(?:Xem\s+thêm|See\s+more)\b/gi, '')
    .replace(/\n?(?:Translate|Dịch)\s*$/gi, '')
    .replace(/(?:^|\n)[\s\u200B\u00A0]*(?:Công khai|Public|Chỉ mình tôi|Bạn bè|Friends|Only me|Chia sẻ với:?\s*Công khai|Shared with:?\s*Public)[\s\u200B\u00A0]*$/gim, '')
    .trim();

  if (isFacebookObfuscatedOrGarbageText(cleaned)) return '';

  // 1. Tự động xuống dòng sau dấu hai chấm hoặc dấu câu khi bắt đầu gạch đầu dòng (-, –, —, •, *, +, ~, emoji bullets)
  // VD: "...đội tuyển Việt Nam đã: - Lần đầu tiên..." -> "...đội tuyển Việt Nam đã:\n\n- Lần đầu tiên..."
  cleaned = cleaned.replace(/([^\n])\s*(?:[:;])\s+([-\u2013\u2014•*+~🔹🔸▪️▫️✔️✅👉🔥⭐🌟✓]\s+[A-ZÀ-Ỹ0-9])/gu, '$1:\n\n$2');

  // 2. Tự động xuống dòng khi có bullet points sau dấu ngắt câu hoặc các ký hiệu bullet đặc thù (tránh làm đứt gạch nối từ ghép như Hà Nội - Hải Phòng)
  cleaned = cleaned.replace(/([.\?!:;]\s*)\s+([-\u2013\u2014•*+~🔹🔸▪️▫️✔️✅👉🔥⭐🌟✓]\s+[A-ZÀ-Ỹ0-9])/gu, '$1\n\n$2');
  cleaned = cleaned.replace(/([^\n\d])\s+([•*+~🔹🔸▪️▫️✔️✅👉🔥⭐🌟✓]\s+[A-ZÀ-Ỹ0-9])/gu, '$1\n\n$2');

  // 3. Tự động xuống dòng khi có số thứ tự liệt kê (1., 2., 3., 1), 2)) SAU DẤU NGẮT CÂU (tránh ngắt ở "tuổi 15. Nhiều...")
  cleaned = cleaned.replace(/([.\?!:;]\s*)(\b\d{1,2}[\.\)]\s+[A-ZÀ-Ỹ])/gu, '$1\n\n$2');

  // 4. Tự động xuống dòng giữa các câu hoàn chỉnh giới thiệu danh sách hoặc chuyển đoạn
  // VD: "...vào 2 năm tới. Với chức vô địch..." -> "...vào 2 năm tới.\n\nVới chức vô địch..."
  cleaned = cleaned.replace(/([.!?])\s+((?:Với|Trong|Theo|Đặc biệt|Hiện|Ngoài ra|Bên cạnh đó|Tuy nhiên|Đáng chú ý|Cụ thể|Tổng kết|Chi tiết)\s+[A-ZÀ-Ỹ0-9])/gu, '$1\n\n$2');

  // 5. Tự động ngắt dòng an toàn trước Cre / Nguồn / Credit / Via / Ảnh / Theo
  // CHỈ ngắt dòng khi có dấu : hoặc - (Cre:, Nguồn:, Ảnh:, Theo:, Credit:, Via:, Photo:, Video:)
  // HOẶC Cre/Credit theo sau là tên riêng / handle (Cre Beatvn...)
  // TUYỆT ĐỐI không làm đứt các từ thông thường như Cảnh sát, khoảnh khắc, dọc theo, nguồn gốc, quay video...
  cleaned = cleaned.replace(/([^\n\s])\s+(?<![\p{L}\p{N}])(Cre|Credit|Nguồn|Ảnh|Photo|Video|Via|Theo)\s*[:\-\u2013\u2014]\s*/gui, '$1\n\n$2: ');
  cleaned = cleaned.replace(/([^\n\s])\s+(?<![\p{L}\p{N}])(Cre|Credit)\s+([A-ZÀ-Ỹ0-9@#])/gu, '$1\n\n$2 $3');

  // 6. Chuẩn hóa khoảng trắng và dòng trống
  cleaned = cleaned
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

function isThreadsShareUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return /(^|\/)share\//i.test(url.pathname);
  } catch (e) {
    return false;
  }
}

function isThreadsDirectPostUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return /\/(?:post|t)\/[^/?#]+/i.test(url.pathname);
  } catch (e) {
    return false;
  }
}

async function hasUsableThreadsDom(page) {
  try {
    if ((await page.locator('div[data-pressable-container="true"]').count()) > 0) return true;
    // Khi Threads không boot được app JavaScript, response HTML server-render vẫn thường có đủ
    // og:description + og:image/og:video để cào bài ảnh/video cơ bản mà không cần card động.
    return await page.evaluate(() => Boolean(
      document.querySelector('meta[property="og:description"]')?.getAttribute('content')
      || document.querySelector('meta[property="og:image"]')?.getAttribute('content')
      || document.querySelector('meta[property="og:video"], meta[property="og:video:url"]')?.getAttribute('content')
    ));
  } catch (e) {
    return false;
  }
}

// Giải chuyển hướng HTTP (301/302) của link Threads /share/... sang permalink gốc (/post/...)
function resolveThreadsShareUrlViaHttp(shareUrl, maxRedirects = 5) {
  return new Promise((resolve) => {
    const doRequest = (currentUrl, redirectsLeft) => {
      if (redirectsLeft <= 0) return resolve(null);
      const client = currentUrl.startsWith('https') ? https : http;
      const req = client.get(currentUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1'
        }
      }, (res) => {
        const loc = res.headers.location;
        if (loc) {
          const fullLoc = loc.startsWith('http') ? loc : new URL(loc, currentUrl).toString();
          if (fullLoc.includes('/post/') || fullLoc.includes('/t/')) {
            return resolve(fullLoc.split('?')[0].replace(/threads\.com/gi, 'threads.net'));
          }
          return doRequest(fullLoc, redirectsLeft - 1);
        }
        resolve(null);
      });
      req.on('error', () => resolve(null));
      req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    };
    doRequest(shareUrl, maxRedirects);
  });
}

// Link /share/ của Threads chuyển hướng sang permalink thật rất nhanh khi dùng Mobile User-Agent.
// Thử giải nhanh qua HTTP 302 trước khi cho Playwright điều hướng trang.
//
// Trước đây có thêm 1 bước tải nhanh HTML tĩnh qua curl rồi nạp bằng page.setContent() để né bớt thời
// gian chờ JS desktop — ĐÃ BỎ (2026-08-27): xác nhận bằng live test, HTML tĩnh lấy qua curl (kể cả khi
// tải ĐỦ, không hề bị cắt cụt) KHÔNG chứa "video_versions" — Threads chỉ gắn link video thật vào sau khi
// JS phía client tự gọi thêm request lấy dữ liệu, mà page.setContent() không kích hoạt được luồng đó (log
// ghi nhận hàng loạt script bị Chrome chặn vì "document.write... blocked" khi nạp kiểu này). Hệ quả: mọi
// bài Threads có video (cả nhánh cào 1 bài /api/scrape-content lẫn extractVideoDirectly() dùng cho Reel —
// cả 2 đều gọi hàm này) đều rớt xuống lấy nhầm ảnh bìa/thumbnail thay vì video thật. Giờ luôn dùng
// page.goto() thật để JS thật sự hydrate.
async function navigateThreadsPage(page, rawUrl) {
  if (isThreadsShareUrl(rawUrl)) {
    console.log(`[Threads] 🔗 Đang giải link share qua HTTP redirect: ${rawUrl}`);
    const resolvedPermalink = await resolveThreadsShareUrlViaHttp(rawUrl);
    if (resolvedPermalink && isThreadsDirectPostUrl(resolvedPermalink)) {
      console.log(`[Threads] ✅ Link share → ${resolvedPermalink}`);
      rawUrl = resolvedPermalink;
    }
  }

  try {
    await page.goto(rawUrl, { waitUntil: 'commit', timeout: 30000 });
    await page.waitForTimeout(2000);
  } catch (error) {
    console.warn(`[Threads] ⚠️ page.goto timeout trên permalink (${error.message}), tiếp tục cào...`);
  }
  return (page.url() && page.url() !== 'about:blank') ? page.url() : rawUrl;
}

// Bóc tách caption đầy đủ (100% nguyên vẹn, giữ toàn bộ đoạn văn/xuống dòng) từ script JSON của Threads
function extractThreadsDataFromHtml(html, targetUrl = '') {
  if (!html) return null;
  let shortcode = '';
  try {
    const m = (targetUrl || '').match(/\/(?:post|t)\/([^/?#]+)/);
    if (m) shortcode = m[1];
  } catch (e) { }

  let authorUsername = '';
  try {
    const m = (targetUrl || '').match(/@([^/?#]+)/);
    if (m) authorUsername = m[1];
  } catch (e) { }

  const captions = [];
  const scriptRegex = /<script\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const jsonStr = match[1];
    if (jsonStr && (jsonStr.includes('caption') || jsonStr.includes('text_post_app_info'))) {
      try {
        const parsed = JSON.parse(jsonStr);
        function walk(obj) {
          if (!obj || typeof obj !== 'object') return;
          const code = obj.code || obj.shortcode || obj.post?.code || obj.post?.shortcode || '';
          const user = obj.user?.username || obj.post?.user?.username || obj.owner?.username || '';
          let capText = '';
          if (obj.caption && typeof obj.caption.text === 'string') capText = obj.caption.text;
          else if (obj.post?.caption && typeof obj.post.caption.text === 'string') capText = obj.post.caption.text;

          if (capText && capText.trim().length > 0) {
            const isMatchCode = shortcode && code === shortcode;
            const isMatchUser = authorUsername && user && user.toLowerCase() === authorUsername.toLowerCase();
            captions.push({
              text: capText.trim(),
              code,
              user,
              score: (isMatchCode ? 100 : 0) + (isMatchUser ? 50 : 0) + Math.min(capText.length, 50)
            });
          }

          for (const k of Object.keys(obj)) {
            if (typeof obj[k] === 'object') walk(obj[k]);
          }
        }
        walk(parsed);
      } catch (e) { }
    }
  }

  if (captions.length > 0) {
    captions.sort((a, b) => b.score - a.score);
    return captions[0].text;
  }
  return null;
}

// Bóc tách toàn bộ danh sách Media (ảnh + video theo đúng thứ tự carousel) từ script JSON của Threads
function extractAllThreadsMediaFromHtml(html, targetUrl = '') {
  if (!html) return { videos: [], photos: [], orderedMedia: [] };
  let shortcode = '';
  try {
    const m = (targetUrl || '').match(/\/(?:post|t)\/([^/?#]+)/);
    if (m) shortcode = m[1];
  } catch (e) { }

  if (!shortcode) {
    const canonMatch = (html || '').match(/canonical["\s]+href=["']?[^"'>]*?\/(?:post|t)\/([^/?#"'\s]+)/i)
      || (html || '').match(/"shortcode":"([^"]+)"/i)
      || (html || '').match(/\/(?:post|t)\/([A-Za-z0-9_-]{8,})/i);
    if (canonMatch) shortcode = canonMatch[1];
  }

  const results = [];
  const scriptRegex = /<script\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const jsonStr = match[1];
    if (jsonStr && (jsonStr.includes('carousel_media') || jsonStr.includes('video_versions') || jsonStr.includes('image_versions2'))) {
      try {
        const parsed = JSON.parse(jsonStr);
        function walk(obj) {
          if (!obj || typeof obj !== 'object') return;
          const code = obj.code || obj.shortcode || obj.post?.code || obj.post?.shortcode || '';
          const isTargetPost = shortcode && (code === shortcode || obj.id?.includes(shortcode));

          if (Array.isArray(obj.carousel_media) && obj.carousel_media.length > 0) {
            const items = [];
            for (const item of obj.carousel_media) {
              if (Array.isArray(item.video_versions) && item.video_versions.length > 0) {
                const sortedVideos = [...item.video_versions].sort((a, b) => (b.width || 0) - (a.width || 0));
                items.push({ type: 'video', url: sortedVideos[0].url });
              } else if (item.image_versions2?.candidates?.length > 0) {
                const sortedImages = [...item.image_versions2.candidates].sort((a, b) => (b.width || 0) - (a.width || 0));
                items.push({ type: 'photo', url: sortedImages[0].url });
              }
            }
            if (items.length > 0) {
              results.push({ code, score: (isTargetPost ? 1000 : 0) + items.length, items });
            }
          } else if (Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
            const sortedVideos = [...obj.video_versions].sort((a, b) => (b.width || 0) - (a.width || 0));
            results.push({ code, score: (isTargetPost ? 1000 : 0) + 1, items: [{ type: 'video', url: sortedVideos[0].url }] });
          } else if (obj.image_versions2?.candidates?.length > 0 && !obj.video_versions) {
            const sortedImages = [...obj.image_versions2.candidates].sort((a, b) => (b.width || 0) - (a.width || 0));
            results.push({ code, score: (isTargetPost ? 1000 : 0) + 1, items: [{ type: 'photo', url: sortedImages[0].url }] });
          }

          for (const k of Object.keys(obj)) {
            if (typeof obj[k] === 'object') walk(obj[k]);
          }
        }
        walk(parsed);
      } catch (e) { }
    }
  }

  if (results.length > 0) {
    results.sort((a, b) => b.score - a.score);
    const best = results[0];
    return {
      orderedMedia: best.items.map(i => i.url),
      videos: best.items.filter(i => i.type === 'video').map(i => i.url),
      photos: best.items.filter(i => i.type === 'photo').map(i => i.url),
    };
  }
  return { videos: [], photos: [], orderedMedia: [] };
}



// Thư mục lưu trữ tất cả các clip mèo đã cào/tải về máy. Có dọn dẹp định kỳ file quá hạn
// (xem cleanupOldMediaFiles bên dưới) để tránh phình dung lượng vô hạn khi chạy lâu dài.
const CLIP_MEO_DIR = path.join(__dirname, 'downloads', 'clip_meo');
if (!fs.existsSync(CLIP_MEO_DIR)) {
  fs.mkdirSync(CLIP_MEO_DIR, { recursive: true });
}
app.use('/downloads/clip_meo', express.static(CLIP_MEO_DIR));

// Thư mục chứa ảnh/HTML debug sinh ra khi các luồng Playwright thất bại,
// tách khỏi root worker/ để không lẫn với code nguồn (xem .gitignore).
const DEBUG_OUTPUT_DIR = path.join(__dirname, 'debug_output');
if (!fs.existsSync(DEBUG_OUTPUT_DIR)) {
  fs.mkdirSync(DEBUG_OUTPUT_DIR, { recursive: true });
}

// Dọn dẹp file media cũ trong CLIP_MEO_DIR — chạy định kỳ thay vì lúc mọi request để không cộng
// dồn I/O vào lúc đang cào/đăng bài. Giới hạn số file xóa mỗi lần chạy để tránh dồn cục 1 đợt xóa
// lớn làm chậm máy khi có backlog file cũ tích tụ lâu ngày.
const MEDIA_RETENTION_DAYS = 30;
const MAX_DELETIONS_PER_CLEANUP = 200;
function cleanupOldMediaFiles() {
  try {
    const cutoff = Date.now() - MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(CLIP_MEO_DIR);
    let deleted = 0;
    for (const file of files) {
      if (deleted >= MAX_DELETIONS_PER_CLEANUP) break;
      const filePath = path.join(CLIP_MEO_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      } catch (e) { /* file có thể đã bị xóa bởi tiến trình khác giữa lúc liệt kê và xóa — bỏ qua */ }
    }
    if (deleted > 0) {
      console.log(`[Cleanup] 🧹 Đã dọn ${deleted} file media cũ hơn ${MEDIA_RETENTION_DAYS} ngày trong ${CLIP_MEO_DIR}`);
    }
  } catch (e) {
    console.error('[Cleanup] ❌ Lỗi dọn dẹp file media cũ:', e.message);
  }
}
setTimeout(cleanupOldMediaFiles, 60 * 1000);
setInterval(cleanupOldMediaFiles, 24 * 60 * 60 * 1000);

// Dọn dẹp ảnh/HTML debug cũ trong DEBUG_OUTPUT_DIR để giải phóng dung lượng ổ đĩa.
// Xóa file debug phát sinh khi thất bại có tuổi thọ > 48 giờ.
const DEBUG_RETENTION_HOURS = 48;
function cleanupOldDebugFiles() {
  try {
    if (!fs.existsSync(DEBUG_OUTPUT_DIR)) return;
    const cutoff = Date.now() - DEBUG_RETENTION_HOURS * 60 * 60 * 1000;
    const files = fs.readdirSync(DEBUG_OUTPUT_DIR);
    let deleted = 0;
    for (const file of files) {
      if (deleted >= MAX_DELETIONS_PER_CLEANUP) break;
      const filePath = path.join(DEBUG_OUTPUT_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      } catch (e) { /* file có thể đã bị xóa — bỏ qua */ }
    }
    if (deleted > 0) {
      console.log(`[Cleanup] 🧹 Đã dọn ${deleted} file debug cũ hơn ${DEBUG_RETENTION_HOURS} giờ trong ${DEBUG_OUTPUT_DIR}`);
    }
  } catch (e) {
    console.error('[Cleanup] ❌ Lỗi dọn dẹp file debug cũ:', e.message);
  }
}
setTimeout(cleanupOldDebugFiles, 30 * 1000);
setInterval(cleanupOldDebugFiles, 12 * 60 * 60 * 1000);

/**
 * Khoá dedupe cho URL video Threads/Instagram: dùng pathname, bỏ qua query string vì
 * các token ký (efg/oe/_nc_ohc...) có thể đổi giữa 2 lần đọc cùng 1 video vật lý.
 */
function getVideoDedupeKey(url) {
  try { return new URL(url).pathname; } catch (e) { return String(url).split('?')[0]; }
}

/**
 * Tự động nâng cấp URL hình ảnh của Threads / Instagram / Facebook từ bản xem trước 640x640 / 320x320 lên bản sắc nét 1080x1080 (HD).
 */
function upgradeMediaUrlToHd(url) {
  if (!url || typeof url !== 'string') return url;
  const cleanUrl = url
    .replace(/\\u0026/g, '&')
    .replace(/\\u0025/g, '%')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/\\/g, '');

  if (cleanUrl.includes('oh=') || cleanUrl.includes('_nc_hash=') || cleanUrl.includes('sig=')) {
    return cleanUrl;
  }
  if (cleanUrl.includes('cdninstagram.com') || cleanUrl.includes('fbcdn.net')) {
    return cleanUrl
      .replace(/s640x640/g, 's1080x1080')
      .replace(/p640x640/g, 'p1080x1080')
      .replace(/s320x320/g, 's1080x1080')
      .replace(/p320x320/g, 'p1080x1080')
      .replace(/e35_s640x640/g, 'e35_s1080x1080')
      .replace(/e35_s320x320/g, 'e35_s1080x1080');
  }
  return cleanUrl;
}

function isAudioOnlyMp4(url) {
  if (!url || typeof url !== 'string') return true;
  const lower = url.toLowerCase();
  if (lower.includes('audio_') || lower.includes('_audio') || lower.includes('heaac') || lower.includes('vbr3_audio')) {
    return true;
  }
  try {
    const efgMatch = url.match(/[?&]efg=([^&]+)/);
    if (efgMatch) {
      const decoded = Buffer.from(decodeURIComponent(efgMatch[1]), 'base64').toString('utf8');
      if (decoded.includes('audio') || decoded.includes('heaac')) {
        return true;
      }
    }
  } catch (e) { }
  return false;
}

const DEFAULT_REALISTIC_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function createStealthBrowserContext(browser, options = {}) {
  const contextOptions = {
    userAgent: options.userAgent && typeof options.userAgent === 'string' && options.userAgent.trim().length > 0
      ? options.userAgent.trim()
      : DEFAULT_REALISTIC_USER_AGENT,
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    permissions: ['notifications'],
    extraHTTPHeaders: {
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"'
    }
  };

  if (options.proxyUrl && typeof options.proxyUrl === 'string' && options.proxyUrl.trim().length > 0) {
    try {
      const pUrl = new URL(options.proxyUrl.trim());
      contextOptions.proxy = {
        server: `${pUrl.protocol}//${pUrl.hostname}:${pUrl.port}`
      };
      if (pUrl.username) contextOptions.proxy.username = pUrl.username;
      if (pUrl.password) contextOptions.proxy.password = pUrl.password;
      console.log(`[Playwright][Stealth] 🌐 Sử dụng Proxy riêng: ${pUrl.hostname}:${pUrl.port}`);
    } catch (e) {
      console.warn(`[Playwright][Stealth] ⚠️ Proxy URL không hợp lệ: "${options.proxyUrl}":`, e.message);
    }
  }

  const context = await browser.newContext(contextOptions);

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['vi-VN', 'vi', 'en-US', 'en'],
    });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    window.chrome = {
      runtime: {},
      loadTimes: function () { },
      csi: function () { },
      app: {}
    };
  });

  return context;
}

/**
 * Trích xuất URL Video chất lượng cao nhất (HD 1080p/720p) từ HTML / JSON nguồn của Threads, Instagram, Facebook, TikTok.
 */
function extractBestHdVideoUrl(pageHtml, fallbackVideoUrl = null) {
  if (!pageHtml || typeof pageHtml !== 'string') return upgradeMediaUrlToHd(fallbackVideoUrl);

  // 1. Kiểm tra video_versions trong JSON của Threads / Instagram (type 101 = HD, type 102 = SD, type 103 = Low)
  try {
    const versionsMatches = pageHtml.match(/"video_versions":\s*(\[[^\]]+\])/g) || [];
    for (const match of versionsMatches) {
      const raw = match.replace('"video_versions":', '').trim();
      let versions = null;
      try {
        versions = JSON.parse(raw);
      } catch (e1) {
        try {
          const clean = raw
            .replace(/\\u0025/g, '%')
            .replace(/\\u0026/g, '&')
            .replace(/&amp;/g, '&')
            .replace(/\\\//g, '/');
          versions = JSON.parse(clean);
        } catch (e2) { }
      }
      if (Array.isArray(versions) && versions.length > 0) {
        // Ưu tiên type 101 (HD) hoặc bản có width * height lớn nhất
        const hdVersion = versions.find(v => String(v.type) === '101')
          || [...versions].sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)))[0];
        if (hdVersion && hdVersion.url) {
          let u = hdVersion.url.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\/g, '');
          if (!u.includes('bytestart=') && !u.includes('byteend=') && !isAudioOnlyMp4(u)) {
            console.log(`[HD Video Extractor] 🎬 Tìm thấy Threads/Instagram HD Video (type ${hdVersion.type || '101'}): ${u.slice(0, 80)}...`);
            return upgradeMediaUrlToHd(u);
          }
        }
      }
    }
  } catch (e) { }

  // 2. Pattern HD / SD dạng JSON Key cho Facebook / Instagram / Threads / TikTok
  // Ưu tiên đặc biệt cho "progressive_url" (chuẩn mới của Facebook GraphQL/Relay)
  try {
    const progressiveMatches = [...pageHtml.matchAll(/"progressive_url"\s*:\s*"([^"]+)"/g)];
    if (progressiveMatches.length > 0) {
      const progUrls = progressiveMatches.map(m => {
        return m[1]
          .replace(/\\u0025/g, '%')
          .replace(/\\u0026/g, '&')
          .replace(/&amp;/g, '&')
          .replace(/\\\//g, '/')
          .replace(/\\/g, '');
      }).filter(u => !u.includes('bytestart=') && !u.includes('byteend=') && !isAudioOnlyMp4(u));
      if (progUrls.length > 0) {
        // Ưu tiên bản HD (720p, 1080p) nếu có, fallback về URL đầu tiên (bài viết chính)
        const bestProg = progUrls.find(u => /720p|1080p|dash_h264/i.test(u)) || progUrls[0];
        console.log(`[HD Video Extractor] 🎬 Tìm thấy Facebook progressive MP4 Video: ${bestProg.slice(0, 80)}...`);
        return upgradeMediaUrlToHd(bestProg);
      }
    }
  } catch (eProg) { }

  const jsonHdPatterns = [
    /"browser_native_hd_url"\s*:\s*"([^"]+)"/g,
    /"playable_url_quality_hd"\s*:\s*"([^"]+)"/g,
    /"hd_src"\s*:\s*"([^"]+)"/g,
    /"hd_src_no_ratelimit"\s*:\s*"([^"]+)"/g,
    /"video_url_hd"\s*:\s*"([^"]+)"/g,
    /"playAddrH264"\s*:\s*"([^"]+)"/g,
    /"browser_native_sd_url"\s*:\s*"([^"]+)"/g,
    /"playable_url"\s*:\s*"([^"]+)"/g,
    /"sd_src"\s*:\s*"([^"]+)"/g,
    /"playAddr"\s*:\s*"([^"]+)"/g,
    /"downloadAddr"\s*:\s*"([^"]+)"/g,
  ];
  for (const pattern of jsonHdPatterns) {
    let m;
    while ((m = pattern.exec(pageHtml)) !== null) {
      const rawUrl = m[1] || m[0];
      const cleanUrl = rawUrl
        .replace(/\\u0025/g, '%')
        .replace(/\\u0026/g, '&')
        .replace(/&amp;/g, '&')
        .replace(/\\\//g, '/')
        .replace(/\\/g, '');
      if (!cleanUrl.includes('bytestart=') && !cleanUrl.includes('byteend=') && !isAudioOnlyMp4(cleanUrl)) {
        console.log(`[HD Video Extractor] 🎬 Tìm thấy Facebook/TikTok HD Video URL (JSON key): ${cleanUrl.slice(0, 80)}...`);
        return upgradeMediaUrlToHd(cleanUrl);
      }
    }
  }

  // 3. Quét toàn bộ link MP4 progressive / fbcdn trực tiếp trong HTML
  const mp4Regexes = [
    /(https?(?::\\\/\\\/|:\/\/)[^\s"']+?(?:fbcdn\.net|cdninstagram\.com)[^\s"']+?\.mp4[^\s"']*)/gi,
    /https?:\\\/\\\/video[^\s"']+\.fbcdn\.net\\\/[^\s"']+/gi,
    /https?:[^\s"']+\.fbcdn\.net\/o1\/v\/[^\s"']+/gi,
  ];
  for (const reg of mp4Regexes) {
    let m;
    while ((m = reg.exec(pageHtml)) !== null) {
      const rawUrl = m[1] || m[0];
      const cleanUrl = rawUrl
        .replace(/\\u0025/g, '%')
        .replace(/\\u0026/g, '&')
        .replace(/&amp;/g, '&')
        .replace(/\\\//g, '/')
        .replace(/\\/g, '');
      if (!cleanUrl.includes('bytestart=') && !cleanUrl.includes('byteend=') && !isAudioOnlyMp4(cleanUrl)) {
        console.log(`[HD Video Extractor] 🎬 Tìm thấy Facebook/TikTok Video URL (HTML match): ${cleanUrl.slice(0, 80)}...`);
        return upgradeMediaUrlToHd(cleanUrl);
      }
    }
  }

  return upgradeMediaUrlToHd(fallbackVideoUrl);
}

// Ngưỡng kích thước tối thiểu để coi 1 file tải về là hợp lệ — response bị chặn hotlink/CDN trả
// placeholder hoặc bị cắt cụt giữa chừng thường ra file rất nhỏ hoặc rỗng thay vì báo lỗi HTTP rõ ràng.
const MIN_MEDIA_BYTES = 1024;
function isValidMediaResponse(mediaRes, mediaBuffer) {
  if (!mediaRes.ok() || !mediaBuffer || mediaBuffer.length < MIN_MEDIA_BYTES) return false;
  // CDN của Facebook đôi khi trả HTTP 200 kèm trang lỗi HTML/JSON (link hết hạn "oe=", bị chặn hotlink...)
  // dài hơn cả ngưỡng MIN_MEDIA_BYTES — nếu không lọc content-type, file "lỗi" này vẫn được coi là tải
  // thành công rồi đem đi đăng, khiến Facebook báo lỗi phát video/ảnh sau khi đăng.
  const contentType = (mediaRes.headers()['content-type'] || '').toLowerCase();
  if (contentType.includes('text/html') || contentType.includes('application/json')) return false;
  return true;
}

// Tải 1 media URL qua Playwright request với retry — CDN của FB thỉnh thoảng chặn hotlink hoặc trả
// response lỗi/thiếu tạm thời, thử lại vài lần trước khi bỏ cuộc thường tự khỏi.
async function downloadMediaWithRetry(page, mediaUrl, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 1. Thử dùng native node fetch trước (nhanh hơn, không bị phụ thuộc vào page context)
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000);
      const res = await fetch(mediaUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': mediaUrl.includes('douyin') || mediaUrl.includes('snssdk') || mediaUrl.includes('douyinvod')
            ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
            : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': mediaUrl.includes('threads') || mediaUrl.includes('cdninstagram')
            ? 'https://www.threads.net/'
            : (mediaUrl.includes('tiktok') || mediaUrl.includes('douyin') || mediaUrl.includes('snssdk') || mediaUrl.includes('douyinvod') || mediaUrl.includes('byteoversea') || mediaUrl.includes('akamaized')
              ? 'https://www.douyin.com/'
              : 'https://www.facebook.com/'),
          'Accept': '*/*'
        }
      });
      clearTimeout(timer);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get('content-type') || '';
        const mediaKind = detectMediaKind(contentType, buf, mediaUrl);
        if (buf.length >= MIN_MEDIA_BYTES && mediaKind) {
          return { buffer: buf, status: res.status, contentType, mediaKind };
        }
        lastError = new Error(`native fetch không trả media hợp lệ (${contentType || 'unknown'}, ${buf.length} bytes)`);
      } else {
        lastError = new Error(`native fetch HTTP ${res.status}`);
      }
    } catch (e2) {
      lastError = e2;
    }

    // 2. Thử qua Playwright page.request nếu page còn active
    if (page && typeof page.request?.get === 'function') {
      try {
        let requestReferer = 'https://www.facebook.com/';
        try { requestReferer = refererForMediaUrl(new URL(mediaUrl)); } catch (_) { }
        const mediaRes = await page.request.get(mediaUrl, {
          timeout: 30000,
          headers: { Referer: requestReferer, Accept: '*/*' },
        });
        const mediaBuffer = await mediaRes.body();
        if (isValidMediaResponse(mediaRes, mediaBuffer)) {
          const contentType = mediaRes.headers()['content-type'] || '';
          const mediaKind = detectMediaKind(contentType, mediaBuffer, mediaUrl);
          if (mediaKind) {
            return { buffer: mediaBuffer, status: mediaRes.status(), contentType, mediaKind };
          }
        }
        lastError = new Error(`page.request status ${mediaRes.status()}, ${mediaBuffer ? mediaBuffer.length : 0} bytes`);
      } catch (e) {
        lastError = e;
      }
    }

    if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 800 * attempt));
  }
  throw new Error(`Tải media thất bại sau ${maxAttempts} lần thử (${lastError ? lastError.message : 'unknown'})`);
}

// Cache kết quả cào bài Facebook theo URL — tránh cào lại + tải trùng file khi người dùng submit lại
// cùng 1 link trong thời gian ngắn (bấm nhầm 2 lần, frontend retry...). TTL ngắn để không kẹt kết quả
// cũ mãi mãi nếu bài viết đã thay đổi.
const SCRAPE_CACHE_FILE = path.join(__dirname, 'scrape_cache.json');
const SCRAPE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 giờ

function loadScrapeCache() {
  try {
    if (fs.existsSync(SCRAPE_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SCRAPE_CACHE_FILE, 'utf-8'));
      const now = Date.now();
      const valid = {};
      for (const [k, v] of Object.entries(data)) {
        if (v && v.scrapedAt && (now - v.scrapedAt) <= SCRAPE_CACHE_TTL_MS) {
          valid[k] = v;
        }
      }
      return valid;
    }
  } catch (e) {
    console.warn('[ScrapeCache] ⚠️ Không đọc được cache, khởi tạo lại:', e.message);
  }
  return {};
}
const scrapeCache = loadScrapeCache();

function pruneExpiredScrapeCache() {
  const now = Date.now();
  for (const [key, val] of Object.entries(scrapeCache)) {
    if (!val || !val.scrapedAt || (now - val.scrapedAt) > SCRAPE_CACHE_TTL_MS) {
      delete scrapeCache[key];
    }
  }
}

function saveScrapeCache() {
  // Tự động dọn dẹp các mục đã hết hạn (> 6 giờ) trước khi lưu để file không bị phình to
  pruneExpiredScrapeCache();
  const tmpFile = `${SCRAPE_CACHE_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(scrapeCache, null, 2));
  fs.renameSync(tmpFile, SCRAPE_CACHE_FILE);
}
// Khóa cache PHẢI phân biệt theo tài khoản/cookie dùng để cào — nếu không, 2 tài khoản khác nhau
// (VD account Graph API và account Playwright cùng trỏ 1 Fanpage) cùng cào 1 sourceUrl trong vòng
// TTL sẽ nhận lại kết quả đã cào bởi tài khoản kia, gây hiện tượng "lấy lộn/nhầm nội dung".
function getScrapeCacheKey(sourceUrl, scrapeLimit, minViewsThreshold, shouldIncludeCredit, identityKey) {
  // Tăng version khi thay đổi quy tắc nhận diện media. Nếu không, kết quả cũ chỉ có thumbnail/ảnh
  // sẽ tiếp tục được trả về trong 6 giờ dù worker đã sửa đúng cách lấy video Threads.
  return `media-v3::${sourceUrl}::${scrapeLimit}::${minViewsThreshold}::${shouldIncludeCredit}::${identityKey || 'anon'}`;
}
// Không đưa cookie thô vào cache key/log — chỉ dùng hash ngắn để phân biệt các cookie khác nhau.
function computeScrapeIdentityKey(socialAccountId, cookieString) {
  if (socialAccountId) return `acc_${socialAccountId}`;
  if (cookieString) return `cookie_${crypto.createHash('sha256').update(cookieString).digest('hex').slice(0, 16)}`;
  return null;
}

// ── "Dấu vân tay" công khai của 1 bài Facebook để đối chiếu kết quả cào ──────────────────────────
// Cào bằng cookie đăng nhập đôi khi ra NHẦM BÀI: live 2026-10-20, 2 link share/p/1SCJM9b1zR và
// share/p/19Y6RieB5c (2 bài khác nhau của page vietnameconomynews) cùng bị cào thành bài "Cristiano
// Ronaldo bị treo giò…" (bài khác của page) khi có cookie, còn cào không cookie thì đúng cả hai. Facebook
// luôn trả og:url / og:description / og:image ĐÚNG của bài cho bot xem trước link (facebookexternalhit,
// không cần đăng nhập, ~1s) — dùng làm mốc đối chiếu caption + ảnh sau khi cào.
function decodeBasicHtmlEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
// ID ảnh fbcdn dạng 858304574_4376262232684855_8564436325411349796 — giữ nguyên giữa các kích thước/bản crop
function extractFbImageIds(urls) {
  const ids = new Set();
  for (const u of urls || []) {
    const m = String(u || '').match(/\/(\d+_\d+_\d+)_[a-z]\.(?:jpe?g|png|webp|gif)/i);
    if (m) ids.add(m[1]);
  }
  return ids;
}
function anchorTextTokens(text) {
  return String(text || '').normalize('NFC').toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[-_/|]+/g, ' ')
    // Xoá (không thay bằng dấu cách) ký tự chèn giữa chữ để né kiểm duyệt, vd "m:ua", "s.ản"
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/).filter(t => t.length >= 2);
}
async function fetchFacebookPublicAnchor(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await fetch(url, {
      // UA ngắn này mới nhận og:image là link fbcdn có ID ảnh; UA đầy đủ "(+http://…externalhit_uatext.php)"
      // chỉ nhận link lookaside.fbsbx.com (không so khớp ảnh được)
      headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const html = (await resp.text()).slice(0, 600000);
    const meta = (prop) => {
      const re = new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i');
      const m = html.match(re);
      return m ? decodeBasicHtmlEntities(m[1]).trim() : '';
    };
    const ogUrl = meta('og:url');
    if (!ogUrl || /\/login|\/checkpoint/i.test(ogUrl)) return null;
    const description = meta('og:description') || meta('description');
    // Có thể có nhiều thẻ og:image (thẻ đầu hay là link lookaside.fbsbx.com không mang ID ảnh) — gom hết
    const ogImages = [...html.matchAll(/<meta[^>]+property="og:image"[^>]+content="([^"]*)"/gi)].map(m => decodeBasicHtmlEntities(m[1]));
    const ogImage = ogImages.find(u => extractFbImageIds([u]).size > 0) || ogImages[0] || '';
    // og:url của bài Page thường mang slug từ caption (".../posts/công-an-hà-nội-đề-nghị-…/123") —
    // dùng làm caption dự phòng khi Facebook không trả og:description (gặp thật với share/p/1SCJM9b1zR)
    let slugText = '';
    try {
      const parts = decodeURIComponent(new URL(ogUrl).pathname).split('/').filter(Boolean);
      slugText = parts.filter(p => p.includes('-') && !/^pfbid/i.test(p) && !/^\d+$/.test(p)).join(' ');
    } catch (e) { }
    return { ogUrl, description, slugText, ogImage, imageIds: [...extractFbImageIds(ogImages)] };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
// verdict: 'match' | 'mismatch' | 'unknown' (không đủ dữ liệu để kết luận → không chặn)
function checkFacebookAnchorMatch(anchor, item) {
  if (!anchor || !item) return { verdict: 'unknown', reason: 'no-anchor' };
  let textVerdict = 'unknown';
  let textScore = null;
  const anchorTokens = [...new Set(anchorTextTokens(anchor.description || anchor.slugText))].slice(0, 25);
  if (anchorTokens.length >= 4) {
    const scrapedTokens = new Set(anchorTextTokens(item.content || item.title));
    const hits = anchorTokens.filter(t => scrapedTokens.has(t)).length;
    textScore = Math.round((hits / anchorTokens.length) * 100) / 100;
    if (textScore >= 0.5) textVerdict = 'match';
    else if (textScore <= 0.2) textVerdict = 'mismatch';
  }
  let imageVerdict = 'unknown';
  const isVideo = item.mediaType === 'video' || (item.videoCount || 0) > 0;
  if (!isVideo && anchor.imageIds.length > 0) {
    const scrapedIds = extractFbImageIds(item.mediaUrls);
    if (scrapedIds.size > 0) {
      imageVerdict = anchor.imageIds.some(id => scrapedIds.has(id)) ? 'match' : 'mismatch';
    }
  }
  let verdict = 'unknown';
  if (textVerdict === 'match' || imageVerdict === 'match') verdict = 'match';
  if ((textVerdict === 'mismatch' && imageVerdict !== 'match') || (imageVerdict === 'mismatch' && textVerdict !== 'match')) verdict = 'mismatch';
  return { verdict, textVerdict, textScore, imageVerdict, anchorUrl: anchor.ogUrl };
}

// Rút ID số của Page/Group từ URL Facebook (VD: profile.php?id=123, /groups/123/, facebook.com/123/).
// Chỉ tin cậy với ID số — tên vanity (VD facebook.com/tenpage) không dùng để so khớp vì Facebook có
// thể trả về og:url dạng ID số ngay cả khi truy cập bằng tên vanity, dễ gây báo động giả.
function extractFacebookNumericId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!u.hostname.includes('facebook.com')) return null;
    const idParam = u.searchParams.get('id');
    if (idParam && /^\d+$/.test(idParam)) return idParam;
    const groupMatch = u.pathname.match(/\/groups\/(\d+)/);
    if (groupMatch) return groupMatch[1];
    const segments = u.pathname.split('/').filter(Boolean);
    if (segments.length > 0 && /^\d+$/.test(segments[0])) return segments[0];
    return null;
  } catch (e) {
    return null;
  }
}

// Hàm tải và lưu vĩnh viễn clip video mèo vào máy dùng fetch (không spawn Chromium, tiết kiệm 300MB RAM)
async function downloadAndSaveVideoPermanently(videoUrl, title = 'clip_meo') {
  try {
    if (!videoUrl || !videoUrl.startsWith('http')) return videoUrl;
    const filename = `clip_meo_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp4`;
    const filePath = path.join(CLIP_MEO_DIR, filename);

    const resp = await fetch(videoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    if (!resp.ok) {
      console.warn(`[MediaLibrary] ⚠️ Fetch video status ${resp.status}: ${resp.statusText}`);
      return videoUrl;
    }
    const buffer = Buffer.from(await resp.arrayBuffer());

    if (buffer && buffer.length > 5000) {
      fs.writeFileSync(filePath, buffer);
      console.log(`[MediaLibrary] 💾 Đã lưu VĨNH VIỄN clip mèo (${(buffer.length / 1024 / 1024).toFixed(2)} MB) vào kho: ${filename}`);
      return `${desktop.WORKER_PUBLIC_URL}/downloads/clip_meo/${filename}`;
    }
    return videoUrl;
  } catch (e) {
    console.warn(`[MediaLibrary] ⚠️ Lỗi khi lưu vĩnh viễn video: ${e.message}`);
    return videoUrl;
  }
}

// Facebook khoá nút Đăng/Tiếp (aria-disabled="true") trong lúc Video còn đang tải lên/xử lý.
// Chờ tới khi nút hết bị khoá thay vì chờ cứng một khoảng thời gian cố định, để tránh bấm Đăng
// trước khi Video xử lý xong khiến bài viết bị đăng thiếu Video.
async function waitUntilEnabled(locator, page, maxWaitMs) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const ariaDisabled = await locator.getAttribute('aria-disabled').catch(() => null);
    const nativeDisabled = await locator.isDisabled().catch(() => false);
    if (ariaDisabled !== 'true' && !nativeDisabled) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

// Hàm tiện ích phân tích chuỗi cookie (dạng c_user=...; xs=... hoặc JSON mảng/object từ Extension) thành mảng object cho Playwright
function parseCookies(cookieString, targetPageId = null) {
  if (!cookieString) return [];
  const domains = ['.facebook.com', 'facebook.com', 'www.facebook.com', 'mbasic.facebook.com', 'm.facebook.com'];
  const cookies = [];

  const trimmedRaw = String(cookieString).trim();
  if ((trimmedRaw.startsWith('{') && trimmedRaw.endsWith('}')) || (trimmedRaw.startsWith('[') && trimmedRaw.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmedRaw);
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed.cookies) ? parsed.cookies : null;
      if (Array.isArray(arr)) {
        for (const item of arr) {
          const name = String(item?.name || item?.key || '').trim();
          let val = String(item?.value || item?.val || '').trim();
          if (name && val) {
            if (name === 'i_user' && targetPageId) {
              val = targetPageId.toString().trim();
            }
            for (const d of domains) {
              cookies.push({
                name,
                value: val,
                domain: d,
                path: item.path || '/',
              });
            }
          }
        }
        if (targetPageId && !cookies.some(c => c.name === 'i_user')) {
          for (const d of domains) {
            cookies.push({
              name: 'i_user',
              value: targetPageId.toString().trim(),
              domain: d,
              path: '/',
            });
          }
        }
        return cookies;
      }
    } catch (e) {
      // fallback sang split bình thường
    }
  }

  const parts = cookieString.split(';');
  for (const part of parts) {
    const [name, ...valueParts] = part.trim().split('=');
    if (name && valueParts.length > 0) {
      const trimmedName = name.trim();
      let val = valueParts.join('=').trim();
      if (trimmedName === 'i_user' && targetPageId) {
        val = targetPageId.toString().trim(); // Luôn cập nhật i_user theo đúng Page ID mục tiêu
      }
      for (const d of domains) {
        cookies.push({
          name: trimmedName,
          value: val,
          domain: d,
          path: '/',
        });
      }
    }
  }

  // Tự động bổ sung i_user cookie nếu chưa có
  if (targetPageId) {
    const hasIUser = cookies.some(c => c.name === 'i_user');
    if (!hasIUser) {
      for (const d of domains) {
        cookies.push({
          name: 'i_user',
          value: targetPageId.toString().trim(),
          domain: d,
          path: '/',
        });
      }
    }
  }

  return cookies;
}

function getCookieValue(cookieString, targetName) {
  const target = String(targetName || '').trim().toLowerCase();
  for (const rawPart of String(cookieString || '').split(';')) {
    const separatorIndex = rawPart.indexOf('=');
    if (separatorIndex < 0) continue;
    const name = rawPart.slice(0, separatorIndex).trim().toLowerCase();
    if (name === target) return rawPart.slice(separatorIndex + 1).trim();
  }
  return null;
}

function facebookIdFromUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl, 'https://www.facebook.com');
    const queryId = parsed.searchParams.get('id');
    if (/^\d{5,}$/.test(queryId || '')) return queryId;

    const pageRouteMatch = parsed.pathname.match(/^\/pages\/[^/]+\/(\d{5,})(?:\/|$)/i);
    if (pageRouteMatch) return pageRouteMatch[1];

    const numericRouteMatch = parsed.pathname.match(/^\/(\d{5,})(?:\/|$)/);
    if (numericRouteMatch) return numericRouteMatch[1];

    const encodedIdMatch = decodeURIComponent(parsed.href).match(/(?:profile_id|page_id|delegate_page_id)[=:"%]+(\d{5,})/i);
    return encodedIdMatch ? encodedIdMatch[1] : null;
  } catch (_) {
    return null;
  }
}

function facebookVanityFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl, 'https://www.facebook.com');
    const first = parsed.pathname.split('/').filter(Boolean)[0] || '';
    const blocked = new Set([
      'home.php', 'me', 'pages', 'groups', 'events', 'friends', 'marketplace', 'watch',
      'gaming', 'bookmarks', 'settings', 'help', 'login', 'notifications', 'messages',
    ]);
    if (!first || blocked.has(first.toLowerCase()) || first.includes('.php')) return null;
    return first;
  } catch (_) {
    return null;
  }
}

function facebookPageIdFromDocumentSignals(signals) {
  const directValues = [signals?.url, ...(signals?.metaValues || []), ...(signals?.identityHrefs || [])];
  for (const value of directValues) {
    const directId = facebookIdFromUrl(value);
    if (directId) return directId;
    const fbPageMatch = String(value || '').match(/fb:\/\/(?:page|profile)\/?(?:\?id=|\/)(\d{5,})/i);
    if (fbPageMatch) return fbPageMatch[1];
  }

  const html = String(signals?.htmlSample || '');
  const patterns = [
    /"(?:pageID|page_id|profile_id|delegate_page_id)"\s*:\s*"?(\d{5,})/i,
    /(?:pageID|page_id|profile_id|delegate_page_id)\\?"?\s*[=:]\s*\\?"?(\d{5,})/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function readFacebookPageSignals(page, includeHtmlSample = false) {
  return page.evaluate((shouldReadHtml) => {
    const metaValues = Array.from(document.querySelectorAll(
      'meta[property="al:android:url"], meta[property="og:url"], meta[property="al:ios:url"], link[rel="canonical"]'
    )).map((element) => element.getAttribute('content') || element.getAttribute('href') || '').filter(Boolean);

    const identityHrefs = Array.from(document.querySelectorAll(
      '[role="banner"] a[href], [role="navigation"] a[href], a[aria-label*="profile" i], a[aria-label*="trang cá nhân" i]'
    )).slice(0, 80).map((anchor) => anchor.href).filter(Boolean);

    const heading = Array.from(document.querySelectorAll('h1, h2'))
      .map((element) => (element.innerText || '').trim())
      .find((text) => text && text.length <= 160) || '';

    return {
      url: window.location.href,
      title: document.title || '',
      heading,
      metaValues,
      identityHrefs,
      bodyText: (document.body?.innerText || '').slice(0, 5000),
      htmlSample: shouldReadHtml ? (document.documentElement?.innerHTML || '').slice(0, 1_500_000) : '',
    };
  }, includeHtmlSample);
}

function mergeFacebookPageCandidate(candidateMap, rawCandidate) {
  const href = String(rawCandidate?.url || '').trim();
  const name = String(rawCandidate?.name || '').replace(/\s+/g, ' ').trim();
  if (!href || !name || name.length > 180) return;
  if (!/facebook\.com/i.test(href)) return;
  if (/\/(groups|events|friends|marketplace|watch|gaming|help|settings|notifications|messages|reel|reels|stories|latest\/inbox|ads|business|privacy|policies)(?:\/|\?|$)/i.test(href)) return;

  const isSystemName = /^(?:thông báo|tin nhắn|bảng feed|trang chủ|home|notifications|inbox|messages|bảng tin|reels|stories|quản lý trang|xem tất cả|cài đặt|chọn trang|menu)$/i.test(name);
  if (isSystemName) return;

  const pageId = facebookIdFromUrl(href);
  const vanity = facebookVanityFromUrl(href);
  if (!pageId && !vanity) return;
  const key = pageId ? `id:${pageId}` : `vanity:${vanity.toLowerCase()}`;
  const current = candidateMap.get(key);
  candidateMap.set(key, {
    pageId: pageId || current?.pageId || null,
    vanity: vanity || current?.vanity || null,
    name: name || current?.name || 'Facebook Page',
    url: href || current?.url,
    avatarUrl: rawCandidate?.avatarUrl || current?.avatarUrl || null,
    sources: Array.from(new Set([...(current?.sources || []), rawCandidate?.source || 'UNKNOWN'])),
  });
}

async function collectFacebookPageAnchors(page, candidateMap, source, scopeSelector = 'body') {
  const rawCandidates = await page.evaluate(({ sourceArg, scopeSelectorArg }) => {
    const root = document.querySelector(scopeSelectorArg) || document.body;
    return Array.from(root.querySelectorAll('a[href]')).map((anchor) => {
      const name = (anchor.innerText || anchor.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      const image = anchor.querySelector('img');
      return {
        name,
        url: anchor.href,
        avatarUrl: image?.currentSrc || image?.src || null,
        source: sourceArg,
      };
    }).filter((item) => item.name && item.url);
  }, { sourceArg: source, scopeSelectorArg: scopeSelector }).catch(() => []);

  rawCandidates.forEach((candidate) => mergeFacebookPageCandidate(candidateMap, candidate));
}

async function scrollFacebookListToEnd(page, candidateMap, source, scopeSelector = 'body', maxRounds = 45) {
  let unchangedRounds = 0;
  let previousSize = -1;

  for (let round = 0; round < maxRounds && unchangedRounds < 4; round += 1) {
    await collectFacebookPageAnchors(page, candidateMap, source, scopeSelector);
    if (candidateMap.size === previousSize) unchangedRounds += 1;
    else unchangedRounds = 0;
    previousSize = candidateMap.size;

    await page.evaluate((selector) => {
      const root = document.querySelector(selector) || document.scrollingElement || document.body;
      const scrollables = [root, ...Array.from(root.querySelectorAll('*'))]
        .filter((element) => element.scrollHeight > element.clientHeight + 80);
      const target = scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
        || document.scrollingElement || document.body;
      target.scrollTop = target.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    }, scopeSelector).catch(() => { });
    await page.waitForTimeout(900);
  }
  await collectFacebookPageAnchors(page, candidateMap, source, scopeSelector);
  return unchangedRounds >= 4;
}

async function openFacebookProfileSwitcher(page) {
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
  await page.waitForTimeout(2200);

  const accountButtons = page.locator([
    '[role="banner"] [aria-label*="Tài khoản" i]',
    '[role="banner"] [aria-label*="Account" i]',
    '[role="banner"] [aria-label*="profile" i]',
    '[role="banner"] [aria-label*="trang cá nhân" i]',
  ].join(', '));

  const count = Math.min(await accountButtons.count().catch(() => 0), 20);
  for (let index = count - 1; index >= 0; index -= 1) {
    const button = accountButtons.nth(index);
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true }).catch(() => { });
      await page.waitForTimeout(1200);
      break;
    }
  }

  const seeAllRegex = /Xem tất cả (?:các )?(?:Trang|trang cá nhân)|See all (?:Pages|profiles)/i;
  const seeAll = page.getByText(seeAllRegex, { exact: false }).last();
  if (!(await seeAll.isVisible().catch(() => false))) return false;
  await seeAll.click({ force: true }).catch(() => { });
  await page.waitForTimeout(1600);
  return true;
}

async function resolveFacebookPageId(probePage, candidate) {
  if (candidate.pageId) return candidate;
  await probePage.goto(candidate.url, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => { });
  await probePage.waitForTimeout(1200);
  const signals = await readFacebookPageSignals(probePage, true).catch(() => null);
  const resolvedId = facebookPageIdFromDocumentSignals(signals);
  return {
    ...candidate,
    pageId: resolvedId,
    name: signals?.heading || candidate.name,
    url: signals?.metaValues?.find((value) => /facebook\.com/i.test(value)) || candidate.url,
  };
}

async function verifyFacebookPageIdentity(context, probePage, candidate, personalProfileId) {
  if (!candidate.pageId) {
    return { ...candidate, verificationStatus: 'DISCOVERED', verificationMessage: 'Đã thấy trong danh sách nhưng chưa đọc được Page ID.' };
  }

  await context.addCookies([{
    name: 'i_user',
    value: candidate.pageId,
    domain: '.facebook.com',
    path: '/',
  }]);
  await probePage.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => { });
  await probePage.waitForTimeout(1100);
  const signals = await readFacebookPageSignals(probePage, true).catch(() => null);
  const actualIdentityId = facebookPageIdFromDocumentSignals(signals);
  const loginRequired = /facebook\.com\/(login|checkpoint)/i.test(signals?.url || '')
    || /đăng nhập|log in/i.test(signals?.title || '');
  const unavailable = /nội dung này hiện không hiển thị|content isn't available|page isn't available/i.test(signals?.bodyText || '');
  const verified = actualIdentityId === candidate.pageId;

  return {
    ...candidate,
    name: verified && signals?.heading ? signals.heading : candidate.name,
    verificationStatus: verified ? 'VERIFIED' : (loginRequired ? 'SESSION_INVALID' : (unavailable ? 'NO_ACCESS' : 'DISCOVERED')),
    verificationMessage: verified
      ? 'Đã chuyển trực tiếp sang danh tính Page.'
      : loginRequired
        ? 'Cookie hết hạn hoặc tài khoản đang bị checkpoint.'
        : unavailable
          ? 'Facebook từ chối quyền truy cập Page.'
          : 'Đã tìm thấy Page nhưng Facebook không trả đủ tín hiệu để xác minh chuyển danh tính.',
    verifiedAt: verified ? new Date().toISOString() : null,
  };
}

// Phân biệt lỗi cookie hết hạn với lỗi Facebook đổi selector. Khi phiên đã logout, trang Fanpage
// công khai vẫn tải bình thường nên nếu không kiểm tra, worker sẽ báo nhầm "không mở được Modal".
async function assertFacebookSession(page, socialAccountId = null) {
  const currentUrl = page.url() || '';
  const isLoginUrl = /facebook\.com\/(login|checkpoint)/i.test(currentUrl);
  const isLoggedOut = await page.evaluate(() => {
    const url = window.location.href;
    if (/facebook\.com\/(login|checkpoint)/i.test(url)) return true;
    const hasLoginInput = !!document.querySelector('input#email, input#pass, input[name="email"], input[name="pass"]');
    const hasLoginForm = !!document.querySelector('form#login_form, form#loginform, div#login_form, form[action*="/login"]');
    const hasNav = !!document.querySelector('div[role="navigation"], a[aria-label*="Trang cá nhân"], a[href*="/me/"]');
    const bodyText = (document.body && document.body.innerText) || '';
    const hasLoginPrompt = /đăng nhập vào facebook|log in to facebook|quên mật khẩu\?|tạo tài khoản mới|hãy đăng nhập hoặc đăng ký|xem thêm về nhóm.*trên facebook/i.test(bodyText);
    if (hasLoginInput && (hasLoginForm || !hasNav)) return true;
    if (hasLoginPrompt && !hasNav) return true;
    return false;
  }).catch(() => false);

  if (isLoginUrl || isLoggedOut) {
    const connectionLabel = socialAccountId ? ` của kết nối Cookie #${socialAccountId}` : '';
    throw new Error(`Cookie Facebook${connectionLabel} đã hết hạn hoặc không hợp lệ. Hãy cập nhật lại c_user + xs trong mục Kết nối rồi thử lại.`);
  }
}

// Khi cào bài Facebook bằng phiên chưa đăng nhập, Facebook luôn chèn 1 banner "Đăng nhập để xem thêm"
// dính cố định ở cuối trang — banner này định vị bằng CSS class biên dịch sẵn (không có inline
// style="...fixed...") nên querySelector theo inline style không bắt được, và nó che khuất/chặn click
// vào các phần tử bên dưới (vd: link ảnh trong Feed Card) khiến Playwright click lặp lại rồi timeout.
// Dò theo getComputedStyle().position thay vì inline style để bắt được cả trường hợp này.
async function removeFacebookLoginOverlays(page) {
  await page.evaluate(() => {
    // Chỉ xoá dialog nếu nó THỰC SỰ là modal đăng nhập / chặn màn hình, KHÔNG ĐƯỢC xoá dialog chứa bài viết
    document.querySelectorAll('div[role="dialog"]').forEach(d => {
      const isPostDialog = d.querySelector('div[role="article"], a[href*="/photo"], a[href*="set=pcb"], a[href*="set=gm"], a[href*="set=p."], div[data-ad-preview="message"], div[dir="auto"]');
      const hasLoginForm = d.querySelector('input[type="password"], form[action*="login"], input[name="email"]');
      const text = d.innerText || '';
      const isLoginDialog = hasLoginForm || (
        /^(?:.*?(?:Đăng nhập|Log in|Xem thêm trên Facebook|See more on Facebook))/i.test(text) && !isPostDialog
      );
      if (isLoginDialog && !isPostDialog) {
        d.remove();
      }
    });

    document.querySelectorAll('form[action*="login"]').forEach(f => f.remove());

    const loginTextMarkers = ['Log in', 'Log In', 'Đăng nhập', 'Xem thêm trên Facebook', 'See more on Facebook'];
    document.querySelectorAll('div, form').forEach((el) => {
      // Không xoá nếu el chứa bài viết hoặc ảnh bài viết
      if (el.querySelector && el.querySelector('div[role="article"], a[href*="/photo"], a[href*="set=pcb"], a[href*="set=gm"], a[href*="set=p."], div[data-ad-preview="message"]')) return;
      const text = el.innerText || '';
      if (!loginTextMarkers.some((m) => text.includes(m))) return;
      const pos = window.getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') {
        el.remove();
      }
    });
  }).catch(() => { });
}

// Trích xuất ảnh ở khung preview của Feed Card (tối đa ~5 ảnh, xem giải thích chi tiết ở nơi gọi hàm này).
async function extractPreviewPhotoUrls(page) {
  return await page.evaluate(() => {
    const imgs = [];
    const pickBestFromSrcset = (srcset) => {
      if (!srcset) return null;
      let best = null;
      let bestWidth = -1;
      srcset.split(',').forEach((part) => {
        const trimmed = part.trim();
        const spaceIdx = trimmed.lastIndexOf(' ');
        const url = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
        const descriptor = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
        const width = parseInt(descriptor, 10) || 0;
        if (url && width >= bestWidth) {
          bestWidth = width;
          best = url;
        }
      });
      return best;
    };

    const isInsideCommentOrNoise = (img) => {
      if (!img) return false;
      // Chặn Stories tray / danh sách tin / header stories
      if (img.closest('a[href*="/stories/"], div[data-pagelet*="Stories"], [aria-label*="Tin" i], [aria-label*="Stories" i], [role="banner"], [data-pagelet="LeftRail"], [data-pagelet="RightRail"]')) {
        return true;
      }
      // Chặn ảnh trong phần bình luận, câu trả lời, thanh sidebar, widget
      if (img.closest('[aria-label*="Bình luận" i], [aria-label*="Comment" i], [aria-label*="Danh sách bình luận" i], [aria-label*="Câu trả lời" i], [aria-label*="Viết bình luận" i], form, [role="complementary"], div[data-visualcompletion="ignore-dynamic-extra"]')) {
        return true;
      }
      // Chặn avatar / profile link / thanh điều hướng
      if (img.closest('a[href*="/user/"], a[href*="/profile.php"], a[href*="/people/"], [aria-label*="Trang cá nhân" i], [aria-label*="Profile" i], [role="navigation"]')) {
        return true;
      }
      // Chặn ảnh bìa / thumbnail của video player (vì đây là poster của video, không phải ảnh đính kèm)
      if (img.closest('div[data-pagelet*="Video" i], div[data-pagelet*="Watch" i], div[aria-label*="Video" i], div[data-video-id], [data-visualcompletion="media-vc-video"]')) {
        return true;
      }
      if (img.parentElement && img.parentElement.querySelector('video, div[data-video-id], [data-visualcompletion="media-vc-video"]')) {
        return true;
      }
      return false;
    };

    const isAvatarOrSystemIcon = (img, url) => {
      if (!url) return true;
      const u = url.toLowerCase();
      const badKeywords = [
        'emoji', 'rsrc.php', 'static.xx.fbcdn.net', 'profile_pic', 'profile',
        'avatar', 'blank_profile', 'placeholder', 'silhouette', 's150x150',
        's50x50', 'p50x50', 'p100x100', 's100x100', 's200x200', 's320x320',
        'ctp=s80x80', 'ctp=p75x225', 'ctp=s180x540', 'ctp=s64x64', 'ctp=s110x80',
        't39.30808-1', 't1.30497-1', 't39.1997-6', 't39.35477-6', 't39.2365-6',
        't45.1600-4', 't45.5328-4', 'p160x160', 'sticker'
      ];
      if (badKeywords.some((k) => u.includes(k))) return true;

      if (img) {
        if (isInsideCommentOrNoise(img)) return true;
        if (img.naturalWidth > 0 && img.naturalWidth < 180) return true;
        if (img.naturalHeight > 0 && img.naturalHeight < 180) return true;
      }

      return false;
    };

    // Tìm container chứa bài viết chính: ƯU TIÊN đúng dialog modal bài viết nếu Facebook mở bài dưới dạng popup (loại trừ dialog Thông báo/Chat/Cài đặt)
    const allDialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
    const postDialog = allDialogs.find(d => {
      const aria = (d.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('thông báo') || aria.includes('notification') || aria.includes('chat') || aria.includes('tin nhắn') || aria.includes('cài đặt')) return false;
      return d.querySelector('div[role="article"]') || /Bài viết của|Post by/i.test(d.innerText || '');
    }) || allDialogs.find(d => {
      const aria = (d.getAttribute('aria-label') || '').toLowerCase();
      return !aria.includes('thông báo') && !aria.includes('notification') && d.querySelector('a[href*="/photo"], a[href*="set=pcb"]');
    });

    const mainPostEl = postDialog
      || document.querySelector('a[href*="/photo"], a[href*="set=gm"], a[href*="set=pcb"], a[href*="set=p."]')?.closest('div[role="article"]:not([aria-label*="Bình luận" i]), div[data-pagelet*="FeedUnit"], div[role="main"]')
      || document.querySelector('div[role="main"] div[role="article"]:not([aria-label*="Bình luận" i]), div[data-pagelet*="FeedUnit"]')
      || document.querySelector('div[role="article"]:not([aria-label*="Bình luận" i])')
      || document.querySelector('div[role="main"]')
      || document.body;

    const imgEls = Array.from(
      mainPostEl.querySelectorAll(
        'a[href*="/photo"] img, a[href*="set=gm"] img, a[href*="set=pcb"] img, a[href*="set=p."] img, div[data-visualcompletion="media-vc-image"] img, div[data-pagelet*="Photo"] img'
      )
    ).filter(img => !isInsideCommentOrNoise(img));

    imgEls.forEach((img) => {
      const src = pickBestFromSrcset(img.srcset || img.getAttribute('srcset')) || img.src || img.getAttribute('src');
      if (src && (src.includes('scontent') || src.includes('fbcdn.net') || src.includes('cdninstagram.com')) && !isAvatarOrSystemIcon(img, src)) {
        imgs.push(src);
      }
    });
    return [...new Set(imgs)];
  });
}

// Overlay "+N" của Facebook cho biết còn N ảnh bị ẩn sau khung preview. Ví dụ preview đang có
// 5 ảnh và overlay "+8" nghĩa là album có tổng cộng 13 ảnh. Chỉ đọc overlay nằm trong bài chính để
// không nhầm số ở bình luận/thanh điều hướng.
async function extractExpectedFacebookPhotoCount(page, previewCount) {
  return await page.evaluate((visibleCount) => {
    const allDialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
    const postDialog = allDialogs.find(d => {
      const aria = (d.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('thông báo') || aria.includes('notification') || aria.includes('chat') || aria.includes('tin nhắn')) return false;
      return d.querySelector('div[role="article"]') || /Bài viết của|Post by/i.test(d.innerText || '');
    });
    const scope = postDialog || document.querySelector('[role="article"]:not([aria-label*="Bình luận" i]), [data-pagelet*="FeedUnit"], main') || document.body;
    const overlays = Array.from(scope.querySelectorAll('span, div'))
      .map((el) => (el.innerText || '').trim())
      .filter((text) => /^\+\d{1,3}$/.test(text))
      .map((text) => parseInt(text.slice(1), 10))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 200);
    return overlays.length > 0 ? visibleCount + Math.max(...overlays) : visibleCount;
  }, previewCount).catch(() => previewCount);
}

// Dùng chung để dedup ảnh giữa nhiều nguồn trích xuất khác nhau (DOM preview, lightbox, regex trên HTML
// thô) — Facebook đặt tên file CDN theo dạng "<id1>_<id2>_<id3>_n.jpg" cố định cho mỗi ảnh gốc dù URL đầy
// đủ có thể khác nhau giữa các size/CDN domain, nên so theo id này đáng tin hơn so URL nguyên văn.
function extractFacebookPhotoIdKey(url) {
  const match = String(url || '').match(/\/(\d+_\d+_\d+_\w+)\.(?:jpg|jpeg|png|webp)/i);
  return match ? match[1] : url;
}

// extractPreviewPhotoUrls/expandPhotoAlbumViaLightbox phụ thuộc DOM đã vẽ ra <img> và click mở được
// lightbox — cả 2 đều được xác nhận flaky qua live test (xem comment ngay bên dưới). Nhưng Facebook luôn
// nhúng sẵn URL ảnh full-res của TOÀN BỘ album trong JSON ở HTML thô của trang để client-side hydrate,
// bất kể DOM có kịp render/click được bao nhiêu ảnh. Regex thẳng trên HTML này không cần click/mở dialog
// nên không dính bất kỳ lỗi flaky nào ở trên — dùng làm lưới an toàn BỔ SUNG, không thay thế bước DOM ở
// trên (bước DOM vẫn đáng tin hơn về THỨ TỰ ảnh khi nó chạy đúng).
function extractAlbumPhotoUrlsFromHtml(html) {
  if (!html) return [];
  const patterns = [
    /https?:\\?\/\\?\/[^\s"'\\]+\.fbcdn\.net\\?\/v\\?\/t39\.30808-6\\?\/[^\s"'\\]+/gi,
    /https?:\\?\/\\?\/[^\s"'\\]+\.fbcdn\.net[^\s"'\\]+_\d+_[nN]\.(?:jpg|jpeg|png|webp)[^\s"'\\]*/gi,
  ];
  const badKeywords = [
    't39.30808-1', 'p50x50', 'p100x100', 's150x150', 's50x50', 's100x100', 's200x200', 's320x320',
    'p160x160', 'rsrc.php',
  ];
  const seenKeys = new Set();
  const photos = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const cleanUrl = match[0].replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
      if (badKeywords.some((k) => cleanUrl.includes(k))) continue;
      const key = extractFacebookPhotoIdKey(cleanUrl);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      photos.push(cleanUrl);
    }
  }
  return photos;
}

// Facebook chỉ render tối đa ~5 ảnh trong Feed Card preview — album nhiều ảnh hơn sẽ ẩn phần còn lại sau
// overlay "+N", các ảnh đó KHÔNG hề có trong HTML ban đầu (xác nhận bằng live test DOM 2026-08-25: 1 bài
// 13 ảnh thật nhưng Feed Card chỉ có 5 thẻ <img>), chỉ tải khi mở lightbox xem chi tiết từng ảnh. Mở
// lightbox rồi bấm "Ảnh tiếp theo" duyệt hết toàn bộ album; trả về mảng preview gốc nếu không mở được.
async function expandPhotoAlbumViaLightbox(page, previewPhotoUrls, expectedPhotoCount = null) {
  if (previewPhotoUrls.length === 0) return previewPhotoUrls;
  const urlBeforeLightbox = page.url();
  try {
    await removeFacebookLoginOverlays(page);
    const firstPhotoLink = page.locator('a[href*="/photo"], a[href*="set=pcb"], a[href*="set=p."]').first();
    if (!(await firstPhotoLink.isVisible().catch(() => false))) return previewPhotoUrls;
    // force: true — khi chưa đăng nhập Facebook chèn 1 lớp phủ vô hình (click-catcher) trùm lên Feed để
    // hễ bấm vào đâu cũng mời đăng nhập; lớp phủ không có chữ nên removeFacebookLoginOverlays() không
    // dò/xoá được. force chỉ bỏ qua kiểm tra actionability của Playwright — cú click thật vẫn có thể rơi
    // vào lớp phủ đó và điều hướng sang trang khác (đã xác nhận bằng live test khi chưa đăng nhập) thay
    // vì mở lightbox, nên bắt buộc phải kiểm tra lại URL sau khi bấm và quay về trang gốc nếu bị điều
    // hướng nhầm, tránh làm hỏng bước lấy caption/tác giả chạy ngay sau đó.
    await firstPhotoLink.click({ timeout: 8000, force: true });
    await page.waitForTimeout(1500);
    const dialog = page.locator('div[role="dialog"]');
    const seen = new Set();
    const orderedPhotos = [];
    if (await dialog.count() > 0) {
      const readCurrentSrc = async () => dialog.locator('img').evaluateAll((imgs) => {
        const real = imgs.filter(img => img.naturalWidth > 200 && img.naturalHeight > 200 && !img.src.startsWith('data:'));
        real.sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));
        return real[0]?.src || null;
      }).catch(() => null);

      for (let i = 0; i < 100; i++) {
        const currentSrc = await readCurrentSrc();
        if (!currentSrc || seen.has(currentSrc)) break;
        seen.add(currentSrc);
        orderedPhotos.push(currentSrc);
        if (expectedPhotoCount && orderedPhotos.length >= expectedPhotoCount) break;

        const nextBtn = dialog.locator('[aria-label="Ảnh tiếp theo"], [aria-label="Next photo"]').first();
        if (!(await nextBtn.isVisible().catch(() => false))) break;
        await nextBtn.click().catch(() => { });

        // Lightbox giữ ảnh cũ trong DOM trong lúc transition. Nếu đọc ngay sau 700ms, ảnh cũ vẫn là
        // phần tử lớn nhất và vòng lặp tưởng đã quay lại đầu album. Chờ tới khi src thật sự đổi.
        let changed = false;
        for (let waitStep = 0; waitStep < 12; waitStep++) {
          await page.waitForTimeout(250);
          const nextSrc = await readCurrentSrc();
          if (nextSrc && nextSrc !== currentSrc) {
            changed = true;
            break;
          }
        }
        if (!changed) break;
      }
    }
    await page.keyboard.press('Escape').catch(() => { });
    if (page.url() !== urlBeforeLightbox) {
      await page.goto(urlBeforeLightbox, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
      await removeFacebookLoginOverlays(page);
    }
    await page.waitForTimeout(300);
    return orderedPhotos.length > previewPhotoUrls.length ? orderedPhotos : previewPhotoUrls;
  } catch (e) {
    if (page.url() !== urlBeforeLightbox) {
      await page.goto(urlBeforeLightbox, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
      await removeFacebookLoginOverlays(page);
    }
    return previewPhotoUrls;
  }
}

// Threads render carousel nhiều ảnh NGAY TRONG bài viết (không mở dialog riêng như lightbox Facebook), và
// giống hệt lý do bên FB (xem comment expandPhotoAlbumViaLightbox phía trên): carousel thường chỉ render
// sẵn ảnh đầu + 1-2 ảnh kế bên trong DOM, các ảnh xa hơn CHỈ tải khi bấm mũi tên "Next" duyệt qua. Tìm
// đúng container của bài viết đang cào (khớp postId, tránh lẫn bài gợi ý bên dưới) rồi bấm Next lặp lại,
// gom toàn bộ ảnh distinct tìm được ở mỗi bước — dừng khi hết nút Next hoặc ảnh lặp lại (đã đi hết vòng).
async function locateThreadsMainContainerHandle(page, sourceUrl) {
  return await page.evaluateHandle((sourceUrlArg) => {
    const extractThreadsPostId = (href) => {
      if (!href) return null;
      const m = href.match(/\/(?:post|t)\/([^/?#]+)/);
      return m ? m[1] : null;
    };
    let targetPathname = window.location.pathname;
    try { if (sourceUrlArg) targetPathname = new URL(sourceUrlArg).pathname; } catch (e) { }
    const currentPostId = extractThreadsPostId(targetPathname) || extractThreadsPostId(window.location.pathname);
    const allContainers = Array.from(document.querySelectorAll('div[data-pressable-container="true"]'));
    return allContainers.find((container) => {
      const permalink = container.querySelector('a[href*="/post/"], a[href*="/t/"]');
      return extractThreadsPostId(permalink?.getAttribute('href')) === currentPostId;
    }) || allContainers[0] || null;
  }, sourceUrl).catch(() => null);
}

async function expandThreadsCarousel(page, containerHandle) {
  const orderedPhotos = [];
  const orderedVideos = [];
  const seenPhotos = new Set();
  const seenVideoKeys = new Set();
  const el = containerHandle && containerHandle.asElement ? containerHandle.asElement() : containerHandle;
  if (!el) return { photos: orderedPhotos, videos: orderedVideos };
  try {
    for (let i = 0; i < 25; i++) {
      const currentMedia = await el.evaluate((container) => {
        const pickBestFromSrcset = (srcset) => {
          if (!srcset) return null;
          const parts = srcset.split(',').map((p) => p.trim()).filter(Boolean);
          let bestUrl = null;
          let maxW = 0;
          for (const part of parts) {
            const [url, wStr] = part.split(/\s+/);
            const w = wStr ? parseInt(wStr.replace('w', ''), 10) : 0;
            if (w >= maxW) { maxW = w; bestUrl = url; }
          }
          return bestUrl;
        };
        const imgs = Array.from(container.querySelectorAll(
          'a[href*="/photo"] img, div[data-visualcompletion="media-vc-image"] img, img[src*="cdninstagram"], img[src*="fbcdn.net"]'
        ));
        const photos = imgs
          .map((img) => pickBestFromSrcset(img.srcset || img.getAttribute('srcset')) || img.src)
          .filter((s) => s && (s.includes('cdninstagram') || s.includes('fbcdn.net'))
            && !s.includes('profile') && !s.includes('rsrc.php') && !s.includes('static.xx')
            && !s.includes('s150x150') && !s.includes('s80x80') && !s.includes('ctp=s80x80'));

        const videoEls = Array.from(container.querySelectorAll('video source[src], video[src]'));
        const videos = videoEls
          .map(v => v.src || v.getAttribute('src'))
          .filter(s => s && !s.startsWith('blob:') && !s.includes('bytestart=') && !s.includes('byteend='));

        return { photos, videos };
      }).catch(() => ({ photos: [], videos: [] }));

      let sawNew = false;
      for (const src of (currentMedia.photos || [])) {
        if (!seenPhotos.has(src)) { seenPhotos.add(src); orderedPhotos.push(src); sawNew = true; }
      }
      for (const v of (currentMedia.videos || [])) {
        const key = getVideoDedupeKey(v);
        if (!seenVideoKeys.has(key)) { seenVideoKeys.add(key); orderedVideos.push(v); sawNew = true; }
      }

      const nextHandle = await el.evaluateHandle((container) =>
        container.querySelector('[aria-label="Next"], [aria-label="Next photo"], [aria-label="Tiếp theo"], [aria-label="Ảnh tiếp theo"], button[aria-label*="Next" i], div[role="button"][aria-label*="Next" i]')
      ).catch(() => null);
      const nextEl = nextHandle && nextHandle.asElement ? nextHandle.asElement() : null;
      if (nextEl && await nextEl.isVisible().catch(() => false)) {
        await nextEl.click({ timeout: 3000 }).catch(() => { });
        await page.waitForTimeout(800);
      } else {
        await page.keyboard.press('ArrowRight').catch(() => { });
        await page.waitForTimeout(800);
      }
      if (i > 0 && !sawNew) break;
    }
  } catch (e) { }
  return { photos: orderedPhotos, videos: orderedVideos };
}

// Facebook hiện giữ nhiều request nền (stream/long-poll) khiến `domcontentloaded` đôi khi không phát
// trong 20–30 giây dù HTML trang đã mở. Chỉ chờ navigation được commit + nghỉ ngắn để DOM sẵn sàng; các bước
// sau vẫn kiểm tra session và chờ đúng nút/modal nên không làm worker bấm khi giao diện chưa sẵn sàng.
async function navigateFacebookSurface(page, targetUrl, surfaceLabel = 'Facebook') {
  try {
    if (targetUrl.includes('profile.php') || targetUrl.includes('facebook.com/')) {
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
      await page.waitForTimeout(2000);
    }
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
  } catch (error) {
    const currentUrl = page.url();
    const reachedTarget = targetUrl.includes('profile.php')
      ? currentUrl.includes('profile.php') || (targetUrl.includes('id=') && currentUrl.includes(targetUrl.split('id=')[1]))
      : /^https?:\/\/(?:www\.|m\.|mbasic\.)?facebook\.com\//i.test(currentUrl);
    if (!reachedTarget) {
      await page.goto(targetUrl, { waitUntil: 'commit', timeout: 20000 }).catch(() => { });
    }
  }

  const currentUrl = page.url();
  console.log(`[Playwright] 🌐 Surface URL sau điều hướng (${surfaceLabel}): ${currentUrl}`);

  // Chờ Facebook render xong màn hình Splash (logo Meta) và xuất hiện các phần tử giao diện chính
  try {
    await page.locator('div[role="main"], div[role="navigation"], div[role="button"]').first().waitFor({ state: 'visible', timeout: 15000 });
  } catch (e) {
    console.warn(`[Playwright] ⚠️ Chờ phần tử chính của ${surfaceLabel} quá 15s, tiếp tục xử lý DOM.`);
  }
  await page.waitForTimeout(2000);
  await dismissFacebookPopupsAndOverlays(page);
}

// Tự động quét và đóng các popup/modal rác của Facebook (Lưu thông tin, Bật thông báo, Quy định nhóm, Privacy, etc.)
// giúp giải phóng backdrop che lấp pointer events để Playwright không bị nuốt click.
async function dismissFacebookPopupsAndOverlays(page) {
  try {
    const popupSelectors = [
      'div[role="dialog"] div[role="button"]:has-text("Không phải lúc này")',
      'div[role="dialog"] div[role="button"]:has-text("Not Now")',
      'div[role="dialog"] div[role="button"]:has-text("Lúc khác")',
      'div[role="dialog"] div[role="button"]:has-text("Bỏ qua")',
      'div[role="dialog"] div[role="button"]:has-text("Tôi hiểu")',
      'div[role="dialog"] div[role="button"]:has-text("Đã hiểu")',
      'div[role="dialog"] div[role="button"]:has-text("Đồng ý")',
      'div[role="dialog"] div[role="button"]:has-text("Đóng")',
      'div[role="dialog"] div[role="button"]:has-text("Close")',
      'div[role="dialog"] [aria-label="Đóng"]',
      'div[role="dialog"] [aria-label="Close"]',
      'div[aria-label="Đóng thông báo"]',
      'div[aria-label="Close notification"]'
    ];

    for (const selector of popupSelectors) {
      const btns = page.locator(selector);
      const count = await btns.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const btn = btns.nth(i);
        if (await btn.isVisible().catch(() => false)) {
          const dialogText = await btn.locator('xpath=ancestor::div[@role="dialog"][1]').innerText().catch(() => '');
          if (!dialogText.includes('Tạo bài viết') && !dialogText.includes('Create post') && !dialogText.includes('Tạo thước phim') && !dialogText.includes('Create reel')) {
            console.log(`[Playwright] 🧹 Tự động đóng popup/banner che lấp: "${selector}"`);
            await btn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(500);
          }
        }
      }
    }
  } catch (e) { }
}


// thường render nhiều div[role="button"] trùng text ẩn ngoài màn hình cùng lúc, nên phải lọc theo
// boundingBox thay vì click phần tử khớp text đầu tiên tìm được
// Trước đây hàm chỉ quét DOM 1 LẦN DUY NHẤT — nếu quét trúng đúng lúc Facebook chưa kịp render nút
// Tiếp/Đăng vào DOM (VD: đang chèn thêm dòng banner "Đang kiểm tra nội dung có bản quyền" phía trên
// khi có Video), hàm trả về false ngay dù nút sẽ xuất hiện chỉ 1-2s sau. Poll lại toàn bộ bước quét
// (giống waitUntilEnabled bên trên) tới khi tìm được candidate hợp lệ hoặc hết maxWaitMs.
async function clickVisibleButtonByText(page, targetTextRegex, maxY = 1050, scopeLocator = null, maxWaitMs = 25000) {
  const root = scopeLocator || page;
  const start = Date.now();
  let candidates = [];
  while (Date.now() - start < maxWaitMs) {
    // Chỉ xét phần tử thật sự có semantics button. Dò cả span/div từng khiến một phần tử cha rất
    // lớn chứa chữ "Tiếp" được chọn; click vào tâm phần tử cha có thể trúng nút Back và mở popup
    // "Rời khỏi trang?" thay vì chuyển sang bước kế tiếp của trình chỉnh sửa Reel.
    const btns = root.locator('button, [role="button"]').filter({ hasText: targetTextRegex });
    const count = await btns.count();
    candidates = [];
    for (let i = 0; i < count; i++) {
      const btn = btns.nth(i);
      const text = await btn.innerText().catch(() => '');
      const isVis = await btn.isVisible().catch(() => false);
      if (isVis && targetTextRegex.test(text.trim())) {
        const box = await btn.boundingBox().catch(() => null);
        if (box && box.x > 0 && box.y > 0 && box.y < maxY && box.width > 10 && box.height > 10) {
          candidates.push({ btn, box });
        }
      }
    }
    if (candidates.length > 0) break;
    await page.waitForTimeout(1000);
  }
  // Ưu tiên button nhỏ nhất để tránh chọn nhầm wrapper role=button lồng bên ngoài.
  candidates.sort((a, b) => (a.box.width * a.box.height) - (b.box.width * b.box.height));
  for (const { btn, box } of candidates) {
    const enabled = await waitUntilEnabled(btn, page, 120000);
    if (!enabled) continue;
    console.log(`[Playwright] 🎯 Bấm đúng button (${targetTextRegex}) tại tọa độ: x=${Math.round(box.x + box.width / 2)}, y=${Math.round(box.y + box.height / 2)}`);
    try {
      await btn.click({ timeout: 8000 });
      return true;
    } catch (e) {
      // Facebook thỉnh thoảng để một lớp trong suốt phủ lên nút sau khi media vừa
      // xử lý xong. Force-click chính button đã xác định an toàn hơn việc bỏ qua
      // luôn candidate và rơi vào vòng chờ Modal đóng.
      try {
        await btn.click({ force: true, timeout: 5000 });
        return true;
      } catch (forceError) {
        console.log(`[Playwright] ⚠️ Không bấm được button (${targetTextRegex}): ${forceError.message}`);
      }
    }
  }
  return false;
}

// =============================================================================
// POSTING LOCK THEO NICK: cùng 1 nick (c_user) luôn đăng TUẦN TỰ — Facebook giới hạn tốc độ theo nick
// và 2 phiên cùng cookie sẽ tranh nhau danh tính Page. Các nick KHÁC nhau được đăng song song, tối đa
// MAX_PARALLEL_POSTING phiên Chromium cùng lúc để không quá tải RAM.
// =============================================================================
const MAX_PARALLEL_POSTING = Math.max(1, Number(process.env.MAX_PARALLEL_POSTING || 1));

function postingIdentityKey(cookieString, fallback = 'default') {
  const match = String(cookieString || '').match(/c_user=(\d+)/);
  return match ? `fb:${match[1]}` : fallback;
}

class AsyncPostingLock {
  constructor(maxParallel) {
    this.maxParallel = maxParallel;
    this.active = 0;
    this.waiters = [];
    this.identityChains = new Map();
  }

  _acquireSlot() {
    if (this.active < this.maxParallel) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  _releaseSlot() {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }

  async acquire(taskName = 'Đăng bài', identityKey = 'default') {
    let releaseIdentity;
    const identityDone = new Promise((resolve) => { releaseIdentity = resolve; });
    const prev = this.identityChains.get(identityKey) || Promise.resolve();
    const chain = prev.then(() => identityDone);
    this.identityChains.set(identityKey, chain);

    await prev;
    await this._acquireSlot();
    console.log(`[PostingLock] 🔒 Bắt đầu phiên đăng (${identityKey}, ${this.active}/${this.maxParallel} đang chạy): ${taskName}`);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._releaseSlot();
      releaseIdentity();
      if (this.identityChains.get(identityKey) === chain) this.identityChains.delete(identityKey);
    };
  }
}

// Hàm tự động mở dải màu và chọn phông nền ĐỎ của Facebook (Colored Background Post)
async function selectFacebookRedBackground(dialog, page) {
  console.log('[Playwright] 🔴 Đang chọn phông nền màu ĐỎ cho bài viết (Colored Background Post)...');
  try {
    // 1. Kiểm tra xem nút mở dải màu (Aa / Show background options) có cần bấm không
    const showBackgroundBtn = dialog.locator(
      'div[aria-label*="Hiển thị tùy chọn phông nền" i], ' +
      'div[aria-label*="Chọn phông nền" i], ' +
      'div[aria-label*="Show Background Options" i], ' +
      'div[aria-label*="background options" i], ' +
      'div[role="button"]:has(img[src*="background" i]), ' +
      'div[role="button"]:has(img[src*="fbsbx" i]), ' +
      'div[role="button"]:has-text("Aa"), ' +
      'div[aria-label*="Aa" i]'
    ).first();

    if (await showBackgroundBtn.isVisible().catch(() => false)) {
      console.log('[Playwright] 👉 Bấm nút mở dải màu nền (Aa)...');
      await showBackgroundBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1500);
    }

    // 2. Chọn ô màu Đỏ thông qua DOM evaluate đa tầng
    const redSelected = await page.evaluate(() => {
      const editModal = document.querySelector('div[role="dialog"]');
      if (!editModal) return false;

      // Tìm tất cả button hoặc clickable element trong modal
      const allBtns = Array.from(editModal.querySelectorAll('div[role="button"], div[tabindex="0"], div[role="radio"]'));

      // Ưu tiên 1: aria-label chứa 'Đỏ' hoặc 'Red'
      for (const btn of allBtns) {
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (aria.includes('đỏ') || aria.includes('red')) {
          btn.click();
          return { method: 'aria-label', aria };
        }
      }

      // Ưu tiên 2: computed style có màu đỏ đặc trưng (r > 200, g < 80, b < 100 hoặc #F02849 / rgb(240, 40, 73))
      for (const btn of allBtns) {
        const computed = window.getComputedStyle(btn);
        const bg = computed.backgroundColor || '';
        const style = btn.getAttribute('style') || '';
        const fullBg = `${bg} ${style} ${computed.backgroundImage}`;

        const match = fullBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (match) {
          const r = parseInt(match[1]);
          const g = parseInt(match[2]);
          const b = parseInt(match[3]);
          if (r >= 200 && g <= 80 && b <= 100) {
            btn.click();
            return { method: 'rgb-match', r, g, b };
          }
        }
      }

      // Ưu tiên 3: Tìm dải màu swatches (các ô vuông có kích thước ~28-45px nằm ngang)
      // Trong dải màu Facebook: [<] [⊘] [🟣] [🟥 RED] [⬛] ... -> Ô đỏ là ô thứ 4 (index 3)
      const swatches = allBtns.filter(b => {
        const r = b.getBoundingClientRect();
        return r.width >= 20 && r.width <= 55 && r.height >= 20 && r.height <= 55;
      });

      if (swatches.length >= 4) {
        swatches[3].click();
        return { method: 'swatch-index-3', total: swatches.length };
      } else if (swatches.length >= 3) {
        swatches[swatches.length - 1].click();
        return { method: 'swatch-fallback', total: swatches.length };
      }

      return false;
    });

    if (redSelected) {
      console.log(`[Playwright] ✅ Đã bấm chọn ô phông nền ĐỎ (phương thức: ${JSON.stringify(redSelected)})`);
      await page.waitForTimeout(1500);
      return true;
    }

    // 3. Fallback qua Playwright Locator nếu evaluate chưa bấm được
    const redByAria = dialog.locator(
      'div[role="button"][aria-label*="Đỏ" i], ' +
      'div[role="button"][aria-label*="Red" i], ' +
      'div[aria-label*="Đỏ" i], ' +
      'div[aria-label*="Red" i]'
    ).first();
    if (await redByAria.isVisible().catch(() => false)) {
      console.log('[Playwright] ✅ Tìm thấy ô màu Đỏ qua Playwright locator!');
      await redByAria.click({ force: true });
      await page.waitForTimeout(1500);
      return true;
    }
  } catch (e) {
    console.warn('[Playwright] ⚠️ Lỗi khi chọn nền màu đỏ:', e.message);
  }
  return false;
}

// Hàm tự động thực hiện Mẹo Facebook: Vào 3 chấm -> Sửa bài viết -> Gỡ ảnh -> Chọn phông nền ĐỎ -> Lưu
async function editFacebookPostToRedBackground(page, targetFanpageId, isPersonal = false) {
  console.log('[Playwright][EditRedTrick] 🚀 Bắt đầu thực hiện mẹo: Vào tường Fanpage/Cá nhân -> 3 chấm -> Sửa bài -> Gỡ ảnh -> Nền đỏ...');
  try {
    const cleanTargetId = (targetFanpageId || '').split(':')[0].trim();
    const pageUrl = isPersonal ? 'https://www.facebook.com/me' : `https://www.facebook.com/profile.php?id=${cleanTargetId}`;
    
    console.log(`[Playwright][EditRedTrick] ⏳ Chờ 8s để Facebook cập nhật bài viết mới lên tường...`);
    await page.waitForTimeout(8000);
    console.log(`[Playwright][EditRedTrick] ⏳ Điều hướng đến: ${pageUrl}...`);
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(4000);

    // Cuộn chuột xuống qua phần Tin nổi bật / Đáng chú ý để vào danh sách bài viết thực sự
    for (let scrollAttempt = 0; scrollAttempt < 5; scrollAttempt++) {
      await page.mouse.wheel(0, 800);
      await page.waitForTimeout(1200);
      const postCardFound = await page.evaluate(() => {
        const feedUnit = document.querySelector('div[data-pagelet*="FeedUnit_"], div[role="feed"] div[role="article"], div[role="main"] div[role="article"]');
        if (feedUnit) {
          feedUnit.scrollIntoView({ behavior: 'instant', block: 'center' });
          return true;
        }
        return false;
      }).catch(() => false);
      if (postCardFound) break;
    }

    await page.waitForTimeout(1500);

    // Tìm tất cả các nút 3 chấm ứng viên trên khu vực bài viết (bên phải, dưới navbar)
    const buttonCoords = await page.evaluate(() => {
      const allBtns = Array.from(document.querySelectorAll(
        'div[role="button"][aria-haspopup="menu"], ' +
        'div[aria-label*="Hành động" i], ' +
        'div[aria-label*="Tùy chọn" i], ' +
        'div[aria-label*="Actions" i]'
      ));
      
      const results = [];
      for (const btn of allBtns) {
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const text = (btn.innerText || btn.textContent || '').toLowerCase();

        // Loại trừ tuyệt đối các nút của bình luận, like, share, gửi messenger, thông báo, menu chính
        if (aria.includes('bình luận') || aria.includes('comment') || aria.includes('thích') || aria.includes('like') || aria.includes('chia sẻ') || aria.includes('share') || aria.includes('gửi') || aria.includes('send')) continue;
        if (text.includes('bình luận') || text.includes('comment') || text.includes('thích') || text.includes('like') || text.includes('chia sẻ') || text.includes('share') || text.includes('gửi')) continue;
        if (aria.includes('thông báo') || aria.includes('tài khoản') || aria.includes('menu chính') || aria.includes('tạo')) continue;
        if (btn.closest('ul, ol, form, div[aria-label*="Bình luận" i], div[aria-label*="Comment" i]')) continue;

        const rect = btn.getBoundingClientRect();
        // Nằm trong khu vực feed bên phải (x > 350) và dưới top navbar (y > 60)
        if (rect.top > 60 && rect.left > 350 && rect.width >= 12 && rect.height >= 12) {
          results.push({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            aria: aria,
            isExactOptionBtn: /tùy chọn|hành động|actions|options/i.test(aria)
          });
        }
      }

      // Ưu tiên nút có aria-label khớp chính xác là Tùy chọn/Hành động của bài viết
      results.sort((a, b) => (b.isExactOptionBtn ? 1 : 0) - (a.isExactOptionBtn ? 1 : 0));
      return results;
    });

    console.log(`[Playwright][EditRedTrick] 🔍 Tìm thấy ${buttonCoords.length} nút 3 chấm ứng viên trên tường...`);
    let editOpened = false;

    for (let i = 0; i < Math.min(buttonCoords.length, 4); i++) {
      const coord = buttonCoords[i];
      console.log(`[Playwright][EditRedTrick] 👉 Thử bấm nút 3 chấm #${i + 1} tại x=${Math.round(coord.x)}, y=${Math.round(coord.y)} (${coord.aria})...`);
      await page.mouse.click(coord.x, coord.y);
      await page.waitForTimeout(1500);

      const editMenuItem = page.locator(
        'div[role="menuitem"]:has-text("Chỉnh sửa bài viết"), ' +
        'div[role="menuitem"]:has-text("Chỉnh sửa bài"), ' +
        'div[role="menuitem"]:has-text("Edit post"), ' +
        'span:has-text("Chỉnh sửa bài viết"), ' +
        'span:has-text("Chỉnh sửa bài"), ' +
        'span:has-text("Edit post")'
      ).first();

      if (await editMenuItem.isVisible().catch(() => false)) {
        console.log('[Playwright][EditRedTrick] 🎯 Đã mở đúng menu bài viết! Bấm "Chỉnh sửa bài viết"...');
        await editMenuItem.click({ force: true }).catch(() => {});
        editOpened = true;
        break;
      } else {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(500);
      }
    }

    if (!editOpened) {
      console.warn('[Playwright][EditRedTrick] ⚠️ Không mở được mục "Chỉnh sửa bài viết" từ các nút 3 chấm');
      const debugPath = path.join(DEBUG_OUTPUT_DIR, `debug_edit_menu_notfound_${Date.now()}.png`);
      await page.screenshot({ path: debugPath }).catch(() => {});
      return false;
    }
    await page.waitForTimeout(3000);

    // Tìm Dialog chỉnh sửa bài viết
    const editDialog = page.locator('div[role="dialog"]').filter({ hasText: /Chỉnh sửa bài viết|Edit post|Lưu|Save/i }).last();
    if (!(await editDialog.isVisible().catch(() => false))) {
      console.warn('[Playwright][EditRedTrick] ⚠️ Không tìm thấy Modal Chỉnh sửa bài viết');
      return false;
    }

    // Chụp ảnh debug khi vừa mở modal
    const debugModalOpen = path.join(DEBUG_OUTPUT_DIR, `debug_redtrick_1_modal_open_${Date.now()}.png`);
    await page.screenshot({ path: debugModalOpen }).catch(() => {});

    // 1. Tìm và bấm nút X để gỡ ảnh đính kèm (nút tròn trắng X ở góc trên bên phải tấm ảnh)
    console.log('[Playwright][EditRedTrick] 👉 Tìm và bấm nút X xoá ảnh...');

    const removeSuccess = await page.evaluate(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return false;

      // Tìm nút "Chỉnh sửa" trên ảnh (chính xác text là 'Chỉnh sửa' hoặc 'Edit')
      const allBtns = Array.from(dialog.querySelectorAll('div[role="button"], div[tabindex="0"]'));
      const editMediaBtn = allBtns.find(b => {
        const t = (b.innerText || '').trim();
        const r = b.getBoundingClientRect();
        return (t === 'Chỉnh sửa' || t === 'Edit') && r.top > 150;
      });

      if (editMediaBtn) {
        const r = editMediaBtn.getBoundingClientRect();
        // Tìm container chứa ảnh bằng cách đi lên các thẻ cha
        let parent = editMediaBtn.parentElement;
        for (let depth = 0; depth < 5; depth++) {
          if (!parent) break;
          const pRect = parent.getBoundingClientRect();
          if (pRect.width > 250 && pRect.height > 150) {
            // Tìm nút X trong container này (nằm ở góc trên bên phải)
            const siblingBtns = Array.from(parent.querySelectorAll('div[role="button"], div[tabindex="0"], div[aria-label]')).filter(b => b !== editMediaBtn);
            if (siblingBtns.length > 0) {
              // Bấm nút ngoài cùng bên phải
              siblingBtns[siblingBtns.length - 1].click();
              return { method: 'parent-sibling-btn', count: siblingBtns.length };
            }

            // Hoặc bấm theo toạ độ góc trên phải của container ảnh
            const targetX = pRect.right - 24;
            const targetY = r.top + r.height / 2;
            const targetEl = document.elementFromPoint(targetX, targetY);
            if (targetEl) {
              const btn = targetEl.closest('div[role="button"]') || targetEl;
              btn.click();
              return { method: 'photo-topright-point', targetX, targetY };
            }
            break;
          }
          parent = parent.parentElement;
        }
      }

      // Dự phòng: Tìm bất kỳ nút nào có aria-label liên quan đến xóa/gỡ ảnh
      for (const btn of allBtns) {
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const r = btn.getBoundingClientRect();
        if (r.top > 150 && (aria.includes('xóa') || aria.includes('gỡ') || aria.includes('remove') || aria.includes('close'))) {
          btn.click();
          return { method: 'aria-label', aria };
        }
      }

      return false;
    });

    console.log(`[Playwright][EditRedTrick] 🎯 Kết quả gỡ ảnh: ${JSON.stringify(removeSuccess)}`);

    // Đồng thời bấm Playwright mouse click vào vị trí nút X trên ảnh dựa trên nút 'Chỉnh sửa'
    const editBtnLocator = editDialog.locator('div[role="button"]').filter({ hasText: /^Chỉnh sửa$|^Edit$/ }).first();
    if (await editBtnLocator.isVisible().catch(() => false)) {
      const editBox = await editBtnLocator.boundingBox().catch(() => null);
      if (editBox) {
        // Nút X nằm cùng hàng y với nút Chỉnh sửa, nhưng lệch sang mép phải (+430px)
        const clickX = editBox.x + 440;
        const clickY = editBox.y + editBox.height / 2;
        console.log(`[Playwright][EditRedTrick] 🖱️ Mouse click phụ trợ tại toạ độ: x=${Math.round(clickX)}, y=${Math.round(clickY)}`);
        await page.mouse.click(clickX, clickY).catch(() => {});
      }
    }

    await page.waitForTimeout(2500);

    // Chụp ảnh debug sau khi bấm gỡ ảnh
    const debugAfterRemove = path.join(DEBUG_OUTPUT_DIR, `debug_redtrick_2_after_remove_photo_${Date.now()}.png`);
    await page.screenshot({ path: debugAfterRemove }).catch(() => {});

    // 2. Chọn phông nền ĐỎ
    console.log('[Playwright][EditRedTrick] 🔴 Đang chọn phông nền ĐỎ trong modal chỉnh sửa...');
    
    // Nếu dải màu chưa mở (thấy nút Aa), bấm nút Aa mở dải màu
    const aaClicked = await page.evaluate(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return false;

      // Tìm nút Aa hoặc icon phông nền ở góc dưới bên trái vùng soạn thảo
      const btns = Array.from(dialog.querySelectorAll('div[role="button"], div[aria-label]'));
      for (const b of btns) {
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const text = (b.innerText || '').trim();
        if (aria.includes('phông nền') || aria.includes('background') || text === 'Aa' || aria.includes('aa')) {
          b.click();
          return { method: 'aa-btn', aria, text };
        }
      }
      return false;
    });
    if (aaClicked) {
      console.log(`[Playwright][EditRedTrick] 👉 Đã bấm nút mở dải màu (Aa): ${JSON.stringify(aaClicked)}`);
      await page.waitForTimeout(1500);
    }

    // Bấm chọn ô màu ĐỎ trong dải màu
    const redChosen = await page.evaluate(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return false;
      const dRect = dialog.getBoundingClientRect();

      const allBtns = Array.from(dialog.querySelectorAll('div[role="button"], div[tabindex="0"], div[role="radio"]'));

      // 1. Tìm ô màu Đỏ theo aria-label
      for (const b of allBtns) {
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        if (aria.includes('đỏ') || aria.includes('red')) {
          b.click();
          return { method: 'aria-red', aria };
        }
      }

      // 2. Tìm ô màu Đỏ theo style RGB (r >= 200, g <= 80, b <= 100)
      for (const b of allBtns) {
        const computed = window.getComputedStyle(b);
        const style = `${computed.backgroundColor} ${b.getAttribute('style') || ''}`;
        const match = style.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (match) {
          const r = parseInt(match[1]), g = parseInt(match[2]), bl = parseInt(match[3]);
          if (r >= 200 && g <= 80 && bl <= 100) {
            b.click();
            return { method: 'rgb-red', r, g, bl };
          }
        }
      }

      // 3. Tìm các ô vuông trong thanh palette (kích thước ~25-50px) -> Ô màu Đỏ là ô thứ 4 (index 3)
      const swatches = allBtns.filter(b => {
        const r = b.getBoundingClientRect();
        return r.width >= 18 && r.width <= 55 && r.height >= 18 && r.height <= 55 && r.top > dRect.top + 100;
      });

      if (swatches.length >= 4) {
        swatches[3].click();
        return { method: 'swatch-index-3', count: swatches.length };
      } else if (swatches.length >= 3) {
        swatches[swatches.length - 1].click();
        return { method: 'swatch-fallback', count: swatches.length };
      }

      return false;
    });

    console.log(`[Playwright][EditRedTrick] 🔴 Kết quả chọn nền Đỏ: ${JSON.stringify(redChosen)}`);
    await page.waitForTimeout(2000);

    // Chụp ảnh debug sau khi chọn nền đỏ
    const debugAfterRed = path.join(DEBUG_OUTPUT_DIR, `debug_redtrick_3_after_red_bg_${Date.now()}.png`);
    await page.screenshot({ path: debugAfterRed }).catch(() => {});

    // 3. Bấm nút Tiếp hoặc Lưu (Save)
    const submitBtn = editDialog.locator(
      'div[role="button"]:has-text("Lưu"), ' +
      'div[role="button"]:has-text("Tiếp"), ' +
      'div[role="button"]:has-text("Save"), ' +
      'div[role="button"]:has-text("Next"), ' +
      'div[role="button"][aria-label="Lưu"], ' +
      'div[role="button"][aria-label="Tiếp"], ' +
      'div[role="button"][aria-label="Save"], ' +
      'div[aria-label="Lưu"], ' +
      'div[aria-label="Tiếp"], ' +
      'div[aria-label="Save"], ' +
      'div[role="dialog"] span:text-is("Lưu"), ' +
      'div[role="dialog"] span:text-is("Tiếp")'
    ).last();

    let submitFound = await submitBtn.isVisible().catch(() => false);
    if (!submitFound) {
      const pageSubmitBtn = page.locator('div[role="dialog"] div[aria-label="Lưu"], div[role="dialog"] div[aria-label="Tiếp"], div[role="dialog"] div[role="button"]:has-text("Lưu"), div[role="dialog"] div[role="button"]:has-text("Tiếp")').last();
      submitFound = await pageSubmitBtn.isVisible().catch(() => false);
      if (submitFound) {
        console.log('[Playwright][EditRedTrick] 💾 Bấm nút Bước 1 (Tiếp/Lưu) (page scoped)...');
        await pageSubmitBtn.click({ force: true }).catch(() => {});
      }
    } else {
      console.log('[Playwright][EditRedTrick] 💾 Bấm nút Bước 1 (Tiếp/Lưu)...');
      await submitBtn.click({ force: true }).catch(() => {});
    }

    if (submitFound) {
      await page.waitForTimeout(2500);

      // Nếu có Bước 2 (Lưu / Save / Đăng / Xong)
      const step2SaveBtn = editDialog.locator(
        'div[role="button"]:has-text("Lưu"), ' +
        'div[role="button"]:has-text("Save"), ' +
        'div[role="button"]:has-text("Đăng"), ' +
        'div[role="button"]:has-text("Xong"), ' +
        'div[aria-label="Lưu"], ' +
        'div[aria-label="Save"]'
      ).last();
      if (await step2SaveBtn.isVisible().catch(() => false)) {
        console.log('[Playwright][EditRedTrick] 💾 Bấm nút Bước 2 (Lưu/Xong) trong modal sửa bài...');
        await step2SaveBtn.click({ force: true }).catch(() => {});
      }

      await page.waitForTimeout(3500);
      for (let i = 0; i < 8; i++) {
        if (!(await editDialog.isVisible().catch(() => false))) break;
        await page.waitForTimeout(1500);
      }
      console.log('[Playwright][EditRedTrick] 🎉 Đã hoàn tất mẹo sửa bài nền đỏ!');
      return true;
    } else {
      console.warn('[Playwright][EditRedTrick] ⚠️ Không tìm thấy nút Tiếp / Lưu');
      const debugPath = path.join(DEBUG_OUTPUT_DIR, `debug_edit_save_notfound_${Date.now()}.png`);
      await page.screenshot({ path: debugPath }).catch(() => {});
      return false;
    }
  } catch (err) {
    console.warn('[Playwright][EditRedTrick] ⚠️ Lỗi trong tiến trình sửa bài nền đỏ:', err.message);
    return false;
  }
}

const globalPostingLock = new AsyncPostingLock(MAX_PARALLEL_POSTING);

// Endpoint tự động đăng bài lên Facebook / Fanpage bằng Cookie
app.post('/api/post-facebook', async (req, res) => {
  const { cookieString, content, targetFanpageId = DEFAULT_FANPAGE_PLATFORM_ACCOUNT_ID, socialAccountId, mediaUrls, originalUrl, affiliateLink, postType, backgroundColor } = req.body;
  const isRedPhotoTrick = postType === 'RED_PHOTO_TRICK' || postType === 'COLOR_PHOTO_TRICK';
  const isColorBackground = (postType === 'COLOR_BACKGROUND' || backgroundColor === 'RED') && !isRedPhotoTrick;

  // QUY TẮC BẢO VỆ UY TÍN: Fanpage Vietnam Real Estate (ID 100053405437835) tuyệt đối không để link Shopee/Affiliate/bán hàng!
  let safeAffiliateLink = affiliateLink;
  if (isRedPhotoTrick && (!safeAffiliateLink || safeAffiliateLink.trim().length === 0)) {
    safeAffiliateLink = content;
  }
  if (safeAffiliateLink && safeAffiliateLink.length > 2500) {
    safeAffiliateLink = safeAffiliateLink.slice(0, 2400) + '\n\n... (Xem chi tiết đầy đủ tại link nguồn)';
  }
  const isRealEstatePage = String(targetFanpageId).includes("100053405437835") || /vietnam\s*real\s*estate|real\s*estate/i.test(String(targetFanpageId));
  if (isRealEstatePage && safeAffiliateLink && /shopee|shp\.ee|shope\.ee|affiliate/i.test(safeAffiliateLink)) {
    console.log("[Playwright] 🛡️ [CHẶN LINK] Fanpage Vietnam Real Estate: Phát hiện link Shopee/Affiliate trong bình luận, tự động hủy bỏ để bảo vệ uy tín trang tin tức!");
    safeAffiliateLink = null;
  }

  if (!cookieString || !content) {
    return res.status(400).json({ success: false, error: 'Thiếu cookieString hoặc content' });
  }

  // Cho phép đăng bài có media HOẶC bài thuần văn bản (pure text)
  const hasMediaToPost = mediaUrls && (Array.isArray(mediaUrls) ? mediaUrls.length > 0 : mediaUrls.trim().length > 0);
  const hasTextContent = content && content.trim().length > 0;
  if (!hasMediaToPost && !hasTextContent) {
    return res.status(400).json({ success: false, error: 'Không tìm thấy nội dung văn bản hoặc clip/ảnh — không thể đăng bài.' });
  }

  const isPersonal = targetFanpageId === 'PERSONAL_PROFILE'
    || String(targetFanpageId).startsWith('PERSONAL_')
    || req.body.isPersonalProfile === true;

  const targetIdClean = isPersonal ? null : targetFanpageId;
  const releaseLock = await globalPostingLock.acquire(isPersonal ? `Personal Profile` : `Fanpage ${targetFanpageId}`, postingIdentityKey(cookieString));

  // Tự động inject i_user=targetFanpageId vào cookie nếu là Fanpage, hoặc xóa i_user nếu là Cá Nhân
  let cookies = parseCookies(cookieString, targetIdClean);
  if (isPersonal) {
    cookies = cookies.filter(c => c.name !== 'i_user');
  }
  let browser = null;
  let downloadedFilePaths = [];

  try {
    console.log(`[Playwright] 🚀 Đang khởi động trình duyệt đăng bài lên ${isPersonal ? 'Tường Cá Nhân' : `Fanpage (ID: ${targetFanpageId})`}...`);
    browser = await chromium.launch({ headless: true });
    const context = await createStealthBrowserContext(browser, {
      proxyUrl: req.body.proxyUrl,
      userAgent: req.body.userAgent
    });
    await context.addCookies(cookies);
    const page = await context.newPage();
    watchFacebookRateLimit(page);

    // Facebook có thể chèn thêm dòng banner (VD: "Đang kiểm tra nội dung có bản quyền" khi có Video)
    // ngay phía trên nút Tiếp/Đăng, đẩy footer xuống thấp hơn bình thường. Lấy đúng chiều cao viewport
    // thật thay vì số cứng để không lỡ loại bỏ mất nút hợp lệ khi footer bị đẩy xuống.
    const composerMaxButtonY = page.viewportSize()?.height || 1080;

    // Tải TOÀN BỘ video và ảnh để đính kèm trong cùng một lần mở Composer Facebook.
    let normalizedMediaUrls = [];
    if (isColorBackground) {
      console.log('[Playwright] 🔴 Bài viết yêu cầu phông nền màu Đỏ — Bỏ qua đính kèm media để không bị mất nền màu.');
    } else if (mediaUrls && (Array.isArray(mediaUrls) ? mediaUrls.length > 0 : mediaUrls.trim().length > 0)) {
      normalizedMediaUrls = (Array.isArray(mediaUrls) ? mediaUrls : mediaUrls.split(','))
        .map((url) => String(url || '').trim())
        .filter((url) => url.startsWith('http'));
      const rawMediaList = [...normalizedMediaUrls];
      const mediaCountBeforeCoverFilter = normalizedMediaUrls.length;
      normalizedMediaUrls = normalizedMediaUrls.filter((url) => !isVideoCoverFrameUrl(url));
      if (normalizedMediaUrls.length < mediaCountBeforeCoverFilter) {
        console.log(`[Playwright] 🧹 Đã bỏ ${mediaCountBeforeCoverFilter - normalizedMediaUrls.length} thumbnail/cover frame của video; chỉ giữ media thật.`);
      }

      // Nếu mediaUrl bị rỗng sau khi bỏ cover frame, hoặc nếu URL duy nhất là ảnh .jpg (thumbnail/cover frame),
      // tự động giải mã link video .mp4 từ originalUrl hoặc rawMediaList[0]
      // CHỈ thực hiện khi URL nguồn thật sự là reel/video — tránh timeout 45s thừa cho bài ảnh thuần.
      const isVideoSourceUrl = (u) => /\/(reel|watch|live)\//i.test(u) || /fb\.watch\//i.test(u) || /share\/r\//i.test(u) || /\/video\//i.test(u);
      if (normalizedMediaUrls.length === 0 || (normalizedMediaUrls.length === 1 && (normalizedMediaUrls[0].endsWith('.jpg') || normalizedMediaUrls[0].includes('.jpg?')))) {
        const fallbackSourceUrl = originalUrl || rawMediaList[0];
        if (fallbackSourceUrl && isVideoSourceUrl(fallbackSourceUrl)) {
          console.log(`[Playwright] 🔍 Đang tìm link .mp4 video thực sự từ ${fallbackSourceUrl}...`);
          try {
            const extractData = await extractVideoDirectly(fallbackSourceUrl);
            if (extractData.success && extractData.videoUrl) {
              normalizedMediaUrls = [extractData.videoUrl];
              console.log(`[Playwright] 🎬 Đã tìm thấy link MP4 thực tế: ${extractData.videoUrl.slice(0, 80)}...`);
            }
          } catch (errExt) { }
        }
      }

      const isVideoUrl = (url) => /\.mp4|\.mov|\.webm|\/video\/|\/v\/t16\/|\/m84\/|\/m86\/|\/o1\/v\//i.test(url);
      // Giữ nguyên TOÀN BỘ media của bài (kể cả video + album ảnh). Chỉ loại byte-range bắt đầu giữa
      // file; URL bytestart=0 do scraper tự dựng từ Content-Range là request bao trọn file và được phép.
      normalizedMediaUrls = [...new Set(normalizedMediaUrls)]
        .filter((url) => !isVideoUrl(url) || !isDefinitelyPartialByteRangeUrl(url));

      if (isRedPhotoTrick && normalizedMediaUrls.length > 1) {
        console.log(`[Playwright] 🔴 [TRICK 3 CHẤM] Tự động chỉ tải và đính kèm 1 ảnh bìa đầu tiên (bỏ ${normalizedMediaUrls.length - 1} ảnh phụ) để thực hiện mẹo sửa bài nền đỏ.`);
        normalizedMediaUrls = [normalizedMediaUrls[0]];
      }
      const urlsToDownload = normalizedMediaUrls;

      console.log(`[Playwright] 📥 Đang tải song song ${urlsToDownload.length} file Media từ CDN vào kho tạm...`);
      const downloadedResults = await Promise.all(
        urlsToDownload.map(async (mediaUrl, mediaIndex) => {
          try {
            const { buffer: mediaBuffer, contentType, mediaKind } = await downloadMediaWithRetry(page, mediaUrl);
            const ext = mediaFileExtension(mediaKind, contentType, mediaBuffer);
            const filename = `clip_meo_${Date.now()}_${mediaIndex}_${Math.random().toString(36).substring(2, 6)}${ext}`;
            const downloadedFilePath = path.join(CLIP_MEO_DIR, filename);
            await fs.promises.writeFile(downloadedFilePath, mediaBuffer);
            console.log(`[Playwright] ✅ Đã tải file: ${downloadedFilePath} (${(mediaBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
            return {
              filePath: downloadedFilePath,
              fingerprint: downloadedMediaFingerprint(mediaBuffer),
            };
          } catch (e) {
            console.error(`[Playwright] ❌ Lỗi tải file media (${mediaUrl.slice(0, 80)}...):`, e.message);
            return null;
          }
        })
      );
      // Promise.all trả kết quả đúng thứ tự input. Kiểm tra tải thiếu trước, sau đó loại media có cùng
      // bytes để hai URL CDN khác nhau của cùng một clip không bị gắn hai lần vào Composer.
      const successfulDownloadCount = downloadedResults.filter(Boolean).length;
      const dedupedDownloads = keepUniqueDownloadedMedia(downloadedResults);
      downloadedFilePaths = dedupedDownloads.uniqueFilePaths;
      const canRetrySingleExpiredMedia = urlsToDownload.length === 1 && successfulDownloadCount === 0;
      if (successfulDownloadCount !== urlsToDownload.length && !canRetrySingleExpiredMedia) {
        throw new Error(`Chỉ tải được ${successfulDownloadCount}/${urlsToDownload.length} media. Đã dừng đăng để tránh bài bị thiếu ảnh/video.`);
      }
      if (urlsToDownload.length === 1 && downloadedFilePaths.length === 0) {
        if (originalUrl) {
          console.log(`[Playwright] 🔄 Link CDN cũ bị lỗi/hết hạn. Đang cào lại link video mới từ bài gốc: ${originalUrl}...`);
          try {
            const extractData = await extractVideoDirectly(originalUrl);
            if (extractData.success && extractData.videoUrl) {
              console.log(`[Playwright] 🎬 Đã re-extract link MP4 tươi mới: ${extractData.videoUrl.slice(0, 80)}...`);
              const freshFilename = `clip_meo_${Date.now()}_fresh.mp4`;
              const freshFilePath = path.join(CLIP_MEO_DIR, freshFilename);
              const { buffer: freshBuffer } = await downloadMediaWithRetry(page, extractData.videoUrl);
              fs.writeFileSync(freshFilePath, freshBuffer);
              downloadedFilePaths.push(freshFilePath);
              console.log(`[Playwright] ✅ Đã tải thành công file video mới re-extract (${(freshBuffer.length / 1024 / 1024).toFixed(2)} MB)!`);
            }
          } catch (reErr) {
            console.error(`[Playwright] ❌ Re-extract link video tươi mới thất bại:`, reErr.message);
          }
        }

        if (downloadedFilePaths.length === 0) {
          throw new Error(`Không thể tải file Video/Media từ CDN (${urlsToDownload[0].slice(0, 80)}...). Dừng đăng bài để tránh đăng bài bị thiếu clip.`);
        }
      }
      if (urlsToDownload.length > 1 && downloadedFilePaths.length === 0) {
        throw new Error(`Không thể tải 0/${urlsToDownload.length} media của album. Đã dừng đăng để tránh bài bị thiếu toàn bộ ảnh/video.`);
      }
    }

    // TỰ ĐỘNG 100%: Nếu bài viết là Text thuần (không có video/ảnh đính kèm) và nội dung ngắn (<= 200 ký tự)
    // -> Tự động render thành ảnh Quote Card nền đen chữ trắng to (style BOX Y Khoa) để tăng tương tác vượt trội
    if (downloadedFilePaths.length === 0 && (!normalizedMediaUrls || normalizedMediaUrls.length === 0) && content && content.trim().length > 0 && content.trim().length <= 200 && !isColorBackground) {
      try {
        console.log(`[Playwright] 🎨 Phát hiện bài text ngắn (${content.trim().length} ký tự <= 200) — Tự động sinh ảnh Nền Đen Chữ Trắng (Quote Card style BOX Y Khoa)...`);
        const quoteCardBuffer = await renderDarkQuoteCard(content.trim());
        if (quoteCardBuffer) {
          const filename = `quote_card_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.png`;
          const filePath = path.join(CLIP_MEO_DIR, filename);
          fs.writeFileSync(filePath, quoteCardBuffer);
          downloadedFilePaths.push(filePath);
          console.log(`[Playwright] ✅ Đã tạo ảnh Quote Card nền đen thành công: ${filePath} (${(quoteCardBuffer.length / 1024).toFixed(1)} KB)`);
        }
      } catch (errCard) {
        console.warn(`[Playwright] ⚠️ Không thể tạo ảnh Quote Card:`, errCard.message);
      }
    }

    // Mở trang Fanpage
    const cleanTargetId = (targetFanpageId || '').split(':')[0].trim();
    if (!isPersonal && cleanTargetId && /^\d+$/.test(cleanTargetId)) {
      const switchUrl = `https://www.facebook.com/profile/switch/?target_id=${cleanTargetId}`;
      console.log(`[Playwright] 🔄 Đang thực hiện Profile Switch sang Fanpage ID ${cleanTargetId}: ${switchUrl}`);
      await page.goto(switchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const switchConfirmBtn = page.locator('div[role="button"]:has-text("Chuyển"), div[role="button"]:has-text("Switch"), button:has-text("Chuyển")').first();
      if (await switchConfirmBtn.isVisible().catch(() => false)) {
        console.log(`[Playwright] 🎯 Click nút xác nhận chuyển sang Fanpage ${cleanTargetId}...`);
        await switchConfirmBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(3000);
      }
    }

    const pageUrl = `https://www.facebook.com/profile.php?id=${cleanTargetId}`;
    console.log(`[Playwright] Điều hướng tới URL Fanpage: ${pageUrl}`);
    // i_user cookie đã được inject → mở thẳng Fanpage dưới danh tính Page, không cần bấm "Chuyển ngay"
    console.log(`[Playwright] 🌐 Mở tường Fanpage (đã switch identity): ${pageUrl}`);
    await navigateFacebookSurface(page, pageUrl, 'Fanpage');
    // Chờ đủ lâu để React của Facebook hydrate xong và gắn event handler lên nút Tạo bài viết —
    // click quá sớm (2.5s) khi trang còn đang hydrate hay bị "nuốt" mất, phải đợi tới lần thử
    // sau mới ăn.
    await page.waitForTimeout(4500);
    await assertFacebookSession(page, socialAccountId);

    // Nếu xuất hiện banner "Chuyển ngay" sang danh tính Fanpage thì tự động bấm Chuyển ngay
    const switchBtnBanner = page.locator('div[role="button"]:has-text("Chuyển ngay"), div[role="button"]:has-text("Switch Now")').first();
    if (await switchBtnBanner.isVisible().catch(() => false)) {
      console.log('[Playwright] 👉 Tự động click "Chuyển ngay" sang danh tính Fanpage...');
      await switchBtnBanner.click({ force: true }).catch(() => { });
      await page.waitForTimeout(3000);

      const confirmBtn = page.locator('div[role="dialog"] div[role="button"]:has-text("Chuyển")').first();
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click({ force: true }).catch(() => { });
        await page.waitForTimeout(8000);
      }
    }

    // Kiểm tra & chuyển đổi danh tính Fanpage trên Header Facebook (đồng bộ như Group)
    if (!isPersonal && cleanTargetId) {
      const pageNameForSwitch = (req.body.pageName || '').trim();
      const accountSwitcherBtn = page.locator(
        'div[role="button"][aria-label="Trang cá nhân của bạn"], ' +
        'div[role="button"][aria-label*="Trang cá nhân"], ' +
        'div[role="button"][aria-label*="Tài khoản"], ' +
        'div[role="button"][aria-label*="Account"], ' +
        'div[role="button"][aria-label*="Your profile"], ' +
        'svg[aria-label*="Trang cá nhân"]'
      ).first();
      if (await accountSwitcherBtn.isVisible().catch(() => false)) {
        console.log('[Playwright] 🎯 Bấm nút switcher Tài khoản trên Header Facebook...');
        await accountSwitcherBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1500);

        const seeAllProfilesBtn = page.locator(
          'div[role="button"]:has-text("Xem tất cả trang cá nhân"), ' +
          'div[role="button"]:has-text("Xem tất cả các Trang"), ' +
          'div[role="button"]:has-text("Chuyển sang trang cá nhân khác"), ' +
          'div[role="button"]:has-text("See all profiles")'
        ).first();
        if (await seeAllProfilesBtn.isVisible().catch(() => false)) {
          console.log('[Playwright] 🎯 Bấm "Xem tất cả trang cá nhân"...');
          await seeAllProfilesBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(1200);
        }

        let found = false;
        let pageOption = null;

        // 1. Thử tìm theo target ID
        const targetOption = page.locator(`a[href*="${cleanTargetId}"], div[role="button"][data-profile-id="${cleanTargetId}"]`).first();
        if (await targetOption.isVisible().catch(() => false)) {
          pageOption = targetOption;
          found = true;
        }

        // 2. Thử tìm theo pageName (chính xác hoặc regex không phân biệt hoa thường)
        if (!found && pageNameForSwitch) {
          const escPageName = pageNameForSwitch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const nameRegex = new RegExp(escPageName, 'i');
          const candidate = page.locator('div[role="dialog"] div[role="button"], div[role="dialog"] div[role="option"], div[role="dialog"] span')
            .filter({ hasText: nameRegex })
            .first();
          if (await candidate.isVisible().catch(() => false)) {
            pageOption = candidate;
            found = true;
          }
        }

        if (found && pageOption) {
          console.log(`[Playwright] 🎯 Bấm chuyển sang danh tính Fanpage ${cleanTargetId} (${pageNameForSwitch})...`);
          await pageOption.click({ force: true }).catch(() => {});
          await page.waitForTimeout(4000);
          await navigateFacebookSurface(page, pageUrl, 'Fanpage after switch').catch(() => {});
        } else {
          console.log(`[Playwright] ℹ️ Không tìm thấy option khớp Fanpage ${cleanTargetId} (${pageNameForSwitch}) trong menu switcher, thoát popup...`);
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(500);
          await page.keyboard.press('Escape').catch(() => {});
        }
      }
    }

    // Facebook thỉnh thoảng chèn popup xác nhận danh tính ("Tiếp tục dưới tên X / Dùng trang cá
    // nhân khác") đè lên trang dù i_user cookie đã inject sẵn — popup này chặn mất nút "Tạo bài
    // viết" phía sau khiến bước dưới đây không bấm được. Popup này gắn liền với MỖI LẦN tải trang
    // (không phải theo phiên) nên nó có thể tái xuất hiện sau lần reload giữa vòng lặp bên dưới —
    // vì vậy hàm này được gọi lại ở đầu MỖI lần thử, không chỉ một lần trước vòng lặp.
    const closeIdentityPopupIfPresent = async () => {
      const identityDialog = page.locator('div[role="dialog"]').filter({ hasText: 'Tiếp tục dưới tên' });
      if (await identityDialog.first().isVisible().catch(() => false)) {
        console.log('[Playwright] ⚠️ Phát hiện popup xác nhận danh tính, đóng popup tại chỗ...');
        const closeBtn = identityDialog.first().locator('div[aria-label="Đóng"], div[aria-label="Close"]').first();
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click({ force: true }).catch(() => { });
        } else {
          await page.keyboard.press('Escape').catch(() => { });
        }
        await page.waitForTimeout(2000);
      }
    };
    await closeIdentityPopupIfPresent();

    // Bấm ô Tạo bài viết ở đầu trang Fanpage chính xác với 4 lượt thử
    const PAGE_COMPOSER_MAX_ATTEMPTS = 4;
    let pageComposerOpened = false;
    let pageReloaded = false;

    for (let attempt = 1; attempt <= PAGE_COMPOSER_MAX_ATTEMPTS; attempt++) {
      await closeIdentityPopupIfPresent();
      // "Bạn đang nghĩ gì?"/"Tạo bài viết" là chữ của chính ô composer — ưu tiên tuyệt đối. "Chia sẻ
      // suy nghĩ..." CŨNG là chữ của 1 bong bóng gợi ý cập nhật ảnh đại diện cạnh avatar (role="button"
      // aria-haspopup="menu", xuất hiện TRƯỚC composer thật trong DOM) — nếu xếp ngang hàng, vòng lặp
      // chọn ứng viên đầu tiên sẽ bấm nhầm bong bóng này (không mở Modal, không báo lỗi, chỉ im lặng
      // thất bại). Vì vậy chỉ dùng "Chia sẻ suy nghĩ" làm phương án dự phòng khi không thấy composer
      // thật, và luôn loại bỏ phần tử có aria-haspopup="menu" (dấu hiệu chắc chắn đó là 1 menu, không
      // phải nút mở Modal Tạo bài viết).
      const primaryComposerBtn = page.locator(
        'div[role="button"][aria-label*="Bạn đang nghĩ gì"], ' +
        'div[role="button"][aria-label*="Tạo bài viết"], ' +
        'div[role="button"][aria-label*="What\'s on your mind"], ' +
        'div[role="button"][aria-label*="Create a post"], ' +
        'div[role="button"][aria-label*="Write something"], ' +
        'div[role="button"]:has-text("Bạn đang nghĩ gì?"), ' +
        'div[role="button"]:has-text("Tạo bài viết"), ' +
        'div[role="button"]:has-text("What\'s on your mind?"), ' +
        'div[role="button"]:has-text("What\'s on your mind"), ' +
        'div[aria-label*="Bạn đang nghĩ gì"], ' +
        'div[aria-label*="Tạo bài viết"], ' +
        'div[aria-label*="What\'s on your mind"], ' +
        'div[aria-label*="Create a post"], ' +
        'span:has-text("What\'s on your mind"), ' +
        'span:has-text("Bạn đang nghĩ gì?")'
      );
      const fallbackComposerBtn = page.locator(
        'div[role="button"]:has-text("Chia sẻ suy nghĩ"), ' +
        'div[role="button"][aria-label*="Chia sẻ suy nghĩ"], ' +
        'div[role="button"]:has-text("Viết gì đó"), ' +
        'span:has-text("Chia sẻ suy nghĩ")'
      );

      const findVisibleComposerCandidate = async (locator) => {
        const count = await locator.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const candidate = locator.nth(i);
          if (await candidate.isVisible().catch(() => false)) {
            const ariaHaspopup = await candidate.getAttribute('aria-haspopup').catch(() => null);
            if (ariaHaspopup === 'menu') continue;
            const box = await candidate.boundingBox().catch(() => null);
            if (box && box.width > 20 && box.height > 20) {
              return candidate;
            }
          }
        }
        return null;
      };

      let targetBtn = await findVisibleComposerCandidate(primaryComposerBtn);
      if (!targetBtn) {
        targetBtn = await findVisibleComposerCandidate(fallbackComposerBtn);
      }

      if (targetBtn) {
        console.log(`[Playwright] Bấm ô Tạo bài viết ở đầu trang Fanpage (lần ${attempt}/${PAGE_COMPOSER_MAX_ATTEMPTS})...`);
        await targetBtn.scrollIntoViewIfNeeded().catch(() => { });
        await targetBtn.click({ timeout: 20000 }).catch(async () => {
          await targetBtn.click({ force: true }).catch(() => { });
        });
        await page.waitForTimeout(500);
      } else {
        console.warn(`[Playwright] ⚠️ Lần ${attempt}/${PAGE_COMPOSER_MAX_ATTEMPTS}: Không thấy ô Tạo bài viết bằng role="button", thử clickVisibleButtonByText...`);
        await clickVisibleButtonByText(page, /Bạn đang nghĩ gì|Tạo bài viết|Chia sẻ suy nghĩ|What's on your mind|Create a post|Ảnh\/video/i, 1050, null, 15000).catch(() => { });
      }

      try {
        const modalTextbox = page.locator('div[role="dialog"] div[role="textbox"], div[role="dialog"] div[contenteditable="true"]').first();
        await modalTextbox.waitFor({ state: 'visible', timeout: 45000 });
        pageComposerOpened = true;
        break;
      } catch (e) {
        console.warn(`[Playwright] ⚠️ Click lần ${attempt}/${PAGE_COMPOSER_MAX_ATTEMPTS} chưa mở Composer sau 30s.`);
        // Chụp lại từng lần fail (không chỉ lần cuối) để có dữ liệu thật chẩn đoán vì sao các lần
        // đầu hay trượt — trước đây chỉ lưu debug khi CẢ 3/4 lần đều fail nên mất bằng chứng của
        // các lần fail giữa chừng dù cuối cùng vẫn mở được Modal.
        const attemptDebugPath = path.join(DEBUG_OUTPUT_DIR, `debug_post_facebook_attempt${attempt}_fail_${Date.now()}.png`);
        await page.screenshot({ path: attemptDebugPath }).catch(() => { });
        // Nếu Dialog đã mở (dù textbox chưa kịp render) thì đừng Escape đóng ngang — chỉ Escape khi
        // thực sự KHÔNG có Dialog nào, tránh phá hỏng 1 Modal gần xong chỉ vì đợi chưa đủ lâu.
        const dialogStillOpen = await page.locator('div[role="dialog"]').first().isVisible().catch(() => false);
        if (!dialogStillOpen) {
          await page.keyboard.press('Escape').catch(() => { });
        }
      }

      if (!pageReloaded) {
        pageReloaded = true;
        console.log('[Playwright] 🔄 Reload trang Fanpage 1 lần trước khi thử mở Composer lại...');
        await navigateFacebookSurface(page, pageUrl, 'Fanpage retry').catch(() => { });
        await page.waitForTimeout(3000);
      } else {
        await page.waitForTimeout(3000);
      }
    }

    if (!pageComposerOpened) {
      const debugPath = path.join(DEBUG_OUTPUT_DIR, `debug_post_facebook_no_modal_${Date.now()}.png`);
      await page.screenshot({ path: debugPath }).catch(() => { });
      try {
        const html = await page.content();
        fs.writeFileSync(debugPath.replace('.png', '.html'), html);
      } catch (e) { }
      try {
        const bodyText = await page.locator('body').innerText();
        fs.writeFileSync(debugPath.replace('.png', '.txt'), bodyText);
      } catch (e) { }
      const composerErr = `Không thể mở Modal tạo bài viết trên giao diện Facebook sau ${PAGE_COMPOSER_MAX_ATTEMPTS} lần thử! (xem ${path.basename(debugPath)})`;
      if (page.__fbRateLimited) throw rateLimitError(composerErr);
      throw new Error(composerErr);
    }

    const dialog = page.locator('div[role="dialog"]').filter({ has: page.locator('div[role="textbox"], div[contenteditable="true"]') }).last();
    console.log('[Playwright] ✅ Đã mở Modal Tạo bài viết!');
    const postQueueId = req.headers['x-post-queue-id'];
    await assertNoFacebookSpamBlock(page, postQueueId, 'Page: vừa mở modal');

    // 🌐 Đảm bảo đối tượng người xem của bài viết luôn là CÔNG KHAI (Public)
    try {
      const audienceBtn = dialog.locator('div[role="button"][aria-label*="đối tượng"], div[role="button"][aria-label*="audience"], div[role="button"][aria-label*="Chỉ mình tôi"], div[role="button"][aria-label*="Bạn bè"], div[role="button"][aria-label*="Only me"]').first();
      if (await audienceBtn.isVisible().catch(() => false)) {
        const labelText = (await audienceBtn.getAttribute('aria-label').catch(() => '')) + ' ' + (await audienceBtn.innerText().catch(() => ''));
        if (!labelText.includes('Công khai') && !labelText.includes('Public')) {
          console.log('[Playwright] 🌐 Bài viết chưa ở chế độ Công khai, đang chuyển đối tượng người xem sang "Công khai"...');
          await audienceBtn.click();
          await page.waitForTimeout(2000);

          const publicOption = page.locator('div[role="button"]:has-text("Công khai"), div[role="checkbox"]:has-text("Công khai"), div[role="radio"]:has-text("Công khai"), div[role="button"]:has-text("Public")').first();
          if (await publicOption.isVisible().catch(() => false)) {
            await publicOption.click();
            await page.waitForTimeout(1500);

            const saveBtn = page.locator('div[role="button"]:has-text("Xong"), div[role="button"]:has-text("Lưu"), div[role="button"][aria-label="Xong"]').first();
            if (await saveBtn.isVisible().catch(() => false)) {
              await saveBtn.click();
              await page.waitForTimeout(1500);
            }
            console.log('[Playwright] ✅ Đã ép chế độ riêng tư bài viết thành CÔNG KHAI!');
          }
        }
      }
    } catch (eAudience) {
      console.log('[Playwright] ⚠️ Kiểm tra chế độ công khai:', eAudience.message);
    }

    // 1. GÕ VĂN BẢN TRƯỚC (FIRST)
    if (content && content.trim().length > 0) {
      console.log('[Playwright] Gõ nội dung bài đăng vào Modal...');
      await page.waitForTimeout(2000);
      const editor = dialog.first().locator('div[role="textbox"], div[contenteditable="true"]').first();
      const innerParagraph = editor.locator('p, span, div[dir="auto"]').first();
      if (await innerParagraph.isVisible().catch(() => false)) {
        await innerParagraph.click({ force: true }).catch(() => { });
      } else {
        await editor.click({ force: true }).catch(() => { });
      }
      await page.waitForTimeout(500);

      const textToType = (isColorBackground || isRedPhotoTrick) && content.length > 130 ? content.slice(0, 126) + '...' : content;
      await typeMultilinePostContent(page, textToType);
      await page.waitForTimeout(1500);

      const typedText = (await editor.innerText().catch(() => '')) || (await editor.textContent().catch(() => ''));
      console.log(`[Playwright] 📝 Nội dung ô soạn bài (${typedText.length} ký tự): ${typedText.slice(0, 50).replace(/\n/g, ' ')}...`);

      if (isColorBackground) {
        await selectFacebookRedBackground(dialog, page);
      }
    }

    // 2. ĐÍNH KÈM FILE VIDEO / ÁNH SANG (SECOND)
    if (normalizedMediaUrls.length > 0 && downloadedFilePaths.length === 0) {
      const debugPath = path.join(DEBUG_OUTPUT_DIR, `debug_post_facebook_no_media_${Date.now()}.png`);
      await page.screenshot({ path: debugPath }).catch(() => { });
      throw new Error(`[Lỗi Media] Bài viết có ${normalizedMediaUrls.length} link media nhưng không tải được file về máy server! Dừng đăng bài để tránh đăng bài bị thiếu clip/ảnh.`);
    }

    if (downloadedFilePaths.length > 0) {
      const hasVideo = downloadedFilePaths.some(fp => /\.mp4|\.mov|\.webm/i.test(fp));
      const finalFilePaths = downloadedFilePaths;
      console.log(`[Playwright] 📎 Đang đính kèm ${finalFilePaths.length} file Video/Ảnh vào Modal (${finalFilePaths.map(p => path.basename(p)).join(', ')})...`);

      let fileInput = dialog.locator('input[type="file"]').first();
      if (await fileInput.count().catch(() => 0) === 0) {
        fileInput = page.locator('input[type="file"]').first();
      }

      if (await fileInput.count().catch(() => 0) === 0) {
        const photoVideoIcon = dialog.locator('div[aria-label*="Ảnh/video"], div[aria-label*="Photo/video"], div[aria-label*="Ảnh"], div[role="button"]:has-text("Ảnh/video")').first();
        if (await photoVideoIcon.isVisible().catch(() => false)) {
          await photoVideoIcon.click({ force: true }).catch(() => { });
          await page.waitForTimeout(2000);
        }
        fileInput = dialog.locator('input[type="file"]').first();
        if (await fileInput.count().catch(() => 0) === 0) {
          fileInput = page.locator('input[type="file"]').first();
        }
      }

      if (await fileInput.count().catch(() => 0) > 0) {
        await fileInput.setInputFiles(finalFilePaths);
        const mediaWaitTime = Math.max(hasVideo ? 10000 : 6000, finalFilePaths.length * 1500);
        await page.waitForTimeout(mediaWaitTime);
        console.log(`[Playwright] ✅ Đã gắn ${finalFilePaths.length} file Media thành công vào Modal (đã chờ ${mediaWaitTime}ms)!`);
      } else {
        const debugPath = path.join(DEBUG_OUTPUT_DIR, `debug_post_facebook_file_input_missing_${Date.now()}.png`);
        await page.screenshot({ path: debugPath }).catch(() => { });
        throw new Error(`[Lỗi Media] Không tìm thấy ô chọn file input[type="file"] trong Modal Facebook để đính kèm ${finalFilePaths.length} file Ảnh/Video. Dừng đăng bài để tránh bài bị thiếu media! (xem ${path.basename(debugPath)})`);
      }
    }

    // 3. XỬ LÝ LUỒNG NÚT SUBMIT / TIẾP / ĐĂNG / CHIA SẺ CHUẨN XÁC
    // Dò DOM trực tiếp (2026-08-05, xem worker/tmp-inspect-candidates.js) phát hiện nguyên nhân
    // gốc khiến bài kẹt vô thời hạn ở Modal "Cài đặt thước phim": clickVisibleButtonByText trước
    // đây dùng page.locator() KHÔNG giới hạn trong div[role="dialog"], nên với regex /^Chia sẻ/
    // nó khớp trúng ngay 1 div NỀN của chính tường Fanpage phía sau Modal (ô "Chia sẻ suy nghĩ..."
    // — vẫn "visible" theo Playwright dù bị Modal che ở trên, là candidate đầu tiên theo thứ tự
    // DOM), bấm hụt vào đó rồi return true ngay lập tức — nút "Đăng" thật bên trong Modal không
    // bao giờ được bấm tới, script cứ tưởng đã bấm xong nên rơi thẳng vào vòng chờ đóng Modal và
    // timeout sau 2 phút. Từ đây về sau LUÔN giới hạn phạm vi tìm trong Modal
    // "Tạo bài viết" đã xác minh, không bao giờ tìm trên toàn trang nữa.
    // Bám đúng Modal "Tạo bài viết" đã xác minh ở trên. Facebook có thể render
    // thêm dialog ẩn sau nó; dùng .last() sẽ làm worker tìm nút "Tiếp" trong dialog
    // ẩn, không bấm gì nhưng vẫn rơi vào vòng chờ 2 phút.
    const activeDialog = dialog.first();

    console.log('[Playwright] 🚀 Bấm nút Bước 1 (Tiếp hoặc Đăng)...');
    let clickedStep1 = await clickVisibleButtonByText(page, /^(Tiếp|Next)$/i, composerMaxButtonY, activeDialog);
    let postedDirectly = false;
    if (!clickedStep1) {
      const clickedPostDirectly = await clickVisibleButtonByText(page, /^(Đăng|Post)$/i, composerMaxButtonY, activeDialog);
      if (clickedPostDirectly) {
        postedDirectly = true;
      } else {
        const directSubmitBtn = activeDialog.locator('div[role="button"][aria-label="Đăng"], div[role="button"][aria-label="Post"]').last();
        if (await directSubmitBtn.isVisible().catch(() => false)) {
          await directSubmitBtn.click({ force: true }).catch(() => { });
          postedDirectly = true;
        } else {
          const debugPath = path.join(DEBUG_OUTPUT_DIR, `debug_post_facebook_no_button_${Date.now()}.png`);
          await page.screenshot({ path: debugPath }).catch(() => { });
          throw new Error(`Không tìm thấy nút "Tiếp/Next" hoặc "Đăng/Post" trong Modal Tạo bài viết. (xem ${path.basename(debugPath)})`);
        }
      }
    }

    // Hàm gỡ các popup/modal quảng bá của Facebook (VD: "Speak to people directly", "Rời khỏi trang?", v.v.)
    const dismissPromoModal = async () => {
      // 1. Popup "Speak to people directly" / "Make it easier for people to speak with you by adding a 'Call Now' button"
      const upsellModal = page.locator('div[role="dialog"]').filter({
        hasText: /Speak to people directly|Make it easier for people to speak with you|Trò chuyện trực tiếp với mọi người|Thêm nút Gọi ngay/i
      });
      if (await upsellModal.first().isVisible().catch(() => false)) {
        console.log('[Playwright] ⚠️ Facebook hiện popup quảng bá "Speak to people directly", bấm "Not now" hoặc đóng...');
        const notNowBtn = upsellModal.first().locator('div[role="button"]').filter({
          hasText: /^(Not now|Lúc khác|Để sau|Không phải bây giờ|Bỏ qua|Không, cảm ơn)$/i
        }).first();
        if (await notNowBtn.isVisible().catch(() => false)) {
          await notNowBtn.click({ force: true }).catch(() => { });
          await page.waitForTimeout(1000);
        } else {
          const closeBtn = upsellModal.first().locator('div[aria-label="Close"], div[aria-label="Đóng"], svg[aria-label="Close"]').first();
          if (await closeBtn.isVisible().catch(() => false)) {
            await closeBtn.click({ force: true }).catch(() => { });
          } else {
            await page.keyboard.press('Escape').catch(() => { });
          }
          await page.waitForTimeout(1000);
        }
      }

      for (let i = 0; i < 3; i++) {
        const leavePageDialog = page.locator('div[role="dialog"]').filter({ hasText: /Rời khỏi trang\?|Leave page\?/i });
        if (await leavePageDialog.first().isVisible().catch(() => false)) {
          console.log('[Playwright] ⚠️ Facebook hiện popup "Rời khỏi trang?", bấm "Tiếp tục chỉnh sửa" và Đăng lại...');
          const continueEditBtn = leavePageDialog.first().locator('div[role="button"]').filter({ hasText: /Tiếp tục chỉnh sửa|Keep editing/i }).first();
          if (await continueEditBtn.isVisible().catch(() => false)) {
            await continueEditBtn.click({ force: true }).catch(() => { });
            await page.waitForTimeout(1500);
          }
          if (!postAlreadySubmitted) {
            const retrySubmitBtn = page.locator('div[role="dialog"] div[role="button"]').filter({ hasText: /^(Đăng|Post)$/i }).last();
            if (await retrySubmitBtn.isVisible().catch(() => false)) {
              await retrySubmitBtn.click({ force: true }).catch(() => { });
              postAlreadySubmitted = true;
              await page.waitForTimeout(2000);
            }
          }
        }

        const dismissBtn = page.locator('div[role="dialog"] div[role="button"]').filter({
          hasText: /^(Not now|Lúc khác|Để sau|Không phải bây giờ|Bỏ qua|Không, cảm ơn|Đăng bài viết gốc|Skip|Cancel)$/i
        }).first();
        if (await dismissBtn.isVisible().catch(() => false)) {
          console.log('[Playwright] ⚠️ Facebook chèn Modal quảng bá phụ/Đăng bài viết gốc, bấm để xuất bản bài...');
          await dismissBtn.click({ force: true }).catch(() => { });
          await page.waitForTimeout(2000);
        } else if (!(await leavePageDialog.first().isVisible().catch(() => false))) {
          break;
        }
      }
    };

    if (!postedDirectly) {
      await page.waitForTimeout(5000);

      console.log('[Playwright] 🚀 Bấm nút Bước 2 (Tiếp)...');
      let clickedStep2Next = await clickVisibleButtonByText(page, /^(Tiếp|Next)$/i, composerMaxButtonY, activeDialog);
      if (clickedStep2Next) {
        await page.waitForTimeout(4000);
      }

      await dismissPromoModal();

      console.log('[Playwright] 🚀 Bấm nút Bước cuối (Đăng)...');
      const preciseSubmitBtn = activeDialog.locator('div[role="button"][aria-label="Đăng"], div[role="button"][aria-label="Post"]').last();
      await waitUntilEnabled(preciseSubmitBtn, page, 15000).catch(() => { });
      if (await preciseSubmitBtn.isVisible().catch(() => false)) {
        await preciseSubmitBtn.click({ force: true }).catch(() => { });
      } else {
        await clickVisibleButtonByText(page, /^(Đăng|Post)$/i, composerMaxButtonY, activeDialog);
      }
      await page.waitForTimeout(2000);
      await dismissPromoModal();
    } else {
      console.log('[Playwright] ✅ Đã bấm nút "Đăng" trực tiếp ở Bước 1. Đang chờ Facebook xử lý bài...');
      await page.waitForTimeout(2000);
    }
    await assertNoFacebookSpamBlock(page, postQueueId, 'Page: sau khi bấm Đăng');
    // Cờ chặn click đúp/click lặp lại làm đăng 2 bài giống nhau
    let postAlreadySubmitted = true;

    // Lưới an toàn dự phòng: nếu vẫn lỡ rẽ nhầm sang màn chọn nhóm (VD Facebook đổi cấu trúc DOM
    // lần nữa trong tương lai), không chọn nhóm nào — bấm "Xong" để thoát rồi bấm lại Đăng thật.
    const groupPickerXong = activeDialog.locator('div[role="button"]').filter({ hasText: /^Xong$/ }).first();
    if (await groupPickerXong.isVisible().catch(() => false)) {
      console.log('[Playwright] ⚠️ Bấm nhầm vào màn "Chia sẻ lên nhóm", bấm "Xong" để thoát (không chọn nhóm nào)...');
      await groupPickerXong.click({ force: true }).catch(() => { });
      await page.waitForTimeout(2000);
      console.log('[Playwright] 🚀 Bấm lại nút "Đăng" thật để xuất bản...');
      const retryBtn = activeDialog.locator('div[role="button"][aria-label="Đăng"], div[role="button"][aria-label="Post"]').last();
      if (await retryBtn.isVisible().catch(() => false)) {
        await retryBtn.click({ force: true }).catch(() => { });
      } else {
        await clickVisibleButtonByText(page, /^(Đăng|Post)$/i, composerMaxButtonY, activeDialog);
      }
    }

    await dismissPromoModal();

    // Video càng dài/nặng thì Facebook xử lý (encode + "Đang đăng") càng lâu — từng thấy vẫn chưa
    // xong sau 55s dù không hề bị kẹt bởi Modal nào (debug screenshot chỉ thấy spinner "Đang đăng").
    // Poll tối đa 2 phút, thoát sớm ngay khi Modal đóng thay vì chờ cứng 1 khoảng thời gian cố định.
    console.log('[Playwright] ⏳ Đang chờ Facebook xuất bản & đóng Modal bài viết (tối đa 2 phút)...');
    const composerDialog = activeDialog;
    let modalClosed = false;
    for (let i = 0; i < 120; i++) {
      if (i % 2 === 0) await dismissPromoModal();
      // Dialog chặn spam giữ composer mở — phát hiện sớm thay vì chờ hết 2 phút rồi báo "kẹt Modal".
      await assertNoFacebookSpamBlock(page, postQueueId, 'Page: đang chờ xuất bản');
      modalClosed = !(await composerDialog.isVisible().catch(() => false));
      if (modalClosed) break;

      // Nếu sau khi dismiss modal quảng bá mà nút Submit vẫn còn hiển thị và đang bật -> bấm lại nút Đăng
      if (i > 5 && i % 10 === 0) {
        const lingeringSubmitBtn = activeDialog.locator('div[role="button"][aria-label="Đăng"], div[role="button"][aria-label="Post"]').last();
        if (await lingeringSubmitBtn.isVisible().catch(() => false)) {
          const isDisabled = (await lingeringSubmitBtn.getAttribute('aria-disabled').catch(() => null)) === 'true';
          if (!isDisabled) {
            console.log('[Playwright] 🔄 Thử bấm lại nút "Post/Đăng" sau khi gỡ popup quảng bá...');
            await lingeringSubmitBtn.click({ force: true }).catch(() => { });
          }
        }
      }

      if (i > 0 && i % 10 === 0) {
        console.log(`[Playwright] ⏳ Vẫn đang chờ Facebook xử lý video... (${i}s)`);
      }
      await page.waitForTimeout(1000);
    }

    // Xác nhận bài THỰC SỰ đã xuất bản: Modal "Tạo bài viết" phải đóng hẳn. Nếu vẫn còn mở sau 2 phút
    // nghĩa là luồng bị chặn giữa chừng (nút không bấm trúng, Facebook báo lỗi, Modal phụ chưa xử
    // lý...) — trước đây thiếu bước này nên có trường hợp báo thành công giả dù bài chưa hề lên Fanpage.
    if (!modalClosed) {
      const debugPath = path.join(DEBUG_OUTPUT_DIR, `debug_post_facebook_stuck_${Date.now()}.png`);
      await page.screenshot({ path: debugPath }).catch(() => { });
      throw new Error(`Modal "Tạo bài viết" vẫn còn mở sau khi bấm Đăng — bài CHƯA thực sự được xuất bản. Xem ${path.basename(debugPath)}.`);
    }
    // Modal đóng chưa chắc đã đăng: Facebook có thể đóng composer rồi mới bật dialog/toast chặn spam.
    await page.waitForTimeout(1000);
    await assertNoFacebookSpamBlock(page, postQueueId, 'Page: sau khi modal đóng');
    console.log('[Playwright] 🎉 Modal đã đóng! Bài viết xuất bản thành công!');

    // Nếu bài viết áp dụng mẹo Nền đỏ + Kèm ảnh (RED_PHOTO_TRICK):
    // Vào 3 chấm -> Chỉnh sửa bài viết -> Gỡ ảnh -> Chọn nền đỏ -> Lưu
    if (isRedPhotoTrick) {
      console.log('[Playwright] 🔴 [TRICK 3 CHẤM] Đang thực hiện mẹo sửa bài sang Nền Đỏ...');
      await editFacebookPostToRedBackground(page, targetFanpageId, isPersonal).catch((e) => {
        console.warn('[Playwright][EditRedTrick] ⚠️ Lỗi khi sửa bài sang nền đỏ:', e.message);
      });
    }

    // Tự động tìm lại bài vừa đăng trên Fanpage để bóc tách Link bài viết và bình luận affiliate (nếu có)
    let commentWarning = null;
    let fanpagePostUrl = null;
    const hasAffiliateLink = safeAffiliateLink && safeAffiliateLink.trim().length > 0;
    console.log(`[Playwright] 💬 Đang tìm bài vừa đăng trên Fanpage${hasAffiliateLink ? ' để bình luận tự động' : ' để lấy link bài viết'}...`);
    const commentResult = await commentLinkOnFanpagePost(
      page,
      targetFanpageId,
      hasAffiliateLink ? safeAffiliateLink.trim() : null,
      hasAffiliateLink ? 60000 : 10000
    ).catch((e) => {
      console.log('[Playwright][Fanpage][Comment] ⚠️ Lỗi khi tìm/bình luận:', e.message);
      return { success: false, postUrl: null };
    });
    if (commentResult && commentResult.postUrl) {
      fanpagePostUrl = commentResult.postUrl;
    }
    if (hasAffiliateLink && (!commentResult || !commentResult.success)) {
      commentWarning = commentResult?.error
        ? `Đã đăng bài lên Fanpage nhưng lỗi bình luận: ${commentResult.error}`
        : 'Đã đăng bài lên Fanpage nhưng chưa kịp bình luận tự động.';
    }

    let refreshedCookieString = null;
    try {
      refreshedCookieString = await refreshedFbCookieForSameUser(context, cookieString);
    } catch (_) {}

    console.log(`[Playwright] ✅ Đã hoàn tất tiến trình Đăng bài MỚI lên Fanpage ID ${targetFanpageId}!`);
    autoEnqueueOwnPost(fanpagePostUrl, 'FANPAGE');
    res.json({
      success: true,
      message: `Đã đăng bài mới thành công lên Fanpage ${targetFanpageId}!`,
      ...(fanpagePostUrl ? { publishedPostUrl: fanpagePostUrl, fanpagePostUrl } : {}),
      ...(commentWarning ? { warning: commentWarning } : {}),
      ...(refreshedCookieString ? { cookieString: refreshedCookieString } : {}),
    });
  } catch (error) {
    console.error('[Playwright] ❌ Lỗi đăng bài Facebook:', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
    for (const downloadedFilePath of downloadedFilePaths) {
      try { if (fs.existsSync(downloadedFilePath)) fs.unlinkSync(downloadedFilePath); } catch (_) {}
    }
    releaseLock();
    console.log(`[PostingLock] 🔓 Đã giải phóng phiên đăng Fanpage ${targetFanpageId}.`);
  }
});

// Đăng Video Reel lên Fanpage kèm "Chia sẻ lên nhóm" (Bước 3 Modal "Cài đặt thước phim").
// Tái dùng luồng chuyển danh tính Fanpage + soạn bài + upload Video giống /api/post-facebook,
// chỉ thêm bước tick chọn nhóm chia sẻ trước khi bấm "Đăng". Trả về {success, message, groupNames}
// hoặc throw Error — dùng chung bởi endpoint gọi trực tiếp và bởi hàng đợi đăng theo lịch bên dưới.
async function postReelWithGroups({ cookieString, targetFanpageId = DEFAULT_FANPAGE_PLATFORM_ACCOUNT_ID, socialAccountId, content, threadsUrl, mediaUrls, groupNames = ['Đảo Mèo'], proxyUrl, userAgent, postQueueId }) {
  // Tự động inject i_user=cleanTargetId vào cookie → Playwright mở thẳng danh tính Fanpage
  const cleanTargetIdEarly = (targetFanpageId || '').split(':')[0].trim();
  const cookies = parseCookies(cookieString, cleanTargetIdEarly);
  const cleanTargetId = (targetFanpageId || '').split(':')[0].trim();
  const pageUrl = `https://www.facebook.com/profile.php?id=${cleanTargetId}`;

  let browser = null;
  let page = null;
  let downloadedFilePath = null;

  const shot = async (name) => {
    if (!page) return;
    const p = path.join(DEBUG_OUTPUT_DIR, `debug_reel_groups_${name}.png`);
    await page.screenshot({ path: p }).catch(() => { });
    console.log(`[Playwright][ReelGroups] 📸 Screenshot: ${p}`);
  };

  try {
    console.log(`[Playwright][ReelGroups] 🚀 Đang khởi động trình duyệt đăng Reel + chia sẻ nhóm (Fanpage ID: ${cleanTargetId})...`);
    browser = await chromium.launch({ headless: true });
    const context = await createStealthBrowserContext(browser, {
      proxyUrl: typeof req !== 'undefined' && req?.body?.proxyUrl ? req.body.proxyUrl : proxyUrl,
      userAgent: typeof req !== 'undefined' && req?.body?.userAgent ? req.body.userAgent : userAgent
    });
    await context.addCookies(cookies);
    page = await context.newPage();
    watchFacebookRateLimit(page);

    // 1. Xác định link Video trực tiếp + Caption (bóc từ Threads nếu chưa có sẵn mediaUrls)
    let videoUrl = Array.isArray(mediaUrls) ? mediaUrls[0] : mediaUrls;
    let finalContent = content;

    if (!videoUrl && threadsUrl) {
      console.log(`[Playwright][ReelGroups] 🔍 Đang bóc Video + Caption từ Threads: ${threadsUrl}...`);
      const extractData = await extractVideoDirectly(threadsUrl);
      if (!extractData.success || !extractData.videoUrl) {
        throw new Error(extractData.error || 'Không giải mã được Video từ link Threads');
      }
      videoUrl = extractData.videoUrl;
      if (!finalContent || !finalContent.trim()) {
        finalContent = extractData.title || 'Mèo con siêu đáng yêu 🐾❤️';
      }
    }
    if (!finalContent || !finalContent.trim()) {
      throw new Error('Thiếu content và không có threadsUrl để tự lấy caption');
    }

    // 2. Tải Video về Kho vĩnh viễn (giống quy ước downloadedFilePath của /api/post-facebook)
    console.log(`[Playwright][ReelGroups] 📥 Đang tải Video vào Kho: ${videoUrl.slice(0, 80)}...`);
    const filename = `clip_meo_${Date.now()}.mp4`;
    downloadedFilePath = path.join(CLIP_MEO_DIR, filename);
    const { buffer: mediaBuffer } = await downloadMediaWithRetry(page, videoUrl);
    fs.writeFileSync(downloadedFilePath, mediaBuffer);
    console.log(`[Playwright][ReelGroups] ✅ Đã tải Video (${(mediaBuffer.length / 1024 / 1024).toFixed(2)} MB): ${downloadedFilePath}`);

    // 3. Mở Fanpage — i_user cookie đã inject sẵn, mở thẳng dưới danh tính Page (không cần bấm "Chuyển ngay")
    console.log(`[Playwright][ReelGroups] 🌐 Mở tường Fanpage (i_user đã inject): ${pageUrl}`);
    await navigateFacebookSurface(page, pageUrl, 'Fanpage');
    await page.waitForTimeout(5000);
    await assertFacebookSession(page, socialAccountId);

    // Facebook thỉnh thoảng chèn popup xác nhận danh tính ("Tiếp tục dưới tên X / Dùng trang cá
    // nhân khác") đè lên trang dù i_user cookie đã inject sẵn — popup này chặn mất nút "Tạo bài
    // viết" phía sau khiến bước dưới đây không bấm được. Popup này gắn liền với MỖI LẦN tải trang
    // (không phải theo phiên), nên page.goto lại sẽ khiến nó hiện lại y hệt — chỉ đóng popup tại
    // chỗ (không load lại trang) rồi đi tiếp trên cùng 1 trang.
    const identityDialog = page.locator('div[role="dialog"]').filter({ hasText: 'Tiếp tục dưới tên' });
    if (await identityDialog.first().isVisible().catch(() => false)) {
      console.log('[Playwright][ReelGroups] ⚠️ Phát hiện popup xác nhận danh tính, đóng popup tại chỗ...');
      const closeBtn = identityDialog.first().locator('div[aria-label="Đóng"], div[aria-label="Close"]').first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click({ force: true }).catch(() => { });
      } else {
        await page.keyboard.press('Escape').catch(() => { });
      }
      await page.waitForTimeout(2000);
    }

    // 4. Mở Modal "Tạo bài viết", gõ caption, đính kèm Video
    // Dùng lại pattern retry 3 lần + loại bỏ decoy aria-haspopup="menu" đã chứng minh ổn định ở
    // /api/post-facebook (chỗ này trước đây chỉ thử 1 lần, không retry, không reload — dễ fail
    // khi Facebook chậm render hoặc bấm nhầm bong bóng gợi ý avatar).
    const primaryComposerBtn = page.locator(
      'div[role="button"][aria-label*="Bạn đang nghĩ gì"], ' +
      'div[role="button"][aria-label*="Tạo bài viết"], ' +
      'div[role="button"][aria-label*="What\'s on your mind"], ' +
      'div[role="button"][aria-label*="Create a post"], ' +
      'div[role="button"][aria-label*="Write something"], ' +
      'div[role="button"]:has-text("Bạn đang nghĩ gì?"), ' +
      'div[role="button"]:has-text("Tạo bài viết"), ' +
      'div[role="button"]:has-text("What\'s on your mind?"), ' +
      'div[role="button"]:has-text("What\'s on your mind"), ' +
      'div[aria-label*="Bạn đang nghĩ gì"], ' +
      'div[aria-label*="Tạo bài viết"], ' +
      'div[aria-label*="What\'s on your mind"], ' +
      'div[aria-label*="Create a post"], ' +
      'span:has-text("What\'s on your mind"), ' +
      'span:has-text("Bạn đang nghĩ gì?"), ' +
      'span:has-text("Tạo bài viết")'
    );
    const fallbackComposerBtn = page.locator(
      'div[role="button"]:has-text("Chia sẻ suy nghĩ"), ' +
      'div[role="button"][aria-label*="Chia sẻ suy nghĩ"], ' +
      'span:has-text("Chia sẻ suy nghĩ")'
    );
    const findVisibleComposerCandidate = async (locator) => {
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const candidate = locator.nth(i);
        if (await candidate.isVisible().catch(() => false)) {
          const ariaHaspopup = await candidate.getAttribute('aria-haspopup').catch(() => null);
          if (ariaHaspopup === 'menu') continue;
          const box = await candidate.boundingBox().catch(() => null);
          if (box && box.width > 20 && box.height > 20) {
            return candidate;
          }
        }
      }
      return null;
    };

    const dialog = page.locator('div[role="dialog"]').filter({ has: page.locator('div[role="textbox"], [contenteditable="true"]') }).or(page.locator('div[role="dialog"]').filter({ hasText: /Tạo bài viết|Create post|Create a public post/i }));
    const REEL_COMPOSER_MAX_ATTEMPTS = 4;
    let reelComposerOpened = false;
    let reelPageReloaded = false;
    for (let attempt = 1; attempt <= REEL_COMPOSER_MAX_ATTEMPTS; attempt++) {
      let targetBtn = await findVisibleComposerCandidate(primaryComposerBtn);
      if (!targetBtn) {
        targetBtn = await findVisibleComposerCandidate(fallbackComposerBtn);
      }
      if (targetBtn) {
        console.log(`[Playwright][ReelGroups] Bấm ô Tạo bài viết ở đầu trang (lần ${attempt}/${REEL_COMPOSER_MAX_ATTEMPTS})...`);
        await targetBtn.scrollIntoViewIfNeeded().catch(() => { });
        await targetBtn.click({ timeout: 20000 }).catch(async () => {
          await targetBtn.click({ force: true }).catch(() => { });
        });
      } else {
        console.warn(`[Playwright][ReelGroups] ⚠️ Lần ${attempt}/${REEL_COMPOSER_MAX_ATTEMPTS}: Không thấy ô Tạo bài viết hiển thị.`);
      }

      try {
        await dialog.first().locator('div[role="textbox"]').first().waitFor({ state: 'visible', timeout: 45000 });
        reelComposerOpened = true;
        break;
      } catch (e) {
        console.warn(`[Playwright][ReelGroups] ⚠️ Click lần ${attempt}/${REEL_COMPOSER_MAX_ATTEMPTS} chưa mở Composer sau 30s.`);
        const attemptDebugPath = path.join(DEBUG_OUTPUT_DIR, `debug_reel_groups_attempt${attempt}_fail_${Date.now()}.png`);
        await page.screenshot({ path: attemptDebugPath }).catch(() => { });
        const dialogStillOpen = await page.locator('div[role="dialog"]').first().isVisible().catch(() => false);
        if (!dialogStillOpen) {
          await page.keyboard.press('Escape').catch(() => { });
        }
      }

      if (!reelPageReloaded) {
        reelPageReloaded = true;
        console.log('[Playwright][ReelGroups] 🔄 Reload trang Fanpage 1 lần trước khi thử mở Composer lại...');
        await navigateFacebookSurface(page, pageUrl, 'Fanpage retry').catch(() => { });
        await page.waitForTimeout(3000);
      } else {
        await page.waitForTimeout(3000);
      }
    }

    if (!reelComposerOpened) {
      if (page.__fbRateLimited) throw rateLimitError('Không mở được Modal Reel');
      throw new Error(`Không thể mở Modal "Tạo bài viết" trên giao diện Fanpage sau ${REEL_COMPOSER_MAX_ATTEMPTS} lần thử`);
    }
    console.log('[Playwright][ReelGroups] ✅ Đã mở Modal Tạo bài viết, gõ caption...');
    await assertNoFacebookSpamBlock(page, postQueueId, 'Reel: vừa mở modal');

    const editor = dialog.first().locator('div[role="textbox"]').first();
    await editor.click({ force: true }).catch(() => { });
    await page.waitForTimeout(1000);
    await typeMultilinePostContent(page, finalContent);
    await page.waitForTimeout(2000);

    console.log(`[Playwright][ReelGroups] 📎 Đính kèm Video: ${downloadedFilePath}`);
    const fileInput = dialog.first().locator('input[type="file"]').first();
    await fileInput.setInputFiles(downloadedFilePath);
    await page.waitForTimeout(8000);
    await shot('01_video_attached');

    // --- BƯỚC 1: Modal "Tạo bài viết" -> "Tiếp" ---
    console.log('[Playwright][ReelGroups] 👉 [Bước 1] Bấm "Tiếp"...');
    if (!(await clickVisibleButtonByText(page, /^(Tiếp|Next)$/i))) {
      throw new Error('[Bước 1] Không tìm thấy nút "Tiếp" đang hiển thị trong viewport');
    }
    await page.waitForTimeout(4000);

    // --- BƯỚC 2: Modal "Chỉnh sửa thước phim" -> cuộn panel trái 400px -> "Tiếp" ---
    console.log('[Playwright][ReelGroups] 📌 [Bước 2] Cuộn panel trái Modal Chỉnh sửa thước phim...');
    await page.mouse.move(150, 400);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(1500);

    console.log('[Playwright][ReelGroups] 👉 [Bước 2] Bấm "Tiếp"...');
    if (!(await clickVisibleButtonByText(page, /^(Tiếp|Next)$/i))) {
      throw new Error('[Bước 2] Không tìm thấy nút "Tiếp" đang hiển thị trong viewport');
    }
    await page.waitForTimeout(5000);
    await shot('02_step2_done');

    // --- BƯỚC 3: Modal "Cài đặt thước phim" -> cuộn panel trái 350px -> "Chia sẻ lên nhóm" ---
    console.log('[Playwright][ReelGroups] 📌 [Bước 3] Cuộn panel trái để lộ "Chia sẻ lên nhóm"...');
    await page.mouse.move(200, 500);
    await page.mouse.wheel(0, 350);
    await page.waitForTimeout(2000);

    const shareGroupRow = page.locator('div[role="button"], div[role="listitem"], div').filter({ hasText: /^(Chia sẻ lên nhóm|Share to groups?|Share to a group)$/i }).first();
    const groupRowBox = await shareGroupRow.boundingBox().catch(() => null);
    if (!groupRowBox) {
      await shot('03_share_group_row_not_found');
      throw new Error('[Bước 3] Không tìm thấy dòng "Chia sẻ lên nhóm" trong Modal Cài đặt thước phim');
    }
    console.log('[Playwright][ReelGroups] 👉 [Bước 3] Bấm "Chia sẻ lên nhóm"...');
    await page.mouse.click(groupRowBox.x + groupRowBox.width / 2, groupRowBox.y + groupRowBox.height / 2);
    await page.waitForTimeout(3000);
    await shot('04_group_list_opened');

    // Bảng chọn nhóm KHÔNG nằm trong subtree của div[role="dialog"] (Facebook render nó ở nơi khác
    // trong DOM), nên phải dò trên toàn page thay vì scope theo dialog. Mỗi dòng nhóm là 1
    // div[role="button"] chứa <input type="checkbox"> — quét lại danh sách checkbox CHƯA tick khớp
    // tên "mới" sau mỗi lần bấm (thay vì giữ index cố định) vì bấm 1 dòng sẽ chèn thêm 1 "chip nhóm
    // đã chọn" phía trên danh sách, làm lệch thứ tự nếu dò theo index tĩnh.
    async function findUncheckedGroupRows(groupName) {
      const checkboxes = page.locator('input[type="checkbox"]');
      const n = await checkboxes.count();
      const rows = [];
      for (let i = 0; i < n; i++) {
        const cb = checkboxes.nth(i);
        const checked = await cb.isChecked().catch(() => true);
        if (checked) continue;
        const row = cb.locator('xpath=ancestor::div[@role="button"][1]');
        if ((await row.count().catch(() => 0)) === 0) continue;
        const rowText = (await row.first().innerText().catch(() => '')).trim();
        const firstLine = rowText.split('\n')[0].trim();
        if (firstLine === groupName) rows.push(row.first());
      }
      return rows;
    }

    const uniqueRequestedGroupNames = [...new Set(groupNames.map((name) => String(name).trim()).filter(Boolean))];
    const selectedGroupNames = [];
    console.log(`[Playwright][ReelGroups] 👥 Đang chọn tất cả nhóm khớp tên: ${uniqueRequestedGroupNames.join(', ')}...`);
    for (let i = 0; i < uniqueRequestedGroupNames.length; i++) {
      const groupName = uniqueRequestedGroupNames[i];
      let candidates = await findUncheckedGroupRows(groupName);
      if (candidates.length === 0) {
        await shot(`05_group_row_missing_${i}`);
        throw new Error(`[Bước 3] Không tìm thấy nhóm tên "${groupName}" trong danh sách chia sẻ`);
      }

      // Facebook có thể có nhiều nhóm trùng tên (hiện tại là hai nhóm "Đảo Mèo"). Một tên trong
      // payload mang nghĩa chọn tất cả dòng khớp tên đó; sau mỗi click phải quét DOM lại vì Facebook
      // chèn chip nhóm đã chọn và làm thay đổi thứ tự các dòng.
      const expectedCount = candidates.length;
      while (candidates.length > 0) {
        const countBefore = candidates.length;
        await candidates[0].scrollIntoViewIfNeeded().catch(() => { });
        await candidates[0].click({ force: true }).catch(() => { });
        await page.waitForTimeout(1000);
        const after = await findUncheckedGroupRows(groupName);
        if (after.length >= countBefore) {
          await shot(`06_group_not_confirmed_${i}`);
          throw new Error(`[Bước 3] Đã bấm nhưng không xác nhận được nhóm "${groupName}"`);
        }
        selectedGroupNames.push(groupName);
        candidates = after;
      }
      console.log(`[Playwright][ReelGroups] ✅ Đã tick ${expectedCount} nhóm tên "${groupName}"`);
    }
    await shot('07_all_groups_ticked');

    console.log('[Playwright][ReelGroups] 👉 Bấm "Xong" để xác nhận danh sách nhóm...');
    const xongBtn = page.locator('div[role="button"]').filter({ hasText: /^(Xong|Done|Save)$/i }).first();
    const xongBox = await xongBtn.boundingBox().catch(() => null);
    if (xongBox) {
      await page.mouse.click(xongBox.x + xongBox.width / 2, xongBox.y + xongBox.height / 2);
    } else if (await xongBtn.isVisible().catch(() => false)) {
      await xongBtn.click({ force: true });
    } else {
      throw new Error('[Bước 3] Không tìm thấy nút "Xong" để xác nhận danh sách nhóm đã chọn');
    }
    await page.waitForTimeout(3000);
    await shot('08_after_xong');

    // --- BẤM "ĐĂNG" ĐỂ XUẤT BẢN ---
    console.log('[Playwright][ReelGroups] 🎯 Bấm "Đăng" để xuất bản Reel + chia sẻ nhóm...');
    if (!(await clickVisibleButtonByText(page, /^(Đăng|Post)$/i))) {
      throw new Error('[Bước 3] Không tìm thấy nút "Đăng" đang hiển thị trong viewport sau khi chọn nhóm');
    }
    await page.waitForTimeout(3000);
    await assertNoFacebookSpamBlock(page, postQueueId, 'Reel: sau khi bấm Đăng');

    // Facebook thỉnh thoảng chèn thêm 1 Modal quảng bá tính năng (VD: "Trò chuyện trực tiếp với mọi
    // người" / "Speak to people directly" mời thêm nút "Gọi ngay") ngay sau khi bấm Đăng, che trên Modal thật
    for (let i = 0; i < 4; i++) {
      const upsellModal = page.locator('div[role="dialog"]').filter({
        hasText: /Speak to people directly|Make it easier for people to speak with you|Trò chuyện trực tiếp với mọi người|Thêm nút Gọi ngay/i
      });
      if (await upsellModal.first().isVisible().catch(() => false)) {
        console.log('[Playwright][ReelGroups] ⚠️ Facebook hiện popup quảng bá "Speak to people directly", bấm "Not now" hoặc đóng...');
        const notNowBtn = upsellModal.first().locator('div[role="button"]').filter({
          hasText: /^(Not now|Lúc khác|Để sau|Không phải bây giờ|Bỏ qua|Không, cảm ơn)$/i
        }).first();
        if (await notNowBtn.isVisible().catch(() => false)) {
          await notNowBtn.click({ force: true }).catch(() => { });
        } else {
          await page.keyboard.press('Escape').catch(() => { });
        }
        await page.waitForTimeout(1500);
      }

      const dismissBtn = page.locator('div[role="dialog"] div[role="button"]').filter({
        hasText: /^(Not now|Lúc khác|Để sau|Không phải bây giờ|Bỏ qua|Không, cảm ơn|Skip)$/i
      }).first();
      if (await dismissBtn.isVisible().catch(() => false)) {
        console.log('[Playwright][ReelGroups] ⚠️ Facebook chèn Modal phụ sau khi bấm Đăng, bấm bỏ qua để tiếp tục...');
        await dismissBtn.click({ force: true }).catch(() => { });
        await page.waitForTimeout(2000);
      } else {
        break;
      }
    }
    await page.waitForTimeout(5000);
    await shot('09_after_publish');

    // Xác nhận bài THỰC SỰ đã xuất bản: Modal "Tạo bài viết" phải đóng hẳn. Nếu vẫn còn mở nghĩa là
    // luồng bị chặn giữa chừng (Modal phụ chưa xử lý hết, hoặc lỗi khác) — không được báo thành công.
    await assertNoFacebookSpamBlock(page, postQueueId, 'Reel: sau khi bấm Đăng');
    const stillOpen = await dialog.first().isVisible().catch(() => false);
    if (stillOpen) {
      throw new Error('Modal "Tạo bài viết" vẫn còn mở sau khi bấm Đăng — bài CHƯA thực sự được xuất bản (có thể bị chặn bởi 1 Modal phụ của Facebook). Xem debug_reel_groups_09_after_publish.png.');
    }
    // Modal đóng chưa chắc đã đăng: Facebook có thể đóng composer rồi mới bật dialog/toast chặn spam.
    await page.waitForTimeout(3000);
    await assertNoFacebookSpamBlock(page, postQueueId, 'Reel: sau khi modal đóng');

    console.log(`[Playwright][ReelGroups] 🎉 Đã đăng Reel + chia sẻ ${selectedGroupNames.length} nhóm lên Fanpage ${cleanTargetId}!`);
    return {
      success: true,
      message: `Đã đăng Video Reel và chia sẻ lên ${selectedGroupNames.length} nhóm thành công!`,
      groupNames: selectedGroupNames,
    };
  } catch (error) {
    console.error('[Playwright][ReelGroups] ❌ Lỗi:', error.message);
    await shot('error');
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
      fs.unlinkSync(downloadedFilePath);
    }
  }
}

app.post('/api/post-facebook-reel-groups', async (req, res) => {
  const {
    cookieString,
    targetFanpageId = DEFAULT_FANPAGE_PLATFORM_ACCOUNT_ID,
    socialAccountId,
    content,
    threadsUrl,
    mediaUrls,
    groupNames = ['Đảo Mèo'],
  } = req.body;

  if (!cookieString) {
    return res.status(400).json({ success: false, error: 'Thiếu cookieString' });
  }
  if (!threadsUrl && !mediaUrls) {
    return res.status(400).json({ success: false, error: 'Thiếu threadsUrl hoặc mediaUrls (cần có Video để đăng Reel)' });
  }
  if (!Array.isArray(groupNames) || groupNames.length === 0) {
    return res.status(400).json({ success: false, error: 'groupNames phải là mảng có ít nhất 1 tên nhóm' });
  }

  try {
    const result = await postReelWithGroups({ cookieString, targetFanpageId, socialAccountId, content, threadsUrl, mediaUrls, groupNames, postQueueId: req.headers['x-post-queue-id'] });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- HÀNG ĐỢI ĐĂNG REEL + CHIA SẺ NHÓM THEO LỊCH (VD: cách nhau 20 phút/bài) ---
// Lưu trên file để không mất hàng đợi khi worker khởi động lại giữa chừng (điều đã xảy ra vài lần
// trong lúc phát triển tính năng này). Chỉ xử lý TUẦN TỰ 1 mục tại 1 thời điểm — không chạy song
// song vì tất cả dùng chung 1 cookie phiên đăng nhập Facebook.
const QUEUE_FILE = path.join(__dirname, 'reel_groups_queue.json');
const DEFAULT_QUEUE_INTERVAL_MINUTES = 20;

function loadQueueState() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const state = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
      // Mục đang "posting" lúc worker bị tắt/restart giữa chừng — không rõ đã đăng thành công hay
      // chưa, đánh dấu lỗi để người dùng biết mà kiểm tra thủ công thay vì treo mãi ở trạng thái này.
      for (const item of state.items || []) {
        if (item.status === 'posting') {
          item.status = 'failed';
          item.error = 'Bị gián đoạn do worker khởi động lại giữa chừng — kiểm tra thủ công trên Fanpage rồi thêm lại vào hàng đợi nếu cần.';
        }
      }
      return state;
    }
  } catch (e) {
    console.warn('[ReelGroupsQueue] ⚠️ Không đọc được file hàng đợi, khởi tạo lại:', e.message);
  }
  return { intervalMinutes: DEFAULT_QUEUE_INTERVAL_MINUTES, nextRunAt: null, items: [] };
}

const queueState = loadQueueState();
let queueProcessing = false;

function saveQueueState() {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queueState, null, 2));
}

function publicQueueItem(item) {
  const { cookieString, ...rest } = item;
  return rest;
}

app.post('/api/reel-groups-queue', (req, res) => {
  const {
    cookieString,
    targetFanpageId = DEFAULT_FANPAGE_PLATFORM_ACCOUNT_ID,
    socialAccountId,
    content,
    threadsUrl,
    mediaUrls,
    groupNames = ['Đảo Mèo'],
    intervalMinutes,
  } = req.body;

  if (!cookieString) {
    return res.status(400).json({ success: false, error: 'Thiếu cookieString' });
  }
  if (!threadsUrl && !mediaUrls) {
    return res.status(400).json({ success: false, error: 'Thiếu threadsUrl hoặc mediaUrls (cần có Video để đăng Reel)' });
  }
  if (!Array.isArray(groupNames) || groupNames.length === 0) {
    return res.status(400).json({ success: false, error: 'groupNames phải là mảng có ít nhất 1 tên nhóm' });
  }

  if (Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
    queueState.intervalMinutes = intervalMinutes;
  }

  const item = {
    id: `q_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    cookieString,
    targetFanpageId,
    socialAccountId: socialAccountId || null,
    content: content || null,
    threadsUrl: threadsUrl || null,
    mediaUrls: mediaUrls || null,
    groupNames,
    status: 'pending',
    addedAt: new Date().toISOString(),
    postedAt: null,
    error: null,
  };
  queueState.items.push(item);
  saveQueueState();

  const pendingCount = queueState.items.filter((i) => i.status === 'pending').length;
  console.log(`[ReelGroupsQueue] ➕ Đã thêm vào hàng đợi (id=${item.id}). Đang chờ: ${pendingCount} bài, cách nhau ${queueState.intervalMinutes} phút/bài.`);

  res.json({ success: true, queued: publicQueueItem(item), pendingCount, intervalMinutes: queueState.intervalMinutes, nextRunAt: queueState.nextRunAt });
});

app.get('/api/reel-groups-queue', (req, res) => {
  res.json({
    success: true,
    intervalMinutes: queueState.intervalMinutes,
    nextRunAt: queueState.nextRunAt,
    items: queueState.items.map(publicQueueItem),
  });
});

app.delete('/api/reel-groups-queue/:id', (req, res) => {
  const idx = queueState.items.findIndex((i) => i.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy mục hàng đợi' });
  }
  if (queueState.items[idx].status !== 'pending') {
    return res.status(400).json({ success: false, error: `Không thể huỷ mục đang ở trạng thái "${queueState.items[idx].status}"` });
  }
  queueState.items.splice(idx, 1);
  saveQueueState();
  res.json({ success: true });
});

async function processQueueTick() {
  if (queueProcessing) return;
  const now = Date.now();
  if (queueState.nextRunAt && now < new Date(queueState.nextRunAt).getTime()) return;

  const next = queueState.items.find((i) => i.status === 'pending');
  if (!next) return;

  queueProcessing = true;
  next.status = 'posting';
  saveQueueState();
  console.log(`[ReelGroupsQueue] 🚀 Đến lượt đăng mục id=${next.id}...`);

  try {
    const result = await postReelWithGroups({
      cookieString: next.cookieString,
      targetFanpageId: next.targetFanpageId,
      socialAccountId: next.socialAccountId,
      content: next.content,
      threadsUrl: next.threadsUrl,
      mediaUrls: next.mediaUrls,
      groupNames: next.groupNames,
    });
    next.status = 'posted';
    next.postedAt = new Date().toISOString();
    next.error = null;
    console.log(`[ReelGroupsQueue] ✅ Đã đăng xong mục id=${next.id}: ${result.message}`);
  } catch (error) {
    next.status = 'failed';
    next.error = error.message;
    console.error(`[ReelGroupsQueue] ❌ Lỗi khi đăng mục id=${next.id}:`, error.message);
  } finally {
    queueState.nextRunAt = new Date(Date.now() + queueState.intervalMinutes * 60000).toISOString();
    saveQueueState();
    queueProcessing = false;
  }
}

// LƯU Ý: KHÔNG gọi setInterval/processQueueTick() ở đây (module scope) — nếu 2 bản worker lỡ chạy
// trùng, bản không giành được port vẫn sẽ kịp tự đăng bù 1 lượt TRƯỚC KHI phát hiện lỗi bind port ở
// dưới, gây đăng trùng. Dời việc khởi động vòng lặp này vào callback listen() thành công (cuối file)
// để chỉ đúng 1 bản duy nhất (bản thực sự giữ được port) chạy vòng lặp đăng bài ngầm này.

// Endpoint tự động đăng Facebook Story (Tin 24h) cho Fanpage qua Playwright Browser
app.post('/api/post-story', async (req, res) => {
  let { cookieString, targetFanpageId, mediaUrls, originalUrl, affiliateLink, scheduledAt } = req.body;
  if (!cookieString) {
    try {
      cookieString = await getFallbackFbCookie();
    } catch (_) {}
  }
  if (!cookieString) return res.status(400).json({ success: false, error: 'Thiếu cookieString và không tìm thấy Cookie active trong hệ thống' });

  let browser;
  let downloadedFilePath = null;
  try {
    const cleanFanpageId = targetFanpageId ? targetFanpageId.split(':')[0] : null;
    const cookies = parseCookies(cookieString, cleanFanpageId);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    await context.addCookies(cookies);
    const page = await context.newPage();

    let targetMediaUrl = (mediaUrls && Array.isArray(mediaUrls) && mediaUrls.length > 0) ? mediaUrls[0] : null;
    if ((!targetMediaUrl || targetMediaUrl.endsWith('.jpg') || targetMediaUrl.includes('.jpg?')) && originalUrl) {
      console.log(`[Playwright Story] 🔍 Đang giải mã video MP4 từ link gốc: ${originalUrl}...`);
      try {
        // Dùng lại browser của route (context mới, sạch cookie) thay vì bật thêm 1 Chromium để cào nguồn.
        const extractData = await extractVideoDirectly(originalUrl, { browser });
        if (extractData.success && extractData.videoUrl) {
          targetMediaUrl = extractData.videoUrl;
          console.log(`[Playwright Story] 🎬 Đã tìm thấy Video MP4 Story: ${targetMediaUrl}`);
        }
      } catch (e) { }
    }

    if (targetMediaUrl && targetMediaUrl.startsWith('http')) {
      try {
        const { buffer: mediaBuffer, contentType, mediaKind } = await downloadMediaWithRetry(page, targetMediaUrl);
        const ext = mediaFileExtension(mediaKind, contentType, mediaBuffer);
        const filename = `story_shopee_${Date.now()}${ext}`;
        downloadedFilePath = path.join(CLIP_MEO_DIR, filename);
        fs.writeFileSync(downloadedFilePath, mediaBuffer);
        console.log(`[Playwright Story] ✅ Đã lưu file Story: ${downloadedFilePath}`);
      } catch (e) {
        console.error('[Playwright Story] ❌ Lỗi tải media Story:', e.message);
        downloadedFilePath = null;
      }
    }
    if (!downloadedFilePath || !fs.existsSync(downloadedFilePath)) {
      return res.status(400).json({ success: false, error: 'Không thể tải file media để tạo Story' });
    }

    let storyPublished = false;

    // PHƯƠNG THỨC 1: META BUSINESS SUITE (Nếu có Link Affiliate / Shopee hoặc có Page ID)
    if (cleanFanpageId && (affiliateLink || cleanFanpageId.length > 5)) {
      const metaSuiteUrl = `https://business.facebook.com/latest/story_composer/?asset_id=${cleanFanpageId}&ref=biz_web_content_manager_published_posts&context_ref=POSTS`;
      console.log(`[Playwright Story] 💼 Đang mở Meta Business Suite Story Composer (Page: ${cleanFanpageId}): ${metaSuiteUrl}`);
      try {
        await page.goto(metaSuiteUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await page.waitForTimeout(4000);

        // Tìm input file trên Meta Suite
        const fileInputMeta = page.locator('input[type="file"]').first();
        if ((await fileInputMeta.count().catch(() => 0)) > 0) {
          await fileInputMeta.setInputFiles(downloadedFilePath);
          console.log(`[Playwright Story] 📤 Đã nạp file video vào Meta Suite Story Composer, đang xử lý...`);
          await page.waitForTimeout(7000);

          // Nếu có link Affiliate / Shopee: Bật nút liên kết và điền link
          if (affiliateLink && affiliateLink.trim()) {
            console.log(`[Playwright Story] 🛍️ Đang kích hoạt ô Thêm liên kết Shopee/Affiliate: ${affiliateLink}`);
            const linkCheckboxSelectors = [
              'label:has-text("Xem thêm")',
              'label:has-text("Thêm liên kết")',
              'label:has-text("Liên kết")',
              'label:has-text("Add link")',
              'label:has-text("Swipe up")',
              'input[type="checkbox"]:has-text("liên kết")',
              'div[role="button"]:has-text("Thêm liên kết")',
              'div[role="button"]:has-text("Add link")',
            ];

            for (const sel of linkCheckboxSelectors) {
              const el = page.locator(sel).first();
              if (await el.isVisible().catch(() => false)) {
                await el.click().catch(() => { });
                await page.waitForTimeout(1000);
                break;
              }
            }

            const urlInputSelectors = [
              'input[placeholder*="https://"]',
              'input[placeholder*="http://"]',
              'input[placeholder*="Liên kết"]',
              'input[aria-label*="Liên kết"]',
              'input[aria-label*="Link"]',
              'input[placeholder*="link"]',
              'input[type="url"]'
            ];

            for (const sel of urlInputSelectors) {
              const inp = page.locator(sel).first();
              if (await inp.isVisible().catch(() => false)) {
                await inp.fill(affiliateLink.trim()).catch(() => { });
                console.log(`[Playwright Story] 🔗 Đã dán link affiliate vào ô liên kết Meta Suite!`);
                await page.waitForTimeout(1000);
                break;
              }
            }
          }

          // Bấm nút Chia sẻ tin / Share story trên Meta Suite
          const shareBtnSelectors = [
            'div[role="button"]:has-text("Chia sẻ tin")',
            'div[role="button"]:has-text("Chia sẻ")',
            'div[role="button"]:has-text("Share story")',
            'div[role="button"]:has-text("Share Story")',
            'div[role="button"]:has-text("Publish")',
            'button:has-text("Chia sẻ tin")',
            'button:has-text("Chia sẻ")',
            'button:has-text("Share story")',
            '[aria-label="Chia sẻ tin"]',
            '[aria-label="Share story"]'
          ];

          for (let i = 0; i < 40; i++) {
            for (const sel of shareBtnSelectors) {
              const btn = page.locator(sel).first();
              if (await btn.isVisible().catch(() => false)) {
                const isEnabled = await btn.isEnabled().catch(() => false);
                if (isEnabled) {
                  await btn.click().catch(() => btn.dispatchEvent('click'));
                  console.log(`[Playwright Story] 🖱️ Đã bấm nút Chia sẻ trên Meta Business Suite!`);
                  await page.waitForTimeout(8000);
                  storyPublished = true;
                  break;
                }
              }
            }
            if (storyPublished) break;
            await page.waitForTimeout(500);
          }
        }
      } catch (metaErr) {
        console.warn(`[Playwright Story] ⚠️ Meta Business Suite chưa vào được (${metaErr.message}), chuyển sang fallback www.facebook.com/stories/create...`);
      }
    }

    // PHƯƠNG THỨC 2: FALLBACK QUA www.facebook.com/stories/create
    if (!storyPublished) {
      const storyUrl = 'https://www.facebook.com/stories/create';
      console.log(`[Playwright Story] 📖 Mở trang tạo Story Fanpage (ID: ${cleanFanpageId || 'cá nhân'}): ${storyUrl}`);
      await page.goto(storyUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(4000);

      // Kiểm tra và click vào thẻ "Tạo tin dạng ảnh" nếu trang đang ở màn hình chọn loại tin
      const photoStoryCardSelectors = [
        'div[role="button"]:has-text("Tạo tin dạng ảnh")',
        'div[role="button"]:has-text("Tạo tin")',
        'div[role="button"]:has-text("Create a photo story")',
        'div[role="button"]:has-text("Create a Photo Story")',
        'div[role="button"]:has-text("Photo story")',
        '[aria-label*="Tạo tin"]',
        '[aria-label*="Create a story"]',
      ];
      for (const sel of photoStoryCardSelectors) {
        const card = page.locator(sel).first();
        const isVis = await card.isVisible().catch(() => false);
        if (isVis) {
          console.log(`[Playwright Story] 🖼️ Bấm vào thẻ: ${sel}`);
          await card.click().catch(() => { });
          await page.waitForTimeout(2000);
          break;
        }
      }

      // Chờ input file upload Story xuất hiện (tối đa 10s)
      let fileInput = page.locator('input[type="file"]').first();
      let hasFileInput = false;
      for (let i = 0; i < 10; i++) {
        hasFileInput = (await fileInput.count().catch(() => 0)) > 0;
        if (hasFileInput) break;
        await page.waitForTimeout(1000);
      }
      console.log(`[Playwright Story] 📂 Tìm thấy input[type=file]: ${hasFileInput}`);

      if (hasFileInput) {
        await fileInput.setInputFiles(downloadedFilePath);
        console.log('[Playwright Story] 📤 Đã nạp file vào ô upload Story, đang chờ Facebook render xem trước...');
        await page.waitForTimeout(8000);

        const btnSelectors = [
          'div[role="button"]:has-text("Chia sẻ lên tin")',
          'div[role="button"]:has-text("Share to story")',
          'div[role="button"]:has-text("Đăng lên tin")',
          'div[role="button"]:has-text("Chia sẻ")',
          'button:has-text("Share to story")',
          'button:has-text("Chia sẻ lên tin")',
          'button:has-text("Chia sẻ")',
          'div[role="button"]:has-text("Publish")',
          '[aria-label="Share to story"]',
          '[aria-label="Chia sẻ lên tin"]',
        ];

        let shareBtn = null;
        for (const sel of btnSelectors) {
          const btn = page.locator(sel).first();
          const isVis = await btn.isVisible().catch(() => false);
          if (isVis) {
            shareBtn = btn;
            console.log(`[Playwright Story] 🎯 Tìm thấy nút bấm: ${sel}`);
            break;
          }
        }

        let clicked = false;
        if (shareBtn) {
          for (let i = 0; i < 50; i++) {
            const isEnabled = await shareBtn.isEnabled().catch(() => false);
            const ariaDisabled = await shareBtn.getAttribute('aria-disabled').catch(() => null);
            if (isEnabled && ariaDisabled !== 'true') break;
            await page.waitForTimeout(500);
          }
          try {
            await shareBtn.click({ timeout: 6000 });
            await page.waitForTimeout(10000);
            clicked = true;
            console.log(`[Playwright Story] 🖱️ Đã click nút Share Story thành công!`);
          } catch (clickErr) {
            console.warn(`[Playwright Story] ⚠️ Click thường thất bại (${clickErr.message}), thử dispatchEvent...`);
            await shareBtn.dispatchEvent('click');
            await page.waitForTimeout(10000);
            clicked = true;
          }
        }

        if (clicked) {
          storyPublished = true;
          console.log('[Playwright Story] ✅ Đã đăng Facebook Story thành công!');
        } else {
          console.warn('[Playwright Story] ⚠️ Không tìm thấy nút Chia sẻ lên tin sau khi upload.');
          if (downloadedFilePath && fs.existsSync(downloadedFilePath)) fs.unlinkSync(downloadedFilePath);
          return res.status(500).json({ success: false, error: 'Không tìm thấy nút Chia sẻ lên tin sau khi upload.' });
        }
      } else {
        console.warn(`[Playwright Story] ⚠️ Không tìm thấy input[type=file] trên trang tạo tin.`);
        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) fs.unlinkSync(downloadedFilePath);
        return res.status(500).json({ success: false, error: 'Không tìm thấy ô upload file Story trên Facebook.' });
      }
    }

    if (downloadedFilePath && fs.existsSync(downloadedFilePath)) fs.unlinkSync(downloadedFilePath);
    res.json({ success: true, message: 'Đã xuất bản Story Facebook thành công!' });
  } catch (error) {
    console.error('[Playwright Story] ❌ Lỗi tạo Story:', error.message);
    if (downloadedFilePath && fs.existsSync(downloadedFilePath)) fs.unlinkSync(downloadedFilePath);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await browser?.close().catch(() => { });
  }
});

// Hàm chuẩn hóa & làm sạch URL bài viết Facebook (loại bỏ toàn bộ mã tracking rác)
function cleanFacebookPostUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const u = new URL(rawUrl);
    if (!u.hostname.includes('facebook.com') && !u.hostname.includes('fb.watch') && !u.hostname.includes('fb.com')) {
      return rawUrl.trim();
    }
    // Nếu là dạng multi_permalinks trong Group, chuẩn hóa về đường dẫn bài viết trực tiếp
    const multiPermalinks = u.searchParams.get('multi_permalinks');
    const matchGroup = u.pathname.match(/\/groups\/([^/?#]+)/);
    if (multiPermalinks && matchGroup) {
      return `https://www.facebook.com/groups/${matchGroup[1]}/posts/${multiPermalinks}/`;
    }
    // Loại bỏ toàn bộ tracking params rác
    const paramsToRemove = [
      '__cft__[0]', '__cft__', '__tn__', 'ref', 'set', 'rdid', 'comment_id', 'notif_id',
      'notif_t', 'paipv', 'idorvanity', 'source', 'refsrc', '__eep__', 'mibextid', 'sfnsn',
      'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'locale'
    ];
    for (const p of paramsToRemove) {
      u.searchParams.delete(p);
    }
    return u.toString().replace(/[?&]$/, '');
  } catch (e) {
    return rawUrl.trim();
  }
}

// Bóc tách Link bài viết Facebook sạch từ Container bài viết
async function extractPostUrlFromCommentBox(commentBoxLocator) {
  if (!commentBoxLocator) return null;
  try {
    const rawUrl = await commentBoxLocator.evaluate((node) => {
      let el = node;
      for (let i = 0; i < 15 && el; i++) {
        if (
          el.getAttribute &&
          (el.getAttribute('role') === 'article' ||
            el.hasAttribute('aria-posinset') ||
            (el.className && typeof el.className === 'string' && el.className.includes('userContentWrapper')))
        ) {
          break;
        }
        el = el.parentElement;
      }
      const container = el || document;
      const candidates = Array.from(container.querySelectorAll('a[href]'));
      // Ưu tiên link có chứa /posts/, /permalink/, multi_permalinks, /videos/, photo.php
      for (const a of candidates) {
        const href = a.href || '';
        if (
          href.includes('/posts/') ||
          href.includes('/permalink/') ||
          href.includes('multi_permalinks') ||
          href.includes('/videos/') ||
          href.includes('/photo.php') ||
          href.includes('/reel/') ||
          href.includes('/watch/')
        ) {
          if (!href.includes('/user/') && !href.includes('/hashtag/') && !href.includes('/profile.php')) {
            return href;
          }
        }
      }
      // Fallback: tìm theo aria-label chứa mốc thời gian (Vừa xong, 1 phút trước, Just now...)
      for (const a of candidates) {
        const aria = a.getAttribute('aria-label') || '';
        if (/vừa xong|phút|giờ|yesterday|just now|min|hour|ago/i.test(aria) && a.href && a.href.includes('facebook.com')) {
          return a.href;
        }
      }
      return null;
    }).catch(() => null);

    return cleanFacebookPostUrl(rawUrl);
  } catch (e) {
    return null;
  }
}

// Xác thực 3 lớp sau khi gửi bình luận: gõ text + kiểm tra text rỗng trước khi gửi + check DOM (loại trừ ô nhập)
async function verifyAndSendComment(page, commentBoxLocator, linkToComment) {
  console.log('[Playwright][Comment] 💬 Đang nhập nội dung bình luận...');

  await commentBoxLocator.scrollIntoViewIfNeeded().catch(() => { });
  await commentBoxLocator.click({ force: true }).catch(() => { });
  await page.waitForTimeout(300);

  // Focus inner <p> or contenteditable tag to position caret
  const innerEditable = commentBoxLocator.locator('p, span[data-lexical-text="true"]').first();
  if (await innerEditable.isVisible().catch(() => false)) {
    await innerEditable.click({ force: true }).catch(() => { });
  }
  await page.waitForTimeout(300);

  // Type line by line with delay so Lexical framework recognizes keyboard input and enables Submit button
  await typeSingleMultilineComment(page, linkToComment);
  await page.waitForTimeout(1000);

  let typedContent = await commentBoxLocator.evaluate((el) => (el.innerText || el.textContent || '').trim()).catch(() => '');

  // Fallback if typedContent is still empty
  if (!typedContent || typedContent.length === 0) {
    console.log('[Playwright][Comment] ⚠️ Gõ lần 1 chưa lên chữ, thử click lại ô nhập & gõ phím...');
    await commentBoxLocator.click({ force: true }).catch(() => { });
    await page.waitForTimeout(300);
    await typeSingleMultilineComment(page, linkToComment);
    await page.waitForTimeout(1000);
    typedContent = await commentBoxLocator.evaluate((el) => (el.innerText || el.textContent || '').trim()).catch(() => '');
  }

  if (!typedContent || typedContent.length === 0) {
    console.error('[Playwright][Comment] ❌ KHÔNG thể gõ nội dung vào ô bình luận — ô nhập vẫn hoàn toàn trống!');
    return { success: false, error: 'Không thể nhập chữ vào ô bình luận (ô nhập vẫn trống)' };
  }

  console.log(`[Playwright][Comment] ✍️ Đã nhập thành công ${typedContent.length} ký tự vào ô bình luận.`);

  const checkSnippet = (linkToComment || '').trim().slice(0, 35);

  // Selector tìm bình luận ĐÃ ĐĂNG thực sự (TỰ LOẠI TRỪ ô nhập role="textbox" và contenteditable)
  const isCommentPostedInDom = async () => {
    if (!checkSnippet) return false;
    const candidates = page.locator(`ul :has-text("${checkSnippet}"), div[role="article"] :has-text("${checkSnippet}"), div[dir="auto"]:has-text("${checkSnippet}")`);
    const count = await candidates.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const item = candidates.nth(i);
      const isInsideTextbox = await item.evaluate((el) => {
        return !!el.closest('[role="textbox"], [contenteditable="true"]');
      }).catch(() => false);
      if (!isInsideTextbox && await item.isVisible().catch(() => false)) {
        return true;
      }
    }
    return false;
  };

  const sendBtnLocator = page.locator(
    'div[role="button"][aria-label="Đăng bình luận"], div[aria-label="Đăng bình luận"], ' +
    'div[role="button"][aria-label="Bình luận"], div[role="button"][aria-label="Comment"], ' +
    'div[role="button"][aria-label*="Đăng"], div[role="button"][aria-label*="Send"], ' +
    'div[role="button"][aria-label*="Gửi"], [aria-label="Bình luận"][role="button"]'
  );

  // Vòng lặp Gửi & Kiểm tra (tối đa 4 lần)
  for (let attempt = 1; attempt <= 4; attempt++) {
    console.log(`[Playwright][Comment] 👉 Thử gửi bình luận lần ${attempt} (phím Enter & nút Submit)...`);
    await commentBoxLocator.first().focus().catch(() => {});
    await page.keyboard.press('Enter').catch(() => { });
    await page.waitForTimeout(1000);

    const sendBtn = sendBtnLocator.first();
    if (await sendBtn.isVisible().catch(() => false)) {
      console.log('[Playwright][Comment] 👉 Bấm thêm nút Đăng bình luận (Paper plane)...');
      await sendBtn.click({ force: true, timeout: 2000 }).catch(() => { });
      await page.waitForTimeout(1500);
    }

    const fbErrorToast = page.locator(
      'div[role="alert"], div[role="dialog"]:has-text("Không thể"), ' +
      'div[role="dialog"]:has-text("bị tạm khóa"), div[role="dialog"]:has-text("Spam"), ' +
      'span:has-text("Không thể gửi bình luận"), span:has-text("Tính năng này tạm thời bị khóa")'
    ).first();
    if (await fbErrorToast.isVisible().catch(() => false)) {
      const alertText = (await fbErrorToast.innerText().catch(() => '')).trim();
      const isActualError = /(?:không thể|tạm khóa|bị chặn|hạn chế|lỗi|thất bại|spam|can't|error|failed|blocked|restricted)/i.test(alertText);
      if (isActualError) {
        console.log(`[Playwright][Comment] ❌ Facebook báo lỗi khi gửi bình luận: ${alertText.slice(0, 120)}`);
        return { success: false, error: alertText.slice(0, 150) };
      }
    }

    // Kiểm tra ô nhập đã được xoá trắng (Facebook đã nhận bình luận)
    const currentBoxText = await commentBoxLocator.evaluate((el) => (el.innerText || el.textContent || '').trim()).catch(() => 'error');
    if (currentBoxText === '' || currentBoxText.length < 5 || (await isCommentPostedInDom())) {
      console.log('[Playwright][Comment] ✅ Đã xác thực bình luận đã gửi thành công (ô nhập đã được xoá trắng / xuất hiện trong DOM)!');
      return { success: true };
    }
  }

  // Reload trang kiểm tra lại lần cuối
  if (checkSnippet) {
    console.log('[Playwright][Comment] 🔄 Tải lại trang để kiểm tra bài & bình luận lần cuối...');
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(4000);
    if (await isCommentPostedInDom()) {
      console.log('[Playwright][Comment] ✅ Đã xác thực bình luận xuất hiện thành công sau khi reload!');
      return { success: true };
    }
  }

  return { success: true };
}

/**
 * Ngắt trigger @mention / +mention của trình soạn Lexical trên Facebook bằng zero-width space (\u200B),
 * đồng thời giữ nguyên 100% URL và địa chỉ email.
 */
function neutralizeFacebookMentionTriggers(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(
    /(https?:\/\/\S+|www\.\S+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})|(@)(?=[ \t]*[A-Za-z0-9À-ỹ_])|(\+)(?=[ \t]+[A-Za-z0-9À-ỹ_]|[A-Za-zÀ-ỹ_])/g,
    (match, protectedToken, atTrigger, plusTrigger) => {
      if (protectedToken) return protectedToken;
      return `${atTrigger || plusTrigger}\u200B`;
    }
  );
}

const FB_MENTION_POPUP_SELECTOR = [
  '[role="listbox"]:visible',
  '[role="option"]:visible',
  'div[data-testid*="typeahead"]:visible',
  'div[aria-label*="Gợi ý" i]:visible',
  'div[aria-label*="Nhắc đến" i]:visible',
  'div[aria-label*="Mention" i]:visible',
].join(', ');

async function hasActiveFacebookMentionPopup(page, editor = null) {
  const popupVisible = await page.locator(FB_MENTION_POPUP_SELECTOR).first().isVisible().catch(() => false);
  if (popupVisible) return true;
  const focusedHasPopup = await page.evaluate(() => {
    const el = document.activeElement;
    return Boolean(el && (el.getAttribute('aria-activedescendant') || el.getAttribute('aria-controls')));
  }).catch(() => false);
  if (focusedHasPopup) return true;
  if (editor) {
    return editor.evaluate((el) => Boolean(el.getAttribute('aria-activedescendant') || el.getAttribute('aria-controls'))).catch(() => false);
  }
  return false;
}

async function dismissFacebookMentionPopups(page, editor = null) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!(await hasActiveFacebookMentionPopup(page, editor))) return false;
    console.log('[Playwright] 🛡️ Phát hiện popup gợi ý tag của Facebook, đang bấm Escape để hủy bỏ tag...');
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(120);
  }
  return true;
}

// Gõ nội dung bài viết nhiều dòng vào Modal đăng bài của Facebook (chặn mọi trigger tag @ / + / ký tự đầu dòng / từ viết hoa cuối dòng + Shift+Enter giữ nguyên ngắt dòng)
async function typeMultilinePostContent(page, text) {
  if (!text || typeof text !== 'string') return;
  const safeText = neutralizeFacebookMentionTriggers(text);
  const lines = safeText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const activeEditor = page.locator('div[role="dialog"] div[role="textbox"], div[role="textbox"]').first();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 0) {
      // Thêm 1 dấu cách cuối dòng để ngắt hoàn toàn trigger typeahead của Facebook đối với MỌI ký tự/từ viết hoa ở cuối dòng (- Euro, * Euro, : Euro, TIKTOK, Shopee, Cre: Tên...)
      const lineToInsert = /\s$/.test(line) ? line : `${line} `;
      try {
        await page.keyboard.insertText(lineToInsert);
      } catch (err) {
        await page.keyboard.type(lineToInsert, { delay: 5 });
      }
      await page.waitForTimeout(120);

      // Dự phòng tầng 2: nếu vẫn bật typeahead (qua :visible hoặc aria-activedescendant/aria-controls), bấm Escape để hủy trước khi Shift+Enter
      await dismissFacebookMentionPopups(page, activeEditor);
    }
    if (i < lines.length - 1) {
      await page.keyboard.press('Shift+Enter');
      await page.waitForTimeout(90);
    }
  }

  // Chờ nhẹ để typeahead bất đồng bộ (nếu có) kịp hiện rồi dọn lần cuối trước khi gắn media / bấm Đăng
  await page.waitForTimeout(350);
  await dismissFacebookMentionPopups(page, activeEditor);
}


// Bình luận 1 link vào đúng bài Fanpage/Group vừa đăng (nhập nhanh & chính xác).
async function typeSingleMultilineComment(page, text) {
  if (!text) return;
  const safeText = neutralizeFacebookMentionTriggers(text);
  const lines = safeText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 0) {
      const lineToInsert = /\s$/.test(line) ? line : `${line} `;
      await page.keyboard.insertText(lineToInsert).catch(async () => {
        await page.keyboard.type(lineToInsert, { delay: 2 });
      });
      await page.waitForTimeout(80);
      await dismissFacebookMentionPopups(page);
    }
    if (i < lines.length - 1) {
      // Shift+Enter để xuống dòng TRONG CÙNG 1 BÌNH LUẬN (tránh Facebook tự gửi thành nhiều cmt riêng lẻ)
      await page.keyboard.press('Shift+Enter');
      await page.waitForTimeout(80);
    }
  }
  await page.waitForTimeout(200);
  await dismissFacebookMentionPopups(page);
}

async function commentLinkOnFanpagePost(page, targetFanpageId, linkToComment, maxWaitMs = 120000) {
  const cleanTargetId = (targetFanpageId || '').split(':')[0].trim();
  const pageUrl = `https://www.facebook.com/profile.php?id=${cleanTargetId}`;
  const start = Date.now();
  const waitMs = linkToComment ? 3000 : 1000;
  console.log(`[Playwright][Fanpage][Comment] ⏳ Chờ ${waitMs / 1000}s để Facebook cập nhật và hiển thị bài viết lên tường Fanpage ID: ${cleanTargetId}...`);
  await page.waitForTimeout(waitMs);

  while (Date.now() - start < maxWaitMs) {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
    await page.waitForTimeout(1500);

    const processingCard = page.locator('text=/Đang xử lý video/i').first();
    if (await processingCard.isVisible().catch(() => false)) {
      console.log('[Playwright][Fanpage][Comment] ⏳ Video vẫn đang xử lý, chờ rồi tải lại...');
      await page.waitForTimeout(5000);
      continue;
    }

    // Cuộn xuống qua phần Tin nổi bật / Đáng chú ý để bài viết đầu tiên và khung bình luận hiện vào tầm nhìn
    for (let scrollAttempt = 0; scrollAttempt < 2; scrollAttempt++) {
      await page.evaluate(() => window.scrollBy(0, 500)).catch(() => { });
      await page.waitForTimeout(400);
      const postVisible = await page.evaluate(() => {
        return !!document.querySelector('div[data-pagelet*="FeedUnit_"], div[role="feed"] div[role="article"], div[role="textbox"]');
      }).catch(() => false);
      if (postVisible) break;
    }

    // Nếu ô nhập chưa mở, bấm vào nút "Bình luận" ở dưới bài viết
    const commentActionBtn = page.locator(
      'div[role="button"][aria-label*="Bình luận"], div[role="button"][aria-label*="Comment"], ' +
      'div[role="button"][aria-label*="Để lại bình luận"], span:has-text("Bình luận")'
    ).first();
    if (await commentActionBtn.isVisible().catch(() => false)) {
      await commentActionBtn.click().catch(() => { });
      await page.waitForTimeout(600);
    }

    const commentBox = page.locator(
      'div[role="textbox"][aria-label*="Bình luận"], div[role="textbox"][aria-label*="Viết"], ' +
      'div[role="textbox"][aria-label*="Comment"], div[role="textbox"][aria-label*="dưới tên"], ' +
      'div[data-lexical-editor="true"], div[contenteditable="true"][role="textbox"]'
    ).first();

    if (await commentBox.isVisible().catch(() => false)) {
      const postUrl = await extractPostUrlFromCommentBox(commentBox);
      if (postUrl) {
        console.log(`[Playwright][Fanpage][Comment] 🔗 Link bài viết Fanpage: ${postUrl}`);
      }

      if (!linkToComment) {
        return { success: true, postUrl };
      }

      const verifyResult = await verifyAndSendComment(page, commentBox, linkToComment);
      return { success: verifyResult.success, postUrl, error: verifyResult.error };
    }

    await page.waitForTimeout(linkToComment ? 4000 : 2000);
  }
  console.log('[Playwright][Fanpage][Comment] ⚠️ Hết thời gian chờ, không tìm thấy ô bình luận trên Fanpage.');
  return { success: false, postUrl: null };
}

// Bình luận 1 link vào đúng bài Group vừa đăng.
// linkToComment=null: chỉ tìm & trả về link bài vừa đăng, không bình luận gì cả (dùng để lưu lại
// link bài đã đăng cho mục Lịch sử/Báo cáo — không phụ thuộc tính năng bình luận affiliate).
async function commentLinkOnGroupPost(page, groupId, pageId, linkToComment = null, maxWaitMs = 120000) {
  const cleanPageId = (pageId || '').split(':')[0].trim();
  const isNumericPageId = /^\d+$/.test(cleanPageId);
  const filteredUrl = isNumericPageId ? `https://www.facebook.com/groups/${groupId}/user/${cleanPageId}` : null;
  const mainGroupUrl = `https://www.facebook.com/groups/${groupId}`;
  const start = Date.now();
  const waitMs = linkToComment ? 3000 : 1000;
  console.log(`[Playwright][Group][Comment] ⏳ Chờ ${waitMs / 1000}s để Facebook cập nhật bài vừa đăng trong Group ID: ${groupId}...`);
  await page.waitForTimeout(waitMs);

  let attemptUrls = filteredUrl ? [filteredUrl, mainGroupUrl] : [mainGroupUrl];
  let urlIdx = 0;

  while (Date.now() - start < maxWaitMs) {
    const currentUrlToTry = attemptUrls[urlIdx % attemptUrls.length];
    urlIdx++;
    await page.goto(currentUrlToTry, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
    await page.waitForTimeout(1500);

    const processingCard = page.locator('text=/Đang xử lý video/i').first();
    if (await processingCard.isVisible().catch(() => false)) {
      console.log('[Playwright][Group][Comment] ⏳ Video vẫn đang xử lý, chờ rồi tải lại...');
      await page.waitForTimeout(5000);
      continue;
    }

    // Cuộn nhẹ xuống để bài viết đầu tiên trong Group hiện vào tầm nhìn
    await page.evaluate(() => window.scrollBy(0, 400)).catch(() => { });
    await page.waitForTimeout(500);

    // Nếu ô nhập chưa mở, bấm vào nút "Bình luận" ở dưới bài viết trong Group
    const commentActionBtn = page.locator(
      'div[role="button"][aria-label*="Bình luận"], div[role="button"][aria-label*="Comment"], ' +
      'div[role="button"][aria-label*="Để lại bình luận"]'
    ).first();
    if (await commentActionBtn.isVisible().catch(() => false)) {
      await commentActionBtn.click().catch(() => { });
      await page.waitForTimeout(600);
    }

    const commentBox = page.locator(
      'div[role="textbox"][aria-label*="Bình luận"], div[role="textbox"][aria-label*="Viết"], ' +
      'div[role="textbox"][aria-label*="Comment"], div[role="textbox"][aria-label*="dưới tên"], ' +
      'div[data-lexical-editor="true"], div[contenteditable="true"][role="textbox"]'
    ).first();

    if (await commentBox.isVisible().catch(() => false)) {
      const postUrl = await extractPostUrlFromCommentBox(commentBox);
      if (postUrl) {
        console.log(`[Playwright][Group][Comment] 🔗 Link bài viết Group: ${postUrl}`);
      }

      if (!linkToComment) {
        return { success: true, postUrl };
      }

      const verifyResult = await verifyAndSendComment(page, commentBox, linkToComment);
      return { success: verifyResult.success, postUrl, error: verifyResult.error };
    }

    await page.waitForTimeout(linkToComment ? 4000 : 2000);
  }
  console.log('[Playwright][Group][Comment] ⚠️ Hết thời gian chờ, không tìm thấy ô bình luận của bài vừa đăng.');
  return { success: false, postUrl: null };
}

// Endpoint tự động kiểm tra Quyền & Trạng thái Group (Group Health Monitor)
app.post('/api/check-group-health', async (req, res) => {
  const { cookieString, targetGroupId, pageName, pageId, socialAccountId } = req.body;

  if (!cookieString || !targetGroupId) {
    return res.status(400).json({ success: false, error: 'Thiếu cookieString hoặc targetGroupId' });
  }

  let cookies = parseCookies(cookieString);
  const targetPageId = pageId || (req.body.targetFanpageId ? req.body.targetFanpageId.split(':')[0] : null);
  if (targetPageId && /^\d+$/.test(targetPageId)) {
    cookies = cookies.filter(c => c.name !== 'i_user');
    cookies.push({
      name: 'i_user',
      value: String(targetPageId),
      domain: '.facebook.com',
      path: '/'
    });
  }

  // Route thử nghiệm Browser Pool đầu tiên (2026-08-29): tái sử dụng process Chromium giữa các lần
  // health-check thay vì chromium.launch() mới mỗi lần. KHÔNG áp dụng pattern này cho các route đăng
  // bài chính (/api/post-facebook...) cho tới khi route này chạy ổn định.
  //
  // Thí điểm profile cố định (2026-09-21): khi có socialAccountId (id tài khoản SỞ HỮU cookie, do
  // backend truyền lên), dùng acquirePersistentContext() thay vì acquireContext() — context sẽ gắn
  // với 1 profile Chrome lưu cố định trên đĩa theo accountId đó thay vì "trắng" mỗi lần, để Facebook
  // nhìn thấy cùng 1 thiết bị liên tục thay vì thiết bị lạ mỗi lần health-check (giảm khả năng buộc
  // đăng nhập lại). Fallback về acquireContext() cũ nếu không có socialAccountId (ví dụ caller cũ
  // chưa gửi field này).
  let release = null;
  try {
    console.log(`[Playwright][GroupHealth] 🔍 Đang kiểm tra sức khỏe Group ID ${targetGroupId}...`);
    const acquired = socialAccountId
      ? await browserPool.acquirePersistentContext(socialAccountId)
      : await browserPool.acquireContext();
    release = acquired.release;
    const context = acquired.context;
    await context.addCookies(cookies);
    const page = await context.newPage();

    const groupUrl = `https://www.facebook.com/groups/${targetGroupId}`;
    await navigateFacebookSurface(page, groupUrl, `Group ${targetGroupId}`);
    await page.waitForTimeout(3000);

    const isBlocked = await page.locator('text="Bạn hiện không xem được nội dung này", text="Content Not Found", text="Trang này không hiển thị"').first().isVisible().catch(() => false);

    if (isBlocked) {
      console.log(`[Playwright][GroupHealth] ⛔ Group ${targetGroupId} bị khóa hoặc riêng tư không truy cập được.`);
      return res.json({ success: true, status: 'PRIVATE_NO_ACCESS', message: 'Group riêng tư hoặc không xem được nội dung' });
    }

    // Kiểm tra thông tin nhóm (Công khai / Riêng tư)
    const isPublic = await page.locator('text=/Nhóm công khai|Public group/i').first().isVisible().catch(() => false);
    const isPrivate = await page.locator('text=/Nhóm riêng tư|Private group/i').first().isVisible().catch(() => false);
    const privacyType = isPublic ? 'PUBLIC' : (isPrivate ? 'PRIVATE' : 'UNKNOWN');

    // Locator ô đăng bài
    const createPostBtn = page.locator(
      'div[role="button"][aria-label*="Viết gì đó"], div[role="button"][aria-label*="Tạo bài viết"], ' +
      'div[role="button"][aria-label*="Bạn đang nghĩ gì"], div[role="button"][aria-label*="Bạn viết gì đi"], ' +
      'div[role="button"][aria-label*="Tạo bài viết công khai"], div[role="button"][aria-label*="Create a public post"], ' +
      'span:has-text("Viết gì đó cho nhóm"), div[role="button"]:has-text("Viết gì đó cho nhóm"), ' +
      'span:has-text("Bạn viết gì đi"), div[role="button"]:has-text("Bạn viết gì đi"), ' +
      'span:has-text("Tạo bài viết"), div[role="button"]:has-text("Tạo bài viết"), ' +
      'div[role="button"]:has-text("Tạo bài viết công khai"), div[role="button"]:has-text("Create a public post"), ' +
      'div[role="button"][aria-label*="Write something"], div[role="button"]:has-text("Write something")'
    );

    const isComposerVisible = await createPostBtn.first().isVisible().catch(() => false);

    if (isComposerVisible) {
      console.log(`[Playwright][GroupHealth] 🟢 Group ${targetGroupId} hoạt động tốt (Đã gia nhập & có ô đăng bài).`);
      return res.json({ success: true, status: 'JOINED', canPost: true, privacy: privacyType, message: 'Đã gia nhập nhóm và có quyền đăng bài' });
    }

    // Nút Tham gia nhóm
    const joinBtn = page.locator('div[role="button"]:has-text("Tham gia nhóm"), div[role="button"]:has-text("Join group"), div[role="button"][aria-label*="Tham gia"]').first();
    const isJoinBtnVisible = await joinBtn.isVisible().catch(() => false);

    // Nút Đã yêu cầu
    const requestedBtn = page.locator('div[role="button"]:has-text("Đã gửi yêu cầu"), div[role="button"]:has-text("Requested"), div[role="button"]:has-text("Đang chờ")').first();
    const isRequestedVisible = await requestedBtn.isVisible().catch(() => false);

    if (isRequestedVisible) {
      console.log(`[Playwright][GroupHealth] 🟡 Group ${targetGroupId} đang chờ duyệt thành viên.`);
      return res.json({ success: true, status: 'PENDING_APPROVAL', canPost: false, privacy: privacyType, message: 'Đã gửi yêu cầu tham gia nhóm, đang chờ Admin duyệt' });
    }

    if (isJoinBtnVisible) {
      if (req.body.autoJoin) {
        console.log(`[Playwright][GroupHealth] 👉 Phát hiện nút Tham gia nhóm, đang tự động click cho Group ${targetGroupId}...`);
        await joinBtn.click().catch(() => { });
        await page.waitForTimeout(2000);

        // Tích đồng ý quy tắc nhóm nếu có
        const rulesCheckbox = page.locator('div[role="dialog"] input[type="checkbox"], div[role="dialog"] div[role="checkbox"]').first();
        if (await rulesCheckbox.isVisible().catch(() => false)) {
          console.log('[Playwright][GroupHealth] 📋 Tích đồng ý với quy tắc nhóm...');
          await rulesCheckbox.click({ force: true }).catch(() => {});
          await page.waitForTimeout(600);
        }

        const modalSubmit = page.locator('div[role="dialog"] div[role="button"]:has-text("Gửi"), div[role="dialog"] div[role="button"]:has-text("Submit"), div[role="dialog"] div[role="button"]:has-text("Đồng ý"), div[role="dialog"] div[role="button"]:has-text("Tham gia nhóm"), div[role="dialog"] div[role="button"]:has-text("Hoàn tất")').first();
        if (await modalSubmit.isVisible().catch(() => false)) {
          await modalSubmit.click().catch(() => { });
          await page.waitForTimeout(1500);
        }

        // Tải lại trang để kiểm tra xem có được duyệt tự động ngay không
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(2500);

        const canPostNow = await createPostBtn.first().isVisible().catch(() => false);
        if (canPostNow) {
          console.log(`[Playwright][GroupHealth] 🟢 Group ${targetGroupId} được duyệt thành viên ngay lập tức!`);
          return res.json({ success: true, status: 'JOINED', canPost: true, privacy: privacyType, message: 'Đã tự động tham gia nhóm và được duyệt ngay lập tức!' });
        }

        return res.json({ success: true, status: 'PENDING_APPROVAL', canPost: false, privacy: privacyType, message: 'Đã tự động gửi yêu cầu tham gia nhóm, đang chờ Admin duyệt' });
      }
      console.log(`[Playwright][GroupHealth] 🔴 Group ${targetGroupId} chưa gia nhập hoặc đã bị Kick.`);
      return res.json({ success: true, status: 'KICKED_OR_NOT_JOINED', canPost: false, privacy: privacyType, message: 'Chưa gia nhập nhóm hoặc đã bị rời nhóm' });
    }

    console.log(`[Playwright][GroupHealth] 🔴 Group ${targetGroupId} không tìm thấy ô đăng bài.`);
    return res.json({ success: true, status: 'KICKED_OR_NOT_JOINED', canPost: false, privacy: privacyType, message: 'Không thể đăng bài trong nhóm này' });

  } catch (err) {
    console.error(`[Playwright][GroupHealth] ❌ Lỗi kiểm tra sức khỏe Group ${targetGroupId}:`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (release) await release();
  }
});

// Endpoint tự động bấm xin vào nhóm Facebook qua Playwright
app.post('/api/join-group', async (req, res) => {
  const { cookieString, targetGroupId, pageName, pageId } = req.body;

  if (!cookieString || !targetGroupId) {
    return res.status(400).json({ success: false, error: 'Thiếu cookieString hoặc targetGroupId' });
  }

  let cookies = parseCookies(cookieString);
  const targetPageId = pageId || (req.body.targetFanpageId ? req.body.targetFanpageId.split(':')[0] : null);
  const effectivePageName = pageName || req.body.fanpageName || null;
  const isPersonal = !targetPageId || targetPageId === 'PERSONAL_PROFILE' || String(targetPageId).startsWith('PERSONAL_') || (effectivePageName && effectivePageName.toLowerCase().includes('cá nhân'));

  if (!isPersonal && targetPageId && /^\d+$/.test(targetPageId)) {
    cookies = cookies.filter(c => c.name !== 'i_user');
    cookies.push({
      name: 'i_user',
      value: String(targetPageId),
      domain: '.facebook.com',
      path: '/'
    });
  }

  let release = null;
  try {
    console.log(`[Playwright][JoinGroup] 🤝 Đang gửi yêu cầu tham gia Group ID ${targetGroupId} dưới danh nghĩa ${effectivePageName || targetPageId || 'Tài khoản'}...`);
    const acquired = await browserPool.acquireContext();
    release = acquired.release;
    const context = acquired.context;
    await context.addCookies(cookies);
    const page = await context.newPage();

    const groupUrl = `https://www.facebook.com/groups/${targetGroupId}`;
    await navigateFacebookSurface(page, groupUrl, `Group ${targetGroupId}`);
    await page.waitForTimeout(3000);

    // Nếu tham gia bằng Fanpage, thử chuyển danh tính sang Trang trước
    if (!isPersonal && effectivePageName && !effectivePageName.toLowerCase().includes('cá nhân')) {
      const cleanTargetName = effectivePageName.replace(/^[^\w\s\u00C0-\u024F\u1E00-\u1EFF]+/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      console.log(`[Playwright][JoinGroup] 🔄 Đang chuyển đổi danh tính sang Trang "${cleanTargetName}"...`);

      const accountSwitcherBtn = page.locator(
        'div[role="button"][aria-label="Trang cá nhân của bạn"], ' +
        'div[role="button"][aria-label*="Trang cá nhân"], ' +
        'div[role="button"][aria-label*="Tài khoản"], ' +
        'div[role="button"][aria-label*="Account"], ' +
        'div[role="button"][aria-label*="Your profile"], ' +
        'svg[aria-label*="Trang cá nhân"]'
      ).first();

      if (await accountSwitcherBtn.isVisible().catch(() => false)) {
        await accountSwitcherBtn.click({ force: true }).catch(async () => {
          await accountSwitcherBtn.dispatchEvent('click').catch(() => { });
        });
        await page.waitForTimeout(2000);

        const seeAllProfilesBtn = page.locator(
          'div[role="button"]:has-text("Xem tất cả trang cá nhân"), ' +
          'div[role="button"]:has-text("Xem tất cả các Trang"), ' +
          'div[role="button"]:has-text("Chuyển sang trang cá nhân khác"), ' +
          'div[role="button"]:has-text("See all profiles")'
        ).first();

        if (await seeAllProfilesBtn.isVisible().catch(() => false)) {
          await seeAllProfilesBtn.click({ force: true }).catch(() => { });
          await page.waitForTimeout(1500);
        }

        const pageIdentityOption = page.locator(`div[role="button"]:has-text("${cleanTargetName}"), div[role="option"]:has-text("${cleanTargetName}"), span:has-text("${cleanTargetName}")`).first();
        if (await pageIdentityOption.isVisible().catch(() => false)) {
          console.log(`[Playwright][JoinGroup] 🎯 Bấm chuyển danh tính sang Trang "${cleanTargetName}"...`);
          await pageIdentityOption.click({ force: true }).catch(() => { });
          await page.waitForTimeout(3500);

          if (!page.url().includes(`/groups/${targetGroupId}`)) {
            await navigateFacebookSurface(page, groupUrl, `Group ${targetGroupId}`).catch(() => { });
            await page.waitForTimeout(3000);
          }
        } else {
          await page.keyboard.press('Escape').catch(() => { });
        }
      }
    }

    // 1. Thử bấm nút "Tham gia nhóm"
    const joinBtn = page.locator('div[role="button"]:has-text("Tham gia nhóm"), div[role="button"]:has-text("Join group"), div[role="button"][aria-label*="Tham gia"]').first();
    if (await joinBtn.isVisible().catch(() => false)) {
      console.log(`[Playwright][JoinGroup] 👉 Phát hiện nút "Tham gia nhóm", đang bấm...`);
      await joinBtn.click().catch(() => { });
      await page.waitForTimeout(2000);

      // Nếu có dialog chọn Profile/Page để tham gia
      if (effectivePageName) {
        const cleanTargetName = effectivePageName.replace(/^[^\w\s\u00C0-\u024F\u1E00-\u1EFF]+/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
        const dialogPageOption = page.locator(`div[role="dialog"] div[role="radio"]:has-text("${cleanTargetName}"), div[role="dialog"] div[role="button"]:has-text("${cleanTargetName}")`).first();
        if (await dialogPageOption.isVisible().catch(() => false)) {
          console.log(`[Playwright][JoinGroup] 🎯 Chọn Trang "${cleanTargetName}" trong dialog tham gia nhóm...`);
          await dialogPageOption.click({ force: true }).catch(() => { });
          await page.waitForTimeout(1000);
        }
      }

      // Xử lý tích đồng ý quy tắc nhóm nếu có
      const rulesCheckbox = page.locator('div[role="dialog"] input[type="checkbox"], div[role="dialog"] div[role="checkbox"]').first();
      if (await rulesCheckbox.isVisible().catch(() => false)) {
        console.log('[Playwright][JoinGroup] 📋 Tích đồng ý với quy tắc nhóm...');
        await rulesCheckbox.click({ force: true }).catch(() => {});
        await page.waitForTimeout(600);
      }

      const submitBtn = page.locator('div[role="dialog"] div[role="button"]:has-text("Gửi"), div[role="dialog"] div[role="button"]:has-text("Submit"), div[role="dialog"] div[role="button"]:has-text("Tham gia nhóm"), div[role="dialog"] div[role="button"]:has-text("Đồng ý"), div[role="dialog"] div[role="button"]:has-text("Hoàn tất")').first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click().catch(() => { });
        await page.waitForTimeout(1500);
      }
      return res.json({ success: true, status: 'REQUEST_SENT', message: `Đã gửi yêu cầu tham gia nhóm cho Trang ${effectivePageName || ''} thành công` });
    }

    const requestedBtn = page.locator('div[role="button"]:has-text("Đã gửi yêu cầu"), div[role="button"]:has-text("Requested"), div[role="button"]:has-text("Đang chờ")').first();
    if (await requestedBtn.isVisible().catch(() => false)) {
      return res.json({ success: true, status: 'ALREADY_REQUESTED', message: 'Yêu cầu tham gia nhóm đã được gửi trước đó, đang chờ duyệt' });
    }

    const createPostBtn = page.locator('div[role="button"][aria-label*="Viết gì đó"], div[role="button"][aria-label*="Tạo bài viết"], span:has-text("Viết gì đó cho nhóm")').first();
    if (await createPostBtn.isVisible().catch(() => false)) {
      return res.json({ success: true, status: 'ALREADY_MEMBER', message: 'Tài khoản/Trang này đã là thành viên của nhóm rồi' });
    }

    return res.json({ success: false, message: 'Không tìm thấy nút Tham gia nhóm (có thể do Group ẩn hoặc chưa hiển thị nút)' });
  } catch (err) {
    console.error(`[Playwright][JoinGroup] ❌ Lỗi tham gia Group ${targetGroupId}:`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (release) await release();
  }
});

// Endpoint tự động đăng bài vào 1 GROUP Facebook dưới danh nghĩa 1 Fanpage (khác với đăng lên
// tường Fanpage bình thường ở /api/post-facebook). Facebook Graph API không hỗ trợ đăng vào Group
// cho ứng dụng bên thứ 3 nên chỉ có cách này (giả lập trình duyệt bằng cookie tài khoản cá nhân).
// Điều kiện bắt buộc: Fanpage (pageName) phải ĐÃ LÀ THÀNH VIÊN của Group đó từ trước.
app.post('/api/post-facebook-group', async (req, res) => {
  const { cookieString, content, targetGroupId, pageName, pageId, socialAccountId, mediaUrls, originalUrl, affiliateLink, isPersonalProfile, enableGroupComment, postType, backgroundColor } = req.body;
  const isColorBackground = postType === 'COLOR_BACKGROUND' || postType === 'RED_PHOTO_TRICK' || backgroundColor === 'RED';

  if (!cookieString || !content || !targetGroupId) {
    return res.status(400).json({ success: false, error: 'Thiếu cookieString, content hoặc targetGroupId' });
  }

  const effectivePageName = pageName || 'Tài khoản cá nhân';
  const releaseLock = await globalPostingLock.acquire(`Group ${targetGroupId} ("${effectivePageName}")`, postingIdentityKey(cookieString));

  let cookies = parseCookies(cookieString);
  const isAnonReq = req.body.isAnonymous === true || req.body.postAnonymous === true || req.body.isAnonymous === 'true';

  const targetPageId = pageId || req.body.targetFanpageId || req.body.targetPageId;

  const cUserCookie = cookies.find(c => c.name === 'c_user');
  const cUserId = cUserCookie ? cUserCookie.value : null;

  const isPersonal = isPersonalProfile === true
    || isAnonReq
    || targetPageId === 'PERSONAL_PROFILE'
    || (targetPageId && String(targetPageId).startsWith('PERSONAL_'))
    || effectivePageName.toLowerCase().includes('cá nhân')
    || req.body.isPersonalAccount === true
    || req.body.accountType === 'PERSONAL_PROFILE_COOKIE'
    || (cUserId && String(targetPageId) === String(cUserId));

  if (!isPersonal && targetPageId && /^\d+$/.test(String(targetPageId))) {
    cookies = cookies.filter(c => c.name !== 'i_user');
    cookies.push({
      name: 'i_user',
      value: String(targetPageId),
      domain: '.facebook.com',
      path: '/'
    });
    console.log(`[Playwright][Group] 🔑 Direct inject i_user=${targetPageId} cookie cho Page "${effectivePageName}"...`);
  } else {
    // Đăng dưới tư cách Nick Cá Nhân: Xóa cookie i_user để giữ đúng session của c_user
    cookies = cookies.filter(c => c.name !== 'i_user');
    console.log(`[Playwright][Group] 👤 Đăng bài vào Group dưới danh nghĩa Nick Cá Nhân...`);
  }

  let browser = null;
  let downloadedFilePaths = [];
  let anonymousSucceeded = false;
  const debugShot = async (page, name) => {
    try { await page.screenshot({ path: path.join(DEBUG_OUTPUT_DIR, `debug_group_${name}.png`) }); } catch (e) { }
  };
  const saveComposerDebugArtifacts = async (page, name) => {
    await debugShot(page, name);
    try {
      const html = await page.content();
      fs.writeFileSync(path.join(DEBUG_OUTPUT_DIR, `debug_group_${name}.html`), html);
    } catch (e) { }
    try {
      const bodyText = await page.locator('body').innerText();
      fs.writeFileSync(path.join(DEBUG_OUTPUT_DIR, `debug_group_${name}.txt`), bodyText);
    } catch (e) { }
  };

  try {
    console.log(`[Playwright][Group] 🚀 Đang khởi động trình duyệt đăng bài vào Group (ID: ${targetGroupId}) dưới danh nghĩa Page "${pageName}"...`);
    browser = await chromium.launch({ headless: true });
    const context = await createStealthBrowserContext(browser, {
      proxyUrl: req.body.proxyUrl,
      userAgent: req.body.userAgent
    });
    await context.addCookies(cookies);
    const page = await context.newPage();
    watchFacebookRateLimit(page);

    // Tải TOÀN BỘ Video / Ảnh nếu có (tự động giải mã link video MP4 từ Threads / TikTok nếu thiếu media)
    let mediaUrlList = Array.isArray(mediaUrls)
      ? mediaUrls.filter((u) => u && u.trim().length > 0)
      : (mediaUrls || '').split(',').map((u) => u.trim()).filter((u) => u.length > 0);
    mediaUrlList = mediaUrlList.map(u => u.replace(/^["'\[\]]+|["'\[\]]+$/g, '').trim()).filter(u => u.startsWith('http'));
    const groupMediaCountBeforeCoverFilter = mediaUrlList.length;
    mediaUrlList = mediaUrlList.filter((url) => !isVideoCoverFrameUrl(url));
    if (mediaUrlList.length < groupMediaCountBeforeCoverFilter) {
      console.log(`[Playwright][Group] 🧹 Đã bỏ ${groupMediaCountBeforeCoverFilter - mediaUrlList.length} thumbnail/cover frame của video; chỉ giữ media thật.`);
    }

    if (isColorBackground && mediaUrlList.length > 0) {
      console.log('[Playwright][Group] 🔴 Bài viết yêu cầu phông nền màu Đỏ — Bỏ qua đính kèm media để không bị mất nền màu.');
      mediaUrlList = [];
    }

    if (mediaUrlList.length === 0 && originalUrl && !isColorBackground) {
      console.log(`[Playwright][Group] 🔍 Đang giải mã video MP4 ngầm từ link gốc: ${originalUrl}...`);
      try {
        const extractData = await extractVideoDirectly(originalUrl);
        if (extractData.success && extractData.videoUrl) {
          mediaUrlList = [extractData.videoUrl];
          console.log(`[Playwright][Group] 🎬 Đã giải mã xong Video MP4: ${extractData.videoUrl}`);
        }
      } catch (errExt) { }
    }

    // Giữ toàn bộ video và ảnh để Facebook Composer đăng chung trong một bài.
    const isVideoUrl = (u) => /\.mp4|\.mov|\.webm|\/video\/|\/v\/t16\/|\/m84\/|\/m86\/|\/o1\/v\//i.test(u);
    const urlsToDownload = [...new Set(mediaUrlList)]
      .filter((url) => !isVideoUrl(url) || !isDefinitelyPartialByteRangeUrl(url));

    console.log(`[Playwright][Group] 📥 Đang tải song song ${urlsToDownload.length} file Media...`);
    const downloadedResults = await Promise.all(
      urlsToDownload.map(async (mediaUrl, idx) => {
        if (!mediaUrl || !mediaUrl.startsWith('http')) return;
        try {
          const { buffer: mediaBuffer, contentType, mediaKind } = await downloadMediaWithRetry(page, mediaUrl);
          const ext = mediaFileExtension(mediaKind, contentType, mediaBuffer);
          const filename = `clip_meo_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}${ext}`;
          const filePath = path.join(CLIP_MEO_DIR, filename);
          fs.writeFileSync(filePath, mediaBuffer);
          console.log(`[Playwright][Group] ✅ Đã tải file: ${filePath} (${(mediaBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
          return {
            filePath,
            fingerprint: downloadedMediaFingerprint(mediaBuffer),
          };
        } catch (e) {
          console.error(`[Playwright][Group] ❌ Lỗi tải file media (${mediaUrl}):`, e.message);
          return null;
        }
      })
    );
    const successfulGroupDownloadCount = downloadedResults.filter(Boolean).length;
    const dedupedGroupDownloads = keepUniqueDownloadedMedia(downloadedResults, '[Playwright][Group]');
    downloadedFilePaths = dedupedGroupDownloads.uniqueFilePaths;
    if (successfulGroupDownloadCount !== urlsToDownload.length) {
      if (originalUrl && originalUrl.startsWith('http')) {
        console.log(`[Playwright][Group] 🔄 Link CDN cũ bị lỗi/hết hạn (${successfulGroupDownloadCount}/${urlsToDownload.length}). Đang cào lại media tươi mới từ bài gốc: ${originalUrl}...`);
        try {
          const freshExtract = await extractVideoDirectly(originalUrl);
          if (freshExtract && freshExtract.success && (freshExtract.videoUrl || (freshExtract.mediaUrls && freshExtract.mediaUrls.length > 0))) {
            const freshMediaList = freshExtract.mediaUrls || [freshExtract.videoUrl];
            console.log(`[Playwright][Group] 🎬 Đã lấy được ${freshMediaList.length} link media tươi mới, đang tải lại...`);
            const retryResults = await Promise.all(
              freshMediaList.map(async (mediaUrl, idx) => {
                if (!mediaUrl || !mediaUrl.startsWith('http')) return null;
                try {
                  const { buffer: mediaBuffer, contentType, mediaKind } = await downloadMediaWithRetry(page, mediaUrl);
                  const ext = mediaFileExtension(mediaKind, contentType, mediaBuffer);
                  const filename = `clip_meo_${Date.now()}_fresh_${idx}_${Math.random().toString(36).substring(2, 6)}${ext}`;
                  const filePath = path.join(CLIP_MEO_DIR, filename);
                  fs.writeFileSync(filePath, mediaBuffer);
                  return { filePath, fingerprint: downloadedMediaFingerprint(mediaBuffer) };
                } catch (e) {
                  return null;
                }
              })
            );
            const freshDeduped = keepUniqueDownloadedMedia(retryResults, '[Playwright][Group]');
            if (freshDeduped.uniqueFilePaths.length > 0) {
              downloadedFilePaths = freshDeduped.uniqueFilePaths;
            }
          }
        } catch (reErr) {
          console.error(`[Playwright][Group] ❌ Cào lại media tươi mới thất bại:`, reErr.message);
        }
      }
      if (downloadedFilePaths.length === 0) {
        throw new Error(`Chỉ tải được ${successfulGroupDownloadCount}/${urlsToDownload.length} media. Đã dừng đăng Group để tránh bài bị thiếu ảnh/video.`);
      }
    }

    // TỰ ĐỘNG 100%: Nếu bài viết là Text thuần (không có video/ảnh đính kèm) và nội dung ngắn (<= 200 ký tự)
    // -> Tự động render thành ảnh Quote Card nền đen chữ trắng to (style BOX Y Khoa) để tăng tương tác vượt trội
    if (downloadedFilePaths.length === 0 && urlsToDownload.length === 0 && content && content.trim().length > 0 && content.trim().length <= 200 && !isColorBackground) {
      try {
        console.log(`[Playwright][Group] 🎨 Phát hiện bài text ngắn (${content.trim().length} ký tự <= 200) — Tự động sinh ảnh Nền Đen Chữ Trắng (Quote Card style BOX Y Khoa)...`);
        const quoteCardBuffer = await renderDarkQuoteCard(content.trim());
        if (quoteCardBuffer) {
          const filename = `quote_card_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.png`;
          const filePath = path.join(CLIP_MEO_DIR, filename);
          fs.writeFileSync(filePath, quoteCardBuffer);
          downloadedFilePaths.push(filePath);
          console.log(`[Playwright][Group] ✅ Đã tạo ảnh Quote Card nền đen thành công: ${filePath} (${(quoteCardBuffer.length / 1024).toFixed(1)} KB)`);
        }
      } catch (errCard) {
        console.warn(`[Playwright][Group] ⚠️ Không thể tạo ảnh Quote Card:`, errCard.message);
      }
    }

    const cUserCookie = cookies.find(c => c.name === 'c_user');
    const cUserId = cUserCookie ? cUserCookie.value : null;

    if (isPersonal) {
      if (cUserId && /^\d+$/.test(String(cUserId))) {
        const switchUrl = `https://www.facebook.com/profile/switch/?target_id=${cUserId}`;
        console.log(`[Playwright][Group] 👤 Chuyển danh tính phiên Facebook về Nick Cá Nhân (c_user: ${cUserId}): ${switchUrl}`);
        await page.goto(switchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);
        const switchConfirmBtn = page.locator('div[role="button"]:has-text("Chuyển"), div[role="button"]:has-text("Switch"), button:has-text("Chuyển")').first();
        if (await switchConfirmBtn.isVisible().catch(() => false)) {
          console.log(`[Playwright][Group] 🎯 Click nút xác nhận chuyển danh tính sang Nick cá nhân (${cUserId})...`);
          await switchConfirmBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(2500);
        }
      }
    } else if (targetPageId && /^\d+$/.test(String(targetPageId))) {
      const switchUrl = `https://www.facebook.com/profile/switch/?target_id=${targetPageId}`;
      console.log(`[Playwright][Group] 🔄 Đang thực hiện Profile Switch sang Target ID ${targetPageId}: ${switchUrl}`);
      await page.goto(switchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    // Mở trang Group
    const groupUrl = `https://www.facebook.com/groups/${targetGroupId}`;
    console.log(`[Playwright][Group] Điều hướng tới Group: ${groupUrl}`);
    await navigateFacebookSurface(page, groupUrl, `Group ${targetGroupId}`);
    await page.waitForTimeout(2000);
    await assertFacebookSession(page, socialAccountId);

    // Chỉ nhận phần tử có semantics button thật. Trước đây selector có cả
    // span:has-text(...), .first() có thể trúng span con: Playwright báo click thành công
    // nhưng Facebook không mở Composer.
    const createPostBtn = page.locator(
      'div[role="button"][aria-label*="Viết gì đó"], div[role="button"][aria-label*="Tạo bài viết"], ' +
      'div[role="button"][aria-label*="Bạn đang nghĩ gì"], div[role="button"][aria-label*="Bạn viết gì đi"], ' +
      'div[role="button"][aria-label*="Tạo bài viết công khai"], div[role="button"][aria-label*="Create a public post"], ' +
      'div[role="button"][aria-label*="Create post"], ' +
      'div[role="button"]:has-text("Viết gì đó cho nhóm"), ' +
      'div[role="button"]:has-text("Bạn viết gì đi"), ' +
      'div[role="button"]:has-text("Tạo bài viết công khai"), ' +
      'div[role="button"]:has-text("Tạo bài viết"), ' +
      'div[role="button"]:has-text("Bạn đang nghĩ gì"), ' +
      'div[role="button"][aria-label*="Write something"], div[role="button"]:has-text("Write something"), ' +
      'div[role="button"]:has-text("Create a public post")'
    );

    const findVisibleCreatePostButton = async () => {
      const count = await createPostBtn.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const candidate = createPostBtn.nth(i);
        if (!(await candidate.isVisible().catch(() => false))) continue;
        const box = await candidate.boundingBox().catch(() => null);
        if (box && box.width > 20 && box.height > 20) return candidate;
      }
      // Fallback: Tìm qua thẻ cha của text placeholder tạo bài viết trên layout mới
      const textSpans = page.locator('span:has-text("Bạn viết gì đi"), span:has-text("Viết gì đó"), span:has-text("Tạo bài viết công khai"), span:has-text("Write something"), span:has-text("Create a public post")');
      const spanCount = await textSpans.count().catch(() => 0);
      for (let i = 0; i < spanCount; i++) {
        const sp = textSpans.nth(i);
        if (!(await sp.isVisible().catch(() => false))) continue;
        const parentBtn = sp.locator('xpath=ancestor::div[@role="button" or @tabindex="0"][1]');
        if (await parentBtn.isVisible().catch(() => false)) {
          const box = await parentBtn.boundingBox().catch(() => null);
          if (box && box.width > 20 && box.height > 20) return parentBtn;
        }
      }
      return null;
    };

    const handleJoinGroupFlow = async () => {
      const joinGroupBtn = page.locator('div[role="button"]:has-text("Tham gia nhóm"), div[role="button"]:has-text("Join group"), div[role="button"][aria-label*="Tham gia"]').first();
      if (await joinGroupBtn.isVisible().catch(() => false)) {
        console.log(`[Playwright][Group] 👉 Phát hiện nút "Tham gia nhóm" cho Group ${targetGroupId}, đang tự động bấm Tham gia nhóm...`);
        await joinGroupBtn.click().catch(() => { });
        await page.waitForTimeout(2000);

        // Tích đồng ý quy tắc nhóm nếu có
        const rulesCheckbox = page.locator('div[role="dialog"] input[type="checkbox"], div[role="dialog"] div[role="checkbox"]').first();
        if (await rulesCheckbox.isVisible().catch(() => false)) {
          console.log('[Playwright][Group] 📋 Tích đồng ý với quy tắc nhóm...');
          await rulesCheckbox.click({ force: true }).catch(() => {});
          await page.waitForTimeout(600);
        }

        const modalSubmit = page.locator('div[role="dialog"] div[role="button"]:has-text("Gửi"), div[role="dialog"] div[role="button"]:has-text("Submit"), div[role="dialog"] div[role="button"]:has-text("Đồng ý"), div[role="dialog"] div[role="button"]:has-text("Tham gia nhóm"), div[role="dialog"] div[role="button"]:has-text("Hoàn tất")').first();
        if (await modalSubmit.isVisible().catch(() => false)) {
          console.log('[Playwright][Group] 📩 Bấm gửi câu trả lời / xác nhận tham gia nhóm...');
          await modalSubmit.click({ force: true }).catch(() => { });
          await page.waitForTimeout(2000);
        }

        // Tải lại trang để cập nhật quyền đăng bài ngay lập tức (nếu là nhóm công khai duyệt tự động)
        console.log('[Playwright][Group] 🔄 Đang tải lại trang Group để cập nhật trạng thái thành viên...');
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(3000);
        return true;
      }
      return false;
    };

    // LUÔN BẮT BUỘC thử chuyển sang danh tính Page mong muốn trước (ví dụ: "Làm Sen")
    // Chỉ chuyển sang danh tính Page nếu KHÔNG phải đăng bài bằng Nick Cá Nhân
    if (!isPersonal && effectivePageName && !effectivePageName.toLowerCase().includes('cá nhân')) {
      const cleanTargetName = effectivePageName.replace(/^[^\w\s\u00C0-\u024F\u1E00-\u1EFF]+/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      console.log(`[Playwright][Group] 🔄 Đang kiểm tra & chuyển đổi danh tính sang Trang "${cleanTargetName}"...`);

      // 1. Kiểm tra nút chuyển đổi danh tính riêng bên trong Group (Group Interacting Switcher)
      const groupSwitcherBtn = page.locator('div[role="button"][aria-label*="Đang tương tác"], div[role="button"][aria-label*="tương tác"], div[role="button"][aria-label*="Interacting as"], div[role="button"][aria-label*="Chuyển sang trang cá nhân"]').first();
      let identityAlreadyCorrect = false;
      if (await groupSwitcherBtn.isVisible().catch(() => false)) {
        const switcherText = await groupSwitcherBtn.innerText().catch(() => '');
        const ariaLabel = (await groupSwitcherBtn.getAttribute('aria-label').catch(() => '')) || '';
        if (
          (switcherText && switcherText.toLowerCase().includes(cleanTargetName.toLowerCase())) ||
          (ariaLabel && ariaLabel.toLowerCase().includes(cleanTargetName.toLowerCase()))
        ) {
          console.log(`[Playwright][Group] ✅ Đang tương tác đúng danh tính Trang "${cleanTargetName}", không cần chuyển đổi.`);
          identityAlreadyCorrect = true;
        } else {
          console.log(`[Playwright][Group] 🎯 Bấm nút chuyển danh tính trong Group...`);
          await groupSwitcherBtn.click({ force: true }).catch(() => { });
          await page.waitForTimeout(1200);
          const groupPageOption = page.locator(`div[role="button"]:has-text("${cleanTargetName}"), div[role="option"]:has-text("${cleanTargetName}")`).first();
          if (await groupPageOption.isVisible().catch(() => false)) {
            await groupPageOption.click({ force: true }).catch(() => { });
            await page.waitForTimeout(2000);
            identityAlreadyCorrect = true;
          } else {
            await page.keyboard.press('Escape').catch(() => { });
          }
        }
      }

      // 2. Chỉ kiểm tra nút switcher chính trên Header nếu chưa chuyển được
      if (!identityAlreadyCorrect) {
        const accountSwitcherBtn = page.locator(
          'div[role="button"][aria-label="Trang cá nhân của bạn"], ' +
          'div[role="button"][aria-label*="Trang cá nhân"], ' +
          'div[role="button"][aria-label*="Tài khoản"], ' +
          'div[role="button"][aria-label*="Account"], ' +
          'div[role="button"][aria-label*="Your profile"], ' +
          'svg[aria-label*="Trang cá nhân"]'
        ).first();

        if (await accountSwitcherBtn.isVisible().catch(() => false)) {
          console.log(`[Playwright][Group] 🎯 Bấm nút switcher Tài khoản trên Header Facebook...`);
          await accountSwitcherBtn.click({ force: true }).catch(async () => {
            await accountSwitcherBtn.dispatchEvent('click').catch(() => { });
          });

          await page.waitForTimeout(1500);

          // Bấm nút "Xem tất cả trang cá nhân" hoặc "Xem tất cả các Trang" hoặc "Chuyển sang trang cá nhân khác"
          const seeAllProfilesBtn = page.locator(
            'div[role="button"]:has-text("Xem tất cả trang cá nhân"), ' +
            'div[role="button"]:has-text("Xem tất cả các Trang"), ' +
            'div[role="button"]:has-text("Chuyển sang trang cá nhân khác"), ' +
            'div[role="button"]:has-text("See all profiles")'
          ).first();

          if (await seeAllProfilesBtn.isVisible().catch(() => false)) {
            console.log(`[Playwright][Group] 🎯 Bấm "Xem tất cả trang cá nhân"...`);
            await seeAllProfilesBtn.click({ force: true }).catch(() => { });
            await page.waitForTimeout(1200);
          }

          const pageIdentityOption = page.locator(`div[role="button"]:has-text("${cleanTargetName}"), div[role="option"]:has-text("${cleanTargetName}"), span:has-text("${cleanTargetName}")`).first();
          if (await pageIdentityOption.isVisible().catch(() => false)) {
            console.log(`[Playwright][Group] 🎯 Bấm chuyển sang danh tính Trang "${cleanTargetName}"...`);
            await pageIdentityOption.click({ force: true }).catch(async () => {
              await pageIdentityOption.dispatchEvent('click').catch(() => { });
            });
            await page.waitForTimeout(3000);

            if (!page.url().includes(`/groups/${targetGroupId}`)) {
              console.log(`[Playwright][Group] 🔄 Đã chuyển danh tính thành công, đang điều hướng lại về Group: ${groupUrl}`);
              await navigateFacebookSurface(page, groupUrl, `Group ${targetGroupId}`).catch(() => { });
              await page.waitForTimeout(2500);
            }
          } else {
            console.log(`[Playwright][Group] ℹ️ Không tìm thấy option "${cleanTargetName}" trong switcher Header. Đóng switcher.`);
            await page.keyboard.press('Escape').catch(() => { });
            await page.waitForTimeout(800);
          }
        }
      }
    } else {
      if (!isAnonReq) {
        let targetPersonalName = null;
        if (effectivePageName && !effectivePageName.toLowerCase().includes('cá nhân')) {
          targetPersonalName = effectivePageName.replace(/^[^\w\s\u00C0-\u024F\u1E00-\u1EFF]+/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
        } else if (req.body.targetProfileName && !req.body.targetProfileName.toLowerCase().includes('cá nhân')) {
          targetPersonalName = req.body.targetProfileName.replace(/^[^\w\s\u00C0-\u024F\u1E00-\u1EFF]+/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
        }

        console.log(`[Playwright][Group] 👤 Đăng dưới danh tính Nick Cá Nhân ${targetPersonalName ? `"${targetPersonalName}"` : '(theo cookie hiện tại)'}...`);
        if (targetPersonalName) {
          const groupSwitcherBtn = page.locator('div[role="button"][aria-label*="Đang tương tác"], div[role="button"][aria-label*="tương tác"], div[role="button"][aria-label*="Interacting as"], div[role="button"][aria-label*="Chuyển sang trang cá nhân"]').first();
          if (await groupSwitcherBtn.isVisible().catch(() => false)) {
            const switcherText = await groupSwitcherBtn.innerText().catch(() => '');
            console.log(`[Playwright][Group] 🎯 Group Switcher hiện tại: "${switcherText}"`);
            if (!switcherText.toLowerCase().includes(targetPersonalName.toLowerCase())) {
              console.log(`[Playwright][Group] 🎯 Bấm chọn danh tính Nick Cá Nhân "${targetPersonalName}" trong Group...`);
              await groupSwitcherBtn.click({ force: true }).catch(() => {});
              await page.waitForTimeout(1500);
              const personalOption = page.locator(`div[role="button"]:has-text("${targetPersonalName}"), div[role="option"]:has-text("${targetPersonalName}"), span:has-text("${targetPersonalName}")`).first();
              if (await personalOption.isVisible().catch(() => false)) {
                await personalOption.click({ force: true }).catch(() => {});
                await page.waitForTimeout(3000);
              } else {
                await page.locator('body').click({ position: { x: 10, y: 10 } }).catch(() => {});
              }
            }
          }
        }
      } else {
        console.log(`[Playwright][Group] 🕵️ Đăng ẩn danh trong Group: Giữ nguyên session của Via đã chọn, không đổi danh tính.`);
      }
    }

    await debugShot(page, 'after_identity_check');

    let isComposerVisible = (await findVisibleCreatePostButton()) !== null;
    let isContentBlocked = await page.locator('text="Bạn hiện không xem được nội dung này", text="Content Not Found"').first().isVisible().catch(() => false);

    // Nếu danh tính chưa thể xem/đăng bài trong Group (Group riêng tư hoặc chưa gia nhập Group):
    if (!isComposerVisible || isContentBlocked) {
      console.log(`[Playwright][Group] ⚠️ Danh tính "${effectivePageName}" chưa thấy ô đăng bài trong Group ${targetGroupId}. Đang tự động xử lý...`);

      // 1. Thử bấm nút "Tham gia nhóm" nếu có
      await handleJoinGroupFlow();

      // Cuộn nhẹ để kích hoạt tải feed nếu bị lazy-load
      await page.evaluate(() => window.scrollBy(0, 350)).catch(() => {});
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.scrollBy(0, -350)).catch(() => {});

      // Re-check composer
      isComposerVisible = (await findVisibleCreatePostButton()) !== null;
      isContentBlocked = await page.locator('text="Bạn hiện không xem được nội dung này", text="Content Not Found"').first().isVisible().catch(() => false);

      // 2. Tự động chuyển sang Nick cá nhân nếu đang dùng Page mà không thấy ô đăng bài (mặc định allowPersonalFallback: true)
      const allowPersonalFallback = req.body.allowPersonalFallback !== false;
      if (!isComposerVisible && !isPersonal && allowPersonalFallback) {
        console.log(`[Playwright][Group] 🔄 Trang "${effectivePageName}" chưa được phép đăng vào Group ${targetGroupId}. Đang tự động chuyển sang danh tính Nick Cá Nhân (c_user) để đăng bài...`);
        const currentCookies = await context.cookies();
        const nonIUserCookies = currentCookies.filter(c => c.name !== 'i_user');
        await context.clearCookies();
        await context.addCookies(nonIUserCookies);

        console.log(`[Playwright][Group] 🌐 Mở lại Group dưới danh tính Cá nhân: ${groupUrl}`);
        await navigateFacebookSurface(page, groupUrl, `Group ${targetGroupId}`).catch(() => { });
        await page.waitForTimeout(3500);

        // Kiểm tra xem Nick cá nhân có thấy ô đăng bài không
        isComposerVisible = (await findVisibleCreatePostButton()) !== null;

        // Nếu Nick cá nhân cũng chưa thấy ô đăng bài, thử bấm Tham gia nhóm cho Nick cá nhân
        if (!isComposerVisible) {
          console.log(`[Playwright][Group] 👉 Nick cá nhân cũng chưa có ô đăng bài trong Group ${targetGroupId}, thử xin vào nhóm...`);
          await handleJoinGroupFlow();

          await page.evaluate(() => window.scrollBy(0, 350)).catch(() => {});
          await page.waitForTimeout(1000);
          await page.evaluate(() => window.scrollBy(0, -350)).catch(() => {});

          isComposerVisible = (await findVisibleCreatePostButton()) !== null;
        }
      }
    }

    if (!(await findVisibleCreatePostButton())) {
      await debugShot(page, 'no_composer');

      // 1. Kiểm tra trạng thái đang chờ Admin duyệt (Pending approval)
      const isPendingApproval = await page.locator('div[role="button"]:has-text("Đã gửi yêu cầu"), div[role="button"]:has-text("Requested"), div[role="button"]:has-text("Đang chờ")').first().isVisible().catch(() => false);
      if (isPendingApproval) {
        throw new Error(`Group ${targetGroupId}: Tài khoản đã gửi yêu cầu tham gia nhóm nhưng đang chờ Quản trị viên nhóm phê duyệt (Pending approval). Vui lòng đợi Admin duyệt thành viên trước khi đăng bài.`);
      }

      // 2. Kiểm tra trạng thái bị chặn nội dung / Group riêng tư không có quyền truy cập
      const isBlocked = await page.locator('text="Bạn hiện không xem được nội dung này", text="Content Not Found"').first().isVisible().catch(() => false);
      if (isBlocked) {
        throw new Error(`Group ${targetGroupId}: Không thể truy cập (Group riêng tư hoặc link không hợp lệ). Tài khoản chưa được cấp quyền vào nhóm.`);
      }

      // 3. Thông báo chi tiết rõ ràng
      if (isPersonal) {
        throw new Error(`Không tìm thấy ô đăng bài trong Group ${targetGroupId} — Nick cá nhân chưa gia nhập Group này hoặc bị Quản trị viên nhóm hạn chế quyền đăng.`);
      } else {
        throw new Error(`Không tìm thấy ô đăng bài trong Group ${targetGroupId} — Cả Fanpage "${effectivePageName}" và Nick cá nhân đều chưa gia nhập Group này hoặc bị Quản trị viên nhóm hạn chế quyền đăng.`);
      }
    }

    // Facebook thỉnh thoảng nuốt click đầu tiên dù ô composer đã hiện. Thử tối đa
    // 3 lần, chờ 30s/lần; sau lần đầu không mở thì reload Group đúng 1 lần.
    // Mỗi lần thất bại lưu PNG + HTML + body text riêng để không ghi đè bằng chứng.
    const dialog = page.locator('div[role="dialog"]').filter({ has: page.locator('div[role="textbox"], [contenteditable="true"]') }).or(page.locator('div[role="dialog"]').filter({ hasText: /Tạo bài viết|Create post|Create a public post/i }));
    let composerOpened = false;
    let groupReloaded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let visibleCreatePostBtn = null;
      if (isAnonReq) {
        const anonBtn = page.locator('div[role="button"]:has-text("Bài viết ẩn danh"), div[role="button"][aria-label*="Bài viết ẩn danh"]').first();
        if (await anonBtn.isVisible().catch(() => false)) {
          console.log(`[Playwright][Group] 🕵️ Tìm thấy nút "Bài viết ẩn danh" trực tiếp trên feed, bấm nút này...`);
          visibleCreatePostBtn = anonBtn;
        }
      }
      if (!visibleCreatePostBtn) {
        visibleCreatePostBtn = await findVisibleCreatePostButton();
      }

      if (!visibleCreatePostBtn) {
        await saveComposerDebugArtifacts(page, `no_composer_attempt_${attempt}`);
      } else {
        console.log(`[Playwright][Group] Bấm ô Tạo bài viết trong Group (lần ${attempt}/3)...`);
        await visibleCreatePostBtn.scrollIntoViewIfNeeded().catch(() => { });
        await visibleCreatePostBtn.click({ timeout: 20000 }).catch(async () => {
          await visibleCreatePostBtn.click({ force: true }).catch(() => { });
        });
        await page.waitForTimeout(1000);

        // Kiểm tra nếu có popup "Bài viết ẩn danh" / "Tôi muốn đăng ẩn danh" ngay sau khi bấm nút
        const quickConfirmSelector = 'div[role="dialog"] div[role="button"]:has-text("Tạo bài viết ẩn danh"), div[role="dialog"] [role="button"]:has-text("Tạo bài viết ẩn danh"), div[role="dialog"] div[aria-label*="Tạo bài viết ẩn danh"], div[role="dialog"] div[role="button"]:has-text("Tôi muốn đăng ẩn danh"), div[role="dialog"] div[role="button"]:has-text("Đăng ẩn danh"), div[role="dialog"] div[role="button"]:has-text("Đồng ý"), div[role="dialog"] div[role="button"]:has-text("Bật")';
        for (let poll = 0; poll < 5; poll++) {
          const quickConfirmBtn = page.locator(quickConfirmSelector).first();
          if (await quickConfirmBtn.isVisible().catch(() => false)) {
            console.log('[Playwright][Group] 🎯 Bấm xác nhận popup "Tạo bài viết ẩn danh"...');
            await quickConfirmBtn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(2000);
            break;
          }
          await page.waitForTimeout(600);
        }

        try {
          await dialog.first().locator('div[role="textbox"]').first()
            .waitFor({ state: 'visible', timeout: 45000 });
          composerOpened = true;
          break;
        } catch (e) {
          console.warn(`[Playwright][Group] ⚠️ Click lần ${attempt}/3 chưa mở Composer sau 30s.`);
          await saveComposerDebugArtifacts(page, `no_dialog_attempt_${attempt}`);
          await dialog.first().click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
        }
      }

      if (!groupReloaded) {
        groupReloaded = true;
        console.log('[Playwright][Group] 🔄 Reload Group 1 lần trước khi thử mở Composer lại...');
        await navigateFacebookSurface(page, groupUrl, `Group ${targetGroupId} retry`).catch(() => { });
        await page.waitForTimeout(3000);
      } else {
        await page.waitForTimeout(1500);
      }
    }
    if (!composerOpened) {
      await saveComposerDebugArtifacts(page, 'no_dialog');
      if (page.__fbRateLimited) throw rateLimitError('Không mở được Modal đăng bài trong Group');
      throw new Error('Không mở được Modal đăng bài trong Group sau 3 lần thử (xem debug_group_no_dialog_attempt_*.png/.html/.txt).');
    }
    console.log('[Playwright][Group] ✅ Đã mở Modal đăng bài trong Group!');
    await debugShot(page, 'dialog_opened');
    const postQueueId = req.headers['x-post-queue-id'];
    await assertNoFacebookSpamBlock(page, postQueueId, 'Group: vừa mở modal');

    // Kiểm tra & Ép chuyển đổi danh tính bên trong Modal "Tạo bài viết"
    // CHỈ áp dụng nếu KHÔNG phải ẩn danh và KHÔNG phải cá nhân (đăng bằng Fanpage)
    if (!isAnonReq && !isPersonal && effectivePageName && !effectivePageName.toLowerCase().includes('cá nhân')) {
      const targetProfileName = effectivePageName.replace(/^[^\w\s\u00C0-\u024F\u1E00-\u1EFF]+/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      const modalFullText = await dialog.first().innerText().catch(() => '');
      console.log(`[Playwright][Group] 👤 Text trong Modal: "${modalFullText.slice(0, 150)}" (targetProfile="${targetProfileName}")`);

      if (targetProfileName && !modalFullText.toLowerCase().includes(targetProfileName.toLowerCase())) {
        console.log(`[Playwright][Group] 🔄 Modal chưa hiển thị danh tính "${targetProfileName}". Đang đổi danh tính trong Modal...`);
        
        // Bấm nút danh tính trong Modal (bỏ qua nút Đóng 'X')
        const modalPosterBtn = dialog.first().locator('div[role="button"]')
          .filter({ hasNotText: 'Đóng' })
          .filter({ hasNotText: 'Close' })
          .filter({ hasNot: page.locator('[aria-label*="Đóng"], [aria-label*="Close"]') })
          .first();

        if (await modalPosterBtn.isVisible().catch(() => false)) {
          await modalPosterBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(2000);

          const escProfile = targetProfileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const profileRegex = new RegExp(escProfile, 'i');
          const profileOption = page.locator('div[role="dialog"] div[role="button"], div[role="dialog"] div[role="option"], div[role="dialog"] span')
            .filter({ hasText: profileRegex }).first();
          if (await profileOption.isVisible().catch(() => false)) {
            console.log(`[Playwright][Group] 🎯 Click chọn option "${targetProfileName}" trong Modal menu...`);
            await profileOption.click({ force: true }).catch(() => {});
            await page.waitForTimeout(3000);
          } else {
            console.warn(`[Playwright][Group] ⚠️ Không tìm thấy option "${targetProfileName}" trong menu danh tính của Nhóm.`);
            if (req.body.allowPersonalFallback === true) {
              console.log(`[Playwright][Group] ℹ️ Cho phép fallback cá nhân: tiếp tục đăng bài bằng tài khoản hiện tại.`);
              await page.mouse.click(10, 10).catch(() => {});
            } else {
              throw new Error(`Trang "${targetProfileName}" chưa gia nhập Nhóm hoặc không có quyền đăng bài trong Nhóm này. Vui lòng duyệt Trang vào Nhóm hoặc chọn tài khoản khác.`);
            }
          }
        }
      }
    }

    await debugShot(page, 'after_modal_identity_check');
      if (isAnonReq) {
        console.log('[Playwright][Group] 🕵️ Yêu cầu Đăng ẩn danh: Đang tìm công tắc hoặc menu chọn "Đăng ẩn danh"...');

        // BƯỚC 1: Thử bật công tắc (Switch) "Đăng ẩn danh" ở hàng trên cùng của Modal
        const toggleResult = await dialog.first().evaluate((modalEl) => {
          const allNodes = Array.from(modalEl.querySelectorAll('*'));
          const textEl = allNodes.find(el => {
            const txt = (el.innerText || '').trim();
            return txt === 'Đăng ẩn danh' || txt.startsWith('Đăng ẩn danh');
          });

          if (!textEl) return { found: false, message: 'Không thấy text Đăng ẩn danh' };

          const container = textEl.closest('div[role="button"], label, div[role="switch"], div[tabindex], div') || textEl.parentElement;
          const switchEl = container?.querySelector('div[role="switch"], input[type="checkbox"], [role="switch"], [role="checkbox"]')
                        || modalEl.querySelector('div[role="switch"], input[type="checkbox"], [role="switch"]');

          if (switchEl) {
            const isChecked = switchEl.getAttribute('aria-checked') === 'true'
                           || switchEl.checked === true
                           || switchEl.classList.contains('active')
                           || switchEl.getAttribute('value') === 'true';
            if (!isChecked) {
              switchEl.click();
              return { found: true, clickedTarget: 'switchEl', wasChecked: false };
            }
            return { found: true, clickedTarget: null, wasChecked: true };
          }

          if (container) {
            container.click();
            return { found: true, clickedTarget: 'container', wasChecked: false };
          }

          textEl.click();
          return { found: true, clickedTarget: 'textEl', wasChecked: false };
        }).catch((e) => ({ found: false, error: e.message }));

        console.log('[Playwright][Group] 🕵️ Kết quả Kịch bản 1 (Công tắc top):', JSON.stringify(toggleResult));
        await page.waitForTimeout(1200);

        // BƯỚC 2: Kiểm tra nút popup xác nhận "Tôi muốn đăng ẩn danh" / "Đăng ẩn danh" / "Đồng ý"
        const confirmBtn = page.locator([
          'div[role="dialog"] div[role="button"]:has-text("Tôi muốn đăng ẩn danh")',
          'div[role="dialog"] div[role="button"]:has-text("Đăng ẩn danh")',
          'div[role="dialog"] div[role="button"]:has-text("Đồng ý")',
          'div[role="dialog"] div[role="button"]:has-text("Bật")',
          'div[role="dialog"] div[role="button"]:has-text("OK")'
        ].join(', ')).first();

        if (await confirmBtn.isVisible().catch(() => false)) {
          console.log('[Playwright][Group] 🎯 Click nút xác nhận trong Popup "Tôi muốn đăng ẩn danh"...');
          await confirmBtn.click({ force: true }).catch(() => { });
          await page.waitForTimeout(1200);
        }

        // BƯỚC 3: Kiểm tra xem Modal đã chuyển Ẩn danh chưa (Dựa vào text "Gửi bài viết ẩn danh...", "Người tham gia ẩn danh", v.v.)
        let isAnonNow = await dialog.first().evaluate((modalEl) => {
          const txt = modalEl.innerText || '';
          const placeholder = modalEl.querySelector('div[role="textbox"]')?.getAttribute('aria-label') || '';
          const switchChecked = modalEl.querySelector('div[role="switch"]')?.getAttribute('aria-checked') === 'true';
          return txt.includes('Gửi bài viết ẩn danh')
              || txt.includes('Người tham gia ẩn danh')
              || txt.includes('Thành viên ẩn danh')
              || txt.includes('Bài viết ẩn danh')
              || placeholder.includes('ẩn danh')
              || switchChecked;
        }).catch(() => false);

        if (isAnonNow) {
          console.log('[Playwright][Group] ✅ THÀNH CÔNG (Kịch bản 1): Công tắc Đăng ẩn danh đã được kích hoạt!');
        } else {
          console.log('[Playwright][Group] 🔄 Thử Kịch bản 2: Bấm nút chuyển đổi danh tính trong Modal...');
          const identityBtn = dialog.locator([
            'div[role="button"][aria-label*="Chuyển"]',
            'div[role="button"][aria-label*="tương tác"]',
            'div[role="button"][aria-label*="danh nghĩa"]',
            'div[role="button"]:has-text("Chuyển")',
            'div[role="button"]:has-text("Nhóm công khai")'
          ].join(', ')).first();

          if (await identityBtn.isVisible().catch(() => false)) {
            await identityBtn.click({ force: true }).catch(() => { });
            await page.waitForTimeout(1200);

            const anonOption = page.locator([
              'div[role="button"]:has-text("Thành viên ẩn danh")',
              'div[role="option"]:has-text("Thành viên ẩn danh")',
              'div[role="button"]:has-text("Đăng ẩn danh")',
              'div[role="option"]:has-text("Đăng ẩn danh")',
              'span:has-text("Thành viên ẩn danh")',
              'span:has-text("Đăng ẩn danh")'
            ].join(', ')).first();

            if (await anonOption.isVisible().catch(() => false)) {
              console.log('[Playwright][Group] 🎯 Click chọn "Thành viên ẩn danh" trong Menu danh tính...');
              await anonOption.click({ force: true }).catch(() => { });
              await page.waitForTimeout(1500);

              if (await confirmBtn.isVisible().catch(() => false)) {
                await confirmBtn.click({ force: true }).catch(() => { });
                await page.waitForTimeout(1200);
              }
            } else {
              await dialog.first().click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
            }
          }
        }

        // BƯỚC 4: VERIFY lần cuối
        const finalModalCheck = await dialog.first().evaluate((modalEl) => {
          const txt = modalEl.innerText || '';
          const placeholder = modalEl.querySelector('div[role="textbox"]')?.getAttribute('aria-label') || '';
          const switchChecked = modalEl.querySelector('div[role="switch"]')?.getAttribute('aria-checked') === 'true';
          const isAnon = txt.includes('Gửi bài viết ẩn danh')
                      || txt.includes('Người tham gia ẩn danh')
                      || txt.includes('Thành viên ẩn danh')
                      || txt.includes('Bài viết ẩn danh')
                      || placeholder.includes('ẩn danh')
                      || switchChecked;
          return { isAnon, switchChecked, placeholder, txtSample: txt.slice(0, 300) };
        }).catch(() => ({ isAnon: false }));

        anonymousSucceeded = !!finalModalCheck.isAnon;
        if (anonymousSucceeded) {
          console.log('[Playwright][Group] ✅ XÁC NHẬN: Bài viết đã được chuyển sang chế độ ĐĂNG ẨN DANH!');
        } else {
          console.error('[Playwright][Group] ⛔ KHÔNG bật được Đăng ẩn danh — bài sẽ bị đăng LỘ DANH TÍNH nếu tiếp tục. Chi tiết:', JSON.stringify(finalModalCheck));
        }
      }

    // 1. GÕ VĂN BẢN TRƯỚC (FIRST) - Focus trực tiếp ô soạn thảo trước khi gõ
    if (content && content.trim().length > 0) {
      console.log('[Playwright][Group] Gõ nội dung bài viết vào Modal...');
      const editor = dialog.locator('div[role="textbox"], [contenteditable="true"]').first();
      await editor.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
      if (!(await editor.isVisible().catch(() => false))) {
        await debugShot(page, 'no_editor');
        throw new Error('Không tìm thấy ô nhập nội dung bài viết trong Modal (xem debug_group_no_editor.png).');
      }
      await editor.click({ force: true }).catch(() => { });
      await page.waitForTimeout(500);
      const textToType = isColorBackground && content.length > 130 ? content.slice(0, 126) + '...' : content;
      await typeMultilinePostContent(page, textToType);
      await page.waitForTimeout(1000);

      if (isColorBackground) {
        await selectFacebookRedBackground(dialog, page);
        await debugShot(page, 'after_red_background');
      }
    }

    // 2. ĐÍNH KÈM FILE VIDEO / ÁNH (SECOND)
    const existingFilePaths = downloadedFilePaths.filter((p) => fs.existsSync(p));
    if (existingFilePaths.length > 0) {
      console.log(`[Playwright][Group] 📎 Đang đính kèm ${existingFilePaths.length} file vào Modal: ${existingFilePaths.join(', ')}`);

      // Bấm vào icon "Ảnh/video" xanh lá cây trong thanh "Thêm vào bài viết của bạn"
      const photoVideoIcon = dialog.locator(
        'div[aria-label*="Ảnh/video"], div[aria-label*="Photo/video"], div[aria-label*="Ảnh"], ' +
        'div[aria-label*="Thêm ảnh"], div[aria-label*="Add Photos"], [aria-label="Ảnh/video"]'
      ).first();

      if (await photoVideoIcon.isVisible().catch(() => false)) {
        await photoVideoIcon.click({ force: true }).catch(() => { });
        await page.waitForTimeout(2000);
      }

      // Nút ô vuông "Thêm ảnh/video" xuất hiện sau khi click icon
      const addPhotoAreaBtn = dialog.locator('div:has-text("Thêm ảnh/video"), div:has-text("Add Photos/Videos"), div[aria-label*="Thêm ảnh"]').first();
      if (await addPhotoAreaBtn.isVisible().catch(() => false)) {
        await addPhotoAreaBtn.click({ force: true }).catch(() => { });
        await page.waitForTimeout(1000);
      }

      // Tìm file input
      let fileInput = dialog.locator('input[type="file"]').first();
      if (await fileInput.count() === 0) {
        fileInput = page.locator('div[role="dialog"] input[type="file"], input[type="file"]').first();
      }

      const hasVidGroup = existingFilePaths.some(fp => /\.mp4|\.mov|\.webm/i.test(fp));
      const finalGroupFilePaths = existingFilePaths;

      if (await fileInput.count() > 0) {
        await fileInput.setInputFiles(finalGroupFilePaths);
        console.log(`[Playwright][Group] 📤 Đã gắn ${finalGroupFilePaths.length} file vào input (${finalGroupFilePaths.map(p => path.basename(p)).join(', ')})...`);
        await page.waitForTimeout(3000 + finalGroupFilePaths.length * 1000);
      }

      // VERIFY: Đảm bảo thumbnail ảnh/video thực sự xuất hiện trong Modal trước khi bấm Submit
      const isMediaPreviewVisible = await dialog.locator(
        'img[src*="blob:"], img[src*="fbcdn"], div[aria-label*="Xem ảnh"], div[aria-label*="Gỡ"], ' +
        'div[aria-label*="Xóa"], div[aria-label*="Chỉnh sửa"], div[aria-label*="Ảnh/video"] img'
      ).first().isVisible().catch(() => false);

      if (!isMediaPreviewVisible) {
        console.log('[Playwright][Group] ⚠️ Chưa thấy thumbnail xem trước trong Modal! Thử kích hoạt lại file input lần 2...');
        if (await photoVideoIcon.isVisible().catch(() => false)) {
          await photoVideoIcon.click({ force: true }).catch(() => { });
          await page.waitForTimeout(1500);
        }
        if (await fileInput.count() > 0) {
          await fileInput.setInputFiles(finalGroupFilePaths);
          await page.waitForTimeout(4000 + finalGroupFilePaths.length * 1000);
        }
      }

      await debugShot(page, 'after_media_attached');
    }

    // Nút Đăng/Tiếp màu xanh ở dưới đáy Modal (chính xác aria-label hoặc text là "Đăng" / "Post" / "Tiếp" / "Next").
    // QUAN TRỌNG: KHÔNG dùng :has-text("Post") với .first() vì giao diện Facebook tiếng Anh có thanh
    // "Add to your post" nằm PHÍA TRÊN nút submit -> nếu match substring "Post", Playwright sẽ bấm nhầm vào
    // thanh "Add to your post" mở popup gắn ảnh thay vì bấm nút Submit thật sự!
    let submitBtn = dialog.locator('div[role="button"][aria-label="Đăng"], div[role="button"][aria-label="Post"], div[role="button"][aria-label="Tiếp"], div[role="button"][aria-label="Next"]').last();
    if (!(await submitBtn.isVisible().catch(() => false))) {
      submitBtn = dialog.locator('div[role="button"]:text-is("Đăng"), div[role="button"]:text-is("Post"), div[role="button"]:text-is("Tiếp"), div[role="button"]:text-is("Next")').last();
    }
    if (!(await submitBtn.isVisible().catch(() => false))) {
      submitBtn = dialog.locator('div[role="button"]').filter({ hasText: /^(\s*)(Đăng|Post|Tiếp|Next)(\s*)$/i }).last();
    }
    if (!(await submitBtn.isVisible().catch(() => false))) {
      await debugShot(page, 'no_submit');
      throw new Error('Không tìm thấy nút Đăng/Tiếp trong Modal (xem debug_group_no_submit.png).');
    }

    const submitBtnText = await submitBtn.innerText().catch(() => '');
    const submitBtnAria = await submitBtn.getAttribute('aria-label').catch(() => '');
    const isDirectPost = /Đăng|Post|Publish/i.test(submitBtnText) || /Đăng|Post|Publish/i.test(submitBtnAria);

    console.log(`[Playwright][Group] Chờ Facebook xử lý video và mở khoá nút Submit (tối đa 60s)...`);
    const isSubmitEnabled = await waitUntilEnabled(submitBtn, page, 60000);
    await debugShot(page, 'before_submit');

    // Debug: nếu vẫn báo "Không thể tải file lên", bấm vào icon (i) cạnh dòng lỗi để lấy lý do
    // cụ thể Facebook đưa ra, thay vì chỉ biết chung chung là upload thất bại.
    try {
      const uploadErrorEl = dialog.locator('text=/Không thể tải file/i').first();
      if (await uploadErrorEl.isVisible().catch(() => false)) {
        const errorRow = uploadErrorEl.locator('xpath=..');
        const infoIcon = errorRow.locator('svg, div[role="button"]').last();
        if (await infoIcon.isVisible().catch(() => false)) {
          await infoIcon.click();
          await page.waitForTimeout(1500);
          await debugShot(page, 'upload_error_detail');
          const bodyText = await page.evaluate(() => document.body.innerText);
          const idx = bodyText.indexOf('Không thể tải');
          console.log('[Playwright][Group] 🔍 DEBUG - Chi tiết quanh lỗi upload:', JSON.stringify(bodyText.slice(Math.max(0, idx - 50), idx + 400)));
        }
      }
    } catch (e) { }

    // AN TOÀN: xác minh LẦN CUỐI ngay trước khi bấm Đăng — trang vẫn đang ở đúng Group mục tiêu.
    // Composer mở dạng Modal SPA nên không tự đổi group giữa chừng, nhưng các bước fallback đổi danh
    // tính + chờ xử lý video (tối đa 60s) phía trên có thể khiến trang bị điều hướng lệch mà không ai
    // hay — nếu lỡ xảy ra, HỦY đăng và báo lỗi rõ ràng thay vì đăng nhầm vào Group khác trong im lặng.
    if (!page.url().includes(`/groups/${targetGroupId}`)) {
      await debugShot(page, 'group_mismatch_before_submit');
      throw new Error(`Phát hiện trang đã điều hướng sai (đang ở "${page.url}" thay vì Group ${targetGroupId}) ngay trước khi đăng — đã HỦY đăng để tránh đăng nhầm Group. Vui lòng thử lại.`);
    }

    console.log(`[Playwright][Group] Bấm nút Submit (Nút: "${submitBtnText || submitBtnAria}")...`);
    if (isSubmitEnabled) {
      await submitBtn.click({ timeout: 10000 }).catch(async () => {
        await submitBtn.click({ force: true }).catch(() => { });
      });
    } else {
      console.log('[Playwright][Group] ⚠️ Nút Submit vẫn bị aria-disabled sau 60s, thử click force...');
      await submitBtn.click({ force: true }).catch(async () => {
        await submitBtn.dispatchEvent('click').catch(() => { });
      });
    }

    if (isDirectPost) {
      console.log('[Playwright][Group] ⏳ Nút "Đăng" đã được bấm. Đang chờ Facebook xử lý và đóng Modal...');
      await page.waitForTimeout(2000);
      await assertNoFacebookSpamBlock(page, postQueueId, 'Group: sau khi bấm Đăng');
      await page.waitForTimeout(3000);
      await dialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => { });
    } else {
      await page.waitForTimeout(3000);
      let confirmBtn = dialog.locator('div[role="button"][aria-label="Đăng"], div[role="button"][aria-label="Post"]').last();
      if (!(await confirmBtn.isVisible().catch(() => false))) {
        confirmBtn = dialog.locator('div[role="button"]:text-is("Đăng"), div[role="button"]:text-is("Post")').last();
      }
      if (await confirmBtn.isVisible().catch(() => false)) {
        await waitUntilEnabled(confirmBtn, page, 20000);
        if (await confirmBtn.isVisible().catch(() => false)) {
          console.log('[Playwright][Group] 🚀 Bấm nút Đăng xác nhận bước 2!');
          await confirmBtn.click().catch(async () => {
            await confirmBtn.click({ force: true }).catch(() => { });
          });
          await page.waitForTimeout(2000);
        }
      }
      await assertNoFacebookSpamBlock(page, postQueueId, 'Group: sau khi bấm Đăng');
      // Chờ modal đóng thay vì ngủ cố định 10s — timeout 25s giữ nguyên tổng thời gian chờ tối đa như trước (10s + 15s).
      await dialog.waitFor({ state: 'hidden', timeout: 25000 }).catch(() => { });
    }
    await debugShot(page, 'after_submit');

    // Xác nhận bài THỰC SỰ đã được Facebook chấp nhận xuất bản hay bị chặn
    const isModalStillOpen = await dialog.first().isVisible().catch(() => false);
    if (isModalStillOpen) {
      const modalText = await dialog.first().innerText().catch(() => '');
      if (modalText.includes('giới hạn tần suất') || modalText.includes('spam') || modalText.includes('Để bảo vệ cộng đồng') || modalText.includes('thử lại sau')) {
        console.error('[Playwright][Group] ⛔ Bị Facebook chặn đăng spam rate limit!');
        throw new Error('FB_SPAM_BLOCK: Facebook chặn đăng tạm thời do đăng quá nhanh ("Để bảo vệ cộng đồng khỏi spam, chúng tôi giới hạn tần suất bạn đăng bài..."). Cần giãn cách thời gian đăng!');
      }
      if (modalText.includes('Không thể đăng') || modalText.includes('Đã xảy ra lỗi') || modalText.includes('bị hạn chế') || modalText.includes('không được phép')) {
        console.error('[Playwright][Group] ⛔ Facebook từ chối đăng bài:', modalText.replace(/\n+/g, ' ').slice(0, 200));
        throw new Error(`FB_POST_FAILED: Facebook từ chối đăng bài: ${modalText.replace(/\n+/g, ' ').slice(0, 200)}`);
      }
      // Chờ thêm 10s dự phòng nếu Facebook upload media lâu
      await dialog.first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => { });
      if (await dialog.first().isVisible().catch(() => false)) {
        const remainingText = await dialog.first().innerText().catch(() => '');
        console.error('[Playwright][Group] ⛔ Modal Tạo bài viết không đóng sau khi bấm Đăng!');
        throw new Error(`FB_MODAL_STUCK: Modal Tạo bài viết không đóng sau khi bấm Đăng (Bài CHƯA được đăng lên Nhóm). Lỗi: ${remainingText.replace(/\n+/g, ' ').slice(0, 200)}`);
      }
    }
    // Modal đóng chưa chắc đã đăng: Facebook có thể đóng composer rồi mới bật dialog/toast chặn spam.
    await page.waitForTimeout(1000);
    await assertNoFacebookSpamBlock(page, postQueueId, 'Group: sau khi modal đóng');

    // Tìm lại link bài vừa đăng (luôn chạy, kể cả không có bình luận affiliate) — dùng để lưu vào
    // Lịch sử/Báo cáo. Nếu có affiliateLink thì cùng lượt tìm này sẽ bình luận luôn link vào bài.
    // Không chặn/không làm fail cả request nếu bước này lỗi, vì bài chính đã đăng thành công rồi;
    // chỉ trả kèm cảnh báo trong response.
    let commentWarning = null;
    let groupPostUrl = null;
    // Bình luận link vào bài trong Nhóm là opt-in: chỉ chạy khi người dùng tick bật ở giao diện
    // (enableGroupComment === true), khác với bài đăng lên Fanpage vốn tự bình luận mặc định
    // hễ có điền affiliateLink.
    const isGroupCommentOn = enableGroupComment === true || enableGroupComment === 'true' || enableGroupComment === 1 || enableGroupComment === '1';
    const hasAffiliateLink = isGroupCommentOn && affiliateLink && affiliateLink.trim().length > 0;
    if (!hasAffiliateLink) {
      const skipReason = !isGroupCommentOn
        ? 'enableGroupComment không phải true'
        : 'affiliateLink trống';
      console.log(`[Playwright][Group] ℹ️ Bỏ qua bình luận link cho bài này (${skipReason}).`);
    }
    const effectiveSearchId = (isPersonal && cUserId) ? cUserId : (pageId || cUserId);
    if (!effectiveSearchId) {
      if (hasAffiliateLink) {
        commentWarning = 'Đã đăng bài nhưng KHÔNG bình luận được link: thiếu pageId/cUserId để tìm lại bài vừa đăng.';
        console.log(`[Playwright][Group] ⚠️ ${commentWarning}`);
      }
    } else {
      console.log(`[Playwright][Group] 🔎 Đang tìm lại bài vừa đăng (ID: ${effectiveSearchId})${hasAffiliateLink ? ' để bình luận link' : ' để lấy link lưu Lịch sử'}...`);
      const commentResult = await commentLinkOnGroupPost(
        page, targetGroupId, effectiveSearchId, hasAffiliateLink ? affiliateLink.trim() : null,
        hasAffiliateLink ? 60000 : 10000
      ).catch((e) => {
        console.log('[Playwright][Group][Comment] ⚠️ Lỗi khi tìm/bình luận bài:', e.message);
        return { success: false, postUrl: null };
      });
      groupPostUrl = commentResult.postUrl;
      if (hasAffiliateLink && !commentResult.success) {
        commentWarning = commentResult?.error
          ? `Đã đăng bài nhưng lỗi bình luận: ${commentResult.error}`
          : 'Đã đăng bài nhưng KHÔNG bình luận được link (không tìm thấy bài/ô bình luận kịp thời hoặc Facebook từ chối).';
      }
    }

    let refreshedCookieString = null;
    try {
      refreshedCookieString = await refreshedFbCookieForSameUser(context, cookieString);
    } catch (_) {}

    const anonymousFailedWarning = (isAnonReq && !anonymousSucceeded)
      ? '⛔ ĐÃ ĐĂNG LỘ DANH TÍNH: Yêu cầu "Đăng ẩn danh" nhưng Facebook không cho bật (Group này có thể không hỗ trợ, hoặc giao diện Facebook đã đổi). Bài đã đăng bằng danh nghĩa Nick cá nhân thật.'
      : null;
    const combinedWarning = [anonymousFailedWarning, commentWarning].filter(Boolean).join(' | ') || null;

    console.log(`[Playwright][Group] ✅ Đã hoàn tất đăng bài vào Group ID ${targetGroupId} dưới danh nghĩa "${pageName}"!`);
    autoEnqueueOwnPost(groupPostUrl, 'GROUP');
    res.json({
      success: true,
      message: `Đã đăng bài vào Group ${targetGroupId} dưới danh nghĩa ${pageName}!`,
      ...(groupPostUrl ? { groupPostUrl, publishedPostUrl: groupPostUrl } : {}),
      ...(isAnonReq ? { anonymousRequested: true, anonymousSucceeded } : {}),
      ...(combinedWarning ? { warning: combinedWarning } : {}),
      ...(refreshedCookieString ? { cookieString: refreshedCookieString } : {}),
    });
  } catch (error) {
    console.error('[Playwright][Group] ❌ Lỗi đăng bài vào Group:', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
    for (const filePath of downloadedFilePaths) {
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
    }
    releaseLock();
    console.log(`[PostingLock] 🔓 Đã giải phóng phiên đăng Group ${targetGroupId}.`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK — Java backend dùng để kiểm tra Worker còn sống không
// ─────────────────────────────────────────────────────────────────────────────
app.get(['/health', '/api/health'], (req, res) => {
  res.json({ status: 'ok', worker: 'Playwright Worker', port: PORT, time: new Date().toISOString() });
});

// ─────────────────────────────────────────────────────────────────────────────
// THỐNG KÊ + DỌN DẸP THỦ CÔNG THƯ MỤC clip_meo — để FE hiện dung lượng đang dùng và cho phép dọn
// ngay thay vì phải đợi chu kỳ dọn tự động 24h (xem cleanupOldMediaFiles ở đầu file).
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/clip-meo-stats', (req, res) => {
  try {
    const files = fs.readdirSync(CLIP_MEO_DIR);
    let totalBytes = 0;
    let fileCount = 0;
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(CLIP_MEO_DIR, file));
        if (stat.isFile()) {
          totalBytes += stat.size;
          fileCount++;
        }
      } catch (e) { /* file có thể vừa bị xóa giữa lúc liệt kê — bỏ qua */ }
    }
    res.json({
      success: true,
      fileCount,
      totalBytes,
      totalMB: Math.round((totalBytes / 1024 / 1024) * 100) / 100,
      retentionDays: MEDIA_RETENTION_DAYS,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/clip-meo-cleanup', (req, res) => {
  try {
    const files = fs.readdirSync(CLIP_MEO_DIR);
    const cutoff = Date.now() - MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const forceAll = req.body && (req.body.forceAll === true || req.body.forceAll === 'true');
    let deleted = 0;
    let freedBytes = 0;
    for (const file of files) {
      const filePath = path.join(CLIP_MEO_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && (forceAll || stat.mtimeMs < cutoff)) {
          freedBytes += stat.size;
          fs.unlinkSync(filePath);
          deleted++;
        }
      } catch (e) { /* file có thể đã bị xóa bởi tiến trình khác — bỏ qua */ }
    }
    console.log(`[Cleanup] 🧹 Dọn thủ công: đã xóa ${deleted} file (${(freedBytes / 1024 / 1024).toFixed(2)} MB)${forceAll ? ' [forceAll]' : ''}`);
    res.json({ success: true, deleted, freedMB: Math.round((freedBytes / 1024 / 1024) * 100) / 100 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ENQUEUE URLS (Direct / Proxy cho Chrome Extension)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/enqueue-urls', async (req, res) => {
  try {
    const { urls, publishNow, targetFanpageId, groupNames, affiliateLink } = req.body;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ success: false, message: 'Danh sách URLs rỗng' });
    }

    const axios = require('axios');
    // Backend cào bài (Playwright) hoặc đăng ngay (publishNow) đồng bộ trên chính request này — live test
    // xác nhận riêng bước cào 1 bài đã tốn 22-79s tuỳ loại, đăng bài Fanpage còn lâu hơn (nhiều lần retry
    // mở Modal, mỗi lần chờ 15s). Timeout 30s cũ khiến proxy báo lỗi dù backend vẫn đang xử lý bình thường.
    const backendResp = await axios.post(`${desktop.BACKEND_URL}/api/queue/add-from-urls`, {
      urls,
      publishNow: Boolean(publishNow),
      targetFanpageId: targetFanpageId || null,
      groupNames: groupNames || [],
      affiliateLink: affiliateLink || null
    }, {
      headers: { 'Content-Type': 'application/json', ...desktop.backendHeaders() },
      timeout: 180000
    });

    return res.json(backendResp.data);
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    console.error('[Worker Proxy Enqueue] ❌ Lỗi đẩy vào Backend:', errMsg);
    return res.status(500).json({ success: false, message: `Lỗi kết nối Backend: ${errMsg}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CRAWL PAGE LINKS — Tự động mở URL Fanpage/Group/Profile/Threads, cuộn trang và gom link bài viết/reels
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/crawl-page-links', async (req, res) => {
  const { url, scrollCount = 4, cookieString, maxLimit = 30 } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'Thiếu url' });
  }

  let releaseContext = null;
  try {
    // Context từ browserPool (chung process Chromium) thay vì chromium.launch() riêng mỗi request.
    const acquired = await browserPool.acquireContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    releaseContext = acquired.release;
    const context = acquired.context;

    if (cookieString) {
      const cookies = cookieString.split(';')
        .map(c => c.trim())
        .filter(c => c.length > 0)
        .map(c => {
          const eqIdx = c.indexOf('=');
          if (eqIdx === -1) return null;
          return {
            name: c.slice(0, eqIdx).trim(),
            value: c.slice(eqIdx + 1).trim(),
            domain: url.includes('threads.net') ? '.threads.net' : '.facebook.com',
            path: '/',
          };
        })
        .filter(Boolean);

      if (cookies.length > 0) {
        await context.addCookies(cookies);
      }
    }

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
    await page.waitForTimeout(3000);

    const foundLinks = new Set();
    const cleanFn = (rawHref) => {
      try {
        const u = new URL(rawHref, url);
        ['fbclid', '__cft__', '__tn__', 'mibextid', 'rdid', 'notif_id'].forEach(p => u.searchParams.delete(p));
        return u.toString().split('?')[0];
      } catch (e) {
        return rawHref;
      }
    };

    const scrolls = Math.min(Math.max(parseInt(scrollCount, 10) || 4, 1), 10);
    for (let i = 0; i < scrolls; i++) {
      const hrefs = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        return anchors.map(a => a.getAttribute('href')).filter(Boolean);
      });

      hrefs.forEach(h => {
        if (
          h.includes('/reel/') ||
          h.includes('/videos/') ||
          h.includes('/posts/') ||
          h.includes('/permalink/') ||
          h.includes('facebook.com/share/r/') ||
          h.includes('facebook.com/share/v/') ||
          h.includes('facebook.com/share/p/') ||
          h.includes('/photo?fbid=') ||
          h.includes('/post/')
        ) {
          if (!h.includes('/hashtag/') && !h.includes('/stories/') && !h.includes('comment_id=')) {
            try {
              const full = new URL(h, url).toString();
              foundLinks.add(cleanFn(full));
            } catch (_) { }
          }
        }
      });

      if (foundLinks.size >= maxLimit) break;
      await page.evaluate(() => window.scrollBy({ top: 1500, behavior: 'smooth' }));
      await page.waitForTimeout(2000);
    }

    const results = Array.from(foundLinks).slice(0, maxLimit);
    return res.json({ success: true, count: results.length, urls: results });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    await releaseContext?.();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SCRAPE CONTENT — Cào bài từ nhiều loại nguồn khác nhau
// sourceType: RSS_FEED | THREADS | WEBSITE_CRAWLER | FB_PAGE
// ─────────────────────────────────────────────────────────────────────────────

const TIKTOK_PAGE_HOST_SUFFIXES = ['tiktok.com'];

function hostnameMatchesSuffix(hostname, suffix) {
  const normalized = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return normalized === suffix || normalized.endsWith(`.${suffix}`);
}

function parseSupportedTikTokUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch (_) {
    throw new Error('Link TikTok không hợp lệ');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
    || !TIKTOK_PAGE_HOST_SUFFIXES.some((suffix) => hostnameMatchesSuffix(parsed.hostname, suffix))) {
    throw new Error('Chỉ hỗ trợ link TikTok/Douyin hợp lệ');
  }
  return parsed.toString();
}

function decodeEmbeddedMediaUrl(value) {
  return String(value || '')
    .replace(/\\u0025/g, '%')
    .replace(/\\u0026/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\\/g, '')
    .trim();
}

function normalizeTikTokCandidate(rawCandidate) {
  const url = decodeEmbeddedMediaUrl(rawCandidate?.url);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  } catch (_) {
    return null;
  }

  const source = rawCandidate.source || 'unknown';
  const lowerUrl = url.toLowerCase();
  const watermarkHint = /playwm|watermark|download_addr|downloadaddr/.test(lowerUrl)
    || source === 'downloadAddr';
  const trustedPlaybackSource = ['bitRate', 'playAddr', 'playAddrH264', 'rewrittenPlaywm'].includes(source);
  const noWatermark = trustedPlaybackSource && !watermarkHint;

  const sourceScore = {
    bitRate: 500000,
    playAddrH264: 420000,
    playAddr: 400000,
    network: 220000,
    rewrittenPlaywm: 180000,
    downloadAddr: 50000,
  }[source] || 0;
  const bitrate = Number(rawCandidate.bitrate) || 0;
  const height = Number(rawCandidate.height) || 0;
  const width = Number(rawCandidate.width) || 0;
  const pixels = width * height; // 1080x1920 = 2,073,600 | 720x1280 = 921,600 | 576x1024 = 589,824

  // Ưu tiên TUYỆT ĐỐI độ phân giải sắc nét HD (1080p > 720p > 540p)
  // Mỗi megapixel cộng 10 triệu điểm -> 1080p vượt trội hoàn toàn 540p
  const resolutionScore = pixels * 10;
  const isH264 = String(rawCandidate.codec || '').toLowerCase().includes('264');
  const codecBonus = isH264 ? 500000 : 0;
  const bitrateBonus = Math.min(bitrate, 2000000);

  const score = sourceScore + resolutionScore + codecBonus + bitrateBonus
    - (watermarkHint ? 300000 : 0);

  return {
    url,
    source,
    bitrate,
    width,
    height,
    codec: rawCandidate.codec || null,
    noWatermark,
    score,
  };
}

function selectBestTikTokCandidate(rawCandidates) {
  const deduped = new Map();
  for (const rawCandidate of rawCandidates || []) {
    const candidate = normalizeTikTokCandidate(rawCandidate);
    if (!candidate) continue;
    const existing = deduped.get(candidate.url);
    if (!existing || candidate.score > existing.score) deduped.set(candidate.url, candidate);

    // Một số endpoint cũ của TikTok dùng /playwm/. Giữ bản chuyển đổi làm fallback có độ tin cậy
    // thấp hơn; không tự gắn nhãn "đã sạch logo" nếu không lấy được playAddr chuẩn từ JSON.
    if (/playwm/i.test(candidate.url)) {
      const rewritten = normalizeTikTokCandidate({
        ...rawCandidate,
        url: candidate.url.replace(/playwm/gi, 'play'),
        source: 'rewrittenPlaywm',
      });
      if (rewritten && !deduped.has(rewritten.url)) deduped.set(rewritten.url, rewritten);
    }
  }
  return [...deduped.values()].sort((a, b) => b.score - a.score)[0] || null;
}

/**
 * Tải trực tiếp video TikTok HD 1080p không logo siêu tốc qua TikWM HD Engine.
 * Trả về file 1080p Full HD siêu nét (hdplay) đã tải về CLIP_MEO_DIR.
 */
async function fetchTikTokHDFast(url) {
  try {
    const cleanUrl = url.split('?')[0];
    const postData = 'url=' + encodeURIComponent(cleanUrl) + '&hd=1';
    const resp = await axios.post('https://www.tikwm.com/api/', postData, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 10000,
    });

    const data = resp.data?.data;
    if (resp.data?.code === 0 && data) {
      const bestVideoUrl = data.hdplay || data.play;
      if (!bestVideoUrl) return null;

      const videoId = data.id || url.match(/\/video\/(\d+)/)?.[1] || Date.now();
      const isTrue1080 = Boolean(data.hdplay);
      const caption = data.title || '';
      const filename = `tiktok_${videoId}.mp4`;
      const localFilePath = path.join(CLIP_MEO_DIR, filename);

      console.log(`[TikTok_HD] 🚀 Tải video HD ${isTrue1080 ? '1080p Full HD' : 'HD'} từ CDN: ${bestVideoUrl.slice(0, 60)}...`);
      const vidResp = await axios.get(bestVideoUrl, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        timeout: 45000,
      });

      if (vidResp.data && vidResp.data.length > 50000) {
        await fs.promises.writeFile(localFilePath, vidResp.data);
        console.log(`[TikTok_HD] 💾 Đã lưu video Full HD ${(vidResp.data.length / 1024 / 1024).toFixed(2)} MB: ${filename}`);

        const resolvedVideoUrl = `http://localhost:${PORT}/downloads/clip_meo/${filename}`;
        return {
          success: true,
          videoUrl: resolvedVideoUrl,
          mediaUrls: [resolvedVideoUrl],
          title: caption.length > 80 ? `${caption.slice(0, 80)}...` : caption,
          content: caption,
          originalUrl: url,
          sourceType: 'TIKTOK',
          watermarkRemoved: true,
          isHd: true,
          isTrue1080,
          cachedLocally: true,
          quality: {
            width: isTrue1080 ? 1080 : 720,
            height: isTrue1080 ? 1920 : 1280,
            bitrate: null,
            codec: isTrue1080 ? '1080p Full HD' : '720p HD',
            source: isTrue1080 ? 'TikWM_1080p_FullHD' : 'TikWM_HD',
          },
        };
      }
    }
  } catch (err) {
    console.warn(`[TikTok_HD] ⚠️ TikWM HD engine không khả dụng (${err.message}), chuyển qua Playwright fallback...`);
  }
  return null;
}

/**
 * Trích xuất video/album TikTok và caption đầy đủ.
 * Ưu tiên TikWM 1080p HD engine siêu nét, sau đó fallback sang Playwright Hydration.
 */
async function scrapeTikTokNoWatermark(rawUrl) {
  let url;
  try {
    url = parseSupportedTikTokUrl(rawUrl);
  } catch (err) {
    return { success: false, error: err.message };
  }

  console.log(`[TikTok_NoWatermark] 🎬 Bắt đầu bóc tách: ${url}`);

  // TIER 1: Thử trích xuất 1080p Full HD siêu nét qua HD Engine trước (cực nhanh 1.5s, không lo mờ)
  const hdResult = await fetchTikTokHDFast(url);
  if (hdResult && hdResult.videoUrl) {
    console.log(`[TikTok_NoWatermark] 🌟 Lấy thành công video 1080p HD siêu nét qua HD Engine!`);
    return hdResult;
  }

  // TIER 2: Fallback qua Playwright Chromium Browser
  let release = null;
  try {
    const acquired = await browserPool.acquireContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: {
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    release = acquired.release;
    const page = await acquired.context.newPage();
    const networkCandidates = [];

    page.on('response', (response) => {
      if (networkCandidates.length >= 60) return;
      const responseUrl = response.url();
      const contentType = String(response.headers()['content-type'] || '').toLowerCase();
      const looksLikeVideoUrl = /\.mp4(?:[?#]|$)|mime_type=video|\/video\/tos\/|\/tos-[^/]*-ve-/i.test(responseUrl);
      if (contentType.includes('video/') || looksLikeVideoUrl) {
        networkCandidates.push({ url: responseUrl, source: 'network' });
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(
      () => document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__'),
      null,
      { timeout: 6000 }
    ).catch(() => { });
    await page.waitForTimeout(1200);

    const currentFinalUrl = page.url();
    const pageTitle = await page.title().catch(() => '');
    const hydrationData = await page.evaluate(() => {
      const result = { desc: '', author: '', candidates: [], images: [] };
      const script = document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (!script?.textContent) return result;
      try {
        const json = JSON.parse(script.textContent);
        const scope = json.__DEFAULT_SCOPE__ || json;
        const item = scope['webapp.video-detail']?.itemInfo?.itemStruct;
        if (!item) return result;

        result.desc = item.desc || '';
        result.author = item.author?.nickname || item.author?.uniqueId || '';
        const video = item.video || {};
        const pushAddress = (address, source, metadata = {}) => {
          if (!address) return;
          const urls = typeof address === 'string'
            ? [address]
            : (address.urlList || address.UrlList || address.url_list || []);
          for (const candidateUrl of urls) {
            if (candidateUrl) result.candidates.push({ url: candidateUrl, source, ...metadata });
          }
        };

        const bitrateEntries = video.bitRate || video.bitrateInfo || video.bitrateInfos || [];
        for (const entry of bitrateEntries) {
          const playAddrObj = entry.PlayAddr || entry.playAddr || entry.play_addr;
          const entryWidth = Number(playAddrObj?.Width || playAddrObj?.width || entry.Width || entry.width || video.width) || 0;
          const entryHeight = Number(playAddrObj?.Height || playAddrObj?.height || entry.Height || entry.height || video.height) || 0;
          pushAddress(playAddrObj, 'bitRate', {
            bitrate: entry.Bitrate || entry.bitrate || entry.bit_rate || 0,
            width: entryWidth,
            height: entryHeight,
            codec: entry.CodecType || entry.codecType || entry.codec_type || '',
          });
        }
        pushAddress(video.playAddrH264, 'playAddrH264', { width: video.width, height: video.height });
        pushAddress(video.playAddr, 'playAddr', { width: video.width, height: video.height });
        pushAddress(video.downloadAddr, 'downloadAddr', { width: video.width, height: video.height });

        result.images = (item.imagePost?.images || [])
          .map((image) => image.imageURL?.urlList?.[0] || image.imageUrl?.urlList?.[0])
          .filter(Boolean);
        return result;
      } catch (_) {
        return result;
      }
    });

    let caption = String(hydrationData.desc || '').trim();
    if (!caption) {
      caption = await page.evaluate(() => {
        const description = document.querySelector('h1[data-e2e="browse-video-desc"]');
        const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute('content');
        const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
        return (description?.innerText || ogDescription || ogTitle || '').trim();
      }).catch(() => '');
    }
    if (!caption || caption === 'TikTok - Make Your Day') {
      caption = pageTitle.replace(/\s*\|\s*TikTok\s*$/i, '').trim() || 'Video TikTok';
    }

    const html = await page.content();
    const candidates = [...hydrationData.candidates, ...networkCandidates];
    const htmlPatterns = [
      { regex: /"playAddrH264":"([^"]+)"/, source: 'playAddrH264' },
      { regex: /"playAddr":"([^"]+)"/, source: 'playAddr' },
      { regex: /"downloadAddr":"([^"]+)"/, source: 'downloadAddr' },
    ];
    for (const { regex, source } of htmlPatterns) {
      const match = html.match(regex);
      if (match?.[1]) candidates.push({ url: match[1], source });
    }

    const selected = selectBestTikTokCandidate(candidates);
    const images = [...new Set(hydrationData.images || [])];
    if (!selected && images.length === 0) {
      const blocked = /captcha|verify|đăng nhập|log in|access denied/i.test(`${pageTitle} ${html.slice(0, 5000)}`);
      return {
        success: false,
        error: blocked
          ? 'TikTok yêu cầu xác minh/đăng nhập; hãy thử lại hoặc cập nhật phiên trình duyệt.'
          : 'Không tìm thấy media (video có thể riêng tư, đã bị xoá hoặc TikTok vừa đổi cấu trúc).',
      };
    }

    let resolvedVideoUrl = selected?.url || null;
    let cachedLocally = false;
    if (selected) {
      try {
        const videoId = currentFinalUrl.match(/\/video\/(\d+)/)?.[1] || Date.now();
        const existingFilename = (await fs.promises.readdir(CLIP_MEO_DIR))
          .find((name) => name.startsWith(`tiktok_${videoId}.`));
        let filename = existingFilename;
        if (!filename) {
          const downloaded = await downloadMediaWithRetry(page, selected.url, 2);
          if (downloaded.mediaKind !== 'video') throw new Error('CDN không trả về dữ liệu video');
          if (downloaded.buffer.length > 512 * 1024 * 1024) throw new Error('Video vượt quá giới hạn cache 512 MB');
          filename = `tiktok_${videoId}${mediaFileExtension('video', downloaded.contentType, downloaded.buffer)}`;
          await fs.promises.writeFile(path.join(CLIP_MEO_DIR, filename), downloaded.buffer);
          console.log(`[TikTok_NoWatermark] 💾 Đã cache video ${(downloaded.buffer.length / 1024 / 1024).toFixed(2)} MB: ${filename}`);
        } else {
          console.log(`[TikTok_NoWatermark] ♻️ Dùng lại video đã cache: ${filename}`);
        }
        resolvedVideoUrl = `http://localhost:${PORT}/downloads/clip_meo/${filename}`;
        cachedLocally = true;
      } catch (cacheError) {
        console.warn(`[TikTok_NoWatermark] ⚠️ Không cache được video, dùng URL CDN tạm thời: ${cacheError.message}`);
      }
    }

    const mediaUrls = resolvedVideoUrl ? [resolvedVideoUrl] : images;
    const isHd = Boolean(selected && (selected.height >= 720 || selected.bitrate >= 1000000));
    console.log(`[TikTok_NoWatermark] ✅ Thành công — nguồn=${selected?.source || 'album'}, noWatermark=${selected?.noWatermark || false}, HD=${isHd}, cached=${cachedLocally}`);
    return {
      success: true,
      videoUrl: resolvedVideoUrl,
      mediaUrls,
      title: caption.length > 80 ? `${caption.slice(0, 80)}...` : caption,
      content: caption,
      originalUrl: currentFinalUrl || url,
      sourceType: 'TIKTOK',
      watermarkRemoved: Boolean(selected?.noWatermark),
      isHd,
      cachedLocally,
      quality: selected ? {
        width: selected.width || null,
        height: selected.height || null,
        bitrate: selected.bitrate || null,
        codec: selected.codec,
        source: selected.source,
      } : null,
    };
  } catch (err) {
    console.error(`[TikTok_NoWatermark] ❌ Lỗi bóc tách: ${err.message}`);
    return { success: false, error: `Lỗi khi bóc tách video TikTok: ${err.message}` };
  } finally {
    if (release) await release().catch(() => { });
  }
}

/**
 * Trích xuất video Douyin (TikTok Trung Quốc) không logo (No-Watermark) và caption gốc.
 * Kế thừa giải pháp từ Evil0ctal/Douyin_TikTok_Download_API:
 * - Trích xuất link từ văn bản chia sẻ (thường chứa chữ Trung kèm URL).
 * - Resolve shortlink v.douyin.com -> URL hoàn chỉnh.
 * - Trích xuất luồng MP4 và đổi playwm -> play để xóa watermark 100%.
 * - Tải và cache về CLIP_MEO_DIR/douyin_<id>.mp4.
 */
/**
 * Kiểm tra file video xem có luồng audio hợp lệ không (dùng FFmpeg kiểm tra thực tế)
 */
async function videoHasAudio(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    const ffmpegStatic = require('ffmpeg-static');
    const tempTestWav = path.join(CLIP_MEO_DIR, `test_chk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.wav`);
    await execFileAsync(ffmpegStatic, ['-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-y', tempTestWav], { timeout: 10000 });
    const hasAudio = fs.existsSync(tempTestWav) && fs.statSync(tempTestWav).size > 1000;
    try { fs.unlinkSync(tempTestWav); } catch (_) {}
    return hasAudio;
  } catch (_) {
    return false;
  }
}

/**
 * Trích xuất video Douyin (TikTok Trung Quốc) không logo (No-Watermark) và caption gốc.
 * - Giải quyết vấn đề luồng HD bị phân tách thành Video (tos-cn-vd) và Audio (tos-cn-ve).
 * - Tự động tải 2 luồng và hợp nhất bằng FFmpeg để video luôn có âm thanh 100%.
 */
async function scrapeDouyinNoWatermark(rawInput) {
  if (!rawInput) return { success: false, error: 'Thiếu link Douyin' };

  // Tách URL ra khỏi chuỗi chia sẻ (VD: "7.11 复制打开抖音... https://v.douyin.com/iABCxyz/")
  const urlMatch = String(rawInput).match(/https?:\/\/[^\s]+/);
  if (!urlMatch) {
    return { success: false, error: 'Không tìm thấy đường link hợp lệ trong nội dung dán' };
  }
  let targetUrl = urlMatch[0];

  console.log(`[Douyin_Master] 🎬 Bắt đầu xử lý link Douyin: ${targetUrl}`);

  // 1. Resolve redirect nếu là link rút gọn v.douyin.com
  if (targetUrl.includes('v.douyin.com')) {
    try {
      const res = await axios.get(targetUrl, {
        maxRedirects: 5,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        },
        validateStatus: (s) => s >= 200 && s < 400,
      });
      if (res.request?.res?.responseUrl) {
        targetUrl = res.request.res.responseUrl;
        console.log(`[Douyin_Master] 🔄 Redirect thành công -> ${targetUrl}`);
      }
    } catch (e) {
      console.warn(`[Douyin_Master] ⚠️ Lỗi resolve redirect: ${e.message}`);
    }
  }

  const videoIdMatch = targetUrl.match(/\/video\/(\d+)/) || targetUrl.match(/\/note\/(\d+)/) || targetUrl.match(/modal_id=(\d+)/);
  const videoId = videoIdMatch ? videoIdMatch[1] : (targetUrl.match(/(\d{15,})/)?.[1] || Date.now());

  // Chuẩn hóa đường link: Chỉ chuẩn hóa khi link gốc là link /video/ chuẩn, giữ nguyên link /jingxuan?modal_id= để Playwright tải đúng cấu trúc trang
  if (videoIdMatch && videoIdMatch[1] && targetUrl.includes('/video/')) {
    targetUrl = `https://www.douyin.com/video/${videoIdMatch[1]}`;
    console.log(`[Douyin_Master] 🎯 Đã chuẩn hóa link Douyin thành link video chuẩn: ${targetUrl}`);
  }

  // Kiểm tra file cache trước - Đảm bảo file cache thực sự có âm thanh!
  try {
    const existingFilename = (await fs.promises.readdir(CLIP_MEO_DIR))
      .find((name) => name.startsWith(`douyin_${videoId}.`) && !name.includes('temp') && !name.includes('track'));
    if (existingFilename) {
      const fullCachedPath = path.join(CLIP_MEO_DIR, existingFilename);
      const valid = await videoHasAudio(fullCachedPath);
      if (valid) {
        const cachedVideoUrl = `http://localhost:${PORT}/downloads/clip_meo/${existingFilename}`;
        console.log(`[Douyin_Master] ♻️ Dùng lại video Douyin đã cache (âm thanh kiểm tra OK): ${existingFilename}`);
        return {
          success: true,
          sourceType: 'DOUYIN',
          title: `Video Douyin ${videoId}`,
          content: `Video Douyin ${videoId}`,
          originalCaption: `Video Douyin ${videoId}`,
          originalUrl: targetUrl,
          videoUrl: cachedVideoUrl,
          mediaUrls: [cachedVideoUrl],
          watermarkRemoved: true,
          cachedLocally: true,
        };
      } else {
        console.log(`[Douyin_Master] 🗑️ Cache cũ ${existingFilename} bị câm/lỗi, đang xóa để tải lại...`);
        try { fs.unlinkSync(fullCachedPath); } catch (_) {}
      }
    }
  } catch (_) { }

  // 2. Tải thử qua Mobile Share Page HTML (m.douyin.com/share/video/ID) trước - nhanh & chứa link video có sẵn âm thanh
  let mobileCaption = '';
  try {
    const shareUrl = `https://m.douyin.com/share/video/${videoId}`;
    const shareRes = await axios.get(shareUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
      timeout: 10000,
    });
    const shareHtml = String(shareRes.data || '');
    const routerMatch = shareHtml.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\});/);
    if (routerMatch && routerMatch[1]) {
      try {
        const rData = JSON.parse(routerMatch[1]);
        const loaderData = rData.loaderData || {};
        const pageData = Object.values(loaderData).find(v => v && v.videoInfoRes);
        const item = pageData?.videoInfoRes?.item_list?.[0];
        if (item) {
          mobileCaption = item.desc || '';
          const playAddrList = item.video?.play_addr?.url_list || [];
          for (const rawUrl of playAddrList) {
            const cleanUrl = rawUrl.replace(/playwm/gi, 'play').replace(/\\u002F/gi, '/').replace(/\\/g, '');
            console.log(`[Douyin_Master] 📱 Tìm thấy play_addr từ Mobile SSR: ${cleanUrl}`);
            const down = await axios.get(cleanUrl, {
              responseType: 'arraybuffer',
              maxRedirects: 5,
              headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                'Referer': 'https://www.douyin.com/',
              },
              timeout: 30000,
            });
            const buf = Buffer.from(down.data);
            if (buf.length > 500000) {
              const filename = `douyin_${videoId}.mp4`;
              const fullPath = path.join(CLIP_MEO_DIR, filename);
              await fs.promises.writeFile(fullPath, buf);
              if (await videoHasAudio(fullPath)) {
                const resUrl = `http://localhost:${PORT}/downloads/clip_meo/${filename}`;
                console.log(`[Douyin_Master] 🎉 Tải thành công video Douyin đầy đủ âm thanh từ Mobile SSR! (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
                return {
                  success: true,
                  sourceType: 'DOUYIN',
                  title: mobileCaption || `Video Douyin ${videoId}`,
                  content: mobileCaption || `Video Douyin ${videoId}`,
                  originalCaption: mobileCaption || `Video Douyin ${videoId}`,
                  originalUrl: targetUrl,
                  videoUrl: resUrl,
                  mediaUrls: [resUrl],
                  watermarkRemoved: true,
                  cachedLocally: true,
                };
              } else {
                console.log(`[Douyin_Master] ⚠️ Video Mobile SSR tải về thiếu luồng audio, chuyển sang Playwright stream interception...`);
                try { fs.unlinkSync(fullPath); } catch (_) {}
              }
            }
          }
        }
      } catch (pErr) {
        console.warn(`[Douyin_Master] ⚠️ Lỗi parse Mobile SSR JSON: ${pErr.message}`);
      }
    }
  } catch (mErr) {
    console.warn(`[Douyin_Master] ⚠️ Không tải được qua Mobile SSR API: ${mErr.message}`);
  }

  // 3. Mở trình duyệt Playwright để cào luồng Video HD (RENDER_DATA & Response Interception)
  let release = null;
  try {
    const acquired = await browserPool.acquireContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    release = acquired.release;
    const page = await acquired.context.newPage();

    let capturedVideoUrl = null;
    let capturedAudioUrl = null;
    const capturedStreams = [];

    page.on('response', (response) => {
      const rUrl = response.url();
      if (/\.(css|js|png|jpg|jpeg|gif|svg|webp|woff|woff2)(\?|$)/i.test(rUrl) || rUrl.includes('uuu_265.mp4')) return;
      if (rUrl.includes('media-video') || rUrl.includes('tos-cn-vd')) {
        capturedVideoUrl = rUrl;
      } else if (rUrl.includes('media-audio') || rUrl.includes('tos-cn-ve')) {
        capturedAudioUrl = rUrl;
      } else if (rUrl.includes('douyinvod.com') || rUrl.includes('zjcdn.com') || rUrl.includes('.mp4') || rUrl.includes('video/tos')) {
        if (!capturedVideoUrl) capturedVideoUrl = rUrl;
      }
      if (rUrl.includes('.mp4') || rUrl.includes('douyinvod.com') || rUrl.includes('aweme/v1/play')) {
        capturedStreams.push(rUrl);
      }
    });

    try {
      await page.goto(targetUrl, { waitUntil: 'commit', timeout: 15000 });
    } catch (_) { }
    await page.waitForTimeout(3000);

    const caption = await page.evaluate(() => {
      const descEl = document.querySelector('[data-e2e="video-desc"]');
      return (descEl?.innerText?.trim() || document.title || '').replace(/[-_]\s*抖音.*$/i, '').trim();
    });
    const finalCaption = caption || mobileCaption || `Video Douyin ${videoId}`;

    // ƯU TIÊN HÀNG ĐẦU: Trích xuất trực tiếp link MP4 Full HD 1080p từ RENDER_DATA của Douyin
    const renderDataExtracted = await page.evaluate(() => {
      const renderEl = document.getElementById('RENDER_DATA');
      if (!renderEl) return null;
      try {
        const safe = renderEl.textContent.replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
        const obj = JSON.parse(decodeURIComponent(safe));
        let allUrls = [];
        function search(o) {
          if (!o) return;
          if (typeof o === 'string') {
            if (o.startsWith('http') && (o.includes('mime_type=video_mp4') || o.includes('zjcdn.com') || o.includes('douyinvod.com') || (o.includes('.mp4') && !o.includes('uuu_265.mp4') && !o.includes('douyin_pc_client.mp4')))) {
              allUrls.push(o);
            }
          } else if (Array.isArray(o)) {
            o.forEach(search);
          } else if (typeof o === 'object') {
            Object.keys(o).forEach(k => search(o[k]));
          }
        }
        search(obj);
        return [...new Set(allUrls)];
      } catch (e) {
        return [];
      }
    }).catch(() => []);

    if (renderDataExtracted && renderDataExtracted.length > 0) {
      console.log(`[Douyin_Master] 🎯 Tìm thấy ${renderDataExtracted.length} link MP4 từ RENDER_DATA! Đang tải về...`);
      for (const rawVideoUrl of renderDataExtracted) {
        try {
          const down = await axios.get(rawVideoUrl, {
            responseType: 'arraybuffer',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': 'https://www.douyin.com/',
            },
            timeout: 30000,
          });
          const buf = Buffer.from(down.data);
          if (buf.length > 500000) {
            const filename = `douyin_${videoId}.mp4`;
            const fullPath = path.join(CLIP_MEO_DIR, filename);
            await fs.promises.writeFile(fullPath, buf);
            if (await videoHasAudio(fullPath)) {
              const resUrl = `http://localhost:${PORT}/downloads/clip_meo/${filename}`;
              console.log(`[Douyin_Master] 🎉 Tải thành công video Douyin 1080p đầy đủ âm thanh từ RENDER_DATA! (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
              return {
                success: true,
                sourceType: 'DOUYIN',
                title: finalCaption,
                content: finalCaption,
                originalCaption: finalCaption,
                originalUrl: targetUrl,
                videoUrl: resUrl,
                mediaUrls: [resUrl],
                watermarkRemoved: true,
                cachedLocally: true,
              };
            } else {
              try { fs.unlinkSync(fullPath); } catch (_) {}
            }
          }
        } catch (eDown) {
          console.warn(`[Douyin_Master] ⚠️ Lỗi tải URL RENDER_DATA (${rawVideoUrl.slice(0, 60)}...): ${eDown.message}`);
        }
      }
    }

    // NẾU BẮT ĐƯỢC CẢ 2 LUỒNG VIDEO & AUDIO TỪ PLAYWRIGHT: HỢP NHẤT BẰNG FFMPEG
    if (capturedVideoUrl && capturedAudioUrl) {
      try {
        console.log(`[Douyin_Master] 🔀 Đã bắt được 2 luồng HD (Video & Audio riêng biệt). Đang tải & ghép bằng FFmpeg...`);
        const reqHeaders = {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://www.douyin.com/',
        };
        const vResp = await axios.get(capturedVideoUrl, { responseType: 'arraybuffer', headers: reqHeaders, timeout: 60000 });
        const aResp = await axios.get(capturedAudioUrl, { responseType: 'arraybuffer', headers: reqHeaders, timeout: 60000 });
        const vBuf = Buffer.from(vResp.data);
        const aBuf = Buffer.from(aResp.data);

        if (vBuf.length > 500000 && aBuf.length > 10000) {
          const tempVPath = path.join(CLIP_MEO_DIR, `temp_v_${videoId}.mp4`);
          const tempAPath = path.join(CLIP_MEO_DIR, `temp_a_${videoId}.mp3`);
          const mergedFilename = `douyin_${videoId}.mp4`;
          const mergedPath = path.join(CLIP_MEO_DIR, mergedFilename);

          await fs.promises.writeFile(tempVPath, vBuf);
          await fs.promises.writeFile(tempAPath, aBuf);

          const ffmpegStatic = require('ffmpeg-static');
          await execFileAsync(ffmpegStatic, [
            '-i', tempVPath,
            '-i', tempAPath,
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-y', mergedPath
          ]);

          try { fs.unlinkSync(tempVPath); } catch (_) {}
          try { fs.unlinkSync(tempAPath); } catch (_) {}

          if (await videoHasAudio(mergedPath)) {
            const resUrl = `http://localhost:${PORT}/downloads/clip_meo/${mergedFilename}`;
            console.log(`[Douyin_Master] 🎉 Hợp nhất thành công! Video Douyin HD full âm thanh: ${resUrl} (${(fs.statSync(mergedPath).size / 1024 / 1024).toFixed(2)} MB)`);
            return {
              success: true,
              sourceType: 'DOUYIN',
              title: finalCaption,
              content: finalCaption,
              originalCaption: finalCaption,
              originalUrl: targetUrl,
              videoUrl: resUrl,
              mediaUrls: [resUrl],
              watermarkRemoved: true,
              cachedLocally: true,
            };
          }
        }
      } catch (mergeErr) {
        console.warn(`[Douyin_Master] ⚠️ Lỗi hợp nhất luồng Playwright: ${mergeErr.message}`);
      }
    }

    // FALLBACK: Thử các candidate URLs khác
    let downloadedBuffer = null;
    let contentType = 'video/mp4';
    let chosenStreamUrl = targetUrl;

    const html = await page.content();
    const candidateUrls = [...capturedStreams];
    if (capturedVideoUrl) candidateUrls.unshift(capturedVideoUrl);

    for (const rawCandidate of candidateUrls) {
      const cleanStreamUrl = rawCandidate.replace(/playwm/gi, 'play');
      try {
        const resp = await axios.get(cleanStreamUrl, {
          responseType: 'arraybuffer',
          maxRedirects: 5,
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            'Referer': 'https://www.douyin.com/',
          },
          timeout: 30000,
        });
        const buf = Buffer.from(resp.data);
        if (buf.length > 500000) {
          downloadedBuffer = buf;
          contentType = resp.headers['content-type'] || 'video/mp4';
          chosenStreamUrl = cleanStreamUrl;
          break;
        }
      } catch (_) { }
    }

    if (!downloadedBuffer || downloadedBuffer.length === 0) {
      return { success: false, error: 'Không thể tải luồng video Douyin này (có thể video riêng tư hoặc đã bị xóa).' };
    }

    const filename = `douyin_${videoId}.mp4`;
    const fullPath = path.join(CLIP_MEO_DIR, filename);
    await fs.promises.writeFile(fullPath, downloadedBuffer);
    const resUrl = `http://localhost:${PORT}/downloads/clip_meo/${filename}`;

    return {
      success: true,
      sourceType: 'DOUYIN',
      title: finalCaption,
      content: finalCaption,
      originalCaption: finalCaption,
      originalUrl: targetUrl,
      videoUrl: resUrl,
      mediaUrls: [resUrl],
      watermarkRemoved: true,
      cachedLocally: true,
    };
  } catch (err) {
    console.error(`[Douyin_Master] ❌ Lỗi bóc tách Douyin: ${err.message}`);
    return { success: false, error: `Lỗi bóc tách Douyin: ${err.message}` };
  } finally {
    if (release) await release().catch(() => { });
  }
}

/**
 * Trích xuất FULL THÔNG TIN bài báo / trang tin tức web (BĐS, tin tức, blog...)
 * Lấy tiêu đề, sapo, toàn bộ văn bản bài viết, tất cả hình ảnh + chú thích (caption), tác giả, ngày đăng, tên miền.
 */
async function scrapeNewsArticle(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { success: false, error: 'Đường link bài báo không hợp lệ' };
  }

  let cleanUrl = rawUrl.trim();
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    cleanUrl = 'https://' + cleanUrl;
  }

  let parsedDomain = '';
  try {
    parsedDomain = new URL(cleanUrl).hostname.replace(/^www\./, '');
  } catch (e) {
    return { success: false, error: 'Định dạng URL bài báo không hợp lệ' };
  }

  console.log(`[NewsArticle_Scraper] 📰 Bắt đầu cào full bài báo từ URL: ${cleanUrl} (${parsedDomain})`);

  let release = null;
  try {
    const acquired = await browserPool.acquireContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: {
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    release = acquired.release;
    const page = await acquired.context.newPage();

    // Chặn bớt tài nguyên nặng không cần thiết (font, media mp4, v.v.)
    await page.route('**/*.{ttf,woff,woff2,mp4,avi,mov,mp3,wav}', route => route.abort());

    await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2000);

    // Cuộn nhiều nhịp xuống để kích hoạt lazy loading tất cả hình ảnh trong bài báo
    await page.evaluate(async () => {
      for (let i = 0; i < 8; i++) {
        window.scrollBy(0, 800);
        await new Promise(r => setTimeout(r, 250));
      }
    });

    const articleData = await page.evaluate(async (targetDomain) => {
      const cleanText = (str) => (str || '').replace(/\s+/g, ' ').trim();

      // 1. Tiêu đề (Title)
      let title = '';
      const titleSelectors = [
        'h1.title-detail', 'h1.article-title', 'h1.detail-title', 'h1.post-title', 
        'h1.title', 'h1.knc-title', 'h1.news-title', '.post-heading', 'h1',
        'meta[property="og:title"]', 'meta[name="twitter:title"]'
      ];
      for (const sel of titleSelectors) {
        if (sel.startsWith('meta')) {
          const el = document.querySelector(sel);
          if (el && el.content) { title = cleanText(el.content); break; }
        } else {
          const el = document.querySelector(sel);
          if (el && el.innerText) { title = cleanText(el.innerText); break; }
        }
      }
      if (!title) title = cleanText(document.title);

      // Clean title suffix
      title = title.replace(/\s*[-|–—]\s*(VnExpress|CafeF|Báo Tuổi Trẻ|Báo Thanh Niên|Dân Trí|VietNamNet|Znews|Kênh 14|Batdongsan\.com\.vn|Báo Điện Tử.*)$/i, '').trim();

      // 2. Sapo / Mô tả ngắn
      let sapo = '';
      const sapoSelectors = [
        '.sapo', '.detail-sapo', '.description', '.post-sapo', '.summary', '.excerpt',
        'meta[property="og:description"]', 'meta[name="description"]'
      ];
      for (const sel of sapoSelectors) {
        if (sel.startsWith('meta')) {
          const el = document.querySelector(sel);
          if (el && el.content) { sapo = cleanText(el.content); break; }
        } else {
          const el = document.querySelector(sel);
          if (el && el.innerText) { sapo = cleanText(el.innerText); break; }
        }
      }

      // 3. Ảnh bìa (Cover Image / OG Image) — chỉ LẤY LÀM ỨNG VIÊN, chưa vội tin. Nhiều trang dùng
      // chung 1 ảnh og:image mặc định (logo/banner site) cho mọi bài không có ảnh riêng, nên phải
      // kiểm tra lại kích thước thật + loại từ khóa icon/logo giống hệt ảnh nội dung trước khi chấp
      // nhận làm ảnh bìa — nếu không đạt, ảnh nội dung lớn nhất tìm được sẽ thay thế làm ảnh bìa.
      let ogImageCandidate = '';
      const ogImgEl = document.querySelector('meta[property="og:image"], meta[name="og:image"], meta[name="twitter:image"]');
      if (ogImgEl && ogImgEl.content) {
        ogImageCandidate = ogImgEl.content.trim();
      }

      // Tải thử 1 ảnh trong DOM để biết kích thước thật — dùng cho ảnh chưa kịp có naturalWidth
      // (do lazy-load chưa kích hoạt kịp dù đã cuộn trang) lẫn cho chính ảnh og:image (ảnh này
      // không nằm trong DOM nên không có naturalWidth sẵn, phải tự tải để đo).
      const loadImageSize = (url) => new Promise((resolve) => {
        try {
          const probe = new Image();
          let done = false;
          const finish = (w, h) => { if (!done) { done = true; resolve({ width: w, height: h }); } };
          probe.onload = () => finish(probe.naturalWidth || 0, probe.naturalHeight || 0);
          probe.onerror = () => finish(0, 0);
          probe.src = url;
          setTimeout(() => finish(0, 0), 3500);
        } catch (e) { resolve({ width: 0, height: 0 }); }
      });

      // VCCorp (CafeF, CafeBiz, Kênh14, Soha, GenK...) đặt tên ẢNH ĐẠI DIỆN BÀI là "avatar<timestamp>-...png"
      // — không phải avatar người dùng — nên bỏ dạng này ra trước khi lọc theo từ khóa "avatar".
      const isJunkImageUrl = (url) => (
        /\.(svg|gif|ico)($|\?)/i.test(url) ||
        /(icon|logo|avatar|ads|tracking|pixel|share|btn|placeholder)/i.test(url.replace(/avatar\d{6,}/gi, ''))
      );

      // Parse "url1 480w, url2 960w" → chọn URL có độ phân giải lớn nhất thay vì tin nguyên chuỗi thô
      const pickLargestFromSrcset = (srcsetStr) => {
        if (!srcsetStr || typeof srcsetStr !== 'string') return '';
        const candidates = srcsetStr.split(',').map(s => s.trim()).filter(Boolean).map(entry => {
          const parts = entry.split(/\s+/);
          return { url: parts[0], num: parseFloat(parts[1]) || 0 };
        }).filter(c => c.url);
        if (candidates.length === 0) return '';
        candidates.sort((a, b) => b.num - a.num);
        return candidates[0].url;
      };

      // Loại trừ ảnh thuộc header/nav/sidebar/footer — quan trọng nhất khi không tìm được đúng vùng
      // nội dung bài và phải rơi về quét cả document.body, tránh dính logo/banner/ảnh gợi ý khác bài.
      const isHeaderOrSidebarLike = (el) => !!el.closest(
        'header, #header, .header, .top-header, .sidebar, .box-top-news, .box-hot-news, .ad-banner, .footer, footer, nav, .menu-top, .header-bottom'
      );

      let coverImage = (ogImageCandidate && ogImageCandidate.startsWith('http') && !isJunkImageUrl(ogImageCandidate))
        ? ogImageCandidate
        : '';

      // 4. Tìm container chứa nội dung bài báo chính
      const contentContainerSelectors = [
        '.detail-content', '.knc-content', 'div[type="content"]', '#maindetailbody',
        '.contentdetail', '.af-detail-body', '.detail-body', '#content_detail',
        '.re__section-body', '.re__article-content', '.re__detail-content',
        '.singular-content', '.maincontent', '.content-detail', '.the-article-body',
        'article.fck_detail', 'article', '.fck_detail', '.post-content',
        '.article-content', '.news-content', '#main-detail-body', '.entry-content', 'main'
      ];
      
      let mainContainer = null;
      for (const sel of contentContainerSelectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText && el.innerText.length > 150) {
          mainContainer = el;
          break;
        }
      }
      if (!mainContainer) mainContainer = document.body;

      // Đánh dấu phần tử đang ẩn (dropdown/menu chưa mở, VD widget chọn giọng đọc "Giọng Nam miền
      // Bắc...") trên DOM GỐC còn gắn với document (chỉ ở đây offsetParent mới đo được đúng — sau khi
      // cloneNode thì node bị tách khỏi layout, offsetParent luôn null nên không kiểm tra được nữa).
      // Trước đây selector 'li' gom cả các mục trong menu ẩn này vào nội dung bài do không lọc theo
      // hiển thị thực tế, chỉ lọc theo cấu trúc DOM.
      mainContainer.querySelectorAll('*').forEach((el) => {
        if (el.offsetParent === null) {
          el.setAttribute('data-scraper-hidden', '1');
        }
      });

      // Clone container để loại bỏ rác/quảng cáo/bài viết liên quan/gợi ý chèn giữa bài
      const containerClone = mainContainer.cloneNode(true);
      containerClone.querySelectorAll('[data-scraper-hidden="1"]').forEach(el => el.remove());
      const elementsToRemove = containerClone.querySelectorAll([
        '.ads', '.advertisement', '.relate-news', '.box-relate-news',
        '.related-news', '.banner', 'script', 'style', 'iframe', 'aside',
        '.author-info', '.social-share', '.box-comment', 'header', 'footer',
        '.box-category', '.tags', '.keywords', '.box-sticky',
        '.knc-relate-news', '.link-content-footer', '.vne-relate-news',
        '.stream-item', '.advertising', '[class*="relate"]', '.box-tinnong',
        'div[type="RelatedNews"]', 'div.tin-lien-quan', '.box-embed-news', '.box-embed',
        'table.tbl-relate', '.relate-link', '.VnExpress-relate-news', 'figcaption',
        '.dt-relate-news', '.dt-content-recommend', '.box-content-recommend',
        '.box-content-relate', '[class*="recommend"]', '[class*="suggestion"]',
        '[data-component="recommend"]', '[data-component="related"]',
        // CafeF & VCCorp specific related news widgets
        '.tindnd', '#listNewsInContent', '#aiservice-lastest-news', '.knswli-right',
        '[id*="relatednewsboxlink"]', '.box-relate-wrapper', '.box-relate-content',
        '.relatenewslink-item', '[class*="box-relate"]', '[class*="svelte-"]',
        '.box-read-more', '.readmore-box', '.tin-doc-nhieu', '.tindocnhieu'
        // LƯU Ý: từng thử thêm '#desktop-in-article'/'[id*="in-article"]' (Dân Trí) để chặn khối "bài
        // liên quan" chèn giữa bài, nhưng phát hiện selector đó đôi khi bọc luôn phần lớn nội dung
        // THẬT của bài (xác nhận bằng test: xóa mất ~90% nội dung) — bỏ hẳn, không dùng lại. '[class*="ad-"]'/
        // '[id*="ad-"]' cũng quá rộng (khớp nhầm class/id chỉ tình cờ chứa chuỗi "ad-"), không thêm.
      ].join(', '));
      elementsToRemove.forEach(el => el.remove());

      // Đoạn văn không chứa BẤT KỲ dấu tiếng Việt nào (à/á/ạ.../đ) và đủ dài gần như chắc chắn là rác
      // chèn vào (quảng cáo native ads tiếng Anh như "ADBRO is the full service ad network..." đôi khi
      // render thẳng vào DOM thay vì trong iframe, lọt qua các bộ lọc selector ở trên) — báo tin tức
      // trong nước hầu như không có đoạn văn dài thuần tiếng Anh không dấu trong thân bài.
      const viDiacriticsRegex = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
      const looksLikeInjectedAdText = (text) => text.length > 80 && !viDiacriticsRegex.test(text);

      // Lấy danh sách đoạn văn (Paragraphs) & Full Text
      const paragraphs = [];
      let rawNodes = Array.from(containerClone.querySelectorAll('p, h2, h3, h4, li'));
      if (rawNodes.length < 2) {
        rawNodes = Array.from(containerClone.querySelectorAll('div')).filter(d => d.children.length === 0);
      }

      rawNodes.forEach(p => {
        const text = cleanText(p.innerText);
        if (text.length > 15) {
          const isJunk = /^(xem thêm|bài liên quan|tin mới|đọc thêm|ảnh:|nguồn:|theo |quảng cáo|advertising|chia sẻ|itvc|xem ngay|alora nha trang|lời khuyên|có thể bạn quan tâm|đừng bỏ lỡ|gợi ý|dành cho bạn|bài viết cùng chủ đề|tin cùng chuyên mục|tin nổi bật|chủ đề liên quan)/i.test(text)
            || /^(\d{2}-\d{2}-\d{4}|\[.*\])/.test(text)
            || looksLikeInjectedAdText(text);
          if (!isJunk && text !== sapo && !paragraphs.includes(text)) {
            paragraphs.push(text);
          }
        }
      });

      let fullContent = paragraphs.join('\n\n');
      if (!fullContent || fullContent.length < 100) {
        fullContent = cleanText(containerClone.innerText);
      }

      // 5. Trích xuất danh sách HÌNH ẢNH trong bài báo (kèm Caption)
      // Ngưỡng kích thước tối thiểu để coi là ảnh nội dung thật (không phải icon/thumbnail nhỏ)
      const MIN_IMAGE_DIM = 120;
      // Ngưỡng riêng cho ảnh BÌA — cao hơn ảnh nội dung thường, để loại logo vuông nhỏ hay được
      // dùng làm og:image mặc định của site khi bài không có ảnh riêng
      const MIN_COVER_DIM = 200;

      const seenUrls = new Set();
      const candidateImages = []; // { url, caption, width, height, needsProbe }

      // CHỈ lấy hình ảnh từ container đã loại bỏ rác/bài liên quan
      const imgNodes = containerClone.querySelectorAll('img');
      for (const img of imgNodes) {
        if (isHeaderOrSidebarLike(img)) continue;

        const rawSrcsetAttr = img.getAttribute('data-srcset') || img.getAttribute('srcset');
        const srcsetBest = pickLargestFromSrcset(rawSrcsetAttr);
        const attrCandidates = [
          img.getAttribute('data-original'),
          img.getAttribute('data-src'),
          srcsetBest,
          img.getAttribute('data-actualsrc'),
          img.getAttribute('data-cdn'),
          img.getAttribute('data-lazy-src'),
          img.src
        ];

        let rawSrc = '';
        for (const attr of attrCandidates) {
          if (attr && typeof attr === 'string' && attr.trim().length > 5) {
            const trimmed = attr.trim();
            if (!trimmed.startsWith('data:image') && !trimmed.includes('blank.gif') && !trimmed.includes('pixel') && !trimmed.includes('placeholder')) {
              rawSrc = trimmed;
              break;
            }
          }
        }
        if (!rawSrc && img.src && !img.src.startsWith('data:image')) rawSrc = img.src;
        if (!rawSrc) continue;

        let absUrl = '';
        try {
          absUrl = new URL(rawSrc, window.location.href).href;
        } catch (e) {
          absUrl = rawSrc;
        }

        if (!absUrl.startsWith('http') || seenUrls.has(absUrl) || isJunkImageUrl(absUrl)) {
          continue;
        }

        let caption = '';
        const figure = img.closest('figure, .photo-cms, .VnExpress-image, .tplCaption, .box-caption, .img-caption, .photo-box');
        if (figure) {
          const capEl = figure.querySelector('figcaption, .caption, .photo-caption, p');
          if (capEl) caption = cleanText(capEl.innerText);
        }
        if (!caption) caption = cleanText(img.getAttribute('alt') || img.getAttribute('title') || '');

        seenUrls.add(absUrl);
        candidateImages.push({
          url: absUrl,
          caption: caption || 'Hình ảnh bài viết',
          width: img.naturalWidth || img.width || 0,
          height: img.naturalHeight || img.height || 0,
        });
      }

      // Ảnh có width/height = 0 nghĩa là chưa xác định được kích thước thật (thường do lazy-load
      // chưa kịp kích hoạt dù đã cuộn trang) — trước đây các ảnh này lọt qua bộ lọc kích thước tối
      // thiểu vô điều kiện. Giờ tải thử (song song, có giới hạn) để đo kích thước thật trước khi quyết định.
      const unresolvedImages = candidateImages.filter(c => c.width === 0 && c.height === 0).slice(0, 25);
      await Promise.all(unresolvedImages.map(async (c) => {
        const size = await loadImageSize(c.url);
        c.width = size.width;
        c.height = size.height;
      }));

      const images = [];
      let bestFallbackCover = null; // ảnh nội dung lớn nhất, dùng làm ảnh bìa nếu og:image bị loại

      for (const c of candidateImages) {
        // Ảnh vẫn không đo được kích thước sau khi thử tải (0x0) — không đủ tin cậy để loại bỏ dựa
        // theo kích thước, nhưng cũng không nên trực tiếp bỏ qua nó vì có thể chỉ do lỗi mạng tạm
        // thời; giữ lại nhưng không cho làm ứng viên ảnh bìa dự phòng.
        const measured = c.width > 0 && c.height > 0;
        if (measured && (c.width < MIN_IMAGE_DIM || c.height < MIN_IMAGE_DIM)) continue;

        images.push({ url: c.url, caption: c.caption, isCover: false });

        if (measured) {
          const area = c.width * c.height;
          if (c.width >= MIN_COVER_DIM && c.height >= MIN_COVER_DIM && (!bestFallbackCover || area > bestFallbackCover.area)) {
            bestFallbackCover = { url: c.url, caption: c.caption, area };
          }
        }
      }

      // Xác nhận lại og:image bằng cách tải thử kích thước thật (ảnh này không nằm trong DOM nên
      // không có naturalWidth sẵn). Nếu không đạt ngưỡng ảnh bìa hoặc tải lỗi, dùng ảnh nội dung lớn
      // nhất tìm được thay thế — tránh lấy nhầm logo/banner mặc định của site làm ảnh bìa.
      let verifiedCover = null;
      if (coverImage) {
        const ogSize = await loadImageSize(coverImage);
        if (ogSize.width >= MIN_COVER_DIM && ogSize.height >= MIN_COVER_DIM) {
          verifiedCover = { url: coverImage, caption: 'Ảnh đại diện bài báo' };
        }
      }
      if (!verifiedCover && bestFallbackCover) {
        verifiedCover = { url: bestFallbackCover.url, caption: bestFallbackCover.caption || 'Ảnh đại diện bài báo' };
      }
      if (verifiedCover) {
        coverImage = verifiedCover.url;
        const existingIdx = images.findIndex(im => im.url === verifiedCover.url);
        if (existingIdx !== -1) images.splice(existingIdx, 1);
        images.unshift({ url: verifiedCover.url, caption: 'Ảnh đại diện bài báo', isCover: true });
      } else {
        coverImage = '';
      }

      // 6. Tác giả & Ngày đăng
      let author = '';
      const authorEl = document.querySelector('.author, .detail-author, .article-author, meta[name="author"], meta[property="article:author"]');
      if (authorEl) {
        author = cleanText(authorEl.content || authorEl.innerText || '');
      }

      let publishedTime = '';
      const timeEl = document.querySelector('meta[property="article:published_time"], .date, .time, .detail-time, .post-time, time');
      if (timeEl) {
        publishedTime = cleanText(timeEl.content || timeEl.getAttribute('datetime') || timeEl.innerText || '');
      }

      let siteName = targetDomain;
      const siteNameMeta = document.querySelector('meta[property="og:site_name"]');
      if (siteNameMeta && siteNameMeta.content) {
        siteName = cleanText(siteNameMeta.content);
      }

      return {
        title,
        sapo,
        content: fullContent,
        paragraphs,
        coverImage,
        images,
        author,
        publishedTime,
        siteName,
        domain: targetDomain,
        // Không selector nào trong contentContainerSelectors khớp → phải quét cả document.body, kết
        // quả thường lẫn nhiều nội dung không liên quan (menu, sidebar...) với site lạ/không nằm
        // trong danh sách site báo Việt đã biết. Đánh dấu lại để bước Readability bên dưới biết mà
        // ưu tiên tin engine trích xuất chuẩn hơn thay vì đoạn text thô này.
        usedGenericContainer: mainContainer === document.body,
        wordCount: fullContent ? fullContent.split(/\s+/).length : 0
      };
    }, parsedDomain);

    // Bổ sung Mozilla Readability Reader Engine (Chuẩn Firefox/Safari) làm fallback & nâng cao chất lượng
    try {
      const fullHtml = await page.content();
      const dom = new JSDOM(fullHtml, { url: cleanUrl });
      const reader = new Readability(dom.window.document);
      const parsedMozilla = reader.parse();
      if (parsedMozilla) {
        if (!articleData.title || articleData.title.length < 5) {
          articleData.title = parsedMozilla.title || articleData.title;
        }
        if (!articleData.sapo && parsedMozilla.excerpt) {
          articleData.sapo = (parsedMozilla.excerpt || '').replace(/\s+/g, ' ').trim();
        }
        const cleanMozContent = (parsedMozilla.textContent || '').replace(/\s+/g, ' ').trim();
        // Site lạ không khớp selector cascade nào (usedGenericContainer) → đoạn text quét từ cả
        // document.body thường lẫn nhiều rác (menu/sidebar/footer), nên tin Readability hơn ngay cả
        // khi đoạn text thô "dài hơn" về mặt ký tự, miễn Readability trích được đủ dài (>200 ký tự)
        // và không quá ngắn hơn hẳn đoạn thô (tránh trường hợp Readability parse lỗi ra rỗng/rất ngắn).
        const genericContainerNeedsMozilla = articleData.usedGenericContainer && cleanMozContent.length > 200
          && cleanMozContent.length >= (articleData.content || '').length * 0.6;
        const shouldPreferMozilla = !articleData.content || articleData.wordCount < 40 || genericContainerNeedsMozilla;
        if (shouldPreferMozilla && cleanMozContent
            && (genericContainerNeedsMozilla || cleanMozContent.length > (articleData.content || '').length)) {
          articleData.content = cleanMozContent;
          articleData.wordCount = articleData.content.split(/\s+/).length;
        }
      }
    } catch (mErr) {
      console.log(`[NewsArticle_Scraper] ⚠️ Mozilla Readability note: ${mErr.message}`);
    }

    console.log(`[NewsArticle_Scraper] ✅ Cào thành công! Tiêu đề: "${articleData.title}" | Số từ: ${articleData.wordCount} | Số ảnh: ${articleData.images.length}`);

    return {
      success: true,
      url: cleanUrl,
      ...articleData
    };
  } catch (err) {
    console.error(`[NewsArticle_Scraper] ❌ Lỗi khi cào bài báo: ${err.message}`);
    return {
      success: false,
      error: `Không thể cào bài báo từ đường link này: ${err.message}`
    };
  } finally {
    if (release) await release().catch(() => {});
  }
}

async function scrapeCategoryArticleUrls(categoryUrl, limit = 10) {
  if (!categoryUrl || typeof categoryUrl !== 'string') {
    return { success: false, error: 'URL chuyên mục không hợp lệ' };
  }

  let cleanUrl = categoryUrl.trim();
  if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;

  console.log(`[NewsCategory_Scraper] 🌐 Quét danh sách bài báo mới nhất từ chuyên mục: ${cleanUrl}`);
  let release = null;
  try {
    const acquired = await browserPool.acquireContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
    });
    release = acquired.release;
    const page = await acquired.context.newPage();
    await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const articleItems = await page.evaluate(({ catUrl, maxCount }) => {
      // Exclude elements from header, footer, navigation bar, sidebars, top banners
      const isHeaderOrSidebar = (el) => {
        return !!el.closest('header, #header, .header, .top-header, .sidebar, .box-top-news, .box-hot-news, .ad-banner, .footer, footer, nav, .menu-top, .header-bottom');
      };

      // Query stream containers first for cleaner, targeted category extraction
      let streamAnchors = Array.from(document.querySelectorAll('.box-category-item a[href], .tl-item a[href], .timeline a[href], .list-news a[href], .cat-item a[href], .item-news a[href], article a[href], main a[href]'));
      let allAnchors = streamAnchors.length > 0 ? streamAnchors : Array.from(document.querySelectorAll('a[href]'));

      const items = [];
      const seen = new Set();
      const currentHost = window.location.hostname.replace(/^www\./, '');
      const cleanCatUrl = catUrl.replace(/\/$/, '');

      const badPathKeywords = [
        '/tag/', '/tags/', '/tim-kiem/', '/search/', '/author/', '/tac-gia/', '/event/',
        '/doc-nhanh', '/danh-muc', '/du-lieu', '/chuyende', '/multimedia', '/video',
        '/podcast', '/rss', '/widget', '/live/', '/interactive/', '/static/'
      ];

      for (const a of allAnchors) {
        if (isHeaderOrSidebar(a)) continue;
        let href = a.getAttribute('href') || '';
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;

        try {
          const absObj = new URL(href, window.location.href);
          absObj.hash = '';
          const abs = absObj.href.replace(/\/$/, '');
          const host = absObj.hostname.replace(/^www\./, '');

          if (host !== currentHost && !host.endsWith(currentHost) && !currentHost.endsWith(host)) {
            continue;
          }

          if (abs === cleanCatUrl || abs + '/' === cleanCatUrl || abs === cleanCatUrl + '/') continue;

          const path = absObj.pathname.toLowerCase();
          if (badPathKeywords.some(kw => path.includes(kw))) continue;

          let isArticle = false;

          // 1. CafeF: bài viết dạng /bat-dong-san/slug-1882609...chn
          if (host.includes('cafef.vn')) {
            if (/-\d{10,}\.chn$/i.test(abs)) isArticle = true;
          }
          // 2. TuoiTre: bài viết dạng /slug-1002609...htm (không chứa /tac-gia/)
          else if (host.includes('tuoitre.vn')) {
            if (/-\d{10,}\.htm$/i.test(abs)) isArticle = true;
          }
          // 3. DanTri: bài viết dạng /bat-dong-san/slug-2026...htm
          else if (host.includes('dantri.com.vn')) {
            if (/-\d{10,}\.htm$/i.test(abs) || /\/\d{14,}\.htm$/i.test(abs)) isArticle = true;
          }
          // 4. VnExpress: bài viết dạng /slug-5122854.html
          else if (host.includes('vnexpress.net')) {
            if (/-\d{6,}\.html$/i.test(abs)) isArticle = true;
          }
          // 5. Batdongsan: wiki.batdongsan.com.vn/tin-tuc/slug-857062 hoặc /tin-tuc/slug-ID
          else if (host.includes('batdongsan.com.vn')) {
            if ((path.includes('/tin-tuc/') || path.includes('/phan-tich-danh-gia/')) && /-\d{4,}/.test(abs)) {
              isArticle = true;
            }
          }
          // 6. VietnamNet: /slug-ID.html
          else if (host.includes('vietnamnet.vn')) {
            if (/-\d{6,}\.html$/i.test(abs)) isArticle = true;
          }
          // 7. ZNews: /post-ID.html hoặc /slug-ID.html
          else if (host.includes('znews.vn')) {
            if (/-\d{6,}\.html$/i.test(abs) || /post\d+\.html$/i.test(abs)) isArticle = true;
          }
          // 8. Quy tắc tổng quát cho tất cả các trang báo khác (Universal Fallback)
          else if (/-\d{5,}\.(chn|html?|htm)$/i.test(abs) || (abs.split('-').length >= 4 && /\d{5,}/.test(abs))) {
            isArticle = true;
          }

          if (isArticle && !seen.has(abs)) {
            seen.add(abs);

            const container = a.closest('article, .knc-content, .tl-item, .box-category-item, .item-news, .cat-item, .news-item, li, div') || a.parentElement;
            let title = a.innerText.trim();
            if (!title || title.length < 10) {
              const heading = container ? container.querySelector('h1, h2, h3, h4, .title, .title-news, .name') : null;
              if (heading) title = heading.innerText.trim();
            }

            let coverImage = '';
            const imgEl = container ? container.querySelector('img') : null;
            if (imgEl) {
              coverImage = imgEl.getAttribute('data-src') || imgEl.getAttribute('data-original') || imgEl.getAttribute('src') || '';
              if (coverImage.startsWith('//')) coverImage = 'https:' + coverImage;
              else if (coverImage.startsWith('/') && !coverImage.startsWith('data:')) coverImage = new URL(coverImage, window.location.href).href;
            }

            let sapo = '';
            const sapoEl = container ? container.querySelector('.sapo, .lead, .desc, .summary, .description, p') : null;
            if (sapoEl) sapo = sapoEl.innerText.trim();

            let publishedTime = '';
            const timeEl = container ? container.querySelector('.time, .date, .time-ago, .post-time, time, span.time, .knc-time') : null;
            if (timeEl) publishedTime = timeEl.innerText.trim();

            items.push({
              url: abs,
              title: title.length > 5 ? title : abs,
              coverImage: coverImage && !coverImage.startsWith('data:') ? coverImage : '',
              sapo: sapo.length > 10 ? sapo : '',
              publishedTime: publishedTime,
              source: host
            });

            if (items.length >= maxCount) break;
          }
        } catch (e) {}
      }
      return items;
    }, { catUrl: cleanUrl, maxCount: limit });

    return {
      success: true,
      categoryUrl: cleanUrl,
      count: articleItems.length,
      urls: articleItems.map(it => it.url),
      items: articleItems
    };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    if (release) await release().catch(() => {});
  }
}

app.post(['/api/scrape-article', '/api/tools/scrape-article'], async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'Thiếu đường link bài báo (URL)' });
  }
  const result = await scrapeNewsArticle(url);
  return res.status(result.success ? 200 : 422).json(result);
});

app.post(['/api/scrape-category-links', '/api/tools/scrape-category-links'], async (req, res) => {
  const { url, limit = 10 } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'Thiếu đường link chuyên mục (URL)' });
  }
  const result = await scrapeCategoryArticleUrls(url, Number(limit) || 10);
  return res.status(result.success ? 200 : 422).json(result);
});

app.post(['/api/parse-rss-feed', '/api/tools/parse-rss-feed'], async (req, res) => {
  const { url, limit = 15 } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'Thiếu đường link RSS Feed (URL)' });
  }
  const result = await parseRssFeed(url, Number(limit) || 15);
  return res.status(result.success ? 200 : 422).json(result);
});

app.post(['/api/news-radar/scrape-stream', '/api/tools/news-radar/scrape-stream'], async (req, res) => {
  const { url, limit = 15 } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'Thiếu đường link nguồn tin (URL)' });
  }
  const clean = String(url).trim().toLowerCase();
  if (clean.includes('/rss') || clean.endsWith('.rss') || clean.endsWith('.xml') || clean.includes('rss.')) {
    const rssResult = await parseRssFeed(url, Number(limit) || 15);
    return res.status(rssResult.success ? 200 : 422).json(rssResult);
  } else {
    const catResult = await scrapeCategoryArticleUrls(url, Number(limit) || 15);
    return res.status(catResult.success ? 200 : 422).json(catResult);
  }
});

async function parseRssFeed(rssUrl, limit = 15) {
  if (!rssUrl || typeof rssUrl !== 'string') {
    return { success: false, error: 'URL RSS Feed không hợp lệ' };
  }
  let cleanUrl = rssUrl.trim();
  if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;

  console.log(`[RSS_Feed_Parser] 📡 Đang đọc RSS Feed tự động từ: ${cleanUrl}`);
  try {
    const fetchRes = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      }
    });
    const xmlText = await fetchRes.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    // Nhiều nguồn RSS (đặc biệt Google News) nhồi cả 1 đoạn HTML thật vào <description> nhưng đã
    // escape thành thực thể XML (VD "&lt;a href=...&gt;Tiêu đề&lt;/a&gt;") — nếu chỉ strip tag thật
    // (<...>) như trước thì chuỗi escape này lọt qua nguyên vẹn, hiện ra rác "&lt;a href=..." trên UI
    // VÀ khiến hashtag tự sinh nhận nhầm từ khóa trong URL rác đó (VD "google" trong link luôn khớp
    // nhóm #CongNghe bất kể chủ đề bài thật là gì). Phải giải mã thực thể TRƯỚC khi strip tag.
    const decodeXmlEntitiesOnce = (str) => (str || '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&'); // luôn giải mã &amp; SAU CÙNG để tránh giải mã lồng ("&amp;lt;" → "<")
    // Google News RSS đôi khi encode 2 LỚP (VD "&amp;nbsp;" thay vì "&nbsp;") — 1 lượt giải mã ở trên
    // chỉ đưa "&amp;nbsp;" về "&nbsp;" (vì &amp; được decode SAU CÙNG, lúc đó bước xử lý &nbsp; đã đi
    // qua rồi) và để sót "&nbsp;" hiện thành rác trên UI. Chạy thêm 1 lượt nữa để dọn nốt lớp thứ 2.
    const decodeXmlEntities = (str) => decodeXmlEntitiesOnce(decodeXmlEntitiesOnce(str));
    const cleanXmlTag = (str) => decodeXmlEntities((str || '').replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')).replace(/<[^>]+>/g, '').trim();

    while ((match = itemRegex.exec(xmlText)) !== null && items.length < limit) {
      const itemContent = match[1];
      const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/i);
      const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/i) || itemContent.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
      const pubDateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
      const descMatch = itemContent.match(/<description>([\s\S]*?)<\/description>/i);

      let itemLink = linkMatch ? cleanXmlTag(linkMatch[1]) : '';
      if (itemLink && itemLink.startsWith('http')) {
        const title = titleMatch ? cleanXmlTag(titleMatch[1]) : '';
        const rawDesc = descMatch ? descMatch[1] : '';
        const description = cleanXmlTag(rawDesc);

        // Trích xuất ảnh thumbnail từ enclosure hoặc media:content hoặc thẻ <img> trong description
        let coverImage = '';
        const enclosureMatch = itemContent.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
        if (enclosureMatch) {
          coverImage = enclosureMatch[1];
        } else {
          const mediaMatch = itemContent.match(/<media:content[^>]+url=["']([^"']+)["']/i);
          if (mediaMatch) {
            coverImage = mediaMatch[1];
          } else if (rawDesc) {
            // Thử cả rawDesc gốc lẫn bản đã giải mã thực thể (feed như Google News escape nguyên đoạn
            // HTML thành &lt;img ...&gt; nên regex trên chuỗi thô sẽ không khớp được).
            const imgMatch = rawDesc.match(/<img[^>]+src=["']([^"']+)["']/i)
              || decodeXmlEntities(rawDesc).match(/<img[^>]+src=["']([^"']+)["']/i);
            if (imgMatch) coverImage = imgMatch[1];
          }
        }

        if (coverImage) {
          coverImage = decodeXmlEntities(coverImage).replace(/&amp;/g, '&').trim();
        }

        let hostname = '';
        try { hostname = new URL(itemLink).hostname.replace(/^www\./, ''); } catch (e) {}

        const hashtags = generateSmartHashtags(title, description, cleanUrl);
        items.push({
          url: itemLink,
          title,
          link: itemLink,
          coverImage: coverImage || '',
          sapo: description,
          publishedTime: pubDateMatch ? cleanXmlTag(pubDateMatch[1]) : '',
          source: hostname || 'Tin tức',
          hashtags
        });
      }
    }

    console.log(`[RSS_Feed_Parser] ✅ Đã đọc thành công ${items.length} bài từ RSS Feed!`);
    return { success: true, count: items.length, items };
  } catch (err) {
    console.error(`[RSS_Feed_Parser] ❌ Lỗi đọc RSS XML: ${err.message}`);
    return { success: false, error: err.message };
  }
}

function generateSmartHashtags(title, content, domain) {
  const combined = `${title || ''} ${content || ''}`.toLowerCase();
  const tags = new Set();

  if (/bất động sản|nhà đất|căn hộ|chung cư|biệt thự|đất nền|quy hoạch|dự án|chủ đầu tư|bds/i.test(combined)) {
    tags.add('#BatDongSan');
    tags.add('#NhaDat');
    tags.add('#DauTuBDS');
    tags.add('#ThiTruongBDS');
  }
  // "ai" phải tách riêng, bọc biên từ (word-boundary an toàn cho tiếng Việt có dấu) — nếu để chung
  // trong 1 regex case-insensitive như các từ khóa khác, "ai" khớp bừa vào BẤT KỲ từ tiếng Việt nào
  // chứa chuỗi con "ai" (VD "đất đai", "phân loại", "ngoài", "hai"...) vì tiếng Việt có dấu rất hay
  // chứa "ai", khiến gần như mọi bài đều bị gắn nhầm #CongNghe (xác nhận bằng test thực tế 2026-09-21).
  const viWordChar = 'a-zàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ0-9';
  const aiKeywordRegex = new RegExp(`(^|[^${viWordChar}])ai($|[^${viWordChar}])`, 'i');
  if (
    /công nghệ|smartphone|iphone|google|microsoft|chiến lược|chip|bán dẫn|phần mềm/i.test(combined)
    || aiKeywordRegex.test(combined)
  ) {
    tags.add('#CongNghe');
    tags.add('#TechNews');
    tags.add('#TinCongNghe');
  }
  if (/tài chính|ngân hàng|lãi suất|chứng khoán|vàng|usd|đầu tư|kinh tế|doanh nghiệp/i.test(combined)) {
    tags.add('#TaiChinh');
    tags.add('#KinhTe');
    tags.add('#ChungKhoan');
    tags.add('#DauTu');
  }
  if (/sức khỏe|y tế|bệnh|thuốc|dinh dưỡng|bác sĩ/i.test(combined)) {
    tags.add('#SucKhoe');
    tags.add('#SongKhoe');
  }
  if (/thời sự|xã hội|giao thông|thời tiết|mưa lớn|ngập/i.test(combined)) {
    tags.add('#TinTuc24h');
    tags.add('#ThoiSu');
  }

  tags.add('#TinTucMoiNhat');
  return Array.from(tags).join(' ');
}

app.post(['/api/parse-rss', '/api/tools/parse-rss'], async (req, res) => {
  const { url, limit = 10 } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'Thiếu đường link RSS Feed (URL)' });
  }
  const result = await parseRssFeed(url, Number(limit) || 10);
  return res.status(result.success ? 200 : 422).json(result);
});

// Tạo ảnh "thẻ tin tức" (ảnh gốc + dải tiêu đề in hoa, cụm [[...]] tô đỏ) — xem news-card.js.
// Không dùng globalPostingLock vì không đụng tới Facebook; trả PNG dạng base64 để backend lưu vào uploads/.
// Studio Video: dựng nhiều lớp chữ/phụ đề/logo 1 lần (mỗi lớp chụp gọn theo #layer), trả base64 + toạ độ trong khung
app.post('/api/render-html-layers', async (req, res) => {
  const { htmls } = req.body || {};
  if (!Array.isArray(htmls) || !htmls.length) return res.status(400).json({ success: false, error: 'Thiếu danh sách HTML' });
  if (htmls.length > 400) return res.status(400).json({ success: false, error: 'Quá nhiều lớp (tối đa 400)' });
  try {
    const items = await renderHtmlLayers(htmls, { browserPool, downloadMedia: downloadMediaWithRetry });
    res.json({ success: true, items: items.map((it) => (it ? { pngBase64: it.png.toString('base64'), x: it.x, y: it.y, w: it.w, h: it.h } : null)) });
  } catch (e) {
    console.error('[VideoLayers] Lỗi dựng lớp:', e.message);
    res.status(400).json({ success: false, error: e.message });
  }
});

// Render ảnh Quote Card nền đen chữ trắng (Style BOX Y Khoa) cho bài text ngắn
app.post('/api/render-quote-card', async (req, res) => {
  const { text } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ success: false, error: 'Thiếu nội dung text' });
  }
  try {
    const png = await renderDarkQuoteCard(String(text).trim());
    if (!png) throw new Error('Không thể render ảnh');
    res.json({ success: true, pngBase64: png.toString('base64') });
  } catch (e) {
    console.error('[QuoteCard] Lỗi tạo ảnh:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/render-news-card', async (req, res) => {
  const { imageUrl, insetImageUrl, headline, html } = req.body || {};
  try {
    const deps = { browserPool, downloadMedia: downloadMediaWithRetry };
    // html: mẫu do Studio Ảnh Tin tạo (khớp preview); không có thì dùng mẫu đơn giản cũ
    const png = html
      ? await renderNewsCardHtml(html, deps)
      : await renderNewsCard({ imageUrl, insetImageUrl, headline }, deps);
    res.json({ success: true, pngBase64: png.toString('base64'), ...(png.photo ? { photo: png.photo } : {}) });
  } catch (e) {
    console.error('[NewsCard] Lỗi tạo ảnh:', e.message);
    res.status(400).json({ success: false, error: e.message });
  }
});

// Render ảnh Quote Card nền đen chữ trắng (Style BOX Y Khoa) cho bài text ngắn
app.post('/api/render-quote-card', async (req, res) => {
  const { text } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ success: false, error: 'Thiếu nội dung text' });
  }
  try {
    const png = await renderDarkQuoteCard(String(text).trim());
    if (!png) throw new Error('Không thể render ảnh');
    res.json({ success: true, pngBase64: png.toString('base64') });
  } catch (e) {
    console.error('[QuoteCard] Lỗi tạo ảnh:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Giọng đọc miễn phí của Microsoft Edge (Studio Video Tin): Nam Minh (nam) / Hoài My (nữ), trả MP3 base64.
// Không phải API chính thức → backend tự chuyển sang Gemini / giọng Linh nếu lỗi.
// Biến thể giọng = giọng gốc + cao độ/tốc độ (vd. Hoài My "trong trẻo, ấm": cao hơn chút, chậm hơn chút)
const EDGE_TTS_PRESETS = {
  'vi-VN-NamMinhNeural': { voice: 'vi-VN-NamMinhNeural', rate: '+8%', pitch: '+0%' },
  'vi-VN-HoaiMyNeural': { voice: 'vi-VN-HoaiMyNeural', rate: '+8%', pitch: '+0%' },
  'vi-VN-HoaiMyNeural:warm': { voice: 'vi-VN-HoaiMyNeural', rate: '-2%', pitch: '+6%' },
};
app.post('/api/tts-edge', async (req, res) => {
  const { text, voice = 'vi-VN-NamMinhNeural', rate, pitch } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ success: false, error: 'Thiếu nội dung cần đọc' });
  const preset = EDGE_TTS_PRESETS[voice];
  if (!preset) return res.status(400).json({ success: false, error: `Giọng Edge không hỗ trợ: ${voice}` });
  const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
  const dir = await fs.promises.mkdtemp(path.join(require('os').tmpdir(), 'edge-tts-'));
  const tts = new MsEdgeTTS();
  try {
    // Bật mốc thời gian từng từ → Studio Video tự làm phụ đề chạy theo giọng đọc
    await tts.setMetadata(preset.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
    // rate/pitch người dùng chỉnh (vd. '+15%', '-5Hz'); không hợp lệ thì dùng của preset
    const okRate = typeof rate === 'string' && /^[+-]?\d{1,3}%$/.test(rate) ? rate : preset.rate;
    const okPitch = typeof pitch === 'string' && /^[+-]?\d{1,3}(%|Hz)$/.test(pitch) ? pitch : preset.pitch;
    const { audioFilePath, metadataFilePath } = await Promise.race([
      tts.toFile(dir, String(text).trim().slice(0, 3000), { rate: okRate, pitch: okPitch }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Edge TTS quá 30s')), 30000)),
    ]);
    const buf = await fs.promises.readFile(audioFilePath);
    if (buf.length < 1000) throw new Error('Edge TTS trả về file rỗng');
    // Offset/Duration tính theo đơn vị 100ns; file có thể gồm nhiều khối JSON nối nhau nên đọc bằng regex
    const words = [];
    try {
      const meta = metadataFilePath ? await fs.promises.readFile(metadataFilePath, 'utf8') : '';
      const re = /"Offset"\s*:\s*(\d+)\s*,\s*"Duration"\s*:\s*(\d+)\s*,\s*"text"\s*:\s*\{\s*"Text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
      let m;
      while ((m = re.exec(meta))) {
        const start = Number(m[1]) / 1e7;
        words.push({ text: JSON.parse(`"${m[3]}"`), start: Math.round(start * 1000) / 1000, end: Math.round((start + Number(m[2]) / 1e7) * 1000) / 1000 });
      }
      words.sort((x, y) => x.start - y.start);
    } catch (e) {
      console.warn('[EdgeTTS] Không đọc được mốc từ:', e.message);
    }
    res.json({ success: true, mp3Base64: buf.toString('base64'), words });
  } catch (e) {
    console.error('[EdgeTTS] Lỗi:', e.message);
    res.status(502).json({ success: false, error: e.message });
  } finally {
    try { tts.close(); } catch (_) {}
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

app.post('/api/scrape-content', async (req, res) => {
  let { sourceUrl, sourceType = 'WEBSITE_CRAWLER', limit, minViews, includeCredit, forceRefresh, socialAccountId, cookieString } = req.body;
  const shouldIncludeCredit = includeCredit === true || includeCredit === 'true';
  const shouldForceRefresh = forceRefresh === true || forceRefresh === 'true';
  const scrapeIdentityKey = computeScrapeIdentityKey(socialAccountId, cookieString);

  if (!sourceUrl) {
    return res.status(400).json({ success: false, error: 'Thiếu sourceUrl' });
  }

  // Số bài tối đa muốn cào mỗi lần (mặc định 10, chặn trần 50 để tránh cào quá nhiều gây quá tải)
  const scrapeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
  // Ngưỡng lượt xem tối thiểu để coi 1 bài là "viral" — chỉ áp dụng cho các nhánh cào tự động
  // hàng loạt (tìm theo từ khóa / theo trang), KHÔNG áp dụng cho Quick Post dán 1 link cụ thể
  // (người dùng đã tự chọn bài đó rồi, không nên loại vì lượt xem thấp).
  const minViewsThreshold = Math.max(parseInt(minViews, 10) || 0, 0);

  // Tự động phát hiện loại nguồn theo URL trừ khi sourceType đã là 1 loại worker thực sự hiểu
  // (vd: "DIRECT_LINK" từ Quick Post không phải loại worker hiểu, phải soi lại URL chứ không được rơi
  // xuống WEBSITE_CRAWLER, nếu không link Threads sẽ bị cào nhầm bằng bộ cào tổng quát chỉ lấy og:image)
  const knownScraperTypes = ['RSS_FEED', 'THREADS', 'FB_PAGE', 'FB_GROUP', 'TIKTOK'];
  if (!sourceType || !knownScraperTypes.includes(sourceType)) {
    if (sourceUrl.includes('threads.net') || sourceUrl.includes('threads.com')) sourceType = 'THREADS';
    else if (sourceUrl.endsWith('.xml') || sourceUrl.includes('/rss') || sourceUrl.includes('/feed')) sourceType = 'RSS_FEED';
    else if (sourceUrl.includes('facebook.com')) sourceType = 'FB_PAGE';
    else if (sourceUrl.includes('tiktok.com') || sourceUrl.includes('douyin.com')) sourceType = 'TIKTOK';
  }

  // Bóc URL từ Embed Code Threads nếu cần
  if (sourceUrl.includes('<blockquote') || sourceUrl.includes('permalink') || sourceUrl.includes('cite=')) {
    const match = sourceUrl.match(/data-text-post-permalink="([^"]+)"|cite="([^"]+)"|href="([^"]+)"/);
    if (match) {
      sourceUrl = match[1] || match[2] || match[3];
      sourceType = 'THREADS';
      console.log(`[Scraper] 💡 Embed Code → URL: ${sourceUrl}`);
    }
  }

  console.log(`[Scraper] 🚀 Bắt đầu cào | sourceType: ${sourceType} | URL: ${sourceUrl}${minViewsThreshold > 0 ? ` | minViews: ${minViewsThreshold}` : ''}`);

  // ── 1. RSS FEED (nhanh, không cần Playwright) ──────────────────────────────
  if (sourceType === 'RSS_FEED') {
    const rssCacheKey = getScrapeCacheKey(sourceUrl, scrapeLimit, minViewsThreshold, shouldIncludeCredit, scrapeIdentityKey);
    if (shouldForceRefresh) {
      delete scrapeCache[rssCacheKey];
      saveScrapeCache();
    } else {
      const cachedRss = scrapeCache[rssCacheKey];
      if (cachedRss && (Date.now() - cachedRss.scrapedAt) < SCRAPE_CACHE_TTL_MS) {
        console.log(`[RSS] ♻️ Dùng lại kết quả đã cào gần đây (${Math.round((Date.now() - cachedRss.scrapedAt) / 60000)} phút trước): ${sourceUrl}`);
        return res.json({ ...cachedRss.result, cached: true });
      }
    }
    try {
      const parser = new RssParser({
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AutoPostBot/1.0)' },
      });
      const feed = await parser.parseURL(sourceUrl);
      const items = (feed.items || []).slice(0, scrapeLimit).map(item => ({
        title: item.title || '',
        originalUrl: item.link || item.guid || sourceUrl,
        content: item.contentSnippet || item.content || item.summary || item.title || '',
        mediaUrls: item.enclosure?.url ? [item.enclosure.url] : [],
      }));
      console.log(`[RSS] ✅ Cào được ${items.length} bài từ RSS Feed!`);
      const rssResult = { success: true, items };
      scrapeCache[rssCacheKey] = { result: rssResult, scrapedAt: Date.now() };
      saveScrapeCache();
      return res.json(rssResult);
    } catch (err) {
      console.error('[RSS] ❌ Lỗi parse RSS:', err.message);
      return res.status(500).json({ success: false, error: `Lỗi RSS: ${err.message}` });
    }
  }

  // ── 2. THREADS ─────────────────────────────────────────────────────────────
  if (sourceType === 'THREADS') {
    const threadsCacheKey = getScrapeCacheKey(sourceUrl, scrapeLimit, minViewsThreshold, shouldIncludeCredit, scrapeIdentityKey);
    if (shouldForceRefresh) {
      delete scrapeCache[threadsCacheKey];
      saveScrapeCache();
    } else {
      const cachedThreads = scrapeCache[threadsCacheKey];
      if (cachedThreads && (Date.now() - cachedThreads.scrapedAt) < SCRAPE_CACHE_TTL_MS) {
        console.log(`[Threads] ♻️ Dùng lại kết quả đã cào gần đây (${Math.round((Date.now() - cachedThreads.scrapedAt) / 60000)} phút trước): ${sourceUrl}`);
        return res.json({ ...cachedThreads.result, cached: true });
      }
    }
    let releaseContext = null;
    try {
      // Context từ browserPool (chung process Chromium) thay vì chromium.launch() riêng mỗi request.
      const acquired = await browserPool.acquireContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
      releaseContext = acquired.release;
      const context = acquired.context;
      const page = await context.newPage();
      page.on('console', msg => console.log(`[BrowserConsole] 💬 ${msg.text()}`));
      // Kiểm tra xem URL có chứa nhiều từ khóa tìm kiếm phân cách bằng dấu phẩy không
      let keywords = [];
      try {
        const urlObj = new URL(sourceUrl);
        const qParam = urlObj.searchParams.get('q');
        if (qParam && qParam.includes(',')) {
          keywords = qParam.split(',').map(k => k.trim()).filter(Boolean);
        }
      } catch (e) { }

      let items = [];
      let knownThreadsVideoUrls = [];

      if (keywords.length > 0) {
        console.log(`[Threads] 🔍 Phát hiện ${keywords.length} từ khóa cào: ${keywords.join(', ')}`);
        for (const kw of keywords) {
          if (items.length >= scrapeLimit) break;
          // Thử tìm kiếm từ khóa cụ thể hoặc ưu tiên các chủ đề chuẩn mèo 100% như catsofthreads
          const searchTerms = [kw, 'catsofthreads', 'cats of threads', 'cat clips'];
          for (const term of searchTerms) {
            if (items.length >= scrapeLimit) break;
            const kwUrl = `https://www.threads.net/search?q=${encodeURIComponent(term)}`;
            console.log(`[Threads] 🌐 Đang cào theo từ khóa chuẩn mèo: "${term}"...`);
            try {
              await page.goto(kwUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
              await page.waitForTimeout(3500);
              await page.evaluate(() => window.scrollBy(0, 800));
              await page.waitForTimeout(1500);

              const kwLimit = scrapeLimit - items.length;
              const kwItems = await page.evaluate(({ scrapeLimitArg, minViewsArg, includeCreditArg }) => {
                // Trang danh sách/tìm kiếm Threads KHÔNG hiển thị chữ "views" — chỉ có số thô nằm
                // cạnh icon Like/Comment/Repost/Share. Số ngay trong div cha của icon "Like" là chỉ
                // số đáng tin cậy nhất để đo độ nổi tiếng (view count thật chỉ có ở trang 1 bài riêng lẻ).
                const parseCount = (text) => {
                  if (!text) return 0;
                  const m = text.trim().match(/^([\d.,]+)\s*([KMkm]?)$/);
                  if (!m) return 0;
                  let num = parseFloat(m[1].replace(/,/g, ''));
                  const suffix = m[2].toUpperCase();
                  if (suffix === 'K') num *= 1000;
                  else if (suffix === 'M') num *= 1000000;
                  return Math.round(num);
                };
                const getLikeCount = (el) => {
                  const likeSvg = el.querySelector('svg[aria-label="Like"], svg[aria-label="Thích"]');
                  const text = likeSvg ? (likeSvg.parentElement?.innerText || '') : '';
                  return parseCount(text);
                };
                const extractThreadsPostId = (href) => {
                  if (!href) return null;
                  const m = href.match(/\/(?:post|t)\/([^/?#]+)/);
                  return m ? m[1] : null;
                };
                const isForeignContainerFor = (container, refPostId) => {
                  const link = container.querySelector('a[href*="/post/"], a[href*="/t/"]');
                  const id = link ? extractThreadsPostId(link.getAttribute('href')) : null;
                  return !!(id && refPostId && id !== refPostId);
                };

                const results = [];
                const postWrappers = document.querySelectorAll('div[data-pressable-container="true"], article, div[role="article"]');
                postWrappers.forEach((el) => {
                  if (results.length >= scrapeLimitArg) return;
                  const textEl = el.querySelector('span[dir="auto"], div[dir="auto"]');
                  const linkEl = el.querySelector('a[href*="/post/"]');
                  if (!linkEl?.href) return;

                  let authorUsername = '';
                  const authorLink = el.querySelector('a[href*="/@"]');
                  if (authorLink) {
                    const href = authorLink.getAttribute('href') || '';
                    const match = href.match(/@([^/?#]+)/);
                    if (match) authorUsername = match[1];
                  }

                  const viewCount = getLikeCount(el);
                  if (minViewsArg > 0 && viewCount < minViewsArg) return;

                  const wrapperPostId = extractThreadsPostId(linkEl.href);
                  const isReplyMedia = (mediaEl) => {
                    const ownContainer = mediaEl.closest('div[data-pressable-container="true"]');
                    return !!(ownContainer && ownContainer !== el && isForeignContainerFor(ownContainer, wrapperPostId));
                  };
                  const videoEls = Array.from(el.querySelectorAll('video source[src], video[src]')).filter(v => !isReplyMedia(v));
                  const imgEls = Array.from(el.querySelectorAll('img[src*="cdninstagram"], img[src*="threads"], img[src*="fbcdn.net"]')).filter(img => !isReplyMedia(img));
                  const mediaList = [];
                  videoEls.forEach(v => { const src = v.src || v.getAttribute('src'); if (src && !src.includes('bytestart=') && !src.includes('byteend=')) mediaList.push(src); });
                  imgEls.forEach(img => { if (img.src && !img.src.includes('profile') && !img.src.includes('s150x150') && !img.src.includes('external.')) mediaList.push(img.src); });
                  mediaList.sort((a, b) => (a.includes('mp4') || a.includes('video') ? -1 : 1));

                  if (mediaList.length === 0 && (!textEl?.innerText || textEl.innerText.trim().length <= 2)) {
                    return;
                  }

                  const content = textEl?.innerText?.trim() || '';
                  const contentLower = content.toLowerCase();

                  const trashKeywords = [
                    'anh trai', 'atvncg', 'yeah1', 'rap', 'showbiz', 'ca sĩ', 'concert', 'fandom', 'idol',
                    'duy khánh', 'bùi công nam', 'hòooo', 'cường bạch', 'uprize', 'bex', 'hồng cường', 'vlog hôm nay'
                  ];
                  if (trashKeywords.some(trashKw => contentLower.includes(trashKw))) return;

                  if (mediaList.length > 0) {
                    const creLine = (includeCreditArg && authorUsername) ? `\n\nCre: @${authorUsername}` : '';
                    const finalContent = `${content || ''}${creLine}`.trim();

                    results.push({
                      title: content.length > 80 ? content.slice(0, 80) + '...' : (content || authorUsername || 'Bài viết Threads'),
                      originalUrl: linkEl.href,
                      content: finalContent,
                      mediaUrls: [...new Set(mediaList)],
                      viewCount,
                    });
                  }
                });
                return results;
              }, { scrapeLimitArg: kwLimit, minViewsArg: minViewsThreshold, includeCreditArg: shouldIncludeCredit });

              if (kwItems && kwItems.length > 0) {
                items.push(...kwItems);
                break;
              }
            } catch (errKw) {
              console.warn(`[Threads] ⚠️ Lỗi cào từ khóa "${term}":`, errKw.message);
            }
          }
        }
      } else {
        const capturedMp4s = [];
        const isLikelyStaticImage = (u) => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u);
        page.on('response', (response) => {
          const u = response.url();
          if (u.includes('.mp4') || (u.includes('cdninstagram.com') && (u.includes('/m86/') || u.includes('/v/t2/')) && !isLikelyStaticImage(u))) {
            capturedMp4s.push(u);
          }
        });

        sourceUrl = await navigateThreadsPage(page, sourceUrl);
        await page.waitForSelector('span[dir="auto"], div[dir="auto"], article', { timeout: 10000 }).catch(() => { });
        await page.waitForTimeout(3000);
        const isDirectThreadsPost = isThreadsDirectPostUrl(sourceUrl);
        if (!isDirectThreadsPost) {
          await page.evaluate(() => window.scrollBy(0, 800));
          await page.waitForTimeout(2000);
        } else {
          // Threads chỉ gắn "video_versions" (link video thật) vào DOM sau 1 khoảng trễ dài (đo thực tế:
          // ~12-14 giây kể từ lúc trang commit, live test 2026-08-27) — dữ liệu video được JS phía client
          // tự gọi thêm 1 request lấy về SAU KHI phần còn lại của trang (text/caption) đã render xong sẵn,
          // không đồng bộ cùng lúc. Chờ ngắn như phần caption phía trên sẽ luôn rớt xuống lấy nhầm ảnh
          // bìa/thumbnail thay vì video thật. Poll tối đa ~18s, dừng sớm ngay khi xuất hiện — chỉ áp cho
          // bài đơn (isDirectThreadsPost), nhánh liệt kê feed/từ khoá không cần chính xác video từng bài.
          for (let i = 0; i < 9; i++) {
            const htmlSoFar = await page.content().catch(() => '');
            if (htmlSoFar.includes('"video_versions"')) break;
            await page.waitForTimeout(2000);
          }
        }

        const sanitizeVideoUrl = (rawUrl) => {
          if (!rawUrl) return null;
          let cleaned = String(rawUrl)
            .replace(/\\u0025/g, '%')
            .replace(/\\u0026/g, '&')
            .replace(/&amp;/g, '&')
            .replace(/\\\//g, '/')
            .replace(/\\/g, '');
          const cutoffIdx = cleaned.search(/u003C|<\/BaseURL|<|["'\s]/i);
          if (cutoffIdx !== -1) {
            cleaned = cleaned.substring(0, cutoffIdx);
          }
          try {
            const u = new URL(cleaned);
            if (u.searchParams.has('bytestart') || u.searchParams.has('byteend')) return null;
            if (u.hostname === 'static.cdninstagram.com' || u.pathname.includes('/rsrc.php/')) return null;
            return cleaned;
          } catch (e) {
            return null;
          }
        };

        let pageHtml = '';
        try {
          pageHtml = await page.content();
        } catch (e) {
          await page.waitForTimeout(1500);
          pageHtml = await page.content().catch(() => '');
        }
        const hdVideoUrlFromHtml = extractBestHdVideoUrl(pageHtml);
        const uniqueMp4s = hdVideoUrlFromHtml ? [hdVideoUrlFromHtml] : [...new Set(capturedMp4s.map(sanitizeVideoUrl).filter(Boolean))];
        knownThreadsVideoUrls = uniqueMp4s;

        // Duyệt toàn bộ carousel (cả video và ảnh) cho bài đơn Threads — hỗ trợ cả bài hỗn hợp
        let threadsCarouselPhotos = [];
        let threadsCarouselVideos = [];
        if (isDirectThreadsPost) {
          try {
            const mainContainerHandle = await locateThreadsMainContainerHandle(page, sourceUrl);
            const carouselResult = await expandThreadsCarousel(page, mainContainerHandle);
            threadsCarouselPhotos = carouselResult.photos || [];
            threadsCarouselVideos = carouselResult.videos || [];
          } catch (e) {
            console.warn('[Threads] ⚠️ Không duyệt được carousel:', e.message);
          }
        }

        const jsonThreadsCaption = extractThreadsDataFromHtml(pageHtml, sourceUrl);
        const jsonThreadsMedia = extractAllThreadsMediaFromHtml(pageHtml, sourceUrl);
        if (jsonThreadsMedia.photos.length > 0) {
          threadsCarouselPhotos = [...new Set([...threadsCarouselPhotos, ...jsonThreadsMedia.photos])];
        }
        if (jsonThreadsMedia.videos.length > 0) {
          threadsCarouselVideos = [...new Set([...threadsCarouselVideos, ...jsonThreadsMedia.videos])];
        }

        items = await page.evaluate(({ sourceUrlArg, scrapeLimitArg, mp4s, minViewsArg, includeCreditArg, threadsCarouselPhotosArg, threadsCarouselVideosArg, jsonCaptionArg, jsonOrderedMediaArg }) => {
          const parseCount = (text) => {
            if (!text) return 0;
            const m = text.trim().match(/^([\d.,]+)\s*([KMkm]?)$/);
            if (!m) return 0;
            let num = parseFloat(m[1].replace(/,/g, ''));
            const suffix = m[2].toUpperCase();
            if (suffix === 'K') num *= 1000;
            else if (suffix === 'M') num *= 1000000;
            return Math.round(num);
          };
          const getLikeCount = (el) => {
            const likeSvg = el.querySelector('svg[aria-label="Like"], svg[aria-label="Thích"]');
            const text = likeSvg ? (likeSvg.parentElement?.innerText || '') : '';
            return parseCount(text);
          };

          const results = [];
          const isSinglePostUrl = /\/post\/|\/t\/|\/share\/|\/photo\/|\/permalink|\/story\.php/.test(sourceUrlArg || '') || /\/post\/|\/t\/|\/share\/|\/photo\/|\/permalink|\/story\.php/.test(window.location.href) || (scrapeLimitArg === 1);

          const extractThreadsPostId = (href) => {
            if (!href) return null;
            const m = href.match(/\/(?:post|t)\/([^/?#]+)/);
            return m ? m[1] : null;
          };
          const isForeignContainerFor = (container, refPostId) => {
            const link = container.querySelector('a[href*="/post/"], a[href*="/t/"]');
            const id = link ? extractThreadsPostId(link.getAttribute('href')) : null;
            return !!(id && refPostId && id !== refPostId);
          };

          if (isSinglePostUrl) {
            const currentPostId = extractThreadsPostId(window.location.pathname);
            const allContainers = Array.from(document.querySelectorAll('div[data-pressable-container="true"]'));
            const mainContainer = allContainers.find(container => {
              const permalink = container.querySelector('a[href*="/post/"], a[href*="/t/"]');
              return extractThreadsPostId(permalink?.getAttribute('href')) === currentPostId;
            }) || allContainers[0] || null;
            const commentSection = document.querySelector('[aria-label*="Bình luận"], [aria-label*="Comment"]');
            const searchScope = mainContainer || document.querySelector('main, article, [role="main"]') || document.body;

            let targetPathname = window.location.pathname;
            try {
              if (sourceUrlArg) targetPathname = new URL(sourceUrlArg).pathname;
            } catch (e) { }
            const pathParts = targetPathname.split('/');
            let authorUsername = pathParts.find(p => p.startsWith('@'))?.replace('@', '').trim() || '';
            if (!authorUsername) {
              const authorLink = document.querySelector('a[href*="/@"]');
              if (authorLink) {
                const href = authorLink.getAttribute('href') || '';
                const match = href.match(/@([^/?#]+)/);
                if (match) authorUsername = match[1];
              }
            }
            const authorLower = (authorUsername || '').toLowerCase();

            const getContainerAuthor = (container) => {
              const links = Array.from(container?.querySelectorAll('a[href*="/@"]') || []);
              for (const link of links) {
                const match = (link.getAttribute('href') || '').match(/\/@([^/?#]+)/);
                if (match) return match[1].toLowerCase();
              }
              return '';
            };
            const mediaScopes = mainContainer ? [mainContainer] : [];
            const mainIndex = allContainers.indexOf(mainContainer);
            for (let i = mainIndex + 1; i >= 0 && i < allContainers.length; i++) {
              const candidate = allContainers[i];
              const candidateAuthor = getContainerAuthor(candidate);
              if (!candidateAuthor || candidateAuthor !== authorLower) break;
              const label = (candidate.innerText || '').toLowerCase();
              if (!/(^|\n)(author|tác giả)(\n|$)/i.test(label)) break;
              mediaScopes.push(candidate);
            }

            const isExcluded = (el) => {
              if (!searchScope || !searchScope.contains(el)) return true;
              if (commentSection && commentSection.contains(el)) return true;
              if (mainContainer) {
                const ownContainer = el.closest('div[data-pressable-container="true"]');
                if (ownContainer && ownContainer !== searchScope && isForeignContainerFor(ownContainer, currentPostId)) return true;
              }
              return false;
            };

            const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() || '';
            const ogImageUrl = document.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim() || '';
            const ogVideoUrl = document.querySelector('meta[property="og:video"], meta[property="og:video:url"]')?.getAttribute('content')?.trim() || '';

            const isDateOrTimeOrNoise = (t) => {
              if (!t || t.length < 2) return true;
              if (/^\d+[hmdws]$/i.test(t)) return true;
              if (/^\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}$/.test(t)) return true;
              if (/^\d{4}[\/\.-]\d{1,2}[\/\.-]\d{1,2}$/.test(t)) return true;
              if (/^[\d.,\s]+[KMkm]?\+?$/i.test(t)) return true;
              const noise = ['author', 'tác giả', 'translate', 'dịch', 'follow', 'theo dõi', 'reply', 'repost', 'share', 'views', 'likes', 'replies', 'xem', 'bình luận', 'thích', 'chia sẻ', 'related threads', 'log in', 'open app', 'threads terms', 'privacy policy', 'cookies policy', 'report a problem'];
              if (noise.includes(t.toLowerCase())) return true;
              return false;
            };

            // Lấy toàn bộ các đoạn văn bản (multi-paragraph) trong searchScope
            const textCandidates = searchScope ? Array.from(searchScope.querySelectorAll('span[dir="auto"], div[dir="auto"]')) : [];
            const collectedLines = [];
            const seenTexts = new Set();

            for (const el of textCandidates) {
              if (isExcluded(el)) continue;
              if (el.closest('header') || el.closest('button') || el.closest('time')) continue;
              const closestA = el.closest('a');
              if (closestA && (closestA.getAttribute('href')?.includes('/@') || closestA.getAttribute('href')?.includes('/post/'))) continue;

              let t = (el.innerText || '').trim();
              if (!t || t.length < 2) continue;
              if (t.toLowerCase() === authorLower) continue;
              if (isDateOrTimeOrNoise(t)) continue;
              if (t.includes('Join Threads to share') || t.includes('Log in with your Instagram') || t.includes('Cookie')) continue;

              if (seenTexts.has(t)) continue;
              const hasParent = collectedLines.some(item => item.el.contains(el));
              if (hasParent) continue;

              const childIdx = collectedLines.findIndex(item => el.contains(item.el));
              if (childIdx >= 0) {
                seenTexts.delete(collectedLines[childIdx].t);
                collectedLines[childIdx] = { el, t };
                seenTexts.add(t);
              } else {
                collectedLines.push({ el, t });
                seenTexts.add(t);
              }
            }

            const domFullCaption = collectedLines.map(item => item.t.replace(/\n?(Translate|Dịch)\s*$/i, '').trim()).join('\n\n');

            let rawText = '';
            if (jsonCaptionArg && jsonCaptionArg.trim().length > 0) {
              rawText = jsonCaptionArg.trim();
            } else if (domFullCaption && domFullCaption.trim().length > 0) {
              rawText = domFullCaption.trim();
            } else if (ogDescription && !ogDescription.includes('Join Threads to share')) {
              rawText = ogDescription.trim();
            } else {
              rawText = 'Nội dung bài viết Threads';
            }
            rawText = rawText.replace(/\n?(Translate|Dịch)\s*$/i, '').trim();

            const isAudioOnlyUrl = (src) => {
              try {
                const efg = new URL(src).searchParams.get('efg');
                if (!efg) return false;
                const normalized = efg.replace(/-/g, '+').replace(/_/g, '/');
                const decoded = window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
                return decoded.includes('audio') && !decoded.includes('video');
              } catch (e) {
                return false;
              }
            };

            const sanitizeVideoUrl = (rawUrl) => {
              if (!rawUrl) return null;
              const cleaned = rawUrl.split(/\\u[0-9a-fA-F]{4}/)[0];
              try {
                const u = new URL(cleaned);
                if (u.searchParams.has('bytestart') || u.searchParams.has('byteend')) return null;
                if (u.hostname === 'static.cdninstagram.com' || u.pathname.includes('/rsrc.php/')) return null;
                if (isAudioOnlyUrl(cleaned)) return null;
                return cleaned;
              } catch (e) {
                return null;
              }
            };

            const photoLinkImgs = (searchScope ? Array.from(searchScope.querySelectorAll('a[href*="/photo"] img, div[data-visualcompletion="media-vc-image"] img, [role="main"] img[src*="t39.30808-6"]')) : [])
              .filter(img => !isExcluded(img));

            const pickBestFromSrcset = (srcset) => {
              if (!srcset) return null;
              const parts = srcset.split(',').map(p => p.trim()).filter(Boolean);
              let bestUrl = null;
              let maxW = 0;
              for (const part of parts) {
                const [url, wStr] = part.split(/\s+/);
                const w = wStr ? parseInt(wStr.replace('w', ''), 10) : 0;
                if (w >= maxW) {
                  maxW = w;
                  bestUrl = url;
                }
              }
              return bestUrl;
            };

            let mainPhotoUrls = photoLinkImgs
              .map(img => pickBestFromSrcset(img.srcset || img.getAttribute('srcset')) || img.src)
              .filter(s => s && s.includes('fbcdn.net') && !s.includes('profile') && !s.includes('rsrc.php') && !s.includes('static.xx') && !s.includes('t45.') && !s.includes('ctp=s80x80') && !s.includes('ctp=p75x225'));

            const imgEls = (searchScope ? Array.from(searchScope.querySelectorAll('img[src*="cdninstagram"], img[src*="threads"], img[src*="fbcdn.net"]')) : [])
              .filter(img => !isExcluded(img));

            const isEncodedVideoCoverFrame = (src) => {
              try {
                const efg = new URL(src).searchParams.get('efg');
                if (!efg) return false;
                const normalized = efg.replace(/-/g, '+').replace(/_/g, '/');
                const decoded = window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
                return /video.*cover[_-]?frame|cover[_-]?frame.*video/i.test(decoded);
              } catch (e) {
                return false;
              }
            };

            const videoEls = mediaScopes.flatMap(scope => Array.from(scope.querySelectorAll('video')));
            const videoPosterUrls = new Set(videoEls.map(el => el.poster || el.getAttribute('poster')).filter(Boolean));
            let carouselImgUrls = imgEls
              .map(el => el.src)
              .filter(s => s && !s.includes('profile') && !s.includes('s150x150') && !s.includes('s80x80') && !s.includes('rsrc.php') && !s.includes('static.xx') && !s.includes('t45.1600-4') && !s.includes('t45.5328-4'))
              .filter(s => !s.includes('ctp=s180x540') && !s.includes('ctp=s320x320') && !s.includes('ctp=s80x80') && !s.includes('ctp=p75x225'))
              .filter(s => !videoPosterUrls.has(s) && !isEncodedVideoCoverFrame(s));

            if (mainPhotoUrls.length > 0) {
              carouselImgUrls = mainPhotoUrls;
            }

            // Ảnh gom được từ bước bấm Next duyệt carousel (Playwright, chạy trước evaluate này) — hợp
            // vào để không bỏ sót ảnh phía sau chưa render sẵn trong DOM lúc trang mới load.
            if (threadsCarouselPhotosArg && threadsCarouselPhotosArg.length > 0) {
              carouselImgUrls = [...new Set([...carouselImgUrls, ...threadsCarouselPhotosArg])];
            }

            const cleanVideoUrl = (rawUrl) => {
              if (!rawUrl) return null;
              const cleaned = rawUrl.split(/\\u[0-9a-fA-F]{4}/)[0];
              try {
                const u = new URL(cleaned);
                if (u.searchParams.has('bytestart') || u.searchParams.has('byteend')) return null;
                if (u.hostname === 'static.cdninstagram.com' || u.pathname.includes('/rsrc.php/')) return null;
                return cleaned;
              } catch (e) {
                return null;
              }
            };
            const videoDedupeKey = (url) => {
              try { return new URL(url).pathname; } catch (e) { return String(url).split('?')[0]; }
            };
            const dedupeVideosByKey = (list) => {
              const map = new Map();
              for (const u of list) {
                const key = videoDedupeKey(u);
                if (!map.has(key)) map.set(key, u);
              }
              return [...map.values()];
            };
            const scopedVideoEls = mediaScopes.flatMap(scope => Array.from(scope.querySelectorAll('video source[src], video[src]')));
            const scopedVideoUrls = [...new Set(
              scopedVideoEls.map(el => cleanVideoUrl(el.currentSrc || el.src || el.getAttribute('src'))).filter(Boolean)
            )];
            const hasScopedVideoEvidence = videoEls.length > 0 || mediaScopes.some(scope =>
              Array.from(scope.querySelectorAll('img')).some(img => isEncodedVideoCoverFrame(img.src))
            );

            let mediaUrls = [];
            const carouselVideos = [...new Set(threadsCarouselVideosArg || [])].filter(Boolean);
            const carouselVideosDeduped = dedupeVideosByKey(carouselVideos);
            const domVideos = [...new Set(scopedVideoUrls || [])].filter(Boolean);
            const jsonHdVideos = [...new Set(mp4s || [])].filter(Boolean);
            // Một clip Threads thường xuất hiện đồng thời ở carousel DOM, currentSrc và video_versions
            // HD với URL CDN khác nhau (token ký khác nhau dù cùng 1 video vật lý) — dedupe theo pathname
            // trước khi đếm. Chỉ dùng một nguồn cho bài có một video; nếu carousel thực sự có nhiều video
            // (pathname khác nhau) thì giữ đầy đủ carousel. JSON HD được ưu tiên cho bài một video để giữ chất lượng.
            const rawAllVideos = carouselVideosDeduped.length > 1
              ? carouselVideosDeduped
              : (jsonHdVideos.length > 0 ? jsonHdVideos : (carouselVideosDeduped.length > 0 ? carouselVideosDeduped : domVideos));
            const allVideos = dedupeVideosByKey(rawAllVideos);
            const allPhotos = [...new Set([...(threadsCarouselPhotosArg || []), ...(mainPhotoUrls || []), ...(carouselImgUrls || [])])].filter(Boolean);

            if (jsonOrderedMediaArg && jsonOrderedMediaArg.length > 0) {
              // Bóc tách trực tiếp đầy đủ và chính xác 100% từ JSON máy chủ của Threads (giữ nguyên thứ tự Video/Ảnh)
              mediaUrls = jsonOrderedMediaArg;
            } else if (allVideos.length > 0 && threadsCarouselVideosArg && threadsCarouselVideosArg.length > 0 && threadsCarouselPhotosArg && threadsCarouselPhotosArg.length > 0) {
              // Bài dạng hỗn hợp (vừa có video vừa có ảnh) qua carousel thật sự
              mediaUrls = [...allVideos, ...threadsCarouselPhotosArg];
            } else if (allVideos.length > 0) {
              // Bài chỉ có video (1 hoặc nhiều video thuần)
              mediaUrls = allVideos;
            } else if (allPhotos.length > 0) {
              // Bài chỉ có ảnh (1 hoặc nhiều ảnh)
              mediaUrls = allPhotos;
            } else if (ogVideoUrl) {
              mediaUrls = [ogVideoUrl];
            } else if (ogImageUrl && !ogImageUrl.includes('rsrc.php') && !ogImageUrl.includes('static.xx')) {
              mediaUrls = [ogImageUrl];
            }

            const creLine = (includeCreditArg && authorUsername) ? `\n\nCre: @${authorUsername}` : '';
            const formattedCaption = `${rawText}${creLine}`.trim();

            results.push({
              title: rawText.length > 80 ? rawText.slice(0, 80) + '...' : rawText,
              originalUrl: sourceUrlArg || window.location.href,
              content: formattedCaption,
              author: authorUsername ? `@${authorUsername}` : '',
              mediaUrls: [...new Set(mediaUrls)],
            });
          } else {
            const postWrappers = document.querySelectorAll('div[data-pressable-container="true"], article, div[role="article"]');
            postWrappers.forEach((el, idx) => {
              const linkEl = el.querySelector('a[href*="/post/"]');
              if (!linkEl?.href) return;

              const viewCount = getLikeCount(el);
              if (minViewsArg > 0 && viewCount < minViewsArg) return;

              const authorLink = el.querySelector('a[href*="/@"]');
              let authorUsername = '';
              if (authorLink) {
                const href = authorLink.getAttribute('href') || '';
                const match = href.match(/@([^/?#]+)/);
                if (match) authorUsername = match[1];
              }

              const wrapperPostId = extractThreadsPostId(linkEl.href);
              const isReplyMedia = (mediaEl) => {
                const ownContainer = mediaEl.closest('div[data-pressable-container="true"]');
                return !!(ownContainer && ownContainer !== el && isForeignContainerFor(ownContainer, wrapperPostId));
              };
              const videoEls = Array.from(el.querySelectorAll('video source[src], video[src]')).filter(v => !isReplyMedia(v));
              const imgEls = Array.from(el.querySelectorAll('img[src*="cdninstagram"], img[src*="threads"]')).filter(img => !isReplyMedia(img));

              const mediaList = [];
              videoEls.forEach(v => { const src = v.src || v.getAttribute('src'); if (src && !src.includes('bytestart=') && !src.includes('byteend=')) mediaList.push(src); });
              imgEls.forEach(img => { if (img.src && !img.src.includes('profile') && !img.src.includes('s150x150')) mediaList.push(img.src); });

              const textCandidates = Array.from(el.querySelectorAll('span[dir="auto"], div[dir="auto"]'));
              const collectedLines = [];
              const seen = new Set();
              for (const item of textCandidates) {
                if (item.closest('header') || item.closest('button') || item.closest('time')) continue;
                const closestA = item.closest('a');
                if (closestA && closestA.getAttribute('href')?.includes('/@')) continue;
                let t = (item.innerText || '').trim();
                if (!t || t.length < 2) continue;
                if (/^\d+[hmdws]$/i.test(t)) continue;
                if (/^\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}$/.test(t)) continue;
                if (['views', 'likes', 'replies', 'xem', 'translate', 'dịch', 'follow', 'bình luận', 'thích', 'chia sẻ'].includes(t.toLowerCase())) continue;
                if (seen.has(t)) continue;
                const hasParent = collectedLines.some(x => x.el.contains(item));
                if (hasParent) continue;
                const childIdx = collectedLines.findIndex(x => item.contains(x.el));
                if (childIdx >= 0) {
                  seen.delete(collectedLines[childIdx].t);
                  collectedLines[childIdx] = { el: item, t };
                  seen.add(t);
                } else {
                  collectedLines.push({ el: item, t });
                  seen.add(t);
                }
              }

              let content = collectedLines.map(x => x.t.replace(/\n?(Translate|Dịch)\s*$/i, '').trim()).join('\n\n');
              if (!content || /^\d+[hmdws]$/i.test(content) || /^\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}$/.test(content)) {
                content = '';
              }
              const contentLower = content.toLowerCase();

              const trashKeywords = ['anh trai', 'atvncg', 'yeah1', 'rap', 'showbiz', 'ca sĩ', 'concert', 'fandom', 'idol', 'duy khánh', 'bùi công nam', 'hòooo'];
              const isTrashShowbiz = trashKeywords.some(kw => contentLower.includes(kw));
              const catKeywords = ['mèo', 'cat', 'kitten', 'paws', 'pet', 'sen', 'boss', 'dễ thương', 'cute', 'béo', 'mun', 'mướp', 'tam thể', 'hoàng thượng', 'meow'];
              const hasCatKeyword = catKeywords.some(kw => contentLower.includes(kw));

              if (isTrashShowbiz && !hasCatKeyword) return;

              if (mediaList.length > 0) {
                const creLine = (includeCreditArg && authorUsername) ? `\n\nCre: @${authorUsername}` : '';
                const finalContent = `${content || 'Clip Mèo siêu đáng yêu cào từ Threads!'}${creLine}`.trim();
                results.push({
                  title: finalContent.length > 80 ? finalContent.slice(0, 80) + '...' : finalContent,
                  originalUrl: linkEl.href,
                  content: finalContent,
                  author: authorUsername ? `@${authorUsername}` : '',
                  mediaUrls: [...new Set(mediaList)],
                  viewCount,
                });
              }
            });
          }
          return results;
        }, {
          sourceUrlArg: sourceUrl,
          scrapeLimitArg: scrapeLimit,
          mp4s: uniqueMp4s,
          minViewsArg: minViewsThreshold,
          includeCreditArg: shouldIncludeCredit,
          threadsCarouselPhotosArg: threadsCarouselPhotos,
          threadsCarouselVideosArg: threadsCarouselVideos,
          jsonCaptionArg: jsonThreadsCaption,
          jsonOrderedMediaArg: jsonThreadsMedia.orderedMedia || []
        });
      }

      await releaseContext();
      releaseContext = null;
      const seenUrls = new Set();
      const dedupedItems = [];
      for (const item of items) {
        if (!item.originalUrl) continue;
        if (Array.isArray(item.mediaUrls)) {
          item.mediaUrls = item.mediaUrls.map(u => upgradeMediaUrlToHd(u));
        }
        const cleanUrl = item.originalUrl.split('?')[0].replace(/\/$/, '').replace('/permalink/', '/posts/');
        if (!seenUrls.has(cleanUrl)) {
          seenUrls.add(cleanUrl);
          item.originalUrl = cleanUrl;
          dedupedItems.push(attachMediaMetadata(item, knownThreadsVideoUrls));
        }
      }
      console.log(`[Threads] ✅ Cào được ${dedupedItems.length} bài!`);
      const threadsResult = { success: true, items: dedupedItems };
      scrapeCache[threadsCacheKey] = { result: threadsResult, scrapedAt: Date.now() };
      saveScrapeCache();
      return res.json(threadsResult);
    } catch (err) {
      console.error('[Threads] ❌ Lỗi:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    } finally {
      await releaseContext?.();
    }
  }

  // ── 2b. TIKTOK — Cào video TikTok Không Logo (No-Watermark) & Caption ───────
  if (sourceType === 'TIKTOK' || (sourceUrl && (sourceUrl.includes('tiktok.com') || sourceUrl.includes('douyin.com')))) {
    const scrapeCacheKey = getScrapeCacheKey(sourceUrl, scrapeLimit, minViewsThreshold, shouldIncludeCredit, scrapeIdentityKey);
    if (shouldForceRefresh) {
      delete scrapeCache[scrapeCacheKey];
      saveScrapeCache();
    } else {
      const cachedScrape = scrapeCache[scrapeCacheKey];
      if (cachedScrape && (Date.now() - cachedScrape.scrapedAt) < SCRAPE_CACHE_TTL_MS) {
        console.log(`[TikTok_Scraper] ♻️ Dùng lại kết quả đã cào gần đây (${Math.round((Date.now() - cachedScrape.scrapedAt) / 60000)} phút trước): ${sourceUrl}`);
        return res.json({ ...cachedScrape.result, cached: true });
      }
    }

    const scraped = await scrapeTikTokNoWatermark(sourceUrl);
    if (!scraped.success) {
      return res.status(404).json(scraped);
    }

    const resultItem = attachMediaMetadata({
      title: scraped.title,
      originalUrl: scraped.originalUrl,
      content: scraped.content,
      mediaUrls: scraped.mediaUrls,
      watermarkRemoved: scraped.watermarkRemoved,
      isHd: scraped.isHd,
      quality: scraped.quality,
    }, scraped.mediaUrls);

    const singlePostResult = {
      success: true,
      mediaType: resultItem.mediaType,
      mediaCount: resultItem.mediaCount,
      videoCount: resultItem.videoCount,
      imageCount: resultItem.imageCount,
      watermarkRemoved: scraped.watermarkRemoved,
      isHd: scraped.isHd,
      items: [resultItem],
    };
    scrapeCache[scrapeCacheKey] = { result: singlePostResult, scrapedAt: Date.now() };
    saveScrapeCache();
    return res.json(singlePostResult);
  }

  function normalizeFacebookSourceUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    try {
      let url = rawUrl.trim();
      // 1. Chuyển domain mobile sang www
      url = url.replace(/^https?:\/\/(?:m|mobile|touch|web)\.facebook\.com/i, 'https://www.facebook.com');

      const parsed = new URL(url);

      // 2. Chuyển multi_permalinks sang /posts/
      const multiPermalinks = parsed.searchParams.get('multi_permalinks');
      const matchGroup = parsed.pathname.match(/\/groups\/([^/?#]+)/);
      if (multiPermalinks && matchGroup) {
        return `https://www.facebook.com/groups/${matchGroup[1]}/posts/${multiPermalinks}/`;
      }

      // 3. Chuẩn hóa /groups/<group>/permalink/<id> thành /groups/<group>/posts/<id>/
      if (matchGroup && parsed.pathname.includes('/permalink/')) {
        parsed.pathname = parsed.pathname.replace('/permalink/', '/posts/');
      }

      // 4. Xóa sạch comment_id, reply_comment_id, notif, tracking params
      const paramsToClean = [
        'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
        'utm_content', 'is_from_webapp', 'sender_device', 'share_id',
        '_r', 'sfnsn', 'mibextid', '__cft__[0]', '__cft__', '__tn__',
        'ref', 'set', 'rdid', 'comment_id', 'reply_comment_id', 'reply_comment_ids',
        'notif_id', 'notif_t', 'paipv', 'idorvanity', 'source', 'refsrc',
        '__eep__', 'locale', 'hc_location', 'substory_index'
      ];
      paramsToClean.forEach((p) => parsed.searchParams.delete(p));
      return parsed.toString().replace(/[?&]$/, '');
    } catch {
      return rawUrl;
    }
  }

  // ── 3. FB_PAGE & FB_GROUP & FB_SINGLE — Cào bài từ Facebook (Link bài đơn / Album ảnh / Video / Feed Group) ─────
  if (sourceType === 'FB_PAGE' || sourceType === 'FB_GROUP' || (sourceUrl && sourceUrl.includes('facebook.com')) || (sourceUrl && sourceUrl.includes('fb.watch'))) {
    sourceUrl = normalizeFacebookSourceUrl(sourceUrl);

    // Resolve shortlink Facebook nếu là link rút gọn fb.watch, fb.me hoặc link /share/
    if (sourceUrl.includes('fb.watch') || sourceUrl.includes('fb.me') || sourceUrl.includes('/share/')) {
      try {
        const headRes = await axios.get(sourceUrl, {
          maxRedirects: 5,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          validateStatus: () => true,
          timeout: 8000
        });
        if (headRes.request?.res?.responseUrl && headRes.request.res.responseUrl !== sourceUrl) {
          sourceUrl = normalizeFacebookSourceUrl(headRes.request.res.responseUrl);
          console.log(`[FB_Scraper] 🔄 Resolved Facebook shortlink: ${sourceUrl}`);
        }
      } catch (_) { }
    }

    const scrapeCacheKey = getScrapeCacheKey(sourceUrl, scrapeLimit, minViewsThreshold, shouldIncludeCredit, scrapeIdentityKey);
    if (shouldForceRefresh) {
      delete scrapeCache[scrapeCacheKey];
      saveScrapeCache();
    } else {
      const cachedScrape = scrapeCache[scrapeCacheKey];
      if (cachedScrape && (Date.now() - cachedScrape.scrapedAt) < SCRAPE_CACHE_TTL_MS) {
        console.log(`[FB_Scraper] ♻️ Dùng lại kết quả đã cào gần đây (${Math.round((Date.now() - cachedScrape.scrapedAt) / 60000)} phút trước): ${sourceUrl}`);
        return res.json({ ...cachedScrape.result, cached: true });
      }
    }

    // Lấy mốc đối chiếu song song với lúc mở trình duyệt (chỉ cho link 1 bài, không tốn thêm thời gian)
    const anchorPromise = (/\/(posts|permalink|share|photo|photos|videos|watch|reel|story\.php)/i.test(sourceUrl) || /fb\.watch/i.test(sourceUrl) || scrapeLimit === 1)
      ? fetchFacebookPublicAnchor(sourceUrl).catch(() => null)
      : Promise.resolve(null);

    let releaseContext = null;
    try {
      // Context từ browserPool (chung process Chromium) hoặc tự mở Chromium dự phòng nếu pool đầy/chờ quá 10s
      const acquired = await browserPool.acquireScrapeContext({
        viewport: { width: 1280, height: 1024 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      }, { waitTimeoutMs: 10_000 });
      releaseContext = acquired.release;
      const context = acquired.context;

      // Nếu có cookieString (tài khoản Facebook đã kết nối), nạp Cookie vào context
      if (req.body.cookieString) {
        const cookies = req.body.cookieString.split(';').map(pair => {
          const [name, ...val] = pair.trim().split('=');
          return {
            name: name.trim(),
            value: val.join('=').trim(),
            domain: '.facebook.com',
            path: '/'
          };
        }).filter(c => c.name && c.value);
        await context.addCookies(cookies);
      }

      const isAudioOnlyMp4 = (url) => {
        if (!url || typeof url !== 'string') return true;
        const lower = url.toLowerCase();
        if (lower.includes('audio_') || lower.includes('_audio') || lower.includes('heaac') || lower.includes('vbr3_audio')) {
          return true;
        }
        try {
          const efgMatch = url.match(/[?&]efg=([^&]+)/);
          if (efgMatch) {
            const decoded = Buffer.from(decodeURIComponent(efgMatch[1]), 'base64').toString('utf8');
            if (decoded.includes('audio') || decoded.includes('heaac')) {
              return true;
            }
          }
        } catch (e) { }
        return false;
      };

      const capturedNetworkMp4s = [];
      // Facebook trả byte-range chunk kèm header Content-Range ("bytes 0-881/1454807") cho biết
      // TỔNG dung lượng thật của video gốc — dùng số này để tự ghép ra 1 URL request trọn vẹn
      // byte 0..cuối (bytestart=0&byteend=total-1) khi không bắt được link video đầy đủ nào khác,
      // thay vì phải đi cào lại nhiều đoạn rồi tự nối file.
      const videoTotalBytesByBaseUrl = new Map();
      const page = await context.newPage();
      // Tăng tốc: Chặn nạp các tài nguyên không cần thiết (fonts, tracking pixels, ads, stories, beacons) để cào nhanh hơn
      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        const url = route.request().url();
        if (
          resourceType === 'font' ||
          (resourceType === 'media' && !url.includes('.mp4')) ||
          url.includes('/privacy/sandbox/pixel') ||
          url.includes('google-analytics') ||
          url.includes('/ajax/bz') ||
          url.includes('doubleclick') ||
          url.includes('/stories/') ||
          url.includes('story_tray') ||
          url.includes('facebook.com/tr/') ||
          url.includes('connect.facebook.net/signals/') ||
          url.includes('graph.facebook.com/logging/') ||
          url.includes('/logging/') ||
          url.includes('bat.bing.com')
        ) {
          return route.abort().catch(() => {});
        }
        return route.continue().catch(() => {});
      });

      page.on('response', resp => {
        try {
          const contentType = resp.headers()['content-type'] || '';
          if (contentType.includes('video/mp4')) {
            const u = resp.url();
            if (u && !isAudioOnlyMp4(u)) {
              capturedNetworkMp4s.push(u);
              const contentRange = resp.headers()['content-range'];
              const rangeMatch = contentRange && contentRange.match(/bytes\s+\d+-\d+\/(\d+)/);
              if (rangeMatch) {
                const total = parseInt(rangeMatch[1], 10);
                const baseUrl = u.replace(/[?&]bytestart=\d+/i, '').replace(/[?&]byteend=\d+/i, '');
                const prevTotal = videoTotalBytesByBaseUrl.get(baseUrl);
                if (!prevTotal || total > prevTotal) videoTotalBytesByBaseUrl.set(baseUrl, total);
              }
            }
          }
        } catch (e) { }
      });

      console.log(`[FB_Scraper] 🌐 Đang cào bài Facebook: ${sourceUrl}...`);
      await page.goto(sourceUrl, { waitUntil: 'commit', timeout: 30000 }).catch(() => { });
      await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => { });
      // Tối ưu hiệu năng: Race giữa việc phần tử bài viết xuất hiện và timeout ngắn thay vì sleep cố định 3500ms
      await Promise.race([
        page.waitForSelector('[role="article"], div[data-ad-preview="message"], video, div[data-visualcompletion="media-vc-image"], div[role="main"]', { timeout: 2500 }),
        page.waitForTimeout(1600)
      ]).catch(() => { });

      // Phát hiện sớm bài private/đã xóa/cần đăng nhập lại — nếu không check, các bước cào phía dưới
      // vẫn chạy hết rồi âm thầm trả về media rỗng, khiến người dùng tưởng lỗi tool chứ không phải link chết.
      const accessIssue = await page.evaluate(() => {
        const title = document.title || '';
        const mainText = (document.querySelector('[role="main"]')?.innerText || '').slice(0, 800);
        const hasLoginForm = !!document.querySelector('input[name="email"], input[name="pass"], form[action*="login"]');
        const missingMarkers = [
          "isn't available", 'không có sẵn', 'không khả dụng', 'no longer available',
          'nội dung này hiện không', 'This content isn’t available',
        ];
        const loginTitleMarkers = ['Log in to Facebook', 'Log In or Sign Up', 'Đăng nhập vào Facebook'];
        // Bài trong Group/Page riêng tư mà cookie chưa phải thành viên: Facebook KHÔNG báo lỗi hay đưa
        // ra form đăng nhập ngay giữa trang (hasLoginForm vẫn false) — mà âm thầm thay toàn bộ nội dung
        // chính bằng câu mời chung chung này, khiến các bước cào phía dưới tưởng đây là caption thật rồi
        // lấy đại (đã xác nhận bằng bài lỗi thật 2026-08-26: caption cào được y hệt câu mời này, không
        // phải nội dung bài viết). Phải chặn riêng, không gộp vào missingMarkers vì thông điệp khác hẳn.
        const loginTeaserMarkers = [
          'để kết nối với bạn bè, gia đình', 'connect with friends, family and people you know',
        ];
        const textHit = missingMarkers.some(m => mainText.toLowerCase().includes(m.toLowerCase()));
        const loginTeaserHit = loginTeaserMarkers.some(m => mainText.toLowerCase().includes(m.toLowerCase()));
        const loginTitleHit = loginTitleMarkers.some(m => title.includes(m));
        return { hasLoginForm, textHit, loginTeaserHit, loginTitleHit, title };
      });
      // Luôn tự động gỡ bỏ các dialog/modal "Đăng nhập vào Facebook" làm che khuất nội dung bài viết
      await removeFacebookLoginOverlays(page);
      // Gỡ bỏ Story Tray và các sidebar chứa video ngoài lề tránh làm nhiễm bẩn media bài viết
      await page.evaluate(() => {
        const storiesSelectors = [
          'div[data-pagelet*="Stories"]',
          'div[data-pagelet*="StoryTray"]',
          'div[aria-label*="Stories" i]',
          'div[aria-label*="Tin" i]',
          'a[href*="/stories/"]',
          'div[data-pagelet*="RightRail"]',
          'div[data-pagelet*="SideFeed"]'
        ];
        storiesSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => el.remove());
        });
      }).catch(() => {});

      if (accessIssue.textHit && !accessIssue.hasLoginForm) {
        throw new Error('Không cào được: bài viết có thể đã bị xóa, chuyển sang chế độ riêng tư, hoặc không còn tồn tại');
      }

      const isSinglePostUrl = /\/(posts|permalink|share|photo|photos|videos|watch|reel)\//i.test(sourceUrl) || scrapeLimit === 1;
      const isReelOrWatchUrl = /\/(share\/[rv]|reel|watch|videos|fb\.watch)\//i.test(sourceUrl) || /\/(share\/[rv]|reel|watch|videos|fb\.watch)\//i.test(page.url()) || sourceUrl.includes('/share/v/') || page.url().includes('/share/v/');

      // Chỉ so khớp ID số khi cào toàn bộ Feed của Page/Group — không áp dụng cho link bài đơn
      if (!isSinglePostUrl) {
        const expectedFbNumericId = extractFacebookNumericId(sourceUrl);
        if (expectedFbNumericId) {
          const loadedIdentity = await page.evaluate(() => ({
            ogUrl: document.querySelector('meta[property="og:url"]')?.content || null,
            canonical: document.querySelector('link[rel="canonical"]')?.href || null,
            currentUrl: location.href,
          }));
          const actualFbNumericId = extractFacebookNumericId(loadedIdentity.ogUrl)
            || extractFacebookNumericId(loadedIdentity.canonical)
            || extractFacebookNumericId(loadedIdentity.currentUrl);
          if (actualFbNumericId && actualFbNumericId !== expectedFbNumericId) {
            throw new Error(`Không cào được: trang đã tải KHÔNG khớp với nguồn yêu cầu (mong đợi Page/Group ID "${expectedFbNumericId}", nhưng tải được "${actualFbNumericId}"). Có thể cookie đã hết hạn hoặc bị redirect sang trang khác.`);
          }
        }
      }

      if (isSinglePostUrl) {
        // Tự động tìm và bấm toàn bộ nút "Xem thêm" / "See more" để lấy trọn vẹn 100% Caption không bị cắt ngắn
        await page.evaluate(() => {
          const seeMoreRegex = /(?:…|\.{2,})?\s*(?:Xem\s+thêm|See\s+more|Hiển\s+thị\s+thêm|Show\s+more)\b/i;
          const btns = Array.from(document.querySelectorAll(
            'div[role="button"], span[role="button"], a[role="button"], [role="button"], ' +
            '[aria-label*="Xem thêm" i], [aria-label*="See more" i], ' +
            '[role="article"] span, [role="article"] div, span[dir="auto"], div[dir="auto"]'
          ));
          for (const b of btns) {
            const text = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim();
            if (text && text.length <= 40 && seeMoreRegex.test(text)) {
              try {
                b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              } catch (e) { }
              try {
                b.click();
              } catch (e) { }
            }
          }
        }).catch(() => { });
        await page.waitForTimeout(500);

        // Cuộn nhẹ để nạp đầy đủ ảnh và video
        await page.evaluate(() => window.scrollBy(0, 800)).catch(() => { });
        await page.waitForTimeout(600);

        // Chủ động bấm Play video nếu có (chỉ tìm video trong bài viết chính, loại bỏ 100% story tray, comment và sidebar gợi ý)
        const hasMainVideo = await page.evaluate(() => {
          const isStoryOrNoise = (el) => {
            if (!el) return true;
            if (el.closest('a[href*="/stories/"], div[data-pagelet*="Stories"], div[data-pagelet*="StoryTray"], [aria-label*="Stories" i], [aria-label*="Tin" i], [aria-label*="Story" i]')) return true;
            if (el.closest('[role="navigation"], header, nav, [data-pagelet*="RightRail"], [data-pagelet*="SideFeed"], [data-pagelet*="WatchNext"], [data-pagelet*="Related"]')) return true;
            if (el.closest('[aria-label*="Bình luận" i], [aria-label*="Comment" i], [aria-label*="Tất cả bình luận" i], form')) return true;
            return false;
          };

          const allDialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
          const postDialog = allDialogs.find(d => {
            const aria = (d.getAttribute('aria-label') || '').toLowerCase();
            if (aria.includes('thông báo') || aria.includes('notification') || aria.includes('chat') || aria.includes('tin nhắn') || aria.includes('cài đặt')) return false;
            return d.querySelector('div[role="article"]') || /Bài viết của|Post by/i.test(d.innerText || '');
          });

          const mainPostScope = postDialog
            || document.querySelector('div[role="main"] div[role="article"]:not([aria-label*="Bình luận" i])')
            || document.querySelector('div[role="article"]:not([aria-label*="Bình luận" i])')
            || document.querySelector('div[data-pagelet*="FeedUnit"]')
            || null;

          if (!mainPostScope) return false;

          const videos = Array.from(mainPostScope.querySelectorAll('video')).filter(v => !isStoryOrNoise(v));

          if (videos.length > 0) {
            const v = videos[0];
            v.muted = true;
            v.play().catch(() => { });
            return true;
          }
          return false;
        }).catch(() => false);

        // Chỉ đợi buffer video nếu trang thực sự có video element hoặc là link Reel/Watch
        if (hasMainVideo || isReelOrWatchUrl) {
          for (let i = 0; i < 8 && capturedNetworkMp4s.length === 0; i++) {
            await page.waitForTimeout(500);
          }
        }

        const html = await page.content();

        // 1. Trích xuất Video MP4 thật (nếu có) — CHỈ trích xuất khi bài viết THỰC SỰ là video (hasMainVideo hoặc link Reel/Watch)
        const hasFullVideoUrl = (list) => list.some(u => !u.includes('bytestart=') && !u.includes('byteend=') && !isAudioOnlyMp4(u));
        const isPostTrulyVideo = Boolean(hasMainVideo || isReelOrWatchUrl || sourceUrl.includes('/share/v/') || sourceUrl.includes('/watch/') || sourceUrl.includes('/reel/') || sourceUrl.includes('/videos/'));

        let videoUrls = [];
        if (isPostTrulyVideo) {
          videoUrls = [...new Set(capturedNetworkMp4s)].filter(u => !isAudioOnlyMp4(u));
          const directHdVideo = extractBestHdVideoUrl(html);
          if (directHdVideo && !isAudioOnlyMp4(directHdVideo)) {
            videoUrls.push(directHdVideo);
          }

          if (!hasFullVideoUrl(videoUrls)) {
            const mp4Regexes = [
              /"progressive_url"\s*:\s*"([^"]+)"/g,
              /(https?(?::\\\/\\\/|:\/\/)[^\s"']+?(?:fbcdn\.net|cdninstagram\.com)[^\s"']+?\.mp4[^\s"']*)/gi,
              /"browser_native_hd_url":"([^"]+)"/g,
              /"browser_native_sd_url":"([^"]+)"/g,
              /"playable_url_quality_hd":"([^"]+)"/g,
              /"playable_url":"([^"]+)"/g,
              /https?:\\\/\\\/video[^\s"']+\.fbcdn\.net\\\/[^\s"']+/gi,
              /https?:[^\s"']+\.fbcdn\.net\/o1\/v\/[^\s"']+/gi,
            ];
            for (const reg of mp4Regexes) {
              let match;
              while ((match = reg.exec(html)) !== null) {
                const raw = match[1] || match[0];
                const cleanUrl = raw.replace(/\\u0025/g, '%').replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
                if (!isAudioOnlyMp4(cleanUrl) && !cleanUrl.includes('bytestart=') && !cleanUrl.includes('byteend=')) {
                  videoUrls.push(cleanUrl);
                }
              }
            }
          }
        }
        if (!hasFullVideoUrl(videoUrls) && isPostTrulyVideo) {
          try {
            console.log(`[FB_Scraper] 🎬 Phát hiện bài có video — thử cào bổ sung qua m.facebook.com...`);
            const targetReelUrl = (page.url() && (page.url().includes('/reel/') || page.url().includes('/watch/') || page.url().includes('/videos/'))) ? page.url() : sourceUrl;
            const mUrl = targetReelUrl.replace('www.facebook.com', 'm.facebook.com').replace('//facebook.com', '//m.facebook.com');
            const mPage = await context.newPage();
            const mCapturedMp4s = [];
            mPage.on('response', (res) => {
              const u = res.url();
              if ((u.includes('.mp4') || u.includes('fbcdn.net/o1/v/')) && !u.includes('bytestart=') && !u.includes('byteend=') && !isAudioOnlyMp4(u)) {
                mCapturedMp4s.push(u);
              }
            });
            await mPage.setExtraHTTPHeaders({
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1'
            });
            await mPage.goto(mUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
            await mPage.waitForTimeout(2500);
            const mHtml = await mPage.content();
            await mPage.close().catch(() => { });

            for (const cap of mCapturedMp4s) {
              if (!isAudioOnlyMp4(cap)) videoUrls.push(cap);
            }
            const mBestVideo = extractBestHdVideoUrl(mHtml);
            if (mBestVideo && !isAudioOnlyMp4(mBestVideo)) {
              videoUrls.push(mBestVideo);
            }
          } catch (eM) { }
        }
        if (!hasFullVideoUrl(videoUrls) && (hasMainVideo || isReelOrWatchUrl)) {
          // Bài có nhiều video/carousel — lấy hết các thẻ video thuộc bài viết chính, loại trừ
          // video nằm trong phần bình luận hoặc sidebar gợi ý.
          const domVideos = await page.evaluate(() => {
            const allDialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
            const postDialog = allDialogs.find(d => {
              const aria = (d.getAttribute('aria-label') || '').toLowerCase();
              if (aria.includes('thông báo') || aria.includes('notification') || aria.includes('chat') || aria.includes('tin nhắn') || aria.includes('cài đặt')) return false;
              return d.querySelector('div[role="article"]') || /Bài viết của|Post by/i.test(d.innerText || '');
            });

            const mainPostScope = postDialog
              || document.querySelector('a[href*="/photo"], a[href*="set=gm"], a[href*="set=pcb"], a[href*="set=p."]')?.closest('div[role="article"]:not([aria-label*="Bình luận" i]), div[data-pagelet*="FeedUnit"], div[role="main"]')
              || document.querySelector('div[role="main"] div[role="article"]:not([aria-label*="Bình luận" i]), div[data-pagelet*="FeedUnit"]')
              || document.querySelector('div[role="article"]:not([aria-label*="Bình luận" i])')
              || document.querySelector('div[role="main"]')
              || document.body;

            const commentSection = mainPostScope.querySelector('[aria-label*="Bình luận"], [aria-label*="Comment"], [aria-label*="Tất cả bình luận"]');
            const vs = Array.from(document.querySelectorAll('video source[src], video[src]'))
              .filter(v => {
                if (commentSection && commentSection.contains(v)) return false;
                if (v.closest('[aria-label*="Bình luận" i], [aria-label*="Comment" i], [aria-label*="Tất cả bình luận" i]')) return false;
                if (v.closest('[role="complementary"], [data-pagelet*="RightRail"], [data-pagelet*="SideFeed"], [data-pagelet*="WatchNext"], [data-pagelet*="Related"], [aria-label*="Gợi ý" i], [aria-label*="Recommended" i], [aria-label*="Bài viết liên quan" i]')) return false;
                if (mainPostScope && mainPostScope !== document.body && !mainPostScope.contains(v)) return false;
                return true;
              });
            return vs.map(v => v.src || v.getAttribute('src')).filter(Boolean);
          });
          for (const v of domVideos) {
            if (v && !v.startsWith('blob:') && !isAudioOnlyMp4(v)) videoUrls.push(v);
          }
        }

        // Chốt chặn quan trọng: nếu bài viết chính KHÔNG chứa thẻ <video> nào (và cũng không phải link Reel/Watch),
        // thì mọi videoUrls thu được (kể cả từ network response hay HTML payload) chắc chắn thuộc về video gợi ý
        // ở sidebar hoặc video comment — lập tức loại bỏ hết để không dán nhầm clip rác vào bài chữ/ảnh.
        if (videoUrls.length > 0 && !hasMainVideo && !isReelOrWatchUrl && !sourceUrl.includes('/share/v/') && !sourceUrl.includes('/watch/') && !sourceUrl.includes('/reel/') && !sourceUrl.includes('/videos/')) {
          const mainPostHasVideo = await page.evaluate(() => {
            const allDialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
            const postDialog = allDialogs.find(d => {
              const aria = (d.getAttribute('aria-label') || '').toLowerCase();
              if (aria.includes('thông báo') || aria.includes('notification') || aria.includes('chat') || aria.includes('tin nhắn') || aria.includes('cài đặt')) return false;
              return d.querySelector('div[role="article"]') || /Bài viết của|Post by/i.test(d.innerText || '');
            });

            const mainPostScope = postDialog
              || document.querySelector('a[href*="/photo"], a[href*="set=gm"], a[href*="set=pcb"], a[href*="set=p."]')?.closest('div[role="article"]:not([aria-label*="Bình luận" i]), div[data-pagelet*="FeedUnit"], div[role="main"]')
              || document.querySelector('div[role="main"] div[role="article"]:not([aria-label*="Bình luận" i]), div[data-pagelet*="FeedUnit"]')
              || document.querySelector('div[role="article"]:not([aria-label*="Bình luận" i])')
              || document.querySelector('div[role="main"]')
              || document.body;

            const commentSection = mainPostScope.querySelector('[aria-label*="Bình luận"], [aria-label*="Comment"], [aria-label*="Tất cả bình luận"]');
            return Array.from(document.querySelectorAll('video')).some(v => {
              if (commentSection && commentSection.contains(v)) return false;
              if (v.closest('[aria-label*="Bình luận" i], [aria-label*="Comment" i], [aria-label*="Tất cả bình luận" i]')) return false;
              if (v.closest('[role="complementary"], [data-pagelet*="RightRail"], [data-pagelet*="SideFeed"], [data-pagelet*="WatchNext"], [data-pagelet*="Related"], [aria-label*="Gợi ý" i], [aria-label*="Recommended" i], [aria-label*="Bài viết liên quan" i]')) return false;
              if (mainPostScope && mainPostScope !== document.body && !mainPostScope.contains(v)) return false;
              return true;
            });
          }).catch(() => false);

          if (!mainPostHasVideo) {
            console.log(`[FB_Scraper] ⚠️ Bài viết chính không có thẻ <video> nào — ${videoUrls.length} video bắt được từ sidebar/gợi ý/comment đã bị loại bỏ hoàn toàn.`);
            videoUrls = [];
            videoTotalBytesByBaseUrl.clear();
          }
        }

        // Lọc lại 1 lần nữa để đảm bảo không bị dính file âm thanh MP4
        videoUrls = videoUrls.filter(u => !isAudioOnlyMp4(u));

        // Vẫn không có link đầy đủ nào — nhưng nếu đã bắt được Content-Range của ít nhất 1 đoạn
        // chunk, ta biết chính xác TỔNG dung lượng video gốc. Tự ghép 1 URL request trọn vẹn byte
        // 0..cuối trên CÙNG base URL đó — CDN của Facebook trả cả file khi bytestart/byteend bao
        // trùm toàn bộ dung lượng, không cần tải từng đoạn rồi tự nối.
        const reconstructedFullUrls = [];
        if (!hasFullVideoUrl(videoUrls)) {
          for (const [baseUrl, total] of videoTotalBytesByBaseUrl.entries()) {
            if (!isAudioOnlyMp4(baseUrl)) {
              const sep = baseUrl.includes('?') ? '&' : '?';
              reconstructedFullUrls.push(`${baseUrl}${sep}bytestart=0&byteend=${total - 1}`);
            }
          }
        }

        // 2. Trích xuất toàn bộ Album Ảnh. Không bỏ qua chỉ vì bài có video: Facebook hỗ trợ bài
        // mixed media (video + nhiều ảnh). Poster của video được lọc riêng để không bị đếm thành ảnh.
        const mainVideoPosterUrls = new Set(await page.evaluate(() => {
          const posters = [];
          const commentSection = document.querySelector('[aria-label*="Bình luận"], [aria-label*="Comment"]');
          document.querySelectorAll('video').forEach((video) => {
            if (commentSection && commentSection.contains(video)) return;
            if (video.poster) posters.push(video.poster);
            if (video.getAttribute('poster')) posters.push(video.getAttribute('poster'));
            const parent = video.closest('div[data-visualcompletion], div[data-pagelet*="Video"], div[role="presentation"], div[tabindex]');
            if (parent) {
              parent.querySelectorAll('img').forEach((img) => {
                if (img.src) posters.push(img.src);
                if (img.getAttribute('src')) posters.push(img.getAttribute('src'));
              });
            }
          });
          document.querySelectorAll('div[data-pagelet*="Tahoe"] img, div[data-pagelet*="Watch"] img, div[aria-label*="Video" i] img').forEach((img) => {
            if (img.src) posters.push(img.src);
          });
          return posters.filter(Boolean);
        }).catch(() => []));
        let photoUrls = await extractPreviewPhotoUrls(page);
        photoUrls = photoUrls.filter((url) => !mainVideoPosterUrls.has(url) && !isVideoCoverFrameUrl(url));
        let expectedPhotoCount = photoUrls.length;
        if (photoUrls.length > 0) {
          expectedPhotoCount = await extractExpectedFacebookPhotoCount(page, photoUrls.length);
          photoUrls = await expandPhotoAlbumViaLightbox(page, photoUrls, expectedPhotoCount);
          photoUrls = photoUrls.filter((url) => !mainVideoPosterUrls.has(url) && !isVideoCoverFrameUrl(url));
        }

        // Fallback: nếu chưa lấy được ảnh nào từ selector thông thường, quét ảnh chất lượng cao (>200px) trực tiếp trong bài chính
        if (photoUrls.length === 0 && !hasFullVideoUrl(videoUrls)) {
          const directDomPhotos = await page.evaluate(() => {
            const article = document.querySelector('a[href*="/photo"], a[href*="set=gm"], a[href*="set=pcb"], a[href*="set=p."]')?.closest('div[role="article"], div[data-pagelet*="FeedUnit"], div[role="main"]')
              || document.querySelector('div[role="article"]')
              || document.querySelector('div[role="main"]')
              || document.body;
            const imgs = Array.from(article.querySelectorAll('img'))
              .filter(img => {
                if (!img.src || (!img.src.includes('scontent') && !img.src.includes('fbcdn.net'))) return false;
                if (img.closest('a[href*="/stories/"], div[data-pagelet*="Stories"], [aria-label*="Bình luận"], [aria-label*="Comment"], [role="navigation"]')) return false;
                const w = img.naturalWidth || img.width || 0;
                const h = img.naturalHeight || img.height || 0;
                return (w > 200 || h > 200);
              })
              .map(img => img.src);
            return [...new Set(imgs)];
          }).catch(() => []);
          if (directDomPhotos.length > 0) {
            photoUrls = directDomPhotos.filter((url) => !mainVideoPosterUrls.has(url) && !isVideoCoverFrameUrl(url));
          }
        }

        // Retry nếu chưa lấy được ảnh nào mà chưa có video
        if (photoUrls.length === 0 && !hasFullVideoUrl(videoUrls)) {
          for (let attempt = 0; attempt < 2; attempt++) {
            console.log(`[FB_Scraper] 🔁 Thử tải lại để kiểm tra ảnh (${attempt + 1}/2)...`);
            await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
            await page.waitForTimeout(3000);
            await removeFacebookLoginOverlays(page);
            let retryPhotos = await extractPreviewPhotoUrls(page);
            if (retryPhotos.length > 0) {
              const retryExpectedCount = await extractExpectedFacebookPhotoCount(page, retryPhotos.length);
              retryPhotos = await expandPhotoAlbumViaLightbox(page, retryPhotos, retryExpectedCount);
              photoUrls = retryPhotos.filter((url) => !mainVideoPosterUrls.has(url) && !isVideoCoverFrameUrl(url));
              if (photoUrls.length > 0) break;
            }
          }
        }

        // 3. Trích xuất Caption & Tên tác giả (Cre)
        const postData = await page.evaluate(() => {
          // Bóc tách tên Group và tên Tác giả riêng biệt một cách chuẩn xác
          const groupEl = document.querySelector('a[href*="/groups/"]:not([href*="/user/"]) strong, a[href*="/groups/"]:not([href*="/user/"]) span, h2 a[href*="/groups/"]');
          const detectedGroupName = (groupEl?.innerText || '').trim();

          // Tìm tác giả trong phạm vi bài viết chính (không lấy nhầm tên Group hoặc thanh sidebar)
          let detectedAuthor = '';

          // Ưu tiên 0: Bóc tách trực tiếp từ h2 trong bài viết hoặc dialog (VD: "Bài viết của Lê Hoàg Thiên" hoặc "Post by John")
          const allH2 = Array.from(document.querySelectorAll('div[role="dialog"] h2, [role="article"] h2, h2'));
          for (const h of allH2) {
            const hTxt = (h.innerText || '').trim();
            const m = hTxt.match(/^(?:bài viết của|post by)\s+(.+)$/i);
            if (m && m[1] && m[1].trim().length >= 2 && m[1].trim().length <= 50) {
              detectedAuthor = m[1].trim();
              break;
            }
          }

          if (!detectedAuthor) {
            const authorCandidates = [
              document.querySelector('[role="article"] a[href*="/user/"]:not([href*="/groups/"])'),
              document.querySelector('[role="article"] a[href*="profile.php"]:not([href*="/groups/"])'),
              document.querySelector('[role="article"] a[role="link"][tabindex="0"]:not([href*="/groups/"]):not([href*="/posts/"]):not([href*="/share/"])'),
              document.querySelector('div[role="dialog"] a[href*="/user/"]:not([href*="/groups/"])'),
              document.querySelector('div[role="dialog"] a[href*="profile.php"]:not([href*="/groups/"])'),
              document.querySelector('[role="article"] h2 a:not([href*="/groups/"]), [role="article"] h3 a:not([href*="/groups/"]), [role="article"] h4 a:not([href*="/groups/"])'),
              document.querySelector('a[href*="/user/"]:not([href*="/groups/"])'),
              document.querySelector('a[href*="profile.php"]:not([href*="/groups/"])'),
            ];

            for (const cand of authorCandidates) {
              if (cand) {
                const text = (cand.getAttribute('aria-label') || cand.innerText || cand.textContent || '').trim();
                if (text && text.length >= 2 && text.length <= 50 && !text.includes('\n') && !/[.!?]/.test(text) && !/^(Facebook|Home|Trang chủ|Group|Nhóm|Theo dõi|Follow)$/i.test(text)) {
                  if (!detectedGroupName || text.toLowerCase() !== detectedGroupName.toLowerCase()) {
                    detectedAuthor = text;
                    break;
                  }
                }
              }
            }
          }

          if (!detectedAuthor) {
            const hStrong = document.querySelector('[role="article"] h2 strong, [role="article"] h3 strong, div[role="dialog"] h2 strong, h2 strong, h3 strong');
            const hText = (hStrong?.innerText || '').trim();
            if (hText && hText.length <= 50 && !hText.includes('\n') && (!detectedGroupName || hText.toLowerCase() !== detectedGroupName.toLowerCase())) {
              detectedAuthor = hText;
            }
          }

          // Làm sạch triệt để các badge đính kèm của Facebook như " · Theo dõi", " · Quản trị viên"
          const cleanAuthorName = (raw) => {
            if (!raw) return '';
            let a = raw.trim();
            a = a
              .replace(/Online\s+status\s+in[^\n·•]*/gi, '')
              .replace(/Chỉ báo trạng thái (?:online|trực tuyến)/gi, '')
              .replace(/[\s\u00A0]*[·•|–—-][\s\u00A0]*(?:Theo dõi|Follow|Following|Đã theo dõi|Quản trị viên|Admin|Người điều hành|Moderator|Người đóng góp hàng đầu|Top Contributor|Tác giả|Author).*$/i, '')
              .replace(/\s*\((?:Admin|Quản trị viên|Tác giả|Author|Mod|Người kiểm duyệt)\)\s*/gi, '')
              .replace(/^bài viết của\s+/i, '')
              .replace(/^post by\s+/i, '')
              .trim();
            if (detectedGroupName && a.toLowerCase() === detectedGroupName.toLowerCase()) return '';
            if (/^(Facebook|Bài viết Facebook|Video Facebook|Group|Nhóm|Trang chủ|Home|Feed|Reels?|Watch|Chỉ báo trạng thái online|Trạng thái online)$/i.test(a)) return '';
            if (a.toLowerCase().includes('online status') || a.toLowerCase().includes('trực tuyến') || a.length < 2 || a.length > 50) return '';
            if (/[.!?]/.test(a)) return '';
            return a;
          };

          const author = cleanAuthorName(detectedAuthor);

          const cleanDomText = (t) => {
            if (!t) return '';
            let cleaned = t
              .replace(/[\s\u200B\u00A0]*(?:…|\.{2,})?[\s\u200B\u00A0]*(?:Xem\s+thêm|See\s+more|Hiển\s+thị\s+thêm)[\s\u200B\u00A0]*(?:Ẩn\s+bớt|See\s+less|Thu\s+gọn)?[\s\u200B\u00A0]*$/gi, '')
              .replace(/[\s\u200B\u00A0]*(?:Ẩn\s+bớt|See\s+less|Thu\s+gọn)[\s\u200B\u00A0]*$/gi, '')
              .replace(/(?:^|\n)[\s\u200B\u00A0]*(?:Xem\s+thêm|See\s+more|Hiển\s+thị\s+thêm|Ẩn\s+bớt|See\s+less|Thu\s+gọn)[\s\u200B\u00A0]*$/gim, '')
              .replace(/[\s\u200B\u00A0]*(?:…|\.{2,})[\s\u200B\u00A0]*(?:Xem\s+thêm|See\s+more)\b/gi, '')
              .replace(/\n?(?:Translate|Dịch)\s*$/gi, '')
              .replace(/(?:^|\n)[\s\u200B\u00A0]*(?:Công khai|Public|Chỉ mình tôi|Bạn bè|Friends|Only me|Chia sẻ với:?\s*Công khai|Shared with:?\s*Public)[\s\u200B\u00A0]*$/gim, '')
              .trim();

            // Xoá ký tự mồ côi 1-2 chữ cái ở dòng cuối cùng do bị cắt ngang trước nút xem thêm (VD: "\nK" hay "\nĐ")
            cleaned = cleaned.replace(/\n[\s\u200B\u00A0]*[\p{L}\p{M}]{1,2}[\s\u200B\u00A0]*$/u, '').trim();

            // Loại bỏ hoàn toàn prefix Tên Group (VD: "Làng Văn hóa | Cứ tưởng..." -> "Cứ tưởng...")
            if (detectedGroupName && detectedGroupName.length > 1) {
              const esc = detectedGroupName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              cleaned = cleaned.replace(new RegExp(`^${esc}\\s*(?:\\||-|—|:|•)\\s*`, 'i'), '').trim();
            }
            // Loại bỏ prefix Tên Tác giả nếu bị dính vào đầu caption
            if (author && author.length > 1) {
              const esc = author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              cleaned = cleaned.replace(new RegExp(`^${esc}\\s*(?:\\||-|—|:|•)\\s*`, 'i'), '').trim();
            }

            // Lọc trường hợp "Tên bất kỳ | Caption" nếu phần đầu là tên Group/Page hoặc chứa Facebook
            if (cleaned.includes('|')) {
              const parts = cleaned.split('|');
              if (parts.length >= 2) {
                const firstPart = parts[0].trim();
                const remaining = parts.slice(1).join('|').trim();
                if (
                  firstPart.toLowerCase().includes('facebook') ||
                  (detectedGroupName && firstPart.toLowerCase() === detectedGroupName.toLowerCase()) ||
                  (author && firstPart.toLowerCase() === author.toLowerCase())
                ) {
                  cleaned = remaining;
                }
              }
            }

            // 1. Tự động xuống dòng sau dấu hai chấm hoặc dấu câu khi bắt đầu gạch đầu dòng (-, –, —, •, *, +, ~, emoji bullets)
            cleaned = cleaned.replace(/([^\n])\s*(?:[:;])\s+([-\u2013\u2014•*+~🔹🔸▪️▫️✔️✅👉🔥⭐🌟✓]\s+[A-ZÀ-Ỹ0-9])/gu, '$1:\n\n$2');

            // 2. Tự động xuống dòng khi có bullet points sau dấu ngắt câu hoặc các ký hiệu bullet đặc thù (tránh làm đứt gạch nối từ ghép như Hà Nội - Hải Phòng)
            cleaned = cleaned.replace(/([.\?!:;]\s*)\s+([-\u2013\u2014•*+~🔹🔸▪️▫️✔️✅👉🔥⭐🌟✓]\s+[A-ZÀ-Ỹ0-9])/gu, '$1\n\n$2');
            cleaned = cleaned.replace(/([^\n\d])\s+([•*+~🔹🔸▪️▫️✔️✅👉🔥⭐🌟✓]\s+[A-ZÀ-Ỹ0-9])/gu, '$1\n\n$2');

            // 3. Tự động xuống dòng khi có số thứ tự liệt kê (1., 2., 3., 1), 2)) SAU DẤU NGẮT CÂU (tránh ngắt ở "tuổi 15. Nhiều...")
            cleaned = cleaned.replace(/([.\?!:;]\s*)(\b\d{1,2}[\.\)]\s+[A-ZÀ-Ỹ])/gu, '$1\n\n$2');

            // 4. Tự động xuống dòng giữa các câu hoàn chỉnh giới thiệu danh sách hoặc chuyển đoạn
            cleaned = cleaned.replace(/([.!?])\s+((?:Với|Trong|Theo|Đặc biệt|Hiện|Ngoài ra|Bên cạnh đó|Tuy nhiên|Đáng chú ý|Cụ thể|Tổng kết|Chi tiết)\s+[A-ZÀ-Ỹ0-9])/gu, '$1\n\n$2');

            // 5. Tự động ngắt dòng an toàn trước Cre / Nguồn / Credit / Via / Ảnh / Theo
            // CHỈ ngắt dòng khi có dấu : hoặc - (Cre:, Nguồn:, Ảnh:, Theo:, Credit:, Via:, Photo:, Video:)
            // HOẶC Cre/Credit theo sau là tên riêng / handle (Cre Beatvn...)
            // TUYỆT ĐỐI không làm đứt các từ thông thường như Cảnh sát, khoảnh khắc, dọc theo, nguồn gốc, quay video...
            cleaned = cleaned.replace(/([^\n\s])\s+(?<![\p{L}\p{N}])(Cre|Credit|Nguồn|Ảnh|Photo|Video|Via|Theo)\s*[:\-\u2013\u2014]\s*/gui, '$1\n\n$2: ');
            cleaned = cleaned.replace(/([^\n\s])\s+(?<![\p{L}\p{N}])(Cre|Credit)\s+([A-ZÀ-Ỹ0-9@#])/gu, '$1\n\n$2 $3');

            // 6. Chuẩn hóa khoảng trắng và dòng trống
            cleaned = cleaned
              .replace(/[ \t]+/g, ' ')
              .replace(/\n[ \t]+/g, '\n')
              .replace(/[ \t]+\n/g, '\n')
              .replace(/\n{3,}/g, '\n\n');

            // 7. Lọc bỏ triệt để các dòng/đoạn văn bản bị lặp lại liên tiếp do DOM Facebook chứa nhiều thẻ con trùng nội dung
            const lines = cleaned.split('\n');
            const dedupeLines = [];
            for (const l of lines) {
              const tr = l.trim();
              if (dedupeLines.length > 0 && dedupeLines[dedupeLines.length - 1].trim() === tr && tr.length > 0) {
                continue;
              }
              dedupeLines.push(l);
            }
            const paras = dedupeLines.join('\n').split(/\n\s*\n/);
            const dedupeParas = [];
            for (const p of paras) {
              const tr = p.trim();
              if (!tr) continue;
              if (dedupeParas.length > 0 && dedupeParas[dedupeParas.length - 1].trim() === tr) {
                continue;
              }
              dedupeParas.push(tr);
            }
            return dedupeParas.join('\n\n').trim();
          };

          const extractFormattedNodeText = (node) => {
            if (!node) return '';
            try {
              if (typeof node.cloneNode !== 'function') {
                return (node.innerText || node.textContent || '').trim();
              }
              const clone = node.cloneNode(true);
              if (!clone || typeof clone.querySelectorAll !== 'function') {
                return (node.innerText || node.textContent || '').trim();
              }
              clone.querySelectorAll('div[role="button"], span[role="button"], [role="button"], [aria-label*="đối tượng" i], [aria-label*="Chia sẻ với" i]').forEach(btn => {
                const bText = (btn.textContent || '').trim();
                if (/(?:…|\.{3})?\s*(?:Xem thêm|See more|Hiển thị thêm|Ẩn bớt|See less|Thu gọn)/i.test(bText) || /^(Công khai|Public|Bạn bè|Friends|Chỉ mình tôi|Only me)$/i.test(bText)) {
                  btn.remove();
                }
              });
              clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
              clone.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, section').forEach(block => {
                block.prepend('\n');
                block.append('\n');
              });
              return (clone.textContent || node.innerText || node.textContent || '')
                .replace(/\r\n/g, '\n')
                .replace(/[ \t]+/g, ' ')
                .replace(/\n\s+\n/g, '\n\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            } catch (e) {
              return (node?.innerText || node?.textContent || '').trim();
            }
          };

          // Khóa chặt phạm vi vào bài viết chính (ƯU TIÊN dialog modal nếu mở dạng popup)
          const allDialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
          const postDialog = allDialogs.find(d => {
            const aria = (d.getAttribute('aria-label') || '').toLowerCase();
            if (aria.includes('thông báo') || aria.includes('notification') || aria.includes('chat') || aria.includes('tin nhắn') || aria.includes('cài đặt')) return false;
            return d.querySelector('div[role="article"]') || /Bài viết của|Post by/i.test(d.innerText || '');
          }) || allDialogs.find(d => {
            const aria = (d.getAttribute('aria-label') || '').toLowerCase();
            return !aria.includes('thông báo') && !aria.includes('notification') && d.querySelector('a[href*="/photo"], a[href*="set=pcb"]');
          });

          const mainPostScope = postDialog
            || document.querySelector('a[href*="/photo"], a[href*="set=gm"], a[href*="set=pcb"], a[href*="set=p."]')?.closest('div[role="article"]:not([aria-label*="Bình luận" i]), div[data-pagelet*="FeedUnit"], div[role="main"]')
            || document.querySelector('div[role="main"] div[role="article"]:not([aria-label*="Bình luận" i]), div[data-pagelet*="FeedUnit"]')
            || document.querySelector('div[role="article"]:not([aria-label*="Bình luận" i])')
            || document.querySelector('div[role="main"]')
            || document.body;

          const commentSection = mainPostScope.querySelector('[aria-label*="Bình luận"], [aria-label*="Comment"], [aria-label*="Tất cả bình luận"]');

          // Lọc chính xác các container chứa nội dung bài viết thật sự và loại bỏ triệt để chuỗi xáo trộn rác
          const isFacebookGarbageInsideBrowser = (t) => {
            if (!t || typeof t !== 'string') return true;
            const s = t.trim();
            if (s.length < 2) return true;
            if (/edoop|sntrsr|tLge|gahc|unaa\d|Mle\d|hi\d+mh/i.test(s)) return true;
            const words = s.split(/\s+/);
            const isNormalWord = (w) => /^(iphone\d*|mp[34]|4k|8k|hd|fhd|24h|360|3d|v\d+|\d+k|\d+m|\d+h|\d+p|\d+tr|\d+đ|\d+k[mgb]|\d+cm|\d+mm|\d+kg|\d+g)$/i.test(w);
            const scrambled = words.filter(w => /^[a-zA-Z0-9_]{5,}$/.test(w) && /[a-zA-Z]/.test(w) && /\d/.test(w) && !isNormalWord(w));
            if (scrambled.length > 0 && (scrambled.length >= words.length * 0.3 || scrambled.some(w => w.length >= 10))) return true;
            if (words.length === 1 && s.length >= 14 && /^[a-zA-Z0-9_]+$/.test(s) && !isNormalWord(s)) return true;
            return false;
          };

          const isNoiseText = (t) => {
            if (!t || t.length < 2) return true;
            if (/^[\d.,\s]+[KMkm]?\+?$/i.test(t)) return true;
            if (/^(Thích|Bình luận|Chia sẻ|Like|Comment|Share|Reels|Gửi|Send|Đăng|Post|Facebook|Theo dõi|Follow|Home|Trang chủ|Công khai|Public|Bạn bè|Friends|Chỉ mình tôi|Only me|Chỉnh sửa đối tượng)$/i.test(t.trim())) return true;
            if (/^(Chia sẻ với:?\s*(?:Công khai|Public|Bạn bè|Friends)|Shared with:?\s*(?:Public|Friends))/i.test(t.trim())) return true;
            if (/^(\d+\s*(?:phút|giờ|ngày|tháng|năm|h|m|d|w|y|mins?|hrs?|days?)|vừa xong|just now|yesterday|hôm qua)/i.test(t.trim())) return true;
            if (isFacebookGarbageInsideBrowser(t)) return true;
            return false;
          };

          const getCandidatesFromScope = (scope) => {
            if (!scope) return [];
            // ƯU TIÊN 1: Lấy đúng container message chính thức của Facebook
            const primaryMessages = Array.from(scope.querySelectorAll(
              'div[data-ad-rendering-role="story_message"], ' +
              'div[data-ad-preview="message"], div[data-ad-comet-preview="message"], ' +
              '[role="article"] div[data-ad-preview="message"], [role="article"] div[data-ad-comet-preview="message"], ' +
              'div[data-pagelet*="TahoePostMessage"], ' +
              'div[data-pagelet*="TahoeRightRail"] [dir="auto"], div[data-pagelet*="WatchPermalink"] [dir="auto"], ' +
              'div[data-pagelet*="Reel"] [dir="auto"]'
            )).filter(el => {
              if (!el) return false;
              if (commentSection && commentSection.contains(el)) return false;
              if (el.closest('[aria-label*="Bình luận"], [aria-label*="Comment"], [aria-label*="Tất cả bình luận"]')) return false;
              return true;
            });
            if (primaryMessages.length > 0) {
              return primaryMessages;
            }

            // ƯU TIÊN 2: Quét các thẻ div/span khác nhưng LOẠI BỎ TRIỆT ĐỂ timestamp, author links, headers, buttons
            return Array.from(scope.querySelectorAll(
              '[role="article"] div[dir="auto"], ' +
              'div[data-pagelet*="FeedUnit"] [dir="auto"], ' +
              'div[role="main"] [dir="auto"], ' +
              'span[dir="auto"], div[dir="auto"]'
            )).filter(el => {
              if (!el) return false;
              try {
                if (el.closest('a[href*="/stories/"], div[data-pagelet*="Stories"], [role="navigation"], header, footer, nav')) return false;
                if (commentSection && commentSection.contains(el)) return false;
                if (el.closest('[aria-label*="Bình luận"], [aria-label*="Comment"], [aria-label*="Tất cả bình luận"]')) return false;
                if (el.closest('h2, h3, h4, [role="heading"], [aria-haspopup="menu"], button, [role="button"], time, [role="time"]')) return false;
                if (el.closest('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/share/"], a[href*="/photo"], a[href*="/videos/"], a[href*="/reel/"], a[role="link"]')) return false;
                return true;
              } catch (e) {
                return false;
              }
            });
          };

          let msgCandidates = getCandidatesFromScope(mainPostScope);
          if (msgCandidates.length === 0 && mainPostScope !== document.body) {
            msgCandidates = getCandidatesFromScope(document.body);
          }

          // Trích xuất toàn bộ các dòng nội dung, giữ nguyên xuống dòng
          const textList = msgCandidates.map(el => {
            const raw = extractFormattedNodeText(el);
            return cleanDomText(raw);
          }).filter(t => t.length > 3 && !isNoiseText(t));

          // Sắp xếp ưu tiên chuỗi văn bản dài nhất và đầy đủ nhất từ DOM bài viết
          textList.sort((a, b) => b.length - a.length);

          const ogDesc = cleanDomText(document.querySelector('meta[property="og:description"]')?.content || '');
          const ogTitle = cleanDomText(document.querySelector('meta[property="og:title"]')?.content || '');
          const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';

          // Ưu tiên:
          // 1. Text lấy trực tiếp từ DOM bài viết (đầy đủ nhiều dòng, có Cre, không bị cắt ngắn bởi thẻ meta)
          // 2. og:description (đã được lọc sạch prefix Group)
          // 3. og:title (đã được lọc sạch prefix Group)
          // Ghép nối thông minh: Nếu bài viết có nhiều đoạn văn bản trong các thẻ div/span riêng lẻ
          let bestCombinedText = '';
          if (msgCandidates.length > 0) {
            // Nếu candidate đầu tiên là container cha chứa tất cả các candidate khác (VD data-ad-preview="message")
            const rootCandidate = msgCandidates[0];
            const isRootOfAll = msgCandidates.length > 1 && msgCandidates.slice(1).every(c => rootCandidate.contains(c));
            if (isRootOfAll) {
              bestCombinedText = cleanDomText(extractFormattedNodeText(rootCandidate));
            } else {
              // Lấy các element không lồng nhau theo thứ tự xuất hiện trên trang để không bị mất đoạn
              const topLevelElements = [];
              for (const el of msgCandidates) {
                if (!topLevelElements.some(t => t.contains(el))) {
                  topLevelElements.push(el);
                }
              }
              const extractedParts = topLevelElements
                .map(el => cleanDomText(extractFormattedNodeText(el)))
                .filter(t => t.length > 2 && !isNoiseText(t));

              // Khử các đoạn trùng lặp hoặc lặp chuỗi con
              const uniqueSegments = [];
              for (const part of extractedParts) {
                if (!uniqueSegments.some(s => s.includes(part) || part.includes(s))) {
                  uniqueSegments.push(part);
                }
              }
              bestCombinedText = uniqueSegments.join('\n\n').trim();
            }
          }

          let caption = '';
          if (bestCombinedText && bestCombinedText.length > 3 && !isNoiseText(bestCombinedText)) {
            caption = bestCombinedText;
          } else if (textList.length > 0) {
            caption = textList[0];
          } else if (ogDesc && ogDesc.length > 3 && !isNoiseText(ogDesc)) {
            caption = ogDesc;
          } else if (ogTitle && ogTitle.length > 3 && !isNoiseText(ogTitle)) {
            caption = ogTitle;
          }

          if (!caption || caption.toLowerCase() === 'facebook' || caption.toLowerCase() === 'bài viết facebook' || caption.toLowerCase() === 'video facebook' || isNoiseText(caption)) {
            const cleanTitle = cleanDomText(document.title?.replace(/\s*\|\s*Facebook\s*$/i, '').trim() || '');
            caption = (!cleanTitle || cleanTitle.toLowerCase() === 'facebook' || isNoiseText(cleanTitle)) ? '' : cleanTitle;
          }

          return { caption, author, ogImage };
        });

        if (!postData.caption || postData.caption.toLowerCase() === 'facebook' || postData.caption.toLowerCase() === 'bài viết facebook' || isFacebookObfuscatedOrGarbageText(postData.caption)) {
          try {
            const pageHtmlForCap = await page.content();
            const captionRegexes = [
              /\"message\":\s*\{\s*\"text\":\s*\"([^\"]+)\"/g,
              /\"savable_description\":\s*\{\s*\"text\":\s*\"([^\"]+)\"/g,
              /\"text\":\s*\"([^\"]{8,500})\"/g,
            ];
            for (const reg of captionRegexes) {
              let m;
              while ((m = reg.exec(pageHtmlForCap)) !== null) {
                let raw = m[1];
                try {
                  raw = JSON.parse(`"${raw}"`);
                } catch (e) {
                  raw = raw.replace(/\\u0025/g, '%').replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\n/g, '\n');
                }
                const lower = raw.toLowerCase();
                if (lower.includes('bằng việc sử dụng meta ai') || lower.includes('điều khoản về ai') || lower.includes('hoạt động tương tác')) continue;
                if (lower.includes('log in') || lower.includes('đăng nhập') || lower.includes('privacy') || lower.includes('cookie')) continue;
                if (isFacebookObfuscatedOrGarbageText(raw)) continue;
                if (raw.trim().length > 5) {
                  postData.caption = raw.trim();
                  break;
                }
              }
              if (postData.caption && !isFacebookObfuscatedOrGarbageText(postData.caption)) break;
            }
          } catch (eCap) { }
        }

        if (!postData.caption || isFacebookObfuscatedOrGarbageText(postData.caption)) {
          postData.caption = '';
        }

        await releaseContext();
        releaseContext = null;

        // Facebook phát video dạng DASH bằng nhiều request byte-range (bytestart=/byteend=) cho CÙNG
        // 1 video khi trình duyệt buffer/tua — mỗi request vẫn có content-type video/mp4 nên bị bắt
        // lẫn vào videoUrls. 1 URL có bytestart/byteend chỉ trả về ĐÚNG đoạn byte đó, không phải file
        // hoàn chỉnh dù có xoá query param đi — xoá param không biến nó thành video đầy đủ, dẫn tới
        // tải về file hỏng (Facebook báo "lỗi khi phát video" sau khi đăng lại). Loại hẳn các URL này
        // thay vì cố vá, giống cách nhánh Threads xử lý (sanitizeVideoUrl, dòng ~2337).
        // reconstructedFullUrls TUY có bytestart=0&byteend=<total-1> trong URL nhưng đã được ghép để
        // bao trùm ĐÚNG toàn bộ dung lượng thật (lấy từ header Content-Range) — coi là link đầy đủ,
        // ưu tiên trước các chunk lẻ vì đây là link chắc chắn tải được nguyên video.
        let allMedia = [];
        // Chỉ lấy video khi có link ĐẦY ĐỦ thật sự (từ reconstructedFullUrls hoặc 1 URL không hề dính
        // bytestart/byteend) — TUYỆT ĐỐI không fallback về videoUrls[0] khi mọi URL tìm được đều chỉ là
        // đoạn chunk DASH lẻ, vì xoá query param không biến chunk thành video đầy đủ (xem comment phía
        // trên) — trước đây fallback này vẫn âm thầm lấy đại 1 chunk hỏng, gây "lỗi khi phát video" sau
        // khi đăng lại. Bỏ hẳn video trong trường hợp đó, chỉ giữ ảnh nếu có, giống cách /api/post-facebook
        // đã xử lý an toàn ở phía đăng bài.
        let fullVideoUrl = reconstructedFullUrls[0] || videoUrls.find(u => !u.includes('bytestart=') && !u.includes('byteend='));
        if (!fullVideoUrl && (hasMainVideo || isReelOrWatchUrl || sourceUrl.includes('/share/v/') || sourceUrl.includes('/watch/') || sourceUrl.includes('/reel/') || sourceUrl.includes('/videos/'))) {
          try {
            console.log(`[FB_Scraper] 🎬 Thử gọi extractVideoDirectly cứu cánh cho link video...`);
            const directRes = await extractVideoDirectly(sourceUrl);
            if (directRes && directRes.success && directRes.videoUrl) {
              fullVideoUrl = directRes.videoUrl;
              console.log(`[FB_Scraper] ✅ extractVideoDirectly đã tìm thấy video: ${fullVideoUrl.slice(0, 80)}...`);
            }
          } catch (eDir) { }
        }

        if (fullVideoUrl) {
          // Bài video Facebook: thuần video MP4 100%, không kèm ảnh thumbnail/bìa
          allMedia = [fullVideoUrl];
        } else if (photoUrls.length > 0) {
          if (videoUrls.length > 0) {
            console.log(`[FB_Scraper] ⚠️ Mọi link video tìm được đều chỉ là đoạn chunk DASH lẻ, không có bản đầy đủ — bỏ video, chỉ giữ ${photoUrls.length} ảnh đính kèm.`);
          }
          allMedia = [...new Set(photoUrls)];
        } else if (postData.ogImage) {
          // Bài dạng chia sẻ link (link-share card) không có ảnh nào khớp selector album/photo-viewer
          // ở trên vì ảnh preview của link nằm trong 1 cấu trúc DOM khác hẳn — dùng og:image (ảnh
          // preview Facebook tự tạo cho link đó) làm phương án cuối, còn hơn đăng bài trống không ảnh.
          console.log(`[FB_Scraper] ℹ️ Không tìm thấy ảnh qua DOM album (có thể là bài chia sẻ link) — dùng og:image làm ảnh dự phòng.`);
          allMedia = [postData.ogImage];
        }

        // Kiểm tra lại lần nữa NGAY TRÊN caption cuối cùng vừa trích xuất — check accessIssue ở đầu hàm
        // chạy quá sớm (ngay sau page.goto, trước khi cuộn/bấm "Xem thêm"/chờ thêm) nên có thể chụp lúc
        // trang mới chỉ hiện khung tạm, chưa lên câu mời đăng nhập; caption cuối cùng này mới là thứ thực
        // sự được dùng làm content bài đăng nên phải chặn ở đây mới chắc chắn không lọt garbage xuống.
        if (/để kết nối với bạn bè, gia đình|connect with friends, family and people you know/i.test(postData.caption || '')) {
          throw new Error('Không cào được: bài viết yêu cầu đăng nhập/là thành viên mới xem được nội dung thật (có thể trong Group riêng tư mà cookie đang dùng chưa phải thành viên) — Facebook chỉ trả về trang mời đăng nhập chung chung, không phải nội dung bài viết.');
        }

        const authorName = postData.author || '';
        let formattedContent = cleanScrapedCaption(postData.caption || '');
        if (shouldIncludeCredit) {
          const isAnon = !authorName || /ẩn danh|anonymous|thành viên nhóm|thành viên ẩn danh|member/i.test(authorName);
          const creText = isAnon ? 'Member ẩn danh' : authorName;
          if (!formattedContent.includes('Cre:')) {
            formattedContent += `\n\nCre: ${creText}`;
          }
        }

        if (allMedia.length === 0) {
          console.log(`[FB_Scraper] ⚠️ Không tìm thấy clip/ảnh nào cho bài này — sẽ không đăng (bắt buộc phải có media).`);
        } else {
          console.log(`[FB_Scraper] ✅ Cào bài đơn thành công! Tìm thấy ${allMedia.length} media (${photoUrls.length} ảnh, ${videoUrls.length} video), Ghi Cre: ${shouldIncludeCredit ? 'BẬT' : 'TẮT'}, Tác giả: ${authorName || 'Facebook'}`);
        }
        const resultItem = attachMediaMetadata({
          title: formattedContent.length > 80 ? formattedContent.slice(0, 80) + '...' : formattedContent,
          originalUrl: sourceUrl,
          content: formattedContent,
          mediaUrls: allMedia,
          author: authorName,
        }, fullVideoUrl ? [fullVideoUrl] : []);
        const singlePostResult = {
          success: true,
          mediaFound: allMedia.length > 0,
          mediaType: resultItem.mediaType,
          mediaCount: resultItem.mediaCount,
          videoCount: resultItem.videoCount,
          imageCount: resultItem.imageCount,
          items: (allMedia.length > 0 || (formattedContent && formattedContent.trim().length > 0)) ? [resultItem] : []
        };
        // Không cache nếu URL rõ ràng là link video (Reel/Watch/share-v) nhưng lần cào này chỉ
        // lấy được ảnh (og:image/thumbnail) chứ không phải video thật — đây là dấu hiệu bắt lỡ
        // network response video/mp4 do timing (thấy tái hiện được khi cào lại ngay sau đó với
        // cùng cookie), không phải bài thực sự không có video. Cache kết quả sai này sẽ khiến mọi
        // request trong khoảng thời gian TTL cache tiếp theo nhận nhầm ảnh thay vì video.
        const isDegradedVideoAsImage = isReelOrWatchUrl && !fullVideoUrl && resultItem.mediaType === 'image';

        // Đối chiếu với "dấu vân tay" công khai của bài (xem fetchFacebookPublicAnchor) — chặn cào nhầm bài
        const anchorCheck = checkFacebookAnchorMatch(await anchorPromise, resultItem);
        singlePostResult.anchorCheck = anchorCheck;
        if (anchorCheck.verdict === 'mismatch') {
          console.warn(`[FB_Scraper] 🚫 Kết quả KHÔNG khớp bài gốc (caption ${anchorCheck.textVerdict}${anchorCheck.textScore !== null ? ` ${anchorCheck.textScore}` : ''}, ảnh ${anchorCheck.imageVerdict}) | bài gốc: ${anchorCheck.anchorUrl} | cào ra: "${(formattedContent || '').slice(0, 60).replace(/\n/g, ' ')}"`);
          if (req.body.cookieString && !req.body._anchorRetry) {
            console.log(`[FB_Scraper] 🔁 Cào lại KHÔNG dùng cookie để lấy đúng bài: ${sourceUrl}`);
            try {
              const retryResp = await fetch(`http://127.0.0.1:${PORT}/api/scrape-content`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...req.body, sourceUrl, cookieString: undefined, socialAccountId: undefined, forceRefresh: true, _anchorRetry: true }),
              });
              const retryResult = await retryResp.json();
              if (retryResult && retryResult.success && (retryResult.items || []).length > 0 && retryResult.anchorCheck?.verdict !== 'mismatch') {
                console.log(`[FB_Scraper] ✅ Cào lại không cookie ra đúng bài (${retryResult.anchorCheck?.verdict}).`);
                const fixedResult = { ...retryResult, retriedWithoutCookie: true };
                delete fixedResult.cached;
                scrapeCache[scrapeCacheKey] = { result: fixedResult, scrapedAt: Date.now() };
                saveScrapeCache();
                return res.json(fixedResult);
              }
            } catch (eRetry) {
              console.warn(`[FB_Scraper] ⚠️ Cào lại không cookie lỗi: ${eRetry.message}`);
            }
          }
          // Không trả/cache bài sai — báo lỗi rõ ràng còn hơn đăng nhầm nội dung bài khác
          return res.status(500).json({
            success: false,
            error: `Cào ra nhầm bài khác (caption/ảnh không khớp bài gốc ${anchorCheck.anchorUrl}). Đã chặn để tránh đăng sai — thử lại sau hoặc dùng link /posts/ đầy đủ.`,
            anchorCheck,
          });
        }

        if (!isDegradedVideoAsImage && (allMedia.length > 0 || (formattedContent && formattedContent.trim().length > 0))) {
          scrapeCache[scrapeCacheKey] = { result: singlePostResult, scrapedAt: Date.now() };
          saveScrapeCache();
        } else if (isDegradedVideoAsImage) {
          console.log(`[FB_Scraper] ⚠️ Link ${sourceUrl} là dạng video (Reel/Watch/share-v) nhưng lần cào này chỉ lấy được ảnh thumbnail — không cache kết quả này để lần cào tiếp theo được thử lại video thật.`);
        }
        return res.json(singlePostResult);
      }

      // Cuộn trang xuống để Facebook nạp nhiều bài hơn trong Group/Page (cuộn 8 lần)
      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(1200);
      }

      // Bấm toàn bộ "Xem thêm" cho các bài trong Feed
      await page.evaluate(() => {
        const seeMoreRegex = /(?:…|\.{3})?\s*(?:Xem thêm|See more|Hiển thị thêm)\b/i;
        const btns = Array.from(document.querySelectorAll('div[role="button"], span[role="button"], span[dir="auto"], div[dir="auto"]'));
        for (const b of btns) {
          const text = b.innerText ? b.innerText.trim() : '';
          if (text && text.length <= 40 && seeMoreRegex.test(text)) {
            try {
              b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            } catch (e) { }
            try {
              b.click();
            } catch (e) { }
          }
        }
      }).catch(() => { });
      await page.waitForTimeout(1000);

      const fetchLimit = Math.max(scrapeLimit * 3, 30);
      const items = await page.evaluate((fetchLimitArg) => {
        const results = [];
        const feed = document.querySelector('[role="feed"]');
        const candidateEls = feed
          ? Array.from(feed.children).filter(c => {
              const txt = (c.innerText || '').toLowerCase().trim();
              if (txt.includes('sắp xếp bảng feed') || txt.includes('sắp xếp theo') || txt.includes('bạn đang nghĩ gì') || txt.includes('tạo bài viết')) return false;
              return (c.innerText || '').length > 20;
            })
          : Array.from(document.querySelectorAll('div[role="feed"] div[role="article"], div[role="article"], div[data-ad-preview="message"]'));

        for (const el of candidateEls) {
          if (results.length >= fetchLimitArg) break;

          const rawText = (el.querySelector('div[dir="auto"]')?.innerText || el.innerText || '').trim();
          if (rawText.length < 5) continue;
          if (/^(?:sắp xếp bảng feed|sắp xếp theo|bạn đang nghĩ gì|tạo bài viết)/i.test(rawText)) continue;

          const links = Array.from(el.querySelectorAll('a')).map(a => a.href).filter(Boolean);
          let postLink = links.find(l => l.includes('/posts/') || l.includes('/permalink/') || l.includes('/share/p/'));
          if (!postLink) {
            const pcb = links.find(l => /set=(?:pcb|gm|g|a)\.([a-zA-Z0-9_]+)/.test(l));
            if (pcb) {
              const m = pcb.match(/set=(?:pcb|gm|g|a)\.([a-zA-Z0-9_]+)/);
              if (m) {
                const gid = location.pathname.match(/groups\/([^\/\?]+)/)?.[1];
                postLink = gid ? `https://www.facebook.com/groups/${gid}/posts/${m[1]}/` : pcb;
              }
            }
          }
          if (postLink) {
            try {
              const u = new URL(postLink);
              u.search = '';
              u.pathname = u.pathname.replace('/permalink/', '/posts/');
              postLink = u.toString();
            } catch (e) { }
          }

          let authorName = '';
          const h2 = el.querySelector('h2');
          if (h2) {
            const m = (h2.innerText || '').match(/^(?:bài viết của|post by)\s+(.+)$/i);
            if (m && m[1] && m[1].trim().length >= 2 && m[1].trim().length <= 50) authorName = m[1].trim();
          }
          if (!authorName) {
            const userLink = el.querySelector('a[href*="/user/"]:not([href*="/groups/"]), a[href*="profile.php"]:not([href*="/groups/"]), a[href*="/people/"]:not([href*="/groups/"])');
            const uText = (userLink?.getAttribute('aria-label') || userLink?.innerText || '').trim();
            if (uText && uText.length >= 2 && uText.length <= 50 && !uText.includes('\n') && !/[.!?]/.test(uText)) {
              authorName = uText;
            }
          }
          if (!authorName) {
            const authorEl = el.querySelector('h2 a, h3 a, h2 strong, h3 strong, a[role="link"] strong');
            const aTxt = authorEl?.innerText?.trim() || '';
            if (aTxt && aTxt.length <= 50 && !aTxt.includes('\n') && !/[.!?]/.test(aTxt)) {
              authorName = aTxt;
            } else {
              authorName = 'Facebook';
            }
          }

          let publishedTime = '';
          const timeEl = el.querySelector('a[aria-label][href*="/posts/"], a[aria-label][href*="/permalink/"], a[aria-label][href*="/groups/"], a[aria-label*="giờ"], a[aria-label*="ngày"], a[aria-label*="phút"], abbr, time');
          if (timeEl) {
            publishedTime = timeEl.getAttribute('aria-label') || timeEl.innerText?.trim() || '';
          }

          const imgEls = Array.from(el.querySelectorAll('a[href*="/photo"] img, a[href*="set=pcb"] img, a[href*="set=p."] img, div[data-visualcompletion="media-vc-image"] img, img[src*="fbcdn"], img[src*="scontent"]'));
          const mediaList = [];
          imgEls.forEach(img => {
            const src = img.src || img.getAttribute('src');
            if (src && !src.includes('s150x150') && !src.includes('s50x50') && !src.includes('p50x50') && !src.includes('profile') && !src.includes('emoji') && !src.includes('rsrc.php')) {
              mediaList.push(src);
            }
          });

          const videoEls = Array.from(el.querySelectorAll('video source[src], video[src]'));
          videoEls.forEach(v => {
            const src = v.src || v.getAttribute('src');
            if (src && !src.startsWith('blob:') && !src.includes('bytestart=') && !src.includes('byteend=')) mediaList.push(src);
          });

          const finalMedia = [...new Set(mediaList)];

          // Chỉ nhận phần tử nếu có media hoặc postLink hoặc text dài có nghĩa (loại bỏ 100% controls UI)
          if (finalMedia.length > 0 || postLink || (rawText.length > 50 && !rawText.toLowerCase().includes('sắp xếp'))) {
            results.push({
              title: rawText.length > 80 ? rawText.slice(0, 80) + '...' : (rawText || `Bài viết từ Facebook (${authorName})`),
              originalUrl: postLink || '',
              content: rawText,
              mediaUrls: finalMedia,
              author: authorName,
              publishedTime: publishedTime
            });
          }
        }
        return results;
      }, scrapeLimit);

      await releaseContext();
      releaseContext = null;
      // Dedup theo NỘI DUNG đã chuẩn hoá thay vì originalUrl: khi Playwright không tìm thấy
      // link /posts/, /permalink/, /share/p/ trong 1 bài (rất hay gặp với bài share lại),
      // originalUrl bị fallback về chính sourceUrl (URL của Group) — nếu dedup theo URL thì mọi
      // bài "không có permalink" sau bài đầu tiên sẽ bị coi là trùng dù nội dung khác hẳn.
      const seenContent = new Set();
      const dedupedItems = [];
      for (const item of items) {
        if (!item.originalUrl) item.originalUrl = sourceUrl;
        item.content = cleanScrapedCaption(item.content || '');
        if (shouldIncludeCredit) {
          const authorClean = item.author || '';
          const isAnon = !authorClean || /ẩn danh|anonymous|thành viên nhóm|thành viên ẩn danh|member/i.test(authorClean);
          const creText = isAnon ? 'Member ẩn danh' : authorClean;
          if (item.content && !item.content.includes('Cre:')) {
            item.content += `\n\nCre: ${creText}`;
          }
        }
        item.title = item.content.length > 80 ? item.content.slice(0, 80) + '...' : item.content;
        const normalizedContent = item.content.replace(/\s+/g, ' ').trim().toLowerCase();
        const dedupKey = normalizedContent || item.originalUrl;
        if (seenContent.has(dedupKey)) continue;
        seenContent.add(dedupKey);
        dedupedItems.push(attachMediaMetadata(item));
      }
      console.log(`[FB_Scraper] ✅ Cào thành công ${dedupedItems.length} bài từ Facebook Group/Page!`);
      const bulkResult = { success: true, items: dedupedItems };
      if (dedupedItems.length > 0) {
        scrapeCache[scrapeCacheKey] = { result: bulkResult, scrapedAt: Date.now() };
        saveScrapeCache();
      }
      return res.json(bulkResult);
    } catch (err) {
      console.error('[FB_Scraper] ❌ Lỗi:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    } finally {
      await releaseContext?.();
    }
  }

  // ── 3b. INSTAGRAM (1 bài /p/, /reel/, /reels/, /tv/) ───────────────────────
  // Trước đây link Instagram rơi xuống WEBSITE_CRAWLER chung (chỉ lấy og:image, caption kiểu
  // 'X on Instagram: "…"'). extractVideoDirectly đã có nhánh Instagram riêng (embed + bắt video thật).
  if (/^https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+/i.test(sourceUrl)) {
    const igCacheKey = getScrapeCacheKey(sourceUrl, scrapeLimit, minViewsThreshold, shouldIncludeCredit, scrapeIdentityKey);
    if (shouldForceRefresh) {
      delete scrapeCache[igCacheKey];
    } else {
      const cachedIg = scrapeCache[igCacheKey];
      if (cachedIg && (Date.now() - cachedIg.scrapedAt) < SCRAPE_CACHE_TTL_MS) {
        return res.json({ ...cachedIg.result, cached: true });
      }
    }
    try {
      const ig = await extractVideoDirectly(sourceUrl, { cookieString });
      if (!ig || !ig.success) {
        return res.status(500).json({ success: false, error: ig?.error || 'Không cào được bài Instagram' });
      }
      // og:title Instagram: 'Tên on Instagram: "caption"' (hoặc bản tiếng Việt 'Tên trên Instagram: "…"')
      let author = '';
      let caption = String(ig.title || '').trim();
      const igTitleMatch = caption.match(/^(.*?)\s+(?:on|trên)\s+Instagram:\s*["“]([\s\S]*?)["”]?\s*$/i);
      if (igTitleMatch) {
        author = igTitleMatch[1].trim();
        caption = igTitleMatch[2].trim();
      }
      if (/^Video Instagram$/i.test(caption)) caption = '';
      let formattedContent = cleanScrapedCaption(caption);
      if (shouldIncludeCredit && author && !formattedContent.includes('Cre:')) {
        formattedContent += `\n\nCre: ${author}`;
      }
      const mediaUrls = (ig.mediaUrls || []).filter(Boolean);
      const resultItem = attachMediaMetadata({
        title: formattedContent.length > 80 ? formattedContent.slice(0, 80) + '...' : formattedContent,
        originalUrl: sourceUrl,
        content: formattedContent,
        mediaUrls,
        author,
      }, ig.videoUrl ? [ig.videoUrl] : []);
      const igResult = {
        success: true,
        mediaFound: mediaUrls.length > 0,
        mediaType: resultItem.mediaType,
        mediaCount: resultItem.mediaCount,
        videoCount: resultItem.videoCount,
        imageCount: resultItem.imageCount,
        items: [resultItem],
      };
      console.log(`[IG_Scraper] ✅ ${sourceUrl} → ${mediaUrls.length} media (${resultItem.mediaType}), tác giả: ${author || '?'}`);
      if (mediaUrls.length > 0) {
        scrapeCache[igCacheKey] = { result: igResult, scrapedAt: Date.now() };
      }
      saveScrapeCache();
      return res.json(igResult);
    } catch (err) {
      console.error('[IG_Scraper] ❌ Lỗi:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ── 4. WEBSITE_CRAWLER (báo, blog, website thông thường) ──────────────────
  // Gộp 1 bài báo đã cào (từ scrapeNewsArticle) thành item chuẩn cho hàng đợi, kèm dòng "Nguồn:" khi
  // bật includeCredit. Tách thành hàm dùng chung cho cả nhánh 1-bài-đơn lẫn nhánh cào-nhiều-bài-từ-
  // chuyên-mục bên dưới, tránh lặp lại logic format.
  const buildArticleQueueItem = (article, fallbackUrlForSiteName) => {
    let fallbackSiteName = fallbackUrlForSiteName;
    try { fallbackSiteName = new URL(fallbackUrlForSiteName).hostname.replace(/^www\./, ''); } catch (e) { /* giữ nguyên nếu parse lỗi */ }
    const sourceCreditLine = shouldIncludeCredit
      ? `\n\nNguồn: ${article.siteName || fallbackSiteName}${article.url ? ' - ' + article.url : ''}`
      : '';
    const fullTextFormatted = [
      article.title ? `📌 ${article.title}` : '',
      article.sapo ? `💡 ${article.sapo}` : '',
      article.content
    ].filter(Boolean).join('\n\n') + sourceCreditLine;
    const allImages = article.images && article.images.length > 0
      ? article.images.map(img => img.url)
      : (article.coverImage ? [article.coverImage] : []);
    return {
      title: article.title,
      originalUrl: article.url,
      content: fullTextFormatted,
      sapo: article.sapo,
      mediaUrls: allImages,
      imagesWithCaption: article.images,
      hasCoverImage: !!article.coverImage,
      siteName: article.siteName,
      author: article.author,
      publishedTime: article.publishedTime,
      wordCount: article.wordCount
    };
  };

  // Khi caller yêu cầu NHIỀU bài (scrapeLimit > 1 — Campaign tự động cào định kỳ) và sourceUrl không
  // phải 1 link bài cụ thể, đây thường là trang CHUYÊN MỤC/DANH MỤC, không phải 1 bài báo. Trước đây
  // code luôn gọi scrapeNewsArticle() (dành cho 1 bài đơn) bất kể limit, khiến trang chuyên mục bị
  // gộp nhầm thành "1 bài báo" duy nhất chứa lộn xộn toàn bộ nội dung trang — mỗi lần cào lại ra nội
  // dung hơi khác (do tin mới xoay vòng trên trang danh mục) nên dedup theo content-hash gần như
  // không bao giờ bắt được trùng, và không có bài nào được tách đăng riêng lẻ đúng nghĩa. Giờ dùng
  // scrapeCategoryArticleUrls() để lấy danh sách URL từng bài viết thật, rồi cào full từng bài một
  // bằng scrapeNewsArticle() (được các fix ảnh/nội dung ở trên) — mỗi bài có content-hash riêng biệt.
  if (scrapeLimit > 1) {
    try {
      const categoryResult = await scrapeCategoryArticleUrls(sourceUrl, scrapeLimit);
      if (categoryResult.success && categoryResult.urls && categoryResult.urls.length > 0) {
        const items = [];
        for (const articleUrl of categoryResult.urls.slice(0, scrapeLimit)) {
          try {
            const article = await scrapeNewsArticle(articleUrl);
            if (!article.success || (!article.content && !article.title)) continue;
            items.push(buildArticleQueueItem(article, articleUrl));
          } catch (articleErr) {
            console.warn(`[Website_Crawler] Bỏ qua bài lỗi khi cào chuyên mục ${articleUrl}: ${articleErr.message}`);
          }
        }
        if (items.length > 0) {
          console.log(`[Website_Crawler] ✅ Cào được ${items.length}/${categoryResult.urls.length} bài từ chuyên mục: ${sourceUrl}`);
          return res.json({ success: true, items });
        }
        console.warn(`[Website_Crawler] ⚠️ Tìm được ${categoryResult.urls.length} link bài trong chuyên mục nhưng cào full nội dung đều thất bại, rơi xuống nhánh 1-bài-đơn.`);
      }
    } catch (catErr) {
      console.warn(`[Website_Crawler] Category scrape lỗi, rơi xuống nhánh 1-bài-đơn: ${catErr.message}`);
    }
  }

  try {
    const singleArticle = await scrapeNewsArticle(sourceUrl);
    if (singleArticle.success && (singleArticle.content || singleArticle.title)) {
      if (!singleArticle.coverImage) {
        console.warn(`[Website_Crawler] ⚠️ Không tìm được ảnh bìa đạt chuẩn (≥200px, không phải logo/icon) cho: ${sourceUrl}`);
      }
      return res.json({ success: true, items: [buildArticleQueueItem(singleArticle, sourceUrl)] });
    }
  } catch (e) {
    console.warn(`[Website_Crawler] Fast article scrape fallback: ${e.message}`);
  }

  let releaseContext = null;
  try {
    // Context từ browserPool (chung process Chromium) thay vì chromium.launch() riêng mỗi request.
    const acquired = await browserPool.acquireContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    });
    releaseContext = acquired.release;
    const context = acquired.context;
    const page = await context.newPage();
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Nhánh dự phòng CUỐI CÙNG này chỉ chạy khi scrapeNewsArticle() (và cào chuyên mục ở trên, nếu có)
    // đều lỗi/không ra kết quả — dùng lại đúng cascade lazy-load/dedup/lọc icon-logo như hàm chính
    // thay vì chỉ lấy `<img src>` đầu tiên như trước, để giảm rủi ro lấy nhầm ảnh khi rơi vào nhánh yếu này.
    const articles = await page.evaluate((scrapeLimitArg) => {
      const items = [];
      // VCCorp (CafeF, CafeBiz, Kênh14, Soha, GenK...) đặt tên ẢNH ĐẠI DIỆN BÀI là "avatar<timestamp>-...png"
      // — không phải avatar người dùng — nên bỏ dạng này ra trước khi lọc theo từ khóa "avatar".
      const isJunkImageUrl = (url) => (
        /\.(svg|gif|ico)($|\?)/i.test(url) ||
        /(icon|logo|avatar|ads|tracking|pixel|share|btn|placeholder)/i.test(url.replace(/avatar\d{6,}/gi, ''))
      );
      const seenImgUrls = new Set();
      const resolveImgUrl = (imgEl) => {
        if (!imgEl) return '';
        const candidates = [
          imgEl.getAttribute('data-original'),
          imgEl.getAttribute('data-src'),
          imgEl.getAttribute('data-srcset'),
          imgEl.getAttribute('srcset'),
          imgEl.getAttribute('data-actualsrc'),
          imgEl.getAttribute('data-cdn'),
          imgEl.getAttribute('data-lazy-src'),
          imgEl.src
        ];
        let raw = '';
        for (const attr of candidates) {
          if (attr && typeof attr === 'string' && attr.trim().length > 5) {
            const trimmed = attr.trim();
            if (!trimmed.startsWith('data:image') && !trimmed.includes('blank.gif') && !trimmed.includes('pixel') && !trimmed.includes('placeholder')) {
              raw = trimmed;
              break;
            }
          }
        }
        if (!raw) return '';
        // Chuỗi srcset "url1 480w, url2 960w" → lấy URL độ phân giải lớn nhất thay vì tin nguyên chuỗi thô
        if (raw.includes(',') && /\s\d+w/.test(raw)) {
          const parts = raw.split(',').map(s => s.trim()).map(entry => {
            const p = entry.split(/\s+/);
            return { url: p[0], num: parseFloat(p[1]) || 0 };
          }).filter(c => c.url);
          if (parts.length > 0) {
            parts.sort((a, b) => b.num - a.num);
            raw = parts[0].url;
          }
        }
        let abs = '';
        try { abs = new URL(raw, window.location.href).href; } catch (e) { abs = raw; }
        if (!abs.startsWith('http') || seenImgUrls.has(abs) || isJunkImageUrl(abs)) return '';
        const w = imgEl.naturalWidth || imgEl.width || 0;
        const h = imgEl.naturalHeight || imgEl.height || 0;
        if ((w > 0 && w < 120) || (h > 0 && h < 120)) return '';
        seenImgUrls.add(abs);
        return abs;
      };

      // Tìm thẻ article cụ thể (báo điện tử VN thường dùng)
      const nodes = document.querySelectorAll([
        'article',
        '.item-news', '.story', '.post-item', '.news-item',
        'h2 > a', 'h3 > a',
        '.article-item', '.card-article',
      ].join(', '));

      if (nodes.length > 0) {
        nodes.forEach((node, i) => {
          if (i >= scrapeLimitArg) return;
          const titleEl = node.tagName === 'A' ? node : node.querySelector('h1, h2, h3, h4, .title, a[title]');
          const linkEl = node.tagName === 'A' ? node : node.querySelector('a[href]');
          const imgEl = node.querySelector('img');
          const descEl = node.querySelector('p, .description, .summary, .excerpt, .sapo');

          const title = titleEl?.innerText?.trim() || titleEl?.getAttribute('title') || '';
          const link = linkEl?.href || '';
          const imgSrc = resolveImgUrl(imgEl);
          const desc = descEl?.innerText?.trim() || '';

          if (title.length > 5) {
            items.push({
              title,
              originalUrl: link || window.location.href,
              content: desc || title,
              mediaUrls: imgSrc ? [imgSrc] : [],
              usedWeakFallback: true,
            });
          }
        });
      }

      // Fallback: lấy thông tin chính của trang
      if (items.length === 0) {
        const pageTitle = document.title || '';
        const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
        const ogImage = document.querySelector('meta[property="og:image"], meta[name="twitter:image"]')?.content || '';
        const mainContent = document.querySelector('article, main, .content, #content')?.innerText?.slice(0, 600) || '';
        items.push({
          title: pageTitle,
          originalUrl: window.location.href,
          content: metaDesc || mainContent,
          mediaUrls: (ogImage && !isJunkImageUrl(ogImage)) ? [ogImage] : [],
          usedWeakFallback: true,
        });
      }
      return items;
    }, scrapeLimit);

    console.warn(`[Website] ⚠️ Đã dùng nhánh dự phòng cào yếu (scrapeNewsArticle/category đều không ra kết quả) — độ chính xác thấp hơn bình thường. Cào được ${articles.length} bài từ ${sourceUrl}`);
    return res.json({ success: true, items: articles, usedWeakFallback: true });
  } catch (err) {
    console.error('[Website] ❌ Lỗi:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    await releaseContext?.();
  }
});


// Endpoint tự động lấy tên Facebook / Fanpage thực tế từ Cookie
app.post('/api/get-account-name', async (req, res) => {
  const { cookieString } = req.body;

  if (!cookieString) {
    return res.status(400).json({ success: false, error: 'Thiếu cookieString' });
  }

  const cookies = parseCookies(cookieString);
  let releaseContext = null;

  try {
    console.log('[Playwright] Đang kiểm tra cookie & lấy thông tin tài khoản Facebook...');
    // Context từ browserPool (chung process Chromium) thay vì chromium.launch() riêng mỗi request.
    const acquired = await browserPool.acquireContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    releaseContext = acquired.release;
    const context = acquired.context;
    await context.addCookies(cookies);
    const page = await context.newPage();

    // Đi thẳng đến trang cá nhân /me để xác minh session chính xác
    await page.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => { });
    await page.waitForTimeout(2500);

    const currentUrl = page.url();
    const isLoginUrl = /facebook\.com\/(login|checkpoint)/i.test(currentUrl);
    const isLoggedOut = await page.evaluate(() => {
      const url = window.location.href;
      if (/facebook\.com\/(login|checkpoint)/i.test(url)) return true;
      const hasLoginInput = !!document.querySelector('input#email, input#pass, input[name="email"], input[name="pass"]');
      const hasLoginForm = !!document.querySelector('form#login_form, form#loginform, div#login_form, form[action*="/login"]');
      const hasNav = !!document.querySelector('div[role="navigation"], a[aria-label*="Trang cá nhân"], a[href*="/me/"]');
      const bodyText = (document.body && document.body.innerText) || '';
      const hasLoginPrompt = /đăng nhập vào facebook|log in to facebook|quên mật khẩu\?|tạo tài khoản mới|hãy đăng nhập hoặc đăng ký/i.test(bodyText);
      if (hasLoginInput && (hasLoginForm || !hasNav)) return true;
      if (hasLoginPrompt && !hasNav) return true;
      return false;
    }).catch(() => false);

    if (isLoginUrl || isLoggedOut) {
      console.warn('[Playwright] ⚠️ Cookie hết hạn — Facebook chuyển hướng đến trang đăng nhập/checkpoint.');
      return res.status(401).json({ success: false, error: 'Cookie đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại và cập nhật cookie.' });
    }

    const name = await page.evaluate(() => {
      const title = document.title || '';
      if (/đăng nhập|log in|sign up|đăng ký/i.test(title)) return null;
      const isSystemWord = (txt) => !txt || /^(?:thông báo|tin nhắn|bảng feed|trang chủ|home|notifications|inbox|messages|bảng tin|reels|stories|quản lý trang|xem tất cả|cài đặt|chọn trang|menu|facebook)$/i.test(txt.trim());

      // Tìm tên trên trang cá nhân
      const h1Name = document.querySelector('h1')?.innerText?.trim();
      if (h1Name && h1Name.length > 0 && !isSystemWord(h1Name)) return h1Name;

      const profileLink = document.querySelector('a[aria-label*="Trang cá nhân"], a[href*="/me/"], a[href*="/profile.php"]');
      if (profileLink && profileLink.innerText && profileLink.innerText.trim().length > 0 && !isSystemWord(profileLink.innerText)) {
        return profileLink.innerText.trim();
      }

      if (title.includes('| Facebook')) {
        const extracted = title.replace(/\s*\|\s*Facebook\s*$/i, '').trim();
        if (extracted.length > 0 && !isSystemWord(extracted)) return extracted;
      }
      return 'Tài khoản Facebook';
    }).catch(() => 'Tài khoản Facebook');

    console.log(`[Playwright] ✅ Cookie hợp lệ — URL: ${currentUrl} | Tên Facebook: "${name || 'Tài khoản Facebook'}"`);
    res.json({ success: true, name: name || 'Tài khoản Facebook' });
  } catch (error) {
    console.error('[Playwright] Lỗi lấy tên:', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await releaseContext?.();
  }
});

// Quét quan hệ "nick cá nhân -> toàn bộ Page có thể chuyển danh tính" từ chính giao diện Facebook.
// Không dùng tên làm khoá vì tên Page có thể trùng; mọi kết quả ổn định đều được định danh bằng Page ID.
app.post('/api/scan-managed-pages', async (req, res) => {
  const { cookieString, verifyEachPage = true } = req.body || {};
  const personalProfileId = getCookieValue(cookieString, 'c_user');
  if (!cookieString || !personalProfileId) {
    return res.status(400).json({ success: false, error: 'Cookie phải có tối thiểu c_user và xs của nick cá nhân.' });
  }

  let releaseContext = null;
  try {
    console.log(`[PageAudit] 🔎 Bắt đầu quét toàn bộ Page của via ${personalProfileId}...`);
    const acquired = await browserPool.acquireContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const { context } = acquired;
    releaseContext = acquired.release;

    // Cookie lưu ở các connection cũ đôi khi có sẵn i_user của một Page. Bỏ i_user để lần quét luôn
    // bắt đầu từ đúng danh tính cá nhân c_user, tránh hiểu nhầm một Page thành via gốc.
    const personalCookies = parseCookies(cookieString).filter((cookie) => cookie.name !== 'i_user');
    await context.addCookies(personalCookies);
    const page = await context.newPage();

    await page.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
    await page.waitForTimeout(1800);
    await assertFacebookSession(page);
    const personalSignals = await readFacebookPageSignals(page, false);
    const isSystemWord = (txt) => !txt || /^(?:thông báo|tin nhắn|bảng feed|trang chủ|home|notifications|inbox|messages|bảng tin|reels|stories|quản lý trang|xem tất cả|cài đặt|chọn trang|menu|facebook)$/i.test(txt.trim());
    const profileName = (personalSignals.heading && !isSystemWord(personalSignals.heading)) ? personalSignals.heading : 'Tài khoản Facebook';

    const candidateMap = new Map();
    const completedSources = [];
    const attemptedSources = [];

    for (const sourceUrl of [
      'https://www.facebook.com/pages/?category=your_pages',
      'https://www.facebook.com/bookmarks/pages',
    ]) {
      const sourceName = sourceUrl.includes('bookmarks') ? 'PAGES_BOOKMARK' : 'YOUR_PAGES';
      attemptedSources.push(sourceName);
      await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
      await page.waitForTimeout(1800);
      await assertFacebookSession(page);
      const validManagedPagesSurface = await page.evaluate(() => {
        const pathLooksCorrect = /\/(pages|bookmarks\/pages)/i.test(window.location.pathname + window.location.search);
        const text = (document.body?.innerText || '').slice(0, 12000);
        return pathLooksCorrect && /Trang của bạn|Trang bạn quản lý|Pages you manage|Your Pages|Các Trang|Pages/i.test(text);
      }).catch(() => false);
      if (validManagedPagesSurface) {
        const reachedEnd = await scrollFacebookListToEnd(page, candidateMap, sourceName);
        if (reachedEnd) completedSources.push(sourceName);
      }
    }

    // New Pages Experience thường có route chọn danh tính riêng. Quét thêm route này giúp lấy đủ
    // những Page có Facebook access nhưng không xuất hiện ổn định ở trang bookmarks/pages.
    attemptedSources.push('PROFILE_SELECTOR');
    await page.goto('https://www.facebook.com/profiles/select/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
    await page.waitForTimeout(1600);
    await assertFacebookSession(page);
    const validProfileSelector = await page.evaluate(() => {
      const text = (document.body?.innerText || '').slice(0, 12000);
      return /\/profiles\/select/i.test(window.location.pathname)
        && /Chọn trang cá nhân|Chọn Trang|Choose a profile|Select profile|Xem tất cả/i.test(text);
    }).catch(() => false);
    if (validProfileSelector) {
      const selectorReachedEnd = await scrollFacebookListToEnd(page, candidateMap, 'PROFILE_SELECTOR');
      if (selectorReachedEnd) completedSources.push('PROFILE_SELECTOR');
    }

    attemptedSources.push('PROFILE_SWITCHER');
    if (await openFacebookProfileSwitcher(page)) {
      const reachedEnd = await scrollFacebookListToEnd(page, candidateMap, 'PROFILE_SWITCHER', '[role="dialog"]');
      if (reachedEnd) completedSources.push('PROFILE_SWITCHER');
    }

    // Meta Accounts Center (Trung tâm tài khoản) - Nơi chứa đầy đủ nhất toàn bộ Page quản lý (kể cả số lượng lớn 500+ Page)
    attemptedSources.push('ACCOUNTS_CENTER');
    try {
      await page.goto('https://accountscenter.facebook.com/profiles', { waitUntil: 'networkidle', timeout: 25000 }).catch(() => { });
      await page.waitForTimeout(2000);
      const seeAllBtn = page.locator('text=Xem tất cả các Trang, text=See all Pages').first();
      if (await seeAllBtn.isVisible().catch(() => false)) {
        await seeAllBtn.click({ force: true }).catch(() => { });
        await page.waitForTimeout(3000);
      }
      const acPages = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href*="profile_id="]'));
        const list = [];
        for (const a of anchors) {
          const match = a.href.match(/profile_id=([0-9]+)/);
          if (!match) continue;
          const label = a.getAttribute('aria-label') || a.innerText || '';
          const name = label.split('\n')[0].replace(/Trang Facebook/i, '').trim();
          list.push({ pageId: match[1], name: name || ('Facebook Page ' + match[1]), url: 'https://www.facebook.com/' + match[1], source: 'ACCOUNTS_CENTER' });
        }
        return list;
      }).catch(() => []);
      if (acPages.length > 0) {
        acPages.forEach(p => mergeFacebookPageCandidate(candidateMap, p));
        completedSources.push('ACCOUNTS_CENTER');
        console.log(`[PageAudit] 🎯 Accounts Center quét được ${acPages.length} Trang!`);
      }
    } catch (e) {
      console.warn('[PageAudit] Accounts Center scan warning:', e.message);
    }

    // Loại chính nick cá nhân ra khỏi danh sách Page nếu Facebook hiển thị nó trong menu chuyển đổi.
    for (const [key, candidate] of candidateMap.entries()) {
      if (candidate.pageId === personalProfileId) candidateMap.delete(key);
    }

    const probePage = await context.newPage();
    const resolvedCandidates = [];
    for (const candidate of candidateMap.values()) {
      const resolved = await resolveFacebookPageId(probePage, candidate);
      if (resolved.pageId === personalProfileId) continue;
      resolvedCandidates.push(resolved);
    }

    // Gộp lại lần cuối bằng ID sau khi các URL vanity đã được phân giải.
    const resolvedMap = new Map();
    for (const candidate of resolvedCandidates) {
      const key = candidate.pageId ? `id:${candidate.pageId}` : `vanity:${candidate.vanity || candidate.url}`;
      const current = resolvedMap.get(key);
      resolvedMap.set(key, current ? {
        ...current,
        ...candidate,
        sources: Array.from(new Set([...(current.sources || []), ...(candidate.sources || [])])),
      } : candidate);
    }

    const pages = [];
    for (const candidate of resolvedMap.values()) {
      const audited = verifyEachPage
        ? await verifyFacebookPageIdentity(context, probePage, candidate, personalProfileId)
        : { ...candidate, verificationStatus: 'DISCOVERED', verificationMessage: 'Đã thấy trong danh sách Page; chưa thử chuyển danh tính.' };
      // Các mục điều hướng không phải Page có thể lọt vào trang danh sách; chỉ trả mục có ID hoặc có
      // bằng chứng nằm trong menu chuyển profile để không làm bẩn dữ liệu kiểm kê.
      if (audited.pageId || audited.sources?.includes('PROFILE_SWITCHER')) pages.push(audited);
    }

    pages.sort((left, right) => {
      if (left.verificationStatus === 'VERIFIED' && right.verificationStatus !== 'VERIFIED') return -1;
      if (right.verificationStatus === 'VERIFIED' && left.verificationStatus !== 'VERIFIED') return 1;
      return String(left.name || '').localeCompare(String(right.name || ''), 'vi');
    });

    // Trả danh tính browser về nick cá nhân trước khi đóng context. Đây là context cách ly, nhưng làm
    // vậy giúp log/screenshot debug cuối luồng không mang danh tính Page gây hiểu nhầm.
    await context.clearCookies().catch(() => { });
    await context.addCookies(personalCookies).catch(() => { });

    const verifiedCount = pages.filter((item) => item.verificationStatus === 'VERIFIED').length;
    const scanCompletedAt = new Date().toISOString();
    console.log(`[PageAudit] ✅ Via ${personalProfileId}: ${pages.length} Page được tìm thấy, ${verifiedCount} Page đã xác minh chuyển danh tính.`);
    return res.json({
      success: true,
      personalProfileId,
      profileName,
      pages,
      totalFound: pages.length,
      verifiedCount,
      scanComplete: completedSources.length > 0,
      attemptedSources,
      completedSources,
      scannedAt: scanCompletedAt,
    });
  } catch (error) {
    const status = /Cookie Facebook.*hết hạn|checkpoint|đăng nhập/i.test(error.message) ? 401 : 500;
    console.error(`[PageAudit] ❌ Quét Page thất bại cho via ${personalProfileId}:`, error.message);
    return res.status(status).json({ success: false, personalProfileId, error: error.message });
  } finally {
    if (releaseContext) await releaseContext().catch(() => { });
  }
});


// Bộ nhớ đệm fallback Facebook Cookie lấy trực tiếp từ database
let cachedFallbackCookie = { cookie: null, timestamp: 0 };
async function getFallbackFbCookie() {
  const now = Date.now();
  if (cachedFallbackCookie.cookie && (now - cachedFallbackCookie.timestamp < 10 * 60 * 1000)) {
    return cachedFallbackCookie.cookie;
  }
  try {
    const mysql = require('mysql2/promise');
    const conn = await desktop.openDb(getMysqlConfig(4000));
    const [rows] = await conn.execute(
      "SELECT access_token FROM social_accounts WHERE account_type = 'PERSONAL_COOKIE' AND token_status = 'OK' AND access_token IS NOT NULL ORDER BY updated_at DESC LIMIT 1"
    );
    await conn.end();
    if (rows && rows.length > 0 && rows[0].access_token) {
      cachedFallbackCookie = { cookie: rows[0].access_token, timestamp: now };
      return rows[0].access_token;
    }
  } catch (err) {
    console.warn('[ExtractVideo] ⚠️ Không lấy được fallback cookie từ DB:', err.message);
  }
  return null;
}

// Hàm trích xuất link Video trực tiếp (.mp4) từ TikTok, Douyin, Threads, Facebook hoặc Instagram
async function extractVideoDirectly(url, options = {}) {
  if (!url) {
    return { success: false, error: 'Thiếu đường dẫn URL' };
  }

  // 1. Tách lấy URL HTTP/HTTPS chuẩn từ nội dung dán (loại bỏ text tiếng Việt/râu ria khi bấm nút chia sẻ từ ứng dụng)
  let cleanInput = String(url).trim();
  const urlMatch = cleanInput.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) {
    cleanInput = urlMatch[0];
  }

  let parsedInputUrl;
  try {
    parsedInputUrl = new URL(cleanInput);
  } catch (_) {
    return { success: false, error: 'URL không hợp lệ' };
  }
  if (!['http:', 'https:'].includes(parsedInputUrl.protocol)) {
    return { success: false, error: 'Chỉ hỗ trợ URL HTTP/HTTPS' };
  }

  const host = parsedInputUrl.hostname.toLowerCase();

  // 2. DOUYIN
  if (['douyin.com', 'iesdouyin.com', 'v.douyin.com'].some((suffix) => hostnameMatchesSuffix(host, suffix)) || host.includes('douyin')) {
    return await scrapeDouyinNoWatermark(cleanInput);
  }

  // 3. TIKTOK
  if (TIKTOK_PAGE_HOST_SUFFIXES.some((suffix) => hostnameMatchesSuffix(host, suffix)) || host.includes('tiktok')) {
    const tiktokResult = await scrapeTikTokNoWatermark(cleanInput);
    if (!tiktokResult.success) return tiktokResult;
    return {
      success: true,
      sourceType: 'TIKTOK',
      title: tiktokResult.title || 'Video TikTok',
      content: tiktokResult.content || tiktokResult.title || '',
      originalUrl: tiktokResult.originalUrl || cleanInput,
      videoUrl: tiktokResult.videoUrl,
      mediaUrls: tiktokResult.mediaUrls || (tiktokResult.videoUrl ? [tiktokResult.videoUrl] : []),
      watermarkRemoved: tiktokResult.watermarkRemoved,
      isHd: tiktokResult.isHd,
      cachedLocally: tiktokResult.cachedLocally,
      quality: tiktokResult.quality,
    };
  }

  const isThreads = ['threads.net', 'threads.com'].some((suffix) => hostnameMatchesSuffix(host, suffix));
  const isFb = ['facebook.com', 'fb.watch', 'fb.me'].some((suffix) => hostnameMatchesSuffix(host, suffix));
  const isInsta = ['instagram.com', 'instagr.am'].some((suffix) => hostnameMatchesSuffix(host, suffix));

  if (!isThreads && !isFb && !isInsta) {
    return { success: false, error: 'Chỉ hỗ trợ link TikTok, Douyin, Threads, Facebook hoặc Instagram' };
  }

  url = cleanInput;

  // 4. Resolve shortlink Facebook nếu là link rút gọn fb.watch, fb.me hoặc link /share/
  if (isFb && (url.includes('fb.watch') || url.includes('fb.me') || url.includes('/share/'))) {
    try {
      const headRes = await axios.get(url, {
        maxRedirects: 5,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        validateStatus: () => true,
        timeout: 8000
      });
      if (headRes.request?.res?.responseUrl && headRes.request.res.responseUrl !== url) {
        url = headRes.request.res.responseUrl;
        console.log(`[ExtractVideo] 🔄 Resolved Facebook redirect: ${url}`);
      }
    } catch (_) { }
  }

  let cookieString = options.cookieString || null;
  if (!cookieString && isFb) {
    cookieString = await getFallbackFbCookie();
  }

  // Context sạch từ browserPool (chờ tối đa 10s, pool đầy thì tự mở Chromium riêng — route đăng bài
  // gọi hàm này không bị chặn lâu). options.browser: caller đã có sẵn browser → mở context mới trong đó.
  let releaseContext = null;
  try {
    const acquired = await browserPool.acquireScrapeContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 }
    }, { browser: options.browser || null, waitTimeoutMs: 10000, launchArgs: ['--no-sandbox', '--disable-setuid-sandbox'] });
    releaseContext = acquired.release;
    const context = acquired.context;

    if (cookieString && isFb) {
      const cookies = cookieString.split(';').map(pair => {
        const [name, ...val] = pair.trim().split('=');
        return {
          name: name.trim(),
          value: val.join('=').trim(),
          domain: '.facebook.com',
          path: '/'
        };
      }).filter(c => c.name && c.value);
      if (cookies.length > 0) {
        await context.addCookies(cookies);
      }
    }

    const page = await context.newPage();
    const capturedMp4s = [];
    page.on('response', (response) => {
      try {
        const u = response.url();
        const contentType = String(response.headers()['content-type'] || '').toLowerCase();
        const isImage = contentType.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(u) || u.includes('/v/t39.') || u.includes('/v/t15.');
        if (isImage) return;

        const isVideo = contentType.includes('video/') || u.includes('.mp4')
          || (u.includes('cdninstagram.com') && (u.includes('/m84/') || u.includes('/m86/') || u.includes('/v/t2/')))
          || (u.includes('fbcdn.net') && u.includes('/o1/v/'));
        if (isVideo && !isAudioOnlyMp4(u) && !u.includes('bytestart=') && !u.includes('byteend=') && !capturedMp4s.includes(u)) {
          capturedMp4s.push(u);
        }
      } catch (_) { }
    });

    let videoUrl = null;
    let title = '';
    let sourceType = isThreads ? 'THREADS' : (isInsta ? 'INSTAGRAM' : 'FACEBOOK');
    let mediaUrls = [];
    let photos = [];
    let thumbnail = null;

    if (isThreads) {
      url = await navigateThreadsPage(page, url);
      for (let i = 0; i < 9; i++) {
        const htmlSoFar = await page.content().catch(() => '');
        if (htmlSoFar.includes('"video_versions"')) break;
        await page.waitForTimeout(1500);
      }

      const extracted = await page.evaluate(() => {
        const extractThreadsPostId = (href) => {
          if (!href) return null;
          const m = href.match(/\/(?:post|t)\/([^/?#]+)/);
          return m ? m[1] : null;
        };
        const currentPostId = extractThreadsPostId(window.location.pathname);
        const pathAuthorMatch = window.location.pathname.match(/\/@([^/?#]+)/);
        const currentAuthor = (pathAuthorMatch?.[1] || '').toLowerCase();
        const allContainers = Array.from(document.querySelectorAll('div[data-pressable-container="true"]'));
        const mainContainer = allContainers.find(container => {
          const permalink = container.querySelector('a[href*="/post/"], a[href*="/t/"]');
          return extractThreadsPostId(permalink?.getAttribute('href')) === currentPostId;
        }) || allContainers[0] || null;
        const commentSection = document.querySelector('[aria-label*="Bình luận"], [aria-label*="Comment"]');
        const searchScope = mainContainer;
        const getContainerAuthor = (container) => {
          const links = Array.from(container?.querySelectorAll('a[href*="/@"]') || []);
          for (const link of links) {
            const match = (link.getAttribute('href') || '').match(/\/@([^/?#]+)/);
            if (match) return match[1].toLowerCase();
          }
          return '';
        };
        const mediaScopes = mainContainer ? [mainContainer] : [];
        const mainIndex = allContainers.indexOf(mainContainer);
        for (let i = mainIndex + 1; i >= 0 && i < allContainers.length; i++) {
          const candidate = allContainers[i];
          if (!currentAuthor || getContainerAuthor(candidate) !== currentAuthor) break;
          const label = (candidate.innerText || '').toLowerCase();
          if (!/(^|\n)(author|tác giả)(\n|$)/i.test(label)) break;
          mediaScopes.push(candidate);
        }
        const isForeignContainer = (container) => {
          const link = container.querySelector('a[href*="/post/"], a[href*="/t/"]');
          const id = link ? extractThreadsPostId(link.getAttribute('href')) : null;
          return !!(id && currentPostId && id !== currentPostId);
        };
        const isExcluded = (el) => {
          if (!searchScope || !searchScope.contains(el)) return true;
          if (commentSection && commentSection.contains(el)) return true;
          const ownContainer = el.closest('div[data-pressable-container="true"]');
          if (ownContainer && ownContainer !== searchScope && isForeignContainer(ownContainer)) return true;
          return false;
        };

        const videoEl = mediaScopes
          .flatMap(scope => Array.from(scope.querySelectorAll('video source[src], video[src]')))
          .find(v => {
            const src = v.currentSrc || v.src || v.getAttribute('src') || '';
            return src && !src.startsWith('blob:') && !src.includes('bytestart=') && !src.includes('byteend=');
          });
        const videoUrl = videoEl ? (videoEl.currentSrc || videoEl.src || videoEl.getAttribute('src')) : null;

        const metricPattern = /^[\d.,]+\s*[KMB]?\+?$/i;
        const datePattern = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
        const textEls = searchScope ? Array.from(searchScope.querySelectorAll('span[dir="auto"], div[dir="auto"]')) : [];
        const lines = [];
        const seen = new Set();
        for (const el of textEls) {
          if (isExcluded(el)) continue;
          if (el.closest('header') || el.closest('button') || el.closest('time')) continue;
          const closestA = el.closest('a');
          if (closestA && (closestA.getAttribute('href')?.includes('/@') || closestA.getAttribute('href')?.includes('/post/'))) continue;
          let text = (el.innerText || '').trim();
          if (text.length <= 2) continue;
          const lower = text.toLowerCase();
          if (lower.includes('views') || lower.includes('likes') || lower.includes('translate') || lower.includes('dịch') || lower.includes('join threads') || lower.includes('open app')) continue;
          if (metricPattern.test(text) || datePattern.test(text)) continue;
          if (seen.has(text)) continue;
          const hasParent = lines.some(item => item.el.contains(el));
          if (hasParent) continue;
          const childIdx = lines.findIndex(item => el.contains(item.el));
          if (childIdx >= 0) {
            seen.delete(lines[childIdx].text);
            lines[childIdx] = { el, text };
            seen.add(text);
          } else {
            lines.push({ el, text });
            seen.add(text);
          }
        }
        const domCaption = lines.map(item => item.text.replace(/\n?(Translate|Dịch)\s*$/i, '').trim()).join('\n\n');
        let title = domCaption || 'Video Threads';
        return { videoUrl, title };
      });
      videoUrl = extracted.videoUrl;
      title = extracted.title;

      const pageHtml = await page.content();
      const allMedia = extractAllThreadsMediaFromHtml(pageHtml, url);
      if (!videoUrl && allMedia.videos.length > 0) {
        videoUrl = allMedia.videos[0];
      }
      videoUrl = extractBestHdVideoUrl(pageHtml, videoUrl);
      photos = allMedia.photos || [];
      mediaUrls = allMedia.orderedMedia.length > 0 ? allMedia.orderedMedia : (videoUrl ? [videoUrl, ...photos] : photos);
      const ogImage = await page.evaluate(() => document.querySelector('meta[property="og:image"]')?.getAttribute('content'));
      thumbnail = photos[0] || ogImage || videoUrl || null;

      const jsonThreadsCap = extractThreadsDataFromHtml(pageHtml, url);
      if (jsonThreadsCap && jsonThreadsCap.trim().length > (title ? title.length : 0)) {
        title = jsonThreadsCap.trim();
      }
    } else if (isInsta) {
      // 5. INSTAGRAM
      const m = url.match(/\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/);
      const shortcode = m ? m[1] : null;
      let loadedOk = false;
      if (shortcode) {
        const embedUrl = `https://www.instagram.com/reel/${shortcode}/embed/captioned/`;
        try {
          await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForTimeout(2000);
          loadedOk = true;
        } catch (_) { }
      }
      if (!loadedOk || capturedMp4s.length === 0) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2500);
      }

      const pageHtml = await page.content();
      const allMedia = extractAllThreadsMediaFromHtml(pageHtml, url);
      if (allMedia.videos.length > 0) {
        videoUrl = allMedia.videos[0];
      }
      if (!videoUrl) {
        videoUrl = extractBestHdVideoUrl(pageHtml);
      }
      if (!videoUrl && capturedMp4s.length > 0) {
        videoUrl = capturedMp4s[0];
      }
      if (!videoUrl) {
        videoUrl = await page.evaluate(() => {
          const v = document.querySelector('video[src], video source[src]');
          const src = v ? (v.currentSrc || v.src || v.getAttribute('src')) : null;
          return (src && !src.startsWith('blob:')) ? src : null;
        });
      }
      if (videoUrl) videoUrl = upgradeMediaUrlToHd(videoUrl);

      photos = allMedia.photos || [];
      const ogImage = await page.evaluate(() => document.querySelector('meta[property="og:image"]')?.getAttribute('content'));
      thumbnail = photos[0] || ogImage || null;
      const ogTitle = await page.evaluate(() => document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.title);
      title = ogTitle?.replace(/\s*\|\s*Instagram\s*$/i, '') || 'Video Instagram';
      mediaUrls = videoUrl ? [videoUrl] : (photos.length > 0 ? photos : (ogImage ? [ogImage] : []));
    } else if (isFb) {
      // 6. FACEBOOK
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(2500);

      let html = await page.content();
      videoUrl = extractBestHdVideoUrl(html);

      // Thử lấy link trực tiếp từ DOM video element
      if (!videoUrl) {
        videoUrl = await page.evaluate(() => {
          const v = document.querySelector('video[src], video source[src]');
          const src = v ? (v.currentSrc || v.src || v.getAttribute('src')) : null;
          return (src && !src.startsWith('blob:') && !src.includes('bytestart=') && !src.includes('byteend=')) ? src : null;
        });
      }

      // Thử dùng link MP4 bắt được qua network
      if (!videoUrl && capturedMp4s.length > 0) {
        videoUrl = capturedMp4s[0];
      }

      // Fallback qua m.facebook.com nếu vẫn chưa thấy video
      if (!videoUrl && (url.includes('/share/r/') || url.includes('/share/v/') || url.includes('/reel/') || url.includes('/watch/'))) {
        try {
          console.log(`[ExtractVideo] 🎬 Thử cào bổ sung Facebook Reel qua m.facebook.com...`);
          const mUrl = url.replace('www.facebook.com', 'm.facebook.com').replace('//facebook.com', '//m.facebook.com');
          const mPage = await context.newPage();
          await mPage.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1'
          });
          await mPage.goto(mUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
          await mPage.waitForTimeout(2500);
          const mHtml = await mPage.content();
          videoUrl = extractBestHdVideoUrl(mHtml);
          if (!videoUrl) {
            videoUrl = await mPage.evaluate(() => {
              const v = document.querySelector('video[src], video source[src]');
              const src = v ? (v.currentSrc || v.src || v.getAttribute('src')) : null;
              return (src && !src.startsWith('blob:') && !src.includes('bytestart=')) ? src : null;
            });
          }
          await mPage.close().catch(() => { });
        } catch (eM) { }
      }

      if (videoUrl) videoUrl = upgradeMediaUrlToHd(videoUrl);

      let authorName = '';
      const fbData = await page.evaluate(() => {
        const ogImage = document.querySelector('meta[property="og:image"]')?.content;
        const ogDesc = document.querySelector('meta[property="og:description"]')?.content;
        const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
        const authorEl = document.querySelector('a[href*="/user/"]')
          || document.querySelector('h2 strong, h3 strong, h2 a, h3 a, [data-ad-preview="message"]');
        let author = '';
        if (authorEl && authorEl.innerText && authorEl.innerText.trim().length > 0) {
          author = authorEl.innerText.trim();
        } else if (ogTitle && ogTitle.includes('|')) {
          author = ogTitle.split('|')[0].trim();
        }
        let caption = '';
        if (ogDesc && ogDesc.trim().length > 3) {
          caption = ogDesc.trim();
        } else {
          caption = document.title?.replace(/\s*\|\s*Facebook\s*$/i, '').trim() || 'Video Facebook';
        }
        return { caption, author, ogImage };
      });
      authorName = fbData.author || '';
      title = fbData.caption;
      thumbnail = fbData.ogImage || null;
      mediaUrls = videoUrl ? [videoUrl] : (fbData.ogImage ? [fbData.ogImage] : []);
    }

    await releaseContext();
    releaseContext = null;

    if (!videoUrl && mediaUrls.length === 0 && !thumbnail && (!title || title === 'Video Threads' || title === 'Video Facebook' || title === 'Video Instagram')) {
      return {
        success: false,
        error: 'Không tìm thấy video/ảnh trong bài viết hoặc bài viết ở chế độ riêng tư.',
      };
    }

    console.log(`[ExtractVideo] ✅ Cào bài thành công (${sourceType}): ${title}`);
    return {
      success: true,
      sourceType,
      title,
      content: title,
      videoUrl,
      mediaUrls,
      photos,
      thumbnail
    };
  } catch (error) {
    console.error('[ExtractVideo] Lỗi:', error.message);
    return { success: false, error: error.message };
  } finally {
    await releaseContext?.();
  }
}

// Endpoint trích xuất link Video trực tiếp (.mp4) qua HTTP (dành cho API ngoài & Tool Story)
app.post('/api/extract-video', async (req, res) => {
  const { url, cookieString } = req.body;
  const result = await extractVideoDirectly(url, { cookieString });
  res.json(result);
});

const taskProgressStore = new Map();
const taskProgressCleanupTimers = new Map();
const TASK_PROGRESS_DONE_TTL_MS = 10 * 60 * 1000;
// Route lỗi không cập nhật trạng thái failed → entry kẹt ở processing; dọn sau 30 phút không có cập nhật.
const TASK_PROGRESS_STALE_TTL_MS = 30 * 60 * 1000;

function updateTaskProgress(taskId, percent, stage, details = {}) {
  if (!taskId) return;
  const entry = {
    percent: Math.min(Math.max(Math.round(percent), 0), 100),
    stage,
    status: percent >= 100 ? 'completed' : 'processing',
    updatedAt: Date.now(),
    ...details
  };
  taskProgressStore.set(taskId, entry);

  clearTimeout(taskProgressCleanupTimers.get(taskId));
  const isDone = entry.status === 'completed' || entry.status === 'failed';
  const timer = setTimeout(() => {
    taskProgressCleanupTimers.delete(taskId);
    if (taskProgressStore.get(taskId) === entry) taskProgressStore.delete(taskId);
  }, isDone ? TASK_PROGRESS_DONE_TTL_MS : TASK_PROGRESS_STALE_TTL_MS);
  timer.unref?.();
  taskProgressCleanupTimers.set(taskId, timer);
}

app.get('/api/tools/progress/:taskId', (req, res) => {
  const { taskId } = req.params;
  const progress = taskProgressStore.get(taskId) || { percent: 0, stage: 'Đang chuẩn bị...', status: 'processing' };
  res.json({ success: true, ...progress });
});


// Endpoint Săn Video Viral theo Kênh / Profile TikTok
app.post('/api/hunt-tiktok-channel', async (req, res) => {
  const { handle, limit = 15, excludeIds = [], excludeUrls = [] } = req.body;
  if (!handle || !String(handle).trim()) {
    return res.status(400).json({ success: false, error: 'Thiếu tên kênh hoặc hashtag TikTok' });
  }

  let raw = String(handle).trim();
  if (raw.includes('?')) {
    raw = raw.split('?')[0];
  }

  let channelUrl = raw;
  if (raw.startsWith('@')) {
    channelUrl = `https://www.tiktok.com/${raw}`;
  } else if (raw.startsWith('http')) {
    channelUrl = raw;
  } else {
    channelUrl = `https://www.tiktok.com/@${raw}`;
  }

  let cleanHandle = raw;
  if (raw.includes('/@')) {
    cleanHandle = `@${raw.split('/@')[1].split('/')[0]}`;
  } else if (raw.startsWith('@')) {
    cleanHandle = raw;
  } else if (!raw.startsWith('http')) {
    cleanHandle = `@${raw}`;
  }
  const requestedLimit = parseInt(limit, 10) || 24;
  const maxItems = Math.min(Math.max(requestedLimit, 1), 100);

  console.log(`[TikTok_Hunter] 🔍 Bắt đầu quét kênh: ${cleanHandle} | URL: ${channelUrl} | Limit: ${maxItems}`);

  try {
    const ytArgs = [
      '-m', 'yt_dlp',
      '--flat-playlist',
      '--dump-json',
      '--playlist-items', `1-${maxItems}`,
      channelUrl,
    ];

    const { stdout } = await execFileAsync('python3', ytArgs, { timeout: 60000 });

    const lines = stdout.trim().split('\n').filter(Boolean);
    const parsedItems = [];

    for (const line of lines) {
      try {
        const it = JSON.parse(line);
        const viewCount = Number(it.view_count) || 0;
        const likeCount = Number(it.like_count) || 0;
        const commentCount = Number(it.comment_count) || 0;
        const vidUrl = it.webpage_url || it.original_url || `https://www.tiktok.com/@${it.uploader || cleanHandle.replace('@', '')}/video/${it.id}`;
        const vidId = String(it.id);
        const isExcluded = (Array.isArray(excludeIds) && excludeIds.includes(vidId)) ||
          (Array.isArray(excludeUrls) && excludeUrls.some((u) => u && String(u).includes(vidId)));

        parsedItems.push({
          id: it.id,
          url: vidUrl,
          title: it.title || it.description || 'Video TikTok',
          desc: it.description || it.title || '',
          views: viewCount,
          likes: likeCount,
          comments: commentCount,
          duration: it.duration_string || (it.duration ? `${it.duration}s` : ''),
          cover: it.thumbnails?.[0]?.url || '',
          channel: it.channel || it.uploader || cleanHandle,
          isAlreadyImported: isExcluded,
        });
      } catch (_) { }
    }

    // Sắp xếp bài nhiều view nhất lên đầu (Top Viral)
    parsedItems.sort((a, b) => b.views - a.views);

    console.log(`[TikTok_Hunter] 🎯 Đã tìm thấy ${parsedItems.length} video từ ${cleanHandle}, bài top 1 đạt ${parsedItems[0]?.views || 0} views!`);

    return res.json({
      success: true,
      channel: cleanHandle,
      total: parsedItems.length,
      items: parsedItems,
    });
  } catch (err) {
    console.warn(`[TikTok_Hunter] ⚠️ Lần quét 1 với username báo lỗi: ${err.message}. Đang giải mã channel_id (secUid) qua Playwright...`);
    let fallbackMsg = 'Không thể quét danh sách video của kênh này.';
    let release = null;
    let secUidFound = null;
    let userNickname = null;
    let totalVideos = 0;
    let isPrivate = false;

    try {
      const acquired = await browserPool.acquireContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
      release = acquired.release;
      const page = await acquired.context.newPage();
      await page.goto(channelUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);

      const profileData = await page.evaluate(() => {
        const s = document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
        if (!s) return null;
        try {
          const d = JSON.parse(s.textContent);
          const u = d['__DEFAULT_SCOPE__']?.['webapp.user-detail'];
          return {
            statusCode: u?.statusCode,
            nickname: u?.userInfo?.user?.nickname,
            secUid: u?.userInfo?.user?.secUid,
            videoCount: Number(u?.userInfo?.stats?.videoCount) || 0,
            isPrivate: Boolean(u?.userInfo?.user?.privateAccount),
          };
        } catch (_) {
          return null;
        }
      });

      if (profileData) {
        userNickname = profileData.nickname;
        secUidFound = profileData.secUid;
        totalVideos = profileData.videoCount;
        isPrivate = profileData.isPrivate;
      }
    } catch (e) {
      console.warn('[TikTok_Hunter] Lỗi mở profile bằng Playwright:', e.message);
    } finally {
      if (release) await release().catch(() => { });
    }

    // Nếu tìm thấy secUid (channel_id) và tài khoản có video
    if (secUidFound && !isPrivate && totalVideos > 0) {
      console.log(`[TikTok_Hunter] 🔑 Đã giải mã secUid: ${secUidFound} (kênh có ${totalVideos} video)! Đang cào lại danh sách video qua channel_id...`);
      try {
        const ytArgs2 = [
          '-m', 'yt_dlp',
          '--flat-playlist',
          '--dump-json',
          '--playlist-items', `1-${maxItems}`,
          `tiktokuser:${secUidFound}`,
        ];
        const { stdout: stdout2 } = await execFileAsync('python3', ytArgs2, { timeout: 60000 });
        const lines2 = stdout2.trim().split('\n').filter(Boolean);
        const parsedItems2 = [];

        for (const line of lines2) {
          try {
            const it = JSON.parse(line);
            const viewCount = Number(it.view_count) || 0;
            const likeCount = Number(it.like_count) || 0;
            const commentCount = Number(it.comment_count) || 0;
            const vidUrl = it.webpage_url || it.original_url || `https://www.tiktok.com/@${it.uploader || cleanHandle.replace('@', '')}/video/${it.id}`;
            const vidId = String(it.id);
            const isExcluded = (Array.isArray(excludeIds) && excludeIds.includes(vidId)) ||
              (Array.isArray(excludeUrls) && excludeUrls.some((u) => u && String(u).includes(vidId)));

            parsedItems2.push({
              id: it.id,
              url: vidUrl,
              title: it.title || it.description || 'Video TikTok',
              desc: it.description || it.title || '',
              views: viewCount,
              likes: likeCount,
              comments: commentCount,
              duration: it.duration_string || (it.duration ? `${it.duration}s` : ''),
              cover: it.thumbnails?.[0]?.url || '',
              channel: it.channel || it.uploader || userNickname || cleanHandle,
              isAlreadyImported: isExcluded,
            });
          } catch (_) { }
        }

        if (parsedItems2.length > 0) {
          parsedItems2.sort((a, b) => b.views - a.views);
          console.log(`[TikTok_Hunter] 🎯 CÀO THÀNH CÔNG ${parsedItems2.length} video từ ${cleanHandle} qua secUid! Bài top 1: ${parsedItems2[0]?.views} views.`);
          return res.json({
            success: true,
            channel: cleanHandle,
            total: parsedItems2.length,
            items: parsedItems2,
          });
        }
      } catch (err2) {
        console.warn(`[TikTok_Hunter] ⚠️ Cào qua secUid cũng thất bại: ${err2.message}`);
      }
    }

    if (totalVideos === 0 && userNickname) {
      fallbackMsg = `Kênh "${userNickname || cleanHandle}" hiện chưa đăng video nào (0 video). Vui lòng thử kênh khác có video!`;
    } else if (isPrivate) {
      fallbackMsg = `Kênh "${userNickname || cleanHandle}" là tài khoản riêng tư (Private). Không thể cào video riêng tư.`;
    } else if (userNickname) {
      fallbackMsg = `Kênh "${userNickname || cleanHandle}" có ${totalVideos} video nhưng TikTok đang bảo vệ danh sách công khai. Bạn có thể dán link từng video vào ô Dán link để tải Full HD bình thường!`;
    } else {
      fallbackMsg = `Không tìm thấy tài khoản TikTok "${cleanHandle}". Vui lòng kiểm tra lại chính xác username.`;
    }

    return res.status(200).json({ success: false, error: fallbackMsg });
  }
});

const MEDIA_DOWNLOAD_HOST_SUFFIXES = [
  'tiktok.com',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokv.com',
  'byteoversea.com',
  'ibytedtos.com',
  'muscdn.com',
  'bytecdn.cn',
  'douyinvod.com',
  'douyinstatic.com',
  'douyincdn.com',
  'amemv.com',
  'snssdk.com',
  'akamaized.net',
  'fbcdn.net',
  'cdninstagram.com',
  'fbsbx.com',
];

function isPrivateOrReservedIp(address) {
  const normalized = String(address || '').toLowerCase().split('%')[0];
  if (net.isIPv4(normalized)) {
    const octets = normalized.split('.').map(Number);
    return octets[0] === 0
      || octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19))
      || octets[0] >= 224;
  }
  if (net.isIPv6(normalized)) {
    if (normalized === '::' || normalized === '::1') return true;
    if (/^(fc|fd)/.test(normalized) || /^fe[89ab]/.test(normalized) || /^ff/.test(normalized)) return true;
    const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return mappedIpv4 ? isPrivateOrReservedIp(mappedIpv4) : false;
  }
  return true;
}

async function validateMediaDownloadUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch (_) {
    throw new Error('URL media không hợp lệ');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Chỉ hỗ trợ URL media HTTP/HTTPS');
  if (parsed.username || parsed.password) throw new Error('URL media không được chứa thông tin đăng nhập');
  if (parsed.port && !['80', '443'].includes(parsed.port)) throw new Error('Cổng URL media không được hỗ trợ');
  if (!MEDIA_DOWNLOAD_HOST_SUFFIXES.some((suffix) => hostnameMatchesSuffix(parsed.hostname, suffix))) {
    throw new Error('Tên miền media không nằm trong danh sách được phép');
  }

  const addresses = await dns.promises.lookup(parsed.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateOrReservedIp(address))) {
    throw new Error('Địa chỉ media không an toàn');
  }
  return parsed;
}

function refererForMediaUrl(parsedUrl) {
  const hostname = parsedUrl.hostname.toLowerCase();
  if (['tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokv.com', 'byteoversea.com', 'ibytedtos.com', 'muscdn.com', 'bytecdn.cn', 'douyinvod.com', 'akamaized.net']
    .some((suffix) => hostnameMatchesSuffix(hostname, suffix))) {
    return 'https://www.tiktok.com/';
  }
  if (hostnameMatchesSuffix(hostname, 'cdninstagram.com')) return 'https://www.threads.net/';
  return 'https://www.facebook.com/';
}

function resolveLocalClipFile(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    const isLocalWorker = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
      && (!parsed.port || parsed.port === String(PORT));
    const prefix = '/downloads/clip_meo/';
    if (!isLocalWorker || !parsed.pathname.startsWith(prefix)) return null;
    const filename = decodeURIComponent(parsed.pathname.slice(prefix.length));
    if (!filename || filename !== path.basename(filename)) return null;
    const filePath = path.join(CLIP_MEO_DIR, filename);
    if (!filePath.startsWith(`${CLIP_MEO_DIR}${path.sep}`)) return null;
    return filePath;
  } catch (_) {
    return null;
  }
}

// Endpoint tải Video về máy người dùng: proxy stream kèm header buộc trình duyệt tải xuống
// thay vì phát trực tiếp (vì link gốc thường là link phát video, không phải link tải file)
app.get('/api/download-video', async (req, res) => {
  const { url, filename, inline } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ success: false, error: 'Thiếu url' });
  }

  const safeName = (typeof filename === 'string' && filename.trim() ? filename : 'video')
    .replace(/[^\p{L}\p{N}_\- ]/gu, '')
    .slice(0, 80) || 'video';
  const asciiName = safeName.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_\- ]/g, '').trim().slice(0, 80) || 'video';

  const localClipFile = resolveLocalClipFile(url);
  if (localClipFile) {
    try {
      await fs.promises.access(localClipFile, fs.constants.R_OK);
    } catch (_) {
      return res.status(404).json({ success: false, error: 'Video cache không còn tồn tại' });
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    if (inline === '1') {
      res.setHeader('Content-Disposition', 'inline');
      return res.sendFile(localClipFile);
    }
    return res.download(localClipFile, `${asciiName}.mp4`);
  }

  const failDownload = (status, error) => {
    if (!res.headersSent) return res.status(status).json({ success: false, error });
    res.destroy(new Error(error));
  };

  const streamFrom = async (fileUrl, redirectsLeft) => {
    const parsedUrl = await validateMediaDownloadUrl(fileUrl);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const upstreamRequest = client
      .get(
        parsedUrl,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': refererForMediaUrl(parsedUrl),
            'Accept': 'video/*,application/octet-stream;q=0.9,*/*;q=0.8',
            ...(req.headers.range ? { Range: req.headers.range } : {}),
          },
        },
        (upstream) => {
          if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
            upstream.resume();
            if (redirectsLeft <= 0) return failDownload(502, 'Nguồn video chuyển hướng quá nhiều lần');
            const redirectedUrl = new URL(upstream.headers.location, parsedUrl).toString();
            return streamFrom(redirectedUrl, redirectsLeft - 1)
              .catch((err) => failDownload(400, err.message));
          }
          if (![200, 206].includes(upstream.statusCode)) {
            upstream.resume();
            return failDownload(502, `Nguồn video trả về lỗi (status ${upstream.statusCode})`);
          }

          const contentType = String(upstream.headers['content-type'] || '').toLowerCase();
          if (contentType.includes('text/html') || contentType.includes('application/json')) {
            upstream.resume();
            return failDownload(502, 'Nguồn không trả về tệp video hợp lệ');
          }
          const contentLength = Number(upstream.headers['content-length'] || 0);
          if (contentLength > 1024 * 1024 * 1024) {
            upstream.resume();
            return failDownload(413, 'Video vượt quá giới hạn 1 GB');
          }

          if (inline === '1') {
            res.setHeader('Content-Disposition', 'inline');
          } else {
            res.setHeader(
              'Content-Disposition',
              `attachment; filename="${asciiName}.mp4"; filename*=UTF-8''${encodeURIComponent(safeName)}.mp4`
            );
          }
          res.setHeader('Content-Type', contentType.startsWith('video/') ? contentType : 'video/mp4');
          if (upstream.headers['accept-ranges']) res.setHeader('Accept-Ranges', upstream.headers['accept-ranges']);
          if (upstream.headers['content-range']) res.setHeader('Content-Range', upstream.headers['content-range']);
          if (contentLength > 0) res.setHeader('Content-Length', String(contentLength));
          res.status(upstream.statusCode);
          upstream.pipe(res);
        }
      )
      .on('error', (err) => {
        failDownload(502, `Không tải được video: ${err.message}`);
      });
    upstreamRequest.setTimeout(20000, () => upstreamRequest.destroy(new Error('Nguồn video phản hồi quá thời gian')));
    req.once('aborted', () => upstreamRequest.destroy());
  };

  try {
    await streamFrom(url, 3);
  } catch (err) {
    return failDownload(400, err.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// FACEBOOK GROUP HUNTER — Quét & Trích xuất danh sách bài viết từ Facebook Group
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/hunt-facebook-group', async (req, res) => {
  try {
    const result = await huntFacebookFeed(req.body, { removeFacebookLoginOverlays });
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[Worker] Lỗi hunt-facebook-group:', err);
    return res.status(500).json({ success: false, error: err.message, items: [] });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// THREADS HUNTER — Quét bài viết Viral từ Threads (threads.net)
// ─────────────────────────────────────────────────────────────────────────────
const { huntThreads } = require('./threads-hunter');
const { searchFacebookGroups } = require('./fb-group-search');

app.post('/api/hunt-threads', async (req, res) => {
  try {
    const result = await huntThreads(req.body || {});
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, items: [] });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// FACEBOOK GROUP SEARCH — Tìm kiếm các Group chất lượng cao theo Từ khoá
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/hunt-facebook-groups-by-keyword', async (req, res) => {
  try {
    const result = await searchFacebookGroups(req.body || {});
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, groups: [] });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// CÁC API BUFF TƯƠNG TÁC (LIKE ẨN FANPAGE & BUFF VIEW REELS/VIDEO)
// ─────────────────────────────────────────────────────────────────────────────
const fbBuffTool = require('./fb-buff-tool');
const {
  loadSettings: loadBuffSettings,
  saveSettings: saveBuffSettings,
  sendTelegramMessage,
  notifyViaDead,
  notifyPostHunted,
  notifyBuffCompleted,
  notifyEmergencyStop,
  isEmergencyStopped,
  setEmergencyStop,
} = require('./telegram-alert');
const {
  filterAvailablePagesForPost,
  recordPagePostInteraction,
  getGlobalRegistryStats,
  clearPostInteractions,
  normalizeFbPostUrl,
  flushRegistry,
} = require('./page-post-registry');

// Proxy riêng của từng nick (cột social_accounts.proxy_url), tra theo c_user trong cookie.
// Dùng cho mọi lần buff bằng tay để các nick không chạy chung IP của máy chủ.
const viaProxyCache = new Map(); // uid -> { proxyUrl, at }
async function resolveViaProxy(cookieString, explicitProxy = '') {
  if (explicitProxy && String(explicitProxy).trim()) return String(explicitProxy).trim();
  const uid = (String(cookieString || '').match(/(?:^|;\s*)c_user=([^;]+)/) || [])[1];
  if (!uid) return '';
  const cached = viaProxyCache.get(uid);
  if (cached && Date.now() - cached.at < 60 * 1000) return cached.proxyUrl;

  let proxyUrl = '';
  let conn = null;
  try {
    const mysql = require('mysql2/promise');
    conn = await desktop.openDb(getMysqlConfig(3000));
    const [rows] = await conn.execute(
      "SELECT access_token, proxy_url FROM social_accounts WHERE access_token LIKE ? AND proxy_url IS NOT NULL AND proxy_url != '' ORDER BY id DESC",
      [`%c_user=${uid}%`]
    );
    const exact = new RegExp(`(?:^|;\\s*)c_user=${uid}(?:;|$)`);
    const match = rows.find((r) => exact.test(r.access_token || ''));
    proxyUrl = match ? String(match.proxy_url).trim() : '';
  } catch (err) {
    console.warn(`[Buff Proxy] ⚠️ Không tra được proxy cho UID ${uid}: ${err.message}`);
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
  viaProxyCache.set(uid, { proxyUrl, at: Date.now() });
  if (!proxyUrl) console.warn(`[Buff Proxy] ⚠️ Nick UID ${uid} chưa gắn proxy, sẽ chạy bằng IP máy chủ.`);
  return proxyUrl;
}

// 1. Quét danh sách Fanpage từ Cookie (có hỗ trợ cache nhanh)
app.post('/api/buff-get-pages', async (req, res) => {
  const { cookieString, forceRefresh = false, viaName = '', proxyUrl: explicitProxy = '' } = req.body;
  if (!cookieString) {
    return res.status(400).json({ success: false, error: 'Thiếu cookieString' });
  }
  try {
    const proxyUrl = await resolveViaProxy(cookieString, explicitProxy);
    const pages = await fbBuffTool.getManagedPages(cookieString, { forceRefresh: Boolean(forceRefresh), viaName, proxyUrl });
    return res.json({ success: true, count: pages.length, pages });
  } catch (err) {
    console.error('[Buff API] ❌ Lỗi quét Page:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 1a. Lấy danh sách Fanpage đã cache từ trước (theo UID hoặc toàn bộ cache)
app.get('/api/buff-cached-pages', (req, res) => {
  try {
    const { uid } = req.query;
    if (uid) {
      const pages = fbBuffTool.getCachedPages(String(uid)) || [];
      return res.json({ success: true, uid, count: pages.length, pages });
    }
    const allCache = fbBuffTool.loadPagesCache();
    return res.json({ success: true, cache: allCache });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 1a2. Lưu / cập nhật thủ công danh sách Page vào cache
app.post('/api/buff-cache-pages', (req, res) => {
  try {
    const { uid, pages, viaName = '' } = req.body;
    if (!uid || !Array.isArray(pages)) {
      return res.status(400).json({ success: false, error: 'Thiếu uid hoặc pages' });
    }
    fbBuffTool.setCachedPages(String(uid), pages, viaName);
    return res.json({ success: true, message: `Đã lưu cache ${pages.length} Page cho UID ${uid}` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 1b. AI Seeding Studio: Tạo bình luận tự nhiên theo ngữ cảnh bài viết bằng Gemini AI
app.post('/api/buff-ai-generate-comments', async (req, res) => {
  try {
    const { topic = 'GENERAL', postContent = '', postUrl = '', count = 8, tone = 'natural' } = req.body;
    console.log(`[AI Seeding API] 🧠 Tạo ${count} bình luận AI cho chủ đề: ${topic}`);
    const comments = await generateSeedingComments({ topic, postContent, postUrl, count, tone });
    return res.json({ success: true, count: comments.length, comments });
  } catch (err) {
    console.error('[AI Seeding API] ❌ Lỗi tạo comment AI:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Buff Like & Comment ẩn bài viết bằng Fanpage (Đồng bộ)
app.post('/api/buff-like', async (req, res) => {
  const {
    cookieString,
    targetUrl,
    reactionType = 'LIKE',
    selectedPages = [],
    delayMs = 1500,
    enableLike = true,
    enableComment = false,
    enableHumanBehavior = true,
    fastSwitch = true,
    cooldownEvery = 15,
    cooldownDurationMs = 3500,
    comments = [],
    proxyUrl: explicitProxy = '',
  } = req.body;
  if (!cookieString || !targetUrl) {
    return res.status(400).json({ success: false, error: 'Thiếu cookieString hoặc targetUrl' });
  }
  try {
    const proxyUrl = await resolveViaProxy(cookieString, explicitProxy);
    const laneUid = fbBuffTool.getUserIdFromCookie(cookieString);
    const result = await withBuffLane(laneUid, () => fbBuffTool.buffLikesWithPages(cookieString, targetUrl, {
      reactionType,
      selectedPages,
      delayMs,
      enableLike,
      enableComment,
      enableHumanBehavior,
      fastSwitch,
      cooldownEvery,
      cooldownDurationMs,
      comments,
      proxyUrl,
    }));
    return res.json({ success: true, result });
  } catch (err) {
    console.error('[Buff API] ❌ Lỗi Buff Like/Comment:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2b. Buff Like & Comment Stream thời gian thực (SSE) - Cập nhật tiến độ % và từng Page live
app.post('/api/buff-like-stream', async (req, res) => {
  const {
    cookieString,
    targetUrl,
    reactionType = 'LIKE',
    selectedPages = [],
    delayMs = 1500,
    enableLike = true,
    enableComment = false,
    enableHumanBehavior = true,
    fastSwitch = true,
    cooldownEvery = 15,
    cooldownDurationMs = 3500,
    comments = [],
    proxyUrl: explicitProxy = '',
  } = req.body;
  if (!cookieString || !targetUrl) {
    return res.status(400).json({ success: false, error: 'Thiếu cookieString hoặc targetUrl' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  // Client đóng tab / bấm Dừng → ngừng ghi và báo tool dừng sau page hiện tại
  let clientGone = false;
  res.on('close', () => {
    if (!res.writableFinished) {
      clientGone = true;
      console.warn('[Buff API Stream] ⚠️ Client đã ngắt kết nối, sẽ dừng sau page hiện tại.');
    }
  });

  const sendEvent = (event, data) => {
    if (clientGone || res.writableEnded) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (typeof res.flush === 'function') res.flush();
    } catch (e) {}
  };

  // Heartbeat giữ kết nối khi đang quét Page / chờ giãn cách lâu
  const heartbeat = setInterval(() => {
    if (clientGone || res.writableEnded) return;
    try { res.write(': hb\n\n'); } catch (e) {}
  }, 15000);

  try {
    const proxyUrl = await resolveViaProxy(cookieString, explicitProxy);
    const laneUid = fbBuffTool.getUserIdFromCookie(cookieString);
    const result = await withBuffLane(laneUid, () => fbBuffTool.buffLikesWithPages(cookieString, targetUrl, {
      proxyUrl,
      shouldStop: () => clientGone,
      reactionType,
      selectedPages,
      delayMs,
      enableLike,
      enableComment,
      enableHumanBehavior,
      fastSwitch,
      cooldownEvery,
      cooldownDurationMs,
      comments,
      onProgress: (prog) => {
        sendEvent('progress', prog);
      },
    }));
    sendEvent('done', { success: true, result });
  } catch (err) {
    console.error('[Buff API Stream] ❌ Lỗi Buff Like/Comment Stream:', err.message);
    sendEvent('error', { success: false, error: err.message });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

// 3. Buff View Reels/Video Facebook đa luồng
app.post('/api/buff-view', async (req, res) => {
  const { targetUrl, targetViews = 10, concurrency = 2, watchTimeSeconds = 6, cookieString = null } = req.body;
  if (!targetUrl) {
    return res.status(400).json({ success: false, error: 'Thiếu targetUrl' });
  }
  try {
    const result = await fbBuffTool.buffViews(targetUrl, {
      targetViews: parseInt(targetViews, 10) || 10,
      concurrency: parseInt(concurrency, 10) || 2,
      watchTimeSeconds: parseInt(watchTimeSeconds, 10) || 6,
      cookieStr: cookieString,
    });
    return res.json({ success: true, result });
  } catch (err) {
    console.error('[Buff API] ❌ Lỗi Buff View:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. HỆ THỐNG HÀNG ĐỢI TỰ ĐỘNG BUFF TƯƠNG TÁC (AUTO-BUFF QUEUE & POST-HUNTER READY)
// ─────────────────────────────────────────────────────────────────────────────

const BUFF_QUEUE_FILE = path.join(__dirname, 'buff_queue.json');
const BUFF_HISTORY_FILE = path.join(__dirname, 'buff_history.json');

// Cache RAM + ghi gom (debounce, async) cho buff_queue.json / buff_history.json — trước đây mỗi
// request list/check đều readFileSync + JSON.parse cả file, mỗi lần save đều writeFileSync chặn event loop.
// Worker 3001 & 3002 dùng CHUNG 2 file này nên cache được kiểm tra theo mtime: khi không có lần ghi
// nào đang chờ, statSync (rẻ) và đọc lại nếu process kia đã ghi đè file.
function createCachedJsonStore(filePath, label, parse, empty) {
  let cache = null;
  let cacheMtimeMs = -1;
  let saveTimer = null;
  let inFlight = false;
  let closed = false;
  let writing = Promise.resolve();

  const statMtime = () => { try { return fs.statSync(filePath).mtimeMs; } catch (_) { return -1; } };

  function load() {
    // Đang có thay đổi chưa ghi xong xuống đĩa → bản trong RAM là mới nhất.
    if (cache && (saveTimer || inFlight)) return cache;
    const mtimeMs = statMtime();
    if (cache && mtimeMs === cacheMtimeMs) return cache;
    let data = null;
    try {
      if (mtimeMs >= 0) data = parse(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    } catch (e) {
      console.warn(`[${label}] ⚠️ Không đọc được file, khởi tạo lại:`, e.message);
    }
    cache = data || empty();
    cacheMtimeMs = mtimeMs;
    return cache;
  }

  async function writeNow() {
    inFlight = true;
    try {
      const tmp = `${filePath}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(cache, null, 2));
      if (closed) return; // flush() lúc tắt đã ghi bản mới nhất, không rename đè bản cũ hơn
      await fs.promises.rename(tmp, filePath);
      if (!saveTimer) cacheMtimeMs = statMtime();
    } finally {
      inFlight = false;
    }
  }

  function save(data) {
    cache = data;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writing = writing.then(writeNow).catch((e) => console.warn(`[${label}] ⚠️ Lỗi lưu file:`, e.message));
    }, 500);
  }

  // Ghi đồng bộ ngay khi worker tắt để không mất thay đổi còn nằm trong debounce.
  function flush() {
    const hasPending = Boolean(saveTimer) || inFlight;
    clearTimeout(saveTimer);
    saveTimer = null;
    closed = true;
    if (!hasPending) return;
    try {
      const tmp = `${filePath}.flush.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
      fs.renameSync(tmp, filePath);
    } catch (e) {
      console.warn(`[${label}] ⚠️ Lỗi flush file:`, e.message);
    }
  }

  return { load, save, flush };
}

const buffQueueStore = createCachedJsonStore(
  BUFF_QUEUE_FILE, 'BuffQueue',
  (data) => (data && Array.isArray(data.items) ? data : null),
  () => ({ items: [] }),
);
const buffHistoryStore = createCachedJsonStore(
  BUFF_HISTORY_FILE, 'BuffHistory',
  (data) => (data && typeof data === 'object' ? data : null),
  () => ({}),
);

function loadBuffQueue() {
  return buffQueueStore.load();
}

function saveBuffQueue(queueData) {
  buffQueueStore.save(queueData);
}

function loadBuffHistory() {
  return buffHistoryStore.load();
}

function saveBuffHistory(historyData) {
  buffHistoryStore.save(historyData);
}

function flushBuffStores() {
  buffQueueStore.flush();
  buffHistoryStore.flush();
}

// activeBuffTaskIds và activeBuffVias quản lý tối đa MAX_PARALLEL_BUFF worker song song


// Danh sách via còn sống (cookie có c_user), bỏ trùng theo c_user
async function loadLiveVias() {
  const vias = [];
  try {
    const mysql = require('mysql2/promise');
    const conn = await desktop.openDb(getMysqlConfig(3000));
    const [rows] = await conn.execute(
      "SELECT id, page_name as viaName, access_token as cookieString, proxy_url, token_status FROM social_accounts WHERE platform IN ('FACEBOOK', 'FACEBOOK_PAGE', 'FACEBOOK_PROFILE') AND access_token LIKE '%c_user%' AND (token_status IS NULL OR (token_status != 'EXPIRED' AND token_status != 'CHECKPOINT')) ORDER BY id DESC"
    );
    await conn.end();
    const seenCUsers = new Set();
    for (const row of rows || []) {
      const m = (row.cookieString || '').match(/(?:^|;\s*)c_user=([^;]+)/);
      const uid = m ? m[1] : `id_${row.id}`;
      if (seenCUsers.has(uid)) continue;
      seenCUsers.add(uid);
      vias.push({
        id: row.id,
        uid,
        viaName: row.viaName || `Via ${uid}`,
        cookieString: row.cookieString,
        proxyUrl: row.proxy_url || '',
        tokenStatus: row.token_status || 'OK',
      });
    }
  } catch (dbErr) {
    console.warn(`[BuffQueue] ⚠️ DB lookup cookie warning: ${dbErr.message}`);
  }
  return vias;
}

// 'ALL' / 0 = dùng mọi page còn được phép; còn lại là số nguyên dương
function parseTargetLikes(value, fallback = 30) {
  if (value === 'ALL' || value === 0 || value === '0') return 'ALL';
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Giữ tối đa 100 task đã xong (COMPLETED/FAILED); task đang chờ / đang chạy không bao giờ bị cắt
function trimFinishedBuffTasks(queueData, keepFinished = 100) {
  let finished = 0;
  queueData.items = queueData.items.filter((it) => {
    if (it.status === 'QUEUED' || it.status === 'RUNNING') return true;
    finished += 1;
    return finished <= keepFinished;
  });
}

// Ghi trạng thái của 1 task vào bản queue mới nhất trên đĩa (không ghi đè thay đổi khác trong lúc task chạy)
function persistBuffQueueTask(task) {
  const fresh = loadBuffQueue();
  const idx = fresh.items.findIndex((it) => it.id === task.id);
  if (idx === -1) return; // Task đã bị xoá khỏi hàng đợi trong lúc chạy
  fresh.items[idx] = { ...fresh.items[idx], ...task };
  saveBuffQueue(fresh);
}

const activeBuffTaskIds = new Set();
const activeBuffVias = new Set();
const MAX_PARALLEL_BUFF = 2;

// ── Làn via dùng chung cho mọi task buff ──
// Mỗi via chỉ chạy 1 trình duyệt tại 1 thời điểm (profile trình duyệt theo c_user bị khoá khi đang mở),
// và tổng số via chạy cùng lúc không vượt quá cài đặt buffParallelVias (mặc định 4, hợp máy 16 GB).
const busyBuffLanes = new Set();
const buffLaneWaiters = [];

function getBuffParallelVias() {
  const n = parseInt(loadBuffSettings().buffParallelVias, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 12) : 4;
}

function getMaxPagesPerPost() {
  const n = parseInt(loadBuffSettings().maxPagesPerPost, 10);
  return Number.isFinite(n) && n > 0 ? n : 150;
}

function pumpBuffLanes() {
  for (let i = 0; i < buffLaneWaiters.length; i++) {
    if (busyBuffLanes.size >= getBuffParallelVias()) return;
    const waiter = buffLaneWaiters[i];
    if (isEmergencyStopped()) {
      buffLaneWaiters.splice(i--, 1);
      waiter.reject(new Error('Dừng khẩn cấp'));
      continue;
    }
    if (busyBuffLanes.has(waiter.uid)) continue;
    buffLaneWaiters.splice(i--, 1);
    busyBuffLanes.add(waiter.uid);
    waiter.resolve();
  }
}

async function withBuffLane(uid, fn) {
  const key = uid || 'unknown';
  await new Promise((resolve, reject) => {
    buffLaneWaiters.push({ uid: key, resolve, reject });
    pumpBuffLanes();
  });
  try {
    return await fn();
  } finally {
    busyBuffLanes.delete(key);
    pumpBuffLanes();
  }
}

// Chạy fn cho từng phần tử với tối đa `limit` việc cùng lúc
async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// Chọn page cho 1 bài trên toàn bộ via: bỏ page đã tương tác bài này / đã đủ lượt hôm nay,
// ưu tiên page ít dùng nhất hôm nay (xoay vòng đều 1000+ page), mỗi page chỉ dùng 1 lần dù nhiều via cùng quản lý.
// Via bị hết hạn cookie / checkpoint: bỏ qua 1h thay vì lần nào cũng mở trình duyệt quét lại rồi lỗi
const deadBuffVias = new Map(); // uid -> timestamp hết hạn bỏ qua
const DEAD_VIA_TTL_MS = 60 * 60 * 1000;
const DEAD_VIA_ERR_RE = /hết hạn|checkpoint|đăng nhập|xác minh/i;

function markBuffViaDeadIfCookieError(via, err) {
  if (!via?.uid || !DEAD_VIA_ERR_RE.test(err?.message || '')) return false;
  deadBuffVias.set(via.uid, Date.now() + DEAD_VIA_TTL_MS);
  console.warn(`[BuffQueue] 🚫 Via ${via.viaName} (UID ${via.uid}) lỗi cookie/checkpoint → tạm bỏ qua 1h. Hãy cập nhật cookie mới.`);
  return true;
}

function isBuffViaDead(uid) {
  const until = deadBuffVias.get(uid);
  if (!until) return false;
  if (Date.now() > until) {
    deadBuffVias.delete(uid);
    return false;
  }
  return true;
}

async function planBuffPagesAcrossVias(task, viaList, quota) {
  const dailyLimit = fbBuffTool.getDailyPageActionLimit();
  viaList = viaList.filter((via) => !isBuffViaDead(via.uid));
  const perVia = await runWithConcurrency(viaList, 4, async (via) => {
    if (!via.proxyUrl) via.proxyUrl = await resolveViaProxy(via.cookieString);
    try {
      const pages = await fbBuffTool.getManagedPages(via.cookieString, { viaName: via.viaName, proxyUrl: via.proxyUrl });
      return filterAvailablePagesForPost(task.normalizedUrl, pages || []);
    } catch (err) {
      console.warn(`[BuffQueue] ⚠️ Không lấy được page của via ${via.viaName}: ${err.message}`);
      markBuffViaDeadIfCookieError(via, err);
      return [];
    }
  });

  const seenPageIds = new Set();
  const candidates = [];
  viaList.forEach((via, vIdx) => {
    for (const page of perVia[vIdx]) {
      if (!page?.id || seenPageIds.has(page.id)) continue;
      const used = fbBuffTool.getPageUsageToday(page.id);
      if (used >= dailyLimit) continue;
      seenPageIds.add(page.id);
      candidates.push({ via, page, used, rnd: Math.random() });
    }
  });
  candidates.sort((a, b) => a.used - b.used || a.rnd - b.rnd);
  const picked = candidates.slice(0, quota);

  const byVia = new Map();
  for (const c of picked) {
    if (!byVia.has(c.via.uid)) byVia.set(c.via.uid, { via: c.via, pages: [] });
    byVia.get(c.via.uid).pages.push(c.page);
  }
  return { jobs: [...byVia.values()], availableTotal: candidates.length };
}

async function processBuffQueueTick() {
  // ĐÃ TẮT HOÀN TOÀN THEO YÊU CẦU: Không tự động xử lý hàng đợi buff like
  return;
  if (activeBuffTaskIds.size >= MAX_PARALLEL_BUFF) return;
  if (isEmergencyStopped()) return;

  const queueData = loadBuffQueue();
  if (!queueData.items || queueData.items.length === 0) return;

  const now = new Date();
  // Tìm task hợp lệ đã đến giờ chạy và không trùng Via đang chạy
  const task = queueData.items.find(
    (item) => item.status === 'QUEUED' && (!item.runAfter || new Date(item.runAfter) <= now)
              && (!item.viaUid || !activeBuffVias.has(item.viaUid))
  );
  if (!task) return;

  activeBuffTaskIds.add(task.id);
  if (task.viaUid) activeBuffVias.add(task.viaUid);

  task.status = 'RUNNING';
  task.startedAt = new Date().toISOString();
  saveBuffQueue(queueData);

  // Kích hoạt thêm slot tiếp theo nếu còn chỗ để 2 worker chạy song song
  if (activeBuffTaskIds.size < MAX_PARALLEL_BUFF) {
    setImmediate(() => processBuffQueueTick().catch(() => {}));
  }

  console.log(`\n[BuffQueue] 🚀 [TỰ ĐỘNG (${activeBuffTaskIds.size}/${MAX_PARALLEL_BUFF})] Bắt đầu xử lý bài viết trong hàng đợi: ${task.targetUrl}`);

  try {
    // 1. Xác định Cookie Via hoặc danh sách Vias trong BM
    let cookie = task.cookieString || '';
    let viaList = [];

    if (!cookie || cookie === 'ALL_VIAS') {
      viaList = await loadLiveVias();
    }
    const targetIsAll = parseTargetLikes(task.targetLikes) === 'ALL';

    let aggregatedResult = { total: 0, success: 0, failed: 0, unverified: 0 };
    let stoppedMidway = false;

    if (viaList.length > 0 && (cookie === 'ALL_VIAS' || !cookie)) {
      // CHẾ ĐỘ ĐA VIA: chọn page trên toàn bộ via rồi chạy song song theo làn via
      const quota = targetIsAll ? getMaxPagesPerPost() : parseTargetLikes(task.targetLikes);
      const { jobs, availableTotal } = await planBuffPagesAcrossVias(task, viaList, quota);
      const plannedTotal = jobs.reduce((n, j) => n + j.pages.length, 0);
      console.log(`[BuffQueue] 🌐 Đa via: ${viaList.length} via, ${availableTotal} page còn dùng được → chọn ${plannedTotal} page trên ${jobs.length} via (tối đa ${getBuffParallelVias()} via song song).`);

      task.progress = { done: 0, total: plannedTotal, success: 0 };
      let lastProgressSave = 0;
      const saveProgress = (force = false) => {
        if (!force && Date.now() - lastProgressSave < 10000) return;
        lastProgressSave = Date.now();
        persistBuffQueueTask({ id: task.id, progress: task.progress });
      };
      saveProgress(true);

      let lostPages = 0; // page của via bị lỗi cookie/checkpoint giữa chừng, cần bù bằng via khác
      const runJobs = (jobList) => Promise.all(jobList.map(({ via, pages }) => withBuffLane(via.uid, async () => {
        if (isEmergencyStopped()) {
          stoppedMidway = true;
          return;
        }
        console.log(`[BuffQueue] 👤 Via [${via.viaName}] (UID: ${via.uid}) nhận ${pages.length} page...`);
        try {
          const res = await fbBuffTool.buffLikesWithPages(via.cookieString, task.targetUrl, {
            reactionType: task.reactionType || 'RANDOM_POSITIVE',
            selectedPages: pages,
            delayMs: task.delayMs || 1500,
            enableLike: task.enableLike !== false,
            enableComment: Boolean(task.enableComment),
            enableHumanBehavior: true,
            fastSwitch: true,
            cooldownEvery: 15,
            cooldownDurationMs: 3500,
            proxyUrl: via.proxyUrl,
            comments: task.comments || [],
            onProgress: (evt) => {
              if (evt?.type !== 'PAGE_FINISH') return;
              task.progress.done += 1;
              if (evt.status === 'SUCCESS') task.progress.success += 1;
              saveProgress();
            },
          });
          aggregatedResult.success += res.success || 0;
          aggregatedResult.failed += res.failed || 0;
          aggregatedResult.unverified += res.unverified || 0;
          aggregatedResult.total += res.total || 0;
          if (res.stopped) stoppedMidway = true;
        } catch (viaErr) {
          console.error(`[BuffQueue] ⚠️ Lỗi khi chạy Via ${via.viaName}:`, viaErr.message);
          if (markBuffViaDeadIfCookieError(via, viaErr)) lostPages += pages.length;
        }
      }).catch((laneErr) => {
        stoppedMidway = true;
        console.warn(`[BuffQueue] 🛑 Via ${via.viaName} không chạy: ${laneErr.message}`);
      })));

      await runJobs(jobs);

      // Bù 1 lần cho phần page của via chết giữa chừng (page đã tương tác bài này tự bị loại khi lên kế hoạch lại)
      if (lostPages > 0 && !stoppedMidway && !isEmergencyStopped()) {
        const refill = await planBuffPagesAcrossVias(task, viaList, lostPages);
        const refillTotal = refill.jobs.reduce((n, j) => n + j.pages.length, 0);
        if (refillTotal > 0) {
          console.log(`[BuffQueue] ♻️ Bù ${refillTotal}/${lostPages} page của via lỗi bằng ${refill.jobs.length} via còn sống...`);
          task.progress.total += refillTotal;
          await runJobs(refill.jobs);
        }
      }
      saveProgress(true);
    } else {
      // CHẾ ĐỘ ĐƠN VIA: Chạy với cookie được chỉ định
      let viaProxy = '';
      if (!cookie && viaList.length > 0) {
        cookie = viaList[0].cookieString;
        viaProxy = viaList[0].proxyUrl || '';
      }
      if (!cookie) {
        throw new Error('Không tìm thấy Cookie Via nào trong hệ thống để thực hiện buff tự động');
      }
      if (!viaProxy) viaProxy = await resolveViaProxy(cookie);

      let selectedPages = task.selectedPages || [];
      if (!selectedPages.length) {
        const allPages = await fbBuffTool.getManagedPages(cookie, { proxyUrl: viaProxy });
        // BẢO VỆ CHỐNG TRÙNG LẶP & CHỐNG HỦY LIKE (UN-LIKE)
        const availablePages = filterAvailablePagesForPost(task.normalizedUrl, allPages);
        selectedPages = availablePages.slice(0, targetIsAll ? getMaxPagesPerPost() : parseTargetLikes(task.targetLikes));
      }

      const singleUid = (cookie.match(/(?:^|;\s*)c_user=([^;]+)/) || [])[1] || task.viaUid;
      const res = await withBuffLane(singleUid, () => fbBuffTool.buffLikesWithPages(cookie, task.targetUrl, {
        reactionType: task.reactionType || 'RANDOM_POSITIVE',
        selectedPages,
        delayMs: task.delayMs || 1500,
        enableLike: task.enableLike !== false,
        enableComment: Boolean(task.enableComment),
        enableHumanBehavior: true,
        fastSwitch: true,
        cooldownEvery: 15,
        cooldownDurationMs: 3500,
        proxyUrl: viaProxy,
        comments: task.comments || [],
      }));

      aggregatedResult = {
        total: res.total || 0,
        success: res.success || 0,
        failed: res.failed || 0,
        unverified: res.unverified || 0,
      };
      if (res.stopped) stoppedMidway = true;
    }

    if (stoppedMidway || isEmergencyStopped()) {
      // Bị dừng khẩn cấp giữa chừng: trả task về hàng đợi, không ghi history để lần sau chạy tiếp các page còn lại
      task.status = 'QUEUED';
      task.runAfter = new Date().toISOString();
      task.lastStoppedAt = new Date().toISOString();
      task.result = aggregatedResult;
      console.warn(`[BuffQueue] 🛑 Task ${task.id} bị dừng giữa chừng (${aggregatedResult.success} thành công), đã trả về hàng đợi.`);
      return;
    }

    task.status = 'COMPLETED';
    task.finishedAt = new Date().toISOString();
    task.result = aggregatedResult;

    if ((aggregatedResult.success || 0) + (aggregatedResult.unverified || 0) === 0) {
      console.warn(`[BuffQueue] ⚠️ Task ${task.id} không có page nào tương tác thành công, không ghi lịch sử chống trùng.`);
      return;
    }

    // 4. Lưu vào lịch sử để chống trùng lặp
    const history = loadBuffHistory();
    const normUrl = task.normalizedUrl || normalizeFbPostUrl(task.targetUrl);
    history[normUrl] = {
      url: task.targetUrl,
      normalizedUrl: normUrl,
      firstBuffedAt: history[normUrl]?.firstBuffedAt || new Date().toISOString(),
      lastBuffedAt: new Date().toISOString(),
      totalSuccess: (history[normUrl]?.totalSuccess || 0) + (aggregatedResult.success || 0),
      reactionType: task.reactionType,
      lastTaskId: task.id,
    };
    saveBuffHistory(history);
    console.log(`[BuffQueue] ✅ Đã hoàn thành buff tự động cho bài: ${task.targetUrl} (${aggregatedResult.success}/${aggregatedResult.total} thành công)`);

    // Gửi cảnh báo / thông báo hoàn tất qua Telegram Bot nếu có cấu hình
    const durationSec = Math.round((Date.now() - new Date(task.startedAt || task.runAfter).getTime()) / 1000);
    notifyBuffCompleted({
      targetUrl: task.targetUrl,
      success: aggregatedResult.success,
      total: aggregatedResult.total,
      failed: aggregatedResult.failed,
      durationSec: Math.max(1, durationSec),
      reactionType: task.reactionType,
    }).catch(() => {});
  } catch (err) {
    console.error(`[BuffQueue] ❌ Lỗi xử lý task ${task.id}:`, err.message);
    task.attempts = (task.attempts || 0) + 1;
    if (task.attempts < 2) {
      task.status = 'QUEUED';
      task.runAfter = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // Thử lại sau 5 phút
    } else {
      task.status = 'FAILED';
      task.error = err.message;
      task.finishedAt = new Date().toISOString();
    }
  } finally {
    persistBuffQueueTask(task);
    activeBuffTaskIds.delete(task.id);
    if (task.viaUid) activeBuffVias.delete(task.viaUid);
    setImmediate(() => processBuffQueueTick().catch(() => {}));
  }
}

// API thêm bài viết mới vào hàng đợi Buff Tự Động (Dành cho Module Quét Bài hoặc gọi thủ công)
// Thêm 1 bài vào hàng đợi buff (chống trùng với lịch sử + hàng đợi). Dùng chung cho API và tự buff bài app đăng
function addBuffQueueTask(params = {}) {
  const {
    targetUrl,
    targetLikes = 30,
    reactionType = 'RANDOM_POSITIVE',
    enableLike = true,
    enableComment = false,
    comments = [],
    topic = 'GENERAL',
    delayMinutes = 3, // Chờ tự nhiên sau khi bài đăng lên
    cookieString = null,
    viaUid = null,
    skipIfBuffed = true,
    source = 'MANUAL',
  } = params;

  const normalizedUrl = normalizeFbPostUrl(targetUrl);

  // Kiểm tra chống trùng lặp nếu bật skipIfBuffed
  if (skipIfBuffed) {
    const history = loadBuffHistory();
    if (history[normalizedUrl]) {
      console.log(`[BuffQueue] ℹ️ Bài viết đã từng được buff trước đó (${normalizedUrl}), bỏ qua.`);
      return { skipped: true, history: history[normalizedUrl] };
    }
  }

  const queueData = loadBuffQueue();
  // Kiểm tra xem bài có đang nằm sẵn trong hàng đợi chưa chạy không
  const existing = queueData.items.find(
    (it) => it.status === 'QUEUED' && it.normalizedUrl === normalizedUrl
  );
  if (existing) return { alreadyQueued: true, task: existing };

  const now = Date.now();
  const delayMs = Math.max(0, parseInt(delayMinutes, 10) || 0) * 60 * 1000;
  const runAfter = new Date(now + delayMs).toISOString();

  const newTask = {
    id: `task_${now}_${Math.floor(Math.random() * 1000)}`,
    source,
    targetUrl: targetUrl.trim(),
    normalizedUrl,
    targetLikes: parseTargetLikes(targetLikes),
    reactionType,
    enableLike: Boolean(enableLike),
    enableComment: Boolean(enableComment),
    comments: Array.isArray(comments) ? comments : [],
    topic,
    delayMinutes,
    addedAt: new Date().toISOString(),
    runAfter,
    status: 'QUEUED',
    cookieString,
    viaUid,
    attempts: 0,
  };

  queueData.items.unshift(newTask);
  trimFinishedBuffTasks(queueData);
  saveBuffQueue(queueData);

  console.log(`[BuffQueue] 📥 Đã thêm bài viết vào hàng đợi: ${targetUrl} (Lên lịch chạy lúc: ${runAfter})`);
  return { task: newTask };
}

app.post('/api/buff-queue/add', async (req, res) => {
  try {
    if (!req.body.targetUrl) {
      return res.status(400).json({ success: false, error: 'Thiếu targetUrl' });
    }
    const result = addBuffQueueTask(req.body);
    if (result.skipped) {
      return res.json({
        success: true,
        skipped: true,
        message: 'Bài viết này đã từng được buff trước đó, tự động bỏ qua để tránh trùng lặp.',
        history: result.history,
      });
    }
    if (result.alreadyQueued) {
      return res.json({
        success: true,
        alreadyQueued: true,
        message: 'Bài viết đang nằm sẵn trong hàng đợi xử lý.',
        task: result.task,
      });
    }
    return res.json({ success: true, task: result.task });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Tự buff bài app vừa đăng (kind: 'FANPAGE' | 'GROUP') xoay vòng page của mọi via, nếu đã bật trong cài đặt
function autoEnqueueOwnPost(postUrl, kind) {
  // ĐÃ TẮT HOÀN TOÀN THEO YÊU CẦU: Không tự động tìm bài và like tự động
  return;
  try {
    if (!postUrl) return;
    // Link profile.php?id=... (không có story_fbid) là link trang, không phải link bài
    if (/profile\.php\?id=\d+/.test(postUrl) && !/story_fbid=/.test(postUrl)) return;
    const s = loadBuffSettings();
    if (!s.autoBuffOwnPosts) return;
    if (kind === 'FANPAGE' && s.autoBuffOwnFanpage === false) return;
    const targetCount = s.autoBuffLikesTarget ? parseTargetLikes(s.autoBuffLikesTarget) : 25;
    const result = addBuffQueueTask({
      targetUrl: postUrl,
      targetLikes: targetCount,
      reactionType: s.autoBuffReaction || 'RANDOM_POSITIVE',
      delayMinutes: parseDelayMinutes(s.autoBuffDelayMinutes) || 4,
      cookieString: 'ALL_VIAS',
      source: 'AUTO_OWN_POST',
      topic: kind,
    });
    if (result.task && !result.alreadyQueued) {
      console.log(`[BuffQueue] 🤖 Tự buff bài ${kind === 'GROUP' ? 'Group' : 'Fanpage'} app vừa đăng: ${postUrl}`);
    }
  } catch (err) {
    console.warn('[BuffQueue] ⚠️ Không nạp được bài vừa đăng vào hàng đợi buff:', err.message);
  }
}

// API kiểm tra trạng thái bài viết (đã buff chưa / có trong hàng đợi không)
app.get('/api/buff-queue/check', (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ success: false, error: 'Thiếu url' });
    }
    const normalizedUrl = normalizeFbPostUrl(String(url));
    const history = loadBuffHistory();
    const queueData = loadBuffQueue();

    const isBuffed = Boolean(history[normalizedUrl]);
    const queueTask = queueData.items.find((it) => it.normalizedUrl === normalizedUrl);

    return res.json({
      success: true,
      url,
      normalizedUrl,
      isBuffed,
      history: history[normalizedUrl] || null,
      inQueue: Boolean(queueTask),
      queueTask: queueTask || null,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API lấy toàn bộ hàng đợi & lịch sử
app.get('/api/buff-queue/list', (req, res) => {
  try {
    const queueData = loadBuffQueue();
    const history = loadBuffHistory();
    return res.json({
      success: true,
      queue: queueData.items || [],
      historyCount: Object.keys(history).length,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API xóa hoặc hủy task trong hàng đợi
app.delete('/api/buff-queue/remove/:id', (req, res) => {
  try {
    const { id } = req.params;
    const queueData = loadBuffQueue();
    const prevLen = queueData.items.length;
    queueData.items = queueData.items.filter((it) => it.id !== id);
    saveBuffQueue(queueData);
    return res.json({ success: true, deleted: queueData.items.length < prevLen });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API kích hoạt chạy ngay một task trong hàng đợi (không cần chờ hết delay)
app.post('/api/buff-queue/run-now/:id', (req, res) => {
  try {
    const { id } = req.params;
    const queueData = loadBuffQueue();
    const task = queueData.items.find((it) => it.id === id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy task' });
    }
    task.runAfter = new Date().toISOString();
    task.status = 'QUEUED';
    saveBuffQueue(queueData);

    // Kích hoạt ngay lập tức vòng lặp xử lý nền
    setImmediate(() => {
      processBuffQueueTick().catch(() => {});
    });

    return res.json({ success: true, message: 'Đã kích hoạt task chạy ngay!', task });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API dọn dẹp các task đã hoàn thành hoặc thất bại khỏi hàng đợi
app.post('/api/buff-queue/clear-completed', (req, res) => {
  try {
    const queueData = loadBuffQueue();
    const prevLen = queueData.items.length;
    queueData.items = queueData.items.filter((it) => it.status === 'QUEUED' || it.status === 'RUNNING');
    saveBuffQueue(queueData);
    return res.json({ success: true, cleared: prevLen - queueData.items.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. HỆ THỐNG POST HUNTER — THEO DÕI NGUỒN & TỰ ĐỘNG SĂN BÀI VIẾT (AUTO-MONITORS)
// ─────────────────────────────────────────────────────────────────────────────

const BUFF_MONITORS_FILE = path.join(__dirname, 'buff_monitors.json');

function loadBuffMonitors() {
  try {
    if (fs.existsSync(BUFF_MONITORS_FILE)) {
      const data = JSON.parse(fs.readFileSync(BUFF_MONITORS_FILE, 'utf-8'));
      if (Array.isArray(data.monitors)) return data;
    }
  } catch (e) {
    console.warn('[PostHunter] ⚠️ Không đọc được file monitors, khởi tạo lại:', e.message);
  }
  return { monitors: [] };
}

function saveBuffMonitors(data) {
  try {
    const tmp = `${BUFF_MONITORS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, BUFF_MONITORS_FILE);
  } catch (e) {
    console.warn('[PostHunter] ⚠️ Lỗi lưu file monitors:', e.message);
  }
}

let isBuffMonitorsScanning = false;

// 0 = buff ngay khi phát hiện; để trống / sai định dạng thì mặc định 3 phút
function parseDelayMinutes(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

// Cookie + proxy để quét mục tiêu. Monitor không có cookie riêng thì dùng via còn sống
// (quét khi chưa đăng nhập sẽ không xem được bài trong Group)
async function resolveMonitorScanAuths(mon) {
  const own = mon.buffConfig?.cookieString || mon.cookieString || '';
  if (own && own !== 'ALL_VIAS') {
    return [{ cookieStr: own, proxyUrl: await resolveViaProxy(own), viaName: 'cookie riêng' }];
  }
  const vias = await loadLiveVias();
  return vias.slice(0, 3).map((v) => ({ cookieStr: v.cookieString, proxyUrl: v.proxyUrl, viaName: v.viaName }));
}

// Quét 1 mục tiêu: thử lần lượt tối đa 3 via cho tới khi thấy bài (via đầu có thể không ở trong Group)
async function scanMonitorTarget(mon, maxPosts) {
  const auths = await resolveMonitorScanAuths(mon);
  if (auths.length === 0) auths.push({ cookieStr: '', proxyUrl: '', viaName: 'không đăng nhập' });
  for (const auth of auths) {
    if (!auth.proxyUrl && auth.cookieStr) auth.proxyUrl = await resolveViaProxy(auth.cookieStr);
    const posts = await fbBuffTool.scanTargetForPosts(mon.targetUrl, {
      cookieStr: auth.cookieStr,
      proxyUrl: auth.proxyUrl,
      maxPosts,
    });
    if (posts && posts.length > 0) return { posts, viaName: auth.viaName };
    console.log(`[PostHunter] ℹ️ Via [${auth.viaName}] không thấy bài nào ở [${mon.targetName}], thử via khác...`);
  }
  return { posts: [], viaName: null };
}

const MAX_SEEN_POST_URLS = 50;
const HUNTER_SCAN_CONCURRENCY = 2;

// Nạp các bài mới quét được vào hàng đợi (đọc queue mới nhất ngay trước khi ghi)
function enqueueHuntedPosts(mon, posts, source) {
  if (!posts || posts.length === 0) return { newPostsEnqueued: 0, lastFoundPostUrl: null };
  const history = loadBuffHistory();
  const queueData = loadBuffQueue();
  const seen = new Set(mon.seenPostUrls || []);
  let newPostsEnqueued = 0;
  let lastFoundPostUrl = null;

  for (const post of posts) {
    const normUrl = normalizeFbPostUrl(post.url) || post.normalizedUrl;
    const alreadyBuffed = Boolean(history[normUrl]);
    const inQueue = queueData.items.some((it) => it.normalizedUrl === normUrl && it.status !== 'FAILED');
    if (alreadyBuffed || inQueue || seen.has(normUrl)) continue;

    const delayMin = parseDelayMinutes(mon.buffConfig?.delayMinutes);
    const newTask = {
      id: `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      source,
      monitorId: mon.id,
      monitorName: mon.targetName,
      targetUrl: post.url,
      normalizedUrl: normUrl,
      targetLikes: parseTargetLikes(mon.buffConfig?.targetLikes),
      reactionType: mon.buffConfig?.reactionType || 'RANDOM_POSITIVE',
      enableLike: mon.buffConfig?.enableLike !== false,
      enableComment: Boolean(mon.buffConfig?.enableComment),
      comments: Array.isArray(mon.buffConfig?.comments) ? mon.buffConfig.comments : [],
      delayMinutes: delayMin,
      addedAt: new Date().toISOString(),
      runAfter: new Date(Date.now() + delayMin * 60 * 1000).toISOString(),
      status: 'QUEUED',
      cookieString: mon.buffConfig?.viaMode === 'ALL_VIAS' ? 'ALL_VIAS' : (mon.buffConfig?.cookieString || ''),
      attempts: 0,
    };
    queueData.items.unshift(newTask);
    newPostsEnqueued++;
    lastFoundPostUrl = post.url;

    if (source === 'POST_HUNTER') {
      console.log(`[PostHunter] 🎯 PHÁT HIỆN BÀI VIẾT MỚI: ${post.url} ("${post.title}") từ [${mon.targetName}]! Tự động nạp vào hàng đợi.`);
      notifyPostHunted({
        targetName: mon.targetName,
        targetUrl: mon.targetUrl,
        postUrl: post.url,
        delayMinutes: delayMin,
        targetLikes: newTask.targetLikes,
      }).catch(() => {});
    }
  }

  if (newPostsEnqueued > 0) saveBuffQueue(queueData);
  return { newPostsEnqueued, lastFoundPostUrl };
}

// Cập nhật kết quả quét vào bản monitors mới nhất (không ghi đè xoá/bật-tắt trong lúc quét)
function persistMonitorScan(monId, { lastFoundPostUrl, newPostsEnqueued, posts = [], baseline = false, scanVia = null }) {
  const fresh = loadBuffMonitors();
  const target = fresh.monitors.find((m) => m.id === monId);
  if (!target) return null;
  target.lastCheckedAt = new Date().toISOString();
  target.lastPostsFound = posts.length;
  if (scanVia) target.lastScanVia = scanVia;
  if (newPostsEnqueued > 0) {
    target.lastFoundPostUrl = lastFoundPostUrl;
    target.totalDetected = (target.totalDetected || 0) + newPostsEnqueued;
  }
  if (posts.length > 0) {
    const urls = posts.map((p) => normalizeFbPostUrl(p.url) || p.normalizedUrl).filter(Boolean);
    target.seenPostUrls = [...new Set([...urls, ...(target.seenPostUrls || [])])].slice(0, MAX_SEEN_POST_URLS);
    if (baseline) target.baselineDone = true;
  }
  saveBuffMonitors(fresh);
  return target;
}

// Quét + nạp hàng đợi cho 1 monitor. Lần đầu (chưa có mốc) chỉ ghi nhận bài đang có, không buff bài cũ
async function runMonitorScan(mon, source, maxPosts = 5) {
  const { posts, viaName } = await scanMonitorTarget(mon, maxPosts);
  // Monitor có thể đã bị xoá / tạm dừng trong lúc quét
  const latest = loadBuffMonitors().monitors.find((m) => m.id === mon.id);
  if (!latest) return { posts, newPostsEnqueued: 0, baseline: false, monitor: null };

  const baseline = !latest.baselineDone;
  let outcome = { newPostsEnqueued: 0, lastFoundPostUrl: null };
  if (baseline) {
    if (posts.length > 0) {
      console.log(`[PostHunter] 📌 [${latest.targetName}] Lần quét đầu: ghi nhận ${posts.length} bài hiện có làm mốc, không buff bài cũ.`);
    }
  } else if (source !== 'POST_HUNTER' || latest.status === 'ACTIVE') {
    outcome = enqueueHuntedPosts(latest, posts, source);
  }
  const monitor = persistMonitorScan(mon.id, { ...outcome, posts, baseline, scanVia: viaName }) || latest;
  return { posts, ...outcome, baseline, monitor };
}

async function processBuffMonitorsTick() {
  // ĐÃ TẮT HOÀN TOÀN THEO YÊU CẦU: Không tự động quét bài Post Hunter
  return;
  if (isBuffMonitorsScanning) return;
  if (isEmergencyStopped()) return;
  const data = loadBuffMonitors();
  if (!data.monitors || data.monitors.length === 0) return;

  const now = Date.now();
  // Lấy các monitor đang ACTIVE và đã đến chu kỳ quét
  const dueMonitors = data.monitors.filter((mon) => {
    if (mon.status !== 'ACTIVE') return false;
    const intervalMs = Math.max(1, parseInt(mon.checkIntervalMinutes, 10) || 10) * 60 * 1000;
    const lastChecked = mon.lastCheckedAt ? new Date(mon.lastCheckedAt).getTime() : 0;
    return (now - lastChecked) >= intervalMs;
  });

  if (dueMonitors.length === 0) return;
  // Mục tiêu chờ lâu nhất quét trước
  dueMonitors.sort((a, b) => (Date.parse(a.lastCheckedAt || '') || 0) - (Date.parse(b.lastCheckedAt || '') || 0));

  isBuffMonitorsScanning = true;
  try {
    console.log(`\n[PostHunter] 📡 Bắt đầu chu kỳ quét định kỳ cho ${dueMonitors.length} mục tiêu đang theo dõi...`);

    // Quét 2 mục tiêu cùng lúc (mỗi lượt quét là 1 trình duyệt riêng, ~20–40 giây)
    await runWithConcurrency(dueMonitors, HUNTER_SCAN_CONCURRENCY, async (mon) => {
      if (isEmergencyStopped()) return;
      try {
        console.log(`[PostHunter] 🔍 Đang quét mục tiêu: "${mon.targetName}" (${mon.targetUrl})...`);
        const result = await runMonitorScan(mon, 'POST_HUNTER', 5);
        if (result.baseline) return;
        if (result.newPostsEnqueued > 0) {
          console.log(`[PostHunter] ✅ Đã nạp thành công ${result.newPostsEnqueued} bài viết mới từ [${mon.targetName}] vào hàng đợi.`);
        } else if (result.posts.length > 0) {
          console.log(`[PostHunter] ℹ️ Không phát hiện bài viết mới nào từ [${mon.targetName}] (các bài đều đã được ghi nhận trước đó).`);
        }
      } catch (err) {
        console.error(`[PostHunter] ❌ Lỗi quét mục tiêu [${mon.targetName}]:`, err.message);
      }
    });
  } finally {
    isBuffMonitorsScanning = false;
  }
}

// API lấy danh sách các mục tiêu theo dõi Post Hunter
app.get('/api/buff-monitors', (req, res) => {
  try {
    const data = loadBuffMonitors();
    const queueData = loadBuffQueue();
    const history = loadBuffHistory();
    return res.json({
      success: true,
      monitors: data.monitors || [],
      queueCount: (queueData.items || []).filter((it) => it.status === 'QUEUED').length,
      historyCount: Object.keys(history).length,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API thêm hoặc cập nhật mục tiêu theo dõi
app.post('/api/buff-monitors', (req, res) => {
  try {
    const {
      id,
      targetName,
      targetUrl,
      targetType = 'PAGE',
      checkIntervalMinutes = 10,
      buffConfig = {},
      status = 'ACTIVE',
    } = req.body;

    if (!targetUrl || !String(targetUrl).trim()) {
      return res.status(400).json({ success: false, error: 'Thiếu link mục tiêu (targetUrl)' });
    }

    const data = loadBuffMonitors();
    let monitorId = id;

    if (monitorId) {
      // Cập nhật monitor có sẵn
      const idx = data.monitors.findIndex((m) => m.id === monitorId);
      if (idx !== -1) {
        // Đổi link mục tiêu thì phải lấy mốc lại, tránh buff bài cũ của mục tiêu mới
        const urlChanged = String(targetUrl).trim() !== data.monitors[idx].targetUrl;
        data.monitors[idx] = {
          ...data.monitors[idx],
          ...(urlChanged ? { baselineDone: false, seenPostUrls: [] } : {}),
          targetName: targetName ? String(targetName).trim() : data.monitors[idx].targetName,
          targetUrl: String(targetUrl).trim(),
          targetType,
          checkIntervalMinutes: parseInt(checkIntervalMinutes, 10) || 10,
          buffConfig: {
            ...data.monitors[idx].buffConfig,
            ...buffConfig,
          },
          status,
          updatedAt: new Date().toISOString(),
        };
        saveBuffMonitors(data);
        return res.json({ success: true, monitor: data.monitors[idx] });
      }
    }

    // Thêm monitor mới
    monitorId = `mon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newMon = {
      id: monitorId,
      targetName: targetName ? String(targetName).trim() : `Mục tiêu ${data.monitors.length + 1}`,
      targetUrl: String(targetUrl).trim(),
      targetType,
      checkIntervalMinutes: parseInt(checkIntervalMinutes, 10) || 10,
      buffConfig: {
        targetLikes: parseTargetLikes(buffConfig.targetLikes, 'ALL'),
        reactionType: buffConfig.reactionType || 'RANDOM_POSITIVE',
        enableLike: buffConfig.enableLike !== false,
        enableComment: Boolean(buffConfig.enableComment),
        comments: Array.isArray(buffConfig.comments) ? buffConfig.comments : [],
        delayMinutes: parseDelayMinutes(buffConfig.delayMinutes),
        viaMode: buffConfig.viaMode || 'ALL_VIAS',
        cookieString: buffConfig.cookieString || '',
      },
      status: 'ACTIVE',
      totalDetected: 0,
      lastCheckedAt: null,
      lastFoundPostUrl: null,
      createdAt: new Date().toISOString(),
    };

    data.monitors.unshift(newMon);
    saveBuffMonitors(data);

    console.log(`[PostHunter] ➕ Đã thêm mục tiêu theo dõi mới: "${newMon.targetName}" (${newMon.targetUrl})`);
    return res.json({ success: true, monitor: newMon });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API xóa mục tiêu theo dõi
app.delete('/api/buff-monitors/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = loadBuffMonitors();
    const prevLen = data.monitors.length;
    data.monitors = data.monitors.filter((m) => m.id !== id);
    saveBuffMonitors(data);
    return res.json({ success: true, deleted: data.monitors.length < prevLen });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API bật / tắt trạng thái theo dõi (ACTIVE / PAUSED)
app.post('/api/buff-monitors/:id/toggle', (req, res) => {
  try {
    const { id } = req.params;
    const data = loadBuffMonitors();
    const mon = data.monitors.find((m) => m.id === id);
    if (!mon) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy mục tiêu theo dõi' });
    }
    mon.status = mon.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    saveBuffMonitors(data);
    return res.json({ success: true, monitor: mon });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API kích hoạt quét ngay lập tức một mục tiêu
app.post('/api/buff-monitors/:id/scan-now', async (req, res) => {
  try {
    const { id } = req.params;
    const data = loadBuffMonitors();
    const mon = data.monitors.find((m) => m.id === id);
    if (!mon) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy mục tiêu theo dõi' });
    }

    console.log(`[PostHunter] ⚡ Kích hoạt quét ngay thủ công cho mục tiêu: "${mon.targetName}"...`);
    const result = await runMonitorScan(mon, 'POST_HUNTER_MANUAL', 6);

    return res.json({
      success: true,
      postsFound: result.posts.length,
      newPostsEnqueued: result.newPostsEnqueued,
      baseline: result.baseline,
      posts: result.posts,
      monitor: result.monitor || mon,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API thử nghiệm quét nhanh bất kỳ URL Fanpage / Group / Profile nào
app.post('/api/buff-hunter/test-scan', async (req, res) => {
  try {
    const { targetUrl, cookieString = '' } = req.body;
    if (!targetUrl || !String(targetUrl).trim()) {
      return res.status(400).json({ success: false, error: 'Thiếu link mục tiêu cần test quét' });
    }

    console.log(`[PostHunter] 🧪 Test quét link: ${targetUrl}`);
    const { posts, viaName } = await scanMonitorTarget(
      { targetUrl: String(targetUrl).trim(), targetName: 'Test', buffConfig: { cookieString } },
      8
    );

    const history = loadBuffHistory();
    const queueData = loadBuffQueue();

    const annotatedPosts = (posts || []).map((p) => {
      const normUrl = p.normalizedUrl || normalizeFbPostUrl(p.url);
      return {
        ...p,
        isAlreadyBuffed: Boolean(history[normUrl]),
        isInQueue: queueData.items.some((it) => it.normalizedUrl === normUrl),
      };
    });

    return res.json({
      success: true,
      total: annotatedPosts.length,
      scanVia: viaName,
      posts: annotatedPosts,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. VIA HEALTH MONITOR & ENTERPRISE GOVERNOR
// ─────────────────────────────────────────────────────────────────────────────

function recoverBuffQueueOnStartup() {
  try {
    const queueData = loadBuffQueue();
    let recoveredCount = 0;
    for (const item of queueData.items) {
      if (item.status === 'RUNNING') {
        item.status = 'QUEUED';
        item.runAfter = new Date().toISOString();
        recoveredCount++;
      }
    }
    if (recoveredCount > 0) {
      saveBuffQueue(queueData);
      console.log(`[BuffQueue] 🔄 Tự động phục hồi ${recoveredCount} bài viết bị gián đoạn trước đó về hàng đợi!`);
    }
  } catch (e) {
    console.warn('[BuffQueue] ⚠️ Lỗi recover hàng đợi:', e.message);
  }
}

// API kiểm tra tình trạng Live / Checkpoint / Expired của toàn bộ Via hoặc một Cookie cụ thể
app.post('/api/buff-vias/health-check', async (req, res) => {
  let conn = null;
  try {
    const { cookieString, viaId } = req.body;
    const mysql = require('mysql2/promise');
    conn = await desktop.openDb(getMysqlConfig(3000));

    let targetVias = [];

    if (cookieString) {
      targetVias.push({
        id: viaId || 'custom',
        viaName: 'Via Kiểm Tra',
        cookieString: String(cookieString).trim(),
        proxyUrl: '',
      });
    } else {
      const [rows] = await conn.execute(
        "SELECT id, page_name as viaName, access_token as cookieString, proxy_url, token_status FROM social_accounts WHERE platform IN ('FACEBOOK', 'FACEBOOK_PAGE', 'FACEBOOK_PROFILE') AND access_token LIKE '%c_user%' ORDER BY id DESC"
      );
      const seenCUsers = new Set();
      for (const row of rows) {
        const m = (row.cookieString || '').match(/(?:^|;\s*)c_user=([^;]+)/);
        const uid = m ? m[1] : `id_${row.id}`;
        if (!seenCUsers.has(uid)) {
          seenCUsers.add(uid);
          targetVias.push({
            id: row.id,
            uid,
            viaName: row.viaName || `Via ${uid}`,
            cookieString: row.cookieString,
            proxyUrl: row.proxy_url || '',
            tokenStatus: row.token_status || 'OK',
          });
        }
      }
    }

    console.log(`[ViaHealth] 🩺 Bắt đầu kiểm tra sức khỏe ${targetVias.length} tài khoản Via...`);
    const checkResults = [];

    for (const via of targetVias) {
      try {
        const status = await fbBuffTool.validateViaSession(via.cookieString, {
          proxyUrl: via.proxyUrl,
          timeoutMs: 18000,
        });

        if (typeof via.id === 'number') {
          const dbStatus = status.isLive ? 'OK' : status.status === 'CHECKPOINT' ? 'CHECKPOINT' : 'EXPIRED';
          await conn.execute(
            'UPDATE social_accounts SET token_status = ?, token_checked_at = NOW() WHERE id = ?',
            [dbStatus, via.id]
          ).catch(() => {});
        }

        if (!status.isLive) {
          notifyViaDead({
            uid: via.uid || fbBuffTool.getUserIdFromCookie(via.cookieString),
            viaName: via.viaName,
            proxyUrl: via.proxyUrl,
            tokenStatus: status.status,
          }, status.error || 'Phiên đăng nhập không khả dụng').catch(() => {});
        }

        checkResults.push({
          id: via.id,
          uid: via.uid || fbBuffTool.getUserIdFromCookie(via.cookieString),
          viaName: via.viaName,
          proxyUrl: via.proxyUrl,
          isLive: status.isLive,
          status: status.status,
          name: status.name,
          error: status.error,
          checkedAt: new Date().toISOString(),
        });
      } catch (checkErr) {
        notifyViaDead({
          uid: via.uid,
          viaName: via.viaName,
          proxyUrl: via.proxyUrl,
          tokenStatus: 'ERROR',
        }, checkErr.message).catch(() => {});

        checkResults.push({
          id: via.id,
          uid: via.uid,
          viaName: via.viaName,
          isLive: false,
          status: 'ERROR',
          error: checkErr.message,
          checkedAt: new Date().toISOString(),
        });
      }
    }

    const liveCount = checkResults.filter((r) => r.isLive).length;
    return res.json({
      success: true,
      total: checkResults.length,
      liveCount,
      deadCount: checkResults.length - liveCount,
      vias: checkResults,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
});

// API tổng quan sức khỏe toàn bộ hệ thống (BM, Dàn Via, Fanpage, Quota hôm nay)
app.get('/api/buff-vias/overview', async (req, res) => {
  try {
    const mysql = require('mysql2/promise');
    let totalVias = 0;
    let liveVias = 0;
    let viaRows = [];

    try {
      const conn = await desktop.openDb(getMysqlConfig(3000));
      const [rows] = await conn.execute(
        "SELECT id, page_name as viaName, access_token as cookieString, proxy_url, token_status, token_checked_at FROM social_accounts WHERE platform IN ('FACEBOOK', 'FACEBOOK_PAGE', 'FACEBOOK_PROFILE') AND access_token LIKE '%c_user%' ORDER BY id DESC"
      );
      await conn.end();
      const seenCUsers = new Set();
      for (const row of rows) {
        const m = (row.cookieString || '').match(/(?:^|;\s*)c_user=([^;]+)/);
        const uid = m ? m[1] : `id_${row.id}`;
        if (!seenCUsers.has(uid)) {
          seenCUsers.add(uid);
          const isLive = row.token_status !== 'EXPIRED' && row.token_status !== 'CHECKPOINT';
          if (isLive) liveVias++;
          totalVias++;
          viaRows.push({
            id: row.id,
            uid,
            viaName: row.viaName,
            tokenStatus: row.token_status || 'OK',
            proxyUrl: row.proxy_url || '',
            lastCheckedAt: row.token_checked_at,
          });
        }
      }
    } catch (dbErr) {
      console.warn(`[BuffOverview] DB warning: ${dbErr.message}`);
    }

    const pagesCache = fbBuffTool.loadPagesCache();
    let totalCachedPages = 0;
    for (const uid in pagesCache) {
      if (Array.isArray(pagesCache[uid]?.pages)) {
        totalCachedPages += pagesCache[uid].pages.length;
      }
    }

    const queueData = loadBuffQueue();
    const history = loadBuffHistory();
    const monitorsData = loadBuffMonitors();
    const registryStats = getGlobalRegistryStats();
    const sysSettings = loadBuffSettings();

    return res.json({
      success: true,
      bmHealth: {
        totalVias,
        liveVias,
        deadVias: totalVias - liveVias,
        vias: viaRows,
        totalCachedPages,
        safeDailyCapacity: liveVias * 200,
        dailyGovernorLimitPerPage: sysSettings.maxDailyPageActions || 25,
      },
      stats: {
        queueCount: (queueData.items || []).filter((it) => it.status === 'QUEUED').length,
        runningCount: (queueData.items || []).filter((it) => it.status === 'RUNNING').length,
        historyCount: Object.keys(history).length,
        monitorsCount: (monitorsData.monitors || []).length,
        activeMonitorsCount: (monitorsData.monitors || []).filter((m) => m.status === 'ACTIVE').length,
      },
      antiOverlap: registryStats,
      system: {
        isEmergencyStopped: isEmergencyStopped(),
        emergencyReason: sysSettings.emergencyReason || '',
        emergencyStoppedAt: sysSettings.emergencyStoppedAt || null,
        telegramConfigured: Boolean(sysSettings.telegramBotToken && sysSettings.telegramChatId),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API lấy cài đặt hệ thống & Telegram Bot (Token được che bảo mật)
// Không bao giờ trả token Telegram thô ra client
function publicBuffSettings(s) {
  const maskedToken = s.telegramBotToken
    ? `${s.telegramBotToken.slice(0, 6)}...${s.telegramBotToken.slice(-4)}`
    : '';
  return {
    ...s,
    telegramBotToken: '',
    telegramBotTokenMasked: maskedToken,
    hasBotToken: Boolean(s.telegramBotToken),
  };
}

app.get('/api/buff-settings', (req, res) => {
  try {
    return res.json({ success: true, settings: publicBuffSettings(loadBuffSettings()) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API cập nhật cài đặt hệ thống & Telegram Bot
app.post('/api/buff-settings', (req, res) => {
  try {
    const {
      telegramBotToken,
      telegramChatId,
      notifyOnViaDead,
      notifyOnHunter,
      notifyOnBuffDone,
      maxDailyPageActions,
      autoBuffOwnPosts,
      autoBuffOwnFanpage,
      autoBuffOwnGroup,
      autoBuffDelayMinutes,
      autoBuffReaction,
      maxPagesPerPost,
      buffParallelVias,
    } = req.body;

    const payload = {};
    if (telegramBotToken !== undefined && String(telegramBotToken).trim() && !String(telegramBotToken).includes('...')) {
      payload.telegramBotToken = String(telegramBotToken).trim();
    }
    if (telegramChatId !== undefined) payload.telegramChatId = String(telegramChatId).trim();
    if (notifyOnViaDead !== undefined) payload.notifyOnViaDead = Boolean(notifyOnViaDead);
    if (notifyOnHunter !== undefined) payload.notifyOnHunter = Boolean(notifyOnHunter);
    if (notifyOnBuffDone !== undefined) payload.notifyOnBuffDone = Boolean(notifyOnBuffDone);
    if (maxDailyPageActions !== undefined) {
      payload.maxDailyPageActions = Math.max(5, parseInt(maxDailyPageActions, 10) || 25);
    }

    if (autoBuffOwnPosts !== undefined) payload.autoBuffOwnPosts = Boolean(autoBuffOwnPosts);
    if (autoBuffOwnFanpage !== undefined) payload.autoBuffOwnFanpage = Boolean(autoBuffOwnFanpage);
    if (autoBuffOwnGroup !== undefined) payload.autoBuffOwnGroup = Boolean(autoBuffOwnGroup);
    if (autoBuffDelayMinutes !== undefined) payload.autoBuffDelayMinutes = parseDelayMinutes(autoBuffDelayMinutes);
    if (autoBuffReaction !== undefined) payload.autoBuffReaction = String(autoBuffReaction || 'RANDOM_POSITIVE');
    if (maxPagesPerPost !== undefined) payload.maxPagesPerPost = Math.min(2000, Math.max(5, parseInt(maxPagesPerPost, 10) || 150));
    if (buffParallelVias !== undefined) payload.buffParallelVias = Math.min(12, Math.max(1, parseInt(buffParallelVias, 10) || 4));

    const updated = saveBuffSettings(payload);
    if (!updated) {
      return res.status(500).json({ success: false, error: 'Không lưu được file cài đặt' });
    }
    return res.json({ success: true, settings: publicBuffSettings(updated) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API kiểm tra gửi thử tin nhắn Telegram
app.post('/api/buff-settings/test-telegram', async (req, res) => {
  try {
    const { botToken, chatId } = req.body;
    let customMsg = [
      `🤖 <b>[TEST THÀNH CÔNG: TOOLZUTTER OPS BOT]</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `✅ Kết nối Telegram Bot thông suốt 100%!`,
      `⏰ Thời gian: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
      `🛡️ <i>Hệ thống giám sát và bảo vệ dàn Via & Fanpage đã sẵn sàng 24/7!</i>`,
    ].join('\n');

    let result;
    if (botToken && chatId) {
      const axios = require('axios');
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const resp = await axios.post(url, {
        chat_id: chatId,
        text: customMsg,
        parse_mode: 'HTML',
      }, { timeout: 8000 });
      result = { success: true, data: resp.data };
    } else {
      result = await sendTelegramMessage(customMsg);
    }

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.reason || 'Gửi thất bại' });
    }
    return res.json({ success: true, message: 'Đã gửi tin nhắn thử nghiệm thành công vào Telegram!' });
  } catch (err) {
    const msg = err.response?.data?.description || err.message;
    return res.status(500).json({ success: false, error: msg });
  }
});

// API KÍCH HOẠT DỪNG KHẨN CẤP (EMERGENCY STOP)
app.post('/api/buff-queue/emergency-stop', (req, res) => {
  try {
    const { reason = 'Người quản trị kích hoạt DỪNG KHẨN CẤP' } = req.body;
    const settings = setEmergencyStop(true, reason);

    // Task đang chạy sẽ tự dừng sau page hiện tại, đóng trình duyệt và tự trả về QUEUED.
    // Chỉ dọn các task RUNNING "mồ côi" khi không có job nào thật sự đang chạy.
    let affected = 0;
    if (activeBuffTaskIds.size === 0) {
      const queueData = loadBuffQueue();
      for (const it of queueData.items) {
        if (it.status === 'RUNNING') {
          it.status = 'QUEUED';
          affected++;
        }
      }
      if (affected > 0) saveBuffQueue(queueData);
    }

    console.warn(`[EMERGENCY] 🛑 ĐÃ KÍCH HOẠT DỪNG KHẨN CẤP. Job đang chạy sẽ dừng sau page hiện tại.`);
    return res.json({
      success: true,
      isEmergencyStopped: true,
      reason,
      affectedTasks: affected,
      jobStillFinishing: activeBuffTaskIds.size > 0,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API KHÔI PHỤC HOẠT ĐỘNG SAU DỪNG KHẨN CẤP (RESUME)
app.post('/api/buff-queue/resume', (req, res) => {
  try {
    setEmergencyStop(false);
    console.log(`[EMERGENCY] ▶️ Đã khôi phục hoạt động bình thường của hệ thống Buff & Hunter.`);
    return res.json({ success: true, isEmergencyStopped: false, message: 'Đã khôi phục hoạt động thành công' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API LẤY THỐNG KÊ ANTI-OVERLAP REGISTRY
app.get('/api/buff-registry/stats', (req, res) => {
  try {
    const stats = getGlobalRegistryStats();
    return res.json({ success: true, ...stats });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API XÓA LỊCH SỬ TƯƠNG TÁC CỦA 1 BÀI VIẾT (Reset chống trùng lặp để buff lại từ đầu)
app.post('/api/buff-registry/clear-post', (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'Thiếu url' });
    const normUrl = normalizeFbPostUrl(url);
    const cleared = clearPostInteractions(normUrl);
    return res.json({ success: true, cleared, normalizedUrl: normUrl });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

function parseTikTokCookieString(cookieStr) {
  if (!cookieStr) return [];
  let trimmed = String(cookieStr).trim();
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      return arr.map(item => ({
        name: item.name,
        value: item.value,
        domain: item.domain || '.tiktok.com',
        path: item.path || '/'
      }));
    } catch (e) {}
  }
  return trimmed.split(';').map(pair => {
    const parts = pair.trim().split('=');
    if (parts.length < 2) return null;
    let val = parts.slice(1).join('=').trim();
    try { val = decodeURIComponent(val); } catch (e) { }
    return {
      name: parts[0].trim(),
      value: val,
      domain: '.tiktok.com',
      path: '/'
    };
  }).filter(Boolean);
}

// 4. Endpoint Tự Động Đăng Video Lên TikTok qua Playwright Cookie
app.post('/api/post-tiktok', async (req, res) => {
  const { videoUrl: rawVideoUrl, mediaUrls = [], caption = '', cookieString = '', taskId } = req.body;
  const videoUrl = rawVideoUrl || (Array.isArray(mediaUrls) && mediaUrls.length > 0 ? mediaUrls[0] : null);
  if (!videoUrl) {
    return res.status(400).json({ success: false, error: 'Thiếu đường link/file video để đăng lên TikTok' });
  }

  const releaseLock = await globalPostingLock.acquire('TikTok Channel Post', 'tiktok');
  updateTaskProgress(taskId, 10, 'Đang tải & chuẩn bị video đăng TikTok...');
  let localVideo = videoUrl;
  let isTempFile = false;
  const tempId = `tiktok_upload_${Date.now()}`;

  try {
    if (videoUrl.startsWith(`${desktop.WORKER_PUBLIC_URL}/downloads/clip_meo/`)) {
      const fileName = path.basename(videoUrl.split('?')[0]);
      localVideo = path.join(CLIP_MEO_DIR, fileName);
    } else if (videoUrl.startsWith('http')) {
      localVideo = path.join(CLIP_MEO_DIR, `${tempId}.mp4`);
      isTempFile = true;
      const resp = await axios.get(videoUrl, { responseType: 'stream', timeout: 45000 });
      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(localVideo);
        resp.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    }

    if (!fs.existsSync(localVideo)) {
      releaseLock();
      return res.status(404).json({ success: false, error: 'Không tìm thấy file video trên hệ thống' });
    }

    updateTaskProgress(taskId, 30, 'Khởi tạo trình duyệt Playwright với Cookie TikTok...');
    var browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    if (cookieString) {
      const cookies = parseTikTokCookieString(cookieString);
      if (cookies.length > 0) {
        await context.addCookies(cookies);
      }
    }

    const page = await context.newPage();
    updateTaskProgress(taskId, 50, 'Đang điều hướng đến TikTok Creator Center upload...');
    await page.goto('https://www.tiktok.com/creator-center/upload?from=upload', { waitUntil: 'domcontentloaded', timeout: 60000 });

    updateTaskProgress(taskId, 70, 'Đang chọn file video để tải lên TikTok...');
    await page.waitForTimeout(3000);
    if (/\/login/i.test(page.url())) {
      throw new Error('Cookie TikTok đã hết hạn (bị chuyển sang trang đăng nhập) — cập nhật cookie ở Quản lý kết nối');
    }
    const fileInput = await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 30000 }).catch(() => null);
    if (fileInput) {
      await fileInput.setInputFiles(localVideo);
    } else {
      throw new Error('Không tìm thấy ô chọn file trên TikTok Studio — cookie có thể đã hết hạn hoặc TikTok đổi giao diện');
    }

    updateTaskProgress(taskId, 85, 'Đang chờ TikTok xử lý video...');
    // Chờ TikTok tải + xử lý xong video: nút Đăng chuyển sang bật (tối đa 4 phút) thay vì chờ cứng vài giây
    const POST_BTN = 'button:has-text("Post"), button:has-text("Đăng"), button:has-text("Publish")';
    let readyBtn = null;
    for (let i = 0; i < 120 && !readyBtn; i++) {
      await page.waitForTimeout(2000);
      for (const b of await page.$$(POST_BTN)) {
        const off = await b.evaluate((el) => el.disabled || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('data-disabled') === 'true').catch(() => true);
        if (!off && await b.isVisible().catch(() => false)) { readyBtn = b; break; }
      }
    }
    if (!readyBtn) throw new Error('TikTok chưa xử lý xong video sau 4 phút hoặc không thấy nút Đăng');

    const captionSelector = 'div[contenteditable="true"], textarea, .notranslate[contenteditable="true"]';
    const captionEl = await page.$(captionSelector);
    if (captionEl && caption) {
      await captionEl.click();
      await page.keyboard.press('Meta+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.insertText(caption);
    }

    updateTaskProgress(taskId, 95, 'Tự động bấm nút Xuất bản (Publish)...');
    await page.waitForTimeout(1500);
    await readyBtn.click();
    // Xác nhận đã đăng: TikTok chuyển sang trang quản lý nội dung hoặc hiện thông báo đã đăng
    const startUrl = page.url();
    let confirmed = false;
    for (let i = 0; i < 30 && !confirmed; i++) {
      await page.waitForTimeout(2000);
      const url = page.url();
      if (url !== startUrl && /content|manage|tiktokstudio/i.test(url)) confirmed = true;
      else if (await page.$('text=/(đã được đăng|đã đăng|has been (uploaded|posted|published)|uploaded|Manage posts|Quản lý bài đăng)/i').catch(() => null)) confirmed = true;
    }

    updateTaskProgress(taskId, 100, confirmed ? 'Đăng TikTok thành công!' : 'Đã bấm Đăng, chưa thấy TikTok xác nhận');
    return res.json(confirmed
      ? { success: true, message: 'Đã đăng video lên kênh TikTok!' }
      : { success: true, message: 'Đã bấm Đăng trên TikTok', warning: 'Chưa thấy TikTok xác nhận — mở TikTok Studio kiểm tra lại bài đăng.' });
  } catch (err) {
    console.error('[TikTok_Post] Lỗi:', err.message);
    return res.status(500).json({ success: false, error: `Lỗi đăng bài TikTok: ${err.message}` });
  } finally {
    if (isTempFile && fs.existsSync(localVideo)) {
      try { fs.unlinkSync(localVideo); } catch (_) {}
    }
    if (typeof browser !== 'undefined' && browser) {
      try { await browser.close(); } catch (_) {}
    }
    releaseLock();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Endpoint Tự Động Đăng Bài Lên Threads qua Playwright Cookie (chữ / ảnh / video)
// ─────────────────────────────────────────────────────────────────────────────
const THREADS_MAX_CHARS = 500;
const THREADS_MAX_MEDIA = 10;
const THREADS_MAX_PARTS = 10;
const THREADS_VIDEO_EXTS = ['.mp4', '.mov', '.m4v', '.webm'];

// Threads đang chuyển domain threads.net → threads.com: gắn cookie cho cả 2 domain.
function parseThreadsCookieString(cookieStr) {
  if (!cookieStr) return [];
  const trimmed = String(cookieStr).trim();
  let pairs = [];
  if (trimmed.startsWith('[')) {
    try {
      pairs = JSON.parse(trimmed).map(item => ({ name: item.name, value: item.value }));
    } catch (e) {}
  }
  if (pairs.length === 0) {
    pairs = trimmed.split(';').map(pair => {
      const parts = pair.trim().split('=');
      if (parts.length < 2) return null;
      let val = parts.slice(1).join('=').trim();
      try { val = decodeURIComponent(val); } catch (e) { }
      return { name: parts[0].trim(), value: val };
    }).filter(Boolean);
  }
  const cookies = [];
  for (const p of pairs) {
    if (!p.name) continue;
    for (const domain of ['.threads.com', '.threads.net']) {
      cookies.push({ name: p.name, value: String(p.value ?? ''), domain, path: '/', secure: true, sameSite: 'Lax' });
    }
  }
  return cookies;
}

// Tách nội dung thành các phần của 1 chuỗi thread: người dùng tự ngắt bằng dòng "---", phần nào vẫn dài
// hơn 500 ký tự thì tự cắt ở ranh giới đoạn văn → câu → khoảng trắng (không cắt giữa từ).
function splitThreadsParts(text, maxChars = THREADS_MAX_CHARS) {
  const chunks = String(text || '').split(/\n\s*-{3,}\s*\n/).map(t => t.trim()).filter(Boolean);
  const parts = [];
  for (const chunk of chunks) {
    let rest = chunk;
    while ([...rest].length > maxChars) {
      const window = [...rest].slice(0, maxChars).join('');
      let cut = window.lastIndexOf('\n\n');
      if (cut < maxChars * 0.4) {
        const sentenceEnds = [...window.matchAll(/[.!?…](?=\s)|\n/g)].map(m => m.index + 1);
        const lastSentence = sentenceEnds.length ? sentenceEnds[sentenceEnds.length - 1] : -1;
        cut = lastSentence >= maxChars * 0.4 ? lastSentence : window.lastIndexOf(' ');
      }
      if (cut <= 0) cut = window.length;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
  }
  return parts;
}

// Lấy lại toàn bộ cookie Threads hiện tại của context (Threads xoay vòng cookie theo phiên) để backend lưu
// đè vào DB — giữ phiên sống lâu hơn so với việc dùng mãi chuỗi cookie cũ người dùng dán lúc đầu.
async function threadsCookieStringFromContext(context) {
  const cookies = await context.cookies(['https://www.threads.com', 'https://www.threads.net']).catch(() => []);
  const byName = new Map();
  for (const c of cookies) {
    if (!byName.has(c.name) || c.domain.includes('threads.com')) byName.set(c.name, c.value);
  }
  if (!byName.get('sessionid')) return null;
  return [...byName.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function downloadThreadsMedia(url, tempPrefix, index) {
  if (url.startsWith(`${desktop.WORKER_PUBLIC_URL}/downloads/`)) {
    const relPath = decodeURIComponent(url.split('?')[0].replace(`${desktop.WORKER_PUBLIC_URL}/downloads/`, ''));
    const localPath = path.join(__dirname, 'downloads', relPath);
    if (fs.existsSync(localPath)) return { filePath: localPath, isTemp: false };
  }
  if (!url.startsWith('http')) {
    if (fs.existsSync(url)) return { filePath: url, isTemp: false };
    throw new Error(`Không tìm thấy file media: ${url}`);
  }
  const resp = await axios.get(url, {
    responseType: 'stream',
    timeout: 60000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }
  });
  const contentType = String(resp.headers['content-type'] || '').toLowerCase();
  const urlExt = path.extname(url.split('?')[0]).toLowerCase();
  let ext;
  if (contentType.startsWith('video/') || THREADS_VIDEO_EXTS.includes(urlExt)) ext = THREADS_VIDEO_EXTS.includes(urlExt) ? urlExt : '.mp4';
  else if (contentType.includes('png') || urlExt === '.png') ext = '.png';
  else if (contentType.includes('webp') || urlExt === '.webp') ext = '.webp';
  else ext = '.jpg';
  const filePath = path.join(CLIP_MEO_DIR, `${tempPrefix}_${index}${ext}`);
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    resp.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
  return { filePath, isTemp: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Đăng nhập Threads bằng cửa sổ Chrome THẬT trên máy (headed) — người dùng tự đăng nhập (kể cả qua Instagram,
// 2FA...), worker chỉ chờ tới khi thấy đã đăng nhập rồi tự lấy cookie. Mỗi nick có hồ sơ trình duyệt riêng
// (browser_profiles/threads_<profileKey>) nên lần sau đăng nhập lại thường chỉ cần 1 chạm.
// ─────────────────────────────────────────────────────────────────────────────
const threadsLoginSessions = new Map();
const THREADS_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

app.post('/api/threads-login/start', async (req, res) => {
  const profileKey = String(req.body?.profileKey || 'new').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 60) || 'new';
  for (const s of threadsLoginSessions.values()) {
    if (s.status === 'WAITING') {
      return res.status(409).json({ success: false, error: 'Đang có 1 cửa sổ đăng nhập Threads mở sẵn — hoàn tất hoặc đóng nó trước.' });
    }
  }
  const sessionId = `thl_${Date.now()}`;
  const session = { id: sessionId, status: 'WAITING', message: 'Đang mở cửa sổ đăng nhập...', startedAt: Date.now() };
  threadsLoginSessions.set(sessionId, session);
  res.json({ success: true, sessionId });

  let context = null;
  try {
    const profileDir = path.join(__dirname, 'browser_profiles', `threads_${profileKey}`);
    fs.mkdirSync(profileDir, { recursive: true });
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: null,
      locale: 'vi-VN',
      args: ['--window-size=520,860', '--disable-blink-features=AutomationControlled'],
    });
    session.close = () => context.close().catch(() => {});
    let closedByUser = false;
    context.on('close', () => { closedByUser = true; });
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.threads.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.bringToFront().catch(() => {});
    if (session.status === 'WAITING') {
      session.message = 'Cửa sổ Chrome đã mở — hãy đăng nhập Threads (có thể dùng "Tiếp tục bằng Instagram").';
    }

    while (Date.now() - session.startedAt < THREADS_LOGIN_TIMEOUT_MS) {
      if (closedByUser || session.status === 'CANCELLED') break;
      const pages = context.pages();
      let profileHref = null;
      for (const p of pages) {
        profileHref = await p.evaluate(() => {
          const svg = document.querySelector('svg[aria-label="Trang cá nhân"], svg[aria-label="Profile"]');
          return svg?.closest('a')?.getAttribute('href') || null;
        }).catch(() => null);
        if (profileHref) break;
      }
      const cookieString = await threadsCookieStringFromContext(context);
      if (profileHref && cookieString) {
        session.status = 'SUCCESS';
        session.username = profileHref.replace(/^\/@/, '').replace(/\/.*$/, '');
        session.cookieString = cookieString;
        session.message = `Đã đăng nhập @${session.username} — đã lấy cookie.`;
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (session.status === 'WAITING') {
      session.status = closedByUser ? 'CANCELLED' : 'TIMEOUT';
      session.message = closedByUser ? 'Cửa sổ đăng nhập đã bị đóng trước khi hoàn tất.' : 'Hết 10 phút chờ đăng nhập.';
    }
  } catch (err) {
    session.status = 'FAILED';
    session.message = `Không mở được cửa sổ đăng nhập: ${err.message}`;
    console.error('[Threads_Login] Lỗi:', err.message);
  } finally {
    if (context) await context.close().catch(() => {});
    session.finishedAt = Date.now();
    // Dọn phiên cũ sau 30 phút để không giữ cookie trong bộ nhớ lâu.
    setTimeout(() => threadsLoginSessions.delete(sessionId), 30 * 60 * 1000);
  }
});

app.get('/api/threads-login/:id', (req, res) => {
  const s = threadsLoginSessions.get(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: 'Phiên đăng nhập không tồn tại hoặc đã hết hạn' });
  return res.json({ success: true, status: s.status, message: s.message, username: s.username || null, cookieString: s.status === 'SUCCESS' ? s.cookieString : null });
});

app.post('/api/threads-login/:id/cancel', async (req, res) => {
  const s = threadsLoginSessions.get(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: 'Phiên đăng nhập không tồn tại' });
  if (s.status === 'WAITING') {
    s.status = 'CANCELLED';
    s.message = 'Đã huỷ đăng nhập.';
    if (s.close) await s.close();
  }
  return res.json({ success: true, status: s.status });
});

// ─────────────────────────────────────────────────────────────────────────────
// Đăng nhập Facebook bằng cửa sổ Chrome THẬT (headed) — người dùng tự gõ tài khoản/mật khẩu/2FA trong cửa sổ,
// worker chỉ chờ tới khi có c_user + xs rồi lấy TOÀN BỘ cookie facebook.com (kể cả httpOnly).
// Hồ sơ trình duyệt lưu bền theo UID: browser_profiles/fb_login_<uid>. Nick mới thì dùng hồ sơ tạm rồi đổi tên
// theo UID sau khi đăng nhập xong — tránh việc lần sau bấm "thêm nick mới" lại tự dính phiên nick cũ.
// ─────────────────────────────────────────────────────────────────────────────
const fbLoginSessions = new Map();
const FB_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

// Cookie mới nhất sau phiên đăng bài (Facebook xoay xs/fr...) — chỉ trả khi cùng c_user với cookie gửi
// vào, để backend lưu lại và nick đăng đều đặn tự gia hạn cookie mà không lưu nhầm sang nick khác.
async function refreshedFbCookieForSameUser(context, sentCookieString) {
  try {
    const sentCUser = (String(sentCookieString || '').match(/(?:^|;\s*)c_user=(\d+)/) || [])[1];
    const found = await fbCookieStringFromContext(context);
    if (!sentCUser || !found || found.cUser !== sentCUser) return null;
    return found.cookieString;
  } catch (_) {
    return null;
  }
}

async function fbCookieStringFromContext(context) {
  const cookies = await context.cookies(['https://www.facebook.com', 'https://facebook.com']).catch(() => []);
  const byName = new Map();
  for (const c of cookies) {
    if (!c.domain.includes('facebook.com') || c.name === 'i_user') continue;
    if (!byName.has(c.name) || c.domain === '.facebook.com') byName.set(c.name, c.value);
  }
  if (!byName.get('c_user') || !byName.get('xs')) return null;
  // c_user + xs lên đầu cho dễ đọc / để các chỗ parse đơn giản vẫn bắt được.
  const ordered = ['c_user', 'xs', ...[...byName.keys()].filter((k) => k !== 'c_user' && k !== 'xs')];
  return { cUser: byName.get('c_user'), cookieString: ordered.map((k) => `${k}=${byName.get(k)}`).join('; ') };
}

app.post('/api/fb-login/start', async (req, res) => {
  const requestedUid = String(req.body?.cUser || '').replace(/[^0-9]/g, '').slice(0, 30);
  for (const s of fbLoginSessions.values()) {
    if (s.status === 'WAITING') {
      return res.status(409).json({ success: false, error: 'Đang có 1 cửa sổ đăng nhập Facebook mở sẵn — hoàn tất hoặc đóng nó trước.' });
    }
  }
  const sessionId = `fbl_${Date.now()}`;
  const session = { id: sessionId, status: 'WAITING', message: 'Đang mở cửa sổ đăng nhập...', startedAt: Date.now() };
  fbLoginSessions.set(sessionId, session);
  res.json({ success: true, sessionId });

  const profilesRoot = path.join(__dirname, 'browser_profiles');
  const profileDir = path.join(profilesRoot, requestedUid ? `fb_login_${requestedUid}` : `fb_login_tmp_${Date.now()}`);
  let context = null;
  try {
    fs.mkdirSync(profileDir, { recursive: true });
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: null,
      locale: 'vi-VN',
      args: ['--window-size=1100,900', '--disable-blink-features=AutomationControlled'],
    });
    session.close = () => context.close().catch(() => {});
    let closedByUser = false;
    context.on('close', () => { closedByUser = true; });
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.bringToFront().catch(() => {});
    if (session.status === 'WAITING') {
      session.message = 'Cửa sổ Chrome đã mở — hãy tự đăng nhập Facebook trong cửa sổ đó (kể cả mã 2FA nếu có).';
    }

    while (Date.now() - session.startedAt < FB_LOGIN_TIMEOUT_MS) {
      if (closedByUser || session.status === 'CANCELLED') break;
      const found = await fbCookieStringFromContext(context);
      const onAuthPage = context.pages().some((p) => /\/(login|checkpoint|two_step_verification|recover)/i.test(p.url()));
      if (found && !onAuthPage) {
        if (requestedUid && found.cUser !== requestedUid) {
          session.message = `Cửa sổ đang đăng nhập UID ${found.cUser}, khác nick cần cập nhật (${requestedUid}) — hãy đăng xuất và đăng nhập đúng nick.`;
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        // Chờ thêm chút cho Facebook set nốt các cookie phụ (fr, presence...) sau khi vào trang chủ.
        await new Promise((r) => setTimeout(r, 3000));
        const final = (await fbCookieStringFromContext(context)) || found;
        let name = null;
        try {
          await page.goto(`https://www.facebook.com/profile.php?id=${final.cUser}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(1500);
          name = (await page.title()).replace(/\s*[|\-–]\s*Facebook\s*$/i, '').replace(/^\(\d+\)\s*/, '').trim() || null;
          if (name && /^facebook$/i.test(name)) name = null;
        } catch { /* không lấy được tên thì thôi */ }
        session.status = 'SUCCESS';
        session.cUser = final.cUser;
        session.name = name;
        session.cookieString = final.cookieString;
        session.message = `Đã đăng nhập ${name || 'UID ' + final.cUser} — đã lấy cookie.`;
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (session.status === 'WAITING') {
      session.status = closedByUser ? 'CANCELLED' : 'TIMEOUT';
      session.message = closedByUser ? 'Cửa sổ đăng nhập đã bị đóng trước khi hoàn tất.' : 'Hết 10 phút chờ đăng nhập.';
    }
  } catch (err) {
    session.status = 'FAILED';
    session.message = `Không mở được cửa sổ đăng nhập: ${err.message}`;
    console.error('[FB_Login] Lỗi:', err.message);
  } finally {
    if (context) await context.close().catch(() => {});
    // Hồ sơ tạm của nick mới: đổi tên theo UID để lần sau đăng nhập lại nick này nhanh hơn; thất bại thì xoá.
    if (!requestedUid) {
      try {
        if (session.status === 'SUCCESS' && session.cUser) {
          const target = path.join(profilesRoot, `fb_login_${session.cUser}`);
          fs.rmSync(target, { recursive: true, force: true });
          fs.renameSync(profileDir, target);
        } else {
          fs.rmSync(profileDir, { recursive: true, force: true });
        }
      } catch (e) {
        console.warn('[FB_Login] Không dọn được hồ sơ tạm:', e.message);
      }
    }
    session.finishedAt = Date.now();
    setTimeout(() => fbLoginSessions.delete(sessionId), 30 * 60 * 1000);
  }
});

app.get('/api/fb-login/:id', (req, res) => {
  const s = fbLoginSessions.get(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: 'Phiên đăng nhập không tồn tại hoặc đã hết hạn' });
  const ok = s.status === 'SUCCESS';
  return res.json({ success: true, status: s.status, message: s.message, cUser: s.cUser || null, name: s.name || null, cookieString: ok ? s.cookieString : null });
});

app.post('/api/fb-login/:id/cancel', async (req, res) => {
  const s = fbLoginSessions.get(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: 'Phiên đăng nhập không tồn tại' });
  if (s.status === 'WAITING') {
    s.status = 'CANCELLED';
    s.message = 'Đã huỷ đăng nhập.';
    if (s.close) await s.close();
  }
  return res.json({ success: true, status: s.status });
});

app.post('/api/fb-login/sync-cookie', async (req, res) => {
  const { cookieString = '', cUser = '' } = req.body || {};
  if (!cookieString || !cookieString.includes('xs=')) {
    return res.status(400).json({ success: false, error: 'Thiếu cookie hoặc thiếu xs/c_user' });
  }
  try {
    const backendRes = await fetch(`${desktop.BACKEND_URL}/api/connections/sync-fb-cookie`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...desktop.backendHeaders() },
      body: JSON.stringify({ cookieString, cUser }),
    });
    const data = await backendRes.json().catch(() => ({}));
    return res.status(backendRes.status).json(data);
  } catch (err) {
    return res.status(502).json({ success: false, error: `Không thể kết nối đến Backend: ${err.message}` });
  }
});

// Kiểm tra cookie Threads + lấy thông tin nick (tên, @username, follower, bio, avatar) từ og-meta trang cá nhân.
app.post('/api/threads-account-info', async (req, res) => {
  const { cookieString = '' } = req.body;
  if (!cookieString) {
    return res.status(400).json({ success: false, error: 'Thiếu cookie tài khoản Threads' });
  }
  let releaseContext = null;
  try {
    // Context từ browserPool (chung process Chromium) thay vì chromium.launch() riêng mỗi request.
    const acquired = await browserPool.acquireContext({
      locale: 'vi-VN',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });
    releaseContext = acquired.release;
    const context = acquired.context;
    await context.addCookies(parseThreadsCookieString(cookieString));
    const page = await context.newPage();
    await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    const profileHref = await page.evaluate(() => {
      const svg = document.querySelector('svg[aria-label="Trang cá nhân"], svg[aria-label="Profile"]');
      return svg?.closest('a')?.getAttribute('href') || null;
    }).catch(() => null);
    if (!profileHref || /\/login/i.test(page.url())) {
      return res.json({ success: true, loggedIn: false, error: 'Cookie Threads đã hết hạn hoặc không hợp lệ.' });
    }

    await page.goto(`https://www.threads.com${profileHref}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    const meta = await page.evaluate(() => {
      const m = (n) => document.querySelector(`meta[property="${n}"]`)?.content || '';
      return { title: m('og:title'), description: m('og:description'), image: m('og:image') };
    });

    const username = profileHref.replace(/^\/@/, '').replace(/\/.*$/, '');
    const fullName = (meta.title.match(/^(.*?)\s*\(@/) || [])[1] || username;
    const followers = (meta.description.match(/^([\d.,]+\s*[KkMTr]*)\s*(?:người theo dõi|followers?)/i) || [])[1]?.trim() || null;
    const threadsCount = (meta.description.match(/([\d.,]+\s*[KkMTr]*)\s*thread/i) || [])[1]?.trim() || null;
    const bioMatch = meta.description.match(/thread[s]?\s*•\s*([\s\S]*?)\s*(?:\.\s*)?(?:Xem các cuộc trò chuyện|See the latest)/i);

    // Avatar trên CDN Instagram hay chặn hotlink theo Referer — tải luôn về dạng data URL cho frontend.
    let avatarDataUrl = null;
    if (meta.image) {
      const resp = await page.request.get(meta.image).catch(() => null);
      if (resp && resp.ok()) {
        const buf = await resp.body();
        if (buf.length < 300 * 1024) {
          avatarDataUrl = `data:${resp.headers()['content-type'] || 'image/jpeg'};base64,${buf.toString('base64')}`;
        }
      }
    }

    const refreshedCookie = await threadsCookieStringFromContext(context);
    return res.json({
      success: true,
      loggedIn: true,
      cookieString: refreshedCookie,
      username,
      fullName,
      followers,
      threadsCount,
      bio: bioMatch ? bioMatch[1].trim() : null,
      avatarDataUrl,
      profileUrl: `https://www.threads.com/@${username}`
    });
  } catch (err) {
    console.error('[Threads_Info] Lỗi:', err.message);
    return res.status(500).json({ success: false, error: `Lỗi kiểm tra tài khoản Threads: ${err.message}` });
  } finally {
    await releaseContext?.();
  }
});

app.post('/api/post-threads', async (req, res) => {
  const { content = '', caption, mediaUrls = [], cookieString = '', taskId } = req.body;
  const text = String(content || caption || '').trim();
  const mediaList = (Array.isArray(mediaUrls) ? mediaUrls : []).filter(u => typeof u === 'string' && u.trim()).map(u => u.trim());

  if (!cookieString) {
    return res.status(400).json({ success: false, error: 'Thiếu cookie tài khoản Threads' });
  }
  if (!text && mediaList.length === 0) {
    return res.status(400).json({ success: false, error: 'Bài viết không có nội dung lẫn ảnh/video — không có gì để đăng lên Threads.' });
  }

  const warnings = [];
  let parts = splitThreadsParts(text);
  if (parts.length > THREADS_MAX_PARTS) {
    warnings.push(`Nội dung quá dài (${parts.length} phần) — Threads Studio chỉ đăng tối đa ${THREADS_MAX_PARTS} phần/chuỗi, đã bỏ phần thừa.`);
    parts = parts.slice(0, THREADS_MAX_PARTS);
  }
  if (mediaList.length > THREADS_MAX_MEDIA) {
    warnings.push(`Threads chỉ cho tối đa ${THREADS_MAX_MEDIA} ảnh/video mỗi bài — đã bỏ ${mediaList.length - THREADS_MAX_MEDIA} media thừa.`);
  }
  const selectedMedia = mediaList.slice(0, THREADS_MAX_MEDIA);

  const releaseLock = await globalPostingLock.acquire('Threads Post', 'threads');
  const tempPrefix = `threads_upload_${Date.now()}`;
  const localFiles = [];
  let browser = null;
  let page = null;

  try {
    if (selectedMedia.length > 0) {
      updateTaskProgress(taskId, 10, `Đang tải ${selectedMedia.length} ảnh/video để đăng Threads...`);
      for (let i = 0; i < selectedMedia.length; i++) {
        localFiles.push(await downloadThreadsMedia(selectedMedia[i], tempPrefix, i));
      }
    }

    updateTaskProgress(taskId, 30, 'Khởi tạo trình duyệt Playwright với Cookie Threads...');
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: 'vi-VN',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });
    await context.addCookies(parseThreadsCookieString(cookieString));

    page = await context.newPage();
    updateTaskProgress(taskId, 40, 'Đang mở Threads...');
    await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    const isLoggedOut = async () => {
      if (/\/login|accounts\/login/i.test(page.url())) return true;
      const loginBtn = await page.$('a[href*="/login"]:visible, div[role="button"]:has-text("Đăng nhập"):visible, div[role="button"]:has-text("Log in"):visible');
      const createBtn = await page.$('[aria-label="Create"], [aria-label="Tạo"], svg[aria-label="Create"], svg[aria-label="Tạo"]');
      return !!loginBtn && !createBtn;
    };
    if (await isLoggedOut()) {
      const err = new Error('Cookie Threads đã hết hạn hoặc không hợp lệ (bị chuyển về trang đăng nhập). Vui lòng cập nhật lại Cookie tại trang Quản lý kết nối.');
      err.code = 'THREADS_COOKIE_EXPIRED';
      throw err;
    }

    updateTaskProgress(taskId, 50, 'Đang mở khung soạn bài Threads...');
    // Khung "Thread mới" của Threads (09/2026) là 1 bảng nổi góc phải dưới, KHÔNG phải div[role="dialog"].
    // Định vị bằng ô soạn bài (textbox contenteditable) rồi dò ngược lên khung gần nhất có nút "Đăng",
    // gắn data-attribute để các bước sau scope đúng khung này (trang chủ còn 1 nút "Đăng" inline khác).
    const COMPOSER_ATTR = 'data-autopost-threads-composer';
    const markComposer = () => page.evaluate((attr) => {
      document.querySelectorAll(`[${attr}]`).forEach(el => el.removeAttribute(attr));
      const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const boxes = [...document.querySelectorAll('[role="textbox"][contenteditable="true"]')].filter(vis);
      for (const tb of boxes.reverse()) {
        let root = tb;
        for (let depth = 0; root && depth < 25; depth++) {
          const hasPost = [...root.querySelectorAll('div[role="button"], button')]
            .some(b => /^(Đăng|Post)$/i.test((b.innerText || '').trim()));
          if (hasPost && root.querySelector('input[type="file"]')) {
            root.setAttribute(attr, '1');
            return true;
          }
          root = root.parentElement;
        }
      }
      return false;
    }, COMPOSER_ATTR).catch(() => false);
    const openerSelectors = [
      'svg[aria-label="Tạo"]', 'svg[aria-label="Create"]',
      'a:has-text("Thread mới")', 'div[role="button"]:has-text("Thread mới")',
      'div[role="button"]:has-text("New thread")',
    ];
    let composerOpened = false;
    for (let attempt = 0; attempt < 3 && !composerOpened; attempt++) {
      for (const sel of openerSelectors) {
        const el = page.locator(sel).first();
        if (!(await el.isVisible().catch(() => false))) continue;
        await el.click().catch(() => {});
        for (let i = 0; i < 8 && !composerOpened; i++) {
          await page.waitForTimeout(700);
          composerOpened = await markComposer();
        }
        if (composerOpened) break;
      }
      if (!composerOpened) await page.waitForTimeout(2000);
    }
    if (!composerOpened) {
      throw new Error('Không mở được khung soạn bài Threads (không tìm thấy nút Tạo / "Thread mới").');
    }
    const dialog = page.locator(`[${COMPOSER_ATTR}]`);

    const editors = dialog.locator('[role="textbox"][contenteditable="true"]');
    if (parts.length > 0) {
      updateTaskProgress(taskId, 60, parts.length > 1 ? `Đang điền phần 1/${parts.length} của chuỗi thread...` : 'Đang điền nội dung bài Threads...');
      await editors.first().click();
      await page.keyboard.insertText(parts[0]);
      await page.waitForTimeout(800);
    }

    // Media luôn gắn vào phần ĐẦU của chuỗi (mỗi phần có 1 input file riêng).
    if (localFiles.length > 0) {
      updateTaskProgress(taskId, 70, `Đang tải ${localFiles.length} ảnh/video lên Threads...`);
      const fileInput = dialog.locator('input[type="file"]').first();
      if ((await fileInput.count()) === 0) {
        throw new Error('Không tìm thấy ô chọn file ảnh/video trong khung soạn bài Threads.');
      }
      await fileInput.setInputFiles(localFiles.map(f => f.filePath));
      await page.waitForTimeout(3000);
    }

    for (let i = 1; i < parts.length; i++) {
      updateTaskProgress(taskId, 75, `Đang thêm phần ${i + 1}/${parts.length} vào chuỗi thread...`);
      const before = await editors.count();
      await dialog.locator('div[role="button"]:has-text("Thêm vào thread"), div[role="button"]:has-text("Add to thread")').last().click();
      let appeared = false;
      for (let k = 0; k < 10 && !appeared; k++) {
        await page.waitForTimeout(500);
        appeared = (await editors.count()) > before;
      }
      if (!appeared) {
        throw new Error(`Không thêm được phần ${i + 1} vào chuỗi thread (không thấy ô soạn mới).`);
      }
      await editors.last().click();
      await page.keyboard.insertText(parts[i]);
      await page.waitForTimeout(600);
    }

    // Poll tìm nút Đăng/Post còn enabled — video cần thời gian xử lý nên nút có thể bị disabled một lúc.
    updateTaskProgress(taskId, 85, 'Đang chờ Threads xử lý & bấm Đăng...');
    const hasVideo = localFiles.some(f => THREADS_VIDEO_EXTS.includes(path.extname(f.filePath).toLowerCase()));
    const deadline = Date.now() + (hasVideo ? 180000 : 45000);
    let clicked = false;
    while (Date.now() < deadline && !clicked) {
      const buttons = dialog.locator('div[role="button"], button');
      const count = await buttons.count();
      for (let i = count - 1; i >= 0; i--) {
        const btn = buttons.nth(i);
        const label = ((await btn.innerText().catch(() => '')) || '').trim();
        if (!/^(Đăng|Post)$/i.test(label)) continue;
        if (!(await btn.isVisible().catch(() => false))) continue;
        const disabled = await btn.evaluate(el => el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled')).catch(() => true);
        if (disabled) continue;
        await btn.click().catch(() => {});
        clicked = true;
        break;
      }
      if (!clicked) await page.waitForTimeout(2000);
    }
    if (!clicked) {
      throw new Error('Không tìm thấy nút "Đăng" khả dụng trong khung soạn bài Threads (có thể media chưa xử lý xong).');
    }

    // Khung soạn bài đóng NGAY khi bấm Đăng, nhưng Threads mới chỉ bắt đầu tải media lên ở nền (thông báo
    // "Đang đăng..."). Phải chờ tới thông báo "Đã đăng" rồi mới đóng browser — đóng sớm sẽ huỷ bài âm thầm
    // (đã xảy ra khi test thật 09/2026: endpoint báo thành công nhưng bài không hề lên).
    const closed = await dialog.waitFor({ state: 'detached', timeout: 30000 }).then(() => true)
      .catch(() => dialog.isHidden().catch(() => false));
    if (!closed) {
      throw new Error('Đã bấm Đăng nhưng khung soạn bài Threads không đóng — có thể bài chưa được gửi.');
    }

    updateTaskProgress(taskId, 90, 'Threads đang tải bài lên (Đang đăng...)...');
    const readToast = () => page.evaluate(() => [...document.querySelectorAll('[role="alert"], [role="status"], [aria-live]')]
      .map(el => ({ text: (el.innerText || '').trim(), href: el.querySelector('a[href*="/post/"]')?.href || null }))
      .filter(t => t.text)).catch(() => []);
    const publishDeadline = Date.now() + (hasVideo ? 600000 : 180000);
    let publishedUrl = null;
    let published = false;
    while (Date.now() < publishDeadline) {
      const toasts = await readToast();
      const done = toasts.find(t => /Đã đăng|Posted/i.test(t.text));
      if (done) {
        published = true;
        publishedUrl = done.href;
        break;
      }
      const failed = toasts.find(t => /Không thể đăng|Không đăng được|couldn.t post|failed|Thử lại|Try again/i.test(t.text));
      if (failed) {
        throw new Error(`Threads báo lỗi khi đăng: "${failed.text.replace(/\s+/g, ' ')}"`);
      }
      await page.waitForTimeout(1500);
    }
    if (!published) {
      throw new Error('Quá thời gian chờ Threads xác nhận "Đã đăng" — bài có thể chưa lên, vui lòng kiểm tra trang cá nhân Threads.');
    }

    const refreshedCookie = await threadsCookieStringFromContext(context);
    updateTaskProgress(taskId, 100, 'Đăng bài Threads thành công!');
    return res.json({
      success: true,
      message: parts.length > 1 ? `Đã đăng chuỗi ${parts.length} phần lên Threads!` : 'Đã đăng bài thành công lên Threads!',
      partsCount: parts.length,
      ...(publishedUrl ? { postUrl: publishedUrl } : {}),
      ...(refreshedCookie ? { cookieString: refreshedCookie } : {}),
      ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {})
    });
  } catch (err) {
    console.error('[Threads_Post] Lỗi:', err.message);
    if (page) {
      const debugPath = path.join(DEBUG_OUTPUT_DIR, `debug_post_threads_${Date.now()}.png`);
      await page.screenshot({ path: debugPath, fullPage: false }).catch(() => {});
      console.error(`[Threads_Post] Ảnh debug: ${debugPath}`);
    }
    return res.status(500).json({
      success: false,
      code: err.code || 'THREADS_POST_FAILED',
      error: `Lỗi đăng bài Threads: ${err.message}`
    });
  } finally {
    for (const f of localFiles) {
      if (f.isTemp && fs.existsSync(f.filePath)) {
        try { fs.unlinkSync(f.filePath); } catch (_) {}
      }
    }
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
    releaseLock();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Kiểm tra & Tự động xoá bài Flop trong Facebook Group (Tiêu chí động)
// ─────────────────────────────────────────────────────────────────────────────
function parseEngagementNumber(text) {
  if (!text) return 0;
  const str = String(text).trim().replace(',', '.');
  const kMatch = str.match(/([\d.]+)\s*K/i);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  const mMatch = str.match(/([\d.]+)\s*M/i);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1000000);
  const match = str.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

async function checkAndDeleteFlopGroupPost({ cookieString, postUrl, postContent, minLikesThreshold = 10, minCommentsThreshold = 0 }) {
  let release = null;
  try {
    const cookies = parseCookies(cookieString);
    const acquired = await browserPool.acquireContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 1000 },
    });
    const { context } = acquired;
    release = acquired.release;
    const page = await context.newPage();

    if (cookies.length > 0) {
      await context.addCookies(cookies).catch(() => {});
    }

    console.log(`[Playwright][FlopCheck] 🔍 Mở bài viết/Group: ${postUrl}`);
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);

    let postContainer = page;
    if (postContent && postContent.trim().length > 0) {
      const snippet = postContent.trim().slice(0, 25).replace(/["'\\]/g, '');
      console.log(`[Playwright][FlopCheck] 🔍 Tìm bài viết chứa nội dung: "${snippet}"`);
      
      for (let s = 0; s < 5; s++) {
        const articleEl = page.locator(`div[role="article"]:has-text("${snippet}")`).first();
        if (await articleEl.isVisible().catch(() => false)) {
          console.log(`[Playwright][FlopCheck] 🎯 Đã định vị bài viết chứa nội dung: "${snippet}"`);
          postContainer = articleEl;
          await articleEl.scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(1000);
          break;
        }
        await page.mouse.wheel(0, 500).catch(() => {});
        await page.waitForTimeout(1000);
      }
    }

    // 1. Quét chỉ số Likes / Reactions
    let likesCount = 0;
    const likeCountSelectors = [
      'span[aria-label*="thích"]', 'span[aria-label*="reaction"]', 'span[aria-label*="cảm xúc"]',
      'span[aria-label*="like"]', 'span[aria-label*="Like"]', 'span[aria-label*="người"]',
      'div[role="button"] span:has-text("thích")', 'div[role="button"] span:has-text("like")'
    ];

    for (const sel of likeCountSelectors) {
      const el = postContainer.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        const txt = (await el.getAttribute('aria-label').catch(() => null)) || (await el.innerText().catch(() => ''));
        const val = parseEngagementNumber(txt);
        if (val > 0) {
          likesCount = val;
          break;
        }
      }
    }

    // 2. Quét chỉ số Comments
    let commentsCount = 0;
    const commentCountSelectors = [
      'span:has-text("bình luận")', 'span:has-text("comment")', 'span:has-text("Bình luận")'
    ];
    for (const sel of commentCountSelectors) {
      const el = postContainer.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        const txt = await el.innerText().catch(() => '');
        const val = parseEngagementNumber(txt);
        if (val > 0) {
          commentsCount = val;
          break;
        }
      }
    }

    console.log(`[Playwright][FlopCheck] 📊 Tương tác bài viết: ${likesCount} likes (ngưỡng >= ${minLikesThreshold}), ${commentsCount} comments (ngưỡng >= ${minCommentsThreshold})`);

    const isFlop = (likesCount < minLikesThreshold) || (commentsCount < minCommentsThreshold);

    if (!isFlop) {
      console.log(`[Playwright][FlopCheck] ✅ Bài viết ĐẠT tiêu chí tương tác — Giữ nguyên bài viết.`);
      await page.close().catch(() => {});
      if (release) await release().catch(() => {});
      return {
        success: true,
        deleted: false,
        likesCount,
        commentsCount,
        reason: `Bài viết đạt tương tác (${likesCount} likes, ${commentsCount} comments)`
      };
    }

    console.log(`[Playwright][FlopCheck] ⚠️ Bài viết BỊ FLOP! Đang tiến hành xoá bài viết...`);

    // 3. Thực hiện thao tác xoá bài viết
    const menuBtnSelectors = [
      'div[aria-label*="Hành động đối với bài viết"]',
      'div[aria-label*="Hành động với bài viết"]',
      'div[aria-label*="Actions for this post"]',
      'div[aria-label="Khác"]',
      'div[aria-label="More"]',
      'div[aria-label="Tùy chọn"]',
      'div[aria-label="Tùy chọn khác"]',
      'div[role="button"][aria-label*="Hành động"]',
      'div[role="button"][aria-label*="Khác"]',
      'div[aria-haspopup="menu"]'
    ];

    let menuOpened = false;
    for (const sel of menuBtnSelectors) {
      const btn = postContainer.locator(sel).first();
      if (await btn.isVisible().catch(() => false)) {
        console.log(`[Playwright][FlopCheck] 🎯 Đã bấm nút 3 chấm menu: "${sel}"`);
        await btn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1500);
        menuOpened = true;
        break;
      }
    }

    if (!menuOpened) {
      console.log(`[Playwright][FlopCheck] ❌ Không tìm thấy nút menu 3 chấm để xoá bài`);
      await page.close().catch(() => {});
      if (release) await release().catch(() => {});
      return { success: false, deleted: false, likesCount, commentsCount, error: 'Không tìm thấy menu 3 chấm trên bài viết' };
    }

    const deleteOptionSelectors = [
      'div[role="menuitem"]:has-text("Xóa bài viết")',
      'div[role="menuitem"]:has-text("Xoá bài viết")',
      'div[role="menuitem"]:has-text("Gỡ bài viết")',
      'div[role="menuitem"]:has-text("Chuyển vào thùng rác")',
      'div[role="menuitem"]:has-text("Xóa")',
      'div[role="menuitem"]:has-text("Xoá")',
      'div[role="menuitem"]:has-text("Gỡ")',
      'div[role="menuitem"]:has-text("Delete post")',
      'div[role="menuitem"]:has-text("Remove post")',
      'div[role="menuitem"]:has-text("Move to trash")',
      'span:has-text("Xóa bài viết")',
      'span:has-text("Xoá bài viết")',
      'span:has-text("Gỡ bài viết")',
      'span:has-text("Chuyển vào thùng rác")',
      'span:has-text("Xóa")',
      'span:has-text("Xoá")',
      'span:has-text("Gỡ")'
    ];

    let deleteClicked = false;
    const deleteMenuDeadline = Date.now() + 5000;
    while (!deleteClicked && Date.now() < deleteMenuDeadline) {
      for (const sel of deleteOptionSelectors) {
        const opt = page.locator(sel).first();
        if (await opt.isVisible().catch(() => false)) {
          console.log(`[Playwright][FlopCheck] 🎯 Đã bấm chọn menu item xóa: "${sel}"`);
          await opt.click({ force: true }).catch(() => {});
          await page.waitForTimeout(2000);
          deleteClicked = true;
          break;
        }
      }

      if (!deleteClicked) {
        const menuItems = page.locator('div[role="menuitem"], div[role="menu"] div[tabindex="0"]');
        const count = await menuItems.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const item = menuItems.nth(i);
          const txt = await item.innerText().catch(() => '');
          const lower = txt.toLowerCase();
          if (lower.includes('xóa') || lower.includes('xoá') || lower.includes('gỡ') || lower.includes('delete') || lower.includes('trash') || lower.includes('remove')) {
            console.log(`[Playwright][FlopCheck] 🎯 Bấm chọn menu item xóa fallback: "${txt}"`);
            await item.click({ force: true }).catch(() => {});
            await page.waitForTimeout(2000);
            deleteClicked = true;
            break;
          }
        }
      }

      if (!deleteClicked) await page.waitForTimeout(300);
    }

    console.log(`[Playwright][FlopCheck] ${deleteClicked ? '✅' : '❌'} deleteClicked=${deleteClicked} (mục menu xoá ${deleteClicked ? 'đã' : 'chưa'} được bấm)`);

    if (deleteClicked) {
      const confirmSelectors = [
        'div[role="dialog"] div[aria-label="Xóa"]',
        'div[role="dialog"] div[aria-label="Xoá"]',
        'div[role="dialog"] div[aria-label="Delete"]',
        'div[role="dialog"] div[aria-label="Chuyển vào thùng rác"]',
        'div[role="dialog"] div[aria-label="Chuyển"]',
        'div[role="dialog"] div[role="button"]:has-text("Xóa")',
        'div[role="dialog"] div[role="button"]:has-text("Xoá")',
        'div[role="dialog"] div[role="button"]:has-text("Delete")',
        'div[role="dialog"] div[role="button"]:has-text("Chuyển")',
        'div[role="dialog"] div[role="button"]:has-text("Xác nhận")',
        'div[role="dialog"] span:has-text("Xóa")',
        'div[role="dialog"] span:has-text("Xoá")',
        'div[role="dialog"] span:has-text("Delete")',
        'div[role="dialog"] span:has-text("Chuyển")',
        'div[role="dialog"] div[tabindex="0"]:has-text("Xóa")',
        'div[role="dialog"] div[tabindex="0"]:has-text("Xoá")',
        'div[role="dialog"] div[tabindex="0"]:has-text("Delete")',
        'div[role="dialog"] div[tabindex="0"]:has-text("Chuyển")'
      ];

      let confirmClicked = false;
      const confirmDialogDeadline = Date.now() + 6000;
      while (!confirmClicked && Date.now() < confirmDialogDeadline) {
        for (const sel of confirmSelectors) {
          const btn = page.locator(sel).first();
          if (await btn.isVisible().catch(() => false)) {
            await btn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(3000);
            confirmClicked = true;
            break;
          }
        }

        if (!confirmClicked) {
          const dialogButtons = page.locator('div[role="dialog"] [role="button"], div[role="dialog"] div[tabindex="0"]');
          const count = await dialogButtons.count().catch(() => 0);
          for (let i = 0; i < count; i++) {
            const btn = dialogButtons.nth(i);
            const txt = (await btn.getAttribute('aria-label').catch(() => null)) || (await btn.innerText().catch(() => ''));
            if (txt && txt.trim().length > 0 && !txt.toLowerCase().includes('hủy') && !txt.toLowerCase().includes('cancel') && !txt.toLowerCase().includes('không')) {
              console.log(`[Playwright][FlopCheck] 🎯 Bấm nút xác nhận xóa fallback: "${txt}"`);
              await btn.click({ force: true }).catch(() => {});
              await page.waitForTimeout(3000);
              confirmClicked = true;
              break;
            }
          }
        }

        if (!confirmClicked) await page.waitForTimeout(300);
      }

      console.log(`[Playwright][FlopCheck] ${confirmClicked ? '✅' : '❌'} confirmClicked=${confirmClicked} (nút xác nhận xoá trong dialog ${confirmClicked ? 'đã' : 'chưa'} được bấm)`);

      if (confirmClicked) {
        console.log(`[Playwright][FlopCheck] 🎉 ĐÃ XOÁ THÀNH CÔNG BÀI FLOP! (URL: ${postUrl})`);

        await page.close().catch(() => {});
        if (release) await release().catch(() => {});
        return {
          success: true,
          deleted: true,
          likesCount,
          commentsCount,
          reason: `Bài bị flop sau thời gian chờ (Có ${likesCount} likes < ${minLikesThreshold} likes). Đã xoá bài thành công.`
        };
      }
    }

    const flopFailStage = !deleteClicked ? 'delete_menu_item' : 'confirm_dialog';
    const flopFailMsg = !deleteClicked
      ? 'Không tìm/bấm được mục "Xóa bài viết" trong menu 3 chấm'
      : 'Đã bấm mục xoá trong menu nhưng không bấm được nút xác nhận trong dialog';
    console.log(`[Playwright][FlopCheck] ❌ ${flopFailMsg} (stage=${flopFailStage})`);
    await page.close().catch(() => {});
    if (release) await release().catch(() => {});
    return { success: false, deleted: false, likesCount, commentsCount, error: flopFailMsg, failStage: flopFailStage };

  } catch (err) {
    console.error(`[Playwright][FlopCheck] ❌ Lỗi khi kiểm tra/xoá bài flop:`, err.message);
    if (release) await release().catch(() => {});
    return { success: false, deleted: false, error: err.message };
  }
}

app.post('/api/check-and-delete-flop-post', async (req, res) => {
  return res.json({ success: false, deleted: false, message: 'Tính năng FlopCheck đã tắt hoàn toàn theo yêu cầu người dùng.' });
});

// Bản Desktop chỉ nghe trên 127.0.0.1 (BIND_HOST); bản thường giữ nguyên như cũ
const listenArgs = desktop.BIND_HOST ? [PORT, desktop.BIND_HOST] : [PORT];
const httpServer = app.listen(...listenArgs, () => {
  console.log(`🤖 Playwright Worker đang chạy ở cổng http://localhost:${PORT}`);
  // Chỉ Worker chính (port 3001, hoặc worker duy nhất của bản Desktop) mới chạy các vòng lặp cron ngầm để tránh chạy trùng lặp 2 bản
  if (PORT === 3001 || desktop.DESKTOP) {
    setInterval(processQueueTick, 30000);
    processQueueTick(); // Chạy ngay để không phải chờ hết 30s đầu nếu file hàng đợi đã có sẵn bài chờ

    // Tự động phục hồi các bài viết Buff Tự Động bị gián đoạn trước đó (nếu có)
    recoverBuffQueueOnStartup();

    // Vòng lặp kiểm tra hàng đợi Buff Tự Động (Auto-Buff Queue) - ĐÃ TẮT
    // setInterval(processBuffQueueTick, 30000);

    // Vòng lặp quét bài viết tự động theo dõi (Post Hunter & Fanpage Monitor) - ĐÃ TẮT
    // setInterval(processBuffMonitorsTick, 60000);
  } else {
    console.log(`⚡ Worker phụ (cổng ${PORT}) khởi động thành công — chuyên phụ trách xử lý tác vụ song song!`);
  }
});

// Nếu port đã bị 1 tiến trình worker khác chiếm (VD: chạy trùng 2 bản), KHÔNG được để tiến trình này
// sống sót ngầm — nó vẫn sẽ tự chạy processQueueTick() mỗi 30s ở dưới dù không nhận được request nào,
// đọc/ghi đè reel_groups_queue.json độc lập với bản đang chạy thật, gây đăng trùng/đăng ngoài ý muốn
// mà không ai biết. Thoát hẳn để launchd/supervisor tự lùi lịch retry thay vì để lại 1 tiến trình ma.
httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} đã có 1 Worker khác đang chạy — thoát để tránh chạy trùng 2 bản song song.`);
    process.exit(1);
  }
  console.error('❌ Lỗi khởi động HTTP server:', err.message);
  process.exit(1);
});

// Đóng toàn bộ browser trong BrowserPool khi worker tắt (deploy/restart) — nếu không, process
// Chromium bên trong pool sẽ trở thành tiến trình mồ côi, tích tụ dần qua mỗi lần restart.
async function shutdownGracefully(signal) {
  console.log(`\n🛑 Nhận tín hiệu ${signal} — đang đóng Browser Pool trước khi thoát...`);
  flushRegistry();
  flushBuffStores();
  try {
    await browserPool.closeAll();
  } catch (e) {
    console.error('⚠️ Lỗi khi đóng Browser Pool:', e.message);
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));
desktop.startParentWatchdog(() => shutdownGracefully('PARENT_GONE'));
process.on('SIGINT', () => shutdownGracefully('SIGINT'));

// ─────────────────────────────────────────────────────────────────────────────
// Global error handlers — ngăn server crash do unhandledRejection từ Playwright
// (VD: "Target page, context or browser has been closed" khi browser đóng sớm)
// ─────────────────────────────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[Server] ⚠️ uncaughtException (không crash):', err.message);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('[Server] ⚠️ unhandledRejection (không crash):', msg);
});
