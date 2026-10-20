// Content Script for ToolZutter - Facebook & Threads 1-Click Scraper

(function () {
  console.log('🚀 ToolZutter Helper Content Script loaded.');

  // Tạo Toast thông báo trên giao diện
  function showToast(message, type = 'success') {
    let toast = document.getElementById('toolzutter-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toolzutter-toast';
      document.body.appendChild(toast);
    }
    const icon = type === 'success' ? '✅' : (type === 'info' ? '⏳' : '⚠️');
    toast.className = `toolzutter-toast show ${type}`;
    toast.innerHTML = `
      <div class="tz-toast-icon">${icon}</div>
      <div class="tz-toast-text">${message}</div>
    `;
    setTimeout(() => {
      toast.className = 'toolzutter-toast';
    }, 3500);
  }

  // Card bao quanh 1 bài viết — dùng chung cho mọi nơi cần tìm "khung bài viết"
  // (Home/Group/Fanpage Feed, bài mở chi tiết, popup modal, Comet UI ảo hoá).
  const FEED_CARD_SELECTOR = [
    'div[role="feed"] > div',
    'div[data-pagelet*="FeedUnit"]',
    'div[role="article"]',
    'div[data-pagelet*="Tahoe"]',
    'div[role="dialog"]',
    'div[aria-posinset]',
    'div[data-virtualized="true"]'
  ].join(', ');

  // Chuẩn hoá URL Facebook / Threads
  function cleanUrl(rawUrl) {
    try {
      if (!rawUrl) return null;
      let url = new URL(rawUrl, window.location.origin);
      
      const trackingParams = ['fbclid', '__cft__', '__tn__', 'mibextid', 'rdid', 'notif_id', 'notif_t', 'ref', 'source', 'epa', 'sfnsn'];
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

  // Kiểm tra xem href có phải là link bài viết / media không
  function isPostOrMediaHref(href) {
    if (!href || typeof href !== 'string') return false;
    if (href.startsWith('#') || href.startsWith('javascript:')) return false;
    
    const ignored = [
      '/settings', '/messages', '/notifications', '/marketplace', '/friends',
      '/bookmarks', '/saved', '/gaming', '/events', '/memories', '/ads',
      '/login', '/help', '/recover', '/hashtag/', '/stories/'
    ];
    if (ignored.some(ig => href.includes(ig))) return false;

    return (
      href.includes('/posts/') ||
      href.includes('/permalink/') ||
      href.includes('/permalink.php') ||
      href.includes('/story.php') ||
      href.includes('story_fbid=') ||
      href.includes('/videos/') ||
      href.includes('/reel/') ||
      href.includes('/watch') ||
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

  // Gửi bài viết trực tiếp vào ToolZutter, trả về Promise<response> để nút bấm biết kết quả thật
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
              'success'
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

  // Gắn nút "⚡ Lưu bài này" trực tiếp vào từng bài viết Facebook.
  // Quét theo Card trước (Card-First): duyệt mọi khung bài viết ngoài Feed/chi tiết/modal,
  // rồi mới tìm link hợp lệ bên trong từng Card — thay vì quét link trước rồi dò ngược lên Card,
  // vì cách cũ dễ bỏ sót các Card mà link bên trong không khớp đúng vị trí mong đợi.
  function injectFloatingButtons() {
    if (!window.location.hostname.includes('facebook.com')) return;

    const cards = document.querySelectorAll(FEED_CARD_SELECTOR);

    cards.forEach(card => {
      if (card.dataset.tzInjected === 'true') return;
      // Card cha (vd role="feed" > div) và Card con lồng bên trong (vd role="article") có thể cùng
      // khớp bài viết — nếu 1 ancestor đã được gắn nút thì bỏ qua để tránh nhân đôi.
      if (card.closest('[data-tz-injected="true"]')) return;

      // Bỏ qua nếu là phần comment
      if (
        card.closest('[aria-label*="Bình luận"], [aria-label*="Comment"]') ||
        card.querySelector('div[aria-label*="Trả lời"]')
      ) {
        return;
      }

      // Tìm link bài viết hợp lệ đầu tiên bên trong Card
      let rawHref = null;
      const anchors = card.querySelectorAll('a[href]');
      for (const a of anchors) {
        const href = a.getAttribute('href');
        if (!href || href.includes('comment_id=') || href.includes('reply_comment_id=')) continue;
        if (isPostOrMediaHref(href)) {
          rawHref = href;
          break;
        }
      }
      if (!rawHref) return; // Không có link hợp lệ trong Card này -> bỏ qua, không gắn nút rác

      let targetUrl = cleanUrl(new URL(rawHref, window.location.origin).toString());
      if (!targetUrl || targetUrl === 'https://www.facebook.com/' || targetUrl === 'https://www.facebook.com') return;

      card.dataset.tzInjected = 'true';

      const btn = document.createElement('button');
      btn.className = 'tz-quick-grab-btn tz-inline';
      btn.innerHTML = `<span>⚡</span> Lưu bài này`;
      btn.title = `Lưu bài viết này vào hàng đợi ToolZutter`;

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.innerHTML = `<span>⏳</span> Đang lưu...`;
        btn.disabled = true;
        const response = await quickSendPost(targetUrl);
        const ok = Boolean(response && response.success);
        btn.innerHTML = ok ? `<span>✅</span> Đã lưu` : `<span>⚡</span> Lưu bài này`;
        btn.disabled = ok;
        setTimeout(() => {
          btn.innerHTML = `<span>⚡</span> Lưu bài này`;
          btn.disabled = false;
        }, ok ? 3000 : 0);
      });

      // Chèn nút vào thanh Header (cạnh nút 3 chấm ...) hoặc phía trên Caption
      const headerActions = card.querySelector('div[aria-label*="Hành động"], div[aria-label*="Actions"], div[aria-label*="Tùy chọn"]');
      const captionEl = card.querySelector('div[data-ad-preview="message"], div[data-ad-comet-preview="message"], div[dir="auto"]');

      if (headerActions && headerActions.parentElement) {
        headerActions.parentElement.insertBefore(btn, headerActions);
      } else if (captionEl && captionEl.parentElement) {
        captionEl.parentElement.insertBefore(btn, captionEl);
      } else {
        card.style.position = 'relative';
        btn.className = 'tz-quick-grab-btn tz-floating';
        card.appendChild(btn);
      }
    });
  }

  // Lấy danh sách toàn bộ bài viết / video / reel đang hiển thị trên trang hiện tại
  function extractAllVisibleLinks() {
    const urls = new Set();
    const currentHref = window.location.href;

    if (
      currentHref.includes('/reel/') ||
      currentHref.includes('/videos/') ||
      currentHref.includes('/posts/') ||
      currentHref.includes('/permalink/') ||
      currentHref.includes('/share/r/') ||
      currentHref.includes('/share/p/') ||
      currentHref.includes('/share/v/') ||
      currentHref.includes('/post/')
    ) {
      urls.add(cleanUrl(currentHref));
    }

    const links = document.querySelectorAll('a[href]');
    links.forEach(a => {
      const href = a.getAttribute('href');
      if (isPostOrMediaHref(href)) {
        try {
          const fullUrl = new URL(href, window.location.origin).toString();
          if (!fullUrl.includes('comment_id=') && !fullUrl.includes('reply_comment_id=')) {
            urls.add(cleanUrl(fullUrl));
          }
        } catch (_) {}
      }
    });

    return Array.from(urls);
  }

  // Lấy thông tin bài viết hiện tại
  function extractCurrentPostDetails() {
    const currentHref = window.location.href;
    let title = document.title || 'Bài viết Facebook';
    let targetUrl = currentHref;

    const postLinks = document.querySelectorAll('a[href]');
    for (const a of postLinks) {
      const href = a.getAttribute('href');
      if (!href || href.includes('comment_id=') || !isPostOrMediaHref(href)) continue;
      const rect = a.getBoundingClientRect();
      if (rect.top >= -100 && rect.top <= window.innerHeight * 0.7) {
        try {
          targetUrl = cleanUrl(new URL(href, window.location.origin).toString());
          const card = a.closest(FEED_CARD_SELECTOR);
          const textEl = card?.querySelector('div[data-ad-preview="message"], div[dir="auto"], span[dir="auto"]');
          if (textEl && textEl.innerText) {
            title = textEl.innerText.trim();
          }
          break;
        } catch (_) {}
      }
    }

    return {
      url: targetUrl,
      title: title,
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

  // Chạy gắn nút liên tục khi cuộn
  injectFloatingButtons();
  setInterval(injectFloatingButtons, 1000);

})();
