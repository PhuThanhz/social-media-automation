const { chromium } = require('playwright');

const COOKIE_STRING = "c_user=100023403136194; i_user=61584834510803; xs=45%3AthqL48zx2Z-FQA%3A2%3A1789536107%3A-1%3A-1%3A%3AAcwgjvG6sRi56fPT3F5atVrbrTsI5gIEmcU4K4OdOg";
const PERMALINK_URL = "https://www.facebook.com/groups/947583488284655/permalink/1174601305582871/";

(async () => {
  console.log(`🚀 [UserTest] Xoá bài viết permalink ${PERMALINK_URL} của nick "Làm Sen"...`);
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

  // Selector chính xác 100% tìm thấy ở bước quét DOM: "Hành động đối với bài viết này của Làm Sen"
  const menuBtn = page.locator('div[role="button"]').filter({
    hasText: ''
  }).filter({
    has: page.locator('i')
  }).filter({
    hasNotText: /Thích|Bình luận|Chia sẻ|Like|Comment|Share/i
  }).locator('xpath=..').locator('div[role="button"][aria-label*="Hành động đối với bài viết này của Làm Sen"]').first();

  let targetMenuBtn = menuBtn;
  if (!await targetMenuBtn.isVisible().catch(() => false)) {
    targetMenuBtn = page.locator('div[role="button"][aria-label*="Hành động đối với bài viết này của Làm Sen"]').first();
  }

  if (await targetMenuBtn.isVisible().catch(() => false)) {
    const label = await targetMenuBtn.getAttribute('aria-label').catch(() => '');
    console.log(`[UserTest] 🔘 Click nút 3 chấm chính xác của Làm Sen: "${label}"`);
    await targetMenuBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(2000);

    // Filter tìm đúng menuitem "Chuyển vào thùng rác" hoặc "Xóa bài viết"
    const deleteOption = page.locator('div[role="menuitem"]').filter({
      hasText: /Chuyển vào thùng rác|Xóa bài viết|Delete post|Move to trash/i
    }).first();

    if (await deleteOption.isVisible().catch(() => false)) {
      const itemText = await deleteOption.innerText().catch(() => '');
      console.log(`[UserTest] 🎯 Click chọn tùy chọn xoá: "${itemText}"`);
      await deleteOption.click({ force: true }).catch(() => {});
      await page.waitForTimeout(2000);

      // Confirm modal button
      const confirmBtn = page.locator(
        'div[role="dialog"] div[role="button"]:has-text("Xóa"), ' +
        'div[role="dialog"] div[role="button"]:has-text("Delete"), ' +
        'div[role="dialog"] div[role="button"]:has-text("Chuyển vào thùng rác"), ' +
        'div[role="dialog"] div[role="button"]:has-text("Xác nhận")'
      ).first();

      if (await confirmBtn.isVisible().catch(() => false)) {
        const btnText = await confirmBtn.innerText().catch(() => '');
        console.log(`[UserTest] 🔴 Bấm nút xác nhận trong Modal: "${btnText}"`);
        await confirmBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(4000);
        console.log(`\n🎉🎉🎉 [UserTest] ĐÃ XOÁ THÀNH CÔNG BÀI VIẾT THỦ CÔNG KHỎI GROUP DÒNG CHẢY ẨM THỰC! 🎉🎉🎉`);
      } else {
        console.log('[UserTest] ⚠️ Không tìm thấy nút xác nhận trong Modal dialog');
      }
    } else {
      console.log('[UserTest] ⚠️ Không thấy tùy chọn Xoá bài viết trong menu');
    }
  } else {
    console.log('[UserTest] ⚠️ Không tìm thấy nút menu 3 chấm của Làm Sen');
  }

  await browser.close();
})();
