// Mẫu HTML ảnh "thẻ tin tức": ảnh (1 hoặc ghép nhiều ảnh) phía trên, dải tiêu đề IN HOA phía dưới, cụm [[...]]
// tô màu nhấn. Khung vuông 1440×1440 hoặc dọc 4:5 (1440×1800). Cùng 1 chuỗi HTML được dùng cho cả preview
// (iframe trong Studio) lẫn ảnh thật (worker chụp lại bằng Playwright) nên preview khớp 100% với ảnh xuất ra.
//
// Ảnh tròn, logo, nhãn góc định vị bằng % của vùng ảnh (#photos) — Studio đọc vị trí thật trong iframe để kéo thả.

import { DT_PHUDU_BASE64 } from './phuduFontBase64';

export const CARD_SIZE = 1440;

export type CardLayout =
  | 'single'
  | 'h2' | 'v2' | 'wide2' | 'diag2' | 'stack2'
  | '1+2' | 'h3' | 'top1+2' | 'mid3'
  | 'grid4' | 'top1+3' | 'left1+3';
export type CardRatio = '1:1' | '4:5';
export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export type LogoFrame = 'none' | 'circle' | 'rounded' | 'square' | 'pill';
// 'topbar' / 'footer' là mẫu cũ — vẫn nhận để bài đã lưu không lỗi, khi dựng sẽ quy đổi (xem normalizeTemplate)
export type CardTemplate =
  | 'classic' | 'marker' | 'breaking' | 'editorial' | 'floating' | 'overlay' | 'slant' | 'boldframe' | 'framed' | 'split' | 'quote' | 'gradient'
  | 'topbar' | 'footer';

export const TEMPLATES: Array<{ value: CardTemplate; label: string; hint: string }> = [
  { value: 'gradient', label: 'Radiant Gradient', hint: 'Nền chuyển sắc dạ quang huyền ảo, hộp chữ bóng kính cao cấp' },
  { value: 'classic', label: 'Cổ điển', hint: 'Ảnh trên, dải tiêu đề in hoa căn giữa' },
  { value: 'marker', label: 'Bút dạ', hint: 'Cụm nhấn được tô nền màu như bút dạ' },
  { value: 'breaking', label: 'Nền tối', hint: 'Dải tiêu đề nền đen chữ trắng, viền màu nhấn phía trên' },
  { value: 'editorial', label: 'Báo chí', hint: 'Chữ căn trái, vạch màu nhấn bên cạnh' },
  { value: 'floating', label: 'Hộp nổi', hint: 'Ảnh phủ kín, tiêu đề trong hộp bo góc nổi phía dưới' },
  { value: 'overlay', label: 'Đè ảnh', hint: 'Ảnh phủ kín, chữ trắng trên nền tối mờ dần' },
  { value: 'slant', label: 'Dải chéo', hint: 'Dải tiêu đề có mép chéo kèm vạch màu nhấn' },
  { value: 'boldframe', label: 'Viền đậm', hint: 'Viền màu nhấn dày bao quanh cả ảnh' },
  { value: 'framed', label: 'Khung thẻ', hint: 'Ảnh bo góc nằm trong khung, vạch nhấn trên tiêu đề' },
  { value: 'split', label: 'Chia đôi', hint: 'Ảnh bên trái, tiêu đề bên phải kiểu tạp chí' },
  { value: 'quote', label: 'Trích dẫn', hint: 'Dấu ngoặc kép lớn và tên người nói, hợp tin phát ngôn' },
];

export const normalizeTemplate = (t?: CardTemplate): Exclude<CardTemplate, 'topbar' | 'footer'> =>
  t === 'topbar' ? 'editorial' : t === 'footer' || !t ? 'classic' : t;

export const LOGO_FRAME_BG_PRESETS = ['#ffffff', '#111111', 'rgba(255,255,255,0.82)', 'rgba(0,0,0,0.55)'];

// Logo đang dùng (bản tách nền nếu bật) và tỉ lệ cao/rộng của khối logo kể cả khung — để đặt vào góc
export const logoSourceOf = (s: CardStyle) => (s.logoBgRemoved && s.logoNoBgUrl ? s.logoNoBgUrl : s.logoUrl);
export const logoBoxAspect = (s: CardStyle) => {
  const a = s.logoBgRemoved && s.logoNoBgAspect ? s.logoNoBgAspect : s.logoAspect || 0.5;
  if (s.logoFrame === 'circle') return 1;
  if (s.logoFrame === 'rounded' || s.logoFrame === 'square') return a * 0.76 + 0.2;
  if (s.logoFrame === 'pill') return a * 0.64 + 0.16;
  return a;
};

export const cardHeight = (ratio?: CardRatio) => (ratio === '4:5' ? 1800 : 1440);

export interface CardStyle {
  ratio: CardRatio;
  fit: 'cover' | 'contain'; // cover: cắt cho đầy khung · contain: giữ đủ ảnh, nền mờ
  focusX: number; // 0-100 vị trí ảnh theo chiều ngang khi cắt
  focusY: number; // 0-100 theo chiều dọc (0 = giữ phần trên)
  bandBg: string;
  textColor: string;
  accent: string;
  fontScale: number; // 0.7 - 1.4
  bandMaxRatio: number; // tỉ lệ tối đa dải chữ so với chiều cao khung (0.2 - 0.45)
  showLogo: boolean;
  logoUrl?: string;
  logoAspect: number; // cao/rộng của logo — để tính góc dưới
  logoPos: Corner; // góc đã chọn gần nhất (chỉ để hiển thị nút đang chọn)
  logoX: number; // % ngang của vùng ảnh (mép trái logo)
  logoY: number; // % dọc (mép trên logo)
  logoSize: number; // bề rộng logo (px trên khung 1440)
  logoNoBgUrl?: string; // bản đã tách nền (tạo lúc tải logo lên)
  logoNoBgAspect?: number;
  logoBgRemoved: boolean; // dùng bản tách nền
  logoFrame: LogoFrame; // khung bao logo
  logoFrameBg: string;
  logoTint: 'original' | 'white' | 'black'; // đổi logo thành 1 màu (hợp nền ảnh tối/sáng)
  logoShadow: boolean;
  logoOpacity: number; // 0.3 - 1
  showCredit: boolean; // dòng "Nguồn: ..." nhỏ góc dưới phải vùng ảnh
  photoGap: number; // khoảng cách giữa các ảnh khi ghép (px)
  photoRadius: number; // bo góc từng ảnh khi ghép (px) — > 0 thì cả khối ảnh lùi vào cho các ô nổi lên
  gapColor: 'band' | 'white' | 'accent'; // màu đường chia giữa các ảnh
  quoteBy?: string; // tên người nói (mẫu Trích dẫn)
  template: CardTemplate; // kiểu bố cục chữ/ảnh
  topBarText: string; // không còn dùng (trước là nhãn TIN NÓNG / chuyên mục) — giữ để dữ liệu cũ không lỗi
  showFooter: boolean; // dải chân ảnh: tên page + ngày
  footerText: string; // tên page ở chân ảnh — cũng dùng làm tên page khi xem trước bài Facebook
  showDate: boolean; // ghi ngày hôm nay ở chân ảnh
  // Khung ảnh tùy chỉnh (Custom Frame PNG Overlay)
  useCustomFrame?: boolean;
  customFrameUrl?: string;
  framePhotoTop?: number; // % từ đỉnh khung (mặc định 0)
  framePhotoHeight?: number; // % chiều cao vùng ảnh (mặc định 68)
  frameTextBottom?: number; // % từ đáy khung (mặc định 4)
  frameTextLeft?: number; // % lề trái (mặc định 6)
  frameTextRight?: number; // % lề phải (mặc định 6)
  frameTextHeight?: number; // % chiều cao tối đa của hộp chữ (mặc định 24)
  frameTextAlign?: 'left' | 'center' | 'right'; // căn lề chữ (mặc định 'center')
  // Watermark / Tag ẩn nguồn video & ảnh (@thanhphu,...)
  videoWatermark?: string;
  videoWatermarkPos?: Corner;
  videoWatermarkX?: number;
  videoWatermarkY?: number;
  videoWatermarkBg?: 'dark' | 'glass' | 'accent';
  videoWatermarkSize?: number;
}

export interface InsetOptions {
  url: string;
  zoom: number; // 1 - 3
  x: number; // 0-100 tâm thu phóng theo chiều ngang
  y: number; // 0-100 theo chiều dọc
  left: number; // % ngang của vùng ảnh (mép trái vòng tròn)
  top: number; // % dọc
  size: number; // đường kính px
  shape?: 'circle' | 'rounded' | 'square'; // mặc định tròn
  borderWidth?: number; // px, mặc định 12
  borderColor?: string; // mặc định màu nhấn
  shadow?: boolean; // mặc định có
}

export interface BadgeOptions {
  text: string;
  bg: string;
  color: string;
  left: number; // % ngang của vùng ảnh
  top: number; // % dọc
  size: number; // cỡ chữ px
  tilt?: boolean; // nghiêng nhẹ, mặc định có
}

export const DEFAULT_CARD_STYLE: CardStyle = {
  ratio: '1:1',
  fit: 'cover',
  focusX: 50,
  focusY: 50,
  bandBg: '#ffffff',
  textColor: '#111111',
  accent: '#e3151a',
  fontScale: 1,
  bandMaxRatio: 0.32,
  showLogo: false,
  logoAspect: 0.5,
  logoPos: 'tr',
  logoX: 82,
  logoY: 4,
  logoSize: 220,
  logoBgRemoved: false,
  logoFrame: 'none',
  logoFrameBg: '#ffffff',
  logoTint: 'original',
  logoShadow: true,
  logoOpacity: 1,
  showCredit: false,
  photoGap: 8,
  photoRadius: 0,
  gapColor: 'band',
  template: 'classic',
  topBarText: '',
  showFooter: false,
  footerText: '',
  showDate: true,
  useCustomFrame: false,
  customFrameUrl: '',
  framePhotoTop: 0,
  framePhotoHeight: 68,
  frameTextBottom: 4,
  frameTextLeft: 6,
  frameTextRight: 6,
  frameTextHeight: 24,
  frameTextAlign: 'center',
  videoWatermark: '',
  videoWatermarkPos: 'tr',
  videoWatermarkX: 74,
  videoWatermarkY: 4,
  videoWatermarkBg: 'dark',
  videoWatermarkSize: 28,
};

export const COLOR_PRESETS: Array<{ label: string; bandBg: string; textColor: string; accent: string }> = [
  { label: 'Trắng · Đỏ', bandBg: '#ffffff', textColor: '#111111', accent: '#e3151a' },
  { label: 'Đen · Vàng', bandBg: '#0b0b0b', textColor: '#ffffff', accent: '#ffd400' },
  { label: 'Đen · Đỏ', bandBg: '#0b0b0b', textColor: '#ffffff', accent: '#ff3b30' },
  { label: 'Vàng · Đỏ', bandBg: '#ffd400', textColor: '#111111', accent: '#d10000' },
  { label: 'Xanh · Vàng', bandBg: '#0a2a66', textColor: '#ffffff', accent: '#ffd400' },
  { label: 'Trắng · Xanh', bandBg: '#ffffff', textColor: '#111111', accent: '#1565c0' },
  { label: 'Kem · Đỏ đô', bandBg: '#f6efe3', textColor: '#1a1a1a', accent: '#b0121b' },
  { label: 'Đen · Cam', bandBg: '#0b0b0b', textColor: '#ffffff', accent: '#ff7a00' },
];

export const BADGE_PRESETS: Array<{ text: string; bg: string; color: string }> = [
  { text: 'NÓNG', bg: '#e3151a', color: '#ffffff' },
  { text: 'TIN MỚI', bg: '#ffd400', color: '#111111' },
  { text: 'ĐỘC QUYỀN', bg: '#111111', color: '#ffd400' },
  { text: 'CẬP NHẬT', bg: '#1877f2', color: '#ffffff' },
];

export const LAYOUTS_BY_COUNT: Record<number, Array<{ value: CardLayout; label: string }>> = {
  1: [{ value: 'single', label: '1 ảnh' }],
  2: [
    { value: 'h2', label: 'Ngang đều' },
    { value: 'v2', label: 'Dọc đều' },
    { value: 'wide2', label: 'Lệch 2:1' },
    { value: 'diag2', label: 'Cắt chéo' },
    { value: 'stack2', label: 'Ảnh chồng' },
  ],
  3: [
    { value: '1+2', label: '1 lớn + 2 nhỏ' },
    { value: 'top1+2', label: '1 trên + 2 dưới' },
    { value: 'h3', label: '3 cột đều' },
    { value: 'mid3', label: 'Cột giữa lớn' },
  ],
  4: [
    { value: 'grid4', label: 'Lưới 4' },
    { value: 'top1+3', label: '1 lớn trên + 3' },
    { value: 'left1+3', label: '1 lớn trái + 3' },
  ],
};

export const IMAGES_PER_LAYOUT: Record<CardLayout, number> = {
  single: 1, h2: 2, v2: 2, wide2: 2, diag2: 2, stack2: 2, '1+2': 3, h3: 3, 'top1+2': 3, mid3: 3, grid4: 4, 'top1+3': 4, 'left1+3': 4,
};

export const defaultLayoutFor = (count: number): CardLayout =>
  LAYOUTS_BY_COUNT[Math.min(4, Math.max(1, count))][0].value;

// Vị trí % (mép trên-trái) để đặt 1 phần tử rộng w, cao h (px) vào góc vùng ảnh kích thước photoW×photoH
export const cornerPercent = (corner: Corner, w: number, h: number, photoW: number, photoH: number, margin = 36) => {
  const left = corner === 'tl' || corner === 'bl' ? margin : photoW - w - margin;
  const top = corner === 'tl' || corner === 'tr' ? margin : photoH - h - margin;
  return { x: (Math.max(0, left) / photoW) * 100, y: (Math.max(0, top) / photoH) * 100 };
};

export interface CardSpec {
  headline: string;
  images: string[];
  videoUrl?: string;
  transparentPhoto?: boolean;
  layout: CardLayout;
  inset?: InsetOptions;
  badge?: BadgeOptions;
  credit?: string;
  style: CardStyle;
}

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const normalizeHeadlineSpaces = (h: string) =>
  String(h || '')
    .replace(/([^\s(\[{])(\[\[)/g, '$1 $2')
    .replace(/(\]\])([^\s)\]}.,;:!?])/g, '$1 $2');

const headlineHtml = (headline: string) =>
  normalizeHeadlineSpaces(headline)
    .split(/(\[\[[\s\S]*?\]\])/g)
    .map((part) => {
      const m = part.match(/^\[\[([\s\S]*?)\]\]$/);
      const text = esc(m ? m[1] : part).replace(/\n/g, '<br/>');
      return m ? `<span class="hl">${text}</span>` : text;
    })
    .join('');

// diag2 / stack2 không dùng lưới (xếp tuyệt đối), chỉ cần 1 ô lưới phủ kín
const GRID_CSS: Record<CardLayout, string> = {
  single: 'grid-template: 1fr / 1fr;',
  h2: 'grid-template: 1fr / 1fr 1fr;',
  v2: 'grid-template: 1fr 1fr / 1fr;',
  wide2: 'grid-template: 1fr / 2fr 1fr;',
  diag2: 'grid-template: 1fr / 1fr;',
  stack2: 'grid-template: 1fr / 1fr;',
  h3: 'grid-template: 1fr / 1fr 1fr 1fr;',
  '1+2': 'grid-template: 1fr 1fr / 3fr 2fr;',
  'top1+2': 'grid-template: 3fr 2fr / 1fr 1fr;',
  mid3: 'grid-template: 1fr / 1fr 1.6fr 1fr;',
  grid4: 'grid-template: 1fr 1fr / 1fr 1fr;',
  'top1+3': 'grid-template: 2.2fr 1fr / 1fr 1fr 1fr;',
  'left1+3': 'grid-template: 1fr 1fr 1fr / 2.2fr 1fr;',
};

// Ô đầu tiên chiếm nhiều hàng/cột ở các bố cục "1 lớn + nhỏ"
const FIRST_CELL_SPAN: Partial<Record<CardLayout, string>> = {
  '1+2': 'grid-row: 1 / span 2;',
  'top1+2': 'grid-column: 1 / span 2;',
  'top1+3': 'grid-column: 1 / span 3;',
  'left1+3': 'grid-row: 1 / span 3;',
};

const clampPct = (v: number | undefined, fallback: number) => Math.min(100, Math.max(0, Number.isFinite(v) ? (v as number) : fallback));

// Màu chữ đọc rõ trên nền hex (vàng/trắng → chữ đen, còn lại chữ trắng)
const readableOn = (hex: string) => {
  const m = String(hex).match(/^#([0-9a-f]{6})/i);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#111111' : '#ffffff';
};

const todayVi = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

export function buildNewsCardHtml(spec: CardSpec): string {
  const s = { ...DEFAULT_CARD_STYLE, ...spec.style };
  const H = cardHeight(s.ratio);
  const needed = IMAGES_PER_LAYOUT[spec.layout] || 1;
  const imgs = spec.images.slice(0, needed);
  let cells = '';
  if (spec.transparentPhoto) {
    cells = '<div class="cell" style="background:transparent !important; border:none !important;"></div>';
  } else if (spec.videoUrl) {
    cells = `<div class="cell" data-cell="0" style="grid-column:1/-1;grid-row:1/-1;position:relative;overflow:hidden;background:#090d16;">
      <div class="video-blur"><video src="${esc(spec.videoUrl)}" autoplay loop muted playsinline></video></div>
      <video class="main-video" src="${esc(spec.videoUrl)}" autoplay loop muted playsinline style="object-fit:${s.fit};"></video>
    </div>`;
  } else {
    cells = imgs
      .map((url, i) => {
        const u = esc(url);
        const span = i === 0 ? FIRST_CELL_SPAN[spec.layout] || '' : '';
        const blur = `<div class="blur" style="background-image:url('${u}')"></div>`;
        return `<div class="cell" data-cell="${i}" style="${span}">${blur}<img src="${u}" referrerpolicy="no-referrer"/></div>`;
      })
      .join('');
  }
  const multi = imgs.length > 1;
  const gap = multi ? Math.max(0, Math.round(s.photoGap ?? 8)) : 0;
  const radius = Math.max(0, Math.round(s.photoRadius ?? 0));
  const gapBg = s.gapColor === 'white' ? '#ffffff' : s.gapColor === 'accent' ? esc(s.accent) : esc(s.bandBg);
  // Bố cục không theo lưới: cắt chéo (2 ảnh chia theo đường chéo) và ảnh chồng (ảnh nhỏ nổi trên ảnh lớn)
  const diagHalf = Math.max(gap, 4) / 2; // nửa bề rộng đường chéo, tính theo px trên khung 1440
  const layoutCss = spec.layout === 'diag2' ? `
  #photos .cell { position: absolute; inset: 0; border-radius: 0; }
  #photos .cell[data-cell="0"] { clip-path: polygon(0 0, calc(60% - ${diagHalf}px) 0, calc(40% - ${diagHalf}px) 100%, 0 100%); }
  #photos .cell[data-cell="1"] { clip-path: polygon(calc(60% + ${diagHalf}px) 0, 100% 0, 100% 100%, calc(40% + ${diagHalf}px) 100%); }
  #photos .cell[data-cell="0"] img { object-position: 30% ${s.focusY}%; }
  #photos .cell[data-cell="1"] img { object-position: 70% ${s.focusY}%; }` : spec.layout === 'stack2' ? `
  #photos .cell[data-cell="0"] { border-radius: 0; }
  #photos .cell[data-cell="1"] {
    position: absolute; z-index: 2; right: 5%; bottom: 7%; width: 40%; height: 46%;
    border: ${Math.max(gap, 10)}px solid ${gapBg}; border-radius: ${Math.max(radius, 18)}px; box-shadow: 0 16px 44px rgba(0,0,0,.45);
  }` : '';
  const startSize = Math.round(84 * s.fontScale);
  const maxLines = s.fontScale > 1.15 ? 5 : 4;
  const inset = spec.inset?.url ? spec.inset : undefined;
  const badge = spec.badge?.text?.trim() ? spec.badge : undefined;

  const logoSrc = logoSourceOf(s);
  const logoHtml = s.showLogo && logoSrc
    ? `<div id="logo" class="frame-${s.logoFrame}" style="left:${clampPct(s.logoX, 82)}%;top:${clampPct(s.logoY, 4)}%"><img src="${esc(logoSrc)}" referrerpolicy="no-referrer"/></div>`
    : '';
  const tint = s.logoTint === 'white' ? 'brightness(0) invert(1)' : s.logoTint === 'black' ? 'brightness(0)' : 'none';
  const logoFramed = s.logoFrame !== 'none';
  const insetHtml = inset
    ? `<div id="inset" style="left:${clampPct(inset.left, 3)}%;top:${clampPct(inset.top, 4)}%"><img src="${esc(inset.url)}" referrerpolicy="no-referrer"/></div>`
    : '';
  const badgeHtml = badge
    ? `<div id="badge" style="left:${clampPct(badge.left, 3)}%;top:${clampPct(badge.top, 4)}%">${esc(badge.text)}</div>`
    : '';
  const creditHtml = s.showCredit && spec.credit ? `<div id="credit">${esc(spec.credit)}</div>` : '';

  const wmText = s.videoWatermark?.trim();
  const wmBgClass = s.videoWatermarkBg === 'accent' ? 'wm-accent' : s.videoWatermarkBg === 'glass' ? 'wm-glass' : 'wm-dark';
  const wmLeft = clampPct(s.videoWatermarkX, s.videoWatermarkPos === 'tl' || s.videoWatermarkPos === 'bl' ? 4 : 74);
  const wmTop = clampPct(s.videoWatermarkY, s.videoWatermarkPos === 'bl' || s.videoWatermarkPos === 'br' ? 88 : 4);
  const watermarkHtml = wmText
    ? `<div id="video-watermark" class="${wmBgClass}" style="left:${wmLeft}%;top:${wmTop}%;font-size:${s.videoWatermarkSize || 28}px;"><span class="handle">${esc(wmText)}</span></div>`
    : '';

  const tpl = normalizeTemplate(s.template);
  const PAD: Record<string, [number, number]> = {
    classic: [44, 52], marker: [48, 60], editorial: [50, 58], overlay: [210, 72], framed: [40, 58], breaking: [52, 58],
    floating: [40, 46], slant: [120, 56], boldframe: [40, 48], split: [64, 64], quote: [64, 58],
  };
  const [padTop, padBottom] = PAD[tpl] || PAD.classic;
  const speaker = tpl === 'quote' && s.quoteBy?.trim() ? `<div class="speaker">— ${esc(s.quoteBy.trim())}</div>` : '';
  const quoteMark = tpl === 'quote' ? '<div class="qmark">&ldquo;</div>' : '';
  const footerDate = s.showDate ? todayVi() : '';
  const showFooter = (s.showFooter || s.template === 'footer') && !!(s.footerText?.trim() || footerDate);
  const footerHtml = showFooter
    ? `<div id="footer"><span class="name">${esc(s.footerText?.trim() || '')}</span><span class="date">${footerDate}</span></div>`
    : '';
  const onAccent = readableOn(s.accent);
  const accent = esc(s.accent);
  const band = esc(s.bandBg);
  const FOOTER_H = 92;
  // Chia đôi: chữ nằm cột phải, được cao gần hết khung và nhiều dòng hơn
  const split = tpl === 'split';
  const isCustomFrame = !!(s.useCustomFrame && s.customFrameUrl);
  const fitMaxH = isCustomFrame
    ? `${H * ((s.frameTextHeight ?? 24) / 100)}`
    : split
      ? `${H - 2 * 64 - (showFooter ? FOOTER_H : 0)}`
      : `${H} * ${s.bandMaxRatio} + ${padTop + padBottom - 96}`;
  const fitMaxLines = isCustomFrame ? 6 : split ? 9 : maxLines;
  const fitStart = split ? Math.round(70 * s.fontScale) : startSize;

  // CSS riêng của từng mẫu (đặt sau CSS chung để ghi đè). Phần ảnh không có chữ không phủ lớp tối để ảnh giữ rõ nét.
  const TEMPLATE_CSS: Record<string, string> = {
    overlay: `
  #card { background: #000; }
  #photos { background: #000; }
  #text {
    position: absolute; z-index: 2; left: 0; right: 0; bottom: ${showFooter ? FOOTER_H : 0}px; text-align: left; color: #fff;
    padding-left: 64px; padding-right: 64px;
    background: linear-gradient(to top, rgba(0,0,0,.92) 0%, rgba(0,0,0,.8) 55%, rgba(0,0,0,0) 100%);
  }
  #footer { position: absolute; left: 0; right: 0; bottom: 0; z-index: 3; background: #000; color: #fff; }
  #credit { top: 18px; bottom: auto; }`,
    editorial: `
  #text { text-align: left; padding-left: 112px; padding-right: 64px; position: relative; letter-spacing: -0.3px; }
  #text::before { content: ''; position: absolute; left: 56px; top: ${padTop}px; bottom: ${padBottom}px; width: 16px; border-radius: 8px; background: ${accent}; }`,
    marker: `
  #text { line-height: 1.32; }
  #text .hl { background: ${accent}; color: ${onAccent}; padding: 0 .16em; border-radius: .1em; -webkit-box-decoration-break: clone; box-decoration-break: clone; }`,
    framed: `
  #card { padding: 40px 40px 0; }
  #photos { border-radius: 30px; overflow: hidden; }
  #text::before { content: ''; display: block; width: 150px; height: 10px; border-radius: 5px; background: ${accent}; margin: 0 auto 30px; }`,
    breaking: `
  #text { background: #0b0b0b; color: #fff; text-align: left; padding-left: 64px; padding-right: 64px; border-top: 14px solid ${accent}; }
  #footer { background: #0b0b0b; color: #fff; }`,
    floating: `
  #card { background: #000; }
  #photos { position: absolute; inset: 0; background: #000; }
  #text {
    position: absolute; z-index: 2; left: 56px; right: 56px; bottom: ${showFooter ? FOOTER_H + 44 : 56}px; padding-left: 48px; padding-right: 48px;
    background: ${band}; border-radius: 28px; border-top: 12px solid ${accent}; box-shadow: 0 18px 50px rgba(0,0,0,.45);
  }
  #footer { position: absolute; left: 0; right: 0; bottom: 0; z-index: 3; }
  #credit { top: 18px; bottom: auto; }`,
    slant: `
  #text { position: relative; z-index: 2; margin-top: -90px; background: ${band}; clip-path: polygon(0 90px, 100% 0, 100% 100%, 0 100%); }
  #text::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 114px; background: ${accent}; clip-path: polygon(0 90px, 100% 0, 100% 24px, 0 114px); }`,
    boldframe: `
  html, body { background: ${accent}; }
  #card { border: 26px solid ${accent}; }
  #text { border-top: 10px solid ${accent}; }`,
    split: `
  #card { flex-direction: row; }
  #photos { flex: 0 0 56%; }
  #text {
    flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; text-align: left;
    padding: 64px 56px ${64 + (showFooter ? FOOTER_H : 0)}px 60px; border-left: 14px solid ${accent};
  }
  #footer { position: absolute; right: 0; bottom: 0; width: 44%; }`,
    quote: `
  #text { position: relative; text-align: left; text-transform: none; font-weight: 800; padding-left: 196px; padding-right: 64px; letter-spacing: -0.3px; }
  #text .qmark { position: absolute; left: 52px; top: ${padTop - 30}px; font-family: Georgia, 'Times New Roman', serif; font-size: 230px; font-weight: 900; line-height: 1; color: ${accent}; }
  #text .speaker { margin-top: 20px; font-family: 'Montserrat', Arial, sans-serif; font-size: 34px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; line-height: 1; color: ${accent}; }`,
    gradient: `
  #card { background: linear-gradient(145deg, #090d16 0%, #160f2b 45%, #2a0b3f 75%, #0a1120 100%); }
  #photos { border-radius: 24px; overflow: hidden; margin: 28px 28px 0; box-shadow: 0 20px 50px rgba(0,0,0,0.6); }
  #text {
    position: relative; z-index: 2; margin: 24px 28px ${showFooter ? 16 : 28}px; padding: 36px 44px;
    background: rgba(18, 24, 38, 0.85); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
    border-radius: 24px; border: 2px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 20px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.25);
    text-align: left; color: #ffffff;
  }
  #text::before {
    content: ''; position: absolute; top: 0; left: 44px; right: 44px; height: 4px;
    background: linear-gradient(90deg, #ec4899, #8b5cf6, #3b82f6); border-radius: 4px;
  }
  #text .hl {
    background: linear-gradient(90deg, #f43f5e, #fb923c, #facc15);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    filter: drop-shadow(0 2px 10px rgba(244,63,94,0.45));
  }
  #footer {
    background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(16px);
    border-top: 1px solid rgba(255,255,255,0.12); color: #e2e8f0;
  }`,
  };
  const templateCss = TEMPLATE_CSS[tpl] || '';
  const customFrameHtml = isCustomFrame
    ? `<img id="custom-frame" src="${esc(s.customFrameUrl!)}" referrerpolicy="no-referrer"/>`
    : '';

  const cardBg = spec.transparentPhoto ? 'transparent !important' : esc(s.bandBg);
  const photosBg = spec.transparentPhoto ? 'transparent !important' : gapBg;
  const cellBg = spec.transparentPhoto ? 'transparent !important' : '#090d16';

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Phudu:wght@700;800;900&family=Montserrat:wght@700;800;900&display=block&subset=vietnamese" rel="stylesheet"/>
<style>
  @font-face {
    font-family: 'DT Phudu';
    font-style: normal;
    font-weight: 700 900;
    font-display: block;
    src: url('data:font/otf;base64,${DT_PHUDU_BASE64}') format('opentype');
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${CARD_SIZE}px; height: ${H}px; overflow: hidden; background: ${cardBg}; }
  #card { position: relative; width: ${CARD_SIZE}px; height: ${H}px; display: flex; flex-direction: column; background: ${cardBg}; }
  #photos { position: relative; flex: 1 1 auto; min-height: 0; display: grid; gap: ${gap}px; ${GRID_CSS[spec.layout] || GRID_CSS.single} background: ${photosBg}; ${multi && radius > 0 ? `padding: ${Math.max(gap, 12)}px;` : ''} }
  .cell { position: relative; overflow: hidden; background: ${cellBg}; min-height: 0; ${multi ? `border-radius: ${radius}px;` : ''} }
  ${layoutCss}
  .cell img { position: relative; z-index: 2; width: 100%; height: 100%; display: block; object-fit: ${s.fit}; object-position: ${s.focusX}% ${s.focusY}%; }
  .cell .blur { position: absolute; inset: -60px; z-index: 1; background-position: center; background-size: cover; background-repeat: no-repeat; filter: blur(42px) brightness(0.68) saturate(1.3); transform: scale(1.25); pointer-events: none; }
  .cell .video-blur { position: absolute; inset: -60px; z-index: 1; overflow: hidden; filter: blur(42px) brightness(0.65) saturate(1.35); transform: scale(1.3); pointer-events: none; }
  .cell .video-blur video { width: 100%; height: 100%; object-fit: cover; }
  .cell video.main-video { position: relative; z-index: 2; width: 100%; height: 100%; object-fit: ${s.fit}; pointer-events: none; }
  #text {
    flex: 0 0 auto; padding: ${padTop}px 56px ${padBottom}px; text-align: center; color: ${esc(s.textColor)};
    font-family: 'DT Phudu', 'Phudu', 'Montserrat', 'Arial Black', sans-serif; font-size: ${fitStart}px;
    font-weight: 800; text-transform: uppercase; line-height: 1.25; letter-spacing: -0.5px; word-break: break-word;
  }
  #text .hl { color: ${esc(s.accent)}; }
  #footer {
    flex: 0 0 auto; height: ${FOOTER_H}px; display: flex; align-items: center; justify-content: space-between; padding: 0 56px;
    border-top: 8px solid ${esc(s.accent)}; color: ${esc(s.textColor)}; background: ${esc(s.bandBg)};
    font-family: 'DT Phudu', 'Phudu', 'Montserrat', Arial, sans-serif; font-size: 34px; font-weight: 800;
  }
  #footer .name { text-transform: uppercase; letter-spacing: .5px; }
  #footer .date { opacity: .7; font-weight: 700; }
  ${templateCss}
  ${isCustomFrame ? `
  #card { display: block !important; position: relative !important; }
  #photos {
    position: absolute !important; left: 0 !important; right: 0 !important;
    top: ${s.framePhotoTop ?? 0}% !important;
    height: ${s.framePhotoHeight ?? 68}% !important;
    min-height: unset !important; flex: unset !important; z-index: 1 !important;
  }
  #custom-frame {
    position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; z-index: 10; pointer-events: none;
  }
  #text {
    position: absolute !important; z-index: 15 !important;
    left: ${s.frameTextLeft ?? 6}% !important; right: ${s.frameTextRight ?? 6}% !important;
    bottom: ${s.frameTextBottom ?? 4}% !important;
    max-height: ${s.frameTextHeight ?? 24}% !important;
    display: flex !important; flex-direction: column !important; justify-content: center !important;
    align-items: ${s.frameTextAlign === 'left' ? 'flex-start' : s.frameTextAlign === 'right' ? 'flex-end' : 'center'} !important;
    text-align: ${s.frameTextAlign || 'center'} !important;
    padding: 0 16px !important; background: transparent !important;
    border: none !important; box-shadow: none !important; clip-path: none !important;
  }
  #text::before { display: none !important; }
  #footer { display: none !important; }
  ` : ''}
  #logo {
    position: absolute; z-index: 3; width: ${Math.round(s.logoSize)}px; opacity: ${s.logoOpacity};
    ${logoFramed ? `background: ${esc(s.logoFrameBg)}; display: flex; align-items: center; justify-content: center;${s.logoShadow ? ' box-shadow: 0 6px 20px rgba(0,0,0,.35);' : ''}` : s.logoShadow ? 'filter: drop-shadow(0 3px 8px rgba(0,0,0,.45));' : ''}
  }
  #logo img { display: block; width: 100%; height: auto; filter: ${tint}; }
  /* padding tính bằng px theo cỡ logo (padding % trong CSS lại tính theo bề rộng vùng ảnh) */
  #logo.frame-circle { height: ${Math.round(s.logoSize)}px; border-radius: 50%; padding: ${Math.round(s.logoSize * 0.17)}px; }
  #logo.frame-rounded { border-radius: ${Math.round(s.logoSize * 0.14)}px; padding: ${Math.round(s.logoSize * 0.1)}px ${Math.round(s.logoSize * 0.12)}px; }
  #logo.frame-square { border-radius: 4px; padding: ${Math.round(s.logoSize * 0.1)}px ${Math.round(s.logoSize * 0.12)}px; }
  #logo.frame-pill { border-radius: 999px; padding: ${Math.round(s.logoSize * 0.08)}px ${Math.round(s.logoSize * 0.18)}px; }
  #logo.frame-circle img { width: auto; height: auto; max-width: 100%; max-height: 100%; }
  #inset {
    position: absolute; z-index: 4; width: ${inset?.size || 380}px; height: ${inset?.size || 380}px; overflow: hidden; background: #222;
    border-radius: ${inset?.shape === 'square' ? '0' : inset?.shape === 'rounded' ? `${Math.round((inset?.size || 380) * 0.12)}px` : '50%'};
    border: ${Math.max(0, inset?.borderWidth ?? 12)}px solid ${esc(inset?.borderColor || s.accent)};
    box-shadow: ${inset?.shadow === false ? 'none' : '0 6px 24px rgba(0,0,0,.35)'};
  }
  #inset img {
    width: 100%; height: 100%; object-fit: cover; display: block;
    object-position: ${inset?.x ?? 50}% ${inset?.y ?? 50}%;
    transform: scale(${inset?.zoom ?? 1}); transform-origin: ${inset?.x ?? 50}% ${inset?.y ?? 50}%;
  }
  #badge {
    position: absolute; z-index: 5; padding: 0.28em 0.6em 0.22em; border-radius: 0.28em;
    background: ${esc(badge?.bg || s.accent)}; color: ${esc(badge?.color || '#fff')}; font-size: ${badge?.size || 64}px;
    font-family: 'DT Phudu', 'Phudu', 'Montserrat', Arial, sans-serif; font-weight: 800; text-transform: uppercase; line-height: 1;
    letter-spacing: -0.5px; white-space: nowrap; box-shadow: 0 6px 18px rgba(0,0,0,.35); transform: ${badge?.tilt === false ? 'none' : 'rotate(-3deg)'};
  }
  #credit {
    position: absolute; z-index: 2; right: 24px; bottom: 18px; color: #fff; font-size: 26px; font-weight: 700;
    font-family: 'Montserrat', Arial, sans-serif; text-shadow: 0 1px 6px rgba(0,0,0,.85); opacity: .92;
  }
  #video-watermark {
    position: absolute; z-index: 6; display: inline-flex; align-items: center; gap: 8px;
    padding: 0.28em 0.68em 0.24em; border-radius: 999px;
    font-family: 'DT Phudu', 'Phudu', 'Montserrat', Arial Black, sans-serif;
    font-weight: 800; letter-spacing: -0.3px; white-space: nowrap;
    box-shadow: 0 8px 24px rgba(0,0,0,0.55); pointer-events: none;
    line-height: 1.15;
  }
  #video-watermark.wm-dark {
    background: rgba(10, 15, 25, 0.88); color: #ffffff;
    border: 2px solid rgba(255,255,255,0.25); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  }
  #video-watermark.wm-glass {
    background: rgba(255, 255, 255, 0.22); color: #ffffff;
    border: 2px solid rgba(255,255,255,0.45); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    text-shadow: 0 2px 6px rgba(0,0,0,0.6);
  }
  #video-watermark.wm-accent {
    background: ${accent}; color: ${onAccent};
    border: 2px solid rgba(255,255,255,0.35);
  }
  #video-watermark .handle { font-weight: 800; }
</style></head>
<body>
  <div id="card">
    <div id="photos">${cells}${logoHtml}${insetHtml}${badgeHtml}${creditHtml}${watermarkHtml}</div>
    ${customFrameHtml}
    <div id="text">${quoteMark}<div id="headline">${headlineHtml(spec.headline) || '&nbsp;'}</div>${speaker}</div>
    ${footerHtml}
  </div>
  <script>
    (function () {
      function fit() {
        var el = document.getElementById('text');
        var size = ${fitStart};
        var maxH = ${fitMaxH} + (el.querySelector('.speaker') ? 60 : 0);
        el.style.fontSize = size + 'px';
        var hl = document.getElementById('headline');
        var lh = parseFloat(getComputedStyle(el).lineHeight) / size || 1.2;
        var lines = function () { return Math.round(hl.offsetHeight / (size * lh)); };
        // Chia đôi hoặc khung riêng: đo phần tiêu đề thay vì cả cột/hộp
        var box = ${split || isCustomFrame ? 'hl' : 'el'};
        while (size > 28 && (box.offsetHeight > maxH || lines() > ${fitMaxLines})) { size -= 2; el.style.fontSize = size + 'px'; }
        window.__fitDone = true;
      }
      var timeout = new Promise(function (r) { setTimeout(r, 5000); });
      Promise.race([document.fonts.ready, timeout]).then(fit);
    })();
  </script>
</body></html>`;
}
