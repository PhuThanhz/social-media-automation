import { useEffect, useState } from 'react';
import { App, Button, Checkbox, Drawer, InputNumber, Popconfirm, Switch, Table, TimePicker } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import api from '../../config/axios';
import QueuePowerPanel from './QueuePowerPanel';
import {
  POSTING_SETTINGS_QUERY_KEY,
  POSTING_WINDOW_QUERY_KEY,
  formatWhen,
  gapMinutesOf,
  usePostingPlan,
  usePostingSettings,
  type QueueLane,
  type WindowSuggestion,
} from './postingSchedule';

/**
 * Cài đặt lịch đăng — chỗ DUY NHẤT chỉnh thời gian đăng bài cho cả hệ thống.
 * Mở từ badge hàng đợi trên header (mọi trang) hoặc link "Cài đặt lịch" trong bộ chọn giờ.
 */
export default function ScheduleSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data: plan } = usePostingPlan();
  const { data: settings } = usePostingSettings();

  const [enabled, setEnabled] = useState(false);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs('08:00', 'HH:mm'), dayjs('22:00', 'HH:mm')]);
  const [gapMinutes, setGapMinutes] = useState(2);
  const [maxPerHour, setMaxPerHour] = useState(35);
  const [respreadExisting, setRespreadExisting] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!settings || dirty) return;
    setEnabled(settings.enabled);
    setRange([dayjs(settings.start, 'HH:mm'), dayjs(settings.end, 'HH:mm')]);
    setGapMinutes(gapMinutesOf(settings));
    setMaxPerHour(settings.maxPostsPerHourPerNick || 35);
  }, [settings, dirty]);

  useEffect(() => {
    if (!open) setDirty(false);
  }, [open]);

  const refreshQueue = () => {
    queryClient.invalidateQueries({ queryKey: POSTING_WINDOW_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: POSTING_SETTINGS_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ['postQueue'] });
    queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => (await api.put('/queue/posting-window', {
      enabled,
      start: range[0].format('HH:mm'),
      end: range[1].format('HH:mm'),
      minGapSeconds: gapMinutes * 60,
      maxPostsPerHourPerNick: maxPerHour,
      rescheduleExisting: enabled && respreadExisting,
    })).data,
    onSuccess: (data: any) => {
      setDirty(false);
      setRespreadExisting(false);
      const moved = Number(data?.movedIntoWindow) || 0;
      const deferred = Number(data?.deferredCount) || 0;
      message.success(
        'Đã lưu lịch đăng.'
        + (moved > 0 ? ` Xếp lại ${moved} bài đang chờ.` : '')
        + (deferred > 0 ? ` ${deferred} bài không kịp hôm nay.` : ''),
        5,
      );
      refreshQueue();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Không lưu được lịch đăng'),
  });

  const packMutation = useMutation({
    mutationFn: async () => (await api.post('/queue/pack-continuous', {})).data,
    onSuccess: (data: any) => {
      const deferred = Number(data?.deferredCount) || 0;
      message.success(
        `Đã xếp lại ${data?.updated ?? 0} bài, dự kiến xong ${formatWhen(data?.estimatedFinishAt)}.`
        + (deferred > 0 ? ` ${deferred} bài sang ngày sau.` : ''),
        6,
      );
      refreshQueue();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Không xếp lại được hàng đợi'),
  });

  const applyMutation = useMutation({
    mutationFn: async (s: WindowSuggestion) => (await api.post('/queue/window-plan/apply', {
      postIds: s.postIds,
      toTargetFanpageId: s.toTargetFanpageId,
    })).data,
    onSuccess: (data: any, s) => {
      message.success(`Đã chuyển ${data?.moved ?? 0} bài sang ${s.toName}.`);
      refreshQueue();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Không chuyển được bài'),
  });

  const queue = plan?.queue;
  const lanes = plan?.enabled ? plan.lanes || [] : [];
  const change = () => setDirty(true);

  return (
    <Drawer
      title="Lịch đăng"
      open={open}
      onClose={onClose}
      size={520}
      className="schedule-settings-drawer"
      destroyOnHidden
    >
      <section className="schedule-settings-section">
        <h4>Cài đặt chung</h4>
        <p className="schedule-settings-note">
          Áp dụng cho mọi bài chọn "Xếp vào lịch" ở tất cả các trang. Mỗi nick có một làn riêng, các nick chạy song song.
        </p>

        <div className="schedule-settings-field">
          <label>Khung giờ đăng</label>
          <div className="schedule-settings-control">
            <Switch checked={enabled} onChange={(v) => { setEnabled(v); change(); }} />
            <TimePicker.RangePicker
              format="HH:mm"
              minuteStep={5}
              allowClear={false}
              disabled={!enabled}
              value={range}
              onChange={(vals) => {
                if (vals && vals[0] && vals[1]) { setRange([vals[0], vals[1]]); change(); }
              }}
            />
          </div>
          <span className="schedule-settings-help">
            {enabled ? 'Ngoài khung không tự đăng. "Đăng ngay" vẫn đăng ngay.' : 'Đang tắt: đến giờ là đăng, kể cả ban đêm.'}
          </span>
        </div>

        <div className="schedule-settings-field">
          <label>Giãn cách giữa 2 bài cùng nick</label>
          <div className="schedule-settings-control">
            <InputNumber min={1} max={60} value={gapMinutes} onChange={(v) => { setGapMinutes(typeof v === 'number' ? v : 2); change(); }} suffix="phút" style={{ width: 120 }} />
          </div>
        </div>

        <div className="schedule-settings-field">
          <label>Tối đa mỗi nick</label>
          <div className="schedule-settings-control">
            <InputNumber min={1} max={200} value={maxPerHour} onChange={(v) => { setMaxPerHour(typeof v === 'number' ? v : 35); change(); }} suffix="bài/giờ" style={{ width: 140 }} />
          </div>
          <span className="schedule-settings-help">Vượt mức này nick tạm nghỉ để tránh bị Facebook chặn spam.</span>
        </div>

        {enabled && (
          <Checkbox checked={respreadExisting} onChange={(e) => { setRespreadExisting(e.target.checked); change(); }}>
            Rải lại các bài đang chờ theo cài đặt mới
          </Checkbox>
        )}

        <div className="schedule-settings-actions">
          <Button
            type="primary"
            disabled={!dirty}
            loading={saveMutation.isPending}
            onClick={() => {
              if (enabled && !range[1].isAfter(range[0])) {
                message.warning('Giờ kết thúc phải sau giờ bắt đầu');
                return;
              }
              saveMutation.mutate();
            }}
          >
            Lưu cài đặt
          </Button>
        </div>
      </section>

      {queue && (
        <section className="schedule-settings-section">
          <h4>Hàng đợi</h4>
          <p className="schedule-settings-note">
            {queue.totalPending === 0
              ? `Không còn bài nào đang chờ${queue.processing > 0 ? ` · ${queue.processing} bài đang đăng` : ''}.`
              : `${queue.totalPending} bài đang chờ · xong hết ${formatWhen(queue.finishAllAt)}`
                + (queue.laterCount > 0 ? ` · ${queue.laterCount} bài sang ngày sau` : ' · tất cả xong trong hôm nay')}
          </p>
          {queue.lanes.length > 0 && (
            <Table<QueueLane>
              size="small"
              pagination={false}
              rowKey={(r) => r.name + r.finishAt}
              dataSource={queue.lanes}
              scroll={queue.lanes.length > 8 ? { y: 280 } : undefined}
              columns={[
                { title: 'Nick', dataIndex: 'name', key: 'name', ellipsis: true },
                { title: 'Chờ', dataIndex: 'pending', key: 'pending', width: 56, align: 'right' },
                { title: 'Bài tiếp', dataIndex: 'nextAt', key: 'nextAt', width: 120, render: (v: string | null) => formatWhen(v) },
                {
                  title: 'Xong lúc',
                  dataIndex: 'finishAt',
                  key: 'finishAt',
                  width: 120,
                  render: (v: string, r) => (
                    <span className={r.finishTodayCount < r.pending ? 'posting-window-late' : ''}>{formatWhen(v)}</span>
                  ),
                },
              ]}
            />
          )}
          {queue.totalPending > 0 && (
            <div className="schedule-settings-actions">
              <Popconfirm
                title="Xếp lại toàn bộ hàng đợi?"
                description="Mọi bài đang chờ sẽ được xếp lại nối đuôi theo cài đặt chung, kể cả bài đã hẹn giờ riêng."
                okText="Xếp lại"
                cancelText="Hủy"
                onConfirm={() => packMutation.mutate()}
              >
                <Button loading={packMutation.isPending}>Xếp lại cả hàng đợi</Button>
              </Popconfirm>
            </div>
          )}
        </section>
      )}

      {lanes.length > 0 && (
        <section className="schedule-settings-section">
          <h4>{plan?.totalDeferred ?? 0} bài không kịp trong khung hôm nay</h4>
          {lanes.map((lane) => (
            <div key={lane.laneName + lane.firstDeferredAt} className="posting-window-lane">
              <div className="posting-window-lane-head">
                <strong>{lane.laneName}</strong>
                <span>dư {lane.deferredCount} bài</span>
              </div>
              {lane.suggestions.map((s) => (
                <div key={s.toTargetFanpageId} className="posting-window-suggestion">
                  <SwapOutlined />
                  <span>Chuyển {s.postIds.length} bài sang <b>{s.toName}</b></span>
                  <Popconfirm
                    title={`Chuyển ${s.postIds.length} bài sang ${s.toName}?`}
                    okText="Chuyển"
                    cancelText="Hủy"
                    onConfirm={() => applyMutation.mutate(s)}
                  >
                    <Button size="small" loading={applyMutation.isPending && applyMutation.variables?.toTargetFanpageId === s.toTargetFanpageId}>
                      Duyệt
                    </Button>
                  </Popconfirm>
                </div>
              ))}
              {lane.unassignedCount > 0 && (
                <div className="posting-window-suggestion is-muted">
                  {lane.unassignedCount} bài chưa có nick nào rảnh
                  {lane.extraViasNeeded > 0 ? ` — cần thêm ${lane.extraViasNeeded} via để đăng hết hôm nay` : ''}.
                </div>
              )}
            </div>
          ))}
        </section>
      )}
      {open && <QueuePowerPanel />}
    </Drawer>
  );
}
