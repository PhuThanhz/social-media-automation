import { useState, useMemo } from 'react';
import {
  Card, Typography, Tag, Drawer, Descriptions, Space, Button,
  Calendar, Badge, Modal, DatePicker, Popconfirm, Select, Tooltip, App, Grid, InputNumber, Empty, Alert, Divider, Flex
} from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import {
  CalendarOutlined, ThunderboltOutlined, EditOutlined,
  DeleteOutlined, ReloadOutlined, PlayCircleOutlined,
  PictureOutlined, EyeOutlined, CheckCircleOutlined,
  ClockCircleOutlined, CloseCircleOutlined, SyncOutlined,
  AimOutlined, TeamOutlined, FileTextOutlined
} from '@ant-design/icons';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import api from '../config/axios';

const { Title, Text } = Typography;

interface CalendarPost {
  id: number;
  title: string;
  content?: string;
  status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'CANCELLED';
  scheduledAt: string;
  publishedAt?: string;
  createdAt?: string;
  postType?: string | null;
  mediaUrls?: string;
  originalUrl?: string;
  targetFanpageId?: string;
  campaign?: { name?: string };
  errorMessage?: string;
}

interface PostTargetItem {
  targetId: number;
  socialAccountId: number;
  platform: string; // FACEBOOK_PAGE | FACEBOOK_GROUP
  accountName: string;
  date: string; // YYYY-MM-DD
  targetCount: number;
  actualCount: number;
  achieved: boolean;
}

interface KpiAccount {
  id: number;
  platform: string;
  platformAccountId: string;
  pageName: string;
}

// dayjs chưa cấu hình locale 'vi' trong app (format 'dddd' ra tiếng Anh) — tự map thứ tiếng Việt
// thay vì đổi locale toàn cục để tránh ảnh hưởng tới các chỗ dùng dayjs format khác trong app.
const VI_WEEKDAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

const STATUS_CONFIG: Record<string, { color: string; label: string; tagColor: string }> = {
  PENDING: { color: '#2563eb', label: 'Chờ đăng', tagColor: 'processing' },
  PROCESSING: { color: '#7c3aed', label: 'Đang xử lý', tagColor: 'purple' },
  PUBLISHED: { color: '#16a34a', label: 'Đã đăng', tagColor: 'success' },
  FAILED: { color: '#dc2626', label: 'Thất bại', tagColor: 'error' },
  CANCELLED: { color: '#64748b', label: 'Đã hủy', tagColor: 'default' },
};

export default function ContentCalendar() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.sm;
  const maxChipsPerDay = isMobile ? 1 : 3;

  // Chọn tháng hiện tại
  const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs());
  const [viewingPost, setViewingPost] = useState<CalendarPost | null>(null);
  const [selectedDayPosts, setSelectedDayPosts] = useState<{ date: Dayjs; posts: CalendarPost[] } | null>(null);

  // Modal đổi giờ đăng
  const [reschedulePost, setReschedulePost] = useState<CalendarPost | null>(null);
  const [newScheduleTime, setNewScheduleTime] = useState<Dayjs | null>(null);

  // Bộ lọc
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterType, setFilterType] = useState<string>('ALL');

  // Modal đặt KPI theo ngày
  const [targetModalDate, setTargetModalDate] = useState<Dayjs | null>(null);
  const [targetDrafts, setTargetDrafts] = useState<Record<number, number | null>>({});

  // Khoảng thời gian lấy bài (từ đầu tháng trước đến cuối tháng sau)
  const range = useMemo(() => {
    return {
      from: selectedDate.startOf('month').subtract(7, 'day').format('YYYY-MM-DDTHH:mm:ss'),
      to: selectedDate.endOf('month').add(7, 'day').format('YYYY-MM-DDTHH:mm:ss'),
    };
  }, [selectedDate]);

  // Khoảng ngày (không giờ) dùng cho API KPI /post-targets
  const dateRange = useMemo(() => {
    return {
      from: selectedDate.startOf('month').subtract(7, 'day').format('YYYY-MM-DD'),
      to: selectedDate.endOf('month').add(7, 'day').format('YYYY-MM-DD'),
    };
  }, [selectedDate]);

  // Lấy dữ liệu bài đăng từ backend
  const { data: posts = [], isFetching, refetch } = useQuery<CalendarPost[]>({
    queryKey: ['calendarPosts', range.from, range.to],
    queryFn: async () => {
      const res = await api.get('/queue/calendar', { params: { from: range.from, to: range.to } });
      return res.data?.items || [];
    },
    // Tự động làm mới để bài vừa Lưu từ Extension xuất hiện ngay mà không cần bấm nút Làm mới thủ công.
    refetchInterval: 18000,
  });

  // Lấy KPI + tiến độ theo ngày cho Fanpage/Group
  const { data: targets = [] } = useQuery<PostTargetItem[]>({
    queryKey: ['postTargets', dateRange.from, dateRange.to],
    queryFn: async () => {
      const res = await api.get('/post-targets', { params: dateRange });
      return res.data?.items || [];
    },
  });

  // Danh sách Fanpage + Group đã kết nối, dùng cho modal đặt KPI
  const { data: kpiAccounts = [] } = useQuery<KpiAccount[]>({
    queryKey: ['connections'],
    queryFn: async () => (await api.get('/connections')).data || [],
  });

  // Gộp các kết nối trùng platformAccountId (VD cùng 1 Fanpage có 2 cookie id=3 và id=7) về 1 dòng duy nhất
  // (giữ kết nối mới nhất), tránh hiện 1 trang 2 lần khiến đặt KPI nhầm 1 trong 2 dòng, gây đếm KPI
  // như đang thiếu dù đã đăng đủ lên đúng trang đó qua kết nối còn lại.
  const kpiFanpageAccounts = useMemo(() => Array.from(
    kpiAccounts
      .filter((a) => a.platform === 'FACEBOOK_PAGE')
      .reduce((map, a) => {
        const cur = map.get(a.platformAccountId);
        if (!cur || a.id > cur.id) map.set(a.platformAccountId, a);
        return map;
      }, new Map<string, KpiAccount>())
      .values()
  ), [kpiAccounts]);
  const kpiGroupAccounts = useMemo(() => kpiAccounts.filter((a) => a.platform === 'FACEBOOK_GROUP'), [kpiAccounts]);

  const targetsByDate = useMemo(() => {
    const map = new Map<string, PostTargetItem[]>();
    for (const t of targets) {
      if (!map.has(t.date)) map.set(t.date, []);
      map.get(t.date)!.push(t);
    }
    return map;
  }, [targets]);

  const setTargetMutation = useMutation({
    mutationFn: async ({ socialAccountId, date, targetCount }: { socialAccountId: number; date: string; targetCount: number | null }) =>
      (await api.put('/post-targets', { socialAccountId, date, targetCount })).data,
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Lỗi khi lưu KPI');
    },
  });

  const openTargetModal = (date: Dayjs) => {
    const dateKey = date.format('YYYY-MM-DD');
    const existing = targetsByDate.get(dateKey) || [];
    const drafts: Record<number, number | null> = {};
    for (const t of existing) drafts[t.socialAccountId] = t.targetCount;
    for (const a of [...kpiFanpageAccounts, ...kpiGroupAccounts]) {
      if (drafts[a.id] === undefined || drafts[a.id] === null) {
        drafts[a.id] = 10;
      }
    }
    setTargetDrafts(drafts);
    setTargetModalDate(date);
  };

  const handleSaveTargets = async () => {
    if (!targetModalDate) return;
    const dateKey = targetModalDate.format('YYYY-MM-DD');
    const existing = targetsByDate.get(dateKey) || [];
    const existingBySocialAccount = new Map(existing.map(t => [t.socialAccountId, t.targetCount]));

    const changed = Object.entries(targetDrafts).filter(([socialAccountId, value]) => {
      const prev = existingBySocialAccount.get(Number(socialAccountId)) ?? null;
      return (value ?? null) !== prev;
    });

    if (changed.length === 0) {
      setTargetModalDate(null);
      return;
    }

    try {
      await Promise.all(changed.map(([socialAccountId, value]) =>
        setTargetMutation.mutateAsync({ socialAccountId: Number(socialAccountId), date: dateKey, targetCount: value })
      ));
      message.success('🎯 Đã lưu KPI cho ngày ' + targetModalDate.format('DD/MM/YYYY'));
      queryClient.invalidateQueries({ queryKey: ['postTargets'] });
      setTargetModalDate(null);
    } catch {
      // message lỗi đã được hiển thị bởi onError của mutation
    }
  };

  // Lọc bài đăng theo filter
  const filteredPosts = useMemo(() => {
    return posts.filter(p => {
      if (filterStatus !== 'ALL' && p.status !== filterStatus) return false;
      if (filterType === 'STORY' && p.postType !== 'STORY') return false;
      if (filterType === 'POST' && p.postType === 'STORY') return false;
      return true;
    });
  }, [posts, filterStatus, filterType]);

  // Gom nhóm bài đăng theo ngày (YYYY-MM-DD)
  const postsByDate = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const post of filteredPosts) {
      const dateStr = post.scheduledAt || post.publishedAt || post.createdAt;
      if (dateStr) {
        const key = dayjs(dateStr).format('YYYY-MM-DD');
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(post);
      }
    }
    return map;
  }, [filteredPosts]);

  // Đổi ngày giờ đăng
  const rescheduleMutation = useMutation({
    mutationFn: async ({ id, scheduledAt }: { id: number; scheduledAt: string }) => {
      const res = await api.patch(`/queue/${id}/schedule`, { scheduledAt });
      return res.data;
    },
    onSuccess: () => {
      message.success('🗓️ Đã cập nhật ngày giờ đăng bài thành công!');
      queryClient.invalidateQueries({ queryKey: ['calendarPosts'] });
      setReschedulePost(null);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Lỗi khi đổi ngày giờ đăng!');
    }
  });

  // Đăng ngay bài đang chờ
  const handlePublishNow = async (id: number) => {
    try {
      const res = await api.post(`/queue/${id}/publish`);
      if (res.data?.success) {
        message.success('🚀 Đã gửi yêu cầu đăng ngay bài viết!');
        queryClient.invalidateQueries({ queryKey: ['calendarPosts'] });
        setViewingPost(null);
        setSelectedDayPosts(null);
      } else {
        message.error(res.data?.message || 'Đăng thất bại!');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Lỗi khi đăng bài');
    }
  };

  // Xoá bài
  const handleDeletePost = async (id: number) => {
    try {
      await api.delete(`/queue/${id}`);
      message.success('Đã xoá bài viết khỏi hàng đợi!');
      queryClient.invalidateQueries({ queryKey: ['calendarPosts'] });
      setViewingPost(null);
      setSelectedDayPosts(null);
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Xoá thất bại');
    }
  };

  // Render nội dung từng ô ngày trong Lịch
  const dateCellRender = (current: Dayjs) => {
    const dateKey = current.format('YYYY-MM-DD');
    const dayPosts = postsByDate.get(dateKey) || [];
    const dayTargets = targetsByDate.get(dateKey) || [];

    if (dayPosts.length === 0 && dayTargets.length === 0) {
      return (
        <div
          onClick={(e) => { e.stopPropagation(); openTargetModal(current); }}
          className="mt-1 text-[9px] text-slate-300 hover:text-purple-600 cursor-pointer flex items-center gap-0.5"
          title="Đặt KPI cho ngày này"
        >
          <AimOutlined /> KPI
        </div>
      );
    }

    return (
      <div className="space-y-1 mt-1 overflow-hidden">
        {dayTargets.slice(0, isMobile ? 1 : 2).map((t) => (
          <div
            key={t.socialAccountId}
            onClick={(e) => { e.stopPropagation(); openTargetModal(current); }}
            className={`text-[9px] px-1 py-0.5 rounded truncate cursor-pointer flex items-center gap-0.5 ${t.achieved ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/50' : 'bg-amber-950/50 text-amber-400 border border-amber-800/50'}`}
            title={`${t.platform === 'FACEBOOK_GROUP' ? 'Group' : 'Trang'} ${t.accountName}: ${t.actualCount}/${t.targetCount} — bấm để sửa KPI`}
          >
            {t.platform === 'FACEBOOK_GROUP' ? <TeamOutlined /> : <FileTextOutlined />}
            <span className="truncate flex-1">{t.accountName}: {t.actualCount}/{t.targetCount}</span>
          </div>
        ))}

        {dayPosts.slice(0, maxChipsPerDay).map((p) => {
          const isStory = p.postType === 'STORY';
          const timeStr = dayjs(p.scheduledAt || p.publishedAt || p.createdAt).format('HH:mm');
          const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.PENDING;

          return (
            <div
              key={p.id}
              onClick={(e) => {
                e.stopPropagation();
                setViewingPost(p);
              }}
              className={`px-1 py-0.5 sm:px-1.5 rounded cursor-pointer truncate transition-all hover:opacity-80 flex items-center gap-1 shadow-xs ${isMobile ? 'text-[9px]' : 'text-[11px]'}`}
              style={{
                backgroundColor: isStory ? 'rgba(168, 85, 247, 0.16)' : 'rgba(59, 130, 246, 0.16)',
                borderLeft: `3px solid ${cfg.color}`,
                color: isStory ? '#d8b4fe' : '#93c5fd'
              }}
              title={`${isStory ? '📱 Story' : '📝 Bài viết'}: ${p.title} (${cfg.label})`}
            >
              {!isMobile && <span className="font-semibold font-mono text-[10px] opacity-75">{timeStr}</span>}
              <span className="truncate flex-1 font-medium">{isStory ? '📱 ' : ''}{p.title || `#${p.id}`}</span>
            </div>
          );
        })}

        {dayPosts.length > maxChipsPerDay && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              setSelectedDayPosts({ date: current, posts: dayPosts });
            }}
            className="text-[9px] sm:text-[10px] text-slate-400 font-bold text-center cursor-pointer hover:text-blue-400 bg-white/5 rounded py-0.5"
          >
            +{dayPosts.length - maxChipsPerDay} bài khác
          </div>
        )}

        <div
          onClick={(e) => { e.stopPropagation(); openTargetModal(current); }}
          className="text-[9px] text-slate-400 hover:text-purple-600 cursor-pointer flex items-center gap-0.5"
          title="Đặt/sửa KPI cho ngày này"
        >
          <AimOutlined /> KPI
        </div>
      </div>
    );
  };

  return (
    <div className="app-page space-y-4">
      {/* Header & Bộ lọc */}
      <Card variant="borderless">
        <Flex justify="space-between" align="center" wrap="wrap" gap="middle">
          <Flex align="center" gap="middle">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 text-lg">
              <CalendarOutlined />
            </div>
            <div>
              <Title level={4} className="!mb-0.5 !text-slate-100">Lịch Đăng Bài & Story</Title>
              <Text className="text-xs text-slate-400">Xem lịch trực quan các bài đăng & Story đã lên lịch hoặc đã xuất bản</Text>
            </div>
          </Flex>

          <Flex wrap="wrap" align="center" gap="small">
            <Select
              value={filterType}
              onChange={setFilterType}
              className="w-36 rounded-xl"
              options={[
                { value: 'ALL', label: 'Tất cả loại' },
                { value: 'STORY', label: '📱 Chỉ Story' },
                { value: 'POST', label: '📝 Chỉ bài viết' },
              ]}
            />
            <Select
              value={filterStatus}
              onChange={setFilterStatus}
              className="w-36 rounded-xl"
              options={[
                { value: 'ALL', label: 'Tất cả trạng thái' },
                { value: 'PENDING', label: '🗓️ Chờ đăng' },
                { value: 'PUBLISHED', label: '✅ Đã đăng' },
                { value: 'FAILED', label: '❌ Thất bại' },
              ]}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => refetch()}
              loading={isFetching}
              className="rounded-xl font-semibold"
            >
              Làm mới
            </Button>
          </Flex>
        </Flex>
      </Card>

      {/* Legend chú thích */}
      <Card variant="borderless" styles={{ body: { padding: '10px 16px' } }}>
        <Flex justify="space-between" align="center" wrap="wrap" gap="middle" className="text-xs">
          <Flex align="center" gap="middle" wrap="wrap">
            <span className="font-semibold text-slate-300">Chú thích:</span>
            <span className="flex items-center gap-1.5 text-slate-300"><Badge color="#2563eb" /> Chờ đăng</span>
            <span className="flex items-center gap-1.5 text-slate-300"><Badge color="#16a34a" /> Đã đăng</span>
            <span className="flex items-center gap-1.5 text-slate-300"><Badge color="#7c3aed" /> Đang xử lý</span>
            <span className="flex items-center gap-1.5 text-slate-300"><Badge color="#dc2626" /> Thất bại</span>
          </Flex>
          <span className="text-slate-400">💡 Nhấp vào bài viết bất kỳ trên lịch để xem chi tiết hoặc đổi giờ đăng</span>
        </Flex>
      </Card>

      {/* Lịch Calendar — lưới tháng đầy đủ cho tablet/desktop trở lên. Trên điện thoại, lưới 7 cột
          quá chật để hiện badge bài viết dễ đọc, nên thay bằng danh sách theo ngày (agenda) bên dưới. */}
      {!isMobile && (
        <Card variant="borderless" className="shadow-sm">
          <Calendar
            value={selectedDate}
            onChange={(date) => setSelectedDate(date)}
            cellRender={dateCellRender}
            onSelect={(date, info) => {
              if (info.source === 'date') {
                const dateKey = date.format('YYYY-MM-DD');
                const dayPosts = postsByDate.get(dateKey) || [];
                if (dayPosts.length > 0) {
                  setSelectedDayPosts({ date, posts: dayPosts });
                }
              }
            }}
          />
        </Card>
      )}

      {isMobile && (
        <Card variant="borderless" className="shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Button
              size="small"
              onClick={() => setSelectedDate(selectedDate.subtract(1, 'month'))}
              className="rounded-lg font-bold"
            >
              ‹ Trước
            </Button>
            <DatePicker
              picker="month"
              value={selectedDate}
              onChange={(date) => date && setSelectedDate(date)}
              allowClear={false}
              format="MM/YYYY"
              className="rounded-xl"
            />
            <Button
              size="small"
              onClick={() => setSelectedDate(selectedDate.add(1, 'month'))}
              className="rounded-lg font-bold"
            >
              Sau ›
            </Button>
          </div>

          {(() => {
            const daysWithPosts = Array.from(postsByDate.entries())
              .filter(([dateKey]) => dayjs(dateKey).isSame(selectedDate, 'month'))
              .sort(([a], [b]) => a.localeCompare(b));

            if (daysWithPosts.length === 0) {
              return (
                <Empty
                  description={`Không có bài nào trong tháng ${selectedDate.format('MM/YYYY')}`}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  className="py-6"
                />
              );
            }

            return (
              <div className="space-y-3">
                {daysWithPosts.map(([dateKey, dayPosts]) => (
                  <div key={dateKey}>
                    <Text strong className="text-xs text-slate-400 mb-1.5 block">
                      {VI_WEEKDAYS[dayjs(dateKey).day()]}, {dayjs(dateKey).format('DD/MM')}
                    </Text>
                    <div className="space-y-1.5">
                      {dayPosts.map((p) => {
                        const isStory = p.postType === 'STORY';
                        const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.PENDING;
                        return (
                          <Card
                            key={p.id}
                            size="small"
                            hoverable
                            onClick={() => setViewingPost(p)}
                            className="cursor-pointer !bg-[rgba(255,255,255,0.03)] !border-[#202a3a]"
                            styles={{ body: { padding: '8px 12px' } }}
                          >
                            <Flex justify="space-between" align="center" gap={8}>
                              <Flex align="center" gap={8} className="overflow-hidden min-w-0">
                                {isStory ? <PlayCircleOutlined className="text-purple-400 shrink-0" /> : <PictureOutlined className="text-blue-400 shrink-0" />}
                                <div className="min-w-0">
                                  <Text strong className="text-xs block truncate">{p.title || `#${p.id}`}</Text>
                                  <Text type="secondary" className="text-[11px] font-mono">
                                    {dayjs(p.scheduledAt || p.publishedAt || p.createdAt).format('HH:mm')}
                                  </Text>
                                </div>
                              </Flex>
                              <Tag color={cfg.tagColor} className="font-bold text-[10px] !m-0 shrink-0">
                                {cfg.label}
                              </Tag>
                            </Flex>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </Card>
      )}

      {/* Drawer xem chi tiết bài đăng */}
      <Drawer
        title={
          <div className="flex items-center gap-2">
            {viewingPost?.postType === 'STORY' ? <PlayCircleOutlined className="text-purple-600" /> : <CalendarOutlined className="text-blue-600" />}
            <span>{viewingPost?.postType === 'STORY' ? 'Chi tiết Story' : 'Chi tiết bài đăng'} #{viewingPost?.id}</span>
          </div>
        }
        open={!!viewingPost}
        onClose={() => setViewingPost(null)}
        size={450}
        extra={
          viewingPost && (
            <Space>
              {viewingPost.status === 'PENDING' && (
                <Button
                  type="primary"
                  size="small"
                  icon={<ThunderboltOutlined />}
                  onClick={() => handlePublishNow(viewingPost.id)}
                  className="bg-purple-600 font-semibold"
                >
                  Đăng ngay
                </Button>
              )}
              {viewingPost.status === 'PENDING' && (
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setReschedulePost(viewingPost);
                    setNewScheduleTime(dayjs(viewingPost.scheduledAt));
                  }}
                >
                  Đổi giờ
                </Button>
              )}
              <Popconfirm
                title="Xoá bài này?"
                description="Bạn có chắc muốn xoá bài này khỏi hàng đợi?"
                onConfirm={() => handleDeletePost(viewingPost.id)}
                okText="Xoá"
                cancelText="Huỷ"
              >
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          )
        }
      >
        {viewingPost && (
          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <Tag color={STATUS_CONFIG[viewingPost.status]?.tagColor || 'default'} className="font-bold text-xs">
                {STATUS_CONFIG[viewingPost.status]?.label || viewingPost.status}
              </Tag>
              <Tag color={viewingPost.postType === 'STORY' ? 'purple' : 'blue'} className="font-bold text-xs">
                {viewingPost.postType === 'STORY' ? '📱 Facebook Story' : '📝 Bài viết thường'}
              </Tag>
            </div>

            <Descriptions column={1} size="small" bordered className="rounded-xl overflow-hidden">
              <Descriptions.Item label="Tiêu đề / Fanpage">
                <Text strong>{viewingPost.title || '—'}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Giờ lên lịch">
                <Text code>
                  {viewingPost.scheduledAt ? dayjs(viewingPost.scheduledAt).format('HH:mm · DD/MM/YYYY') : '—'}
                </Text>
              </Descriptions.Item>
              {viewingPost.publishedAt && (
                <Descriptions.Item label="Giờ đã đăng">
                  <Text type="success" strong>
                    {dayjs(viewingPost.publishedAt).format('HH:mm · DD/MM/YYYY')}
                  </Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            {/* Nội dung / Link bài viết */}
            <div>
              <Text strong className="block mb-1">Nội dung / Link gốc:</Text>
              <Card size="small" className="font-mono text-xs break-all whitespace-pre-wrap !bg-[rgba(255,255,255,0.03)] !border-[#202a3a]">
                {viewingPost.originalUrl || viewingPost.content || 'Không có nội dung văn bản'}
              </Card>
            </div>

            {/* Media URLs nếu có */}
            {viewingPost.mediaUrls && (
              <div>
                <Text strong className="block mb-1">Đường dẫn Media (.mp4 / ảnh):</Text>
                <Card size="small" className="!bg-[rgba(255,255,255,0.03)] !border-[#202a3a]">
                  <Typography.Link
                    href={viewingPost.mediaUrls}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all block text-xs"
                  >
                    🔗 {viewingPost.mediaUrls}
                  </Typography.Link>
                </Card>
              </div>
            )}

            {viewingPost.errorMessage && (
              <Alert
                type="error"
                showIcon
                message="Chi tiết lỗi"
                description={viewingPost.errorMessage}
                className="text-xs"
              />
            )}
          </div>
        )}
      </Drawer>

      {/* Modal danh sách bài trong 1 ngày */}
      <Modal
        title={`Danh sách bài ngày ${selectedDayPosts?.date.format('DD/MM/YYYY') || ''}`}
        open={!!selectedDayPosts}
        onCancel={() => setSelectedDayPosts(null)}
        footer={null}
      >
        <div className="space-y-2 max-h-96 overflow-y-auto py-2">
          {selectedDayPosts?.posts.map((p) => {
            const isStory = p.postType === 'STORY';
            const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.PENDING;
            return (
              <Card
                key={p.id}
                size="small"
                hoverable
                onClick={() => {
                  setViewingPost(p);
                  setSelectedDayPosts(null);
                }}
                className="cursor-pointer !bg-[rgba(255,255,255,0.03)] !border-[#202a3a]"
              >
                <Flex justify="space-between" align="center">
                  <Flex align="center" gap={8} className="overflow-hidden">
                    {isStory ? <PlayCircleOutlined className="text-purple-400" /> : <PictureOutlined className="text-blue-400" />}
                    <div className="overflow-hidden">
                      <Text strong className="text-xs block truncate max-w-xs">{p.title}</Text>
                      <Text type="secondary" className="text-[11px] font-mono">
                        {dayjs(p.scheduledAt || p.publishedAt || p.createdAt).format('HH:mm')}
                      </Text>
                    </div>
                  </Flex>
                  <Tag color={cfg.tagColor} className="font-bold text-xs !m-0">
                    {cfg.label}
                  </Tag>
                </Flex>
              </Card>
            );
          })}
        </div>
      </Modal>

      {/* Modal Đổi ngày giờ đăng bài */}
      <Modal
        title="🗓️ Đổi Ngày Giờ Đăng Bài"
        open={!!reschedulePost}
        onCancel={() => setReschedulePost(null)}
        onOk={() => {
          if (reschedulePost && newScheduleTime) {
            rescheduleMutation.mutate({
              id: reschedulePost.id,
              scheduledAt: newScheduleTime.format('YYYY-MM-DDTHH:mm:ss'),
            });
          }
        }}
        confirmLoading={rescheduleMutation.isPending}
        okText="Lưu thời gian mới"
        cancelText="Huỷ"
      >
        <div className="py-4 space-y-3">
          <Text className="text-xs text-slate-600 block">
            Chọn ngày và giờ mới cho bài viết <b>"{reschedulePost?.title}"</b>:
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

      {/* Modal Đặt KPI theo ngày cho Fanpage & từng Group */}
      <Modal
        title={
          <span className="flex items-center gap-2 text-base">
            <span className="w-8 h-8 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">
              <AimOutlined />
            </span>
            Đặt KPI ngày {targetModalDate?.format('DD/MM/YYYY') || ''}
          </span>
        }
        open={!!targetModalDate}
        onCancel={() => setTargetModalDate(null)}
        onOk={handleSaveTargets}
        confirmLoading={setTargetMutation.isPending}
        okText="Lưu KPI"
        cancelText="Huỷ"
        width={680}
        styles={{ body: { paddingTop: 4 } }}
      >
        <Text className="text-xs text-slate-500 block mb-3">
          Đặt số bài mục tiêu cần đăng cho Fanpage và từng Group vào ngày này. Để trống hoặc 0 để bỏ mục tiêu.
        </Text>

        {kpiFanpageAccounts.length === 0 && kpiGroupAccounts.length === 0 ? (
          <Empty description="Chưa có Fanpage/Group nào được kết nối" />
        ) : (
          <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-5">
            {kpiFanpageAccounts.length > 0 && (
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <FileTextOutlined className="text-blue-600" /> Fanpage
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
                        value={targetDrafts[a.id] ?? null}
                        onChange={(val) => setTargetDrafts(prev => ({ ...prev, [a.id]: val }))}
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
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <TeamOutlined className="text-purple-600" /> Group
                </div>

                <div className="grid sm:grid-cols-2 gap-2">
                  {kpiGroupAccounts.map((a) => (
                    <div key={a.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="font-bold text-xs text-slate-800 block truncate">{a.pageName || `#${a.id}`}</span>
                        <span className="text-[10px] text-slate-400 font-mono">ID kết nối: {a.id}</span>
                      </div>
                      <InputNumber
                        min={0}
                        value={targetDrafts[a.id] ?? null}
                        onChange={(val) => setTargetDrafts(prev => ({ ...prev, [a.id]: val }))}
                        placeholder="0"
                        className="w-20 shrink-0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
