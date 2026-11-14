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
  App, Flex, Alert, Statistic,
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
  PENDING: { label: 'Chờ đăng', color: 'processing', icon: <ClockCircleFilled className="dash-ic-amber" /> },
  PROCESSING: { label: 'Đang đăng', color: 'purple', icon: <SyncOutlined spin className="dash-ic-blue" /> },
  PUBLISHED: { label: 'Đã xuất bản', color: 'success', icon: <CheckCircleFilled className="dash-ic-emerald" /> },
  FAILED: { label: 'Đăng lỗi', color: 'error', icon: <CloseCircleFilled className="dash-ic-red" /> },
  CANCELLED: { label: 'Đã hủy', color: 'default', icon: <CloseCircleFilled className="dash-ic-slate" /> },
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

  const daysParam = period === 'MONTH' ? 30 : period === 'WEEK' ? 7 : 3;

  // 2. Fetch danh sách bài đăng (tối ưu: tải theo kỳ thời gian và cache 60s)
  const { data: posts = [], isLoading: loadingPosts, refetch, isFetching } = useQuery({
    queryKey: ['postQueue', daysParam],
    queryFn: async () => {
      // 1 request cho mọi campaign (mỗi item đã kèm `campaign`)
      const items = ((await api.get('/queue/recent', { params: { days: daysParam } })).data || []) as PostQueue[];
      return items
        .sort((a, b) => (dayjs(getPostDate(b)).valueOf() || b.id) - (dayjs(getPostDate(a)).valueOf() || a.id));
    },
    staleTime: 60000,
    refetchInterval: 120000,
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
    <div className="app-page dash-page">
      {/* 1. EMERGENCY COOKIE BANNER (HIỂN THỊ NẾU CÓ COOKIE HẾT HẠN) */}
      {expiredCookieAccounts.length > 0 && (
        <Alert
          type="error"
          showIcon
          className="mb-4 shadow-xl border border-red-500/40"
          message={
            <Typography.Text strong className="text-red-300">
              Có {expiredCookieAccounts.length} kết nối Facebook Cookie đã hết hạn!
            </Typography.Text>
          }
          description={
            <Typography.Text className="text-slate-200 text-sm">
              Các Fanpage: <b>{expiredCookieAccounts.map((a) => a.pageName || a.platformAccountId).join(', ')}</b> đang bị gián đoạn xuất bản.
            </Typography.Text>
          }
          action={
            <Button
              type="primary"
              danger
              icon={<ThunderboltOutlined />}
              onClick={() => {
                setQuickCookieTargetId(expiredCookieAccounts[0]?.id);
                setQuickCookieModalOpen(true);
              }}
            >
              Cập nhật Cookie (1-Chạm)
            </Button>
          }
        />
      )}

      {/* 2. CONSOLE HUD & CONTROL BAR */}
      <Card variant="borderless" className="mb-4 shadow-xl border border-slate-800/80 bg-[#111a28]">
        <Flex justify="space-between" align="center" wrap gap="middle">
          <Typography.Title level={4} className="!mb-0 !text-white flex items-center gap-2">
            <CompassOutlined className="text-blue-500" /> Bảng điều khiển xuất bản
          </Typography.Title>

          <Flex wrap align="center" gap={10}>
            <Select
              value={selectedChannelId}
              onChange={setSelectedChannelId}
              options={channelOptions}
              style={{ minWidth: 220 }}
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
            />
            <Button
              icon={<SyncOutlined spin={isFetching} />}
              onClick={() => refetch()}
            >
              Làm mới
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/dashboard/playwright')}
            >
              Tạo bài viết mới
            </Button>
          </Flex>
        </Flex>

        {/* Shortcut Dock */}
        <Flex align="center" wrap gap={8} className="mt-4 pt-3 border-t border-slate-800/80">
          <Typography.Text className="text-[13px] text-slate-300 font-semibold flex items-center gap-1.5 mr-2">
            <CompassOutlined /> Lối tắt nhanh:
          </Typography.Text>
          <Button
            type="dashed"
            size="middle"
            icon={<PlayCircleOutlined className="text-blue-400" />}
            onClick={() => navigate('/dashboard/playwright')}
          >
            Đăng tự động
          </Button>
          <Button
            type="dashed"
            size="middle"
            icon={<RadarChartOutlined className="text-cyan-400" />}
            onClick={() => navigate('/dashboard/news-radar')}
          >
            Radar tin tức
          </Button>
          <Button
            type="dashed"
            size="middle"
            icon={<PictureOutlined className="text-purple-400" />}
            onClick={() => navigate('/dashboard/post-story')}
          >
            Đăng Story
          </Button>
          <Button
            type="dashed"
            size="middle"
            icon={<span className="font-extrabold text-blue-400">@</span>}
            onClick={() => navigate('/dashboard/threads')}
          >
            Đăng Threads
          </Button>
          <Button
            type="link"
            size="middle"
            icon={<GlobalOutlined className="text-emerald-400" />}
            onClick={() => navigate('/dashboard/connections')}
            className="ml-auto"
          >
            Quản lý kênh & Via <ArrowRightOutlined />
          </Button>
        </Flex>
      </Card>

      {/* 3. HERO METRIC CARDS */}
      <Row gutter={[14, 14]} className="mb-4">
        {/* Card 1: Tổng bài đăng */}
        <Col xs={24} sm={12} xl={6}>
          <Card variant="borderless" className="shadow-lg border border-slate-800/80 bg-[#111a28] h-full">
            <Flex justify="space-between" align="start">
              <div>
                <Typography.Text className="text-[13.5px] text-slate-300 block mb-1">Tổng bài xuất bản</Typography.Text>
                <Typography.Title level={2} className="!mb-0 !text-white font-bold">
                  {counts.total}
                </Typography.Title>
              </div>
              <Tag color="blue" className="!m-0">{range.label}</Tag>
            </Flex>
            <Flex justify="space-between" align="center" className="mt-4 pt-2.5 border-t border-slate-800 text-[13px] text-slate-300">
              <span>Đã lên lịch trong kỳ</span>
              <Typography.Text strong className="text-slate-100">{periodPosts.length} bài</Typography.Text>
            </Flex>
          </Card>
        </Col>

        {/* Card 2: Thành công */}
        <Col xs={24} sm={12} xl={6}>
          <Card variant="borderless" className="shadow-lg border border-slate-800/80 bg-[#111a28] h-full">
            <Flex justify="space-between" align="start">
              <div>
                <Typography.Text className="text-[13.5px] text-slate-300 block mb-1">Đã đăng thành công</Typography.Text>
                <Typography.Title level={2} className="!mb-0 !text-emerald-400 font-bold">
                  {counts.published}
                </Typography.Title>
              </div>
              <Tag color="success" className="!m-0">
                {counts.total ? `${Math.round((counts.published / counts.total) * 100)}%` : '0%'}
              </Tag>
            </Flex>
            <Flex justify="space-between" align="center" className="mt-4 pt-2.5 border-t border-slate-800 text-[13px] text-slate-300">
              <span>Hiệu suất đăng tải</span>
              <Typography.Text strong className="text-emerald-400">Tự động 100%</Typography.Text>
            </Flex>
          </Card>
        </Col>

        {/* Card 3: Đang chờ */}
        <Col xs={24} sm={12} xl={6}>
          <Card variant="borderless" className="shadow-lg border border-slate-800/80 bg-[#111a28] h-full">
            <Flex justify="space-between" align="start">
              <div>
                <Typography.Text className="text-[13.5px] text-slate-300 block mb-1">Đang chờ xuất bản</Typography.Text>
                <Typography.Title level={2} className="!mb-0 !text-amber-400 font-bold">
                  {counts.pending}
                </Typography.Title>
              </div>
              <Tag color="warning" className="!m-0">Hàng đợi</Tag>
            </Flex>
            <Flex justify="space-between" align="center" className="mt-4 pt-2.5 border-t border-slate-800 text-[13px] text-slate-300">
              <span>Lịch hẹn tự động</span>
              <Typography.Text strong className="text-amber-400">{upcomingPosts.length} bài sắp đăng</Typography.Text>
            </Flex>
          </Card>
        </Col>

        {/* Card 4: Cần kiểm tra */}
        <Col xs={24} sm={12} xl={6}>
          <Card variant="borderless" className="shadow-lg border border-slate-800/80 bg-[#111a28] h-full">
            <Flex justify="space-between" align="start">
              <div>
                <Typography.Text className="text-[13.5px] text-slate-300 block mb-1">Cần kiểm tra / Lỗi</Typography.Text>
                <Typography.Title level={2} className={`!mb-0 font-bold ${counts.failed > 0 ? '!text-red-400' : '!text-slate-100'}`}>
                  {counts.failed}
                </Typography.Title>
              </div>
              <Tag color={counts.failed > 0 ? 'error' : 'success'} className="!m-0">
                {counts.failed > 0 ? `${counts.failed} lỗi` : 'Ổn định 100%'}
              </Tag>
            </Flex>
            <Flex justify="space-between" align="center" gap={8} className="mt-4 pt-2.5 border-t border-slate-800 text-[13px] text-slate-300">
              <span className="whitespace-nowrap">Rủi ro hệ thống</span>
              <Typography.Text strong className={`whitespace-nowrap ${counts.failed > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {counts.failed > 0 ? 'Cần xử lý lại' : 'Hoàn toàn ổn định'}
              </Typography.Text>
            </Flex>
          </Card>
        </Col>
      </Row>

      {/* 4. KPI BENTO SECTION (TIẾN ĐỘ MỤC TIÊU HÔM NAY) */}
      <Card variant="borderless" className="mb-4 shadow-xl border border-slate-800/80 bg-[#111a28]">
        <Flex align="center" justify="space-between" className="mb-4">
          <Flex align="center" gap={10}>
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 grid place-items-center text-blue-400 text-base">
              <AimOutlined />
            </div>
            <div>
              <Typography.Text strong className="text-base text-slate-100 block">
                Tiến độ KPI hôm nay ({dayjs().format('DD/MM/YYYY')})
              </Typography.Text>
              <Typography.Text className="text-[13.5px] text-slate-300">
                Đã đạt {kpiSummary.completedCount}/{kpiSummary.totalCount} kênh mục tiêu
              </Typography.Text>
            </div>
          </Flex>

          <Button
            type="link"
            size="middle"
            onClick={() => navigate('/dashboard/calendar')}
          >
            Tùy chỉnh KPI →
          </Button>
        </Flex>

        {kpiSummary.activeTargets.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Typography.Text className="text-slate-300 text-sm">
                Chưa thiết lập KPI cho ngày hôm nay.{' '}
                <Button type="link" size="middle" onClick={() => navigate('/dashboard/calendar')} className="!p-0">
                  Đặt KPI số lượng bài cho từng kênh
                </Button>
              </Typography.Text>
            }
          />
        ) : (
          <Row gutter={[12, 12]}>
            {kpiSummary.activeTargets.map((t) => {
              const percent = Math.min(100, Math.round((t.actualCount / t.targetCount) * 100));
              const isOverachieved = t.actualCount > t.targetCount;

              return (
                <Col xs={24} sm={12} lg={8} key={t.socialAccountId}>
                  <Card size="small" variant="borderless" className="bg-[#0e1726] border border-slate-800 h-full">
                    <Flex align="center" justify="space-between" gap={8} className="mb-2">
                      <Flex align="center" gap={8} className="min-w-0">
                        {t.platform === 'FACEBOOK_GROUP' ? (
                          <TeamOutlined className="text-purple-400 shrink-0" />
                        ) : (
                          <FacebookFilled className="text-blue-500 shrink-0" />
                        )}
                        <Typography.Text strong className="text-slate-100 text-[13.5px] truncate" title={t.accountName}>
                          {t.accountName}
                        </Typography.Text>
                      </Flex>
                      <Tag color={t.achieved ? 'success' : 'warning'} className="!m-0 !text-xs">
                        {t.actualCount}/{t.targetCount}
                        {isOverachieved && ' 🚀'}
                      </Tag>
                    </Flex>

                    <div>
                      <Flex justify="space-between" className="text-[12.5px] text-slate-300 mb-1">
                        <span>{t.achieved ? (isOverachieved ? 'Vượt chỉ tiêu' : 'Đạt chỉ tiêu') : 'Đang thực hiện'}</span>
                        <Typography.Text strong className="text-slate-200">{percent}%</Typography.Text>
                      </Flex>
                      <Progress
                        percent={percent}
                        size="small"
                        strokeColor={t.achieved ? { '0%': '#10b981', '100%': '#34d399' } : { '0%': '#f59e0b', '100%': '#fbbf24' }}
                        trailColor="rgba(255, 255, 255, 0.06)"
                        showInfo={false}
                      />
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </Card>

      {/* 5. TIMELINE CHART & UPCOMING SCHEDULE BENTO */}
      <Row gutter={[16, 16]}>
        {/* Left: Posting Activity Histogram */}
        <Col xs={24} xl={16}>
          <div className="dash-panel-fill">
            <Flex align="center" justify="space-between" className="dash-panel-head">
              <Flex align="center" gap={8}>
                <RiseOutlined className="dash-ic-blue" />
                <span className="dash-panel-title">
                  Hoạt động xuất bản · {range.label}
                </span>
              </Flex>
              <Flex align="center" gap={12} className="dash-legend">
                <span className="dash-legend-item">
                  <span className="dash-legend-dot-blue" />
                  Đã đăng
                </span>
                <span className="dash-legend-item">
                  <span className="dash-legend-dot-slate" />
                  Chưa đăng
                </span>
              </Flex>
            </Flex>

            {periodPosts.length === 0 ? (
              <Flex align="center" justify="center" className="dash-chart-empty">
                Chưa có dữ liệu bài đăng trong khoảng thời gian này
              </Flex>
            ) : (
              <Flex align="end" gap={8} className="dash-chart">
                {chartData.map((item, index) => (
                  <Flex vertical justify="flex-end" align="center" key={`${item.label}-${index}`} className="dash-chart-col">
                    <Tooltip title={`${item.label}: ${item.published}/${item.total} bài đã đăng`}>
                      <Flex vertical justify="flex-end" className="group-hover:border-blue-500/50 dash-chart-bar">
                        <div
                          className="dash-chart-bar-done"
                          style={{ height: `${Math.max(item.total ? 10 : 0, (item.published / chartMax) * 100)}%` }}
                        />
                        <div
                          className="dash-chart-bar-rest"
                          style={{ height: `${Math.max(item.total ? 5 : 0, ((item.total - item.published) / chartMax) * 100)}%` }}
                        />
                      </Flex>
                    </Tooltip>
                    <span className="dash-chart-label">{item.label}</span>
                  </Flex>
                ))}
              </Flex>
            )}
          </div>
        </Col>

        {/* Right: Upcoming Posts with Quick Publish */}
        <Col xs={24} xl={8}>
          <div className="dash-panel-fill">
            <Flex align="center" justify="space-between" className="dash-panel-head">
              <Flex align="center" gap={8}>
                <ClockCircleFilled className="dash-ic-amber" />
                <span className="dash-panel-title">Bài sắp xuất bản</span>
              </Flex>
              <Button
                type="link"
                size="small"
                onClick={() => navigate('/dashboard/playwright')}
                className="dash-link-btn-plain"
              >
                Xem tất cả ({counts.pending})
              </Button>
            </Flex>

            {upcomingPosts.length === 0 ? (
              <div className="dash-upcoming-empty">
                <CalendarOutlined className="dash-upcoming-empty-ic" />
                Không có bài viết nào đang xếp hàng chờ
              </div>
            ) : (
              <div className="dash-upcoming-list">
                {upcomingPosts.map((post) => (
                  <div
                    key={post.id}
                    className="dash-upcoming-item"
                  >
                    <div
                      className="dash-upcoming-main"
                      onClick={() => setViewingPost(post as PostQueueItem)}
                    >
                      <div className="group-hover:text-blue-400 dash-upcoming-title">
                        {post.title || post.content || `Bài đăng #${post.id}`}
                      </div>
                      <Flex align="center" gap={6} className="dash-upcoming-meta">
                        <CalendarOutlined className="dash-ic-10" />
                        <span>{post.scheduledAt ? dayjs(post.scheduledAt).format('HH:mm · DD/MM') : 'Xử lý ngay'}</span>
                        {post.scheduledAt && (
                          <span className="dash-upcoming-rel">
                            ({dayjs(post.scheduledAt).fromNow()})
                          </span>
                        )}
                      </Flex>
                    </div>

                    <Tooltip title="Đăng ngay lập tức không cần chờ hẹn giờ">
                      <Button
                        size="small"
                        type="primary"
                        icon={<ThunderboltOutlined />}
                        loading={publishNowMutation.isPending && publishingId === post.id}
                        onClick={() => publishNowMutation.mutate(post.id)}
                        className="dash-publish-btn"
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
      <div className="dash-panel">
        <Flex align="center" justify="space-between" className="dash-panel-head">
          <Flex align="center" gap={8}>
            <HistoryOutlined className="dash-ic-blue" />
            <span className="dash-panel-title">Nhật ký bài đăng gần đây</span>
          </Flex>
          <Button
            type="link"
            size="small"
            onClick={() => navigate('/dashboard/playwright')}
            className="dash-link-btn"
          >
            Quản lý hàng đợi →
          </Button>
        </Flex>

        <Table<PostQueue>
          rowKey="id"
          loading={loadingPosts}
          dataSource={periodPosts.slice(0, 8)}
          pagination={false}
          scroll={{ x: 720 }}
          size="middle"
          locale={{ emptyText: 'Chưa có bài đăng nào được ghi nhận' }}
          columns={[
            {
              title: 'Nội dung bài viết',
              key: 'post',
              render: (_, record) => (
                <div
                  className="dash-table-post"
                  onClick={() => setViewingPost(record as PostQueueItem)}
                >
                  <div className="group-hover:text-blue-400 dash-upcoming-title">
                    {record.title || `Bài đăng #${record.id}`}
                  </div>
                  <div className="dash-table-desc">
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
                  <div className="dash-table-campaign">
                    <div className="dash-truncate-medium">{record.campaign?.name || 'Mặc định'}</div>
                    {targetChannel && (
                      <div className="dash-table-channel">{targetChannel.pageName || targetChannel.platformAccountId}</div>
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
                  <span className="dash-table-date">
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
                    className={
                      status === 'PUBLISHED'
                        ? 'dash-status-ok'
                        : status === 'FAILED'
                        ? 'dash-status-fail'
                        : 'dash-status-other'
                    }
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
                      className="dash-view-btn"
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
                        className="dash-retry-btn"
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
                        icon={<ThunderboltOutlined className="dash-ic-amber" />}
                        loading={publishNowMutation.isPending && publishingId === record.id}
                        onClick={() => publishNowMutation.mutate(record.id)}
                        className="dash-bolt-btn"
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
