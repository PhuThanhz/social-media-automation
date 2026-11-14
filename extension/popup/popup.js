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

// Gửi message tới tab, nếu tab chưa có Content Script thì tự động inject ngay lập tức
async function sendMessageWithAutoInject(tab, message) {
  return new Promise((resolve) => {
    let responded = false;
    const timer = setTimeout(() => {
      if (!responded) {
        responded = true;
        resolve(null);
      }
    }, 2500);

    chrome.tabs.sendMessage(tab.id, message, async (res) => {
      if (responded) return;
      if (!chrome.runtime.lastError && res) {
        responded = true;
        clearTimeout(timer);
        return resolve(res);
      }

      // Thử tự động inject content script nếu tab mở trước khi cài/cập nhật extension
      try {
        if (chrome.scripting) {
          try {
            await chrome.scripting.insertCSS({
              target: { tabId: tab.id },
              files: ['content/content-style.css']
            });
          } catch (_) {}
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/content-script.js']
          });
        }
        setTimeout(() => {
          if (responded) return;
          chrome.tabs.sendMessage(tab.id, message, (retryRes) => {
            if (responded) return;
            responded = true;
            clearTimeout(timer);
            resolve(retryRes || null);
          });
        }, 300);
      } catch (err) {
        if (!responded) {
          responded = true;
          clearTimeout(timer);
          resolve(null);
        }
      }
    });
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

  titleEl.textContent = 'Đang nhận diện bài viết...';
  urlEl.textContent = 'Đang tìm link sạch trên trang...';

  const res = await sendMessageWithAutoInject(tab, { action: 'GET_PAGE_LINKS' });

  if (!res) {
    currentDetectedPost = {
      url: tab.url,
      title: tab.title || 'Facebook'
    };
    if (tab.url.endsWith('facebook.com/') || tab.url === 'https://www.facebook.com') {
      titleEl.textContent = 'Bảng tin Facebook (Cuộn xem bài viết)';
      urlEl.textContent = 'Bấm "Quét Bài Đang Thấy" hoặc cuộn tới bài viết cụ thể.';
    } else {
      titleEl.textContent = tab.title || 'Bài viết';
      urlEl.textContent = tab.url;
    }
  } else {
    currentDetectedPost = res.current || { url: tab.url, title: tab.title };
    const validLinks = (res.links || []).filter(l => !l.includes('/reel/?s=') && !l.endsWith('/reel/') && !l.endsWith('/watch') && !l.endsWith('facebook.com/') && l !== 'https://www.facebook.com');

    if (validLinks.length > 0) {
      if (!currentDetectedPost.url || currentDetectedPost.url.includes('/reel/?s=') || currentDetectedPost.url.endsWith('facebook.com/') || currentDetectedPost.url === tab.url) {
        currentDetectedPost.url = validLinks[0];
      }
      titleEl.textContent = currentDetectedPost.title || 'Bài viết trên màn hình';
      urlEl.textContent = currentDetectedPost.url;
    } else {
      titleEl.textContent = currentDetectedPost.title || 'Bài viết Facebook';
      urlEl.textContent = currentDetectedPost.url || tab.url;
    }
  }

  const isHomeOrEmpty = !currentDetectedPost.url || currentDetectedPost.url.endsWith('facebook.com/') || currentDetectedPost.url === 'https://www.facebook.com';
  if (isHomeOrEmpty) {
    document.getElementById('btn-send-current').disabled = true;
    document.getElementById('btn-send-current').title = 'Vui lòng cuộn đến 1 bài viết cụ thể hoặc bấm tab Quét Hàng Loạt';
  } else {
    document.getElementById('btn-send-current').disabled = false;
    document.getElementById('btn-send-current').title = '';
  }
  document.getElementById('btn-copy-current').disabled = false;
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
    item.style.display = 'flex';
    item.style.alignItems = 'center';
    item.style.justifyContent = 'space-between';
    item.style.gap = '8px';
    item.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
        <input type="checkbox" class="chk-batch-item" data-url="${encodeURIComponent(url)}" checked>
        <span class="batch-item-url" title="${url}" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px;">${idx + 1}. ${url}</span>
      </div>
      <button class="btn-copy-single" data-url="${encodeURIComponent(url)}" title="Copy link này" style="padding: 3px 8px; font-size: 11px; border-radius: 6px; border: 1px solid #3b82f6; background: #1e3a8a; color: #fff; cursor: pointer; flex-shrink: 0;">📋 Copy</button>
    `;
    listEl.appendChild(item);
  });

  listEl.querySelectorAll('.btn-copy-single').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const u = decodeURIComponent(btn.dataset.url);
      await copyToClipboard(u);
      showAlert(`📋 Đã copy link vào clipboard!`, 'success', 2500);
    });
  });
}

// Cào bài viết trên tab hiện tại
async function scanPageLinks(isDeep = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  showAlert(isDeep ? '⏳ Đang cuộn trang và cào sâu...' : '⏳ Đang quét bài...', 'info');

  const action = isDeep ? 'SCROLL_AND_COLLECT' : 'GET_PAGE_LINKS';
  const res = await sendMessageWithAutoInject(tab, { action, scrollCount: 4 });
  if (!res || !res.links || res.links.length === 0) {
    showAlert('⚠️ Không tìm thấy bài viết nào trên màn hình. Hãy cuộn xem bài rồi quét lại nhé!', 'error', 4500);
    return;
  }

  batchScrapedUrls = res.links.filter(l => !l.includes('/reel/?s=') && !l.endsWith('/reel/') && !l.endsWith('/watch') && !l.endsWith('facebook.com/') && l !== 'https://www.facebook.com');
  renderBatchList();
  showAlert(`🎉 Đã quét được ${batchScrapedUrls.length} bài viết / Reels!`, 'success');
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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Tải danh sách các bài viết đã thu thập (copy / đẩy từ Newfeed)
async function loadCollectedLinks() {
  chrome.runtime.sendMessage({ action: 'GET_COLLECTED_LINKS' }, (res) => {
    const list = res && Array.isArray(res.list) ? res.list : [];
    const countEl = document.getElementById('collected-count');
    const sendNumEl = document.getElementById('collected-send-num');
    const container = document.getElementById('collected-list');
    const sendBtn = document.getElementById('btn-send-all-collected');

    if (countEl) countEl.textContent = list.length;
    if (sendNumEl) sendNumEl.textContent = list.length;

    if (list.length === 0) {
      if (container) {
        container.innerHTML = `
          <div class="empty-state" style="padding: 10px; font-size: 11px; text-align: center; color: #94a3b8;">
            Chưa copy bài nào. Hãy bấm [Copy Link] hoặc [Đẩy sang Tool] trên Newfeed để gom bài!
          </div>
        `;
      }
      if (sendBtn) sendBtn.style.display = 'none';
      return;
    }

    if (sendBtn) sendBtn.style.display = 'block';

    if (container) {
      container.innerHTML = list.map((item, idx) => `
        <div class="batch-item" style="padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <div style="min-width: 0; flex: 1;">
            <div style="font-size: 11px; font-weight: 600; color: #f1f5f9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${idx + 1}. ${escapeHtml(item.title || 'Bài viết Facebook')}
            </div>
            <div style="font-size: 10px; color: #60a5fa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${escapeHtml(item.url)}
            </div>
          </div>
          <button class="btn-text btn-copy-one-collected" data-url="${escapeHtml(item.url)}" style="font-size: 11px; padding: 2px 6px; flex-shrink: 0;" title="Copy riêng link này">
            📋
          </button>
        </div>
      `).join('');

      container.querySelectorAll('.btn-copy-one-collected').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const u = btn.getAttribute('data-url');
          if (u) {
            await copyToClipboard(u);
            showAlert('📋 Đã copy link bài viết!', 'success');
          }
        });
      });
    }
  });
}

// Khởi chạy khi popup mở
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  checkHealth();
  loadCurrentTabPost();
  loadFacebookCookies();
  loadCollectedLinks();

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
    let url = currentDetectedPost && currentDetectedPost.url;
    const isInvalid = !url || url.endsWith('facebook.com/') || url === 'https://www.facebook.com';

    if (isInvalid) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const res = await sendMessageWithAutoInject(tab, { action: 'GET_PAGE_LINKS' });
        const validLinks = (res?.links || []).filter(l => !l.includes('/reel/?s=') && !l.endsWith('/reel/') && !l.endsWith('/watch') && !l.endsWith('facebook.com/') && l !== 'https://www.facebook.com');
        if (validLinks.length > 0) {
          url = validLinks[0];
          currentDetectedPost = { url, title: 'Bài viết đang thấy' };
          document.getElementById('current-post-url').textContent = url;
        }
      }
    }

    if (url && !url.endsWith('facebook.com/') && url !== 'https://www.facebook.com') {
      await copyToClipboard(url);
      showAlert(`📋 Đã copy link vào clipboard!`, 'success');
    } else {
      showAlert('⚠️ Chưa nhận diện được bài viết cụ thể. Hãy bấm tab "Quét Hàng Loạt" để lấy toàn bộ bài nhé!', 'error', 3500);
    }
  });

  // ── Sự kiện cho danh sách Đã Thu Thập (Collected Links) ──
  document.getElementById('btn-copy-all-collected')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'GET_COLLECTED_LINKS' }, async (res) => {
      const list = res?.list || [];
      if (list.length === 0) return showAlert('⚠️ Chưa có link nào để copy', 'error');
      const allUrls = list.map(item => item.url).join('\n');
      await copyToClipboard(allUrls);
      showAlert(`📋 Đã copy toàn bộ ${list.length} link vào clipboard!`, 'success');
    });
  });

  document.getElementById('btn-clear-collected')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'CLEAR_COLLECTED_LINKS' }, () => {
      loadCollectedLinks();
      showAlert('🗑️ Đã xoá sạch danh sách thu thập', 'success');
    });
  });

  document.getElementById('btn-send-all-collected')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'GET_COLLECTED_LINKS' }, (res) => {
      const list = res?.list || [];
      if (list.length === 0) return;
      const urls = list.map(item => item.url);
      const btn = document.getElementById('btn-send-all-collected');
      btn.disabled = true;
      btn.innerHTML = '<span>⏳</span> Đang gửi cả danh sách sang Tool...';
      const publishNow = document.getElementById('chk-publish-now')?.checked || false;

      chrome.runtime.sendMessage({
        action: 'SEND_URLS_TO_QUEUE',
        urls,
        options: { publishNow }
      }, (resp) => {
        btn.disabled = false;
        btn.innerHTML = `<span>🚀</span> Đẩy Toàn Bộ (${list.length}) Bài Vào Hàng Đợi Tool`;
        if (resp && resp.success) {
          showAlert(`🎉 Đã thêm thành công ${urls.length} bài vào Hàng Đợi ToolZutter!`, 'success');
        } else {
          showAlert(`❌ Lỗi gửi: ${resp?.message || 'Lỗi server'}`, 'error');
        }
      });
    });
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
