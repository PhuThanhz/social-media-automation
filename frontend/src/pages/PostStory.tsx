import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App, Card, Typography, Select, Button, Input, Radio,
  Form, Divider, Tag, Steps, Result, Checkbox, DatePicker,
  Progress, Space, InputNumber, Table, Popconfirm, Tooltip,
  Spin, Modal, Row, Col, Badge, Upload, Segmented
} from 'antd';
import {
  ThunderboltOutlined,
  LinkOutlined, CheckCircleOutlined, LoadingOutlined,
  InfoCircleOutlined, WarningOutlined, ReloadOutlined, DeleteOutlined,
  PlayCircleOutlined, PictureOutlined, HistoryOutlined,
  EyeOutlined, ArrowUpOutlined, ArrowDownOutlined,
  CopyOutlined, ScissorOutlined, VideoCameraOutlined, CheckCircleFilled,
  PlusOutlined, FacebookFilled, GlobalOutlined, CloseCircleFilled,
  AimOutlined, FireOutlined, TrophyOutlined, SettingOutlined, EditOutlined,
  DownOutlined, UpOutlined, SearchOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import api from '../config/axios';
import PostStoryLogPanel from '../components/common/PostStoryLogPanel';
import { DEFAULT_FANPAGE_PLATFORM_ACCOUNT_ID } from '../config/constants';

const { Title, Text, Paragraph } = Typography;

interface Connection {
  id: number;
  pageName?: string;
  platformAccountId: string;
  platform?: string;
  accountType: string;
}

interface StoryResultItem {
  url: string;
  resolvedMediaUrl?: string;
  title?: string;
  success: boolean;
  error?: string;
  postId?: string;
  scheduledAt?: string;
}

interface StoryClipItem {
  id: string;
  originalUrl: string;
  resolvedMediaUrl?: string;
  title?: string;
  sourceType?: 'TIKTOK' | 'DOUYIN' | 'THREADS' | 'FACEBOOK' | 'INSTAGRAM' | 'DIRECT' | 'UNKNOWN';
  mediaKind: 'video' | 'photo';
  status: 'idle' | 'loading' | 'success' | 'error';
  error?: string;
}

interface PostTargetItem {
  targetId?: number;
  socialAccountId: number;
  platformAccountId?: string;
  platform: string;
  accountName: string;
  date: string;
  targetCount: number;
  actualCount: number;
  achieved: boolean;
}

const detectSourceType = (url: string): 'TIKTOK' | 'DOUYIN' | 'THREADS' | 'FACEBOOK' | 'INSTAGRAM' | 'DIRECT' | 'UNKNOWN' => {
  const u = url.toLowerCase();
  if (u.includes('douyin.com') || u.includes('iesdouyin.com')) return 'DOUYIN';
  if (u.includes('tiktok.com')) return 'TIKTOK';
  if (u.includes('threads.net') || u.includes('threads.com')) return 'THREADS';
  if (u.includes('facebook.com') || u.includes('fb.watch') || u.includes('fb.me')) return 'FACEBOOK';
  if (u.includes('instagram.com') || u.includes('instagr.am')) return 'INSTAGRAM';
  if (u.includes('.mp4') || u.includes('.mov') || u.includes('.webm') || u.includes('.jpg') || u.includes('.png') || u.includes('.jpeg') || u.includes('.webp')) return 'DIRECT';
  return 'UNKNOWN';
};

const PostStory = () => {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [targetMode, setTargetMode] = useState<'SELECT' | 'DIRECT'>('SELECT');
  const [mediaType, setMediaType] = useState<'video' | 'photo'>('video');
  const [saveConnection, setSaveConnection] = useState<boolean>(true);
  const [scheduleMode, setScheduleMode] = useState<'GOLDEN_HOURS' | 'NOW' | 'LATER'>('GOLDEN_HOURS');
  const [step, setStep] = useState<0 | 1 | 2>(0);

  // Link Shopee / Affiliate (mặc định tắt)
  const [affiliateLink, setAffiliateLink] = useState<string>('');

  // Danh sách link Story dạng text
  const [storyUrlsText, setStoryUrlsText] = useState<string>('');
  const [batchIntervalMinutes, setBatchIntervalMinutes] = useState<number>(15);

  // Danh sách Clips đã trích xuất/xem trước
  const [clips, setClips] = useState<StoryClipItem[]>([]);
  const [isExtractingAll, setIsExtractingAll] = useState<boolean>(false);
  const [previewModalVideo, setPreviewModalVideo] = useState<{ open: boolean; url: string; title: string }>({ open: false, url: '', title: '' });
  const [editingClip, setEditingClip] = useState<{ index: number; clip: StoryClipItem } | null>(null);
  const [editMediaUrl, setEditMediaUrl] = useState<string>('');
  const [isUploadingFiles, setIsUploadingFiles] = useState<boolean>(false);

  // Tiến trình đăng hàng loạt & Đồng hồ bấm giờ
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [currentProgressText, setCurrentProgressText] = useState<string>('');
  const [batchResults, setBatchResults] = useState<StoryResultItem[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [totalDurationSeconds, setTotalDurationSeconds] = useState<number>(0);
  const timerRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);

  // 4 Khung Giờ Vàng Chuẩn của Facebook Story
  const goldenHourSlots = [
    { name: 'Sáng', emoji: '🌅', hour: 8, minute: 0, tagColor: 'orange', desc: '07:30 - 08:30' },
    { name: 'Trưa', emoji: '🍜', hour: 12, minute: 0, tagColor: 'cyan', desc: '11:45 - 12:45' },
    { name: 'Tối', emoji: '🌆', hour: 20, minute: 0, tagColor: 'purple', desc: '19:45 - 20:45' },
    { name: 'Đêm', emoji: '🌙', hour: 22, minute: 30, tagColor: 'indigo', desc: '22:30 - 23:30' },
  ];

  // Tính toán trước danh sách mốc Giờ Vàng cho từng Story
  const goldenTimeline = useMemo(() => {
    const totalClips = clips.length > 0 ? clips.length : (storyUrlsText.split('\n').filter(u => u.trim()).length || 1);
    const now = dayjs();
    const result: Array<{ index: number; slotName: string; emoji: string; time: Dayjs; label: string; tagColor: string; desc: string }> = [];

    let currentDay = now.startOf('day');
    let searchSlotIndex = 0;

    // Tìm slot giờ vàng đầu tiên vẫn còn ở tương lai trong ngày hôm nay
    let firstSlotFound = false;
    for (let i = 0; i < goldenHourSlots.length; i++) {
      const slotTime = currentDay.hour(goldenHourSlots[i].hour).minute(goldenHourSlots[i].minute);
      if (slotTime.isAfter(now.add(10, 'minute'))) {
        searchSlotIndex = i;
        firstSlotFound = true;
        break;
      }
    }
    if (!firstSlotFound) {
      currentDay = currentDay.add(1, 'day');
      searchSlotIndex = 0;
    }

    for (let c = 0; c < totalClips; c++) {
      const slot = goldenHourSlots[searchSlotIndex];
      // Jitter ngẫu nhiên +1 đến +5 phút để tự nhiên
      const jitterMins = ((c * 3 + 2) % 6);
      const scheduledTime = currentDay.hour(slot.hour).minute(slot.minute).add(jitterMins, 'minute');

      const isToday = scheduledTime.isSame(now, 'day');
      const isTomorrow = scheduledTime.isSame(now.add(1, 'day'), 'day');
      const dayLabel = isToday ? 'Hôm nay' : (isTomorrow ? 'Ngày mai' : scheduledTime.format('DD/MM'));

      result.push({
        index: c + 1,
        slotName: slot.name,
        emoji: slot.emoji,
        time: scheduledTime,
        label: `${slot.emoji} ${slot.name} (${dayLabel}) lúc ${scheduledTime.format('HH:mm')}`,
        tagColor: slot.tagColor,
        desc: slot.desc
      });

      searchSlotIndex++;
      if (searchSlotIndex >= goldenHourSlots.length) {
        searchSlotIndex = 0;
        currentDay = currentDay.add(1, 'day');
      }
    }

    return result;
  }, [clips.length, storyUrlsText]);

  // Modal Đặt KPI Story & Bộ lọc giao diện
  const [kpiModalOpen, setKpiModalOpen] = useState(false);
  const [kpiDrafts, setKpiDrafts] = useState<Record<number, number | null>>({});
  const [kpiFilterMode, setKpiFilterMode] = useState<'ACTIVE_ONLY' | 'ALL'>('ACTIVE_ONLY');
  const [kpiBoardExpanded, setKpiBoardExpanded] = useState<boolean>(true);
  const [kpiSearchTerm, setKpiSearchTerm] = useState<string>('');

  // Lấy danh sách kết nối
  const { data: rawConnections = [] } = useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: async () => {
      const res = await api.get('/connections');
      return res.data;
    }
  });

  // Chỉ lọc Fanpage
  const fanpageConnections = useMemo(() => {
    return rawConnections.filter(c => c.platform !== 'FACEBOOK_GROUP');
  }, [rawConnections]);

  // Lấy lịch sử Story
  const { data: storyHistory = [], refetch: refetchHistory, isLoading: isLoadingHistory } = useQuery<any[]>({
    queryKey: ['story-history'],
    queryFn: async () => {
      const res = await api.get('/queue/stories');
      return res.data;
    }
  });

  // Lấy KPI hôm nay
  const todayDate = dayjs().format('YYYY-MM-DD');
  const { data: todayTargets = [], refetch: refetchTargets } = useQuery<PostTargetItem[]>({
    queryKey: ['postTargets', 'today', todayDate],
    queryFn: async () => {
      const res = await api.get('/post-targets', { params: { from: todayDate, to: todayDate } });
      return res.data?.items || [];
    },
    refetchInterval: 10000,
  });

  // Lưu KPI Mutation
  const setTargetMutation = useMutation({
    mutationFn: async ({ socialAccountId, targetCount }: { socialAccountId: number; targetCount: number | null }) =>
      (await api.put('/post-targets', { socialAccountId, date: todayDate, targetCount })).data,
    onError: (err: any) => message.error(err?.response?.data?.message || 'Lỗi khi lưu KPI'),
  });

  const openKpiModal = () => {
    const drafts: Record<number, number | null> = {};
    for (const t of todayTargets) {
      drafts[t.socialAccountId] = t.targetCount;
    }
    for (const a of fanpageConnections) {
      if (drafts[a.id] === undefined || drafts[a.id] === null) {
        drafts[a.id] = 0; // Mặc định 0 nếu chưa đặt KPI
      }
    }
    setKpiDrafts(drafts);
    setKpiModalOpen(true);
  };

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
      message.success('🎯 Đã lưu mục tiêu KPI Story hôm nay!');
      queryClient.invalidateQueries({ queryKey: ['postTargets'] });
      setKpiModalOpen(false);
    } catch {
      // Error handled by mutation
    }
  };

  // Tính toán tiến độ Story hôm nay cho từng Fanpage
  const fanpageStoryKpiStats = useMemo(() => {
    const startOfDay = dayjs().startOf('day');
    const endOfDay = dayjs().endOf('day');

    return fanpageConnections.map(conn => {
      const targetObj = todayTargets.find(t => t.socialAccountId === conn.id || (t.platformAccountId && t.platformAccountId === conn.platformAccountId));
      const targetCount = targetObj?.targetCount != null ? Math.max(0, Number(targetObj.targetCount)) : 0;
      const hasKpi = targetCount > 0;

      // Đếm số story đã đăng hôm nay cho page này
      const publishedToday = storyHistory.filter(s => {
        const pId = s.targetFanpageId ? s.targetFanpageId.split(':')[0] : '';
        const matchPage = pId === conn.platformAccountId || s.targetFanpageId?.includes(String(conn.id));
        const pubTime = dayjs(s.publishedAt || s.createdAt);
        return matchPage && s.status === 'PUBLISHED' && pubTime.isAfter(startOfDay) && pubTime.isBefore(endOfDay);
      }).length;

      // Đếm số story đang chờ đăng hôm nay
      const pendingToday = storyHistory.filter(s => {
        const pId = s.targetFanpageId ? s.targetFanpageId.split(':')[0] : '';
        const matchPage = pId === conn.platformAccountId || s.targetFanpageId?.includes(String(conn.id));
        return matchPage && (s.status === 'PENDING' || s.status === 'PROCESSING');
      }).length;

      const progressPercent = hasKpi
        ? Math.min(100, Math.round((publishedToday / targetCount) * 100))
        : (publishedToday > 0 ? 100 : 0);
      const isAchieved = hasKpi && publishedToday >= targetCount;
      const remaining = hasKpi ? Math.max(0, targetCount - publishedToday) : 0;

      return {
        connection: conn,
        targetCount,
        hasKpi,
        publishedToday,
        pendingToday,
        progressPercent,
        isAchieved,
        remaining
      };
    });
  }, [fanpageConnections, storyHistory, todayTargets]);

  const activeKpiPages = useMemo(() => {
    return fanpageStoryKpiStats.filter(s => s.hasKpi || s.publishedToday > 0 || s.pendingToday > 0);
  }, [fanpageStoryKpiStats]);

  const totalAchievedCount = useMemo(() => {
    return fanpageStoryKpiStats.filter(s => s.isAchieved).length;
  }, [fanpageStoryKpiStats]);

  const totalHasKpiCount = useMemo(() => {
    return fanpageStoryKpiStats.filter(s => s.hasKpi).length;
  }, [fanpageStoryKpiStats]);

  const displayedKpiStats = useMemo(() => {
    let list = kpiFilterMode === 'ACTIVE_ONLY' ? activeKpiPages : fanpageStoryKpiStats;
    if (kpiSearchTerm.trim()) {
      const q = kpiSearchTerm.trim().toLowerCase();
      list = list.filter(s =>
        (s.connection.pageName || '').toLowerCase().includes(q) ||
        (s.connection.platformAccountId || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [kpiFilterMode, activeKpiPages, fanpageStoryKpiStats, kpiSearchTerm]);

  const watchedConnectionId = Form.useWatch('connectionId', form);
  const currentSelectedPageKpi = useMemo(() => {
    if (!watchedConnectionId) return null;
    return fanpageStoryKpiStats.find(s => s.connection.id === watchedConnectionId) || null;
  }, [watchedConnectionId, fanpageStoryKpiStats]);

  // Tự động chọn sẵn Fanpage mặc định
  useEffect(() => {
    if (fanpageConnections.length > 0) {
      const defaultConn = fanpageConnections.find(c => c.platformAccountId === DEFAULT_FANPAGE_PLATFORM_ACCOUNT_ID)
        || fanpageConnections.find(c => c.accountType === 'PAGE_TOKEN')
        || fanpageConnections[0];
      if (defaultConn && !form.getFieldValue('connectionId')) {
        form.setFieldsValue({ connectionId: defaultConn.id });
      }
    }
  }, [fanpageConnections, form]);

  useEffect(() => {
    if (targetMode === 'DIRECT') setScheduleMode('NOW');
  }, [targetMode]);

  // Tự động trích xuất clip cho 1 item với cơ chế Fallback 2 tầng cực kỳ chắc chắn
  const extractSingleClip = async (item: StoryClipItem): Promise<StoryClipItem> => {
    let rawUrl = item.originalUrl.trim();
    if (!rawUrl) return item;

    // Lọc ra link HTTP/HTTPS chuẩn nếu chuỗi dán có kèm text mô tả (VD nút chia sẻ từ ứng dụng điện thoại)
    const match = rawUrl.match(/https?:\/\/[^\s"'<>]+/i);
    if (match) {
      rawUrl = match[0];
    }

    const source = detectSourceType(rawUrl);
    const isDirectVideo = /\.mp4|\.mov|\.webm/i.test(rawUrl);
    const isDirectPhoto = /\.jpg|\.jpeg|\.png|\.webp/i.test(rawUrl);

    if (isDirectVideo) {
      return {
        ...item,
        resolvedMediaUrl: rawUrl,
        sourceType: 'DIRECT',
        mediaKind: 'video',
        status: 'success',
        title: 'Video trực tiếp .MP4'
      };
    }

    if (isDirectPhoto) {
      return {
        ...item,
        resolvedMediaUrl: rawUrl,
        sourceType: 'DIRECT',
        mediaKind: 'photo',
        status: 'success',
        title: 'Ảnh trực tiếp'
      };
    }

    // TẦNG 1: Thử trích xuất qua Worker extract-video chuyên dụng
    try {
      const res = await api.post('/tools/extract-video', { url: rawUrl });
      if (res.data?.success && res.data?.videoUrl) {
        return {
          ...item,
          resolvedMediaUrl: res.data.videoUrl,
          title: res.data.title || res.data.content || 'Clip Story',
          sourceType: res.data.sourceType || source,
          mediaKind: 'video',
          status: 'success',
        };
      }
    } catch (err: any) {
      console.warn('Lỗi gọi extract-video, tự động chuyển qua fallback preview-url:', err?.message);
    }

    // TẦNG 2: Fallback qua Scraper Engine /queue/preview-url nếu extract-video chưa lấy được
    try {
      const previewRes = await api.post('/queue/preview-url', { url: rawUrl });
      if (previewRes.data?.success && previewRes.data?.item) {
        const itemData = previewRes.data.item;
        const mediaUrls = (itemData.mediaUrls || []) as string[];
        const videoUrl = mediaUrls.find(u => /\.mp4|\.mov|\/video\/|fbcdn\.net/i.test(u)) || mediaUrls[0];
        if (videoUrl) {
          return {
            ...item,
            resolvedMediaUrl: videoUrl,
            title: itemData.title || itemData.content || 'Clip Story',
            sourceType: source,
            mediaKind: /\.mp4|\.mov|\/video\//i.test(videoUrl) ? 'video' : 'photo',
            status: 'success',
          };
        }
      }
    } catch (previewErr: any) {
      console.warn('Lỗi gọi preview-url fallback:', previewErr?.message);
    }

    return {
      ...item,
      sourceType: source,
      status: 'error',
      error: 'Không thể tự cào media từ link này. Hãy nhấn nút "Sửa" để dán trực tiếp link .mp4 hoặc tải video lên.'
    };
  };

  const handleOpenEditClip = (index: number) => {
    const clip = clips[index];
    if (!clip) return;
    setEditingClip({ index, clip });
    setEditMediaUrl(clip.resolvedMediaUrl || clip.originalUrl);
  };

  const handleSaveEditClip = () => {
    if (!editingClip) return;
    const { index, clip } = editingClip;
    const url = editMediaUrl.trim();
    if (!url) {
      message.error('Vui lòng nhập đường link media!');
      return;
    }
    const isPhoto = /\.jpg|\.jpeg|\.png|\.webp/i.test(url);
    const updated = [...clips];
    updated[index] = {
      ...clip,
      resolvedMediaUrl: url,
      mediaKind: isPhoto ? 'photo' : 'video',
      sourceType: detectSourceType(url),
      status: 'success',
      error: undefined,
      title: clip.title && clip.title !== 'Clip Story' ? clip.title : (isPhoto ? 'Ảnh trực tiếp' : 'Video trực tiếp .MP4')
    };
    setClips(updated);
    setEditingClip(null);
    message.success('Đã cập nhật link clip thành công!');
  };

  // Đồng bộ từ Textarea sang danh sách Clips và tự động phân giải Clip
  const syncClipsFromText = async (text: string, forceExtract = false) => {
    const lines = text
      .split('\n')
      .map(u => u.trim())
      .filter(u => u.length > 0);

    if (lines.length === 0) {
      setClips([]);
      return;
    }

    const newClips: StoryClipItem[] = lines.map((url, idx) => {
      const existing = clips.find(c => c.originalUrl === url);
      if (existing && !forceExtract) return existing;
      return {
        id: `${Date.now()}_${idx}`,
        originalUrl: url,
        sourceType: detectSourceType(url),
        mediaKind: mediaType,
        status: 'idle'
      };
    });

    setClips(newClips);

    // Kích hoạt trích xuất cho các clip chưa extract hoặc đang idle
    setIsExtractingAll(true);
    const updatedClips = [...newClips];

    for (let i = 0; i < updatedClips.length; i++) {
      const current = updatedClips[i];
      if (current.status === 'success' && !forceExtract) continue;

      updatedClips[i] = { ...current, status: 'loading' };
      setClips([...updatedClips]);

      const resolved = await extractSingleClip(current);
      updatedClips[i] = resolved;
      setClips([...updatedClips]);
    }
    setIsExtractingAll(false);
  };

  // Tự động quét và hiển thị clip ngay khi dán link hoặc nhập link (debounce 700ms an toàn)
  useEffect(() => {
    const raw = storyUrlsText.trim();
    if (!raw) {
      if (clips.length > 0) setClips([]);
      return;
    }

    const timer = setTimeout(() => {
      syncClipsFromText(storyUrlsText, false);
    }, 700);

    return () => clearTimeout(timer);
  }, [storyUrlsText, mediaType]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setStoryUrlsText(val);
  };

  const handleTextAreaPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (pasted && pasted.trim()) {
      setTimeout(() => {
        syncClipsFromText(pasted.trim(), false);
      }, 50);
    }
  };

  const handleExtractAll = () => {
    if (!storyUrlsText.trim()) {
      message.warning('Vui lòng dán ít nhất 1 link Story trước khi quét clip!');
      return;
    }
    syncClipsFromText(storyUrlsText, true);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setStoryUrlsText(text);
        syncClipsFromText(text, false);
        message.success('📋 Đã dán link & bắt đầu quét trích xuất clip!');
      }
    } catch {
      message.info('Vui lòng dán trực tiếp vào khung nhập liệu.');
    }
  };

  const handleUploadCustomRequest = async (options: any) => {
    const { file, onSuccess, onError } = options;
    const formData = new FormData();
    formData.append('file', file);

    setIsUploadingFiles(true);
    try {
      const res = await api.post('/media/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (res.data?.success && res.data?.url) {
        const uploadedUrl = res.data.url;
        const isVideo = res.data.isVideo || /\.mp4|\.mov|\.webm/i.test(uploadedUrl);
        const newClip: StoryClipItem = {
          id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          originalUrl: uploadedUrl,
          resolvedMediaUrl: uploadedUrl,
          title: file.name || (isVideo ? 'Video tải lên' : 'Ảnh tải lên'),
          sourceType: 'DIRECT',
          mediaKind: isVideo ? 'video' : 'photo',
          status: 'success'
        };

        setClips(prev => [...prev, newClip]);
        setStoryUrlsText(prev => (prev.trim() ? `${prev.trim()}\n${uploadedUrl}` : uploadedUrl));
        message.success(`Đã tải lên tệp: ${file.name}`);
        onSuccess(res.data);
      } else {
        message.error(res.data?.message || 'Tải tệp lên thất bại');
        onError(new Error(res.data?.message));
      }
    } catch (err: any) {
      message.error(err.message || 'Lỗi tải tệp lên');
      onError(err);
    } finally {
      setIsUploadingFiles(false);
    }
  };

  const handleRemoveClip = (id: string) => {
    const updated = clips.filter(c => c.id !== id);
    setClips(updated);
    setStoryUrlsText(updated.map(c => c.originalUrl).join('\n'));
    message.info('Đã bỏ 1 clip khỏi danh sách đăng');
  };

  const handleMoveClip = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= clips.length) return;
    const updated = [...clips];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIdx, 0, moved);
    setClips(updated);
    setStoryUrlsText(updated.map(c => c.originalUrl).join('\n'));
  };

  const handleRetryClip = async (index: number) => {
    const item = clips[index];
    if (!item) return;
    const updated = [...clips];
    updated[index] = { ...item, status: 'loading', error: undefined };
    setClips(updated);

    const resolved = await extractSingleClip(item);
    updated[index] = resolved;
    setClips([...updated]);
    if (resolved.status === 'success') {
      message.success('Đã trích xuất video thành công!');
    } else {
      message.error(resolved.error || 'Trích xuất thất bại');
    }
  };

  // Bộ đếm thời gian thực tế đang chạy (Stopwatch)
  useEffect(() => {
    if (isProcessing) {
      setElapsedSeconds(0);
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      if (startTimeRef.current > 0) {
        setTotalDurationSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isProcessing]);

  // Nạp lại link Story từ lịch sử và tự chọn Fanpage tương ứng
  const handleReuseStory = (story: any) => {
    const url = story.originalUrl || story.content || story.mediaUrls;
    if (url) {
      setStoryUrlsText(url);
      setStep(0);
      syncClipsFromText(url, false);
      if (story.targetFanpageId) {
        const pageId = story.targetFanpageId.split(':')[0];
        const matched = fanpageConnections.find(c => c.platformAccountId === pageId || String(c.id) === pageId);
        if (matched) {
          form.setFieldsValue({ connectionId: matched.id });
          setTargetMode('SELECT');
        }
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      message.success('📋 Đã nạp lại link Story & chọn Fanpage sẵn sàng đăng!');
    }
  };

  // Đăng lại 1-click ngay lập tức
  const handleQuickRepublish = async (story: any) => {
    const url = story.originalUrl || story.content || story.mediaUrls;
    const pId = story.targetFanpageId ? story.targetFanpageId.split(':')[0] : '';
    const conn = fanpageConnections.find(c => c.platformAccountId === pId || String(c.id) === pId) || fanpageConnections[0];

    if (!url || !conn) {
      handleReuseStory(story);
      return;
    }

    message.loading({ content: `🚀 Đang đăng lại Story lên ${conn.pageName || conn.platformAccountId}...`, key: 'repost', duration: 0 });
    try {
      const res = await api.post('/queue/post-story', {
        connectionId: conn.id,
        mediaUrl: url,
        mediaType: 'video'
      });
      if (res.data?.success) {
        message.success({ content: `🎉 Đã đăng lại Story thành công lên ${conn.pageName || 'Fanpage'}!`, key: 'repost' });
        refetchHistory();
        refetchTargets();
      } else {
        message.error({ content: res.data?.error || 'Đăng lại thất bại', key: 'repost' });
      }
    } catch (err: any) {
      message.error({ content: err?.response?.data?.error || err.message || 'Lỗi đăng lại', key: 'repost' });
    }
  };

  // Thực hiện đăng / lên lịch toàn bộ Story theo danh sách clips
  const onFinish = async (values: any) => {
    const itemsToPost: StoryClipItem[] = clips.length > 0 ? clips : storyUrlsText.split('\n').map(u => u.trim()).filter(Boolean).map(url => ({
      id: Math.random().toString(),
      originalUrl: url,
      resolvedMediaUrl: url,
      title: 'Story Clip',
      mediaKind: mediaType,
      status: 'success' as const
    }));

    if (itemsToPost.length === 0) {
      message.error('Vui lòng nhập ít nhất 1 đường dẫn Story!');
      return;
    }

    setStep(1);
    setIsProcessing(true);
    setProgressPercent(0);
    setBatchResults([]);

    if (targetMode === 'DIRECT' && saveConnection) {
      try {
        const connRes = await api.post('/connections', {
          platform: 'FACEBOOK',
          platformAccountId: values.pageId.trim(),
          pageName: values.pageName?.trim() || `Fanpage ${values.pageId.trim()}`,
          accessToken: values.accessToken.trim(),
          accountType: 'PAGE_TOKEN'
        });
        if (connRes.data?.id) {
          values.connectionId = connRes.data.id;
        }
        message.success('💾 Đã lưu kết nối Fanpage mới vào danh sách!');
        queryClient.invalidateQueries({ queryKey: ['connections'] });
      } catch { }
    }

    const total = itemsToPost.length;
    const results: StoryResultItem[] = [];
    const baseScheduleTime: Dayjs = values.scheduledAt || dayjs().add(15, 'minute');

    for (let i = 0; i < total; i++) {
      const item = itemsToPost[i];
      const storyIndex = i + 1;
      const currentPercent = Math.round(((i) / total) * 100);
      setProgressPercent(currentPercent);

      const targetMediaUrl = item.resolvedMediaUrl || item.originalUrl;
      const clipTitle = item.title || `Story #${storyIndex}`;

      if (scheduleMode === 'GOLDEN_HOURS') {
        const goldenSlot = goldenTimeline[i] || goldenTimeline[0];
        const itemScheduledAt = goldenSlot.time;
        setCurrentProgressText(`🌟 [${storyIndex}/${total}] Lên lịch Giờ Vàng (${goldenSlot.label}) cho: ${clipTitle.slice(0, 30)}...`);

        try {
          const res = await api.post('/queue/schedule-story', {
            connectionId: values.connectionId,
            mediaUrl: targetMediaUrl,
            scheduledAt: itemScheduledAt.format('YYYY-MM-DDTHH:mm:ss'),
            affiliateLink: affiliateLink.trim() || undefined,
          });
          if (res.data?.success) {
            results.push({
              url: item.originalUrl,
              resolvedMediaUrl: targetMediaUrl,
              title: clipTitle,
              success: true,
              scheduledAt: `${goldenSlot.emoji} ${itemScheduledAt.format('HH:mm · DD/MM/YYYY')} (${goldenSlot.slotName})`
            });
          } else {
            results.push({
              url: item.originalUrl,
              resolvedMediaUrl: targetMediaUrl,
              title: clipTitle,
              success: false,
              error: res.data?.message || 'Lỗi khi lên lịch'
            });
          }
        } catch (err: any) {
          results.push({
            url: item.originalUrl,
            resolvedMediaUrl: targetMediaUrl,
            title: clipTitle,
            success: false,
            error: err?.response?.data?.message || err.message || 'Lỗi mạng'
          });
        }
      } else if (scheduleMode === 'LATER') {
        const itemScheduledAt = baseScheduleTime.add(i * batchIntervalMinutes, 'minute');
        setCurrentProgressText(`🗓️ [${storyIndex}/${total}] Đang lên lịch Story: ${clipTitle.slice(0, 35)} lúc ${itemScheduledAt.format('HH:mm DD/MM')}...`);

        try {
          const res = await api.post('/queue/schedule-story', {
            connectionId: values.connectionId,
            mediaUrl: targetMediaUrl,
            scheduledAt: itemScheduledAt.format('YYYY-MM-DDTHH:mm:ss'),
            affiliateLink: affiliateLink.trim() || undefined,
          });
          if (res.data?.success) {
            results.push({
              url: item.originalUrl,
              resolvedMediaUrl: targetMediaUrl,
              title: clipTitle,
              success: true,
              scheduledAt: itemScheduledAt.format('HH:mm · DD/MM/YYYY')
            });
          } else {
            results.push({
              url: item.originalUrl,
              resolvedMediaUrl: targetMediaUrl,
              title: clipTitle,
              success: false,
              error: res.data?.message || 'Lỗi khi lên lịch'
            });
          }
        } catch (err: any) {
          results.push({
            url: item.originalUrl,
            resolvedMediaUrl: targetMediaUrl,
            title: clipTitle,
            success: false,
            error: err?.response?.data?.message || err.message || 'Lỗi mạng'
          });
        }
      } else {
        // ĐĂNG NGAY
        setCurrentProgressText(`🚀 [${storyIndex}/${total}] Đang tải lên Story: ${clipTitle.slice(0, 35)}...`);

        const payload: any = {
          mediaUrl: targetMediaUrl,
          mediaType: item.mediaKind || mediaType,
          affiliateLink: affiliateLink.trim() || undefined
        };

        if (targetMode === 'SELECT') {
          payload.connectionId = values.connectionId;
        } else {
          payload.pageId = values.pageId.trim();
          payload.accessToken = values.accessToken.trim();
        }

        try {
          const res = await api.post('/queue/post-story', payload);
          if (res.data?.success) {
            results.push({
              url: item.originalUrl,
              resolvedMediaUrl: targetMediaUrl,
              title: clipTitle,
              success: true,
              postId: res.data?.postId
            });
          } else {
            results.push({
              url: item.originalUrl,
              resolvedMediaUrl: targetMediaUrl,
              title: clipTitle,
              success: false,
              error: res.data?.error || 'Lỗi đăng Story'
            });
          }
        } catch (err: any) {
          results.push({
            url: item.originalUrl,
            resolvedMediaUrl: targetMediaUrl,
            title: clipTitle,
            success: false,
            error: err?.response?.data?.error || err.message || 'Lỗi kết nối'
          });
        }
      }
    }

    setProgressPercent(100);
    setCurrentProgressText(`Hoàn tất xử lý ${total} Story!`);
    setIsProcessing(false);
    setBatchResults(results);
    setStep(2);
    refetchHistory();
    refetchTargets();

    const successCount = results.filter(r => r.success).length;
    if (successCount === total) {
      message.success(`🎉 Đã xuất bản thành công tất cả ${total} Story!`);
    } else if (successCount > 0) {
      message.warning(`Đã hoàn tất ${successCount}/${total} Story.`);
    } else {
      message.error('❌ Đăng Story thất bại, vui lòng kiểm tra lỗi bên dưới.');
    }
  };

  const resetForm = () => {
    form.resetFields();
    setStoryUrlsText('');
    setClips([]);
    setStep(0);
    setBatchResults([]);
    setMediaType('video');
    setScheduleMode('NOW');
  };

  // Đăng ngay một bài Story trong hàng đợi
  const handlePublishNow = async (id: number) => {
    try {
      const res = await api.post(`/queue/${id}/publish-now`);
      if (res.data?.success) {
        message.success('🚀 Đã đăng Story thành công!');
        refetchHistory();
        refetchTargets();
      } else {
        message.error(res.data?.message || 'Đăng Story thất bại!');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || err.message || 'Lỗi đăng Story');
    }
  };

  // Xoá Story khỏi lịch sử
  const handleDeleteStory = async (id: number) => {
    try {
      await api.delete(`/queue/${id}`);
      message.success('Đã xoá bản ghi Story!');
      refetchHistory();
      refetchTargets();
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Xoá thất bại');
    }
  };

  const successCount = batchResults.filter(r => r.success).length;
  const failCount = batchResults.length - successCount;

  // Cột bảng lịch sử Story
  const historyColumns = [
    {
      title: 'Media / Link Story',
      dataIndex: 'content',
      key: 'content',
      render: (_: any, record: any) => {
        const link = record.originalUrl || record.content || record.mediaUrls || '';
        const isMp4 = (record.mediaUrls || link).includes('.mp4');
        return (
          <div className="space-y-1 max-w-xs">
            <div className="flex items-center gap-1.5">
              {isMp4 ? <PlayCircleOutlined className="text-purple-400" /> : <PictureOutlined className="text-pink-400" />}
              <span className="font-bold text-slate-200 text-xs truncate max-w-[220px]" title={record.title || link}>
                {record.title || 'Story Facebook'}
              </span>
            </div>
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-blue-400 hover:text-blue-300 hover:underline font-mono truncate block max-w-[220px]"
                title={link}
              >
                🔗 {link}
              </a>
            )}
          </div>
        );
      }
    },
    {
      title: 'Fanpage Đích',
      dataIndex: 'targetFanpageId',
      key: 'targetFanpageId',
      render: (val: string) => {
        const pageId = val ? val.split(':')[0] : '';
        const matchedConn = fanpageConnections.find(c => c.platformAccountId === pageId);
        const pageName = matchedConn?.pageName || `Fanpage (${pageId || 'Mặc định'})`;
        return (
          <div>
            <span className="font-semibold text-slate-200 text-xs block">🎯 {pageName}</span>
            <Tag color="purple" className="text-[10px] !mt-1 font-bold">
              {matchedConn?.accountType || 'PERSONAL_COOKIE'}
            </Tag>
          </div>
        );
      }
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      render: (status: string, record: any) => {
        switch (status) {
          case 'PUBLISHED':
            return <Tag color="success" className="font-bold text-xs">✅ Đã xuất bản</Tag>;
          case 'PENDING':
            return <Tag color="processing" className="font-bold text-xs">🗓️ Chờ đăng</Tag>;
          case 'PROCESSING':
            return <Tag color="purple" className="font-bold text-xs animate-pulse">🔄 Đang tải lên...</Tag>;
          case 'FAILED':
            return (
              <Tooltip title={record.errorMessage || 'Lỗi không xác định'}>
                <Tag color="error" className="font-bold text-xs cursor-pointer">❌ Thất bại</Tag>
              </Tooltip>
            );
          default:
            return <Tag>{status}</Tag>;
        }
      }
    },
    {
      title: 'Thời gian',
      key: 'time',
      render: (_: any, record: any) => {
        const displayTime = record.publishedAt || record.scheduledAt || record.createdAt;
        return (
          <div className="text-xs text-slate-400 font-mono">
            {displayTime ? dayjs(displayTime).format('HH:mm · DD/MM/YYYY') : '—'}
          </div>
        );
      }
    },
    {
      title: 'Thao tác',
      key: 'actions',
      render: (_: any, record: any) => (
        <Space size="small">
          <Tooltip title="Nạp link và thông tin vào form để chỉnh sửa trước khi đăng">
            <Button
              size="small"
              type="primary"
              icon={<ReloadOutlined />}
              onClick={() => handleReuseStory(record)}
              className="bg-purple-600 hover:bg-purple-500 text-xs font-semibold rounded-lg"
            >
              Nạp lại
            </Button>
          </Tooltip>

          {record.status === 'PUBLISHED' && (
            <Tooltip title="Đăng lại ngay lập tức bài Story này lên đúng Fanpage cũ mà không cần qua form">
              <Button
                size="small"
                type="default"
                icon={<ThunderboltOutlined />}
                onClick={() => handleQuickRepublish(record)}
                className="text-xs text-amber-300 border-amber-500/40 hover:border-amber-400 bg-amber-950/30 font-semibold rounded-lg"
              >
                ⚡ Đăng lại ngay
              </Button>
            </Tooltip>
          )}

          {record.status === 'PENDING' && (
            <Button
              size="small"
              type="default"
              icon={<ThunderboltOutlined />}
              onClick={() => handlePublishNow(record.id)}
              className="text-xs text-emerald-400 border-emerald-500/40 hover:border-emerald-400 font-semibold rounded-lg"
            >
              Đăng ngay
            </Button>
          )}

          <Popconfirm
            title="Xoá Story"
            description="Bạn có chắc chắn muốn xoá Story này khỏi danh sách?"
            onConfirm={() => handleDeleteStory(record.id)}
            okText="Xoá"
            cancelText="Huỷ"
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} className="text-xs" />
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div className="app-page max-w-5xl mx-auto space-y-6">
      {/* Header Bar */}
      <div className="app-surface app-page-header !border-[#202a3a] !bg-[#111722] p-5 rounded-2xl shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-13 h-13 bg-gradient-to-tr from-purple-600 via-indigo-600 to-pink-500 text-white rounded-2xl flex items-center justify-center text-2xl shadow-lg shadow-purple-950/60 shrink-0">
              🎬
            </div>
            <div>
              <Title level={4} className="!text-slate-100 !mb-1 flex items-center gap-2">
                Đăng Story Facebook & Quản Lý KPI Story
              </Title>
              <Text className="text-slate-400 text-xs font-medium">
                Tự động bóc tách Clip từ Threads, TikTok, Reels và theo dõi tiến độ KPI Story hàng ngày của từng Fanpage
              </Text>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap sm:justify-end items-center">
            <Button
              type="primary"
              icon={<AimOutlined />}
              onClick={openKpiModal}
              className="bg-indigo-600 hover:bg-indigo-500 font-bold text-xs rounded-xl h-9 px-4 border-none shadow-md shadow-indigo-950/50"
            >
              🎯 Đặt KPI Story Hôm Nay
            </Button>
          </div>
        </div>
      </div>

      {/* ── BẢNG THEO DÕI TIẾN ĐỘ KPI STORY HÔM NAY CHO CÁC FANPAGE ── */}
      <div className="bg-[#111722] p-4 rounded-2xl border border-[#202a3a] shadow-sm space-y-3">
        {/* Header với bộ lọc và nút thu gọn */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center gap-2">
              <TrophyOutlined className="text-amber-400 text-base" />
              <span className="font-bold text-slate-100 text-sm">
                Tiến Độ KPI Story Hôm Nay ({dayjs().format('DD/MM/YYYY')}):
              </span>
            </div>
            {totalHasKpiCount > 0 ? (
              <Tag color={totalAchievedCount === totalHasKpiCount ? 'success' : 'processing'} className="text-[11px] font-semibold !m-0">
                {totalAchievedCount}/{totalHasKpiCount} trang đạt KPI
              </Tag>
            ) : (
              <Tag className="!bg-[#1c2433] !text-slate-400 !border-[#2a374d] text-[11px] !m-0">
                Chưa gán KPI ({fanpageConnections.length} trang)
              </Tag>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Segmented
              size="small"
              value={kpiFilterMode}
              onChange={(val) => setKpiFilterMode(val as 'ACTIVE_ONLY' | 'ALL')}
              options={[
                {
                  label: (
                    <span className="text-xs px-1">
                      🎯 Đang theo dõi ({activeKpiPages.length})
                    </span>
                  ),
                  value: 'ACTIVE_ONLY'
                },
                {
                  label: (
                    <span className="text-xs px-1">
                      Tất cả trang ({fanpageStoryKpiStats.length})
                    </span>
                  ),
                  value: 'ALL'
                }
              ]}
              className="bg-[#0b1017] border border-[#202a3a] text-slate-300"
            />

            <Button
              size="small"
              type="text"
              icon={kpiBoardExpanded ? <UpOutlined /> : <DownOutlined />}
              onClick={() => setKpiBoardExpanded(!kpiBoardExpanded)}
              className="text-slate-400 hover:text-slate-200 text-xs flex items-center"
            >
              {kpiBoardExpanded ? 'Thu gọn' : 'Mở rộng'}
            </Button>
          </div>
        </div>

        {/* Nội dung khi mở rộng */}
        {kpiBoardExpanded ? (
          <>
            {/* Thanh tìm kiếm & hướng dẫn nhanh */}
            <div className="flex items-center justify-between gap-3 pt-1 border-t border-[#1c2636]">
              <span className="text-[11px] text-slate-400 hidden sm:inline">
                💡 Bấm vào thẻ Fanpage để chọn nhanh trang đăng Story
              </span>
              {(kpiFilterMode === 'ALL' || fanpageStoryKpiStats.length > 6) && (
                <div className="w-full sm:w-64">
                  <Input
                    size="small"
                    placeholder="Tìm tên hoặc ID trang..."
                    prefix={<SearchOutlined className="text-slate-500" />}
                    allowClear
                    value={kpiSearchTerm}
                    onChange={(e) => setKpiSearchTerm(e.target.value)}
                    className="bg-[#0d131d] border-[#202a3a] text-slate-200 text-xs rounded-lg"
                  />
                </div>
              )}
            </div>

            {displayedKpiStats.length === 0 ? (
              <div className="py-6 text-center bg-[#0d131d]/60 rounded-xl border border-dashed border-[#202a3a]">
                <p className="text-xs text-slate-400 mb-2">
                  {kpiFilterMode === 'ACTIVE_ONLY'
                    ? 'Chưa có trang nào có KPI hoặc bài đăng hôm nay.'
                    : 'Không tìm thấy trang nào khớp với từ khóa tìm kiếm.'}
                </p>
                <div className="flex items-center justify-center gap-2">
                  {kpiFilterMode === 'ACTIVE_ONLY' ? (
                    <>
                      <Button
                        size="small"
                        type="primary"
                        icon={<AimOutlined />}
                        onClick={openKpiModal}
                        className="bg-indigo-600 hover:bg-indigo-500 text-xs rounded-lg"
                      >
                        Đặt KPI Ngay
                      </Button>
                      <Button
                        size="small"
                        onClick={() => setKpiFilterMode('ALL')}
                        className="text-xs rounded-lg"
                      >
                        Xem tất cả trang ({fanpageStoryKpiStats.length})
                      </Button>
                    </>
                  ) : (
                    <Button size="small" onClick={() => setKpiSearchTerm('')} className="text-xs rounded-lg">
                      Xóa bộ lọc tìm kiếm
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <Row gutter={[10, 10]}>
                {displayedKpiStats.map(stat => {
                  const isSelected = form.getFieldValue('connectionId') === stat.connection.id;
                  return (
                    <Col xs={24} sm={12} md={8} key={stat.connection.id}>
                      <div
                        onClick={() => {
                          form.setFieldsValue({ connectionId: stat.connection.id });
                          setTargetMode('SELECT');
                        }}
                        className={`p-3 rounded-xl border cursor-pointer transition-all relative overflow-hidden group ${
                          isSelected
                            ? 'border-purple-500 bg-purple-950/40 shadow-sm ring-1 ring-purple-500/40'
                            : 'border-[#202a3a] bg-[#0d131d] hover:border-purple-500/40 hover:bg-[#151f2e]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 mb-2">
                          <div className="flex items-center gap-1.5 overflow-hidden">
                            <FacebookFilled className="text-blue-400 text-xs shrink-0" />
                            <span className="font-bold text-slate-200 text-xs truncate" title={stat.connection.pageName}>
                              {stat.connection.pageName || stat.connection.platformAccountId}
                            </span>
                          </div>
                          {stat.hasKpi ? (
                            stat.isAchieved ? (
                              <Tag color="success" className="font-bold text-[10px] !m-0">
                                🎉 Đạt KPI
                              </Tag>
                            ) : (
                              <Tag color="warning" className="font-bold text-[10px] !m-0">
                                Thiếu {stat.remaining} Story
                              </Tag>
                            )
                          ) : stat.publishedToday > 0 ? (
                            <Tag color="blue" className="text-[10px] !m-0 font-medium">
                              Đã đăng {stat.publishedToday}
                            </Tag>
                          ) : (
                            <Tag className="!bg-[#1c2433] !text-slate-400 !border-[#2a374d] text-[10px] !m-0">
                              Chưa đặt KPI
                            </Tag>
                          )}
                        </div>

                        {/* Thanh tiến trình KPI */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-400">
                              {stat.hasKpi ? 'Tiến độ hôm nay:' : 'Đã đăng hôm nay:'}
                            </span>
                            <span className="font-bold text-slate-200">
                              {stat.hasKpi ? (
                                <>
                                  {stat.publishedToday} / {stat.targetCount} Story
                                  {stat.pendingToday > 0 && (
                                    <span className="text-purple-400 font-normal text-[10px] ml-1">
                                      (+{stat.pendingToday} chờ)
                                    </span>
                                  )}
                                </>
                              ) : (
                                <>
                                  {stat.publishedToday} Story
                                  {stat.pendingToday > 0 && (
                                    <span className="text-purple-400 font-normal text-[10px] ml-1">
                                      (+{stat.pendingToday} chờ)
                                    </span>
                                  )}
                                </>
                              )}
                            </span>
                          </div>

                          <Progress
                            percent={stat.hasKpi ? stat.progressPercent : (stat.publishedToday > 0 ? 100 : 0)}
                            size="small"
                            status={stat.hasKpi ? (stat.isAchieved ? 'success' : 'active') : 'normal'}
                            strokeColor={
                              stat.hasKpi
                                ? (stat.isAchieved ? '#10b981' : { from: '#7c3aed', to: '#ec4899' })
                                : (stat.publishedToday > 0 ? '#3b82f6' : '#2a374d')
                            }
                            trailColor="#1f293d"
                            showInfo={false}
                          />
                        </div>
                      </div>
                    </Col>
                  );
                })}
              </Row>
            )}
          </>
        ) : (
          <div className="flex items-center justify-between pt-1 border-t border-[#1c2636] text-xs text-slate-400">
            <span>
              💡 Bảng KPI đang thu gọn ({displayedKpiStats.length} trang).
            </span>
            <Button
              size="small"
              type="link"
              onClick={() => setKpiBoardExpanded(true)}
              className="text-purple-400 hover:text-purple-300 text-xs p-0 h-auto font-medium"
            >
              Mở rộng bảng chi tiết
            </Button>
          </div>
        )}
      </div>

      {/* Progress Steps (Dark Mode) */}
      <div className="bg-[#111722] p-4 rounded-2xl border border-[#202a3a] shadow-sm">
        <Steps
          current={step}
          className="dark-steps"
          items={[
            { title: <span className="font-semibold text-slate-200 text-xs">Nhập Link & Trích Xuất Clip</span>, description: <span className="text-[11px] text-slate-400">Xem trước video & chọn Fanpage</span> },
            {
              title: <span className="font-semibold text-slate-200 text-xs">Đang Xử Lý</span>,
              description: <span className="text-[11px] text-slate-400">{isProcessing ? currentProgressText : 'Upload lên Story Facebook'}</span>,
              icon: step === 1 ? <LoadingOutlined className="text-purple-400" /> : undefined
            },
            {
              title: <span className="font-semibold text-slate-200 text-xs">Kết Quả</span>,
              description: <span className="text-[11px] text-slate-400">{step === 2 ? `${successCount} thành công, ${failCount} lỗi` : 'Chờ hoàn thành'}</span>,
              icon: step === 2 ? (failCount === 0 ? <CheckCircleOutlined className="text-emerald-400" /> : <WarningOutlined className="text-amber-400" />) : undefined
            }
          ]}
        />
      </div>

      {/* Nhật ký Worker thời gian thực */}
      <PostStoryLogPanel isProcessing={isProcessing} />

      {/* Bước 1: Đang xử lý */}
      {step === 1 && (
        <Card variant="borderless" className="shadow-lg rounded-2xl border border-[#202a3a] !bg-[#111722] p-6 text-center">
          <div className="max-w-md mx-auto space-y-4">
            <div className="text-4xl animate-bounce">🎬</div>
            <Title level={4} className="!text-purple-300 !mb-1">Đang tải Story lên Fanpage Facebook...</Title>
            <Text className="text-slate-400 text-xs block">{currentProgressText}</Text>
            
            {/* Đồng hồ đếm thời gian thực thi thời gian thực */}
            <div className="my-3 inline-flex items-center gap-3 bg-[#0d131d] border border-purple-900/60 px-5 py-2.5 rounded-2xl shadow-lg">
              <div className="w-9 h-9 rounded-xl bg-purple-950/80 border border-purple-800/50 flex items-center justify-center text-purple-300 text-base">
                ⏱️
              </div>
              <div className="text-left">
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Thời gian đang chạy</div>
                <div className="text-xl font-black font-mono text-purple-300 flex items-center gap-2">
                  {Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:{(elapsedSeconds % 60).toString().padStart(2, '0')}
                  <span className="text-[11px] font-normal text-slate-400 font-sans">
                    (Ước tính ~20s - 35s / Story)
                  </span>
                </div>
              </div>
            </div>

            <Progress
              percent={progressPercent}
              status="active"
              strokeColor={{ from: '#7c3aed', to: '#ec4899' }}
              trailColor="#1f293d"
              className="mt-2"
            />
            
            <div className="text-[11px] text-slate-400 mt-2 bg-[#0d131d] p-3 rounded-xl border border-[#202a3a]">
              Playwright đang tự động giải mã video, nạp file và chia sẻ lên Story theo thứ tự an toàn...
            </div>
          </div>
        </Card>
      )}

      {/* Bước 2: Kết quả chi tiết */}
      {step === 2 && (
        <Card variant="borderless" className="shadow-lg rounded-2xl border border-[#202a3a] !bg-[#111722]">
          <Result
            status={failCount === 0 ? 'success' : successCount > 0 ? 'warning' : 'error'}
            title={
              <div className="space-y-1">
                <span className="text-slate-100 font-bold text-lg block">
                  {failCount === 0
                    ? `🎉 Hoàn tất! Đã đăng thành công cả ${successCount} Story lên Fanpage!`
                    : `Hoàn tất: ${successCount} Story thành công, ${failCount} Story lỗi`}
                </span>
                {totalDurationSeconds > 0 && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 text-xs font-semibold">
                    ⏱️ Thời gian hoàn tất: <b>{totalDurationSeconds} giây</b> ({Math.floor(totalDurationSeconds / 60).toString().padStart(2, '0')}:{(totalDurationSeconds % 60).toString().padStart(2, '0')})
                  </div>
                )}
              </div>
            }
            subTitle={
              <span className="text-slate-400 text-xs">
                {scheduleMode === 'LATER'
                  ? 'Các Story đã được lên lịch tự động đăng vào các khung giờ đã chọn.'
                  : 'Các Story đã xuất bản đang được Facebook phân phối trên bảng tin 24h của Fanpage.'}
              </span>
            }
            extra={[
              <Button
                key="again"
                type="primary"
                size="large"
                onClick={resetForm}
                className="bg-purple-600 hover:bg-purple-500 border-none font-bold rounded-xl px-6"
              >
                + Tiếp Tục Đăng Thêm Story
              </Button>
            ]}
          >
            <div className="mt-4 space-y-3 text-left">
              <div className="font-bold text-slate-300 text-xs">Chi tiết kết quả từng Story:</div>
              {batchResults.map((item, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
                    item.success
                      ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-200'
                      : 'bg-red-950/30 border-red-800/40 text-red-200'
                  }`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className="font-bold shrink-0">{item.success ? '✅' : '❌'} #{idx + 1}</span>
                    <span className="font-semibold text-slate-200 truncate max-w-xs">{item.title || item.url}</span>
                    <span className="font-mono text-slate-400 text-[11px] truncate max-w-xs">({item.url})</span>
                  </div>
                  <div>
                    {item.success ? (
                      <Tag color="success" className="font-semibold">
                        {item.scheduledAt ? `🗓️ Lịch: ${item.scheduledAt}` : (item.postId ? `Post ID: ${item.postId}` : 'Đã đăng thành công')}
                      </Tag>
                    ) : (
                      <Tag color="error" className="font-semibold">{item.error || 'Lỗi đăng'}</Tag>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Result>
        </Card>
      )}

      {/* Bước 0: Form chính */}
      {step === 0 && (
        <div className="space-y-6">
          <Card variant="borderless" className="shadow-lg rounded-2xl border border-[#202a3a] !bg-[#111722]">
            <Form form={form} layout="vertical" onFinish={onFinish} disabled={isProcessing}>
              
              {/* Chọn chế độ Fanpage */}
              <div className="mb-6 bg-[#0d131d] p-4 rounded-xl border border-[#202a3a]">
                <Text className="font-bold text-slate-200 block mb-3 text-sm flex items-center gap-2">
                  <FacebookFilled className="text-purple-400" /> Phương thức chọn Fanpage đăng Story:
                </Text>
                <Radio.Group
                  value={targetMode}
                  onChange={(e) => setTargetMode(e.target.value)}
                  className="w-full"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                        targetMode === 'SELECT'
                          ? 'border-purple-500 bg-purple-950/40 shadow-sm ring-1 ring-purple-500/40 text-purple-200'
                          : 'border-[#202a3a] bg-[#111722] hover:border-purple-500/40 hover:bg-[#151f2e] text-slate-300'
                      }`}
                      onClick={() => setTargetMode('SELECT')}
                    >
                      <Radio value="SELECT">
                        <span className="font-bold text-xs sm:text-sm text-slate-100">Chọn Fanpage từ danh sách ({fanpageConnections.length})</span>
                      </Radio>
                      <div className="text-xs text-slate-400 mt-1 pl-6">
                        Sử dụng các kết nối Fanpage đã lưu trong hệ thống
                      </div>
                    </div>

                    <div
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                        targetMode === 'DIRECT'
                          ? 'border-purple-500 bg-purple-950/40 shadow-sm ring-1 ring-purple-500/40 text-purple-200'
                          : 'border-[#202a3a] bg-[#111722] hover:border-purple-500/40 hover:bg-[#151f2e] text-slate-300'
                      }`}
                      onClick={() => setTargetMode('DIRECT')}
                    >
                      <Radio value="DIRECT">
                        <span className="font-bold text-xs sm:text-sm text-slate-100">🔑 Nhập Page Access Token trực tiếp</span>
                      </Radio>
                      <div className="text-xs text-slate-400 mt-1 pl-6">
                        Dán trực tiếp Page ID & Token (EAAG...) để đăng ngay
                      </div>
                    </div>
                  </div>
                </Radio.Group>
              </div>

              {/* Mode 1: Chọn từ danh sách */}
              {targetMode === 'SELECT' && (
                <div className="space-y-3 mb-6">
                  <Form.Item
                    label={<span className="font-bold text-slate-300 text-xs">🎯 Chọn Fanpage đăng Story</span>}
                    name="connectionId"
                    rules={[{ required: targetMode === 'SELECT', message: 'Vui lòng chọn Fanpage!' }]}
                    className="!mb-2"
                  >
                    <Select
                      size="large"
                      placeholder="Chọn Fanpage để đăng Story..."
                      className="rounded-xl"
                      options={fanpageConnections.map(c => ({
                        value: c.id,
                        label: (
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-slate-100">🎯 {c.pageName || c.platformAccountId}</span>
                            <Tag color={c.accountType === 'PAGE_TOKEN' ? 'purple' : 'blue'} className="text-xs !mr-0 font-bold">
                              {c.accountType || 'PAGE_TOKEN'}
                            </Tag>
                          </div>
                        )
                      }))}
                      notFoundContent={
                        <div className="text-center py-4 text-slate-400 text-xs">
                          Chưa có kết nối nào. Hãy chuyển sang tab <b>"🔑 Nhập Page Access Token trực tiếp"</b> ở trên!
                        </div>
                      }
                    />
                  </Form.Item>

                  {/* Banner tiến độ KPI của trang được chọn */}
                  {currentSelectedPageKpi && (
                    <div className="bg-[#0d131d] p-3 rounded-xl border border-purple-900/40 flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2">
                        <AimOutlined className="text-purple-400" />
                        <span className="text-slate-300">
                          Fanpage <b>{currentSelectedPageKpi.connection.pageName}</b>:{' '}
                          {currentSelectedPageKpi.hasKpi ? (
                            <>
                              Đã xuất bản <b>{currentSelectedPageKpi.publishedToday}/{currentSelectedPageKpi.targetCount} Story</b> hôm nay.
                              {currentSelectedPageKpi.isAchieved ? (
                                <span className="text-emerald-400 font-bold ml-1.5">🎉 Đã đạt KPI!</span>
                              ) : (
                                <span className="text-amber-400 font-medium ml-1.5">Còn thiếu {currentSelectedPageKpi.remaining} Story.</span>
                              )}
                            </>
                          ) : (
                            <>
                              Đã xuất bản <b>{currentSelectedPageKpi.publishedToday} Story</b> hôm nay (Chưa thiết lập mục tiêu KPI).
                            </>
                          )}
                        </span>
                      </div>
                      <Button
                        size="small"
                        type="link"
                        icon={<SettingOutlined />}
                        onClick={openKpiModal}
                        className="text-purple-400 hover:text-purple-300 text-xs font-semibold p-0 h-auto"
                      >
                        {currentSelectedPageKpi.hasKpi ? 'Chỉnh KPI' : 'Đặt KPI'}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Mode 2: Nhập Page Token trực tiếp */}
              {targetMode === 'DIRECT' && (
                <div className="bg-[#0d131d] p-4 rounded-xl border border-purple-900/40 mb-6 space-y-4">
                  <Form.Item
                    label={<span className="font-bold text-slate-300 text-xs">🆔 Page ID</span>}
                    name="pageId"
                    rules={[{ required: targetMode === 'DIRECT', message: 'Vui lòng nhập Page ID!' }]}
                    className="!mb-3"
                  >
                    <Input
                      placeholder="Vd: 100083920194821"
                      size="large"
                      className="rounded-xl font-mono text-sm"
                    />
                  </Form.Item>

                  <Form.Item
                    label={<span className="font-bold text-slate-300 text-xs">🔑 Page Access Token (EAAG...)</span>}
                    name="accessToken"
                    rules={[{ required: targetMode === 'DIRECT', message: 'Vui lòng nhập Page Access Token!' }]}
                    className="!mb-3"
                  >
                    <Input.TextArea
                      rows={3}
                      placeholder="Dán Page Access Token (bắt đầu bằng EAAG... hoặc EAA...)"
                      className="rounded-xl font-mono text-xs"
                    />
                  </Form.Item>

                  <Form.Item
                    label={<span className="font-bold text-slate-300 text-xs">Tên Fanpage gợi nhớ (Tùy chọn)</span>}
                    name="pageName"
                    className="!mb-3"
                  >
                    <Input
                      placeholder="Vd: Fanpage Shop Của Tôi"
                      size="middle"
                      className="rounded-xl text-xs"
                    />
                  </Form.Item>

                  <div className="pt-1">
                    <Checkbox
                      checked={saveConnection}
                      onChange={(e) => setSaveConnection(e.target.checked)}
                      className="font-semibold text-slate-300 text-xs"
                    >
                      💾 Tự động lưu Fanpage này vào danh sách Quản lý Fanpage để tiện chọn cho lần sau
                    </Checkbox>
                  </div>
                </div>
              )}

              {/* Thời điểm đăng */}
              <div className="mb-6 bg-[#0d131d] p-4 rounded-xl border border-[#202a3a]">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <Text className="font-bold text-slate-200 text-sm flex items-center gap-2">
                    ⏰ Thời điểm xuất bản Story:
                  </Text>
                  {scheduleMode === 'GOLDEN_HOURS' && (
                    <Tag color="purple" className="font-bold text-[10px] uppercase">
                      ✨ Tự động tối ưu tương tác
                    </Tag>
                  )}
                </div>

                <Radio.Group value={scheduleMode} onChange={(e) => setScheduleMode(e.target.value)} className="w-full">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    
                    {/* Option 1: Khung Giờ Vàng */}
                    <div
                      className={`p-3.5 rounded-xl border transition-all ${targetMode === 'DIRECT' ? 'opacity-50 border-[#202a3a] bg-[#10151f]' : 'cursor-pointer'} ${
                        scheduleMode === 'GOLDEN_HOURS'
                          ? 'border-purple-500 bg-purple-950/40 shadow-sm ring-1 ring-purple-500/40 text-purple-200'
                          : 'border-[#202a3a] bg-[#111722] hover:border-purple-500/40 hover:bg-[#151f2e] text-slate-300'
                      }`}
                      onClick={() => targetMode !== 'DIRECT' && setScheduleMode('GOLDEN_HOURS')}
                    >
                      <Radio value="GOLDEN_HOURS" disabled={targetMode === 'DIRECT'}>
                        <span className="font-bold text-xs sm:text-sm text-slate-100">🌟 Phân Bổ Giờ Vàng</span>
                      </Radio>
                      <div className="text-[11px] text-purple-300/80 mt-1 pl-6">
                        Tự động rải Story vào 4 mốc vàng: Sáng, Trưa, Tối, Đêm
                      </div>
                    </div>

                    {/* Option 2: Đăng ngay */}
                    <div
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                        scheduleMode === 'NOW'
                          ? 'border-purple-500 bg-purple-950/40 shadow-sm ring-1 ring-purple-500/40 text-purple-200'
                          : 'border-[#202a3a] bg-[#111722] hover:border-purple-500/40 hover:bg-[#151f2e] text-slate-300'
                      }`}
                      onClick={() => setScheduleMode('NOW')}
                    >
                      <Radio value="NOW">
                        <span className="font-bold text-xs sm:text-sm text-slate-100">🚀 Đăng ngay tất cả</span>
                      </Radio>
                      <div className="text-[11px] text-slate-400 mt-1 pl-6">
                        Xuất bản tất cả clip Story lên Fanpage ngay lập tức
                      </div>
                    </div>

                    {/* Option 3: Lên lịch thủ công */}
                    <div
                      className={`p-3.5 rounded-xl border transition-all ${targetMode === 'DIRECT' ? 'opacity-50 border-[#202a3a] bg-[#10151f]' : 'cursor-pointer'} ${
                        scheduleMode === 'LATER'
                          ? 'border-purple-500 bg-purple-950/40 shadow-sm ring-1 ring-purple-500/40 text-purple-200'
                          : 'border-[#202a3a] bg-[#111722] hover:border-purple-500/40 hover:bg-[#151f2e] text-slate-300'
                      }`}
                      onClick={() => targetMode !== 'DIRECT' && setScheduleMode('LATER')}
                    >
                      <Radio value="LATER" disabled={targetMode === 'DIRECT'}>
                        <span className="font-bold text-xs sm:text-sm text-slate-100">🗓️ Tự chọn giờ</span>
                      </Radio>
                      <div className="text-[11px] text-slate-400 mt-1 pl-6">
                        Chọn ngày giờ bắt đầu và khoảng cách tùy chỉnh
                      </div>
                    </div>
                  </div>
                </Radio.Group>

                {/* Timeline Xem trước Phân Bổ Giờ Vàng */}
                {scheduleMode === 'GOLDEN_HOURS' && (
                  <div className="mt-4 pt-4 border-t border-[#202a3a] space-y-3">
                    <div className="flex items-center justify-between text-xs text-slate-300">
                      <span className="font-bold text-purple-300 flex items-center gap-1.5">
                        🎯 Lộ trình phát hành Giờ Vàng tự động ({goldenTimeline.length} Story):
                      </span>
                      <span className="text-[11px] text-slate-400">
                        (Mỗi Story giãn cách ngẫu nhiên ±3p để bảo đảm an toàn)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                      {goldenTimeline.map((item, idx) => (
                        <div
                          key={idx}
                          className="bg-[#111722] p-2.5 rounded-xl border border-purple-900/40 flex items-center justify-between gap-2 shadow-sm"
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            <span className="w-6 h-6 rounded-lg bg-purple-950 border border-purple-700/50 flex items-center justify-center font-bold text-xs text-purple-300 shrink-0">
                              #{item.index}
                            </span>
                            <div className="overflow-hidden">
                              <div className="font-bold text-slate-200 text-xs truncate">
                                {item.emoji} {item.slotName} ({item.time.format('DD/MM')})
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {item.desc}
                              </div>
                            </div>
                          </div>
                          <Tag color="purple" className="font-mono font-bold text-xs !m-0">
                            {item.time.format('HH:mm')}
                          </Tag>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tùy chỉnh lịch thủ công */}
                {scheduleMode === 'LATER' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-3 border-t border-[#202a3a]">
                    <Form.Item
                      name="scheduledAt"
                      label={<span className="font-semibold text-slate-300 text-xs">Thời điểm bắt đầu Story 1</span>}
                      rules={[{ required: scheduleMode === 'LATER', message: 'Chọn ngày giờ bắt đầu!' }]}
                      className="!mb-0"
                      initialValue={dayjs().add(15, 'minute')}
                    >
                      <DatePicker
                        showTime
                        format="HH:mm DD/MM/YYYY"
                        size="large"
                        style={{ width: '100%' }}
                        className="rounded-xl"
                        disabledDate={(current) => current && current < dayjs().startOf('day')}
                        placeholder="Chọn ngày giờ bắt đầu Story 1"
                      />
                    </Form.Item>

                    <div>
                      <span className="font-semibold text-slate-300 text-xs block mb-2">Khoảng cách giữa các Story:</span>
                      <Space align="center">
                        <InputNumber
                          min={5}
                          max={1440}
                          value={batchIntervalMinutes}
                          onChange={(val) => setBatchIntervalMinutes(val || 15)}
                          size="large"
                          className="rounded-xl w-28"
                        />
                        <span className="text-xs text-slate-400">phút / 1 Story tiếp theo</span>
                      </Space>
                    </div>
                  </div>
                )}
              </div>


              {/* Loại media (Video Story / Photo Story) */}
              <div className="mb-6 bg-[#0d131d] p-4 rounded-xl border border-[#202a3a]">
                <Text className="font-bold text-slate-200 block mb-3 text-sm">📂 Loại Media Story:</Text>
                <Radio.Group
                  value={mediaType}
                  onChange={e => setMediaType(e.target.value)}
                  className="w-full"
                >
                  <div className="grid grid-cols-2 gap-3">
                    <div
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all text-center ${
                        mediaType === 'video'
                          ? 'border-purple-500 bg-purple-950/40 shadow-sm ring-1 ring-purple-500/40 text-purple-200'
                          : 'border-[#202a3a] bg-[#111722] hover:border-purple-500/40 hover:bg-[#151f2e] text-slate-300'
                      }`}
                      onClick={() => setMediaType('video')}
                    >
                      <div className="text-2xl mb-1">🎬</div>
                      <div className="font-bold text-slate-100 text-sm">Video Story</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">File .MP4 hoặc link Reels / Threads / TikTok</div>
                    </div>
                    <div
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all text-center ${
                        mediaType === 'photo'
                          ? 'border-pink-500 bg-pink-950/40 shadow-sm ring-1 ring-pink-500/40 text-pink-200'
                          : 'border-[#202a3a] bg-[#111722] hover:border-pink-500/40 hover:bg-[#151f2e] text-slate-300'
                      }`}
                      onClick={() => setMediaType('photo')}
                    >
                      <div className="text-2xl mb-1">🖼️</div>
                      <div className="font-bold text-slate-100 text-sm">Photo Story</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">Ảnh JPG/PNG — tỉ lệ 9:16</div>
                    </div>
                  </div>
                </Radio.Group>
              </div>

              {/* URL Media Input & Trích xuất Clip */}
              <div className="mb-6 bg-[#0d131d] p-4 rounded-xl border border-[#202a3a]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5 text-xs sm:text-sm">
                    <LinkOutlined className="text-purple-400" />
                    Danh sách Link bài viết Story (Mỗi dòng 1 link):
                  </span>
                  
                  <div className="flex items-center gap-2 flex-wrap">
                    {clips.length > 0 && (
                      <Tag color="purple" className="font-bold !m-0">
                        {clips.length} Link Story
                      </Tag>
                    )}
                    <Button
                      type="default"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={handlePasteFromClipboard}
                      className="text-xs font-semibold rounded-lg bg-[#172230] border-[#2d3b4f] hover:border-purple-400"
                    >
                      📋 Dán link
                    </Button>
                    <Upload
                      customRequest={handleUploadCustomRequest}
                      showUploadList={false}
                      multiple
                      accept={mediaType === 'video' ? 'video/mp4,video/quicktime,video/webm' : 'image/jpeg,image/png,image/webp'}
                    >
                      <Button
                        type="default"
                        size="small"
                        icon={<PlusOutlined />}
                        loading={isUploadingFiles}
                        className="text-xs font-semibold rounded-lg bg-[#172230] border-[#2d3b4f] hover:border-purple-400 text-purple-300"
                      >
                        📁 Tải file từ máy
                      </Button>
                    </Upload>
                    <Button
                      type="primary"
                      size="small"
                      icon={isExtractingAll ? <LoadingOutlined /> : <VideoCameraOutlined />}
                      loading={isExtractingAll}
                      onClick={handleExtractAll}
                      className="bg-purple-600 hover:bg-purple-500 font-bold text-xs rounded-lg"
                    >
                      🔍 Quét & Trích Xuất Clip
                    </Button>
                  </div>
                </div>

                <Input.TextArea
                  rows={4}
                  value={storyUrlsText}
                  onChange={handleTextChange}
                  onPaste={handleTextAreaPaste}
                  onBlur={() => {
                    if (storyUrlsText.trim() && clips.length === 0) {
                      syncClipsFromText(storyUrlsText, false);
                    }
                  }}
                  placeholder={`Dán 1 hoặc nhiều link Story vào đây (mỗi dòng 1 link):\nhttps://www.threads.net/@user/post/...\nhttps://www.tiktok.com/@user/video/...\nhttps://www.facebook.com/reel/...`}
                  className="rounded-xl font-mono text-xs p-3 !bg-[#111722] !border-[#202a3a] text-slate-200"
                  allowClear
                />

                <div className="mt-2.5 flex items-center justify-between flex-wrap gap-2 text-[11px] text-slate-400">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-emerald-400 font-medium">✨ Hỗ trợ link:</span>
                    <span>Threads</span> • <span>TikTok</span> • <span>Reels / FB</span> • <span>Video MP4 trực tiếp</span>
                  </div>
                  <span className="text-slate-500">Hệ thống sẽ tự động bóc tách video MP4 sắc nét</span>
                </div>
              </div>

              {/* KHU VỰC XEM TRƯỚC VÀ QUẢN LÝ TỪNG CLIP (ĐƯA LINK VÀO PHẢI RA CLIP) */}
              {clips.length > 0 && (
                <div className="mb-6 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Text className="font-bold text-slate-200 text-sm flex items-center gap-2">
                      <PlayCircleOutlined className="text-purple-400" /> Danh sách Clip Story sẵn sàng ({clips.length} clip):
                    </Text>
                    {isExtractingAll && (
                      <span className="text-xs text-purple-400 flex items-center gap-1.5 animate-pulse">
                        <LoadingOutlined /> Đang giải mã video từ link...
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {clips.map((clip, index) => (
                      <div
                        key={clip.id}
                        className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between ${
                          clip.status === 'success'
                            ? 'bg-[#121927] border-purple-900/50 hover:border-purple-500/60'
                            : clip.status === 'error'
                            ? 'bg-[#1e1318] border-red-900/50'
                            : 'bg-[#111722] border-[#202a3a]'
                        }`}
                      >
                        <div>
                          {/* Header của thẻ clip */}
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-1.5 overflow-hidden">
                              <span className="font-bold text-xs text-purple-400 bg-purple-950/60 px-2 py-0.5 rounded-md border border-purple-800/40 shrink-0">
                                #{index + 1}
                              </span>
                              <Tag
                                color={
                                  clip.sourceType === 'TIKTOK'
                                    ? 'magenta'
                                    : clip.sourceType === 'DOUYIN'
                                    ? 'volcano'
                                    : clip.sourceType === 'THREADS'
                                    ? 'purple'
                                    : clip.sourceType === 'FACEBOOK'
                                    ? 'blue'
                                    : clip.sourceType === 'INSTAGRAM'
                                    ? 'gold'
                                    : 'cyan'
                                }
                                className="!font-bold text-[10px] uppercase !m-0"
                              >
                                {clip.sourceType || 'LINK'}
                              </Tag>
                              <span className="text-xs font-semibold text-slate-200 truncate" title={clip.title || clip.originalUrl}>
                                {clip.title || (clip.status === 'loading' ? 'Đang trích xuất video...' : 'Story Media')}
                              </span>
                            </div>

                            {/* Trạng thái trích xuất */}
                            <div className="shrink-0">
                              {clip.status === 'loading' && <Spin size="small" />}
                              {clip.status === 'success' && (
                                <Tag color="success" className="text-[10px] font-bold !m-0">
                                  <CheckCircleFilled /> Sẵn sàng
                                </Tag>
                              )}
                              {clip.status === 'error' && (
                                <Tag color="error" className="text-[10px] font-bold !m-0">
                                  <CloseCircleFilled /> Lỗi trích xuất
                                </Tag>
                              )}
                            </div>
                          </div>

                          {/* Media Preview Box */}
                          <div className="relative rounded-xl overflow-hidden bg-black/80 border border-[#222f42] mb-3 min-h-[140px] max-h-[180px] flex items-center justify-center">
                            {clip.status === 'loading' ? (
                              <div className="text-center p-4 text-slate-400 space-y-2">
                                <LoadingOutlined className="text-2xl text-purple-400" />
                                <div className="text-xs">Đang giải mã và tải luồng video...</div>
                              </div>
                            ) : clip.status === 'error' ? (
                              <div className="text-center p-4 text-red-400 space-y-1">
                                <WarningOutlined className="text-xl" />
                                <div className="text-xs font-medium">{clip.error || 'Không tải được video'}</div>
                                <Button
                                  size="small"
                                  type="primary"
                                  danger
                                  onClick={() => handleRetryClip(index)}
                                  className="text-xs rounded-lg mt-1"
                                >
                                  Thử lại
                                </Button>
                              </div>
                            ) : clip.resolvedMediaUrl ? (
                              clip.mediaKind === 'photo' ? (
                                <img
                                  src={clip.resolvedMediaUrl}
                                  alt="Photo story preview"
                                  className="w-full h-full object-contain max-h-[180px]"
                                />
                              ) : (
                                <div className="relative w-full h-full group flex items-center justify-center">
                                  <video
                                    src={clip.resolvedMediaUrl}
                                    controls
                                    playsInline
                                    className="w-full max-h-[180px] object-contain rounded-lg"
                                  />
                                </div>
                              )
                            ) : (
                              <div className="text-xs text-slate-500">Chưa tải được clip</div>
                            )}
                          </div>

                          {/* URL link text */}
                          <div className="text-[11px] font-mono text-slate-400 truncate mb-3" title={clip.originalUrl}>
                            🔗 {clip.originalUrl}
                          </div>
                        </div>

                        {/* Thao tác trên từng clip */}
                        <div className="flex items-center justify-between pt-2 border-t border-[#202a3a]">
                          <Space size={4}>
                            <Tooltip title="Chuyển lên trên">
                              <Button
                                size="small"
                                type="text"
                                disabled={index === 0}
                                icon={<ArrowUpOutlined />}
                                onClick={() => handleMoveClip(index, 'up')}
                                className="text-slate-400 hover:text-slate-200"
                              />
                            </Tooltip>
                            <Tooltip title="Chuyển xuống dưới">
                              <Button
                                size="small"
                                type="text"
                                disabled={index === clips.length - 1}
                                icon={<ArrowDownOutlined />}
                                onClick={() => handleMoveClip(index, 'down')}
                                className="text-slate-400 hover:text-slate-200"
                              />
                            </Tooltip>
                            {clip.resolvedMediaUrl && (
                              <Tooltip title="Mở xem video lớn">
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<EyeOutlined />}
                                  onClick={() => setPreviewModalVideo({ open: true, url: clip.resolvedMediaUrl!, title: clip.title || 'Clip Story' })}
                                  className="text-purple-400 hover:text-purple-300"
                                />
                              </Tooltip>
                            )}
                            <Tooltip title="Quét lại clip này">
                              <Button
                                size="small"
                                type="text"
                                icon={<ReloadOutlined />}
                                onClick={() => handleRetryClip(index)}
                                className="text-blue-400 hover:text-blue-300"
                              />
                            </Tooltip>
                            <Tooltip title="Sửa / Thay link media trực tiếp (.mp4 / ảnh)">
                              <Button
                                size="small"
                                type="text"
                                icon={<EditOutlined />}
                                onClick={() => handleOpenEditClip(index)}
                                className="text-amber-400 hover:text-amber-300"
                              />
                            </Tooltip>
                          </Space>

                          <Tooltip title="Xóa clip khỏi danh sách">
                            <Button
                              size="small"
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => handleRemoveClip(clip.id)}
                            />
                          </Tooltip>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Info Box Glassmorphism */}
              <div className="bg-gradient-to-r from-purple-950/40 via-[#131c2d] to-blue-950/30 border border-purple-800/30 rounded-2xl p-4 mb-6">
                <div className="flex gap-3">
                  <InfoCircleOutlined className="text-purple-400 mt-0.5 flex-shrink-0 text-base" />
                  <div className="space-y-1.5 text-xs text-slate-300">
                    <div className="font-semibold text-slate-100 mb-1">📋 Cơ Chế Đăng Story & Hỗ Trợ Link:</div>
                    <div>• Hệ thống <strong>tự động bóc tách video HD</strong> từ link Threads, TikTok, Reels mà không cần tải thủ công về máy.</div>
                    <div>• Tự động đăng tuần tự từng Story lên Fanpage cách nhau hợp lý, tối ưu hiển thị bảng tin 24h.</div>
                    <div>• Bạn có thể xem trước tất cả các clip ở trên trước khi bấm Đăng Ngay hoặc Lên Lịch.</div>
                  </div>
                </div>
              </div>

              {/* Nút Submit */}
              <Form.Item className="mb-0">
                <Button
                  type="primary"
                  htmlType="submit"
                  size="large"
                  disabled={clips.length === 0 && !storyUrlsText.trim()}
                  icon={<ThunderboltOutlined />}
                  className="w-full h-13 text-base font-bold rounded-2xl border-none shadow-lg shadow-purple-950/50"
                  style={{
                    background: (clips.length === 0 && !storyUrlsText.trim()) ? undefined : 'linear-gradient(135deg, #7c3aed, #db2777)',
                  }}
                >
                  {scheduleMode === 'LATER'
                    ? `🗓️ Lên Lịch Cho ${clips.length || 1} Story Tự Động`
                    : `🚀 Đăng Ngay ${clips.length || 1} Story Lên Fanpage Facebook`}
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </div>
      )}

      {/* Modal Preview Video Lớn */}
      <Modal
        title={<span className="text-slate-100 font-bold">{previewModalVideo.title}</span>}
        open={previewModalVideo.open}
        onCancel={() => setPreviewModalVideo({ open: false, url: '', title: '' })}
        footer={null}
        width={420}
        centered
        destroyOnHidden
        className="rounded-2xl overflow-hidden"
      >
        <div className="p-2 bg-black rounded-xl overflow-hidden flex items-center justify-center">
          <video
            src={previewModalVideo.url}
            controls
            autoPlay
            playsInline
            className="w-full max-h-[520px] object-contain rounded-lg"
          />
        </div>
      </Modal>

      {/* Modal Sửa Link Media Trực Tiếp Cho Clip */}
      <Modal
        title={<span className="text-purple-400 font-bold">🛠️ Sửa Link Media Cho Clip #{editingClip ? editingClip.index + 1 : ''}</span>}
        open={!!editingClip}
        onCancel={() => setEditingClip(null)}
        onOk={handleSaveEditClip}
        okText="Lưu & Sử dụng link này"
        cancelText="Hủy"
        destroyOnClose
      >
        <div className="space-y-3 py-2">
          <p className="text-xs text-slate-300">
            Nếu link tự động không trích xuất được hoặc bị hạn chế, bạn có thể dán trực tiếp đường link <b>.mp4</b> hoặc link ảnh/video CDN vào đây:
          </p>
          <Input
            value={editMediaUrl}
            onChange={(e) => setEditMediaUrl(e.target.value)}
            placeholder="https://.../video.mp4 hoặc link CDN"
            className="rounded-lg font-mono text-xs"
          />
        </div>
      </Modal>

      {/* Modal Đặt KPI Story */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-slate-100 pb-2 border-b border-[#202a3a]">
            <AimOutlined className="text-indigo-400 text-lg" />
            <span className="font-bold text-base">🎯 Thiết Lập Mục Tiêu KPI Story Hôm Nay</span>
          </div>
        }
        open={kpiModalOpen}
        onCancel={() => setKpiModalOpen(false)}
        onOk={handleSaveKpi}
        okText="Lưu KPI"
        cancelText="Hủy"
        okButtonProps={{ loading: setTargetMutation.isPending, className: 'bg-indigo-600 font-bold rounded-xl' }}
        cancelButtonProps={{ className: 'rounded-xl' }}
        width={540}
        centered
        className="rounded-2xl overflow-hidden"
      >
        <div className="space-y-4 py-3">
          <Text className="text-xs text-slate-400 block">
            Đặt số lượng Story mục tiêu cần xuất bản mỗi ngày cho từng Fanpage. Hệ thống sẽ theo dõi tiến độ thực tế theo thời gian thực.
          </Text>

          <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {fanpageConnections.map(conn => (
              <div key={conn.id} className="p-3 bg-[#0d131d] rounded-xl border border-[#202a3a] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 overflow-hidden">
                  <FacebookFilled className="text-blue-400 shrink-0" />
                  <div>
                    <span className="font-bold text-slate-200 text-xs block truncate max-w-[240px]">
                      {conn.pageName || conn.platformAccountId}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      ID: {conn.platformAccountId}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <InputNumber
                    min={0}
                    max={100}
                    value={kpiDrafts[conn.id] ?? 5}
                    onChange={(val) => setKpiDrafts(prev => ({ ...prev, [conn.id]: val }))}
                    size="middle"
                    className="w-24 rounded-xl font-bold"
                  />
                  <span className="text-xs text-slate-400">Story/ngày</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* Bảng Lịch sử & Hàng đợi Story */}
      <Card
        variant="borderless"
        className="shadow-lg rounded-2xl border border-[#202a3a] !bg-[#111722]"
        title={
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <HistoryOutlined className="text-purple-400 text-lg" />
              <span className="font-bold text-slate-100 text-base">
                Lịch Sử & Hàng Đợi Story Đã Đăng ({storyHistory.length})
              </span>
            </div>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => {
                refetchHistory();
                refetchTargets();
              }}
              loading={isLoadingHistory}
              className="text-xs rounded-lg bg-[#172230] border-[#2d3b4f] hover:border-purple-400"
            >
              Làm mới
            </Button>
          </div>
        }
      >
        <Table
          dataSource={storyHistory}
          columns={historyColumns}
          rowKey="id"
          loading={isLoadingHistory}
          pagination={{ pageSize: 6, showSizeChanger: false }}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText: (
              <div className="text-center py-6 text-slate-400 text-xs">
                Chưa có lịch sử Story nào. Hãy dán link và quét clip để xuất bản Story đầu tiên nhé!
              </div>
            )
          }}
        />
      </Card>
    </div>
  );
};

export default PostStory;
