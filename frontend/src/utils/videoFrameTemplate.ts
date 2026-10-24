// Khung tiêu đề nền trong suốt đặt chồng lên video (Studio Video Tin). Cùng 1 HTML dùng cho preview (iframe)
// và cho worker chụp thành PNG (worker/news-card.js → renderNewsCardHtml đo #card để cắt).
// Hai kiểu:
// - band: dải tiêu đề đè lên video vài giây đầu rồi mờ đi
// - panel: nền blur, bảng nổi bo góc (logo + tên page + tiêu đề) phía trên, video nằm giữa — hiện suốt video
import { normalizeHeadlineSpaces } from './newsCardTemplate';
import { DT_PHUDU_BASE64 } from './phuduFontBase64';

export type VideoRatio = '9:16' | '1:1' | '4:5';
export type BandPosition = 'top' | 'center' | 'bottom';
export type FrameLayout = 'panel' | 'band' | 'card' | 'news';
export type TransitionEffect = 'fade' | 'slidedown' | 'slideup' | 'wipeleft' | 'zoomin';

export const TRANSITION_OPTIONS: Array<{ value: TransitionEffect; label: string }> = [
  { value: 'slidedown', label: 'Trượt xuống (Slide Down)' },
  { value: 'fade', label: 'Mờ dần (Crossfade)' },
  { value: 'slideup', label: 'Trượt lên (Slide Up)' },
  { value: 'wipeleft', label: 'Gạt sang trái (Wipe Left)' },
  { value: 'zoomin', label: 'Phóng to thu nhỏ (Zoom)' },
];

export const VIDEO_W = 1080;
export const videoHeight = (r: VideoRatio) => (r === '1:1' ? 1080 : r === '4:5' ? 1350 : 1920);

export interface VideoFrameStyle {
  layout: FrameLayout;
  ratio: VideoRatio;
  position: BandPosition; // chỉ dùng cho band và card
  bandBg: string;
  textColor: string;
  accent: string;
  badgeText: string;
  logoUrl: string;
  pageName: string; // tên page in trên bảng (panel)
  uppercase: boolean;
  fontScale: number; // 0.8 – 1.3
  decorColor: string; // màu nền trang trí đáy (kiểu card)
  decorUrl: string; // ảnh trang trí đáy riêng (PNG trong suốt); '' = chỉ dải màu chuyển, không họa tiết
  decorGradient: boolean; // giữ dải màu chuyển phía sau ảnh trang trí riêng
  cardAlign: 'center' | 'left'; // căn chữ trong thẻ nổi
  newsSource: string; // kiểu news: 'default' | 'preset:<tên>' | 'frame:<id>' (mẫu/khung bên Studio Ảnh Tin)
  videoFit: 'cover' | 'contain'; // kiểu panel: lấp kín phần trên (cắt viền) hay hiện trọn clip (nền blur)
  transitionEffect: TransitionEffect;
  videoFocusY: number; // 0 - 100%, mặc định 50
  videoOffsetY: number; // % dời clip lên/xuống (như CapCut): âm là kéo lên cao (-15%), dương là hạ xuống (+10%). Mặc định 0
  videoScale: number; // độ thu phóng video: 0.5 - 3.0, mặc định 1.0 (100%)
  cardOffsetY: number; // dời card lên/xuống (% chiều cao khung): âm = lên cao, dương = xuống thấp. Mặc định 0
  cardScale: number;   // phóng to/thu nhỏ card: 0.6 - 1.4. Mặc định 1.0
}

export const DEFAULT_VIDEO_FRAME: VideoFrameStyle = {
  layout: 'panel',
  ratio: '9:16',
  position: 'center',
  bandBg: '#ffffff',
  textColor: '#111111',
  accent: '#e3151a',
  badgeText: 'TIN NÓNG',
  logoUrl: '',
  pageName: '',
  uppercase: true,
  fontScale: 1,
  decorColor: '#b44be0',
  decorUrl: '',
  decorGradient: true,
  videoFit: 'contain', // hiện trọn clip chuẩn ở giữa màn hình (nền blur trên/dưới)
  newsSource: 'default',
  cardAlign: 'center',
  transitionEffect: 'slidedown',
  videoFocusY: 50,
  videoOffsetY: 0,
  videoScale: 1,
  cardOffsetY: 0,
  cardScale: 1,
};

/** Vùng đặt video chính, % chiều cao khung (backend dùng cùng số để ghép bằng FFmpeg) */
export const videoRegion = (s: VideoFrameStyle, sourceAspect = 9 / 16): { topPct: number; heightPct: number } => {
  // Thẻ nổi: video giữ nguyên kích thước đầy đủ (100%), người dùng có thể kéo dời clip lên cao (videoOffsetY) như CapCut
  if (s.layout === 'card') {
    return { topPct: 0, heightPct: 100 };
  }
  // Mẫu Studio Ảnh Tin: vùng ảnh đo thật từ HTML (preview đo trong iframe, backend lấy số đo của worker)
  if (s.layout === 'news') return { topPct: 0, heightPct: 68 };
  if (s.layout !== 'panel') return { topPct: 0, heightPct: 100 };
  return panelLayout(s, sourceAspect).region;
};

/**
 * Bố cục kiểu "Dải dưới" (% chiều cao khung):
 * - 9:16 + clip dọc: video phủ kín màn hình điện thoại, dải chữ đè phần dưới video
 * - 9:16 + clip ngang/vuông: video rộng hết màn hình + dải chữ dính ngay dưới, cả khối canh giữa, trên/dưới là nền blur
 * - 1:1 / 4:5 (kiểu Studio Ảnh Tin): video ôm sát chiều cao clip ở trên, dải chữ lấp phần còn lại
 */
export const panelLayout = (s: VideoFrameStyle, sourceAspect: number) => {
  const maxPct = s.ratio === '9:16' ? 66 : s.ratio === '4:5' ? 64 : 62;
  const fitPct = ((VIDEO_W / Math.max(sourceAspect, 0.2)) / videoHeight(s.ratio)) * 100;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  if (s.ratio === '9:16') {
    if (s.videoFit === 'cover') return { region: { topPct: 0, heightPct: maxPct }, panelTopPct: maxPct, panelHPct: 100 - maxPct, toBottom: true };
    if (fitPct >= 85) return { region: { topPct: 0, heightPct: 100 }, panelTopPct: maxPct, panelHPct: 100 - maxPct, toBottom: true };
    const regionH = Math.min(fitPct, 60);
    const bandPct = 28;
    const top = Math.max(3, (100 - regionH - bandPct) / 2 - 4); // hơi lệch lên vì đáy bị giao diện TikTok che
    return { region: { topPct: r2(top), heightPct: r2(regionH) }, panelTopPct: r2(top + regionH), panelHPct: bandPct, toBottom: false };
  }
  if (s.videoFit === 'cover') return { region: { topPct: 0, heightPct: maxPct }, panelTopPct: maxPct, panelHPct: 100 - maxPct, toBottom: true };
  const h = r2(Math.max(50, Math.min(maxPct, fitPct)));
  return { region: { topPct: 0, heightPct: h }, panelTopPct: h, panelHPct: 100 - h, toBottom: true };
};

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const headlineHtml = (headline: string) =>
  normalizeHeadlineSpaces(headline)
    .split(/(\[\[[\s\S]*?\]\])/g)
    .map((part) => {
      const m = part.match(/^\[\[([\s\S]*?)\]\]$/);
      const text = esc(m ? m[1] : part).replace(/\n/g, '<br/>');
      return m ? `<span class="hl">${text}</span>` : text;
    })
    .join('');

/** Tiêu đề để đọc: bỏ [[ ]] và xuống dòng */
export const speakableHeadline = (h: string) => String(h || '').replace(/\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim();

/** Bảng kính mờ: nền rgba trong suốt (nền blur của video lộ qua), viền sáng mảnh, chữ có bóng để dễ đọc */
export const isGlassBg = (bg: string) => {
  const m = String(bg).match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)$/i);
  return !!m && parseFloat(m[1]) < 0.7;
};

export const GLASS_PRESETS: Array<{ label: string; bandBg: string; textColor: string; accent: string }> = [
  { label: 'Kính tối · Vàng', bandBg: 'rgba(8,10,16,0.38)', textColor: '#ffffff', accent: '#ffd400' },
  { label: 'Kính tối · Đỏ', bandBg: 'rgba(8,10,16,0.38)', textColor: '#ffffff', accent: '#ff4d4f' },
  { label: 'Kính tối · Cam', bandBg: 'rgba(8,10,16,0.38)', textColor: '#ffffff', accent: '#ff9f1a' },
  { label: 'Kính sáng · Vàng', bandBg: 'rgba(255,255,255,0.18)', textColor: '#ffffff', accent: '#ffd400' },
  { label: 'Kính sáng · Xanh', bandBg: 'rgba(255,255,255,0.18)', textColor: '#ffffff', accent: '#5ec8ff' },
];

const glassCss = (s: VideoFrameStyle) =>
  isGlassBg(s.bandBg)
    ? 'border: 2px solid rgba(255,255,255,.42); box-shadow: 0 18px 50px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.35); text-shadow: 0 2px 10px rgba(0,0,0,.45);'
    : '';

const readableOn = (hex: string) => {
  const m = String(hex).match(/^#([0-9a-f]{6})/i);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#111111' : '#ffffff';
};

const head = (H: number, css: string) => `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  @font-face { font-family: 'DT Phudu'; font-style: normal; font-weight: 700 900; font-display: block;
    src: url('data:font/otf;base64,${DT_PHUDU_BASE64}') format('opentype'); }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${VIDEO_W}px; height: ${H}px; background: transparent; overflow: hidden; }
  #card { position: relative; width: ${VIDEO_W}px; height: ${H}px; background: transparent; }
  ${css}
</style></head>`;

// Co cỡ chữ cho vừa: tối đa maxLines dòng và chiều cao hộp không vượt maxH
const fitScript = (startSize: number, maxH: number, maxLines: number, lineHeight: number) => `
  <script>
    (function () {
      function fit() {
        var el = document.getElementById('headline');
        var box = document.getElementById('fitbox');
        var size = ${startSize};
        el.style.fontSize = size + 'px';
        var lines = function () { return Math.round(el.offsetHeight / (size * ${lineHeight})); };
        while (size > 30 && (box.offsetHeight > ${maxH} || lines() > ${maxLines})) { size -= 2; el.style.fontSize = size + 'px'; }
        window.__fitDone = true;
      }
      var timeout = new Promise(function (r) { setTimeout(r, 5000); });
      Promise.race([document.fonts.ready, timeout]).then(fit);
    })();
  </script>`;

function buildPanelHtml(headline: string, s: VideoFrameStyle, creditText: string, sourceAspect: number): string {
  const H = videoHeight(s.ratio);
  const lay = panelLayout(s, sourceAspect);
  const region = lay.region;
  const regionBottom = Math.round((H * (region.topPct + region.heightPct)) / 100);
  const tall = s.ratio === '9:16';
  const panelTop = Math.round((H * lay.panelTopPct) / 100);
  const panelH = Math.round((H * lay.panelHPct) / 100);
  // Dải chạm đáy khung dọc: chừa chỗ cho giao diện TikTok/Reels; dải canh giữa thì không cần
  const padBottom = tall && lay.toBottom ? 190 : tall ? 40 : 48;
  // Dải chữ cao hơn → chữ khởi điểm to hơn (script fit sẽ co lại nếu tràn)
  const startSize = Math.round(Math.min(96, Math.max(60, (panelH - padBottom) * 0.15)) * s.fontScale);
  const accentText = readableOn(s.accent);
  const glass = isGlassBg(s.bandBg);
  const name = s.pageName.trim();
  const logo = s.logoUrl
    ? `<div id="logo" style="background-image:url('${esc(s.logoUrl)}')"></div>`
    : name ? `<div id="logo" class="initial">${esc(name.slice(0, 1).toUpperCase())}</div>` : '';
  const badge = s.badgeText.trim() ? `<span id="badge">${esc(s.badgeText.trim())}</span>` : '';
  const headerRow = logo || name || badge
    ? `<div id="hdr">${logo}${name ? `<div id="name">${esc(name)}</div>` : ''}${badge}</div>`
    : '';
  const credit = creditText.trim() ? `<div id="credit">${esc(creditText.trim())}</div>` : '';

  const css = `
  #panel {
    position: absolute; left: 0; right: 0; top: ${panelTop}px; height: ${panelH}px;
    background: ${s.bandBg}; color: ${s.textColor}; border-top: 10px solid ${s.accent};
    display: flex; align-items: center; justify-content: center; padding: 30px 60px ${padBottom}px;
    ${glass ? 'box-shadow: inset 0 2px 0 rgba(255,255,255,.35); text-shadow: 0 2px 10px rgba(0,0,0,.45);' : ''}
  }
  #fitbox { width: 100%; text-align: center; }
  #hdr { display: flex; align-items: center; justify-content: center; gap: 18px; margin-bottom: 22px; }
  #logo { width: 76px; height: 76px; flex: 0 0 auto; border-radius: 50%; background: #fff center/cover no-repeat; border: 4px solid ${s.accent}; }
  #logo.initial { display: flex; align-items: center; justify-content: center; background: ${s.accent}; color: ${accentText};
    font: 900 42px/1 'DT Phudu', 'Montserrat', Arial, sans-serif; text-shadow: none; }
  #name { font: 800 38px/1.1 'DT Phudu', 'Montserrat', Arial, sans-serif; letter-spacing: .3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 620px; }
  #badge { display: inline-block; padding: 8px 16px 6px; border-radius: 8px; background: ${s.accent}; color: ${accentText};
    font: 800 26px/1 'DT Phudu', 'Montserrat', Arial, sans-serif; letter-spacing: 1px; text-transform: uppercase; text-shadow: none; }
  #headline {
    font-family: 'DT Phudu', 'Montserrat', 'Arial Black', sans-serif; font-weight: 800; line-height: 1.2; letter-spacing: -0.3px;
    ${s.uppercase ? 'text-transform: uppercase;' : ''} word-break: break-word;
  }
  #headline .hl { color: ${s.accent}; }
  #credit {
    position: absolute; right: 36px; top: ${Math.min(regionBottom, panelTop) - 66}px; text-align: right; color: #fff;
    font: 700 30px/1.3 'DT Phudu', 'Montserrat', Arial, sans-serif; text-shadow: 0 2px 10px rgba(0,0,0,.75);
  }`;

  return `${head(H, css)}
<body>
  <div id="card">
    <div id="panel"><div id="fitbox">${headerRow}<div id="headline">${headlineHtml(headline) || '&nbsp;'}</div></div></div>
    ${credit}
  </div>
  ${fitScript(startSize, panelH - 30 - padBottom - 20, tall ? 4 : 4, 1.2)}
</body></html>`;
}

function buildBandHtml(headline: string, s: VideoFrameStyle): string {
  const H = videoHeight(s.ratio);
  const tall = s.ratio === '9:16';
  // Video dọc: dải chữ cách mép trên/dưới để không bị giao diện TikTok/Reels che
  const safe = tall ? 300 : 60;
  const bandPos =
    s.position === 'top' ? `top:${safe}px;` : s.position === 'center' ? 'top:50%;transform:translateY(-50%);' : `bottom:${safe}px;`;
  const startSize = Math.round((tall ? 78 : 70) * s.fontScale);
  const maxBandH = Math.round(H * (tall ? 0.3 : 0.36));
  const logo = s.logoUrl ? `<div id="logo" style="background-image:url('${esc(s.logoUrl)}')"></div>` : '';
  const badge = s.badgeText.trim() ? `<div id="badge">${esc(s.badgeText.trim())}</div>` : '';

  const css = `
  #band { position: absolute; left: 48px; right: 48px; ${bandPos} }
  #badge {
    display: inline-block; margin-bottom: -2px; padding: 12px 26px 10px; background: ${s.accent}; color: ${readableOn(s.accent)};
    font: 900 34px/1 'DT Phudu', 'Montserrat', 'Arial Black', Arial, sans-serif; letter-spacing: 1px; text-transform: uppercase; text-shadow: none;
  }
  #fitbox {
    padding: 34px 40px 38px; background: ${s.bandBg}; color: ${s.textColor}; text-align: center;
    box-shadow: 0 10px 40px rgba(0,0,0,.35); border-bottom: 10px solid ${s.accent};
    ${glassCss(s)} ${isGlassBg(s.bandBg) ? `border-bottom: 10px solid ${s.accent};` : ''}
  }
  #headline {
    font-family: 'DT Phudu', 'Montserrat', 'Arial Black', 'Helvetica Neue', Arial, sans-serif; font-weight: 800;
    ${s.uppercase ? 'text-transform: uppercase;' : ''} line-height: 1.18; letter-spacing: -0.5px; word-break: break-word;
  }
  #headline .hl { color: ${s.accent}; }
  #logo {
    position: absolute; left: 48px; top: ${tall ? 120 : 48}px; width: 150px; height: 150px; border-radius: 50%;
    background: #fff center/cover no-repeat; border: 6px solid ${s.accent}; box-shadow: 0 6px 24px rgba(0,0,0,.35);
  }`;

  return `${head(H, css)}
<body>
  <div id="card">
    ${logo}
    <div id="band">${badge}<div id="fitbox"><div id="headline">${headlineHtml(headline) || '&nbsp;'}</div></div></div>
  </div>
  ${fitScript(startSize, maxBandH, 4, 1.18)}
</body></html>`;
}

// Bộ màu kiểu thẻ nổi: nền thẻ tối + chữ trắng/vàng + màu nền trang trí đáy
export const CARD_PRESETS: Array<{ label: string; bandBg: string; textColor: string; accent: string; decorColor: string }> = [
  { label: 'Tím (giống mẫu)', bandBg: '#24132f', textColor: '#ffffff', accent: '#ffd84a', decorColor: '#b44be0' },
  { label: 'Xanh đêm', bandBg: '#0e1a33', textColor: '#ffffff', accent: '#ffd84a', decorColor: '#2f6fe0' },
  { label: 'Đỏ đô', bandBg: '#2a0d13', textColor: '#ffffff', accent: '#ffd84a', decorColor: '#d12c3f' },
  { label: 'Xanh ngọc', bandBg: '#0b2423', textColor: '#ffffff', accent: '#ffe066', decorColor: '#12a394' },
  { label: 'Cam hoàng hôn', bandBg: '#2b150b', textColor: '#ffffff', accent: '#ffe066', decorColor: '#f0701a' },
];

const hexRgb = (hex: string): [number, number, number] => {
  const m = String(hex).match(/^#([0-9a-f]{6})/i);
  const n = m ? parseInt(m[1], 16) : 0xb44be0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = (hex: string, a: number, k = 1) => {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${a})`;
};


// Cụm mở đầu kết thúc bằng dấu hai chấm ("THẾ MÀ LẠI HAY:") đứng riêng 1 dòng như mẫu page giải trí
const splitLeadIn = (h: string) => String(h || '').replace(/^([^:\n]{3,40}:)(\]\])?\s+/, '$1$2\n');

/** Tự động highlight số, từ viết hoa liên tiếp, và từ khóa quan trọng bằng [[...]] nếu chưa có */
const autoHighlight = (h: string): string => {
  // Không xử lý nếu đã có highlight thủ công
  if (h.includes('[[')) return h;
  // Highlight số + đơn vị (2 ly, 70 tuổi, 1 tỷ...)
  let r = h.replace(/(\d+[\s\u00A0]*(?:ly|cái|người|tỷ|triệu|nghìn|k|kg|km|m|cm|%|tuổi|năm|ngày|giờ|phút|lần|điểm|độ|vụ|tháng|bộ)?)/gi, '[[$1]]');
  return r;
};

function buildCardHtml(headline: string, s: VideoFrameStyle): string {
  const H = videoHeight(s.ratio);
  const tall = s.ratio === '9:16';
  const pos = s.position || 'center';
  const cardTop = Math.round(
    H * (pos === 'top' ? (tall ? 0.16 : 0.12) : pos === 'center' ? (tall ? 0.52 : 0.44) : (tall ? 0.65 : 0.56))
  );
  const offsetPx = Math.round(H * (s.cardOffsetY ?? 0) / 100);
  const cardTopFinal = Math.max(0, cardTop + offsetPx);
  const scale = s.cardScale ?? 1;
  const cardMinH = Math.round(H * (tall ? 0.18 : 0.20)); // chiều cao tối thiểu; card tự cao hơn theo nội dung
  const cardMaxH = Math.round(H * (tall ? 0.42 : 0.46)); // giới hạn không cho tràn
  const startSize = Math.round((tall ? 72 : 64) * s.fontScale * scale);
  const decorH = Math.round(H * (tall ? 0.42 : 0.46)); // lớp phủ thấp hơn, không che phần video trên
  const border = 'rgba(240,228,255,.92)';
  const name = s.pageName.trim();
  const logoInner = s.logoUrl
    ? `<div id="logo" style="background-image:url('${esc(s.logoUrl)}')"></div>`
    : name ? `<div id="logo" class="initial">${esc(name.slice(0, 1).toUpperCase())}</div>` : '';
  const tab = logoInner ? `<div id="tab">${logoInner}</div>` : '';
  const badge = s.badgeText.trim() ? `<div id="badge">${esc(s.badgeText.trim())}</div>` : '';

  const tabTop = Math.max(24, cardTop - (tall ? 220 : 160));
  const decorPos = pos === 'top'
    ? `top: 0; height: ${decorH}px; background: ${s.decorUrl && !s.decorGradient ? 'none' : `linear-gradient(to top, ${rgba(s.decorColor, 0)} 0%, ${rgba(s.decorColor, 0.3)} 22%, ${rgba(s.decorColor, 0.72)} 42%, ${rgba(s.decorColor, 0.92)} 62%, ${rgba(s.decorColor, 1, 0.62)} 100%)`};`
    : `bottom: 0; height: ${decorH}px; background: ${s.decorUrl && !s.decorGradient ? 'none' : `linear-gradient(to bottom, ${rgba(s.decorColor, 0)} 0%, ${rgba(s.decorColor, 0.3)} 22%, ${rgba(s.decorColor, 0.72)} 42%, ${rgba(s.decorColor, 0.92)} 62%, ${rgba(s.decorColor, 1, 0.62)} 100%)`};`;

  const css = `
  #decor {
    position: absolute; left: 0; right: 0; ${decorPos}
  }
  #decor img { position: absolute; left: 0; ${pos === 'top' ? 'top: 0;' : 'bottom: 0;'} width: 100%; height: auto; max-height: ${decorH}px; object-fit: contain; object-position: ${pos === 'top' ? 'top center' : 'bottom center'}; display: block; }
  #tab {
    position: absolute; left: 0; top: ${tabTop}px; width: ${tall ? 236 : 200}px; height: ${tall ? 150 : 128}px;
    background: ${s.bandBg}; border: 4px solid ${border}; border-left: none; border-radius: 0 999px 999px 0;
    display: flex; align-items: center; justify-content: center; padding-left: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,.35), inset 0 0 0 3px ${rgba(s.decorColor, 0.55)};
  }
  #logo { width: ${tall ? 120 : 102}px; height: ${tall ? 120 : 102}px; border-radius: 50%; background: #fff center/cover no-repeat;
    border: 4px solid ${border}; box-shadow: 0 0 0 5px ${rgba(s.decorColor, 0.5)}; }
  #logo.initial { display: flex; align-items: center; justify-content: center; background: ${s.bandBg}; color: ${s.accent};
    font: 900 60px/1 'DT Phudu', 'Montserrat', Arial, sans-serif; }
  #card {
    position: relative;
  }
  #box {
    position: absolute; left: 138px; right: 138px; top: ${cardTopFinal}px;
    min-height: ${cardMinH}px; max-height: ${cardMaxH}px; height: auto;
    background: ${s.bandBg}; border: 3px solid ${border}; border-radius: 26px;
    box-shadow: 0 20px 50px rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; padding: 32px 50px;
    transform-origin: top center; transform: scale(${scale});
  }
  #fitbox { display: inline-block; max-width: 100%; text-align: ${s.cardAlign === 'left' ? 'left' : 'center'}; }
  #badge { display: inline-block; margin-bottom: 18px; padding: 8px 18px 6px; border-radius: 8px; background: ${s.accent}; color: ${readableOn(s.accent)};
    font: 800 28px/1 'DT Phudu', 'Montserrat', Arial, sans-serif; letter-spacing: 1px; text-transform: uppercase; }
  #headline {
    color: ${s.textColor}; font-family: 'DT Phudu', 'Montserrat', 'Arial Black', sans-serif; font-weight: 800; line-height: 1.14;
    letter-spacing: -0.2px; ${s.uppercase ? 'text-transform: uppercase;' : ''} word-break: break-word;
  }
  #headline .hl { color: ${s.accent}; }`;

  return `${head(H, css)}
<body>
  <div id="card">
    <div id="decor">${s.decorUrl ? `<img src="${esc(s.decorUrl)}" alt=""/>` : ''}</div>
    ${tab}
    <div id="box"><div id="fitbox">${badge}<div id="headline">${headlineHtml(splitLeadIn(autoHighlight(headline))) || '&nbsp;'}</div></div></div>
  </div>
  ${fitScript(startSize, cardMaxH - 96, tall ? 5 : 4, 1.14)}
</body></html>`;
}

/**
 * Lớp nhận diện giữ lại sau khi khung ẩn (giống mẫu page tin): "Nguồn: …" góc trên trái, logo page góc trên phải.
 * Đặt dưới thanh tìm kiếm của TikTok (~13% chiều cao) để không bị che. Không có gì để hiện thì trả ''.
 */
export function buildBrandHtml(opts: { credit: string; logoUrl: string; pageName: string; ratio: VideoRatio }): string {
  const H = videoHeight(opts.ratio);
  const top = Math.round(H * (opts.ratio === '9:16' ? 0.125 : 0.05));
  // Bỏ số thông báo Facebook dính trong tên nhóm, vd. "Nguồn: (20+) Không Sợ Chó"
  const credit = opts.credit.replace(/\(\d+\+?\)\s*/g, '').replace(/\s+/g, ' ').trim();
  const logo = opts.logoUrl
    ? `<img id="logo" src="${esc(opts.logoUrl)}" alt=""/>`
    : opts.pageName.trim() ? `<div id="pname">${esc(opts.pageName.trim())}</div>` : '';
  if (!credit && !logo) return '';
  const css = `
  #credit { position: absolute; left: 60px; top: ${top}px; max-width: ${opts.logoUrl || opts.pageName.trim() ? 620 : 960}px; color: #fff;
    padding: 8px 18px 6px; border-radius: 10px; background: rgba(0,0,0,.42); border: 1.5px solid rgba(255,255,255,.22);
    font: 800 34px/1.2 'DT Phudu', 'Montserrat', Arial, sans-serif; letter-spacing: .3px; text-shadow: 0 2px 6px rgba(0,0,0,.5);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #logo { position: absolute; right: 70px; top: ${top - 40}px; height: 150px; max-width: 320px; object-fit: contain;
    filter: drop-shadow(0 3px 10px rgba(0,0,0,.45)); }
  #pname { position: absolute; right: 70px; top: ${top}px; max-width: 420px; color: #fff; text-align: right;
    font: 800 40px/1.15 'DT Phudu', 'Montserrat', Arial, sans-serif; text-transform: uppercase; text-shadow: 0 2px 8px rgba(0,0,0,.7); }`;
  return `${head(H, css)}
<body>
  <div id="card">
    ${credit ? `<div id="credit">${esc(credit)}</div>` : ''}
    ${logo}
  </div>
  <script>Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 3000); })]).then(function () { window.__fitDone = true; });</script>
</body></html>`;
}

/** credit: dòng nguồn dưới video (chỉ kiểu panel), riêng từng video nên không nằm trong style */
export function buildVideoFrameHtml(headline: string, style: VideoFrameStyle, credit = '', sourceAspect = 16 / 9): string {
  const s = { ...DEFAULT_VIDEO_FRAME, ...style };
  if (s.layout === 'card') return buildCardHtml(headline, s);
  return s.layout === 'panel' ? buildPanelHtml(headline, s, credit, sourceAspect) : buildBandHtml(headline, s);
}
