import { useEffect, useMemo, useState } from 'react';
import { Modal, Input, Button, DatePicker, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { usePostingSettings, isInsideWindow } from '../../components/common/postingSchedule';
import type { ItemPreview, PostLinkItem } from './types';

/** Bài có nội dung để đăng (cùng điều kiện với lúc bấm Đăng ở trang Đăng tự động). */
export const isComposableItem = (item: PostLinkItem) => {
  const hasUrl = !!item.url && item.url.trim().length > 0;
  const hasContent = (!!item.manualContent && item.manualContent.trim().length > 0) || (!!item.customCaption && item.customCaption.trim().length > 0);
  const hasMedia = (item.manualMediaUrls?.length || 0) > 0;
  return hasUrl || hasContent || hasMedia;
};

/** Giờ tự động của bài thứ idx: mốc Hẹn giờ + idx × giãn cách. */
export const autoTimeOf = (start: Dayjs, intervalMinutes: number, idx: number) =>
  start.add(idx * intervalMinutes, 'minute').second(0);

/** "9, 12:30, 18h, 21.15" → [{h:9,m:0}, {h:12,m:30}, ...] (đã sắp xếp, bỏ trùng, bỏ giờ sai). */
const parseMarks = (raw: string) => {
  const marks: { h: number; m: number }[] = [];
  for (const part of raw.split(/[,;\s]+/).filter(Boolean)) {
    const match = part.match(/^(\d{1,2})(?:[:h.](\d{1,2})?)?$/i);
    if (!match) continue;
    const h = Number(match[1]);
    const m = Number(match[2] || 0);
    if (h > 23 || m > 59) continue;
    if (!marks.some((x) => x.h === h && x.m === m)) marks.push({ h, m });
  }
  return marks.sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));
};

interface Props {
  open: boolean;
  onClose: () => void;
  items: PostLinkItem[];
  previews: Record<string, ItemPreview>;
  start: Dayjs;
  intervalMinutes: number;
  /** id bài → giờ người dùng đặt riêng. Bài không có trong map dùng giờ tự động. */
  onSave: (times: Record<string, Dayjs>) => void;
}

export default function PerPostTimesModal({ open, onClose, items, previews, start, intervalMinutes, onSave }: Props) {
  const { data: postingWindow } = usePostingSettings();
  const [draft, setDraft] = useState<Record<string, Dayjs>>({});
  const [marksText, setMarksText] = useState('');

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, Dayjs> = {};
    items.forEach((it) => { if (it.customTime && it.scheduledAt) initial[it.id] = it.scheduledAt; });
    setDraft(initial);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeOf = (it: PostLinkItem, idx: number) => draft[it.id] || autoTimeOf(start, intervalMinutes, idx);

  const applyMarks = () => {
    const marks = parseMarks(marksText);
    if (marks.length === 0) {
      message.warning('Nhập các mốc giờ, ví dụ: 9:00, 12:00, 18:00');
      return;
    }
    // Bài đầu vào mốc GẦN NHẤT sắp tới (tính từ giờ Hẹn, không sớm hơn bây giờ), các bài sau lần lượt
    // các mốc tiếp theo; hết mốc trong ngày thì sang ngày hôm sau.
    const next: Record<string, Dayjs> = {};
    const now = dayjs();
    let prev = start.isAfter(now) ? start.subtract(1, 'minute') : now;
    let day = prev.startOf('day');
    let markIdx = marks.findIndex((m) => day.hour(m.h).minute(m.m).second(0).isAfter(prev));
    if (markIdx < 0) {
      markIdx = 0;
      day = day.add(1, 'day');
    }
    items.forEach((it) => {
      const mark = marks[markIdx];
      let t = day.hour(mark.h).minute(mark.m).second(0);
      while (!t.isAfter(prev)) t = t.add(1, 'day');
      next[it.id] = t;
      prev = t;
      day = t.startOf('day');
      markIdx = (markIdx + 1) % marks.length;
      if (markIdx === 0) day = day.add(1, 'day');
    });
    setDraft(next);
  };

  const outsideCount = useMemo(
    () => items.filter((it, idx) => !isInsideWindow(timeOf(it, idx), postingWindow)).length,
    [items, draft, postingWindow, start, intervalMinutes], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const titleOf = (it: PostLinkItem) => {
    const caption = previews[it.id]?.caption || it.customCaption || it.manualContent || '';
    return caption.trim() ? caption.trim().replace(/\s+/g, ' ') : it.url || 'Bài soạn tay';
  };

  return (
    <Modal
      title="Giờ đăng từng bài"
      open={open}
      onCancel={onClose}
      width={640}
      footer={[
        <Button key="reset" onClick={() => setDraft({})} disabled={Object.keys(draft).length === 0}>
          Về giờ tự động
        </Button>,
        <Button key="cancel" onClick={onClose}>
          Huỷ
        </Button>,
        <Button
          key="save"
          type="primary"
          onClick={() => {
            onSave(draft);
            onClose();
          }}
        >
          Lưu giờ
        </Button>,
      ]}
    >
      <div className="ppt">
        <div className="ppt-marks">
          <Input
            value={marksText}
            onChange={(e) => setMarksText(e.target.value)}
            onPressEnter={applyMarks}
            placeholder="Rải theo mốc giờ, VD: 9:00, 12:00, 18:00"
          />
          <Button onClick={applyMarks}>Áp dụng</Button>
        </div>

        <ul className="ppt-list">
          {items.map((it, idx) => {
            const t = timeOf(it, idx);
            const outside = !isInsideWindow(t, postingWindow);
            return (
              <li key={it.id} className="ppt-row">
                <span className="ppt-index">{idx + 1}</span>
                <span className="ppt-title" title={titleOf(it)}>{titleOf(it)}</span>
                <span className={`ppt-mode ${draft[it.id] ? 'ppt-mode-custom' : ''}`}>{draft[it.id] ? 'Đã đặt' : 'Tự động'}</span>
                <DatePicker
                  size="small"
                  showTime={{ format: 'HH:mm' }}
                  format="HH:mm DD/MM"
                  value={t}
                  allowClear={false}
                  needConfirm={false}
                  status={outside ? 'warning' : undefined}
                  onChange={(v) => v && setDraft((d) => ({ ...d, [it.id]: v.second(0) }))}
                  className="ppt-picker"
                />
              </li>
            );
          })}
        </ul>

        {outsideCount > 0 && postingWindow?.enabled && (
          <div className="ppt-warn">
            {outsideCount} bài nằm ngoài khung giờ đăng {postingWindow.start}–{postingWindow.end}, sẽ bị dời vào trong khung.
          </div>
        )}
      </div>
    </Modal>
  );
}
