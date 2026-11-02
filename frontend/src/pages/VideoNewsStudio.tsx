import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Dropdown, Input, Modal, Segmented, Select, Slider, Switch, Tag, Tooltip, Upload, message } from 'antd';
import { DownloadOutlined, PlayCircleOutlined, SendOutlined, SoundOutlined, ThunderboltOutlined, UploadOutlined, DeleteOutlined, PlusOutlined, MoreOutlined, SaveOutlined, HighlightOutlined, PauseOutlined, CaretRightOutlined, VideoCameraOutlined } from '@ant-design/icons';
import api from '../config/axios';
import { getStoredGeminiKeys } from '../components/modals/AiSettingsModal';
import { COLOR_PRESETS, DEFAULT_CARD_STYLE, buildNewsCardHtml, cardHeight } from '../utils/newsCardTemplate';
import type { CardStyle } from '../utils/newsCardTemplate';
import type { CustomFramePreset } from './NewsCardStudio';
import VideoEditor from '../components/VideoEditor/VideoEditor';
import FramePanel from '../components/VideoEditor/FramePanel';
import { VOICES, ENGINE_LABEL } from '../components/VideoEditor/voices';
import {
  BandPosition,
  DEFAULT_VIDEO_FRAME,
  FrameLayout,
  CARD_PRESETS,
  GLASS_PRESETS,
  TRANSITION_OPTIONS,
  TransitionEffect,
  VIDEO_W,
  VideoFrameStyle,
  VideoRatio,
  buildBrandHtml,
  buildVideoFrameHtml,
  isGlassBg,
  speakableHeadline,
  videoHeight,
  videoRegion,
} from '../utils/videoFrameTemplate';

const { TextArea } = Input;

const DEFAULTS_KEY = 'videoStudio.defaults';
const LIBRARY_KEY = 'videoStudio.library';
const DEFAULT_CATEGORY = 'Chung';
const ALL = '__all__';

// Kho khung & logo dùng lại nhiều lần, chia theo danh mục (vd. theo từng Page)
interface LibraryLogo { id: string; name: string; url: string; category: string }
interface LibraryFrame { id: string; name: string; category: string; frame: VideoFrameStyle; introSeconds: number }
interface LibraryDecor { id: string; name: string; url: string; category: string }
interface Library { categories: string[]; logos: LibraryLogo[]; frames: LibraryFrame[]; decors: LibraryDecor[] }

const loadLibrary = (): Library => {
  try {
    const raw = JSON.parse(localStorage.getItem(LIBRARY_KEY) || 'null');
    if (raw) {
      const categories: string[] = Array.from(new Set([DEFAULT_CATEGORY, ...(raw.categories || [])]));
      return { categories, logos: raw.logos || [], frames: raw.frames || [], decors: raw.decors || [] };
    }
  } catch { /* dữ liệu hỏng → kho trống */ }
  return { categories: [DEFAULT_CATEGORY], logos: [], frames: [], decors: [] };
};

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

interface SourceVideo { url: string; duration: number; width: number; height: number; hasAudio: boolean; title: string }
interface VoiceClip { url: string; duration: number; engine: string; text: string; voice: string }
interface Music { url: string; name: string }

interface Settings {
  frame: VideoFrameStyle;
  introSeconds: number;
  voiceName: string;
  musicVolume: number;
  originalVolume: number;
  duckVolume: number;
  voiceDefaultV?: number;
  keepBrand?: boolean; // giữ "Nguồn" + logo góc trên sau khi khung ẩn
}

const DEFAULT_SETTINGS: Settings = {
  frame: DEFAULT_VIDEO_FRAME,
  introSeconds: 5,
  voiceName: 'vi-VN-NamMinhNeural',
  musicVolume: 15,
  originalVolume: 100,
  duckVolume: 20,
  voiceDefaultV: 2,
  keepBrand: true,
};



const loadSettings = (): Settings => {
  try {
    const raw = JSON.parse(localStorage.getItem(DEFAULTS_KEY) || 'null');
    if (raw) {
      // Bản trước mặc định giọng Gemini → chuyển 1 lần sang Nam Minh (Edge, miễn phí)
      const voiceName = raw.voiceDefaultV === 2 ? raw.voiceName : DEFAULT_SETTINGS.voiceName;
      // Bản trước chưa có kiểu bảng blur → chuyển sang bảng blur, khung hiện suốt video
      const introSeconds = raw.frame?.layout ? raw.introSeconds : 0;
      return { ...DEFAULT_SETTINGS, ...raw, voiceName, introSeconds, voiceDefaultV: 2, frame: { ...DEFAULT_VIDEO_FRAME, ...(raw.frame || {}) } };
    }
  } catch { /* dữ liệu hỏng → dùng mặc định */ }
  return DEFAULT_SETTINGS;
};

// Tiêu đề Facebook dạng "Tên nhóm | caption" → tách nguồn và caption; bỏ hashtag/emoji khi làm tiêu đề dự phòng
const splitTitle = (title: string) => {
  const m = String(title || '').replace(/^\(\d+\+?\)\s*/, '').match(/^(.{2,80}?)\s+\|\s+([\s\S]+)$/);
  return m ? { source: m[1].trim(), caption: m[2].trim() } : { source: '', caption: String(title || '').replace(/^\(\d+\+?\)\s*/, '').trim() };
};
const plainCaption = (c: string) =>
  c.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim().replace(/\.{3,}$/, '');

// Ô màu: nền bảng (kính mờ thì đặt trên nền xám giả lập video blur) + vạch màu nhấn
const SwatchFill = ({ bandBg, accent, decor }: { bandBg: string; accent: string; decor?: string }) => (
  <>
    <span className="flex-[2] relative" style={{ background: isGlassBg(bandBg) ? '#5b6573' : bandBg }}>
      {isGlassBg(bandBg) && <span className="absolute inset-[3px] rounded-sm border border-white/60" style={{ background: bandBg }} />}
    </span>
    <span className="flex-1" style={{ background: accent }} />
    {decor && <span className="flex-1" style={{ background: decor }} />}
  </>
);

// Đọc mẫu/khung đã lưu bên Studio Ảnh Tin (cùng localStorage) để video ra y hệt ảnh tin
const NEWS_DEFAULTS_KEY = 'newsCardStudio.defaults.v1';
const NEWS_PRESETS_KEY = 'newsCardStudio.presets.v1';
const NEWS_FRAMES_KEY = 'newsCardStudio.customFrames.v1';
const readJson = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
};
interface NewsSources { base: CardStyle; presets: Array<{ name: string; style: CardStyle }>; frames: CustomFramePreset[] }
const loadNewsSources = (): NewsSources => ({
  base: { ...DEFAULT_CARD_STYLE, ...readJson<Partial<CardStyle>>(NEWS_DEFAULTS_KEY, {}) },
  presets: readJson<Array<{ name: string; style: CardStyle }>>(NEWS_PRESETS_KEY, []).filter((p) => p && p.style),
  frames: readJson<CustomFramePreset[]>(NEWS_FRAMES_KEY, []).filter((f) => f && f.url),
});
// Giống applyCustomFramePreset bên Studio Ảnh Tin
const styleFromFrame = (base: CardStyle, f: CustomFramePreset): CardStyle => ({
  ...base,
  useCustomFrame: true,
  customFrameUrl: f.url,
  framePhotoTop: f.photoTop ?? 0,
  framePhotoHeight: f.photoHeight ?? 68,
  frameTextBottom: f.textBottom ?? 4,
  frameTextLeft: f.textLeft ?? 6,
  frameTextRight: f.textRight ?? 6,
  frameTextHeight: f.textHeight ?? 24,
  frameTextAlign: f.textAlign ?? 'center',
  ...(f.template ? { template: f.template } : {}),
  ...(f.bandBg ? { bandBg: f.bandBg } : {}),
  ...(f.textColor ? { textColor: f.textColor } : {}),
  ...(f.accent ? { accent: f.accent } : {}),
  ...(f.footerText ? { footerText: f.footerText, showFooter: true } : {}),
  ...(f.logoUrl
    ? {
        showLogo: f.showLogo ?? true, logoUrl: f.logoUrl, logoPos: f.logoPos ?? 'tr', logoSize: f.logoSize ?? 220,
        logoOpacity: f.logoOpacity ?? 1, logoFrame: f.logoFrame ?? 'none', logoFrameBg: f.logoFrameBg ?? '#ffffff',
        logoBgRemoved: f.logoBgRemoved ?? false, logoNoBgUrl: f.logoNoBgUrl,
      }
    : {}),
});

const aiError = (e: any) => e?.response?.data?.error || e?.response?.data?.message || e.message;
const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export default function VideoNewsStudio() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const frame = settings.frame;
  const setFrame = (patch: Partial<VideoFrameStyle>) => setSettings((p) => ({ ...p, frame: { ...p.frame, ...patch } }));
  useEffect(() => { localStorage.setItem(DEFAULTS_KEY, JSON.stringify(settings)); }, [settings]);

  // ── Kho khung & logo ──
  const [library, setLibrary] = useState<Library>(loadLibrary);
  useEffect(() => { localStorage.setItem(LIBRARY_KEY, JSON.stringify(library)); }, [library]);
  const [category, setCategory] = useState<string>(() => localStorage.getItem('videoStudio.category') || ALL);
  useEffect(() => { localStorage.setItem('videoStudio.category', category); }, [category]);
  const [newCategory, setNewCategory] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveCategory, setSaveCategory] = useState(DEFAULT_CATEGORY);
  const targetCategory = category === ALL ? DEFAULT_CATEGORY : category;
  const inCategory = <T extends { category: string }>(list: T[]) => (category === ALL ? list : list.filter((x) => x.category === category));
  const shownFrames = inCategory(library.frames);
  const shownLogos = inCategory(library.logos);
  const shownDecors = inCategory(library.decors);

  const addCategory = () => {
    const name = newCategory.trim();
    if (!name) return;
    setLibrary((l) => (l.categories.includes(name) ? l : { ...l, categories: [...l.categories, name] }));
    setCategory(name);
    setNewCategory('');
  };

  const removeCategory = (name: string) => {
    if (name === DEFAULT_CATEGORY) return;
    // Khung/logo của danh mục bị xoá chuyển về "Chung", không mất
    setLibrary((l) => ({
      categories: l.categories.filter((c) => c !== name),
      logos: l.logos.map((x) => (x.category === name ? { ...x, category: DEFAULT_CATEGORY } : x)),
      decors: l.decors.map((x) => (x.category === name ? { ...x, category: DEFAULT_CATEGORY } : x)),
      frames: l.frames.map((x) => (x.category === name ? { ...x, category: DEFAULT_CATEGORY } : x)),
    }));
    setCategory(ALL);
  };

  const saveFrame = () => {
    const name = saveName.trim() || `Khung ${library.frames.length + 1}`;
    setLibrary((l) => ({ ...l, frames: [...l.frames, { id: newId(), name, category: saveCategory, frame: { ...frame }, introSeconds: settings.introSeconds }] }));
    setSaveOpen(false);
    message.success(`Đã lưu "${name}" vào danh mục ${saveCategory}`);
  };

  const applyFrame = (f: LibraryFrame) => {
    setSettings((p) => ({ ...p, frame: { ...DEFAULT_VIDEO_FRAME, ...f.frame }, introSeconds: f.introSeconds || p.introSeconds }));
  };

  const VS_SESSION_KEY = 'videoStudio.session';
  const initialSession = useMemo(() => {
    try {
      const raw = localStorage.getItem(VS_SESSION_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  const [link, setLink] = useState<string>(initialSession.link || '');
  const [resolving, setResolving] = useState(false);
  const [source, setSource] = useState<SourceVideo | null>(initialSession.source || null);
  const [headline, setHeadline] = useState<string>(initialSession.headline || '');
  const [aiBusy, setAiBusy] = useState(false);
  const [voiceText, setVoiceText] = useState<string>(initialSession.voiceText || '');
  const [voiceEdited, setVoiceEdited] = useState<boolean>(initialSession.voiceEdited || false);
  const [voice, setVoice] = useState<VoiceClip | null>(initialSession.voice || null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [music, setMusic] = useState<Music | null>(initialSession.music || null);
  const [bgmPresets, setBgmPresets] = useState<Music[]>([]);
  const [caption, setCaption] = useState<string>(initialSession.caption || '');
  const [credit, setCredit] = useState<string>(initialSession.credit || '');
  // Caption gốc của clip (AI đọc) — tách khỏi caption khi đăng (AI viết lại)
  const [sourceCaption, setSourceCaption] = useState<string>(initialSession.sourceCaption || '');
  const [exporting, setExporting] = useState(false);
  const [resultUrl, setResultUrl] = useState<string>(initialSession.resultUrl || '');

  // Tự động lưu phiên làm việc vào localStorage để F5 hoặc vào lại không bị mất
  useEffect(() => {
    try {
      localStorage.setItem(
        VS_SESSION_KEY,
        JSON.stringify({
          link,
          source,
          headline,
          voiceText,
          voiceEdited,
          voice,
          music,
          caption,
          credit,
          sourceCaption,
          resultUrl,
        })
      );
    } catch {}
  }, [link, source, headline, voiceText, voiceEdited, voice, music, caption, credit, sourceCaption, resultUrl]);

  const clearSession = () => {
    setLink('');
    setSource(null);
    setHeadline('');
    setVoiceText('');
    setVoiceEdited(false);
    setVoice(null);
    setCaption('');
    setCredit('');
    setSourceCaption('');
    setResultUrl('');
    try {
      localStorage.removeItem(VS_SESSION_KEY);
    } catch {}
    message.info('Đã xóa phiên làm việc, bạn có thể tải video mới.');
  };

  const [activeTab, setActiveTab] = useState<'frame' | 'timing' | 'audio'>('frame');
  const [editorOpen, setEditorOpen] = useState(false);
  // "AI làm trọn gói": lấy video xong mở editor và để trợ lý AI tự dựng
  const [autoAgent, setAutoAgent] = useState(false);

  // Video refs & player helpers
  const videoRef = useRef<HTMLVideoElement>(null);
  const bgRef = useRef<HTMLVideoElement>(null);
  const voiceRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const layoutBgRef = useRef<HTMLVideoElement>(null);
  const layoutRef = useRef<HTMLVideoElement>(null);
  const copies = () => [bgRef.current, layoutBgRef.current, layoutRef.current].filter((x): x is HTMLVideoElement => !!x);

  const [t, setT] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const duration = source?.duration || videoRef.current?.duration || 0;

  const formatTime = (secs: number) => {
    if (!Number.isFinite(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const seek = (sec: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = sec;
    setT(sec);
    copies().forEach((c) => { c.currentTime = sec; });
  };

  const [isDraggingFocus, setIsDraggingFocus] = useState(false);
  const dragStartY = useRef(0);
  const dragStartOffsetY = useRef(0);
  const hasDragged = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!source) return;
    setIsDraggingFocus(true);
    hasDragged.current = false;
    dragStartY.current = e.clientY;
    dragStartOffsetY.current = frame.videoOffsetY ?? 0;
  };

  const handleMouseUp = () => {
    setIsDraggingFocus(false);
    if (!hasDragged.current) {
      togglePlay();
    }
  };

  useEffect(() => {
    if (!isDraggingFocus) return;
    const onUp = () => setIsDraggingFocus(false);
    const onMove = (e: MouseEvent) => {
      const deltaY = e.clientY - dragStartY.current;
      if (Math.abs(deltaY) > 3) hasDragged.current = true;
      const boxH = previewBox.current?.clientHeight || 500;
      // Kéo lên (deltaY < 0) -> offset âm (clip dời lên cao); Kéo xuống -> offset dương
      const pctDelta = (deltaY / boxH) * 100;
      const newOffsetY = Math.max(-45, Math.min(45, Math.round(dragStartOffsetY.current + pctDelta)));
      setFrame({ videoOffsetY: newOffsetY });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDraggingFocus]);

  useEffect(() => {
    api.get('/video-studio/bgm-presets').then((r) => {
      const items = r.data?.items || [];
      setBgmPresets(items);
      if (items.length > 0) {
        setMusic((m) => m || items[0]);
      }
    }).catch(() => {});
  }, []);

  // Nội dung đọc mặc định theo tiêu đề cho tới khi người dùng tự sửa
  useEffect(() => { if (!voiceEdited) setVoiceText(speakableHeadline(headline)); }, [headline, voiceEdited]);

  const voiceUpToDate = !!voice && (voice.text === voiceText.trim() || voice.text === speakableHeadline(headline)) && voice.voice === settings.voiceName;
  const alwaysOn = settings.introSeconds <= 0;
  const voiceSpan = voiceUpToDate && voice ? voice.duration + 0.4 : 0;
  // effectiveIntro: khi có giọng đọc thì khung hiện đúng bằng thời lượng đọc (+ 0.4s) để đọc xong là chuyển cảnh
  const effectiveIntro = useMemo(() => {
    if (alwaysOn) return Infinity;
    let t = voiceSpan > 0 ? voiceSpan : (settings.introSeconds || 5);
    if (source?.duration) t = Math.min(t, Math.max(1, source.duration - 0.2));
    return Math.round(t * 10) / 10;
  }, [alwaysOn, settings.introSeconds, voiceSpan, source?.duration]);
  const duckUntil = alwaysOn ? voiceSpan : effectiveIntro;

  const sourceAspect = source && source.height ? source.width / source.height : 16 / 9;

  // ── Mẫu Studio Ảnh Tin ──
  const [newsSources, setNewsSources] = useState<NewsSources>(loadNewsSources);
  const isNews = frame.layout === 'news';
  const newsRatio: '1:1' | '4:5' = frame.ratio === '1:1' ? '1:1' : '4:5';
  const newsStyle = useMemo<CardStyle>(() => {
    const src = frame.newsSource || 'default';
    let st = newsSources.base;
    if (src.startsWith('preset:')) {
      const p = newsSources.presets.find((x) => `preset:${x.name}` === src);
      if (p) st = { ...DEFAULT_CARD_STYLE, ...p.style };
    } else if (src.startsWith('frame:')) {
      const f = newsSources.frames.find((x) => `frame:${x.id}` === src);
      if (f) st = styleFromFrame(newsSources.base, f);
    }
    return { ...st, ratio: newsRatio, frameDuration: 0, showCredit: !!credit.trim() };
  }, [frame.newsSource, newsSources, newsRatio, credit]);

  const frameHtml = useMemo(
    () => isNews
      ? buildNewsCardHtml({ headline, images: [], layout: 'single', transparentPhoto: true, credit: credit.trim() || undefined, style: newsStyle })
      : buildVideoFrameHtml(headline, frame, credit, sourceAspect),
    [isNews, headline, newsStyle, frame, credit, sourceAspect],
  );
  const FW = isNews ? 1440 : VIDEO_W;
  // Lớp "Nguồn" + logo giữ lại sau khi khung ẩn (như mẫu page tin)
  const brandRatio: VideoRatio = isNews ? newsRatio : frame.ratio;
  const brandHtml = useMemo(
    () => settings.keepBrand !== false && settings.introSeconds > 0
      ? buildBrandHtml({
          credit,
          logoUrl: isNews ? (newsStyle.showLogo ? (newsStyle.logoBgRemoved && newsStyle.logoNoBgUrl ? newsStyle.logoNoBgUrl : newsStyle.logoUrl || '') : '') : frame.logoUrl,
          pageName: isNews ? newsStyle.footerText || '' : frame.pageName,
          ratio: brandRatio,
        })
      : '',
    [settings.keepBrand, settings.introSeconds, credit, isNews, newsStyle, frame.logoUrl, frame.pageName, brandRatio],
  );
  const H = isNews ? cardHeight(newsRatio) : videoHeight(frame.ratio);
  // Vùng ảnh của mẫu ảnh tin thay đổi theo độ dài tiêu đề → đo trong iframe sau khi chữ co xong
  const [measuredRegion, setMeasuredRegion] = useState<{ topPct: number; heightPct: number } | null>(null);
  const region = isNews && measuredRegion ? measuredRegion : videoRegion(frame, sourceAspect);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const measureFrame = () => {
    if (!isNews) return;
    let tries = 0;
    const tick = () => {
      const win = frameRef.current?.contentWindow as (Window & { __fitDone?: boolean }) | null | undefined;
      const doc = frameRef.current?.contentDocument;
      const card = doc?.getElementById('card');
      const photos = doc?.getElementById('photos');
      if (win?.__fitDone && card && photos) {
        const c = card.getBoundingClientRect();
        const r = photos.getBoundingClientRect();
        setMeasuredRegion({ topPct: ((r.top - c.top) / c.height) * 100, heightPct: (r.height / c.height) * 100 });
      } else if (tries++ < 40) setTimeout(tick, 150);
    };
    tick();
  };

  // Đổi kiểu khung: bảng blur mặc định hiện suốt video, dải chữ mặc định ẩn sau 5s
  const setLayout = (layout: FrameLayout) =>
    setSettings((p) => {
      // Chuyển sang thẻ nổi mà đang dùng màu không phải bộ thẻ → áp bộ Tím (giống mẫu)
      const needCardColors = layout === 'card' && !CARD_PRESETS.some((c) => c.bandBg === p.frame.bandBg && c.decorColor === p.frame.decorColor);
      const { label: _l, ...cardColors } = CARD_PRESETS[0];
      return {
        ...p,
        frame: { ...p.frame, layout, ...(needCardColors ? cardColors : {}) },
        introSeconds: layout === 'band' || layout === 'card' ? (p.introSeconds > 0 ? p.introSeconds : 5) : p.introSeconds,
      };
    });

  const makeVoice = async (customText?: string): Promise<VoiceClip | null> => {
    const text = (customText ?? voiceText).trim();
    if (!text) return null;
    setVoiceBusy(true);
    try {
      const res = await api.post('/video-studio/tts', { text, voice: settings.voiceName, apiKey: getStoredGeminiKeys() }, { timeout: 120000 });
      if (!res.data?.success) throw new Error(res.data?.error);
      const clip = { url: res.data.url, duration: res.data.duration, engine: res.data.engine, text, voice: settings.voiceName };
      setVoice(clip);
      return clip;
    } catch (e: any) {
      console.warn('Tạo giọng đọc lỗi: ' + aiError(e));
      return null;
    } finally {
      setVoiceBusy(false);
    }
  };

  // ── Lấy video ──
  const resolveUrl = async (url: string): Promise<boolean> => {
    setResolving(true);
    setResultUrl('');
    try {
      const res = await api.post('/video-studio/resolve', { url }, { timeout: 240000 });
      if (!res.data?.success) throw new Error(res.data?.error || 'Không lấy được video');
      setSource(res.data);
      // Clip mới: luôn hiện trọn clip trước (không cắt viền), người dùng tự chọn lấp kín nếu muốn
      // Mặc định ra khổ full màn hình điện thoại 9:16 (TikTok/Reels); muốn vuông/4:5 thì đổi tay
      const a = res.data.width && res.data.height ? res.data.width / res.data.height : 0;
      const autoRatio: VideoRatio | null = a ? '9:16' : null;
      setFrame({ videoFit: 'contain', ...(autoRatio ? { ratio: autoRatio } : {}) });
      message.success(`Đã lấy video (${fmtSec(res.data.duration)}${res.data.hasAudio ? '' : ', không có tiếng gốc'})`);
      const parts = splitTitle(res.data.title || '');
      setSourceCaption(parts.caption);
      setCaption(parts.caption);
      setCredit(parts.source ? `Nguồn: ${parts.source}` : '');
      // Lấy caption/tiêu đề gốc của video làm tiêu đề khung và voice ngay để thấy khung preview liền
      const plain = plainCaption(parts.caption);
      const titleToUse = plain || res.data.title || 'TIÊU ĐỀ NỘI DUNG VIDEO';
      const speakable = speakableHeadline(titleToUse);
      setHeadline(titleToUse);
      setVoiceText(speakable);
      setVoiceEdited(false);
      // Tự động tạo giọng đọc AI ngay từ đầu (truyền speakable trực tiếp để tránh race condition React state)
      makeVoice(speakable);
      return true;
    } catch (e: any) {
      message.error('Lấy video lỗi: ' + aiError(e));
      return false;
    } finally {
      setResolving(false);
    }
  };

  const uploadFile = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await api.post('/media/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000 });
    if (!res.data?.success) throw new Error(res.data?.message || 'Upload lỗi');
    return res.data.url as string;
  };

  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (!file.type.startsWith('video/')) {
        message.warning('Vui lòng thả file video (định dạng .mp4, .mov, .webm)!');
        return;
      }
      setResolving(true);
      message.loading({ content: 'Đang tải file video lên...', key: 'drop_video' });
      try {
        const url = await uploadFile(file);
        await resolveUrl(url);
        message.success({ content: 'Đã tải và nhận diện video thành công!', key: 'drop_video' });
      } catch (err: any) {
        message.error({ content: 'Tải video thất bại: ' + (err?.message || err), key: 'drop_video' });
        setResolving(false);
      }
    }
  };

  const writePanelText = async (cap: string, src: string, videoUrl?: string) => {
    const fallback = () => {
      const plain = plainCaption(cap);
      if (plain) { setHeadline(plain); setVoiceEdited(false); }
    };
    if (!getStoredGeminiKeys().trim()) {
      fallback();
      message.info('Chưa có key AI — tạm dùng caption làm tiêu đề. Nhập key để AI tự viết chữ cho bảng');
      return;
    }
    setAiBusy(true);
    try {
      message.loading({ content: 'AI đang xem clip và viết chữ...', key: 'vs-ai', duration: 0 });
      const res = await api.post('/video-studio/panel-text', { caption: cap, source: src, videoUrl, apiKey: getStoredGeminiKeys() }, { timeout: 120000 });
      if (!res.data?.success) throw new Error(res.data?.error);
      message.success({ content: res.data.framesUsed ? `AI đã xem ${res.data.framesUsed} khung hình và viết xong` : 'AI đã viết xong', key: 'vs-ai' });
      setHeadline(res.data.headline);
      // Chỉ cập nhật caption nếu ô caption đăng bài đang trống (không ghi đè caption gốc của người dùng)
      if (!caption.trim() && res.data.caption) setCaption(res.data.caption);
      if (res.data.voice) { setVoiceText(res.data.voice); setVoiceEdited(true); } else setVoiceEdited(false);
    } catch (e: any) {
      fallback();
      message.error({ content: 'AI viết chữ lỗi, tạm dùng caption: ' + aiError(e), key: 'vs-ai' });
    } finally {
      setAiBusy(false);
    }
  };

  const aiHeadline = () => {
    if (!source) return message.warning('Lấy video trước để AI xem clip');
    const cap = sourceCaption.trim() || splitTitle(source.title || '').caption;
    return writePanelText(cap, credit.replace(/^Nguồn:\s*/, ''), source.url);
  };

  const [highlightBusy, setHighlightBusy] = useState(false);
  const aiHighlight = async () => {
    const text = headline.trim() || sourceCaption.trim();
    if (!text) return message.warning('Chưa có tiêu đề để tô màu');
    setHighlightBusy(true);
    try {
      message.loading({ content: 'AI đang chọn cụm từ để tô màu highlight...', key: 'vs-hl', duration: 0 });
      const res = await api.post('/video-studio/highlight-headline', {
        text,
        apiKey: getStoredGeminiKeys(),
      }, { timeout: 60000 });
      if (!res.data?.success) throw new Error(res.data?.error);
      setHeadline(res.data.headline);
      message.success({ content: 'Đã tô màu cụm từ đắt giá!', key: 'vs-hl' });
    } catch (e: any) {
      message.error({ content: 'Tô màu lỗi: ' + aiError(e), key: 'vs-hl' });
    } finally {
      setHighlightBusy(false);
    }
  };

  // ── Preview: video chạy, khung hiện trong intro, voice + nhạc phát kèm ──
  // Khung tiêu đề luôn hiển thị sẵn để người dùng căn chỉnh kích thước góc quay ngay từ đầu
  const rawView = false;
  // Chuyển cảnh khớp bản xuất: trong xD giây cuối intro, khung + bố cục khung mờ đi, bản hiện trọn clip hiện lên
  const xD = Number.isFinite(effectiveIntro) ? Math.min(1.0, Math.max(0.6, effectiveIntro / 3)) : 0;
  const showFrame = !rawView && t < effectiveIntro - xD;

  const syncAudio = () => {
    const v = videoRef.current;
    if (!v) return;
    const curTime = v.currentTime;
    setT(curTime);
    v.volume = Math.min(1, (curTime < duckUntil ? settings.duckVolume : settings.originalVolume) / 100);
    copies().forEach((c) => { if (Math.abs(c.currentTime - curTime) > 0.25) c.currentTime = curTime; });
    if (musicRef.current) musicRef.current.volume = Math.min(1, settings.musicVolume / 100);

    // Đồng bộ voiceRef theo thời gian video
    const vr = voiceRef.current;
    if (vr && voice && voiceUpToDate) {
      if (curTime < voiceSpan) {
        if (Math.abs(vr.currentTime - curTime) > 0.3) {
          vr.currentTime = curTime;
        }
        if (isPlaying && vr.paused) {
          vr.play().catch(() => {});
        }
      } else {
        if (!vr.paused) vr.pause();
      }
    }
  };

  const playPreview = async () => {
    const v = videoRef.current;
    if (!v) return;
    let clip = voiceUpToDate ? voice : null;
    if (!clip && voiceText.trim()) clip = await makeVoice();
    v.currentTime = 0;
    copies().forEach((c) => { c.currentTime = 0; });
    if (musicRef.current) { musicRef.current.currentTime = 0; musicRef.current.play().catch(() => {}); }
    await v.play().catch(() => {});
    copies().forEach((c) => { c.play().catch(() => {}); });
    if (clip && voiceRef.current) {
      voiceRef.current.src = clip.url;
      setTimeout(() => { voiceRef.current?.play().catch(() => {}); }, 300);
    }
  };

  const onPause = () => {
    setIsPlaying(false);
    copies().forEach((c) => c.pause());
    musicRef.current?.pause();
    voiceRef.current?.pause();
  };
  const onPlay = () => {
    setIsPlaying(true);
    copies().forEach((c) => { c.play().catch(() => {}); });
    if (music) musicRef.current?.play().catch(() => {});
    // Sync voice khi user tự bấm play (không qua playPreview)
    const v = videoRef.current;
    if (v && voiceRef.current && voice && voiceUpToDate) {
      const vr = voiceRef.current;
      const ct = v.currentTime;
      if (ct < (voice.duration + 0.5)) {
        vr.src = voice.url;
        vr.currentTime = Math.max(0, ct);
        vr.play().catch(() => {});
      }
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!source) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    const cur = frame.videoScale ?? 1.0;
    const next = Math.max(0.6, Math.min(2.5, Math.round((cur + delta) * 100) / 100));
    setFrame({ videoScale: next });
  };

  // Khung preview: scale khung 1080×H vào bề rộng hiển thị
  const previewBox = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = previewBox.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / FW));
    ro.observe(el);
    return () => ro.disconnect();
  }, [frame.ratio, FW]);

  // Mở editor → dừng preview của trang để không phát tiếng chồng
  useEffect(() => { if (editorOpen) videoRef.current?.pause(); }, [editorOpen]);

  // ── Xuất ──
  const exportVideo = async (): Promise<string | null> => {
    if (!source) { message.warning('Lấy video trước'); return null; }
    if (!headline.trim()) { message.warning('Nhập tiêu đề cho khung'); return null; }
    setExporting(true);
    try {
      let clip = voiceUpToDate ? voice : null;
      if (!clip && voiceText.trim()) clip = await makeVoice();
      message.loading({ content: 'Đang ghép video, khung, giọng đọc và nhạc...', key: 'vs-export', duration: 0 });
      const res = await api.post('/video-studio/render', {
        videoUrl: source.url,
        overlayHtml: frameHtml,
        ratio: isNews ? newsRatio : frame.ratio,
        introSeconds: alwaysOn ? 0 : effectiveIntro,
        transitionEffect: frame.transitionEffect || 'slidedown',
        videoFocusY: frame.videoFocusY ?? 50,
        videoOffsetY: frame.videoOffsetY ?? 0,
        videoScale: frame.videoScale ?? 1,
        videoRegionMode: isNews ? 'overlay' : 'fixed',
        brandHtml,
        videoTopPct: region.topPct,
        videoHeightPct: region.heightPct,
        videoFit: frame.layout !== 'band' ? frame.videoFit : 'contain',
        voiceUrl: clip?.url || '',
        musicUrl: music?.url || '',
        musicVolume: settings.musicVolume / 100,
        originalVolume: settings.originalVolume / 100,
        duckVolume: settings.duckVolume / 100,
      }, { timeout: 360000 });
      if (!res.data?.success) throw new Error(res.data?.error);
      setResultUrl(res.data.url);
      message.success({ content: 'Đã xuất video', key: 'vs-export' });
      return res.data.url;
    } catch (e: any) {
      message.error({ content: 'Xuất video lỗi: ' + aiError(e), key: 'vs-export' });
      return null;
    } finally {
      setExporting(false);
    }
  };

  const download = async () => {
    const url = resultUrl || (await exportVideo());
    if (!url) return;
    const res = await fetch(url);
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = href;
    a.download = (speakableHeadline(headline).slice(0, 60) || 'video-tin').replace(/[^\p{L}\p{N} _-]/gu, '') + '.mp4';
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
  };

  const sendToPoster = async () => {
    const url = resultUrl || (await exportVideo());
    if (!url) return;
    navigate('/dashboard/playwright', {
      state: { importedStudioPosts: [{ caption: (caption || speakableHeadline(headline)).trim(), imageUrl: url, mediaType: 'VIDEO' }] },
    });
  };

  // Đổi bất kỳ thiết lập nào → bản xuất cũ không còn khớp
  useEffect(() => { setResultUrl(''); }, [frameHtml, settings, voice, music, source?.url]);

  const sectionTitle = 'text-xs font-semibold text-slate-300';
  const label = 'text-[11px] text-slate-400 mb-1';

  // Nội dung tab Khung — dùng chung cho trang Studio và cột "Khung" trong Video Editor
  const frameTabContent = (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className={sectionTitle}>Kho khung và logo</span>
                <Button size="small" icon={<SaveOutlined />} onClick={() => { setSaveName(''); setSaveCategory(targetCategory); setSaveOpen(true); }}>
                  Lưu khung hiện tại
                </Button>
              </div>
              <div className="flex gap-2">
                <Select
                  size="small"
                  className="flex-1"
                  value={category}
                  onChange={setCategory}
                  options={[
                    { value: ALL, label: `Tất cả danh mục (${library.frames.length} khung, ${library.logos.length} logo)` },
                    ...library.categories.map((c) => ({
                      value: c,
                      label: `${c} (${library.frames.filter((f) => f.category === c).length} khung, ${library.logos.filter((x) => x.category === c).length} logo)`,
                    })),
                  ]}
                  popupRender={(menu) => (
                    <>
                      {menu}
                      <div className="flex gap-1 p-2 border-t border-slate-700">
                        <Input
                          size="small"
                          placeholder="Tên danh mục mới"
                          value={newCategory}
                          onChange={(e) => setNewCategory(e.target.value)}
                          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') addCategory(); }}
                        />
                        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={addCategory}>Thêm</Button>
                      </div>
                    </>
                  )}
                />
                {category !== ALL && category !== DEFAULT_CATEGORY && (
                  <Dropdown
                    trigger={['click']}
                    menu={{ items: [{ key: 'del', danger: true, label: `Xoá danh mục "${category}"` }], onClick: () => removeCategory(category) }}
                  >
                    <Button size="small" icon={<MoreOutlined />} />
                  </Dropdown>
                )}
              </div>
              {shownFrames.length === 0 ? (
                <div className="text-[11px] text-slate-500">Chưa có khung nào trong danh mục này. Chỉnh khung bên dưới rồi bấm "Lưu khung hiện tại".</div>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {shownFrames.map((f) => (
                    <div key={f.id} className="flex items-center gap-1.5 rounded border border-slate-700 hover:border-blue-500 px-1.5 py-1 cursor-pointer" onClick={() => applyFrame(f)}>
                      <span className="w-5 h-5 shrink-0 rounded-sm overflow-hidden flex flex-col border border-slate-600">
                        <SwatchFill bandBg={f.frame.bandBg} accent={f.frame.accent} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[11px] text-slate-200 truncate">{f.name}</span>
                        {category === ALL && <span className="block text-[10px] text-slate-500 truncate">{f.category}</span>}
                      </span>
                      <Dropdown
                        trigger={['click']}
                        menu={{
                          items: [
                            ...library.categories.filter((c) => c !== f.category).map((c) => ({ key: `mv:${c}`, label: `Chuyển sang ${c}` })),
                            { key: 'del', danger: true, label: 'Xoá khung' },
                          ],
                          onClick: ({ key, domEvent }) => {
                            domEvent.stopPropagation();
                            setLibrary((l) => ({
                              ...l,
                              frames: key === 'del'
                                ? l.frames.filter((x) => x.id !== f.id)
                                : l.frames.map((x) => (x.id === f.id ? { ...x, category: key.slice(3) } : x)),
                            }));
                          },
                        }}
                      >
                        <Button size="small" type="text" className="!w-5 !h-5 !p-0" icon={<MoreOutlined />} onClick={(e) => e.stopPropagation()} />
                      </Dropdown>
                    </div>
                  ))}
                </div>
              )}
            </div>


            <div className="space-y-2 border-t border-slate-800 pt-3">
              <div className={label}>Kiểu khung</div>
              <Segmented<FrameLayout>
                block
                size="small"
                value={frame.layout}
                onChange={setLayout}
                options={[{ value: 'news', label: 'Mẫu Ảnh Tin' }, { value: 'card', label: 'Thẻ nổi' }, { value: 'panel', label: 'Dải dưới' }, { value: 'band', label: 'Dải chữ' }]}
              />
              {frame.layout !== 'band' && (
                <Segmented<'cover' | 'contain'>
                  block
                  size="small"
                  value={frame.videoFit}
                  onChange={(v) => setFrame({ videoFit: v })}
                  options={[{ value: 'contain', label: 'Hiện trọn clip' }, { value: 'cover', label: 'Lấp kín (kiểu TikTok)' }]}
                />
              )}
              {frame.layout === 'card' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className={label}>Vị trí thẻ nổi</div>
                    <Segmented<BandPosition>
                      block
                      size="small"
                      value={frame.position || 'center'}
                      onChange={(v) => setFrame({ position: v })}
                      options={[{ value: 'top', label: 'Trên' }, { value: 'center', label: 'Giữa' }, { value: 'bottom', label: 'Dưới' }]}
                    />
                  </div>
                  <div>
                    <div className={label}>Căn chữ</div>
                    <Segmented<'center' | 'left'>
                      block
                      size="small"
                      value={frame.cardAlign}
                      onChange={(v) => setFrame({ cardAlign: v })}
                      options={[{ value: 'center', label: 'Căn giữa' }, { value: 'left', label: 'Căn trái' }]}
                    />
                  </div>
                </div>
              )}
              {isNews && (
                <div>
                  <div className={label}>Mẫu / khung kênh từ Studio Ảnh Tin</div>
                  <Select
                    size="small"
                    className="w-full"
                    value={frame.newsSource || 'default'}
                    onChange={(v) => setFrame({ newsSource: v })}
                    onDropdownVisibleChange={(open) => { if (open) setNewsSources(loadNewsSources()); }}
                    options={[
                      { value: 'default', label: 'Mẫu đang dùng bên Studio Ảnh Tin' },
                      ...(newsSources.presets.length ? [{ label: 'Mẫu đã lưu', options: newsSources.presets.map((p) => ({ value: `preset:${p.name}`, label: p.name })) }] : []),
                      ...(newsSources.frames.length ? [{ label: 'Khung kênh', options: newsSources.frames.map((f) => ({ value: `frame:${f.id}`, label: f.name })) }] : []),
                    ]}
                  />
                  <div className="text-[11px] text-slate-500 mt-1">Muốn đổi màu, logo, khung… thì chỉnh và lưu mẫu bên Studio Ảnh Tin rồi chọn lại ở đây.</div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className={sectionTitle}>Tiêu đề trên khung</span>
                <div className="flex items-center gap-1.5">
                  <Button size="small" type="primary" icon={<HighlightOutlined />} loading={highlightBusy} onClick={aiHighlight}>
                    AI Tô màu
                  </Button>
                  <Button size="small" icon={<ThunderboltOutlined />} loading={aiBusy} onClick={aiHeadline}>
                    AI viết mới
                  </Button>
                </div>
              </div>
              <TextArea
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder="VD: CỤ ÔNG 80 TUỔI [[CỨU 3 CHÁU NHỎ]] KHỎI ĐÁM CHÁY"
              />
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Bọc cụm cần tô màu trong [[ ]]</span>
                <span className="flex items-center gap-1.5">In hoa <Switch size="small" checked={frame.uppercase} onChange={(v) => setFrame({ uppercase: v })} /></span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className={label}>Tỉ lệ</div>
                <Select<VideoRatio> size="small" className="w-full" value={isNews ? newsRatio : frame.ratio} onChange={(v) => setFrame({ ratio: v })}
                  options={[...(isNews ? [] : [{ value: '9:16' as VideoRatio, label: '9:16 (TikTok/Reels)' }]), { value: '4:5', label: '4:5' }, { value: '1:1', label: '1:1' }]} />
              </div>
              {frame.layout === 'band' ? (
                <div>
                  <div className={label}>Vị trí dải chữ</div>
                  <Select<BandPosition> size="small" className="w-full" value={frame.position} onChange={(v) => setFrame({ position: v })}
                    options={[{ value: 'top', label: 'Trên' }, { value: 'center', label: 'Giữa' }, { value: 'bottom', label: 'Dưới' }]} />
                </div>
              ) : isNews ? null : (
                <div>
                  <div className={label}>Tên page trên bảng</div>
                  <Input size="small" value={frame.pageName} onChange={(e) => setFrame({ pageName: e.target.value })} placeholder="VD: Tin Tức 24h" />
                </div>
              )}
            </div>

            {!isNews && (<>
            <div className="space-y-1.5">
              {[
                ...(frame.layout === 'card' ? [{ title: 'Thẻ nổi + nền trang trí', presets: CARD_PRESETS as Array<{ label: string; bandBg: string; textColor: string; accent: string; decorColor?: string }> }] : []),
                { title: 'Kính mờ (ăn màu video phía sau)', presets: GLASS_PRESETS },
                { title: 'Màu đặc', presets: COLOR_PRESETS },
              ].map((group) => (
                <div key={group.title}>
                  <div className={label}>{group.title}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.presets.map((p) => {
                      const decor = (p as { decorColor?: string }).decorColor;
                      const on = p.bandBg === frame.bandBg && p.accent === frame.accent && (!decor || decor === frame.decorColor);
                      return (
                        <Tooltip key={p.label} title={p.label}>
                          <button
                            type="button"
                            onClick={() => setFrame({ bandBg: p.bandBg, textColor: p.textColor, accent: p.accent, ...(decor ? { decorColor: decor } : {}) })}
                            className={`w-8 h-8 rounded border-2 overflow-hidden flex flex-col ${on ? 'border-blue-500' : 'border-slate-700'}`}
                          >
                            <SwatchFill bandBg={p.bandBg} accent={p.accent} decor={decor} />
                          </button>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className={label}>Nhãn</div>
                <Input size="small" value={frame.badgeText} onChange={(e) => setFrame({ badgeText: e.target.value })} placeholder="Để trống nếu không cần" />
              </div>
              <div>
                <div className={label}>Cỡ chữ</div>
                <Slider min={0.8} max={1.3} step={0.05} value={frame.fontScale} onChange={(v) => setFrame({ fontScale: v })} className="!my-1" />
              </div>
            </div>

            {frame.layout === 'card' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className={label}>Vị trí card ↕ <span className="text-slate-500">({(frame.cardOffsetY ?? 0) > 0 ? '+' : ''}{frame.cardOffsetY ?? 0}%)</span></div>
                  <Slider min={-40} max={40} step={1} value={frame.cardOffsetY ?? 0} onChange={(v) => setFrame({ cardOffsetY: v })} className="!my-1" />
                </div>
                <div>
                  <div className={label}>To/nhỏ card <span className="text-slate-500">({Math.round((frame.cardScale ?? 1) * 100)}%)</span></div>
                  <Slider min={0.6} max={1.5} step={0.05} value={frame.cardScale ?? 1} onChange={(v) => setFrame({ cardScale: v })} className="!my-1" />
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-slate-400">Logo góc{category !== ALL ? ` · ${category}` : ''}</span>
                {frame.logoUrl && <Button size="small" type="link" className="!p-0 !h-auto text-[11px]" onClick={() => setFrame({ logoUrl: '' })}>Bỏ logo</Button>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {shownLogos.map((lg) => (
                  <Tooltip key={lg.id} title={category === ALL ? `${lg.name} · ${lg.category}` : lg.name}>
                    <div
                      className={`relative group w-11 h-11 rounded-full border-2 bg-white bg-center bg-cover cursor-pointer ${frame.logoUrl === lg.url ? 'border-blue-500' : 'border-slate-700 hover:border-slate-500'}`}
                      style={{ backgroundImage: `url('${lg.url}')` }}
                      onClick={() => setFrame({ logoUrl: lg.url })}
                    >
                      <button
                        type="button"
                        className="absolute -top-1 -right-1 hidden group-hover:flex w-4 h-4 items-center justify-center rounded-full bg-slate-900 border border-slate-600 text-red-400 text-[9px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLibrary((l) => ({ ...l, logos: l.logos.filter((x) => x.id !== lg.id) }));
                          if (frame.logoUrl === lg.url) setFrame({ logoUrl: '' });
                        }}
                      >
                        <DeleteOutlined />
                      </button>
                    </div>
                  </Tooltip>
                ))}
                <Upload
                  accept="image/*"
                  multiple
                  showUploadList={false}
                  customRequest={async ({ file, onSuccess, onError }) => {
                    try {
                      const url = await uploadFile(file as File);
                      const name = (file as File).name.replace(/\.[^.]+$/, '');
                      setLibrary((l) => ({ ...l, logos: [...l.logos, { id: newId(), name, url, category: targetCategory }] }));
                      setFrame({ logoUrl: url });
                      onSuccess?.({});
                    } catch (e: any) { message.error('Upload logo lỗi: ' + aiError(e)); onError?.(e); }
                  }}
                >
                  <Tooltip title={`Thêm logo vào danh mục ${targetCategory}`}>
                    <div className="w-11 h-11 rounded-full border-2 border-dashed border-slate-600 hover:border-blue-500 flex items-center justify-center text-slate-400 cursor-pointer">
                      <PlusOutlined />
                    </div>
                  </Tooltip>
                </Upload>
              </div>
            </div>

            </>)}

            {frame.layout === 'card' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-slate-400">Ảnh trang trí đáy{category !== ALL ? ` · ${category}` : ''}</span>
                  {frame.decorUrl && (
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      Nền màu chuyển <Switch size="small" checked={frame.decorGradient} onChange={(v) => setFrame({ decorGradient: v })} />
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <Tooltip title="Chỉ dải màu chuyển, không họa tiết">
                    <div
                      className={`h-12 rounded border-2 cursor-pointer flex items-center justify-center text-[10px] text-white ${!frame.decorUrl ? 'border-blue-500' : 'border-slate-700 hover:border-slate-500'}`}
                      style={{ background: frame.decorColor }}
                      onClick={() => setFrame({ decorUrl: '' })}
                    >
                      Chỉ nền màu
                    </div>
                  </Tooltip>
                  {shownDecors.map((d) => (
                    <Tooltip key={d.id} title={category === ALL ? `${d.name} · ${d.category}` : d.name}>
                      <div
                        className={`relative group h-12 rounded border-2 cursor-pointer bg-center bg-contain bg-no-repeat ${frame.decorUrl === d.url ? 'border-blue-500' : 'border-slate-700 hover:border-slate-500'}`}
                        style={{ backgroundColor: frame.decorColor, backgroundImage: `url('${d.url}')` }}
                        onClick={() => setFrame({ decorUrl: d.url })}
                      >
                        <button
                          type="button"
                          className="absolute -top-1 -right-1 hidden group-hover:flex w-4 h-4 items-center justify-center rounded-full bg-slate-900 border border-slate-600 text-red-400 text-[9px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLibrary((l) => ({ ...l, decors: l.decors.filter((x) => x.id !== d.id) }));
                            if (frame.decorUrl === d.url) setFrame({ decorUrl: '' });
                          }}
                        >
                          <DeleteOutlined />
                        </button>
                      </div>
                    </Tooltip>
                  ))}
                  <Upload
                    accept="image/png,image/webp"
                    showUploadList={false}
                    className="block [&_.ant-upload]:!block [&_.ant-upload]:w-full"
                    customRequest={async ({ file, onSuccess, onError }) => {
                      try {
                        const url = await uploadFile(file as File);
                        const name = (file as File).name.replace(/\.[^.]+$/, '');
                        setLibrary((l) => ({ ...l, decors: [...l.decors, { id: newId(), name, url, category: targetCategory }] }));
                        setFrame({ decorUrl: url });
                        onSuccess?.({});
                      } catch (e: any) { message.error('Upload ảnh trang trí lỗi: ' + aiError(e)); onError?.(e); }
                    }}
                  >
                    <Tooltip title={`Thêm ảnh PNG trong suốt vào danh mục ${targetCategory} (nên rộng 1080px, cao 500–900px)`}>
                      <div className="h-12 w-full rounded border-2 border-dashed border-slate-600 hover:border-blue-500 flex items-center justify-center text-slate-400 cursor-pointer">
                        <PlusOutlined />
                      </div>
                    </Tooltip>
                  </Upload>
                </div>
              </div>
            )}
          </div>
  );


  return (
    <>
    <div className="grid grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)_340px] xl:grid-cols-[300px_minmax(0,1fr)_360px] gap-4 items-start">
      {/* ── TRÁI: nguồn video ── */}
      <div
        className="app-surface p-3 space-y-3"
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={handleFileDrop}
      >
        <div className="flex items-center justify-between">
          <span className={sectionTitle}>Video nguồn</span>
          {(source || link.trim()) && (
            <Button size="small" type="link" danger className="!p-0 !h-auto text-[11px]" onClick={clearSession}>
              Làm clip khác
            </Button>
          )}
        </div>
        <TextArea
          value={link}
          onChange={(e) => setLink(e.target.value)}
          autoSize={{ minRows: 2, maxRows: 4 }}
          placeholder="Dán link TikTok, Douyin, Facebook, Instagram hoặc link .mp4"
        />
        <div className="flex gap-2">
          <Button block loading={resolving} disabled={!link.trim()} onClick={() => resolveUrl(link)}>
            Lấy video
          </Button>
          <Tooltip title="Lấy video rồi để AI tự viết tiêu đề, lồng tiếng, phụ đề, chữ hook, chọn nhạc và caption">
            <Button type="primary" block loading={resolving} disabled={!link.trim()} onClick={async () => {
              if (!getStoredGeminiKeys().trim()) { message.warning('Nhập key Gemini ở Cài đặt AI trước'); return; }
              if (await resolveUrl(link)) { setAutoAgent(true); setEditorOpen(true); }
            }}>
              AI làm trọn gói
            </Button>
          </Tooltip>
          <Upload
            accept="video/*"
            showUploadList={false}
            customRequest={async ({ file, onSuccess, onError }) => {
              setResolving(true);
              try {
                const url = await uploadFile(file as File);
                await resolveUrl(url);
                onSuccess?.({});
              } catch (e: any) {
                message.error('Upload video lỗi: ' + aiError(e));
                setResolving(false);
                onError?.(e);
              }
            }}
          >
            <Tooltip title="Upload file video từ máy"><Button icon={<UploadOutlined />} /></Tooltip>
          </Upload>
        </div>

        {source && (
          <div className="text-[11px] text-slate-400 space-y-1 border-t border-slate-800 pt-2">
            <div className="flex flex-wrap gap-1">
              <Tag className="!m-0">{fmtSec(source.duration)}</Tag>
              <Tag className="!m-0">{source.width}×{source.height}</Tag>
              <Tag className="!m-0" color={source.hasAudio ? 'blue' : 'default'}>{source.hasAudio ? 'Có tiếng gốc' : 'Không có tiếng'}</Tag>
            </div>
            {source.title && <div className="line-clamp-3 text-slate-300">{source.title}</div>}
          </div>
        )}

        <div className="border-t border-slate-800 pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className={sectionTitle}>Caption khi đăng</span>
            {sourceCaption && caption !== sourceCaption && (
              <Button size="small" type="link" className="!p-0 !h-auto text-[11px]" onClick={() => setCaption(sourceCaption)}>
                Dùng lại caption gốc
              </Button>
            )}
          </div>
          <TextArea value={caption} onChange={(e) => setCaption(e.target.value)} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="Nội dung bài đăng kèm video" />
          {sourceCaption && (
            <div className="text-[10px] text-slate-500">
              💡 Mặc định lấy nguyên văn caption từ clip gốc. Bạn có thể sửa trực tiếp ở đây.
            </div>
          )}
          {frame.layout === 'panel' && (
            <>
              <div className={label}>Dòng nguồn dưới video</div>
              <Input size="small" value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="VD: Nguồn: Không Sợ Chó (để trống nếu không cần)" />
            </>
          )}
        </div>
      </div>

      {/* ── GIỮA: preview ── */}
      <div className="app-surface p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className={sectionTitle}>Xem trước</span>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            {rawView ? 'Clip gốc — nhập tiêu đề (hoặc AI viết) để thêm khung' : alwaysOn ? 'Khung hiện suốt video' : `Khung hiện ${effectiveIntro}s đầu`}
            <Button size="small" icon={<PlayCircleOutlined />} disabled={!source} loading={voiceBusy} onClick={playPreview}>Xem từ đầu</Button>
            <Button
              size="small"
              type="primary"
              className="!bg-gradient-to-r !from-sky-500 !to-blue-600 font-semibold"
              icon={<VideoCameraOutlined />}
              onClick={() => {
                if (source) {
                  setEditorOpen(true);
                } else {
                  message.info('💡 Vui lòng dán link video hoặc bấm icon tải lên để lấy video trước khi mở Video Editor nhé!');
                }
              }}
            >
              Mở Video Editor
            </Button>
          </div>
        </div>
        {source && (
          <div className="space-y-1 bg-slate-900/90 border border-slate-700/80 rounded px-2.5 py-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px] text-slate-300 font-medium">
                🎬 Dời clip (CapCut):
              </span>
              <div className="flex items-center gap-1.5">
                <Segmented<string>
                  size="small"
                  value={
                    (frame.videoOffsetY ?? 0) <= -12
                      ? '-15'
                      : (frame.videoOffsetY ?? 0) >= 8
                      ? '10'
                      : '0'
                  }
                  onChange={(v) => setFrame({ videoOffsetY: Number(v) })}
                  options={[
                    { value: '-15', label: '⬆ Kéo lên' },
                    { value: '0', label: '⏺ Ở giữa' },
                    { value: '10', label: '⬇ Hạ xuống' },
                  ]}
                />
                <Slider
                  min={-35}
                  max={30}
                  value={frame.videoOffsetY ?? 0}
                  onChange={(v) => setFrame({ videoOffsetY: v })}
                  className="!w-20 !my-0 !ml-1"
                  tooltip={{ formatter: (v) => v! < 0 ? `Dời lên ${Math.abs(v!)}%` : v! > 0 ? `Hạ xuống ${v}%` : 'Ở giữa (0%)' }}
                />
                <span className="text-[10px] text-slate-400 w-8 text-right font-mono">
                  {(frame.videoOffsetY ?? 0) > 0 ? `+${frame.videoOffsetY}%` : `${frame.videoOffsetY ?? 0}%`}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-800/80 pt-1">
              <span className="flex items-center gap-1 text-[11px] text-slate-300 font-medium">
                🔍 Phóng to/nhỏ:
              </span>
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                <Segmented<string>
                  size="small"
                  value={
                    (frame.videoScale ?? 1) >= 1.9
                      ? '2.0'
                      : (frame.videoScale ?? 1) >= 1.65
                      ? '1.8'
                      : (frame.videoScale ?? 1) >= 1.38
                      ? '1.5'
                      : (frame.videoScale ?? 1) >= 1.15
                      ? '1.25'
                      : (frame.videoScale ?? 1) <= 0.9
                      ? '0.85'
                      : '1.0'
                  }
                  onChange={(v) => setFrame({ videoScale: Number(v) })}
                  options={[
                    { value: '0.85', label: '85%' },
                    { value: '1.0', label: '100%' },
                    { value: '1.25', label: '125%' },
                    { value: '1.5', label: '150%' },
                    { value: '1.8', label: '180%' },
                    { value: '2.0', label: '200%' },
                  ]}
                />
                <Slider
                  min={0.5}
                  max={3.0}
                  step={0.05}
                  value={frame.videoScale ?? 1}
                  onChange={(v) => setFrame({ videoScale: v })}
                  className="!w-24 !my-0 !ml-1"
                  tooltip={{ formatter: (v) => `${Math.round((v || 1) * 100)}%` }}
                />
                <span className="text-[10px] text-slate-400 w-10 text-right font-mono">
                  {Math.round((frame.videoScale ?? 1) * 100)}%
                </span>
              </div>
            </div>
          </div>
        )}
        <div className="flex justify-center">
          <div
            ref={previewBox}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingFile(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingFile(false); }}
            onDrop={handleFileDrop}
            className={`relative overflow-hidden bg-black rounded shadow-2xl select-none transition-all ${source ? 'cursor-ns-resize' : ''} ${isDraggingFile ? 'ring-2 ring-sky-400 ring-offset-2 ring-offset-slate-900' : ''}`}
            style={rawView && source
              ? { width: source.width / source.height < 0.8 ? 'min(100%, 320px)' : 'min(100%, 460px)', aspectRatio: `${source.width} / ${source.height}`, maxHeight: 'min(48vh, 480px)' }
              : { height: !isNews && frame.ratio === '9:16' ? 'min(60vh, 600px)' : 'min(48vh, 460px)', aspectRatio: `${FW} / ${H}`, maxWidth: '100%' }}
          >
            {isDraggingFile && (
              <div className="absolute inset-0 z-50 bg-blue-950/80 backdrop-blur-sm border-2 border-dashed border-sky-400 flex flex-col items-center justify-center text-sky-200 pointer-events-none rounded transition-all">
                <UploadOutlined className="text-4xl mb-2 animate-bounce text-sky-300" />
                <span className="font-bold text-sm text-white">Thả file video vào đây để bắt đầu ngay!</span>
                <span className="text-[11px] text-sky-300/80 mt-1">Hỗ trợ MP4, MOV, WebM</span>
              </div>
            )}
            {source ? (
              <>
                <div className="absolute top-2 left-2 z-10 bg-black/60 backdrop-blur text-[10px] text-slate-300 px-2 py-0.5 rounded pointer-events-none opacity-80 flex items-center gap-1">
                  👆 Kéo để dời clip (CapCut) · Cuộn chuột để phóng to/thu nhỏ
                </div>
                <video
                  ref={bgRef}
                  src={source.url}
                  muted
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                  style={{
                    filter: 'blur(18px) brightness(0.85) saturate(1.3)',
                    transform: 'scale(1.1)',
                    objectPosition: `center ${frame.videoFocusY ?? 50}%`,
                  }}
                />
                <video
                  ref={videoRef}
                  src={source.url}
                  playsInline
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  style={{
                    zIndex: 1,
                    background: 'transparent',
                    objectFit: showFrame
                      ? (frame.layout !== 'band' && frame.videoFit === 'cover' ? 'cover' : 'contain')
                      : 'contain',
                    objectPosition: showFrame ? `center ${frame.videoFocusY ?? 50}%` : 'center center',
                    transform: showFrame
                      ? `translateY(${frame.videoOffsetY ?? 0}%) scale(${frame.videoScale ?? 1})`
                      : 'translateY(0%) scale(1)',
                    transformOrigin: 'center center',
                    transition: isDraggingFocus ? 'none' : 'transform 0.9s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                  onTimeUpdate={syncAudio}
                  onSeeked={syncAudio}
                  onPlay={onPlay}
                  onPause={onPause}
                />
                {!rawView && (
                  <div
                    className="absolute inset-0 overflow-hidden pointer-events-none"
                    style={{
                      zIndex: 2,
                      opacity: showFrame ? 1 : 0,
                      transition: 'opacity 0.9s cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                  >
                    <video
                      ref={layoutBgRef}
                      src={source.url}
                      muted
                      playsInline
                      className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                      style={{
                        filter: 'blur(18px) brightness(0.85) saturate(1.3)',
                        transform: 'scale(1.1)',
                        objectPosition: `center ${frame.videoFocusY ?? 50}%`,
                      }}
                    />
                    <video
                      ref={layoutRef}
                      src={source.url}
                      muted
                      playsInline
                      className="absolute left-0 w-full pointer-events-none"
                      style={{
                        top: `${region.topPct}%`,
                        height: `${region.heightPct}%`,
                        transform: `translateY(${frame.videoOffsetY ?? 0}%) scale(${frame.videoScale ?? 1})`,
                        transformOrigin: 'center center',
                        background: 'transparent',
                        objectFit: frame.layout !== 'band' && frame.videoFit === 'cover' ? 'cover' : 'contain',
                        objectPosition: `center ${frame.videoFocusY ?? 50}%`,
                        transition: isDraggingFocus ? 'none' : 'transform 0.1s ease-out',
                      }}
                    />
                  </div>
                )}
                {/* Thanh điều khiển video ghim đáy (không bị lệch khi phóng to/dời clip) */}
                <div
                  className="absolute bottom-0 inset-x-0 z-20 bg-gradient-to-t from-black/90 via-black/60 to-transparent pt-6 pb-2 px-3 flex items-center gap-2 text-white select-none pointer-events-auto"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white text-xs transition"
                    title={isPlaying ? 'Tạm dừng' : 'Phát'}
                  >
                    {isPlaying ? <PauseOutlined /> : <CaretRightOutlined />}
                  </button>
                  <span className="font-mono text-[11px] text-slate-300 min-w-[75px] text-center">
                    {formatTime(t)} / {formatTime(duration)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={duration > 0 ? duration : 100}
                    step={0.1}
                    value={t}
                    onChange={(e) => seek(Number(e.target.value))}
                    className="flex-1 h-1.5 bg-slate-700/80 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => seek(0)}
                    title="Về đầu video (0:00)"
                    className="text-slate-400 hover:text-white text-xs px-1"
                  >
                    ⏮
                  </button>
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 text-xs px-6 text-center space-y-2 pointer-events-none select-none">
                <div className="w-12 h-12 rounded-full bg-slate-800/90 border border-slate-700/80 flex items-center justify-center text-slate-300 mb-1 shadow-lg">
                  <UploadOutlined className="text-xl text-sky-400" />
                </div>
                <div className="font-semibold text-slate-200 text-sm">Kéo & thả file video vào đây</div>
                <div className="text-[11px] text-slate-500 max-w-[260px]">hoặc dán link TikTok, Douyin, Facebook ở cột bên trái</div>
              </div>
            )}
            <iframe
              title="frame"
              ref={frameRef}
              srcDoc={frameHtml}
              onLoad={measureFrame}
              // Không dùng sandbox: iframe sandbox bị Chrome tách tiến trình riêng và vẽ thiếu/sai khi bị scale bằng transform.
              // HTML do chính app dựng (tiêu đề đã escape) nên chạy cùng origin vẫn an toàn.
              className="absolute top-0 left-0 pointer-events-none border-0"
              style={{
                width: FW,
                height: H,
                transform: `scale(${scale}) ${
                  showFrame
                    ? 'translate(0, 0)'
                    : frame.transitionEffect === 'slideup'
                    ? 'translateY(-36px)'
                    : frame.transitionEffect === 'wipeleft'
                    ? 'translateX(-48px)'
                    : frame.transitionEffect === 'zoomin'
                    ? 'scale(1.06)'
                    : frame.transitionEffect === 'fade'
                    ? 'translate(0, 0)'
                    : 'translateY(36px)'
                }`,
                transformOrigin: 'top left',
                zIndex: 3,
                opacity: showFrame ? 1 : 0,
                transition: 'opacity 0.9s cubic-bezier(0.4, 0, 0.2, 1), transform 0.9s cubic-bezier(0.4, 0, 0.2, 1)',
                background: 'transparent',
                // Trang nền tối mà iframe sáng → trình duyệt tô nền trắng đặc; để cùng color-scheme thì iframe trong suốt
                colorScheme: 'normal',
              }}
            />
            {brandHtml && !rawView && (
              <iframe
                title="brand"
                srcDoc={brandHtml}
                className="absolute top-0 left-0 pointer-events-none border-0"
                style={{
                  width: VIDEO_W, height: videoHeight(brandRatio), transform: `scale(${(scale * FW) / VIDEO_W})`, transformOrigin: 'top left',
                  zIndex: 3, opacity: showFrame ? 0 : 1, transition: showFrame ? 'opacity .2s' : 'opacity .5s ease .4s', background: 'transparent', colorScheme: 'normal',
                }}
              />
            )}
          </div>
        </div>
        <audio ref={voiceRef} hidden />
        {music && <audio ref={musicRef} src={music.url} loop hidden />}

        <div className="flex items-center justify-between gap-2 rounded border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-400">
          <span>Lồng tiếng, phụ đề, chữ, nhạc nền, cắt clip và timeline kéo thả nằm trong Video Editor.</span>
          <Button
            size="small"
            type="primary"
            className="!bg-gradient-to-r !from-sky-500 !to-blue-600 font-semibold"
            icon={<VideoCameraOutlined />}
            onClick={() => {
              if (source) {
                setEditorOpen(true);
              } else {
                message.info('💡 Vui lòng dán link video hoặc tải file video lên để mở Video Editor nhé!');
              }
            }}
          >
            Mở Video Editor
          </Button>
        </div>

        <div className="flex gap-2 justify-center flex-wrap">
          <Button type="primary" icon={<DownloadOutlined />} loading={exporting} disabled={!source} onClick={download}>Xuất và tải video</Button>
          <Button icon={<SendOutlined />} loading={exporting} disabled={!source} onClick={sendToPoster}>Chuyển sang lịch đăng</Button>
        </div>
        {resultUrl && (
          <div className="text-center text-[11px] text-slate-400">
            Bản xuất: <a href={resultUrl} target="_blank" rel="noreferrer" className="text-blue-400">{resultUrl.split('/').pop()}</a>
          </div>
        )}
      </div>

      {/* ── PHẢI: thiết lập ── */}
      <div className="app-surface p-3 space-y-3">
        {/* Thanh tab trên đỉnh để thao tác ngay lập tức, không phải cuộn chuột */}
        <Segmented<'frame' | 'timing' | 'audio'>
          block
          size="middle"
          value={activeTab}
          onChange={(v) => setActiveTab(v)}
          options={[
            { value: 'frame', label: '🎨 Khung' },
            { value: 'timing', label: '⏱ Chuyển cảnh' },
            { value: 'audio', label: '🎵 Âm thanh' },
          ]}
        />

        {activeTab === 'frame' && !editorOpen && frameTabContent}

        {activeTab === 'timing' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className={label}>Vị trí dời clip lên / xuống (như CapCut)</span>
                <span className="text-[11px] font-mono text-blue-400">
                  {(frame.videoOffsetY ?? 0) < 0 ? `Lên ${Math.abs(frame.videoOffsetY ?? 0)}%` : (frame.videoOffsetY ?? 0) > 0 ? `Xuống +${frame.videoOffsetY}%` : '0% (giữa)'}
                </span>
              </div>
              <Segmented<string>
                block
                size="small"
                value={
                  (frame.videoOffsetY ?? 0) <= -12
                    ? '-15'
                    : (frame.videoOffsetY ?? 0) >= 8
                    ? '10'
                    : '0'
                }
                onChange={(v) => setFrame({ videoOffsetY: Number(v) })}
                options={[
                  { value: '-15', label: '⬆ Kéo lên cao (-15%)' },
                  { value: '0', label: '⏺ Ở giữa (0%)' },
                  { value: '10', label: '⬇ Hạ xuống (+10%)' },
                ]}
              />
              <Slider
                min={-40}
                max={30}
                value={frame.videoOffsetY ?? 0}
                onChange={(v) => setFrame({ videoOffsetY: v })}
                tooltip={{ formatter: (v) => v! < 0 ? `Kéo lên ${Math.abs(v!)}%` : v! > 0 ? `Hạ xuống ${v}%` : 'Ở giữa (0%)' }}
              />
              <div className="text-[11px] text-slate-500">
                👉 Nhấn giữ chuột và kéo lên/xuống trực tiếp trên video để dời vị trí tức thì như CapCut.
              </div>
            </div>

            <div className="space-y-2 border-t border-slate-800 pt-3">
              <div className="flex items-center justify-between">
                <span className={label}>Thu phóng video (Zoom in/out)</span>
                <span className="text-[11px] font-mono text-blue-400">{Math.round((frame.videoScale ?? 1) * 100)}%</span>
              </div>
              <Segmented<string>
                block
                size="small"
                value={
                  (frame.videoScale ?? 1) >= 1.15
                    ? '1.2'
                    : (frame.videoScale ?? 1) <= 0.9
                    ? '0.85'
                    : '1.0'
                }
                onChange={(v) => setFrame({ videoScale: Number(v) })}
                options={[
                  { value: '0.85', label: '85% (Thu nhỏ)' },
                  { value: '1.0', label: '100% (Chuẩn)' },
                  { value: '1.2', label: '120% (Bung to)' },
                ]}
              />
              <Slider
                min={0.7}
                max={1.6}
                step={0.05}
                value={frame.videoScale ?? 1}
                onChange={(v) => setFrame({ videoScale: v })}
                tooltip={{ formatter: (v) => `${Math.round((v || 1) * 100)}%` }}
              />
            </div>

            <div className="space-y-2 border-t border-slate-800 pt-3">
              <div className="flex items-center justify-between">
                <span className={label}>Góc hiển thị khi cắt viền (Cover Focus)</span>
                <span className="text-[11px] font-mono text-slate-400">{frame.videoFocusY ?? 50}%</span>
              </div>
              <Slider
                min={0}
                max={100}
                value={frame.videoFocusY ?? 50}
                onChange={(v) => setFrame({ videoFocusY: v })}
                tooltip={{ formatter: (v) => `${v}% (0%: Đỉnh, 100%: Đáy)` }}
              />
            </div>

            {frame.layout !== 'band' && (
              <div className="space-y-1.5 border-t border-slate-800 pt-3">
                <div className={label}>Chế độ hiển thị video</div>
                <Segmented<'cover' | 'contain'>
                  block
                  size="small"
                  value={frame.videoFit}
                  onChange={(v) => setFrame({ videoFit: v })}
                  options={[{ value: 'contain', label: 'Hiện trọn clip' }, { value: 'cover', label: 'Lấp kín (kiểu TikTok)' }]}
                />
              </div>
            )}

            <div className="space-y-2 border-t border-slate-800 pt-3">
              <div className="flex items-center justify-between mb-1">
                <span className={label}>Thời gian hiện khung (tự kéo dài nếu voice dài hơn)</span>
                <span className="text-[10px] text-blue-400 font-medium">✨ Chuyển cảnh mềm mại</span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {[0, 3, 5, 7, 10].map((v) => (
                  <Button key={v} size="small" type={settings.introSeconds === v ? 'primary' : 'default'} onClick={() => setSettings((p) => ({ ...p, introSeconds: v }))}>
                    {v === 0 ? 'Luôn hiện' : `${v}s`}
                  </Button>
                ))}
              </div>
              {settings.introSeconds > 0 && (
                <div className="mt-3 space-y-3 pt-2 border-t border-slate-800/80">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className={label}>Kiểu chuyển cảnh khi hết {settings.introSeconds}s</span>
                      <span className="text-[10px] text-slate-500">FFmpeg + Preview</span>
                    </div>
                    <Select<TransitionEffect>
                      size="small"
                      className="w-full"
                      value={frame.transitionEffect || 'slidedown'}
                      onChange={(v) => setFrame({ transitionEffect: v })}
                      options={TRANSITION_OPTIONS}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Giữ "Nguồn" + logo góc trên sau khi khung ẩn</span>
                    <Switch size="small" checked={settings.keepBrand !== false} onChange={(v) => setSettings((p) => ({ ...p, keepBrand: v }))} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'audio' && (
          <div className="space-y-4">
            {/* Giọng đọc */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className={sectionTitle}>Giọng đọc AI</span>
                {voice && voiceUpToDate && <span className="text-[11px] text-slate-400">{voice.duration.toFixed(1)}s · {ENGINE_LABEL[voice.engine] || voice.engine}</span>}
              </div>
              <TextArea
                value={voiceText}
                onChange={(e) => { setVoiceText(e.target.value); setVoiceEdited(true); }}
                autoSize={{ minRows: 2, maxRows: 5 }}
                placeholder="Nội dung giọng đọc (mặc định là tiêu đề). Để trống nếu không cần voice"
              />
              {voiceEdited && (
                <Button size="small" type="link" className="!p-0 !h-auto text-[11px]" onClick={() => setVoiceEdited(false)}>Dùng lại tiêu đề</Button>
              )}
              <div className="flex gap-2">
                <Select size="small" className="flex-1" value={settings.voiceName} options={VOICES} onChange={(v) => setSettings((p) => ({ ...p, voiceName: v }))} />
                <Button
                  size="small"
                  icon={<SoundOutlined />}
                  loading={voiceBusy}
                  onClick={async () => {
                    const clip = voiceUpToDate ? voice : await makeVoice();
                    if (clip) new Audio(clip.url).play().catch(() => {});
                  }}
                >
                  Nghe thử
                </Button>
              </div>
            </div>

            {/* Âm thanh */}
            <div className="border-t border-slate-800 pt-3 space-y-2">
              <span className={sectionTitle}>Nhạc nền và âm lượng</span>
              <div className="flex gap-2">
                <Select
                  size="small"
                  className="flex-1"
                  allowClear
                  placeholder="Không dùng nhạc nền"
                  value={music?.url}
                  onChange={(v) => setMusic(v ? (bgmPresets.find((b) => b.url === v) || { url: v, name: music?.name || 'Nhạc tải lên' }) : null)}
                  options={[
                    ...(music && !bgmPresets.some((b) => b.url === music.url) ? [{ value: music.url, label: music.name }] : []),
                    ...bgmPresets.map((b) => ({ value: b.url, label: b.name })),
                  ]}
                />
                <Upload
                  accept="audio/*"
                  showUploadList={false}
                  customRequest={async ({ file, onSuccess, onError }) => {
                    try {
                      const url = await uploadFile(file as File);
                      setMusic({ url, name: (file as File).name });
                      onSuccess?.({});
                    } catch (e: any) { message.error('Upload nhạc lỗi: ' + aiError(e)); onError?.(e); }
                  }}
                >
                  <Button size="small" icon={<UploadOutlined />}>Tải nhạc</Button>
                </Upload>
              </div>
              {[
                { key: 'musicVolume' as const, text: 'Nhạc nền', disabled: !music },
                { key: 'originalVolume' as const, text: 'Tiếng gốc', disabled: source ? !source.hasAudio : false },
                { key: 'duckVolume' as const, text: 'Tiếng gốc lúc đọc', disabled: source ? !source.hasAudio : false },
              ].map((row) => (
                <div key={row.key} className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400 w-28 shrink-0">{row.text}</span>
                  <Slider className="flex-1 !my-1" min={0} max={100} disabled={row.disabled} value={settings[row.key]}
                    onChange={(v) => setSettings((p) => ({ ...p, [row.key]: v }))} />
                  <span className="text-[11px] text-slate-500 w-8 text-right">{settings[row.key]}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>

            <Modal title="Lưu khung vào kho" open={saveOpen} onOk={saveFrame} onCancel={() => setSaveOpen(false)} okText="Lưu" cancelText="Huỷ" width={380}>
              <div className="space-y-3">
                <div>
                  <div className={label}>Tên khung</div>
                  <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="VD: Khung Tin Tức - đỏ trắng" onPressEnter={saveFrame} autoFocus />
                </div>
                <div>
                  <div className={label}>Danh mục</div>
                  <Select className="w-full" value={saveCategory} onChange={setSaveCategory} options={library.categories.map((c) => ({ value: c, label: c }))} />
                </div>
                <div className="text-[11px] text-slate-500">Lưu tỉ lệ, vị trí, màu, nhãn, cỡ chữ, logo và thời gian hiện khung.</div>
              </div>
            </Modal>
    {source && (
      <VideoEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        source={source}
        ratio={isNews ? newsRatio : frame.ratio}
        H={isNews ? videoHeight(newsRatio) : H}
        frameHtml={frameHtml}
        FW={FW}
        FH={H}
        brandHtml={brandHtml}
        region={region}
        vt={{ fit: frame.layout !== 'band' ? frame.videoFit : 'contain', focusY: frame.videoFocusY ?? 50, offsetY: frame.videoOffsetY ?? 0, scale: frame.videoScale ?? 1 }}
        onVideoTransform={(p) => setFrame({
          ...(p.fit ? { videoFit: p.fit } : {}),
          ...(p.focusY != null ? { videoFocusY: p.focusY } : {}),
          ...(p.offsetY != null ? { videoOffsetY: p.offsetY } : {}),
          ...(p.scale != null ? { videoScale: p.scale } : {}),
        })}
        framePanel={<FramePanel ctl={{
          frame, setFrame, setLayout, headline, setHeadline,
          aiWrite: aiHeadline, aiHighlight, aiBusy, highlightBusy, isNews,
          newsOptions: [
            { value: 'default', label: 'Mẫu đang dùng bên Studio Ảnh Tin' },
            ...(newsSources.presets.length ? [{ label: 'Mẫu đã lưu', options: newsSources.presets.map((x) => ({ value: `preset:${x.name}`, label: x.name })) }] : []),
            ...(newsSources.frames.length ? [{ label: 'Khung kênh', options: newsSources.frames.map((x) => ({ value: `frame:${x.id}`, label: x.name })) }] : []),
          ],
          onNewsOpen: () => setNewsSources(loadNewsSources()),
          savedFrames: library.frames.map((x) => ({ id: x.id, name: x.name })),
          applySaved: (id) => { const fr = library.frames.find((x) => x.id === id); if (fr) applyFrame(fr); },
          openSave: () => { setSaveName(''); setSaveCategory(targetCategory); setSaveOpen(true); },
          logos: library.logos.map((l) => ({ name: l.name, url: l.url })),
          uploadLogo: async (file) => {
            const url = await uploadFile(file);
            setLibrary((l) => ({ ...l, logos: [...l.logos, { id: newId(), name: file.name.replace(/\.[^.]+$/, ''), url, category: targetCategory }] }));
            setFrame({ logoUrl: url });
          },
        }} />}
        defaults={{
          introSeconds: settings.introSeconds,
          transitionEffect: frame.transitionEffect || 'slidedown',
          keepBrand: settings.keepBrand !== false,
          voice: voiceUpToDate && voice ? voice : null,
          voiceText,
          voiceName: settings.voiceName,
          music,
          musicVolume: settings.musicVolume,
          originalVolume: settings.originalVolume,
          duckVolume: settings.duckVolume,
        }}
        bgmPresets={bgmPresets}
        logos={library.logos.map((l) => ({ name: l.name, url: l.url }))}
        uploadFile={uploadFile}
        apiKey={getStoredGeminiKeys}
        downloadName={(speakableHeadline(headline).slice(0, 60) || 'video-tin').replace(/[^\p{L}\p{N} _-]/gu, '')}
        onExported={setResultUrl}
        headline={headline}
        postCaption={caption}
        onHeadline={(h) => setHeadline(h)}
        onPostCaption={(c) => setCaption(c)}
        autoAgent={autoAgent}
        onAutoAgentDone={() => setAutoAgent(false)}
        onSendToPoster={(url) => navigate('/dashboard/playwright', {
          state: { importedStudioPosts: [{ caption: (caption || speakableHeadline(headline)).trim(), imageUrl: url, mediaType: 'VIDEO' }] },
        })}
      />
    )}
    </>
  );
}
