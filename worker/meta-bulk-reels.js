const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

/**
 * Tự động tải hàng loạt thước phim (Bulk Upload Reels) trên Meta Business Suite
 * @param {Array<{ filePath: string, caption: string, scheduleTime?: string }>} items
 * @param {string} cookieString 
 * @param {string} pageId 
 */
async function bulkUploadReels(items, cookieString, pageId) {
  const parseCookieString = (str) => str.split(';').map(pair => {
    const [name, ...val] = pair.trim().split('=');
    let rawVal = val.join('=');
    try { rawVal = decodeURIComponent(rawVal); } catch (e) {}
    return { name, value: rawVal, domain: '.facebook.com', path: '/' };
  }).filter(c => c.name && c.value);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 }
  });

  await context.addCookies(parseCookieString(cookieString));
  const page = await context.newPage();

  try {
    console.log(`[Bulk Reels] 🚀 Đang mở Meta Business Suite Bulk Upload cho Fanpage ID: ${pageId}...`);
    const bulkUrl = `https://business.facebook.com/latest/reels_composer/bulk_upload?asset_id=${pageId}`;
    await page.goto(bulkUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    // 1. Gắn danh sách tất cả file video vào input file
    const filePaths = items.map(item => item.filePath).filter(fp => fs.existsSync(fp));
    if (filePaths.length === 0) {
      throw new Error('Không tìm thấy file video nào hợp lệ trên ổ đĩa!');
    }

    console.log(`[Bulk Reels] 📎 Đang tải ${filePaths.length} video lên Meta Business Suite...`);
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePaths);

    // Chờ bảng danh sách video render xong (tùy thuộc số lượng video)
    await page.waitForTimeout(10000);

    // 2. Điền Caption và Đặt lịch / Đăng ngay cho từng Video
    const videoRows = page.locator('table tbody tr, div[role="row"]');
    const rowCount = await videoRows.count().catch(() => 0);
    console.log(`[Bulk Reels] 📋 Phát hiện ${rowCount} dòng video trên giao diện...`);

    for (let i = 0; i < Math.min(items.length, rowCount); i++) {
      const item = items[i];
      const row = videoRows.nth(i);

      // Điền Mô tả (Caption)
      const captionBox = row.locator('textarea, div[contenteditable="true"]').first();
      if (await captionBox.isVisible().catch(() => false)) {
        await captionBox.click().catch(() => {});
        await captionBox.fill(item.caption || '');
        console.log(`[Bulk Reels] ✏️ Đã điền mô tả cho Video #${i + 1}`);
      }

      // Xử lý Lên lịch hoặc Đăng ngay
      const scheduleDropdown = row.locator('div[role="button"]:has-text("Lựa chọn lịch"), div:has-text("Lựa chọn lịch")').first();
      if (await scheduleDropdown.isVisible().catch(() => false)) {
        await scheduleDropdown.click().catch(() => {});
        await page.waitForTimeout(1500);

        if (item.scheduleTime) {
          // Lên lịch
          const scheduleOption = page.locator('div[role="button"]:has-text("Lên lịch"), span:has-text("Lên lịch")').first();
          if (await scheduleOption.isVisible().catch(() => false)) {
            await scheduleOption.click().catch(() => {});
            await page.waitForTimeout(1500);

            // Điền Ngày & Giờ (Ví dụ: 05/08/2026 14:30)
            const dateInput = page.locator('input[placeholder*="M/D/Y"], input[placeholder*="D/M/Y"], input[value*="/"]').first();
            if (await dateInput.isVisible().catch(() => false)) {
              await dateInput.fill(item.scheduleTime.split(' ')[0] || '');
            }
          }
        } else {
          // Đăng ngay
          const publishNowOption = page.locator('div[role="button"]:has-text("Đăng ngay"), span:has-text("Đăng ngay")').first();
          if (await publishNowOption.isVisible().catch(() => false)) {
            await publishNowOption.click().catch(() => {});
            await page.waitForTimeout(1500);
          }
        }

        // Bấm Nút Cập nhật
        const updateBtn = page.locator('button:has-text("Cập nhật"), div[role="button"]:has-text("Cập nhật")').first();
        if (await updateBtn.isVisible().catch(() => false)) {
          await updateBtn.click().catch(() => {});
          await page.waitForTimeout(1000);
        }
      }
    }

    // 3. Bấm Nút ĐĂNG HÀNG LOẠT / LÊN LỊCH ở góc dưới màn hình
    console.log('[Bulk Reels] 🚀 Đang hoàn tất và Bấm Đăng / Lên lịch hàng loạt...');
    const finalSubmitBtn = page.locator('button:has-text("Đăng"), button:has-text("Lên lịch"), div[role="button"]:has-text("Đăng"), div[role="button"]:has-text("Lên lịch")').last();
    if (await finalSubmitBtn.isVisible().catch(() => false)) {
      await finalSubmitBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(15000);
      console.log('[Bulk Reels] ✅ Đã gửi lệnh Tải hàng loạt thành công!');
    }

    const artifactDir = path.join(__dirname, 'debug_output');
    fs.mkdirSync(artifactDir, { recursive: true });
    await page.screenshot({ path: path.join(artifactDir, 'proof_bulk_upload_result.png') });

    await browser.close();
    return { success: true, count: filePaths.length };
  } catch (err) {
    console.error('[Bulk Reels] ❌ Lỗi:', err.message);
    await browser.close();
    return { success: false, error: err.message };
  }
}

module.exports = { bulkUploadReels };
