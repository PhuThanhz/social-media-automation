import type { Dayjs } from 'dayjs';

export interface SocialAccount {
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

export interface PostLinkItem {
  id: string;
  url: string;
  inputType?: 'LINK' | 'MANUAL';
  manualContent?: string;
  manualMediaUrls?: string[];
  manualMediaKinds?: ('image' | 'video')[];
  isNow: boolean;
  scheduledAt: Dayjs;
  /** Hẹn giờ: người dùng đã đặt giờ riêng cho bài này (scheduledAt) qua "Đặt giờ từng bài". */
  customTime?: boolean;
  affiliateLink?: string;
  showCommentBox?: boolean;
  includeCredit?: boolean;
  skipComment?: boolean;
  groupCommentEnabled?: boolean;
  customCaption?: string;
  colorBackground?: boolean | 'RED_PHOTO_TRICK';
  extraGroupIds?: string[];
}

export type PostMode = 'FANPAGE_ONLY' | 'FANPAGE_AND_GROUP' | 'GROUP_ONLY';

// Xem trước ảnh/video cào được của 1 dòng link trong danh sách soạn bài
export interface ItemPreview {
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
}

export interface PostQueue {
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

export interface PendingPageBreakdownItem {
  pageName: string;
  count: number;
  percent: number;
  isAnon?: boolean;
  publishedToday?: number;
  failedCount?: number;
}

export interface GroupStatItem {
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

export interface ScrapedNewsPreviewItem {
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

export interface CustomNewsChannel {
  id: string;
  category: 'bds' | 'tech' | 'finance' | 'health' | 'pickleball' | 'lifestyle' | 'other';
  name: string;
  url: string;
  type: 'category' | 'rss';
}

export interface DiagnosticLogPayload {
  source: string;
  lines: string[];
  returned: number;
  fileSize: number;
  lastModified?: string;
}

export interface DiagnosticEvidence {
  lines: string[];
  exactMatch: boolean;
  matchCount: number;
  searchToken: string;
}
