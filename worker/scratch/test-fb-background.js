// Test chọn phông nền theo preset (CHỈ ĐỌC — đóng trình duyệt, không bấm Đăng).
// COOKIE="..." node scratch/test-fb-background.js RAINBOW GRAD_RED_BLUE
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { selectFacebookBackground } = require('../fb-background');

const OUT = path.join(__dirname, '..', 'debug_output', 'fb-backgrounds');
fs.mkdirSync(OUT, { recursive: true });
const presets = process.argv.slice(2);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'vi-VN',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });
  await context.addCookies((process.env.COOKIE || '').split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf('='); return { name: p.slice(0, i), value: p.slice(i + 1), domain: '.facebook.com', path: '/' };
  }));
  const page = await context.newPage();
  try {
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);
    for (const preset of presets) {
      await page.locator('div[role="button"]:has-text("Bạn đang nghĩ gì"), span:has-text("Bạn đang nghĩ gì")').first().click({ timeout: 15000 });
      await page.waitForTimeout(3000);
      const dialog = page.locator('div[role="dialog"]:has(div[contenteditable="true"][role="textbox"])').first();
      await dialog.locator('div[contenteditable="true"][role="textbox"]').first().click({ force: true });
      await page.keyboard.type('Test nen ' + preset);
      await page.waitForTimeout(1000);
      const ok = await selectFacebookBackground(dialog, page, preset, async () => { console.log('-> fallbackRed được gọi'); return false; });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(OUT, `test-${preset}.png`) });
      console.log(preset, '=>', ok);
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4000);
    }
  } catch (e) {
    console.error('Lỗi:', e.message);
    await page.screenshot({ path: path.join(OUT, 'test-error.png') }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
