// Thao tác dùng chung cho panel, trợ lý AI và phím tắt: thêm/thay giọng đọc, thêm chữ, áp lệnh AI.
import { buildCaptions, CAPTION_PRESETS, newId, timelineDuration, useEditor, usePlayerClock, voiceEnd, voiceIn, voiceLen } from './store';
import type { Project, TextLayer, VoiceClip } from './store';
import { CANVAS_W } from './layers';

export type NewVoice = Omit<VoiceClip, 'id' | 'start' | 'volume'>;

export const TEXT_PRESETS: Array<{ key: string; label: string; patch: Partial<TextLayer> }> = [
  { key: 'title', label: 'Tiêu đề lớn', patch: { fontSize: 88, weight: 900, color: '#ffffff', strokeColor: '#000000', strokeWidth: 6, uppercase: true, bg: '' } },
  { key: 'yellow', label: 'Vàng viền đen', patch: { fontSize: 72, weight: 900, color: '#ffe14d', strokeColor: '#000000', strokeWidth: 6, uppercase: true, bg: '' } },
  { key: 'box', label: 'Nền đen', patch: { fontSize: 56, weight: 800, color: '#ffffff', strokeColor: '', strokeWidth: 0, uppercase: false, bg: 'rgba(0,0,0,0.7)' } },
  { key: 'red', label: 'Nhãn đỏ', patch: { fontSize: 52, weight: 900, color: '#ffffff', strokeColor: '', strokeWidth: 0, uppercase: true, bg: '#e3151a' } },
  { key: 'plain', label: 'Chữ thường', patch: { fontSize: 54, weight: 700, color: '#ffffff', strokeColor: '#000000', strokeWidth: 3, uppercase: false, bg: '' } },
];

export function makeTextLayer(start: number, D: number, H: number, patch: Partial<TextLayer> = {}): TextLayer {
  return {
    id: newId(), kind: 'text', name: 'Chữ', text: 'Nhập chữ ở đây', start, end: Math.min(D, start + 3),
    x: CANVAS_W / 2, y: Math.round(H * 0.3), width: 900, rotate: 0, opacity: 1, inAnim: 'fade', outAnim: 'fade', animDur: 0.3,
    fontSize: 72, color: '#ffffff', strokeColor: '#000000', strokeWidth: 5, bg: '', align: 'center', uppercase: false, weight: 900, ...patch,
  };
}

/** Thêm đoạn đọc mới hoặc thay đoạn cũ (giữ vị trí), kéo dài khung tiêu đề nếu cần, làm lại phụ đề của đoạn đó */
export function placeVoice(clip: NewVoice, opts: { replaceId?: string; start?: number } = {}) {
  const { update } = useEditor.getState();
  let id = '';
  update((pp) => {
    const D = timelineDuration(pp);
    const old = opts.replaceId ? pp.voices.find((x) => x.id === opts.replaceId) : undefined;
    const t = usePlayerClock.getState().time;
    const start = Math.max(0, Math.min(D - 0.2, opts.start ?? (old ? old.start : pp.voices.length ? t : 0.3)));
    const vc: VoiceClip = { ...clip, id: old?.id || newId(), start, volume: old?.volume ?? 1.6, trimIn: undefined, trimOut: undefined };
    id = vc.id;
    const voices = old ? pp.voices.map((x) => (x.id === old.id ? vc : x)) : [...pp.voices, vc].sort((a, b) => a.start - b.start);
    const vEnd = voiceEnd(vc) + 0.4;
    const frame = pp.frame.enabled && pp.frame.end < D - 0.05 && pp.frame.end < vEnd && start < pp.frame.end ? { ...pp.frame, end: Math.min(D, vEnd) } : pp.frame;
    const brand = frame !== pp.frame && Math.abs(pp.brand.start - pp.frame.end) < 0.05 ? { ...pp.brand, start: frame.end } : pp.brand;
    // Phụ đề: bỏ dòng cũ của đoạn bị thay, sinh dòng mới cho đoạn này
    let captions = pp.captions;
    if (pp.captionStyle.enabled || pp.captions.length) {
      const from = old ? old.start : start;
      const to = old ? voiceEnd(old) : voiceEnd(vc);
      captions = [...pp.captions.filter((c) => c.end <= from + 0.01 || c.start >= to - 0.01), ...buildCaptions([vc], pp.captionStyle.maxWords)].sort((a, b) => a.start - b.start);
    }
    return { ...pp, voices, frame, brand, captions };
  });
  return id;
}

/** Xoá đoạn đọc kèm các dòng phụ đề sinh từ nó */
export function removeVoice(id: string) {
  useEditor.getState().update((p) => {
    const v = p.voices.find((x) => x.id === id);
    if (!v) return p;
    const from = v.start - 0.05;
    const to = voiceEnd(v) + 0.4;
    return { ...p, voices: p.voices.filter((x) => x.id !== id), captions: p.captions.filter((c) => !(c.start >= from && c.end <= to)) };
  });
}

/** Tách đoạn đọc tại đầu phát thành 2 đoạn (cắt bằng điểm vào/ra, không phải tạo lại) */
export function splitVoiceAt(id: string, t: number) {
  useEditor.getState().update((p) => {
    const v = p.voices.find((x) => x.id === id);
    if (!v || t <= v.start + 0.1 || t >= voiceEnd(v) - 0.1) return p;
    const cut = voiceIn(v) + (t - v.start);
    const left: VoiceClip = { ...v, trimOut: cut };
    const right: VoiceClip = { ...v, id: newId(), start: t, trimIn: cut };
    return { ...p, voices: p.voices.flatMap((x) => (x.id === id ? [left, right] : [x])) };
  });
}

export interface AiAction { type: string; [k: string]: unknown }

export interface AiDeps {
  H: number;
  sourceDuration: number;
  bgmPresets: Array<{ url: string; name: string }>;
  defaultVoiceName: string;
  makeVoice: (text: string, voice: string, rate: number, pitch: number) => Promise<NewVoice | null>;
  onHeadline: (h: string) => void;
  onPostCaption: (c: string) => void;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && !Number.isNaN(+v) ? +v : d);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Áp từng lệnh AI trả về; trả danh sách mô tả ngắn để hiện trong khung chat */
export async function applyAiActions(actions: AiAction[], deps: AiDeps): Promise<string[]> {
  const done: string[] = [];
  const st = () => useEditor.getState();
  st().checkpoint();
  const silent = { silent: true } as const;
  for (const a of actions) {
    const p = st().project as Project;
    const D = timelineDuration(p);
    switch (a.type) {
      case 'set_headline':
        if (str(a.headline)) { deps.onHeadline(str(a.headline)); done.push('Đổi chữ khung tiêu đề'); }
        break;
      case 'set_post_caption':
        if (str(a.caption)) { deps.onPostCaption(str(a.caption)); done.push('Viết caption đăng bài'); }
        break;
      case 'set_voice':
      case 'add_voice': {
        const text = str(a.text).trim();
        if (!text) break;
        const first = p.voices[0];
        const clip = await deps.makeVoice(text, first?.voice || deps.defaultVoiceName, Math.round(num(a.rate, first?.rate ?? 0)), first?.pitch ?? 0);
        if (!clip) break;
        if (a.type === 'set_voice') {
          // Thay toàn bộ lời đọc: giữ đoạn đầu (vị trí), xoá các đoạn còn lại
          if (p.voices.length > 1) st().update((pp) => ({ ...pp, voices: pp.voices.slice(0, 1) }), silent);
          placeVoice(clip, first ? { replaceId: first.id } : { start: 0.3 });
          done.push(`Lồng tiếng mới ${clip.duration.toFixed(1)}s`);
        } else {
          placeVoice(clip, { start: num(a.start, usePlayerClock.getState().time) });
          done.push('Thêm đoạn đọc');
        }
        break;
      }
      case 'captions': {
        const preset = CAPTION_PRESETS.find((x) => x.key === str(a.preset));
        st().update((pp) => ({
          ...pp,
          captions: a.enabled === false ? pp.captions : buildCaptions(pp.voices, pp.captionStyle.maxWords),
          captionStyle: { ...pp.captionStyle, enabled: a.enabled !== false, ...(preset ? { ...preset.style, preset: preset.key } : {}) },
        }), silent);
        done.push(a.enabled === false ? 'Tắt phụ đề' : 'Bật phụ đề theo giọng đọc');
        break;
      }
      case 'add_text': {
        const text = str(a.text).trim();
        if (!text) break;
        const preset = TEXT_PRESETS.find((x) => x.key === str(a.style)) || TEXT_PRESETS[1];
        const pos = str(a.position);
        const y = Math.round(deps.H * (pos === 'top' ? 0.17 : pos === 'center' ? 0.5 : 0.76));
        const start = Math.max(0, Math.min(D - 0.3, num(a.start, 0)));
        const l = makeTextLayer(start, D, deps.H, { ...preset.patch, text, name: text.slice(0, 24), y, end: Math.min(D, Math.max(start + 0.5, num(a.end, start + 3))) });
        st().update((pp) => ({ ...pp, overlays: [...pp.overlays, l] }), silent);
        done.push(`Thêm chữ "${text}"`);
        break;
      }
      case 'update_text':
        st().update((pp) => ({ ...pp, overlays: pp.overlays.map((l) => (l.id === a.id && l.kind === 'text' && str(a.text) ? { ...l, text: str(a.text) } : l)) }), silent);
        done.push('Sửa chữ');
        break;
      case 'remove_text':
        st().update((pp) => ({ ...pp, overlays: pp.overlays.filter((l) => l.id !== a.id) }), silent);
        done.push('Xoá chữ');
        break;
      case 'set_bgm': {
        const name = str(a.name).trim().toLowerCase();
        if (!name) { st().update((pp) => ({ ...pp, bgm: null }), silent); done.push('Bỏ nhạc nền'); break; }
        const m = deps.bgmPresets.find((x) => x.name.toLowerCase() === name) || deps.bgmPresets.find((x) => x.name.toLowerCase().includes(name) || name.includes(x.name.toLowerCase()));
        if (!m) break;
        const vol = Math.max(0, Math.min(1, num(a.volume, p.bgm?.volume ?? 0.15)));
        st().update((pp) => ({ ...pp, bgm: { url: m.url, name: m.name, start: 0, end: D, offset: 0, volume: vol, fadeIn: pp.bgm?.fadeIn ?? 0.8, fadeOut: pp.bgm?.fadeOut ?? 1.5 } }), silent);
        done.push(`Nhạc nền: ${m.name}`);
        break;
      }
      case 'frame_time': {
        const s0 = Math.max(0, num(a.start, p.frame.start));
        const e0 = Math.min(D, Math.max(s0 + 0.5, num(a.end, p.frame.end)));
        st().update((pp) => ({ ...pp, frame: { ...pp.frame, enabled: true, start: s0, end: e0 }, brand: pp.brand.enabled ? { ...pp.brand, start: e0 } : pp.brand }), silent);
        done.push(`Khung hiện ${s0.toFixed(1)}–${e0.toFixed(1)}s`);
        break;
      }
      case 'trim': {
        const s0 = Math.max(0, Math.min(deps.sourceDuration - 0.5, num(a.start, p.video.trimIn)));
        const e0 = Math.min(deps.sourceDuration, Math.max(s0 + 0.5, num(a.end, p.video.trimOut)));
        st().update((pp) => ({ ...pp, video: { ...pp.video, trimIn: s0, trimOut: e0 } }), silent);
        done.push(`Cắt clip ${s0.toFixed(1)}–${e0.toFixed(1)}s`);
        break;
      }
      case 'speed': {
        const v = Math.max(0.5, Math.min(2, num(a.value, 1)));
        st().update((pp) => ({ ...pp, video: { ...pp.video, speed: v } }), silent);
        done.push(`Tốc độ ${v}x`);
        break;
      }
      case 'volume':
        st().update((pp) => ({
          ...pp,
          video: { ...pp.video, volume: Math.max(0, Math.min(2, num(a.original, pp.video.volume))), duckVolume: Math.max(0, Math.min(1, num(a.duck, pp.video.duckVolume))) },
          bgm: pp.bgm ? { ...pp.bgm, volume: Math.max(0, Math.min(1, num(a.bgm, pp.bgm.volume))) } : null,
        }), silent);
        done.push('Chỉnh âm lượng');
        break;
      default:
        break;
    }
  }
  return done;
}

/** Tóm tắt dự án gửi cho AI */
export function aiContext(p: Project, extra: { headline: string; postCaption: string; bgmOptions: string[]; sourceDuration: number; sourceTitle: string }) {
  return {
    sourceTitle: extra.sourceTitle,
    sourceDuration: +extra.sourceDuration.toFixed(2),
    timelineDuration: +timelineDuration(p).toFixed(2),
    trim: { start: p.video.trimIn, end: p.video.trimOut },
    speed: p.video.speed,
    headline: extra.headline,
    postCaption: extra.postCaption,
    frame: p.frame.enabled ? { start: +p.frame.start.toFixed(2), end: +p.frame.end.toFixed(2) } : null,
    voices: p.voices.map((v) => ({ id: v.id, text: v.text, start: +v.start.toFixed(2), end: +voiceEnd(v).toFixed(2), length: +voiceLen(v).toFixed(2) })),
    captions: { enabled: p.captionStyle.enabled, lines: p.captions.length, preset: p.captionStyle.preset },
    texts: p.overlays.filter((l) => l.kind === 'text').map((l) => ({ id: l.id, text: (l as TextLayer).text, start: +l.start.toFixed(2), end: +l.end.toFixed(2) })),
    bgm: p.bgm ? { name: p.bgm.name, volume: p.bgm.volume } : null,
    bgmOptions: extra.bgmOptions,
    volumes: { original: p.video.volume, duck: p.video.duckVolume },
  };
}
