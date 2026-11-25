// HTML "Ảnh chữ": chữ trên nền theo một trong vài bố cục. Cùng một chuỗi HTML dùng cho xem trước (iframe)
// và cho worker render (POST /news-card/render { html } → worker/news-card.js#renderNewsCardHtml chụp #card,
// chờ window.__fitDone).

export const TEXT_CARD_FONTS = [
  { key: 'be', label: 'Be Vietnam', family: "'Be Vietnam Pro'", google: 'Be+Vietnam+Pro:wght@500;700;800' },
  { key: 'montserrat', label: 'Montserrat', family: "'Montserrat'", google: 'Montserrat:wght@500;700;800' },
  { key: 'playfair', label: 'Playfair', family: "'Playfair Display'", google: 'Playfair+Display:wght@500;700;800' },
  { key: 'dancing', label: 'Viết tay', family: "'Dancing Script'", google: 'Dancing+Script:wght@500;700' },
  { key: 'patrick', label: 'Bút bi', family: "'Patrick Hand'", google: 'Patrick+Hand' },
] as const;

export const TEXT_CARD_LAYOUTS = [
  { key: 'center', label: 'Nổi bật' },
  { key: 'quote', label: 'Trích dẫn' },
  { key: 'card', label: 'Thẻ' },
  { key: 'headline', label: 'Tiêu đề' },
] as const;

export type TextCardLayout = (typeof TEXT_CARD_LAYOUTS)[number]['key'];
export type TextCardRatio = '1:1' | '4:5';

export interface TextCardOptions {
  text: string;
  background: string; // giá trị CSS `background`
  textColor: string;
  fontKey: string;
  ratio: TextCardRatio;
  align: 'center' | 'left';
  layout?: TextCardLayout;
  signature?: string;
}

export const TEXT_CARD_WIDTH = 1080;
export const textCardHeight = (ratio: TextCardRatio) => (ratio === '4:5' ? 1350 : 1080);
/** Bố cục tự canh trái/giữa theo kiểu, không dùng tùy chọn căn lề */
export const layoutHasAlign = (layout: TextCardLayout) => layout === 'center' || layout === 'card';

/** URL Google Fonts cho mọi font của Ảnh chữ (dùng để hiện chữ mẫu trong app) */
export const TEXT_CARD_FONTS_HREF =
  'https://fonts.googleapis.com/css2?' + TEXT_CARD_FONTS.map((f) => `family=${f.google}`).join('&') + '&display=swap&subset=vietnamese';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// [[cụm từ]] → tô màu nhấn. Mỗi dòng gốc là 1 khối riêng để `text-wrap: balance` cân từng dòng
// (Chrome chỉ cân đoạn ≤ 6 dòng) — tránh 1 chữ lẻ loi rớt xuống dòng cuối.
const formatText = (text: string, accent: string) =>
  text.trim().split(/\r?\n/).map((line) => {
    if (!line.trim()) return '<div class="gap"></div>';
    const html = escapeHtml(line.trim())
      .replace(/\[\[([\s\S]*?)\]\]/g, `<span style="color:${accent}">$1</span>`)
      .replace(/\[\[|\]\]/g, '');
    return `<div class="ln">${html}</div>`;
  }).join('');

// Tách tiêu đề cho bố cục "Tiêu đề": dòng đầu, không thì câu đầu
const splitHeadline = (text: string): [string, string] => {
  const t = text.trim();
  const nl = t.indexOf('\n');
  if (nl > 0) return [t.slice(0, nl).trim(), t.slice(nl + 1).trim()];
  const m = t.match(/^(.{12,}?[.!?…])\s+(.+)$/s);
  return m ? [m[1], m[2]] : [t, ''];
};

// Cỡ chữ khởi điểm theo độ dài (rồi script co lại cho vừa khung) — chữ ngắn to, chữ dài vừa phải
const baseSize = (len: number) => (len <= 30 ? 120 : len <= 70 ? 98 : len <= 130 ? 80 : len <= 220 ? 66 : 56);

const isLight = (c: string) => ['#ffffff', '#fff', '#f4f4f0'].includes(c.toLowerCase());

export function buildTextCardHtml(o: TextCardOptions): string {
  const font = TEXT_CARD_FONTS.find((f) => f.key === o.fontKey) || TEXT_CARD_FONTS[0];
  const layout: TextCardLayout = o.layout || 'center';
  const h = textCardHeight(o.ratio);
  const text = (o.text || '').trim() || ' ';
  const signature = (o.signature || '').trim();
  const plainLen = text.replace(/\[\[|\]\]/g, '').length;
  const size = baseSize(plainLen);
  const handwritten = font.key === 'dancing' || font.key === 'patrick';
  const heavy = handwritten ? 700 : 800;

  // Bố cục "Thẻ": chữ tối trên thẻ sáng, bất kể nền
  const color = layout === 'card' ? '#1c1f26' : o.textColor;
  const light = isLight(color);
  const accent = light ? '#ffd43b' : '#e3151a';
  const shadow = light ? '0 2px 18px rgba(0,0,0,.22)' : 'none';
  const align = layoutHasAlign(layout) ? o.align : 'left';
  const sigHtml = signature
    ? `<div id="sig"><span class="sig-bar"></span>${escapeHtml(signature)}</div>`
    : '';

  let inner = '';
  let css = '';
  if (layout === 'quote') {
    inner = `<div id="mark">“</div><div class="t" data-fs="${Math.round(size * 0.86)}" style="font-weight:700;line-height:1.36">${formatText(text, accent)}</div>${sigHtml}`;
    css = `#fit{inset:120px 116px 110px}#mark{font-family:Georgia,'Times New Roman',serif;font-size:250px;line-height:.78;height:150px;color:${accent};margin-left:-8px}`;
  } else if (layout === 'headline') {
    const [head, body] = splitHeadline(text);
    inner = `<div id="bar"></div><div class="t" data-fs="${Math.round(size * 1.02)}" style="font-weight:${heavy};line-height:1.16;letter-spacing:-.8px">${formatText(head, accent)}</div>` +
      (body ? `<div class="t" data-fs="${Math.round(size * 0.6)}" style="font-weight:500;line-height:1.5;margin-top:40px;opacity:.92">${formatText(body, accent)}</div>` : '') +
      sigHtml;
    css = `#fit{inset:130px 110px 120px}#bar{width:96px;height:12px;border-radius:6px;background:${accent};margin-bottom:48px}`;
  } else if (layout === 'card') {
    inner = `<div class="t" data-fs="${Math.round(size * 0.86)}" style="font-weight:${heavy};line-height:1.28">${formatText(text, accent)}</div>${sigHtml}`;
    css = `#panel{position:absolute;inset:${o.ratio === '4:5' ? '120px 84px' : '96px 84px'};background:rgba(255,255,255,.95);border-radius:40px;box-shadow:0 36px 90px rgba(0,0,0,.28)}` +
      `#fit{inset:${o.ratio === '4:5' ? '200px 160px' : '176px 160px'}}`;
  } else {
    inner = `<div class="t" data-fs="${size}" style="font-weight:${heavy};line-height:1.22;letter-spacing:-.6px">${formatText(text, accent)}</div>${sigHtml}`;
    css = `#fit{inset:150px 120px}`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${font.google}&display=block&subset=vietnamese"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${TEXT_CARD_WIDTH}px;height:${h}px;overflow:hidden;background:transparent}
#card{position:relative;width:${TEXT_CARD_WIDTH}px;height:${h}px;background:${o.background};overflow:hidden}
#fit{position:absolute;display:flex;flex-direction:column;justify-content:center}
#inner{width:100%;text-align:${align}}
.ln{text-wrap:balance}.gap{height:.55em}
.t{font-family:${font.family},sans-serif;color:${color};word-break:break-word;text-wrap:balance;text-shadow:${shadow}}
#sig{margin-top:56px;display:flex;align-items:center;gap:18px;justify-content:${align === 'center' ? 'center' : 'flex-start'};font-family:${font.family},sans-serif;font-size:32px;font-weight:600;color:${color};opacity:.85;text-shadow:${shadow}}
.sig-bar{display:inline-block;width:44px;height:4px;border-radius:2px;background:${accent}}
${css}
</style></head><body>
<div id="card">${layout === 'card' ? '<div id="panel"></div>' : ''}<div id="fit"><div id="inner">${inner}</div></div></div>
<script>
(async function(){
  try { await Promise.race([document.fonts.ready, new Promise(function(r){setTimeout(r,4000)})]); } catch(e) {}
  var fit=document.getElementById('fit'), inner=document.getElementById('inner');
  var els=[].slice.call(document.querySelectorAll('[data-fs]'));
  function apply(s){ els.forEach(function(e){ e.style.fontSize=Math.max(22,Math.round(+e.getAttribute('data-fs')*s))+'px'; }); }
  var s=1; apply(s);
  while ((inner.offsetHeight>fit.clientHeight || inner.scrollWidth>fit.clientWidth) && s>0.3) { s-=0.03; apply(s); }
  window.__fitDone=true;
})();
</script></body></html>`;
}
