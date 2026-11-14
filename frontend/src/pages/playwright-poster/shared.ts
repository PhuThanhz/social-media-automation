import type { GroupStatItem, SocialAccount } from './types';

export const stripVietnameseAccents = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export const filterSelectByLabel = (input: string, option?: { label?: unknown }) => {
  const label = String(option?.label || '').toLowerCase();
  const query = input.toLowerCase();
  return label.includes(query) || stripVietnameseAccents(label).includes(stripVietnameseAccents(query));
};

export interface ScrapeAccountOption {
  id: number;
  cUser: string;
  name: string;
  isPersonalVia: boolean;
  isHealthy: boolean;
  tokenStatus?: SocialAccount['tokenStatus'];
  account: SocialAccount;
}

export const extractCookieCUser = (cookie?: string): string => {
  const m = String(cookie || '').match(/(?:^|;\s*)c_user=(\d+)/);
  return m ? m[1] : '';
};

/**
 * Gom danh sách Via/Cookie dùng để quét Group & Fanpage, ưu tiên Via cá nhân (FACEBOOK_PROFILE)
 * và gộp trùng theo `c_user` để tránh lặp hàng chục Fanpage cùng dùng chung 1 Via mẹ.
 */
export const buildScrapeAccountOptions = (socialAccounts: SocialAccount[] = []): ScrapeAccountOption[] => {
  const withToken = (socialAccounts || []).filter((a) => a.accessToken && a.accessToken.trim().length > 0);
  const isPersonal = (a: SocialAccount) =>
    a.platform === 'FACEBOOK_PROFILE' || a.accountType === 'PERSONAL_PROFILE_COOKIE';
  const isOk = (a: SocialAccount) => a.tokenStatus === 'OK';

  // Sắp xếp: Via cá nhân OK → Via cá nhân khác → Page OK (ưu tiên Làm Sen) → Page khác
  const ranked = [...withToken].sort((a, b) => {
    const score = (x: SocialAccount) =>
      (isPersonal(x) ? 100 : 0) +
      (isOk(x) ? 50 : x.tokenStatus === 'EXPIRING_SOON' ? 20 : 0) +
      (x.pageName?.toLowerCase().includes('làm sen') ? 5 : 0);
    return score(b) - score(a) || Number(b.id) - Number(a.id);
  });

  const seenKeys = new Set<string>();
  const options: ScrapeAccountOption[] = [];
  for (const acc of ranked) {
    const cUser = extractCookieCUser(acc.accessToken);
    const dedupKey = cUser ? `cuser:${cUser}` : `id:${acc.id}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);
    const personal = isPersonal(acc);
    options.push({
      id: acc.id,
      cUser,
      name: acc.pageName || (cUser ? `Via ${cUser}` : `Tài khoản #${acc.id}`),
      isPersonalVia: personal,
      isHealthy: isOk(acc),
      tokenStatus: acc.tokenStatus,
      account: acc,
    });
  }
  return options;
};

export const resolveActiveScrapeAccount = (
  options: ScrapeAccountOption[],
  selectedId: number | null | undefined,
): SocialAccount | undefined => {
  if (!options || options.length === 0) return undefined;
  if (selectedId != null) {
    const picked = options.find((o) => o.id === selectedId);
    if (picked) return picked.account;
  }
  return (options.find((o) => o.isPersonalVia && o.isHealthy) || options.find((o) => o.isHealthy) || options[0])?.account;
};

export const buildExtraGroupOptions = (
  groupAccountsWithId: SocialAccount[],
  primaryGroupIds: string[] = []
) => {
  const primarySet = new Set(primaryGroupIds.map(String));
  return (groupAccountsWithId || [])
    .filter((g) => g.platformAccountId && !primarySet.has(String(g.platformAccountId)))
    .map((g) => {
      const idStr = String(g.platformAccountId);
      const nameStr = g.pageName || idStr;
      return {
        value: idStr,
        label: `${nameStr} (${idStr})`,
        name: nameStr,
        healthStatus: g.groupHealthStatus,
      };
    });
};

export const resolveItemGroupTargets = (
  baseGroups: string[],
  extraGroupIds: string[] | undefined,
  distributionMode: 'PAGE_PER_GROUP' | 'ROUND_ROBIN_POSTS' | 'CROSS_ALL',
  itemIdx: number
): string[] => {
  const primaryForItem =
    distributionMode === 'ROUND_ROBIN_POSTS' && baseGroups.length > 0
      ? [baseGroups[itemIdx % baseGroups.length]]
      : baseGroups;
  const extras = (extraGroupIds || []).map(String).filter((g) => g.trim().length > 0);
  return Array.from(new Set([...primaryForItem, ...extras]));
};

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
