const { chromium } = require('playwright');

async function testTikTokPlaywright(keyword) {
  console.log('Testing TikTok Playwright for keyword:', keyword);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    const url = `https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`;
    console.log('Navigating to:', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(4000);
    const title = await page.title();
    console.log('Title:', title);

    const items = await page.evaluate(() => {
      const results = [];
      const links = Array.from(document.querySelectorAll('a[href*="/video/"]'));
      links.forEach(a => {
        const text = a.innerText || a.getAttribute('title') || '';
        const img = a.querySelector('img');
        results.push({
          url: a.href,
          text: text.slice(0, 80),
          cover: img?.src || '',
        });
      });
      return results;
    });

    console.log(`Found ${items.length} items from TikTok!`);
    if (items.length > 0) {
      console.log('Sample item:', items[0]);
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
}

testTikTokPlaywright('review');
