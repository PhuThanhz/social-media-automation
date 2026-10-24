// Trạng thái dự án của Video Editor: video (cắt/tốc độ/màu), khung, lớp chữ/ảnh, phụ đề, giọng đọc, nhạc nền.
// Lịch sử Undo/Redo tự làm (chụp cả project) để thao tác kéo trên timeline chỉ tính 1 bước.
import { create } from 'zustand';

export type Anim = 'none' | 'fade' | 'slideup' | 'slidedown' | 'slideleft' | 'slideright';

export const ANIM_OPTIONS: Array<{ value: Anim; label: string }> = [
  { value: 'none', label: 'Không' },
  { value: 'fade', label: 'Mờ dần' },
  { value: 'slideup', label: 'Trượt lên' },
  { value: 'slidedown', label: 'Trượt xuống' },
  { value: 'slideleft', label: 'Trượt sang trái' },
  { value: 'slideright', label: 'Trượt sang phải' },
];

export interface Word { text: string; start: number; end: number }

export interface VideoTrack {
  trimIn: number;
  trimOut: number;
  speed: number;
  volume: number; // 0–2
  duckVolume: number; // âm lượng tiếng gốc khi có giọng đọc, 0–2
  brightness: number; // -0.5..0.5
  contrast: number; // 0.5..2
  saturation: number; // 0..3
}

export interface FrameLayer {
  enabled: boolean;
  start: number;
  end: number;
  inAnim: Anim;
  outAnim: Anim;
  animDur: number;
  dx: number;
  dy: number;
  keepLayoutAfter: boolean; // hết khung vẫn giữ vị trí clip như lúc có khung
  transition?: string; // chuyển cảnh lúc khung ẩn (tên xfade), mặc định 'fade'
  transitionDur?: number;
}

export interface BrandLayer { enabled: boolean; start: number; end: number }

interface LayerBase {
  id: string;
  name: string;
  start: number;
  end: number;
  x: number; // tâm, px trên khung 1080 rộng
  y: number;
  width: number;
  rotate: number;
  opacity: number;
  inAnim: Anim;
  outAnim: Anim;
  animDur: number;
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  text: string;
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  bg: string; // '' = không nền
  align: 'left' | 'center' | 'right';
  uppercase: boolean;
  weight: number;
}

export interface ImageLayer extends LayerBase {
  kind: 'image';
  src: string;
  radius: number; // % bo góc, 50 = tròn
}

export type OverlayLayer = TextLayer | ImageLayer;

export interface Caption { id: string; start: number; end: number; text: string; words?: Word[] }

export interface CaptionStyle {
  enabled: boolean;
  preset: string;
  y: number; // tâm theo % chiều cao khung
  fontSize: number;
  color: string;
  strokeColor: string;
  highlight: string;
  karaoke: boolean;
  uppercase: boolean;
  bg: string;
  maxWords: number;
  avoidFrame?: boolean; // tự dời phụ đề ra khỏi khung tiêu đề khi trùng chỗ (mặc định bật)
  captionsOff2?: boolean; // đã áp mặc định "chỉ hiện tiêu đề, ẩn phụ đề" cho dự án lưu từ trước
  showDuringFrame?: boolean; // hiện phụ đề cả lúc khung tiêu đề đang hiện (mặc định tắt: giọng thường đọc lại đúng tiêu đề → chữ bị lặp)
}

export interface VoiceClip {
  id: string;
  url: string;
  duration: number;
  text: string;
  voice: string;
  rate: number; // % (-50..50)
  pitch: number; // Hz (-20..20)
  start: number;
  volume: number; // 0–3
  engine: string;
  words?: Word[]; // mốc từ tính từ đầu file
  trimIn?: number; // cắt bớt đầu file (giây)
  trimOut?: number; // cắt bớt đuôi file (giây), mặc định = duration
}

export const voiceIn = (v: VoiceClip) => v.trimIn ?? 0;
export const voiceOut = (v: VoiceClip) => v.trimOut ?? v.duration;
export const voiceLen = (v: VoiceClip) => Math.max(0.05, voiceOut(v) - voiceIn(v));
/** Đoạn đọc đang chiếm trên timeline */
export const voiceEnd = (v: VoiceClip) => v.start + voiceLen(v);

export interface BgmClip {
  url: string;
  name: string;
  start: number;
  end: number;
  offset: number;
  volume: number; // 0–2
  fadeIn: number;
  fadeOut: number;
}

export interface Project {
  version: 1;
  sourceUrl: string;
  video: VideoTrack;
  frame: FrameLayer;
  brand: BrandLayer;
  overlays: OverlayLayer[];
  captions: Caption[];
  captionStyle: CaptionStyle;
  voices: VoiceClip[];
  bgm: BgmClip | null;
  fadeIn?: number; // mở đầu hiện dần từ đen (giây, 0 = tắt)
  fadeOut?: number; // kết thúc tối dần
}

export type Selection =
  | { type: 'video' | 'frame' | 'brand' | 'bgm' | 'captions' | 'transition' }
  | { type: 'overlay' | 'caption' | 'voice'; id: string }
  | null;

export const CAPTION_PRESETS: Array<{ key: string; label: string; style: Partial<CaptionStyle> }> = [
  { key: 'classic', label: 'Trắng viền đen', style: { color: '#ffffff', strokeColor: '#000000', highlight: '#ffd400', bg: '' } },
  { key: 'yellow', label: 'Vàng viền đen', style: { color: '#ffe14d', strokeColor: '#000000', highlight: '#ffffff', bg: '' } },
  { key: 'box', label: 'Nền đen mờ', style: { color: '#ffffff', strokeColor: '', highlight: '#ffd400', bg: 'rgba(0,0,0,0.62)' } },
  { key: 'red', label: 'Tin nóng đỏ', style: { color: '#ffffff', strokeColor: '#8a0000', highlight: '#ffe14d', bg: '' } },
];

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  enabled: true,
  preset: 'classic',
  y: 72,
  fontSize: 66,
  color: '#ffffff',
  strokeColor: '#000000',
  highlight: '#ffd400',
  karaoke: true,
  uppercase: false,
  bg: '',
  maxWords: 4,
};

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const timelineDuration = (p: Project) => Math.max(0.2, (p.video.trimOut - p.video.trimIn) / (p.video.speed || 1));

const HISTORY_LIMIT = 80;

interface EditorState {
  project: Project | null;
  selected: Selection;
  past: Project[];
  future: Project[];
  lastKey: string;
  lastAt: number;
  load: (p: Project) => void;
  /** key: các thay đổi liên tiếp cùng key trong 700ms (kéo slider) gộp thành 1 bước undo. silent: không ghi lịch sử */
  update: (fn: (p: Project) => Project, opts?: { key?: string; silent?: boolean }) => void;
  checkpoint: () => void;
  /** Vùng thẻ/dải chữ của khung tiêu đề trên khung 1080×H (đo trong preview) — để phụ đề né ra */
  frameBox: { x: number; y: number; w: number; h: number } | null;
  /** Lỗi key Gemini gần nhất (thiếu / hết quota / sai) → hiện thông báo kèm nút cài key */
  aiKeyIssue: 'missing' | 'exhausted' | 'invalid' | null;
  setAiKeyIssue: (v: 'missing' | 'exhausted' | 'invalid' | null) => void;
  setFrameBox: (b: { x: number; y: number; w: number; h: number } | null) => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
}

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  selected: null,
  past: [],
  future: [],
  lastKey: '',
  lastAt: 0,
  frameBox: null,
  aiKeyIssue: null,
  setAiKeyIssue: (v) => set({ aiKeyIssue: v }),
  setFrameBox: (b) => set({ frameBox: b }),
  load: (p) => set({ project: p, past: [], future: [], selected: null }),
  update: (fn, opts) => {
    const { project, past, lastKey, lastAt } = get();
    if (!project) return;
    const next = fn(project);
    if (next === project) return;
    if (opts?.silent) { set({ project: next }); return; }
    const now = Date.now();
    const merge = !!opts?.key && opts.key === lastKey && now - lastAt < 700;
    set({
      project: next,
      past: merge ? past : [...past.slice(-HISTORY_LIMIT), project],
      future: [],
      lastKey: opts?.key || '',
      lastAt: now,
    });
  },
  checkpoint: () => {
    const { project, past } = get();
    if (project) set({ past: [...past.slice(-HISTORY_LIMIT), project], future: [], lastKey: '' });
  },
  undo: () => {
    const { project, past, future } = get();
    if (!project || !past.length) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], lastKey: '' });
  },
  redo: () => {
    const { project, past, future } = get();
    if (!project || !future.length) return;
    set({ project: future[0], future: future.slice(1), past: [...past, project], lastKey: '' });
  },
  select: (s) => set({ selected: s }),
}));

// Đồng hồ phát chung (tách store riêng: đổi 60 lần/giây không làm render lại toàn bộ editor)
interface PlayerState { time: number; playing: boolean; setTime: (t: number) => void; setPlaying: (p: boolean) => void }
export const usePlayerClock = create<PlayerState>((set) => ({
  time: 0,
  playing: false,
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set({ playing }),
}));

/** Gom các từ của giọng đọc thành dòng phụ đề (ngắt ở dấu câu hoặc đủ maxWords từ) */
export function buildCaptions(voices: VoiceClip[], maxWords: number): Caption[] {
  const out: Caption[] = [];
  for (const v of voices) {
    let words: Word[] = v.words && v.words.length ? v.words : [];
    if (!words.length) {
      // Không có mốc từng từ (giọng Gemini/macOS) → chia đều theo số ký tự
      const tokens = v.text.split(/\s+/).filter(Boolean);
      const total = tokens.reduce((s, w) => s + w.length + 1, 0) || 1;
      let acc = 0;
      const span = Math.max(0.2, v.duration - 0.1);
      words = tokens.map((w) => {
        const st = (acc / total) * span;
        acc += w.length + 1;
        return { text: w, start: st, end: (acc / total) * span };
      });
    }
    // Lấy dấu câu từ văn bản gốc gắn lại vào từ (Edge bỏ dấu câu khỏi mốc từ)
    const tokens = v.text.split(/\s+/).filter(Boolean);
    let ti = 0;
    const withPunct = words.map((w) => {
      const base = w.text.normalize('NFC').toLowerCase();
      for (let k = ti; k < Math.min(tokens.length, ti + 4); k++) {
        if (tokens[k].normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === base.replace(/[^\p{L}\p{N}]/gu, '')) {
          ti = k + 1;
          return { ...w, text: tokens[k] };
        }
      }
      return w;
    });
    // Chỉ lấy các từ nằm trong đoạn đã cắt; dời về thời gian timeline
    const tIn = voiceIn(v);
    const tOut = voiceOut(v);
    const off = v.start - tIn;
    let line: Word[] = [];
    const flush = () => {
      if (!line.length) return;
      out.push({
        id: newId(),
        start: +(off + line[0].start).toFixed(3),
        end: +(off + Math.min(tOut, line[line.length - 1].end)).toFixed(3),
        text: line.map((w) => w.text).join(' '),
        words: line.map((w) => ({ text: w.text, start: +(off + w.start).toFixed(3), end: +(off + Math.min(tOut, w.end)).toFixed(3) })),
      });
      line = [];
    };
    for (const w of withPunct.filter((x) => x.start >= tIn - 0.05 && x.start < tOut - 0.05)) {
      line.push(w);
      if (line.length >= maxWords || /[.,!?;:…]$/.test(w.text)) flush();
    }
    flush();
  }
  // Nối liền các dòng sát nhau để phụ đề không nháy tắt giữa chừng
  out.sort((a, b) => a.start - b.start);
  for (let i = 0; i < out.length - 1; i++) {
    const gap = out[i + 1].start - out[i].end;
    if (gap > 0 && gap < 0.35) out[i].end = out[i + 1].start;
  }
  return out;
}
