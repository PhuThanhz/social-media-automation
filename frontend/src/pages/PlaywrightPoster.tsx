import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Select,
  App,
  Typography,
  Tag,
  Checkbox,
  Table,
  Row,
  Col,
  Progress,
  Tooltip,
  Popover,
  Dropdown,
  DatePicker,
  TimePicker,
  Segmented,
  Space,
  Modal,
  Badge,
  Alert,
  Popconfirm,
  InputNumber,
  Empty,
  Divider,
  Drawer,
  Spin,
  Image,
  Radio,
  Switch,
} from 'antd';
import {
  AppstoreOutlined,
  SendOutlined,
  LinkOutlined,
  DownOutlined,
  ClockCircleOutlined,
  ClockCircleFilled,
  CheckCircleOutlined,
  CheckCircleFilled,
  CheckOutlined,
  CloseCircleOutlined,
  CloseCircleFilled,
  LoadingOutlined,
  RedoOutlined,
  InfoCircleOutlined,
  SettingOutlined,
  HistoryOutlined,
  PlusOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  CopyOutlined,
  ScheduleOutlined,
  RocketOutlined,
  MessageOutlined,
  WarningOutlined,
  StopOutlined,
  TeamOutlined,
  EyeOutlined,
  AimOutlined,
  FacebookFilled,
  SearchOutlined,
  GlobalOutlined,
  ReloadOutlined,
  BugOutlined,
  CodeOutlined,
  CalendarOutlined,
  SyncOutlined,
  EditOutlined,
  ClearOutlined,
  KeyOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  StarOutlined,
  StarFilled,
  CloseOutlined,
  HolderOutlined,
  FireOutlined,
  ThunderboltFilled,
  SafetyCertificateOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  VideoCameraOutlined,
  UploadOutlined,
  FileTextOutlined,
  SmileOutlined,
  PlusCircleOutlined,
  CloudUploadOutlined,
  LikeOutlined,
  CommentOutlined,
  ShareAltOutlined,
  EllipsisOutlined,
  BoldOutlined,
  UnorderedListOutlined,
  TagOutlined,
  EyeFilled,
  SaveOutlined,
  DisconnectOutlined,
  ZoomInOutlined,
  UserOutlined,
  DeploymentUnitOutlined,
  ApartmentOutlined,
  PieChartOutlined,
  ScissorOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import api from '../config/axios';
import { DEFAULT_FANPAGE_PLATFORM_ACCOUNT_ID } from '../config/constants';
import PasteLinkInput, { cleanSocialUrl } from '../components/common/PasteLinkInput';
import EasyTimePicker from '../components/common/EasyTimePicker';
import ColorPostPreview from '../components/common/ColorPostPreview';
import NewsCardModal, { type NewsCardSource } from '../components/modals/NewsCardModal';
import { getStoredGeminiKeys } from '../components/modals/AiSettingsModal';
import { computeViralSchedule, isGoldenHour, normalizeTargetKey } from '../utils/viralSchedule';
import PostDetailModal from '../components/modals/PostDetailModal';
import QuickUpdateCookieModal from '../components/modals/QuickUpdateCookieModal';
import PostingWindowPanel, { POSTING_WINDOW_QUERY_KEY } from '../components/common/PostingWindowPanel';

interface GroupSelectionItem {
  id: string;
  name: string;
  isPrivate?: boolean;
}

interface UserGroupMapping {
  platformAccountId: string;
  userName: string;
  userConnectionId: number;
  groups: GroupSelectionItem[];
  fallbackGroupId?: number;
}

const { Text, Paragraph } = Typography;
const { TextArea } = Input;
const { Option } = Select;

function sanitizeDuplicateCaption(text?: string): string {
  if (!text || typeof text !== 'string') return '';
  const lines = text.split('\n');
  const dedupeLines: string[] = [];
  for (const l of lines) {
    const tr = l.trim();
    if (dedupeLines.length > 0 && dedupeLines[dedupeLines.length - 1].trim() === tr && tr.length > 0) {
      continue;
    }
    dedupeLines.push(l);
  }
  const paras = dedupeLines.join('\n').split(/\n\s*\n/);
  const dedupeParas: string[] = [];
  for (const p of paras) {
    const tr = p.trim();
    if (!tr) continue;
    if (dedupeParas.length > 0 && dedupeParas[dedupeParas.length - 1].trim() === tr) {
      continue;
    }
    dedupeParas.push(tr);
  }
  return dedupeParas.join('\n\n').trim();
}

interface SocialAccount {
  id: number;
  platform: string;
  platformAccountId: string;
  pageName?: string;
  accountType?: string;
  tokenStatus?: 'OK' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNKNOWN';
  accessToken?: string;
  maxPostsPerDay?: number;
  groupHealthStatus?: 'JOINED' | 'PENDING_APPROVAL' | 'KICKED_OR_NOT_JOINED' | 'PRIVATE_NO_ACCESS' | 'UNKNOWN';
  groupHealthCheckedAt?: string;
  fallbackGroupId?: number;
  postingIdentityAccountId?: number;
}

interface PostQueue {
  id: number;
  originalUrl: string;
  title: string;
  content: string;
  mediaUrls: string;
  status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'CANCELLED';
  scheduledAt: string;
  publishedAt: string;
  errorMessage?: string;
  targetFanpageId?: string;
  targetGroupNames?: string;
  postType?: string;
  executionDurationSeconds?: number;
  affiliateLink?: string;
  enableGroupComment?: boolean;
  publishedPostUrl?: string;
  publishedGroupPostUrls?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface PendingPageBreakdownItem {
  pageName: string;
  count: number;
  percent: number;
  isAnon?: boolean;
}

interface GroupStatItem {
  publishedToday: number;
  publishedThisWeek: number;
  publishedThisMonth: number;
  pendingCount: number;
  failedCount: number;
  pendingByPage: Map<string, { count: number; isAnon?: boolean }>;
  pendingPagesList: PendingPageBreakdownItem[];
  nextScheduledAt?: string | null;
  lastScheduledAt?: string | null;
  todayFinishTimeText?: string | null;
  avgGapMinutes?: number | null;
  hourlySlots?: { hour: string; count: number }[];
  _pendingDates?: string[];
}

const EMPTY_GROUP_STAT: GroupStatItem = {
  publishedToday: 0,
  publishedThisWeek: 0,
  publishedThisMonth: 0,
  pendingCount: 0,
  failedCount: 0,
  pendingByPage: new Map(),
  pendingPagesList: [],
  nextScheduledAt: null,
  lastScheduledAt: null,
  todayFinishTimeText: null,
  avgGapMinutes: null,
  hourlySlots: [],
};

const PAGE_PALETTE = [
  { bg: 'bg-blue-500', text: 'text-blue-300', border: 'border-blue-500/40', tagColor: 'blue', fill: '#3b82f6' },
  { bg: 'bg-purple-500', text: 'text-purple-300', border: 'border-purple-500/40', tagColor: 'purple', fill: '#a855f7' },
  { bg: 'bg-emerald-500', text: 'text-emerald-300', border: 'border-emerald-500/40', tagColor: 'green', fill: '#10b981' },
  { bg: 'bg-amber-500', text: 'text-amber-300', border: 'border-amber-500/40', tagColor: 'gold', fill: '#f59e0b' },
  { bg: 'bg-rose-500', text: 'text-rose-300', border: 'border-rose-500/40', tagColor: 'volcano', fill: '#f43f5e' },
  { bg: 'bg-cyan-500', text: 'text-cyan-300', border: 'border-cyan-500/40', tagColor: 'cyan', fill: '#06b6d4' },
  { bg: 'bg-pink-500', text: 'text-pink-300', border: 'border-pink-500/40', tagColor: 'magenta', fill: '#ec4899' },
  { bg: 'bg-indigo-500', text: 'text-indigo-300', border: 'border-indigo-500/40', tagColor: 'geekblue', fill: '#6366f1' },
];

interface DiagnosticLogPayload {
  source: string;
  lines: string[];
  returned: number;
  fileSize: number;
  lastModified?: string;
}

interface DiagnosticEvidence {
  lines: string[];
  exactMatch: boolean;
  matchCount: number;
  searchToken: string;
}

interface GroupRetryProgress {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  currentGroupId?: string | null;
  currentGroupName?: string | null;
  status: 'IDLE' | 'RUNNING' | 'COMPLETE' | 'FAILED';
}

interface GroupRetrySummary {
  success: boolean;
  total: number;
  succeeded: number;
  failed: number;
  groups: Array<{
    groupId: string;
    groupName: string;
    success: boolean;
    error?: string;
    postUrl?: string;
    warning?: string;
  }>;
}

interface ActivePersonalAccount {
  userPlatformAccountId: string;
  userName: string;
  userConnectionId: number;
  fanpagePlatformAccountId: string | null;
  fanpageName: string | null;
  fanpageConnectionId: number | null;
}

interface PostTargetItem {
  targetId: number;
  socialAccountId: number;
  platformAccountId?: string;
  platform: string;
  accountName: string;
  date: string;
  targetCount: number;
  actualCount: number;
  pendingCount?: number;
  totalPending?: number;
  achieved: boolean;
}

interface PostLinkItem {
  id: string;
  url: string;
  inputType?: 'LINK' | 'MANUAL';
  manualContent?: string;
  manualMediaUrls?: string[];
  manualMediaKinds?: ('image' | 'video')[];
  isNow: boolean;
  scheduledAt: Dayjs;
  affiliateLink?: string;
  showCommentBox?: boolean;
  includeCredit?: boolean;
  skipComment?: boolean;
  groupCommentEnabled?: boolean;
  customCaption?: string;
  colorBackground?: boolean | 'RED_PHOTO_TRICK';
}

type PostMode = 'FANPAGE_ONLY' | 'FANPAGE_AND_GROUP' | 'GROUP_ONLY';

const describeMedia = (mediaUrls?: string) => {
  const urls = (mediaUrls || '').split(',').map((url) => url.trim()).filter(Boolean);
  if (urls.length === 0) return { label: 'Bài viết chữ (Text)', color: 'default' };
  const videos = urls.filter((url) => /\.mp4|\.mov|\.webm|\/video\/|\/v\/t16\/|\/m84\/|\/m86\/|\/o1\/v\/|video/i.test(url)).length;
  const photos = urls.length - videos;
  if (videos > 0 && photos > 0) return { label: `${videos} video + ${photos} ảnh`, color: 'geekblue' };
  if (videos > 0) return { label: videos > 1 ? `${videos} video` : 'Video', color: 'purple' };
  if (photos > 1) return { label: `Album ${photos} ảnh`, color: 'blue' };
  return { label: 'Hình ảnh', color: 'blue' };
};

const stripEmojiPrefix = (name?: string) =>
  (name || '').replace(/^[^\p{L}\p{N}@]+/gu, '').trim();

const DEFAULT_SAVED_COMMENT = `🐱 Mời mọi người ghé “Nhà Mèo Mồ Côi” một chút nha! 🐾💗
Mọi người có thể ghé link xem thử, không mua cũng không sao đâu ạ 🥰 Chỉ cần mỗi lượt ghé thăm, và nếu có phát sinh đơn hàng thì một phần nhỏ cũng sẽ góp thêm vào việc chăm sóc các bé mèo hoang, mèo mồ côi 🐈⬛🏠
👉 https://s.shopee.vn/9fLALT7wfw
Cảm ơn mọi người đã dành chút yêu thương cho các em 🥹🐾💗`;

const STORAGE_KEY_COMMENT = 'autopost_default_affiliate_comment';
const collectDiagnosticEvidence = (post: PostQueue | null, lines: string[]): DiagnosticEvidence => {
  if (!post || lines.length === 0) return { lines: [], exactMatch: false, matchCount: 0, searchToken: '' };

  const cleanUrl = post.originalUrl ? cleanSocialUrl(post.originalUrl) : '';
  const urlToken = cleanUrl.split('/').filter(Boolean).pop() || '';
  const strongTokens = [post.originalUrl, cleanUrl, urlToken.length >= 6 ? urlToken : '']
    .filter(Boolean)
    .map((value) => value.toLocaleLowerCase('vi'));
  const idTokens = [`#${post.id}`, `queue #${post.id}`, `queue/${post.id}`, `postid=${post.id}`, `postid: ${post.id}`];
  const tokens = [...strongTokens, ...idTokens];
  const matchedIndexes = lines.reduce<number[]>((indexes, line, index) => {
    const normalized = line.toLocaleLowerCase('vi');
    if (tokens.some((token) => normalized.includes(token))) indexes.push(index);
    return indexes;
  }, []);

  if (matchedIndexes.length > 0) {
    const indexes = new Set<number>();
    matchedIndexes.forEach((matchIndex) => {
      for (let index = Math.max(0, matchIndex - 14); index <= Math.min(lines.length - 1, matchIndex + 28); index++) indexes.add(index);
    });
    return {
      lines: Array.from(indexes).sort((a, b) => a - b).map((index) => lines[index]),
      exactMatch: true,
      matchCount: matchedIndexes.length,
      searchToken: urlToken || `#${post.id}`,
    };
  }

  const importantLines = lines.filter((line) => /(error|fatal|exception|failed|thất bại|cảnh báo|warn|❌|⚠️)/i.test(line));
  return {
    lines: importantLines.slice(-100),
    exactMatch: false,
    matchCount: 0,
    searchToken: urlToken || `#${post.id}`,
  };
};

const LiveElapsedTimer: React.FC<{ startTime?: string }> = ({ startTime }) => {
  const [elapsed, setElapsed] = useState<number>(() => {
    if (!startTime) return 0;
    const diff = dayjs().diff(dayjs(startTime), 'second');
    return Math.max(0, diff);
  });

  useEffect(() => {
    const update = () => {
      if (!startTime) return;
      const diff = dayjs().diff(dayjs(startTime), 'second');
      setElapsed(Math.max(0, diff));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const formatted = mins > 0 ? `${mins}m ${secs < 10 ? '0' : ''}${secs}s` : `${secs}s`;

  return <span>{formatted}</span>;
};

const EstimatedPostProgress: React.FC<{
  startTime?: string;
  hasVideo?: boolean;
  hasAffiliate?: boolean;
}> = ({ startTime, hasVideo = true, hasAffiliate = false }) => {
  const [elapsed, setElapsed] = useState<number>(() => {
    if (!startTime) return 0;
    const diff = dayjs().diff(dayjs(startTime), 'second');
    return Math.max(0, diff);
  });

  useEffect(() => {
    const update = () => {
      if (!startTime) return;
      const diff = dayjs().diff(dayjs(startTime), 'second');
      setElapsed(Math.max(0, diff));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  // Thời gian ước tính trung bình: video + upload ~50s, có comment link ~65s, ảnh ~35s
  const estimatedTotalSec = hasVideo ? (hasAffiliate ? 65 : 50) : 35;
  const remainingSec = Math.max(0, estimatedTotalSec - elapsed);
  const percent = Math.min(96, Math.max(8, Math.round((elapsed / estimatedTotalSec) * 100)));

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const formattedElapsed = mins > 0 ? `${mins}m ${secs < 10 ? '0' : ''}${secs}s` : `${secs}s`;

  const isFinishing = remainingSec <= 0;

  return (
    <div className="flex flex-col gap-1.5 w-full max-w-[160px] bg-gradient-to-b from-slate-900/95 to-slate-950/95 p-2.5 rounded-xl border border-purple-500/30 shadow-md shadow-purple-950/20 mt-1.5 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1.5 text-[10px] font-bold text-purple-300 uppercase tracking-wider font-mono">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
          </span>
          Đang chạy
        </span>
        <span className="text-[10px] text-slate-500 font-mono font-medium">~{estimatedTotalSec}s</span>
      </div>

      <div className="flex items-baseline justify-between">
        <span className="text-sm font-extrabold text-white font-mono tracking-tight">{formattedElapsed}</span>
        <span className="text-[10px] font-mono text-purple-300/90 font-semibold">{percent}%</span>
      </div>

      <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800 p-[0.5px]">
        <div
          className="bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-400 h-full rounded-full transition-all duration-700 ease-out shadow-xs"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="pt-0.5 flex items-center justify-between text-[10px]">
        <span className="text-slate-400 text-[10px]">Ước tính:</span>
        {isFinishing ? (
          <span className="font-bold text-emerald-300 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Hoàn tất... 🚀
          </span>
        ) : (
          <span className="font-semibold text-slate-200 font-mono">Còn ~{remainingSec}s</span>
        )}
      </div>
    </div>
  );
};

// --- TIỆN ÍCH LÀM SẠCH DẤU SAO / HOA THỊ MARKDOWN (**) VÌ FACEBOOK KHÔNG HỖ TRỢ ---
export const cleanMarkdownAsterisks = (text: string | null | undefined): string => {
  if (!text) return '';
  return text
    .replace(/\*{2,}/g, '')
    .replace(/(^|[^\*])\*([^\*\r\n]+)\*([^\*]|$)/g, '$1$2$3')
    .replace(/^[ \t]*\*+[ \t]*/gm, '')
    .replace(/[ \t]*\*+[ \t]*$/gm, '')
    .trim();
};

const PlaywrightPoster = () => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [diagnosingPost, setDiagnosingPost] = useState<PostQueue | null>(null);
  const [detailPost, setDetailPost] = useState<PostQueue | null>(null);

  // Worker phân biệt rõ 3 loại lỗi cào (xem worker/server.js: accessIssue) — hiện toast đúng loại
  // thay vì luôn "Có lỗi xảy ra" chung chung, để người dùng biết cần làm gì tiếp theo.
  // Backend bỏ qua bài trùng (cùng ID bài gốc đã có trong Lịch đăng cho cùng nhóm) — liệt kê cho người dùng biết
  const notifySkippedDuplicates = (data: any) => {
    const skipped: Array<{ index: number; url: string; groups: string[] }> = Array.isArray(data?.skippedDuplicates) ? data.skippedDuplicates : [];
    if (skipped.length === 0) return;
    Modal.warning({
      title: `Đã bỏ qua ${skipped.length} bài trùng`,
      width: 640,
      content: (
        <div className="space-y-2">
          <div className="text-xs text-slate-400">
            Các bài này đã có trong Lịch đăng (đang chờ, đang đăng hoặc đã đăng) cho cùng nhóm nên không được thêm lại.
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1.5">
            {skipped.map((s, idx) => (
              <div key={`${s.url}-${idx}`} className="text-xs border border-slate-700/60 rounded-lg px-2.5 py-1.5">
                <a href={s.url} target="_blank" rel="noreferrer" className="break-all">{s.url}</a>
                <div className="text-slate-400 mt-0.5">Nhóm: {(s.groups || []).join(', ')}</div>
              </div>
            ))}
          </div>
        </div>
      ),
    });
  };

  const showScrapeErrorToast = (err: any) => {
    const raw: string = err?.response?.data?.message || err?.message || 'Có lỗi xảy ra khi đăng bài!';
    if (raw.includes('cần đăng nhập lại')) {
      message.warning(`🔒 ${raw} — vào mục Fanpage để cập nhật lại Cookie/Token.`, 8);
    } else if (raw.includes('đã bị xóa') || raw.includes('riêng tư') || raw.includes('không còn tồn tại')) {
      message.warning(`⚠️ ${raw}`, 8);
    } else {
      message.error(raw, 6);
    }
  };

  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStatusMsg, setProgressStatusMsg] = useState<string>('');
  const [isPosting, setIsPosting] = useState(false);
  const [postMode, setPostMode] = useState<PostMode>('FANPAGE_ONLY');
  const [forceRefresh, setForceRefresh] = useState(false);
  // Khoảng cách thời gian giãn cách giữa các nhóm khi đăng bài vào nhiều nhóm cùng lúc (phút)
  const [groupStaggerInterval, setGroupStaggerInterval] = useState<number>(2);

  // Xem trước ảnh/video cào được TRƯỚC khi đăng — key theo id của từng dòng link trong danh sách.
  const [previews, setPreviews] = useState<Record<string, {
    loading: boolean;
    error?: string;
    caption?: string;
    author?: string;
    mediaUrls?: string[];
    mediaKinds?: Array<'video' | 'image'>;
    originalMediaUrls?: string[];
    originalMediaKinds?: Array<'video' | 'image'>;
    videoCount?: number;
    imageCount?: number;
    watermarkRemoved?: boolean;
  }>>({});

  // Bộ nhớ đệm preview ảnh/video trực tiếp ngay trong Drawer dán nhiều link và cào Group Hunter
  const [bulkDrawerPreviews, setBulkDrawerPreviews] = useState<Record<string, {
    loading: boolean;
    error?: string;
    caption?: string;
    author?: string;
    mediaUrls?: string[];
    mediaKinds?: Array<'video' | 'image'>;
    originalMediaUrls?: string[];
    originalMediaKinds?: Array<'video' | 'image'>;
    videoCount?: number;
    imageCount?: number;
    affiliateComment?: string;
    skipComment?: boolean;
    includeCredit?: boolean;
    watermarkRemoved?: boolean;
  }>>({});

  // Lưu trữ giờ hẹn tuỳ chỉnh riêng cho từng link trong Drawer nếu người dùng tự chỉnh
  const [customDrawerScheduledTimes, setCustomDrawerScheduledTimes] = useState<Record<string, Dayjs>>({});

  // Ảnh tin tức (ảnh + tiêu đề in hoa tô đỏ) cho 1 bài trong danh sách
  const [newsCardTarget, setNewsCardTarget] = useState<{ itemId: string; mode: 'LINK' | 'MANUAL'; source: NewsCardSource } | null>(null);

  const openNewsCardForItem = (item: PostLinkItem, mode: 'LINK' | 'MANUAL') => {
    const text = mode === 'MANUAL'
      ? (item.manualContent || '')
      : (item.customCaption !== undefined ? item.customCaption : (previews[item.id]?.caption || ''));
    const urls = mode === 'MANUAL' ? (item.manualMediaUrls || []) : (previews[item.id]?.mediaUrls || []);
    const kinds = mode === 'MANUAL' ? item.manualMediaKinds : previews[item.id]?.mediaKinds;
    const images = urls.filter((u, i) => !isMediaVideo(u, kinds?.[i]));
    setNewsCardTarget({
      itemId: item.id,
      mode,
      source: { title: text.split(/\n/)[0]?.slice(0, 200), content: text, imageUrl: images[0], images },
    });
  };

  const applyNewsCardToItem = (cardUrl: string) => {
    if (!newsCardTarget) return;
    const { itemId, mode } = newsCardTarget;
    if (mode === 'MANUAL') {
      setLinkItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, manualMediaUrls: [cardUrl], manualMediaKinds: ['image'] } : it)));
    } else {
      // Giữ originalMediaUrls để nút khôi phục media gốc vẫn dùng được
      setPreviews((prev) => {
        const cur = prev[itemId];
        if (!cur) return prev;
        return { ...prev, [itemId]: { ...cur, mediaUrls: [cardUrl], mediaKinds: ['image'], imageCount: 1, videoCount: 0 } };
      });
    }
    setNewsCardTarget(null);
  };

  const isMediaVideo = (url: string, kind?: string) =>
    kind === 'video' || /\.mp4|\.mov|\.webm|\/video\/|\/v\/t16\/|\/m84\/|\/m86\/|\/o1\/v\//i.test(url);

  // State quản lý Cre Custom (Gán dòng Cre tùy chỉnh hàng loạt hoặc đơn lẻ)
  const [isCustomCreModalOpen, setIsCustomCreModalOpen] = useState(false);
  const [customCreInput, setCustomCreInput] = useState('');
  const [customCreTargetItemId, setCustomCreTargetItemId] = useState<string | null>(null);

  // State quản lý Hashtag Hàng Loạt (Gán Hashtag hàng loạt hoặc đơn lẻ)
  const [isHashtagModalOpen, setIsHashtagModalOpen] = useState(false);
  const [hashtagInput, setHashtagInput] = useState('');
  const [hashtagTargetItemId, setHashtagTargetItemId] = useState<string | null>(null);

  // State quản lý 1-Click Chia Đều Tỉ Lệ Page cho danh sách bài viết
  const [distributeModalOpen, setDistributeModalOpen] = useState(false);
  const [selectedDistributePages, setSelectedDistributePages] = useState<string[]>([]);

  // State phục vụ kéo thả (Drag & Drop) ảnh/video
  const [draggedMedia, setDraggedMedia] = useState<{ itemId: string; index: number } | null>(null);
  const [dragOverMedia, setDragOverMedia] = useState<{ itemId: string; index: number } | null>(null);
  const [mediaViewer, setMediaViewer] = useState<{ url: string; kind: 'image' | 'video'; title?: string } | null>(null);

  const handleMediaDragStart = (e: React.DragEvent, itemId: string, index: number) => {
    try {
      e.dataTransfer.setData('text/plain', `${itemId}:${index}`);
      e.dataTransfer.effectAllowed = 'move';
    } catch {
      // Ignore
    }
    setDraggedMedia({ itemId, index });
  };

  const handleMediaDragOver = (e: React.DragEvent, itemId: string, index: number) => {
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = 'move';
    } catch {
      // Ignore
    }
    if (!dragOverMedia || dragOverMedia.itemId !== itemId || dragOverMedia.index !== index) {
      setDragOverMedia({ itemId, index });
    }
  };

  const handleMediaDragEnd = () => {
    setDraggedMedia(null);
    setDragOverMedia(null);
  };

  const handleMediaDrop = (e: React.DragEvent, itemId: string, dropIndex: number) => {
    e.preventDefault();
    let dragIndex = draggedMedia?.index;
    if (dragIndex === undefined) {
      try {
        const rawData = e.dataTransfer.getData('text/plain');
        if (rawData) {
          const [dragItemId, dragIndexStr] = rawData.split(':');
          if (dragItemId === itemId) {
            dragIndex = parseInt(dragIndexStr, 10);
          }
        }
      } catch {
        // Ignore
      }
    }

    if (dragIndex !== undefined && !isNaN(dragIndex) && dragIndex !== dropIndex) {
      moveMediaItem(itemId, dragIndex, dropIndex);
    }
    setDraggedMedia(null);
    setDragOverMedia(null);
  };

  const moveMediaItem = (itemId: string, fromIdx: number, toIdx: number) => {
    setPreviews((prev) => {
      const cur = prev[itemId];
      if (!cur || !cur.mediaUrls) return prev;
      if (toIdx < 0 || toIdx >= cur.mediaUrls.length) return prev;
      const newUrls = [...cur.mediaUrls];
      const newKinds = cur.mediaKinds ? [...cur.mediaKinds] : [];
      const [itemUrl] = newUrls.splice(fromIdx, 1);
      newUrls.splice(toIdx, 0, itemUrl);
      if (newKinds.length > 0) {
        const [itemKind] = newKinds.splice(fromIdx, 1);
        newKinds.splice(toIdx, 0, itemKind);
      }
      message.success(`Đã chuyển media sang vị trí #${toIdx + 1}`);
      return {
        ...prev,
        [itemId]: {
          ...cur,
          mediaUrls: newUrls,
          mediaKinds: newKinds,
        },
      };
    });
  };

  const removeMediaItem = (itemId: string, idxToRemove: number) => {
    setPreviews((prev) => {
      const cur = prev[itemId];
      if (!cur || !cur.mediaUrls) return prev;
      const newUrls = cur.mediaUrls.filter((_, idx) => idx !== idxToRemove);
      const newKinds = cur.mediaKinds?.filter((_, idx) => idx !== idxToRemove);
      const videoCount = newUrls.filter((u, i) => isMediaVideo(u, newKinds?.[i])).length;
      const imageCount = newUrls.length - videoCount;
      message.info('Đã xóa bớt 1 ảnh/video khỏi danh sách đăng');
      return {
        ...prev,
        [itemId]: {
          ...cur,
          mediaUrls: newUrls,
          mediaKinds: newKinds,
          videoCount,
          imageCount,
        },
      };
    });
  };

  const resetMediaItems = (itemId: string) => {
    setPreviews((prev) => {
      const cur = prev[itemId];
      if (!cur || !cur.originalMediaUrls) return prev;
      const videoCount = cur.originalMediaUrls.filter((u, i) => isMediaVideo(u, cur.originalMediaKinds?.[i])).length;
      const imageCount = cur.originalMediaUrls.length - videoCount;
      message.success('Đã khôi phục lại toàn bộ ảnh/video gốc');
      return {
        ...prev,
        [itemId]: {
          ...cur,
          mediaUrls: [...cur.originalMediaUrls],
          mediaKinds: cur.originalMediaKinds ? [...cur.originalMediaKinds] : [],
          videoCount,
          imageCount,
        },
      };
    });
  };

  const formatMultiLineCaption = (text: string): string => {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text.trim();

    cleaned = cleaned
      // Xoá triệt để mọi biến thể ".... Xem thêm" hoặc "... Xem thêm Ẩn bớt" ở cuối chuỗi với số lượng chấm bất kỳ (2, 3, 4, 5+ chấm)
      .replace(/[\s\u200B\u00A0]*(?:…|\.{2,})?[\s\u200B\u00A0]*(?:Xem\s+thêm|See\s+more|Hiển\s+thị\s+thêm)[\s\u200B\u00A0]*(?:Ẩn\s+bớt|See\s+less|Thu\s+gọn)?[\s\u200B\u00A0]*$/gi, '')
      .replace(/[\s\u200B\u00A0]*(?:Ẩn\s+bớt|See\s+less|Thu\s+gọn)[\s\u200B\u00A0]*$/gi, '')
      .replace(/(?:^|\n)[\s\u200B\u00A0]*(?:Xem\s+thêm|See\s+more|Hiển\s+thị\s+thêm|Ẩn\s+bớt|See\s+less|Thu\s+gọn)[\s\u200B\u00A0]*$/gim, '')
      .replace(/[\s\u200B\u00A0]*(?:…|\.{2,})[\s\u200B\u00A0]*(?:Xem\s+thêm|See\s+more)\b/gi, '')
      .replace(/\n?(?:Translate|Dịch)\s*$/gi, '')
      .trim();

    cleaned = cleaned.replace(/([^\n])\s*(?:[:;])\s+([-\u2013\u2014•*+~🔹🔸▪️▫️✔️✅👉🔥⭐🌟✓]\s+[A-ZÀ-Ỹ0-9])/gu, '$1:\n\n$2');
    cleaned = cleaned.replace(/([.\?!:;]\s*)\s+([-\u2013\u2014•*+~🔹🔸▪️▫️✔️✅👉🔥⭐🌟✓]\s+[A-ZÀ-Ỹ0-9])/gu, '$1\n\n$2');
    cleaned = cleaned.replace(/([^\n\d])\s+([•*+~🔹🔸▪️▫️✔️✅👉🔥⭐🌟✓]\s+[A-ZÀ-Ỹ0-9])/gu, '$1\n\n$2');
    cleaned = cleaned.replace(/([.\?!:;]\s*)(\b\d{1,2}[\.\)]\s+[A-ZÀ-Ỹ])/gu, '$1\n\n$2');
    cleaned = cleaned.replace(/([^\n\s])\s+(?<![\p{L}\p{N}])(Cre|Credit|Nguồn|Ảnh|Photo|Video|Via|Theo)\s*[:\-\u2013\u2014]\s*/gui, '$1\n\n$2: ');
    cleaned = cleaned.replace(/([^\n\s])\s+(?<![\p{L}\p{N}])(Cre|Credit)\s+([A-ZÀ-Ỹ0-9@#])/gu, '$1\n\n$2 $3');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    return cleaned.trim();
  };

  // Phát hiện thông báo lỗi phân quyền riêng tư từ Facebook để tránh ghi đè caption hợp lệ
  const isFbRestrictionError = (text?: string): boolean => {
    if (!text) return false;
    const t = text.toLowerCase();
    return (
      t.includes('chủ sở hữu chỉ chia sẻ nội dung') ||
      t.includes('thay đổi người được xem hoặc đã xóa nội dung') ||
      t.includes("this content isn't available") ||
      t.includes('this content is not available') ||
      t.includes('nội dung này hiện không khả dụng') ||
      t.includes('đăng nhập facebook') ||
      t.includes('log in to facebook')
    );
  };

  const handlePreviewLink = async (item: PostLinkItem) => {
    if (!item.url.trim()) return;
    const trimmedUrl = item.url.trim();

    // 1. Kiểm tra cache bulkDrawerPreviews trước: nếu đã có dữ liệu từ trước hoặc từ Group Hunter, DÙNG LUÔN KHÔNG CÀO LẠI
    const cached = bulkDrawerPreviews[trimmedUrl];
    if (cached && !cached.loading && (cached.caption || (cached.mediaUrls && cached.mediaUrls.length > 0) || cached.watermarkRemoved)) {
      setPreviews((prev) => ({
        ...prev,
        [item.id]: {
          loading: false,
          caption: cached.caption || item.customCaption || '',
          author: cached.author || '',
          mediaUrls: cached.mediaUrls || [],
          mediaKinds: cached.mediaKinds || [],
          originalMediaUrls: cached.originalMediaUrls || cached.mediaUrls || [],
          originalMediaKinds: cached.originalMediaKinds || cached.mediaKinds || [],
          videoCount: cached.videoCount || 0,
          imageCount: cached.imageCount || 0,
          watermarkRemoved: cached.watermarkRemoved,
        },
      }));
      if (cached.caption && (!item.customCaption || item.customCaption.trim() === '')) {
        setLinkItems((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, customCaption: cached.caption } : it))
        );
      }
      return;
    }

    setPreviews((prev) => ({ ...prev, [item.id]: { loading: true } }));
    try {
      const res = await api.post('/queue/preview-url', { url: trimmedUrl });
      if (res.data?.success && res.data?.item) {
        const rawFetched = res.data.item.content || res.data.item.title || '';

        // 2. Bảo vệ: Nếu Facebook trả về thông báo lỗi giới hạn riêng tư (nhóm kín/chưa có cookie), BỎ QUA không ghi đè caption
        if (isFbRestrictionError(rawFetched)) {
          setPreviews((prev) => {
            const existing = prev[item.id];
            return {
              ...prev,
              [item.id]: {
                loading: false,
                caption: existing?.caption || item.customCaption || '',
                author: existing?.author || '',
                mediaUrls: existing?.mediaUrls || [],
                mediaKinds: existing?.mediaKinds || [],
                originalMediaUrls: existing?.originalMediaUrls || existing?.mediaUrls || [],
                originalMediaKinds: existing?.originalMediaKinds || existing?.mediaKinds || [],
                videoCount: existing?.videoCount || 0,
                imageCount: existing?.imageCount || 0,
                error: 'Bài viết Facebook giới hạn quyền xem (nhóm kín hoặc cần cookie)',
              },
            };
          });
          return;
        }

        const fetchedCaption = formatMultiLineCaption(rawFetched);
        const urls = (res.data.item.mediaUrls || []) as string[];
        const kinds = (res.data.item.mediaKinds || []) as Array<'video' | 'image'>;
        const threadsAuthorMatch = item.url.match(/threads\.(?:net|com)\/@([^/?#]+)/i);
        const fetchedAuthor = res.data.item.author || (threadsAuthorMatch ? `@${threadsAuthorMatch[1]}` : '');
        setPreviews((prev) => ({
          ...prev,
          [item.id]: {
            loading: false,
            caption: fetchedCaption,
            author: fetchedAuthor,
            mediaUrls: urls,
            mediaKinds: kinds,
            originalMediaUrls: [...urls],
            originalMediaKinds: [...kinds],
            videoCount: Number(res.data.item.videoCount || 0),
            imageCount: Number(res.data.item.imageCount || 0),
            watermarkRemoved: Boolean(res.data.item.watermarkRemoved),
          },
        }));
        // Tự động điền vào ô chỉnh sửa Caption nếu người dùng chưa tự nhập
        setLinkItems((prev) =>
          prev.map((it) =>
            it.id === item.id && (it.customCaption === undefined || it.customCaption === '')
              ? { ...it, customCaption: fetchedCaption }
              : it
          )
        );
      } else {
        setPreviews((prev) => ({ ...prev, [item.id]: { loading: false, error: res.data?.message || 'Không cào được nội dung' } }));
      }
    } catch (err: any) {
      setPreviews((prev) => ({ ...prev, [item.id]: { loading: false, error: err?.response?.data?.message || err?.message || 'Lỗi khi xem trước' } }));
    }
  };

  // Danh sách từng bài viết kèm chế độ Đăng ngay / Hẹn giờ riêng
  const [linkItems, setLinkItems] = useState<PostLinkItem[]>([
    { id: '1', url: '', isNow: true, scheduledAt: dayjs().add(5, 'minute'), includeCredit: true }
  ]);
  const [manualMediaUrlInputs, setManualMediaUrlInputs] = useState<Record<string, string>>({});
  const [swipeReviewOpen, setSwipeReviewOpen] = useState(false);
  const [swipeReviewIndex, setSwipeReviewIndex] = useState(0);
  const [swipeMediaIndex, setSwipeMediaIndex] = useState(0);
  const [swipeDecisions, setSwipeDecisions] = useState<Record<string, 'KEEP' | 'REJECT'>>({});

  // Article Scraper Batch Modal State in PlaywrightPoster
  interface ScrapedNewsPreviewItem {
    url: string;
    title: string;
    coverImage?: string;
    sapo?: string;
    source?: string;
    publishedTime?: string;
    selected: boolean;
    // true khi bài này đã từng được nạp thành công vào form Đăng tự động ở 1 lượt "Cào & Nạp" trước
    // đó trong phiên làm việc hiện tại — giúp người dùng nhận biết bài nào đã lấy, bài nào chưa khi
    // danh sách được cào thêm liên tục (cộng dồn) qua nhiều lượt quét.
    imported?: boolean;
  }

  interface CustomNewsChannel {
    id: string;
    category: 'bds' | 'tech' | 'finance' | 'health' | 'pickleball' | 'lifestyle' | 'other';
    name: string;
    url: string;
    type: 'category' | 'rss';
  }

  const DEFAULT_CUSTOM_CHANNELS: CustomNewsChannel[] = [
    // 🏓 1. Pickleball (Thể thao xu hướng & Khai thác Group FB)
    { id: 'def_pickle_rss_1', category: 'pickleball', name: '🌐 Google News Pickleball 24h', url: 'https://news.google.com/rss/search?q=pickleball+vi%E1%BB%87t+nam+when:7d&hl=vi&gl=VN&ceid=VN:vi', type: 'rss' },
    { id: 'def_pickle_rss_tourn', category: 'pickleball', name: '🏆 Google News Giải Đấu & Ngôi Sao', url: 'https://news.google.com/rss/search?q=gi%E1%BA%A3i+pickleball+OR+quang+d%C6%B0%C6%A1ng+when:7d&hl=vi&gl=VN&ceid=VN:vi', type: 'rss' },
    { id: 'def_pickle_rss_gear', category: 'pickleball', name: '🏸 Google News Review Vợt & Dụng Cụ', url: 'https://news.google.com/rss/search?q=v%E1%BB%A3t+pickleball+OR+s%C3%A2n+pickleball&hl=vi&gl=VN&ceid=VN:vi', type: 'rss' },
    { id: 'def_pickle_rss_drama', category: 'pickleball', name: '🔥 Google News Drama & Văn Hóa Sân', url: 'https://news.google.com/rss/search?q=trang+ph%E1%BB%A5c+pickleball+OR+v%C4%83n+h%C3%B3a+pickleball&hl=vi&gl=VN&ceid=VN:vi', type: 'rss' },
    { id: 'def_pickle_rss_dink', category: 'pickleball', name: '🇺🇸 The Dink Mẹo & Kỹ Thuật RSS', url: 'https://thedinkpickleball.com/feed/', type: 'rss' },
    { id: 'def_pickle_rss_kitchen', category: 'pickleball', name: '🌍 The Kitchen Tin Pickleball Quốc Tế RSS', url: 'https://thekitchenpickleball.com/feed/', type: 'rss' },
    { id: 'def_pickle_1', category: 'pickleball', name: '🎾 Tuổi Trẻ Pickleball', url: 'https://tuoitre.vn/pickleball-viet-nam.html', type: 'category' },
    { id: 'def_pickle_2', category: 'pickleball', name: '🏸 Dân Trí Pickleball', url: 'https://dantri.com.vn/the-thao/pickleball.htm', type: 'category' },
    { id: 'def_pickle_3', category: 'pickleball', name: '📰 Thanh Niên Pickleball', url: 'https://thanhnien.vn/pickleball-viet-nam-tags1222606.html', type: 'category' },
    { id: 'def_pickle_4', category: 'pickleball', name: '🏓 Webthethao Pickleball', url: 'https://webthethao.vn/pickleball.htm', type: 'category' },
    { id: 'def_pickle_5', category: 'pickleball', name: '⚽ BongdaPlus Hậu Trường & Pickleball', url: 'https://bongdaplus.vn/hau-truong-the-thao.html', type: 'category' },
    { id: 'def_pickle_6', category: 'pickleball', name: '⚡ Kênh 14 Thể Thao & Phong Cách Pickleball', url: 'https://kenh14.vn/sport.chn', type: 'category' },
    { id: 'def_pickle_rss_2', category: 'pickleball', name: '🏃 VnExpress Thể Thao RSS', url: 'https://vnexpress.net/rss/the-thao.rss', type: 'rss' },

    // 📈 2. Tài Chính & Kinh Tế (Finance & Economy)
    { id: 'def_fin_1', category: 'finance', name: '💳 CafeF Tài Chính Ngân Hàng', url: 'https://cafef.vn/tai-chinh-ngan-hang.chn', type: 'category' },
    { id: 'def_fin_2', category: 'finance', name: '📊 CafeF Chứng Khoán', url: 'https://cafef.vn/thi-truong-chung-khoan.chn', type: 'category' },
    { id: 'def_fin_3', category: 'finance', name: '🏦 CafeF Vĩ Mô & Đầu Tư', url: 'https://cafef.vn/vi-mo-dau-tu.chn', type: 'category' },
    { id: 'def_fin_rss_1', category: 'finance', name: '📡 CafeF Tài Chính RSS', url: 'https://cafef.vn/tai-chinh-ngan-hang.rss', type: 'rss' },
    { id: 'def_fin_4', category: 'finance', name: '🚀 CafeBiz Kinh Doanh', url: 'https://cafebiz.vn/kinh-doanh.chn', type: 'category' },
    { id: 'def_fin_rss_2', category: 'finance', name: '📡 VnExpress Kinh Doanh RSS', url: 'https://vnexpress.net/rss/kinh-doanh.rss', type: 'rss' },
    { id: 'def_fin_5', category: 'finance', name: '💼 VnExpress Kinh Doanh', url: 'https://vnexpress.net/kinh-doanh', type: 'category' },
    { id: 'def_fin_6', category: 'finance', name: '📉 VnEconomy Tài Chính', url: 'https://vneconomy.vn/tai-chinh-chung-khoan.htm', type: 'category' },
    { id: 'def_fin_7', category: 'finance', name: '💹 Vietstock Chứng Khoán', url: 'https://vietstock.vn/chung-khoan.htm', type: 'category' },
    { id: 'def_fin_8', category: 'finance', name: '💰 Báo Đầu Tư Tài Chính', url: 'https://baodautu.vn/tai-chinh-chung-khoan-d4/', type: 'category' },
    { id: 'def_fin_rss_3', category: 'finance', name: '📡 Tuổi Trẻ Kinh Doanh RSS', url: 'https://tuoitre.vn/rss/kinh-doanh.rss', type: 'rss' },
    { id: 'def_fin_rss_4', category: 'finance', name: '📡 VietNamNet Kinh Doanh RSS', url: 'https://vietnamnet.vn/rss/kinh-doanh.rss', type: 'rss' },
    { id: 'def_fin_9', category: 'finance', name: '📊 Dân Trí Kinh Doanh', url: 'https://dantri.com.vn/kinh-doanh.htm', type: 'category' },

    // 🏢 3. Bất Động Sản (Real Estate)
    { id: 'def_bds_rss_google', category: 'bds', name: '🌐 Google News BĐS Nóng 24h', url: 'https://news.google.com/rss/search?q=b%E1%BA%A5t+%C4%91%E1%BB%99ng+s%E1%BA%A3n+when:24h&hl=vi&gl=VN&ceid=VN:vi', type: 'rss' },
    { id: 'def_bds_rss_2', category: 'bds', name: '📡 CafeF BĐS RSS', url: 'https://cafef.vn/bat-dong-san.rss', type: 'rss' },
    { id: 'def_bds_rss_1', category: 'bds', name: '📡 VnExpress BĐS RSS', url: 'https://vnexpress.net/rss/bat-dong-san.rss', type: 'rss' },
    { id: 'def_bds_rss_3', category: 'bds', name: '📡 Tuổi Trẻ BĐS RSS', url: 'https://tuoitre.vn/rss/bat-dong-san.rss', type: 'rss' },
    { id: 'def_bds_rss_5', category: 'bds', name: '📡 VietNamNet BĐS RSS', url: 'https://vietnamnet.vn/rss/bat-dong-san.rss', type: 'rss' },
    { id: 'def_bds_rss_4', category: 'bds', name: '📡 Dân Trí BĐS RSS', url: 'https://dantri.com.vn/rss/bat-dong-san.rss', type: 'rss' },
    { id: 'def_bds_1', category: 'bds', name: '🏢 CafeF BĐS', url: 'https://cafef.vn/bat-dong-san.chn', type: 'category' },
    { id: 'def_bds_2', category: 'bds', name: '🏠 Batdongsan.com.vn', url: 'https://batdongsan.com.vn/tin-tuc', type: 'category' },
    { id: 'def_bds_3', category: 'bds', name: '🏙️ VnExpress BĐS', url: 'https://vnexpress.net/bat-dong-san', type: 'category' },
    { id: 'def_bds_4', category: 'bds', name: '📰 Tuổi Trẻ BĐS', url: 'https://tuoitre.vn/bat-dong-san.htm', type: 'category' },
    { id: 'def_bds_5', category: 'bds', name: '🔴 Dân Trí BĐS', url: 'https://dantri.com.vn/bat-dong-san.htm', type: 'category' },

    // 📰 4. Báo Nổi Tiếng & Thời Sự Tổng Hợp (Major Newspapers)
    { id: 'def_life_rss_1', category: 'lifestyle', name: '📰 VnExpress Tin Mới Nhất RSS', url: 'https://vnexpress.net/rss/tin-moi-nhat.rss', type: 'rss' },
    { id: 'def_life_rss_2', category: 'lifestyle', name: '🌏 Tuổi Trẻ Tin Mới 24h RSS', url: 'https://tuoitre.vn/rss/tin-moi-nhat.rss', type: 'rss' },
    { id: 'def_life_rss_3', category: 'lifestyle', name: '🔥 Dân Trí Tin Nổi Bật RSS', url: 'https://dantri.com.vn/rss/home.rss', type: 'rss' },
    { id: 'def_life_rss_4', category: 'lifestyle', name: '⭐ Thanh Niên Thời Sự RSS', url: 'https://thanhnien.vn/rss/thoi-su.rss', type: 'rss' },
    { id: 'def_life_rss_5', category: 'lifestyle', name: '🇻🇳 VietNamNet Thời Sự RSS', url: 'https://vietnamnet.vn/rss/thoi-su.rss', type: 'rss' },
    { id: 'def_life_rss_6', category: 'lifestyle', name: '👷 Báo Lao Động RSS', url: 'https://laodong.vn/rss/thoi-su.rss', type: 'rss' },
    { id: 'def_life_rss_7', category: 'lifestyle', name: '🚩 Tiền Phong Tin Mới RSS', url: 'https://tienphong.vn/rss/tin-moi-nhat.rss', type: 'rss' },
    { id: 'def_life_rss_8', category: 'lifestyle', name: '📺 VTC News Thời Sự 24/7 RSS', url: 'https://vtcnews.vn/rss/feed.rss', type: 'rss' },

    // 💻 5. Công Nghệ & AI
    { id: 'def_tech_1', category: 'tech', name: '💻 VnExpress Công Nghệ', url: 'https://vnexpress.net/cong-nghe', type: 'category' },
    { id: 'def_tech_2', category: 'tech', name: '📱 Tuổi Trẻ Công Nghệ', url: 'https://tuoitre.vn/cong-nghe.htm', type: 'category' },
    { id: 'def_tech_3', category: 'tech', name: '⚡ Dân Trí Sức Mạnh Số', url: 'https://dantri.com.vn/suc-manh-so.htm', type: 'category' },
    { id: 'def_tech_4', category: 'tech', name: '⚡ GenK Công Nghệ', url: 'https://genk.vn', type: 'category' },
    { id: 'def_tech_rss_1', category: 'tech', name: '📡 VnExpress Số Hóa RSS', url: 'https://vnexpress.net/rss/so-hoa.rss', type: 'rss' },
    { id: 'def_tech_rss_2', category: 'tech', name: '📡 Tuổi Trẻ Công Nghệ RSS', url: 'https://tuoitre.vn/rss/khoa-hoc-cong-nghe.rss', type: 'rss' },

    // 🌿 6. Sức Khỏe & Đời Sống
    { id: 'def_health_1', category: 'health', name: '🏥 Tuổi Trẻ Sức Khỏe', url: 'https://tuoitre.vn/suc-khoe.htm', type: 'category' },
    { id: 'def_health_2', category: 'health', name: '🌿 VnExpress Sức Khỏe', url: 'https://vnexpress.net/suc-khoe', type: 'category' },
    { id: 'def_health_3', category: 'health', name: '🍎 Dân Trí Sức Khỏe', url: 'https://dantri.com.vn/suc-khoe.htm', type: 'category' },
  ];

  const [showArticleBatchModal, setShowArticleBatchModal] = useState(false);
  const [articleBatchUrlsText, setArticleBatchUrlsText] = useState('');
  // Mặc định TẮT AI rewrite để giữ nguyên 100% nội dung gốc bài báo chính xác theo yêu cầu người dùng
  const [articleBatchEnableAi, setArticleBatchEnableAi] = useState(false);
  const [articleBatchAiStyle, setArticleBatchAiStyle] = useState('FANPAGE_POST');
  const [isScrapingArticleBatch, setIsScrapingArticleBatch] = useState(false);
  const [customCategoryInputUrl, setCustomCategoryInputUrl] = useState('');
  const [scrapedNewsItems, setScrapedNewsItems] = useState<ScrapedNewsPreviewItem[]>([]);
  const [activeCategoryTab, setActiveCategoryTab] = useState<string>('bds');
  const [showRawUrlArea, setShowRawUrlArea] = useState<boolean>(false);
  const [showChannelUrlList, setShowChannelUrlList] = useState<boolean>(false);
  const [isRadarActive, setIsRadarActive] = useState<boolean>(false);
  const [isRadarSweeping, setIsRadarSweeping] = useState<boolean>(false);
  const [radarAutoRefresh, setRadarAutoRefresh] = useState<boolean>(false);
  // Chu kỳ tự động cào lại (phút) — người dùng tự chọn thay vì cố định 15 phút, để cân bằng giữa độ
  // mới của tin và tải máy chủ (cào bằng Playwright tốn tài nguyên hơn khi lặp quá dày).
  const [radarAutoRefreshMinutes, setRadarAutoRefreshMinutes] = useState<number>(15);
  const [radarLastSweepTime, setRadarLastSweepTime] = useState<string>('');
  const [radarSearchKeyword, setRadarSearchKeyword] = useState<string>('');

  const [customChannels, setCustomChannels] = useState<CustomNewsChannel[]>(() => {
    try {
      const saved = localStorage.getItem('toolzutter_custom_news_channels');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) { }
    return DEFAULT_CUSTOM_CHANNELS;
  });

  const [showAddChannelModal, setShowAddChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelUrl, setNewChannelUrl] = useState('');
  const [newChannelCategory, setNewChannelCategory] = useState<'bds' | 'tech' | 'finance' | 'health' | 'other'>('bds');

  const saveChannelsToStorage = (channels: CustomNewsChannel[]) => {
    setCustomChannels(channels);
    try {
      localStorage.setItem('toolzutter_custom_news_channels', JSON.stringify(channels));
    } catch (e) { }
  };

  const handleAddCustomChannel = () => {
    if (!newChannelName.trim() || !newChannelUrl.trim()) {
      message.warning('Vui lòng nhập đầy đủ tên hiển thị và đường link chuyên mục!');
      return;
    }
    let cleanUrl = newChannelUrl.trim();
    if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;
    const isRss = cleanUrl.includes('.rss') || cleanUrl.includes('/rss');

    const newCh: CustomNewsChannel = {
      id: `custom_ch_${Date.now()}`,
      category: newChannelCategory,
      name: newChannelName.trim(),
      url: cleanUrl,
      type: isRss ? 'rss' : 'category'
    };

    const updated = [...customChannels, newCh];
    saveChannelsToStorage(updated);
    setNewChannelName('');
    setNewChannelUrl('');
    setShowAddChannelModal(false);
    message.success(`🎉 Đã lưu kênh "${newCh.name}" vào danh sách!`);
  };

  const handleDeleteCustomChannel = (id: string, name: string) => {
    const updated = customChannels.filter(c => c.id !== id);
    saveChannelsToStorage(updated);
    message.info(`Đã xóa kênh "${name}"`);
  };

  // Ref lưu URL bài đang được kéo (drag) trong lưới danh sách tin tức, dùng cho tính năng kéo-thả
  // sắp xếp lại thứ tự bài trước khi nạp hàng loạt.
  const newsDragUrlRef = useRef<string | null>(null);

  const handleNewsDragStart = (url: string) => {
    newsDragUrlRef.current = url;
  };

  const handleNewsDrop = (targetUrl: string) => {
    const draggedUrl = newsDragUrlRef.current;
    newsDragUrlRef.current = null;
    if (!draggedUrl || draggedUrl === targetUrl) return;
    setScrapedNewsItems((prev) => {
      const fromIdx = prev.findIndex((i) => i.url === draggedUrl);
      const toIdx = prev.findIndex((i) => i.url === targetUrl);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  // Cộng dồn kết quả quét mới vào danh sách hiện có thay vì thay thế toàn bộ — mỗi lượt "Quét Đa
  // Kênh Ngay"/quét tự động 15 phút chỉ chèn thêm bài THẬT SỰ MỚI (theo url), giữ nguyên trạng thái
  // selected/imported/thứ tự kéo-thả của các bài đã có trong danh sách. Bài mới được chèn lên đầu để
  // tin mới nhất luôn nổi lên trên, đúng tinh thần "Rada theo dõi tin tức mới 24/7".
  const mergeNewsItems = (
    prev: ScrapedNewsPreviewItem[],
    incoming: ScrapedNewsPreviewItem[]
  ): ScrapedNewsPreviewItem[] => {
    const existingUrls = new Set(prev.map((i) => i.url));
    const freshOnes = incoming.filter((it) => it.url && !existingUrls.has(it.url));
    return [...freshOnes, ...prev];
  };

  // Nhận bài từ trang Radar Tin Tức (NewsRadar) chuyển sang qua router state (nút "Gửi sang Đăng tự
  // động") — cào thẳng full nội dung & nạp ngay thành card "Bài viết" trong form đăng, KHÔNG mở panel
  // Săn Tin Tức trung gian nữa (trước đây phải mở panel rồi bấm "Cào & Nạp" thêm 1 lần, tốn thao
  // tác/thời gian thừa vì bài đã được chọn sẵn từ bên Radar rồi). Dọn state sau khi dùng để tránh
  // nạp lại trùng khi back/refresh.
  // Dùng ref để chặn triệt để React 18 / StrictMode re-run useEffect làm kích hoạt 2 lần khiến bài bị nhân đôi
  const handledImportRef = useRef<string>('');
  useEffect(() => {
    const incoming = (location.state as any)?.importedNewsArticles as ScrapedNewsPreviewItem[] | undefined;
    if (incoming && incoming.length > 0) {
      const incomingKey = incoming.map((it) => it.url).filter(Boolean).sort().join('||');
      if (handledImportRef.current === incomingKey) return;
      handledImportRef.current = incomingKey;

      // Xoá trắng card cũ ngay lập tức để không bị hiển thị thừa bài trống hoặc nhân đôi bài
      setLinkItems([]);
      setPreviews({});

      navigate(location.pathname, { replace: true, state: {} });
      handleBatchScrapeArticlesToForm(incoming.map((it) => it.url));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // Nhận bài từ Studio Ảnh Tin: mỗi bài thành 1 card "Nhập tay" có sẵn caption + ảnh tin, người dùng
  // chọn Page/Nhóm/giờ đăng như bình thường. Giờ đăng giãn theo batchInterval để không dồn cùng lúc.
  const handledStudioImportRef = useRef<string>('');
  useEffect(() => {
    const incoming = (location.state as any)?.importedStudioPosts as Array<{ caption: string; imageUrl: string; comment?: string }> | undefined;
    if (!incoming || incoming.length === 0) return;
    const key = incoming.map((p) => p.imageUrl).join('||');
    if (handledStudioImportRef.current === key) return;
    handledStudioImportRef.current = key;
    const base = dayjs().add(5, 'minute');
    const cards: PostLinkItem[] = incoming.map((p, idx) => ({
      id: `studio-${Date.now()}-${idx}`,
      url: '',
      inputType: 'MANUAL',
      manualContent: p.caption,
      manualMediaUrls: [p.imageUrl],
      manualMediaKinds: ['image'],
      isNow: false,
      scheduledAt: base.add(idx * (batchInterval || 60), 'minute'),
      includeCredit: false,
      // Chế độ "hook + nội dung ở bình luận": nội dung dài thả ở bình luận đầu tiên
      ...(p.comment ? { affiliateLink: p.comment, showCommentBox: true } : {}),
    }));
    // Bỏ các card trống mặc định rồi thêm bài từ Studio
    setLinkItems((prev) => [
      ...prev.filter((it) => it.url.trim() || it.manualContent?.trim() || (it.manualMediaUrls?.length || 0) > 0),
      ...cards,
    ]);
    navigate(location.pathname, { replace: true, state: {} });
    message.success(`Đã nhận ${cards.length} bài từ Studio Ảnh Tin. Chọn Page/Nhóm rồi bấm đăng.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const getDomainFromUrl = (url: string): string => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      if (host.includes('cafef')) return 'CafeF';
      if (host.includes('vnexpress')) return 'VnExpress';
      if (host.includes('batdongsan')) return 'Batdongsan';
      if (host.includes('tuoitre')) return 'Tuổi Trẻ';
      if (host.includes('dantri')) return 'Dân Trí';
      if (host.includes('vietnamnet')) return 'VietNamNet';
      if (host.includes('znews')) return 'ZNews';
      return host;
    } catch (e) {
      return 'Tin Tức';
    }
  };

  const handleFetchCategoryPreset = async (categoryUrl: string) => {
    message.loading({ content: '🌐 Đang quét danh sách bài viết mới nhất...', key: 'cat_preset' });
    try {
      const res = await api.post('/tools/scrape-category-links', { url: categoryUrl, limit: 10 });
      if (res.data?.success && res.data?.urls?.length > 0) {
        setArticleBatchUrlsText(res.data.urls.join('\n'));
        const rawItems = res.data.items || [];
        const parsedItems: ScrapedNewsPreviewItem[] = res.data.urls.map((url: string, index: number) => {
          const found = rawItems.find((it: any) => it.url === url) || rawItems[index];
          return {
            url: url,
            title: found?.title || url,
            coverImage: found?.coverImage || '',
            sapo: found?.sapo || '',
            source: found?.source || getDomainFromUrl(url),
            selected: true
          };
        });
        setScrapedNewsItems((prev) => mergeNewsItems(prev, parsedItems));
        message.success({ content: `🎉 Đã tìm thấy ${parsedItems.length} bài viết mới nhất!`, key: 'cat_preset' });
      } else {
        message.warning({ content: 'Không tìm thấy bài viết nào trên trang chuyên mục này', key: 'cat_preset' });
      }
    } catch (e: any) {
      message.error({ content: 'Lỗi khi quét trang chuyên mục tin tức', key: 'cat_preset' });
    }
  };

  const handleFetchRssPreset = async (rssUrl: string) => {
    message.loading({ content: '📡 Đang đọc RSS Feed 24/7...', key: 'rss_preset' });
    try {
      const res = await api.post('/tools/parse-rss', { url: rssUrl, limit: 10 });
      if (res.data?.success && res.data?.items?.length > 0) {
        const urls = res.data.items.map((it: any) => it.link);
        setArticleBatchUrlsText(urls.join('\n'));
        const parsedItems: ScrapedNewsPreviewItem[] = res.data.items.map((it: any) => ({
          url: it.link,
          title: it.title || it.link,
          sapo: it.description || '',
          source: getDomainFromUrl(it.link),
          publishedTime: it.pubDate ? new Date(it.pubDate).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '',
          selected: true
        }));
        setScrapedNewsItems((prev) => mergeNewsItems(prev, parsedItems));
        message.success({ content: `📡 Nạp thành công ${urls.length} bài mới từ RSS Feed!`, key: 'rss_preset' });
      } else {
        message.warning({ content: 'Không tìm thấy bài viết mới từ RSS Feed này', key: 'rss_preset' });
      }
    } catch (e: any) {
      message.error({ content: 'Lỗi khi đọc RSS Feed', key: 'rss_preset' });
    }
  };

  const handleRunRadarSweep = async (cat?: string) => {
    const categoryToSweep = cat || activeCategoryTab;
    setIsRadarSweeping(true);
    message.loading({ content: `📡 Rada đang quét đa kênh cho chủ đề [${categoryToSweep.toUpperCase()}]...`, key: 'radar_sweep' });

    const channelsToSweep = customChannels.filter(c => c.category === categoryToSweep || (categoryToSweep === 'custom' && true));
    if (channelsToSweep.length === 0) {
      message.warning({ content: 'Chưa khai báo kênh nào cho chủ đề này!', key: 'radar_sweep' });
      setIsRadarSweeping(false);
      return;
    }

    try {
      const allFetchedItems: ScrapedNewsPreviewItem[] = [];
      const seenUrls = new Set<string>();

      const promises = channelsToSweep.map(async (ch) => {
        try {
          if (ch.type === 'rss') {
            const res = await api.post('/tools/parse-rss', { url: ch.url, limit: 5 });
            if (res.data?.success && res.data?.items) {
              return res.data.items.map((it: any) => ({
                url: it.link,
                title: it.title || it.link,
                sapo: it.description || '',
                source: ch.name,
                coverImage: '',
                publishedTime: it.pubDate ? new Date(it.pubDate).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '',
                selected: true
              }));
            }
          } else {
            const res = await api.post('/tools/scrape-category-links', { url: ch.url, limit: 5 });
            if (res.data?.success && res.data?.urls) {
              const rawItems = res.data.items || [];
              return res.data.urls.map((u: string, idx: number) => {
                const found = rawItems.find((i: any) => i.url === u) || rawItems[idx];
                return {
                  url: u,
                  title: found?.title || u,
                  sapo: found?.sapo || '',
                  coverImage: found?.coverImage || '',
                  source: ch.name,
                  publishedTime: found?.publishedTime || '',
                  selected: true
                };
              });
            }
          }
        } catch (err) {
          return [];
        }
        return [];
      });

      const results = await Promise.all(promises);
      results.flat().forEach((item) => {
        if (item && item.url && !seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          allFetchedItems.push(item);
        }
      });

      if (allFetchedItems.length > 0) {
        setScrapedNewsItems((prev) => {
          const before = prev.length;
          const merged = mergeNewsItems(prev, allFetchedItems);
          const newCount = merged.length - before;
          message.success({
            content: newCount > 0
              ? `📡 Rada phát hiện thêm ${newCount} bài MỚI (đã cộng dồn vào danh sách, tổng ${merged.length} bài)!`
              : `📡 Rada đã quét lại — không có bài mới nào so với danh sách hiện có (${merged.length} bài).`,
            key: 'radar_sweep'
          });
          return merged;
        });
        setRadarLastSweepTime(new Date().toLocaleTimeString('vi-VN'));
        setIsRadarActive(true);
      } else {
        message.warning({ content: 'Rada không tìm thấy bài viết nào từ các kênh!', key: 'radar_sweep' });
      }
    } catch (e) {
      message.error({ content: 'Lỗi khi quét Rada tin tức', key: 'radar_sweep' });
    } finally {
      setIsRadarSweeping(false);
    }
  };

  useEffect(() => {
    let interval: any = null;
    if (radarAutoRefresh && showArticleBatchModal) {
      interval = setInterval(() => {
        handleRunRadarSweep();
      }, radarAutoRefreshMinutes * 60 * 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [radarAutoRefresh, radarAutoRefreshMinutes, showArticleBatchModal, activeCategoryTab]);

  const handleBatchScrapeArticlesToForm = async (overrideUrls?: string[]) => {
    const selectedUrls = scrapedNewsItems.filter((i) => i.selected).map((i) => i.url);
    const rawLines = overrideUrls && overrideUrls.length > 0
      ? overrideUrls
      : selectedUrls.length > 0
        ? selectedUrls
        : articleBatchUrlsText
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 5 && !l.includes('...') && (l.startsWith('http://') || l.startsWith('https://')));

    if (rawLines.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 bài viết hoặc dán đường link hợp lệ!');
      return;
    }

    setIsScrapingArticleBatch(true);
    message.loading({ content: `📰 Đang cào & biên tập ${rawLines.length} bài báo BĐS...`, key: 'batch_article', duration: 0 });

    const newLinkItems: PostLinkItem[] = [];
    const succeededUrls: string[] = [];
    const geminiKey = localStorage.getItem('toolzutter_gemini_api_key') || '';

    for (let i = 0; i < rawLines.length; i++) {
      const url = rawLines[i];
      const itemId = `art_${Date.now()}_${i}`;

      try {
        // 1. Cào full thông tin bài báo
        const scrapeRes = await api.post('/tools/scrape-article', { url });
        if (scrapeRes.data?.success) {
          const article = scrapeRes.data;
          const rawSource = ((article.siteName || article.domain || '') + ' ' + (url || article.url || '')).toLowerCase();
          // Dùng tên domain (có dấu chấm hoặc .vn) để tránh Facebook tự động popup gợi ý tag trang
          // khi worker gõ từ khóa trùng tên Page (VD: "CafeF" → Facebook gợi ý tag trang CafeF BĐS)
          let cleanSource = 'Báo điện tử';
          if (rawSource.includes('cafef')) cleanSource = 'cafef.vn';
          else if (rawSource.includes('vnexpress')) cleanSource = 'vnexpress.net';
          else if (rawSource.includes('dantri')) cleanSource = 'dantri.com.vn';
          else if (rawSource.includes('tuoitre')) cleanSource = 'tuoitre.vn';
          else if (rawSource.includes('vietnamnet')) cleanSource = 'vietnamnet.vn';
          else if (rawSource.includes('thanhnien')) cleanSource = 'thanhnien.vn';
          else if (rawSource.includes('batdongsan.com')) cleanSource = 'batdongsan.com.vn';
          else if (rawSource.includes('chinhphu')) cleanSource = 'chinhphu.vn';
          else if (rawSource.includes('vneconomy')) cleanSource = 'vneconomy.vn';
          else if (article.siteName) cleanSource = article.siteName;

          const pageHashtags = '#vietnamrealestate #batdongsan #radiantvietnam';
          const newsFooter = `Nguồn: ${cleanSource}\n\n${pageHashtags}`;
          let finalCaption = `📌 ${article.title}\n\n💡 ${article.sapo || ''}\n\n${article.content}\n\n${newsFooter}`;

          // 2. Viết lại bằng AI nếu bật
          if (articleBatchEnableAi) {
            try {
              const aiRes = await api.post('/tools/rewrite-article-ai', {
                title: article.title,
                sapo: article.sapo || '',
                content: article.content,
                style: articleBatchAiStyle,
                apiKey: geminiKey
              });
              if (aiRes.data?.success && aiRes.data?.rewrittenContent) {
                finalCaption = cleanMarkdownAsterisks(aiRes.data.rewrittenContent);
                if (!finalCaption.includes('Nguồn:')) {
                  finalCaption += `\n\n${newsFooter}`;
                }
              }
            } catch (aiErr) {
              console.warn(`[PlaywrightPoster] AI Rewrite warning for ${url}:`, aiErr);
            }
          }

          const mediaUrls = (article.images || []).map((img: any) => img.url || img);
          const mediaKinds = mediaUrls.map(() => 'image' as const);

          newLinkItems.push({
            id: itemId,
            url,
            customCaption: finalCaption,
            isNow: i === 0,
            scheduledAt: dayjs().add(i * 30, 'minute'),
            includeCredit: true,
            inputType: 'LINK',
          });
          succeededUrls.push(url);

          setPreviews((prev) => ({
            ...prev,
            [itemId]: {
              loading: false,
              caption: finalCaption,
              author: article.siteName || article.domain || '',
              mediaUrls,
              mediaKinds,
              originalMediaUrls: [...mediaUrls],
              originalMediaKinds: [...mediaKinds],
              videoCount: 0,
              imageCount: mediaUrls.length,
              watermarkRemoved: true,
            }
          }));
        }
      } catch (err: any) {
        console.error(`Lỗi cào bài báo ${url}:`, err);
      }
    }

    if (newLinkItems.length > 0) {
      setLinkItems((prev) => {
        if (overrideUrls && overrideUrls.length > 0) {
          // Khi chủ động chuyển bài từ NewsRadar sang, thay thế form bằng đúng các bài mới chuyển (tránh bị trùng lặp)
          return newLinkItems;
        }
        const newUrlSet = new Set(newLinkItems.map((item) => item.url.trim()));
        const filteredOld = prev.filter((item) => item.url.trim().length > 0 && !newUrlSet.has(item.url.trim()));
        return [...filteredOld, ...newLinkItems];
      });
      // Đánh dấu các bài đã nạp thành công để lần sau mở lại panel Rada, người dùng thấy ngay bài
      // nào đã lấy rồi (badge "✓ Đã nạp") thay vì phải nhớ hoặc chọn nhầm lại lần 2.
      if (succeededUrls.length > 0) {
        const succeededSet = new Set(succeededUrls);
        setScrapedNewsItems((prev) => prev.map((it) => succeededSet.has(it.url) ? { ...it, imported: true, selected: false } : it));
      }
      message.success({ content: `🎉 Đã cào thành công ${newLinkItems.length}/${rawLines.length} bài báo BĐS & điền vào form Đăng tự động!`, key: 'batch_article' });
      setShowArticleBatchModal(false);
      setArticleBatchUrlsText('');
    } else {
      message.error({ content: 'Không thể cào dữ liệu từ các link đã nhập!', key: 'batch_article' });
    }

    setIsScrapingArticleBatch(false);
  };

  const swipeReviewItems = useMemo(
    () => linkItems.filter((item) =>
      item.inputType === 'MANUAL'
        ? Boolean(item.manualContent?.trim() || item.manualMediaUrls?.length)
        : Boolean(item.url.trim())
    ),
    [linkItems]
  );
  const activeSwipeItem = swipeReviewItems[swipeReviewIndex];
  const activeSwipePreview = activeSwipeItem
    ? (previews[activeSwipeItem.id] || bulkDrawerPreviews[activeSwipeItem.url?.trim()])
    : undefined;
  const activeSwipeMediaUrls = activeSwipeItem
    ? (activeSwipeItem.inputType === 'MANUAL'
        ? activeSwipeItem.manualMediaUrls || []
        : (activeSwipePreview?.mediaUrls && activeSwipePreview.mediaUrls.length > 0)
          ? activeSwipePreview.mediaUrls
          : (bulkDrawerPreviews[activeSwipeItem.url?.trim()]?.mediaUrls || []))
    : [];
  const activeSwipeMediaKinds = activeSwipeItem
    ? (activeSwipeItem.inputType === 'MANUAL'
        ? activeSwipeItem.manualMediaKinds || []
        : (activeSwipePreview?.mediaKinds && activeSwipePreview.mediaKinds.length > 0)
          ? activeSwipePreview.mediaKinds
          : (bulkDrawerPreviews[activeSwipeItem.url?.trim()]?.mediaKinds || []))
    : [];
  const activeSwipeCaption = activeSwipeItem
    ? (activeSwipeItem.customCaption !== undefined && activeSwipeItem.customCaption.trim() !== ''
      ? activeSwipeItem.customCaption
      : activeSwipeItem.inputType === 'MANUAL'
        ? activeSwipeItem.manualContent || ''
        : activeSwipePreview?.caption || bulkDrawerPreviews[activeSwipeItem.url?.trim()]?.caption || '')
    : '';

  const openSwipeReview = () => {
    // Đảm bảo previews được nạp từ bulkDrawerPreviews cho toàn bộ items trước khi mở Tinder Review
    setPreviews((prev) => {
      const next = { ...prev };
      linkItems.forEach((item) => {
        if (!next[item.id]) {
          const cached = bulkDrawerPreviews[item.url.trim()];
          if (cached) {
            next[item.id] = {
              loading: false,
              caption: cached.caption || item.customCaption || '',
              author: cached.author || '',
              mediaUrls: cached.mediaUrls || [],
              mediaKinds: cached.mediaKinds || [],
              originalMediaUrls: cached.originalMediaUrls || cached.mediaUrls || [],
              originalMediaKinds: cached.originalMediaKinds || cached.mediaKinds || [],
              videoCount: cached.videoCount || 0,
              imageCount: cached.imageCount || 0,
              watermarkRemoved: cached.watermarkRemoved,
            };
          }
        }
      });
      return next;
    });
    setSwipeReviewIndex(0);
    setSwipeMediaIndex(0);
    setSwipeDecisions({});
    setSwipeReviewOpen(true);
  };

  const handleSwipeDecision = (decision: 'KEEP' | 'REJECT') => {
    if (!activeSwipeItem) return;
    setSwipeDecisions((current) => ({ ...current, [activeSwipeItem.id]: decision }));
    setSwipeMediaIndex(0);
    setSwipeReviewIndex((current) => Math.min(current + 1, swipeReviewItems.length));
  };

  const handleSwipeCaptionChange = (newCaption: string) => {
    if (!activeSwipeItem) return;
    if (activeSwipeItem.inputType === 'MANUAL') {
      updateLinkManualContent(activeSwipeItem.id, newCaption);
    } else {
      updateLinkCustomCaption(activeSwipeItem.id, newCaption);
    }
  };

  const handleApplySwipeReview = () => {
    const rejectedIds = new Set(
      Object.entries(swipeDecisions)
        .filter(([, decision]) => decision === 'REJECT')
        .map(([id]) => id)
    );
    const keptItems = linkItems.filter((item) => !rejectedIds.has(item.id));
    setLinkItems(keptItems.length > 0
      ? keptItems
      : [{ id: Math.random().toString(36).substring(2, 9), url: '', isNow: true, scheduledAt: dayjs(), includeCredit: true }]
    );
    setPreviews((current) => {
      const next = { ...current };
      rejectedIds.forEach((id) => delete next[id]);
      return next;
    });
    setSwipeReviewOpen(false);
    message.success(`Đã giữ ${swipeReviewItems.length - rejectedIds.size} bài và bỏ ${rejectedIds.size} bài khỏi danh sách.`);
  };

  useEffect(() => {
    if (!swipeReviewOpen || !activeSwipeItem || activeSwipeItem.inputType === 'MANUAL') return;
    if (activeSwipeItem.url.trim() && !previews[activeSwipeItem.id]) {
      const cached = bulkDrawerPreviews[activeSwipeItem.url.trim()];
      if (cached) {
        setPreviews((prev) => ({
          ...prev,
          [activeSwipeItem.id]: {
            loading: false,
            caption: cached.caption || activeSwipeItem.customCaption || '',
            author: cached.author || '',
            mediaUrls: cached.mediaUrls || [],
            mediaKinds: cached.mediaKinds || [],
            originalMediaUrls: cached.originalMediaUrls || cached.mediaUrls || [],
            originalMediaKinds: cached.originalMediaKinds || cached.mediaKinds || [],
            videoCount: cached.videoCount || 0,
            imageCount: cached.imageCount || 0,
            watermarkRemoved: cached.watermarkRemoved,
          },
        }));
        return;
      }
      handlePreviewLink(activeSwipeItem);
    }
  }, [swipeReviewOpen, activeSwipeItem?.id]);

  useEffect(() => {
    if (!swipeReviewOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable') === 'true')) {
        return;
      }
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleSwipeDecision('REJECT');
      } else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd' || e.key === ' ') {
        e.preventDefault();
        handleSwipeDecision('KEEP');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [swipeReviewOpen, activeSwipeItem?.id, swipeReviewItems.length, swipeReviewIndex]);

  // Bộ cấu hình chia giờ tự động khi thêm link
  const [batchScheduleMode, setBatchScheduleMode] = useState<'WINDOW' | 'INTERVAL' | 'NOW'>('WINDOW');
  // "Nối đuôi liên tục": backend tự xếp bài mới ngay sau bài đang chờ của đúng nick, nghỉ N phút/bài.
  const [queueAppendMode, setQueueAppendModeState] = useState<boolean>(() => localStorage.getItem('poster_queue_append') !== '0');
  const [queueGapMinutes, setQueueGapMinutesState] = useState<number>(() => {
    const saved = Number(localStorage.getItem('poster_queue_gap_minutes'));
    return Number.isFinite(saved) && saved >= 0 && localStorage.getItem('poster_queue_gap_minutes') !== null ? saved : 2;
  });
  const setQueueAppendMode = (on: boolean) => {
    setQueueAppendModeState(on);
    localStorage.setItem('poster_queue_append', on ? '1' : '0');
  };
  const setQueueGapMinutes = (minutes: number) => {
    setQueueGapMinutesState(minutes);
    localStorage.setItem('poster_queue_gap_minutes', String(minutes));
  };
  const queueAppendPayload = queueAppendMode
    ? { publishNow: false, appendToQueue: true, gapSeconds: Math.round(queueGapMinutes * 60) }
    : {};
  const [packingQueue, setPackingQueue] = useState(false);
  const [batchWindowDate, setBatchWindowDate] = useState<Dayjs>(dayjs());
  const [batchWindowStartTime, setBatchWindowStartTime] = useState<Dayjs>(dayjs().hour(9).minute(0).second(0));
  const [batchWindowEndTime, setBatchWindowEndTime] = useState<Dayjs>(dayjs().hour(17).minute(30).second(0));
  const [batchWindowMaxPerDay, setBatchWindowMaxPerDay] = useState<number>(-1);
  const [desiredMinInterval, setDesiredMinInterval] = useState<number>(30); // Giãn cách tối thiểu 30 phút/bài chống dồn dập
  const [batchStartMode, setBatchStartMode] = useState<'NOW' | 'TIME'>('NOW');
  const [batchStartTime, setBatchStartTime] = useState<Dayjs>(dayjs().add(60, 'minute'));
  const [batchInterval, setBatchInterval] = useState<number>(60);
  const [batchToolsOpen, setBatchToolsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Thao tác hàng loạt trên các bài trong Hàng đợi & Lịch sử
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [bulkRescheduleModalVisible, setBulkRescheduleModalVisible] = useState(false);
  const [bulkRescheduleTargetScope, setBulkRescheduleTargetScope] = useState<'ALL' | 'SELECTED'>('ALL');
  const [bulkRescheduleMode, setBulkRescheduleMode] = useState<'WINDOW' | 'INTERVAL' | 'VIRAL'>('WINDOW');
  const [bulkRescheduleDate, setBulkRescheduleDate] = useState<Dayjs>(dayjs());
  const [bulkRescheduleStartTime, setBulkRescheduleStartTime] = useState<Dayjs>(dayjs().hour(9).minute(0).second(0));
  const [bulkRescheduleEndTime, setBulkRescheduleEndTime] = useState<Dayjs>(dayjs().hour(18).minute(0).second(0));
  const [bulkRescheduleInterval, setBulkRescheduleInterval] = useState<number>(60);
  const [bulkRescheduleInterleave, setBulkRescheduleInterleave] = useState<boolean>(true);
  const [bulkRescheduleMaxPerDay, setBulkRescheduleMaxPerDay] = useState<number>(-1);
  const [bulkRescheduleSameDayGap, setBulkRescheduleSameDayGap] = useState<number>(30);
  const [bulkRescheduleAutoFitSameDay, setBulkRescheduleAutoFitSameDay] = useState<boolean>(true);
  const [bulkRescheduleDistributeNicks, setBulkRescheduleDistributeNicks] = useState<boolean>(false);
  const [bulkRescheduleSelectedNicks, setBulkRescheduleSelectedNicks] = useState<string[]>([]);
  // Chế độ "Giờ vàng Viral"
  const [viralMaxPerTargetPerDay, setViralMaxPerTargetPerDay] = useState<number>(10);
  const [viralMinGapPerTarget, setViralMinGapPerTarget] = useState<number>(45);
  const [viralMinGapGlobal, setViralMinGapGlobal] = useState<number>(8);
  const [viralJitter, setViralJitter] = useState<boolean>(true);
  const [viralSeed, setViralSeed] = useState<number>(() => Date.now());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  // Modal chuyển toàn bộ bài lỗi về Chờ đăng (Reset Failed to Pending)
  const [resetFailedModalVisible, setResetFailedModalVisible] = useState(false);
  const [resetFailedMode, setResetFailedMode] = useState<'STAGGER' | 'TODAY_23H' | 'NOW'>('STAGGER');
  const [resetFailedSpacing, setResetFailedSpacing] = useState<number>(900);

  // Modal dán nhiều link cùng lúc (Bulk Paste Drawer)
  const [bulkModalVisible, setBulkModalVisible] = useState(false);
  const [bulkAutoDistributeTwoVias, setBulkAutoDistributeTwoVias] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkScheduleMode, setBulkScheduleMode] = useState<'WINDOW' | 'INTERVAL' | 'NOW'>('WINDOW');
  const [bulkWindowDate, setBulkWindowDate] = useState<Dayjs>(dayjs());
  const [bulkWindowStartTime, setBulkWindowStartTime] = useState<Dayjs>(dayjs().hour(9).minute(0).second(0));
  const [bulkWindowEndTime, setBulkWindowEndTime] = useState<Dayjs>(dayjs().hour(18).minute(0).second(0));
  const [bulkWindowMaxPerDay, setBulkWindowMaxPerDay] = useState<number>(-1);
  const [bulkStartMode, setBulkStartMode] = useState<'NOW' | 'TIME'>('NOW');
  const [bulkStartTime, setBulkStartTime] = useState<Dayjs>(dayjs().add(60, 'minute'));
  const [bulkInterval, setBulkInterval] = useState<number>(60);

  // TikTok Channel & Viral Hunter State
  const [hunterDrawerVisible, setHunterDrawerVisible] = useState(false);
  const [hunterTarget, setHunterTarget] = useState('');
  const [hunterLimit, setHunterLimit] = useState<number>(48);
  const [hunterMinViews, setHunterMinViews] = useState<number>(0);
  const [hunterDurationFilter, setHunterDurationFilter] = useState<'ALL' | 'SHORT' | 'LONG'>('ALL');
  const [hunterSortBy, setHunterSortBy] = useState<'VIEWS_DESC' | 'LIKES_DESC' | 'NEWEST'>('VIEWS_DESC');
  const [hunterUltraHD, setHunterUltraHD] = useState<boolean>(true);
  const [hunterHideImported, setHunterHideImported] = useState<boolean>(true);
  const [hunterAutoSchedule, setHunterAutoSchedule] = useState<boolean>(false);
  const [hunterLoading, setHunterLoading] = useState(false);
  const [hunterResults, setHunterResults] = useState<Array<{
    id: string;
    url: string;
    title: string;
    desc: string;
    views: number;
    likes: number;
    comments: number;
    duration: string;
    cover: string;
    channel: string;
    isAlreadyImported?: boolean;
    postStatus?: string;
  }>>([]);
  const [hunterSelectedIds, setHunterSelectedIds] = useState<Set<string>>(new Set());

  const handleHuntChannel = async () => {
    if (!hunterTarget.trim()) {
      message.warning('Vui lòng nhập tên kênh (ví dụ: @tiemmeoxinh) hoặc link TikTok');
      return;
    }
    setHunterLoading(true);
    try {
      const res = await api.post('/tools/hunt-tiktok-channel', {
        handle: hunterTarget.trim(),
        limit: hunterLimit,
      });
      if (res.data?.success && Array.isArray(res.data?.items)) {
        const items = res.data.items;
        setHunterResults(items);
        // Tự động bỏ chọn các video đã từng đăng / đã có trong hàng đợi
        const validNew = items.filter((it: any) => !it.isAlreadyImported);
        setHunterSelectedIds(new Set((validNew.length > 0 ? validNew : items).map((it: any) => it.id)));
        const dupCount = Number(res.data.alreadyImportedCount) || (items.length - validNew.length);
        message.success(
          `🎯 Đã quét được ${items.length} video từ ${res.data.channel || hunterTarget}!${
            dupCount > 0 ? ` (Tự động bỏ chọn ${dupCount} video đã từng đăng)` : ''
          }`
        );
      } else {
        message.error(res.data?.error || 'Không tìm thấy video nào');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.error || err?.message || 'Lỗi khi quét kênh TikTok');
    } finally {
      setHunterLoading(false);
    }
  };

  // Lọc và sắp xếp video theo tiêu chí của người dùng
  const filteredAndSortedHunterVideos = useMemo(() => {
    let list = [...hunterResults];

    // Lọc bỏ video đã đăng nếu bật chế độ Ẩn video đã đăng
    if (hunterHideImported) {
      list = list.filter((it) => !it.isAlreadyImported);
    }

    // Lọc theo lượt xem tối thiểu
    if (hunterMinViews > 0) {
      list = list.filter((it) => it.views >= hunterMinViews);
    }

    // Lọc theo thời lượng
    if (hunterDurationFilter === 'SHORT') {
      list = list.filter((it) => {
        const dur = it.duration ? (it.duration.includes(':') ? parseInt(it.duration.split(':')[0]) * 60 + parseInt(it.duration.split(':')[1]) : parseInt(it.duration)) : 0;
        return dur <= 60;
      });
    } else if (hunterDurationFilter === 'LONG') {
      list = list.filter((it) => {
        const dur = it.duration ? (it.duration.includes(':') ? parseInt(it.duration.split(':')[0]) * 60 + parseInt(it.duration.split(':')[1]) : parseInt(it.duration)) : 0;
        return dur > 60;
      });
    }

    // Sắp xếp
    if (hunterSortBy === 'VIEWS_DESC') {
      list.sort((a, b) => b.views - a.views);
    } else if (hunterSortBy === 'LIKES_DESC') {
      list.sort((a, b) => b.likes - a.likes);
    }

    return list;
  }, [hunterResults, hunterHideImported, hunterMinViews, hunterDurationFilter, hunterSortBy]);

  const handleImportHunterVideos = () => {
    const selected = filteredAndSortedHunterVideos.filter((it) => hunterSelectedIds.has(it.id));
    if (selected.length === 0) {
      message.warning('Chưa chọn video nào để nhập!');
      return;
    }
    const linksText = selected.map((it) => it.url).join('\n');
    setBulkText((prev) => (prev ? `${prev}\n${linksText}` : linksText));

    if (hunterAutoSchedule) {
      // Bật chế độ rải lịch: Cách nhau 180 phút (3 tiếng 1 bài) bắt đầu từ 11:30 ngày mai
      setBulkStartMode('TIME');
      setBulkStartTime(dayjs().add(1, 'day').hour(11).minute(30));
      setBulkInterval(180);
    }

    setHunterDrawerVisible(false);
    setBulkModalVisible(true);
    message.success(`🚀 Đã chuyển ${selected.length} video viral vào danh sách dán hàng loạt! ${hunterAutoSchedule ? 'Đã kích hoạt rải lịch tự động!' : ''}`);
  };

  // ── SĂN / QUÉT BÀI VIẾT FACEBOOK GROUP (Group Hunter) ─────────────────────────
  const [groupHunterDrawerVisible, setGroupHunterDrawerVisible] = useState(false);
  const [groupHunterTarget, setGroupHunterTarget] = useState<string>('');
  const [groupHunterLimit, setGroupHunterLimit] = useState<number>(20);
  // Lọc bài theo ngày đăng (null = không lọc, quét như cũ)
  const [groupHunterDateRange, setGroupHunterDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [groupHunterMediaFilter, setGroupHunterMediaFilter] = useState<'ALL' | 'MEDIA_ONLY' | 'IMAGE_ONLY' | 'VIDEO_ONLY'>('MEDIA_ONLY');
  const [groupHunterSkipImported, setGroupHunterSkipImported] = useState<boolean>(true);
  const [groupHunterAutoSchedule, setGroupHunterAutoSchedule] = useState<boolean>(true);
  const [groupHunterInterval, setGroupHunterInterval] = useState<number>(60);
  const [groupHunterLoading, setGroupHunterLoading] = useState(false);
  const [groupHunterResults, setGroupHunterResults] = useState<Array<{
    id: string;
    url: string;
    author: string;
    caption: string;
    previewCover: string;
    images: string[];
    mediaType: 'IMAGE' | 'VIDEO' | 'TEXT';
    mediaCount: number;
    isAlreadyImported?: boolean;
    postedTime?: string;
    postedAt?: number | null;
    dateUnknown?: boolean;
    aiCurated?: boolean;
    aiScore?: number;
    qualityVerdict?: string;
    viralAngle?: string;
    suggestedHook?: string;
    isSpam?: boolean;
    originalCaption?: string;
    aiRewritten?: boolean;
  }>>([]);
  const [groupHunterAiCurating, setGroupHunterAiCurating] = useState<boolean>(false);
  const [groupHunterAiOnlyQuality, setGroupHunterAiOnlyQuality] = useState<boolean>(false);
  const [groupHunterScheduleMode, setGroupHunterScheduleMode] = useState<'INTERVAL' | 'GOLDEN_HOURS'>('GOLDEN_HOURS');
  const [groupHunterBatchAiOpen, setGroupHunterBatchAiOpen] = useState(false);
  const [groupHunterBatchAiMode, setGroupHunterBatchAiMode] = useState<'HOOK' | 'REWRITE' | 'ENGAGEMENT' | 'STORYTELLING' | 'SHORTEN'>('REWRITE');
  const [groupHunterBatchAiLoading, setGroupHunterBatchAiLoading] = useState(false);
  const [groupHunterBatchAiProgress, setGroupHunterBatchAiProgress] = useState({ current: 0, total: 0 });
  const [groupHunterPreviewItem, setGroupHunterPreviewItem] = useState<any>(null);
  const [groupHunterGroupName, setGroupHunterGroupName] = useState<string>('');
  // Nguồn của lần quét gần nhất: Group hay Fanpage (Fanpage không tự khớp Nhóm đích)
  const [groupHunterSourceType, setGroupHunterSourceType] = useState<'GROUP' | 'PAGE'>('GROUP');
  const [groupHunterCustomName, setGroupHunterCustomName] = useState<string>('');
  const [groupHunterSelectedIds, setGroupHunterSelectedIds] = useState<Set<string>>(new Set());
  const [favoriteGroupSearch, setFavoriteGroupSearch] = useState('');
  const [favoriteGroupsExpanded, setFavoriteGroupsExpanded] = useState(false);
  const [favoriteGroupCategoryFilter, setFavoriteGroupCategoryFilter] = useState<'ALL' | 'PHIM' | 'GENERAL'>('ALL');

  // Danh sách Group yêu thích do người dùng lưu
  const [favoriteGroups, setFavoriteGroups] = useState<Array<{ name: string; url: string }>>(() => {
    try {
      const saved = localStorage.getItem('toolzutter_favorite_groups');
      return saved ? JSON.parse(saved) : [
        { name: 'Không Sợ Đói', url: 'https://www.facebook.com/groups/1480736115349715/' },
        { name: 'GenZ làm mẹ (400k member)', url: 'https://www.facebook.com/groups/773774567089399' }
      ];
    } catch (e) {
      return [
        { name: 'Không Sợ Đói', url: 'https://www.facebook.com/groups/1480736115349715/' },
        { name: 'GenZ làm mẹ (400k member)', url: 'https://www.facebook.com/groups/773774567089399' }
      ];
    }
  });

  // Danh sách URL nhóm đã chủ động bấm nút X để xóa (không hiển thị lại)
  const [removedFavoriteUrls, setRemovedFavoriteUrls] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('toolzutter_removed_crawlgroups');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const handleAddFavoriteGroup = (urlToAdd?: string, nameToAdd?: string) => {
    const rawTarget = (urlToAdd || groupHunterTarget).trim();
    if (!rawTarget) {
      message.warning('Vui lòng nhập Link hoặc ID Group trước khi lưu!');
      return;
    }
    let normalizedUrl = rawTarget;
    if (!normalizedUrl.startsWith('http')) {
      if (/^\d+$/.test(normalizedUrl)) {
        normalizedUrl = `https://www.facebook.com/groups/${normalizedUrl}`;
      } else {
        normalizedUrl = `https://www.facebook.com/groups/${normalizedUrl.replace(/^groups\//, '')}`;
      }
    }
    const cleanNorm = normalizedUrl.replace(/\/$/, '');
    const groupName = nameToAdd || groupHunterCustomName.trim() || groupHunterGroupName || normalizedUrl.split('/groups/')[1]?.replace(/\/$/, '') || 'Group';

    // Bỏ khỏi danh sách đã xóa nếu thêm lại
    setRemovedFavoriteUrls((prev) => {
      const updated = prev.filter((u) => u !== cleanNorm);
      localStorage.setItem('toolzutter_removed_crawlgroups', JSON.stringify(updated));
      return updated;
    });

    setFavoriteGroups((prev) => {
      if (prev.some((g) => g.url === normalizedUrl || g.url.replace(/\/$/, '') === cleanNorm)) {
        message.info('Group này đã có trong Danh Sách Yêu Thích!');
        return prev;
      }
      const updated = [...prev, { name: groupName, url: normalizedUrl }];
      localStorage.setItem('toolzutter_favorite_groups', JSON.stringify(updated));
      message.success(`⭐ Đã lưu nhóm "${groupName}" vào Danh Sách Yêu Thích!`);
      return updated;
    });
  };

  const handleRemoveFavoriteGroup = (urlToRemove: string) => {
    const norm = (urlToRemove || '').trim().replace(/\/$/, '');
    setFavoriteGroups((prev) => {
      const updated = prev.filter((g) => (g.url || '').trim().replace(/\/$/, '') !== norm);
      localStorage.setItem('toolzutter_favorite_groups', JSON.stringify(updated));
      return updated;
    });
    setRemovedFavoriteUrls((prev) => {
      if (prev.includes(norm)) return prev;
      const updated = [...prev, norm];
      localStorage.setItem('toolzutter_removed_crawlgroups', JSON.stringify(updated));
      return updated;
    });
    message.success('Đã xóa nhóm khỏi danh sách nhóm nguồn');
  };

  const handleRenameFavoriteGroup = (urlToRename: string, currentName: string) => {
    Modal.confirm({
      title: '✏️ Đổi tên gợi nhớ tuyến nội dung cho Group',
      content: (
        <div className="pt-2 space-y-2">
          <div className="text-xs text-slate-400">Nhập tên gợi nhớ tuyến nội dung để dễ nhận biết (VD: Tuyển Dụng, Mẹ & Bé, Nấu Ăn...):</div>
          <Input
            defaultValue={currentName}
            id="rename-group-input"
            placeholder="Ví dụ: Tuyển Dụng Kế Toán, Mẹ & Bé GenZ, Nấu Ăn..."
            className="rounded-lg mt-1"
          />
        </div>
      ),
      onOk: () => {
        const inputEl = document.getElementById('rename-group-input') as HTMLInputElement;
        const newName = inputEl?.value?.trim();
        if (!newName) return;
        setFavoriteGroups((prev) => {
          const updated = prev.map((g) => (g.url === urlToRename ? { ...g, name: newName } : g));
          localStorage.setItem('toolzutter_favorite_groups', JSON.stringify(updated));
          message.success(`✅ Đã đổi tên nhóm thành "${newName}"`);
          return updated;
        });
      },
    });
  };

  const handleHuntFacebookGroup = async () => {
    if (!groupHunterTarget.trim()) {
      message.warning('Vui lòng nhập link Facebook Group hoặc Fanpage (ví dụ: https://www.facebook.com/groups/xxxxx hoặc https://www.facebook.com/tenfanpage)');
      return;
    }
    setGroupHunterLoading(true);
    try {
      const activeCookieAcc = (socialAccounts || []).find((a) => a.pageName?.toLowerCase().includes('làm sen') && a.accessToken)
        || (socialAccounts || []).find((a) => a.accessToken && a.accessToken.trim().length > 0 && a.tokenStatus === 'OK')
        || (socialAccounts || []).find((a) => a.accessToken && a.accessToken.trim().length > 0);

      const res = await api.post('/tools/hunt-facebook-group', {
        groupUrl: groupHunterTarget.trim(),
        limit: groupHunterLimit,
        cookieString: activeCookieAcc?.accessToken || undefined,
        dateFrom: groupHunterDateRange ? groupHunterDateRange[0].format('YYYY-MM-DD') : undefined,
        dateTo: groupHunterDateRange ? groupHunterDateRange[1].format('YYYY-MM-DD') : undefined,
      }, { timeout: groupHunterDateRange ? 320000 : 180000 });
      if (res.data?.success && Array.isArray(res.data?.items)) {
        const items = res.data.items;
        setGroupHunterResults(items);
        setGroupHunterGroupName(res.data.groupName || 'Facebook Group');
        setGroupHunterSourceType(res.data.sourceType === 'PAGE' ? 'PAGE' : 'GROUP');

        // Mặc định chọn tối đa `groupHunterLimit` bài MỚI (chưa có trong Lịch Đăng)
        const newItems = items.filter((it: any) => !it.isAlreadyImported && !it.dateUnknown);
        const autoSelectedItems = newItems.slice(0, groupHunterLimit);
        const importedCount = items.length - newItems.length;
        setGroupHunterSelectedIds(new Set(autoSelectedItems.map((it: any) => it.id)));

        // Tự động cập nhật tên nhóm nếu chưa có tên chuẩn
        if (res.data.groupName && res.data.groupName !== 'Facebook Group') {
          const rawTarget = groupHunterTarget.trim();
          setFavoriteGroups((prev) => {
            const idx = prev.findIndex((g) => g.url === rawTarget || rawTarget.includes(g.url) || g.url.includes(rawTarget));
            if (idx !== -1 && prev[idx].name !== res.data.groupName) {
              const copy = [...prev];
              copy[idx] = { ...copy[idx], name: res.data.groupName };
              localStorage.setItem('toolzutter_favorite_groups', JSON.stringify(copy));
              return copy;
            }
            return prev;
          });
        }

        if (res.data.dateFiltered) {
          const inRange = items.filter((it: any) => !it.dateUnknown).length;
          const unknown = Number(res.data.unknownDateCount) || 0;
          const rangeText = `${groupHunterDateRange?.[0].format('DD/MM')} – ${groupHunterDateRange?.[1].format('DD/MM')}`;
          message.success(
            `Đã đọc ${res.data.scannedCount ?? items.length} bài, ${inRange} bài đăng trong ${rangeText}. `
            + `Chọn sẵn ${autoSelectedItems.length} bài mới chưa có trong Lịch đăng`
            + (unknown > 0 ? `, ${unknown} bài không đọc được ngày (chưa chọn).` : '.')
            + (res.data.stopReason === 'TIMEOUT' ? ' Đã dừng do quét quá lâu, có thể còn bài cũ hơn chưa lấy.' : ''),
            6,
          );
        } else if (importedCount > 0) {
          message.success(`🎯 Quét xong ${items.length} bài thô! Đã tự động lọc bỏ ${importedCount} bài trùng & chọn đúng ${autoSelectedItems.length} bài MỚI chưa đăng.`);
        } else {
          message.success(`🎯 Đã quét thành công ${autoSelectedItems.length} bài viết MỚI từ "${res.data.groupName || 'Group'}"!`);
        }
      } else {
        message.error(res.data?.error || 'Không tìm thấy bài viết nào');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.error || err?.message || 'Lỗi khi quét Group / Fanpage Facebook');
    } finally {
      setGroupHunterLoading(false);
    }
  };

  const handleGeminiCurateGroupPosts = async () => {
    if (!groupHunterResults || groupHunterResults.length === 0) {
      message.warning('Chưa có bài viết nào để Gemini thẩm định!');
      return;
    }
    const geminiKey = getStoredGeminiKeys();
    setGroupHunterAiCurating(true);
    message.loading({
      content: '💎 Đang dùng Gemini AI thẩm định nội dung, chấm điểm chất lượng (1-100) và lọc bài rác...',
      key: 'gemini-curate-group',
      duration: 6,
    });
    try {
      const res = await api.post('/tools/gemini-curate-posts', {
        posts: groupHunterResults,
        topic: groupHunterGroupName || 'Nội dung chia sẻ group cộng đồng Facebook',
        apiKey: geminiKey || undefined,
      });

      if (res.data?.success && Array.isArray(res.data?.items)) {
        const curatedList = res.data.items;
        setGroupHunterResults(curatedList);
        const highQualityIds = curatedList
          .filter((p: any) => !p.isAlreadyImported && (p.aiScore || 0) >= 70 && !p.isSpam)
          .slice(0, groupHunterLimit)
          .map((p: any) => p.id);
        if (highQualityIds.length > 0) {
          setGroupHunterSelectedIds(new Set(highQualityIds));
        }
        message.success({
          content: `💎 Gemini đã thẩm định xong ${curatedList.length} bài! Đã gắn điểm chất lượng & lọc bỏ bài rác.`,
          key: 'gemini-curate-group',
        });
      } else {
        message.warning({
          content: res.data?.error || 'Gemini không trả về kết quả thẩm định.',
          key: 'gemini-curate-group',
        });
      }
    } catch (err: any) {
      message.error({
        content: err?.response?.data?.error || err?.message || 'Lỗi khi gọi Gemini thẩm định bài',
        key: 'gemini-curate-group',
      });
    } finally {
      setGroupHunterAiCurating(false);
    }
  };

  const handleApplyGroupHunterHook = (item: any) => {
    if (!item.suggestedHook) return;
    setGroupHunterResults((prev) =>
      prev.map((p) => {
        if (p.id === item.id) {
          const newCaption = cleanMarkdownAsterisks(`${item.suggestedHook}\n\n${p.caption}`);
          return {
            ...p,
            originalCaption: p.originalCaption || p.caption,
            caption: newCaption,
            aiRewritten: true,
          };
        }
        return p;
      })
    );
    message.success('🎣 Đã chèn Hook mở đầu của Gemini vào bài viết!');
  };

  const handleCleanSpamFromSelectedPosts = () => {
    const selected = filteredGroupHunterPosts.filter((it) => groupHunterSelectedIds.has(it.id));
    if (selected.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 bài viết để làm sạch!');
      return;
    }
    let cleanedCount = 0;
    setGroupHunterResults((prev) =>
      prev.map((item) => {
        if (!groupHunterSelectedIds.has(item.id)) return item;
        let text = item.caption || '';
        const original = text;
        // 1. Xoá link web / url / shopee / bit.ly / zalo...
        text = text.replace(/https?:\/\/[^\s]+/gi, '');
        // 2. Xoá số điện thoại / zalo / hotline
        text = text.replace(/(?:zalo|sđt|sdt|hotline|liên hệ|call|lh|tel)[\s:.-]*[0-9]{8,12}/gi, '');
        text = text.replace(/\b0[235789][0-9]{8}\b/g, '');
        // 3. Xoá số tài khoản ngân hàng donate
        text = text.replace(/(?:stk|số tài khoản|ngân hàng|mbbank|vietcombank|techcombank)[\s:.-]*[0-9]{6,16}/gi, '');
        // 4. Xoá lời kêu gọi vào group / tele / page cũ
        text = text.replace(/(?:vào group|link nhóm|nhóm thảo luận|tele(?:gram)?|theo dõi fanpage)[:\s]+[^\n]+/gi, '');
        // 5. Xoá dấu sao markdown (*, **) thô
        text = cleanMarkdownAsterisks(text);
        // 6. Chuẩn hoá dòng trống dư thừa
        text = text.replace(/\n{3,}/g, '\n\n').trim();
        if (text !== original) cleanedCount++;
        return {
          ...item,
          originalCaption: item.originalCaption || item.caption,
          caption: text,
        };
      })
    );
    message.success(`🧹 Đã làm sạch số điện thoại, link quảng cáo & STK cho ${selected.length} bài viết! (Đã bóc rác ở ${cleanedCount} bài)`);
  };

  const handleExecuteGroupHunterBatchAi = async () => {
    const selected = filteredGroupHunterPosts.filter((it) => groupHunterSelectedIds.has(it.id));
    if (selected.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 bài viết để AI viết lại!');
      return;
    }
    setGroupHunterBatchAiLoading(true);
    setGroupHunterBatchAiProgress({ current: 0, total: selected.length });
    const geminiKey = getStoredGeminiKeys();
    let updatedCount = 0;
    const newCaptionsMap = new Map<string, string>();

    for (let i = 0; i < selected.length; i++) {
      const p = selected[i];
      setGroupHunterBatchAiProgress({ current: i + 1, total: selected.length });
      if (!p.caption?.trim()) continue;

      try {
        const res = await api.post('/tools/gemini-rewrite', {
          content: p.caption,
          mode: groupHunterBatchAiMode,
          platform: 'FACEBOOK',
          apiKey: geminiKey || undefined,
        });
        if (res.data?.success && res.data?.rewritten) {
          newCaptionsMap.set(p.id, cleanMarkdownAsterisks(res.data.rewritten));
          updatedCount++;
        }
      } catch (e: any) {
        console.warn(`Lỗi rewrite bài ${p.id}:`, e);
      }
    }

    setGroupHunterResults((prev) =>
      prev.map((p) => {
        if (newCaptionsMap.has(p.id)) {
          return {
            ...p,
            originalCaption: p.originalCaption || p.caption,
            caption: newCaptionsMap.get(p.id)!,
            aiRewritten: true,
          };
        }
        return p;
      })
    );

    setGroupHunterBatchAiLoading(false);
    setGroupHunterBatchAiOpen(false);
    message.success(`🎉 Gemini đã xào xong ${updatedCount} bài viết theo phong cách chọn!`);
  };

  const filteredGroupHunterPosts = useMemo(() => {
    let list = [...groupHunterResults];
    if (groupHunterSkipImported) {
      list = list.filter((it) => !it.isAlreadyImported);
    }
    if (groupHunterAiOnlyQuality) {
      list = list.filter((it) => !it.aiCurated || ((it.aiScore || 0) >= 70 && !it.isSpam));
    }
    if (groupHunterMediaFilter === 'MEDIA_ONLY') {
      list = list.filter((it) => it.mediaCount > 0);
    } else if (groupHunterMediaFilter === 'IMAGE_ONLY') {
      list = list.filter((it) => it.mediaType === 'IMAGE');
    } else if (groupHunterMediaFilter === 'VIDEO_ONLY') {
      list = list.filter((it) => it.mediaType === 'VIDEO');
    }
    return list;
  }, [groupHunterResults, groupHunterMediaFilter, groupHunterSkipImported, groupHunterAiOnlyQuality]);

  const handleImportGroupHunterPosts = () => {
    const selected = filteredGroupHunterPosts.filter((it) => groupHunterSelectedIds.has(it.id));
    if (selected.length === 0) {
      message.warning('Chưa chọn bài viết nào để nhập!');
      return;
    }
    const linksText = selected.map((it) => it.url).join('\n');
    setBulkText((prev) => (prev ? `${prev}\n${linksText}` : linksText));

    // Nạp sẵn toàn bộ hình ảnh, video & caption đã cào được từ Group Hunter vào cache
    // để Drawer "Dán link hàng loạt" hiển thị ngay lập tức 0 giây, KHÔNG CẦN cào lại lần 2!
    setBulkDrawerPreviews((prev) => {
      const next = { ...prev };
      for (const item of selected) {
        const rawMedia = (item.images && item.images.length > 0)
          ? item.images
          : item.previewCover
            ? [item.previewCover]
            : [];
        const mediaKinds: Array<'video' | 'image'> = item.mediaType === 'VIDEO'
          ? ['video']
          : rawMedia.map(() => 'image');

        next[item.url] = {
          loading: false,
          caption: formatMultiLineCaption(item.caption || ''),
          author: item.author || '',
          mediaUrls: rawMedia,
          mediaKinds: mediaKinds,
          originalMediaUrls: [...rawMedia],
          originalMediaKinds: [...mediaKinds],
          videoCount: item.mediaType === 'VIDEO' ? 1 : 0,
          imageCount: item.mediaType === 'IMAGE' ? (item.mediaCount || rawMedia.length) : 0,
          watermarkRemoved: true,
        };
      }
      return next;
    });

    if (groupHunterAutoSchedule) {
      if (groupHunterScheduleMode === 'GOLDEN_HOURS') {
        // Tự động phân bổ vào các khung giờ vàng nhiều người xem nhất (Sáng 8h15, Trưa 12h, Chiều 18h10, Tối 20h45)
        const goldenHourDefs = [
          { h: 8, m: 15 },
          { h: 12, m: 0 },
          { h: 18, m: 10 },
          { h: 20, m: 45 },
        ];
        const assignedSlots: Dayjs[] = [];
        let curDay = dayjs().hour() >= 21 ? dayjs().add(1, 'day') : dayjs();

        for (let i = 0; i < selected.length; i++) {
          let found = false;
          while (!found) {
            for (const g of goldenHourDefs) {
              const jitterMinutes = Math.floor(Math.random() * 14) - 7; // Thêm độ lệch tự nhiên -7 đến +7 phút
              const candidate = curDay.hour(g.h).minute(g.m).add(jitterMinutes, 'minute').second(0);
              // Phải sau thời điểm hiện tại ít nhất 15 phút và cách các slot đã gán ít nhất 90 phút
              if (candidate.isAfter(dayjs().add(15, 'minute')) && !assignedSlots.some((s) => Math.abs(s.diff(candidate, 'minute')) < 90)) {
                assignedSlots.push(candidate);
                found = true;
                break;
              }
            }
            if (!found) {
              curDay = curDay.add(1, 'day');
            }
          }
        }

        // Lưu thời gian lên lịch chuẩn xác riêng cho từng URL
        setCustomDrawerScheduledTimes((prev) => {
          const next = { ...prev };
          selected.forEach((it, idx) => {
            if (assignedSlots[idx]) {
              next[it.url] = assignedSlots[idx];
            }
          });
          return next;
        });

        setBulkStartMode('TIME');
        if (assignedSlots[0]) {
          setBulkStartTime(assignedSlots[0]);
        }
      } else {
        setBulkStartMode('TIME');
        setBulkStartTime(dayjs().add(groupHunterInterval, 'minute'));
        setBulkInterval(groupHunterInterval);
      }
    }

    // Tự động khớp và chọn Nhóm đích tương ứng với Group vừa cào bài
    const rawTarget = (groupHunterTarget || '').trim();
    if (rawTarget && socialAccounts && groupHunterSourceType === 'GROUP') {
      const matchedAccount = (socialAccounts || []).find((a) =>
        a.platform === 'FACEBOOK_GROUP' &&
        (
          a.platformAccountId === rawTarget ||
          (rawTarget.includes(a.platformAccountId) && a.platformAccountId.length > 5) ||
          (a.pageName && groupHunterGroupName && a.pageName.toLowerCase().includes(groupHunterGroupName.toLowerCase())) ||
          (a.pageName && groupHunterGroupName && groupHunterGroupName.toLowerCase().includes(a.pageName.toLowerCase()))
        )
      );
      if (matchedAccount) {
        setSmartGroupId(matchedAccount.platformAccountId);
        form.setFieldValue('targetGroupId', matchedAccount.platformAccountId);
        form.setFieldValue('groupNames', [matchedAccount.platformAccountId]);
      }
    }

    setGroupHunterDrawerVisible(false);
    setBulkModalVisible(true);
    message.success(
      `🚀 Đã chuyển ${selected.length} bài viết vào danh sách đăng! ${
        groupHunterAutoSchedule
          ? groupHunterScheduleMode === 'GOLDEN_HOURS'
            ? '🌟 Đã kích hoạt rải lịch tự động theo các Khung Giờ Vàng (sáng, trưa, tối)!'
            : `Đã kích hoạt rải lịch tự động mỗi ${groupHunterInterval} phút!`
          : ''
      }`
    );
  };

  const handleImportAndSwipeGroupHunterPosts = () => {
    const selected = filteredGroupHunterPosts.filter((it) => groupHunterSelectedIds.has(it.id));
    if (selected.length === 0) {
      message.warning('Chưa chọn bài viết nào để duyệt!');
      return;
    }

    // Tính slot hẹn giờ (nếu bật tự động lên lịch)
    const assignedSlots: Dayjs[] = [];
    if (groupHunterAutoSchedule) {
      if (groupHunterScheduleMode === 'GOLDEN_HOURS') {
        const goldenHourDefs = [
          { h: 8, m: 15 },
          { h: 12, m: 0 },
          { h: 18, m: 10 },
          { h: 20, m: 45 },
        ];
        let curDay = dayjs().hour() >= 21 ? dayjs().add(1, 'day') : dayjs();
        for (let i = 0; i < selected.length; i++) {
          let found = false;
          while (!found) {
            for (const g of goldenHourDefs) {
              const jitterMinutes = Math.floor(Math.random() * 14) - 7;
              const candidate = curDay.hour(g.h).minute(g.m).add(jitterMinutes, 'minute').second(0);
              if (candidate.isAfter(dayjs().add(15, 'minute')) && !assignedSlots.some((s) => Math.abs(s.diff(candidate, 'minute')) < 90)) {
                assignedSlots.push(candidate);
                found = true;
                break;
              }
            }
            if (!found) curDay = curDay.add(1, 'day');
          }
        }
      } else {
        const interval = groupHunterInterval || 60;
        const start = dayjs().add(interval, 'minute');
        for (let i = 0; i < selected.length; i++) {
          assignedSlots.push(start.add(i * interval, 'minute'));
        }
      }
    }

    // Tạo trực tiếp linkItems
    const newItems: PostLinkItem[] = selected.map((it, idx) => ({
      id: Math.random().toString(36).substring(2, 9),
      url: it.url,
      isNow: !groupHunterAutoSchedule,
      scheduledAt: assignedSlots[idx] || dayjs().add((idx + 1) * 10, 'minute'),
      includeCredit: true,
      skipComment: false,
      affiliateLink: '',
      customCaption: formatMultiLineCaption(it.caption || ''),
    }));

    // Tạo previews đầy đủ cho Tinder modal xem ảnh / video
    const newPreviews: Record<string, {
      loading: boolean;
      caption?: string;
      author?: string;
      mediaUrls?: string[];
      mediaKinds?: Array<'video' | 'image'>;
      originalMediaUrls?: string[];
      originalMediaKinds?: Array<'video' | 'image'>;
      videoCount?: number;
      imageCount?: number;
      watermarkRemoved?: boolean;
    }> = {};

    newItems.forEach((item, idx) => {
      const post = selected[idx];
      const rawMedia = (post.images && post.images.length > 0)
        ? post.images
        : post.previewCover
          ? [post.previewCover]
          : [];
      const mediaKinds: Array<'video' | 'image'> = post.mediaType === 'VIDEO'
        ? ['video']
        : rawMedia.map(() => 'image');

      newPreviews[item.id] = {
        loading: false,
        caption: formatMultiLineCaption(post.caption || ''),
        author: post.author || '',
        mediaUrls: rawMedia,
        mediaKinds: mediaKinds,
        originalMediaUrls: [...rawMedia],
        originalMediaKinds: [...mediaKinds],
        videoCount: post.mediaType === 'VIDEO' ? 1 : 0,
        imageCount: post.mediaType === 'IMAGE' ? (post.mediaCount || rawMedia.length) : 0,
        watermarkRemoved: true,
      };
    });

    // Cập nhật Nhóm đích tương ứng nếu có
    const rawTarget = (groupHunterTarget || '').trim();
    if (rawTarget && socialAccounts && groupHunterSourceType === 'GROUP') {
      const matchedAccount = (socialAccounts || []).find((a) =>
        a.platform === 'FACEBOOK_GROUP' &&
        (
          a.platformAccountId === rawTarget ||
          (rawTarget.includes(a.platformAccountId) && a.platformAccountId.length > 5) ||
          (a.pageName && groupHunterGroupName && a.pageName.toLowerCase().includes(groupHunterGroupName.toLowerCase())) ||
          (a.pageName && groupHunterGroupName && groupHunterGroupName.toLowerCase().includes(a.pageName.toLowerCase()))
        )
      );
      if (matchedAccount) {
        setSmartGroupId(matchedAccount.platformAccountId);
        form.setFieldValue('targetGroupId', matchedAccount.platformAccountId);
        form.setFieldValue('groupNames', [matchedAccount.platformAccountId]);
      }
    }

    setPreviews((prev) => ({ ...prev, ...newPreviews }));
    setLinkItems(newItems);

    setGroupHunterDrawerVisible(false);
    setSwipeReviewIndex(0);
    setSwipeMediaIndex(0);
    setSwipeDecisions({});
    setSwipeReviewOpen(true);
  };

  const validLinkCount = linkItems.filter((item) => {
    const hasUrl = !!item.url && item.url.trim().length > 0;
    const hasContent = (!!item.manualContent && item.manualContent.trim().length > 0) || (!!item.customCaption && item.customCaption.trim().length > 0);
    const hasMedia = (item.manualMediaUrls?.length || 0) > 0;
    return hasUrl || hasContent || hasMedia;
  }).length;

  // Bộ lọc bảng Lịch sử (Nhóm, Page đăng, Trạng thái, Từ khóa)
  const [historyGroupFilter, setHistoryGroupFilter] = useState<string>('ALL');
  const [historyPageFilter, setHistoryPageFilter] = useState<string>('ALL');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('ALL');
  const [historySearchText, setHistorySearchText] = useState<string>('');
  const [historyOpen, setHistoryOpen] = useState(true);
  const [kpiExpanded, setKpiExpanded] = useState(false);
  // Trang chia 2 tab: Soạn bài / Hàng đợi & lịch sử. Nhớ tab lần cuối vì người dùng hay quay lại để kiểm tra.
  const [workspaceTab, setWorkspaceTab] = useState<'compose' | 'history'>(() =>
    localStorage.getItem('poster_workspace_tab') === 'history' ? 'history' : 'compose');
  const switchWorkspaceTab = (tab: 'compose' | 'history') => {
    setWorkspaceTab(tab);
    localStorage.setItem('poster_workspace_tab', tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  // Mở thẳng tab Hàng đợi khi đi từ ô "Hàng đợi" trên thanh trên cùng (?tab=history)
  useEffect(() => {
    if (searchParams.get('tab') === 'history') {
      setWorkspaceTab('history');
      localStorage.setItem('poster_workspace_tab', 'history');
      const next = new URLSearchParams(searchParams);
      next.delete('tab');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Tự động nhận link từ Săn Bài Viral Group khi chuyển sang
  useEffect(() => {
    try {
      const prefill = localStorage.getItem('toolzutter_prefill_playwright_urls');
      if (prefill) {
        localStorage.removeItem('toolzutter_prefill_playwright_urls');
        setBulkText((prev) => (prev ? `${prev}\n${prefill}` : prefill));
        setBulkModalVisible(true);
        message.success('🎯 Đã nhận danh sách bài từ Săn Bài Viral! Mời bạn kiểm tra và hẹn giờ đăng.');
      }
    } catch {}
  }, []);
  const openHistoryWithFilter = (status: string) => {
    setHistoryStatusFilter(status);
    setHistoryOpen(true);
    switchWorkspaceTab('history');
  };

  // Modal cập nhật cookie nhanh
  const [quickCookieModalOpen, setQuickCookieModalOpen] = useState(false);
  const [quickCookieTargetId, setQuickCookieTargetId] = useState<number | undefined>(undefined);

  // Fetch danh sách kết nối Fanpage / Group Playwright
  const { data: socialAccounts } = useQuery({
    queryKey: ['socialAccounts'],
    queryFn: async () => {
      const response = await api.get('/connections');
      return response.data as SocialAccount[];
    }
  });

  // Danh sách các nhóm nguồn Facebook lưu thủ công + lấy từ DB (CRAWL_SOURCE) để quét bài viết
  // TUYỆT ĐỐI KHÔNG lấy các nhóm FACEBOOK_GROUP thuộc socialAccounts vì đó là KÊNH XUẤT BẢN ĐÍCH của người dùng!
  const allFavoriteGroups = useMemo(() => {
    const list: Array<{ name: string; url: string; isConnected?: boolean; category: 'PHIM' | 'GENERAL' }> = [];
    const seenUrls = new Set<string>();

    const normalizeUrl = (u: string) => {
      let clean = (u || '').trim();
      if (!clean.startsWith('http')) {
        clean = `https://www.facebook.com/groups/${clean.replace(/^groups\//, '')}`;
      }
      return clean.replace(/\/$/, '');
    };

    // Tập hợp ID và Tên các Group XUẤT BẢN của người dùng (kênh đích, KHÔNG phải nguồn cào)
    const myDestinationGroupIds = new Set<string>();
    const myDestinationGroupNames = new Set<string>();
    (socialAccounts || []).forEach((a) => {
      if (a.accountType !== 'CRAWL_SOURCE') {
        if (a.platformAccountId) myDestinationGroupIds.add(a.platformAccountId.trim());
        if (a.pageName) myDestinationGroupNames.add(a.pageName.trim().toLowerCase());
        if (a.accessToken && a.accessToken.startsWith('http')) {
          myDestinationGroupIds.add(normalizeUrl(a.accessToken));
        }
      }
    });

    const isUserDestinationGroup = (name: string, url: string) => {
      const lowerName = (name || '').trim().toLowerCase();
      if (myDestinationGroupNames.has(lowerName)) return true;
      for (const gid of myDestinationGroupIds) {
        if (gid && (url.includes(gid) || gid === url)) return true;
      }
      return false;
    };

    const removedSet = new Set((removedFavoriteUrls || []).map((u) => normalizeUrl(u)));

    // 1. Nhóm từ localStorage lưu trữ của người dùng (chỉ nhận nhóm cào nguồn thật, không phải kênh xuất bản)
    (favoriteGroups || []).forEach((g) => {
      const norm = normalizeUrl(g.url);
      if (norm && !seenUrls.has(norm) && !removedSet.has(norm) && !isUserDestinationGroup(g.name, norm)) {
        seenUrls.add(norm);
        const isMovie = /phim|cinema|movie|cartoon|netflix/i.test(`${g.name} ${norm}`);
        list.push({ name: g.name, url: norm, isConnected: false, category: isMovie ? 'PHIM' : 'GENERAL' });
      }
    });

    // 2. Chỉ nhận nhóm được đánh dấu rõ ràng là CRAWL_SOURCE (nguồn cào bài), BỎ QUA toàn bộ FACEBOOK_GROUP đích
    (socialAccounts || []).forEach((a) => {
      if (a.accountType === 'CRAWL_SOURCE') {
        const rawUrl = a.accessToken && a.accessToken.startsWith('http')
          ? a.accessToken
          : a.platformAccountId
            ? `https://www.facebook.com/groups/${a.platformAccountId}`
            : '';
        const norm = normalizeUrl(rawUrl);
        if (norm && !seenUrls.has(norm) && !removedSet.has(norm) && !isUserDestinationGroup(a.pageName || '', norm)) {
          seenUrls.add(norm);
          const isMovie = /phim|cinema|movie|cartoon|netflix/i.test(`${a.pageName || ''} ${norm}`);
          list.push({
            name: a.pageName || 'Facebook Group',
            url: norm,
            isConnected: true,
            category: isMovie ? 'PHIM' : 'GENERAL',
          });
        }
      }
    });

    // 3. Đảm bảo toàn bộ 8 nhóm Phim & Điện ảnh hot luôn luôn hiển thị (nếu chưa bị xóa)
    const PRESET_MOVIE_GROUPS = [
      { name: '[🎬 Phim] Khen Phim Hay - Chê Phim Dở', url: 'https://www.facebook.com/groups/chikhenphimhay' },
      { name: '[🎬 Phim] Xem phim gì? Xem với!', url: 'https://www.facebook.com/groups/xemphimgixemvoi' },
      { name: '[🎬 Phim] Netflix Việt Nam Group', url: 'https://www.facebook.com/groups/898364887623372' },
      { name: '[🎬 Phim] W2W - Cộng Đồng Cartoon Việt Nam', url: 'https://www.facebook.com/groups/w2wcartoon' },
      { name: '[🎬 Phim] Khen Phim - Review phim chiếu rạp', url: 'https://www.facebook.com/groups/khenphim' },
      { name: '[🎬 Phim] Hội Mê Phim Chiếu Rạp', url: 'https://www.facebook.com/groups/170281847022614' },
      { name: '[🎬 Phim] Diễn Đàn Rạp Chiếu Phim Việt Nam', url: 'https://www.facebook.com/groups/VietnamCinemas' },
      { name: '[🎬 Phim] Cinema Sài Gòn', url: 'https://www.facebook.com/groups/247792223017151' },
    ];
    PRESET_MOVIE_GROUPS.forEach((mg) => {
      const norm = normalizeUrl(mg.url);
      if (!seenUrls.has(norm) && !removedSet.has(norm) && !isUserDestinationGroup(mg.name, norm)) {
        seenUrls.add(norm);
        list.push({ name: mg.name, url: norm, isConnected: true, category: 'PHIM' });
      }
    });

    return list;
  }, [favoriteGroups, socialAccounts, removedFavoriteUrls]);

  const filteredFavoriteGroups = useMemo(() => {
    let list = allFavoriteGroups;
    if (favoriteGroupCategoryFilter !== 'ALL') {
      list = list.filter((g) => g.category === favoriteGroupCategoryFilter);
    }
    const keyword = favoriteGroupSearch.trim().toLocaleLowerCase('vi');
    if (!keyword) return list;
    return list.filter((group) =>
      `${group.name} ${group.url}`.toLocaleLowerCase('vi').includes(keyword)
    );
  }, [allFavoriteGroups, favoriteGroupSearch, favoriteGroupCategoryFilter]);

  const visibleFavoriteGroups = favoriteGroupsExpanded || favoriteGroupSearch.trim() || favoriteGroupCategoryFilter === 'PHIM'
    ? filteredFavoriteGroups
    : filteredFavoriteGroups.slice(0, 10);

  // Danh sách Fanpage cho modal đặt KPI — gộp các kết nối trùng platformAccountId (VD "Làm Sen" có
  // 2 cookie id=3 và id=7) về 1 dòng duy nhất (giữ kết nối mới nhất), tránh hiện 1 trang 2 lần khiến
  // đặt KPI nhầm 1 trong 2 dòng còn dòng kia thì không, gây đếm KPI như đang thiếu dù đã đăng đủ.
  const kpiFanpageAccounts = Array.from(
    (socialAccounts || [])
      .filter((a) => a.platform === 'FACEBOOK_PAGE')
      .reduce((latestByPageId, account) => {
        const current = latestByPageId.get(account.platformAccountId);
        if (!current || account.id > current.id) latestByPageId.set(account.platformAccountId, account);
        return latestByPageId;
      }, new Map<string, SocialAccount>())
      .values()
  );
  const kpiGroupAccounts = (socialAccounts || []).filter((a) => a.platform === 'FACEBOOK_GROUP');

  // KPI hôm nay cho từng Fanpage/Group (đặt ở trang Lịch đăng bài) — hiển thị nhanh ngay tại đây vì
  // đây là trang thao tác đăng bài chính, không cần chuyển trang mới xem được tiến độ.
  const todayDate = dayjs().format('YYYY-MM-DD');
  const { data: todayTargets = [] } = useQuery({
    queryKey: ['postTargets', 'today', todayDate],
    queryFn: async () => (await api.get('/post-targets', { params: { from: todayDate, to: todayDate } })).data?.items as PostTargetItem[] || [],
    refetchInterval: 60000,
  });

  // Fanpage mặc định để đăng vào từng Group (dùng khi bài không chỉ định rõ Fanpage) — lấy trực tiếp
  // từ danh sách kết nối đã tải sẵn, không cần gọi API riêng.
  const groupIdentityMap = new Map(
    kpiGroupAccounts
      .filter((g) => g.postingIdentityAccountId)
      .map((g) => [g.id, (socialAccounts || []).find((a) => a.id === g.postingIdentityAccountId) || null])
  );

  // Chọn Fanpage mặc định để đăng vào 1 Group cụ thể — lưu thành thuộc tính của Group (áp dụng mọi ngày)
  const setGroupIdentityMutation = useMutation({
    mutationFn: async ({ groupId, fanpageConnectionId }: { groupId: number; fanpageConnectionId: number | null }) =>
      (await api.put(`/connections/${groupId}`, { postingIdentityAccountId: fanpageConnectionId ?? 0 })).data,
    onSuccess: () => {
      message.success('Đã lưu Fanpage mặc định cho Group này');
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Lỗi khi lưu Fanpage mặc định'),
  });

  // Áp dụng nhanh 1 Fanpage mặc định cho TẤT CẢ Group cùng lúc — đỡ phải chọn từng dòng khi có nhiều Group
  const [bulkGroupFanpageId, setBulkGroupFanpageId] = useState<number | undefined>(undefined);
  const [bulkGroupApplying, setBulkGroupApplying] = useState(false);
  const applyBulkGroupIdentity = async () => {
    if (!bulkGroupFanpageId || kpiGroupAccounts.length === 0) return;
    setBulkGroupApplying(true);
    try {
      await Promise.all(kpiGroupAccounts.map((g) =>
        api.put(`/connections/${g.id}`, { postingIdentityAccountId: bulkGroupFanpageId })
      ));
      message.success(`Đã áp dụng cho ${kpiGroupAccounts.length} Group`);
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Lỗi khi áp dụng hàng loạt');
    } finally {
      setBulkGroupApplying(false);
    }
  };

  // Modal đặt/sửa KPI hôm nay ngay tại trang này (không cần qua Lịch đăng bài)
  const [kpiModalOpen, setKpiModalOpen] = useState(false);
  const [kpiDrafts, setKpiDrafts] = useState<Record<number, number | null>>({});

  const openKpiModal = () => {
    const drafts: Record<number, number | null> = {};
    for (const t of todayTargets) drafts[t.socialAccountId] = t.targetCount;
    for (const a of [...kpiFanpageAccounts, ...kpiGroupAccounts]) {
      if (drafts[a.id] === undefined || drafts[a.id] === null) {
        drafts[a.id] = 10;
      }
    }
    setKpiDrafts(drafts);
    setKpiModalOpen(true);
  };

  const setTargetMutation = useMutation({
    mutationFn: async ({ socialAccountId, targetCount }: { socialAccountId: number; targetCount: number | null }) =>
      (await api.put('/post-targets', { socialAccountId, date: todayDate, targetCount })).data,
    onError: (err: any) => message.error(err?.response?.data?.message || 'Lỗi khi lưu KPI'),
  });

  const handleSaveKpi = async () => {
    const existingBySocialAccount = new Map(todayTargets.map((t) => [t.socialAccountId, t.targetCount]));
    const changed = Object.entries(kpiDrafts).filter(([socialAccountId, value]) => {
      const prev = existingBySocialAccount.get(Number(socialAccountId)) ?? null;
      return (value ?? null) !== prev;
    });
    if (changed.length === 0) {
      setKpiModalOpen(false);
      return;
    }
    try {
      await Promise.all(changed.map(([socialAccountId, value]) =>
        setTargetMutation.mutateAsync({ socialAccountId: Number(socialAccountId), targetCount: value })
      ));
      message.success('🎯 Đã lưu KPI hôm nay!');
      queryClient.invalidateQueries({ queryKey: ['postTargets'] });
      setKpiModalOpen(false);
    } catch {
      // message lỗi đã được hiển thị bởi onError của mutation
    }
  };

  const playwrightAccounts = Array.from(
    (socialAccounts || [])
      .filter((a) => a.platform === 'FACEBOOK_PAGE' && (a.accountType === 'PERSONAL_COOKIE' || !a.accountType))
      .reduce((latestByPage, account) => {
        const normKey = (account.pageName || account.platformAccountId).trim().toLowerCase();
        const current = latestByPage.get(normKey);
        // Ưu tiên tài khoản còn hạn cookie (OK), hoặc ID mới hơn
        if (!current) {
          latestByPage.set(normKey, account);
        } else if (current.tokenStatus === 'EXPIRED' && account.tokenStatus !== 'EXPIRED') {
          latestByPage.set(normKey, account);
        } else if (account.id > current.id && !(current.tokenStatus !== 'EXPIRED' && account.tokenStatus === 'EXPIRED')) {
          latestByPage.set(normKey, account);
        }
        return latestByPage;
      }, new Map<string, SocialAccount>())
      .values()
  ).sort((a, b) => (a.pageName || '').localeCompare(b.pageName || '', 'vi'));

  // Danh sách các Via / Nick cá nhân có cookie (Thành An, Huỳnh Thạnh Phú, ...)
  const personalAccountTargets: SocialAccount[] = useMemo(() => {
    const list: SocialAccount[] = [];
    const seenIds = new Set<number>();
    const seenCUsers = new Set<string>();

    // 1. Ưu tiên các tài khoản profile / via cá nhân rõ ràng (FACEBOOK_PROFILE, PERSONAL_PROFILE_COOKIE)
    const personalProfiles = (socialAccounts || []).filter(
      (a) => (a.platform === 'FACEBOOK_PROFILE' || a.platform === 'FACEBOOK_PERSONAL' || a.accountType === 'PERSONAL_PROFILE_COOKIE') && a.accessToken
    );

    personalProfiles.forEach((acc) => {
      seenIds.add(acc.id);
      const cUserMatch = acc.accessToken?.match(/c_user=(\d+)/);
      if (cUserMatch) seenCUsers.add(cUserMatch[1]);
      list.push({
        ...acc,
        platform: 'FACEBOOK_PERSONAL',
        platformAccountId: 'PERSONAL_PROFILE',
        pageName: `👤 Nick Cá Nhân (${acc.pageName || acc.platformAccountId})`,
        accountType: acc.accountType || 'PERSONAL_PROFILE_COOKIE',
        tokenStatus: acc.tokenStatus || 'OK',
      });
    });

    // 2. Bổ sung các cookie cá nhân khác (nếu có cookie độc lập chưa nằm trong profile)
    (socialAccounts || []).forEach((acc) => {
      if (seenIds.has(acc.id) || !acc.accessToken) return;
      const cUserMatch = acc.accessToken.match(/c_user=(\d+)/);
      if (!cUserMatch) return;
      const cUser = cUserMatch[1];
      if (seenCUsers.has(cUser)) return;
      if (acc.accountType === 'PERSONAL_COOKIE' || !acc.accountType) {
        seenIds.add(acc.id);
        seenCUsers.add(cUser);
        list.push({
          ...acc,
          platform: 'FACEBOOK_PERSONAL',
          platformAccountId: 'PERSONAL_PROFILE',
          pageName: `👤 Nick Cá Nhân (${acc.pageName || cUser})`,
          accountType: acc.accountType || 'PERSONAL_COOKIE',
          tokenStatus: acc.tokenStatus || 'OK',
        });
      }
    });

    return list;
  }, [socialAccounts]);

  const postingIdentities = useMemo(() => {
    return [...playwrightAccounts, ...personalAccountTargets];
  }, [playwrightAccounts, personalAccountTargets]);

  const accountTargetValue = (account: SocialAccount) =>
    `${account.platformAccountId}:${account.accountType || 'PERSONAL_COOKIE'}:${account.id}`;

  // Tên via (nick cá nhân) quản lý Fanpage — để phân biệt các page trùng tên (vd. 2 page "Làm Gì Mà Gấp" ở 2 via khác nhau)
  const viaNameByCUser = useMemo(() => {
    const map = new Map<string, string>();
    personalAccountTargets.forEach((acc) => {
      const cUser = acc.accessToken?.match(/c_user=(\d+)/)?.[1];
      const name = (socialAccounts || []).find((a) => a.id === acc.id)?.pageName;
      if (cUser && name && !map.has(cUser)) map.set(cUser, name);
    });
    return map;
  }, [personalAccountTargets, socialAccounts]);

  const viaNameOf = (account: SocialAccount): string | undefined => {
    if (account.platform !== 'FACEBOOK_PAGE') return undefined;
    if (account.postingIdentityAccountId) {
      const via = (socialAccounts || []).find((a) => a.id === account.postingIdentityAccountId);
      if (via?.pageName) return via.pageName;
    }
    const cUser = account.accessToken?.match(/c_user=(\d+)/)?.[1];
    return cUser ? viaNameByCUser.get(cUser) : undefined;
  };

  const accountSearchLabel = (account: SocialAccount) =>
    [account.pageName || account.platformAccountId, viaNameOf(account)].filter(Boolean).join(' ');

  // Bản đồ các Via cùng quản lý một Fanpage (Co-admin Multi-Via)
  const coAdminViasByPageName = useMemo(() => {
    const map = new Map<string, string[]>();
    (socialAccounts || [])
      .filter((a) => a.platform === 'FACEBOOK_PAGE')
      .forEach((acc) => {
        const name = (acc.pageName || acc.platformAccountId).trim().toLowerCase();
        const via = viaNameOf(acc);
        if (via) {
          const list = map.get(name) || [];
          if (!list.includes(via)) list.push(via);
          map.set(name, list);
        }
      });
    return map;
  }, [socialAccounts, viaNameByCUser]);

  const groupAccounts = (socialAccounts || []).filter(
    (a) => a.platform === 'FACEBOOK_GROUP' && a.accountType !== 'CRAWL_SOURCE' && !a.pageName?.includes('[🎬 Phim]')
  );
  const groupAccountsWithId = groupAccounts.filter((g) => g.platformAccountId && g.platformAccountId.trim().length > 0);

  const activeScrapeAccount = useMemo(() => {
    return (socialAccounts || []).find((a) => a.pageName?.toLowerCase().includes('làm sen') && a.accessToken)
      || (socialAccounts || []).find((a) => a.accessToken && a.accessToken.trim().length > 0 && a.tokenStatus === 'OK')
      || (socialAccounts || []).find((a) => a.accessToken && a.accessToken.trim().length > 0);
  }, [socialAccounts]);

  // targetGroupNames lưu ID Nhóm (đôi khi là tên cũ cho bản ghi cũ) cách nhau bởi dấu phẩy — quy đổi
  // ngược lại thành tên Nhóm dễ đọc dựa trên danh sách kết nối, để lịch sử biết đăng vào Nhóm nào.
  const resolveGroupNames = (rawGroupNames?: string | string[]) => {
    let ids: string[] = [];
    if (Array.isArray(rawGroupNames)) {
      ids = rawGroupNames.map((v) => String(v).trim()).filter(Boolean);
    } else if (rawGroupNames) {
      ids = String(rawGroupNames).split(',').map((v) => v.trim()).filter(Boolean);
    }
    return ids.map((id) => {
      const matched = groupAccountsWithId.find((g) => g.platformAccountId === id);
      return matched ? (stripEmojiPrefix(matched.pageName) || id) : id;
    });
  };

  const resolvePosterIdentityName = useCallback((record: PostQueue): string | null => {
    const isAnon = record.targetGroupNames?.startsWith('GROUP_ONLY_ANON:') || record.targetFanpageId === 'PERSONAL_PROFILE';

    if (record.targetFanpageId) {
      const raw = record.targetFanpageId.trim();
      const parts = raw.split(':');

      if (parts.length >= 3) {
        const dbId = parts[2].trim();
        const platformId = parts[0].trim();
        const matched = (socialAccounts || []).find(
          (a) => String(a.id) === dbId || a.platformAccountId === platformId
        );
        if (matched?.pageName) {
          return isAnon ? `👤 ${matched.pageName} (Ẩn danh)` : matched.pageName;
        }
      }

      if (parts.length === 2) {
        const part1 = parts[1].trim();
        if (part1 && part1 !== 'PERSONAL_COOKIE' && part1 !== 'PAGE_TOKEN') {
          return isAnon ? `👤 ${part1} (Ẩn danh)` : part1;
        }
        const platformId = parts[0].trim();
        const matched = (socialAccounts || []).find(
          (a) => a.platformAccountId === platformId || String(a.id) === platformId
        );
        if (matched?.pageName) {
          return isAnon ? `👤 ${matched.pageName} (Ẩn danh)` : matched.pageName;
        }
      }

      const matched = (socialAccounts || []).find(
        (a) => String(a.id) === raw || a.platformAccountId === raw || a.platformAccountId === parts[0]
      );
      if (matched?.pageName) {
        return isAnon ? `👤 ${matched.pageName} (Ẩn danh)` : matched.pageName;
      }
    }

    if (isAnon) {
      return '👤 Nick cá nhân (Ẩn danh)';
    }

    if (record.targetGroupNames && (socialAccounts || []).length > 0) {
      const isGroupOnly = record.targetGroupNames.startsWith('GROUP_ONLY:') || record.targetGroupNames.startsWith('GROUP_ONLY_ANON:');
      const rawGroupNames = record.targetGroupNames.replace(/^GROUP_ONLY_ANON:|^GROUP_ONLY:/, '');
      const firstGroupIdOrName = rawGroupNames.split(',')[0]?.trim();

      if (firstGroupIdOrName) {
        const groupAccount = (socialAccounts || []).find(
          (a) => a.platform === 'FACEBOOK_GROUP' &&
            (a.platformAccountId === firstGroupIdOrName ||
              a.pageName?.toLowerCase() === firstGroupIdOrName.toLowerCase() ||
              String(a.id) === firstGroupIdOrName)
        );
        if (groupAccount?.postingIdentityAccountId) {
          const identityAccount = (socialAccounts || []).find((a) => a.id === groupAccount.postingIdentityAccountId);
          if (identityAccount?.pageName) return identityAccount.pageName;
        }
      }
    }

    const defaultPage = (socialAccounts || []).find((a) => a.platform === 'FACEBOOK_PAGE');
    if (defaultPage?.pageName) return defaultPage.pageName;

    return null;
  }, [socialAccounts]);

  // Theo dõi Nhóm đang được chọn trong Form để hiển thị RÕ RÀNG trước khi đăng — tránh lặp lại lỗi
  // "set đăng nhóm A nhưng hệ thống đăng nhầm nhóm B" do Select giữ nguyên giá trị của lần đăng
  // TRƯỚC ĐÓ (không tự reset sau khi submit) mà người dùng quên đổi lại trước khi dán link mới.
  const watchedTargetGroupId = Form.useWatch('targetGroupId', form);
  const watchedGroupNamesField = Form.useWatch('groupNames', form);
  const watchedTargetFanpageId = Form.useWatch('targetFanpageId', form);

  const selectedTargetAccountNames = useMemo(() => {
    if (!watchedTargetFanpageId) return [];
    const vals = Array.isArray(watchedTargetFanpageId) ? watchedTargetFanpageId : [watchedTargetFanpageId];
    return vals.map((v) => {
      const matched = postingIdentities.find((a) => accountTargetValue(a) === v);
      return matched ? (matched.pageName || matched.platformAccountId) : v;
    }).filter(Boolean);
  }, [watchedTargetFanpageId, postingIdentities]);

  const selectedTargetAccount = useMemo(() => {
    if (!watchedTargetFanpageId) return null;
    const primary = Array.isArray(watchedTargetFanpageId) ? watchedTargetFanpageId[0] : watchedTargetFanpageId;
    return postingIdentities.find((a) => accountTargetValue(a) === primary) || null;
  }, [watchedTargetFanpageId, postingIdentities]);

  const isCurrentTargetExpired = selectedTargetAccount?.tokenStatus === 'EXPIRED';

  // Bình luận mặc định dùng cho khung xem trước Status nền đỏ — cùng thứ tự ưu tiên với lúc gửi bài (effectiveDefaultComment).
  const watchedDefaultComment = Form.useWatch('affiliateLink', form);
  const defaultCommentPreview = (watchedDefaultComment || '').trim()
    || (localStorage.getItem(STORAGE_KEY_COMMENT) || DEFAULT_SAVED_COMMENT).trim();
  const previewAuthorName = String(selectedTargetAccountNames[0] || 'Fanpage');

  const selectedGroupDisplayNames = postMode === 'GROUP_ONLY'
    ? resolveGroupNames(watchedTargetGroupId)
    : resolveGroupNames(Array.isArray(watchedGroupNamesField) ? watchedGroupNamesField.join(',') : '');

  const hasMultipleGroupsSelected = useMemo(() => {
    if (postMode === 'FANPAGE_AND_GROUP') {
      return Array.isArray(watchedGroupNamesField) && watchedGroupNamesField.length > 1;
    }
    if (postMode === 'GROUP_ONLY') {
      if (Array.isArray(watchedTargetGroupId)) {
        return watchedTargetGroupId.length > 1;
      }
      return false;
    }
    return false;
  }, [postMode, watchedGroupNamesField, watchedTargetGroupId]);

  // Kiểm tra nhóm "Hội những người tin mình sắp giàu" để áp dụng quy tắc chặn link Shopee
  const isSapGiauGroup = useCallback((groupId?: string | string[], groupNames?: string[]) => {
    const checkStr = (str: string) => /tin\s*m[iìí]nh\s*s[aắ]p\s*gi[aà]u/i.test(str);
    if (groupId) {
      const groupIds = Array.isArray(groupId) ? groupId : [groupId];
      for (const id of groupIds) {
        const matched = groupAccountsWithId.find((g) => g.platformAccountId === id);
        if (matched && checkStr(matched.pageName || '')) return true;
      }
    }
    if (groupNames && groupNames.some((g) => checkStr(g))) return true;
    return false;
  }, [groupAccountsWithId]);

  // Cho phép người dùng tự chỉ định TỪ ĐẦU nhóm nào để link Affiliate (Shopee...), nhóm nào không.
  const [affiliateExcludedGroupIds, setAffiliateExcludedGroupIds] = useState<string[]>([]);

  // Danh sách nhóm đang được chọn ở bước hiện tại (tuỳ theo postMode dùng field targetGroupId hoặc groupNames)
  const currentSelectedGroupIdsForAffiliate = useMemo<string[]>(() => {
    const raw = postMode === 'GROUP_ONLY' ? watchedTargetGroupId : watchedGroupNamesField;
    return Array.isArray(raw) ? raw.filter(Boolean) : (raw ? [String(raw)] : []);
  }, [postMode, watchedTargetGroupId, watchedGroupNamesField]);

  // Quyết định link Affiliate cuối cùng cho 1 nhóm cụ thể: giữ quy tắc chặn cứng nhóm "sắp giàu",
  // cộng thêm danh sách nhóm người dùng tự loại trừ qua ô chọn "Nhóm KHÔNG gắn link Affiliate".
  const resolveAffiliateLinkForGroup = useCallback((gId: string, baseAffLink: string) => {
    if (!baseAffLink) return baseAffLink;
    if (isSapGiauGroup(gId) && /shopee|shp\.ee|shope\.ee|affiliate/i.test(baseAffLink)) return '';
    if (affiliateExcludedGroupIds.includes(gId)) return '';
    return baseAffLink;
  }, [isSapGiauGroup, affiliateExcludedGroupIds]);

  // Cho phép chỉ định ĐÍCH DANH các Nhóm nào được phép bình luận Affiliate (khi bài đăng cùng lúc
  // vào nhiều Nhóm) — bỏ trống = không giới hạn, áp dụng cho mọi Nhóm đã chọn (vẫn tuỳ theo checkbox
  // "Bình luận trong Nhóm" bật/tắt riêng của từng bài).
  const [groupCommentAllowedGroupIds, setGroupCommentAllowedGroupIds] = useState<string[]>([]);
  const isGroupCommentAllowedForGroup = useCallback(
    (gId: string) => groupCommentAllowedGroupIds.length === 0 || groupCommentAllowedGroupIds.includes(gId),
    [groupCommentAllowedGroupIds]
  );

  // --- Smart Multi-Channel & Multi-Group Distribution State ---
  const [isMultiDistributeActive, setIsMultiDistributeActive] = useState<boolean>(false);
  const [multiSelectedTargets, setMultiSelectedTargets] = useState<string[]>([]);
  const [distributionStrategy, setDistributionStrategy] = useState<'ROUND_ROBIN' | 'DAILY_QUOTA' | 'STAGGERED'>('ROUND_ROBIN');
  const [staggerIntervalMinutes, setStaggerIntervalMinutes] = useState<number>(2);
  const [customItemTargets, setCustomItemTargets] = useState<Record<string, string>>({});
  const [isAnonymous, setIsAnonymous] = useState<boolean>(false);
  const [groupDistributionMode, setGroupDistributionMode] = useState<'PAGE_PER_GROUP' | 'ROUND_ROBIN_POSTS' | 'CROSS_ALL'>('PAGE_PER_GROUP');

  const activeSelectedGroupIds = useMemo<string[]>(() => {
    const raw = postMode === 'GROUP_ONLY' ? watchedTargetGroupId : watchedGroupNamesField;
    if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
    if (raw) return [String(raw)];
    return [];
  }, [postMode, watchedTargetGroupId, watchedGroupNamesField]);

  const activeSelectedFanpageIds = useMemo<string[]>(() => {
    if (Array.isArray(watchedTargetFanpageId)) return watchedTargetFanpageId.filter(Boolean).map(String);
    if (watchedTargetFanpageId) return [String(watchedTargetFanpageId)];
    return [];
  }, [watchedTargetFanpageId]);

  const [isPageListExpanded, setIsPageListExpanded] = useState<boolean>(false);

  // --- Quick 2-Via / Multi-Via Helper State ---
  const validPersonalVias = useMemo(() => {
    return personalAccountTargets.filter((a) => a.tokenStatus !== 'EXPIRED');
  }, [personalAccountTargets]);

  const twoMainVias = useMemo(() => {
    return validPersonalVias.slice(0, 2);
  }, [validPersonalVias]);

  const twoMainViasTargetValues = useMemo(() => {
    return twoMainVias.map((a) => accountTargetValue(a));
  }, [twoMainVias]);

  const twoMainViasDisplayNames = useMemo(() => {
    if (twoMainVias.length === 0) return '';
    return twoMainVias
      .map((a) => (a.pageName || a.platformAccountId).replace(/^👤\s*Nick Cá Nhân\s*\((.*)\)$/, '$1'))
      .join(' + ');
  }, [twoMainVias]);

  const isTwoViaActive = useMemo(() => {
    if (twoMainViasTargetValues.length < 2) return false;
    return (
      activeSelectedFanpageIds.length === 2 &&
      twoMainViasTargetValues.every((val) => activeSelectedFanpageIds.includes(val))
    );
  }, [twoMainViasTargetValues, activeSelectedFanpageIds]);

  const handleQuickSelectTwoVias = useCallback(() => {
    if (twoMainVias.length === 0) {
      message.warning('Không tìm thấy Nick / Via cá nhân nào có Cookie còn hạn!');
      return;
    }
    const vals = twoMainVias.map((a) => accountTargetValue(a));
    const names = twoMainViasDisplayNames;
    form.setFieldValue('targetFanpageId', vals);
    setIsMultiDistributeActive(true);
    setMultiSelectedTargets(vals);
    setDistributionStrategy('ROUND_ROBIN');
    setGroupDistributionMode('PAGE_PER_GROUP');
    message.success(`⚡ Đã bật chia đều bài cho 2 Via chính: ${names} (Chạy song song siêu tốc)!`);
  }, [twoMainVias, twoMainViasDisplayNames, form, message]);

  const handleQuickSelectAllVias = useCallback(() => {
    if (validPersonalVias.length === 0) {
      message.warning('Không tìm thấy Nick / Via cá nhân nào có Cookie còn hạn!');
      return;
    }
    const vals = validPersonalVias.map((a) => accountTargetValue(a));
    form.setFieldValue('targetFanpageId', vals);
    setIsMultiDistributeActive(true);
    setMultiSelectedTargets(vals);
    setDistributionStrategy('ROUND_ROBIN');
    setGroupDistributionMode('PAGE_PER_GROUP');
    message.success(`👥 Đã chọn chia đều bài cho tất cả ${validPersonalVias.length} Via cá nhân!`);
  }, [validPersonalVias, form, message]);

  const handleQuickSelectAllPages = useCallback(() => {
    if (playwrightAccounts.length === 0) {
      message.warning('Không tìm thấy Fanpage nào!');
      return;
    }
    const vals = playwrightAccounts.map((a) => accountTargetValue(a));
    form.setFieldValue('targetFanpageId', vals);
    setIsMultiDistributeActive(true);
    setMultiSelectedTargets(vals);
    setDistributionStrategy('ROUND_ROBIN');
    setGroupDistributionMode('PAGE_PER_GROUP');
    message.success(`📄 Đã chọn chia đều bài cho tất cả ${playwrightAccounts.length} Fanpage!`);
  }, [playwrightAccounts, form, message]);

  const handleToggleFanpageSelection = useCallback((acc: SocialAccount) => {
    const val = accountTargetValue(acc);
    const pageName = acc.pageName || acc.platformAccountId;
    const current = Array.isArray(watchedTargetFanpageId)
      ? watchedTargetFanpageId
      : (watchedTargetFanpageId ? [String(watchedTargetFanpageId)] : []);
    const exists = current.includes(val);
    const next = exists ? current.filter((v) => v !== val) : [...current, val];
    const finalVal = next.length > 0 ? next : [val];
    form.setFieldValue('targetFanpageId', finalVal);
    setIsMultiDistributeActive(finalVal.length > 1);
    setMultiSelectedTargets(finalVal);
    if (finalVal.length > 1) {
      setGroupDistributionMode('PAGE_PER_GROUP');
    }
    message.info(exists ? `Đã bỏ chọn: ${pageName}` : `Đã thêm: ${pageName}`);
  }, [watchedTargetFanpageId, form, message]);

  const handleResetToSingleTarget = useCallback(() => {
    const defaultTarget = twoMainVias[0] || postingIdentities[0];
    if (defaultTarget) {
      const val = accountTargetValue(defaultTarget);
      form.setFieldValue('targetFanpageId', [val]);
      setIsMultiDistributeActive(false);
      setMultiSelectedTargets([val]);
    }
    setGroupDistributionMode('PAGE_PER_GROUP');
    message.info('Đã chuyển về chế độ đăng bằng 1 tài khoản.');
  }, [twoMainVias, postingIdentities, form, message]);

  const handleSelectSingleVia = useCallback((acc: SocialAccount) => {
    const val = accountTargetValue(acc);
    const name = (acc.pageName || acc.platformAccountId).replace(/^👤\s*Nick Cá Nhân\s*\((.*)\)$/, '$1');
    form.setFieldValue('targetFanpageId', [val]);
    setIsMultiDistributeActive(false);
    setMultiSelectedTargets([val]);
    message.success(`👤 Đã chọn Nick xuất bản: ${name}`);
  }, [form, message]);

  const DEFAULT_HUYNH_THANH_PHU_PRESET = {
    id: 'preset-3-pages-huynh-thanh-phu',
    name: '⭐ 3 Page Via Huỳnh Thạnh Phú (Làm Sen • Làm phước • Làm Gì Mà Gấp)',
    postMode: 'GROUP_ONLY' as const,
    groupDistributionMode: 'PAGE_PER_GROUP' as const,
    selectedGroupIds: [] as string[],
    selectedFanpageIds: [
      '61584834510803:PERSONAL_COOKIE:110', // Làm Sen
      '61575018530670:PERSONAL_COOKIE:90',  // Làm phước
      '61551923480422:PERSONAL_COOKIE:93',  // Làm Gì Mà Gấp
    ],
    isAnonymous: false,
  };

  // --- HỆ THỐNG COMBO THƯỜNG DÙNG (PRESET HUB) ---
  const [savedPresets, setSavedPresets] = useState<Array<{
    id: string;
    name: string;
    postMode: 'GROUP_ONLY' | 'FANPAGE_ONLY' | 'FANPAGE_AND_GROUP';
    groupDistributionMode: 'PAGE_PER_GROUP' | 'ROUND_ROBIN_POSTS' | 'CROSS_ALL';
    selectedFanpageIds: string[];
    selectedGroupIds: string[];
    isAnonymous?: boolean;
  }>>(() => {
    try {
      const raw = localStorage.getItem('autopost_preset_combos');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const exists = parsed.some(
            (p) => p.id === 'preset-3-pages-huynh-thanh-phu' || (p.name && p.name.includes('Huỳnh Thạnh Phú'))
          );
          if (!exists) {
            const merged = [DEFAULT_HUYNH_THANH_PHU_PRESET, ...parsed];
            localStorage.setItem('autopost_preset_combos', JSON.stringify(merged));
            return merged;
          }
          return parsed;
        }
      }
    } catch { }
    return [
      DEFAULT_HUYNH_THANH_PHU_PRESET,
      {
        id: 'preset-kt-38-39-40',
        name: '3 Nhóm Kinh Tế (#38, #39, #40)',
        postMode: 'GROUP_ONLY',
        groupDistributionMode: 'PAGE_PER_GROUP',
        selectedGroupIds: ['442952455895343', '414495725353336', '391775555405184'],
        selectedFanpageIds: [
          '61589245661782:PERSONAL_COOKIE:111',
          '61584834510803:PERSONAL_COOKIE:110',
          '61575018530670:PERSONAL_COOKIE:90',
        ],
        isAnonymous: false,
      },
      {
        id: 'preset-meo-pets',
        name: 'Đảo Mèo & Pet Group',
        postMode: 'GROUP_ONLY',
        groupDistributionMode: 'PAGE_PER_GROUP',
        selectedGroupIds: ['263510030791508', '1195776878326307'],
        selectedFanpageIds: ['61584834510803:PERSONAL_COOKIE:110'],
        isAnonymous: false,
      },
    ];
  });
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [savePresetModalOpen, setSavePresetModalOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [managePresetsModalOpen, setManagePresetsModalOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<{ id: string; name: string } | null>(null);
  const [editingPresetName, setEditingPresetName] = useState('');

  // Tự động đảm bảo preset "3 Page Via Huỳnh Thạnh Phú" luôn xuất hiện trên đầu cho user
  useEffect(() => {
    setSavedPresets((prev) => {
      const exists = prev.some(
        (p) => p.id === 'preset-3-pages-huynh-thanh-phu' || (p.name && p.name.includes('Huỳnh Thạnh Phú'))
      );
      if (!exists) {
        const next = [DEFAULT_HUYNH_THANH_PHU_PRESET, ...prev];
        try {
          localStorage.setItem('autopost_preset_combos', JSON.stringify(next));
        } catch { }
        return next;
      }
      return prev;
    });
  }, []);

  const applyPreset = useCallback((preset: {
    id: string;
    name: string;
    postMode: 'GROUP_ONLY' | 'FANPAGE_ONLY' | 'FANPAGE_AND_GROUP';
    groupDistributionMode: 'PAGE_PER_GROUP' | 'ROUND_ROBIN_POSTS' | 'CROSS_ALL';
    selectedFanpageIds: string[];
    selectedGroupIds: string[];
    isAnonymous?: boolean;
  }) => {
    setSelectedPresetId(preset.id);
    setPostMode(preset.postMode);
    setGroupDistributionMode(preset.groupDistributionMode || 'PAGE_PER_GROUP');
    setIsAnonymous(!!preset.isAnonymous);

    // Chuẩn hóa và ánh xạ selectedFanpageIds khớp chính xác với postingIdentities đang active
    const resolvedFanpageIds = preset.selectedFanpageIds.map((target) => {
      const match = postingIdentities.find(
        (a) =>
          accountTargetValue(a) === target ||
          a.platformAccountId === target ||
          target.startsWith(`${a.platformAccountId}:`) ||
          String(a.id) === target
      );
      return match ? accountTargetValue(match) : target;
    });

    setIsMultiDistributeActive(resolvedFanpageIds.length > 1);
    setMultiSelectedTargets(resolvedFanpageIds);

    // Nếu cấu hình có sẵn nhóm thì ghi đè, nếu rỗng thì giữ nguyên nhóm user đã tích (nếu có)
    const currentGroups = form.getFieldValue('targetGroupId') || [];
    const newGroups = (preset.selectedGroupIds && preset.selectedGroupIds.length > 0)
      ? preset.selectedGroupIds
      : currentGroups;

    form.setFieldsValue({
      targetFanpageId: resolvedFanpageIds.length === 1 ? resolvedFanpageIds[0] : resolvedFanpageIds,
      targetGroupId: newGroups,
      groupNames: newGroups,
    });

    if (preset.selectedGroupIds.length === 0) {
      message.success(`⭐ Đã chọn 3 Page Via Huỳnh Thạnh Phú (Làm Sen, Làm phước, Làm Gì Mà Gấp)! Bạn hãy chọn nhóm yêu thích để đăng nhé.`);
    } else {
      message.success(`⭐ Đã kích hoạt Combo "${preset.name}" (${newGroups.length} nhóm • ${resolvedFanpageIds.length} page)!`);
    }
  }, [postingIdentities, form, message]);

  const handleUpdatePresetWithCurrent = useCallback((presetId: string) => {
    const groupIds = activeSelectedGroupIds;
    const fanpageIds = activeSelectedFanpageIds;
    if (groupIds.length === 0 && fanpageIds.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 nhóm hoặc 1 Page trước khi cập nhật cấu hình!');
      return;
    }
    setSavedPresets((prev) => {
      const next = prev.map((p) => {
        if (p.id === presetId) {
          return {
            ...p,
            postMode,
            groupDistributionMode,
            selectedGroupIds: groupIds,
            selectedFanpageIds: fanpageIds,
            isAnonymous,
          };
        }
        return p;
      });
      try {
        localStorage.setItem('autopost_preset_combos', JSON.stringify(next));
      } catch { }
      return next;
    });
    message.success('✅ Đã cập nhật cấu hình bằng danh sách Nhóm & Page đang chọn hiện tại!');
  }, [activeSelectedGroupIds, activeSelectedFanpageIds, postMode, groupDistributionMode, isAnonymous, message]);

  const handleRenamePreset = useCallback((presetId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) {
      message.warning('Tên cấu hình không được để trống!');
      return;
    }
    setSavedPresets((prev) => {
      const next = prev.map((p) => (p.id === presetId ? { ...p, name: trimmed } : p));
      try {
        localStorage.setItem('autopost_preset_combos', JSON.stringify(next));
      } catch { }
      return next;
    });
    setEditingPreset(null);
    setEditingPresetName('');
    message.success('✅ Đã đổi tên cấu hình thành công!');
  }, [message]);

  const handleDeletePreset = useCallback((presetId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSavedPresets((prev) => {
      const next = prev.filter((p) => p.id !== presetId);
      try {
        localStorage.setItem('autopost_preset_combos', JSON.stringify(next));
      } catch { }
      return next;
    });
    if (selectedPresetId === presetId) {
      setSelectedPresetId(null);
    }
    message.info('Đã xóa cấu hình khỏi danh sách.');
  }, [selectedPresetId, message]);

  const deletePreset = handleDeletePreset;

  const handleSaveNewPreset = useCallback(() => {
    const groupIds = activeSelectedGroupIds;
    const fanpageIds = activeSelectedFanpageIds;
    if (groupIds.length === 0 && fanpageIds.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 nhóm hoặc 1 Page trước khi lưu!');
      return;
    }
    const name = newPresetName.trim() || `Combo ${groupIds.length} Nhóm • ${fanpageIds.length} Page`;
    const newPreset = {
      id: `preset-${Date.now()}`,
      name,
      postMode,
      groupDistributionMode,
      selectedGroupIds: groupIds,
      selectedFanpageIds: fanpageIds,
      isAnonymous,
    };
    setSavedPresets((prev) => {
      const next = [...prev, newPreset];
      try {
        localStorage.setItem('autopost_preset_combos', JSON.stringify(next));
      } catch { }
      return next;
    });
    setSavePresetModalOpen(false);
    setNewPresetName('');
    message.success(`⭐ Đã lưu Combo "${name}" thành công!`);
  }, [activeSelectedGroupIds, activeSelectedFanpageIds, newPresetName, postMode, groupDistributionMode, isAnonymous, message]);

  const handleAutoSpreadPagesForGroups = useCallback(() => {
    if (activeSelectedGroupIds.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 nhóm trước khi rải Page!');
      return;
    }
    const n = Math.max(1, activeSelectedGroupIds.length);
    const available = playwrightAccounts.map((a) => accountTargetValue(a));
    if (available.length === 0) {
      message.warning('Chưa có Fanpage nào được kết nối!');
      return;
    }
    const picked = available.slice(0, n);
    form.setFieldValue('targetFanpageId', picked);
    setMultiSelectedTargets(picked);
    setIsMultiDistributeActive(picked.length > 1);
    setGroupDistributionMode('PAGE_PER_GROUP');
    message.success(`⚡ Đã tự động rải đều ${picked.length} Page cho ${activeSelectedGroupIds.length} Nhóm!`);
  }, [activeSelectedGroupIds, playwrightAccounts, form, message]);

  const handleShufflePagesForGroups = useCallback(() => {
    const n = Math.max(1, activeSelectedGroupIds.length || 3);
    const available = [...playwrightAccounts].sort(() => Math.random() - 0.5).map((a) => accountTargetValue(a));
    if (available.length === 0) {
      message.warning('Chưa có Fanpage nào được kết nối!');
      return;
    }
    const picked = available.slice(0, n);
    form.setFieldValue('targetFanpageId', picked);
    setMultiSelectedTargets(picked);
    setIsMultiDistributeActive(picked.length > 1);
    setGroupDistributionMode('PAGE_PER_GROUP');
    message.success(`🎲 Đã đổi ngẫu nhiên sang ${picked.length} Page mới!`);
  }, [activeSelectedGroupIds, playwrightAccounts, form, message]);

  // Memoized unified options for Ant Design Select (tối ưu hiệu năng, virtual scrolling mượt mà)
  const unifiedAccountOptions = useMemo(() => {
    const pageOptions = playwrightAccounts.map((acc) => {
      const val = accountTargetValue(acc);
      const isExp = acc.tokenStatus === 'EXPIRED';
      const targetObj = todayTargets.find((t) => t.socialAccountId === acc.id);
      const targetCount = targetObj?.targetCount || acc.maxPostsPerDay || 5;
      const currentCount = (targetObj?.actualCount || 0) + (targetObj?.pendingCount || 0);
      const needed = Math.max(0, targetCount - currentCount);
      const viaName = viaNameOf(acc);
      const normName = (acc.pageName || acc.platformAccountId).trim().toLowerCase();
      const coAdmins = coAdminViasByPageName.get(normName) || [];
      const isCoAdmin = coAdmins.length > 1;

      return {
        value: val,
        filterLabel: `${accountSearchLabel(acc)} ${viaName || ''}`,
        label: (
          <div className="flex items-center justify-between w-full py-0.5">
            <span className={isExp ? 'text-red-500 font-bold' : 'text-emerald-300 font-semibold flex items-center gap-1.5'}>
              <span>📄 {acc.pageName || acc.platformAccountId}</span>
              {isCoAdmin && (
                <span className="px-1 py-0.2 rounded text-[9px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  ⚡ 2 Via
                </span>
              )}
              {viaName && <span className="text-[11px] font-normal text-slate-400">· {viaName}</span>}
            </span>
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <Tag color={needed > 0 ? 'orange' : 'success'} className="!rounded-full text-[10px] !mr-0">
                KPI: {currentCount}/{targetCount} {needed > 0 ? `(thiếu ${needed})` : '(đủ)'}
              </Tag>
              {isExp && (
                <Tag color="error" className="!rounded-full text-[10px] !mr-0 font-bold">Hết Cookie</Tag>
              )}
            </div>
          </div>
        ),
      };
    });

    const personalOptions = personalAccountTargets.map((acc) => {
      const val = accountTargetValue(acc);
      const isExp = acc.tokenStatus === 'EXPIRED';
      const targetObj = todayTargets.find((t) => t.socialAccountId === acc.id);
      const targetCount = targetObj?.targetCount || acc.maxPostsPerDay || 5;
      const currentCount = (targetObj?.actualCount || 0) + (targetObj?.pendingCount || 0);
      const needed = Math.max(0, targetCount - currentCount);

      return {
        value: val,
        filterLabel: accountSearchLabel(acc),
        label: (
          <div className="flex items-center justify-between w-full py-0.5">
            <span className={isExp ? 'text-red-600 font-bold' : 'text-indigo-400 font-semibold'}>
              👤 {acc.pageName || acc.platformAccountId}
            </span>
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <Tag color={needed > 0 ? 'orange' : 'success'} className="!rounded-full text-[10px] !mr-0">
                KPI: {currentCount}/{targetCount} {needed > 0 ? `(thiếu ${needed})` : '(đủ)'}
              </Tag>
              {isExp ? (
                <Tag color="error" className="!rounded-full text-[10px] !mr-0 font-bold">Hết Cookie</Tag>
              ) : (
                <Tag color="purple" className="!rounded-full text-[10px] !mr-0 font-bold">Cá nhân</Tag>
              )}
            </div>
          </div>
        ),
      };
    });

    const groups = [];
    if (pageOptions.length > 0) {
      groups.push({
        label: `📄 DANH SÁCH FANPAGE (${pageOptions.length})`,
        options: pageOptions,
      });
    }
    if (personalOptions.length > 0) {
      groups.push({
        label: `👤 NICK CÁ NHÂN / VIA (${personalOptions.length})`,
        options: personalOptions,
      });
    }
    return groups;
  }, [playwrightAccounts, personalAccountTargets, todayTargets, viaNameOf, coAdminViasByPageName]);

  const unifiedGroupOptions = useMemo(() => {
    return groupAccountsWithId.map((group, index) => {
      const isJoined = group.groupHealthStatus === 'JOINED';
      const isPending = group.groupHealthStatus === 'PENDING_APPROVAL';
      const isNotJoined = group.groupHealthStatus === 'KICKED_OR_NOT_JOINED';
      const cleanName = stripEmojiPrefix(group.pageName) || '';

      return {
        value: group.platformAccountId,
        filterLabel: `${cleanName} ${group.platformAccountId}`,
        label: (
          <div className="flex items-center justify-between w-full py-0.5">
            <span className="truncate pr-2">
              {cleanName} {index + 1} · ID {group.platformAccountId}
            </span>
            <div className="shrink-0">
              {isJoined && <Tag color="success" className="!rounded-full text-[10px] !mr-0">Đã vào</Tag>}
              {isPending && <Tag color="warning" className="!rounded-full text-[10px] !mr-0">Chờ duyệt</Tag>}
              {isNotJoined && <Tag color="error" className="!rounded-full text-[10px] !mr-0">Chưa vào</Tag>}
            </div>
          </div>
        ),
      };
    });
  }, [groupAccountsWithId]);

  const calculatedTotalQueueCount = useMemo(() => {
    const validCount = linkItems.filter((i) => {
      const hasUrl = !!i.url && i.url.trim().length > 0;
      const hasContent = (!!i.manualContent && i.manualContent.trim().length > 0) || (!!i.customCaption && i.customCaption.trim().length > 0);
      const hasMedia = (i.manualMediaUrls?.length || 0) > 0;
      return hasUrl || hasContent || hasMedia;
    }).length;
    if (validCount === 0) return 0;

    if (postMode === 'FANPAGE_ONLY') {
      return isMultiDistributeActive ? validCount : validCount * Math.max(1, activeSelectedFanpageIds.length);
    }

    const gCount = activeSelectedGroupIds.length;
    const pCount = activeSelectedFanpageIds.length;

    if (gCount === 0) return 0;

    if (groupDistributionMode === 'PAGE_PER_GROUP') {
      return validCount * gCount;
    } else if (groupDistributionMode === 'ROUND_ROBIN_POSTS') {
      return validCount;
    } else {
      return validCount * gCount * Math.max(1, pCount);
    }
  }, [linkItems, postMode, isMultiDistributeActive, activeSelectedGroupIds, activeSelectedFanpageIds, groupDistributionMode]);


  useEffect(() => {
    if (postingIdentities.length === 0) return;
    const validValues = new Set(postingIdentities.map((account) => accountTargetValue(account)));
    const selectedValue = form.getFieldValue('targetFanpageId');

    const defaultAccount = [...playwrightAccounts]
      .sort((a, b) => b.id - a.id)
      .find((account) => account.platformAccountId === DEFAULT_FANPAGE_PLATFORM_ACCOUNT_ID) || postingIdentities[0];
    const defaultVal = accountTargetValue(defaultAccount);

    if (Array.isArray(selectedValue)) {
      if (selectedValue.length === 0) {
        form.setFieldValue('targetFanpageId', [defaultVal]);
      } else {
        const validSelected = selectedValue.filter((val) => validValues.has(val));
        if (validSelected.length !== selectedValue.length) {
          form.setFieldValue(
            'targetFanpageId',
            validSelected.length > 0 ? validSelected : [defaultVal]
          );
        }
      }
    } else if (typeof selectedValue === 'string' && selectedValue) {
      const isVal = validValues.has(selectedValue) ? selectedValue : defaultVal;
      form.setFieldValue('targetFanpageId', [isVal]);
    } else {
      form.setFieldValue('targetFanpageId', [defaultVal]);
    }
  }, [form, postingIdentities, playwrightAccounts, postMode]);

  // Khởi tạo bình luận mặc định từ LocalStorage hoặc mẫu có sẵn
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY_COMMENT);
    if (!saved || saved.trim() === '' || !saved.includes('9fLALT7wfw')) {
      localStorage.setItem(STORAGE_KEY_COMMENT, DEFAULT_SAVED_COMMENT);
      form.setFieldValue('affiliateLink', DEFAULT_SAVED_COMMENT);
    } else {
      form.setFieldValue('affiliateLink', saved);
    }
  }, [form]);

  // Thống kê nhanh toàn bộ bài viết (siêu nhẹ, truy vấn trực tiếp từ backend SQL trong 1ms)
  const { data: queueCounts } = useQuery({
    queryKey: ['queueCountsGlobal'],
    queryFn: async () => {
      try {
        const res = await api.get('/queue/counts');
        return res.data as { all: number; pending: number; processing: number; published: number; failed: number };
      } catch {
        return null;
      }
    },
    staleTime: 6000,
    refetchInterval: 10000,
  });

  // Fetch lịch sử các bài đăng gần đây (active queue + 2 ngày gần nhất)
  const { data: posts, isLoading } = useQuery({
    queryKey: ['postQueuePlaywright'],
    queryFn: async () => {
      const response = await api.get('/campaigns');
      const campaigns = response.data || [];
      const results = await Promise.all(
        campaigns.map(async (c: any) => {
          try {
            const res = await api.get(`/queue/campaign/${c.id}?days=2`);
            return res.data || [];
          } catch {
            return [];
          }
        })
      );
      let allPosts: PostQueue[] = results.flat();
      // Lọc bỏ bài Story — chỉ hiển thị các bài viết/video thường vào Fanpage và Group
      allPosts = allPosts.filter((p) => p.postType !== 'STORY');

      const getStatusPriority = (status: string) => {
        if (status === 'PROCESSING') return 1;
        if (status === 'PENDING') return 2;
        if (status === 'FAILED') return 3;
        if (status === 'PUBLISHED') return 4;
        return 5;
      };

      return allPosts.sort((a, b) => {
        const pA = getStatusPriority(a.status);
        const pB = getStatusPriority(b.status);
        if (pA !== pB) {
          return pA - pB;
        }
        if (a.status === 'PENDING' && b.status === 'PENDING') {
          return dayjs(a.scheduledAt).valueOf() - dayjs(b.scheduledAt).valueOf();
        }
        return b.id - a.id;
      });
    },
    staleTime: 8000,
    refetchInterval: (query) => {
      const all = query.state.data as PostQueue[] | undefined;
      const isAnyProcessing = all?.some((p) => p.status === 'PROCESSING');
      return isAnyProcessing ? 8000 : 25000;
    },
  });

  const {
    data: diagnosticLog,
    isFetching: diagnosticLoading,
    error: diagnosticLoadError,
    refetch: refetchDiagnostic,
  } = useQuery({
    queryKey: ['post-diagnostic-log', diagnosingPost?.id],
    queryFn: async () => (await api.get('/system-logs', { params: { source: 'worker', lines: 5000 } })).data as DiagnosticLogPayload,
    enabled: !!diagnosingPost,
    staleTime: 3000,
    refetchInterval: diagnosingPost?.status === 'PROCESSING' ? 3000 : false,
    retry: 1,
  });

  const diagnosticEvidence = useMemo(
    () => collectDiagnosticEvidence(diagnosingPost, diagnosticLog?.lines || []),
    [diagnosingPost, diagnosticLog?.lines]
  );

  const buildDiagnosticText = () => {
    if (!diagnosingPost) return '';
    return [
      'PHUSOCIAL — CHẨN ĐOÁN BÀI ĐĂNG',
      `Bài: #${diagnosingPost.id}`,
      `Trạng thái: ${diagnosingPost.status}`,
      `Thời gian dự kiến: ${diagnosingPost.scheduledAt || 'Không có'}`,
      `Thời gian đã đăng: ${diagnosingPost.publishedAt || 'Chưa có'}`,
      `Link nguồn: ${diagnosingPost.originalUrl || 'Không có'}`,
      `Fanpage: ${diagnosingPost.targetFanpageId || 'Không có'}`,
      `Nhóm: ${diagnosingPost.targetGroupNames || 'Không có'}`,
      '',
      'LỖI HỆ THỐNG GHI NHẬN:',
      diagnosingPost.errorMessage || 'Chưa có thông báo lỗi được lưu.',
      '',
      diagnosticEvidence.exactMatch
        ? `LOG WORKER LIÊN QUAN (${diagnosticEvidence.matchCount} vị trí khớp):`
        : 'LOG LỖI WORKER GẦN NHẤT (không tìm thấy định danh chính xác):',
      ...(diagnosticEvidence.lines.length ? diagnosticEvidence.lines : ['Không có dòng log phù hợp.']),
    ].join('\n');
  };

  const copyDiagnostic = async (errorOnly = false) => {
    if (!diagnosingPost) return;
    const fallbackErrors = diagnosticEvidence.lines.filter((line) => /(error|fatal|exception|failed|thất bại|❌)/i.test(line));
    const text = errorOnly
      ? (diagnosingPost.errorMessage || fallbackErrors.join('\n') || 'Chưa tìm thấy nội dung lỗi cho bài này.')
      : buildDiagnosticText();
    try {
      await navigator.clipboard.writeText(text);
      message.success(errorOnly ? 'Đã sao chép nội dung lỗi' : 'Đã sao chép toàn bộ gói chẩn đoán');
    } catch {
      message.error('Trình duyệt không cho phép sao chép tự động');
    }
  };

  const [filterHistoryDuplicates, setFilterHistoryDuplicates] = useState(false);

  // Smart Schedule: lên lịch thông minh theo khung giờ nhóm
  const [smartScheduleEnabled, setSmartScheduleEnabled] = useState(false);
  const [smartGroupId, setSmartGroupId] = useState<string>('');
  const [smartDailyLimit, setSmartDailyLimit] = useState<number>(10);
  const STORAGE_KEY_GROUP_LIMITS = 'autopost_group_daily_limits';

  // Lấy daily limit đã lưu cho nhóm cụ thể
  const getGroupDailyLimit = useCallback((groupId: string): number => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_GROUP_LIMITS) || '{}');
      return saved[groupId] ?? 10;
    } catch { return 10; }
  }, []);

  // Lưu daily limit cho nhóm
  const saveGroupDailyLimit = useCallback((groupId: string, limit: number) => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_GROUP_LIMITS) || '{}');
      saved[groupId] = limit;
      localStorage.setItem(STORAGE_KEY_GROUP_LIMITS, JSON.stringify(saved));
    } catch { /* ignore */ }
  }, []);

  // --- Group Membership Pre-flight Check State ---
  const [groupCheckModalVisible, setGroupCheckModalVisible] = useState<boolean>(false);
  const [groupCheckingMap, setGroupCheckingMap] = useState<Record<number, boolean>>({});
  const [groupJoiningMap, setGroupJoiningMap] = useState<Record<number, boolean>>({});

  // Mutation kiểm tra sức khỏe 1 group
  const checkSingleGroupMutation = useMutation({
    mutationFn: async (groupId: number) => {
      setGroupCheckingMap((prev) => ({ ...prev, [groupId]: true }));
      try {
        const res = await api.post(`/connections/${groupId}/check-group-health`);
        return res.data;
      } finally {
        setGroupCheckingMap((prev) => ({ ...prev, [groupId]: false }));
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
      if (data?.status === 'JOINED') {
        message.success('🟢 Nhóm hoạt động tốt! Bạn đã là thành viên.');
      } else if (data?.status === 'PENDING_APPROVAL') {
        message.warning('🟡 Đang chờ Admin duyệt thành viên.');
      } else {
        message.error(`🔴 Trạng thái: ${data?.message || 'Chưa tham gia nhóm'}`);
      }
    },
    onError: (err: any) => {
      message.error(`Lỗi kiểm tra nhóm: ${err?.response?.data?.error || err.message}`);
    }
  });

  // Mutation kiểm tra sức khỏe tất cả group
  const checkAllGroupsMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/connections/check-all-groups-health');
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
      message.success(`Đã quét xong sức khỏe của ${data?.length || 0} nhóm!`);
    },
    onError: (err: any) => {
      message.error(`Lỗi quét nhóm: ${err?.response?.data?.error || err.message}`);
    }
  });

  // Mutation tự động xin vào nhóm
  const joinGroupMutation = useMutation({
    mutationFn: async (groupId: number) => {
      setGroupJoiningMap((prev) => ({ ...prev, [groupId]: true }));
      try {
        const res = await api.post(`/connections/${groupId}/join-group`);
        return res.data;
      } finally {
        setGroupJoiningMap((prev) => ({ ...prev, [groupId]: false }));
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
      message.success(data?.message || 'Đã gửi yêu cầu tham gia nhóm!');
    },
    onError: (err: any) => {
      message.error(`Lỗi xin vào nhóm: ${err?.response?.data?.error || err.message}`);
    }
  });

  // Danh sách kênh đích thực tế đang được chọn để phân phối (đồng bộ chuẩn giữa Fanpage mode và Group mode)
  const effectiveMultiTargets = useMemo<string[]>(() => {
    if (postMode === 'FANPAGE_ONLY') {
      return isMultiDistributeActive ? multiSelectedTargets : [];
    }
    // GROUP_ONLY & FANPAGE_AND_GROUP: Lấy trực tiếp danh sách Fanpage / Nick mà người dùng đã chọn ở ô "Đăng dưới danh nghĩa"
    return activeSelectedFanpageIds;
  }, [postMode, isMultiDistributeActive, multiSelectedTargets, activeSelectedFanpageIds]);

  const isMatrixDistributionVisible = useMemo(() => {
    const validCount = linkItems.filter((i) => i.url.trim().length > 0).length;
    if (validCount === 0) return false;
    if (postMode === 'FANPAGE_ONLY') {
      return isMultiDistributeActive && multiSelectedTargets.length > 0;
    }
    return activeSelectedFanpageIds.length > 1;
  }, [linkItems, postMode, isMultiDistributeActive, multiSelectedTargets, activeSelectedFanpageIds]);

  // Tính toán đích đăng cho từng bài khi bật chế độ phân phối đa kênh
  const calculatedDistribution = useMemo(() => {
    const validItems = linkItems.filter((i) => i.url.trim().length > 0);
    if (!isMatrixDistributionVisible || effectiveMultiTargets.length === 0 || validItems.length === 0) {
      return {};
    }

    const result: Record<string, { targetValue: string; accountName: string; scheduledAt: Dayjs }> = {};
    const baseTime = validItems[0]?.isNow ? dayjs() : (validItems[0]?.scheduledAt || dayjs());

    if (distributionStrategy === 'ROUND_ROBIN' || distributionStrategy === 'STAGGERED' || postMode !== 'FANPAGE_ONLY') {
      validItems.forEach((item, idx) => {
        const rawTarget = customItemTargets[item.id];
        const chosenTarget = (rawTarget && effectiveMultiTargets.includes(rawTarget))
          ? rawTarget
          : effectiveMultiTargets[idx % effectiveMultiTargets.length];
        const matchedAcc = postingIdentities.find((a) => accountTargetValue(a) === chosenTarget || a.platformAccountId === chosenTarget || String(a.id) === chosenTarget);
        const itemTime = distributionStrategy === 'STAGGERED' && postMode === 'FANPAGE_ONLY'
          ? baseTime.add(idx * staggerIntervalMinutes, 'minute')
          : (item.isNow ? baseTime.add(idx * batchInterval, 'minute') : item.scheduledAt);

        result[item.id] = {
          targetValue: chosenTarget,
          accountName: matchedAcc?.pageName || matchedAcc?.platformAccountId || chosenTarget,
          scheduledAt: itemTime,
        };
      });
    } else if (distributionStrategy === 'DAILY_QUOTA') {
      const targetShortages = effectiveMultiTargets.map((targetVal) => {
        const acc = postingIdentities.find((a) => accountTargetValue(a) === targetVal || a.platformAccountId === targetVal || String(a.id) === targetVal);
        const targetObj = todayTargets.find((t) => t.socialAccountId === acc?.id);
        const targetCount = targetObj?.targetCount || acc?.maxPostsPerDay || 5;
        const currentCount = (targetObj?.actualCount || 0) + (targetObj?.pendingCount || 0);
        const needed = Math.max(0, targetCount - currentCount);
        return { targetVal, needed, accName: acc?.pageName || acc?.platformAccountId || targetVal };
      });

      const pool: string[] = [];
      targetShortages.forEach((ts) => {
        for (let k = 0; k < ts.needed; k++) {
          pool.push(ts.targetVal);
        }
      });

      if (pool.length === 0) {
        effectiveMultiTargets.forEach((t) => pool.push(t));
      }

      validItems.forEach((item, idx) => {
        const rawTarget = customItemTargets[item.id];
        const chosenTarget = (rawTarget && effectiveMultiTargets.includes(rawTarget))
          ? rawTarget
          : pool[idx % pool.length];
        const matchedAcc = postingIdentities.find((a) => accountTargetValue(a) === chosenTarget || a.platformAccountId === chosenTarget || String(a.id) === chosenTarget);
        const itemTime = item.isNow ? baseTime.add(idx * batchInterval, 'minute') : item.scheduledAt;

        result[item.id] = {
          targetValue: chosenTarget,
          accountName: matchedAcc?.pageName || matchedAcc?.platformAccountId || chosenTarget,
          scheduledAt: itemTime,
        };
      });
    }

    return result;
  }, [
    linkItems,
    isMatrixDistributionVisible,
    effectiveMultiTargets,
    distributionStrategy,
    staggerIntervalMinutes,
    batchInterval,
    customItemTargets,
    postingIdentities,
    todayTargets,
    postMode,
  ]);


  // Lắng nghe URL params khi được mở từ Floating KPI Popover
  useEffect(() => {
    const targetGroupId = searchParams.get('targetGroupId');
    const targetFanpageId = searchParams.get('targetFanpageId');
    const mode = searchParams.get('mode') as PostMode | null;
    const openBulk = searchParams.get('openBulk');
    const missing = searchParams.get('missing');
    const groupName = searchParams.get('groupName');

    if (targetGroupId) {
      if (mode) setPostMode(mode);
      else setPostMode('GROUP_ONLY');
      form.setFieldValue('targetGroupId', targetGroupId);
      setSmartScheduleEnabled(true);
      setSmartGroupId(targetGroupId);
      setSmartDailyLimit(getGroupDailyLimit(targetGroupId));
      if (openBulk === '1') {
        setBulkModalVisible(true);
      }
      message.destroy();
      message.info(`🎯 Đang lên bài bù KPI cho nhóm "${groupName || targetGroupId}"${missing ? ` (còn thiếu ${missing} bài hôm nay)` : ''}`, 6);
      setSearchParams({}, { replace: true });
    } else if (targetFanpageId) {
      if (mode) setPostMode(mode);
      else setPostMode('FANPAGE_ONLY');
      const matchedFp = playwrightAccounts.find((a) => a.platformAccountId === targetFanpageId);
      if (matchedFp) {
        form.setFieldValue('targetFanpageId', accountTargetValue(matchedFp));
      }
      if (openBulk === '1') {
        setBulkModalVisible(true);
      }
      message.destroy();
      message.info(`🎯 Đang lên bài bù KPI cho Fanpage "${groupName || targetFanpageId}"${missing ? ` (còn thiếu ${missing} bài hôm nay)` : ''}`, 6);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, form, playwrightAccounts, getGroupDailyLimit, setSearchParams, message]);

  /**
   * Tính toán lịch thông minh cho N bài mới vào một nhóm cụ thể.
   * Nguyên lý:
   *   - Lấy tất cả bài PENDING/PROCESSING của nhóm đó.
   *   - Nhóm theo từng ngày, đếm xem mỗi ngày còn slot nào chưa đầy (< dailyLimit).
   *   - Bài mới được ghép vào slot trống tiếp theo, cách nhau (24h / dailyLimit).
   *   - Nếu hôm nay đầy → chuyển sang ngày mai, cứ vậy tiếp.
   */
  const computeSmartSchedule = useCallback((
    targetGroupId: string,
    newCount: number,
    dailyLimit: number,
  ): Dayjs[] => {
    if (!targetGroupId || newCount === 0) return [];
    const now = dayjs();
    const minSafeInterval = 60; // Tối thiểu cách nhau 60 phút giữa 2 bài của cùng 1 nhóm
    const limit = Math.max(1, dailyLimit || 4);
    // Khung giờ vàng ban ngày từ 07:30 đến 22:30 (15 tiếng = 900 phút)
    const idealInterval = Math.max(minSafeInterval, Math.floor(900 / limit));

    // Lọc pending/processing posts thuộc nhóm này
    const pendingForGroup = (posts || []).filter((p) => {
      if (p.status !== 'PENDING' && p.status !== 'PROCESSING') return false;
      const raw = (p.targetGroupNames || '').replace(/^GROUP_ONLY_ANON:|^GROUP_ONLY:/, '');
      return raw.split(',').map((v) => v.trim()).includes(targetGroupId);
    });

    // Build map: dateStr → list of scheduledAt (sorted asc)
    const occupiedByDate = new Map<string, Dayjs[]>();
    pendingForGroup.forEach((p) => {
      const dt = dayjs(p.scheduledAt);
      const key = dt.format('YYYY-MM-DD');
      if (!occupiedByDate.has(key)) occupiedByDate.set(key, []);
      occupiedByDate.get(key)!.push(dt);
    });
    occupiedByDate.forEach((slots) => slots.sort((a, b) => a.valueOf() - b.valueOf()));

    const result: Dayjs[] = [];
    let currentDate = now.startOf('day');

    // Duyệt qua tối đa 30 ngày để tìm slot an toàn, không trùng
    for (let d = 0; d < 30 && result.length < newCount; d++) {
      const isToday = currentDate.isSame(now, 'day');
      const dateStr = currentDate.format('YYYY-MM-DD');
      const occupied = occupiedByDate.get(dateStr) || [];
      const scheduledThisDay = result.filter((r) => r.isSame(currentDate, 'day'));
      const totalPlannedToday = occupied.length + scheduledThisDay.length;
      const availableCount = Math.max(0, limit - totalPlannedToday);

      if (availableCount > 0) {
        let cursor: Dayjs;
        if (isToday) {
          cursor = now.add(10, 'minute');
        } else {
          cursor = currentDate.hour(7).minute(30).second(0);
        }

        const maxEndTimeToday = currentDate.hour(22).minute(30).second(0);

        // Gom toàn bộ mốc đã có (cả bài pending cũ và các bài vừa xếp trong result)
        const allOccupiedToday = [...occupied, ...scheduledThisDay].sort((a, b) => a.valueOf() - b.valueOf());

        while (result.filter((r) => r.isSame(currentDate, 'day')).length < availableCount && result.length < newCount) {
          if (cursor.isBefore(now.add(5, 'minute'))) {
            cursor = now.add(5, 'minute');
          }

          // Kiểm tra xem cursor có bị trùng gần (< minSafeInterval) với bất kỳ mốc đã có nào không
          let hasConflict = false;
          for (const occ of allOccupiedToday) {
            const diffMins = Math.abs(cursor.diff(occ, 'minute'));
            if (diffMins < minSafeInterval) {
              // Xung đột -> đẩy cursor ra sau mốc này ít nhất minSafeInterval
              cursor = occ.add(minSafeInterval, 'minute');
              hasConflict = true;
              break;
            }
          }

          if (hasConflict) {
            continue;
          }

          // Nếu vượt quá 22:30 hôm nay -> dừng hôm nay, chuyển sang ngày mai
          if (cursor.isAfter(maxEndTimeToday)) {
            break;
          }

          // Slot hợp lệ
          result.push(cursor);
          allOccupiedToday.push(cursor);
          allOccupiedToday.sort((a, b) => a.valueOf() - b.valueOf());

          // Tiến cursor lên cho slot tiếp theo
          cursor = cursor.add(idealInterval, 'minute');
        }
      }
      currentDate = currentDate.add(1, 'day');
    }

    return result;
  }, [posts]);



  const bulkPasteSummary = useMemo(() => {
    const nonEmptyLines = bulkText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const detected = (bulkText.match(/https?:\/\/[^\s"'<>]+/gi) || [])
      .map((url) => cleanSocialUrl(url.replace(/[),.;"'<>]+$/g, '')))
      .filter(Boolean);
    const uniqueUrls = Array.from(new Set(detected));
    const existingHistoryUrls = new Set(
      (posts || []).map((post) => post.originalUrl).filter(Boolean).map((url) => cleanSocialUrl(url))
    );
    const historyMatchedUrls = uniqueUrls.filter((url) => existingHistoryUrls.has(url));
    const finalUrls = filterHistoryDuplicates
      ? uniqueUrls.filter((url) => !existingHistoryUrls.has(url))
      : uniqueUrls;

    return {
      detectedUrls: detected,
      uniqueUrls,
      finalUrls,
      historyMatchedUrls,
      invalidLineCount: nonEmptyLines.filter((line) => !/https?:\/\/[^\s]+/i.test(line)).length,
      duplicateInInputCount: detected.length - uniqueUrls.length,
      duplicateInHistoryCount: historyMatchedUrls.length,
    };
  }, [bulkText, posts, filterHistoryDuplicates]);

  // Kết quả tính toán smart schedule (live preview) — phải đặt sau bulkPasteSummary
  const smartScheduleTimes = useMemo(() => {
    if (!smartScheduleEnabled || !smartGroupId || bulkPasteSummary.finalUrls.length === 0) return [];
    return computeSmartSchedule(smartGroupId, bulkPasteSummary.finalUrls.length, smartDailyLimit);
  }, [smartScheduleEnabled, smartGroupId, smartDailyLimit, bulkPasteSummary.finalUrls.length, computeSmartSchedule]);

  // Mục tiêu KPI hôm nay của nhóm đang chọn (tính cả bài đã đăng và bài đang chờ đăng hôm nay)
  const currentKpiTarget = useMemo(() => {
    const targetId = smartGroupId || (postMode === 'GROUP_ONLY' ? form.getFieldValue('targetGroupId') : null);
    if (targetId) {
      const acc = (socialAccounts || []).find((a) => a.platformAccountId === targetId);
      const target = (todayTargets || []).find(
        (t) => (t.platformAccountId && t.platformAccountId === targetId) || (acc && t.socialAccountId === acc.id)
      );
      if (target) {
        const actual = target.actualCount;
        const pendingToday = target.pendingCount || 0;
        const totalQueue = target.totalPending !== undefined ? target.totalPending : pendingToday;
        const totalPlanned = actual + totalQueue;
        const isFullyPublished = target.achieved || actual >= target.targetCount;
        const isFullyScheduled = totalPlanned >= target.targetCount;
        const remainingToSchedule = Math.max(0, target.targetCount - totalPlanned);

        return {
          socialAccountId: target.socialAccountId || acc?.id,
          name: target.accountName || acc?.pageName || targetId,
          targetCount: target.targetCount,
          actualCount: actual,
          pendingCount: pendingToday,
          totalPending: totalQueue,
          totalPlanned,
          isFullyPublished,
          isFullyScheduled,
          remainingToSchedule,
        };
      }
    }
    return null;
  }, [smartGroupId, postMode, form, socialAccounts, todayTargets]);

  // Thống kê tiến độ cào và tải trước toàn bộ bài viết trong Drawer dán hàng loạt
  const bulkScrapeStats = useMemo(() => {
    const total = bulkPasteSummary.finalUrls.length;
    if (total === 0) return { total: 0, completed: 0, loading: 0, error: 0, isDone: false, percent: 0 };
    let completed = 0;
    let loading = 0;
    let error = 0;
    for (const url of bulkPasteSummary.finalUrls) {
      const p = bulkDrawerPreviews[url.trim()];
      if (!p || p.loading) {
        loading++;
      } else if (p.error) {
        error++;
      } else {
        completed++;
      }
    }
    const percent = Math.round((completed / Math.max(1, total)) * 100);
    return {
      total,
      completed,
      loading,
      error,
      isDone: total > 0 && loading === 0,
      percent,
    };
  }, [bulkPasteSummary.finalUrls, bulkDrawerPreviews]);

  // Tự động thông báo Toast chúc mừng khi toàn bộ link đã cào xong 100%
  const prevBulkLoadingCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (!bulkModalVisible || bulkScrapeStats.total === 0) {
      prevBulkLoadingCountRef.current = null;
      return;
    }
    if (prevBulkLoadingCountRef.current !== null && prevBulkLoadingCountRef.current > 0 && bulkScrapeStats.loading === 0) {
      message.success({
        content: `🎉 ĐÃ CÀO XONG TOÀN BỘ ${bulkScrapeStats.completed}/${bulkScrapeStats.total} BÀI VIẾT (100%)! Bạn có thể bấm Duyệt nhanh (Tinder) hoặc Áp dụng lịch ngay.`,
        duration: 6,
        key: 'bulk-scrape-done-toast',
      });
    }
    prevBulkLoadingCountRef.current = bulkScrapeStats.loading;
  }, [bulkModalVisible, bulkScrapeStats.total, bulkScrapeStats.loading, bulkScrapeStats.completed]);

  const fetchOneDrawerPreview = useCallback(async (url: string) => {
    if (!url) return;
    const trimmed = url.trim();
    const existing = bulkDrawerPreviews[trimmed];
    // BỎ QUA nếu bài đã có dữ liệu hoặc đang tải — không cào lại lãng phí
    if (existing && (existing.loading || existing.caption || (existing.mediaUrls && existing.mediaUrls.length > 0) || existing.watermarkRemoved)) {
      return;
    }
    setBulkDrawerPreviews((prev) => ({ ...prev, [trimmed]: { loading: true } }));
    try {
      const res = await api.post('/queue/preview-url', { url: trimmed });
      if (res.data?.success && res.data?.item) {
        const rawFetched = res.data.item.content || res.data.item.title || '';
        // Bảo vệ: Nếu Facebook trả về lỗi riêng tư, không lưu lỗi vào caption
        if (isFbRestrictionError(rawFetched)) {
          setBulkDrawerPreviews((prev) => {
            const cur = prev[trimmed];
            return {
              ...prev,
              [trimmed]: {
                loading: false,
                caption: cur?.caption || '',
                mediaUrls: cur?.mediaUrls || [],
                mediaKinds: cur?.mediaKinds || [],
                error: 'Bài viết Facebook giới hạn riêng tư (nhóm kín)',
              },
            };
          });
          return;
        }
        const fetchedCaption = formatMultiLineCaption(rawFetched);
        const urls = (res.data.item.mediaUrls || []) as string[];
        const kinds = (res.data.item.mediaKinds || []) as Array<'video' | 'image'>;
        setBulkDrawerPreviews((prev) => ({
          ...prev,
          [trimmed]: {
            loading: false,
            caption: fetchedCaption,
            mediaUrls: urls,
            mediaKinds: kinds,
            videoCount: Number(res.data.item.videoCount || 0),
            imageCount: Number(res.data.item.imageCount || 0),
            watermarkRemoved: Boolean(res.data.item.watermarkRemoved),
          },
        }));
      } else {
        setBulkDrawerPreviews((prev) => ({ ...prev, [trimmed]: { loading: false, error: res.data?.message || 'Không cào được' } }));
      }
    } catch (err: any) {
      setBulkDrawerPreviews((prev) => ({ ...prev, [trimmed]: { loading: false, error: err?.response?.data?.message || 'Lỗi cào' } }));
    }
  }, [bulkDrawerPreviews]);

  const updateDrawerPreviewCaption = useCallback((url: string, caption: string) => {
    setBulkDrawerPreviews((prev) => ({
      ...prev,
      [url]: {
        ...(prev[url] || { loading: false }),
        caption,
      },
    }));
  }, []);

  const moveDrawerMedia = useCallback((url: string, fromIndex: number, toIndex: number) => {
    setBulkDrawerPreviews((prev) => {
      const cur = prev[url];
      if (!cur || !cur.mediaUrls) return prev;
      if (toIndex < 0 || toIndex >= cur.mediaUrls.length) return prev;
      const newUrls = [...cur.mediaUrls];
      const newKinds = cur.mediaKinds ? [...cur.mediaKinds] : [];
      const [movedUrl] = newUrls.splice(fromIndex, 1);
      newUrls.splice(toIndex, 0, movedUrl);
      if (newKinds.length > fromIndex) {
        const [movedKind] = newKinds.splice(fromIndex, 1);
        newKinds.splice(toIndex, 0, movedKind);
      }
      return {
        ...prev,
        [url]: {
          ...cur,
          mediaUrls: newUrls,
          mediaKinds: newKinds,
        },
      };
    });
  }, []);

  const removeDrawerMedia = useCallback((url: string, index: number) => {
    setBulkDrawerPreviews((prev) => {
      const cur = prev[url];
      if (!cur || !cur.mediaUrls) return prev;
      const targetUrl = cur.mediaUrls[index];
      const targetKind = cur.mediaKinds?.[index];
      const isVid = isMediaVideo(targetUrl, targetKind);
      const newUrls = cur.mediaUrls.filter((_, i) => i !== index);
      const newKinds = cur.mediaKinds ? cur.mediaKinds.filter((_, i) => i !== index) : [];
      return {
        ...prev,
        [url]: {
          ...cur,
          mediaUrls: newUrls,
          mediaKinds: newKinds,
          videoCount: isVid ? Math.max(0, (cur.videoCount || 1) - 1) : cur.videoCount,
          imageCount: !isVid ? Math.max(0, (cur.imageCount || 1) - 1) : cur.imageCount,
        },
      };
    });
  }, []);

  const resetDrawerMedia = useCallback((url: string) => {
    setBulkDrawerPreviews((prev) => {
      const cur = prev[url];
      if (!cur || !cur.originalMediaUrls) return prev;
      return {
        ...prev,
        [url]: {
          ...cur,
          mediaUrls: [...cur.originalMediaUrls],
          mediaKinds: cur.originalMediaKinds ? [...cur.originalMediaKinds] : [],
        },
      };
    });
  }, []);

  const updateDrawerComment = useCallback((url: string, comment: string) => {
    setBulkDrawerPreviews((prev) => ({
      ...prev,
      [url]: {
        ...(prev[url] || { loading: false }),
        affiliateComment: comment,
      },
    }));
  }, []);

  const toggleDrawerSkipComment = useCallback((url: string) => {
    setBulkDrawerPreviews((prev) => {
      const cur = prev[url];
      return {
        ...prev,
        [url]: {
          ...(cur || { loading: false }),
          skipComment: !cur?.skipComment,
        },
      };
    });
  }, []);

  const toggleDrawerCredit = useCallback((url: string) => {
    setBulkDrawerPreviews((prev) => {
      const cur = prev[url];
      return {
        ...prev,
        [url]: {
          ...(cur || { loading: false }),
          includeCredit: cur?.includeCredit === false ? true : false,
        },
      };
    });
  }, []);

  const removeUrlFromBulkText = useCallback((urlToRemove: string) => {
    setBulkText((prev) => {
      const lines = prev.split(/\r?\n/);
      const remaining = lines.filter((line) => !line.includes(urlToRemove.trim()));
      return remaining.join('\n');
    });
  }, []);

  const fetchAllDrawerPreviews = useCallback(() => {
    bulkPasteSummary.finalUrls.forEach((url, idx) => {
      setBulkDrawerPreviews((prev) => ({ ...prev, [url]: { loading: false } }));
      setTimeout(() => fetchOneDrawerPreview(url), idx * 150);
    });
  }, [bulkPasteSummary.finalUrls, fetchOneDrawerPreview]);

  // Tự động tải trước hình ảnh, video & caption cho TẤT CẢ các link vừa dán vào Drawer
  useEffect(() => {
    if (!bulkModalVisible || bulkPasteSummary.finalUrls.length === 0) return;
    const timer = setTimeout(() => {
      bulkPasteSummary.finalUrls.forEach((url, idx) => {
        const p = bulkDrawerPreviews[url.trim()];
        // CHỈ cào nếu bài THẬT SỰ chưa có thông tin — BỎ QUA nếu đã cào từ Group Hunter hoặc đã có caption/media
        if (!p || (!p.loading && !p.caption && (!p.mediaUrls || p.mediaUrls.length === 0) && !p.watermarkRemoved && !p.error)) {
          setTimeout(() => fetchOneDrawerPreview(url), idx * 180);
        }
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [bulkModalVisible, bulkPasteSummary.finalUrls, bulkDrawerPreviews, fetchOneDrawerPreview]);

  // Số lượng thống kê bài viết theo từng trạng thái (Ưu tiên số đếm chính xác từ DB)
  const postCounts = useMemo(() => {
    if (queueCounts) {
      return {
        all: queueCounts.all ?? 0,
        processing: queueCounts.processing ?? 0,
        pending: queueCounts.pending ?? 0,
        published: queueCounts.published ?? 0,
        failed: queueCounts.failed ?? 0,
      };
    }
    const all = posts || [];
    return {
      all: all.length,
      processing: all.filter((p) => p.status === 'PROCESSING').length,
      pending: all.filter((p) => p.status === 'PENDING').length,
      published: all.filter((p) => p.status === 'PUBLISHED').length,
      failed: all.filter((p) => p.status === 'FAILED' || p.status === 'CANCELLED').length,
    };
  }, [queueCounts, posts]);

  // Lọc nâng cao bảng Lịch sử theo Nhóm, Page đăng, Trạng thái & Từ khóa
  const filteredHistoryPosts = useMemo(() => {
    return (posts || []).filter((post) => {
      // 1. Lọc theo Nhóm / Fanpage
      if (historyGroupFilter !== 'ALL') {
        const raw = (post.targetGroupNames || '').replace(/^GROUP_ONLY_ANON:|^GROUP_ONLY:/, '');
        const groupMatched = raw.split(',').map((v) => v.trim()).includes(historyGroupFilter);
        const fanpageMatched = post.targetFanpageId === historyGroupFilter;
        if (!groupMatched && !fanpageMatched) return false;
      }

      // 2. Lọc theo Trạng thái
      if (historyStatusFilter !== 'ALL') {
        if (historyStatusFilter === 'PROCESSING' && post.status !== 'PROCESSING') return false;
        if (historyStatusFilter === 'PENDING' && post.status !== 'PENDING') return false;
        if (historyStatusFilter === 'PUBLISHED' && post.status !== 'PUBLISHED') return false;
        if (historyStatusFilter === 'FAILED' && post.status !== 'FAILED' && post.status !== 'CANCELLED') return false;
      }

      // 3. Lọc theo Từ khóa tìm kiếm
      if (historySearchText.trim()) {
        const query = historySearchText.toLowerCase();
        const titleMatch = (post.title || '').toLowerCase().includes(query);
        const contentMatch = (post.content || '').toLowerCase().includes(query);
        const groupMatch = (post.targetGroupNames || '').toLowerCase().includes(query);
        const idMatch = String(post.id).includes(query);
        const linkMatch = (post.publishedPostUrl || '').toLowerCase().includes(query)
          || (post.publishedGroupPostUrls || '').toLowerCase().includes(query);
        if (!titleMatch && !contentMatch && !groupMatch && !idMatch && !linkMatch) return false;
      }

      // 4. Lọc theo Page đang đảm nhận bài đăng
      if (historyPageFilter !== 'ALL') {
        const posterName = resolvePosterIdentityName(post) || 'Chưa gán Page';
        if (posterName !== historyPageFilter) return false;
      }

      return true;
    });
  }, [posts, historyGroupFilter, historyStatusFilter, historySearchText, historyPageFilter, resolvePosterIdentityName]);

  // Thống kê các chỉ số theo từng Nhóm / Fanpage kèm phân bổ Page đang chờ đăng:
  // 1. Số bài đã đăng THÀNH CÔNG HÔM NAY (publishedToday)
  // 2. Số bài đã đăng THÀNH CÔNG TUẦN NÀY (publishedThisWeek) / THÁNG NÀY (publishedThisMonth)
  // 3. Số bài ĐANG CHỜ ĐĂNG / ĐÃ LÊN LỊCH HẸN (pendingCount)
  // 4. Số bài BỊ LỖI (failedCount)
  // 5. Danh sách phân bổ chi tiết các Page đang nhận bài chờ đăng (pendingPagesList)
  const groupStatsMap = useMemo(() => {
    const today = dayjs();
    const map = new Map<string, GroupStatItem>();

    (groupAccountsWithId || []).forEach((g) => {
      map.set(g.platformAccountId, {
        publishedToday: 0,
        publishedThisWeek: 0,
        publishedThisMonth: 0,
        pendingCount: 0,
        failedCount: 0,
        pendingByPage: new Map(),
        pendingPagesList: [],
      });
    });

    (posts || []).forEach((post) => {
      const rawGroups = (post.targetGroupNames || '').replace(/^GROUP_ONLY_ANON:|^GROUP_ONLY:/, '');
      const groupIds = rawGroups.split(',').map((v) => v.trim()).filter(Boolean);

      // Nếu bài đăng vào Fanpage đơn lẻ
      if (post.targetFanpageId) {
        const fpId = post.targetFanpageId.split(':')[0];
        if (fpId && !groupIds.includes(fpId)) {
          groupIds.push(fpId);
        }
      }

      const isPending = post.status === 'PENDING' || post.status === 'PROCESSING';
      const posterName = resolvePosterIdentityName(post) || 'Chưa gán Page';
      const isAnon = !!(post.targetGroupNames?.startsWith('GROUP_ONLY_ANON:') || post.targetFanpageId === 'PERSONAL_PROFILE');

      groupIds.forEach((id) => {
        let stat = map.get(id);
        if (!stat) {
          stat = {
            publishedToday: 0,
            publishedThisWeek: 0,
            publishedThisMonth: 0,
            pendingCount: 0,
            failedCount: 0,
            pendingByPage: new Map(),
            pendingPagesList: [],
          };
          map.set(id, stat);
        }

        if (post.status === 'PUBLISHED') {
          if (post.publishedAt && dayjs(post.publishedAt).isSame(today, 'day')) {
            stat.publishedToday += 1;
          }
          if (post.publishedAt && dayjs(post.publishedAt).isSame(today, 'week')) {
            stat.publishedThisWeek += 1;
          }
          if (post.publishedAt && dayjs(post.publishedAt).isSame(today, 'month')) {
            stat.publishedThisMonth += 1;
          }
        } else if (isPending) {
          stat.pendingCount += 1;
          if (post.scheduledAt) {
            if (!stat._pendingDates) stat._pendingDates = [];
            stat._pendingDates.push(post.scheduledAt);
          }
          const cur = stat.pendingByPage.get(posterName) || { count: 0, isAnon };
          cur.count += 1;
          stat.pendingByPage.set(posterName, cur);
        } else if (post.status === 'FAILED' || post.status === 'CANCELLED') {
          stat.failedCount += 1;
        }
      });
    });

    // Tính tỷ lệ % và sắp xếp danh sách Page cho từng nhóm
    map.forEach((stat) => {
      const list: PendingPageBreakdownItem[] = [];
      stat.pendingByPage.forEach((val, name) => {
        const percent = stat.pendingCount > 0 ? Math.round((val.count / stat.pendingCount) * 100) : 0;
        list.push({
          pageName: name,
          count: val.count,
          percent,
          isAnon: val.isAnon,
        });
      });
      list.sort((a, b) => b.count - a.count);
      stat.pendingPagesList = list;

      // Tính toán mốc thời gian rải bài (Timeline Spread & Bài cuối cùng)
      if (stat._pendingDates && stat._pendingDates.length > 0) {
        stat._pendingDates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        stat.nextScheduledAt = stat._pendingDates[0];
        stat.lastScheduledAt = stat._pendingDates[stat._pendingDates.length - 1];

        const lastD = dayjs(stat.lastScheduledAt);
        if (lastD.isSame(today, 'day')) {
          stat.todayFinishTimeText = lastD.format('HH:mm');
        } else if (lastD.isSame(today.add(1, 'day'), 'day')) {
          stat.todayFinishTimeText = `${lastD.format('HH:mm')} (mai)`;
        } else {
          stat.todayFinishTimeText = lastD.format('HH:mm DD/MM');
        }

        if (stat._pendingDates.length > 1 && stat.nextScheduledAt && stat.lastScheduledAt) {
          const firstMs = new Date(stat.nextScheduledAt).getTime();
          const lastMs = new Date(stat.lastScheduledAt).getTime();
          const diffMin = (lastMs - firstMs) / (60 * 1000);
          const avg = diffMin / (stat._pendingDates.length - 1);
          stat.avgGapMinutes = Math.max(0.5, Math.round(avg * 10) / 10);
        }

        // Gom các bài theo từng khung giờ (VD: 19h: 12 bài, 20h: 14 bài, 21h: 6 bài...)
        const hourMap = new Map<string, number>();
        stat._pendingDates.forEach((iso) => {
          const d = dayjs(iso);
          const label = d.isSame(today, 'day') ? `${d.format('HH')}h` : `${d.format('HH')}h (${d.format('DD/MM')})`;
          hourMap.set(label, (hourMap.get(label) || 0) + 1);
        });
        stat.hourlySlots = Array.from(hourMap.entries()).map(([hour, count]) => ({ hour, count }));
      }
    });

    return map;
  }, [posts, groupAccountsWithId, resolvePosterIdentityName]);

  // Thống kê phân bổ các Page đang nhận bài chờ đăng cho Phạm vi hiện tại (Nhóm đang chọn hoặc Toàn bộ hệ thống)
  const currentPendingDistribution = useMemo(() => {
    // 1. Nếu đang chọn một Nhóm cụ thể
    if (historyGroupFilter !== 'ALL') {
      const stat = groupStatsMap.get(historyGroupFilter);
      const matchedGroup = groupAccountsWithId.find((g) => g.platformAccountId === historyGroupFilter);
      const groupName = matchedGroup ? stripEmojiPrefix(matchedGroup.pageName) || matchedGroup.platformAccountId : historyGroupFilter;
      return {
        scopeTitle: groupName,
        isGroupScope: true,
        totalPending: stat?.pendingCount || 0,
        pagesList: stat?.pendingPagesList || [],
      };
    }

    // 2. Nếu đang chọn "Tất cả nhóm" (ALL)
    const allMap = new Map<string, { count: number; isAnon?: boolean }>();
    let totalPending = 0;
    (posts || []).forEach((post) => {
      if (post.status === 'PENDING' || post.status === 'PROCESSING') {
        totalPending += 1;
        const posterName = resolvePosterIdentityName(post) || 'Chưa gán Page';
        const isAnon = !!(post.targetGroupNames?.startsWith('GROUP_ONLY_ANON:') || post.targetFanpageId === 'PERSONAL_PROFILE');
        const cur = allMap.get(posterName) || { count: 0, isAnon };
        cur.count += 1;
        allMap.set(posterName, cur);
      }
    });

    const pagesList: PendingPageBreakdownItem[] = [];
    allMap.forEach((val, name) => {
      const percent = totalPending > 0 ? Math.round((val.count / totalPending) * 100) : 0;
      pagesList.push({
        pageName: name,
        count: val.count,
        percent,
        isAnon: val.isAnon,
      });
    });
    pagesList.sort((a, b) => b.count - a.count);

    return {
      scopeTitle: 'Toàn bộ hệ thống (Tất cả nhóm)',
      isGroupScope: false,
      totalPending,
      pagesList,
    };
  }, [historyGroupFilter, groupStatsMap, groupAccountsWithId, posts, resolvePosterIdentityName]);

  // Xử lý Đăng ngay tất cả các bài được chọn trong hàng đợi
  const handleBulkPublishNow = async () => {
    if (selectedRowKeys.length === 0) return;
    setIsBulkProcessing(true);
    message.loading(`🚀 Đang kích hoạt xuất bản ${selectedRowKeys.length} bài viết...`, 0);
    let count = 0;
    for (const key of selectedRowKeys) {
      try {
        await api.post(`/queue/${key}/publish`);
        count++;
      } catch (e) {
        console.error(e);
      }
    }
    message.destroy();
    message.success(`🚀 Đã kích hoạt đăng thành công ${count}/${selectedRowKeys.length} bài viết!`);
    setSelectedRowKeys([]);
    setIsBulkProcessing(false);
    queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
  };

  // Thuật toán chia đều khung giờ trong ngày & rải nhiều ngày (Smart Window, Past-time Protection & Auto Overflow)
  const computeTimeWindowSchedule = useCallback((
    targetDate: any,
    start: any,
    end: any,
    count: number,
    maxPerDay?: number, // -1 = Tự động chống dồn (Khuyên dùng), 0 = 1 ngày (có bảo vệ tối thiểu), >0 = max bài/ngày
    minIntervalMinutes?: number, // Khoảng cách tối thiểu giữa 2 bài
    sameDayMinGap: number = 10 // Chế độ "Đăng trong ngày": khoảng cách tối thiểu, tự kéo giờ kết thúc tới 23:30 nếu cần
  ): Dayjs[] => {
    if (count <= 0) return [];

    const now = dayjs();
    const baseDate = dayjs.isDayjs(targetDate) && targetDate.isValid() ? targetDate : dayjs(targetDate || new Date());
    const startObj = dayjs.isDayjs(start) && start.isValid() ? start : dayjs(start || new Date());
    const endObj = dayjs.isDayjs(end) && end.isValid() ? end : dayjs(end || new Date());

    const startH = startObj.isValid() ? startObj.hour() : 9;
    const startM = startObj.isValid() ? startObj.minute() : 0;
    const endH = endObj.isValid() ? endObj.hour() : 18;
    const endM = endObj.isValid() ? endObj.minute() : 0;

    const result: Dayjs[] = [];
    let remainingCount = count;
    let dayOffset = 0;

    // Khoảng cách an toàn tối thiểu giữa 2 bài (phút) — mặc định 30 phút, tối thiểu 10 phút
    const effectiveMinInterval = Math.max(10, minIntervalMinutes || desiredMinInterval || 30);

    while (remainingCount > 0 && dayOffset < 365) {
      const currentDay = baseDate.clone().add(dayOffset, 'day');
      let startDt = currentDay.clone().hour(startH).minute(startM).second(0);
      let endDt = currentDay.clone().hour(endH).minute(endM).second(0);

      if (endDt.isBefore(startDt)) {
        endDt = endDt.add(1, 'day');
      }

      // Xử lý bảo vệ thời gian quá khứ nếu là ngày HÔM NAY
      if (currentDay.isSame(now, 'day')) {
        // Nếu giờ bắt đầu đã lùi vào quá khứ so với hiện tại, tự động đẩy lên giờ hiện tại (+ 2-5 phút)
        if (startDt.isBefore(now)) {
          const next5 = Math.ceil((now.minute() + 2) / 5) * 5;
          startDt = now.clone().minute(next5).second(0);
          if (startDt.minute() >= 60) {
            startDt = startDt.add(1, 'hour').minute(0);
          }
        }
        // Nếu giờ bắt đầu đã quá sát hoặc vượt giờ kết thúc (< 15 phút còn lại), chuyển hẳn sang ngày mai để không dồn bài
        // (Chế độ "Đăng trong ngày" có thể kéo giờ kết thúc tới 23:30 nên xét theo mốc đó)
        const latestToday = currentDay.clone().hour(23).minute(30).second(0);
        const usableEnd = maxPerDay === 0 && endDt.isBefore(latestToday) ? latestToday : endDt;
        if (usableEnd.diff(startDt, 'minute') < 15) {
          dayOffset++;
          continue;
        }
      }

      const effectiveMaxPerDay = maxPerDay !== undefined ? maxPerDay : -1;

      // Chế độ "Đăng trong ngày": nếu khung giờ quá chật thì tự kéo giờ kết thúc (tối đa 23:30)
      // để các bài có tối đa không gian hoạt động trong ngày
      const dayGap = Math.max(1, sameDayMinGap);
      if (effectiveMaxPerDay === 0 && remainingCount > 1) {
        const latest = currentDay.clone().hour(23).minute(30).second(0);
        if (endDt.isBefore(latest)) {
          const needMinutes = (remainingCount - 1) * dayGap;
          if (endDt.diff(startDt, 'minute') < needMinutes) {
            const wanted = startDt.add(needMinutes, 'minute');
            endDt = wanted.isBefore(latest) ? wanted : latest;
          }
        }
      }

      const availableMinutes = Math.max(0, endDt.diff(startDt, 'minute'));

      // Số bài tối đa có thể xếp vừa vặn trong ngày này với khoảng cách tối thiểu an toàn
      const maxFit = Math.max(1, Math.floor(availableMinutes / effectiveMinInterval) + 1);

      // Tính số bài sẽ xếp vào ngày này
      let batchSize = remainingCount;

      if (effectiveMaxPerDay === -1) {
        // Chế độ Tự Động Rải Giãn Cách Chống Dồn:
        // Phân bổ tối đa số bài vừa vặn cho ngày này với khoảng cách tối thiểu effectiveMinInterval
        batchSize = Math.min(remainingCount, maxFit);
      } else if (effectiveMaxPerDay > 0) {
        // Giới hạn thủ công số bài / ngày nhưng vẫn bảo vệ không dồn ép vượt quá maxFit
        batchSize = Math.min(remainingCount, Math.min(effectiveMaxPerDay, maxFit));
      } else {
        // effectiveMaxPerDay === 0: ĐĂNG TRONG NGÀY.
        // Khi người dùng chọn "Đăng trong ngày" (đặc biệt khi đăng nhiều nhóm cùng lúc),
        // xếp TOÀN BỘ các bài vào ngày hôm nay để đăng hết trong ngày.
        // Chỉ khi giãn cách vật lý < 1 phút mới tràn.
        const maxCanFitToday = Math.max(1, Math.floor(availableMinutes / 1) + 1);
        batchSize = Math.min(remainingCount, maxCanFitToday);
      }

      if (batchSize === 1) {
        result.push(startDt);
      } else if (batchSize > 1) {
        const stepMinutes = availableMinutes / (batchSize - 1);
        for (let i = 0; i < batchSize; i++) {
          result.push(startDt.add(Math.round(i * stepMinutes), 'minute'));
        }
      }

      remainingCount -= batchSize;
      dayOffset++;
    }

    return result;
  }, [desiredMinInterval]);

  // Thuật toán đan xen (Round-Robin) các bài viết theo Điểm đăng (Group / Fanpage) để chống dính chùm bài
  const interleavePostsByTarget = useCallback((postList: PostQueue[]): PostQueue[] => {
    if (postList.length <= 1) return postList;

    const buckets = new Map<string, PostQueue[]>();
    postList.forEach((p) => {
      const key = p.targetGroupNames || p.targetFanpageId || 'PAGE_FEED';
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key)!.push(p);
    });

    if (buckets.size <= 1) return postList;

    const bucketArrays = Array.from(buckets.values());
    const maxLen = Math.max(...bucketArrays.map((arr) => arr.length));

    const result: PostQueue[] = [];
    for (let i = 0; i < maxLen; i++) {
      for (const arr of bucketArrays) {
        if (i < arr.length) {
          result.push(arr[i]);
        }
      }
    }

    return result;
  }, []);

  // Danh sách bài viết được nhắm đến để phân bổ lại giờ
  const rescheduleTargetPosts = useMemo(() => {
    const allPending = (posts || []).filter((p) => p.status === 'PENDING');
    let list: PostQueue[] = [];
    if (bulkRescheduleTargetScope === 'SELECTED') {
      const selectedSet = new Set(selectedRowKeys.map((k) => String(k)));
      list = allPending.filter((p) => selectedSet.has(String(p.id)));
    } else {
      list = allPending;
    }
    const sorted = [...list].sort((a, b) => {
      const tA = a.scheduledAt ? dayjs(a.scheduledAt).valueOf() : 0;
      const tB = b.scheduledAt ? dayjs(b.scheduledAt).valueOf() : 0;
      return tA - tB;
    });

    // Chế độ Viral tự đan xen theo điểm đăng nên không cần round-robin ở đây
    return bulkRescheduleInterleave && bulkRescheduleMode !== 'VIRAL' ? interleavePostsByTarget(sorted) : sorted;
  }, [posts, bulkRescheduleTargetScope, selectedRowKeys, bulkRescheduleInterleave, bulkRescheduleMode, interleavePostsByTarget]);

  // Seed mới mỗi lần mở modal: preview ổn định khi chỉnh tham số, khớp với lúc bấm Áp dụng
  useEffect(() => {
    if (bulkRescheduleModalVisible) setViralSeed(Date.now());
  }, [bulkRescheduleModalVisible]);

  // Preview danh sách phân bổ trước khi áp dụng
  const reschedulePreviewList = useMemo(() => {
    if (rescheduleTargetPosts.length === 0) return [];
    if (bulkRescheduleMode === 'VIRAL') {
      const targetIds = new Set(rescheduleTargetPosts.map((p) => p.id));
      const occupied = (posts || [])
        .filter((p) => (p.status === 'PENDING' || p.status === 'PROCESSING') && !targetIds.has(p.id) && p.scheduledAt)
        .map((p) => ({ key: normalizeTargetKey(p.targetGroupNames, p.targetFanpageId), time: dayjs(p.scheduledAt) }));
      const byId = new Map(rescheduleTargetPosts.map((p) => [p.id, p]));
      const schedule = computeViralSchedule(
        rescheduleTargetPosts.map((p) => ({ id: p.id, key: normalizeTargetKey(p.targetGroupNames, p.targetFanpageId) })),
        occupied,
        {
          startDate: dayjs.isDayjs(bulkRescheduleDate) ? bulkRescheduleDate : dayjs(),
          startTime: bulkRescheduleStartTime,
          endTime: bulkRescheduleEndTime,
          maxPerTargetPerDay: viralMaxPerTargetPerDay,
          minGapPerTarget: viralMinGapPerTarget,
          minGapGlobal: viralMinGapGlobal,
          jitter: viralJitter,
          seed: viralSeed,
        }
      );
      return schedule.map((r, idx) => {
        let assignedNickValue: string | undefined = undefined;
        let assignedNickName: string | undefined = undefined;
        if (bulkRescheduleDistributeNicks && bulkRescheduleSelectedNicks.length > 0) {
          assignedNickValue = bulkRescheduleSelectedNicks[idx % bulkRescheduleSelectedNicks.length];
          const matched = postingIdentities.find((a) => accountTargetValue(a) === assignedNickValue);
          assignedNickName = matched?.pageName || assignedNickValue;
        }
        return { post: byId.get(r.id)!, newTime: r.time, assignedNickValue, assignedNickName };
      });
    }
    let scheduledTimes: Dayjs[] = [];
    if (bulkRescheduleMode === 'WINDOW') {
      scheduledTimes = computeTimeWindowSchedule(
        bulkRescheduleDate,
        bulkRescheduleStartTime,
        bulkRescheduleEndTime,
        rescheduleTargetPosts.length,
        bulkRescheduleMaxPerDay,
        desiredMinInterval,
        bulkRescheduleSameDayGap
      );
    } else {
      const baseDate = dayjs.isDayjs(bulkRescheduleDate) ? bulkRescheduleDate : dayjs(bulkRescheduleDate || new Date());
      const startTime = dayjs.isDayjs(bulkRescheduleStartTime) ? bulkRescheduleStartTime : dayjs(bulkRescheduleStartTime || new Date());
      const base = baseDate.clone().hour(startTime.hour()).minute(startTime.minute()).second(0);
      scheduledTimes = rescheduleTargetPosts.map((_, i) => base.add(i * (bulkRescheduleInterval || 15), 'minute'));
    }
    const defaultFallback = dayjs.isDayjs(bulkRescheduleDate) ? bulkRescheduleDate : dayjs();
    return rescheduleTargetPosts.map((p, idx) => {
      let assignedNickValue: string | undefined = undefined;
      let assignedNickName: string | undefined = undefined;
      if (bulkRescheduleDistributeNicks && bulkRescheduleSelectedNicks.length > 0) {
        assignedNickValue = bulkRescheduleSelectedNicks[idx % bulkRescheduleSelectedNicks.length];
        const matched = postingIdentities.find((a) => accountTargetValue(a) === assignedNickValue);
        assignedNickName = matched?.pageName || assignedNickValue;
      }
      return {
        post: p,
        newTime: scheduledTimes[idx] || defaultFallback.add(idx * 15, 'minute'),
        assignedNickValue,
        assignedNickName,
      };
    });
  }, [rescheduleTargetPosts, bulkRescheduleMode, bulkRescheduleDate, bulkRescheduleStartTime, bulkRescheduleEndTime, bulkRescheduleInterval, bulkRescheduleMaxPerDay, bulkRescheduleSameDayGap, desiredMinInterval, computeTimeWindowSchedule, posts, viralMaxPerTargetPerDay, viralMinGapPerTarget, viralMinGapGlobal, viralJitter, viralSeed, bulkRescheduleDistributeNicks, bulkRescheduleSelectedNicks, postingIdentities]);

  // Thống kê nhanh cho preview: số ngày, số bài giờ vàng, khoảng cách thực tế
  const reschedulePreviewStats = useMemo(() => {
    const list = reschedulePreviewList;
    const days = new Set(list.map((i) => i.newTime.format('YYYY-MM-DD')));
    const sorted = [...list].sort((a, b) => a.newTime.valueOf() - b.newTime.valueOf());
    const sameDayGaps: number[] = [];
    const lastByKey = new Map<string, Dayjs>();
    let minTargetGap = Infinity;
    sorted.forEach((item, i) => {
      if (i > 0 && item.newTime.isSame(sorted[i - 1].newTime, 'day')) {
        sameDayGaps.push(item.newTime.diff(sorted[i - 1].newTime, 'minute'));
      }
      const key = normalizeTargetKey(item.post.targetGroupNames, item.post.targetFanpageId);
      const last = lastByKey.get(key);
      if (last) minTargetGap = Math.min(minTargetGap, item.newTime.diff(last, 'minute'));
      lastByKey.set(key, item.newTime);
    });
    const hours = new Array(24).fill(0);
    list.forEach((i) => { hours[i.newTime.hour()]++; });
    const startDay = dayjs.isDayjs(bulkRescheduleDate) ? bulkRescheduleDate : dayjs();
    const onStartDay = sorted.filter((i) => i.newTime.isSame(startDay, 'day'));
    return {
      spilled: list.length - onStartDay.length,
      lastOnStartDay: onStartDay.length ? onStartDay[onStartDay.length - 1].newTime : null,
      days: days.size,
      golden: list.filter((i) => isGoldenHour(i.newTime)).length,
      avgGap: sameDayGaps.length ? Math.round(sameDayGaps.reduce((a, b) => a + b, 0) / sameDayGaps.length) : 0,
      minTargetGap: Number.isFinite(minTargetGap) ? minTargetGap : null,
      hours,
      targets: lastByKey.size,
    };
  }, [reschedulePreviewList, bulkRescheduleDate]);

  // Xử lý Phân bổ lại giờ hàng loạt cho hàng đợi bài viết (Atomic Batch API)
  const handleApplyBulkReschedule = async () => {
    if (rescheduleTargetPosts.length === 0) {
      message.warning('Không có bài viết nào ở trạng thái "Chờ đăng" (Pending) để chia lại giờ!');
      return;
    }

    setIsBulkProcessing(true);
    try {
      const updates = reschedulePreviewList.map((item) => ({
        id: Number(item.post.id),
        scheduledAt: (item.newTime || dayjs()).format('YYYY-MM-DDTHH:mm:ss'),
        ...(item.assignedNickValue ? { targetFanpageId: item.assignedNickValue } : {}),
      }));

      const res = await api.post('/queue/reschedule-batch', { updates });
      if (res.data?.success) {
        message.success(`🗓️ Đã phân bổ lại lịch đăng cho ${res.data.updatedCount || updates.length} bài viết thành công!${bulkRescheduleDistributeNicks && bulkRescheduleSelectedNicks.length > 0 ? ` (Đã chia đều qua ${bulkRescheduleSelectedNicks.length} Nick)` : ''}`);
        setBulkRescheduleModalVisible(false);
        setSelectedRowKeys([]);
        queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
      } else {
        message.error(res.data?.message || 'Có lỗi khi cập nhật lịch đăng');
      }
    } catch (e: any) {
      console.error(e);
      message.error('Lỗi khi chia lại giờ: ' + (e?.response?.data?.message || e.message || 'Lỗi mạng'));
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // Xử lý Xóa hàng loạt các bài được chọn
  const handleBulkDelete = async () => {
    if (selectedRowKeys.length === 0) return;
    setIsBulkProcessing(true);
    try {
      const numericIds = selectedRowKeys.map((k) => Number(k)).filter((n) => !isNaN(n));
      await api.post('/queue/batch-delete', { ids: numericIds });
      message.success(`🗑️ Đã xóa thành công ${numericIds.length} bài viết!`);
      setSelectedRowKeys([]);
    } catch (e: any) {
      message.error('Không thể xóa bài viết: ' + (e.message || 'Lỗi hệ thống'));
    } finally {
      setIsBulkProcessing(false);
      queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
    }
  };

  // Thao tác với danh sách link
  const addLinkItem = () => {
    const lastItem = linkItems[linkItems.length - 1];
    let nextTime: Dayjs;
    if (lastItem && lastItem.scheduledAt && dayjs.isDayjs(lastItem.scheduledAt)) {
      nextTime = lastItem.scheduledAt.add(batchInterval || 15, 'minute');
    } else if (lastItem && lastItem.scheduledAt) {
      nextTime = dayjs(lastItem.scheduledAt).add(batchInterval || 15, 'minute');
    } else {
      nextTime = dayjs().add(batchInterval || 15, 'minute');
    }
    const newId = Math.random().toString(36).substring(2, 9);
    setLinkItems((prev) => [
      ...prev,
      { id: newId, url: '', isNow: false, scheduledAt: nextTime, includeCredit: true }
    ]);
    // Đưa bài vừa thêm vào vùng nhìn và đặt con trỏ sẵn trong ô link.
    window.setTimeout(() => {
      const input = document.getElementById(`post-link-${newId}`) as HTMLInputElement | null;
      input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input?.focus({ preventScroll: true });
    }, 80);
  };

  const updateLinkUrl = (id: string, url: string) => {
    setLinkItems((prev) => prev.map((item) => (item.id === id ? { ...item, url } : item)));
    const trimmed = (url || '').trim();
    if (!trimmed) {
      setPreviews((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } else if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      // Tự động tải trước Video & Caption ngay khi dán link
      const targetItem = linkItems.find((it) => it.id === id) || { id, url: trimmed, isNow: true, scheduledAt: dayjs() };
      handlePreviewLink({ ...targetItem, url: trimmed });
    }
  };

  const updateLinkAffiliate = (id: string, affiliateLink: string) => {
    setLinkItems((prev) => prev.map((item) => (item.id === id ? { ...item, affiliateLink } : item)));
  };

  const updateLinkCustomCaption = (id: string, customCaption: string) => {
    setLinkItems((prev) => prev.map((item) => (item.id === id ? { ...item, customCaption } : item)));
  };

  const updateLinkInputType = (id: string, inputType: 'LINK' | 'MANUAL') => {
    setLinkItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, inputType } : item))
    );
  };

  const updateLinkManualContent = (id: string, manualContent: string) => {
    setLinkItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, manualContent } : item))
    );
  };

  const compressImageIfNeeded = async (file: File, maxMb = 2): Promise<File> => {
    if (!file.type.startsWith('image/')) return file;
    if (file.size <= maxMb * 1024 * 1024) return file;

    return new Promise((resolve) => {
      const img = document.createElement('img');
      const reader = new FileReader();

      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };

      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        const maxDim = 2560;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(file);

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) return resolve(file);
            const compressedFile = new File([blob], (file.name || 'image').replace(/\.[^/.]+$/, '') + '.jpg', {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          },
          'image/jpeg',
          0.85
        );
      };

      img.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  };

  const handleUploadMedia = async (itemId: string, files: FileList | File[]) => {
    const rawFiles = Array.from(files);
    if (rawFiles.length === 0) return;
    const hide = message.loading(`Đang xử lý và tải lên ${rawFiles.length} tệp media...`, 0);
    try {
      for (const rawFile of rawFiles) {
        const file = await compressImageIfNeeded(rawFile);
        const formData = new FormData();
        formData.append('file', file);
        const res = await api.post('/media/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        if (res.data?.success && res.data?.url) {
          const url = res.data.url;
          const kind = res.data.mediaType === 'video' ? 'video' : 'image';
          setLinkItems((prev) =>
            prev.map((it) => {
              if (it.id !== itemId) return it;
              const currentUrls = it.manualMediaUrls || [];
              const currentKinds = it.manualMediaKinds || [];
              return {
                ...it,
                manualMediaUrls: [...currentUrls, url],
                manualMediaKinds: [...currentKinds, kind],
              };
            })
          );
        }
      }
      message.success(`Đã tải lên thành công ${rawFiles.length} tệp!`);
    } catch (err: any) {
      if (err?.response?.status === 413) {
        message.error('❌ Tệp quá lớn (vượt quá giới hạn server). Vui lòng chọn ảnh/video nhỏ hơn 100MB.');
      } else {
        message.error(err?.response?.data?.message || err?.message || 'Lỗi khi tải tệp lên');
      }
    } finally {
      hide();
    }
  };

  // Trích xuất tệp media từ Clipboard (chụp màn hình hoặc copy ảnh/video)
  const extractMediaFilesFromClipboard = (e: React.ClipboardEvent | ClipboardEvent): File[] => {
    const files: File[] = [];
    const clipboardData = (e as React.ClipboardEvent).clipboardData || (e as ClipboardEvent).clipboardData;
    if (!clipboardData) return files;

    if (clipboardData.items && clipboardData.items.length > 0) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/'))) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
    }

    if (files.length === 0 && clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const file = clipboardData.files[i];
        if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
          files.push(file);
        }
      }
    }
    return files;
  };

  // Xử lý dán Clipboard vào ô Caption hoặc ô Dropzone Media
  const handlePasteMediaFromClipboard = async (itemId: string, e: React.ClipboardEvent) => {
    const files = extractMediaFilesFromClipboard(e);
    if (files.length > 0) {
      await handleUploadMedia(itemId, files);
      message.success(`📋 Đã tự động nhận diện và tải lên ${files.length} ảnh/video từ bộ nhớ tạm!`);
      const pastedText = e.clipboardData.getData('text');
      if (!pastedText || !pastedText.trim() || pastedText.startsWith('data:image/') || pastedText.includes('blob:http')) {
        e.preventDefault();
      }
    }
  };

  // Nút dán ảnh trực tiếp từ bộ nhớ tạm
  const handlePasteFromClipboardButton = async (itemId: string) => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) {
        message.info('💡 Bạn hãy bấm tổ hợp phím Ctrl+V (hoặc Cmd+V) khi đang ở ô soạn thảo hoặc ô Media để dán ảnh!');
        return;
      }
      const items = await navigator.clipboard.read();
      const mediaFiles: File[] = [];
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/') || type.startsWith('video/')) {
            const blob = await item.getType(type);
            const ext = type.split('/')[1] || 'png';
            const file = new File([blob], `clipboard-${Date.now()}.${ext}`, { type });
            mediaFiles.push(file);
          }
        }
      }
      if (mediaFiles.length > 0) {
        await handleUploadMedia(itemId, mediaFiles);
        message.success(`📋 Đã tải lên thành công ${mediaFiles.length} ảnh từ bộ nhớ tạm!`);
      } else {
        message.warning('Không tìm thấy hình ảnh nào trong bộ nhớ tạm. Hãy Copy / Chụp ảnh trước rồi bấm dán hoặc bấm Ctrl+V!');
      }
    } catch (err: any) {
      message.info('💡 Bạn hãy bấm tổ hợp phím Ctrl+V (hoặc Cmd+V) khi đang mở bài viết để dán ảnh trực tiếp!');
    }
  };

  const handleAddManualMediaUrl = (itemId: string, rawUrl: string) => {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed) return;
    const isVideo = isMediaVideo(trimmed);
    setLinkItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const currentUrls = it.manualMediaUrls || [];
        const currentKinds = it.manualMediaKinds || [];
        return {
          ...it,
          manualMediaUrls: [...currentUrls, trimmed],
          manualMediaKinds: [...currentKinds, isVideo ? 'video' : 'image'],
        };
      })
    );
    message.success('Đã thêm liên kết media!');
  };

  const moveManualMediaItem = (itemId: string, fromIdx: number, toIdx: number) => {
    setLinkItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId || !it.manualMediaUrls) return it;
        if (toIdx < 0 || toIdx >= it.manualMediaUrls.length) return it;
        const newUrls = [...it.manualMediaUrls];
        const newKinds = it.manualMediaKinds ? [...it.manualMediaKinds] : [];
        const [itemUrl] = newUrls.splice(fromIdx, 1);
        newUrls.splice(toIdx, 0, itemUrl);
        if (newKinds.length > 0) {
          const [itemKind] = newKinds.splice(fromIdx, 1);
          newKinds.splice(toIdx, 0, itemKind);
        }
        return {
          ...it,
          manualMediaUrls: newUrls,
          manualMediaKinds: newKinds,
        };
      })
    );
  };

  const removeManualMediaItem = (itemId: string, index: number) => {
    setLinkItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId || !it.manualMediaUrls) return it;
        const newUrls = it.manualMediaUrls.filter((_, idx) => idx !== index);
        const newKinds = it.manualMediaKinds ? it.manualMediaKinds.filter((_, idx) => idx !== index) : [];
        return {
          ...it,
          manualMediaUrls: newUrls,
          manualMediaKinds: newKinds,
        };
      })
    );
  };

  const toggleCommentBox = (id: string) => {
    setLinkItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, showCommentBox: !item.showCommentBox } : item))
    );
  };

  // Bật/tắt tự động ghi "Cre: @tác giả" vào cuối caption cho riêng bài này
  const toggleIncludeCredit = (id: string) => {
    setLinkItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, includeCredit: item.includeCredit === false } : item))
    );
  };

  const resolveColorBgValue = (val: any) => {
    if (val === 'RED_PHOTO_TRICK') return 'RED_PHOTO_TRICK';
    return Boolean(val);
  };

  // Bật/tắt chế độ đăng Status Nền Đỏ (Facebook Color Post) cho riêng bài này
  const toggleColorBackground = (id: string, specificMode?: boolean | 'RED_PHOTO_TRICK') => {
    setLinkItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        let nextVal: boolean | 'RED_PHOTO_TRICK';
        if (specificMode !== undefined) {
          nextVal = specificMode;
        } else {
          nextVal = !item.colorBackground;
        }
        let nextCaption = item.customCaption;
        let nextAffiliate = item.affiliateLink;
        let nextShowComment = item.showCommentBox;

        if (nextVal) {
          const currentText = (item.customCaption !== undefined ? item.customCaption : (previews[item.id]?.caption || '')).trim();
          if (currentText.length > 130) {
            const firstSentence = currentText.split('\n')[0] || currentText;
            const hook = firstSentence.length <= 115 ? firstSentence + '... (Xem cmt 👇)' : firstSentence.slice(0, 110).trim() + '... (Xem cmt 👇)';
            nextCaption = hook;
            if (!nextAffiliate) {
              nextAffiliate = currentText;
              nextShowComment = true;
            }
          }
        }
        return {
          ...item,
          colorBackground: nextVal,
          customCaption: nextCaption,
          affiliateLink: nextAffiliate,
          showCommentBox: nextShowComment !== undefined ? nextShowComment : item.showCommentBox,
        };
      })
    );
  };

  // Bật đính kèm link nguồn tác giả cho TOÀN BỘ bài viết
  const applyEnableAllCredit = () => {
    setLinkItems((prev) =>
      prev.map((item) => ({ ...item, includeCredit: true }))
    );
    message.success('🔗 Đã BẬT đính kèm link nguồn bài viết cho TOÀN BỘ bài viết!');
  };

  // Tắt đính kèm link nguồn tác giả cho TOÀN BỘ bài viết
  const applyDisableAllCredit = () => {
    setLinkItems((prev) =>
      prev.map((item) => ({ ...item, includeCredit: false }))
    );
    message.success('🚫 Đã TẮT đính kèm link nguồn cho TOÀN BỘ bài viết!');
  };

  // Helper thay thế hoặc thêm dòng Cre: ... vào cuối caption
  const replaceOrAppendCreditText = (caption: string, creditText: string) => {
    const cleanCap = (caption || '').trim();
    let nameOnly = (creditText || '').trim();
    if (!nameOnly) return cleanCap;

    // Loại bỏ tiền tố Cre: hoặc cre: nếu có trong creditText để tránh lặp (Cre: Cre: ...)
    nameOnly = nameOnly.replace(/^(cre:\s*)+/i, '').trim();
    if (!nameOnly) return cleanCap;

    // Nếu caption đã có dòng "Cre: ..." hoặc "Cre: Cre: ..." ở cuối, thay thế sạch bằng "Cre: [nameOnly]"
    if (/(\n+|^)(Cre:\s*)+.*$/i.test(cleanCap)) {
      return cleanCap.replace(/(\n+|^)(Cre:\s*)+.*$/i, `$1Cre: ${nameOnly}`);
    }

    return cleanCap ? `${cleanCap}\n\nCre: ${nameOnly}` : `Cre: ${nameOnly}`;
  };

  // Thêm Cre: Member ẩn danh cho TOÀN BỘ bài viết trong danh sách (cập nhật trực tiếp ô Caption trên UI)
  const applyAnonymousCreditToAll = () => {
    setLinkItems((prev) =>
      prev.map((item) => {
        const curCap = item.customCaption !== undefined ? item.customCaption : (bulkDrawerPreviews[item.url]?.caption || previews[item.id]?.caption || '');
        const updatedCaption = replaceOrAppendCreditText(curCap, 'Member ẩn danh');
        return {
          ...item,
          customCaption: updatedCaption,
          includeCredit: true,
        };
      })
    );
    message.success('👤 Đã cập nhật "Cre: Member ẩn danh" vào ô Caption cho TOÀN BỘ bài viết!');
  };

  // Tách Tiêu đề (dòng 1) làm Caption bài đăng + Chuyển toàn bộ nội dung xuống ô Bình luận riêng
  const splitTitleToComment = (id: string) => {
    setLinkItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const fullText = (item.customCaption !== undefined ? item.customCaption : (bulkDrawerPreviews[item.url]?.caption || previews[item.id]?.caption || '')).trim();
        if (!fullText) return item;

        const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
        const titleLine = lines[0] || fullText;
        const restLines = lines.length > 1 ? lines.slice(1).join('\n\n') : fullText;

        return {
          ...item,
          customCaption: titleLine,
          affiliateLink: restLines,
          showCommentBox: true,
        };
      })
    );
    message.success('✂️ Đã giữ Tiêu đề ở bài đăng & tự động chuyển Nội dung xuống phần Bình luận!');
  };

  // Tách Tiêu đề ➔ Bình luận cho TOÀN BỘ bài viết trong danh sách
  const splitTitleToCommentAll = () => {
    setLinkItems((prev) =>
      prev.map((item) => {
        const fullText = (item.customCaption !== undefined ? item.customCaption : (bulkDrawerPreviews[item.url]?.caption || previews[item.id]?.caption || '')).trim();
        if (!fullText) return item;

        const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
        const titleLine = lines[0] || fullText;
        const restLines = lines.length > 1 ? lines.slice(1).join('\n\n') : fullText;

        return {
          ...item,
          customCaption: titleLine,
          affiliateLink: restLines,
          showCommentBox: true,
        };
      })
    );
    message.success('⚡️ Đã tự động tách Tiêu đề ở bài đăng & chuyển Nội dung xuống Bình luận cho TOÀN BỘ bài viết!');
  };

  // Lấy tên người đăng gốc (Tác giả gốc) cho TOÀN BỘ bài viết trong danh sách (cập nhật trực tiếp ô Caption trên UI)
  const applyOriginalAuthorCreditToAll = () => {
    setLinkItems((prev) =>
      prev.map((item) => {
        const curCap = item.customCaption !== undefined ? item.customCaption : (bulkDrawerPreviews[item.url]?.caption || previews[item.id]?.caption || '');
        const rawAuthor = previews[item.id]?.author || bulkDrawerPreviews[item.url]?.author || '';
        const isAnon = !rawAuthor || /ẩn danh|anonymous|thành viên nhóm|thành viên ẩn danh|member/i.test(rawAuthor);
        const authorName = isAnon ? 'Member ẩn danh' : rawAuthor;
        const updatedCaption = replaceOrAppendCreditText(curCap, authorName);
        return {
          ...item,
          customCaption: updatedCaption,
          includeCredit: true,
        };
      })
    );
    message.success('👤 Đã cập nhật "Cre: Tác giả gốc" vào ô Caption cho TOÀN BỘ bài viết!');
  };

  // Mở Modal nhập Cre tùy chỉnh (targetItemId = null là áp dụng hàng loạt cho tất cả bài viết)
  const openCustomCreModal = (targetItemId: string | null = null) => {
    setCustomCreTargetItemId(targetItemId);
    setCustomCreInput('');
    setIsCustomCreModalOpen(true);
  };

  // Áp dụng Cre tùy chỉnh cho bài viết
  const applyCustomCreditToPosts = (textToApply: string) => {
    const cleanText = (textToApply || '').trim();
    if (!cleanText) {
      message.warning('Vui lòng nhập nội dung Cre!');
      return;
    }

    setLinkItems((prev) =>
      prev.map((item) => {
        if (customCreTargetItemId && item.id !== customCreTargetItemId) {
          return item;
        }
        const curCap = item.customCaption !== undefined ? item.customCaption : (bulkDrawerPreviews[item.url]?.caption || previews[item.id]?.caption || '');
        const updatedCaption = replaceOrAppendCreditText(curCap, cleanText);
        return {
          ...item,
          customCaption: updatedCaption,
          includeCredit: true,
        };
      })
    );

    if (customCreTargetItemId) {
      message.success(`✏️ Đã cập nhật "Cre: ${cleanText}" cho bài viết!`);
    } else {
      message.success(`✏️ Đã cập nhật "Cre: ${cleanText}" vào ô Caption cho TOÀN BỘ ${linkItems.length} bài viết!`);
    }
    setIsCustomCreModalOpen(false);
  };

  // Helper chèn hoặc nối Hashtag vào caption
  const appendHashtagTextToCaption = (caption: string, hashtagText: string) => {
    const cleanCap = (caption || '').trim();
    let rawTags = (hashtagText || '').trim();
    if (!rawTags) return cleanCap;

    // Chuẩn hóa danh sách hashtag: tách theo dấu phẩy hoặc khoảng trắng
    const formattedTags = rawTags
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith('#') ? t : `#${t}`))
      .join(' ');

    if (!formattedTags) return cleanCap;

    // Kiểm tra nếu caption đã có dòng Cre ở cuối, chèn Hashtag phía TRƯỚC dòng Cre để giữ cấu trúc đẹp
    if (/(\n+|^)(Cre:\s*)+.*$/i.test(cleanCap)) {
      return cleanCap.replace(/(\n+|^)((?:Cre:\s*)+.*$)/i, (match, p1, p2) => {
        return `\n\n${formattedTags}\n\n${p2}`;
      });
    }

    return cleanCap ? `${cleanCap}\n\n${formattedTags}` : formattedTags;
  };

  // Mở Modal Hashtag (targetItemId = null là áp dụng hàng loạt cho tất cả bài viết)
  const openHashtagModal = (targetItemId: string | null = null) => {
    setHashtagTargetItemId(targetItemId);
    setHashtagInput('');
    setIsHashtagModalOpen(true);
  };

  // Áp dụng Hashtag cho bài viết
  const applyHashtagsToPosts = (tagsText: string) => {
    const cleanText = (tagsText || '').trim();
    if (!cleanText) {
      message.warning('Vui lòng nhập hoặc chọn ít nhất 1 hashtag!');
      return;
    }

    setLinkItems((prev) =>
      prev.map((item) => {
        if (hashtagTargetItemId && item.id !== hashtagTargetItemId) {
          return item;
        }
        const curCap = item.customCaption !== undefined ? item.customCaption : (bulkDrawerPreviews[item.url]?.caption || previews[item.id]?.caption || '');
        const updatedCaption = appendHashtagTextToCaption(curCap, cleanText);
        return {
          ...item,
          customCaption: updatedCaption,
        };
      })
    );

    if (hashtagTargetItemId) {
      message.success('🏷️ Đã thêm Hashtag cho bài viết!');
    } else {
      message.success(`🏷️ Đã chèn Hashtag cho TOÀN BỘ ${linkItems.length} bài viết!`);
    }
    setIsHashtagModalOpen(false);
  };

  // ── Tính năng 1-Click Chia Đều Tỉ Lệ Cho Các Page Đã Chọn ──
  const applyEqualDistributionToPosts = () => {
    if (selectedDistributePages.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 Fanpage hoặc Nick để chia đều!');
      return;
    }
    if (linkItems.length === 0) {
      message.warning('Danh sách bài viết đang trống!');
      return;
    }

    const newTargets: Record<string, string> = { ...customItemTargets };
    linkItems.forEach((item, index) => {
      newTargets[item.id] = selectedDistributePages[index % selectedDistributePages.length];
    });

    setCustomItemTargets(newTargets);
    setDistributeModalOpen(false);

    const pagesCount = selectedDistributePages.length;
    const postsCount = linkItems.length;
    const avg = Math.floor(postsCount / pagesCount);
    const remainder = postsCount % pagesCount;
    const infoText = remainder === 0
      ? `mỗi kênh nhận đúng ${avg} bài`
      : `khoảng ${avg} - ${avg + 1} bài/kênh`;

    message.success(`⚡ Đã chia đều ${postsCount} bài cho ${pagesCount} Fanpage/Nick (${infoText})! Các ô nơi đăng bên dưới đã được cập nhật.`);
  };

  const resetEqualDistribution = () => {
    setCustomItemTargets({});
    message.info('Đã xóa chia đều! Các bài viết sẽ dùng lại Fanpage mặc định đã chọn ở trên.');
  };

  // Chuyển đổi chữ thường sang chữ in đậm Unicode kiểu Facebook (Sans Bold: 𝗔𝗕𝗖)
  const toUnicodeBold = (text: string) => {
    const chars: Record<string, string> = {
      A: '𝗔', B: '𝗕', C: '𝗖', D: '𝗗', E: '𝗘', F: '𝗙', G: '𝗚', H: '𝗛', I: '𝗜', J: '𝗝', K: '𝗞', L: '𝗟', M: '𝗠',
      N: '𝗡', O: '𝗢', P: '𝗣', Q: '𝗤', R: '𝗥', S: '𝗦', T: '𝗧', U: '𝗨', V: '𝗩', W: '𝗪', X: '𝗫', Y: '𝗬', Z: '𝗭',
      a: '𝗮', b: '𝗯', c: '𝗰', d: '𝗱', e: '𝗲', f: '𝗳', g: '𝗴', h: '𝗵', i: '𝗶', j: '𝗷', k: '𝗸', l: '𝗹', m: '𝗺',
      n: '𝗻', o: '𝗼', p: '𝗽', q: '𝗾', r: '𝗿', s: '𝘀', t: '𝘁', u: '𝘂', v: '𝘃', w: '𝘄', x: '𝘅', y: '𝘆', z: '𝘇',
      '0': '𝟬', '1': '𝟭', '2': '𝟮', '3': '𝟯', '4': '𝟰', '5': '𝟱', '6': '𝟲', '7': '𝟳', '8': '𝟴', '9': '𝟵'
    };
    return text.split('').map(c => chars[c] || c).join('');
  };

  // In đậm có chân (Serif Bold: 𝐀𝐁𝐂)
  const toUnicodeSerifBold = (text: string) => {
    const chars: Record<string, string> = {
      A: '𝐀', B: '𝐁', C: '𝐂', D: '𝐃', E: '𝐄', F: '𝐅', G: '𝐆', H: '𝐇', I: '𝐈', J: '𝐉', K: '𝐊', L: '𝐋', M: '𝐌',
      N: '𝐍', O: '𝐎', P: '𝐏', Q: '𝐐', R: '𝐑', S: '𝐒', T: '𝐓', U: '𝐔', V: '𝐕', W: '𝐖', X: '𝐗', Y: '𝐘', Z: '𝐙',
      a: '𝐚', b: '𝐛', c: '𝐜', d: '𝐝', e: '𝐞', f: '𝐟', g: '𝐠', h: '𝐡', i: '𝐢', j: '𝐣', k: '𝐤', l: '𝐥', m: '𝐦',
      n: '𝐧', o: '𝐨', p: '𝐩', q: '𝐪', r: '𝐫', s: '𝐬', t: '𝐭', u: '𝐮', v: '𝐯', w: '𝐰', x: '𝐱', y: '𝐲', z: '𝐳',
      '0': '𝟎', '1': '𝟏', '2': '𝟐', '3': '𝟑', '4': '𝟒', '5': '𝟓', '6': '𝟔', '7': '𝟕', '8': '𝟖', '9': '𝟗'
    };
    return text.split('').map(c => chars[c] || c).join('');
  };

  // In nghiêng (Italic Sans: 𝘈𝘉𝘊)
  const toUnicodeItalic = (text: string) => {
    const chars: Record<string, string> = {
      A: '𝘈', B: '𝘉', C: '𝘊', D: '𝘋', E: '𝘌', F: '𝘍', G: '𝘎', H: '𝘏', I: '𝘐', J: '𝘑', K: '𝘒', L: '𝘓', M: '𝘔',
      N: '𝘕', O: '𝘖', P: '𝘗', Q: '𝘘', R: '𝘙', S: '𝘚', T: '𝘛', U: '𝘜', V: '𝘝', W: '𝘞', X: '𝘟', Y: '𝘠', Z: '𝘡',
      a: '𝘢', b: '𝘣', c: '𝘤', d: '𝘥', e: '𝘦', f: '𝘧', g: '𝘨', h: '𝘩', i: '𝘪', j: '𝘫', k: '𝘬', l: '𝘭', m: '𝘮',
      n: '𝘯', o: '𝘰', p: '𝘱', q: '𝘲', r: '𝘳', s: '𝘴', t: '𝘵', u: '𝘶', v: '𝘷', w: '𝘸', x: '𝘹', y: '𝘺', z: '𝘻'
    };
    return text.split('').map(c => chars[c] || c).join('');
  };

  // In đậm nghiêng (Bold Italic Sans: 𝘼𝘽𝘾)
  const toUnicodeBoldItalic = (text: string) => {
    const chars: Record<string, string> = {
      A: '𝘼', B: '𝘽', C: '𝘾', D: '𝘿', E: '𝙀', F: '𝙁', G: '𝙂', H: '𝙃', I: '𝙄', J: '𝙅', K: '𝙆', L: '𝙇', M: '𝙈',
      N: '𝙉', O: '𝙊', P: '𝙋', Q: '𝙌', R: '𝙍', S: '𝙎', T: '𝙏', U: '𝙐', V: '𝙑', W: '𝙒', X: '𝙓', Y: '𝙔', Z: '𝙕',
      a: '𝙖', b: '𝙗', c: '𝙘', d: '𝙙', e: '𝙚', f: '𝙛', g: '𝙜', h: '𝙝', i: '𝙞', j: '𝙟', k: '𝙠', l: '𝙡', m: '𝙢',
      n: '𝙣', o: '𝙤', p: '𝙥', q: '𝙦', r: '𝙧', s: '𝙨', t: '𝙩', u: '𝙪', v: '𝙫', w: '𝙬', x: '𝙭', y: '𝙮', z: '𝙯'
    };
    return text.split('').map(c => chars[c] || c).join('');
  };

  // Gạch ngang (Strikethrough: ̶g̶i̶á̶ ̶c̶ũ̶)
  const toUnicodeStrikethrough = (text: string) => {
    return text.split('').map(c => (c === '\n' || c === '\r' ? c : c + '\u0336')).join('');
  };

  // Gạch chân (Underline: u̲n̲d̲e̲r̲l̲i̲n̲e̲)
  const toUnicodeUnderline = (text: string) => {
    return text.split('').map(c => (c === '\n' || c === '\r' ? c : c + '\u0332')).join('');
  };

  // Đóng khung vuông / tag nổi bật (【 TEXT 】)
  const toUnicodeBoxedTag = (text: string) => {
    const bolded = toUnicodeBold(text.trim());
    return `【 ${bolded} 】`;
  };

  // Định dạng Tiêu đề Lớn H1 (Heading 1)
  const toUnicodeHeading1 = (text: string) => {
    const clean = text.trim();
    const bolded = toUnicodeBold(clean.toUpperCase());
    return `📌 ━━━━━━━━ ${bolded} ━━━━━━━━\n`;
  };

  // Định dạng Tiêu đề Vừa H2 (Heading 2)
  const toUnicodeHeading2 = (text: string) => {
    const clean = text.trim();
    const bolded = toUnicodeBold(clean);
    return `👉 ${bolded}:\n`;
  };

  // Áp dụng định dạng thông minh cho đoạn văn bản đang bôi đen hoặc toàn bộ ô soạn bài
  const applyTransformToSelection = (id: string, transformFn: (text: string) => string, successMsg?: string) => {
    const el = document.getElementById(`manual-content-textarea-${id}`) as HTMLTextAreaElement | null;
    const item = linkItems.find((i) => i.id === id);
    const currentVal = item?.manualContent || '';
    if (!el) {
      updateLinkManualContent(id, transformFn(currentVal));
      if (successMsg) message.success(successMsg);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start !== undefined && end !== undefined && start !== end) {
      const selected = currentVal.substring(start, end);
      const transformed = transformFn(selected);
      const nextVal = currentVal.substring(0, start) + transformed + currentVal.substring(end);
      updateLinkManualContent(id, nextVal);
      if (successMsg) message.success(successMsg);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start, start + transformed.length);
      }, 50);
    } else {
      if (currentVal.trim()) {
        updateLinkManualContent(id, transformFn(currentVal));
        if (successMsg) message.success(successMsg);
      } else {
        const sample = transformFn('Tiêu đề bài viết');
        updateLinkManualContent(id, sample);
        if (successMsg) message.success(successMsg);
      }
    }
  };

  // Chèn mẫu nội dung (CTA, Đường kẻ, Bullet point...) ngay tại vị trí con trỏ
  const insertSnippetAtCursor = (id: string, snippet: string) => {
    const el = document.getElementById(`manual-content-textarea-${id}`) as HTMLTextAreaElement | null;
    const item = linkItems.find((i) => i.id === id);
    const currentVal = item?.manualContent || '';
    if (!el) {
      const spacer = currentVal && !currentVal.endsWith('\n') ? '\n' : '';
      updateLinkManualContent(id, currentVal + spacer + snippet);
      return;
    }
    const start = el.selectionStart ?? currentVal.length;
    const end = el.selectionEnd ?? currentVal.length;
    const nextVal = currentVal.substring(0, start) + snippet + currentVal.substring(end);
    updateLinkManualContent(id, nextVal);
    setTimeout(() => {
      el.focus();
      const nextPos = start + snippet.length;
      el.setSelectionRange(nextPos, nextPos);
    }, 50);
  };

  const [dragOverDropzone, setDragOverDropzone] = useState<string | null>(null);

  // Bật/tắt hoàn toàn KHÔNG bình luận gì (bỏ qua cả cmt riêng lẫn cmt mặc định) cho riêng bài này
  const toggleSkipComment = (id: string) => {
    setLinkItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, skipComment: !item.skipComment } : item))
    );
  };

  // Bình luận link Affiliate vào bài đăng trong NHÓM là opt-in: mặc định TẮT, chỉ tick mới bình luận.
  // Không ảnh hưởng bài đăng lên Fanpage (leg đó vẫn tự bình luận mặc định như cũ).
  const toggleGroupComment = (id: string) => {
    setLinkItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, groupCommentEnabled: !item.groupCommentEnabled } : item))
    );
  };

  const updateLinkMode = (id: string, isNow: boolean) => {
    setLinkItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, isNow, scheduledAt: isNow ? dayjs() : dayjs().add(15, 'minute') }
          : item
      )
    );
  };

  const updateLinkTime = (id: string, time: Dayjs | null) => {
    if (!time) return;
    setLinkItems((prev) => prev.map((item) => (item.id === id ? { ...item, isNow: false, scheduledAt: time } : item)));
  };

  const removeLinkItem = (id: string) => {
    setPreviews((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (linkItems.length <= 1) {
      setLinkItems([{ id: '1', url: '', isNow: true, scheduledAt: dayjs() }]);
      return;
    }
    setLinkItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Chia đều thời gian cho tất cả các dòng hiện có trên form
  const handleApplyBatchSchedule = () => {
    const now = dayjs();
    if (linkItems.length === 0) return;
    setQueueAppendMode(false);

    if (batchScheduleMode === 'WINDOW') {
      const dateObj = dayjs.isDayjs(batchWindowDate) ? batchWindowDate : dayjs(batchWindowDate || new Date());
      const startObj = dayjs.isDayjs(batchWindowStartTime) ? batchWindowStartTime : dayjs().hour(9).minute(0).second(0);
      const endObj = dayjs.isDayjs(batchWindowEndTime) ? batchWindowEndTime : dayjs().hour(17).minute(30).second(0);

      const times = computeTimeWindowSchedule(
        dateObj,
        startObj,
        endObj,
        linkItems.length,
        batchWindowMaxPerDay,
        desiredMinInterval
      );
      setLinkItems((prev) =>
        prev.map((item, idx) => ({
          ...item,
          isNow: false,
          scheduledAt: times[idx] || now.add(idx * 15, 'minute'),
        }))
      );
      message.success(`⚡ Đã chia đều ${linkItems.length} bài từ ${startObj.format('HH:mm')} đến ${endObj.format('HH:mm')} ngày ${dateObj.format('DD/MM/YYYY')}!`);
    } else {
      const base = batchScheduleMode === 'NOW'
        ? now
        : (dayjs.isDayjs(batchStartTime) ? batchStartTime : dayjs(batchStartTime || new Date()));
      const intervalMinutes = batchInterval || 15;
      setLinkItems((prev) =>
        prev.map((item, idx) => {
          if (batchScheduleMode === 'NOW' && idx === 0) {
            return { ...item, isNow: true, scheduledAt: now };
          }
          return {
            ...item,
            isNow: false,
            scheduledAt: base.add(idx * intervalMinutes, 'minute'),
          };
        })
      );
      message.success(`⚡ Đã chia đều giờ cho ${linkItems.length} bài viết (khoảng cách ${batchInterval || 15} phút)!`);
    }
  };

  // Bật/tắt "Không cmt" hàng loạt cho TOÀN BỘ danh sách hiện tại, thay vì phải tick từng dòng một
  const applyDisableAllComments = () => {
    setLinkItems((prev) => prev.map((item) => ({ ...item, skipComment: true })));
    message.success(`🚫 Đã tắt bình luận cho toàn bộ ${linkItems.length} bài viết!`);
  };

  const applyEnableAllComments = () => {
    setLinkItems((prev) => prev.map((item) => ({ ...item, skipComment: false })));
    message.success(`💬 Đã bật lại bình luận tự động cho toàn bộ ${linkItems.length} bài viết!`);
  };

  // Bật/tắt hàng loạt "Bình luận trong Nhóm" — mặc định TẮT cho từng bài, dùng nút này để mở/tắt
  // đồng loạt cho cả danh sách thay vì phải tick từng dòng một.
  const applyEnableAllGroupComments = () => {
    setLinkItems((prev) => prev.map((item) => ({ ...item, groupCommentEnabled: true })));
    message.success(`💬 Đã bật bình luận trong Nhóm cho toàn bộ ${linkItems.length} bài viết!`);
  };

  const applyDisableAllGroupComments = () => {
    setLinkItems((prev) => prev.map((item) => ({ ...item, groupCommentEnabled: false })));
    message.success(`🚫 Đã tắt bình luận trong Nhóm cho toàn bộ ${linkItems.length} bài viết!`);
  };

  // Xử lý khi dán nhiều link từ Drawer (tự động loại bỏ link trùng lặp trong đợt dán và trùng với Lịch sử)
  const handleApplyBulkPaste = () => {
    const rawUrls = bulkPasteSummary.detectedUrls;

    if (rawUrls.length === 0) {
      message.error('Vui lòng dán ít nhất một đường dẫn bài viết!');
      return;
    }

    const duplicateInPastedCount = bulkPasteSummary.duplicateInInputCount;
    const duplicateInHistoryCount = bulkPasteSummary.duplicateInHistoryCount;
    const filteredUrls = bulkPasteSummary.finalUrls;

    if (filteredUrls.length === 0) {
      message.warning(`⚠️ Tất cả ${rawUrls.length} link bạn dán đều bị trùng lặp! Bật "Giữ link đã đăng" hoặc dán link mới.`);
      return;
    }

    const now = dayjs();

    let newItems: PostLinkItem[] = [];

    // ── Smart Schedule mode ──────────────────────────────────
    if (smartScheduleEnabled && smartGroupId && smartScheduleTimes.length > 0) {
      if (smartScheduleTimes.length < filteredUrls.length) {
        message.warning(
          `⚠️ Chỉ tìm được ${smartScheduleTimes.length} slot trống trong 30 ngày tới (cần ${filteredUrls.length}). Hãy tăng giới hạn bài/ngày hoặc giảm số link.`,
          7
        );
      }
      newItems = filteredUrls.map((url, idx) => {
        const cached = bulkDrawerPreviews[url];
        const customTime = customDrawerScheduledTimes[url];
        return {
          id: Math.random().toString(36).substring(2, 9),
          url,
          isNow: false,
          scheduledAt: customTime || smartScheduleTimes[idx] || now.add((idx + 1) * 10, 'minute'),
          includeCredit: cached?.includeCredit !== false,
          skipComment: !!cached?.skipComment,
          affiliateLink: cached?.affiliateComment,
          customCaption: cached?.caption,
        };
      });
    } else {
      // ── Manual / Standard mode ───────────────────────────────
      let computedTimes: Dayjs[] = [];
      if (bulkScheduleMode === 'WINDOW') {
        computedTimes = computeTimeWindowSchedule(
          bulkWindowDate,
          bulkWindowStartTime,
          bulkWindowEndTime,
          filteredUrls.length,
          bulkWindowMaxPerDay,
          desiredMinInterval
        );
      }

      newItems = filteredUrls.map((url, idx) => {
        const cached = bulkDrawerPreviews[url];
        const customTime = customDrawerScheduledTimes[url];
        const isAlreadyPosted = bulkPasteSummary.historyMatchedUrls.includes(url);

        let assignedTime: Dayjs;
        let isNow = false;

        if (bulkScheduleMode === 'WINDOW') {
          assignedTime = customTime || computedTimes[idx] || now;
        } else if (bulkScheduleMode === 'NOW') {
          if (!customTime && idx === 0 && !isAlreadyPosted) {
            isNow = true;
            assignedTime = now;
          } else {
            assignedTime = customTime || now.add(idx * bulkInterval, 'minute');
          }
        } else {
          // INTERVAL mode
          assignedTime = customTime || bulkStartTime.add(idx * bulkInterval, 'minute');
        }

        return {
          id: Math.random().toString(36).substring(2, 9),
          url,
          isNow,
          scheduledAt: assignedTime,
          includeCredit: cached?.includeCredit !== false,
          skipComment: !!cached?.skipComment,
          affiliateLink: cached?.affiliateComment,
          customCaption: cached?.caption,
        };
      });
    }

    // Tự động chuyển toàn bộ preview ảnh/video đã cào trong Drawer sang previews chính
    const initialPreviews: typeof previews = {};
    newItems.forEach((item) => {
      const cached = bulkDrawerPreviews[item.url] || bulkDrawerPreviews[item.url.trim()];
      if (cached) {
        initialPreviews[item.id] = {
          loading: false,
          caption: cached.caption || item.customCaption || '',
          author: cached.author || '',
          mediaUrls: cached.mediaUrls || [],
          mediaKinds: cached.mediaKinds || [],
          originalMediaUrls: [...(cached.originalMediaUrls || cached.mediaUrls || [])],
          originalMediaKinds: [...(cached.originalMediaKinds || cached.mediaKinds || [])],
          videoCount: cached.videoCount || 0,
          imageCount: cached.imageCount || 0,
          watermarkRemoved: cached.watermarkRemoved,
        };
        if (cached.caption && (!item.customCaption || item.customCaption.trim() === '')) {
          item.customCaption = cached.caption;
        }
      }
    });
    setPreviews((prev) => ({ ...prev, ...initialPreviews }));

    setLinkItems(newItems);
    setBulkText('');
    setFilterHistoryDuplicates(false);
    setBulkModalVisible(false);

    if (bulkAutoDistributeTwoVias) {
      setTimeout(() => {
        handleQuickSelectTwoVias();
      }, 50);
    }

    // CHỈ cào những link THỰC SỰ chưa có dữ liệu xem trước — BỎ QUA toàn bộ các link đã cào từ Group Hunter / Drawer
    newItems.forEach((item, idx) => {
      const alreadyHasPreview = initialPreviews[item.id] && (initialPreviews[item.id].caption || (initialPreviews[item.id].mediaUrls && initialPreviews[item.id].mediaUrls.length > 0));
      const alreadyHasDrawer = bulkDrawerPreviews[item.url] && (bulkDrawerPreviews[item.url].caption || (bulkDrawerPreviews[item.url].mediaUrls && bulkDrawerPreviews[item.url].mediaUrls.length > 0));
      const alreadyHasCaption = !!item.customCaption && item.customCaption.trim().length > 0;

      if (!alreadyHasPreview && !alreadyHasDrawer && !alreadyHasCaption) {
        setTimeout(() => {
          handlePreviewLink(item);
        }, idx * 160);
      }
    });

    const totalRemoved = duplicateInPastedCount + (filterHistoryDuplicates ? duplicateInHistoryCount : 0);
    const historyNote = !filterHistoryDuplicates && duplicateInHistoryCount > 0
      ? ` · ${duplicateInHistoryCount} link đã có lịch sử (vẫn giữ lại)`
      : '';
    const removedNote = totalRemoved > 0 ? ` · Lọc ${totalRemoved} link trùng nội bộ` : '';
    message.success(`🎉 Đã nạp ${filteredUrls.length} bài viết! Tất cả hình ảnh & caption đã sẵn sàng.${removedNote}${historyNote}`, 6);
  };

  // Áp dụng đợt dán và mở ngay màn hình duyệt từng bài theo phong cách Tinder
  const handleApplyAndOpenSwipeReview = () => {
    handleApplyBulkPaste();
    setTimeout(() => {
      openSwipeReview();
    }, 120);
  };


  // Xử lý chuyển toàn bộ bài lỗi về Chờ đăng (Hẹn giờ an toàn)
  const handleResetFailedBatch = async () => {
    setIsBulkProcessing(true);
    try {
      let payload: any = { ids: [] };
      if (resetFailedMode === 'TODAY_23H') {
        payload.targetDeadline = 'TODAY_23H';
      } else if (resetFailedMode === 'NOW') {
        payload.spacingSeconds = 15;
      } else {
        payload.spacingSeconds = resetFailedSpacing || 75;
      }
      const res = await api.post('/queue/reset-failed-batch', payload);
      const count = res.data?.count || 0;
      message.success(`✅ Đã chuyển thành công ${count} bài lỗi về trạng thái Chờ đăng (PENDING)! Lịch đã được phân bổ an toàn.`);
      setResetFailedModalVisible(false);
      queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Lỗi khi chuyển bài lỗi về Chờ đăng!');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // Xử lý Thử đăng lại TẤT CẢ các bài lỗi (tự động đưa vào hàng đợi với giãn cách an toàn)
  const handleRetryAllFailed = async () => {
    const failedPosts = (posts || []).filter((p) => p.status === 'FAILED');
    if (failedPosts.length === 0) {
      message.info('Không có bài viết nào bị lỗi để đăng lại!');
      return;
    }
    setIsBulkProcessing(true);
    try {
      const res = await api.post('/queue/reset-failed-batch', { spacingSeconds: 45 });
      message.success(`🚀 Đã chuyển ${res.data?.count || failedPosts.length} bài lỗi sang Chờ đăng! Hệ thống đang tự động xuất bản lần lượt.`);
      queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Lỗi khi đăng lại bài lỗi!');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // Xử lý Xóa TẤT CẢ các bài lỗi vĩnh viễn
  const handleDeleteAllFailed = async () => {
    const failedPosts = (posts || []).filter((p) => p.status === 'FAILED');
    if (failedPosts.length === 0) {
      message.info('Không có bài viết lỗi nào để xóa!');
      return;
    }
    setIsBulkProcessing(true);
    let count = 0;
    for (const p of failedPosts) {
      try {
        await api.delete(`/queue/${p.id}`);
        count++;
      } catch {
        // Ignore
      }
    }
    setIsBulkProcessing(false);
    message.success(`🗑️ Đã xóa vĩnh viễn ${count} bài viết bị lỗi khỏi CSDL!`);
    queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
  };

  // Mutation Đăng lên Fanpage (hoặc Fanpage + Nhóm)
  const postPlaywrightMutation = useMutation({
    mutationFn: async (values: any) => {
      const validItems = linkItems.filter((item) => {
        const hasUrl = !!item.url && item.url.trim().length > 0;
        const hasContent = (!!item.manualContent && item.manualContent.trim().length > 0) || (!!item.customCaption && item.customCaption.trim().length > 0);
        const hasMedia = (item.manualMediaUrls?.length || 0) > 0;
        return hasUrl || hasContent || hasMedia;
      });
      if (validItems.length === 0) {
        throw new Error('Vui lòng nhập ít nhất 1 bài viết hoặc đường dẫn URL!');
      }

      setIsPosting(true);
      setProgressPercent(20);
      setProgressStatusMsg('🚀 Bắt đầu xử lý danh sách bài viết...');

      const timer1 = setTimeout(() => {
        setProgressPercent(50);
        setProgressStatusMsg('Đang lấy nội dung và tải video/hình ảnh từ nguồn...');
      }, 2500);

      const timer2 = setTimeout(() => {
        setProgressPercent(80);
        setProgressStatusMsg('🎭 Mở trình duyệt Chromium & xuất bản...');
      }, 6000);

      try {
        const urls = validItems.map((i) =>
          (!i.url || !i.url.trim()) ? `manual://post_${i.id}` : i.url.trim()
        );
        const scheduledTimes = validItems.map((i) =>
          i.isNow ? dayjs().format('YYYY-MM-DDTHH:mm:ss') : i.scheduledAt.format('YYYY-MM-DDTHH:mm:ss')
        );
        const includeCredits = validItems.map((i) => i.includeCredit !== false);
        const commentDisabled = validItems.map((i) => !!i.skipComment);
        const customCaptions = validItems.map((i) =>
          (i.manualContent && i.manualContent.trim())
            ? i.manualContent.trim()
            : (i.customCaption !== undefined ? i.customCaption : (previews[i.id]?.caption || ''))
        );
        const customMediaUrls = validItems.map((i) => {
          let mediaStr = (i.manualMediaUrls && i.manualMediaUrls.length > 0)
            ? i.manualMediaUrls.join(',')
            : (previews[i.id]?.mediaUrls && previews[i.id].mediaUrls!.length > 0 ? previews[i.id].mediaUrls!.join(',') : '');
          if (i.colorBackground === 'RED_PHOTO_TRICK' && mediaStr.includes(',')) {
            mediaStr = mediaStr.split(',')[0].trim();
          }
          return mediaStr;
        });
        const isFirstImmediate = validItems[0].isNow;

        const effectiveGroupNames =
          postMode === 'FANPAGE_AND_GROUP' && values.groupNames && values.groupNames.length > 0
            ? values.groupNames
            : undefined;

        // Quy tắc: Không gắn link Shopee / affiliate khi đăng vào nhóm "Hội những người tin mình sắp giàu"
        const isSapGiau = isSapGiauGroup(watchedTargetGroupId, effectiveGroupNames);

        // Quy tắc bảo vệ uy tín: TUYỆT ĐỐI KHÔNG gắn link Shopee / affiliate / bán hàng khi đăng lên Fanpage "Vietnam Real Estate"
        const checkIsVietnamRealEstate = (val?: string | string[]) => {
          if (!val) return false;
          const str = (Array.isArray(val) ? val.join(" ") : String(val)).toLowerCase();
          return str.includes("100053405437835") || str.includes("vietnam real estate") || str.includes("real estate");
        };
        const isRealEstateFanpage = checkIsVietnamRealEstate(values.targetFanpageId) ||
          validItems.some(i => checkIsVietnamRealEstate(customItemTargets[i.id]));

        const savedComment = localStorage.getItem(STORAGE_KEY_COMMENT) || DEFAULT_SAVED_COMMENT;
        let effectiveDefaultComment = values.affiliateLink?.trim() || form.getFieldValue('affiliateLink')?.trim() || (savedComment && savedComment.trim()) || undefined;
        if ((isSapGiau || isRealEstateFanpage) && effectiveDefaultComment && /shopee|shp\.ee|shope\.ee|affiliate/i.test(effectiveDefaultComment)) {
          effectiveDefaultComment = undefined;
        }

        let affiliateLinks = validItems.map((i) => (i.affiliateLink && i.affiliateLink.trim().length > 0) ? i.affiliateLink.trim() : '');
        if (isSapGiau || isRealEstateFanpage) {
          affiliateLinks = affiliateLinks.map((l) => (/shopee|shp\.ee|shope\.ee|affiliate/i.test(l) ? '' : l));
        }

        let effectiveTargetFanpageIds: string[] | undefined = undefined;
        let effectiveScheduledTimes = scheduledTimes;

        const hasCustomTargets = validItems.some((i) => !!customItemTargets[i.id]);

        const rawFanpage = values.targetFanpageId;
        const selectedFanpageIds: string[] = Array.isArray(rawFanpage)
          ? rawFanpage.filter(Boolean)
          : (rawFanpage ? [String(rawFanpage)] : []);

        if (postMode === 'FANPAGE_ONLY' && (hasCustomTargets || isMultiDistributeActive || selectedFanpageIds.length > 1)) {
          const distributionPool = (multiSelectedTargets.length > 0 ? multiSelectedTargets : selectedFanpageIds);
          effectiveTargetFanpageIds = validItems.map(
            (i, idx) => customItemTargets[i.id] || calculatedDistribution[i.id]?.targetValue || distributionPool[idx % Math.max(1, distributionPool.length)] || selectedFanpageIds[0]
          );
          if (distributionStrategy === 'STAGGERED' && (isMultiDistributeActive || selectedFanpageIds.length > 1)) {
            effectiveScheduledTimes = validItems.map(
              (i) => calculatedDistribution[i.id]?.scheduledAt.format('YYYY-MM-DDTHH:mm:ss') || (i.isNow ? dayjs().format('YYYY-MM-DDTHH:mm:ss') : i.scheduledAt.format('YYYY-MM-DDTHH:mm:ss'))
            );
          }
        }

        const selectedGroupIds: string[] = Array.isArray(effectiveGroupNames)
          ? effectiveGroupNames.filter(Boolean)
          : (effectiveGroupNames ? [String(effectiveGroupNames)] : []);

        if (postMode === 'FANPAGE_AND_GROUP' && (selectedGroupIds.length > 0 || selectedFanpageIds.length > 0)) {
          const expandedUrls: string[] = [];
          const expandedScheduledTimes: string[] = [];
          const expandedCustomCaptions: string[] = [];
          const expandedCustomMediaUrls: string[] = [];
          const expandedAffiliateLinks: string[] = [];
          const expandedTargetGroupNamesList: string[] = [];
          const expandedTargetFanpageIdsList: string[] = [];
          const expandedCommentDisabled: boolean[] = [];
          const expandedGroupCommentEnabled: boolean[] = [];
          const expandedIncludeCredits: boolean[] = [];
          const expandedColorBackgrounds: (boolean | string)[] = [];

          validItems.forEach((i, itemIdx) => {
            const itemUrl = i.inputType === 'MANUAL' ? `manual://post_${i.id}` : i.url.trim();
            const itemCaption = i.inputType === 'MANUAL'
              ? (i.manualContent || '')
              : (i.customCaption !== undefined ? i.customCaption : (previews[i.id]?.caption || ''));
            let itemMedia = i.inputType === 'MANUAL'
              ? (i.manualMediaUrls && i.manualMediaUrls.length > 0 ? i.manualMediaUrls.join(',') : '')
              : (previews[i.id]?.mediaUrls && previews[i.id].mediaUrls!.length > 0 ? previews[i.id].mediaUrls!.join(',') : '');
            if (i.colorBackground === 'RED_PHOTO_TRICK' && itemMedia.includes(',')) {
              itemMedia = itemMedia.split(',')[0].trim();
            }
            const baseAffLink = (i.affiliateLink && i.affiliateLink.trim().length > 0) ? i.affiliateLink.trim() : (effectiveDefaultComment || '');
            const baseTime = i.isNow ? dayjs() : i.scheduledAt;

            const groupsToLoop = selectedGroupIds.length > 0 ? selectedGroupIds : [''];
            const fanpagesToLoop = selectedFanpageIds.length > 0 ? selectedFanpageIds : [values.targetFanpageId || ''];
            const rawItemTarget = customItemTargets[i.id];
            const itemTarget = (rawItemTarget && fanpagesToLoop.includes(rawItemTarget)) ? rawItemTarget : undefined;

            if (itemTarget) {
              groupsToLoop.forEach((gId, gIdx) => {
                const finalAffLink = resolveAffiliateLinkForGroup(gId, baseAffLink);
                const offsetMinutes = gIdx * groupStaggerInterval;
                const groupScheduledAt = baseTime.add(offsetMinutes, 'minute');

                expandedUrls.push(itemUrl);
                expandedScheduledTimes.push(groupScheduledAt.format('YYYY-MM-DDTHH:mm:ss'));
                expandedCustomCaptions.push(itemCaption);
                expandedCustomMediaUrls.push(itemMedia);
                expandedAffiliateLinks.push(finalAffLink);
                expandedTargetGroupNamesList.push(gId);
                expandedTargetFanpageIdsList.push(itemTarget);
                expandedCommentDisabled.push(Boolean(i.skipComment));
                expandedGroupCommentEnabled.push(Boolean(i.groupCommentEnabled) && isGroupCommentAllowedForGroup(gId));
                expandedIncludeCredits.push(i.includeCredit !== false);
                expandedColorBackgrounds.push(resolveColorBgValue(i.colorBackground));
              });
            } else if (groupDistributionMode === 'PAGE_PER_GROUP') {
              groupsToLoop.forEach((gId, gIdx) => {
                const fId = fanpagesToLoop[(gIdx + itemIdx) % fanpagesToLoop.length];
                const finalAffLink = resolveAffiliateLinkForGroup(gId, baseAffLink);
                const offsetMinutes = gIdx * groupStaggerInterval;
                const groupScheduledAt = baseTime.add(offsetMinutes, 'minute');

                expandedUrls.push(itemUrl);
                expandedScheduledTimes.push(groupScheduledAt.format('YYYY-MM-DDTHH:mm:ss'));
                expandedCustomCaptions.push(itemCaption);
                expandedCustomMediaUrls.push(itemMedia);
                expandedAffiliateLinks.push(finalAffLink);
                expandedTargetGroupNamesList.push(gId);
                expandedTargetFanpageIdsList.push(fId);
                expandedCommentDisabled.push(Boolean(i.skipComment));
                expandedGroupCommentEnabled.push(Boolean(i.groupCommentEnabled) && isGroupCommentAllowedForGroup(gId));
                expandedIncludeCredits.push(i.includeCredit !== false);
                expandedColorBackgrounds.push(resolveColorBgValue(i.colorBackground));
              });
            } else if (groupDistributionMode === 'ROUND_ROBIN_POSTS') {
              const gIdx = itemIdx % groupsToLoop.length;
              const gId = groupsToLoop[gIdx];
              const fId = fanpagesToLoop[itemIdx % fanpagesToLoop.length];
              const finalAffLink = resolveAffiliateLinkForGroup(gId, baseAffLink);
              const offsetMinutes = itemIdx * groupStaggerInterval;
              const groupScheduledAt = baseTime.add(offsetMinutes, 'minute');

              expandedUrls.push(itemUrl);
              expandedScheduledTimes.push(groupScheduledAt.format('YYYY-MM-DDTHH:mm:ss'));
              expandedCustomCaptions.push(itemCaption);
              expandedCustomMediaUrls.push(itemMedia);
              expandedAffiliateLinks.push(finalAffLink);
              expandedTargetGroupNamesList.push(gId);
              expandedTargetFanpageIdsList.push(fId);
              expandedCommentDisabled.push(Boolean(i.skipComment));
              expandedGroupCommentEnabled.push(Boolean(i.groupCommentEnabled) && isGroupCommentAllowedForGroup(gId));
              expandedIncludeCredits.push(i.includeCredit !== false);
              expandedColorBackgrounds.push(resolveColorBgValue(i.colorBackground));
            } else {
              groupsToLoop.forEach((gId, gIdx) => {
                fanpagesToLoop.forEach((fId, fIdx) => {
                  const finalAffLink = resolveAffiliateLinkForGroup(gId, baseAffLink);
                  const taskIndex = gIdx * fanpagesToLoop.length + fIdx;
                  const offsetMinutes = taskIndex * groupStaggerInterval;
                  const groupScheduledAt = baseTime.add(offsetMinutes, 'minute');

                  expandedUrls.push(itemUrl);
                  expandedScheduledTimes.push(groupScheduledAt.format('YYYY-MM-DDTHH:mm:ss'));
                  expandedCustomCaptions.push(itemCaption);
                  expandedCustomMediaUrls.push(itemMedia);
                  expandedAffiliateLinks.push(finalAffLink);
                  expandedTargetGroupNamesList.push(gId);
                  expandedTargetFanpageIdsList.push(fId);
                  expandedCommentDisabled.push(Boolean(i.skipComment));
                  expandedGroupCommentEnabled.push(Boolean(i.groupCommentEnabled) && isGroupCommentAllowedForGroup(gId));
                  expandedIncludeCredits.push(i.includeCredit !== false);
                  expandedColorBackgrounds.push(resolveColorBgValue(i.colorBackground));
                });
              });
            }
          });

          const isFirstImmediate = validItems[0].isNow;

          const payload = {
            urls: expandedUrls,
            scheduledTimes: expandedScheduledTimes,
            intervalMinutes: batchInterval,
            publishNow: isFirstImmediate,
            ...queueAppendPayload,
            targetFanpageId: expandedTargetFanpageIdsList[0] || selectedFanpageIds[0] || values.targetFanpageId,
            targetFanpageIds: expandedTargetFanpageIdsList,
            targetGroupNamesList: expandedTargetGroupNamesList,
            affiliateLink: effectiveDefaultComment,
            affiliateLinks: expandedAffiliateLinks,
            includeCredits: expandedIncludeCredits,
            commentDisabled: expandedCommentDisabled,
            groupCommentEnabled: expandedGroupCommentEnabled,
            colorBackgrounds: expandedColorBackgrounds,
            customCaptions: expandedCustomCaptions,
            customMediaUrls: expandedCustomMediaUrls,
            isAnonymous,
            forceRefresh,
          };

          const response = await api.post('/queue/add-from-urls', payload);
          clearTimeout(timer1);
          clearTimeout(timer2);
          setProgressPercent(100);
          setProgressStatusMsg('🎉 Đã xuất bản / thiết lập lịch giãn cách hoàn tất!');
          return response.data;
        }

        const groupCommentEnabled = validItems.map((i, idx) => {
          const itemAff = affiliateLinks && affiliateLinks.length > idx ? affiliateLinks[idx] : effectiveDefaultComment;
          return Boolean(i.groupCommentEnabled) || Boolean(itemAff && itemAff.trim().length > 0);
        });
        const colorBackgrounds = validItems.map((i) => resolveColorBgValue(i.colorBackground));

        const payload = {
          urls,
          scheduledTimes: effectiveScheduledTimes,
          intervalMinutes: batchInterval,
          publishNow: isFirstImmediate,
          ...queueAppendPayload,
          targetFanpageId: (effectiveTargetFanpageIds && effectiveTargetFanpageIds.length > 0) ? effectiveTargetFanpageIds[0] : (Array.isArray(values.targetFanpageId) ? values.targetFanpageId[0] : values.targetFanpageId),
          targetFanpageIds: effectiveTargetFanpageIds,
          affiliateLink: effectiveDefaultComment,
          affiliateLinks,
          includeCredits,
          commentDisabled,
          groupCommentEnabled,
          colorBackgrounds,
          customCaptions,
          customMediaUrls,
          groupNames: effectiveGroupNames,
          isAnonymous,
          forceRefresh,
        };

        const response = await api.post('/queue/add-from-urls', payload);
        clearTimeout(timer1);
        clearTimeout(timer2);
        setProgressPercent(100);
        setProgressStatusMsg('🎉 Đã xuất bản / thiết lập lịch hoàn tất!');
        return response.data;
      } catch (err: any) {
        clearTimeout(timer1);
        clearTimeout(timer2);
        setProgressPercent(0);
        setProgressStatusMsg('');
        setIsPosting(false);
        throw err;
      }
    },
    onSuccess: (data: any) => {
      (data?.count === 0 && data?.skippedDuplicates?.length ? message.warning : message.success)(data?.message || '🚀 Đã đăng bài thành công!');
      notifySkippedDuplicates(data);
      const cachedCount = data?.cachedUrls?.length || 0;
      if (cachedCount > 0) {
        message.info(`♻️ ${cachedCount} link dùng lại kết quả cào gần đây (chưa tới 6h trước) thay vì cào lại từ đầu. Tick "Cào lại từ đầu" nếu bài gốc vừa thay đổi.`, 6);
      }
      setIsPosting(false);
      setProgressPercent(0);
      setProgressStatusMsg('');
      setLinkItems([{ id: '1', url: '', isNow: true, scheduledAt: dayjs() }]);
      setPreviews({});
      // Bắt buộc chọn lại Nhóm cho lần đăng tiếp theo thay vì âm thầm giữ lựa chọn cũ — tránh lặp
      // lại lỗi dán link cho Nhóm A nhưng Select vẫn còn đang giữ Nhóm B từ lần đăng trước đó.
      form.setFieldValue('groupNames', undefined);
      queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
      queryClient.invalidateQueries({ queryKey: ['postTargets'] });
      queryClient.invalidateQueries({ queryKey: POSTING_WINDOW_QUERY_KEY });
    },
    onError: (err: any) => {
      showScrapeErrorToast(err);
      setIsPosting(false);
      setProgressPercent(0);
      setProgressStatusMsg('');
    }
  });

  // Mutation Chỉ Đăng vào Group (không đăng lên tường Fanpage)
  const postToGroupMutation = useMutation({
    mutationFn: async (values: any) => {
      const validItems = linkItems.filter((item) => {
        const hasUrl = !!item.url && item.url.trim().length > 0;
        const hasContent = (!!item.manualContent && item.manualContent.trim().length > 0) || (!!item.customCaption && item.customCaption.trim().length > 0);
        const hasMedia = (item.manualMediaUrls?.length || 0) > 0;
        return hasUrl || hasContent || hasMedia;
      });
      if (validItems.length === 0) {
        throw new Error('Vui lòng nhập ít nhất 1 bài viết hoặc đường dẫn URL!');
      }

      const rawTargetGroup = values.targetGroupId;
      const selectedGroupIds: string[] = Array.isArray(rawTargetGroup)
        ? rawTargetGroup.filter(Boolean)
        : (rawTargetGroup ? [String(rawTargetGroup)] : []);
      if (selectedGroupIds.length === 0) {
        throw new Error('Vui lòng chọn ít nhất 1 Group muốn đăng vào!');
      }

      const rawFanpage = values.targetFanpageId;
      const selectedFanpageIds: string[] = Array.isArray(rawFanpage)
        ? rawFanpage.filter(Boolean)
        : (rawFanpage ? [String(rawFanpage)] : []);
      if (selectedFanpageIds.length === 0) {
        throw new Error('Vui lòng chọn ít nhất 1 Fanpage hoặc Nick cá nhân!');
      }

      setIsPosting(true);
      setProgressPercent(30);
      setProgressStatusMsg('📥 Đang cào nội dung & khởi tạo hàng đợi cho các Group...');

      const timer1 = setTimeout(() => {
        setProgressPercent(70);
        setProgressStatusMsg('🎭 Phân bổ lịch đăng và gửi tới trình duyệt Chromium...');
      }, 3000);

      try {
        const primaryTarget = selectedFanpageIds[0];
        const pageId = primaryTarget ? String(primaryTarget).split(':')[0] : undefined;
        const savedComment = localStorage.getItem(STORAGE_KEY_COMMENT) || DEFAULT_SAVED_COMMENT;
        const effectiveDefaultComment = values.affiliateLink?.trim() || form.getFieldValue('affiliateLink')?.trim() || (savedComment && savedComment.trim()) || undefined;

        const expandedUrls: string[] = [];
        const expandedScheduledTimes: string[] = [];
        const expandedCustomCaptions: string[] = [];
        const expandedCustomMediaUrls: string[] = [];
        const expandedAffiliateLinks: string[] = [];
        const expandedTargetGroupNamesList: string[] = [];
        const expandedTargetFanpageIdsList: string[] = [];
        const expandedCommentDisabled: boolean[] = [];
        const expandedGroupCommentEnabled: boolean[] = [];
        const expandedIncludeCredits: boolean[] = [];
        const expandedColorBackgrounds: (boolean | string)[] = [];

        validItems.forEach((i, itemIdx) => {
          const itemUrl = (!i.url || !i.url.trim()) ? `manual://post_${i.id}` : i.url.trim();
          const itemCaption = (i.manualContent && i.manualContent.trim())
            ? i.manualContent.trim()
            : (i.customCaption !== undefined ? i.customCaption : (previews[i.id]?.caption || ''));
          let itemMedia = (i.manualMediaUrls && i.manualMediaUrls.length > 0)
            ? i.manualMediaUrls.join(',')
            : (previews[i.id]?.mediaUrls && previews[i.id].mediaUrls!.length > 0 ? previews[i.id].mediaUrls!.join(',') : '');
          if (i.colorBackground === 'RED_PHOTO_TRICK' && itemMedia.includes(',')) {
            itemMedia = itemMedia.split(',')[0].trim();
          }
          const baseAffLink = (i.affiliateLink && i.affiliateLink.trim().length > 0) ? i.affiliateLink.trim() : (effectiveDefaultComment || '');
          const baseTime = i.isNow ? dayjs() : i.scheduledAt;

          const rawItemTarget = customItemTargets[i.id];
          const itemTarget = (rawItemTarget && selectedFanpageIds.includes(rawItemTarget)) ? rawItemTarget : undefined;

          if (itemTarget) {
            selectedGroupIds.forEach((gId, gIdx) => {
              const finalAffLink = resolveAffiliateLinkForGroup(gId, baseAffLink);
              const offsetMinutes = gIdx * groupStaggerInterval;
              const groupScheduledAt = baseTime.add(offsetMinutes, 'minute');

              expandedUrls.push(itemUrl);
              expandedScheduledTimes.push(groupScheduledAt.format('YYYY-MM-DDTHH:mm:ss'));
              expandedCustomCaptions.push(itemCaption);
              expandedCustomMediaUrls.push(itemMedia);
              expandedAffiliateLinks.push(finalAffLink);
              expandedTargetGroupNamesList.push(isAnonymous ? `GROUP_ONLY_ANON:${gId}` : `GROUP_ONLY:${gId}`);
              expandedTargetFanpageIdsList.push(itemTarget);
              expandedCommentDisabled.push(Boolean(i.skipComment));
              expandedGroupCommentEnabled.push(Boolean(i.groupCommentEnabled) && isGroupCommentAllowedForGroup(gId));
              expandedIncludeCredits.push(i.includeCredit !== false);
              expandedColorBackgrounds.push(Boolean(i.colorBackground));
            });
          } else if (groupDistributionMode === 'PAGE_PER_GROUP') {
            selectedGroupIds.forEach((gId, gIdx) => {
              const fId = selectedFanpageIds[(gIdx + itemIdx) % selectedFanpageIds.length];
              const finalAffLink = resolveAffiliateLinkForGroup(gId, baseAffLink);
              const offsetMinutes = gIdx * groupStaggerInterval;
              const groupScheduledAt = baseTime.add(offsetMinutes, 'minute');

              expandedUrls.push(itemUrl);
              expandedScheduledTimes.push(groupScheduledAt.format('YYYY-MM-DDTHH:mm:ss'));
              expandedCustomCaptions.push(itemCaption);
              expandedCustomMediaUrls.push(itemMedia);
              expandedAffiliateLinks.push(finalAffLink);
              expandedTargetGroupNamesList.push(isAnonymous ? `GROUP_ONLY_ANON:${gId}` : `GROUP_ONLY:${gId}`);
              expandedTargetFanpageIdsList.push(fId);
              expandedCommentDisabled.push(Boolean(i.skipComment));
              expandedGroupCommentEnabled.push(Boolean(i.groupCommentEnabled) && isGroupCommentAllowedForGroup(gId));
              expandedIncludeCredits.push(i.includeCredit !== false);
              expandedColorBackgrounds.push(Boolean(i.colorBackground));
            });
          } else if (groupDistributionMode === 'ROUND_ROBIN_POSTS') {
            const gIdx = itemIdx % selectedGroupIds.length;
            const gId = selectedGroupIds[gIdx];
            const fId = selectedFanpageIds[itemIdx % selectedFanpageIds.length];
            const finalAffLink = resolveAffiliateLinkForGroup(gId, baseAffLink);
            const offsetMinutes = itemIdx * groupStaggerInterval;
            const groupScheduledAt = baseTime.add(offsetMinutes, 'minute');

            expandedUrls.push(itemUrl);
            expandedScheduledTimes.push(groupScheduledAt.format('YYYY-MM-DDTHH:mm:ss'));
            expandedCustomCaptions.push(itemCaption);
            expandedCustomMediaUrls.push(itemMedia);
            expandedAffiliateLinks.push(finalAffLink);
            expandedTargetGroupNamesList.push(isAnonymous ? `GROUP_ONLY_ANON:${gId}` : `GROUP_ONLY:${gId}`);
            expandedTargetFanpageIdsList.push(fId);
            expandedCommentDisabled.push(Boolean(i.skipComment));
            expandedGroupCommentEnabled.push(Boolean(i.groupCommentEnabled) && isGroupCommentAllowedForGroup(gId));
            expandedIncludeCredits.push(i.includeCredit !== false);
            expandedColorBackgrounds.push(Boolean(i.colorBackground));
          } else {
            selectedGroupIds.forEach((gId, gIdx) => {
              selectedFanpageIds.forEach((fId, fIdx) => {
                const finalAffLink = resolveAffiliateLinkForGroup(gId, baseAffLink);
                const taskIndex = gIdx * selectedFanpageIds.length + fIdx;
                const offsetMinutes = taskIndex * groupStaggerInterval;
                const groupScheduledAt = baseTime.add(offsetMinutes, 'minute');

                expandedUrls.push(itemUrl);
                expandedScheduledTimes.push(groupScheduledAt.format('YYYY-MM-DDTHH:mm:ss'));
                expandedCustomCaptions.push(itemCaption);
                expandedCustomMediaUrls.push(itemMedia);
                expandedAffiliateLinks.push(finalAffLink);
                expandedTargetGroupNamesList.push(isAnonymous ? `GROUP_ONLY_ANON:${gId}` : `GROUP_ONLY:${gId}`);
                expandedTargetFanpageIdsList.push(fId);
                expandedCommentDisabled.push(Boolean(i.skipComment));
                expandedGroupCommentEnabled.push(Boolean(i.groupCommentEnabled) && isGroupCommentAllowedForGroup(gId));
                expandedIncludeCredits.push(i.includeCredit !== false);
                expandedColorBackgrounds.push(Boolean(i.colorBackground));
              });
            });
          }
        });

        const isFirstImmediate = validItems[0].isNow;

        const payload = {
          urls: expandedUrls,
          scheduledTimes: expandedScheduledTimes,
          pageId: expandedTargetFanpageIdsList[0] ? expandedTargetFanpageIdsList[0].split(':')[0] : pageId,
          targetFanpageId: expandedTargetFanpageIdsList[0] || selectedFanpageIds[0],
          targetFanpageIds: expandedTargetFanpageIdsList,
          targetGroupNamesList: expandedTargetGroupNamesList,
          publishNow: isFirstImmediate,
          ...queueAppendPayload,
          intervalMinutes: batchInterval,
          affiliateLink: effectiveDefaultComment,
          affiliateLinks: expandedAffiliateLinks,
          commentDisabled: expandedCommentDisabled,
          groupCommentEnabled: expandedGroupCommentEnabled,
          includeCredits: expandedIncludeCredits,
          colorBackgrounds: expandedColorBackgrounds,
          customCaptions: expandedCustomCaptions,
          customMediaUrls: expandedCustomMediaUrls,
          forceRefresh,
        };

        const response = await api.post('/queue/add-from-urls', payload);
        clearTimeout(timer1);
        setProgressPercent(100);
        setProgressStatusMsg('🎉 Đã thiết lập lịch xuất bản vào các Group thành công!');
        return response.data;
      } catch (err: any) {
        clearTimeout(timer1);
        setProgressPercent(0);
        setProgressStatusMsg('');
        setIsPosting(false);
        throw err;
      }
    },
    onSuccess: (data: any) => {
      (data?.count === 0 && data?.skippedDuplicates?.length ? message.warning : message.success)(data?.message || '🚀 Đã xử lý và phân bổ lịch đăng cho các Group thành công!');
      notifySkippedDuplicates(data);
      setLinkItems([{ id: '1', url: '', isNow: true, scheduledAt: dayjs() }]);
      setPreviews({});
      form.setFieldValue('targetGroupId', undefined);
      setIsPosting(false);
      setProgressPercent(0);
      setProgressStatusMsg('');
      queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
      queryClient.invalidateQueries({ queryKey: ['postTargets'] });
      queryClient.invalidateQueries({ queryKey: POSTING_WINDOW_QUERY_KEY });
    },
    onError: (err: any) => {
      showScrapeErrorToast(err);
      setIsPosting(false);
      setProgressPercent(0);
      setProgressStatusMsg('');
    }
  });

  // Đổi giờ đăng cho 1 bài đang "Chờ đăng" trong Lịch sử
  const [reschedulingPost, setReschedulingPost] = useState<PostQueue | null>(null);
  const [newScheduleTime, setNewScheduleTime] = useState<Dayjs | null>(null);
  const rescheduleMutation = useMutation({
    mutationFn: async ({ id, scheduledAt }: { id: number; scheduledAt: string }) => {
      const response = await api.patch(`/queue/${id}/schedule`, { scheduledAt });
      return response.data;
    },
    onSuccess: () => {
      message.success('🗓️ Đã đổi giờ đăng thành công!');
      queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
      queryClient.invalidateQueries({ queryKey: ['postTargets'] });
      queryClient.invalidateQueries({ queryKey: POSTING_WINDOW_QUERY_KEY });
      setReschedulingPost(null);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Lỗi khi đổi giờ đăng!');
    }
  });

  // Đăng ngay 1 bài đang "Chờ đăng" trong Lịch sử, không cần đợi tới đúng giờ đã hẹn
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const publishNowMutation = useMutation({
    mutationFn: async (id: number) => {
      setPublishingId(id);
      const response = await api.post(`/queue/${id}/publish`);
      return response.data;
    },
    onSuccess: () => {
      message.success('🚀 Đã đăng bài ngay lập tức!');
      queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
      queryClient.invalidateQueries({ queryKey: ['postTargets'] });
      queryClient.invalidateQueries({ queryKey: POSTING_WINDOW_QUERY_KEY });
      setPublishingId(null);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Lỗi khi đăng bài ngay!');
      setPublishingId(null);
    }
  });

  // Mutation Đăng Lại 1 bài từ lịch sử (Phát kích hoạt xuất bản lại ngay theo ID bản ghi)
  const [repostingId, setRepostingId] = useState<number | null>(null);
  const repostMutation = useMutation({
    mutationFn: async (record: PostQueue) => {
      setRepostingId(record.id);
      const response = await api.post(`/queue/${record.id}/publish`);
      return response.data;
    },
    onSuccess: () => {
      message.success('🚀 Đã kích hoạt đăng lại bài viết thành công!');
      setRepostingId(null);
      queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
      queryClient.invalidateQueries({ queryKey: ['postTargets'] });
      queryClient.invalidateQueries({ queryKey: POSTING_WINDOW_QUERY_KEY });
    },
    onError: (err: any) => {
      showScrapeErrorToast(err);
      setRepostingId(null);
    }
  });

  // Retry riêng các Group lỗi của bài đã lên Page. POST có thể chạy vài phút,
  // nên poll endpoint progress trong lúc chờ để hiển thị x/y Group và Group hiện tại.
  const [retryingGroupsId, setRetryingGroupsId] = useState<number | null>(null);
  const [groupRetryProgress, setGroupRetryProgress] = useState<GroupRetryProgress | null>(null);

  useEffect(() => {
    if (retryingGroupsId === null) return;
    let stopped = false;

    const pollProgress = async () => {
      try {
        const response = await api.get<GroupRetryProgress>(
          `/queue/${retryingGroupsId}/retry-failed-groups/progress`
        );
        if (!stopped) setGroupRetryProgress(response.data);
      } catch {
        // Request retry chính vẫn là nguồn kết quả; poll lỗi tạm thời không huỷ tiến trình.
      }
    };

    void pollProgress();
    const timer = window.setInterval(pollProgress, 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [retryingGroupsId]);

  const retryFailedGroupsMutation = useMutation({
    mutationFn: async (record: PostQueue) => {
      setRetryingGroupsId(record.id);
      setGroupRetryProgress({
        total: 0,
        completed: 0,
        succeeded: 0,
        failed: 0,
        currentGroupId: null,
        currentGroupName: null,
        status: 'RUNNING',
      });
      const response = await api.post<GroupRetrySummary>(`/queue/${record.id}/retry-failed-groups`);
      return response.data;
    },
    onSuccess: (result) => {
      if (result.total === 0) {
        message.info('Bài này không còn Group lỗi để thử lại.');
      } else if (result.success) {
        message.success(`✅ Đã thử lại thành công ${result.succeeded}/${result.total} Group, không đăng lại Page.`);
      } else {
        message.warning(`⚠️ Đã thử lại ${result.total} Group: thành công ${result.succeeded}, còn lỗi ${result.failed}.`);
      }
      setGroupRetryProgress({
        total: result.total,
        completed: result.total,
        succeeded: result.succeeded,
        failed: result.failed,
        currentGroupId: null,
        currentGroupName: null,
        status: 'COMPLETE',
      });
      setRetryingGroupsId(null);
      queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Thử lại các Group lỗi thất bại!');
      setRetryingGroupsId(null);
      queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
    },
  });

  const isFirstItemImmediate = linkItems.length > 0 && linkItems[0].isNow;

  const handlePackQueueContinuous = async () => {
    setPackingQueue(true);
    try {
      const res = await api.post('/queue/pack-continuous', { gapSeconds: Math.round(queueGapMinutes * 60) });
      const finish = res.data?.estimatedFinishAt ? dayjs(res.data.estimatedFinishAt).format('HH:mm DD/MM') : '';
      const deferred = Number(res.data?.deferredCount) || 0;
      message.success(`Đã dồn ${res.data?.updated ?? 0} bài chạy liên tục${finish ? `, dự kiến xong lúc ${finish}` : ''}`
        + (deferred > 0 ? `. ${deferred} bài không kịp trong khung giờ hôm nay, xem đề xuất ở mục Khung giờ đăng.` : ''), deferred > 0 ? 6 : 3);
      queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
      queryClient.invalidateQueries({ queryKey: POSTING_WINDOW_QUERY_KEY });
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Không dồn được hàng đợi');
    } finally {
      setPackingQueue(false);
    }
  };

  const handleSubmit = (values: any) => {
    if (postMode === 'GROUP_ONLY') {
      postToGroupMutation.mutate(values);
    } else {
      postPlaywrightMutation.mutate(values);
    }
  };

  const columns = [
    {
      title: 'Bài đăng',
      dataIndex: 'content',
      key: 'content',
      render: (content: string, record: PostQueue) => {
        const media = describeMedia(record.mediaUrls);
        const isAnon = record.targetGroupNames?.startsWith('GROUP_ONLY_ANON:') || record.targetFanpageId === 'PERSONAL_PROFILE';
        const isGroupOnly = record.targetGroupNames?.startsWith('GROUP_ONLY:') || record.targetGroupNames?.startsWith('GROUP_ONLY_ANON:');
        const rawGroupNames = record.targetGroupNames
          ? record.targetGroupNames.replace(/^GROUP_ONLY_ANON:|^GROUP_ONLY:/, '')
          : '';
        const groupCount = (rawGroupNames || '').split(',').map((value) => value.trim()).filter(Boolean).length;
        const resolvedGroupNames = resolveGroupNames(rawGroupNames);
        return (
          <div className="max-w-2xl min-w-[280px]">
            <Paragraph
              ellipsis={{ rows: 2 }}
              className="!mb-1 font-semibold text-slate-800 text-xs cursor-pointer hover:text-blue-600 transition-colors"
              onClick={() => setDetailPost(record)}
              title="Nhấn để xem chi tiết bài đăng, video/ảnh và caption đầy đủ"
            >
              {content || record.title || 'Bài viết không tiêu đề'}
            </Paragraph>
            <Space size={8} wrap>
              <span className="text-[10px] font-mono text-slate-400">#{record.id}</span>
              {resolvePosterIdentityName(record) && (
                <Tooltip title={`Đăng bài với danh nghĩa: ${resolvePosterIdentityName(record)} · Nhấn để ${historyPageFilter === resolvePosterIdentityName(record) ? 'bỏ lọc' : 'lọc xem chỉ bài của Page này'}`}>
                  <Tag
                    className="!m-0 !text-[10px] font-bold cursor-pointer hover:opacity-85 transition-all"
                    color={historyPageFilter === resolvePosterIdentityName(record) ? "gold" : (isAnon ? "purple" : "geekblue")}
                    icon={isAnon ? <UserOutlined /> : <FacebookFilled />}
                    onClick={(e) => {
                      e.stopPropagation();
                      const posterName = resolvePosterIdentityName(record);
                      if (posterName) {
                        setHistoryPageFilter((prev) => (prev === posterName ? 'ALL' : posterName));
                      }
                    }}
                  >
                    {resolvePosterIdentityName(record)}
                    {historyPageFilter === resolvePosterIdentityName(record) && ' ✓'}
                  </Tag>
                </Tooltip>
              )}
              {isGroupOnly ? (
                <Tooltip title={resolvedGroupNames.length > 1 ? `Đăng vào các Nhóm: ${resolvedGroupNames.join(', ')}` : undefined}>
                  <Tag className="!m-0 !text-[10px]" color={isAnon ? "green" : "purple"} icon={<TeamOutlined />}>
                    {isAnon
                      ? `Nhóm Ẩn danh (${resolvedGroupNames.length === 1 ? resolvedGroupNames[0] : groupCount})`
                      : (resolvedGroupNames.length === 1 ? resolvedGroupNames[0] : `Chỉ Nhóm (${groupCount})`)}
                  </Tag>
                </Tooltip>
              ) : (
                <Tooltip title={groupCount > 0 ? `Đã chia sẻ thêm vào Nhóm: ${resolvedGroupNames.join(', ')}` : undefined}>
                  <Tag className="!m-0 !text-[10px]" color={groupCount > 0 ? 'cyan' : 'blue'}>
                    {groupCount === 0 ? 'Chỉ Fanpage' : groupCount === 1 ? `Page + Nhóm: ${resolvedGroupNames[0]}` : `Page + ${groupCount} nhóm`}
                  </Tag>
                </Tooltip>
              )}
              {record.originalUrl && (
                <a
                  href={record.originalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-blue-600 font-medium hover:underline inline-flex items-center gap-1"
                >
                  <LinkOutlined /> Bài gốc
                </a>
              )}
              {record.affiliateLink && (record.targetGroupNames ? !!record.enableGroupComment : true) && (
                <Tooltip title={`Bình luận tự động: ${record.affiliateLink}`}>
                  <Tag className="!m-0 !text-[10px]" color="gold" icon={<MessageOutlined />}>
                    Kèm cmt
                  </Tag>
                </Tooltip>
              )}
            </Space>
          </div>
        );
      }
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 170,
      render: (status: string, record: PostQueue) => {
        if (status === 'PUBLISHED') {
          const hasError = !!record.errorMessage;
          const isCommentError = record.errorMessage && record.errorMessage.toLowerCase().includes('bình luận');
          const isGroupError = record.errorMessage && (record.errorMessage.toLowerCase().includes('group') || record.errorMessage.toLowerCase().includes('nhóm'));
          // Bình luận trong Group là opt-in (PostQueue.enableGroupComment) — có affiliateLink không
          // có nghĩa là đã bình luận, phải xem cờ này mới đúng thực tế. Bài chỉ đăng Fanpage (không
          // có targetGroupNames) thì leg Fanpage vẫn tự bình luận mặc định hễ có affiliateLink.
          const commentActuallyEnabled = record.targetGroupNames ? !!record.enableGroupComment : true;
          const activeRetryProgress = retryingGroupsId === record.id ? groupRetryProgress : null;
          const retryPercent = activeRetryProgress && activeRetryProgress.total > 0
            ? Math.round((activeRetryProgress.completed / activeRetryProgress.total) * 100)
            : 0;

          return (
            <div className="flex flex-col gap-1 items-start">
              {hasError ? (
                <Tooltip title={record.errorMessage}>
                  <Tag icon={<WarningOutlined />} color="warning">
                    {isCommentError ? 'Đã đăng · Lỗi cmt' : isGroupError ? 'Page xong · Lỗi nhóm' : 'Đã đăng (cảnh báo)'}
                  </Tag>
                </Tooltip>
              ) : (
                <Tag icon={<CheckCircleOutlined />} color="success">Đã đăng</Tag>
              )}

              {record.affiliateLink && commentActuallyEnabled && !isCommentError && (
                <Tag icon={<CheckCircleOutlined />} color="cyan" className="!text-[10px] !m-0 font-semibold">
                  💬 Đã bình luận
                </Tag>
              )}

              {activeRetryProgress && activeRetryProgress.status === 'RUNNING' && (
                <div className="w-full min-w-[145px] rounded-lg border border-blue-500/30 bg-blue-950/40 px-2.5 py-1.5 backdrop-blur-xs">
                  <div className="mb-1 text-[10px] font-semibold text-blue-300 truncate">
                    {activeRetryProgress.currentGroupName
                      ? `Đang thử: ${activeRetryProgress.currentGroupName}`
                      : 'Đang chuẩn bị thử lại nhóm lỗi…'}
                  </div>
                  <Progress
                    percent={retryPercent}
                    size="small"
                    status="active"
                    strokeColor={{ '0%': '#38bdf8', '100%': '#6366f1' }}
                    railColor="rgba(255, 255, 255, 0.08)"
                    format={() => `${activeRetryProgress.completed}/${activeRetryProgress.total || '?'} nhóm`}
                  />
                </div>
              )}
            </div>
          );
        } else if (status === 'PROCESSING') {
          return (
            <div className="flex flex-col gap-1 items-start">
              <Tag icon={<LoadingOutlined spin />} color="purple" className="!font-mono !font-bold">
                Đang đăng (<LiveElapsedTimer startTime={record.updatedAt || record.createdAt} />)
              </Tag>
              <div className="text-[10px] text-purple-300 font-mono flex items-center gap-1 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                <span>Playwright cào & đăng...</span>
              </div>
            </div>
          );
        } else if (status === 'PENDING') {
          return (
            <div className="flex flex-col gap-1 items-start">
              <Tag icon={<ClockCircleOutlined />} color="processing">Chờ đăng</Tag>
              {record.affiliateLink && (record.targetGroupNames ? !!record.enableGroupComment : true) && (
                <Tag color="default" className="!text-[10px] !m-0 text-slate-500">
                  + Sẽ cmt tự động
                </Tag>
              )}
            </div>
          );
        } else {
          return (
            <Tooltip title={record.errorMessage || 'Đăng thất bại'}>
              <Tag icon={<CloseCircleOutlined />} color="error">Đăng lỗi</Tag>
            </Tooltip>
          );
        }
      }
    },
    {
      title: 'Link đã đăng',
      key: 'publishedLinks',
      width: 150,
      render: (_: any, record: PostQueue) => {
        const groupUrls = (record.publishedGroupPostUrls || '').split(',').map((u) => u.trim()).filter(Boolean);
        const links: { url: string; label: string }[] = [];
        if (record.publishedPostUrl) links.push({ url: record.publishedPostUrl, label: 'Bài đã đăng' });
        groupUrls.forEach((url, idx) => links.push({ url, label: groupUrls.length > 1 ? `Nhóm ${idx + 1}` : 'Bài trong Nhóm' }));
        if (links.length === 0) {
          return <span className="text-[11px] text-slate-400">—</span>;
        }
        return (
          <div className="flex flex-col gap-0.5">
            {links.map((l, idx) => (
              <a
                key={idx}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-blue-600 font-medium hover:underline inline-flex items-center gap-1"
              >
                <LinkOutlined /> {l.label}
              </a>
            ))}
          </div>
        );
      }
    },
    {
      title: 'Thời gian',
      dataIndex: 'publishedAt',
      key: 'publishedAt',
      width: 175,
      render: (date: string, record: PostQueue) => {
        if (record.status === 'PROCESSING') {
          const startedAt = record.updatedAt || record.createdAt;
          const hasVideo = !record.mediaUrls || record.mediaUrls.toLowerCase().includes('.mp4') || record.mediaUrls.toLowerCase().includes('video') || !record.mediaUrls.includes('.jpg');
          return (
            <div className="space-y-1">
              <div className="font-bold text-purple-300 text-xs flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                <span>Đang xử lý:</span>
                <span className="text-white font-mono font-extrabold">{startedAt ? dayjs(startedAt).format('HH:mm') : dayjs().format('HH:mm')}</span>
              </div>
              <EstimatedPostProgress
                startTime={startedAt}
                hasVideo={hasVideo}
                hasAffiliate={!!record.affiliateLink}
              />
              {record.scheduledAt && (
                <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1 mt-1">
                  <span>📅 Hẹn:</span>
                  <span className="text-slate-300">{dayjs(record.scheduledAt).format('HH:mm · DD/MM')}</span>
                </div>
              )}
            </div>
          );
        }

        if (record.status === 'PUBLISHED') {
          const pubTime = record.publishedAt || record.updatedAt || record.scheduledAt;
          let durationBadge = null;
          const execSec = record.executionDurationSeconds;
          if (execSec && execSec > 0) {
            const durationStr = execSec < 60 ? `${execSec}s` : `${Math.floor(execSec / 60)}m ${execSec % 60}s`;
            durationBadge = (
              <div
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 text-[10px] font-mono font-bold mt-1 shadow-2xs"
                title={`Thời gian Playwright chạy thực tế: ${durationStr}`}
              >
                <span>⏱</span>
                <span>{durationStr}</span>
              </div>
            );
          }

          return (
            <div className="flex flex-col gap-0.5">
              <div className="font-bold text-emerald-300 font-mono text-sm leading-tight">
                {pubTime ? dayjs(pubTime).format('HH:mm') : '-'}
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                {pubTime ? dayjs(pubTime).format('DD/MM/YYYY') : ''}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] font-medium">
                  <CheckCircleOutlined className="text-[9px]" /> Đã đăng
                </span>
                {durationBadge}
              </div>
            </div>
          );
        }

        if (record.status === 'PENDING') {
          const schedTime = record.scheduledAt || record.createdAt;
          return (
            <div className="flex flex-col gap-0.5">
              <div className="font-bold text-amber-300 font-mono text-sm leading-tight">
                {schedTime ? dayjs(schedTime).format('HH:mm') : '-'}
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                {schedTime ? dayjs(schedTime).format('DD/MM/YYYY') : ''}
              </div>
              <div className="mt-0.5">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/25 text-[10px] font-medium shadow-2xs">
                  <ClockCircleOutlined className="text-[9px]" /> Hẹn đăng
                </span>
              </div>
            </div>
          );
        }

        // FAILED or CANCELLED
        const failTime = record.updatedAt || record.scheduledAt || record.createdAt;
        return (
          <div className="flex flex-col gap-0.5">
            <div className="font-bold text-rose-300 font-mono text-sm leading-tight">
              {failTime ? dayjs(failTime).format('HH:mm') : '-'}
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              {failTime ? dayjs(failTime).format('DD/MM/YYYY') : ''}
            </div>
            <div className="mt-0.5">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/25 text-[10px] font-medium shadow-2xs">
                <CloseCircleOutlined className="text-[9px]" /> Lỗi đăng
              </span>
            </div>
          </div>
        );
      }
    },
    {
      title: '',
      key: 'actions',
      width: 300,
      render: (_: any, record: PostQueue) => {
        const isPublishedGroupError = record.status === 'PUBLISHED'
          && !!record.errorMessage
          && (record.errorMessage.toLowerCase().includes('group') || record.errorMessage.toLowerCase().includes('nhóm'));

        return (
          <Space size={4} wrap>
            <Tooltip title="Xem chi tiết nội dung, video/ảnh và liên kết đã đăng">
              <Button
                size="small"
                icon={<EyeOutlined />}
                onClick={() => setDetailPost(record)}
                className="text-blue-400 border-blue-500/40 hover:text-blue-300 hover:border-blue-300 bg-blue-500/10 font-semibold"
              >
                Chi tiết
              </Button>
            </Tooltip>
            <Tooltip title="Tìm log Worker liên quan và sao chép thông tin để chẩn đoán">
              <Button
                size="small"
                icon={<BugOutlined />}
                onClick={() => setDiagnosingPost(record)}
                className="post-log-button"
              >
                Kiểm tra log
              </Button>
            </Tooltip>
            {record.status === 'PENDING' && (
              <Tooltip title="Đăng ngay lập tức, không cần chờ tới giờ đã hẹn">
                <Button
                  size="small"
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  loading={publishingId === record.id}
                  disabled={publishingId !== null}
                  onClick={() => publishNowMutation.mutate(record.id)}
                  className="bg-purple-600 hover:bg-purple-700 border-none"
                >
                  Đăng ngay
                </Button>
              </Tooltip>
            )}
            {record.status === 'PENDING' && (
              <Tooltip title="Đổi ngày giờ đăng khác cho bài này">
                <Button
                  size="small"
                  icon={<ScheduleOutlined />}
                  onClick={() => {
                    setReschedulingPost(record);
                    setNewScheduleTime(record.scheduledAt ? dayjs(record.scheduledAt) : dayjs().add(15, 'minute'));
                  }}
                >
                  Đổi giờ
                </Button>
              </Tooltip>
            )}
            {isPublishedGroupError ? (
              <Tooltip title="Chỉ thử lại các Group còn lỗi; không đăng lại Page hoặc Group đã thành công">
                <Button
                  size="small"
                  type="primary"
                  icon={<ReloadOutlined />}
                  loading={retryingGroupsId === record.id}
                  disabled={retryingGroupsId !== null || repostingId !== null}
                  onClick={() => retryFailedGroupsMutation.mutate(record)}
                  className="bg-amber-500 hover:!bg-amber-600 border-none"
                >
                  Thử lại nhóm lỗi
                </Button>
              </Tooltip>
            ) : (
              <Button
                size="small"
                icon={<RedoOutlined />}
                title="Kích hoạt đăng lại bài này"
                loading={repostingId === record.id}
                disabled={record.status === 'PROCESSING' || repostingId !== null || retryingGroupsId !== null}
                onClick={() => {
                  // Backend gắn cờ này khi bài bị treo PROCESSING quá lâu mà KHÔNG tìm thấy bằng chứng
                  // đã đăng (ID/link bài) — nghĩa là rất có thể Worker vẫn đang đăng dở lúc mất phản hồi,
                  // bấm Đăng lại ngay có rủi ro thật đăng trùng 2 lần lên Facebook. Chặn lại bằng 1 bước
                  // xác nhận rõ ràng thay vì cho bấm thẳng như lỗi thông thường.
                  if (record.errorMessage?.includes('[NO_AUTO_RETRY]')) {
                    Modal.confirm({
                      title: '⚠️ Chưa chắc bài đã thất bại thật',
                      content: 'Bài này bị mất phản hồi từ Worker chứ không có lỗi rõ ràng — có thể Facebook ĐÃ đăng thành công. Hãy kiểm tra lại trên Facebook trước. Nếu vẫn đăng lại mà bài cũ đã lên thật, bạn sẽ bị đăng trùng 2 lần.',
                      okText: 'Tôi đã kiểm tra, vẫn đăng lại',
                      cancelText: 'Để tôi kiểm tra đã',
                      okButtonProps: { danger: true },
                      onOk: () => repostMutation.mutate(record),
                    });
                    return;
                  }
                  repostMutation.mutate(record);
                }}
              >
                Đăng lại
              </Button>
            )}
            <Popconfirm
              title="Xác nhận xóa bài viết"
              description="Bạn có chắc muốn xóa bài này khỏi lịch sử/hàng đợi?"
              onConfirm={async () => {
                try {
                  await api.delete(`/queue/${record.id}`);
                  message.success('🗑️ Đã xóa bài viết!');
                  queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
                } catch (e: any) {
                  message.error('Không thể xóa: ' + (e.message || 'Lỗi hệ thống'));
                }
              }}
              okText="Xóa luôn"
              cancelText="Hủy"
              okButtonProps={{ danger: true }}
            >
              <Button
                size="small"
                danger
                type="text"
                icon={<DeleteOutlined />}
                title="Xóa bài viết"
                className="text-rose-500 hover:text-rose-700 hover:bg-rose-50"
              />
            </Popconfirm>
          </Space>
        );
      }
    }
  ];

  const activeTodayTargets = todayTargets.filter((target) => target.targetCount > 0);
  const completedTodayTargets = activeTodayTargets.filter((target) => target.achieved).length;
  const totalTodayTarget = activeTodayTargets.reduce((sum, target) => sum + target.targetCount, 0);
  const totalTodayActual = activeTodayTargets.reduce((sum, target) => sum + target.actualCount, 0);

  const queueModeControl = (
    <div className="poster-queue-mode">
      <Segmented
        size="small"
        value={queueAppendMode ? 'QUEUE' : 'MANUAL'}
        onChange={(v) => setQueueAppendMode(v === 'QUEUE')}
        options={[
          { label: 'Nối đuôi liên tục', value: 'QUEUE' },
          { label: 'Theo giờ đã hẹn', value: 'MANUAL' },
        ]}
      />
      {queueAppendMode && (
        <Tooltip title="Thời gian nghỉ giữa 2 bài của cùng một nick">
          <InputNumber
            size="small"
            min={0}
            max={60}
            value={queueGapMinutes}
            onChange={(v) => setQueueGapMinutes(typeof v === 'number' ? v : 2)}
            suffix="phút"
            style={{ width: 92 }}
          />
        </Tooltip>
      )}
    </div>
  );

  return (
    <div className="poster-page space-y-5">
      <section className="poster-workspace-head">
        <div className="poster-workspace-tabs" role="tablist" aria-label="Khu vực làm việc">
          <button
            type="button"
            role="tab"
            aria-selected={workspaceTab === 'compose'}
            className={workspaceTab === 'compose' ? 'is-active' : ''}
            onClick={() => switchWorkspaceTab('compose')}
          >
            <EditOutlined /> Soạn bài
            {validLinkCount > 0 && <span className="poster-tab-count">{validLinkCount}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workspaceTab === 'history'}
            className={workspaceTab === 'history' ? 'is-active' : ''}
            onClick={() => switchWorkspaceTab('history')}
          >
            <HistoryOutlined /> Hàng đợi & lịch sử
            {postCounts.failed > 0
              ? <span className="poster-tab-count is-error">{postCounts.failed} lỗi</span>
              : postCounts.processing > 0
                ? <span className="poster-tab-count is-live">{postCounts.processing} đang đăng</span>
                : null}
          </button>
        </div>

        <div className="poster-status-chips" aria-label="Trạng thái hàng đợi">
          {[
            { key: 'PROCESSING', label: 'Đang đăng', value: postCounts.processing, tone: 'live' },
            { key: 'PENDING', label: 'Chờ đăng', value: postCounts.pending, tone: 'pending' },
            { key: 'PUBLISHED', label: 'Đã đăng', value: postCounts.published, tone: 'ok' },
            { key: 'FAILED', label: 'Lỗi', value: postCounts.failed, tone: 'error' },
          ].map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={`poster-status-chip is-${chip.tone}${chip.value === 0 ? ' is-zero' : ''}`}
              onClick={() => openHistoryWithFilter(chip.key)}
              title={`Xem các bài ${chip.label.toLowerCase()}`}
            >
              <i />
              <span>{chip.label}</span>
              <b>{chip.value}</b>
            </button>
          ))}
        </div>
      </section>



      <div className="poster-compose-layout" style={workspaceTab === 'compose' ? undefined : { display: 'none' }}>
        <Card className="poster-composer border border-slate-200 bg-white shadow-sm rounded-2xl">
          <div className="poster-section-heading">
            <span className="poster-step-number">1</span>
            <div>
              <h2>Chọn cách xuất bản</h2>
              <p>Bạn muốn bài viết xuất hiện ở đâu?</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mb-6" role="radiogroup" aria-label="Cách xuất bản">
            {[
              {
                id: 'FANPAGE_ONLY',
                title: 'Chỉ đăng Fanpage',
                sub: 'Xuất bản trực tiếp lên tường các trang Fanpage',
                icon: <SendOutlined className="text-base" />,
                activeCard: 'from-blue-950/60 via-slate-900/95 to-slate-950/95 border-blue-500/70 shadow-lg shadow-blue-950/50 ring-1 ring-blue-400/40',
                activeIcon: 'bg-gradient-to-br from-blue-500/25 to-sky-500/20 text-blue-400 border border-blue-400/40 shadow-sm shadow-blue-950/40',
                badgeBg: 'bg-blue-500',
              },
              {
                id: 'FANPAGE_AND_GROUP',
                title: 'Fanpage + Đăng vào Nhóm',
                sub: 'Lên tường Fanpage & tự động chia sẻ vào nhóm',
                icon: <RocketOutlined className="text-base" />,
                activeCard: 'from-purple-950/60 via-slate-900/95 to-slate-950/95 border-purple-500/70 shadow-lg shadow-purple-950/50 ring-1 ring-purple-400/40',
                activeIcon: 'bg-gradient-to-br from-purple-500/25 to-indigo-500/20 text-purple-300 border border-purple-400/40 shadow-sm shadow-purple-950/40',
                badgeBg: 'bg-purple-500',
              },
              {
                id: 'GROUP_ONLY',
                title: 'Chỉ đăng vào Nhóm',
                sub: 'Đăng trực tiếp vào Nhóm dưới tên Fanpage hoặc Nick cá nhân',
                icon: <TeamOutlined className="text-base" />,
                activeCard: 'from-emerald-950/60 via-slate-900/95 to-slate-950/95 border-emerald-500/70 shadow-lg shadow-emerald-950/50 ring-1 ring-emerald-400/40',
                activeIcon: 'bg-gradient-to-br from-emerald-500/25 to-teal-500/20 text-emerald-300 border border-emerald-400/40 shadow-sm shadow-emerald-950/40',
                badgeBg: 'bg-emerald-500',
              },
            ].map((mode) => {
              const active = postMode === mode.id;
              return (
                <button
                  type="button"
                  key={mode.id}
                  onClick={() => {
                    const newMode = mode.id as PostMode;
                    setPostMode(newMode);
                    if (newMode === 'FANPAGE_AND_GROUP') {
                      const existingGroup = form.getFieldValue('targetGroupId');
                      const existingGroupNames = form.getFieldValue('groupNames');
                      if ((!existingGroupNames || existingGroupNames.length === 0) && existingGroup) {
                        form.setFieldValue('groupNames', Array.isArray(existingGroup) ? existingGroup : [existingGroup]);
                      }
                    } else if (newMode === 'GROUP_ONLY') {
                      const existingGroup = form.getFieldValue('targetGroupId');
                      const existingGroupNames = form.getFieldValue('groupNames');
                      if ((!existingGroup || (Array.isArray(existingGroup) && existingGroup.length === 0)) && existingGroupNames && existingGroupNames.length > 0) {
                        form.setFieldValue('targetGroupId', existingGroupNames);
                      }
                    }
                  }}
                  role="radio"
                  aria-checked={active}
                  className={`relative flex items-start gap-3.5 p-4 rounded-2xl text-left transition-all duration-200 cursor-pointer select-none border group ${
                    active
                      ? `bg-gradient-to-br ${mode.activeCard} translate-y-[-1px]`
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-850/80 hover:translate-y-[-1px]'
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center transition-all ${
                      active ? mode.activeIcon : 'bg-slate-800/80 border border-slate-700/60 text-slate-400 group-hover:text-slate-200'
                    }`}
                  >
                    {mode.icon}
                  </div>
                  <div className="min-w-0 flex-1 pr-6">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-sm leading-snug text-slate-100">
                        {mode.title}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 leading-relaxed font-normal">
                      {mode.sub}
                    </div>
                  </div>
                  {active && (
                    <div className={`absolute top-3.5 right-3.5 w-5 h-5 rounded-full ${mode.badgeBg} text-white flex items-center justify-center text-xs shadow-md shadow-black/40`}>
                      <CheckCircleOutlined className="text-xs" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            preserve={true}
          >
            {/* Nơi xuất bản đứng trước nội dung để luồng thao tác đi từ quyết định lớn đến chi tiết. */}
            <section className="poster-form-section">
              <div className="poster-section-heading">
                <span className="poster-step-number">2</span>
                <div>
                  <h2>Chọn nơi xuất bản</h2>
                  <p>Chọn đúng Fanpage/Nick và nhóm nhận bài.</p>
                </div>
              </div>

              {/* Cảnh báo nổi bật khi Fanpage đang chọn bị hết hạn Cookie */}
              {isCurrentTargetExpired && (
                <Alert
                  type="error"
                  showIcon
                  message={
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <span className="text-xs sm:text-sm font-semibold text-red-400">
                        ⚠️ Fanpage <b>{selectedTargetAccount?.pageName || selectedTargetAccount?.platformAccountId}</b> đang <b>BỊ HẾT HẠN COOKIE</b>! Bài đăng chắc chắn sẽ bị lỗi nếu không cập nhật cookie mới.
                      </span>
                      <Button
                        type="primary"
                        danger
                        size="small"
                        icon={<KeyOutlined />}
                        onClick={() => {
                          setQuickCookieTargetId(selectedTargetAccount?.id);
                          setQuickCookieModalOpen(true);
                        }}
                        className="font-extrabold text-xs rounded-lg h-8 px-3 shadow-md shrink-0 self-start sm:self-auto"
                      >
                        ⚡ Cập Nhật Cookie Ngay
                      </Button>
                    </div>
                  }
                  className="rounded-2xl border-red-500/30 bg-red-950/40 mb-4 shadow-sm"
                />
              )}

              {/* THANH COMBO THƯỜNG DÙNG (SPEED PRESETS BAR) */}
              <div className="mb-5 p-3 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                {/* Khối chọn cấu hình */}
                <div className="flex items-center gap-2.5 flex-wrap">
                  <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
                    <AppstoreOutlined className="text-xs" />
                  </div>
                  <span className="text-xs font-semibold text-slate-300 shrink-0">Cấu hình lưu sẵn:</span>
                  <Select
                    value={selectedPresetId}
                    placeholder={savedPresets.length === 0 ? "Chưa có cấu hình nào được lưu" : "Chọn cấu hình để áp dụng nhanh..."}
                    style={{ width: 260 }}
                    size="middle"
                    allowClear
                    disabled={savedPresets.length === 0}
                    onChange={(val) => {
                      setSelectedPresetId(val || null);
                      const matched = savedPresets.find((p) => p.id === val);
                      if (matched) applyPreset(matched);
                    }}
                    optionRender={(option) => {
                      const p = savedPresets.find((item) => item.id === option.value);
                      if (!p) return option.label;
                      return (
                        <div className="flex items-center justify-between gap-2 py-0.5 group">
                          <span className="truncate text-xs font-medium text-slate-200">
                            {p.name} <span className="text-slate-400 font-normal">({p.selectedGroupIds.length > 0 ? `${p.selectedGroupIds.length} nhóm` : 'Tự chọn nhóm'} • {p.selectedFanpageIds.length} page)</span>
                          </span>
                          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <Tooltip title="Đổi tên cấu hình">
                              <Button
                                size="small"
                                type="text"
                                icon={<EditOutlined className="text-[11px] text-sky-400" />}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingPreset({ id: p.id, name: p.name });
                                  setEditingPresetName(p.name);
                                }}
                                className="!p-1 h-6 w-6 text-slate-400 hover:text-white hover:bg-slate-700"
                              />
                            </Tooltip>
                            <Tooltip title="Xóa cấu hình">
                              <Popconfirm
                                title="Xóa cấu hình này?"
                                onConfirm={(e) => {
                                  e?.stopPropagation();
                                  handleDeletePreset(p.id);
                                }}
                                okText="Xóa"
                                cancelText="Hủy"
                                okButtonProps={{ danger: true, size: 'small' }}
                                cancelButtonProps={{ size: 'small' }}
                              >
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<DeleteOutlined className="text-[11px] text-rose-400" />}
                                  onClick={(e) => e.stopPropagation()}
                                  className="!p-1 h-6 w-6 text-slate-400 hover:text-rose-300 hover:bg-rose-950/40"
                                />
                              </Popconfirm>
                            </Tooltip>
                          </div>
                        </div>
                      );
                    }}
                    options={savedPresets.map((p) => ({
                      value: p.id,
                      label: `${p.name} (${p.selectedGroupIds.length > 0 ? `${p.selectedGroupIds.length} nhóm` : 'Tự chọn nhóm'} • ${p.selectedFanpageIds.length} page)`,
                    }))}
                  />

                  {/* Khi đang chọn một preset, hiển thị nút Cập nhật nhanh với thiết lập hiện tại */}
                  {selectedPresetId && (
                    <Tooltip title="Lưu các Nhóm và Page đang tick chọn hiện tại vào cấu hình này">
                      <Button
                        size="middle"
                        icon={<SaveOutlined className="text-emerald-400 text-xs" />}
                        onClick={() => handleUpdatePresetWithCurrent(selectedPresetId)}
                        className="text-xs font-semibold rounded-lg bg-emerald-950/40 border-emerald-600/50 text-emerald-300 hover:text-white hover:bg-emerald-800/60 shrink-0"
                      >
                        Cập nhật
                      </Button>
                    </Tooltip>
                  )}
                </div>

                {/* Khối các nút hành động */}
                <div className="flex items-center gap-2 flex-wrap">
                  {activeSelectedGroupIds.length > 0 && (
                    <Button
                      size="middle"
                      icon={<SendOutlined className="text-sky-400 text-xs" />}
                      onClick={handleAutoSpreadPagesForGroups}
                      className="text-xs font-medium rounded-lg bg-slate-800 border-slate-700 text-slate-300 hover:text-white shrink-0"
                      title="Tự động bốc số Page bằng đúng số lượng nhóm đã chọn"
                    >
                      Rải Page đều Nhóm
                    </Button>
                  )}
                  <Tooltip title="Xem, sửa tên, cập nhật hoặc xóa các cấu hình đã lưu">
                    <Button
                      size="middle"
                      icon={<SettingOutlined className="text-slate-300 text-xs" />}
                      onClick={() => setManagePresetsModalOpen(true)}
                      className="text-xs font-medium rounded-lg bg-slate-800 border-slate-700 text-slate-300 hover:text-white shrink-0"
                    >
                      Quản lý cấu hình
                    </Button>
                  </Tooltip>
                  <Button
                    type="primary"
                    size="middle"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      if (activeSelectedGroupIds.length === 0 && activeSelectedFanpageIds.length === 0) {
                        message.warning('Vui lòng chọn ít nhất 1 nhóm hoặc 1 Page trước khi lưu!');
                        return;
                      }
                      setNewPresetName(`Combo ${activeSelectedGroupIds.length} Nhóm • ${activeSelectedFanpageIds.length} Page`);
                      setSavePresetModalOpen(true);
                    }}
                    className="text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white border-0 shadow-sm shrink-0"
                  >
                    Lưu mới
                  </Button>
                </div>
              </div>

              {/* BƯỚC 2: KHUNG ĐIỀU KHIỂN XUẤT BẢN */}
              <div className="space-y-4">
                {/* NẾU LÀ GROUP_ONLY HOẶC FANPAGE_AND_GROUP: HIỂN THỊ KHUNG CHỌN NHÓM ĐẦU TIÊN ĐỂ LUỒNG TỰ NHIÊN HƠN */}
                {(postMode === 'GROUP_ONLY' || postMode === 'FANPAGE_AND_GROUP') && (
                  <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-700/60 shadow-xl space-y-3.5 backdrop-blur-md">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-800">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-sm shadow-sm shrink-0">
                          <TeamOutlined />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                            <span>Nhóm Facebook nhận bài</span>
                            {activeSelectedGroupIds.length > 0 ? (
                              <Tag color="emerald" className="!rounded-full font-bold text-xs !m-0 border-0 bg-emerald-500/20 text-emerald-300">
                                ✓ Đã chọn {activeSelectedGroupIds.length} nhóm
                              </Tag>
                            ) : (
                              <Tag color="warning" className="!rounded-full font-semibold text-xs !m-0 border-0 bg-amber-500/20 text-amber-300">
                                ⚠️ Chưa chọn nhóm
                              </Tag>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            Chọn các nhóm Facebook sẽ nhận bài viết xuất bản ({groupAccountsWithId.length} Nhóm có sẵn)
                          </div>
                        </div>
                      </div>

                      <Button
                        size="small"
                        icon={<SafetyCertificateOutlined className="text-emerald-400" />}
                        onClick={() => setGroupCheckModalVisible(true)}
                        className="text-xs text-emerald-300 hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 rounded-xl h-8 font-semibold self-start sm:self-auto"
                      >
                        Kiểm tra tư cách nhóm
                      </Button>
                    </div>

                    <Form.Item
                      name={postMode === 'GROUP_ONLY' ? 'targetGroupId' : 'groupNames'}
                      rules={[{ required: true, message: 'Vui lòng chọn ít nhất 1 nhóm nhận bài' }]}
                      className="!mb-0"
                    >
                      <Select
                        mode="multiple"
                        size="large"
                        placeholder="🔍 Gõ tên hoặc ID nhóm Facebook để tìm kiếm và chọn nhanh..."
                        showSearch
                        allowClear
                        optionFilterProp="filterLabel"
                        filterOption={(input, option: any) => {
                          const label = String(option?.filterLabel || option?.label || '').toLowerCase();
                          const query = input.toLowerCase();
                          if (label.includes(query)) return true;
                          const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                          return strip(label).includes(strip(query));
                        }}
                        className="w-full"
                        options={unifiedGroupOptions}
                      />
                    </Form.Item>

                    {/* Đăng ẩn danh (chỉ với GROUP_ONLY) */}
                    {postMode === 'GROUP_ONLY' && (
                      <div className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${isAnonymous
                          ? 'bg-amber-950/25 border-amber-500/40 shadow-sm'
                          : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                        }`}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0 border transition-colors ${isAnonymous
                              ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                              : 'bg-slate-800/80 border-slate-700/60 text-slate-400'
                            }`}>
                            🕵️
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold flex items-center gap-2 flex-wrap">
                              <span className={isAnonymous ? 'text-amber-200' : 'text-slate-200'}>
                                Đăng ẩn danh vào Group
                              </span>
                              {isAnonymous ? (
                                <Tag color="warning" className="!rounded-full text-[10px] font-bold !m-0 !px-2 border-0 bg-amber-500/20 text-amber-300">
                                  Ẩn danh tính {selectedTargetAccount?.pageName ? selectedTargetAccount.pageName.replace(/^👤\s*Nick Cá Nhân\s*\((.*)\)$/, '$1') : 'Nick cá nhân'}
                                </Tag>
                              ) : (
                                <span className="text-[11px] text-slate-500 font-normal">
                                  Thành viên ẩn danh
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate">
                              Xuất bản bài dưới tư cách "Thành viên ẩn danh", bảo vệ danh tính tài khoản thật.
                            </div>
                          </div>
                        </div>
                        <Switch
                          checked={isAnonymous}
                          onChange={(checked) => setIsAnonymous(checked)}
                          className={isAnonymous ? '!bg-amber-500' : ''}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* KHUNG CHỌN TÀI KHOẢN ĐẠI DIỆN ĐĂNG BÀI */}
                <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-700/60 shadow-xl space-y-4 backdrop-blur-md">
                  {/* Header: Tiêu đề & Trạng thái phân bổ đang kích hoạt + Nút reset */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 text-sm shadow-sm shrink-0">
                        <ShareAltOutlined />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-100 flex items-center gap-2 flex-wrap">
                          <span>{postMode === 'FANPAGE_ONLY' ? 'Kênh Fanpage / Nick xuất bản' : 'Tài khoản đại diện đăng bài'}</span>
                          {isTwoViaActive ? (
                            <Tag className="!rounded-md font-semibold text-xs !m-0 border border-blue-500/30 bg-blue-500/15 text-blue-300">
                              2 Via song song (50/50)
                            </Tag>
                          ) : activeSelectedFanpageIds.length > 1 ? (
                            <Tag className="!rounded-md font-semibold text-xs !m-0 border border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                              Đang chia {activeSelectedFanpageIds.length} tài khoản
                            </Tag>
                          ) : activeSelectedFanpageIds.length === 1 ? (
                            <Tag className="!rounded-md font-semibold text-xs !m-0 border border-slate-700 bg-slate-800 text-slate-300">
                              1 tài khoản
                            </Tag>
                          ) : null}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {postMode === 'FANPAGE_ONLY'
                            ? 'Chọn 1 hoặc nhiều Fanpage/Via để đăng bài (chọn nhiều sẽ tự động chia đều bài):'
                            : 'Chọn 1 hoặc nhiều Nick/Page đại diện để đăng vào các Nhóm:'}
                        </div>
                      </div>
                    </div>

                    {/* Nút reset nếu đang chọn nhiều tài khoản */}
                    {activeSelectedFanpageIds.length > 1 && (
                      <Button
                        size="small"
                        type="text"
                        icon={<ReloadOutlined />}
                        onClick={handleResetToSingleTarget}
                        className="text-xs text-slate-300 hover:text-rose-300 self-start sm:self-auto bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl h-8 px-3"
                      >
                        Về 1 tài khoản
                      </Button>
                    )}
                  </div>

                  {/* Dòng 1: Chọn nhanh dạng pill gọn gàng */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-400 mr-1 flex items-center gap-1.5">
                      <ThunderboltOutlined className="text-blue-400" /> Chọn nhanh:
                    </span>
                    <button
                      type="button"
                      onClick={handleQuickSelectTwoVias}
                      className={`h-8 px-3 rounded-lg text-xs font-medium transition-all border cursor-pointer flex items-center gap-1.5 ${isTwoViaActive
                          ? 'bg-blue-500/15 text-blue-300 border-blue-500/50 shadow-xs ring-1 ring-blue-500/30'
                          : 'bg-slate-800/80 text-slate-300 border-slate-700/80 hover:border-slate-600 hover:bg-slate-700/80 hover:text-white'
                        }`}
                      title={twoMainViasDisplayNames || 'Thành An + Huỳnh Thạnh Phú'}
                    >
                      <ThunderboltOutlined className="text-xs" />
                      <span>2 Via chính (Song song)</span>
                      {isTwoViaActive && <span className="text-xs font-bold text-blue-400">✓</span>}
                    </button>

                    <button
                      type="button"
                      onClick={handleQuickSelectAllVias}
                      className="h-8 px-3 rounded-lg text-xs font-medium transition-all border border-slate-700/80 bg-slate-800/80 text-slate-300 hover:border-slate-600 hover:bg-slate-700/80 hover:text-white cursor-pointer flex items-center gap-1.5"
                    >
                      <TeamOutlined className="text-xs text-slate-400" />
                      <span>Tất cả {validPersonalVias.length} Via</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleQuickSelectAllPages}
                      className="h-8 px-3 rounded-lg text-xs font-medium transition-all border border-slate-700/80 bg-slate-800/80 text-slate-300 hover:border-slate-600 hover:bg-slate-700/80 hover:text-white cursor-pointer flex items-center gap-1.5"
                    >
                      <FileTextOutlined className="text-xs text-slate-400" />
                      <span>Tất cả {playwrightAccounts.length} Page</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleResetToSingleTarget}
                      className={`h-8 px-3 rounded-lg text-xs font-medium transition-all border cursor-pointer flex items-center gap-1.5 ${activeSelectedFanpageIds.length === 1 && !isTwoViaActive
                          ? 'bg-blue-500/15 text-blue-300 border-blue-500/50 shadow-xs ring-1 ring-blue-500/30'
                          : 'bg-slate-800/80 text-slate-300 border-slate-700/80 hover:border-slate-600 hover:bg-slate-700/80 hover:text-white'
                        }`}
                    >
                      <UserOutlined className="text-xs text-slate-400" />
                      <span>1 Nick cá nhân</span>
                      {activeSelectedFanpageIds.length === 1 && !isTwoViaActive && <span className="text-xs font-bold text-blue-400">✓</span>}
                    </button>
                  </div>

                  {/* Dòng 2: Ô Select tìm kiếm thông minh */}
                  <div>
                    <Form.Item
                      name="targetFanpageId"
                      rules={[{ required: true, message: 'Vui lòng chọn ít nhất 1 nơi xuất bản' }]}
                      className="!mb-0"
                    >
                      <Select
                        mode="multiple"
                        size="large"
                        placeholder="🔍 Gõ tên Page hoặc Nick cá nhân để tìm kiếm và chọn nhanh..."
                        showSearch
                        allowClear
                        optionFilterProp="filterLabel"
                        filterOption={(input, option: any) => {
                          const label = String(option?.filterLabel || option?.label || '').toLowerCase();
                          const query = input.toLowerCase();
                          if (label.includes(query)) return true;
                          const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                          return strip(label).includes(strip(query));
                        }}
                        tagRender={(tagProps) => {
                          const { value, closable, onClose } = tagProps;
                          const acc = playwrightAccounts.find((a) => accountTargetValue(a) === value) ||
                                      personalAccountTargets.find((a) => accountTargetValue(a) === value);
                          const name = acc ? (acc.pageName || acc.platformAccountId) : String(value);
                          const isPersonal = acc?.platform === 'FACEBOOK_PROFILE' || acc?.platform === 'FACEBOOK_PERSONAL';
                          const viaName = acc ? viaNameOf(acc) : '';
                          const normName = name.trim().toLowerCase();
                          const coAdmins = coAdminViasByPageName.get(normName) || [];
                          const isCoAdmin = coAdmins.length > 1;

                          return (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 mr-2 my-1 shadow-xs">
                              {isPersonal ? <UserOutlined className="text-slate-400 text-xs" /> : <FileTextOutlined className="text-slate-400 text-xs" />}
                              <span className="font-semibold text-slate-100">{name}</span>
                              {isCoAdmin && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30">
                                  2 Via
                                </span>
                              )}
                              {viaName && <span className="text-[11px] font-normal text-slate-400">· {viaName}</span>}
                              {closable && (
                                <CloseOutlined
                                  onClick={onClose}
                                  className="text-slate-400 hover:text-rose-400 text-[10px] ml-0.5 cursor-pointer transition-colors"
                                />
                              )}
                            </span>
                          );
                        }}
                        onChange={(vals) => {
                          const list = Array.isArray(vals) ? vals : [vals];
                          setIsMultiDistributeActive(list.length > 1);
                          setMultiSelectedTargets(list);
                          if (list.length > 1) {
                            setGroupDistributionMode('PAGE_PER_GROUP');
                          }
                        }}
                        className="w-full"
                        options={unifiedAccountOptions}
                      />
                    </Form.Item>
                  </div>

                  {/* Tự động hiện cấu hình phân phối đa kênh khi FANPAGE_ONLY và chọn nhiều tài khoản */}
                  {postMode === 'FANPAGE_ONLY' && activeSelectedFanpageIds.length > 1 && (
                    <div className="p-4 bg-slate-950/70 rounded-xl border border-indigo-900/60 space-y-3">
                      <div className="flex items-center justify-between text-xs sm:text-sm font-bold text-indigo-300">
                        <span className="flex items-center gap-2">
                          <ThunderboltFilled className="text-amber-400" /> Cài đặt phân phối bài cho {activeSelectedFanpageIds.length} tài khoản:
                        </span>
                        <Tag color="cyan" className="!rounded-full font-bold text-xs !m-0">TỰ ĐỘNG CHIA BÀI</Tag>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                            Thuật toán phân chia nội dung:
                          </label>
                          <Select
                            size="middle"
                            value={distributionStrategy}
                            onChange={(val) => setDistributionStrategy(val)}
                            className="w-full"
                            options={[
                              { value: 'ROUND_ROBIN', label: '🔄 Xoay vòng đều (Bài 1 ➔ Kênh A, Bài 2 ➔ Kênh B...)' },
                              { value: 'DAILY_QUOTA', label: '🎯 Cân bằng theo chỉ tiêu ngày (Ưu tiên kênh thiếu bài)' },
                              { value: 'STAGGERED', label: '⏰ Đăng so le giờ (Mỗi kênh cách nhau vài phút)' },
                            ]}
                          />
                        </div>

                        {distributionStrategy === 'STAGGERED' && (
                          <div>
                            <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                              Khoảng cách so le giữa các kênh (phút):
                            </label>
                            <InputNumber
                              min={1}
                              max={120}
                              value={staggerIntervalMinutes}
                              onChange={(v) => setStaggerIntervalMinutes(v || 2)}
                              className="w-full"
                              addonAfter="phút / kênh"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Chế độ phân bổ Nhóm & Page linh hoạt khi chọn N Nhóm và N Page */}
                {(postMode === 'GROUP_ONLY' || postMode === 'FANPAGE_AND_GROUP') && activeSelectedGroupIds.length > 0 && (
                  <div className="p-4 sm:p-5 rounded-2xl border border-indigo-500/40 bg-gradient-to-r from-slate-900/90 via-indigo-950/40 to-slate-900/90 shadow-xl space-y-4 backdrop-blur-md">
                    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3.5 border-b border-indigo-500/20 pb-3">
                      <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
                        <div className="w-8 h-8 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-indigo-300 shrink-0 mt-0.5 sm:mt-0">
                          <DeploymentUnitOutlined className="text-base" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-slate-100 flex flex-wrap items-center gap-2">
                            <span>⚡ Phân bổ Page / Nick đăng bài vào {activeSelectedGroupIds.length} Nhóm</span>
                            <Tag color="cyan" className="!rounded-full text-[11px] font-bold shrink-0 m-0">Smart Allocation</Tag>
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            Tuỳ chỉnh số Page xuất bản (1 Page, 2 Page hoặc {activeSelectedGroupIds.length} Page) cho {activeSelectedGroupIds.length} Nhóm đã chọn.
                          </div>
                        </div>
                      </div>
                      <Radio.Group
                        value={groupDistributionMode}
                        onChange={(e) => setGroupDistributionMode(e.target.value)}
                        buttonStyle="solid"
                        size="middle"
                        className="shrink-0 flex flex-wrap sm:flex-nowrap"
                      >
                        <Radio.Button value="PAGE_PER_GROUP" className="text-xs">
                          🛡️ 1 Page / Nhóm (Khuyên dùng)
                        </Radio.Button>
                        <Radio.Button value="ROUND_ROBIN_POSTS" className="text-xs">
                          🔄 Xoay vòng qua Nhóm
                        </Radio.Button>
                        <Radio.Button value="CROSS_ALL" className="text-xs">
                          ⚡ Tất cả Page x Tất cả Nhóm
                        </Radio.Button>
                      </Radio.Group>
                    </div>

                    {/* Phân tích sơ đồ gán việc */}
                    <div className="bg-slate-950/70 p-3.5 rounded-xl border border-indigo-900/50 text-xs text-slate-300 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-indigo-200">
                        <span className="flex items-center gap-1.5">
                          <span>📊 Dự kiến phân bổ công việc:</span>
                          <span className="text-slate-400 font-normal">({validLinkCount || 10} bài x {activeSelectedGroupIds.length} Nhóm x {Math.max(1, activeSelectedFanpageIds.length)} Page)</span>
                        </span>
                        <Tag color="purple" className="!rounded-full font-mono text-xs px-2.5 py-0.5 font-bold">
                          🎯 Tạo tổng cộng: {calculatedTotalQueueCount} bài queue
                        </Tag>
                      </div>

                      {groupDistributionMode === 'PAGE_PER_GROUP' && (
                        <div className="space-y-2 pt-0.5">
                          <div className="text-emerald-400 font-medium text-xs flex items-center gap-1.5">
                            <CheckCircleOutlined />
                            <span>Tất cả {validLinkCount || 10} bài đều đăng đủ vào cả {activeSelectedGroupIds.length} Nhóm (tổng cộng {(validLinkCount || 10) * Math.max(1, activeSelectedGroupIds.length)} bài queue). Các bài trong từng nhóm sẽ được luân phiên chia đều qua cả {Math.max(1, activeSelectedFanpageIds.length)} Page để không Page nào bị ôm nhiều bài.</span>
                          </div>
                        </div>
                      )}

                      {groupDistributionMode === 'ROUND_ROBIN_POSTS' && (
                        <div className="space-y-1.5 pt-0.5">
                          <div className="text-blue-400 font-medium text-xs flex items-center gap-1.5">
                            <SyncOutlined />
                            <span>{validLinkCount || 10} bài viết sẽ được xoay vòng chia đều lần lượt cho {activeSelectedGroupIds.length} nhóm (mỗi bài xuất hiện 1 nhóm, không trùng nội dung).</span>
                          </div>
                        </div>
                      )}

                      {groupDistributionMode === 'CROSS_ALL' && (
                        <div className="space-y-1.5 pt-0.5">
                          <div className="text-amber-400 font-medium text-xs flex items-center gap-1.5">
                            <WarningOutlined />
                            <span>Chế độ nhân bản dồn: Mỗi bài sẽ được đăng bởi TẤT CẢ {Math.max(1, activeSelectedFanpageIds.length)} Page/Nick vào TẤT CẢ {activeSelectedGroupIds.length} Nhóm ({validLinkCount || 10} bài x {activeSelectedGroupIds.length} Nhóm x {Math.max(1, activeSelectedFanpageIds.length)} Page = {calculatedTotalQueueCount} bài queue).</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Hiển thị ô giãn cách khoảng cách thời gian khi chọn từ 2 Nhóm trở lên */}
                    {hasMultipleGroupsSelected && (
                      <div className="pt-2 border-t border-indigo-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shrink-0 text-purple-300">
                            <ClockCircleOutlined className="text-sm" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-purple-200 flex items-center gap-1.5">
                              <span>⏱️ Khoảng cách thời gian đăng giữa các nhóm:</span>
                              <Tag color="purple" className="!rounded-full text-[10px] font-mono">Khuyên dùng: 2 - 3 phút (tự động cuốn chiếu)</Tag>
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              Tự động rải giãn thời gian giữa các nhóm để đảm bảo an toàn tuyệt đối cho tài khoản.
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 bg-slate-950/70 p-1.5 rounded-xl border border-purple-500/30 self-start sm:self-auto">
                          <span className="text-xs text-slate-300 font-semibold pl-1.5">Giãn cách:</span>
                          <InputNumber
                            min={1}
                            max={1440}
                            value={groupStaggerInterval}
                            onChange={(val) => setGroupStaggerInterval(val || 2)}
                            addonAfter="phút"
                            className="w-28"
                            size="middle"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Danh sách nội dung và lịch đăng */}
            <section className="poster-form-section">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-800/80">
                <div>
                  <div className="poster-section-heading !mb-0">
                    <span className="poster-step-number">3</span>
                    <div>
                      <h2 className="flex items-center gap-2">Thêm nội dung
                        {validLinkCount > 0 && (
                          <Badge
                            count={`${validLinkCount} bài`}
                            style={{ backgroundColor: '#2563eb' }}
                          />
                        )}
                      </h2>
                      <p>Dán liên kết nguồn, sau đó chọn đăng ngay hoặc hẹn giờ cho từng bài.</p>
                    </div>
                  </div>
                </div>
                <Button 
                  type="primary" 
                  icon={<PlusOutlined />} 
                  onClick={addLinkItem} 
                  className="w-full sm:w-auto !h-9 !px-4 !rounded-xl !font-bold !text-xs !bg-gradient-to-r !from-blue-600 !via-indigo-600 !to-indigo-700 hover:!from-blue-500 hover:!to-indigo-600 !border !border-blue-400/30 !shadow-md !shadow-indigo-950/40 transition-all hover:scale-[1.02]"
                >
                  Thêm bài
                </Button>
              </div>

              <div className="poster-source-row">
                <span className="poster-source-label">Lấy nội dung từ</span>
                <div className="poster-source-actions">
                  <Button icon={<LinkOutlined className="text-sky-400" />} onClick={() => setBulkModalVisible(true)}>Dán nhiều link</Button>
                  <Button icon={<FileTextOutlined className="text-emerald-400" />} onClick={() => setShowArticleBatchModal(true)}>Cào báo & tin tức</Button>
                  <Button icon={<TeamOutlined className="text-purple-400" />} onClick={() => setGroupHunterDrawerVisible(true)}>Quét bài Group FB</Button>
                  <Button icon={<FireOutlined className="text-amber-400" />} onClick={() => setHunterDrawerVisible(true)}>Săn kênh TikTok</Button>
                </div>
              </div>

              {/* Bảng Ma Trận Phân Bổ Đa Kênh Xem Trước */}
              {isMatrixDistributionVisible && effectiveMultiTargets.length > 0 && validLinkCount > 0 && (
                <div className="mb-5 p-4 rounded-xl border border-cyan-800/60 bg-gradient-to-br from-slate-900/90 to-blue-950/40 shadow-md">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-700/60">
                    <div className="flex items-center gap-2">
                      <ThunderboltFilled className="text-amber-400 text-base" />
                      <span className="font-bold text-sm text-slate-100">
                        Ma trận phân bổ: {validLinkCount} bài viết ➔ {effectiveMultiTargets.length} kênh đích
                      </span>
                    </div>
                    <Tag color="cyan" className="!rounded-full font-bold text-xs self-start sm:self-auto">
                      {postMode === 'FANPAGE_ONLY' ? (
                        <>
                          {distributionStrategy === 'ROUND_ROBIN' && '🔄 Xoay vòng đều (Round-Robin)'}
                          {distributionStrategy === 'DAILY_QUOTA' && '🎯 Cân bằng theo chỉ tiêu ngày'}
                          {distributionStrategy === 'STAGGERED' && `⏰ So le giờ (+${staggerIntervalMinutes}p/kênh)`}
                        </>
                      ) : (
                        <>
                          {groupDistributionMode === 'ROUND_ROBIN_POSTS' && '🔄 Xoay vòng đều Page qua các bài'}
                          {groupDistributionMode === 'PAGE_PER_GROUP' && '🛡️ Phân bổ Page theo Nhóm'}
                          {groupDistributionMode === 'CROSS_ALL' && '⚡ Tất cả Page x Tất cả Nhóm'}
                        </>
                      )}
                    </Tag>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-700/80 text-slate-400 font-semibold">
                          <th className="py-2 px-2 w-12 text-center">#</th>
                          <th className="py-2 px-2">Bài viết / Link nguồn</th>
                          <th className="py-2 px-2 w-64">Kênh xuất bản được chia</th>
                          <th className="py-2 px-2 w-44 text-right">Giờ đăng dự kiến</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {linkItems.filter((i) => i.url.trim().length > 0).map((item, idx) => {
                          const dist = calculatedDistribution[item.id];
                          const currentTarget = (dist?.targetValue && effectiveMultiTargets.includes(dist.targetValue))
                            ? dist.targetValue
                            : effectiveMultiTargets[idx % effectiveMultiTargets.length];
                          const timeStr = dist?.scheduledAt ? dist.scheduledAt.format('DD/MM/YYYY HH:mm') : (item.isNow ? 'Đăng ngay' : item.scheduledAt.format('DD/MM/YYYY HH:mm'));

                          return (
                            <tr key={item.id} className="hover:bg-slate-800/30">
                              <td className="py-2 px-2 text-center font-bold text-blue-400">
                                {idx + 1}
                              </td>
                              <td className="py-2 px-2 max-w-xs truncate font-mono text-slate-300">
                                {previews[item.id]?.caption ? (
                                  <span className="font-sans font-medium text-slate-200">
                                    {previews[item.id].caption!.substring(0, 55)}...
                                  </span>
                                ) : (
                                  <span className="truncate">{item.url}</span>
                                )}
                              </td>
                              <td className="py-2 px-2">
                                <Select
                                  size="small"
                                  value={currentTarget}
                                  onChange={(newTarget) => {
                                    setCustomItemTargets((prev) => ({
                                      ...prev,
                                      [item.id]: newTarget,
                                    }));
                                  }}
                                  className="w-full text-xs"
                                >
                                  {effectiveMultiTargets.map((tVal) => {
                                    const acc = postingIdentities.find((a) => accountTargetValue(a) === tVal || a.platformAccountId === tVal || String(a.id) === tVal);
                                    const isPersonal = acc?.platformAccountId === 'PERSONAL_PROFILE' || acc?.platform === 'FACEBOOK_PERSONAL';
                                    const viaName = acc ? viaNameOf(acc) : '';
                                    return (
                                      <Option key={tVal} value={tVal}>
                                        <span className="truncate">
                                          {isPersonal ? '👤 ' : '📄 '}{acc?.pageName || acc?.platformAccountId || tVal}{viaName ? ` · ${viaName}` : ''}
                                        </span>
                                      </Option>
                                    );
                                  })}
                                </Select>
                              </td>
                              <td className="py-2 px-2 text-right font-mono text-slate-300">
                                <Tag color={item.isNow && idx === 0 ? 'processing' : 'default'} className="!rounded-md text-[11px] font-bold">
                                  {timeStr}
                                </Tag>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Công cụ dùng ít hơn được thu gọn, tránh chiếm toàn bộ vùng nhìn đầu tiên. */}
              <div className="mb-4 rounded-xl border border-slate-700/60 bg-slate-800/40 overflow-hidden backdrop-blur-sm shadow-xs">
                <button
                  type="button"
                  className="w-full flex items-center gap-2.5 p-3.5 text-left hover:bg-slate-700/30 transition-colors"
                  onClick={() => setBatchToolsOpen((open) => !open)}
                  aria-expanded={batchToolsOpen}
                >
                  <div className="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center font-bold text-sm shrink-0 border border-blue-500/25">
                    <ThunderboltOutlined />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-200">Chia lịch & thao tác hàng loạt</div>
                    <div className="text-xs text-slate-400">Dàn đều thời gian hoặc bật/tắt bình luận cho toàn bộ danh sách</div>
                  </div>
                  <span className="text-xs font-semibold text-blue-400 shrink-0 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20">{batchToolsOpen ? 'Thu gọn' : 'Mở công cụ'}</span>
                </button>

                {batchToolsOpen && <div className="border-t border-slate-700/60 bg-slate-900/60 p-4 sm:p-5 space-y-4">
                  <div>
                    <div className="text-xs font-bold text-slate-300 mb-2 flex items-center justify-between">
                      <span>⚙️ Chế độ chia lịch hàng loạt:</span>
                      {batchScheduleMode === 'WINDOW' && linkItems.length > 1 && (
                        <Tag color="cyan" className="!m-0 text-xs font-semibold">
                          ⚡ Chia đều ~{Math.round(
                            (batchWindowEndTime.hour() * 60 + batchWindowEndTime.minute() - (batchWindowStartTime.hour() * 60 + batchWindowStartTime.minute()) + (batchWindowEndTime.isBefore(batchWindowStartTime) ? 1440 : 0)) / Math.max(1, linkItems.length - 1)
                          )} phút / bài
                        </Tag>
                      )}
                    </div>
                    <Segmented
                      block
                      size="middle"
                      value={batchScheduleMode}
                      onChange={(val) => setBatchScheduleMode(val as 'WINDOW' | 'INTERVAL' | 'NOW')}
                      options={[
                        { label: '🎯 Chia đều khung giờ (Từ - Đến)', value: 'WINDOW' },
                        { label: '⏱️ Giãn cách cố định', value: 'INTERVAL' },
                        { label: '⚡ Đăng ngay', value: 'NOW' },
                      ]}
                      className="bg-slate-950/80 p-1 border border-slate-700/80 text-xs mb-3"
                    />
                  </div>

                  {batchScheduleMode === 'WINDOW' && (
                    <div className="bg-slate-950/50 p-3.5 rounded-xl border border-slate-800 space-y-3">
                      {/* Nút bấm chọn nhanh Khung Giờ Vàng */}
                      <div className="flex items-center gap-1.5 flex-wrap pb-2 border-b border-slate-800/80">
                        <span className="text-[11px] text-slate-400 font-semibold">🌟 Khung giờ:</span>
                        <button
                          type="button"
                          onClick={() => {
                            setBatchWindowStartTime(dayjs().hour(9).minute(0).second(0));
                            setBatchWindowEndTime(dayjs().hour(17).minute(30).second(0));
                          }}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700 cursor-pointer transition-all"
                        >
                          💼 Hành chính (09:00 - 17:30)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setBatchWindowStartTime(dayjs().hour(8).minute(30).second(0));
                            setBatchWindowEndTime(dayjs().hour(22).minute(0).second(0));
                          }}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 cursor-pointer transition-all"
                        >
                          🌟 Giờ vàng cả ngày (08:30 - 22:00)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setBatchWindowStartTime(dayjs().hour(11).minute(30).second(0));
                            setBatchWindowEndTime(dayjs().hour(23).minute(0).second(0));
                          }}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 cursor-pointer transition-all"
                        >
                          🌙 Trưa & Tối (11:30 - 23:00)
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <div className="text-[11px] font-bold text-slate-400 mb-1 flex items-center justify-between">
                            <span>📅 Ngày đăng:</span>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => setBatchWindowDate(dayjs())}
                                className="text-[10px] text-blue-400 hover:underline cursor-pointer"
                              >Hôm nay</button>
                              <span className="text-slate-600">|</span>
                              <button
                                type="button"
                                onClick={() => setBatchWindowDate(dayjs().add(1, 'day'))}
                                className="text-[10px] text-blue-400 hover:underline cursor-pointer"
                              >Ngày mai</button>
                            </div>
                          </div>
                          <DatePicker
                            value={batchWindowDate}
                            onChange={(val) => val && setBatchWindowDate(val)}
                            format="DD/MM/YYYY"
                            allowClear={false}
                            className="w-full rounded-xl"
                          />
                        </div>
                        <div>
                          <div className="text-[11px] font-bold text-slate-400 mb-1">
                            ⏰ Giờ bắt đầu (Start):
                          </div>
                          <TimePicker
                            value={batchWindowStartTime}
                            onChange={(val) => val && setBatchWindowStartTime(val)}
                            format="HH:mm"
                            minuteStep={5}
                            allowClear={false}
                            className="w-full rounded-xl"
                          />
                        </div>
                        <div>
                          <div className="text-[11px] font-bold text-slate-400 mb-1">
                            🏁 Giờ kết thúc (Hạn chót):
                          </div>
                          <TimePicker
                            value={batchWindowEndTime}
                            onChange={(val) => val && setBatchWindowEndTime(val)}
                            format="HH:mm"
                            minuteStep={5}
                            allowClear={false}
                            className="w-full rounded-xl"
                          />
                        </div>
                      </div>

                      {/* Tùy chọn chia nhiều ngày nếu danh sách bài lớn */}
                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-300 font-semibold">
                            🗓️ Rải nhiều ngày:
                          </span>
                          <Select
                            value={batchWindowMaxPerDay}
                            onChange={(val) => setBatchWindowMaxPerDay(val)}
                            size="small"
                            className="w-56 text-xs font-bold"
                            options={[
                              { value: -1, label: '✨ Tự động chống dồn (Khuyên dùng)' },
                              { value: 0, label: 'Đăng hết trong 1 ngày' },
                              { value: 3, label: 'Tối đa 3 bài / ngày' },
                              { value: 5, label: 'Tối đa 5 bài / ngày' },
                              { value: 8, label: 'Tối đa 8 bài / ngày' },
                              { value: 10, label: 'Tối đa 10 bài / ngày' },
                              { value: 15, label: 'Tối đa 15 bài / ngày' },
                              { value: 20, label: 'Tối đa 20 bài / ngày' },
                            ]}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-300 font-semibold">
                            ⏱️ Giãn cách:
                          </span>
                          <Select
                            value={desiredMinInterval}
                            onChange={(val) => setDesiredMinInterval(val)}
                            size="small"
                            className="w-32 text-xs font-bold"
                            options={[
                              { value: 15, label: '≥ 15 phút' },
                              { value: 20, label: '≥ 20 phút' },
                              { value: 30, label: '≥ 30 phút (Chuẩn)' },
                              { value: 45, label: '≥ 45 phút' },
                              { value: 60, label: '≥ 1 giờ' },
                              { value: 120, label: '≥ 2 giờ' },
                            ]}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 pt-2 flex-wrap">
                        <div className="text-[11px] text-slate-400">
                          💡 Sẽ chia đều <b>{linkItems.length} bài</b> từ <b>{batchWindowStartTime.format('HH:mm')}</b> đến <b>{batchWindowEndTime.format('HH:mm')}</b> {batchWindowMaxPerDay === -1 ? `(tự động chống dồn: giãn cách ≥ ${desiredMinInterval} phút/bài, tự tràn ngày sau nếu dày)` : batchWindowMaxPerDay > 0 && linkItems.length > batchWindowMaxPerDay ? `(rải qua ${Math.ceil(linkItems.length / batchWindowMaxPerDay)} ngày)` : `ngày ${batchWindowDate.format('DD/MM')}`}.
                        </div>
                        <Button
                          type="primary"
                          icon={<ScheduleOutlined />}
                          onClick={handleApplyBatchSchedule}
                          className="bg-blue-600 hover:bg-blue-500 font-bold rounded-xl shrink-0"
                        >
                          Áp dụng chia giờ
                        </Button>
                      </div>
                    </div>
                  )}

                  {batchScheduleMode === 'INTERVAL' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/50 p-3.5 rounded-xl border border-slate-800">
                      <div>
                        <div className="text-[11px] font-bold text-slate-400 mb-1">Thời điểm bắt đầu:</div>
                        <DatePicker
                          showTime
                          format="HH:mm DD/MM/YYYY"
                          value={batchStartTime}
                          onChange={(val) => val && setBatchStartTime(val)}
                          className="w-full rounded-xl"
                        />
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-slate-400 mb-1">Mỗi bài cách nhau:</div>
                        <div className="flex items-center gap-2">
                          <Select
                            value={batchInterval}
                            onChange={(val) => setBatchInterval(val)}
                            className="flex-1 min-w-0"
                            options={[
                              { value: 1, label: '⚡ 1 phút (Siêu tốc)' },
                              { value: 2, label: '⚡ 2 phút (Nhanh)' },
                              { value: 3, label: '⚡ 3 phút (Khuyên dùng)' },
                              { value: 5, label: '5 phút' },
                              { value: 10, label: '10 phút' },
                              { value: 15, label: '15 phút' },
                              { value: 20, label: '20 phút' },
                              { value: 30, label: '30 phút' },
                              { value: 45, label: '45 phút' },
                              { value: 60, label: '1 giờ' },
                              { value: 120, label: '2 giờ' },
                            ]}
                          />
                          <Button
                            type="primary"
                            icon={<ScheduleOutlined />}
                            onClick={handleApplyBatchSchedule}
                            className="bg-blue-600 hover:bg-blue-500 font-bold rounded-xl shrink-0"
                          >
                            Áp dụng
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {batchScheduleMode === 'NOW' && (
                    <div className="flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-300">
                      <span>⚡ Bài viết đầu tiên đăng ngay lập tức, các bài sau giãn cách mỗi {batchInterval} phút.</span>
                      <Button
                        type="primary"
                        icon={<ScheduleOutlined />}
                        onClick={handleApplyBatchSchedule}
                        className="bg-amber-600 hover:bg-amber-500 font-bold rounded-xl shrink-0 border-none"
                      >
                        Áp dụng
                      </Button>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2.5 pt-4 mt-4 border-t border-slate-700/60">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide shrink-0">
                      Tùy chọn hàng loạt:
                    </span>
                    <Tooltip title="Tự động đính kèm link nguồn bài viết gốc cho TẤT CẢ bài trong danh sách">
                      <Button
                        size="middle"
                        icon={<LinkOutlined />}
                        onClick={applyEnableAllCredit}
                        className="rounded-lg text-xs font-bold bg-blue-600/20 text-blue-300 border-blue-500/40 hover:bg-blue-600/30"
                      >
                        🔗 Kèm link toàn bộ
                      </Button>
                    </Tooltip>
                    <Tooltip title="Tự động chèn dòng 'Cre: Member ẩn danh' vào cuối caption cho TẤT CẢ bài viết">
                      <Button
                        size="middle"
                        icon={<UserOutlined />}
                        onClick={applyAnonymousCreditToAll}
                        className="rounded-lg text-xs font-bold bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30"
                      >
                        👤 Cre: Member ẩn danh toàn bộ
                      </Button>
                    </Tooltip>
                    <Tooltip title="Tự động lấy Tên người đăng gốc (hoặc Member ẩn danh nếu ẩn danh) chèn vào ô Caption cho TẤT CẢ bài viết">
                      <Button
                        size="middle"
                        icon={<UserOutlined />}
                        onClick={applyOriginalAuthorCreditToAll}
                        className="rounded-lg text-xs font-bold bg-cyan-500/20 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/30"
                      >
                        👤 Cre: Tác giả gốc toàn bộ
                      </Button>
                    </Tooltip>
                    <Tooltip title="Tự động chèn dòng 'Cre: [Nội dung tùy chỉnh]' vào cuối caption cho TẤT CẢ bài viết">
                      <Button
                        size="middle"
                        icon={<EditOutlined />}
                        onClick={() => openCustomCreModal(null)}
                        className="rounded-lg text-xs font-bold bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30"
                      >
                        ✏️ Cre Custom toàn bộ
                      </Button>
                    </Tooltip>
                    <Tooltip title="Tự động chèn Hashtag (VD: #Trending #Review...) vào ô caption cho TẤT CẢ bài viết">
                      <Button
                        size="middle"
                        icon={<TagOutlined />}
                        onClick={() => openHashtagModal(null)}
                        className="rounded-lg text-xs font-bold bg-pink-500/20 text-pink-300 border-pink-500/40 hover:bg-pink-500/30"
                      >
                        🏷️ Hashtag toàn bộ
                      </Button>
                    </Tooltip>
                    <Tooltip title="Không đính kèm link bài viết gốc / Nguồn tác giả cho TẤT CẢ bài trong danh sách">
                      <Button
                        size="middle"
                        icon={<DisconnectOutlined />}
                        onClick={applyDisableAllCredit}
                        className="rounded-lg text-xs font-bold border-slate-700 text-slate-300 hover:bg-slate-800"
                      >
                        🚫 Không link toàn bộ
                      </Button>
                    </Tooltip>
                    <span className="text-slate-600 font-bold">|</span>
                    <Tooltip title="Tắt bình luận tự động (kể cả cmt mặc định) cho TẤT CẢ bài trong danh sách, không cần tick từng dòng">
                      <Button
                        danger
                        size="middle"
                        icon={<StopOutlined />}
                        onClick={applyDisableAllComments}
                        className="rounded-lg text-xs font-bold"
                      >
                        Tắt cmt tất cả
                      </Button>
                    </Tooltip>
                    <Tooltip title="Bật lại bình luận tự động cho TẤT CẢ bài trong danh sách">
                      <Button
                        size="middle"
                        icon={<MessageOutlined />}
                        onClick={applyEnableAllComments}
                        className="rounded-lg text-xs font-bold border-slate-700 text-slate-200 hover:bg-slate-800"
                      >
                        Bật cmt tất cả
                      </Button>
                    </Tooltip>
                    {postMode !== 'FANPAGE_ONLY' && (
                      <>
                        <span className="text-slate-600 font-bold">|</span>
                        <Tooltip title="Tắt bình luận trong Nhóm cho TẤT CẢ bài trong danh sách">
                          <Button
                            size="middle"
                            icon={<StopOutlined />}
                            onClick={applyDisableAllGroupComments}
                            className="rounded-lg text-xs font-bold border-slate-700 text-slate-300 hover:bg-slate-800"
                          >
                            Tắt cmt Nhóm tất cả
                          </Button>
                        </Tooltip>
                      </>
                    )}
                  </div>
                </div>}
              </div>
              {/* Thanh thao tác nhanh hàng loạt nổi bật ngay trên danh sách bài viết */}
              {linkItems.length > 0 && (
                <div className="poster-bulk-credit mb-4 p-3 sm:p-3.5 bg-slate-900/90 rounded-2xl border border-slate-700/80 flex flex-wrap items-center justify-between gap-3 shadow-lg backdrop-blur-md">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center font-bold text-sm border border-blue-500/25 shrink-0">
                      <ThunderboltOutlined />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-100 flex items-center gap-2">
                        <span>Thao tác nhanh cho {linkItems.length} bài viết:</span>
                      </div>
                      <div className="text-[11px] text-slate-400">Áp dụng bình luận, chèn Cre hoặc chia đều Page cho toàn bộ danh sách</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Tooltip title="Tắt bình luận tự động (tick 'Không bình luận') cho TẤT CẢ các bài viết trong danh sách">
                      <Button
                        type="primary"
                        icon={<StopOutlined />}
                        onClick={applyDisableAllComments}
                        className="poster-quickcre-btn text-slate-200 font-semibold text-xs rounded-xl h-9 px-3 border-none shadow-sm"
                      >
                        Không bình luận
                      </Button>
                    </Tooltip>
                    {postMode !== 'FANPAGE_ONLY' && (
                      <Tooltip title="Bật Bình luận trong Nhóm cho TẤT CẢ bài viết trong danh sách">
                        <Button
                          type="primary"
                          icon={<MessageOutlined />}
                          onClick={applyEnableAllGroupComments}
                          className="poster-quickcre-btn text-slate-200 font-semibold text-xs rounded-xl h-9 px-3 border-none shadow-sm"
                        >
                          Bật cmt Nhóm
                        </Button>
                      </Tooltip>
                    )}
                    <Tooltip title="Chèn 'Cre: Member ẩn danh' vào ô caption cho TẤT CẢ các bài viết trong danh sách">
                      <Button
                        type="primary"
                        icon={<UserOutlined />}
                        onClick={applyAnonymousCreditToAll}
                        className="poster-quickcre-btn text-slate-200 font-semibold text-xs rounded-xl h-9 px-3 border-none shadow-sm"
                      >
                        Cre: Member ẩn danh
                      </Button>
                    </Tooltip>
                    <Tooltip title="Chèn Tên tác giả gốc (hoặc Member ẩn danh nếu bài ẩn danh) vào ô caption cho TẤT CẢ bài viết">
                      <Button
                        type="primary"
                        icon={<UserOutlined />}
                        onClick={applyOriginalAuthorCreditToAll}
                        className="poster-quickcre-btn text-slate-200 font-semibold text-xs rounded-xl h-9 px-3 border-none shadow-sm"
                      >
                        Cre: Tác giả gốc
                      </Button>
                    </Tooltip>
                    <Tooltip title="Nhập nội dung tùy chỉnh để chèn 'Cre: [Nội dung]' vào ô caption cho TẤT CẢ bài viết">
                      <Button
                        type="primary"
                        icon={<EditOutlined />}
                        onClick={() => openCustomCreModal(null)}
                        className="poster-quickcre-btn text-slate-200 font-semibold text-xs rounded-xl h-9 px-3 border-none shadow-sm"
                      >
                        Cre Custom
                      </Button>
                    </Tooltip>
                    <Tooltip title="Nhập danh sách Hashtag để chèn tự động vào ô caption cho TẤT CẢ bài viết trong danh sách">
                      <Button
                        type="primary"
                        icon={<TagOutlined />}
                        onClick={() => openHashtagModal(null)}
                        className="poster-quickcre-btn text-slate-200 font-semibold text-xs rounded-xl h-9 px-3 border-none shadow-sm"
                      >
                        Hashtag
                      </Button>
                    </Tooltip>
                    <Tooltip title={`Tự động chia đều ${linkItems.length} bài viết cho các Fanpage / Nick cá nhân đã chọn theo tỉ lệ tròn đều`}>
                      <Button
                        type="primary"
                        icon={<ShareAltOutlined />}
                        onClick={() => {
                          if (selectedDistributePages.length === 0) {
                            setSelectedDistributePages(postingIdentities.slice(0, 4).map(accountTargetValue));
                          }
                          setDistributeModalOpen(true);
                        }}
                        className="poster-quickcre-btn text-slate-200 font-semibold text-xs rounded-xl h-9 px-3 border-none shadow-sm"
                      >
                        Chia đều Page ({linkItems.length})
                      </Button>
                    </Tooltip>
                    {Object.keys(customItemTargets).length > 0 && (
                      <Tooltip title="Hủy bỏ cấu hình chia riêng cho từng bài, quay lại dùng Fanpage mặc định đã chọn ở trên">
                        <Button
                          type="dashed"
                          danger
                          icon={<ClearOutlined />}
                          onClick={resetEqualDistribution}
                          className="text-xs font-semibold rounded-xl h-9 px-3 border-rose-500/50 text-rose-300 hover:text-rose-200"
                        >
                          ✕ Xóa chia đều ({Object.keys(customItemTargets).length})
                        </Button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              )}

              {/* Mỗi bài là một tác vụ độc lập; không dùng khung cuộn lồng nhau. */}
              <div className="poster-post-list space-y-3.5">
                {swipeReviewItems.length > 0 && (
                  <div className="poster-swipe-launcher">
                    <div>
                      <span className="poster-swipe-launcher-icon"><EyeFilled /></span>
                      <span>
                        <strong>Duyệt nhanh từng bài</strong>
                        <small>Xem toàn bộ ảnh/video và caption, sau đó chọn giữ hoặc bỏ.</small>
                      </span>
                    </div>
                    <Button type="primary" icon={<ThunderboltOutlined />} onClick={openSwipeReview}>
                      Duyệt kiểu Tinder · {swipeReviewItems.length} bài
                    </Button>
                  </div>
                )}
                {linkItems.map((item, index) => {
                  const hasCustomComment = !!item.affiliateLink?.trim();
                  const isCommentOpen = !item.skipComment && (item.showCommentBox || hasCustomComment);
                  return (
                    <div
                      key={item.id}
                      className="poster-post-card flex flex-col bg-white rounded-xl border border-slate-200 transition-all overflow-hidden"
                    >
                      <div className="poster-post-header">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="poster-post-number">{index + 1}</span>
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-slate-800">Bài viết {index + 1}</div>
                            <div className={`text-[11px] ${item.inputType === 'MANUAL'
                              ? (item.manualContent?.trim() || (item.manualMediaUrls && item.manualMediaUrls.length > 0) ? 'text-emerald-600 font-semibold' : 'text-slate-400')
                              : (item.url.trim() ? 'text-emerald-600 font-semibold' : 'text-slate-400')
                              }`}>
                              {item.inputType === 'MANUAL'
                                ? (item.manualContent?.trim() || (item.manualMediaUrls && item.manualMediaUrls.length > 0) ? '✍️ Đã soạn nội dung' : '✍️ Chưa nhập nội dung')
                                : (item.url.trim() ? '🌐 Đã nhận liên kết nguồn' : '🌐 Chưa có liên kết nguồn')}
                            </div>
                          </div>
                        </div>

                        <div className="poster-post-header-actions flex items-center gap-2 flex-wrap">
                          <Select
                            showSearch
                            filterOption={(input, option) => {
                              const label = String(option?.label || '').toLowerCase();
                              const query = input.toLowerCase();
                              if (label.includes(query)) return true;
                              const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                              return strip(label).includes(strip(query));
                            }}
                            size="small"
                            placeholder="Chọn nơi đăng bài..."
                            value={
                              customItemTargets[item.id] ||
                              (isMultiDistributeActive ? calculatedDistribution[item.id]?.targetValue : undefined) ||
                              (Array.isArray(watchedTargetFanpageId)
                                ? watchedTargetFanpageId[index % Math.max(1, watchedTargetFanpageId.length)]
                                : watchedTargetFanpageId) ||
                              undefined
                            }
                            onChange={(val) => {
                              setCustomItemTargets((prev) => ({
                                ...prev,
                                [item.id]: val,
                              }));
                            }}
                            allowClear
                            className="w-52 text-xs shrink-0"
                            options={postingIdentities.map((fp) => ({
                              value: accountTargetValue(fp),
                              label: fp.platformAccountId === 'PERSONAL_PROFILE' || fp.platform === 'FACEBOOK_PERSONAL'
                                ? (isAnonymous ? `🕵️ ${fp.pageName || 'Nick Cá Nhân'} (Ẩn danh)` : `${fp.pageName || '👤 Nick Cá Nhân'}`)
                                : `🚩 ${fp.pageName || fp.platformAccountId}${viaNameOf(fp) ? ` · ${viaNameOf(fp)}` : ''}`,
                            }))}
                          />
                          <div className="poster-timing-toggle" role="group" aria-label={`Thời gian đăng bài ${index + 1}`}>
                            <button type="button" onClick={() => updateLinkMode(item.id, true)} className={item.isNow ? 'is-active' : ''}>
                              <ThunderboltOutlined /> Đăng ngay
                            </button>
                            <button type="button" onClick={() => updateLinkMode(item.id, false)} className={!item.isNow ? 'is-active' : ''}>
                              <ClockCircleOutlined /> Hẹn giờ
                            </button>
                          </div>
                          {item.inputType !== 'MANUAL' && (
                            <Tooltip title="Cào thử và xem trước ảnh/video trước khi đăng">
                              <Button
                                type="text"
                                icon={<EyeOutlined />}
                                loading={previews[item.id]?.loading}
                                onClick={() => handlePreviewLink(item)}
                                disabled={!item.url.trim()}
                                aria-label={`Xem trước bài ${index + 1}`}
                                className="poster-icon-action text-blue-600"
                              />
                            </Tooltip>
                          )}
                          <Tooltip title="Xóa bài này">
                            <Button
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => removeLinkItem(item.id)}
                              disabled={linkItems.length <= 1 && !item.url && !item.manualContent}
                              aria-label={`Xóa bài ${index + 1}`}
                              className="poster-icon-action"
                            />
                          </Tooltip>
                        </div>
                      </div>

                      <div className="poster-post-body space-y-4">
                        {/* Chuyển đổi giữa Dán link cào tự động và Tự soạn nội dung */}
                        <div className="poster-source-switch flex items-center justify-between gap-3 flex-wrap">
                          <Segmented
                            size="middle"
                            value={item.inputType || 'LINK'}
                            onChange={(val) => updateLinkInputType(item.id, val as 'LINK' | 'MANUAL')}
                            options={[
                              {
                                label: (
                                  <span className="flex items-center gap-2 px-3 py-1 text-xs font-semibold">
                                    <GlobalOutlined className="text-sm" /> Dán link cào tự động
                                  </span>
                                ),
                                value: 'LINK',
                              },
                              {
                                label: (
                                  <span className="flex items-center gap-2 px-3 py-1 text-xs font-semibold">
                                    <EditOutlined className="text-sm" /> Tự soạn nội dung & Studio
                                  </span>
                                ),
                                value: 'MANUAL',
                              },
                            ]}
                          />
                          {item.inputType === 'MANUAL' && (
                            <div className="flex items-center gap-2">
                              {(!item.manualMediaUrls || item.manualMediaUrls.length === 0) ? (
                                <Tag className="!font-medium !px-2.5 !py-0.5 !text-xs !rounded-lg !m-0 border border-slate-700 bg-slate-800 text-slate-300 flex items-center gap-1.5">
                                  <FileTextOutlined className="text-blue-400" />
                                  <span>Bài viết chữ (Pure Text)</span>
                                </Tag>
                              ) : (
                                <Tag className="!font-medium !px-2.5 !py-0.5 !text-xs !rounded-lg !m-0 border border-slate-700 bg-slate-800 text-slate-300 flex items-center gap-1.5">
                                  <PictureOutlined className="text-emerald-400" />
                                  <span>{item.manualMediaUrls.length} Media ({item.manualMediaUrls.filter((u, i) => isMediaVideo(u, item.manualMediaKinds?.[i])).length} Video, {item.manualMediaUrls.filter((u, i) => !isMediaVideo(u, item.manualMediaKinds?.[i])).length} Ảnh)</span>
                                </Tag>
                              )}
                            </div>
                          )}
                        </div>

                        {item.inputType === 'MANUAL' ? (
                          /* ================= GIAO DIỆN TỰ SOẠN BÀI VIẾT CHUYÊN NGHIỆP (STUDIO + LIVE PREVIEW) ================= */
                          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                            {/* CỘT TRÁI (lg:col-span-7): TRÌNH SOẠN THẢO VÀ QUẢN LÝ MEDIA */}
                            <div className="lg:col-span-7 space-y-4">
                              {/* PHẦN 1: NỘI DUNG VĂN BẢN (CAPTION) */}
                              <div className="bg-slate-900/90 border border-slate-700/80 rounded-2xl p-4 sm:p-5 space-y-3 shadow-md">
                                <div className="flex items-center justify-between flex-wrap gap-2 pb-1 border-b border-slate-800">
                                  <div className="flex items-center gap-2">
                                    <label className="text-sm font-bold text-slate-100 flex items-center gap-2">
                                      <FileTextOutlined className="text-blue-400 text-base" />
                                      <span>Nội dung bài viết (Caption):</span>
                                    </label>
                                    {(item.manualContent || '').length > 0 && (
                                      <span className="text-[11px] font-bold text-blue-400 bg-blue-950 px-2 py-0.5 rounded-md border border-blue-800/60">
                                        {(item.manualContent || '').length} ký tự · {(item.manualContent || '').trim().split(/\s+/).filter(Boolean).length} từ
                                      </span>
                                    )}
                                  </div>
                                  {(item.manualContent || '').trim() && (
                                    <Button
                                      size="small"
                                      type="text"
                                      danger
                                      icon={<ClearOutlined />}
                                      onClick={() => updateLinkManualContent(item.id, '')}
                                      className="text-xs h-7 px-2 font-bold"
                                    >
                                      Xóa trắng
                                    </Button>
                                  )}
                                </div>

                                {/* THANH CÔNG CỤ ĐỊNH DẠNG COMPACT SIÊU GỌN VÀ HIỆN ĐẠI (1 HÀNG) */}
                                <div className="flex items-center gap-1.5 flex-wrap bg-slate-950 p-1.5 rounded-xl border border-slate-800/90 shadow-inner text-xs">
                                  {/* Nhóm 1: Kiểu chữ Unicode */}
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <Tooltip title="Tiêu đề Lớn H1 (Viral)">
                                      <button
                                        type="button"
                                        onClick={() => applyTransformToSelection(item.id, toUnicodeHeading1, 'Đã áp dụng Tiêu đề Lớn H1!')}
                                        className="px-2 py-0.5 text-[11px] font-black bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-md transition-all active:scale-95 cursor-pointer shadow-xs"
                                      >
                                        H1
                                      </button>
                                    </Tooltip>

                                    <Tooltip title="Tiêu đề Vừa H2">
                                      <button
                                        type="button"
                                        onClick={() => applyTransformToSelection(item.id, toUnicodeHeading2, 'Đã áp dụng Tiêu đề Vừa H2!')}
                                        className="px-2 py-0.5 text-[11px] font-bold bg-slate-900 hover:bg-slate-800 text-blue-300 border border-slate-700/80 rounded-md transition-all active:scale-95 cursor-pointer"
                                      >
                                        H2
                                      </button>
                                    </Tooltip>

                                    <Tooltip title="In đậm Sans (𝗕𝗼𝗹𝗱)">
                                      <button
                                        type="button"
                                        onClick={() => applyTransformToSelection(item.id, toUnicodeBold, 'Đã in đậm (Sans Bold)!')}
                                        className="px-2 py-0.5 text-[11px] font-black bg-slate-900 hover:bg-slate-800 text-slate-100 border border-slate-700/80 rounded-md transition-all active:scale-95 cursor-pointer"
                                      >
                                        𝗕
                                      </button>
                                    </Tooltip>

                                    <Tooltip title="In nghiêng (𝘐𝘵𝘢𝘭𝘪𝘤)">
                                      <button
                                        type="button"
                                        onClick={() => applyTransformToSelection(item.id, toUnicodeItalic, 'Đã in nghiêng (Italic)!')}
                                        className="px-2 py-0.5 text-[11px] italic font-bold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 rounded-md transition-all active:scale-95 cursor-pointer"
                                      >
                                        𝘐
                                      </button>
                                    </Tooltip>

                                    <Tooltip title="Gạch ngang (S̶a̶l̶e̶)">
                                      <button
                                        type="button"
                                        onClick={() => applyTransformToSelection(item.id, toUnicodeStrikethrough, 'Đã gạch ngang chữ!')}
                                        className="px-2 py-0.5 text-[11px] font-semibold line-through bg-slate-900 hover:bg-rose-950 text-rose-300 border border-slate-700/80 rounded-md transition-all active:scale-95 cursor-pointer"
                                      >
                                        S̶
                                      </button>
                                    </Tooltip>

                                    <Tooltip title="Gạch chân (U̲n̲d̲e̲r̲l̲i̲n̲e̲)">
                                      <button
                                        type="button"
                                        onClick={() => applyTransformToSelection(item.id, toUnicodeUnderline, 'Đã gạch chân chữ!')}
                                        className="px-2 py-0.5 text-[11px] font-semibold underline bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 rounded-md transition-all active:scale-95 cursor-pointer"
                                      >
                                        U̲
                                      </button>
                                    </Tooltip>

                                    <Tooltip title="Khung nổi bật 【 𝗧𝗘𝗫𝗧 】">
                                      <button
                                        type="button"
                                        onClick={() => applyTransformToSelection(item.id, toUnicodeBoxedTag, 'Đã đóng khung nổi bật!')}
                                        className="px-2 py-0.5 text-[11px] font-bold bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-slate-700/80 rounded-md transition-all active:scale-95 cursor-pointer"
                                      >
                                        【Tag】
                                      </button>
                                    </Tooltip>

                                    {/* Font khác Menu */}
                                    <Popover
                                      trigger="click"
                                      placement="bottomLeft"
                                      content={
                                        <div className="flex flex-col gap-1 p-1">
                                          <button
                                            type="button"
                                            onClick={() => applyTransformToSelection(item.id, toUnicodeSerifBold, 'Đã in đậm Serif!')}
                                            className="px-2.5 py-1 text-xs font-serif font-black bg-slate-800 hover:bg-slate-700 text-slate-100 rounded text-left cursor-pointer"
                                          >
                                            𝐁 đậm Serif
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => applyTransformToSelection(item.id, toUnicodeBoldItalic, 'Đã in đậm nghiêng!')}
                                            className="px-2.5 py-1 text-xs italic font-black bg-slate-800 hover:bg-slate-700 text-amber-300 rounded text-left cursor-pointer"
                                          >
                                            𝘼 nghiêng đậm
                                          </button>
                                        </div>
                                      }
                                    >
                                      <button
                                        type="button"
                                        className="px-1.5 py-0.5 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/80 rounded-md flex items-center gap-0.5 cursor-pointer"
                                      >
                                        <span>Font...</span>
                                        <DownOutlined className="text-[9px]" />
                                      </button>
                                    </Popover>
                                  </div>

                                  <div className="h-4 w-px bg-slate-800 my-auto hidden sm:block" />

                                  {/* Nhóm 2: Dấu câu / Bullet List */}
                                  <div className="flex items-center gap-1">
                                    <Tooltip title="Chèn dấu tích ✔">
                                      <button
                                        type="button"
                                        onClick={() => insertSnippetAtCursor(item.id, '\n✔ ')}
                                        className="h-6 w-6 text-[11px] font-bold bg-slate-900 hover:bg-emerald-950 text-emerald-400 border border-slate-700/80 rounded-md flex items-center justify-center cursor-pointer"
                                      >
                                        ✔
                                      </button>
                                    </Tooltip>
                                    <Tooltip title="Chèn dấu chấm •">
                                      <button
                                        type="button"
                                        onClick={() => insertSnippetAtCursor(item.id, '\n• ')}
                                        className="h-6 w-6 text-[11px] font-bold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 rounded-md flex items-center justify-center cursor-pointer"
                                      >
                                        •
                                      </button>
                                    </Tooltip>
                                    <Tooltip title="Chèn chỉ tay 👉">
                                      <button
                                        type="button"
                                        onClick={() => insertSnippetAtCursor(item.id, '\n👉 ')}
                                        className="h-6 w-6 text-[11px] font-bold bg-slate-900 hover:bg-slate-800 text-amber-300 border border-slate-700/80 rounded-md flex items-center justify-center cursor-pointer"
                                      >
                                        👉
                                      </button>
                                    </Tooltip>
                                    <Tooltip title="Chèn 1️⃣">
                                      <button
                                        type="button"
                                        onClick={() => insertSnippetAtCursor(item.id, '\n1️⃣ ')}
                                        className="h-6 w-6 text-[11px] font-bold bg-slate-900 hover:bg-slate-800 text-blue-300 border border-slate-700/80 rounded-md flex items-center justify-center cursor-pointer"
                                      >
                                        1️⃣
                                      </button>
                                    </Tooltip>
                                  </div>

                                  <div className="h-4 w-px bg-slate-800 my-auto hidden sm:block" />

                                  {/* Nhóm 3: Kẻ ngang Popover */}
                                  <Popover
                                    trigger="click"
                                    placement="bottom"
                                    content={
                                      <div className="flex flex-col gap-1 p-1">
                                        <button
                                          type="button"
                                          onClick={() => insertSnippetAtCursor(item.id, '\n━━━━━━━━━━━━━━━━━━━━━\n')}
                                          className="px-2.5 py-1 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-left cursor-pointer"
                                        >
                                          ━━━━━━━━ Dày
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => insertSnippetAtCursor(item.id, '\n──────── ⋆⋅☆⋅⋆ ────────\n')}
                                          className="px-2.5 py-1 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-left cursor-pointer"
                                        >
                                          ── ⋆⋅☆⋅⋆ ── Ngôi sao
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => insertSnippetAtCursor(item.id, '\n═════════════════════\n')}
                                          className="px-2.5 py-1 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-left cursor-pointer"
                                        >
                                          ════════ Kẻ đôi
                                        </button>
                                      </div>
                                    }
                                  >
                                    <button
                                      type="button"
                                      className="px-2 py-0.5 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 rounded-md flex items-center gap-1 cursor-pointer"
                                    >
                                      <HolderOutlined className="text-amber-400 text-xs" />
                                      <span>Kẻ ngang</span>
                                      <DownOutlined className="text-[9px] text-slate-500" />
                                    </button>
                                  </Popover>

                                  {/* Nhóm 4: Mẫu CTA Popover */}
                                  <Popover
                                    trigger="click"
                                    placement="bottom"
                                    content={
                                      <div className="flex flex-col gap-1 p-1 min-w-44">
                                        <button
                                          type="button"
                                          onClick={() => insertSnippetAtCursor(item.id, '\n\n👇 BÌNH LUẬN XUỐNG DƯỚI ĐỂ ĐƯỢC TƯ VẤN 👇\n')}
                                          className="px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-purple-950 text-purple-300 rounded text-left cursor-pointer"
                                        >
                                          👇 Cmt tư vấn
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => insertSnippetAtCursor(item.id, '\n\n👉 INBOX NGAY ĐỂ NHẬN ƯU ĐÃI! 🔥\n')}
                                          className="px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-amber-950 text-amber-300 rounded text-left cursor-pointer"
                                        >
                                          🔥 Inbox ưu đãi
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => insertSnippetAtCursor(item.id, '\n\n📌 LƯU LẠI BÀI VIẾT ĐỂ DÙNG KHI CẦN NHÉ! ❤️\n')}
                                          className="px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-blue-950 text-blue-300 rounded text-left cursor-pointer"
                                        >
                                          📌 Lưu bài viết
                                        </button>
                                      </div>
                                    }
                                  >
                                    <button
                                      type="button"
                                      className="px-2 py-0.5 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 text-purple-300 border border-slate-700/80 rounded-md flex items-center gap-1 cursor-pointer"
                                    >
                                      <RocketOutlined className="text-purple-400 text-xs" />
                                      <span>Mẫu CTA</span>
                                      <DownOutlined className="text-[9px] text-slate-500" />
                                    </button>
                                  </Popover>

                                  {/* Nhóm 5: Hashtag Popover */}
                                  <Popover
                                    trigger="click"
                                    placement="bottom"
                                    content={
                                      <div className="grid grid-cols-2 gap-1 p-1 w-56">
                                        {['#Trending', '#Review', '#Hot', '#ChiaSe', '#GocNhin', '#Sale', '#MeoHay', '#KhuyenMai'].map((tag) => (
                                          <button
                                            key={tag}
                                            type="button"
                                            onClick={() => {
                                              const cur = item.manualContent || '';
                                              const spacer = cur && !cur.endsWith(' ') && !cur.endsWith('\n') ? ' ' : '';
                                              updateLinkManualContent(item.id, cur + spacer + tag + ' ');
                                            }}
                                            className="px-2 py-1 text-xs font-bold bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white rounded text-center cursor-pointer transition-colors"
                                          >
                                            {tag}
                                          </button>
                                        ))}
                                      </div>
                                    }
                                  >
                                    <button
                                      type="button"
                                      className="px-2 py-0.5 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 text-blue-300 border border-slate-700/80 rounded-md flex items-center gap-1 cursor-pointer"
                                    >
                                      <TagOutlined className="text-blue-400 text-xs" />
                                      <span>Thẻ Hot</span>
                                      <DownOutlined className="text-[9px] text-slate-500" />
                                    </button>
                                  </Popover>

                                  {/* Nhóm 6: Emojis Popover */}
                                  <Popover
                                    trigger="click"
                                    placement="bottomRight"
                                    content={
                                      <div className="grid grid-cols-5 gap-1 p-1.5 w-48">
                                        {['🔥', '📌', '💥', '⭐', '🚀', '❤️', '👇', '🎯', '✨', '🛒', '🏷️', '📢', '✅', '🎁', '💡', '🐾', '🐶', '🐱', '💯', '💬'].map((emoji) => (
                                          <button
                                            key={emoji}
                                            type="button"
                                            onClick={() => insertSnippetAtCursor(item.id, emoji)}
                                            className="h-7 w-7 text-base bg-slate-800 hover:bg-slate-700 rounded text-slate-100 border border-slate-700/60 hover:scale-125 transition-all flex items-center justify-center cursor-pointer"
                                            title={`Chèn icon ${emoji}`}
                                          >
                                            {emoji}
                                          </button>
                                        ))}
                                      </div>
                                    }
                                  >
                                    <button
                                      type="button"
                                      className="px-2 py-0.5 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 text-amber-300 border border-slate-700/80 rounded-md flex items-center gap-1 cursor-pointer"
                                    >
                                      <SmileOutlined className="text-amber-400 text-xs" />
                                      <span>Icon</span>
                                      <DownOutlined className="text-[9px] text-slate-500" />
                                    </button>
                                  </Popover>
                                </div>

                                <TextArea
                                  id={`manual-content-textarea-${item.id}`}
                                  rows={6}
                                  placeholder="Nhập nội dung bài viết muốn đăng lên Facebook (hỗ trợ văn bản thuần, H1, H2, in đậm, in nghiêng, gạch ngang, icon, hashtag, xuống dòng nhiều đoạn)..."
                                  value={item.manualContent || ''}
                                  onChange={(e) => updateLinkManualContent(item.id, e.target.value)}
                                  onPaste={(e) => handlePasteMediaFromClipboard(item.id, e)}
                                  className="text-sm p-3.5 bg-slate-950/90 border-slate-700 text-slate-100 rounded-xl font-normal focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder:text-slate-500 leading-relaxed shadow-inner"
                                  autoSize={{ minRows: 6, maxRows: 14 }}
                                />

                                <div className="mt-2 px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
                                  <div className="flex items-center gap-2 text-slate-400">
                                    <span className="w-5 h-5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
                                      <PictureOutlined className="text-xs" />
                                    </span>
                                    <span>
                                      Bấm <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-mono text-[11px]">Ctrl+V</kbd> (Cmd+V) vào ô để tự động đính kèm ảnh chụp màn hình
                                    </span>
                                  </div>
                                  <Button
                                    size="small"
                                    type="default"
                                    icon={<CopyOutlined className="text-blue-400" />}
                                    onClick={() => handlePasteFromClipboardButton(item.id)}
                                    className="text-xs font-semibold bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200"
                                  >
                                    Dán ảnh từ Clipboard
                                  </Button>
                                </div>

                                {item.colorBackground && (
                                  <div className="mt-2.5 p-3 rounded-xl bg-red-950/40 border border-red-800/60 space-y-2.5">
                                    <div className="flex items-center justify-between flex-wrap gap-2">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-xs font-bold text-red-300">
                                          {item.colorBackground === 'RED_PHOTO_TRICK' ? '🔴 Đang chọn: Nền Đỏ + Kèm Ảnh (Mẹo 3 chấm)' : '🔴 Đang chọn: Status Nền Đỏ (Thuần chữ)'}
                                        </span>
                                        <div className="inline-flex rounded-lg bg-black/40 p-0.5 border border-red-800/50 text-[11px]">
                                          <button
                                            type="button"
                                            onClick={() => toggleColorBackground(item.id, true)}
                                            className={`px-2 py-0.5 rounded-md font-semibold transition-all ${item.colorBackground === true
                                              ? 'bg-red-600 text-white shadow-sm'
                                              : 'text-red-300 hover:text-white'
                                              }`}
                                          >
                                            Thuần chữ
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => toggleColorBackground(item.id, 'RED_PHOTO_TRICK')}
                                            className={`px-2 py-0.5 rounded-md font-semibold transition-all ${item.colorBackground === 'RED_PHOTO_TRICK'
                                              ? 'bg-red-600 text-white shadow-sm'
                                              : 'text-red-300 hover:text-white'
                                              }`}
                                          >
                                            Kèm ảnh (Mẹo 3 chấm)
                                          </button>
                                        </div>
                                        <Tag
                                          color={(item.manualContent || "").length <= 130 ? "success" : "error"}
                                          className="!m-0 text-[11px] font-mono font-bold px-2 py-0.5"
                                        >
                                          {(item.manualContent || "").length} / 130 ký tự
                                        </Tag>
                                      </div>
                                      {(item.manualContent || "").length > 130 && (
                                        <Button
                                          size="small"
                                          danger
                                          type="primary"
                                          className="text-xs rounded-lg font-bold h-7 px-3 shadow-md"
                                          onClick={() => {
                                            const cur = (item.manualContent || "").trim();
                                            const firstLine = cur.split(/\r?\n/)[0] || cur;
                                            const trimmed = firstLine.length <= 112 ? firstLine + "... (Xem cmt 👇)" : firstLine.slice(0, 110).trim() + "... (Xem cmt 👇)";
                                            updateLinkManualContent(item.id, trimmed);
                                            if (!item.affiliateLink) {
                                              updateLinkAffiliate(item.id, cur);
                                            }
                                          }}
                                        >
                                          ⚡ Rút gọn nhanh &lt; 130 ký tự
                                        </Button>
                                      )}
                                    </div>

                                    {item.colorBackground === 'RED_PHOTO_TRICK' && (
                                      <div className="text-[11px] text-amber-200/90 bg-amber-950/40 p-2 rounded-lg border border-amber-800/40 flex items-center gap-1.5">
                                        <span>💡</span>
                                        <span><b>Mẹo Facebook 3 chấm:</b> Bot sẽ đăng kèm ảnh trước, sau đó tự động vào <b>3 chấm &rarr; Sửa bài &rarr; Gỡ ảnh &rarr; Đổi phông nền Đỏ &rarr; Lưu</b> và bình luận bài viết chi tiết bên dưới.</span>
                                      </div>
                                    )}

                                    {(item.manualContent || "").length > 130 && (
                                      <Alert
                                        type="error"
                                        showIcon
                                        className="!p-2.5 text-xs rounded-lg border-red-700/60 bg-red-900/30 text-red-200"
                                        message={
                                          <div>
                                            <b>⚠️ Vượt quá 130 ký tự!</b> Facebook sẽ <b>tự động hủy phông nền đỏ</b> và biến thành bài chữ đen nhỏ nền trắng. Vui lòng bấm <b>"⚡ Rút gọn nhanh &lt; 130 ký tự"</b> hoặc tự sửa tít cho ngắn lại. Toàn bộ nội dung bài viết đã được giữ trong bình luận.
                                          </div>
                                        }
                                      />
                                    )}
                                  </div>
                                )}

                                {item.colorBackground && (
                                  <div className="mt-2.5">
                                    <ColorPostPreview
                                      text={item.manualContent || ''}
                                      comment={item.skipComment ? null : (item.affiliateLink?.trim() || defaultCommentPreview)}
                                      authorName={previewAuthorName}
                                      hasMedia={!!item.manualMediaUrls?.length}
                                      mode={item.colorBackground}
                                    />
                                  </div>
                                )}
                              </div>

                              {/* PHẦN 2: DRAG & DROP MEDIA ZONE & THƯ VIỆN ẢNH/VIDEO */}
                              <div className="bg-slate-900/90 border border-slate-700/80 rounded-2xl p-4 sm:p-5 space-y-4 shadow-md">
                                <div className="flex items-center justify-between flex-wrap gap-2 pb-1 border-b border-slate-800">
                                  <div>
                                    <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                                      <PictureOutlined className="text-emerald-400 text-base" />
                                      <span>Đính kèm Hình ảnh & Video</span>
                                      <Tag color="default" className="!text-[11px] !m-0 !font-normal border-slate-700 text-slate-400 bg-slate-800">
                                        Tùy chọn
                                      </Tag>
                                    </div>
                                    <div className="text-xs text-slate-400 mt-0.5">
                                      Kéo thả tệp từ máy tính, dán ảnh từ Clipboard (Ctrl+V) hoặc dán link media trực tiếp.
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      size="small"
                                      type="default"
                                      icon={<CopyOutlined className="text-blue-400" />}
                                      onClick={() => handlePasteFromClipboardButton(item.id)}
                                      className="text-xs h-7 px-2.5 font-medium bg-slate-800 border-slate-700 text-slate-200 hover:text-blue-400 hover:border-blue-500/50"
                                    >
                                      Dán ảnh (Ctrl+V)
                                    </Button>
                                    {(item.manualMediaUrls && item.manualMediaUrls.length > 0) && (
                                      <Button
                                        size="small"
                                        type="text"
                                        danger
                                        icon={<ClearOutlined />}
                                        onClick={() => {
                                          setLinkItems(prev => prev.map(it => it.id === item.id ? { ...it, manualMediaUrls: [], manualMediaKinds: [] } : it));
                                          message.info('Đã xóa toàn bộ media đính kèm');
                                        }}
                                        className="text-xs h-7 px-2 font-bold"
                                      >
                                        Xóa tất cả ({item.manualMediaUrls.length})
                                      </Button>
                                    )}
                                  </div>
                                </div>

                                {/* DROPZONE KÉO THẢ TỆP HIỆN ĐẠI */}
                                <div
                                  tabIndex={0}
                                  onPaste={(e) => handlePasteMediaFromClipboard(item.id, e)}
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    setDragOverDropzone(item.id);
                                  }}
                                  onDragLeave={() => setDragOverDropzone(null)}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    setDragOverDropzone(null);
                                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                                      handleUploadMedia(item.id, e.dataTransfer.files);
                                    }
                                  }}
                                  onClick={(e) => {
                                    const target = e.target as HTMLElement;
                                    if (!target.closest('button') && !target.closest('.ant-tag')) {
                                      document.getElementById(`manual-file-input-${item.id}`)?.click();
                                    }
                                  }}
                                  className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-2.5 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 ${dragOverDropzone === item.id
                                    ? 'border-blue-400 bg-blue-500/10 ring-4 ring-blue-500/20 scale-[1.01]'
                                    : 'border-slate-700 hover:border-emerald-500/80 bg-slate-950/60 hover:bg-slate-950/90'
                                    }`}
                                >
                                  <input
                                    type="file"
                                    id={`manual-file-input-${item.id}`}
                                    multiple
                                    accept="image/*,video/mp4,video/quicktime,video/webm"
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                      if (e.target.files) {
                                        handleUploadMedia(item.id, e.target.files);
                                        e.target.value = '';
                                      }
                                    }}
                                  />
                                  <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-2xl shadow-inner">
                                    <CloudUploadOutlined />
                                  </div>
                                  <div>
                                    <div className="text-sm font-bold text-slate-200">
                                      Kéo & thả, <span className="text-cyan-400 underline decoration-cyan-400/50 underline-offset-2">Dán (Ctrl+V / Cmd+V)</span> ảnh / video vào đây hoặc <span className="text-emerald-400 underline decoration-emerald-400/50 underline-offset-2">Duyệt từ máy tính</span>
                                    </div>
                                    <div className="text-xs text-slate-400 mt-1.5 flex items-center justify-center gap-2 flex-wrap">
                                      <Tag
                                        color="blue"
                                        className="!m-0 !text-[11px] cursor-pointer hover:opacity-85 font-medium flex items-center gap-1"
                                        onClick={(e) => { e.stopPropagation(); handlePasteFromClipboardButton(item.id); }}
                                      >
                                        <CopyOutlined /> Dán nhanh Ctrl+V / Cmd+V
                                      </Tag>
                                      <Tag color="blue" className="!m-0 !text-[10px]">JPG, PNG, WEBP</Tag>
                                      <Tag color="purple" className="!m-0 !text-[10px]">MP4, MOV, WEBM</Tag>
                                      <span>· Chọn hoặc dán nhiều tệp cùng lúc</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Ô NHẬP LINK MEDIA TRỰC TIẾP */}
                                <div className="flex items-center gap-2 bg-slate-950/80 p-2 rounded-xl border border-slate-800">
                                  <Input
                                    size="middle"
                                    prefix={<LinkOutlined className="text-slate-400 mr-1" />}
                                    placeholder="Hoặc dán URL ảnh / video trực tiếp (https://...jpg, .mp4) rồi bấm Thêm link"
                                    value={manualMediaUrlInputs[item.id] || ''}
                                    onChange={(e) => setManualMediaUrlInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                                    onPressEnter={() => {
                                      if (manualMediaUrlInputs[item.id]?.trim()) {
                                        handleAddManualMediaUrl(item.id, manualMediaUrlInputs[item.id]);
                                        setManualMediaUrlInputs(prev => ({ ...prev, [item.id]: '' }));
                                      }
                                    }}
                                    className="text-xs bg-slate-900 border-slate-700 text-slate-200 rounded-lg h-9"
                                  />
                                  <Button
                                    size="middle"
                                    type="primary"
                                    icon={<PlusCircleOutlined />}
                                    onClick={() => {
                                      if (manualMediaUrlInputs[item.id]?.trim()) {
                                        handleAddManualMediaUrl(item.id, manualMediaUrlInputs[item.id]);
                                        setManualMediaUrlInputs(prev => ({ ...prev, [item.id]: '' }));
                                      }
                                    }}
                                    className="rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 h-9 px-4 shrink-0 shadow-sm"
                                  >
                                    Thêm link
                                  </Button>
                                </div>

                                {/* DANH SÁCH MEDIA ĐÃ ĐÍNH KÈM */}
                                {(item.manualMediaUrls && item.manualMediaUrls.length > 0) ? (
                                  <div className="space-y-3 pt-2">
                                    <div className="text-xs font-bold text-slate-300 flex items-center justify-between">
                                      <span className="flex items-center gap-2">
                                        Thư viện media đã chọn ({item.manualMediaUrls.length} tệp):
                                        <Button size="small" onClick={() => openNewsCardForItem(item, 'MANUAL')}>Tạo ảnh tin</Button>
                                      </span>
                                      <span className="text-[11px] text-amber-400 font-semibold bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/60">
                                        👑 Vị trí đầu tiên (#1) sẽ là Ảnh/Video Bìa chính
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                      {item.manualMediaUrls.map((mUrl, mIdx) => {
                                        const isVid = (item.manualMediaKinds?.[mIdx] === 'video') || isMediaVideo(mUrl);
                                        const isCover = mIdx === 0;

                                        return (
                                          <div
                                            key={`manual-m-${mIdx}-${mUrl.slice(-15)}`}
                                            className={`relative rounded-xl overflow-hidden border bg-slate-900 flex flex-col p-2 shadow-lg transition-all ${isCover ? 'border-amber-500/90 ring-2 ring-amber-500/40 shadow-amber-500/10' : 'border-slate-700 hover:border-slate-500'
                                              }`}
                                          >
                                            <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-slate-950 flex items-center justify-center">
                                              {isVid ? (
                                                <video src={mUrl} className="w-full h-full object-cover" muted preload="metadata" />
                                              ) : (
                                                <Image src={mUrl} alt={`media-${mIdx}`} className="w-full h-full object-cover" />
                                              )}

                                              <div className="absolute top-1.5 left-1.5 z-10">
                                                {isCover ? (
                                                  <Tag color="gold" className="!text-[10px] !font-bold !m-0 !px-1.5 !py-0.5 shadow-md border-0">
                                                    👑 Bìa #1
                                                  </Tag>
                                                ) : (
                                                  <Tag color={isVid ? 'purple' : 'blue'} className="!text-[10px] !font-bold !m-0 !px-1.5 !py-0.5 shadow-md border-0">
                                                    {isVid ? '🎥' : '🖼️'} #{mIdx + 1}
                                                  </Tag>
                                                )}
                                              </div>
                                            </div>

                                            <div className="flex items-center justify-between gap-1 pt-2">
                                              <div className="flex items-center gap-1">
                                                <Tooltip title="Chuyển lên trước">
                                                  <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<ArrowLeftOutlined className="text-xs" />}
                                                    disabled={mIdx === 0}
                                                    onClick={() => moveManualMediaItem(item.id, mIdx, mIdx - 1)}
                                                    className="h-7 w-7 !p-0 text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg disabled:opacity-30 disabled:bg-transparent"
                                                  />
                                                </Tooltip>
                                                <Tooltip title="Chuyển xuống sau">
                                                  <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<ArrowRightOutlined className="text-xs" />}
                                                    disabled={mIdx === item.manualMediaUrls!.length - 1}
                                                    onClick={() => moveManualMediaItem(item.id, mIdx, mIdx + 1)}
                                                    className="h-7 w-7 !p-0 text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg disabled:opacity-30 disabled:bg-transparent"
                                                  />
                                                </Tooltip>
                                                {!isCover && (
                                                  <Tooltip title="Đặt làm Ảnh / Video bìa chính (vị trí #1)">
                                                    <Button
                                                      size="small"
                                                      type="text"
                                                      icon={<StarOutlined className="text-amber-400 text-xs" />}
                                                      onClick={() => moveManualMediaItem(item.id, mIdx, 0)}
                                                      className="h-7 w-7 !p-0 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 rounded-lg border border-amber-500/30"
                                                    />
                                                  </Tooltip>
                                                )}
                                              </div>

                                              <Tooltip title="Xóa tệp này">
                                                <Button
                                                  size="small"
                                                  type="text"
                                                  danger
                                                  icon={<DeleteOutlined className="text-xs" />}
                                                  onClick={() => removeManualMediaItem(item.id, mIdx)}
                                                  className="h-7 w-7 !p-0 bg-red-500/10 hover:bg-red-500/20 rounded-lg"
                                                />
                                              </Tooltip>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-center py-3 px-3 bg-slate-950/60 rounded-xl border border-slate-800 text-xs text-slate-400 flex items-center justify-center gap-2">
                                    <span>📝 Chưa đính kèm media — Hệ thống sẽ tự động xuất bản dưới dạng</span>
                                    <span className="text-cyan-400 font-bold bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/60">
                                      Trạng thái chữ (Pure Text)
                                    </span>
                                    <span>lên Facebook.</span>
                                  </div>
                                )}
                              </div>

                              {/* PHẦN 3: THỜI GIAN HẸN GIỜ & TÙY CHỌN */}
                              {!item.isNow && (
                                <div className="p-3.5 bg-slate-900/90 border border-slate-700/80 rounded-2xl shadow-md">
                                  <EasyTimePicker
                                    compact
                                    value={item.scheduledAt}
                                    onChange={(val) => updateLinkTime(item.id, val)}
                                  />
                                </div>
                              )}

                              <div className="poster-post-options !p-2.5 sm:!p-3 bg-slate-950/60 rounded-2xl border border-slate-700/60 flex items-center gap-2 flex-wrap shadow-inner backdrop-blur-sm">
                                <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5 mr-1 select-none">
                                  <SettingOutlined className="text-slate-400 text-xs" /> Tùy chọn:
                                </span>

                                <Tooltip title="Đăng status phông nền màu đỏ giật tít trên Facebook (Tối đa 130 ký tự, toàn bộ nội dung bài viết & hashtag sẽ tự động thả ở bình luận đầu tiên)">
                                  <button
                                    type="button"
                                    onClick={() => toggleColorBackground(item.id)}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none ${item.colorBackground
                                        ? 'poster-opt-chip is-active'
                                        : 'poster-opt-chip'
                                      }`}
                                  >
                                    <span className="poster-opt-dot" /><span>Status nền đỏ</span>
                                    <span className="text-[10px] opacity-75">(&lt; 130 ký tự)</span>
                                    {item.colorBackground && <CheckOutlined className="text-xs text-rose-400" />}
                                  </button>
                                </Tooltip>

                                <Tooltip title={item.skipComment ? 'Bình luận đang bị tắt cho bài này' : (hasCustomComment ? 'Đã có bình luận riêng cho bài này' : 'Thêm bình luận / link Shopee riêng cho bài này')}>
                                  <button
                                    type="button"
                                    onClick={() => toggleCommentBox(item.id)}
                                    disabled={item.skipComment}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none disabled:opacity-40 disabled:cursor-not-allowed ${hasCustomComment || isCommentOpen
                                        ? 'poster-opt-chip is-active'
                                        : 'poster-opt-chip'
                                      }`}
                                  >
                                    <MessageOutlined className="text-xs text-cyan-400" />
                                    <span>{hasCustomComment ? 'Có bình luận riêng' : 'Thêm bình luận riêng'}</span>
                                    {(hasCustomComment || isCommentOpen) && <CheckOutlined className="text-xs text-cyan-400" />}
                                  </button>
                                </Tooltip>

                                <Tooltip title="Không đăng bất kỳ bình luận nào (kể cả cmt mặc định) cho riêng bài này">
                                  <button
                                    type="button"
                                    onClick={() => toggleSkipComment(item.id)}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none ${item.skipComment
                                        ? 'poster-opt-chip is-active'
                                        : 'poster-opt-chip'
                                      }`}
                                  >
                                    <StopOutlined className="text-xs text-amber-400" />
                                    <span>Không bình luận</span>
                                    {item.skipComment && <CheckOutlined className="text-xs text-amber-400" />}
                                  </button>
                                </Tooltip>

                                {postMode !== 'FANPAGE_ONLY' && (
                                  <Tooltip title="Mặc định KHÔNG bình luận vào bài đăng trong Nhóm — bật tùy chọn này mới tự động bình luận link Affiliate cho bài này trong Nhóm.">
                                    <button
                                      type="button"
                                      onClick={() => toggleGroupComment(item.id)}
                                      disabled={item.skipComment}
                                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none disabled:opacity-40 disabled:cursor-not-allowed ${item.groupCommentEnabled
                                          ? 'poster-opt-chip is-active'
                                          : 'poster-opt-chip'
                                        }`}
                                    >
                                      <TeamOutlined className="text-xs text-emerald-400" />
                                      <span>Bình luận trong Nhóm</span>
                                      {item.groupCommentEnabled && <CheckOutlined className="text-xs text-emerald-400" />}
                                    </button>
                                  </Tooltip>
                                )}
                              </div>

                              {/* Khung soạn bình luận riêng */}
                              {isCommentOpen && (
                                <div className="p-4 bg-slate-900/90 border border-slate-700/80 rounded-2xl space-y-2.5 shadow-md">
                                  <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                                      <MessageOutlined className="text-blue-400" />
                                      <span>Bình luận riêng cho Bài #{index + 1}:</span>
                                      {hasCustomComment && (
                                        <Tag color="cyan" className="!text-[10px] !m-0 !py-0.5 !font-bold">
                                          Đang dùng cmt riêng
                                        </Tag>
                                      )}
                                    </span>
                                    {!hasCustomComment && (
                                      <Button
                                        size="small"
                                        type="link"
                                        className="!p-0 text-xs text-slate-400 hover:text-slate-200"
                                        onClick={() => toggleCommentBox(item.id)}
                                      >
                                        Đóng ô
                                      </Button>
                                    )}
                                  </div>
                                  <TextArea
                                    placeholder="Nhập nội dung bình luận / link Shopee riêng cho bài này (hỗ trợ xuống dòng, emoji, link)... Nếu để trống sẽ tự động dùng bình luận chung bên dưới."
                                    autoSize={{ minRows: 3, maxRows: 6 }}
                                    value={item.affiliateLink || ''}
                                    onChange={(e) => updateLinkAffiliate(item.id, e.target.value)}
                                    className="text-xs bg-slate-950 border-slate-700 text-slate-100 rounded-xl leading-relaxed"
                                  />
                                </div>
                              )}
                            </div>

                            {/* CỘT PHẢI (lg:col-span-5): MÔ PHỎNG BÀI ĐĂNG FACEBOOK THỰC TẾ (LIVE SIMULATOR) */}
                            <div className="lg:col-span-5 sticky top-4 space-y-2">
                              <div className="flex items-center justify-between px-1">
                                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5 uppercase tracking-wider">
                                  <FacebookFilled className="text-blue-500 text-sm" /> Mô phỏng Feed Facebook
                                </span>
                                <Tag color="blue" className="!text-[10px] !m-0 !font-bold !px-2 !py-0.5">
                                  Live Mockup
                                </Tag>
                              </div>

                              {/* FACEBOOK POST MOCKUP CARD */}
                              <div className="bg-[#242526] text-[#e4e6eb] rounded-2xl border border-slate-700/80 overflow-hidden shadow-2xl font-sans">
                                {/* Header Facebook Post */}
                                <div className="p-3.5 flex items-center justify-between gap-3 border-b border-[#3a3b3c]/50">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-bold text-base shrink-0 shadow-md">
                                      {playwrightAccounts?.[0]?.pageName?.charAt(0)?.toUpperCase() || 'F'}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="text-sm font-bold text-white truncate hover:underline cursor-pointer">
                                        {playwrightAccounts?.[0]?.pageName || 'Trang Fanpage / Nhóm của bạn'}
                                      </div>
                                      <div className="text-[11px] text-[#b0b3b8] flex items-center gap-1">
                                        <span>Vừa xong</span>
                                        <span>·</span>
                                        <GlobalOutlined className="text-[10px]" />
                                      </div>
                                    </div>
                                  </div>
                                  <div className="text-slate-400 hover:text-white p-1 rounded-full cursor-pointer">
                                    <EllipsisOutlined className="text-lg" />
                                  </div>
                                </div>

                                {/* Caption */}
                                <div className="p-3.5 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words text-[#e4e6eb]">
                                  {item.manualContent?.trim() ? (
                                    item.manualContent
                                  ) : (
                                    <span className="text-slate-500 italic">
                                      (Nội dung bài viết sẽ hiển thị tại đây khi bạn nhập...)
                                    </span>
                                  )}
                                </div>

                                {/* Media Collage Mockup */}
                                {item.manualMediaUrls && item.manualMediaUrls.length > 0 && (
                                  <div className="bg-black relative overflow-hidden border-t border-b border-[#3a3b3c]">
                                    {(() => {
                                      const urls = item.manualMediaUrls || [];
                                      const isVid = (u: string, idx: number) => (item.manualMediaKinds?.[idx] === 'video') || isMediaVideo(u);

                                      if (urls.length === 1) {
                                        return isVid(urls[0], 0) ? (
                                          <video src={urls[0]} controls playsInline className="w-full max-h-[360px] object-contain mx-auto" />
                                        ) : (
                                          <img src={urls[0]} alt="fb-1" className="w-full max-h-[360px] object-cover" />
                                        );
                                      }

                                      if (urls.length === 2) {
                                        return (
                                          <div className="grid grid-cols-2 gap-1 max-h-[300px] overflow-hidden">
                                            {urls.map((u, idx) => (
                                              <div key={idx} className="relative aspect-square overflow-hidden bg-slate-900">
                                                {isVid(u, idx) ? (
                                                  <video src={u} className="w-full h-full object-cover" muted />
                                                ) : (
                                                  <img src={u} alt={`fb-${idx}`} className="w-full h-full object-cover" />
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        );
                                      }

                                      if (urls.length === 3) {
                                        return (
                                          <div className="grid grid-cols-3 gap-1 max-h-[260px] overflow-hidden">
                                            {urls.map((u, idx) => (
                                              <div key={idx} className="relative aspect-square overflow-hidden bg-slate-900">
                                                {isVid(u, idx) ? (
                                                  <video src={u} className="w-full h-full object-cover" muted />
                                                ) : (
                                                  <img src={u} alt={`fb-${idx}`} className="w-full h-full object-cover" />
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        );
                                      }

                                      // 4+ media items (Facebook Grid Collage)
                                      const displayUrls = urls.slice(0, 4);
                                      const remaining = urls.length - 4;

                                      return (
                                        <div className="grid grid-cols-2 gap-1 max-h-[320px] overflow-hidden">
                                          {displayUrls.map((u, idx) => {
                                            const isLast = idx === 3 && remaining > 0;
                                            return (
                                              <div key={idx} className="relative aspect-square overflow-hidden bg-slate-900">
                                                {isVid(u, idx) ? (
                                                  <video src={u} className="w-full h-full object-cover" muted />
                                                ) : (
                                                  <img src={u} alt={`fb-${idx}`} className="w-full h-full object-cover" />
                                                )}
                                                {isLast && (
                                                  <div className="absolute inset-0 bg-black/65 flex items-center justify-center text-white text-2xl font-bold backdrop-blur-xs">
                                                    +{remaining}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                )}

                                {/* Interaction Counts */}
                                <div className="px-3.5 py-2 flex items-center justify-between text-xs text-[#b0b3b8] border-b border-[#3a3b3c]/60">
                                  <div className="flex items-center gap-1.5">
                                    <span className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center text-[9px] text-white">👍</span>
                                    <span className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center text-[9px] text-white">❤️</span>
                                    <span>1.2K</span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span>48 bình luận</span>
                                    <span>12 lượt chia sẻ</span>
                                  </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="px-2 py-1 flex items-center justify-around text-xs font-semibold text-[#b0b3b8]">
                                  <button type="button" className="flex-1 py-2 flex items-center justify-center gap-1.5 hover:bg-[#3a3b3c]/60 rounded-lg transition-colors text-slate-300">
                                    <LikeOutlined className="text-sm" /> Thích
                                  </button>
                                  <button type="button" className="flex-1 py-2 flex items-center justify-center gap-1.5 hover:bg-[#3a3b3c]/60 rounded-lg transition-colors text-slate-300">
                                    <CommentOutlined className="text-sm" /> Bình luận
                                  </button>
                                  <button type="button" className="flex-1 py-2 flex items-center justify-center gap-1.5 hover:bg-[#3a3b3c]/60 rounded-lg transition-colors text-slate-300">
                                    <ShareAltOutlined className="text-sm" /> Chia sẻ
                                  </button>
                                </div>

                                {/* Simulated First Comment if affiliate/custom comment exists */}
                                {item.affiliateLink?.trim() && !item.skipComment && (
                                  <div className="p-3 bg-[#18191a] border-t border-[#3a3b3c]/80 flex items-start gap-2.5">
                                    <div className="w-7 h-7 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                                      {playwrightAccounts?.[0]?.pageName?.charAt(0)?.toUpperCase() || 'F'}
                                    </div>
                                    <div className="flex-1 bg-[#242526] p-2.5 rounded-2xl text-xs text-[#e4e6eb] space-y-1">
                                      <div className="font-bold text-white text-[11px] flex items-center gap-1.5">
                                        <span>{playwrightAccounts?.[0]?.pageName || 'Trang của bạn'}</span>
                                        <Tag color="blue" className="!text-[9px] !m-0 !px-1 !py-0">Tác giả</Tag>
                                      </div>
                                      <div className="whitespace-pre-wrap break-words">{item.affiliateLink}</div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* ================= GIAO DIỆN DÁN LINK CÀO TỰ ĐỘNG ================= */
                          <>
                            <label htmlFor={`post-link-${item.id}`} className="poster-field-label">Liên kết bài viết</label>
                            <PasteLinkInput
                              inputId={`post-link-${item.id}`}
                              placeholder="Dán link Facebook, Threads, TikTok (No-Watermark), Reel hoặc video vào đây..."
                              value={item.url}
                              onChange={(val) => updateLinkUrl(item.id, val)}
                              size="middle"
                            />

                            {previews[item.id]?.loading && (
                              <div className="rounded-xl border border-blue-500/30 bg-slate-900/80 p-3.5 flex items-center gap-3 backdrop-blur-md">
                                <LoadingOutlined className="text-blue-400 text-lg" spin />
                                <span className="text-xs text-blue-300 font-semibold">Đang cào dữ liệu và tải trước video / ảnh / caption...</span>
                              </div>
                            )}

                            {item.url.trim() && previews[item.id] && !previews[item.id].loading && (
                              <div className="poster-preview-workspace rounded-xl border border-blue-500/30 bg-slate-900/80 p-3.5 space-y-3.5 backdrop-blur-md shadow-lg">
                                {previews[item.id].error ? (
                                  <Text type="danger" className="text-xs font-semibold">⚠️ {previews[item.id].error}</Text>
                                ) : (
                                  <div className="poster-preview-grid grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                                    {/* CỘT TRÁI (lg:col-span-5): KHUNG XEM VÀ TÙY CHỈNH MEDIA (ẢNH & VIDEO) */}
                                    <div className="poster-media-panel lg:col-span-4 space-y-2.5">
                                      {/* Header thống kê media */}
                                      <div className="flex items-center justify-between gap-2 flex-wrap pb-1.5 border-b border-slate-700/60">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          {(previews[item.id].videoCount || 0) > 0 && (
                                            <Tag color="purple" className="!m-0 !font-bold !px-2 !py-0.5">
                                              🎥 {previews[item.id].videoCount} Video
                                            </Tag>
                                          )}
                                          {(previews[item.id].imageCount || 0) > 0 && (
                                            <Tag color="blue" className="!m-0 !font-bold !px-2 !py-0.5">
                                              🖼️ {previews[item.id].imageCount} Ảnh
                                            </Tag>
                                          )}
                                          {(item.url.includes('tiktok.com') || previews[item.id].watermarkRemoved) && (
                                            <Tag color="green" className="!m-0 !font-bold !px-2 !py-0.5 !text-emerald-300 !bg-emerald-950/80 !border-emerald-500/50">
                                              ✨ Sạch Logo TikTok
                                            </Tag>
                                          )}
                                          <span className="text-[11px] text-slate-300 font-medium">Sẵn sàng xuất bản</span>
                                        </div>
                                        {(previews[item.id].imageCount || 0) > 0 && (
                                          <Button size="small" onClick={() => openNewsCardForItem(item, 'LINK')} title="Ghép ảnh + tiêu đề in hoa tô đỏ kiểu page tin tức, thay cho ảnh đăng">
                                            Tạo ảnh tin
                                          </Button>
                                        )}
                                      </div>

                                      {/* Xem và Tùy biến Thứ tự / Xóa bớt Video & Album Ảnh */}
                                      {(previews[item.id].mediaUrls?.length || 0) > 0 && (
                                        <div className="space-y-2.5">
                                          {(() => {
                                            const mediaUrls = previews[item.id].mediaUrls || [];
                                            const originalUrls = previews[item.id].originalMediaUrls || [];
                                            const hasCustomizedMedia =
                                              mediaUrls.length !== originalUrls.length ||
                                              mediaUrls.some((u, i) => u !== originalUrls[i]);

                                            const isVideo = (u: string, idx: number) => isMediaVideo(u, previews[item.id].mediaKinds?.[idx]);
                                            const photoUrls = mediaUrls.filter((u, i) => !isVideo(u, i));
                                            const videoUrls = mediaUrls.filter((u, i) => isVideo(u, i));

                                            return (
                                              <>
                                                {/* Danh sách Video */}
                                                {videoUrls.length > 0 && (
                                                  <div className="bg-slate-950/70 rounded-xl p-2.5 border border-slate-800 space-y-2">
                                                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold">
                                                      <span>Video đính kèm ({videoUrls.length}):</span>
                                                      {hasCustomizedMedia && (
                                                        <span className="text-amber-400 text-[10px]">Đã chỉnh sửa</span>
                                                      )}
                                                    </div>
                                                    <div className="space-y-2">
                                                      {mediaUrls.map((mUrl, mIdx) => {
                                                        if (!isVideo(mUrl, mIdx)) return null;
                                                        return (
                                                          <div key={`v-${mIdx}-${mUrl.slice(-15)}`} className="relative rounded-lg overflow-hidden border border-slate-700 bg-black flex flex-col group">
                                                            <div className="relative aspect-video w-full bg-slate-950 flex items-center justify-center">
                                                              <video
                                                                src={mUrl}
                                                                controls
                                                                playsInline
                                                                preload="metadata"
                                                                className="w-full h-full object-contain max-h-[160px]"
                                                              />
                                                              <button
                                                                type="button"
                                                                className="poster-media-expand"
                                                                onClick={() => setMediaViewer({ url: mUrl, kind: 'video', title: `Video #${mIdx + 1}` })}
                                                                aria-label={`Phóng to video ${mIdx + 1}`}
                                                                title="Xem video toàn màn hình"
                                                              >
                                                                <EyeOutlined /> Phóng to
                                                              </button>
                                                              <div className="absolute top-1.5 left-1.5">
                                                                <Tag color="purple" className="!text-[10px] !font-bold !m-0 !px-1.5 shadow-md">
                                                                  🎥 Video #{mIdx + 1}
                                                                </Tag>
                                                              </div>
                                                            </div>
                                                            <div className="p-1.5 bg-slate-900/90 flex items-center justify-between border-t border-slate-800">
                                                              <div className="flex items-center gap-1">
                                                                <Tooltip title="Chuyển lên trước">
                                                                  <Button
                                                                    size="small"
                                                                    type="text"
                                                                    icon={<ArrowLeftOutlined className="text-[10px]" />}
                                                                    disabled={mIdx === 0}
                                                                    onClick={() => moveMediaItem(item.id, mIdx, mIdx - 1)}
                                                                    className="h-6 w-6 !p-0 text-slate-400 hover:text-slate-100 disabled:opacity-30"
                                                                  />
                                                                </Tooltip>
                                                                <Tooltip title="Chuyển xuống sau">
                                                                  <Button
                                                                    size="small"
                                                                    type="text"
                                                                    icon={<ArrowRightOutlined className="text-[10px]" />}
                                                                    disabled={mIdx === mediaUrls.length - 1}
                                                                    onClick={() => moveMediaItem(item.id, mIdx, mIdx + 1)}
                                                                    className="h-6 w-6 !p-0 text-slate-400 hover:text-slate-100 disabled:opacity-30"
                                                                  />
                                                                </Tooltip>
                                                              </div>
                                                              <Tooltip title="Xóa video này khỏi bài đăng">
                                                                <Button
                                                                  size="small"
                                                                  type="text"
                                                                  danger
                                                                  icon={<DeleteOutlined className="text-[10px]" />}
                                                                  onClick={() => removeMediaItem(item.id, mIdx)}
                                                                  className="h-6 w-6 !p-0"
                                                                />
                                                              </Tooltip>
                                                            </div>
                                                          </div>
                                                        );
                                                      })}
                                                    </div>
                                                  </div>
                                                )}

                                                {/* Danh sách Ảnh (Hỗ trợ Kéo thả trực tiếp, Đổi thứ tự, Đặt ảnh bìa, Xóa ảnh) */}
                                                {photoUrls.length > 0 && (
                                                  <div className="bg-slate-950/70 rounded-xl p-2.5 border border-slate-800">
                                                    <Image.PreviewGroup>
                                                      <div className="grid grid-cols-3 gap-2">
                                                        {mediaUrls.map((mUrl, mIdx) => {
                                                          if (isVideo(mUrl, mIdx)) return null;
                                                          const isCover = mIdx === 0;
                                                          const isDragging = draggedMedia?.itemId === item.id && draggedMedia.index === mIdx;
                                                          const isDragOver = dragOverMedia?.itemId === item.id && dragOverMedia.index === mIdx && !isDragging;

                                                          return (
                                                            <div
                                                              key={`p-${mIdx}-${mUrl.slice(-15)}`}
                                                              draggable={true}
                                                              onDragStart={(e) => handleMediaDragStart(e, item.id, mIdx)}
                                                              onDragOver={(e) => handleMediaDragOver(e, item.id, mIdx)}
                                                              onDragEnd={handleMediaDragEnd}
                                                              onDrop={(e) => handleMediaDrop(e, item.id, mIdx)}
                                                              className={`relative rounded-xl overflow-hidden border transition-all duration-200 bg-slate-900 group shadow-md flex flex-col cursor-grab active:cursor-grabbing select-none ${isDragging
                                                                ? 'opacity-40 scale-95 border-dashed border-blue-500 ring-2 ring-blue-500/40'
                                                                : isDragOver
                                                                  ? 'border-blue-400 ring-2 ring-blue-400 scale-105 shadow-xl'
                                                                  : isCover
                                                                    ? 'border-amber-500/80 ring-2 ring-amber-500/30'
                                                                    : 'border-slate-700/80 hover:border-slate-500'
                                                                }`}
                                                            >
                                                              {/* Khung Ảnh */}
                                                              <div className="relative aspect-square w-full overflow-hidden bg-slate-950 flex items-center justify-center">
                                                                <Image
                                                                  src={mUrl}
                                                                  alt={`photo-${mIdx + 1}`}
                                                                  preview={false}
                                                                  onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    setMediaViewer({ url: mUrl, kind: 'image', title: `Ảnh #${mIdx + 1}` });
                                                                  }}
                                                                  className="poster-zoomable-media w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                                                                />

                                                                {/* Badge thứ tự và biểu tượng Drag góc trên bên trái */}
                                                                <div className="absolute top-1 left-1 z-10 flex items-center gap-1 pointer-events-auto">
                                                                  <div className="w-4 h-4 rounded bg-black/60 text-slate-300 flex items-center justify-center text-[9px]" title="Kéo thả để đổi thứ tự">
                                                                    <HolderOutlined />
                                                                  </div>
                                                                  {isCover ? (
                                                                    <Tag color="gold" className="!text-[9.5px] !font-bold !m-0 !px-1 shadow-md border-0">
                                                                      👑 Bìa
                                                                    </Tag>
                                                                  ) : (
                                                                    <Tag color="blue" className="!text-[9.5px] !font-bold !m-0 !px-1 shadow-md border-0">
                                                                      #{mIdx + 1}
                                                                    </Tag>
                                                                  )}
                                                                </div>

                                                                {/* Nút xóa nhanh góc trên bên phải */}
                                                                <div className="absolute top-1 right-1 z-10 pointer-events-auto opacity-80 group-hover:opacity-100 transition-opacity">
                                                                  <Tooltip title="Xóa ảnh này khỏi bài đăng">
                                                                    <button
                                                                      type="button"
                                                                      onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        removeMediaItem(item.id, mIdx);
                                                                      }}
                                                                      className="w-5 h-5 rounded-full bg-black/75 hover:bg-red-600 text-white flex items-center justify-center text-[10px] transition-colors shadow"
                                                                    >
                                                                      <CloseOutlined />
                                                                    </button>
                                                                  </Tooltip>
                                                                </div>
                                                              </div>

                                                              {/* Hàng điều khiển nút bấm nhanh dưới chân ảnh */}
                                                              <div className="p-1 bg-slate-900 flex items-center justify-between border-t border-slate-800">
                                                                <div className="flex items-center gap-0.5">
                                                                  <Tooltip title="Di chuyển ảnh sang trái">
                                                                    <button
                                                                      type="button"
                                                                      disabled={mIdx === 0}
                                                                      onClick={() => moveMediaItem(item.id, mIdx, mIdx - 1)}
                                                                      className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 flex items-center justify-center text-[9px] transition-colors"
                                                                    >
                                                                      <ArrowLeftOutlined />
                                                                    </button>
                                                                  </Tooltip>
                                                                  <Tooltip title="Di chuyển ảnh sang phải">
                                                                    <button
                                                                      type="button"
                                                                      disabled={mIdx === mediaUrls.length - 1}
                                                                      onClick={() => moveMediaItem(item.id, mIdx, mIdx + 1)}
                                                                      className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 flex items-center justify-center text-[9px] transition-colors"
                                                                    >
                                                                      <ArrowRightOutlined />
                                                                    </button>
                                                                  </Tooltip>
                                                                </div>

                                                                {!isCover && (
                                                                  <Tooltip title="Đưa ảnh này lên đầu làm Ảnh bìa (Cover)">
                                                                    <button
                                                                      type="button"
                                                                      onClick={() => moveMediaItem(item.id, mIdx, 0)}
                                                                      className="px-1 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/30 text-amber-400 flex items-center gap-0.5 text-[9px] font-semibold transition-colors border border-amber-500/30"
                                                                    >
                                                                      <StarOutlined /> Bìa
                                                                    </button>
                                                                  </Tooltip>
                                                                )}
                                                              </div>
                                                            </div>
                                                          );
                                                        })}
                                                      </div>
                                                    </Image.PreviewGroup>
                                                  </div>
                                                )}
                                              </>
                                            );
                                          })()}
                                        </div>
                                      )}
                                    </div>

                                    {/* CỘT PHẢI (lg:col-span-7): SOẠN CAPTION & TÙY CHỈNH HẸN GIỜ, BÌNH LUẬN RIÊNG */}
                                    <div className="poster-caption-panel lg:col-span-8 space-y-3">
                                      {/* Khung Soạn & Tinh chỉnh Caption */}
                                      <div className="space-y-1.5">
                                        <div className="flex items-center justify-between flex-wrap gap-2">
                                          <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                                            <FileTextOutlined className="text-blue-400" />
                                            <span>Caption bài viết (Tùy chỉnh nội dung):</span>
                                          </label>
                                          <Space size={4} wrap>
                                            <Tooltip title="Chèn 'Cre: Member ẩn danh' trực tiếp vào ô caption bài này">
                                              <Button
                                                size="small"
                                                type="text"
                                                icon={<UserOutlined />}
                                                onClick={() => {
                                                  const currentCap = item.customCaption !== undefined ? item.customCaption : (previews[item.id]?.caption || '');
                                                  updateLinkCustomCaption(item.id, replaceOrAppendCreditText(currentCap, 'Member ẩn danh'));
                                                }}
                                                className="text-xs text-amber-400 hover:text-amber-300 bg-amber-950/40 border border-amber-800/40 rounded px-1.5"
                                              >
                                                + Cre: Ẩn danh
                                              </Button>
                                            </Tooltip>
                                            <Tooltip title="⚡ Chèn 'Cre: Member ẩn danh' vào ô Caption cho TẤT CẢ bài viết trong danh sách chỉ với 1 click">
                                              <Button
                                                size="small"
                                                type="text"
                                                icon={<TeamOutlined />}
                                                onClick={applyAnonymousCreditToAll}
                                                className="text-xs text-amber-300 hover:text-amber-100 bg-amber-900/60 border border-amber-600/60 rounded px-1.5 font-bold shadow-xs"
                                              >
                                                ⚡ Ẩn danh (Tất cả bài)
                                              </Button>
                                            </Tooltip>
                                            <Tooltip title={previews[item.id]?.author ? `Chèn 'Cre: ${previews[item.id]?.author}' vào ô caption` : "Chèn tên Tác giả gốc vào ô caption"}>
                                              <Button
                                                size="small"
                                                type="text"
                                                icon={<UserOutlined />}
                                                onClick={() => {
                                                  const currentCap = item.customCaption !== undefined ? item.customCaption : (previews[item.id]?.caption || '');
                                                  const authorName = previews[item.id]?.author || (item as any).author || 'Tác giả gốc';
                                                  updateLinkCustomCaption(item.id, replaceOrAppendCreditText(currentCap, authorName));
                                                }}
                                                className="text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 border border-cyan-800/40 rounded px-1.5"
                                              >
                                                {previews[item.id]?.author ? `+ Cre: ${previews[item.id]?.author}` : '+ Cre: Tác giả'}
                                              </Button>
                                            </Tooltip>
                                            <Tooltip title="Khôi phục caption gốc từ nguồn cào">
                                              <Button
                                                size="small"
                                                type="text"
                                                icon={<RedoOutlined />}
                                                onClick={() => updateLinkCustomCaption(item.id, previews[item.id]?.caption || '')}
                                                className="text-xs text-slate-400 hover:text-slate-200"
                                              >
                                                Gốc
                                              </Button>
                                            </Tooltip>
                                            <Tooltip title="Xóa toàn bộ caption (đăng không lời)">
                                              <Button
                                                size="small"
                                                type="text"
                                                danger
                                                icon={<ClearOutlined />}
                                                onClick={() => updateLinkCustomCaption(item.id, '')}
                                                className="text-xs"
                                              >
                                                Xóa
                                              </Button>
                                            </Tooltip>
                                          </Space>
                                        </div>
                                        <TextArea
                                          placeholder="Nhập hoặc chỉnh sửa caption bài viết (thêm hashtag, icon, lời bình, xóa câu chữ thừa)..."
                                          value={item.customCaption !== undefined ? item.customCaption : (previews[item.id]?.caption || '')}
                                          onChange={(e) => updateLinkCustomCaption(item.id, e.target.value)}
                                          className="text-[13px] sm:text-sm bg-slate-950/90 border-slate-700 text-slate-100 rounded-xl font-medium focus:border-blue-500 placeholder:text-slate-500 leading-relaxed p-3.5 shadow-inner min-h-[180px]"
                                          autoSize={{ minRows: 8, maxRows: 24 }}
                                        />

                                        {item.colorBackground && (
                                          <div className="mt-2.5 p-3 rounded-xl bg-red-950/40 border border-red-800/60 space-y-2.5">
                                            <div className="flex items-center justify-between flex-wrap gap-2">
                                              <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-xs font-bold text-red-300">
                                                  {item.colorBackground === 'RED_PHOTO_TRICK' ? '🔴 Đang chọn: Nền Đỏ + Kèm Ảnh (Mẹo 3 chấm)' : '🔴 Đang chọn: Status Nền Đỏ (Thuần chữ)'}
                                                </span>
                                                <div className="inline-flex rounded-lg bg-black/40 p-0.5 border border-red-800/50 text-[11px]">
                                                  <button
                                                    type="button"
                                                    onClick={() => toggleColorBackground(item.id, true)}
                                                    className={`px-2 py-0.5 rounded-md font-semibold transition-all ${item.colorBackground === true
                                                      ? 'bg-red-600 text-white shadow-sm'
                                                      : 'text-red-300 hover:text-white'
                                                      }`}
                                                  >
                                                    Thuần chữ
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => toggleColorBackground(item.id, 'RED_PHOTO_TRICK')}
                                                    className={`px-2 py-0.5 rounded-md font-semibold transition-all ${item.colorBackground === 'RED_PHOTO_TRICK'
                                                      ? 'bg-red-600 text-white shadow-sm'
                                                      : 'text-red-300 hover:text-white'
                                                      }`}
                                                  >
                                                    Kèm ảnh (Mẹo 3 chấm)
                                                  </button>
                                                </div>
                                                <Tag
                                                  color={(item.customCaption !== undefined ? item.customCaption : (previews[item.id]?.caption || "")).length <= 130 ? "success" : "error"}
                                                  className="!m-0 text-[11px] font-mono font-bold px-2 py-0.5"
                                                >
                                                  {(item.customCaption !== undefined ? item.customCaption : (previews[item.id]?.caption || "")).length} / 130 ký tự
                                                </Tag>
                                              </div>
                                              {(item.customCaption !== undefined ? item.customCaption : (previews[item.id]?.caption || "")).length > 130 && (
                                                <Button
                                                  size="small"
                                                  danger
                                                  type="primary"
                                                  className="text-xs rounded-lg font-bold h-7 px-3 shadow-md"
                                                  onClick={() => {
                                                    const cur = (item.customCaption !== undefined ? item.customCaption : (previews[item.id]?.caption || "")).trim();
                                                    const firstLine = cur.split(/\r?\n/)[0] || cur;
                                                    const trimmed = firstLine.length <= 112 ? firstLine + "... (Xem cmt 👇)" : firstLine.slice(0, 110).trim() + "... (Xem cmt 👇)";
                                                    updateLinkCustomCaption(item.id, trimmed);
                                                    if (!item.affiliateLink) {
                                                      updateLinkAffiliate(item.id, cur);
                                                    }
                                                  }}
                                                >
                                                  ⚡ Rút gọn nhanh &lt; 130 ký tự
                                                </Button>
                                              )}
                                            </div>

                                            {item.colorBackground === 'RED_PHOTO_TRICK' && (
                                              <div className="text-[11px] text-amber-200/90 bg-amber-950/40 p-2 rounded-lg border border-amber-800/40 flex items-center gap-1.5">
                                                <span>💡</span>
                                                <span><b>Mẹo Facebook 3 chấm:</b> Bot sẽ đăng kèm ảnh trước, sau đó tự động vào <b>3 chấm &rarr; Sửa bài &rarr; Gỡ ảnh &rarr; Đổi phông nền Đỏ &rarr; Lưu</b> và bình luận toàn bộ nội dung bài báo bên dưới.</span>
                                              </div>
                                            )}

                                            {(item.customCaption !== undefined ? item.customCaption : (previews[item.id]?.caption || "")).length > 130 && (
                                              <Alert
                                                type="error"
                                                showIcon
                                                className="!p-2.5 text-xs rounded-lg border-red-700/60 bg-red-900/30 text-red-200"
                                                message={
                                                  <div>
                                                    <b>⚠️ Vượt quá 130 ký tự!</b> Facebook sẽ <b>tự động hủy phông nền đỏ</b> và biến thành bài chữ đen nhỏ nền trắng. Vui lòng bấm <b>"⚡ Rút gọn nhanh &lt; 130 ký tự"</b> hoặc tự sửa tít cho ngắn lại. Toàn bộ nội dung bài báo đã được giữ trong bình luận.
                                                  </div>
                                                }
                                              />
                                            )}
                                          </div>
                                        )}

                                        {item.colorBackground && (
                                          <div className="mt-2.5">
                                            <ColorPostPreview
                                              text={item.customCaption !== undefined ? item.customCaption : (previews[item.id]?.caption || '')}
                                              comment={item.skipComment ? null : (item.affiliateLink?.trim() || defaultCommentPreview)}
                                              authorName={previewAuthorName}
                                              hasMedia={!!previews[item.id]?.mediaUrls?.length}
                                              mode={item.colorBackground}
                                            />
                                          </div>
                                        )}
                                      </div>

                                      {/* Thời gian hẹn giờ */}
                                      {!item.isNow && (
                                        <EasyTimePicker
                                          compact
                                          value={item.scheduledAt}
                                          onChange={(val) => updateLinkTime(item.id, val)}
                                        />
                                      )}

                                      {/* Tùy chọn bài viết */}
                                      <div className="poster-post-options !p-2.5 sm:!p-3 bg-slate-950/60 rounded-2xl border border-slate-700/60 flex items-center gap-2 flex-wrap shadow-inner backdrop-blur-sm">
                                        <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5 mr-1 select-none">
                                          <SettingOutlined className="text-slate-400 text-xs" /> Tùy chọn:
                                        </span>

                                        <Tooltip title="Đăng status phông nền màu đỏ giật tít trên Facebook (Tối đa 130 ký tự, toàn bộ nội dung bài báo & hashtag sẽ tự động thả ở bình luận đầu tiên)">
                                          <button
                                            type="button"
                                            onClick={() => toggleColorBackground(item.id)}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none ${item.colorBackground
                                                ? 'poster-opt-chip is-active'
                                                : 'poster-opt-chip'
                                              }`}
                                          >
                                            <span className="poster-opt-dot" /><span>Status nền đỏ</span>
                                            <span className="text-[10px] opacity-75">(&lt; 130 ký tự)</span>
                                            {item.colorBackground && <CheckOutlined className="text-xs text-rose-400" />}
                                          </button>
                                        </Tooltip>

                                        <Tooltip title="Tự động ghi nguồn tác giả bài viết ở cuối nội dung">
                                          <button
                                            type="button"
                                            onClick={() => toggleIncludeCredit(item.id)}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none ${item.includeCredit !== false
                                                ? 'poster-opt-chip is-active'
                                                : 'poster-opt-chip'
                                              }`}
                                          >
                                            <UserOutlined className="text-xs text-blue-400" />
                                            <span>Ghi nguồn tác giả</span>
                                            {item.includeCredit !== false && <CheckOutlined className="text-xs text-blue-400" />}
                                          </button>
                                        </Tooltip>

                                        <Tooltip title={item.skipComment ? 'Bình luận đang bị tắt cho bài này' : (hasCustomComment ? 'Đã có bình luận riêng cho bài này' : 'Thêm bình luận / link Shopee riêng cho bài này')}>
                                          <button
                                            type="button"
                                            onClick={() => toggleCommentBox(item.id)}
                                            disabled={item.skipComment}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none disabled:opacity-40 disabled:cursor-not-allowed ${hasCustomComment || isCommentOpen
                                                ? 'poster-opt-chip is-active'
                                                : 'poster-opt-chip'
                                              }`}
                                          >
                                            <MessageOutlined className="text-xs text-cyan-400" />
                                            <span>{hasCustomComment ? 'Có bình luận riêng' : 'Thêm bình luận riêng'}</span>
                                            {(hasCustomComment || isCommentOpen) && <CheckOutlined className="text-xs text-cyan-400" />}
                                          </button>
                                        </Tooltip>

                                        <Tooltip title="Không đăng bất kỳ bình luận nào (kể cả cmt mặc định) cho riêng bài này">
                                          <button
                                            type="button"
                                            onClick={() => toggleSkipComment(item.id)}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none ${item.skipComment
                                                ? 'poster-opt-chip is-active'
                                                : 'poster-opt-chip'
                                              }`}
                                          >
                                            <StopOutlined className="text-xs text-amber-400" />
                                            <span>Không bình luận</span>
                                            {item.skipComment && <CheckOutlined className="text-xs text-amber-400" />}
                                          </button>
                                        </Tooltip>

                                        {postMode !== 'FANPAGE_ONLY' && (
                                          <Tooltip title="Mặc định KHÔNG bình luận vào bài đăng trong Nhóm — bật tùy chọn này mới tự động bình luận link Affiliate cho bài này trong Nhóm.">
                                            <button
                                              type="button"
                                              onClick={() => toggleGroupComment(item.id)}
                                              disabled={item.skipComment}
                                              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none disabled:opacity-40 disabled:cursor-not-allowed ${item.groupCommentEnabled
                                                  ? 'poster-opt-chip is-active'
                                                  : 'poster-opt-chip'
                                                }`}
                                            >
                                              <TeamOutlined className="text-xs text-emerald-400" />
                                              <span>Bình luận trong Nhóm</span>
                                              {item.groupCommentEnabled && <CheckOutlined className="text-xs text-emerald-400" />}
                                            </button>
                                          </Tooltip>
                                        )}
                                      </div>

                                      {/* Khung soạn bình luận riêng */}
                                      {isCommentOpen && (
                                        <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2">
                                          <div className="flex justify-between items-center">
                                            <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                                              <MessageOutlined className="text-blue-400" />
                                              <span>Bình luận riêng cho Bài #{index + 1}:</span>
                                              {hasCustomComment && (
                                                <Tag color="cyan" className="!text-[10px] !m-0 !py-0">
                                                  Đang dùng cmt riêng
                                                </Tag>
                                              )}
                                            </span>
                                            {!hasCustomComment && (
                                              <Button
                                                size="small"
                                                type="link"
                                                className="!p-0 text-xs text-slate-400 hover:text-slate-200"
                                                onClick={() => toggleCommentBox(item.id)}
                                              >
                                                Đóng ô
                                              </Button>
                                            )}
                                          </div>
                                          <TextArea
                                            placeholder="Nhập nội dung bình luận / link Shopee riêng cho bài này (hỗ trợ xuống dòng, emoji, link)... Nếu để trống sẽ tự động dùng bình luận chung bên dưới."
                                            autoSize={{ minRows: 2, maxRows: 4 }}
                                            value={item.affiliateLink || ''}
                                            onChange={(e) => updateLinkAffiliate(item.id, e.target.value)}
                                            className="text-xs bg-slate-900/90 border-slate-700 text-slate-100 rounded-lg"
                                          />
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Khi chưa cào xong hoặc không có link preview thì hiển thị Time Picker & Options ở dưới ô URL */}
                            {(!item.url.trim() || !previews[item.id] || previews[item.id]?.loading || previews[item.id]?.error) && (
                              <>
                                {!item.isNow && (
                                  <EasyTimePicker
                                    compact
                                    value={item.scheduledAt}
                                    onChange={(val) => updateLinkTime(item.id, val)}
                                    className="mt-3"
                                  />
                                )}

                                <div className="poster-post-options !p-2.5 sm:!p-3 bg-slate-950/60 rounded-2xl border border-slate-700/60 flex items-center gap-2 flex-wrap shadow-inner backdrop-blur-sm">
                                  <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5 mr-1 select-none">
                                    <SettingOutlined className="text-slate-400 text-xs" /> Tùy chọn:
                                  </span>

                                  <Tooltip title="Đăng status phông nền màu đỏ (tối đa 130 ký tự). Dán link xong sẽ hiện khung chọn Thuần chữ / Kèm ảnh và xem trước.">
                                    <button
                                      type="button"
                                      onClick={() => toggleColorBackground(item.id)}
                                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none ${item.colorBackground
                                          ? 'poster-opt-chip is-active'
                                          : 'poster-opt-chip'
                                        }`}
                                    >
                                      <span className="poster-opt-dot" /><span>Status nền đỏ</span>
                                      <span className="text-[10px] opacity-75">(&lt; 130 ký tự)</span>
                                      {item.colorBackground && <CheckOutlined className="text-xs text-rose-400" />}
                                    </button>
                                  </Tooltip>

                                  <Tooltip title="Tự động ghi nguồn tác giả bài viết ở cuối nội dung">
                                    <button
                                      type="button"
                                      onClick={() => toggleIncludeCredit(item.id)}
                                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none ${item.includeCredit !== false
                                          ? 'poster-opt-chip is-active'
                                          : 'poster-opt-chip'
                                        }`}
                                    >
                                      <UserOutlined className="text-xs text-blue-400" />
                                      <span>Ghi nguồn tác giả</span>
                                      {item.includeCredit !== false && <CheckOutlined className="text-xs text-blue-400" />}
                                    </button>
                                  </Tooltip>

                                  <Tooltip title={item.skipComment ? 'Bình luận đang bị tắt cho bài này' : (hasCustomComment ? 'Đã có bình luận riêng cho bài này' : 'Thêm bình luận / link Shopee riêng cho bài này')}>
                                    <button
                                      type="button"
                                      onClick={() => toggleCommentBox(item.id)}
                                      disabled={item.skipComment}
                                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none disabled:opacity-40 disabled:cursor-not-allowed ${hasCustomComment || isCommentOpen
                                          ? 'poster-opt-chip is-active'
                                          : 'poster-opt-chip'
                                        }`}
                                    >
                                      <MessageOutlined className="text-xs text-cyan-400" />
                                      <span>{hasCustomComment ? 'Có bình luận riêng' : 'Thêm bình luận riêng'}</span>
                                      {(hasCustomComment || isCommentOpen) && <CheckOutlined className="text-xs text-cyan-400" />}
                                    </button>
                                  </Tooltip>

                                  <Tooltip title="Không đăng bất kỳ bình luận nào (kể cả cmt mặc định) cho riêng bài này">
                                    <button
                                      type="button"
                                      onClick={() => toggleSkipComment(item.id)}
                                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none ${item.skipComment
                                          ? 'poster-opt-chip is-active'
                                          : 'poster-opt-chip'
                                        }`}
                                    >
                                      <StopOutlined className="text-xs text-amber-400" />
                                      <span>Không bình luận</span>
                                      {item.skipComment && <CheckOutlined className="text-xs text-amber-400" />}
                                    </button>
                                  </Tooltip>

                                  {postMode !== 'FANPAGE_ONLY' && (
                                    <Tooltip title="Mặc định KHÔNG bình luận vào bài đăng trong Nhóm — bật tùy chọn này mới tự động bình luận link Affiliate cho bài này trong Nhóm.">
                                      <button
                                        type="button"
                                        onClick={() => toggleGroupComment(item.id)}
                                        disabled={item.skipComment}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none disabled:opacity-40 disabled:cursor-not-allowed ${item.groupCommentEnabled
                                            ? 'poster-opt-chip is-active'
                                            : 'poster-opt-chip'
                                          }`}
                                      >
                                        <TeamOutlined className="text-xs text-emerald-400" />
                                        <span>Bình luận trong Nhóm</span>
                                        {item.groupCommentEnabled && <CheckOutlined className="text-xs text-emerald-400" />}
                                      </button>
                                    </Tooltip>
                                  )}
                                </div>

                                {/* KHUNG SOẠN BÌNH LUẬN RIÊNG CHO TỪNG BÀI */}
                                {isCommentOpen && (
                                  <div className="p-3.5 bg-slate-900/90 border border-slate-700/80 rounded-xl space-y-2 shadow-inner">
                                    <div className="flex justify-between items-center">
                                      <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                                        <MessageOutlined className="text-blue-400" />
                                        <span>Bình luận riêng cho Bài #{index + 1}:</span>
                                        {hasCustomComment && (
                                          <Tag color="cyan" className="!text-[10px] !m-0 !py-0">
                                            Đang dùng cmt riêng
                                          </Tag>
                                        )}
                                      </span>
                                      {!hasCustomComment && (
                                        <Button
                                          size="small"
                                          type="link"
                                          className="!p-0 text-xs text-slate-400 hover:text-slate-300"
                                          onClick={() => toggleCommentBox(item.id)}
                                        >
                                          Đóng ô
                                        </Button>
                                      )}
                                    </div>
                                    <TextArea
                                      placeholder="Nhập nội dung bình luận / link Shopee riêng cho bài này (hỗ trợ xuống dòng, emoji, link)... Nếu để trống sẽ tự động dùng bình luận chung bên dưới."
                                      autoSize={{ minRows: 2, maxRows: 5 }}
                                      value={item.affiliateLink || ''}
                                      onChange={(e) => updateLinkAffiliate(item.id, e.target.value)}
                                      className="text-xs bg-slate-950/80 text-slate-100 border-slate-700 placeholder:text-slate-500 rounded-lg"
                                    />
                                  </div>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <Button
                type="dashed"
                block
                icon={<PlusOutlined />}
                onClick={addLinkItem}
                className="poster-add-post mt-3.5 min-h-[54px] rounded-xl flex items-center justify-center"
              >
                <span className="font-bold">Thêm bài viết tiếp theo</span>
                <span className="hidden sm:inline font-normal text-slate-400"> · tự hẹn sau {batchInterval} phút</span>
              </Button>
            </section>

            {/* Tùy chọn nâng cao được mở theo nhu cầu, không chen vào luồng chính. */}
            {/* Tùy chọn nâng cao được mở theo nhu cầu, không chen vào luồng chính. */}
            <div className="mb-5 rounded-xl border border-slate-700/60 bg-slate-800/40 overflow-hidden backdrop-blur-sm shadow-xs">
              <button
                type="button"
                className="w-full flex items-center gap-2.5 p-3.5 text-left hover:bg-slate-700/30 transition-colors"
                onClick={() => setAdvancedOpen((open) => !open)}
                aria-expanded={advancedOpen}
              >
                <div className="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center font-bold text-sm shrink-0 border border-blue-500/25">
                  <SettingOutlined />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-slate-200 flex items-center gap-2">
                    <span>Bình luận tự động & tùy chọn nâng cao</span>
                  </div>
                  <div className="text-xs text-slate-400">Thiết lập bình luận mặc định, link tiếp thị và làm mới dữ liệu nguồn</div>
                </div>
                <span className="text-xs font-semibold text-blue-400 shrink-0 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20">{advancedOpen ? 'Thu gọn' : 'Thiết lập'}</span>
              </button>

              {advancedOpen && <div className="border-t border-slate-700/60 bg-slate-900/60 p-4 sm:p-5">
                {/* Nút hành động tiện lợi */}
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <Button
                    size="small"
                    type="primary"
                    icon={<CopyOutlined />}
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        if (text) {
                          form.setFieldValue('affiliateLink', text);
                          localStorage.setItem(STORAGE_KEY_COMMENT, text);
                          message.success('📋 Đã dán nội dung từ khay nhớ tạm!');
                        }
                      } catch {
                        // Ignore
                      }
                    }}
                    className="bg-blue-600 hover:bg-blue-500 font-bold rounded-lg text-xs"
                  >
                    📋 Dán
                  </Button>
                  <Button
                    size="small"
                    type="default"
                    onClick={() => {
                      const currentVal = form.getFieldValue('affiliateLink');
                      if (currentVal && currentVal.trim()) {
                        localStorage.setItem(STORAGE_KEY_COMMENT, currentVal.trim());
                        message.success('💾 Đã lưu nội dung này làm mẫu mặc định!');
                      } else {
                        message.warning('Vui lòng nhập nội dung trước khi lưu.');
                      }
                    }}
                    className="font-bold border-slate-700 text-slate-200 hover:bg-slate-800 rounded-lg text-xs"
                  >
                    💾 Lưu mẫu
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    onClick={() => {
                      form.setFieldValue('affiliateLink', DEFAULT_SAVED_COMMENT);
                      localStorage.setItem(STORAGE_KEY_COMMENT, DEFAULT_SAVED_COMMENT);
                      message.success('↺ Đã khôi phục về mẫu mặc định ban đầu!');
                    }}
                    className="text-slate-400 hover:text-slate-200 text-xs rounded-lg"
                  >
                    ↺ Khôi phục
                  </Button>
                </div>

                <Form.Item
                  name="affiliateLink"
                  className="!mb-2"
                >
                  <TextArea
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    placeholder="Nhập hoặc dán nội dung bình luận (ví dụ: Chúc mọi người ngày mới tràn đầy năng lượng ✨ 👉 https://s.shopee.vn/...)"
                    className="text-xs sm:text-sm font-medium rounded-xl border-slate-700/80 focus:border-blue-500 bg-slate-950/80 p-3 text-slate-100"
                    onChange={(e) => {
                      if (e.target.value) {
                        localStorage.setItem(STORAGE_KEY_COMMENT, e.target.value);
                      }
                    }}
                  />
                </Form.Item>

                {postMode !== 'FANPAGE_ONLY' && (
                  <div className="mb-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs text-amber-300 shadow-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-base">💡</span>
                      <span>
                        <strong>Lưu ý về Bình luận Nhóm:</strong> Mặc định bình luận link vào Nhóm ở dạng Opt-in (Tắt). Bấm nút bên phải để bật tự động bình luận link vào Group cho toàn bộ bài viết.
                      </span>
                    </div>
                    <Button
                      type="primary"
                      size="small"
                      icon={<MessageOutlined />}
                      onClick={applyEnableAllGroupComments}
                      className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-lg border-none shrink-0"
                    >
                      💬 Bật cmt Nhóm cho các bài
                    </Button>
                  </div>
                )}

                {currentSelectedGroupIdsForAffiliate.length > 0 && (
                  <div className="mb-2.5">
                    <label className="text-xs font-semibold text-slate-300 block mb-1">
                      🚫 Nhóm KHÔNG gắn link Affiliate (bỏ trống = gắn cho tất cả nhóm đã chọn ở trên):
                    </label>
                    <Select
                      mode="multiple"
                      size="middle"
                      placeholder="Chọn nhóm muốn loại trừ, không bình luận link Affiliate"
                      optionFilterProp="label"
                      value={affiliateExcludedGroupIds.filter((id) => currentSelectedGroupIdsForAffiliate.includes(id))}
                      onChange={setAffiliateExcludedGroupIds}
                      className="w-full"
                    >
                      {currentSelectedGroupIdsForAffiliate.map((gId) => {
                        const matched = groupAccountsWithId.find((g) => g.platformAccountId === gId);
                        const label = matched ? stripEmojiPrefix(matched.pageName) : gId;
                        return (
                          <Option key={gId} value={gId} label={label}>
                            {label} · ID {gId}
                          </Option>
                        );
                      })}
                    </Select>
                  </div>
                )}

                {postMode !== 'FANPAGE_ONLY' && currentSelectedGroupIdsForAffiliate.length > 0 && (
                  <div className="mb-2.5">
                    <label className="text-xs font-semibold text-slate-300 block mb-1">
                      ✅ Chỉ định Nhóm ĐƯỢC bình luận (bỏ trống = không giới hạn, áp dụng cho mọi Nhóm đã chọn ở trên — vẫn tuỳ checkbox "Bình luận trong Nhóm" của từng bài):
                    </label>
                    <Select
                      mode="multiple"
                      size="middle"
                      placeholder="Chọn đích danh Nhóm được phép bình luận, để trống = không giới hạn"
                      optionFilterProp="label"
                      value={groupCommentAllowedGroupIds.filter((id) => currentSelectedGroupIdsForAffiliate.includes(id))}
                      onChange={setGroupCommentAllowedGroupIds}
                      className="w-full"
                    >
                      {currentSelectedGroupIdsForAffiliate.map((gId) => {
                        const matched = groupAccountsWithId.find((g) => g.platformAccountId === gId);
                        const label = matched ? stripEmojiPrefix(matched.pageName) : gId;
                        return (
                          <Option key={gId} value={gId} label={label}>
                            {label} · ID {gId}
                          </Option>
                        );
                      })}
                    </Select>
                  </div>
                )}

                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-950/40 border border-blue-800/40 text-xs text-blue-200">
                  <CheckCircleOutlined className="text-blue-400 mt-0.5 shrink-0 text-sm" />
                  <span className="leading-relaxed">
                    <b className="text-blue-300">Mẹo:</b> Hệ thống sẽ tự động bình luận nội dung này ngay sau khi bài được đăng. Hỗ trợ xuống dòng, emoji và link tiếp thị Shopee / Lazada.
                  </span>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-800/80">
                  <Tooltip title="Worker giữ kết quả cào gần đây (6h) để tránh cào/tải trùng khi submit lại cùng link. Bật khi bài gốc vừa được sửa.">
                    <Checkbox checked={forceRefresh} onChange={(e) => setForceRefresh(e.target.checked)} className="text-xs text-slate-300">
                      Cào lại nội dung mới nhất, bỏ qua cache đã lưu
                    </Checkbox>
                  </Tooltip>
                </div>
              </div>}
            </div>

            {isPosting && (
              <div className="relative overflow-hidden rounded-2xl border border-blue-500/40 bg-gradient-to-r from-blue-950/80 via-indigo-950/70 to-slate-900/90 p-4.5 mb-4 shadow-xl shadow-blue-950/50 backdrop-blur-md">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500 animate-pulse" />
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-blue-100 truncate tracking-wide">
                      {progressStatusMsg || 'Đang thực thi tác vụ xuất bản...'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-2.5 py-0.5 rounded-full bg-blue-500/25 text-blue-300 font-mono font-bold text-xs border border-blue-400/30 shadow-inner">
                      {progressPercent}%
                    </span>
                  </div>
                </div>
                <Progress
                  percent={progressPercent}
                  status="active"
                  showInfo={false}
                  strokeColor={{
                    '0%': '#38bdf8',
                    '50%': '#6366f1',
                    '100%': '#a855f7',
                  }}
                  railColor="rgba(255, 255, 255, 0.08)"
                  strokeWidth={8}
                  className="!m-0"
                />
                <div className="flex justify-between items-center mt-2.5 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1.5 text-blue-300/80">
                    <LoadingOutlined spin className="text-blue-400 text-xs" />
                    Tiến trình Playwright Browser
                  </span>
                  <span className="text-slate-400/90">Vui lòng không tắt hoặc tải lại trang</span>
                </div>
              </div>
            )}

            {(postMode === 'GROUP_ONLY' || postMode === 'FANPAGE_AND_GROUP') && (
              selectedGroupDisplayNames.length > 0 ? (
                <div className="mb-4 p-4 rounded-2xl border border-indigo-500/40 bg-gradient-to-r from-indigo-950/50 via-purple-950/40 to-slate-900/90 shadow-lg backdrop-blur-md">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-indigo-500/20 mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-300 flex items-center justify-center shrink-0 border border-indigo-500/30">
                        <DeploymentUnitOutlined className="text-base" />
                      </div>
                      <div>
                        <span className="font-extrabold text-sm text-indigo-100">Kế hoạch xuất bản tự động</span>
                        <span className="ml-2 px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          {calculatedTotalQueueCount} bài queue
                        </span>
                      </div>
                    </div>
                    <div className="text-xs font-semibold text-purple-200">
                      Chế độ: <span className="text-amber-300 font-bold">{groupDistributionMode === 'PAGE_PER_GROUP' ? '🛡️ Nhân bản đủ tất cả Nhóm (Xoay vòng Page)' : groupDistributionMode === 'ROUND_ROBIN_POSTS' ? '🔄 Chia lẻ bài (Không nhân bản)' : '⚡ Tất cả Page x Tất cả Nhóm'}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                    <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                      <div className="text-slate-400 text-[11px] font-medium mb-1">📝 Nội dung đưa vào</div>
                      <div className="font-bold text-slate-100">{validLinkCount} bài viết</div>
                    </div>
                    <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                      <div className="text-slate-400 text-[11px] font-medium mb-1">🎯 Nhóm nhận bài ({selectedGroupDisplayNames.length} nhóm)</div>
                      <div className="font-bold text-amber-300 truncate" title={selectedGroupDisplayNames.join(', ')}>
                        {selectedGroupDisplayNames.join(', ') || 'Chưa chọn'}
                      </div>
                    </div>
                    <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                      <div className="text-slate-400 text-[11px] font-medium mb-1">🎭 Page/Nick đăng ({selectedTargetAccountNames.length} tài khoản)</div>
                      <div className="font-bold text-sky-300 truncate" title={selectedTargetAccountNames.join(', ')}>
                        {selectedTargetAccountNames.join(', ') || 'Mặc định'}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mb-4 flex items-center gap-3 p-3.5 rounded-xl border border-rose-500/30 bg-gradient-to-r from-rose-950/35 via-rose-900/20 to-slate-900/60 shadow-sm backdrop-blur-md">
                  <div className="w-7 h-7 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0 border border-rose-500/30">
                    <CloseCircleOutlined className="text-sm" />
                  </div>
                  <div className="text-xs text-rose-200/90 flex-1 font-semibold leading-relaxed">
                    Chưa chọn Nhóm nhận bài — vui lòng chọn lại mục tiêu đăng ở Bước 2 trước khi bấm đăng.
                  </div>
                </div>
              )
            )}

            <div className="poster-submit-bar flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="poster-submit-summary">
                {validLinkCount ? (
                  <>
                    <span>{postMode === 'FANPAGE_ONLY' ? 'Fanpage' : postMode === 'GROUP_ONLY' ? 'Nhóm' : 'Page + Nhóm'}</span>
                    <span title={selectedTargetAccountNames.join(', ')}>
                      {selectedTargetAccountNames.length > 1 ? `${selectedTargetAccountNames.length} page/nick` : (selectedTargetAccountNames[0] || 'Chưa chọn page')}
                    </span>
                    {postMode !== 'FANPAGE_ONLY' && <span>{selectedGroupDisplayNames.length} nhóm</span>}
                    <span>{validLinkCount} bài</span>
                    <span>{queueAppendMode ? `Nối đuôi · nghỉ ${queueGapMinutes}'` : isFirstItemImmediate ? 'Đăng ngay' : 'Theo lịch hẹn'}</span>
                  </>
                ) : (
                  <em>Thêm nội dung hoặc dán link ở bước 3 để bắt đầu.</em>
                )}
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
                {queueModeControl}
                <Button
                  onClick={() => {
                    setLinkItems([{ id: '1', url: '', isNow: true, scheduledAt: dayjs() }]);
                    setPreviews({});
                  }}
                  disabled={isPosting}
                  size="large"
                  className="rounded-xl font-semibold text-xs border-slate-300 min-w-24"
                >
                  Đặt lại
                </Button>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={isPosting}
                  size="large"
                  icon={isFirstItemImmediate ? <RocketOutlined /> : <ScheduleOutlined />}
                  disabled={validLinkCount === 0}
                  className={`poster-submit-primary rounded-xl font-extrabold h-12 px-6 text-sm sm:text-base shadow-md w-full sm:w-auto ${isFirstItemImmediate ? '!bg-blue-600 hover:!bg-blue-700' : '!bg-indigo-600 hover:!bg-indigo-700'
                    }`}
                >
                  {queueAppendMode
                    ? 'Đăng nối đuôi hàng đợi'
                    : postMode === 'GROUP_ONLY'
                      ? (isFirstItemImmediate ? '🚀 Đăng ngay vào nhóm' : '⏰ Lên lịch đăng vào nhóm')
                      : postMode === 'FANPAGE_ONLY'
                        ? (isFirstItemImmediate ? '🚀 Đăng ngay lên Fanpage' : '⏰ Lên lịch lên Fanpage')
                        : (isFirstItemImmediate ? '🚀 Đăng ngay Page + Nhóm' : '⏰ Lên lịch Page + Nhóm')}
                </Button>
              </div>
            </div>
          </Form>
        </Card>

        {/* Tóm tắt lần đăng: luôn thấy bấm Đăng sẽ làm gì (màn hình rộng). */}
        <aside className="poster-summary-aside" aria-label="Tóm tắt lần đăng">
          <div className="poster-summary-card">
            <div className="poster-summary-title">Tóm tắt lần đăng</div>
            <dl className="poster-summary-list">
              <div>
                <dt>Cách đăng</dt>
                <dd>{postMode === 'FANPAGE_ONLY' ? 'Chỉ đăng Fanpage' : postMode === 'GROUP_ONLY' ? 'Chỉ đăng vào Nhóm' : 'Fanpage + Nhóm'}</dd>
              </div>
              <div>
                <dt>{postMode === 'GROUP_ONLY' ? 'Đăng dưới tên' : 'Page / nick'}</dt>
                <dd className={selectedTargetAccountNames.length ? '' : 'is-missing'} title={selectedTargetAccountNames.join(', ')}>
                  {selectedTargetAccountNames.length
                    ? selectedTargetAccountNames.length > 3
                      ? `${selectedTargetAccountNames.slice(0, 3).join(', ')} +${selectedTargetAccountNames.length - 3}`
                      : selectedTargetAccountNames.join(', ')
                    : 'Chưa chọn'}
                </dd>
              </div>
              {postMode !== 'FANPAGE_ONLY' && (
                <div>
                  <dt>Nhóm nhận bài</dt>
                  <dd className={selectedGroupDisplayNames.length ? '' : 'is-missing'} title={selectedGroupDisplayNames.join(', ')}>
                    {selectedGroupDisplayNames.length
                      ? selectedGroupDisplayNames.length > 3
                        ? `${selectedGroupDisplayNames.slice(0, 3).join(', ')} +${selectedGroupDisplayNames.length - 3}`
                        : selectedGroupDisplayNames.join(', ')
                      : 'Chưa chọn'}
                  </dd>
                </div>
              )}
              <div>
                <dt>Số bài</dt>
                <dd className={validLinkCount ? '' : 'is-missing'}>{validLinkCount ? `${validLinkCount} bài` : 'Chưa có nội dung'}</dd>
              </div>
              <div>
                <dt>Thời gian</dt>
                <dd>
                  {validLinkCount === 0
                    ? '—'
                    : queueAppendMode
                      ? `Nối đuôi hàng đợi, nghỉ ${queueGapMinutes} phút/bài`
                      : isFirstItemImmediate
                        ? (validLinkCount > 1 ? `Bài 1 đăng ngay, ${validLinkCount - 1} bài theo lịch` : 'Đăng ngay')
                        : 'Theo lịch hẹn'}
                </dd>
              </div>
            </dl>
            {queueModeControl}
            {isCurrentTargetExpired && (
              <div className="poster-summary-warning">Cookie của page/nick đang chọn đã hết hạn — cập nhật trước khi đăng.</div>
            )}
            <Button
              type="primary"
              size="large"
              block
              loading={isPosting}
              disabled={validLinkCount === 0}
              icon={queueAppendMode || isFirstItemImmediate ? <RocketOutlined /> : <ScheduleOutlined />}
              onClick={() => form.submit()}
            >
              {queueAppendMode ? 'Đăng nối đuôi' : isFirstItemImmediate ? 'Đăng ngay' : 'Lên lịch đăng'}
            </Button>
            <Button
              block
              disabled={isPosting}
              onClick={() => {
                setLinkItems([{ id: '1', url: '', isNow: true, scheduledAt: dayjs() }]);
                setPreviews({});
              }}
            >
              Đặt lại nội dung
            </Button>
          </div>
        </aside>
      </div>

      {/* Xem ảnh / video lớn mà không rời khỏi màn hình soạn bài */}
      <Modal
        open={!!mediaViewer}
        onCancel={() => setMediaViewer(null)}
        footer={null}
        centered
        title={
          <div className="flex items-center justify-between pr-8">
            <span className="font-bold text-slate-200">{mediaViewer?.title || 'Xem media'}</span>
            {mediaViewer?.url && (
              <a
                href={mediaViewer.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-cyan-300 hover:text-cyan-200 font-bold flex items-center gap-1.5 bg-slate-800/90 hover:bg-slate-700 px-3 py-1 rounded-lg border border-slate-700 transition-colors"
              >
                <span>🔗 Mở ảnh gốc trong tab mới</span>
                <LinkOutlined className="text-[11px]" />
              </a>
            )}
          </div>
        }
        className="poster-media-viewer-modal"
        destroyOnHidden
      >
        <div className="poster-media-viewer-stage">
          {mediaViewer?.kind === 'video' ? (
            <video src={mediaViewer.url} controls autoPlay playsInline />
          ) : mediaViewer ? (
            <img src={mediaViewer.url} alt={mediaViewer.title || 'Ảnh bài viết'} />
          ) : null}
        </div>
      </Modal>

      {/* MODAL: Lưu Combo Thường Dùng Mới */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-slate-100 pb-2 border-b border-slate-800">
            <span className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
              <AppstoreOutlined className="text-sm" />
            </span>
            <span className="font-bold text-base">Lưu cấu hình thường dùng mới</span>
          </div>
        }
        open={savePresetModalOpen}
        onCancel={() => setSavePresetModalOpen(false)}
        onOk={handleSaveNewPreset}
        okText="Lưu Combo"
        cancelText="Hủy"
        className="dark-modal"
        centered
        width={440}
      >
        <div className="py-3 space-y-3.5">
          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 leading-relaxed space-y-1.5">
            <div className="font-semibold text-slate-100 flex items-center gap-1.5">
              <span>🎯 Cấu hình được lưu trong Combo này:</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Nhóm nhận bài:</span>
              <span className="font-bold text-amber-300">{activeSelectedGroupIds.length} nhóm</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Page/Nick đăng:</span>
              <span className="font-bold text-sky-300">{activeSelectedFanpageIds.length} tài khoản</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Chế độ phân bổ:</span>
              <span className="font-bold text-purple-300">{groupDistributionMode === 'PAGE_PER_GROUP' ? '🛡️ Chia đều Page/Nhóm' : '🔄 Xoay vòng'}</span>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-200 block mb-1.5">Đặt tên gợi nhớ cho Combo này:</label>
            <Input
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              placeholder="Ví dụ: 3 Nhóm Kinh Tế Sáng, Combo Pet..."
              className="rounded-xl font-medium"
              autoFocus
              onPressEnter={handleSaveNewPreset}
            />
            <div className="text-[11px] text-slate-500 mt-1">Lần sau chỉ cần bấm 1 click vào nút Combo này là tự động chọn đủ cả Nhóm lẫn Page!</div>
          </div>
        </div>
      </Modal>

      {/* Modal Quản Lý Tất Cả Cấu Hình Đã Lưu */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-slate-100">
            <SettingOutlined className="text-blue-400 text-base" />
            <span className="font-bold text-base">Quản lý cấu hình đăng bài lưu sẵn ({savedPresets.length})</span>
          </div>
        }
        open={managePresetsModalOpen}
        onCancel={() => setManagePresetsModalOpen(false)}
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="text-xs text-slate-400">
              💡 Bấm "Cập nhật" để ghi đè cấu hình bằng các Nhóm và Page đang chọn trên màn hình
            </span>
            <Button onClick={() => setManagePresetsModalOpen(false)} className="rounded-lg">
              Đóng
            </Button>
          </div>
        }
        className="dark-modal"
        centered
        width={720}
      >
        <div className="py-3 space-y-3">
          {savedPresets.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              Chưa có cấu hình nào được lưu. Hãy chọn Nhóm, Page và bấm "Lưu mới" để tạo cấu hình!
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80 max-h-[60vh] overflow-y-auto pr-1">
              {savedPresets.map((p) => {
                const isSelected = selectedPresetId === p.id;
                return (
                  <div key={p.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-800/20 px-2 rounded-xl transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-100">{p.name}</span>
                        {isSelected && (
                          <Tag color="cyan" className="!text-[10px] !m-0 !rounded-md font-bold">
                            Đang áp dụng
                          </Tag>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5 text-xs text-slate-400 mt-1 flex-wrap">
                        <Tag color="gold" className="!text-[11px] !m-0 !rounded-md">
                          👥 {p.selectedGroupIds?.length > 0 ? `${p.selectedGroupIds.length} Nhóm` : 'Tự chọn Nhóm'}
                        </Tag>
                        <Tag color="blue" className="!text-[11px] !m-0 !rounded-md">
                          📄 {p.selectedFanpageIds?.length || 0} Page/Nick
                        </Tag>
                        <span className="text-[11px] text-slate-500 font-mono">
                          {p.postMode === 'GROUP_ONLY' ? 'Chỉ đăng Group' : p.postMode === 'FANPAGE_ONLY' ? 'Chỉ Fanpage' : 'Cả Page & Group'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="small"
                        type="primary"
                        onClick={() => {
                          applyPreset(p);
                          setManagePresetsModalOpen(false);
                        }}
                        className="bg-blue-600 hover:bg-blue-500 text-xs font-semibold rounded-lg"
                      >
                        Áp dụng
                      </Button>
                      <Tooltip title="Lưu các Nhóm & Page đang tick chọn hiện tại vào cấu hình này">
                        <Button
                          size="small"
                          icon={<SaveOutlined className="text-emerald-400" />}
                          onClick={() => handleUpdatePresetWithCurrent(p.id)}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 text-xs font-semibold rounded-lg"
                        >
                          Cập nhật
                        </Button>
                      </Tooltip>
                      <Tooltip title="Đổi tên cấu hình này">
                        <Button
                          size="small"
                          icon={<EditOutlined className="text-sky-400" />}
                          onClick={() => {
                            setEditingPreset({ id: p.id, name: p.name });
                            setEditingPresetName(p.name);
                          }}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 text-xs rounded-lg"
                        />
                      </Tooltip>
                      <Popconfirm
                        title="Xóa cấu hình này?"
                        onConfirm={() => handleDeletePreset(p.id)}
                        okText="Xóa"
                        cancelText="Hủy"
                        okButtonProps={{ danger: true, size: 'small' }}
                        cancelButtonProps={{ size: 'small' }}
                      >
                        <Button
                          size="small"
                          danger
                          type="text"
                          icon={<DeleteOutlined />}
                          className="text-xs"
                        />
                      </Popconfirm>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      {/* Modal Đổi Tên Cấu Hình */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-slate-100">
            <EditOutlined className="text-sky-400 text-base" />
            <span className="font-bold text-base">Đổi tên cấu hình</span>
          </div>
        }
        open={!!editingPreset}
        onCancel={() => {
          setEditingPreset(null);
          setEditingPresetName('');
        }}
        onOk={() => {
          if (editingPreset) {
            handleRenamePreset(editingPreset.id, editingPresetName);
          }
        }}
        okText="Lưu tên mới"
        cancelText="Hủy"
        className="dark-modal"
        centered
        width={420}
      >
        <div className="py-3">
          <label className="text-xs font-semibold text-slate-200 block mb-1.5">Tên mới cho cấu hình:</label>
          <Input
            value={editingPresetName}
            onChange={(e) => setEditingPresetName(e.target.value)}
            placeholder="Nhập tên cấu hình..."
            className="rounded-xl font-medium"
            autoFocus
            onPressEnter={() => {
              if (editingPreset) {
                handleRenamePreset(editingPreset.id, editingPresetName);
              }
            }}
          />
        </div>
      </Modal>

      {/* Chế độ duyệt nhanh từng bài theo kiểu Tinder */}
      <Modal
        open={swipeReviewOpen}
        onCancel={() => setSwipeReviewOpen(false)}
        footer={null}
        centered
        width="min(1400px, calc(100vw - 24px))"
        className="poster-swipe-review-modal"
        destroyOnHidden
      >
        {activeSwipeItem ? (
          <div className="poster-swipe-review">
            <div className="poster-swipe-topbar">
              <div>
                <span>Duyệt nhanh bài viết</span>
                <strong>{swipeReviewIndex + 1} / {swipeReviewItems.length}</strong>
              </div>
              <Progress
                percent={Math.round(((swipeReviewIndex + 1) / Math.max(1, swipeReviewItems.length)) * 100)}
                showInfo={false}
                strokeColor="#22b8e6"
                trailColor="#223247"
                size="small"
              />
              <div className="poster-swipe-stats">
                <span className="is-kept">✓ {Object.values(swipeDecisions).filter((decision) => decision === 'KEEP').length} giữ</span>
                <span className="is-rejected">× {Object.values(swipeDecisions).filter((decision) => decision === 'REJECT').length} bỏ</span>
              </div>
            </div>

            <div className="poster-swipe-card">
              <div className="poster-swipe-media">
                <div
                  className="poster-swipe-media-stage relative group cursor-pointer"
                  onClick={() => {
                    const currentUrl = activeSwipeMediaUrls[swipeMediaIndex] || activeSwipeMediaUrls[0];
                    if (currentUrl) {
                      const kind = isMediaVideo(currentUrl, activeSwipeMediaKinds[swipeMediaIndex]) ? 'video' : 'image';
                      setMediaViewer({ url: currentUrl, kind, title: `Bài ${swipeReviewIndex + 1} - Media ${swipeMediaIndex + 1}` });
                    }
                  }}
                >
                  {activeSwipeMediaUrls.length > 0 && (
                    <div className="absolute top-2 right-2 z-10 opacity-75 group-hover:opacity-100 transition-opacity bg-slate-950/80 text-sky-300 border border-sky-500/40 text-[10px] font-bold px-2 py-1 rounded-md flex items-center gap-1 shadow-md">
                      <ZoomInOutlined /> Phóng To Tràn Màn Hình
                    </div>
                  )}
                  {activeSwipeMediaUrls.length > 0 ? (
                    isMediaVideo(activeSwipeMediaUrls[swipeMediaIndex] || activeSwipeMediaUrls[0], activeSwipeMediaKinds[swipeMediaIndex]) ? (
                      <video
                        key={activeSwipeMediaUrls[swipeMediaIndex] || activeSwipeMediaUrls[0]}
                        src={activeSwipeMediaUrls[swipeMediaIndex] || activeSwipeMediaUrls[0]}
                        controls
                        playsInline
                      />
                    ) : (
                      <img
                        src={activeSwipeMediaUrls[swipeMediaIndex] || activeSwipeMediaUrls[0]}
                        alt={`Media bài ${swipeReviewIndex + 1}`}
                      />
                    )
                  ) : activeSwipePreview?.loading ? (
                    <div className="poster-swipe-empty"><LoadingOutlined spin /> Đang tải nội dung bài...</div>
                  ) : (
                    <div className="poster-swipe-empty"><PictureOutlined /> Bài này không có ảnh hoặc video</div>
                  )}
                </div>
                {activeSwipeMediaUrls.length > 1 && (
                  <div className="poster-swipe-thumbnails">
                    {activeSwipeMediaUrls.map((mediaUrl, mediaIndex) => (
                      <button
                        type="button"
                        key={`${mediaUrl}-${mediaIndex}`}
                        className={swipeMediaIndex === mediaIndex ? 'is-active' : ''}
                        onClick={() => setSwipeMediaIndex(mediaIndex)}
                        aria-label={`Xem media ${mediaIndex + 1}`}
                      >
                        {isMediaVideo(mediaUrl, activeSwipeMediaKinds[mediaIndex]) ? (
                          <span><VideoCameraOutlined /></span>
                        ) : (
                          <img src={mediaUrl} alt="" />
                        )}
                        <b>{mediaIndex + 1}</b>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="poster-swipe-caption flex flex-col h-full">
                <div className="poster-swipe-caption-head flex items-center justify-between pb-2 border-b border-slate-800">
                  <div>
                    <span className="font-bold text-slate-100 text-sm">Bài viết {swipeReviewIndex + 1}</span>
                    <small className="text-slate-400 text-xs block">{activeSwipeMediaUrls.length} media · {activeSwipeCaption.length} ký tự</small>
                  </div>
                  <div className="flex items-center gap-2">
                    {swipeDecisions[activeSwipeItem.id] && (
                      <Tag color={swipeDecisions[activeSwipeItem.id] === 'KEEP' ? 'success' : 'error'}>
                        {swipeDecisions[activeSwipeItem.id] === 'KEEP' ? 'Đang giữ' : 'Đang bỏ'}
                      </Tag>
                    )}
                    <Tag color="purple" className="!rounded-md text-xs font-bold">
                      ✏️ Cho phép sửa trực tiếp
                    </Tag>
                  </div>
                </div>

                {/* Thanh công cụ sửa nhanh Cre / Hashtag ngay trong Modal Duyệt Nhanh */}
                <div className="flex items-center gap-1.5 flex-wrap py-2 border-b border-slate-800/60">
                  <Tooltip title="Chèn 'Cre: Member ẩn danh' vào caption bài này">
                    <Button
                      size="small"
                      type="text"
                      icon={<UserOutlined />}
                      onClick={() => {
                        const updated = replaceOrAppendCreditText(activeSwipeCaption, 'Member ẩn danh');
                        handleSwipeCaptionChange(updated);
                      }}
                      className="text-xs text-amber-400 hover:text-amber-300 bg-amber-950/40 border border-amber-800/40 rounded px-1.5"
                    >
                      + Cre: Ẩn danh
                    </Button>
                  </Tooltip>
                  <Tooltip title={activeSwipePreview?.author ? `Chèn 'Cre: ${activeSwipePreview.author}' vào caption` : "Chèn tên Tác giả gốc"}>
                    <Button
                      size="small"
                      type="text"
                      icon={<UserOutlined />}
                      onClick={() => {
                        const authorName = activeSwipePreview?.author || 'Tác giả gốc';
                        const updated = replaceOrAppendCreditText(activeSwipeCaption, authorName);
                        handleSwipeCaptionChange(updated);
                      }}
                      className="text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 border border-cyan-800/40 rounded px-1.5"
                    >
                      {activeSwipePreview?.author ? `+ Cre: ${activeSwipePreview.author}` : '+ Cre: Tác giả'}
                    </Button>
                  </Tooltip>
                  <Tooltip title="Chèn Cre tùy chỉnh">
                    <Button
                      size="small"
                      type="text"
                      icon={<EditOutlined />}
                      onClick={() => openCustomCreModal(activeSwipeItem.id)}
                      className="text-xs text-purple-400 hover:text-purple-300 bg-purple-950/40 border border-purple-800/40 rounded px-1.5"
                    >
                      + Cre Custom
                    </Button>
                  </Tooltip>
                  <Tooltip title="Chèn Hashtag vào bài này">
                    <Button
                      size="small"
                      type="text"
                      icon={<TagOutlined />}
                      onClick={() => openHashtagModal(activeSwipeItem.id)}
                      className="text-xs text-pink-400 hover:text-pink-300 bg-pink-950/40 border border-pink-800/40 rounded px-1.5"
                    >
                      + Hashtag
                    </Button>
                  </Tooltip>
                  <Tooltip title="Tự động xóa sạch toàn bộ dấu hoa thị markdown (** hoặc *) khỏi bài viết">
                    <Button
                      size="small"
                      type="text"
                      icon={<ClearOutlined className="text-amber-400" />}
                      onClick={() => {
                        const cleaned = cleanMarkdownAsterisks(activeSwipeCaption);
                        handleSwipeCaptionChange(cleaned);
                        message.success('🧹 Đã xóa sạch dấu hoa thị markdown (*)');
                      }}
                      className="text-xs text-amber-300 hover:text-amber-200 bg-amber-950/40 border border-amber-800/40 rounded px-1.5"
                    >
                      🧹 Xóa dấu *
                    </Button>
                  </Tooltip>
                  {activeSwipeItem.inputType !== 'MANUAL' && (
                    <Tooltip title="Khôi phục caption gốc từ nguồn cào">
                      <Button
                        size="small"
                        type="text"
                        icon={<RedoOutlined />}
                        onClick={() => handleSwipeCaptionChange(cleanMarkdownAsterisks(activeSwipePreview?.caption || ''))}
                        className="text-xs text-slate-400 hover:text-slate-200"
                      >
                        Gốc
                      </Button>
                    </Tooltip>
                  )}
                </div>

                {/* Ô Nhập/Sửa Caption Trực Tiếp */}
                <div className="flex-1 my-2 flex flex-col min-h-0">
                  <Input.TextArea
                    value={activeSwipeCaption}
                    onChange={(e) => handleSwipeCaptionChange(e.target.value)}
                    placeholder="Soạn hoặc sửa caption bài viết trực tiếp tại đây..."
                    autoSize={false}
                    className="w-full flex-1 !h-full min-h-[450px] sm:min-h-[500px] bg-slate-900/90 border-slate-700/80 text-slate-100 text-xs sm:text-sm p-3.5 rounded-xl focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder:text-slate-500 resize-none font-sans leading-relaxed shadow-inner"
                  />
                </div>

                {activeSwipeItem.url && (
                  <a href={activeSwipeItem.url} target="_blank" rel="noreferrer" className="poster-swipe-source mt-1">
                    <LinkOutlined /> Xem bài nguồn gốc
                  </a>
                )}
                <div className="poster-swipe-hint text-[11px] text-slate-400 mt-1">
                  💡 Bạn có thể gõ chỉnh sửa nội dung bài viết trực tiếp ở ô trên. Thay đổi được tự động lưu ngay khi bạn bấm "Giữ bài này".
                </div>
              </div>
            </div>

            <div className="poster-swipe-actions">
              <Button
                size="large"
                icon={<ArrowLeftOutlined />}
                disabled={swipeReviewIndex === 0}
                onClick={() => {
                  setSwipeReviewIndex((current) => Math.max(0, current - 1));
                  setSwipeMediaIndex(0);
                }}
                className="poster-swipe-back"
              >
                Bài trước
              </Button>
              <Button
                size="large"
                danger
                icon={<CloseOutlined />}
                onClick={() => handleSwipeDecision('REJECT')}
                className="poster-swipe-reject"
              >
                Bỏ bài này
              </Button>
              <Button
                type="primary"
                size="large"
                icon={<CheckCircleOutlined />}
                onClick={() => handleSwipeDecision('KEEP')}
                className="poster-swipe-keep"
              >
                Giữ bài này
              </Button>
            </div>
          </div>
        ) : swipeReviewItems.length === 0 ? (
          <div className="poster-swipe-complete py-10 text-center">
            <div className="text-4xl mb-3">📭</div>
            <h2 className="text-base font-bold text-slate-100">Chưa có bài viết nào trong danh sách duyệt</h2>
            <p className="text-xs text-slate-400 mb-4">Vui lòng quét và chọn bài viết từ Group hoặc dán link bài trước khi mở duyệt Tinder.</p>
            <Button type="primary" onClick={() => setSwipeReviewOpen(false)}>Đóng</Button>
          </div>
        ) : (
          <div className="poster-swipe-complete">
            <div className="poster-swipe-complete-icon"><CheckCircleOutlined /></div>
            <h2>Đã duyệt xong {swipeReviewItems.length} bài</h2>
            <p>
              Giữ <b>{Object.values(swipeDecisions).filter((decision) => decision === 'KEEP').length}</b> bài ·
              Bỏ <strong>{Object.values(swipeDecisions).filter((decision) => decision === 'REJECT').length}</strong> bài
            </p>
            <div>
              <Button onClick={() => { setSwipeReviewIndex(0); setSwipeMediaIndex(0); }}>Duyệt lại</Button>
              <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleApplySwipeReview}>
                Áp dụng lựa chọn
              </Button>
            </div>
            <small>Chỉ khi bấm “Áp dụng lựa chọn”, các bài đã chọn bỏ mới được xóa khỏi danh sách.</small>
          </div>
        )}
      </Modal>

      {/* DRAWER DÁN NHANH NHIỀU LINK */}
      <Drawer
        rootClassName="bulk-paste-drawer-root"
        title={
          <div className="bulk-paste-title">
            <span className="bulk-paste-title-icon">
              <CopyOutlined />
            </span>
            <div>
              <div className="bulk-paste-title-main">Dán link hàng loạt</div>
              <div className="bulk-paste-title-sub">Mỗi link hợp lệ sẽ trở thành một bài viết riêng</div>
            </div>
          </div>
        }
        placement="right"
        size="large"
        open={bulkModalVisible}
        onClose={() => setBulkModalVisible(false)}
        className="bulk-paste-drawer"
        styles={{
          wrapper: { width: '100vw', maxWidth: '100vw' },
          header: { background: '#0b141f', borderBottom: '1px solid #223247', padding: '14px 22px' },
          body: { background: '#07101a', padding: '18px 22px' },
          footer: { background: '#0b141f', borderTop: '1px solid #223247', padding: '11px 22px' },
        }}
        footer={
          <div className="bulk-paste-footer">
            <Button
              size="large"
              onClick={() => setBulkModalVisible(false)}
              className="bulk-paste-cancel"
            >
              Hủy
            </Button>
            <div className="bulk-paste-footer-primary">
              <span>
                <b>{bulkPasteSummary.finalUrls.length}</b> bài hợp lệ
                {bulkPasteSummary.invalidLineCount > 0 && <small> · {bulkPasteSummary.invalidLineCount} dòng lỗi</small>}
              </span>
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={bulkAutoDistributeTwoVias}
                  onChange={(e) => setBulkAutoDistributeTwoVias(e.target.checked)}
                  className="text-xs font-bold text-purple-300 select-none bg-purple-950/40 px-2.5 py-1.5 rounded-lg border border-purple-500/30"
                >
                  ⚡ Chia đều 2 Via ({twoMainViasDisplayNames || 'Song song'})
                </Checkbox>
                <Button
                  size="large"
                  icon={<ThunderboltOutlined />}
                  disabled={bulkPasteSummary.finalUrls.length === 0}
                  onClick={handleApplyAndOpenSwipeReview}
                  className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold border-none shadow-lg shadow-emerald-950/40 rounded-xl"
                  title="Duyệt từng bài theo giao diện Tinder (Giữ/Bỏ bằng phím mũi tên hoặc nút bấm)"
                >
                  ⚡ Duyệt nhanh kiểu Tinder ({bulkPasteSummary.finalUrls.length} bài)
                </Button>
                <Button
                  type="primary"
                  size="large"
                  icon={<RocketOutlined />}
                  disabled={bulkPasteSummary.finalUrls.length === 0}
                  onClick={handleApplyBulkPaste}
                  className="bulk-paste-apply"
                >
                  {bulkPasteSummary.finalUrls.length > 0
                    ? `Tạo ${bulkPasteSummary.finalUrls.length} bài & áp dụng lịch`
                    : 'Dán link để tạo bài viết'}
                </Button>
              </div>
            </div>
          </div>
        }
      >
        <div className="bulk-paste-workspace space-y-6">
          {/* BANNER THÔNG BÁO TIẾN ĐỘ CÀO DỮ LIỆU */}
          {bulkScrapeStats.total > 0 && (
            bulkScrapeStats.isDone ? (
              <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/90 via-[#06241a] to-teal-950/90 border border-emerald-500/60 shadow-xl flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center text-emerald-400 text-xl shadow-lg shrink-0">
                    <CheckCircleFilled />
                  </div>
                  <div>
                    <div className="text-base font-black text-emerald-200 flex items-center gap-2 flex-wrap">
                      <span>🎉 ĐÃ CÀO XONG TOÀN BỘ {bulkScrapeStats.total}/{bulkScrapeStats.total} BÀI VIẾT (100%)</span>
                      <Tag color="success" className="!m-0 !text-xs !font-bold">ĐÃ SẴN SÀNG</Tag>
                    </div>
                    <div className="text-xs text-emerald-300/80 mt-0.5">
                      Toàn bộ hình ảnh, video & caption đã được tải trước đầy đủ. Bạn có thể duyệt bài ngay!
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    onClick={handleApplyAndOpenSwipeReview}
                    className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-bold border-none shadow-md rounded-xl"
                  >
                    ⚡ Duyệt nhanh kiểu Tinder ngay
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-950/90 via-[#0a1a33] to-blue-950/90 border border-sky-500/40 shadow-xl flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-11 h-11 rounded-2xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-400 text-xl shadow-lg shrink-0">
                    <LoadingOutlined spin />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-black text-sky-200 flex items-center gap-2 flex-wrap">
                      <span>🔄 Đang cào dữ liệu & tải trước: {bulkScrapeStats.completed}/{bulkScrapeStats.total} bài hoàn tất ({bulkScrapeStats.percent}%)</span>
                      {bulkScrapeStats.error > 0 && (
                        <Tag color="error" className="!m-0 !text-xs !font-bold">{bulkScrapeStats.error} bài lỗi</Tag>
                      )}
                    </div>
                    <div className="text-xs text-sky-300/80 mt-0.5">
                      Đang xử lý {bulkScrapeStats.loading} bài còn lại... Quá trình chạy ngầm cực nhanh.
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Progress
                    percent={bulkScrapeStats.percent}
                    strokeColor="#38bdf8"
                    trailColor="#1e293b"
                    size="small"
                    style={{ width: 140 }}
                  />
                  <Button
                    size="small"
                    icon={<ThunderboltOutlined />}
                    onClick={handleApplyAndOpenSwipeReview}
                    className="bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 font-bold border border-sky-500/40 rounded-lg text-xs"
                  >
                    Duyệt ngay bài đã cào
                  </Button>
                </div>
              </div>
            )
          )}
          {/* BANNER CỐ ĐỊNH: MỤC TIÊU KPI HÔM NAY CHO NHÓM */}
          {currentKpiTarget && (
            <div className="bulk-paste-kpi bg-gradient-to-r from-violet-950/90 via-[#101b38] to-indigo-950/90 border border-violet-500/40 rounded-2xl p-4 sm:p-5 shadow-2xl flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 border border-violet-400/40 text-white flex items-center justify-center text-2xl shadow-lg shadow-violet-600/30 shrink-0">
                  🎯
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-black text-slate-100 flex items-center gap-2.5 flex-wrap">
                    <span>Mục tiêu KPI hôm nay:</span>
                    <span className="text-violet-300 font-extrabold underline underline-offset-4">{stripEmojiPrefix(currentKpiTarget.name)}</span>
                    <Tag color={currentKpiTarget.isFullyPublished ? 'success' : currentKpiTarget.isFullyScheduled ? 'purple' : 'error'} className="!m-0 !text-xs !font-black !px-2.5">
                      {currentKpiTarget.isFullyPublished
                        ? '✓ Đã hoàn thành'
                        : currentKpiTarget.isFullyScheduled
                          ? `⏳ Đã lên lịch đủ ${currentKpiTarget.totalPlanned}/${currentKpiTarget.targetCount} bài`
                          : `Còn thiếu ${currentKpiTarget.remainingToSchedule} bài`}
                    </Tag>
                  </div>
                  <div className="text-xs text-slate-300 mt-1 flex items-center gap-3 flex-wrap font-medium">
                    <span>Đã đăng: <strong className="text-slate-100 font-bold">{currentKpiTarget.actualCount}/{currentKpiTarget.targetCount} bài</strong></span>
                    <span>•</span>
                    <span>Đang chờ đăng: <strong className="text-violet-300 font-black text-sm">{currentKpiTarget.totalPending} bài</strong></span>
                    <span>•</span>
                    <span>Tiến độ tổng: <strong className={`font-black text-sm ${currentKpiTarget.isFullyScheduled ? 'text-emerald-400' : 'text-amber-300'}`}>{currentKpiTarget.totalPlanned}/{currentKpiTarget.targetCount} bài {currentKpiTarget.isFullyScheduled ? '(Đã lên đủ lịch! 🚀)' : `(còn thiếu ${currentKpiTarget.remainingToSchedule} bài)`}</strong></span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {currentKpiTarget.isFullyScheduled ? (
                  <span className="px-3.5 py-2 rounded-xl bg-violet-500/20 text-violet-200 border border-violet-500/40 font-extrabold text-xs flex items-center gap-2 shadow-lg">
                    <CheckCircleOutlined className="text-violet-400 text-sm" />
                    <span>✓ Đã lên lịch đủ {currentKpiTarget.totalPlanned}/{currentKpiTarget.targetCount} bài</span>
                  </span>
                ) : bulkPasteSummary.finalUrls.length >= currentKpiTarget.remainingToSchedule ? (
                  <span className="px-4 py-2 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-extrabold text-xs flex items-center gap-2 shadow-lg">
                    <CheckCircleOutlined className="text-emerald-400 text-sm" />
                    <span>✓ Đã dán đủ {bulkPasteSummary.finalUrls.length}/{currentKpiTarget.remainingToSchedule} bài bù còn thiếu! 🚀</span>
                  </span>
                ) : (
                  <span className="px-3.5 py-2 rounded-xl bg-rose-500/20 text-rose-300 border border-rose-500/40 font-extrabold text-xs flex items-center gap-2 shadow-lg animate-pulse">
                    <span>⚠️ Hãy dán thêm {currentKpiTarget.remainingToSchedule - bulkPasteSummary.finalUrls.length} link nữa để đủ KPI!</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* PHẦN 1: BẢNG ĐIỀU KHIỂN ĐẦU VÀO & CÀI ĐẶT LỊCH (2 CỘT SONG SONG TRÊN MÀN HÌNH RỘNG) */}
          <div className="bulk-paste-control-grid grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* CỘT TRÁI (xl:col-span-7): Ô DÁN LINK & THỐNG KÊ */}
            <div className="bulk-paste-links-panel xl:col-span-7 space-y-4 bg-slate-900/80 border border-slate-800/90 rounded-2xl p-5 shadow-xl">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-extrabold text-slate-100 flex items-center gap-2">
                    <span>📋</span>
                    <span>Danh sách đường dẫn (Links)</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">Dán mỗi dòng một link, hoặc dán nguyên đoạn văn bản chứa link.</div>
                </div>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text) {
                        const urls = (text.match(/https?:\/\/[^\s"'<>]+/gi) || []).map((u) => u.trim());
                        if (urls.length > 0) {
                          setBulkText((prev) => {
                            const existing = prev.trim();
                            const newLinks = urls.join('\n');
                            return existing ? `${existing}\n${newLinks}\n` : `${newLinks}\n`;
                          });
                          message.success(`Đã thêm ${urls.length} link và tự động xuống dòng!`);
                        } else {
                          setBulkText((prev) => (prev.trim() ? `${prev.trim()}\n${text.trim()}\n` : `${text.trim()}\n`));
                        }
                      }
                    } catch {
                      // Ignore
                    }
                  }}
                  className="bg-blue-600 hover:bg-blue-500 border-0 text-white font-bold text-xs rounded-xl px-3.5 py-1 shrink-0 shadow-md"
                >
                  📋 Dán từ bộ nhớ tạm
                </Button>
              </div>

              <TextArea
                rows={6}
                value={bulkText}
                onChange={(e) => {
                  const val = e.target.value;
                  // Tự động ngắt dòng nếu dán/nhập 2 link liền kề trên cùng 1 hàng
                  const autoBroken = val.replace(/(https?:\/\/[^\s"'<>]+)[ \t]+(https?:\/\/)/gi, '$1\n$2');
                  setBulkText(autoBroken);
                }}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData('text');
                  if (!pasted) return;
                  const urls = (pasted.match(/https?:\/\/[^\s"'<>]+/gi) || []).map((u) => u.trim());
                  if (urls.length > 0) {
                    e.preventDefault();
                    setBulkText((prev) => {
                      const existing = prev.trim();
                      const newLinks = urls.join('\n');
                      return existing ? `${existing}\n${newLinks}\n` : `${newLinks}\n`;
                    });
                  }
                }}
                placeholder={'https://www.facebook.com/share/p/...\nhttps://www.threads.net/@account/post/...\nhttps://www.tiktok.com/@user/video/... (hoặc vt.tiktok.com)\nhttps://www.facebook.com/reel/...'}
                className="font-mono text-xs rounded-xl p-3.5 bg-slate-950 border-slate-700/80 text-slate-100 placeholder:text-slate-600 focus:border-blue-500"
                style={{ resize: 'vertical', minHeight: 140 }}
              />

              {/* Thống kê nhanh */}
              <div className="grid grid-cols-4 gap-2.5">
                <div className="flex flex-col items-center bg-blue-500/15 border border-blue-500/30 rounded-xl p-2.5 text-center shadow-inner">
                  <span className="text-xl font-black text-blue-400">{bulkPasteSummary.finalUrls.length}</span>
                  <span className="text-[11px] font-semibold text-slate-300 leading-tight mt-0.5">Bài sẽ tạo</span>
                </div>
                <div className="flex flex-col items-center bg-slate-800/70 border border-slate-700/70 rounded-xl p-2.5 text-center">
                  <span className="text-xl font-black text-slate-200">{bulkPasteSummary.uniqueUrls.length}</span>
                  <span className="text-[11px] text-slate-400 leading-tight mt-0.5">Link unique</span>
                </div>
                <div className={`flex flex-col items-center rounded-xl p-2.5 text-center border ${bulkPasteSummary.duplicateInHistoryCount > 0 ? 'bg-amber-500/15 border-amber-500/40 shadow-inner' : 'bg-slate-800/70 border-slate-700/70'}`}>
                  <span className={`text-xl font-black ${bulkPasteSummary.duplicateInHistoryCount > 0 ? 'text-amber-300' : 'text-slate-200'}`}>{bulkPasteSummary.duplicateInHistoryCount}</span>
                  <span className="text-[11px] text-slate-400 leading-tight mt-0.5">Đã có LS</span>
                </div>
                <div className={`flex flex-col items-center rounded-xl p-2.5 text-center border ${bulkPasteSummary.invalidLineCount > 0 ? 'bg-red-500/15 border-red-500/40 shadow-inner' : 'bg-slate-800/70 border-slate-700/70'}`}>
                  <span className={`text-xl font-black ${bulkPasteSummary.invalidLineCount > 0 ? 'text-red-400' : 'text-slate-200'}`}>{bulkPasteSummary.invalidLineCount}</span>
                  <span className="text-[11px] text-slate-400 leading-tight mt-0.5">Dòng vô hiệu</span>
                </div>
              </div>

              {/* Toggle lọc link đã đăng */}
              {bulkPasteSummary.duplicateInHistoryCount > 0 && (
                <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5">
                  <div className="text-xs text-amber-300">
                    <span className="font-bold">{bulkPasteSummary.duplicateInHistoryCount} link</span> đã tồn tại trong lịch sử đăng.
                    {!filterHistoryDuplicates && <span className="text-amber-400 font-semibold"> Giữ lại để đăng lại.</span>}
                  </div>
                  <div
                    className="flex items-center gap-2 cursor-pointer"
                    onClick={() => setFilterHistoryDuplicates(!filterHistoryDuplicates)}
                  >
                    <div className={`w-9 h-5 rounded-full relative transition-colors ${filterHistoryDuplicates ? 'bg-amber-500' : 'bg-slate-700'}`}>
                      <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all shadow ${filterHistoryDuplicates ? 'right-0.5' : 'left-0.5'}`} />
                    </div>
                    <span className="text-xs font-bold text-amber-300 whitespace-nowrap">
                      {filterHistoryDuplicates ? 'Đang lọc bỏ' : 'Lọc LS'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* CỘT PHẢI (xl:col-span-5): CÀI ĐẶT THỜI GIAN & SMART SCHEDULE */}
            <div className="bulk-paste-schedule-panel xl:col-span-5 bg-slate-900/80 rounded-2xl border border-slate-800/90 overflow-hidden shadow-xl">
              {/* Header toggle Smart Schedule */}
              <div
                className="bulk-paste-schedule-head flex items-center justify-between px-4 py-3.5 cursor-pointer select-none bg-slate-850 border-b border-slate-800"
                onClick={() => setSmartScheduleEnabled(!smartScheduleEnabled)}
              >
                <div className="flex items-center gap-2.5">
                  <span className={`w-8 h-8 rounded-xl grid place-items-center text-base transition-colors ${smartScheduleEnabled ? 'bg-violet-500/30 text-violet-300' : 'bg-slate-700 text-slate-400'}`}>
                    📅
                  </span>
                  <div>
                    <div className="text-sm font-bold text-slate-100">Smart Schedule (Phân bổ giờ)</div>
                    <div className="text-[11px] text-slate-400 leading-tight">
                      {smartScheduleEnabled
                        ? 'Tự động tìm slot trống theo giới hạn bài/ngày của nhóm'
                        : 'Tắt — đang dùng cài đặt thủ công'}
                    </div>
                  </div>
                </div>
                <div className={`w-10 h-6 rounded-full relative transition-colors shrink-0 ${smartScheduleEnabled ? 'bg-violet-500' : 'bg-slate-700'}`}>
                  <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all shadow ${smartScheduleEnabled ? 'right-0.5' : 'left-0.5'}`} />
                </div>
              </div>

              {/* Smart Schedule body */}
              {smartScheduleEnabled ? (
                <div className="p-4 space-y-3.5">
                  {/* Chọn nhóm & Giới hạn */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs font-bold text-slate-300 mb-1.5">Nhóm target:</div>
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="Chọn nhóm..."
                        value={smartGroupId || undefined}
                        onChange={(val) => {
                          setSmartGroupId(val);
                          setSmartDailyLimit(getGroupDailyLimit(val));
                        }}
                        className="w-full rounded-xl font-medium"
                        options={groupAccountsWithId.map((g) => ({
                          value: g.platformAccountId,
                          label: `${stripEmojiPrefix(g.pageName)} (${g.platformAccountId})`,
                        }))}
                      />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-300 mb-1.5">Giới hạn bài/ngày:</div>
                      <Select
                        value={smartDailyLimit}
                        onChange={(val) => {
                          setSmartDailyLimit(val);
                          if (smartGroupId) saveGroupDailyLimit(smartGroupId, val);
                        }}
                        className="w-full rounded-xl font-medium"
                        options={[
                          { value: 5, label: '5 bài/ngày' },
                          { value: 8, label: '8 bài/ngày' },
                          { value: 10, label: '10 bài/ngày (mặc định)' },
                          { value: 12, label: '12 bài/ngày' },
                          { value: 15, label: '15 bài/ngày' },
                          { value: 20, label: '20 bài/ngày' },
                          { value: 30, label: '30 bài/ngày' },
                        ]}
                      />
                    </div>
                  </div>

                  {/* Live preview slot analysis */}
                  {smartGroupId && bulkPasteSummary.finalUrls.length > 0 && (() => {
                    const intervalMins = Math.floor((24 * 60) / smartDailyLimit);
                    const pendingForGroup = (posts || []).filter((p) => {
                      if (p.status !== 'PENDING' && p.status !== 'PROCESSING') return false;
                      const raw = (p.targetGroupNames || '').replace(/^GROUP_ONLY_ANON:|^GROUP_ONLY:/, '');
                      return raw.split(',').map((v) => v.trim()).includes(smartGroupId);
                    });
                    const byDay = new Map<string, number>();
                    pendingForGroup.forEach((p) => {
                      const d = dayjs(p.scheduledAt).format('DD/MM (ddd)');
                      byDay.set(d, (byDay.get(d) || 0) + 1);
                    });
                    const byDayNew = new Map<string, number>();
                    smartScheduleTimes.forEach((t) => {
                      const d = t.format('DD/MM (ddd)');
                      byDayNew.set(d, (byDayNew.get(d) || 0) + 1);
                    });

                    return (
                      <div className="space-y-2.5">
                        {smartScheduleTimes.length > 0 ? (
                          <div className="bg-violet-950/40 rounded-xl p-3.5 border border-violet-500/30 space-y-2.5">
                            <div className="text-xs font-extrabold text-violet-300 uppercase tracking-wider flex items-center justify-between">
                              <span>✨ {bulkPasteSummary.finalUrls.length} bài sẽ được xếp vào:</span>
                              <span className="text-[10px] text-slate-400 font-normal">Cách ~{intervalMins}p</span>
                            </div>

                            <div className="flex flex-wrap gap-1.5">
                              {Array.from(byDayNew.entries()).map(([day, count]) => (
                                <span key={day} className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-bold bg-violet-500/25 text-violet-200 border border-violet-500/40 shadow-sm">
                                  📅 {day} <span className="font-black text-amber-300">+{count} bài</span>
                                </span>
                              ))}
                            </div>

                            {/* Chi tiết từng slot giờ có thể chỉnh sửa trực tiếp */}
                            <div className="pt-2 border-t border-violet-500/25">
                              <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 mb-2">
                                <span>⏰ Danh sách giờ hẹn (Click để tự đổi giờ):</span>
                                <span className="text-[10px] text-violet-400 font-normal">Tự động lưu khi đổi</span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                                {bulkPasteSummary.finalUrls.map((url, idx) => {
                                  const defaultTime = smartScheduleTimes[idx] || dayjs().add((idx + 1) * 15, 'minute');
                                  const effectiveTime = customDrawerScheduledTimes[url] || defaultTime;
                                  return (
                                    <div
                                      key={url}
                                      className="bg-[#0b1222] border border-violet-500/40 hover:border-violet-400 rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-2 text-xs shadow-sm transition-all"
                                    >
                                      <span className="font-black text-violet-300 shrink-0">Bài #{idx + 1}</span>
                                      <DatePicker
                                        showTime
                                        size="small"
                                        format="HH:mm DD/MM/YYYY"
                                        allowClear={false}
                                        value={effectiveTime}
                                        onChange={(val) => {
                                          if (val) {
                                            setCustomDrawerScheduledTimes((prev) => ({ ...prev, [url]: val }));
                                          }
                                        }}
                                        className="bg-slate-900 border-violet-500/50 text-amber-300 font-mono font-bold text-xs rounded-lg !w-44 !py-0.5"
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-red-950/30 border border-red-500/30 rounded-lg p-3 text-xs text-red-300">
                            ⚠️ Không tìm thấy slot trống trong 30 ngày tới với giới hạn {smartDailyLimit} bài/ngày.
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {!smartGroupId && (
                    <div className="text-xs text-slate-500 text-center py-3 bg-slate-950/40 rounded-xl border border-slate-800">
                      ← Chọn nhóm ở trên để tự động phân tích lịch
                    </div>
                  )}
                </div>
              ) : (
                /* Manual / Distribution mode */
                <div className="p-4 space-y-3.5">
                  <div>
                    <div className="text-xs font-bold text-slate-300 mb-2 flex items-center justify-between">
                      <span>⚙️ Chế độ chia lịch đăng:</span>
                      {bulkScheduleMode === 'WINDOW' && bulkPasteSummary.finalUrls.length > 1 && (
                        <Tag color="cyan" className="!m-0 text-xs font-semibold">
                          ⚡ Tự động chia đều ~{Math.round(
                            (bulkWindowEndTime.hour() * 60 + bulkWindowEndTime.minute() - (bulkWindowStartTime.hour() * 60 + bulkWindowStartTime.minute()) + (bulkWindowEndTime.isBefore(bulkWindowStartTime) ? 1440 : 0)) / Math.max(1, bulkPasteSummary.finalUrls.length - 1)
                          )} phút / bài
                        </Tag>
                      )}
                    </div>
                    <Segmented
                      block
                      value={bulkScheduleMode}
                      onChange={(val) => setBulkScheduleMode(val as 'WINDOW' | 'INTERVAL' | 'NOW')}
                      options={[
                        { label: '🎯 Chia đều khung giờ (Từ - Đến)', value: 'WINDOW' },
                        { label: '⏱️ Giãn cách cố định', value: 'INTERVAL' },
                        { label: '⚡ Đăng ngay', value: 'NOW' },
                      ]}
                      className="mb-3 bg-slate-950/80 p-1 border border-slate-700/80 text-xs"
                    />
                  </div>

                  {bulkScheduleMode === 'WINDOW' && (
                    <div className="bg-slate-950/50 p-3.5 rounded-xl border border-slate-800 space-y-3">
                      {/* Nút bấm chọn nhanh Khung Giờ Vàng */}
                      <div className="flex items-center gap-1.5 flex-wrap pb-2 border-b border-slate-800/80">
                        <span className="text-[11px] text-slate-400 font-semibold">🌟 Khung giờ chuẩn:</span>
                        <button
                          type="button"
                          onClick={() => {
                            setBulkWindowStartTime(dayjs().hour(9).minute(0).second(0));
                            setBulkWindowEndTime(dayjs().hour(18).minute(0).second(0));
                          }}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700 cursor-pointer transition-all"
                        >
                          💼 Hành chính (09:00 - 18:00)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setBulkWindowStartTime(dayjs().hour(8).minute(30).second(0));
                            setBulkWindowEndTime(dayjs().hour(22).minute(0).second(0));
                          }}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 cursor-pointer transition-all"
                        >
                          🌟 Giờ vàng cả ngày (08:30 - 22:00)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setBulkWindowStartTime(dayjs().hour(11).minute(30).second(0));
                            setBulkWindowEndTime(dayjs().hour(23).minute(0).second(0));
                          }}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 cursor-pointer transition-all"
                        >
                          🌙 Trưa & Tối (11:30 - 23:00)
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <div className="text-[11px] font-bold text-slate-400 mb-1 flex items-center justify-between">
                            <span>📅 Ngày bắt đầu:</span>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => setBulkWindowDate(dayjs())}
                                className="text-[10px] text-blue-400 hover:underline cursor-pointer"
                              >Hôm nay</button>
                              <span className="text-slate-600">|</span>
                              <button
                                type="button"
                                onClick={() => setBulkWindowDate(dayjs().add(1, 'day'))}
                                className="text-[10px] text-blue-400 hover:underline cursor-pointer"
                              >Ngày mai</button>
                            </div>
                          </div>
                          <DatePicker
                            value={bulkWindowDate}
                            onChange={(val) => val && setBulkWindowDate(val)}
                            format="DD/MM/YYYY"
                            allowClear={false}
                            className="w-full rounded-xl"
                          />
                        </div>
                        <div>
                          <div className="text-[11px] font-bold text-slate-400 mb-1">
                            ⏰ Giờ bắt đầu (Start):
                          </div>
                          <TimePicker
                            value={bulkWindowStartTime}
                            onChange={(val) => val && setBulkWindowStartTime(val)}
                            format="HH:mm"
                            minuteStep={5}
                            allowClear={false}
                            className="w-full rounded-xl"
                          />
                        </div>
                        <div>
                          <div className="text-[11px] font-bold text-slate-400 mb-1">
                            🏁 Giờ kết thúc (Hạn chót):
                          </div>
                          <TimePicker
                            value={bulkWindowEndTime}
                            onChange={(val) => val && setBulkWindowEndTime(val)}
                            format="HH:mm"
                            minuteStep={5}
                            allowClear={false}
                            className="w-full rounded-xl"
                          />
                        </div>
                      </div>

                      {/* Tùy chọn chia nhiều ngày nếu danh sách bài lớn */}
                      <div className="flex items-center justify-between gap-3 bg-slate-900/80 p-2.5 rounded-xl border border-slate-800 text-xs flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-300">📅 Rải sang nhiều ngày:</span>
                          <Select
                            size="small"
                            value={bulkWindowMaxPerDay}
                            onChange={(val) => setBulkWindowMaxPerDay(val)}
                            className="w-56 font-bold"
                            options={[
                              { value: -1, label: '✨ Tự động chống dồn (Khuyên dùng)' },
                              { value: 0, label: 'Đăng hết trong 1 ngày' },
                              { value: 3, label: 'Tối đa 3 bài / ngày' },
                              { value: 5, label: 'Tối đa 5 bài / ngày' },
                              { value: 8, label: 'Tối đa 8 bài / ngày' },
                              { value: 10, label: 'Tối đa 10 bài / ngày' },
                              { value: 15, label: 'Tối đa 15 bài / ngày' },
                              { value: 20, label: 'Tối đa 20 bài / ngày' },
                            ]}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-300">⏱️ Giãn cách tối thiểu:</span>
                          <Select
                            size="small"
                            value={desiredMinInterval}
                            onChange={(val) => setDesiredMinInterval(val)}
                            className="w-32 font-bold"
                            options={[
                              { value: 15, label: '≥ 15 phút' },
                              { value: 20, label: '≥ 20 phút' },
                              { value: 30, label: '≥ 30 phút (Chuẩn)' },
                              { value: 45, label: '≥ 45 phút' },
                              { value: 60, label: '≥ 1 giờ' },
                              { value: 120, label: '≥ 2 giờ' },
                            ]}
                          />
                        </div>
                      </div>

                      <div className="text-[11px] text-slate-300 bg-blue-500/10 border border-blue-500/20 rounded-lg p-2.5 flex items-center justify-between">
                        <span>
                          💡 Rải <b>{bulkPasteSummary.finalUrls.length} bài</b> từ <b>{bulkWindowStartTime.format('HH:mm')}</b> đến <b>{bulkWindowEndTime.format('HH:mm')}</b>
                          {bulkWindowMaxPerDay === -1
                            ? ` (Tự động chống dồn: giãn cách an toàn ≥ ${desiredMinInterval} phút/bài, tự tràn ngày tiếp theo nếu dày)`
                            : bulkWindowMaxPerDay > 0
                              ? ` (Tối đa ${bulkWindowMaxPerDay} bài/ngày → ${Math.ceil(bulkPasteSummary.finalUrls.length / bulkWindowMaxPerDay)} ngày)`
                              : ` ngày ${bulkWindowDate.format('DD/MM/YYYY')} (giãn cách an toàn ≥ ${desiredMinInterval} phút)`}.
                        </span>
                      </div>
                    </div>
                  )}

                  {bulkScheduleMode === 'INTERVAL' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/50 p-3.5 rounded-xl border border-slate-800">
                      <div>
                        <div className="text-[11px] font-bold text-slate-400 mb-1">Thời điểm bắt đầu:</div>
                        <DatePicker
                          showTime
                          format="HH:mm DD/MM/YYYY"
                          value={bulkStartTime}
                          onChange={(val) => val && setBulkStartTime(val)}
                          className="w-full rounded-xl"
                        />
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-slate-400 mb-1">Mỗi bài sau cách nhau:</div>
                        <Select
                          value={bulkInterval}
                          onChange={(val) => setBulkInterval(val)}
                          className="w-full rounded-xl font-medium"
                          options={[
                            { value: 5, label: '5 phút' },
                            { value: 10, label: '10 phút' },
                            { value: 15, label: '15 phút' },
                            { value: 20, label: '20 phút' },
                            { value: 30, label: '30 phút' },
                            { value: 45, label: '45 phút' },
                            { value: 60, label: '1 giờ' },
                            { value: 120, label: '2 giờ' },
                          ]}
                        />
                      </div>
                    </div>
                  )}

                  {bulkScheduleMode === 'NOW' && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-300">
                      ⚡ Bài viết đầu tiên sẽ được đưa vào xuất bản ngay lập tức, các bài tiếp theo giãn cách mỗi {bulkInterval} phút.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* PHẦN 2: KIỂM SOÁT CHI TIẾT CÁC BÀI VIẾT (FULL WIDTH RỘNG RÃI TRẢI DÀI) */}
          {bulkPasteSummary.uniqueUrls.length > 0 && (
            <div className="bulk-paste-posts rounded-2xl border border-slate-700/80 overflow-hidden bg-slate-900/90 shadow-2xl">
              <div className="bulk-paste-posts-head px-6 py-4 bg-slate-800/90 border-b border-slate-700/80 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <span className="text-base font-black text-slate-100">Kiểm soát chi tiết các bài viết ({bulkPasteSummary.finalUrls.length} bài)</span>
                  <Tag color="blue" className="!m-0 !text-xs font-bold px-2.5 py-0.5">{bulkPasteSummary.finalUrls.length} bài hợp lệ</Tag>
                  {bulkScrapeStats.isDone ? (
                    <Tag color="success" className="!m-0 !text-xs font-bold px-2.5 py-0.5">✓ 100% Đã cào xong</Tag>
                  ) : (
                    <Tag color="processing" className="!m-0 !text-xs font-bold px-2.5 py-0.5">⏳ Đang cào ({bulkScrapeStats.completed}/{bulkScrapeStats.total})</Tag>
                  )}
                  {bulkPasteSummary.duplicateInHistoryCount > 0 && (
                    <Tag color="warning" className="!m-0 !text-xs font-bold">{bulkPasteSummary.duplicateInHistoryCount} bài đã có LS</Tag>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="middle"
                    icon={<ThunderboltOutlined />}
                    onClick={handleApplyAndOpenSwipeReview}
                    className="!text-xs !h-9 !px-3.5 border-emerald-500/50 text-emerald-300 bg-emerald-500/20 hover:bg-emerald-500/30 rounded-xl font-bold"
                  >
                    ⚡ Duyệt Tinder
                  </Button>
                  <Button
                    size="middle"
                    icon={<EyeOutlined />}
                    onClick={fetchAllDrawerPreviews}
                    className="!text-xs !h-9 !px-4 border-blue-500/50 text-blue-300 bg-blue-500/20 hover:bg-blue-500/30 rounded-xl font-bold"
                  >
                    🔄 Tải lại tất cả ảnh/video
                  </Button>
                </div>
              </div>

              <div className="bulk-paste-post-list max-h-[75vh] overflow-y-auto divide-y divide-slate-800/80 bg-[#070d19] p-4 sm:p-6 space-y-6">
                {bulkPasteSummary.uniqueUrls.map((url, index) => {
                  const isInHistory = bulkPasteSummary.historyMatchedUrls.includes(url);
                  const isFiltered = filterHistoryDuplicates && isInHistory;
                  const posInFinal = bulkPasteSummary.finalUrls.indexOf(url);
                  const preview = bulkDrawerPreviews[url];
                  const hasMedia = (preview?.mediaUrls?.length || 0) > 0;
                  const rawMedia = preview?.mediaUrls || [];
                  const originalMedia = preview?.originalMediaUrls || [];
                  const hasCustomMedia = rawMedia.length !== originalMedia.length || rawMedia.some((u, i) => u !== originalMedia[i]);
                  const isVideo = (u: string, idx: number) => isMediaVideo(u, preview?.mediaKinds?.[idx]);
                  const videoUrls = rawMedia.filter((u, i) => isVideo(u, i));
                  const photoUrls = rawMedia.filter((u, i) => !isVideo(u, i));
                  const isSkipComment = !!preview?.skipComment;
                  const isCredit = preview?.includeCredit !== false;

                  // Tính toán thời gian dự kiến đăng bài này
                  const calculatedDefaultTime = (() => {
                    if (posInFinal < 0 || isFiltered) return null;
                    if (smartScheduleEnabled && smartGroupId && smartScheduleTimes.length > posInFinal) {
                      return smartScheduleTimes[posInFinal];
                    }
                    if (bulkScheduleMode === 'WINDOW') {
                      const times = computeTimeWindowSchedule(
                        bulkWindowDate,
                        bulkWindowStartTime,
                        bulkWindowEndTime,
                        bulkPasteSummary.finalUrls.length,
                        bulkWindowMaxPerDay,
                        desiredMinInterval
                      );
                      return times[posInFinal] || null;
                    }
                    if (bulkScheduleMode === 'NOW') {
                      const isFirstImmediate = posInFinal === 0 && !isInHistory;
                      if (isFirstImmediate) return dayjs();
                      return dayjs().add(posInFinal * bulkInterval, 'minute');
                    }
                    return bulkStartTime.add(posInFinal * bulkInterval, 'minute');
                  })();

                  const effectiveScheduledTime = customDrawerScheduledTimes[url] || calculatedDefaultTime;

                  return (
                    <div
                      key={url}
                      className={`bulk-paste-post-card p-5 sm:p-6 rounded-2xl border transition-all ${isFiltered
                        ? 'opacity-35 bg-slate-900/30 border-slate-800'
                        : isInHistory
                          ? 'bg-[#0d1627] border-amber-500/40 shadow-xl'
                          : 'bg-[#0d1627] border-slate-700/80 shadow-xl'
                        }`}
                    >
                      {/* HEADER CHI TIẾT BÀI VIẾT */}
                      <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800 flex-wrap">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className={`w-9 h-9 rounded-2xl grid place-items-center text-sm font-black shrink-0 ${isInHistory ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-rose-500 text-white shadow-lg'
                            }`}>
                            #{posInFinal >= 0 ? posInFinal + 1 : index + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-3 flex-wrap mb-1.5">
                              <span className="text-base font-bold text-slate-100 truncate max-w-md">
                                {preview?.caption ? preview.caption.slice(0, 100) : `Bài viết #${posInFinal >= 0 ? posInFinal + 1 : index + 1}`}
                              </span>
                              {effectiveScheduledTime && (
                                <div className="flex items-center gap-1.5 bg-indigo-950/70 border border-indigo-500/40 hover:border-indigo-400 rounded-xl px-2.5 py-1 shadow-sm transition-colors">
                                  <ClockCircleOutlined className="text-indigo-400 text-xs" />
                                  <span className="text-[11px] font-bold text-indigo-300">Hẹn giờ:</span>
                                  <DatePicker
                                    showTime
                                    size="small"
                                    format="HH:mm DD/MM/YYYY"
                                    allowClear={false}
                                    value={effectiveScheduledTime}
                                    onChange={(val) => {
                                      if (val) {
                                        setCustomDrawerScheduledTimes((prev) => ({ ...prev, [url]: val }));
                                      }
                                    }}
                                    className="bg-slate-900 border-indigo-500/50 text-amber-300 font-mono font-bold text-xs rounded-lg !w-44 !py-0.5"
                                  />
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-slate-400 font-mono flex-wrap">
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:underline truncate max-w-md"
                                title={url}
                              >
                                🔗 {url}
                              </a>
                              {isInHistory && <Tag color="warning" className="!m-0 !text-[10px] font-bold">⚠️ ĐÃ CÓ TRONG LỊCH SỬ</Tag>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {preview?.caption && (
                            <Button
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => {
                                navigator.clipboard.writeText(preview.caption || '');
                                message.success('Đã sao chép caption!');
                              }}
                              className="text-xs bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 rounded-lg"
                            >
                              Sao chép Caption
                            </Button>
                          )}
                          <Button
                            type="text"
                            size="small"
                            icon={<ReloadOutlined className="text-slate-400 text-xs" />}
                            onClick={() => {
                              setBulkDrawerPreviews((prev) => ({ ...prev, [url]: { loading: false } }));
                              setTimeout(() => fetchOneDrawerPreview(url), 50);
                            }}
                            title="Cào lại link này"
                            className="!w-8 !h-8 !p-0 grid place-items-center rounded-lg hover:bg-slate-800 text-slate-400"
                          />
                          <Button
                            type="text"
                            danger
                            size="small"
                            icon={<DeleteOutlined className="text-xs" />}
                            onClick={() => removeUrlFromBulkText(url)}
                            title="Xóa link này khỏi đợt dán"
                            className="!w-8 !h-8 !p-0 grid place-items-center rounded-lg hover:bg-red-500/20 text-red-400"
                          />
                        </div>
                      </div>

                      {/* Trạng thái đang tải */}
                      {preview?.loading && (
                        <div className="my-5 p-6 rounded-2xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-center gap-3 text-blue-300 text-sm font-semibold">
                          <LoadingOutlined className="text-xl" spin />
                          Đang cào dữ liệu và tải trước hình ảnh, video & caption...
                        </div>
                      )}

                      {/* Lỗi cào */}
                      {preview?.error && !preview.loading && (
                        <div className="my-5 p-4 rounded-2xl bg-red-500/10 border border-red-500/25 flex items-center justify-between gap-2 text-red-300 text-xs">
                          <span>⚠️ {preview.error}</span>
                          <Button
                            size="small"
                            onClick={() => fetchOneDrawerPreview(url)}
                            className="text-xs bg-red-500/20 text-red-300 border-red-500/40 rounded-lg font-bold"
                          >
                            Thử lại
                          </Button>
                        </div>
                      )}

                      {/* NỘI DUNG CHI TIẾT THEO CÁC MỤC DỌC (GIỐNG HỆT MODAL XEM CHI TIẾT) */}
                      {!preview?.loading && (
                        <div className="mt-5 space-y-6">
                          {/* ── MỤC 1: VIDEO & HÌNH ẢNH ĐÍNH KÈM ── */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="w-1 h-4 bg-rose-500 rounded-full inline-block" />
                                <span className="text-xs font-black tracking-wider text-rose-400 uppercase">
                                  VIDEO & HÌNH ẢNH ĐÍNH KÈM
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                {videoUrls.length > 0 && (
                                  <Tag color="purple" className="!m-0 !text-xs !font-bold !px-2.5 !py-0.5">🎥 {videoUrls.length} Video</Tag>
                                )}
                                {photoUrls.length > 0 && (
                                  <Tag color="blue" className="!m-0 !text-xs !font-bold !px-2.5 !py-0.5">🖼️ {photoUrls.length} Ảnh</Tag>
                                )}
                                {(url.includes('tiktok.com') || preview?.watermarkRemoved) && (
                                  <Tag color="green" className="!m-0 !text-xs !font-bold !px-2.5 !py-0.5 !text-emerald-300 !bg-emerald-950/80 !border-emerald-500/50">
                                    ✨ Sạch Logo TikTok
                                  </Tag>
                                )}
                              </div>
                            </div>

                            <div className="p-4 sm:p-5 rounded-2xl bg-[#060b14] border border-slate-800/90 space-y-5">
                              {/* Thanh khôi phục nếu đã chỉnh sửa/xóa bớt media */}
                              {hasCustomMedia && (
                                <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-xl px-3.5 py-2">
                                  <span className="text-xs text-amber-300 font-medium">
                                    ⚠️ Bạn đã chỉnh sửa/xóa bớt video hoặc hình ảnh của bài này.
                                  </span>
                                  <Button
                                    size="small"
                                    type="link"
                                    onClick={() => resetDrawerMedia(url)}
                                    className="!text-xs !text-amber-400 hover:!text-amber-300 !p-0 font-bold underline"
                                  >
                                    Khôi phục media gốc
                                  </Button>
                                </div>
                              )}

                              {/* Danh sách Video Player */}
                              {videoUrls.map((vUrl, vIdx) => {
                                const mediaIdx = rawMedia.indexOf(vUrl);
                                return (
                                  <div key={vIdx} className="space-y-2">
                                    <div className="flex items-center justify-between text-xs text-slate-400">
                                      <span className="font-bold text-purple-300 flex items-center gap-1.5">
                                        🎥 Video đính kèm {videoUrls.length > 1 ? `#${vIdx + 1}` : ''}:
                                      </span>
                                      <Button
                                        size="small"
                                        danger
                                        icon={<DeleteOutlined className="text-xs" />}
                                        onClick={() => removeDrawerMedia(url, mediaIdx)}
                                        className="!text-xs bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 rounded-lg font-bold flex items-center gap-1 !h-7 !px-3"
                                      >
                                        Xóa video này
                                      </Button>
                                    </div>
                                    <div className="relative rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-2xl flex justify-center items-center">
                                      <video
                                        controls
                                        src={vUrl}
                                        className="w-full max-h-[420px] object-contain bg-black"
                                        preload="metadata"
                                      />
                                    </div>
                                  </div>
                                );
                              })}

                              {/* Album ảnh */}
                              {photoUrls.length > 0 && (
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between text-xs text-slate-400">
                                    <span className="font-bold text-slate-300">📄 Album ảnh đính kèm:</span>
                                    <span className="text-[11px] text-slate-500">(Click vào ảnh để phóng to toàn màn hình)</span>
                                  </div>

                                  <Image.PreviewGroup>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                                      {photoUrls.map((imgSrc, imgIdx) => {
                                        const mediaIdx = rawMedia.indexOf(imgSrc);
                                        return (
                                          <div
                                            key={imgIdx}
                                            className="relative rounded-2xl overflow-hidden border border-slate-700/80 bg-slate-950 aspect-square group shadow-md"
                                          >
                                            <Image
                                              src={imgSrc}
                                              alt={`Ảnh ${imgIdx + 1}`}
                                              className="!w-full !h-full !object-cover cursor-pointer"
                                            />

                                            {/* Tag Ảnh Bìa */}
                                            {imgIdx === 0 && (
                                              <span className="absolute top-1.5 left-1.5 bg-rose-600/90 text-white text-[10px] font-black px-2 py-0.5 rounded-lg shadow-lg pointer-events-none">
                                                #1 Bìa
                                              </span>
                                            )}

                                            {/* Bộ công cụ đổi thứ tự ảnh khi hover */}
                                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-1.5 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                                              <div className="flex items-center gap-1">
                                                {imgIdx > 0 && (
                                                  <button
                                                    type="button"
                                                    onClick={() => moveDrawerMedia(url, mediaIdx, rawMedia.indexOf(photoUrls[imgIdx - 1]))}
                                                    className="w-6 h-6 rounded-lg bg-slate-800/90 hover:bg-blue-600 text-white text-xs grid place-items-center cursor-pointer border-0 shadow"
                                                    title="Đưa lên trước"
                                                  >
                                                    ←
                                                  </button>
                                                )}
                                                {imgIdx < photoUrls.length - 1 && (
                                                  <button
                                                    type="button"
                                                    onClick={() => moveDrawerMedia(url, mediaIdx, rawMedia.indexOf(photoUrls[imgIdx + 1]))}
                                                    className="w-6 h-6 rounded-lg bg-slate-800/90 hover:bg-blue-600 text-white text-xs grid place-items-center cursor-pointer border-0 shadow"
                                                    title="Đưa ra sau"
                                                  >
                                                    →
                                                  </button>
                                                )}
                                              </div>
                                              <button
                                                type="button"
                                                onClick={() => removeDrawerMedia(url, mediaIdx)}
                                                className="w-6 h-6 rounded-lg bg-red-600/80 hover:bg-red-600 text-white text-xs grid place-items-center cursor-pointer border-0 shadow"
                                                title="Xóa ảnh này"
                                              >
                                                ✕
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </Image.PreviewGroup>
                                </div>
                              )}

                              {!hasMedia && !preview?.error && (
                                <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 text-center text-xs text-slate-500">
                                  📄 Bài viết dạng văn bản thuần (không có video hoặc hình ảnh).
                                </div>
                              )}
                            </div>
                          </div>

                          {/* ── MỤC 2: NỘI DUNG CAPTION BÀI VIẾT ── */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="w-1 h-4 bg-rose-500 rounded-full inline-block" />
                                <span className="text-xs font-black tracking-wider text-rose-400 uppercase">
                                  NỘI DUNG CAPTION BÀI VIẾT
                                </span>
                              </div>
                              <span className="text-xs text-slate-400 font-mono">
                                {preview?.caption?.length || 0} ký tự
                              </span>
                            </div>

                            <div className="p-4 sm:p-5 rounded-2xl bg-[#060b14] border border-slate-800/90 space-y-3">
                              <TextArea
                                autoSize={{ minRows: 4, maxRows: 12 }}
                                value={preview?.caption || ''}
                                onChange={(e) => updateDrawerPreviewCaption(url, e.target.value)}
                                placeholder="Chưa cào được caption hoặc bài viết không có text..."
                                className="bg-transparent border-0 text-slate-100 text-sm font-sans focus:shadow-none p-0 leading-relaxed placeholder:text-slate-600"
                              />

                              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-3 flex-wrap">
                                <Checkbox
                                  checked={isCredit}
                                  onChange={() => toggleDrawerCredit(url)}
                                  className="text-xs font-semibold text-slate-300"
                                >
                                  📌 Nguồn bài viết: Tự động gắn "Cre: @tác giả" vào cuối caption
                                </Checkbox>
                              </div>
                            </div>
                          </div>

                          {/* ── MỤC 3: BÌNH LUẬN TỰ ĐỘNG & TIẾP THỊ LIÊN KẾT ── */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="w-1 h-4 bg-amber-500 rounded-full inline-block" />
                                <span className="text-xs font-black tracking-wider text-amber-400 uppercase">
                                  BÌNH LUẬN TỰ ĐỘNG & TIẾP THỊ LIÊN KẾT
                                </span>
                              </div>
                              <Checkbox
                                checked={isSkipComment}
                                onChange={() => toggleDrawerSkipComment(url)}
                                className="text-xs text-red-400 font-bold"
                              >
                                🚫 Tắt bình luận bài này
                              </Checkbox>
                            </div>

                            {!isSkipComment && (
                              <div className="p-4 rounded-2xl bg-[#060b14] border border-slate-800/90">
                                <Input
                                  value={preview?.affiliateComment || ''}
                                  onChange={(e) => updateDrawerComment(url, e.target.value)}
                                  placeholder="Mặc định dùng bình luận chung của hệ thống (hoặc nhập riêng link Shopee/bình luận cho bài này)..."
                                  className="bg-slate-950 border-slate-800 text-slate-100 text-xs rounded-xl p-3 placeholder:text-slate-600"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Drawer>


      {/* Modal Đổi giờ đăng cho 1 bài đang Chờ đăng trong Lịch sử */}
      <Modal
        title="🗓️ Đổi Ngày Giờ Đăng Bài"
        open={!!reschedulingPost}
        onCancel={() => setReschedulingPost(null)}
        onOk={() => {
          if (reschedulingPost && newScheduleTime) {
            rescheduleMutation.mutate({
              id: reschedulingPost.id,
              scheduledAt: newScheduleTime.format('YYYY-MM-DDTHH:mm:ss'),
            });
          }
        }}
        confirmLoading={rescheduleMutation.isPending}
        okText="Lưu giờ mới"
        cancelText="Huỷ"
        width={680}
        className="max-w-[calc(100vw-24px)]"
      >
        <div className="py-3 space-y-3">
          <Text className="text-xs text-slate-600 block">
            Chọn ngày giờ đăng mới cho bài <b>"{reschedulingPost?.title || `#${reschedulingPost?.id}`}"</b>:
          </Text>
          <DatePicker
            showTime
            format="HH:mm DD/MM/YYYY"
            value={newScheduleTime}
            onChange={(val) => setNewScheduleTime(val)}
            className="w-full rounded-xl"
            size="large"
            disabledDate={(current) => current && current < dayjs().startOf('day')}
          />
        </div>
      </Modal>

      <NewsCardModal
        open={!!newsCardTarget}
        source={newsCardTarget?.source || null}
        onClose={() => setNewsCardTarget(null)}
        onApply={(url) => applyNewsCardToItem(url)}
      />

      {/* Modal Tự Động Phân Bổ & Chia Lại Giờ Hàng Đợi */}
      <Modal
        title={
          <div className="flex items-center gap-2.5 text-base font-bold text-slate-100">
            <span className="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/30 flex items-center justify-center shrink-0">
              <ClockCircleOutlined className="text-base" />
            </span>
            <span>Phân Bổ Khung Giờ Hàng Đợi ({rescheduleTargetPosts.length} bài)</span>
          </div>
        }
        open={bulkRescheduleModalVisible}
        onCancel={() => setBulkRescheduleModalVisible(false)}
        onOk={handleApplyBulkReschedule}
        confirmLoading={isBulkProcessing}
        okText={`Áp dụng phân bổ (${rescheduleTargetPosts.length} bài)`}
        cancelText="Hủy"
        width={960}
        style={{ top: 20 }}
        styles={{
          body: {
            maxHeight: 'calc(100vh - 160px)',
            overflowY: 'auto',
            paddingRight: 8,
          },
        }}
        className="max-w-[calc(100vw-32px)]"
      >
        <div className="py-2 space-y-4 text-xs">
          {/* 1. Chọn phạm vi áp dụng */}
          <div className="bg-slate-900/70 p-3.5 rounded-2xl border border-slate-800 space-y-2">
            <div className="font-semibold text-slate-300">Phạm vi bài viết áp dụng:</div>
            <Segmented
              block
              value={bulkRescheduleTargetScope}
              onChange={(val) => setBulkRescheduleTargetScope(val as 'ALL' | 'SELECTED')}
              options={[
                {
                  label: `Tất cả bài đang chờ (${(posts || []).filter((p) => p.status === 'PENDING').length} bài)`,
                  value: 'ALL',
                },
                {
                  label: `Chỉ các bài đã chọn (${selectedRowKeys.length} bài)`,
                  value: 'SELECTED',
                  disabled: selectedRowKeys.length === 0,
                },
              ]}
              className="bg-slate-950/80 p-1 border border-slate-700/80 font-medium"
            />
          </div>

          {/* 2. Chọn chế độ phân bổ & thời gian */}
          <div className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800 space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-200">Chế độ phân bổ thời gian:</div>
              {bulkRescheduleMode !== 'INTERVAL' && reschedulePreviewList.length > 1 && (
                <span className="px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30">
                  ~{reschedulePreviewStats.avgGap} phút / bài · {reschedulePreviewStats.days} ngày
                </span>
              )}
            </div>

            <Segmented
              block
              value={bulkRescheduleMode}
              onChange={(val) => setBulkRescheduleMode(val as 'WINDOW' | 'INTERVAL' | 'VIRAL')}
              options={[
                { label: 'Chia đều trong khung giờ', value: 'WINDOW' },
                { label: 'Giờ vàng Viral (Tập trung giờ cao điểm)', value: 'VIRAL' },
                { label: 'Giãn cách cố định', value: 'INTERVAL' },
              ]}
              className="bg-slate-950/80 p-1 border border-slate-700/80 font-medium"
            />

            {bulkRescheduleMode !== 'INTERVAL' ? (
              <div className="space-y-3.5 pt-1">
                {bulkRescheduleMode === 'VIRAL' && (
                  <div className="text-[11px] text-slate-400 bg-slate-950/70 p-3 rounded-xl border border-slate-800 leading-relaxed">
                    Tập trung bài vào các khung giờ vàng có lưu lượng truy cập cao (trưa 11:00 – 13:00, tối 19:00 – 22:00) và giãn cách thưa hơn ở giờ thấp điểm. Hệ thống tự động xếp xoay vòng cho các nhóm và tạo độ lệch tự nhiên.
                  </div>
                )}

                {/* Nút bấm chọn nhanh Khung Giờ */}
                <div className="flex items-center gap-2 flex-wrap pb-2.5 border-b border-slate-800/80">
                  <span className="text-[11px] text-slate-400 font-medium">Khung giờ gợi ý:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkRescheduleDate(dayjs());
                      setBulkRescheduleStartTime(dayjs());
                      if (dayjs().hour() >= 18) {
                        setBulkRescheduleEndTime(dayjs().hour(23).minute(0).second(0));
                      }
                    }}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 cursor-pointer transition-all flex items-center gap-1"
                  >
                    <ClockCircleOutlined className="text-[10px]" /> Từ giờ hiện tại ({dayjs().format('HH:mm')})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkRescheduleStartTime(dayjs().hour(9).minute(0).second(0));
                      setBulkRescheduleEndTime(dayjs().hour(18).minute(0).second(0));
                    }}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer transition-all"
                  >
                    Hành chính (09:00 – 18:00)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkRescheduleStartTime(dayjs().hour(8).minute(30).second(0));
                      setBulkRescheduleEndTime(dayjs().hour(22).minute(0).second(0));
                    }}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer transition-all"
                  >
                    Giờ vàng cả ngày (08:30 – 22:00)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkRescheduleStartTime(dayjs().hour(11).minute(30).second(0));
                      setBulkRescheduleEndTime(dayjs().hour(23).minute(0).second(0));
                    }}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer transition-all"
                  >
                    Trưa & tối (11:30 – 23:00)
                  </button>
                  {bulkRescheduleMode === 'VIRAL' && (
                    <button
                      type="button"
                      onClick={() => {
                        setBulkRescheduleStartTime(dayjs().hour(6).minute(30).second(0));
                        setBulkRescheduleEndTime(dayjs().hour(23).minute(30).second(0));
                      }}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer transition-all"
                    >
                      Toàn bộ ngày (06:30 – 23:30)
                    </button>
                  )}
                </div>

                {/* 3 Cột: Ngày bắt đầu, Giờ bắt đầu, Giờ kết thúc */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                    <div className="font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                      <span>Ngày bắt đầu:</span>
                      <div className="flex gap-1.5 font-normal">
                        <button
                          type="button"
                          onClick={() => setBulkRescheduleDate(dayjs())}
                          className="text-[11px] text-blue-400 hover:underline cursor-pointer"
                        >Hôm nay</button>
                        <span className="text-slate-600">|</span>
                        <button
                          type="button"
                          onClick={() => setBulkRescheduleDate(dayjs().add(1, 'day'))}
                          className="text-[11px] text-blue-400 hover:underline cursor-pointer"
                        >Ngày mai</button>
                      </div>
                    </div>
                    <DatePicker
                      value={bulkRescheduleDate}
                      onChange={(val) => val && setBulkRescheduleDate(val)}
                      format="DD/MM/YYYY"
                      allowClear={false}
                      className="w-full rounded-xl"
                    />
                  </div>
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                    <div className="font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                      <span>Giờ bắt đầu:</span>
                      <button
                        type="button"
                        onClick={() => setBulkRescheduleStartTime(dayjs())}
                        className="text-[11px] text-emerald-400 hover:underline cursor-pointer font-semibold"
                      >
                        Lấy giờ hiện tại
                      </button>
                    </div>
                    <TimePicker
                      value={bulkRescheduleStartTime}
                      onChange={(val) => val && setBulkRescheduleStartTime(val)}
                      format="HH:mm"
                      minuteStep={5}
                      allowClear={false}
                      className="w-full rounded-xl"
                    />
                  </div>
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                    <div className="font-semibold text-slate-300 mb-1.5">
                      Giờ kết thúc:
                    </div>
                    <TimePicker
                      value={bulkRescheduleEndTime}
                      onChange={(val) => val && setBulkRescheduleEndTime(val)}
                      format="HH:mm"
                      minuteStep={5}
                      allowClear={false}
                      className="w-full rounded-xl"
                    />
                  </div>
                </div>

                {bulkRescheduleMode === 'VIRAL' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                    <div>
                      <div className="text-[11px] font-semibold text-slate-400 mb-1">Tối đa bài / group / ngày:</div>
                      <InputNumber
                        min={1}
                        max={50}
                        value={viralMaxPerTargetPerDay}
                        onChange={(v) => setViralMaxPerTargetPerDay(Number(v) || 1)}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold text-slate-400 mb-1">Giãn cách cùng group (phút):</div>
                      <InputNumber
                        min={10}
                        max={600}
                        step={5}
                        value={viralMinGapPerTarget}
                        onChange={(v) => setViralMinGapPerTarget(Number(v) || 10)}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold text-slate-400 mb-1">Giãn cách 2 bài bất kỳ (phút):</div>
                      <InputNumber
                        min={3}
                        max={120}
                        value={viralMinGapGlobal}
                        onChange={(v) => setViralMinGapGlobal(Number(v) || 3)}
                        className="w-full"
                      />
                    </div>
                    <div className="sm:col-span-3 flex items-center justify-between gap-2 pt-1 border-t border-slate-800">
                      <Checkbox checked={viralJitter} onChange={(e) => setViralJitter(e.target.checked)} className="text-xs text-slate-300">
                        Lệch giờ ngẫu nhiên ±4 phút (tránh giờ tròn đều)
                      </Checkbox>
                      <button
                        type="button"
                        onClick={() => setViralSeed(Date.now())}
                        className="text-[11px] text-blue-400 hover:underline cursor-pointer"
                      >
                        Xáo lại giờ lệch
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                      <div>
                        <span className="font-semibold text-slate-300">Rải sang nhiều ngày:</span>
                        <div className="text-[11px] text-slate-400">Tránh dồn quá tải trong 1 ngày</div>
                      </div>
                      <Select
                        size="middle"
                        value={bulkRescheduleMaxPerDay}
                        onChange={(val) => setBulkRescheduleMaxPerDay(val)}
                        className="w-56 font-medium"
                        options={[
                          { value: -1, label: 'Tự động rải đều (Khuyên dùng)' },
                          { value: 0, label: 'Đăng hết trong ngày' },
                          { value: 5, label: 'Tối đa 5 bài / ngày' },
                          { value: 10, label: 'Tối đa 10 bài / ngày' },
                          { value: 15, label: 'Tối đa 15 bài / ngày' },
                          { value: 20, label: 'Tối đa 20 bài / ngày' },
                          { value: 30, label: 'Tối đa 30 bài / ngày' },
                        ]}
                      />
                    </div>
                    {bulkRescheduleMaxPerDay === -1 ? (
                      <div className="flex items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                        <div>
                          <span className="font-semibold text-slate-300">Giãn cách an toàn:</span>
                          <div className="text-[11px] text-slate-400">Khoảng cách giữa các bài</div>
                        </div>
                        <Select
                          size="middle"
                          value={desiredMinInterval}
                          onChange={(val) => setDesiredMinInterval(val)}
                          className="w-40 font-medium"
                          options={[
                            { value: 15, label: '15 phút / bài' },
                            { value: 20, label: '20 phút / bài' },
                            { value: 30, label: '30 phút (Chuẩn)' },
                            { value: 45, label: '45 phút / bài' },
                            { value: 60, label: '1 giờ / bài' },
                            { value: 120, label: '2 giờ / bài' },
                          ]}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                        <div>
                          <span className="font-semibold text-slate-300">Khoảng cách tối thiểu:</span>
                          <div className="text-[11px] text-slate-400">Giữa 2 bài liên tiếp</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <InputNumber
                            min={1}
                            max={180}
                            value={bulkRescheduleSameDayGap}
                            onChange={(v) => setBulkRescheduleSameDayGap(Number(v) || 8)}
                            className="w-20"
                          />
                          <Button
                            size="small"
                            type="dashed"
                            className="text-[11px] px-2 bg-slate-800 hover:bg-slate-700 text-blue-300 border-blue-500/40"
                            onClick={() => {
                              const avail = Math.max(60, bulkRescheduleEndTime.hour(23).minute(30).diff(bulkRescheduleStartTime, 'minute'));
                              const fit = Math.max(1, Math.floor(avail / Math.max(1, rescheduleTargetPosts.length - 1)));
                              setBulkRescheduleSameDayGap(fit);
                            }}
                          >
                            Vừa khít
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                  <div className="font-semibold text-slate-300 mb-1.5">Bắt đầu từ:</div>
                  <DatePicker
                    showTime
                    format="HH:mm DD/MM/YYYY"
                    value={bulkRescheduleStartTime}
                    onChange={(val) => val && setBulkRescheduleStartTime(val)}
                    className="w-full rounded-xl"
                  />
                </div>
                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                  <div className="font-semibold text-slate-300 mb-1.5">Mỗi bài cách nhau:</div>
                  <Select
                    value={bulkRescheduleInterval}
                    onChange={(val) => setBulkRescheduleInterval(val)}
                    className="w-full rounded-xl font-medium"
                    options={[
                      { value: 5, label: '5 phút' },
                      { value: 10, label: '10 phút' },
                      { value: 15, label: '15 phút' },
                      { value: 20, label: '20 phút' },
                      { value: 30, label: '30 phút' },
                      { value: 45, label: '45 phút' },
                      { value: 60, label: '1 giờ' },
                      { value: 120, label: '2 giờ' },
                    ]}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 3. Tùy chọn nâng cao trong 2 cột cân đối */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {/* Cột trái: Đan xen Page & Group */}
            <div className="bg-slate-900/70 p-3.5 rounded-2xl border border-slate-800 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold text-slate-200 flex items-center gap-2">
                    <ShareAltOutlined className="text-blue-400" />
                    <span>Đan xen Page & Group</span>
                  </div>
                  <Checkbox
                    checked={bulkRescheduleInterleave}
                    onChange={(e) => setBulkRescheduleInterleave(e.target.checked)}
                    className="text-xs text-blue-300 font-semibold"
                  >
                    Bật đan xen
                  </Checkbox>
                </div>
                <div className="text-[11px] text-slate-400 leading-relaxed">
                  Tự động xếp vòng tròn xen kẽ giữa các Page và Group để tránh tình trạng cùng một kênh bị đăng nhiều bài sát nhau.
                </div>
              </div>
            </div>

            {/* Cột phải: Chia đều Nick / Via */}
            <div className="bg-slate-900/70 p-3.5 rounded-2xl border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-slate-200 flex items-center gap-2">
                  <UserOutlined className="text-purple-400" />
                  <span>Chia đều cho nhiều Nick / Via</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="small"
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    onClick={() => {
                      setBulkRescheduleDistributeNicks(true);
                      setBulkRescheduleSelectedNicks(twoMainViasTargetValues);
                      message.success(`Đã chọn chia đều qua 2 Via chính: ${twoMainViasDisplayNames}!`);
                    }}
                    className="bg-purple-600 hover:bg-purple-500 font-semibold text-xs rounded-lg h-7"
                  >
                    Chia 2 Via nhanh
                  </Button>
                  <Checkbox
                    checked={bulkRescheduleDistributeNicks}
                    onChange={(e) => setBulkRescheduleDistributeNicks(e.target.checked)}
                    className="text-xs text-purple-300 font-semibold"
                  >
                    Bật
                  </Checkbox>
                </div>
              </div>
              <div className="text-[11px] text-slate-400">
                Xoay vòng chia {rescheduleTargetPosts.length} bài qua các Nick đã chọn để đăng song song, chống checkpoint Facebook.
              </div>
              {bulkRescheduleDistributeNicks && (
                <div className="pt-1.5 space-y-1.5 border-t border-slate-800">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Danh sách Via được chia:</span>
                    <Space size="small">
                      <button
                        type="button"
                        className="text-xs text-purple-400 font-semibold hover:underline cursor-pointer"
                        onClick={() => setBulkRescheduleSelectedNicks(twoMainViasTargetValues)}
                      >
                        2 Via chính
                      </button>
                      <span className="text-slate-600">|</span>
                      <button
                        type="button"
                        className="text-xs text-blue-400 hover:underline cursor-pointer"
                        onClick={() => setBulkRescheduleSelectedNicks(validPersonalVias.map((a) => accountTargetValue(a)))}
                      >
                        Tất cả Via ({validPersonalVias.length})
                      </button>
                    </Space>
                  </div>
                  <Select
                    mode="multiple"
                    placeholder="Chọn các Nick / Via để chia đều bài đăng..."
                    value={bulkRescheduleSelectedNicks}
                    onChange={(vals) => setBulkRescheduleSelectedNicks(vals)}
                    className="w-full"
                    options={postingIdentities.map((acc) => ({
                      label: `${acc.pageName || acc.platformAccountId} (${acc.accountType || acc.platform})`,
                      value: accountTargetValue(acc),
                    }))}
                    maxTagCount="responsive"
                  />
                </div>
              )}
            </div>
          </div>

          {/* 4. Bảng xem trước lịch đăng mới */}
          <div className="bg-slate-900/70 rounded-2xl border border-slate-800 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
              <span className="flex items-center gap-2">
                <ScheduleOutlined className="text-blue-400" />
                <span>Xem trước kết quả phân bổ ({reschedulePreviewList.length} bài):</span>
              </span>
              <span className="text-slate-400 font-normal text-[11px]">
                {bulkRescheduleMode !== 'INTERVAL'
                  ? `Từ ${bulkRescheduleStartTime.format('HH:mm')} đến ${bulkRescheduleEndTime.format('HH:mm')} mỗi ngày, bắt đầu ${bulkRescheduleDate.format('DD/MM/YYYY')}`
                  : `Bắt đầu từ ${bulkRescheduleStartTime.format('HH:mm DD/MM/YYYY')}`}
              </span>
            </div>

            {reschedulePreviewList.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                Không có bài viết nào đang chờ để phân bổ.
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto divide-y divide-slate-800/60 rounded-xl border border-slate-800/80 bg-slate-950/70">
                {reschedulePreviewList.map((item, idx) => {
                  const post = item.post;
                  const oldTimeStr = post.scheduledAt ? dayjs(post.scheduledAt).format('HH:mm DD/MM') : 'Đăng ngay';
                  const newTimeStr = item.newTime ? item.newTime.format('HH:mm DD/MM/YYYY') : '';
                  return (
                    <div key={post.id} className="p-2.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-800/40 transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="w-6 h-6 rounded-lg bg-slate-800/90 text-slate-300 font-mono font-bold text-[11px] grid place-items-center shrink-0 border border-slate-700/60">
                          #{idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-slate-200 truncate">
                            {post.content || post.title || (post.targetGroupNames ? `Đăng vào: ${post.targetGroupNames}` : `Bài viết #${post.id}`)}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate flex items-center gap-2 mt-0.5">
                            <span>{post.targetGroupNames ? (post.targetGroupNames.replace(/^GROUP_ONLY_ANON:|^GROUP_ONLY:/, '')) : (post.targetFanpageId ? `Fanpage ID: ${post.targetFanpageId}` : 'Facebook')}</span>
                            {item.assignedNickName && (
                              <Tag color="purple" className="!m-0 text-[10px] font-semibold">
                                {item.assignedNickName}
                              </Tag>
                            )}
                            <span className="text-slate-600">•</span>
                            <span className="line-through text-slate-500">Cũ: {oldTimeStr}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="px-2.5 py-1 rounded-lg font-mono font-bold text-xs bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          {newTimeStr}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Modal Chuyển toàn bộ bài lỗi về Chờ đăng (Reset Failed to Pending) */}
      <Modal
        title={
          <div className="flex items-center gap-2.5 text-base">
            <span className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <ThunderboltOutlined />
            </span>
            <span className="font-bold text-slate-100">
              Chuyển {postCounts.failed} bài lỗi về Chờ đăng (Hẹn giờ an toàn)
            </span>
          </div>
        }
        open={resetFailedModalVisible}
        onCancel={() => setResetFailedModalVisible(false)}
        onOk={handleResetFailedBatch}
        confirmLoading={isBulkProcessing}
        okText={`Kích hoạt ${postCounts.failed} bài chờ đăng`}
        cancelText="Hủy"
        width={560}
        className="max-w-[calc(100vw-24px)]"
      >
        <div className="py-2 space-y-4">
          <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 text-xs text-slate-300">
            Hệ thống sẽ xóa thông báo lỗi cũ, đặt lại số lần thử = 0, xóa dấu vết lỗi Group cũ và tự động phân bổ lại lịch đăng an toàn:
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-300">Chọn chế độ phân bổ lịch đăng:</div>
            <Segmented
              block
              value={resetFailedMode}
              onChange={(val) => setResetFailedMode(val as any)}
              options={[
                {
                  label: '⏱️ Giãn cách an toàn (~75s)',
                  value: 'STAGGER',
                },
                {
                  label: '🌙 Xong trước 23h hôm nay',
                  value: 'TODAY_23H',
                },
                {
                  label: '⚡ Bắt đầu ngay',
                  value: 'NOW',
                },
              ]}
            />
          </div>

          {resetFailedMode === 'STAGGER' && (
            <div className="p-3.5 bg-slate-900/60 rounded-xl border border-slate-800 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-slate-200">Khoảng cách giữa các bài:</div>
                <div className="text-[11px] text-slate-400">Rải đều thời gian giữa các bài đăng lại để chống dồn dập, bảo vệ an toàn cho Page/Group.</div>
              </div>
              <Select
                value={resetFailedSpacing}
                onChange={setResetFailedSpacing}
                className="w-36 rounded-xl font-bold"
                options={[
                  { value: 300, label: '5 phút' },
                  { value: 600, label: '10 phút' },
                  { value: 900, label: '15 phút (Chuẩn)' },
                  { value: 1800, label: '30 phút' },
                  { value: 3600, label: '1 giờ' },
                ]}
              />
            </div>
          )}

          {resetFailedMode === 'TODAY_23H' && (
            <div className="p-3.5 bg-indigo-950/40 border border-indigo-500/30 rounded-xl text-xs text-indigo-200">
              🎯 Hệ thống sẽ tự động tính toán tổng thời gian từ bây giờ đến <b>22:55 tối nay</b> và chia đều khoảng cách giữa các bài viết, đảm bảo toàn bộ bài đều được xuất bản trước 23h hôm nay!
            </div>
          )}

          {resetFailedMode === 'NOW' && (
            <div className="p-3.5 bg-amber-950/40 border border-amber-500/30 rounded-xl text-xs text-amber-200">
              ⚡ Toàn bộ bài lỗi sẽ được chuyển sang hàng đợi và bắt đầu đăng ngay lập tức (giãn cách siêu ngắn ~15s).
            </div>
          )}
        </div>
      </Modal>

      {/* Modal Đặt/sửa KPI hôm nay cho Fanpage & từng Group */}
      <Modal
        title={
          <span className="flex items-center gap-2 text-base">
            <span className="w-8 h-8 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">
              <AimOutlined />
            </span>
            Đặt KPI hôm nay — {dayjs().format('DD/MM/YYYY')}
          </span>
        }
        open={kpiModalOpen}
        onCancel={() => setKpiModalOpen(false)}
        onOk={handleSaveKpi}
        confirmLoading={setTargetMutation.isPending}
        okText="Lưu KPI"
        cancelText="Huỷ"
        width={860}
        className="max-w-[calc(100vw-24px)]"
        styles={{ body: { paddingTop: 4 } }}
      >
        <Text className="text-xs text-slate-500 block mb-3">
          Đặt số bài mục tiêu cần đăng hôm nay cho Fanpage và từng Group. Để trống hoặc 0 để bỏ mục tiêu.
        </Text>

        {kpiFanpageAccounts.length === 0 && kpiGroupAccounts.length === 0 ? (
          <Empty description="Chưa có Fanpage/Group nào được kết nối" />
        ) : (
          <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-5">
            {kpiFanpageAccounts.length > 0 && (
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <FacebookFilled className="text-blue-600" /> Fanpage
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {kpiFanpageAccounts.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                      <div className="min-w-0">
                        <span className="font-bold text-xs text-slate-800 block truncate">{a.pageName || `#${a.id}`}</span>
                        <span className="text-[10px] text-slate-400 font-mono">ID kết nối: {a.id}</span>
                      </div>
                      <InputNumber
                        min={0}
                        value={kpiDrafts[a.id] ?? null}
                        onChange={(val) => setKpiDrafts((prev) => ({ ...prev, [a.id]: val }))}
                        placeholder="0"
                        className="w-20 shrink-0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {kpiGroupAccounts.length > 0 && (
              <div>
                <Divider className="!my-3" />
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                    <TeamOutlined className="text-purple-600" /> Group
                  </div>
                </div>

                {kpiGroupAccounts.length > 1 && (
                  <div className="flex flex-wrap items-center gap-2 p-3 mb-3 rounded-xl border border-dashed border-purple-300 bg-purple-50/60">
                    <ThunderboltOutlined className="text-purple-600" />
                    <span className="text-[11px] font-semibold text-purple-700 shrink-0">Áp dụng nhanh cho tất cả Group:</span>
                    <Select
                      size="small"
                      placeholder="Chọn Fanpage"
                      value={bulkGroupFanpageId}
                      onChange={setBulkGroupFanpageId}
                      className="w-40"
                      options={kpiFanpageAccounts.map((fp) => ({ value: fp.id, label: fp.pageName || `#${fp.id}` }))}
                    />
                    <Button
                      size="small"
                      type="primary"
                      disabled={!bulkGroupFanpageId}
                      loading={bulkGroupApplying}
                      onClick={applyBulkGroupIdentity}
                    >
                      Áp dụng
                    </Button>
                  </div>
                )}

                <div className="grid sm:grid-cols-2 gap-2">
                  {kpiGroupAccounts.map((a) => {
                    const identity = groupIdentityMap.get(a.id);
                    return (
                      <div key={a.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <span className="font-bold text-xs text-slate-800 block truncate">{a.pageName || `#${a.id}`}</span>
                            <span className="text-[10px] text-slate-400 font-mono">ID kết nối: {a.id}</span>
                          </div>
                          <InputNumber
                            min={0}
                            value={kpiDrafts[a.id] ?? null}
                            onChange={(val) => setKpiDrafts((prev) => ({ ...prev, [a.id]: val }))}
                            placeholder="0"
                            className="w-20 shrink-0"
                          />
                        </div>
                        <Select
                          size="small"
                          placeholder="Chọn Fanpage mặc định để đăng vào Group này"
                          value={identity?.id ?? undefined}
                          onChange={(val) => setGroupIdentityMutation.mutate({ groupId: a.id, fanpageConnectionId: val ?? null })}
                          allowClear
                          loading={setGroupIdentityMutation.isPending}
                          className="w-full"
                          options={kpiFanpageAccounts.map((fp) => ({ value: fp.id, label: fp.pageName || `#${fp.id}` }))}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {workspaceTab === 'history' && <PostingWindowPanel />}

      {/* BẢNG LỊCH SỬ ĐĂNG BÀI VỚI BỘ LỌC THÔNG MINH */}
      <Card
        className="poster-history-card border border-slate-700/60 bg-slate-900/90 shadow-lg rounded-2xl overflow-hidden backdrop-blur-md"
        style={workspaceTab === 'history' ? undefined : { display: 'none' }}
        styles={{ body: { display: historyOpen ? 'block' : 'none', padding: '16px 20px 20px' } }}
        title={
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 text-blue-400 flex items-center justify-center font-bold text-sm shrink-0 border border-blue-500/30 shadow-sm shadow-blue-950/40">
                <HistoryOutlined />
              </div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="font-bold text-base text-slate-100 tracking-tight">Lịch sử & Hàng đợi bài đăng</span>
                <span className="px-2.5 py-0.5 rounded-lg bg-blue-500/15 text-blue-300 font-mono text-xs font-semibold border border-blue-400/30 shadow-2xs">
                  {(filteredHistoryPosts?.length || 0).toLocaleString()} / {(posts?.length || 0).toLocaleString()} bài
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {postCounts.pending > 0 && (
                <Popconfirm
                  title="Dồn hàng đợi chạy liên tục"
                  description={`Xếp lại giờ ${postCounts.pending} bài đang chờ: mỗi nick đăng nối tiếp từ bây giờ, nghỉ ${queueGapMinutes} phút/bài, các nick chạy song song. Giờ hẹn hiện tại sẽ được thay.`}
                  onConfirm={handlePackQueueContinuous}
                  okText="Dồn ngay"
                  cancelText="Hủy"
                >
                  <Button
                    size="small"
                    icon={<ThunderboltOutlined className="text-amber-400" />}
                    loading={packingQueue}
                    className="bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border-slate-700/80 rounded-xl text-xs font-semibold h-8 px-3.5 shadow-xs transition-all hover:border-slate-600"
                  >
                    Dồn hàng đợi chạy liên tục
                  </Button>
                </Popconfirm>
              )}
              {postCounts.failed > 0 && (
                <>
                  <Button
                    size="small"
                    icon={<ThunderboltOutlined />}
                    loading={isBulkProcessing}
                    onClick={() => setResetFailedModalVisible(true)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl h-8 px-3 border-none shadow-xs flex items-center gap-1.5 transition-all"
                  >
                    Chuyển về Chờ đăng ({postCounts.failed})
                  </Button>

                  <Popconfirm
                    title="Xác nhận đăng lại tất cả bài lỗi"
                    description={`Bạn có chắc muốn kích hoạt xuất bản lại cho toàn bộ ${postCounts.failed} bài viết bị lỗi?`}
                    onConfirm={handleRetryAllFailed}
                    okText="Đăng lại tất cả"
                    cancelText="Hủy"
                  >
                    <Button
                      size="small"
                      type="primary"
                      icon={<RedoOutlined />}
                      loading={isBulkProcessing}
                      className="bg-blue-600 hover:bg-blue-500 text-xs font-bold rounded-xl h-8 px-3 border-none shadow-xs transition-all"
                    >
                      Đăng lại tất cả bài lỗi ({postCounts.failed})
                    </Button>
                  </Popconfirm>

                  <Popconfirm
                    title="Xác nhận xóa tất cả bài lỗi vĩnh viễn"
                    description={`Bạn có chắc muốn xóa VĨNH VIỄN toàn bộ ${postCounts.failed} bài viết bị lỗi khỏi CSDL?`}
                    onConfirm={handleDeleteAllFailed}
                    okText="Xóa hết"
                    cancelText="Hủy"
                    okButtonProps={{ danger: true }}
                  >
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      loading={isBulkProcessing}
                      className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold rounded-xl h-8 px-3 transition-all"
                    >
                      Xóa tất cả bài lỗi ({postCounts.failed})
                    </Button>
                  </Popconfirm>
                </>
              )}
              {postCounts.pending > 0 && (
                <Button
                  size="small"
                  icon={<ClockCircleOutlined className="text-indigo-400" />}
                  onClick={() => {
                    setBulkRescheduleTargetScope(selectedRowKeys.length > 0 ? 'SELECTED' : 'ALL');
                    setBulkRescheduleModalVisible(true);
                  }}
                  className="bg-indigo-950/50 hover:bg-indigo-900/60 text-indigo-200 border-indigo-500/40 rounded-xl text-xs font-bold h-8 px-3.5 shadow-sm shadow-indigo-950/40 transition-all hover:scale-[1.02]"
                >
                  Phân bổ khung giờ ({postCounts.pending})
                </Button>
              )}
              <Button
                size="small"
                onClick={() => setHistoryOpen((open) => !open)}
                className="bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border-slate-700/80 rounded-xl text-xs font-semibold h-8 px-3 transition-all"
              >
                {historyOpen ? 'Thu gọn' : 'Xem lịch sử'}
              </Button>
            </div>
          </div>
        }
      >
        {/* THANH THAO TÁC HÀNG LOẠT GỌN GÀNG, THẲNG HÀNG */}
        {selectedRowKeys.length > 0 && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-4 py-2.5 mb-4 rounded-2xl bg-slate-900/95 border border-slate-700/80 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-2.5 text-xs">
              <span className="px-2.5 py-1 rounded-lg font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                Đã chọn {selectedRowKeys.length} bài
              </span>
              <span className="hidden sm:inline text-slate-400 font-medium">Thao tác hàng loạt:</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="small"
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={isBulkProcessing}
                onClick={handleBulkPublishNow}
                className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl h-8 px-3.5 border-none shadow-sm transition-all"
              >
                Đăng ngay tất cả
              </Button>

              <Button
                size="small"
                icon={<ScheduleOutlined />}
                disabled={isBulkProcessing}
                onClick={() => {
                  setBulkRescheduleTargetScope(selectedRowKeys.length > 0 ? 'SELECTED' : 'ALL');
                  setBulkRescheduleModalVisible(true);
                }}
                className="bg-slate-800/90 hover:bg-slate-700/90 text-slate-200 border border-slate-700 font-medium text-xs rounded-xl h-8 px-3 transition-all"
              >
                Chia lại giờ
              </Button>

              <Popconfirm
                title="Xác nhận xóa hàng loạt"
                description={`Bạn có chắc muốn xóa ${selectedRowKeys.length} bài viết này khỏi hàng đợi?`}
                onConfirm={handleBulkDelete}
                okText="Xóa luôn"
                cancelText="Hủy"
                okButtonProps={{ danger: true }}
              >
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  loading={isBulkProcessing}
                  className="bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 font-medium text-xs rounded-xl h-8 px-3 transition-all"
                >
                  Xóa đã chọn
                </Button>
              </Popconfirm>

              <Button
                size="small"
                type="text"
                icon={<CloseOutlined />}
                onClick={() => setSelectedRowKeys([])}
                className="text-slate-400 hover:text-white text-xs h-8 px-2.5 transition-all"
              >
                Bỏ chọn
              </Button>
            </div>
          </div>
        )}

        {/* THANH BỘ LỌC TRẠNG THÁI CHÍNH (SEGMENTED TABS) - RÕ RÀNG, ĐẦY ĐỦ MÀU SẮC DỄ NHÌN */}
        <div className="p-1.5 mb-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 shadow-inner flex flex-wrap items-center gap-2 backdrop-blur-md">
          {/* 1. Tất cả (Xanh lam) */}
          <button
            type="button"
            onClick={() => setHistoryStatusFilter('ALL')}
            className={`history-status-tab px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer ${
              historyStatusFilter === 'ALL'
                ? 'bg-blue-600/35 border-blue-500 text-blue-100 shadow-md shadow-blue-950/60 ring-2 ring-blue-500/40'
                : 'bg-blue-950/30 border-blue-500/25 text-blue-300 hover:bg-blue-900/45 hover:text-white hover:border-blue-400/50'
            }`}
          >
            <AppstoreOutlined className="text-blue-400 text-sm" />
            <span>Tất cả</span>
            <span
              className={`px-2 py-0.5 text-[11px] rounded-full font-mono font-bold transition-colors ${
                historyStatusFilter === 'ALL'
                  ? 'bg-blue-500/40 text-blue-100 border border-blue-300/40 shadow-xs'
                  : 'bg-blue-900/50 text-blue-300 border border-blue-500/30'
              }`}
            >
              {postCounts.all.toLocaleString()}
            </span>
          </button>

          {/* 2. Đang đăng (Tím / Indigo) */}
          <button
            type="button"
            onClick={() => setHistoryStatusFilter('PROCESSING')}
            className={`history-status-tab px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer ${
              historyStatusFilter === 'PROCESSING'
                ? 'bg-purple-600/35 border-purple-500 text-purple-100 shadow-md shadow-purple-950/60 ring-2 ring-purple-500/40'
                : 'bg-purple-950/30 border-purple-500/25 text-purple-300 hover:bg-purple-900/45 hover:text-white hover:border-purple-400/50'
            }`}
          >
            <SyncOutlined spin={postCounts.processing > 0} className="text-purple-400 text-sm" />
            <span>Đang đăng</span>
            <span
              className={`px-2 py-0.5 text-[11px] rounded-full font-mono font-bold transition-colors ${
                historyStatusFilter === 'PROCESSING'
                  ? 'bg-purple-500/40 text-purple-100 border border-purple-300/40 shadow-xs'
                  : 'bg-purple-900/50 text-purple-300 border border-purple-500/30'
              }`}
            >
              {postCounts.processing.toLocaleString()}
            </span>
          </button>

          {/* 3. Chờ đăng (Hổ phách / Vàng cam ấm áp) */}
          <button
            type="button"
            onClick={() => setHistoryStatusFilter('PENDING')}
            className={`history-status-tab px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer ${
              historyStatusFilter === 'PENDING'
                ? 'bg-amber-600/35 border-amber-500 text-amber-100 shadow-md shadow-amber-950/60 ring-2 ring-amber-500/40'
                : 'bg-amber-950/35 border-amber-500/35 text-amber-300 hover:bg-amber-900/50 hover:text-white hover:border-amber-400/60'
            }`}
          >
            <ClockCircleOutlined className="text-amber-400 text-sm" />
            <span>Chờ đăng</span>
            <span
              className={`px-2 py-0.5 text-[11px] rounded-full font-mono font-bold transition-colors ${
                historyStatusFilter === 'PENDING'
                  ? 'bg-amber-500/40 text-amber-100 border border-amber-300/50 shadow-xs'
                  : 'bg-amber-900/60 text-amber-200 border border-amber-500/40'
              }`}
            >
              {postCounts.pending.toLocaleString()}
            </span>
          </button>

          {/* 4. Đã đăng (Xanh lục Emerald nổi bật) */}
          <button
            type="button"
            onClick={() => setHistoryStatusFilter('PUBLISHED')}
            className={`history-status-tab px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer ${
              historyStatusFilter === 'PUBLISHED'
                ? 'bg-emerald-600/35 border-emerald-500 text-emerald-100 shadow-md shadow-emerald-950/60 ring-2 ring-emerald-500/40'
                : 'bg-emerald-950/35 border-emerald-500/35 text-emerald-300 hover:bg-emerald-900/50 hover:text-white hover:border-emerald-400/60'
            }`}
          >
            <CheckCircleOutlined className="text-emerald-400 text-sm" />
            <span>Đã đăng</span>
            <span
              className={`px-2 py-0.5 text-[11px] rounded-full font-mono font-bold transition-colors ${
                historyStatusFilter === 'PUBLISHED'
                  ? 'bg-emerald-500/40 text-emerald-100 border border-emerald-300/50 shadow-xs'
                  : 'bg-emerald-900/60 text-emerald-200 border border-emerald-500/40'
              }`}
            >
              {postCounts.published.toLocaleString()}
            </span>
          </button>

          {/* 5. Lỗi đăng (Đỏ Rose cảnh báo) */}
          <button
            type="button"
            onClick={() => setHistoryStatusFilter('FAILED')}
            className={`history-status-tab px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer ${
              historyStatusFilter === 'FAILED'
                ? 'bg-rose-600/35 border-rose-500 text-rose-100 shadow-md shadow-rose-950/60 ring-2 ring-rose-500/40'
                : 'bg-rose-950/30 border-rose-500/30 text-rose-300 hover:bg-rose-900/45 hover:text-white hover:border-rose-400/50'
            }`}
          >
            <CloseCircleOutlined className="text-rose-400 text-sm" />
            <span>Lỗi đăng</span>
            <span
              className={`px-2 py-0.5 text-[11px] rounded-full font-mono font-bold transition-colors ${
                historyStatusFilter === 'FAILED'
                  ? 'bg-rose-500/40 text-rose-100 border border-rose-300/40 shadow-xs'
                  : 'bg-rose-900/50 text-rose-300 border border-rose-500/30'
              }`}
            >
              {postCounts.failed.toLocaleString()}
            </span>
          </button>
        </div>

        {/* THANH BỘ LỌC PHỤ: LỌC THEO NHÓM/PAGE + Ô TÌM KIẾM TỪ KHÓA */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 mb-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1">
            {/* Lọc theo Nhóm & Fanpage */}
            <Select
              size="middle"
              value={historyGroupFilter}
              onChange={(val) => {
                setHistoryGroupFilter(val);
                setHistoryPageFilter('ALL');
              }}
              className="w-full sm:w-80 rounded-xl font-medium"
              suffixIcon={<TeamOutlined className="text-slate-400" />}
              showSearch
              optionFilterProp="children"
              options={[
                { value: 'ALL', label: 'Tất cả Nhóm & Fanpage' },
                ...groupAccountsWithId.map((g) => {
                  const stat = groupStatsMap.get(g.platformAccountId) || EMPTY_GROUP_STAT;
                  const groupName = stripEmojiPrefix(g.pageName) || g.platformAccountId;
                  return {
                    value: g.platformAccountId,
                    label: `${groupName} · ID ${g.id} (Đã đăng ${stat.publishedToday} · Chờ ${stat.pendingCount} · Lỗi ${stat.failedCount})`,
                  };
                }),
              ]}
            />

            {/* Ô tìm kiếm tiêu đề, nội dung, ID */}
            <Input
              size="middle"
              prefix={<SearchOutlined className="text-slate-400" />}
              placeholder="Tìm theo tiêu đề, nội dung hoặc ID..."
              value={historySearchText}
              onChange={(e) => setHistorySearchText(e.target.value)}
              allowClear
              className="rounded-xl flex-1 text-xs"
            />
          </div>

          {(historyGroupFilter !== 'ALL' || historyPageFilter !== 'ALL' || historyStatusFilter !== 'ALL' || historySearchText) && (
            <Button
              size="middle"
              type="text"
              icon={<ReloadOutlined />}
              onClick={() => {
                setHistoryGroupFilter('ALL');
                setHistoryPageFilter('ALL');
                setHistoryStatusFilter('ALL');
                setHistorySearchText('');
              }}
              className="text-slate-300 hover:text-white text-xs rounded-xl border border-slate-700 bg-slate-800/60 hover:bg-slate-700 shrink-0"
            >
              Xóa bộ lọc
            </Button>
          )}
        </div>

        {/* THỐNG KÊ CHI TIẾT THEO TỪNG NHÓM: HÔM NAY ĐÃ ĐĂNG (xanh), CHỜ ĐĂNG (cam), LỖI (đỏ) */}
        {groupAccountsWithId.length > 0 && (() => {
          const totalPublishedToday = groupAccountsWithId.reduce((acc, g) => acc + (groupStatsMap.get(g.platformAccountId)?.publishedToday || 0), 0);
          const totalPending = groupAccountsWithId.reduce((acc, g) => acc + (groupStatsMap.get(g.platformAccountId)?.pendingCount || 0), 0);
          const totalFailed = groupAccountsWithId.reduce((acc, g) => acc + (groupStatsMap.get(g.platformAccountId)?.failedCount || 0), 0);

          return (
            <div className="pb-3 mb-4 border-b border-slate-800/70">
              {/* Thanh điều khiển trên cùng */}
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-[11px] font-bold text-slate-300 shrink-0 shadow-2xs backdrop-blur-sm">
                    <CalendarOutlined className="text-blue-400 text-xs" />
                    <span>Hôm nay</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setHistoryGroupFilter('ALL');
                      setHistoryPageFilter('ALL');
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 border backdrop-blur-sm cursor-pointer ${
                      historyGroupFilter === 'ALL'
                        ? 'border-blue-500/80 bg-blue-600/25 text-blue-100 shadow-sm shadow-blue-950/40 ring-1 ring-blue-500/30'
                        : 'border-slate-800/80 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:bg-slate-800/70 hover:text-slate-200'
                    }`}
                  >
                    <GlobalOutlined className={historyGroupFilter === 'ALL' ? 'text-blue-400' : 'text-slate-400'} />
                    <span>Tất cả ({groupAccountsWithId.length} nhóm)</span>
                  </button>

                  {/* Thống kê nhanh toàn hệ thống hôm nay */}
                  <div className="hidden sm:flex items-center gap-2.5 px-3 py-1 rounded-xl bg-slate-900/50 border border-slate-800/60 text-[11px]">
                    <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                      <CheckCircleFilled className="text-[10px]" />
                      <strong className="font-mono">{totalPublishedToday}</strong> đã đăng
                    </span>
                    <span className="text-slate-700">|</span>
                    <span className="flex items-center gap-1.5 text-amber-300 font-medium">
                      <ClockCircleFilled className="text-[10px]" />
                      <strong className="font-mono">{totalPending}</strong> bài chờ
                      {postCounts.processing > 0 ? (
                        <span className="text-[10px] text-blue-300 font-normal">
                          ({postCounts.pending} chờ + {postCounts.processing} đang chạy)
                        </span>
                      ) : null}
                    </span>
                    {totalFailed > 0 && (
                      <>
                        <span className="text-slate-700">|</span>
                        <span className="flex items-center gap-1.5 text-rose-400 font-medium animate-pulse">
                          <CloseCircleFilled className="text-[10px]" />
                          <strong className="font-mono">{totalFailed}</strong> lỗi
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {historyGroupFilter !== 'ALL' && (
                  <Button
                    size="small"
                    type="text"
                    icon={<ClearOutlined />}
                    onClick={() => {
                      setHistoryGroupFilter('ALL');
                      setHistoryPageFilter('ALL');
                    }}
                    className="text-xs text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
                  >
                    Bỏ chọn nhóm (Xem tất cả)
                  </Button>
                )}
              </div>

              {/* Lưới các nhóm dạng Card cao cấp, rộng rãi, dễ đọc */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {groupAccountsWithId.map((g) => {
                  const stat = groupStatsMap.get(g.platformAccountId) || EMPTY_GROUP_STAT;
                  const isSelected = historyGroupFilter === g.platformAccountId;
                  const groupName = stripEmojiPrefix(g.pageName) || g.platformAccountId;

                  // Chấm trạng thái tổng quan
                  let dotBg = 'bg-slate-600';
                  if (stat.failedCount > 0) dotBg = 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)] animate-pulse';
                  else if (stat.pendingCount > 0) dotBg = 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]';
                  else if (stat.publishedToday > 0) dotBg = 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]';

                  const popoverContent = (
                    <div className="p-1 space-y-2 max-w-[320px] text-xs">
                      <div className="font-bold text-slate-100 flex items-center justify-between gap-2 border-b border-slate-700/60 pb-1.5">
                        <span className="truncate">{groupName}</span>
                        <span className="text-slate-400 font-mono text-[10px] shrink-0">#{g.id}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 text-[11px] text-center">
                        <div className="p-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                          <div className="font-bold">{stat.publishedToday}</div>
                          <div className="text-[10px] text-slate-400">Hôm nay</div>
                        </div>
                        <div className="p-1 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                          <div className="font-bold">{stat.pendingCount}</div>
                          <div className="text-[10px] text-slate-400">Chờ đăng</div>
                        </div>
                        <div className="p-1 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">
                          <div className="font-bold">{stat.failedCount}</div>
                          <div className="text-[10px] text-slate-400">Bị lỗi</div>
                        </div>
                      </div>

                      {/* MỐC THỜI GIAN RẢI BÀI (TIMELINE SPREAD & BÀI CUỐI) */}
                      {stat.pendingCount > 0 && stat.lastScheduledAt ? (
                        <div className="p-2 rounded-lg bg-slate-800/90 border border-slate-700/60 space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-200">
                            <span className="flex items-center gap-1 text-amber-300">
                              ⏱️ Lịch rải bài trong ngày:
                            </span>
                            {stat.avgGapMinutes ? (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                ~{stat.avgGapMinutes} phút/bài
                              </span>
                            ) : null}
                          </div>

                          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                            <div className="bg-slate-900/80 p-1.5 rounded border border-slate-700/40">
                              <div className="text-[10px] text-slate-400">Bài kế tiếp:</div>
                              <div className="font-mono font-bold text-blue-300 mt-0.5">
                                {stat.nextScheduledAt ? dayjs(stat.nextScheduledAt).format('HH:mm') : '—'}
                              </div>
                            </div>
                            <div className="bg-slate-900/80 p-1.5 rounded border border-slate-700/40">
                              <div className="text-[10px] text-slate-400">Bài cuối cùng:</div>
                              <div className="font-mono font-bold text-amber-300 mt-0.5">
                                🏁 {stat.todayFinishTimeText || '—'}
                              </div>
                            </div>
                          </div>

                          {stat.hourlySlots && stat.hourlySlots.length > 0 && (
                            <div className="pt-1 border-t border-slate-700/40">
                              <div className="text-[10px] text-slate-400 mb-1">
                                📊 Khung giờ rải bài (không dồn 1 cục):
                              </div>
                              <div className="flex flex-wrap gap-1 max-h-[85px] overflow-y-auto pr-0.5">
                                {stat.hourlySlots.map((slot, sIdx) => (
                                  <span
                                    key={sIdx}
                                    className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-900/90 text-slate-300 border border-slate-700/60 flex items-center gap-1"
                                  >
                                    <span className="text-blue-400 font-semibold">{slot.hour}:</span>
                                    <span className="text-amber-300 font-bold">{slot.count} bài</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}

                      {stat.pendingPagesList && stat.pendingPagesList.length > 0 ? (
                        <div className="space-y-1 pt-1 border-t border-slate-700/40">
                          <div className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
                            <span>📄 Phân bổ Page chờ đăng:</span>
                            <span className="text-amber-300 font-mono font-bold">{stat.pendingCount} bài</span>
                          </div>
                          <div className="space-y-1 max-h-[110px] overflow-y-auto pr-0.5">
                            {stat.pendingPagesList.map((p, idx) => {
                              const pal = PAGE_PALETTE[idx % PAGE_PALETTE.length];
                              return (
                                <div key={idx} className="flex items-center justify-between text-[11px] bg-slate-800/70 px-2 py-1 rounded-md border border-slate-700/50">
                                  <span className="truncate max-w-[170px] text-slate-200 flex items-center gap-1.5">
                                    <span className={`w-2 h-2 rounded-full ${pal.bg} shrink-0`} />
                                    {p.isAnon ? '👤 ' : ''}{p.pageName}
                                  </span>
                                  <span className="font-mono font-bold text-amber-300 shrink-0 ml-1">
                                    {p.count} bài ({p.percent}%)
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-400 italic text-center py-1">
                          ✓ Hiện không có bài nào chờ đăng
                        </div>
                      )}
                    </div>
                  );

                  return (
                    <Popover
                      key={g.id}
                      trigger="hover"
                      placement="bottom"
                      mouseEnterDelay={0.25}
                      content={popoverContent}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setHistoryGroupFilter(isSelected ? 'ALL' : g.platformAccountId);
                          setHistoryPageFilter('ALL');
                        }}
                        className={`group relative text-left w-full p-2.5 rounded-xl border transition-all duration-200 cursor-pointer backdrop-blur-md flex flex-col justify-between min-h-[58px] gap-1.5 ${
                          isSelected
                            ? 'border-blue-500 bg-gradient-to-br from-blue-950/70 via-slate-900/90 to-blue-900/40 text-white shadow-lg shadow-blue-950/50 ring-1 ring-blue-500/50'
                            : 'border-slate-800/80 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-850 text-slate-300 hover:text-white shadow-2xs'
                        }`}
                      >
                        {/* Dòng 1: Tên nhóm, ID và các Badge số lượng */}
                        <div className="flex items-center justify-between gap-2 min-w-0 w-full">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${dotBg}`} />
                            <span className="truncate text-xs font-semibold group-hover:text-blue-200 transition-colors" title={groupName}>
                              {groupName}
                            </span>
                            <span className="text-slate-400 font-mono text-[10px] px-1 py-0.2 rounded bg-slate-800/80 border border-slate-700/50 shrink-0">
                              #{g.id}
                            </span>
                          </div>

                          {/* Badges số lượng bài */}
                          <div className="flex items-center gap-1 shrink-0">
                            {stat.publishedToday > 0 && (
                              <span
                                className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-1"
                                title={`Hôm nay đã đăng ${stat.publishedToday} bài`}
                              >
                                <CheckCircleFilled className="text-[9px]" /> {stat.publishedToday}
                              </span>
                            )}

                            {stat.pendingCount > 0 && (
                              <span
                                className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/25 flex items-center gap-1"
                                title={`Đang chờ đăng: ${stat.pendingCount} bài (Bài cuối: ${stat.todayFinishTimeText || '—'})`}
                              >
                                <ClockCircleFilled className="text-[9px]" /> {stat.pendingCount}
                              </span>
                            )}

                            {stat.failedCount > 0 && (
                              <span
                                className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/35 flex items-center gap-1"
                                title={`Bài bị lỗi: ${stat.failedCount} bài`}
                              >
                                <CloseCircleFilled className="text-[9px]" /> {stat.failedCount}
                              </span>
                            )}

                            {stat.publishedToday === 0 && stat.pendingCount === 0 && stat.failedCount === 0 && (
                              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono text-slate-500 bg-slate-800/40 border border-slate-700/30">
                                0
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Dòng 2: Mốc thời gian & Tốc độ rải bài */}
                        <div className="flex items-center justify-between gap-1 w-full text-[11px] pt-1.5 border-t border-slate-800/60">
                          {stat.pendingCount > 0 && stat.todayFinishTimeText ? (
                            <>
                              <span className="text-amber-300/95 font-mono text-[10.5px] font-medium flex items-center gap-1 truncate">
                                <ClockCircleOutlined className="text-[10px] text-amber-400 shrink-0" />
                                <span>Xong {stat.todayFinishTimeText}</span>
                              </span>
                              {stat.avgGapMinutes ? (
                                <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 px-1.5 py-0.2 rounded border border-slate-700/40 shrink-0">
                                  ~{stat.avgGapMinutes}p/bài
                                </span>
                              ) : null}
                            </>
                          ) : stat.publishedToday > 0 ? (
                            <span className="text-emerald-400/90 text-[10.5px] font-medium flex items-center gap-1">
                              <CheckOutlined className="text-[10px]" /> Hoàn tất hôm nay
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[10.5px]">Chưa lên lịch</span>
                          )}
                        </div>
                      </button>
                    </Popover>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* BẢNG PHÂN BỔ PAGE ĐANG CHỜ ĐĂNG TRONG PHẠM VI (FANPAGE PENDING DISTRIBUTION BAR) */}
        {currentPendingDistribution.totalPending > 0 && (
          <div className="p-4 mb-4 rounded-2xl bg-gradient-to-b from-slate-900/95 via-slate-900/80 to-slate-950/95 border border-slate-800/80 shadow-xl backdrop-blur-md transition-all">
            {/* Dòng tiêu đề & hành động */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500/20 via-orange-500/20 to-amber-600/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 shadow-sm shadow-amber-950/30">
                  <ApartmentOutlined className="text-base" />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-100 tracking-wide uppercase">Phân bổ Page chờ đăng:</span>
                  <span className="text-xs font-semibold text-sky-300 bg-sky-500/15 px-2.5 py-0.5 rounded-lg border border-sky-400/30 truncate max-w-[260px] flex items-center gap-1.5 shadow-2xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                    {currentPendingDistribution.scopeTitle}
                  </span>
                  <span className="text-[11px] font-mono font-bold text-amber-300 bg-amber-500/15 px-2.5 py-0.5 rounded-lg border border-amber-400/30 shadow-2xs">
                    {currentPendingDistribution.totalPending.toLocaleString()} bài chờ
                  </span>
                  {historyPageFilter !== 'ALL' && (
                    <span className="text-[11px] font-semibold text-purple-200 bg-purple-500/20 px-2.5 py-0.5 rounded-lg border border-purple-400/30 flex items-center gap-1.5 shadow-2xs">
                      <span>Đang lọc:</span>
                      <strong className="text-white">{historyPageFilter}</strong>
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                {historyPageFilter !== 'ALL' && (
                  <Button
                    size="small"
                    type="text"
                    icon={<ClearOutlined />}
                    onClick={() => setHistoryPageFilter('ALL')}
                    className="text-xs text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 rounded-xl h-8 px-2.5 font-medium transition-all"
                  >
                    Bỏ lọc Page
                  </Button>
                )}
                <Button
                  size="small"
                  type="primary"
                  icon={<ScheduleOutlined />}
                  onClick={() => {
                    const targetIds = filteredHistoryPosts
                      .filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING')
                      .map((p) => p.id);
                    if (targetIds.length > 0) {
                      setSelectedRowKeys(targetIds);
                      setBulkRescheduleTargetScope('SELECTED');
                      setBulkRescheduleModalVisible(true);
                      message.info(`🎯 Đã chọn ${targetIds.length} bài chờ đăng để chia lại giờ & Page.`);
                    } else {
                      setBulkRescheduleTargetScope('ALL');
                      setBulkRescheduleModalVisible(true);
                    }
                  }}
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white border border-blue-400/30 rounded-xl text-xs font-bold h-8 px-3.5 shadow-md shadow-indigo-950/50 transition-all hover:scale-[1.02]"
                >
                  ⚡ Chia lại giờ & Page
                </Button>
              </div>
            </div>

            {/* Thanh thước đo tỷ lệ phân bổ trực quan (Multi-segment progress bar) */}
            {currentPendingDistribution.pagesList.length > 0 && (
              <div className="my-3">
                <div className="h-2.5 w-full rounded-full bg-slate-950/90 p-0.5 flex gap-[2px] overflow-hidden border border-slate-800/90 shadow-inner">
                  {currentPendingDistribution.pagesList.map((p, idx) => {
                    const palette = PAGE_PALETTE[idx % PAGE_PALETTE.length];
                    const isFilterActive = historyPageFilter === p.pageName;
                    return (
                      <Tooltip key={idx} title={`${p.pageName}: ${p.count} bài (${p.percent}%) - Click để lọc`}>
                        <div
                          style={{ width: `${Math.max(p.percent, 3)}%` }}
                          className={`h-full transition-all cursor-pointer ${palette.bg} ${historyPageFilter === 'ALL' || isFilterActive ? 'opacity-100 brightness-105' : 'opacity-25'
                            } hover:brightness-125 hover:scale-y-110 rounded-xs ${idx === 0 ? 'rounded-l-full' : ''} ${idx === currentPendingDistribution.pagesList.length - 1 ? 'rounded-r-full' : ''
                            }`}
                          onClick={() => setHistoryPageFilter(historyPageFilter === p.pageName ? 'ALL' : p.pageName)}
                        />
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Thanh điều khiển lọc: Lọc bài theo Page + Nút Tất cả */}
            <div className="flex items-center justify-between gap-2 pt-1 pb-2">
              <div className="flex items-center gap-2">
                <AimOutlined className="text-sky-400 text-xs" />
                <span className="text-xs font-bold text-slate-200 tracking-wide">
                  Lọc bài theo Page:
                </span>
                <span className="text-[11px] text-slate-500 font-medium">
                  ({currentPendingDistribution.pagesList.length} Page/Nick)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setHistoryPageFilter('ALL')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 border cursor-pointer ${historyPageFilter === 'ALL'
                    ? 'border-blue-500/80 bg-blue-600/30 text-blue-200 shadow-sm ring-1 ring-blue-500/30'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
              >
                <span>Xem tất cả ({currentPendingDistribution.totalPending.toLocaleString()})</span>
              </button>
            </div>

            {/* Danh sách các card Page chia lưới ngay hàng thẳng lối (CSS Grid) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {currentPendingDistribution.pagesList.map((p, idx) => {
                const palette = PAGE_PALETTE[idx % PAGE_PALETTE.length];
                const isActive = historyPageFilter === p.pageName;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setHistoryPageFilter(isActive ? 'ALL' : p.pageName)}
                    className={`group relative flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs transition-all border text-left cursor-pointer backdrop-blur-sm ${isActive
                        ? 'border-blue-400/90 bg-blue-600/25 text-white font-semibold ring-1 ring-blue-400/60 shadow-md shadow-blue-950/40'
                        : 'border-slate-800/80 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900/90 hover:text-white'
                      }`}
                    title={`${p.pageName}: ${p.count} bài (${p.percent}%) - Click để ${isActive ? 'bỏ lọc' : 'lọc bài'}`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${palette.bg} ${isActive ? 'ring-2 ring-white/60' : ''}`} />
                      <span className="text-xs shrink-0 text-slate-400">{p.isAnon ? '👤' : '📄'}</span>
                      <span className="truncate font-medium text-slate-200 group-hover:text-white">
                        {p.pageName}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 font-mono text-[11px]">
                      <span className={`font-bold ${isActive ? 'text-blue-200' : 'text-slate-200'}`}>{p.count}</span>
                      <span className="text-[10px] text-slate-500">({p.percent}%)</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Cảnh báo dồn tải nếu 1 Page gánh quá nhiều bài */}
            {currentPendingDistribution.pagesList.length > 1 &&
              currentPendingDistribution.pagesList[0].percent >= 60 &&
              currentPendingDistribution.totalPending >= 4 && (
                <div className="mt-3 px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-200/90 backdrop-blur-sm">
                  <div className="flex items-center gap-2">
                    <WarningOutlined className="text-amber-400 text-sm shrink-0" />
                    <span>
                      <strong className="text-amber-300">Chú ý lệch tải:</strong> Page <strong className="text-white">{currentPendingDistribution.pagesList[0].pageName}</strong> đang gánh{' '}
                      <span className="font-mono font-bold text-amber-300">{currentPendingDistribution.pagesList[0].count}/{currentPendingDistribution.totalPending}</span> bài ({currentPendingDistribution.pagesList[0].percent}%).
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const heavyPageName = currentPendingDistribution.pagesList[0].pageName;
                      const targetIds = filteredHistoryPosts
                        .filter(
                          (p) =>
                            (p.status === 'PENDING' || p.status === 'PROCESSING') &&
                            (resolvePosterIdentityName(p) || 'Chưa gán Page') === heavyPageName
                        )
                        .map((p) => p.id);
                      if (targetIds.length > 0) {
                        setSelectedRowKeys(targetIds);
                        setBulkRescheduleTargetScope('SELECTED');
                        setBulkRescheduleModalVisible(true);
                        message.info(`🎯 Đã chọn ${targetIds.length} bài của "${heavyPageName}". Hãy chọn thêm Page/Nick khác để chia đều!`);
                      }
                    }}
                    className="text-[11px] font-bold text-amber-300 hover:text-white underline cursor-pointer shrink-0 transition-colors"
                  >
                    ⚡ Chọn {currentPendingDistribution.pagesList[0].count} bài này để chia lại
                  </button>
                </div>
              )}
          </div>
        )}

        <Table
          className="history-table"
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          columns={columns}
          dataSource={filteredHistoryPosts}
          rowKey="id"
          loading={isLoading}
          locale={{ emptyText: 'Chưa có bài đăng nào khớp với bộ lọc hiện tại' }}
          pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'] }}
          scroll={{ x: 720 }}
          sticky={{ offsetHeader: 0 }}
          rowClassName={(record: PostQueue) =>
            `history-row history-row-${(record.status || 'PENDING').toLowerCase()}`
          }
        />
      </Card>

      <Drawer
        open={!!diagnosingPost}
        onClose={() => setDiagnosingPost(null)}
        size={760}
        className="diagnostic-drawer"
        title={
          <div className="flex items-center gap-3">
            <span className="diagnostic-title-icon"><BugOutlined /></span>
            <div>
              <div className="text-sm font-extrabold">Kiểm tra log bài #{diagnosingPost?.id}</div>
              <div className="text-[11px] text-slate-500 font-normal mt-0.5">Đối chiếu lỗi đã lưu với nhật ký Worker</div>
            </div>
          </div>
        }
        extra={<Button size="small" icon={<ReloadOutlined spin={diagnosticLoading} />} onClick={() => refetchDiagnostic()}>Làm mới</Button>}
      >
        {diagnosingPost && (
          <div className="diagnostic-content">
            <div className="diagnostic-summary-grid">
              <div><span>Bài đăng</span><b>#{diagnosingPost.id}</b></div>
              <div><span>Trạng thái</span><b className={`status-${diagnosingPost.status.toLowerCase()}`}>{diagnosingPost.status}</b></div>
              <div><span>Worker log</span><b>{diagnosticLog?.returned || 0} dòng đã quét</b></div>
            </div>

            <section className="diagnostic-section">
              <div className="diagnostic-section-title"><CloseCircleOutlined /> Lỗi hệ thống ghi nhận</div>
              {diagnosingPost.errorMessage ? (
                <div className="diagnostic-error-box"><code>{diagnosingPost.errorMessage}</code></div>
              ) : (
                <Alert type="info" showIcon message="Chưa có thông báo lỗi được lưu cho bài này" description="Nếu bài đang xử lý, hãy làm mới sau vài giây để xem dấu vết mới nhất." />
              )}
            </section>

            <section className="diagnostic-section">
              <div className="diagnostic-section-heading">
                <div>
                  <div className="diagnostic-section-title"><CodeOutlined /> Dấu vết trong Worker log</div>
                  <div className="diagnostic-match-note">
                    {diagnosticEvidence.exactMatch
                      ? `Đã tìm thấy ${diagnosticEvidence.matchCount} vị trí khớp với bài này.`
                      : 'Chưa tìm thấy định danh chính xác — đang hiển thị các lỗi Worker gần nhất để tham khảo.'}
                  </div>
                </div>
                <Badge status={diagnosticEvidence.exactMatch ? 'success' : 'warning'} text={diagnosticEvidence.exactMatch ? 'Khớp chính xác' : 'Dữ liệu tham khảo'} />
              </div>

              <div className="diagnostic-terminal">
                {diagnosticLoading ? (
                  <div className="diagnostic-empty"><Spin /><span>Đang quét 5.000 dòng log...</span></div>
                ) : diagnosticLoadError ? (
                  <div className="diagnostic-empty"><Alert type="error" showIcon message="Không đọc được Worker log" /></div>
                ) : diagnosticEvidence.lines.length ? (
                  diagnosticEvidence.lines.map((line, index) => <code key={`${index}-${line}`}>{line || ' '}</code>)
                ) : (
                  <div className="diagnostic-empty">Không có dòng lỗi phù hợp.</div>
                )}
              </div>
            </section>

            <div className="diagnostic-actions">
              <Button icon={<CopyOutlined />} onClick={() => copyDiagnostic(true)}>Sao chép lỗi</Button>
              <Button type="primary" icon={<CopyOutlined />} onClick={() => copyDiagnostic(false)}>Sao chép gói chẩn đoán</Button>
              {diagnosingPost && (diagnosingPost.errorMessage?.toLowerCase().includes('cookie') || diagnosingPost.errorMessage?.toLowerCase().includes('hết hạn') || diagnosingPost.errorMessage?.toLowerCase().includes('không hợp lệ')) && (
                <Button
                  type="primary"
                  danger
                  icon={<KeyOutlined />}
                  onClick={() => {
                    const pageId = diagnosingPost.targetFanpageId?.split(':')[0];
                    const matchedAcc = socialAccounts?.find((a) => a.platformAccountId === pageId);
                    setQuickCookieTargetId(matchedAcc?.id);
                    setQuickCookieModalOpen(true);
                  }}
                  className="font-bold shadow"
                >
                  🔑 Cập nhật Cookie ngay
                </Button>
              )}
              <Button
                icon={<CodeOutlined />}
                onClick={() => navigate(`/dashboard/logs?source=worker&lines=5000&query=${encodeURIComponent(diagnosticEvidence.searchToken)}`)}
              >
                Mở Logs đầy đủ
              </Button>
            </div>
          </div>
        )}
      </Drawer>

      {/* Component Modal Chi tiết bài đăng phong cách Workspace hiện đại */}
      <PostDetailModal
        open={!!detailPost}
        post={detailPost}
        onClose={() => setDetailPost(null)}
        onDiagnose={(p) => setDiagnosingPost(p as any)}
        onRepost={(p) => repostMutation.mutate(p as any)}
      />

      {/* Drawer Săn Kênh TikTok Viral */}
      <Drawer
        title={
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center text-white text-lg font-black shadow-md">
              🔥
            </div>
            <div>
              <div className="font-bold text-base text-slate-100">Kính Lúp Săn Kênh TikTok Viral</div>
              <div className="text-xs text-slate-400 font-normal">Quét video nhiều view nhất của kênh đối thủ và đưa vào hàng đợi đăng tự động</div>
            </div>
          </div>
        }
        placement="right"
        size={typeof window !== 'undefined' && window.innerWidth < 1024 ? 'default' : 'large'}
        open={hunterDrawerVisible}
        onClose={() => setHunterDrawerVisible(false)}
        styles={{
          wrapper: { width: 'calc(100vw - 16px)', maxWidth: '100vw' },
          header: { background: '#0b1329', borderBottom: '1px solid rgba(148,163,184,0.15)', padding: '16px 24px' },
          body: { background: '#070c1b', padding: '24px' },
          footer: { background: '#0b1329', borderTop: '1px solid rgba(148,163,184,0.15)', padding: '16px 24px' },
        }}
        footer={
          <div className="flex items-center justify-between gap-4">
            <Button
              size="large"
              onClick={() => setHunterDrawerVisible(false)}
              className="border-slate-700 text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl font-semibold px-6"
            >
              Đóng
            </Button>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 font-medium">
                Đã chọn: <b className="text-rose-400">{hunterSelectedIds.size}</b> / {hunterResults.length} video
              </span>
              <Button
                type="primary"
                size="large"
                disabled={hunterSelectedIds.size === 0}
                onClick={handleImportHunterVideos}
                className="!bg-gradient-to-r !from-rose-600 !to-amber-600 hover:!from-rose-500 hover:!to-amber-500 !text-white font-bold rounded-xl px-6 border-0 shadow-lg"
              >
                🚀 Chuyển {hunterSelectedIds.size} Video Vào Hàng Đợi
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-6">
          {/* Box tìm kiếm kênh */}
          <div className="bg-slate-900/90 border border-slate-700/80 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Tên kênh TikTok (@username hoặc link kênh)
                </label>
                <Input
                  size="large"
                  placeholder="Ví dụ: @tiemmeoxinh, @reviewanngon, @tiktok..."
                  value={hunterTarget}
                  onChange={(e) => setHunterTarget(e.target.value)}
                  onPressEnter={handleHuntChannel}
                  className="rounded-xl bg-slate-950 border-slate-700 text-slate-100 placeholder:text-slate-500 h-12"
                  prefix={<SearchOutlined className="text-rose-400 mr-1" />}
                />
              </div>
              <div className="w-full sm:w-56">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Số lượng video (1 - 100)
                  </label>
                  <div className="flex items-center gap-1">
                    {[12, 24, 48, 60].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setHunterLimit(num)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${hunterLimit === num
                          ? 'bg-rose-500 text-white shadow-xs'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>
                <InputNumber
                  size="large"
                  min={1}
                  max={100}
                  value={hunterLimit}
                  onChange={(val) => setHunterLimit(Number(val) || 24)}
                  className="w-full h-12 rounded-xl text-base font-bold bg-slate-950 border-slate-700 text-slate-100 flex items-center"
                  prefix={<FireOutlined className="text-rose-400 mr-2" />}
                  placeholder="Nhập số video..."
                  addonAfter={<span className="text-xs text-slate-400">video</span>}
                />
              </div>
              <div className="sm:self-end">
                <Button
                  type="primary"
                  size="large"
                  loading={hunterLoading}
                  onClick={handleHuntChannel}
                  className="w-full sm:w-auto h-12 px-6 rounded-xl font-bold !bg-gradient-to-r !from-rose-600 !to-amber-600 hover:!from-rose-500 hover:!to-amber-500 border-0 shadow-md flex items-center justify-center gap-2"
                >
                  <FireOutlined /> Quét Video Viral
                </Button>
              </div>
            </div>

            {/* Gợi ý nhanh các kênh mẫu */}
            <div className="flex items-center gap-2 flex-wrap pt-1 text-xs">
              <span className="text-slate-400 font-medium">Gợi ý kênh hot:</span>
              {[
                { handle: '@film.factoryyy', label: '🎬 FILM FACTORY (462k)' },
                { handle: '@phimtalk000', label: '🎬 PhimTalk (27k)' },
                { handle: '@bowlcrab', label: '🦀 @bowlcrab' },
                { handle: '@tiemmeoxinh', label: '🐱 @tiemmeoxinh' },
                { handle: '@reviewanngon', label: '🍜 @reviewanngon' },
              ].map((item) => (
                <button
                  key={item.handle}
                  type="button"
                  onClick={() => {
                    setHunterTarget(item.handle);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-rose-500/20 hover:text-rose-300 border border-slate-700 transition-colors font-mono text-[11px]"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Kết quả quét */}
          {hunterResults.length > 0 && (
            <div className="space-y-4">
              {/* Thanh công cụ lọc và sắp xếp nâng cao */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Bộ lọc:</span>

                    {/* Lọc lượt xem */}
                    <Select
                      size="small"
                      value={hunterMinViews}
                      onChange={(val) => setHunterMinViews(val)}
                      className="w-36 text-xs"
                      options={[
                        { value: 0, label: '👁️ Tất cả lượt xem' },
                        { value: 100000, label: '👁️ > 100K views' },
                        { value: 500000, label: '👁️ > 500K views' },
                        { value: 1000000, label: '🔥 > 1M views' },
                      ]}
                    />

                    {/* Lọc thời lượng */}
                    <Select
                      size="small"
                      value={hunterDurationFilter}
                      onChange={(val) => setHunterDurationFilter(val)}
                      className="w-36 text-xs"
                      options={[
                        { value: 'ALL', label: '⏱️ Mọi thời lượng' },
                        { value: 'SHORT', label: '⚡ Ngắn ≤ 60s (Reels)' },
                        { value: 'LONG', label: '⏳ Dài > 60s' },
                      ]}
                    />

                    {/* Sắp xếp */}
                    <Select
                      size="small"
                      value={hunterSortBy}
                      onChange={(val) => setHunterSortBy(val)}
                      className="w-36 text-xs"
                      options={[
                        { value: 'VIEWS_DESC', label: '📈 Xem nhiều nhất' },
                        { value: 'LIKES_DESC', label: '❤️ Tim nhiều nhất' },
                      ]}
                    />
                  </div>

                  {/* Tuỳ chọn rải lịch, ẩn video đã đăng và tăng nét Ultra HD */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setHunterHideImported(!hunterHideImported)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5 ${hunterHideImported
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-xs'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      title="Tự động ẩn các video đã từng đăng hoặc đang có trong hàng đợi đăng bài"
                    >
                      <span>🚫 Ẩn video đã đăng ({hunterResults.filter((i) => i.isAlreadyImported).length})</span>
                      <span className={`w-2 h-2 rounded-full ${hunterHideImported ? 'bg-rose-400' : 'bg-slate-500'}`} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setHunterUltraHD(!hunterUltraHD)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5 ${hunterUltraHD
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-xs'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      title="Tự động làm nét viền và chống vỡ hạt khi đăng lên Facebook"
                    >
                      <span>⚡ Tăng nét Ultra HD</span>
                      <span className={`w-2 h-2 rounded-full ${hunterUltraHD ? 'bg-amber-400 animate-pulse' : 'bg-slate-500'}`} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setHunterAutoSchedule(!hunterAutoSchedule)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5 ${hunterAutoSchedule
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-xs'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      title="Tự động chia đều các bài vào khung giờ vàng mỗi ngày (11h30 trưa & 19h45 tối)"
                    >
                      <span>📅 Rải lịch tự động</span>
                      <span className={`w-2 h-2 rounded-full ${hunterAutoSchedule ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-200">
                    Tìm thấy <span className="text-rose-400 font-mono font-bold">{filteredAndSortedHunterVideos.length}</span> video phù hợp từ <span className="text-rose-400 font-mono">{hunterTarget}</span>:
                  </span>
                  <Tag color="volcano" className="!font-bold !m-0">
                    Đã xếp hạng Viral
                  </Tag>
                  {hunterHideImported && hunterResults.some((i) => i.isAlreadyImported) && (
                    <Tag color="default" className="!text-[11px] !m-0 !bg-slate-800 !text-slate-400 border-slate-700">
                      Đã ẩn {hunterResults.filter((i) => i.isAlreadyImported).length} video đã đăng
                    </Tag>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="small"
                    onClick={() => {
                      if (hunterSelectedIds.size === filteredAndSortedHunterVideos.length) {
                        setHunterSelectedIds(new Set());
                      } else {
                        setHunterSelectedIds(new Set(filteredAndSortedHunterVideos.map((it) => it.id)));
                      }
                    }}
                    className="text-xs font-semibold rounded-lg bg-slate-800 border-slate-700 text-slate-300"
                  >
                    {hunterSelectedIds.size === filteredAndSortedHunterVideos.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredAndSortedHunterVideos.map((item, idx) => {
                  const isChecked = hunterSelectedIds.has(item.id);
                  const viewStr = item.views >= 1000000
                    ? `${(item.views / 1000000).toFixed(1)}M`
                    : item.views >= 1000
                      ? `${(item.views / 1000).toFixed(1)}K`
                      : String(item.views);

                  const likeStr = item.likes >= 1000
                    ? `${(item.likes / 1000).toFixed(1)}K`
                    : String(item.likes);

                  return (
                    <div
                      key={item.id}
                      onClick={() => {
                        setHunterSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        });
                      }}
                      className={`cursor-pointer rounded-2xl border p-3.5 transition-all space-y-3 relative group ${
                        item.isAlreadyImported ? 'opacity-70 bg-slate-900/40' : ''
                      } ${isChecked
                        ? 'border-rose-500/80 bg-rose-950/20 shadow-lg shadow-rose-950/30 ring-1 ring-rose-500/50'
                        : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
                        }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Thumbnail */}
                        <div className="w-20 h-28 rounded-xl overflow-hidden bg-black shrink-0 relative border border-slate-800">
                          {item.cover ? (
                            <img src={item.cover} alt="cover" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-600 text-xs">No Cover</div>
                          )}
                          {item.duration && (
                            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-black/80 text-[10px] text-white font-mono font-bold">
                              {item.duration}
                            </span>
                          )}
                          <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-rose-600/90 text-[10px] text-white font-bold">
                            #{idx + 1}
                          </span>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-center justify-between">
                            <Checkbox
                              checked={isChecked}
                              onChange={(e) => {
                                e.stopPropagation();
                                setHunterSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(item.id)) next.delete(item.id);
                                  else next.add(item.id);
                                  return next;
                                });
                              }}
                            />
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[11px] text-slate-400 hover:text-rose-400 underline font-mono flex items-center gap-1"
                            >
                              Xem trên TikTok ↗
                            </a>
                          </div>

                          <p className="text-xs text-slate-200 line-clamp-3 font-medium mb-0">
                            {item.title || item.desc || 'Video không có tiêu đề'}
                          </p>

                          <div className="flex items-center gap-2 pt-1 flex-wrap text-[11px]">
                            <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 font-bold border border-amber-500/20">
                              👁️ {viewStr} views
                            </span>
                            {item.likes > 0 && (
                              <span className="px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-300 font-bold border border-rose-500/20">
                                ❤️ {likeStr}
                              </span>
                            )}
                            {item.isAlreadyImported && (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 text-[10px]">
                                {item.postStatus === 'PUBLISHED' ? '✅ ĐÃ XUẤT BẢN' : '📅 ĐÃ CÓ TRONG LỊCH'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Trạng thái trống */}
          {hunterResults.length === 0 && !hunterLoading && (
            <div className="py-16 text-center space-y-3 bg-slate-900/40 rounded-2xl border border-slate-800/80">
              <div className="text-4xl">🎯</div>
              <div className="text-sm font-bold text-slate-300">Chưa quét kênh nào</div>
              <div className="text-xs text-slate-500 max-w-md mx-auto">
                Nhập tên kênh đối thủ ở trên (ví dụ: <code className="text-rose-400 font-mono">@tiemmeoxinh</code>) và bấm <b>Quét Video Viral</b> để tự động bốc toàn bộ video hot nhất về đăng!
              </div>
            </div>
          )}
        </div>
      </Drawer>

      {/* ── DRAWER SĂN / QUÉT BÀI VIẾT FACEBOOK GROUP ── */}
      <Drawer
        rootClassName="group-hunter-drawer"
        title={
          <div className="group-hunter-title">
            <div className="group-hunter-title-icon">
              <TeamOutlined className="text-base text-blue-400" />
            </div>
            <div>
              <div className="group-hunter-title-main">Quét bài viết từ Facebook Group / Fanpage</div>
              <div className="group-hunter-title-sub">Tìm bài nổi bật, chọn nội dung phù hợp rồi đưa vào lịch đăng</div>
            </div>
          </div>
        }
        placement="right"
        size="large"
        open={groupHunterDrawerVisible}
        onClose={() => setGroupHunterDrawerVisible(false)}
        styles={{
          wrapper: { width: '100vw', maxWidth: '100vw' },
          header: { background: '#0c141f', borderBottom: '1px solid #223247', padding: '14px 24px' },
          body: { background: '#08111b', padding: '20px 24px' },
          footer: { background: '#0c141f', borderTop: '1px solid #223247', padding: '12px 24px' },
        }}
        footer={
          <div className="group-hunter-footer">
            <Button
              size="large"
              onClick={() => setGroupHunterDrawerVisible(false)}
              className="group-hunter-close"
            >
              Đóng
            </Button>
            <div className="group-hunter-footer-action">
              <div className="group-hunter-selection-count">
                <span>Đã chọn</span>
                <strong>{groupHunterSelectedIds.size}</strong>
                <small>/ {groupHunterResults.length} bài</small>
              </div>
              <Button
                size="large"
                disabled={groupHunterSelectedIds.size === 0}
                onClick={handleImportAndSwipeGroupHunterPosts}
                icon={<ThunderboltOutlined />}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold border-none shadow-lg shadow-emerald-950/40 rounded-xl"
              >
                ⚡ Duyệt nhanh kiểu Tinder ({groupHunterSelectedIds.size} bài)
              </Button>
              <Button
                type="primary"
                size="large"
                disabled={groupHunterSelectedIds.size === 0}
                onClick={handleImportGroupHunterPosts}
                icon={<RocketOutlined />}
                className="group-hunter-import"
              >
                {groupHunterSelectedIds.size > 0
                  ? `Đưa ${groupHunterSelectedIds.size} bài vào lịch đăng`
                  : 'Chọn bài để đưa vào lịch'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="group-hunter-content">
          {/* Box tìm kiếm Group */}
          <section className="group-hunter-setup">
            <div className="group-hunter-section-head">
              <div>
                <span className="group-hunter-kicker">BƯỚC 1</span>
                <h3>Chọn nguồn cần quét</h3>
                <p>Dán link Group hoặc chọn nhanh một nhóm bạn thường sử dụng.</p>
              </div>
              <span className="group-hunter-account">
                <CheckCircleOutlined />
                Đang dùng cookie: <b>{activeScrapeAccount?.pageName || 'Tài khoản kết nối'}</b>
              </span>
            </div>
            <div className="group-hunter-form-grid">
              <div className="group-hunter-field group-hunter-field-url">
                <label>Link Group hoặc Fanpage <span>hoặc ID nhóm</span></label>
                <Input
                  size="large"
                  placeholder="Dán link Group, link Fanpage hoặc nhập ID nhóm"
                  value={groupHunterTarget}
                  onChange={(e) => setGroupHunterTarget(e.target.value)}
                  onPressEnter={handleHuntFacebookGroup}
                  prefix={<TeamOutlined />}
                  allowClear
                />
              </div>
              <div className="group-hunter-field group-hunter-field-name">
                <label>Tên gợi nhớ <span>không bắt buộc</span></label>
                <Input
                  size="large"
                  placeholder="VD: Mẹ & bé, Tuyển dụng..."
                  value={groupHunterCustomName}
                  onChange={(e) => setGroupHunterCustomName(e.target.value)}
                  onPressEnter={handleHuntFacebookGroup}
                  prefix={<EditOutlined />}
                  allowClear
                />
              </div>
              <div className="group-hunter-field group-hunter-field-limit">
                <label>Số bài cần lấy <span>tối đa {groupHunterDateRange ? 200 : 60}</span></label>
                <div className="group-hunter-limit-control">
                  <InputNumber
                    size="large"
                    min={1}
                    max={groupHunterDateRange ? 200 : 60}
                    value={groupHunterLimit}
                    onChange={(val) => setGroupHunterLimit(Number(val) || 20)}
                    placeholder="20"
                  />
                  <div className="group-hunter-limit-presets" aria-label="Chọn nhanh số bài">
                    {[10, 20, 30, 50].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setGroupHunterLimit(num)}
                        className={groupHunterLimit === num ? 'is-active' : ''}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="group-hunter-submit-wrap">
                <Button
                  type="primary"
                  size="large"
                  loading={groupHunterLoading}
                  onClick={handleHuntFacebookGroup}
                  className="group-hunter-scan"
                >
                  <SearchOutlined /> Quét bài viết
                </Button>
              </div>
            </div>

            <div className="group-hunter-date-row">
              <div className="group-hunter-date-label">
                <CalendarOutlined />
                <span>Lọc theo ngày đăng</span>
              </div>
              <DatePicker.RangePicker
                value={groupHunterDateRange}
                onChange={(vals) => setGroupHunterDateRange(vals && vals[0] && vals[1] ? [vals[0], vals[1]] : null)}
                format="DD/MM/YYYY"
                allowClear
                disabledDate={(d) => d.isAfter(dayjs(), 'day')}
                placeholder={['Từ ngày', 'Đến ngày']}
                presets={[
                  { label: 'Hôm nay', value: [dayjs().startOf('day'), dayjs().startOf('day')] },
                  { label: 'Hôm qua', value: [dayjs().subtract(1, 'day').startOf('day'), dayjs().subtract(1, 'day').startOf('day')] },
                  { label: '3 ngày gần đây', value: [dayjs().subtract(2, 'day').startOf('day'), dayjs().startOf('day')] },
                  { label: '7 ngày gần đây', value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().startOf('day')] },
                ]}
              />
              <span className="group-hunter-date-hint">
                {groupHunterDateRange
                  ? 'Quét bài mới nhất trước, dừng khi gặp bài cũ hơn ngày bắt đầu. Có thể mất 1–4 phút.'
                  : 'Bỏ trống để quét như bình thường (bài theo thứ tự Facebook hiển thị).'}
              </span>
            </div>

            {/* Thanh chọn nhanh Nhóm Yêu Thích */}
            {allFavoriteGroups.length > 0 && (
              <div className="group-hunter-favorites">
                <div className="group-hunter-favorites-head">
                  <div>
                    <strong><StarFilled /> Nhóm nguồn thường quét</strong>
                    <span>{allFavoriteGroups.length} nhóm nguồn đã lưu để quét bài</span>
                  </div>
                  <div className="group-hunter-favorites-tools">
                    <Input
                      size="small"
                      allowClear
                      value={favoriteGroupSearch}
                      onChange={(event) => setFavoriteGroupSearch(event.target.value)}
                      placeholder="Tìm tên nhóm..."
                      prefix={<SearchOutlined />}
                    />
                    {groupHunterTarget.trim() && !favoriteGroups.some((g) => g.url === groupHunterTarget.trim()) && (
                      <button
                        type="button"
                        onClick={() => handleAddFavoriteGroup()}
                        className="group-hunter-save"
                      >
                        <StarOutlined /> Lưu nhóm này
                      </button>
                    )}
                  </div>
                </div>

                {/* Bộ lọc chủ đề: Tất cả vs Nhóm Phim (Bí ý tưởng) */}
                <div className="flex items-center gap-2 pt-2 pb-1 flex-wrap">
                  <span className="text-xs text-slate-400 font-semibold">Chủ đề:</span>
                  <button
                    type="button"
                    onClick={() => setFavoriteGroupCategoryFilter('ALL')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      favoriteGroupCategoryFilter === 'ALL'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Tất cả ({allFavoriteGroups.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFavoriteGroupCategoryFilter('PHIM')}
                    className={`px-3 py-1 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${
                      favoriteGroupCategoryFilter === 'PHIM'
                        ? 'bg-gradient-to-r from-rose-600 to-amber-600 text-white shadow-rose-600/30 ring-1 ring-white/30'
                        : 'bg-rose-950/60 text-rose-300 border border-rose-800/50 hover:bg-rose-900/60'
                    }`}
                  >
                    <span>🎬 Nhóm Phim (Bí ý tưởng)</span>
                    <span className="px-1.5 py-0.2 rounded-full bg-rose-500/30 text-rose-200 text-[10px]">
                      {allFavoriteGroups.filter((g) => g.category === 'PHIM').length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFavoriteGroupCategoryFilter('GENERAL')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      favoriteGroupCategoryFilter === 'GENERAL'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Mẹ & Bé / Khác
                  </button>
                </div>

                <div className="group-hunter-favorite-grid">
                  {visibleFavoriteGroups.map((g) => {
                    const isSelected = groupHunterTarget.trim() === g.url.trim() || (g.url.includes('/groups/') && groupHunterTarget.includes(g.url.split('/groups/')[1]));
                    return (
                      <div
                        key={g.url}
                        onClick={() => {
                          setGroupHunterTarget(g.url);
                          setGroupHunterCustomName(g.name.replace(/^\[🎬 Phim\]\s*/, ''));
                        }}
                        className={`group-hunter-favorite-card ${isSelected ? 'is-selected' : ''}`}
                      >
                        <span className="group-hunter-favorite-icon">
                          {g.category === 'PHIM' ? <span className="text-rose-400">🎬</span> : <TeamOutlined />}
                        </span>
                        <span className="group-hunter-favorite-name" title={g.name}>{g.name}</span>
                        <span className="group-hunter-favorite-actions">
                          <button
                            type="button"
                            title="Đổi tên gợi nhớ cho nhóm này"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRenameFavoriteGroup(g.url, g.name);
                            }}
                            aria-label={`Đổi tên ${g.name}`}
                          >
                            <EditOutlined />
                          </button>
                          <button
                            type="button"
                            title="Xóa khỏi nhóm yêu thích"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveFavoriteGroup(g.url);
                            }}
                            aria-label={`Xóa ${g.name}`}
                          >
                            <CloseOutlined />
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
                {filteredFavoriteGroups.length === 0 && (
                  <div className="group-hunter-favorite-empty">Không tìm thấy nhóm phù hợp.</div>
                )}
                {!favoriteGroupSearch.trim() && allFavoriteGroups.length > 6 && (
                  <button
                    type="button"
                    className="group-hunter-expand"
                    onClick={() => setFavoriteGroupsExpanded((current) => !current)}
                  >
                    {favoriteGroupsExpanded ? 'Thu gọn danh sách' : `Xem thêm ${allFavoriteGroups.length - 6} nhóm`}
                    <ArrowRightOutlined className={favoriteGroupsExpanded ? 'is-open' : ''} />
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Kết quả quét Group */}
          {groupHunterResults.length > 0 && (
            <div className="group-hunter-results space-y-4">
              {/* Thanh công cụ lọc & cấu hình rải lịch */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Lọc loại bài:</span>
                    <Select
                      size="small"
                      value={groupHunterMediaFilter}
                      onChange={(val) => setGroupHunterMediaFilter(val)}
                      className="w-40 text-xs"
                      options={[
                        { value: 'ALL', label: '📋 Tất cả bài viết' },
                        { value: 'MEDIA_ONLY', label: '🖼️ Có Ảnh hoặc Video' },
                        { value: 'IMAGE_ONLY', label: '📷 Chỉ bài có Ảnh' },
                        { value: 'VIDEO_ONLY', label: '🎬 Chỉ bài có Video' },
                      ]}
                    />

                    <button
                      type="button"
                      onClick={() => setGroupHunterSkipImported(!groupHunterSkipImported)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5 ${groupHunterSkipImported
                        ? 'bg-blue-500/20 text-blue-300 border-blue-500/40 shadow-xs'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                    >
                      <span>🛡️ Bỏ bài đã có trong Lịch ({groupHunterResults.filter((it) => it.isAlreadyImported).length})</span>
                      <span className={`w-2 h-2 rounded-full ${groupHunterSkipImported ? 'bg-blue-400' : 'bg-slate-500'}`} />
                    </button>
                  </div>

                  {/* Cấu hình rải lịch */}
                  {/* Cấu hình rải lịch */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setGroupHunterAutoSchedule(!groupHunterAutoSchedule)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5 ${groupHunterAutoSchedule
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-xs'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                    >
                      <span>📅 Tự động rải lịch</span>
                      <span className={`w-2 h-2 rounded-full ${groupHunterAutoSchedule ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                    </button>

                    {groupHunterAutoSchedule && (
                      <div className="flex items-center gap-2 text-xs text-slate-300 bg-slate-950/70 px-2.5 py-1 rounded-xl border border-slate-800">
                        <Radio.Group
                          size="small"
                          value={groupHunterScheduleMode}
                          onChange={(e) => setGroupHunterScheduleMode(e.target.value)}
                          className="text-xs"
                        >
                          <Radio.Button value="GOLDEN_HOURS" className="text-xs font-bold text-amber-300">
                            🌟 Giờ Vàng (8h, 12h, 18h, 20h45)
                          </Radio.Button>
                          <Radio.Button value="INTERVAL" className="text-xs font-semibold">
                            ⏱️ Đều đặn
                          </Radio.Button>
                        </Radio.Group>

                        {groupHunterScheduleMode === 'INTERVAL' && (
                          <div className="flex items-center gap-1.5 pl-1 border-l border-slate-800">
                            <span>Mỗi</span>
                            <InputNumber
                              size="small"
                              min={5}
                              max={720}
                              value={groupHunterInterval}
                              onChange={(v) => setGroupHunterInterval(Number(v) || 60)}
                              className="w-16"
                            />
                            <span>phút/bài</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Hàng công cụ Gemini AI & Làm sạch bài viết */}
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-2 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      size="small"
                      icon={<RobotOutlined className="text-amber-400" />}
                      loading={groupHunterAiCurating}
                      onClick={handleGeminiCurateGroupPosts}
                      className="text-xs font-bold bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20"
                    >
                      ✨ Gemini AI Thẩm định &amp; Lọc rác
                    </Button>

                    <Button
                      size="small"
                      icon={<ClearOutlined className="text-emerald-400" />}
                      onClick={handleCleanSpamFromSelectedPosts}
                      disabled={groupHunterSelectedIds.size === 0}
                      className="text-xs font-bold bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20"
                      title="Xoá sạch số điện thoại, Zalo, link quảng cáo, STK ngân hàng và hashtag thừa"
                    >
                      🧼 Dọn rác &amp; SĐT ({groupHunterSelectedIds.size})
                    </Button>

                    <Button
                      size="small"
                      icon={<FireOutlined className="text-purple-400" />}
                      onClick={() => {
                        if (groupHunterSelectedIds.size === 0) {
                          message.warning('Vui lòng chọn ít nhất 1 bài viết để AI viết lại!');
                          return;
                        }
                        setGroupHunterBatchAiProgress({ current: 0, total: groupHunterSelectedIds.size });
                        setGroupHunterBatchAiOpen(true);
                      }}
                      disabled={groupHunterSelectedIds.size === 0}
                      className="text-xs font-bold bg-purple-500/10 text-purple-300 border-purple-500/30 hover:bg-purple-500/20"
                      title="Viết lại hàng loạt theo phong cách: Hook giật tít, Storytelling, Kích thích bình luận..."
                    >
                      ✨ Viết lại AI ({groupHunterSelectedIds.size})
                    </Button>

                    {groupHunterResults.some((it) => it.aiCurated) && (
                      <button
                        type="button"
                        onClick={() => setGroupHunterAiOnlyQuality(!groupHunterAiOnlyQuality)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5 ${
                          groupHunterAiOnlyQuality
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-xs'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        <span>💎 Chỉ lấy bài điểm cao (&ge; 70 &amp; Sạch rác)</span>
                        <span className={`w-2 h-2 rounded-full ${groupHunterAiOnlyQuality ? 'bg-amber-400' : 'bg-slate-500'}`} />
                      </button>
                    )}
                  </div>

                  <span className="text-[11px] text-slate-400">
                    Key Gemini: <strong className="text-emerald-400">{getStoredGeminiKeys() ? 'Đã kích hoạt' : 'Hệ thống'}</strong>
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-200">
                    Tìm thấy <span className="text-blue-400 font-mono font-bold">{filteredGroupHunterPosts.length}</span> bài viết từ nhóm <span className="text-blue-400 font-semibold font-mono">{groupHunterGroupName || 'Facebook Group'}</span>:
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="small"
                    onClick={() => {
                      if (groupHunterSelectedIds.size === filteredGroupHunterPosts.length) {
                        setGroupHunterSelectedIds(new Set());
                      } else {
                        setGroupHunterSelectedIds(new Set(filteredGroupHunterPosts.map((it) => it.id)));
                      }
                    }}
                    className="text-xs font-semibold rounded-lg bg-slate-800 border-slate-700 text-slate-300"
                  >
                    {groupHunterSelectedIds.size === filteredGroupHunterPosts.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredGroupHunterPosts.map((item, idx) => {
                  const isChecked = groupHunterSelectedIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => {
                        setGroupHunterSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        });
                      }}
                      className={`cursor-pointer rounded-2xl border p-3.5 transition-all space-y-3 relative group ${isChecked
                        ? 'border-blue-500/80 bg-blue-950/20 shadow-lg shadow-blue-950/30 ring-1 ring-blue-500/50'
                        : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
                        }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Thumbnail */}
                        <div className="w-20 h-24 rounded-xl overflow-hidden bg-slate-950 shrink-0 relative border border-slate-800 flex items-center justify-center">
                          {item.previewCover ? (
                            <img src={item.previewCover} alt="cover" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 text-xs gap-1">
                              {item.mediaType === 'VIDEO' ? (
                                <>
                                  <PlayCircleOutlined className="text-xl" />
                                  <span>{/\/reel\//.test(item.url) ? 'Reels' : 'Video'}</span>
                                </>
                              ) : item.mediaType === 'IMAGE' ? (
                                <>
                                  <PictureOutlined className="text-xl" />
                                  <span>Ảnh</span>
                                </>
                              ) : (
                                <>
                                  <span className="text-base">📝</span>
                                  <span>Bài Text</span>
                                </>
                              )}
                            </div>
                          )}
                          <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-blue-600/90 text-[10px] text-white font-bold">
                            #{idx + 1}
                          </span>
                          {item.mediaCount > 1 && (
                            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-black/80 text-[10px] text-white font-mono font-bold">
                              +{item.mediaCount}
                            </span>
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Checkbox
                              checked={isChecked}
                              onChange={(e) => {
                                e.stopPropagation();
                                setGroupHunterSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(item.id)) next.delete(item.id);
                                  else next.add(item.id);
                                  return next;
                                });
                              }}
                            />
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[11px] text-slate-400 hover:text-blue-400 underline font-mono flex items-center gap-1"
                            >
                              Xem trên FB ↗
                            </a>
                          </div>

                          <div className="flex items-center justify-between gap-1">
                            <div className="text-[11px] text-blue-300 font-bold truncate">
                              👤 {item.author || 'Thành viên'}
                            </div>
                            {item.isAlreadyImported && (
                              <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[9px] font-bold shrink-0">
                                ⚠️ Đã có trong Lịch
                              </span>
                            )}
                          </div>

                          {/* Huy hiệu điểm Gemini AI & cảnh báo rác */}
                          {item.aiCurated && (
                            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                              {item.aiScore !== undefined && item.aiScore >= 80 ? (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                  💎 Cực Phẩm ({item.aiScore}/100)
                                </span>
                              ) : item.aiScore !== undefined && item.aiScore >= 65 ? (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                  ⭐ Đạt chuẩn ({item.aiScore}/100)
                                </span>
                              ) : (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">
                                  Điểm: {item.aiScore}/100
                                </span>
                              )}
                              {item.isSpam && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                  ⚠️ AI: Rác / Spam
                                </span>
                              )}
                            </div>
                          )}

                          <p className="text-xs text-slate-200 line-clamp-2 font-medium mb-0">
                            {item.caption || 'Bài viết không có tiêu đề'}
                          </p>

                          {/* Nút bấm chèn Hook mở đầu cuốn hút do Gemini đề xuất */}
                          {item.suggestedHook && !item.aiRewritten && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleApplyGroupHunterHook(item);
                              }}
                              className="text-[10px] text-amber-300 hover:text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded px-2 py-1 text-left font-medium line-clamp-1 transition-all cursor-pointer block w-full"
                              title={`Bấm để chèn vào đầu bài: "${item.suggestedHook}"`}
                            >
                              🎣 Chèn Hook AI: "{item.suggestedHook}"
                            </button>
                          )}

                          {item.aiRewritten && (
                            <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                              ✓ Đã chèn Hook AI mở đầu
                            </span>
                          )}

                          <div className="flex items-center gap-2 pt-1 flex-wrap text-[10px]">
                            {item.mediaType === 'VIDEO' && (
                              <span className="px-1.5 py-0.5 rounded-md bg-rose-500/15 text-rose-300 font-bold border border-rose-500/20">
                                🎬 Video
                              </span>
                            )}
                            {item.mediaType === 'IMAGE' && (
                              <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 font-bold border border-emerald-500/20">
                                🖼️ {item.mediaCount} ảnh
                              </span>
                            )}
                            {item.mediaType === 'TEXT' && (
                              <span className="px-1.5 py-0.5 rounded-md bg-slate-700/40 text-slate-400 border border-slate-700/50">
                                📄 Chữ
                              </span>
                            )}
                            {item.dateUnknown ? (
                              <span className="px-1.5 py-0.5 rounded-md bg-slate-700/40 text-slate-300 border border-slate-600/50">
                                Không rõ ngày{item.postedTime && item.postedTime !== 'Gần đây' ? ` (${item.postedTime})` : ''}
                              </span>
                            ) : item.postedAt ? (
                              <Tooltip title={item.postedTime ? `Facebook hiển thị: ${item.postedTime}` : undefined}>
                                <span className="px-1.5 py-0.5 rounded-md bg-blue-500/15 text-blue-300 font-semibold border border-blue-500/25 flex items-center gap-1">
                                  ⏰ {dayjs(item.postedAt).format('HH:mm DD/MM/YYYY')}
                                </span>
                              </Tooltip>
                            ) : item.postedTime && (
                              <span className="px-1.5 py-0.5 rounded-md bg-blue-500/15 text-blue-300 font-semibold border border-blue-500/25 flex items-center gap-1">
                                ⏰ {item.postedTime}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/60 mt-1">
                            <span className="text-[10px] text-slate-400 truncate max-w-[120px]">
                              {item.originalCaption && item.originalCaption !== item.caption ? '✨ Đã sửa nội dung' : ''}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setGroupHunterPreviewItem(item);
                              }}
                              className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1 cursor-pointer bg-blue-500/10 hover:bg-blue-500/20 px-2 py-0.5 rounded border border-blue-500/20 transition-all"
                            >
                              <EyeOutlined /> Xem &amp; Sửa bài
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Trạng thái trống */}
          {groupHunterResults.length === 0 && !groupHunterLoading && (
            <div className="group-hunter-empty">
              <div className="group-hunter-empty-icon"><SearchOutlined /></div>
              <div>
                <h3>Kết quả quét sẽ xuất hiện ở đây</h3>
                <p>Chọn một nhóm, đặt số lượng bài rồi bấm <b>Quét bài viết</b>.</p>
              </div>
              <div className="group-hunter-empty-steps">
                <span><b>1</b> Chọn Group</span>
                <span><b>2</b> Quét & lọc bài</span>
                <span><b>3</b> Đưa vào lịch đăng</span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Viết Lại Nội Dung Hàng Loạt Bằng Gemini */}
        <Modal
          title={
            <div className="flex items-center gap-2">
              <RobotOutlined className="text-amber-400 text-lg" />
              <span className="font-bold text-white">✨ Viết Lại Nội Dung Hàng Loạt Bằng Gemini AI</span>
            </div>
          }
          open={groupHunterBatchAiOpen}
          onCancel={() => !groupHunterBatchAiLoading && setGroupHunterBatchAiOpen(false)}
          width={580}
          footer={[
            <Button key="cancel" disabled={groupHunterBatchAiLoading} onClick={() => setGroupHunterBatchAiOpen(false)}>
              Huỷ
            </Button>,
            <Button
              key="submit"
              type="primary"
              loading={groupHunterBatchAiLoading}
              onClick={handleExecuteGroupHunterBatchAi}
              className="!bg-gradient-to-r !from-purple-600 !to-indigo-600 font-bold"
            >
              Bắt đầu viết lại ({groupHunterBatchAiProgress.total || groupHunterSelectedIds.size} bài)
            </Button>,
          ]}
        >
          <div className="py-2 space-y-4">
            <p className="text-xs text-slate-300 leading-relaxed mb-0">
              Chọn phong cách diễn đạt bạn muốn Gemini áp dụng cho <b>{groupHunterSelectedIds.size} bài viết</b> đã chọn. Nội dung sau khi viết lại sẽ được dùng làm caption mới khi đưa vào lịch đăng:
            </p>

            <Radio.Group
              value={groupHunterBatchAiMode}
              onChange={(e) => setGroupHunterBatchAiMode(e.target.value)}
              className="w-full space-y-2.5"
            >
              <div className={`p-3 rounded-xl border transition-all cursor-pointer ${groupHunterBatchAiMode === 'REWRITE' ? 'bg-purple-950/30 border-purple-500/60' : 'bg-slate-900/60 border-slate-800'}`}>
                <Radio value="REWRITE" className="font-bold text-slate-200 text-xs">
                  🔄 Viết lại hoàn toàn (Paraphrase) — Chống trùng lặp FB 100%
                </Radio>
                <div className="text-[11px] text-slate-400 pl-6 mt-0.5">
                  Đổi từ ngữ và cấu trúc câu nhưng giữ trọn ý nghĩa và số liệu gốc, giúp bài viết độc bản, không bị Facebook đánh gậy sao chép.
                </div>
              </div>

              <div className={`p-3 rounded-xl border transition-all cursor-pointer ${groupHunterBatchAiMode === 'HOOK' ? 'bg-purple-950/30 border-purple-500/60' : 'bg-slate-900/60 border-slate-800'}`}>
                <Radio value="HOOK" className="font-bold text-slate-200 text-xs">
                  🎣 Thêm Hook giật tít gây tò mò cực mạnh
                </Radio>
                <div className="text-[11px] text-slate-400 pl-6 mt-0.5">
                  Chèn 1-2 câu mở đầu giật gân, khơi gợi trí tò mò hoặc đặt câu hỏi đánh trúng tâm lý, giữ nguyên thân bài.
                </div>
              </div>

              <div className={`p-3 rounded-xl border transition-all cursor-pointer ${groupHunterBatchAiMode === 'ENGAGEMENT' ? 'bg-purple-950/30 border-purple-500/60' : 'bg-slate-900/60 border-slate-800'}`}>
                <Radio value="ENGAGEMENT" className="font-bold text-slate-200 text-xs">
                  💬 Kích thích bình luận &amp; Tranh luận (Engagement Booster)
                </Radio>
                <div className="text-[11px] text-slate-400 pl-6 mt-0.5">
                  Thêm câu hỏi mở thông minh và kêu gọi độc giả bày tỏ quan điểm ở phần bình luận.
                </div>
              </div>

              <div className={`p-3 rounded-xl border transition-all cursor-pointer ${groupHunterBatchAiMode === 'STORYTELLING' ? 'bg-purple-950/30 border-purple-500/60' : 'bg-slate-900/60 border-slate-800'}`}>
                <Radio value="STORYTELLING" className="font-bold text-slate-200 text-xs">
                  📖 Kể chuyện tự nhiên (Storytelling Voice)
                </Radio>
                <div className="text-[11px] text-slate-400 pl-6 mt-0.5">
                  Biến tấu nội dung thành dạng câu chuyện kể hấp dẫn, có diễn biến kịch tính và cảm xúc.
                </div>
              </div>

              <div className={`p-3 rounded-xl border transition-all cursor-pointer ${groupHunterBatchAiMode === 'SHORTEN' ? 'bg-purple-950/30 border-purple-500/60' : 'bg-slate-900/60 border-slate-800'}`}>
                <Radio value="SHORTEN" className="font-bold text-slate-200 text-xs">
                  ✂️ Rút gọn súc tích, cô đọng
                </Radio>
                <div className="text-[11px] text-slate-400 pl-6 mt-0.5">
                  Giữ lại chi tiết đắt giá nhất, loại bỏ câu từ rườm rà giúp người lướt nhanh dễ tiếp thu.
                </div>
              </div>
            </Radio.Group>

            {groupHunterBatchAiLoading && (
              <div className="p-3.5 bg-purple-950/40 border border-purple-500/30 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs text-purple-300 font-semibold">
                  <span>⚡ Đang viết lại bài {groupHunterBatchAiProgress.current} / {groupHunterBatchAiProgress.total}...</span>
                  <span>{Math.round((groupHunterBatchAiProgress.current / (groupHunterBatchAiProgress.total || 1)) * 100)}%</span>
                </div>
                <Progress
                  percent={Math.round((groupHunterBatchAiProgress.current / (groupHunterBatchAiProgress.total || 1)) * 100)}
                  showInfo={false}
                  strokeColor={{ '0%': '#a855f7', '100%': '#6366f1' }}
                />
              </div>
            )}
          </div>
        </Modal>

        {/* Modal Xem & Chỉnh Sửa Trực Tiếp Bài Viết */}
        <Modal
          title={
            <div className="flex items-center justify-between pr-6">
              <div className="flex items-center gap-2">
                <EyeOutlined className="text-blue-400 text-lg" />
                <span className="font-bold text-white">Xem &amp; Chỉnh Sửa Bài Viết</span>
              </div>
              {groupHunterPreviewItem?.url && (
                <a
                  href={groupHunterPreviewItem.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 font-mono underline"
                >
                  Mở link gốc Facebook ↗
                </a>
              )}
            </div>
          }
          open={Boolean(groupHunterPreviewItem)}
          onCancel={() => setGroupHunterPreviewItem(null)}
          width={700}
          footer={[
            <Button key="close" onClick={() => setGroupHunterPreviewItem(null)}>
              Đóng
            </Button>,
            <Button
              key="cleanSpam"
              icon={<ClearOutlined />}
              onClick={() => {
                if (!groupHunterPreviewItem) return;
                let text = groupHunterPreviewItem.caption || '';
                text = text.replace(/https?:\/\/[^\s]+/gi, '');
                text = text.replace(/(?:zalo|sđt|sdt|hotline|liên hệ|call|lh|tel)[\s:.-]*[0-9]{8,12}/gi, '');
                text = text.replace(/\b0[235789][0-9]{8}\b/g, '');
                text = text.replace(/(?:stk|số tài khoản|ngân hàng|mbbank|vietcombank|techcombank)[\s:.-]*[0-9]{6,16}/gi, '');
                text = text.replace(/(?:vào group|link nhóm|nhóm thảo luận|tele(?:gram)?|theo dõi fanpage)[:\s]+[^\n]+/gi, '');
                text = text.replace(/\n{3,}/g, '\n\n').trim();
                setGroupHunterPreviewItem({ ...groupHunterPreviewItem, caption: text });
                setGroupHunterResults((prev) =>
                  prev.map((it) => (it.id === groupHunterPreviewItem.id ? { ...it, caption: text } : it))
                );
                message.success('🧹 Đã làm sạch SĐT, link và STK của bài này!');
              }}
              className="text-xs font-semibold bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
            >
              Làm sạch rác
            </Button>,
            groupHunterPreviewItem?.suggestedHook && (
              <Button
                key="applyHook"
                onClick={() => {
                  if (!groupHunterPreviewItem?.suggestedHook) return;
                  const newCaption = `${groupHunterPreviewItem.suggestedHook}\n\n${groupHunterPreviewItem.caption}`;
                  setGroupHunterPreviewItem({ ...groupHunterPreviewItem, caption: newCaption, aiRewritten: true });
                  setGroupHunterResults((prev) =>
                    prev.map((it) => (it.id === groupHunterPreviewItem.id ? { ...it, caption: newCaption, aiRewritten: true } : it))
                  );
                  message.success('🎣 Đã chèn Hook mở đầu!');
                }}
                className="text-xs font-semibold bg-amber-500/10 text-amber-300 border-amber-500/30"
              >
                Chèn Hook AI
              </Button>
            ),
            <Button
              key="save"
              type="primary"
              onClick={() => {
                message.success('✅ Đã lưu cập nhật cho bài viết!');
                setGroupHunterPreviewItem(null);
              }}
              className="!bg-blue-600 font-bold"
            >
              Lưu thay đổi
            </Button>,
          ]}
        >
          {groupHunterPreviewItem && (
            <div className="py-2 space-y-4">
              {/* Ảnh / Video Media Preview */}
              {groupHunterPreviewItem.images && groupHunterPreviewItem.images.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800 max-h-60 overflow-y-auto">
                  {groupHunterPreviewItem.images.map((img: string, i: number) => (
                    <div key={i} className="rounded-lg overflow-hidden bg-slate-900 border border-slate-800 h-28">
                      <img src={img} alt={`media-${i}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              ) : groupHunterPreviewItem.previewCover ? (
                <div className="rounded-xl overflow-hidden bg-slate-950 border border-slate-800 max-h-64 flex items-center justify-center">
                  <img src={groupHunterPreviewItem.previewCover} alt="cover" className="max-h-64 object-contain" />
                </div>
              ) : null}

              {/* Thông tin tác giả & Thời gian */}
              <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
                <div>
                  👤 Tác giả: <strong className="text-blue-300">{groupHunterPreviewItem.author || 'Thành viên'}</strong>
                </div>
                <div>
                  ⏰ Thời gian: <strong className="text-slate-200">{groupHunterPreviewItem.postedTime || 'Gần đây'}</strong>
                </div>
              </div>

              {/* Caption Textarea cho phép chỉnh sửa */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-bold text-slate-200">Nội dung Caption (Có thể chỉnh sửa trực tiếp):</label>
                  {groupHunterPreviewItem.caption && (
                    <span className="text-[11px] text-slate-400">{groupHunterPreviewItem.caption.length} ký tự</span>
                  )}
                </div>
                <Input.TextArea
                  rows={6}
                  value={groupHunterPreviewItem.caption || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setGroupHunterPreviewItem({ ...groupHunterPreviewItem, caption: val });
                    setGroupHunterResults((prev) =>
                      prev.map((it) => (it.id === groupHunterPreviewItem.id ? { ...it, caption: val } : it))
                    );
                  }}
                  className="bg-slate-950 border-slate-800 text-slate-200 rounded-xl"
                  placeholder="Nhập nội dung bài viết..."
                />
              </div>
            </div>
          )}
        </Modal>
      </Drawer>

      {/* Modal Kiểm tra & Xin vào Nhóm Facebook */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <TeamOutlined className="text-blue-500 text-lg" />
            <span className="font-bold">Kiểm Tra Tư Cách Thành Viên & Sức Khỏe Nhóm Facebook</span>
          </div>
        }
        open={groupCheckModalVisible}
        onCancel={() => setGroupCheckModalVisible(false)}
        width={750}
        footer={[
          <Button key="close" onClick={() => setGroupCheckModalVisible(false)}>
            Đóng
          </Button>,
          <Button
            key="scanAll"
            icon={<SyncOutlined spin={checkAllGroupsMutation.isPending} />}
            loading={checkAllGroupsMutation.isPending}
            onClick={() => checkAllGroupsMutation.mutate()}
            type="primary"
            className="!bg-blue-600 font-bold"
          >
            Quét tất cả nhóm
          </Button>,
        ]}
      >
        <div className="py-2 space-y-4">
          <Alert
            type="info"
            showIcon
            message="Điều kiện đăng bài vào Group Facebook"
            description="Để đăng bài vào Group tự động không bị lỗi, Fanpage hoặc Nick cá nhân của bạn bắt buộc phải là Thành viên của Group đó và có quyền đăng bài (ô tạo bài viết sẵn sàng)."
            className="rounded-xl mb-3"
          />

          <Table
            dataSource={groupAccountsWithId}
            rowKey="id"
            pagination={false}
            size="small"
            columns={[
              {
                title: 'Tên Nhóm Facebook',
                key: 'name',
                render: (_, g) => (
                  <div>
                    <div className="font-semibold text-slate-200">{stripEmojiPrefix(g.pageName)}</div>
                    <div className="text-xs text-slate-400">ID: {g.platformAccountId}</div>
                  </div>
                ),
              },
              {
                title: 'Trạng thái Thành viên',
                key: 'status',
                render: (_, g) => {
                  const status = g.groupHealthStatus;
                  if (status === 'JOINED') {
                    return <Tag color="success" icon={<CheckCircleOutlined />} className="!rounded-full font-bold">Đã vào nhóm</Tag>;
                  }
                  if (status === 'PENDING_APPROVAL') {
                    return <Tag color="warning" icon={<ClockCircleOutlined />} className="!rounded-full font-bold">Chờ duyệt</Tag>;
                  }
                  if (status === 'KICKED_OR_NOT_JOINED') {
                    return <Tag color="error" icon={<CloseCircleOutlined />} className="!rounded-full font-bold">Chưa tham gia</Tag>;
                  }
                  if (status === 'PRIVATE_NO_ACCESS') {
                    return <Tag color="default" icon={<StopOutlined />} className="!rounded-full font-bold">Kín / Bị chặn</Tag>;
                  }
                  return <Tag color="default" className="!rounded-full font-bold">Chưa kiểm tra</Tag>;
                },
              },
              {
                title: 'Kiểm tra dưới danh nghĩa',
                key: 'identity',
                render: (_, g) => {
                  const identity = groupIdentityMap.get(g.id);
                  return (
                    <Select
                      size="small"
                      placeholder="Chọn Trang/Nick"
                      value={identity?.id ?? undefined}
                      onChange={(val) => setGroupIdentityMutation.mutate({ groupId: g.id, fanpageConnectionId: val ?? null })}
                      allowClear
                      loading={setGroupIdentityMutation.isPending}
                      className="w-36"
                      options={kpiFanpageAccounts.map((fp) => ({ value: fp.id, label: fp.pageName || `#${fp.id}` }))}
                    />
                  );
                },
              },
              {
                title: 'Thao tác',
                key: 'action',
                render: (_, g) => {
                  const isChecking = groupCheckingMap[g.id];
                  const isJoining = groupJoiningMap[g.id];
                  return (
                    <Space size="small">
                      <Button
                        size="small"
                        icon={<SyncOutlined spin={isChecking} />}
                        loading={isChecking}
                        onClick={() => checkSingleGroupMutation.mutate(g.id)}
                      >
                        Kiểm tra
                      </Button>
                      {g.groupHealthStatus !== 'JOINED' && (
                        <Button
                          size="small"
                          type="primary"
                          className="!bg-emerald-600 font-bold"
                          icon={<TeamOutlined />}
                          loading={isJoining}
                          onClick={() => joinGroupMutation.mutate(g.id)}
                        >
                          Xin vào nhóm
                        </Button>
                      )}
                    </Space>
                  );
                },
              },
            ]}
          />
        </div>
      </Modal>

      {/* Quick Update Cookie Modal */}
      <QuickUpdateCookieModal
        open={quickCookieModalOpen}
        onClose={() => setQuickCookieModalOpen(false)}
        targetAccountId={quickCookieTargetId}
      />

      {/* Modal Nhập Cre Custom (Tùy chỉnh nội dung Cre hàng loạt / đơn lẻ) */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-slate-100 font-bold text-base">
            <EditOutlined className="text-purple-400" />
            <span>{customCreTargetItemId ? 'Gán Cre tùy chỉnh cho bài viết này' : 'Gán Cre tùy chỉnh hàng loạt (Tất cả bài)'}</span>
          </div>
        }
        open={isCustomCreModalOpen}
        onCancel={() => setIsCustomCreModalOpen(false)}
        onOk={() => applyCustomCreditToPosts(customCreInput)}
        okText="Áp dụng ngay"
        cancelText="Hủy"
        okButtonProps={{
          className: 'bg-purple-600 hover:bg-purple-500 font-bold border-none shadow-sm',
        }}
        destroyOnClose
        centered
        className="custom-cre-modal"
      >
        <div className="space-y-4 py-2">
          <Alert
            type="info"
            showIcon
            message={
              customCreTargetItemId
                ? 'Nội dung này sẽ được chèn thành "Cre: [Nội dung]" vào cuối caption bài viết đã chọn.'
                : `Nội dung này sẽ được chèn thành "Cre: [Nội dung]" vào cuối caption cho TOÀN BỘ ${linkItems.length} bài viết.`
            }
            className="bg-purple-950/40 border-purple-800/40 text-purple-200 text-xs"
          />

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300">
              Nhập nội dung Cre mong muốn (Ví dụ: Sưu tầm, ST, Nguồn TikTok @xxx...):
            </label>
            <Input
              placeholder="VD: Sưu tầm, ST, Fanpage ABC, TikTok @cuocsongdoithuong..."
              value={customCreInput}
              onChange={(e) => setCustomCreInput(e.target.value)}
              onPressEnter={() => applyCustomCreditToPosts(customCreInput)}
              allowClear
              autoFocus
              className="bg-slate-900 border-slate-700 text-slate-100 text-sm h-10 rounded-lg placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-bold text-slate-400">Gợi ý nhanh (Bấm để chọn ngay):</div>
            <div className="flex flex-wrap gap-1.5">
              {['Sưu tầm', 'ST', 'Nguồn tổng hợp', 'Internet', 'Gia đình', 'Fanpage', 'TikTok'].map((preset) => (
                <Tag
                  key={preset}
                  color="purple"
                  className="cursor-pointer hover:opacity-80 px-2.5 py-1 rounded-md text-xs font-semibold select-none transition-all"
                  onClick={() => {
                    setCustomCreInput(preset);
                  }}
                >
                  + Cre: {preset}
                </Tag>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* Modal Nhập Hashtag Hàng Loạt / Đơn Lẻ */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-slate-100 font-bold text-base">
            <TagOutlined className="text-pink-400" />
            <span>{hashtagTargetItemId ? 'Thêm Hashtag cho bài viết này' : 'Gán Hashtag hàng loạt (Tất cả bài)'}</span>
          </div>
        }
        open={isHashtagModalOpen}
        onCancel={() => setIsHashtagModalOpen(false)}
        onOk={() => applyHashtagsToPosts(hashtagInput)}
        okText="Áp dụng ngay"
        cancelText="Hủy"
        okButtonProps={{
          className: 'bg-pink-600 hover:bg-pink-500 font-bold border-none shadow-sm',
        }}
        destroyOnClose
        centered
        className="custom-hashtag-modal"
      >
        <div className="space-y-4 py-2">
          <Alert
            type="info"
            showIcon
            message={
              hashtagTargetItemId
                ? 'Hashtag sẽ được chèn vào cuối caption (nếu có dòng Cre thì Hashtag sẽ nằm phía trên Cre).'
                : `Hashtag sẽ được chèn vào cuối caption cho TOÀN BỘ ${linkItems.length} bài viết.`
            }
            className="bg-pink-950/40 border-pink-800/40 text-pink-200 text-xs"
          />

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300">
              Nhập các Hashtag (Cách nhau bằng dấu phẩy hoặc khoảng trắng):
            </label>
            <Input.TextArea
              rows={3}
              placeholder="VD: #Trending #Review #GiaDinh #AmThuc hoặc trending, review, amthuc..."
              value={hashtagInput}
              onChange={(e) => setHashtagInput(e.target.value)}
              allowClear
              autoFocus
              className="bg-slate-900 border-slate-700 text-slate-100 text-sm rounded-lg placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-bold text-slate-400">Gợi ý chủ đề Hashtag phổ biến (Bấm để chọn thêm):</div>
            <div className="flex flex-wrap gap-1.5">
              {[
                '#Trending', '#Viral', '#Review', '#HotTrend', '#ChiaSe',
                '#AmThuc', '#DuLich', '#MeoHay', '#GocNhin', '#ChuyenThuCung',
                '#CuocSong', '#ThuVi', '#GiaiTri', '#KhuyenMai', '#SaleOff'
              ].map((tag) => {
                const isSelected = hashtagInput.includes(tag);
                return (
                  <Tag
                    key={tag}
                    color={isSelected ? 'pink' : 'default'}
                    className={`cursor-pointer px-2.5 py-1 rounded-md text-xs font-semibold select-none transition-all ${isSelected ? 'bg-pink-600 text-white border-pink-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                    onClick={() => {
                      if (isSelected) {
                        setHashtagInput((prev) => prev.replace(tag, '').replace(/\s+/g, ' ').trim());
                      } else {
                        setHashtagInput((prev) => (prev ? `${prev.trim()} ${tag}` : tag));
                      }
                    }}
                  >
                    {isSelected ? '✓ ' : '+ '} {tag}
                  </Tag>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>

      {/* Modal Chia Đều Tỉ Lệ Fanpage / Nick Cho Danh Sách Bài Viết */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-slate-100 font-bold text-base">
            <ShareAltOutlined className="text-emerald-400 text-lg" />
            <span>Chia đều tỉ lệ Fanpage / Nick cho {linkItems.length} bài viết</span>
          </div>
        }
        open={distributeModalOpen}
        onCancel={() => setDistributeModalOpen(false)}
        onOk={applyEqualDistributionToPosts}
        okText={`⚡ Áp dụng chia đều cho ${linkItems.length} bài`}
        cancelText="Hủy"
        okButtonProps={{
          className: '!bg-emerald-600 hover:!bg-emerald-500 font-bold border-none shadow-sm h-10 px-5 text-sm rounded-xl',
          disabled: selectedDistributePages.length === 0,
        }}
        destroyOnClose={false}
        centered
        width={680}
        className="custom-distribute-modal"
      >
        <div className="space-y-4 py-2">
          <Alert
            type="info"
            showIcon
            message={
              <div className="text-xs leading-relaxed">
                Bạn đang có <b className="text-emerald-300 font-mono">{linkItems.length} bài viết</b>.
                Hãy chọn các Fanpage hoặc Nick cá nhân bên dưới, hệ thống sẽ tự động <b>chia đều xoay vòng (Bài 1 ➔ Page A, Bài 2 ➔ Page B, Bài 3 ➔ Page C...)</b> và điền thẳng vào ô nơi đăng của từng bài viết bên dưới!
              </div>
            }
            className="!bg-emerald-950/40 !border-emerald-800/40 text-emerald-200 text-xs rounded-xl"
          />

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-300">
                Chọn các Fanpage / Nick cá nhân muốn chia bài:
              </label>
              <Space size="small">
                <Button
                  size="small"
                  type="link"
                  className="!p-0 text-xs text-emerald-400 font-bold"
                  onClick={() => setSelectedDistributePages(postingIdentities.map((a) => accountTargetValue(a)))}
                >
                  Chọn tất cả ({postingIdentities.length})
                </Button>
                <span className="text-slate-600">|</span>
                <Button
                  size="small"
                  type="link"
                  className="!p-0 text-xs text-blue-400"
                  onClick={() =>
                    setSelectedDistributePages(
                      postingIdentities
                        .filter((a) => a.platformAccountId !== 'PERSONAL_PROFILE' && a.platform !== 'FACEBOOK_PERSONAL')
                        .map((a) => accountTargetValue(a))
                    )
                  }
                >
                  Chỉ Fanpage
                </Button>
                <span className="text-slate-600">|</span>
                <Button
                  size="small"
                  type="link"
                  className="!p-0 text-xs text-purple-400"
                  onClick={() =>
                    setSelectedDistributePages(
                      postingIdentities
                        .filter((a) => a.platformAccountId === 'PERSONAL_PROFILE' || a.platform === 'FACEBOOK_PERSONAL')
                        .map((a) => accountTargetValue(a))
                    )
                  }
                >
                  Chỉ Nick cá nhân
                </Button>
                <span className="text-slate-600">|</span>
                <Button
                  size="small"
                  type="link"
                  className="!p-0 text-xs text-slate-400"
                  onClick={() => setSelectedDistributePages([])}
                >
                  Bỏ chọn
                </Button>
              </Space>
            </div>

            <Select
              mode="multiple"
              size="large"
              placeholder="Chọn các Fanpage/Nick để chia đều..."
              value={selectedDistributePages}
              onChange={(vals) => setSelectedDistributePages(vals)}
              className="w-full"
              optionFilterProp="label"
              filterOption={(input, option) => {
                const label = String(option?.label || '').toLowerCase();
                const query = input.toLowerCase();
                if (label.includes(query)) return true;
                const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                return strip(label).includes(strip(query));
              }}
              maxTagCount={4}
            >
              {postingIdentities.map((acc) => {
                const val = accountTargetValue(acc);
                const isPersonal = acc.platformAccountId === 'PERSONAL_PROFILE' || acc.platform === 'FACEBOOK_PERSONAL';
                return (
                  <Option key={acc.id} value={val} label={accountSearchLabel(acc)}>
                    <div className="flex items-center justify-between py-0.5">
                      <span className={isPersonal ? 'text-indigo-400 font-bold' : 'text-slate-200'}>
                        {isPersonal ? `👤 ${acc.pageName || 'Nick Cá Nhân'}` : `🚩 ${acc.pageName || acc.platformAccountId}`}
                        {viaNameOf(acc) && <span className="ml-1.5 text-[11px] font-normal text-slate-400">· {viaNameOf(acc)}</span>}
                      </span>
                    </div>
                  </Option>
                );
              })}
            </Select>
          </div>

          {/* Bảng tính toán tỉ lệ phân bổ dự kiến */}
          {selectedDistributePages.length > 0 && (
            <div className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                <span>Dự kiến phân chia tỉ lệ:</span>
                <span className="text-emerald-400 font-mono">
                  {linkItems.length} bài ÷ {selectedDistributePages.length} kênh = ~
                  {(linkItems.length / selectedDistributePages.length).toFixed(1)} bài/kênh
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                {selectedDistributePages.map((targetVal, pIdx) => {
                  const matchedAcc = postingIdentities.find((a) => accountTargetValue(a) === targetVal);
                  const isPersonal = matchedAcc?.platformAccountId === 'PERSONAL_PROFILE' || matchedAcc?.platform === 'FACEBOOK_PERSONAL';
                  const assignedCount = linkItems.filter((_, idx) => idx % selectedDistributePages.length === pIdx).length;
                  const assignedIndices = linkItems
                    .map((_, idx) => (idx % selectedDistributePages.length === pIdx ? idx + 1 : null))
                    .filter((n): n is number => n !== null);

                  return (
                    <div
                      key={targetVal}
                      className="p-2 rounded-lg bg-slate-950/70 border border-slate-800/80 flex items-center justify-between text-xs"
                    >
                      <div className="min-w-0 pr-2">
                        <div className={`font-bold truncate ${isPersonal ? 'text-indigo-400' : 'text-slate-200'}`}>
                          {isPersonal ? '👤 ' : '🚩 '}
                          {matchedAcc?.pageName || targetVal}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          Bài #{assignedIndices.join(', #')}
                        </div>
                      </div>
                      <Tag color="cyan" className="!rounded-md font-mono font-bold shrink-0">
                        {assignedCount} bài
                      </Tag>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Drawer Cào & Biên Tập Bài Báo Đa Lĩnh Vực Rộng 95vw Trực Quan */}
      <Drawer
        title={
          <div className="flex items-center justify-between text-base font-bold text-slate-100 pr-6">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📰</span>
              <span className="text-lg">Hệ Thống Săn Tin Tức Tự Động 24/7 & AI Biên Tập Đa Lĩnh Vực</span>
            </div>
            <Tag color="purple" className="font-bold border-0 text-xs px-3 py-1 rounded-lg">
              Giao Diện 95% Màn Hình Rộng Rãi
            </Tag>
          </div>
        }
        open={showArticleBatchModal}
        onClose={() => setShowArticleBatchModal(false)}
        width="95vw"
        destroyOnClose
        className="dark-theme-drawer"
        extra={
          <Button
            type="primary"
            icon={<RocketOutlined />}
            loading={isScrapingArticleBatch}
            onClick={() => handleBatchScrapeArticlesToForm()}
            className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border-0 font-bold rounded-xl h-9 px-5 text-sm"
          >
            🚀 Cào & Nạp {scrapedNewsItems.filter(i => i.selected).length > 0 ? `${scrapedNewsItems.filter(i => i.selected).length} Bài Đã Chọn` : 'Các Bài Báo'} Vào Form Đăng
          </Button>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-slate-200">
          {/* CỘT TRÁI (lg:col-span-5): CHỌN CHỦ ĐỀ, KÊNH BÁO VÀ CẤU HÌNH AI */}
          <div className="lg:col-span-5 space-y-4">
            <Alert
              type="info"
              showIcon
              message="Hệ thống cào tin tức Đa Lĩnh Vực: Tự động bóc tách full nội dung & album ảnh từ bất kỳ trang báo hay chuyên mục nào"
              description="Hỗ trợ BĐS, Công nghệ, Tài chính, Thể thao, Sức khỏe... trên CafeF, VnExpress, Tuoitre, Dantri, Batdongsan, ZNews..."
              className="!bg-blue-950/60 !border-blue-700/50 !text-blue-200 rounded-2xl"
            />

            {/* Thanh Giám Sát Tin Tức Rada 24/7 */}
            <div className="p-4 bg-gradient-to-r from-blue-950/80 via-indigo-950/80 to-slate-900 rounded-2xl border border-blue-700/60 shadow-lg space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-blue-200 flex items-center gap-1.5 uppercase tracking-wider">
                    <span className="animate-pulse text-emerald-400">📡</span> RADA THEO DÕI TIN TỨC MỚI 24/7:
                  </span>
                  {radarLastSweepTime && (
                    <Tag color="cyan" className="text-[10px] font-bold border-0 px-2 py-0.5 rounded-full">
                      Vừa quét: {radarLastSweepTime}
                    </Tag>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={radarAutoRefresh}
                    onChange={(e) => {
                      setRadarAutoRefresh(e.target.checked);
                      if (e.target.checked) {
                        message.info(`⚡ Đã bật Tự động quét lại toàn bộ kênh mỗi ${radarAutoRefreshMinutes} phút`);
                      }
                    }}
                    className="text-xs text-blue-300 font-bold"
                  >
                    ⚡ Quét tự động
                  </Checkbox>
                  <Select
                    size="small"
                    value={radarAutoRefreshMinutes}
                    onChange={(v) => setRadarAutoRefreshMinutes(v)}
                    disabled={!radarAutoRefresh}
                    className="w-24"
                    title="Chu kỳ tự động cào lại — chọn thưa hơn để đỡ tốn tài nguyên máy"
                  >
                    <Option value={5}>5 phút</Option>
                    <Option value={15}>15 phút</Option>
                    <Option value={30}>30 phút</Option>
                    <Option value={60}>60 phút</Option>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-blue-900/60 text-xs">
                <Input
                  size="small"
                  placeholder="🔍 Lọc tin theo từ khóa (VD: quy hoạch, chung cư, AI, giá đất...)..."
                  value={radarSearchKeyword}
                  onChange={(e) => setRadarSearchKeyword(e.target.value)}
                  allowClear
                  className="text-xs bg-slate-950/80 border-slate-700 text-slate-100 rounded-xl flex-1"
                />
                <Button
                  type="primary"
                  icon={<SearchOutlined />}
                  loading={isRadarSweeping}
                  onClick={() => handleRunRadarSweep()}
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 font-bold text-xs rounded-xl h-8 px-3 border-0 shrink-0 shadow-md"
                >
                  {isRadarSweeping ? 'Đang Quét Radar...' : '📡 Quét Đa Kênh Ngay'}
                </Button>
              </div>
            </div>

            {/* Tab Chọn Chủ Đề & Kênh Báo */}
            <div className="p-4 bg-slate-900/90 rounded-2xl border border-slate-800 space-y-4 shadow-md">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5 uppercase tracking-wider">
                  <span>🎯 1. Chọn Chủ Đề & Kênh Báo Muốn Quét:</span>
                </span>
              </div>

              {/* Sub-tabs category selection */}
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="middle"
                  type={activeCategoryTab === 'pickleball' ? 'primary' : 'default'}
                  onClick={() => setActiveCategoryTab('pickleball')}
                  className={`text-xs font-bold rounded-xl ${activeCategoryTab === 'pickleball' ? 'bg-emerald-600 border-0 shadow-md' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
                >
                  🏓 Pickleball (Mới)
                </Button>
                <Button
                  size="middle"
                  type={activeCategoryTab === 'finance' ? 'primary' : 'default'}
                  onClick={() => setActiveCategoryTab('finance')}
                  className={`text-xs font-bold rounded-xl ${activeCategoryTab === 'finance' ? 'bg-amber-600 border-0 shadow-md' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
                >
                  📈 Tài Chính & Kinh Tế
                </Button>
                <Button
                  size="middle"
                  type={activeCategoryTab === 'lifestyle' ? 'primary' : 'default'}
                  onClick={() => setActiveCategoryTab('lifestyle')}
                  className={`text-xs font-bold rounded-xl ${activeCategoryTab === 'lifestyle' ? 'bg-rose-600 border-0 shadow-md' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
                >
                  📰 Báo Lớn & Thời Sự
                </Button>
                <Button
                  size="middle"
                  type={activeCategoryTab === 'bds' ? 'primary' : 'default'}
                  onClick={() => setActiveCategoryTab('bds')}
                  className={`text-xs font-bold rounded-xl ${activeCategoryTab === 'bds' ? 'bg-orange-600 border-0 shadow-md' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
                >
                  🏢 Bất Động Sản
                </Button>
                <Button
                  size="middle"
                  type={activeCategoryTab === 'tech' ? 'primary' : 'default'}
                  onClick={() => setActiveCategoryTab('tech')}
                  className={`text-xs font-bold rounded-xl ${activeCategoryTab === 'tech' ? 'bg-purple-600 border-0 shadow-md' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
                >
                  💻 Công Nghệ & AI
                </Button>
                <Button
                  size="middle"
                  type={activeCategoryTab === 'health' ? 'primary' : 'default'}
                  onClick={() => setActiveCategoryTab('health')}
                  className={`text-xs font-bold rounded-xl ${activeCategoryTab === 'health' ? 'bg-teal-600 border-0 shadow-md' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
                >
                  🏥 Sức Khỏe
                </Button>
                <Button
                  size="middle"
                  type={activeCategoryTab === 'custom' ? 'primary' : 'default'}
                  onClick={() => setActiveCategoryTab('custom')}
                  className={`text-xs font-bold rounded-xl ${activeCategoryTab === 'custom' ? 'bg-blue-600 border-0 shadow-md' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
                >
                  🌐 Chuyên Mục Tùy Chỉnh
                </Button>
              </div>

              {/* Danh sách Kênh Báo Động theo Tab */}
              <div className="space-y-3 pt-2">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-bold text-xs">Kênh Báo Uy Tín 1-click (Bấm để quét):</span>
                    <Button
                      size="small"
                      type="dashed"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        setNewChannelCategory((activeCategoryTab as any) || 'bds');
                        setShowAddChannelModal(true);
                      }}
                      className="text-[11px] text-blue-400 border-blue-600/60 hover:bg-blue-950/50 rounded-lg font-semibold"
                    >
                      + Thêm Kênh Mới
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1">
                    {customChannels
                      .filter((c) => c.category === activeCategoryTab && c.type === 'category')
                      .map((ch) => (
                        <Tooltip
                          key={ch.id}
                          title={
                            <div className="text-xs p-0.5">
                              <div className="font-bold text-blue-300">{ch.name}</div>
                              <div className="font-mono text-[11px] text-slate-300 break-all">{ch.url}</div>
                            </div>
                          }
                          placement="top"
                        >
                          <Tag
                            color="blue"
                            closable={!ch.id.startsWith('def_')}
                            onClose={(e) => {
                              e.stopPropagation();
                              handleDeleteCustomChannel(ch.id, ch.name);
                            }}
                            className="cursor-pointer hover:opacity-80 font-bold px-3 py-1 rounded-xl my-0.5 text-xs inline-flex items-center gap-1 shadow-xs border-0"
                            onClick={() => handleFetchCategoryPreset(ch.url)}
                          >
                            <span>{ch.name}</span>
                          </Tag>
                        </Tooltip>
                      ))}
                  </div>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-slate-800">
                  <span className="text-emerald-400 font-bold text-xs">📡 RSS Feed 24/7 (Cập nhật cực nhanh):</span>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1">
                    {customChannels
                      .filter((c) => c.category === activeCategoryTab && c.type === 'rss')
                      .map((ch) => (
                        <Tooltip
                          key={ch.id}
                          title={
                            <div className="text-xs p-0.5">
                              <div className="font-bold text-emerald-300">{ch.name}</div>
                              <div className="font-mono text-[11px] text-slate-300 break-all">{ch.url}</div>
                            </div>
                          }
                          placement="top"
                        >
                          <Tag
                            color="green"
                            closable={!ch.id.startsWith('def_')}
                            onClose={(e) => {
                              e.stopPropagation();
                              handleDeleteCustomChannel(ch.id, ch.name);
                            }}
                            className="cursor-pointer hover:opacity-80 font-bold px-2.5 py-0.5 rounded-xl my-0.5 text-xs inline-flex items-center gap-1 border-0"
                            onClick={() => handleFetchRssPreset(ch.url)}
                          >
                            <span>{ch.name}</span>
                          </Tag>
                        </Tooltip>
                      ))}
                  </div>
                </div>

                {/* Nút Xem Chi Tiết URL Khai Báo */}
                <div className="pt-2 border-t border-slate-800/80">
                  <Button
                    type="link"
                    size="small"
                    icon={<SearchOutlined />}
                    onClick={() => setShowChannelUrlList(!showChannelUrlList)}
                    className="p-0 text-[11px] text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1"
                  >
                    {showChannelUrlList ? '▼ Ẩn danh sách đường link URL khai báo' : '🔍 Xem chi tiết đường link URL khai báo cho từng kênh nút bấm'}
                  </Button>

                  {showChannelUrlList && (
                    <div className="mt-2.5 p-3 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2">
                      <div className="text-[11px] font-bold text-slate-300 pb-1 border-b border-slate-800/80 flex items-center justify-between">
                        <span>🔗 ĐƯỜNG LINK KHAI BÁO CỦA CÁC KÊNH [{activeCategoryTab.toUpperCase()}]:</span>
                        <span className="text-[10px] text-slate-500 font-normal">Rê chuột vào nút bấm để xem nhanh</span>
                      </div>
                      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                        {customChannels
                          .filter((c) => c.category === activeCategoryTab)
                          .map((ch) => (
                            <div key={ch.id} className="flex items-center justify-between gap-2 p-1.5 bg-slate-900/60 rounded-lg border border-slate-800/50 text-xs">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-slate-200 text-xs truncate">{ch.name}</span>
                                  <Tag color={ch.type === 'rss' ? 'green' : 'blue'} className="text-[10px] border-0 px-1.5 py-0 rounded">
                                    {ch.type === 'rss' ? 'RSS 24/7' : 'Web Scraper'}
                                  </Tag>
                                </div>
                                <a
                                  href={ch.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] font-mono text-blue-400 hover:underline truncate block"
                                >
                                  {ch.url}
                                </a>
                              </div>
                              <Button
                                size="small"
                                type="text"
                                onClick={() => {
                                  navigator.clipboard.writeText(ch.url);
                                  message.success(`Đã copy link của ${ch.name}`);
                                }}
                                className="text-[10px] text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded px-2 h-6 shrink-0"
                              >
                                Copy Link
                              </Button>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {activeCategoryTab === 'custom' && (
                <div className="space-y-2 pt-3 border-t border-slate-800">
                  <label className="block text-xs font-semibold text-slate-300">
                    Dán đường link Chuyên mục báo hoặc luồng RSS bất kỳ:
                  </label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="VD: https://vnexpress.net/oto-xe-may hoặc https://cafef.vn/thi-truong.chn"
                      value={customCategoryInputUrl}
                      onChange={(e) => setCustomCategoryInputUrl(e.target.value)}
                      className="text-xs bg-slate-950 border-slate-700 text-slate-100 rounded-xl"
                    />
                    <Button
                      type="primary"
                      icon={<SearchOutlined />}
                      onClick={() => {
                        if (!customCategoryInputUrl.trim()) {
                          message.warning('Vui lòng dán đường link chuyên mục!');
                          return;
                        }
                        if (customCategoryInputUrl.includes('.rss')) {
                          handleFetchRssPreset(customCategoryInputUrl.trim());
                        } else {
                          handleFetchCategoryPreset(customCategoryInputUrl.trim());
                        }
                      }}
                      className="bg-blue-600 hover:bg-blue-500 font-bold text-xs rounded-xl h-9 px-4 shrink-0 border-0"
                    >
                      Quét 10 bài mới nhất
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Cấu hình Gemini AI biên tập bài */}
            <div className="p-4 bg-slate-900/90 rounded-2xl border border-slate-800 space-y-3 shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5 uppercase tracking-wider">
                  🤖 2. Cấu Hình Gemini AI Biên Tập Bài Viết:
                </span>
                <Checkbox
                  checked={articleBatchEnableAi}
                  onChange={(e) => setArticleBatchEnableAi(e.target.checked)}
                  className="text-xs text-slate-300 font-bold"
                >
                  Bật AI Viết Lại (Tắt = Giữ 100% nguyên văn bài gốc)
                </Checkbox>
              </div>

              {articleBatchEnableAi && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Phong cách biên tập lại nội dung:
                  </label>
                  <Select
                    value={articleBatchAiStyle}
                    onChange={(val) => setArticleBatchAiStyle(val)}
                    className="w-full text-xs"
                    options={[
                      { label: '🏓 [Group Pickleball] Tranh Luận & Thảo Luận Sôi Nổi (Kéo 100+ Bình Luận)', value: 'PICKLEBALL_GROUP_DEBATE' },
                      { label: '🏓 [Group Pickleball] Chia Sẻ Kỹ Thuật, Mẹo Dink/Drop & Luật Chơi', value: 'PICKLEBALL_TIPS_TECH' },
                      { label: '🏓 [Group Pickleball] Review Vợt Carbon, Giày & Dụng Cụ Sân Bãi', value: 'PICKLEBALL_GEAR_REVIEW' },
                      { label: '🏓 [Group Pickleball] Tin Nóng Giải Đấu (PPA/World Cup) & Tuyển Thủ', value: 'PICKLEBALL_TOURNAMENT' },
                      { label: '🏓 [Group Pickleball] Mẫu Bài Tìm Kèo Ghép Sân & Giao Lưu CLB', value: 'PICKLEBALL_FIND_MATCH' },
                      { label: '🔥 Bài viết Fanpage chuyên nghiệp (Icon + Call-to-Action)', value: 'FANPAGE_POST' },
                      { label: '🏢 Bài đăng Nhóm FB Mua Bán / Chia Sẻ Kinh Nghiệm', value: 'GROUP_SALE' },
                      { label: '📊 Phân tích chuyên sâu cho Chuyên gia', value: 'EXPERT_ANALYSIS' },
                      { label: '⚡ Kịch bản ngắn Tik Tok / Reels / Shorts', value: 'TIKTOK_SCRIPT' },
                      { label: '📲 Tóm tắt tin nhanh gửi Zalo / Telegram', value: 'ZALO_TELEGRAM' },
                      { label: '📰 Tóm tắt tin tức ngắn gọn chính xác', value: 'NEWS_SUMMARY' },
                    ]}
                  />
                </div>
              )}
            </div>

            {/* Toggle xem URL thô nâng cao */}
            <div className="p-3 bg-slate-900/90 rounded-2xl border border-slate-800">
              <Button
                type="link"
                size="small"
                onClick={() => setShowRawUrlArea(!showRawUrlArea)}
                className="p-0 text-xs text-slate-400 hover:text-slate-200 font-bold"
              >
                {showRawUrlArea ? '▼ Ẩn danh sách đường link URL thô' : '▶ Xem / Sửa danh sách đường link URL thô'}
              </Button>

              {showRawUrlArea && (
                <div className="mt-2">
                  <Input.TextArea
                    rows={4}
                    placeholder="Dán danh sách các đường link bài báo chi tiết tại đây (mỗi link 1 dòng)..."
                    value={articleBatchUrlsText}
                    onChange={(e) => setArticleBatchUrlsText(e.target.value)}
                    className="font-mono text-xs bg-slate-950 border-slate-800 text-slate-100 rounded-xl"
                  />
                </div>
              )}
            </div>
          </div>

          {/* CỘT PHẢI (lg:col-span-7): DANH SÁCH XEM TRƯỚC BÀI BÁO DẠNG LƯỚI 2 CỘT RỘNG RÃI */}
          <div className="lg:col-span-7 p-4 bg-slate-900/90 rounded-2xl border border-slate-800 space-y-3 flex flex-col h-full shadow-md">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <label className="block text-xs font-bold text-slate-200 flex items-center gap-2 uppercase tracking-wider">
                <span>📋 Danh sách bài báo đã cào (cộng dồn liên tục):</span>
                {scrapedNewsItems.length > 0 && (
                  <>
                    <Tag color="blue" className="font-bold border-0 text-xs px-2.5 py-0.5 rounded-lg">
                      Tổng {scrapedNewsItems.length} bài
                    </Tag>
                    {scrapedNewsItems.some(i => i.imported) && (
                      <Tag color="green" className="font-bold border-0 text-xs px-2.5 py-0.5 rounded-lg">
                        Đã nạp {scrapedNewsItems.filter(i => i.imported).length} bài
                      </Tag>
                    )}
                  </>
                )}
              </label>

              {scrapedNewsItems.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <Button
                    size="small"
                    type="link"
                    onClick={() => setScrapedNewsItems(prev => prev.map(i => ({ ...i, selected: true })))}
                    className="p-0 text-blue-400 hover:text-blue-300 font-bold"
                  >
                    Select Tất cả
                  </Button>
                  <span className="text-slate-600">|</span>
                  <Button
                    size="small"
                    type="link"
                    onClick={() => setScrapedNewsItems(prev => prev.map(i => ({ ...i, selected: false })))}
                    className="p-0 text-slate-400 hover:text-slate-300"
                  >
                    Bỏ chọn
                  </Button>
                  <span className="text-slate-600">|</span>
                  <Button
                    size="small"
                    type="link"
                    danger
                    onClick={() => {
                      setScrapedNewsItems([]);
                      message.info('Đã xóa toàn bộ danh sách, bấm Quét Đa Kênh Ngay để cào lại từ đầu.');
                    }}
                    className="p-0 font-bold"
                  >
                    Xóa danh sách
                  </Button>
                </div>
              )}
            </div>

            {/* Render Preview List Cards (Grid 2 Cột Rộng Rãi) */}
            {scrapedNewsItems.length > 0 ? (
              <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar max-h-[620px]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {scrapedNewsItems
                    .filter((item) => {
                      if (!radarSearchKeyword.trim()) return true;
                      const kw = radarSearchKeyword.trim().toLowerCase();
                      return (item.title || '').toLowerCase().includes(kw) || (item.sapo || '').toLowerCase().includes(kw);
                    })
                    .map((item, idx) => (
                      <div
                        key={idx}
                        draggable
                        onDragStart={() => handleNewsDragStart(item.url)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleNewsDrop(item.url);
                        }}
                        onClick={() => {
                          setScrapedNewsItems(prev => prev.map((it) => it.url === item.url ? { ...it, selected: !it.selected } : it));
                        }}
                        title="Kéo để sắp xếp lại thứ tự bài"
                        className={`relative p-3.5 rounded-2xl border transition-all cursor-grab active:cursor-grabbing flex flex-col justify-between gap-3 ${item.selected
                          ? 'bg-blue-950/50 border-blue-500/80 shadow-md ring-1 ring-blue-500/40'
                          : 'bg-slate-950/60 border-slate-800/80 opacity-60 hover:opacity-95'
                          }`}
                      >
                        {item.imported && (
                          <div className="absolute -top-2 -right-2 z-10 bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md border border-emerald-400/60">
                            ✓ Đã nạp
                          </div>
                        )}
                        <div className="space-y-2.5">
                          {/* 1. Hình ảnh thumbnail bài báo / bài Facebook */}
                          {item.coverImage ? (
                            <div className="relative overflow-hidden rounded-xl border border-slate-800/80 bg-slate-900 group">
                              <img
                                src={item.coverImage}
                                alt=""
                                className="w-full h-36 object-cover group-hover:scale-105 transition-transform duration-300"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                            </div>
                          ) : (
                            <div className="w-full h-20 bg-slate-900/80 rounded-xl border border-slate-800/60 flex items-center justify-center text-slate-600 font-mono text-xs">
                              📰 Bài viết Tin tức / Báo chí
                            </div>
                          )}

                          {/* 2. Nguồn & Thời gian đăng */}
                          <div className="flex items-center justify-between gap-1 flex-wrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Tag color="cyan" className="font-bold text-[10px] uppercase border-0 rounded-md px-2 py-0.5">
                                {item.source || 'Tin Tức'}
                              </Tag>
                              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 px-2 py-0.5 rounded-md flex items-center gap-1">
                                🕒 {item.publishedTime || 'Mới xuất bản 24h'}
                              </span>
                            </div>
                            <Checkbox
                              checked={item.selected}
                              onChange={(e) => {
                                e.stopPropagation();
                                setScrapedNewsItems(prev => prev.map((it) => it.url === item.url ? { ...it, selected: e.target.checked } : it));
                              }}
                              className="text-xs"
                            />
                          </div>

                          {/* 3. Tiêu đề & Nội dung Sapo */}
                          <h4 className="text-xs font-bold text-slate-100 leading-snug line-clamp-2 hover:text-blue-300">
                            {item.title}
                          </h4>

                          {item.sapo && (
                            <p className="text-[11px] text-slate-400 line-clamp-3 leading-relaxed">
                              {item.sapo}
                            </p>
                          )}
                        </div>

                        {/* 4. Footer link bài gốc & trạng thái */}
                        <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-slate-400 hover:text-blue-400 truncate max-w-[200px] flex items-center gap-1"
                          >
                            🌐 Xem bài gốc
                          </a>
                          <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${item.selected ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                            {item.selected ? '✓ Được chọn' : 'Đã bỏ chọn'}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-950/50 rounded-2xl border border-dashed border-slate-800 space-y-3 my-auto min-h-[350px]">
                <span className="text-4xl">📰</span>
                <p className="text-sm font-semibold text-slate-300 max-w-md">
                  Vui lòng nhấp chọn các Kênh báo hot 1-click ở bảng bên trái (CafeF, Batdongsan, VnExpress...) để bắt đầu quét — bấm nhiều lần hoặc bật "Quét tự động" để cào thêm liên tục, bài mới sẽ tự cộng dồn vào danh sách!
                </p>
              </div>
            )}

            {/* Button Nạp bài viết */}
            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                Đã chọn <strong className="text-emerald-400 font-bold">{scrapedNewsItems.filter(i => i.selected).length}</strong> bài viết
              </span>
              <Button
                type="primary"
                icon={<RocketOutlined />}
                loading={isScrapingArticleBatch}
                onClick={() => handleBatchScrapeArticlesToForm()}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border-0 font-bold rounded-xl h-11 px-6 text-sm shadow-lg"
              >
                🚀 Cào & Nạp {scrapedNewsItems.filter(i => i.selected).length > 0 ? `${scrapedNewsItems.filter(i => i.selected).length} Bài Đã Chọn` : 'Các Bài Báo'} Vào Form Đăng
              </Button>
            </div>
          </div>
        </div>
      </Drawer>

      {/* Modal Khai Báo Kênh Báo / Luồng RSS Tùy Chỉnh Mới */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-slate-100">
            <span className="text-xl">➕</span>
            <span>Khai Báo Kênh Báo / Luồng RSS Tùy Chỉnh Mới</span>
          </div>
        }
        open={showAddChannelModal}
        onCancel={() => setShowAddChannelModal(false)}
        onOk={handleAddCustomChannel}
        okText="Lưu Kênh Này"
        cancelText="Hủy"
        width={480}
        className="dark-theme-modal"
      >
        <div className="space-y-4 py-3 text-slate-200">
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              1. Tên hiển thị kênh / trang báo:
            </label>
            <Input
              placeholder="VD: VnEconomy BĐS, GenK AI, Cafeland..."
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              className="text-xs bg-slate-950 border-slate-700 text-slate-100 rounded-xl"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              2. Đường link Chuyên mục báo hoặc luồng RSS Feed:
            </label>
            <Input
              placeholder="VD: https://vneconomy.vn/bat-dong-san.htm hoặc https://cafef.vn/bat-dong-san.rss"
              value={newChannelUrl}
              onChange={(e) => setNewChannelUrl(e.target.value)}
              className="text-xs bg-slate-950 border-slate-700 text-slate-100 rounded-xl font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              3. Phân loại vào Chủ đề:
            </label>
            <Select
              value={newChannelCategory}
              onChange={(val) => setNewChannelCategory(val)}
              className="w-full text-xs"
              options={[
                { label: '🏠 Bất Động Sản', value: 'bds' },
                { label: '💻 Công Nghệ & AI', value: 'tech' },
                { label: '📈 Tài Chính & Kinh Tế', value: 'finance' },
                { label: '🏥 Sức Khỏe & Đời Sống', value: 'health' },
                { label: '🌐 Lĩnh vực Khác / Tùy chỉnh', value: 'other' },
              ]}
            />
          </div>
        </div>
      </Modal>

    </div>
  );
};

export default PlaywrightPoster;
