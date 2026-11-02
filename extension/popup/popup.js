// Popup Logic for ToolZutter Chrome Extension

let currentDetectedPost = null;
let batchScrapedUrls = [];

// Hiển thị Alert trong Popup
function showAlert(message, type = 'success', duration = 3000) {
  const alertEl = document.getElementById('popup-alert');
  alertEl.textContent = message;
  alertEl.className = `popup-alert show ${type}`;
  setTimeout(() => {
    alertEl.className = 'popup-alert';
  }, duration);
}

// Copy text vào Clipboard
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  }
}

// Quản lý chuyển Tab UI
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');
    });
  });
}

// Kiểm tra Health của Backend & Worker
async function checkHealth() {
  chrome.runtime.sendMessage({ action: 'CHECK_HEALTH' }, (res) => {
    if (!res) return;

    const bBadge = document.getElementById('backend-status');
    const wBadge = document.getElementById('worker-status');

    if (res.backendOk) {
      bBadge.textContent = 'Backend: Online';
      bBadge.className = 'badge badge-online';
    } else {
      bBadge.textContent = 'Backend: Offline';
      bBadge.className = 'badge badge-offline';
    }

    if (res.workerOk) {
      wBadge.textContent = 'Worker: Online';
      wBadge.className = 'badge badge-online';
    } else {
      wBadge.textContent = 'Worker: Offline';
      wBadge.className = 'badge badge-offline';
    }
  });
}

// Lấy thông tin bài viết từ Tab đang mở
async function loadCurrentTabPost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;

  const urlEl = document.getElementById('current-post-url');
  const titleEl = document.getElementById('current-post-title');

  const isFb = tab.url.includes('facebook.com') || tab.url.includes('fb.com');
  const isThreads = tab.url.includes('threads.net');

  if (!isFb && !isThreads) {
    titleEl.textContent = 'Trang không được hỗ trợ';
    urlEl.textContent = 'Vui lòng mở Facebook hoặc Threads để cào bài.';
    document.getElementById('btn-send-current').disabled = true;
    document.getElementById('btn-copy-current').disabled = true;
    return;
  }

  // Thử gửi message tới Content Script
  chrome.tabs.sendMessage(tab.id, { action: 'GET_PAGE_LINKS' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      currentDetectedPost = {
        url: tab.url,
        title: tab.title || 'Facebook'
      };
      if (tab.url.endsWith('facebook.com/') || tab.url === 'https://www.facebook.com') {
        titleEl.textContent = 'Trang chủ Facebook (F5 để nhận diện bài)';
        urlEl.textContent = 'Hãy F5 lại tab Facebook hoặc click vào 1 bài viết/Reel cụ thể.';
      } else {
        titleEl.textContent = tab.title || 'Bài viết';
        urlEl.textContent = tab.url;
      }
    } else {
      currentDetectedPost = res.current || { url: tab.url, title: tab.title };
      if (res.links && res.links.length > 0 && (!currentDetectedPost.url || currentDetectedPost.url.endsWith('facebook.com/') || currentDetectedPost.url === tab.url)) {
        currentDetectedPost.url = res.links[0];
      }
      titleEl.textContent = currentDetectedPost.title || 'Bài viết Facebook / Threads';
      urlEl.textContent = currentDetectedPost.url || tab.url;
    }

    if (currentDetectedPost.url && (currentDetectedPost.url === 'https://www.facebook.com/' || currentDetectedPost.url === 'https://www.facebook.com')) {
      document.getElementById('btn-send-current').disabled = true;
      document.getElementById('btn-send-current').title = 'Vui lòng mở 1 bài viết/Reel cụ thể hoặc dùng tab Quét Hàng Loạt';
    } else {
      document.getElementById('btn-send-current').disabled = false;
      document.getElementById('btn-send-current').title = '';
    }
    document.getElementById('btn-copy-current').disabled = false;
  });
}

// Cập nhật giao diện danh sách batch
function renderBatchList() {
  const listEl = document.getElementById('batch-list');
  const countEl = document.getElementById('batch-count');
  const sendBtn = document.getElementById('btn-send-batch');

  countEl.textContent = batchScrapedUrls.length;

  if (batchScrapedUrls.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Chưa quét bài nào. Nhấn nút quét ở trên để bắt đầu.</div>';
    sendBtn.disabled = true;
    return;
  }

  sendBtn.disabled = false;
  listEl.innerHTML = '';

  batchScrapedUrls.forEach((url, idx) => {
    const item = document.createElement('div');
    item.className = 'batch-item';
    item.innerHTML = `
      <input type="checkbox" class="chk-batch-item" data-url="${encodeURIComponent(url)}" checked>
      <span class="batch-item-url" title="${url}">${idx + 1}. ${url}</span>
    `;
    listEl.appendChild(item);
  });
}

// Cào bài viết trên tab hiện tại
async function scanPageLinks(isDeep = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  showAlert(isDeep ? '⏳ Đang cuộn trang và cào sâu...' : '⏳ Đang quét bài...', 'info');

  const action = isDeep ? 'SCROLL_AND_COLLECT' : 'GET_PAGE_LINKS';
  chrome.tabs.sendMessage(tab.id, { action, scrollCount: 4 }, (res) => {
    if (chrome.runtime.lastError || !res || !res.links || res.links.length === 0) {
      showAlert('⚠️ Hãy F5 lại trang Facebook một lần rồi bấm quét lại nhé!', 'error', 4500);
      return;
    }

    batchScrapedUrls = res.links;
    renderBatchList();
    showAlert(`🎉 Đã quét được ${res.links.length} bài viết / Reels!`, 'success');
  });
}

// Tải Cookie FB hiện tại
function loadFacebookCookies() {
  const statusEl = document.getElementById('cookie-auth-status');
  const uidEl = document.getElementById('cookie-uid');

  chrome.runtime.sendMessage({ action: 'GET_FB_COOKIE' }, (res) => {
    if (!res || !res.success) {
      statusEl.textContent = '❌ Chưa đăng nhập Facebook';
      statusEl.style.color = '#f87171';
      uidEl.textContent = '-';
      return;
    }

    if (res.hasAuth) {
      statusEl.textContent = `✅ Đã đăng nhập (${res.cookieCount} cookies)`;
      statusEl.style.color = '#34d399';
      uidEl.textContent = res.userId || 'Đã xác thực';
    } else {
      statusEl.textContent = '⚠️ Thiếu cookie xác thực (c_user/xs)';
      statusEl.style.color = '#f59e0b';
      uidEl.textContent = res.userId || '-';
    }
  });
}

// Khởi chạy khi popup mở
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  checkHealth();
  loadCurrentTabPost();
  loadFacebookCookies();

  // Load config vào settings
  chrome.runtime.sendMessage({ action: 'GET_CONFIG' }, (cfg) => {
    if (cfg) {
      const bUrl = (cfg.backendUrl && !cfg.backendUrl.includes(':8080')) ? cfg.backendUrl : 'http://localhost:8081';
      const wUrl = cfg.workerUrl || 'http://localhost:3001';
      document.getElementById('input-backend-url').value = bUrl;
      document.getElementById('input-worker-url').value = wUrl;
    }
  });

  // Sự kiện nút Gửi bài hiện tại
  document.getElementById('btn-send-current').addEventListener('click', async () => {
    if (!currentDetectedPost || !currentDetectedPost.url) return;

    const publishNow = document.getElementById('chk-publish-now').checked;
    const btn = document.getElementById('btn-send-current');
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> Đang gửi...';

    chrome.runtime.sendMessage({
      action: 'SEND_URLS_TO_QUEUE',
      urls: [currentDetectedPost.url],
      options: { publishNow }
    }, (res) => {
      btn.disabled = false;
      btn.innerHTML = '<span>🚀</span> Đẩy Vào Hàng Đợi Tool';

      if (res && res.success) {
        showAlert('🎉 Đã thêm bài viết vào Hàng Đợi ToolZutter!', 'success');
      } else {
        showAlert(`❌ Thất bại: ${res ? (res.message || 'Lỗi server') : 'Mất kết nối'}`, 'error');
      }
    });
  });

  // Nút Copy link sạch hiện tại
  document.getElementById('btn-copy-current').addEventListener('click', async () => {
    if (currentDetectedPost && currentDetectedPost.url) {
      await copyToClipboard(currentDetectedPost.url);
      showAlert('📋 Đã copy link vào clipboard!', 'success');
    }
  });

  // Nút Quét bài đang thấy
  document.getElementById('btn-scan-visible').addEventListener('click', () => scanPageLinks(false));

  // Nút Quét sâu
  document.getElementById('btn-scan-deep').addEventListener('click', () => scanPageLinks(true));

  // Nút Chọn tất cả trong batch
  document.getElementById('btn-select-all').addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('.chk-batch-item');
    const allChecked = Array.from(checkboxes).every(c => c.checked);
    checkboxes.forEach(c => c.checked = !allChecked);
  });

  // Nút Copy danh sách link batch
  document.getElementById('btn-copy-batch').addEventListener('click', async () => {
    const selected = Array.from(document.querySelectorAll('.chk-batch-item:checked'))
      .map(c => decodeURIComponent(c.dataset.url));
    if (selected.length === 0) {
      showAlert('⚠️ Chưa chọn bài nào để copy.', 'error');
      return;
    }
    await copyToClipboard(selected.join('\n'));
    showAlert(`📋 Đã copy ${selected.length} URLs!`, 'success');
  });

  // Nút Gửi hàng loạt bài đã chọn vào Hàng đợi
  document.getElementById('btn-send-batch').addEventListener('click', () => {
    const selected = Array.from(document.querySelectorAll('.chk-batch-item:checked'))
      .map(c => decodeURIComponent(c.dataset.url));
    if (selected.length === 0) {
      showAlert('⚠️ Chưa chọn bài nào để gửi.', 'error');
      return;
    }

    const btn = document.getElementById('btn-send-batch');
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> Đang gửi hàng loạt...';

    chrome.runtime.sendMessage({
      action: 'SEND_URLS_TO_QUEUE',
      urls: selected,
      options: {}
    }, (res) => {
      btn.disabled = false;
      btn.innerHTML = '<span>🚀</span> Đẩy Tất Cả Bài Đã Chọn Vào Hàng Đợi';

      if (res && res.success) {
        showAlert(`🎉 Đã thêm ${selected.length} bài vào Hàng Đợi thành công!`, 'success');
      } else {
        showAlert(`❌ Thất bại: ${res ? (res.message || 'Lỗi server') : 'Mất kết nối'}`, 'error');
      }
    });
  });

  // Nút Copy Cookie FB
  document.getElementById('btn-copy-cookie').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'GET_FB_COOKIE' }, async (res) => {
      if (res && res.cookieString) {
        await copyToClipboard(res.cookieString);
        showAlert('🔑 Đã copy chuỗi Cookie FB vào Clipboard!', 'success');
      } else {
        showAlert('❌ Không lấy được Cookie FB.', 'error');
      }
    });
  });

  // Nút Đồng bộ Cookie FB sang ToolZutter
  const btnSyncFb = document.getElementById('btn-sync-fb-cookie');
  if (btnSyncFb) {
    btnSyncFb.addEventListener('click', () => {
      btnSyncFb.disabled = true;
      btnSyncFb.innerHTML = '<span>⏳</span> Đang đồng bộ vào ToolZutter...';

      chrome.runtime.sendMessage({ action: 'SYNC_FB_COOKIE' }, (res) => {
        btnSyncFb.disabled = false;
        btnSyncFb.innerHTML = '<span>⚡</span> Đồng Bộ Nick Này Sang ToolZutter (1-Chạm)';

        if (res && res.success) {
          showAlert(`🎉 Đã đồng bộ nick Facebook (UID ${res.cUser || ''}) vào Tool thành công!`, 'success', 5000);
        } else {
          showAlert(`❌ Thất bại: ${res ? (res.message || 'Lỗi server') : 'Mất kết nối'}`, 'error', 5000);
        }
      });
    });
  }

  // Nút Làm mới Cookie
  document.getElementById('btn-refresh-cookie').addEventListener('click', () => {
    loadFacebookCookies();
    showAlert('🔄 Đã làm mới Cookie!', 'success');
  });

  // Nút Lưu cài đặt
  document.getElementById('btn-save-settings').addEventListener('click', () => {
    const backendUrl = document.getElementById('input-backend-url').value.trim();
    const workerUrl = document.getElementById('input-worker-url').value.trim();

    chrome.runtime.sendMessage({
      action: 'SAVE_CONFIG',
      config: { backendUrl, workerUrl }
    }, (res) => {
      if (res && res.success) {
        checkHealth();
        showAlert('💾 Đã lưu cấu hình kết nối!', 'success');
      }
    });
  });
});


// ─── Tab Threads: đồng bộ cookie ───
function formatAgo(ts) {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec} giây trước`;
  if (sec < 3600) return `${Math.round(sec / 60)} phút trước`;
  return `${Math.round(sec / 3600)} giờ trước`;
}

function loadThreadsStatus() {
  chrome.runtime.sendMessage({ action: 'GET_THREADS_STATUS' }, (res) => {
    const loginEl = document.getElementById('threads-login-status');
    const syncEl = document.getElementById('threads-last-sync');
    if (!res) return;
    loginEl.textContent = res.loggedIn ? `✅ Đã đăng nhập (ID ${res.dsUserId})` : '❌ Chưa đăng nhập threads.com';
    loginEl.style.color = res.loggedIn ? '#34d399' : '#f87171';
    document.getElementById('threads-autosync').checked = res.autoSync;
    if (res.lastSync) {
      const who = res.lastSync.username ? ` · @${res.lastSync.username}` : '';
      syncEl.textContent = `${res.lastSync.ok ? '✅' : '⚠️'} ${formatAgo(res.lastSync.at)}${who}`;
      syncEl.title = res.lastSync.message || '';
      syncEl.style.color = res.lastSync.ok ? '#34d399' : '#f59e0b';
    } else {
      syncEl.textContent = 'Chưa đồng bộ lần nào';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadThreadsStatus();
  document.getElementById('btn-threads-sync').addEventListener('click', () => {
    const btn = document.getElementById('btn-threads-sync');
    btn.disabled = true;
    chrome.runtime.sendMessage({ action: 'SYNC_THREADS_COOKIE' }, (res) => {
      btn.disabled = false;
      if (res && res.success) showAlert(`✅ Đã đồng bộ cookie${res.username ? ' cho @' + res.username : ''}`, 'success');
      else showAlert(`⚠️ ${res?.message || 'Đồng bộ thất bại'}`, 'error', 4000);
      loadThreadsStatus();
    });
  });
  document.getElementById('threads-autosync').addEventListener('change', (e) => {
    chrome.runtime.sendMessage({ action: 'SET_THREADS_AUTOSYNC', enabled: e.target.checked });
  });
});

// ─── Tab Cookie FB: trạng thái tự đồng bộ ───
function loadFbAutoSyncStatus() {
  chrome.runtime.sendMessage({ action: 'GET_FB_AUTOSYNC_STATUS' }, (res) => {
    const syncEl = document.getElementById('fb-last-sync');
    if (!res || !syncEl) return;
    document.getElementById('fb-autosync').checked = res.autoSync;
    if (res.lastSync) {
      syncEl.textContent = `${res.lastSync.ok ? 'OK' : 'Lỗi'} · ${formatAgo(res.lastSync.at)}`;
      syncEl.title = res.lastSync.message || '';
      syncEl.style.color = res.lastSync.ok ? '#34d399' : '#f59e0b';
    } else {
      syncEl.textContent = 'Chưa đồng bộ lần nào';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadFbAutoSyncStatus();
  const toggle = document.getElementById('fb-autosync');
  if (toggle) {
    toggle.addEventListener('change', (e) => {
      chrome.runtime.sendMessage({ action: 'SET_FB_AUTOSYNC', enabled: e.target.checked });
    });
  }
});
