import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from 'antd';
import { CodeOutlined, DownOutlined, RightOutlined } from '@ant-design/icons';
import LogTerminalPanel from './LogTerminalPanel';

interface PostStoryLogPanelProps {
  isProcessing?: boolean;
}

const PostStoryLogPanel = ({ isProcessing = false }: PostStoryLogPanelProps) => {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (isProcessing) setExpanded(true);
  }, [isProcessing]);

  return (
    <div className="post-log-card">
      <div className="post-log-header" onClick={() => setExpanded((prev) => !prev)}>
        <div className="flex items-center gap-2 min-w-0">
          <CodeOutlined className="text-purple-400" />
          <span className="font-semibold text-slate-200 text-xs">Nhật ký Worker (thời gian thực)</span>
          <Badge status={isProcessing ? 'processing' : 'default'} text={<span className="text-[10px] text-slate-400">{isProcessing ? 'Đang xử lý' : 'Sẵn sàng'}</span>} />
        </div>
        <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Link to="/dashboard/logs?source=worker" className="text-[11px] text-purple-400 hover:text-purple-300">
            Xem đầy đủ tại Nhật ký hệ thống →
          </Link>
          <span onClick={() => setExpanded((prev) => !prev)} className="cursor-pointer text-slate-400 text-xs">
            {expanded ? <DownOutlined /> : <RightOutlined />}
          </span>
        </div>
      </div>

      {expanded && <LogTerminalPanel source="worker" compact />}
    </div>
  );
};

export default PostStoryLogPanel;
