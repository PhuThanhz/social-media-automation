const { chromium } = require('playwright');

async function testThreads() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  const searchUrl = 'https://www.threads.net/search?q=review';
  console.log('Navigating to', searchUrl);
  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(4000);
    const title = await page.title();
    console.log('Page title:', title);

    const posts = await page.evaluate(() => {
      const results = [];
      const containers = document.querySelectorAll('div[data-pressable-container="true"], article, div[role="article"]');
      containers.forEach(el => {
        const link = el.querySelector('a[href*="/post/"]');
        const textEl = el.querySelector('span[dir="auto"], div[dir="auto"]');
        if (link && textEl) {
          results.push({
            url: link.href,
            text: textEl.innerText.slice(0, 100),
          });
        }
      });
      return results;
    });

    console.log(`Found ${posts.length} posts!`);
    if (posts.length > 0) {
      console.log('Sample post:', posts[0]);
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
}

testThreads();
