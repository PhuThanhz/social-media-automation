import { useQuery } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import api from '../../config/axios';

/**
 * Lịch đăng chung — nguồn sự thật duy nhất nằm ở server (bảng app_settings):
 * khung giờ đăng, giãn cách giữa 2 bài cùng nick, giới hạn bài/giờ/nick.
 * Mọi nơi đăng bài chỉ chọn 1 trong 3 cách: Đăng ngay / Xếp vào lịch / Hẹn giờ cụ thể.
 */

export type ScheduleMode = 'NOW' | 'QUEUE' | 'AT';

export type ScheduleValue = {
  mode: ScheduleMode;
  at?: Dayjs | null;
  intervalMinutes?: number;
};

export type PostingWindow = {
  enabled: boolean;
  start: string;
  end: string;
  minGapSeconds: number;
  maxPostsPerHourPerNick?: number;
};

export type WindowSuggestion = { toTargetFanpageId: string; toName: string; postIds: number[] };

export type WindowLane = {
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

export const POSTING_WINDOW_QUERY_KEY = ['postingWindowPlan'];
export const POSTING_SETTINGS_QUERY_KEY = ['postingWindowSettings'];

/** Kế hoạch hàng đợi + khung giờ (badge header, Drawer cài đặt, gợi ý trong bộ chọn giờ). */
export function usePostingPlan(refetchInterval = 20000) {
  return useQuery<WindowPlan>({
    queryKey: POSTING_WINDOW_QUERY_KEY,
    queryFn: async () => (await api.get('/queue/window-plan')).data,
    refetchInterval,
  });
}

/** Cài đặt lịch đăng (gồm cả giới hạn bài/giờ/nick, không có trong window-plan). */
export function usePostingSettings() {
  return useQuery<PostingWindow>({
    queryKey: POSTING_SETTINGS_QUERY_KEY,
    queryFn: async () => (await api.get('/queue/posting-window')).data,
    staleTime: 60000,
  });
}

// "21:45 hôm nay" / "09:30 ngày mai" / "09:30 18/10"
export const formatWhen = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const t = dayjs(iso);
  const today = dayjs().startOf('day');
  if (t.isSame(today, 'day')) return `${t.format('HH:mm')} hôm nay`;
  if (t.isSame(today.add(1, 'day'), 'day')) return `${t.format('HH:mm')} ngày mai`;
  return t.format('HH:mm DD/MM');
};

export const gapMinutesOf = (w?: Pick<PostingWindow, 'minGapSeconds'> | null) =>
  Math.max(1, Math.round((w?.minGapSeconds || 120) / 60));

/** Giờ hẹn có nằm trong khung giờ đăng không (khung tắt = luôn hợp lệ). */
export const isInsideWindow = (t: Dayjs, w?: PostingWindow | null) => {
  if (!w || !w.enabled) return true;
  const hm = t.format('HH:mm');
  return hm >= w.start && hm < w.end;
};

const OPEN_EVENT = 'open-schedule-settings';

/** Mở bảng "Cài đặt lịch đăng" (Drawer gắn ở badge hàng đợi trên header) từ bất kỳ trang nào. */
export const openScheduleSettings = () => window.dispatchEvent(new Event(OPEN_EVENT));

export const onOpenScheduleSettings = (handler: () => void) => {
  window.addEventListener(OPEN_EVENT, handler);
  return () => window.removeEventListener(OPEN_EVENT, handler);
};

export const toLocalIso = (t: Dayjs) => t.format('YYYY-MM-DDTHH:mm:ss');

/** Body gửi lên server: {scheduleMode, scheduledAt?, intervalMinutes?, gapSeconds?}. Server tự xếp giờ cho NOW / QUEUE. */
export const schedulePayload = (v: ScheduleValue) => {
  const interval = v.intervalMinutes || 20;
  return {
    scheduleMode: v.mode,
    publishNow: v.mode === 'NOW',
    // Cờ cũ để backend chưa cập nhật vẫn hiểu "Xếp vào lịch" = nối đuôi hàng đợi
    appendToQueue: v.mode === 'QUEUE',
    intervalMinutes: interval,
    gapSeconds: interval * 60,
    ...(v.mode === 'AT' && v.at ? { scheduledAt: toLocalIso(v.at) } : {}),
  };
};

export const scheduleModeLabel: Record<ScheduleMode, string> = {
  NOW: 'Đăng ngay',
  QUEUE: 'Xếp vào lịch',
  AT: 'Hẹn giờ',
};
