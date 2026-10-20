const { chromium } = require('playwright');

const COOKIE_STRING = "c_user=100023403136194; i_user=61584834510803; xs=45%3AthqL48zx2Z-FQA%3A2%3A1789536107%3A-1%3A-1%3A%3AAcwgjvG6sRi56fPT3F5atVrbrTsI5gIEmcU4K4OdOg";
const PERMALINK_URL = "https://www.facebook.com/groups/947583488284655/permalink/1174601305582871/";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  await context.addCookies(
    COOKIE_STRING.split(';').map(p => p.trim()).filter(Boolean).map(p => {
      const idx = p.indexOf('=');
      return { name: p.slice(0, idx), value: p.slice(idx + 1), domain: '.facebook.com', path: '/' };
    })
  );
  const page = await context.newPage();
  await page.goto(PERMALINK_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(4000);

  console.log(`[DOM Inspect] URL: ${page.url()}`);
  const title = await page.title();
  console.log(`[DOM Inspect] Page Title: ${title}`);

  // Chụp ảnh màn hình để xem chính xác giao diện Facebook permalink
  await page.screenshot({ path: '/Users/huynhthanhphu/Documents/TOOLZUTTER/auto-post-saas/worker/debug_permalink.png', fullPage: true });

  const allButtons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('div[role="button"], button, i')).map(el => ({
      ariaLabel: el.getAttribute('aria-label'),
      text: el.innerText ? el.innerText.trim().slice(0, 30) : '',
      role: el.getAttribute('role'),
      tagName: el.tagName
    })).filter(b => b.ariaLabel || b.text);
  });

  console.log(`[DOM Inspect] Tổng số buttons/elements có label:`, allButtons.length);
  console.log(JSON.stringify(allButtons.slice(0, 25), null, 2));

  await browser.close();
})();
