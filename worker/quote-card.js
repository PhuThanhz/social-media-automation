/**
 * Module tự động tạo ảnh "Text Quote Card" nền đen chữ trắng (chuẩn style BOX Y Khoa / Viral Facebook)
 * dành cho các bài viết dạng text ngắn (<= 200 ký tự) không kèm media.
 */
const browserPool = require('./browserPool');

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 900;

const escapeHtml = (s) => String(s || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function formatQuoteText(text) {
  let clean = String(text || '').trim();
  // Bỏ bớt link nếu có trong text
  clean = clean.replace(/https?:\/\/\S+/gi, '').trim();
  
  // Nếu chưa có dấu ngoặc kép thì thêm vào cho chuẩn quote viral
  const hasOpeningQuote = clean.startsWith('“') || clean.startsWith('"') || clean.startsWith('«');
  const hasClosingQuote = clean.endsWith('”') || clean.endsWith('"') || clean.endsWith('»');
  
  if (!hasOpeningQuote && !hasClosingQuote && clean.length > 0) {
    clean = `“${clean}”`;
  }
  
  return escapeHtml(clean).replace(/\n+/g, '<br/>');
}

function calculateFontSize(textLength) {
  if (textLength <= 50) return '64px';
  if (textLength <= 100) return '54px';
  if (textLength <= 150) return '48px';
  if (textLength <= 210) return '42px';
  return '36px';
}

function buildQuoteCardHtml(text) {
  const textLength = String(text || '').trim().length;
  const fontSize = calculateFontSize(textLength);
  const formattedHtml = formatQuoteText(text);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: ${CARD_WIDTH}px;
      height: ${CARD_HEIGHT}px;
      background-color: #18191a;
      overflow: hidden;
    }
    #quote-container {
      width: ${CARD_WIDTH}px;
      height: ${CARD_HEIGHT}px;
      background-color: #18191a;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 80px 100px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    .quote-text {
      color: #ffffff;
      font-size: ${fontSize};
      font-weight: 700;
      line-height: 1.45;
      text-align: center;
      letter-spacing: -0.4px;
      word-break: break-word;
      text-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
    }
  </style>
</head>
<body>
  <div id="quote-container">
    <div class="quote-text">${formattedHtml}</div>
  </div>
</body>
</html>`;
}

/**
 * Render ảnh Quote Card từ chuỗi text ngắn. Trả về Buffer ảnh PNG 1200x900.
 */
async function renderDarkQuoteCard(text) {
  if (!text || !String(text).trim()) return null;

  const html = buildQuoteCardHtml(text);
  const { context, release } = await browserPool.acquireContext({
    viewport: { width: CARD_WIDTH, height: CARD_HEIGHT }
  });

  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: CARD_WIDTH, height: CARD_HEIGHT });
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
    
    // Chờ font load xong
    await page.evaluate(() => Promise.race([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      new Promise((r) => setTimeout(r, 1500))
    ])).catch(() => {});

    const png = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT }
    });

    await page.close().catch(() => {});
    return png;
  } finally {
    await release();
  }
}

module.exports = {
  renderDarkQuoteCard,
  formatQuoteText,
  buildQuoteCardHtml
};

