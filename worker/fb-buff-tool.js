/**
 * FB BUFF TOOL - BUFF LIKE ẨN BẰNG FANPAGE & BUFF VIEW VIDEO/REELS
 * Hỗ trợ:
 * 1. Quét toàn bộ Fanpage từ Cookie nick mẹ (Profile Pages / New Page Experience).
 * 2. Buff Like/Reaction (LIKE, LOVE, CARE, HAHA, WOW, SAD, ANGRY) bằng danh tính Fanpage vào bài viết (Like ẩn).
 * 3. Buff View Video/Reels đa luồng (Headless Playwright, tối ưu RAM/băng thông).
 */

const { chromium } = require('playwright');
const { getDeviceForUid, applyFingerprintToContext } = require('./device-fingerprints');
const {
  filterAvailablePagesForPost,
  recordPagePostInteraction,
  hasPageInteractedWithPost,
  getGlobalRegistryStats,
  normalizeFbPostUrl,
} = require('./page-post-registry');
const { isEmergencyStopped, loadSettings } = require('./telegram-alert');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// ==========================================
// 1. CÁC HÀM TIỆN ÍCH COOKIE & PARSING
// ==========================================

function parseCookieString(cookieStr, domain = '.facebook.com') {
  if (!cookieStr || typeof cookieStr !== 'string') return [];
  const parts = cookieStr.split(';');
  const cookies = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    if (name) {
      cookies.push({
        name,
        value,
        domain,
        path: '/',
        httpOnly: name === 'xs' || name === 'sb',
        secure: true,
        sameSite: 'Lax',
      });
    }
  }
  return cookies;
}

function getUserIdFromCookie(cookieStr) {
  const match = cookieStr.match(/(?:^|;\s*)c_user=([0-9]+)/);
  return match ? match[1] : null;
}

// ==========================================
// 1b. QUẢN LÝ BỘ NHỚ ĐỆM FANPAGE (PAGES CACHE)
// ==========================================

const PAGES_CACHE_FILE = path.join(__dirname, 'pages_cache.json');
// Cache hết hạn để page mới được gán (vd. page trong BM) tự xuất hiện ở lần quét sau
const PAGES_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function loadPagesCache() {
  try {
    if (fs.existsSync(PAGES_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(PAGES_CACHE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.warn('[PagesCache] ⚠️ Lỗi đọc file cache Fanpage:', e.message);
  }
  return {};
}

function savePagesCache(cache) {
  try {
    const tmp = `${PAGES_CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, PAGES_CACHE_FILE);
  } catch (e) {
    console.warn('[PagesCache] ⚠️ Lỗi lưu file cache Fanpage:', e.message);
  }
}

function getCachedPages(uid) {
  if (!uid) return null;
  const cache = loadPagesCache();
  const entry = cache[uid];
  if (entry && Array.isArray(entry.pages) && entry.pages.length > 0) {
    const age = Date.now() - new Date(entry.updatedAt || 0).getTime();
    if (!(age < PAGES_CACHE_TTL_MS)) return null;
    return entry.pages;
  }
  return null;
}

function setCachedPages(uid, pages, viaName = '') {
  if (!uid || !Array.isArray(pages)) return;
  const cache = loadPagesCache();
  cache[uid] = {
    uid,
    viaName: viaName || `Via_${uid}`,
    updatedAt: new Date().toISOString(),
    count: pages.length,
    pages,
  };
  savePagesCache(cache);
}

// ==========================================
// 1c. BỘ ĐIỀU TIẾT CHỐNG KIỆT SỨC FANPAGE (PAGE FATIGUE GOVERNOR) & PROXY PARSER
// ==========================================

function parseProxy(proxyStr) {
  if (!proxyStr || typeof proxyStr !== 'string') return null;
  try {
    const trimmed = proxyStr.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('socks5://')) {
      const u = new URL(trimmed);
      const res = { server: `${u.protocol}//${u.hostname}:${u.port}` };
      if (u.username) res.username = decodeURIComponent(u.username);
      if (u.password) res.password = decodeURIComponent(u.password);
      return res;
    }
    const parts = trimmed.split(':');
    if (parts.length === 4) {
      return {
        server: `http://${parts[0]}:${parts[1]}`,
        username: parts[2],
        password: parts[3],
      };
    }
    if (parts.length === 2) {
      return {
        server: `http://${parts[0]}:${parts[1]}`,
      };
    }
  } catch (e) {}
  return null;
}

const PAGE_USAGE_FILE = path.join(__dirname, 'page_usage.json');

function loadPageUsage() {
  try {
    if (fs.existsSync(PAGE_USAGE_FILE)) {
      return JSON.parse(fs.readFileSync(PAGE_USAGE_FILE, 'utf-8'));
    }
  } catch (e) {}
  return {};
}

function savePageUsage(data) {
  try {
    const tmp = `${PAGE_USAGE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, PAGE_USAGE_FILE);
  } catch (e) {}
}

// Ngày theo giờ Việt Nam (YYYY-MM-DD) để giới hạn reset lúc 0h chứ không phải 7h sáng (UTC)
function usageDateKey() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function recordPageAction(pageId) {
  if (!pageId) return;
  const today = usageDateKey();
  let usage = loadPageUsage();
  if (!usage[today]) {
    // Chỉ giữ 7 ngày gần nhất
    const kept = {};
    for (const d of Object.keys(usage).sort().slice(-6)) kept[d] = usage[d];
    kept[today] = {};
    usage = kept;
  }
  usage[today][pageId] = (usage[today][pageId] || 0) + 1;
  savePageUsage(usage);
}

function getPageUsageToday(pageId) {
  if (!pageId) return 0;
  const usage = loadPageUsage();
  const today = usageDateKey();
  return (usage[today] && usage[today][pageId]) || 0;
}

function getDailyPageActionLimit() {
  const limit = parseInt(loadSettings().maxDailyPageActions, 10);
  return Number.isFinite(limit) && limit > 0 ? limit : 25;
}

// ==========================================
// 2. QUÉT DANH SÁCH FANPAGE TỪ COOKIE NICK MẸ
// ==========================================

// Quét bảng "Trang & trang cá nhân của bạn" (menu tài khoản → Xem tất cả trang cá nhân → Xem thêm trang...).
// ID lấy từ phản hồi GraphQL khi bấm "Xem thêm trang"; page nào chỉ có tên (thường là URL vanity) thì
// tra ID bằng link trên your_pages.
async function scanProfileSwitcherPages(page, uid) {
  const idByName = new Map();
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (typeof o.id === 'string' && /^\d{9,}$/.test(o.id) && typeof o.name === 'string' && o.name && !idByName.has(o.name)) {
      idByName.set(o.name, o.id);
    }
    for (const k of Object.keys(o)) walk(o[k]);
  };
  const onResponse = async (r) => {
    if (!r.url().includes('/api/graphql')) return;
    try {
      const text = await r.text();
      for (const line of text.split('\n')) {
        try { walk(JSON.parse(line)); } catch (e) {}
      }
    } catch (e) {}
  };

  // Link của từng card trên your_pages (để tra page vanity), lấy trước khi rời trang
  const cardLinks = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('a[href]').forEach((a) => {
      const name = (a.innerText || '').trim().split('\n')[0];
      const href = a.href || '';
      if (name && !out[name] && /^https:\/\/www\.facebook\.com\/[^/?#]+\/?$/.test(href)) out[name] = href;
    });
    return out;
  }).catch(() => ({}));

  page.on('response', onResponse);
  try {
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    await page.locator('[aria-label="Trang cá nhân của bạn"], [aria-label="Your profile"]').first().click({ timeout: 8000 });
    await page.waitForTimeout(2000);
    await page.getByText(/^(Xem tất cả trang cá nhân|See all profiles)$/).first().click({ timeout: 8000 });
    await page.waitForTimeout(2500);

    const dialog = page.locator('div[role="dialog"]').filter({ hasText: /Trang & trang cá nhân của bạn|Your profiles and Pages/ }).first();
    for (let i = 0; i < 100; i++) {
      const more = dialog.getByText(/^(Xem thêm trang|See more Pages|See more pages)$/).first();
      if (!(await more.isVisible().catch(() => false))) break;
      await more.click().catch(() => {});
      await page.waitForTimeout(1500);
    }

    const names = await dialog.evaluate((dlg) => {
      const noise = /^(Xem thêm trang|See more pages|Tạo|Create|Đi đến Trung tâm tài khoản|Go to Accounts Center|\d+ thông báo|Tìm kiếm.*)$/i;
      const set = new Set();
      dlg.querySelectorAll('[role="listitem"], [role="radio"], [role="button"], a').forEach((e) => {
        const t = (e.innerText || '').split('\n')[0].trim();
        if (t && t.length > 1 && t.length < 80 && !noise.test(t)) set.add(t);
      });
      return [...set];
    });
    await page.keyboard.press('Escape').catch(() => {});

    const results = [];
    for (const name of names) {
      let id = idByName.get(name) || '';
      let url = id ? `https://www.facebook.com/profile.php?id=${id}` : cardLinks[name] || '';
      if (!id && url) {
        // Page vanity: ID nằm ở "userID" trong HTML trang tường của page
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(2500);
        const html = await page.content().catch(() => '');
        const m = html.match(/"userID":"(\d{9,})"/);
        if (m && m[1] !== String(uid)) id = m[1];
      }
      if (!id || id === String(uid)) continue;
      results.push({ id, name, url: url || `https://www.facebook.com/profile.php?id=${id}` });
    }
    return results;
  } finally {
    page.off('response', onResponse);
  }
}

/**
 * Quét danh sách tất cả các Fanpage mà tài khoản đang sở hữu/quản lý (hỗ trợ Cache)
 * @param {string} cookieStr - Chuỗi cookie của nick Facebook mẹ
 * @param {object} options - { forceRefresh: boolean, viaName: string, proxyUrl: string }
 * @returns {Promise<Array<{ id: string, name: string, url: string }>>}
 */
async function getManagedPages(cookieStr, options = {}) {
  const { forceRefresh = false, viaName = '', proxyUrl = '' } = options;
  const cookies = parseCookieString(cookieStr);
  if (!cookies.length) {
    throw new Error('Cookie rỗng hoặc không đúng định dạng');
  }

  const uid = getUserIdFromCookie(cookieStr);
  if (!forceRefresh && uid) {
    const cached = getCachedPages(uid);
    if (cached && cached.length > 0) {
      console.log(`[FB-Buff] ⚡ [CACHE HIT] Đã lấy ${cached.length} Fanpage từ cache cho UID: ${uid} (không tốn thời gian quét lại)`);
      return cached;
    }
  }

  const proxy = parseProxy(proxyUrl);
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-notifications',
      '--mute-audio',
      '--disable-gpu',
    ],
    proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    await context.addCookies(cookies);
    const page = await context.newPage();

    console.log('[FB-Buff] 🔄 Đang truy cập Facebook để lấy danh sách Fanpage...');
    await page.goto('https://www.facebook.com/pages/?category=your_pages', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(4000);

    // Kiểm tra đăng nhập
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
      throw new Error('Cookie đã hết hạn hoặc bị checkpoint');
    }

    // CUỘN TẢI SÂU TOÀN BỘ DANH SÁCH FANPAGE (DÀNH CHO TÀI KHOẢN BM CÓ HÀNG TRĂM PAGE)
    console.log('[FB-Buff] 📜 Đang cuộn trang tự động để quét toàn bộ hàng trăm Fanpage trong BM...');
    let lastFoundCount = 0;
    let staleRounds = 0;
    const maxScrollRounds = 35; // Hỗ trợ quét tới 500+ Fanpage

    for (let round = 0; round < maxScrollRounds; round++) {
      const currentCards = await page.evaluate(() => {
        window.scrollBy(0, 1600);
        return document.querySelectorAll('div[role="article"], a[href*="/profile.php?id="], a[href*="/pages/"]').length;
      });
      await page.waitForTimeout(900);

      if (currentCards === lastFoundCount) {
        staleRounds++;
        if (staleRounds >= 3) {
          // Thử cuộn tận đáy trang một lần cuối để đảm bảo đã tải sạch
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(1500);
          const finalCards = await page.evaluate(() => document.querySelectorAll('div[role="article"], a[href*="/profile.php?id="], a[href*="/pages/"]').length);
          if (finalCards === lastFoundCount) break;
        }
      } else {
        staleRounds = 0;
        lastFoundCount = currentCards;
        if (round % 5 === 0 && round > 0) {
          console.log(`[FB-Buff] 🔄 Tiến trình quét Fanpage BM: Đã nhận diện ~${currentCards} thẻ...`);
        }
      }
    }

    // Trích xuất danh sách Fanpage từ giao diện web một cách chuẩn xác
    const pageList = await page.evaluate(() => {
      const pageMap = new Map(); // pageId -> { id, name, url }
      const noiseRegex = /^(?:\d+\s*(?:thông báo|tin nhắn|notifications?|messages?)|chuyển sang|chuyển ngay|switch|quản lý|manage|xem trang|view page|trang cá nhân|profile)$/i;

      const cleanPageName = (raw) => {
        if (!raw) return '';
        let cleaned = raw
          .replace(/(?:\r?\n|^)\s*\d+\s*(?:thông báo|tin nhắn|notifications?|messages?)[^\n]*/gi, '')
          .replace(/(?:\r?\n|^)\s*(?:Chuyển sang|Chuyển ngay|Switch into|Switch now|Quản lý|Manage|Xem trang)[^\n]*/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        return cleaned;
      };

      // 1. Quét các thẻ cha đại diện cho từng Fanpage Card
      const cardContainers = document.querySelectorAll('div[role="article"], div[data-visualcompletion="ignore-dynamic-extra-content"], div[role="listitem"], a[href*="/profile.php?id="]');

      cardContainers.forEach((card) => {
        const link = card.tagName === 'A' ? card : card.querySelector('a[href*="/profile.php?id="], a[href*="/pages/"]');
        if (!link) return;

        const href = link.getAttribute('href') || '';
        const idMatch = href.match(/id=([0-9]{10,})/);
        if (!idMatch) return;
        const pageId = idMatch[1];

        // Tìm tiêu đề tên Fanpage từ các thẻ tiêu đề hoặc span chính
        const titleEl = card.querySelector('h2, h3, h4, strong, span[dir="auto"], span.x1lliihq') || link;
        const rawTitle = titleEl ? (titleEl.innerText || titleEl.textContent || '') : '';
        const cleanedTitle = cleanPageName(rawTitle);

        if (cleanedTitle && cleanedTitle.length > 1 && !noiseRegex.test(cleanedTitle)) {
          if (!pageMap.has(pageId) || (pageMap.get(pageId).name.length < cleanedTitle.length && !noiseRegex.test(cleanedTitle))) {
            pageMap.set(pageId, {
              id: pageId,
              name: cleanedTitle,
              url: href.startsWith('http') ? href : `https://www.facebook.com${href}`,
            });
          }
        }
      });

      // 2. Quét dự phòng toàn bộ các link nếu chưa đủ
      const allLinks = document.querySelectorAll('a[href*="/profile.php?id="]');
      allLinks.forEach((a) => {
        const href = a.getAttribute('href') || '';
        const idMatch = href.match(/id=([0-9]{10,})/);
        if (!idMatch) return;
        const pageId = idMatch[1];

        const raw = a.innerText || a.textContent || '';
        const cleaned = cleanPageName(raw);

        if (cleaned && cleaned.length > 1 && !noiseRegex.test(cleaned)) {
          if (!pageMap.has(pageId)) {
            pageMap.set(pageId, {
              id: pageId,
              name: cleaned,
              url: href.startsWith('http') ? href : `https://www.facebook.com${href}`,
            });
          } else {
            // Nếu tên hiện tại đang là dạng số hoặc quá ngắn mà tên mới đẹp hơn
            const current = pageMap.get(pageId);
            if (noiseRegex.test(current.name) || (current.name.length < cleaned.length && !noiseRegex.test(cleaned))) {
              current.name = cleaned;
            }
          }
        }
      });

      // 3. Chuẩn hóa lại lần cuối
      const results = [];
      for (const [id, item] of pageMap.entries()) {
        item.name = cleanPageName(item.name);
        if (!item.name || noiseRegex.test(item.name)) {
          item.name = `Fanpage (${id.slice(-4)})`;
        }
        results.push(item);
      }

      return results;
    });

    // Bổ sung từ bảng "Trang & trang cá nhân của bạn": đây đúng là danh sách page nick chuyển sang được,
    // thường nhiều hơn your_pages (page BM được gán, page dùng URL vanity...)
    try {
      const extra = await scanProfileSwitcherPages(page, uid);
      const known = new Set(pageList.map((p) => p.id));
      const knownNames = new Set(pageList.map((p) => p.name));
      let added = 0;
      for (const item of extra) {
        if (known.has(item.id) || (knownNames.has(item.name) && !item.id)) continue;
        known.add(item.id);
        pageList.push(item);
        added++;
      }
      console.log(`[FB-Buff] 🔁 Bảng chuyển trang cá nhân: ${extra.length} page, bổ sung thêm ${added} page.`);
    } catch (err) {
      console.warn(`[FB-Buff] ⚠️ Không quét được bảng chuyển trang cá nhân: ${err.message}`);
    }

    console.log(`[FB-Buff] ✅ Đã tìm thấy và làm sạch tên ${pageList.length} Fanpage được quản lý.`);
    if (uid && pageList.length > 0) {
      setCachedPages(uid, pageList, viaName);
    }
    return pageList;
  } finally {
    await browser.close().catch(() => {});
  }
}

// ==========================================
// 3. BUFF LIKE ẨN BẰNG FANPAGE (PAGE REACTIONS & COMMENTS)
// ==========================================

/**
 * Giải mã cú pháp Spintax {A|B|C} đa tầng/lồng nhau (Nested Spintax) thành chuỗi ngẫu nhiên
 * Ví dụ: "{ {Chào|Hello} {bạn|shop} | {Bài viết|Nội dung} {quá hay|rất ý nghĩa} } {ạ!|nha!}"
 */
function resolveSpintax(text) {
  if (!text || typeof text !== 'string') return '';
  let result = text;
  let safety = 20;
  while (result.includes('{') && result.includes('}') && safety > 0) {
    const next = result.replace(/\{([^{}]+)\}/g, (_, choices) => {
      const options = choices.split('|');
      const chosen = options[Math.floor(Math.random() * options.length)];
      return (chosen !== undefined ? chosen : '').trim();
    });
    if (next === result) break;
    result = next;
    safety--;
  }
  return result.trim();
}

/**
 * Danh sách hậu tố tự nhiên giúp biến đổi bình luận tránh Meta/Admin phạt trùng lặp
 */
const NATURAL_VI_VARIATIONS = [
  ' ạ ❤️', ' nha bạn!', ' nhé 👍', ' quá nè ✨', ' bạn ơi 😊',
  ' quá ạ 🥰', ' luôn nè 🌟', ' nha shop 🍀', ' quá trời 👏', ' nha ạ ✨',
  ' nè bạn ơi!', ' nhé bạn 💖', ' ạ, cảm ơn bạn!', ' nè 🥰', ' nha! 🍀',
];

const REACTED_ARIA_RE = /(Gỡ|Remove|Đã thích|Liked|Thay đổi|Change)/i;
// Sau khi thả cảm xúc khác Like, nút Like hiển thị tên cảm xúc đó thay cho "Thích"
const REACTION_NAME_RE = /^(Yêu thích|Thương thương|Haha|Wow|Buồn|Phẫn nộ|Love|Care|Sad|Angry)$/i;

function isReactedState(state, beforeAria) {
  if (!state) return false;
  if (state.pressed === 'true') return true;
  if (REACTED_ARIA_RE.test(state.aria)) return true;
  if (REACTION_NAME_RE.test(state.aria) || REACTION_NAME_RE.test(state.text)) return true;
  return Boolean(state.aria) && state.aria !== beforeAria && !/^(Thích|Like)$/i.test(state.aria);
}

const readButtonState = (el) => ({
  aria: el.getAttribute('aria-label') || '',
  pressed: el.getAttribute('aria-pressed') || '',
  text: (el.innerText || '').trim(),
});

// Xác nhận nút Like đã chuyển sang trạng thái "đã bày tỏ cảm xúc" sau khi click.
// Facebook hay render lại nút khi thả LOVE/CARE nên handle cũ có thể bị detached/còn trạng thái cũ:
// khi đó tìm lại nút bằng refind() và poll thêm vài lần.
async function verifyReacted(handle, beforeAria, refind = null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600));
    if (handle) {
      const state = await handle.evaluate(readButtonState).catch(() => null);
      if (isReactedState(state, beforeAria)) return true;
    }
    if (refind) {
      const fresh = await refind().catch(() => null);
      if (fresh) {
        const state = await fresh.evaluate(readButtonState).catch(() => null);
        if (isReactedState(state, beforeAria)) return true;
      }
    }
  }
  return false;
}

/**
 * Thực hiện buff Like/Reaction và Comment bài viết bằng các Fanpage
 * @param {string} cookieStr - Cookie nick mẹ
 * @param {string} targetUrl - Link bài viết / Reels / Video cần buff
 * @param {object} options - Cấu hình: { reactionType, selectedPages, delayMs, enableLike, enableComment, comments }
 */
async function buffLikesWithPages(cookieStr, targetUrl, options = {}) {
  const {
    reactionType = 'RANDOM_POSITIVE', // Mặc định RANDOM_POSITIVE (65% Like, 25% Love, 10% Care) để tương tác tự nhiên, chống Meta AI phát hiện bot
    selectedPages = [],    // Mảng các page { id, name, comment? } hoặc để trống để tự quét
    delayMs = 3800,        // Độ trễ an toàn tối thiểu giữa mỗi lần thả like (mặc định 3.8s + jitter ngẫu nhiên)
    enableLike = true,     // Có thả Like/Reaction không (mặc định true)
    enableComment = false, // Có viết bình luận bằng Fanpage không (mặc định false)
    enableHumanBehavior = true, // Hành vi lướt tự nhiên chống checkpoint (mặc định true)
    fastSwitch = true,     // Ưu tiên đổi danh tính trực tiếp trên bài viết bằng Voice Switcher (tiết kiệm 15s/lần)
    cooldownEvery = 12,    // Cứ mỗi 10-12 page nghỉ an toàn chống checkpoint
    cooldownDurationMs = 25000, // Thời gian nghỉ ngơi an toàn mỗi lô (25s - 35s)
    comments = [],         // Mảng danh sách nội dung bình luận
    proxyUrl = '',         // URL Proxy riêng biệt cho Via (http://user:pass@host:port)
    maxActionsPerPageToday = getDailyPageActionLimit(), // Giới hạn lượt tương tác/ngày cho mỗi Page (Cài đặt hệ thống)
    onProgress,            // Callback nhận tiến trình: onProgress(event)
    shouldStop,            // () => boolean: người gọi yêu cầu dừng (client ngắt kết nối, dừng khẩn cấp...)
  } = options;
  const isStopRequested = () => isEmergencyStopped() || (typeof shouldStop === 'function' && shouldStop());

  if (isEmergencyStopped()) {
    throw new Error('Hệ thống đang ở trạng thái DỪNG KHẨN CẤP (Emergency Stop). Tác vụ đã bị từ chối thực thi.');
  }

  const normalizedPostUrl = normalizeFbPostUrl(targetUrl);

  let pages = selectedPages;
  if (!pages || pages.length === 0) {
    console.log('[FB-Buff] 🔄 Chưa truyền danh sách page, tự động quét Fanpage từ Cookie...');
    pages = await getManagedPages(cookieStr, { proxyUrl });
  }

  if (pages.length === 0) {
    throw new Error('Không tìm thấy Fanpage nào trong tài khoản để thực hiện');
  }

  // BẢO VỆ CHỐNG TRÙNG LẶP & CHỐNG HỦY LIKE (UN-LIKE):
  // Tự động loại bỏ bất kỳ Fanpage nào đã từng tương tác với bài viết này trong lịch sử
  const originalPagesCount = pages.length;
  pages = filterAvailablePagesForPost(normalizedPostUrl, pages);
  if (pages.length === 0) {
    console.log(`[FB-Buff] ℹ️ Toàn bộ ${originalPagesCount} Fanpage đã tương tác với bài viết "${normalizedPostUrl}" trước đó. Không còn page nào mới để buff.`);
    return {
      total: originalPagesCount,
      success: 0,
      failed: 0,
      allAlreadyInteracted: true,
      message: 'Toàn bộ Fanpage đã tương tác với bài viết này trước đó (đã tự động bỏ qua để chống hủy like)',
      details: [],
    };
  }

  // GIỚI HẠN LƯỢT/NGÀY: bỏ qua Page đã đủ lượt hôm nay, ưu tiên Page hoạt động ít nhất
  const usageToday = loadPageUsage()[usageDateKey()] || {};
  const usedToday = (id) => usageToday[id] || 0;
  const cappedDetails = [];
  pages = pages.filter((p) => {
    const used = usedToday(p.id);
    if (used < maxActionsPerPageToday) return true;
    cappedDetails.push({
      pageId: p.id,
      pageName: p.name,
      status: 'SKIPPED',
      likeStatus: 'SKIPPED',
      commentStatus: 'SKIPPED',
      message: `Đã đủ ${maxActionsPerPageToday} lượt hôm nay`,
    });
    return false;
  });
  if (cappedDetails.length > 0) {
    console.log(`[FB-Buff] 🛡️ Bỏ qua ${cappedDetails.length} Page đã đạt giới hạn ${maxActionsPerPageToday} lượt/ngày.`);
    if (typeof onProgress === 'function') {
      cappedDetails.forEach((item, idx) => onProgress({ type: 'PAGE_FINISH', index: idx, total: cappedDetails.length, percent: 0, ...item }));
    }
  }
  if (pages.length === 0) {
    return {
      total: cappedDetails.length,
      success: 0,
      failed: 0,
      skipped: cappedDetails.length,
      allCapped: true,
      message: `Toàn bộ Page đã đạt giới hạn ${maxActionsPerPageToday} lượt hôm nay`,
      details: cappedDetails,
    };
  }
  pages.sort((a, b) => usedToday(a.id) - usedToday(b.id));

  console.log(`[FB-Buff] 🚀 Bắt đầu Buff Tương Tác cho link: ${targetUrl}`);
  console.log(`[FB-Buff] 🎯 Mục tiêu: ${pages.length} Fanpage (Đã lọc trùng an toàn) | Thả Like: ${enableLike ? reactionType : 'TẮT'} | Bình luận: ${enableComment ? 'BẬT' : 'TẮT'} | Proxy: ${proxyUrl ? 'BẬT' : 'Direct'} | Fast-Switch: ${fastSwitch ? 'BẬT' : 'TẮT'}`);

  const results = {
    total: pages.length + cappedDetails.length,
    success: 0,
    failed: 0,
    unverified: 0,
    skipped: cappedDetails.length,
    stopped: false,
    details: [...cappedDetails],
  };

  // Khởi tạo context và tab duy nhất cho toàn bộ phiên buff với device fingerprint và persistent profile
  const currentCookie = cookieStr || '';
  const cookies = parseCookieString(currentCookie);
  const cUserMatch = currentCookie.match(/(?:^|;\s*)c_user=([^;]+)/);
  const uid = cUserMatch ? cUserMatch[1] : '';
  const device = getDeviceForUid(uid);
  const proxy = parseProxy(proxyUrl);
  console.log(`[FB-Buff] 📱 Giả lập phần cứng độc lập (${device.name}) cho UID: ${uid || 'N/A'}${proxy ? ` qua Proxy ${proxy.server}` : ''}`);

  let context;
  let browser = null;

  if (uid) {
    const profileDir = path.join(__dirname, 'browser_profiles', `via_${uid}`);
    fs.mkdirSync(profileDir, { recursive: true });
    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-notifications',
        '--mute-audio',
        '--disable-gpu',
        '--disable-webrtc',
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        '--enforce-webrtc-ip-permission-check',
      ],
      proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
      userAgent: device.userAgent,
      viewport: device.viewport,
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile,
      hasTouch: device.hasTouch,
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
    });
  } else {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-notifications',
        '--mute-audio',
        '--disable-gpu',
        '--disable-webrtc',
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        '--enforce-webrtc-ip-permission-check',
      ],
      proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
    });
    try {
      context = await browser.newContext({
        userAgent: device.userAgent,
        viewport: device.viewport,
        deviceScaleFactor: device.deviceScaleFactor,
        isMobile: device.isMobile,
        hasTouch: device.hasTouch,
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh',
        proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
      });
    } catch (e) {
      await browser.close().catch(() => {});
      throw e;
    }
  }

  try {
    await applyFingerprintToContext(context, device);
    if (cookies.length > 0) {
      await context.addCookies(cookies);
    }
    const tab = context.pages().length ? context.pages()[0] : await context.newPage();

    // Chặn tải các file ảnh/video/font nặng để tăng tốc độ tải trang tối đa (giữ CSS & DOM)
    await tab.route('**/*.{png,jpg,jpeg,gif,webp,mp4,mov,m4v,avi,svg,woff,woff2,ttf,eot,ico}', (route) => route.abort());

    // Phát hiện sớm popup chặn tính năng / hạn chế của Facebook để bảo vệ Via & BM
    const checkActionBlocked = async () => {
      try {
        const blocked = tab.locator(
          'div[role="dialog"]:has-text("Hành động này bị chặn"), ' +
          'div[role="dialog"]:has-text("Bạn tạm thời bị hạn chế"), ' +
          'div[role="dialog"]:has-text("You’re Temporarily Blocked"), ' +
          'div[role="dialog"]:has-text("Action Blocked"), ' +
          'div[role="dialog"]:has-text("Thử lại sau"), ' +
          'div[role="dialog"]:has-text("Try again later")'
        ).first();
        return (await blocked.count().catch(() => 0)) > 0 && (await blocked.isVisible().catch(() => false));
      } catch (e) {
        return false;
      }
    };

    const likeSelectorTiers = [
      'div[role="dialog"] [aria-label="Thích"], div[role="dialog"] [aria-label="Like"]',
      'div[role="dialog"] [aria-label*="bày tỏ cảm xúc"], div[role="dialog"] [aria-label*="Bày tỏ cảm xúc"]',
      'div[role="dialog"] [aria-label*="Thích bài viết"], div[role="dialog"] [aria-label*="Like post"]',
      'div[role="dialog"] [aria-label="Gỡ Thích"], div[role="dialog"] [aria-label="Remove Like"]',
      'div[role="article"] [aria-label="Thích"], div[role="article"] [aria-label="Like"]',
      'div[role="article"] [aria-label*="bày tỏ cảm xúc"], div[role="article"] [aria-label*="Bày tỏ cảm xúc"]',
      'div[role="article"] [aria-label*="Thích bài viết"], div[role="article"] [aria-label*="Like post"]',
      'div[role="article"] [aria-label="Gỡ Thích"], div[role="article"] [aria-label="Remove Like"]',
      '[aria-label="Thích"], [aria-label="Like"]',
      '[aria-label*="bày tỏ cảm xúc"], [aria-label*="Bày tỏ cảm xúc"], [aria-label*="Thích bài viết"], [aria-label*="Like post"]',
      'div[role="button"]:has-text("Thích"), div[role="button"]:has-text("Like")',
    ];

    const findLikeButton = async () => {
      for (const selector of likeSelectorTiers) {
        const locator = tab.locator(selector).first();
        if ((await locator.count().catch(() => 0)) > 0) {
          return locator;
        }
      }
      // 1. Nút Like chính của bài viết có data-ad-rendering-role="like_button"
      const roleLike = tab.locator('div[role="button"]:has([data-ad-rendering-role="like_button"]), [aria-label="Thích"]:has([data-ad-rendering-role="like_button"]), [aria-label="Like"]:has([data-ad-rendering-role="like_button"]), [aria-label="Gỡ Thích"]:has([data-ad-rendering-role="like_button"]), [aria-label="Remove Like"]:has([data-ad-rendering-role="like_button"])').first();
      if ((await roleLike.count().catch(() => 0)) > 0 && (await roleLike.isVisible().catch(() => false))) {
        return roleLike;
      }

      // 2. Trong dialog bài viết nếu hiển thị dưới dạng modal
      const dialogBtn = tab.locator('div[role="dialog"] div[role="button"]:has-text("Thích"), div[role="dialog"] div[role="button"]:has-text("Like"), div[role="dialog"] [aria-label="Thích"], div[role="dialog"] [aria-label="Like"]').first();
      if ((await dialogBtn.count().catch(() => 0)) > 0 && (await dialogBtn.isVisible().catch(() => false))) {
        return dialogBtn;
      }

      // 3. Trong danh sách tier chuẩn
      for (const selector of likeSelectorTiers) {
        const locator = tab.locator(selector).first();
        if ((await locator.count().catch(() => 0)) > 0 && (await locator.isVisible().catch(() => false))) {
          return locator;
        }
      }
      return null;
    };

    const triggerClick = async (el) => {
      try {
        // 1. Dispatch real synthetic mouse events (xuyên qua transparent interceptors/overlays của Facebook)
        await el.evaluate((element) => {
          ['mousedown', 'mouseup', 'click'].forEach((eventType) => {
            const evt = new MouseEvent(eventType, {
              bubbles: true,
              cancelable: true,
              view: window,
              buttons: 1,
            });
            element.dispatchEvent(evt);
          });
        });
      } catch (e) {
        try {
          await el.click({ force: true, timeout: 3500 });
        } catch (e2) {
          await el.evaluate((element) => element.click()).catch(() => {});
        }
      }
    };

    const switchPageIdentity = async (pageInfo) => {
      const isProfileVia = !pageInfo.id || pageInfo.id === uid || pageInfo.isProfile === true;
      const currentCookies = await context.cookies();
      const currentIUser = (currentCookies.find((c) => c.name === 'i_user') || {}).value;

      if (isProfileVia) {
        if (!currentIUser) return true;
        console.log(`[FB-Buff] 🔄 Đang chuyển từ Page (i_user: ${currentIUser}) về Nick mẹ UID: ${uid}...`);
        await tab.goto(`https://www.facebook.com/profile.php?id=${uid}`, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        await tab.waitForTimeout(2500);
        const switchBtn = tab.locator('div[role="button"]:has-text("Chuyển ngay"), div[role="button"]:has-text("Chuyển"), [aria-label="Chuyển ngay"], [aria-label="Chuyển"]').first();
        if (await switchBtn.isVisible().catch(() => false)) {
          await switchBtn.click({ force: true }).catch(() => {});
          await tab.waitForTimeout(3000);
          const confirmBtn = tab.locator('div[role="dialog"] div[role="button"]:has-text("Chuyển")').first();
          if (await confirmBtn.isVisible().catch(() => false)) {
            await confirmBtn.click({ force: true }).catch(() => {});
            await tab.waitForTimeout(4000);
          }
        }
        await context.clearCookies({ name: 'i_user' }).catch(() => {});
        return true;
      }

      if (currentIUser === String(pageInfo.id)) {
        console.log(`[FB-Buff] 🎯 Đã ở đúng danh tính Page "${pageInfo.name}" (ID: ${pageInfo.id})`);
        return true;
      }

      console.log(`[FB-Buff] 🔄 Đang chuyển sang danh tính Fanpage "${pageInfo.name}" (ID: ${pageInfo.id})...`);
      // Vào trực tiếp trang tường của Page để bấm nút Chuyển
      await tab.goto(`https://www.facebook.com/profile.php?id=${pageInfo.id}`, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
      await tab.waitForTimeout(2500);

      const switchBtn = tab.locator('div[role="button"]:has-text("Chuyển ngay"), div[role="button"]:has-text("Chuyển"), [aria-label="Chuyển ngay"], [aria-label="Chuyển"], div[role="button"]:has-text("Switch now"), div[role="button"]:has-text("Switch")').first();
      if (await switchBtn.isVisible().catch(() => false)) {
        await switchBtn.click({ force: true }).catch(() => {});
        await tab.waitForTimeout(2500);

        const confirmBtn = tab.locator('div[role="dialog"] div[role="button"]:has-text("Chuyển"), div[role="dialog"] div[role="button"]:has-text("Switch")').first();
        if (await confirmBtn.isVisible().catch(() => false)) {
          await confirmBtn.click({ force: true }).catch(() => {});
          await tab.waitForTimeout(3500);
        }
      } else {
        // Fallback qua switch URL endpoint
        const switchUrl = `https://www.facebook.com/profile/switch/?target_id=${pageInfo.id}`;
        await tab.goto(switchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await tab.waitForTimeout(2000);
        const switchConfirm = tab.locator('div[role="button"]:has-text("Chuyển"), div[role="button"]:has-text("Switch")').first();
        if (await switchConfirm.isVisible().catch(() => false)) {
          await switchConfirm.click({ force: true }).catch(() => {});
          await tab.waitForTimeout(3000);
        }
      }

      await context.addCookies([
        {
          name: 'i_user',
          value: String(pageInfo.id),
          domain: '.facebook.com',
          path: '/',
          secure: true,
          sameSite: 'Lax',
        },
      ]);
      await tab.waitForTimeout(800);
      return true;
    };

    const usedCommentsHistory = new Set();

    // Mở trước link bài viết mục tiêu (chỉ cần mở 1 lần) để các thao tác Fast Switch sau này diễn ra ngay trên bài
    console.log(`[FB-Buff] 🌐 Tải bài viết mục tiêu trước khi chạy luồng: ${targetUrl}`);
    try {
      await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await tab.waitForTimeout(2000);
    } catch (e) {
      console.warn(`[FB-Buff] ⚠️ Lỗi tải bài viết ban đầu (${e.message}), sẽ tự động thử lại.`);
    }

    for (let i = 0; i < pages.length; i++) {
      if (isStopRequested()) {
        results.stopped = true;
        console.warn(`[FB-Buff] 🛑 Phát hiện lệnh DỪNG KHẨN CẤP! Dừng vòng lặp tại page ${i + 1}/${pages.length}`);
        break;
      }
      const pageInfo = pages[i];
      console.log(`[FB-Buff] [${i + 1}/${pages.length}] ⚡ Đang tương tác bằng Page: "${pageInfo.name}" (ID: ${pageInfo.id})...`);

      if (typeof onProgress === 'function') {
        onProgress({
          type: 'PAGE_START',
          index: i,
          total: pages.length,
          pageId: pageInfo.id,
          pageName: pageInfo.name,
          percent: Math.round((i / pages.length) * 100),
        });
      }

      let likeStatus = enableLike ? 'WAITING' : 'SKIPPED';
      let likeError = '';
      let commentStatus = enableComment ? 'WAITING' : 'SKIPPED';
      let commentError = '';
      let usedCommentText = '';

      try {
        // BƯỚC 0: KIỂM TRA CHẶN TÍNH NĂNG / ACTION BLOCKED TỪ FACEBOOK
        if (await checkActionBlocked()) {
          console.error(`[FB-Buff] 🛑 PHÁT HIỆN TÀI KHOẢN BỊ FACEBOOK HẠN CHẾ TÍNH NĂNG (Action Blocked)! Tự động dừng khẩn cấp để bảo vệ dàn Page và BM.`);
          results.failed++;
          results.details.push({
            pageId: pageInfo.id,
            pageName: pageInfo.name,
            status: 'ERROR',
            error: 'Tài khoản Facebook bị hạn chế tạm thời (Action Blocked). Dừng để bảo vệ Via & BM an toàn.',
          });
          break;
        }

        // BƯỚC 1: CHUYỂN ĐỔI DANH TÍNH
        let fastSwitched = false;
        const curTabUrl = tab.url();
        const isOnPost = curTabUrl.includes('facebook.com') && (curTabUrl.includes('posts') || curTabUrl.includes('share') || curTabUrl.includes('permalink') || curTabUrl.includes('reel') || curTabUrl.includes('watch') || curTabUrl.includes('photo'));

        if (fastSwitch && isOnPost) {
          // Thử đổi giọng nói / danh tính ngay trên bài viết (tiết kiệm 15s/lần)
          const voiceBtn = tab.locator(
            '[aria-label*="Giọng nói hiện có"], [aria-label*="chuyển trang cá nhân"], [aria-label*="Voice switcher"], [aria-label*="Tương tác với tư cách"], [aria-label*="Bình chọn giọng nói"]'
          ).first();

          if ((await voiceBtn.count().catch(() => 0)) > 0 && (await voiceBtn.isVisible().catch(() => false))) {
            const currentVoiceAria = (await voiceBtn.getAttribute('aria-label').catch(() => '')) || '';
            if (currentVoiceAria.includes(pageInfo.name)) {
              fastSwitched = true;
            } else {
              await voiceBtn.click({ force: true }).catch(() => {});
              await tab.waitForTimeout(600);

              // 1. Thử click trực tiếp nếu page hiển thị sẵn trong top đầu
              let pageOpt = tab.locator(
                `[role="dialog"] [aria-label*="${pageInfo.name}"], [role="menu"] [aria-label*="${pageInfo.name}"], div[role="dialog"] div:has-text("${pageInfo.name}"), [role="menu"] div:has-text("${pageInfo.name}")`
              ).last();

              if ((await pageOpt.count().catch(() => 0)) > 0 && (await pageOpt.isVisible().catch(() => false))) {
                await pageOpt.click({ force: true }).catch(() => {});
                await tab.waitForTimeout(1400);
                fastSwitched = true;
                console.log(`[FB-Buff] ⚡ [FAST-SWITCH] Đã đổi sang Page "${pageInfo.name}" ngay trên bài viết! (Chỉ tốn ~1.5s)`);
              } else {
                // 2. CHO DÀN BM CÓ HÀNG TRĂM PAGE: Tìm ô tìm kiếm trong popup Voice Switcher và gõ tên Page
                const searchBox = tab.locator(
                  'div[role="dialog"] input[type="search"], div[role="dialog"] input[type="text"], [role="menu"] input, div[role="dialog"] [role="searchbox"]'
                ).first();

                if ((await searchBox.count().catch(() => 0)) > 0 && (await searchBox.isVisible().catch(() => false))) {
                  await searchBox.click({ force: true }).catch(() => {});
                  await searchBox.fill(pageInfo.name).catch(() => {});
                  await tab.waitForTimeout(500);

                  const filteredOpt = tab.locator(
                    `[role="dialog"] [aria-label*="${pageInfo.name}"], [role="menu"] [aria-label*="${pageInfo.name}"], div[role="dialog"] div:has-text("${pageInfo.name}")`
                  ).last();

                  if ((await filteredOpt.count().catch(() => 0)) > 0 && (await filteredOpt.isVisible().catch(() => false))) {
                    await filteredOpt.click({ force: true }).catch(() => {});
                    await tab.waitForTimeout(1400);
                    fastSwitched = true;
                    console.log(`[FB-Buff] ⚡ [FAST-SWITCH SEARCH] Đã lọc và đổi sang Page "${pageInfo.name}" trong kho BM!`);
                  }
                }

                // 3. Nếu vẫn chưa thấy, thử cuộn nhẹ danh sách trong dialog
                if (!fastSwitched) {
                  await tab.evaluate(() => {
                    const scrollable = document.querySelector('div[role="dialog"] [role="list"], div[role="dialog"] div[style*="overflow"]');
                    if (scrollable) scrollable.scrollBy(0, 500);
                  }).catch(() => {});
                  await tab.waitForTimeout(400);

                  const retryOpt = tab.locator(
                    `[role="dialog"] [aria-label*="${pageInfo.name}"], [role="menu"] [aria-label*="${pageInfo.name}"]`
                  ).last();

                  if ((await retryOpt.count().catch(() => 0)) > 0 && (await retryOpt.isVisible().catch(() => false))) {
                    await retryOpt.click({ force: true }).catch(() => {});
                    await tab.waitForTimeout(1400);
                    fastSwitched = true;
                    console.log(`[FB-Buff] ⚡ [FAST-SWITCH SCROLL] Đã cuộn tìm và đổi sang Page "${pageInfo.name}"!`);
                  } else {
                    await tab.keyboard.press('Escape').catch(() => {});
                  }
                }
              }
            }
          }
        }

        if (!fastSwitched) {
          // Fallback: Chuyển đổi danh tính qua trang profile
          await switchPageIdentity(pageInfo);
          const postCheckUrl = tab.url();
          if (!postCheckUrl.includes('posts') && !postCheckUrl.includes('share') && !postCheckUrl.includes('permalink') && !postCheckUrl.includes('reel') && !postCheckUrl.includes('watch')) {
            await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
            await tab.waitForTimeout(1500);
          }
        }

        const currentUrl = tab.url();
        if (currentUrl.includes('/checkpoint') || currentUrl.includes('/login')) {
          const isCp = currentUrl.includes('/checkpoint');
          const cpMsg = isCp
            ? 'Bị Facebook yêu cầu xác minh người thật ("Confirm you are human")'
            : 'Cookie hết hạn (Bị chuyển về trang đăng nhập)';
          console.warn(`[FB-Buff] ⚠️ ${cpMsg} cho "${pageInfo.name}" (URL: ${currentUrl})`);
          throw new Error(cpMsg);
        }

        // --- BẢO VỆ CHỐNG CHECKPOINT: HÀNH VI LƯỚT XEM BÀI VIẾT TỰ NHIÊN ---
        if (enableHumanBehavior) {
          await tab.evaluate(() => {
            window.scrollBy({ top: 120 + Math.floor(Math.random() * 180), behavior: 'smooth' });
          }).catch(() => {});
          await tab.waitForTimeout(800 + Math.floor(Math.random() * 800));
        }

        // Tự động phân bổ cảm xúc ngẫu nhiên thông minh (Tỷ lệ vàng tự nhiên: 65% LIKE, 25% LOVE, 10% CARE)
        let currentReaction = (reactionType || 'LIKE').toUpperCase();
        if (currentReaction === 'RANDOM_POSITIVE' || currentReaction === 'RANDOM' || currentReaction === 'RANDOM_MIX' || currentReaction === 'SMART_MIX') {
          const rand = Math.random();
          if (rand < 0.65) currentReaction = 'LIKE';
          else if (rand < 0.90) currentReaction = 'LOVE';
          else currentReaction = 'CARE';
        } else if (currentReaction === 'RANDOM_ALL') {
          const rand = Math.random();
          if (rand < 0.50) currentReaction = 'LIKE';
          else if (rand < 0.75) currentReaction = 'LOVE';
          else if (rand < 0.90) currentReaction = 'CARE';
          else if (rand < 0.95) currentReaction = 'HAHA';
          else currentReaction = 'WOW';
        }

        // --- HÀNH ĐỘNG 1: THẢ LIKE / REACTION ---
        if (enableLike) {
          await tab.waitForSelector('div[role="button"]:has([data-ad-rendering-role="like_button"]), [aria-label*="Thích"], [aria-label*="Like"]', { timeout: 4500 }).catch(() => null);
          let likeBtn = await findLikeButton();

          if (!likeBtn) {
            await tab.evaluate(() => window.scrollBy(0, 300)).catch(() => {});
            await tab.waitForTimeout(500);
            likeBtn = await findLikeButton();
          }

          if (likeBtn) {
            const currentAria = (await likeBtn.getAttribute('aria-label')) || '';
            // Giữ handle cố định của nút: locator sẽ resolve lại sang nút "Thích" khác sau khi aria-label đổi
            const likeHandle = await likeBtn.elementHandle().catch(() => null);

            if (
              currentAria.includes('Gỡ') ||
              currentAria.includes('Remove') ||
              currentAria.includes('Đã thích') ||
              currentAria.includes('Liked')
            ) {
              console.log(`[FB-Buff] ℹ️ Page "${pageInfo.name}" đã Like trước đó (Trạng thái: ${currentAria}).`);
              likeStatus = 'ALREADY_LIKED';
            } else {
              if (currentReaction === 'LIKE') {
                await triggerClick(likeBtn);
                await tab.waitForTimeout(1200);
                const verified = await verifyReacted(likeHandle, currentAria, findLikeButton);
                likeStatus = verified ? 'SUCCESS' : 'UNVERIFIED';
                console.log(`[FB-Buff] ${verified ? '✅' : '❔'} Page "${pageInfo.name}" thả LIKE ${verified ? 'đã xác nhận' : 'chưa xác nhận được trạng thái nút'}.`);
              } else {
                const reactionMap = {
                  LOVE: ['Yêu thích', 'Love'],
                  CARE: ['Thương thương', 'Care'],
                  HAHA: ['Haha'],
                  WOW: ['Wow'],
                  SAD: ['Buồn', 'Sad'],
                  ANGRY: ['Phẫn nộ', 'Angry'],
                };
                const targetKeywords = reactionMap[currentReaction] || ['Thích', 'Like'];

                // Hover chuột thật để Facebook mở thanh cảm xúc (hover force/dispatch giả không mở được popup)
                await likeBtn.scrollIntoViewIfNeeded().catch(() => {});
                await likeBtn.hover({ timeout: 2500 }).catch(async () => {
                  const box = await likeBtn.boundingBox().catch(() => null);
                  if (box) await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 }).catch(() => {});
                });

                // Chỉ tìm nút cảm xúc trong thanh cảm xúc vừa mở, khớp aria-label chính xác
                // (aria-label*= từng bấm nhầm phần tóm tắt cảm xúc / bài khác trong feed Group)
                const exactSel = targetKeywords.map((kw) => `[aria-label="${kw}"][role="button"]`).join(', ');
                const popupSel = targetKeywords
                  .map((kw) => `[role="dialog"] [aria-label="${kw}"], [role="toolbar"] [aria-label="${kw}"], [aria-label="Cảm xúc"] [aria-label="${kw}"], [aria-label="Reactions"] [aria-label="${kw}"]`)
                  .join(', ');
                let rBtn = null;
                const deadline = Date.now() + 2500;
                while (!rBtn && Date.now() < deadline) {
                  for (const sel of [popupSel, exactSel]) {
                    const loc = tab.locator(sel);
                    const n = await loc.count().catch(() => 0);
                    for (let k = n - 1; k >= 0 && !rBtn; k--) {
                      // Thanh cảm xúc là phần tử mới nhất được gắn vào DOM nên duyệt từ cuối lên
                      if (await loc.nth(k).isVisible().catch(() => false)) rBtn = loc.nth(k);
                    }
                    if (rBtn) break;
                  }
                  if (!rBtn) await tab.waitForTimeout(300);
                }

                if (rBtn) {
                  await rBtn.hover({ timeout: 1500 }).catch(() => {});
                  await rBtn.click({ timeout: 2500 }).catch(() => triggerClick(rBtn));
                } else {
                  console.log(`[FB-Buff] ℹ️ Không mở được thanh cảm xúc cho Page "${pageInfo.name}", chuyển sang thả LIKE.`);
                  currentReaction = 'LIKE';
                  await triggerClick(likeBtn);
                }
                await tab.waitForTimeout(1200);
                const verified = await verifyReacted(likeHandle, currentAria, findLikeButton);
                likeStatus = verified ? 'SUCCESS' : 'UNVERIFIED';
                console.log(`[FB-Buff] ${verified ? '✅' : '❔'} Page "${pageInfo.name}" thả ${currentReaction} ${verified ? 'đã xác nhận' : 'chưa xác nhận được trạng thái nút'}.`);
              }

              // Kiểm tra xem Facebook có chặn hành động không
              if (await checkActionBlocked()) {
                console.warn(`[FB-Buff] ⚠️ Facebook cảnh báo chặn hành động sau khi like bằng Page "${pageInfo.name}".`);
                likeStatus = 'ERROR';
                likeError = 'Facebook tạm thời hạn chế hành động (Action Blocked)';
              }
            }
          } else {
            likeStatus = 'NO_BUTTON';
            likeError = 'Không tìm thấy nút Like';
            console.warn(`[FB-Buff] ⚠️ Không tìm thấy nút Like cho "${pageInfo.name}"`);
          }
        }

        // --- HÀNH ĐỘNG 2: VIẾT BÌNH LUẬN (COMMENT) ---
        if (enableComment) {
          let rawComment = pageInfo.comment || (Array.isArray(comments) && comments.length > 0 ? comments[i % comments.length] : '');
          usedCommentText = resolveSpintax(rawComment ? rawComment.trim() : '');

          if (!usedCommentText.trim()) {
            commentStatus = 'SKIPPED';
            commentError = 'Không có nội dung bình luận';
          } else {
            // ANTI-SPAM BẢO VỆ 1: CHỐNG TRÙNG LẶP NỘI DUNG (Tránh bị Facebook cấm vì đăng lại cùng bình luận)
            const normalized = usedCommentText.toLowerCase().replace(/[.,!?:;\s]+/g, '');
            if (usedCommentsHistory.has(normalized)) {
              // Tự động thêm hậu tố cảm xúc tự nhiên để bình luận không bị trùng lặp
              const variation = NATURAL_VI_VARIATIONS[Math.floor(Math.random() * NATURAL_VI_VARIATIONS.length)];
              usedCommentText = `${usedCommentText}${variation}`;
            }
            usedCommentsHistory.add(usedCommentText.toLowerCase().replace(/[.,!?:;\s]+/g, ''));

            // ANTI-SPAM BẢO VỆ 2: PHÁT HIỆN TỪ KHÓA BOT GÂY QUÉT SPAM (test, tự động, bot, tool, toolzutter...)
            const botFilterRegex = /\b(test|tự động|bot|tool|toolzutter|auto|buff|hack|spam)\b/gi;
            if (botFilterRegex.test(usedCommentText)) {
              console.warn(`[FB-Buff] ⚠️ PHÁT HIỆN TỪ KHÓA DỄ BỊ BẮT SPAM: "${usedCommentText}". Tự động chuyển hóa thành seeding tự nhiên.`);
              usedCommentText = usedCommentText
                .replace(/test\s*hệ\s*thống\s*comment\s*tự\s*động\s*từ\s*toolzutter!?\s*🚀?/gi, 'Bài viết rất hay và hữu ích ạ! ❤️')
                .replace(botFilterRegex, 'chia sẻ');
            }

            // Tìm ô textbox bình luận
            const commentSelectors = [
              'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
              'div[role="article"] div[role="textbox"][contenteditable="true"]',
              'div[role="textbox"][contenteditable="true"]',
            ];

            let commentBox = null;
            for (const sel of commentSelectors) {
              const loc = tab.locator(sel).first();
              if ((await loc.count().catch(() => 0)) > 0) {
                commentBox = loc;
                break;
              }
            }

            if (!commentBox) {
              const writeBtn = tab.locator('[aria-label="Viết bình luận"], [aria-label="Write a comment"]').first();
              if ((await writeBtn.count().catch(() => 0)) > 0) {
                await writeBtn.click({ force: true }).catch(() => {});
                await tab.waitForTimeout(800);
                for (const sel of commentSelectors) {
                  const loc = tab.locator(sel).first();
                  if ((await loc.count().catch(() => 0)) > 0) {
                    commentBox = loc;
                    break;
                  }
                }
              }
            }

            if (commentBox) {
              // 1. Giả lập cuộn trang tự nhiên xem bài viết
              await tab.evaluate(() => {
                window.scrollBy({ top: 100 + Math.floor(Math.random() * 150), behavior: 'smooth' });
              }).catch(() => {});
              await tab.waitForTimeout(400 + Math.floor(Math.random() * 400));

              // 2. Click ô nhập bình luận
              await commentBox.evaluate((el) => {
                el.focus();
                el.scrollIntoView({ block: 'center', behavior: 'smooth' });
              }).catch(() => {});
              await tab.waitForTimeout(300 + Math.floor(Math.random() * 200));
              await commentBox.click().catch(() => {});
              await tab.waitForTimeout(400 + Math.floor(Math.random() * 300));

              // 3. Gõ phím từng ký tự giả lập nhịp gõ người thật (35ms - 75ms mỗi phím)
              for (const char of usedCommentText) {
                await tab.keyboard.type(char, { delay: Math.floor(Math.random() * 45) + 35 });
                if (char === ' ' && Math.random() < 0.2) {
                  await tab.waitForTimeout(Math.floor(Math.random() * 120) + 40);
                }
              }

              // 4. Dừng đọc lại 1s trước khi bấm gửi
              await tab.waitForTimeout(1000 + Math.floor(Math.random() * 600));
              await tab.keyboard.press('Enter');

              // 5. Chờ Facebook xử lý hiển thị bình luận
              await tab.waitForTimeout(2000 + Math.floor(Math.random() * 800));
              commentStatus = 'SUCCESS';
              console.log(`[FB-Buff] 💬 Page "${pageInfo.name}" đã bình luận tự nhiên: "${usedCommentText}"`);
            } else {
              commentStatus = 'FAILED';
              commentError = 'Không tìm thấy ô nhập bình luận';
              console.warn(`[FB-Buff] ⚠️ Không tìm thấy ô bình luận cho Page "${pageInfo.name}"`);
            }
          }
        }

        // TỔNG HỢP KẾT QUẢ CHO PAGE NÀY
        const likeOk = !enableLike || likeStatus === 'SUCCESS';
        const cmtOk = !enableComment || commentStatus === 'SUCCESS';
        const isAlready = enableLike && !enableComment && likeStatus === 'ALREADY_LIKED';

        let finalStatus = 'SUCCESS';
        const msgs = [];
        if (enableLike) {
          if (likeStatus === 'SUCCESS') msgs.push(`Đã like (${currentReaction})`);
          else if (likeStatus === 'ALREADY_LIKED') msgs.push('Đã like trước đó');
          else msgs.push(`Lỗi like: ${likeError || 'Không thể like'}`);
        }
        if (enableComment) {
          if (commentStatus === 'SUCCESS') msgs.push(`Đã cmt: "${usedCommentText}"`);
          else if (commentStatus === 'SKIPPED') msgs.push('Bỏ qua cmt');
          else msgs.push(`Lỗi cmt: ${commentError || 'Không gửi được'}`);
        }

        if (enableLike) {
          if (likeStatus === 'UNVERIFIED') msgs[0] = `Đã bấm ${currentReaction} nhưng chưa xác nhận được`;
        }

        if (isAlready) {
          finalStatus = 'ALREADY_LIKED';
          results.success++;
        } else if (likeStatus === 'UNVERIFIED' && !(enableComment && commentStatus === 'SUCCESS')) {
          finalStatus = 'UNVERIFIED';
          results.unverified++;
        } else if (likeOk && cmtOk) {
          finalStatus = 'SUCCESS';
          results.success++;
        } else if ((enableLike && likeStatus === 'SUCCESS') || (enableComment && commentStatus === 'SUCCESS')) {
          finalStatus = 'SUCCESS';
          results.success++;
        } else {
          finalStatus = 'ERROR';
          results.failed++;
        }

        // UNVERIFIED vẫn ghi registry: nút đã được bấm, bấm lại lần nữa có thể làm HỦY LIKE
        if (finalStatus === 'SUCCESS' || finalStatus === 'ALREADY_LIKED' || finalStatus === 'UNVERIFIED') {
          recordPageAction(pageInfo.id);
          recordPagePostInteraction(normalizedPostUrl, pageInfo.id, {
            reactionType: currentReaction,
            commentText: usedCommentText,
            status: finalStatus,
            pageName: pageInfo.name,
          });
        }

        const item = {
          pageId: pageInfo.id,
          pageName: pageInfo.name,
          status: finalStatus,
          likeStatus,
          commentStatus,
          commentText: commentStatus === 'SUCCESS' ? usedCommentText : undefined,
          message: msgs.join(' • '),
          error: finalStatus === 'ERROR' ? msgs.join(' • ') : undefined,
        };
        results.details.push(item);

        if (typeof onProgress === 'function') {
          onProgress({
            type: 'PAGE_FINISH',
            index: i,
            total: pages.length,
            ...item,
            percent: Math.round(((i + 1) / pages.length) * 100),
          });
        }
      } catch (err) {
        console.error(`[FB-Buff] ❌ Lỗi khi Page "${pageInfo.name}" tương tác: ${err.message}`);
        results.failed++;
        const item = {
          pageId: pageInfo.id,
          pageName: pageInfo.name,
          status: 'ERROR',
          likeStatus: enableLike ? 'ERROR' : 'SKIPPED',
          commentStatus: enableComment ? 'ERROR' : 'SKIPPED',
          error: err.message,
        };
        results.details.push(item);
        if (typeof onProgress === 'function') {
          onProgress({
            type: 'PAGE_FINISH',
            index: i,
            total: pages.length,
            ...item,
            percent: Math.round(((i + 1) / pages.length) * 100),
          });
        }
      }

      // Chống checkpoint: Nghỉ ngơi an toàn theo lô (Batch Cooldown) cho tài khoản BM nhiều Page
      if (i > 0 && i % cooldownEvery === 0 && i < pages.length - 1) {
        const isBigBatch = i % 36 === 0;
        const batchRest = isBigBatch
          ? 45000 + Math.floor(Math.random() * 25000)
          : cooldownDurationMs + Math.floor(Math.random() * 8000);
        console.log(`[FB-Buff] 🛡️ [ANTI-CHECKPOINT BM] Đã chạy xong ${i} Page. Nghỉ ngơi ${(batchRest / 1000).toFixed(1)}s hạ nhiệt Via & BM...`);
        if (enableHumanBehavior) {
          await tab.evaluate(() => window.scrollBy({ top: Math.floor(Math.random() * 250) + 100, behavior: 'smooth' })).catch(() => {});
        }
        await new Promise((r) => setTimeout(r, batchRest));
      }

      // Độ trễ an toàn giữa các page với Dynamic Jitter
      if (i < pages.length - 1) {
        let waitTime = delayMs > 0 ? delayMs : 3800;
        if (enableComment) {
          // Khi bình luận, BẮT BUỘC giãn cách tối thiểu 12-25 giây để không bị bot nhóm & Meta AI quét spam hành động liên tiếp
          const safeMin = Math.max(delayMs, 12000);
          waitTime = safeMin + Math.floor(Math.random() * 6000);
          console.log(`[FB-Buff] 🛡️ [ANTI-SPAM] Chờ an toàn ${(waitTime / 1000).toFixed(1)}s trước khi Page tiếp theo tương tác...`);
        } else {
          // Thêm jitter ngẫu nhiên 1200 - 3200ms để nhịp tương tác tự nhiên hoàn toàn giống người thật
          waitTime = Math.max(3500, waitTime) + Math.floor(Math.random() * 2500);
        }
        await new Promise((r) => setTimeout(r, waitTime));
      }
    }
  } finally {
    await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  console.log(`[FB-Buff] 🏁 Hoàn thành buff Like: Thành công ${results.success}/${results.total}`);
  return results;
}

// ==========================================
// 4. BUFF VIEW VIDEO / REELS ĐA LUỒNG TỐI ƯU RAM
// ==========================================

/**
 * Tăng lượt xem (View) cho Video / Reels Facebook (Tối ưu RAM và CPU)
 * @param {string} targetVideoUrl - Link Video / Reels cần buff view
 * @param {object} options - { targetViews, concurrency, watchTimeSeconds, cookieStr }
 */
async function buffViews(targetVideoUrl, options = {}) {
  const {
    targetViews = 10,       // Số lượt view cần buff
    concurrency = 2,        // Số luồng xem song song
    watchTimeSeconds = 6,   // Thời gian xem mỗi lượt (chuẩn FB tính view từ 3-5s+)
    cookieStr = null,       // Cookie (tùy chọn, không bắt buộc vì view công khai không cần login)
  } = options;

  console.log(`[FB-Buff] 🚀 Bắt đầu Buff View Siêu Tốc & Tiết Kiệm RAM cho video: ${targetVideoUrl}`);
  console.log(`[FB-Buff] 🎯 Mục tiêu: ${targetViews} Views | Luồng: ${concurrency} | Thời lượng xem: ${watchTimeSeconds}s/view`);

  const cookies = cookieStr ? parseCookieString(cookieStr) : [];
  let completedViews = 0;
  let failedViews = 0;

  // Khởi tạo DUY NHẤT 1 instance browser Playwright (tiết kiệm 90% RAM so với mở nhiều browser)
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-notifications',
      '--mute-audio',
      '--disable-gpu',
      '--disable-dev-shm-usage',
    ],
  });

  try {
    const runViewWorker = async (workerId) => {
      while (completedViews + failedViews < targetViews) {
        const currentTaskNum = completedViews + failedViews + 1;
        if (currentTaskNum > targetViews) break;

        let context = null;
        try {
          context = await browser.newContext({
            userAgent:
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 },
          });

          if (cookies.length > 0) {
            await context.addCookies(cookies);
          }

          const page = await context.newPage();
          // Chặn tải các resource nặng để tiết kiệm tối đa CPU và băng thông mạng
          await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,eot,ico}', (route) => route.abort());

          console.log(`[FB-Buff] [Luồng ${workerId}] Đang xem video (View #${currentTaskNum}/${targetViews})...`);
          await page.goto(targetVideoUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

          // Tự động play video nếu đang pause
          await page.evaluate(() => {
            const videos = document.querySelectorAll('video');
            videos.forEach((v) => {
              v.muted = true;
              v.play().catch(() => {});
            });
          });

          // Giữ xem trong thời lượng watchTimeSeconds
          await page.waitForTimeout(watchTimeSeconds * 1000);

          completedViews++;
          console.log(`[FB-Buff] [Luồng ${workerId}] ✅ Đã xem xong 1 view (${completedViews}/${targetViews})`);
        } catch (err) {
          failedViews++;
          console.warn(`[FB-Buff] [Luồng ${workerId}] ⚠️ Lỗi khi xem video: ${err.message}`);
        } finally {
          if (context) await context.close().catch(() => {});
        }

        // Delay nhẹ giữa các lượt xem
        await new Promise((r) => setTimeout(r, 600));
      }
    };

    // Khởi chạy các worker song song trong cùng 1 browser
    const workers = [];
    const actualConcurrency = Math.min(concurrency, targetViews);
    for (let i = 1; i <= actualConcurrency; i++) {
      workers.push(runViewWorker(i));
    }

    await Promise.all(workers);
  } finally {
    await browser.close().catch(() => {});
  }

  console.log(`[FB-Buff] 🏁 Hoàn thành Buff View: Thành công ${completedViews}/${targetViews}`);
  return {
    totalTarget: targetViews,
    completed: completedViews,
    failed: failedViews,
  };
}

/**
 * 6. FACEBOOK POST HUNTER — Quét và trích xuất danh sách bài viết mới nhất từ Fanpage / Group / Profile
 * Tối ưu hóa siêu nhẹ (chặn media/font), hỗ trợ tự động tìm bài viết mới để nạp vào hàng đợi Auto-Buff
 * @param {string} targetUrl URL của Fanpage, Group hoặc Profile
 * @param {object} options Các tùy chọn: cookieStr, maxPosts, timeoutMs
 */
// Xác định loại mục tiêu (Group / Page) để quét đúng thứ tự và lọc đúng link bài
function getScanTargetInfo(rawUrl) {
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://www.facebook.com/${rawUrl.replace(/^\/+/, '')}`);
  } catch (_) {
    return { type: 'UNKNOWN', scanUrl: rawUrl };
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] === 'groups' && segments[1]) {
    // Group: xem theo "Bài viết mới" để bài mới nhất nằm trên cùng
    const groupKey = segments[1];
    return {
      type: 'GROUP',
      groupKey: groupKey.toLowerCase(),
      scanUrl: `https://www.facebook.com/groups/${groupKey}/?sorting_setting=CHRONOLOGICAL`,
    };
  }
  if (segments[0] === 'profile.php' && url.searchParams.get('id')) {
    return { type: 'PAGE', pageId: url.searchParams.get('id'), scanUrl: url.toString() };
  }
  if (segments[0] && !['watch', 'reel', 'story.php', 'permalink.php'].includes(segments[0])) {
    return { type: 'PAGE', pageSlug: segments[0].toLowerCase(), scanUrl: url.toString() };
  }
  return { type: 'UNKNOWN', scanUrl: url.toString() };
}

function isLinkOwnedByTarget(href, info) {
  let url;
  try { url = new URL(href); } catch (_) { return false; }
  const segments = url.pathname.split('/').filter(Boolean);
  const first = (segments[0] || '').toLowerCase();

  if (info.type === 'GROUP') {
    // Trong feed Group chỉ nhận link bài Group (link Page/Reel là bài chia sẻ lại)
    return first === 'groups' && /^(posts|permalink)$/.test(segments[2] || '');
  }
  if (info.type === 'PAGE') {
    if (first === 'reel' || first === 'watch') return true; // Reel/Video không mang tên chủ sở hữu trong link
    const ownerId = url.searchParams.get('id');
    if (ownerId) return Boolean(info.pageId) && ownerId === info.pageId;
    if (info.pageId) return first === info.pageId;
    return first === info.pageSlug;
  }
  return true;
}

async function scanTargetForPosts(targetUrl, options = {}) {
  const {
    cookieStr = '',
    proxyUrl = '',
    maxPosts = 8,
    timeoutMs = 30000,
  } = options;

  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new Error('Thiếu URL trang mục tiêu');
  }

  const targetInfo = getScanTargetInfo(targetUrl.trim());
  const cleanTarget = targetInfo.scanUrl;
  const proxy = parseProxy(proxyUrl);
  console.log(`[FB-Hunter] 🔍 Đang quét bài viết mới từ: ${cleanTarget} (Max: ${maxPosts})`);

  let browser = null;
  let context = null;
  const discoveredPosts = [];

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-notifications',
        '--mute-audio',
        '--disable-gpu',
      ],
      proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
    });

    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'vi-VN',
    });

    // Chặn ảnh/video/font để quét cực nhanh, tiết kiệm 80% RAM & mạng
    await context.route('**/*.{png,jpg,jpeg,webp,gif,svg,ico,mp4,webm,woff,woff2,ttf,otf}', (route) => {
      route.abort();
    });

    if (cookieStr) {
      const cookies = parseCookieString(cookieStr);
      if (cookies.length > 0) {
        await context.addCookies(cookies);
      }
    }

    const page = await context.newPage();
    await page.goto(cleanTarget, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch((e) => {
      console.warn(`[FB-Hunter] ⚠️ Tải trang (${e.message}), tiếp tục đọc DOM hiện có...`);
    });

    await page.waitForTimeout(3000);

    // Cuộn nhẹ 1-2 lần để kích hoạt lazy loading bài viết của Facebook Feed
    for (let s = 0; s < 2; s++) {
      await page.evaluate(() => window.scrollBy({ top: 900, behavior: 'smooth' })).catch(() => {});
      await page.waitForTimeout(1400);
    }

    // Facebook giấu link bài trong mốc thời gian (href "?__cft__..." / "#"), chỉ hiện link thật khi rê chuột.
    // Rê chuột vào các link đó trong từng khối bài (theo thứ tự feed, bài mới ở trên) để lộ permalink.
    // Link lộ ra chỉ tồn tại khi chuột còn đặt trên đó → đọc ngay sau khi rê.
    const revealedLinks = [];
    const feedUnits = await page.$$('[role="main"] div[data-virtualized], [role="feed"] > div, [aria-posinset]').catch(() => []);
    for (const unit of feedUnits.slice(0, maxPosts * 3)) {
      const anchors = await unit.$$('a').catch(() => []);
      for (const a of anchors) {
        const h = (await a.getAttribute('href').catch(() => '')) || '';
        if (h && !h.startsWith('#') && !/^(?:https:\/\/www\.facebook\.com\/?)?\?__cft__/.test(h)) continue;
        await a.hover({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(150);
        const revealed = await a.evaluate((el) => el.href).catch(() => '');
        if (revealed && /story_fbid=|\/posts\/|\/permalink\//.test(revealed)) {
          const text = await unit.evaluate((el) => (el.innerText || '').trim().slice(0, 150)).catch(() => '');
          revealedLinks.push({ href: revealed, text });
          break; // 1 permalink cho mỗi khối bài là đủ
        }
      }
    }

    // Trích xuất toàn bộ liên kết bài viết (bài lộ ra từ mốc thời gian xếp trước, đúng thứ tự feed)
    const pageLinks = await page.$$eval('a[href]', (anchors) => {
      return anchors.map((a) => {
        const text = (a.innerText || a.getAttribute('aria-label') || '').trim();
        return {
          href: a.href,
          text: text.slice(0, 150),
        };
      });
    }).catch(() => []);
    const rawLinks = [...revealedLinks, ...pageLinks];

    const seenUrls = new Set();
    const postUrlPatterns = [
      /\/posts\/[a-zA-Z0-9_-]+/i,
      /\/videos\/[0-9]+/i,
      /\/reel\/[0-9]+/i,
      /story\.php\?story_fbid=/i,
      /permalink\.php\?story_fbid=/i,
      /\/groups\/[^/]+\/permalink\/[0-9]+/i,
      /\/groups\/[^/]+\/posts\/[0-9]+/i,
    ];

    for (const item of rawLinks) {
      const href = item.href;
      if (!href || !href.includes('facebook.com')) continue;

      const isPost = postUrlPatterns.some((pattern) => pattern.test(href));
      if (!isPost) continue;
      // Bỏ link bài của nơi khác (bài chia sẻ, gợi ý...) — chỉ giữ bài thuộc chính mục tiêu
      if (!isLinkOwnedByTarget(href, targetInfo)) continue;

      // Chuẩn hóa loại bỏ tracking query Facebook
      const cleanUrl = href.replace(/[?&](?:mibextid|fbclid|rdid|__cft__\[0\]|__tn__|ref)=[^&]*/g, '').replace(/[?&]$/, '');
      const normalized = normalizeFbPostUrl(cleanUrl);

      // Loại bỏ các đường link không phải bài viết cụ thể
      if (/\/(posts|videos|reels)$/.test(normalized.split('?')[0])) {
        continue;
      }

      if (seenUrls.has(normalized)) continue;
      seenUrls.add(normalized);

      discoveredPosts.push({
        url: cleanUrl,
        normalizedUrl: normalized,
        title: item.text || 'Bài viết Facebook',
        foundAt: new Date().toISOString(),
      });

      if (discoveredPosts.length >= maxPosts) break;
    }

    console.log(`[FB-Hunter] 🎯 Tìm thấy ${discoveredPosts.length} bài viết hợp lệ từ ${cleanTarget}`);
  } catch (err) {
    console.error(`[FB-Hunter] ❌ Lỗi quét mục tiêu ${cleanTarget}:`, err.message);
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  return discoveredPosts;
}

/**
 * 7. VIA SESSION VALIDATOR — Kiểm tra sức khỏe tài khoản Via (LIVE vs CHECKPOINT / EXPIRED)
 * @param {string} cookieStr Cookie của Via
 * @param {object} options Tùy chọn proxyUrl, timeoutMs
 */
async function validateViaSession(cookieStr, options = {}) {
  const { proxyUrl = '', timeoutMs = 20000 } = options;
  if (!cookieStr || !cookieStr.includes('c_user=')) {
    return { isLive: false, status: 'NO_COOKIE', error: 'Chuỗi Cookie rỗng hoặc không có c_user' };
  }

  const cookies = parseCookieString(cookieStr);
  const uid = getUserIdFromCookie(cookieStr);
  const device = getDeviceForUid(uid);
  const proxy = parseProxy(proxyUrl);

  let browser = null;
  let context = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-notifications',
        '--mute-audio',
        '--disable-gpu',
      ],
      proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
    });

    context = await browser.newContext({
      userAgent: device.userAgent,
      viewport: { width: 1280, height: 720 },
      locale: 'vi-VN',
    });

    await context.route('**/*.{png,jpg,jpeg,webp,gif,svg,ico,mp4,webm,woff,woff2,ttf,otf}', (route) => {
      route.abort();
    });

    await context.addCookies(cookies);
    const page = await context.newPage();

    console.log(`[ViaValidator] 🩺 Đang kiểm tra sức khỏe Via UID: ${uid}...`);
    await page.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch((e) => {
      console.warn(`[ViaValidator] ⚠️ Navigation note: ${e.message}`);
    });

    await page.waitForTimeout(2500);
    const currentUrl = page.url();

    if (currentUrl.includes('/checkpoint') || currentUrl.includes('checkpoint')) {
      console.warn(`[ViaValidator] 🛑 Via ${uid} BỊ CHECKPOINT! (URL: ${currentUrl})`);
      return { isLive: false, status: 'CHECKPOINT', uid, url: currentUrl };
    }

    if (currentUrl.includes('/login') || currentUrl.includes('login_attempt') || !currentUrl.includes('facebook.com')) {
      console.warn(`[ViaValidator] ❌ Via ${uid} ĐÃ HẾT HẠN COOKIE / BỊ ĐĂNG XUẤT!`);
      return { isLive: false, status: 'EXPIRED', uid, url: currentUrl };
    }

    const title = await page.title().catch(() => '');
    console.log(`[ViaValidator] ✅ Via ${uid} HOẠT ĐỘNG TỐT (LIVE)! (Tên: ${title})`);
    return {
      isLive: true,
      status: 'LIVE',
      uid,
      name: title.replace(/\|.*$/, '').trim(),
      url: currentUrl,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { isLive: false, status: 'ERROR', uid, error: err.message };
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = {
  parseCookieString,
  getUserIdFromCookie,
  getManagedPages,
  getCachedPages,
  setCachedPages,
  loadPagesCache,
  savePagesCache,
  buffLikesWithPages,
  buffViews,
  scanTargetForPosts,
  validateViaSession,
  parseProxy,
  recordPageAction,
  getPageUsageToday,
  getDailyPageActionLimit,
  filterAvailablePagesForPost,
  recordPagePostInteraction,
  hasPageInteractedWithPost,
  getGlobalRegistryStats,
  resolveSpintax,
};

// ==========================================
// 5. TEST CLI TRỰC TIẾP
// ==========================================
if (require.main === module) {
  const args = process.argv.slice(2);
  const action = args[0]; // 'get-pages' | 'buff-like' | 'buff-view'

  console.log('--- FB BUFF ENGAGEMENT TOOL ---');
  console.log('Sử dụng:');
  console.log('  node fb-buff-tool.js get-pages "<COOKIE>"');
  console.log('  node fb-buff-tool.js buff-like "<COOKIE>" "<POST_URL>" [REACTION_TYPE]');
  console.log('  node fb-buff-tool.js buff-view "<VIDEO_URL>" [TARGET_VIEWS] [CONCURRENCY]');
  console.log('-------------------------------\n');

  if (action === 'get-pages') {
    const cookie = args[1];
    if (!cookie) {
      console.error('Vui lòng cung cấp chuỗi Cookie!');
      process.exit(1);
    }
    getManagedPages(cookie)
      .then((pages) => console.log('KẾT QUẢ:', JSON.stringify(pages, null, 2)))
      .catch((err) => console.error('LỖI:', err.message));
  } else if (action === 'buff-like') {
    const cookie = args[1];
    const postUrl = args[2];
    const reaction = args[3] || 'LIKE';
    if (!cookie || !postUrl) {
      console.error('Vui lòng cung cấp Cookie và Link bài viết!');
      process.exit(1);
    }
    buffLikesWithPages(cookie, postUrl, { reactionType: reaction })
      .then((res) => console.log('KẾT QUẢ:', res))
      .catch((err) => console.error('LỖI:', err.message));
  } else if (action === 'buff-view') {
    const videoUrl = args[1];
    const targetViews = parseInt(args[2], 10) || 5;
    const concurrency = parseInt(args[3], 10) || 2;
    if (!videoUrl) {
      console.error('Vui lòng cung cấp Link Video/Reels!');
      process.exit(1);
    }
    buffViews(videoUrl, { targetViews, concurrency })
      .then((res) => console.log('KẾT QUẢ:', res))
      .catch((err) => console.error('LỖI:', err.message));
  }
}
