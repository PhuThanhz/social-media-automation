// Chọn phông nền cho status Facebook (Colored Background Post) theo preset.
//
// Nhận diện ô nền theo "chữ ký" lấy từ style thật của Facebook (dò ngày 25/11/2026 bằng
// scratch/dump-fb-backgrounds.js): màu/gradient của ô trong dải nhanh, hoặc mã ảnh (asset id
// trong URL fbcdn — cố định, chỉ query string là đổi) với các nền ảnh trong bảng "Tùy chọn phông nền".
// aria-label chỉ dùng làm phương án phụ vì đổi theo ngôn ngữ và bị trùng nhau trong bảng đầy đủ.

const FB_BACKGROUND_PRESETS = {
  // Dải nhanh (hiện ngay sau khi bấm "Aa")
  RED: { sig: 'rgb(226, 1, 59)', aria: ['Đỏ đậm', 'Red'] },
  PURPLE: { sig: 'rgb(198, 0, 255)', aria: ['Tím thẫm'] },
  BLACK: { sig: 'rgb(17, 17, 17)', aria: ['Đen sẫm'] },
  GRAD_RED_BLUE: { sig: 'rgb(255, 0, 71), rgb(44, 52, 199)', aria: ['đỏ xanh da trời'] },
  GRAD_PURPLE_PINK: { sig: 'rgb(93, 63, 218), rgb(252, 54, 253)', aria: ['tím đỏ tươi'] },
  GRAD_SUNSET: { sig: '27971368_423110001455136', aria: ['vàng, cam sang hồng'] },
  GRAD_DARK: { sig: 'rgb(93, 99, 116), rgb(22, 24, 29)', aria: ['tối xám đen'] },
  // Bảng đầy đủ (nút lưới "Tùy chọn phông nền" → mục Trang trí)
  RAINBOW: { sig: '386186252_992723418700210', grid: true },
  HEART_RED: { sig: '386756061_861250782379057', grid: true },
  HEART_MAGENTA: { sig: '386758660_732044732068422', grid: true },
  YELLOW: { sig: '387127228_1369831530596424', grid: true },
  MINT: { sig: '386737563_1953054068393012', grid: true },
};

function normalizeBackgroundPreset(value) {
  const key = String(value || '').trim().toUpperCase();
  return FB_BACKGROUND_PRESETS[key] ? key : 'RED';
}

// Bấm ô nền có chữ ký khớp trong mọi dialog đang mở. Trả về mô tả cách bấm hoặc false.
async function clickSwatchBySignature(page, preset) {
  const def = FB_BACKGROUND_PRESETS[preset];
  return page.evaluate(({ sig, aria }) => {
    const styleOf = (el) => {
      const parts = [];
      for (const node of [el, ...Array.from(el.querySelectorAll('*')).slice(0, 12)]) {
        const cs = getComputedStyle(node);
        parts.push(cs.backgroundColor, cs.backgroundImage);
      }
      for (const img of Array.from(el.querySelectorAll('img')).slice(0, 2)) parts.push(img.src);
      return parts.join(' ');
    };
    const buttons = Array.from(document.querySelectorAll('div[role="dialog"] div[role="button"], div[role="dialog"] div[role="radio"]'))
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width >= 20 && r.width <= 100 && r.height >= 20 && r.height <= 100;
      });
    for (const b of buttons) {
      if (styleOf(b).includes(sig)) {
        b.scrollIntoView({ block: 'center' });
        b.click();
        return { method: 'signature', aria: b.getAttribute('aria-label') };
      }
    }
    for (const frag of aria || []) {
      const f = frag.toLowerCase();
      const b = buttons.find((x) => (x.getAttribute('aria-label') || '').toLowerCase().includes(f));
      if (b) {
        b.scrollIntoView({ block: 'center' });
        b.click();
        return { method: 'aria', aria: b.getAttribute('aria-label') };
      }
    }
    return false;
  }, { sig: def.sig, aria: def.aria || [] });
}

async function openBackgroundStrip(dialog, page) {
  const btn = dialog.locator(
    'div[role="button"][aria-label*="Hiển thị các tùy chọn phông nền" i], ' +
    'div[role="button"][aria-label*="Show background options" i], ' +
    'div[aria-label*="Hiển thị tùy chọn phông nền" i], ' +
    'div[role="button"]:has-text("Aa")'
  ).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1200);
  }
}

async function openBackgroundGrid(page) {
  const btn = page.locator(
    'div[role="dialog"] div[role="button"][aria-label="Tùy chọn phông nền" i], ' +
    'div[role="dialog"] div[role="button"][aria-label="Background options" i]'
  ).first();
  if (!(await btn.isVisible().catch(() => false))) return false;
  await btn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(2000);
  return true;
}

// Chọn phông nền theo preset. Không phải RED mà không tìm được ô → rơi về `fallbackRed` (hàm chọn
// nền đỏ cũ) để bài vẫn ra status nền màu thay vì chữ trơn.
async function selectFacebookBackground(dialog, page, presetValue, fallbackRed) {
  const preset = normalizeBackgroundPreset(presetValue);
  if (preset === 'RED') return fallbackRed(dialog, page);
  console.log(`[Playwright] 🎨 Đang chọn phông nền ${preset}...`);
  try {
    await openBackgroundStrip(dialog, page);
    let picked = false;
    if (!FB_BACKGROUND_PRESETS[preset].grid) {
      picked = await clickSwatchBySignature(page, preset);
    }
    if (!picked && (await openBackgroundGrid(page))) {
      picked = await clickSwatchBySignature(page, preset);
    }
    if (picked) {
      console.log(`[Playwright] ✅ Đã chọn nền ${preset} (phương thức: ${JSON.stringify(picked)})`);
      await page.waitForTimeout(1500);
      return true;
    }
    console.warn(`[Playwright] ⚠️ Không tìm thấy ô nền ${preset} — chuyển sang nền đỏ mặc định.`);
    // Bảng đầy đủ có thể đang mở → quay lại composer trước khi chọn đỏ.
    const back = page.locator('div[role="dialog"] div[role="button"][aria-label="Quay lại" i], div[role="dialog"] div[role="button"][aria-label="Back" i]').first();
    if (await back.isVisible().catch(() => false)) {
      await back.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1000);
    }
  } catch (e) {
    console.warn(`[Playwright] ⚠️ Lỗi khi chọn nền ${preset}:`, e.message);
  }
  return fallbackRed(dialog, page);
}

module.exports = { FB_BACKGROUND_PRESETS, normalizeBackgroundPreset, selectFacebookBackground };
