// HTML của các lớp chữ / ảnh / phụ đề. Cùng 1 chuỗi markup dùng cho preview (gắn thẳng vào DOM)
// và cho worker chụp PNG khi xuất → xem sao xuất vậy. Chỉ dùng style inline (không CSS theo id) để
// nhiều lớp cùng nằm trong 1 trang preview không đè style nhau.
import { DT_PHUDU_BASE64 } from '../../utils/phuduFontBase64';
import type { Anim, Caption, CaptionStyle, ImageLayer, OverlayLayer, Project, TextLayer } from './store';
import { timelineDuration, voiceIn, voiceOut } from './store';

export type Box = { x: number; y: number; w: number; h: number };

export const CANVAS_W = 1080;
export const FONT_STACK = "'DT Phudu','Montserrat','Arial Black',Arial,sans-serif";
export const FONT_FACE_CSS = `@font-face { font-family: 'DT Phudu'; font-style: normal; font-weight: 700 900; font-display: block;
  src: url('data:font/otf;base64,${DT_PHUDU_BASE64}') format('opentype'); }`;

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Viền chữ bằng text-shadow 16 hướng (ổn định hơn -webkit-text-stroke khi chữ dày) + bóng đổ nhẹ */
const outline = (color: string, w: number) => {
  if (!color || w <= 0) return 'text-shadow: 0 4px 14px rgba(0,0,0,.35);';
  const parts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    parts.push(`${(Math.cos(a) * w).toFixed(1)}px ${(Math.sin(a) * w).toFixed(1)}px 0 ${color}`);
  }
  parts.push('0 6px 16px rgba(0,0,0,.45)');
  return `text-shadow: ${parts.join(',')};`;
};

export function textMarkup(l: TextLayer): string {
  const body = esc(l.uppercase ? l.text.toUpperCase() : l.text).replace(/\n/g, '<br/>');
  const bg = l.bg ? `background:${l.bg}; padding:${Math.round(l.fontSize * 0.28)}px ${Math.round(l.fontSize * 0.5)}px; border-radius:${Math.round(l.fontSize * 0.25)}px;` : '';
  return `<div id="layer" style="position:absolute; left:${l.x}px; top:${l.y}px; width:${l.width}px; transform:translate(-50%,-50%) rotate(${l.rotate}deg);
    text-align:${l.align}; font-family:${FONT_STACK}; font-weight:${l.weight}; font-size:${l.fontSize}px; line-height:1.18; color:${l.color};
    ${outline(l.strokeColor, l.strokeWidth)} word-break:break-word; opacity:${l.opacity};"><span style="display:inline-block; ${bg}">${body || '&nbsp;'}</span></div>`;
}

export function imageMarkup(l: ImageLayer): string {
  return `<div id="layer" style="position:absolute; left:${l.x}px; top:${l.y}px; width:${l.width}px; transform:translate(-50%,-50%) rotate(${l.rotate}deg); opacity:${l.opacity};">
    <img src="${esc(l.src)}" alt="" style="display:block; width:100%; height:auto; border-radius:${l.radius}%;"/></div>`;
}

export const overlayMarkup = (l: OverlayLayer) => (l.kind === 'text' ? textMarkup(l) : imageMarkup(l));

/** activeWord: chỉ số từ đang đọc (karaoke), null = không tô */
export function captionMarkup(c: Caption, s: CaptionStyle, H: number, activeWord: number | null, topPx?: number): string {
  const words = c.words && c.words.length ? c.words.map((w) => w.text) : c.text.split(/\s+/).filter(Boolean);
  const html = words
    .map((w, i) => {
      const t = esc(s.uppercase ? w.toUpperCase() : w);
      return i === activeWord ? `<span style="color:${s.highlight};">${t}</span>` : t;
    })
    .join(' ');
  const bg = s.bg ? `background:${s.bg}; padding:${Math.round(s.fontSize * 0.22)}px ${Math.round(s.fontSize * 0.42)}px; border-radius:${Math.round(s.fontSize * 0.22)}px;` : '';
  const top = Math.round(topPx ?? (H * s.y) / 100);
  return `<div id="layer" style="position:absolute; left:50%; top:${top}px; width:max-content; max-width:${CANVAS_W - 120}px; transform:translate(-50%,-50%);
    text-align:center; font-family:${FONT_STACK}; font-weight:900; font-size:${s.fontSize}px; line-height:1.2; color:${s.color};
    ${outline(s.strokeColor, s.strokeColor ? Math.max(3, Math.round(s.fontSize / 11)) : 0)} ${bg}">${html}</div>`;
}

/** Trang HTML đầy đủ cho worker chụp: khung trong suốt CANVAS_W×H, #card bao ngoài, #layer là phần cần cắt */
export const wrapDoc = (inner: string, H: number) => `<!doctype html><html><head><meta charset="utf-8"/><style>
${FONT_FACE_CSS}
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:${CANVAS_W}px; height:${H}px; background:transparent; overflow:hidden; }
#card { position:relative; width:${CANVAS_W}px; height:${H}px; }
</style></head><body><div id="card">${inner}</div>
<script>(function(){var t=new Promise(function(r){setTimeout(r,5000)});Promise.race([document.fonts.ready,t]).then(function(){window.__fitDone=true;});})();</script>
</body></html>`;

const animVec = (a: Anim, isIn: boolean): [number, number] => {
  const d = 180;
  switch (a) {
    case 'slideup': return [0, isIn ? d : -d];
    case 'slidedown': return [0, isIn ? -d : d];
    case 'slideleft': return [isIn ? d : -d, 0];
    case 'slideright': return [isIn ? -d : d, 0];
    default: return [0, 0];
  }
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Trạng thái hiệu ứng vào/ra tại thời điểm t — công thức giống hệt biểu thức FFmpeg ở backend */
export function animState(t: number, start: number, end: number, inAnim: Anim, outAnim: Anim, animDur: number) {
  if (t < start || t > end) return { visible: false, opacity: 0, dx: 0, dy: 0 };
  const d = Math.max(0.05, Math.min((end - start) / 2, animDur));
  const pin = inAnim !== 'none' ? clamp01((t - start) / d) : 1;
  const pout = outAnim !== 'none' ? clamp01((end - t) / d) : 1;
  const vi = animVec(inAnim, true);
  const vo = animVec(outAnim, false);
  return {
    visible: true,
    opacity: Math.min(pin, pout),
    dx: (1 - pin) * vi[0] + (1 - pout) * vo[0],
    dy: (1 - pin) * vi[1] + (1 - pout) * vo[1],
  };
}

/**
 * Vị trí dọc (tâm, px) của dòng phụ đề: nếu đang trùng thời gian và trùng chỗ với thẻ/dải chữ của khung tiêu đề
 * thì đẩy xuống ngay dưới khung (hết chỗ thì lên trên khung) để chữ không đè nhau.
 */
/** Dòng phụ đề có được hiện không: mặc định ẩn trong lúc khung tiêu đề đang hiện để không lặp chữ tiêu đề */
export function captionShown(c: Caption, p: Project): boolean {
  if (!p.captionStyle.enabled) return false;
  if (p.captionStyle.showDuringFrame || !p.frame.enabled) return true;
  const mid = (c.start + c.end) / 2;
  return !(mid >= p.frame.start && mid < p.frame.end);
}

export function captionTop(c: Caption, p: Project, H: number, frameBox: Box | null): number {
  const s = p.captionStyle;
  const base = (H * s.y) / 100;
  if (s.avoidFrame === false || !p.frame.enabled || !frameBox) return base;
  if (c.end <= p.frame.start || c.start >= p.frame.end) return base;
  const top = frameBox.y + p.frame.dy;
  const bottom = top + frameBox.h;
  const half = s.fontSize * 1.25; // ~2 dòng
  if (base + half < top - 10 || base - half > bottom + 10) return base;
  const below = bottom + s.fontSize * 1.1;
  if (below + half < H * 0.93) return below;
  return Math.max(half, top - s.fontSize * 1.1);
}

/** Từ đang đọc trong dòng phụ đề tại thời điểm t */
export const activeWordAt = (c: Caption, t: number) => {
  if (!c.words?.length) return null;
  let idx = 0;
  for (let i = 0; i < c.words.length; i++) if (t >= c.words[i].start) idx = i;
  return idx;
};

/** Thời điểm khung ẩn (video chuyển về trọn màn hình) */
export const layoutUntil = (p: Project) => {
  const D = timelineDuration(p);
  if (!p.frame.enabled) return 0;
  if (p.frame.keepLayoutAfter || p.frame.end >= D - 0.05) return D;
  return p.frame.end;
};
export const layoutFade = (p: Project) => p.frame.transitionDur ?? Math.min(1, Math.max(0.6, (p.frame.end - p.frame.start) / 3));

/** Hiệu ứng chuyển cảnh (tên = filter xfade của FFmpeg ở backend). group dùng để chia nhóm trong bảng chọn */
export const TRANSITIONS: Array<{ value: string; label: string; group: string }> = [
  { value: 'none', label: 'Cắt thẳng', group: 'Cơ bản' },
  { value: 'fade', label: 'Mờ dần', group: 'Cơ bản' },
  { value: 'dissolve', label: 'Hoà tan', group: 'Cơ bản' },
  { value: 'fadeblack', label: 'Qua màn đen', group: 'Cơ bản' },
  { value: 'fadewhite', label: 'Loé sáng', group: 'Cơ bản' },
  { value: 'zoomin', label: 'Phóng to', group: 'Cơ bản' },
  { value: 'hblur', label: 'Nhoè', group: 'Cơ bản' },
  { value: 'pixelize', label: 'Vỡ điểm ảnh', group: 'Cơ bản' },
  { value: 'wipeleft', label: 'Gạt trái', group: 'Gạt & trượt' },
  { value: 'wiperight', label: 'Gạt phải', group: 'Gạt & trượt' },
  { value: 'wipeup', label: 'Gạt lên', group: 'Gạt & trượt' },
  { value: 'wipedown', label: 'Gạt xuống', group: 'Gạt & trượt' },
  { value: 'smoothleft', label: 'Lướt mềm', group: 'Gạt & trượt' },
  { value: 'slideleft', label: 'Trượt trái', group: 'Gạt & trượt' },
  { value: 'slideright', label: 'Trượt phải', group: 'Gạt & trượt' },
  { value: 'slideup', label: 'Trượt lên', group: 'Gạt & trượt' },
  { value: 'slidedown', label: 'Trượt xuống', group: 'Gạt & trượt' },
  { value: 'circleopen', label: 'Mở tròn', group: 'Hình khối' },
  { value: 'circleclose', label: 'Khép tròn', group: 'Hình khối' },
  { value: 'radial', label: 'Quét tròn', group: 'Hình khối' },
  { value: 'vertopen', label: 'Mở dọc', group: 'Hình khối' },
  { value: 'horzopen', label: 'Mở ngang', group: 'Hình khối' },
  { value: 'squeezeh', label: 'Ép ngang', group: 'Hình khối' },
];

/** Cách khung tiêu đề rời đi theo từng kiểu chuyển cảnh (khung là lớp phủ riêng nên đi kèm bằng hiệu ứng ra) */
export const frameOutFor = (t: string): Anim =>
  t === 'none' ? 'none' : t === 'slideleft' || t === 'wipeleft' || t === 'smoothleft' ? 'slideleft' : t === 'slideright' || t === 'wiperight' ? 'slideright'
    : t === 'slideup' || t === 'wipeup' ? 'slideup' : t === 'slidedown' || t === 'wipedown' ? 'slidedown' : 'fade';

/**
 * Style CSS cho lớp "B" (cảnh sau) theo tiến độ p 0→1 — mô phỏng xfade để preview khớp bản xuất.
 * overlay: lớp màu phủ giữa chừng (qua màn đen / loé sáng).
 */
export function transitionStyle(type: string, p: number): { style: Record<string, string | number>; overlay?: { color: string; opacity: number } } {
  const q = Math.max(0, Math.min(1, p));
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  switch (type) {
    case 'none': return { style: { opacity: q >= 1 ? 1 : 0 } };
    case 'fadeblack': return { style: { opacity: q < 0.5 ? 0 : (q - 0.5) * 2 }, overlay: { color: '#000', opacity: 1 - Math.abs(2 * q - 1) } };
    case 'fadewhite': return { style: { opacity: q < 0.5 ? 0 : (q - 0.5) * 2 }, overlay: { color: '#fff', opacity: 1 - Math.abs(2 * q - 1) } };
    case 'wipeleft': return { style: { clipPath: `inset(0 0 0 ${pct(1 - q)})` } };
    case 'wiperight': return { style: { clipPath: `inset(0 ${pct(1 - q)} 0 0)` } };
    case 'wipeup': return { style: { clipPath: `inset(${pct(1 - q)} 0 0 0)` } };
    case 'wipedown': return { style: { clipPath: `inset(0 0 ${pct(1 - q)} 0)` } };
    case 'smoothleft': return { style: { WebkitMaskImage: `linear-gradient(to right, transparent ${pct(1.2 - q * 1.4)}, #000 ${pct(1.4 - q * 1.4)})`, maskImage: `linear-gradient(to right, transparent ${pct(1.2 - q * 1.4)}, #000 ${pct(1.4 - q * 1.4)})` } };
    case 'slideleft': return { style: { transform: `translateX(${pct(1 - q)})` } };
    case 'slideright': return { style: { transform: `translateX(-${pct(1 - q)})` } };
    case 'slideup': return { style: { transform: `translateY(${pct(1 - q)})` } };
    case 'slidedown': return { style: { transform: `translateY(-${pct(1 - q)})` } };
    // xfade mở/khép tròn có viền mềm và nở nhanh dần → mask tròn mờ viền, bán kính R = 1.5q - 0.25 (theo góc xa nhất)
    case 'circleopen': {
      const R = 1.5 * q - 0.25;
      const m = `radial-gradient(circle farthest-corner at 50% 50%, #000 ${pct(Math.max(0, R - 0.25))}, transparent ${pct(Math.max(0.001, R + 0.25))})`;
      return { style: { WebkitMaskImage: m, maskImage: m } };
    }
    case 'circleclose': {
      const R = 1.5 * (1 - q) - 0.25;
      const m = `radial-gradient(circle farthest-corner at 50% 50%, transparent ${pct(Math.max(0, R - 0.25))}, #000 ${pct(Math.max(0.001, R + 0.25))})`;
      return { style: { WebkitMaskImage: m, maskImage: m } };
    }
    case 'radial': {
      const m = `conic-gradient(from 0deg, #000 ${(q * 360).toFixed(1)}deg, transparent ${(q * 360).toFixed(1)}deg)`;
      return { style: { WebkitMaskImage: m, maskImage: m } };
    }
    case 'vertopen': return { style: { clipPath: `inset(0 ${pct((1 - q) / 2)} 0 ${pct((1 - q) / 2)})` } };
    case 'horzopen': return { style: { clipPath: `inset(${pct((1 - q) / 2)} 0 ${pct((1 - q) / 2)} 0)` } };
    case 'squeezeh': return { style: { opacity: q, transform: `scaleX(${(0.2 + 0.8 * q).toFixed(3)})` } };
    case 'zoomin': return { style: { opacity: q, transform: `scale(${(1.25 - 0.25 * q).toFixed(3)})` } };
    case 'hblur':
    case 'pixelize': return { style: { opacity: q, filter: `blur(${((1 - q) * 18).toFixed(1)}px)` } };
    default: return { style: { opacity: q } };
  }
}

export interface ExportContext {
  project: Project;
  frameBox: Box | null;
  ratio: string;
  H: number;
  frameHtml: string;
  brandHtml: string;
  region: { topPct: number; heightPct: number };
  videoFit: 'cover' | 'contain';
  videoFocusY: number;
  videoOffsetY: number;
  videoScale: number;
}

/** Dựng payload cho POST /video-studio/render-project */
export function buildRenderPayload(c: ExportContext) {
  const p = c.project;
  const D = timelineDuration(p);
  const overlays: Array<Record<string, unknown>> = [];
  if (p.frame.enabled && c.frameHtml) {
    // under: có chuyển cảnh → khung nằm trong cảnh trước, hiệu ứng chuyển cảnh cuốn theo cả khung
    const lu = layoutUntil(p);
    const under = lu > 0 && lu < D - 0.05;
    overlays.push({ html: c.frameHtml, fit: 'canvas', under, start: p.frame.start, end: Math.min(D, p.frame.end), inAnim: p.frame.inAnim, outAnim: under ? 'none' : p.frame.outAnim, animDur: p.frame.animDur, dx: p.frame.dx, dy: p.frame.dy });
  }
  if (p.brand.enabled && c.brandHtml && p.brand.end > p.brand.start) {
    overlays.push({ html: c.brandHtml, fit: 'canvas', start: p.brand.start, end: Math.min(D, p.brand.end), inAnim: 'fade', outAnim: 'none', animDur: 0.5 });
  }
  for (const l of p.overlays) {
    overlays.push({ html: wrapDoc(overlayMarkup({ ...l, opacity: 1 }), c.H), fit: 'layer', start: l.start, end: Math.min(D, l.end), inAnim: l.inAnim, outAnim: l.outAnim, animDur: l.animDur, opacity: l.opacity });
  }
  if (p.captionStyle.enabled) {
    for (const cap of p.captions.filter((x) => captionShown(x, p))) {
      const top = captionTop(cap, p, c.H, c.frameBox);
      if (p.captionStyle.karaoke && cap.words?.length) {
        cap.words.forEach((w, i) => {
          const st = i === 0 ? cap.start : w.start;
          const en = i === cap.words!.length - 1 ? cap.end : cap.words![i + 1].start;
          if (en > st) overlays.push({ html: wrapDoc(captionMarkup(cap, p.captionStyle, c.H, i, top), c.H), fit: 'layer', start: st, end: Math.min(D, en), inAnim: 'none', outAnim: 'none', animDur: 0.1 });
        });
      } else {
        overlays.push({ html: wrapDoc(captionMarkup(cap, p.captionStyle, c.H, null, top), c.H), fit: 'layer', start: cap.start, end: Math.min(D, cap.end), inAnim: 'none', outAnim: 'none', animDur: 0.1 });
      }
    }
  }
  return {
    ratio: c.ratio,
    video: {
      url: p.sourceUrl,
      trimIn: p.video.trimIn,
      trimOut: p.video.trimOut,
      speed: p.video.speed,
      volume: p.video.volume,
      duckVolume: p.video.duckVolume,
      brightness: p.video.brightness,
      contrast: p.video.contrast,
      saturation: p.video.saturation,
      fit: c.videoFit,
      focusY: c.videoFocusY,
      offsetY: c.videoOffsetY,
      scale: c.videoScale,
      regionTopPct: c.region.topPct,
      regionHeightPct: c.region.heightPct,
      layoutUntil: layoutUntil(p),
      layoutFade: layoutFade(p),
      transition: p.frame.transition || 'fade',
    },
    fadeIn: p.fadeIn || 0,
    fadeOut: p.fadeOut || 0,
    overlays,
    voices: p.voices.map((v) => ({ url: v.url, start: v.start, duration: v.duration, volume: v.volume, trimIn: voiceIn(v), trimOut: voiceOut(v) })),
    bgm: p.bgm ? { ...p.bgm } : null,
  };
}
