import type { GroupStatItem } from './types';

export const EMPTY_GROUP_STAT: GroupStatItem = {
  publishedToday: 0,
  publishedThisWeek: 0,
  publishedThisMonth: 0,
  pendingCount: 0,
  failedCount: 0,
  pendingByPage: new Map(),
  pendingPagesList: [],
  nextScheduledAt: null,
  lastScheduledAt: null,
  todayFinishTimeText: null,
  avgGapMinutes: null,
  hourlySlots: [],
};

export const PAGE_PALETTE = [
  { bg: 'bg-blue-500', text: 'text-blue-300', border: 'border-blue-500/40', tagColor: 'blue', fill: '#3b82f6' },
  { bg: 'bg-purple-500', text: 'text-purple-300', border: 'border-purple-500/40', tagColor: 'purple', fill: '#a855f7' },
  { bg: 'bg-emerald-500', text: 'text-emerald-300', border: 'border-emerald-500/40', tagColor: 'green', fill: '#10b981' },
  { bg: 'bg-amber-500', text: 'text-amber-300', border: 'border-amber-500/40', tagColor: 'gold', fill: '#f59e0b' },
  { bg: 'bg-rose-500', text: 'text-rose-300', border: 'border-rose-500/40', tagColor: 'volcano', fill: '#f43f5e' },
  { bg: 'bg-cyan-500', text: 'text-cyan-300', border: 'border-cyan-500/40', tagColor: 'cyan', fill: '#06b6d4' },
  { bg: 'bg-pink-500', text: 'text-pink-300', border: 'border-pink-500/40', tagColor: 'magenta', fill: '#ec4899' },
  { bg: 'bg-indigo-500', text: 'text-indigo-300', border: 'border-indigo-500/40', tagColor: 'geekblue', fill: '#6366f1' },
];

export const stripEmojiPrefix = (name?: string) =>
  (name || '').replace(/^[^\p{L}\p{N}@]+/gu, '').trim();

export const cleanMarkdownAsterisks = (text: string | null | undefined): string => {
  if (!text) return '';
  return text
    .replace(/\*{2,}/g, '')
    .replace(/(^|[^\*])\*([^\*\r\n]+)\*([^\*]|$)/g, '$1$2$3')
    .replace(/^[ \t]*\*+[ \t]*/gm, '')
    .replace(/[ \t]*\*+[ \t]*$/gm, '')
    .trim();
};

export const DEFAULT_SAVED_COMMENT = `🐱 Mời mọi người ghé “Nhà Mèo Mồ Côi” một chút nha! 🐾💗
Mọi người có thể ghé link xem thử, không mua cũng không sao đâu ạ 🥰 Chỉ cần mỗi lượt ghé thăm, và nếu có phát sinh đơn hàng thì một phần nhỏ cũng sẽ góp thêm vào việc chăm sóc các bé mèo hoang, mèo mồ côi 🐈⬛🏠
👉 https://s.shopee.vn/9fLALT7wfw
Cảm ơn mọi người đã dành chút yêu thương cho các em 🥹🐾💗`;

export const STORAGE_KEY_COMMENT = 'autopost_default_affiliate_comment';
