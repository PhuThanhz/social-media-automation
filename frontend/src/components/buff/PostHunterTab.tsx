import { useMemo, useState } from 'react';
import axios from 'axios';
import { App, Badge, Button, Dropdown, Empty, Input, Modal, Segmented, Space, Switch, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  ExportOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

export interface HunterMonitor {
  id: string;
  targetName: string;
  targetUrl: string;
  targetType: 'PAGE' | 'GROUP' | 'PROFILE';
  checkIntervalMinutes: number;
  buffConfig: {
    targetLikes: number | 'ALL';
    reactionType: string;
    enableComment: boolean;
    delayMinutes: number;
    viaMode: string;
  };
  status: 'ACTIVE' | 'PAUSED';
  totalDetected: number;
  lastCheckedAt: string | null;
  lastFoundPostUrl: string | null;
  baselineDone?: boolean;
  lastPostsFound?: number;
  lastScanVia?: string | null;
}

interface PostHunterTabProps {
  workerBaseUrl: string;
  monitors: HunterMonitor[];
  queueItems: any[];
  autoBuffOwnPosts: boolean;
  maxPagesPerPost: number;
  onRefresh: () => void;
  onAdd: (prefillUrl?: string) => void;
  onEdit: (monitor: HunterMonitor) => void;
  onToggle: (id: string) => Promise<void> | void;
  onDelete: (id: string) => void;
  onScanNow: (id: string) => Promise<void>;
  onQueueUrl: (url: string) => void;
  onOpenQueue: () => void;
  onOpenSettings: () => void;
}

type MonitorFilter = 'ALL' | 'ACTIVE' | 'PAUSED' | 'ATTENTION';

const REACTION_LABELS: Record<string, string> = {
  RANDOM_POSITIVE: 'Like / Love / Care',
  LIKE: 'Like',
  LOVE: 'Love',
  CARE: 'Care',
};

const TYPE_LABELS: Record<string, string> = {
  PAGE: 'Fanpage',
  GROUP: 'Group',
  PROFILE: 'Trang cá nhân',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function formatAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return 'Chưa quét';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Vừa xong';
  if (min < 60) return `${min} phút trước`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

function nextScanAt(mon: HunterMonitor): number {
  const intervalMs = Math.max(1, mon.checkIntervalMinutes || 10) * 60000;
  return mon.lastCheckedAt ? new Date(mon.lastCheckedAt).getTime() + intervalMs : 0;
}

function formatUntil(ts: number, now: number): string {
  const diff = ts - now;
  if (diff <= 60000) return 'Sắp quét';
  return `${Math.ceil(diff / 60000)} phút nữa`;
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?facebook\.com\/?/i, 'facebook.com/').replace(/\/$/, '');
}

function isHunterTask(task: any): boolean {
  const source = String(task?.source || '');
  return source.startsWith('POST_HUNTER') || source === 'AUTO_OWN_POST';
}

// Trạng thái vận hành của 1 mục tiêu (ưu tiên thứ tự: tạm dừng → lấy mốc → không thấy bài → bình thường)
function getMonitorHealth(mon: HunterMonitor): { status: 'default' | 'processing' | 'warning' | 'success'; text: string; hint?: string } {
  if (mon.status !== 'ACTIVE') return { status: 'default', text: 'Tạm dừng' };
  if (!mon.baselineDone) {
    return mon.lastCheckedAt
      ? { status: 'warning', text: 'Chưa lấy được mốc', hint: 'Lần quét gần nhất không thấy bài nào. Kiểm tra link, hoặc via có phải thành viên Group không.' }
      : { status: 'processing', text: 'Đang lấy mốc', hint: 'Lần quét đầu chỉ ghi nhận bài hiện có, không buff bài cũ.' };
  }
  if (mon.lastCheckedAt && (mon.lastPostsFound ?? 1) === 0) {
    return { status: 'warning', text: 'Không thấy bài', hint: 'Lần quét gần nhất không đọc được bài nào. Via có thể đã mất quyền xem hoặc bị đăng xuất.' };
  }
  return { status: 'success', text: 'Đang theo dõi' };
}

function renderTaskStatus(task: any) {
  if (task.status === 'RUNNING') {
    const p = task.progress;
    return <Badge status="processing" text={p?.total ? `Đang buff ${p.done}/${p.total}` : 'Đang buff'} />;
  }
  if (task.status === 'COMPLETED') return <Badge status="success" text="Hoàn tất" />;
  if (task.status === 'FAILED') return <Badge status="error" text="Thất bại" />;
  return <Badge status="warning" text="Chờ buff" />;
}

export default function PostHunterTab({
  workerBaseUrl,
  monitors,
  queueItems,
  autoBuffOwnPosts,
  maxPagesPerPost,
  onRefresh,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
  onScanNow,
  onQueueUrl,
  onOpenQueue,
  onOpenSettings,
}: PostHunterTabProps) {
  const { message } = App.useApp();
  const [filter, setFilter] = useState<MonitorFilter>('ALL');
  const [search, setSearch] = useState('');
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [testOpen, setTestOpen] = useState(false);
  const [testUrl, setTestUrl] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ posts: any[]; scanVia?: string | null } | null>(null);

  const now = Date.now();

  const stats = useMemo(() => {
    const active = monitors.filter((m) => m.status === 'ACTIVE');
    const hunterTasks = queueItems.filter(isHunterTask);
    const caught24h = hunterTasks.filter((t) => t.addedAt && now - new Date(t.addedAt).getTime() < DAY_MS).length;
    const waiting = hunterTasks.filter((t) => t.status === 'QUEUED').length;
    const running = queueItems.filter((t) => t.status === 'RUNNING').length;
    const nextScans = active.map(nextScanAt);
    const soonest = nextScans.length ? Math.min(...nextScans) : null;
    const attention = monitors.filter((m) => getMonitorHealth(m).status === 'warning').length;
    return { active: active.length, caught24h, waiting, running, soonest, attention };
  }, [monitors, queueItems, now]);

  const filteredMonitors = useMemo(() => {
    const q = search.trim().toLowerCase();
    return monitors.filter((m) => {
      if (filter === 'ACTIVE' && m.status !== 'ACTIVE') return false;
      if (filter === 'PAUSED' && m.status !== 'PAUSED') return false;
      if (filter === 'ATTENTION' && getMonitorHealth(m).status !== 'warning') return false;
      if (!q) return true;
      return m.targetName.toLowerCase().includes(q) || m.targetUrl.toLowerCase().includes(q);
    });
  }, [monitors, filter, search]);

  const recentCatches = useMemo(
    () =>
      queueItems
        .filter(isHunterTask)
        .sort((a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime())
        .slice(0, 8),
    [queueItems]
  );

  const handleScanNow = async (id: string) => {
    setScanningId(id);
    try {
      await onScanNow(id);
    } finally {
      setScanningId(null);
    }
  };

  const handleToggle = async (id: string) => {
    setTogglingId(id);
    try {
      await onToggle(id);
    } finally {
      setTogglingId(null);
    }
  };

  const runTestScan = async () => {
    if (!testUrl.trim()) {
      message.warning('Dán link Fanpage hoặc Group cần quét thử');
      return;
    }
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await axios.post(`${workerBaseUrl}/api/buff-hunter/test-scan`, { targetUrl: testUrl.trim() });
      if (res.data?.success) {
        setTestResult({ posts: res.data.posts || [], scanVia: res.data.scanVia });
      } else {
        message.error(res.data?.error || 'Quét thử thất bại');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    } finally {
      setTestLoading(false);
    }
  };

  const columns: ColumnsType<HunterMonitor> = [
    {
      title: 'Mục tiêu',
      key: 'target',
      render: (_, mon) => (
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-slate-100 truncate">{mon.targetName}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5 min-w-0">
            <span className="shrink-0">{TYPE_LABELS[mon.targetType] || 'Fanpage'}</span>
            <span className="shrink-0">·</span>
            <a href={mon.targetUrl} target="_blank" rel="noopener noreferrer" className="truncate text-slate-400 hover:text-blue-400">
              {shortUrl(mon.targetUrl)}
            </a>
          </div>
        </div>
      ),
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 140,
      render: (_, mon) => {
        const health = getMonitorHealth(mon);
        const badge = <Badge className="whitespace-nowrap" status={health.status} text={<span className="text-xs text-slate-200">{health.text}</span>} />;
        return health.hint ? <Tooltip title={health.hint}>{badge}</Tooltip> : badge;
      },
    },
    {
      title: 'Cách buff',
      key: 'buff',
      width: 170,
      render: (_, mon) => (
        <div className="text-xs whitespace-nowrap">
          <div className="text-slate-200">
            {mon.buffConfig?.targetLikes === 'ALL' ? `Xoay vòng ≤${maxPagesPerPost} page` : `${mon.buffConfig?.targetLikes || 30} lượt`}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
            {REACTION_LABELS[mon.buffConfig?.reactionType] || mon.buffConfig?.reactionType}
            {' · '}
            {mon.buffConfig?.delayMinutes ? `chờ ${mon.buffConfig.delayMinutes} phút` : 'buff ngay'}
            {mon.buffConfig?.enableComment ? ' · bình luận' : ''}
          </div>
        </div>
      ),
    },
    {
      title: 'Quét gần nhất',
      key: 'lastScan',
      width: 160,
      render: (_, mon) => (
        <div className="text-xs whitespace-nowrap">
          <div className="text-slate-200">{formatAgo(mon.lastCheckedAt, now)}</div>
          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
            {mon.lastCheckedAt
              ? `${mon.lastPostsFound ?? 0} bài${mon.lastScanVia ? ` · ${mon.lastScanVia}` : ''}`
              : `Mỗi ${mon.checkIntervalMinutes} phút`}
          </div>
        </div>
      ),
    },
    {
      title: 'Quét tiếp',
      key: 'nextScan',
      width: 105,
      render: (_, mon) => (
        <span className="text-xs text-slate-300 whitespace-nowrap">
          {mon.status === 'ACTIVE' ? formatUntil(nextScanAt(mon), now) : '—'}
        </span>
      ),
    },
    {
      title: 'Đã bắt',
      key: 'caught',
      width: 90,
      align: 'right',
      render: (_, mon) => (
        <div className="text-xs whitespace-nowrap">
          <div className="text-slate-100 font-semibold">{mon.totalDetected || 0} bài</div>
          {mon.lastFoundPostUrl && (
            <a href={mon.lastFoundPostUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-400 hover:underline">
              Bài gần nhất
            </a>
          )}
        </div>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 185,
      align: 'right',
      render: (_, mon) => (
        <Space size={8}>
          <Tooltip title={mon.status === 'ACTIVE' ? 'Tạm dừng theo dõi' : 'Bật theo dõi'}>
            <Switch
              size="small"
              checked={mon.status === 'ACTIVE'}
              loading={togglingId === mon.id}
              onChange={() => handleToggle(mon.id)}
            />
          </Tooltip>
          <Button size="small" icon={<ThunderboltOutlined />} loading={scanningId === mon.id} onClick={() => handleScanNow(mon.id)}>
            Quét ngay
          </Button>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'edit', icon: <SettingOutlined />, label: 'Sửa cấu hình', onClick: () => onEdit(mon) },
                { key: 'open', icon: <ExportOutlined />, label: 'Mở trang mục tiêu', onClick: () => window.open(mon.targetUrl, '_blank') },
                { type: 'divider' },
                { key: 'delete', icon: <DeleteOutlined />, label: 'Xoá mục tiêu', danger: true, onClick: () => onDelete(mon.id) },
              ],
            }}
          >
            <Button size="small" type="text" icon={<MoreOutlined />} aria-label="Thao tác khác" />
          </Dropdown>
        </Space>
      ),
    },
  ];

  const statItems = [
    { label: 'Đang theo dõi', value: `${stats.active}/${monitors.length}`, sub: stats.attention > 0 ? `${stats.attention} mục cần xem lại` : 'mục tiêu' },
    { label: 'Bài bắt được 24h', value: String(stats.caught24h), sub: 'bài mới' },
    { label: 'Chờ buff', value: String(stats.waiting), sub: stats.running > 0 ? `${stats.running} bài đang buff` : 'trong hàng đợi' },
    { label: 'Lượt quét tiếp', value: stats.soonest === null ? '—' : formatUntil(stats.soonest, now), sub: 'mục tiêu gần nhất' },
  ];

  return (
    <div className="space-y-4">
      {/* Tiêu đề + thao tác chính */}
      <div className="app-surface p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-slate-100">Tự săn bài mới</div>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Theo dõi Fanpage và Group. Khi có bài mới, hệ thống chờ một khoảng ngắn rồi buff bằng các page của via, xoay vòng để page nào cũng được dùng đều.
            Lần quét đầu chỉ lấy mốc nên bài cũ không bị buff.
          </p>
        </div>
        <Space className="shrink-0">
          <Tooltip title="Làm mới">
            <Button icon={<ReloadOutlined />} onClick={onRefresh} aria-label="Làm mới" />
          </Tooltip>
          <Button icon={<SearchOutlined />} onClick={() => setTestOpen(true)}>
            Quét thử link
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => onAdd()}>
            Thêm mục tiêu
          </Button>
        </Space>
      </div>

      {/* Số liệu vận hành */}
      <div className="app-surface grid grid-cols-2 lg:grid-cols-5">
        {statItems.map((item, idx) => (
          <div key={item.label} className={`px-4 py-3.5 ${idx > 0 ? 'lg:border-l border-slate-800/80' : ''}`}>
            <div className="app-stat-label">{item.label}</div>
            <div className="text-xl font-semibold text-slate-100 mt-1">{item.value}</div>
            <div className={`text-[11px] mt-0.5 ${item.sub.includes('cần xem lại') ? 'text-amber-400' : 'text-slate-500'}`}>{item.sub}</div>
          </div>
        ))}
        <div className="px-4 py-3.5 lg:border-l border-slate-800/80">
          <div className="app-stat-label">Tự buff bài app đăng</div>
          <div className="mt-1.5">
            <Badge status={autoBuffOwnPosts ? 'success' : 'default'} text={<span className="text-sm font-semibold text-slate-100">{autoBuffOwnPosts ? 'Đang bật' : 'Đang tắt'}</span>} />
          </div>
          <Button type="link" size="small" className="!p-0 !h-auto text-[11px]" onClick={onOpenSettings}>
            Cài đặt
          </Button>
        </div>
      </div>

      {/* Danh sách mục tiêu */}
      <div className="app-surface overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-b border-slate-800/80">
          <Segmented<MonitorFilter>
            size="small"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'ALL', label: `Tất cả (${monitors.length})` },
              { value: 'ACTIVE', label: `Đang chạy (${stats.active})` },
              { value: 'PAUSED', label: `Tạm dừng (${monitors.length - stats.active})` },
              { value: 'ATTENTION', label: `Cần xem lại (${stats.attention})` },
            ]}
          />
          <Input
            allowClear
            size="small"
            prefix={<SearchOutlined className="text-slate-500" />}
            placeholder="Tìm theo tên hoặc link"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="md:w-64"
          />
        </div>
        <Table<HunterMonitor>
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={filteredMonitors}
          tableLayout="fixed"
          pagination={filteredMonitors.length > 10 ? { pageSize: 10, showTotal: (t) => `${t} mục tiêu` } : false}
          locale={{
            emptyText:
              monitors.length === 0 ? (
                <div className="py-10">
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={<span className="text-slate-400 text-xs">Chưa theo dõi Fanpage hay Group nào</span>}
                  >
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => onAdd()}>
                      Thêm mục tiêu
                    </Button>
                  </Empty>
                </div>
              ) : (
                <div className="py-8 text-xs text-slate-400">Không có mục tiêu phù hợp bộ lọc</div>
              ),
          }}
        />
      </div>

      {/* Bài bắt gần đây */}
      <div className="app-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80">
          <div className="text-[13px] font-semibold text-slate-100">Bài bắt gần đây</div>
          <Button type="link" size="small" className="!p-0" onClick={onOpenQueue}>
            Mở hàng đợi
          </Button>
        </div>
        {recentCatches.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-500">
            Chưa có bài nào. Bài mới từ các mục tiêu và bài app vừa đăng sẽ hiện ở đây.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/70">
            {recentCatches.map((task) => (
              <div key={task.id} className="px-4 py-2.5 grid grid-cols-12 items-center gap-3 text-xs">
                <div className="col-span-2 text-slate-400">{formatAgo(task.addedAt, now)}</div>
                <div className="col-span-3 text-slate-200 truncate">
                  {task.source === 'AUTO_OWN_POST'
                    ? `Bài app đăng${task.topic === 'GROUP' ? ' · Group' : task.topic === 'FANPAGE' ? ' · Fanpage' : ''}`
                    : task.monitorName || 'Post Hunter'}
                </div>
                <div className="col-span-4 min-w-0">
                  <a href={task.targetUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-blue-400 hover:underline">
                    {shortUrl(task.targetUrl || '')}
                  </a>
                </div>
                <div className="col-span-2">{renderTaskStatus(task)}</div>
                <div className="col-span-1 text-right text-slate-300">
                  {task.result ? `${task.result.success}/${task.result.total}` : '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quét thử link */}
      <Modal
        open={testOpen}
        onCancel={() => setTestOpen(false)}
        title="Quét thử link"
        footer={null}
        width={720}
        className="dark-modal"
        destroyOnHidden
      >
        <p className="text-xs text-slate-400 mb-3">
          Đọc các bài mới nhất của một Fanpage hoặc Group bằng via đang sống. Chỉ đọc, không tương tác.
        </p>
        <div className="flex gap-2">
          <Input
            autoFocus
            allowClear
            placeholder="https://www.facebook.com/groups/... hoặc link Fanpage"
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
            onPressEnter={runTestScan}
          />
          <Button type="primary" loading={testLoading} onClick={runTestScan}>
            Quét thử
          </Button>
        </div>

        {testLoading && <div className="text-xs text-slate-400 mt-3">Đang mở Facebook bằng via, thường mất 15–40 giây...</div>}

        {testResult && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span>
                Thấy {testResult.posts.length} bài{testResult.scanVia ? ` · quét bằng ${testResult.scanVia}` : ''}
              </span>
              {testResult.posts.length > 0 && (
                <Button
                  size="small"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setTestOpen(false);
                    onAdd(testUrl.trim());
                  }}
                >
                  Theo dõi link này
                </Button>
              )}
            </div>
            {testResult.posts.length === 0 ? (
              <div className="text-xs text-amber-400 py-3">
                Không đọc được bài nào. Kiểm tra link, hoặc via có phải thành viên Group không.
              </div>
            ) : (
              <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/70 max-h-72 overflow-y-auto">
                {testResult.posts.map((p: any, idx: number) => (
                  <div key={p.url || idx} className="px-3 py-2 flex items-center gap-3 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="text-slate-200 truncate">{(p.title || 'Bài viết Facebook').split('\n')[0]}</div>
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[11px] text-blue-400 hover:underline">
                        {shortUrl(p.url)}
                      </a>
                    </div>
                    <div className="shrink-0 w-28">
                      {p.isAlreadyBuffed ? (
                        <Badge status="success" text={<span className="text-[11px] text-slate-300">Đã buff</span>} />
                      ) : p.isInQueue ? (
                        <Badge status="warning" text={<span className="text-[11px] text-slate-300">Trong hàng đợi</span>} />
                      ) : (
                        <Badge status="default" text={<span className="text-[11px] text-slate-300">Chưa buff</span>} />
                      )}
                    </div>
                    <Button
                      size="small"
                      onClick={() => {
                        setTestOpen(false);
                        onQueueUrl(p.url);
                      }}
                    >
                      Buff bài này
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
