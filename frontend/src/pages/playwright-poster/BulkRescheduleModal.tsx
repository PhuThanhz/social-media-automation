import { memo } from 'react';
import type React from 'react';
import {
  Select,
  Tag,
  Checkbox,
  DatePicker,
  TimePicker,
  Segmented,
  Modal,
  InputNumber,
  Radio,
} from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import type { SocialAccount, PostQueue } from './types';

export type RescheduleMode = 'CONTINUOUS' | 'WINDOW' | 'VIRAL' | 'INTERVAL';

// Một dòng cài đặt: nhãn bên trái, ô nhập bên phải (thay cho mỗi ô một khung viền riêng)
function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="reschedule-row">
      <div className="reschedule-row-label">
        {label}
        {hint && <div className="reschedule-row-hint">{hint}</div>}
      </div>
      <div className="reschedule-row-control">{children}</div>
    </div>
  );
}

interface BulkRescheduleModalProps {
  desiredMinInterval: number;
  setDesiredMinInterval: React.Dispatch<React.SetStateAction<number>>;
  selectedRowKeys: React.Key[];
  bulkRescheduleModalVisible: boolean;
  setBulkRescheduleModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
  bulkRescheduleTargetScope: "ALL" | "SELECTED";
  setBulkRescheduleTargetScope: React.Dispatch<React.SetStateAction<"ALL" | "SELECTED">>;
  bulkRescheduleMode: RescheduleMode;
  setBulkRescheduleMode: React.Dispatch<React.SetStateAction<RescheduleMode>>;
  setBulkRescheduleDate: React.Dispatch<React.SetStateAction<Dayjs>>;
  bulkRescheduleDate: Dayjs;
  setBulkRescheduleStartTime: React.Dispatch<React.SetStateAction<Dayjs>>;
  bulkRescheduleStartTime: Dayjs;
  setBulkRescheduleEndTime: React.Dispatch<React.SetStateAction<Dayjs>>;
  bulkRescheduleEndTime: Dayjs;
  bulkRescheduleInterval: number;
  setBulkRescheduleInterval: React.Dispatch<React.SetStateAction<number>>;
  bulkRescheduleInterleave: boolean;
  setBulkRescheduleInterleave: React.Dispatch<React.SetStateAction<boolean>>;
  bulkRescheduleMaxPerDay: number;
  setBulkRescheduleMaxPerDay: React.Dispatch<React.SetStateAction<number>>;
  bulkRescheduleSameDayGap: number;
  setBulkRescheduleSameDayGap: React.Dispatch<React.SetStateAction<number>>;
  setBulkRescheduleDistributeNicks: React.Dispatch<React.SetStateAction<boolean>>;
  bulkRescheduleDistributeNicks: boolean;
  setBulkRescheduleSelectedNicks: React.Dispatch<React.SetStateAction<string[]>>;
  bulkRescheduleSelectedNicks: string[];
  viralMaxPerTargetPerDay: number;
  setViralMaxPerTargetPerDay: React.Dispatch<React.SetStateAction<number>>;
  viralMinGapPerTarget: number;
  setViralMinGapPerTarget: React.Dispatch<React.SetStateAction<number>>;
  viralMinGapGlobal: number;
  setViralMinGapGlobal: React.Dispatch<React.SetStateAction<number>>;
  viralJitter: boolean;
  setViralJitter: React.Dispatch<React.SetStateAction<boolean>>;
  setViralSeed: React.Dispatch<React.SetStateAction<number>>;
  isBulkProcessing: boolean;
  postingIdentities: SocialAccount[];
  accountTargetValue: (account: SocialAccount) => string;
  validPersonalVias: SocialAccount[];
  twoMainViasTargetValues: string[];
  twoMainViasDisplayNames: string;
  posts: PostQueue[];
  rescheduleTargetPosts: PostQueue[];
  reschedulePreviewList: { post: PostQueue; newTime: Dayjs; assignedNickValue: string; assignedNickName: string; }[];
  reschedulePreviewStats: { spilled: number; lastOnStartDay: Dayjs; days: number; golden: number; avgGap: number; minTargetGap: number; hours: any[]; targets: number; };
  handleApplyBulkReschedule: () => Promise<void>;
  queueGapMinutes: number;
  setQueueGapMinutes: (minutes: number) => void;
  packingQueue: boolean;
  handlePackQueueContinuous: () => Promise<void>;
}

// Modal đổi giờ hàng loạt các bài đang chờ — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
function BulkRescheduleModal({
  desiredMinInterval,
  setDesiredMinInterval,
  selectedRowKeys,
  bulkRescheduleModalVisible,
  setBulkRescheduleModalVisible,
  bulkRescheduleTargetScope,
  setBulkRescheduleTargetScope,
  bulkRescheduleMode,
  setBulkRescheduleMode,
  setBulkRescheduleDate,
  bulkRescheduleDate,
  setBulkRescheduleStartTime,
  bulkRescheduleStartTime,
  setBulkRescheduleEndTime,
  bulkRescheduleEndTime,
  bulkRescheduleInterval,
  setBulkRescheduleInterval,
  bulkRescheduleInterleave,
  setBulkRescheduleInterleave,
  bulkRescheduleMaxPerDay,
  setBulkRescheduleMaxPerDay,
  bulkRescheduleSameDayGap,
  setBulkRescheduleSameDayGap,
  setBulkRescheduleDistributeNicks,
  bulkRescheduleDistributeNicks,
  setBulkRescheduleSelectedNicks,
  bulkRescheduleSelectedNicks,
  viralMaxPerTargetPerDay,
  setViralMaxPerTargetPerDay,
  viralMinGapPerTarget,
  setViralMinGapPerTarget,
  viralMinGapGlobal,
  setViralMinGapGlobal,
  viralJitter,
  setViralJitter,
  setViralSeed,
  isBulkProcessing,
  postingIdentities,
  accountTargetValue,
  validPersonalVias,
  twoMainViasTargetValues,
  twoMainViasDisplayNames,
  posts,
  rescheduleTargetPosts,
  reschedulePreviewList,
  reschedulePreviewStats,
  handleApplyBulkReschedule,
  queueGapMinutes,
  setQueueGapMinutes,
  packingQueue,
  handlePackQueueContinuous,
}: BulkRescheduleModalProps) {
  const isContinuous = bulkRescheduleMode === 'CONTINUOUS';
  const pendingCount = (posts || []).filter((p) => p.status === 'PENDING').length;
  const applyCount = isContinuous ? pendingCount : rescheduleTargetPosts.length;
  const today = dayjs();
  const at = (h: number, m: number) => today.hour(h).minute(m).second(0);
  // Khung giờ gợi ý nằm trong bảng chọn giờ (presets) thay cho một hàng nút riêng
  const timeRangePresets = [
    { label: `Từ bây giờ (${today.format('HH:mm')}–)`, value: [today, today.hour() >= 18 ? at(23, 0) : bulkRescheduleEndTime] as [Dayjs, Dayjs] },
    { label: 'Hành chính 9h–18h', value: [at(9, 0), at(18, 0)] as [Dayjs, Dayjs] },
    { label: 'Cả ngày 8h30–22h', value: [at(8, 30), at(22, 0)] as [Dayjs, Dayjs] },
    { label: 'Trưa & tối 11h30–23h', value: [at(11, 30), at(23, 0)] as [Dayjs, Dayjs] },
    ...(bulkRescheduleMode === 'VIRAL' ? [{ label: 'Toàn ngày 6h30–23h30', value: [at(6, 30), at(23, 30)] as [Dayjs, Dayjs] }] : []),
  ];
  const datePresets = [
    { label: 'Hôm nay', value: today },
    { label: 'Ngày mai', value: today.add(1, 'day') },
  ];
  const perDayMode = bulkRescheduleMaxPerDay === -1 ? 'AUTO' : bulkRescheduleMaxPerDay === 0 ? 'ONE_DAY' : 'LIMIT';

  const handleOk = async () => {
    if (isContinuous) {
      await handlePackQueueContinuous();
      setBulkRescheduleModalVisible(false);
      return;
    }
    await handleApplyBulkReschedule();
  };

  return (
    <Modal
      title={`Phân bổ lại giờ đăng (${applyCount} bài)`}
      open={bulkRescheduleModalVisible}
      onCancel={() => setBulkRescheduleModalVisible(false)}
      onOk={handleOk}
      confirmLoading={isContinuous ? packingQueue : isBulkProcessing}
      okButtonProps={{ disabled: applyCount === 0 }}
      okText={isContinuous ? `Xếp nối tiếp (${applyCount} bài)` : `Áp dụng (${applyCount} bài)`}
      cancelText="Hủy"
      width={860}
      style={{ top: 20 }}
      styles={{
        body: {
          maxHeight: 'calc(100vh - 160px)',
          overflowY: 'auto',
          paddingRight: 8,
        },
      }}
      className="reschedule-modal"
    >
      <div className="reschedule-form">
        <SettingRow label="Cách xếp giờ">
          <Segmented
            block
            style={{ width: '100%' }}
            value={bulkRescheduleMode}
            onChange={(val) => setBulkRescheduleMode(val as RescheduleMode)}
            options={[
              { label: 'Nối tiếp từ bây giờ', value: 'CONTINUOUS' },
              { label: 'Chia đều khung giờ', value: 'WINDOW' },
              { label: 'Giờ vàng', value: 'VIRAL' },
              { label: 'Giãn cách cố định', value: 'INTERVAL' },
            ]}
          />
        </SettingRow>

        {isContinuous ? (
          <>
            <SettingRow label="Áp dụng cho">
              <span className="reschedule-value">Tất cả {pendingCount} bài đang chờ</span>
            </SettingRow>
            <SettingRow label="Nghỉ giữa 2 bài" hint="Của cùng một nick">
              <InputNumber
                min={0}
                max={120}
                value={queueGapMinutes}
                onChange={(v) => setQueueGapMinutes(typeof v === 'number' ? v : 2)}
                suffix="phút"
                style={{ width: 120 }}
              />
              <span className="reschedule-note">
                Mỗi nick đăng nối tiếp từ bây giờ, các nick chạy song song; giờ hẹn hiện tại sẽ được thay. Khung giờ đăng (nếu đang bật) vẫn được giữ.
              </span>
            </SettingRow>
          </>
        ) : (
          <>
            <SettingRow label="Áp dụng cho">
              <Segmented
                value={bulkRescheduleTargetScope}
                onChange={(val) => setBulkRescheduleTargetScope(val as 'ALL' | 'SELECTED')}
                options={[
                  { label: `Tất cả bài đang chờ (${pendingCount})`, value: 'ALL' },
                  { label: `Bài đã chọn (${selectedRowKeys.length})`, value: 'SELECTED', disabled: selectedRowKeys.length === 0 },
                ]}
              />
            </SettingRow>

            {bulkRescheduleMode === 'INTERVAL' ? (
              <>
                <SettingRow label="Bắt đầu từ">
                  <DatePicker
                    showTime
                    format="HH:mm DD/MM/YYYY"
                    value={bulkRescheduleStartTime}
                    onChange={(val) => val && setBulkRescheduleStartTime(val)}
                    allowClear={false}
                    style={{ width: 220 }}
                  />
                </SettingRow>
                <SettingRow label="Mỗi bài cách nhau">
                  <InputNumber
                    min={1}
                    max={600}
                    value={bulkRescheduleInterval}
                    onChange={(v) => setBulkRescheduleInterval(Number(v) || 15)}
                    suffix="phút"
                    style={{ width: 120 }}
                  />
                </SettingRow>
              </>
            ) : (
              <>
                <SettingRow label="Ngày bắt đầu">
                  <DatePicker
                    value={bulkRescheduleDate}
                    onChange={(val) => val && setBulkRescheduleDate(val)}
                    format="DD/MM/YYYY"
                    presets={datePresets}
                    allowClear={false}
                    style={{ width: 160 }}
                  />
                </SettingRow>
                <SettingRow label="Khung giờ mỗi ngày" hint={bulkRescheduleMode === 'VIRAL' ? 'Dồn nhiều bài vào 11:00–13:00 và 19:00–22:00' : undefined}>
                  <TimePicker.RangePicker
                    format="HH:mm"
                    minuteStep={5}
                    allowClear={false}
                    presets={timeRangePresets}
                    value={[bulkRescheduleStartTime, bulkRescheduleEndTime]}
                    onChange={(vals) => {
                      if (!vals || !vals[0] || !vals[1]) return;
                      if (vals[0].isSame(today, 'minute')) setBulkRescheduleDate(today);
                      setBulkRescheduleStartTime(vals[0]);
                      setBulkRescheduleEndTime(vals[1]);
                    }}
                    style={{ width: 220 }}
                  />
                  {reschedulePreviewList.length > 1 && (
                    <span className="reschedule-note">
                      ~{reschedulePreviewStats.avgGap} phút/bài · {reschedulePreviewStats.days} ngày
                    </span>
                  )}
                </SettingRow>

                {bulkRescheduleMode === 'VIRAL' ? (
                  <>
                    <SettingRow label="Giới hạn">
                      <InputNumber min={1} max={50} value={viralMaxPerTargetPerDay} onChange={(v) => setViralMaxPerTargetPerDay(Number(v) || 1)} suffix="bài/group/ngày" style={{ width: 170 }} />
                      <InputNumber min={10} max={600} step={5} value={viralMinGapPerTarget} onChange={(v) => setViralMinGapPerTarget(Number(v) || 10)} prefix="cùng group" suffix="phút" style={{ width: 190 }} />
                      <InputNumber min={3} max={120} value={viralMinGapGlobal} onChange={(v) => setViralMinGapGlobal(Number(v) || 3)} prefix="2 bài bất kỳ" suffix="phút" style={{ width: 190 }} />
                    </SettingRow>
                    <SettingRow label="Lệch giờ ngẫu nhiên">
                      <Checkbox checked={viralJitter} onChange={(e) => setViralJitter(e.target.checked)}>±4 phút, tránh giờ tròn đều</Checkbox>
                      <a className="reschedule-link" onClick={() => setViralSeed(Date.now())}>Xáo lại giờ lệch</a>
                    </SettingRow>
                  </>
                ) : (
                  <>
                    <SettingRow label="Số bài mỗi ngày">
                      <Radio.Group
                        value={perDayMode}
                        onChange={(e) => {
                          const v = e.target.value;
                          setBulkRescheduleMaxPerDay(v === 'AUTO' ? -1 : v === 'ONE_DAY' ? 0 : (bulkRescheduleMaxPerDay > 0 ? bulkRescheduleMaxPerDay : 10));
                        }}
                      >
                        <Radio value="AUTO">Tự động rải đều</Radio>
                        <Radio value="ONE_DAY">Hết trong 1 ngày</Radio>
                        <Radio value="LIMIT">Tối đa</Radio>
                      </Radio.Group>
                      {perDayMode === 'LIMIT' && (
                        <InputNumber min={1} max={200} value={bulkRescheduleMaxPerDay} onChange={(v) => setBulkRescheduleMaxPerDay(Math.max(1, Number(v) || 1))} suffix="bài/ngày" style={{ width: 130 }} />
                      )}
                    </SettingRow>
                    <SettingRow label={perDayMode === 'AUTO' ? 'Giãn cách tối thiểu' : 'Cách nhau tối thiểu'}>
                      {perDayMode === 'AUTO' ? (
                        <InputNumber min={10} max={240} step={5} value={desiredMinInterval} onChange={(v) => setDesiredMinInterval(Math.max(10, Number(v) || 30))} suffix="phút/bài" style={{ width: 140 }} />
                      ) : (
                        <>
                          <InputNumber min={1} max={180} value={bulkRescheduleSameDayGap} onChange={(v) => setBulkRescheduleSameDayGap(Number(v) || 8)} suffix="phút/bài" style={{ width: 140 }} />
                          <a
                            className="reschedule-link"
                            onClick={() => {
                              const avail = Math.max(60, bulkRescheduleEndTime.hour(23).minute(30).diff(bulkRescheduleStartTime, 'minute'));
                              const fit = Math.max(1, Math.floor(avail / Math.max(1, rescheduleTargetPosts.length - 1)));
                              setBulkRescheduleSameDayGap(fit);
                            }}
                          >
                            Vừa khít khung giờ
                          </a>
                        </>
                      )}
                    </SettingRow>
                  </>
                )}
              </>
            )}

            {bulkRescheduleMode !== 'VIRAL' && (
              <SettingRow label="Đan xen Page & Group">
                <Checkbox checked={bulkRescheduleInterleave} onChange={(e) => setBulkRescheduleInterleave(e.target.checked)}>
                  Xếp xen kẽ để một kênh không bị đăng nhiều bài sát nhau
                </Checkbox>
              </SettingRow>
            )}
            <SettingRow label="Chia cho nhiều nick">
              <Checkbox checked={bulkRescheduleDistributeNicks} onChange={(e) => setBulkRescheduleDistributeNicks(e.target.checked)}>
                Xoay vòng {rescheduleTargetPosts.length} bài qua các nick để đăng song song
              </Checkbox>
              {bulkRescheduleDistributeNicks && (
                <div className="reschedule-nick-picker">
                  <Select
                    mode="multiple"
                    placeholder="Chọn nick / via"
                    value={bulkRescheduleSelectedNicks}
                    onChange={(vals) => setBulkRescheduleSelectedNicks(vals)}
                    style={{ width: '100%' }}
                    options={postingIdentities.map((acc) => ({
                      label: `${acc.pageName || acc.platformAccountId} (${acc.accountType || acc.platform})`,
                      value: accountTargetValue(acc),
                    }))}
                    maxTagCount="responsive"
                  />
                  <div className="reschedule-links">
                    <a onClick={() => setBulkRescheduleSelectedNicks(twoMainViasTargetValues)} title={twoMainViasDisplayNames}>2 via chính</a>
                    <a onClick={() => setBulkRescheduleSelectedNicks(validPersonalVias.map((a) => accountTargetValue(a)))}>Tất cả via ({validPersonalVias.length})</a>
                  </div>
                </div>
              )}
            </SettingRow>

            <div className="reschedule-preview">
              <div className="reschedule-preview-head">
                <span className="reschedule-preview-title">Xem trước ({reschedulePreviewList.length} bài)</span>
                <span className="reschedule-note">
                  {bulkRescheduleMode !== 'INTERVAL'
                    ? `${bulkRescheduleStartTime.format('HH:mm')} – ${bulkRescheduleEndTime.format('HH:mm')} mỗi ngày, từ ${bulkRescheduleDate.format('DD/MM/YYYY')}`
                    : `Từ ${bulkRescheduleStartTime.format('HH:mm DD/MM/YYYY')}`}
                </span>
              </div>
              {reschedulePreviewList.length === 0 ? (
                <div className="reschedule-empty">Không có bài nào đang chờ để phân bổ.</div>
              ) : (
                <div className="reschedule-preview-list">
                  {reschedulePreviewList.map((item, idx) => {
                    const post = item.post;
                    const oldTimeStr = post.scheduledAt ? dayjs(post.scheduledAt).format('HH:mm DD/MM') : 'Đăng ngay';
                    const newTimeStr = item.newTime ? item.newTime.format('HH:mm DD/MM/YYYY') : '';
                    return (
                      <div key={post.id} className="reschedule-preview-item">
                        <div className="reschedule-preview-left">
                          <span className="reschedule-preview-index">{idx + 1}</span>
                          <div className="reschedule-preview-main">
                            <div className="reschedule-preview-text">
                              {post.content || post.title || (post.targetGroupNames ? `Đăng vào: ${post.targetGroupNames}` : `Bài viết #${post.id}`)}
                            </div>
                            <div className="reschedule-preview-meta">
                              <span>{post.targetGroupNames ? (post.targetGroupNames.replace(/^GROUP_ONLY_ANON:|^GROUP_ONLY:/, '')) : (post.targetFanpageId ? `Fanpage ID: ${post.targetFanpageId}` : 'Facebook')}</span>
                              {item.assignedNickName && (
                                <Tag color="purple" className="reschedule-preview-tag">{item.assignedNickName}</Tag>
                              )}
                              <span className="reschedule-preview-old">{oldTimeStr}</span>
                            </div>
                          </div>
                        </div>
                        <span className="reschedule-preview-new">{newTimeStr}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(BulkRescheduleModal, (prev, next) => !prev.bulkRescheduleModalVisible && !next.bulkRescheduleModalVisible);
