// Content Script for ToolZutter - Facebook & Threads 1-Click Scraper & Quick Link Grabber

(function () {
  console.log('🚀 ToolZutter Helper Content Script loaded.');

  // Tạo Toast thông báo trên giao diện
  function showToast(message, type = 'success', actionLink = null) {
    let toast = document.getElementById('toolzutter-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toolzutter-toast';
      document.body.appendChild(toast);
    }
    const icon = type === 'success' ? '📋' : (type === 'info' ? '⏳' : '⚠️');
    toast.className = `toolzutter-toast show ${type}`;
    let html = `
      <div class="tz-toast-icon">${icon}</div>
      <div class="tz-toast-text" style="flex: 1;">${message}</div>
    `;
    if (actionLink) {
      html += `<a href="${actionLink}" target="_blank" class="tz-toast-link" style="margin-left: 8px; color: #38bdf8; font-weight: 700; text-decoration: underline; white-space: nowrap; font-size: 12px; cursor: pointer;">Xem bên Tool ↗</a>`;
    }
    toast.innerHTML = html;
    setTimeout(() => {
      toast.className = 'toolzutter-toast';
    }, 4500);
  }

  // Lấy tóm tắt tiêu đề ngắn của bài viết Facebook
  function getCardSnippet(card) {
    if (!card) return 'Bài viết Facebook';
    const textEl = card.querySelector('div[data-ad-preview="message"], div[data-ad-comet-preview="message"], [dir="auto"]');
    if (textEl && textEl.innerText) {
      const txt = textEl.innerText.trim();
      if (txt) return txt.length > 60 ? txt.substring(0, 60) + '...' : txt;
    }
    return 'Bài viết Facebook';
  }

  // Card bao quanh 1 bài viết — dùng chung cho mọi nơi cần tìm "khung bài viết"
  const FEED_CARD_SELECTOR = [
    'div[data-pagelet*="FeedUnit"]',
    'div[role="article"]',
    'div[role="feed"] > div',
    'div[data-pagelet*="Tahoe"]',
    'div[role="dialog"]',
    'div[aria-posinset]',
    'div[data-virtualized="true"]'
  ].join(', ');

  // Chuẩn hoá URL Facebook / Threads — loại bỏ toàn bộ mã theo dõi rác
  function cleanUrl(rawUrl) {
    try {
      if (!rawUrl) return null;
      let url = new URL(rawUrl, window.location.origin);
      
      const trackingParams = [
        'fbclid', '__cft__', '__cft__[0]', '__tn__', 'mibextid', 'rdid', 
        'notif_id', 'notif_t', 'ref', 'source', 'epa', 'sfnsn', 'locale',
        'substory_index', 'hc_location', 'idorvanity'
      ];
      trackingParams.forEach(p => url.searchParams.delete(p));

      let href = url.toString();
      if (href.includes('facebook.com/share/r/') || href.includes('facebook.com/share/p/') || href.includes('facebook.com/share/v/')) {
        return href.split('?')[0];
      }
      return href;
    } catch (e) {
      return rawUrl;
    }
  }

  // Kiểm tra xem href có phải là link bài viết / media thật sự (Loại bỏ triệt để link menu điều hướng)
  function isPostOrMediaHref(href) {
    if (!href || typeof href !== 'string') return false;
    if (href.startsWith('#') || href.startsWith('javascript:')) return false;
    
    // Bỏ qua các liên kết menu / điều hướng Facebook
    if (
      href.includes('/reel/?s=') ||
      href.endsWith('/reel/') ||
      href.endsWith('/reel') ||
      href.endsWith('/watch') ||
      href.endsWith('/watch/') ||
      href.endsWith('/videos') ||
      href.endsWith('/videos/') ||
      href.includes('/notifications') ||
      href.includes('/messages') ||
      href.includes('/settings') ||
      href.includes('/marketplace') ||
      href.includes('/gaming') ||
      href.includes('/friends') ||
      href.includes('/bookmarks') ||
      href.includes('/saved') ||
      href.includes('/events') ||
      href.includes('/memories') ||
      href.includes('/ads') ||
      href.includes('/login') ||
      href.includes('/help') ||
      href.includes('/recover') ||
      href.includes('/hashtag/') ||
      href.includes('/stories/')
    ) {
      return false;
    }

    return (
      href.includes('/posts/') ||
      href.includes('/permalink/') ||
      href.includes('/permalink.php') ||
      href.includes('/story.php') ||
      href.includes('story_fbid=') ||
      (href.includes('/videos/') && /\/videos\/\d+/i.test(href)) ||
      (href.includes('/reel/') && /\/reel\/\d+/i.test(href)) ||
      (href.includes('/watch') && /[?&]v=\d+/i.test(href)) ||
      href.includes('/share/r/') ||
      href.includes('/share/p/') ||
      href.includes('/share/v/') ||
      href.includes('/photo/') ||
      href.includes('/photos/') ||
      href.includes('/photo.php') ||
      (href.includes('threads.net') && href.includes('/post/')) ||
      (window.location.hostname.includes('threads.net') && href.includes('/post/'))
    );
  }

  // Trích xuất link bài viết chuẩn xác nhất từ 1 thẻ Card Facebook
  function extractCleanPostUrl(card) {
    if (!card) return null;

    // 1. Ưu tiên cao nhất: Thẻ <a> chứa mốc thời gian (timestamp)
    // VD: "14 giờ", "10 phút", "14h", "Vừa xong", "Hôm qua", "23 Tháng 10..."
    const timeRegex = /(?:\d{1,2}\s*(?:phút|giờ|ngày|tháng|thg|năm|mins?|hrs?|h|d|w|m|y)|vừa xong|vừa đăng|hôm qua|hôm nay|thứ\s+[a-zA-Z0-9_À-ỹ]+|\d{1,2}\s+(?:tháng|thg)\s+\d{1,2})/i;
    const anchors = Array.from(card.querySelectorAll('a[href]'));
    
    for (const a of anchors) {
      const text = (a.innerText || a.textContent || '').trim();
      const aria = (a.getAttribute('aria-label') || '').trim();
      const href = a.getAttribute('href');
      if (!href || href.includes('comment_id=') || href.includes('reply_comment_id=')) continue;
      
      if (timeRegex.test(text) || timeRegex.test(aria)) {
        if (!href.includes('/user/') && !href.includes('/profile.php') && !href.includes('/people/')) {
          try {
            return cleanUrl(new URL(href, window.location.origin).toString());
          } catch (_) {}
        }
      }
    }

    // 2. Tìm link bài viết trực tiếp (/posts/, /permalink/, /share/, /reel/, /videos/)
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href || href.includes('comment_id=') || href.includes('reply_comment_id=')) continue;
      if (isPostOrMediaHref(href)) {
        try {
          return cleanUrl(new URL(href, window.location.origin).toString());
        } catch (_) {}
      }
    }

    // 3. Fallback: Nếu có link media (video/photo)
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href || href.includes('comment_id=') || href.includes('reply_comment_id=')) continue;
      if (href.includes('/watch') || href.includes('/photo') || href.includes('story_fbid')) {
        try {
          return cleanUrl(new URL(href, window.location.origin).toString());
        } catch (_) {}
      }
    }

    return null;
  }

  // Gửi bài viết trực tiếp vào ToolZutter
  function quickSendPost(postUrl, customOptions = {}) {
    showToast('⏳ Đang gửi bài vào ToolZutter...', 'info');
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({
          action: 'SEND_URLS_TO_QUEUE',
          urls: [postUrl],
          options: customOptions
        }, (response) => {
          if (response && response.success) {
            const savedId = response.data && response.data.items && response.data.items[0] ? response.data.items[0].id : null;
            showToast(
              savedId ? `✅ Đã lưu bài #${savedId} vào hàng đợi ToolZutter!` : '✅ Đã lưu bài viết vào hàng đợi ToolZutter!',
              'success',
              'http://localhost:3000'
            );
          } else {
            showToast(`❌ Thất bại: ${response ? (response.message || 'Lỗi server') : 'Không có phản hồi'}`, 'error');
          }
          resolve(response);
        });
      } catch (err) {
        showToast(`❌ Lỗi: ${err.message}`, 'error');
        resolve({ success: false, message: err.message });
      }
    });
  }

  // Tìm mọi đường dẫn bài viết/media khả thi trong 1 thẻ bài viết
  function findAnyPostUrlInCard(card) {
    if (!card) return null;
    const anchors = Array.from(card.querySelectorAll('a[href]'));

    // 1. Thẻ chứa timestamp
    const timeRegex = /(?:\d{1,2}\s*(?:phút|giờ|ngày|tháng|thg|năm|mins?|hrs?|h|d|w|m|y)|vừa xong|vừa đăng|hôm qua|hôm nay)/i;
    for (const a of anchors) {
      const text = (a.innerText || a.textContent || '').trim();
      const href = a.getAttribute('href');
      if (href && timeRegex.test(text) && !href.includes('comment_id')) {
        try {
          const u = cleanUrl(new URL(href, window.location.origin).toString());
          if (u && !u.endsWith('facebook.com') && !u.endsWith('facebook.com/')) return u;
        } catch (_) {}
      }
    }

    // 2. Thẻ chứa post/permalink/reel/videos/photo/share
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
      if (href.includes('comment_id')) continue;
      if (
        href.includes('/posts/') ||
        href.includes('/permalink/') ||
        href.includes('/permalink.php') ||
        href.includes('/story.php') ||
        href.includes('story_fbid=') ||
        href.includes('/reel/') ||
        href.includes('/videos/') ||
        href.includes('/watch') ||
        href.includes('/photo') ||
        href.includes('/share/')
      ) {
        try {
          const u = cleanUrl(new URL(href, window.location.origin).toString());
          if (u && !u.endsWith('facebook.com') && !u.endsWith('facebook.com/')) return u;
        } catch (_) {}
      }
    }

    // 3. Fallback: URL hiện tại nếu đang mở trực tiếp
    const cur = window.location.href;
    if (cur.includes('/posts/') || cur.includes('/permalink') || cur.includes('/reel/') || cur.includes('/watch')) {
      return cleanUrl(cur);
    }

    return null;
  }

  // Lấy danh sách thẻ bài viết Facebook chuẩn xác nhất
  function getFeedCards() {
    const list = [];
    const seen = new Set();

    const selectors = [
      'div[role="article"]',
      'div[data-pagelet*="FeedUnit"]',
      'div[data-pagelet*="Tahoe"]',
      'div[data-virtualized="true"]'
    ];

    document.querySelectorAll(selectors.join(', ')).forEach(el => {
      if (el.closest('[aria-label*="Bình luận" i], [aria-label*="Comment" i]')) return;
      if (el.clientHeight < 120) return;
      if (!seen.has(el)) {
        seen.add(el);
        list.push(el);
      }
    });

    if (list.length === 0) {
      document.querySelectorAll('div[role="feed"] > div').forEach(el => {
        if (el.clientHeight > 150 && !seen.has(el)) {
          seen.add(el);
          list.push(el);
        }
      });
    }

    return list;
  }

  // Gắn cụm nút [⚡ Đẩy sang Tool] và [📋 Copy Link] trực tiếp lên mọi bài viết Facebook
  function injectFloatingButtons() {
    if (!window.location.hostname.includes('facebook.com')) return;

    const cards = getFeedCards();

    cards.forEach(card => {
      if (card.dataset.tzInjected === 'true') return;
      if (card.querySelector('.tz-post-actions-group')) {
        card.dataset.tzInjected = 'true';
        return;
      }

      // Đánh dấu đã gắn nút
      card.dataset.tzInjected = 'true';

      // Tạo Container chứa các nút tiện ích nổi bật
      const actionsGroup = document.createElement('div');
      actionsGroup.className = 'tz-post-actions-group';

      // ── NÚT 1: ⚡ ĐẨY SANG TOOL (LƯU VÀO HÀNG ĐỢI CHỜ ĐĂNG) ──
      const btnSend = document.createElement('button');
      btnSend.className = 'tz-btn tz-btn-send';
      btnSend.innerHTML = `<span>⚡</span><span>Đẩy sang Tool</span>`;
      btnSend.title = `Nhấn để gửi bài viết này sang ToolZutter (bên kia sẽ ở trạng thái Chờ đăng)`;

      btnSend.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        btnSend.innerHTML = `<span>⏳</span><span>Đang tìm link...</span>`;
        btnSend.disabled = true;

        const latestUrl = extractCleanPostUrl(card) || findAnyPostUrlInCard(card);
        if (!latestUrl || latestUrl.endsWith('facebook.com') || latestUrl.endsWith('facebook.com/')) {
          btnSend.innerHTML = `<span>⚡</span><span>Đẩy sang Tool</span>`;
          btnSend.disabled = false;
          showToast(`⚠️ Chưa nhận diện được link bài này. Vui lòng bấm vào thời gian đăng của bài viết!`, 'error');
          return;
        }

        btnSend.innerHTML = `<span>⏳</span><span>Đang gửi...</span>`;
        const response = await quickSendPost(latestUrl);
        const ok = Boolean(response && response.success);
        if (ok) {
          btnSend.classList.add('tz-sent');
          btnSend.innerHTML = `<span>✅</span><span>Đã sang Tool!</span>`;
          // Lưu vào bộ sưu tập đã nhặt
          try {
            chrome.runtime.sendMessage({
              action: 'ADD_COLLECTED_LINK',
              item: {
                url: latestUrl,
                title: getCardSnippet(card),
                timestamp: new Date().toISOString()
              }
            });
          } catch (_) {}
          showToast(`🎉 Đã đẩy bài viết sang ToolZutter! Bên kia đang ở trạng thái 'Chờ đăng' (Pending).`, 'success', 'http://localhost:3000');
        } else {
          btnSend.innerHTML = `<span>⚡</span><span>Đẩy sang Tool</span>`;
          btnSend.disabled = false;
        }
        setTimeout(() => {
          btnSend.classList.remove('tz-sent');
          btnSend.innerHTML = `<span>⚡</span><span>Đẩy sang Tool</span>`;
          btnSend.disabled = false;
        }, ok ? 3500 : 0);
      });

      // ── NÚT 2: 📋 COPY LINK (1-CHẠM) ──
      const btnCopy = document.createElement('button');
      btnCopy.className = 'tz-btn tz-btn-copy';
      btnCopy.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span>Copy Link</span>
      `;
      btnCopy.title = `Sao chép link sạch bài viết này (hoặc rê chuột bấm phím C)`;

      btnCopy.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const latestUrl = extractCleanPostUrl(card) || findAnyPostUrlInCard(card);
        if (!latestUrl || latestUrl.endsWith('facebook.com') || latestUrl.endsWith('facebook.com/')) {
          showToast(`⚠️ Chưa nhận diện được link bài này. Hãy click vào mốc thời gian để xem bài!`, 'error');
          return;
        }

        let success = false;
        try {
          await navigator.clipboard.writeText(latestUrl);
          success = true;
        } catch (_) {
          const ta = document.createElement('textarea');
          ta.value = latestUrl;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          success = document.execCommand('copy');
          document.body.removeChild(ta);
        }

        if (success) {
          btnCopy.classList.add('tz-copied');
          btnCopy.innerHTML = `
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Đã copy!</span>
          `;
          
          // Lưu vào bộ sưu tập của Extension để gom nhiều bài liên tục
          try {
            chrome.runtime.sendMessage({
              action: 'ADD_COLLECTED_LINK',
              item: {
                url: latestUrl,
                title: getCardSnippet(card),
                timestamp: new Date().toISOString()
              }
            }, (resp) => {
              const num = resp?.count || 1;
              showToast(`📋 [Đã gom #${num}] Đã copy link vào clipboard & lưu vào Extension!`, 'success');
            });
          } catch (_) {
            showToast(`📋 Đã copy link bài viết: ${latestUrl}`, 'success');
          }

          setTimeout(() => {
            btnCopy.classList.remove('tz-copied');
            btnCopy.innerHTML = `
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy Link</span>
            `;
          }, 2000);
        } else {
          showToast(`❌ Không thể copy link vào Clipboard`, 'error');
        }
      });

      // Thứ tự: [ ⚡ Đẩy sang Tool ] [ 📋 Copy Link ]
      actionsGroup.appendChild(btnSend);
      actionsGroup.appendChild(btnCopy);

      // Thêm sự kiện hover để hỗ trợ phím tắt C
      card.addEventListener('mouseenter', () => {
        document.querySelectorAll('.tz-hovered-card').forEach(c => c.classList.remove('tz-hovered-card'));
        card.classList.add('tz-hovered-card');
      });
      card.addEventListener('mouseleave', () => {
        card.classList.remove('tz-hovered-card');
      });

      // Đính kèm cụm nút: Luôn ghim ở góc trên bên phải của bài viết
      card.style.position = 'relative';
      card.appendChild(actionsGroup);
    });
  }

  // ── PHÍM TẮT SIÊU TỐC: Bấm phím 'C' khi rê chuột vào bài viết để Copy Link ──
  document.addEventListener('keydown', async (e) => {
    // Không kích hoạt nếu người dùng đang gõ trong ô nhập liệu
    const activeEl = document.activeElement;
    if (activeEl && (
      ['INPUT', 'TEXTAREA'].includes(activeEl.tagName) ||
      activeEl.isContentEditable ||
      activeEl.getAttribute('role') === 'textbox'
    )) {
      return;
    }

    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      let targetCard = document.querySelector('.tz-hovered-card');
      if (!targetCard) {
        // Fallback: Tìm card bài viết gần giữa màn hình nhất
        const cards = Array.from(document.querySelectorAll(FEED_CARD_SELECTOR));
        const midY = window.innerHeight / 2;
        let closestDist = Infinity;
        cards.forEach(c => {
          const r = c.getBoundingClientRect();
          if (r.top < window.innerHeight && r.bottom > 0) {
            const cardMid = (r.top + r.bottom) / 2;
            const dist = Math.abs(cardMid - midY);
            if (dist < closestDist) {
              closestDist = dist;
              targetCard = c;
            }
          }
        });
      }

      if (targetCard) {
        const url = extractCleanPostUrl(targetCard);
        if (url) {
          try {
            await navigator.clipboard.writeText(url);
            
            // Lưu vào bộ sưu tập của Extension
            try {
              chrome.runtime.sendMessage({
                action: 'ADD_COLLECTED_LINK',
                item: {
                  url: url,
                  title: getCardSnippet(targetCard),
                  timestamp: new Date().toISOString()
                }
              }, (resp) => {
                const num = resp?.count || 1;
                showToast(`📋 [Phím C - Đã gom #${num}] Đã copy link vào clipboard & lưu vào Extension!`, 'success');
              });
            } catch (_) {
              showToast(`📋 [Phím C] Đã copy link: ${url}`, 'success');
            }

            const copyBtn = targetCard.querySelector('.tz-btn-copy');
            if (copyBtn) {
              copyBtn.classList.add('tz-copied');
              copyBtn.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>Đã copy!</span>
              `;
              setTimeout(() => {
                copyBtn.classList.remove('tz-copied');
                copyBtn.innerHTML = `
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <span>Copy Link</span>
                `;
              }, 1800);
            }
          } catch (_) {}
        }
      }
    }
  });

  // Lấy danh sách toàn bộ bài viết / video / reel đang hiển thị trên trang hiện tại
  function extractAllVisibleLinks() {
    const urls = new Set();
    const currentHref = window.location.href;

    if (isPostOrMediaHref(currentHref)) {
      urls.add(cleanUrl(currentHref));
    }

    const cards = document.querySelectorAll(FEED_CARD_SELECTOR);
    cards.forEach(card => {
      const u = extractCleanPostUrl(card);
      if (u) urls.add(u);
    });

    return Array.from(urls);
  }

  // Lấy thông tin bài viết hiện tại đang ở giữa màn hình mắt nhìn
  function extractCurrentPostDetails() {
    const currentHref = window.location.href;
    let title = document.title || 'Bài viết Facebook';
    let targetUrl = currentHref;

    // 1. Nếu đang mở trực tiếp bài viết đơn hoặc Reels popup
    if (isPostOrMediaHref(currentHref)) {
      return {
        url: cleanUrl(currentHref),
        title: title,
        timestamp: new Date().toISOString()
      };
    }

    // 2. Nếu đang lướt Feed: Tìm bài viết đang nằm ở trọng tâm mắt nhìn nhất
    const cards = Array.from(document.querySelectorAll(FEED_CARD_SELECTOR))
      .filter(c => !c.closest('[role="navigation"], [data-pagelet*="LeftRail"], [data-pagelet*="RightRail"], [aria-label*="Bình luận" i]'));

    const viewportMidY = window.innerHeight * 0.45;
    let bestCard = null;
    let minDistance = Infinity;

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (rect.height < 120) continue;
      if (rect.bottom > 120 && rect.top < window.innerHeight - 100) {
        const cardCenter = (rect.top + rect.bottom) / 2;
        const dist = Math.abs(cardCenter - viewportMidY);
        if (dist < minDistance) {
          const url = extractCleanPostUrl(card);
          if (url) {
            minDistance = dist;
            bestCard = card;
            targetUrl = url;
          }
        }
      }
    }

    if (bestCard) {
      const textEl = bestCard.querySelector('div[data-ad-preview="message"], div[data-ad-comet-preview="message"], [dir="auto"]');
      if (textEl && textEl.innerText) {
        title = textEl.innerText.trim();
      }
    }

    return {
      url: targetUrl,
      title: title.length > 70 ? title.substring(0, 70) + '...' : title,
      timestamp: new Date().toISOString()
    };
  }

  // Lắng nghe messages từ Popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_PAGE_LINKS') {
      const links = extractAllVisibleLinks();
      const current = extractCurrentPostDetails();
      sendResponse({ links, current, count: links.length });
      return true;
    }

    if (request.action === 'SCROLL_AND_COLLECT') {
      let scrolled = 0;
      const maxScroll = request.scrollCount || 4;
      const interval = setInterval(() => {
        window.scrollBy({ top: 1200, behavior: 'smooth' });
        scrolled++;
        if (scrolled >= maxScroll) {
          clearInterval(interval);
          setTimeout(() => {
            const links = extractAllVisibleLinks();
            sendResponse({ links, count: links.length });
          }, 1200);
        }
      }, 800);
      return true;
    }
  });

  // Tự động quét và gắn nút liên tục khi cuộn trang
  injectFloatingButtons();
  setInterval(injectFloatingButtons, 1000);

})();
