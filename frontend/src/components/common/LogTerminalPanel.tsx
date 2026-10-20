import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Empty, Segmented, Spin, Switch, Tooltip, Alert } from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, PauseCircleOutlined, PlayCircleOutlined, WarningFilled,
} from '@ant-design/icons';
import api from '../../config/axios';

type LogLevel = 'ALL' | 'ERROR' | 'WARN' | 'INFO' | 'SUCCESS';

interface LogPayload {
  source: string;
  lines: string[];
  returned: number;
  fileSize: number;
  lastModified?: string;
}

const getLineLevel = (line: string): Exclude<LogLevel, 'ALL'> => {
  if (/(error|fatal|exception|failed|thất bại|❌)/i.test(line)) return 'ERROR';
  if (/(warn|warning|cảnh báo|⚠️)/i.test(line)) return 'WARN';
  if (/(success|hoàn tất|thành công|✅)/i.test(line)) return 'SUCCESS';
  return 'INFO';
};

interface LogTerminalPanelProps {
  source?: string;
  defaultLineLimit?: number;
  compact?: boolean;
}

const LogTerminalPanel = ({ source = 'worker', defaultLineLimit = 300, compact = true }: LogTerminalPanelProps) => {
  const [lineLimit] = useState(defaultLineLimit);
  const [level, setLevel] = useState<LogLevel>('ALL');
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isFetching, error, dataUpdatedAt } = useQuery({
    queryKey: ['system-logs', source, lineLimit],
    queryFn: async () => (await api.get('/system-logs', { params: { source, lines: lineLimit } })).data as LogPayload,
    refetchInterval: paused ? false : 2000,
    retry: 1,
  });

  const visibleLines = useMemo(() => (data?.lines || []).filter((line) => (
    level === 'ALL' || getLineLevel(line) === level
  )), [data?.lines, level]);

  const levelCounts = useMemo(() => (data?.lines || []).reduce<Record<string, number>>((acc, line) => {
    const key = getLineLevel(line);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {}), [data?.lines]);

  useEffect(() => {
    if (autoScroll && !paused) {
      requestAnimationFrame(() => terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: 'smooth' }));
    }
  }, [autoScroll, dataUpdatedAt, paused, visibleLines.length]);

  return (
    <div className="post-log-terminal-shell">
      <div className="post-log-toolbar">
        <Segmented<LogLevel>
          size="small"
          value={level}
          onChange={setLevel}
          options={[
            { value: 'ALL', label: `Tất cả ${data?.lines?.length || 0}` },
            { value: 'ERROR', label: <span className="logs-level-filter"><CloseCircleFilled style={{ color: '#ff5d73' }} /> {levelCounts.ERROR || 0}</span> },
            { value: 'WARN', label: <span className="logs-level-filter"><WarningFilled style={{ color: '#f5b942' }} /> {levelCounts.WARN || 0}</span> },
            { value: 'SUCCESS', label: <span className="logs-level-filter"><CheckCircleFilled style={{ color: '#35d07f' }} /> {levelCounts.SUCCESS || 0}</span> },
          ]}
        />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-slate-400"><Switch size="small" checked={autoScroll} onChange={setAutoScroll} /> Tự cuộn</label>
          <Tooltip title={paused ? 'Tiếp tục tự động cập nhật' : 'Tạm dừng tự động cập nhật'}>
            <Button size="small" type={paused ? 'primary' : 'default'} icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />} onClick={() => setPaused(!paused)} />
          </Tooltip>
        </div>
      </div>

      <div ref={terminalRef} className="post-log-terminal logs-terminal is-wrapped">
        {isLoading ? (
          <div className="logs-terminal-center"><Spin /><span>Đang đọc nhật ký...</span></div>
        ) : error ? (
          <div className="logs-terminal-center">
            <Alert type="error" showIcon message="Không thể đọc log" description="Backend chưa phản hồi." />
          </div>
        ) : visibleLines.length === 0 ? (
          <div className="logs-terminal-center"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={level !== 'ALL' ? 'Không có dòng log phù hợp bộ lọc' : 'Màn hình log đang trống'} /></div>
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
        <span><Badge status={paused ? 'warning' : 'processing'} /> {paused ? 'Đang tạm dừng' : `Tự động cập nhật mỗi 2 giây${isFetching ? '...' : ''}`}</span>
        {compact && <span>Hiển thị <b>{visibleLines.length}</b> / {data?.returned || 0} dòng</span>}
      </div>
    </div>
  );
};

export default LogTerminalPanel;
