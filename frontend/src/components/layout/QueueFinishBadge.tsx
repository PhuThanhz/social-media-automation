import { useEffect, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { FieldTimeOutlined, SyncOutlined, CheckCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';
import ScheduleSettingsDrawer from '../common/ScheduleSettingsDrawer';
import { formatWhen, onOpenScheduleSettings, usePostingPlan } from '../common/postingSchedule';

/**
 * Ô "Hàng đợi" trên thanh trên cùng (mọi trang): còn bao nhiêu bài chờ, xong lúc mấy giờ.
 * Bấm vào mở "Lịch đăng" — chỗ duy nhất cài khung giờ, giãn cách và giới hạn mỗi nick.
 */
export default function QueueFinishBadge() {
  const [open, setOpen] = useState(false);
  const { data: plan } = usePostingPlan();

  useEffect(() => onOpenScheduleSettings(() => setOpen(true)), []);

  const queue = plan?.queue;
  const late = (queue?.laterCount || 0) > 0;
  const deferred = plan?.enabled ? plan.totalDeferred || 0 : 0;
  const isProcessing = (queue?.processing || 0) > 0;
  const hasPending = (queue?.totalPending || 0) > 0;

  const label = !queue
    ? 'Lịch đăng'
    : !hasPending
      ? (isProcessing ? `Đang đăng ${queue.processing} bài` : 'Hàng đợi trống')
      : `Hàng đợi ${queue.totalPending} · xong ${formatWhen(queue.finishAllAt)}`;
  const windowText = plan?.enabled ? `Khung giờ đăng ${plan.start}–${plan.end}` : 'Khung giờ đăng đang tắt';

  const badgeIcon = isProcessing ? (
    <SyncOutlined spin className="text-amber-400" />
  ) : hasPending ? (
    <ClockCircleOutlined className="text-cyan-400" />
  ) : (
    <CheckCircleOutlined className="text-emerald-400" />
  );

  return (
    <>
      <Tooltip title={`${windowText} · bấm để cài đặt lịch đăng`} placement="bottomRight">
        <Button
          type="text"
          className={`queue-finish-badge${late || deferred > 0 ? ' is-late' : ''}${isProcessing ? ' border-amber-500/40 bg-amber-500/10' : ''}`}
          icon={badgeIcon}
          onClick={() => setOpen(true)}
        >
          <span className="qfb-label-full">{label}</span>
          <span className="qfb-label-short">
            {isProcessing ? '⚡' : (queue?.totalPending ?? '')}
          </span>
        </Button>
      </Tooltip>
      <ScheduleSettingsDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
