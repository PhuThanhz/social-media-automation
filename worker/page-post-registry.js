const fs = require('fs');
const path = require('path');

const REGISTRY_FILE = path.join(__dirname, 'page_post_registry.json');

// Cấu trúc trong bộ nhớ: { [normalizedPostUrl]: { [pageId]: { pageName, reactionType, commentText, reactedAt, status } } }
let registryCache = null;

// Khoá chuẩn hoá duy nhất cho 1 bài viết: dùng chung cho registry, history queue và hunter.
// Giữ lại query định danh bài (story_fbid, fbid, v, id...) và chỉ bỏ tham số tracking.
function normalizeFbPostUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl.trim());
    if (/(^|\.)facebook\.com$/i.test(parsed.hostname) || /(^|\.)fb\.com$/i.test(parsed.hostname)) {
      parsed.hostname = 'www.facebook.com';
    }
    const trackingParams = [
      'fbclid', 'mibextid', 'rdid', 'ref', 'ref_src', 'ref_url', 'paipv', 'eav', 'sfnsn', 'locale',
      '__cft__', '__tn__', 'notif_t', 'notif_id', 'comment_id', 'reply_comment_id', 'extid', 'idorvanity',
    ];
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (trackingParams.some((p) => key === p || key.startsWith(p))) parsed.searchParams.delete(key);
    }
    let clean = parsed.origin + parsed.pathname.replace(/\/+$/, '');
    if (parsed.searchParams.toString()) {
      clean += '?' + parsed.searchParams.toString();
    }
    return clean;
  } catch (e) {
    return rawUrl.trim().replace(/[?&](?:mibextid|fbclid|rdid)=[^&]*/g, '').replace(/\/+$/, '');
  }
}

function writeRegistryFile() {
  if (!registryCache) return;
  const tmp = `${REGISTRY_FILE}.tmp`;
  // Ghi gọn (không thụt lề): với 1000+ page file lớn nhanh, thụt lề làm chậm gấp đôi
  fs.writeFileSync(tmp, JSON.stringify(registryCache), 'utf8');
  fs.renameSync(tmp, REGISTRY_FILE);
}

// Bỏ các bài đã quá REGISTRY_RETENTION_DAYS ngày kể từ lần tương tác cuối (bài cũ hầu như không buff lại)
const REGISTRY_RETENTION_DAYS = 45;
function pruneRegistry(registry) {
  const cutoff = Date.now() - REGISTRY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const [postUrl, pagesMap] of Object.entries(registry)) {
    let newest = 0;
    for (const entry of Object.values(pagesMap || {})) {
      const t = Date.parse(entry?.reactedAt || '') || 0;
      if (t > newest) newest = t;
    }
    if (newest && newest < cutoff) {
      delete registry[postUrl];
      removed++;
    }
  }
  if (removed > 0) console.log(`[PagePostRegistry] 🧹 Đã dọn ${removed} bài quá ${REGISTRY_RETENTION_DAYS} ngày khỏi sổ chống trùng.`);
  return removed;
}

function loadRegistry() {
  if (registryCache) return registryCache;
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      registryCache = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
      if (pruneRegistry(registryCache) > 0) scheduleSaveRegistry();
      return registryCache;
    }
  } catch (err) {
    console.warn(`[PagePostRegistry] ⚠️ Lỗi đọc page_post_registry.json: ${err.message}`);
  }
  registryCache = {};
  return registryCache;
}

let saveTimeout = null;
// Gom ghi: tối đa 1 lần mỗi 3 giây (nhiều via chạy song song ghi liên tục, không để mỗi like ghi lại cả file)
function scheduleSaveRegistry() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    try {
      writeRegistryFile();
    } catch (err) {
      console.error(`[PagePostRegistry] ❌ Lỗi lưu page_post_registry.json: ${err.message}`);
    }
  }, 3000);
}

function flushRegistry() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = null;
  try {
    writeRegistryFile();
  } catch (err) {
    console.error(`[PagePostRegistry] ❌ Lỗi flush page_post_registry.json: ${err.message}`);
  }
}

/**
 * Kiểm tra xem Page này đã từng Like/Comment trên bài viết này chưa
 */
function hasPageInteractedWithPost(normalizedPostUrl, pageId) {
  if (!normalizedPostUrl || !pageId) return false;
  const reg = loadRegistry();
  const postRecord = reg[normalizedPostUrl];
  if (!postRecord) return false;
  return Boolean(postRecord[String(pageId)]);
}

/**
 * Ghi nhận tương tác của Page lên bài viết
 */
function recordPagePostInteraction(normalizedPostUrl, pageId, details = {}) {
  if (!normalizedPostUrl || !pageId) return;
  const reg = loadRegistry();
  if (!reg[normalizedPostUrl]) {
    reg[normalizedPostUrl] = {};
  }
  reg[normalizedPostUrl][String(pageId)] = {
    pageName: details.pageName || '',
    reactionType: details.reactionType || 'LIKE',
    commentText: details.commentText || '',
    status: details.status || 'SUCCESS',
    reactedAt: new Date().toISOString(),
  };
  scheduleSaveRegistry();
}

/**
 * Lọc danh sách Fanpage: CHỈ GIỮ LẠI các page CHƯA TỪNG tương tác bài viết này.
 * Đảm bảo 100% không bao giờ bị click lần 2 làm HỦY LIKE (Unlike) hoặc spam trùng lặp!
 */
function filterAvailablePagesForPost(normalizedPostUrl, pages = []) {
  if (!normalizedPostUrl || !Array.isArray(pages)) return pages;
  const reg = loadRegistry();
  const postRecord = reg[normalizedPostUrl] || {};

  const available = [];
  let skippedCount = 0;

  for (const page of pages) {
    if (page && page.id && postRecord[String(page.id)]) {
      skippedCount++;
    } else {
      available.push(page);
    }
  }

  if (skippedCount > 0) {
    console.log(
      `[Anti-Overlap] 🛡️ Đã tự động loại bỏ ${skippedCount} Fanpage đã tương tác với bài "${normalizedPostUrl}" trước đó để TRÁNH HỦY LIKE (UN-LIKE). Còn lại ${available.length} Fanpage mới.`
    );
  }

  return available;
}

/**
 * Lấy danh sách ID các Page đã từng tương tác bài viết
 */
function getPostInteractedPageIds(normalizedPostUrl) {
  if (!normalizedPostUrl) return new Set();
  const reg = loadRegistry();
  const postRecord = reg[normalizedPostUrl] || {};
  return new Set(Object.keys(postRecord));
}

/**
 * Thống kê tổng quan registry
 */
function getGlobalRegistryStats() {
  const reg = loadRegistry();
  const posts = Object.keys(reg);
  let totalInteractions = 0;
  for (const p of posts) {
    totalInteractions += Object.keys(reg[p] || {}).length;
  }
  return {
    totalTrackedPosts: posts.length,
    totalProtectedInteractions: totalInteractions,
  };
}

/**
 * Xóa lịch sử tương tác của 1 bài viết (nếu admin muốn reset)
 */
function clearPostInteractions(normalizedPostUrl) {
  const reg = loadRegistry();
  if (reg[normalizedPostUrl]) {
    delete reg[normalizedPostUrl];
    flushRegistry();
    return true;
  }
  return false;
}

module.exports = {
  normalizeFbPostUrl,
  hasPageInteractedWithPost,
  recordPagePostInteraction,
  filterAvailablePagesForPost,
  getPostInteractedPageIds,
  getGlobalRegistryStats,
  clearPostInteractions,
  flushRegistry,
};
