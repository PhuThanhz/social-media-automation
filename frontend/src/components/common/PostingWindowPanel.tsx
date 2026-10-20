import { useEffect, useState } from 'react';
import { Alert, Button, InputNumber, Popconfirm, Switch, Table, TimePicker, Tooltip, message } from 'antd';
import { ClockCircleOutlined, FieldTimeOutlined, SwapOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import api from '../../config/axios';

type PostingWindow = { enabled: boolean; start: string; end: string; minGapSeconds: number };

type WindowSuggestion = { toTargetFanpageId: string; toName: string; postIds: number[] };

type WindowLane = {
  laneName: string;
  deferredCount: number;
  firstDeferredAt: string | null;
  suggestions: WindowSuggestion[];
  unassignedCount: number;
  extraViasNeeded: number;
};

export type QueueLane = {
  name: string;
  pending: number;
  nextAt: string | null;
  finishAt: string;
  finishTodayCount: number;
  deferredCount: number;
};

export type QueueSummary = {
  totalPending: number;
  processing: number;
  finishAllAt: string | null;
  finishTodayCount: number;
  laterCount: number;
  lanes: QueueLane[];
};

export type WindowPlan = PostingWindow & { lanes: WindowLane[]; totalDeferred: number; queue?: QueueSummary };

// "21:45 hôm nay" / "09:30 ngày mai" / "09:30 18/10"
export const formatWhen = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const t = dayjs(iso);
  const today = dayjs().startOf('day');
  if (t.isSame(today, 'day')) return `${t.format('HH:mm')} hôm nay`;
  if (t.isSame(today.add(1, 'day'), 'day')) return `${t.format('HH:mm')} ngày mai`;
  return t.format('HH:mm DD/MM');
};

export const POSTING_WINDOW_QUERY_KEY = ['postingWindowPlan'];

/**
 * Khung giờ đăng chung cho toàn bộ hàng đợi: ngoài khung không tự đăng theo lịch, bài nối đuôi chỉ
 * xếp trong khung. Nick nào không kịp đăng hết trong ngày → hiện đề xuất chuyển bài sang nick khác
 * (người dùng bấm Duyệt mới chuyển).
 */
export default function PostingWindowPanel() {
  const queryClient = useQueryClient();
  const { data: plan } = useQuery<WindowPlan>({
    queryKey: POSTING_WINDOW_QUERY_KEY,
    queryFn: async () => (await api.get('/queue/window-plan')).data,
    refetchInterval: 30000,
  });

  const [enabled, setEnabled] = useState(false);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs('08:00', 'HH:mm'), dayjs('23:00', 'HH:mm')]);
  const [minGapMinutes, setMinGapMinutes] = useState(2);
  const [dirty, setDirty] = useState(false);
  const [showLanes, setShowLanes] = useState(false);
  const [isPacking, setIsPacking] = useState(false);

  useEffect(() => {
    if (!plan || dirty) return;
    setEnabled(plan.enabled);
    setRange([dayjs(plan.start, 'HH:mm'), dayjs(plan.end, 'HH:mm')]);
    setMinGapMinutes(Math.max(1, Math.round((plan.minGapSeconds || 120) / 60)));
  }, [plan, dirty]);

  const refreshQueue = () => {
    queryClient.invalidateQueries({ queryKey: POSTING_WINDOW_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => (await api.put('/queue/posting-window', {
      enabled,
      start: range[0].format('HH:mm'),
      end: range[1].format('HH:mm'),
      minGapSeconds: minGapMinutes * 60,
    })).data,
    onSuccess: (data: any) => {
      setDirty(false);
      if (!data?.enabled) {
        message.success('Đã tắt khung giờ đăng — bài đến giờ là đăng như trước.');
      } else {
        const moved = Number(data?.movedIntoWindow) || 0;
        const deferred = Number(data?.deferredCount) || 0;
        message.success(
          `Đã lưu khung giờ ${data.start}–${data.end} (giãn ${minGapMinutes} phút/bài).`
          + (moved > 0 ? ` Dời ${moved} bài vào trong khung.` : '')
          + (deferred > 0 ? ` ${deferred} bài không kịp hôm nay.` : ' Tất cả bài đã sẵn sàng trong hôm nay!'),
          6,
        );
      }
      refreshQueue();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Không lưu được khung giờ đăng'),
  });

  const handlePackNow = async () => {
    setIsPacking(true);
    try {
      await api.put('/queue/posting-window', {
        enabled: true,
        start: range[0].format('HH:mm'),
        end: range[1].format('HH:mm'),
        minGapSeconds: minGapMinutes * 60,
      });
      const res = await api.post('/queue/pack-continuous', { gapSeconds: Math.round(minGapMinutes * 60) });
      const finish = res.data?.estimatedFinishAt ? dayjs(res.data.estimatedFinishAt).format('HH:mm DD/MM') : '';
      const deferred = Number(res.data?.deferredCount) || 0;
      message.success(
        `⚡ Đã phân bổ lại ${res.data?.updated ?? 0} bài chờ (giãn ${minGapMinutes}'/bài)${finish ? `, dự kiến xong lúc ${finish}` : ''}`
        + (deferred > 0 ? `. ${deferred} bài không kịp, dời sang hôm sau.` : ' · Tất cả xong hôm nay!'),
        6
      );
      setDirty(false);
      refreshQueue();
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Không thể dồn hàng đợi');
    } finally {
      setIsPacking(false);
    }
  };

  const applyMutation = useMutation({
    mutationFn: async (s: WindowSuggestion) => (await api.post('/queue/window-plan/apply', {
      postIds: s.postIds,
      toTargetFanpageId: s.toTargetFanpageId,
    })).data,
    onSuccess: (data: any, s) => {
      const finish = data?.estimatedFinishAt ? dayjs(data.estimatedFinishAt).format('HH:mm DD/MM') : '';
      const stillDeferred = Number(data?.deferredCount) || 0;
      message.success(
        `Đã chuyển ${data?.moved ?? 0} bài sang ${s.toName}${finish ? `, dự kiến xong lúc ${finish}` : ''}.`
        + (stillDeferred > 0 ? ` ${stillDeferred} bài vẫn không kịp hôm nay.` : ''),
        6,
      );
      refreshQueue();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Không chuyển được bài'),
  });

  const lanes = plan?.enabled ? plan.lanes || [] : [];
  const queue = plan?.queue;

  return (
    <div className="app-surface posting-window-panel">
      <div className="posting-window-row">
        <div className="posting-window-title">
          <ClockCircleOutlined />
          <span>Khung giờ đăng</span>
        </div>
        <Switch
          size="small"
          checked={enabled}
          onChange={(v) => { setEnabled(v); setDirty(true); }}
        />
        <TimePicker.RangePicker
          size="small"
          format="HH:mm"
          minuteStep={5}
          allowClear={false}
          disabled={!enabled}
          value={range}
          onChange={(vals) => {
            if (vals && vals[0] && vals[1]) { setRange([vals[0], vals[1]]); setDirty(true); }
          }}
        />
        <Tooltip title="Khi một nick có nhiều bài, giãn cách giữa 2 bài được rút dần (không dưới mức này) để đăng xong trước giờ kết thúc">
          <InputNumber
            size="small"
            min={1}
            max={60}
            disabled={!enabled}
            value={minGapMinutes}
            onChange={(v) => { setMinGapMinutes(typeof v === 'number' ? v : 2); setDirty(true); }}
            addonBefore="Giãn tối thiểu"
            addonAfter="phút"
            style={{ width: 190 }}
          />
        </Tooltip>
        <Button
          size="small"
          type="primary"
          disabled={!enabled}
          loading={saveMutation.isPending}
          onClick={() => {
            if (!range[1].isAfter(range[0])) {
              message.warning('Giờ kết thúc phải sau giờ bắt đầu');
              return;
            }
            saveMutation.mutate();
          }}
        >
          Lưu
        </Button>
        <Popconfirm
          title="Phân bổ lại toàn bộ hàng đợi ngay?"
          description={`Toàn bộ ${queue?.totalPending || 0} bài chờ sẽ được xếp nối tiếp nhau từ bây giờ (nghỉ ${minGapMinutes} phút/bài) trong khung giờ ${range[0].format('HH:mm')} - ${range[1].format('HH:mm')}.`}
          onConfirm={handlePackNow}
          okText="Phân bổ ngay"
          cancelText="Hủy"
        >
          <Button
            size="small"
            icon={<ThunderboltOutlined className="text-amber-300" />}
            loading={isPacking}
            disabled={!enabled || (queue?.totalPending || 0) === 0}
            className="bg-amber-600/30 hover:bg-amber-600/40 text-amber-200 border-amber-500/50 font-bold"
          >
            ⚡ Phân bổ ngay ({queue?.totalPending || 0} bài)
          </Button>
        </Popconfirm>
        <span className="posting-window-hint">
          {enabled
            ? `Ngoài ${range[0].format('HH:mm')}–${range[1].format('HH:mm')} không tự đăng theo lịch; bấm "Đăng ngay" vẫn đăng ngay.`
            : 'Đang tắt: bài đến giờ hẹn là đăng, kể cả ban đêm.'}
        </span>
      </div>

      {queue && (
        <div className="posting-window-queue">
          <div className="posting-window-queue-line">
            <FieldTimeOutlined />
            {queue.totalPending === 0 ? (
              <span>Hàng đợi trống{queue.processing > 0 ? ` · ${queue.processing} bài đang đăng` : ''}.</span>
            ) : (
              <span>
                <b>{queue.totalPending}</b> bài đang chờ{queue.processing > 0 ? ` (${queue.processing} bài đang đăng)` : ''}
                {' · '}dự kiến đăng xong hết lúc <b>{formatWhen(queue.finishAllAt)}</b>
                {queue.laterCount > 0
                  ? ` · ${queue.finishTodayCount} bài xong trong hôm nay, ${queue.laterCount} bài sang ngày sau`
                  : ' · tất cả xong trong hôm nay'}
              </span>
            )}
            {queue.lanes.length > 0 && (
              <Button size="small" type="link" onClick={() => setShowLanes((v) => !v)}>
                {showLanes ? 'Ẩn theo nick' : `Xem theo nick (${queue.lanes.length})`}
              </Button>
            )}
          </div>
          {showLanes && queue.lanes.length > 0 && (
            <Table<QueueLane>
              size="small"
              className="posting-window-queue-table"
              pagination={false}
              rowKey={(r) => r.name + r.finishAt}
              dataSource={queue.lanes}
              columns={[
                { title: 'Nick đăng', dataIndex: 'name', key: 'name' },
                { title: 'Bài chờ', dataIndex: 'pending', key: 'pending', width: 90, align: 'right' },
                { title: 'Bài tiếp theo', dataIndex: 'nextAt', key: 'nextAt', width: 150, render: (v: string | null) => formatWhen(v) },
                {
                  title: 'Xong hết lúc',
                  dataIndex: 'finishAt',
                  key: 'finishAt',
                  width: 150,
                  render: (v: string, r) => (
                    <span className={r.finishTodayCount < r.pending ? 'posting-window-late' : ''}>{formatWhen(v)}</span>
                  ),
                },
                {
                  title: 'Sang ngày sau',
                  key: 'later',
                  width: 120,
                  align: 'right',
                  render: (_: unknown, r) => (r.pending - r.finishTodayCount > 0 ? r.pending - r.finishTodayCount : '—'),
                },
              ]}
            />
          )}
        </div>
      )}

      {lanes.length > 0 && (
        <Alert
          type="warning"
          showIcon
          className="posting-window-alert"
          message={`${plan?.totalDeferred ?? 0} bài không kịp đăng trong khung giờ hôm nay, đang tạm dời sang ${plan?.start} hôm sau`}
          description={(
            <div className="posting-window-lanes">
              {lanes.map((lane) => (
                <div key={lane.laneName + lane.firstDeferredAt} className="posting-window-lane">
                  <div className="posting-window-lane-head">
                    <strong>{lane.laneName}</strong>
                    <span>
                      dư {lane.deferredCount} bài
                      {lane.firstDeferredAt ? ` · đang hẹn từ ${dayjs(lane.firstDeferredAt).format('HH:mm DD/MM')}` : ''}
                    </span>
                  </div>
                  {lane.suggestions.map((s) => (
                    <div key={s.toTargetFanpageId} className="posting-window-suggestion">
                      <SwapOutlined />
                      <span>Chuyển {s.postIds.length} bài sang <b>{s.toName}</b> (còn trống trong khung hôm nay, có quyền đăng chỗ này)</span>
                      <Popconfirm
                        title={`Chuyển ${s.postIds.length} bài sang ${s.toName}?`}
                        description="Các bài này sẽ đăng bằng nick mới thay cho nick cũ."
                        okText="Duyệt chuyển"
                        cancelText="Hủy"
                        onConfirm={() => applyMutation.mutate(s)}
                      >
                        <Button size="small" type="primary" loading={applyMutation.isPending && applyMutation.variables?.toTargetFanpageId === s.toTargetFanpageId}>
                          Duyệt
                        </Button>
                      </Popconfirm>
                    </div>
                  ))}
                  {lane.unassignedCount > 0 && (
                    <div className="posting-window-suggestion is-muted">
                      <span>
                        {lane.unassignedCount} bài chưa có nick nào rảnh và có quyền đăng chỗ này
                        {lane.extraViasNeeded > 0 ? ` — cần thêm ${lane.extraViasNeeded} via vào nhóm/Fanpage này để đăng hết trong hôm nay` : ''}.
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        />
      )}
    </div>
  );
}
