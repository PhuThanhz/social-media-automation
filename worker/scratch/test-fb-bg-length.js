// Thử FB còn cho phông nền ở độ dài chữ nào (CHỈ ĐỌC — đóng trình duyệt, không bấm Đăng).
const { chromium } = require('playwright');
const path = require('path');
const { selectFacebookBackground } = require('../fb-background');
const OUT = path.join(__dirname, '..', 'debug_output', 'fb-backgrounds');
const base = 'Nc với sếp thì sếp nói cty tư nhân ko cho nghỉ thích thì kiện đi ngta đi hầu, có cách nào xử lý ko ạ mọi người ơi giúp mình với. ';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'vi-VN',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });
  await context.addCookies((process.env.COOKIE || '').split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf('='); return { name: p.slice(0, i), value: p.slice(i + 1), domain: '.facebook.com', path: '/' };
  }));
  const page = await context.newPage();
  try {
    for (const len of [120, 150, 199, 230]) {
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4000);
      await page.locator('div[role="button"]:has-text("Bạn đang nghĩ gì"), span:has-text("Bạn đang nghĩ gì")').first().click({ timeout: 15000 });
      await page.waitForTimeout(2500);
      const dialog = page.locator('div[role="dialog"]:has(div[contenteditable="true"][role="textbox"])').first();
      await dialog.locator('div[contenteditable="true"][role="textbox"]').first().click({ force: true });
      const text = base.repeat(5).slice(0, len);
      await page.keyboard.type(text);
      await page.waitForTimeout(1200);
      const aaVisible = await dialog.locator('div[role="button"][aria-label*="phông nền" i]').first().isVisible().catch(() => false);
      const ok = await selectFacebookBackground(dialog, page, 'GRAD_RED_BLUE', async () => false);
      await page.waitForTimeout(1200);
      // Có nền thật không: ô soạn nằm trên vùng có background gradient
      const applied = await page.evaluate(() => {
        const ed = Array.from(document.querySelectorAll('div[role="dialog"] div[contenteditable="true"][role="textbox"]'))[0];
        let el = ed;
        for (let i = 0; i < 12 && el; i++, el = el.parentElement) {
          const bi = getComputedStyle(el).backgroundImage;
          if (bi && bi.includes('gradient')) return true;
        }
        return false;
      });
      await page.screenshot({ path: path.join(OUT, `len-${len}.png`) });
      console.log(`len=${len} nútAa=${aaVisible} bấmĐược=${!!ok} nềnĐãÁp=${applied}`);
    }
  } catch (e) {
    console.error('Lỗi:', e.message);
  } finally {
    await browser.close();
  }
})();
