const { chromium } = require('playwright');

async function testThreadsDetailed() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  const searchUrl = 'https://www.threads.net/search?q=review&serp_type=default';
  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(4000);
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(2000);

    const posts = await page.evaluate(() => {
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
      const containers = Array.from(document.querySelectorAll('div[data-pressable-container="true"], article, div[role="article"]'));

      containers.forEach(el => {
        const link = el.querySelector('a[href*="/post/"]');
        if (!link) return;

        // Post URL
        const url = link.href.replace('threads.com', 'threads.net');

        // Author
        let author = '';
        const authorLink = el.querySelector('a[href*="/@"]');
        if (authorLink) {
          const match = authorLink.getAttribute('href')?.match(/@([^/?#]+)/);
          if (match) author = match[1];
        }

        // Caption - Threads places post text in span/div with dir="auto", ignoring username
        const textNodes = Array.from(el.querySelectorAll('span[dir="auto"], div[dir="auto"]'))
          .map(n => n.innerText?.trim())
          .filter(t => t && t.length > 0 && t !== author && !t.includes('Follow') && !t.includes('Theo dõi'));
        
        // Pick longest text as caption
        textNodes.sort((a, b) => b.length - a.length);
        const caption = textNodes[0] || '';

        // Media
        const images = Array.from(el.querySelectorAll('img[src*="cdninstagram"], img[src*="threads"], img[src*="fbcdn"]'))
          .map(img => img.src)
          .filter(src => !src.includes('profile') && !src.includes('s150x150') && !src.includes('external.'));

        const video = el.querySelector('video');
        const hasVideo = !!video;

        // Metrics: Like, Comment, Repost
        // Threads often has SVGs with aria-label or buttons
        let reactions = 0;
        let comments = 0;
        let shares = 0;

        // Like button
        const likeEl = el.querySelector('svg[aria-label*="Like"], svg[aria-label*="Thích"]')?.closest('button, div[role="button"]');
        if (likeEl) {
          reactions = parseCount(likeEl.innerText);
        }

        // Comment button
        const commentEl = el.querySelector('svg[aria-label*="Reply"], svg[aria-label*="Bình luận"], svg[aria-label*="Trả lời"]')?.closest('button, div[role="button"]');
        if (commentEl) {
          comments = parseCount(commentEl.innerText);
        }

        // Repost button
        const repostEl = el.querySelector('svg[aria-label*="Repost"], svg[aria-label*="Đăng lại"]')?.closest('button, div[role="button"]');
        if (repostEl) {
          shares = parseCount(repostEl.innerText);
        }

        const viralScore = reactions + comments * 2 + shares * 3;

        results.push({
          url,
          author,
          caption: caption.slice(0, 200),
          imagesCount: images.length,
          hasVideo,
          reactions,
          comments,
          shares,
          viralScore,
        });
      });

      return results;
    });

    console.log(JSON.stringify(posts.slice(0, 4), null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
}

testThreadsDetailed();
