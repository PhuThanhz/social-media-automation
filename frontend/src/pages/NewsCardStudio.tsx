import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  App as AntdApp,
  Button,
  Checkbox,
  ColorPicker,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Popover,
  Progress,
  Segmented,
  Select,
  Slider,
  Spin,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Upload,
} from 'antd';
import { DeleteOutlined, DownloadOutlined, KeyOutlined, ReloadOutlined, UploadOutlined, CloudUploadOutlined, UndoOutlined, RedoOutlined, QuestionCircleOutlined, PlusOutlined, PictureOutlined, FilterOutlined, TagsOutlined, AppstoreOutlined, PlayCircleOutlined, SoundOutlined, MutedOutlined, EyeInvisibleOutlined, RobotOutlined } from '@ant-design/icons';
import FacebookPostPreview from '../components/studio/FacebookPostPreview';
import api from '../config/axios';
import { getStoredGeminiKeys, saveStoredGeminiKeys } from '../components/modals/AiSettingsModal';
import {
  BADGE_PRESETS,
  buildNewsCardHtml,
  CARD_SIZE,
  cardHeight,
  COLOR_PRESETS,
  cornerPercent,
  DEFAULT_CARD_STYLE,
  defaultLayoutFor,
  IMAGES_PER_LAYOUT,
  LAYOUTS_BY_COUNT,
  LOGO_FRAME_BG_PRESETS,
  TEMPLATES,
  normalizeTemplate,
  normalizeHeadlineSpaces,
  logoBoxAspect,
  logoSourceOf,
  type BadgeOptions,
  type CardSpec,
  type CardTemplate,
  type CardLayout,
  type CardRatio,
  type CardStyle,
  type Corner,
  type InsetOptions,
  type LogoFrame,
} from '../utils/newsCardTemplate';
import { removeLogoBackground } from '../utils/removeLogoBackground';

const { TextArea } = Input;

// Bài đưa vào Studio: tự cào full nội dung + toàn bộ ảnh, AI soạn tiêu đề/caption, chỉnh mẫu ảnh rồi chuyển đi đăng.
export interface StudioIncomingArticle {
  url: string;
  title?: string;
  sapo?: string;
  content?: string;
  coverImage?: string;
  source?: string;
  // Bài đã có sẵn nội dung + ảnh (VD bài Reddit từ Săn bài Viral) → không cào lại link
  images?: string[];
  preScraped?: boolean;
  videoUrl?: string;
  isVideo?: boolean;
}

type CaptionMode = 'full' | 'hook';

interface StudioItem {
  id: string;
  url: string;
  title: string;
  sapo?: string;
  content?: string;
  source?: string;
  images: string[];
  videoUrl?: string;
  isVideo?: boolean;
  smallImages?: string[]; // ảnh quá nhỏ (icon/logo) — vẫn hiện nhưng làm mờ
  imageSizes?: Record<string, [number, number]>; // kích thước thật đo được trên trình duyệt
  fitManual?: boolean; // người dùng đã tự chọn cách vừa khung → không tự đổi nữa
  status: 'loading' | 'ready' | 'error';
  preScraped?: boolean;
  error?: string;
  headline: string;
  headlineLoading?: boolean;
  aiPending?: boolean; // vừa cào xong, đang chờ tới lượt AI soạn bài
  aiError?: string; // lần gọi AI gần nhất bị lỗi — hiện rõ cho người dùng thay vì để trống
  headlineFromTitle?: boolean; // tiêu đề đang tạm lấy từ tiêu đề bài báo (AI lỗi)
  // Nội dung do AI soạn (gói "AI soạn bài")
  hook?: string; // caption ngắn gây tò mò
  summary?: string; // tóm tắt chia đoạn có nguồn
  badgeSuggestion?: string;
  captionMode: CaptionMode;
  caption?: string; // chế độ caption đầy đủ — undefined = mặc định (tóm tắt AI hoặc nội dung bài)
  comment?: string; // chế độ hook — nội dung ở bình luận đầu, undefined = mặc định
  selectedImages: string[];
  layout: CardLayout;
  inset?: InsetOptions; // ảnh tròn (không bắt buộc)
  badge?: BadgeOptions; // nhãn góc (không bắt buộc)
  style: CardStyle;
  checked: boolean;
  sentToPoster?: boolean;
  cardUrl?: string;
  cardHtml?: string; // HTML đã dùng để xuất cardUrl — khác HTML hiện tại thì phải xuất lại
  channelId?: string;
  channelName?: string;
}

interface StylePreset {
  name: string;
  style: CardStyle;
}

export interface CustomFramePreset {
  id: string;
  name: string;
  tagColor?: string; // màu nhãn nhận diện kênh (#ef4444, #f59e0b, #3b82f6,...)
  url: string;
  template?: CardTemplate; // Mẫu thiết kế liên kết với kênh (gradient, editorial, breaking, etc.)
  bandBg?: string;
  photoTop?: number;
  photoHeight?: number;
  textBottom?: number;
  textLeft?: number;
  textRight?: number;
  textHeight?: number;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  accent?: string;
  footerText?: string;
  // Logo thương hiệu của kênh
  showLogo?: boolean;
  logoUrl?: string;
  logoPos?: Corner;
  logoSize?: number;
  logoOpacity?: number;
  logoFrame?: LogoFrame;
  logoFrameBg?: string;
  logoBgRemoved?: boolean;
  logoNoBgUrl?: string;
}

const ITEMS_KEY = 'newsCardStudio.items.v1';
const DEFAULTS_KEY = 'newsCardStudio.defaults.v1';
const PRESETS_KEY = 'newsCardStudio.presets.v1';
const CUSTOM_FRAMES_KEY = 'newsCardStudio.customFrames.v1';
const AI_KEY = 'newsCardStudio.geminiKey';
const PREVIEW_MODE_KEY = 'newsCardStudio.previewMode';

const DEFAULT_CUSTOM_FRAMES: CustomFramePreset[] = [
  {
    id: 'vietnam_health_news',
    name: 'Vietnam Healthy New',
    tagColor: '#ef4444',
    url: 'http://localhost:8081/uploads/43130ba9-7445-4a77-998d-2436b85c5e11.png',
    template: 'classic',
    photoTop: 0,
    photoHeight: 68,
    textBottom: 4,
    textLeft: 6,
    textRight: 6,
    textHeight: 24,
    textAlign: 'center',
    textColor: '#111111',
    accent: '#e3151a',
    footerText: 'VIETNAM HEALTHY NEW',
    showLogo: true,
    logoUrl: 'http://localhost:8081/uploads/8e90b86e-d533-4521-b58d-82cd1880c07f.png',
    logoPos: 'tr',
    logoSize: 220,
    logoOpacity: 1,
    logoFrame: 'none',
  },
];

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl/Cmd + Z', 'Hoàn tác'],
  ['Ctrl/Cmd + Shift + Z', 'Làm lại'],
  ['Ctrl/Cmd + E', 'Tải ảnh bài đang mở về máy'],
  ['↑ / ↓', 'Chuyển bài trước / sau'],
  ['Ctrl/Cmd + B', 'Tô màu cụm đang bôi đen trong tiêu đề'],
];

// Các trường người dùng chỉnh tay — dùng cho hoàn tác / làm lại
type EditSnapshot = Pick<StudioItem, 'headline' | 'style' | 'layout' | 'selectedImages' | 'inset' | 'badge' | 'caption' | 'hook' | 'comment' | 'captionMode' | 'fitManual'>;
const snapshotOf = (it: StudioItem): EditSnapshot => ({
  headline: it.headline, style: it.style, layout: it.layout, selectedImages: it.selectedImages, inset: it.inset, badge: it.badge,
  caption: it.caption, hook: it.hook, comment: it.comment, captionMode: it.captionMode, fitManual: it.fitManual,
});
const HISTORY_LIMIT = 50;

const fileNameOf = (title: string, i: number) => {
  const slug = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `anh-tin-${i + 1}${slug ? `-${slug}` : ''}.png`;
};

const loadJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

// Giống caption mặc định backend tạo khi không có caption riêng (NewsRadarController.batch-queue)
const defaultCaption = (it: StudioItem) =>
  [it.title && `📌 ${it.title}`, it.sapo && `💡 ${it.sapo}`, it.content].filter(Boolean).join('\n\n');

const cleanHeadline = (h: string) => normalizeHeadlineSpaces(h.trim().replace(/[.。]+$/, ''));

// Đo kích thước ảnh (để bỏ icon/logo nhỏ và tự chọn ảnh to nhất)
const probeImage = (url: string): Promise<{ url: string; w: number; h: number }> =>
  new Promise((resolve) => {
    const img = new window.Image();
    img.referrerPolicy = 'no-referrer';
    const done = (w: number, h: number) => resolve({ url, w, h });
    const t = setTimeout(() => done(0, 0), 8000);
    img.onload = () => { clearTimeout(t); done(img.naturalWidth, img.naturalHeight); };
    img.onerror = () => { clearTimeout(t); done(0, 0); };
    img.src = url;
  });

const MIN_IMAGE_SIDE = 300; // nhỏ hơn: coi là icon/logo
const BAND_ESTIMATE = 380; // chiều cao gần đúng của dải chữ
const BLUR_FACTOR = 1.6; // phóng ảnh quá mức này là thấy mờ rõ
const MAX_AUTO_CROP = 0.12; // cắt mất hơn 12% chiều cao ảnh (thường là tiêu đề/chữ trên infographic) → giữ đủ ảnh

// Kích thước gần đúng (px) của từng ô ảnh theo bố cục và khung
const cellsFor = (layout: CardLayout, ratio: CardRatio): Array<[number, number]> => {
  const H = cardHeight(ratio) - BAND_ESTIMATE;
  const half = (H - 6) / 2;
  switch (layout) {
    case 'h2': return [[717, H], [717, H]];
    case 'v2': return [[1440, half], [1440, half]];
    case 'wide2': return [[956, H], [478, H]];
    case 'diag2': return [[1440, H], [1440, H]];
    case 'stack2': return [[1440, H], [576, H * 0.46]];
    case 'h3': return [[476, H], [476, H], [476, H]];
    case 'mid3': return [[400, H], [640, H], [400, H]];
    case '1+2': return [[862, H], [575, half], [575, half]];
    case 'top1+2': return [[1440, H * 0.6], [717, H * 0.4], [717, H * 0.4]];
    case 'grid4': return [[717, half], [717, half], [717, half], [717, half]];
    case 'top1+3': return [[1440, H * 0.69], [476, H * 0.31], [476, H * 0.31], [476, H * 0.31]];
    case 'left1+3': return [[990, H], [450, H / 3], [450, H / 3], [450, H / 3]];
    default: return [[1440, H]];
  }
};

// Cắt đầy ô (cover) có làm mất nội dung quan trọng không:
// - cắt trên/dưới > 12%: ảnh vuông/dọc, infographic hay mất tiêu đề và chữ
// - ảnh gần vuông (thường là đồ hoạ/bảng biểu) bị cắt hai bên > 5%: mất chữ ở mép
// Ảnh chụp ngang bị cắt hai bên thì bình thường, không tính.
const coverLosesContent = (size: [number, number], cell: [number, number]) => {
  const scale = Math.max(cell[0] / size[0], cell[1] / size[1]);
  const cropV = 1 - cell[1] / (size[1] * scale);
  const cropH = 1 - cell[0] / (size[0] * scale);
  const nearSquare = size[0] / size[1] <= 1.25;
  return cropV > MAX_AUTO_CROP || (nearSquare && cropH > 0.05);
};

// Mức phóng to của ảnh khi lấp ô (cover) hoặc vừa ô (contain)
const upscaleOf = (size: [number, number], cell: [number, number], fit: CardStyle['fit']) => {
  const fx = cell[0] / size[0];
  const fy = cell[1] / size[1];
  return fit === 'contain' ? Math.min(fx, fy) : Math.max(fx, fy);
};

// Báo thường trả ảnh thu nhỏ ở trang danh mục/RSS — đổi về link ảnh gốc
// (cafefcdn .../zoom/250_157/..., .../thumb_w/640/..., vnecdn ?w=..., znews .../w480/...)
const upgradeImageUrl = (url: string): string => {
  let u = url
    .replace(/\/zoom\/\d+_\d+\//, '/')
    .replace(/\/thumb_w\/\d+\//, '/')
    .replace(/\/thumb_x\d+x\d+\//, '/')
    .replace(/\/resize\/\d+x\d+\//, '/')
    .replace(/\/w\d{2,4}\//, '/');
  return u;
};

// Đo + xếp hạng ảnh: thêm bản gốc của các thumbnail, ưu tiên ảnh to nhất, đánh dấu ảnh nhỏ (icon/logo)
const analyzeImages = async (urls: string[]) => {
  const candidates = Array.from(new Set(urls.flatMap((u) => [upgradeImageUrl(u), u]))).slice(0, 40);
  const sizes = await Promise.all(candidates.map(probeImage));
  const byUrl = new Map(sizes.map((x) => [x.url, x]));
  // Thumbnail có bản gốc tải được (không nhỏ hơn) thì bỏ thumbnail — VD cafefcdn thumb_w/1200 trùng ảnh gốc 1200px
  const kept = candidates.filter((u) => {
    const up = upgradeImageUrl(u);
    const upW = byUrl.get(up)?.w || 0;
    return up === u || !(upW > 0 && upW >= (byUrl.get(u)?.w || 0));
  });
  const small = kept.filter((u) => { const x = byUrl.get(u)!; return x.w > 0 && Math.min(x.w, x.h) < MIN_IMAGE_SIDE; });
  const loaded = kept.filter((u) => (byUrl.get(u)?.w || 0) > 0 && !small.includes(u))
    .sort((a, b) => byUrl.get(b)!.w * byUrl.get(b)!.h - byUrl.get(a)!.w * byUrl.get(a)!.h);
  // Ảnh trình duyệt không tải được có thể chỉ do chặn hotlink (worker vẫn tải được) nên vẫn giữ, xếp sau
  const ordered = Array.from(new Set([...loaded, ...kept.filter((u) => !small.includes(u)), ...small]));
  const imageSizes: Record<string, [number, number]> = {};
  kept.forEach((u) => { const x = byUrl.get(u)!; if (x.w > 0) imageSizes[u] = [x.w, x.h]; });
  return { ordered, small, imageSizes };
};

const sourceName = (url: string) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const known: Record<string, string> = {
      'cafef.vn': 'CafeF', 'vnexpress.net': 'VnExpress', 'dantri.com.vn': 'Dân Trí', 'tuoitre.vn': 'Tuổi Trẻ',
      'thanhnien.vn': 'Thanh Niên', 'vietnamnet.vn': 'VietNamNet', 'znews.vn': 'ZNews', 'kenh14.vn': 'Kênh 14',
      'cafebiz.vn': 'CafeBiz', 'vneconomy.vn': 'VnEconomy', 'laodong.vn': 'Lao Động', 'tienphong.vn': 'Tiền Phong',
      'reddit.com': 'Reddit', 'v.redd.it': 'Reddit', 'redd.it': 'Reddit',
      'threads.net': 'Threads', 'tiktok.com': 'TikTok', 'facebook.com': 'Facebook', 'fb.com': 'Facebook',
      'youtube.com': 'YouTube', 'youtu.be': 'YouTube',
    };
    if (host.includes('reddit')) return 'Reddit';
    if (host.includes('threads')) return 'Threads';
    if (host.includes('tiktok')) return 'TikTok';
    if (host.includes('facebook') || host === 'fb.com') return 'Facebook';
    if (host.includes('youtube') || host === 'youtu.be') return 'YouTube';
    return known[host] || host;
  } catch {
    return 'Báo điện tử';
  }
};

const specOf = (it: StudioItem, transparentPhoto = false, unmuteVideo = false): CardSpec => ({
  headline: it.headline,
  summary: it.summary || it.hook || it.caption || it.title,
  title: it.title,
  images: it.selectedImages,
  videoUrl: it.videoUrl,
  unmuteVideo,
  transparentPhoto,
  layout: it.layout,
  inset: it.inset,
  badge: it.badge,
  credit: `Nguồn: ${sourceName(it.url)}`,
  style: it.style,
});

const cleanCreditText = (text: string) =>
  text.replace(/Nguồn:\s*reddit\.com/gi, 'Nguồn: Reddit');

const withSource = (text: string, url: string) => {
  const cleaned = cleanCreditText(text.trim());
  return /Nguồn:/i.test(cleaned) ? cleaned : `${cleaned}\n\nNguồn: ${sourceName(url)}`;
};

// [[...]] chỉ có nghĩa trong tiêu đề trên ảnh
const stripMarks = (t: string) => t.replace(/\[\[|\]\]/g, '');

const fullCaptionOf = (it: StudioItem) => cleanCreditText(it.caption ?? (it.summary || defaultCaption(it)));
const commentOf = (it: StudioItem) => cleanCreditText(it.comment ?? (it.summary || defaultCaption(it)));

// Bản đưa sang Đăng tự động
const postOf = (it: StudioItem) =>
  it.captionMode === 'hook'
    ? { caption: stripMarks(it.hook || it.title).trim(), comment: withSource(stripMarks(commentOf(it)), it.url) }
    : { caption: withSource(stripMarks(fullCaptionOf(it)), it.url), comment: undefined as string | undefined };

const estimateBadgeWidth = (b: Pick<BadgeOptions, 'text' | 'size'>) => b.text.length * b.size * 0.72 + b.size * 1.3;

// Dữ liệu cũ trong localStorage (trước khi có vị trí tự do / nhãn / caption hook / phục hồi link ảnh)
const migrateItem = (it: any): StudioItem => {
  const { insetImage, ...rest } = it;
  let inset: InsetOptions | undefined = it.inset;
  if (!inset && insetImage) inset = { url: insetImage, zoom: 1, x: 50, y: 50, left: 3, top: 4, size: 380 };
  if (inset && (inset.left === undefined || inset.top === undefined)) {
    inset = { ...inset, left: (inset as any).corner === 'tr' ? 69 : 3, top: 4, size: inset.size || 380 };
  }

  // Khôi phục URL ảnh VnExpress nếu bị mất query param chữ ký (?s=...)
  let selectedImages: string[] = Array.isArray(it.selectedImages) ? [...it.selectedImages] : [];
  let wasVneFixed = false;
  const allImages: string[] = Array.isArray(it.images) ? it.images : [];
  selectedImages = selectedImages.map((sel) => {
    if (typeof sel === 'string' && /vnecdn\.net|vnexpress/.test(sel) && !sel.includes('s=')) {
      const pathPart = sel.split('?')[0];
      const valid = allImages.find((img) => typeof img === 'string' && img.includes(pathPart) && img.includes('s='));
      if (valid) {
        wasVneFixed = true;
        return valid;
      }
    }
    return sel;
  });

  // Nếu ảnh VnExpress từng bị cắt query param khiến cardUrl sinh ra bị đen, xóa cardUrl cũ để render lại
  const cardUrl = wasVneFixed ? undefined : it.cardUrl;
  const cardHtml = wasVneFixed ? undefined : it.cardHtml;

  return {
    ...rest,
    selectedImages,
    cardUrl,
    cardHtml,
    headlineLoading: false,
    captionMode: it.captionMode || 'full',
    style: { ...DEFAULT_CARD_STYLE, ...it.style },
    inset,
  } as StudioItem;
};

export default function NewsCardStudio() {
  const { message } = AntdApp.useApp();
  const location = useLocation();
  const navigate = useNavigate();

  const [defaults, setDefaults] = useState<CardStyle>(() => ({ ...DEFAULT_CARD_STYLE, ...loadJson(DEFAULTS_KEY, {}) }));
  const [items, setItems] = useState<StudioItem[]>(() => loadJson<any[]>(ITEMS_KEY, []).map(migrateItem));
  const [activeId, setActiveId] = useState<string | null>(() => loadJson<StudioItem[]>(ITEMS_KEY, [])[0]?.id || null);
  const [presets, setPresets] = useState<StylePreset[]>(() => loadJson(PRESETS_KEY, []));
  const [linkInput, setLinkInput] = useState('');
  const [exporting, setExporting] = useState(false);
  const processingRef = useRef(false);

  // Gemini API key riêng của người dùng (lưu trên trình duyệt này, gửi kèm mỗi lần gọi AI)
  const [geminiKey, setGeminiKey] = useState<string>(() => getStoredGeminiKeys());
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');

  useEffect(() => {
    const handleKeyChange = (e: any) => {
      if (typeof e.detail === 'string') {
        setGeminiKey(e.detail);
      }
    };
    window.addEventListener('gemini-keys-changed', handleKeyChange);
    return () => window.removeEventListener('gemini-keys-changed', handleKeyChange);
  }, []);

  const parsedKeys = useMemo(() => {
    return geminiKey
      .split(/[\n,;]+/)
      .map((k) => k.trim())
      .filter(Boolean);
  }, [geminiKey]);
  const aiExtra = useMemo(() => (geminiKey ? { apiKey: geminiKey } : {}), [geminiKey]);

  const active = items.find((i) => i.id === activeId) || null;

  useEffect(() => {
    localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
  }, [items]);

  // Tự động dọn sạch các cardUrl cũ (từng bị sinh ra ảnh đen do lỗi chữ ký CDN)
  useEffect(() => {
    setItems((prev) => {
      let changed = false;
      const next = prev.map((it) => {
        if (it.cardUrl && it.cardUrl.includes('/uploads/newscard-')) {
          changed = true;
          return { ...it, cardUrl: undefined, cardHtml: undefined };
        }
        return it;
      });
      return changed ? next : prev;
    });
  }, []);

  const patchItem = useCallback((id: string, patch: Partial<StudioItem> | ((it: StudioItem) => Partial<StudioItem>)) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...(typeof patch === 'function' ? patch(it) : patch) } : it)));
  }, []);

  const addArticles = useCallback((list: StudioIncomingArticle[]) => {
    setItems((prev) => {
      const existing = new Set(prev.map((p) => p.url));
      const fresh: StudioItem[] = list
        .filter((a) => a.url && !existing.has(a.url))
        .map((a) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url: a.url,
          title: a.title || a.url,
          sapo: a.sapo,
          content: a.content,
          source: a.source,
          images: a.images?.length ? a.images : a.coverImage ? [a.coverImage] : [],
          videoUrl: a.videoUrl,
          isVideo: a.isVideo || !!a.videoUrl,
          preScraped: a.preScraped,
          status: 'loading',
          headline: '',
          captionMode: 'full',
          selectedImages: a.coverImage ? [a.coverImage] : (a.images?.length ? [a.images[0]] : []),
          layout: 'single',
          style: { ...defaults },
          checked: true,
        }));
      if (fresh.length > 0) setActiveId((cur) => cur || fresh[0].id);
      return [...prev, ...fresh];
    });
  }, [defaults]);

  // Nhận bài từ Radar Tin Tức (router state), xoá state để F5 không thêm lại
  useEffect(() => {
    const incoming = (location.state as any)?.studioArticles as StudioIncomingArticle[] | undefined;
    if (incoming && incoming.length > 0) {
      addArticles(incoming);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── AI ──
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  const [suggesting, setSuggesting] = useState(false);
  const [captionAiLoading, setCaptionAiLoading] = useState(false);
  const [batchCaptionLoading, setBatchCaptionLoading] = useState(false);
  const [batchCaptionProgress, setBatchCaptionProgress] = useState<string | null>(null);
  const aiError = (e: any) => e?.response?.data?.error || e.message;

  const articlePayload = (it: StudioItem) => ({
    title: it.title, sapo: it.sapo || '', content: it.content || it.sapo || '', source: sourceName(it.url), ...aiExtra,
  });

  const generateHeadline = useCallback(async (it: StudioItem) => {
    if (!geminiKey || !geminiKey.trim()) {
      setKeyDraft('');
      setAiModalOpen(true);
      message.warning('Vui lòng nhập ít nhất 1 Gemini API Key để kích hoạt AI!');
      return false;
    }
    patchItem(it.id, { headlineLoading: true });
    try {
      const res = await api.post('/news-card/headline', articlePayload(it));
      if (!res.data?.success || !res.data.headline) throw new Error(res.data?.error || 'AI không trả về tiêu đề');
      patchItem(it.id, { headline: cleanHeadline(res.data.headline), headlineLoading: false, aiError: undefined, headlineFromTitle: false });
      return true;
    } catch (e: any) {
      patchItem(it.id, { headlineLoading: false, aiError: aiError(e) });
      message.error('AI viết tiêu đề lỗi: ' + aiError(e));
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchItem, message, aiExtra, geminiKey]);

  // "AI soạn bài": tiêu đề ảnh + caption hook + tóm tắt có nguồn + gợi ý nhãn — 1 lần gọi
  const runPackage = useCallback(async (it: StudioItem, silent = false) => {
    if (!geminiKey || !geminiKey.trim()) {
      setKeyDraft('');
      setAiModalOpen(true);
      if (!silent) message.warning('Vui lòng nhập ít nhất 1 Gemini API Key để kích hoạt AI!');
      return false;
    }
    patchItem(it.id, { headlineLoading: true });
    try {
      const res = await api.post('/news-card/package', articlePayload(it));
      if (!res.data?.success || !res.data.headline) throw new Error(res.data?.error || 'AI không trả về kết quả');
      const d = res.data;
      patchItem(it.id, {
        headline: cleanHeadline(String(d.headline)),
        // [[...]] chỉ dùng cho tiêu đề trên ảnh — bỏ nếu AI lỡ chèn vào caption/tóm tắt
        hook: d.hook ? String(d.hook).replace(/\[\[|\]\]/g, '') : undefined,
        summary: d.summary ? String(d.summary).replace(/\[\[|\]\]/g, '') : undefined,
        badgeSuggestion: d.badge ? String(d.badge).toUpperCase().slice(0, 24) : undefined,
        caption: undefined,
        comment: undefined,
        headlineLoading: false,
        aiError: undefined,
        headlineFromTitle: false,
      });
      return true;
    } catch (e: any) {
      patchItem(it.id, { headlineLoading: false, aiError: aiError(e) });
      if (!silent) message.error('AI soạn bài lỗi: ' + aiError(e));
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchItem, message, aiExtra, geminiKey]);

  // 3 gợi ý tiêu đề (gọi song song) để chọn
  const suggestHeadlines = async (it: StudioItem) => {
    if (!geminiKey || !geminiKey.trim()) {
      setKeyDraft('');
      setAiModalOpen(true);
      message.warning('Vui lòng nhập ít nhất 1 Gemini API Key để kích hoạt AI!');
      return;
    }
    setSuggesting(true);
    try {
      const results = await Promise.allSettled([0, 1, 2].map(() => api.post('/news-card/headline', articlePayload(it))));
      const list = Array.from(new Set(results
        .map((r) => (r.status === 'fulfilled' && r.value.data?.success ? cleanHeadline(r.value.data.headline) : ''))
        .filter(Boolean)));
      if (list.length === 0) throw new Error((results.find((r) => r.status === 'rejected') as any)?.reason?.response?.data?.error || 'AI không trả về tiêu đề');
      setSuggestions((prev) => ({ ...prev, [it.id]: list }));
    } catch (e: any) {
      message.error('AI gợi ý lỗi: ' + aiError(e));
    } finally {
      setSuggesting(false);
    }
  };

  const rewriteCaption = async (it: StudioItem) => {
    if (!geminiKey || !geminiKey.trim()) {
      setKeyDraft('');
      setAiModalOpen(true);
      message.warning('Vui lòng nhập ít nhất 1 Gemini API Key để kích hoạt AI!');
      return;
    }
    setCaptionAiLoading(true);
    try {
      const res = await api.post('/news-radar/rewrite', { ...articlePayload(it), style: 'FANPAGE_POST' });
      if (!res.data?.success || !res.data.rewrittenContent) throw new Error(res.data?.error || 'AI không trả về caption');
      patchItem(it.id, it.captionMode === 'hook' ? { comment: res.data.rewrittenContent } : { caption: res.data.rewrittenContent });
    } catch (e: any) {
      message.error('AI viết caption lỗi: ' + aiError(e));
    } finally {
      setCaptionAiLoading(false);
    }
  };

  const rewriteBatchCaptions = async (targetItems?: StudioItem[]) => {
    if (!geminiKey || !geminiKey.trim()) {
      setKeyDraft('');
      setAiModalOpen(true);
      message.warning('Vui lòng nhập ít nhất 1 Gemini API Key để kích hoạt AI!');
      return;
    }
    const targets = targetItems && targetItems.length > 0
      ? targetItems
      : (checkedItems.length > 0 ? checkedItems : items);

    if (targets.length === 0) {
      return message.warning('Không có bài nào trong danh sách để viết lại caption');
    }

    setBatchCaptionLoading(true);
    let successCount = 0;

    for (let i = 0; i < targets.length; i++) {
      const it = targets[i];
      setBatchCaptionProgress(`Đang viết lại: ${i + 1}/${targets.length}...`);
      try {
        const res = await api.post('/news-radar/rewrite', { ...articlePayload(it), style: 'FANPAGE_POST' });
        if (res.data?.success && res.data.rewrittenContent) {
          patchItem(it.id, it.captionMode === 'hook' ? { comment: res.data.rewrittenContent } : { caption: res.data.rewrittenContent });
          successCount++;
        } else {
          const pkgRes = await api.post('/news-card/package', articlePayload(it));
          if (pkgRes.data?.success && (pkgRes.data.summary || pkgRes.data.hook)) {
            patchItem(it.id, {
              summary: pkgRes.data.summary ? String(pkgRes.data.summary).replace(/\[\[|\]\]/g, '') : undefined,
              hook: pkgRes.data.hook ? String(pkgRes.data.hook).replace(/\[\[|\]\]/g, '') : undefined,
              caption: undefined,
            });
            successCount++;
          }
        }
      } catch (err: any) {
        console.warn(`Lỗi viết lại caption bài ${it.title}:`, err);
      }
    }

    setBatchCaptionLoading(false);
    setBatchCaptionProgress(null);
    if (successCount > 0) {
      message.success(`Đã viết lại Caption sâu sắc, giàu thông tin cho ${successCount}/${targets.length} bài thành công!`);
    } else {
      message.error('Không thể viết lại caption các bài, vui lòng kiểm tra Gemini API Key.');
    }
  };

  const runPackageForAllChecked = async () => {
    if (!geminiKey || !geminiKey.trim()) {
      setKeyDraft('');
      setAiModalOpen(true);
      message.warning('Vui lòng nhập ít nhất 1 Gemini API Key để kích hoạt AI!');
      return;
    }
    const targets = checkedItems.length > 0 ? checkedItems : items;
    if (targets.length === 0) return message.warning('Danh sách bài trống');
    setBatchCaptionLoading(true);
    let successCount = 0;
    for (let i = 0; i < targets.length; i++) {
      const it = targets[i];
      setBatchCaptionProgress(`Đang AI soạn bài: ${i + 1}/${targets.length}...`);
      const ok = await runPackage(it, true);
      if (ok) successCount++;
    }
    setBatchCaptionLoading(false);
    setBatchCaptionProgress(null);
    message.success(`Đã AI soạn bài hoàn tất cho ${successCount}/${targets.length} bài!`);
  };

  // Hàng đợi xử lý: lần lượt cào full bài (nội dung + toàn bộ ảnh) rồi AI soạn bài
  useEffect(() => {
    if (processingRef.current) return;
    const next = items.find((i) => i.status === 'loading');
    if (!next) return;
    processingRef.current = true;
    (async () => {
      try {
        let d: any = {};
        if (!next.preScraped) {
          const res = await api.post('/news-radar/scrape-article', { url: next.url });
          if (!res.data?.success) throw new Error(res.data?.error || 'Không cào được bài');
          d = res.data;
        }
        const images = Array.from(new Set(
          [d.coverImage, ...(d.images || []).map((img: any) => img.url), ...next.images].filter(Boolean) as string[]
        ));
        const { ordered, small, imageSizes } = await analyzeImages(images);
        const selected = ordered.slice(0, 1);
        const updated: StudioItem = {
          ...next,
          smallImages: small,
          imageSizes,
          title: (next.title && next.title !== next.url ? next.title : d.title) || next.url,
          sapo: d.sapo || next.sapo,
          content: d.content || next.content,
          images: ordered,
          selectedImages: selected,
          layout: defaultLayoutFor(selected.length || 1),
          status: 'ready',
          // AI soạn ở hàng đợi riêng bên dưới → cào ngay bài tiếp theo, không phải chờ AI
          aiPending: !next.headline,
        };
        patchItem(next.id, updated);
      } catch (e: any) {
        patchItem(next.id, { status: 'error', error: aiError(e) });
      } finally {
        processingRef.current = false;
        setItems((prev) => [...prev]); // kích hoạt xử lý bài tiếp theo
      }
    })();
  }, [items, patchItem]);

  // Hàng đợi AI: soạn song song tối đa 3 bài cùng lúc
  const AI_CONCURRENCY = 3;
  const aiRunningRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const waiting = items.filter((i) => i.status === 'ready' && i.aiPending && !aiRunningRef.current.has(i.id));
    for (const it of waiting) {
      if (aiRunningRef.current.size >= AI_CONCURRENCY) break;
      aiRunningRef.current.add(it.id);
      (async () => {
        try {
          // Gói đầy đủ trước; lỗi (ví dụ hết quota) thì thử chỉ viết tiêu đề
          const ok = await runPackage(it, true);
          // AI lỗi cả 2 lần → tạm dùng tiêu đề bài báo để ảnh không bị trống chữ
          if (!ok && !(await generateHeadline(it))) {
            patchItem(it.id, (cur) => (cur.headline ? {} : { headline: cleanHeadline(cur.title), headlineFromTitle: true }));
          }
        } finally {
          aiRunningRef.current.delete(it.id);
          patchItem(it.id, { aiPending: false }); // kích hoạt bài tiếp theo trong hàng đợi AI
        }
      })();
    }
  }, [items, patchItem, runPackage, generateHeadline]);

  // Bài cũ (tạo trước khi có đo kích thước ảnh): đo lại + đổi thumbnail sang ảnh gốc khi mở
  const enhancingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!active || active.status !== 'ready' || active.imageSizes || enhancingRef.current.has(active.id)) return;
    enhancingRef.current.add(active.id);
    const id = active.id;
    analyzeImages(active.images).then(({ ordered, small, imageSizes }) => {
      patchItem(id, (it) => {
        const swap = (u: string) => (ordered.includes(upgradeImageUrl(u)) ? upgradeImageUrl(u) : u);
        return {
          images: ordered,
          smallImages: small,
          imageSizes,
          selectedImages: it.selectedImages.map(swap),
          inset: it.inset ? { ...it.inset, url: swap(it.inset.url) } : it.inset,
        };
      });
    });
  }, [active, patchItem]);

  // Tự chọn cách vừa khung cho ảnh đơn: cắt sẽ mất nhiều (ảnh vuông/dọc, infographic) → "Giữ đủ ảnh"
  useEffect(() => {
    if (!active || active.status !== 'ready' || active.fitManual || active.selectedImages.length !== 1) return;
    const size = active.imageSizes?.[active.selectedImages[0]];
    if (!size) return;
    const fit: CardStyle['fit'] = coverLosesContent(size, cellsFor('single', active.style.ratio)[0]) ? 'contain' : 'cover';
    if (fit !== active.style.fit) patchItem(active.id, (it) => ({ style: { ...it.style, fit } }));
  }, [active, patchItem]);

  // Tự động kiểm tra bài viết (Reddit/...) xem có video không nếu chưa có videoUrl
  useEffect(() => {
    if (!active || active.videoUrl || !active.url) return;
    if (active.url.includes('reddit.com') || active.url.includes('redd.it')) {
      api.post('/news-card/resolve-media', { url: active.url }).then((res) => {
        if (res.data?.success && res.data.hasVideo && res.data.videoUrl) {
          patchItem(active.id, {
            videoUrl: res.data.videoUrl,
            isVideo: true,
          });
        }
      }).catch(() => {});
    }
  }, [active?.id, active?.url, active?.videoUrl, patchItem]);

  const handleAddLinks = () => {
    const urls = Array.from(new Set((linkInput.match(/https?:\/\/[^\s"'<>]+/gi) || []).map((u) => u.replace(/[),.;]+$/, ''))));
    if (urls.length === 0) {
      message.warning('Dán ít nhất 1 link bài báo');
      return;
    }
    addArticles(urls.map((url) => ({ url })));
    setLinkInput('');
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (activeId === id) setActiveId(items.find((i) => i.id !== id)?.id || null);
  };

  const removeCheckedItems = () => {
    const checkedIds = new Set(checkedItems.map((i) => i.id));
    if (checkedIds.size === 0) return;
    setItems((prev) => prev.filter((i) => !checkedIds.has(i.id)));
    if (activeId && checkedIds.has(activeId)) {
      setActiveId(items.find((i) => !checkedIds.has(i.id))?.id || null);
    }
    message.success(`Đã xoá ${checkedIds.size} bài được chọn`);
  };

  const removeAllItems = () => {
    setItems([]);
    setActiveId(null);
    message.success('Đã xoá toàn bộ bài trong Studio');
  };

  const removeSentItems = () => {
    const sentIds = new Set(items.filter((i) => i.sentToPoster).map((i) => i.id));
    if (sentIds.size === 0) {
      message.info('Không có bài nào đã chuyển đi đăng');
      return;
    }
    setItems((prev) => prev.filter((i) => !sentIds.has(i.id)));
    if (activeId && sentIds.has(activeId)) {
      setActiveId(items.find((i) => !sentIds.has(i.id))?.id || null);
    }
    message.success(`Đã dọn dẹp ${sentIds.size} bài đã chuyển đi đăng`);
  };

  const toggleLogoForChecked = (show: boolean) => {
    const checkedIds = new Set(checkedItems.map((i) => i.id));
    if (checkedIds.size === 0) return;
    setItems((prev) =>
      prev.map((i) =>
        checkedIds.has(i.id)
          ? {
              ...i,
              cardUrl: undefined,
              style: {
                ...i.style,
                showLogo: show,
                ...(show === false ? { logoUrl: '' } : {}),
              },
            }
          : i
      )
    );
    message.success(show ? `Đã bật logo cho ${checkedIds.size} bài` : `Đã bỏ/tắt logo cho ${checkedIds.size} bài`);
  };

  // ── Preview (iframe dùng đúng HTML sẽ xuất ảnh) ──
  const [previewSoundOn, setPreviewSoundOn] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);

  useEffect(() => {
    setPreviewSoundOn(false);
  }, [activeId]);

  const html = useMemo(() => (active ? buildNewsCardHtml(specOf(active, false, previewSoundOn)) : ''), [active, previewSoundOn]);
  const [debouncedHtml, setDebouncedHtml] = useState(html);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedHtml(html), 300);
    return () => clearTimeout(t);
  }, [html]);
  const cardH = cardHeight(active?.style.ratio);

  // Ảnh xem trước nhỏ của từng mẫu thiết kế (dựng lại theo bản đã debounce để không nhấp nháy khi gõ)
  const templatePreviews = useMemo(() => {
    if (!active || active.status !== 'ready') return {} as Record<string, string>;
    return Object.fromEntries(TEMPLATES.map((t) => [t.value, buildNewsCardHtml({ ...specOf(active), style: { ...active.style, template: t.value } })]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedHtml]);

  // Callback ref: khung preview chỉ xuất hiện khi bài đã cào xong, nên phải đo lại mỗi khi nó mount
  const [scale, setScale] = useState(0.35);
  const roRef = useRef<ResizeObserver | null>(null);
  const previewElRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    previewElRef.current = el;
    if (!el) return;
    const update = () => setScale(el.clientWidth / CARD_SIZE);
    update();
    roRef.current = new ResizeObserver(update);
    roRef.current.observe(el);
  }, []);

  // Kích thước thật của vùng ảnh trong iframe (để đặt logo/nhãn/ảnh tròn vào góc)
  const photoBox = (): [number, number] => {
    const el = iframeRef.current?.contentDocument?.getElementById('photos');
    if (el && el.clientWidth > 0) return [el.clientWidth, el.clientHeight];
    return [CARD_SIZE, cardH - BAND_ESTIMATE];
  };

  // ── Kéo thả trên preview: ảnh tròn, logo, nhãn, watermark/nguồn, hoặc vị trí ảnh ──
  type DragKind = 'inset' | 'logo' | 'badge' | 'watermark' | 'photo';
  const dragRef = useRef<{ kind: DragKind; x0: number; y0: number; a0: number; b0: number; pw: number; ph: number; el: HTMLElement } | null>(null);
  const [hoverKind, setHoverKind] = useState<DragKind | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragOverCanvas, setDragOverCanvas] = useState(false);

  const hitTest = (clientX: number, clientY: number): { kind: DragKind; el: HTMLElement } | null => {
    const doc = iframeRef.current?.contentDocument;
    const box = previewElRef.current?.getBoundingClientRect();
    if (!doc || !box) return null;
    const el = doc.elementFromPoint((clientX - box.left) / scale, (clientY - box.top) / scale) as HTMLElement | null;
    const target = el?.closest('#badge, #inset, #logo, #video-watermark, .cell') as HTMLElement | null;
    if (!target) return null;
    if (target.id === 'badge') return { kind: 'badge', el: target };
    if (target.id === 'inset') return { kind: 'inset', el: target };
    if (target.id === 'logo') return { kind: 'logo', el: target };
    if (target.id === 'video-watermark') return { kind: 'watermark', el: target };
    return { kind: 'photo', el: target };
  };

  const onPreviewMouseDown = (e: React.MouseEvent) => {
    if (!active) return;
    const hit = hitTest(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    const [pw, ph] = photoBox();
    let a0 = 0;
    let b0 = 0;
    if (hit.kind === 'photo') {
      a0 = active.style.focusX;
      b0 = active.style.focusY;
    } else {
      a0 = parseFloat(hit.el.style.left) || 0;
      b0 = parseFloat(hit.el.style.top) || 0;
    }
    dragRef.current = { kind: hit.kind, x0: e.clientX, y0: e.clientY, a0, b0, pw, ph, el: hit.el };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const clamp = (v: number, max = 100) => Math.min(max, Math.max(0, v));
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.x0) / scale;
      const dy = (e.clientY - d.y0) / scale;
      const doc = iframeRef.current?.contentDocument;
      if (d.kind === 'photo') {
        // Kéo ảnh sang phải = xem phần bên trái (giảm %); đổi trực tiếp trong iframe cho mượt, lưu khi thả chuột
        const fx = clamp(d.a0 - (dx / d.pw) * 120);
        const fy = clamp(d.b0 - (dy / d.ph) * 120);
        doc?.querySelectorAll<HTMLImageElement>('.cell img').forEach((img) => { img.style.objectPosition = `${fx}% ${fy}%`; });
      } else {
        d.el.style.left = `${clamp(d.a0 + (dx / d.pw) * 100, 98)}%`;
        d.el.style.top = `${clamp(d.b0 + (dy / d.ph) * 100, 98)}%`;
      }
    };
    const up = (e: MouseEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (!d || !active) return;
      const dx = (e.clientX - d.x0) / scale;
      const dy = (e.clientY - d.y0) / scale;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      if (d.kind === 'photo') {
        const fx = clamp(d.a0 - (dx / d.pw) * 120);
        const fy = clamp(d.b0 - (dy / d.ph) * 120);
        patchItem(active.id, (it) => ({ style: { ...it.style, focusX: Math.round(fx), focusY: Math.round(fy) } }));
        return;
      }
      const left = Math.round(clamp(d.a0 + (dx / d.pw) * 100, 98) * 10) / 10;
      const top = Math.round(clamp(d.b0 + (dy / d.ph) * 100, 98) * 10) / 10;
      if (d.kind === 'inset') patchItem(active.id, (it) => ({ inset: it.inset ? { ...it.inset, left, top } : it.inset }));
      if (d.kind === 'badge') patchItem(active.id, (it) => ({ badge: it.badge ? { ...it.badge, left, top } : it.badge }));
      if (d.kind === 'logo') patchItem(active.id, (it) => ({ style: { ...it.style, logoX: left, logoY: top } }));
      if (d.kind === 'watermark') patchItem(active.id, (it) => ({ style: { ...it.style, videoWatermarkX: left, videoWatermarkY: top } }));
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging, scale, active, patchItem]);

  // Cuộn con lăn chuột trên preview để phóng to / thu nhỏ chi tiết tức thì
  const onPreviewWheel = (e: React.WheelEvent) => {
    if (!active) return;
    const hit = hitTest(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1;

    if (hit.kind === 'inset' && active.inset) {
      const nextZoom = Math.min(3, Math.max(1, Math.round((active.inset.zoom + delta * 0.1) * 10) / 10));
      setInset({ zoom: nextZoom });
    } else if (hit.kind === 'logo' && active.style.showLogo) {
      const nextSize = Math.min(480, Math.max(100, (active.style.logoSize || 220) + delta * 15));
      setStyle({ logoSize: nextSize });
    } else if (hit.kind === 'badge' && active.badge) {
      const nextSize = Math.min(110, Math.max(36, active.badge.size + delta * 4));
      setBadge({ size: nextSize });
    } else if (hit.kind === 'watermark' && active.style.videoWatermark) {
      const nextSize = Math.min(54, Math.max(14, (active.style.videoWatermarkSize || 28) + delta * 2));
      setStyle({ videoWatermarkSize: nextSize });
    }
  };

  // ── Chỉnh sửa ──
  const headlineRef = useRef<any>(null);
  const highlightSelection = () => {
    if (!active) return;
    const ta: HTMLTextAreaElement | undefined = headlineRef.current?.resizableTextArea?.textArea;
    if (!ta || ta.selectionStart === ta.selectionEnd) {
      message.info('Bôi đen một cụm trong ô tiêu đề rồi bấm lại');
      return;
    }
    const { selectionStart: s, selectionEnd: e } = ta;
    const h = active.headline;
    patchItem(active.id, { headline: h.slice(0, s) + '[[' + h.slice(s, e) + ']]' + h.slice(e) });
  };

  const toggleImage = (url: string) => {
    if (!active) return;
    patchItem(active.id, (it) => {
      let sel = it.selectedImages.includes(url) ? it.selectedImages.filter((u) => u !== url) : [...it.selectedImages, url];
      if (sel.length > 4) sel = sel.slice(sel.length - 4);
      if (sel.length === 0) return { selectedImages: sel };
      const valid = LAYOUTS_BY_COUNT[sel.length].some((l) => l.value === it.layout);
      return { selectedImages: sel, layout: valid ? it.layout : defaultLayoutFor(sel.length) };
    });
  };

  const setStyle = (patch: Partial<CardStyle>) => {
    if (!active) return;
    patchItem(active.id, (it) => ({ style: { ...it.style, ...patch } }));
  };

  const uploadFile = async (file: File): Promise<string | null> => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post('/media/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      return res.data?.success && res.data.url ? (res.data.url as string) : null;
    } catch (e: any) {
      message.error('Tải ảnh lỗi: ' + (e?.response?.data?.message || e.message));
      return null;
    }
  };

  const uploadImage = async (file: File) => {
    if (!active) return false;
    const url = await uploadFile(file);
    if (url) {
      patchItem(active.id, (it) => ({ images: [...it.images, url] }));
      toggleImage(url);
    }
    return false;
  };

  const setInset =(patch: Partial<InsetOptions> | null) => {
    if (!active) return;
    patchItem(active.id, (it) => ({
      inset: patch === null ? undefined : { url: '', zoom: 1, x: 50, y: 50, left: 3, top: 4, size: 380, ...it.inset, ...patch } as InsetOptions,
    }));
  };

  const placeInset = (corner: Corner) => {
    if (!active?.inset) return;
    const [pw, ph] = photoBox();
    const p = cornerPercent(corner, active.inset.size, active.inset.size, pw, ph, 40);
    setInset({ left: Math.round(p.x * 10) / 10, top: Math.round(p.y * 10) / 10 });
  };

  const setBadge = (patch: Partial<BadgeOptions> | null) => {
    if (!active) return;
    patchItem(active.id, (it) => {
      if (patch === null) return { badge: undefined };
      const next = { text: 'NÓNG', bg: it.style.accent, color: '#ffffff', left: 70, top: 4, size: 64, ...it.badge, ...patch } as BadgeOptions;
      return { badge: next };
    });
  };

  const placeBadge = (corner: Corner, badge?: BadgeOptions) => {
    const b = badge || active?.badge;
    if (!b) return;
    const [pw, ph] = photoBox();
    const p = cornerPercent(corner, estimateBadgeWidth(b), b.size * 1.5, pw, ph, 40);
    setBadge({ ...b, left: Math.round(p.x * 10) / 10, top: Math.round(p.y * 10) / 10 });
  };

  const enableBadge = (preset: { text: string; bg: string; color: string }) => {
    if (!active) return;
    const base: BadgeOptions = { size: 64, left: 0, top: 0, ...active.badge, ...preset };
    const [pw, ph] = photoBox();
    // Mặc định góc trên phải; nếu đang có ảnh tròn bên phải thì đặt bên trái
    const corner: Corner = active.inset && active.inset.left > 50 ? 'tl' : 'tr';
    const p = cornerPercent(corner, estimateBadgeWidth(base), base.size * 1.5, pw, ph, 40);
    setBadge({ ...base, left: Math.round(p.x * 10) / 10, top: Math.round(p.y * 10) / 10 });
  };

  const placeLogo = (corner: Corner) => {
    if (!active) return;
    const s = active.style;
    const [pw, ph] = photoBox();
    const p = cornerPercent(corner, s.logoSize, s.logoSize * logoBoxAspect(s), pw, ph, 36);
    setStyle({ logoPos: corner, logoX: Math.round(p.x * 10) / 10, logoY: Math.round(p.y * 10) / 10 });
  };

  // Logo dùng chung cho mọi bài: cập nhật cả mặc định lẫn tất cả bài (mỗi bài vẫn tự bật/tắt logo)
  const updateLogoEverywhere = (patch: Partial<CardStyle>, showOnActive = false) => {
    const nextDefaults = { ...defaults, ...patch };
    setDefaults(nextDefaults);
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(nextDefaults));
    setItems((prev) => prev.map((it) => ({
      ...it,
      style: { ...it.style, ...patch, ...(showOnActive && it.id === activeId ? { showLogo: true } : {}) },
    })));
  };

  // Tách nền rồi tải bản PNG trong suốt lên; trả về null nếu logo đã trong suốt / không tách được
  const makeNoBg = async (file: File) => {
    const out = await removeLogoBackground(file);
    if (!out) return null;
    const url = await uploadFile(new File([out.blob], 'logo-tach-nen.png', { type: 'image/png' }));
    return url ? { logoNoBgUrl: url, logoNoBgAspect: out.aspect } : null;
  };

  const [logoBusy, setLogoBusy] = useState(false);
  const uploadLogo = async (file: File) => {
    setLogoBusy(true);
    try {
      const logoUrl = await uploadFile(file);
      if (!logoUrl) return false;
      const size = await probeImage(logoUrl);
      const logoAspect = size.w > 0 ? size.h / size.w : 0.5;
      const noBg = await makeNoBg(file).catch(() => null);
      updateLogoEverywhere({
        logoUrl, logoAspect, showLogo: true,
        logoNoBgUrl: noBg?.logoNoBgUrl, logoNoBgAspect: noBg?.logoNoBgAspect, logoBgRemoved: !!noBg,
      }, true);
      message.success(noBg ? 'Đã lưu logo và tự tách nền. Bật/tắt logo cho từng bài ở mục Logo.' : 'Đã lưu logo.');
    } finally {
      setLogoBusy(false);
    }
    return false;
  };

  // Logo tải lên từ trước (chưa có bản tách nền): tải lại file gốc về để tách
  const removeBgFromCurrentLogo = async () => {
    const url = active?.style.logoUrl;
    if (!url) return;
    setLogoBusy(true);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const noBg = await makeNoBg(new File([blob], 'logo', { type: blob.type || 'image/png' }));
      if (!noBg) {
        message.info('Logo này đã có nền trong suốt hoặc nền không đồng màu nên không tách được tự động.');
        return;
      }
      updateLogoEverywhere({ ...noBg, logoBgRemoved: true });
      message.success('Đã tách nền logo');
    } catch (e: any) {
      message.error('Tách nền lỗi: ' + e.message);
    } finally {
      setLogoBusy(false);
    }
  };

  const saveDefaults = () => {
    if (!active) return;
    setDefaults(active.style);
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(active.style));
    message.success('Đã lưu kiểu ảnh này làm mặc định cho bài mới');
  };

  const applyStyleToAll = () => {
    if (!active) return;
    setItems((prev) => prev.map((it) => ({ ...it, style: { ...active.style } })));
    message.success('Đã áp dụng kiểu ảnh cho tất cả bài');
  };

  // ── Mẫu kiểu đã lưu ──
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const savePreset = () => {
    if (!active || !presetName.trim()) return;
    const next = [...presets.filter((p) => p.name !== presetName.trim()), { name: presetName.trim(), style: active.style }];
    setPresets(next);
    localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
    setPresetModalOpen(false);
    setPresetName('');
    message.success('Đã lưu mẫu kiểu');
  };
  const deletePreset = (name: string) => {
    const next = presets.filter((p) => p.name !== name);
    setPresets(next);
    localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
  };
  const applyPreset = (name: string) => {
    const p = presets.find((x) => x.name === name);
    if (p && active) patchItem(active.id, { style: { ...DEFAULT_CARD_STYLE, ...p.style }, fitManual: true });
  };

  // ── Xuất ảnh ──
  const renderItem = async (it: StudioItem): Promise<string> => {
    const currentHtml = buildNewsCardHtml(specOf(it));
    if (it.cardUrl && it.cardHtml === currentHtml) return it.cardUrl;
    const res = await api.post('/news-card/render', { html: currentHtml });
    if (!res.data?.success || !res.data.url) throw new Error(res.data?.error || 'Không tạo được ảnh');
    patchItem(it.id, { cardUrl: res.data.url, cardHtml: currentHtml });
    return res.data.url as string;
  };

  const problemOf = (it: StudioItem) => {
    if (it.status !== 'ready') return 'chưa cào xong';
    if (!it.headline.trim() && !it.title.trim()) return 'chưa có tiêu đề';
    if (it.selectedImages.length > 0 && it.selectedImages.length < IMAGES_PER_LAYOUT[it.layout]) return 'thiếu ảnh cho bố cục';
    if (it.captionMode === 'hook' && !(it.hook || '').trim()) return 'chưa có caption hook';
    return null;
  };

  const exportActive = async () => {
    if (!active) return;
    const problem = problemOf(active);
    if (problem) return message.warning(`Bài này ${problem}`);
    setExporting(true);
    try {
      const url = await renderItem(active);
      await downloadImage(url, fileNameOf(active.title, 0));
    } catch (e: any) {
      message.error('Xuất ảnh lỗi: ' + aiError(e));
    } finally {
      setExporting(false);
    }
  };

  const exportActiveVideo = async () => {
    if (!active) return;
    if (!active.videoUrl) return message.warning('Bài này không có video');
    setExporting(true);
    try {
      message.loading({ content: 'Đang dùng FFmpeg ghép video và khung tin tức...', key: 'export-video', duration: 0 });
      const transparentHtml = buildNewsCardHtml(specOf(active, true));
      const res = await api.post('/news-card/render-video', {
        videoUrl: active.videoUrl,
        html: transparentHtml,
        ratio: active.style.ratio,
        photoTopPct: active.style.useCustomFrame ? (active.style.framePhotoTop ?? 0) : 0,
        photoHeightPct: active.style.useCustomFrame ? (active.style.framePhotoHeight ?? 68) : 68,
        frameDuration: active.style.frameDuration ?? 0,
      });
      if (!res.data?.success || !res.data.url) throw new Error(res.data?.error || 'Không tạo được video');
      message.success({ content: 'Đã tạo video tin tức thành công!', key: 'export-video' });
      await downloadImage(res.data.url, fileNameOf(active.title, 0).replace(/\.[^.]+$/, '') + '.mp4');
    } catch (e: any) {
      message.error({ content: 'Xuất video lỗi: ' + aiError(e), key: 'export-video' });
    } finally {
      setExporting(false);
    }
  };

  const togglePreviewSound = async () => {
    if (!active || !active.videoUrl) return;
    if (previewSoundOn) {
      setPreviewSoundOn(false);
      try {
        const doc = iframeRef.current?.contentDocument;
        const v = doc?.querySelector<HTMLVideoElement>('video.main-video');
        if (v) v.muted = true;
      } catch (err) {
        console.warn(err);
      }
      return;
    }

    if (active.videoUrl.includes('v.redd.it/')) {
      setLoadingAudio(true);
      message.loading({ content: 'Đang tải và ghép âm thanh từ Reddit...', key: 'merge-audio', duration: 0 });
      try {
        const res = await api.post('/news-card/merge-audio', { videoUrl: active.videoUrl });
        if (res.data?.success && res.data.url) {
          patchItem(active.id, { videoUrl: res.data.url });
          setPreviewSoundOn(true);
          message.success({ content: 'Đã bật âm thanh video!', key: 'merge-audio' });
          setTimeout(() => {
            try {
              const doc = iframeRef.current?.contentDocument;
              const v = doc?.querySelector<HTMLVideoElement>('video.main-video');
              if (v) {
                v.muted = false;
                v.volume = 1;
                v.play().catch(console.warn);
              }
            } catch (err) {
              console.warn(err);
            }
          }, 300);
        } else {
          throw new Error(res.data?.error || 'Không tải được tiếng');
        }
      } catch (err: any) {
        message.error({ content: 'Không thể phát tiếng: ' + aiError(err), key: 'merge-audio' });
      } finally {
        setLoadingAudio(false);
      }
    } else {
      setPreviewSoundOn(true);
      message.success('Đã bật tiếng video');
      setTimeout(() => {
        try {
          const doc = iframeRef.current?.contentDocument;
          const v = doc?.querySelector<HTMLVideoElement>('video.main-video');
          if (v) {
            v.muted = false;
            v.volume = 1;
            v.play().catch(console.warn);
          }
        } catch (err) {
          console.warn(err);
        }
      }, 150);
    }
  };

  // ── Chuyển sang Đăng tự động (chọn Page/Nhóm/giờ đăng ở bên đó) ──
  const [handingOff, setHandingOff] = useState('');
  const checkedItems = items.filter((i) => i.checked);

  const sendToPoster = async () => {
    if (checkedItems.length === 0) return message.warning('Tick chọn ít nhất 1 bài ở cột bên trái');
    const bad = checkedItems.map((it) => ({ it, p: problemOf(it) })).filter((x) => x.p);
    if (bad.length > 0) {
      setActiveId(bad[0].it.id);
      return message.warning(`"${bad[0].it.title.slice(0, 50)}" ${bad[0].p}`);
    }
    try {
      const posts: Array<{ caption: string; imageUrl: string; comment?: string; mediaType?: string }> = [];
      for (let i = 0; i < checkedItems.length; i++) {
        const it = checkedItems[i];
        if (it.videoUrl) {
          setHandingOff(`Đang tạo video tin tức ${i + 1}/${checkedItems.length}...`);
          try {
            const transparentHtml = buildNewsCardHtml(specOf(it, true));
            const res = await api.post('/news-card/render-video', {
              videoUrl: it.videoUrl,
              html: transparentHtml,
              ratio: it.style.ratio,
              photoTopPct: it.style.useCustomFrame ? (it.style.framePhotoTop ?? 0) : 0,
              photoHeightPct: it.style.useCustomFrame ? (it.style.framePhotoHeight ?? 68) : 68,
              frameDuration: it.style.frameDuration ?? 0,
            });
            if (res.data?.success && res.data.url) {
              posts.push({ ...postOf(it), imageUrl: res.data.url, mediaType: 'VIDEO' });
              continue;
            }
          } catch (vidErr: any) {
            console.warn('Lỗi tạo video, chuyển sang xuất ảnh:', vidErr);
          }
        }
        setHandingOff(`Đang xuất ảnh ${i + 1}/${checkedItems.length}...`);
        posts.push({ ...postOf(it), imageUrl: await renderItem(it) });
      }
      const sent = new Set(checkedItems.map((i) => i.id));
      setItems((prev) => prev.map((i) => (sent.has(i.id) ? { ...i, checked: false, sentToPoster: true } : i)));
      navigate('/dashboard/playwright', { state: { importedStudioPosts: posts } });
    } catch (e: any) {
      message.error('Xuất ảnh lỗi: ' + aiError(e));
    } finally {
      setHandingOff('');
    }
  };

  const statusTag = (it: StudioItem) => {
    if (it.status === 'loading') return <Tag className="!m-0">Đang cào</Tag>;
    if (it.status === 'error') return <Tag color="error" className="!m-0">Lỗi</Tag>;
    if (it.headlineLoading) return <Tag color="processing" className="!m-0">AI đang soạn</Tag>;
    if (it.aiPending) return <Tag className="!m-0">Chờ AI</Tag>;
    if (it.sentToPoster) return <Tag color="success" className="!m-0">Đã chuyển đi đăng</Tag>;
    if (it.videoUrl || it.isVideo) return <Tag color="purple" className="!m-0">🎬 Video</Tag>;
    if (it.cardUrl && it.cardHtml === buildNewsCardHtml(specOf(it))) return <Tag color="success" className="!m-0">Đã xuất ảnh</Tag>;
    return <Tag color="blue" className="!m-0">Sẵn sàng</Tag>;
  };

  // ── Xem trước (ảnh / bài Facebook) và tab chỉnh sửa ──
  const [previewMode, setPreviewMode] = useState<'card' | 'facebook'>(() => (localStorage.getItem(PREVIEW_MODE_KEY) === 'facebook' ? 'facebook' : 'card'));
  useEffect(() => {
    localStorage.setItem(PREVIEW_MODE_KEY, previewMode);
  }, [previewMode]);
  const [editorTab, setEditorTab] = useState('content');
  const [galleryOpen, setGalleryOpen] = useState(false);

  // ── Thư viện khung ảnh tùy chỉnh (Custom Frames) ──
  const [customFrames, setCustomFrames] = useState<CustomFramePreset[]>(() => {
    const saved = loadJson<CustomFramePreset[]>(CUSTOM_FRAMES_KEY, []);
    // Chỉ giữ lại những khung thật có url và loại bỏ các mẫu giả lập vừa thêm
    const valid = (saved || []).filter(
      (s) =>
        s.url &&
        s.url.trim().length > 0 &&
        !['radiant_neon_cyber', 'bao_chi_hien_dai', 'tin_nong_red', 'kinh_te_tai_chinh'].includes(s.id)
    );
    const finalFrames = valid.length > 0 ? valid : DEFAULT_CUSTOM_FRAMES;
    localStorage.setItem(CUSTOM_FRAMES_KEY, JSON.stringify(finalFrames));
    return finalFrames;
  });
  const [frameNameInput, setFrameNameInput] = useState('');
  const [saveFramePopoverOpen, setSaveFramePopoverOpen] = useState(false);
  const [uploadingFrame, setUploadingFrame] = useState(false);
  const [channelFilter, setChannelFilter] = useState<string>('ALL');

  const uploadCustomFrame = async (file: File) => {
    setUploadingFrame(true);
    try {
      const url = await uploadFile(file);
      if (url) {
        const name = file.name.replace(/\.[^.]+$/, '') || 'Khung mới';
        setStyle({
          useCustomFrame: true,
          customFrameUrl: url,
          framePhotoTop: 0,
          framePhotoHeight: 68,
          frameTextBottom: 4,
          frameTextLeft: 6,
          frameTextRight: 6,
          frameTextHeight: 24,
          frameTextAlign: 'center',
        });
        const newPreset: CustomFramePreset = {
          id: 'frame_' + Date.now(),
          name,
          tagColor: '#3b82f6',
          url,
          photoTop: 0,
          photoHeight: 68,
          textBottom: 4,
          textLeft: 6,
          textRight: 6,
          textHeight: 24,
          textAlign: 'center',
        };
        setCustomFrames((prev) => {
          const next = [newPreset, ...prev.filter((p) => p.url !== url)];
          localStorage.setItem(CUSTOM_FRAMES_KEY, JSON.stringify(next));
          return next;
        });
        message.success(`Đã tải và áp dụng khung "${name}"!`);
      }
    } finally {
      setUploadingFrame(false);
    }
    return false;
  };

  const applyCustomFramePreset = (preset: CustomFramePreset) => {
    if (!active) return;
    patchItem(active.id, (it) => ({
      channelId: preset.id,
      channelName: preset.name,
      style: {
        ...it.style,
        useCustomFrame: !!preset.url,
        customFrameUrl: preset.url || '',
        framePhotoTop: preset.photoTop ?? 0,
        framePhotoHeight: preset.photoHeight ?? 68,
        frameTextBottom: preset.textBottom ?? 4,
        frameTextLeft: preset.textLeft ?? 6,
        frameTextRight: preset.textRight ?? 6,
        frameTextHeight: preset.textHeight ?? 24,
        frameTextAlign: preset.textAlign ?? 'center',
        ...(preset.template ? { template: preset.template } : {}),
        ...(preset.bandBg ? { bandBg: preset.bandBg } : {}),
        ...(preset.textColor ? { textColor: preset.textColor } : {}),
        ...(preset.accent ? { accent: preset.accent } : {}),
        ...(preset.footerText ? { footerText: preset.footerText, showFooter: true } : {}),
        ...(preset.logoUrl
          ? {
              showLogo: preset.showLogo ?? true,
              logoUrl: preset.logoUrl,
              logoPos: preset.logoPos ?? 'tr',
              logoSize: preset.logoSize ?? 220,
              logoOpacity: preset.logoOpacity ?? 1,
              logoFrame: preset.logoFrame ?? 'none',
              logoFrameBg: preset.logoFrameBg ?? '#ffffff',
              logoBgRemoved: preset.logoBgRemoved ?? false,
              logoNoBgUrl: preset.logoNoBgUrl,
            }
          : {}),
      },
    }));
    message.success(`Đã áp dụng mẫu kênh "${preset.name}"!`);
  };

  const deleteCustomFramePreset = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCustomFrames((prev) => {
      const next = prev.filter((p) => p.id !== id);
      localStorage.setItem(CUSTOM_FRAMES_KEY, JSON.stringify(next));
      return next;
    });
    message.info('Đã xóa khung khỏi thư viện');
  };

  const saveCurrentFrameAsPreset = () => {
    if (!active) return;
    const s = active.style;
    const name = frameNameInput.trim() || `Khung ${customFrames.length + 1}`;
    const newPreset: CustomFramePreset = {
      id: 'frame_' + Date.now(),
      name,
      tagColor: '#3b82f6',
      url: s.customFrameUrl || '',
      photoTop: s.framePhotoTop ?? 0,
      photoHeight: s.framePhotoHeight ?? 68,
      textBottom: s.frameTextBottom ?? 4,
      textLeft: s.frameTextLeft ?? 6,
      textRight: s.frameTextRight ?? 6,
      textHeight: s.frameTextHeight ?? 24,
      textAlign: s.frameTextAlign ?? 'center',
      template: s.template,
      bandBg: s.bandBg,
      textColor: s.textColor,
      accent: s.accent,
      footerText: s.footerText,
      showLogo: s.showLogo,
      logoUrl: s.logoUrl,
      logoPos: s.logoPos,
      logoSize: s.logoSize,
      logoOpacity: s.logoOpacity,
      logoFrame: s.logoFrame,
      logoFrameBg: s.logoFrameBg,
      logoBgRemoved: s.logoBgRemoved,
      logoNoBgUrl: s.logoNoBgUrl,
    };
    setCustomFrames((prev) => {
      const next = [newPreset, ...prev.filter((p) => p.id !== newPreset.id)];
      localStorage.setItem(CUSTOM_FRAMES_KEY, JSON.stringify(next));
      return next;
    });
    setFrameNameInput('');
    setSaveFramePopoverOpen(false);
    message.success(`Đã lưu Kênh "${name}" (gồm Khung & Logo) vào thư viện!`);
  };

  const applyChannelToItem = (itemId: string, channelId: string) => {
    const channel = customFrames.find((f) => f.id === channelId);
    if (!channel) return;
    patchItem(itemId, (it) => ({
      channelId: channel.id,
      channelName: channel.name,
      style: {
        ...it.style,
        useCustomFrame: !!channel.url,
        customFrameUrl: channel.url || '',
        framePhotoTop: channel.photoTop ?? 0,
        framePhotoHeight: channel.photoHeight ?? 68,
        frameTextBottom: channel.textBottom ?? 4,
        frameTextLeft: channel.textLeft ?? 6,
        frameTextRight: channel.textRight ?? 6,
        frameTextHeight: channel.textHeight ?? 24,
        frameTextAlign: channel.textAlign ?? 'center',
        ...(channel.template ? { template: channel.template } : {}),
        ...(channel.bandBg ? { bandBg: channel.bandBg } : {}),
        ...(channel.textColor ? { textColor: channel.textColor } : {}),
        ...(channel.accent ? { accent: channel.accent } : {}),
        ...(channel.footerText ? { footerText: channel.footerText, showFooter: true } : {}),
        ...(channel.logoUrl
          ? {
              showLogo: channel.showLogo ?? true,
              logoUrl: channel.logoUrl,
              logoPos: channel.logoPos ?? 'tr',
              logoSize: channel.logoSize ?? 220,
              logoOpacity: channel.logoOpacity ?? 1,
              logoFrame: channel.logoFrame ?? 'none',
              logoFrameBg: channel.logoFrameBg ?? '#ffffff',
              logoBgRemoved: channel.logoBgRemoved ?? false,
              logoNoBgUrl: channel.logoNoBgUrl,
            }
          : {}),
      },
    }));
    message.success(`Đã gán sang "${channel.name}"!`);
  };

  const applyChannelToChecked = (channelId: string) => {
    const channel = customFrames.find((f) => f.id === channelId);
    if (!channel) return;
    const count = checkedItems.length;
    setItems((prev) =>
      prev.map((it) => {
        if (!it.checked && it.id !== active?.id) return it;
        return {
          ...it,
          channelId: channel.id,
          channelName: channel.name,
          style: {
            ...it.style,
            useCustomFrame: !!channel.url,
            customFrameUrl: channel.url || '',
            framePhotoTop: channel.photoTop ?? 0,
            framePhotoHeight: channel.photoHeight ?? 68,
            frameTextBottom: channel.textBottom ?? 4,
            frameTextLeft: channel.textLeft ?? 6,
            frameTextRight: channel.textRight ?? 6,
            frameTextHeight: channel.textHeight ?? 24,
            frameTextAlign: channel.textAlign ?? 'center',
            ...(channel.template ? { template: channel.template } : {}),
            ...(channel.bandBg ? { bandBg: channel.bandBg } : {}),
            ...(channel.textColor ? { textColor: channel.textColor } : {}),
            ...(channel.accent ? { accent: channel.accent } : {}),
            ...(channel.footerText ? { footerText: channel.footerText, showFooter: true } : {}),
            ...(channel.logoUrl
              ? {
                  showLogo: channel.showLogo ?? true,
                  logoUrl: channel.logoUrl,
                  logoPos: channel.logoPos ?? 'tr',
                  logoSize: channel.logoSize ?? 220,
                  logoOpacity: channel.logoOpacity ?? 1,
                  logoFrame: channel.logoFrame ?? 'none',
                  logoFrameBg: channel.logoFrameBg ?? '#ffffff',
                  logoBgRemoved: channel.logoBgRemoved ?? false,
                  logoNoBgUrl: channel.logoNoBgUrl,
                }
              : {}),
          },
        };
      })
    );
    message.success(`Đã áp dụng mẫu Kênh "${channel.name}" cho ${count} bài đã chọn!`);
  };

  const applyTemplateToChecked = (template: CardTemplate) => {
    const count = checkedItems.length;
    setItems((prev) =>
      prev.map((it) => {
        if (!it.checked && it.id !== active?.id) return it;
        return {
          ...it,
          style: {
            ...it.style,
            template,
            ...(template === 'gradient'
              ? { useCustomFrame: false, bandBg: '#090d16', textColor: '#ffffff', accent: '#ec4899' }
              : {}),
          },
        };
      })
    );
    message.success(`Đã gán mẫu "${TEMPLATES.find((t) => t.value === template)?.label || template}" cho ${count} bài đã chọn!`);
  };

  const applyCurrentChannelToAllChecked = () => {
    if (!active) return;
    const channelId =
      active.channelId ||
      (active.style.customFrameUrl
        ? customFrames.find((f) => f.url === active.style.customFrameUrl)?.id
        : undefined);
    if (channelId) {
      applyChannelToChecked(channelId);
    } else {
      applyFrameToSelected();
    }
  };

  const displayedItems = useMemo(() => {
    if (channelFilter === 'ALL') return items;
    if (channelFilter === 'UNASSIGNED') {
      return items.filter((i) => !i.channelId && !i.style.customFrameUrl);
    }
    return items.filter(
      (i) =>
        i.channelId === channelFilter ||
        (!i.channelId && i.style.customFrameUrl === customFrames.find((f) => f.id === channelFilter)?.url)
    );
  }, [items, channelFilter, customFrames]);

  const applyFrameToSelected = () => {
    if (!active?.style.customFrameUrl) {
      message.warning('Chưa có khung nào được chọn');
      return;
    }
    const s = active.style;
    setItems((prev) =>
      prev.map((it) => {
        if (!it.checked && it.id !== active.id) return it;
        return {
          ...it,
          style: {
            ...it.style,
            useCustomFrame: s.useCustomFrame,
            customFrameUrl: s.customFrameUrl,
            framePhotoTop: s.framePhotoTop,
            framePhotoHeight: s.framePhotoHeight,
            frameTextBottom: s.frameTextBottom,
            frameTextLeft: s.frameTextLeft,
            frameTextRight: s.frameTextRight,
            frameTextHeight: s.frameTextHeight,
            frameTextAlign: s.frameTextAlign,
            textColor: s.textColor,
            accent: s.accent,
          },
        };
      })
    );
    message.success('Đã áp dụng khung ảnh cho tất cả bài viết đang chọn!');
  };

  // ── Hoàn tác / làm lại: lịch sử riêng từng bài, chỉ giữ trong phiên làm việc ──
  const historyRef = useRef(new Map<string, { past: EditSnapshot[]; present: EditSnapshot; future: EditSnapshot[] }>());
  const restoringRef = useRef(false);
  const [, setHistoryTick] = useState(0);
  const activeSnapKey = active && active.status === 'ready' ? JSON.stringify(snapshotOf(active)) : '';
  useEffect(() => {
    if (!active || !activeSnapKey) return;
    const h = historyRef.current.get(active.id);
    const snap = snapshotOf(active);
    if (!h) {
      historyRef.current.set(active.id, { past: [], present: snap, future: [] });
      return;
    }
    if (restoringRef.current) {
      restoringRef.current = false;
      h.present = snap;
      return;
    }
    if (JSON.stringify(h.present) === activeSnapKey) return;
    // Gom các thay đổi liên tiếp (gõ chữ, kéo thanh trượt) thành 1 bước
    const t = setTimeout(() => {
      h.past = [...h.past.slice(-(HISTORY_LIMIT - 1)), h.present];
      h.present = snap;
      h.future = [];
      setHistoryTick((n) => n + 1);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSnapKey]);

  const activeHistory = active ? historyRef.current.get(active.id) : undefined;
  const hasPendingEdit = !!activeHistory && !!activeSnapKey && JSON.stringify(activeHistory.present) !== activeSnapKey;
  const canUndo = !!activeHistory && (activeHistory.past.length > 0 || hasPendingEdit);
  const canRedo = !!activeHistory && activeHistory.future.length > 0 && !hasPendingEdit;

  const undo = () => {
    if (!active) return;
    const h = historyRef.current.get(active.id);
    if (!h) return;
    const cur = snapshotOf(active);
    if (JSON.stringify(cur) !== JSON.stringify(h.present)) {
      h.past = [...h.past.slice(-(HISTORY_LIMIT - 1)), h.present];
      h.present = cur;
    }
    const prev = h.past.pop();
    if (!prev) return;
    h.future = [h.present, ...h.future];
    h.present = prev;
    restoringRef.current = true;
    patchItem(active.id, prev);
    setHistoryTick((n) => n + 1);
  };

  const redo = () => {
    if (!active) return;
    const h = historyRef.current.get(active.id);
    const next = h?.future.shift();
    if (!h || !next) return;
    h.past = [...h.past, h.present];
    h.present = next;
    restoringRef.current = true;
    patchItem(active.id, next);
    setHistoryTick((n) => n + 1);
  };

  // ── Phím tắt ──
  const shortcutRef = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcutRef.current = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    // Đang gõ chữ / đang dùng thanh trượt, ô chọn → để trình duyệt và Ant Design tự xử lý phím
    const busy = !!el?.closest?.('input, textarea, [contenteditable="true"], [role="slider"], .ant-select, .ant-segmented, .ant-tabs-nav, .ant-modal');
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z' && !busy) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && key === 'y' && !busy) {
      e.preventDefault();
      redo();
    } else if (mod && key === 'e') {
      e.preventDefault();
      exportActive();
    } else if (!mod && !busy && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && items.length > 0) {
      e.preventDefault();
      const idx = items.findIndex((i) => i.id === activeId);
      const next = items[Math.min(items.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) setActiveId(next.id);
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => shortcutRef.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Xuất ảnh hàng loạt (các bài đang tick) ──
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchResults, setBatchResults] = useState<Array<{ id: string; title: string; url?: string; error?: string }>>([]);

  const exportChecked = async () => {
    if (checkedItems.length === 0) return message.warning('Tick chọn ít nhất 1 bài ở cột bên trái');
    const targets = checkedItems.filter((it) => !problemOf(it));
    const skipped = checkedItems.filter((it) => problemOf(it)).map((it) => ({ id: it.id, title: it.title, error: problemOf(it)! }));
    if (targets.length === 0) {
      setActiveId(skipped[0].id);
      return message.warning(`Chưa xuất được bài nào: "${skipped[0].title.slice(0, 50)}" ${skipped[0].error}`);
    }
    setBatchResults([]);
    setBatchOpen(true);
    setBatchProgress({ done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      const it = targets[i];
      try {
        const url = await renderItem(it);
        setBatchResults((prev) => [...prev, { id: it.id, title: it.title, url }]);
      } catch (e: any) {
        setBatchResults((prev) => [...prev, { id: it.id, title: it.title, error: aiError(e) }]);
      }
      setBatchProgress({ done: i + 1, total: targets.length });
    }
    setBatchResults((prev) => [...prev, ...skipped]);
    setBatchProgress(null);
  };

  const downloadImage = async (url: string, name: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 2000);
    } catch {
      window.open(url, '_blank'); // máy chủ ảnh chặn tải trực tiếp → mở tab để lưu tay
    }
  };

  const downloadAll = async () => {
    const done = batchResults.filter((r) => r.url);
    for (let i = 0; i < done.length; i++) {
      await downloadImage(done[i].url!, fileNameOf(done[i].title, i));
      await new Promise((r) => setTimeout(r, 350));
    }
  };

  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set());
  const s = active?.style;
  const sectionTitle = 'text-xs font-semibold text-slate-300';

  return (
    <div className="space-y-4">
      {/* Màn lớn: vừa khít màn hình, mỗi cột tự cuộn để preview luôn trong tầm mắt khi chỉnh */}
      <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_350px] gap-4 items-start xl:items-stretch xl:h-[calc(100vh-210px)] xl:min-h-[560px]">
        {/* ── CỘT TRÁI: danh sách bài ── */}
        <div className="app-surface p-3 space-y-3 xl:overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className={sectionTitle}>Thêm bài</span>
            <Button
              size="small"
              icon={<KeyOutlined />}
              type={parsedKeys.length === 0 ? 'primary' : 'default'}
              danger={parsedKeys.length === 0}
              className={parsedKeys.length === 0 ? 'animate-pulse font-medium text-xs' : 'text-xs'}
              onClick={() => { setKeyDraft(geminiKey); setAiModalOpen(true); }}
            >
              {parsedKeys.length > 1
                ? `AI: ${parsedKeys.length} keys`
                : parsedKeys.length === 1
                  ? 'AI: 1 key riêng'
                  : '⚠️ Nhập Key AI (Free)'}
            </Button>
          </div>
          <TextArea
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 5 }}
            placeholder="Dán 1 hoặc nhiều link bài báo, mỗi link 1 dòng"
          />
          <div className="flex gap-2">
            <Button type="primary" block onClick={handleAddLinks}>Thêm và cào bài</Button>
            <Tooltip title="Chọn bài từ Radar Tin Tức rồi bấm 'Mở Studio ảnh tin'">
              <Button onClick={() => navigate('/dashboard/news-radar')}>Từ Radar</Button>
            </Tooltip>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-slate-800">
            <span className={`${sectionTitle} pt-2`}>Bài trong Studio ({displayedItems.length}/{items.length})</span>
            <div className="flex items-center gap-2 pt-2">
              {items.some((i) => i.sentToPoster) && (
                <Popconfirm
                  title="Xoá tất cả bài đã chuyển đi đăng?"
                  description="Dọn sạch các bài đã chuyển sang Lịch đăng để danh sách gọn gàng."
                  onConfirm={removeSentItems}
                  okText="Dọn dẹp"
                  cancelText="Hủy"
                >
                  <Button size="small" type="text" className="!p-0 !h-auto text-xs text-slate-300 hover:text-amber-400">
                    Dọn đã đăng
                  </Button>
                </Popconfirm>
              )}
              {items.length > 0 && (
                <Popconfirm
                  title={`Xoá toàn bộ ${items.length} bài trong Studio?`}
                  description="Thao tác này sẽ xoá sạch danh sách bài hiện tại trong Studio."
                  onConfirm={removeAllItems}
                  okText="Xoá hết"
                  cancelText="Hủy"
                  okButtonProps={{ danger: true }}
                >
                  <Button size="small" type="text" danger className="!p-0 !h-auto text-xs hover:underline">
                    Xoá tất cả
                  </Button>
                </Popconfirm>
              )}
              {displayedItems.length > 0 && (
                <Checkbox
                  className="text-[13px]"
                  checked={displayedItems.length > 0 && displayedItems.every((i) => i.checked)}
                  indeterminate={displayedItems.some((i) => i.checked) && !displayedItems.every((i) => i.checked)}
                  onChange={(e) => {
                    const on = e.target.checked;
                    const ids = new Set(displayedItems.map((i) => i.id));
                    setItems((prev) => prev.map((i) => (ids.has(i.id) ? { ...i, checked: on } : i)));
                  }}
                >
                  Tất cả
                </Checkbox>
              )}
            </div>
          </div>

          {/* Lọc theo Kênh */}
          {customFrames.length > 0 && items.length > 0 && (
            <div className="flex items-center gap-1.5 pt-1">
              <span className="text-xs text-slate-300 shrink-0">Lọc kênh:</span>
              <Select
                size="small"
                value={channelFilter}
                onChange={setChannelFilter}
                className="flex-1 text-[13px]"
                options={[
                  { value: 'ALL', label: `Tất cả kênh (${items.length})` },
                  ...customFrames.map((f) => ({
                    value: f.id,
                    label: `${f.name} (${items.filter((i) => i.channelId === f.id || (!i.channelId && i.style.customFrameUrl === f.url)).length})`,
                  })),
                  { value: 'UNASSIGNED', label: `Chưa phân kênh (${items.filter((i) => !i.channelId && !i.style.customFrameUrl).length})` },
                ]}
              />
            </div>
          )}

          {/* Thanh gán Kênh, Mẫu, Logo & Xoá hàng loạt khi tick chọn bài */}
          {checkedItems.length > 0 && (
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/30 space-y-2 mt-1 shadow-sm">
              <div className="flex items-center justify-between text-xs font-semibold text-blue-300">
                <span>Áp dụng cho {checkedItems.length} bài đã chọn:</span>
                <Popconfirm
                  title={`Xoá ${checkedItems.length} bài đã chọn?`}
                  description="Bạn có chắc chắn muốn xoá các bài này khỏi Studio?"
                  onConfirm={removeCheckedItems}
                  okText="Xoá"
                  cancelText="Hủy"
                  okButtonProps={{ danger: true }}
                >
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} className="!p-0 !h-auto text-xs font-semibold hover:underline">
                    Xoá {checkedItems.length} bài
                  </Button>
                </Popconfirm>
              </div>

              <Button
                size="small"
                type="primary"
                icon={<RobotOutlined />}
                loading={batchCaptionLoading}
                onClick={() => rewriteBatchCaptions(checkedItems)}
                className="w-full text-xs font-semibold bg-gradient-to-r from-indigo-600 to-blue-600 border-none shadow-sm"
              >
                {batchCaptionProgress || `AI viết lại Caption (${checkedItems.length} bài)`}
              </Button>

              <div className="grid grid-cols-2 gap-1.5">
                <Select
                  size="small"
                  placeholder="Gán Kênh..."
                  className="w-full text-xs"
                  value={undefined}
                  onChange={(channelId) => applyChannelToChecked(channelId)}
                  options={customFrames.map((f) => ({
                    value: f.id,
                    label: (
                      <span className="flex items-center gap-1.5 truncate">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: f.tagColor || '#3b82f6' }} />
                        <span className="truncate">{f.name}</span>
                      </span>
                    ),
                  }))}
                />
                <Select
                  size="small"
                  placeholder="Gán Mẫu..."
                  className="w-full text-xs"
                  value={undefined}
                  onChange={(tVal) => applyTemplateToChecked(tVal as CardTemplate)}
                  options={TEMPLATES.map((t) => ({
                    value: t.value,
                    label: (
                      <span className="flex items-center gap-1 truncate">
                        {t.value === 'gradient' && <span className="text-pink-400">✨</span>}
                        <span className="truncate">{t.label}</span>
                      </span>
                    ),
                  }))}
                />
              </div>

              {/* Hàng thao tác Logo hàng loạt */}
              <div className="pt-2 border-t border-blue-500/20 space-y-1.5">
                <div className="text-xs text-slate-200 font-medium flex items-center gap-1.5">
                  <PictureOutlined className="text-sky-400 text-[13px]" />
                  <span>Logo ({checkedItems.length} bài):</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    size="small"
                    icon={<EyeInvisibleOutlined />}
                    onClick={() => toggleLogoForChecked(false)}
                    className="w-full !text-xs !h-7 bg-slate-800/90 border-slate-700 text-rose-300 hover:text-rose-200 hover:border-rose-500 rounded-lg flex items-center justify-center gap-1"
                    title="Ẩn / bỏ logo cho toàn bộ các bài đang chọn"
                  >
                    Bỏ logo
                  </Button>
                  <Button
                    size="small"
                    icon={<PictureOutlined />}
                    onClick={() => toggleLogoForChecked(true)}
                    className="w-full !text-xs !h-7 bg-slate-800/90 border-slate-700 text-sky-300 hover:text-sky-200 hover:border-sky-500 rounded-lg flex items-center justify-center gap-1"
                    title="Bật lại logo cho toàn bộ các bài đang chọn"
                  >
                    Bật logo
                  </Button>
                </div>
              </div>
            </div>
          )}

          {displayedItems.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-sm">Không có bài nào phù hợp</span>} />
          ) : (
            <div className="space-y-1.5 max-h-[60vh] xl:max-h-none overflow-y-auto pr-1">
              {displayedItems.map((it) => (
                <div
                  key={it.id}
                  onClick={() => setActiveId(it.id)}
                  className={`flex gap-2.5 p-2 rounded-lg border cursor-pointer transition-colors ${it.id === activeId ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 hover:border-slate-600 hover:bg-slate-800/40'}`}
                >
                  <Checkbox checked={it.checked} onClick={(e) => e.stopPropagation()} onChange={(e) => patchItem(it.id, { checked: e.target.checked })} />
                  <div className="w-14 h-14 rounded-md bg-slate-900 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                    {(it.selectedImages[0] || it.images[0] || it.cardUrl) ? (
                      <img src={it.selectedImages[0] || it.images[0] || it.cardUrl} referrerPolicy="no-referrer" alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-center p-1">
                        <span className="text-base leading-none">💬</span>
                        <span className="text-[11px] text-cyan-400 font-bold mt-1 tracking-tight">Thẻ chữ</span>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-slate-100 font-medium line-clamp-2 leading-snug">{it.title}</div>
                    <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>{sourceName(it.url)}</span>
                      {it.channelName && (
                        <span
                          className="px-1.5 py-0.5 rounded text-[11px] font-semibold text-white truncate max-w-[120px]"
                          style={{
                            backgroundColor:
                              customFrames.find((f) => f.id === it.channelId)?.tagColor || '#2563eb',
                          }}
                        >
                          {it.channelName}
                        </span>
                      )}
                      {it.status === 'ready' && !it.sentToPoster && (
                        problemOf(it) ? (
                          <span className="text-amber-400"> · {problemOf(it)}</span>
                        ) : it.selectedImages.length === 0 && !it.videoUrl ? (
                          <span className="text-cyan-400 font-medium"> · Thẻ chữ</span>
                        ) : null
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      {statusTag(it)}
                      <Button
                        size="small"
                        type="text"
                        icon={<DeleteOutlined />}
                        className="!ml-auto !text-slate-500"
                        onClick={(e) => { e.stopPropagation(); removeItem(it.id); }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── CỘT GIỮA: preview + caption ── */}
        <div className="app-surface p-4 space-y-4 xl:overflow-y-auto">
          {!active ? (
            <Empty description="Thêm bài ở cột bên trái để bắt đầu" className="py-20" />
          ) : active.status === 'loading' ? (
            <div className="py-32 text-center"><Spin /><div className="text-xs text-slate-400 mt-3">Đang cào toàn bộ nội dung và ảnh của bài...</div></div>
          ) : active.status === 'error' ? (
            <div className="py-24 text-center space-y-3">
              <div className="text-sm text-red-400">Không cào được bài: {active.error}</div>
              <Button onClick={() => patchItem(active.id, { status: 'loading', error: undefined })}>Thử lại</Button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Segmented
                  size="small"
                  value={previewMode}
                  onChange={(v) => setPreviewMode(v as 'card' | 'facebook')}
                  options={[{ value: 'card', label: 'Ảnh' }, { value: 'facebook', label: 'Bài Facebook' }]}
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <Segmented
                    size="small"
                    value={active.style.ratio}
                    onChange={(v) => setStyle({ ratio: v as CardRatio })}
                    options={[{ value: '1:1', label: 'Vuông 1:1' }, { value: '4:5', label: 'Dọc 4:5' }]}
                  />
                  <Tooltip title="Hoàn tác (Ctrl/Cmd + Z)">
                    <Button size="small" icon={<UndoOutlined />} disabled={!canUndo} onClick={undo} aria-label="Hoàn tác" />
                  </Tooltip>
                  <Tooltip title="Làm lại (Ctrl/Cmd + Shift + Z)">
                    <Button size="small" icon={<RedoOutlined />} disabled={!canRedo} onClick={redo} aria-label="Làm lại" />
                  </Tooltip>
                  <Popover
                    title="Phím tắt"
                    placement="bottomRight"
                    content={
                      <div className="space-y-1 text-xs min-w-[220px]">
                        {SHORTCUTS.map(([k, d]) => (
                          <div key={k} className="flex justify-between gap-4"><span className="text-slate-400">{d}</span><kbd className="font-mono text-[11px]">{k}</kbd></div>
                        ))}
                      </div>
                    }
                  >
                    <Button size="small" type="text" icon={<QuestionCircleOutlined />} aria-label="Phím tắt" />
                  </Popover>
                  {active.videoUrl && (
                    <>
                      <Button
                        size="small"
                        type={previewSoundOn ? 'primary' : 'default'}
                        className={previewSoundOn ? '!bg-emerald-600 hover:!bg-emerald-500 !border-emerald-500 font-semibold shadow-sm' : '!border-slate-600 text-slate-300 hover:text-white'}
                        icon={previewSoundOn ? <SoundOutlined /> : <MutedOutlined />}
                        loading={loadingAudio}
                        onClick={togglePreviewSound}
                        title={previewSoundOn ? 'Đang phát tiếng clip (nhấn để tắt)' : 'Bật tiếng để nghe clip'}
                      >
                        {previewSoundOn ? 'Đang bật tiếng' : 'Bật tiếng preview'}
                      </Button>
                      <Button
                        size="small"
                        type="primary"
                        className="!bg-purple-600 hover:!bg-purple-500 !border-purple-500 font-semibold shadow-sm"
                        icon={<PlayCircleOutlined />}
                        loading={exporting}
                        onClick={exportActiveVideo}
                      >
                        Tải Video MP4
                      </Button>
                    </>
                  )}
                  <Button size="small" type={active.videoUrl ? 'default' : 'primary'} icon={<DownloadOutlined />} loading={exporting} onClick={exportActive}>
                    {active.videoUrl ? 'Tải Thumbnail' : 'Tải ảnh'}
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2 -mt-2">
                {active.videoUrl && <Tag color="purple" className="!mr-0 font-semibold">🎬 Tin Video</Tag>}
                <a href={active.url} target="_blank" rel="noreferrer" className="block text-xs text-slate-400 truncate hover:text-blue-400 flex-1">{active.title}</a>
              </div>

              {(() => {
                const canvas = (
                  <div
                    ref={previewRef}
                    className={previewMode === 'facebook' ? 'relative w-full overflow-hidden bg-black select-none' : 'relative w-full max-w-[560px] mx-auto overflow-hidden rounded-lg border border-slate-700 bg-black select-none'}
                    style={{ aspectRatio: `${CARD_SIZE} / ${cardH}` }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                      setDragOverCanvas(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setDragOverCanvas(false);
                    }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      setDragOverCanvas(false);
                      if (!active) return;
                      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
                      if (files.length > 0) {
                        message.loading({ content: `Đang tải lên ${files.length} ảnh...`, key: 'canvas-drop' });
                        for (const f of files) {
                          await uploadImage(f);
                        }
                        message.success({ content: `Đã nạp ${files.length} ảnh vào bài thành công!`, key: 'canvas-drop' });
                        return;
                      }
                      const draggedUrl = e.dataTransfer.getData('text/plain');
                      if (draggedUrl && active.images.includes(draggedUrl)) {
                        toggleImage(draggedUrl);
                      }
                    }}
                  >
                    <iframe
                      ref={iframeRef}
                      title="preview"
                      srcDoc={debouncedHtml}
                      style={{ width: CARD_SIZE, height: cardH, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
                    />
                    {/* Lớp bắt chuột để kéo thả các phần tử trong iframe */}
                    <div
                      className="absolute inset-0"
                      style={{ cursor: dragging ? 'grabbing' : hoverKind ? (hoverKind === 'photo' ? 'grab' : 'move') : 'default' }}
                      onMouseDown={onPreviewMouseDown}
                      onMouseMove={(e) => { if (!dragging) setHoverKind(hitTest(e.clientX, e.clientY)?.kind || null); }}
                      onMouseLeave={() => !dragging && setHoverKind(null)}
                      onWheel={onPreviewWheel}
                    />

                    {dragOverCanvas && (
                      <div className="absolute inset-0 z-30 bg-blue-600/40 border-2 border-dashed border-cyan-400 rounded-lg flex flex-col items-center justify-center text-white backdrop-blur-sm pointer-events-none">
                        <CloudUploadOutlined className="text-4xl text-cyan-300 animate-bounce mb-1.5" />
                        <span className="font-bold text-sm text-cyan-100">Thả file ảnh vào đây để nạp vào bài</span>
                        <span className="text-xs text-cyan-200/80 mt-0.5">Hỗ trợ ảnh PNG, JPG, WebP...</span>
                      </div>
                    )}

                    {active.videoUrl && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePreviewSound();
                        }}
                        className="absolute bottom-3 right-3 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/85 hover:bg-black text-white text-xs font-semibold backdrop-blur-md border border-white/20 shadow-xl cursor-pointer transition-all hover:scale-105 active:scale-95"
                        title={previewSoundOn ? 'Nhấn để tắt tiếng' : 'Nhấn để nghe âm thanh clip'}
                      >
                        {loadingAudio ? (
                          <Spin size="small" />
                        ) : previewSoundOn ? (
                          <SoundOutlined className="text-emerald-400 text-sm animate-pulse" />
                        ) : (
                          <MutedOutlined className="text-slate-300 text-sm" />
                        )}
                        <span>{loadingAudio ? 'Đang tải tiếng...' : previewSoundOn ? 'Tắt tiếng' : '🔊 Nghe tiếng'}</span>
                      </button>
                    )}
                  </div>
                );
                if (previewMode !== 'facebook') return canvas;
                const post = postOf(active);
                return (
                  <FacebookPostPreview
                    pageName={active.style.footerText?.trim() || 'Tên Page của bạn'}
                    avatarUrl={active.style.logoUrl ? logoSourceOf(active.style) : undefined}
                    caption={post.caption}
                    comment={post.comment}
                  >
                    {canvas}
                  </FacebookPostPreview>
                );
              })()}
              <div className="text-xs text-slate-400 text-center -mt-2">
                Kéo trực tiếp trên ảnh để di chuyển ảnh tròn, logo, nhãn, nguồn/watermark{active.style.fit === 'cover' ? ' hoặc chỉnh góc ảnh' : ''}.
              </div>

              {(() => {
                const cells = cellsFor(active.layout, active.style.ratio);
                const blurry = active.selectedImages.filter((u, i) => {
                  const size = active.imageSizes?.[u];
                  return size && upscaleOf(size, cells[i] || cells[0], active.style.fit) > BLUR_FACTOR;
                });
                if (blurry.length === 0) return null;
                const size = active.imageSizes![blurry[0]];
                return (
                  <div className="max-w-[560px] mx-auto text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5">
                    Ảnh đang dùng chỉ {size[0]}×{size[1]}px, phải phóng to nhiều nên sẽ bị mờ. Nên chọn ảnh có số to hơn (ảnh có nhãn vàng là ảnh nhỏ), tải ảnh nét hơn lên, chọn "Giữ đủ ảnh", hoặc ghép 2-4 ảnh để mỗi ô nhỏ lại.
                  </div>
                );
              })()}

              {/* Caption */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Segmented
                    size="small"
                    value={active.captionMode}
                    onChange={(v) => patchItem(active.id, { captionMode: v as CaptionMode })}
                    options={[{ value: 'full', label: 'Caption đầy đủ' }, { value: 'hook', label: 'Hook ngắn + nội dung ở bình luận' }]}
                  />
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Button size="small" icon={<ReloadOutlined />} loading={captionAiLoading} onClick={() => rewriteCaption(active)}>
                      AI viết lại nội dung
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      icon={<RobotOutlined />}
                      loading={batchCaptionLoading}
                      onClick={() => rewriteBatchCaptions()}
                      title="AI viết lại caption sâu sắc, giàu thông tin và số liệu cho toàn bộ các bài"
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 border-none text-white font-medium shadow-sm hover:from-blue-500 hover:to-indigo-500"
                    >
                      {batchCaptionProgress || `Viết lại TẤT CẢ Caption (${checkedItems.length > 0 ? checkedItems.length : items.length} bài)`}
                    </Button>
                  </div>
                </div>

                {active.captionMode === 'full' ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className={sectionTitle}>Caption đăng kèm</span>
                      {active.caption !== undefined && (
                        <Button size="small" type="link" onClick={() => patchItem(active.id, { caption: undefined })}>Dùng bản mặc định</Button>
                      )}
                    </div>
                    <TextArea
                      value={fullCaptionOf(active)}
                      onChange={(e) => patchItem(active.id, { caption: e.target.value })}
                      autoSize={{ minRows: 6, maxRows: 16 }}
                      className="text-[13px]"
                    />
                    <div className="text-xs text-slate-400">
                      {active.summary ? 'Mặc định là bản tóm tắt AI soạn.' : 'Mặc định là toàn bộ nội dung bài đã cào.'} Khi chuyển đi đăng sẽ tự thêm dòng "Nguồn: {sourceName(active.url)}" nếu chưa có.
                    </div>
                  </>
                ) : (
                  <>
                    <div className={sectionTitle}>Caption (hook ngắn)</div>
                    <TextArea
                      value={active.hook || ''}
                      onChange={(e) => patchItem(active.id, { hook: e.target.value })}
                      autoSize={{ minRows: 2, maxRows: 5 }}
                      placeholder="2-3 câu gây tò mò. Bấm 'AI soạn bài' ở cột phải để AI viết."
                      className="text-[13px]"
                    />
                    <div className="flex items-center justify-between">
                      <span className={sectionTitle}>Bình luận đầu tiên (nội dung + nguồn)</span>
                      {active.comment !== undefined && (
                        <Button size="small" type="link" onClick={() => patchItem(active.id, { comment: undefined })}>Dùng bản mặc định</Button>
                      )}
                    </div>
                    <TextArea
                      value={commentOf(active)}
                      onChange={(e) => patchItem(active.id, { comment: e.target.value })}
                      autoSize={{ minRows: 5, maxRows: 14 }}
                      className="text-[13px]"
                    />
                    <div className="text-xs text-slate-400">Bình luận được thả ngay sau khi đăng bài, tự thêm dòng nguồn nếu chưa có.</div>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── CỘT PHẢI: chỉnh sửa, chia tab cho gọn ── */}
        <div className="app-surface p-4 flex flex-col gap-3 xl:overflow-hidden">
          {!active || active.status !== 'ready' || !s ? (
            <div className="text-xs text-slate-500 py-10 text-center">Chọn một bài đã cào xong để chỉnh</div>
          ) : (
            <>
              {/* Thanh chọn Kênh & Mẫu nhanh trên đầu bộ soạn */}
              <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-xs font-semibold text-slate-300 shrink-0">Kênh:</span>
                    <Select
                      size="small"
                      className="flex-1 text-xs"
                      placeholder="Chọn Kênh thương hiệu..."
                      value={active.channelId || (active.style.customFrameUrl ? customFrames.find((f) => f.url === active.style.customFrameUrl)?.id : undefined)}
                      onChange={(val) => applyChannelToItem(active.id, val)}
                      options={customFrames.map((f) => ({
                        value: f.id,
                        label: (
                          <span className="flex items-center gap-1.5 truncate">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: f.tagColor || '#3b82f6' }} />
                            <span className="truncate">{f.name}</span>
                          </span>
                        ),
                      }))}
                    />
                  </div>
                  {checkedItems.length > 1 && (
                    <Button
                      size="small"
                      type="dashed"
                      onClick={applyCurrentChannelToAllChecked}
                      title={`Áp dụng khung và phong cách của kênh này cho tất cả ${checkedItems.length} bài đã chọn`}
                    >
                      Gán Kênh ({checkedItems.length})
                    </Button>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-800/60">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-xs font-semibold text-slate-300 shrink-0">Mẫu:</span>
                    <Select
                      size="small"
                      className="flex-1 text-xs"
                      value={normalizeTemplate(s.template)}
                      onChange={(tVal) => {
                        const tpl = tVal as CardTemplate;
                        setStyle({
                          template: tpl,
                          ...(tpl === 'gradient'
                            ? { useCustomFrame: false, bandBg: '#090d16', textColor: '#ffffff', accent: '#ec4899' }
                            : {}),
                        });
                      }}
                      options={TEMPLATES.map((t) => ({
                        value: t.value,
                        label: (
                          <span className="flex items-center gap-1.5 truncate">
                            {t.value === 'gradient' && <span className="text-pink-400">✨</span>}
                            <span>{t.label}</span>
                          </span>
                        ),
                      }))}
                    />
                  </div>
                  {checkedItems.length > 1 && (
                    <Button
                      size="small"
                      type="dashed"
                      onClick={() => applyTemplateToChecked(normalizeTemplate(s.template))}
                      title={`Gán mẫu thiết kế này cho tất cả ${checkedItems.length} bài đã chọn`}
                    >
                      Gán Mẫu ({checkedItems.length})
                    </Button>
                  )}
                </div>
              </div>

              <Button type="primary" block icon={<RobotOutlined />} loading={active.headlineLoading} onClick={() => runPackage(active)}>
                AI soạn bài (tiêu đề, caption, tóm tắt, nhãn)
              </Button>
              {checkedItems.length > 1 && (
                <Button
                  block
                  size="small"
                  icon={<RobotOutlined />}
                  loading={batchCaptionLoading}
                  onClick={runPackageForAllChecked}
                  className="mt-1 text-xs text-blue-300 border-blue-500/30 hover:border-blue-400"
                >
                  {batchCaptionProgress || `AI soạn bài cho tất cả ${checkedItems.length} bài chọn`}
                </Button>
              )}
              <div className="flex-1 min-h-0 flex flex-col">
                <Tabs
                  size="small"
                  activeKey={editorTab}
                  onChange={setEditorTab}
                  className="studio-editor-tabs"
                  items={[
                  {
                    key: 'content',
                    label: 'Nội dung',
                    children: (
                      <div className="space-y-5 pb-2">
                        {/* Tiêu đề */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className={sectionTitle}>Tiêu đề trên ảnh</span>
                            <Button size="small" icon={<ReloadOutlined />} loading={active.headlineLoading} onClick={() => generateHeadline(active)}>Chỉ viết lại tiêu đề</Button>
                          </div>
                          <TextArea
                            ref={headlineRef}
                            value={active.headline}
                            onChange={(e) => patchItem(active.id, { headline: e.target.value })}
                            onKeyDown={(e) => {
                              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); highlightSelection(); }
                            }}
                            autoSize={{ minRows: 3, maxRows: 7 }}
                            placeholder="Tiêu đề in hoa, cụm trong [[ ]] sẽ tô màu nhấn"
                          />
                          {(() => {
                            const words = active.headline.replace(/\[\[|\]\]/g, '').trim().split(/\s+/).filter(Boolean).length;
                            return (
                              <div className="flex items-center justify-between mt-1 gap-2">
                                <span className={`text-xs ${words > 40 ? 'text-amber-400' : 'text-slate-400'}`}>
                                  {words} từ{words > 40 ? ' · hơi dài, chữ sẽ nhỏ' : ''} · bôi đen + Cmd/Ctrl+B để tô màu
                                </span>
                                <Button size="small" onClick={highlightSelection}>Tô màu</Button>
                              </div>
                            );
                          })()}

                          {/* Chọn nhanh màu chữ chính & màu nhấn ngay tại tab Nội dung */}
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/80 text-xs text-slate-300 flex-wrap gap-2">
                            <div className="flex items-center gap-1.5">
                              <span>Màu chữ:</span>
                              <ColorPicker size="small" value={s.textColor} onChange={(c) => setStyle({ textColor: c.toHexString() })} />
                              {['#111827', '#ffffff', '#1e293b', '#0369a1'].map((c) => (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() => setStyle({ textColor: c })}
                                  className={`w-4 h-4 rounded-full border cursor-pointer transition-transform ${s.textColor.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-blue-500 scale-110 border-white' : 'border-slate-600 hover:scale-105'}`}
                                  style={{ background: c }}
                                  title={`Màu chữ ${c}`}
                                />
                              ))}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span>Màu nhấn [[ ]]:</span>
                              <ColorPicker size="small" value={s.accent} onChange={(c) => setStyle({ accent: c.toHexString() })} />
                              {['#e11d48', '#d97706', '#2563eb', '#16a34a'].map((c) => (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() => setStyle({ accent: c })}
                                  className={`w-4 h-4 rounded-full border cursor-pointer transition-transform ${s.accent.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-blue-500 scale-110 border-white' : 'border-slate-600 hover:scale-105'}`}
                                  style={{ background: c }}
                                  title={`Màu nhấn ${c}`}
                                />
                              ))}
                            </div>
                          </div>
                          {(active.aiError || active.headlineFromTitle || !active.headline.trim()) && !active.headlineLoading && (
                            <div className="mt-2 text-xs rounded-lg p-2.5 bg-red-500/10 border border-red-500/30 text-red-300 space-y-1.5">
                              <div>
                                {!active.headline.trim()
                                  ? 'Chưa có tiêu đề nên dải chữ trên ảnh đang trống.'
                                  : active.headlineFromTitle
                                    ? 'AI lỗi nên đang tạm dùng tiêu đề gốc của bài báo.'
                                    : 'Lần gọi AI gần nhất bị lỗi.'}
                                {active.aiError && <> Lý do: {active.aiError}</>}
                              </div>
                              {/key|API_KEY|quota|429|Quota/i.test(active.aiError || '') && (
                                <div className="text-red-200/80">Kiểm tra lại hoặc thêm nhiều API key ở nút "Cài đặt AI" (cột trái) để hệ thống tự động xoay vòng key khi hết quota.</div>
                              )}
                              <div className="flex gap-2">
                                <Button size="small" type="primary" danger onClick={() => runPackage(active)}>Thử lại AI</Button>
                                {!active.headline.trim() && (
                                  <Button size="small" onClick={() => patchItem(active.id, { headline: cleanHeadline(active.title), headlineFromTitle: true })}>Dùng tiêu đề bài báo</Button>
                                )}
                              </div>
                            </div>
                          )}
                          <div className="mt-2">
                            <Button size="small" type="dashed" block loading={suggesting} onClick={() => suggestHeadlines(active)}>
                              AI gợi ý 3 tiêu đề khác
                            </Button>
                            {(suggestions[active.id] || []).length > 0 && (
                              <div className="mt-2 space-y-1.5">
                                {suggestions[active.id].map((h) => (
                                  <button
                                    key={h}
                                    type="button"
                                    onClick={() => patchItem(active.id, { headline: h })}
                                    className={`w-full text-left text-xs leading-snug p-2 rounded-md border cursor-pointer bg-transparent ${h === active.headline ? 'border-blue-500 text-slate-100' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
                                  >
                                    {h.split(/(\[\[[\s\S]*?\]\])/g).map((part, i) => {
                                      const m = part.match(/^\[\[([\s\S]*?)\]\]$/);
                                      return m ? <span key={i} className="text-red-400 font-semibold">{m[1]}</span> : <span key={i}>{part}</span>;
                                    })}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: 'images',
                    label: 'Ảnh',
                    children: (
                      <div className="space-y-5 pb-2">
                        {/* Ảnh */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className={sectionTitle}>Ảnh trong bài ({active.images.length})</span>
                            <Upload accept="image/*" showUploadList={false} beforeUpload={uploadImage}>
                              <Button size="small" icon={<UploadOutlined />}>Tải thêm</Button>
                            </Upload>
                          </div>
                          <div className="text-xs text-slate-400 mb-2">Bấm để chọn ảnh, chọn 2-4 ảnh để ghép. Số trên ảnh là thứ tự ghép.</div>
                          <div className="grid grid-cols-4 gap-1.5 max-h-56 overflow-y-auto pr-1">
                            {active.images.map((url) => {
                              const idx = active.selectedImages.indexOf(url);
                              const isInset = active.inset?.url === url;
                              const isSmall = active.smallImages?.includes(url);
                              const size = active.imageSizes?.[url];
                              const cells = cellsFor(active.layout, active.style.ratio);
                              const blurry = size ? upscaleOf(size, cells[Math.max(0, idx)] || cells[0], active.style.fit) > BLUR_FACTOR : false;
                              return (
                                <div
                                  key={url}
                                  draggable
                                  onDragStart={(e) => e.dataTransfer.setData('text/plain', url)}
                                  className={`relative aspect-square rounded-md overflow-hidden border-2 cursor-grab active:cursor-grabbing ${idx >= 0 ? 'border-blue-500' : isInset ? 'border-red-500' : 'border-transparent'}`}
                                  onClick={() => toggleImage(url)}
                                  title="Bấm để chọn/bỏ chọn, hoặc kéo thả vào khung ảnh"
                                >
                                  {brokenThumbs.has(url) ? (
                                    <div className="w-full h-full grid place-items-center bg-slate-900 text-[10px] text-slate-400 text-center p-1 leading-tight">Không xem trước được</div>
                                  ) : (
                                    <img
                                      src={url}
                                      referrerPolicy="no-referrer"
                                      alt=""
                                      className={`w-full h-full object-cover ${isSmall && idx < 0 ? 'opacity-40' : ''}`}
                                      onError={() => setBrokenThumbs((prev) => new Set(prev).add(url))}
                                    />
                                  )}
                                  {size && (
                                    <span className={`absolute bottom-0.5 left-0.5 text-[10px] px-1 rounded ${blurry ? 'bg-amber-600/90 text-white' : 'bg-black/70 text-slate-200'}`}>
                                      {size[0]}×{size[1]}
                                    </span>
                                  )}
                                  {isSmall && <span className="absolute top-0.5 right-0.5 text-[10px] px-1 rounded bg-black/70 text-slate-200">nhỏ</span>}
                                  {idx >= 0 && <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded bg-blue-600 text-white text-xs font-bold grid place-items-center">{idx + 1}</span>}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {active.selectedImages.length > 0 && (
                          <div>
                            <div className={`${sectionTitle} mb-1.5`}>Bố cục ảnh</div>
                            {active.selectedImages.length === 1 && (
                              <div className="text-xs text-slate-400">Chọn thêm 1-3 ảnh ở trên để có các kiểu ghép ảnh.</div>
                            )}
                            {active.selectedImages.length > 1 && (
                              <>
                                <div className="grid grid-cols-3 gap-1.5">
                                  {LAYOUTS_BY_COUNT[Math.min(4, active.selectedImages.length)].map((l) => {
                                    const on = active.layout === l.value;
                                    return (
                                      <button
                                        key={l.value}
                                        type="button"
                                        onClick={() => patchItem(active.id, { layout: l.value })}
                                        className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border cursor-pointer bg-transparent transition-colors ${on ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 hover:border-slate-500'}`}
                                      >
                                        <LayoutIcon layout={l.value} active={on} />
                                        <span className={`text-xs leading-tight text-center ${on ? 'text-blue-300' : 'text-slate-300'}`}>{l.label}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                                <div className="mt-3 space-y-2.5">
                                  <FieldSlider label="Khoảng cách giữa ảnh" value={s.photoGap ?? 8} unit="px" min={0} max={30} step={1} onChange={(v) => setStyle({ photoGap: v })} />
                                  {active.layout !== 'diag2' && (
                                    <FieldSlider label="Bo góc từng ảnh" value={s.photoRadius ?? 0} unit="px" min={0} max={48} step={2} onChange={(v) => setStyle({ photoRadius: v })} />
                                  )}
                                  <div>
                                    <div className="text-xs text-slate-300 mb-1">Màu đường chia</div>
                                    <Segmented
                                      block
                                      size="small"
                                      value={s.gapColor || 'band'}
                                      onChange={(v) => setStyle({ gapColor: v as CardStyle['gapColor'] })}
                                      options={[{ value: 'band', label: 'Theo nền' }, { value: 'white', label: 'Trắng' }, { value: 'accent', label: 'Màu nhấn' }]}
                                    />
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {/* Vừa khung */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className={sectionTitle}>Ảnh vừa khung</span>
                            {active.fitManual ? (
                              <button type="button" className="text-xs text-blue-400 bg-transparent border-0 p-0 cursor-pointer" onClick={() => patchItem(active.id, { fitManual: false })}>Để Studio tự chọn</button>
                            ) : (
                              <span className="text-xs text-slate-400">Tự chọn theo ảnh</span>
                            )}
                          </div>
                          <Segmented
                            block
                            size="small"
                            value={s.fit}
                            onChange={(v) => { setStyle({ fit: v as CardStyle['fit'] }); patchItem(active.id, { fitManual: true }); }}
                            options={[{ value: 'cover', label: 'Cắt đầy khung' }, { value: 'contain', label: 'Giữ đủ ảnh' }]}
                          />
                          {s.fit === 'cover' && (
                            <div className="mt-2.5 space-y-2 pt-2 border-t border-slate-800/60">
                              <div className="flex items-center justify-between text-xs text-slate-300">
                                <span>Phần ảnh hiển thị (Trên / Dưới)</span>
                                <span className="text-slate-300 font-mono text-xs">{s.focusY}%</span>
                              </div>
                              <div className="grid grid-cols-3 gap-1">
                                <Button
                                  size="small"
                                  className={s.focusY <= 25 ? '!border-blue-500 !text-blue-300' : ''}
                                  onClick={() => setStyle({ focusY: 10 })}
                                >
                                  ⬆ Lấy trên (Đầu)
                                </Button>
                                <Button
                                  size="small"
                                  className={s.focusY > 25 && s.focusY < 75 ? '!border-blue-500 !text-blue-300' : ''}
                                  onClick={() => setStyle({ focusY: 50 })}
                                >
                                  ⏺ Căn giữa
                                </Button>
                                <Button
                                  size="small"
                                  className={s.focusY >= 75 ? '!border-blue-500 !text-blue-300' : ''}
                                  onClick={() => setStyle({ focusY: 90 })}
                                >
                                  ⬇ Lấy dưới
                                </Button>
                              </div>
                              <Slider
                                min={0}
                                max={100}
                                step={1}
                                value={s.focusY}
                                onChange={(v) => setStyle({ focusY: v })}
                                tooltip={{ formatter: (v) => `${v}% (0%: Đỉnh, 100%: Đáy)` }}
                              />
                              <div className="text-xs text-slate-300">
                                👉 Mẹo: Bạn cũng có thể dùng chuột kéo trực tiếp ảnh trên khung xem trước lên/xuống để chỉnh góc đẹp nhất.
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Watermark / Nhãn thương hiệu Thạnh Phú & Che logo cũ */}
                        <div className="pt-3 border-t border-slate-800/80 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white flex items-center gap-1.5">
                              🏷️ Nhãn thương hiệu / Chữ ký (Thạnh Phú)
                            </span>
                            {s.videoWatermark ? (
                              <Tag color="cyan" className="!mr-0 !text-xs">Đang bật: {s.videoWatermark}</Tag>
                            ) : (
                              <Tag className="!mr-0 !text-xs text-slate-300">Tắt</Tag>
                            )}
                          </div>
                          <div className="text-xs text-slate-300 leading-relaxed">
                            Chèn chữ ký bản quyền thương hiệu lên video/ảnh hoặc di chuyển để che logo watermark cũ.
                          </div>
                          <div className="space-y-1.5">
                            <Input
                              size="small"
                              placeholder="Nhập tên thương hiệu: @channel, Tin Tức 24h..."
                              value={s.videoWatermark || ''}
                              onChange={(e) => setStyle({ videoWatermark: e.target.value })}
                              allowClear
                            />
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs text-slate-300 font-medium">Chọn nhanh:</span>
                              {(() => {
                                const currentUserName = (() => {
                                  try {
                                    return JSON.parse(localStorage.getItem('user') || '{}')?.username || '';
                                  } catch { return ''; }
                                })();
                                const chips = [
                                  currentUserName,
                                  currentUserName ? `@${currentUserName.toLowerCase().replace(/\s+/g, '')}` : '',
                                  '@channel',
                                  'Official Studio',
                                  '⚡ Breaking News',
                                  'Bản Tin 24h',
                                ].filter(Boolean);
                                return chips.map((chip) => (
                                  <Button
                                    key={chip}
                                    size="small"
                                    type={s.videoWatermark === chip ? 'primary' : 'dashed'}
                                    className={`!text-xs !h-7 !px-2.5 font-medium ${
                                      s.videoWatermark === chip
                                        ? 'bg-blue-600 text-white border-blue-400'
                                        : 'bg-slate-900/60 text-slate-300 hover:!text-cyan-300 hover:!border-cyan-400'
                                    }`}
                                    onClick={() => {
                                      const currentPos = (s.videoWatermarkX === undefined || s.videoWatermarkX === 74) ? { videoWatermarkPos: 'center' as const, videoWatermarkX: 35, videoWatermarkY: 46 } : {};
                                      setStyle({ videoWatermark: chip, ...currentPos });
                                    }}
                                  >
                                    {chip}
                                  </Button>
                                ));
                              })()}
                              {s.videoWatermark && (
                                <Button
                                  size="small"
                                  danger
                                  type="text"
                                  className="!text-xs !h-7 !px-2"
                                  onClick={() => setStyle({ videoWatermark: '' })}
                                >
                                  ✕ Tắt nhãn
                                </Button>
                              )}
                            </div>
                          </div>

                          {s.videoWatermark && (
                            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5 space-y-2.5">
                              <div className="bg-cyan-950/40 border border-cyan-800/40 rounded p-2.5 text-xs text-cyan-200 flex items-start gap-1.5">
                                <span className="text-base leading-none">💡</span>
                                <span>
                                  <b>Kéo thả trực tiếp:</b> Dùng chuột kéo nhãn nguồn trên khung xem trước đến bất kỳ đâu (hoặc đè thẳng lên logo cũ để che). Cuộn chuột trên nhãn để đổi cỡ chữ nhanh!
                                </span>
                              </div>

                                <div>
                                  <div className="text-xs text-slate-300 mb-1.5 font-medium">Kiểu hiển thị & Che logo:</div>
                                  <div className="grid grid-cols-3 gap-1.5">
                                    {[
                                      { value: 'clean', label: 'Không viền', desc: 'Chữ đổ bóng' },
                                      { value: 'stroke', label: 'Viền đen', desc: 'Chuẩn TikTok' },
                                      { value: 'glass', label: 'Kính mờ', desc: 'Bán trong suốt' },
                                      { value: 'blur', label: 'Che mờ', desc: 'Mờ nền sau' },
                                      { value: 'card', label: 'Thẻ đen', desc: 'Hộp bo góc' },
                                      { value: 'dark', label: 'Tối mờ', desc: 'Nền tối nhẹ' },
                                      { value: 'accent', label: 'Màu nhấn', desc: 'Theo màu chủ đề' },
                                    ].map((opt) => {
                                      const isSelected = (s.videoWatermarkBg || 'clean') === opt.value;
                                      return (
                                        <button
                                          key={opt.value}
                                          type="button"
                                          onClick={() => setStyle({ videoWatermarkBg: opt.value as any })}
                                          className={`px-2 py-1.5 rounded-lg text-xs font-semibold border text-center transition-all cursor-pointer ${
                                            isSelected
                                              ? 'bg-blue-600 border-blue-400 text-white shadow-sm ring-1 ring-blue-400/50'
                                              : 'bg-slate-800/90 border-slate-700/80 text-slate-300 hover:bg-slate-750 hover:text-white hover:border-slate-600'
                                          }`}
                                          title={opt.desc}
                                        >
                                          {opt.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <div className="text-xs text-slate-300 mt-1.5">
                                    💡 <b>Không viền</b> & <b>Viền đen</b>: Chữ nổi không có khung hộp bọc quanh, đặt ở giữa hoặc kéo ở đâu cũng thoáng mắt, dễ nhìn!
                                  </div>
                                </div>

                                <div>
                                  <div className="text-xs text-slate-300 mb-1 font-medium">Đặt nhanh vị trí:</div>
                                  <div className="flex items-center gap-1.5">
                                    <CornerButtons
                                      value={s.videoWatermarkPos === 'center' ? undefined : s.videoWatermarkPos}
                                      onPick={(c) => {
                                        const coords: Record<Corner, [number, number]> = {
                                          tr: [74, 4],
                                          tl: [4, 4],
                                          br: [74, 88],
                                          bl: [4, 88],
                                        };
                                        const [x, y] = coords[c] || [74, 4];
                                        setStyle({ videoWatermarkPos: c, videoWatermarkX: x, videoWatermarkY: y });
                                      }}
                                    />
                                    <Button
                                      size="small"
                                      type={s.videoWatermarkX === 35 && s.videoWatermarkY === 46 ? 'primary' : 'dashed'}
                                      className="!text-xs !h-7 text-cyan-300 border-cyan-700/60"
                                      onClick={() => setStyle({ videoWatermarkPos: 'center', videoWatermarkX: 35, videoWatermarkY: 46 })}
                                    >
                                      📍 Ra giữa video
                                    </Button>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  <FieldSlider
                                    label="X (Ngang)"
                                    value={s.videoWatermarkX ?? 74}
                                    unit="%"
                                    min={0}
                                    max={95}
                                    step={1}
                                    onChange={(v) => setStyle({ videoWatermarkX: v })}
                                  />
                                <FieldSlider
                                  label="Y (Dọc)"
                                  value={s.videoWatermarkY ?? 4}
                                  unit="%"
                                  min={0}
                                  max={95}
                                  step={1}
                                  onChange={(v) => setStyle({ videoWatermarkY: v })}
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <FieldSlider
                                  label="Cỡ chữ"
                                  value={s.videoWatermarkSize ?? 28}
                                  unit="px"
                                  min={14}
                                  max={54}
                                  step={2}
                                  onChange={(v) => setStyle({ videoWatermarkSize: v })}
                                />
                                <FieldSlider
                                  label="Độ mờ"
                                  value={Math.round((s.videoWatermarkOpacity ?? 1) * 100)}
                                  unit="%"
                                  min={20}
                                  max={100}
                                  step={5}
                                  onChange={(v) => setStyle({ videoWatermarkOpacity: v / 100 })}
                                />
                              </div>

                                <Button
                                  size="small"
                                  block
                                  type="dashed"
                                  className="!text-cyan-300 !border-cyan-500/50 hover:!border-cyan-400 mt-1"
                                  onClick={() => {
                                    const wm = s.videoWatermark;
                                    const pos = s.videoWatermarkPos;
                                    const x = s.videoWatermarkX;
                                    const y = s.videoWatermarkY;
                                    const bg = s.videoWatermarkBg;
                                    const size = s.videoWatermarkSize;
                                    const opacity = s.videoWatermarkOpacity;
                                    const applyToChecked = checkedItems.length > 1;
                                    setItems((prev) =>
                                      prev.map((it) => {
                                        if (applyToChecked && !it.checked && it.id !== active?.id) return it;
                                        return {
                                          ...it,
                                          style: {
                                            ...it.style,
                                            videoWatermark: wm,
                                            videoWatermarkPos: pos,
                                            videoWatermarkX: x,
                                            videoWatermarkY: y,
                                            videoWatermarkBg: bg,
                                            videoWatermarkSize: size,
                                            videoWatermarkOpacity: opacity,
                                          },
                                        };
                                      })
                                    );
                                    message.success(
                                      applyToChecked
                                        ? `Đã gán chữ ký "${wm || 'Tắt'}" cho ${checkedItems.length} bài đã chọn!`
                                        : `Đã áp dụng chữ ký "${wm || 'Tắt'}" cho toàn bộ ${items.length} bài!`
                                    );
                                  }}
                                >
                                  🏷️ Áp dụng chữ ký này cho {checkedItems.length > 1 ? `${checkedItems.length} bài chọn` : `tất cả ${items.length} bài`}
                                </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: 'design',
                    label: (
                      <span className="flex items-center gap-1.5">
                        <span>Thiết kế & Khung</span>
                        {s.useCustomFrame && s.customFrameUrl && (
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        )}
                      </span>
                    ),
                    children: (
                      <div className="space-y-5 pb-2">
                        {/* KHUNG & LOGO KÊNH THƯƠNG HIỆU */}
                        <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-3 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                                🖼️ Khung ảnh & Logo Kênh
                              </span>
                              {s.useCustomFrame && s.customFrameUrl ? (
                                <Tag color="success" className="!mr-0 !text-xs">Đang bật</Tag>
                              ) : (
                                <Tag className="!mr-0 !text-xs text-slate-300">Tắt</Tag>
                              )}
                            </div>
                            <Switch
                              size="small"
                              checked={!!s.useCustomFrame}
                              onChange={(on) => setStyle({ useCustomFrame: on })}
                            />
                          </div>

                          <div className="space-y-2.5">
                            {/* Nút tải Frame & Logo đi kèm */}
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <div className="text-xs text-slate-300 mb-1 font-medium">1. Khung bài (PNG)</div>
                                <Upload
                                  accept="image/png,image/webp"
                                  showUploadList={false}
                                  beforeUpload={uploadCustomFrame}
                                  className="w-full"
                                >
                                  <Button
                                    block
                                    size="small"
                                    icon={<UploadOutlined />}
                                    loading={uploadingFrame}
                                    type={!s.customFrameUrl ? 'primary' : 'default'}
                                  >
                                    {s.customFrameUrl ? 'Đổi khung' : 'Tải Frame PNG'}
                                  </Button>
                                </Upload>
                              </div>

                              <div>
                                <div className="text-xs text-slate-300 mb-1 font-medium">2. Logo kênh</div>
                                <Upload
                                  accept="image/*"
                                  showUploadList={false}
                                  beforeUpload={uploadLogo}
                                  className="w-full"
                                >
                                  <Button
                                    block
                                    size="small"
                                    icon={<UploadOutlined />}
                                    loading={logoBusy}
                                  >
                                    {s.logoUrl ? 'Đổi logo' : 'Tải Logo kênh'}
                                  </Button>
                                </Upload>
                              </div>
                            </div>

                            {/* Preview nhỏ của Khung và Logo hiện tại */}
                            {(s.customFrameUrl || s.logoUrl) && (
                              <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-2.5 space-y-2.5">
                                <div className="flex items-center gap-2.5">
                                  {s.customFrameUrl && (
                                    <div className="relative shrink-0">
                                      <img
                                        src={s.customFrameUrl}
                                        alt="Frame"
                                        className="w-10 h-10 object-contain rounded bg-black/50 border border-slate-700 p-0.5"
                                        title="Khung bài hiện tại"
                                      />
                                    </div>
                                  )}
                                  {s.logoUrl && (
                                    <div className="relative shrink-0">
                                      <img
                                        src={logoSourceOf(s)}
                                        alt="Logo"
                                        className="w-10 h-10 object-contain rounded bg-black/50 border border-slate-700 p-0.5"
                                        title="Logo kênh hiện tại"
                                      />
                                    </div>
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <div className="text-xs font-semibold text-slate-200 truncate">
                                      {active.channelName || (s.useCustomFrame ? 'Đang dùng khung tuỳ chỉnh' : 'Khung đã nạp')}
                                    </div>
                                    <div className="text-xs text-slate-300 flex items-center gap-1.5 flex-wrap mt-0.5">
                                      <span className={s.logoUrl && s.showLogo ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
                                        {s.logoUrl && s.showLogo ? '✓ Logo bật' : 'Logo tắt'}
                                      </span>
                                      <span className="text-slate-600">•</span>
                                      <span className={s.useCustomFrame ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
                                        {s.useCustomFrame ? '✓ Khung bật' : 'Khung tắt'}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/60">
                                  <Popover
                                    open={saveFramePopoverOpen}
                                    onOpenChange={setSaveFramePopoverOpen}
                                    trigger="click"
                                    content={
                                      <div className="p-1 space-y-2 w-56">
                                        <div className="text-xs font-semibold text-slate-200">Lưu thành Kênh mẫu:</div>
                                        <div className="text-xs text-slate-300">Lưu trọn bộ: Khung PNG + Logo + Tone màu để sau này chọn Kênh 1 chạm.</div>
                                        <Input
                                          size="small"
                                          placeholder="VD: Vietnam Health News"
                                          value={frameNameInput}
                                          onChange={(e) => setFrameNameInput(e.target.value)}
                                          onPressEnter={saveCurrentFrameAsPreset}
                                        />
                                        <Button size="small" type="primary" block onClick={saveCurrentFrameAsPreset}>
                                          Lưu mẫu Kênh
                                        </Button>
                                      </div>
                                    }
                                  >
                                    <Button size="small" type="primary" ghost block icon={<PlusOutlined />}>Lưu Kênh</Button>
                                  </Popover>
                                  <Button size="small" block onClick={applyFrameToSelected}>Gán các bài chọn</Button>
                                </div>
                              </div>
                            )}

                            {/* Logo Quick Settings khi có logo */}
                            {s.logoUrl && (
                              <div className="pt-2 border-t border-slate-800/80 space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-slate-300">Hiển thị logo trên bài</span>
                                  <Switch size="small" checked={!!s.showLogo} onChange={(on) => setStyle({ showLogo: on })} />
                                </div>
                                {s.showLogo && (
                                  <>
                                    <CornerButtons value={s.logoPos} onPick={placeLogo} />
                                    <div className="flex justify-between text-xs text-slate-300">
                                      <span>Cỡ logo</span>
                                      <span>{s.logoSize}px</span>
                                    </div>
                                    <Slider min={100} max={480} step={10} value={s.logoSize} onChange={(v) => setStyle({ logoSize: v })} tooltip={{ open: false }} />
                                  </>
                                )}
                              </div>
                            )}

                            {/* Thư viện các kênh đã lưu */}
                            <div className="pt-2 border-t border-slate-800/80">
                              <div className="text-xs font-semibold text-slate-200 mb-2 flex items-center justify-between">
                                <span>Thư viện Kênh thương hiệu ({customFrames.length})</span>
                                <Upload
                                  accept="image/png,image/webp"
                                  showUploadList={false}
                                  beforeUpload={uploadCustomFrame}
                                >
                                  <Button size="small" type="link" className="!p-0 !text-xs !text-blue-400 font-semibold" icon={<PlusOutlined />}>
                                    Thêm Khung PNG
                                  </Button>
                                </Upload>
                              </div>
                              <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                                {/* Thẻ nút bấm nạp thêm Khung PNG nhanh */}
                                <Upload
                                  accept="image/png,image/webp"
                                  showUploadList={false}
                                  beforeUpload={uploadCustomFrame}
                                  className="w-full"
                                >
                                  <div className="rounded-lg border-2 border-dashed border-slate-700 hover:border-blue-500 bg-slate-900/40 p-2 cursor-pointer flex flex-col items-center justify-center text-center aspect-square transition-all group hover:bg-blue-500/5">
                                    <PlusOutlined className="text-xl text-slate-400 group-hover:text-blue-400 mb-1" />
                                    <span className="text-xs font-semibold text-slate-200 group-hover:text-blue-300">Nạp Khung PNG</span>
                                    <span className="text-xs text-slate-300 mt-0.5">Thêm vào thư viện</span>
                                  </div>
                                </Upload>

                                {customFrames.map((frame) => {
                                  const isCur = s.customFrameUrl === frame.url && s.useCustomFrame;
                                  return (
                                    <div
                                      key={frame.id}
                                      onClick={() => applyCustomFramePreset(frame)}
                                      className={`group relative rounded-lg border p-1.5 cursor-pointer transition-all flex flex-col justify-between ${
                                        isCur
                                          ? 'border-emerald-500 bg-emerald-500/10'
                                          : 'border-slate-800 bg-slate-900/40 hover:border-slate-600'
                                      }`}
                                    >
                                      <div className="aspect-square w-full rounded bg-black/60 flex items-center justify-center overflow-hidden mb-1 border border-slate-800/60 relative">
                                        {frame.url ? (
                                          <img
                                            src={frame.url}
                                            alt={frame.name}
                                            className="w-full h-full object-contain"
                                            loading="lazy"
                                          />
                                        ) : (
                                          <div
                                            className="w-full h-full flex flex-col items-center justify-center p-2 text-center"
                                            style={{
                                              background: frame.template === 'gradient'
                                                ? 'linear-gradient(135deg, #090d16 0%, #2a0b3f 100%)'
                                                : frame.template === 'breaking'
                                                ? '#0b0b0b'
                                                : '#1e293b'
                                            }}
                                          >
                                            <span className="text-lg mb-0.5">{frame.template === 'gradient' ? '✨' : '📰'}</span>
                                            <span className="text-[11px] font-bold text-white leading-tight truncate max-w-full px-1">
                                              {frame.template === 'gradient' ? 'Radiant' : frame.name}
                                            </span>
                                          </div>
                                        )}
                                        {frame.logoUrl && (
                                          <img
                                            src={frame.logoUrl}
                                            alt="Logo"
                                            className="absolute top-1 right-1 w-5 h-5 object-contain rounded-full bg-black/40 border border-white/20"
                                          />
                                        )}
                                      </div>
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="text-xs font-medium text-slate-200 truncate" title={frame.name}>
                                          {frame.name}
                                        </span>
                                        <Popconfirm
                                          title="Xóa mẫu kênh này?"
                                          okText="Xóa"
                                          cancelText="Hủy"
                                          onConfirm={(e) => deleteCustomFramePreset(frame.id, e as any)}
                                        >
                                          <Button
                                            size="small"
                                            type="text"
                                            danger
                                            className="!p-0 !h-4 !w-4 opacity-0 group-hover:opacity-100 transition-opacity"
                                            icon={<DeleteOutlined className="text-xs" />}
                                            onClick={(e) => e?.stopPropagation()}
                                          />
                                        </Popconfirm>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Căn chỉnh vị trí & kích thước (Vùng ảnh + Tiêu đề) */}
                            {s.useCustomFrame && s.customFrameUrl && (
                              <div className="space-y-3 pt-2 border-t border-slate-800">
                                <div className="text-xs font-semibold text-slate-200">Căn chỉnh tọa độ khung</div>
                                <div className="rounded-lg border border-slate-800 p-2.5 bg-slate-900/30 space-y-2">
                                  <div className="text-xs text-slate-300 font-medium">Vùng ảnh (Photo)</div>
                                  <FieldSlider
                                    label="Top"
                                    value={s.framePhotoTop ?? 0}
                                    unit="%"
                                    min={0}
                                    max={30}
                                    step={1}
                                    onChange={(v) => setStyle({ framePhotoTop: v })}
                                  />
                                  <FieldSlider
                                    label="Chiều cao"
                                    value={s.framePhotoHeight ?? 68}
                                    unit="%"
                                    min={40}
                                    max={95}
                                    step={1}
                                    onChange={(v) => setStyle({ framePhotoHeight: v })}
                                  />
                                </div>

                                <div className="rounded-lg border border-slate-800 p-2 bg-slate-900/30 space-y-2">
                                  <div className="text-xs text-slate-300 font-medium">Hộp tiêu đề (Headline)</div>
                                  <FieldSlider
                                    label="Cách đáy"
                                    value={s.frameTextBottom ?? 4}
                                    unit="%"
                                    min={0}
                                    max={30}
                                    step={1}
                                    onChange={(v) => setStyle({ frameTextBottom: v })}
                                  />
                                  <FieldSlider
                                    label="Chiều cao hộp"
                                    value={s.frameTextHeight ?? 24}
                                    unit="%"
                                    min={10}
                                    max={45}
                                    step={1}
                                    onChange={(v) => setStyle({ frameTextHeight: v })}
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                    <FieldSlider
                                      label="Lề trái"
                                      value={s.frameTextLeft ?? 6}
                                      unit="%"
                                      min={0}
                                      max={25}
                                      step={1}
                                      onChange={(v) => setStyle({ frameTextLeft: v })}
                                    />
                                    <FieldSlider
                                      label="Lề phải"
                                      value={s.frameTextRight ?? 6}
                                      unit="%"
                                      min={0}
                                      max={25}
                                      step={1}
                                      onChange={(v) => setStyle({ frameTextRight: v })}
                                    />
                                  </div>
                                  <div>
                                    <div className="text-xs text-slate-300 mb-1">Căn lề chữ tiêu đề</div>
                                    <Segmented
                                      block
                                      size="small"
                                      value={s.frameTextAlign || 'center'}
                                      onChange={(v) => setStyle({ frameTextAlign: v as 'left' | 'center' | 'right' })}
                                      options={[
                                        { value: 'left', label: 'Căn trái' },
                                        { value: 'center', label: 'Căn giữa' },
                                        { value: 'right', label: 'Căn phải' },
                                      ]}
                                      />
                                    </div>
                                  </div>
                                </div>
                              )}

                            {/* TỰ ĐỘNG ẨN KHUNG SAU N GIÂY (HOOK VIDEO 5S) */}
                            <div className="pt-3 border-t border-slate-800 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                                  ⏱️ Tự động ẩn khung sau vài giây (Hook Video)
                                </span>
                                {s.frameDuration ? (
                                  <Tag color="cyan" className="!mr-0 !text-xs">Ẩn sau {s.frameDuration}s</Tag>
                                ) : (
                                  <Tag className="!mr-0 !text-xs text-slate-300">Luôn hiện khung</Tag>
                                )}
                              </div>
                              <div className="text-xs text-slate-300 leading-relaxed">
                                Hiển thị khung & tiêu đề trong <b>3 - 5 giây đầu</b> để giật tít giữ chân người xem (Hook), sau đó khung sẽ <b>mờ dần và biến mất</b> để lộ trọn vẹn toàn bộ video full màn hình!
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {[
                                  { label: 'Luôn hiện khung', val: 0 },
                                  { label: 'Ẩn sau 3s', val: 3 },
                                  { label: 'Ẩn sau 5s (Chuẩn)', val: 5 },
                                  { label: 'Ẩn sau 7s', val: 7 },
                                  { label: 'Ẩn sau 10s', val: 10 },
                                ].map((opt) => (
                                  <Button
                                    key={opt.val}
                                    size="small"
                                    type={(s.frameDuration ?? 0) === opt.val ? 'primary' : 'dashed'}
                                    className="!text-xs !h-7"
                                    onClick={() => setStyle({ frameDuration: opt.val })}
                                  >
                                    {opt.label}
                                  </Button>
                                ))}
                              </div>
                              {checkedItems.length > 1 && (
                                <Button
                                  size="small"
                                  block
                                  type="dashed"
                                  className="!text-cyan-300 !border-cyan-500/50 hover:!border-cyan-400 mt-1"
                                  onClick={() => {
                                    const fd = s.frameDuration ?? 0;
                                    setItems((prev) =>
                                      prev.map((it) => {
                                        if (!it.checked && it.id !== active?.id) return it;
                                        return {
                                          ...it,
                                          style: {
                                            ...it.style,
                                            frameDuration: fd,
                                          },
                                        };
                                      })
                                    );
                                    message.success(fd > 0 ? `Đã đặt ẩn khung sau ${fd}s cho ${checkedItems.length} bài chọn!` : `Đã đặt luôn hiện khung cho ${checkedItems.length} bài chọn!`);
                                  }}
                                >
                                  Gán thiết lập ẩn khung ({s.frameDuration ? `${s.frameDuration}s` : 'Luôn hiện'}) cho {checkedItems.length} bài chọn
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Mẫu thiết kế cơ bản */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className={sectionTitle}>Mẫu thiết kế cơ bản ({TEMPLATES.length})</span>
                            <Button size="small" type="link" className="!px-0" onClick={() => setGalleryOpen(true)}>Xem lớn tất cả mẫu</Button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {TEMPLATES.map((t) => {
                              const on = normalizeTemplate(s.template) === t.value;
                              return (
                                <Tooltip key={t.value} title={t.hint} mouseEnterDelay={0.4}>
                                  <button
                                    type="button"
                                    onClick={() => setStyle({ template: t.value })}
                                    className={`p-1 rounded-lg border cursor-pointer bg-transparent text-left transition-colors ${on ? 'border-blue-500 ring-1 ring-blue-500/40' : 'border-slate-700 hover:border-slate-500'}`}
                                  >
                                    <TemplatePreview html={templatePreviews[t.value] || ''} ratio={s.ratio} />
                                    <div className={`px-1 pt-1.5 pb-0.5 text-xs font-semibold ${on ? 'text-blue-300' : 'text-slate-200'}`}>{t.label}</div>
                                  </button>
                                </Tooltip>
                              );
                            })}
                          </div>
                          {normalizeTemplate(s.template) === 'quote' && (
                            <div className="mt-2.5">
                              <div className="text-xs text-slate-300 mb-1">Tên người nói (để trống là ẩn)</div>
                              <Input
                                size="small"
                                value={s.quoteBy || ''}
                                maxLength={40}
                                onChange={(e) => setStyle({ quoteBy: e.target.value })}
                                placeholder="Ví dụ: Chủ tịch UBND tỉnh"
                              />
                            </div>
                          )}
                        </div>

                        {/* Bảng màu */}
                        <div>
                          <div className={`${sectionTitle} mb-2`}>Bảng màu</div>
                          <div className="grid grid-cols-4 gap-2">
                            {COLOR_PRESETS.map((p) => {
                              const on = s.bandBg === p.bandBg && s.textColor === p.textColor && s.accent === p.accent;
                              return (
                                <Tooltip key={p.label} title={p.label} mouseEnterDelay={0.3}>
                                  <button
                                    type="button"
                                    aria-label={p.label}
                                    onClick={() => setStyle({ bandBg: p.bandBg, textColor: p.textColor, accent: p.accent })}
                                    className={`h-10 p-0 rounded-md border cursor-pointer overflow-hidden flex flex-col ${on ? 'border-blue-500 ring-1 ring-blue-500/50' : 'border-slate-700 hover:border-slate-500'}`}
                                    style={{ background: p.bandBg }}
                                  >
                                    <span className="flex-1 w-full grid place-items-center text-xs font-black" style={{ color: p.textColor }}>Aa</span>
                                    <span className="h-1.5 w-full" style={{ background: p.accent }} />
                                  </button>
                                </Tooltip>
                              );
                            })}
                          </div>
                          <div className="grid grid-cols-3 gap-2 mt-2.5 text-xs text-slate-300">
                            <div className="flex items-center gap-1.5"><ColorPicker size="small" value={s.bandBg} onChange={(c) => setStyle({ bandBg: c.toHexString() })} />Nền</div>
                            <div className="flex items-center gap-1.5"><ColorPicker size="small" value={s.textColor} onChange={(c) => setStyle({ textColor: c.toHexString() })} />Chữ</div>
                            <div className="flex items-center gap-1.5"><ColorPicker size="small" value={s.accent} onChange={(c) => setStyle({ accent: c.toHexString() })} />Nhấn</div>
                          </div>
                        </div>

                        {/* Chân ảnh */}
                        <div className={`rounded-lg border p-3 space-y-2.5 transition-colors ${s.showFooter || s.template === 'footer' ? 'border-blue-500/50 bg-blue-500/5' : 'border-slate-800'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-200">Chân ảnh: tên page và ngày</span>
                            <Switch
                              size="small"
                              checked={s.showFooter || s.template === 'footer'}
                              onChange={(on) => setStyle({ showFooter: on, ...(s.template === 'footer' ? { template: 'classic' as const } : {}) })}
                            />
                          </div>
                          {(s.showFooter || s.template === 'footer') && (
                            <>
                              <Input
                                size="small"
                                value={s.footerText}
                                maxLength={40}
                                onChange={(e) => updateLogoEverywhere({ footerText: e.target.value })}
                                placeholder="Tên page (dùng chung mọi bài)"
                              />
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-300">Ghi ngày hôm nay</span>
                                <Switch size="small" checked={s.showDate} onChange={(on) => setStyle({ showDate: on })} />
                              </div>
                            </>
                          )}
                        </div>

                        <div>
                          <div className={`flex justify-between ${sectionTitle}`}><span>Cỡ chữ</span><span className="text-slate-500 font-normal">{Math.round(s.fontScale * 100)}%</span></div>
                          <Slider min={0.7} max={1.4} step={0.05} value={s.fontScale} onChange={(v) => setStyle({ fontScale: v })} tooltip={{ open: false }} />
                          <div className={`flex justify-between ${sectionTitle}`}><span>Dải chữ tối đa</span><span className="text-slate-500 font-normal">{Math.round(s.bandMaxRatio * 100)}% ảnh</span></div>
                          <Slider min={0.2} max={0.45} step={0.01} value={s.bandMaxRatio} onChange={(v) => setStyle({ bandMaxRatio: v })} tooltip={{ open: false }} />
                        </div>

                        {/* Mẫu kiểu */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className={sectionTitle}>Mẫu kiểu</span>
                            <Button size="small" type="link" className="!px-0" onClick={() => setPresetModalOpen(true)}>Lưu kiểu hiện tại</Button>
                          </div>
                          <Select
                            size="small"
                            className="w-full"
                            placeholder={presets.length ? 'Chọn mẫu để áp dụng cho bài này' : 'Chưa có mẫu — chỉnh xong bấm "Lưu kiểu hiện tại"'}
                            value={null}
                            onChange={(v) => v && applyPreset(v)}
                            options={presets.map((p) => ({
                              value: p.name,
                              label: (
                                <div className="flex items-center justify-between gap-2">
                                  <span className="flex items-center gap-2 min-w-0">
                                    <span className="w-3 h-3 rounded-sm shrink-0 border border-slate-600" style={{ background: p.style.bandBg }} />
                                    <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: p.style.accent }} />
                                    <span className="truncate">{p.name}</span>
                                  </span>
                                  <Popconfirm title={`Xoá mẫu "${p.name}"?`} onConfirm={(e) => { e?.stopPropagation(); deletePreset(p.name); }} onCancel={(e) => e?.stopPropagation()}>
                                    <DeleteOutlined className="text-slate-500" onClick={(e) => e.stopPropagation()} />
                                  </Popconfirm>
                                </div>
                              ),
                            }))}
                          />
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: 'overlay',
                    label: 'Chèn thêm',
                    children: (
                      <div className="space-y-3 pb-2">
                        <div className="text-xs text-slate-300">Kéo trực tiếp trên khung xem trước để di chuyển, lăn chuột trên phần đó để phóng to / thu nhỏ.</div>

                        {/* Nhãn góc */}
                        <ToolCard
                          title="Nhãn góc ảnh"
                          checked={!!active.badge}
                          onToggle={(on) => (on ? enableBadge(active.badgeSuggestion ? { text: active.badgeSuggestion, bg: s.accent, color: '#ffffff' } : BADGE_PRESETS[0]) : setBadge(null))}
                          hint="Chữ nổi bật dán lên góc ảnh, ví dụ NÓNG, LÃI 10,5%."
                        >
                          <div className="flex flex-wrap gap-1.5">
                            {active.badgeSuggestion && (
                              <button
                                type="button"
                                onClick={() => enableBadge({ text: active.badgeSuggestion!, bg: s.accent, color: '#ffffff' })}
                                className="px-2.5 py-1 rounded text-xs font-black cursor-pointer border border-dashed border-blue-500 bg-transparent text-blue-300"
                                title="AI gợi ý từ nội dung bài"
                              >
                                AI: {active.badgeSuggestion}
                              </button>
                            )}
                            {BADGE_PRESETS.map((b) => (
                              <button
                                key={b.text}
                                type="button"
                                onClick={() => enableBadge(b)}
                                className={`px-2.5 py-1 rounded text-xs font-black cursor-pointer border ${active.badge?.text === b.text ? 'border-blue-500' : 'border-transparent'}`}
                                style={{ background: b.bg, color: b.color }}
                              >
                                {b.text}
                              </button>
                            ))}
                          </div>
                          {active.badge && (
                            <>
                              <Input
                                size="small"
                                value={active.badge.text}
                                maxLength={24}
                                onChange={(e) => setBadge({ text: e.target.value.toUpperCase() })}
                                placeholder="Chữ trên nhãn"
                              />
                              <div className="grid grid-cols-3 gap-2 text-xs text-slate-300 items-center">
                                <div className="flex items-center gap-1.5">Nền <ColorPicker size="small" value={active.badge.bg} onChange={(c) => setBadge({ bg: c.toHexString() })} /></div>
                                <div className="flex items-center gap-1.5">Chữ <ColorPicker size="small" value={active.badge.color} onChange={(c) => setBadge({ color: c.toHexString() })} /></div>
                                <Segmented
                                  size="small"
                                  value={active.badge.tilt === false ? 'flat' : 'tilt'}
                                  onChange={(v) => setBadge({ tilt: v === 'tilt' })}
                                  options={[{ value: 'tilt', label: 'Nghiêng' }, { value: 'flat', label: 'Thẳng' }]}
                                />
                              </div>
                              <FieldSlider label="Cỡ nhãn" value={active.badge.size} unit="px" min={36} max={110} step={2} onChange={(v) => setBadge({ size: v })} />
                              <CornerButtons onPick={(c) => placeBadge(c)} />
                            </>
                          )}
                        </ToolCard>

                        {/* Ảnh chèn */}
                        <ToolCard
                          title="Ảnh chèn ở góc"
                          checked={!!active.inset}
                          onToggle={(on) => setInset(on ? { url: active.images.find((u) => !active.selectedImages.includes(u)) || active.images[0] } : null)}
                          hint="Thêm 1 ảnh nhỏ có viền màu, thường để phóng to một chi tiết hoặc ảnh nhân vật."
                        >
                          {active.inset && (() => {
                            const ins = active.inset;
                            const borderColor = ins.borderColor || s.accent;
                            return (
                              <>
                                <div>
                                  <div className="text-xs text-slate-300 mb-1">Chọn ảnh</div>
                                  <div className="flex gap-1.5 flex-wrap max-h-28 overflow-y-auto">
                                    {active.images.map((u) => (
                                      <button
                                        key={u}
                                        type="button"
                                        onClick={() => setInset({ url: u })}
                                        className={`w-11 h-11 rounded-md overflow-hidden border-2 p-0 cursor-pointer ${ins.url === u ? 'border-blue-500' : 'border-slate-700'}`}
                                      >
                                        <img src={u} referrerPolicy="no-referrer" alt="" className="w-full h-full object-cover" />
                                      </button>
                                    ))}
                                    <Upload accept="image/*" showUploadList={false} beforeUpload={async (f) => { const url = await uploadFile(f); if (url) { patchItem(active.id, (it) => ({ images: [...it.images, url] })); setInset({ url }); } return false; }}>
                                      <button type="button" className="w-11 h-11 rounded-md border-2 border-dashed border-slate-600 bg-transparent text-slate-400 cursor-pointer grid place-items-center" title="Tải ảnh khác lên">
                                        <UploadOutlined />
                                      </button>
                                    </Upload>
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs text-slate-300 mb-1">Hình dạng</div>
                                  <Segmented
                                    block
                                    size="small"
                                    value={ins.shape || 'circle'}
                                    onChange={(v) => setInset({ shape: v as InsetOptions['shape'] })}
                                    options={[{ value: 'circle', label: 'Tròn' }, { value: 'rounded', label: 'Bo góc' }, { value: 'square', label: 'Vuông' }]}
                                  />
                                </div>
                                <div>
                                  <div className="text-xs text-slate-300 mb-1">Màu viền</div>
                                  <div className="flex items-center gap-1.5">
                                    {[s.accent, '#ffffff', '#111111', '#ffd400'].map((c, i) => (
                                      <button
                                        key={`${c}-${i}`}
                                        type="button"
                                        onClick={() => setInset({ borderColor: i === 0 ? undefined : c })}
                                        className={`w-6 h-6 rounded-full cursor-pointer border-2 ${(i === 0 ? !ins.borderColor : ins.borderColor === c) ? 'border-blue-500' : 'border-slate-600'}`}
                                        style={{ background: c }}
                                        title={i === 0 ? 'Màu nhấn của bài' : c}
                                      />
                                    ))}
                                    <ColorPicker size="small" value={borderColor} onChange={(c) => setInset({ borderColor: c.toHexString() })} />
                                    <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-300">
                                      Đổ bóng <Switch size="small" checked={ins.shadow !== false} onChange={(on) => setInset({ shadow: on })} />
                                    </span>
                                  </div>
                                </div>
                                <FieldSlider label="Độ dày viền" value={ins.borderWidth ?? 12} unit="px" min={0} max={30} step={1} onChange={(v) => setInset({ borderWidth: v })} />
                                <FieldSlider label="Cỡ ảnh chèn" value={ins.size} unit="px" min={220} max={560} step={10} onChange={(v) => setInset({ size: v })} />
                                <FieldSlider label="Phóng to chi tiết" value={ins.zoom} unit="x" min={1} max={3} step={0.1} digits={1} onChange={(v) => setInset({ zoom: v })} />
                                {ins.zoom > 1 && (
                                  <div className="grid grid-cols-2 gap-3">
                                    <FieldSlider label="Trái ↔ phải" value={ins.x} unit="%" min={0} max={100} step={1} onChange={(v) => setInset({ x: v })} />
                                    <FieldSlider label="Trên ↕ dưới" value={ins.y} unit="%" min={0} max={100} step={1} onChange={(v) => setInset({ y: v })} />
                                  </div>
                                )}
                                <CornerButtons onPick={placeInset} />
                              </>
                            );
                          })()}
                        </ToolCard>

                        {/* Logo */}
                        <ToolCard
                          title="Logo"
                          checked={s.showLogo && !!s.logoUrl}
                          disabled={!s.logoUrl}
                          onToggle={(on) => setStyle({ showLogo: on })}
                          hint={s.logoUrl ? undefined : 'Tải logo lên một lần, dùng chung cho mọi bài.'}
                          alwaysShow
                        >
                          <div className="flex items-center gap-2">
                            {s.logoUrl && (
                              // Nền caro để thấy rõ phần đã tách nền
                              <div
                                className="w-12 h-12 rounded-md border border-slate-700 grid place-items-center overflow-hidden shrink-0"
                                style={{ background: 'repeating-conic-gradient(#3a4556 0% 25%, #2a3342 0% 50%) 50% / 12px 12px' }}
                              >
                                <img src={logoSourceOf(s)} alt="" className="max-w-full max-h-full object-contain" />
                              </div>
                            )}
                            <Upload accept="image/*" showUploadList={false} beforeUpload={uploadLogo}>
                              <Button size="small" icon={<UploadOutlined />} loading={logoBusy}>{s.logoUrl ? 'Đổi logo' : 'Tải logo lên'}</Button>
                            </Upload>
                            <span className="text-xs text-slate-300">{s.logoUrl ? 'Bật/tắt riêng từng bài' : 'PNG nền trong suốt là đẹp nhất'}</span>
                          </div>
                          {s.showLogo && s.logoUrl && (
                            <div className="mt-2 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-300">Tách nền (xoá nền trắng quanh logo)</span>
                                {s.logoNoBgUrl ? (
                                  <Switch size="small" checked={s.logoBgRemoved} onChange={(on) => updateLogoEverywhere({ logoBgRemoved: on })} />
                                ) : (
                                  <Button size="small" loading={logoBusy} onClick={removeBgFromCurrentLogo}>Tách nền</Button>
                                )}
                              </div>
                              <div>
                                <div className="text-xs text-slate-300 mb-1">Kiểu khung</div>
                                <Segmented
                                  block
                                  size="small"
                                  value={s.logoFrame}
                                  onChange={(v) => setStyle({ logoFrame: v as LogoFrame })}
                                  options={[
                                    { value: 'none', label: 'Không' },
                                    { value: 'circle', label: 'Tròn' },
                                    { value: 'rounded', label: 'Bo góc' },
                                    { value: 'pill', label: 'Viên thuốc' },
                                    { value: 'square', label: 'Vuông' },
                                  ]}
                                />
                              </div>
                              {s.logoFrame !== 'none' && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-slate-300 mr-1">Màu khung</span>
                                  {LOGO_FRAME_BG_PRESETS.map((c) => (
                                    <button
                                      key={c}
                                      type="button"
                                      onClick={() => setStyle({ logoFrameBg: c })}
                                      className={`w-6 h-6 rounded-full cursor-pointer border-2 ${s.logoFrameBg === c ? 'border-blue-500' : 'border-slate-600'}`}
                                      style={{ background: c }}
                                      title={c}
                                    />
                                  ))}
                                  <ColorPicker size="small" value={s.logoFrameBg} onChange={(c) => setStyle({ logoFrameBg: c.toRgbString() })} />
                                </div>
                              )}
                              <div>
                                <div className="text-xs text-slate-300 mb-1">Màu logo</div>
                                <Segmented
                                  block
                                  size="small"
                                  value={s.logoTint}
                                  onChange={(v) => setStyle({ logoTint: v as CardStyle['logoTint'] })}
                                  options={[
                                    { value: 'original', label: 'Màu gốc' },
                                    { value: 'white', label: 'Trắng hết' },
                                    { value: 'black', label: 'Đen hết' },
                                  ]}
                                />
                                {s.logoTint !== 'original' && !s.logoBgRemoved && s.logoFrame === 'none' && (
                                  <div className="text-xs text-amber-400 mt-1">Nên bật Tách nền, nếu không cả ô nền cũng bị đổi màu.</div>
                                )}
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-300">Đổ bóng</span>
                                <Switch size="small" checked={s.logoShadow} onChange={(on) => setStyle({ logoShadow: on })} />
                              </div>
                              <div className="flex justify-between text-xs text-slate-300"><span>Độ đậm</span><span>{Math.round(s.logoOpacity * 100)}%</span></div>
                              <Slider min={0.3} max={1} step={0.05} value={s.logoOpacity} onChange={(v) => setStyle({ logoOpacity: v })} tooltip={{ open: false }} />
                              <CornerButtons value={s.logoPos} onPick={placeLogo} />
                              <div className="flex justify-between text-xs text-slate-300"><span>Cỡ logo</span><span>{s.logoSize}px</span></div>
                              <Slider min={100} max={480} step={10} value={s.logoSize} onChange={(v) => setStyle({ logoSize: v })} tooltip={{ open: false }} />
                            </div>
                          )}
                        </ToolCard>

                        {/* Nguồn */}
                        <div className="rounded-lg border border-slate-800 p-3 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-300">Ghi "Nguồn: {sourceName(active.url)}" trên ảnh</span>
                          <Switch size="small" checked={s.showCredit} onChange={(on) => setStyle({ showCredit: on })} />
                        </div>
                      </div>
                    ),
                  },
                  ]}
                />
              </div>
              <div className="shrink-0 flex gap-2 pt-3 border-t border-slate-800">
                <Button size="small" onClick={saveDefaults}>Lưu làm mặc định</Button>
                <Button size="small" onClick={applyStyleToAll}>Áp dụng cho tất cả bài</Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Thanh dưới */}
      <div className="app-surface p-3 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">
          Đã chọn {checkedItems.length}/{items.length} bài · {items.filter((i) => i.status === 'loading').length > 0 ? `đang cào ${items.filter((i) => i.status === 'loading').length} bài` : 'đã cào xong'}
        </span>
        <div className="flex items-center gap-2">
          <Button icon={<DownloadOutlined />} disabled={checkedItems.length === 0} loading={!!batchProgress} onClick={exportChecked}>
            Xuất ảnh {checkedItems.length} bài
          </Button>
          <Button type="primary" disabled={checkedItems.length === 0} loading={!!handingOff} onClick={sendToPoster}>
            {handingOff || `Chuyển ${checkedItems.length} bài sang Đăng tự động`}
          </Button>
        </div>
      </div>

      {/* Xem lớn tất cả mẫu thiết kế */}
      <Modal
        title="Chọn mẫu thiết kế"
        open={galleryOpen && !!active && !!s}
        onCancel={() => setGalleryOpen(false)}
        footer={null}
        width={1080}
        styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}
      >
        <div className="text-xs text-slate-400 mb-3">Xem trước bằng ảnh và tiêu đề của bài đang mở. Bấm vào mẫu để áp dụng.</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {s && TEMPLATES.map((t) => {
            const on = normalizeTemplate(s.template) === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => { setStyle({ template: t.value }); setGalleryOpen(false); }}
                className={`p-1.5 rounded-xl border-2 cursor-pointer bg-transparent text-left transition-colors ${on ? 'border-blue-500' : 'border-slate-700 hover:border-slate-500'}`}
              >
                <TemplatePreview html={galleryOpen ? templatePreviews[t.value] || '' : ''} ratio={s.ratio} />
                <div className="px-1 pt-2 pb-1">
                  <div className={`text-sm font-semibold ${on ? 'text-blue-300' : 'text-slate-200'}`}>{t.label}{on ? ' · đang dùng' : ''}</div>
                  <div className="text-xs text-slate-300 leading-snug">{t.hint}</div>
                </div>
              </button>
            );
          })}
        </div>
      </Modal>

      {/* Xuất ảnh hàng loạt */}
      <Modal
        title="Xuất ảnh hàng loạt"
        open={batchOpen}
        onCancel={() => !batchProgress && setBatchOpen(false)}
        closable={!batchProgress}
        mask={{ closable: false }}
        width={760}
        footer={[
          <Button key="all" icon={<DownloadOutlined />} disabled={!!batchProgress || !batchResults.some((r) => r.url)} onClick={downloadAll}>
            Tải tất cả ({batchResults.filter((r) => r.url).length})
          </Button>,
          <Button key="done" type="primary" disabled={!!batchProgress} onClick={() => setBatchOpen(false)}>Xong</Button>,
        ]}
      >
        {batchProgress && (
          <div className="mb-4">
            <div className="text-xs text-slate-400 mb-1">
              Đang xuất ảnh {Math.min(batchProgress.done + 1, batchProgress.total)}/{batchProgress.total}...
            </div>
            <Progress percent={Math.round((batchProgress.done / batchProgress.total) * 100)} size="small" />
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto pr-1">
          {batchResults.map((r, i) => (
            <div key={r.id} className="rounded-lg border border-slate-700 overflow-hidden">
              {r.url ? (
                <img src={r.url} alt="" className="w-full aspect-square object-contain bg-slate-900" />
              ) : (
                <div className="w-full aspect-square grid place-items-center bg-slate-900 text-xs text-amber-400 p-3 text-center">
                  Bỏ qua: {r.error}
                </div>
              )}
              <div className="p-2">
                <div className="text-xs text-slate-200 line-clamp-2 leading-snug min-h-[2.6em]">{r.title}</div>
                {r.url ? (
                  <div className="flex gap-1.5 mt-1.5">
                    <Button size="small" onClick={() => window.open(r.url, '_blank')}>Mở</Button>
                    <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadImage(r.url!, fileNameOf(r.title, i))}>Tải về</Button>
                  </div>
                ) : (
                  <Button size="small" type="link" className="!px-0 mt-1" onClick={() => { setActiveId(r.id); setBatchOpen(false); }}>Mở bài để sửa</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* Cài đặt AI */}
      <Modal
        title="Cài đặt AI (Gemini) — Hỗ trợ nhiều API Keys"
        open={aiModalOpen}
        onCancel={() => setAiModalOpen(false)}
        onOk={() => {
          const k = keyDraft.trim();
          setGeminiKey(k);
          saveStoredGeminiKeys(k);
          setAiModalOpen(false);
          const count = k.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).length;
          message.success(
            count > 1
              ? `Đã lưu ${count} Gemini API keys. Hệ thống sẽ tự động xoay vòng khi 1 key hết Quota!`
              : count === 1
                ? 'Đã lưu Gemini API key'
                : 'Đã xoá key riêng, dùng key mặc định của hệ thống'
          );
        }}
        okText="Lưu"
        cancelText="Hủy"
        width={560}
      >
        <div className="space-y-3 py-2 text-xs text-slate-300">
          <div>
            Studio dùng <b>Google Gemini</b> để viết tiêu đề giật tít trên ảnh, caption hook, tóm tắt và gợi ý nhãn dán.
          </div>
          <div className="text-slate-400">
            💡 <b>Cơ chế chống nghẽn / hết hạn ngạch:</b> Bạn có thể nhập <b>nhiều API key</b> (mỗi dòng 1 key). Khi một key bị quá tải hoặc hết lượt gọi miễn phí (429 Rate Limit), hệ thống sẽ <b>tự động chuyển sang key tiếp theo</b>!
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-slate-200">Danh sách API Keys (mỗi dòng 1 key):</span>
              {(() => {
                const count = keyDraft.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).length;
                return count > 0 ? (
                  <Tag color="blue" className="!m-0">Đã nhập {count} key{count > 1 ? ' (tự xoay vòng)' : ''}</Tag>
                ) : (
                  <Tag className="!m-0 text-slate-400">Chưa nhập key riêng</Tag>
                );
              })()}
            </div>
            <TextArea
              rows={5}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder={"Dán các Gemini API key vào đây, mỗi dòng 1 key:\nAIzaSyA...\nAIzaSyB...\nAIzaSyC..."}
              autoComplete="off"
              className="font-mono text-xs"
            />
          </div>
          <div className="text-xs text-slate-300 bg-slate-800/60 p-3 rounded-lg border border-slate-700 space-y-1">
            <div>
              🔗 Lấy key hoàn toàn miễn phí tại:{' '}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-400 underline font-medium">
                aistudio.google.com/app/apikey
              </a>
            </div>
            <div>• Bạn có thể bấm "Create API key" tạo nhiều key trên cùng 1 tài khoản hoặc dùng từ nhiều tài khoản Google khác nhau.</div>
            <div>• Để trống thì hệ thống sẽ dùng key cấu hình mặc định trên máy chủ.</div>
          </div>
        </div>
      </Modal>

      {/* Lưu mẫu kiểu */}
      <Modal
        title="Lưu kiểu hiện tại thành mẫu"
        open={presetModalOpen}
        onCancel={() => setPresetModalOpen(false)}
        onOk={savePreset}
        okText="Lưu mẫu"
        cancelText="Hủy"
        okButtonProps={{ disabled: !presetName.trim() }}
      >
        <div className="space-y-2 py-2">
          <Input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onPressEnter={savePreset}
            placeholder='Ví dụ: "Tài chính - trắng đỏ có logo"'
            maxLength={60}
          />
          <div className="text-xs text-slate-300">Lưu màu, cỡ chữ, khung, cách vừa khung, logo và vị trí logo. Trùng tên sẽ ghi đè.</div>
        </div>
      </Modal>
    </div>
  );
}

function CornerButtons({ value, onPick }: { value?: Corner; onPick: (c: Corner) => void }) {
  return (
    <Segmented
      block
      size="small"
      value={value ?? (null as any)}
      onChange={(v) => onPick(v as Corner)}
      options={[
        { value: 'tl', label: '↖ Trên-T' },
        { value: 'tr', label: '↗ Trên-P' },
        { value: 'bl', label: '↙ Dưới-T' },
        { value: 'br', label: '↘ Dưới-P' },
      ]}
    />
  );
}

// Bản thu nhỏ đúng HTML sẽ xuất ảnh, để chọn mẫu thiết kế nhìn thấy kết quả thật
function TemplatePreview({ html, ratio }: { html: string; ratio: CardRatio }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const h = cardHeight(ratio);
  return (
    <div ref={ref} className="relative w-full overflow-hidden rounded-md bg-slate-900" style={{ aspectRatio: `${CARD_SIZE} / ${h}` }}>
      {w > 0 && html && (
        <iframe
          title="Xem trước mẫu"
          srcDoc={html}
          tabIndex={-1}
          style={{ width: CARD_SIZE, height: h, border: 0, transform: `scale(${w / CARD_SIZE})`, transformOrigin: 'top left', position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
        />
      )}
    </div>
  );
}

// Khung cho từng phần chèn thêm (nhãn, ảnh chèn, logo): tiêu đề + công tắc, mở ra phần chỉnh khi bật
function ToolCard({ title, checked, onToggle, disabled, hint, alwaysShow, children }: {
  title: string;
  checked: boolean;
  onToggle: (on: boolean) => void;
  disabled?: boolean;
  hint?: string;
  alwaysShow?: boolean; // hiện nội dung cả khi đang tắt (ví dụ nút tải logo lên)
  children?: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border p-3 transition-colors ${checked ? 'border-blue-500/50 bg-blue-500/5' : 'border-slate-800'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-200">{title}</span>
        <Switch size="small" checked={checked} disabled={disabled} onChange={onToggle} />
      </div>
      {hint && !checked && <div className="text-xs text-slate-300 mt-1">{hint}</div>}
      {(checked || alwaysShow) && children && <div className="mt-2.5 space-y-2.5">{children}</div>}
    </div>
  );
}

function FieldSlider({ label, value, unit, min, max, step, digits = 0, onChange }: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  digits?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-300"><span>{label}</span><span>{value.toFixed(digits)}{unit}</span></div>
      <Slider min={min} max={max} step={step} value={value} onChange={onChange} tooltip={{ open: false }} className="!my-1" />
    </div>
  );
}

// Hình minh hoạ bố cục ghép ảnh: [trái, trên, rộng, cao] theo %
const LAYOUT_SHAPES: Record<CardLayout, Array<[number, number, number, number]>> = {
  single: [[0, 0, 100, 100]],
  h2: [[0, 0, 48, 100], [52, 0, 48, 100]],
  v2: [[0, 0, 100, 48], [0, 52, 100, 48]],
  wide2: [[0, 0, 64, 100], [68, 0, 32, 100]],
  diag2: [],
  stack2: [[0, 0, 100, 100], [50, 44, 42, 46]],
  '1+2': [[0, 0, 58, 100], [62, 0, 38, 48], [62, 52, 38, 48]],
  'top1+2': [[0, 0, 100, 58], [0, 62, 48, 38], [52, 62, 48, 38]],
  h3: [[0, 0, 31, 100], [34.5, 0, 31, 100], [69, 0, 31, 100]],
  mid3: [[0, 0, 26, 100], [29, 0, 42, 100], [74, 0, 26, 100]],
  grid4: [[0, 0, 48, 48], [52, 0, 48, 48], [0, 52, 48, 48], [52, 52, 48, 48]],
  'top1+3': [[0, 0, 100, 64], [0, 68, 31, 32], [34.5, 68, 31, 32], [69, 68, 31, 32]],
  'left1+3': [[0, 0, 64, 100], [68, 0, 32, 31], [68, 34.5, 32, 31], [68, 69, 32, 31]],
};

function LayoutIcon({ layout, active }: { layout: CardLayout; active: boolean }) {
  const fill = active ? 'bg-blue-400' : 'bg-slate-500';
  return (
    <div className="relative w-11 h-9">
      {layout === 'diag2' ? (
        <>
          <div className={`absolute inset-0 rounded-[3px] ${fill}`} style={{ clipPath: 'polygon(0 0, 56% 0, 38% 100%, 0 100%)' }} />
          <div className={`absolute inset-0 rounded-[3px] ${fill}`} style={{ clipPath: 'polygon(64% 0, 100% 0, 100% 100%, 46% 100%)', opacity: 0.7 }} />
        </>
      ) : (
        LAYOUT_SHAPES[layout].map(([x, y, w, h], i) => (
          <div
            key={i}
            className={`absolute rounded-[3px] ${fill} ${layout === 'stack2' && i === 1 ? 'ring-2 ring-slate-900' : ''}`}
            style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`, opacity: i === 0 ? 1 : 0.7 }}
          />
        ))
      )}
    </div>
  );
}
