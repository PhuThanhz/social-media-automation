// Tạo ảnh "thẻ tin tức" kiểu page tin giật tít: ảnh gốc phía trên, dải trắng phía dưới với tiêu đề
// IN HOA đậm, các cụm bọc trong [[...]] được tô đỏ. Tuỳ chọn thêm 1 ảnh nhỏ trong khung tròn viền đỏ
// ở góc trên trái. Dựng bằng HTML rồi chụp lại bằng Playwright (không cần thêm thư viện xử lý ảnh).

const CARD_SIZE = 1440;
const MAX_HTML_HEIGHT = 2000;

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// "MỘT [[ỨNG DỤNG]] GIÚP..." → HTML với <span class="hl"> cho phần trong [[ ]]; giữ xuống dòng thủ công
function headlineToHtml(headline) {
  const parts = String(headline || '').split(/(\[\[[\s\S]*?\]\])/g);
  return parts.map((part) => {
    const m = part.match(/^\[\[([\s\S]*?)\]\]$/);
    const text = escapeHtml(m ? m[1] : part).replace(/\n/g, '<br/>');
    return m ? `<span class="hl">${text}</span>` : text;
  }).join('');
}

function buildNewsCardHtml({ imageDataUri, insetDataUri, headline }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@800;900&display=block&subset=vietnamese" rel="stylesheet"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${CARD_SIZE}px; height: ${CARD_SIZE}px; background: #fff; overflow: hidden; }
  #card { position: relative; width: ${CARD_SIZE}px; height: ${CARD_SIZE}px; display: flex; flex-direction: column; background: #fff; }
  #photo { flex: 1 1 auto; min-height: 0; background: #111 center/cover no-repeat; }
  #text {
    flex: 0 0 auto; padding: 44px 56px 52px; text-align: center;
    font-family: 'Montserrat', 'Arial Black', 'Helvetica Neue', Arial, sans-serif;
    font-weight: 900; text-transform: uppercase; color: #111; line-height: 1.2; letter-spacing: -0.5px;
    word-break: break-word;
  }
  #text .hl { color: #e3151a; }
  #inset {
    position: absolute; left: 40px; top: 40px; width: 380px; height: 380px; border-radius: 50%;
    border: 12px solid #e3151a; background: #222 center/cover no-repeat; box-shadow: 0 6px 24px rgba(0,0,0,.35);
  }
</style></head>
<body>
  <div id="card">
    <div id="photo" style="background-image:url('${imageDataUri}')"></div>
    <div id="text">${headlineToHtml(headline)}</div>
    ${insetDataUri ? `<div id="inset" style="background-image:url('${insetDataUri}')"></div>` : ''}
  </div>
</body></html>`;
}

// Co cỡ chữ cho vừa: tối đa ~4 dòng, dải chữ không chiếm quá ~32% chiều cao ảnh
async function fitHeadline(page) {
  await page.evaluate(() => {
    const el = document.getElementById('text');
    const maxHeight = 1440 * 0.32;
    let size = 84;
    el.style.fontSize = size + 'px';
    const lines = () => Math.round((el.scrollHeight - 96) / (size * 1.2));
    while (size > 40 && (el.offsetHeight > maxHeight || lines() > 4)) {
      size -= 2;
      el.style.fontSize = size + 'px';
    }
  });
}

async function toDataUri(url, downloadMedia) {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  const result = await downloadMedia(null, url);
  const contentType = (result.contentType || '').split(';')[0] || 'image/jpeg';
  return `data:${contentType.startsWith('image/') ? contentType : 'image/jpeg'};base64,${result.buffer.toString('base64')}`;
}

/** Trả về Buffer PNG 1440x1440. */
async function renderNewsCard({ imageUrl, insetImageUrl, headline }, { browserPool, downloadMedia }) {
  if (!imageUrl) throw new Error('Thiếu ảnh chính (imageUrl)');
  if (!headline || !String(headline).trim()) throw new Error('Thiếu tiêu đề (headline)');

  const [imageDataUri, insetDataUri] = await Promise.all([
    toDataUri(imageUrl, downloadMedia),
    insetImageUrl ? toDataUri(insetImageUrl, downloadMedia).catch(() => null) : Promise.resolve(null),
  ]);

  const { context, release } = await browserPool.acquireContext({ viewport: { width: CARD_SIZE, height: CARD_SIZE } });
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: CARD_SIZE, height: CARD_SIZE });
    await page.setContent(buildNewsCardHtml({ imageDataUri, insetDataUri, headline }), { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    // Đợi font tiếng Việt tải xong (tối đa 5s), không có mạng thì dùng font dự phòng
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 5000))]));
    await fitHeadline(page);
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: CARD_SIZE, height: CARD_SIZE } });
    await page.close().catch(() => {});
    return png;
  } finally {
    await release();
  }
}

/**
 * Dựng ảnh từ chuỗi HTML do frontend tạo (frontend/src/utils/newsCardTemplate.ts) — cùng HTML với preview.
 * Ảnh trong HTML được tải qua downloadMedia (né chặn hotlink), chỉ cho phép font Google; chặn mọi request khác.
 */
async function renderNewsCardHtml(html, { browserPool, downloadMedia }) {
  if (!html || typeof html !== 'string') throw new Error('Thiếu HTML mẫu ảnh');
  // Khung có thể vuông (1440×1440), dọc 4:5 (1440×1800) hoặc khung video 9:16 (1080×1920) — mở viewport đủ lớn rồi đo #card để cắt
  const { context, release } = await browserPool.acquireContext({ viewport: { width: CARD_SIZE, height: MAX_HTML_HEIGHT } });
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: CARD_SIZE, height: MAX_HTML_HEIGHT });
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = req.url();
      if (!/^https?:/i.test(url)) return route.continue();
      if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
      if (req.resourceType() === 'image') {
        try {
          const media = await downloadMedia(null, url);
          return route.fulfill({ status: 200, contentType: media.contentType || 'image/jpeg', body: media.buffer });
        } catch (e) {
          console.warn('[NewsCard] ⚠️ Lỗi tải ảnh qua downloadMedia:', url, e.message);
          return route.continue().catch(() => route.abort());
        }
      }
      return route.abort();
    });
    await page.setContent(html, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
    await page.waitForFunction(() => window.__fitDone === true, null, { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete), null, { timeout: 15000 }).catch(() => {});
    const box = await page.evaluate(() => {
      const el = document.getElementById('card');
      if (!el) return null;
      // Vùng ảnh (#photos) tính theo % khung — Studio Video Tin dùng để đặt video vào đúng chỗ
      const ph = document.getElementById('photos');
      const r = ph ? ph.getBoundingClientRect() : null;
      const c = el.getBoundingClientRect();
      const photo = r && c.height > 0
        ? { topPct: ((r.top - c.top) / c.height) * 100, heightPct: (r.height / c.height) * 100 }
        : null;
      return { w: el.offsetWidth, h: el.offsetHeight, photo };
    });
    const width = Math.min(box?.w || CARD_SIZE, 2000);
    const height = Math.min(box?.h || CARD_SIZE, MAX_HTML_HEIGHT);
    const png = await page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width, height } });
    await page.close().catch(() => {});
    if (box && box.photo) png.photo = box.photo;
    return png;
  } finally {
    await release();
  }
}

/**
 * Studio Video: dựng nhiều lớp (chữ, phụ đề, logo...) trong 1 trang cho nhanh. Mỗi HTML là khung trong suốt đủ cỡ;
 * chỉ chụp vùng phần tử #layer (cộng lề cho bóng chữ) để FFmpeg chồng ảnh nhỏ thay vì ảnh full khung.
 * Không có #layer thì chụp cả #card. Trả về [{ png, x, y, w, h }] theo đúng thứ tự.
 */
async function renderHtmlLayers(htmls, { browserPool, downloadMedia }) {
  if (!Array.isArray(htmls) || !htmls.length) return [];
  const { context, release } = await browserPool.acquireContext({ viewport: { width: CARD_SIZE, height: MAX_HTML_HEIGHT } });
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: CARD_SIZE, height: MAX_HTML_HEIGHT });
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = req.url();
      if (!/^https?:/i.test(url)) return route.continue();
      if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
      if (req.resourceType() === 'image') {
        try {
          const media = await downloadMedia(null, url);
          return route.fulfill({ status: 200, contentType: media.contentType || 'image/png', body: media.buffer });
        } catch (e) {
          return route.continue().catch(() => route.abort());
        }
      }
      return route.abort();
    });
    const out = [];
    for (const html of htmls) {
      await page.setContent(String(html || ''), { waitUntil: 'load', timeout: 45000 }).catch(() => {});
      await page.waitForFunction(() => window.__fitDone === true, null, { timeout: 15000 }).catch(() => {});
      await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete), null, { timeout: 15000 }).catch(() => {});
      const box = await page.evaluate(() => {
        const card = document.getElementById('card');
        const el = document.getElementById('layer') || card;
        if (!el || !card) return null;
        const c = card.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return { cw: card.offsetWidth, ch: card.offsetHeight, x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height, isCard: el === card };
      });
      if (!box || box.w < 1 || box.h < 1) { out.push(null); continue; }
      const pad = box.isCard ? 0 : 24;
      const x = Math.max(0, Math.floor(box.x - pad));
      const y = Math.max(0, Math.floor(box.y - pad));
      const w = Math.min(box.cw, Math.ceil(box.x + box.w + pad)) - x;
      const h = Math.min(box.ch, MAX_HTML_HEIGHT, Math.ceil(box.y + box.h + pad)) - y;
      if (w < 1 || h < 1) { out.push(null); continue; }
      const png = await page.screenshot({ type: 'png', omitBackground: true, clip: { x, y, width: w, height: h } });
      out.push({ png, x, y, w, h });
    }
    await page.close().catch(() => {});
    return out;
  } finally {
    await release();
  }
}

module.exports = { renderNewsCard, renderNewsCardHtml, renderHtmlLayers, buildNewsCardHtml, headlineToHtml };
