import { DatePicker, Segmented, InputNumber } from 'antd';
import { ClockCircleOutlined, SettingOutlined } from '@ant-design/icons';
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
  const windowText = plan?.enabled ? `trong khung ${plan.start}–${plan.end}` : 'không giới hạn khung giờ';
  const outside = value.mode === 'AT' && value.at && !isInsideWindow(value.at, plan);

  const hint = value.mode === 'NOW'
    ? 'Đăng ngay, không chờ lịch.'
    : value.mode === 'QUEUE'
      ? `Tự động xếp lịch cách nhau ${currentInterval} phút/bài, ${windowText}.`
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
        <div className="mt-2.5 p-2.5 bg-slate-900/90 rounded-xl border border-sky-500/25 flex flex-wrap items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-sky-300 flex items-center gap-1 shrink-0">
              <ClockCircleOutlined className="text-sky-400" /> Giãn cách bài:
            </span>
            {[10, 15, 20, 30, 60].map((mins) => {
              const active = currentInterval === mins;
              return (
                <button
                  key={mins}
                  type="button"
                  onClick={() => onChange({ ...value, intervalMinutes: mins })}
                  className={`px-2 py-0.5 rounded-lg text-xs font-semibold transition-all border cursor-pointer ${
                    active
                      ? 'bg-sky-500/25 border-sky-400 text-sky-200 ring-1 ring-sky-500/40 shadow-sm font-bold'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600 hover:text-slate-200'
                  }`}
                  title={mins === 20 ? 'Khuyên dùng cho cùng 1 Nhóm/Page để tránh spam Facebook' : undefined}
                >
                  {mins}p {mins === 20 ? '⭐ Khuyên dùng' : ''}
                </button>
              );
            })}
            <InputNumber
              size="small"
              min={1}
              max={360}
              value={currentInterval}
              onChange={(v) => onChange({ ...value, intervalMinutes: typeof v === 'number' ? v : 20 })}
              addonAfter="phút/bài"
              className="w-28 !text-xs"
            />
          </div>
          <span className="text-[11px] text-slate-400 italic">
            Mỗi bài đăng cách nhau <b>{currentInterval} phút</b>
          </span>
        </div>
      )}

      {!compact && (
        <div className={`schedule-choice-hint${outside ? ' is-warn' : ''} flex items-center justify-between mt-1 text-xs text-slate-400`}>
          <span>{hint}</span>
          <button type="button" className="schedule-choice-edit hover:text-sky-400 flex items-center gap-1 cursor-pointer font-medium ml-2" onClick={openScheduleSettings}>
            <SettingOutlined /> Cài đặt lịch chung
          </button>
        </div>
      )}
    </div>
  );
}
