import { useState, useMemo, useEffect } from 'react';
import {
  Input,
  Button,
  Select,
  Checkbox,
  Tooltip,
  App,
  InputNumber,
  Modal,
  Image,
  Segmented,
  Spin,
  Tag,
  Collapse,
  Progress,
  Table,
  Popconfirm,
  Alert,
  Dropdown,
} from 'antd';
import {
  SearchOutlined,
  PlayCircleOutlined,
  PictureOutlined,
  CopyOutlined,
  UnorderedListOutlined,
  AppstoreOutlined,
  FileTextOutlined,
  RocketOutlined,
  ThunderboltFilled,
  LikeOutlined,
  CommentOutlined,
  ShareAltOutlined,
  FireOutlined,
  RobotOutlined,
  GlobalOutlined,
  CheckOutlined,
  FilterOutlined,
  CheckCircleOutlined,
  TeamOutlined,
  StarOutlined,
  StarFilled,
  LinkOutlined,
  CompassOutlined,
  FolderOpenOutlined,
  ArrowLeftOutlined,
  AimOutlined,
  DeleteOutlined,
  FacebookFilled,
  ClockCircleOutlined,
  PlusOutlined,
  CloseOutlined,
  EyeOutlined,
  FileExcelOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import api from '../config/axios';
import ScheduleChoice from '../components/common/ScheduleChoice';
import { schedulePayload, type ScheduleValue } from '../components/common/postingSchedule';
import AiSettingsModal, { getStoredGeminiKeys } from '../components/modals/AiSettingsModal';

export interface HuntedPost {
  id: string;
  url: string;
  caption: string;
  mediaUrls: string[];
  previewCover?: string;
  videoUrl?: string;
  hasVideo?: boolean;
  mediaType?: 'VIDEO' | 'IMAGE' | 'TEXT' | 'NONE';
  mediaCount?: number;
  author?: string;
  publishedAt?: string;
  postedAt?: string;
  postedTime?: string;
  postedTimeLabel?: string;
  postedUtime?: number;
  dateText?: string;
  reactions: number;
  comments: number;
  shares: number;
  viralScore: number;
  isViral: boolean;
  platform: 'THREADS' | 'FACEBOOK' | 'TIKTOK';
  originalCaption?: string;
  aiRewritten?: boolean;
  sourceGroup?: string;
  // Gemini AI Curation fields
  aiScore?: number;
  isSpam?: boolean;
  qualityVerdict?: string;
  viralAngle?: string;
  suggestedHook?: string;
  aiCurated?: boolean;
  isAlreadyImported?: boolean;
  postStatus?: string;
  // Bài lấy từ hộp "Bài mới chờ duyệt" (bộ quét tự động ở backend)
  inboxId?: number;
  // Bài từ nguồn Reddit trong Kho Nguồn (caption tiếng Anh, ảnh i.redd.it)
  sourcePlatform?: 'REDDIT';
  subreddit?: string;
}

// Worker quét Facebook trả ảnh ở field `images` (giao diện + hàng đợi đọc `mediaUrls`)
const fbMediaUrls = (it: any): string[] => {
  if (Array.isArray(it?.mediaUrls) && it.mediaUrls.length > 0) return it.mediaUrls;
  if (Array.isArray(it?.images) && it.images.length > 0) return it.images;
  return it?.previewCover ? [it.previewCover] : [];
};

export interface DiscoveredGroup {
  id: string;
  name: string;
  url: string;
  memberLine: string;
  postFreqLine: string;
  privacy: string;
  avatar?: string;
  memberCount?: number;
  postsPerDay?: number;
  qualityScore?: number;
  qualityBadge?: string;
  category?: 'PHIM' | 'PETS' | 'FOOD' | 'GENERAL';
}

export interface TargetSourceItem {
  id: string;
  name: string;
  url: string;
  type: 'GROUP' | 'PAGE' | 'REDDIT';
  description?: string;
  category?: string;
  dbId?: number;
  autoScan?: boolean;
  lastScannedAt?: string;
  lastScanStatus?: string;
  lastScanError?: string;
  lastNewCount?: number;
}

interface AutoScanStatus {
  enabled: boolean;
  intervalHours: number;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  running: boolean;
  currentSource?: string | null;
  newCount: number;
}

const mapDbSource = (s: any): TargetSourceItem => ({
  id: String(s.id),
  dbId: s.id,
  name: s.name,
  url: s.url,
  type: s.type === 'GROUP' || s.type === 'REDDIT' ? s.type : 'PAGE',
  description: s.description || undefined,
  category: s.category || undefined,
  autoScan: s.autoScan !== false,
  lastScannedAt: s.lastScannedAt || undefined,
  lastScanStatus: s.lastScanStatus || undefined,
  lastScanError: s.lastScanError || undefined,
  lastNewCount: s.lastNewCount ?? undefined,
});

// "r/cats", "/r/cats", "https://www.reddit.com/r/cats/..." → nguồn Reddit (backend chuẩn hóa link)
const isRedditSourceInput = (raw: string) => /(^|\/)r\/[A-Za-z0-9_]{2,21}/.test(raw.trim()) && !raw.includes('facebook.com');

// Ô nhập ở chế độ Reddit: link 1 bài → lấy riêng bài đó; "r/tên" → subreddit; "r/tên từ khóa" → tìm trong
// subreddit; còn lại → tìm từ khóa trên toàn Reddit (lưu thành nguồn tìm kiếm, quét định kỳ như subreddit)
const resolveRedditInput = (raw: string): { kind: 'POST' | 'SOURCE'; url: string } => {
  const s = raw.trim();
  if (/\/comments\/[a-z0-9]+|redd\.it\/[a-z0-9]+/i.test(s)) return { kind: 'POST', url: s };
  if (/reddit\.com\//i.test(s)) return { kind: 'SOURCE', url: s };
  const m = s.match(/^\/?r\/([A-Za-z0-9_]{2,21})\/?(?:\s+(.+))?$/);
  if (m && !m[2]) return { kind: 'SOURCE', url: `r/${m[1]}` };
  if (m && m[2]) {
    return { kind: 'SOURCE', url: `https://www.reddit.com/r/${m[1]}/search/?q=${encodeURIComponent(m[2].trim())}&restrict_sr=1&sort=top&t=week` };
  }
  return { kind: 'SOURCE', url: `https://www.reddit.com/search/?q=${encodeURIComponent(s)}&sort=top&t=week` };
};

interface RedditConfig {
  configured: boolean;
  clientId: string;
  username: string;
  includeVideo: boolean;
  hasCookie?: boolean;
  mode?: 'COOKIE' | 'OAUTH' | 'NONE';
}

const TRENDING_GROUP_KEYWORDS = [
  'Review phim',
  'Ghiền phim',
  'Yêu chó mèo',
  'Review đồ ăn',
  'Bất động sản',
  'Tâm sự gen z',
  'Khởi nghiệp kinh doanh',
  'Nghiện nhà đẹp',
  'Mẹo vặt cuộc sống',
  'Phim chiếu rạp',
];

const INITIAL_GROUPS: DiscoveredGroup[] = [
  // ── KHU VỰC CHUYÊN ĐỀ: PHIM & ĐIỆN ẢNH (Bí ý tưởng bấm cào ngay) ──
  {
    id: 'cuongphimreview',
    name: 'Cuồng Phim Review (Fanpage)',
    url: 'https://www.facebook.com/cuongphimreview',
    memberLine: '520K người theo dõi',
    postFreqLine: 'Đăng bài review liên tục hàng ngày',
    privacy: 'Công khai',
    memberCount: 520000,
    qualityBadge: '👑 Fanpage Review Khủng',
    qualityScore: 99,
    category: 'PHIM',
  },
  {
    id: 'chikhenphimhay',
    name: 'Khen Phim Hay - Chê Phim Dở',
    url: 'https://www.facebook.com/groups/chikhenphimhay',
    memberLine: '310K thành viên',
    postFreqLine: 'Thảo luận & review phim cực xôm',
    privacy: 'Công khai',
    memberCount: 310000,
    qualityBadge: '🎬 Nguồn Ý Tưởng Phim',
    qualityScore: 98,
    category: 'PHIM',
  },
  {
    id: 'xemphimgixemvoi',
    name: 'Xem phim gì? Xem với!',
    url: 'https://www.facebook.com/groups/xemphimgixemvoi/',
    memberLine: '280K thành viên',
    postFreqLine: 'Hàng chục bài review mỗi ngày',
    privacy: 'Công khai',
    memberCount: 280000,
    qualityBadge: '🎬 Nguồn Ý Tưởng Phim',
    qualityScore: 97,
    category: 'PHIM',
  },
  {
    id: '898364887623372',
    name: 'Netflix Việt Nam Group',
    url: 'https://www.facebook.com/groups/898364887623372',
    memberLine: '195K thành viên',
    postFreqLine: 'Cập nhật phim bộ & phim hot liên tục',
    privacy: 'Công khai',
    memberCount: 195000,
    qualityBadge: '🎬 Nguồn Ý Tưởng Phim',
    qualityScore: 96,
    category: 'PHIM',
  },
  {
    id: 'w2wcartoon',
    name: 'W2W - Cộng Đồng Cartoon Việt Nam',
    url: 'https://www.facebook.com/groups/w2wcartoon',
    memberLine: '150K thành viên',
    postFreqLine: 'Phân tích cốt truyện & nhân vật',
    privacy: 'Công khai',
    memberCount: 150000,
    qualityBadge: '🎬 Nguồn Ý Tưởng Phim',
    qualityScore: 95,
    category: 'PHIM',
  },
  {
    id: 'khenphim',
    name: 'Khen Phim - Review phim chiếu rạp',
    url: 'https://www.facebook.com/groups/khenphim',
    memberLine: '206K thành viên',
    postFreqLine: 'Chuyên review phim chiếu rạp & bom tấn',
    privacy: 'Công khai',
    memberCount: 206000,
    postsPerDay: 15,
    qualityBadge: '🎬 Nguồn Ý Tưởng Phim',
    qualityScore: 94,
    category: 'PHIM',
  },
  {
    id: '170281847022614',
    name: 'Hội Mê Phim Chiếu Rạp',
    url: 'https://www.facebook.com/groups/170281847022614',
    memberLine: '120K thành viên',
    postFreqLine: 'Ý kiến khán giả & review sau khi xem',
    privacy: 'Công khai',
    memberCount: 120000,
    qualityBadge: '🎬 Nguồn Ý Tưởng Phim',
    qualityScore: 93,
    category: 'PHIM',
  },
  {
    id: 'VietnamCinemas',
    name: 'Diễn Đàn Rạp Chiếu Phim Việt Nam',
    url: 'https://www.facebook.com/groups/VietnamCinemas/',
    memberLine: '95K thành viên',
    postFreqLine: 'Doanh thu phòng vé, lịch chiếu & hậu trường',
    privacy: 'Công khai',
    memberCount: 95000,
    qualityBadge: '🎬 Nguồn Ý Tưởng Phim',
    qualityScore: 95,
    category: 'PHIM',
  },
  {
    id: '352102219461769',
    name: 'Cinema Hà Nội',
    url: 'https://www.facebook.com/groups/352102219461769',
    memberLine: 'Cộng đồng điện ảnh & phim ảnh',
    postFreqLine: 'Thảo luận điện ảnh, review phim & phòng vé',
    privacy: 'Công khai',
    memberCount: 85000,
    qualityBadge: '🎬 Nguồn Ý Tưởng Phim',
    qualityScore: 95,
    category: 'PHIM',
  },
  {
    id: 'film.factoryyy',
    name: 'FILM FACTORY (Kênh TikTok Review Phim)',
    url: 'https://www.tiktok.com/@film.factoryyy',
    memberLine: '462.3K Follower • 61.5M Thích',
    postFreqLine: 'Review phim chiếu rạp, bom tấn & tin điện ảnh',
    privacy: 'TikTok Channel',
    memberCount: 462300,
    postsPerDay: 20,
    qualityBadge: '👑 Kênh TikTok Triệu View',
    qualityScore: 100,
    category: 'PHIM',
  },
  {
    id: 'phimtalk000',
    name: 'PhimTalk (Kênh TikTok Review Phim)',
    url: 'https://www.tiktok.com/@phimtalk000',
    memberLine: '26.9K Follower • 6.7M Thích',
    postFreqLine: 'Review phim bộ & tóm tắt điện ảnh',
    privacy: 'TikTok Channel',
    memberCount: 26900,
    postsPerDay: 10,
    qualityBadge: '🔥 Kênh TikTok Hot',
    qualityScore: 92,
    category: 'PHIM',
  },
  {
    id: '1688305138304584',
    name: 'Review Phim Tổng Tài & Điện Ảnh',
    url: 'https://www.facebook.com/groups/1688305138304584/',
    memberLine: '646K thành viên',
    postFreqLine: '90+ bài viết/ngày',
    privacy: 'Công khai',
    memberCount: 646000,
    postsPerDay: 90,
    qualityBadge: '👑 Siêu Group Khủng',
    qualityScore: 100,
    category: 'PHIM',
  },
  {
    id: '2468185960043571',
    name: 'Review Phim Hay Trọn Bộ (Mọt Phim)',
    url: 'https://www.facebook.com/groups/2468185960043571/',
    memberLine: '471K thành viên',
    postFreqLine: '90+ bài viết/ngày',
    privacy: 'Công khai',
    memberCount: 471000,
    postsPerDay: 90,
    qualityBadge: '👑 Siêu Group Khủng',
    qualityScore: 95,
    category: 'PHIM',
  },
  // ── KHU VỰC CHUYÊN ĐỀ: THÚ CƯNG / CHÓ MÈO ──
  {
    id: 'daomeo_official',
    name: 'ĐẢO MÈO 🐱 (Cộng đồng Đảo Mèo lớn nhất)',
    url: 'https://www.facebook.com/groups/daomeo/',
    memberLine: '2.5M thành viên',
    postFreqLine: 'Hàng trăm bài viết hot/ngày',
    privacy: 'Công khai',
    memberCount: 2500000,
    postsPerDay: 150,
    qualityBadge: '👑 Siêu Group Triệu Member',
    qualityScore: 100,
    category: 'PETS',
  },
  {
    id: 'yeuchomeovn',
    name: 'Đảo Mèo 🐈 Đảo Chó 🐶 (Cộng đồng thú cưng lớn nhất)',
    url: 'https://www.facebook.com/groups/yeuchomeovn/',
    memberLine: '706K thành viên',
    postFreqLine: '70+ bài viết/ngày',
    privacy: 'Công khai',
    memberCount: 706000,
    postsPerDay: 70,
    qualityBadge: '🔥 Top Cộng Đồng Lớn',
    qualityScore: 99,
    category: 'PETS',
  },
  {
    id: 'nghienchomeo',
    name: 'NGHIỆN CHÓ - MÈO',
    url: 'https://www.facebook.com/groups/nghienchomeo/',
    memberLine: '419K thành viên',
    postFreqLine: '70+ bài viết/ngày',
    privacy: 'Công khai',
    memberCount: 419000,
    postsPerDay: 70,
    qualityBadge: '🔥 Top Cộng Đồng Lớn',
    qualityScore: 92,
    category: 'PETS',
  },
];

export const isPostInDateRange = (post: HuntedPost, range: 'ALL' | 'TODAY' | '3_DAYS' | '7_DAYS'): boolean => {
  if (range === 'ALL') return true;

  const now = Date.now();
  let ts: number | null = null;

  if (typeof post.postedUtime === 'number' && post.postedUtime > 0) {
    ts = post.postedUtime * 1000;
  } else if (post.postedAt) {
    const parsed = dayjs(post.postedAt).valueOf();
    if (!isNaN(parsed) && parsed > 0) ts = parsed;
  } else if (post.publishedAt) {
    const parsed = dayjs(post.publishedAt).valueOf();
    if (!isNaN(parsed) && parsed > 0) ts = parsed;
  }

  if (ts !== null) {
    const diffHours = (now - ts) / (3600 * 1000);
    if (range === 'TODAY') return diffHours <= 30; // 24 - 30 giờ qua
    if (range === '3_DAYS') return diffHours <= 72; // 3 ngày
    if (range === '7_DAYS') return diffHours <= 168; // 7 ngày
    return true;
  }

  // Fallback nếu không có timestamp chuẩn mà chỉ có text relative từ Facebook (ví dụ "2 giờ", "15 phút", "vừa xong")
  const txt = (post.postedTime || post.dateText || post.postedTimeLabel || '').toLowerCase();
  if (range === 'TODAY') {
    return /(?:phút|giờ|vừa xong|vừa đăng|hôm nay|mins?|hrs?|h\b|now)/i.test(txt);
  }
  if (range === '3_DAYS') {
    return /(?:phút|giờ|vừa xong|hôm nay|hôm qua|1 ngày|2 ngày|3 ngày|mins?|hrs?|1d|2d|3d)/i.test(txt);
  }
  if (range === '7_DAYS') {
    return /(?:phút|giờ|vừa xong|hôm nay|hôm qua|\d+\s*(?:ngày|days?)|[1-7]d)/i.test(txt);
  }

  return true;
};

export default function ViralHunter() {
  const { message } = App.useApp();
  const navigate = useNavigate();

  // Mode: Khám phá nhóm chất lượng vs Săn bài viết vs Cào nguồn mục tiêu chỉ định
  const [hunterMode, setHunterMode] = useState<'DISCOVER_GROUPS' | 'HUNT_POSTS' | 'TARGET_SOURCES'>('DISCOVER_GROUPS');

  // ── Tab 3: Cào theo Mục Tiêu (Group / Fanpage chỉ định) ──
  const [targetSourceUrl, setTargetSourceUrl] = useState('');
  const [targetPlatform, setTargetPlatform] = useState<'FACEBOOK' | 'REDDIT'>('FACEBOOK');
  const [targetSourceName, setTargetSourceName] = useState('');
  const [targetLimit, setTargetLimit] = useState<number>(10);
  const [targetSortOrder, setTargetSortOrder] = useState<'NEWEST' | 'VIRAL'>('NEWEST');
  const [targetTimeRange, setTargetTimeRange] = useState<'ALL' | 'TODAY' | '3_DAYS' | '7_DAYS'>('ALL');
  const [targetMinReactions, setTargetMinReactions] = useState<number>(0);
  const [targetKeywordFilter, setTargetKeywordFilter] = useState('');
  const [targetSources, setTargetSources] = useState<TargetSourceItem[]>(() => {
    const defaultList: TargetSourceItem[] = [
      { id: 'daomeo_official', name: 'ĐẢO MÈO 🐱 (Cộng đồng lớn nhất)', url: 'https://www.facebook.com/groups/daomeo/', type: 'GROUP', description: 'Cộng đồng Đảo Mèo 2.5M thành viên lớn nhất Việt Nam', category: 'PETS' },
      { id: 'yeuchomeovn', name: 'Đảo Mèo 🐈 Đảo Chó 🐶', url: 'https://www.facebook.com/groups/yeuchomeovn/', type: 'GROUP', description: 'Cộng đồng thú cưng vui nhộn', category: 'PETS' },
      { id: 'chikhenphimhay', name: 'Khen Phim Hay - Chê Phim Dở', url: 'https://www.facebook.com/groups/chikhenphimhay', type: 'GROUP', description: 'Review phim & điện ảnh', category: 'PHIM' },
      { id: 'cuongphimreview', name: 'Cuồng Phim Review (Fanpage)', url: 'https://www.facebook.com/cuongphimreview', type: 'PAGE', description: 'Review phim hot & điện ảnh chiếu rạp', category: 'PHIM' },
      { id: 'xemphimgixemvoi', name: 'Xem phim gì? Xem với!', url: 'https://www.facebook.com/groups/xemphimgixemvoi/', type: 'GROUP', description: 'Cộng đồng mọt phim', category: 'PHIM' },
      { id: 'truyenhaymoingay', name: 'Truyện Hay Mỗi Ngày', url: 'https://www.facebook.com/groups/1572019446274472', type: 'GROUP', description: 'Tâm sự & truyện đời' },
    ];
    try {
      const raw = localStorage.getItem('toolzutter_target_sources');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const existingUrls = new Set(parsed.map((it: any) => it.url));
          const missingDefaults = defaultList.filter((d) => !existingUrls.has(d.url));
          return [...missingDefaults, ...parsed];
        }
      }
    } catch {}
    return defaultList;
  });

  // Quét tự động toàn bộ Kho Nguồn chạy ở backend (kể cả khi đóng trình duyệt), bài mới vào hộp chờ duyệt
  const [autoScan, setAutoScan] = useState<AutoScanStatus | null>(null);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [redditConfig, setRedditConfig] = useState<RedditConfig | null>(null);
  const [redditModalOpen, setRedditModalOpen] = useState(false);
  const [redditForm, setRedditForm] = useState({ redditSession: '', tokenV2: '', clientId: '', clientSecret: '', username: '' });
  const [redditSaving, setRedditSaving] = useState(false);
  const [redditTestResult, setRedditTestResult] = useState<{ success: boolean; text: string } | null>(null);
  const [redditScanningUrl, setRedditScanningUrl] = useState<string | null>(null);

  // Discover Groups State
  const [groupKeyword, setGroupKeyword] = useState('Review phim');
  const [groupLoading, setGroupLoading] = useState(false);
  const [discoveredGroups, setDiscoveredGroups] = useState<DiscoveredGroup[]>(INITIAL_GROUPS);
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'PHIM' | 'PETS'>('ALL');
  
  // Smart Filters for Discovered Groups
  const [groupMinMembers, setGroupMinMembers] = useState<number>(50000); // Mặc định chỉ lấy nhóm trên 50K TV
  const [filterSpamGroups, setFilterSpamGroups] = useState<boolean>(true); // Lọc bỏ nhóm tìm đồ lạc / cứu trợ / thanh lý
  const [publicOnly, setPublicOnly] = useState<boolean>(true); // Chỉ nhóm công khai
  const [groupSearchLimit, setGroupSearchLimit] = useState<number>(50); // Số lượng nhóm muốn quét: 25, 50, 80, 100
  const [groupViewMode, setGroupViewMode] = useState<'TABLE' | 'GRID'>('TABLE'); // Mặc định Bảng tra cứu gọn gàng
  const [quickTextModalOpen, setQuickTextModalOpen] = useState<boolean>(false);

  const [savedGroups, setSavedGroups] = useState<DiscoveredGroup[]>(() => {
    try {
      const raw = localStorage.getItem('toolzutter_saved_hunted_groups');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Search by Keyword Controls (Direct Posts Hunt)
  const [keyword, setKeyword] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'ALL' | 'THREADS' | 'FACEBOOK' | 'TIKTOK'>('ALL');
  const [limit, setLimit] = useState<number>(20);
  const [minReactionsFilter, setMinReactionsFilter] = useState<number>(20);
  const [mediaFilter, setMediaFilter] = useState<'ALL' | 'MEDIA_ONLY' | 'IMAGE_ONLY' | 'VIDEO_ONLY'>('MEDIA_ONLY');
  const [sortBy, setSortBy] = useState<'VIRAL' | 'NEWEST'>('VIRAL');

  // Target URL
  const [customTargetUrl, setCustomTargetUrl] = useState('');
  const [currentScanningGroup, setCurrentScanningGroup] = useState<DiscoveredGroup | null>(null);

  // Results State
  const [loading, setLoading] = useState(false);
  const [posts, setPosts] = useState<HuntedPost[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hideAlreadyImported, setHideAlreadyImported] = useState<boolean>(false);
  const [postDateFilter, setPostDateFilter] = useState<'ALL' | 'TODAY' | '3_DAYS' | '7_DAYS'>('ALL');

  // Tinder Review Mode State
  const [tinderModalOpen, setTinderModalOpen] = useState(false);
  const [tinderIndex, setTinderIndex] = useState(0);
  const [expandedCardIds, setExpandedCardIds] = useState<Set<string>>(new Set());

  const toggleExpandCard = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Helper lọc bỏ các chuỗi rác obfuscation / anti-scraping của Facebook (VD: esodnpotrSu5L8hcmg6rhr9Og0...)
  const isScrambledText = (text?: string) => {
    if (!text) return false;
    const words = text.trim().split(/\s+/);
    return (
      words.some(
        (w) => w.length >= 12 && /[a-zA-Z]/.test(w) && /\d/.test(w) && !/^https?:\/\//i.test(w)
      ) && text.length < 150
    );
  };

  const getDisplayCaption = (post: HuntedPost) => {
    if (post.caption && !isScrambledText(post.caption)) {
      return post.caption;
    }
    return `Bài đăng hình ảnh từ ${post.sourceGroup || post.author || 'Fanpage'}`;
  };

  // Modal Image Preview
  const [previewMediaModal, setPreviewMediaModal] = useState<{ open: boolean; mediaUrls: string[]; title: string }>({
    open: false,
    mediaUrls: [],
    title: '',
  });

  // Batch queue modal
  const [queueModalOpen, setQueueModalOpen] = useState(false);
  const [queueSchedule, setQueueSchedule] = useState<ScheduleValue>({ mode: 'QUEUE' });
  const [queueSubmitting, setQueueSubmitting] = useState(false);

  // Gemini AI Rewrite Modal State
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiTargetPost, setAiTargetPost] = useState<HuntedPost | null>(null);
  const [aiMode, setAiMode] = useState<string>('HOOK');
  const [aiTargetPlatform, setAiTargetPlatform] = useState<'FACEBOOK' | 'THREADS'>('FACEBOOK');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResultText, setAiResultText] = useState('');

  // Batch Gemini Rewrite Modal
  const [batchAiModalOpen, setBatchAiModalOpen] = useState(false);
  const [batchAiMode, setBatchAiMode] = useState<string>('REWRITE');
  const [batchAiPlatform, setBatchAiPlatform] = useState<'FACEBOOK' | 'THREADS'>('FACEBOOK');
  const [batchAiLoading, setBatchAiLoading] = useState(false);
  const [batchAiProgress, setBatchAiProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  // Gemini AI Curation State (Phân tích, chấm điểm & lọc bài rác)
  const [aiCurating, setAiCurating] = useState(false);
  const [autoGeminiCurate, setAutoGeminiCurate] = useState(true);
  const [onlyShowHighQualityAi, setOnlyShowHighQualityAi] = useState(false);
  const [aiKeySettingsOpen, setAiKeySettingsOpen] = useState(false);

  // Get active cookie account for FB if available
  const { data: connections = [] } = useQuery({
    queryKey: ['socialAccounts'],
    queryFn: async () => (await api.get('/connections')).data as any[],
  });

  const activeCookieAcc = useMemo(() => {
    // Sắp xếp ưu tiên các tài khoản được cập nhật mới nhất (updatedAt DESC hoặc id DESC)
    // để tránh lấy phải bản ghi cũ trùng lặp chưa được làm mới cookie
    const sorted = [...connections].sort((a, b) => {
      const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : (a.id || 0);
      const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : (b.id || 0);
      return timeB - timeA;
    });
    return (
      sorted.find((a) => a.accessToken && a.accessToken.trim().length > 0 && a.tokenStatus === 'OK' && a.pageName?.toLowerCase().includes('làm sen')) ||
      sorted.find((a) => a.accessToken && a.accessToken.trim().length > 0 && a.tokenStatus === 'OK') ||
      sorted.find((a) => a.accessToken && a.accessToken.trim().length > 0)
    );
  }, [connections]);

  // Helpers định dạng số lượng thành viên sạch đẹp
  const formatMemberDisplay = (g: DiscoveredGroup) => {
    if (g.memberCount && g.memberCount > 0) {
      if (g.memberCount >= 1000000) return (g.memberCount / 1000000).toFixed(1).replace('.0', '') + 'M TV';
      if (g.memberCount >= 1000) return Math.round(g.memberCount / 1000) + 'K TV';
      return g.memberCount.toLocaleString('vi-VN') + ' TV';
    }
    const raw = g.memberLine || '';
    const match = raw.match(/([0-9.,]+[KkMm]?)\s*(thành viên|members|Follower|người|bạn)?/i);
    if (match) {
      return match[1].toUpperCase() + ' TV';
    }
    return '150K TV';
  };

  const formatActivityDisplay = (g: DiscoveredGroup) => {
    if (g.postsPerDay && g.postsPerDay > 0) {
      return `${g.postsPerDay}+ bài/ngày`;
    }
    const clean = (g.postFreqLine || '').replace(/^Công khai\s*[·•]\s*|bài viết\//gi, '').trim();
    if (clean) return clean.includes('ngày') ? clean : `${clean}/ngày`;
    return 'Rất sôi nổi';
  };

  // Handle Search Groups by Keyword
  const handleSearchGroups = async (overrideKw?: string, overrideLimit?: number) => {
    const q = (overrideKw !== undefined ? overrideKw : groupKeyword).trim();
    if (!q) {
      message.warning('Vui lòng nhập từ khoá tìm nhóm (ví dụ: review phim, chó mèo, ẩm thực...)!');
      return;
    }
    if (overrideKw !== undefined) {
      setGroupKeyword(overrideKw);
    }
    // Tự động bỏ lọc chuyên đề để hiển thị toàn bộ kết quả tìm kiếm mới
    setCategoryFilter('ALL');

    const currentLimit = overrideLimit || groupSearchLimit;
    setGroupLoading(true);
    try {
      const res = await api.post('/tools/hunt-groups-by-keyword', {
        keyword: q,
        cookieString: activeCookieAcc?.accessToken || undefined,
        limit: currentLimit,
        minMembers: groupMinMembers,
      });
      if (res.data?.success && Array.isArray(res.data?.groups) && res.data.groups.length > 0) {
        setDiscoveredGroups(res.data.groups);
        message.success(`🎯 Đã tìm thấy ${res.data.groups.length} nhóm Facebook chất lượng cho từ khoá "${q}"!`);
      } else {
        message.warning('Không tìm thấy thêm nhóm nào khớp với từ khoá này. Bạn có thể thử từ khoá khác!');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.error || err?.message || 'Lỗi khi tìm kiếm nhóm');
    } finally {
      setGroupLoading(false);
    }
  };

  // Sao chép nhanh danh sách nhóm dạng "Link - Tên - Member"
  const handleCopyGroupsList = () => {
    if (filteredGroups.length === 0) {
      message.warning('Danh sách nhóm đang trống!');
      return;
    }
    const lines = filteredGroups.map((g, idx) => {
      const mem = formatMemberDisplay(g);
      const priv = g.privacy || 'Công khai';
      return `${idx + 1}. ${g.url} - ${g.name} - ${mem} (${priv})`;
    });
    navigator.clipboard.writeText(lines.join('\n'));
    message.success(`📋 Đã sao chép ${filteredGroups.length} nhóm (Link - Tên - Member) vào Clipboard!`);
  };

  // Sao chép dạng Bảng Tab để dán thẳng vào Excel / Google Sheets
  const handleCopyGroupsExcel = () => {
    if (filteredGroups.length === 0) {
      message.warning('Danh sách nhóm đang trống!');
      return;
    }
    const header = "STT\tĐường Dẫn (Link)\tTên Nhóm Facebook\tThành Viên\tQuyền Riêng Tư\n";
    const rows = filteredGroups.map((g, idx) => {
      const mem = formatMemberDisplay(g);
      const priv = g.privacy || 'Công khai';
      return `${idx + 1}\t${g.url}\t${g.name}\t${mem}\t${priv}`;
    }).join('\n');
    navigator.clipboard.writeText(header + rows);
    message.success(`📊 Đã sao chép bảng ${filteredGroups.length} nhóm (Dán Ctrl+V thẳng vào Excel/Sheets)!`);
  };

  // Xuất trực tiếp file Excel (.xlsx) tải về máy tính
  const handleExportExcelFile = async () => {
    if (filteredGroups.length === 0) {
      message.warning('Danh sách nhóm đang trống để xuất file!');
      return;
    }
    try {
      const data = filteredGroups.map((g, idx) => ({
        'STT': idx + 1,
        'Tên Nhóm Facebook': g.name,
        'Đường Dẫn (Link Group)': g.url,
        'Số Thành Viên': formatMemberDisplay(g),
        'Quy Mô (Member)': g.memberCount || 0,
        'Quyền Riêng Tư': g.privacy || 'Công khai',
        'Phân Loại / Huy Hiệu': g.qualityBadge || (g.category === 'PHIM' ? 'Phim & Điện Ảnh' : g.category === 'PETS' ? 'Thú Cưng' : 'Cộng đồng'),
      }));

      // Nạp xlsx khi cần để không kéo cả thư viện vào chunk ViralHunter
      const { utils, writeFile } = await import('xlsx');
      const worksheet = utils.json_to_sheet(data);
      worksheet['!cols'] = [
        { wch: 6 },  // STT
        { wch: 40 }, // Tên Nhóm Facebook
        { wch: 50 }, // Đường Dẫn
        { wch: 18 }, // Số Thành Viên
        { wch: 18 }, // Quy Mô (Member)
        { wch: 16 }, // Quyền Riêng Tư
        { wch: 24 }, // Phân Loại / Huy Hiệu
      ];

      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, 'DS_Group_Facebook');

      const safeKw = (groupKeyword || 'groups').trim().replace(/[^\p{L}\p{N}_-]/gu, '_');
      const filename = `DS_Group_${safeKw}_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`;
      writeFile(workbook, filename);
      message.success(`📥 Đã xuất file Excel thành công: ${filename} (${filteredGroups.length} nhóm)!`);
    } catch (err: any) {
      message.error(`Lỗi khi xuất file Excel: ${err?.message || 'Không thể tạo file'}`);
    }
  };

  // Filtered Groups based on smart quality filters & Idea Topic
  const filteredGroups = useMemo(() => {
    let list = [...discoveredGroups];

    // Chỉ áp dụng categoryFilter khi đang xem danh sách mẫu (INITIAL_GROUPS)
    if (categoryFilter !== 'ALL' && discoveredGroups === INITIAL_GROUPS) {
      list = list.filter((g) => g.category === categoryFilter);
    }

    if (publicOnly && categoryFilter === 'ALL') {
      list = list.filter((g) => g.privacy === 'Công khai' || g.privacy === 'TikTok Channel');
    }

    if (groupMinMembers > 0 && categoryFilter === 'ALL') {
      list = list.filter((g) => {
        if (g.memberCount && g.memberCount > 0) return g.memberCount >= groupMinMembers;
        const line = g.memberLine || '';
        if (groupMinMembers >= 100000) {
          return line.includes('K') && !line.includes('1') && !line.includes('2') && !line.includes('3') && !line.includes('8,6K');
        }
        return true;
      });
    }

    if (filterSpamGroups) {
      list = list.filter((g) => {
        const lower = g.name.toLowerCase();
        return !/thất lạc|tìm chó|tìm mèo lạc|cứu trợ|cho tặng|thanh lý|nhận nuôi|phòng trọ/i.test(lower);
      });
    }

    // Luôn ưu tiên xếp hạng nhóm chất lượng cao nhất lên đầu (#1 Siêu Group)
    list.sort((a, b) => {
      const scoreA = a.qualityScore || 0;
      const scoreB = b.qualityScore || 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return (b.memberCount || 0) - (a.memberCount || 0);
    });

    return list;
  }, [discoveredGroups, groupMinMembers, filterSpamGroups, publicOnly, categoryFilter]);

  // Toggle Save Group into favorites
  const toggleSaveGroup = (group: DiscoveredGroup) => {
    setSavedGroups((prev) => {
      const exists = prev.some((g) => g.url === group.url || g.id === group.id);
      let updated: DiscoveredGroup[];
      if (exists) {
        updated = prev.filter((g) => g.url !== group.url && g.id !== group.id);
        message.info(`Đã bỏ lưu nhóm "${group.name}"`);
      } else {
        updated = [group, ...prev];
        message.success(`⭐ Đã lưu nhóm "${group.name}" vào danh sách nhóm yêu thích!`);
      }
      localStorage.setItem('toolzutter_saved_hunted_groups', JSON.stringify(updated));
      return updated;
    });
  };

  // Gemini AI Curate Posts (Thẩm định, chấm điểm 1-100 & lọc rác)
  const handleGeminiCuratePosts = async (postsToCurate?: HuntedPost[]) => {
    const targetPosts = postsToCurate || posts;
    if (!targetPosts || targetPosts.length === 0) {
      message.warning('Chưa có bài viết nào để Gemini thẩm định!');
      return;
    }
    const geminiKey = getStoredGeminiKeys();
    if (!geminiKey) {
      setAiKeySettingsOpen(true);
      message.warning('Vui lòng cài đặt ít nhất 1 Gemini API Key để AI thẩm định & chấm điểm!');
      return;
    }
    setAiCurating(true);
    message.loading({
      content: '💎 Đang dùng Gemini API thẩm định, chấm điểm chất lượng (1-100) và lọc bài rác...',
      key: 'gemini-curate-action',
      duration: 6,
    });
    try {
      const res = await api.post('/tools/gemini-curate-posts', {
        posts: targetPosts,
        topic: keyword || currentScanningGroup?.name || 'Review phim & tin hot',
        apiKey: geminiKey || undefined,
      });

      if (res.data?.success && Array.isArray(res.data?.items)) {
        const curatedList: HuntedPost[] = res.data.items;
        setPosts(curatedList);
        const topQualityIds = curatedList
          .filter((p) => (p.aiScore || 0) >= 70 && !p.isSpam)
          .slice(0, 10)
          .map((p) => p.id);
        if (topQualityIds.length > 0) {
          setSelectedIds(new Set(topQualityIds));
        }
        message.success({
          content: `💎 Gemini đã thẩm định xong ${curatedList.length} bài! Các bài chất lượng cao & hook gợi ý đã sẵn sàng.`,
          key: 'gemini-curate-action',
        });
      } else {
        message.warning({
          content: res.data?.error || 'Gemini không trả về kết quả thẩm định.',
          key: 'gemini-curate-action',
        });
      }
    } catch (err: any) {
      message.error({
        content: err?.response?.data?.error || err?.message || 'Lỗi khi gọi Gemini thẩm định bài',
        key: 'gemini-curate-action',
      });
    } finally {
      setAiCurating(false);
    }
  };

  const applySuggestedHook = (post: HuntedPost) => {
    if (!post.suggestedHook) return;
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id === post.id) {
          const newCaption = `${post.suggestedHook}\n\n${p.caption}`;
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

  // Trigger Hunt Posts directly from a selected group or TikTok channel
  const handleScanPostsFromGroup = async (group: DiscoveredGroup) => {
    setCurrentScanningGroup(group);
    setCustomTargetUrl(group.url);
    setKeyword('');
    setMinReactionsFilter(0); // Lấy toàn bộ bài viết từ nhóm/kênh và sắp xếp theo tương tác cao nhất
    setHunterMode('HUNT_POSTS');
    setLoading(true);

    if (group.url.includes('tiktok.com') || group.privacy === 'TikTok Channel') {
      setPlatformFilter('TIKTOK');
      message.loading({
        content: `🔥 Đang kết nối vào kênh TikTok "${group.name}" và cào các video triệu view mới nhất...`,
        key: 'scan-group-action',
        duration: 3,
      });

      try {
        const res = await api.post('/tools/hunt-tiktok-channel', {
          handle: group.url,
          limit: 30,
        });

        if (res.data?.success && Array.isArray(res.data?.items) && res.data.items.length > 0) {
          const tiktokItems: HuntedPost[] = res.data.items.map((it: any) => ({
            id: it.id,
            url: it.url,
            caption: it.desc || it.title || '',
            mediaUrls: it.cover ? [it.cover] : [],
            previewCover: it.cover,
            videoUrl: it.url,
            hasVideo: true,
            mediaType: 'VIDEO' as const,
            mediaCount: 1,
            author: it.channel || group.name,
            reactions: it.likes || 0,
            comments: it.comments || 0,
            shares: 0,
            viralScore: (it.likes || 0) + (it.views ? Math.round(it.views / 20) : 0),
            isViral: (it.likes || 0) > 100 || (it.views || 0) > 5000,
            platform: 'TIKTOK' as const,
            sourceGroup: group.name,
            isAlreadyImported: Boolean(it.isAlreadyImported),
            postStatus: it.postStatus,
          }));
          tiktokItems.sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));
          setPosts(tiktokItems);
          const validNewPosts = tiktokItems.filter((it) => !it.isAlreadyImported);
          setSelectedIds(new Set((validNewPosts.length > 0 ? validNewPosts : tiktokItems).slice(0, 10).map((it) => it.id)));
          const dupCount = Number(res.data.alreadyImportedCount) || (tiktokItems.length - validNewPosts.length);
          message.success({
            content: `🎉 Đã cào được ${tiktokItems.length} video từ kênh TikTok "${group.name}"!${dupCount > 0 ? ` (Tự động bỏ chọn ${dupCount} video đã từng đăng)` : ''}`,
            key: 'scan-group-action',
          });
          if (autoGeminiCurate) {
            handleGeminiCuratePosts(tiktokItems);
          }
        } else {
          message.warning({
            content: `Không tìm thấy video nào từ kênh TikTok này.`,
            key: 'scan-group-action',
          });
        }
      } catch (err: any) {
        message.error({
          content: err?.response?.data?.error || err?.message || 'Lỗi khi quét kênh TikTok',
          key: 'scan-group-action',
        });
      } finally {
        setLoading(false);
      }
      return;
    }

    setPlatformFilter('FACEBOOK');
    message.loading({
      content: `🔥 Đang kết nối vào "${group.name}" và cào các bài viết mới & tương tác cao nhất...`,
      key: 'scan-group-action',
      duration: 3,
    });

    try {
      const res = await api.post(
        '/tools/hunt-facebook-group',
        {
          groupUrl: group.url,
          limit: 20,
          minReactions: 0,
          sortViral: true,
          cookieString: activeCookieAcc?.accessToken || undefined,
        },
        { timeout: 320000 }
      );

      if (res.data?.success && Array.isArray(res.data?.items) && res.data.items.length > 0) {
        const fbItems: HuntedPost[] = res.data.items.map((it: any) => ({
          ...it,
          mediaUrls: fbMediaUrls(it),
          platform: 'FACEBOOK' as const,
          sourceGroup: group.name,
        }));
        fbItems.sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));
        setPosts(fbItems);
        const validNewPosts = fbItems.filter((it) => !it.isAlreadyImported);
        setSelectedIds(new Set((validNewPosts.length > 0 ? validNewPosts : fbItems).slice(0, 10).map((it) => it.id)));
        const dupCount = fbItems.length - validNewPosts.length;
        message.success({
          content: `🎉 Đã cào được ${fbItems.length} bài viết từ nhóm "${group.name}"!${dupCount > 0 ? ` (Tự động bỏ chọn ${dupCount} bài đã từng đăng)` : ''}`,
          key: 'scan-group-action',
        });
        if (autoGeminiCurate) {
          handleGeminiCuratePosts(fbItems);
        }
      } else {
        message.warning({
          content: `Nhóm này có thể chưa có bài tương tác Like > 20 trong các bài gần nhất, hãy thử giảm mức lọc hoặc quét nhóm khác!`,
          key: 'scan-group-action',
        });
      }
    } catch (err: any) {
      message.error({
        content: err?.response?.data?.error || err?.message || 'Lỗi khi quét nhóm Facebook',
        key: 'scan-group-action',
      });
    } finally {
      setLoading(false);
    }
  };

  // Direct Hunt Posts across platform(s) by KEYWORD
  const handleHunt = async () => {
    const q = keyword.trim();
    if (!q && !customTargetUrl.trim()) {
      message.warning('Vui lòng nhập từ khoá muốn săn (ví dụ: review phim, ẩm thực, tâm sự...)!');
      return;
    }

    setLoading(true);
    let combinedItems: HuntedPost[] = [];

    try {
      const tasks: Promise<any>[] = [];

      // Threads Task
      if (platformFilter === 'ALL' || platformFilter === 'THREADS') {
        tasks.push(
          api
            .post(
              '/tools/hunt-threads',
              {
                keyword: q || undefined,
                targetUrl: customTargetUrl.includes('threads') ? customTargetUrl.trim() : undefined,
                limit: platformFilter === 'ALL' ? Math.ceil(limit / 2) : limit,
                minReactions: minReactionsFilter,
                sortViral: true,
              },
              { timeout: 120000 }
            )
            .then((res) => {
              if (res.data?.success && Array.isArray(res.data?.items)) {
                return (res.data.items as any[]).map((it) => ({
                  ...it,
                  platform: 'THREADS' as const,
                }));
              }
              return [];
            })
            .catch((e) => {
              console.warn('Lỗi cào Threads:', e.message);
              return [];
            })
        );
      }

      // Facebook Task
      if (platformFilter === 'ALL' || platformFilter === 'FACEBOOK') {
        tasks.push(
          api
            .post(
              '/tools/hunt-facebook-group',
              {
                keyword: q || undefined,
                groupUrl: customTargetUrl.includes('facebook') ? customTargetUrl.trim() : undefined,
                limit: platformFilter === 'ALL' ? Math.ceil(limit / 2) : limit,
                minReactions: minReactionsFilter,
                sortViral: true,
                cookieString: activeCookieAcc?.accessToken || undefined,
              },
              { timeout: 180000 }
            )
            .then((res) => {
              if (res.data?.success && Array.isArray(res.data?.items)) {
                return (res.data.items as any[]).map((it) => ({
                  ...it,
                  mediaUrls: fbMediaUrls(it),
                  platform: 'FACEBOOK' as const,
                }));
              }
              return [];
            })
            .catch((e) => {
              console.warn('Lỗi cào Facebook:', e.message);
              return [];
            })
        );
      }

      // TikTok Task
      if (platformFilter === 'ALL' || platformFilter === 'TIKTOK' || customTargetUrl.includes('tiktok.com')) {
        const targetHandle = customTargetUrl.includes('tiktok.com') ? customTargetUrl.trim() : q;
        if (targetHandle) {
          tasks.push(
            api
              .post(
                '/tools/hunt-tiktok-channel',
                {
                  handle: targetHandle,
                  limit: platformFilter === 'ALL' ? Math.ceil(limit / 2) : limit,
                },
                { timeout: 90000 }
              )
              .then((res) => {
                if (res.data?.success && Array.isArray(res.data?.items)) {
                  return (res.data.items as any[]).map((it) => ({
                    id: it.id,
                    url: it.url,
                    caption: it.desc || it.title || '',
                    mediaUrls: it.cover ? [it.cover] : [],
                    previewCover: it.cover,
                    videoUrl: it.url,
                    hasVideo: true,
                    mediaType: 'VIDEO' as const,
                    mediaCount: 1,
                    author: it.channel || 'TikTok Creator',
                    reactions: it.likes || 0,
                    comments: it.comments || 0,
                    shares: 0,
                    viralScore: (it.likes || 0) + (it.views ? Math.round(it.views / 20) : 0),
                    isViral: (it.likes || 0) > 100 || (it.views || 0) > 5000,
                    platform: 'TIKTOK' as const,
                    sourceGroup: it.channel || 'TikTok',
                    isAlreadyImported: Boolean(it.isAlreadyImported),
                    postStatus: it.postStatus,
                  }));
                }
                return [];
              })
              .catch((e) => {
                console.warn('Lỗi cào TikTok:', e.message);
                return [];
              })
          );
        }
      }

      const results = await Promise.all(tasks);
      results.forEach((arr) => {
        if (Array.isArray(arr)) combinedItems.push(...arr);
      });

      if (combinedItems.length > 0) {
        combinedItems.sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));
        setPosts(combinedItems);

        const validNew = combinedItems.filter((it) => !it.isAlreadyImported);
        const topIds = (validNew.length > 0 ? validNew : combinedItems).slice(0, 10).map((it) => it.id);
        setSelectedIds(new Set(topIds));

        const viralCount = combinedItems.filter((it) => it.isViral || (it.viralScore || 0) > 20).length;
        const dupCount = combinedItems.length - validNew.length;
        message.success(
          `🔥 Đã tìm thấy ${combinedItems.length} bài viết khớp từ khoá "${q || 'Hot'}"! Có ${viralCount} bài tương tác cao.${
            dupCount > 0 ? ` (Tự động bỏ chọn ${dupCount} bài đã từng đăng)` : ''
          }`
        );
        if (autoGeminiCurate) {
          handleGeminiCuratePosts(combinedItems);
        }
      } else {
        message.warning('Không tìm thấy bài viết nào khớp với từ khoá này. Hãy thử từ khoá phổ biến hơn!');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.error || err?.message || 'Lỗi khi quét bài viết');
    } finally {
      setLoading(false);
    }
  };

  // ── Thao tác cào nguồn mục tiêu (Tab 3) ──
  const handleScanTargetSource = async (overrideUrl?: string, overrideName?: string) => {
    const rawUrl = (overrideUrl !== undefined ? overrideUrl : targetSourceUrl).trim();
    if (!rawUrl) {
      message.warning('Vui lòng nhập link Facebook Group hoặc Fanpage mục tiêu!');
      return;
    }
    // Subreddit không cào qua worker Playwright: lưu vào Kho Nguồn rồi để backend lấy qua Reddit API
    if (overrideUrl === undefined ? targetPlatform === 'REDDIT' || isRedditSourceInput(rawUrl) : isRedditSourceInput(rawUrl)) {
      const existing = targetSources.find((s) => s.type === 'REDDIT' && s.url === rawUrl);
      if (existing) {
        await handleScanRedditSource(existing);
        return;
      }
      const saved = await handleSaveTargetSource();
      if (saved) await handleScanRedditSource(saved);
      return;
    }
    if (overrideUrl !== undefined) {
      setTargetSourceUrl(overrideUrl);
    }
    if (overrideName !== undefined) {
      setTargetSourceName(overrideName);
    }

    const nameToDisplay = overrideName || targetSourceName || rawUrl;
    setLoading(true);
    message.loading({
      content: `🔥 Đang kết nối vào "${nameToDisplay}" và cào các bài viết mới nhất...`,
      key: 'scan-target-action',
      duration: 3,
    });

    try {
      let dateFrom: string | undefined;
      let dateTo: string | undefined;
      if (targetTimeRange === 'TODAY') {
        dateFrom = dayjs().format('YYYY-MM-DD');
        dateTo = dayjs().format('YYYY-MM-DD');
      } else if (targetTimeRange === '3_DAYS') {
        dateFrom = dayjs().subtract(3, 'day').format('YYYY-MM-DD');
        dateTo = dayjs().format('YYYY-MM-DD');
      } else if (targetTimeRange === '7_DAYS') {
        dateFrom = dayjs().subtract(7, 'day').format('YYYY-MM-DD');
        dateTo = dayjs().format('YYYY-MM-DD');
      }

      const res = await api.post(
        '/tools/hunt-facebook-group',
        {
          groupUrl: rawUrl,
          limit: targetLimit,
          minReactions: targetMinReactions,
          sortViral: targetSortOrder === 'VIRAL',
          keyword: targetKeywordFilter.trim() || undefined,
          dateFrom,
          dateTo,
          cookieString: activeCookieAcc?.accessToken || undefined,
        },
        { timeout: 320000 }
      );

      if (res.data?.success && Array.isArray(res.data?.items) && res.data.items.length > 0) {
        const fbItems: HuntedPost[] = res.data.items.map((it: any) => ({
          ...it,
          mediaUrls: fbMediaUrls(it),
          platform: 'FACEBOOK' as const,
          sourceGroup: nameToDisplay,
        }));

        if (targetSortOrder === 'NEWEST') {
          fbItems.sort((a, b) => {
            const timeA = dayjs(a.publishedAt || a.postedAt || a.postedTime || 0).valueOf();
            const timeB = dayjs(b.publishedAt || b.postedAt || b.postedTime || 0).valueOf();
            return timeB - timeA;
          });
        } else {
          fbItems.sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));
        }

        setPosts(fbItems);
        const validNewPosts = fbItems.filter((it) => !it.isAlreadyImported);
        setSelectedIds(new Set((validNewPosts.length > 0 ? validNewPosts : fbItems).slice(0, 10).map((it) => it.id)));
        const dupCount = fbItems.length - validNewPosts.length;
        const timeNote = targetTimeRange === 'TODAY' ? ' (trong hôm nay)' : targetTimeRange === '3_DAYS' ? ' (3 ngày qua)' : '';
        message.success({
          content: `🎉 Đã cào được ${fbItems.length} bài viết từ "${nameToDisplay}"${timeNote}!${dupCount > 0 ? ` (Tự động bỏ chọn ${dupCount} bài đã từng đăng)` : ''}`,
          key: 'scan-target-action',
          duration: 4,
        });

        if (targetTimeRange === 'TODAY' && fbItems.length <= 2) {
          message.info({
            content: `💡 Nguồn này hôm nay mới đăng ${fbItems.length} bài. Nếu muốn lấy thêm các bài cũ hơn hôm qua/hôm kia, anh có thể chọn ô "Lấy bài" sang "3 ngày gần đây" hoặc "Tất cả bài" nhé!`,
            duration: 6,
          });
        }

        setTimeout(() => {
          document.getElementById('posts-results-section')?.scrollIntoView({ behavior: 'smooth' });
        }, 300);
      } else {
        message.warning({
          content: res.data?.error || `Không tìm thấy bài viết nào từ "${nameToDisplay}". Vui lòng kiểm tra lại link hoặc cookie Facebook.`,
          key: 'scan-target-action',
          duration: 4,
        });
      }
    } catch (err: any) {
      console.error('Lỗi cào nguồn mục tiêu:', err);
      message.error({
        content: err?.response?.data?.error || err?.message || 'Có lỗi khi kết nối và cào dữ liệu từ nguồn mục tiêu.',
        key: 'scan-target-action',
      });
    } finally {
      setLoading(false);
    }
  };

  const persistLocalSources = (list: TargetSourceItem[]) => {
    try {
      localStorage.setItem('toolzutter_target_sources', JSON.stringify(list));
    } catch {}
  };

  const loadTargetSources = async () => {
    try {
      // Chuyển các nguồn chỉ có trong trình duyệt này (lưu trước khi có CSDL, chưa có dbId) lên CSDL để backend
      // quét được. Chỉ lấy danh sách đã thực sự lưu — không đẩy danh sách mặc định của trình duyệt mới.
      let localOnly: any[] = [];
      try {
        const raw = localStorage.getItem('toolzutter_target_sources');
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) localOnly = parsed.filter((it: any) => it?.url && !it.dbId);
      } catch {}
      if (localOnly.length > 0) {
        await api.post('/viral-sources/import', localOnly.map(({ name, url, type, description, category }) => ({ name, url, type, description, category })));
      }
      const res = await api.get('/viral-sources');
      const list: any[] = Array.isArray(res.data) ? res.data : [];
      if (list.length > 0) {
        const mapped = list.map(mapDbSource);
        const existingUrls = new Set(mapped.map((it) => it.url));
        const missingHardcoded = [
          { id: 'daomeo_official', name: 'ĐẢO MÈO 🐱 (Cộng đồng lớn nhất)', url: 'https://www.facebook.com/groups/daomeo/', type: 'GROUP' as const, description: 'Cộng đồng Đảo Mèo 2.5M thành viên lớn nhất Việt Nam', category: 'PETS' },
          { id: 'yeuchomeovn', name: 'Đảo Mèo 🐈 Đảo Chó 🐶', url: 'https://www.facebook.com/groups/yeuchomeovn/', type: 'GROUP' as const, description: 'Cộng đồng thú cưng vui nhộn', category: 'PETS' },
        ].filter((d) => !existingUrls.has(d.url));

        const finalMerged = [...missingHardcoded, ...mapped];
        setTargetSources(finalMerged);
        persistLocalSources(finalMerged);

        if (missingHardcoded.length > 0) {
          api.post('/viral-sources/import', missingHardcoded.map(({ name, url, type, description, category }) => ({ name, url, type, description, category }))).catch(() => {});
        }
      } else {
        const defaults = [
          { name: 'ĐẢO MÈO 🐱 (Cộng đồng lớn nhất)', url: 'https://www.facebook.com/groups/daomeo/', type: 'GROUP', description: 'Cộng đồng Đảo Mèo 2.5M thành viên lớn nhất Việt Nam', category: 'PETS' },
          { name: 'Đảo Mèo 🐈 Đảo Chó 🐶', url: 'https://www.facebook.com/groups/yeuchomeovn/', type: 'GROUP', description: 'Cộng đồng thú cưng vui nhộn', category: 'PETS' },
          { name: 'Cuồng Phim Review (Fanpage)', url: 'https://www.facebook.com/cuongphimreview', type: 'PAGE', description: 'Review phim hot & điện ảnh chiếu rạp', category: 'PHIM' },
        ];
        await api.post('/viral-sources/import', defaults).catch(() => {});
        const resReload = await api.get('/viral-sources').catch(() => null);
        if (resReload && Array.isArray(resReload.data) && resReload.data.length > 0) {
          const mapped = resReload.data.map(mapDbSource);
          setTargetSources(mapped);
          persistLocalSources(mapped);
        }
      }
    } catch (err) {
      console.warn('Không tải được Kho Nguồn từ máy chủ, dùng bản lưu trong trình duyệt', err);
    }
  };

  const loadAutoScanStatus = async () => {
    try {
      const res = await api.get('/viral-sources/auto-scan');
      setAutoScan(res.data);
    } catch {}
  };

  useEffect(() => {
    loadTargetSources();
    loadAutoScanStatus();
    const timer = setInterval(loadAutoScanStatus, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Đang quét: cập nhật trạng thái từng nguồn khi lượt quét xong
  useEffect(() => {
    if (autoScan && !autoScan.running) loadTargetSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan?.running]);

  const handleSaveTargetSource = async () => {
    const rawUrl = targetSourceUrl.trim();
    if (!rawUrl) {
      message.warning('Vui lòng nhập link cần lưu!');
      return;
    }
    const isReddit = targetPlatform === 'REDDIT' || isRedditSourceInput(rawUrl);
    const reddit = isReddit ? resolveRedditInput(rawUrl) : null;
    if (reddit?.kind === 'POST') {
      await handleAddRedditPost(reddit.url);
      return undefined;
    }
    const isPage = !rawUrl.includes('/groups/');
    const name = targetSourceName.trim() || (isReddit ? '' : isPage ? 'Fanpage mục tiêu' : 'Group mục tiêu');
    try {
      const res = await api.post('/viral-sources', {
        name: name || undefined,
        url: reddit ? reddit.url : rawUrl,
        type: isReddit ? 'REDDIT' : isPage ? 'PAGE' : 'GROUP',
        description: isReddit ? 'Subreddit Reddit' : 'Nguồn người dùng lưu',
      });
      const saved = mapDbSource(res.data);
      const updated = [saved, ...targetSources.filter(s => s.url !== rawUrl && s.url !== saved.url)];
      setTargetSources(updated);
      persistLocalSources(updated);
      message.success(`Đã lưu nguồn "${saved.name}" vào Kho Nguồn.`);
      if (isReddit && !redditConfig?.configured) {
        openRedditModal();
      }
      return saved;
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Không lưu được nguồn, vui lòng thử lại.');
    }
    return undefined;
  };

  const handleDeleteTargetSource = async (url: string) => {
    const src = targetSources.find(s => s.url === url);
    try {
      if (src?.dbId) await api.delete(`/viral-sources/${src.dbId}`);
      const updated = targetSources.filter(s => s.url !== url);
      setTargetSources(updated);
      persistLocalSources(updated);
      message.info('Đã xóa nguồn khỏi danh sách mục tiêu.');
    } catch {
      message.error('Không xoá được nguồn, vui lòng thử lại.');
    }
  };

  const handleToggleSourceAutoScan = async (source: TargetSourceItem, checked: boolean) => {
    if (!source.dbId) return;
    try {
      const res = await api.patch(`/viral-sources/${source.dbId}`, { autoScan: checked });
      const updated = targetSources.map(s => (s.url === source.url ? mapDbSource(res.data) : s));
      setTargetSources(updated);
      persistLocalSources(updated);
    } catch {
      message.error('Không cập nhật được nguồn.');
    }
  };

  const handleUpdateAutoScan = async (patch: { enabled?: boolean; intervalHours?: number }) => {
    try {
      const res = await api.put('/viral-sources/auto-scan', patch);
      setAutoScan(res.data);
      if (patch.enabled === true) message.success(`Đã bật quét tự động toàn bộ kho mỗi ${res.data.intervalHours} giờ.`);
      if (patch.enabled === false) message.info('Đã tắt quét tự động.');
    } catch {
      message.error('Không lưu được cài đặt quét tự động.');
    }
  };

  const handleScanAllNow = async () => {
    try {
      const res = await api.post('/viral-sources/scan-now');
      setAutoScan(res.data);
      if (res.data?.started) {
        message.success('Đã bắt đầu quét toàn bộ kho ở máy chủ. Bài mới sẽ vào mục "Bài mới chờ duyệt".');
      } else {
        message.info('Đang có một lượt quét chạy, vui lòng đợi xong.');
      }
    } catch {
      message.error('Không bắt đầu quét được.');
    }
  };

  // ── Nguồn Reddit: key app OAuth lưu ở backend, quét qua /viral-sources/{id}/scan ──
  const loadRedditConfig = async () => {
    try {
      const res = await api.get('/viral-sources/reddit-config');
      setRedditConfig(res.data);
      setRedditForm((f) => ({ ...f, username: res.data?.username || f.username }));
    } catch {
      /* backend cũ chưa có API này */
    }
  };

  useEffect(() => {
    loadRedditConfig();
  }, []);

  const handleSaveRedditConfig = async (thenTest: boolean) => {
    setRedditSaving(true);
    setRedditTestResult(null);
    try {
      const res = await api.put('/viral-sources/reddit-config', {
        cookie: [
          redditForm.redditSession.trim() && `reddit_session=${redditForm.redditSession.trim().replace(/^reddit_session=/, '')}`,
          redditForm.tokenV2.trim() && `token_v2=${redditForm.tokenV2.trim().replace(/^token_v2=/, '')}`,
        ].filter(Boolean).join('; ') || undefined,
        clientId: redditForm.clientId.trim() || undefined,
        clientSecret: redditForm.clientSecret.trim() || undefined,
        username: redditForm.username.trim(),
      });
      setRedditConfig(res.data);
      setRedditForm((f) => ({ ...f, redditSession: '', tokenV2: '', clientId: '', clientSecret: '' }));
      if (thenTest) {
        const firstReddit = targetSources.find((s) => s.type === 'REDDIT');
        const t = await api.post('/viral-sources/reddit-config/test', { subreddit: firstReddit?.url });
        setRedditTestResult(
          t.data?.success
            ? { success: true, text: `Kết nối được. Đọc thử ${t.data.count} bài, bài đầu: "${String(t.data.sample || '').slice(0, 120)}"` }
            : { success: false, text: t.data?.error || 'Không kết nối được Reddit.' }
        );
      } else {
        message.success('Đã lưu kết nối Reddit.');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Không lưu được kết nối Reddit.');
    } finally {
      setRedditSaving(false);
    }
  };

  const openRedditModal = () => {
    setRedditTestResult(null);
    setRedditModalOpen(true);
  };

  const handleToggleRedditVideo = async (checked: boolean) => {
    try {
      const res = await api.put('/viral-sources/reddit-config', { includeVideo: checked });
      setRedditConfig(res.data);
    } catch {
      message.error('Không lưu được tùy chọn video Reddit.');
    }
  };

  // Đưa bài đã chọn sang Studio Ảnh Tin để ghép khung ảnh tin + AI soạn tiêu đề. Bài đã có sẵn nội dung
  // và ảnh nên Studio bỏ qua bước cào link (link Reddit không cào được).
  const handleSendToNewsStudio = (singlePost?: HuntedPost) => {
    const list = singlePost ? [singlePost] : selectedPosts;
    if (list.length === 0) return;
    const articles = list.map((p) => {
      const isVideo = p.mediaType === 'VIDEO' || p.hasVideo || !!p.videoUrl;
      const vidUrl = p.videoUrl || (p as any).mediaUrl || (p.mediaUrls && p.mediaUrls.find((u: string) => u.includes('.mp4') || u.includes('v.redd.it')));
      const images = isVideo
        ? (p.previewCover ? [p.previewCover] : vidUrl ? [vidUrl] : [])
        : p.mediaUrls || [];
      const firstLine = (p.caption || '').split('\n').find((l) => l.trim()) || p.url;
      return {
        url: p.url,
        title: firstLine.slice(0, 200),
        content: p.caption || '',
        source: p.subreddit || p.sourceGroup || '',
        images,
        coverImage: images[0],
        preScraped: true,
        videoUrl: vidUrl,
        isVideo,
      };
    });
    markInboxPosts(list, 'QUEUED');
    navigate('/dashboard/news-studio', { state: { studioArticles: articles } });
  };

  const handleAddRedditPost = async (url: string) => {
    if (!redditConfig?.configured) {
      openRedditModal();
      message.info('Dán cookie Reddit trước khi lấy bài.');
      return;
    }
    setRedditScanningUrl(url);
    try {
      const res = await api.post('/viral-sources/reddit-post', { url });
      if (!res.data?.success) {
        message.error(res.data?.error || 'Không lấy được bài Reddit này.');
        return;
      }
      message.success('Đã đưa bài Reddit vào hộp chờ duyệt.');
      setAutoScan((prev) => (prev ? { ...prev, newCount: res.data.newCount ?? prev.newCount } : prev));
      setTargetSourceUrl('');
      await handleOpenInbox();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Không lấy được bài Reddit này.');
    } finally {
      setRedditScanningUrl(null);
    }
  };

  const handleScanRedditSource = async (source: TargetSourceItem) => {
    if (!source.dbId) return;
    if (!redditConfig?.configured) {
      openRedditModal();
      message.info('Dán cookie Reddit trước khi quét subreddit.');
      return;
    }
    setRedditScanningUrl(source.url);
    try {
      const res = await api.post(`/viral-sources/${source.dbId}/scan`);
      if (res.data?.source) {
        setTargetSources((prev) => prev.map((s) => (s.url === source.url ? mapDbSource(res.data.source) : s)));
      }
      if (!res.data?.success) {
        message.error(res.data?.error || `Không quét được ${source.name}.`);
        return;
      }
      message.success(`${source.name}: ${res.data.added} bài mới vào hộp chờ duyệt.`);
      setAutoScan((prev) => (prev ? { ...prev, newCount: res.data.newCount ?? prev.newCount } : prev));
      await handleOpenInbox();
    } catch (err: any) {
      message.error(err?.response?.data?.error || `Không quét được ${source.name}.`);
    } finally {
      setRedditScanningUrl(null);
    }
  };

  const handleOpenInbox = async () => {
    setInboxLoading(true);
    try {
      const res = await api.get('/viral-sources/inbox');
      const items: HuntedPost[] = (Array.isArray(res.data) ? res.data : []).map((it: any) => ({
        ...it,
        id: `inbox_${it.inboxId}`,
        mediaUrls: fbMediaUrls(it),
        platform: 'FACEBOOK' as const,
        reactions: it.reactions || 0,
        comments: it.comments || 0,
        shares: it.shares || 0,
        viralScore: it.viralScore || 0,
        isViral: Boolean(it.isViral),
      }));
      setPlatformFilter('FACEBOOK');
      setPosts(items);
      setSelectedIds(new Set());
      if (items.length === 0) {
        message.info('Chưa có bài mới nào chờ duyệt.');
      } else {
        setTimeout(() => {
          document.getElementById('posts-results-section')?.scrollIntoView({ behavior: 'smooth' });
        }, 300);
      }
    } catch {
      message.error('Không tải được bài mới chờ duyệt.');
    } finally {
      setInboxLoading(false);
    }
  };

  // Đánh dấu bài trong hộp đã xử lý: QUEUED (đã đưa đi đăng) hoặc DISMISSED (bỏ qua) — bỏ khỏi danh sách đang xem
  const markInboxPosts = async (list: HuntedPost[], status: 'QUEUED' | 'DISMISSED') => {
    const ids = list.map((p) => p.inboxId).filter((id): id is number => typeof id === 'number');
    if (ids.length === 0) return;
    try {
      const res = await api.post('/viral-sources/inbox/mark', { ids, status });
      setAutoScan((prev) => (prev ? { ...prev, newCount: res.data?.newCount ?? prev.newCount } : prev));
      const done = new Set(ids);
      setPosts((prev) => prev.filter((p) => !p.inboxId || !done.has(p.inboxId)));
      setSelectedIds(new Set());
    } catch {}
  };

  const handleDismissSelectedInbox = async () => {
    const list = selectedPosts.filter((p) => p.inboxId);
    if (list.length === 0) {
      message.warning('Chưa chọn bài nào để bỏ qua.');
      return;
    }
    await markInboxPosts(list, 'DISMISSED');
    message.info(`Đã bỏ qua ${list.length} bài.`);
  };

  const formatScanTime = (iso?: string | null) => (iso ? dayjs(iso).format('HH:mm DD/MM') : '');

  // Filtered Posts
  const filteredPosts = useMemo(() => {
    let list = [...posts];

    if (hideAlreadyImported) {
      list = list.filter((p) => !p.isAlreadyImported);
    }

    if (postDateFilter !== 'ALL') {
      list = list.filter((p) => isPostInDateRange(p, postDateFilter));
    }

    if (onlyShowHighQualityAi) {
      list = list.filter((p) => !p.aiCurated || ((p.aiScore || 0) >= 70 && !p.isSpam));
    }

    const effectiveMinReactions = hunterMode === 'TARGET_SOURCES' ? targetMinReactions : minReactionsFilter;
    if (effectiveMinReactions > 0) {
      list = list.filter((p) => (p.reactions || 0) >= effectiveMinReactions || (p.viralScore || 0) >= effectiveMinReactions);
    }

    if (mediaFilter === 'MEDIA_ONLY') {
      list = list.filter((p) => (p.mediaCount || 0) > 0 || p.hasVideo || p.mediaType === 'VIDEO' || p.mediaType === 'IMAGE');
    } else if (mediaFilter === 'IMAGE_ONLY') {
      list = list.filter((p) => p.mediaType === 'IMAGE');
    } else if (mediaFilter === 'VIDEO_ONLY') {
      list = list.filter((p) => p.mediaType === 'VIDEO' || p.hasVideo);
    }

    const effectiveSort = hunterMode === 'TARGET_SOURCES' ? targetSortOrder : sortBy;
    if (effectiveSort === 'VIRAL') {
      list.sort((a, b) => {
        if (a.aiCurated && b.aiCurated && a.aiScore !== b.aiScore) {
          return (b.aiScore || 0) - (a.aiScore || 0);
        }
        return (b.viralScore || 0) - (a.viralScore || 0);
      });
    } else if (effectiveSort === 'NEWEST') {
      list.sort((a, b) => {
        const timeA = dayjs(a.publishedAt || a.postedAt || a.postedTime || 0).valueOf();
        const timeB = dayjs(b.publishedAt || b.postedAt || b.postedTime || 0).valueOf();
        return timeB - timeA;
      });
    }

    return list;
  }, [posts, hideAlreadyImported, postDateFilter, minReactionsFilter, mediaFilter, sortBy, onlyShowHighQualityAi, hunterMode, targetMinReactions, targetSortOrder]);

  const selectedPosts = useMemo(() => {
    return filteredPosts.filter((p) => selectedIds.has(p.id));
  }, [filteredPosts, selectedIds]);

  // Tinder Review Handlers & Phím tắt
  const currentTinderPost = useMemo(() => {
    return filteredPosts[tinderIndex] || null;
  }, [filteredPosts, tinderIndex]);

  const handleTinderReject = () => {
    if (tinderIndex < filteredPosts.length - 1) {
      setTinderIndex((prev) => prev + 1);
    } else {
      message.info('Bạn đã duyệt hết danh sách bài viết!');
      setTinderModalOpen(false);
    }
  };

  const handleTinderApprove = () => {
    if (currentTinderPost) {
      setSelectedIds((prev) => new Set([...prev, currentTinderPost.id]));
      message.success({
        content: `💚 Đã chọn bài #${tinderIndex + 1}!`,
        key: 'tinder-approve',
        duration: 1.5,
      });
    }
    if (tinderIndex < filteredPosts.length - 1) {
      setTinderIndex((prev) => prev + 1);
    } else {
      message.success('🎉 Đã duyệt hết danh sách bài viết!');
      setTinderModalOpen(false);
    }
  };

  const handleTinderPrev = () => {
    if (tinderIndex > 0) {
      setTinderIndex((prev) => prev - 1);
    }
  };

  useEffect(() => {
    if (!tinderModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleTinderReject();
      } else if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        handleTinderApprove();
      } else if (e.key === 'Escape') {
        setTinderModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tinderModalOpen, tinderIndex, filteredPosts, currentTinderPost]);

  // Actions
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredPosts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredPosts.map((p) => p.id)));
    }
  };

  const handleExportToPlaywright = () => {
    if (selectedPosts.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 bài viết!');
      return;
    }
    const urls = selectedPosts.map((p) => p.url).join('\n');
    localStorage.setItem('toolzutter_prefill_playwright_urls', urls);
    markInboxPosts(selectedPosts, 'QUEUED');
    navigate('/dashboard/playwright');
    message.success(`🚀 Đã chuyển ${selectedPosts.length} bài sang Đăng tự động!`);
  };

  const handleCopyLinks = () => {
    if (selectedPosts.length === 0) {
      message.warning('Chưa chọn bài viết nào!');
      return;
    }
    const text = selectedPosts.map((p) => p.url).join('\n');
    navigator.clipboard.writeText(text);
    message.success(`📋 Đã copy link của ${selectedPosts.length} bài viết!`);
  };

  const handleBatchAddToQueue = async () => {
    if (selectedPosts.length === 0) return;
    setQueueSubmitting(true);
    try {
      const urls = selectedPosts.map((p) => p.url);
      const res = await api.post('/queue/add-from-urls', {
        urls,
        ...schedulePayload(queueSchedule),
        customCaptions: selectedPosts.map((p) => getDisplayCaption(p)),
        customMediaUrls: selectedPosts.map((p) => (p.mediaUrls || []).join(',')),
      });
      if (res.data?.success || res.status === 200) {
        markInboxPosts(selectedPosts, 'QUEUED');
        message.success(res.data?.message || `Đã đưa ${selectedPosts.length} bài vào hàng đợi.`);
        setQueueModalOpen(false);
      } else {
        message.warning('Đã gửi yêu cầu thêm bài, vui lòng kiểm tra danh sách Lịch đăng.');
        setQueueModalOpen(false);
      }
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Lỗi khi thêm bài vào Hàng đợi');
    } finally {
      setQueueSubmitting(false);
    }
  };

  // Gemini AI Rewrite Single Post
  const handleOpenAiModal = (post: HuntedPost) => {
    setAiTargetPost(post);
    setAiResultText('');
    setAiTargetPlatform(post.platform === 'THREADS' ? 'THREADS' : 'FACEBOOK');
    if (post.sourcePlatform === 'REDDIT') setAiMode('TRANSLATE');
    setAiModalOpen(true);
  };

  const handleExecuteAiRewrite = async () => {
    if (!aiTargetPost?.caption?.trim()) {
      message.warning('Bài viết này không có nội dung chữ để AI viết lại!');
      return;
    }
    const geminiKey = getStoredGeminiKeys();
    if (!geminiKey) {
      setAiKeySettingsOpen(true);
      message.warning('Vui lòng cài đặt ít nhất 1 Gemini API Key để viết lại bài!');
      return;
    }
    setAiLoading(true);
    try {
      const res = await api.post('/tools/gemini-rewrite', {
        content: aiTargetPost.caption,
        mode: aiMode,
        platform: aiTargetPlatform,
        apiKey: geminiKey,
      });
      if (res.data?.success && res.data?.rewritten) {
        setAiResultText(res.data.rewritten);
        message.success('✨ Gemini đã viết lại nội dung thành công!');
      } else {
        message.error(res.data?.error || 'Không nhận được kết quả từ Gemini AI');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.error || err?.message || 'Lỗi khi gọi Gemini AI');
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyAiRewrite = () => {
    if (!aiTargetPost || !aiResultText.trim()) return;
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id === aiTargetPost.id) {
          return {
            ...p,
            originalCaption: p.originalCaption || p.caption,
            caption: aiResultText.trim(),
            aiRewritten: true,
          };
        }
        return p;
      })
    );
    message.success('Đã áp dụng nội dung AI viết lại vào bài viết!');
    setAiModalOpen(false);
  };

  // Batch Gemini AI Rewrite
  const handleOpenBatchAiModal = () => {
    if (selectedPosts.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 bài viết để AI viết lại!');
      return;
    }
    setBatchAiProgress({ current: 0, total: selectedPosts.length });
    if (selectedPosts.every((p) => p.sourcePlatform === 'REDDIT')) setBatchAiMode('TRANSLATE');
    setBatchAiModalOpen(true);
  };

  const handleExecuteBatchAiRewrite = async () => {
    const geminiKey = getStoredGeminiKeys();
    if (!geminiKey) {
      setAiKeySettingsOpen(true);
      message.warning('Vui lòng cài đặt ít nhất 1 Gemini API Key để viết lại hàng loạt!');
      return;
    }
    setBatchAiLoading(true);
    let updatedCount = 0;
    const newPostsMap = new Map<string, string>();

    for (let i = 0; i < selectedPosts.length; i++) {
      const p = selectedPosts[i];
      setBatchAiProgress({ current: i + 1, total: selectedPosts.length });
      if (!p.caption?.trim()) continue;

      try {
        const res = await api.post('/tools/gemini-rewrite', {
          content: p.caption,
          mode: batchAiMode,
          platform: batchAiPlatform,
          apiKey: geminiKey,
        });
        if (res.data?.success && res.data?.rewritten) {
          newPostsMap.set(p.id, res.data.rewritten);
          updatedCount++;
        }
      } catch (e) {
        console.warn(`Lỗi rewrite bài ${p.id}:`, e);
      }
    }

    setPosts((prev) =>
      prev.map((p) => {
        if (newPostsMap.has(p.id)) {
          return {
            ...p,
            originalCaption: p.originalCaption || p.caption,
            caption: newPostsMap.get(p.id)!,
            aiRewritten: true,
          };
        }
        return p;
      })
    );

    setBatchAiLoading(false);
    setBatchAiModalOpen(false);
    message.success(`🎉 Gemini đã xào xong ${updatedCount} bài viết đã chọn!`);
  };

  return (
    <div className="group-hunter-content pb-12 animate-fade-in">
      {/* Box Săn Bài & Tìm Nhóm Chính */}
      <section className="group-hunter-setup">
        {/* Chế độ + cookie đang dùng — 1 hàng gọn, không lặp lại tiêu đề trang */}
        <div className="vh-mode-row">
          <div className="inline-flex p-1 rounded-xl bg-slate-950/80 border border-slate-800/80 backdrop-blur-md gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => setHunterMode('DISCOVER_GROUPS')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 cursor-pointer ${
                hunterMode === 'DISCOVER_GROUPS'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]'
              }`}
            >
              <CompassOutlined className={hunterMode === 'DISCOVER_GROUPS' ? 'text-white' : 'text-slate-400'} />
              <span>Khám phá Group</span>
            </button>

            <button
              type="button"
              onClick={() => setHunterMode('HUNT_POSTS')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 cursor-pointer ${
                hunterMode === 'HUNT_POSTS'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]'
              }`}
            >
              <FireOutlined className={hunterMode === 'HUNT_POSTS' ? 'text-white' : 'text-slate-400'} />
              <span>Săn bài viết</span>
            </button>

            <button
              type="button"
              onClick={() => setHunterMode('TARGET_SOURCES')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 cursor-pointer ${
                hunterMode === 'TARGET_SOURCES'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]'
              }`}
            >
              <AimOutlined className={hunterMode === 'TARGET_SOURCES' ? 'text-white' : 'text-slate-400'} />
              <span>Nguồn chỉ định</span>
            </button>
          </div>
          {activeCookieAcc && (
            <span className="vh-cookie" title="Nick dùng cookie để quét">
              <span className="vh-cookie-dot" />
              {activeCookieAcc.pageName}
            </span>
          )}
        </div>

        {/* ────────── CHẾ ĐỘ 1: TÌM KIẾM GROUP THEO KEYWORD ────────── */}
        {hunterMode === 'DISCOVER_GROUPS' && (
          <div className="p-5 sm:p-6 space-y-4">
            {/* Ô TÌM KIẾM + CHỌN SỐ LƯỢNG QUÉT */}
            <div className="flex flex-col sm:flex-row items-stretch gap-2.5">
              <div className="flex-1 relative">
                <Input
                  size="large"
                  placeholder="Tìm nhóm theo từ khoá"
                  value={groupKeyword}
                  onChange={(e) => setGroupKeyword(e.target.value)}
                  onPressEnter={() => handleSearchGroups()}
                  prefix={<SearchOutlined className="text-slate-400 text-base mr-2" />}
                  allowClear
                  className="!h-11 rounded-xl bg-slate-900/80 border-slate-700/80 hover:border-slate-600 focus:border-blue-500 text-sm font-medium text-white placeholder:text-slate-500 px-3.5"
                />
              </div>

              {/* Lựa chọn số lượng group muốn quét */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-3 h-11 bg-slate-900/80 border border-slate-700/80 rounded-xl">
                  <span className="text-xs text-slate-400 shrink-0">Quét:</span>
                  <Select
                    size="small"
                    value={groupSearchLimit}
                    onChange={(val) => setGroupSearchLimit(val)}
                    variant="borderless"
                    className="w-32 text-xs text-slate-200 font-semibold"
                    options={[
                      { value: 25, label: '25 nhóm' },
                      { value: 50, label: '50 nhóm' },
                      { value: 80, label: '80 nhóm' },
                      { value: 100, label: '100 nhóm' },
                    ]}
                  />
                </div>

                <Button
                  type="primary"
                  size="large"
                  loading={groupLoading}
                  onClick={() => handleSearchGroups()}
                  className="!h-11 px-6 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shrink-0 bg-blue-600 hover:bg-blue-500 border-none shadow-md shadow-blue-600/20 active:scale-[0.99] transition-all"
                >
                  <SearchOutlined className="text-base" /> Tìm nhóm
                </Button>
              </div>
            </div>

            {/* Gợi ý từ khoá nhóm */}
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="text-slate-400 text-xs shrink-0 mr-1">
                Gợi ý:
              </span>
              {['Review phim', 'Yêu chó mèo', 'Review đồ ăn', 'Bất động sản', 'Tâm sự gen z', 'Khởi nghiệp', 'Nghiện nhà đẹp', 'Mẹo vặt'].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleSearchGroups(k)}
                  className={`px-2.5 py-1 rounded-lg text-xs transition-all duration-150 border cursor-pointer ${
                    groupKeyword.toLowerCase() === k.toLowerCase()
                      ? 'bg-blue-600/20 text-blue-300 border-blue-500/40 font-semibold'
                      : 'bg-slate-800/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800 hover:border-slate-700'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>

            {/* Thanh Bộ Lọc Chất Lượng Nhóm */}
            <div className="pt-2.5 border-t border-slate-800/70 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-4 flex-wrap">
                <Segmented
                  size="small"
                  value={categoryFilter}
                  onChange={(v) => {
                    const val = v as typeof categoryFilter;
                    setCategoryFilter(val);
                    if (val === 'PHIM') setGroupKeyword('Review phim');
                    if (val === 'PETS') setGroupKeyword('Yêu chó mèo');
                  }}
                  options={[
                    { value: 'ALL', label: `Tất cả (${discoveredGroups.length})` },
                    { value: 'PHIM', label: 'Phim ảnh' },
                    { value: 'PETS', label: 'Thú cưng' },
                  ]}
                />
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">Quy mô:</span>
                  <Select
                    size="small"
                    value={groupMinMembers}
                    onChange={setGroupMinMembers}
                    className="w-40 text-xs"
                    options={[
                      { value: 0, label: 'Tất cả quy mô' },
                      { value: 50000, label: '> 50K thành viên' },
                      { value: 100000, label: '> 100K thành viên' },
                      { value: 300000, label: '> 300K thành viên' },
                    ]}
                  />
                </div>

                <Checkbox
                  checked={filterSpamGroups}
                  onChange={(e) => setFilterSpamGroups(e.target.checked)}
                  className="text-xs text-slate-300"
                >
                  Lọc nhóm rác
                </Checkbox>

                <Checkbox
                  checked={publicOnly}
                  onChange={(e) => setPublicOnly(e.target.checked)}
                  className="text-xs text-slate-300"
                >
                  Nhóm công khai
                </Checkbox>
              </div>

              <div className="text-xs text-slate-400">
                {filteredGroups.length}/{discoveredGroups.length} nhóm
              </div>
            </div>

            {/* Nhóm đã lưu của người dùng nếu có */}
            {savedGroups.length > 0 && (
              <div className="pt-3 border-t border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[13px] font-bold text-amber-400 flex items-center gap-1.5">
                    <StarFilled /> Nhóm bạn đã lưu ({savedGroups.length}):
                  </span>
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
                  {savedGroups.map((g) => (
                    <div
                      key={g.url}
                      className="shrink-0 bg-slate-900 border border-slate-700/80 rounded-xl p-2.5 flex items-center gap-2.5 hover:border-amber-500/50 transition-all"
                    >
                      <TeamOutlined className="text-blue-400 text-base" />
                      <div className="max-w-[200px]">
                        <div className="text-[13px] font-bold text-slate-100 truncate">{g.name}</div>
                        <div className="text-xs text-slate-300">{g.memberLine}</div>
                      </div>
                      <Button
                        size="middle"
                        type="primary"
                        onClick={() => handleScanPostsFromGroup(g)}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs px-3 border-none"
                      >
                        Quét bài
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ────────── CHẾ ĐỘ 3: CÀO BÀI THEO NGUỒN MỤC TIÊU CHỈ ĐỊNH (GROUP / PAGE) ────────── */}
        {hunterMode === 'TARGET_SOURCES' && (
          <div className="p-5 sm:p-6 space-y-5">
            {/* 1. KHỐI CÀO BÀI TRỰC TIẾP TỪ LINK */}
            <div className="p-4 sm:p-4.5 rounded-2xl bg-black/40 border border-slate-700/60 backdrop-blur-md space-y-3">
              {/* Header của khối cào: Tiêu đề + Nền tảng + Chọn Fanpage */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <LinkOutlined className="text-blue-400" />
                  {targetPlatform === 'REDDIT'
                    ? 'Nhập subreddit, từ khóa hoặc link Reddit:'
                    : 'Nhập link Facebook Group hoặc Fanpage:'}
                </span>

                <div className="flex items-center gap-2 flex-wrap">
                  {connections.length > 0 && (
                    <Select
                      size="small"
                      placeholder="Chọn Fanpage đã kết nối..."
                      className="w-48 text-xs"
                      onChange={(val) => {
                        const selectedConn = connections.find((c: any) => c.platformAccountId === val || c.id === val);
                        if (selectedConn) {
                          const targetUrl = selectedConn.platformAccountId && !selectedConn.platformAccountId.startsWith('http')
                            ? `https://www.facebook.com/${selectedConn.platformAccountId}`
                            : selectedConn.platformAccountId;
                          setTargetSourceUrl(targetUrl);
                          setTargetSourceName(selectedConn.pageName || 'Fanpage của tôi');
                        }
                      }}
                      options={connections
                        .filter((c: any) => c.platform !== 'FACEBOOK_GROUP')
                        .map((c: any) => ({
                          label: `📘 ${c.pageName || c.platformAccountId}`,
                          value: c.platformAccountId || c.id,
                        }))}
                    />
                  )}

                  <Segmented
                    size="small"
                    value={targetPlatform}
                    onChange={(v) => setTargetPlatform(v as 'FACEBOOK' | 'REDDIT')}
                    options={[
                      { label: 'Facebook', value: 'FACEBOOK' },
                      { label: 'Reddit', value: 'REDDIT' },
                    ]}
                  />
                </div>
              </div>

              {/* Hàng nhập liệu chính + Nút Cào bài đồng bộ */}
              <div className="flex flex-col md:flex-row items-stretch gap-2.5">
                <div className="flex-1 relative">
                  <Input
                    size="large"
                    prefix={targetPlatform === 'REDDIT' ? undefined : <FacebookFilled className="text-blue-400 mr-1" />}
                    onPressEnter={() => handleScanTargetSource()}
                    placeholder={targetPlatform === 'REDDIT'
                      ? 'VD: r/cats · cute cats · hoặc dán link bài Reddit...'
                      : 'Dán link Group hoặc Fanpage (VD: https://facebook.com/groups/...)'}
                    value={targetSourceUrl}
                    onChange={(e) => setTargetSourceUrl(e.target.value)}
                    allowClear
                    className="!h-11 rounded-xl bg-slate-900/80 border-slate-700/80 hover:border-slate-600 focus:border-blue-500 text-sm font-medium text-white placeholder:text-slate-500 px-3.5"
                  />
                </div>

                <div className="w-full md:w-56">
                  <Input
                    size="large"
                    placeholder="Tên gợi nhớ (tùy chọn)..."
                    value={targetSourceName}
                    onChange={(e) => setTargetSourceName(e.target.value)}
                    className="!h-11 rounded-xl bg-slate-900/80 border-slate-700/80 hover:border-slate-600 focus:border-blue-500 text-sm font-medium text-white placeholder:text-slate-500 px-3"
                  />
                </div>

                {targetSourceUrl.trim() && (
                  <Tooltip title="Lưu nguồn này vào kho mục tiêu bên dưới">
                    <Button
                      size="large"
                      icon={<StarOutlined className="text-amber-400 text-base" />}
                      onClick={handleSaveTargetSource}
                      className="!h-11 px-3.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-amber-300 border-slate-700 hover:border-amber-500/50 cursor-pointer"
                    />
                  </Tooltip>
                )}

                <Button
                  type="primary"
                  size="large"
                  icon={<RocketOutlined />}
                  loading={loading}
                  onClick={() => handleScanTargetSource()}
                  disabled={!targetSourceUrl.trim()}
                  className="!h-11 px-6 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shrink-0 bg-blue-600 hover:bg-blue-500 border-none shadow-md shadow-blue-600/20 active:scale-[0.99] transition-all"
                >
                  Cào bài
                </Button>
              </div>

              {/* Hàng bộ lọc trích xuất */}
              <div className="pt-2.5 border-t border-slate-800/70 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">Thứ tự:</span>
                    <Segmented
                      size="small"
                      value={targetSortOrder}
                      onChange={(val) => setTargetSortOrder(val as 'NEWEST' | 'VIRAL')}
                      options={[
                        { label: 'Mới nhất', value: 'NEWEST' },
                        { label: 'Viral nhất', value: 'VIRAL' },
                      ]}
                      className="bg-slate-900 border border-slate-700/80 text-xs"
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">Thời gian:</span>
                    <Select
                      size="small"
                      value={targetTimeRange}
                      onChange={setTargetTimeRange}
                      className="w-32 text-xs"
                      options={[
                        { label: 'Tất cả bài', value: 'ALL' },
                        { label: '24 giờ qua', value: 'TODAY' },
                        { label: '3 ngày gần đây', value: '3_DAYS' },
                        { label: '7 ngày gần đây', value: '7_DAYS' },
                      ]}
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">Số bài:</span>
                    <Select
                      size="small"
                      value={targetLimit}
                      onChange={setTargetLimit}
                      className="w-24 text-xs"
                      options={[
                        { label: '10 bài', value: 10 },
                        { label: '20 bài', value: 20 },
                        { label: '30 bài', value: 30 },
                        { label: '50 bài', value: 50 },
                      ]}
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">Lọc like:</span>
                    <Select
                      size="small"
                      value={targetMinReactions}
                      onChange={setTargetMinReactions}
                      className="w-28 text-xs"
                      options={[
                        { label: 'Tất cả (>= 0)', value: 0 },
                        { label: '>= 10 Like', value: 10 },
                        { label: '>= 30 Like', value: 30 },
                        { label: '>= 50 Like', value: 50 },
                      ]}
                    />
                  </div>
                </div>

                <div className="w-full sm:w-60">
                  <Input
                    size="small"
                    placeholder="Lọc từ khóa trong bài..."
                    value={targetKeywordFilter}
                    onChange={(e) => setTargetKeywordFilter(e.target.value)}
                    allowClear
                    className="bg-slate-900/80 border-slate-700 text-slate-200 text-xs rounded-lg h-7.5"
                  />
                </div>
              </div>
            </div>

            {/* 2. THANH QUÉT TỰ ĐỘNG ĐỊNH KỲ (TÁCH BIỆT RÕ RÀNG) */}
            <div className="p-3 sm:p-3.5 rounded-xl bg-slate-900/50 border border-slate-800/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3 flex-wrap">
                <Checkbox
                  checked={Boolean(autoScan?.enabled)}
                  disabled={!autoScan}
                  onChange={(e) => handleUpdateAutoScan({ enabled: e.target.checked })}
                  className="text-xs text-slate-200 font-semibold"
                >
                  Tự động quét kho nguồn mỗi:
                </Checkbox>

                <Select
                  size="small"
                  value={autoScan?.intervalHours ?? 3}
                  disabled={!autoScan?.enabled}
                  onChange={(val) => handleUpdateAutoScan({ intervalHours: val })}
                  className="w-24 text-xs"
                  options={[
                    { label: '1 giờ', value: 1 },
                    { label: '2 giờ', value: 2 },
                    { label: '3 giờ', value: 3 },
                    { label: '6 giờ', value: 6 },
                    { label: '12 giờ', value: 12 },
                    { label: '24 giờ', value: 24 },
                  ]}
                />

                <span className="text-xs text-slate-400 font-mono">
                  {autoScan?.running
                    ? `⚡ Đang quét: ${autoScan.currentSource || '...'}`
                    : autoScan?.enabled && autoScan?.nextRunAt
                      ? `⏰ Lần quét tiếp: ${formatScanTime(autoScan.nextRunAt)}`
                      : autoScan?.lastRunAt
                        ? `Lần gần nhất: ${formatScanTime(autoScan.lastRunAt)}`
                        : ''}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="small"
                  onClick={handleScanAllNow}
                  loading={Boolean(autoScan?.running)}
                  disabled={targetSources.length === 0}
                  className="text-xs h-7.5 rounded-lg"
                >
                  Quét tất cả ngay
                </Button>

                {redditConfig?.configured && (
                  <Button
                    size="small"
                    onClick={() => openRedditModal()}
                    className="text-xs h-7.5 rounded-lg text-slate-400"
                  >
                    Reddit: Đã kết nối
                  </Button>
                )}

                <Button
                  size="small"
                  type="primary"
                  onClick={handleOpenInbox}
                  loading={inboxLoading}
                  className="text-xs h-7.5 rounded-lg font-bold bg-blue-600 hover:bg-blue-500 text-white border-none shadow-sm"
                >
                  📥 Bài mới chờ duyệt ({autoScan?.newCount ?? 0})
                </Button>
              </div>
            </div>

            {/* Danh sách các nguồn mục tiêu */}
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <StarFilled className="text-amber-400 text-sm" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Kho nguồn đã lưu ({targetSources.length})
                  </span>
                </div>

                <div className="flex items-center gap-2 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-300 font-semibold flex items-center gap-1">
                    <ClockCircleOutlined className="text-amber-400" /> Lấy bài:
                  </span>
                  <Select
                    size="small"
                    value={targetTimeRange}
                    onChange={setTargetTimeRange}
                    variant="borderless"
                    className="text-xs font-bold text-amber-300 min-w-[130px] !p-0"
                    options={[
                      { label: 'Tất cả bài mới nhất', value: 'ALL' },
                      { label: 'Hôm nay (24h qua)', value: 'TODAY' },
                      { label: '3 ngày gần đây', value: '3_DAYS' },
                      { label: '7 ngày gần đây', value: '7_DAYS' },
                    ]}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {targetSources.map((source) => (
                  <div
                    key={source.url}
                    className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-purple-500/50 hover:bg-slate-900 transition-all flex flex-col justify-between gap-3 group relative overflow-hidden"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <Tag
                          color={source.type === 'REDDIT' ? 'orange' : source.type === 'PAGE' ? 'geekblue' : 'purple'}
                          className="!text-xs font-bold !m-0"
                        >
                          {source.type === 'REDDIT' ? 'Reddit' : source.type === 'PAGE' ? '📘 Fanpage' : '👥 Group'}
                        </Tag>
                        <Popconfirm
                          title="Xóa nguồn này?"
                          description={`Bạn có chắc muốn xóa "${source.name}" khỏi Kho Nguồn không?`}
                          onConfirm={(e) => {
                            e?.stopPropagation();
                            handleDeleteTargetSource(source.url);
                          }}
                          onCancel={(e) => e?.stopPropagation()}
                          okText="Xóa"
                          cancelText="Hủy"
                          okButtonProps={{ danger: true, size: 'small' }}
                          cancelButtonProps={{ size: 'small' }}
                        >
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            className="text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 text-xs p-1 rounded-md transition-colors cursor-pointer flex items-center justify-center"
                            title="Xóa nguồn này khỏi kho"
                          >
                            <DeleteOutlined />
                          </button>
                        </Popconfirm>
                      </div>
                      <h5 className="font-bold text-slate-100 text-[13px] truncate mt-1" title={source.name}>
                        {source.name}
                      </h5>
                      {source.description && (
                        <p className="text-xs text-slate-300 line-clamp-1">
                          {source.description}
                        </p>
                      )}
                    </div>

                    {source.dbId && (
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <Checkbox
                          checked={source.autoScan !== false}
                          onChange={(e) => handleToggleSourceAutoScan(source, e.target.checked)}
                          className="text-xs text-slate-300"
                        >
                          Tự quét
                        </Checkbox>
                        {source.lastScannedAt && (
                          <Tooltip title={source.lastScanStatus === 'ERROR' ? source.lastScanError : undefined}>
                            <span className={source.lastScanStatus === 'ERROR' ? 'text-rose-400' : 'text-slate-300'}>
                              {source.lastScanStatus === 'ERROR'
                                ? `Lỗi lúc ${formatScanTime(source.lastScannedAt)}`
                                : `${formatScanTime(source.lastScannedAt)} · ${source.lastNewCount ?? 0} bài mới`}
                            </span>
                          </Tooltip>
                        )}
                      </div>
                    )}

                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-slate-300 hover:text-white flex items-center gap-1 truncate max-w-[120px]"
                      >
                        <LinkOutlined /> Mở link
                      </a>
                      <Button
                        size="middle"
                        type="primary"
                        loading={redditScanningUrl === source.url}
                        onClick={() => (source.type === 'REDDIT' ? handleScanRedditSource(source) : handleScanTargetSource(source.url, source.name))}
                        className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs px-3 rounded-lg border-none flex items-center gap-1 shadow-sm"
                      >
                        ⚡ Cào ngay
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ────────── CHẾ ĐỘ 2: SĂN BÀI VIẾT TRỰC TIẾP ────────── */}
        {hunterMode === 'HUNT_POSTS' && (
          <div className="p-5 sm:p-6 space-y-4">
            {currentScanningGroup && (
              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl flex items-center justify-between flex-wrap gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-blue-400 font-bold">🎯 Đang quét nhóm:</span>
                  <strong className="text-white">{currentScanningGroup.name}</strong>
                  <span className="text-slate-400">({currentScanningGroup.memberLine})</span>
                </div>
                <Button
                  size="small"
                  onClick={() => {
                    setCurrentScanningGroup(null);
                    setCustomTargetUrl('');
                  }}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Xoá nhóm, quét tự do
                </Button>
              </div>
            )}

            <div className="flex flex-col md:flex-row items-stretch gap-2.5">
              {/* Chọn nền tảng */}
              <div className="shrink-0 flex items-center p-1 rounded-xl bg-slate-900/80 border border-slate-800 gap-1">
                {[
                  { label: 'Tất cả', value: 'ALL' },
                  { label: 'Threads', value: 'THREADS' },
                  { label: 'Facebook', value: 'FACEBOOK' },
                  { label: 'TikTok', value: 'TIKTOK' },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setPlatformFilter(item.value as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      platformFilter === item.value
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* Ô Nhập Keyword Chính */}
              <div className="flex-1 relative">
                <Input
                  size="large"
                  placeholder="Nhập từ khoá săn bài (review phim, mẹo vặt, ẩm thực, khởi nghiệp...)"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onPressEnter={handleHunt}
                  prefix={<SearchOutlined className="text-slate-400 text-base mr-2" />}
                  allowClear
                  className="!h-11 rounded-xl bg-slate-900/80 border-slate-700/80 hover:border-slate-600 focus:border-blue-500 text-sm font-medium text-white placeholder:text-slate-500 px-3.5"
                />
              </div>

              {/* Nút Bấm Săn Bài */}
              <Button
                type="primary"
                size="large"
                loading={loading}
                onClick={handleHunt}
                className="!h-11 px-7 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shrink-0 bg-blue-600 hover:bg-blue-500 border-none shadow-md shadow-blue-600/20 active:scale-[0.99] transition-all"
              >
                <FireOutlined /> Săn bài
              </Button>
            </div>

            {/* Thanh Bộ Lọc Tinh Chỉnh */}
            <div className="pt-2.5 border-t border-slate-800/70 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">Tương tác:</span>
                  <Select
                    size="small"
                    value={minReactionsFilter}
                    onChange={setMinReactionsFilter}
                    className="w-36 text-xs"
                    options={[
                      { value: 0, label: 'Tất cả bài' },
                      { value: 20, label: 'Like > 20' },
                      { value: 50, label: 'Like > 50' },
                      { value: 150, label: 'Like > 150' },
                    ]}
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">Định dạng:</span>
                  <Select
                    size="small"
                    value={mediaFilter}
                    onChange={setMediaFilter}
                    className="w-32 text-xs"
                    options={[
                      { value: 'ALL', label: 'Tất cả bài' },
                      { value: 'MEDIA_ONLY', label: 'Có Ảnh/Video' },
                      { value: 'IMAGE_ONLY', label: 'Chỉ bài Ảnh' },
                      { value: 'VIDEO_ONLY', label: 'Chỉ bài Video' },
                    ]}
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">Số bài:</span>
                  <Select
                    size="small"
                    value={limit}
                    onChange={setLimit}
                    className="w-24 text-xs"
                    options={[
                      { value: 10, label: '10 bài' },
                      { value: 20, label: '20 bài' },
                      { value: 30, label: '30 bài' },
                      { value: 50, label: '50 bài' },
                    ]}
                  />
                </div>

                <div className="flex items-center gap-1.5 pl-2 border-l border-slate-700/80">
                  <Checkbox
                    checked={autoGeminiCurate}
                    onChange={(e) => setAutoGeminiCurate(e.target.checked)}
                    className="text-amber-300 font-medium text-xs flex items-center"
                  >
                    Chấm điểm AI (Gemini)
                  </Checkbox>
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setHunterMode('DISCOVER_GROUPS')}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium"
                >
                  <ArrowLeftOutlined /> Quay lại Tìm nhóm
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ────────── HIỂN THỊ KẾT QUẢ TÌM NHÓM CHẤT LƯỢNG (TRA CỨU NHANH) ────────── */}
      {hunterMode === 'DISCOVER_GROUPS' && (
        <section className="space-y-4 mt-6">
          {/* Thanh công cụ kết quả */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 sm:p-3.5 rounded-2xl bg-slate-900/80 backdrop-blur-xl border border-white/10 shadow-lg">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-semibold text-white">
                {filteredGroups.length} nhóm{groupKeyword ? <span className="text-slate-400 font-normal"> · “{groupKeyword}”</span> : null}
              </span>

              {/* Chế độ xem: Bảng vs Thẻ */}
              <div className="flex items-center gap-1 bg-slate-950/80 p-0.5 rounded-xl border border-white/10">
                <button
                  type="button"
                  onClick={() => setGroupViewMode('TABLE')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                    groupViewMode === 'TABLE'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <UnorderedListOutlined /> Bảng
                </button>
                <button
                  type="button"
                  onClick={() => setGroupViewMode('GRID')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                    groupViewMode === 'GRID'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <AppstoreOutlined /> Thẻ
                </button>
              </div>
            </div>

            {/* Xuất danh sách nhóm: gộp 4 nút thành 1 menu */}
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'excel', icon: <FileExcelOutlined />, label: 'Tải file Excel', onClick: handleExportExcelFile },
                  { key: 'copy', icon: <CopyOutlined />, label: 'Chép tên + link', onClick: handleCopyGroupsList },
                  { key: 'sheets', icon: <ShareAltOutlined />, label: 'Chép dạng bảng (dán Sheets)', onClick: handleCopyGroupsExcel },
                  { key: 'text', icon: <FileTextOutlined />, label: 'Xem dạng văn bản', onClick: () => setQuickTextModalOpen(true) },
                ],
              }}
            >
              <Button size="middle" icon={<FileExcelOutlined />}>Xuất danh sách</Button>
            </Dropdown>
          </div>

          {/* ── CHẾ ĐỘ 1: BẢNG TRA CỨU NHANH (FROSTED GLASS TABLE) ── */}
          {groupViewMode === 'TABLE' ? (
            <div className="rounded-2xl border border-white/10 bg-slate-900/80 backdrop-blur-xl overflow-hidden shadow-2xl">
              <Table<DiscoveredGroup>
                dataSource={filteredGroups}
                rowKey={(record) => record.url || record.id}
                pagination={{
                  pageSize: 25,
                  showSizeChanger: true,
                  pageSizeOptions: ['25', '50', '80', '100'],
                  className: '!px-4 !py-3 !mb-0 text-slate-400 font-medium',
                }}
                scroll={{ x: 860 }}
                className="lookup-groups-table"
                columns={[
                  {
                    title: '#',
                    key: 'stt',
                    width: 55,
                    align: 'center',
                    render: (_, __, idx) => (
                      <span className="font-mono text-xs text-slate-400 font-semibold">
                        #{idx + 1}
                      </span>
                    ),
                  },
                  {
                    title: 'Nhóm',
                    key: 'name',
                    render: (_, record) => {
                      const isSaved = savedGroups.some((g) => g.url === record.url || g.id === record.id);
                      return (
                        <div className="flex items-center gap-3 py-1">
                          <div className="w-9 h-9 rounded-xl bg-slate-800/90 border border-white/10 shrink-0 overflow-hidden flex items-center justify-center">
                            {record.avatar ? (
                              <img src={record.avatar} alt={record.name} className="w-full h-full object-cover" />
                            ) : (
                              <TeamOutlined className="text-slate-400 text-sm" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <a
                                href={record.url}
                                target="_blank"
                                rel="noreferrer"
                                className="font-bold text-white hover:text-blue-400 transition-colors text-sm line-clamp-1"
                                title={record.name}
                              >
                                {record.name}
                              </a>
                              {isSaved && <StarFilled className="text-amber-400 text-xs shrink-0" />}
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              {[record.privacy || 'Công khai', record.category === 'PHIM' ? 'Phim' : record.category === 'PETS' ? 'Thú cưng' : null].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                        </div>
                      );
                    },
                  },
                  {
                    title: 'Link',
                    key: 'url',
                    render: (_, record) => (
                      <div className="flex items-center gap-1.5 font-mono text-xs">
                        <a
                          href={record.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-300 hover:text-blue-400 hover:underline transition-colors truncate max-w-[300px]"
                          title={record.url}
                        >
                          {record.url}
                        </a>
                        <Tooltip title="Sao chép link này">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(record.url);
                              message.success(`Đã chép link: ${record.url}`);
                            }}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer transition-colors shrink-0"
                          >
                            <CopyOutlined className="text-xs" />
                          </button>
                        </Tooltip>
                      </div>
                    ),
                  },
                  {
                    title: 'Thành viên',
                    key: 'members',
                    width: 140,
                    sorter: (a, b) => (a.memberCount || 0) - (b.memberCount || 0),
                    render: (_, record) => (
                      <div className="font-mono">
                        <span className="text-sm font-bold text-white tracking-tight">
                          {formatMemberDisplay(record)}
                        </span>
                      </div>
                    ),
                  },
                  {
                    title: 'Thao Tác',
                    key: 'actions',
                    width: 170,
                    align: 'right',
                    render: (_, record) => {
                      const isSaved = savedGroups.some((g) => g.url === record.url || g.id === record.id);
                      return (
                        <div className="flex items-center justify-end gap-1.5">
                          <Tooltip title={isSaved ? 'Bỏ lưu' : 'Lưu nhóm yêu thích'}>
                            <button
                              type="button"
                              onClick={() => toggleSaveGroup(record)}
                              className="w-8 h-8 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] border border-white/10 flex items-center justify-center text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
                            >
                              {isSaved ? (
                                <StarFilled className="text-amber-400 text-xs" />
                              ) : (
                                <StarOutlined className="text-xs" />
                              )}
                            </button>
                          </Tooltip>

                          <Tooltip title="Mở nhóm">
                            <a
                              href={record.url}
                              target="_blank"
                              rel="noreferrer"
                              className="w-8 h-8 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] border border-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                            >
                              <LinkOutlined className="text-xs" />
                            </a>
                          </Tooltip>

                          <Button
                            type="primary"
                            size="small"
                            onClick={() => handleScanPostsFromGroup(record)}
                            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs h-8 rounded-xl px-3"
                          >
                            Quét bài
                          </Button>
                        </div>
                      );
                    },
                  },
                ]}
              />
            </div>
          ) : (
            /* ── CHẾ ĐỘ 2: THẺ LƯỚI (CLEAN SLATE CARDS) ── */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredGroups.map((group, index) => {
                const isSaved = savedGroups.some((g) => g.url === group.url || g.id === group.id);

                return (
                  <div
                    key={group.url}
                    className="p-4 rounded-xl bg-slate-900 border border-slate-700/80 hover:border-slate-600 transition-all flex flex-col justify-between space-y-3.5 shadow-xl"
                  >
                    {/* Card Top: Avatar + Rank + Name + Badges */}
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="relative shrink-0">
                            <div className="w-11 h-11 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center overflow-hidden">
                              {group.avatar ? (
                                <img src={group.avatar} alt={group.name} className="w-full h-full object-cover" />
                              ) : (
                                <TeamOutlined className="text-slate-400 text-xl" />
                              )}
                            </div>
                            <span className="absolute -top-1.5 -left-1.5 px-1.5 py-0.5 rounded-md text-xs font-mono font-bold bg-slate-950 text-slate-200 border border-slate-700">
                              #{index + 1}
                            </span>
                          </div>

                          <div className="min-w-0">
                            <a
                              href={group.url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-bold text-white hover:text-blue-400 transition-colors line-clamp-1 text-sm leading-snug block"
                              title={group.name}
                            >
                              {group.name}
                            </a>
                            <div className="flex items-center gap-1 mt-1 flex-wrap">
                              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">
                                {group.privacy || 'Công khai'}
                              </span>
                              {group.qualityBadge && (
                                <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-amber-950/40 text-amber-300 border border-amber-800/40">
                                  {group.qualityBadge}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <Tooltip title={isSaved ? 'Bỏ lưu nhóm' : 'Lưu nhóm yêu thích'}>
                          <button
                            type="button"
                            onClick={() => toggleSaveGroup(group)}
                            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center justify-center transition-all shrink-0 cursor-pointer"
                          >
                            {isSaved ? (
                              <StarFilled className="text-amber-400 text-xs" />
                            ) : (
                              <StarOutlined className="text-slate-400 text-xs hover:text-amber-400" />
                            )}
                          </button>
                        </Tooltip>
                      </div>

                      {/* Stats: Chỉ hiển thị Số Member */}
                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                        <span className="text-xs text-slate-400 font-medium">Thành viên:</span>
                        <span className="text-sm font-bold font-mono text-emerald-400">
                          {formatMemberDisplay(group)}
                        </span>
                      </div>
                    </div>

                    {/* Action Footer */}
                    <div className="pt-2 border-t border-slate-800 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleScanPostsFromGroup(group)}
                        className="flex-1 h-9 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <FireOutlined /> {group.url.includes('tiktok.com') ? 'Quét TikTok' : 'Quét bài từ nhóm này'}
                      </button>

                      <Tooltip title="Mở trên Facebook">
                        <a
                          href={group.url}
                          target="_blank"
                          rel="noreferrer"
                          className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-all shrink-0"
                        >
                          <LinkOutlined className="text-xs" />
                        </a>
                      </Tooltip>

                      <Tooltip title="Sao chép link">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(group.url);
                            message.success(`Đã sao chép link nhóm: ${group.url}`);
                          }}
                          className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-all shrink-0 cursor-pointer"
                        >
                          <CopyOutlined className="text-xs" />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ────────── HIỂN THỊ KẾT QUẢ BÀI VIẾT ĐÃ CÀO ────────── */}
      {(hunterMode === 'HUNT_POSTS' || hunterMode === 'TARGET_SOURCES') && filteredPosts.length > 0 && (
        <div id="posts-results-section" className="group-hunter-results space-y-4 mt-6">
          {/* Thanh công cụ kết quả & xuất bài */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  {hunterMode === 'TARGET_SOURCES' ? (
                    <>
                      Nguồn mục tiêu:{' '}
                      <span className="text-purple-400 font-mono font-bold">
                        "{targetSourceName || targetSourceUrl || 'Chỉ định'}"
                      </span>
                    </>
                  ) : (
                    <>
                      Kết quả cho từ khoá{' '}
                      <span className="text-amber-400 font-mono font-bold">
                        "{keyword || currentScanningGroup?.name || 'Hot'}"
                      </span>
                    </>
                  )}:
                </span>
                <span className="text-xs text-slate-400">
                  Tìm thấy <strong className="text-white">{filteredPosts.length}</strong> bài viết chất lượng cao
                </span>
              </div>

              {/* Nhóm nút thao tác */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="group-hunter-selection-count mr-2">
                  <span>Đã chọn</span>
                  <strong>{selectedPosts.length}</strong>
                  <small>/ {filteredPosts.length} bài</small>
                </div>

                <Button size="middle" onClick={selectAll} className="text-xs">
                  {selectedPosts.length === filteredPosts.length ? 'Bỏ chọn' : 'Chọn tất cả'}
                </Button>

                <Button
                  size="middle"
                  icon={<FireOutlined className="text-pink-400" />}
                  onClick={() => {
                    setTinderIndex(0);
                    setTinderModalOpen(true);
                  }}
                  className="text-xs font-bold bg-gradient-to-r from-pink-600/30 to-rose-600/30 border-pink-500/50 text-pink-300 hover:text-white hover:from-pink-600 hover:to-rose-600 shadow-md shadow-pink-950/40 flex items-center gap-1.5"
                >
                  📱 Duyệt Kiểu Tinder
                </Button>

                <Button
                  size="middle"
                  icon={<RobotOutlined className="text-amber-300" />}
                  onClick={() => handleGeminiCuratePosts()}
                  loading={aiCurating}
                  className="text-xs font-bold bg-amber-500/20 text-amber-300 border-amber-500/50 hover:bg-amber-500/30 shadow-md"
                >
                  💎 Gemini Thẩm Định &amp; Lọc ({posts.length})
                </Button>

                <Button
                  size="middle"
                  icon={<CopyOutlined />}
                  onClick={handleCopyLinks}
                  disabled={selectedPosts.length === 0}
                  className="text-xs"
                >
                  Copy Link ({selectedPosts.length})
                </Button>

                {posts.some((p) => p.inboxId) && (
                  <Button
                    size="middle"
                    onClick={handleDismissSelectedInbox}
                    disabled={!selectedPosts.some((p) => p.inboxId)}
                    className="text-xs"
                  >
                    Bỏ qua bài đã chọn ({selectedPosts.filter((p) => p.inboxId).length})
                  </Button>
                )}

                <Button
                  size="middle"
                  icon={<RobotOutlined className="text-amber-400" />}
                  onClick={handleOpenBatchAiModal}
                  disabled={selectedPosts.length === 0}
                  className="text-xs font-bold bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700"
                >
                  ✨ Viết lại ({selectedPosts.length})
                </Button>

                <Button
                  size="middle"
                  icon={<ThunderboltFilled className="text-amber-400" />}
                  onClick={() => setQueueModalOpen(true)}
                  disabled={selectedPosts.length === 0}
                  className="text-xs"
                >
                  ⚡ Đưa vào Lịch ({selectedPosts.length})
                </Button>

                <Button
                  size="middle"
                  onClick={() => handleSendToNewsStudio()}
                  disabled={selectedPosts.length === 0}
                  className="text-xs"
                >
                  Studio Ảnh Tin ({selectedPosts.length})
                </Button>

                <Button
                  type="primary"
                  size="middle"
                  icon={<RocketOutlined />}
                  onClick={handleExportToPlaywright}
                  disabled={selectedPosts.length === 0}
                  className="group-hunter-import !min-w-0 px-4 text-xs font-bold"
                >
                  🚀 Đăng Tự Động ({selectedPosts.length})
                </Button>
              </div>
            </div>

            {/* Hàng bộ lọc AI nhanh */}
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-2 text-xs">
              <div className="flex items-center gap-4 flex-wrap">
                <Checkbox
                  checked={hideAlreadyImported}
                  onChange={(e) => setHideAlreadyImported(e.target.checked)}
                  className="text-slate-300 font-semibold text-xs"
                >
                  🚫 Ẩn bài viết / video đã đăng ({posts.filter((p) => p.isAlreadyImported).length})
                </Checkbox>
                <Checkbox
                  checked={onlyShowHighQualityAi}
                  onChange={(e) => setOnlyShowHighQualityAi(e.target.checked)}
                  className="text-amber-300 font-semibold text-xs"
                >
                  💎 Chỉ hiện bài AI chấm điểm cao (Score &ge; 70 &amp; Sạch rác)
                </Checkbox>

                <div className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1 rounded-xl border border-slate-700/70">
                  <span className="text-slate-300 font-medium flex items-center gap-1 text-xs">
                    <ClockCircleOutlined className="text-purple-400" /> Lọc ngày:
                  </span>
                  <Select
                    size="small"
                    value={postDateFilter}
                    onChange={setPostDateFilter}
                    variant="borderless"
                    className="text-xs !p-0 font-bold text-purple-300 min-w-[130px]"
                    options={[
                      { label: 'Tất cả bài', value: 'ALL' },
                      { label: '⚡ Hôm nay (24h)', value: 'TODAY' },
                      { label: '📅 3 ngày gần nhất', value: '3_DAYS' },
                      { label: '📅 7 ngày gần nhất', value: '7_DAYS' },
                    ]}
                  />
                </div>
              </div>
              <span className="text-xs text-slate-300">
                Key Gemini tích hợp:{' '}
                <button
                  type="button"
                  onClick={() => setAiKeySettingsOpen(true)}
                  className={`underline cursor-pointer font-semibold ${
                    getStoredGeminiKeys() ? 'text-emerald-400 hover:text-emerald-300' : 'text-amber-400 hover:text-amber-300'
                  }`}
                >
                  {getStoredGeminiKeys() ? '✅ Đã kích hoạt' : '⚠️ Chưa nhập (Bấm để cài đặt)'}
                </button>
              </span>
            </div>
          </div>

          {/* Lưới các thẻ bài viết */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPosts.map((post, index) => {
              const isSelected = selectedIds.has(post.id);
              // Bài video Reddit: mediaUrls[0] là file mp4 v.redd.it → dùng ảnh preview làm ảnh bìa
              const previewImg = post.sourcePlatform === 'REDDIT' && post.hasVideo && post.previewCover
                ? post.previewCover
                : post.mediaUrls?.[0] || post.previewCover;

              return (
                <div
                  key={post.id}
                  onClick={() => toggleSelect(post.id)}
                  className={`relative cursor-pointer transition-all duration-200 rounded-2xl p-4 flex flex-col justify-between border ${
                    post.isAlreadyImported ? 'opacity-65 bg-slate-900/40' : ''
                  } ${
                    isSelected
                      ? 'bg-slate-900 border-blue-500 shadow-lg shadow-blue-500/10 ring-1 ring-blue-500/30'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900/90'
                  }`}
                >
                  <div className="space-y-3">
                    {/* Header: Nền tảng + Tác giả + Checkbox */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-400 text-xs font-bold flex items-center justify-center">
                          #{index + 1}
                        </span>
                        <Checkbox
                          checked={isSelected}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleSelect(post.id);
                          }}
                        />
                        <Tag
                          color={post.sourcePlatform === 'REDDIT' ? 'orange' : post.platform === 'THREADS' ? 'purple' : post.platform === 'TIKTOK' ? 'magenta' : 'blue'}
                          className="!text-xs !px-2 !py-0.5 font-bold border-none"
                        >
                          {post.sourcePlatform === 'REDDIT' ? `Reddit ${post.subreddit || ''}` : post.platform === 'THREADS' ? '🧵 Threads' : post.platform === 'TIKTOK' ? '🎵 TikTok' : '📘 Facebook'}
                        </Tag>
                        {post.isAlreadyImported ? (
                          <Tag color="error" className="!text-xs !px-2 !py-0.5 font-bold">
                            {post.postStatus === 'PUBLISHED' ? '⛔ Đã từng đăng' : '📅 Đã có trong lịch'}
                          </Tag>
                        ) : (
                          <Tag className="!text-xs !px-2 !py-0.5 font-bold !bg-emerald-500/15 !text-emerald-400 !border !border-emerald-500/30">
                            ✨ Chưa đăng
                          </Tag>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTinderIndex(index);
                            setTinderModalOpen(true);
                          }}
                          icon={<EyeOutlined />}
                          className="!text-xs font-semibold bg-slate-800 border-slate-700 text-slate-200 hover:text-white"
                        >
                          Duyệt to
                        </Button>
                        <Button
                          size="small"
                          onClick={() => handleOpenAiModal(post)}
                          icon={<RobotOutlined className="text-amber-400" />}
                          className="!text-xs font-semibold bg-slate-800 border-slate-700 text-slate-200 hover:text-white"
                        >
                          {post.aiRewritten ? 'AI Đã sửa' : 'AI Viết lại'}
                        </Button>
                        <Tooltip title="Mở link bài gốc">
                          <a
                            href={post.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-slate-300 hover:text-blue-400 px-1"
                          >
                            Xem ↗
                          </a>
                        </Tooltip>
                      </div>
                    </div>

                    {/* Gemini AI Curation Verdict & Score */}
                    {post.aiCurated && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {post.aiScore !== undefined && post.aiScore >= 80 ? (
                          <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-gradient-to-r from-amber-500/20 to-yellow-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 shadow-sm">
                            💎 Cực Phẩm ({post.aiScore}/100)
                          </span>
                        ) : post.aiScore !== undefined && post.aiScore >= 65 ? (
                          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            ⭐ Chất Lượng ({post.aiScore}/100)
                          </span>
                        ) : (
                          <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                            Điểm AI: {post.aiScore}/100
                          </span>
                        )}
                        {post.isSpam && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40">
                            ⚠️ AI Báo: Rác / Spam
                          </span>
                        )}
                        {post.qualityVerdict && (
                          <span className="text-xs text-amber-200/90 italic truncate max-w-[200px]" title={post.qualityVerdict}>
                            {post.qualityVerdict}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Author & Group Source & Time */}
                    <div className="text-xs text-slate-300 flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 truncate max-w-[220px]">
                        <span className="font-semibold text-slate-200 truncate">👤 {post.author || 'Tác giả'}</span>
                        {post.sourceGroup && (
                          <span className="text-xs text-blue-400 truncate">({post.sourceGroup})</span>
                        )}
                      </div>
                      {(post.postedTime || post.dateText || post.publishedAt) && (
                        <span
                          className="text-xs text-slate-200 flex items-center gap-1 shrink-0 bg-slate-800/80 px-2 py-0.5 rounded-md border border-slate-700/60"
                          title="Thời gian bài viết được đăng trên nguồn gốc"
                        >
                          <ClockCircleOutlined className="text-amber-400 text-xs" />
                          {post.postedTime || post.dateText || (post.publishedAt ? dayjs(post.publishedAt).format('DD/MM HH:mm') : '')}
                        </span>
                      )}
                    </div>

                    {/* Media Preview (Nếu có) */}
                    {previewImg && (
                      <div
                        className="relative w-full h-44 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 cursor-zoom-in"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewMediaModal({
                            open: true,
                            mediaUrls: post.mediaUrls && post.mediaUrls.length > 0 ? post.mediaUrls : [previewImg],
                            title: post.caption?.slice(0, 40) || 'Ảnh bài viết',
                          });
                        }}
                      >
                        <img
                          src={previewImg}
                          alt="Post media"
                          className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                        />
                        {post.hasVideo && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                            <PlayCircleOutlined className="text-3xl text-white drop-shadow-md" />
                          </div>
                        )}
                        {post.mediaUrls && post.mediaUrls.length > 1 && (
                          <span className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-md text-white text-xs font-bold px-2 py-0.5 rounded-md">
                            +{post.mediaUrls.length} ảnh
                          </span>
                        )}
                      </div>
                    )}

                    {/* Caption với tính năng Xem thêm / Thu gọn */}
                    <div className="space-y-1">
                      <div
                        className={`text-[13px] text-slate-200 leading-relaxed ${
                          expandedCardIds.has(post.id) ? 'whitespace-pre-wrap' : 'line-clamp-3'
                        }`}
                      >
                        {getDisplayCaption(post)}
                      </div>
                      {getDisplayCaption(post).length > 110 && (
                        <button
                          type="button"
                          onClick={(e) => toggleExpandCard(post.id, e)}
                          className="text-xs text-purple-300 hover:text-purple-200 font-semibold p-0 h-auto cursor-pointer flex items-center gap-1"
                        >
                          {expandedCardIds.has(post.id) ? '▲ Thu gọn' : '▼ Xem toàn bộ caption'}
                        </button>
                      )}
                    </div>

                    {/* Gemini Viral Angle & Suggested Hook */}
                    {post.viralAngle && (
                      <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200">
                        <span className="font-bold text-amber-400">💡 Vì sao Viral:</span> {post.viralAngle}
                      </div>
                    )}
                    {post.suggestedHook && (
                      <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-200 flex items-start justify-between gap-2">
                        <div>
                          <span className="font-bold text-blue-400">🎣 Hook gợi ý:</span> "{post.suggestedHook}"
                        </div>
                        <Button
                          size="small"
                          type="link"
                          onClick={(e) => {
                            e.stopPropagation();
                            applySuggestedHook(post);
                          }}
                          className="!p-0 !h-auto text-xs text-blue-300 hover:text-white shrink-0 font-bold"
                        >
                          Áp dụng
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Metrics Footer */}
                  <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-300">
                    <div className="flex items-center gap-3 font-mono text-xs">
                      <span className="flex items-center gap-1 text-slate-200">
                        <LikeOutlined /> {post.reactions || 0}
                      </span>
                      <span className="flex items-center gap-1 text-slate-200">
                        <CommentOutlined /> {post.comments || 0}
                      </span>
                      <span className="flex items-center gap-1 text-slate-200">
                        <ShareAltOutlined /> {post.shares || 0}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                        🔥 {post.viralScore || 0} pts
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State khi chưa có bài trong mode HUNT_POSTS hoặc TARGET_SOURCES */}
      {(hunterMode === 'HUNT_POSTS' || hunterMode === 'TARGET_SOURCES') && filteredPosts.length === 0 && !loading && (
        <div className="group-hunter-empty mt-6">
          <div className="group-hunter-empty-icon">
            {hunterMode === 'TARGET_SOURCES' ? <AimOutlined className="text-purple-400" /> : <SearchOutlined />}
          </div>
          <h4>
            {hunterMode === 'TARGET_SOURCES'
              ? 'Chưa có bài viết nào được cào từ nguồn mục tiêu'
              : 'Chưa có bài viết nào được quét'}
          </h4>
          <p>
            {hunterMode === 'TARGET_SOURCES'
              ? 'Dán link Facebook Group hoặc Fanpage mục tiêu ở trên và bấm "Bắt Đầu Cào Bài Mới Nhất"!'
              : 'Chọn 1 Group ở chế độ "Tìm Group / Cộng Đồng Hay" hoặc nhập từ khoá ở trên và bấm Săn Bài Viral!'}
          </p>
          <div className="mt-4">
            <Button
              type="primary"
              onClick={() => {
                if (hunterMode === 'TARGET_SOURCES') {
                  const first = targetSources[0];
                  if (first) {
                    handleScanTargetSource(first.url, first.name);
                  }
                } else {
                  setHunterMode('DISCOVER_GROUPS');
                }
              }}
              className={hunterMode === 'TARGET_SOURCES' ? 'bg-purple-600 hover:bg-purple-500 text-white font-bold' : 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold'}
            >
              {hunterMode === 'TARGET_SOURCES' ? '🎯 Cào Thử Nguồn Gợi Ý Ngay' : '🎯 Mở Tìm Nhóm Chất Lượng Ngay'}
            </Button>
          </div>
        </div>
      )}

      {/* Loading Spin */}
      {loading && (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <Spin size="large" />
          <p className="text-sm font-semibold text-slate-400">
            Đang quét dữ liệu và đo lường tương tác từ các nguồn... Vui lòng đợi trong giây lát!
          </p>
        </div>
      )}

      {/* MODAL: Gemini AI Viết lại Đơn Lẻ */}

      {/* Kết nối Reddit: key app OAuth (script) của người dùng, lưu ở backend để quét nền dùng được */}
      <Modal
        title="Kết nối Reddit"
        open={redditModalOpen}
        onCancel={() => setRedditModalOpen(false)}
        width={560}
        className="dark-modal"
        footer={[
          <Button key="close" onClick={() => setRedditModalOpen(false)}>
            Đóng
          </Button>,
          <Button key="save" onClick={() => handleSaveRedditConfig(false)} loading={redditSaving}>
            Lưu
          </Button>,
          <Button key="test" type="primary" onClick={() => handleSaveRedditConfig(true)} loading={redditSaving}>
            Lưu và kiểm tra
          </Button>,
        ]}
      >
        <div className="space-y-3 pt-2 text-xs text-slate-300">
          <p className="leading-relaxed">
            Reddit chặn đọc bài khi chưa đăng nhập. Đăng nhập Reddit trên Chrome, bấm F12 → tab Application → Cookies →
            https://www.reddit.com, gõ tên cookie vào ô Filter rồi chép giá trị (Cookie Value) vào đúng ô bên dưới.
          </p>
          <div className="text-slate-400">
            Trạng thái:{' '}
            {redditConfig?.mode === 'COOKIE'
              ? 'đang dùng cookie'
              : redditConfig?.mode === 'OAUTH'
                ? `đang dùng app Reddit (Client ID ${redditConfig.clientId})`
                : 'chưa kết nối'}
          </div>
          <div>
            <label className="block font-semibold mb-1">reddit_session (bắt buộc)</label>
            <Input.TextArea
              rows={2}
              value={redditForm.redditSession}
              onChange={(e) => setRedditForm((f) => ({ ...f, redditSession: e.target.value }))}
              placeholder={redditConfig?.hasCookie ? 'Để trống nếu giữ cookie cũ' : 'eyJhbGciOi...'}
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">token_v2 (không bắt buộc)</label>
            <Input.TextArea
              rows={2}
              value={redditForm.tokenV2}
              onChange={(e) => setRedditForm((f) => ({ ...f, tokenV2: e.target.value }))}
              placeholder="eyJhbGciOi..."
            />
          </div>
          <Collapse
            ghost
            size="small"
            items={[
              {
                key: 'oauth',
                label: 'Dùng app Reddit thay cho cookie (tùy chọn)',
                children: (
                  <div className="space-y-3">
                    <p className="leading-relaxed text-slate-400">
                      Tạo app loại script ở old.reddit.com/prefs/apps (redirect uri http://localhost:8081). Chỉ dùng khi chưa có cookie.
                    </p>
                    <div>
                      <label className="block font-semibold mb-1">Client ID</label>
                      <Input
                        value={redditForm.clientId}
                        onChange={(e) => setRedditForm((f) => ({ ...f, clientId: e.target.value }))}
                        placeholder={redditConfig?.mode === 'OAUTH' ? 'Để trống nếu giữ key cũ' : ''}
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Secret</label>
                      <Input.Password
                        value={redditForm.clientSecret}
                        onChange={(e) => setRedditForm((f) => ({ ...f, clientSecret: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Tên tài khoản Reddit (không có u/)</label>
                      <Input
                        value={redditForm.username}
                        onChange={(e) => setRedditForm((f) => ({ ...f, username: e.target.value }))}
                      />
                    </div>
                  </div>
                ),
              },
            ]}
          />
          {redditTestResult && (
            <Alert type={redditTestResult.success ? 'success' : 'error'} showIcon message={redditTestResult.text} />
          )}
        </div>
      </Modal>
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-white">
            <RobotOutlined className="text-amber-400" />
            <span>Gemini AI — Viết lại bài đăng Viral</span>
          </div>
        }
        open={aiModalOpen}
        onCancel={() => setAiModalOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setAiModalOpen(false)}>
            Đóng
          </Button>,
          <Button
            key="apply"
            type="primary"
            onClick={handleApplyAiRewrite}
            disabled={!aiResultText.trim()}
            className="bg-green-600 hover:bg-green-500 font-bold"
          >
            ✅ Áp dụng nội dung này
          </Button>,
        ]}
        width={750}
        className="dark-modal"
      >
        <div className="space-y-4 pt-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 font-semibold mb-1 block">Phong cách viết lại:</label>
              <Select
                value={aiMode}
                onChange={setAiMode}
                className="w-full"
                options={[
                  { value: 'TRANSLATE', label: 'Dịch sang tiếng Việt (bài Reddit / tiếng nước ngoài)' },
                  { value: 'HOOK', label: '🔥 Tạo Hook giật tít gây tò mò' },
                  { value: 'REWRITE', label: '✍️ Viết lại phong cách tự nhiên (Anti-copy)' },
                  { value: 'STORYTELLING', label: '📖 Kể chuyện cảm xúc (Storytelling)' },
                  { value: 'ENGAGEMENT', label: '💬 Kêu gọi tương tác cao (CTA)' },
                  { value: 'SHORTEN', label: '⚡ Tóm tắt ngắn gọn súc tích' },
                ]}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-semibold mb-1 block">Nền tảng mục tiêu:</label>
              <Segmented
                value={aiTargetPlatform}
                onChange={(v) => setAiTargetPlatform(v as any)}
                options={[
                  { label: '📘 Facebook', value: 'FACEBOOK' },
                  { label: '🧵 Threads', value: 'THREADS' },
                ]}
                className="w-full bg-slate-900 border border-slate-700"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-semibold mb-1 block">Nội dung gốc:</label>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 max-h-32 overflow-y-auto leading-relaxed">
              {aiTargetPost?.caption || 'Không có nội dung chữ'}
            </div>
          </div>

          <div className="flex justify-center">
            <Button
              type="primary"
              size="large"
              loading={aiLoading}
              onClick={handleExecuteAiRewrite}
              className="bg-gradient-to-r from-amber-500 to-orange-500 border-none font-bold text-white px-8 h-10 shadow-lg shadow-orange-500/20"
            >
              ✨ Bấm để Gemini viết lại ngay
            </Button>
          </div>

          {aiResultText && (
            <div className="space-y-1.5 animate-fade-in">
              <label className="text-xs text-amber-300 font-bold block flex items-center justify-between">
                <span>Kết quả AI tạo ra:</span>
                <span className="text-xs text-slate-300 font-normal">Bạn có thể chỉnh sửa trực tiếp bên dưới</span>
              </label>
              <Input.TextArea
                rows={6}
                value={aiResultText}
                onChange={(e) => setAiResultText(e.target.value)}
                className="bg-slate-900 border-amber-500/40 text-slate-100 text-sm rounded-xl"
              />
            </div>
          )}
        </div>
      </Modal>

      {/* MODAL: Batch Gemini AI Rewrite */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-white">
            <RobotOutlined className="text-amber-400" />
            <span>Gemini AI — Viết lại hàng loạt ({selectedPosts.length} bài)</span>
          </div>
        }
        open={batchAiModalOpen}
        onCancel={() => {
          if (!batchAiLoading) setBatchAiModalOpen(false);
        }}
        footer={[
          <Button key="cancel" disabled={batchAiLoading} onClick={() => setBatchAiModalOpen(false)}>
            Huỷ
          </Button>,
          <Button
            key="start"
            type="primary"
            loading={batchAiLoading}
            onClick={handleExecuteBatchAiRewrite}
            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
          >
            🚀 Bắt đầu xào bài hàng loạt
          </Button>,
        ]}
        width={550}
        className="dark-modal"
      >
        <div className="space-y-4 pt-3">
          <p className="text-xs text-slate-300">
            Gemini sẽ lần lượt duyệt qua <b>{selectedPosts.length} bài viết đã chọn</b> và tự động viết lại nội dung theo phong cách bạn chọn để không bị trùng lặp khi đăng lại.
          </p>

          <div>
            <label className="text-xs text-slate-400 font-semibold mb-1 block">Chọn phong cách viết:</label>
            <Select
              value={batchAiMode}
              onChange={setBatchAiMode}
              className="w-full"
              options={[
                { value: 'TRANSLATE', label: 'Dịch sang tiếng Việt (bài Reddit / tiếng nước ngoài)' },
                { value: 'HOOK', label: '🔥 Tạo Hook giật tít gây tò mò' },
                { value: 'REWRITE', label: '✍️ Viết lại phong cách tự nhiên (Anti-copy)' },
                { value: 'STORYTELLING', label: '📖 Kể chuyện cảm xúc (Storytelling)' },
                { value: 'ENGAGEMENT', label: '💬 Kêu gọi tương tác cao (CTA)' },
                { value: 'SHORTEN', label: '⚡ Tóm tắt ngắn gọn súc tích' },
              ]}
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 font-semibold mb-1 block">Nền tảng đăng:</label>
            <Segmented
              value={batchAiPlatform}
              onChange={(v) => setBatchAiPlatform(v as any)}
              options={[
                { label: '📘 Facebook', value: 'FACEBOOK' },
                { label: '🧵 Threads', value: 'THREADS' },
              ]}
              className="w-full bg-slate-900 border border-slate-700"
            />
          </div>

          {batchAiLoading && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-center space-y-2">
              <Spin />
              <p className="text-xs text-amber-300 font-semibold">
                Đang xử lý bài {batchAiProgress.current} / {batchAiProgress.total}...
              </p>
            </div>
          )}
        </div>
      </Modal>

      {/* MODAL: Thêm vào hàng đợi */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-white">
            <ThunderboltFilled className="text-amber-400" />
            <span>Thêm {selectedPosts.length} bài viết vào Hàng Đợi</span>
          </div>
        }
        open={queueModalOpen}
        onCancel={() => setQueueModalOpen(false)}
        onOk={handleBatchAddToQueue}
        confirmLoading={queueSubmitting}
        okText="Xác nhận thêm"
        cancelText="Đóng"
        className="dark-modal"
      >
        <div className="space-y-4 pt-3">
          <p className="text-xs text-slate-300">
            Thêm {selectedPosts.length} bài viết này vào hàng đợi đăng.
          </p>

          <ScheduleChoice value={queueSchedule} onChange={setQueueSchedule} />
        </div>
      </Modal>

      {/* MODAL: Preview Media */}
      <Modal
        title={previewMediaModal.title || 'Xem ảnh/video bài viết'}
        open={previewMediaModal.open}
        onCancel={() => setPreviewMediaModal({ open: false, mediaUrls: [], title: '' })}
        footer={null}
        width={800}
        className="dark-modal"
      >
        <div className="grid grid-cols-2 gap-3 py-3 max-h-[70vh] overflow-y-auto">
          {previewMediaModal.mediaUrls.map((url, i) => (
            <div key={i} className="rounded-xl overflow-hidden bg-slate-950 border border-slate-800">
              <Image src={url} alt={`Media ${i}`} className="w-full h-auto object-cover" />
            </div>
          ))}
        </div>
      </Modal>

      {/* MODAL: Duyệt Bài Kiểu Tinder */}
      <Modal
        title={
          <div className="flex flex-col gap-2 w-full pr-6 pt-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔥</span>
                <span className="font-extrabold text-base text-slate-100">Duyệt bài kiểu Tinder</span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  {filteredPosts.length > 0 ? `${tinderIndex + 1} / ${filteredPosts.length}` : '0 / 0'}
                </span>
                {currentTinderPost?.isAlreadyImported ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                    ⛔ ĐÃ TỪNG ĐĂNG (TRÙNG)
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    ✨ BÀI MỚI CHƯA ĐĂNG
                  </span>
                )}
              </div>
              <div className="hidden sm:flex items-center gap-2 text-xs text-slate-300">
                <span>Phím tắt:</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-mono text-xs">← Bỏ qua</kbd>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-mono text-xs">→ / Space Chọn</kbd>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-mono text-xs">Esc Đóng</kbd>
              </div>
            </div>
            {filteredPosts.length > 0 && (
              <Progress
                percent={Math.round(((tinderIndex + 1) / filteredPosts.length) * 100)}
                showInfo={false}
                strokeColor={{ '0%': '#3b82f6', '100%': '#10b981' }}
                trailColor="#1e293b"
                size={['100%', 3]}
              />
            )}
          </div>
        }
        open={tinderModalOpen}
        onCancel={() => setTinderModalOpen(false)}
        footer={null}
        width={920}
        className="dark-modal"
        centered
      >
        {currentTinderPost ? (
          <div className="space-y-5 py-2">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              {/* Media Preview Column */}
              <div className="md:col-span-6 flex flex-col items-center justify-center bg-slate-950/70 border border-slate-800 rounded-2xl p-3 min-h-[340px] max-h-[460px] overflow-hidden relative group">
                {currentTinderPost.mediaUrls && currentTinderPost.mediaUrls.length > 0 ? (
                  <div className="w-full h-full flex items-center justify-center relative">
                    <img
                      src={currentTinderPost.mediaUrls[0]}
                      alt="Media preview"
                      className="max-h-[420px] w-auto max-w-full object-contain rounded-xl shadow-lg"
                    />
                    {currentTinderPost.mediaUrls.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewMediaModal({
                            open: true,
                            mediaUrls: currentTinderPost.mediaUrls,
                            title: `Xem toàn bộ ${currentTinderPost.mediaUrls.length} ảnh/video`,
                          })
                        }
                        className="absolute bottom-3 right-3 px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-white border border-slate-700 text-xs font-semibold backdrop-blur-md shadow-lg flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <PictureOutlined />
                        <span>+{currentTinderPost.mediaUrls.length - 1} ảnh nữa</span>
                      </button>
                    )}
                    {(currentTinderPost.hasVideo || currentTinderPost.videoUrl) && (
                      <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/75 backdrop-blur-md border border-white/20 text-white text-xs font-bold flex items-center gap-1.5">
                        <PlayCircleOutlined className="text-rose-400" />
                        <span>Video</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center p-8 space-y-3">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-900 flex items-center justify-center text-slate-500 text-2xl border border-slate-800">
                      📝
                    </div>
                    <p className="text-sm font-semibold text-slate-400">Bài viết dạng văn bản (Không kèm ảnh)</p>
                  </div>
                )}
              </div>

              {/* Information & Caption Column */}
              <div className="md:col-span-6 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  {/* Author / Source */}
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold text-xs shrink-0">
                        FB
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-200 truncate">
                          {currentTinderPost.author || currentTinderPost.sourceGroup || 'Facebook Page/Group'}
                        </div>
                        {currentTinderPost.sourceGroup && currentTinderPost.author && (
                          <div className="text-xs text-slate-300 truncate">
                            Group: {currentTinderPost.sourceGroup}
                          </div>
                        )}
                        {(currentTinderPost.postedTime || currentTinderPost.dateText || currentTinderPost.publishedAt) && (
                          <div className="text-xs text-amber-300 flex items-center gap-1 mt-0.5 font-medium">
                            <ClockCircleOutlined className="text-xs" />
                            Đăng lúc: {currentTinderPost.postedTime || currentTinderPost.dateText || (currentTinderPost.publishedAt ? dayjs(currentTinderPost.publishedAt).format('DD/MM/YYYY HH:mm') : '')}
                          </div>
                        )}
                      </div>
                    </div>

                    <a
                      href={currentTinderPost.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 border border-blue-500/30 text-xs font-medium flex items-center gap-1 transition-all shrink-0"
                    >
                      <span>Link gốc</span>
                      <LinkOutlined />
                    </a>
                  </div>

                  {/* Duplicate warning banner */}
                  {currentTinderPost.isAlreadyImported && (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                      <span className="text-base shrink-0">⚠️</span>
                      <div className="leading-snug">
                        <b>Link này đã có trong lịch đăng!</b> Bạn có thể bấm bỏ qua để né đăng trùng lặp.
                      </div>
                    </div>
                  )}

                  {/* Reaction metrics */}
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
                      <div className="text-xs text-slate-300">Like</div>
                      <div className="text-[13px] font-bold text-slate-100 flex items-center justify-center gap-1 mt-0.5">
                        <LikeOutlined className="text-blue-400" />
                        <span>{currentTinderPost.reactions.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
                      <div className="text-xs text-slate-300">Comment</div>
                      <div className="text-[13px] font-bold text-slate-100 flex items-center justify-center gap-1 mt-0.5">
                        <CommentOutlined className="text-emerald-400" />
                        <span>{currentTinderPost.comments.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
                      <div className="text-xs text-slate-300">Share</div>
                      <div className="text-[13px] font-bold text-slate-100 flex items-center justify-center gap-1 mt-0.5">
                        <ShareAltOutlined className="text-purple-400" />
                        <span>{currentTinderPost.shares.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
                      <div className="text-xs text-slate-300">Điểm viral</div>
                      <div className="text-[13px] font-bold text-amber-400 flex items-center justify-center gap-1 mt-0.5">
                        <FireOutlined />
                        <span>{currentTinderPost.viralScore} pts</span>
                      </div>
                    </div>
                  </div>

                  {/* Caption / Title */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="font-semibold text-slate-300">Tiêu đề & Nội dung bài viết:</span>
                      <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => {
                          navigator.clipboard.writeText(getDisplayCaption(currentTinderPost));
                          message.success('Đã copy nội dung bài viết!');
                        }}
                        className="text-slate-400 hover:text-white text-xs h-6 px-1.5"
                      >
                        Copy
                      </Button>
                    </div>
                    <div className="max-h-[180px] overflow-y-auto p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-sm text-slate-200 leading-relaxed whitespace-pre-wrap select-text font-sans">
                      {getDisplayCaption(currentTinderPost)}
                    </div>
                  </div>

                  {/* AI Quick rewrite trigger */}
                  <div className="flex items-center gap-2">
                    <Button
                      size="small"
                      icon={<RobotOutlined />}
                      onClick={() => handleOpenAiModal(currentTinderPost)}
                      className="border-indigo-500/40 text-indigo-300 hover:text-indigo-200 bg-indigo-500/10 text-xs rounded-lg"
                    >
                      AI Viết lại hook / caption
                    </Button>
                    <Button
                      size="small"
                      onClick={() => handleSendToNewsStudio(currentTinderPost)}
                      className="border-cyan-500/40 text-cyan-300 hover:text-cyan-200 bg-cyan-500/10 text-xs rounded-lg font-semibold"
                    >
                      🖼️ Studio Ảnh Tin
                    </Button>
                    {selectedIds.has(currentTinderPost.id) ? (
                      <span className="text-xs text-emerald-400 font-bold flex items-center gap-1 ml-auto">
                        <CheckCircleOutlined /> Đã trong giỏ chọn ({selectedIds.size})
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500 ml-auto">
                        Đang có {selectedIds.size} bài được chọn
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Swipe Controls */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800/80">
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={handleTinderPrev}
                disabled={tinderIndex === 0}
                className="border-slate-700 text-slate-300 hover:text-white"
              >
                Bài trước
              </Button>

              <div className="flex items-center gap-4">
                {/* Reject Button (Swipe Left) */}
                <button
                  type="button"
                  onClick={handleTinderReject}
                  className="group flex items-center gap-2.5 px-6 py-3 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/30 hover:border-rose-500/60 font-bold transition-all shadow-[0_0_15px_rgba(244,63,94,0.15)] active:scale-95 cursor-pointer text-sm"
                >
                  <CloseOutlined className="text-base" />
                  <span>Bỏ qua</span>
                  <span className="text-xs opacity-75 font-mono font-normal">(←)</span>
                </button>

                {/* Approve Button (Swipe Right / Space) */}
                <button
                  type="button"
                  onClick={handleTinderApprove}
                  className="group flex items-center gap-2.5 px-7 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-bold transition-all shadow-[0_0_20px_rgba(16,185,129,0.35)] active:scale-95 cursor-pointer text-sm"
                >
                  <CheckOutlined className="text-base" />
                  <span>Chọn lấy bài này</span>
                  <span className="text-xs opacity-90 font-mono font-normal">(→ hoặc Space)</span>
                </button>
              </div>

              <Button
                onClick={() => setTinderModalOpen(false)}
                className="border-slate-700 text-slate-300 hover:text-white"
              >
                Đóng
              </Button>
            </div>
          </div>
        ) : (
          <div className="py-12 text-center space-y-4">
            <div className="text-4xl">🎉</div>
            <h4 className="text-base font-bold text-slate-200">Bạn đã duyệt hết bài viết!</h4>
            <p className="text-xs text-slate-400">
              Đã duyệt qua toàn bộ bài viết trong bộ lọc hiện tại. Tổng bài đang chọn: <b className="text-emerald-400">{selectedIds.size}</b> bài.
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <Button
                onClick={() => {
                  setTinderIndex(0);
                }}
                className="border-slate-700 text-slate-300 hover:text-white"
              >
                Xem lại từ đầu
              </Button>
              <Button
                type="primary"
                onClick={() => setTinderModalOpen(false)}
                className="bg-blue-600 hover:bg-blue-500"
              >
                Hoàn tất & Về danh sách
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── MODAL TRA CỨU & XEM NHANH DẠNG VĂN BẢN (80 LINK - TÊN - MEMBER) ── */}
      <Modal
        title={
          <div className="flex items-center justify-between pr-8">
            <span className="text-white font-bold text-sm sm:text-base flex items-center gap-2">
              <FileTextOutlined className="text-blue-400" /> Danh Sách Tra Cứu Nhanh ({filteredGroups.length} Nhóm Facebook)
            </span>
          </div>
        }
        open={quickTextModalOpen}
        onCancel={() => setQuickTextModalOpen(false)}
        footer={[
          <Button
            key="download-excel"
            icon={<FileExcelOutlined className="text-emerald-400" />}
            onClick={handleExportExcelFile}
            className="border-emerald-700/80 bg-emerald-950/40 text-emerald-300 hover:text-white hover:border-emerald-500 font-semibold"
          >
            Tải File Excel (.xlsx)
          </Button>,
          <Button
            key="excel"
            icon={<ShareAltOutlined />}
            onClick={handleCopyGroupsExcel}
            className="border-slate-700 text-slate-300 hover:text-white"
          >
            Copy dán Sheets/Excel
          </Button>,
          <Button
            key="copy"
            type="primary"
            icon={<CopyOutlined />}
            onClick={handleCopyGroupsList}
            className="bg-blue-600 hover:bg-blue-500"
          >
            Copy toàn bộ danh sách
          </Button>,
          <Button
            key="close"
            onClick={() => setQuickTextModalOpen(false)}
            className="border-slate-700 text-slate-300 hover:text-white"
          >
            Đóng
          </Button>,
        ]}
        width={780}
        className="dark-modal"
      >
        <div className="space-y-3 py-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>
              Cú pháp: <code className="text-blue-300 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">[STT]. [Link] - [Tên group] - [Số TV] ([Quyền riêng tư])</code>
            </span>
            <span className="font-mono text-emerald-400 font-semibold">{filteredGroups.length} nhóm</span>
          </div>

          <Input.TextArea
            readOnly
            rows={16}
            value={filteredGroups
              .map((g, idx) => `${idx + 1}. ${g.url} - ${g.name} - ${formatMemberDisplay(g)} (${g.privacy || 'Công khai'})`)
              .join('\n')}
            className="font-mono text-xs bg-slate-950 text-slate-200 border-slate-800 rounded-xl p-3 focus:border-blue-500 select-all"
          />
          <div className="text-xs text-slate-300 italic">
            * Mẹo: Bạn có thể click vào ô văn bản và nhấn <b>Ctrl+A & Ctrl+C</b> để chép toàn bộ, hoặc nhấn nút <b>"Copy dạng Excel / Google Sheets"</b> ở bên dưới để dán thẳng theo cột vào trang tính.
          </div>
        </div>
      </Modal>

      {/* MODAL: Cài đặt Gemini API Keys */}
      <AiSettingsModal
        open={aiKeySettingsOpen}
        onClose={() => setAiKeySettingsOpen(false)}
      />
    </div>
  );
}
