import { Button, Popover, Table } from 'antd';
import { FieldTimeOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../../config/axios';
import { POSTING_WINDOW_QUERY_KEY, formatWhen, type QueueLane, type WindowPlan } from '../common/PostingWindowPanel';

/**
 * Ô "Hàng đợi" trên thanh trên cùng: ở trang nào cũng thấy còn bao nhiêu bài chờ và dự kiến đăng xong
 * hết lúc mấy giờ. Bấm vào xem theo từng nick. Dùng chung dữ liệu với mục Khung giờ đăng.
 */
export default function QueueFinishBadge() {
  const navigate = useNavigate();
  const { data: plan } = useQuery<WindowPlan>({
    queryKey: POSTING_WINDOW_QUERY_KEY,
    queryFn: async () => (await api.get('/queue/window-plan')).data,
    refetchInterval: 30000,
  });
  const queue = plan?.queue;
  if (!queue) return null;

  const late = queue.laterCount > 0;
  const deferred = plan?.enabled ? plan.totalDeferred || 0 : 0;
  const label = queue.totalPending === 0
    ? (queue.processing > 0 ? `Đang đăng ${queue.processing}` : 'Hàng đợi trống')
    : `Hàng đợi ${queue.totalPending} · xong ${formatWhen(queue.finishAllAt)}`;

  const content = (
    <div className="queue-finish-popover">
      <div className="queue-finish-summary">
        {queue.totalPending === 0 ? (
          <span>Không còn bài nào đang chờ{queue.processing > 0 ? ` · ${queue.processing} bài đang đăng` : ''}.</span>
        ) : (
          <span>
            <b>{queue.totalPending}</b> bài đang chờ · đăng xong hết dự kiến <b>{formatWhen(queue.finishAllAt)}</b>
            {late ? ` · ${queue.laterCount} bài sang ngày sau` : ' · tất cả xong trong hôm nay'}
          </span>
        )}
        {plan?.enabled && (
          <span className="queue-finish-window">Khung giờ đăng {plan.start}–{plan.end}</span>
        )}
        {deferred > 0 && (
          <span className="queue-finish-warn">{deferred} bài không kịp trong khung giờ hôm nay — có đề xuất chuyển nick</span>
        )}
      </div>
      {queue.lanes.length > 0 && (
        <Table<QueueLane>
          size="small"
          pagination={false}
          rowKey={(r) => r.name + r.finishAt}
          dataSource={queue.lanes}
          scroll={queue.lanes.length > 8 ? { y: 300 } : undefined}
          columns={[
            { title: 'Nick đăng', dataIndex: 'name', key: 'name', ellipsis: true },
            { title: 'Chờ', dataIndex: 'pending', key: 'pending', width: 60, align: 'right' },
            {
              title: 'Xong lúc',
              dataIndex: 'finishAt',
              key: 'finishAt',
              width: 130,
              render: (v: string, r) => (
                <span className={r.finishTodayCount < r.pending ? 'posting-window-late' : ''}>{formatWhen(v)}</span>
              ),
            },
          ]}
        />
      )}
      <Button
        type="link"
        size="small"
        className="queue-finish-link"
        onClick={() => {
          localStorage.setItem('poster_workspace_tab', 'history');
          navigate('/dashboard/playwright?tab=history');
        }}
      >
        Mở Khung giờ đăng & hàng đợi
      </Button>
    </div>
  );

  return (
    <Popover content={content} trigger="click" placement="bottomRight" arrow={false}>
      <Button
        type="text"
        className={`queue-finish-badge${late || deferred > 0 ? ' is-late' : ''}`}
        icon={<FieldTimeOutlined />}
      >
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">{queue.totalPending}</span>
      </Button>
    </Popover>
  );
}
