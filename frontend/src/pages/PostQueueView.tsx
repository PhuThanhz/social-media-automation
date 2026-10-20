import { useState, useEffect, useMemo } from 'react';
import { Button, Card, Table, Typography, Space, Tag, Modal, Form, Input, Select, DatePicker, Checkbox, Tooltip, App, Tabs, Progress, Segmented, Dropdown, Drawer, Descriptions, Empty, Grid, Pagination, Collapse } from 'antd';
import { SyncOutlined, SendOutlined, DeleteOutlined, ClockCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, LinkOutlined, PlusOutlined, LoadingOutlined, ThunderboltOutlined, EditOutlined, ExclamationCircleOutlined, SearchOutlined, MoreOutlined, EyeOutlined, VideoCameraOutlined, PictureOutlined, FileTextOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import api from '../config/axios';
import { BatchPostModal } from '../components/BatchPostModal';

const { Title, Text, Paragraph } = Typography;

const WORKER_BASE_URL = import.meta.env.VITE_WORKER_BASE_URL || 'http://localhost:3001';
type TimePeriod = 'DAY' | 'WEEK' | 'MONTH' | 'ALL';

interface SocialAccount {
  id: number;
  platform: string;
  platformAccountId: string;
  pageName?: string;
  accountType?: string;
}

interface PostQueue {
  id: number;
  originalUrl: string;
  title: string;
  content: string;
  mediaUrls: string;
  status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'CANCELLED' | 'PENDING_APPROVAL';
  scheduledAt: string;
  publishedAt: string;
  errorMessage?: string;
  postType?: string | null;
  campaign?: {
    id?: number;
    name: string;
  };
}

interface GroupRetryProgress {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  currentGroupId: string | null;
  currentGroupName: string | null;
  status: string;
}

interface GroupRetrySummary {
  success: boolean;
  total: number;
  succeeded: number;
  failed: number;
  groups: any[];
}

const PostQueueView = () => {
  const { message } = App.useApp();
  const [isUrlModalVisible, setIsUrlModalVisible] = useState(false);
  const [isBatchModalVisible, setIsBatchModalVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('WEEK');
  const [searchText, setSearchText] = useState('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStatusMsg, setProgressStatusMsg] = useState<string>('');
  const [editingPost, setEditingPost] = useState<PostQueue | null>(null);
  const [viewingPost, setViewingPost] = useState<PostQueue | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [mobilePage, setMobilePage] = useState(1);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const screens = Grid.useBreakpoint();

  // Fetch danh sách post queue
  const { data: posts, isLoading, refetch } = useQuery({
    queryKey: ['postQueue'],
    queryFn: async () => {
      const response = await api.get('/campaigns');
      const campaigns = response.data;

      // Gọi song song thay vì tuần tự — N campaign không còn kéo dài thời gian tải tuyến tính.
      const results = await Promise.all(
        campaigns.map(async (campaign: any) => {
          try {
            const res = await api.get(`/queue/campaign/${campaign.id}`);
            return res.data.map((item: any) => ({
              ...item,
              campaign: { id: campaign.id, name: campaign.name }
            }));
          } catch (e) {
            console.error(e);
            return [];
          }
        })
      );
      const allPosts: PostQueue[] = results.flat();
      // Sắp xếp bài mới nhất lên vị trí số #1 ở trên đầu bảng
      return allPosts.sort((a, b) => b.id - a.id);
    },
    // Tự động làm mới để bài vừa Lưu từ Extension xuất hiện ngay mà không cần bấm nút Làm mới thủ công.
    refetchInterval: 18000
  });

  const failedPosts = useMemo(() => (posts || []).filter(p => p.status === 'FAILED'), [posts]);
  const failedCount = failedPosts.length;

  // Danh sách Fanpage đã kết nối, để chọn nơi đăng bài
  const { data: connections } = useQuery({
    queryKey: ['socialAccounts'],
    queryFn: async () => {
      const response = await api.get('/connections');
      return response.data as SocialAccount[];
    }
  });

  // Thêm bài từ 1 hoặc nhiều URL (mỗi dòng 1 link)
  const addFromUrlMutation = useMutation({
    mutationFn: async (values: { urls: string; scheduledAt?: Dayjs; targetFanpageId?: string; publishNow?: boolean; intervalMinutes?: number; affiliateLink?: string; groupNames?: string[] }) => {
      setProgressPercent(15);
      setProgressStatusMsg('🔍 Đang kết nối Threads & phân tích đường dẫn...');

      const timer1 = setTimeout(() => {
        setProgressPercent(45);
        setProgressStatusMsg('📥 Đang cào dữ liệu & tải Video .mp4 về hệ thống...');
      }, 3000);

      const timer2 = setTimeout(() => {
        setProgressPercent(75);
        setProgressStatusMsg(values.publishNow ? '🚀 Đang kích hoạt Playwright xuất bản clip lên Fanpage...' : '📋 Đang đưa bài viết vào hàng đợi...');
      }, 7000);

      try {
        const urls = values.urls
          .split('\n')
          .map((u) => u.trim())
          .filter((u) => u.length > 0);
        const payload = {
          urls,
          scheduledAt: values.publishNow || !values.scheduledAt ? undefined : values.scheduledAt.format('YYYY-MM-DDTHH:mm:ss'),
          targetFanpageId: values.targetFanpageId,
          publishNow: values.publishNow ? 'true' : 'false',
          intervalMinutes: values.intervalMinutes,
          affiliateLink: values.affiliateLink?.trim() || undefined,
          groupNames: values.groupNames && values.groupNames.length > 0 ? values.groupNames : undefined,
        };
        const response = await api.post('/queue/add-from-urls', payload);
        clearTimeout(timer1);
        clearTimeout(timer2);
        setProgressPercent(100);
        setProgressStatusMsg('✅ Xử lý hoàn tất thành công!');
        return response.data;
      } catch (err) {
        clearTimeout(timer1);
        clearTimeout(timer2);
        setProgressPercent(0);
        setProgressStatusMsg('');
        throw err;
      }
    },
    onSuccess: (data, variables) => {
      setTimeout(() => {
        message.success(
          variables.publishNow
            ? `Đã đăng bài đầu tiên ngay lên Fanpage, các bài còn lại (${data.count || 1} bài) sẽ tự động đăng theo lịch giãn cách!`
            : `Đã tự động cào bài từ Link và thêm vào Hàng đợi (${data.count || 1} bài)!`
        );
        setIsUrlModalVisible(false);
        setProgressPercent(0);
        setProgressStatusMsg('');
        form.resetFields();
        queryClient.invalidateQueries({ queryKey: ['postQueue'] });
      }, 1000);
    },
    onError: () => {
      setProgressPercent(0);
      setProgressStatusMsg('');
      message.error('Lỗi khi cào bài từ URL, vui lòng kiểm tra lại các đường dẫn!');
    }
  });

  // Đăng bài ngay
  const publishNowMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await api.post(`/queue/${id}/publish`);
      return response.data;
    },
    onSuccess: () => {
      message.success('Đã gửi lệnh đăng bài ngay thành công!');
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
    },
    onError: () => {
      message.error('Lỗi khi thực hiện đăng bài!');
    }
  });

  // Sửa tay caption trước khi đăng
  const updateContentMutation = useMutation({
    mutationFn: async ({ id, content }: { id: number; content: string }) => {
      const response = await api.put(`/queue/${id}/content`, { content });
      return response.data;
    },
    onSuccess: () => {
      message.success('Đã lưu caption mới!');
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
      setEditingPost(null);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Lỗi khi lưu caption!');
    }
  });

  // Chuyển 1 bài FAILED sang PENDING (chờ đăng lại)
  const resetFailedMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await api.post(`/queue/${id}/reset-failed`);
      return response.data;
    },
    onSuccess: () => {
      message.success('✅ Đã chuyển bài viết về trạng thái Chờ đăng!');
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Lỗi khi chuyển trạng thái bài!');
    }
  });

  // Chuyển hàng loạt bài FAILED sang PENDING
  const resetFailedBatchMutation = useMutation({
    mutationFn: async (ids?: React.Key[]) => {
      const numericIds = ids && ids.length > 0 ? ids.map((id) => Number(id)) : [];
      const response = await api.post('/queue/reset-failed-batch', { ids: numericIds });
      return response.data;
    },
    onSuccess: (data) => {
      message.success(`✅ Đã chuyển ${data.count || 0} bài viết lỗi về trạng thái Chờ đăng!`);
      setSelectedRowKeys([]);
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
    },
    onError: () => {
      message.error('Lỗi khi chuyển các bài lỗi về trạng thái Chờ đăng!');
    }
  });



  // Retry riêng các Group lỗi của bài đã lên Page.
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
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Thử lại các Group lỗi thất bại!');
      setRetryingGroupsId(null);
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
    },
  });

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // Xóa khỏi hàng đợi
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/queue/${id}`);
    },
    onSuccess: () => {
      message.success('Đã xóa bài viết khỏi hàng đợi!');
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
    }
  });

  // Xóa hàng loạt khỏi hàng đợi
  const batchDeleteMutation = useMutation({
    mutationFn: async (ids: React.Key[]) => {
      const numericIds = ids.map((id) => Number(id));
      try {
        const response = await api.post('/queue/batch-delete', { ids: numericIds });
        return response.data;
      } catch {
        // Cơ chế dự phòng: Xóa từng bài nếu endpoint batch chưa kịp reload
        for (const id of numericIds) {
          await api.delete(`/queue/${id}`);
        }
        return { success: true, count: numericIds.length };
      }
    },
    onSuccess: (data) => {
      message.success(`Đã xóa hàng loạt thành công ${data.count || selectedRowKeys.length} bài viết!`);
      setSelectedRowKeys([]);
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
    },
    onError: () => {
      message.error('Lỗi khi xóa hàng loạt bài viết!');
    }
  });

  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys);
    },
  };

  const postsForPeriod = posts?.filter(post => {
    if (timePeriod === 'ALL') return true;
    const rawDate = post.publishedAt || post.scheduledAt;
    if (!rawDate) return false;
    const date = dayjs(rawDate);
    const now = dayjs();
    if (timePeriod === 'DAY') return date.isSame(now, 'day');
    if (timePeriod === 'WEEK') {
      const start = now.startOf('week').add(1, 'day');
      return !date.isBefore(start) && !date.isAfter(start.add(6, 'day').endOf('day'));
    }
    return date.isSame(now, 'month');
  });

  const searchablePosts = postsForPeriod?.filter(post => {
    const keyword = searchText.trim().toLocaleLowerCase('vi');
    if (!keyword) return true;
    return [post.title, post.content, post.originalUrl, post.campaign?.name, String(post.id)]
      .some(value => value?.toLocaleLowerCase('vi').includes(keyword));
  });

  const filteredPosts = searchablePosts?.filter(post => {
    if (activeTab === 'PENDING') return post.status === 'PENDING';
    if (activeTab === 'PROCESSING') return post.status === 'PROCESSING';
    if (activeTab === 'PUBLISHED') return post.status === 'PUBLISHED';
    if (activeTab === 'FAILED') return post.status === 'FAILED';
    if (activeTab === 'PENDING_APPROVAL') return post.status === 'PENDING_APPROVAL';
    return true;
  });

  const getPostMeta = (record: PostQueue) => {
    const isVideo = !!record.mediaUrls && (record.mediaUrls.includes('.mp4') || record.mediaUrls.includes('video'));
    const hasMedia = !!record.mediaUrls?.trim();
    let source = 'Nguồn khác';
    if (record.originalUrl?.includes('threads.')) source = 'Threads';
    else if (record.originalUrl?.includes('facebook.')) source = 'Facebook';
    else if (record.originalUrl?.includes('reddit.')) source = 'Reddit';
    return { isVideo, hasMedia, source };
  };

  const renderStatus = (record: PostQueue) => {
    if (record.status === 'PUBLISHED') {
      const isGroupError = record.errorMessage && (record.errorMessage.toLowerCase().includes('group') || record.errorMessage.toLowerCase().includes('nhóm'));
      const isCommentError = record.errorMessage && record.errorMessage.toLowerCase().includes('bình luận');
      if (record.errorMessage) {
        return (
          <Tooltip title={record.errorMessage}>
            <Tag icon={<ExclamationCircleOutlined />} color="warning">
              {isCommentError ? 'Đã đăng · Lỗi cmt' : isGroupError ? 'Page xong · Lỗi nhóm' : 'Cần kiểm tra'}
            </Tag>
          </Tooltip>
        );
      }
      return <Tag icon={<CheckCircleOutlined />} color="success">Đã đăng</Tag>;
    }
    if (record.status === 'PENDING_APPROVAL') return <Tag icon={<ExclamationCircleOutlined />} color="gold">Chờ duyệt</Tag>;
    if (record.status === 'PENDING') return <Tag icon={<ClockCircleOutlined />} color="processing">Chờ đăng</Tag>;
    if (record.status === 'PROCESSING') return <Tag icon={<LoadingOutlined spin />} color="purple">Đang đăng</Tag>;
    return <Tooltip title={record.errorMessage}><Tag icon={<CloseCircleOutlined />} color="error">Đăng lỗi</Tag></Tooltip>;
  };

  // Duyệt / Từ chối bài cào tự động hàng loạt (Campaign không phải Quick Post) trước khi lên lịch đăng thật.
  const approveMutation = useMutation({
    mutationFn: async (id: number) => (await api.post(`/queue/${id}/approve`)).data,
    onSuccess: () => {
      message.success('✅ Đã duyệt bài, sẽ đăng theo lịch!');
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Lỗi khi duyệt bài!'),
  });
  const rejectMutation = useMutation({
    mutationFn: async (id: number) => (await api.post(`/queue/${id}/reject`)).data,
    onSuccess: () => {
      message.success('🚫 Đã từ chối bài!');
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Lỗi khi từ chối bài!'),
  });

  // Thống kê hiệu suất (reach/tương tác/like/comment) — chỉ tra được với bài đăng qua Graph API
  // (PAGE_TOKEN), bài đăng qua Playwright cookie sẽ trả success=false với lý do rõ ràng.
  const { data: insightsData, isFetching: insightsLoading } = useQuery({
    queryKey: ['postInsights', viewingPost?.id],
    queryFn: async () => (await api.get(`/queue/${viewingPost!.id}/insights`)).data,
    enabled: !!viewingPost && viewingPost.status === 'PUBLISHED',
  });

  const postMenuItems = (record: PostQueue) => {
    const isPublishedGroupError = record.status === 'PUBLISHED'
      && !!record.errorMessage
      && (record.errorMessage.toLowerCase().includes('group') || record.errorMessage.toLowerCase().includes('nhóm'));

    if (record.status === 'PENDING_APPROVAL') {
      return [
        { key: 'view', icon: <EyeOutlined />, label: 'Xem chi tiết', onClick: () => setViewingPost(record) },
        { key: 'edit', icon: <EditOutlined />, label: 'Sửa nội dung', onClick: () => { setEditingPost(record); setEditingContent(record.content || ''); } },
        { type: 'divider' as const },
        { key: 'approve', icon: <CheckCircleOutlined />, label: 'Duyệt bài', onClick: () => approveMutation.mutate(record.id) },
        { key: 'reject', icon: <CloseCircleOutlined />, label: 'Từ chối', danger: true, onClick: () => Modal.confirm({ title: 'Từ chối bài viết', content: 'Bài này sẽ không được đăng. Tiếp tục?', okText: 'Từ chối', okType: 'danger', cancelText: 'Hủy', onOk: () => rejectMutation.mutate(record.id) }) },
      ];
    }

    const items: any[] = [
      { key: 'view', icon: <EyeOutlined />, label: 'Xem chi tiết', onClick: () => setViewingPost(record) },
      { key: 'edit', icon: <EditOutlined />, label: 'Sửa nội dung', onClick: () => { setEditingPost(record); setEditingContent(record.content || ''); } },
      { type: 'divider' as const },
    ];

    if (record.status === 'FAILED') {
      items.push({
        key: 'resetFailed',
        icon: <SyncOutlined />,
        label: 'Chuyển sang Chờ đăng',
        onClick: () => resetFailedMutation.mutate(record.id),
      });
    }

    if (isPublishedGroupError) {
      items.push({
        key: 'retryGroups',
        icon: <SyncOutlined />,
        label: 'Thử lại nhóm lỗi',
        onClick: () => retryFailedGroupsMutation.mutate(record),
      });
    }

    items.push(
      { key: 'delete', icon: <DeleteOutlined />, label: 'Xóa bài đăng', danger: true, onClick: () => Modal.confirm({ title: 'Xóa bài viết', content: 'Bạn có chắc muốn xóa bài viết này?', okText: 'Xóa', okType: 'danger', cancelText: 'Hủy', onOk: () => deleteMutation.mutate(record.id) }) }
    );

    return items;
  };

  const columns = [
    {
      title: 'Bài đăng', key: 'post', width: 350,
      render: (_: any, record: PostQueue) => {
        const meta = getPostMeta(record);
        return (
          <button type="button" className="text-left flex items-start gap-3 w-[315px] group" onClick={() => setViewingPost(record)}>
            <span className={`w-10 h-10 rounded-lg grid place-items-center shrink-0 ${meta.isVideo ? 'bg-purple-50 text-purple-600' : meta.hasMedia ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-600'}`}>
              {meta.isVideo ? <VideoCameraOutlined /> : meta.hasMedia ? <PictureOutlined /> : <FileTextOutlined />}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="block text-[13px] font-semibold text-slate-800 truncate group-hover:text-blue-600">{record.title || `Bài đăng #${record.id}`}</span>
                {record.postType === 'STORY' && <Tag color="purple" className="!m-0 !text-[10px] !leading-4 !px-1.5">Story</Tag>}
              </span>
              <span className="block text-xs text-slate-500 leading-5 mt-0.5" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{record.content || 'Chưa có nội dung'}</span>
              <span className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-400">
                <span>#{record.id}</span>
                <span>•</span>
                <span>{meta.source}</span>
                <span>•</span>
                <span>{meta.hasMedia ? (meta.isVideo ? 'Video' : 'Hình ảnh') : 'Chỉ có chữ (Text)'}</span>
              </span>
            </span>
          </button>
        );
      },
    },
    { title: 'Thời gian', dataIndex: 'scheduledAt', key: 'scheduledAt', width: 120, render: (date: string) => date ? <div><div className="text-xs font-semibold text-slate-700">{dayjs(date).format('HH:mm')}</div><div className="text-[11px] text-slate-400 mt-0.5">{dayjs(date).format('DD/MM/YYYY')}</div></div> : <span className="text-xs text-slate-400">Đăng ngay</span> },
    { title: 'Trạng thái', key: 'status', width: 110, render: (_: any, record: PostQueue) => renderStatus(record) },
    {
      title: '', key: 'action', width: 170,
      render: (_: any, record: PostQueue) => {
        const isPublishedGroupError = record.status === 'PUBLISHED'
          && !!record.errorMessage
          && (record.errorMessage.toLowerCase().includes('group') || record.errorMessage.toLowerCase().includes('nhóm'));
        const activeRetryProgress = retryingGroupsId === record.id ? groupRetryProgress : null;
        const retryPercent = activeRetryProgress && activeRetryProgress.total > 0
          ? Math.round((activeRetryProgress.completed / activeRetryProgress.total) * 100)
          : 0;

        return (
          <div className="flex flex-col gap-1 items-end">
            <Space size={6}>
              {record.status === 'PENDING' ? (
                <Button type="primary" size="small" icon={<SendOutlined />} onClick={() => publishNowMutation.mutate(record.id)} loading={publishNowMutation.isPending}>Đăng ngay</Button>
              ) : record.status === 'FAILED' ? (
                <Button type="primary" size="small" icon={<SyncOutlined />} onClick={() => resetFailedMutation.mutate(record.id)} loading={resetFailedMutation.isPending} className="bg-amber-600 hover:!bg-amber-500 border-none">Chờ đăng</Button>
              ) : isPublishedGroupError ? (
                <Tooltip title="Chỉ thử lại các Group còn lỗi; không đăng lại Page hoặc Group đã thành công">
                  <Button
                    size="small"
                    type="primary"
                    icon={<SyncOutlined />}
                    loading={retryingGroupsId === record.id}
                    disabled={retryingGroupsId !== null}
                    onClick={() => retryFailedGroupsMutation.mutate(record)}
                    className="bg-amber-500 hover:!bg-amber-600 border-none"
                  >
                    Thử lại nhóm lỗi
                  </Button>
                </Tooltip>
              ) : (
                <Button size="small" icon={<EyeOutlined />} onClick={() => setViewingPost(record)}>Xem</Button>
              )}
              <Dropdown trigger={['click']} menu={{ items: postMenuItems(record) }}><Button size="small" icon={<MoreOutlined />} aria-label="Thao tác khác" /></Dropdown>
            </Space>
            {activeRetryProgress && activeRetryProgress.status === 'RUNNING' && (
              <div className="w-full min-w-[150px] rounded-md border border-amber-200 bg-amber-50 px-2 py-1 mt-1 text-right">
                <div className="text-[10px] font-semibold text-amber-800">
                  {activeRetryProgress.currentGroupName
                    ? `Đang thử: ${activeRetryProgress.currentGroupName}`
                    : 'Đang thử lại nhóm lỗi…'}
                </div>
                <Progress percent={retryPercent} size="small" status="active" />
                <div className="text-[10px] text-amber-700">
                  Đã xong: {activeRetryProgress.completed}/{activeRetryProgress.total} nhóm
                </div>
              </div>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="app-page">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-800">
        <div>
          <Title level={4} className="!mb-0.5 !text-white flex items-center gap-2">
            <ClockCircleOutlined className="text-cyan-400" /> Quản Lý Bài Đăng
          </Title>
          <Text className="text-xs text-slate-400 font-medium">
            Theo dõi tiến độ, lịch đăng và xử lý hàng đợi đa kênh tại một nơi
          </Text>
        </div>
        <Space wrap>
          {failedCount > 0 && (
            <Button
              type="primary"
              icon={<SyncOutlined />}
              loading={resetFailedBatchMutation.isPending}
              className="bg-amber-600 hover:!bg-amber-500 border-none font-bold text-xs rounded-xl h-10 px-4 flex items-center gap-1.5 shadow-md shadow-amber-600/20"
              onClick={() => {
                const failedIds = failedPosts.map(p => p.id);
                Modal.confirm({
                  title: `Cứu tất cả ${failedIds.length} bài đăng bị lỗi`,
                  content: `Bạn có chắc muốn chuyển toàn bộ ${failedIds.length} bài lỗi về trạng thái Chờ đăng để tự động thử lại?`,
                  okText: 'Chuyển sang Chờ đăng',
                  cancelText: 'Hủy',
                  onOk: () => resetFailedBatchMutation.mutate(failedIds)
                });
              }}
            >
              Cứu tất cả bài lỗi ({failedCount})
            </Button>
          )}
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsUrlModalVisible(true)}
            className="font-bold text-xs h-10 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 border-none shadow-md shadow-blue-600/20"
          >
            Tạo bài đăng
          </Button>
          <Button
            type="default"
            icon={<ThunderboltOutlined />}
            onClick={() => setIsBatchModalVisible(true)}
            className="!bg-slate-800/80 !border-slate-700 !text-slate-200 hover:!text-white rounded-xl font-semibold text-xs h-10 px-4"
          >
            Tạo nhiều bài
          </Button>
          <Tooltip title="Tải lại danh sách">
            <Button className="!bg-slate-800/80 !border-slate-700 !text-slate-300 hover:!text-white rounded-xl h-10 w-10 flex items-center justify-center" icon={<SyncOutlined spin={isLoading} />} onClick={() => refetch()} aria-label="Làm mới" />
          </Tooltip>
        </Space>
      </div>

      <div className="bg-[#111a28] border border-slate-800/80 rounded-2xl p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3 shadow-lg">
        <Segmented<TimePeriod> block={!screens.md} value={timePeriod} onChange={(value) => { setTimePeriod(value); setMobilePage(1); }} options={[{ label: screens.md ? 'Hôm nay' : 'Ngày', value: 'DAY' }, { label: screens.md ? 'Tuần này' : 'Tuần', value: 'WEEK' }, { label: screens.md ? 'Tháng này' : 'Tháng', value: 'MONTH' }, { label: 'Tất cả', value: 'ALL' }]} />
        <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto">
          <Input allowClear value={searchText} onChange={event => { setSearchText(event.target.value); setMobilePage(1); }} prefix={<SearchOutlined className="text-slate-400" />} placeholder="Tìm bài đăng..." className="w-full sm:w-72 bg-[#0e1622] border-slate-700 text-slate-200 rounded-xl" />
        </div>
      </div>

      {/* Main Table Card with Filter Tabs */}
      <Card variant="borderless" className="shadow-2xl rounded-2xl border border-slate-800/80 bg-[#111a28]">
        <div className="mb-4 border-b border-slate-800">
          {screens.md ? <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              className="font-semibold !mb-0"
              items={[
                { key: 'ALL', label: `Tất cả (${searchablePosts?.length || 0})` },
                { key: 'PENDING_APPROVAL', label: `Chờ duyệt (${searchablePosts?.filter(p => p.status === 'PENDING_APPROVAL').length || 0})` },
                { key: 'PENDING', label: `Chờ đăng (${searchablePosts?.filter(p => p.status === 'PENDING').length || 0})` },
                { key: 'PROCESSING', label: `Đang đăng (${searchablePosts?.filter(p => p.status === 'PROCESSING').length || 0})` },
                { key: 'PUBLISHED', label: `Đã đăng (${searchablePosts?.filter(p => p.status === 'PUBLISHED').length || 0})` },
                { key: 'FAILED', label: `Lỗi (${searchablePosts?.filter(p => p.status === 'FAILED').length || 0})` },
              ]}
            /> : <div className="pb-4"><Select value={activeTab} onChange={(value) => { setActiveTab(value); setMobilePage(1); }} className="w-full" options={[
              { value: 'ALL', label: `Tất cả trạng thái (${searchablePosts?.length || 0})` },
              { value: 'PENDING_APPROVAL', label: `Chờ duyệt (${searchablePosts?.filter(p => p.status === 'PENDING_APPROVAL').length || 0})` },
              { value: 'PENDING', label: `Chờ đăng (${searchablePosts?.filter(p => p.status === 'PENDING').length || 0})` },
              { value: 'PROCESSING', label: `Đang đăng (${searchablePosts?.filter(p => p.status === 'PROCESSING').length || 0})` },
              { value: 'PUBLISHED', label: `Đã đăng (${searchablePosts?.filter(p => p.status === 'PUBLISHED').length || 0})` },
              { value: 'FAILED', label: `Đăng lỗi (${searchablePosts?.filter(p => p.status === 'FAILED').length || 0})` },
            ]} /></div>}
        </div>

          {selectedRowKeys.length > 0 && (
            <div className="flex items-center gap-3 bg-[#15233a] border border-cyan-500/30 px-4 py-2 rounded-xl shrink-0 mb-4">
              <span className="text-xs font-bold text-slate-200">
                Đã chọn <span className="text-cyan-400 font-extrabold">{selectedRowKeys.length}</span> bài viết
              </span>
              <Button
                type="primary"
                size="small"
                icon={<SyncOutlined />}
                loading={resetFailedBatchMutation.isPending}
                className="bg-amber-600 hover:!bg-amber-500 border-none font-bold rounded-lg text-xs"
                onClick={() => {
                  Modal.confirm({
                    title: `Chuyển ${selectedRowKeys.length} bài đã chọn sang Chờ đăng`,
                    content: `Bạn có chắc muốn đưa ${selectedRowKeys.length} bài viết này về trạng thái Chờ đăng không?`,
                    okText: 'Chuyển sang Chờ đăng',
                    cancelText: 'Hủy',
                    onOk: () => resetFailedBatchMutation.mutate(selectedRowKeys)
                  });
                }}
              >
                Chuyển Sang Chờ Đăng
              </Button>
              <Button
                type="primary"
                danger
                size="small"
                icon={<DeleteOutlined />}
                loading={batchDeleteMutation.isPending}
                className="font-bold rounded-lg text-xs"
                onClick={() => {
                  Modal.confirm({
                    title: `Xóa hàng loạt ${selectedRowKeys.length} bài viết`,
                    content: `Bạn có chắc chắn muốn xóa ${selectedRowKeys.length} bài viết đã chọn khỏi hàng đợi không?`,
                    okText: 'Xóa hàng loạt',
                    okType: 'danger',
                    cancelText: 'Hủy',
                    onOk: () => batchDeleteMutation.mutate(selectedRowKeys)
                  });
                }}
              >
                Xóa Hàng Loạt
              </Button>
            </div>
          )}

        {screens.md ? (
          <Table
            rowSelection={rowSelection}
            columns={columns}
            dataSource={filteredPosts}
            rowKey="id"
            loading={isLoading}
            scroll={{ x: 900 }}
            locale={{ emptyText: 'Không tìm thấy bài đăng phù hợp' }}
            pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50], showTotal: total => `${total} bài đăng` }}
          />
        ) : (
          <div className="space-y-3">
            {isLoading ? <div className="py-12 text-center"><LoadingOutlined spin className="text-blue-600 text-xl" /></div> : !filteredPosts?.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không tìm thấy bài đăng phù hợp" /> : filteredPosts.slice((mobilePage - 1) * 6, mobilePage * 6).map(record => {
              const meta = getPostMeta(record);
              return (
                <div key={record.id} className="border border-slate-800 rounded-xl p-4 bg-[#141f30] text-slate-200">
                  <div className="flex items-start gap-3">
                    <Checkbox checked={selectedRowKeys.includes(record.id)} onChange={event => setSelectedRowKeys(keys => event.target.checked ? [...keys, record.id] : keys.filter(key => key !== record.id))} />
                    <button type="button" className="text-left min-w-0 flex-1" onClick={() => setViewingPost(record)}>
                      <div className="flex items-center justify-between gap-2 mb-1.5"><span className="text-[11px] text-slate-400">#{record.id} · {meta.source}</span>{renderStatus(record)}</div>
                      <div className="font-semibold text-[13px] text-slate-100 line-clamp-1 flex items-center gap-1.5">
                        {record.title || `Bài đăng #${record.id}`}
                        {record.postType === 'STORY' && <Tag color="purple" className="!m-0 !text-[10px] !leading-4 !px-1.5">Story</Tag>}
                      </div>
                      <div className="text-xs text-slate-400 line-clamp-2 leading-5 mt-1">{record.content || 'Chưa có nội dung'}</div>
                      <div className="flex flex-wrap gap-2 mt-2 text-[11px] text-slate-400"><span><ClockCircleOutlined /> {record.scheduledAt ? dayjs(record.scheduledAt).format('HH:mm · DD/MM/YYYY') : 'Đăng ngay'}</span>{meta.hasMedia && <span>{meta.isVideo ? 'Video' : 'Hình ảnh'}</span>}</div>
                    </button>
                  </div>
                  <div className="flex gap-2 mt-3 pt-3 border-t border-slate-800">
                    {record.status === 'PENDING' ? <Button type="primary" block size="small" icon={<SendOutlined />} onClick={() => publishNowMutation.mutate(record.id)}>Đăng ngay</Button> : <Button block size="small" icon={<EyeOutlined />} onClick={() => setViewingPost(record)}>Xem chi tiết</Button>}
                    <Dropdown trigger={['click']} menu={{ items: postMenuItems(record) }}><Button size="small" icon={<MoreOutlined />}>Khác</Button></Dropdown>
                  </div>
                </div>
              );
            })}
            {(filteredPosts?.length || 0) > 6 && <div className="flex justify-center pt-2"><Pagination simple current={mobilePage} pageSize={6} total={filteredPosts?.length || 0} onChange={setMobilePage} /></div>}
          </div>
        )}
      </Card>

      {/* Add From Link Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-slate-800 pb-2 border-b border-slate-100">
            <LinkOutlined className="text-blue-600 text-xl" />
            <span className="font-bold text-lg">Tạo bài đăng</span>
          </div>
        }
        open={isUrlModalVisible}
        onCancel={() => setIsUrlModalVisible(false)}
        footer={null}
        width={560}
        centered
        className="rounded-2xl overflow-hidden"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => addFromUrlMutation.mutate(values)}
          initialValues={{ publishNow: false, groupNames: ['Đảo Mèo'] }}
          className="mt-4 space-y-4"
        >
          <Form.Item
            name="urls"
            label={
              <div className="flex items-center justify-between gap-2 w-full">
                <span className="font-semibold text-slate-700">1. Dán liên kết bài gốc</span>
                <Button
                  type="primary"
                  size="small"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text) {
                        form.setFieldValue('urls', text);
                      }
                    } catch {
                      // Ignore
                    }
                  }}
                  className="bg-blue-600 font-bold text-xs rounded-lg"
                >
                  📋 Dán link
                </Button>
              </div>
            }
            extra="Hỗ trợ Threads, Facebook và website. Nếu có nhiều liên kết, nhập mỗi liên kết trên một dòng."
            rules={[{ required: true, message: 'Vui lòng dán ít nhất một liên kết' }]}
          >
            <Input.TextArea
              placeholder={'Vd:\nhttps://www.threads.com/share/EcpaiSpuk/...\nhttps://example.com/bai-viet-2\nhttps://example.com/bai-viet-3'}
              autoSize={{ minRows: 3, maxRows: 8 }}
              className="rounded-xl"
            />
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.urls !== cur.urls}>
            {({ getFieldValue }) => {
              const count = (getFieldValue('urls') || '')
                .split('\n')
                .map((u: string) => u.trim())
                .filter((u: string) => u.length > 0).length;
              return count > 1 ? (
                <div className="text-xs text-emerald-600 font-semibold -mt-2">
                  Đã nhập {count} link — sẽ tạo {count} bài trong Hàng đợi
                </div>
              ) : null;
            }}
          </Form.Item>

          <Form.Item
            name="targetFanpageId"
            label={<span className="font-semibold text-slate-700">2. Chọn Fanpage nhận bài</span>}
            rules={[{ required: true, message: 'Vui lòng chọn Fanpage' }]}
          >
            <Select
              size="large"
              placeholder="Chọn Fanpage đã kết nối"
              className="rounded-xl"
              options={connections?.filter((c) => c.platform === 'FACEBOOK_PAGE').map((c) => ({
                value: `${c.platformAccountId}:${c.accountType || 'PERSONAL_COOKIE'}:${c.id}`,
                label: c.accountType === 'PERSONAL_COOKIE' || !c.accountType
                  ? `${c.pageName || c.platformAccountId} · Trình duyệt tự động`
                  : `${c.pageName || c.platformAccountId} · Graph API`,
              }))}
            />
          </Form.Item>

          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
            <div className="text-xs font-semibold text-slate-700 mb-2">3. Chọn thời điểm đăng</div>
            <Form.Item name="publishNow" valuePropName="checked" className="mb-0">
              <Checkbox className="font-semibold text-slate-800">
                Đăng ngay, không cần hẹn giờ
              </Checkbox>
            </Form.Item>
          </div>

          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.publishNow !== cur.publishNow}
          >
            {({ getFieldValue }) =>
              !getFieldValue('publishNow') && (
                <Form.Item
                  name="scheduledAt"
                  label={<span className="font-semibold text-slate-700">Ngày giờ hẹn đăng</span>}
                  rules={[{ required: true, message: 'Chọn ngày giờ muốn đăng bài!' }]}
                >
                  <DatePicker
                    showTime
                    format="HH:mm DD/MM/YYYY"
                    size="large"
                    style={{ width: '100%' }}
                    className="rounded-xl"
                    disabledDate={(current) => current && current < dayjs().startOf('day')}
                    placeholder="Chọn ngày giờ đăng"
                  />
                </Form.Item>
              )
            }
          </Form.Item>

          <Collapse
            ghost
            className="border border-slate-200 rounded-xl bg-slate-50"
            items={[{
              key: 'advanced',
              label: <span className="text-xs font-semibold text-slate-700">Tùy chọn nâng cao</span>,
              children: <>
                <Form.Item noStyle shouldUpdate={(prev, cur) => prev.targetFanpageId !== cur.targetFanpageId}>
                  {({ getFieldValue }) => {
                    const parts = (getFieldValue('targetFanpageId') || '').split(':');
                    const selectedAccount = connections?.find((c) => c.id === Number(parts[2]));
                    if (selectedAccount?.accountType !== 'PERSONAL_COOKIE') return null;
                    return <Form.Item name="groupNames" label="Chia sẻ thêm vào nhóm" extra="Chỉ áp dụng với bài video. Nhập tên nhóm rồi nhấn Enter."><Select mode="tags" placeholder="Nhập tên nhóm" open={false} suffixIcon={null} /></Form.Item>;
                  }}
                </Form.Item>
                <Form.Item name="affiliateLink" label="Liên kết tiếp thị" extra="Có thể nhập nhiều liên kết, mỗi dòng một liên kết."><Input.TextArea placeholder="https://..." rows={2} /></Form.Item>
                <Form.Item noStyle shouldUpdate={(prev, cur) => prev.urls !== cur.urls}>
                  {({ getFieldValue }) => (getFieldValue('urls') || '').split('\n').filter((u: string) => u.trim()).length > 1 ? <Form.Item name="intervalMinutes" label="Khoảng cách giữa các bài" initialValue={3}><Input type="number" min={1} max={1440} addonAfter="phút" /></Form.Item> : null}
                </Form.Item>
              </>,
            }]}
          />

          {addFromUrlMutation.isPending && (
            <div className="my-4 p-4 bg-emerald-50/80 rounded-2xl border border-emerald-200 space-y-2">
              <div className="flex justify-between items-center text-xs font-bold text-emerald-800">
                <span className="flex items-center gap-1.5">
                  <LoadingOutlined spin /> {progressStatusMsg}
                </span>
                <span className="bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded-full text-[11px] font-extrabold">{progressPercent}%</span>
              </div>
              <Progress
                percent={progressPercent}
                showInfo={false}
                strokeColor={{ '0%': '#10b981', '100%': '#059669' }}
              />
            </div>
          )}

          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.publishNow !== cur.publishNow}>
            {({ getFieldValue }) => (
              <div className="pt-4 flex justify-end gap-3 border-t border-slate-100">
                <Button onClick={() => setIsUrlModalVisible(false)} size="large" className="rounded-xl" disabled={addFromUrlMutation.isPending}>
                  Hủy
                </Button>
                <Button type="primary" htmlType="submit" loading={addFromUrlMutation.isPending} size="large" className="font-bold rounded-xl px-6">
                  {getFieldValue('publishNow') ? 'Đăng ngay' : 'Tạo và lên lịch'}
                </Button>
              </div>
            )}
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          <div className="flex items-center gap-2">
            <EditOutlined className="text-emerald-600" />
            <span className="font-bold text-lg">Sửa Caption Bài Viết</span>
          </div>
        }
        open={!!editingPost}
        onCancel={() => setEditingPost(null)}
        footer={null}
        width={560}
        centered
        className="rounded-2xl overflow-hidden"
      >
        <div className="mt-4">
          <Input.TextArea
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
            rows={10}
            className="rounded-xl"
            placeholder="Nhập caption bài viết..."
          />
          <div className="pt-4 flex justify-end gap-3 border-t border-slate-100 mt-4">
            <Button onClick={() => setEditingPost(null)} size="large" className="rounded-xl">
              Hủy
            </Button>
            <Button
              type="primary"
              size="large"
              loading={updateContentMutation.isPending}
              onClick={() => {
                if (editingPost) {
                  updateContentMutation.mutate({ id: editingPost.id, content: editingContent });
                }
              }}
              className="bg-emerald-600 hover:bg-emerald-500 font-bold rounded-xl px-6 border-none"
            >
              Lưu Caption
            </Button>
          </div>
        </div>
      </Modal>

      <Drawer
        title={viewingPost ? `Chi tiết bài đăng #${viewingPost.id}` : 'Chi tiết bài đăng'}
        open={!!viewingPost}
        onClose={() => setViewingPost(null)}
        size={screens.md ? 520 : '100%'}
        extra={viewingPost && renderStatus(viewingPost)}
      >
        {viewingPost && (
          <div className="space-y-5">
            <div>
              <Text className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Tiêu đề</Text>
              <h3 className="text-base font-bold text-slate-900 mt-1 mb-0">{viewingPost.title || `Bài đăng #${viewingPost.id}`}</h3>
            </div>
            <Descriptions column={1} size="small" bordered items={[
              { key: 'type', label: 'Loại', children: viewingPost.postType === 'STORY' ? 'Story' : 'Bài viết' },
              { key: 'schedule', label: 'Lịch đăng', children: viewingPost.scheduledAt ? dayjs(viewingPost.scheduledAt).format('HH:mm · DD/MM/YYYY') : 'Đăng ngay khi xử lý' },
              { key: 'published', label: 'Đã đăng lúc', children: viewingPost.publishedAt ? dayjs(viewingPost.publishedAt).format('HH:mm · DD/MM/YYYY') : '—' },
              { key: 'media', label: 'Định dạng', children: getPostMeta(viewingPost).hasMedia ? (getPostMeta(viewingPost).isVideo ? 'Video' : 'Hình ảnh') : 'Chỉ có nội dung' },
            ]} />
            <div>
              <Text className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Nội dung bài đăng</Text>
              <Paragraph className="!mt-2 !mb-0 whitespace-pre-line bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm leading-6">{viewingPost.content || 'Chưa có nội dung'}</Paragraph>
            </div>
            {viewingPost.errorMessage && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl p-3"><b>Lý do đăng lỗi:</b> {viewingPost.errorMessage}</div>}

            {viewingPost.status === 'PUBLISHED' && (
              <div>
                <Text className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Hiệu suất bài đăng</Text>
                <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
                  {insightsLoading ? (
                    <Text className="text-xs text-slate-500">Đang tải insights...</Text>
                  ) : insightsData?.success ? (
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div>
                        <div className="text-base font-bold text-slate-800">{insightsData.insights?.post_impressions_unique ?? '—'}</div>
                        <div className="text-[10px] text-slate-500">Người tiếp cận</div>
                      </div>
                      <div>
                        <div className="text-base font-bold text-slate-800">{insightsData.insights?.likeCount ?? '—'}</div>
                        <div className="text-[10px] text-slate-500">Lượt thích</div>
                      </div>
                      <div>
                        <div className="text-base font-bold text-slate-800">{insightsData.insights?.commentCount ?? '—'}</div>
                        <div className="text-[10px] text-slate-500">Bình luận</div>
                      </div>
                    </div>
                  ) : (
                    <Text className="text-xs text-slate-500">{insightsData?.message || 'Không có insights cho bài này (chỉ hỗ trợ bài đăng qua Graph API/PAGE_TOKEN)'}</Text>
                  )}
                </div>
              </div>
            )}

            <Space wrap>
              {viewingPost.originalUrl && <Button icon={<LinkOutlined />} href={viewingPost.originalUrl} target="_blank">Mở bài gốc</Button>}
              {getPostMeta(viewingPost).isVideo && <Button icon={<VideoCameraOutlined />} href={`${WORKER_BASE_URL}/api/download-video?url=${encodeURIComponent(viewingPost.mediaUrls.split(',')[0].trim())}&filename=${encodeURIComponent(viewingPost.title || 'video')}`} target="_blank">Tải video</Button>}
            </Space>
            <div className="sticky bottom-0 bg-[#111a28] border-t border-slate-800 pt-4 flex gap-2">
              <Button block icon={<EditOutlined />} onClick={() => { setViewingPost(null); setEditingPost(viewingPost); setEditingContent(viewingPost.content || ''); }}>Sửa nội dung</Button>
              {viewingPost.status === 'PENDING' && <Button block type="primary" icon={<SendOutlined />} onClick={() => publishNowMutation.mutate(viewingPost.id)}>Đăng ngay</Button>}
              {viewingPost.status === 'FAILED' && <Button block type="primary" icon={<SyncOutlined />} onClick={() => { resetFailedMutation.mutate(viewingPost.id); setViewingPost(null); }} className="bg-amber-600 hover:!bg-amber-500 border-none">Chờ đăng</Button>}
            </div>
          </div>
        )}
      </Drawer>

      <BatchPostModal
        open={isBatchModalVisible}
        onClose={() => setIsBatchModalVisible(false)}
      />
    </div>
  );
};

export default PostQueueView;
