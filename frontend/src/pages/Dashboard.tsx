import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/vi';
import {
  Button,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Avatar,
  Select,
  App,
} from 'antd';
import {
  AimOutlined,
  CompassOutlined,
  CalendarOutlined,
  CheckCircleFilled,
  ClockCircleFilled,
  CloseCircleFilled,
  FacebookFilled,
  PlusOutlined,
  RiseOutlined,
  SyncOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  ThunderboltOutlined,
  KeyOutlined,
  PlayCircleOutlined,
  RadarChartOutlined,
  PictureOutlined,
  ArrowRightOutlined,
  CheckOutlined,
  GlobalOutlined,
  ExclamationCircleFilled,
  HistoryOutlined,
  ReloadOutlined,
  EyeOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import api from '../config/axios';
import QuickUpdateCookieModal from '../components/modals/QuickUpdateCookieModal';
import { PostDetailModal, PostQueueItem } from '../components/modals/PostDetailModal';

dayjs.extend(relativeTime);
dayjs.locale('vi');

const { Text } = Typography;
type Period = 'DAY' | 'WEEK' | 'MONTH';

interface SocialAccount {
  id: number;
  platform: string;
  platformAccountId: string;
  pageName?: string;
  accountType?: string;
  tokenStatus?: string;
  accessToken?: string;
}

interface Campaign {
  id: number;
  name: string;
  sourceUrl: string;
  status: string;
}

interface PostQueue {
  id: number;
  title: string;
  content?: string;
  mediaUrls?: string;
  status: string;
  scheduledAt?: string;
  publishedAt?: string;
  createdAt?: string;
  errorMessage?: string;
  targetFanpageId?: string;
  campaign?: { id: number; name: string };
  socialAccount?: { pageName?: string; platform?: string };
}

interface PostTargetItem {
  targetId: number;
  socialAccountId: number;
  platform: string;
  accountName: string;
  date: string;
  targetCount: number;
  actualCount: number;
  achieved: boolean;
}

const statusMeta: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING: { label: 'Chờ đăng', color: 'processing', icon: <ClockCircleFilled className="text-amber-400" /> },
  PROCESSING: { label: 'Đang đăng', color: 'purple', icon: <SyncOutlined spin className="text-blue-400" /> },
  PUBLISHED: { label: 'Đã xuất bản', color: 'success', icon: <CheckCircleFilled className="text-emerald-400" /> },
  FAILED: { label: 'Đăng lỗi', color: 'error', icon: <CloseCircleFilled className="text-red-400" /> },
  CANCELLED: { label: 'Đã hủy', color: 'default', icon: <CloseCircleFilled className="text-slate-500" /> },
};

const getPostDate = (post: PostQueue) => post.publishedAt || post.scheduledAt || post.createdAt;

const Dashboard = () => {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const [period, setPeriod] = useState<Period>('DAY');
  const [selectedChannelId, setSelectedChannelId] = useState<string>('ALL');
  const [quickCookieModalOpen, setQuickCookieModalOpen] = useState(false);
  const [quickCookieTargetId, setQuickCookieTargetId] = useState<number | undefined>(undefined);
  const [viewingPost, setViewingPost] = useState<PostQueueItem | null>(null);
  const [publishingId, setPublishingId] = useState<number | null>(null);

  // 1. Fetch danh sách tài khoản kết nối
  const { data: connections = [], isLoading: loadingConnections } = useQuery({
    queryKey: ['socialAccounts'],
    queryFn: async () => (await api.get('/connections')).data as SocialAccount[],
  });

  // 2. Fetch danh sách bài đăng
  const { data: posts = [], isLoading: loadingPosts, refetch, isFetching } = useQuery({
    queryKey: ['postQueue'],
    queryFn: async () => {
      const campaignList = (await api.get('/campaigns')).data as Campaign[];
      const results = await Promise.all(
        campaignList.map(async (campaign) => {
          try {
            const items = (await api.get(`/queue/campaign/${campaign.id}`)).data as PostQueue[];
            return items.map((item) => ({ ...item, campaign: { id: campaign.id, name: campaign.name } }));
          } catch {
            return [] as PostQueue[];
          }
        })
      );
      return results
        .flat()
        .sort((a, b) => (dayjs(getPostDate(b)).valueOf() || b.id) - (dayjs(getPostDate(a)).valueOf() || a.id));
    },
  });

  // 3. Fetch KPI ngày hôm nay
  const today = dayjs().format('YYYY-MM-DD');
  const { data: todayTargets = [], isLoading: loadingTargets } = useQuery({
    queryKey: ['postTargets', 'today', today],
    queryFn: async () => (await api.get('/post-targets', { params: { from: today, to: today } })).data?.items as PostTargetItem[] || [],
  });

  // 4. Mutation Đăng ngay / Thử lại bài viết
  const publishNowMutation = useMutation({
    mutationFn: async (id: number) => {
      setPublishingId(id);
      const res = await api.post(`/queue/${id}/publish`);
      return res.data;
    },
    onSuccess: () => {
      setPublishingId(null);
      message.success('Đã gửi lệnh xử lý bài viết ngay lập tức!');
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
    },
    onError: (err: any) => {
      setPublishingId(null);
      message.error(err?.response?.data?.message || 'Lỗi khi gửi lệnh đăng bài!');
    },
  });

  // Phát hiện tài khoản hết hạn Cookie
  const expiredCookieAccounts = useMemo(
    () => connections.filter((c) => c.accountType === 'PERSONAL_COOKIE' && c.tokenStatus === 'EXPIRED'),
    [connections]
  );

  const range = useMemo(() => {
    const now = dayjs();
    if (period === 'DAY') return { start: now.startOf('day'), end: now.endOf('day'), label: 'Hôm nay' };
    if (period === 'WEEK') return { start: now.startOf('week').add(1, 'day'), end: now.startOf('week').add(7, 'day').endOf('day'), label: 'Tuần này' };
    return { start: now.startOf('month'), end: now.endOf('month'), label: 'Tháng này' };
  }, [period]);

  // Lọc bài đăng theo kỳ thời gian và kênh đã chọn
  const periodPosts = useMemo(
    () =>
      posts.filter((post) => {
        // Lọc theo kênh nếu người dùng chọn
        if (selectedChannelId !== 'ALL' && post.targetFanpageId !== selectedChannelId) {
          return false;
        }

        const value = getPostDate(post);
        if (!value) return false;
        const date = dayjs(value);
        return !date.isBefore(range.start) && !date.isAfter(range.end);
      }),
    [posts, range, selectedChannelId]
  );

  const counts = useMemo(
    () => ({
      total: periodPosts.length,
      published: periodPosts.filter((p) => p.status === 'PUBLISHED').length,
      pending: periodPosts.filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING').length,
      failed: periodPosts.filter((p) => p.status === 'FAILED').length,
    }),
    [periodPosts]
  );

  // Biểu đồ tần suất hoạt động
  const chartData = useMemo(() => {
    const points = period === 'DAY' ? 8 : period === 'WEEK' ? 7 : Math.min(range.end.date(), 30);
    return Array.from({ length: points }, (_, index) => {
      const start =
        period === 'DAY'
          ? range.start.add(index * 3, 'hour')
          : period === 'WEEK'
          ? range.start.add(index, 'day')
          : range.start.add(index, 'day');
      const end = period === 'DAY' ? start.add(3, 'hour') : start.endOf('day');
      const items = periodPosts.filter((p) => {
        const date = dayjs(getPostDate(p));
        return !date.isBefore(start) && date.isBefore(end);
      });
      return {
        label:
          period === 'DAY'
            ? start.format('HH:mm')
            : period === 'WEEK'
            ? index === 6
              ? 'CN'
              : `T${index + 2}`
            : String(index + 1),
        total: items.length,
        published: items.filter((p) => p.status === 'PUBLISHED').length,
      };
    });
  }, [period, periodPosts, range]);

  const chartMax = Math.max(1, ...chartData.map((item) => item.total));

  // Bài chờ đăng sắp tới
  const upcomingPosts = useMemo(
    () =>
      posts
        .filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING')
        .sort((a, b) => dayjs(a.scheduledAt).valueOf() - dayjs(b.scheduledAt).valueOf())
        .slice(0, 5),
    [posts]
  );

  // Thống kê KPI tổng
  const kpiSummary = useMemo(() => {
    const activeTargets = todayTargets.filter((t) => t.targetCount > 0);
    const totalTarget = activeTargets.reduce((sum, t) => sum + t.targetCount, 0);
    const totalActual = activeTargets.reduce((sum, t) => sum + t.actualCount, 0);
    const percentage = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;
    const completedCount = activeTargets.filter((t) => t.achieved).length;
    return {
      activeTargets,
      totalTarget,
      totalActual,
      percentage,
      completedCount,
      totalCount: activeTargets.length,
    };
  }, [todayTargets]);

  // Options bộ lọc kênh xuất bản
  const channelOptions = useMemo(() => {
    return [
      { value: 'ALL', label: 'Tất cả kênh xuất bản' },
      ...connections.map((c) => ({
        value: c.platformAccountId,
        label: `${c.pageName || c.platformAccountId} (${c.platformAccountId})`,
      })),
    ];
  }, [connections]);

  return (
    <div className="app-page space-y-6">
      {/* 1. EMERGENCY COOKIE BANNER (HIỂN THỊ NẾU CÓ COOKIE HẾT HẠN) */}
      {expiredCookieAccounts.length > 0 && (
        <div className="rounded-2xl border border-red-500/30 bg-gradient-to-r from-red-950/30 via-slate-900/60 to-red-950/20 p-4 shadow-[0_4px_24px_rgba(239,68,68,0.14)] backdrop-blur-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 flex items-center justify-center shrink-0 mt-0.5">
                <ExclamationCircleFilled className="text-base" />
              </div>
              <div>
                <div className="font-semibold text-sm text-red-200 flex items-center gap-2">
                  <span>Có {expiredCookieAccounts.length} kết nối Facebook Cookie đã hết hạn!</span>
                  <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
                </div>
                <div className="text-xs text-red-400/80 mt-0.5">
                  Các Fanpage: <b>{expiredCookieAccounts.map((a) => a.pageName || a.platformAccountId).join(', ')}</b> đang bị gián đoạn xuất bản.
                </div>
              </div>
            </div>
            <Button
              type="primary"
              danger
              icon={<ThunderboltOutlined />}
              onClick={() => {
                setQuickCookieTargetId(expiredCookieAccounts[0]?.id);
                setQuickCookieModalOpen(true);
              }}
              className="font-bold text-xs h-9 px-4 rounded-xl shrink-0 shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              Cập nhật Cookie (1-Chạm Đồng Bộ)
            </Button>
          </div>
        </div>
      )}

      {/* 2. CONSOLE HUD & CONTROL BAR */}
      <div className="rounded-2xl border border-slate-800/90 bg-slate-900/95 p-4 sm:p-5 shadow-lg backdrop-blur-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-100 tracking-tight flex items-center gap-2">
              Bảng điều khiển xuất bản
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Lọc theo kênh */}
            <Select
              value={selectedChannelId}
              onChange={setSelectedChannelId}
              options={channelOptions}
              className="w-48 text-xs"
              placeholder="Tất cả kênh xuất bản"
            />

            <Segmented<Period>
              value={period}
              onChange={setPeriod}
              options={[
                { label: 'Hôm nay', value: 'DAY' },
                { label: 'Tuần này', value: 'WEEK' },
                { label: 'Tháng này', value: 'MONTH' },
              ]}
              className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-0.5 text-xs"
            />
            <Button
              icon={<SyncOutlined spin={isFetching} />}
              onClick={() => refetch()}
              className="h-9 px-3.5 rounded-xl bg-slate-800/60 border border-slate-700/80 text-slate-200 hover:text-white hover:bg-slate-700/80 text-xs font-medium transition-colors"
            >
              Làm mới
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/dashboard/playwright')}
              className="h-9 px-4 rounded-xl !bg-gradient-to-r !from-blue-600 !to-indigo-600 hover:!from-blue-500 hover:!to-indigo-500 text-xs font-bold text-white shadow-md shadow-blue-600/30 border-0 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              Tạo bài viết mới
            </Button>
          </div>
        </div>

        {/* Shortcut Dock */}
        <div className="mt-4 pt-3.5 border-t border-slate-800/80 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 font-semibold flex items-center gap-1.5 mr-1">
            <CompassOutlined className="text-sky-400 text-xs" />
            <span>Lối tắt nhanh:</span>
          </span>
          <button
            onClick={() => navigate('/dashboard/playwright')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/60 hover:bg-slate-700/80 text-slate-200 hover:text-white border border-slate-700/60 transition-all font-medium cursor-pointer"
          >
            <PlayCircleOutlined className="text-blue-400" />
            <span>Đăng tự động</span>
          </button>
          <button
            onClick={() => navigate('/dashboard/news-radar')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/60 hover:bg-slate-700/80 text-slate-200 hover:text-white border border-slate-700/60 transition-all font-medium cursor-pointer"
          >
            <RadarChartOutlined className="text-cyan-400" />
            <span>Radar tin tức</span>
          </button>
          <button
            onClick={() => navigate('/dashboard/post-story')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/60 hover:bg-slate-700/80 text-slate-200 hover:text-white border border-slate-700/60 transition-all font-medium cursor-pointer"
          >
            <PictureOutlined className="text-purple-400" />
            <span>Đăng Story</span>
          </button>
          <button
            onClick={() => navigate('/dashboard/threads')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/60 hover:bg-slate-700/80 text-slate-200 hover:text-white border border-slate-700/60 transition-all font-medium cursor-pointer"
          >
            <span className="font-bold">@</span>
            <span>Đăng Threads</span>
          </button>
          <button
            onClick={() => navigate('/dashboard/connections')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/60 hover:bg-slate-700/80 text-slate-200 hover:text-emerald-300 border border-slate-700/60 transition-all font-medium ml-auto cursor-pointer"
          >
            <GlobalOutlined className="text-emerald-400" />
            <span>Quản lý kênh & Via</span>
            <ArrowRightOutlined className="text-[10px]" />
          </button>
        </div>
      </div>

      {/* 3. HERO METRIC CARDS (DOUBLE-BEZEL BENTO METRICS) */}
      <Row gutter={[14, 14]}>
        {/* Card 1: Tổng bài đăng */}
        <Col xs={24} sm={12} xl={6}>
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/95 p-4 shadow-lg hover:border-slate-700 transition-all flex flex-col justify-between h-full backdrop-blur-xl">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span className="font-medium text-slate-300">Tổng bài xuất bản</span>
              <span className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-semibold">
                {range.label}
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-3xl font-extrabold text-slate-100 tracking-tight">{counts.total}</span>
              <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400 flex items-center justify-center">
                <UnorderedListOutlined className="text-base" />
              </div>
            </div>
            <div className="text-[11px] text-slate-400 mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between">
              <span>Đã lên lịch trong kỳ</span>
              <span className="text-slate-300 font-semibold">{periodPosts.length} bài</span>
            </div>
          </div>
        </Col>

        {/* Card 2: Thành công */}
        <Col xs={24} sm={12} xl={6}>
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/95 p-4 shadow-lg hover:border-slate-700 transition-all flex flex-col justify-between h-full backdrop-blur-xl">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span className="font-medium text-slate-300">Đã đăng thành công</span>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold">
                {counts.total ? `${Math.round((counts.published / counts.total) * 100)}%` : '0%'}
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-3xl font-extrabold text-emerald-400 tracking-tight">{counts.published}</span>
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                <CheckCircleFilled className="text-base" />
              </div>
            </div>
            <div className="text-[11px] text-slate-400 mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between">
              <span>Hiệu suất đăng tải</span>
              <span className="text-emerald-400 font-semibold">Tự động 100%</span>
            </div>
          </div>
        </Col>

        {/* Card 3: Đang chờ */}
        <Col xs={24} sm={12} xl={6}>
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/95 p-4 shadow-lg hover:border-slate-700 transition-all flex flex-col justify-between h-full backdrop-blur-xl">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span className="font-medium text-slate-300">Đang chờ xuất bản</span>
              <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-semibold">
                Hàng đợi
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-3xl font-extrabold text-amber-400 tracking-tight">{counts.pending}</span>
              <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                <ClockCircleFilled className="text-base" />
              </div>
            </div>
            <div className="text-[11px] text-slate-400 mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between">
              <span>Lịch hẹn tự động</span>
              <span className="text-amber-400 font-semibold">{upcomingPosts.length} bài sắp xuất bản</span>
            </div>
          </div>
        </Col>

        {/* Card 4: Cần kiểm tra */}
        <Col xs={24} sm={12} xl={6}>
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/95 p-4 shadow-lg hover:border-slate-700 transition-all flex flex-col justify-between h-full backdrop-blur-xl">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span className="font-medium text-slate-300">Cần kiểm tra / Lỗi</span>
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                  counts.failed > 0
                    ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                }`}
              >
                {counts.failed > 0 ? `${counts.failed} lỗi` : 'Ổn định 100%'}
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className={`text-3xl font-extrabold tracking-tight ${counts.failed > 0 ? 'text-red-400' : 'text-slate-100'}`}>
                {counts.failed}
              </span>
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
                  counts.failed > 0
                    ? 'bg-red-500/15 border-red-500/30 text-red-400'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                <CloseCircleFilled className="text-base" />
              </div>
            </div>
            <div className="text-[11px] text-slate-400 mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between">
              <span>Trạng thái rủi ro</span>
              <span className={counts.failed > 0 ? 'text-red-400 font-semibold' : 'text-slate-400'}>
                {counts.failed > 0 ? 'Cần xử lý lại' : 'Hoàn toàn ổn định'}
              </span>
            </div>
          </div>
        </Col>
      </Row>

      {/* 4. KPI BENTO SECTION (TIẾN ĐỘ MỤC TIÊU HÔM NAY) */}
      <div className="rounded-2xl border border-slate-800/90 bg-slate-900/95 p-5 shadow-lg backdrop-blur-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400 flex items-center justify-center">
              <AimOutlined className="text-sm" />
            </div>
            <div>
              <span className="font-bold text-slate-100 text-sm">
                Tiến độ KPI hôm nay ({dayjs().format('DD/MM/YYYY')})
              </span>
              <span className="text-xs text-slate-400 ml-2 hidden sm:inline">
                Đã đạt {kpiSummary.completedCount}/{kpiSummary.totalCount} kênh mục tiêu
              </span>
            </div>
          </div>

          <Button
            type="link"
            size="small"
            onClick={() => navigate('/dashboard/calendar')}
            className="text-xs text-blue-400 hover:text-blue-300 p-0 font-medium"
          >
            Tùy chỉnh KPI →
          </Button>
        </div>

        {kpiSummary.activeTargets.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500 bg-slate-950/30 rounded-xl border border-slate-800/60">
            Chưa thiết lập KPI cho ngày hôm nay.{' '}
            <a onClick={() => navigate('/dashboard/calendar')} className="text-blue-400 underline font-medium cursor-pointer">
              Bấm vào đây để đặt KPI số lượng bài cho từng Fanpage/Nhóm.
            </a>
          </div>
        ) : (
          <Row gutter={[12, 12]}>
            {kpiSummary.activeTargets.map((t) => {
              const percent = Math.min(100, Math.round((t.actualCount / t.targetCount) * 100));
              const isOverachieved = t.actualCount > t.targetCount;

              return (
                <Col xs={24} sm={12} lg={8} key={t.socialAccountId}>
                  <div className="p-3.5 rounded-xl border border-slate-800/90 bg-slate-900/90 hover:border-slate-700 transition-all flex flex-col justify-between h-full">
                    <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {t.platform === 'FACEBOOK_GROUP' ? (
                          <TeamOutlined className="text-purple-400 shrink-0 text-xs" />
                        ) : (
                          <FacebookFilled className="text-blue-400 shrink-0 text-xs" />
                        )}
                        <span className="text-xs font-semibold text-slate-200 truncate" title={t.accountName}>
                          {t.accountName}
                        </span>
                      </div>
                      <span
                        className={`text-[11px] font-mono px-2 py-0.5 rounded-md font-semibold shrink-0 ${
                          t.achieved
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {t.actualCount}/{t.targetCount}
                        {isOverachieved && ' 🚀'}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span>{t.achieved ? (isOverachieved ? 'Vượt chỉ tiêu' : 'Đạt chỉ tiêu') : 'Đang thực hiện'}</span>
                        <span className="font-mono">{percent}%</span>
                      </div>
                      <Progress
                        percent={percent}
                        size="small"
                        strokeColor={t.achieved ? { '0%': '#10b981', '100%': '#34d399' } : { '0%': '#f59e0b', '100%': '#fbbf24' }}
                        trailColor="rgba(255, 255, 255, 0.06)"
                        showInfo={false}
                      />
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>
        )}
      </div>

      {/* 5. TIMELINE CHART & UPCOMING SCHEDULE BENTO */}
      <Row gutter={[16, 16]}>
        {/* Left: Posting Activity Histogram */}
        <Col xs={24} xl={16}>
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/95 p-5 shadow-lg flex flex-col justify-between h-full backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <RiseOutlined className="text-blue-400" />
                <span className="font-bold text-slate-100 text-sm">
                  Hoạt động xuất bản · {range.label}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm bg-blue-500" />
                  Đã đăng
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm bg-slate-700" />
                  Chưa đăng
                </span>
              </div>
            </div>

            {periodPosts.length === 0 ? (
              <div className="h-60 flex items-center justify-center text-xs text-slate-500">
                Chưa có dữ liệu bài đăng trong khoảng thời gian này
              </div>
            ) : (
              <div className="h-60 flex items-end gap-2 pt-6">
                {chartData.map((item, index) => (
                  <div key={`${item.label}-${index}`} className="flex-1 h-full flex flex-col justify-end items-center min-w-0 group relative">
                    <Tooltip title={`${item.label}: ${item.published}/${item.total} bài đã đăng`}>
                      <div className="w-full max-w-7 h-[200px] flex flex-col justify-end rounded-t-lg overflow-hidden bg-slate-800/40 border border-slate-700/40 group-hover:border-blue-500/50 transition-all cursor-pointer">
                        <div
                          className="w-full bg-gradient-to-t from-blue-600 to-cyan-400 rounded-t-md transition-all duration-500"
                          style={{ height: `${Math.max(item.total ? 10 : 0, (item.published / chartMax) * 100)}%` }}
                        />
                        <div
                          className="w-full bg-slate-700/60"
                          style={{ height: `${Math.max(item.total ? 5 : 0, ((item.total - item.published) / chartMax) * 100)}%` }}
                        />
                      </div>
                    </Tooltip>
                    <span className="text-[10px] text-slate-400 mt-2 font-mono truncate">{item.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Col>

        {/* Right: Upcoming Posts with Quick Publish */}
        <Col xs={24} xl={8}>
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/95 p-5 shadow-lg flex flex-col justify-between h-full backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <ClockCircleFilled className="text-amber-400" />
                <span className="font-bold text-slate-100 text-sm">Bài sắp xuất bản</span>
              </div>
              <Button
                type="link"
                size="small"
                onClick={() => navigate('/dashboard/playwright')}
                className="text-xs text-blue-400 hover:text-blue-300 p-0"
              >
                Xem tất cả ({counts.pending})
              </Button>
            </div>

            {upcomingPosts.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                <CalendarOutlined className="text-2xl text-slate-600 mb-2 block" />
                Không có bài viết nào đang xếp hàng chờ
              </div>
            ) : (
              <div className="space-y-2.5">
                {upcomingPosts.map((post) => (
                  <div
                    key={post.id}
                    className="p-3 rounded-xl border border-slate-800/80 bg-slate-900/90 hover:border-slate-700 transition-all flex items-start justify-between gap-3 group"
                  >
                    <div
                      className="min-w-0 flex-1 cursor-pointer"
                      onClick={() => setViewingPost(post as PostQueueItem)}
                    >
                      <div className="text-xs font-semibold text-slate-200 truncate group-hover:text-blue-400 transition-colors">
                        {post.title || post.content || `Bài đăng #${post.id}`}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
                        <CalendarOutlined className="text-[10px]" />
                        <span>{post.scheduledAt ? dayjs(post.scheduledAt).format('HH:mm · DD/MM') : 'Xử lý ngay'}</span>
                        {post.scheduledAt && (
                          <span className="text-amber-400/80 font-mono text-[10px]">
                            ({dayjs(post.scheduledAt).fromNow()})
                          </span>
                        )}
                      </div>
                    </div>

                    <Tooltip title="Đăng ngay lập tức không cần chờ hẹn giờ">
                      <Button
                        size="small"
                        type="primary"
                        icon={<ThunderboltOutlined />}
                        loading={publishNowMutation.isPending && publishingId === post.id}
                        onClick={() => publishNowMutation.mutate(post.id)}
                        className="text-[11px] h-7 px-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 shrink-0 font-medium"
                      >
                        Đăng ngay
                      </Button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Col>
      </Row>

      {/* 6. RECENT POSTS TABLE WITH INSTANT RETRY & PREVIEW */}
      <div className="rounded-2xl border border-slate-800/90 bg-slate-900/95 p-5 shadow-lg backdrop-blur-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <HistoryOutlined className="text-blue-400" />
            <span className="font-bold text-slate-100 text-sm">Nhật ký bài đăng gần đây</span>
          </div>
          <Button
            type="link"
            size="small"
            onClick={() => navigate('/dashboard/playwright')}
            className="text-xs text-blue-400 hover:text-blue-300 p-0 font-medium"
          >
            Quản lý hàng đợi →
          </Button>
        </div>

        <Table<PostQueue>
          rowKey="id"
          loading={loadingPosts}
          dataSource={periodPosts.slice(0, 8)}
          pagination={false}
          scroll={{ x: 720 }}
          size="small"
          locale={{ emptyText: 'Chưa có bài đăng nào được ghi nhận' }}
          columns={[
            {
              title: 'Nội dung bài viết',
              key: 'post',
              render: (_, record) => (
                <div
                  className="max-w-md py-1 cursor-pointer group"
                  onClick={() => setViewingPost(record as PostQueueItem)}
                >
                  <div className="text-xs font-semibold text-slate-200 truncate group-hover:text-blue-400 transition-colors">
                    {record.title || `Bài đăng #${record.id}`}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">
                    {record.content || 'Không có mô tả chi tiết'}
                  </div>
                </div>
              ),
            },
            {
              title: 'Chiến dịch / Kênh',
              key: 'campaign',
              width: 170,
              render: (_, record) => {
                const targetChannel = connections.find((c) => c.platformAccountId === record.targetFanpageId);
                return (
                  <div className="text-xs text-slate-400">
                    <div className="truncate font-medium">{record.campaign?.name || 'Mặc định'}</div>
                    {targetChannel && (
                      <div className="text-[10px] text-slate-500 font-mono truncate">{targetChannel.pageName || targetChannel.platformAccountId}</div>
                    )}
                  </div>
                );
              },
            },
            {
              title: 'Thời gian',
              key: 'date',
              width: 160,
              render: (_, record) => {
                const dateVal = getPostDate(record);
                return (
                  <span className="text-xs text-slate-400 font-mono">
                    {dateVal ? dayjs(dateVal).format('HH:mm · DD/MM/YYYY') : '—'}
                  </span>
                );
              },
            },
            {
              title: 'Trạng thái',
              dataIndex: 'status',
              width: 130,
              render: (status: string) => {
                const meta = statusMeta[status] || statusMeta.CANCELLED;
                return (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium border ${
                      status === 'PUBLISHED'
                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                        : status === 'FAILED'
                        ? 'bg-red-500/10 text-red-300 border-red-500/20'
                        : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    {meta.icon}
                    <span>{meta.label}</span>
                  </span>
                );
              },
            },
            {
              title: 'Thao tác',
              key: 'actions',
              width: 110,
              render: (_, record) => (
                <Space size="small">
                  <Tooltip title="Xem chi tiết bài viết">
                    <Button
                      type="text"
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => setViewingPost(record as PostQueueItem)}
                      className="text-slate-400 hover:text-blue-400"
                    />
                  </Tooltip>
                  {record.status === 'FAILED' && (
                    <Tooltip title="Thử đăng lại ngay">
                      <Button
                        size="small"
                        type="primary"
                        danger
                        icon={<ReloadOutlined />}
                        loading={publishNowMutation.isPending && publishingId === record.id}
                        onClick={() => publishNowMutation.mutate(record.id)}
                        className="text-[11px] h-6 px-2 font-medium rounded"
                      >
                        Thử lại
                      </Button>
                    </Tooltip>
                  )}
                  {record.status === 'PENDING' && (
                    <Tooltip title="Đăng ngay">
                      <Button
                        type="text"
                        size="small"
                        icon={<ThunderboltOutlined className="text-amber-400" />}
                        loading={publishNowMutation.isPending && publishingId === record.id}
                        onClick={() => publishNowMutation.mutate(record.id)}
                        className="hover:bg-amber-950/40 rounded"
                      />
                    </Tooltip>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </div>

      {/* MODAL / DRAWER CHI TIẾT BÀI ĐĂNG (PREVIEW / LOG) */}
      <PostDetailModal
        open={!!viewingPost}
        onClose={() => setViewingPost(null)}
        post={viewingPost}
      />

      {/* QUICK COOKIE UPDATE MODAL */}
      <QuickUpdateCookieModal
        open={quickCookieModalOpen}
        onClose={() => setQuickCookieModalOpen(false)}
        targetAccountId={quickCookieTargetId}
      />
    </div>
  );
};

export default Dashboard;
