import { DatePicker, Segmented } from 'antd';
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
 * "Xếp vào lịch" do server xếp theo cài đặt chung (khung giờ, giãn cách, mỗi nick một làn).
 */
export default function ScheduleChoice({ value, onChange, modes = ['NOW', 'QUEUE', 'AT'], size = 'middle', compact }: Props) {
  const { data: plan } = usePostingPlan();
  const gap = gapMinutesOf(plan);
  const windowText = plan?.enabled ? `trong khung ${plan.start}–${plan.end}` : 'không giới hạn khung giờ';
  const outside = value.mode === 'AT' && value.at && !isInsideWindow(value.at, plan);

  const hint = value.mode === 'NOW'
    ? 'Đăng ngay, không chờ lịch.'
    : value.mode === 'QUEUE'
      ? `Tự động rải đều theo từng nhóm, ${windowText} (giãn tối thiểu ${gap} phút).`
      : outside
        ? `Giờ này nằm ngoài khung ${plan?.start}–${plan?.end}: bài sẽ chờ tới khi khung mở.`
        : 'Đăng đúng giờ đã chọn.';

  return (
    <div className="schedule-choice">
      <div className="schedule-choice-row">
        <Segmented
          size={size}
          value={value.mode}
          onChange={(v) => {
            const mode = v as ScheduleMode;
            onChange({ mode, at: mode === 'AT' ? (value.at || dayjs().add(30, 'minute').second(0)) : value.at });
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
            onChange={(d) => onChange({ mode: 'AT', at: d })}
            status={outside ? 'warning' : undefined}
          />
        )}
      </div>
      {!compact && (
        <div className={`schedule-choice-hint${outside ? ' is-warn' : ''}`}>
          <span>{hint}</span>
          <button type="button" className="schedule-choice-edit" onClick={openScheduleSettings}>
            Cài đặt lịch
          </button>
        </div>
      )}
    </div>
  );
}
