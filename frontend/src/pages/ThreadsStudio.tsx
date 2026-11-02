import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Avatar, Badge, Button, Card, Checkbox, DatePicker, Dropdown, Empty, Input, InputNumber, Modal, Radio, Segmented,
  Select, Space, Spin, Switch, Table, Tabs, Tooltip, Upload, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowLeftOutlined, ArrowRightOutlined, CheckCircleOutlined, ClockCircleOutlined, DeleteOutlined, DownOutlined, EditOutlined,
  EyeOutlined, GlobalOutlined, HistoryOutlined, InboxOutlined, LoadingOutlined, LoginOutlined, MoreOutlined, PlusOutlined,
  ReloadOutlined, RocketOutlined, ScheduleOutlined, SearchOutlined, SendOutlined, ThunderboltOutlined, UndoOutlined, UserAddOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import api from '../config/axios';

// ───────────────────────────── Types ─────────────────────────────
interface ThreadsAccount {
  id: number;
  pageName?: string;
  username?: string;
  tokenStatus?: string;
  tokenCheckedAt?: string;
  maxPostsPerDay?: number | null;
}

interface AccountInfo {
  loggedIn?: boolean;
  username?: string;
  fullName?: string;
  followers?: string | null;
  threadsCount?: string | null;
  avatarDataUrl?: string | null;
  profileUrl?: string;
}

interface ThreadsPost {
  id: number;
  accountId: number | null;
  content?: string;
  mediaUrls: string[];
  originalUrl?: string;
  status: string;
  scheduledAt?: string;
  publishedAt?: string;
  publishedPostUrl?: string;
  errorMessage?: string;
}

interface MediaItem {
  url: string;
  kind: 'image' | 'video';
}

interface PostItem {
  id: string;
  inputType: 'LINK' | 'MANUAL';
  url: string;
  fetched: boolean;
  fetching?: boolean;
  content: string;
  media: MediaItem[];
  author: string | null;
  includeCredit: boolean;
  isNow: boolean;
  scheduledAt: string | null;
  accountId: number | null;
}

type AiMode = 'REWRITE' | 'SHORTEN' | 'HOOK' | 'HASHTAG' | 'THREAD';

// ───────────────────────────── Helpers ─────────────────────────────
const MAX_CHARS = 500;
const MAX_MEDIA = 10;
const MAX_PARTS = 10;
const INFO_CACHE_KEY = 'threadsStudio.accountInfo';
const ITEMS_KEY = 'threadsStudio.items';
const SELECTED_KEY = 'threadsStudio.selectedAccounts';

// Giống hệt splitThreadsParts() của worker — để xem trước đúng cách bài sẽ được tách thành chuỗi.
function splitThreadsParts(text: string, maxChars = MAX_CHARS): string[] {
  const chunks = String(text || '').split(/\n\s*-{3,}\s*\n/).map((t) => t.trim()).filter(Boolean);
  const parts: string[] = [];
  for (const chunk of chunks) {
    let rest = chunk;
    while ([...rest].length > maxChars) {
      const win = [...rest].slice(0, maxChars).join('');
      let cut = win.lastIndexOf('\n\n');
      if (cut < maxChars * 0.4) {
        const ends = [...win.matchAll(/[.!?…](?=\s)|\n/g)].map((m) => (m.index ?? 0) + 1);
        const last = ends.length ? ends[ends.length - 1] : -1;
        cut = last >= maxChars * 0.4 ? last : win.lastIndexOf(' ');
      }
      if (cut <= 0) cut = win.length;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
  }
  return parts;
}

const guessKind = (url: string): 'image' | 'video' =>
  /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url) || /video/i.test(url.split('?')[0]) ? 'video' : 'image';

const newItem = (patch: Partial<PostItem> = {}): PostItem => ({
  id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  inputType: 'LINK',
  url: '',
  fetched: false,
  content: '',
  media: [],
  author: null,
  includeCredit: true,
  isNow: true,
  scheduledAt: null,
  accountId: null,
  ...patch,
});

const creditLine = (author: string) => `Cre: ${author.startsWith('@') ? author : '@' + author}`;

// Nội dung cuối cùng sẽ đăng của 1 bài (kèm dòng ghi nguồn nếu bật).
const finalContent = (item: PostItem) => {
  const base = item.content.trim();
  if (item.inputType === 'LINK' && item.includeCredit && item.author && !base.includes(creditLine(item.author))) {
    return base ? `${base}\n\n${creditLine(item.author)}` : creditLine(item.author);
  }
  return base;
};

const STATUS: Record<string, { label: string; badge: 'processing' | 'success' | 'error' | 'default' | 'warning' }> = {
  PENDING: { label: 'Chờ đăng', badge: 'default' },
  PROCESSING: { label: 'Đang đăng', badge: 'processing' },
  PUBLISHED: { label: 'Đã đăng', badge: 'success' },
  WARNING: { label: 'Đã đăng · có lưu ý', badge: 'warning' },
  FAILED: { label: 'Lỗi', badge: 'error' },
  CANCELLED: { label: 'Đã huỷ', badge: 'default' },
};

const AI_ACTIONS: { key: AiMode; label: string }[] = [
  { key: 'REWRITE', label: 'Viết lại cách khác' },
  { key: 'SHORTEN', label: 'Rút gọn dưới 500 ký tự' },
  { key: 'HOOK', label: 'Thêm câu mở đầu thu hút' },
  { key: 'HASHTAG', label: 'Thêm hashtag phù hợp' },
  { key: 'THREAD', label: 'Tách thành chuỗi nhiều phần' },
];

const errMsg = (err: any, fallback: string) => err?.response?.data?.message || err?.message || fallback;

const displayName = (acc?: ThreadsAccount, info?: AccountInfo) =>
  info?.fullName || (acc?.pageName || '').replace(/^Threads @/, '') || acc?.username || 'Nick Threads';

function AccountAvatar({ info, account, size = 36 }: { info?: AccountInfo; account?: ThreadsAccount; size?: number }) {
  return (
    <Avatar size={size} src={info?.avatarDataUrl || undefined} className="!bg-slate-700 !text-slate-100 !font-semibold shrink-0">
      {displayName(account, info).charAt(0).toUpperCase()}
    </Avatar>
  );
}

function ThreadsPreview({ content, media, account, info, when }: { content: string; media: MediaItem[]; account?: ThreadsAccount; info?: AccountInfo; when: string }) {
  const parts = splitThreadsParts(content);
  if (parts.length === 0 && media.length === 0) {
    return <div className="py-14 text-center text-[13px] text-neutral-500">Chưa có nội dung</div>;
  }
  return (
    <div className="rounded-xl border border-[#262626] bg-[#101010] p-4">
      {(parts.length ? parts : ['']).map((part, idx, arr) => (
        <div key={idx} className="flex gap-3">
          <div className="flex flex-col items-center">
            <AccountAvatar info={info} account={account} size={34} />
            {idx < arr.length - 1 && <div className="mt-1 w-px flex-1 bg-neutral-700" />}
          </div>
          <div className="min-w-0 flex-1 pb-4">
            <div className="flex items-center gap-1.5 text-[13px]">
              <span className="font-semibold text-neutral-100">{info?.username || account?.username || 'username'}</span>
              <span className="text-neutral-500">{when}</span>
              {arr.length > 1 && <span className="ml-auto text-[11px] text-neutral-500">{idx + 1}/{arr.length}</span>}
            </div>
            {part && <div className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-snug text-neutral-100">{part}</div>}
            {idx === 0 && media.length > 0 && (
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {media.map((m, i) => (
                  <div key={i} className={`shrink-0 overflow-hidden rounded-lg border border-neutral-800 bg-black ${media.length === 1 ? 'w-full max-h-[380px]' : 'h-48 w-36'}`}>
                    {m.kind === 'video'
                      ? <video src={m.url} className="h-full w-full object-cover" muted autoPlay loop playsInline />
                      : <img src={m.url} referrerPolicy="no-referrer" className="h-full w-full object-cover" alt="" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────── Page ─────────────────────────────
export default function ThreadsStudio() {
  const queryClient = useQueryClient();

  const [selectedIds, setSelectedIds] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem(SELECTED_KEY) || '[]'); } catch { return []; }
  });
  const [accountInfos, setAccountInfos] = useState<Record<number, AccountInfo>>(() => {
    try { return JSON.parse(localStorage.getItem(INFO_CACHE_KEY) || '{}'); } catch { return {}; }
  });
  const [checkingIds, setCheckingIds] = useState<number[]>([]);
  const [limitModal, setLimitModal] = useState<{ account: ThreadsAccount; value: number | null } | null>(null);

  // Thêm nick / đăng nhập lại
  const [accountModal, setAccountModal] = useState<{ open: boolean; account?: ThreadsAccount }>({ open: false });
  const [accountMethod, setAccountMethod] = useState<'BROWSER' | 'EXTENSION' | 'COOKIE'>('BROWSER');
  const [cookieInput, setCookieInput] = useState('');
  const [loginSession, setLoginSession] = useState<{ id: string; status: string; message?: string } | null>(null);
  const pollRef = useRef<number | null>(null);

  // Bài viết
  const [items, setItems] = useState<PostItem[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ITEMS_KEY) || 'null');
      if (Array.isArray(saved) && saved.length) return saved.map((it: PostItem) => ({ ...it, fetching: false }));
    } catch { /* ignore */ }
    return [newItem()];
  });
  const [intervalMinutes, setIntervalMinutes] = useState<number>(60);
  const [distribution, setDistribution] = useState<'ROUND_ROBIN' | 'ALL'>('ROUND_ROBIN');
  const [staggerMinutes, setStaggerMinutes] = useState<number>(5);
  const [varyContent, setVaryContent] = useState(false);
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);
  const [previousContents, setPreviousContents] = useState<Record<string, string>>({});
  const [uploadingIds, setUploadingIds] = useState<Record<string, number>>({});
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  // Lịch sử
  const [historyStatus, setHistoryStatus] = useState<string>('ALL');
  const [historyAccount, setHistoryAccount] = useState<number | 'ALL'>('ALL');
  const [historySearch, setHistorySearch] = useState('');
  const historyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { localStorage.setItem(INFO_CACHE_KEY, JSON.stringify(accountInfos)); }, [accountInfos]);
  useEffect(() => { localStorage.setItem(SELECTED_KEY, JSON.stringify(selectedIds)); }, [selectedIds]);
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(ITEMS_KEY, JSON.stringify(items)), 400);
    return () => clearTimeout(t);
  }, [items]);
  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

  // ── Data
  const { data: accounts = [], isLoading: accountsLoading, isError: accountsError } = useQuery({
    queryKey: ['threadsAccounts'],
    queryFn: async () => (await api.get('/threads/accounts')).data as ThreadsAccount[],
  });

  const { data: posts = [], isFetching: postsFetching, refetch: refetchPosts } = useQuery({
    queryKey: ['threadsPosts'],
    queryFn: async () => (await api.get('/threads/posts')).data as ThreadsPost[],
    refetchInterval: 8000,
  });

  useEffect(() => {
    if (accounts.length === 0) return;
    setSelectedIds((prev) => {
      const valid = prev.filter((id) => accounts.some((a) => a.id === id));
      if (valid.length > 0) return valid.length === prev.length ? prev : valid;
      const first = accounts.find((a) => a.tokenStatus !== 'EXPIRED') || accounts[0];
      return [first.id];
    });
  }, [accounts]);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const selectedAccounts = selectedIds.map((id) => accountById.get(id)).filter(Boolean) as ThreadsAccount[];
  const expiredSelected = selectedAccounts.filter((a) => a.tokenStatus === 'EXPIRED');
  const usernameOf = (a?: ThreadsAccount) => (a ? accountInfos[a.id]?.username || a.username : '');

  const todayCountByAccount = useMemo(() => {
    const today = dayjs().startOf('day');
    const map = new Map<number, number>();
    posts.forEach((p) => {
      if (p.accountId && (p.status === 'PUBLISHED' || p.status === 'WARNING') && p.publishedAt && dayjs(p.publishedAt).isAfter(today)) {
        map.set(p.accountId, (map.get(p.accountId) || 0) + 1);
      }
    });
    return map;
  }, [posts]);

  const counts = useMemo(() => ({
    all: posts.length,
    pending: posts.filter((p) => p.status === 'PENDING').length,
    processing: posts.filter((p) => p.status === 'PROCESSING').length,
    published: posts.filter((p) => p.status === 'PUBLISHED' || p.status === 'WARNING').length,
    failed: posts.filter((p) => p.status === 'FAILED').length,
    today: [...todayCountByAccount.values()].reduce((a, b) => a + b, 0),
  }), [posts, todayCountByAccount]);

  // ── Accounts
  const checkAccount = async (acc: ThreadsAccount, silent = false) => {
    setCheckingIds((ids) => [...ids, acc.id]);
    try {
      const res = await api.post(`/threads/accounts/${acc.id}/check`);
      const info: AccountInfo = res.data?.info || {};
      setAccountInfos((prev) => ({ ...prev, [acc.id]: info }));
      queryClient.invalidateQueries({ queryKey: ['threadsAccounts'] });
      if (!silent) {
        if (info.loggedIn) message.success(`@${info.username}: kết nối tốt`);
        else message.error(`${displayName(acc)}: cookie đã hết hạn — bấm "Đăng nhập lại"`);
      }
    } catch (err) {
      if (!silent) message.error(errMsg(err, 'Không kiểm tra được nick'));
    } finally {
      setCheckingIds((ids) => ids.filter((id) => id !== acc.id));
    }
  };

  useEffect(() => {
    const missing = accounts.find((a) => !accountInfos[a.id]);
    if (missing && checkingIds.length === 0) checkAccount(missing, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, accountInfos, checkingIds.length]);

  const onAccountSaved = (acc?: ThreadsAccount) => {
    queryClient.invalidateQueries({ queryKey: ['threadsAccounts'] });
    if (acc) {
      setAccountInfos((prev) => { const next = { ...prev }; delete next[acc.id]; return next; }); // lấy lại avatar/follower
      setSelectedIds((prev) => (prev.includes(acc.id) ? prev : [...prev, acc.id]));
      message.success(`Đã lưu nick @${acc.username}`);
    }
    closeAccountModal();
  };

  const stopPolling = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const closeAccountModal = () => {
    if (loginSession?.status === 'WAITING') api.post(`/threads/login/${loginSession.id}/cancel`).catch(() => {});
    stopPolling();
    setLoginSession(null);
    setCookieInput('');
    setAccountModal({ open: false });
  };

  const startBrowserLogin = async () => {
    try {
      const res = await api.post('/threads/login/start', accountModal.account ? { accountId: accountModal.account.id } : {});
      const id = res.data?.sessionId;
      setLoginSession({ id, status: 'WAITING', message: 'Đang mở cửa sổ Chrome…' });
      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const q = accountModal.account ? `?accountId=${accountModal.account.id}` : '';
          const st = (await api.get(`/threads/login/${id}${q}`)).data;
          setLoginSession({ id, status: st.status, message: st.message });
          if (st.status !== 'WAITING') {
            stopPolling();
            if (st.status === 'SUCCESS') onAccountSaved(st.account);
          }
        } catch { /* thử lại ở lượt sau */ }
      }, 2000);
    } catch (err) {
      message.error(errMsg(err, 'Không mở được cửa sổ đăng nhập'));
    }
  };

  const cookieMutation = useMutation({
    mutationFn: async () => (await api.post('/threads/accounts', {
      cookieString: cookieInput.trim(),
      accountId: accountModal.account?.id,
    })).data,
    onSuccess: (data) => onAccountSaved(data?.account),
    onError: (err) => message.error(errMsg(err, 'Không lưu được cookie')),
  });

  const limitMutation = useMutation({
    mutationFn: async ({ id, value }: { id: number; value: number | null }) =>
      (await api.patch(`/threads/accounts/${id}`, { maxPostsPerDay: value ?? '' })).data,
    onSuccess: () => {
      message.success('Đã lưu giới hạn bài/ngày');
      setLimitModal(null);
      queryClient.invalidateQueries({ queryKey: ['threadsAccounts'] });
    },
    onError: (err) => message.error(errMsg(err, 'Lưu giới hạn thất bại')),
  });

  const removeAccount = (acc: ThreadsAccount) => Modal.confirm({
    title: `Xoá nick @${usernameOf(acc)}?`,
    content: 'Nick sẽ bị gỡ khỏi hệ thống. Các bài đã đăng trên Threads không bị ảnh hưởng.',
    okText: 'Xoá nick', okButtonProps: { danger: true }, cancelText: 'Huỷ',
    onOk: async () => {
      await api.delete(`/connections/${acc.id}`);
      setSelectedIds((prev) => prev.filter((id) => id !== acc.id));
      queryClient.invalidateQueries({ queryKey: ['threadsAccounts'] });
      message.success('Đã xoá nick');
    },
  });

  const toggleSelected = (id: number) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // ── Items
  const updateItem = (id: string, patch: Partial<PostItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const addItem = () => setItems((prev) => {
    const last = prev[prev.length - 1];
    const base = !last || last.isNow || !last.scheduledAt ? dayjs() : dayjs(last.scheduledAt);
    return [...prev, newItem({ isNow: false, scheduledAt: base.add(intervalMinutes, 'minute').second(0).toISOString(), inputType: last?.inputType || 'LINK' })];
  });

  const fetchItem = async (item: PostItem): Promise<PostItem | null> => {
    updateItem(item.id, { fetching: true });
    try {
      const data = (await api.post('/queue/preview-url', { url: item.url.trim() })).data;
      if (!data?.success || !data.item) {
        message.warning(`Bài ${items.findIndex((i) => i.id === item.id) + 1}: ${data?.message || 'không lấy được nội dung'}`);
        updateItem(item.id, { fetching: false });
        return null;
      }
      const src = data.item;
      const urls: string[] = Array.isArray(src.mediaUrls) ? src.mediaUrls : [];
      const kinds: string[] = Array.isArray(src.mediaKinds) ? src.mediaKinds : [];
      const patch: Partial<PostItem> = {
        fetching: false,
        fetched: true,
        content: String(src.content || src.title || '').trim(),
        media: urls.slice(0, MAX_MEDIA).map((u, i) => ({ url: u, kind: (kinds[i] as 'image' | 'video') || guessKind(u) })),
        author: src.author ? String(src.author) : null,
      };
      updateItem(item.id, patch);
      return { ...item, ...patch };
    } catch (err) {
      message.error(errMsg(err, 'Lấy nội dung từ link thất bại'));
      updateItem(item.id, { fetching: false });
      return null;
    }
  };

  const runAi = async (item: PostItem, mode: AiMode) => {
    if (!item.content.trim()) {
      message.info('Bài này chưa có nội dung để AI viết lại');
      return;
    }
    setAiLoadingId(item.id);
    try {
      const res = await api.post('/threads/ai-rewrite', { content: item.content, mode });
      if (res.data?.success && res.data.content) {
        setPreviousContents((prev) => ({ ...prev, [item.id]: item.content }));
        updateItem(item.id, { content: res.data.content });
      } else {
        message.warning(res.data?.message || 'AI không trả kết quả');
      }
    } catch (err) {
      message.error(errMsg(err, 'AI viết lại thất bại'));
    } finally {
      setAiLoadingId(null);
    }
  };

  const uploadFile = async (itemId: string, file: File) => {
    setUploadingIds((m) => ({ ...m, [itemId]: (m[itemId] || 0) + 1 }));
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post('/media/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (res.data?.success) {
        setItems((prev) => prev.map((it) => (it.id === itemId && it.media.length < MAX_MEDIA
          ? { ...it, media: [...it.media, { url: res.data.url, kind: res.data.mediaType === 'video' ? 'video' : 'image' }] }
          : it)));
      } else {
        message.error(res.data?.message || `Tải ${file.name} thất bại`);
      }
    } catch (err) {
      message.error(errMsg(err, `Tải ${file.name} thất bại`));
    } finally {
      setUploadingIds((m) => ({ ...m, [itemId]: (m[itemId] || 1) - 1 }));
    }
  };

  const moveMedia = (item: PostItem, idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= item.media.length) return;
    const next = [...item.media];
    [next[idx], next[j]] = [next[j], next[idx]];
    updateItem(item.id, { media: next });
  };

  const isItemReady = (it: PostItem) => (it.inputType === 'LINK' ? !!it.url.trim() : !!(it.content.trim() || it.media.length));
  const readyItems = items.filter(isItemReady);
  const firstIsNow = readyItems[0]?.isNow ?? true;

  // Nick sẽ đăng cho bài thứ idx (theo thứ tự các bài hợp lệ)
  const accountsForItem = (it: PostItem, idx: number): number[] => {
    if (it.accountId) return [it.accountId];
    if (selectedIds.length === 0) return [];
    if (distribution === 'ALL') return selectedIds;
    return [selectedIds[idx % selectedIds.length]];
  };

  const handleSubmit = async () => {
    if (selectedIds.length === 0 && readyItems.some((it) => !it.accountId)) {
      message.warning('Chọn ít nhất 1 nick Threads ở bước 1');
      return;
    }
    if (readyItems.some((it) => !it.isNow && !it.scheduledAt)) {
      message.warning('Có bài đang Hẹn giờ nhưng chưa chọn giờ');
      return;
    }
    let created = 0;
    const failed: number[] = [];
    const doneIds: string[] = [];
    for (let i = 0; i < readyItems.length; i++) {
      let it = readyItems[i];
      setSubmitting(`Đang xử lý bài ${i + 1}/${readyItems.length}…`);
      if (it.inputType === 'LINK' && !it.fetched) {
        // eslint-disable-next-line no-await-in-loop
        const fetched = await fetchItem(it);
        if (!fetched) { failed.push(i + 1); continue; }
        it = fetched;
      }
      const content = finalContent(it);
      if (!content && it.media.length === 0) { failed.push(i + 1); continue; }
      if (splitThreadsParts(content).length > MAX_PARTS) { failed.push(i + 1); continue; }
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await api.post('/threads/posts', {
          accountIds: accountsForItem(it, i),
          content,
          mediaUrls: it.media.map((m) => m.url),
          sourceUrl: it.inputType === 'LINK' ? it.url.trim() : undefined,
          publishNow: it.isNow,
          scheduledAt: !it.isNow && it.scheduledAt ? dayjs(it.scheduledAt).format('YYYY-MM-DDTHH:mm:ss') : undefined,
          staggerMinutes,
          varyContent: varyContent && accountsForItem(it, i).length > 1,
        });
        created += res.data?.count || 1;
        doneIds.push(it.id);
      } catch (err) {
        failed.push(i + 1);
        message.error(`Bài ${i + 1}: ${errMsg(err, 'tạo bài thất bại')}`);
      }
    }
    setSubmitting(null);
    queryClient.invalidateQueries({ queryKey: ['threadsPosts'] });
    if (created > 0) {
      message.success(`Đã xếp ${created} bài vào hàng đợi Threads${failed.length ? ` · lỗi ở bài ${failed.join(', ')}` : ''}`);
      setItems((prev) => {
        const left = prev.filter((it) => !doneIds.includes(it.id));
        return left.length ? left : [newItem()];
      });
      historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (failed.length) {
      message.error(`Không tạo được bài nào (lỗi ở bài ${failed.join(', ')})`);
    }
  };

  // ── History
  const requeueMutation = useMutation({
    mutationFn: async (id: number) => (await api.post(`/threads/posts/${id}/requeue`)).data,
    onSuccess: () => {
      message.success('Đã đưa bài vào hàng đợi');
      queryClient.invalidateQueries({ queryKey: ['threadsPosts'] });
    },
    onError: (err) => message.error(errMsg(err, 'Không đăng lại được')),
  });

  const reuse = (p: ThreadsPost) => {
    const isLink = !!p.originalUrl && !p.originalUrl.startsWith('threads-studio://');
    setItems((prev) => [...prev.filter(isItemReady), newItem({
      inputType: isLink ? 'LINK' : 'MANUAL',
      url: isLink ? p.originalUrl! : '',
      fetched: true,
      content: p.content || '',
      media: (p.mediaUrls || []).map((u) => ({ url: u, kind: guessKind(u) })),
      includeCredit: false,
      accountId: p.accountId,
    })]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    message.info('Đã thêm bài vào danh sách soạn');
  };

  const filteredPosts = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return posts
      .filter((p) => historyAccount === 'ALL' || p.accountId === historyAccount)
      .filter((p) => historyStatus === 'ALL'
        || (historyStatus === 'PUBLISHED' ? (p.status === 'PUBLISHED' || p.status === 'WARNING') : p.status === historyStatus))
      .filter((p) => !q || (p.content || '').toLowerCase().includes(q));
  }, [posts, historyStatus, historyAccount, historySearch]);

  const columns: ColumnsType<ThreadsPost> = [
    {
      title: 'Bài đăng',
      key: 'post',
      render: (_, p) => {
        const n = splitThreadsParts(p.content || '').length;
        return (
          <div className="flex gap-3 min-w-[260px]">
            {p.mediaUrls?.[0] ? (
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-black">
                {guessKind(p.mediaUrls[0]) === 'video'
                  ? <video src={p.mediaUrls[0]} className="h-full w-full object-cover" muted preload="metadata" />
                  : <img src={p.mediaUrls[0]} referrerPolicy="no-referrer" className="h-full w-full object-cover" alt="" />}
              </div>
            ) : (
              <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-800 grid place-items-center text-slate-500 text-lg font-bold">@</div>
            )}
            <div className="min-w-0">
              <div className="line-clamp-2 text-[13px] text-slate-200">{p.content || <span className="text-slate-500">Chỉ có ảnh/video</span>}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                #{p.id}{p.mediaUrls?.length ? ` · ${p.mediaUrls.length} ảnh/video` : ''}{n > 1 ? ` · chuỗi ${n} phần` : ''}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      title: 'Nick',
      key: 'account',
      width: 170,
      render: (_, p) => {
        const acc = p.accountId ? accountById.get(p.accountId) : undefined;
        return (
          <div className="flex items-center gap-2">
            <AccountAvatar account={acc} info={acc ? accountInfos[acc.id] : undefined} size={24} />
            <span className="truncate text-xs text-slate-300">@{usernameOf(acc) || '—'}</span>
          </div>
        );
      },
    },
    {
      title: 'Thời gian',
      key: 'time',
      width: 120,
      render: (_, p) => {
        const t = p.publishedAt || p.scheduledAt;
        return t ? (
          <div className="text-xs">
            <div className="font-semibold text-slate-200">{dayjs(t).format('HH:mm')}</div>
            <div className="text-slate-500">{dayjs(t).format('DD/MM/YYYY')}</div>
          </div>
        ) : '—';
      },
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 190,
      render: (_, p) => {
        const s = STATUS[p.status] || { label: p.status, badge: 'default' as const };
        return (
          <div className="text-xs">
            <Badge status={s.badge} text={<span className="text-slate-200">{s.label}</span>} />
            {p.errorMessage && (
              <Tooltip title={p.errorMessage}>
                <div className={`mt-0.5 line-clamp-1 cursor-help ${p.status === 'WARNING' ? 'text-amber-400' : 'text-rose-400'}`}>{p.errorMessage}</div>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: '',
      key: 'actions',
      width: 150,
      align: 'right',
      render: (_, p) => {
        const canRequeue = p.status === 'FAILED' || p.status === 'CANCELLED';
        const canPostNow = p.status === 'PENDING' && dayjs(p.scheduledAt).isAfter(dayjs().add(1, 'minute'));
        return (
          <Space size={4}>
            {p.publishedPostUrl && <Button size="small" href={p.publishedPostUrl} target="_blank">Xem bài</Button>}
            {canRequeue && <Button size="small" loading={requeueMutation.isPending && requeueMutation.variables === p.id} onClick={() => requeueMutation.mutate(p.id)}>Đăng lại</Button>}
            {canPostNow && <Button size="small" loading={requeueMutation.isPending && requeueMutation.variables === p.id} onClick={() => requeueMutation.mutate(p.id)}>Đăng ngay</Button>}
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'reuse', label: 'Dùng lại bài này' },
                  { key: 'copy', label: 'Chép nội dung' },
                  ...(p.originalUrl && !p.originalUrl.startsWith('threads-studio://') ? [{ key: 'source', label: 'Mở link nguồn' }] : []),
                  ...(p.status !== 'PROCESSING' ? [{ type: 'divider' as const }, { key: 'delete', label: 'Xoá khỏi danh sách', danger: true }] : []),
                ],
                onClick: ({ key }) => {
                  if (key === 'reuse') reuse(p);
                  if (key === 'copy') { navigator.clipboard.writeText(p.content || ''); message.success('Đã chép nội dung'); }
                  if (key === 'source') window.open(p.originalUrl, '_blank');
                  if (key === 'delete') {
                    Modal.confirm({
                      title: 'Xoá bài này khỏi danh sách?',
                      content: 'Bài đã đăng trên Threads sẽ không bị xoá.',
                      okText: 'Xoá', okButtonProps: { danger: true }, cancelText: 'Huỷ',
                      onOk: async () => {
                        await api.delete(`/queue/${p.id}`);
                        queryClient.invalidateQueries({ queryKey: ['threadsPosts'] });
                      },
                    });
                  }
                },
              }}
            >
              <Button size="small" type="text" icon={<MoreOutlined />} />
            </Dropdown>
          </Space>
        );
      },
    },
  ];

  const previewItem = items.find((it) => it.id === previewItemId);
  const previewIdx = previewItem ? readyItems.findIndex((it) => it.id === previewItem.id) : -1;
  const previewAccount = previewItem ? accountById.get(accountsForItem(previewItem, Math.max(0, previewIdx))[0] ?? -1) : undefined;

  const submitLabel = firstIsNow ? 'Đăng ngay lên Threads' : 'Lên lịch lên Threads';

  // ───────────────────────────── Render ─────────────────────────────
  return (
    <div className="poster-page space-y-5">
      <section className="poster-hero">
        <div className="min-w-0">
          <div className="poster-eyebrow"><SendOutlined /> Threads</div>
          <h1>Đăng bài Threads</h1>
          <p>Chọn nick, thêm bài bằng link hoặc tự soạn, rồi đăng ngay hay hẹn giờ — hỗ trợ nhiều nick cùng lúc.</p>
        </div>
        <div className="poster-quick-note"><CheckCircleOutlined /> 3 bước · Khoảng 1–3 phút</div>
      </section>

      <Card className="poster-kpi-bar">
        <div className="poster-kpi-summary">
          <div className="poster-kpi-title">
            <span className="poster-kpi-icon"><ThunderboltOutlined /></span>
            <div>
              <strong>Hôm nay trên Threads</strong>
              <small>{dayjs().format('DD/MM/YYYY')} · {accounts.filter((a) => a.tokenStatus !== 'EXPIRED').length}/{accounts.length} nick hoạt động</small>
            </div>
          </div>
          <div className="poster-kpi-metrics">
            <span className="is-good"><b>{counts.today}</b> bài đã đăng</span>
            <span><b>{counts.pending + counts.processing}</b> bài chờ đăng</span>
            {counts.failed > 0 && <span className="is-pending"><b>{counts.failed}</b> bài lỗi</span>}
          </div>
          <div className="poster-kpi-actions">
            <Button size="small" onClick={() => historyRef.current?.scrollIntoView({ behavior: 'smooth' })}>Xem hàng đợi</Button>
          </div>
        </div>
      </Card>

      <Card className="poster-composer border border-slate-200 bg-white shadow-sm rounded-2xl">
        {/* BƯỚC 1 — Nick */}
        <section className="poster-form-section">
          <div className="poster-section-heading">
            <span className="poster-step-number">1</span>
            <div className="flex-1">
              <h2>Chọn nick Threads</h2>
              <p>Chọn một hoặc nhiều nick sẽ đăng bài.</p>
            </div>
            {accounts.length > 1 && (
              <Button size="small" onClick={() => setSelectedIds(selectedIds.length === accounts.length ? [] : accounts.filter((a) => a.tokenStatus !== 'EXPIRED').map((a) => a.id))}>
                {selectedIds.length === accounts.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
              </Button>
            )}
          </div>

          {accountsError && (
            <Alert className="!mb-3" type="error" showIcon message="Không tải được danh sách nick — backend chưa chạy bản mới hoặc đang khởi động lại." />
          )}

          {accountsLoading ? (
            <div className="py-8 text-center"><Spin /></div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-2">
              {accounts.map((acc) => {
                const info = accountInfos[acc.id];
                const active = selectedIds.includes(acc.id);
                const expired = acc.tokenStatus === 'EXPIRED';
                const checking = checkingIds.includes(acc.id);
                const today = todayCountByAccount.get(acc.id) || 0;
                return (
                  <div
                    key={acc.id}
                    role="checkbox"
                    aria-checked={active}
                    tabIndex={0}
                    onClick={() => toggleSelected(acc.id)}
                    onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleSelected(acc.id); } }}
                    className={`poster-mode relative flex items-center gap-3 p-3.5 rounded-xl text-left transition-all duration-200 border cursor-pointer select-none ${active
                      ? 'is-active bg-blue-50/60 border-blue-600 ring-2 ring-blue-500/10'
                      : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-slate-50/60'}`}
                  >
                    <div className="shrink-0 overflow-hidden">
                      <AccountAvatar info={info} account={acc} size={38} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold text-sm text-slate-800">{displayName(acc, info)}</div>
                      <div className="truncate text-xs text-slate-500">@{usernameOf(acc)}{info?.followers ? ` · ${info.followers} người theo dõi` : ''}</div>
                      <div className="mt-1 text-[11px]">
                        {checking ? <span className="text-slate-400"><LoadingOutlined /> Đang kiểm tra…</span>
                          : expired ? <span className="text-rose-500 font-semibold">● Cookie hết hạn</span>
                            : acc.tokenStatus === 'OK' ? <span className="text-emerald-500">● Hoạt động · hôm nay {today}{acc.maxPostsPerDay ? `/${acc.maxPostsPerDay}` : ''} bài</span>
                              : <span className="text-slate-400">● Chưa kiểm tra</span>}
                      </div>
                    </div>
                    {active && !expired && <CheckCircleOutlined className="absolute top-2.5 right-2.5 text-blue-500" />}
                    {expired ? (
                      <Button size="small" type="primary" danger icon={<LoginOutlined />}
                        onClick={(e) => { e.stopPropagation(); setAccountMethod('BROWSER'); setAccountModal({ open: true, account: acc }); }}>
                        Đăng nhập lại
                      </Button>
                    ) : null}
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          { key: 'check', label: 'Kiểm tra kết nối' },
                          { key: 'relogin', label: 'Đăng nhập lại / cập nhật cookie' },
                          { key: 'limit', label: 'Giới hạn bài mỗi ngày' },
                          { key: 'profile', label: 'Mở trang cá nhân' },
                          { key: 'history', label: 'Xem bài của nick này' },
                          { type: 'divider' },
                          { key: 'remove', label: 'Xoá nick', danger: true },
                        ],
                        onClick: ({ key, domEvent }) => {
                          domEvent.stopPropagation();
                          if (key === 'check') checkAccount(acc);
                          if (key === 'relogin') { setAccountMethod('BROWSER'); setAccountModal({ open: true, account: acc }); }
                          if (key === 'limit') setLimitModal({ account: acc, value: acc.maxPostsPerDay ?? null });
                          if (key === 'profile') window.open(info?.profileUrl || `https://www.threads.com/@${acc.username}`, '_blank');
                          if (key === 'history') { setHistoryAccount(acc.id); historyRef.current?.scrollIntoView({ behavior: 'smooth' }); }
                          if (key === 'remove') removeAccount(acc);
                        },
                      }}
                    >
                      <Button size="small" type="text" icon={<MoreOutlined />} onClick={(e) => e.stopPropagation()} aria-label="Tuỳ chọn nick" className="!mt-4" />
                    </Dropdown>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => { setAccountMethod('BROWSER'); setAccountModal({ open: true }); }}
                className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 p-3.5 min-h-[82px] text-sm font-semibold text-slate-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
              >
                <UserAddOutlined /> Thêm nick Threads
              </button>
            </div>
          )}

          {expiredSelected.length > 0 && (
            <Alert className="!mt-2" type="warning" showIcon
              message={`Nick ${expiredSelected.map((a) => '@' + usernameOf(a)).join(', ')} đã hết hạn cookie — bấm "Đăng nhập lại" trên thẻ nick, hoặc bỏ chọn để đăng bằng các nick còn lại.`} />
          )}
        </section>

        {/* BƯỚC 2 — Nội dung */}
        <section className="poster-form-section">
          <div className="poster-section-heading">
            <span className="poster-step-number">2</span>
            <div className="flex-1">
              <h2>Thêm nội dung</h2>
              <p>Dán link để tự lấy chữ và ảnh/video, hoặc tự soạn. Bài dài hơn 500 ký tự tự tách thành chuỗi thread.</p>
            </div>
          </div>

          <div className="poster-post-list space-y-3">
            {items.map((item, index) => {
              const readyIdx = readyItems.findIndex((it) => it.id === item.id);
              const targets = accountsForItem(item, Math.max(0, readyIdx));
              const content = finalContent(item);
              const parts = splitThreadsParts(content);
              const uploading = uploadingIds[item.id] || 0;
              const showEditor = item.inputType === 'MANUAL' || item.fetched;
              return (
                <div key={item.id} className="poster-post-card flex flex-col bg-white rounded-xl border border-slate-200 transition-all overflow-hidden">
                  <div className="poster-post-header">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="poster-post-number">{index + 1}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-800">Bài viết {index + 1}</div>
                        <div className={`text-[11px] ${isItemReady(item) ? 'text-emerald-600 font-semibold' : 'text-slate-400'}`}>
                          {item.inputType === 'LINK'
                            ? (item.fetched ? 'Đã lấy nội dung từ link' : item.url.trim() ? 'Đã nhận link nguồn' : 'Chưa có link nguồn')
                            : (isItemReady(item) ? 'Đã soạn nội dung' : 'Chưa nhập nội dung')}
                          {parts.length > 1 ? ` · chuỗi ${parts.length} phần` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="poster-post-header-actions flex items-center gap-2 flex-wrap">
                      <Select
                        size="small"
                        className="w-48 text-xs shrink-0"
                        value={item.accountId ?? 'AUTO'}
                        onChange={(v) => updateItem(item.id, { accountId: v === 'AUTO' ? null : Number(v) })}
                        options={[
                          {
                            value: 'AUTO',
                            label: selectedIds.length === 0 ? 'Theo nick ở bước 1'
                              : distribution === 'ALL' && selectedIds.length > 1 ? `Tất cả ${selectedIds.length} nick đã chọn`
                                : `@${usernameOf(accountById.get(targets[0] ?? -1)) || '…'}`,
                          },
                          ...accounts.filter((a) => a.tokenStatus !== 'EXPIRED').map((a) => ({ value: a.id, label: `Chỉ @${usernameOf(a)}` })),
                        ]}
                      />
                      <Segmented
                        size="small"
                        value={item.isNow ? 'NOW' : 'SCHEDULE'}
                        onChange={(val) => {
                          if (val === 'NOW') {
                            updateItem(item.id, { isNow: true });
                          } else {
                            updateItem(item.id, {
                              isNow: false,
                              scheduledAt: item.scheduledAt || dayjs().add(intervalMinutes, 'minute').second(0).toISOString(),
                            });
                          }
                        }}
                        options={[
                          { label: 'Đăng ngay', value: 'NOW', icon: <ThunderboltOutlined /> },
                          { label: 'Hẹn giờ', value: 'SCHEDULE', icon: <ClockCircleOutlined /> },
                        ]}
                        className="rounded-lg text-xs shrink-0"
                      />
                      {!item.isNow && (
                        <DatePicker size="small" showTime={{ format: 'HH:mm' }} format="HH:mm DD/MM" allowClear={false}
                          value={item.scheduledAt ? dayjs(item.scheduledAt) : null}
                          onChange={(d: Dayjs | null) => updateItem(item.id, { scheduledAt: d ? d.toISOString() : null })}
                          disabledDate={(d) => d.isBefore(dayjs().startOf('day'))} className="!w-36" />
                      )}
                      <Tooltip title="Xem trước như trên Threads">
                        <Button type="text" icon={<EyeOutlined />} className="poster-icon-action text-blue-600"
                          disabled={!content && item.media.length === 0} onClick={() => setPreviewItemId(item.id)} aria-label={`Xem trước bài ${index + 1}`} />
                      </Tooltip>
                      <Tooltip title="Xoá bài này">
                        <Button type="text" danger icon={<DeleteOutlined />} className="poster-icon-action" aria-label={`Xoá bài ${index + 1}`}
                          onClick={() => setItems((prev) => (prev.length === 1 ? [newItem()] : prev.filter((it) => it.id !== item.id)))} />
                      </Tooltip>
                    </div>
                  </div>

                  <div className="poster-post-body p-4 space-y-3">
                    <div className="poster-source-switch flex items-center justify-between gap-3 flex-wrap bg-slate-950/80 p-2.5 rounded-2xl border border-slate-800 shadow-md">
                      <Segmented
                        value={item.inputType}
                        onChange={(v) => updateItem(item.id, { inputType: v as 'LINK' | 'MANUAL' })}
                        options={[
                          { label: <span className="flex items-center gap-2 px-3 py-1 text-xs font-bold"><GlobalOutlined className="text-blue-400" /> Dán link cào tự động</span>, value: 'LINK' },
                          { label: <span className="flex items-center gap-2 px-3 py-1 text-xs font-bold"><EditOutlined className="text-emerald-400" /> Tự soạn nội dung</span>, value: 'MANUAL' },
                        ]}
                      />
                    </div>

                    {item.inputType === 'LINK' && (
                      <Space.Compact className="!w-full">
                        <Input
                          placeholder="Dán link Threads, TikTok, Facebook, Instagram…"
                          value={item.url}
                          onChange={(e) => updateItem(item.id, { url: e.target.value, fetched: false })}
                          onPressEnter={() => item.url.trim() && fetchItem(item)}
                        />
                        <Button type="primary" loading={item.fetching} disabled={!item.url.trim()} onClick={() => fetchItem(item)}>
                          {item.fetched ? 'Lấy lại' : 'Lấy nội dung'}
                        </Button>
                      </Space.Compact>
                    )}

                    {showEditor && (
                      <>
                        <Input.TextArea
                          value={item.content}
                          onChange={(e) => updateItem(item.id, { content: e.target.value })}
                          autoSize={{ minRows: 4, maxRows: 16 }}
                          placeholder="Có gì mới?"
                          className="!text-[14px] !leading-relaxed"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Space size={6} wrap>
                            <Dropdown trigger={['click']} disabled={aiLoadingId === item.id}
                              menu={{ items: AI_ACTIONS.map((a) => ({ key: a.key, label: a.label })), onClick: ({ key }) => runAi(item, key as AiMode) }}>
                              <Button size="small" loading={aiLoadingId === item.id}>Viết bằng AI <DownOutlined className="!text-[10px]" /></Button>
                            </Dropdown>
                            {previousContents[item.id] !== undefined && (
                              <Button size="small" type="text" icon={<UndoOutlined />}
                                onClick={() => { updateItem(item.id, { content: previousContents[item.id] }); setPreviousContents((p) => { const n = { ...p }; delete n[item.id]; return n; }); }}>
                                Hoàn tác
                              </Button>
                            )}
                            {item.inputType === 'LINK' && item.author && (
                              <Checkbox checked={item.includeCredit} onChange={(e) => updateItem(item.id, { includeCredit: e.target.checked })}>
                                <span className="text-xs">Ghi nguồn ({creditLine(item.author)})</span>
                              </Checkbox>
                            )}
                          </Space>
                          <span className={`text-xs font-mono ${parts.length > MAX_PARTS ? 'text-rose-500' : 'text-slate-400'}`}>
                            {parts.length > 1 ? `${[...content].length} ký tự · ${parts.length} phần` : `${[...(parts[0] || '')].length}/${MAX_CHARS}`}
                          </span>
                        </div>

                        {/* Media */}
                        <div className="flex flex-wrap gap-2">
                          {item.media.map((m, i) => (
                            <div key={m.url + i} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-slate-200 bg-black">
                              {m.kind === 'video'
                                ? <video src={m.url} className="h-full w-full object-cover" muted preload="metadata" />
                                : <img src={m.url} referrerPolicy="no-referrer" className="h-full w-full object-cover" alt="" />}
                              {m.kind === 'video' && <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[9px] font-semibold text-white">VIDEO</span>}
                              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/75 opacity-0 transition-opacity group-hover:opacity-100">
                                <Button size="small" type="text" icon={<ArrowLeftOutlined />} className="!text-white !w-6" disabled={i === 0} onClick={() => moveMedia(item, i, -1)} />
                                <Button size="small" type="text" icon={<DeleteOutlined />} className="!text-white !w-6" onClick={() => updateItem(item.id, { media: item.media.filter((_, k) => k !== i) })} />
                                <Button size="small" type="text" icon={<ArrowRightOutlined />} className="!text-white !w-6" disabled={i === item.media.length - 1} onClick={() => moveMedia(item, i, 1)} />
                              </div>
                            </div>
                          ))}
                          {item.media.length < MAX_MEDIA && (
                            <Upload
                              multiple
                              showUploadList={false}
                              accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/quicktime,video/webm"
                              beforeUpload={(file) => { uploadFile(item.id, file as File); return false; }}
                            >
                              <div className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-700 bg-slate-900/40 text-[11px] text-slate-400 hover:border-blue-500 hover:text-blue-400 transition-colors cursor-pointer">
                                {uploading > 0 ? <LoadingOutlined /> : <InboxOutlined className="text-lg" />}
                                {uploading > 0 ? 'Đang tải…' : 'Ảnh/video'}
                              </div>
                            </Upload>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <Button type="dashed" block icon={<PlusOutlined />} onClick={addItem}
            className="poster-add-post mt-3.5 min-h-[54px] rounded-xl flex items-center justify-center">
            <span className="font-bold">Thêm bài viết tiếp theo</span>
            <span className="hidden sm:inline font-normal text-slate-400"> · tự hẹn sau </span>
            <InputNumber size="small" min={5} max={1440} value={intervalMinutes} onChange={(v) => setIntervalMinutes(v || 60)}
              onClick={(e) => e.stopPropagation()} variant="borderless" className="!w-14 hidden sm:inline-block" />
            <span className="hidden sm:inline font-normal text-slate-400">phút</span>
          </Button>
        </section>

        {/* BƯỚC 3 — Phân phối nhiều nick */}
        {selectedIds.length > 1 && (
          <section className="poster-form-section">
            <div className="poster-section-heading">
              <span className="poster-step-number">3</span>
              <div>
                <h2>Phân phối cho {selectedIds.length} nick</h2>
                <p>Chọn cách chia bài cho các nick đã chọn ở bước 1.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4" role="radiogroup">
              {[
                { id: 'ROUND_ROBIN', title: 'Chia đều bài cho các nick', sub: 'Bài 1 → nick thứ nhất, bài 2 → nick thứ hai… lần lượt xoay vòng.', icon: <SendOutlined /> },
                { id: 'ALL', title: 'Mỗi bài đăng lên tất cả nick', sub: 'Mỗi bài được đăng trên từng nick đã chọn, lệch giờ nhau.', icon: <RocketOutlined /> },
              ].map((mode) => {
                const active = distribution === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setDistribution(mode.id as 'ROUND_ROBIN' | 'ALL')}
                    className={`poster-mode relative flex items-start gap-3 p-4 rounded-xl min-h-[78px] text-left transition-all duration-200 border cursor-pointer select-none ${active
                      ? 'is-active bg-blue-50/60 border-blue-600 ring-2 ring-blue-500/10'
                      : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-slate-50/60'}`}
                  >
                    <div className={`p-3 rounded-lg shrink-0 transition-colors ${active ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-200/80 text-slate-600'}`}>{mode.icon}</div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-xs sm:text-sm leading-snug text-slate-800">{mode.title}</div>
                      <div className="text-xs text-slate-500 mt-1 leading-relaxed">{mode.sub}</div>
                    </div>
                    {active && <CheckCircleOutlined className="absolute top-3 right-3 text-blue-600" />}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
              <label className="flex items-center gap-2 text-slate-600">
                Các nick lệch nhau
                <InputNumber size="small" min={0} max={720} value={staggerMinutes} onChange={(v) => setStaggerMinutes(v ?? 0)} className="!w-20" /> phút
              </label>
              {distribution === 'ALL' && (
                <label className="flex items-center gap-2 text-slate-600">
                  <Switch size="small" checked={varyContent} onChange={setVaryContent} />
                  AI viết lại nội dung khác nhau cho từng nick
                </label>
              )}
            </div>
          </section>
        )}

        <div className="poster-submit-bar flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            {submitting || (readyItems.length
              ? `${readyItems.length} bài viết · ${selectedIds.length || 0} nick. ${firstIsNow ? 'Bài đầu tiên sẽ được ĐĂNG NGAY.' : 'Toàn bộ bài chạy theo lịch hẹn.'}`
              : 'Dán link hoặc soạn nội dung để bắt đầu.')}
          </span>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
            <Button size="large" className="rounded-xl font-semibold text-xs min-w-24" disabled={!!submitting}
              onClick={() => { setItems([newItem()]); setPreviousContents({}); }}>
              Đặt lại
            </Button>
            <Button
              type="primary"
              size="large"
              loading={!!submitting}
              icon={firstIsNow ? <RocketOutlined /> : <ScheduleOutlined />}
              disabled={readyItems.length === 0 || (selectedIds.length === 0 && readyItems.some((it) => !it.accountId)) || expiredSelected.length > 0}
              onClick={handleSubmit}
              className={`poster-submit-primary rounded-xl font-extrabold h-12 px-6 text-sm sm:text-base shadow-md w-full sm:w-auto ${firstIsNow ? '!bg-blue-600 hover:!bg-blue-700' : '!bg-indigo-600 hover:!bg-indigo-700'}`}
            >
              {submitLabel}
            </Button>
          </div>
        </div>
      </Card>

      {/* LỊCH SỬ */}
      <div ref={historyRef}>
        <Card
          className="poster-history-card border border-slate-700/60 bg-slate-900/90 shadow-lg rounded-2xl overflow-hidden"
          styles={{ body: { padding: '16px 20px 20px' } }}
          title={
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-1">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center text-sm shrink-0 border border-blue-500/25">
                  <HistoryOutlined />
                </div>
                <span className="font-bold text-base text-slate-100">Lịch sử & Hàng đợi Threads</span>
                <span className="px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-mono text-xs font-bold border border-blue-400/30">
                  {filteredPosts.length} / {posts.length} bài
                </span>
              </div>
              <Tooltip title="Tải lại"><Button size="small" icon={<ReloadOutlined spin={postsFetching} />} onClick={() => refetchPosts()} /></Tooltip>
            </div>
          }
        >
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 mb-4">
            <Segmented
              value={historyStatus}
              onChange={(v) => setHistoryStatus(v as string)}
              options={[
                { label: `Tất cả ${counts.all}`, value: 'ALL' },
                { label: `Đang đăng ${counts.processing}`, value: 'PROCESSING' },
                { label: `Chờ đăng ${counts.pending}`, value: 'PENDING' },
                { label: `Đã đăng ${counts.published}`, value: 'PUBLISHED' },
                { label: `Lỗi ${counts.failed}`, value: 'FAILED' },
              ]}
            />
            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={historyAccount} onChange={setHistoryAccount} className="sm:!w-48"
                options={[{ value: 'ALL', label: 'Tất cả nick' }, ...accounts.map((a) => ({ value: a.id, label: `@${usernameOf(a)}` }))]} />
              <Input allowClear prefix={<SearchOutlined className="text-slate-500" />} placeholder="Tìm theo nội dung" value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)} className="sm:!w-60" />
            </div>
          </div>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={filteredPosts}
            pagination={{ pageSize: 15, size: 'small', hideOnSinglePage: true }}
            scroll={{ x: 820 }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có bài nào" /> }}
          />
        </Card>
      </div>

      {/* Xem trước */}
      <Modal open={!!previewItem} onCancel={() => setPreviewItemId(null)} footer={null} title="Xem trước trên Threads" width={480}>
        {previewItem && (
          <ThreadsPreview
            content={finalContent(previewItem)}
            media={previewItem.media}
            account={previewAccount}
            info={previewAccount ? accountInfos[previewAccount.id] : undefined}
            when={!previewItem.isNow && previewItem.scheduledAt ? dayjs(previewItem.scheduledAt).format('HH:mm DD/MM') : 'Vừa xong'}
          />
        )}
      </Modal>

      {/* Thêm nick / đăng nhập lại */}
      <Modal
        open={accountModal.open}
        onCancel={closeAccountModal}
        footer={null}
        width={560}
        title={accountModal.account ? `Đăng nhập lại @${usernameOf(accountModal.account)}` : 'Thêm nick Threads'}
      >
        <Tabs
          activeKey={accountMethod}
          onChange={(k) => setAccountMethod(k as 'BROWSER' | 'EXTENSION' | 'COOKIE')}
          items={[
            {
              key: 'BROWSER',
              label: 'Đăng nhập bằng Chrome',
              children: (
                <div className="space-y-3">
                  <ol className="m-0 pl-5 text-[13px] leading-relaxed text-slate-400 space-y-1">
                    <li>Bấm nút bên dưới — một cửa sổ Chrome sẽ mở trên máy tính đang chạy hệ thống.</li>
                    <li>Đăng nhập Threads như bình thường (có thể chọn “Tiếp tục bằng Instagram”).</li>
                    <li>Đăng nhập xong, hệ thống tự lấy cookie và lưu nick — không cần copy gì cả.</li>
                  </ol>
                  {loginSession ? (
                    <Alert
                      showIcon
                      type={loginSession.status === 'SUCCESS' ? 'success' : loginSession.status === 'WAITING' ? 'info' : 'warning'}
                      icon={loginSession.status === 'WAITING' ? <LoadingOutlined /> : undefined}
                      message={loginSession.message || 'Đang chờ…'}
                      action={loginSession.status !== 'WAITING' && loginSession.status !== 'SUCCESS'
                        ? <Button size="small" onClick={startBrowserLogin}>Thử lại</Button>
                        : undefined}
                    />
                  ) : (
                    <Button type="primary" block size="large" icon={<LoginOutlined />} onClick={startBrowserLogin}>
                      Mở cửa sổ đăng nhập Threads
                    </Button>
                  )}
                  <div className="text-[11px] text-slate-500">Mỗi nick có hồ sơ trình duyệt riêng, nên lần đăng nhập lại sau thường nhanh hơn.</div>
                </div>
              ),
            },
            {
              key: 'EXTENSION',
              label: 'Tự đồng bộ từ Chrome',
              children: (
                <div className="space-y-3 text-[13px] leading-relaxed text-slate-400">
                  <p className="m-0">Nếu bạn luôn để 1 tab <b>threads.com</b> đăng nhập trên Chrome, extension <b>ToolZutter</b> sẽ tự gửi cookie mới nhất vào hệ thống — nick gần như không bao giờ hết hạn.</p>
                  <ol className="m-0 pl-5 space-y-1">
                    <li>Mở <code>chrome://extensions</code> → bấm <b>Tải lại</b> (↻) ở extension ToolZutter (bản 1.2.0).</li>
                    <li>Mở threads.com, đăng nhập đúng nick cần dùng.</li>
                    <li>Bấm icon ToolZutter → tab <b>🧵 Threads</b> → <b>Đồng Bộ Ngay</b>. Nick sẽ tự xuất hiện ở đây.</li>
                  </ol>
                  <p className="m-0 text-[11px] text-slate-500">Sau đó extension tự đồng bộ mỗi khi Threads đổi cookie và định kỳ 30 phút. Lưu ý: nếu bấm <b>Đăng xuất</b> trên tab đó thì nick trong hệ thống cũng mất phiên.</p>
                </div>
              ),
            },
            {
              key: 'COOKIE',
              label: 'Dán cookie',
              children: (
                <div className="space-y-3">
                  <ol className="m-0 pl-5 text-[13px] leading-relaxed text-slate-400 space-y-1">
                    <li>Mở <b>threads.com</b> trên Chrome (đã đăng nhập đúng nick).</li>
                    <li>Bấm <b>F12</b> → tab <b>Application</b> → <b>Cookies</b> → <b>https://www.threads.com</b>.</li>
                    <li>Copy giá trị các dòng <b>sessionid</b>, <b>csrftoken</b>, <b>ds_user_id</b> (nên lấy thêm mid, ig_did, rur) và dán theo dạng:
                      <code className="block mt-1 text-[11px] text-slate-300">sessionid=...; csrftoken=...; ds_user_id=...</code>
                    </li>
                  </ol>
                  <Input.TextArea rows={4} value={cookieInput} onChange={(e) => setCookieInput(e.target.value)}
                    placeholder="sessionid=...; csrftoken=...; ds_user_id=..." className="!font-mono !text-xs" />
                  <Button type="primary" block loading={cookieMutation.isPending} disabled={!cookieInput.includes('sessionid=')} onClick={() => cookieMutation.mutate()}>
                    Kiểm tra & lưu nick
                  </Button>
                  <div className="text-[11px] text-slate-500">Hệ thống mở thử Threads bằng cookie này — chỉ lưu khi đăng nhập được.</div>
                </div>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        open={!!limitModal}
        title={`Giới hạn bài mỗi ngày · @${limitModal ? usernameOf(limitModal.account) : ''}`}
        okText="Lưu"
        cancelText="Huỷ"
        confirmLoading={limitMutation.isPending}
        onCancel={() => setLimitModal(null)}
        onOk={() => limitModal && limitMutation.mutate({ id: limitModal.account.id, value: limitModal.value })}
      >
        <p className="text-[13px] text-slate-400">Khi nick đã đăng đủ số bài trong ngày, các bài còn lại tự dời sang cùng giờ ngày hôm sau. Để trống để không giới hạn.</p>
        <InputNumber min={1} max={200} value={limitModal?.value ?? null} placeholder="Không giới hạn"
          onChange={(v) => setLimitModal((m) => (m ? { ...m, value: v ?? null } : m))} suffix="bài/ngày" className="!w-48" />
      </Modal>
    </div>
  );
}
