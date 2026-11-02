import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Badge, Button, Dropdown, Empty, Input, Segmented, Select, Space, Spin, Switch, Tooltip, message,
  Card, Flex, Typography, Statistic, Tabs,
} from 'antd';
import {
  ArrowsAltOutlined, ClearOutlined, CloudDownloadOutlined, CopyOutlined, DownOutlined,
  CheckCircleFilled, CloseCircleFilled,
  FullscreenExitOutlined, PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined,
  SearchOutlined, VerticalAlignBottomOutlined, WarningFilled,
} from '@ant-design/icons';
import api from '../config/axios';

type LogLevel = 'ALL' | 'ERROR' | 'WARN' | 'INFO' | 'SUCCESS';

interface LogSource {
  id: string;
  name: string;
  description: string;
  exists: boolean;
  size: number;
  lastModified?: string;
}

interface LogPayload {
  source: string;
  lines: string[];
  returned: number;
  fileSize: number;
  lastModified?: string;
}

const fallbackSources: LogSource[] = [
  { id: 'worker', name: 'Worker', description: 'Playwright & tiến trình đăng bài', exists: true, size: 0 },
  { id: 'backend', name: 'Backend', description: 'Spring Boot API', exists: true, size: 0 },
  { id: 'frontend', name: 'Frontend', description: 'Vite development server', exists: true, size: 0 },
];

const getLineLevel = (line: string): Exclude<LogLevel, 'ALL'> => {
  if (/(error|fatal|exception|failed|thất bại|❌)/i.test(line)) return 'ERROR';
  if (/(warn|warning|cảnh báo|⚠️)/i.test(line)) return 'WARN';
  if (/(success|hoàn tất|thành công|✅)/i.test(line)) return 'SUCCESS';
  return 'INFO';
};

const formatBytes = (bytes = 0) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
};

const SystemLogs = () => {
  const [searchParams] = useSearchParams();
  const requestedLevel = searchParams.get('level') as LogLevel | null;
  const requestedLines = Number(searchParams.get('lines'));
  const [source, setSource] = useState(searchParams.get('source') || 'worker');
  const [lineLimit, setLineLimit] = useState(Number.isFinite(requestedLines) && requestedLines > 0 ? Math.min(5000, requestedLines) : 500);
  const [level, setLevel] = useState<LogLevel>(requestedLevel && ['ALL', 'ERROR', 'WARN', 'INFO', 'SUCCESS'].includes(requestedLevel) ? requestedLevel : 'ALL');
  const [query, setQuery] = useState(searchParams.get('query') || '');
  const [paused, setPaused] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [clearedAt, setClearedAt] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: sourceData } = useQuery({
    queryKey: ['system-log-sources'],
    queryFn: async () => (await api.get('/system-logs/sources')).data as LogSource[],
    retry: 1,
  });
  const sources = sourceData?.length ? sourceData : fallbackSources;

  const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['system-logs', source, lineLimit],
    queryFn: async () => (await api.get('/system-logs', { params: { source, lines: lineLimit } })).data as LogPayload,
    refetchInterval: paused ? false : 2000,
    retry: 1,
  });

  const visibleLines = useMemo(() => {
    if (clearedAt && dataUpdatedAt <= clearedAt) return [];
    const keyword = query.trim().toLocaleLowerCase('vi');
    return (data?.lines || []).filter((line) => {
      const matchesLevel = level === 'ALL' || getLineLevel(line) === level;
      const matchesSearch = !keyword || line.toLocaleLowerCase('vi').includes(keyword);
      return matchesLevel && matchesSearch;
    });
  }, [clearedAt, data?.lines, dataUpdatedAt, level, query]);

  const activeSource = sources.find((item) => item.id === source);
  const levelCounts = useMemo(() => (data?.lines || []).reduce<Record<string, number>>((acc, line) => {
    const key = getLineLevel(line);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {}), [data?.lines]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: 'smooth' }));
  };

  useEffect(() => {
    if (autoScroll && !paused) scrollToBottom();
  }, [autoScroll, dataUpdatedAt, paused, visibleLines.length]);

  useEffect(() => {
    const onFullscreen = () => setIsFullscreen(document.fullscreenElement === panelRef.current);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(visibleLines.join('\n'));
      message.success(`Đã sao chép ${visibleLines.length} dòng log`);
    } catch {
      message.error('Trình duyệt không cho phép sao chép tự động');
    }
  };

  const downloadLogs = async () => {
    try {
      const response = await api.get('/system-logs/download', { params: { source }, responseType: 'blob' });
      const href = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `${source}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`;
      anchor.click();
      URL.revokeObjectURL(href);
    } catch {
      message.error('Không thể tải file log lúc này');
    }
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await panelRef.current?.requestFullscreen();
  };

  const sourceItems = sources.map((item) => ({
    key: item.id,
    disabled: !item.exists,
    label: (
      <div className="min-w-56 py-1">
        <div className="flex items-center justify-between gap-4"><b>{item.name}</b><span className="text-xs text-slate-500">{formatBytes(item.size)}</span></div>
        <div className="text-xs text-slate-500 mt-1">{item.exists ? item.description : 'Chưa tìm thấy file log'}</div>
      </div>
    ),
  }));

  return (
    <div className="logs-page app-page" ref={panelRef}>
      <Card variant="borderless" className="!mb-4">
        <Flex justify="space-between" align="center" wrap="wrap" gap="middle">
          <div>
            <div className="logs-eyebrow mb-1"><span className="logs-live-dot" /> LIVE SYSTEM CONSOLE</div>
            <Typography.Title level={4} className="!mb-1 !text-slate-100">Nhật ký hệ thống</Typography.Title>
            <Typography.Text className="text-xs text-slate-400">Theo dõi tiến trình đăng bài và chẩn đoán lỗi ngay trên trang tổng quan.</Typography.Text>
          </div>
          <Flex wrap="wrap" gap="middle" align="center">
            <Card variant="borderless" size="small" styles={{ body: { padding: '8px 16px' } }}>
              <Statistic
                title={<span className="text-[11px] text-slate-400">Trạng thái</span>}
                valueRender={() => (
                  <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5 mt-0.5">
                    <Badge status={paused ? 'warning' : 'processing'} />
                    {paused ? 'Đã tạm dừng' : 'Đang theo dõi'}
                  </span>
                )}
              />
            </Card>
            <Card variant="borderless" size="small" styles={{ body: { padding: '8px 16px' } }}>
              <Statistic
                title={<span className="text-[11px] text-slate-400">Dung lượng</span>}
                value={formatBytes(data?.fileSize || activeSource?.size)}
                valueStyle={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}
              />
            </Card>
            <Card variant="borderless" size="small" styles={{ body: { padding: '8px 16px' } }}>
              <Statistic
                title={<span className="text-[11px] text-slate-400">Cập nhật</span>}
                value={dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('vi-VN') : '—'}
                valueStyle={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}
              />
            </Card>
          </Flex>
        </Flex>
      </Card>

      <Card variant="borderless" className="!mb-4" styles={{ body: { padding: '6px 16px 2px 16px' } }}>
        <Tabs
          activeKey={source}
          onChange={(key) => { setSource(key); setClearedAt(null); }}
          items={sources.map((item) => ({
            key: item.id,
            disabled: !item.exists,
            label: (
              <span className="flex items-center gap-2 py-0.5">
                <span className="font-semibold text-xs">{item.name}</span>
                <span className="text-[11px] text-slate-400 hidden sm:inline">({item.description})</span>
                <Badge status={item.exists ? (source === item.id ? 'processing' : 'success') : 'default'} />
              </span>
            ),
          }))}
        />
      </Card>

      <section className="logs-console-card">
        <div className="logs-toolbar">
          <div className="logs-toolbar-group">
            <Dropdown menu={{ items: sourceItems, onClick: ({ key }) => { setSource(key); setClearedAt(null); } }} trigger={['click']}>
              <Button><span className="logs-file-mark" /> {activeSource?.name || 'Chọn nguồn'} <DownOutlined /></Button>
            </Dropdown>
            <Select value={lineLimit} onChange={setLineLimit} aria-label="Số dòng log" options={[100, 250, 500, 1000, 2000, 5000].map(value => ({ value, label: `${value.toLocaleString('vi-VN')} dòng` }))} />
            <Segmented<LogLevel>
              value={level}
              onChange={setLevel}
              options={[
                { value: 'ALL', label: `Tất cả ${data?.lines?.length || 0}` },
                {
                  value: 'ERROR',
                  label: <span className="logs-level-filter"><CloseCircleFilled style={{ color: '#ff5d73' }} /> Lỗi {levelCounts.ERROR || 0}</span>,
                },
                {
                  value: 'WARN',
                  label: <span className="logs-level-filter"><WarningFilled style={{ color: '#f5b942' }} /> Cảnh báo {levelCounts.WARN || 0}</span>,
                },
                {
                  value: 'SUCCESS',
                  label: <span className="logs-level-filter"><CheckCircleFilled style={{ color: '#35d07f' }} /> Thành công {levelCounts.SUCCESS || 0}</span>,
                },
              ]}
            />
          </div>
          <div className="logs-toolbar-group logs-toolbar-actions">
            <Input allowClear value={query} onChange={(event) => setQuery(event.target.value)} prefix={<SearchOutlined />} placeholder="Tìm trong log..." className="logs-search" />
            <Tooltip title={paused ? 'Tiếp tục tự động cập nhật' : 'Tạm dừng tự động cập nhật'}>
              <Button type={paused ? 'primary' : 'default'} icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />} onClick={() => setPaused(!paused)}>{paused ? 'Tiếp tục' : 'Tạm dừng'}</Button>
            </Tooltip>
            <Tooltip title="Lấy dữ liệu mới"><Button icon={<ReloadOutlined spin={isFetching} />} onClick={() => { setClearedAt(null); refetch(); }} aria-label="Làm mới" /></Tooltip>
            <Tooltip title="Thêm thao tác">
              <Dropdown trigger={['click']} menu={{ items: [
                { key: 'copy', icon: <CopyOutlined />, label: 'Sao chép log đang hiển thị', onClick: copyLogs },
                { key: 'download', icon: <CloudDownloadOutlined />, label: 'Tải file log đầy đủ', onClick: downloadLogs },
                { type: 'divider' },
                { key: 'clear', icon: <ClearOutlined />, label: 'Xóa màn hình hiện tại', onClick: () => setClearedAt(Date.now()) },
              ] }}><Button>Thao tác <DownOutlined /></Button></Dropdown>
            </Tooltip>
          </div>
        </div>

        <div className="logs-terminal-shell">
          <div className="logs-terminal-topbar">
            <div className="logs-window-dots"><i /><i /><i /></div>
            <div className="logs-terminal-path"><span>phusocial</span> / logs / <b>{source}.log</b></div>
            <Space size={12} className="logs-terminal-options">
              <label><Switch size="small" checked={wrap} onChange={setWrap} /> Xuống dòng</label>
              <label><Switch size="small" checked={autoScroll} onChange={setAutoScroll} /> Tự cuộn</label>
              <Tooltip title={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}><Button type="text" size="small" icon={isFullscreen ? <FullscreenExitOutlined /> : <ArrowsAltOutlined />} onClick={toggleFullscreen} /></Tooltip>
            </Space>
          </div>

          <div ref={terminalRef} className={`logs-terminal ${wrap ? 'is-wrapped' : ''}`}>
            {isLoading ? <div className="logs-terminal-center"><Spin /><span>Đang đọc nhật ký...</span></div> : error ? (
              <div className="logs-terminal-center"><Alert type="error" showIcon message="Không thể đọc log" description="Backend chưa phản hồi. Hãy kiểm tra dịch vụ API rồi thử lại." action={<Button size="small" onClick={() => refetch()}>Thử lại</Button>} /></div>
            ) : visibleLines.length === 0 ? (
              <div className="logs-terminal-center"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query || level !== 'ALL' ? 'Không có dòng log phù hợp bộ lọc' : 'Màn hình log đang trống'} /></div>
            ) : visibleLines.map((line, index) => {
              const lineLevel = getLineLevel(line);
              return (
                <div className={`logs-line logs-line-${lineLevel.toLowerCase()}`} key={`${index}-${line}`}>
                  <span className="logs-line-number">{index + 1}</span>
                  <span className="logs-line-level">{lineLevel}</span>
                  <code>{line || ' '}</code>
                </div>
              );
            })}
          </div>

          <div className="logs-footerbar">
            <span><Badge status={paused ? 'warning' : 'processing'} /> {paused ? 'Luồng cập nhật đang tạm dừng' : 'Tự động cập nhật mỗi 2 giây'}</span>
            <span>Hiển thị <b>{visibleLines.length}</b> / {data?.returned || 0} dòng</span>
            <Button type="text" size="small" icon={<VerticalAlignBottomOutlined />} onClick={scrollToBottom}>Cuối log</Button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default SystemLogs;
