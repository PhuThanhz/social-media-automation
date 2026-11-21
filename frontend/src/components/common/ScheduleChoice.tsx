import { DatePicker, Segmented, InputNumber } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  gapMinutesOf,
  isInsideWindow,
  openScheduleSettings,
  scheduleModeLabel,
  usePostingPlan,
  type ScheduleMode,
  type ScheduleValue,
} from './postingSchedule';

type Props = {
  value: ScheduleValue;
  onChange: (v: ScheduleValue) => void;
  /** Ẩn lựa chọn nào không hợp với nơi dùng (VD hàng loạt không cho Hẹn giờ 1 mốc). */
  modes?: ScheduleMode[];
  size?: 'small' | 'middle' | 'large';
  /** Ẩn dòng giải thích bên dưới (khi chỗ đặt quá chật). */
  compact?: boolean;
};

/**
 * Bộ chọn thời gian đăng DUY NHẤT dùng ở mọi trang: Đăng ngay / Xếp vào lịch / Hẹn giờ.
 * Hỗ trợ chọn nhanh hoặc nhập số phút giãn cách giữa các bài (mặc định 20 phút/bài).
 */
export default function ScheduleChoice({ value, onChange, modes = ['NOW', 'QUEUE', 'AT'], size = 'middle', compact }: Props) {
  const { data: plan } = usePostingPlan();
  const gap = gapMinutesOf(plan);
  const currentInterval = value.intervalMinutes || (gap > 0 ? gap : 20);
  const outside = value.mode === 'AT' && value.at && !isInsideWindow(value.at, plan);

  const hint = value.mode === 'NOW'
    ? 'Đăng ngay, không chờ lịch.'
    : value.mode === 'QUEUE'
      ? (plan?.enabled ? `Khung giờ ${plan.start}–${plan.end}` : 'Không giới hạn khung giờ')
      : outside
        ? `Giờ này nằm ngoài khung ${plan?.start}–${plan?.end}: bài sẽ chờ tới khi khung mở.`
        : `Bắt đầu từ ${value.at ? value.at.format('HH:mm DD/MM') : 'giờ hẹn'}, các bài sau tự động cách nhau ${currentInterval} phút.`;

  return (
    <div className="schedule-choice">
      <div className="schedule-choice-row flex-wrap gap-2">
        <Segmented
          size={size}
          value={value.mode}
          onChange={(v) => {
            const mode = v as ScheduleMode;
            onChange({
              mode,
              intervalMinutes: currentInterval,
              at: mode === 'AT' ? (value.at || dayjs().add(30, 'minute').second(0)) : value.at,
            });
          }}
          options={modes.map((m) => ({ label: scheduleModeLabel[m], value: m }))}
        />
        {value.mode === 'AT' && (
          <DatePicker
            size={size}
            showTime={{ format: 'HH:mm', minuteStep: 5 }}
            format="HH:mm DD/MM/YYYY"
            allowClear={false}
            value={value.at || null}
            disabledDate={(d) => d.isBefore(dayjs().startOf('day'))}
            onChange={(d) => onChange({ mode: 'AT', at: d, intervalMinutes: currentInterval })}
            status={outside ? 'warning' : undefined}
          />
        )}
      </div>

      {/* Thanh chọn Giãn cách phút (Hiển thị khi Xếp vào lịch hoặc Hẹn giờ) */}
      {value.mode !== 'NOW' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Segmented
            size="small"
            value={[1, 2, 5, 10, 20].includes(currentInterval) ? currentInterval : -1}
            onChange={(v) => { if (typeof v === 'number' && v > 0) onChange({ ...value, intervalMinutes: v }); }}
            options={[
              { value: 1, label: '1p', title: '2 Worker song song, ~2 bài/phút' },
              { value: 2, label: '2p', title: 'Nhanh, ~1 bài/phút' },
              { value: 5, label: '5p', title: '5 phút/bài' },
              { value: 10, label: '10p', title: '10 phút/bài' },
              { value: 20, label: '20p', title: 'An toàn, tránh checkpoint' },
            ]}
          />
          <InputNumber
            size="small"
            min={1}
            max={360}
            value={currentInterval}
            onChange={(v) => onChange({ ...value, intervalMinutes: typeof v === 'number' ? v : 1 })}
            addonAfter="phút"
            className="w-28 !text-xs"
            aria-label="Số phút giữa các bài"
          />
        </div>
      )}

      {!compact && (
        <div className={`schedule-choice-hint${outside ? ' is-warn' : ''} flex items-center justify-between mt-1 text-xs text-slate-400`}>
          <span>{hint}</span>
          <button type="button" className="schedule-choice-edit hover:text-sky-400 flex items-center gap-1 cursor-pointer font-medium ml-2" onClick={openScheduleSettings}>
            <SettingOutlined /> Cài đặt
          </button>
        </div>
      )}
    </div>
  );
}
