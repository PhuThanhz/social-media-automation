import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  Card,
  Input,
  Button,
  Select,
  Tag,
  App,
  Row,
  Col,
  Checkbox,
  Progress,
  Tabs,
  Modal,
  InputNumber,
  Segmented,
  Switch,
  Dropdown,
} from 'antd';
import {
  EyeOutlined,
  MoreOutlined,
  ThunderboltFilled,
  ReloadOutlined,
  PlayCircleOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  CloseCircleFilled,
  ExportOutlined,
  RobotOutlined,
  UserOutlined,
  SearchOutlined,
  CheckOutlined,
  PauseOutlined,
  StopOutlined,
  PlusOutlined,
  DeleteOutlined,
  IdcardOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
  PauseCircleOutlined,
  CaretRightOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  CopyOutlined,
  CommentOutlined,
  SettingOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  BellOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import api from '../config/axios';
import PasteLinkInput from '../components/common/PasteLinkInput';

import PostHunterTab from '../components/buff/PostHunterTab';

const WORKER_BASE_URL =
  import.meta.env.VITE_WORKER_BASE_URL ||
  `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3001`;

interface FanpageItem {
  id: string;
  name: string;
  url: string;
  viaAccountId?: number | 'CUSTOM';
  viaName?: string;
  viaCookie?: string;
  isProfile?: boolean;
}

interface AutoBuffResultDetail {
  pageId: string;
  pageName: string;
  viaName?: string;
  status: 'WAITING' | 'RUNNING' | 'SUCCESS' | 'ALREADY_LIKED' | 'UNVERIFIED' | 'NO_BUTTON' | 'ERROR' | 'SKIPPED';
  likeStatus?: 'WAITING' | 'RUNNING' | 'SUCCESS' | 'ALREADY_LIKED' | 'UNVERIFIED' | 'NO_BUTTON' | 'ERROR' | 'SKIPPED';
  commentStatus?: 'WAITING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'ERROR';
  commentText?: string;
  message?: string;
  error?: string;
}

interface AutoBuffProgress {
  total: number;
  success: number;
  failed: number;
  alreadyLiked: number;
  percent: number;
  currentRunningPageName?: string;
  status: 'IDLE' | 'RUNNING' | 'DONE' | 'ERROR';
  details: AutoBuffResultDetail[];
}

interface BuffStreamProgressEvent {
  type: 'PAGE_START' | 'PAGE_FINISH';
  index: number;
  total: number;
  pageId: string;
  pageName: string;
  percent: number;
  status?: AutoBuffResultDetail['status'];
  likeStatus?: AutoBuffResultDetail['likeStatus'];
  commentStatus?: AutoBuffResultDetail['commentStatus'];
  commentText?: string;
  message?: string;
  error?: string;
}

interface BuffRunResult {
  total: number;
  success: number;
  failed: number;
  unverified?: number;
  stopped?: boolean;
  details: AutoBuffResultDetail[];
}

class BuffStreamError extends Error {
  receivedAny: boolean;
  constructor(message: string, receivedAny: boolean) {
    super(message);
    this.receivedAny = receivedAny;
  }
}

// Gọi /api/buff-like-stream và đọc SSE. receivedAny cho biết worker đã bắt đầu xử lý hay chưa:
// nếu đã nhận event thì KHÔNG được chạy lại nhóm đó (tránh like/comment lặp).
async function runBuffStream(
  payload: Record<string, unknown>,
  onProgress: (event: BuffStreamProgressEvent) => void,
  signal?: AbortSignal
): Promise<BuffRunResult> {
  let receivedAny = false;
  try {
    const response = await fetch(`${WORKER_BASE_URL}/api/buff-like-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Worker stream error: ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        const eventType = chunk.match(/^event:\s*(\w+)/m)?.[1];
        const raw = chunk.match(/^data:\s*(.*)$/m)?.[1];
        if (!eventType || !raw) continue; // heartbeat
        let data: any;
        try {
          data = JSON.parse(raw);
        } catch {
          continue;
        }
        receivedAny = true;
        if (eventType === 'progress') onProgress(data);
        else if (eventType === 'done') return (data?.result || { total: 0, success: 0, failed: 0, details: [] }) as BuffRunResult;
        else if (eventType === 'error') throw new BuffStreamError(data?.error || 'Lỗi khi thực hiện buff tương tác', true);
      }
    }
    throw new BuffStreamError('Kết nối tới worker bị ngắt trước khi hoàn tất', receivedAny);
  } catch (err: any) {
    if (err instanceof BuffStreamError) throw err;
    throw new BuffStreamError(err?.name === 'AbortError' ? 'Đã dừng' : err?.message || 'Lỗi kết nối stream', receivedAny);
  }
}

interface ViaGroup {
  viaName: string;
  cookieString: string;
  pages: FanpageItem[];
}

// Nhóm Page theo Via sở hữu: mỗi Page phải chạy bằng đúng cookie của Via quản lý nó
function groupPagesByVia(pages: FanpageItem[], fallbackCookie: string, fallbackViaName: string): ViaGroup[] {
  const groups: ViaGroup[] = [];
  const byCookie = new Map<string, ViaGroup>();
  for (const page of pages) {
    const cookie = (page.viaCookie || fallbackCookie).trim();
    if (!byCookie.has(cookie)) {
      const group = { viaName: page.viaName || fallbackViaName, cookieString: cookie, pages: [] as FanpageItem[] };
      byCookie.set(cookie, group);
      groups.push(group);
    }
    byCookie.get(cookie)!.pages.push(page);
  }
  return groups;
}

function summarizeBuffDetails(details: AutoBuffResultDetail[]) {
  return {
    success: details.filter((d) => d.status === 'SUCCESS').length,
    alreadyLiked: details.filter((d) => d.status === 'ALREADY_LIKED').length,
    unverified: details.filter((d) => d.status === 'UNVERIFIED').length,
    failed: details.filter((d) => d.status === 'ERROR' || d.status === 'NO_BUTTON').length,
    comments: details.filter((d) => d.commentStatus === 'SUCCESS').length,
  };
}

export interface BuffMonitor {
  id: string;
  targetName: string;
  targetUrl: string;
  targetType: 'PAGE' | 'GROUP' | 'PROFILE';
  checkIntervalMinutes: number;
  buffConfig: {
    targetLikes: number | 'ALL';
    reactionType: string;
    enableLike: boolean;
    enableComment: boolean;
    comments: string[];
    delayMinutes: number;
    viaMode: string;
    cookieString?: string;
  };
  status: 'ACTIVE' | 'PAUSED';
  totalDetected: number;
  lastCheckedAt: string | null;
  lastFoundPostUrl: string | null;
  baselineDone?: boolean;
  lastPostsFound?: number;
  lastScanVia?: string | null;
  createdAt: string;
}

export interface BatchOrder {
  id: number;
  url: string;
  orderNumber: number;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'PAUSED' | 'FAILED';
  successLikes: number;
  totalLikesTarget: number;
  percent?: number;
  currentRunningPageName?: string;
  error?: string;
  details?: AutoBuffResultDetail[];
}

export interface BuffLogEntry {
  id: string;
  createdAt: string;
  type: 'SINGLE' | 'BATCH';
  targetUrl: string;
  reactionType: string;
  totalPages: number;
  successCount: number;
  alreadyLikedCount: number;
  failedCount: number;
  engagementMode?: 'LIKE_ONLY' | 'COMMENT_ONLY' | 'LIKE_AND_COMMENT';
  commentCount?: number;
  accountName?: string;
  details: AutoBuffResultDetail[];
}

const BUFF_LOGS_STORAGE_KEY = 'toolzutter:buff-engagement-logs';

const loadBuffLogs = (): BuffLogEntry[] => {
  try {
    const raw = localStorage.getItem(BUFF_LOGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveBuffLogs = (logs: BuffLogEntry[]) => {
  try {
    localStorage.setItem(BUFF_LOGS_STORAGE_KEY, JSON.stringify(logs.slice(0, 300)));
  } catch {}
};

export const SEEDING_NICHE_PRESETS: Record<string, { label: string; icon: string; templates: string[] }> = {
  GENERAL: {
    label: 'Tương Tác Xã Hội & Đẩy Reach',
    icon: '',
    templates: [
'{Bài viết chia sẻ rất hay|Nội dung chất lượng quá|Bổ ích ghê} {ad ơi|ạ|nha bạn} {👏|🌟|❤️}',
'{Đã lưu lại khi cần|Thả tim cho bài viết tuyệt vời này|Theo dõi page lâu rồi vẫn thích} {ạ|nhé|nè} {🥰|✨|🍀}',
'{Chuẩn luôn|Rất đồng quan điểm với bài viết|Chia sẻ chính xác quá} {ạ|nha|bạn ơi} {💯|👌|🔥}',
'{Chúc trang ngày càng phát triển|Luôn ủng hộ các bài viết của bạn|Tiếp tục phát huy nhé} {nha|ạ|nhé ad} {🚀|🎉|💖}',
'{Quá tuyệt vời luôn|Rất đáng để học hỏi|Thích cách trình bày này ghê} {ạ|nè bạn|ơi} {🍀|✨|👍}',
    ],
  },
  FASHION: {
    label: 'Thời Trang & Làm Đẹp',
    icon: '',
    templates: [
'{Shop ơi|Ad ơi} {check ib em|tư vấn em với} {size M|màu đen|mẫu này} {ạ|nha shop|với ạ} {❤️|✨|🛍️}',
'{Vải mặc mát không shop|Chất này có co giãn không ạ|Form áo chuẩn không ad} {ơi|nha|nhé} {🥰|🌟}',
'{Mới nhận hàng hôm qua|Vừa nhận được áo|Đồ đẹp lắm shop ơi} {ưng cái bụng ghê|chất vải mê ly|sẽ ủng hộ tiếp} {ạ|nha|💯} {👏|💖}',
'{Mẫu này nữ cao 1m6 mặc vừa không shop|Cho mình hỏi còn size L không|Ship về Hà Nội/HCM mất mấy ngày} {ạ|vậy ad} {✨|🍀}',
'{Đẹp quá|Nhìn mê chữ ê kéo dài luôn|Xinh xỉu luôn shop ơi} {nè|quá chừng|ạ} {😍|🔥|👌}',
    ],
  },
  FNB: {
    label: 'Ẩm Thực & Quán Xá',
    icon: '',
    templates: [
'{Quán mở cửa tới mấy giờ|Menu này giá bao nhiêu|Có cần đặt bàn trước không} {vậy shop|ạ|ạ ad} {🍲|😋|✨}',
'{Nhìn hấp dẫn quá|Thèm rớt nước miếng|Món này cay nhiều không} {bạn ơi|ạ|ad ơi} {🤤|❤️|👌}',
'{Hôm trước vừa ghé ăn|Cuối tuần này phải rủ bạn ghé mới được|Đồ ăn ở đây ngon đỉnh} {nha mọi người|ạ|nè} {🌟|👍|🎉}',
'{Địa chỉ ở đâu vậy bạn|Có ship qua Now/Grab/ShopeeFood không|Quán ở quận mấy} {ạ|ơi|nhé} {🛵|🍽️}',
'{Lưu lại ngay|Cuối tuần set kèo đi thử|Trông chất lượng quá} {bạn ơi|ạ|nhé cả nhà} {👏|💯|🔥}',
    ],
  },
  SERVICES: {
    label: 'Dịch Vụ & BĐS & Khóa Học',
    icon: '',
    templates: [
'{Cho mình xin thông tin chi tiết|Dự án này pháp lý thế nào|Học phí khóa này bao nhiêu} {ạ|vậy ad|ơi shop} {🏢|📋|💡}',
'{Đã inbox ad tư vấn giúp em|Quan tâm dịch vụ bên mình|Ad check tin nhắn chờ giúp} {nhé|ạ|nha} {📩|🤝|✨}',
'{Dịch vụ uy tín chuyên nghiệp|Đã từng trải nghiệm rất hài lòng|Ủng hộ team} {nha|ạ|nhe} {🌟|👏|💯}',
'{Chính sách ưu đãi tháng này thế nào ad|Cho mình hỏi thời gian học/triển khai} {với ạ|nhé|nha} {📊|👍}',
'{Nội dung chia sẻ rất thực tế|Kiến thức bổ ích quá|Cảm ơn team nhiều} {ạ|nha|nhé} {🔥|❤️|🍀}',
    ],
  },
  TECH: {
    label: 'Công Nghệ & Thiết Bị',
    icon: '',
    templates: [
'{Mẫu này còn hàng không shop|Bản này có bảo hành chính hãng không|Có hỗ trợ ship COD không} {ạ|ad ơi|nhé} {📱|⚡|🔥}',
'{Máy dùng mượt mà|Pin trâu thật sự|Shop đóng gói rất kỹ} {nha cả nhà|ạ|luôn} {👍|✨|🔋}',
'{Giá bao gồm VAT chưa shop|Có hỗ trợ trả góp 0% không|Tặng kèm những phụ kiện gì} {ạ|vậy shop} {💳|📦}',
'{Bền đẹp|Dùng 6 tháng rồi vẫn ngon lành|Đáng đồng tiền bát gạo} {nha|luôn bạn ơi|ạ} {💯|🌟}',
    ],
  },
};

export function resolveSpintax(text: string): string {
  const spintaxRegex = /\{([^{}]+)\}/g;
  let result = text;
  while (spintaxRegex.test(result)) {
    result = result.replace(spintaxRegex, (_, choices) => {
      const parts = choices.split('|');
      return parts[Math.floor(Math.random() * parts.length)].trim();
    });
  }
  return result;
}

const ENGAGEMENT_STORAGE_KEY = 'toolzutter:assisted-page-engagement';

function isFacebookPostUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl.trim());
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'facebook.com' ||
        url.hostname.endsWith('.facebook.com') ||
        url.hostname === 'fb.com' ||
        url.hostname.endsWith('.fb.com'))
    );
  } catch {
    return false;
  }
}

function extractCUser(cookieString?: string) {
  return cookieString?.match(/(?:^|;\s*)c_user=([^;]+)/i)?.[1]?.trim() || '';
}

function extractPageId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^\d{8,}$/.test(trimmed)) {
    return trimmed;
  }
  const idMatch = trimmed.match(/[?&]id=(\d+)/);
  if (idMatch) return idMatch[1];
  const profileMatch = trimmed.match(/profile\.php\?id=(\d+)/);
  if (profileMatch) return profileMatch[1];
  const trailingDigits = trimmed.match(/\/(\d{8,})\/?$/);
  if (trailingDigits) return trailingDigits[1];
  return null;
}

function isPersonalCookieAccount(account: any) {
  return account?.accountType === 'PERSONAL_COOKIE' || account?.accountType === 'PERSONAL_PROFILE_COOKIE';
}

const REACTIONS = [
  { key: 'LIKE', label: 'Thích (Like)', emoji: '👍', color: '#1877f2' },
  { key: 'LOVE', label: 'Yêu thích (Love)', emoji: '❤️', color: '#f33e58' },
  { key: 'CARE', label: 'Thương thương (Care)', emoji: '🥰', color: '#f7b125' },
  { key: 'RANDOM_POSITIVE', label: 'Ngẫu nhiên Tích Cực (Like/Love/Care)', emoji: '🎲', color: '#ec4899' },
  { key: 'RANDOM_ALL', label: 'Ngẫu nhiên Đa Dạng (Like/Love/Care/Haha/Wow)', emoji: '🎲', color: '#8b5cf6' },
  { key: 'HAHA', label: 'Haha', emoji: '😆', color: '#f7b125' },
  { key: 'WOW', label: 'Wow', emoji: '😮', color: '#f7b125' },
  { key: 'SAD', label: 'Buồn (Sad)', emoji: '😢', color: '#f7b125' },
  { key: 'ANGRY', label: 'Phẫn nộ (Angry)', emoji: '😡', color: '#e9710f' },
];

const getInitials = (name: string): string => {
  if (!name) return 'FP';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const getAvatarGradient = (str: string): string => {
  const gradients = ['bg-slate-600', 'bg-blue-700'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return gradients[Math.abs(hash) % gradients.length];
};

const VIA_PAGES_STORAGE_KEY = 'toolzutter:via_fanpages_map_v3';

function getViaKey(account: any, customCookie?: string): string {
  if (!account || account === 'CUSTOM') {
    const c = extractCUser(customCookie);
    return c ? `cuser_${c}` : 'custom_manual';
  }
  const c = extractCUser(account?.cookieString || account?.accessToken);
  if (c) return `cuser_${c}`;
  return `acc_${account?.id || 'unknown'}`;
}

function getStoredPagesForVia(viaKey: string): FanpageItem[] {
  try {
    const raw = localStorage.getItem(VIA_PAGES_STORAGE_KEY);
    if (!raw) return [];
    const map = JSON.parse(raw);
    const pages = map[viaKey];
    return Array.isArray(pages) ? pages : [];
  } catch {
    return [];
  }
}

function saveStoredPagesForVia(viaKey: string, pages: FanpageItem[]) {
  try {
    const raw = localStorage.getItem(VIA_PAGES_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[viaKey] = pages;
    localStorage.setItem(VIA_PAGES_STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    console.error('Error saving via pages to localStorage:', e);
  }
}

export default function BuffEngagement() {
  const [searchParams] = useSearchParams();
  const { message, modal } = App.useApp();

  // Shared State
  const [selectedAccountId, setSelectedAccountId] = useState<number | 'CUSTOM' | 'ALL_VIAS'>('ALL_VIAS');
  const [customCookie, setCustomCookie] = useState('');
  const [targetPostUrl, setTargetPostUrl] = useState('');
  const [selectedReaction, setSelectedReaction] = useState('LIKE');
  const [scannedPages, setScannedPages] = useState<FanpageItem[]>([]);
  const [actorMode, setActorMode] = useState<'VIAS' | 'FANPAGES'>('VIAS');
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [pageSearchQuery, setPageSearchQuery] = useState('');
  const [delayMs, setDelayMs] = useState<number>(3800);
  const [enableHumanBehavior, setEnableHumanBehavior] = useState<boolean>(true);
  const [fastSwitch, setFastSwitch] = useState<boolean>(true);
  const [antiCheckpointGuard, setAntiCheckpointGuard] = useState<boolean>(true);
  const [isAiGeneratingComments, setIsAiGeneratingComments] = useState<boolean>(false);

  // Nhận link bài viết tự động truyền từ Job Kinh Tế
  useEffect(() => {
    const urlParam = searchParams.get('url') || searchParams.get('targetUrl');
    if (urlParam) {
      setTargetPostUrl(urlParam);
      message.info(`Đã nạp link bài viết từ Job Kinh Tế: ${urlParam}`);
    }
  }, [searchParams]);

  // Auto Buff State (Playwright Bot)
  const [autoBuffProgress, setAutoBuffProgress] = useState<AutoBuffProgress>({
    total: 0,
    success: 0,
    failed: 0,
    alreadyLiked: 0,
    percent: 0,
    status: 'IDLE',
    details: [],
  });

  // Tab 3: Buff View State
  const [targetViewUrl, setTargetViewUrl] = useState('');
  const [targetViews, setTargetViews] = useState(20);
  const [concurrency, setConcurrency] = useState(2);
  const [watchTimeSeconds, setWatchTimeSeconds] = useState(8);
  const [viewProgress, setViewProgress] = useState<{ total: number; done: number; status: 'IDLE' | 'RUNNING' | 'DONE' }>({
    total: 0,
    done: 0,
    status: 'IDLE',
  });

  // Chế độ Buff: 1 Link đơn lẻ hoặc Nhiều bài viết hàng loạt
  const [buffMode, setBuffMode] = useState<'SINGLE' | 'BATCH'>('SINGLE');

  // Chế độ tương tác: Thả Cảm xúc, Viết Bình luận, hoặc Cả Hai
  const [engagementMode, setEngagementMode] = useState<'LIKE_AND_COMMENT' | 'LIKE_ONLY' | 'COMMENT_ONLY'>('LIKE_AND_COMMENT');
  const [commentListText, setCommentListText] = useState<string>(
    [
'Bài viết hay và rất ý nghĩa ạ! 👍',
'Thông tin rất bổ ích, cảm ơn bạn đã chia sẻ ❤️',
'Quan tâm dịch vụ, xin thêm tư vấn với shop ơi! ✨',
'Đã lưu lại khi cần, tuyệt vời quá ạ 🌟',
'Uy tín và chất lượng luôn bạn ơi! 🚀',
'Ủng hộ nhiệt tình, chúc trang ngày càng phát triển nhé! 👏',
'Quá hay, chấm hóng các bài viết tiếp theo ạ! 🍀',
    ].join('\n')
  );

  // Auto-Buff Queue State (Hunter-Ready & Background Pipeline)
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [queueUrlInput, setQueueUrlInput] = useState<string>('');
  const [queueTargetLikes, setQueueTargetLikes] = useState<number>(30);
  const [queueDelayMinutes, setQueueDelayMinutes] = useState<number>(3);
  const [queueReaction, setQueueReaction] = useState<string>('RANDOM_POSITIVE');
  const [queueLoading, setQueueLoading] = useState<boolean>(false);

  const fetchBuffQueue = useCallback(async () => {
    try {
      const res = await axios.get(`${WORKER_BASE_URL}/api/buff-queue/list`);
      if (res.data?.success) {
        setQueueItems(res.data.queue || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchBuffQueue();
    const interval = setInterval(fetchBuffQueue, 10000);
    return () => clearInterval(interval);
  }, [fetchBuffQueue]);

  const handleAddQueueTask = async () => {
    if (!queueUrlInput.trim()) {
      message.warning('Vui lòng nhập link bài viết Facebook!');
      return;
    }
    setQueueLoading(true);
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/add`, {
        targetUrl: queueUrlInput.trim(),
        targetLikes: queueTargetLikes,
        reactionType: queueReaction,
        enableComment: false,
        delayMinutes: queueDelayMinutes,
        skipIfBuffed: true,
      });
      if (res.data?.success) {
        if (res.data.skipped) {
          message.warning(res.data.message);
        } else {
          message.success('Đã nạp bài viết vào hàng đợi tự động thành công!');
          setQueueUrlInput('');
          fetchBuffQueue();
        }
      } else {
        message.error(res.data?.error || 'Lỗi thêm vào hàng đợi');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    } finally {
      setQueueLoading(false);
    }
  };

  const handleRunNowQueueTask = async (id: string) => {
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/run-now/${id}`);
      if (res.data?.success) {
        message.success('Đã kích hoạt task chạy ngay!');
        fetchBuffQueue();
      }
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const handleRemoveQueueTask = (id: string) => {
    modal.confirm({
      title: 'Xoá task này khỏi hàng đợi?',
      okText: 'Xoá',
      cancelText: 'Huỷ',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await axios.delete(`${WORKER_BASE_URL}/api/buff-queue/remove/${id}`);
          if (res.data?.success) {
            message.success('Đã xoá task khỏi hàng đợi.');
            fetchBuffQueue();
          }
        } catch (err: any) {
          message.error(err.message);
        }
      },
    });
  };

  const handleClearCompletedQueue = async () => {
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/clear-completed`);
      if (res.data?.success) {
        message.success(`Đã dọn dẹp ${res.data.cleared} bài viết hoàn tất!`);
        fetchBuffQueue();
      }
    } catch (err: any) {
      message.error(err.message);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // POST HUNTER & AUTO-MONITORS STATE & HANDLERS
  // ─────────────────────────────────────────────────────────────────────────────
  const [monitors, setMonitors] = useState<BuffMonitor[]>([]);
  const [loadingMonitors, setLoadingMonitors] = useState<boolean>(false);
  const [isMonitorModalOpen, setIsMonitorModalOpen] = useState<boolean>(false);
  const [editingMonitorId, setEditingMonitorId] = useState<string | null>(null);

  // Monitor Form state
  const [monTargetUrl, setMonTargetUrl] = useState<string>('');
  const [monTargetName, setMonTargetName] = useState<string>('');
  const [monTargetType, setMonTargetType] = useState<'PAGE' | 'GROUP' | 'PROFILE'>('PAGE');
  const [monInterval, setMonInterval] = useState<number>(10);
  const [monTargetLikes, setMonTargetLikes] = useState<number | 'ALL'>('ALL');
  const [monReaction, setMonReaction] = useState<string>('RANDOM_POSITIVE');
  const [monEnableComment, setMonEnableComment] = useState<boolean>(false);
  const [monCommentText, setMonCommentText] = useState<string>(
    '{Sản phẩm|Mẫu này} đẹp quá shop ơi! {Tư vấn|Inbox} em nhé! ❤️\n' +
    'Đẹp xuất sắc luôn ạ! Chúc shop {bão đơn|buôn may bán đắt} nha! 🌟\n' +
    'Chất lượng tuyệt vời, giá cả hợp lý! Đã ủng hộ shop nhiều lần 👍'
  );
  const [monDelayMinutes, setMonDelayMinutes] = useState<number>(3);
  const [monViaMode, setMonViaMode] = useState<string>('ALL_VIAS');
  const [spintaxSampleOutputs, setSpintaxSampleOutputs] = useState<string[]>([]);


  const fetchBuffMonitors = useCallback(async () => {
    try {
      const res = await axios.get(`${WORKER_BASE_URL}/api/buff-monitors`);
      if (res.data?.success) {
        setMonitors(res.data.monitors || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchBuffMonitors();
    const interval = setInterval(fetchBuffMonitors, 15000);
    return () => clearInterval(interval);
  }, [fetchBuffMonitors]);

  // Via Health & Enterprise BM Overview State
  const [checkingViaHealth, setCheckingViaHealth] = useState<boolean>(false);
  const [viaHealthResults, setViaHealthResults] = useState<any[]>([]);
  const [isHealthModalOpen, setIsHealthModalOpen] = useState<boolean>(false);
  const [bmOverview, setBmOverview] = useState<any>(null);

  // Enterprise Ops Settings & Telegram Bot State
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [systemSettings, setSystemSettings] = useState<any>({
    telegramBotToken: '',
    telegramBotTokenMasked: '',
    telegramChatId: '',
    notifyOnViaDead: true,
    notifyOnHunter: true,
    notifyOnBuffDone: true,
    maxDailyPageActions: 25,
  });
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [testingTelegram, setTestingTelegram] = useState<boolean>(false);

  const fetchBmOverview = useCallback(async () => {
    try {
      const res = await axios.get(`${WORKER_BASE_URL}/api/buff-vias/overview`);
      if (res.data?.success) {
        setBmOverview({
          ...(res.data.bmHealth || {}),
          antiOverlap: res.data.antiOverlap || { totalTrackedPosts: 0, totalProtectedInteractions: 0 },
          system: res.data.system || { isEmergencyStopped: false, telegramConfigured: false },
          stats: res.data.stats || {},
        });
      }
    } catch {}
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await axios.get(`${WORKER_BASE_URL}/api/buff-settings`);
      if (res.data?.success && res.data.settings) {
        setSystemSettings(res.data.settings);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchBmOverview();
    fetchSettings();
    const interval = setInterval(fetchBmOverview, 15000);
    return () => clearInterval(interval);
  }, [fetchBmOverview, fetchSettings]);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-settings`, systemSettings);
      if (res.data?.success) {
        message.success('Đã lưu cấu hình Hệ thống & Telegram Ops Bot thành công!');
        setIsSettingsModalOpen(false);
        fetchBmOverview();
        fetchSettings();
      } else {
        message.error(res.data?.error || 'Lỗi lưu cấu hình');
      }
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestTelegram = async () => {
    setTestingTelegram(true);
    message.loading({ content: 'Đang gửi tin nhắn thử nghiệm tới Telegram...', key: 'testTele' });
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-settings/test-telegram`, {
        botToken: systemSettings.telegramBotToken || undefined,
        chatId: systemSettings.telegramChatId || undefined,
      });
      if (res.data?.success) {
        message.success({ content: 'Gửi tin nhắn Telegram thành công! Hãy kiểm tra điện thoại của bạn.', key: 'testTele', duration: 4 });
      } else {
        message.error({ content: res.data?.error || 'Gửi thất bại', key: 'testTele' });
      }
    } catch (e: any) {
      message.error({ content: e.response?.data?.error || e.message, key: 'testTele' });
    } finally {
      setTestingTelegram(false);
    }
  };

  const handleEmergencyStop = async () => {
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/emergency-stop`, {
        reason: 'Quản trị viên kích hoạt Dừng Khẩn Cấp từ Command Bar',
      });
      if (res.data?.success) {
        message.warning(
          res.data.jobStillFinishing
            ? 'Đã bật dừng khẩn cấp. Job đang chạy sẽ dừng sau Page hiện tại.'
            : 'Đã bật dừng khẩn cấp. Hàng đợi và Săn bài tạm ngưng.'
        );
        fetchBmOverview();
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleResumeSystem = async () => {
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/resume`);
      if (res.data?.success) {
        message.success('Đã khôi phục hoạt động bình thường của hệ thống!');
        fetchBmOverview();
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleRunViaHealthCheck = async () => {
    setCheckingViaHealth(true);
    message.loading({ content: 'Đang kiểm tra kết nối và tình trạng từng Via trên Facebook...', key: 'viaHealth' });
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-vias/health-check`);
      if (res.data?.success) {
        setViaHealthResults(res.data.vias || []);
        setIsHealthModalOpen(true);
        message.success({
          content: `Kiểm tra hoàn tất: ${res.data.liveCount}/${res.data.total} Via đang HOẠT ĐỘNG TỐT (LIVE)!`,
          key: 'viaHealth',
          duration: 4,
        });
        fetchBmOverview();
        refetchAccounts();
      } else {
        message.error({ content: res.data?.error || 'Lỗi kiểm tra Via', key: 'viaHealth' });
      }
    } catch (err: any) {
      message.error({ content: err.message, key: 'viaHealth' });
    } finally {
      setCheckingViaHealth(false);
    }
  };

  const handleOpenAddMonitorModal = (existing?: BuffMonitor, prefillUrl?: string) => {
    if (existing) {
      setEditingMonitorId(existing.id);
      setMonTargetUrl(existing.targetUrl);
      setMonTargetName(existing.targetName);
      setMonTargetType(existing.targetType || 'PAGE');
      setMonInterval(existing.checkIntervalMinutes || 10);
      setMonTargetLikes(existing.buffConfig?.targetLikes || 'ALL');
      setMonReaction(existing.buffConfig?.reactionType || 'RANDOM_POSITIVE');
      setMonEnableComment(Boolean(existing.buffConfig?.enableComment));
      setMonCommentText(
        Array.isArray(existing.buffConfig?.comments) && existing.buffConfig.comments.length > 0
          ? existing.buffConfig.comments.join('\n')
          : '{Sản phẩm|Mẫu này} đẹp quá shop ơi! {Tư vấn|Inbox} em nhé! ❤️\nĐẹp xuất sắc luôn ạ! 🌟'
      );
      setMonDelayMinutes(existing.buffConfig?.delayMinutes || 3);
      setMonViaMode(existing.buffConfig?.viaMode || 'ALL_VIAS');
    } else {
      setEditingMonitorId(null);
      setMonTargetUrl(prefillUrl || '');
      setMonTargetName('');
      setMonTargetType('PAGE');
      setMonInterval(10);
      setMonTargetLikes('ALL');
      setMonReaction('RANDOM_POSITIVE');
      setMonEnableComment(false);
      setMonDelayMinutes(3);
      setMonViaMode('ALL_VIAS');
    }
    setSpintaxSampleOutputs([]);
    setIsMonitorModalOpen(true);
  };

  const handleSaveMonitor = async () => {
    if (!monTargetUrl.trim()) {
      message.warning('Vui lòng nhập Link trang Fanpage / Group / Profile cần theo dõi!');
      return;
    }
    setLoadingMonitors(true);
    try {
      const commentsList = monCommentText.split('\n').map((s) => s.trim()).filter(Boolean);
      const payload = {
        id: editingMonitorId || undefined,
        targetUrl: monTargetUrl.trim(),
        targetName: monTargetName.trim() || undefined,
        targetType: monTargetType,
        checkIntervalMinutes: monInterval,
        buffConfig: {
          targetLikes: monTargetLikes,
          reactionType: monReaction,
          enableLike: true,
          enableComment: monEnableComment,
          comments: commentsList,
          delayMinutes: monDelayMinutes,
          viaMode: monViaMode,
        },
        status: 'ACTIVE',
      };
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-monitors`, payload);
      if (res.data?.success) {
        message.success(editingMonitorId ? 'Đã cập nhật mục tiêu theo dõi!' : 'Đã thêm mục tiêu theo dõi tự động mới!');
        setIsMonitorModalOpen(false);
        fetchBuffMonitors();
      } else {
        message.error(res.data?.error || 'Lỗi lưu mục tiêu theo dõi');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    } finally {
      setLoadingMonitors(false);
    }
  };

  const handleDeleteMonitor = (id: string) => {
    modal.confirm({
      title: 'Xoá mục tiêu theo dõi này?',
      content: 'Hệ thống sẽ ngừng tự quét bài mới từ mục tiêu này.',
      okText: 'Xoá',
      cancelText: 'Huỷ',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await axios.delete(`${WORKER_BASE_URL}/api/buff-monitors/${id}`);
          if (res.data?.success) {
            message.success('Đã xoá mục tiêu theo dõi.');
            fetchBuffMonitors();
          }
        } catch (err: any) {
          message.error(err.message);
        }
      },
    });
  };

  const handleToggleMonitor = async (id: string) => {
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-monitors/${id}/toggle`);
      if (res.data?.success) {
        message.success(res.data.monitor?.status === 'ACTIVE' ? 'Đã bật theo dõi định kỳ!' : 'Đã tạm dừng theo dõi!');
        fetchBuffMonitors();
      }
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const handleScanNowMonitor = async (id: string) => {
    try {
      message.loading({ content: 'Đang quét bài viết mới từ mục tiêu...', key: 'scanMon' });
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-monitors/${id}/scan-now`);
      if (res.data?.success) {
        message.success({
          content: res.data.baseline
            ? `Lần quét đầu: đã ghi nhận ${res.data.postsFound} bài hiện có làm mốc. Từ giờ chỉ buff bài đăng sau thời điểm này.`
            : `Quét hoàn tất: Phát hiện ${res.data.postsFound} bài viết, đã nạp ${res.data.newPostsEnqueued} bài mới vào hàng đợi!`,
          key: 'scanMon',
          duration: 4,
        });
        fetchBuffMonitors();
        fetchBuffQueue();
      } else {
        message.error({ content: res.data?.error || 'Lỗi quét mục tiêu', key: 'scanMon' });
      }
    } catch (err: any) {
      message.error({ content: err.message, key: 'scanMon' });
    }
  };

  const handleTestSpintaxInForm = () => {
    const lines = monCommentText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) {
      message.warning('Vui lòng nhập ít nhất 1 dòng bình luận hoặc Spintax!');
      return;
    }
    const samples: string[] = [];
    for (let i = 0; i < 4; i++) {
      const picked = lines[i % lines.length];
      samples.push(resolveSpintax(picked));
    }
    setSpintaxSampleOutputs(samples);
    message.info('Đã tạo 4 mẫu bình luận ngẫu nhiên từ cấu trúc Spintax!');
  };

  // AI Seeding Studio & Spintax State
  const [aiStudioModalOpen, setAiStudioModalOpen] = useState(false);
  const [selectedNiche, setSelectedNiche] = useState<string>('GENERAL');
  const [previewSamples, setPreviewSamples] = useState<string[]>([]);

  // Gọi Gemini AI tạo bình luận tự nhiên theo bài viết
  const handleGenerateAiComments = async () => {
    if (!targetPostUrl.trim()) {
      message.warning('Vui lòng dán link bài viết Facebook trước để AI đọc và phân tích nội dung!');
      return;
    }
    setIsAiGeneratingComments(true);
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-ai-generate-comments`, {
        topic: selectedNiche || 'GENERAL',
        postUrl: targetPostUrl.trim(),
        count: 10,
        tone: 'natural',
      });
      if (res.data?.success && Array.isArray(res.data.comments) && res.data.comments.length > 0) {
        setCommentListText(res.data.comments.join('\n'));
        message.success(`Gemini AI đã sinh ${res.data.comments.length} bình luận tự nhiên theo ngữ cảnh bài viết!`);
      } else {
        message.warning('Không nhận được bình luận từ AI, vui lòng thử lại.');
      }
    } catch (err: any) {
      message.error(`Lỗi tạo bình luận AI: ${err.response?.data?.error || err.message}`);
    } finally {
      setIsAiGeneratingComments(false);
    }
  };

  // Cảnh báo từ khóa dễ bị bắt spam trong Group (test, bot, tool, tự động...)
  const detectedSpamKeywords = useMemo(() => {
    if (engagementMode === 'LIKE_ONLY' || !commentListText.trim()) return [];
    const lower = commentListText.toLowerCase();
    const badWords = ['test', 'tự động', 'bot', 'tool', 'toolzutter', 'buff', 'hack', 'spam'];
    return badWords.filter((w) => lower.includes(w));
  }, [engagementMode, commentListText]);

  // Tự động chuyển giãn cách an toàn khi bật bình luận
  useEffect(() => {
    if (engagementMode !== 'LIKE_ONLY') {
      if (delayMs < 6000) {
        setDelayMs(12000); // 12 giây mặc định an toàn khi có bình luận
      }
    } else if (delayMs >= 6000) {
      setDelayMs(3800); // Quay về mức an toàn chuẩn của chế độ chỉ like
    }
  }, [engagementMode]);

  // History & Anti-Duplicate States
  const [activeTabKey, setActiveTabKey] = useState<string>('buff-like');
  const [buffLogs, setBuffLogs] = useState<BuffLogEntry[]>(() => loadBuffLogs());
  useEffect(() => {
    saveBuffLogs(buffLogs);
  }, [buffLogs]);
  const [autoSkipAlreadyLiked, setAutoSkipAlreadyLiked] = useState<boolean>(true);
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logFilterReaction, setLogFilterReaction] = useState<string>('ALL');
  const [selectedLogDetail, setSelectedLogDetail] = useState<BuffLogEntry | null>(null);

  // Tính toán các Fanpage đã từng like link bài viết này trong lịch sử
  const alreadyLikedPagesForUrl = useMemo(() => {
    if (!targetPostUrl.trim()) return [];
    const normalizedTarget = targetPostUrl.trim();
    const matchingLogs = buffLogs.filter((log) => log.targetUrl === normalizedTarget);
    const pageMap = new Map<string, { pageId: string; pageName: string; reactionType: string; date: string }>();
    for (const log of matchingLogs) {
      for (const d of log.details || []) {
        if (d.status === 'SUCCESS' || d.status === 'ALREADY_LIKED') {
          if (!pageMap.has(d.pageId)) {
            pageMap.set(d.pageId, {
              pageId: d.pageId,
              pageName: d.pageName,
              reactionType: log.reactionType,
              date: log.createdAt,
            });
          }
        }
      }
    }
    return Array.from(pageMap.values());
  }, [targetPostUrl, buffLogs]);

  // Batch Buff State (Chạy like hàng loạt nhiều bài viết)
  const [batchLinksText, setBatchLinksText] = useState<string>('');
  const [batchLikesPerOrder, setBatchLikesPerOrder] = useState<number>(20);
  const batchWaitSeconds = 2;
  const [batchOrders, setBatchOrders] = useState<BatchOrder[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
  const [isBatchPaused, setIsBatchPaused] = useState<boolean>(false);
  const batchAbortRef = useRef<boolean>(false);
  const batchPauseRef = useRef<boolean>(false);
  const buffAbortRef = useRef<AbortController | null>(null);
  const batchStreamAbortRef = useRef<AbortController | null>(null);

  // Rời trang thì huỷ mọi stream đang chạy (worker sẽ dừng sau page hiện tại)
  useEffect(() => {
    return () => {
      batchAbortRef.current = true;
      batchPauseRef.current = false;
      buffAbortRef.current?.abort();
      batchStreamAbortRef.current?.abort();
    };
  }, []);

  // Quản lý & Khai báo thêm i_user (Fanpage) cho từng Via
  const queryClient = useQueryClient();
  const [managePagesModalOpen, setManagePagesModalOpen] = useState<boolean>(false);
  const [targetViaForModal, setTargetViaForModal] = useState<number | 'CUSTOM'>('CUSTOM');
  const [refreshViaPagesKey, setRefreshViaPagesKey] = useState<number>(0);
  const [addMode, setAddMode] = useState<'BULK' | 'SINGLE'>('BULK');
  const [newPageName, setNewPageName] = useState<string>('');
  const [newPageIdOrUrl, setNewPageIdOrUrl] = useState<string>('');
  const [bulkPagesText, setBulkPagesText] = useState<string>('');

  // Fetch accounts from backend with staleTime 0 so newly added Vias appear instantly
  const { data: accounts = [], isLoading: loadingAccounts, refetch: refetchAccounts } = useQuery({
    queryKey: ['socialAccounts'],
    queryFn: async () => (await api.get('/connections')).data || [],
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  // Deduplicate mother account by c_user
  const fbAccounts = useMemo(() => {
    const byCUser = new Map<string, any>();
    for (const account of accounts as any[]) {
      if (!isPersonalCookieAccount(account) || account.platform === 'FACEBOOK_GROUP') continue;
      const cUser = extractCUser(account.cookieString || account.accessToken);
      if (!cUser) continue;
      const existing = byCUser.get(cUser);
      const accountIsProfile =
        account.platform === 'FACEBOOK_PROFILE' || account.accountType === 'PERSONAL_PROFILE_COOKIE';
      const existingIsProfile =
        existing?.platform === 'FACEBOOK_PROFILE' || existing?.accountType === 'PERSONAL_PROFILE_COOKIE';
      if (
        !existing ||
        (accountIsProfile && !existingIsProfile) ||
        (accountIsProfile === existingIsProfile && existing.tokenStatus !== 'OK' && account.tokenStatus === 'OK') ||
        (accountIsProfile === existingIsProfile && existing.tokenStatus === account.tokenStatus && account.id > existing.id)
      ) {
        byCUser.set(cUser, account);
      }
    }

    return Array.from(byCUser.values());
  }, [accounts]);

  // Active Cookie string
  const activeCookie = useMemo(() => {
    if (selectedAccountId === 'CUSTOM') return customCookie.trim();
    if (selectedAccountId === 'ALL_VIAS') {
      return fbAccounts[0]?.cookieString || fbAccounts[0]?.accessToken || '';
    }
    const acc = fbAccounts.find((a: any) => a.id === selectedAccountId);
    return acc?.cookieString || acc?.accessToken || '';
  }, [selectedAccountId, customCookie, fbAccounts]);

  const currentViaAccount = useMemo(() => {
    if (selectedAccountId === 'CUSTOM' || selectedAccountId === 'ALL_VIAS') return null;
    return fbAccounts.find((a: any) => a.id === selectedAccountId) || null;
  }, [selectedAccountId, fbAccounts]);

  const modalViaAccount = useMemo(() => {
    if (targetViaForModal === 'CUSTOM') return null;
    return fbAccounts.find((a: any) => a.id === targetViaForModal) || null;
  }, [targetViaForModal, fbAccounts]);

  const targetViaKey = useMemo(() => {
    return getViaKey(modalViaAccount, customCookie);
  }, [modalViaAccount, customCookie]);

  const currentModalPages = useMemo(() => {
    void refreshViaPagesKey;
    return getStoredPagesForVia(targetViaKey);
  }, [targetViaKey, refreshViaPagesKey]);

  const handleOpenManagePages = (viaId?: number | 'CUSTOM' | 'ALL_VIAS') => {
    const id = viaId !== undefined && viaId !== 'ALL_VIAS' ? viaId : (fbAccounts[0]?.id || 'CUSTOM');
    setTargetViaForModal(id);
    setManagePagesModalOpen(true);
  };

  // Auto select ALL_VIAS if multiple accounts exist, else first account
  useEffect(() => {
    if (selectedAccountId === 'CUSTOM' && !customCookie.trim() && fbAccounts.length > 0) {
      setSelectedAccountId(fbAccounts.length > 1 ? 'ALL_VIAS' : fbAccounts[0].id);
    }
  }, [fbAccounts, selectedAccountId, customCookie]);

  // Load persistent Fanpages for selected Via or ALL_VIAS
  useEffect(() => {
    if (selectedAccountId === 'CUSTOM') {
      const viaKey = getViaKey('CUSTOM', customCookie);
      const saved = getStoredPagesForVia(viaKey);
      setScannedPages(saved);
      setSelectedPageIds(saved.map((p) => p.id));
      return;
    }

    // NẾU ĐANG CHỌN CHẾ ĐỘ DÀN VIA CÁ NHÂN: DÙNG TRỰC TIẾP TỪNG NICK VIA
    if (actorMode === 'VIAS') {
      if (selectedAccountId === 'ALL_VIAS') {
        const viaItems: FanpageItem[] = fbAccounts.map((a: any) => {
          const cUser = extractCUser(a.cookieString || a.accessToken) || String(a.platformAccountId || a.id);
          return {
            id: cUser,
            name: a.pageName || `Via ${cUser}`,
            url: `https://www.facebook.com/profile.php?id=${cUser}`,
            viaAccountId: a.id,
            viaName: a.pageName || `Via ${cUser}`,
            viaCookie: a.cookieString || a.accessToken,
            isProfile: true,
          };
        });
        setScannedPages(viaItems);
        setSelectedPageIds(viaItems.map((p) => p.id));
        return;
      }

      const sourceAccount = fbAccounts.find((account: any) => account.id === selectedAccountId);
      if (sourceAccount) {
        const cUser = extractCUser(sourceAccount.cookieString || sourceAccount.accessToken) || String(sourceAccount.platformAccountId || sourceAccount.id);
        const item: FanpageItem = {
          id: cUser,
          name: sourceAccount.pageName || `Via ${cUser}`,
          url: `https://www.facebook.com/profile.php?id=${cUser}`,
          viaAccountId: sourceAccount.id,
          viaName: sourceAccount.pageName || `Via ${cUser}`,
          viaCookie: sourceAccount.cookieString || sourceAccount.accessToken,
          isProfile: true,
        };
        setScannedPages([item]);
        setSelectedPageIds([item.id]);
        return;
      }
    }

    if (selectedAccountId === 'ALL_VIAS') {
      const allPages: FanpageItem[] = [];
      const seenPageIds = new Set<string>();

      for (const account of fbAccounts) {
        const sourceCUser = extractCUser(account?.cookieString || account?.accessToken);
        const viaKey = getViaKey(account);
        const localSaved = getStoredPagesForVia(viaKey);

        const dbPages: FanpageItem[] = (accounts as any[])
          .filter(
            (acc) =>
              acc.platform === 'FACEBOOK_PAGE' &&
              acc.accountType === 'PERSONAL_COOKIE' &&
              (sourceCUser ? extractCUser(acc.cookieString || acc.accessToken) === sourceCUser : true)
          )
          .map((acc) => ({
            id: String(acc.platformAccountId),
            name: acc.pageName || `Facebook Page ${acc.platformAccountId}`,
            url: `https://www.facebook.com/profile.php?id=${acc.platformAccountId}`,
          }));

        const map = new Map<string, FanpageItem>();
        for (const p of localSaved) {
          if (p.id) map.set(p.id, p);
        }
        for (const p of dbPages) {
          if (p.id && !map.has(p.id)) {
            map.set(p.id, p);
          }
        }

        for (const p of map.values()) {
          // If page already in seenPageIds (shared between accounts), tag both or keep unique
          if (!seenPageIds.has(p.id)) {
            seenPageIds.add(p.id);
            allPages.push({
              ...p,
              viaAccountId: account.id,
              viaName: account.pageName || 'Via Facebook',
              viaCookie: account.cookieString || account.accessToken,
            });
          }
        }
      }

      setScannedPages(allPages);
      setSelectedPageIds(allPages.map((p) => p.id));
      return;
    }

    const sourceAccount = fbAccounts.find((account: any) => account.id === selectedAccountId);
    if (!sourceAccount) return;
    const sourceCUser = extractCUser(sourceAccount?.cookieString || sourceAccount?.accessToken);
    const viaKey = getViaKey(sourceAccount);

    const localSaved = getStoredPagesForVia(viaKey);

    const dbPages: FanpageItem[] = (accounts as any[])
      .filter(
        (account) =>
          account.platform === 'FACEBOOK_PAGE' &&
          account.accountType === 'PERSONAL_COOKIE' &&
          (sourceCUser ? extractCUser(account.cookieString || account.accessToken) === sourceCUser : true)
      )
      .map((account) => ({
        id: String(account.platformAccountId),
        name: account.pageName || `Facebook Page ${account.platformAccountId}`,
        url: `https://www.facebook.com/profile.php?id=${account.platformAccountId}`,
      }));

    // Merge unique by ID: localSaved takes precedence, then dbPages
    const map = new Map<string, FanpageItem>();
    for (const p of localSaved) {
      if (p.id) map.set(p.id, p);
    }
    for (const p of dbPages) {
      if (p.id && !map.has(p.id)) {
        map.set(p.id, p);
      }
    }
    const mergedList = Array.from(map.values())
      .map((p) => ({
        ...p,
        viaAccountId: sourceAccount.id,
        viaName: sourceAccount.pageName || 'Via Facebook',
        viaCookie: sourceAccount.cookieString || sourceAccount.accessToken,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));

    if (mergedList.length > 0) {
      saveStoredPagesForVia(viaKey, mergedList);
    }
    setScannedPages(mergedList);
    setSelectedPageIds(mergedList.map((p) => p.id));
  }, [accounts, fbAccounts, selectedAccountId, actorMode]);

  useEffect(() => {
    if (scannedPages.length > 0) {
      setBatchLikesPerOrder((prev) => (prev === 20 || prev === 0 ? scannedPages.length : prev));
    }
  }, [scannedPages]);

  const parsedBatchLinks = useMemo(() => {
    return batchLinksText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && (l.startsWith('http://') || l.startsWith('https://')));
  }, [batchLinksText]);


  // Bóc tách danh sách Fanpage từ ô nhập hàng loạt
  const parsedBulkPages = useMemo(() => {
    if (!bulkPagesText.trim()) return [];
    const lines = bulkPagesText.split('\n');
    const results: { pageName: string; platformAccountId: string }[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let id = '';
      let name = '';
      if (trimmed.includes('|')) {
        const parts = trimmed.split('|').map((p) => p.trim());
        const firstIsId = extractPageId(parts[0]);
        const secondIsId = extractPageId(parts[1]);
        if (firstIsId) {
          id = firstIsId;
          name = parts[1] || `Fanpage (${id.slice(-4)})`;
        } else if (secondIsId) {
          id = secondIsId;
          name = parts[0] || `Fanpage (${id.slice(-4)})`;
        }
      } else {
        const extracted = extractPageId(trimmed);
        if (extracted) {
          id = extracted;
          name = `Fanpage (${id.slice(-4)})`;
        }
      }
      if (id && !results.some((r) => r.platformAccountId === id)) {
        results.push({ pageName: name, platformAccountId: id });
      }
    }
    return results;
  }, [bulkPagesText]);

  // Mutation: Lưu các Fanpage mới vào Via
  const savePagesMutation = useMutation({
    mutationFn: async (pagesToAdd: { pageName: string; platformAccountId: string }[]) => {
      const motherAccount = fbAccounts.find((a: any) => a.id === (targetViaForModal !== 'CUSTOM' ? targetViaForModal : selectedAccountId));
      const motherCookie = motherAccount?.cookieString || motherAccount?.accessToken || customCookie;
      if (!motherCookie) {
        return [];
      }

      const created = [];
      for (const p of pagesToAdd) {
        try {
          const res = await api.post('/connections', {
            platform: 'FACEBOOK_PAGE',
            accountType: 'PERSONAL_COOKIE',
            platformAccountId: p.platformAccountId,
            pageName: p.pageName,
            accessToken: motherCookie,
            tokenStatus: 'OK',
          });
          created.push(res.data);
        } catch {
          // Ignore backend conflict if already exists
        }
      }
      return created;
    },
    onSuccess: (res) => {
      if (res.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
      }
    },
    onError: () => {},
  });

  // Handlers lưu / xóa Fanpage cho Via cụ thể
  const handleSavePagesForTargetVia = (pagesToAdd: FanpageItem[]) => {
    const existing = getStoredPagesForVia(targetViaKey);
    const merged = [...existing];
    for (const p of pagesToAdd) {
      const idx = merged.findIndex((m) => m.id === p.id);
      if (idx >= 0) {
        if (p.name) merged[idx] = { ...merged[idx], name: p.name };
      } else {
        merged.push(p);
      }
    }
    saveStoredPagesForVia(targetViaKey, merged);
    setRefreshViaPagesKey((prev) => prev + 1);

    if (targetViaForModal === selectedAccountId) {
      setScannedPages(merged);
      setSelectedPageIds(merged.map((p) => p.id));
    }

    message.success(`Đã lưu ${pagesToAdd.length} Fanpage cho Via ${modalViaAccount?.pageName || 'này'}!`);

    savePagesMutation.mutate(pagesToAdd.map((p) => ({ pageName: p.name, platformAccountId: p.id })));
  };

  const handleDeletePageForTargetVia = (pageId: string) => {
    const existing = getStoredPagesForVia(targetViaKey);
    const updated = existing.filter((p) => p.id !== pageId);
    saveStoredPagesForVia(targetViaKey, updated);
    setRefreshViaPagesKey((prev) => prev + 1);

    if (targetViaForModal === selectedAccountId) {
      setScannedPages(updated);
      setSelectedPageIds((prev) => prev.filter((id) => id !== pageId));
    }

    message.success('Đã xóa Fanpage khỏi danh sách của Via!');
    deletePageMutation.mutate(pageId);
  };

  const handleClearPagesForTargetVia = () => {
    saveStoredPagesForVia(targetViaKey, []);
    setRefreshViaPagesKey((prev) => prev + 1);
    if (targetViaForModal === selectedAccountId) {
      setScannedPages([]);
      setSelectedPageIds([]);
    }
    message.info('Đã xóa danh sách để nhập lại.');
  };

  // Mutation: Xoá Fanpage khỏi hệ thống
  const deletePageMutation = useMutation({
    mutationFn: async (pageId: string) => {
      const acc = (accounts as any[]).find(
        (a) => a.platform === 'FACEBOOK_PAGE' && String(a.platformAccountId) === String(pageId)
      );
      if (acc) {
        await api.delete(`/connections/${acc.id}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    },
    onError: () => {},
  });

  // Filter pages by search query
  const filteredPages = useMemo(() => {
    if (!pageSearchQuery.trim()) return scannedPages;
    const q = pageSearchQuery.toLowerCase().trim();
    return scannedPages.filter((p) => p.name.toLowerCase().includes(q) || p.id.includes(q));
  }, [scannedPages, pageSearchQuery]);

  // Mutation: Scan Fanpages from Cookie (Merges & preserves pages, never drops count)
  const scanPagesMutation = useMutation({
    mutationFn: async (cookie: string) => {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-get-pages`, {
        cookieString: cookie,
        forceRefresh: true,
      });
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success && data.pages) {
        const sourceAccount = fbAccounts.find((account: any) => account.id === selectedAccountId);
        const viaKey = getViaKey(sourceAccount, customCookie);
        const existing = getStoredPagesForVia(viaKey);
        const merged = [...existing];
        let newCount = 0;
        for (const p of data.pages) {
          const idx = merged.findIndex((m) => m.id === p.id);
          if (idx >= 0) {
            if (p.name && (!merged[idx].name || merged[idx].name.includes('Fanpage ('))) {
              merged[idx] = { ...merged[idx], name: p.name };
            }
          } else {
            merged.push(p);
            newCount++;
          }
        }
        saveStoredPagesForVia(viaKey, merged);
        setRefreshViaPagesKey((prev) => prev + 1);
        setScannedPages(merged);
        setSelectedPageIds(merged.map((p: FanpageItem) => p.id));
        message.success(
          `Đã quét xong Facebook! Tổng cộng giữ đủ ${merged.length} Fanpage cho Via này${
            newCount > 0 ? ` (tìm thấy thêm ${newCount} Page mới)` : ''
          }.`
        );
      } else {
        message.warning('Không tìm thấy Fanpage nào hoặc cookie hết hạn.');
      }
    },
    onError: (err: any) => {
      message.error(`Lỗi khi quét Fanpage: ${err.response?.data?.error || err.message}`);
    },
  });

  // Mutation: Auto Buff Like (Playwright Bot - Real-time SSE Stream)
  const autoBuffMutation = useMutation({
    mutationFn: async () => {
      if (!activeCookie) {
        throw new Error('Vui lòng chọn tài khoản hoặc dán Cookie Facebook!');
      }
      if (!isFacebookPostUrl(targetPostUrl)) {
        throw new Error('Vui lòng nhập link bài viết Facebook hợp lệ (https://facebook.com/...)');
      }
      if (selectedPageIds.length === 0) {
        throw new Error('Vui lòng chọn ít nhất 1 Fanpage để thả Like!');
      }

      let pagesToBuff = scannedPages.filter((p) => selectedPageIds.includes(p.id));

      if (autoSkipAlreadyLiked && alreadyLikedPagesForUrl.length > 0) {
        const alreadyLikedIds = new Set(alreadyLikedPagesForUrl.map((p) => p.pageId));
        const filtered = pagesToBuff.filter((p) => !alreadyLikedIds.has(p.id));
        if (filtered.length === 0) {
          throw new Error('Tất cả các Page bạn chọn đã từng like bài viết này trước đó rồi! Vui lòng chọn Page khác hoặc tắt mục "Tự động bỏ qua các Page đã Like".');
        }
        pagesToBuff = filtered;
      }

      const initialDetails: AutoBuffResultDetail[] = pagesToBuff.map((p) => ({
        pageId: p.id,
        pageName: p.name,
        viaName: p.viaName,
        status: 'WAITING',
        message: 'Đang xếp hàng chờ...',
      }));

      setAutoBuffProgress({
        total: pagesToBuff.length,
        success: 0,
        failed: 0,
        alreadyLiked: 0,
        percent: 0,
        currentRunningPageName: pagesToBuff[0]?.name,
        status: 'RUNNING',
        details: initialDetails,
      });

      // Chốt link tại thời điểm bắt đầu (người dùng có thể sửa ô link trong lúc chạy)
      const runTargetUrl = targetPostUrl.trim();
      const runAccountName =
        selectedAccountId === 'ALL_VIAS'
          ? `Toàn bộ dàn Via (${fbAccounts.length} Via)`
          : (fbAccounts as any[]).find((a) => a.id === selectedAccountId)?.pageName || 'Via Facebook';
      const commentLines = commentListText.split('\n').map((s) => s.trim()).filter(Boolean);
      const viaGroups = groupPagesByVia(
        pagesToBuff,
        activeCookie,
        (selectedAccountId !== 'CUSTOM' && selectedAccountId !== 'ALL_VIAS' ? currentViaAccount?.pageName : '') || 'Via Facebook'
      );

      const controller = new AbortController();
      buffAbortRef.current = controller;

      // Bản sao cục bộ của tiến trình: updater của setState chỉ copy, không có side-effect
      const liveDetails: AutoBuffResultDetail[] = [...initialDetails];
      let finishedPagesCount = 0;
      const publish = (currentRunningPageName?: string) => {
        const counts = summarizeBuffDetails(liveDetails);
        const snapshot = [...liveDetails];
        setAutoBuffProgress((prev) => ({
          ...prev,
          success: counts.success,
          alreadyLiked: counts.alreadyLiked,
          failed: counts.failed,
          percent: Math.round((finishedPagesCount / pagesToBuff.length) * 100),
          currentRunningPageName,
          details: snapshot,
        }));
      };
      const patchDetail = (pageId: string, patch: Partial<AutoBuffResultDetail>) => {
        const idx = liveDetails.findIndex((d) => d.pageId === pageId);
        if (idx !== -1) liveDetails[idx] = { ...liveDetails[idx], ...patch };
      };

      for (let gIdx = 0; gIdx < viaGroups.length; gIdx++) {
        if (controller.signal.aborted) break;
        const group = viaGroups[gIdx];

        if (gIdx > 0) {
          publish(`Chuyển sang Via [${group.viaName}] (nghỉ an toàn 3s)...`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          if (controller.signal.aborted) break;
        }

        const selectedPagesPayload = group.pages.map((p, pIdx) => ({
          id: p.id,
          name: p.name,
          isProfile: p.isProfile ?? (actorMode === 'VIAS'),
          comment: commentLines.length > 0 ? commentLines[(finishedPagesCount + pIdx) % commentLines.length] : '',
        }));
        const payload = {
          cookieString: group.cookieString,
          targetUrl: runTargetUrl,
          reactionType: selectedReaction,
          selectedPages: selectedPagesPayload,
          delayMs,
          enableLike: engagementMode !== 'COMMENT_ONLY',
          enableComment: engagementMode !== 'LIKE_ONLY',
          enableHumanBehavior,
          fastSwitch,
          cooldownEvery: antiCheckpointGuard ? 15 : 9999,
          cooldownDurationMs: 3500,
          comments: commentLines,
        };

        const applyFinalDetails = (details: AutoBuffResultDetail[]) => {
          for (const d of details) patchDetail(d.pageId, { ...d, viaName: group.viaName });
        };

        try {
          const result = await runBuffStream(
            payload,
            (ev) => {
              if (ev.type === 'PAGE_START') {
                patchDetail(ev.pageId, {
                  viaName: group.viaName,
                  status: 'RUNNING',
                  message: `[${group.viaName}] Đang mở bài và tương tác...`,
                });
                publish(`[${group.viaName}] ${ev.pageName}`);
              } else if (ev.type === 'PAGE_FINISH') {
                finishedPagesCount++;
                patchDetail(ev.pageId, {
                  viaName: group.viaName,
                  status: ev.status,
                  likeStatus: ev.likeStatus,
                  commentStatus: ev.commentStatus,
                  commentText: ev.commentText,
                  message: ev.message,
                  error: ev.error,
                });
                publish(undefined);
              }
            },
            controller.signal
          );
          applyFinalDetails(result.details || []);
        } catch (streamErr: any) {
          const canFallback = !streamErr.receivedAny && !controller.signal.aborted;
          if (canFallback) {
            // Stream chưa khởi động được (worker cũ / proxy chặn SSE) → chạy bản đồng bộ đúng 1 lần
            console.warn(`Fallback sang /api/buff-like cho nhóm ${group.viaName}:`, streamErr.message);
            try {
              const res = await axios.post(`${WORKER_BASE_URL}/api/buff-like`, payload, { signal: controller.signal });
              applyFinalDetails(res.data?.result?.details || []);
            } catch (syncErr: any) {
              for (const p of group.pages) {
                const current = liveDetails.find((d) => d.pageId === p.id);
                if (current && (current.status === 'WAITING' || current.status === 'RUNNING')) {
                  patchDetail(p.id, { status: 'ERROR', error: syncErr.response?.data?.error || syncErr.message });
                }
              }
            }
          } else {
            const reason = controller.signal.aborted ? 'Đã dừng' : streamErr.message;
            for (const p of group.pages) {
              const current = liveDetails.find((d) => d.pageId === p.id);
              if (current && (current.status === 'WAITING' || current.status === 'RUNNING')) {
                patchDetail(p.id, { status: controller.signal.aborted ? 'SKIPPED' : 'ERROR', message: reason, error: controller.signal.aborted ? undefined : reason });
              }
            }
          }
          finishedPagesCount = liveDetails.filter((d) => d.status !== 'WAITING' && d.status !== 'RUNNING').length;
          publish(undefined);
        }
      }

      buffAbortRef.current = null;
      return { details: [...liveDetails], runTargetUrl, runAccountName, stopped: controller.signal.aborted };
    },
    onSuccess: ({ details, runTargetUrl, runAccountName, stopped }) => {
      const counts = summarizeBuffDetails(details);
      if (runTargetUrl && details.length > 0) {
        const newLog: BuffLogEntry = {
          id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
          createdAt: new Date().toISOString(),
          type: 'SINGLE',
          targetUrl: runTargetUrl,
          reactionType: selectedReaction,
          totalPages: details.length,
          successCount: counts.success,
          alreadyLikedCount: counts.alreadyLiked,
          failedCount: counts.failed,
          engagementMode,
          commentCount: counts.comments,
          accountName: runAccountName,
          details,
        };
        setBuffLogs((prevLogs) => [newLog, ...prevLogs]);
      }

      setAutoBuffProgress((prev) => ({
        ...prev,
        total: prev.total || details.length,
        success: counts.success,
        alreadyLiked: counts.alreadyLiked,
        failed: counts.failed,
        percent: 100,
        currentRunningPageName: undefined,
        status: 'DONE',
        details,
      }));

      if (stopped) {
        message.info(`Đã dừng. ${counts.success} thành công, các Page còn lại được bỏ qua. Đã lưu vào lịch sử.`);
      } else {
        message.success(`Hoàn thành: ${counts.success} thành công, ${counts.failed} lỗi. Đã lưu vào lịch sử.`);
      }
    },
    onError: (err: any) => {
      buffAbortRef.current = null;
      setAutoBuffProgress((prev) => ({ ...prev, status: 'ERROR', currentRunningPageName: undefined }));
      message.error(`Lỗi hệ thống: ${err.response?.data?.error || err.message}`);
    },
  });

  const handleStopAutoBuff = () => {
    buffAbortRef.current?.abort();
    message.info('Đang dừng: worker sẽ dừng sau Page hiện tại.');
  };

  // Mutation: Buff View
  const buffViewMutation = useMutation({
    mutationFn: async () => {
      setViewProgress({ total: targetViews, done: 0, status: 'RUNNING' });
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-view`, {
        targetUrl: targetViewUrl,
        targetViews,
        concurrency,
        watchTimeSeconds,
      });
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success && data.result) {
        setViewProgress({ total: targetViews, done: data.result.completed, status: 'DONE' });
        message.success(`Đã buff xong ${data.result.completed}/${targetViews} Views cho video!`);
      }
    },
    onError: (err: any) => {
      setViewProgress((prev) => ({ ...prev, status: 'IDLE' }));
      message.error(`Lỗi buff View: ${err.response?.data?.error || err.message}`);
    },
  });

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(ENGAGEMENT_STORAGE_KEY);
      if (!saved) return;
      const data = JSON.parse(saved);
      if (typeof data.targetPostUrl === 'string') setTargetPostUrl(data.targetPostUrl);
      if (typeof data.selectedReaction === 'string') setSelectedReaction(data.selectedReaction);
    } catch {
      window.localStorage.removeItem(ENGAGEMENT_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(ENGAGEMENT_STORAGE_KEY, JSON.stringify({ targetPostUrl, selectedReaction }));
    } catch {}
  }, [targetPostUrl, selectedReaction]);

  const handleScanPages = () => {
    if (!activeCookie) {
      message.warning('Vui lòng chọn tài khoản hoặc dán Cookie trước khi quét Fanpage!');
      return;
    }
    scanPagesMutation.mutate(activeCookie);
  };

  const handleStartAutoBuff = () => {
    if (!isFacebookPostUrl(targetPostUrl)) {
      message.warning('Vui lòng nhập link bài viết Facebook hợp lệ (https://facebook.com/...).');
      return;
    }
    if (selectedPageIds.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 Fanpage.');
      return;
    }
    autoBuffMutation.mutate();
  };

  const handleStartBatchBuff = async () => {
    if (!activeCookie) {
      message.warning('Vui lòng chọn tài khoản hoặc dán Cookie Facebook trước!');
      return;
    }
    if (parsedBatchLinks.length === 0) {
      message.warning('Vui lòng dán ít nhất 1 liên kết Facebook hợp lệ vào danh sách!');
      return;
    }
    if (scannedPages.length === 0) {
      message.warning('Chưa có Fanpage nào được tải! Hãy bấm "Quét lại danh sách Fanpage" trước.');
      return;
    }

    const availablePages =
      selectedPageIds.length > 0
        ? scannedPages.filter((p) => selectedPageIds.includes(p.id))
        : scannedPages;

    if (availablePages.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 Fanpage để thả like!');
      return;
    }

    const targetLikes = Math.min(batchLikesPerOrder, availablePages.length);

    const initialOrders: BatchOrder[] = parsedBatchLinks.map((url, idx) => ({
      id: idx + 1,
      url,
      orderNumber: idx + 1,
      status: 'PENDING',
      successLikes: 0,
      totalLikesTarget: targetLikes,
      percent: 0,
      details: availablePages.slice(0, targetLikes).map((p) => ({
        pageId: p.id,
        pageName: p.name,
        status: 'WAITING',
        message: 'Chờ đến lượt bài viết...',
      })),
    }));

    const commentLines = commentListText.split('\n').map((s) => s.trim()).filter(Boolean);
    const batchAccountName =
      selectedAccountId === 'ALL_VIAS'
        ? `Toàn bộ dàn Via (${fbAccounts.length} Via)`
        : (fbAccounts as any[]).find((a) => a.id === selectedAccountId)?.pageName || 'Via Facebook';

    setBatchOrders(initialOrders);
    setIsBatchRunning(true);
    setIsBatchPaused(false);
    batchAbortRef.current = false;
    batchPauseRef.current = false;

    for (let i = 0; i < initialOrders.length; i++) {
      if (batchAbortRef.current) break;

      while (batchPauseRef.current) {
        if (batchAbortRef.current) break;
        await new Promise((r) => setTimeout(r, 600));
      }
      if (batchAbortRef.current) break;

      setBatchOrders((prev) =>
        prev.map((o, idx) => (idx === i ? { ...o, status: 'RUNNING' } : o))
      );

      const pagesToUse = availablePages.slice(0, targetLikes);
      const orderUrl = initialOrders[i].url;
      const viaGroups = groupPagesByVia(pagesToUse, activeCookie, batchAccountName);
      const orderDetails: AutoBuffResultDetail[] = [...(initialOrders[i].details || [])];
      const patchOrderDetail = (pageId: string, patch: Partial<AutoBuffResultDetail>) => {
        const dIdx = orderDetails.findIndex((d) => d.pageId === pageId);
        if (dIdx !== -1) orderDetails[dIdx] = { ...orderDetails[dIdx], ...patch };
      };
      const publishOrder = (patch: Partial<BatchOrder>) => {
        const snapshot = [...orderDetails];
        const successLikes = snapshot.filter((d) => d.status === 'SUCCESS' || d.status === 'ALREADY_LIKED').length;
        const finished = snapshot.filter((d) => d.status !== 'WAITING' && d.status !== 'RUNNING').length;
        setBatchOrders((prev) =>
          prev.map((o, idx) =>
            idx === i
              ? {
                  ...o,
                  successLikes,
                  percent: Math.round((finished / Math.max(1, snapshot.length)) * 100),
                  details: snapshot,
                  ...patch,
                }
              : o
          )
        );
      };

      const controller = new AbortController();
      batchStreamAbortRef.current = controller;
      let orderError = '';

      for (let gIdx = 0; gIdx < viaGroups.length; gIdx++) {
        if (controller.signal.aborted || batchAbortRef.current) break;
        const group = viaGroups[gIdx];
        if (gIdx > 0) await new Promise((r) => setTimeout(r, 3000));

        try {
          const result = await runBuffStream(
            {
              cookieString: group.cookieString,
              targetUrl: orderUrl,
              reactionType: selectedReaction,
              selectedPages: group.pages.map((p, pIdx) => ({
                id: p.id,
                name: p.name,
                isProfile: p.isProfile ?? (actorMode === 'VIAS'),
                comment: commentLines.length > 0 ? commentLines[pIdx % commentLines.length] : '',
              })),
              delayMs,
              enableLike: engagementMode !== 'COMMENT_ONLY',
              enableComment: engagementMode !== 'LIKE_ONLY',
              enableHumanBehavior,
              fastSwitch,
              cooldownEvery: antiCheckpointGuard ? 15 : 9999,
              cooldownDurationMs: 3500,
              comments: commentLines,
            },
            (ev) => {
              if (ev.type === 'PAGE_START') {
                patchOrderDetail(ev.pageId, { viaName: group.viaName, status: 'RUNNING', message: 'Đang mở bài và thực hiện tương tác...' });
                publishOrder({ currentRunningPageName: ev.pageName });
              } else if (ev.type === 'PAGE_FINISH') {
                patchOrderDetail(ev.pageId, {
                  viaName: group.viaName,
                  status: ev.status,
                  likeStatus: ev.likeStatus,
                  commentStatus: ev.commentStatus,
                  commentText: ev.commentText,
                  message: ev.message,
                  error: ev.error,
                });
                publishOrder({});
              }
            },
            controller.signal
          );
          for (const d of result.details || []) patchOrderDetail(d.pageId, { ...d, viaName: group.viaName });
        } catch (err: any) {
          const stopped = controller.signal.aborted;
          orderError = stopped ? 'Đã dừng' : err.message;
          for (const p of group.pages) {
            const current = orderDetails.find((d) => d.pageId === p.id);
            if (current && (current.status === 'WAITING' || current.status === 'RUNNING')) {
              patchOrderDetail(p.id, { status: stopped ? 'SKIPPED' : 'ERROR', message: orderError, error: stopped ? undefined : orderError });
            }
          }
          if (stopped) break;
        }
      }
      batchStreamAbortRef.current = null;

      const counts = summarizeBuffDetails(orderDetails);
      const wasStopped = controller.signal.aborted || batchAbortRef.current;
      const finalStatus: BatchOrder['status'] = wasStopped
        ? 'PAUSED'
        : counts.success + counts.alreadyLiked + counts.unverified > 0
        ? 'COMPLETED'
        : 'FAILED';
      publishOrder({
        status: finalStatus,
        percent: 100,
        currentRunningPageName: undefined,
        ...(finalStatus === 'FAILED' ? { error: orderError || 'Không có Page nào tương tác thành công' } : {}),
      });

      if (orderDetails.some((d) => d.status !== 'WAITING')) {
        const newBatchLog: BuffLogEntry = {
          id: 'log_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substring(2, 9),
          createdAt: new Date().toISOString(),
          type: 'BATCH',
          targetUrl: orderUrl,
          reactionType: selectedReaction,
          totalPages: orderDetails.length,
          successCount: counts.success,
          alreadyLikedCount: counts.alreadyLiked,
          failedCount: counts.failed,
          engagementMode,
          commentCount: counts.comments,
          accountName: batchAccountName,
          details: [...orderDetails],
        };
        setBuffLogs((prevLogs) => [newBatchLog, ...prevLogs]);
      }

      if (batchWaitSeconds > 0 && i < initialOrders.length - 1 && !batchAbortRef.current) {
        await new Promise((r) => setTimeout(r, batchWaitSeconds * 1000));
      }
    }

    setIsBatchRunning(false);
    setIsBatchPaused(false);
    if (batchAbortRef.current) {
      message.info('Đã dừng tiến trình chạy nhiều link.');
    } else {
      message.success('Đã hoàn thành tiến trình chạy nhiều link!');
    }
  };

  const handlePauseBatchBuff = () => {
    if (isBatchPaused) {
      batchPauseRef.current = false;
      setIsBatchPaused(false);
      message.info('Tiếp tục chạy...');
    } else {
      batchPauseRef.current = true;
      setIsBatchPaused(true);
      message.warning('Sẽ tạm dừng sau khi xong bài hiện tại.');
    }
  };

  const handleStopBatchBuff = () => {
    batchAbortRef.current = true;
    batchPauseRef.current = false;
    batchStreamAbortRef.current?.abort();
    setIsBatchPaused(false);
    setBatchOrders((prev) => prev.map((o) => (o.status === 'PENDING' ? { ...o, status: 'PAUSED' } : o)));
    message.info('Đang dừng: worker sẽ dừng sau Page hiện tại.');
  };

  // Quick Action Presets
  const handleQuickPresetLike24 = () => {
    setBuffMode('SINGLE');
    setEngagementMode('LIKE_ONLY');
    setSelectedReaction('LIKE');
    setActorMode('FANPAGES');
    setSelectedAccountId('ALL_VIAS');
    setSelectedPageIds(scannedPages.map((p) => p.id));
    message.success(`Đã kích hoạt Preset: Thả Like toàn bộ ${scannedPages.length} Fanpage!`);
  };

  const handleQuickPresetAiSeeding = async () => {
    setBuffMode('SINGLE');
    setEngagementMode('LIKE_AND_COMMENT');
    setSelectedReaction('RANDOM_POSITIVE');
    setActorMode('FANPAGES');
    setSelectedAccountId('ALL_VIAS');
    setSelectedPageIds(scannedPages.map((p) => p.id));
    if (targetPostUrl.trim()) {
      handleGenerateAiComments();
    } else {
      message.info('Đã bật chế độ Seeding (Like + Bình Luận AI). Vui lòng dán link bài viết để AI đọc nội dung!');
    }
  };

  const handleQuickPresetVias = () => {
    setBuffMode('SINGLE');
    setActorMode('VIAS');
    setSelectedAccountId('ALL_VIAS');
    message.success(`Đã chuyển sang Dàn ${fbAccounts.length} Via cá nhân!`);
  };

  return (
    <div className="space-y-5 max-w-[1440px] mx-auto px-2 sm:px-4 md:px-6 pb-28 md:pb-12">
      {/* THANH TRẠNG THÁI DÀN VIA */}
      <div className="app-surface p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-100 text-sm sm:text-base">Dàn Via & Fanpage</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 mt-1.5">
            <span className="inline-flex items-center gap-1.5">
              <UserOutlined />
              Via:
              <span className="font-semibold text-emerald-400">{bmOverview?.liveVias ?? fbAccounts.length} hoạt động</span>
              {bmOverview?.deadVias > 0 && (
                <span className="font-semibold text-rose-400">· {bmOverview.deadVias} lỗi</span>
              )}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ThunderboltFilled />
              Fanpage: <strong className="text-slate-200 font-semibold">{scannedPages.length}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircleOutlined />
              Đã chống trùng: <strong className="text-slate-200 font-semibold">{bmOverview?.antiOverlap?.totalProtectedInteractions || 0}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <BellOutlined />
              Telegram:
              <span className={bmOverview?.system?.telegramConfigured ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>
                {bmOverview?.system?.telegramConfigured ? 'Đã kết nối' : 'Chưa cấu hình'}
              </span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Button
            icon={<SettingOutlined />}
            onClick={() => {
              fetchSettings();
              setIsSettingsModalOpen(true);
            }}
          >
            Cài đặt
          </Button>
          <Button icon={<SafetyCertificateOutlined />} loading={checkingViaHealth} onClick={handleRunViaHealthCheck}>
            Kiểm tra Via
          </Button>
          {bmOverview?.system?.isEmergencyStopped ? (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleResumeSystem}>
              Khôi phục hoạt động
            </Button>
          ) : (
            <Button danger icon={<StopOutlined />} onClick={handleEmergencyStop}>
              Dừng khẩn cấp
            </Button>
          )}
        </div>
      </div>

      {/* BANNER CẢNH BÁO NẾU HỆ THỐNG ĐANG DỪNG KHẨN CẤP */}
      {bmOverview?.system?.isEmergencyStopped && (
        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-200 flex items-center justify-between text-xs gap-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            <StopOutlined className="text-rose-400 text-base shrink-0" />
            <div>
              <strong className="text-rose-200 text-xs font-semibold uppercase tracking-wider">Hệ thống đang dừng khẩn cấp (Emergency Stop)</strong>
              <div className="text-rose-300/80 text-[11px] mt-0.5">
                Toàn bộ hàng đợi tự động và tác vụ Playwright đang tạm dừng an toàn ({bmOverview?.system?.emergencyReason || 'Bởi Quản trị viên'}).
              </div>
            </div>
          </div>
          <Button
            size="small"
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleResumeSystem}
            className="bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold shrink-0 rounded-lg"
          >
            Khôi phục ngay
          </Button>
        </div>
      )}

      <Tabs
        activeKey={activeTabKey}
        onChange={(k) => setActiveTabKey(k)}
        tabBarExtraContent={<span className="text-xs text-slate-400">{fbAccounts.length} nick · {scannedPages.length} Page</span>}
        items={[
          {
            key: 'buff-like',
            label: 'Like & bình luận',
            children: (
              <div className="space-y-5">
                {/* TOP HERO COMMAND BAR: DÁN LINK & QUICK PRESETS */}
                <div className="app-surface p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm sm:text-base font-semibold text-white">
                            Bài viết cần tăng tương tác
                          </span>
                          {targetPostUrl && (
                            <span className="px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-blue-950/90 text-blue-300 border border-blue-700/60 shadow-sm">
                              {targetPostUrl.includes('/groups/')
                                ? 'Nhóm Facebook'
                                : targetPostUrl.includes('/reel')
                                ? 'Video Reels'
                                : 'Bài Viết'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Dán link bài viết Group (kín/công khai), Fanpage, Profile cá nhân hoặc Reels để hệ thống tự động nhận diện.
                        </p>
                      </div>
                    </div>

                    <Segmented
                      size="middle"
                      value={buffMode}
                      onChange={(val) => setBuffMode(val as 'SINGLE' | 'BATCH')}
                      options={[
                        { label: '1 link', value: 'SINGLE' },
                        { label: 'Nhiều link', value: 'BATCH' },
                      ]}
                      className="bg-slate-950/80 border border-slate-700/80 p-1 text-xs font-bold text-slate-200"
                    />
                  </div>

                  {/* Input link hoặc danh sách link */}
                  {buffMode === 'SINGLE' ? (
                    <div>
                      <PasteLinkInput
                        value={targetPostUrl}
                        onChange={(val) => setTargetPostUrl(val)}
                        placeholder="https://www.facebook.com/groups/.../posts/... hoặc https://www.facebook.com/share/p/..."
                      />

                      {/* Cảnh báo nếu đã từng like bài viết này */}
                      {alreadyLikedPagesForUrl.length > 0 && (
                        <div className="mt-3 p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-sm">
                          <span className="text-amber-300 font-semibold flex items-center gap-2">
                            <InfoCircleOutlined className="text-amber-400 text-sm" />
                            <span>Đã có <b>{alreadyLikedPagesForUrl.length} Page/Via</b> từng tương tác link này trước đó trong lịch sử</span>
                          </span>
                          <Button
                            size="small"
                            type="link"
                            onClick={() => {
                              const alreadyIds = alreadyLikedPagesForUrl.map((p) => p.pageId);
                              setSelectedPageIds((prev) => prev.filter((id) => !alreadyIds.includes(id)));
                              message.success(`Đã tự động bỏ chọn ${alreadyIds.length} tài khoản đã tương tác trước!`);
                            }}
                            className="text-xs p-0 h-auto text-amber-400 font-bold hover:underline shrink-0"
                          >
                            Bỏ chọn {alreadyLikedPagesForUrl.length} tài khoản này
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-200">
                          Danh sách link Facebook (Mỗi dòng một link):
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono px-2.5 py-0.5 rounded-md bg-blue-950/90 border border-blue-700/70 text-blue-300 font-bold">
                            {parsedBatchLinks.length} link hợp lệ
                          </span>
                          {batchLinksText && (
                            <Button
                              type="link"
                              size="small"
                              danger
                              onClick={() => setBatchLinksText('')}
                              className="text-xs p-0 h-auto font-semibold"
                            >
                              Xóa hết
                            </Button>
                          )}
                        </div>
                      </div>
                      <Input.TextArea
                        rows={4}
                        value={batchLinksText}
                        onChange={(e) => setBatchLinksText(e.target.value)}
                        placeholder={`https://www.facebook.com/groups/123456/posts/7891011/\nhttps://www.facebook.com/share/p/1CmWWe4m7g/\nhttps://www.facebook.com/share/p/19ivmH7zUw/`}
                        className="font-mono text-xs bg-slate-950 text-slate-100 border-slate-700 rounded-xl placeholder:text-slate-500 focus:border-blue-400"
                      />
                    </div>
                  )}

                  {/* 3 CẤU HÌNH NHANH (SMART PRESET TOOLBAR) */}
                  <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                      Cấu hình nhanh:
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={handleQuickPresetLike24}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium transition-colors cursor-pointer"
                      >
                        Like bằng tất cả Page ({scannedPages.length})
                      </button>
                      <button
                        type="button"
                        onClick={handleQuickPresetAiSeeding}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium transition-colors cursor-pointer"
                      >
                        Like + bình luận AI
                      </button>
                      <button
                        type="button"
                        onClick={handleQuickPresetVias}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium transition-colors cursor-pointer"
                      >
                        Dùng nick cá nhân ({fbAccounts.length})
                      </button>
                    </div>
                  </div>
                </div>

                {/* MAIN 2-COLUMN BENTO GRID */}
                <Row gutter={[20, 20]}>
                  {/* CỘT TRÁI (45%): FLEET MANAGER - DÀN TÀI KHOẢN & FANPAGE */}
                  <Col xs={24} lg={11}>
                    <div className="app-surface p-5 space-y-4">
                      {/* Card Header */}
                      <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
                        <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-100">
                          <IdcardOutlined className="text-blue-400 text-base" />
                          <span>Tài khoản & Page</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="text"
                            size="small"
                            icon={<ReloadOutlined spin={scanPagesMutation.isPending || loadingAccounts} />}
                            loading={scanPagesMutation.isPending || loadingAccounts}
                            onClick={async () => {
                              await queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
                              await refetchAccounts();
                              message.success(`Đã cập nhật: ${fbAccounts.length} Via sẵn sàng!`);
                              handleScanPages();
                            }}
                            className="text-slate-300 hover:text-blue-400 text-xs px-2.5 h-7 rounded-lg border border-slate-700 hover:border-blue-500 bg-slate-800/80 font-semibold cursor-pointer"
                            title="Làm mới dàn Via & Quét thêm Fanpage từ Facebook"
                          >
                            Quét lại
                          </Button>
                          <Button
                            type="primary"
                            size="small"
                            icon={<SettingOutlined />}
                            onClick={() => handleOpenManagePages(selectedAccountId)}
                            className="bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-xs h-7 px-2.5 shadow-sm border-none cursor-pointer"
                          >
                            Quản lý Page ({scannedPages.length})
                          </Button>
                        </div>
                      </div>

                      {/* Dropdown chọn nick mẹ */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-semibold text-slate-300">
                            Tài khoản Facebook sở hữu Page:
                          </label>
                          {currentViaAccount && (
                            <span className="text-[11px] text-blue-400 font-mono">
                              c_user: {extractCUser(currentViaAccount.cookieString || currentViaAccount.accessToken) || 'N/A'}
                            </span>
                          )}
                          {selectedAccountId === 'ALL_VIAS' && (
                            <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              {actorMode === 'VIAS'
                                ? `Gộp ${fbAccounts.length} Nick Via (${selectedPageIds.length}/${scannedPages.length})`
                                : `Gộp ${fbAccounts.length} Via (${scannedPages.length} Fanpage)`}
                            </span>
                          )}
                        </div>
                        <Select
                          className="w-full"
                          size="large"
                          loading={loadingAccounts}
                          value={selectedAccountId}
                          onChange={(val) => {
                            setSelectedAccountId(val);
                            if (val === 'CUSTOM') {
                              setScannedPages([]);
                              setSelectedPageIds([]);
                            }
                          }}
                          options={[
                            ...(fbAccounts.length > 1
                              ? [
                                  {
                                    value: 'ALL_VIAS',
                                    label: `Tất cả nick (${fbAccounts.length}): ${
                                      fbAccounts
                                        .slice(0, 4)
                                        .map((a) => a.pageName || `Via ${String(a.platformAccountId || a.id).slice(-4)}`)
                                        .join(' + ') +
                                      (fbAccounts.length > 4 ? ` + ${fbAccounts.length - 4} nick khác` : '')
                                    }`,
                                  },
                                ]
                              : []),
                            { value: 'CUSTOM', label: 'Nhập cookie thủ công' },
                            ...fbAccounts.map((a) => ({
                              value: a.id,
                              label: `${a.pageName || `Via ${String(a.platformAccountId || a.id).slice(-4)}`} (${
                                a.tokenStatus === 'OK' ? 'Cookie sống' : 'Cần kiểm tra'
                              })`,
                            })),
                          ]}
                        />
                      </div>

                      {/* Cookie thủ công nếu chọn CUSTOM */}
                      {selectedAccountId === 'CUSTOM' && (
                        <div className="space-y-3 p-3.5 rounded-xl border border-slate-800 bg-slate-950/70">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-slate-200">
                              Nhập Cookie nick Facebook mẹ:
                            </label>
                            <span className="text-[11px] text-slate-400">
                              (Chứa <b>c_user</b> & <b>xs</b>)
                            </span>
                          </div>

                          <Row gutter={10}>
                            <Col span={10}>
                              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                                c_user:
                              </label>
                              <Input
                                placeholder="10008321..."
                                value={
                                  customCookie.match(/(?:^|;\s*)c_user=([^;]+)/)?.[1] ||
                                  (customCookie.includes('=') ? '' : customCookie)
                                }
                                onChange={(e) => {
                                  const cUser = e.target.value.trim();
                                  const currentXs = customCookie.match(/(?:^|;\s*)xs=([^;]+)/)?.[1] || '';
                                  setCustomCookie(
                                    cUser && currentXs
                                      ? `c_user=${cUser}; xs=${currentXs}`
                                      : cUser
                                      ? `c_user=${cUser}`
                                      : ''
                                  );
                                }}
                                className="font-mono text-xs rounded-xl bg-slate-900 border-slate-700 text-slate-100"
                              />
                            </Col>
                            <Col span={14}>
                              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                                xs:
                              </label>
                              <Input.Password
                                placeholder="27%3ABc0..."
                                value={customCookie.match(/(?:^|;\s*)xs=([^;]+)/)?.[1] || ''}
                                onChange={(e) => {
                                  const xs = e.target.value.trim();
                                  const currentCUser = customCookie.match(/(?:^|;\s*)c_user=([^;]+)/)?.[1] || '';
                                  setCustomCookie(
                                    currentCUser && xs
                                      ? `c_user=${currentCUser}; xs=${xs}`
                                      : xs
                                      ? `xs=${xs}`
                                      : ''
                                  );
                                }}
                                className="font-mono text-xs rounded-xl bg-slate-900 border-slate-700 text-slate-100"
                              />
                            </Col>
                          </Row>

                          <Input.TextArea
                            rows={2}
                            placeholder="Dán toàn bộ cookie dài vào đây..."
                            value={customCookie}
                            onChange={(e) => setCustomCookie(e.target.value)}
                            className="font-mono text-[11px] rounded-xl bg-slate-900 border-slate-700 text-slate-100"
                          />
                        </div>
                      )}

                      {/* CHỌN: DÀN FANPAGE VỆ TINH HAY DÀN VIA CÁ NHÂN */}
                      <div className="p-1 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setActorMode('FANPAGES')}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            actorMode === 'FANPAGES'
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-400 hover:text-white hover:bg-slate-900'
                          }`}
                        >
                          <span>Page</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-950 border border-blue-700 text-blue-300">
                            {scannedPages.length}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActorMode('VIAS')}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            actorMode === 'VIAS'
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-400 hover:text-white hover:bg-slate-900'
                          }`}
                        >
                          <span>Nick cá nhân</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-300">
                            {fbAccounts.length}
                          </span>
                        </button>
                      </div>

                      {/* Danh sách Fanpage / Via với Interactive Grid Cards */}
                      {scannedPages.length > 0 ? (
                        <div className="space-y-2.5 pt-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-200">
                              {actorMode === 'VIAS' ? 'Chọn Nick Via tương tác:' : 'Chọn Fanpage tương tác:'}{' '}
                              <span className="text-blue-400 font-mono font-bold">
                                ({selectedPageIds.length}/{scannedPages.length})
                              </span>
                            </span>
                            <Checkbox
                              checked={selectedPageIds.length === scannedPages.length && scannedPages.length > 0}
                              indeterminate={
                                selectedPageIds.length > 0 && selectedPageIds.length < scannedPages.length
                              }
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedPageIds(scannedPages.map((p) => p.id));
                                } else {
                                  setSelectedPageIds([]);
                                }
                              }}
                            >
                              <span className="text-xs text-slate-300 font-semibold">Chọn tất cả</span>
                            </Checkbox>
                          </div>

                          {/* Ô tìm kiếm Page/Via */}
                          {scannedPages.length > 6 && (
                            <Input
                              prefix={<SearchOutlined className="text-slate-400" />}
                              placeholder={actorMode === 'VIAS' ? 'Tìm Via theo tên hoặc UID...' : 'Tìm Fanpage theo tên hoặc ID...'}
                              size="middle"
                              value={pageSearchQuery}
                              onChange={(e) => setPageSearchQuery(e.target.value)}
                              className="text-xs rounded-xl bg-slate-950/70 border-slate-700 text-slate-100"
                            />
                          )}

                          {/* Grid các Via/Fanpage card */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[360px] overflow-y-auto pr-1">
                            {filteredPages.map((page) => {
                              const isChecked = selectedPageIds.includes(page.id);
                              return (
                                <div
                                  key={page.id}
                                  onClick={() => {
                                    if (isChecked) {
                                      setSelectedPageIds(selectedPageIds.filter((id) => id !== page.id));
                                    } else {
                                      setSelectedPageIds([...selectedPageIds, page.id]);
                                    }
                                  }}
                                  className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-all ${
                                    isChecked
                                      ? 'border-blue-500/80 bg-blue-950/40 text-white /50'
                                      : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700 hover:bg-slate-900/60'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div
                                      className={`w-7 h-7 shrink-0 rounded-lg text-white font-semibold text-[10px] flex items-center justify-center ${
                                        actorMode === 'VIAS'
                                          ? 'bg-emerald-600'
                                          : getAvatarGradient(page.name)
                                      } shadow-sm`}
                                    >
                                      {getInitials(page.name)}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="font-bold text-xs truncate max-w-[125px] sm:max-w-[135px]" title={page.name}>
                                        {page.name}
                                      </div>
                                      <div className="flex items-center gap-1 text-[10px] font-mono text-slate-400 truncate">
                                        <span>ID: {page.id}</span>
                                        {actorMode === 'VIAS' ? (
                                          <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 font-sans font-medium">
                                            Via
                                          </span>
                                        ) : (
                                          page.viaName && selectedAccountId === 'ALL_VIAS' && (
                                            <span className="text-[9px] px-1 py-0.2 rounded bg-blue-950/80 text-blue-300 border border-blue-800/80 font-sans font-medium">
                                              {page.viaName}
                                            </span>
                                          )
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <Checkbox
                                    checked={isChecked}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      if (e.target.checked) {
                                        setSelectedPageIds([...selectedPageIds, page.id]);
                                      } else {
                                        setSelectedPageIds(selectedPageIds.filter((id) => id !== page.id));
                                      }
                                    }}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="p-5 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-400 space-y-2">
                          <p>Chưa có Fanpage nào được tải cho tài khoản này.</p>
                          <button
                            type="button"
                            onClick={() => handleOpenManagePages(selectedAccountId)}
                            className="text-blue-400 hover:underline font-bold cursor-pointer"
                          >
                            Bấm vào đây để nhập danh sách i_user
                          </button>
                        </div>
                      )}
                    </div>
                  </Col>

                  {/* CỘT PHẢI (55%): CONTROL DECK & LIVE MONITOR TERMINAL */}
                  <Col xs={24} lg={13}>
                    <div className="space-y-4">
                      {/* HERO ACTION CARD - LUÔN Ở ĐỈNH TẦM MẮT */}
                      <div className="app-surface p-5 space-y-3.5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-300">
                              Đã chọn <b className="text-slate-100">{selectedPageIds.length}</b> {actorMode === 'VIAS' ? 'nick cá nhân' : 'Page'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400">
                            <span>Hình thức: <b className="text-blue-300">{engagementMode === 'LIKE_ONLY' ? 'Chỉ like' : engagementMode === 'COMMENT_ONLY' ? 'Chỉ bình luận' : 'Like + bình luận'}</b></span>
                            <span>•</span>
                            <span>Cảm xúc: <b className="text-amber-300">{selectedReaction}</b></span>
                          </div>
                        </div>

                        {/* NÚT BẮT ĐẦU BUFF NGAY (HERO CTA) */}
                        {buffMode === 'SINGLE' && autoBuffMutation.isPending ? (
                          <Button
                            danger
                            type="primary"
                            size="large"
                            icon={<StopOutlined />}
                            onClick={handleStopAutoBuff}
                            className="w-full h-11 rounded-lg text-sm font-semibold"
                          >
                            Dừng ({autoBuffProgress.percent}%)
                          </Button>
                        ) : buffMode === 'SINGLE' ? (
                          <Button
                            type="primary"
                            size="large"
                            icon={<RobotOutlined spin={autoBuffMutation.isPending} />}
                            loading={autoBuffMutation.isPending}
                            disabled={selectedPageIds.length === 0 || !targetPostUrl}
                            onClick={handleStartAutoBuff}
                            className="w-full h-11 rounded-lg text-sm font-semibold"
                          >
                            {autoBuffMutation.isPending
                              ? 'Đang chạy...'
                              : actorMode === 'VIAS'
                              ? `Bắt đầu với ${selectedPageIds.length} nick cá nhân`
                              : `Bắt đầu với ${selectedPageIds.length} Page`}
                          </Button>
                        ) : (
                          <div>
                            {!isBatchRunning ? (
                              <Button
                                type="primary"
                                size="large"
                                icon={<ThunderboltOutlined />}
                                disabled={parsedBatchLinks.length === 0 || selectedPageIds.length === 0}
                                onClick={handleStartBatchBuff}
                                className="w-full h-11 rounded-lg text-sm font-semibold"
                              >
                                {parsedBatchLinks.length === 0
                                  ? 'Chưa có link'
                                  : `Chạy ${parsedBatchLinks.length} bài (${selectedPageIds.length} tài khoản mỗi bài)`}
                              </Button>
                            ) : (
                              <div className="grid grid-cols-2 gap-2">
                                <Button
                                  size="large"
                                  icon={isBatchPaused ? <CaretRightOutlined /> : <PauseCircleOutlined />}
                                  onClick={handlePauseBatchBuff}
                                  className={`font-bold h-12 rounded-xl text-xs sm:text-sm ${
                                    isBatchPaused
                                      ? 'bg-emerald-600 text-white hover:bg-emerald-500 border-none'
                                      : 'bg-amber-600 text-white hover:bg-amber-500 border-none'
                                  }`}
                                >
                                  {isBatchPaused ? 'Tiếp tục' : 'Tạm dừng'}
                                </Button>
                                <Button
                                  size="large"
                                  danger
                                  type="primary"
                                  icon={<StopOutlined />}
                                  onClick={handleStopBatchBuff}
                                  className="font-bold h-12 rounded-xl text-xs sm:text-sm"
                                >
                                  Dừng hẳn
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* BẢNG CẤU HÌNH TINH CHỈNH TƯƠNG TÁC */}
                      <div className="p-4 sm:p-5 app-surface space-y-4">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                          <span className="text-xs sm:text-sm font-bold text-slate-100 flex items-center gap-2">
                            <SettingOutlined className="text-blue-400" /> Cài đặt tương tác
                          </span>
                          
                        </div>

                        {/* 1. Hình thức tương tác: Combo / Like / Comment */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                            Hình thức tương tác:
                          </label>
                          <div className="grid grid-cols-3 gap-2">
                            <button
                              type="button"
                              onClick={() => setEngagementMode('LIKE_ONLY')}
                              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                                engagementMode === 'LIKE_ONLY'
                                  ? 'border-blue-500 bg-blue-600/30 text-white font-bold'
                                  : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                              }`}
                            >
                              <span className="text-xs font-bold">Chỉ like</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setEngagementMode('LIKE_AND_COMMENT')}
                              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                                engagementMode === 'LIKE_AND_COMMENT'
                                  ? 'border-blue-500 bg-blue-600/30 text-white font-bold'
                                  : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                              }`}
                            >
                              <span className="text-xs font-bold">Like + bình luận</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setEngagementMode('COMMENT_ONLY')}
                              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                                engagementMode === 'COMMENT_ONLY'
                                  ? 'border-blue-500 bg-blue-600/30 text-white font-bold'
                                  : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                              }`}
                            >
                              <span className="text-xs font-bold">Chỉ bình luận</span>
                            </button>
                          </div>
                        </div>

                        {/* 2. Reaction Picker (Floating Dock Style) */}
                        {engagementMode !== 'COMMENT_ONLY' && (
                          <div>
                            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                              Chọn cảm xúc (Reaction):
                            </label>
                            <div className="flex items-center justify-between gap-1 p-1.5 rounded-xl bg-slate-950/80 border border-slate-800">
                              {REACTIONS.map((r) => {
                                const isSelected = selectedReaction === r.key;
                                return (
                                  <button
                                    key={r.key}
                                    type="button"
                                    onClick={() => setSelectedReaction(r.key)}
                                    className={`flex-1 py-1.5 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
                                      isSelected
                                        ? 'bg-blue-600/40 text-white font-semibold '
                                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                                    }`}
                                    title={r.label}
                                  >
                                    <span className="text-xl sm:text-2xl leading-none">{r.emoji}</span>
                                    <span className="text-[10px] font-semibold">{r.label.split(' ')[0]}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* 3. Tùy chọn Mô phỏng người dùng, Tốc độ & Chống Checkpoint */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-emerald-900/60 text-xs shadow-sm">
                            <div className="flex items-center gap-2">
                              <div>
                                <span className="text-slate-200 font-bold block">Mô phỏng người dùng</span>
                                <span className="text-[10px] text-slate-400">Lướt xem bài tự nhiên</span>
                              </div>
                            </div>
                            <Checkbox
                              checked={enableHumanBehavior}
                              onChange={(e) => setEnableHumanBehavior(e.target.checked)}
                              className="text-emerald-400 font-bold"
                            >
                              Bật
                            </Checkbox>
                          </div>

                          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs shadow-sm">
                            <div>
                              <span className="text-slate-200 font-bold block">Giãn cách:</span>
                              <span className="text-[10px] text-slate-400">Nghỉ giữa 2 nick</span>
                            </div>
                            <Select
                              size="small"
                              value={delayMs}
                              onChange={(val) => setDelayMs(val)}
                              className="w-32"
                              options={
                                engagementMode !== 'LIKE_ONLY'
                                  ? [
                                      { value: 12000, label: '12-18s (Chuẩn)' },
                                      { value: 20000, label: '20-28s (Siêu an toàn)' },
                                      { value: 8000, label: '8-12s (Nhanh)' },
                                    ]
                                  : [
                                      { value: 3800, label: '3.8-6s (Chuẩn an toàn)' },
                                      { value: 5000, label: '5.0-8s (Siêu an toàn)' },
                                      { value: 2500, label: '2.5s (Nhanh)' },
                                    ]
                              }
                            />
                          </div>

                          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-blue-900/60 text-xs shadow-sm">
                            <div>
                              <span className="text-blue-300 font-bold block flex items-center gap-1">
                                <span>Chế độ Siêu Tốc</span>
                              </span>
                              <span className="text-[10px] text-slate-400">Đổi Page ngay trên bài (tiết kiệm 15s)</span>
                            </div>
                            <Checkbox
                              checked={fastSwitch}
                              onChange={(e) => setFastSwitch(e.target.checked)}
                              className="text-blue-400 font-bold"
                            >
                              Bật
                            </Checkbox>
                          </div>

                          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-amber-900/60 text-xs shadow-sm">
                            <div>
                              <span className="text-amber-300 font-bold block flex items-center gap-1">
                                <span>Bảo vệ BM & Via</span>
                              </span>
                              <span className="text-[10px] text-slate-400">Batch Cooldown & dừng khi bị chặn</span>
                            </div>
                            <Checkbox
                              checked={antiCheckpointGuard}
                              onChange={(e) => setAntiCheckpointGuard(e.target.checked)}
                              className="text-amber-400 font-bold"
                            >
                              Bật
                            </Checkbox>
                          </div>
                        </div>

                        {/* Checkbox Tránh like trùng */}
                        <div className="flex items-center justify-between p-2.5 rounded-xl border border-slate-800/80 bg-slate-950/60 text-xs">
                          <Checkbox
                            checked={autoSkipAlreadyLiked}
                            onChange={(e) => setAutoSkipAlreadyLiked(e.target.checked)}
                            className="text-slate-200 font-medium"
                          >
                            Tự động bỏ qua nick/page đã like bài viết này trước đó
                          </Checkbox>
                          <span className="text-amber-400 font-semibold text-[11px] hidden sm:inline">
                            Chống trùng lặp
                          </span>
                        </div>

                        {/* 4. Khối Bình Luận Seeding Studio (Nếu bật Comment) */}
                        {engagementMode !== 'LIKE_ONLY' && (
                          <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-950/80 border border-blue-900/50">
                            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                              <span className="text-xs font-bold text-blue-300 flex items-center gap-1.5">
                                <CommentOutlined /> Nội dung bình luận ({commentListText.split('\n').filter((s) => s.trim()).length} dòng)
                              </span>
                              <div className="flex items-center gap-1.5">
                                <Button
                                  size="small"
                                  type="primary"
                                  icon={<RobotOutlined spin={isAiGeneratingComments} />}
                                  loading={isAiGeneratingComments}
                                  onClick={handleGenerateAiComments}
                                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs h-7 px-2.5 rounded-lg border-none cursor-pointer"
                                >
                                  Tạo bình luận bằng AI
                                </Button>
                                <Button
                                  size="small"
                                  onClick={() => setAiStudioModalOpen(true)}
                                  className="text-xs h-7 px-2 rounded-lg bg-slate-800 border-slate-700 text-slate-200 cursor-pointer"
                                >
                                  Mẫu Seeding
                                </Button>
                                <Button
                                  size="small"
                                  onClick={() => {
                                    const lines = commentListText.split('\n').filter((s) => s.trim());
                                    const shuffled = [...lines].sort(() => Math.random() - 0.5);
                                    setCommentListText(shuffled.join('\n'));
                                    message.info('Đã đảo ngẫu nhiên thứ tự bình luận!');
                                  }}
                                  className="text-xs h-7 px-2 rounded-lg bg-slate-800 border-slate-700 text-slate-200 cursor-pointer"
                                >
                                  Đảo
                                </Button>
                              </div>
                            </div>

                            {/* Cảnh báo từ khóa spam */}
                            {detectedSpamKeywords.length > 0 && (
                              <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-500/40 text-[11px] text-rose-300">
                                <b>Từ khóa nhạy cảm "{detectedSpamKeywords.join(', ')}":</b> Bot nhóm có thể tự động chặn. Bấm <b>"Mẫu Seeding"</b> để dùng câu tự nhiên!
                              </div>
                            )}

                            <Input.TextArea
                              rows={5}
                              value={commentListText}
                              onChange={(e) => setCommentListText(e.target.value)}
                              placeholder={`Nhập hoặc dán các câu bình luận (mỗi câu 1 dòng):\nBài viết hay và rất ý nghĩa ạ! \nThông tin rất bổ ích, cảm ơn bạn đã chia sẻ \n...`}
                              className="font-sans text-xs bg-slate-900 text-slate-100 border-slate-700 rounded-xl placeholder:text-slate-500 focus:border-blue-400"
                            />
                          </div>
                        )}
                      </div>

                      {/* LIVE MONITOR TERMINAL / GIÁM SÁT TIẾN TRÌNH TRỰC TIẾP */}
                      <div className="p-4 sm:p-5 app-surface space-y-3.5">
                        <div className="flex items-center justify-between pb-2.5 border-b border-slate-800/80">
                          <span className="text-xs sm:text-sm font-bold text-slate-100 flex items-center gap-2">
                            <RobotOutlined className="text-blue-400" /> Tiến trình
                          </span>
                          {autoBuffProgress.status === 'RUNNING' || isBatchRunning ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-bold">
                              <span className="w-2 h-2 rounded-full bg-blue-400"></span> Đang chạy...
                            </span>
                          ) : autoBuffProgress.status === 'DONE' ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
                              <CheckCircleFilled /> Hoàn tất
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-800/60 border border-slate-700/60 text-slate-400 text-xs font-medium">
                              Sẵn sàng
                            </span>
                          )}
                        </div>

                        {/* Trạng thái IDLE vs RUNNING/DONE */}
                        {autoBuffProgress.status === 'IDLE' && !isBatchRunning && batchOrders.length === 0 ? (
                          <div className="p-6 rounded-xl border border-dashed border-slate-800 text-center text-slate-400 space-y-2.5 bg-slate-950/40">
                            <div className="w-12 h-12 mx-auto rounded-xl bg-blue-950/60 border border-blue-700/50 flex items-center justify-center text-2xl text-blue-400">
                                                          </div>
                            <div>
                              <div className="text-sm font-bold text-slate-200">Sẵn sàng thực thi tương tác</div>
                              <div className="text-xs text-slate-400 max-w-sm mx-auto mt-1 leading-relaxed">
                                Dán link bài viết và bấm nút <b>Bắt đầu</b> ở trên. Bảng theo dõi sẽ hiển thị từng Page/Via thả cảm xúc theo thời gian thực.
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3.5">
                            {/* 4 Metric Badges */}
                            <Row gutter={[8, 8]}>
                              <Col span={6}>
                                <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-center">
                                  <div className="text-[10px] font-bold text-slate-400 uppercase">Tổng số</div>
                                  <div className="text-base sm:text-lg font-semibold text-slate-100 mt-0.5">
                                    {autoBuffProgress.total || batchOrders.length}
                                  </div>
                                </div>
                              </Col>
                              <Col span={6}>
                                <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-center">
                                  <div className="text-[10px] font-bold text-emerald-400 uppercase">Thành công</div>
                                  <div className="text-base sm:text-lg font-semibold text-emerald-300 mt-0.5">
                                    {autoBuffProgress.success || batchOrders.filter((o) => o.status === 'COMPLETED').length}
                                  </div>
                                </div>
                              </Col>
                              <Col span={6}>
                                <div className="p-2.5 rounded-xl bg-blue-950/40 border border-blue-800/50 text-center">
                                  <div className="text-[10px] font-bold text-blue-400 uppercase">Đã like</div>
                                  <div className="text-base sm:text-lg font-semibold text-blue-300 mt-0.5">
                                    {autoBuffProgress.alreadyLiked}
                                  </div>
                                </div>
                              </Col>
                              <Col span={6}>
                                <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-center">
                                  <div className="text-[10px] font-bold text-rose-400 uppercase">Lỗi</div>
                                  <div className="text-base sm:text-lg font-semibold text-rose-300 mt-0.5">
                                    {autoBuffProgress.failed || batchOrders.filter((o) => o.status === 'FAILED').length}
                                  </div>
                                </div>
                              </Col>
                            </Row>

                            {/* Glowing Progress Banner when running */}
                            {autoBuffProgress.status === 'RUNNING' && (
                              <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-500/50 space-y-2">
                                <div className="flex items-center justify-between text-xs text-blue-200">
                                  <span className="flex items-center gap-1.5 font-bold">
                                    <LoadingOutlined spin className="text-blue-400" />
                                    <span>Đang xử lý: <b className="text-white">{autoBuffProgress.currentRunningPageName || 'Đang mở Facebook...'}</b></span>
                                  </span>
                                  <span className="font-mono font-bold text-blue-300">{autoBuffProgress.percent}%</span>
                                </div>
                                <Progress
                                  percent={autoBuffProgress.percent}
                                  size={['100%', 6]}
                                  showInfo={false}
                                />
                              </div>
                            )}

                            {/* Nút mở Facebook kiểm tra kết quả khi hoàn thành */}
                            {targetPostUrl && autoBuffProgress.status === 'DONE' && (
                              <Button
                                type="dashed"
                                icon={<ExportOutlined />}
                                onClick={() => window.open(targetPostUrl, '_blank')}
                                className="w-full text-blue-400 border-blue-500/50 hover:text-blue-300 hover:border-blue-400 h-9 font-bold rounded-xl cursor-pointer"
                              >
                                Mở bài viết trên Facebook để kiểm tra kết quả ngay
                              </Button>
                            )}

                            {buffMode === 'BATCH' && batchOrders.length > 0 && (
                              <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
                                {batchOrders.map((order) => (
                                  <div key={order.id} className="p-2 rounded-lg border border-slate-800 bg-slate-950/40 space-y-1">
                                    <div className="flex items-center justify-between gap-2 text-xs">
                                      <span className="text-slate-300 truncate min-w-0">
                                        #{order.orderNumber} {order.url}
                                      </span>
                                      <Tag
                                        className="text-[10px] m-0 shrink-0"
                                        color={
                                          order.status === 'COMPLETED'
                                            ? 'success'
                                            : order.status === 'RUNNING'
                                            ? 'processing'
                                            : order.status === 'FAILED'
                                            ? 'error'
                                            : 'default'
                                        }
                                      >
                                        {order.status === 'COMPLETED'
                                          ? `Xong ${order.successLikes}/${order.totalLikesTarget}`
                                          : order.status === 'RUNNING'
                                          ? `${order.successLikes}/${order.totalLikesTarget} · ${order.percent || 0}%`
                                          : order.status === 'FAILED'
                                          ? 'Lỗi'
                                          : order.status === 'PAUSED'
                                          ? 'Đã dừng'
                                          : 'Chờ'}
                                      </Tag>
                                    </div>
                                    {order.status === 'RUNNING' && order.currentRunningPageName && (
                                      <div className="text-[11px] text-slate-400 truncate">Đang chạy: {order.currentRunningPageName}</div>
                                    )}
                                    {order.status === 'FAILED' && order.error && (
                                      <div className="text-[11px] text-rose-300 truncate">{order.error}</div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Danh sách Stream Live Results */}
                            <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
                              {(buffMode === 'BATCH' && batchOrders.length > 0 ? [] : autoBuffProgress.details).map((detail, index) => {
                                const reactionObj = REACTIONS.find((r) => r.key === selectedReaction) || REACTIONS[0];
                                const isRunning = detail.status === 'RUNNING';
                                const isSuccess = detail.status === 'SUCCESS';
                                const isAlreadyLiked = detail.status === 'ALREADY_LIKED';
                                const isWaiting = detail.status === 'WAITING';

                                return (
                                  <div
                                    key={detail.pageId + index}
                                    className={`p-2 rounded-xl border flex items-center justify-between gap-2 transition-all ${
                                      isRunning
                                        ? 'border-blue-500 bg-blue-950/50 /50'
                                        : isSuccess
                                        ? 'border-emerald-800/40 bg-emerald-950/20'
                                        : isAlreadyLiked
                                        ? 'border-blue-800/40 bg-blue-950/20'
                                        : isWaiting || detail.status === 'SKIPPED'
                                        ? 'border-slate-800 bg-slate-950/30 opacity-70'
                                        : detail.status === 'UNVERIFIED'
                                        ? 'border-amber-800/40 bg-amber-950/20'
                                        : 'border-rose-800/40 bg-rose-950/20'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      <div
                                        className={`w-6 h-6 shrink-0 rounded-lg text-white font-semibold text-[9px] flex items-center justify-center ${getAvatarGradient(
                                          detail.pageName
                                        )} shadow-sm`}
                                      >
                                        {getInitials(detail.pageName)}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-bold text-xs text-slate-100 truncate">
                                            {detail.pageName}
                                          </span>
                                          {engagementMode !== 'COMMENT_ONLY' && (
                                            <span className="text-xs">{reactionObj.emoji}</span>
                                          )}
                                        </div>
                                        {detail.commentText && (
                                          <div className="text-[10px] text-blue-300 italic truncate max-w-[240px]">
                                            "{detail.commentText}"
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    <div className="shrink-0">
                                      {isWaiting && (
                                        <span className="text-[10px] text-slate-400 font-medium">Chờ lượt</span>
                                      )}
                                      {isRunning && (
                                        <Tag color="processing" icon={<LoadingOutlined spin />} className="font-bold text-[10px] m-0">
                                          Đang like...
                                        </Tag>
                                      )}
                                      {isSuccess && (
                                        <Tag color="success" icon={<CheckCircleFilled />} className="text-[10px] m-0">
                                          {detail.message || 'Thành công'}
                                        </Tag>
                                      )}
                                      {isAlreadyLiked && (
                                        <Tag color="blue" icon={<CheckOutlined />} className="text-[10px] m-0">
                                          Đã like trước
                                        </Tag>
                                      )}
                                      {detail.status === 'UNVERIFIED' && (
                                        <Tag color="warning" className="text-[10px] m-0">Chưa xác nhận</Tag>
                                      )}
                                      {detail.status === 'NO_BUTTON' && (
                                        <Tag color="error" className="text-[10px] m-0">Không thấy nút Like</Tag>
                                      )}
                                      {detail.status === 'SKIPPED' && (
                                        <Tag className="text-[10px] m-0">{detail.message || 'Bỏ qua'}</Tag>
                                      )}
                                      {detail.status === 'ERROR' && (
                                        <Tag color="error" className="text-[10px] m-0">{detail.error || 'Lỗi'}</Tag>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </Col>
                </Row>
              </div>
            ),
          },
          {
            key: 'buff-view',
            label: 'Tăng view video',
            children: (
              <Row gutter={[20, 20]}>
                <Col xs={24} lg={12}>
                  <Card
                    title={
                      <div className="flex items-center gap-2 text-sm font-bold text-slate-100">
                        <EyeOutlined className="text-emerald-400" /> Cấu hình tăng view
                      </div>
                    }
                    className="app-surface"
                  >
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                          Link Video / Reels Facebook cần buff View:
                        </label>
                        <PasteLinkInput
                          value={targetViewUrl}
                          onChange={(val) => setTargetViewUrl(val)}
                          placeholder="https://www.facebook.com/reel/123456789"
                        />
                      </div>

                      <Row gutter={16}>
                        <Col span={12}>
                          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                            Số lượng View cần buff:
                          </label>
                          <Select
                            className="w-full"
                            value={targetViews}
                            onChange={(v) => setTargetViews(v)}
                            options={[
                              { value: 10, label: '10 Lượt xem' },
                              { value: 20, label: '20 Lượt xem' },
                              { value: 50, label: '50 Lượt xem' },
                              { value: 100, label: '100 Lượt xem' },
                              { value: 200, label: '200 Lượt xem' },
                            ]}
                          />
                        </Col>
                        <Col span={12}>
                          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                            Số luồng chạy song song:
                          </label>
                          <Select
                            className="w-full"
                            value={concurrency}
                            onChange={(v) => setConcurrency(v)}
                            options={[
                              { value: 1, label: '1 Luồng (Máy yếu)' },
                              { value: 2, label: '2 Luồng (Khuyên dùng)' },
                              { value: 3, label: '3 Luồng (Nhanh)' },
                              { value: 5, label: '5 Luồng (Máy mạnh)' },
                            ]}
                          />
                        </Col>
                      </Row>

                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                          Thời gian xem mỗi lượt (giây):
                        </label>
                        <Select
                          className="w-full"
                          value={watchTimeSeconds}
                          onChange={(v) => setWatchTimeSeconds(v)}
                          options={[
                            { value: 5, label: '5 giây (Nhanh nhất)' },
                            { value: 8, label: '8 giây (Chuẩn Facebook)' },
                            { value: 12, label: '12 giây (Tốt cho giữ chân)' },
                            { value: 20, label: '20 giây (Xem lâu)' },
                          ]}
                        />
                      </div>

                      <Button
                        type="primary"
                        size="large"
                        icon={<EyeOutlined spin={buffViewMutation.isPending} />}
                        loading={buffViewMutation.isPending}
                        onClick={() => {
                          if (!targetViewUrl) {
                            message.warning('Vui lòng nhập Link Video / Reels!');
                            return;
                          }
                          buffViewMutation.mutate();
                        }}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 font-bold h-12 rounded-xl text-xs sm:text-sm"
                      >
                        Bắt đầu tăng view
                      </Button>
                    </div>
                  </Card>
                </Col>

                <Col xs={24} lg={12}>
                  <Card
                    title={
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-slate-100 flex items-center gap-2">
                          <EyeOutlined className="text-emerald-400" /> Tiến trình tăng view
                        </span>
                        {viewProgress.status !== 'IDLE' && (
                          <Tag color={viewProgress.status === 'RUNNING' ? 'processing' : 'success'}>
                            {viewProgress.status === 'RUNNING' ? 'Đang xem...' : 'Hoàn thành'}
                          </Tag>
                        )}
                      </div>
                    }
                    className="app-surface h-full"
                  >
                    {viewProgress.status === 'IDLE' ? (
                      <div className="text-center py-20 text-slate-400">
                        <div className="text-5xl mb-3"></div>
                        <div className="text-sm font-semibold">Chưa có tiến trình buff view nào.</div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <Progress
                          percent={Math.round((viewProgress.done / viewProgress.total) * 100)}
                          status={viewProgress.status === 'DONE' ? 'success' : 'active'}
                        />
                        <div className="text-center font-bold text-lg text-slate-100">
                          {viewProgress.done} / {viewProgress.total} Views đã hoàn tất
                        </div>
                      </div>
                    )}
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'post-hunter',
            label: (
              <span className="flex items-center gap-1.5">
                <RobotOutlined className="text-blue-400" />
                <span>Tự săn bài mới</span>
                {monitors.filter((m) => m.status === 'ACTIVE').length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-md text-[10px] bg-blue-500/20 text-blue-300 font-mono font-bold border border-blue-500/40">
                    {monitors.filter((m) => m.status === 'ACTIVE').length}
                  </span>
                )}
              </span>
            ),
            children: (
              <PostHunterTab
                workerBaseUrl={WORKER_BASE_URL}
                monitors={monitors}
                queueItems={queueItems}
                autoBuffOwnPosts={Boolean(systemSettings.autoBuffOwnPosts)}
                maxPagesPerPost={systemSettings.maxPagesPerPost || 150}
                onRefresh={() => {
                  fetchBuffMonitors();
                  fetchBuffQueue();
                }}
                onAdd={(prefillUrl) => handleOpenAddMonitorModal(undefined, prefillUrl)}
                onEdit={(mon) => handleOpenAddMonitorModal(mon as BuffMonitor)}
                onToggle={handleToggleMonitor}
                onDelete={handleDeleteMonitor}
                onScanNow={handleScanNowMonitor}
                onQueueUrl={(url) => {
                  setQueueUrlInput(url);
                  setActiveTabKey('buff-queue');
                }}
                onOpenQueue={() => setActiveTabKey('buff-queue')}
                onOpenSettings={() => {
                  fetchSettings();
                  setIsSettingsModalOpen(true);
                }}
              />
            ),
          },
          {
            key: 'buff-queue',
            label: (
              <span className="flex items-center gap-1.5">
                <ThunderboltOutlined className="text-amber-400" />
                <span>Hàng đợi tự động</span>
                {queueItems.filter((i) => i.status === 'QUEUED' || i.status === 'RUNNING').length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-md text-[10px] bg-amber-500/20 text-amber-300 font-mono font-bold border border-amber-500/40">
                    {queueItems.filter((i) => i.status === 'QUEUED' || i.status === 'RUNNING').length}
                  </span>
                )}
              </span>
            ),
            children: (
              <div className="space-y-4">
                {/* Auto Hunter Pipeline Banner */}
                <div className="app-surface p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <ThunderboltOutlined className="text-amber-400 text-base" />
                      <span className="font-bold text-slate-100 text-sm">
                        Hàng đợi tự động
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                      Cơ chế hàng đợi an toàn: Các bài viết phát hiện từ module quét hoặc thêm thủ công sẽ được xếp lịch chạy ngầm tuần tự (FIFO) với độ trễ tự nhiên, chống checkpoint và chia tải đều cho dàn Via.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      onClick={() => fetchBuffQueue()}
                      className="bg-slate-900 border-slate-700 text-slate-200"
                    >
                      Làm mới
                    </Button>
                    <Button
                      size="small"
                      danger
                      onClick={handleClearCompletedQueue}
                      className="text-xs"
                    >
                      Dọn dẹp bài đã xong
                    </Button>
                  </div>
                </div>

                {/* Form nạp bài vào hàng đợi */}
                <Card
                  title={
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-100">
                      <PlusOutlined className="text-blue-400" /> Nạp bài viết vào hàng đợi ngầm
                    </div>
                  }
                  className="app-surface"
                >
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-300">Link bài viết Facebook:</label>
                        <Input
                          placeholder="https://www.facebook.com/share/p/... hoặc link Fanpage/Group"
                          value={queueUrlInput}
                          onChange={(e) => setQueueUrlInput(e.target.value)}
                          className="bg-slate-900 border-slate-700 text-slate-100 rounded-lg text-xs"
                        />
                      </div>
                    </Col>
                    <Col xs={12} sm={6} md={3}>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-300">Số Like:</label>
                        <InputNumber
                          min={5}
                          max={500}
                          value={queueTargetLikes}
                          onChange={(v) => setQueueTargetLikes(v || 30)}
                          className="w-full bg-slate-900 border-slate-700 text-slate-100"
                        />
                      </div>
                    </Col>
                    <Col xs={12} sm={6} md={4}>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-300">Cảm xúc:</label>
                        <Select
                          value={queueReaction}
                          onChange={(v) => setQueueReaction(v)}
                          className="w-full"
                          options={[
                            { value: 'RANDOM_POSITIVE', label: 'Tự nhiên (Like+Love+Care)' },
                            { value: 'LIKE', label: '100% LIKE' },
                            { value: 'LOVE', label: '100% LOVE' },
                            { value: 'RANDOM_ALL', label: 'Ngẫu nhiên tất cả' },
                          ]}
                        />
                      </div>
                    </Col>
                    <Col xs={12} sm={6} md={3}>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-300">Chờ sau đăng:</label>
                        <Select
                          value={queueDelayMinutes}
                          onChange={(v) => setQueueDelayMinutes(v)}
                          className="w-full"
                          options={[
                            { value: 0, label: 'Chạy ngay' },
                            { value: 2, label: '2 phút' },
                            { value: 3, label: '3 phút (Chuẩn)' },
                            { value: 5, label: '5 phút (An toàn)' },
                            { value: 10, label: '10 phút' },
                          ]}
                        />
                      </div>
                    </Col>
                    <Col xs={12} sm={6} md={2} className="flex items-end">
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        loading={queueLoading}
                        onClick={handleAddQueueTask}
                        className="w-full font-semibold"
                      >
                        Thêm
                      </Button>
                    </Col>
                  </Row>
                </Card>

                {/* Danh sách Task trong hàng đợi */}
                <Card
                  title={
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-100">
                        Danh sách bài viết trong hàng đợi ({queueItems.length})
                      </span>
                      <span className="text-xs text-slate-400 font-normal">
                        Tự động làm mới mỗi 10 giây
                      </span>
                    </div>
                  }
                  className="app-surface"
                >
                  {queueItems.length === 0 ? (
                    <div className="py-12 text-center text-slate-400 text-xs">
                      Hàng đợi đang trống. Các bài viết mới từ Module Quét hoặc thêm ở trên sẽ tự động xuất hiện ở đây.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800/80">
                      {queueItems.map((task) => {
                        const isQueued = task.status === 'QUEUED';
                        const isRunning = task.status === 'RUNNING';
                        const isCompleted = task.status === 'COMPLETED';
                        const isFailed = task.status === 'FAILED';

                        return (
                          <div
                            key={task.id}
                            className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                          >
                            <div className="space-y-1 flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] uppercase border ${
                                    isQueued
                                      ? 'bg-amber-950/80 text-amber-300 border-amber-700/60'
                                      : isRunning
                                      ? 'bg-blue-950/80 text-blue-300 border-blue-700/60 animate-pulse'
                                      : isCompleted
                                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60'
                                      : 'bg-rose-950/80 text-rose-300 border-rose-700/60'
                                  }`}
                                >
                                  {isQueued && 'Đang chờ'}
                                  {isRunning && (task.progress?.total ? `Đang buff ${task.progress.done}/${task.progress.total}` : 'Đang buff...')}
                                  {isCompleted && 'Hoàn tất'}
                                  {isFailed && 'Thất bại'}
                                </span>

                                <span className="font-semibold text-slate-200">
                                  Mục tiêu: {task.targetLikes === 'ALL' ? 'xoay vòng page' : `${task.targetLikes || 30} like`} ({task.reactionType})
                                </span>

                                <span className="text-[11px] text-slate-400">
                                  • Nguồn: {String(task.source || '').startsWith('POST_HUNTER')
                                    ? `Post Hunter${task.monitorName ? ` (${task.monitorName})` : ''}`
                                    : task.source === 'AUTO_OWN_POST'
                                    ? `Bài app đăng${task.topic === 'GROUP' ? ' (Group)' : task.topic === 'FANPAGE' ? ' (Fanpage)' : ''}`
                                    : 'Thủ công'}
                                </span>

                                {task.runAfter && isQueued && (
                                  <span className="text-[11px] text-amber-400/90 font-mono">
                                    • Lên lịch: {new Date(task.runAfter).toLocaleTimeString()}
                                  </span>
                                )}

                                {isCompleted && task.result && (
                                  <span className="text-[11px] text-emerald-400 font-semibold font-mono">
                                    • Thành công {task.result.success}/{task.result.total}
                                  </span>
                                )}

                                {isFailed && task.error && (
                                  <span className="text-[11px] text-rose-400 truncate max-w-xs">
                                    • Lỗi: {task.error}
                                  </span>
                                )}
                              </div>

                              <div className="text-slate-400 truncate font-mono text-[11px]">
                                <a
                                  href={task.targetUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-400 hover:underline"
                                >
                                  {task.targetUrl}
                                </a>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 self-end md:self-center">
                              <Dropdown
                                trigger={['click']}
                                menu={{
                                  items: [
                                    ...(isQueued
                                      ? [{ key: 'run', icon: <ThunderboltOutlined />, label: 'Chạy ngay', onClick: () => handleRunNowQueueTask(task.id) }]
                                      : []),
                                    { key: 'open', icon: <ExportOutlined />, label: 'Mở bài viết', onClick: () => window.open(task.targetUrl, '_blank') },
                                    { type: 'divider' as const },
                                    { key: 'delete', icon: <DeleteOutlined />, label: 'Xoá khỏi hàng đợi', danger: true, onClick: () => handleRemoveQueueTask(task.id) },
                                  ],
                                }}
                              >
                                <Button size="small" type="text" icon={<MoreOutlined />} aria-label="Thao tác khác" />
                              </Dropdown>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </div>
            ),
          },
          {
            key: 'buff-history',
            label: `Lịch sử (${buffLogs.length})`,
            children: (
              <div className="space-y-4">
                {/* Metric Summary Cards */}
                <Row gutter={[12, 12]}>
                  <Col xs={12} sm={6}>
                    <div className="p-3.5 app-surface text-center">
                      <div className="text-[11px] font-bold text-slate-400 uppercase">Tổng lượt chạy</div>
                      <div className="text-2xl font-semibold text-slate-100 mt-1">{buffLogs.length}</div>
                    </div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-center">
                      <div className="text-[11px] font-bold text-emerald-400 uppercase">Like thành công</div>
                      <div className="text-2xl font-semibold text-emerald-300 mt-1">
                        {buffLogs.reduce((acc, l) => acc + (l.successCount || 0), 0)}
                      </div>
                    </div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-500/30 text-center">
                      <div className="text-[11px] font-bold text-blue-400 uppercase">Đã like trước đó</div>
                      <div className="text-2xl font-semibold text-blue-300 mt-1">
                        {buffLogs.reduce((acc, l) => acc + (l.alreadyLikedCount || 0), 0)}
                      </div>
                    </div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-500/30 text-center">
                      <div className="text-[11px] font-bold text-rose-400 uppercase">Lỗi / Thất Bại</div>
                      <div className="text-2xl font-semibold text-rose-300 mt-1">
                        {buffLogs.reduce((acc, l) => acc + (l.failedCount || 0), 0)}
                      </div>
                    </div>
                  </Col>
                </Row>

                {/* Filter and Actions Bar */}
                <Card className="app-surface p-0">
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                      <Input
                        prefix={<SearchOutlined className="text-slate-400" />}
                        placeholder="Tìm kiếm theo link bài viết hoặc tên Page..."
                        value={logSearchQuery}
                        onChange={(e) => setLogSearchQuery(e.target.value)}
                        className="rounded-xl bg-slate-900 border-slate-700 text-xs"
                        allowClear
                      />
                      <Select
                        value={logFilterReaction}
                        onChange={(v) => setLogFilterReaction(v)}
                        className="w-36"
                        options={[
                          { value: 'ALL', label: 'Tất cả cảm xúc' },
                          ...REACTIONS.map((r) => ({
                            value: r.key,
                            label: `${r.emoji} ${r.label.split(' ')[0]}`,
                          })),
                        ]}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      {buffLogs.length > 0 && (
                        <Button
                          danger
                          type="dashed"
                          onClick={() => {
                            modal.confirm({
                              title: 'Xoá toàn bộ lịch sử buff?',
                              content: 'Hành động này sẽ xoá toàn bộ logs đã lưu. Bạn có chắc chắn không?',
                              okText: 'Xoá tất cả',
                              cancelText: 'Huỷ',
                              okButtonProps: { danger: true },
                              onOk: () => {
                                setBuffLogs([]);
                                saveBuffLogs([]);
                                message.success('Đã xoá toàn bộ lịch sử buff!');
                              },
                            });
                          }}
                          className="text-xs font-semibold rounded-xl"
                        >
                          Xoá lịch sử
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>

                {/* List / Table of Logs */}
                {buffLogs.length === 0 ? (
                  <Card className="app-surface text-center py-16">
                    <div className="text-5xl mb-3"></div>
                    <div className="text-base font-bold text-slate-200">Chưa có lịch sử buff tương tác nào</div>
                    <div className="text-xs text-slate-400 max-w-md mx-auto mt-2 leading-relaxed">
                      Mỗi khi bạn thực hiện buff like/cảm xúc (đơn lẻ hoặc hàng loạt), hệ thống sẽ tự động ghi nhớ link bài viết, danh sách Page đã like và thời gian tại đây để bạn kiểm tra và tránh like trùng!
                    </div>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {buffLogs
                      .filter((log) => {
                        if (logFilterReaction !== 'ALL' && log.reactionType !== logFilterReaction) return false;
                        if (!logSearchQuery.trim()) return true;
                        const q = logSearchQuery.toLowerCase().trim();
                        return (
                          log.targetUrl.toLowerCase().includes(q) ||
                          log.accountName?.toLowerCase().includes(q) ||
                          log.details.some((d) => d.pageName.toLowerCase().includes(q) || d.pageId.includes(q))
                        );
                      })
                      .map((log) => {
                        const reactionObj = REACTIONS.find((r) => r.key === log.reactionType) || REACTIONS[0];
                        const dateFormatted = new Date(log.createdAt).toLocaleString('vi-VN', {
                          hour: '2-digit',
                          minute: '2-digit',
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        });

                        return (
                          <div
                            key={log.id}
                            className="p-4 app-surface hover:border-slate-600 transition-all space-y-3"
                          >
                            {/* Top row of card */}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-xs text-slate-400 bg-slate-900 px-2 py-0.5 rounded-lg border border-slate-800">
                                  {dateFormatted}
                                </span>
                                <Tag color={log.type === 'BATCH' ? 'purple' : 'blue'} className="m-0 font-bold text-[10px]">
                                  {log.type === 'BATCH' ? 'Hàng loạt' : 'Đơn lẻ'}
                                </Tag>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-800 text-slate-200 border border-slate-700/60">
                                  {reactionObj.emoji} {reactionObj.label.split(' ')[0]}
                                </span>
                                {log.accountName && (
                                  <span className="text-xs text-slate-400">
                                    Via: <b className="text-slate-200">{log.accountName}</b>
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Tag color="success" className="m-0 text-[11px] font-bold" icon={<CheckCircleFilled />}>
                                  {log.successCount} thành công
                                </Tag>
                                {log.commentCount !== undefined && log.commentCount > 0 && (
                                  <Tag color="cyan" className="m-0 text-[11px] font-bold" icon={<CommentOutlined />}>
                                    {log.commentCount} cmt
                                  </Tag>
                                )}
                                {log.alreadyLikedCount > 0 && (
                                  <Tag color="blue" className="m-0 text-[11px]" icon={<CheckOutlined />}>
                                    {log.alreadyLikedCount} đã like trước
                                  </Tag>
                                )}
                                {log.failedCount > 0 && (
                                  <Tag color="error" className="m-0 text-[11px]">
                                    {log.failedCount} lỗi
                                  </Tag>
                                )}
                              </div>
                            </div>

                            {/* Middle: Target Post URL */}
                            <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80 flex items-center justify-between gap-2">
                              <a
                                href={log.targetUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-xs text-blue-400 hover:text-blue-300 truncate flex-1 block"
                              >
                                {log.targetUrl}
                              </a>
                              <Dropdown
                                trigger={['click']}
                                menu={{
                                  items: [
                                    {
                                      key: 'rerun',
                                      icon: <ThunderboltOutlined />,
                                      label: 'Chạy lại bài này',
                                      onClick: () => {
                                        setTargetPostUrl(log.targetUrl);
                                        setSelectedReaction(log.reactionType);
                                        setActiveTabKey('buff-like');
                                        message.info('Đã nạp lại link vào form. Các Page đã like sẽ được tự động bỏ qua.');
                                      },
                                    },
                                    { key: 'open', icon: <ExportOutlined />, label: 'Mở bài trên Facebook', onClick: () => window.open(log.targetUrl, '_blank') },
                                    { key: 'detail', icon: <EyeOutlined />, label: 'Xem chi tiết', onClick: () => setSelectedLogDetail(log) },
                                  ],
                                }}
                              >
                                <Button size="small" type="text" icon={<MoreOutlined />} aria-label="Thao tác khác" />
                              </Dropdown>
                            </div>

                            {/* Bottom: List of Fanpages in this log */}
                            <div>
                              <div className="text-[11px] font-semibold text-slate-400 mb-1 flex items-center justify-between">
                                <span>Danh sách {log.details.length} Fanpage đã tham gia lượt buff này:</span>
                                <Button
                                  size="small"
                                  type="link"
                                  onClick={() => setSelectedLogDetail(log)}
                                  className="text-[11px] p-0 h-auto text-blue-400 hover:underline"
                                >
                                  Xem chi tiết tất cả ({log.details.length} Page)
                                </Button>
                              </div>
                              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                                {log.details.map((d, dIdx) => (
                                  <span
                                    key={d.pageId + dIdx}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border ${
                                      d.status === 'SUCCESS'
                                        ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-300'
                                        : d.status === 'ALREADY_LIKED'
                                        ? 'bg-blue-950/60 border-blue-800/60 text-blue-300'
                                        : 'bg-rose-950/60 border-rose-800/60 text-rose-300'
                                    }`}
                                  >
                                    {d.pageName}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />

      {/* Modal Xem Chi Tiết Log Lịch Sử Tương Tác */}
      <Modal
        open={!!selectedLogDetail}
        onCancel={() => setSelectedLogDetail(null)}
        footer={[
          <Button key="close" onClick={() => setSelectedLogDetail(null)} className="rounded-xl">
            Đóng
          </Button>,
          selectedLogDetail && (
            <Button
              key="buff-again"
              type="primary"
              className="bg-blue-600 hover:bg-blue-500 font-bold rounded-xl"
              onClick={() => {
                setTargetPostUrl(selectedLogDetail.targetUrl);
                setSelectedReaction(selectedLogDetail.reactionType);
                setSelectedLogDetail(null);
                setActiveTabKey('buff-like');
                message.info('Đã nạp lại bài viết này vào form để tiếp tục.');
              }}
            >
              Nạp bài này để Buff tiếp
            </Button>
          ),
        ]}
        width={760}
        centered
        destroyOnHidden
        title={
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <HistoryOutlined className="text-blue-600 text-lg" />
            <div>
              <div className="font-bold text-base text-slate-800">
                Chi tiết lịch sử
              </div>
              <div className="text-[11px] text-slate-400 font-normal">
                Thời gian:{' '}
                <span className="font-mono text-slate-600">
                  {selectedLogDetail ? new Date(selectedLogDetail.createdAt).toLocaleString('vi-VN') : ''}
                </span>{' '}
                • Chế độ:{' '}
                <span className="font-semibold text-blue-600">
                  {selectedLogDetail?.type === 'BATCH' ? 'Hàng loạt (Batch)' : 'Đơn lẻ (Single)'}
                </span>
              </div>
            </div>
          </div>
        }
      >
        {selectedLogDetail && (
          <div className="py-2 space-y-4 text-xs">
            {/* Target Post Info */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-700">Link bài viết mục tiêu:</span>
                <div className="flex items-center gap-2">
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(selectedLogDetail.targetUrl);
                      message.success('Đã sao chép link!');
                    }}
                    className="text-xs"
                  >
                    Sao chép
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    icon={<ExportOutlined />}
                    onClick={() => window.open(selectedLogDetail.targetUrl, '_blank')}
                    className="text-xs"
                  >
                    Mở Facebook
                  </Button>
                </div>
              </div>
              <div className="font-mono text-blue-600 break-all bg-white p-2 rounded-lg border border-slate-200">
                {selectedLogDetail.targetUrl}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-slate-500">Cảm xúc:</span>
                {(() => {
                  const rObj = REACTIONS.find((r) => r.key === selectedLogDetail.reactionType) || REACTIONS[0];
                  return (
                    <Tag className="font-bold">
                      {rObj.emoji} {rObj.label}
                    </Tag>
                  );
                })()}
                {selectedLogDetail.accountName && (
                  <>
                    <span className="text-slate-400">•</span>
                    <span className="text-slate-500">Tài khoản mẹ:</span>
                    <Tag color="cyan">{selectedLogDetail.accountName}</Tag>
                  </>
                )}
              </div>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-4 gap-2">
              <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200 text-center">
                <div className="text-[10px] text-slate-500 font-bold uppercase">Tổng Page</div>
                <div className="text-lg font-semibold text-slate-800">{selectedLogDetail.totalPages}</div>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
                <div className="text-[10px] text-emerald-600 font-bold uppercase">Thành công</div>
                <div className="text-lg font-semibold text-emerald-600">{selectedLogDetail.successCount}</div>
              </div>
              <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-center">
                <div className="text-[10px] text-blue-600 font-bold uppercase">Đã Like Trước</div>
                <div className="text-lg font-semibold text-blue-600">{selectedLogDetail.alreadyLikedCount}</div>
              </div>
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-center">
                <div className="text-[10px] text-rose-600 font-bold uppercase">Thất bại / Lỗi</div>
                <div className="text-lg font-semibold text-rose-600">{selectedLogDetail.failedCount}</div>
              </div>
            </div>

            {/* Detailed Table of Pages */}
            <div className="space-y-2">
              <div className="font-bold text-slate-700 flex items-center justify-between">
                <span>Chi tiết từng Fanpage ({selectedLogDetail.details.length} Page):</span>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-1.5 border border-slate-200 rounded-xl p-2 bg-slate-50">
                {selectedLogDetail.details.map((detail, idx) => {
                  let statusTag = <Tag color="default">Chờ xử lý</Tag>;
                  if (detail.status === 'SUCCESS') {
                    statusTag = <Tag color="success" icon={<CheckCircleFilled />}>Thành công</Tag>;
                  } else if (detail.status === 'ALREADY_LIKED') {
                    statusTag = <Tag color="blue" icon={<CheckOutlined />}>Đã like trước đó</Tag>;
                  } else if (detail.status === 'NO_BUTTON') {
                    statusTag = <Tag color="warning">Không thấy nút Like</Tag>;
                  } else if (detail.status === 'ERROR') {
                    statusTag = <Tag color="error" icon={<CloseCircleFilled />}>Lỗi</Tag>;
                  }

                  return (
                    <div
                      key={detail.pageId + idx}
                      className="p-2 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold text-slate-400 font-mono text-[10px]">#{idx + 1}</span>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800 truncate">{detail.pageName}</div>
                          {detail.commentText && (
                            <div className="text-[11px] text-blue-600 italic truncate max-w-[320px] font-medium">
                              "{detail.commentText}"
                            </div>
                          )}
                          <div className="font-mono text-[10px] text-slate-400">ID: {detail.pageId}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {detail.message && (
                          <span className="text-[11px] text-slate-400 hidden sm:inline truncate max-w-[200px]" title={detail.message}>
                            {detail.message}
                          </span>
                        )}
                        {statusTag}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal Khai Báo & Quản Lý i_user (Fanpage) cho Từng Via */}
      <Modal
        open={managePagesModalOpen}
        onCancel={() => setManagePagesModalOpen(false)}
        footer={null}
        width={780}
        centered
        destroyOnHidden={false}
        className="manage-iuser-modal"
        title={
          <div className="flex items-center gap-2.5 pb-2.5 border-b border-slate-800">
            <IdcardOutlined className="text-blue-400 text-xl" />
            <div>
              <div className="font-bold text-base text-slate-100">
                Danh sách Page cho từng nick
              </div>
              <div className="text-[11px] text-slate-400 font-normal">
                Danh sách Fanpage được lưu cố định cho từng Via, bảo đảm đủ số lượng Page khi thả Like (không lo rớt page).
              </div>
            </div>
          </div>
        }
      >
        <div className="py-2 space-y-4 text-xs">
          {/* Thanh chọn tài khoản Via cần cấu hình */}
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
            <div className="text-xs font-bold text-slate-300 mb-2 flex items-center justify-between">
              <span>Chọn tài khoản Via bạn muốn cấu hình i_user:</span>
              <span className="text-[11px] text-blue-400 font-medium">
                (Bấm chọn từng Via để xem và quản lý)
              </span>
            </div>
            <Segmented
              className="bg-slate-900 border border-slate-800 text-xs w-full"
              block
              value={targetViaForModal}
              onChange={(val) => setTargetViaForModal(val as number | 'CUSTOM')}
              options={[
                ...fbAccounts.map((a: any) => {
                  const k = getViaKey(a);
                  const count = getStoredPagesForVia(k).length;
                  return {
                    value: a.id,
                    label: (
                      <div className="flex items-center justify-center gap-1.5 py-1">
                        <span className="font-bold text-slate-200">{a.pageName || a.platformAccountId}</span>
                        <Tag color={count > 0 ? 'blue' : 'default'} className="!m-0 text-[10px] font-mono">
                          {count} Page
                        </Tag>
                      </div>
                    ),
                  };
                }),
                {
                  value: 'CUSTOM',
                  label: (
                    <div className="flex items-center justify-center gap-1.5 py-1">
                      <span className="text-slate-300">Cookie thủ công</span>
                      <Tag color={getStoredPagesForVia('custom_manual').length > 0 ? 'cyan' : 'default'} className="!m-0 text-[10px] font-mono">
                        {getStoredPagesForVia('custom_manual').length} Page
                      </Tag>
                    </div>
                  ),
                },
              ]}
            />
          </div>

          {/* Banner thông tin Via đang chọn */}
          <div className="bg-blue-950/30 border border-blue-800/40 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircleFilled className="text-emerald-400 text-base" />
              <div>
                <div className="text-xs font-bold text-slate-200">
                  Đang cấu hình cho: <span className="text-blue-400">{modalViaAccount?.pageName || (targetViaForModal === 'CUSTOM' ? 'Cookie thủ công' : 'Via Facebook')}</span>
                  {modalViaAccount && (
                    <span className="font-mono text-[10px] text-slate-400 ml-2">
                      (c_user: {extractCUser(modalViaAccount.cookieString || modalViaAccount.accessToken) || 'N/A'})
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Via này hiện có <b className="font-bold text-emerald-400">{currentModalPages.length} Fanpage</b> được lưu cố định.
                </div>
              </div>
            </div>
          </div>

          {/* Card Thêm Page */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200 uppercase tracking-wide text-xs">
                Nhập thêm i_user (Fanpage) vào Via này:
              </span>
              <Segmented
                size="small"
                value={addMode}
                onChange={(val) => setAddMode(val as 'BULK' | 'SINGLE')}
                options={[
                  { label: 'Dán hàng loạt', value: 'BULK' },
                  { label: 'Nhập từng Page', value: 'SINGLE' },
                ]}
                className="bg-slate-900 border border-slate-800 text-xs"
              />
            </div>

            {addMode === 'BULK' ? (
              <div className="space-y-2">
                <label className="block text-slate-400">
                  Dán danh sách ID i_user hoặc link Page (mỗi dòng 1 Page, định dạng <code className="text-blue-400 font-mono">ID | Tên Page</code>):
                </label>
                <Input.TextArea
                  rows={4}
                  value={bulkPagesText}
                  onChange={(e) => setBulkPagesText(e.target.value)}
                  placeholder={`61589245661782 | Làm Phước Hai\n467447130112806 | Làm Gì Mà Gấp\n61568697241127 | Đại Sảnh Pickleball\n61584834510803 | Làm Sen\n61594279329518 | Nexa 24h\n100091144747972 | Phú Order Hàng Nhật\n61551923480422 | Đại Sảnh Liên Minh Huyền Thoại`}
                  className="font-mono text-xs rounded-xl bg-slate-900 border-slate-800 text-slate-100 placeholder:text-slate-500"
                />
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    Nhận diện được: <b className="text-emerald-400 font-bold">{parsedBulkPages.length}</b> Fanpage hợp lệ
                  </span>
                  <Button
                    type="primary"
                    size="middle"
                    disabled={parsedBulkPages.length === 0}
                    onClick={() => {
                      const pagesToAdd: FanpageItem[] = parsedBulkPages.map((p) => ({
                        id: p.platformAccountId,
                        name: p.pageName,
                        url: `https://www.facebook.com/profile.php?id=${p.platformAccountId}`,
                      }));
                      handleSavePagesForTargetVia(pagesToAdd);
                      setBulkPagesText('');
                    }}
                    className="bg-blue-600 hover:bg-blue-500 font-bold rounded-xl border-none"
                  >
                    Lưu {parsedBulkPages.length} Page vào Via này
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Row gutter={10}>
                  <Col span={10}>
                    <label className="block text-slate-400 mb-1">Tên Fanpage (Tùy chọn):</label>
                    <Input
                      placeholder="VD: Làm Sen"
                      value={newPageName}
                      onChange={(e) => setNewPageName(e.target.value)}
                      className="rounded-xl text-xs bg-slate-900 border-slate-800 text-slate-100"
                    />
                  </Col>
                  <Col span={14}>
                    <label className="block text-slate-400 mb-1">ID Fanpage / i_user (hoặc link):</label>
                    <Input
                      placeholder="VD: 61584834510803 hoặc link Facebook"
                      value={newPageIdOrUrl}
                      onChange={(e) => setNewPageIdOrUrl(e.target.value)}
                      className="font-mono rounded-xl text-xs bg-slate-900 border-slate-800 text-slate-100"
                    />
                  </Col>
                </Row>
                <div className="flex justify-end">
                  <Button
                    type="primary"
                    disabled={!extractPageId(newPageIdOrUrl)}
                    onClick={() => {
                      const id = extractPageId(newPageIdOrUrl);
                      if (id) {
                        const newPage: FanpageItem = {
                          id,
                          name: newPageName.trim() || `Fanpage (${id.slice(-4)})`,
                          url: `https://www.facebook.com/profile.php?id=${id}`,
                        };
                        handleSavePagesForTargetVia([newPage]);
                        setNewPageName('');
                        setNewPageIdOrUrl('');
                      }
                    }}
                    className="bg-blue-600 hover:bg-blue-500 font-bold rounded-xl border-none"
                  >
                    Thêm Fanpage này
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Danh sách các Page hiện có của Via */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-slate-200">
                Danh sách Fanpage đang lưu ({currentModalPages.length} Page):
              </span>
              <div className="flex items-center gap-2">
                {currentModalPages.length > 0 && (
                  <Button
                    type="link"
                    danger
                    size="small"
                    onClick={handleClearPagesForTargetVia}
                    className="text-[11px] !p-0 !h-auto"
                  >
                    Xóa tất cả để dán lại
                  </Button>
                )}
                <span className="text-[11px] text-slate-400">
                  (Đã lưu vĩnh viễn trong máy)
                </span>
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1 border border-slate-800 rounded-xl p-2 bg-slate-950/60">
              {currentModalPages.length === 0 ? (
                <div className="text-center py-6 text-slate-400">
                  Chưa có Fanpage nào được lưu cho Via này. Hãy dán danh sách ở trên để lưu!
                </div>
              ) : (
                currentModalPages.map((page, idx) => (
                  <div
                    key={page.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-slate-900/80 hover:bg-slate-850 transition-colors border border-slate-800/80"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 grid place-items-center text-[10px] font-bold">
                        {idx + 1}
                      </span>
                      <span className="font-bold text-slate-200 truncate max-w-[280px]" title={page.name}>
                        {page.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] font-mono text-blue-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        i_user: {page.id}
                      </span>
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => handleDeletePageForTargetVia(page.id)}
                        className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/40"
                        title="Xóa Fanpage này khỏi Via"
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* MODAL: AI SEEDING STUDIO & SPINTAX ENGINE */}
      <Modal
        title={
          <div className="flex items-center gap-2.5 text-white font-semibold text-base sm:text-lg">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
              <RobotOutlined className="text-base" />
            </div>
            <div>
              <div>AI SEEDING STUDIO & BỘ TRỘN SPINTAX</div>
              <div className="text-[11px] font-normal text-slate-400">
                Sinh bình luận tự nhiên theo ngành hàng, chống trùng lặp và né thuật toán quét bot của Meta.
              </div>
            </div>
          </div>
        }
        open={aiStudioModalOpen}
        onCancel={() => setAiStudioModalOpen(false)}
        footer={null}
        width={780}
        centered
        className="dark-modal"
        styles={{
          body: {
            backgroundColor: '#0f172a',
            color: '#f8fafc',
          },
          header: {
            backgroundColor: '#0f172a',
            borderBottom: '1px solid #1e293b',
          },
        }}
      >
        <div className="space-y-4 pt-3 text-xs sm:text-sm">
          {/* 1. Chọn Ngành Nghề / Niche */}
          <div className="space-y-2">
            <label className="font-bold text-slate-300 block">Chủ đề bài viết:</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(SEEDING_NICHE_PRESETS).map(([key, item]) => {
                const isSelected = selectedNiche === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setSelectedNiche(key);
                      setPreviewSamples(item.templates.map(resolveSpintax));
                    }}
                    className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2 ${
                      isSelected
                        ? 'bg-blue-600/30 border-blue-500 text-white'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    
                    <span className="font-bold text-xs truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Mẫu Cấu Trúc Spintax Gốc */}
          <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/80 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-300">
                Cấu trúc Spintax gốc của ngành "{SEEDING_NICHE_PRESETS[selectedNiche]?.label}":
              </span>
              <span className="text-[11px] text-slate-500 font-mono">Cú pháp: {'{A|B|C} {D|E}'}</span>
            </div>
            <div className="space-y-1 font-mono text-[11px] text-blue-300 max-h-36 overflow-y-auto pr-1">
              {SEEDING_NICHE_PRESETS[selectedNiche]?.templates.map((tmpl, idx) => (
                <div key={idx} className="p-1.5 rounded bg-slate-900/80 border border-slate-800/80">
                  {tmpl}
                </div>
              ))}
            </div>
          </div>

          {/* 3. Live Spintax Tester */}
          <div className="space-y-2 p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-bold text-blue-300 flex items-center gap-1.5 text-xs">
                <ThunderboltFilled className="text-amber-400" />
                Kết quả thực tế khi Bot đi bình luận (Đã xoay Spintax ngẫu nhiên):
              </span>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => {
                  const tmpls = SEEDING_NICHE_PRESETS[selectedNiche]?.templates || [];
                  setPreviewSamples(tmpls.map(resolveSpintax));
                  message.info('Đã xoay biến thể Spintax mới!');
                }}
                className="text-[11px] bg-slate-900 border-slate-700 text-slate-300 hover:text-white"
              >
                Xoay Thử Lại
              </Button>
            </div>

            <div className="space-y-1.5">
              {previewSamples.map((sample, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800/60 text-slate-200 text-xs"
                >
                  <span className="text-[10px] font-bold text-blue-400 shrink-0 select-none">#{idx + 1}</span>
                  <span className="flex-1">{sample}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 4. Hành động Nạp Vào Chiến Dịch */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <SafetyCertificateOutlined className="text-emerald-400" />
              <span>Bảo vệ tài khoản: 100% các Via sẽ bình luận nội dung khác nhau.</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                icon={<RobotOutlined spin={isAiGeneratingComments} />}
                loading={isAiGeneratingComments}
                onClick={async () => {
                  await handleGenerateAiComments();
                  setAiStudioModalOpen(false);
                }}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs h-9 border-none"
              >
                Tạo bằng AI theo link bài
              </Button>

              <Button
                onClick={() => {
                  const tmpls = SEEDING_NICHE_PRESETS[selectedNiche]?.templates || [];
                  // Sinh 10 biến thể Spintax ngẫu nhiên
                  const generated: string[] = [];
                  for (let i = 0; i < 12; i++) {
                    const t = tmpls[i % tmpls.length];
                    generated.push(resolveSpintax(t));
                  }
                  const existingLines = commentListText.split('\n').filter((s) => s.trim());
                  setCommentListText([...existingLines, ...generated].join('\n'));
                  setAiStudioModalOpen(false);
                  message.success(`Đã nối thêm ${generated.length} bình luận vào danh sách!`);
                }}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 font-semibold rounded-xl text-xs h-9"
              >
                Thêm vào cuối
              </Button>

              <Button
                type="primary"
                icon={<ThunderboltFilled />}
                onClick={() => {
                  const tmpls = SEEDING_NICHE_PRESETS[selectedNiche]?.templates || [];
                  // Dùng trực tiếp các câu Spintax nguyên bản để bot tự xoay ở mỗi lượt cmt
                  setCommentListText(tmpls.join('\n'));
                  setAiStudioModalOpen(false);
                  message.success(`Đã nạp toàn bộ kịch bản Spintax chuẩn của "${SEEDING_NICHE_PRESETS[selectedNiche]?.label}"!`);
                }}
                className="bg-blue-600 hover:bg-blue-500 border-none font-bold rounded-xl text-xs h-9"
              >
                Thay toàn bộ
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* MODAL: THÊM / CẬP NHẬT MỤC TIÊU THEO DÕI POST HUNTER */}
      <Modal
        open={isMonitorModalOpen}
        onCancel={() => setIsMonitorModalOpen(false)}
        title={editingMonitorId ? 'Sửa mục tiêu theo dõi' : 'Thêm mục tiêu theo dõi'}
        footer={[
          <Button key="cancel" onClick={() => setIsMonitorModalOpen(false)}>
            Huỷ
          </Button>,
          <Button key="submit" type="primary" loading={loadingMonitors} onClick={handleSaveMonitor}>
            {editingMonitorId ? 'Lưu thay đổi' : 'Bắt đầu theo dõi'}
          </Button>,
        ]}
        width={640}
        className="dark-modal"
      >
        <div className="space-y-5 py-1 text-slate-200">
          <section className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Mục tiêu</div>
            <div>
              <label className="text-xs text-slate-300 mb-1 block">
                Link Fanpage hoặc Group <span className="text-rose-400">*</span>
              </label>
              <Input
                autoFocus
                placeholder="https://www.facebook.com/groups/... hoặc link Fanpage"
                value={monTargetUrl}
                onChange={(e) => {
                  const url = e.target.value;
                  setMonTargetUrl(url);
                  if (/facebook\.com\/groups\//i.test(url)) setMonTargetType('GROUP');
                  else if (/facebook\.com\//i.test(url) && monTargetType === 'GROUP') setMonTargetType('PAGE');
                }}
              />
            </div>
            <Row gutter={12}>
              <Col span={15}>
                <label className="text-xs text-slate-300 mb-1 block">Tên hiển thị</label>
                <Input
                  placeholder="VD: Group nguồn hàng, Page chính"
                  value={monTargetName}
                  onChange={(e) => setMonTargetName(e.target.value)}
                />
              </Col>
              <Col span={9}>
                <label className="text-xs text-slate-300 mb-1 block">Loại</label>
                <Select
                  value={monTargetType}
                  onChange={(val) => setMonTargetType(val)}
                  className="w-full"
                  options={[
                    { value: 'PAGE', label: 'Fanpage' },
                    { value: 'GROUP', label: 'Group' },
                    { value: 'PROFILE', label: 'Trang cá nhân' },
                  ]}
                />
              </Col>
            </Row>
            {monTargetType === 'GROUP' && (
              <div className="text-[11px] text-slate-400">
                Với Group riêng tư, ít nhất một via phải là thành viên thì mới đọc được bài.
              </div>
            )}
          </section>

          <section className="space-y-3 pt-4 border-t border-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Cách buff</div>
            <div>
              <label className="text-xs text-slate-300 mb-1 block">Số lượt mỗi bài</label>
              <div className="flex items-center gap-3">
                <Segmented
                  value={monTargetLikes === 'ALL' ? 'ALL' : 'FIXED'}
                  onChange={(val) => setMonTargetLikes(val === 'ALL' ? 'ALL' : 30)}
                  options={[
                    { value: 'ALL', label: 'Xoay vòng page' },
                    { value: 'FIXED', label: 'Số cố định' },
                  ]}
                />
                {monTargetLikes !== 'ALL' && (
                  <InputNumber
                    min={5}
                    max={500}
                    value={monTargetLikes}
                    onChange={(v) => setMonTargetLikes(v || 30)}
                    addonAfter="lượt"
                    className="w-32"
                  />
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {monTargetLikes === 'ALL'
                  ? `Mỗi bài dùng tối đa ${systemSettings.maxPagesPerPost || 150} page (đổi trong Cài đặt), ưu tiên page ít dùng nhất hôm nay để mọi page được chia đều.`
                  : 'Lấy đúng số page này, ưu tiên page ít dùng nhất hôm nay.'}
              </div>
            </div>
            <Row gutter={12}>
              <Col span={8}>
                <label className="text-xs text-slate-300 mb-1 block">Cảm xúc</label>
                <Select
                  value={monReaction}
                  onChange={(val) => setMonReaction(val)}
                  className="w-full"
                  options={[
                    { value: 'RANDOM_POSITIVE', label: 'Like / Love / Care' },
                    { value: 'LIKE', label: 'Like' },
                    { value: 'LOVE', label: 'Love' },
                    { value: 'CARE', label: 'Care' },
                  ]}
                />
              </Col>
              <Col span={8}>
                <label className="text-xs text-slate-300 mb-1 block">Chờ sau khi phát hiện</label>
                <Select
                  value={monDelayMinutes}
                  onChange={(val) => setMonDelayMinutes(val)}
                  className="w-full"
                  options={[
                    { value: 0, label: 'Buff ngay' },
                    { value: 3, label: '3 phút' },
                    { value: 5, label: '5 phút' },
                    { value: 10, label: '10 phút' },
                  ]}
                />
              </Col>
              <Col span={8}>
                <label className="text-xs text-slate-300 mb-1 block">Chu kỳ quét</label>
                <Select
                  value={monInterval}
                  onChange={(val) => setMonInterval(val)}
                  className="w-full"
                  options={[
                    { value: 5, label: '5 phút' },
                    { value: 10, label: '10 phút' },
                    { value: 15, label: '15 phút' },
                    { value: 30, label: '30 phút' },
                    { value: 60, label: '60 phút' },
                  ]}
                />
              </Col>
            </Row>
            <div>
              <label className="text-xs text-slate-300 mb-1 block">Via thực hiện</label>
              <Select
                value={monViaMode}
                onChange={(val) => setMonViaMode(val)}
                className="w-full"
                options={[
                  { value: 'ALL_VIAS', label: 'Tất cả via đang sống' },
                  { value: 'CUSTOM', label: 'Chỉ via đầu tiên' },
                ]}
              />
            </div>
          </section>

          <section className="space-y-3 pt-4 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Bình luận</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Mỗi page để lại một bình luận ngẫu nhiên, hỗ trợ Spintax.</div>
              </div>
              <Switch checked={monEnableComment} onChange={setMonEnableComment} />
            </div>

            {monEnableComment && (
              <div className="space-y-2">
                <Input.TextArea
                  rows={4}
                  value={monCommentText}
                  onChange={(e) => setMonCommentText(e.target.value)}
                  placeholder="Mỗi dòng một mẫu, VD: {Đẹp quá|Xịn quá} {shop|bạn} ơi"
                  className="font-mono text-xs"
                />
                <div className="flex items-center justify-end gap-3">
                  <Button
                    size="small"
                    type="link"
                    className="!p-0"
                    onClick={() => {
                      const sampleTmpls = SEEDING_NICHE_PRESETS['SALES']?.templates || [];
                      setMonCommentText(sampleTmpls.join('\n'));
                    }}
                  >
                    Dùng mẫu bán hàng
                  </Button>
                  <Button size="small" onClick={handleTestSpintaxInForm}>
                    Xem thử
                  </Button>
                </div>

                {spintaxSampleOutputs.length > 0 && (
                  <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/70">
                    {spintaxSampleOutputs.map((s, idx) => (
                      <div key={idx} className="px-3 py-1.5 text-xs text-slate-300">
                        {s}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </Modal>

      {/* MODAL: BÁO CÁO SỨC KHỎE DÀN VIA TRONG BM */}
      <Modal
        open={isHealthModalOpen}
        onCancel={() => setIsHealthModalOpen(false)}
        title={
          <div className="flex items-center gap-2 text-base font-bold text-slate-100 pb-2 border-b border-slate-800">
            <SafetyCertificateOutlined className="text-emerald-400 text-lg" />
            <span>Báo Cáo Sức Khỏe Dàn Via Facebook (Live/Die Status)</span>
          </div>
        }
        footer={[
          <Button key="close" type="primary" onClick={() => setIsHealthModalOpen(false)} className="rounded-xl">
            Đóng
          </Button>,
        ]}
        width={720}
        className="dark-modal"
      >
        <div className="space-y-4 py-2 text-slate-200">
          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
            <span>Tổng số Via kiểm tra: <strong className="text-slate-100">{viaHealthResults.length}</strong></span>
            <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              Hoạt Động: {viaHealthResults.filter((r) => r.isLive).length}
            </span>
            <span className="inline-flex items-center gap-1.5 text-rose-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-rose-400"></span>
              Sự Cố / Hết Hạn: {viaHealthResults.filter((r) => !r.isLive).length}
            </span>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {viaHealthResults.map((v, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                  v.isLive
                    ? 'bg-slate-900/80 border-emerald-800/40'
                    : 'bg-rose-950/20 border-rose-800/40'
                }`}
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-100">{v.viaName || `Via ${v.uid}`}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-medium ${
                      v.isLive
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${v.isLive ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
                      {v.isLive ? 'LIVE' : v.status === 'CHECKPOINT' ? 'CHECKPOINT' : 'EXPIRED'}
                    </span>
                    {v.proxyUrl && (
                      <Tag color="purple" className="text-[10px] font-mono">
                        Proxy: {v.proxyUrl.split('@').pop() || 'Private'}
                      </Tag>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">UID: {v.uid || 'N/A'} {v.name && `· Tên Facebook: ${v.name}`}</div>
                  {v.error && <div className="text-[11px] text-rose-400">{v.error}</div>}
                </div>
                <div className="shrink-0 text-right text-[11px] text-slate-500 font-mono">
                  {new Date(v.checkedAt).toLocaleTimeString('vi-VN')}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* MODAL: CÀI ĐẶT HỆ THỐNG & TELEGRAM OPS BOT */}
      <Modal
        open={isSettingsModalOpen}
        onCancel={() => setIsSettingsModalOpen(false)}
        title={
          <div className="flex items-center gap-2.5 text-base font-semibold text-slate-100 pb-3 border-b border-slate-800">
            <SettingOutlined className="text-blue-400 text-lg" />
            <span>Cấu Hình Vận Hành & Giám Sát Hệ Thống</span>
          </div>
        }
        footer={[
          <Button key="cancel" onClick={() => setIsSettingsModalOpen(false)} className="rounded-xl">
            Đóng
          </Button>,
          <Button
            key="save"
            type="primary"
            icon={<CheckOutlined />}
            loading={savingSettings}
            onClick={handleSaveSettings}
            className="bg-blue-600 hover:bg-blue-500 rounded-xl font-medium"
          >
            Lưu Cấu Hình
          </Button>,
        ]}
        width={660}
        className="dark-modal"
      >
        <div className="space-y-4 py-2 text-slate-200 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-300 flex items-start gap-3">
            <BellOutlined className="text-blue-400 text-lg mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-slate-100">Giám Sát Thời Gian Thực Qua Telegram</div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Khi có Via bị checkpoint/hết hạn hoặc máy săn bài phát hiện bài viết mới, bot sẽ thông báo tức thì về điện thoại để bạn xử lý ngay lập tức.
              </div>
            </div>
          </div>

          <div className="space-y-3.5 bg-slate-900/80 p-4 rounded-xl border border-slate-800">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider text-[11px]">Thông Tin Kết Nối Telegram</div>
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Telegram Bot Token:
              </label>
              <Input
                placeholder={systemSettings.telegramBotTokenMasked ? `Đã lưu: ${systemSettings.telegramBotTokenMasked} (nhập để thay)` : 'Ví dụ: 7891234567:AAH...'}
                value={systemSettings.telegramBotToken}
                onChange={(e) => setSystemSettings({ ...systemSettings, telegramBotToken: e.target.value })}
                className="bg-slate-950 border-slate-700 text-slate-100 font-mono text-xs rounded-lg"
              />
              <div className="text-[11px] text-slate-500 mt-1">Lấy token từ @BotFather trên Telegram.</div>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Telegram Chat ID:
              </label>
              <div className="flex gap-2">
                <Input
                  placeholder="Ví dụ: 123456789 hoặc -100123456789"
                  value={systemSettings.telegramChatId}
                  onChange={(e) => setSystemSettings({ ...systemSettings, telegramChatId: e.target.value })}
                  className="bg-slate-950 border-slate-700 text-slate-100 font-mono text-xs rounded-lg flex-1"
                />
                <Button
                  loading={testingTelegram}
                  onClick={handleTestTelegram}
                  icon={<SendOutlined />}
                  className="bg-blue-950/60 border-blue-800 text-blue-300 text-xs font-medium rounded-lg hover:border-blue-600"
                >
                  Gửi Tin Test
                </Button>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">Lấy Chat ID từ @userinfobot hoặc @getmyid_bot trên Telegram.</div>
            </div>
          </div>

          <div className="space-y-3 bg-slate-900/80 p-4 rounded-xl border border-slate-800">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider text-[11px]">Chính Sách Cảnh Báo Tự Động</div>

            <div className="flex items-center justify-between py-1.5 border-b border-slate-800/60">
              <div>
                <div className="font-medium text-slate-200">Cảnh báo tức thì khi Via bị Checkpoint hoặc hết hạn</div>
                <div className="text-[11px] text-slate-400">Tự động cô lập Via lỗi để bảo vệ an toàn cho dàn BM.</div>
              </div>
              <Switch
                size="small"
                checked={systemSettings.notifyOnViaDead !== false}
                onChange={(checked) => setSystemSettings({ ...systemSettings, notifyOnViaDead: checked })}
              />
            </div>

            <div className="flex items-center justify-between py-1.5 border-b border-slate-800/60">
              <div>
                <div className="font-medium text-slate-200">Thông báo khi Post Hunter phát hiện bài viết mới</div>
                <div className="text-[11px] text-slate-400">Gửi link bài viết và đếm ngược thời gian chờ buff tự động.</div>
              </div>
              <Switch
                size="small"
                checked={systemSettings.notifyOnHunter !== false}
                onChange={(checked) => setSystemSettings({ ...systemSettings, notifyOnHunter: checked })}
              />
            </div>

            <div className="flex items-center justify-between py-1.5">
              <div>
                <div className="font-medium text-slate-200">Thông báo khi hoàn tất chiến dịch Buff tương tác</div>
                <div className="text-[11px] text-slate-400">Báo cáo tỷ lệ like/comment thành công và tổng thời gian thực thi.</div>
              </div>
              <Switch
                size="small"
                checked={systemSettings.notifyOnBuffDone !== false}
                onChange={(checked) => setSystemSettings({ ...systemSettings, notifyOnBuffDone: checked })}
              />
            </div>
          </div>

          <div className="space-y-3 bg-slate-900/80 p-4 rounded-xl border border-slate-800">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider text-[11px]">Tự buff bài app vừa đăng</div>

            <div className="flex items-center justify-between py-1.5 border-b border-slate-800/60">
              <div>
                <div className="font-medium text-slate-200">Bật tự buff bài app vừa đăng</div>
                <div className="text-[11px] text-slate-400">Đăng xong là nạp vào hàng đợi, buff xoay vòng bằng các page của mọi via (tối đa theo "Số page tối đa cho mỗi bài").</div>
              </div>
              <Switch
                size="small"
                checked={Boolean(systemSettings.autoBuffOwnPosts)}
                onChange={(checked) => setSystemSettings({ ...systemSettings, autoBuffOwnPosts: checked })}
              />
            </div>

            <div className="flex items-center justify-between py-1.5 border-b border-slate-800/60">
              <span className="text-slate-300">Bài đăng lên Fanpage</span>
              <Switch
                size="small"
                disabled={!systemSettings.autoBuffOwnPosts}
                checked={systemSettings.autoBuffOwnFanpage !== false}
                onChange={(checked) => setSystemSettings({ ...systemSettings, autoBuffOwnFanpage: checked })}
              />
            </div>

            <div className="flex items-center justify-between py-1.5 border-b border-slate-800/60">
              <span className="text-slate-300">Bài đăng vào Group</span>
              <Switch
                size="small"
                disabled={!systemSettings.autoBuffOwnPosts}
                checked={systemSettings.autoBuffOwnGroup !== false}
                onChange={(checked) => setSystemSettings({ ...systemSettings, autoBuffOwnGroup: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-300">Chờ sau khi đăng (phút):</span>
              <InputNumber
                min={0}
                max={120}
                disabled={!systemSettings.autoBuffOwnPosts}
                value={systemSettings.autoBuffDelayMinutes ?? 3}
                onChange={(val) => setSystemSettings({ ...systemSettings, autoBuffDelayMinutes: val ?? 3 })}
                className="bg-slate-950 border-slate-700 text-blue-300 font-semibold"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-300">Loại cảm xúc:</span>
              <Select
                disabled={!systemSettings.autoBuffOwnPosts}
                value={systemSettings.autoBuffReaction || 'RANDOM_POSITIVE'}
                onChange={(val) => setSystemSettings({ ...systemSettings, autoBuffReaction: val })}
                className="w-48 text-xs"
                options={[
                  { value: 'RANDOM_POSITIVE', label: 'Like / Love / Care' },
                  { value: 'LIKE', label: 'Chỉ Thích (Like)' },
                  { value: 'LOVE', label: 'Chỉ Yêu thích (Love)' },
                  { value: 'CARE', label: 'Thương thương (Care)' },
                ]}
              />
            </div>
          </div>

          <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 space-y-2.5">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider text-[11px]">Giới hạn lượt mỗi Page</div>
            <div className="flex items-center justify-between">
              <span className="text-slate-300">Giới hạn tương tác tối đa mỗi Fanpage trong 1 ngày:</span>
              <InputNumber
                min={5}
                max={100}
                value={systemSettings.maxDailyPageActions || 25}
                onChange={(val) => setSystemSettings({ ...systemSettings, maxDailyPageActions: val || 25 })}
                className="bg-slate-950 border-slate-700 text-blue-300 font-semibold"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-300">Số page tối đa cho mỗi bài (chế độ xoay vòng):</span>
              <InputNumber
                min={5}
                max={2000}
                value={systemSettings.maxPagesPerPost || 150}
                onChange={(val) => setSystemSettings({ ...systemSettings, maxPagesPerPost: val || 150 })}
                className="bg-slate-950 border-slate-700 text-blue-300 font-semibold"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-300">Số via chạy song song:</span>
              <InputNumber
                min={1}
                max={12}
                value={systemSettings.buffParallelVias || 4}
                onChange={(val) => setSystemSettings({ ...systemSettings, buffParallelVias: val || 4 })}
                className="bg-slate-950 border-slate-700 text-blue-300 font-semibold"
              />
            </div>
            <div className="text-[11px] text-slate-400">
              Mỗi via song song là một trình duyệt (~400 MB RAM); máy 16 GB nên để 4. Khuyến nghị 20–30 lượt/ngày. Page đã đủ lượt sẽ được bỏ qua và hiện "Đã đủ N lượt hôm nay"; giới hạn tính lại từ 0h (giờ Việt Nam).
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
