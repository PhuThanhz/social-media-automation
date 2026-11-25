// Dò dải phông nền status của Facebook (CHỈ ĐỌC — đóng composer, không đăng).
// Chạy: COOKIE="c_user=...; xs=..." node worker/scratch/dump-fb-backgrounds.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const COOKIE_STRING = process.env.COOKIE || '';
const OUT_DIR = path.join(__dirname, '..', 'debug_output', 'fb-backgrounds');
fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: 'vi-VN',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  await context.addCookies(
    COOKIE_STRING.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
      const i = p.indexOf('=');
      return { name: p.slice(0, i), value: p.slice(i + 1), domain: '.facebook.com', path: '/' };
    })
  );
  const page = await context.newPage();
  try {
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);
    const opener = page.locator(
      'div[role="button"]:has-text("Bạn đang nghĩ gì"), div[role="button"]:has-text("What\'s on your mind"), span:has-text("Bạn đang nghĩ gì")'
    ).first();
    await opener.click({ timeout: 15000 });
    await page.waitForTimeout(3000);
    const dialog = page.locator('div[role="dialog"]:has(div[contenteditable="true"][role="textbox"])').first();
    const editor = dialog.locator('div[contenteditable="true"][role="textbox"]').first();
    await editor.click({ force: true });
    await page.keyboard.type('a');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT_DIR, '1-composer.png') });

    const dumpSwatches = () => page.evaluate(() => {
      const dlg = Array.from(document.querySelectorAll('div[role="dialog"]')).find((d) => d.querySelector('div[contenteditable="true"][role="textbox"]'));
      if (!dlg) return [];
      const els = Array.from(dlg.querySelectorAll('div[role="button"], div[tabindex="0"], div[role="radio"], div[role="option"], div[aria-label]'));
      return els.map((el, idx) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const inner = Array.from(el.querySelectorAll('*')).map((c) => {
          const s = getComputedStyle(c);
          return [s.backgroundColor, s.backgroundImage].filter((v) => v && v !== 'none' && v !== 'rgba(0, 0, 0, 0)').join(' | ');
        }).filter(Boolean).slice(0, 3);
        const imgs = Array.from(el.querySelectorAll('img')).map((i) => i.src).slice(0, 2);
        return {
          idx, tag: el.tagName, role: el.getAttribute('role'), aria: el.getAttribute('aria-label'),
          x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
          bg: cs.backgroundColor, bgImg: (cs.backgroundImage || '').slice(0, 200),
          style: (el.getAttribute('style') || '').slice(0, 200), inner, imgs,
        };
      }).filter((e) => e.w > 0 && e.w <= 60 && e.h > 0 && e.h <= 60);
    });

    const before = await dumpSwatches();
    fs.writeFileSync(path.join(OUT_DIR, '2-before.json'), JSON.stringify(before, null, 2));

    // Mở dải nền (nút "Aa")
    const aa = dialog.locator('div[aria-label*="phông nền" i], div[aria-label*="background" i]').first();
    if (await aa.isVisible().catch(() => false)) {
      console.log('Aa aria:', await aa.getAttribute('aria-label'));
      await aa.click({ force: true });
      await page.waitForTimeout(1500);
    } else {
      console.log('Không thấy nút Aa theo aria');
    }
    await page.screenshot({ path: path.join(OUT_DIR, '3-strip.png') });
    const strip = await dumpSwatches();
    fs.writeFileSync(path.join(OUT_DIR, '4-strip.json'), JSON.stringify(strip, null, 2));

    // Thử mở bảng đầy đủ (nút lưới cuối dải)
    const allBtn = dialog.locator('div[role="button"][aria-label="Tùy chọn phông nền"], div[role="button"][aria-label="Background options"]').first();
    if (await allBtn.isVisible().catch(() => false)) {
      console.log('All-btn aria:', await allBtn.getAttribute('aria-label'));
      await allBtn.click({ force: true });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(OUT_DIR, '5-all.png') });
      const all = await page.evaluate(() => Array.from(document.querySelectorAll('[aria-label]')).filter((e) => /phông nền|background/i.test(e.getAttribute('aria-label') || '')).map((e) => {
        const r = e.getBoundingClientRect();
        const inner = Array.from(e.querySelectorAll('*')).map((c) => getComputedStyle(c).backgroundImage).filter((v) => v && v !== 'none').slice(0, 1);
        const imgs = Array.from(e.querySelectorAll('img')).map((i) => i.src).slice(0, 1);
        return { aria: e.getAttribute('aria-label'), role: e.getAttribute('role'), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), inner, imgs };
      }));
      fs.writeFileSync(path.join(OUT_DIR, '6-all.json'), JSON.stringify(all, null, 2));
    } else {
      console.log('Không thấy nút xem tất cả theo aria');
    }
    // In mọi aria-label trong dialog để tra
    const arias = await page.evaluate(() => {
      const dlgs = Array.from(document.querySelectorAll('div[role="dialog"]'));
      return Array.from(new Set(dlgs.flatMap((d) => Array.from(d.querySelectorAll('[aria-label]')).map((e) => e.getAttribute('aria-label')))));
    });
    fs.writeFileSync(path.join(OUT_DIR, '7-arias.json'), JSON.stringify(arias, null, 2));
    console.log('Đã dump xong vào', OUT_DIR);
  } catch (e) {
    console.error('Lỗi:', e.message);
    await page.screenshot({ path: path.join(OUT_DIR, 'error.png') }).catch(() => {});
  } finally {
    // KHÔNG bấm Đăng — chỉ đóng trình duyệt, nội dung nháp bị bỏ.
    await browser.close();
  }
})();
