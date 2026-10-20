const { chromium } = require('playwright');

/**
 * Săn bài viết Viral từ Threads (threads.net) theo từ khoá hoặc theo trang cá nhân (@username)
 * @param {Object} options
 * @param {string} options.keyword - Từ khoá tìm kiếm (vd: "review", "bất động sản", "@username")
 * @param {string} options.targetUrl - Đường dẫn tuỳ chọn (vd: https://www.threads.net/search?q=... hoặc https://www.threads.net/@username)
 * @param {number} options.limit - Số bài cần lấy (mặc định 20)
 * @param {number} options.minReactions - Ngưỡng tương tác tối thiểu
 * @param {boolean} options.sortViral - Có sắp xếp theo viralScore giảm dần hay không
 */
async function huntThreads({
  keyword,
  targetUrl,
  limit = 20,
  minReactions = 0,
  sortViral = true,
}) {
  const targetLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 60);
  let searchUrl = '';

  const cleanTarget = (targetUrl || '').trim();
  const cleanKeyword = (keyword || '').trim();

  if (cleanTarget) {
    searchUrl = cleanTarget.replace(/threads\.com/gi, 'threads.net');
    if (!/^https?:\/\//i.test(searchUrl)) {
      searchUrl = `https://www.threads.net/${searchUrl.replace(/^\/+/, '')}`;
    }
  } else if (cleanKeyword) {
    if (cleanKeyword.startsWith('@')) {
      searchUrl = `https://www.threads.net/@${encodeURIComponent(cleanKeyword.replace('@', ''))}`;
    } else {
      searchUrl = `https://www.threads.net/search?q=${encodeURIComponent(cleanKeyword)}&serp_type=default`;
    }
  } else {
    searchUrl = 'https://www.threads.net/search?q=review&serp_type=default';
  }

  console.log(`[ThreadsHunter] 🧵 Bắt đầu quét Threads: ${searchUrl} | Limit: ${targetLimit}`);

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // Chặn bớt font, analytics nặng
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (type === 'font') return route.abort();
      return route.continue();
    });

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(3500);

    // Cuộn trang để tải thêm bài
    const scrollsNeeded = Math.ceil(targetLimit / 6);
    for (let i = 0; i < scrollsNeeded; i++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await page.waitForTimeout(1800);
    }

    const rawPosts = await page.evaluate(({ minReactionsArg }) => {
      const parseCount = (text) => {
        if (!text) return 0;
        const clean = text.replace(/,/g, '').trim();
        const m = clean.match(/^([\d.]+)\s*([kKmMbB]?)$/);
        if (!m) return 0;
        let num = parseFloat(m[1]);
        const s = m[2].toUpperCase();
        if (s === 'K') num *= 1000;
        else if (s === 'M') num *= 1000000;
        return Math.round(num);
      };

      const results = [];
      const seenUrls = new Set();
      const containers = Array.from(
        document.querySelectorAll('div[data-pressable-container="true"], article, div[role="article"]')
      );

      containers.forEach((el) => {
        const link = el.querySelector('a[href*="/post/"], a[href*="/t/"]');
        if (!link) return;

        let postUrl = link.href.replace(/threads\.com/gi, 'threads.net').split('?')[0];
        if (seenUrls.has(postUrl)) return;
        seenUrls.add(postUrl);

        // Author
        let author = '';
        const authorLink = el.querySelector('a[href*="/@"]');
        if (authorLink) {
          const match = authorLink.getAttribute('href')?.match(/@([^/?#]+)/);
          if (match) author = match[1];
        }

        // Caption - Threads places post text in span/div with dir="auto"
        const textNodes = Array.from(el.querySelectorAll('span[dir="auto"], div[dir="auto"]'))
          .map((n) => n.innerText?.trim())
          .filter(
            (t) =>
              t &&
              t.length > 0 &&
              t !== author &&
              !t.toLowerCase().includes('follow') &&
              !t.toLowerCase().includes('theo dõi')
          );

        textNodes.sort((a, b) => b.length - a.length);
        const caption = textNodes[0] || '';

        // Media
        const images = Array.from(
          el.querySelectorAll('img[src*="cdninstagram"], img[src*="threads"], img[src*="fbcdn"]')
        )
          .map((img) => img.src)
          .filter((src) => !src.includes('profile') && !src.includes('s150x150') && !src.includes('external.'));

        const video = el.querySelector('video');
        const hasVideo = !!video;
        const mediaUrls = [...new Set(images)];

        // Metrics: Like, Comment, Repost
        let reactions = 0;
        let comments = 0;
        let shares = 0;

        const likeEl = el
          .querySelector('svg[aria-label*="Like"], svg[aria-label*="Thích"]')
          ?.closest('button, div[role="button"]');
        if (likeEl) {
          reactions = parseCount(likeEl.innerText);
        }

        const commentEl = el
          .querySelector('svg[aria-label*="Reply"], svg[aria-label*="Bình luận"], svg[aria-label*="Trả lời"]')
          ?.closest('button, div[role="button"]');
        if (commentEl) {
          comments = parseCount(commentEl.innerText);
        }

        const repostEl = el
          .querySelector('svg[aria-label*="Repost"], svg[aria-label*="Đăng lại"]')
          ?.closest('button, div[role="button"]');
        if (repostEl) {
          shares = parseCount(repostEl.innerText);
        }

        // Thời gian đăng (time tag hoặc text)
        const timeEl = el.querySelector('time');
        const dateText = timeEl ? timeEl.innerText || timeEl.getAttribute('datetime') : 'Gần đây';

        const viralScore = reactions + comments * 2 + shares * 3;

        if (minReactionsArg > 0 && reactions < minReactionsArg) {
          return;
        }

        let mediaType = 'TEXT';
        if (hasVideo) mediaType = 'VIDEO';
        else if (mediaUrls.length > 0) mediaType = 'IMAGE';

        results.push({
          id: postUrl,
          url: postUrl,
          author: author ? `@${author}` : 'Tác giả Threads',
          caption,
          mediaUrls,
          hasVideo,
          mediaType,
          mediaCount: mediaUrls.length,
          reactions,
          comments,
          shares,
          viralScore,
          isViral: viralScore >= 30,
          dateText,
          publishedAt: timeEl?.getAttribute('datetime') || new Date().toISOString(),
          platform: 'THREADS',
        });
      });

      return results;
    }, { minReactionsArg: minReactions });

    let finalItems = rawPosts;
    if (sortViral) {
      finalItems.sort((a, b) => b.viralScore - a.viralScore);
    }
    finalItems = finalItems.slice(0, targetLimit);

    console.log(`[ThreadsHunter] ✅ Thu thập thành công ${finalItems.length} bài viết từ Threads!`);

    return {
      success: true,
      platform: 'THREADS',
      keyword: cleanKeyword || undefined,
      targetUrl: searchUrl,
      items: finalItems,
    };
  } catch (err) {
    console.error('[ThreadsHunter] ❌ Lỗi quét Threads:', err.message);
    return {
      success: false,
      error: `Lỗi quét bài Threads: ${err.message}`,
      items: [],
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = {
  huntThreads,
};
