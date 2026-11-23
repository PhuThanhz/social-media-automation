// Quét danh sách bài viết từ feed Facebook Group (và Fanpage) — dùng cho tính năng "Quét Group".
// Tách khỏi server.js để chạy thử độc lập được (node scratch script) mà không khởi động cả worker.
const browserPool = require('./browserPool');
const { parseFbPostedTime, dayBoundary } = require('./fb-posted-time');

// Link bài viết của Fanpage (bỏ link ảnh lẻ: ảnh trong bài cũng là <a> nhưng không phải permalink bài)
const PAGE_POST_HREF = /\/posts\/[A-Za-z0-9_-]+|permalink\.php\?story_fbid=|story\.php\?story_fbid=|\/videos\/\d+|\/reel\/\d+|\/watch\/?\?v=\d+|\/share\/[prv]\/[A-Za-z0-9_-]+/i;

// Nhận diện link Fanpage: facebook.com/<tên trang>, facebook.com/<ID số>, profile.php?id=…
function detectPageTarget(rawUrl) {
  let u;
  try {
    const withHost = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://www.facebook.com/${rawUrl.replace(/^\/+/, '')}`;
    u = new URL(withHost.replace(/\/\/(?:m|mbasic|web|vi-vn)\.facebook\.com/i, '//www.facebook.com').replace(/\/\/(?:www\.)?fb\.com/i, '//www.facebook.com'));
  } catch (_) {
    return null;
  }
  if (!/facebook\.com$/i.test(u.hostname)) return null;
  const segs = u.pathname.split('/').filter(Boolean);
  if (!segs[0] || segs[0] === 'groups') return null;
  if (segs[0] === 'profile.php') {
    const id = u.searchParams.get('id');
    return id ? { pageId: id, slug: '', url: `https://www.facebook.com/profile.php?id=${id}` } : null;
  }
  if (['watch', 'reel', 'story.php', 'permalink.php', 'share', 'photo', 'photo.php', 'events', 'marketplace', 'people'].includes(segs[0])) return null;
  return {
    pageId: /^\d+$/.test(segs[0]) ? segs[0] : '',
    slug: segs[0].toLowerCase(),
    url: `https://www.facebook.com/${segs[0]}`,
  };
}

// Bài thuộc chính Fanpage đang quét (bỏ bài của trang khác được chia sẻ lại / gợi ý)
function isOwnedByPage(href, target) {
  let u;
  try { u = new URL(href); } catch (_) { return false; }
  const segs = u.pathname.split('/').filter(Boolean);
  const first = (segs[0] || '').toLowerCase();
  if (first === 'reel' || first === 'watch') return true;
  const ownerId = u.searchParams.get('id');
  if (ownerId) return !target.pageId || ownerId === target.pageId;
  return first === target.slug || (target.pageId && first === target.pageId);
}

// Fanpage giấu link bài trong mốc thời gian (href "#" / "?__cft__"), chỉ hiện link thật khi rê chuột —
// đồng thời Facebook hiện tooltip ngày giờ đầy đủ ("Thứ Năm, 16 Tháng 10, 2026 lúc 08:12").
// Rê chuột từng khối bài mới xuất hiện, ghi link + giờ vào thuộc tính để bước đọc DOM dùng lại.
// Link bài trong Group (đã kèm ID nhóm dạng số hoặc slug)
const GROUP_POST_HREF = /\/groups\/[^/]+\/(?:posts|permalink)\/[A-Za-z0-9_]+|multi_permalinks=/i;

// Hàm tự động tìm và click các nút "Xem thêm" / "See more" trên bài viết để Facebook bung 100% nội dung caption
async function expandAllSeeMore(page) {
  const count = await page.evaluate(() => {
    const seeMoreRegex = /^(?:…|\.{2,})?\s*(?:Xem\s+thêm|See\s+more|Hiển\s+thị\s+thêm)\s*$/i;
    // CHỈ tìm bên trong các bài viết feed, TUYỆT ĐỐI KHÔNG tìm ở sidebar, navigation hay liên kết ngoài
    const articles = document.querySelectorAll('[role="article"], div[data-pagelet*="FeedUnit"], div[data-virtualized]');
    let c = 0;
    for (const art of articles) {
      if (art.closest('[role="navigation"], [role="complementary"]')) continue;
      const candidates = art.querySelectorAll('div[role="button"], span[role="button"]');
      for (const btn of candidates) {
        if (btn.closest('[aria-label*="Bình luận" i], [aria-label*="Comment" i], [aria-label*="Thích" i], [aria-label*="Chia sẻ" i], form, [role="toolbar"]')) continue;
        if (btn.closest('a[href]:not([href="#"])')) continue;
        const txt = (btn.innerText || btn.textContent || '').trim();
        if (/(?:Ẩn\s+bớt|See\s+less|Thu\s+gọn)/i.test(txt)) continue;
        if (txt && seeMoreRegex.test(txt)) {
          try {
            btn.click();
            c++;
          } catch (e) {}
        }
      }
    }
    return c;
  }).catch(() => 0);
  if (count > 0) {
    await page.waitForTimeout(150);
  }
  return count;
}

// target: { type: 'PAGE', slug, pageId } hoặc { type: 'GROUP' }
async function revealPagePermalinks(page, target, onUnitDone) {
  const isGroup = target.type === 'GROUP';
  const postHref = isGroup ? GROUP_POST_HREF : PAGE_POST_HREF;
  // Mở rộng trước các nút Xem thêm hiện có
  await expandAllSeeMore(page);
  // Fanpage bọc mỗi bài trong div[data-virtualized]; bài cuộn khỏi màn hình bị làm rỗng nội dung
  let lastTip = '';
  let processed = 0;
  // Rê chuột làm Facebook tải thêm bài bên dưới → lấy lại danh sách khối vài lượt để không sót bài
  // mới tải (vòng cuộn sau chúng có thể đã bị ảo hoá thành khối rỗng)
  for (let pass = 0; pass < 3 && processed < 30; pass++) {
  const units = await page.$$('[role="main"] div[data-virtualized]:not([data-ztr-scanned]), [role="feed"] > div:not([data-ztr-scanned]), div[aria-posinset]:not([data-ztr-scanned]), div[role="article"]:not([data-ztr-scanned])').catch(() => []);
  const processedBefore = processed;
  for (const unit of units) {
    if (processed >= 30) break;
    const skip = await unit.evaluate((el) => {
      if (el.parentElement && el.parentElement.closest('[data-ztr-scanned]')) return true;
      if (el.closest('[aria-label*="Bình luận" i], [aria-label*="Comment" i]')) return true;
      // Khối đang rỗng (chưa tải / đã bị ảo hoá) → để vòng sau xử lý khi có nội dung
      if ((el.innerText || '').trim().length < 20) return true;
      el.setAttribute('data-ztr-scanned', '1');
      // Thử mở Xem thêm của bài viết này nếu có
      const sm = Array.from(el.querySelectorAll('div[role="button"], span[role="button"]')).find(b => {
        if (b.closest('[aria-label*="Bình luận" i], [aria-label*="Comment" i], [aria-label*="Thích" i], [aria-label*="Chia sẻ" i], form, [role="toolbar"]')) return false;
        if (b.closest('a[href]:not([href="#"])')) return false;
        const t = (b.innerText || b.textContent || '').trim();
        return t && /^(?:…|\.{2,})?\s*(?:Xem\s+thêm|See\s+more|Hiển\s+thị\s+thêm)\s*$/i.test(t);
      });
      if (sm && !sm.dataset.ztrExpanded) {
        sm.dataset.ztrExpanded = '1';
        try { sm.click(); } catch (e) {}
      }
      return false;
    }).catch(() => true);
    if (skip) continue;
    processed++;

    // Lọc trước các anchor tiềm năng trong DOM để chỉ rê chuột vào mốc thời gian/link bài thật
    const candIndices = await unit.evaluate((el, postHrefPattern) => {
      const re = new RegExp(postHrefPattern, 'i');
      const timeWords = /(?:phút|giờ|ngày|tháng|thg|tuần|năm|vừa xong|hôm nay|hôm qua|thứ|mins?|hrs?|hours?|days?|\b[0-9]{1,2}[hdmy]\b|\d{1,2}:\d{2})/i;
      const ignoreWords = /^(?:thích|like|bình luận|comment|chia sẻ|share|gửi|tin nhắn|message|xem thêm|see more|theo dõi|follow|đã thích|báo cáo|ẩn|chỉnh sửa)$/i;

      const allA = Array.from(el.querySelectorAll('a'));
      const indices = [];
      for (let i = 0; i < allA.length; i++) {
        const a = allA[i];
        const h = (a.getAttribute('href') || '').trim();
        const txt = (a.innerText || a.getAttribute('aria-label') || '').trim();
        if (ignoreWords.test(txt)) continue;
        if (h.includes('/user/') || h.includes('/people/') || h.includes('/hashtag/')) continue;

        if (re.test(h) || h.includes('/posts/') || h.includes('/permalink') || h.includes('/videos/') || h.includes('/reel/') || h.includes('/photo')) {
          indices.push(i);
          continue;
        }
        const hidden = !h || h.startsWith('#') || h.includes('__cft__');
        if (hidden && (timeWords.test(txt) || a.querySelector('abbr, time') || (txt.length <= 30 && /\d/.test(txt)))) {
          indices.push(i);
        }
      }
      return indices.slice(0, 4);
    }, postHref.source).catch(() => []);

    const anchors = await unit.$$('a').catch(() => []);
    const targetAnchors = candIndices.length > 0 ? candIndices.map(i => anchors[i]).filter(Boolean) : anchors.slice(0, 6);

    const readTip = () => page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('[role="tooltip"]')).pop();
      return t ? (t.innerText || '').trim() : '';
    }).catch(() => '');
    // Tooltip ngày giờ hợp lệ: "Thứ Sáu, 16 Tháng 10, 2026 lúc 11:15" / "Friday, October 16, 2026 at 11:15 AM"
    const looksLikeDate = (t) => Boolean(t) && /\d/.test(t) && /(tháng|lúc|\bat\b|\d{4})/i.test(t);
    let foundHref = '';
    let foundTip = '';
    let tries = 0;
    // Thử vài link khớp mẫu tới khi đọc được ngày giờ
    for (const a of targetAnchors) {
      if (tries >= 2) break;
      const h = (await a.getAttribute('href').catch(() => '')) || '';
      const hidden = !h || h.startsWith('#') || /^(?:https:\/\/www\.facebook\.com)?\/?\?__cft__/.test(h);
      if (!hidden && !postHref.test(h)) continue;
      await a.scrollIntoViewIfNeeded({ timeout: 400 }).catch(() => { });
      await a.hover({ timeout: 500 }).catch(() => { });
      await page.waitForTimeout(100);
      const revealed = await a.evaluate((el) => el.href).catch(() => '');
      if (!revealed || !postHref.test(revealed) || (!isGroup && !isOwnedByPage(revealed, target))) continue;
      tries++;
      if (!foundHref) foundHref = revealed;
      let tip = await readTip();
      if (!looksLikeDate(tip) || tip === lastTip) {
        // Tooltip đôi khi hiện chậm hơn link → chờ thêm chút rồi đọc lại
        await page.waitForTimeout(150);
        tip = await readTip();
      }
      if (looksLikeDate(tip) && tip !== lastTip) {
        foundTip = tip;
        break;
      }
    }
    if (foundHref) {
      if (foundTip) lastTip = foundTip;
      await unit.evaluate((el, data) => {
        el.setAttribute('data-ztr-permalink', data.href);
        if (data.tip) el.setAttribute('data-ztr-time', data.tip);
      }, { href: foundHref, tip: foundTip }).catch(() => { });
    }
    if (onUnitDone) await onUnitDone();
  }
  if (processed === processedBefore) break;
  }
  await page.mouse.move(5, 5).catch(() => { });
}

function extractFbPostId(url) {
  if (!url) return '';
  const u = String(url).trim();
  let m = u.match(/\/posts\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = u.match(/[?&]fbid=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = u.match(/\/share\/[prv]\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = u.match(/set=(?:pcb|gm|g|a)\.([a-zA-Z0-9_]+)/);
  if (m) return m[1];
  m = u.match(/[?&]story_fbid=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = u.match(/\/permalink\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return '';
}

function normalizeContentForDedup(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\p{P}\p{S}\p{C}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isPostInExcludeList(url, caption = '', excludeUrls = [], excludeIds = [], excludeSnippets = []) {
  const targetId = extractFbPostId(url);
  if (targetId) {
    if (excludeIds instanceof Set) {
      if (excludeIds.has(targetId)) return true;
    } else if (Array.isArray(excludeIds) && excludeIds.includes(targetId)) {
      return true;
    }
  }
  if (url) {
    const cleanUrl = url.split('?')[0].replace(/\/+$/, '');
    if (excludeUrls instanceof Set) {
      if (excludeUrls.has(cleanUrl)) return true;
    } else if (Array.isArray(excludeUrls) && excludeUrls.length > 0) {
      for (const ex of excludeUrls) {
        if (!ex) continue;
        const cleanEx = String(ex).trim().split('?')[0].replace(/\/+$/, '');
        if (cleanEx === cleanUrl || cleanEx.includes(cleanUrl) || cleanUrl.includes(cleanEx)) return true;
        if (targetId) {
          const exId = extractFbPostId(ex);
          if (exId && exId === targetId) return true;
        }
      }
    }
  }
  if (caption && excludeSnippets) {
    const normCap = normalizeContentForDedup(caption);
    if (normCap.length >= 25) {
      const snips = Array.isArray(excludeSnippets) ? excludeSnippets : Array.from(excludeSnippets);
      for (const normSnip of snips) {
        if (!normSnip || normSnip.length < 25) continue;
        if (normCap.includes(normSnip) || normSnip.includes(normCap.slice(0, 60)) || (normCap.length >= 40 && normSnip.length >= 40 && normCap.slice(0, 40) === normSnip.slice(0, 40))) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Quét Group hoặc Fanpage (tự nhận theo link).
 * @param {object} params { groupUrl, limit, cookieString, dateFrom, dateTo, excludeUrls, excludeIds, excludeSnippets }
 * @param {object} deps { removeFacebookLoginOverlays }
 * @returns {Promise<{status: number, body: object}>}
 */
async function huntFacebookFeed(params, deps = {}) {
  const removeFacebookLoginOverlays = deps.removeFacebookLoginOverlays || (async () => { });
  const { groupUrl, limit = 20, cookieString, dateFrom, dateTo, keyword, sortViral, minReactions = 0, excludeUrls = [], excludeIds = [], excludeSnippets = [] } = params || {};
  const trimmedKeyword = keyword ? String(keyword).trim() : '';

  // Chuyển danh sách bài trùng sang Set O(1) để tra cứu siêu tốc, không bị lag event loop khi có hàng nghìn bài cũ
  const excludeIdSet = new Set();
  if (Array.isArray(excludeIds)) {
    for (const id of excludeIds) if (id) excludeIdSet.add(String(id).trim());
  }
  const excludeUrlSet = new Set();
  if (Array.isArray(excludeUrls)) {
    for (const u of excludeUrls) {
      if (!u) continue;
      const clean = String(u).trim().split('?')[0].replace(/\/+$/, '');
      if (clean) excludeUrlSet.add(clean);
      const exId = extractFbPostId(u);
      if (exId) excludeIdSet.add(exId);
    }
  }
  const cleanExcludeSnippets = (Array.isArray(excludeSnippets) ? excludeSnippets : [])
    .filter(s => s && String(s).trim().length >= 25)
    .slice(0, 1500)
    .map(s => normalizeContentForDedup(s));

  if (!groupUrl && !trimmedKeyword) {
    return { status: 400, body: { success: false, error: 'Vui lòng cung cấp từ khoá tìm kiếm hoặc link Facebook Group' } };
  }

  let rawUrl = String(groupUrl || '').trim();
  let normalizedGroupUrl = rawUrl;
  const isGlobalSearch = !rawUrl && Boolean(trimmedKeyword);
  const pageTarget = (!rawUrl || /^\d+$/.test(rawUrl)) ? null : detectPageTarget(rawUrl);
  const isPage = Boolean(pageTarget);

  if (isGlobalSearch) {
    normalizedGroupUrl = `https://www.facebook.com/search/posts/?q=${encodeURIComponent(trimmedKeyword)}`;
  } else if (isPage) {
    normalizedGroupUrl = pageTarget.url;
  } else if (!normalizedGroupUrl.startsWith('http')) {
    if (/^\d+$/.test(normalizedGroupUrl)) {
      normalizedGroupUrl = `https://www.facebook.com/groups/${normalizedGroupUrl}`;
    } else {
      normalizedGroupUrl = `https://www.facebook.com/groups/${normalizedGroupUrl.replace(/^groups\//, '')}`;
    }
  }

  // Lọc theo ngày: dateFrom/dateTo dạng YYYY-MM-DD (giờ máy worker). Có ngày thì mở Group ở chế độ
  // "Bài viết mới" (CHRONOLOGICAL) và cuộn tới khi gặp bài cũ hơn ngày bắt đầu.
  let fromTs = dateFrom ? dayBoundary(dateFrom, false) : null;
  let toTs = dateTo ? dayBoundary(dateTo, true) : null;
  if (fromTs === null && toTs !== null) fromTs = dayBoundary(dateTo, false);
  if (fromTs !== null && toTs === null) toTs = Date.now() + 60 * 60 * 1000;
  if (fromTs !== null && toTs !== null && fromTs > toTs) [fromTs, toTs] = [dayBoundary(dateTo, false), dayBoundary(dateFrom, true)];
  const dateMode = fromTs !== null && toTs !== null;

  const requestedLimit = parseInt(limit, 10) || 20;
  const maxItems = Math.min(Math.max(requestedLimit, 1), dateMode ? 200 : 100);
  // Backend chờ tối đa 180 giây — dừng cuộn trước đó để kịp trả kết quả nhanh chóng
  const scanDeadline = Date.now() + (dateMode ? 180 : 80) * 1000;

  let navUrl = normalizedGroupUrl;
  if (isGlobalSearch) {
    navUrl = normalizedGroupUrl;
  } else if (trimmedKeyword) {
    try {
      const parsed = new URL(normalizedGroupUrl);
      const cleanPath = parsed.pathname.replace(/\/+$/, '');
      parsed.pathname = `${cleanPath}/search/`;
      parsed.searchParams.set('q', trimmedKeyword);
      if (!isPage) {
        parsed.searchParams.set('sorting_setting', 'CHRONOLOGICAL');
      }
      ['mibextid', 'rdid', 'share_url', '__cft__', '__tn__', 'ref'].forEach(k => parsed.searchParams.delete(k));
      navUrl = parsed.toString();
    } catch (_) {
      const cleanUrl = normalizedGroupUrl.split('#')[0].split('?')[0].replace(/\/+$/, '');
      navUrl = `${cleanUrl}/search/?q=${encodeURIComponent(trimmedKeyword)}`;
      if (!isPage) navUrl += '&sorting_setting=CHRONOLOGICAL';
    }
  } else if (!isPage) {
    try {
      const parsed = new URL(normalizedGroupUrl);
      parsed.searchParams.set('sorting_setting', 'CHRONOLOGICAL');
      ['mibextid', 'rdid', 'share_url', '__cft__', '__tn__', 'ref'].forEach(k => parsed.searchParams.delete(k));
      navUrl = parsed.toString();
    } catch (_) {
      const cleanUrl = normalizedGroupUrl.split('#')[0].split('?')[0].replace(/\/+$/, '');
      navUrl = `${cleanUrl}/?sorting_setting=CHRONOLOGICAL`;
    }
  }

  console.log(`[FB_Hunter] 🔍 Bắt đầu quét ${isGlobalSearch ? 'Toàn bộ bài viết Facebook' : isPage ? 'Fanpage' : 'Group'}: ${navUrl} | Từ khóa: "${trimmedKeyword || 'Tất cả'}" | Mục tiêu: ${maxItems} bài viết${dateMode ? ` | Lọc ngày ${new Date(fromTs).toLocaleString('vi-VN')} → ${new Date(toTs).toLocaleString('vi-VN')}` : ''}`);

  // Dùng context từ browserPool (chung process Chromium) thay vì chromium.launch() riêng mỗi lần quét.
  let releaseContext = null;
  try {
    const acquired = await browserPool.acquireContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 }
    });
    if (!acquired) {
      throw new Error('Browser pool đang bận hoặc quá tải, không thể lấy context duyệt web');
    }
    releaseContext = acquired.release;
    const context = acquired.context;

    let cUserId = '';
    if (cookieString && String(cookieString).trim().length > 0) {
      // Bỏ i_user để luôn quét bằng Via cá nhân (c_user), tránh dính danh nghĩa Fanpage khi vào Group kín
      const isValidCookieName = (n) => typeof n === 'string' && /^[\w!#$%&'*+\-.^`|~]+$/.test(n.trim());
      const cookies = String(cookieString).split(';')
        .map(c => {
          const idx = c.indexOf('=');
          if (idx === -1) return null;
          const name = c.slice(0, idx).trim();
          const value = c.slice(idx + 1).trim();
          if (!name || name === 'i_user' || !isValidCookieName(name) || value.includes('<') || value.includes('>') || value.length > 4096) return null;
          if (name === 'c_user' && /^\d+$/.test(value)) cUserId = value;
          return {
            name,
            value,
            domain: '.facebook.com',
            path: '/'
          };
        })
        .filter(Boolean);
      if (cookies.length > 0) {
        try {
          await context.addCookies(cookies);
        } catch (cErr) {
          console.warn(`[FB_Hunter] ⚠️ Nạp cookie thất bại (${cErr.message}) — tiếp tục quét ẩn danh.`);
        }
      }
    }

    const page = await context.newPage();

    // Chống treo: trang Facebook nặng (Fanpage nhiều video) có thể làm renderer crash. Khi đó các lệnh
    // page.evaluate() đang chờ có thể KHÔNG bao giờ trả về → request treo tới khi backend hết 5 phút chờ,
    // context không được trả lại pool. (2026-11-23: Cuồng Phim Review treo ở vòng 5, renderer đã chết.)
    // → Bắt sự kiện crash + watchdog cứng: đóng trang để mọi lệnh đang chờ bị huỷ, trả về bài đã quét được.
    let pageCrashed = false;
    page.on('crash', () => {
      pageCrashed = true;
      console.warn('[FB_Group_Hunter] 💥 Trang quét bị crash — dừng cuộn, trả về các bài đã thu được.');
      page.close().catch(() => { });
    });
    var huntWatchdog = setTimeout(() => {
      if (page.isClosed()) return;
      console.warn('[FB_Group_Hunter] ⏱️ Watchdog: quét quá hạn chót + 60s (trang bị treo) — đóng trang, trả về các bài đã thu được.');
      page.close().catch(() => { });
    }, Math.max(10_000, scanDeadline - Date.now() + 60_000));
    const pageGone = () => pageCrashed || page.isClosed();
    const safeWait = (ms) => (pageGone() ? Promise.resolve() : page.waitForTimeout(ms).catch(() => { }));

    // Tăng tốc: Chặn nạp các tài nguyên nặng (video streaming chunks, fonts, tracking pixels) để lướt siêu tốc
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      const url = route.request().url();
      if (
        resourceType === 'font' ||
        resourceType === 'media' ||
        url.includes('/privacy/sandbox/pixel') ||
        url.includes('google-analytics') ||
        url.includes('/ajax/bz')
      ) {
        return route.abort().catch(() => {});
      }
      return route.continue().catch(() => {});
    });

    await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => { });
    // Chờ ngay khi Feed hoặc Main article xuất hiện, không chờ cứng 2s
    await Promise.race([
      page.waitForSelector('div[role="feed"], div[data-pagelet*="FeedUnit"], div[role="main"], [role="article"]', { timeout: 3500 }),
      page.waitForTimeout(1000)
    ]).catch(() => {});

    // Kiểm tra tính hợp lệ của Cookie: Nếu Facebook từ chối cookie và chuyển sang màn hình đăng nhập
    const isLoginRequired = await page.evaluate(() => {
      const url = window.location.href;
      if (/facebook\.com\/(login|checkpoint)/i.test(url)) return true;
      // Nếu đã thấy bài viết / feed hiển thị thì trang vẫn đọc được công khai (kể cả khi Facebook hiện thanh gợi ý đăng nhập ở đầu trang)
      const hasArticles = document.querySelectorAll('[role="article"], div[data-pagelet*="FeedUnit"], a[href*="/posts/"], a[href*="/permalink/"]').length > 0;
      if (hasArticles) return false;
      const hasLoginInput = !!document.querySelector('input#email, input#pass, input[name="email"], input[name="pass"]');
      const hasLoginForm = !!document.querySelector('form#login_form, form#loginform, div#login_form, form[action*="/login"]');
      const hasNav = !!document.querySelector('div[role="navigation"], a[aria-label*="Trang cá nhân"], a[href*="/me/"]');
      const bodyText = (document.body && document.body.innerText) || '';
      const hasHardLoginWall = /đăng nhập để tiếp tục|bạn phải đăng nhập|log in to continue/i.test(bodyText);
      if (hasHardLoginWall && !hasNav) return true;
      if (hasLoginInput && hasLoginForm && !hasNav && bodyText.length < 600) return true;
      return false;
    }).catch(() => false);

    if (isLoginRequired) {
      console.warn(`[FB_Hunter] ⚠️ Cookie Facebook không hợp lệ hoặc đã hết hạn phiên đăng nhập khi quét: ${navUrl}`);
      return {
        status: 400,
        body: {
          success: false,
          error: 'Cookie Facebook đang dùng để quét đã hết hạn hoặc phiên đăng nhập đã đăng xuất. Vui lòng đổi sang Via khác hoặc cập nhật lại Cookie mới (c_user + xs) trong mục Kết Nối Tài Khoản.'
        }
      };
    }

    // Tự động tắt popups / overlays
    await removeFacebookLoginOverlays(page);

    // Nếu vào Group kín mà không có bài + dính màn hình Nhóm riêng tư / Không hiển thị:
    // thử chuyển phiên về Nick Cá Nhân (c_user) 1 lần phòng trường hợp cookie đang kẹt ở Page sau lúc đăng bài.
    if (!isPage && !isGlobalSearch) {
      const readGroupAccessState = async () => page.evaluate(() => {
        const main = document.querySelector('div[role="main"]') || document.body;
        const text = (main && main.innerText) || '';
        const hasFeedArticles = document.querySelectorAll('div[role="feed"] [role="article"], div[role="feed"] a[href*="/posts/"], div[role="feed"] a[href*="/permalink/"], [role="article"] a[href*="/posts/"]').length > 0;
        const isPrivateWall = /nhóm riêng tư|private group|nội dung này hiện không hiển thị|this content isn't available|bạn không thể xem nội dung này|tham gia nhóm để xem bài viết|you must be a member/i.test(text);
        return { hasFeedArticles, isPrivateWall };
      }).catch(() => ({ hasFeedArticles: true, isPrivateWall: false }));

      let accessState = await readGroupAccessState();
      if (!accessState.hasFeedArticles && accessState.isPrivateWall) {
        if (cUserId) {
          console.log(`[FB_Hunter] 👤 Gặp tường nhóm riêng tư / hạn chế, thử chuyển danh tính về Via cá nhân (${cUserId}) và tải lại...`);
          await page.goto(`https://www.facebook.com/profile/switch/?target_id=${cUserId}`, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => { });
          await page.waitForTimeout(1500);
          const confirmBtn = page.locator('div[role="button"]:has-text("Chuyển"), div[role="button"]:has-text("Switch"), button:has-text("Chuyển")').first();
          if (await confirmBtn.isVisible().catch(() => false)) {
            await confirmBtn.click({ force: true }).catch(() => { });
            await page.waitForTimeout(2000);
          }
          await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => { });
          await Promise.race([
            page.waitForSelector('div[role="feed"] [role="article"], [role="article"], div[role="main"]', { timeout: 3500 }),
            page.waitForTimeout(1200),
          ]).catch(() => { });
          await removeFacebookLoginOverlays(page);
          accessState = await readGroupAccessState();
        }
        if (!accessState.hasFeedArticles && accessState.isPrivateWall) {
          console.warn(`[FB_Hunter] 🔒 Via (${cUserId || 'unknown'}) chưa tham gia hoặc không có quyền xem nhóm riêng tư: ${navUrl}`);
          return {
            status: 400,
            body: {
              success: false,
              code: 'PRIVATE_GROUP_NO_ACCESS',
              error: 'Via đang chọn chưa tham gia nhóm riêng tư này (hoặc không có quyền xem). Hãy chọn một Via khác đã vào nhóm ở mục "Via quét bài" phía trên rồi quét lại!'
            }
          };
        }
      }
    }

    // Kiểm tra bảo đảm an toàn 100%: nếu Facebook vẫn ở chế độ "Phù hợp nhất", tự chuyển sang "Bài viết mới"
    if (!isPage && !isGlobalSearch) {
      try {
        const needsSwitch = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('div[role="button"], span'));
          const sortEl = btns.find(b => /sắp xếp bảng feed nhóm theo|phù hợp nhất/i.test(b.innerText || ''));
          return Boolean(sortEl && /phù hợp nhất/i.test(sortEl.innerText || ''));
        }).catch(() => false);

        if (needsSwitch) {
          console.log('[FB_Hunter] 🔄 Phát hiện Feed đang ở Phù hợp nhất, tự động chuyển sang Bài viết mới...');
          await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('div[role="button"], span'));
            const sortBtn = btns.find(b => /sắp xếp bảng feed nhóm theo|phù hợp nhất/i.test(b.innerText || ''));
            const target = sortBtn?.closest('div[role="button"]') || sortBtn;
            target?.click();
          }).catch(() => {});
          await page.waitForTimeout(500);

          const clickedNew = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('div[role="menuitem"], div[role="menuitemradio"], div[role="button"]'));
            const newPostsOption = items.find(it => /bài viết mới|new posts/i.test(it.innerText || ''));
            if (newPostsOption) {
              newPostsOption.click();
              return true;
            }
            return false;
          }).catch(() => false);

          if (clickedNew) {
            await page.waitForTimeout(1500);
          }
        }
      } catch (_) {}
    }

    let groupTitle = await page.evaluate(() => {
      const mainH1 = document.querySelector('div[role="main"] h1, h1[dir="auto"], div[role="heading"][aria-level="1"], h1');
      let name = mainH1?.innerText?.trim() || '';
      if (!name || name.toLowerCase().includes('thông báo') || name.toLowerCase().includes('facebook')) {
        name = document.title?.replace(/\(\d+\)/g, '').replace(/\s*\|\s*Facebook\s*$/i, '').trim() || '';
      }
      return name || 'Facebook Group';
    }).catch(() => 'Facebook Group');

    const collectedItemsMap = new Map();
    const maxScrollRounds = dateMode ? 120 : Math.min(Math.max(maxItems * 3, 25), 70);
    let stagnantCount = 0;
    let stopReason = '';

    // Số bài đã thu được tính vào giới hạn: CHỈ ĐẾM BÀI MỚI CHƯA ĐĂNG (!isAlreadyImported)
    // để Worker tiếp tục cuộn sâu lấy đủ số bài người dùng yêu cầu (kể cả khi đã có nhiều bài cũ bị trùng)
    const countTowardsLimit = () => {
      let n = 0;
      for (const it of collectedItemsMap.values()) {
        if (dateMode) {
          if (it.postedAt !== null && it.postedAt >= fromTs && it.postedAt <= toTs && !it.isAlreadyImported) n++;
        } else {
          if (!it.isAlreadyImported) n++;
        }
      }
      return n;
    };
    // Đã cuộn qua khỏi ngày bắt đầu: 3 bài gần nhất (đọc được ngày) đều cũ hơn ngày bắt đầu.
    // Bài ghim / bài nổi bật cũ ở đầu feed không làm dừng sớm vì sau đó còn bài mới.
    const passedStartDate = () => {
      const known = Array.from(collectedItemsMap.values()).filter((it) => it.postedAt !== null);
      if (known.length < 3) return false;
      return known.slice(-3).every((it) => it.postedAt < fromTs);
    };

    let groupId = '';
    const gMatch = normalizedGroupUrl.match(/groups\/([^\/\?]+)/);
    if (gMatch) groupId = gMatch[1];

    let cookieFallbackDone = false;

    for (let round = 0; round < maxScrollRounds && countTowardsLimit() < maxItems; round++) {
      try {
      const prevSize = collectedItemsMap.size;
      if (pageGone()) {
        stopReason = 'PAGE_CRASHED';
        break;
      }
      if (Date.now() > scanDeadline) {
        stopReason = 'TIMEOUT';
        console.log('[FB_Group_Hunter] ⏱️ Hết thời gian quét, trả về kết quả đã thu được.');
        break;
      }

      // Xóa overlay đăng nhập và mở khóa thanh cuộn body
      await page.keyboard.press('Escape').catch(() => { });
      await removeFacebookLoginOverlays(page);
      await page.evaluate(() => {
        const closeBtns = document.querySelectorAll('div[aria-label="Đóng" i], div[aria-label="Close" i], div[role="dialog"] [aria-label="Đóng" i], div[role="dialog"] [aria-label="Close" i]');
        closeBtns.forEach(b => { try { b.click(); } catch (e) { } });
        document.querySelectorAll('div[role="dialog"]').forEach(d => {
          if (!d.querySelector('div[role="article"]')) d.remove();
        });
        document.querySelectorAll('form[action*="login"]').forEach(f => f.remove());
        document.body.style.overflow = 'auto';
        document.documentElement.style.overflow = 'auto';
        document.body.style.position = 'static';
      }).catch(() => { });

      // Đọc các bài đang hiển thị và gộp vào danh sách (gọi lại sau mỗi bài rê chuột để không sót bài bị ảo hoá)
      const collectNow = async () => {
        const newItems = await page.evaluate(({ maxCap, gid, pageMode, pageSlug, pageId, pagePostSource, requireScanned, scanKeyword }) => {
          const results = [];
          const pagePostRe = new RegExp(pagePostSource, 'i');
          const ownedByPage = (href) => {
            let u;
            try { u = new URL(href); } catch (e) { return false; }
            const segs = u.pathname.split('/').filter(Boolean);
            const first = (segs[0] || '').toLowerCase();
            if (first === 'reel' || first === 'watch') return true;
            const ownerId = u.searchParams.get('id');
            if (ownerId) return !pageId || ownerId === pageId;
            return first === pageSlug || (pageId && first === pageId);
          };
          // Bỏ tham số theo dõi, giữ tham số định danh bài (story_fbid, id, v)
          const cleanPagePostUrl = (href) => {
            try {
              const u = new URL(href);
              const keep = new URLSearchParams();
              ['story_fbid', 'id', 'v'].forEach((k) => { if (u.searchParams.get(k)) keep.set(k, u.searchParams.get(k)); });
              const q = keep.toString();
              return `https://www.facebook.com${u.pathname}${q ? `?${q}` : ''}`;
            } catch (e) {
              return href.split('?')[0];
            }
          };
          const readTag = (el, attr) => el.getAttribute(attr)
            || (el.closest(`[${attr}]`) && el.closest(`[${attr}]`).getAttribute(attr))
            || (el.querySelector(`[${attr}]`) && el.querySelector(`[${attr}]`).getAttribute(attr))
            || '';

          // Selector chuẩn xác cho từng bài đăng riêng biệt
          let articles = Array.from(document.querySelectorAll(pageMode
            ? '[role="main"] div[data-virtualized], div[role="feed"] > div, div[aria-posinset]'
            : 'div[role="feed"] > div, div[data-pagelet*="FeedUnit"], div[role="article"]'));

          const isCommentOrNoise = (el) => {
            if (!el) return true;
            if (el.parentElement && el.parentElement.closest('[role="article"]')) return true;
            if (el.closest('[aria-label*="Bình luận" i], [aria-label*="Comment" i], [aria-label*="Danh sách bình luận" i], form, ul[role="group"]')) return true;
            return false;
          };

          for (const art of articles) {
            if (isCommentOrNoise(art)) continue;
            // Phần tử nằm trong một bài con (bình luận / bài được chia sẻ lồng bên trong) chứ không phải chính bài này
            const ownArticle = art.matches('[role="article"]') ? art : art.querySelector('[role="article"]');
            const inNestedArticle = (el) => {
              const a = el.closest('[role="article"]');
              return Boolean(a && a !== ownArticle && art.contains(a));
            };
            // Bài vừa tải thêm trong lúc rê chuột chưa được đọc ngày giờ → để vòng sau
            if (requireScanned && !readTag(art, 'data-ztr-scanned')) continue;
            if (art.querySelector('div[data-pagelet*="GroupRules"], [aria-label*="Quy tắc nhóm" i]')) continue;

            // 1. Tìm Tác giả (Tên thành viên đăng bài)
            let rawAuthor = '';
            // Nhận diện tên Group để tránh nhầm Group name với tên tác giả
            const groupHeaderEl = art.querySelector('h2 a[href*="/groups/"]:not([href*="/user/"]), a[href*="/groups/"]:not([href*="/user/"]) strong');
            const groupHeaderName = (groupHeaderEl?.innerText || '').trim();

            // Ưu tiên 0: Bóc tách trực tiếp từ h2 bài viết (VD: "Bài viết của Lê Hoàg Thiên" hoặc "Post by John")
            const allArtH2 = Array.from(art.querySelectorAll('h2'));
            for (const h of allArtH2) {
              const hTxt = (h.innerText || '').trim();
              const m = hTxt.match(/^(?:bài viết của|post by)\s+(.+)$/i);
              if (m && m[1] && m[1].trim().length >= 2 && m[1].trim().length <= 50) {
                rawAuthor = m[1].trim();
                break;
              }
            }

            if (!rawAuthor) {
              const authorCandidates = [
                art.querySelector('a[href*="/user/"]:not([href*="/groups/"]) strong, a[href*="/user/"]:not([href*="/groups/"]) span, a[href*="/user/"]:not([href*="/groups/"])'),
                art.querySelector('a[href*="profile.php"]:not([href*="/groups/"]) strong, a[href*="profile.php"]:not([href*="/groups/"]) span, a[href*="profile.php"]:not([href*="/groups/"])'),
                art.querySelector('a[href*="/people/"]:not([href*="/groups/"]) strong, a[href*="/people/"]:not([href*="/groups/"]) span, a[href*="/people/"]:not([href*="/groups/"])'),
                art.querySelector('h2 a:not([href*="/groups/"]):not([href*="/posts/"]), h3 a:not([href*="/groups/"]):not([href*="/posts/"])'),
                art.querySelector('h2 strong, h3 strong'),
              ];

              for (const cand of authorCandidates) {
                if (!cand) continue;
                let txt = (cand.getAttribute('aria-label') || cand.innerText || cand.textContent || '').trim();
                if (!txt) {
                  txt = (cand.querySelector('img[alt]')?.getAttribute('alt') || '').trim();
                }
                // Tên tác giả phải là tên ngắn gọn (dưới 50 ký tự), không chứa xuống dòng hoặc dấu câu hoàn chỉnh
                if (txt && txt.length >= 2 && txt.length <= 50 && !txt.includes('\n') && !/[.!?]/.test(txt) && !/^(Facebook|Home|Trang chủ|Group|Nhóm|Theo dõi|Follow|Online)$/i.test(txt)) {
                  if (!groupHeaderName || txt.toLowerCase() !== groupHeaderName.toLowerCase()) {
                    rawAuthor = txt;
                    break;
                  }
                }
              }
            }

            // Làm sạch triệt để danh xưng, vai trò và badge do Facebook đính kèm
            const cleanAuthorName = (raw) => {
              if (!raw) return '';
              let a = raw.split('\n')[0].trim();
              a = a
                .replace(/Online\s+status\s+in[^\n·•]*/gi, '')
                .replace(/Chỉ báo trạng thái (?:online|trực tuyến)/gi, '')
                .replace(/[\s\u00A0]*[·•|–—-][\s\u00A0]*(?:Theo dõi|Follow|Following|Đã theo dõi|Quản trị viên|Admin|Người điều hành|Moderator|Người đóng góp hàng đầu|Top Contributor|Tác giả|Author).*$/i, '')
                .replace(/\s*\((?:Admin|Quản trị viên|Tác giả|Author|Mod|Người kiểm duyệt)\)\s*/gi, '')
                .replace(/^bài viết của\s+/i, '')
                .replace(/^post by\s+/i, '')
                .replace(/^trang cá nhân của\s+/i, '')
                .replace(/^profile of\s+/i, '')
                .trim();
              if (groupHeaderName && a.toLowerCase() === groupHeaderName.toLowerCase()) return '';
              if (/^(Facebook|Bài viết Facebook|Video Facebook|Group|Nhóm|Trang chủ|Home|Feed|Reels?|Watch|Chỉ báo trạng thái online|Trạng thái online)$/i.test(a)) return '';
              if (a.toLowerCase().includes('online status') || a.toLowerCase().includes('trạng thái online') || a.toLowerCase().includes('trực tuyến') || a.length < 2 || a.length > 50) return '';
              if (/[.!?]/.test(a)) return '';
              return a;
            };

            let author = cleanAuthorName(rawAuthor) || 'Thành viên nhóm';

            // 2. Tìm permalink chuẩn xác của bài viết
            let postUrl = '';
            const links = Array.from(art.querySelectorAll('a[href]'));
            if (pageMode) {
              const tagged = readTag(art, 'data-ztr-permalink');
              if (tagged) {
                postUrl = cleanPagePostUrl(tagged);
              } else {
                const direct = links.find((a) => pagePostRe.test(a.href || '') && ownedByPage(a.href) && !(a.href || '').includes('comment_id='));
                if (direct) postUrl = cleanPagePostUrl(direct.href);
              }
              if (!postUrl) continue;
            }
            for (const a of (pageMode ? [] : links)) {
              const h = a.href || '';
              // Bỏ qua link profile người dùng, story, hashtag, quy tắc nhóm
              if (
                h.includes('/user/') ||
                h.includes('/people/') ||
                h.includes('/profile.php') ||
                h.includes('/stories/') ||
                h.includes('/hashtag/') ||
                h.includes('/member-requests/') ||
                h.includes('/about/') ||
                h.includes('/buy_sell_discussion/')
              ) {
                continue;
              }

              // Ưu tiên 1: Lấy post_id từ đường dẫn /posts/ID hoặc /permalink/ID (kể cả khi URL có kèm ?comment_id=..., vẫn trích xuất đúng post_id gốc)
              const postMatch = h.match(/\/groups\/[^\/]+\/(?:posts|permalink)\/([a-zA-Z0-9_]+)/);
              if (postMatch) {
                postUrl = gid ? `https://www.facebook.com/groups/${gid}/posts/${postMatch[1]}/` : h.split('?')[0];
                break;
              }

              if (h.includes('comment_id=')) continue;

              // Ưu tiên 2: Lấy post_id từ multi_permalinks=...
              const multiMatch = h.match(/multi_permalinks=([a-zA-Z0-9_]+)/);
              if (multiMatch) {
                postUrl = `https://www.facebook.com/groups/${gid}/posts/${multiMatch[1]}/`;
                break;
              }

              // Ưu tiên 3: Lấy post_id từ set=pcb. hoặc set=gm. hoặc set=g. hoặc set=a.
              const pcbMatch = h.match(/set=(?:pcb|gm|g|a)\.([a-zA-Z0-9_]+)/);
              if (pcbMatch) {
                postUrl = gid ? `https://www.facebook.com/groups/${gid}/posts/${pcbMatch[1]}/` : h;
                break;
              }

              // Ưu tiên 4: Link photo trực tiếp
              const photoMatch = h.match(/\/photo\/?\?(?:.*&)?fbid=(\d+)/);
              if (photoMatch) {
                postUrl = gid ? `https://www.facebook.com/photo/?fbid=${photoMatch[1]}&set=g.${gid}` : h.split('&')[0];
                break;
              }

              // Ưu tiên 5: Share / Reels / Videos
              if (h.includes('/share/p/') || h.includes('/share/r/') || h.includes('/share/v/')) {
                postUrl = h.split('?')[0];
                break;
              }
            }

            if (!postUrl && !pageMode) {
              const timeAnchor = links.find(a => {
                const h = a.href || '';
                if (h.includes('/user/') || h.includes('/people/') || h.includes('/profile.php') || h.includes('comment_id=')) return false;
                const txt = (a.innerText || '').trim();
                return /^(?:\d{1,2}\s*(?:phút|giờ|ngày|tháng|mins?|hrs?|d|w|m|y)|vừa xong|hôm qua|hôm nay|thứ\s+\d|\d{1,2}\s+tháng\s+\d{1,2})/i.test(txt);
              });
              if (timeAnchor && timeAnchor.href && timeAnchor.href.includes('/groups/')) {
                postUrl = timeAnchor.href.split('?')[0];
              }
            }

            if (!postUrl) continue;

            // 3. Tìm Caption bài viết (bỏ qua tên tác giả và nút hành động)
            const cleanSeeMoreText = (txt) => {
              if (!txt) return '';
              let s = txt
                // Xoá mọi biến thể ".... Xem thêm" hoặc "... Xem thêm Ẩn bớt" ở cuối chuỗi với số lượng chấm bất kỳ
                .replace(/[\s\u200B\u00A0]*(?:…|\.{2,})?[\s\u200B\u00A0]*(?:Xem\s+thêm|See\s+more|Hiển\s+thị\s+thêm)[\s\u200B\u00A0]*(?:Ẩn\s+bớt|See\s+less|Thu\s+gọn)?[\s\u200B\u00A0]*$/gi, '')
                .replace(/[\s\u200B\u00A0]*(?:Ẩn\s+bớt|See\s+less|Thu\s+gọn)[\s\u200B\u00A0]*$/gi, '')
                .replace(/(?:^|\n)[\s\u200B\u00A0]*(?:Xem\s+thêm|See\s+more|Hiển\s+thị\s+thêm|Ẩn\s+bớt|See\s+less|Thu\s+gọn)[\s\u200B\u00A0]*$/gim, '')
                .replace(/[\s\u200B\u00A0]*(?:…|\.{2,})[\s\u200B\u00A0]*(?:Xem\s+thêm|See\s+more)\b/gi, '')
                .replace(/\n?(?:Translate|Dịch)\s*$/gi, '')
                .replace(/(?:^|\n)[\s\u200B\u00A0]*(?:Công khai|Public|Chỉ mình tôi|Bạn bè|Friends|Only me|Chia sẻ với:?\s*Công khai|Shared with:?\s*Public)[\s\u200B\u00A0]*$/gim, '')
                .trim();

              // Nếu còn dấu 3 chấm dở dang ở cuối
              s = s.replace(/(?:…|\.{2,})\s*$/g, '').trim();
              return s;
            };

            let caption = '';
            // Chuỗi bị Facebook xáo (chống cào): token dài lẫn chữ + số, không phải link.
            const isJunkWord = (w) => w.length >= 12 && /[a-zA-Z]/.test(w) && /\d/.test(w) && !/^https?:\/\//i.test(w);
            const isJunkText = (t) => {
              const ws = t.split(/\s+/).filter(Boolean);
              return ws.length > 0 && ws.filter(isJunkWord).length / ws.length >= 0.5;
            };

            // Ưu tiên 1: Vùng tin nhắn chuẩn của Facebook
            const msgEl = Array.from(art.querySelectorAll('div[data-ad-preview="message"], div[data-ad-comet-preview="message"]'))
              .find((el) => !inNestedArticle(el));
            if (msgEl) {
              caption = cleanSeeMoreText(msgEl.innerText || '');
            } else {
              // Ưu tiên 2: Định vị chính xác vùng Caption nằm giữa Header bài viết và Media/Toolbar
              const toolbar = art.querySelector('[role="toolbar"], [aria-label*="Thích" i], [aria-label*="Like" i], [aria-label*="Chia sẻ" i]');
              const media = art.querySelector('a[href*="/photo"], a[href*="set="], video, [data-visualcompletion="media-vc-image"]');
              const header = art.querySelector('h2, h3, header');

              const candidates = Array.from(art.querySelectorAll('div[dir="auto"], span[dir="auto"]'))
                .filter(el => {
                  if (inNestedArticle(el)) return false;
                  // Tuyệt đối không lấy text nằm trong hoặc sau Toolbar (loại bỏ 100% comment, người comment, like/share bar)
                  if (toolbar) {
                    if (el === toolbar || toolbar.contains(el)) return false;
                    if ((el.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_PRECEDING) !== 0) return false;
                  }
                  // Tuyệt đối không lấy text nằm trong hoặc sau Media (tránh lấy nhầm thông tin chú thích ảnh con)
                  if (media) {
                    if (el === media || media.contains(el)) return false;
                    if ((el.compareDocumentPosition(media) & Node.DOCUMENT_POSITION_PRECEDING) !== 0) return false;
                  }
                  // Bỏ qua header bài viết & profile link của tác giả
                  if (header && (el === header || header.contains(el))) return false;
                  if (el.closest('h2, h3, h4, header, a[href*="/user/"], a[href*="profile.php"], a[href*="/people/"]')) return false;
                  // Bỏ qua các nút bấm, icon, danh sách
                  if (el.closest('button, [role="button"], form, ul')) return false;

                  const t = (el.innerText || '').trim();
                  if (!t || t.length < 3) return false;
                  if (t === author || t === 'Facebook' || t === 'Thích' || t === 'Bình luận' || t === 'Chia sẻ' || /^(?:Công khai|Public|Bạn bè|Friends|Chỉ mình tôi|Only me)$/i.test(t)) return false;
                  if (/^(?:Chia sẻ với:?\s*(?:Công khai|Public|Bạn bè)|Shared with:?\s*(?:Public|Friends))/i.test(t)) return false;
                  if (/^(?:\d{1,2}\s*(?:phút|giờ|ngày|tháng|mins?|hrs?|d|w|m|y)|vừa xong|hôm qua|hôm nay|thứ\s+\d|\d{1,2}\s+tháng\s+\d{1,2})/i.test(t)) return false;
                  // Chuỗi ký tự bị Facebook xáo (mốc thời gian chống cào / anti-scraping obfuscation)
                  if (t.length > 20 && !/\s/.test(t)) return false;
                  // Kiểm tra từ ngữ rác chứa chuỗi ngẫu nhiên dài lẫn lộn chữ và số
                  if (isJunkText(t)) return false;
                  return true;
                });

              if (candidates.length > 0) {
                // Ghép tất cả các đoạn văn không lồng nhau theo đúng thứ tự hiển thị DOM
                const topLevelCandidates = candidates.filter((c) => !candidates.some((other) => other !== c && other.contains(c)));
                const combined = topLevelCandidates.map((c) => cleanSeeMoreText(c.innerText || '')).filter(Boolean).join('\n\n');
                caption = cleanSeeMoreText(combined || candidates[0]?.innerText || '');
              }
            }

            // Kiểm tra lần 2: nếu caption vẫn chứa từ ngữ xáo rác của Facebook
            if (caption) {
              if (isJunkText(caption)) caption = '';
            }

            // Nếu không có caption text nhưng có ảnh alt mô tả nội dung
            if (!caption) {
              const imgWithAlt = art.querySelector('img[alt]');
              if (imgWithAlt) {
                const alt = (imgWithAlt.getAttribute('alt') || '').trim();
                if (alt && !/^(?:Có thể là|May be an image of|Hình ảnh về|Image may contain)/i.test(alt) && alt.length > 10) {
                  caption = alt;
                }
              }
            }

            // Lọc trùng lặp dòng/đoạn văn bản bị lặp lại liên tiếp
            if (caption) {
              const cLines = caption.split('\n');
              const dLines = [];
              for (const l of cLines) {
                const tr = l.trim();
                if (dLines.length > 0 && dLines[dLines.length - 1].trim() === tr && tr.length > 0) continue;
                dLines.push(l);
              }
              const dParas = dLines.join('\n').split(/\n\s*\n/);
              const dedupeP = [];
              for (const p of dParas) {
                const tr = p.trim();
                if (!tr) continue;
                if (dedupeP.length > 0 && dedupeP[dedupeP.length - 1].trim() === tr) continue;
                dedupeP.push(tr);
              }
              caption = dedupeP.join('\n\n').trim();
            }

            // 4. Tìm Ảnh / Media preview
            const imgs = Array.from(new Set(Array.from(art.querySelectorAll('a[href*="/photo"] img, a[href*="set="] img, div[data-visualcompletion="media-vc-image"] img, img'))
              .filter(img => {
                const s = img.src || '';
                if (!s || (!s.includes('scontent') && !s.includes('fbcdn.net'))) return false;
                if (img.closest('a[href*="/stories/"], div[data-pagelet*="Stories"], [aria-label*="Bình luận" i], [aria-label*="Comment" i]')) return false;
                if (inNestedArticle(img)) return false;
                if (s.includes('rsrc.php') || s.includes('static.xx') || s.includes('emoji')) return false;
                // Ảnh trong link ảnh của bài đang tải lười (chưa có kích thước) vẫn là ảnh bài
                if (img.closest('a[href*="/photo"], a[href*="set="], div[data-visualcompletion="media-vc-image"]')) return true;
                const w = img.naturalWidth || img.width || 0;
                const h = img.naturalHeight || img.height || 0;
                return (w > 120 || h > 120);
              })
              .map(img => img.src)));

            // Không dò theo chữ "video" trong aria-label: nút bình luận "Đính kèm một ảnh hoặc video" làm
            // bài ảnh bị nhận nhầm là video. Chỉ tin khung phát video thật hoặc link reel/video.
            const hasVideo = !!art.querySelector('video, div[data-pagelet*="Video"], a[href*="/reel/"], a[href*="/videos/"], a[href*="/watch/?v="], [aria-label="Video player" i], [aria-label="Trình phát video" i]')
              || /\/(?:reel|videos)\/|\/watch\/?\?v=/.test(postUrl);
            const videoEl = art.querySelector('video');
            const videoPoster = videoEl ? (videoEl.getAttribute('poster') || '') : '';
            // Ảnh bài đang tải lười (chưa có kích thước) vẫn tính là bài có ảnh nếu nằm trong link ảnh của bài
            const hasPhoto = imgs.length > 0 || !!art.querySelector('a[href*="/photo"] img, a[href*="set=a."] img, a[href*="set=pcb."] img, a[href*="set=gm."] img, div[data-visualcompletion="media-vc-image"] img');
            // Bắt buộc bài viết phải có Ảnh/Video HOẶC có nội dung Text dài có ý nghĩa (bài viết thảo luận)
            if (!hasVideo && !hasPhoto && (!caption || caption.trim().length < 25)) continue;
            // Không lấy bài rỗng không có chữ / caption quá ngắn dưới 5 ký tự
            if (!caption || caption.trim().length < 5) continue;
            // Lớp phủ "+N" chỉ nằm trên ô ảnh cuối của lưới ảnh — không dò trong caption ("+84…", "+18")
            let extraCount = 0;
            for (const el of art.querySelectorAll('a[href*="/photo"], a[href*="set="], div[data-visualcompletion="media-vc-image"]')) {
              if (inNestedArticle(el)) continue;
              const m = (el.innerText || '').trim().match(/^\+(\d{1,2})$/);
              if (m) { extraCount = Math.max(extraCount, parseInt(m[1], 10)); }
            }
            const totalMediaCount = hasVideo ? Math.max(1, imgs.length) : (hasPhoto ? Math.max(imgs.length, 1) + extraCount : 0);

            const id = postUrl.replace(/[^a-zA-Z0-9]/g, '_').slice(-40) || Math.random().toString(36).substring(2);

            // 5. Tìm thời gian đăng bài (postedTime)
            let postedTime = '';
            // Mốc thời gian là chuỗi ngắn 1 dòng — loại link tên trang ("...24h, xem tin") hoặc chuỗi xáo rác
            const shortTime = (t) => Boolean(t) && t.length <= 36 && !/\n/.test(t) && !/\.com|https?:\/\/|xem\s+tin/i.test(t) && !isJunkText(t);
            const strictTimeRe = /^(?:vừa xong|vừa đăng|just now|hôm qua|hôm nay|yesterday|today|\d{1,2}\s*(?:phút|giờ|ngày|tuần|tháng|thg|năm|mins?|hrs?|hours?|days?|weeks?|h|d|w|m|y)\b|thứ\s+[a-zA-Z0-9_À-ỹ]+|\d{1,2}\s+(?:tháng|thg)\s+\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}|[0-9]{1,2}:[0-9]{2})/i;
            const taggedTime = readTag(art, 'data-ztr-time');
            if (taggedTime) postedTime = taggedTime;

            // Ưu tiên 1: Link trỏ đến chính bài viết (permalink) thường chứa thời gian
            if (!postedTime && postUrl) {
              const postLinks = links.filter(a => {
                const h = a.href || '';
                return h && (h === postUrl || h.includes(postUrl) || postUrl.includes(h.split('?')[0]));
              });
              for (const a of postLinks) {
                const t = (a.innerText || a.getAttribute('aria-label') || '').trim();
                if (shortTime(t) && strictTimeRe.test(t)) {
                  postedTime = t;
                  break;
                }
              }
            }

            // Ưu tiên 2: Tìm link có text/aria-label chứa thời gian chuẩn xác
            if (!postedTime) {
              for (const a of links) {
                const h = a.href || '';
                if (h.includes('/user/') || h.includes('/people/') || h.includes('/profile.php') || h.includes('comment_id=')) continue;
                const txt = (a.innerText || a.getAttribute('aria-label') || '').trim();
                if (!shortTime(txt)) continue;
                if (strictTimeRe.test(txt)) {
                  postedTime = txt;
                  break;
                }
              }
            }

            // Ưu tiên 3: Quét các thẻ abbr, time, span/a có aria-label
            if (!postedTime) {
              const timeEls = Array.from(art.querySelectorAll('abbr, time, span[aria-label*="phút" i], span[aria-label*="giờ" i], span[aria-label*="ngày" i], span[aria-label*="hôm" i], span[aria-label*="tháng" i], a[aria-label*="phút" i], a[aria-label*="giờ" i], a[aria-label*="ngày" i], a[aria-label*="tháng" i]'));
              for (const el of timeEls) {
                const aria = (el.getAttribute('aria-label') || '').trim();
                const inner = (el.innerText || '').trim();
                const cand = aria || inner;
                if (shortTime(cand) && strictTimeRe.test(cand)) {
                  postedTime = cand;
                  break;
                }
              }
            }

            // Làm sạch text thời gian: xoá bỏ các chữ thừa như "Online status in", bullet "·", "Công khai"
            if (postedTime) {
              postedTime = postedTime
                .replace(/^.*?(?:status in|trực tuyến|tác giả|bởi)\s*/i, '')
                .replace(/\s*(?:công khai|thành viên|bạn bè|chỉ mình tôi|public|friends|shared with).*$/i, '')
                .replace(/^[·•\s\-_]+|[·•\s\-_]+$/g, '')
                .trim();
            }

            const utimeEl = art.querySelector('abbr[data-utime], [data-utime]');
            const postedUtime = utimeEl ? parseInt(utimeEl.getAttribute('data-utime'), 10) || null : null;
            const postedTimeLabel = postedTime || '';
            const postedTimeExact = taggedTime || postedTime;
            // 6. Trích xuất chỉ số tương tác (Reactions, Comments, Shares) cho tính năng Viral
            let reactions = 0;
            let comments = 0;
            let shares = 0;

            const rxEls = Array.from(art.querySelectorAll('[aria-label*="bày tỏ cảm xúc" i], [aria-label*="reactions" i], [aria-label*="người thích" i], [role="toolbar"] span, span[data-visualcompletion] span'));
            for (const el of rxEls) {
              const aria = el.getAttribute('aria-label') || '';
              const txt = (el.innerText || aria).trim();
              const m = txt.match(/(\d+(?:[.,]\d+)?)\s*(k|m|người)?/i);
              if (m) {
                let num = parseFloat(m[1].replace(',', '.'));
                if (m[2]?.toLowerCase() === 'k') num *= 1000;
                if (m[2]?.toLowerCase() === 'm') num *= 1000000;
                if (num > reactions) reactions = Math.round(num);
              }
            }

            const textNodes = Array.from(art.querySelectorAll('span, div[role="button"], a[role="button"]'))
              .map(el => (el.innerText || '').trim())
              .filter(Boolean);

            for (const t of textNodes) {
              const cmtMatch = t.match(/(\d+(?:[.,]\d+)?)\s*(k|m)?\s*(?:bình luận|comments?)/i);
              if (cmtMatch) {
                let c = parseFloat(cmtMatch[1].replace(',', '.'));
                if (cmtMatch[2]?.toLowerCase() === 'k') c *= 1000;
                if (c > comments) comments = Math.round(c);
              }
              const shareMatch = t.match(/(\d+(?:[.,]\d+)?)\s*(k|m)?\s*(?:lượt chia sẻ|shares?)/i);
              if (shareMatch) {
                let s = parseFloat(shareMatch[1].replace(',', '.'));
                if (shareMatch[2]?.toLowerCase() === 'k') s *= 1000;
                if (s > shares) shares = Math.round(s);
              }
            }

            if (reactions === 0) {
              const countSpan = art.querySelector('span[aria-hidden="true"]');
              if (countSpan && /^\d+(?:[.,]\d+)?\s*[kKmM]?$/.test(countSpan.innerText?.trim())) {
                const raw = countSpan.innerText.trim();
                let num = parseFloat(raw.replace(',', '.'));
                if (/[kK]/.test(raw)) num *= 1000;
                reactions = Math.round(num);
              }
            }

            const viralScore = reactions + (comments * 2) + (shares * 3);
            const isViral = viralScore >= 50;

            const kw = (scanKeyword || '').toLowerCase().trim();
            const matchedKeyword = Boolean(kw && (caption.toLowerCase().includes(kw) || author.toLowerCase().includes(kw)));

            results.push({
              id,
              url: postUrl,
              author,
              caption: caption || 'Bài viết không có tiêu đề',
              previewCover: imgs[0] || videoPoster || '',
              images: imgs.slice(0, 5),
              mediaType: hasVideo ? 'VIDEO' : (hasPhoto ? 'IMAGE' : 'TEXT'),
              mediaCount: totalMediaCount,
              postedTime: postedTime || 'Gần đây',
              postedUtime,
              publishedAt: postedUtime ? new Date(postedUtime * 1000).toISOString() : undefined,
              postedTimeLabel,
              postedTimeExact,
              reactions,
              comments,
              shares,
              viralScore,
              isViral,
              matchedKeyword,
            });
          }
          return results;
        }, {
          maxCap: maxItems,
          gid: groupId,
          pageMode: isPage,
          pageSlug: isPage ? pageTarget.slug : '',
          pageId: isPage ? pageTarget.pageId : '',
          pagePostSource: PAGE_POST_HREF.source,
          requireScanned: isPage || dateMode,
          scanKeyword: trimmedKeyword,
        });

        const scanNow = Date.now();
        for (const it of newItems) {
          const existing = collectedItemsMap.get(it.url);
          if (existing) {
            // Cập nhật caption nếu lần cào sau dài hơn / đầy đủ hơn (sau khi DOM mở rộng "Xem thêm")
            // Chỉ nhận bản dài hơn của CÙNG nội dung (đầu caption trùng khớp), tránh bị đè bằng text bình luận/bài khác
            const oldCap = (existing.caption || '').replace(/(?:…|\.{2,})\s*$/, '').trim();
            const isPlaceholder = !oldCap || oldCap === 'Bài viết không có tiêu đề';
            if (it.caption && it.caption.length > oldCap.length
              && (isPlaceholder || it.caption.startsWith(oldCap.slice(0, Math.min(oldCap.length, 60))))) {
              existing.caption = it.caption;
            }
            if (it.images && it.images.length > (existing.images || []).length) {
              existing.images = it.images;
              if (!existing.previewCover) existing.previewCover = it.previewCover;
            }
            if ((it.mediaCount || 0) > (existing.mediaCount || 0)) existing.mediaCount = it.mediaCount;
            if (it.mediaType === 'VIDEO' && existing.mediaType !== 'VIDEO') existing.mediaType = 'VIDEO';
            if (existing.postedAt === null && (it.postedTimeExact || it.postedUtime || it.postedTime)) {
              let postedAt = parseFbPostedTime(it.postedUtime, scanNow);
              if (postedAt === null && it.postedTimeExact) postedAt = parseFbPostedTime(it.postedTimeExact, scanNow);
              if (postedAt === null) postedAt = parseFbPostedTime(it.postedTime, scanNow);
              if (postedAt !== null) {
                existing.postedAt = postedAt;
                existing.publishedAt = existing.publishedAt || new Date(postedAt).toISOString();
              }
            }
            continue;
          }

          const { postedUtime, postedTimeLabel, postedTimeExact, ...rest } = it;
          let postedAt = parseFbPostedTime(postedUtime, scanNow);
          if (postedAt === null && postedTimeExact) postedAt = parseFbPostedTime(postedTimeExact, scanNow);
          if (postedAt === null) postedAt = parseFbPostedTime(it.postedTime, scanNow);
          if (postedAt === null && postedTimeLabel) postedAt = parseFbPostedTime(postedTimeLabel, scanNow);
          const publishedAt = it.publishedAt || (postedAt ? new Date(postedAt).toISOString() : undefined);
          const isAlreadyImported = isPostInExcludeList(it.url, it.caption, excludeUrlSet, excludeIdSet, cleanExcludeSnippets);
          collectedItemsMap.set(it.url, { ...rest, postedAt, publishedAt, isAlreadyImported });
          if (process.env.FEED_HUNTER_DEBUG) console.log('[FB_Group_Hunter][debug] +', it.url, isAlreadyImported ? 'ALREADY-POSTED' : 'NEW');
        }
      };

      // Mốc thời gian bị Facebook xáo chữ ở cả Fanpage lẫn Group → rê chuột để đọc tooltip ngày giờ.
      // Group chỉ cần khi lọc theo ngày (link bài Group vốn đọc được sẵn).
      if (isPage) await revealPagePermalinks(page, { type: 'PAGE', ...pageTarget }, collectNow);
      else if (dateMode) await revealPagePermalinks(page, { type: 'GROUP' }, collectNow);
      if (process.env.FEED_HUNTER_DEBUG) {
        const dbg = await page.evaluate(() => ({
          units: document.querySelectorAll('[role="main"] div[data-virtualized]').length,
          filled: Array.from(document.querySelectorAll('[role="main"] div[data-virtualized]')).filter((e) => (e.innerText || '').length > 20).length,
          tagged: document.querySelectorAll('[data-ztr-permalink]').length,
          scanned: document.querySelectorAll('[data-ztr-scanned]').length,
          y: Math.round(window.scrollY),
        })).catch(() => null);
        console.log('[FB_Group_Hunter][debug]', JSON.stringify(dbg));
      }

      // Mở rộng tất cả các nút "Xem thêm" trên các bài viết vừa tải để bóc tách 100% trọn vẹn Caption
      await expandAllSeeMore(page);

      await collectNow();

      console.log(`[FB_Group_Hunter] 🔁 Vòng cuộn ${round + 1}/${maxScrollRounds} — Đã tìm được ${countTowardsLimit()}/${maxItems} bài MỚI CHƯA ĐĂNG (Tổng đã quét: ${collectedItemsMap.size} bài)`);

      if (countTowardsLimit() >= maxItems) break;
      // Nếu đã quét được nhiều hơn 3.5 lần maxItems (hoặc tối thiểu 60 bài gần nhất)
      // thì dừng sớm để trả kết quả ngay, tránh cuộn vô tận vào các bài cũ tốn thời gian
      if (!dateMode && collectedItemsMap.size >= Math.max(maxItems * 3.5, 60)) {
        stopReason = 'ENOUGH_SCANNED';
        console.log(`[FB_Group_Hunter] ℹ️ Đã quét đủ ${collectedItemsMap.size} bài gần nhất của feed, dừng cuộn để trả kết quả nhanh.`);
        break;
      }
      if (dateMode && passedStartDate()) {
        stopReason = 'REACHED_START_DATE';
        console.log('[FB_Group_Hunter] 📅 Đã cuộn qua ngày bắt đầu, dừng quét.');
        break;
      }

      if (collectedItemsMap.size === prevSize) {
        stagnantCount++;
        const maxStagnant = isPage ? 6 : 7;
        if (stagnantCount >= maxStagnant) {
          stopReason = 'NO_MORE_POSTS';
          console.log(`[FB_Group_Hunter] ℹ️ Dừng cuộn sau ${stagnantCount} vòng không có bài viết mới để trả kết quả ngay.`);
          break;
        }
      } else {
        stagnantCount = 0;
      }

      if (isPage || dateMode) {
        // Fanpage ảo hoá bài đã cuộn qua → cuộn từng đoạn ngắn để kịp đọc từng bài trước khi bị làm rỗng
        await page.mouse.move(760, 520).catch(() => { });
        await page.mouse.wheel(0, 1400).catch(() => { });
        await page.evaluate(() => window.scrollBy(0, 400)).catch(() => { });
        await safeWait(stagnantCount > 0 ? 1500 : 700);
        continue;
      }

      // Cuộn nhịp nhàng theo bước để Facebook virtualized list mount đầy đủ từng bài, không bị nhảy cóc
      await page.mouse.move(640, 480).catch(() => { });
      await page.mouse.wheel(0, 1600).catch(() => { });
      await page.evaluate(() => window.scrollBy(0, 800)).catch(() => { });
      await page.keyboard.press('PageDown').catch(() => { });
      // Chờ Facebook query GraphQL batch tiếp theo
      await safeWait(stagnantCount > 0 ? 1800 : 900);
      } catch (roundErr) {
        // Trang crash / bị watchdog đóng giữa vòng → giữ các bài đã thu được thay vì báo lỗi toàn bộ.
        if (pageGone() || /crash|closed|Target page/i.test(roundErr?.message || '')) {
          stopReason = 'PAGE_CRASHED';
          console.warn(`[FB_Group_Hunter] ⚠️ Dừng quét ở vòng ${round + 1} (${roundErr?.message || 'trang đã đóng'}) — trả về ${collectedItemsMap.size} bài đã thu được.`);
          break;
        }
        throw roundErr;
      }
    }

    if (isPage && (!groupTitle || /^(?:Facebook|Facebook Group|Thông báo)$/i.test(groupTitle))) {
      // Tên Fanpage: thẻ og:title hoặc h1 đầu tiên trong vùng nội dung chính
      const pageName = await page.evaluate(() => {
        const og = document.querySelector('meta[property="og:title"]');
        if (og && og.content) return og.content.trim();
        const h1 = Array.from(document.querySelectorAll('div[role="main"] h1')).map((h) => (h.innerText || '').trim()).find((t) => t && !/^thông báo$/i.test(t));
        return h1 || '';
      }).catch(() => '');
      // Fanpage mới không còn h1/og:title → lấy tên tác giả xuất hiện nhiều nhất trong các bài đã quét
      const authorCount = new Map();
      for (const it of collectedItemsMap.values()) {
        if (it.author && it.author !== 'Thành viên nhóm') authorCount.set(it.author, (authorCount.get(it.author) || 0) + 1);
      }
      const topAuthor = Array.from(authorCount.entries()).sort((a, b) => b[1] - a[1])[0];
      groupTitle = pageName || (topAuthor ? topAuthor[0] : '') || 'Fanpage Facebook';
    }
    if (isPage) {
      for (const it of collectedItemsMap.values()) {
        if (it.author === 'Thành viên nhóm') it.author = groupTitle;
      }
    }

    await releaseContext();
    releaseContext = null;

    let items;
    let unknownDateCount = 0;
    if (dateMode) {
      // Bài trong khoảng ngày (mới nhất trước), sau đó là bài không đọc được ngày để người dùng tự xem
      const inRange = Array.from(collectedItemsMap.values())
        .filter((it) => it.postedAt !== null && it.postedAt >= fromTs && it.postedAt <= toTs)
        .sort((a, b) => b.postedAt - a.postedAt)
        .slice(0, maxItems);
      // Bài không đọc được ngày nằm sau bài cuối cùng trong khoảng (theo thứ tự feed, mới → cũ) thì đã cũ
      // hơn ngày bắt đầu khi quét dừng do cuộn qua ngày bắt đầu → bỏ, chỉ giữ bài không rõ ngày xen giữa
      const ordered = Array.from(collectedItemsMap.values());
      let lastInRangeIdx = -1;
      ordered.forEach((it, idx) => {
        if (it.postedAt !== null && it.postedAt >= fromTs && it.postedAt <= toTs) lastInRangeIdx = idx;
      });
      const unknown = ordered
        .filter((it, idx) => it.postedAt === null && (stopReason !== 'REACHED_START_DATE' || idx < lastInRangeIdx))
        .map((it) => ({ ...it, dateUnknown: true }));
      unknownDateCount = unknown.length;
      items = [...inRange, ...unknown];
    } else {
      const allList = Array.from(collectedItemsMap.values());
      let newUnposted = allList.filter((it) => !it.isAlreadyImported);
      let alreadyPosted = allList.filter((it) => it.isAlreadyImported);

      // Lọc và sắp xếp theo độ Viral & Từ khóa
      if (trimmedKeyword) {
        const kwLower = trimmedKeyword.toLowerCase();
        newUnposted.sort((a, b) => {
          const aMatch = (a.caption || '').toLowerCase().includes(kwLower);
          const bMatch = (b.caption || '').toLowerCase().includes(kwLower);
          if (aMatch && !bMatch) return -1;
          if (!aMatch && bMatch) return 1;
          return (b.viralScore || 0) - (a.viralScore || 0);
        });
        alreadyPosted.sort((a, b) => {
          const aMatch = (a.caption || '').toLowerCase().includes(kwLower);
          const bMatch = (b.caption || '').toLowerCase().includes(kwLower);
          if (aMatch && !bMatch) return -1;
          if (!aMatch && bMatch) return 1;
          return (b.viralScore || 0) - (a.viralScore || 0);
        });
      } else if (sortViral) {
        newUnposted.sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));
        alreadyPosted.sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));
      }

      if (Number(minReactions) > 0) {
        const minVal = Number(minReactions);
        newUnposted = newUnposted.filter(it => (it.reactions || 0) >= minVal || (it.viralScore || 0) >= minVal);
      }

      // Đảm bảo ưu tiên trả về đủ `maxItems` bài viết MỚI CHƯA TỪNG ĐĂNG
      // kèm theo các bài đã đăng ở sau để giao diện hiển thị badge "Đã có trong Lịch"
      items = [...newUnposted.slice(0, maxItems), ...alreadyPosted];
    }
    console.log(`[FB_Group_Hunter] ✅ Quét hoàn tất! Thu được ${items.length} bài viết từ "${groupTitle}" (Keyword: "${trimmedKeyword || 'N/A'}")${dateMode ? ` (${items.length - unknownDateCount} bài trong khoảng ngày, ${unknownDateCount} bài không rõ ngày)` : ''}`);

    return { status: 200, body: {
      success: true,
      groupName: groupTitle,
      groupUrl: normalizedGroupUrl,
      keyword: trimmedKeyword || undefined,
      sourceType: isPage ? 'PAGE' : 'GROUP',
      total: items.length,
      dateFiltered: dateMode,
      scannedCount: collectedItemsMap.size,
      unknownDateCount,
      stopReason,
      items,
    } };

  } catch (err) {
    console.error('[FB_Group_Hunter] ❌ Lỗi quét Group:', err.message);
    return { status: 500, body: { success: false, error: `Lỗi khi quét Facebook: ${err.message}` } };
  } finally {
    if (typeof huntWatchdog !== 'undefined') clearTimeout(huntWatchdog);
    await releaseContext?.();
  }
}

module.exports = { huntFacebookFeed };
