import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Tag,
  Button,
  Table,
  Space,
  Input,
  Select,
  Modal,
  message,
  Tooltip,
  Badge,
  Alert,
  DatePicker,
  InputNumber,
  Typography,
  Divider,
  Popconfirm,
  Descriptions,
} from 'antd';
import {
  RocketOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  SearchOutlined,
  CalendarOutlined,
  StopOutlined,
  ThunderboltOutlined,
  DashboardOutlined,
  SafetyCertificateOutlined,
  LinkOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  DesktopOutlined,
  ReloadOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import api from '../config/axios';
import ScheduleChoice from '../components/common/ScheduleChoice';
import type { ScheduleValue } from '../components/common/postingSchedule';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

interface WorkerNode {
  url: string;
  port?: number;
  status: 'ONLINE' | 'OFFLINE';
  latencyMs: number;
  activeContexts?: number;
  totalContextsServed?: number;
  freeMemMb?: number;
  heapUsedMb?: number;
  rssMb?: number;
  error?: string;
}

interface QueueStats {
  totalActiveInQueue: number;
  totalHistorical: number;
  pending: number;
  scheduled: number;
  queued: number;
  processing: number;
  publishing: number;
  published: number;
  partial: number;
  failed: number;
  needsReview: number;
  cancelled: number;
}

interface DisconnectedAccount {
  id: number;
  pageName: string;
  platform: string;
  accountType: string;
  platformAccountId: string;
  tokenStatus: string;
  tokenCheckedAt?: string;
}

interface LaggingCampaign {
  id: number;
  name: string;
  status: string;
}

interface PostQueueItem {
  id: number;
  campaignId?: number;
  campaignName?: string;
  title?: string;
  content?: string;
  mediaUrls?: string;
  originalUrl?: string;
  status: string;
  targetFanpageId?: string;
  postType?: string;
  targetGroupNames?: string;
  publishedPostUrl?: string;
  errorMessage?: string;
  scheduledAt?: string;
  publishedAt?: string;
  executionDurationSeconds?: number;
  retryCount?: number;
  lockedBy?: string;
  lockToken?: string;
  leaseExpiresAt?: string;
  attemptCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

interface ExecutionAttempt {
  id: number;
  postQueueId: number;
  attemptToken: string;
  workerInstance: string;
  startedAt: string;
  finishedAt?: string;
  status: string;
  errorCode?: string;
  errorMessage?: string;
  proofUrl?: string;
  rawWorkerResponse?: string;
  createdAt: string;
}

interface PreflightResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  validatedAt: string;
}

const statusColorMap: Record<string, string> = {
  PENDING: 'gold',
  SCHEDULED: 'blue',
  QUEUED: 'purple',
  PROCESSING: 'processing',
  PUBLISHING: 'cyan',
  PUBLISHED: 'success',
  PARTIAL: 'warning',
  FAILED: 'error',
  NEEDS_REVIEW: 'magenta',
  CANCELLED: 'default',
};

const PublishingControlCenter: React.FC = () => {
  // State tổng quan
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [workerNodes, setWorkerNodes] = useState<WorkerNode[]>([]);
  const [disconnectedAccounts, setDisconnectedAccounts] = useState<DisconnectedAccount[]>([]);
  const [laggingCampaigns, setLaggingCampaigns] = useState<LaggingCampaign[]>([]);
  const [needsReviewItems, setNeedsReviewItems] = useState<PostQueueItem[]>([]);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(15); // seconds, 0 = disabled

  // State bảng hàng đợi (Phân trang server-side)
  const [queueLoading, setQueueLoading] = useState(false);
  const [queuePosts, setQueuePosts] = useState<PostQueueItem[]>([]);
  const [totalElements, setTotalElements] = useState(0);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // State Preflight Modal
  const [preflightModalOpen, setPreflightModalOpen] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightData, setPreflightData] = useState<PreflightResult | null>(null);
  const [preflightPost, setPreflightPost] = useState<PostQueueItem | null>(null);

  // State Bulk Reschedule Modal
  const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false);
  const [rescheduleChoice, setRescheduleChoice] = useState<ScheduleValue>({ mode: 'QUEUE' });
  const [rescheduling, setRescheduling] = useState(false);

  // State Post Detail Modal
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedDetailPost, setSelectedDetailPost] = useState<PostQueueItem | null>(null);

  // State Execution Attempts Modal (Audit Trail)
  const [attemptsModalOpen, setAttemptsModalOpen] = useState(false);
  const [attemptsLoading, setAttemptsLoading] = useState(false);
  const [attemptsList, setAttemptsList] = useState<ExecutionAttempt[]>([]);
  const [attemptsPostId, setAttemptsPostId] = useState<number | null>(null);

  const handleViewAttempts = async (postId: number) => {
    setAttemptsPostId(postId);
    setAttemptsModalOpen(true);
    setAttemptsLoading(true);
    try {
      const res = await api.get(`/publishing-control-center/attempts/${postId}`);
      setAttemptsList(res.data || []);
    } catch (err: any) {
      message.error('Không thể lấy lịch sử thực thi của bài viết');
      setAttemptsList([]);
    } finally {
      setAttemptsLoading(false);
    }
  };

  // Lấy dữ liệu Tổng quan
  const fetchOverview = useCallback(async () => {
    try {
      setLoadingOverview(true);
      const res = await api.get('/publishing-control-center/overview');
      const data = res.data;
      if (data) {
        setQueueStats(data.queueStats || null);
        setWorkerNodes(data.workerNodes || []);
        setDisconnectedAccounts(data.disconnectedAccounts || []);
        setLaggingCampaigns(data.laggingCampaigns || []);
        setNeedsReviewItems(data.needsReviewList || []);
      }
    } catch (err: any) {
      console.error('Lỗi khi tải dữ liệu tổng quan Control Center:', err);
      message.error('Không thể kết nối Backend để lấy dữ liệu điều hành');
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  // Lấy dữ liệu Hàng đợi (Phân trang server-side)
  const fetchQueue = useCallback(async () => {
    try {
      setQueueLoading(true);
      const res = await api.get('/publishing-control-center/queue', {
        params: {
          status: selectedStatus === 'ALL' ? undefined : selectedStatus,
          search: searchKeyword.trim() ? searchKeyword.trim() : undefined,
          page,
          size,
        },
      });
      const data = res.data;
      if (data && data.content) {
        setQueuePosts(data.content);
        setTotalElements(data.totalElements || 0);
      } else {
        setQueuePosts([]);
        setTotalElements(0);
      }
    } catch (err: any) {
      console.error('Lỗi khi tải danh sách hàng đợi:', err);
      message.error('Không thể lấy danh sách hàng đợi');
    } finally {
      setQueueLoading(false);
    }
  }, [page, size, selectedStatus, searchKeyword]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  // Bộ đếm Auto-Refresh
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const timer = setInterval(() => {
      fetchOverview();
      fetchQueue();
    }, autoRefreshInterval * 1000);
    return () => clearInterval(timer);
  }, [autoRefreshInterval, fetchOverview, fetchQueue]);

  // Xử lý xác minh bài viết (NEEDS_REVIEW)
  const handleVerifyPost = async (postId: number, action: 'CONFIRM_PUBLISHED' | 'RESET_PENDING' | 'CANCEL', notes?: string) => {
    try {
      const res = await api.post(`/publishing-control-center/verify/${postId}`, {
        action,
        notes: notes || (action === 'CONFIRM_PUBLISHED' ? 'Xác minh thủ công từ Control Center' : 'Yêu cầu từ người dùng'),
      });
      if (res.data?.success) {
        message.success(`Đã xử lý bài #${postId}: ${action}`);
        fetchOverview();
        fetchQueue();
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Xử lý xác minh thất bại');
    }
  };

  // Kiểm tra Preflight cho 1 bài viết
  const handleRunPreflight = async (post: PostQueueItem) => {
    setPreflightPost(post);
    setPreflightModalOpen(true);
    setPreflightLoading(true);
    try {
      const res = await api.post(`/publishing-control-center/preflight-check/${post.id}`);
      setPreflightData(res.data);
    } catch (err: any) {
      message.error('Không thể thẩm định Preflight cho bài viết');
      setPreflightData(null);
    } finally {
      setPreflightLoading(false);
    }
  };

  // Hủy hàng loạt bài viết
  const handleBulkCancel = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 bài viết để hủy');
      return;
    }
    try {
      const res = await api.post('/publishing-control-center/bulk-cancel', {
        postIds: selectedRowKeys,
      });
      message.success(`Đã hủy thành công ${res.data?.cancelledCount} bài viết`);
      setSelectedRowKeys([]);
      fetchOverview();
      fetchQueue();
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Hủy hàng loạt thất bại');
    }
  };

  // Dời lịch hàng loạt bài viết
  const handleBulkReschedule = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 bài viết để dời lịch');
      return;
    }
    setRescheduling(true);
    try {
      const res = await api.post('/publishing-control-center/bulk-reschedule', {
        postIds: selectedRowKeys,
        ...(rescheduleChoice.mode === 'AT' && rescheduleChoice.at
          ? { startAt: rescheduleChoice.at.format('YYYY-MM-DDTHH:mm:ss') }
          : {}),
      });
      message.success(`Đã dời lịch thành công ${res.data?.rescheduledCount} bài viết`);
      setRescheduleModalOpen(false);
      setSelectedRowKeys([]);
      fetchOverview();
      fetchQueue();
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Dời lịch hàng loạt thất bại');
    } finally {
      setRescheduling(false);
    }
  };

  // Tỉ lệ thành công (Success Rate)
  const successRate = useMemo(() => {
    if (!queueStats) return 0;
    const done = queueStats.published || 0;
    const fail = queueStats.failed || 0;
    const sum = done + fail;
    if (sum === 0) return 100;
    return Math.round((done / sum) * 100);
  }, [queueStats]);

  // Cột bảng Hàng đợi
  const columns: ColumnsType<PostQueueItem> = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 75,
      render: (val) => <Text strong className="text-gray-400">#{val}</Text>,
    },
    {
      title: 'Tiêu đề & Nội dung',
      dataIndex: 'title',
      render: (_, record) => (
        <div className="max-w-md">
          <Text strong className="text-white block truncate mb-1">
            {record.title || (record.content ? record.content.substring(0, 50) + '...' : 'Không có tiêu đề')}
          </Text>
          {record.campaignName && (
            <Tag color="geekblue" className="text-xs mb-1">
              {record.campaignName}
            </Tag>
          )}
          {record.postType && (
            <Tag color="cyan" className="text-xs">
              {record.postType}
            </Tag>
          )}
          {record.publishedPostUrl && (
            <a
              href={record.publishedPostUrl}
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 text-xs block mt-1"
            >
              <LinkOutlined /> Xem bài viết thực tế
            </a>
          )}
        </div>
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 140,
      render: (st: string, record) => {
        const color = statusColorMap[st] || 'default';
        return (
          <div>
            <Tag color={color} className="font-semibold">{st}</Tag>
            {record.lockedBy && record.status === 'PROCESSING' && (
              <Tooltip title={`Được chiếm lease bởi: ${record.lockedBy} (hết hạn lúc: ${record.leaseExpiresAt ? dayjs(record.leaseExpiresAt).format('HH:mm:ss') : 'N/A'})`}>
                <Tag color="cyan" className="!text-xs mt-1 block truncate max-w-[140px]">
                  🔒 {record.lockedBy}
                </Tag>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: 'Thời gian hẹn / Xuất bản',
      dataIndex: 'scheduledAt',
      width: 170,
      render: (_, record) => (
        <div className="text-xs">
          <div className="text-gray-300 flex items-center gap-1">
            <ClockCircleOutlined className="text-blue-400" />
            {record.scheduledAt ? dayjs(record.scheduledAt).format('DD/MM/YYYY HH:mm') : 'Chưa hẹn'}
          </div>
          {record.publishedAt && (
            <div className="text-emerald-400 flex items-center gap-1 mt-1">
              <CheckCircleOutlined />
              Đăng: {dayjs(record.publishedAt).format('HH:mm:ss')}
              {record.executionDurationSeconds ? ` (${record.executionDurationSeconds}s)` : ''}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Thử lại / Lỗi',
      dataIndex: 'retryCount',
      width: 110,
      render: (retries, record) => (
        <div>
          <Text className="text-xs block">Lần: {retries || 0}/3</Text>
          {record.errorMessage && (
            <Tooltip title={record.errorMessage}>
              <Text type="danger" className="text-xs truncate block max-w-[120px] cursor-pointer">
                {record.errorMessage}
              </Text>
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      title: 'Thao tác',
      key: 'action',
      width: 210,
      render: (_, record) => (
        <Space orientation="horizontal" size="small" wrap>
          <Tooltip title="Thẩm định bài trước khi đăng (Preflight)">
            <Button
              size="small"
              icon={<SafetyCertificateOutlined />}
              onClick={() => handleRunPreflight(record)}
            />
          </Tooltip>
          <Tooltip title="Xem lịch sử thực thi & đối soát (Audit Trail)">
            <Button
              size="small"
              icon={<HistoryOutlined />}
              onClick={() => handleViewAttempts(record.id)}
            />
          </Tooltip>
          <Tooltip title="Xem chi tiết">
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={() => {
                setSelectedDetailPost(record);
                setDetailModalOpen(true);
              }}
            />
          </Tooltip>
          {record.status === 'NEEDS_REVIEW' && (
            <Popconfirm
              title="Xác nhận bài này đã đăng thành công trên mạng xã hội?"
              onConfirm={() => handleVerifyPost(record.id, 'CONFIRM_PUBLISHED')}
              okText="Đúng, đã đăng"
              cancelText="Hủy"
            >
              <Button size="small" type="primary" className="bg-emerald-600 hover:bg-emerald-500">
                Xác nhận
              </Button>
            </Popconfirm>
          )}
          {(record.status === 'FAILED' || record.status === 'NEEDS_REVIEW') && (
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => handleVerifyPost(record.id, 'RESET_PENDING')}
            >
              Đăng lại
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* 1. Header & Cockpit Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <RocketOutlined className="text-blue-400 text-2xl" />
            <Title level={3} style={{ margin: 0, color: '#fff' }}>
              Publishing Control Center
            </Title>
            <Badge status="processing" text="TOOLZUTTER 3.2" className="ml-2" />
          </div>
          <Text className="text-gray-400 text-sm">
            Trung tâm điều hành xuất bản — Giám sát 3 Worker, kiểm soát hàng đợi 1,000+ bài và giải quyết sự cố
          </Text>
        </div>

        <Space wrap>
          <Select
            value={autoRefreshInterval}
            onChange={(val) => setAutoRefreshInterval(val)}
            style={{ width: 175 }}
            size="middle"
          >
            <Option value={10}>Tự làm mới: 10s</Option>
            <Option value={15}>Tự làm mới: 15s</Option>
            <Option value={30}>Tự làm mới: 30s</Option>
            <Option value={0}>Tắt tự làm mới</Option>
          </Select>

          <Button
            type="primary"
            icon={<SyncOutlined spin={loadingOverview || queueLoading} />}
            onClick={() => {
              fetchOverview();
              fetchQueue();
            }}
          >
            Làm mới ngay
          </Button>
        </Space>
      </div>

      {/* 2. Top Statistic KPI Cards */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="bg-slate-900/70 border-slate-800 hover:border-blue-500/50 transition-all">
            <Statistic
              title={<span className="text-gray-400 font-medium">Hàng đợi đang xử lý</span>}
              value={queueStats?.totalActiveInQueue || 0}
              prefix={<ThunderboltOutlined className="text-blue-400" />}
              valueStyle={{ color: '#38bdf8', fontWeight: 700 }}
              suffix={<span className="text-xs text-gray-500 font-normal">bài hoạt động</span>}
            />
            <div className="mt-2 text-xs text-gray-400 flex justify-between">
              <span>Chờ: {queueStats?.pending || 0}</span>
              <span>Đang gửi: {(queueStats?.processing || 0) + (queueStats?.publishing || 0)}</span>
              <span>Cần xem: {queueStats?.needsReview || 0}</span>
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card className="bg-slate-900/70 border-slate-800 hover:border-emerald-500/50 transition-all">
            <Statistic
              title={<span className="text-gray-400 font-medium">Tỉ lệ xuất bản thành công</span>}
              value={successRate}
              suffix="%"
              prefix={<CheckCircleOutlined className="text-emerald-400" />}
              valueStyle={{ color: '#34d399', fontWeight: 700 }}
            />
            <div className="mt-2 text-xs text-gray-400 flex justify-between">
              <span>Đã đăng: {queueStats?.published || 0}</span>
              <span>Lỗi: {queueStats?.failed || 0}</span>
              <span>Tổng: {queueStats?.totalHistorical || 0}</span>
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card className="bg-slate-900/70 border-slate-800 hover:border-amber-500/50 transition-all">
            <Statistic
              title={<span className="text-gray-400 font-medium">Bài cần xác minh (Review)</span>}
              value={queueStats?.needsReview || 0}
              prefix={<ExclamationCircleOutlined className="text-amber-400" />}
              valueStyle={{ color: (queueStats?.needsReview || 0) > 0 ? '#fbbf24' : '#94a3b8', fontWeight: 700 }}
            />
            <div className="mt-2 text-xs text-gray-400">
              {(queueStats?.needsReview || 0) > 0 ? (
                <span className="text-amber-400 font-medium">Cần đối soát để tránh đăng trùng</span>
              ) : (
                <span className="text-emerald-400">Hàng đợi chuẩn xác, không treo</span>
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card className="bg-slate-900/70 border-slate-800 hover:border-rose-500/50 transition-all">
            <Statistic
              title={<span className="text-gray-400 font-medium">Tài khoản mất kết nối</span>}
              value={disconnectedAccounts.length}
              prefix={<CloseCircleOutlined className="text-rose-400" />}
              valueStyle={{ color: disconnectedAccounts.length > 0 ? '#f43f5e' : '#34d399', fontWeight: 700 }}
            />
            <div className="mt-2 text-xs text-gray-400">
              {disconnectedAccounts.length > 0 ? (
                <span className="text-rose-400 font-medium">{disconnectedAccounts.length} Fanpage/VIA hết hạn cookie</span>
              ) : (
                <span className="text-emerald-400">Tất cả tài khoản đang kết nối tốt</span>
              )}
            </div>
          </Card>
        </Col>
      </Row>

      {/* 3. Cluster Telemetry: 3 Worker Nodes Health */}
      <Card
        title={
          <div className="flex items-center gap-2 text-white">
            <DesktopOutlined className="text-blue-400" />
            <span>Trạng thái cụm 3 Worker Nodes (Cluster Telemetry)</span>
          </div>
        }
        className="bg-slate-900/70 border-slate-800"
      >
        <Row gutter={[16, 16]}>
          {workerNodes.map((node, idx) => {
            const isOnline = node.status === 'ONLINE';
            const latency = node.latencyMs;
            const latencyColor = latency < 50 ? 'text-emerald-400' : latency < 150 ? 'text-amber-400' : 'text-rose-400';

            return (
              <Col xs={24} md={8} key={node.url || idx}>
                <div
                  className={`p-4 rounded-xl border transition-all ${
                    isOnline
                      ? 'bg-slate-800/40 border-slate-700/80 hover:border-blue-500/40'
                      : 'bg-rose-950/20 border-rose-800/40'
                  }`}
                >
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2">
                      <Badge status={isOnline ? 'success' : 'error'} />
                      <Text strong className="text-white">
                        Worker #{idx + 1}
                      </Text>
                      <Tag color="blue" className="text-xs">
                        Port {node.port || 3001 + idx}
                      </Tag>
                    </div>
                    <Tag color={isOnline ? 'green' : 'red'}>{node.status}</Tag>
                  </div>

                  {isOnline ? (
                    <div className="space-y-1.5 text-xs text-gray-300">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Độ trễ (Latency):</span>
                        <span className={`font-mono font-medium ${latencyColor}`}>{latency} ms</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Trình duyệt active:</span>
                        <span className="font-mono text-cyan-400">{node.activeContexts ?? 0} context</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Đã phục vụ:</span>
                        <span className="font-mono text-gray-300">{node.totalContextsServed ?? 0} lượt</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">RAM trống / RSS:</span>
                        <span className="font-mono text-emerald-400">
                          {node.freeMemMb ? `${node.freeMemMb} MB` : 'N/A'} / {node.rssMb ? `${node.rssMb} MB` : 'N/A'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-rose-400 py-2">
                      <ExclamationCircleOutlined className="mr-1" />
                      Không phản hồi: {node.error || 'Connection refused'}
                    </div>
                  )}
                </div>
              </Col>
            );
          })}
        </Row>
      </Card>

      {/* 4. Incident & Disconnected Accounts Deck */}
      {(needsReviewItems.length > 0 || disconnectedAccounts.length > 0 || laggingCampaigns.length > 0) && (
        <Card
          title={
            <div className="flex items-center gap-2 text-amber-400">
              <WarningOutlined />
              <span>Đối soát & Cảnh báo cần xử lý</span>
            </div>
          }
          className="bg-slate-900/70 border-amber-900/40"
        >
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {/* Needs Review Alert */}
            {needsReviewItems.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message={
                  <span className="font-semibold text-amber-300">
                    Có {needsReviewItems.length} bài đăng diện cần xác minh (NEEDS_REVIEW)
                  </span>
                }
                description={
                  <div>
                    <p className="text-xs text-gray-300 mb-2">
                      Các bài viết này gặp sự cố mạng hoặc worker quá hạn xác nhận kết quả. Hãy kiểm tra trên Fanpage và bấm
                      &quot;Xác nhận đã đăng&quot; để chốt trạng thái hoặc &quot;Đăng lại&quot; để xếp hàng đợi tiếp.
                    </p>
                    <div className="space-y-2">
                      {needsReviewItems.map((item) => (
                        <div
                          key={item.id}
                          className="bg-slate-800/80 p-2.5 rounded-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-2"
                        >
                          <div>
                            <Text strong className="text-white text-xs block">
                              #{item.id} — {item.title || item.content?.substring(0, 60)}...
                            </Text>
                            <Text className="text-gray-400 text-xs">
                              Hẹn lúc: {item.scheduledAt ? dayjs(item.scheduledAt).format('DD/MM/YYYY HH:mm') : 'N/A'}
                            </Text>
                          </div>
                          <Space size="small">
                            <Button
                              size="small"
                              type="primary"
                              className="bg-emerald-600 hover:bg-emerald-500"
                              onClick={() => handleVerifyPost(item.id, 'CONFIRM_PUBLISHED')}
                            >
                              Xác nhận đã đăng
                            </Button>
                            <Button
                              size="small"
                              onClick={() => handleVerifyPost(item.id, 'RESET_PENDING')}
                            >
                              Đăng lại vào hàng đợi
                            </Button>
                            <Button
                              size="small"
                              danger
                              onClick={() => handleVerifyPost(item.id, 'CANCEL')}
                            >
                              Hủy bỏ
                            </Button>
                          </Space>
                        </div>
                      ))}
                    </div>
                  </div>
                }
              />
            )}

            {/* Disconnected Accounts */}
            {disconnectedAccounts.length > 0 && (
              <Alert
                type="error"
                showIcon
                message={
                  <span className="font-semibold text-rose-300">
                    Phát hiện {disconnectedAccounts.length} kết nối Fanpage/VIA bị hết hạn Cookie hoặc Checkpoint
                  </span>
                }
                description={
                  <div className="flex orientation-horizontal flex-wrap gap-2 mt-1">
                    {disconnectedAccounts.map((acc) => (
                      <Tag color="volcano" key={acc.id} className="text-xs py-1 px-2">
                        {acc.pageName} ({acc.platform}) — Token: {acc.tokenStatus}
                      </Tag>
                    ))}
                  </div>
                }
              />
            )}

            {/* Lagging Campaigns */}
            {laggingCampaigns.length > 0 && (
              <Alert
                type="info"
                showIcon
                message={
                  <span className="font-semibold text-blue-300">
                    Phát hiện {laggingCampaigns.length} chiến dịch có bài đăng trễ hơn 15 phút
                  </span>
                }
                description={
                  <div className="flex orientation-horizontal flex-wrap gap-2 mt-1">
                    {laggingCampaigns.map((c) => (
                      <Tag color="geekblue" key={c.id}>
                        Chiến dịch: {c.name} (ID: #{c.id})
                      </Tag>
                    ))}
                  </div>
                }
              />
            )}
          </Space>
        </Card>
      )}

      {/* 5. Paginated Queue Engine Table (Scalable to 1,000+ posts) */}
      <Card
        title={
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 w-full">
            <div className="flex items-center gap-2 text-white">
              <DashboardOutlined className="text-cyan-400" />
              <span>Hàng đợi xuất bản (Publishing Queue Engine)</span>
              <Tag color="blue">{totalElements} bài</Tag>
            </div>

            {/* Filter and Bulk Action Bar */}
            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <Input
                placeholder="Tìm tiêu đề, nội dung..."
                prefix={<SearchOutlined />}
                value={searchKeyword}
                onChange={(e) => {
                  setSearchKeyword(e.target.value);
                  setPage(0);
                }}
                style={{ width: 200 }}
                allowClear
              />

              <Select
                value={selectedStatus}
                onChange={(val) => {
                  setSelectedStatus(val);
                  setPage(0);
                }}
                style={{ width: 140 }}
              >
                <Option value="ALL">Tất cả trạng thái</Option>
                <Option value="PENDING">Chờ đăng (PENDING)</Option>
                <Option value="SCHEDULED">Đã lập lịch</Option>
                <Option value="QUEUED">Trong hàng đợi</Option>
                <Option value="PROCESSING">Đang xử lý</Option>
                <Option value="PUBLISHING">Đang đăng</Option>
                <Option value="PUBLISHED">Thành công</Option>
                <Option value="NEEDS_REVIEW">Cần đối soát</Option>
                <Option value="FAILED">Thất bại</Option>
                <Option value="CANCELLED">Đã hủy</Option>
              </Select>

              {selectedRowKeys.length > 0 && (
                <Space>
                  <Button
                    icon={<CalendarOutlined />}
                    onClick={() => setRescheduleModalOpen(true)}
                    className="border-blue-500 text-blue-400"
                  >
                    Dời lịch ({selectedRowKeys.length})
                  </Button>
                  <Popconfirm
                    title={`Bạn có chắc chắn muốn hủy ${selectedRowKeys.length} bài đăng đã chọn?`}
                    onConfirm={handleBulkCancel}
                    okText="Hủy ngay"
                    cancelText="Đóng"
                  >
                    <Button danger icon={<StopOutlined />}>
                      Hủy ({selectedRowKeys.length})
                    </Button>
                  </Popconfirm>
                </Space>
              )}
            </div>
          </div>
        }
        className="bg-slate-900/70 border-slate-800"
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={queuePosts}
          loading={queueLoading}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
          }}
          pagination={{
            current: page + 1,
            pageSize: size,
            total: totalElements,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50', '100'],
            showTotal: (total, range) => `${range[0]}-${range[1]} của ${total} bài`,
            onChange: (p, s) => {
              setPage(p - 1);
              setSize(s);
            },
          }}
          className="ant-table-dark overflow-x-auto"
        />
      </Card>

      {/* 6. Modal: Preflight Validation Report */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-white">
            <SafetyCertificateOutlined className="text-cyan-400" />
            <span>Thẩm định xuất bản (Preflight Check) #{preflightPost?.id}</span>
          </div>
        }
        open={preflightModalOpen}
        onCancel={() => setPreflightModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setPreflightModalOpen(false)}>
            Đóng
          </Button>,
        ]}
      >
        {preflightLoading ? (
          <div className="text-center py-8">
            <SyncOutlined spin className="text-2xl text-blue-400 mb-2" />
            <Text className="block text-gray-400">Đang kiểm tra tính hợp lệ bài viết...</Text>
          </div>
        ) : preflightData ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/80">
              {preflightData.valid ? (
                <>
                  <CheckCircleOutlined className="text-emerald-400 text-2xl" />
                  <div>
                    <Text strong className="text-emerald-400 text-base block">
                      Bài viết sẵn sàng xuất bản (Preflight PASSED)
                    </Text>
                    <Text className="text-gray-400 text-xs">
                      Không phát hiện vi phạm định dạng hoặc lỗi kết nối tài khoản.
                    </Text>
                  </div>
                </>
              ) : (
                <>
                  <CloseCircleOutlined className="text-rose-400 text-2xl" />
                  <div>
                    <Text strong className="text-rose-400 text-base block">
                      Phát hiện lỗi không thể xuất bản (Preflight FAILED)
                    </Text>
                    <Text className="text-gray-400 text-xs">
                      Vui lòng sửa các lỗi bên dưới trước khi cho phép worker xử lý.
                    </Text>
                  </div>
                </>
              )}
            </div>

            {preflightData.errors && preflightData.errors.length > 0 && (
              <div>
                <Text strong className="text-rose-400 text-sm block mb-1">
                  Danh sách lỗi chặn (Blockers):
                </Text>
                <div className="space-y-1">
                  {preflightData.errors.map((err, i) => (
                    <div key={i} className="text-xs text-rose-300 bg-rose-950/30 p-2 rounded border border-rose-900/50">
                      • {err}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {preflightData.warnings && preflightData.warnings.length > 0 && (
              <div>
                <Text strong className="text-amber-400 text-sm block mb-1">
                  Cảnh báo (Warnings):
                </Text>
                <div className="space-y-1">
                  {preflightData.warnings.map((w, i) => (
                    <div key={i} className="text-xs text-amber-300 bg-amber-950/30 p-2 rounded border border-amber-900/50">
                      • {w}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="text-xs text-gray-500 pt-2 border-t border-slate-800">
              Thẩm định lúc: {dayjs(preflightData.validatedAt).format('DD/MM/YYYY HH:mm:ss')}
            </div>
          </div>
        ) : (
          <Text className="text-gray-400">Không có dữ liệu thẩm định.</Text>
        )}
      </Modal>

      {/* 7. Modal: Bulk Reschedule */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-white">
            <CalendarOutlined className="text-blue-400" />
            <span>Dời lịch hàng loạt {selectedRowKeys.length} bài viết</span>
          </div>
        }
        open={rescheduleModalOpen}
        onCancel={() => setRescheduleModalOpen(false)}
        onOk={handleBulkReschedule}
        confirmLoading={rescheduling}
        okText="Lưu lịch mới"
        cancelText="Đóng"
      >
        <div className="space-y-3 py-2">
          <Text className="text-gray-400 text-xs block">
            Các bài được xếp nối đuôi theo từng nick, theo khung giờ và giãn cách của Lịch đăng chung.
          </Text>
          <ScheduleChoice value={rescheduleChoice} onChange={setRescheduleChoice} modes={['QUEUE', 'AT']} />
        </div>
      </Modal>

      {/* 8. Modal: Post Detail */}
      <Modal
        title={`Chi tiết bài viết #${selectedDetailPost?.id}`}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setDetailModalOpen(false)}>
            Đóng
          </Button>,
        ]}
        width={700}
      >
        {selectedDetailPost && (
          <Descriptions column={1} bordered size="small" className="mt-2 text-xs">
            <Descriptions.Item label="Trạng thái">
              <Tag color={statusColorMap[selectedDetailPost.status] || 'default'}>
                {selectedDetailPost.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Chiến dịch">{selectedDetailPost.campaignName || 'N/A'}</Descriptions.Item>
            <Descriptions.Item label="Tiêu đề">{selectedDetailPost.title || '(Không có)'}</Descriptions.Item>
            <Descriptions.Item label="Nội dung">
              <Paragraph className="text-gray-300 whitespace-pre-wrap max-h-48 overflow-y-auto m-0">
                {selectedDetailPost.content}
              </Paragraph>
            </Descriptions.Item>
            <Descriptions.Item label="Media URLs">
              {selectedDetailPost.mediaUrls || '(Không có)'}
            </Descriptions.Item>
            <Descriptions.Item label="Thời gian hẹn">
              {selectedDetailPost.scheduledAt ? dayjs(selectedDetailPost.scheduledAt).format('DD/MM/YYYY HH:mm:ss') : 'N/A'}
            </Descriptions.Item>
            <Descriptions.Item label="Thời gian đăng">
              {selectedDetailPost.publishedAt ? dayjs(selectedDetailPost.publishedAt).format('DD/MM/YYYY HH:mm:ss') : 'Chưa đăng'}
            </Descriptions.Item>
            <Descriptions.Item label="Thời gian thực thi">
              {selectedDetailPost.executionDurationSeconds ? `${selectedDetailPost.executionDurationSeconds} giây` : 'N/A'}
            </Descriptions.Item>
            <Descriptions.Item label="Thông báo lỗi">
              <Text type="danger">{selectedDetailPost.errorMessage || 'Không có lỗi'}</Text>
            </Descriptions.Item>
            {selectedDetailPost.publishedPostUrl && (
              <Descriptions.Item label="Link bài viết">
                <a href={selectedDetailPost.publishedPostUrl} target="_blank" rel="noreferrer" className="text-blue-400">
                  {selectedDetailPost.publishedPostUrl}
                </a>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>

      {/* 9. Modal: Execution Attempts Audit Trail */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-white">
            <HistoryOutlined className="text-cyan-400" />
            <span>Nhật ký thực thi & Đối soát (Audit Trail) #{attemptsPostId}</span>
          </div>
        }
        open={attemptsModalOpen}
        onCancel={() => setAttemptsModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setAttemptsModalOpen(false)}>
            Đóng
          </Button>,
        ]}
        width={850}
      >
        <Table
          rowKey="id"
          loading={attemptsLoading}
          dataSource={attemptsList}
          pagination={false}
          size="small"
          columns={[
            {
              title: 'Lần thử / Token',
              dataIndex: 'attemptToken',
              width: 130,
              render: (token, record, idx) => (
                <div>
                  <Text strong className="text-slate-200 block text-xs">#{attemptsList.length - idx}</Text>
                  <Text className="text-xs text-slate-400 font-mono truncate block max-w-[120px]" title={token}>
                    {token ? token.substring(0, 10) + '...' : 'N/A'}
                  </Text>
                </div>
              ),
            },
            {
              title: 'Worker / Điều phối',
              dataIndex: 'workerInstance',
              width: 150,
              render: (worker) => (
                <Tag color="geekblue" className="!text-xs">
                  {worker || 'N/A'}
                </Tag>
              ),
            },
            {
              title: 'Thời điểm',
              dataIndex: 'startedAt',
              width: 140,
              render: (start, record) => (
                <div className="text-xs text-slate-300">
                  <div>Bắt đầu: {dayjs(start).format('HH:mm:ss')}</div>
                  {record.finishedAt && <div>Kết thúc: {dayjs(record.finishedAt).format('HH:mm:ss')}</div>}
                </div>
              ),
            },
            {
              title: 'Trạng thái',
              dataIndex: 'status',
              width: 120,
              render: (st) => {
                const color = st === 'SUCCESS' ? 'success' : st === 'STARTED' ? 'processing' : st === 'TIMEOUT' ? 'warning' : 'error';
                return <Tag color={color} className="font-semibold text-xs">{st}</Tag>;
              },
            },
            {
              title: 'Kết quả / Chi tiết lỗi',
              dataIndex: 'errorMessage',
              render: (err, record) => (
                <div className="text-xs">
                  {record.proofUrl && (
                    <a href={record.proofUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline block truncate max-w-xs mb-1">
                      🔗 Proof: {record.proofUrl}
                    </a>
                  )}
                  {err ? (
                    <Text type="danger" className="block whitespace-pre-wrap max-h-20 overflow-y-auto">
                      {err}
                    </Text>
                  ) : (
                    <Text className="text-gray-500">Hoàn tất hợp lệ</Text>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
};

export default PublishingControlCenter;

