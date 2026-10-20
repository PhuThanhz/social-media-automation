import React from 'react';
import { DatePicker, Input } from 'antd';
import dayjs, { Dayjs } from 'dayjs';

interface EasyTimePickerProps {
  value?: Dayjs;
  onChange?: (val: Dayjs) => void;
  className?: string;
  size?: 'small' | 'middle' | 'large';
  compact?: boolean;
}

const SUGGESTED_TIMES = [
  { time: '06:15', label: 'Sáng sớm', hour: 6, minute: 15 },
  { time: '07:30', label: 'Đi làm', hour: 7, minute: 30 },
  { time: '09:15', label: 'Giữa sáng', hour: 9, minute: 15 },
  { time: '10:45', label: 'Trước trưa', hour: 10, minute: 45 },
  { time: '12:15', label: 'Nghỉ trưa', hour: 12, minute: 15 },
  { time: '14:30', label: 'Đầu chiều', hour: 14, minute: 30 },
  { time: '16:45', label: 'Cuối chiều', hour: 16, minute: 45 },
  { time: '18:30', label: 'Tan ca', hour: 18, minute: 30 },
  { time: '20:15', label: 'Buổi tối', hour: 20, minute: 15 },
  { time: '22:00', label: 'Trước ngủ', hour: 22, minute: 0 },
];

const EasyTimePicker: React.FC<EasyTimePickerProps> = ({
  value = dayjs(),
  onChange,
  className = '',
  size = 'middle',
  compact = false,
}) => {
  const current = value || dayjs();
  const [timeDraft, setTimeDraft] = React.useState(current.format('HH:mm'));

  React.useEffect(() => {
    setTimeDraft((value || dayjs()).format('HH:mm'));
  }, [value]);

  const handleDateChange = (date: Dayjs | null) => {
    if (!date) return;
    const updated = date.hour(current.hour()).minute(current.minute()).second(0);
    onChange?.(updated);
  };

  const commitTimeDraft = () => {
    let normalized = timeDraft.trim().replace('.', ':');
    if (/^\d{3,4}$/.test(normalized)) {
      normalized = normalized.padStart(4, '0');
      normalized = `${normalized.slice(0, 2)}:${normalized.slice(2)}`;
    }
    const matched = /^(\d{1,2}):(\d{2})$/.exec(normalized);
    if (!matched) {
      setTimeDraft(current.format('HH:mm'));
      return;
    }
    const hour = Number(matched[1]);
    const minute = Number(matched[2]);
    if (hour > 23 || minute > 59) {
      setTimeDraft(current.format('HH:mm'));
      return;
    }
    const formatted = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    setTimeDraft(formatted);
    onChange?.(current.hour(hour).minute(minute).second(0));
  };

  const handleSetGoldenTime = (hour: number, minute: number) => {
    const updated = current.hour(hour).minute(minute).second(0);
    onChange?.(updated);
  };

  const handleAddOffset = (amount: number, unit: 'minute' | 'hour') => {
    const updated = dayjs().add(amount, unit);
    onChange?.(updated);
  };

  if (compact) {
    return (
      <div className={`easy-time-compact rounded-xl border border-slate-700/80 bg-slate-900/60 p-2.5 ${className}`}>
        <div className="easy-time-main flex flex-col md:flex-row md:items-center gap-2.5 flex-wrap">
          <div className="easy-time-heading flex items-center gap-2 shrink-0 md:w-36">
            <span className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 grid place-items-center text-xs">🕒</span>
            <div>
              <div className="text-xs font-bold text-slate-200">Thời gian đăng</div>
              <div className="text-[9px] text-slate-400">Ngày và giờ cụ thể</div>
            </div>
          </div>

          <div className="easy-time-fields grid grid-cols-1 sm:grid-cols-[minmax(130px,1fr)_110px] gap-2 flex-1 min-w-[240px]">
            <DatePicker
              value={current}
              onChange={handleDateChange}
              format="DD/MM/YYYY"
              placeholder="Chọn ngày"
              size={size}
              allowClear={false}
              className="rounded-lg w-full font-semibold text-xs bg-slate-950 border-slate-700 text-slate-100"
            />
            <Input
              value={timeDraft}
              onChange={(event) => setTimeDraft(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={commitTimeDraft}
              onPressEnter={(event) => event.currentTarget.blur()}
              size={size}
              inputMode="numeric"
              maxLength={5}
              placeholder="HH:mm"
              aria-label="Nhập giờ đăng"
              className="easy-time-input w-full rounded-lg font-bold bg-slate-950 border-slate-700 text-emerald-400 text-center"
            />
          </div>

          <div className="easy-time-shortcuts flex items-center gap-1 overflow-x-auto shrink-0">
            <span className="text-[9px] font-bold text-slate-400 uppercase shrink-0">Nhanh:</span>
            {[
              { label: '+15p', amount: 15, unit: 'minute' as const },
              { label: '+30p', amount: 30, unit: 'minute' as const },
              { label: '+1h', amount: 1, unit: 'hour' as const },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => handleAddOffset(item.amount, item.unit)}
                className="h-7 px-2 rounded-md border border-slate-700 bg-slate-800/80 text-[11px] font-bold text-slate-300 hover:border-emerald-500 hover:text-emerald-300 hover:bg-emerald-950/40 transition shrink-0 cursor-pointer"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="easy-time-suggestions mt-2.5 pt-2 border-t border-slate-800">
          <div className="easy-time-suggestions-head flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-emerald-400 inline-block"></span>
              10 khung giờ gợi ý trong ngày
            </span>
            <span className="text-[9px] text-slate-500">Theo giờ online phổ biến</span>
          </div>
          <div className="suggested-time-list grid grid-cols-5 xl:grid-cols-10 gap-1.5">
            {SUGGESTED_TIMES.map((slot) => (
              <button
                key={slot.time}
                type="button"
                onClick={() => handleSetGoldenTime(slot.hour, slot.minute)}
                className={`suggested-time-chip ${current.hour() === slot.hour && current.minute() === slot.minute ? 'is-active' : ''}`}
              >
                <b>{slot.time}</b>
                <span>{slot.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-2.5 p-3 rounded-2xl bg-slate-50 border border-slate-200/90 w-full ${className}`}>
      {/* HÀNG 1: CHỌN NGÀY + NHẬP GIỜ TRỰC TIẾP */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        {/* Chọn ngày */}
        <DatePicker
          value={current}
          onChange={handleDateChange}
          format="DD/MM/YYYY"
          placeholder="Chọn ngày"
          size={size}
          allowClear={false}
          className="rounded-xl flex-1 font-semibold text-xs text-slate-800"
        />

        <div className="flex-1">
          <Input
            value={timeDraft}
            onChange={(event) => setTimeDraft(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={commitTimeDraft}
            onPressEnter={(event) => event.currentTarget.blur()}
            size={size}
            inputMode="numeric"
            maxLength={5}
            placeholder="HH:mm"
            aria-label="Nhập giờ đăng"
            className="easy-time-input w-full rounded-xl font-bold"
          />
        </div>
      </div>

      {/* HÀNG 2: PHÍM TẮT THỜI GIAN VÀNG 1-CHẠM */}
      <div className="space-y-1.5 pt-1 border-t border-slate-200/60">
        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
          10 khung giờ gợi ý trong ngày — bấm một lần để chọn:
        </div>
        <div className="suggested-time-list">
          {SUGGESTED_TIMES.map((slot) => (
            <button
              key={slot.time}
              type="button"
              onClick={() => handleSetGoldenTime(slot.hour, slot.minute)}
              className={`suggested-time-chip ${current.hour() === slot.hour && current.minute() === slot.minute ? 'is-active' : ''}`}
            >
              <b>{slot.time}</b>
              <span>{slot.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* HÀNG 3: CỘNG GIỜ TỰ ĐỘNG KỂ TỪ HIỆN TẠI */}
      <div className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-slate-200/60">
        <span className="text-[10px] font-bold text-slate-400 uppercase shrink-0">Đăng sau:</span>
        <button
          type="button"
          onClick={() => handleAddOffset(15, 'minute')}
          className="px-3 py-2 min-h-[40px] flex items-center justify-center bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-extrabold rounded-lg text-xs shrink-0 border border-emerald-200"
        >
          +15 phút
        </button>
        <button
          type="button"
          onClick={() => handleAddOffset(30, 'minute')}
          className="px-3 py-2 min-h-[40px] flex items-center justify-center bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-extrabold rounded-lg text-xs shrink-0 border border-emerald-200"
        >
          +30 phút
        </button>
        <button
          type="button"
          onClick={() => handleAddOffset(1, 'hour')}
          className="px-3 py-2 min-h-[40px] flex items-center justify-center bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-extrabold rounded-lg text-xs shrink-0 border border-emerald-200"
        >
          +1 giờ
        </button>
        <button
          type="button"
          onClick={() => handleAddOffset(2, 'hour')}
          className="px-3 py-2 min-h-[40px] flex items-center justify-center bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-extrabold rounded-lg text-xs shrink-0 border border-emerald-200"
        >
          +2 giờ
        </button>
      </div>
    </div>
  );
};

export default EasyTimePicker;
