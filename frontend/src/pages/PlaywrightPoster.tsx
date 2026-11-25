import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Select,
  App,
  Typography,
  Tag,
  Progress,
  Tooltip,
  DatePicker,
  Segmented,
  Space,
  Modal,
  Popconfirm,
  InputNumber,
} from 'antd';
import {
  SendOutlined,
  LinkOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  RedoOutlined,
  HistoryOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  ScheduleOutlined,
  RocketOutlined,
  MessageOutlined,
  WarningOutlined,
  TeamOutlined,
  EyeOutlined,
  FacebookFilled,
  ReloadOutlined,
  BugOutlined,
  EditOutlined,
  UserOutlined,
  DeploymentUnitOutlined,
  RightOutlined,
  FileTextOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
  PlusCircleOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import api from '../config/axios';
import { DEFAULT_FANPAGE_PLATFORM_ACCOUNT_ID } from '../config/constants';
import { cleanSocialUrl } from '../components/common/PasteLinkInput';
import NewsCardModal, { type NewsCardSource } from '../components/modals/NewsCardModal';
import TextCardModal from '../components/modals/TextCardModal';
import TextBulkModal, { type TextBulkPost } from '../components/modals/TextBulkModal';
import PostDetailModal from '../components/modals/PostDetailModal';
import QuickUpdateCookieModal from '../components/modals/QuickUpdateCookieModal';
import { POSTING_WINDOW_QUERY_KEY, schedulePayload, type ScheduleValue } from '../components/common/postingSchedule';
import ScheduleChoice from '../components/common/ScheduleChoice';
import HistoryPanel from './playwright-poster/HistoryPanel';
import ComposeAdvancedOptions from './playwright-poster/ComposeAdvancedOptions';
import ComposeContentSection from './playwright-poster/ComposeContentSection';
import ComposeTargetSection from './playwright-poster/ComposeTargetSection';
import { DEFAULT_SAVED_COMMENT, STORAGE_KEY_COMMENT, stripEmojiPrefix, resolveItemGroupTargets } from './playwright-poster/shared';
import { useStableActions } from './playwright-poster/useStableActions';
import type { DiagnosticEvidence, DiagnosticLogPayload, GroupStatItem, ItemPreview, PendingPageBreakdownItem, PostLinkItem, PostMode, PostQueue, SocialAccount } from './playwright-poster/types';
import { useOpenedOnce } from './playwright-poster/useOpenedOnce';
import { usePresetHub } from './playwright-poster/usePresetHub';
import { useGroupMembership } from './playwright-poster/useGroupMembership';
import { useReassignNick } from './playwright-poster/useReassignNick';
import { useCreditHashtag } from './playwright-poster/useCreditHashtag';
import { useQueueDispatch } from './playwright-poster/useQueueDispatch';
import { useCaptionFormatting } from './playwright-poster/useCaptionFormatting';
import { useFailedPostActions } from './playwright-poster/useFailedPostActions';
import { useViralHunter } from './playwright-poster/useViralHunter';
import { useGroupHunter } from './playwright-poster/useGroupHunter';
import { useNewsScraper } from './playwright-poster/useNewsScraper';
import { distributeGroupTasks, type GroupScheduleTask } from '../utils/groupScheduleDistribution';

// Modal/drawer lớn: tách chunk riêng, chỉ tải khi mở lần đầu
const ArticleBatchModal = lazy(() => import('./playwright-poster/ArticleBatchModal'));
const BulkPasteDrawer = lazy(() => import('./playwright-poster/BulkPasteDrawer'));
import PerPostTimesModal, { isComposableItem, autoTimeOf } from './playwright-poster/PerPostTimesModal';
const DistributeModal = lazy(() => import('./playwright-poster/DistributeModal'));
const GroupHunterDrawer = lazy(() => import('./playwright-poster/GroupHunterDrawer'));
const SwipeReviewModal = lazy(() => import('./playwright-poster/SwipeReviewModal'));
const ViralHunterDrawer = lazy(() => import('./playwright-poster/ViralHunterDrawer'));
const CustomCreModal = lazy(() => import('./playwright-poster/CustomCreModal'));
const DiagnosticsDrawer = lazy(() => import('./playwright-poster/DiagnosticsDrawer'));
const GroupCheckModal = lazy(() => import('./playwright-poster/GroupCheckModal'));
const HashtagModal = lazy(() => import('./playwright-poster/HashtagModal'));
const KpiTargetsModal = lazy(() => import('./playwright-poster/KpiTargetsModal'));
const ManagePresetsModal = lazy(() => import('./playwright-poster/ManagePresetsModal'));
const ReassignNickModal = lazy(() => import('./playwright-poster/ReassignNickModal'));
const ResetFailedModal = lazy(() => import('./playwright-poster/ResetFailedModal'));
const SavePresetModal = lazy(() => import('./playwright-poster/SavePresetModal'));

const { Text, Paragraph } = Typography;









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
    <div className="flex flex-col gap-1.5 w-full max-w-[165px] bg-gradient-to-b from-slate-900/95 to-slate-950/95 p-2.5 rounded-xl border border-purple-500/30 shadow-md shadow-purple-950/20 mt-1.5 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1.5 text-xs font-bold text-purple-300 uppercase tracking-wider font-mono">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
          </span>
          Đang chạy
        </span>
        <span className="text-xs text-slate-300 font-mono font-medium">~{estimatedTotalSec}s</span>
      </div>

      <div className="flex items-baseline justify-between">
        <span className="text-sm font-extrabold text-white font-mono tracking-tight">{formattedElapsed}</span>
        <span className="text-xs font-mono text-purple-300 font-semibold">{percent}%</span>
      </div>

      <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800 p-[0.5px]">
        <div
          className="bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-400 h-full rounded-full transition-all duration-700 ease-out shadow-xs"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="pt-0.5 flex items-center justify-between text-xs">
        <span className="text-slate-300 text-xs">Ước tính:</span>
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

const PlaywrightPoster = () => {
  const { message, modal } = App.useApp();
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
    const raw: string = err?.response?.data?.message || err?.message || 'Có lỗi xảy ra khi cào nội dung bài viết!';
    if (/cookie.*(hết hạn|không hợp lệ|đăng xuất|checkpoint)|đăng nhập lại|redirect sang trang khác/i.test(raw)) {
      message.warning(
        `🔒 Cookie Facebook đang dùng để cào bài đã hết hạn hoặc phiên đăng nhập bị đăng xuất. Vui lòng vào trang "Quản lý kết nối" cập nhật lại Cookie mới (c_user + xs).`,
        10
      );
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
  // Khoảng cách thời gian giãn cách giữa các bài khi đăng cuốn chiếu (mặc định 20 phút để an toàn cho Group)
  const [groupStaggerInterval, setGroupStaggerInterval] = useState<number>(20);
  const [groupTimingMode, setGroupTimingMode] = useState<'SPREAD_DAY' | 'STAGGER'>('SPREAD_DAY');
  const [groupSpreadStart, setGroupSpreadStart] = useState<Dayjs>(() => dayjs().startOf('day').add(8, 'hour').add(30, 'minute'));
  const [groupSpreadEnd, setGroupSpreadEnd] = useState<Dayjs>(() => dayjs().startOf('day').add(22, 'hour').add(30, 'minute'));

  // Xem trước ảnh/video cào được TRƯỚC khi đăng — key theo id của từng dòng link trong danh sách.
  const [previews, setPreviews] = useState<Record<string, ItemPreview>>({});

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

  // Gắn 1 ảnh đã dựng (Ảnh tin / Ảnh chữ) làm media duy nhất của bài
  const attachCardImageToItem = (itemId: string, mode: 'LINK' | 'MANUAL', cardUrl: string) => {
    if (mode === 'MANUAL') {
      setLinkItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, manualMediaUrls: [cardUrl], manualMediaKinds: ['image'] } : it)));
    } else {
      // Giữ originalMediaUrls để nút khôi phục media gốc vẫn dùng được
      // Bài dán từ "Dán nhanh nhiều link" có thể chỉ có preview trong bulkDrawerPreviews
      const itemUrl = linkItems.find((it) => it.id === itemId)?.url?.trim() || '';
      setPreviews((prev) => {
        const cur = prev[itemId] || bulkDrawerPreviews[itemUrl] || { loading: false };
        return { ...prev, [itemId]: { ...cur, mediaUrls: [cardUrl], mediaKinds: ['image'], imageCount: 1, videoCount: 0 } };
      });
    }
  };

  const applyNewsCardToItem = (cardUrl: string) => {
    if (!newsCardTarget) return;
    attachCardImageToItem(newsCardTarget.itemId, newsCardTarget.mode, cardUrl);
    setNewsCardTarget(null);
  };

  // Studio "Ảnh chữ": chữ của bài vẽ lên nền → ảnh đăng kèm bài
  const [textCardTarget, setTextCardTarget] = useState<{ itemId: string; mode: 'LINK' | 'MANUAL'; text: string } | null>(null);
  const openTextCardForItem = (item: PostLinkItem, mode: 'LINK' | 'MANUAL', textOverride?: string) => {
    const text = textOverride !== undefined ? textOverride : mode === 'MANUAL'
      ? (item.manualContent || '')
      : (item.customCaption !== undefined ? item.customCaption : (previews[item.id]?.caption || ''));
    setTextCardTarget({ itemId: item.id, mode, text });
  };
  // "Dán nhiều bài chữ": mỗi đoạn thành 1 bài tự soạn — ngắn thì phông nền FB, dài thì ảnh chữ đã vẽ sẵn
  const [textBulkOpen, setTextBulkOpen] = useState(false);
  const createTextBulkPosts = (posts: TextBulkPost[]) => {
    setLinkItems((prev) => {
      // Bỏ các dòng trống đang chờ nhập để danh sách chỉ còn bài thật
      const kept = prev.filter((it) => it.url.trim() || it.manualContent?.trim() || it.manualMediaUrls?.length);
      const last = kept[kept.length - 1];
      let t = last?.scheduledAt ? dayjs(last.scheduledAt) : dayjs();
      const stamp = Date.now();
      const added: PostLinkItem[] = posts.map((p, i) => {
        t = t.add(batchInterval || 15, 'minute');
        return {
          id: `txt_${stamp}_${i}`,
          url: '',
          inputType: 'MANUAL',
          manualContent: p.text,
          isNow: false,
          scheduledAt: t,
          includeCredit: false,
          ...(p.imageUrl
            ? { manualMediaUrls: [p.imageUrl], manualMediaKinds: ['image' as const] }
            : { colorBackground: true, colorBackgroundPreset: p.colorBackgroundPreset }),
        };
      });
      return [...kept, ...added];
    });
  };

  const applyTextCardToItem = (cardUrl: string) => {
    if (!textCardTarget) return;
    attachCardImageToItem(textCardTarget.itemId, textCardTarget.mode, cardUrl);
    // Đã có ảnh thì không đăng kiểu phông nền Facebook nữa (bài nền màu bị bỏ media)
    setLinkItems((prev) => prev.map((it) => (it.id === textCardTarget.itemId ? { ...it, colorBackground: false } : it)));
    setTextCardTarget(null);
  };

  const isMediaVideo = (url: string, kind?: string) =>
    kind === 'video' || /\.mp4|\.mov|\.webm|\/video\/|\/v\/t16\/|\/m84\/|\/m86\/|\/o1\/v\//i.test(url);

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

  const {
    showArticleBatchModal, setShowArticleBatchModal, articleBatchUrlsText, setArticleBatchUrlsText,
    articleBatchEnableAi, setArticleBatchEnableAi, articleBatchAiStyle, setArticleBatchAiStyle,
    isScrapingArticleBatch, customCategoryInputUrl, setCustomCategoryInputUrl, scrapedNewsItems,
    setScrapedNewsItems, activeCategoryTab, setActiveCategoryTab, setShowRawUrlArea, showRawUrlArea,
    setShowChannelUrlList, showChannelUrlList, isRadarSweeping, radarAutoRefresh, setRadarAutoRefresh,
    radarAutoRefreshMinutes, setRadarAutoRefreshMinutes, radarLastSweepTime, radarSearchKeyword,
    setRadarSearchKeyword, customChannels, setShowAddChannelModal, setNewChannelCategory,
    handleDeleteCustomChannel, handleNewsDragStart, handleNewsDrop, handleFetchCategoryPreset,
    handleFetchRssPreset, handleRunRadarSweep, handleBatchScrapeArticlesToForm, showAddChannelModal,
    handleAddCustomChannel, newChannelName, setNewChannelName, newChannelUrl, setNewChannelUrl,
    newChannelCategory,
  } = useNewsScraper({
    location,
    setLinkItems,
    setPreviews,
    navigate,
    late: () => ({ batchInterval }),
  });

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
        : previews[activeSwipeItem.id]?.mediaUrls
          ? previews[activeSwipeItem.id].mediaUrls!
          : (activeSwipePreview?.mediaUrls && activeSwipePreview.mediaUrls.length > 0)
            ? activeSwipePreview.mediaUrls
            : (bulkDrawerPreviews[activeSwipeItem.url?.trim()]?.mediaUrls || []))
    : [];
  const activeSwipeMediaKinds = activeSwipeItem
    ? (activeSwipeItem.inputType === 'MANUAL'
        ? activeSwipeItem.manualMediaKinds || []
        : previews[activeSwipeItem.id]?.mediaUrls
          ? (previews[activeSwipeItem.id].mediaKinds || [])
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
    const itemId = activeSwipeItem.id;
    setSwipeDecisions((current) => ({ ...current, [itemId]: decision }));
    setSwipeMediaIndex(0);
    if (decision === 'REJECT') {
      // Bỏ = xoá khỏi danh sách ngay; bài kế tiếp trượt vào đúng vị trí hiện tại nên không tăng index
      setLinkItems((prev) => {
        const next = prev.filter((item) => item.id !== itemId);
        return next.length > 0
          ? next
          : [{ id: Math.random().toString(36).substring(2, 9), url: '', isNow: true, scheduledAt: dayjs(), includeCredit: true }];
      });
      setPreviews((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
      return;
    }
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
    message.success(`Còn ${swipeReviewItems.length} bài · đã bỏ ${rejectedIds.size} bài`);
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


  // Thời gian đăng: chỉ 3 cách (Đăng ngay / Xếp vào lịch / Hẹn giờ). Giờ cụ thể do server xếp theo
  // "Lịch đăng" chung (bấm badge hàng đợi trên header để cài khung giờ, giãn cách, giới hạn mỗi nick).
  const [scheduleChoice, setScheduleChoiceState] = useState<ScheduleValue>(() => (
    {
      mode: localStorage.getItem('poster_schedule_mode') === 'NOW' ? 'NOW' : 'QUEUE',
      intervalMinutes: Number(localStorage.getItem('poster_schedule_interval')) || 20,
    }
  ));
  const setScheduleChoice = (v: ScheduleValue) => {
    setScheduleChoiceState(v);
    if (v.mode !== 'AT') localStorage.setItem('poster_schedule_mode', v.mode);
    if (v.intervalMinutes) localStorage.setItem('poster_schedule_interval', String(v.intervalMinutes));
  };
  // "Hẹn giờ" nhiều bài = bắt đầu từ mốc đã chọn, server tự nối đuôi theo nick → không gửi giờ riêng từng bài
  const scheduleBody = {
    ...schedulePayload(scheduleChoice),
    ...(scheduleChoice.mode === 'AT' ? { scheduledTimes: undefined } : {}),
  };
  // Giãn cách phút giữa các bài (lấy trực tiếp từ lựa chọn người dùng, mặc định 20 phút)
  const batchInterval = scheduleChoice.intervalMinutes || 20;
  // "Đặt giờ từng bài" (chỉ Hẹn giờ + Chỉ đăng Fanpage): bài có customTime gửi đúng giờ đó, bài còn lại = mốc + idx × giãn cách
  const [perPostTimesOpen, setPerPostTimesOpen] = useState(false);
  const [batchToolsOpen, setBatchToolsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Thao tác hàng loạt trên các bài trong Hàng đợi & Lịch sử
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  // Modal dán nhiều link cùng lúc (Bulk Paste Drawer)
  const [bulkModalVisible, setBulkModalVisible] = useState(false);
  const [bulkAutoDistributeTwoVias, setBulkAutoDistributeTwoVias] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const {
    hunterDrawerVisible, setHunterDrawerVisible, hunterTarget, setHunterTarget, setHunterLimit, hunterLimit,
    hunterMinViews, setHunterMinViews, hunterDurationFilter, setHunterDurationFilter, hunterSortBy,
    setHunterSortBy, setHunterUltraHD, hunterUltraHD, setHunterHideImported, hunterHideImported,
    setHunterAutoSchedule, hunterAutoSchedule, hunterLoading, hunterResults, hunterSelectedIds,
    setHunterSelectedIds, handleHuntChannel, filteredAndSortedHunterVideos, handleImportHunterVideos,
  } = useViralHunter({
    setBulkText,
    setScheduleChoice,
    setBulkModalVisible,
  });

  // Fetch danh sách kết nối Fanpage / Group Playwright (đặt trước useGroupHunter để dùng an toàn khi render)
  const { data: socialAccounts } = useQuery({
    queryKey: ['socialAccounts'],
    queryFn: async () => {
      const response = await api.get('/connections');
      return response.data as SocialAccount[];
    }
  });

  const {
    removedFavoriteUrls, favoriteGroups, favoriteGroupCategoryFilter, favoriteGroupSearch,
    favoriteGroupsExpanded, groupHunterDrawerVisible, validLinkCount, setGroupHunterDrawerVisible,
    groupHunterTarget, setGroupHunterTarget, groupHunterLimit, setGroupHunterLimit, groupHunterDateRange,
    setGroupHunterDateRange, groupHunterMediaFilter, setGroupHunterMediaFilter, setGroupHunterSkipImported,
    groupHunterSkipImported, setGroupHunterAutoSchedule, groupHunterAutoSchedule, groupHunterInterval,
    setGroupHunterInterval, groupHunterLoading, groupHunterResults, setGroupHunterResults,
    groupHunterAiCurating, setGroupHunterAiOnlyQuality, groupHunterAiOnlyQuality, groupHunterScheduleMode,
    setGroupHunterScheduleMode, setGroupHunterBatchAiOpen, groupHunterBatchAiOpen, groupHunterBatchAiMode,
    setGroupHunterBatchAiMode, groupHunterBatchAiLoading, setGroupHunterBatchAiProgress,
    groupHunterBatchAiProgress, setGroupHunterPreviewItem, groupHunterPreviewItem, groupHunterGroupName,
    groupHunterCustomName, setGroupHunterCustomName, groupHunterSelectedIds, setGroupHunterSelectedIds,
    setFavoriteGroupSearch, setFavoriteGroupsExpanded, setFavoriteGroupCategoryFilter, handleAddFavoriteGroup,
    handleRemoveFavoriteGroup, handleRenameFavoriteGroup, handleHuntFacebookGroup,
    handleGeminiCurateGroupPosts, handleApplyGroupHunterHook, handleCleanSpamFromSelectedPosts,
    handleExecuteGroupHunterBatchAi, filteredGroupHunterPosts, handleImportGroupHunterPosts,
    handleImportAndSwipeGroupHunterPosts, scrapeAccountOptions, activeScrapeAccount, setGroupHunterScrapeAccountId,
  } = useGroupHunter({
    setBulkText,
    setBulkDrawerPreviews,
    formatMultiLineCaption,
    setScheduleChoice,
    form,
    setBulkModalVisible,
    setPreviews,
    setLinkItems,
    setSwipeReviewIndex,
    setSwipeMediaIndex,
    setSwipeDecisions,
    setSwipeReviewOpen,
    linkItems,
    socialAccounts,
    late: () => ({ socialAccounts, setSmartGroupId }),
  });

  // Bộ lọc bảng Lịch sử (Nhóm, Page đăng, Trạng thái, Từ khóa)
  const [historyGroupFilter, setHistoryGroupFilter] = useState<string>('ALL');
  const [historyPageFilter, setHistoryPageFilter] = useState<string>('ALL');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('ALL');
  const [historySearchText, setHistorySearchText] = useState<string>('');
  const [historyOpen, setHistoryOpen] = useState(true);
  const [historyTablePage, setHistoryTablePage] = useState({ current: 1, pageSize: 10 });
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

  // Danh sách Fanpage cho modal đặt KPI — gộp các kết nối trùng platformAccountId (VD cùng 1 Fanpage có
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

  // useMemo: postingIdentities và các editor (React.memo) phụ thuộc reference của mảng này
  const playwrightAccounts = useMemo(() => Array.from(
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
  ).sort((a, b) => (a.pageName || '').localeCompare(b.pageName || '', 'vi')), [socialAccounts]);

  // Danh sách các Via / Nick cá nhân có cookie (Nick Chính, Nick Nuôi, ...)
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

  // Đếm số lượng Fanpage mà mỗi Via (theo c_user) đang quản trị
  const pageCountByCUser = useMemo(() => {
    const counts = new Map<string, number>();
    (socialAccounts || [])
      .filter((a) => a.platform === 'FACEBOOK_PAGE')
      .forEach((acc) => {
        const cUser = acc.accessToken?.match(/c_user=(\d+)/)?.[1];
        if (cUser) {
          counts.set(cUser, (counts.get(cUser) || 0) + 1);
        }
      });
    return counts;
  }, [socialAccounts]);

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
          return isAnon ? `${matched.pageName} (Ẩn danh)` : matched.pageName;
        }
      }

      if (parts.length === 2) {
        const part1 = parts[1].trim();
        if (part1 && part1 !== 'PERSONAL_COOKIE' && part1 !== 'PAGE_TOKEN') {
          return isAnon ? `${part1} (Ẩn danh)` : part1;
        }
        const platformId = parts[0].trim();
        const matched = (socialAccounts || []).find(
          (a) => a.platformAccountId === platformId || String(a.id) === platformId
        );
        if (matched?.pageName) {
          return isAnon ? `${matched.pageName} (Ẩn danh)` : matched.pageName;
        }
      }

      const matched = (socialAccounts || []).find(
        (a) => String(a.id) === raw || a.platformAccountId === raw || a.platformAccountId === parts[0]
      );
      if (matched?.pageName) {
        return isAnon ? `${matched.pageName} (Ẩn danh)` : matched.pageName;
      }
    }

    if (isAnon) {
      return 'Nick cá nhân (Ẩn danh)';
    }

    if (record.targetGroupNames && (socialAccounts || []).length > 0) {
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
      const name = matched ? (matched.pageName || matched.platformAccountId) : v;
      return String(name).replace(/^👤\s*Nick Cá Nhân\s*\((.*)\)$/, '$1');
    }).filter(Boolean);
  }, [watchedTargetFanpageId, postingIdentities]);

  const selectedTargetAccount = useMemo(() => {
    if (!watchedTargetFanpageId) return null;
    const primary = Array.isArray(watchedTargetFanpageId) ? watchedTargetFanpageId[0] : watchedTargetFanpageId;
    return postingIdentities.find((a) => accountTargetValue(a) === primary) || null;
  }, [watchedTargetFanpageId, postingIdentities]);

  const isCurrentTargetExpired = selectedTargetAccount?.tokenStatus === 'EXPIRED';

  // Bình luận mặc định dùng cho khung xem trước Status nền đỏ — chỉ hiển thị khi người dùng nhập ô affiliateLink
  const watchedDefaultComment = Form.useWatch('affiliateLink', form);
  const defaultCommentPreview = (watchedDefaultComment || '').trim();
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
      .map((a) => {
        const rawName = (a.pageName || a.platformAccountId).replace(/^👤\s*Nick Cá Nhân\s*\((.*)\)$/, '$1');
        const cUser = a.accessToken?.match(/c_user=(\d+)/)?.[1];
        const pageCount = cUser ? (pageCountByCUser.get(cUser) || 0) : 0;
        return pageCount > 0 ? `${rawName} (${pageCount} Page)` : rawName;
      })
      .join(' + ');
  }, [twoMainVias, pageCountByCUser]);

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

  // Danh sách các Page đang được chọn mà có từ 2 Via trở lên cùng quản lý (Co-admin)
  const selectedCoAdminPageNames = useMemo(() => {
    const names = new Set<string>();
    activeSelectedFanpageIds.forEach((val) => {
      const acc = playwrightAccounts.find((a) => accountTargetValue(a) === val);
      if (acc) {
        const norm = (acc.pageName || acc.platformAccountId).trim().toLowerCase();
        const coAdmins = coAdminViasByPageName.get(norm) || [];
        if (coAdmins.length > 1) {
          names.add(acc.pageName || acc.platformAccountId);
        }
      }
    });
    return Array.from(names);
  }, [activeSelectedFanpageIds, playwrightAccounts, coAdminViasByPageName]);

  // Kiểm tra xem tất cả các Via của những Page dùng chung đó đã được chọn hết chưa
  const isAllCoAdminsSelected = useMemo(() => {
    if (selectedCoAdminPageNames.length === 0) return true;
    for (const pageName of selectedCoAdminPageNames) {
      const norm = pageName.trim().toLowerCase();
      const allAccs = playwrightAccounts.filter(
        (a) => (a.pageName || a.platformAccountId).trim().toLowerCase() === norm && a.tokenStatus !== 'EXPIRED'
      );
      const allVals = allAccs.map((a) => accountTargetValue(a));
      if (!allVals.every((v) => activeSelectedFanpageIds.includes(v))) {
        return false;
      }
    }
    return true;
  }, [selectedCoAdminPageNames, playwrightAccounts, activeSelectedFanpageIds]);

  // Tự động thêm tất cả các Via cùng quản lý Page đó để 2 Worker chạy song song
  const handleAutoSelectBothViasForSelectedPages = useCallback(() => {
    const newVals = new Set(activeSelectedFanpageIds);
    selectedCoAdminPageNames.forEach((name) => {
      const norm = name.trim().toLowerCase();
      playwrightAccounts
        .filter((a) => (a.pageName || a.platformAccountId).trim().toLowerCase() === norm && a.tokenStatus !== 'EXPIRED')
        .forEach((a) => newVals.add(accountTargetValue(a)));
    });
    const result = Array.from(newVals);
    form.setFieldValue('targetFanpageId', result);
    setIsMultiDistributeActive(true);
    setMultiSelectedTargets(result);
    setDistributionStrategy('ROUND_ROBIN');
    setGroupDistributionMode('PAGE_PER_GROUP');
    message.success('⚡ Đã bật chia đều qua cả 2 Via để 2 Worker chạy song song chống spam!');
  }, [activeSelectedFanpageIds, selectedCoAdminPageNames, playwrightAccounts, form, message]);

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

  const {
    savePresetModalOpen, managePresetsModalOpen, savedPresets, selectedPresetId, setSelectedPresetId,
    setSavePresetModalOpen, setNewPresetName, setManagePresetsModalOpen, setEditingPreset,
    setEditingPresetName, applyPreset, handleUpdatePresetWithCurrent, handleDeletePreset,
    handleAutoSpreadPagesForGroups, newPresetName, handleSaveNewPreset, editingPreset, handleRenamePreset,
    editingPresetName,
  } = usePresetHub({
    setPostMode,
    setGroupDistributionMode,
    setIsAnonymous,
    postingIdentities,
    accountTargetValue,
    setIsMultiDistributeActive,
    setMultiSelectedTargets,
    form,
    activeSelectedGroupIds,
    activeSelectedFanpageIds,
    postMode,
    groupDistributionMode,
    isAnonymous,
    playwrightAccounts,
    groupAccountsWithId,
  });

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
              <span className="truncate">{acc.pageName || acc.platformAccountId}</span>
              {isCoAdmin && (
                <span className="px-1.5 py-0.5 rounded text-xs font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  ⚡ 2 Via
                </span>
              )}
              {viaName && <span className="text-xs font-normal text-slate-300">· {viaName}</span>}
            </span>
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <span className={`text-xs ${needed > 0 ? 'text-amber-300' : 'text-emerald-300'}`} title={needed > 0 ? `Thiếu ${needed} bài hôm nay` : 'Đủ chỉ tiêu hôm nay'}>
                {currentCount}/{targetCount}
              </span>
              {isExp && (
                <Tag color="error" className="!rounded-full !text-xs !mr-0 font-bold">Hết Cookie</Tag>
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
      const cUser = acc.accessToken?.match(/c_user=(\d+)/)?.[1];
      const managedPageCount = cUser ? (pageCountByCUser.get(cUser) || 0) : 0;

      return {
        value: val,
        filterLabel: `${accountSearchLabel(acc)} ${managedPageCount > 0 ? `${managedPageCount} page` : ''}`,
        label: (
          <div className="flex items-center justify-between w-full py-0.5 gap-2">
            <span className={`min-w-0 flex items-center gap-1.5 ${isExp ? 'text-red-500 font-bold' : 'text-slate-100 font-semibold'}`}>
              <span className="truncate">{(acc.pageName || acc.platformAccountId).replace(/^👤\s*Nick Cá Nhân\s*\((.*)\)$/, '$1')}</span>
              {managedPageCount > 0 && (
                <span className="text-xs font-normal text-slate-400 whitespace-nowrap">· {managedPageCount} Page</span>
              )}
            </span>
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <span className={`text-xs ${needed > 0 ? 'text-amber-300' : 'text-emerald-300'}`} title={needed > 0 ? `Thiếu ${needed} bài hôm nay` : 'Đủ chỉ tiêu hôm nay'}>
                {currentCount}/{targetCount}
              </span>
              {isExp && (
                <Tag color="error" className="!rounded-full !text-xs !mr-0 font-bold">Hết Cookie</Tag>
              )}
            </div>
          </div>
        ),
      };
    });

    const groups = [];
    if (pageOptions.length > 0) {
      groups.push({
        label: `Fanpage (${pageOptions.length})`,
        options: pageOptions,
      });
    }
    if (personalOptions.length > 0) {
      groups.push({
        label: `Nick cá nhân (${personalOptions.length})`,
        options: personalOptions,
      });
    }
    return groups;
  }, [playwrightAccounts, personalAccountTargets, todayTargets, viaNameOf, coAdminViasByPageName]);

  const unifiedGroupOptions = useMemo(() => {
    return groupAccountsWithId.map((group) => {
      const isJoined = group.groupHealthStatus === 'JOINED';
      const isPending = group.groupHealthStatus === 'PENDING_APPROVAL';
      const isNotJoined = group.groupHealthStatus === 'KICKED_OR_NOT_JOINED';
      const cleanName = stripEmojiPrefix(group.pageName) || '';

      return {
        value: group.platformAccountId,
        filterLabel: `${cleanName} ${group.platformAccountId}`,
        label: (
          <div className="flex items-center justify-between w-full py-0.5">
            <span className="truncate pr-2" title={cleanName}>
              {cleanName}
            </span>
            <div className="shrink-0">
              {isJoined && <Tag color="success" className="!rounded-full !text-xs !mr-0">Đã vào</Tag>}
              {isPending && <Tag color="warning" className="!rounded-full !text-xs !mr-0">Chờ duyệt</Tag>}
              {isNotJoined && <Tag color="error" className="!rounded-full !text-xs !mr-0">Chưa vào</Tag>}
            </div>
          </div>
        ),
      };
    });
  }, [groupAccountsWithId]);

  const calculatedTotalQueueCount = useMemo(() => {
    const validItems = linkItems.filter((i) => {
      const hasUrl = !!i.url && i.url.trim().length > 0;
      const hasContent = (!!i.manualContent && i.manualContent.trim().length > 0) || (!!i.customCaption && i.customCaption.trim().length > 0);
      const hasMedia = (i.manualMediaUrls?.length || 0) > 0;
      return hasUrl || hasContent || hasMedia;
    });
    if (validItems.length === 0) return 0;

    if (postMode === 'FANPAGE_ONLY') {
      return isMultiDistributeActive ? validItems.length : validItems.length * Math.max(1, activeSelectedFanpageIds.length);
    }

    const gCount = activeSelectedGroupIds.length;
    const pCount = activeSelectedFanpageIds.length;

    if (gCount === 0) return 0;

    const fanpageMultiplier = groupDistributionMode === 'CROSS_ALL' ? Math.max(1, pCount) : 1;
    return validItems.reduce((sum, item, idx) => {
      const itemGroups = resolveItemGroupTargets(activeSelectedGroupIds, item.extraGroupIds, groupDistributionMode, idx);
      return sum + itemGroups.length * fanpageMultiplier;
    }, 0);
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

  // Khởi tạo bình luận: Mặc định ĐỂ TRỐNG (TẮT), chỉ điền nếu người dùng từng chủ động lưu mẫu riêng của mình
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY_COMMENT);
    if (saved && saved.trim() !== '' && !saved.includes('9fLALT7wfw')) {
      form.setFieldValue('affiliateLink', saved);
    } else {
      // Xoá mẫu mặc định cũ để tránh tự ý bình luận
      localStorage.removeItem(STORAGE_KEY_COMMENT);
      form.setFieldValue('affiliateLink', '');
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
    staleTime: 15000,
    refetchInterval: 30000,
  });

  // Fetch lịch sử các bài đăng gần đây (active queue + 2 ngày gần nhất)
  const { data: posts, isLoading } = useQuery({
    queryKey: ['postQueuePlaywright'],
    queryFn: async () => {
      // 1 request cho mọi campaign; bỏ bài Story — chỉ hiển thị các bài viết/video thường vào Fanpage và Group
      const response = await api.get('/queue/recent', { params: { days: 2, excludeType: 'STORY' } });
      const allPosts: PostQueue[] = response.data || [];

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
    staleTime: 15000,
    refetchInterval: (query) => {
      // Khi đang ở tab Soạn bài, giảm polling xuống 60s để tránh re-render giật lag gõ chữ
      if (workspaceTab !== 'history') return 60000;
      const all = query.state.data as PostQueue[] | undefined;
      const isAnyProcessing = all?.some((p) => p.status === 'PROCESSING');
      return isAnyProcessing ? 10000 : 30000;
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

  // Nhóm đang lên bài bù KPI (mở từ Floating KPI Popover) — chỉ để hiện chỉ tiêu, không xếp giờ
  const [smartGroupId, setSmartGroupId] = useState<string>('');

  const {
    groupCheckModalVisible, setGroupCheckModalVisible, groupCheckingMap, groupJoiningMap,
    checkSingleGroupMutation, checkAllGroupsMutation, joinGroupMutation,
  } = useGroupMembership({
    queryClient,
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
      setSmartGroupId(targetGroupId);
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
  }, [searchParams, form, playwrightAccounts, setSearchParams, message]);




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

  // Tự bỏ các dòng link trùng trong ô dán (giữ lần xuất hiện đầu tiên)
  useEffect(() => {
    if (!bulkText) return;
    const lines = bulkText.split(/\r?\n/);
    const seen = new Set<string>();
    let removed = 0;
    const kept = lines.filter((line) => {
      const t = line.trim();
      if (!/^https?:\/\/\S+$/i.test(t)) return true;
      const key = cleanSocialUrl(t.replace(/[),.;"'<>]+$/g, '')) || t;
      if (seen.has(key)) { removed++; return false; }
      seen.add(key);
      return true;
    });
    if (removed === 0) return;
    setBulkText(kept.join('\n'));
    message.info({ content: `Đã bỏ ${removed} link trùng`, key: 'bulk-dup-removed' });
  }, [bulkText]);

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
        content: `Đã tải xong ${bulkScrapeStats.completed}/${bulkScrapeStats.total} bài`,
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
            originalMediaUrls: [...urls],
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

  // Link cào lỗi (riêng tư, hỏng, không lấy được nội dung) tự bỏ khỏi đợt dán
  useEffect(() => {
    if (!bulkModalVisible) return;
    const failed = bulkPasteSummary.finalUrls.filter((u) => {
      const p = bulkDrawerPreviews[u.trim()];
      return !!p && !p.loading && !!p.error;
    });
    if (failed.length === 0) return;
    failed.forEach((u) => removeUrlFromBulkText(u));
    message.warning({ content: `Đã bỏ ${failed.length} link lỗi`, key: 'bulk-failed-removed' });
  }, [bulkModalVisible, bulkPasteSummary.finalUrls, bulkDrawerPreviews, removeUrlFromBulkText]);

  const fetchAllDrawerPreviews = useCallback(() => {
    bulkPasteSummary.finalUrls.forEach((url, idx) => {
      setBulkDrawerPreviews((prev) => ({ ...prev, [url]: { loading: false } }));
      setTimeout(() => fetchOneDrawerPreview(url), idx * 150);
    });
  }, [bulkPasteSummary.finalUrls, fetchOneDrawerPreview]);

  // Ref giữ state/hàm mới nhất để effect auto-fetch không phải chạy lại mỗi lần preview cập nhật
  const bulkDrawerPreviewsRef = useRef(bulkDrawerPreviews);
  bulkDrawerPreviewsRef.current = bulkDrawerPreviews;
  const fetchOneDrawerPreviewRef = useRef(fetchOneDrawerPreview);
  fetchOneDrawerPreviewRef.current = fetchOneDrawerPreview;
  // URL đã được xếp hàng auto-fetch trong lần mở Drawer hiện tại (reset khi Drawer đóng)
  const drawerQueuedUrlsRef = useRef<Set<string>>(new Set());

  // Key dạng chuỗi: `posts` refetch tạo mảng finalUrls mới nhưng nội dung không đổi thì effect không chạy lại
  const drawerUrlsKey = bulkPasteSummary.finalUrls.join('\n');

  // Tự động tải trước hình ảnh, video & caption cho TẤT CẢ các link vừa dán vào Drawer
  useEffect(() => {
    if (!bulkModalVisible) {
      drawerQueuedUrlsRef.current.clear();
      return;
    }
    if (!drawerUrlsKey) return;
    const queued = drawerQueuedUrlsRef.current;
    // Timer con chưa chạy: url -> timer id (để clear + bỏ đánh dấu khi cleanup)
    const pending = new Map<string, ReturnType<typeof setTimeout>>();
    const timer = setTimeout(() => {
      let slot = 0;
      drawerUrlsKey.split('\n').forEach((url) => {
        const trimmed = url.trim();
        if (queued.has(trimmed)) return;
        const p = bulkDrawerPreviewsRef.current[trimmed];
        // CHỈ cào nếu bài THẬT SỰ chưa có thông tin — BỎ QUA nếu đã cào từ Group Hunter hoặc đã có caption/media
        if (!p || (!p.loading && !p.caption && (!p.mediaUrls || p.mediaUrls.length === 0) && !p.watermarkRemoved && !p.error)) {
          queued.add(trimmed);
          pending.set(trimmed, setTimeout(() => {
            pending.delete(trimmed);
            fetchOneDrawerPreviewRef.current(url);
          }, slot++ * 180));
        }
      });
    }, 300);
    return () => {
      clearTimeout(timer);
      pending.forEach((id, trimmed) => {
        clearTimeout(id);
        queued.delete(trimmed);
      });
    };
  }, [bulkModalVisible, drawerUrlsKey]);

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
    const today = dayjs();
    const allMap = new Map<string, { count: number; isAnon?: boolean; publishedToday: number; failedCount: number }>();
    let totalPending = 0;
    (posts || []).forEach((post) => {
      const posterName = resolvePosterIdentityName(post) || 'Chưa gán Page';
      const isAnon = !!(post.targetGroupNames?.startsWith('GROUP_ONLY_ANON:') || post.targetFanpageId === 'PERSONAL_PROFILE');
      const cur = allMap.get(posterName) || { count: 0, isAnon, publishedToday: 0, failedCount: 0 };
      if (post.status === 'PENDING' || post.status === 'PROCESSING') {
        totalPending += 1;
        cur.count += 1;
      } else if (post.status === 'PUBLISHED') {
        if (post.publishedAt && dayjs(post.publishedAt).isSame(today, 'day')) {
          cur.publishedToday += 1;
        }
      } else if (post.status === 'FAILED' || post.status === 'CANCELLED') {
        cur.failedCount += 1;
      }
      allMap.set(posterName, cur);
    });

    const pagesList: PendingPageBreakdownItem[] = [];
    allMap.forEach((val, name) => {
      const percent = totalPending > 0 ? Math.round((val.count / totalPending) * 100) : 0;
      pagesList.push({
        pageName: name,
        count: val.count,
        percent,
        isAnon: val.isAnon,
        publishedToday: val.publishedToday,
        failedCount: val.failedCount,
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

  // Xếp lại lịch theo cài đặt chung (khung giờ + giãn cách + làn theo nick). ids trống = cả hàng đợi.
  const handleRepackQueue = (ids?: React.Key[], gapSeconds?: number) => {
    const run = async () => {
      setIsBulkProcessing(true);
      try {
        const body: Record<string, any> = ids && ids.length > 0 ? { ids: ids.map((k) => Number(k)) } : {};
        if (gapSeconds && gapSeconds > 0) {
          body.gapSeconds = gapSeconds;
        }
        const res = await api.post('/queue/pack-continuous', body);
        const finish = res.data?.estimatedFinishAt ? dayjs(res.data.estimatedFinishAt).format('HH:mm DD/MM') : '';
        const deferred = Number(res.data?.deferredCount) || 0;
        message.success(`Đã xếp lại ${res.data?.updated ?? 0} bài${gapSeconds ? ` (giãn cách ${Math.round(gapSeconds / 60)} phút)` : ''}${finish ? `, dự kiến xong lúc ${finish}` : ''}`
          + (deferred > 0 ? `. ${deferred} bài sang ngày sau.` : '.'), 5);
        setSelectedRowKeys([]);
        queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
        queryClient.invalidateQueries({ queryKey: POSTING_WINDOW_QUERY_KEY });
      } catch (err: any) {
        message.error(err?.response?.data?.message || 'Không xếp lại được lịch');
      } finally {
        setIsBulkProcessing(false);
      }
    };
    if (ids && ids.length > 0) {
      run();
      return;
    }
    if (gapSeconds) {
      run();
      return;
    }
    modal.confirm({
      title: 'Xếp lại toàn bộ hàng đợi?',
      content: 'Mọi bài đang chờ sẽ được xếp nối đuôi theo Lịch đăng chung, kể cả bài đã hẹn giờ riêng.',
      okText: 'Xếp lại',
      cancelText: 'Hủy',
      onOk: run,
    });
  };

  // Xếp lại lịch rải đều toàn bộ các nhóm suốt cả ngày (xen kẽ nhóm, không dồn cục)
  const handleSpreadGroupsQueue = (ids?: React.Key[]) => {
    const run = async () => {
      setIsBulkProcessing(true);
      try {
        const body = ids && ids.length > 0 ? { ids: ids.map((k) => Number(k)) } : {};
        const res = await api.post('/queue/spread-groups', body);
        const finish = res.data?.estimatedFinishAt ? dayjs(res.data.estimatedFinishAt).format('HH:mm DD/MM') : '';
        message.success(`🎯 Đã rải đều ${res.data?.updated ?? 0} bài cho ${res.data?.groupCount ?? 0} nhóm${finish ? `, dự kiến xong lúc ${finish}` : ''}.`, 5);
        setSelectedRowKeys([]);
        queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
        queryClient.invalidateQueries({ queryKey: POSTING_WINDOW_QUERY_KEY });
      } catch (err: any) {
        message.error(err?.response?.data?.message || 'Không thể rải đều lịch nhóm');
      } finally {
        setIsBulkProcessing(false);
      }
    };
    if (ids && ids.length > 0) {
      run();
      return;
    }
    modal.confirm({
      title: '🎯 Rải đều bài của toàn bộ các nhóm cả ngày?',
      content: 'Hệ thống sẽ gom các bài theo từng nhóm, tự động xếp xen kẽ so le xoay vòng và giãn cách đều đặn suốt cả ngày, không bị dồn cục vào 1 khung giờ.',
      okText: 'Rải đều',
      cancelText: 'Hủy',
      onOk: run,
    });
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

  const {
    reassignModalVisible, setReassignModalVisible, setReassignSelectedNicks, reassignSelectedNicks,
    reassignRescheduleToday, setReassignRescheduleToday, isReassigning, handleApplyReassignNicks,
  } = useReassignNick({
    selectedRowKeys,
    setSelectedRowKeys,
    queryClient,
  });

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

  const updateLinkExtraGroupIds = (id: string, extraGroupIds: string[]) => {
    setLinkItems((prev) => prev.map((item) => (item.id === id ? { ...item, extraGroupIds } : item)));
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

  const {
    isCustomCreModalOpen, isHashtagModalOpen, replaceOrAppendCreditText, applyAnonymousCreditToAll,
    applyEnableAllCredit, applyDisableAllCredit, applyOriginalAuthorCreditToAll, openCustomCreModal,
    openHashtagModal, setIsCustomCreModalOpen, customCreInput, setCustomCreInput, customCreTargetItemId,
    applyCustomCreditToPosts, setIsHashtagModalOpen, hashtagInput, setHashtagInput, hashtagTargetItemId,
    applyHashtagsToPosts,
  } = useCreditHashtag({
    setLinkItems,
    bulkDrawerPreviews,
    previews,
    linkItems,
  });

  const {
    smartDispatchSummary, resetEqualDistribution, handleSmartDispatch, applyEqualDistributionToPosts,
  } = useQueueDispatch({
    selectedDistributePages,
    linkItems,
    customItemTargets,
    setCustomItemTargets,
    setDistributeModalOpen,
    activeSelectedFanpageIds,
    playwrightAccounts,
    accountTargetValue,
    twoMainViasTargetValues,
    postingIdentities,
    setLinkItems,
    posts,
    setIsBulkProcessing,
    queryClient,
  });

  const {
    toUnicodeBold, toUnicodeSerifBold, toUnicodeItalic, toUnicodeBoldItalic, toUnicodeStrikethrough,
    toUnicodeUnderline, toUnicodeBoxedTag, toUnicodeHeading1, toUnicodeHeading2, applyTransformToSelection,
    insertSnippetAtCursor, setDragOverDropzone, dragOverDropzone,
  } = useCaptionFormatting({
    linkItems,
    updateLinkManualContent,
  });

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

    // Giờ đăng không chọn ở đây: nút Đăng gửi kèm cách chọn giờ chung (Đăng ngay / Xếp vào lịch / Hẹn giờ)
    newItems = filteredUrls.map((url) => {
      const cached = bulkDrawerPreviews[url];
      return {
        id: Math.random().toString(36).substring(2, 9),
        url,
        isNow: true,
        scheduledAt: now,
        includeCredit: cached?.includeCredit !== false,
        skipComment: !!cached?.skipComment,
        affiliateLink: cached?.affiliateComment,
        customCaption: cached?.caption,
      };
    });

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
    message.success(`Đã thêm ${filteredUrls.length} bài${removedNote}${historyNote}`, 4);
  };

  // Áp dụng đợt dán và mở ngay màn hình duyệt từng bài theo phong cách Tinder
  const handleApplyAndOpenSwipeReview = () => {
    handleApplyBulkPaste();
    setTimeout(() => {
      openSwipeReview();
    }, 120);
  };

  const {
    resetFailedModalVisible, setResetFailedModalVisible, resetFailedMode, setResetFailedMode,
    resetFailedSpacing, setResetFailedSpacing, handleResetFailedBatch, handleRetryAllFailed,
    handleDeleteAllFailed,
  } = useFailedPostActions({
    setIsBulkProcessing,
    queryClient,
    posts,
  });

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

        // CHỈ dùng bình luận khi người dùng chủ động điền vào ô affiliateLink
        let effectiveDefaultComment = values.affiliateLink?.trim() || form.getFieldValue('affiliateLink')?.trim() || undefined;
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
          const rawTasks: GroupScheduleTask[] = [];

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

            const groupsToLoop = selectedGroupIds.length > 0 ? selectedGroupIds : [''];
            const fanpagesToLoop = selectedFanpageIds.length > 0 ? selectedFanpageIds : [values.targetFanpageId || ''];
            const rawItemTarget = customItemTargets[i.id];
            const itemTarget = (rawItemTarget && fanpagesToLoop.includes(rawItemTarget)) ? rawItemTarget : undefined;
            const resolvedGroups = resolveItemGroupTargets(groupsToLoop, i.extraGroupIds, groupDistributionMode, itemIdx);

            const pushFanpageGroupTask = (gId: string, fId: string) => {
              const finalAffLink = resolveAffiliateLinkForGroup(gId, baseAffLink);
              rawTasks.push({
                itemUrl,
                itemCaption,
                itemMedia,
                finalAffLink,
                targetGroupId: gId,
                targetFanpageId: fId,
                commentDisabled: Boolean(i.skipComment),
                groupCommentEnabled: Boolean(i.groupCommentEnabled) && isGroupCommentAllowedForGroup(gId),
                includeCredit: i.includeCredit !== false,
                colorBackground: resolveColorBgValue(i.colorBackground),
                colorBackgroundPreset: i.colorBackgroundPreset,
              });
            };

            if (itemTarget) {
              resolvedGroups.forEach((gId) => pushFanpageGroupTask(gId, itemTarget));
            } else if (groupDistributionMode === 'PAGE_PER_GROUP') {
              resolvedGroups.forEach((gId, gIdx) => {
                pushFanpageGroupTask(gId, fanpagesToLoop[(gIdx + itemIdx) % fanpagesToLoop.length]);
              });
            } else if (groupDistributionMode === 'ROUND_ROBIN_POSTS') {
              const fId = fanpagesToLoop[itemIdx % fanpagesToLoop.length];
              resolvedGroups.forEach((gId) => pushFanpageGroupTask(gId, fId));
            } else {
              resolvedGroups.forEach((gId) => {
                fanpagesToLoop.forEach((fId) => pushFanpageGroupTask(gId, fId));
              });
            }
          });

          const baseTime = validItems[0]?.isNow ? dayjs() : (validItems[0]?.scheduledAt || dayjs());
          const scheduledTasks = distributeGroupTasks(rawTasks, {
            timingMode: groupTimingMode,
            staggerIntervalMinutes: groupStaggerInterval,
            spreadStart: groupSpreadStart,
            spreadEnd: groupSpreadEnd,
            baseTime,
          });

          const expandedUrls = scheduledTasks.map((t) => t.itemUrl);
          const expandedScheduledTimes = scheduledTasks.map((t) => t.scheduledIso);
          const expandedCustomCaptions = scheduledTasks.map((t) => t.itemCaption);
          const expandedCustomMediaUrls = scheduledTasks.map((t) => t.itemMedia);
          const expandedAffiliateLinks = scheduledTasks.map((t) => t.finalAffLink);
          const expandedTargetGroupNamesList = scheduledTasks.map((t) => t.targetGroupId);
          const expandedTargetFanpageIdsList = scheduledTasks.map((t) => t.targetFanpageId);
          const expandedCommentDisabled = scheduledTasks.map((t) => t.commentDisabled);
          const expandedGroupCommentEnabled = scheduledTasks.map((t) => t.groupCommentEnabled);
          const expandedIncludeCredits = scheduledTasks.map((t) => t.includeCredit);
          const expandedColorBackgrounds = scheduledTasks.map((t) => t.colorBackground);
          const expandedColorBackgroundPresets = scheduledTasks.map((t) => t.colorBackgroundPreset || null);

          const isFirstImmediate = validItems[0].isNow;

          const payload = {
            urls: expandedUrls,
            scheduledTimes: expandedScheduledTimes,
            intervalMinutes: batchInterval,
            publishNow: isFirstImmediate,
            ...scheduleBody,
            groupTimingMode,
            groupSpreadStart: groupSpreadStart.format('YYYY-MM-DDTHH:mm:ss'),
            groupSpreadEnd: groupSpreadEnd.format('YYYY-MM-DDTHH:mm:ss'),
            targetFanpageId: expandedTargetFanpageIdsList[0] || selectedFanpageIds[0] || values.targetFanpageId,
            targetFanpageIds: expandedTargetFanpageIdsList,
            targetGroupNamesList: expandedTargetGroupNamesList,
            affiliateLink: effectiveDefaultComment,
            affiliateLinks: expandedAffiliateLinks,
            includeCredits: expandedIncludeCredits,
            commentDisabled: expandedCommentDisabled,
            groupCommentEnabled: expandedGroupCommentEnabled,
            colorBackgrounds: expandedColorBackgrounds,
            colorBackgroundPresets: expandedColorBackgroundPresets,
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
        const colorBackgroundPresets = validItems.map((i) => i.colorBackgroundPreset || null);

        const hasPerItemExtraGroups = validItems.some((i) => (i.extraGroupIds?.length || 0) > 0);
        const targetGroupNamesList = hasPerItemExtraGroups
          ? validItems.map((i) => (i.extraGroupIds && i.extraGroupIds.length > 0 ? i.extraGroupIds.join(',') : null))
          : undefined;

        const atStart = scheduleChoice.at || dayjs();
        const perPostScheduledTimes = scheduleChoice.mode === 'AT' && validItems.some((i) => i.customTime)
          ? validItems.map((i, idx) => (i.customTime && i.scheduledAt ? i.scheduledAt : autoTimeOf(atStart, batchInterval, idx)).format('YYYY-MM-DDTHH:mm:ss'))
          : undefined;

        const payload = {
          urls,
          scheduledTimes: effectiveScheduledTimes,
          intervalMinutes: batchInterval,
          publishNow: isFirstImmediate,
          ...scheduleBody,
          ...(perPostScheduledTimes ? { scheduledTimes: perPostScheduledTimes } : {}),
          targetFanpageId: (effectiveTargetFanpageIds && effectiveTargetFanpageIds.length > 0) ? effectiveTargetFanpageIds[0] : (Array.isArray(values.targetFanpageId) ? values.targetFanpageId[0] : values.targetFanpageId),
          targetFanpageIds: effectiveTargetFanpageIds,
          affiliateLink: effectiveDefaultComment,
          affiliateLinks,
          includeCredits,
          commentDisabled,
          groupCommentEnabled,
          colorBackgrounds,
          colorBackgroundPresets,
          customCaptions,
          customMediaUrls,
          groupNames: effectiveGroupNames,
          ...(targetGroupNamesList ? { targetGroupNamesList } : {}),
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
        // CHỈ dùng bình luận khi người dùng chủ động điền vào ô affiliateLink
        const effectiveDefaultComment = values.affiliateLink?.trim() || form.getFieldValue('affiliateLink')?.trim() || undefined;

        const rawGroupTasks: GroupScheduleTask[] = [];

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

          const rawItemTarget = customItemTargets[i.id];
          const itemTarget = (rawItemTarget && selectedFanpageIds.includes(rawItemTarget)) ? rawItemTarget : undefined;
          const resolvedGroups = resolveItemGroupTargets(selectedGroupIds, i.extraGroupIds, groupDistributionMode, itemIdx);

          const pushGroupOnlyTask = (gId: string, fId: string) => {
            const finalAffLink = resolveAffiliateLinkForGroup(gId, baseAffLink);
            rawGroupTasks.push({
              itemUrl,
              itemCaption,
              itemMedia,
              finalAffLink,
              targetGroupId: isAnonymous ? `GROUP_ONLY_ANON:${gId}` : `GROUP_ONLY:${gId}`,
              targetFanpageId: fId,
              commentDisabled: Boolean(i.skipComment),
              groupCommentEnabled: Boolean(i.groupCommentEnabled) && isGroupCommentAllowedForGroup(gId),
              includeCredit: i.includeCredit !== false,
              colorBackground: Boolean(i.colorBackground),
              colorBackgroundPreset: i.colorBackgroundPreset,
            });
          };

          if (itemTarget) {
            resolvedGroups.forEach((gId) => pushGroupOnlyTask(gId, itemTarget));
          } else if (groupDistributionMode === 'PAGE_PER_GROUP') {
            resolvedGroups.forEach((gId, gIdx) => {
              pushGroupOnlyTask(gId, selectedFanpageIds[(gIdx + itemIdx) % selectedFanpageIds.length]);
            });
          } else if (groupDistributionMode === 'ROUND_ROBIN_POSTS') {
            const fId = selectedFanpageIds[itemIdx % selectedFanpageIds.length];
            resolvedGroups.forEach((gId) => pushGroupOnlyTask(gId, fId));
          } else {
            resolvedGroups.forEach((gId) => {
              selectedFanpageIds.forEach((fId) => pushGroupOnlyTask(gId, fId));
            });
          }
        });

        const baseTime = validItems[0]?.isNow ? dayjs() : (validItems[0]?.scheduledAt || dayjs());
        const scheduledGroupTasks = distributeGroupTasks(rawGroupTasks, {
          timingMode: groupTimingMode,
          staggerIntervalMinutes: groupStaggerInterval,
          spreadStart: groupSpreadStart,
          spreadEnd: groupSpreadEnd,
          baseTime,
        });

        const expandedUrls = scheduledGroupTasks.map((t) => t.itemUrl);
        const expandedScheduledTimes = scheduledGroupTasks.map((t) => t.scheduledIso);
        const expandedCustomCaptions = scheduledGroupTasks.map((t) => t.itemCaption);
        const expandedCustomMediaUrls = scheduledGroupTasks.map((t) => t.itemMedia);
        const expandedAffiliateLinks = scheduledGroupTasks.map((t) => t.finalAffLink);
        const expandedTargetGroupNamesList = scheduledGroupTasks.map((t) => t.targetGroupId);
        const expandedTargetFanpageIdsList = scheduledGroupTasks.map((t) => t.targetFanpageId);
        const expandedCommentDisabled = scheduledGroupTasks.map((t) => t.commentDisabled);
        const expandedGroupCommentEnabled = scheduledGroupTasks.map((t) => t.groupCommentEnabled);
        const expandedIncludeCredits = scheduledGroupTasks.map((t) => t.includeCredit);
        const expandedColorBackgrounds = scheduledGroupTasks.map((t) => t.colorBackground);
        const expandedColorBackgroundPresets = scheduledGroupTasks.map((t) => t.colorBackgroundPreset || null);

        const isFirstImmediate = validItems[0].isNow;

        const payload = {
          urls: expandedUrls,
          scheduledTimes: expandedScheduledTimes,
          groupTimingMode,
          groupSpreadStart: groupSpreadStart.format('YYYY-MM-DDTHH:mm:ss'),
          groupSpreadEnd: groupSpreadEnd.format('YYYY-MM-DDTHH:mm:ss'),
          pageId: expandedTargetFanpageIdsList[0] ? expandedTargetFanpageIdsList[0].split(':')[0] : pageId,
          targetFanpageId: expandedTargetFanpageIdsList[0] || selectedFanpageIds[0],
          targetFanpageIds: expandedTargetFanpageIdsList,
          targetGroupNamesList: expandedTargetGroupNamesList,
          publishNow: isFirstImmediate,
          ...scheduleBody,
          intervalMinutes: batchInterval,
          affiliateLink: effectiveDefaultComment,
          affiliateLinks: expandedAffiliateLinks,
          commentDisabled: expandedCommentDisabled,
          groupCommentEnabled: expandedGroupCommentEnabled,
          includeCredits: expandedIncludeCredits,
          colorBackgrounds: expandedColorBackgrounds,
          colorBackgroundPresets: expandedColorBackgroundPresets,
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

  const isFirstItemImmediate = scheduleChoice.mode === 'NOW';


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
              <span className="text-xs font-mono text-slate-300">#{record.id}</span>
              {resolvePosterIdentityName(record) && (
                <Tooltip title={`Đăng bài với danh nghĩa: ${resolvePosterIdentityName(record)} · Nhấn để ${historyPageFilter === resolvePosterIdentityName(record) ? 'bỏ lọc' : 'lọc xem chỉ bài của Page này'}`}>
                  <Tag
                    className="!m-0 !text-xs font-bold cursor-pointer hover:opacity-85 transition-all"
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
                  <Tag className="!m-0 !text-xs" color={isAnon ? "green" : "purple"} icon={<TeamOutlined />}>
                    {isAnon
                      ? `Nhóm Ẩn danh (${resolvedGroupNames.length === 1 ? resolvedGroupNames[0] : groupCount})`
                      : (resolvedGroupNames.length === 1 ? resolvedGroupNames[0] : `Chỉ Nhóm (${groupCount})`)}
                  </Tag>
                </Tooltip>
              ) : (
                <Tooltip title={groupCount > 0 ? `Đã chia sẻ thêm vào Nhóm: ${resolvedGroupNames.join(', ')}` : undefined}>
                  <Tag className="!m-0 !text-xs" color={groupCount > 0 ? 'cyan' : 'blue'}>
                    {groupCount === 0 ? 'Chỉ Fanpage' : groupCount === 1 ? `Page + Nhóm: ${resolvedGroupNames[0]}` : `Page + ${groupCount} nhóm`}
                  </Tag>
                </Tooltip>
              )}
              {record.originalUrl && (
                <a
                  href={record.originalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-400 font-medium hover:underline inline-flex items-center gap-1"
                >
                  <LinkOutlined /> Bài gốc
                </a>
              )}
              {record.affiliateLink && (record.targetGroupNames ? !!record.enableGroupComment : true) && (
                <Tooltip title={`Bình luận tự động: ${record.affiliateLink}`}>
                  <Tag className="!m-0 !text-xs" color="gold" icon={<MessageOutlined />}>
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
                <Tag icon={<CheckCircleOutlined />} color="cyan" className="!text-xs !m-0 font-semibold">
                  💬 Đã bình luận
                </Tag>
              )}

              {activeRetryProgress && activeRetryProgress.status === 'RUNNING' && (
                <div className="w-full min-w-[145px] rounded-lg border border-blue-500/30 bg-blue-950/40 px-2.5 py-1.5 backdrop-blur-xs">
                  <div className="mb-1 text-xs font-semibold text-blue-300 truncate">
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
              <div className="text-xs text-purple-300 font-mono flex items-center gap-1 animate-pulse">
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
                <Tag color="default" className="!text-xs !m-0 text-slate-300">
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
      width: 155,
      render: (_: any, record: PostQueue) => {
        const groupUrls = (record.publishedGroupPostUrls || '').split(',').map((u) => u.trim()).filter(Boolean);
        const links: { url: string; label: string }[] = [];
        if (record.publishedPostUrl) links.push({ url: record.publishedPostUrl, label: 'Bài đã đăng' });
        groupUrls.forEach((url, idx) => links.push({ url, label: groupUrls.length > 1 ? `Nhóm ${idx + 1}` : 'Bài trong Nhóm' }));
        if (links.length === 0) {
          return <span className="text-xs text-slate-300">—</span>;
        }
        return (
          <div className="flex flex-col gap-0.5">
            {links.map((l, idx) => (
              <a
                key={idx}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-400 font-medium hover:underline inline-flex items-center gap-1"
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
      width: 185,
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
                <div className="text-xs text-slate-300 font-mono flex items-center gap-1 mt-1">
                  <span>📅 Hẹn:</span>
                  <span className="text-slate-200">{dayjs(record.scheduledAt).format('HH:mm · DD/MM')}</span>
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
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 text-xs font-mono font-bold mt-1 shadow-2xs"
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
              <div className="text-xs text-slate-300 font-mono">
                {pubTime ? dayjs(pubTime).format('DD/MM/YYYY') : ''}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-xs font-medium">
                  <CheckCircleOutlined className="text-xs" /> Đã đăng
                </span>
                {durationBadge}
              </div>
            </div>
          );
        }

        if (record.status === 'PENDING') {
          const schedTime = record.scheduledAt || record.createdAt;
          return (
            <button
              type="button"
              className="queue-time-edit flex flex-col gap-0.5 text-left"
              title="Bấm để đổi giờ đăng"
              onClick={() => {
                setReschedulingPost(record);
                setNewScheduleTime(record.scheduledAt ? dayjs(record.scheduledAt) : dayjs().add(15, 'minute'));
              }}
            >
              <div className="font-bold text-amber-300 font-mono text-sm leading-tight flex items-center gap-1.5">
                {schedTime ? dayjs(schedTime).format('HH:mm') : '-'}
                <EditOutlined className="queue-time-edit-icon text-xs" />
              </div>
              <div className="text-xs text-slate-300 font-mono">
                {schedTime ? dayjs(schedTime).format('DD/MM/YYYY') : ''}
              </div>
              <div className="mt-0.5">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/25 text-xs font-medium shadow-2xs">
                  <ClockCircleOutlined className="text-xs" /> Hẹn đăng
                </span>
              </div>
            </button>
          );
        }

        // FAILED or CANCELLED
        const failTime = record.updatedAt || record.scheduledAt || record.createdAt;
        return (
          <div className="flex flex-col gap-0.5">
            <div className="font-bold text-rose-300 font-mono text-sm leading-tight">
              {failTime ? dayjs(failTime).format('HH:mm') : '-'}
            </div>
            <div className="text-xs text-slate-300 font-mono">
              {failTime ? dayjs(failTime).format('DD/MM/YYYY') : ''}
            </div>
            <div className="mt-0.5">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/25 text-xs font-medium shadow-2xs">
                <CloseCircleOutlined className="text-xs" /> Lỗi đăng
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

  const composableItems = linkItems.filter(isComposableItem);
  const customTimeCount = composableItems.filter((i) => i.customTime).length;
  const canSetPerPostTimes = scheduleChoice.mode === 'AT' && postMode === 'FANPAGE_ONLY' && composableItems.length > 0;
  const queueModeControl = (
    <>
      <ScheduleChoice value={scheduleChoice} onChange={setScheduleChoice} size="small" />
      {canSetPerPostTimes && (
        <Button type="link" size="small" className="per-post-times-link" onClick={() => setPerPostTimesOpen(true)}>
          Đặt giờ từng bài ({composableItems.length}){customTimeCount > 0 ? ` · đã đặt ${customTimeCount}` : ''}
        </Button>
      )}
    </>
  );

  // Options chọn nơi đăng cho từng bài; viaNameOf đọc socialAccounts + viaNameByCUser nên dùng chúng làm deps
  const postItemTargetOptions = useMemo(() => postingIdentities.map((fp) => ({
    value: accountTargetValue(fp),
    label: fp.platformAccountId === 'PERSONAL_PROFILE' || fp.platform === 'FACEBOOK_PERSONAL'
      ? (isAnonymous ? `🕵️ ${fp.pageName || 'Nick Cá Nhân'} (Ẩn danh)` : `${fp.pageName || '👤 Nick Cá Nhân'}`)
      : `🚩 ${fp.pageName || fp.platformAccountId}${viaNameOf(fp) ? ` · ${viaNameOf(fp)}` : ''}`,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [postingIdentities, isAnonymous, socialAccounts, viaNameByCUser]);

  const swipeReviewModalOpened = useOpenedOnce(swipeReviewOpen);
  const bulkPasteDrawerOpened = useOpenedOnce(bulkModalVisible);
  const viralHunterDrawerOpened = useOpenedOnce(hunterDrawerVisible);
  const groupHunterDrawerOpened = useOpenedOnce(groupHunterDrawerVisible);
  const distributeModalOpened = useOpenedOnce(distributeModalOpen);
  const articleBatchModalOpened = useOpenedOnce(showArticleBatchModal);
  const savePresetModalOpened = useOpenedOnce(savePresetModalOpen);
  const managePresetsModalOpened = useOpenedOnce(managePresetsModalOpen);
  const resetFailedModalOpened = useOpenedOnce(resetFailedModalVisible);
  const reassignNickModalOpened = useOpenedOnce(reassignModalVisible);
  const kpiTargetsModalOpened = useOpenedOnce(kpiModalOpen);
  const diagnosticsDrawerOpened = useOpenedOnce(!!diagnosingPost);
  const groupCheckModalOpened = useOpenedOnce(groupCheckModalVisible);
  const customCreModalOpened = useOpenedOnce(isCustomCreModalOpen);
  const hashtagModalOpened = useOpenedOnce(isHashtagModalOpen);

  const postItemActions = useStableActions({
    openNewsCardForItem,
    openTextCardForItem,
    isMediaVideo,
    setMediaViewer,
    handleMediaDragStart,
    handleMediaDragOver,
    handleMediaDragEnd,
    handleMediaDrop,
    moveMediaItem,
    removeMediaItem,
    handlePreviewLink,
    setLinkItems,
    setManualMediaUrlInputs,
    accountTargetValue,
    setCustomItemTargets,
    updateLinkUrl,
    updateLinkAffiliate,
    updateLinkCustomCaption,
    updateLinkInputType,
    updateLinkManualContent,
    handleUploadMedia,
    handlePasteMediaFromClipboard,
    handlePasteFromClipboardButton,
    handleAddManualMediaUrl,
    moveManualMediaItem,
    removeManualMediaItem,
    toggleCommentBox,
    toggleIncludeCredit,
    toggleColorBackground,
    replaceOrAppendCreditText,
    applyAnonymousCreditToAll,
    toUnicodeBold,
    toUnicodeSerifBold,
    toUnicodeItalic,
    toUnicodeBoldItalic,
    toUnicodeStrikethrough,
    toUnicodeUnderline,
    toUnicodeBoxedTag,
    toUnicodeHeading1,
    toUnicodeHeading2,
    applyTransformToSelection,
    insertSnippetAtCursor,
    setDragOverDropzone,
    toggleSkipComment,
    toggleGroupComment,
    updateLinkMode,
    updateLinkTime,
    removeLinkItem,
    updateLinkExtraGroupIds,
  });

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
          {/* Thanh Tiến Trình 4 Bước — 1 hàng 4 cột, click chuyển tới từng bước, hiển thị trạng thái hoàn thành */}
          {(() => {
            const hasTarget = activeSelectedFanpageIds.length > 0 && (postMode === 'FANPAGE_ONLY' || activeSelectedGroupIds.length > 0);
            const hasContent = validLinkCount > 0;
            const readyToPublish = hasTarget && hasContent;
            const modeShort = postMode === 'FANPAGE_ONLY' ? 'Chỉ Fanpage' : postMode === 'GROUP_ONLY' ? 'Chỉ vào Nhóm' : 'Page + Nhóm';
            const targetSub = hasTarget
              ? (postMode === 'FANPAGE_ONLY'
                  ? `${activeSelectedFanpageIds.length} Page/Via`
                  : `${activeSelectedGroupIds.length} nhóm · ${activeSelectedFanpageIds.length} nick`)
              : 'Chọn Page & Nhóm';
            const contentSub = hasContent ? `${validLinkCount} bài` : 'Chưa có bài';
            const submitSub = readyToPublish
              ? (scheduleChoice.mode === 'QUEUE' ? 'Xếp lịch' : scheduleChoice.mode === 'NOW' ? 'Đăng ngay' : 'Hẹn giờ')
              : 'Chưa sẵn sàng';

            const steps = [
              { id: 'poster-step-1', num: 1, title: 'Cách xuất bản', sub: modeShort, done: true, active: false, cta: false },
              { id: 'poster-step-2', num: 2, title: 'Nơi đăng & Via', sub: targetSub, done: hasTarget, active: !hasTarget, cta: false },
              { id: 'poster-step-3', num: 3, title: 'Soạn nội dung', sub: contentSub, done: hasContent, active: hasTarget && !hasContent, cta: false },
              { id: 'poster-step-4', num: 4, title: 'Xuất bản', sub: submitSub, done: false, active: false, cta: readyToPublish },
            ];

            return (
              <nav className="poster-flow-bar select-none" aria-label="Quy trình 4 bước đăng bài">
                {steps.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className={`poster-flow-step ${s.cta ? 'is-ready-cta' : s.active ? 'is-active' : s.done ? 'is-done' : ''}`}
                    title={`Chuyển tới Bước ${s.num}: ${s.title}`}
                  >
                    <span className="poster-flow-step-num">
                      {s.cta ? <RocketOutlined /> : s.done ? <CheckCircleOutlined /> : s.num}
                    </span>
                    <span className="poster-flow-step-body">
                      <span className="poster-flow-step-title">{s.title}</span>
                      <span className="poster-flow-step-sub">{s.sub}</span>
                    </span>
                    {idx < steps.length - 1 && (
                      <span className="poster-flow-step-arrow" aria-hidden="true">
                        <RightOutlined />
                      </span>
                    )}
                  </button>
                ))}
              </nav>
            );
          })()}

          <div id="poster-step-1" className="poster-section-heading">
            <span className="poster-step-number">1</span>
            <div>
              <h2>Chọn cách xuất bản</h2>
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
                title: 'Fanpage + Nhóm',
                sub: 'Lên tường Fanpage & tự động chia sẻ vào nhóm',
                icon: <RocketOutlined className="text-base" />,
                activeCard: 'from-purple-950/60 via-slate-900/95 to-slate-950/95 border-purple-500/70 shadow-lg shadow-purple-950/50 ring-1 ring-purple-400/40',
                activeIcon: 'bg-gradient-to-br from-purple-500/25 to-indigo-500/20 text-purple-300 border border-purple-400/40 shadow-sm shadow-purple-950/40',
                badgeBg: 'bg-purple-500',
              },
              {
                id: 'GROUP_ONLY',
                title: 'Chỉ đăng Nhóm',
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
                  className={`relative flex items-center gap-3 p-3 rounded-2xl text-left transition-all duration-200 cursor-pointer select-none border group ${
                    active
                      ? `bg-gradient-to-br ${mode.activeCard} translate-y-[-1px]`
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-800/80 hover:translate-y-[-1px]'
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center transition-all ${
                      active ? mode.activeIcon : 'bg-slate-800/80 border border-slate-700/60 text-slate-400 group-hover:text-slate-200'
                    }`}
                  >
                    {mode.icon}
                  </div>
                  <div className="min-w-0 flex-1 pr-6">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm leading-snug text-slate-100" title={mode.sub}>
                        {mode.title}
                      </span>
                    </div>
                  </div>
                  {active && (
                    <div className={`absolute top-1/2 -translate-y-1/2 right-3 w-5 h-5 rounded-full ${mode.badgeBg} text-white flex items-center justify-center text-xs shadow-md shadow-black/40`}>
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
            <ComposeTargetSection
              form={form}
              postMode={postMode}
              groupStaggerInterval={groupStaggerInterval}
              setGroupStaggerInterval={setGroupStaggerInterval}
              groupTimingMode={groupTimingMode}
              setGroupTimingMode={setGroupTimingMode}
              groupSpreadStart={groupSpreadStart}
              setGroupSpreadStart={setGroupSpreadStart}
              groupSpreadEnd={groupSpreadEnd}
              setGroupSpreadEnd={setGroupSpreadEnd}
              validLinkCount={validLinkCount}
              setQuickCookieModalOpen={setQuickCookieModalOpen}
              setQuickCookieTargetId={setQuickCookieTargetId}
              playwrightAccounts={playwrightAccounts}
              personalAccountTargets={personalAccountTargets}
              accountTargetValue={accountTargetValue}
              pageCountByCUser={pageCountByCUser}
              viaNameOf={viaNameOf}
              coAdminViasByPageName={coAdminViasByPageName}
              groupAccountsWithId={groupAccountsWithId}
              selectedTargetAccount={selectedTargetAccount}
              isCurrentTargetExpired={isCurrentTargetExpired}
              hasMultipleGroupsSelected={hasMultipleGroupsSelected}
              setIsMultiDistributeActive={setIsMultiDistributeActive}
              setMultiSelectedTargets={setMultiSelectedTargets}
              setDistributionStrategy={setDistributionStrategy}
              distributionStrategy={distributionStrategy}
              staggerIntervalMinutes={staggerIntervalMinutes}
              setStaggerIntervalMinutes={setStaggerIntervalMinutes}
              isAnonymous={isAnonymous}
              setIsAnonymous={setIsAnonymous}
              setGroupDistributionMode={setGroupDistributionMode}
              groupDistributionMode={groupDistributionMode}
              activeSelectedGroupIds={activeSelectedGroupIds}
              activeSelectedFanpageIds={activeSelectedFanpageIds}
              validPersonalVias={validPersonalVias}
              twoMainVias={twoMainVias}
              twoMainViasDisplayNames={twoMainViasDisplayNames}
              isTwoViaActive={isTwoViaActive}
              handleQuickSelectTwoVias={handleQuickSelectTwoVias}
              handleQuickSelectAllVias={handleQuickSelectAllVias}
              handleQuickSelectAllPages={handleQuickSelectAllPages}
              selectedCoAdminPageNames={selectedCoAdminPageNames}
              isAllCoAdminsSelected={isAllCoAdminsSelected}
              handleAutoSelectBothViasForSelectedPages={handleAutoSelectBothViasForSelectedPages}
              handleResetToSingleTarget={handleResetToSingleTarget}
              savedPresets={savedPresets}
              selectedPresetId={selectedPresetId}
              setSelectedPresetId={setSelectedPresetId}
              setSavePresetModalOpen={setSavePresetModalOpen}
              setNewPresetName={setNewPresetName}
              setManagePresetsModalOpen={setManagePresetsModalOpen}
              setEditingPreset={setEditingPreset}
              setEditingPresetName={setEditingPresetName}
              applyPreset={applyPreset}
              handleUpdatePresetWithCurrent={handleUpdatePresetWithCurrent}
              handleDeletePreset={handleDeletePreset}
              handleAutoSpreadPagesForGroups={handleAutoSpreadPagesForGroups}
              unifiedAccountOptions={unifiedAccountOptions}
              unifiedGroupOptions={unifiedGroupOptions}
              calculatedTotalQueueCount={calculatedTotalQueueCount}
              setGroupCheckModalVisible={setGroupCheckModalVisible}
            />

            {/* Danh sách nội dung và lịch đăng */}
            <ComposeContentSection
              postMode={postMode}
              previews={previews}
              setDistributeModalOpen={setDistributeModalOpen}
              selectedDistributePages={selectedDistributePages}
              setSelectedDistributePages={setSelectedDistributePages}
              draggedMedia={draggedMedia}
              dragOverMedia={dragOverMedia}
              linkItems={linkItems}
              manualMediaUrlInputs={manualMediaUrlInputs}
              setShowArticleBatchModal={setShowArticleBatchModal}
              onOpenTextBulk={() => setTextBulkOpen(true)}
              swipeReviewItems={swipeReviewItems}
              openSwipeReview={openSwipeReview}
              setBatchToolsOpen={setBatchToolsOpen}
              batchToolsOpen={batchToolsOpen}
              setBulkModalVisible={setBulkModalVisible}
              setBulkText={setBulkText}
              bulkText={bulkText}
              smartDispatchSummary={smartDispatchSummary}
              setHunterDrawerVisible={setHunterDrawerVisible}
              setGroupHunterDrawerVisible={setGroupHunterDrawerVisible}
              validLinkCount={validLinkCount}
              playwrightAccounts={playwrightAccounts}
              postingIdentities={postingIdentities}
              accountTargetValue={accountTargetValue}
              viaNameOf={viaNameOf}
              watchedTargetFanpageId={watchedTargetFanpageId}
              defaultCommentPreview={defaultCommentPreview}
              previewAuthorName={previewAuthorName}
              isMultiDistributeActive={isMultiDistributeActive}
              distributionStrategy={distributionStrategy}
              staggerIntervalMinutes={staggerIntervalMinutes}
              setCustomItemTargets={setCustomItemTargets}
              customItemTargets={customItemTargets}
              groupDistributionMode={groupDistributionMode}
              activeSelectedFanpageIds={activeSelectedFanpageIds}
              twoMainViasDisplayNames={twoMainViasDisplayNames}
              effectiveMultiTargets={effectiveMultiTargets}
              isMatrixDistributionVisible={isMatrixDistributionVisible}
              calculatedDistribution={calculatedDistribution}
              bulkPasteSummary={bulkPasteSummary}
              addLinkItem={addLinkItem}
              applyEnableAllCredit={applyEnableAllCredit}
              applyDisableAllCredit={applyDisableAllCredit}
              applyAnonymousCreditToAll={applyAnonymousCreditToAll}
              applyOriginalAuthorCreditToAll={applyOriginalAuthorCreditToAll}
              openCustomCreModal={openCustomCreModal}
              openHashtagModal={openHashtagModal}
              resetEqualDistribution={resetEqualDistribution}
              handleSmartDispatch={handleSmartDispatch}
              dragOverDropzone={dragOverDropzone}
              applyDisableAllComments={applyDisableAllComments}
              applyEnableAllComments={applyEnableAllComments}
              applyEnableAllGroupComments={applyEnableAllGroupComments}
              applyDisableAllGroupComments={applyDisableAllGroupComments}
              handleApplyBulkPaste={handleApplyBulkPaste}
              postItemTargetOptions={postItemTargetOptions}
              groupAccountsWithId={groupAccountsWithId}
              primaryGroupIds={activeSelectedGroupIds}
              postItemActions={postItemActions}
            />

            {/* Tùy chọn nâng cao được mở theo nhu cầu, không chen vào luồng chính. */}
            <ComposeAdvancedOptions
              form={form}
              postMode={postMode}
              forceRefresh={forceRefresh}
              setForceRefresh={setForceRefresh}
              setAdvancedOpen={setAdvancedOpen}
              advancedOpen={advancedOpen}
              groupAccountsWithId={groupAccountsWithId}
              affiliateExcludedGroupIds={affiliateExcludedGroupIds}
              setAffiliateExcludedGroupIds={setAffiliateExcludedGroupIds}
              currentSelectedGroupIdsForAffiliate={currentSelectedGroupIdsForAffiliate}
              groupCommentAllowedGroupIds={groupCommentAllowedGroupIds}
              setGroupCommentAllowedGroupIds={setGroupCommentAllowedGroupIds}
              applyEnableAllGroupComments={applyEnableAllGroupComments}
            />

            <div id="poster-step-4">
            {isPosting && (
              <div className="relative overflow-hidden rounded-2xl border border-blue-500/40 bg-gradient-to-r from-blue-950/80 via-indigo-950/70 to-slate-900/90 p-4 mb-4 shadow-xl shadow-blue-950/50 backdrop-blur-md">
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
                <div className="flex justify-between items-center mt-2.5 text-xs text-slate-300">
                  <span className="flex items-center gap-1.5 text-blue-300">
                    <LoadingOutlined spin className="text-blue-400 text-xs" />
                    Tiến trình Playwright Browser
                  </span>
                  <span className="text-slate-300">Vui lòng không tắt hoặc tải lại trang</span>
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
                        <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          {calculatedTotalQueueCount} bài queue
                        </span>
                      </div>
                    </div>
                    <div className="text-xs font-semibold text-purple-200 flex items-center gap-1.5 flex-wrap">
                      <span>Chế độ:</span>
                      <span className="text-amber-300 font-bold inline-flex items-center gap-1">
                        {groupDistributionMode === 'PAGE_PER_GROUP' ? (
                          <><SafetyCertificateOutlined /> Nhân bản đủ tất cả Nhóm (Xoay vòng Page)</>
                        ) : groupDistributionMode === 'ROUND_ROBIN_POSTS' ? (
                          <><SyncOutlined /> Chia lẻ bài (Không nhân bản)</>
                        ) : (
                          <><ThunderboltOutlined /> Tất cả Page x Tất cả Nhóm</>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                    <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                      <div className="text-slate-300 text-xs font-medium mb-1 flex items-center gap-1.5">
                        <FileTextOutlined className="text-blue-400" /> Nội dung đưa vào
                      </div>
                      <div className="font-bold text-slate-100">{validLinkCount} bài viết</div>
                    </div>
                    <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                      <div className="text-slate-300 text-xs font-medium mb-1 flex items-center gap-1.5">
                        <TeamOutlined className="text-amber-400" /> Nhóm nhận bài ({selectedGroupDisplayNames.length} nhóm)
                      </div>
                      <div className="font-bold text-amber-300 truncate" title={selectedGroupDisplayNames.join(', ')}>
                        {selectedGroupDisplayNames.join(', ') || 'Chưa chọn'}
                      </div>
                    </div>
                    <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                      <div className="text-slate-300 text-xs font-medium mb-1 flex items-center gap-1.5">
                        <UserOutlined className="text-sky-400" /> Page/Nick đăng ({selectedTargetAccountNames.length} tài khoản)
                      </div>
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

{validLinkCount > 0 && (
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
                    <span>{scheduleChoice.mode === 'QUEUE' ? 'Xếp vào lịch' : scheduleChoice.mode === 'NOW' ? 'Đăng ngay' : `Hẹn ${scheduleChoice.at ? scheduleChoice.at.format('HH:mm DD/MM') : ''}`}</span>
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
                  {scheduleChoice.mode === 'QUEUE'
                    ? 'Xếp vào lịch đăng'
                    : postMode === 'GROUP_ONLY'
                      ? (isFirstItemImmediate ? 'Đăng ngay vào nhóm' : 'Lên lịch đăng vào nhóm')
                      : postMode === 'FANPAGE_ONLY'
                        ? (isFirstItemImmediate ? 'Đăng ngay lên Fanpage' : 'Lên lịch lên Fanpage')
                        : (isFirstItemImmediate ? 'Đăng ngay Page + Nhóm' : 'Lên lịch Page + Nhóm')}
                </Button>
              </div>
            </div>
            )}
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
                <dd>{postMode === 'FANPAGE_ONLY' ? 'Chỉ Fanpage' : postMode === 'GROUP_ONLY' ? 'Chỉ Nhóm' : 'Fanpage + Nhóm'}</dd>
              </div>
              <div>
                <dt>Tài khoản</dt>
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
                  <dt>Nhóm</dt>
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
                <dd className={validLinkCount ? '' : 'is-missing'}>{validLinkCount ? `${validLinkCount} bài` : 'Chưa có'}</dd>
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
              icon={isFirstItemImmediate ? <RocketOutlined /> : <ScheduleOutlined />}
              onClick={() => form.submit()}
            >
              {scheduleChoice.mode === 'QUEUE' ? 'Xếp vào lịch' : isFirstItemImmediate ? 'Đăng ngay' : 'Lên lịch đăng'}
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
                <LinkOutlined className="text-xs" />
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
      {savePresetModalOpened && (
        <Suspense fallback={null}>
          <SavePresetModal
            groupDistributionMode={groupDistributionMode}
            activeSelectedGroupIds={activeSelectedGroupIds}
            activeSelectedFanpageIds={activeSelectedFanpageIds}
            savePresetModalOpen={savePresetModalOpen}
            setSavePresetModalOpen={setSavePresetModalOpen}
            newPresetName={newPresetName}
            setNewPresetName={setNewPresetName}
            handleSaveNewPreset={handleSaveNewPreset}
          />
        </Suspense>
      )}

      {/* Modal Quản Lý Tất Cả Cấu Hình Đã Lưu */}
      {managePresetsModalOpened && (
        <Suspense fallback={null}>
          <ManagePresetsModal
            savedPresets={savedPresets}
            selectedPresetId={selectedPresetId}
            managePresetsModalOpen={managePresetsModalOpen}
            setManagePresetsModalOpen={setManagePresetsModalOpen}
            setEditingPreset={setEditingPreset}
            setEditingPresetName={setEditingPresetName}
            applyPreset={applyPreset}
            handleUpdatePresetWithCurrent={handleUpdatePresetWithCurrent}
            handleDeletePreset={handleDeletePreset}
          />
        </Suspense>
      )}

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
      {swipeReviewModalOpened && (
        <Suspense fallback={null}>
          <SwipeReviewModal
            isMediaVideo={isMediaVideo}
            setMediaViewer={setMediaViewer}
            swipeReviewOpen={swipeReviewOpen}
            setSwipeReviewOpen={setSwipeReviewOpen}
            swipeReviewIndex={swipeReviewIndex}
            setSwipeReviewIndex={setSwipeReviewIndex}
            swipeMediaIndex={swipeMediaIndex}
            setSwipeMediaIndex={setSwipeMediaIndex}
            swipeDecisions={swipeDecisions}
            swipeReviewItems={swipeReviewItems}
            activeSwipeItem={activeSwipeItem}
            activeSwipePreview={activeSwipePreview}
            activeSwipeMediaUrls={activeSwipeMediaUrls}
            activeSwipeMediaKinds={activeSwipeMediaKinds}
            activeSwipeCaption={activeSwipeCaption}
            handleSwipeDecision={handleSwipeDecision}
            handleSwipeCaptionChange={handleSwipeCaptionChange}
            handleApplySwipeReview={handleApplySwipeReview}
            replaceOrAppendCreditText={replaceOrAppendCreditText}
            openCustomCreModal={openCustomCreModal}
            openHashtagModal={openHashtagModal}
            groupAccountsWithId={groupAccountsWithId}
            primaryGroupIds={activeSelectedGroupIds}
            onExtraGroupIdsChange={updateLinkExtraGroupIds}
            onRemoveMedia={removeMediaItem}
            onToggleColorBackground={(id) => toggleColorBackground(id)}
            onSetColorBackgroundPreset={(id, key) => setLinkItems((prev) => prev.map((it) => (it.id === id ? { ...it, colorBackgroundPreset: key } : it)))}
            onOpenTextCard={(item, text) => openTextCardForItem(item, item.inputType === 'MANUAL' ? 'MANUAL' : 'LINK', text)}
            shortcutsPaused={!!textCardTarget}
          />
        </Suspense>
      )}

      {/* GIỜ ĐĂNG TỪNG BÀI (Hẹn giờ) */}
      <PerPostTimesModal
        open={perPostTimesOpen}
        onClose={() => setPerPostTimesOpen(false)}
        items={composableItems}
        previews={previews}
        start={scheduleChoice.at || dayjs().add(30, 'minute').second(0)}
        intervalMinutes={batchInterval}
        onSave={(times) => {
          setLinkItems((prev) => prev.map((it) => (times[it.id]
            ? { ...it, isNow: false, customTime: true, scheduledAt: times[it.id] }
            : (it.customTime ? { ...it, customTime: false } : it))));
          const n = Object.keys(times).length;
          message.success(n > 0 ? `Đã đặt giờ riêng cho ${n} bài.` : 'Đã về giờ tự động.');
        }}
      />

      {/* DRAWER DÁN NHANH NHIỀU LINK */}
      {bulkPasteDrawerOpened && (
        <Suspense fallback={null}>
          <BulkPasteDrawer
            scheduleChoice={scheduleChoice}
            setScheduleChoice={setScheduleChoice}
            bulkDrawerPreviews={bulkDrawerPreviews}
            setBulkDrawerPreviews={setBulkDrawerPreviews}
            isMediaVideo={isMediaVideo}
            bulkModalVisible={bulkModalVisible}
            setBulkModalVisible={setBulkModalVisible}
            bulkAutoDistributeTwoVias={bulkAutoDistributeTwoVias}
            setBulkAutoDistributeTwoVias={setBulkAutoDistributeTwoVias}
            setBulkText={setBulkText}
            bulkText={bulkText}
            groupAccountsWithId={groupAccountsWithId}
            twoMainViasDisplayNames={twoMainViasDisplayNames}
            posts={posts}
            filterHistoryDuplicates={filterHistoryDuplicates}
            setFilterHistoryDuplicates={setFilterHistoryDuplicates}
            bulkPasteSummary={bulkPasteSummary}
            currentKpiTarget={currentKpiTarget}
            bulkScrapeStats={bulkScrapeStats}
            fetchOneDrawerPreview={fetchOneDrawerPreview}
            updateDrawerPreviewCaption={updateDrawerPreviewCaption}
            moveDrawerMedia={moveDrawerMedia}
            removeDrawerMedia={removeDrawerMedia}
            resetDrawerMedia={resetDrawerMedia}
            updateDrawerComment={updateDrawerComment}
            toggleDrawerSkipComment={toggleDrawerSkipComment}
            toggleDrawerCredit={toggleDrawerCredit}
            removeUrlFromBulkText={removeUrlFromBulkText}
            fetchAllDrawerPreviews={fetchAllDrawerPreviews}
            handleApplyBulkPaste={handleApplyBulkPaste}
            handleApplyAndOpenSwipeReview={handleApplyAndOpenSwipeReview}
          />
        </Suspense>
      )}


      {/* Modal Đổi giờ đăng cho 1 bài đang Chờ đăng trong Lịch sử */}
      <Modal
        title="Đổi giờ đăng"
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
        width={440}
        className="max-w-[calc(100vw-24px)]"
      >
        <div className="py-3 space-y-3">
          <Text className="text-xs text-slate-400 block truncate" title={reschedulingPost?.title}>
            {reschedulingPost?.title || `#${reschedulingPost?.id}`}
          </Text>
          <DatePicker
            showTime
            format="HH:mm DD/MM/YYYY"
            value={newScheduleTime}
            onChange={(val) => setNewScheduleTime(val)}
            className="w-full rounded-xl"
            size="large"
            disabledDate={(current) => current && current < dayjs().startOf('day')}
            presets={[
              { label: '+30 phút', value: dayjs().add(30, 'minute').second(0) },
              { label: '+1 giờ', value: dayjs().add(1, 'hour').second(0) },
              { label: '+3 giờ', value: dayjs().add(3, 'hour').second(0) },
              { label: 'Ngày mai cùng giờ', value: (reschedulingPost?.scheduledAt ? dayjs(reschedulingPost.scheduledAt) : dayjs()).add(1, 'day').second(0) },
            ]}
          />
        </div>
      </Modal>

      <NewsCardModal
        open={!!newsCardTarget}
        source={newsCardTarget?.source || null}
        onClose={() => setNewsCardTarget(null)}
        onApply={(url) => applyNewsCardToItem(url)}
      />

      <TextBulkModal open={textBulkOpen} onClose={() => setTextBulkOpen(false)} onCreate={createTextBulkPosts} />

      <TextCardModal
        open={!!textCardTarget}
        text={textCardTarget?.text || ''}
        onClose={() => setTextCardTarget(null)}
        onApply={(url) => applyTextCardToItem(url)}
      />



      {/* Modal Chuyển toàn bộ bài lỗi về Chờ đăng (Reset Failed to Pending) */}
      {resetFailedModalOpened && (
        <Suspense fallback={null}>
          <ResetFailedModal
            isBulkProcessing={isBulkProcessing}
            resetFailedModalVisible={resetFailedModalVisible}
            setResetFailedModalVisible={setResetFailedModalVisible}
            resetFailedMode={resetFailedMode}
            setResetFailedMode={setResetFailedMode}
            resetFailedSpacing={resetFailedSpacing}
            setResetFailedSpacing={setResetFailedSpacing}
            postCounts={postCounts}
            handleResetFailedBatch={handleResetFailedBatch}
          />
        </Suspense>
      )}

      {/* Modal Chuyển Nick / Cân bằng tải cho các bài đã chọn */}
      {reassignNickModalOpened && (
        <Suspense fallback={null}>
          <ReassignNickModal
            selectedRowKeys={selectedRowKeys}
            reassignModalVisible={reassignModalVisible}
            setReassignModalVisible={setReassignModalVisible}
            setReassignSelectedNicks={setReassignSelectedNicks}
            reassignSelectedNicks={reassignSelectedNicks}
            reassignRescheduleToday={reassignRescheduleToday}
            setReassignRescheduleToday={setReassignRescheduleToday}
            isReassigning={isReassigning}
            postingIdentities={postingIdentities}
            accountTargetValue={accountTargetValue}
            pageCountByCUser={pageCountByCUser}
            validPersonalVias={validPersonalVias}
            twoMainViasTargetValues={twoMainViasTargetValues}
            twoMainViasDisplayNames={twoMainViasDisplayNames}
            handleApplyReassignNicks={handleApplyReassignNicks}
          />
        </Suspense>
      )}

      {/* Modal Đặt/sửa KPI hôm nay cho Fanpage & từng Group */}
      {kpiTargetsModalOpened && (
        <Suspense fallback={null}>
          <KpiTargetsModal
            kpiFanpageAccounts={kpiFanpageAccounts}
            kpiGroupAccounts={kpiGroupAccounts}
            groupIdentityMap={groupIdentityMap}
            setGroupIdentityMutation={setGroupIdentityMutation}
            bulkGroupFanpageId={bulkGroupFanpageId}
            setBulkGroupFanpageId={setBulkGroupFanpageId}
            bulkGroupApplying={bulkGroupApplying}
            applyBulkGroupIdentity={applyBulkGroupIdentity}
            kpiModalOpen={kpiModalOpen}
            setKpiModalOpen={setKpiModalOpen}
            kpiDrafts={kpiDrafts}
            setKpiDrafts={setKpiDrafts}
            setTargetMutation={setTargetMutation}
            handleSaveKpi={handleSaveKpi}
          />
        </Suspense>
      )}

      {/* BẢNG LỊCH SỬ ĐĂNG BÀI VỚI BỘ LỌC THÔNG MINH */}
      {workspaceTab === 'history' && (
        <HistoryPanel
          selectedRowKeys={selectedRowKeys}
          setSelectedRowKeys={setSelectedRowKeys}
          onRepack={handleRepackQueue}
          onSpreadGroups={handleSpreadGroupsQueue}
          isBulkProcessing={isBulkProcessing}
          setReassignModalVisible={setReassignModalVisible}
          setReassignSelectedNicks={setReassignSelectedNicks}
          isReassigning={isReassigning}
          setResetFailedModalVisible={setResetFailedModalVisible}
          historyGroupFilter={historyGroupFilter}
          setHistoryGroupFilter={setHistoryGroupFilter}
          setHistoryPageFilter={setHistoryPageFilter}
          historyPageFilter={historyPageFilter}
          setHistoryStatusFilter={setHistoryStatusFilter}
          historyStatusFilter={historyStatusFilter}
          historySearchText={historySearchText}
          setHistorySearchText={setHistorySearchText}
          historyOpen={historyOpen}
          setHistoryOpen={setHistoryOpen}
          groupAccountsWithId={groupAccountsWithId}
          resolvePosterIdentityName={resolvePosterIdentityName}
          posts={posts}
          isLoading={isLoading}
          postCounts={postCounts}
          filteredHistoryPosts={filteredHistoryPosts}
          groupStatsMap={groupStatsMap}
          currentPendingDistribution={currentPendingDistribution}
          handleBulkPublishNow={handleBulkPublishNow}
          handleBulkDelete={handleBulkDelete}
          handleRetryAllFailed={handleRetryAllFailed}
          handleDeleteAllFailed={handleDeleteAllFailed}
          columns={columns}
          historyTablePage={historyTablePage}
          setHistoryTablePage={setHistoryTablePage}
        />
      )}

      {diagnosticsDrawerOpened && (
        <Suspense fallback={null}>
          <DiagnosticsDrawer
            navigate={navigate}
            diagnosingPost={diagnosingPost}
            setDiagnosingPost={setDiagnosingPost}
            setQuickCookieModalOpen={setQuickCookieModalOpen}
            setQuickCookieTargetId={setQuickCookieTargetId}
            socialAccounts={socialAccounts}
            diagnosticLog={diagnosticLog}
            diagnosticLoading={diagnosticLoading}
            diagnosticLoadError={diagnosticLoadError}
            refetchDiagnostic={refetchDiagnostic}
            diagnosticEvidence={diagnosticEvidence}
            copyDiagnostic={copyDiagnostic}
          />
        </Suspense>
      )}

      {/* Component Modal Chi tiết bài đăng phong cách Workspace hiện đại */}
      <PostDetailModal
        open={!!detailPost}
        post={detailPost}
        onClose={() => setDetailPost(null)}
        onDiagnose={(p) => setDiagnosingPost(p as any)}
        onRepost={(p) => repostMutation.mutate(p as any)}
      />

      {/* Drawer Săn Kênh TikTok Viral */}
      {viralHunterDrawerOpened && (
        <Suspense fallback={null}>
          <ViralHunterDrawer
            hunterDrawerVisible={hunterDrawerVisible}
            setHunterDrawerVisible={setHunterDrawerVisible}
            hunterTarget={hunterTarget}
            setHunterTarget={setHunterTarget}
            setHunterLimit={setHunterLimit}
            hunterLimit={hunterLimit}
            hunterMinViews={hunterMinViews}
            setHunterMinViews={setHunterMinViews}
            hunterDurationFilter={hunterDurationFilter}
            setHunterDurationFilter={setHunterDurationFilter}
            hunterSortBy={hunterSortBy}
            setHunterSortBy={setHunterSortBy}
            setHunterUltraHD={setHunterUltraHD}
            hunterUltraHD={hunterUltraHD}
            setHunterHideImported={setHunterHideImported}
            hunterHideImported={hunterHideImported}
            setHunterAutoSchedule={setHunterAutoSchedule}
            hunterAutoSchedule={hunterAutoSchedule}
            hunterLoading={hunterLoading}
            hunterResults={hunterResults}
            hunterSelectedIds={hunterSelectedIds}
            setHunterSelectedIds={setHunterSelectedIds}
            handleHuntChannel={handleHuntChannel}
            filteredAndSortedHunterVideos={filteredAndSortedHunterVideos}
            handleImportHunterVideos={handleImportHunterVideos}
          />
        </Suspense>
      )}

      {/* ── DRAWER SĂN / QUÉT BÀI VIẾT FACEBOOK GROUP ── */}
      {groupHunterDrawerOpened && (
        <Suspense fallback={null}>
          <GroupHunterDrawer
            groupHunterDrawerVisible={groupHunterDrawerVisible}
            setGroupHunterDrawerVisible={setGroupHunterDrawerVisible}
            groupHunterTarget={groupHunterTarget}
            setGroupHunterTarget={setGroupHunterTarget}
            groupHunterLimit={groupHunterLimit}
            setGroupHunterLimit={setGroupHunterLimit}
            groupHunterDateRange={groupHunterDateRange}
            setGroupHunterDateRange={setGroupHunterDateRange}
            groupHunterMediaFilter={groupHunterMediaFilter}
            setGroupHunterMediaFilter={setGroupHunterMediaFilter}
            setGroupHunterSkipImported={setGroupHunterSkipImported}
            groupHunterSkipImported={groupHunterSkipImported}
            setGroupHunterAutoSchedule={setGroupHunterAutoSchedule}
            groupHunterAutoSchedule={groupHunterAutoSchedule}
            groupHunterInterval={groupHunterInterval}
            setGroupHunterInterval={setGroupHunterInterval}
            groupHunterLoading={groupHunterLoading}
            groupHunterResults={groupHunterResults}
            setGroupHunterResults={setGroupHunterResults}
            groupHunterAiCurating={groupHunterAiCurating}
            setGroupHunterAiOnlyQuality={setGroupHunterAiOnlyQuality}
            groupHunterAiOnlyQuality={groupHunterAiOnlyQuality}
            groupHunterScheduleMode={groupHunterScheduleMode}
            setGroupHunterScheduleMode={setGroupHunterScheduleMode}
            setGroupHunterBatchAiOpen={setGroupHunterBatchAiOpen}
            groupHunterBatchAiOpen={groupHunterBatchAiOpen}
            groupHunterBatchAiMode={groupHunterBatchAiMode}
            setGroupHunterBatchAiMode={setGroupHunterBatchAiMode}
            groupHunterBatchAiLoading={groupHunterBatchAiLoading}
            setGroupHunterBatchAiProgress={setGroupHunterBatchAiProgress}
            groupHunterBatchAiProgress={groupHunterBatchAiProgress}
            setGroupHunterPreviewItem={setGroupHunterPreviewItem}
            groupHunterPreviewItem={groupHunterPreviewItem}
            groupHunterGroupName={groupHunterGroupName}
            groupHunterCustomName={groupHunterCustomName}
            setGroupHunterCustomName={setGroupHunterCustomName}
            groupHunterSelectedIds={groupHunterSelectedIds}
            setGroupHunterSelectedIds={setGroupHunterSelectedIds}
            favoriteGroupSearch={favoriteGroupSearch}
            setFavoriteGroupSearch={setFavoriteGroupSearch}
            setFavoriteGroupsExpanded={setFavoriteGroupsExpanded}
            favoriteGroupsExpanded={favoriteGroupsExpanded}
            setFavoriteGroupCategoryFilter={setFavoriteGroupCategoryFilter}
            favoriteGroupCategoryFilter={favoriteGroupCategoryFilter}
            favoriteGroups={favoriteGroups}
            handleAddFavoriteGroup={handleAddFavoriteGroup}
            handleRemoveFavoriteGroup={handleRemoveFavoriteGroup}
            handleRenameFavoriteGroup={handleRenameFavoriteGroup}
            handleHuntFacebookGroup={handleHuntFacebookGroup}
            handleGeminiCurateGroupPosts={handleGeminiCurateGroupPosts}
            handleApplyGroupHunterHook={handleApplyGroupHunterHook}
            handleCleanSpamFromSelectedPosts={handleCleanSpamFromSelectedPosts}
            handleExecuteGroupHunterBatchAi={handleExecuteGroupHunterBatchAi}
            filteredGroupHunterPosts={filteredGroupHunterPosts}
            handleImportGroupHunterPosts={handleImportGroupHunterPosts}
            handleImportAndSwipeGroupHunterPosts={handleImportAndSwipeGroupHunterPosts}
            allFavoriteGroups={allFavoriteGroups}
            filteredFavoriteGroups={filteredFavoriteGroups}
            visibleFavoriteGroups={visibleFavoriteGroups}
            activeScrapeAccount={activeScrapeAccount}
            scrapeAccountOptions={scrapeAccountOptions}
            setGroupHunterScrapeAccountId={setGroupHunterScrapeAccountId}
          />
        </Suspense>
      )}

      {/* Modal Kiểm tra & Xin vào Nhóm Facebook */}
      {groupCheckModalOpened && (
        <Suspense fallback={null}>
          <GroupCheckModal
            kpiFanpageAccounts={kpiFanpageAccounts}
            groupIdentityMap={groupIdentityMap}
            setGroupIdentityMutation={setGroupIdentityMutation}
            groupAccountsWithId={groupAccountsWithId}
            groupCheckModalVisible={groupCheckModalVisible}
            setGroupCheckModalVisible={setGroupCheckModalVisible}
            groupCheckingMap={groupCheckingMap}
            groupJoiningMap={groupJoiningMap}
            checkSingleGroupMutation={checkSingleGroupMutation}
            checkAllGroupsMutation={checkAllGroupsMutation}
            joinGroupMutation={joinGroupMutation}
          />
        </Suspense>
      )}

      {/* Quick Update Cookie Modal */}
      <QuickUpdateCookieModal
        open={quickCookieModalOpen}
        onClose={() => setQuickCookieModalOpen(false)}
        targetAccountId={quickCookieTargetId}
      />

      {/* Modal Nhập Cre Custom (Tùy chỉnh nội dung Cre hàng loạt / đơn lẻ) */}
      {customCreModalOpened && (
        <Suspense fallback={null}>
          <CustomCreModal
            isCustomCreModalOpen={isCustomCreModalOpen}
            setIsCustomCreModalOpen={setIsCustomCreModalOpen}
            customCreInput={customCreInput}
            setCustomCreInput={setCustomCreInput}
            customCreTargetItemId={customCreTargetItemId}
            linkItems={linkItems}
            applyCustomCreditToPosts={applyCustomCreditToPosts}
          />
        </Suspense>
      )}

      {/* Modal Nhập Hashtag Hàng Loạt / Đơn Lẻ */}
      {hashtagModalOpened && (
        <Suspense fallback={null}>
          <HashtagModal
            isHashtagModalOpen={isHashtagModalOpen}
            setIsHashtagModalOpen={setIsHashtagModalOpen}
            hashtagInput={hashtagInput}
            setHashtagInput={setHashtagInput}
            hashtagTargetItemId={hashtagTargetItemId}
            linkItems={linkItems}
            applyHashtagsToPosts={applyHashtagsToPosts}
          />
        </Suspense>
      )}

      {/* Modal Chia Đều Tỉ Lệ Fanpage / Nick Cho Danh Sách Bài Viết */}
      {distributeModalOpened && (
        <Suspense fallback={null}>
          <DistributeModal
            distributeModalOpen={distributeModalOpen}
            setDistributeModalOpen={setDistributeModalOpen}
            selectedDistributePages={selectedDistributePages}
            setSelectedDistributePages={setSelectedDistributePages}
            linkItems={linkItems}
            postingIdentities={postingIdentities}
            accountTargetValue={accountTargetValue}
            viaNameOf={viaNameOf}
            accountSearchLabel={accountSearchLabel}
            applyEqualDistributionToPosts={applyEqualDistributionToPosts}
          />
        </Suspense>
      )}

      {/* Drawer Cào & Biên Tập Bài Báo Đa Lĩnh Vực Rộng 95vw Trực Quan */}
      {articleBatchModalOpened && (
        <Suspense fallback={null}>
          <ArticleBatchModal
            showArticleBatchModal={showArticleBatchModal}
            setShowArticleBatchModal={setShowArticleBatchModal}
            articleBatchUrlsText={articleBatchUrlsText}
            setArticleBatchUrlsText={setArticleBatchUrlsText}
            articleBatchEnableAi={articleBatchEnableAi}
            setArticleBatchEnableAi={setArticleBatchEnableAi}
            articleBatchAiStyle={articleBatchAiStyle}
            setArticleBatchAiStyle={setArticleBatchAiStyle}
            isScrapingArticleBatch={isScrapingArticleBatch}
            customCategoryInputUrl={customCategoryInputUrl}
            setCustomCategoryInputUrl={setCustomCategoryInputUrl}
            scrapedNewsItems={scrapedNewsItems}
            setScrapedNewsItems={setScrapedNewsItems}
            activeCategoryTab={activeCategoryTab}
            setActiveCategoryTab={setActiveCategoryTab}
            setShowRawUrlArea={setShowRawUrlArea}
            showRawUrlArea={showRawUrlArea}
            setShowChannelUrlList={setShowChannelUrlList}
            showChannelUrlList={showChannelUrlList}
            isRadarSweeping={isRadarSweeping}
            radarAutoRefresh={radarAutoRefresh}
            setRadarAutoRefresh={setRadarAutoRefresh}
            radarAutoRefreshMinutes={radarAutoRefreshMinutes}
            setRadarAutoRefreshMinutes={setRadarAutoRefreshMinutes}
            radarLastSweepTime={radarLastSweepTime}
            radarSearchKeyword={radarSearchKeyword}
            setRadarSearchKeyword={setRadarSearchKeyword}
            customChannels={customChannels}
            setShowAddChannelModal={setShowAddChannelModal}
            setNewChannelCategory={setNewChannelCategory}
            handleDeleteCustomChannel={handleDeleteCustomChannel}
            handleNewsDragStart={handleNewsDragStart}
            handleNewsDrop={handleNewsDrop}
            handleFetchCategoryPreset={handleFetchCategoryPreset}
            handleFetchRssPreset={handleFetchRssPreset}
            handleRunRadarSweep={handleRunRadarSweep}
            handleBatchScrapeArticlesToForm={handleBatchScrapeArticlesToForm}
          />
        </Suspense>
      )}

      {/* Modal Khai Báo Kênh Báo / Luồng RSS Tùy Chỉnh Mới */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-slate-100">
            <PlusCircleOutlined className="text-blue-400 text-lg" />
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
