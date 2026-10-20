// Service Worker for ToolZutter Chrome Extension

const DEFAULT_BACKEND_URL = 'http://localhost:8081';
const DEFAULT_WORKER_URL = 'http://localhost:3001';

// Lấy cài đặt cấu hình từ storage
async function getConfig() {
  const data = await chrome.storage.local.get(['backendUrl', 'workerUrl', 'authToken']);
  let bUrl = data.backendUrl;
  if (!bUrl || bUrl.includes(':8080')) {
    bUrl = DEFAULT_BACKEND_URL;
    chrome.storage.local.set({ backendUrl: DEFAULT_BACKEND_URL });
  }
  let wUrl = data.workerUrl;
  if (!wUrl) {
    wUrl = DEFAULT_WORKER_URL;
    chrome.storage.local.set({ workerUrl: DEFAULT_WORKER_URL });
  }
  return {
    backendUrl: bUrl,
    workerUrl: wUrl,
    authToken: data.authToken || ''
  };
}

// Lấy toàn bộ Cookie Facebook hiện tại
async function getFacebookCookies() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: '.facebook.com' });
    if (!cookies || cookies.length === 0) {
      return { success: false, message: 'Không tìm thấy cookie Facebook. Vui lòng đăng nhập Facebook trên trình duyệt.' };
    }

    const cookieMap = {};
    cookies.forEach(c => {
      cookieMap[c.name] = c.value;
    });

    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const userId = cookieMap['c_user'] || null;

    return {
      success: true,
      cookieString,
      userId,
      cookieCount: cookies.length,
      hasAuth: Boolean(cookieMap['c_user'] && cookieMap['xs'])
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// Gửi danh sách URL vào hàng đợi ToolZutter Backend
async function sendUrlsToBackend(urls, options = {}) {
  const config = await getConfig();
  const cookieData = await getFacebookCookies().catch(() => ({}));
  const payload = {
    urls: Array.isArray(urls) ? urls : [urls],
    publishNow: Boolean(options.publishNow),
    targetFanpageId: options.targetFanpageId || null,
    groupNames: options.groupNames || [],
    affiliateLink: options.affiliateLink || null,
    cookieString: cookieData.success ? cookieData.cookieString : null
  };

  const headers = { 'Content-Type': 'application/json' };
  if (config.authToken) {
    headers['Authorization'] = `Bearer ${config.authToken}`;
  }

  // 1. Thử gửi qua Worker Proxy (Port 3001) trước để tránh mọi rào cản CORS trên trình duyệt
  try {
    const workerRes = await fetch(`${config.workerUrl}/api/enqueue-urls`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (workerRes.ok) {
      const data = await workerRes.json();
      return { success: true, data, status: workerRes.status };
    }
  } catch (_) {
    // Nếu worker bận, thử fallback gọi trực tiếp Backend
  }

  // 2. Fallback gọi trực tiếp Backend
  try {
    const res = await fetch(`${config.backendUrl}/api/queue/add-from-urls`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    
    let data = null;
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { message: text };
    }

    if (res.ok) {
      return { success: true, data, status: res.status };
    } else {
      return { success: false, message: (data && data.message) ? data.message : `Lỗi HTTP ${res.status}`, status: res.status };
    }
  } catch (err) {
    return { success: false, message: `Không thể kết nối đến Backend: ${err.message}` };
  }
}

// Kiểm tra tình trạng kết nối Backend & Worker
async function checkHealth() {
  const config = await getConfig();
  let backendOk = false;
  let workerOk = false;

  try {
    const bRes = await fetch(`${config.backendUrl}/api/auth/me`, { method: 'GET' }).catch(() => null);
    // Nếu trả về 401 hoặc 200 hoặc 403 tức là backend đang chạy
    if (bRes && (bRes.status === 200 || bRes.status === 401 || bRes.status === 403)) {
      backendOk = true;
    }
  } catch (_) {}

  try {
    const wRes = await fetch(`${config.workerUrl}/api/health`, { method: 'GET' }).catch(() => null);
    if (wRes && wRes.ok) {
      const data = await wRes.json();
      if (data && data.status === 'ok') workerOk = true;
    }
  } catch (_) {}

  return { backendOk, workerOk, config };
}

// Chuyển danh tính Facebook sang một Page do tài khoản hiện tại quản lý, sau đó mở
// bài viết trong tab mới. Không tìm hoặc bấm nút Like/Cảm xúc.
async function openPageEngagement(payload = {}) {
  const pageId = String(payload.pageId || '').trim();
  const targetUrl = String(payload.targetUrl || '').trim();

  if (!/^\d{5,30}$/.test(pageId)) {
    return { success: false, message: 'ID Page không hợp lệ.' };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (_) {
    return { success: false, message: 'Link bài viết không hợp lệ.' };
  }

  const isFacebook = parsedUrl.protocol === 'https:' && (
    parsedUrl.hostname === 'facebook.com' ||
    parsedUrl.hostname.endsWith('.facebook.com') ||
    parsedUrl.hostname === 'fb.com' ||
    parsedUrl.hostname.endsWith('.fb.com')
  );
  if (!isFacebook) {
    return { success: false, message: 'Chỉ hỗ trợ link Facebook HTTPS.' };
  }

  const cookieData = await getFacebookCookies();
  if (!cookieData.success || !cookieData.hasAuth) {
    return { success: false, message: 'Hãy đăng nhập Facebook trong Chrome trước.' };
  }

  try {
    await chrome.cookies.set({
      url: 'https://www.facebook.com/',
      name: 'i_user',
      value: pageId,
      domain: '.facebook.com',
      path: '/',
      secure: true,
      sameSite: 'lax',
    });
    const tab = await chrome.tabs.create({ url: parsedUrl.href, active: true });
    return { success: true, tabId: tab.id, pageId };
  } catch (err) {
    return { success: false, message: `Không thể mở bài bằng Page: ${err.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Đồng bộ cookie Threads: tab threads.com người dùng để sẵn luôn đăng nhập → gửi cookie mới nhất vào
// ToolZutter mỗi khi Threads xoay vòng cookie (chrome.cookies.onChanged) + định kỳ 30 phút, để nick trong
// hệ thống không bị "hết hạn cookie".
// ─────────────────────────────────────────────────────────────────────────────
const THREADS_SYNC_ALARM = 'threads-cookie-sync';

async function getThreadsCookies() {
  const all = [
    ...(await chrome.cookies.getAll({ domain: 'threads.com' }).catch(() => [])),
    ...(await chrome.cookies.getAll({ domain: 'threads.net' }).catch(() => [])),
  ];
  const byName = new Map();
  for (const c of all) {
    if (!byName.has(c.name) || c.domain.includes('threads.com')) byName.set(c.name, c.value);
  }
  const sessionid = byName.get('sessionid');
  const dsUserId = byName.get('ds_user_id');
  return {
    loggedIn: Boolean(sessionid && dsUserId),
    dsUserId: dsUserId || null,
    cookieString: [...byName.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
  };
}

async function syncThreadsCookie({ force = false } = {}) {
  const { threadsAutoSync = true, threadsLastHash = '' } = await chrome.storage.local.get(['threadsAutoSync', 'threadsLastHash']);
  if (!threadsAutoSync && !force) return { success: false, skipped: true, message: 'Tự động đồng bộ đang tắt' };

  const data = await getThreadsCookies();
  if (!data.loggedIn) {
    await chrome.storage.local.set({ threadsLastSync: { at: Date.now(), ok: false, message: 'Chrome chưa đăng nhập Threads' } });
    return { success: false, message: 'Chrome chưa đăng nhập Threads' };
  }
  // Chỉ gửi khi cookie thực sự đổi (trừ khi bấm "Đồng bộ ngay").
  const hash = `${data.dsUserId}|${data.cookieString.length}|${data.cookieString.slice(-40)}`;
  if (!force && hash === threadsLastHash) return { success: true, skipped: true, message: 'Cookie chưa đổi' };

  const config = await getConfig();
  try {
    const res = await fetch(`${config.backendUrl}/api/threads/accounts/sync-cookie`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}),
      },
      body: JSON.stringify({ cookieString: data.cookieString }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) throw new Error(json.message || `HTTP ${res.status}`);
    const username = json.account?.username || null;
    await chrome.storage.local.set({
      threadsLastHash: hash,
      threadsLastSync: { at: Date.now(), ok: true, username, message: json.changed === false ? 'Cookie đã khớp' : 'Đã gửi cookie mới' },
    });
    return { success: true, username, changed: json.changed !== false };
  } catch (err) {
    await chrome.storage.local.set({ threadsLastSync: { at: Date.now(), ok: false, message: err.message } });
    return { success: false, message: `Không gửi được cookie: ${err.message}` };
  }
}

let threadsSyncTimer = null;
chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
  if (removed || !/threads\.(com|net)$/.test(cookie.domain.replace(/^\./, ''))) return;
  if (!['sessionid', 'csrftoken', 'rur', 'ds_user_id'].includes(cookie.name)) return;
  clearTimeout(threadsSyncTimer);
  threadsSyncTimer = setTimeout(() => syncThreadsCookie().catch(() => {}), 5000);
});

chrome.alarms.create(THREADS_SYNC_ALARM, { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === THREADS_SYNC_ALARM) syncThreadsCookie().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => { syncThreadsCookie().catch(() => {}); });

// Đồng bộ Cookie Facebook của profile Chrome hiện tại vào ToolZutter
async function syncFacebookCookie() {
  const cookieData = await getFacebookCookies();
  if (!cookieData.success || !cookieData.hasAuth) {
    return { success: false, message: 'Chrome profile này chưa đăng nhập Facebook (thiếu c_user/xs).' };
  }

  const config = await getConfig();
  const headers = { 'Content-Type': 'application/json' };
  if (config.authToken) {
    headers['Authorization'] = `Bearer ${config.authToken}`;
  }

  const bodyData = JSON.stringify({
    cookieString: cookieData.cookieString,
    cUser: cookieData.userId
  });

  // 1. Thử gửi trực tiếp qua Backend endpoint /api/connections/sync-fb-cookie
  try {
    const res = await fetch(`${config.backendUrl}/api/connections/sync-fb-cookie`, {
      method: 'POST',
      headers,
      body: bodyData,
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.success) {
      return { success: true, cUser: cookieData.userId, ...json };
    }
  } catch (_) {}

  // 2. Fallback qua Worker Proxy
  try {
    const wRes = await fetch(`${config.workerUrl}/api/fb-login/sync-cookie`, {
      method: 'POST',
      headers,
      body: bodyData,
    });
    const wJson = await wRes.json().catch(() => ({}));
    if (wRes.ok && wJson.success) {
      return { success: true, cUser: cookieData.userId, ...wJson };
    }
  } catch (_) {}

  // 3. Fallback trực tiếp qua endpoint /api/connections chuẩn
  try {
    const fallbackRes = await fetch(`${config.backendUrl}/api/connections`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        platform: 'FACEBOOK_PROFILE',
        platformAccountId: cookieData.userId,
        pageName: `Via Facebook #${cookieData.userId}`,
        accountType: 'PERSONAL_PROFILE_COOKIE',
        accessToken: cookieData.cookieString,
        tokenStatus: 'OK'
      }),
    });
    const saved = await fallbackRes.json().catch(() => ({}));
    if (fallbackRes.ok && saved && saved.id) {
      fetch(`${config.backendUrl}/api/connections/${saved.id}/scan-managed-pages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ verifyEachPage: true })
      }).catch(() => {});
      return { success: true, cUser: cookieData.userId, created: true, account: saved };
    }
    return { success: false, message: (saved && saved.message) ? saved.message : 'Không lưu được kết nối' };
  } catch (err) {
    return { success: false, message: `Không thể kết nối đến ToolZutter: ${err.message}` };
  }
}

// Lắng nghe messages từ Popup hoặc Content Script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_FB_COOKIE') {
    getFacebookCookies().then(sendResponse);
    return true; // Keep message channel open for async response
  }

  if (request.action === 'SYNC_FB_COOKIE') {
    syncFacebookCookie().then(sendResponse);
    return true;
  }

  if (request.action === 'GET_THREADS_STATUS') {
    Promise.all([getThreadsCookies(), chrome.storage.local.get(['threadsAutoSync', 'threadsLastSync'])])
      .then(([c, st]) => sendResponse({ loggedIn: c.loggedIn, dsUserId: c.dsUserId, autoSync: st.threadsAutoSync !== false, lastSync: st.threadsLastSync || null }));
    return true;
  }

  if (request.action === 'SYNC_THREADS_COOKIE') {
    syncThreadsCookie({ force: true }).then(sendResponse);
    return true;
  }

  if (request.action === 'SET_THREADS_AUTOSYNC') {
    chrome.storage.local.set({ threadsAutoSync: Boolean(request.enabled) }).then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.action === 'SEND_URLS_TO_QUEUE') {
    sendUrlsToBackend(request.urls, request.options).then(sendResponse);
    return true;
  }

  if (request.action === 'CHECK_HEALTH') {
    checkHealth().then(sendResponse);
    return true;
  }

  if (request.action === 'SAVE_CONFIG') {
    chrome.storage.local.set(request.config).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'PING_ASSISTED_ENGAGEMENT') {
    sendResponse({ success: true });
    return false;
  }

  if (request.action === 'OPEN_PAGE_ENGAGEMENT') {
    openPageEngagement(request.payload).then(sendResponse);
    return true;
  }
});

// Tự động nạp Content Script vào tất cả các tab Facebook/Threads đang mở khi cài đặt / nạp lại extension
chrome.runtime.onInstalled.addListener(async () => {
  syncThreadsCookie({ force: true }).catch(() => {});
  try {
    const tabs = await chrome.tabs.query({ url: ['*://*.facebook.com/*', '*://*.threads.net/*', '*://*.threads.com/*'] });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/content-script.js']
        }).catch(() => {});
        chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content/content-style.css']
        }).catch(() => {});
      }
    }
  } catch (_) {}
});
