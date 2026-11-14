import { useState, useMemo, useCallback } from 'react';
import {
  Button,
  Dropdown,
  Card,
  Table,
  Typography,
  Tag,
  Space,
  Modal,
  Drawer,
  Form,
  Input,
  Select,
  App,
  Row,
  Col,
  InputNumber,
  Tooltip,
  Avatar,
  Empty,
  Tabs,
  Badge,
  Segmented,
  Divider,
  Alert,
  Flex,
  Collapse,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  FacebookOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  EditOutlined,
  EyeOutlined,
  CopyOutlined,
  KeyOutlined,
  SyncOutlined,
  TeamOutlined,
  LinkOutlined,
  UserOutlined,
  SearchOutlined,
  AppstoreOutlined,
  BarsOutlined,
  SettingOutlined,
  GlobalOutlined,
  ThunderboltOutlined,
  ApartmentOutlined,
  SafetyCertificateOutlined,
  FilterOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
  LoginOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../config/axios';
import { useSearchParams } from 'react-router-dom';
import QuickUpdateCookieModal from '../components/modals/QuickUpdateCookieModal';
import FacebookBrowserLoginModal from '../components/modals/FacebookBrowserLoginModal';
import Groups from './Groups';
import {
  FacebookCookies,
  INITIAL_FACEBOOK_COOKIES,
  parseAllFacebookCookies,
  buildCookieString,
  countCookies,
} from '@/utils/cookieHelper';

const { Title, Text } = Typography;
const { Option } = Select;

export interface SocialAccount {
  id: number;
  platform: string;
  platformAccountId: string;
  pageName?: string;
  accountType?: string;
  createdAt: string;
  tokenStatus?: 'OK' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNKNOWN';
  tokenExpiresAt?: string;
  tokenCheckedAt?: string;
  maxPostsPerDay?: number;
  accessToken?: string;
  backupAccountId?: number;
  groupHealthStatus?: string;
  fallbackGroupId?: number;
  proxyUrl?: string;
  userAgent?: string;
  postingIdentityAccountId?: number;
}

export interface FacebookPageAccess {
  id?: number;
  personalProfileId: string;
  profileName?: string;
  pageId: string;
  pageName: string;
  pageUrl?: string;
  avatarUrl?: string;
  verificationStatus: 'VERIFIED' | 'DISCOVERED' | 'NO_ACCESS' | 'SESSION_INVALID' | 'NOT_SEEN';
  verificationMessage?: string;
  active: boolean;
  firstSeenAt?: string;
  lastSeenAt?: string;
  lastVerifiedAt?: string;
  lastScanAt?: string;
  sources?: string[];
}

export interface FacebookPageScanResult {
  success: boolean;
  personalProfileId: string;
  profileName?: string;
  totalFound: number;
  verifiedCount: number;
  scanComplete: boolean;
  scannedAt: string;
  attemptedSources: string[];
  completedSources: string[];
  pages: FacebookPageAccess[];
}

const isPersonalCookieType = (accountType?: string) =>
  !accountType || accountType === 'PERSONAL_COOKIE' || accountType === 'PERSONAL_PROFILE_COOKIE';

// Tự động trích xuất đầy đủ tất cả các cột Cookie Facebook (c_user, xs, datr, sb, fr, wd, locale, vpd...)
export const smartExtractCookie = (rawInput?: string, defaultCUser: string = '') => {
  const parsed = parseAllFacebookCookies(rawInput || '', defaultCUser);
  return {
    cUser: parsed.cookies.cUser,
    xs: parsed.cookies.xs,
    sb: parsed.cookies.sb,
    datr: parsed.cookies.datr,
    fr: parsed.cookies.fr,
    wd: parsed.cookies.wd,
    cookies: parsed.cookies,
    isValid: parsed.isValid,
    normalized: parsed.fullCookie,
    fullCookie: parsed.fullCookie,
    hasDatrOrSb: parsed.hasSecuritySuite,
    count: parsed.count,
  };
};

// Tự động phân giải URL Facebook thành Page ID hoặc Vanity username
export const extractFacebookPageIdentifier = (input?: string): string => {
  if (!input) return '';
  const text = input.trim();
  const profileMatch = text.match(/profile\.php\?id=(\d+)/i);
  if (profileMatch) return profileMatch[1];
  const directIdMatch = text.match(/facebook\.com\/(\d+)(?:\/|\?|$)/i);
  if (directIdMatch) return directIdMatch[1];
  const vanityMatch = text.match(/facebook\.com\/([a-zA-Z0-9.]+)(?:\/|\?|$)/i);
  if (vanityMatch && !['groups', 'watch', 'reel', 'stories', 'photo', 'share', 'events'].includes(vanityMatch[1])) {
    return vanityMatch[1];
  }
  return text;
};

// Phân tách đầy đủ các cookie từ chuỗi accessToken
const parseCookieString = (accessToken?: string) => {
  if (!accessToken) return { cUser: '', xs: '', datr: '', sb: '', fr: '', wd: '', cookies: { ...INITIAL_FACEBOOK_COOKIES } };
  const extracted = smartExtractCookie(accessToken);
  return {
    cUser: extracted.cUser,
    xs: extracted.xs,
    datr: extracted.datr,
    sb: extracted.sb,
    fr: extracted.fr,
    wd: extracted.wd,
    cookies: extracted.cookies,
  };
};

// Tag trạng thái quyền Page kiểm kê chuẩn Linear-tier
const PageAccessStatusTag = ({ status }: { status: FacebookPageAccess['verificationStatus'] }) => {
  if (status === 'VERIFIED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Đã xác minh quyền
      </span>
    );
  }
  if (status === 'NO_ACCESS') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-red-500/10 text-red-300 border border-red-500/20 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        Mất quyền quản trị
      </span>
    );
  }
  if (status === 'SESSION_INVALID') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-rose-500/10 text-rose-300 border border-rose-500/20 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
        Phiên đăng nhập hết hạn
      </span>
    );
  }
  if (status === 'NOT_SEEN') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        Chưa tìm thấy
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20 whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
      Đã phát hiện
    </span>
  );
};

// Huy hiệu trạng thái Cookie/Token thiết kế cao cấp
const StatusBadge = ({ account, onQuickUpdate }: { account: SocialAccount; onQuickUpdate?: () => void }) => {
  const isCookie = isPersonalCookieType(account.accountType);
  const label = isCookie ? 'Cookie' : 'Token';
  const status = account.tokenStatus;

  if (status === 'EXPIRED') {
    return (
      <div className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/15 text-red-300 border border-red-500/30 shadow-[0_0_12px_rgba(239,68,68,0.2)] whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />
          {label} hết hạn
        </span>
        {onQuickUpdate && (
          <Button
            size="small"
            type="primary"
            danger
            icon={<ThunderboltOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onQuickUpdate();
            }}
            className="text-xs h-7 px-2.5 font-semibold rounded-md shadow-sm"
          >
            Đổi
          </Button>
        )}
      </div>
    );
  }

  if (status === 'EXPIRING_SOON' && !isCookie) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        Sắp hết hạn
      </span>
    );
  }

  if (status === 'OK') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
        Hoạt động tốt
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800/80 text-slate-400 border border-slate-700/60">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
      Chưa xác định
    </span>
  );
};

const Connections = () => {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Search & Filter state
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OK' | 'EXPIRED'>('ALL');
  const [viaFilter, setViaFilter] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'grouped' | 'table' | 'cards'>('grouped');

  // Modals & Drawers state
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [quickCookieModalOpen, setQuickCookieModalOpen] = useState(false);
  const [quickCookieTargetId, setQuickCookieTargetId] = useState<number | undefined>(undefined);
  const [configDrawerAccount, setConfigDrawerAccount] = useState<SocialAccount | null>(null);
  const [viewingAccount, setViewingAccount] = useState<SocialAccount | null>(null);
  const [personalViaModalOpen, setPersonalViaModalOpen] = useState(false);
  const [rawCookieVia, setRawCookieVia] = useState('');
  const [isManualViaMode, setIsManualViaMode] = useState(false);
  // Đăng nhập Facebook bằng cửa sổ Chrome thật (null = đóng, { account } = đăng nhập lại đúng nick đó)
  const [fbLoginModal, setFbLoginModal] = useState<{ account?: SocialAccount } | null>(null);
  const [extensionModalOpen, setExtensionModalOpen] = useState(false);

  // Page Audit state
  const [pageAuditSource, setPageAuditSource] = useState<SocialAccount | null>(null);
  const [latestPageScan, setLatestPageScan] = useState<FacebookPageScanResult | null>(null);
  const [manualPageName, setManualPageName] = useState('');
  const [manualPageId, setManualPageId] = useState('');
  const [checkingHealthId, setCheckingHealthId] = useState<number | null>(null);

  // Forms
  const [form] = Form.useForm();
  const [configForm] = Form.useForm();
  const [personalViaForm] = Form.useForm();

  // State & Watchers cho Modal Thêm Via phân tầng
  const [viaInputMode, setViaInputMode] = useState<'structured' | 'quick'>('structured');
  const watchedViaCUser = Form.useWatch('cUser', personalViaForm) || '';
  const watchedViaXs = Form.useWatch('xs', personalViaForm) || '';
  const watchedViaSecurity = Form.useWatch('securityCookies', personalViaForm) || '';

  const hasViaCUser = Boolean(watchedViaCUser && watchedViaCUser.trim().length >= 5);
  const hasViaXs = Boolean(watchedViaXs && watchedViaXs.trim().length >= 8);
  const hasViaSecurity = Boolean(
    (watchedViaSecurity && (watchedViaSecurity.includes('sb=') || watchedViaSecurity.includes('datr='))) ||
    (rawCookieVia && (rawCookieVia.includes('sb=') || rawCookieVia.includes('datr=')))
  );
  const viaCompletenessScore = (hasViaCUser ? 1 : 0) + (hasViaXs ? 1 : 0) + (hasViaSecurity ? 1 : 0);

  const activeTab = searchParams.get('tab') === 'groups' ? 'groups' : 'accounts';

  // 1. Fetch danh sách tài khoản
  const { data: accounts, isLoading } = useQuery({
    queryKey: ['socialAccounts'],
    queryFn: async () => {
      const response = await api.get('/connections');
      return response.data as SocialAccount[];
    },
  });

  // 2. Danh sách Nick Via cá nhân (Chỉ lọc tài khoản profile thật, loại bỏ Fanpage và Group)
  const personalVias = useMemo(() => {
    const uniqueVias = new Map<string, SocialAccount>();
    const isProfile = (a: SocialAccount) => a.platform === 'FACEBOOK_PROFILE' || a.accountType === 'PERSONAL_PROFILE_COOKIE';
    for (const account of accounts || []) {
      if (!isProfile(account) || account.platform === 'FACEBOOK_GROUP') continue;
      const { cUser } = parseCookieString(account.accessToken);
      const uid = cUser || (account.platformAccountId?.match(/^\d+$/) ? account.platformAccountId : '');
      if (!uid) continue;
      const existing = uniqueVias.get(uid);
      const shouldReplace = !existing || (existing.tokenStatus !== 'OK' && account.tokenStatus === 'OK') || (account.id > existing.id);
      if (shouldReplace) {
        uniqueVias.set(uid, account);
      }
    }
    return Array.from(uniqueVias.entries()).map(([cUser, account]) => ({ cUser, account }));
  }, [accounts]);

  // Lookup map theo c_user để lấy tên hiển thị của via (O(1))
  const viaNameMap = useMemo(() => {
    const map = new Map<string, string>();
    personalVias.forEach(({ cUser, account }) => {
      const name = account.pageName?.trim();
      map.set(cUser, name && !name.toLowerCase().startsWith('via facebook #') ? name : `Via #${cUser}`);
    });
    return map;
  }, [personalVias]);

  // 3. Map chính xác từng Fanpage/kết nối con với Nick Via quản trị mẹ (ưu tiên postingIdentityAccountId tường minh)
  const followedViaById = useMemo(() => {
    const list = accounts || [];
    const isProfile = (a: SocialAccount) => a.platform === 'FACEBOOK_PROFILE' || a.accountType === 'PERSONAL_PROFILE_COOKIE';
    const byId = new Map(list.map((a) => [a.id, a]));
    const viaByCUser = new Map<string, SocialAccount>();
    personalVias.forEach(({ cUser, account }) => viaByCUser.set(cUser, account));

    const map = new Map<number, SocialAccount>();
    for (const acc of list) {
      if (isProfile(acc) || acc.platform === 'FACEBOOK_GROUP') continue;
      // Ưu tiên 1: postingIdentityAccountId tường minh
      if (acc.postingIdentityAccountId && byId.has(acc.postingIdentityAccountId)) {
        const parent = byId.get(acc.postingIdentityAccountId);
        if (parent && isProfile(parent)) {
          map.set(acc.id, parent);
          continue;
        }
      }
      // Ưu tiên 2: Khớp theo c_user của Via
      const ownCUser = parseCookieString(acc.accessToken).cUser;
      if (ownCUser && viaByCUser.has(ownCUser)) {
        map.set(acc.id, viaByCUser.get(ownCUser)!);
      }
    }
    return map;
  }, [accounts, personalVias]);

  // c_user của Via mà kết nối này thực sự đi theo
  const viaCUserOf = useCallback(
    (acc: SocialAccount) => {
      const via = followedViaById.get(acc.id);
      if (via) {
        const viaCUser = parseCookieString(via.accessToken).cUser || via.platformAccountId;
        if (viaCUser) return viaCUser;
      }
      return parseCookieString(acc.accessToken).cUser;
    },
    [followedViaById]
  );

  // Trạng thái hiển thị: Page đi theo Via thì sống/chết đồng bộ theo Via
  const withEffectiveStatus = useCallback(
    (acc: SocialAccount): SocialAccount => {
      const via = followedViaById.get(acc.id);
      if (via && (via.tokenStatus === 'EXPIRED' || acc.tokenStatus === 'EXPIRED')) {
        return { ...acc, tokenStatus: 'EXPIRED' };
      }
      if (via && via.tokenStatus === 'OK') {
        return { ...acc, tokenStatus: 'OK' };
      }
      return acc;
    },
    [followedViaById]
  );

  // Danh sách Fanpage / Trang (loại bỏ Profile cá nhân và Group)
  const publishableAccounts = useMemo(
    () => (accounts || []).filter((a) => a.platform !== 'FACEBOOK_PROFILE' && a.platform !== 'FACEBOOK_GROUP').map(withEffectiveStatus),
    [accounts, withEffectiveStatus]
  );

  const groupCount = useMemo(
    () => (accounts || []).filter((a) => a.platform === 'FACEBOOK_GROUP').length,
    [accounts]
  );

  // Danh sách các tài khoản hết hạn cookie
  const expiredAccounts = useMemo(
    () => (accounts || []).map(withEffectiveStatus).filter((a) => isPersonalCookieType(a.accountType) && a.tokenStatus === 'EXPIRED'),
    [accounts, withEffectiveStatus]
  );

  // GOM NHÓM: Phân chia chính xác Fanpage nào thuộc Via nào
  const viaGroupedData = useMemo(() => {
    const map = new Map<string, SocialAccount[]>();
    const independent: SocialAccount[] = [];

    personalVias.forEach(({ cUser }) => {
      map.set(cUser, []);
    });

    for (const acc of publishableAccounts) {
      const cUser = viaCUserOf(acc);
      if (cUser && map.has(cUser)) {
        map.get(cUser)!.push(acc);
      } else {
        independent.push(acc);
      }
    }

    return {
      viaGroups: personalVias.map(({ cUser, account }) => ({
        cUser,
        viaAccount: account,
        viaName: viaNameMap.get(cUser) || `Via #${cUser}`,
        pages: map.get(cUser) || [],
      })),
      independentPages: independent,
    };
  }, [personalVias, publishableAccounts, viaNameMap, viaCUserOf]);

  // Lọc client-side mượt mà theo search & filter
  const filteredAccounts = useMemo(() => {
    return publishableAccounts.filter((acc) => {
      const cUser = viaCUserOf(acc);
      if (viaFilter !== 'ALL' && cUser !== viaFilter) return false;
      if (statusFilter === 'OK' && acc.tokenStatus !== 'OK') return false;
      if (statusFilter === 'EXPIRED' && acc.tokenStatus !== 'EXPIRED') return false;

      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase();
        const matchName = (acc.pageName || '').toLowerCase().includes(q);
        const matchId = (acc.platformAccountId || '').toLowerCase().includes(q);
        const matchCUser = cUser.includes(q);
        const matchViaName = viaNameMap.get(cUser)?.toLowerCase().includes(q);
        if (!matchName && !matchId && !matchCUser && !matchViaName) return false;
      }
      return true;
    });
  }, [publishableAccounts, searchText, statusFilter, viaFilter, viaNameMap, viaCUserOf]);

  // Query danh sách Managed Pages của Via (chỉ fetch khi Drawer mở)
  const managedPagesQuery = useQuery({
    queryKey: ['managedFacebookPages', pageAuditSource?.id],
    queryFn: async () => {
      const response = await api.get(`/connections/${pageAuditSource!.id}/managed-pages`);
      return response.data as FacebookPageAccess[];
    },
    enabled: !!pageAuditSource,
    staleTime: 30_000,
  });

  const auditedPages = useMemo(() => {
    const raw = latestPageScan?.pages || managedPagesQuery.data || [];
    const invalidNames = /^(?:thông báo|tin nhắn|bảng feed|trang chủ|home|notifications|inbox|messages|bảng tin|reels|stories|quản lý trang|xem tất cả|cài đặt|chọn trang|menu)$/i;
    return raw.filter((item) => {
      const pageId = (item.pageId || '').trim();
      if (!pageId || !/^\d+$/.test(pageId)) return false;
      const name = (item.pageName || '').trim();
      if (invalidNames.test(name)) return false;
      if (item.pageUrl && (item.pageUrl.includes('/latest/inbox') || item.pageUrl.includes('/reel/'))) return false;
      return true;
    });
  }, [latestPageScan, managedPagesQuery.data]);

  // Mutations
  const scanManagedPagesMutation = useMutation({
    mutationFn: async (sourceAccountId: number) => {
      const response = await api.post(`/connections/${sourceAccountId}/scan-managed-pages`, { verifyEachPage: true });
      return response.data as FacebookPageScanResult;
    },
    onSuccess: (result) => {
      setLatestPageScan(result);
      queryClient.setQueryData(['managedFacebookPages', pageAuditSource?.id], result.pages);
      queryClient.invalidateQueries({ queryKey: ['managedFacebookPages'] });
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
      if (result.verifiedCount === result.totalFound) {
        message.success(`Đã quét và xác minh toàn bộ ${result.verifiedCount}/${result.totalFound} Fanpage.`);
      } else {
        message.warning(`Tìm thấy ${result.totalFound} Page, xác minh được ${result.verifiedCount} Page.`);
      }
    },
    onError: (error: any) => {
      const detail = error?.response?.data?.detail || error?.response?.data?.message || error?.message;
      message.error(detail || 'Không thể quét danh sách Page của Via này.');
    },
  });

  const addManualPageMutation = useMutation({
    mutationFn: async ({ accountId, pageId, pageName }: { accountId: number; pageId: string; pageName: string }) => {
      const response = await api.post(`/connections/${accountId}/managed-pages`, { pageId, pageName });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managedFacebookPages', pageAuditSource?.id] });
      setManualPageName('');
      setManualPageId('');
      message.success('Đã thêm Fanpage thành công!');
    },
    onError: (error: any) => {
      const detail = error?.response?.data?.message || error?.message;
      message.error(detail || 'Không thể thêm Page này.');
    },
  });

  const deleteManualPageMutation = useMutation({
    mutationFn: async ({ accountId, pageId }: { accountId: number; pageId: string }) => {
      await api.delete(`/connections/${accountId}/managed-pages/${pageId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managedFacebookPages', pageAuditSource?.id] });
      message.success('Đã xóa Page khỏi danh sách kiểm kê!');
    },
    onError: (error: any) => {
      const detail = error?.response?.data?.message || error?.message;
      message.error(detail || 'Không thể xóa Page này.');
    },
  });

  const addPersonalViaMutation = useMutation({
    mutationFn: async (values: { profileLabel?: string; cUser: string; xs: string; fullCookie?: string; proxyUrl?: string }) => {
      const cUser = values.cUser.trim();
      const accessToken = (values.fullCookie && values.fullCookie.includes(';'))
        ? values.fullCookie.trim()
        : `c_user=${cUser}; xs=${values.xs.trim()}`;
      const response = await api.post('/connections', {
        platform: 'FACEBOOK_PROFILE',
        platformAccountId: cUser,
        pageName: values.profileLabel?.trim() || `Via Facebook #${cUser}`,
        accountType: 'PERSONAL_PROFILE_COOKIE',
        accessToken,
        proxyUrl: values.proxyUrl?.trim() || undefined,
        tokenStatus: 'OK',
        tokenCheckedAt: new Date().toISOString(),
      });
      return response.data as SocialAccount;
    },
    onSuccess: (account) => {
      message.success('Đã lưu Via cá nhân thành công! Đang tự động quét danh sách Fanpage...');
      personalViaForm.resetFields();
      setPersonalViaModalOpen(false);
      setLatestPageScan(null);
      setPageAuditSource(account);
      scanManagedPagesMutation.mutate(account.id);
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    },
    onError: (error: any) => {
      const detail = error?.response?.data?.detail || error?.response?.data?.message || error?.message;
      message.error(detail || 'Không thể lưu Via cá nhân.');
    },
  });

  const addMutation = useMutation({
    mutationFn: async (values: any) => {
      const response = await api.post('/connections', values);
      return response.data;
    },
    onSuccess: () => {
      message.success('Thêm Fanpage kết nối thành công!');
      setIsModalVisible(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    },
    onError: () => {
      message.error('Lỗi khi thêm kết nối Fanpage!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/connections/${id}`);
    },
    onSuccess: () => {
      message.success('Đã xóa kết nối thành công!');
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Không thể xóa kết nối này! Vui lòng thử lại.');
    },
  });

  // Mutation lưu cấu hình tài khoản từ Drawer
  const saveConfigMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Partial<SocialAccount> }) => {
      const response = await api.put(`/connections/${id}`, payload);
      return response.data;
    },
    onSuccess: () => {
      message.success('Đã lưu cấu hình tài khoản thành công!');
      setConfigDrawerAccount(null);
      configForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Lỗi khi lưu cấu hình');
    },
  });

  // Mutation kiểm tra trạng thái Cookie trực tiếp (Live Health Check)
  const checkHealthMutation = useMutation({
    mutationFn: async (accountId: number) => {
      setCheckingHealthId(accountId);
      const res = await api.post(`/connections/${accountId}/check-cookie-health`);
      return res.data;
    },
    onSuccess: (data) => {
      setCheckingHealthId(null);
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
      if (data?.status === 'OK') {
        message.success(data?.message || 'Cookie đang hoạt động rất tốt!');
      } else {
        message.warning(data?.message || 'Cookie hết hạn hoặc không hợp lệ!');
      }
    },
    onError: (err: any) => {
      setCheckingHealthId(null);
      message.error(err?.response?.data?.message || 'Không thể kiểm tra cookie lúc này.');
    },
  });

  // Mutation đồng bộ nhanh các Page từ danh sách kiểm kê vào kết nối xuất bản
  const importPagesMutation = useMutation({
    mutationFn: async ({ accountId, pageIds }: { accountId: number; pageIds?: string[] }) => {
      const res = await api.post(`/connections/${accountId}/import-managed-pages`, pageIds ? { pageIds } : {});
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
      queryClient.invalidateQueries({ queryKey: ['managedFacebookPages'] });
      message.success(data?.message || 'Đã đồng bộ Fanpage vào hệ thống thành công!');
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Không thể đồng bộ Fanpage.');
    },
  });

  const openConfigDrawer = (record: SocialAccount) => {
    setConfigDrawerAccount(record);
    const parsed = parseCookieString(record.accessToken);
    configForm.setFieldsValue({
      pageName: record.pageName || '',
      platformAccountId: record.platformAccountId || '',
      cUser: parsed.cUser,
      xs: parsed.xs,
      datr: parsed.datr,
      sb: parsed.sb,
      fr: parsed.fr,
      wd: parsed.wd,
      locale: parsed.cookies.locale,
      vpd: parsed.cookies.vpd,
      dpr: parsed.cookies.dpr,
      extraCookies: buildCookieString({
        ...parsed.cookies,
        cUser: '',
        xs: '',
        datr: '',
        sb: '',
        fr: '',
        wd: '',
        locale: '',
        vpd: '',
        dpr: '',
      }),
      accessToken: record.accessToken || '',
      maxPostsPerDay: record.maxPostsPerDay ?? null,
      backupAccountId: record.backupAccountId || undefined,
      postingIdentityAccountId: record.postingIdentityAccountId || undefined,
      proxyUrl: record.proxyUrl || '',
    });
  };

  // Options tài khoản dự phòng
  const backupOptions = useMemo(() => {
    return publishableAccounts.map((a) => ({
      value: a.id,
      label: `${a.pageName || a.platformAccountId} (${a.platformAccountId})`,
    }));
  }, [publishableAccounts]);

  // Cột hiển thị bảng Fanpage con
  const makePageColumns = (showViaColumn = false) => [
    {
      title: 'Fanpage / Kênh',
      key: 'pageInfo',
      render: (_: any, record: SocialAccount) => {
        const isPage = record.platform === 'FACEBOOK_PAGE' || record.platform === 'FACEBOOK';
        return (
          <div className="flex items-center gap-3">
            <Avatar
              icon={record.platform === 'THREADS' ? <span className="font-bold text-xs">@</span> : <FacebookOutlined />}
              className={`shrink-0 transition-transform hover:scale-105 ${record.platform === 'THREADS' ? 'bg-slate-700 text-white' : 'bg-blue-600 text-white shadow-sm'}`}
              size={34}
            />
            <div className="min-w-0 max-w-[260px]">
              <div className="font-semibold text-slate-100 text-xs truncate flex items-center gap-1.5">
                <span className="hover:text-blue-400 transition-colors">{record.pageName || record.platformAccountId}</span>
                {isPage && (
                  <a
                    href={`https://facebook.com/${record.platformAccountId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-slate-500 hover:text-blue-400 text-xs transition-colors"
                    title="Mở Fanpage trên Facebook"
                  >
                    <LinkOutlined />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="font-mono text-xs text-slate-300 bg-slate-800/90 px-2 py-0.5 rounded border border-slate-700/60">
                  ID: {record.platformAccountId}
                </span>
                <Tooltip title="Sao chép ID">
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined className="text-slate-400 hover:text-blue-400 text-xs" />}
                    onClick={() => {
                      navigator.clipboard.writeText(record.platformAccountId);
                      message.success('Đã sao chép ID!');
                    }}
                    className="h-5 w-5 p-0"
                  />
                </Tooltip>
              </div>
            </div>
          </div>
        );
      },
    },
    ...(showViaColumn
      ? [
          {
            title: 'Thuộc Via',
            key: 'viaIdentity',
            render: (_: any, record: SocialAccount) => {
              const cUser = viaCUserOf(record);
              if (!cUser) return <span className="text-[13px] text-slate-400">—</span>;
              const viaName = viaNameMap.get(cUser) || `Via #${cUser}`;
              return (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 text-slate-200 border border-slate-700/60 text-[13px] whitespace-nowrap">
                  <UserOutlined className="text-blue-400 text-xs" />
                  <span className="max-w-[150px] truncate font-medium">{viaName}</span>
                </span>
              );
            },
          },
        ]
      : []),
    {
      title: 'Phương thức',
      dataIndex: 'accountType',
      key: 'accountType',
      width: 178,
      render: (type: string) => {
        const isCookie = isPersonalCookieType(type);
        return (
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border whitespace-nowrap ${
              isCookie
                ? 'bg-purple-500/10 text-purple-300 border-purple-500/20'
                : 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20'
            }`}
          >
            {isCookie ? 'Playwright Cookie' : 'Graph API'}
          </span>
        );
      },
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 195,
      render: (_: any, record: SocialAccount) => (
        <StatusBadge
          account={record}
          onQuickUpdate={() => {
            setQuickCookieTargetId(followedViaById.get(record.id)?.id ?? record.id);
            setQuickCookieModalOpen(true);
          }}
        />
      ),
    },
    {
      title: 'Giới hạn',
      key: 'limit',
      width: 130,
      render: (_: any, record: SocialAccount) =>
        record.maxPostsPerDay ? (
          <span className="text-[13px] font-semibold text-sky-300 bg-sky-500/10 border border-sky-500/20 px-2.5 py-0.5 rounded whitespace-nowrap">
            {record.maxPostsPerDay} bài/ngày
          </span>
        ) : (
          <span className="text-[13px] text-slate-400">Mặc định</span>
        ),
    },
    {
      title: 'Dự phòng / Proxy',
      key: 'backupAndProxy',
      render: (_: any, record: SocialAccount) => {
        const backupAcc = publishableAccounts.find((a) => a.id === record.backupAccountId);
        const hasProxy = Boolean(record.proxyUrl);

        return (
          <div className="flex flex-col gap-0.5 text-[13px]">
            {backupAcc ? (
              <span className="text-slate-200 truncate max-w-[170px]" title={`Dự phòng: ${backupAcc.pageName || backupAcc.platformAccountId}`}>
                <span className="text-slate-400">Dự phòng:</span> {backupAcc.pageName || backupAcc.platformAccountId}
              </span>
            ) : null}
            {hasProxy ? (
              <span className="text-emerald-300 font-mono text-xs truncate max-w-[170px]" title={record.proxyUrl}>
                <GlobalOutlined className="mr-1 text-xs" />
                {record.proxyUrl}
              </span>
            ) : null}
            {!backupAcc && !hasProxy && <span className="text-slate-400 text-[13px]">Mặc định</span>}
          </div>
        );
      },
    },
    {
      title: 'Thao tác',
      key: 'action',
      width: 140,
      render: (_: any, record: SocialAccount) => (
        <Space size="small">
          {isPersonalCookieType(record.accountType) && (
            <Tooltip title="Kiểm tra Cookie ngay qua Playwright">
              <Button
                type="text"
                icon={<SafetyCertificateOutlined spin={checkingHealthId === record.id} />}
                loading={checkingHealthId === record.id}
                onClick={() => checkHealthMutation.mutate(record.id)}
                className="text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-colors"
              />
            </Tooltip>
          )}
          <Tooltip title="Cấu hình tài khoản">
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => openConfigDrawer(record)}
              className="text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-lg transition-colors"
            />
          </Tooltip>
          <Tooltip title="Xem Cookie/Token">
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={() => setViewingAccount(record)}
              className="text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded-lg transition-colors"
            />
          </Tooltip>
          <Tooltip title="Xóa kết nối">
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => {
                Modal.confirm({
                  title: 'Xóa Fanpage này?',
                  content: `Xóa Fanpage "${record.pageName || record.platformAccountId}"?`,
                  okText: 'Xóa',
                  okType: 'danger',
                  cancelText: 'Hủy',
                  onOk: () => deleteMutation.mutate(record.id),
                });
              }}
              className="text-slate-500 hover:text-red-400 hover:bg-red-950/40 rounded-lg transition-colors"
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const tabsBar = (
    <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl px-5 py-1.5 mb-4 backdrop-blur-md shadow-sm">
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setSearchParams(key === 'groups' ? { tab: 'groups' } : {})}
        className="!mb-0"
        items={[
          { key: 'accounts', label: `Tài khoản & Fanpage (${publishableAccounts.length})` },
          { key: 'groups', label: `Nhóm Facebook (${groupCount})` },
        ]}
      />
    </div>
  );

  if (activeTab === 'groups') {
    return (
      <div className="app-page space-y-4">
        {tabsBar}
        <Groups />
      </div>
    );
  }

  return (
    <div className="app-page space-y-4">
      {tabsBar}

      {/* Emergency Cookie Banner if any account expired */}
      {expiredAccounts.length > 0 && (
        <Alert
          type="error"
          showIcon
          message={<span className="font-semibold text-rose-200">Có {expiredAccounts.length} kết nối Facebook Cookie đã hết hạn</span>}
          description={
            <div className="text-xs text-slate-300 mt-0.5 leading-relaxed">
              Các Fanpage: <b className="text-white">{expiredAccounts.map((a) => a.pageName || a.platformAccountId).join(', ')}</b> có thể bị tạm dừng xuất bản. Hãy cập nhật cookie mới cho Via sở hữu.
            </div>
          }
          action={
            <Button
              type="primary"
              danger
              icon={<ThunderboltOutlined />}
              onClick={() => {
                setQuickCookieTargetId(expiredAccounts[0]?.id);
                setQuickCookieModalOpen(true);
              }}
              className="font-semibold text-xs rounded-xl"
            >
              Cập nhật Cookie (1-Chạm Đồng Bộ)
            </Button>
          }
          className="rounded-xl border border-rose-500/30"
        />
      )}

      {/* Header Bar & Quick Actions */}
      <Card variant="borderless" styles={{ body: { padding: '16px 20px' } }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Title level={4} className="!mb-0.5 !text-slate-100 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <ApiOutlined />
              </div>
              <span>Quản lý kết nối Via & Fanpage</span>
            </Title>
            <Text className="text-xs text-slate-300">
              Xem rõ cấu trúc phân cấp: Via cá nhân nào đang nắm giữ những Fanpage nào, đồng bộ Cookie tức thì khi hết hạn
            </Text>
          </div>
          <div className="flex items-center gap-2.5">
          {expiredAccounts.length > 0 && (
            <Button
              type="primary"
              danger
              icon={<KeyOutlined />}
              onClick={() => {
                setQuickCookieTargetId(expiredAccounts[0]?.id);
                setQuickCookieModalOpen(true);
              }}
              className="font-semibold h-10 px-4 rounded-xl shadow-sm"
            >
              Đổi {expiredAccounts.length} Cookie
            </Button>
          )}

          <Dropdown
            menu={{
              items: [
                {
                  key: 'sync_all',
                  icon: <ThunderboltOutlined className="text-amber-400" />,
                  label: 'Đồng bộ 1-Chạm (Mọi Profile)',
                  onClick: () => setExtensionModalOpen(true),
                },
                {
                  key: 'login_fb',
                  icon: <LoginOutlined className="text-blue-400" />,
                  label: 'Đăng nhập Facebook (Trình duyệt)',
                  onClick: () => setFbLoginModal({}),
                },
              ],
            }}
            placement="bottomRight"
          >
            <Button
              icon={<ThunderboltOutlined className="text-amber-400" />}
              className="font-medium h-10 px-4 rounded-xl bg-slate-800/80 border-slate-700/80 text-slate-200 hover:bg-slate-700 transition-all"
            >
              Tiện ích đồng bộ
            </Button>
          </Dropdown>

          <Button
            icon={<UserOutlined />}
            onClick={() => setPersonalViaModalOpen(true)}
            className="font-medium h-10 px-4 rounded-xl bg-slate-800/80 border-slate-700/80 text-slate-200 hover:bg-slate-700 transition-all"
          >
            Thêm Via cá nhân
          </Button>

          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsModalVisible(true)}
            className="font-semibold h-10 px-5 rounded-xl bg-blue-600 hover:bg-blue-500 shadow-[0_4px_16px_rgba(37,99,235,0.25)] transition-all"
          >
            Thêm Fanpage
          </Button>
        </div>
      </div>
      </Card>

      {/* Control Bar: Search, Filters, View Modes */}
      <Card variant="borderless" styles={{ body: { padding: '12px 16px' } }}>
        <Flex justify="space-between" align="center" wrap="wrap" gap="middle">
          <Flex wrap="wrap" align="center" gap="small" className="flex-1">
            <Input
              prefix={<SearchOutlined className="text-slate-500" />}
              placeholder="Tìm theo tên Page, ID hoặc UID..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="max-w-[260px] rounded-xl text-xs"
              allowClear
            />

            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              className="w-44 text-xs"
              options={[
                { value: 'ALL', label: 'Tất cả trạng thái' },
                { value: 'OK', label: 'Đang hoạt động' },
                { value: 'EXPIRED', label: 'Cookie hết hạn' },
              ]}
            />

            {personalVias.length > 0 && (
              <Select
                value={viaFilter}
                onChange={setViaFilter}
                className="w-48 text-xs"
                options={[
                  { value: 'ALL', label: 'Tất cả Via sở hữu' },
                  ...personalVias.map(({ cUser }) => ({
                    value: cUser,
                    label: viaNameMap.get(cUser) || `Via #${cUser}`,
                  })),
                ]}
              />
            )}

            <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-400 ml-auto pr-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <span>Tổng cộng: <b className="text-slate-200 font-semibold">{personalVias.length} Via</b> · <b className="text-slate-200 font-semibold">{publishableAccounts.length} Fanpage</b></span>
            </div>
          </Flex>

          <Segmented
            value={viewMode}
            onChange={(val) => setViewMode(val as 'grouped' | 'table' | 'cards')}
            options={[
              { value: 'grouped', icon: <ApartmentOutlined />, label: 'Theo từng Via' },
              { value: 'table', icon: <BarsOutlined />, label: 'Bảng phẳng' },
              { value: 'cards', icon: <AppstoreOutlined />, label: 'Lưới thẻ' },
            ]}
            className="rounded-xl p-0.5 text-xs"
          />
        </Flex>
      </Card>

      {/* ========================================================================= */}
      {/* CHẾ ĐỘ 1: THEO TỪNG VIA (KHUYÊN DÙNG — PHÂN CẤP RÕ RÀNG VIA NÀO CÓ PAGE NÀO) */}
      {/* ========================================================================= */}
      {viewMode === 'grouped' && (
        <div className="space-y-4">
          {viaGroupedData.viaGroups.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-12 text-center">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <div className="space-y-2 mt-2">
                    <div className="text-slate-200 text-sm font-semibold">Chưa có Via cá nhân nào được khai báo</div>
                    <div className="text-slate-500 text-xs max-w-md mx-auto">
                      Hãy bấm "Thêm Via cá nhân" để lưu nick Facebook và tự động kiểm kê toàn bộ danh sách Fanpage bạn đang quản trị.
                    </div>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => setPersonalViaModalOpen(true)}
                      className="mt-3 bg-blue-600 rounded-xl font-semibold"
                    >
                      Thêm Via ngay
                    </Button>
                  </div>
                }
              />
            </div>
          ) : (
            viaGroupedData.viaGroups
              .filter((group) => {
                if (viaFilter !== 'ALL' && group.cUser !== viaFilter) return false;
                return true;
              })
              .map(({ cUser, viaAccount, viaName, pages }) => {
                const isViaExpired = viaAccount.tokenStatus === 'EXPIRED';
                const displayedPages = pages.filter((p) => {
                  if (statusFilter === 'OK' && p.tokenStatus !== 'OK') return false;
                  if (statusFilter === 'EXPIRED' && p.tokenStatus !== 'EXPIRED') return false;
                  if (searchText.trim()) {
                    const q = searchText.trim().toLowerCase();
                    const matchName = (p.pageName || '').toLowerCase().includes(q);
                    const matchId = (p.platformAccountId || '').toLowerCase().includes(q);
                    if (!matchName && !matchId) return false;
                  }
                  return true;
                });

                return (
                  /* Double-Bezel Card Container */
                  <div
                    key={cUser}
                    className={`rounded-2xl border transition-all duration-300 ${
                      isViaExpired
                        ? 'border-rose-500/30 bg-[#120d18] shadow-[0_4px_24px_rgba(244,63,94,0.08)]'
                        : 'border-white/[0.08] bg-[#0c1220] shadow-[0_4px_20px_rgba(0,0,0,0.3)] hover:border-white/[0.14]'
                    } overflow-hidden`}
                  >
                    {/* VIA HEADER PANEL */}
                    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/[0.06] bg-white/[0.015]">
                      <div className="flex items-center gap-3.5">
                        <Avatar
                          icon={<FacebookOutlined />}
                          size={42}
                          className={`shrink-0 border ${
                            isViaExpired ? 'bg-red-600/30 text-red-300 border-red-500/40' : 'bg-blue-600/30 text-blue-300 border-blue-500/40'
                          }`}
                        />
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-slate-100 text-base">{viaName}</span>
                            <span className="font-mono text-xs text-slate-300 bg-slate-800 px-2 py-0.5 rounded-md border border-slate-700/80">
                              UID: {cUser}
                            </span>
                            <StatusBadge
                              account={viaAccount}
                              onQuickUpdate={() => {
                                setQuickCookieTargetId(viaAccount.id);
                                setQuickCookieModalOpen(true);
                              }}
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-[13px] text-slate-300 mt-1">
                            <span className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                              Quản trị: <b className="text-sky-300 font-semibold">{pages.length} Fanpage</b> trực thuộc
                            </span>
                            {viaAccount.proxyUrl && (
                              <span className="flex items-center gap-1">
                                · Proxy riêng: <span className="font-mono text-emerald-400">{viaAccount.proxyUrl}</span>
                              </span>
                            )}
                            {viaAccount.tokenCheckedAt && (
                              <span className="text-slate-400">
                                · Kiểm tra: {new Date(viaAccount.tokenCheckedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* ACTIONS PER VIA */}
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {isViaExpired ? (
                          <Button
                            type="primary"
                            danger
                            icon={<ThunderboltOutlined />}
                            onClick={() => {
                              setQuickCookieTargetId(viaAccount.id);
                              setQuickCookieModalOpen(true);
                            }}
                            className="font-bold text-xs h-8 px-3.5 rounded-xl shadow-md animate-pulse hover:scale-105 transition-transform"
                          >
                            Đổi Cookie (Cứu {pages.length} Page)
                          </Button>
                        ) : (
                          <Button
                            icon={<KeyOutlined />}
                            size="small"
                            onClick={() => {
                              setQuickCookieTargetId(viaAccount.id);
                              setQuickCookieModalOpen(true);
                            }}
                            className="text-xs text-slate-300 bg-slate-800/80 border-slate-700 hover:bg-slate-700 rounded-lg transition-all"
                          >
                            Cập nhật Cookie
                          </Button>
                        )}

                        <Button
                          icon={<LoginOutlined />}
                          size="small"
                          onClick={() => setFbLoginModal({ account: viaAccount })}
                          className="text-xs text-slate-300 bg-slate-800/80 border-slate-700 hover:bg-slate-700 rounded-lg transition-all"
                        >
                          Đăng nhập lại
                        </Button>

                        <Button
                          icon={<SafetyCertificateOutlined spin={checkingHealthId === viaAccount.id} />}
                          size="small"
                          loading={checkingHealthId === viaAccount.id}
                          onClick={() => checkHealthMutation.mutate(viaAccount.id)}
                          className="text-xs text-emerald-400 bg-emerald-950/20 border-emerald-900/60 hover:bg-emerald-950/40 rounded-lg transition-all"
                          title="Kiểm tra Cookie sống/chết tức thì qua Playwright"
                        >
                          Kiểm tra Cookie
                        </Button>

                        <Button
                          type="default"
                          size="small"
                          icon={<SyncOutlined />}
                          onClick={() => {
                            setLatestPageScan(null);
                            setPageAuditSource(viaAccount);
                          }}
                          className="text-xs text-blue-400 border-blue-900/60 bg-blue-950/20 hover:bg-blue-950/40 rounded-lg transition-all"
                        >
                          Quét & Kiểm kê Page
                        </Button>

                        <Button
                          type="default"
                          size="small"
                          icon={<PlusOutlined />}
                          onClick={() => {
                            form.setFieldsValue({
                              platform: 'FACEBOOK_PAGE',
                              accountType: 'PERSONAL_COOKIE',
                              accessToken: viaAccount.accessToken,
                              postingIdentityAccountId: viaAccount.id,
                            });
                            setIsModalVisible(true);
                          }}
                          className="text-xs text-emerald-400 border-emerald-900/60 bg-emerald-950/20 hover:bg-emerald-950/40 rounded-lg transition-all"
                        >
                          Thêm Page vào Via
                        </Button>

                        <Button
                          type="text"
                          size="small"
                          icon={<SettingOutlined />}
                          onClick={() => openConfigDrawer(viaAccount)}
                          className="text-slate-400 hover:text-blue-400 rounded-lg"
                          title="Cấu hình Via"
                        />

                        <Button
                          type="text"
                          danger
                          size="small"
                          icon={<DeleteOutlined />}
                          onClick={() => {
                            Modal.confirm({
                              title: 'Xóa Via này?',
                              content: `Xóa Via "${viaName}" (${cUser})? Các Page thuộc Via này vẫn giữ nguyên trong hệ thống.`,
                              okText: 'Xóa',
                              okButtonProps: { danger: true },
                              cancelText: 'Hủy',
                              onOk: () => deleteMutation.mutate(viaAccount.id),
                            });
                          }}
                          className="text-slate-500 hover:text-red-400 rounded-lg"
                          title="Xóa Via"
                        />
                      </div>
                    </div>

                    {/* CHILD PAGES TABLE */}
                    <div className="p-0 bg-[#090e18]">
                      {pages.length === 0 ? (
                        <div className="py-7 px-4 text-center text-xs text-slate-500">
                          Chưa có Fanpage nào được liên kết với Via này. Hãy bấm{' '}
                          <a
                            onClick={() => {
                              setLatestPageScan(null);
                              setPageAuditSource(viaAccount);
                            }}
                            className="text-blue-400 underline font-medium cursor-pointer hover:text-blue-300"
                          >
                            Quét & Kiểm kê Page
                          </a>{' '}
                          để hệ thống tự tìm thấy tất cả các Page nick này đang làm Admin.
                        </div>
                      ) : (
                        <Table
                          columns={makePageColumns(false)}
                          dataSource={displayedPages}
                          rowKey="id"
                          pagination={false}
                          size="small"
                          className="sub-page-table"
                        />
                      )}
                    </div>
                  </div>
                );
              })
          )}

          {/* INDEPENDENT CHANNELS GROUP (GRAPH API, THREADS, TIKTOK) */}
          {viaGroupedData.independentPages.length > 0 && (
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3 px-1">
                <ApiOutlined className="text-cyan-400" />
                <span className="font-semibold text-sm text-slate-200">
                  Các kênh độc lập / Token API ({viaGroupedData.independentPages.length} kênh)
                </span>
                <span className="text-xs text-slate-500">Các kết nối qua Graph API, Threads, TikTok không phụ thuộc nick Via</span>
              </div>
              <Table
                columns={makePageColumns(false)}
                dataSource={viaGroupedData.independentPages}
                rowKey="id"
                pagination={false}
                size="small"
              />
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* CHẾ ĐỘ 2: BẢNG PHẲNG TRUYỀN THỐNG (TABLE VIEW) */}
      {/* ========================================================================= */}
      {viewMode === 'table' && (
        <Card variant="borderless" className="shadow-sm overflow-hidden p-0">
          <Table
            columns={makePageColumns(true)}
            dataSource={filteredAccounts}
            rowKey="id"
            loading={isLoading}
            locale={{ emptyText: 'Chưa có Fanpage nào phù hợp với bộ lọc.' }}
            pagination={{ pageSize: 12, showSizeChanger: true }}
            scroll={{ x: 900 }}
          />
        </Card>
      )}

      {/* ========================================================================= */}
      {/* CHẾ ĐỘ 3: LƯỚI THẺ TRỰC QUAN (CARDS VIEW) */}
      {/* ========================================================================= */}
      {viewMode === 'cards' && (
        <div>
          {filteredAccounts.length === 0 ? (
            <Card variant="borderless" className="text-center py-8">
              <Empty description={<span className="text-slate-400 text-xs">Không tìm thấy Fanpage nào</span>} />
            </Card>
          ) : (
            <Row gutter={[14, 14]}>
              {filteredAccounts.map((acc) => {
                const cUser = viaCUserOf(acc);
                const viaName = cUser ? viaNameMap.get(cUser) : null;
                const backupAcc = publishableAccounts.find((a) => a.id === acc.backupAccountId);

                return (
                  <Col xs={24} sm={12} lg={8} key={acc.id}>
                    <div className="rounded-2xl border border-slate-800/90 bg-slate-900/60 p-4 transition-all hover:border-slate-700 flex flex-col justify-between h-full shadow-sm">
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar
                              icon={acc.platform === 'THREADS' ? <span>@</span> : <FacebookOutlined />}
                              className={acc.platform === 'THREADS' ? 'bg-slate-700' : 'bg-blue-600'}
                              size={36}
                            />
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-100 text-sm truncate" title={acc.pageName || acc.platformAccountId}>
                                {acc.pageName || acc.platformAccountId}
                              </div>
                              <span className="font-mono text-xs text-slate-300">ID: {acc.platformAccountId}</span>
                            </div>
                          </div>
                          <Tag color={isPersonalCookieType(acc.accountType) ? 'purple' : 'cyan'} className="!rounded-md font-medium !text-xs">
                            {isPersonalCookieType(acc.accountType) ? 'Cookie' : 'Token'}
                          </Tag>
                        </div>

                        <div className="space-y-1.5 text-[13px] text-slate-300 mb-3 bg-slate-800/40 p-2.5 rounded-xl border border-slate-800">
                          {viaName && (
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Thuộc Via:</span>
                              <span className="text-slate-200 font-medium">{viaName}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">Trạng thái:</span>
                            <StatusBadge
                              account={acc}
                              onQuickUpdate={() => {
                                setQuickCookieTargetId(followedViaById.get(acc.id)?.id ?? acc.id);
                                setQuickCookieModalOpen(true);
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">Giới hạn:</span>
                            <span className="text-slate-200">
                              {acc.maxPostsPerDay ? `${acc.maxPostsPerDay} bài/ngày` : 'Không giới hạn'}
                            </span>
                          </div>
                          {backupAcc && (
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Dự phòng:</span>
                              <span className="text-slate-200 truncate max-w-[130px]">{backupAcc.pageName || backupAcc.platformAccountId}</span>
                            </div>
                          )}
                          {acc.proxyUrl && (
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Proxy:</span>
                              <span className="text-emerald-400 font-mono text-xs truncate max-w-[130px]">{acc.proxyUrl}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2.5 border-t border-slate-800/80">
                        <Button
                          type="text"
                          size="small"
                          icon={<EyeOutlined />}
                          onClick={() => setViewingAccount(acc)}
                          className="text-slate-400 hover:text-blue-400"
                        >
                          Xem Cookie
                        </Button>

                        <Space size="small">
                          <Button
                            type="text"
                            size="small"
                            icon={<SettingOutlined />}
                            onClick={() => openConfigDrawer(acc)}
                            className="text-slate-300 hover:text-blue-400 hover:bg-slate-800 rounded-lg"
                          >
                            Cấu hình
                          </Button>
                          <Button
                            type="text"
                            danger
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => {
                              Modal.confirm({
                                title: 'Xóa kết nối Fanpage',
                                content: `Bạn có chắc muốn xóa "${acc.pageName || acc.platformAccountId}"?`,
                                okText: 'Xóa',
                                okType: 'danger',
                                cancelText: 'Hủy',
                                onOk: () => deleteMutation.mutate(acc.id),
                              });
                            }}
                            className="text-slate-500 hover:text-red-400 hover:bg-red-950/40 rounded-lg"
                          />
                        </Space>
                      </div>
                    </div>
                  </Col>
                );
              })}
            </Row>
          )}
        </div>
      )}

      {/* DRAWER: Cấu hình chi tiết tài khoản */}
      <Drawer
        title={
          <div className="flex items-center gap-2 text-slate-100">
            <SettingOutlined className="text-blue-500" />
            <span className="font-semibold text-base">
              Cấu hình tài khoản: {configDrawerAccount?.pageName || configDrawerAccount?.platformAccountId}
            </span>
          </div>
        }
        open={!!configDrawerAccount}
        onClose={() => setConfigDrawerAccount(null)}
        width={500}
        destroyOnHidden
        styles={{
          header: { borderBottom: '1px solid #1e293b' },
          body: { backgroundColor: '#0b111a', color: '#e2e8f0' },
        }}
        footer={
          <div className="flex justify-end gap-2.5 py-1">
            <Button onClick={() => setConfigDrawerAccount(null)} className="rounded-xl">
              Hủy
            </Button>
            <Button
              type="primary"
              loading={saveConfigMutation.isPending}
              onClick={() => {
                configForm.validateFields().then((values) => {
                  if (!configDrawerAccount) return;
                  const isToken = configDrawerAccount.accountType === 'PAGE_TOKEN';
                  let accessToken = isToken ? values.accessToken : undefined;
                  if (!isToken && values.cUser && values.xs) {
                    const extra = values.extraCookies ? parseAllFacebookCookies(values.extraCookies).cookies : {};
                    accessToken = buildCookieString({
                      ...extra,
                      cUser: values.cUser?.trim(),
                      xs: values.xs?.trim(),
                      datr: values.datr?.trim() || undefined,
                      sb: values.sb?.trim() || undefined,
                      fr: values.fr?.trim() || undefined,
                      wd: values.wd?.trim() || undefined,
                      locale: values.locale?.trim() || undefined,
                      vpd: values.vpd?.trim() || undefined,
                      dpr: values.dpr?.trim() || undefined,
                    });
                  }

                  saveConfigMutation.mutate({
                    id: configDrawerAccount.id,
                    payload: {
                      pageName: values.pageName?.trim(),
                      platformAccountId: values.platformAccountId?.trim(),
                      accessToken,
                      maxPostsPerDay: values.maxPostsPerDay ?? null,
                      backupAccountId: values.backupAccountId ?? 0,
                      postingIdentityAccountId: values.postingIdentityAccountId !== undefined ? values.postingIdentityAccountId : 0,
                      proxyUrl: values.proxyUrl ? values.proxyUrl.trim() : null,
                    },
                  });
                });
              }}
              className="rounded-xl bg-blue-600 font-semibold"
            >
              Lưu thay đổi
            </Button>
          </div>
        }
      >
        <Form form={configForm} layout="vertical" className="space-y-3">
          <Form.Item
            name="pageName"
            label={<span className="font-medium text-slate-300">Tên Fanpage / Hiển thị</span>}
            rules={[{ required: true, message: 'Vui lòng nhập tên!' }]}
          >
            <Input className="rounded-xl" />
          </Form.Item>

          <Form.Item
            name="platformAccountId"
            label={<span className="font-medium text-slate-300">ID Fanpage / Account</span>}
            rules={[{ required: true, message: 'Vui lòng nhập ID!' }]}
          >
            <Input className="rounded-xl font-mono" />
          </Form.Item>

          <Divider className="border-slate-800 my-2" />

          {configDrawerAccount?.accountType === 'PAGE_TOKEN' ? (
            <Form.Item
              name="accessToken"
              label={<span className="font-medium text-slate-300">Page Access Token</span>}
              rules={[{ required: true }]}
            >
              <Input.Password className="rounded-xl font-mono" />
            </Form.Item>
          ) : (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <SafetyCertificateOutlined className="text-emerald-400" /> Toàn bộ Cookie Facebook (Kháng Checkpoint)
                </span>
                <Button
                  size="small"
                  type="dashed"
                  icon={<CopyOutlined />}
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text) {
                        const parsed = parseAllFacebookCookies(text);
                        configForm.setFieldsValue({
                          cUser: parsed.cookies.cUser,
                          xs: parsed.cookies.xs,
                          datr: parsed.cookies.datr,
                          sb: parsed.cookies.sb,
                          fr: parsed.cookies.fr,
                          wd: parsed.cookies.wd,
                          locale: parsed.cookies.locale,
                          vpd: parsed.cookies.vpd,
                          dpr: parsed.cookies.dpr,
                        });
                        message.success(`Đã tự động phân tách và điền ${parsed.count} cookie vào các ô!`);
                      }
                    } catch {
                      message.error('Không thể đọc Clipboard!');
                    }
                  }}
                  className="text-xs"
                >
                  📋 Dán tự động điền các ô
                </Button>
              </div>

              {/* Tầng 1 */}
              <div className="p-3 rounded-xl border border-blue-500/30 bg-blue-950/20 space-y-2">
                <div className="text-xs font-semibold text-blue-300">TẦNG 1: BẮT BUỘC</div>
                <div className="grid grid-cols-2 gap-2">
                  <Form.Item
                    name="cUser"
                    label={<span className="text-xs text-slate-300">c_user (UID)</span>}
                    rules={[{ required: true, message: 'Nhập c_user' }]}
                    className="!mb-0"
                  >
                    <Input className="rounded-lg font-mono text-xs bg-slate-900 border-slate-700" placeholder="100023403136194" />
                  </Form.Item>
                  <Form.Item
                    name="xs"
                    label={<span className="text-xs text-slate-300">xs (Session token)</span>}
                    rules={[{ required: true, message: 'Nhập xs' }]}
                    className="!mb-0"
                  >
                    <Input.Password className="rounded-lg font-mono text-xs bg-slate-900 border-slate-700" placeholder="49%3A..." />
                  </Form.Item>
                </div>
              </div>

              {/* Tầng 2 */}
              <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-emerald-300">
                  <span>TẦNG 2: BẢO MẬT THIẾT BỊ (KHÁNG CHECKPOINT)</span>
                  <Tag color="green" className="text-[10px] m-0">Khuyên dùng</Tag>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Form.Item
                    name="datr"
                    label={<span className="text-xs text-slate-300">datr (Thẻ thiết bị)</span>}
                    className="!mb-0"
                  >
                    <Input className="rounded-lg font-mono text-xs bg-slate-900 border-slate-700" placeholder="VD: imv2alUXVRr_..." />
                  </Form.Item>
                  <Form.Item
                    name="sb"
                    label={<span className="text-xs text-slate-300">sb (Khóa phiên máy)</span>}
                    className="!mb-0"
                  >
                    <Input className="rounded-lg font-mono text-xs bg-slate-900 border-slate-700" placeholder="VD: f1kNaidy..." />
                  </Form.Item>
                  <Form.Item
                    name="fr"
                    label={<span className="text-xs text-slate-300">fr (Token phiên)</span>}
                    className="!mb-0"
                  >
                    <Input.Password className="rounded-lg font-mono text-xs bg-slate-900 border-slate-700" placeholder="VD: 1MB8n..." />
                  </Form.Item>
                  <Form.Item
                    name="wd"
                    label={<span className="text-xs text-slate-300">wd (Màn hình)</span>}
                    className="!mb-0"
                  >
                    <Input className="rounded-lg font-mono text-xs bg-slate-900 border-slate-700" placeholder="VD: 440x956" />
                  </Form.Item>
                </div>
              </div>

              {/* Tầng 3 */}
              <Collapse
                ghost
                size="small"
                className="border border-slate-800 rounded-xl bg-slate-900/40"
                items={[
                  {
                    key: 'extra',
                    label: <span className="text-xs text-slate-300 font-semibold">⚙️ Thông số phụ (locale, vpd, dpr, khác...)</span>,
                    children: (
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <Form.Item name="locale" label={<span className="text-xs text-slate-400">locale</span>} className="!mb-1">
                          <Input className="rounded-lg font-mono text-xs bg-slate-900 border-slate-700" placeholder="vi_VN" />
                        </Form.Item>
                        <Form.Item name="vpd" label={<span className="text-xs text-slate-400">vpd</span>} className="!mb-1">
                          <Input className="rounded-lg font-mono text-xs bg-slate-900 border-slate-700" placeholder="v1%3B956x440x3" />
                        </Form.Item>
                        <Form.Item name="dpr" label={<span className="text-xs text-slate-400">dpr</span>} className="!mb-1">
                          <Input className="rounded-lg font-mono text-xs bg-slate-900 border-slate-700" placeholder="2" />
                        </Form.Item>
                        <Form.Item name="extraCookies" label={<span className="text-xs text-slate-400">Cookie khác</span>} className="!mb-1">
                          <Input className="rounded-lg font-mono text-xs bg-slate-900 border-slate-700" placeholder="pas=...; wl_cbv=..." />
                        </Form.Item>
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          )}

          <Divider className="border-slate-800 my-2" />

          <Form.Item
            name="maxPostsPerDay"
            label={<span className="font-medium text-slate-300">Giới hạn số bài đăng / ngày</span>}
            extra={<span className="text-xs text-slate-500">Để trống nếu không muốn giới hạn số bài</span>}
          >
            <InputNumber min={0} placeholder="Không giới hạn" className="w-full rounded-xl" />
          </Form.Item>

          <Form.Item
            name="backupAccountId"
            label={<span className="font-medium text-slate-300">Tài khoản dự phòng (Failover)</span>}
            extra={<span className="text-xs text-slate-500">Tự động chuyển bài sang tài khoản này nếu tài khoản chính lỗi</span>}
          >
            <Select
              allowClear
              placeholder="Chọn tài khoản dự phòng..."
              options={backupOptions.filter((o) => o.value !== configDrawerAccount?.id)}
              className="rounded-xl"
            />
          </Form.Item>

          {configDrawerAccount?.platform !== 'FACEBOOK_PROFILE' && (
            <Form.Item
              name="postingIdentityAccountId"
              label={<span className="font-medium text-slate-300">Nick Via quản trị (Sở hữu)</span>}
              extra={<span className="text-xs text-slate-500">Gán Page vào Via để tự động đồng bộ Cookie tức thì khi Via đổi cookie hoặc hết hạn.</span>}
            >
              <Select
                allowClear
                placeholder="Chọn Nick Via sở hữu..."
                options={[
                  { value: 0, label: '— Không gắn Via nào (Kênh độc lập) —' },
                  ...personalVias.map(({ cUser, account }) => ({
                    value: account.id,
                    label: `${viaNameMap.get(cUser) || `Via #${cUser}`} (UID: ${cUser})`,
                  })),
                ]}
                className="rounded-xl"
              />
            </Form.Item>
          )}

          <Form.Item
            name="proxyUrl"
            label={<span className="font-medium text-slate-300">Proxy riêng (IPv4)</span>}
            extra={<span className="text-xs text-slate-500">Định dạng: http://user:pass@ip:port để giữ IP cố định</span>}
          >
            <Input placeholder="http://username:password@103.123.45.67:8080" className="rounded-xl font-mono text-xs" />
          </Form.Item>
        </Form>
      </Drawer>

      {/* MODAL: Thêm Fanpage mới */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-slate-100 pb-2 border-b border-slate-800">
            <FacebookOutlined className="text-blue-500 text-lg" />
            <span className="font-semibold text-base">Kết Nối Fanpage Mới</span>
          </div>
        }
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        footer={null}
        width={540}
        centered
        className="dark-modal"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => addMutation.mutate(values)}
          initialValues={{
            platform: 'FACEBOOK_PAGE',
            accountType: 'PERSONAL_COOKIE',
          }}
          className="mt-4 space-y-3"
        >
          <Form.Item name="platform" label={<span className="font-medium text-slate-300">Nền tảng xuất bản</span>} rules={[{ required: true }]}>
            <Select
              className="rounded-xl"
              onChange={(val) => {
                if (val === 'TIKTOK') form.setFieldsValue({ accountType: 'TIKTOK_COOKIE' });
                else if (val === 'THREADS') form.setFieldsValue({ accountType: 'THREADS_COOKIE' });
                else if (val === 'FACEBOOK_PAGE') form.setFieldsValue({ accountType: 'PERSONAL_COOKIE' });
              }}
            >
              <Option value="FACEBOOK_PAGE">Facebook Fanpage</Option>
              <Option value="THREADS">Threads</Option>
              <Option value="TIKTOK">TikTok Channel</Option>
              <Option value="WORDPRESS">WordPress Site</Option>
              <Option value="TWITTER">Twitter (X)</Option>
            </Select>
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.platform !== cur.platform}
          >
            {({ getFieldValue }) => {
              const platformVal = getFieldValue('platform');
              const isThreads = platformVal === 'THREADS';
              const isTikTok = platformVal === 'TIKTOK';

              const pageNameLabel = isThreads ? 'Tên nick Threads' : isTikTok ? 'Tên kênh TikTok' : 'Tên Fanpage Facebook';
              const accountIdLabel = isThreads ? 'Username Threads' : isTikTok ? 'ID / Username TikTok' : 'Facebook Page ID';

              return (
                <>
                  <Form.Item
                    name="pageName"
                    label={<span className="font-medium text-slate-300">{pageNameLabel}</span>}
                    rules={[{ required: true, message: `Vui lòng nhập ${pageNameLabel}!` }]}
                  >
                    <Input placeholder={isThreads ? 'Ví dụ: Tin Tức Threads' : 'Ví dụ: Tin Tức Công Nghệ 24/7'} className="rounded-xl" />
                  </Form.Item>

                  <Form.Item
                    name="platformAccountId"
                    label={<span className="font-medium text-slate-300">{accountIdLabel}</span>}
                    extra={!isThreads && !isTikTok && (
                      <span className="text-xs text-slate-500">
                        💡 Hỗ trợ dán thẳng link Fanpage (vd: <code>https://facebook.com/...</code>) hoặc Page ID dạng số.
                      </span>
                    )}
                    rules={[{ required: true, message: `Vui lòng nhập ${accountIdLabel}!` }]}
                  >
                    <Input
                      placeholder={isThreads ? 'lamsen.official' : 'Dán ID hoặc link Fanpage (vd: 61584834510803 hoặc link Page)'}
                      className="rounded-xl font-mono"
                      onChange={(e) => {
                        if (!isThreads && !isTikTok) {
                          const val = e.target.value;
                          const cleaned = extractFacebookPageIdentifier(val);
                          if (cleaned && cleaned !== val) {
                            form.setFieldValue('platformAccountId', cleaned);
                          }
                        }
                      }}
                    />
                  </Form.Item>

                  {!isTikTok && !isThreads && (
                    <Form.Item
                      name="accountType"
                      label={<span className="font-medium text-slate-300">Phương thức đăng bài</span>}
                      rules={[{ required: true }]}
                    >
                      <Select className="rounded-xl">
                        <Option value="PERSONAL_COOKIE">Facebook Cookie (Khuyên dùng — Đăng giả lập, hỗ trợ Video Reels & Nhóm)</Option>
                        <Option value="PAGE_TOKEN">Page Access Token (Graph API chính thức — Chỉ đăng Fanpage thường)</Option>
                      </Select>
                    </Form.Item>
                  )}

                  {!isTikTok && !isThreads && personalVias.length > 0 && (
                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, cur) => prev.accountType !== cur.accountType}
                    >
                      {({ getFieldValue: getFV3 }) => {
                        if (getFV3('accountType') !== 'PERSONAL_COOKIE') return null;
                        return (
                          <Form.Item
                            name="postingIdentityAccountId"
                            label={<span className="font-medium text-slate-300">Gắn vào Via cá nhân sở hữu</span>}
                            extra={<span className="text-xs text-slate-400">💡 Chọn Via có sẵn để tự động kế thừa Cookie, khi Via đổi cookie thì Page này cũng tự cập nhật.</span>}
                          >
                            <Select
                              placeholder="Chọn Via sở hữu..."
                              allowClear
                              className="rounded-xl"
                              onChange={(viaAccountId) => {
                                const targetVia = personalVias.find((v) => v.account.id === viaAccountId);
                                if (targetVia) {
                                  form.setFieldValue('accessToken', targetVia.account.accessToken);
                                  message.success(`Đã tự động lấy Cookie của Via ${viaNameMap.get(targetVia.cUser) || targetVia.cUser}`);
                                }
                              }}
                            >
                              {personalVias.map(({ cUser, account }) => (
                                <Option key={account.id} value={account.id}>
                                  {viaNameMap.get(cUser) || `Via #${cUser}`} (UID: {cUser})
                                </Option>
                              ))}
                            </Select>
                          </Form.Item>
                        );
                      }}
                    </Form.Item>
                  )}

                  <Form.Item
                    noStyle
                    shouldUpdate={(prev, cur) => prev.accountType !== cur.accountType || prev.platform !== cur.platform}
                  >
                    {({ getFieldValue: getFV2 }) => {
                      const isGraphApi = getFV2('accountType') === 'PAGE_TOKEN';
                      const isThreadsConn = getFV2('platform') === 'THREADS';

                      return (
                        <Form.Item
                          name="accessToken"
                          label={
                            <span className="font-medium text-slate-300">
                              {isGraphApi ? 'Page Access Token' : isThreadsConn ? 'Cookie chuỗi Threads' : 'Chuỗi Cookie (Dán toàn bộ hoặc c_user=...; xs=...)'}
                            </span>
                          }
                          rules={[{ required: true, message: 'Vui lòng cung cấp Cookie hoặc Token!' }]}
                        >
                          <div className="flex gap-2">
                            <Input.Password
                              placeholder={isGraphApi ? 'Dán Access Token vào đây' : 'Dán chuỗi Cookie vào đây (tự động chuẩn hóa)'}
                              className="rounded-xl flex-1 font-mono"
                              onChange={(e) => {
                                if (!isGraphApi && !isThreadsConn) {
                                  const text = e.target.value;
                                  const parsed = smartExtractCookie(text);
                                  if (parsed.isValid && parsed.normalized !== text) {
                                    form.setFieldValue('accessToken', parsed.normalized);
                                  }
                                }
                              }}
                            />
                            <Button
                              icon={<CopyOutlined />}
                              onClick={async () => {
                                try {
                                  const text = await navigator.clipboard.readText();
                                  if (text) {
                                    const parsed = smartExtractCookie(text);
                                    if (parsed.isValid && !isGraphApi && !isThreadsConn) {
                                      form.setFieldValue('accessToken', parsed.normalized);
                                      message.success('Đã nhận diện và dán Cookie hợp lệ!');
                                    } else {
                                      form.setFieldValue('accessToken', text.trim());
                                    }
                                  }
                                } catch {
                                  // ignore
                                }
                              }}
                              className="shrink-0 rounded-xl"
                            >
                              Dán
                            </Button>
                          </div>
                        </Form.Item>
                      );
                    }}
                  </Form.Item>
                </>
              );
            }}
          </Form.Item>

          <div className="pt-3 flex justify-end gap-2.5 border-t border-slate-800">
            <Button onClick={() => setIsModalVisible(false)} className="rounded-xl">
              Hủy
            </Button>
            <Button type="primary" htmlType="submit" loading={addMutation.isPending} className="bg-blue-600 font-semibold rounded-xl">
              Lưu kết nối
            </Button>
          </div>
        </Form>
      </Modal>

      {/* MODAL: Thêm nick cá nhân / Via mới */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-slate-100 pb-2 border-b border-slate-800">
            <UserOutlined className="text-blue-500 text-lg" />
            <span className="font-semibold text-base">Thêm Via Facebook Cá Nhân</span>
          </div>
        }
        open={personalViaModalOpen}
        onCancel={() => {
          if (!addPersonalViaMutation.isPending) {
            setPersonalViaModalOpen(false);
            personalViaForm.resetFields();
            setRawCookieVia('');
            setViaInputMode('structured');
          }
        }}
        footer={null}
        width={580}
        centered
        className="dark-modal"
      >
        <Form
          form={personalViaForm}
          layout="vertical"
          onFinish={(values) => {
            let cUser = values.cUser?.trim() || '';
            let xs = values.xs?.trim() || '';
            let fullCookie = '';

            if (viaInputMode === 'quick') {
              const parsed = smartExtractCookie(rawCookieVia);
              cUser = parsed.cUser;
              xs = parsed.xs;
              fullCookie = parsed.fullCookie;
            } else {
              const extra = values.extraCookies ? parseAllFacebookCookies(values.extraCookies).cookies : {};
              fullCookie = buildCookieString({
                ...extra,
                cUser,
                xs,
                datr: values.datr?.trim() || undefined,
                sb: values.sb?.trim() || undefined,
                fr: values.fr?.trim() || undefined,
                wd: values.wd?.trim() || undefined,
                locale: values.locale?.trim() || undefined,
                vpd: values.vpd?.trim() || undefined,
                dpr: values.dpr?.trim() || undefined,
              });
            }

            if (!cUser || !xs) {
              message.error('Vui lòng cung cấp ít nhất UID Facebook (c_user) và Mã phiên (xs) hợp lệ!');
              return;
            }

            addPersonalViaMutation.mutate({
              profileLabel: values.profileLabel?.trim(),
              cUser,
              xs,
              fullCookie,
              proxyUrl: values.proxyUrl?.trim(),
            });
          }}
          className="mt-3 space-y-3.5"
        >
          {/* Thanh đăng nhập tự động Chrome */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-700/80 bg-slate-900/60">
            <span className="text-xs text-slate-400">Không muốn copy cookie? Tự đăng nhập trong cửa sổ Chrome, hệ thống tự lấy cookie.</span>
            <Button
              size="small"
              type="primary"
              icon={<LoginOutlined />}
              onClick={() => {
                setPersonalViaModalOpen(false);
                personalViaForm.resetFields();
                setRawCookieVia('');
                setFbLoginModal({});
              }}
              className="shrink-0"
            >
              Đăng nhập Facebook
            </Button>
          </div>

          {/* Segmented Switcher */}
          <div className="flex justify-center">
            <Segmented
              value={viaInputMode}
              onChange={(val) => setViaInputMode(val as 'structured' | 'quick')}
              options={[
                {
                  value: 'structured',
                  label: (
                    <Flex align="center" gap={6} className="px-2 py-1">
                      <SafetyCertificateOutlined className="text-blue-400" />
                      <span className="font-semibold text-xs">📋 Nhập Từng Ô Phân Tầng (Khuyên dùng)</span>
                    </Flex>
                  ),
                },
                {
                  value: 'quick',
                  label: (
                    <Flex align="center" gap={6} className="px-2 py-1">
                      <ThunderboltOutlined className="text-amber-400" />
                      <span className="font-semibold text-xs">⚡ Dán Nhanh Cookie (Tự Bóc Tách)</span>
                    </Flex>
                  ),
                },
              ]}
              className="bg-slate-900 border border-slate-800 p-1 rounded-xl"
            />
          </div>

          {/* CHẾ ĐỘ 1: NHẬP TỪNG Ô PHÂN TẦNG */}
          {viaInputMode === 'structured' && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button
                  size="small"
                  type="dashed"
                  icon={<CopyOutlined />}
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text) {
                        const parsed = parseAllFacebookCookies(text);
                        personalViaForm.setFieldsValue({
                          cUser: parsed.cookies.cUser,
                          xs: parsed.cookies.xs,
                          datr: parsed.cookies.datr,
                          sb: parsed.cookies.sb,
                          fr: parsed.cookies.fr,
                          wd: parsed.cookies.wd,
                          locale: parsed.cookies.locale,
                          vpd: parsed.cookies.vpd,
                          dpr: parsed.cookies.dpr,
                        });
                        message.success(`Đã tự động điền ${parsed.count} cookie từ Clipboard vào các cột!`);
                      }
                    } catch {
                      message.error('Không thể đọc Clipboard!');
                    }
                  }}
                  className="text-xs"
                >
                  📋 Dán tự động điền tất cả các tầng
                </Button>
              </div>

              {/* TẦNG 1: ĐỊNH DANH VIA */}
              <div className="p-3.5 rounded-2xl border border-blue-500/30 bg-blue-950/20 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-blue-300 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-blue-500/30 text-blue-300 flex items-center justify-center text-xs font-bold">1</span>
                    TẦNG 1: ĐỊNH DANH NICK / VIA
                  </span>
                  <Tag color="blue" className="!text-xs m-0 font-semibold">Bắt buộc</Tag>
                </div>

                <Form.Item
                  name="profileLabel"
                  label={<span className="text-[13px] font-semibold text-slate-200">Tên gợi nhớ của Nick</span>}
                  rules={[{ required: true, message: 'Vui lòng nhập Tên gợi nhớ!' }]}
                  className="!mb-2"
                >
                  <Input
                    placeholder="Ví dụ: Nick Chính 01, Nick Nuôi, Nick Đăng Phim..."
                    className="rounded-xl bg-slate-900/90 border-slate-700/80"
                  />
                </Form.Item>

                <Form.Item
                  name="cUser"
                  label={<span className="text-[13px] font-semibold text-slate-200">UID Facebook cá nhân (c_user)</span>}
                  rules={[
                    { required: true, message: 'Vui lòng nhập UID Facebook (c_user)!' },
                    { pattern: /^\d{5,}$/, message: 'c_user phải là dãy số ID Facebook.' },
                  ]}
                  className="!mb-0"
                >
                  <Input
                    placeholder="Ví dụ: 100023403136194 (dãy số c_user trong cookie hoặc ID trang cá nhân)"
                    className="rounded-xl font-mono text-[13px] bg-slate-900/90 border-slate-700/80"
                  />
                </Form.Item>
              </div>

              {/* TẦNG 2: PHIÊN ĐĂNG NHẬP PLAYWRIGHT */}
              <div className="p-3.5 rounded-2xl border border-indigo-500/30 bg-indigo-950/20 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-indigo-300 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-indigo-500/30 text-indigo-300 flex items-center justify-center text-xs font-bold">2</span>
                    TẦNG 2: KHÓA PHIÊN ĐĂNG NHẬP (xs)
                  </span>
                  <Tag color="blue" className="!text-xs m-0 font-semibold">Bắt buộc</Tag>
                </div>

                <Form.Item
                  name="xs"
                  rules={[{ required: true, message: 'Vui lòng nhập mã phiên xs!' }]}
                  className="!mb-0"
                >
                  <Input.Password
                    placeholder="Dán chuỗi xs... (Ví dụ: 49%3A8J7w...)"
                    className="rounded-xl font-mono text-[13px] bg-slate-900/90 border-slate-700/80"
                  />
                </Form.Item>
                <div className="text-xs text-slate-300">
                  🔑 Session token bí mật giúp bot Playwright tự động tương tác Facebook không cần nhập mật khẩu.
                </div>
              </div>

              {/* TẦNG 3: KHÁNG CHECKPOINT & CHỐNG VĂNG NICK */}
              <div className="p-3.5 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-emerald-300 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-500/30 text-emerald-300 flex items-center justify-center text-xs font-bold">3</span>
                    TẦNG 3: COOKIE BẢO MẬT KHÁNG CHECKPOINT (datr, sb, fr, wd)
                  </span>
                  <Tag color="green" className="!text-xs m-0 font-semibold">Khuyên dùng (Kháng văng nick)</Tag>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <Form.Item name="datr" label={<span className="text-xs text-slate-300 font-semibold"><code>datr</code> (Thẻ căn cước thiết bị)</span>} className="!mb-0">
                    <Input placeholder="VD: imv2alUXVRr_..." className="rounded-xl font-mono text-xs bg-slate-900/90 border-slate-700" />
                  </Form.Item>
                  <Form.Item name="sb" label={<span className="text-xs text-slate-300 font-semibold"><code>sb</code> (Ràng buộc trình duyệt)</span>} className="!mb-0">
                    <Input placeholder="VD: f1kNaidy..." className="rounded-xl font-mono text-xs bg-slate-900/90 border-slate-700" />
                  </Form.Item>
                  <Form.Item name="fr" label={<span className="text-xs text-slate-300 font-semibold"><code>fr</code> (Mã bảo mật phiên)</span>} className="!mb-0">
                    <Input.Password placeholder="VD: 1MB8n..." className="rounded-xl font-mono text-xs bg-slate-900/90 border-slate-700" />
                  </Form.Item>
                  <Form.Item name="wd" label={<span className="text-xs text-slate-300 font-semibold"><code>wd</code> (Kích thước màn hình)</span>} className="!mb-0">
                    <Input placeholder="VD: 440x956 hoặc 1920x1080" className="rounded-xl font-mono text-xs bg-slate-900/90 border-slate-700" />
                  </Form.Item>
                </div>
                <div className="text-xs text-slate-300">
                  🛡️ Facebook dùng datr và sb để nhận diện thiết bị quen thuộc. Có 2 mã này bot Playwright sẽ không bị Facebook nghi ngờ checkpoint.
                </div>
              </div>

              {/* TẦNG 4: THÔNG SỐ BỔ SUNG */}
              <Collapse
                ghost
                size="small"
                className="border border-slate-800 rounded-2xl bg-slate-900/40"
                items={[
                  {
                    key: 'extra',
                    label: <span className="text-xs text-slate-300 font-semibold">⚙️ TẦNG 4: THÔNG SỐ DEVTOOLS BỔ SUNG (locale, vpd, dpr, khác...)</span>,
                    children: (
                      <div className="grid grid-cols-2 gap-2.5 pt-1">
                        <Form.Item name="locale" label={<span className="text-xs text-slate-400">locale</span>} className="!mb-1">
                          <Input className="rounded-xl font-mono text-xs bg-slate-900 border-slate-700" placeholder="vi_VN" />
                        </Form.Item>
                        <Form.Item name="vpd" label={<span className="text-xs text-slate-400">vpd</span>} className="!mb-1">
                          <Input className="rounded-xl font-mono text-xs bg-slate-900 border-slate-700" placeholder="v1%3B956x440x3" />
                        </Form.Item>
                        <Form.Item name="dpr" label={<span className="text-xs text-slate-400">dpr</span>} className="!mb-1">
                          <Input className="rounded-xl font-mono text-xs bg-slate-900 border-slate-700" placeholder="2" />
                        </Form.Item>
                        <Form.Item name="extraCookies" label={<span className="text-xs text-slate-400">Cookie khác</span>} className="!mb-1">
                          <Input className="rounded-xl font-mono text-xs bg-slate-900 border-slate-700" placeholder="pas=...; wl_cbv=..." />
                        </Form.Item>
                      </div>
                    ),
                  },
                ]}
              />

              {/* TẦNG 5: PROXY RIÊNG CHO NICK */}
              <div className="p-3.5 rounded-2xl border border-slate-700/80 bg-slate-900/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-slate-200 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-slate-700 text-slate-200 flex items-center justify-center text-xs font-bold">5</span>
                    TẦNG 5: PROXY RIÊNG CHO NICK (HTTP/SOCKS5)
                  </span>
                  <Tag className="!text-xs m-0">Tùy chọn</Tag>
                </div>

                <Form.Item name="proxyUrl" className="!mb-0">
                  <Input
                    placeholder="Ví dụ: http://user:pass@103.152.xxx.xxx:8080 (hoặc bỏ trống nếu dùng IP máy)"
                    className="rounded-xl font-mono text-[13px] bg-slate-900/90 border-slate-700/80"
                  />
                </Form.Item>
                <div className="text-xs text-slate-300">
                  🌐 Dành cho bạn nuôi nhiều nick cần gán IP riêng cố định để chống checkpoint chùm.
                </div>
              </div>
            </div>
          )}

          {/* CHẾ ĐỘ 2: DÁN NHANH COOKIE */}
          {viaInputMode === 'quick' && (
            <div className="space-y-3">
              <div className="p-3.5 rounded-2xl border border-blue-500/30 bg-blue-950/20 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-300 flex items-center gap-1.5">
                    <ThunderboltOutlined className="text-amber-400" />
                    Dán Chuỗi Cookie Hoặc JSON J2Team (Tự Động Bóc Tách)
                  </span>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        if (text) {
                          const trimmed = text.trim();
                          setRawCookieVia(trimmed);
                          const parsed = smartExtractCookie(trimmed);
                          if (parsed.isValid) {
                            personalViaForm.setFieldsValue({
                              cUser: parsed.cUser,
                              xs: parsed.xs,
                              securityCookies: parsed.fullCookie || trimmed,
                            });
                            if (!personalViaForm.getFieldValue('profileLabel')) {
                              personalViaForm.setFieldValue('profileLabel', `Via Facebook #${parsed.cUser}`);
                            }
                            message.success(`Đã tự động nhận diện và phân tầng cho UID: ${parsed.cUser}`);
                          } else {
                            message.warning('Đã dán nhưng chưa tìm thấy c_user hoặc xs. Hãy kiểm tra lại chuỗi cookie.');
                          }
                        }
                      } catch {
                        message.info('Vui lòng dán trực tiếp (Ctrl+V) vào ô bên dưới');
                      }
                    }}
                    className="text-xs !h-7 px-2.5 rounded-lg bg-blue-600/30 border-blue-500/40 text-blue-200 hover:bg-blue-600 hover:text-white"
                  >
                    Dán từ Clipboard
                  </Button>
                </div>

                <Input.TextArea
                  rows={4}
                  value={rawCookieVia}
                  placeholder="Dán toàn bộ chuỗi Cookie vào đây (ví dụ: sb=...; c_user=1000...; xs=... hoặc định dạng JSON từ J2Team / Cookie-Editor)..."
                  className="rounded-xl font-mono text-[13px] bg-slate-900/90 border-slate-700/80"
                  onChange={(e) => {
                    const text = e.target.value;
                    setRawCookieVia(text);
                    const parsed = smartExtractCookie(text);
                    if (parsed.isValid) {
                      personalViaForm.setFieldsValue({
                        cUser: parsed.cUser,
                        xs: parsed.xs,
                        securityCookies: parsed.fullCookie || text,
                      });
                      if (!personalViaForm.getFieldValue('profileLabel')) {
                        personalViaForm.setFieldValue('profileLabel', `Via Facebook #${parsed.cUser}`);
                      }
                    }
                  }}
                />

                {/* Kết quả bóc tách nhanh */}
                {(() => {
                  const parsed = smartExtractCookie(rawCookieVia);
                  if (parsed.isValid) {
                    return (
                      <div className="space-y-1.5 p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[13px]">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 font-semibold">
                            <CheckCircleOutlined className="text-emerald-400" />
                            Đã bóc tách thành công UID: <span className="font-mono text-white underline">{parsed.cUser}</span>
                          </span>
                          <Tag color="success" className="mr-0 font-mono">Đã lấy c_user + xs</Tag>
                        </div>
                        <div className="text-xs text-emerald-200/90 flex items-center justify-between pt-1 border-t border-emerald-500/20">
                          <span>{parsed.hasDatrOrSb ? '🛡️ Đã có mã kháng checkpoint (sb/datr)!' : '⚠️ Chưa thấy sb/datr (Vẫn đăng được nhưng nên copy full cookie)'}</span>
                          <Button
                            type="link"
                            size="small"
                            onClick={() => setViaInputMode('structured')}
                            className="text-xs text-emerald-300 hover:text-white p-0 h-auto"
                          >
                            Xem chi tiết các ô phân tầng →
                          </Button>
                        </div>
                      </div>
                    );
                  }
                  if (rawCookieVia.trim()) {
                    return (
                      <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[13px] flex items-center gap-1.5">
                        <WarningOutlined className="text-amber-400" />
                        Chưa tìm thấy cặp <code className="bg-amber-950/40 px-1 rounded font-mono">c_user</code> và <code className="bg-amber-950/40 px-1 rounded font-mono">xs</code> hợp lệ. Hãy kiểm tra lại chuỗi copy.
                      </div>
                    );
                  }
                  return (
                    <div className="text-xs text-slate-300 flex items-center gap-1">
                      <span>💡 Hỗ trợ: Chuỗi Cookie thô, định dạng JSON J2Team, hoặc chuỗi có chứa c_user & xs.</span>
                    </div>
                  );
                })()}
              </div>

              <Form.Item
                name="profileLabel"
                label={<span className="font-medium text-slate-200 text-[13px]">Tên gợi nhớ Nick / Via</span>}
                extra={<span className="text-xs text-slate-400">Ví dụ: Nick Chính 01, Nick Nuôi, Nick Phụ 1...</span>}
              >
                <Input placeholder="Ví dụ: Nick Chính 01" className="rounded-xl" />
              </Form.Item>
            </div>
          )}

          {/* THƯỚC ĐO ĐỘ ĐẦY ĐỦ THÔNG SỐ CỦA VIA (LUÔN HIỂN THỊ) */}
          <div className={`p-3 rounded-xl border transition-all ${
            viaCompletenessScore === 3
              ? 'border-emerald-500/40 bg-emerald-950/30'
              : viaCompletenessScore === 2
              ? 'border-amber-500/40 bg-amber-950/30'
              : 'border-slate-800 bg-slate-900/50'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-bold text-slate-200">KIỂM TRA ĐỘ ĐẦY ĐỦ THÔNG SỐ CỦA VIA:</span>
              {viaCompletenessScore === 3 ? (
                <Tag color="success" className="font-semibold m-0">🟢 100% HOÀN HẢO (ĐÃ ĐỦ)</Tag>
              ) : viaCompletenessScore === 2 ? (
                <Tag color="warning" className="font-semibold m-0">🟡 ĐỦ CƠ BẢN (70%)</Tag>
              ) : (
                <Tag color="error" className="font-semibold m-0">❌ CHƯA ĐỦ THÔNG SỐ</Tag>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 text-[13px] mb-1.5">
              <div className={`p-1.5 rounded-lg border text-center ${hasViaCUser ? 'border-emerald-500/30 bg-emerald-950/40 text-emerald-300' : 'border-slate-800 bg-slate-900/60 text-slate-400'}`}>
                👤 UID: {hasViaCUser ? '✅ Đã có' : '❌ Chưa có'}
              </div>
              <div className={`p-1.5 rounded-lg border text-center ${hasViaXs ? 'border-emerald-500/30 bg-emerald-950/40 text-emerald-300' : 'border-slate-800 bg-slate-900/60 text-slate-400'}`}>
                🔑 Phiên xs: {hasViaXs ? '✅ Đã có' : '❌ Chưa có'}
              </div>
              <div className={`p-1.5 rounded-lg border text-center ${hasViaSecurity ? 'border-emerald-500/30 bg-emerald-950/40 text-emerald-300' : 'border-amber-500/30 bg-amber-950/40 text-amber-400'}`}>
                🛡️ Kháng Checkpoint: {hasViaSecurity ? '✅ Đầy đủ' : '⚠️ Nên thêm'}
              </div>
            </div>

            <div className="text-xs text-slate-200 leading-relaxed">
              {viaCompletenessScore === 3
                ? '🎉 Tuyệt vời! Nick đã có đủ toàn bộ thông số định danh, phiên làm việc và mã bảo mật (sb/datr) kháng checkpoint tối đa.'
                : viaCompletenessScore === 2
                ? '💡 Đã đủ điều kiện cơ bản để Playwright chạy đăng bài. Bạn nên bổ sung Cookie bảo mật ở Tầng 3 để nick không bị Facebook nghi ngờ checkpoint.'
                : '⚠️ Bắt buộc phải có Tên gợi nhớ, UID (c_user) và Mã phiên (xs) thì hệ thống mới có thể tương tác tự động được.'}
            </div>
          </div>

          <div className="pt-3 flex justify-end gap-2.5 border-t border-slate-800">
            <Button
              onClick={() => {
                setPersonalViaModalOpen(false);
                personalViaForm.resetFields();
                setRawCookieVia('');
                setIsManualViaMode(false);
              }}
              disabled={addPersonalViaMutation.isPending}
              className="rounded-xl"
            >
              Hủy
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={addPersonalViaMutation.isPending}
              className="bg-blue-600 font-semibold rounded-xl"
            >
              Lưu và mở kiểm kê
            </Button>
          </div>
        </Form>
      </Modal>

      {/* MODAL: Xem Cookie/Token an toàn */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-slate-100 pb-2 border-b border-slate-800">
            <EyeOutlined className="text-blue-500 text-lg" />
            <span className="font-semibold text-base">Xem Cookie / Token — {viewingAccount?.pageName || viewingAccount?.platformAccountId}</span>
          </div>
        }
        open={!!viewingAccount}
        onCancel={() => setViewingAccount(null)}
        footer={
          <Button type="primary" onClick={() => setViewingAccount(null)} className="rounded-xl">
            Đóng
          </Button>
        }
        width={580}
        centered
        className="dark-modal"
      >
        {viewingAccount?.accountType === 'PAGE_TOKEN' ? (
          <div className="mt-4">
            <Text className="font-medium text-slate-300 block mb-1 text-xs">Page Access Token</Text>
            <div className="flex gap-2">
              <Input.Password readOnly value={viewingAccount?.accessToken || ''} className="rounded-xl font-mono text-xs" />
              <Button
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(viewingAccount?.accessToken || '');
                  message.success('Đã sao chép Access Token!');
                }}
                className="rounded-xl"
              />
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3.5">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800">
              <div className="flex items-center gap-2">
                <SafetyCertificateOutlined className="text-emerald-400 text-base" />
                <span className="text-xs font-semibold text-slate-200">
                  {parseCookieString(viewingAccount?.accessToken).datr && parseCookieString(viewingAccount?.accessToken).sb
                    ? '🟢 Đã nạp đầy đủ bộ Cookie kháng Checkpoint'
                    : '🟡 Bộ Cookie cơ bản (c_user + xs)'}
                </span>
              </div>
              <Button
                type="primary"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(viewingAccount?.accessToken || '');
                  message.success('Đã sao chép toàn bộ chuỗi Full Cookie!');
                }}
                className="bg-emerald-600 rounded-lg text-xs"
              >
                Sao chép Full Cookie
              </Button>
            </div>

            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              <div>
                <Text className="font-medium text-slate-300 block mb-1 text-xs"><code>c_user</code> (UID Facebook):</Text>
                <div className="flex gap-2">
                  <Input readOnly value={parseCookieString(viewingAccount?.accessToken).cUser} className="rounded-xl font-mono text-xs" />
                  <Button
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(parseCookieString(viewingAccount?.accessToken).cUser);
                      message.success('Đã sao chép c_user!');
                    }}
                    className="rounded-xl"
                  />
                </div>
              </div>

              <div>
                <Text className="font-medium text-slate-300 block mb-1 text-xs"><code>xs</code> (Session token):</Text>
                <div className="flex gap-2">
                  <Input.Password readOnly value={parseCookieString(viewingAccount?.accessToken).xs} className="rounded-xl font-mono text-xs" />
                  <Button
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(parseCookieString(viewingAccount?.accessToken).xs);
                      message.success('Đã sao chép xs!');
                    }}
                    className="rounded-xl"
                  />
                </div>
              </div>

              {parseCookieString(viewingAccount?.accessToken).datr && (
                <div>
                  <Text className="font-medium text-slate-300 block mb-1 text-xs"><code>datr</code> (Thẻ căn cước thiết bị):</Text>
                  <div className="flex gap-2">
                    <Input readOnly value={parseCookieString(viewingAccount?.accessToken).datr} className="rounded-xl font-mono text-xs" />
                    <Button
                      icon={<CopyOutlined />}
                      onClick={() => {
                        navigator.clipboard.writeText(parseCookieString(viewingAccount?.accessToken).datr);
                        message.success('Đã sao chép datr!');
                      }}
                      className="rounded-xl"
                    />
                  </div>
                </div>
              )}

              {parseCookieString(viewingAccount?.accessToken).sb && (
                <div>
                  <Text className="font-medium text-slate-300 block mb-1 text-xs"><code>sb</code> (Ràng buộc trình duyệt):</Text>
                  <div className="flex gap-2">
                    <Input readOnly value={parseCookieString(viewingAccount?.accessToken).sb} className="rounded-xl font-mono text-xs" />
                    <Button
                      icon={<CopyOutlined />}
                      onClick={() => {
                        navigator.clipboard.writeText(parseCookieString(viewingAccount?.accessToken).sb);
                        message.success('Đã sao chép sb!');
                      }}
                      className="rounded-xl"
                    />
                  </div>
                </div>
              )}

              {parseCookieString(viewingAccount?.accessToken).fr && (
                <div>
                  <Text className="font-medium text-slate-300 block mb-1 text-xs"><code>fr</code> (Mã bảo mật phiên):</Text>
                  <div className="flex gap-2">
                    <Input.Password readOnly value={parseCookieString(viewingAccount?.accessToken).fr} className="rounded-xl font-mono text-xs" />
                    <Button
                      icon={<CopyOutlined />}
                      onClick={() => {
                        navigator.clipboard.writeText(parseCookieString(viewingAccount?.accessToken).fr);
                        message.success('Đã sao chép fr!');
                      }}
                      className="rounded-xl"
                    />
                  </div>
                </div>
              )}

              {parseCookieString(viewingAccount?.accessToken).wd && (
                <div>
                  <Text className="font-medium text-slate-300 block mb-1 text-xs"><code>wd</code> (Kích thước màn hình):</Text>
                  <div className="flex gap-2">
                    <Input readOnly value={parseCookieString(viewingAccount?.accessToken).wd} className="rounded-xl font-mono text-xs" />
                    <Button
                      icon={<CopyOutlined />}
                      onClick={() => {
                        navigator.clipboard.writeText(parseCookieString(viewingAccount?.accessToken).wd);
                        message.success('Đã sao chép wd!');
                      }}
                      className="rounded-xl"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* DRAWER: Kiểm kê toàn bộ Page của 1 nick cá nhân */}
      <Drawer
        title={
          <div className="flex items-center justify-between gap-3 pr-2">
            <div className="flex items-center gap-3">
              <Avatar icon={<FacebookOutlined />} className="bg-blue-600 text-white shrink-0" size={36} />
              <div>
                <div className="font-semibold text-sm text-slate-100">
                  {latestPageScan?.profileName ||
                    auditedPages.find((p) => p.profileName)?.profileName ||
                    viaNameMap.get(parseCookieString(pageAuditSource?.accessToken).cUser) ||
                    `Via #${parseCookieString(pageAuditSource?.accessToken).cUser}`}
                </div>
                <div className="text-[11px] text-slate-400">Kiểm kê danh sách Fanpage và xác minh quyền chuyển đổi danh tính</div>
              </div>
            </div>
            <Button
              type="primary"
              icon={<SyncOutlined spin={scanManagedPagesMutation.isPending} />}
              loading={scanManagedPagesMutation.isPending}
              onClick={() => pageAuditSource && scanManagedPagesMutation.mutate(pageAuditSource.id)}
              className="font-medium text-xs bg-blue-600 rounded-xl"
            >
              {scanManagedPagesMutation.isPending ? 'Đang quét...' : 'Quét lại toàn bộ'}
            </Button>
          </div>
        }
        open={!!pageAuditSource}
        onClose={() => {
          if (!scanManagedPagesMutation.isPending) {
            setPageAuditSource(null);
            setLatestPageScan(null);
          }
        }}
        width={720}
        destroyOnHidden
        styles={{
          header: { borderBottom: '1px solid #1e293b' },
          body: { backgroundColor: '#0b111a', padding: '16px', color: '#e2e8f0' },
        }}
      >
        <div className="space-y-4">
          {scanManagedPagesMutation.isPending && (
            <div className="p-3.5 rounded-xl border border-blue-500/30 bg-blue-950/20 text-blue-300 text-xs flex items-center gap-2">
              <SyncOutlined spin className="text-blue-400" />
              <span>Đang kiểm tra và xác minh quyền chuyển đổi danh tính từng Page qua Playwright Engine...</span>
            </div>
          )}

          {/* Form thêm Page thủ công */}
          <div className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-2xl space-y-2">
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <PlusOutlined className="text-blue-400" /> Nhập Page thủ công
            </div>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Tên Page (tùy chọn)"
                value={manualPageName}
                onChange={(e) => setManualPageName(e.target.value)}
                size="small"
                className="w-1/3 rounded-lg"
              />
              <Input
                placeholder="Page ID (bắt buộc)"
                value={manualPageId}
                onChange={(e) => setManualPageId(e.target.value.trim())}
                size="small"
                className="flex-1 rounded-lg font-mono"
              />
              <Button
                type="primary"
                size="small"
                loading={addManualPageMutation.isPending}
                disabled={!manualPageId.trim()}
                onClick={() => {
                  if (manualPageId && pageAuditSource) {
                    addManualPageMutation.mutate({
                      accountId: pageAuditSource.id,
                      pageId: manualPageId,
                      pageName: manualPageName.trim() || `Page ${manualPageId.slice(-4)}`,
                    });
                  }
                }}
                className="bg-blue-600 rounded-lg shrink-0 font-medium"
              >
                Thêm
              </Button>
            </div>
          </div>

          {/* Stat counters */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-900/60 border border-slate-800 p-3.5 rounded-2xl">
              <div className="text-xs text-slate-300">Tổng Page hợp lệ</div>
              <div className="text-xl font-bold text-slate-100 mt-0.5">{auditedPages.length}</div>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 p-3.5 rounded-2xl">
              <div className="text-xs text-emerald-400">Đã xác minh quyền</div>
              <div className="text-xl font-bold text-emerald-400 mt-0.5">
                {auditedPages.filter((p) => p.verificationStatus === 'VERIFIED').length}
              </div>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 p-3.5 rounded-2xl">
              <div className="text-xs text-slate-300">Trạng thái Via</div>
              <div className="mt-1">
                <StatusBadge account={pageAuditSource!} />
              </div>
            </div>
          </div>

          {/* Quick sync all verified pages action bar */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-gradient-to-r from-blue-950/40 via-indigo-950/30 to-purple-950/40 border border-blue-500/30">
            <div>
              <div className="font-semibold text-[13px] text-blue-200 flex items-center gap-1.5">
                <ThunderboltOutlined className="text-amber-400" />
                Đồng bộ vào danh sách kênh xuất bản
              </div>
              <div className="text-xs text-slate-300 mt-0.5">
                Thêm ngay toàn bộ Fanpage đã kiểm kê vào hệ thống để bắt đầu lên lịch và đăng bài.
              </div>
            </div>
            <Button
              type="primary"
              icon={<ThunderboltOutlined className="text-amber-300" />}
              loading={importPagesMutation.isPending}
              disabled={auditedPages.length === 0}
              onClick={() => {
                if (pageAuditSource) {
                  importPagesMutation.mutate({ accountId: pageAuditSource.id });
                }
              }}
              className="bg-emerald-600 hover:bg-emerald-500 font-semibold text-[13px] rounded-xl shadow-md shrink-0"
            >
              Đồng bộ tất cả vào Tool
            </Button>
          </div>

          {/* Bảng danh sách Pages đã quét */}
          <Table<FacebookPageAccess>
            rowKey={(r) => r.id || r.pageId}
            dataSource={auditedPages}
            loading={managedPagesQuery.isLoading || scanManagedPagesMutation.isPending}
            pagination={{ pageSize: 8 }}
            size="middle"
            columns={[
              {
                title: 'Fanpage',
                key: 'page',
                render: (_, r) => (
                  <div className="flex items-center gap-2.5 py-0.5">
                    <Avatar src={r.avatarUrl} icon={<FacebookOutlined />} size={28} className="bg-blue-600 text-white shrink-0" />
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-100 text-[13px] truncate max-w-[200px]">{r.pageName}</div>
                      <div className="font-mono text-xs text-slate-400">ID: {r.pageId}</div>
                    </div>
                  </div>
                ),
              },
              {
                title: 'Quyền quản trị',
                dataIndex: 'verificationStatus',
                key: 'verificationStatus',
                width: 170,
                render: (st: FacebookPageAccess['verificationStatus']) => <PageAccessStatusTag status={st} />,
              },
              {
                title: 'Hành động',
                key: 'action',
                width: 145,
                render: (_, r) => {
                  const isConnected = publishableAccounts.some((a) => String(a.platformAccountId) === String(r.pageId));
                  return (
                    <div className="flex items-center justify-end gap-1.5">
                      {isConnected ? (
                        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          Đã kết nối
                        </span>
                      ) : (
                        <Button
                          type="primary"
                          size="small"
                          icon={<PlusOutlined />}
                          loading={importPagesMutation.isPending}
                          onClick={() => {
                            if (pageAuditSource) {
                              importPagesMutation.mutate({ accountId: pageAuditSource.id, pageIds: [r.pageId] });
                            }
                          }}
                          className="text-xs !h-7 px-2.5 bg-blue-600 rounded-md font-medium"
                        >
                          Thêm
                        </Button>
                      )}
                      {r.pageUrl && (
                        <Button
                          type="link"
                          href={r.pageUrl}
                          target="_blank"
                          rel="noreferrer"
                          icon={<LinkOutlined />}
                          className="text-blue-400 p-0 text-xs"
                          title="Xem trên Facebook"
                        />
                      )}
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        loading={deleteManualPageMutation.isPending}
                        onClick={() => {
                          if (pageAuditSource) {
                            deleteManualPageMutation.mutate({ accountId: pageAuditSource.id, pageId: r.pageId });
                          }
                        }}
                        className="text-slate-500 hover:text-red-400 p-0 h-6 w-6"
                        title="Xóa khỏi kiểm kê"
                      />
                    </div>
                  );
                },
              },
            ]}
          />
        </div>
      </Drawer>

      <FacebookBrowserLoginModal
        open={!!fbLoginModal}
        reloginAccount={fbLoginModal?.account}
        accounts={accounts || []}
        onClose={() => setFbLoginModal(null)}
      />

      {/* MODAL: Quick Update Cookie */}
      <QuickUpdateCookieModal
        open={quickCookieModalOpen}
        onClose={() => setQuickCookieModalOpen(false)}
        targetAccountId={quickCookieTargetId}
      />

      {/* MODAL: Extension 1-Click Sync Guide */}
      <Modal
        open={extensionModalOpen}
        onCancel={() => setExtensionModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setExtensionModalOpen(false)}>
            Đóng
          </Button>,
          <Button
            key="refresh"
            type="primary"
            icon={<SyncOutlined />}
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
              message.success('Đã làm mới danh sách kết nối!');
              setExtensionModalOpen(false);
            }}
            className="bg-blue-600 font-semibold"
          >
            Kiểm tra Nick mới
          </Button>,
        ]}
        width={680}
        centered
        className="dark-modal"
        title={
          <div className="flex items-center gap-2.5 text-slate-100 pb-2 border-b border-slate-800">
            <span className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
              ⚡
            </span>
            <span className="font-semibold text-base">
              Đồng Bộ Facebook 1-Chạm Qua Chrome Extension (Dùng Cho Mọi Profile)
            </span>
          </div>
        }
      >
        <div className="space-y-4 pt-2 text-slate-200">
          <p className="text-[13px] text-slate-300 leading-relaxed m-0">
            Nếu bạn quản lý <b>nhiều Chrome Profile</b> (Profile 1, Profile 2, Nick A, Nick B...), bạn không cần copy cookie hay gõ mật khẩu. Chỉ cần dùng Extension ToolZutter có sẵn trong máy:
          </p>

          <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-3.5 space-y-2">
            <div className="flex items-center gap-2 text-[13px] font-bold text-blue-300">
              <span className="w-5 h-5 rounded-full bg-blue-500/30 flex items-center justify-center text-xs">1</span>
              Cài tiện ích ToolZutter vào Chrome (Chỉ làm 1 lần)
            </div>
            <ol className="text-[13px] text-slate-200 space-y-1.5 pl-6 m-0 list-decimal">
              <li>Mở tab mới trên Chrome: <code className="bg-slate-800 px-1.5 py-0.5 rounded text-sky-400 font-mono">chrome://extensions/</code></li>
              <li>Bật công tắc <b>"Chế độ dành cho nhà phát triển" (Developer mode)</b> ở góc trên cùng bên phải.</li>
              <li>Bấm nút <b>"Tải tiện ích đã giải nén" (Load unpacked)</b> ở góc trên cùng bên trái.</li>
              <li>Chọn thư mục extension trên máy tính (nằm trong thư mục mã nguồn dự án):
                <div className="mt-1.5 flex items-center gap-2 bg-slate-900 p-2 rounded-lg border border-slate-700/80">
                  <span className="text-xs font-mono text-emerald-400 truncate flex-1">
                    auto-post-saas/extension
                  </span>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText('auto-post-saas/extension');
                      message.success('Đã sao chép tên thư mục extension!');
                    }}
                    className="shrink-0 text-xs"
                  >
                    Sao chép tên thư mục
                  </Button>
                </div>
              </li>
            </ol>
          </div>

          <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3.5 space-y-2">
            <div className="flex items-center gap-2 text-[13px] font-bold text-amber-300">
              <span className="w-5 h-5 rounded-full bg-amber-500/30 flex items-center justify-center text-xs">2</span>
              Đồng bộ nick Facebook ở bất kỳ Profile nào (Mất 1 giây)
            </div>
            <ol className="text-[13px] text-slate-200 space-y-1.5 pl-6 m-0 list-decimal">
              <li>Mở bất kỳ Chrome Profile nào bạn đang đăng nhập Facebook.</li>
              <li>Bấm vào icon <b>ToolZutter (⚡)</b> trên thanh công cụ của Chrome.</li>
              <li>Chuyển sang tab <b>🔑 Cookie FB</b>.</li>
              <li>Bấm nút <b>"⚡ Đồng Bộ Nick Này Sang ToolZutter (1-Chạm)"</b>.</li>
            </ol>
            <div className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-xs text-emerald-300 flex items-center gap-2 mt-2">
              <CheckCircleOutlined className="text-emerald-400 shrink-0" />
              <span><b>Tự động 100%:</b> Tool lập tức nhận diện Nick Via, lưu kết nối và quét sạch toàn bộ Fanpage mà Via đó quản trị!</span>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Connections;
