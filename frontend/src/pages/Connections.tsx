import { useState, useMemo } from 'react';
import {
  Button,
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
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../config/axios';
import { useSearchParams } from 'react-router-dom';
import QuickUpdateCookieModal from '../components/modals/QuickUpdateCookieModal';
import FacebookBrowserLoginModal from '../components/modals/FacebookBrowserLoginModal';
import Groups from './Groups';

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

// Tự động trích xuất c_user & xs từ mọi định dạng (Full Cookie chuỗi dài, JSON mảng, chuỗi gộp)
export const smartExtractCookie = (rawInput?: string) => {
  if (!rawInput) return { cUser: '', xs: '', isValid: false, normalized: '' };
  const text = rawInput.trim();

  // 1. JSON format từ tiện ích J2Team / Cookie-Editor
  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const arr = JSON.parse(text);
      let cUser = '';
      let xs = '';
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item?.name === 'c_user') cUser = String(item.value || '').trim();
          if (item?.name === 'xs') xs = String(item.value || '').trim();
        }
      }
      if (cUser && xs) {
        return { cUser, xs, isValid: true, normalized: `c_user=${cUser}; xs=${xs}` };
      }
    } catch {}
  }

  // 2. Regex trích xuất c_user
  const cUserMatch = text.match(/(?:c_user=|^c_user:\s*|["']?c_user["']?\s*[:=]\s*["']?)([\d]+)/i);
  const cUser = cUserMatch ? cUserMatch[1].trim() : '';

  // 3. Regex trích xuất xs
  const xsMatch = text.match(/(?:xs=|^xs:\s*|["']?xs["']?\s*[:=]\s*["']?)([^;'"\s\n\r]+)/i);
  let xs = xsMatch ? xsMatch[1].trim() : '';

  if (!xs && text && !text.includes('=')) {
    xs = text;
  }

  const isValid = Boolean(cUser && xs);
  return {
    cUser,
    xs,
    isValid,
    normalized: isValid ? `c_user=${cUser}; xs=${xs}` : '',
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

// Phân tách c_user và xs từ chuỗi cookie
const parseCookieString = (accessToken?: string) => {
  if (!accessToken) return { cUser: '', xs: '' };
  const extracted = smartExtractCookie(accessToken);
  if (extracted.isValid) {
    return { cUser: extracted.cUser, xs: extracted.xs };
  }
  const cUserMatch = accessToken.match(/c_user=([^;]*)/);
  const xsMatch = accessToken.match(/xs=([^;]*)/);
  return {
    cUser: cUserMatch?.[1]?.trim() || '',
    xs: xsMatch?.[1]?.trim() || '',
  };
};

// Tag trạng thái quyền Page kiểm kê chuẩn Linear-tier
const PageAccessStatusTag = ({ status }: { status: FacebookPageAccess['verificationStatus'] }) => {
  if (status === 'VERIFIED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Đã xác minh quyền
      </span>
    );
  }
  if (status === 'NO_ACCESS') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        Mất quyền quản trị
      </span>
    );
  }
  if (status === 'SESSION_INVALID') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
        Phiên đăng nhập hết hạn
      </span>
    );
  }
  if (status === 'NOT_SEEN') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        Chưa tìm thấy
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
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
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/15 text-red-300 border border-red-500/30 shadow-[0_0_12px_rgba(239,68,68,0.2)]">
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
            className="text-[11px] h-6 px-2 font-semibold rounded-md shadow-sm"
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

  // Forms
  const [form] = Form.useForm();
  const [configForm] = Form.useForm();
  const [personalViaForm] = Form.useForm();

  const activeTab = searchParams.get('tab') === 'groups' ? 'groups' : 'accounts';

  // 1. Fetch danh sách tài khoản
  const { data: accounts, isLoading } = useQuery({
    queryKey: ['socialAccounts'],
    queryFn: async () => {
      const response = await api.get('/connections');
      return response.data as SocialAccount[];
    },
  });

  // Tách danh sách Vias duy nhất theo c_user
  const personalVias = useMemo(() => {
    const uniqueVias = new Map<string, SocialAccount>();
    for (const account of accounts || []) {
      if (!isPersonalCookieType(account.accountType) || account.platform === 'FACEBOOK_GROUP') continue;
      const { cUser } = parseCookieString(account.accessToken);
      if (!cUser) continue;
      const existing = uniqueVias.get(cUser);
      const accountIsProfile = account.platform === 'FACEBOOK_PROFILE' || account.accountType === 'PERSONAL_PROFILE_COOKIE';
      const existingIsProfile = existing?.platform === 'FACEBOOK_PROFILE' || existing?.accountType === 'PERSONAL_PROFILE_COOKIE';
      const shouldReplace =
        !existing ||
        (accountIsProfile && !existingIsProfile) ||
        (accountIsProfile === existingIsProfile && existing.tokenStatus !== 'OK' && account.tokenStatus === 'OK') ||
        (accountIsProfile === existingIsProfile && existing.tokenStatus === account.tokenStatus && account.id > existing.id);
      if (shouldReplace) {
        uniqueVias.set(cUser, account);
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

  // Danh sách Fanpage / Trang (loại bỏ Profile cá nhân và Group)
  const publishableAccounts = useMemo(
    () => (accounts || []).filter((a) => a.platform !== 'FACEBOOK_PROFILE' && a.platform !== 'FACEBOOK_GROUP'),
    [accounts]
  );

  const groupCount = useMemo(
    () => (accounts || []).filter((a) => a.platform === 'FACEBOOK_GROUP').length,
    [accounts]
  );

  // Danh sách các tài khoản hết hạn cookie
  const expiredAccounts = useMemo(
    () => (accounts || []).filter((a) => isPersonalCookieType(a.accountType) && a.tokenStatus === 'EXPIRED'),
    [accounts]
  );

  // GOM NHÓM: Phân chia chính xác Fanpage nào thuộc Via nào (O(N) siêu nhanh)
  const viaGroupedData = useMemo(() => {
    const map = new Map<string, SocialAccount[]>();
    const independent: SocialAccount[] = [];

    personalVias.forEach(({ cUser }) => {
      map.set(cUser, []);
    });

    for (const acc of publishableAccounts) {
      const { cUser } = parseCookieString(acc.accessToken);
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
  }, [personalVias, publishableAccounts, viaNameMap]);

  // Lọc client-side mượt mà theo search & filter
  const filteredAccounts = useMemo(() => {
    return publishableAccounts.filter((acc) => {
      const { cUser } = parseCookieString(acc.accessToken);
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
  }, [publishableAccounts, searchText, statusFilter, viaFilter, viaNameMap]);

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
    mutationFn: async (values: { profileLabel?: string; cUser: string; xs: string }) => {
      const cUser = values.cUser.trim();
      const response = await api.post('/connections', {
        platform: 'FACEBOOK_PROFILE',
        platformAccountId: cUser,
        pageName: values.profileLabel?.trim() || `Via Facebook #${cUser}`,
        accountType: 'PERSONAL_PROFILE_COOKIE',
        accessToken: `c_user=${cUser}; xs=${values.xs.trim()}`,
        tokenStatus: 'OK',
        tokenCheckedAt: new Date().toISOString(),
      });
      return response.data as SocialAccount;
    },
    onSuccess: (account) => {
      message.success('Đã lưu Via cá nhân thành công!');
      personalViaForm.resetFields();
      setPersonalViaModalOpen(false);
      setLatestPageScan(null);
      setPageAuditSource(account);
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
      message.success('Đã xóa kết nối!');
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
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

  const openConfigDrawer = (record: SocialAccount) => {
    setConfigDrawerAccount(record);
    const { cUser, xs } = parseCookieString(record.accessToken);
    configForm.setFieldsValue({
      pageName: record.pageName || '',
      platformAccountId: record.platformAccountId || '',
      cUser,
      xs,
      accessToken: record.accessToken || '',
      maxPostsPerDay: record.maxPostsPerDay ?? null,
      backupAccountId: record.backupAccountId || undefined,
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
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="font-mono text-[10px] text-slate-400 bg-slate-800/90 px-1.5 py-0.2 rounded border border-slate-700/60">
                  ID: {record.platformAccountId}
                </span>
                <Tooltip title="Sao chép ID">
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined className="text-slate-500 hover:text-blue-400 text-[10px]" />}
                    onClick={() => {
                      navigator.clipboard.writeText(record.platformAccountId);
                      message.success('Đã sao chép ID!');
                    }}
                    className="h-4 w-4 p-0"
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
              const { cUser } = parseCookieString(record.accessToken);
              if (!cUser) return <span className="text-xs text-slate-500">—</span>;
              const viaName = viaNameMap.get(cUser) || `Via #${cUser}`;
              return (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-800/80 text-slate-300 border border-slate-700/60 text-xs">
                  <UserOutlined className="text-blue-400 text-[10px]" />
                  <span className="max-w-[130px] truncate font-medium">{viaName}</span>
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
      width: 140,
      render: (type: string) => {
        const isCookie = isPersonalCookieType(type);
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${
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
      width: 180,
      render: (_: any, record: SocialAccount) => (
        <StatusBadge
          account={record}
          onQuickUpdate={() => {
            setQuickCookieTargetId(record.id);
            setQuickCookieModalOpen(true);
          }}
        />
      ),
    },
    {
      title: 'Giới hạn',
      key: 'limit',
      width: 120,
      render: (_: any, record: SocialAccount) =>
        record.maxPostsPerDay ? (
          <span className="text-xs font-semibold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded">
            {record.maxPostsPerDay} bài/ngày
          </span>
        ) : (
          <span className="text-xs text-slate-500">Mặc định</span>
        ),
    },
    {
      title: 'Dự phòng / Proxy',
      key: 'backupAndProxy',
      render: (_: any, record: SocialAccount) => {
        const backupAcc = publishableAccounts.find((a) => a.id === record.backupAccountId);
        const hasProxy = Boolean(record.proxyUrl);

        return (
          <div className="flex flex-col gap-0.5 text-xs">
            {backupAcc ? (
              <span className="text-slate-300 truncate max-w-[160px]" title={`Dự phòng: ${backupAcc.pageName || backupAcc.platformAccountId}`}>
                <span className="text-slate-500">Dự phòng:</span> {backupAcc.pageName || backupAcc.platformAccountId}
              </span>
            ) : null}
            {hasProxy ? (
              <span className="text-emerald-400 font-mono text-[11px] truncate max-w-[160px]" title={record.proxyUrl}>
                <GlobalOutlined className="mr-1 text-[10px]" />
                {record.proxyUrl}
              </span>
            ) : null}
            {!backupAcc && !hasProxy && <span className="text-slate-600 text-[11px]">Mặc định</span>}
          </div>
        );
      },
    },
    {
      title: 'Thao tác',
      key: 'action',
      width: 110,
      render: (_: any, record: SocialAccount) => (
        <Space size="small">
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
    <div className="flex items-center justify-between pb-1 border-b border-slate-800/80 mb-4">
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
    <div className="app-page space-y-6">
      {tabsBar}

      {/* Emergency Cookie Banner if any account expired */}
      {expiredAccounts.length > 0 && (
        <div className="rounded-2xl border border-red-500/30 bg-gradient-to-r from-red-950/30 via-slate-900/60 to-red-950/20 p-4 shadow-[0_4px_20px_rgba(239,68,68,0.12)] backdrop-blur-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 flex items-center justify-center shrink-0 mt-0.5">
                <CloseCircleOutlined className="text-base" />
              </div>
              <div>
                <div className="font-semibold text-sm text-red-200 flex items-center gap-2">
                  <span>Có {expiredAccounts.length} kết nối Facebook Cookie đã hết hạn</span>
                  <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
                </div>
                <div className="text-xs text-red-400/80 mt-0.5 leading-relaxed">
                  Các Fanpage: <b>{expiredAccounts.map((a) => a.pageName || a.platformAccountId).join(', ')}</b> có thể bị tạm dừng xuất bản. Hãy cập nhật cookie mới cho Via sở hữu để đồng bộ toàn bộ.
                </div>
              </div>
            </div>
            <Button
              type="primary"
              danger
              icon={<ThunderboltOutlined />}
              onClick={() => {
                setQuickCookieTargetId(expiredAccounts[0]?.id);
                setQuickCookieModalOpen(true);
              }}
              className="font-bold text-xs h-9 px-4 rounded-xl shrink-0 shadow-md hover:scale-[1.02] active:scale-[0.98] transition-transform"
            >
              Cập nhật Cookie (1-Chạm Đồng Bộ)
            </Button>
          </div>
        </div>
      )}

      {/* Header Bar & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Title level={4} className="!mb-0.5 !text-slate-100 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <ApiOutlined />
            </div>
            <span>Quản lý kết nối Via & Fanpage</span>
          </Title>
          <Text className="text-xs text-slate-400">
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
          <Button
            icon={<ThunderboltOutlined className="text-amber-400" />}
            onClick={() => setExtensionModalOpen(true)}
            className="font-semibold h-10 px-4 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20 hover:border-amber-400/50 transition-all shadow-sm"
          >
            Đồng bộ 1-Chạm (Mọi Profile)
          </Button>
          <Button
            icon={<LoginOutlined />}
            onClick={() => setFbLoginModal({})}
            className="font-medium h-10 px-4 rounded-xl bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-700/80 hover:border-slate-600 transition-all"
          >
            Đăng nhập Facebook
          </Button>
          <Button
            icon={<UserOutlined />}
            onClick={() => setPersonalViaModalOpen(true)}
            className="font-medium h-10 px-4 rounded-xl bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-700/80 hover:border-slate-600 transition-all"
          >
            Thêm Via cá nhân
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsModalVisible(true)}
            className="font-semibold h-10 px-5 rounded-xl bg-blue-600 hover:bg-blue-500 shadow-[0_4px_16px_rgba(37,99,235,0.25)] hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            Thêm Fanpage mới
          </Button>
        </div>
      </div>

      {/* Control Bar: Search, Filters, View Modes */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-900/40 p-2.5 rounded-2xl border border-slate-800/80 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <Input
            prefix={<SearchOutlined className="text-slate-500" />}
            placeholder="Tìm theo tên Page, ID hoặc UID..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="max-w-[260px] rounded-xl bg-slate-800/60 border-slate-700/80 text-xs hover:border-slate-600 focus:border-blue-500"
            allowClear
          />

          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            className="w-36 text-xs"
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
              className="w-44 text-xs"
              options={[
                { value: 'ALL', label: 'Tất cả Via sở hữu' },
                ...personalVias.map(({ cUser }) => ({
                  value: cUser,
                  label: viaNameMap.get(cUser) || `Via #${cUser}`,
                })),
              ]}
            />
          )}

          <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-500 ml-auto pr-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            <span>Tổng cộng: <b className="text-slate-300 font-semibold">{personalVias.length} Via</b> · <b className="text-slate-300 font-semibold">{publishableAccounts.length} Fanpage</b></span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Segmented
            value={viewMode}
            onChange={(val) => setViewMode(val as 'grouped' | 'table' | 'cards')}
            options={[
              { value: 'grouped', icon: <ApartmentOutlined />, label: 'Theo từng Via' },
              { value: 'table', icon: <BarsOutlined />, label: 'Bảng phẳng' },
              { value: 'cards', icon: <AppstoreOutlined />, label: 'Lưới thẻ' },
            ]}
            className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-0.5 text-xs"
          />
        </div>
      </div>

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
                        ? 'border-red-500/30 bg-gradient-to-b from-red-950/20 via-slate-900/80 to-slate-900/90 shadow-[0_4px_24px_rgba(239,68,68,0.08)]'
                        : 'border-slate-800/80 bg-slate-900/60 shadow-[inset_0_1px_1px_rgba(255,255,255,0.03)] hover:border-slate-700/80'
                    } overflow-hidden`}
                  >
                    {/* VIA HEADER PANEL */}
                    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-sm">
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
                            <span className="font-mono text-[11px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md border border-slate-700/80">
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
                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-1">
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
                              <span className="text-slate-500">
                                · Kiểm tra: {new Date(viaAccount.tokenCheckedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* ACTIONS PER VIA */}
                      <div className="flex flex-wrap items-center gap-2">
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
                    <div className="p-0 bg-slate-950/30">
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
        <Card variant="borderless" className="app-surface shadow-sm rounded-2xl border border-slate-800/80 overflow-hidden p-0">
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
            <Card variant="borderless" className="app-surface rounded-2xl border border-slate-800 text-center py-8">
              <Empty description={<span className="text-slate-400 text-xs">Không tìm thấy Fanpage nào</span>} />
            </Card>
          ) : (
            <Row gutter={[14, 14]}>
              {filteredAccounts.map((acc) => {
                const { cUser } = parseCookieString(acc.accessToken);
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
                              <span className="font-mono text-[11px] text-slate-400">ID: {acc.platformAccountId}</span>
                            </div>
                          </div>
                          <Tag color={isPersonalCookieType(acc.accountType) ? 'purple' : 'cyan'} className="!rounded-md font-medium text-[11px]">
                            {isPersonalCookieType(acc.accountType) ? 'Cookie' : 'Token'}
                          </Tag>
                        </div>

                        <div className="space-y-1.5 text-xs text-slate-400 mb-3 bg-slate-800/40 p-2.5 rounded-xl border border-slate-800">
                          {viaName && (
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500">Thuộc Via:</span>
                              <span className="text-slate-300 font-medium">{viaName}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">Trạng thái:</span>
                            <StatusBadge
                              account={acc}
                              onQuickUpdate={() => {
                                setQuickCookieTargetId(acc.id);
                                setQuickCookieModalOpen(true);
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">Giới hạn:</span>
                            <span className="text-slate-300">
                              {acc.maxPostsPerDay ? `${acc.maxPostsPerDay} bài/ngày` : 'Không giới hạn'}
                            </span>
                          </div>
                          {backupAcc && (
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500">Dự phòng:</span>
                              <span className="text-slate-300 truncate max-w-[130px]">{backupAcc.pageName || backupAcc.platformAccountId}</span>
                            </div>
                          )}
                          {acc.proxyUrl && (
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500">Proxy:</span>
                              <span className="text-emerald-400 font-mono text-[11px] truncate max-w-[130px]">{acc.proxyUrl}</span>
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
                  const accessToken = isToken
                    ? values.accessToken
                    : values.cUser && values.xs
                    ? `c_user=${values.cUser.trim()}; xs=${values.xs.trim()}`
                    : undefined;

                  saveConfigMutation.mutate({
                    id: configDrawerAccount.id,
                    payload: {
                      pageName: values.pageName?.trim(),
                      platformAccountId: values.platformAccountId?.trim(),
                      accessToken,
                      maxPostsPerDay: values.maxPostsPerDay ?? null,
                      backupAccountId: values.backupAccountId ?? 0,
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
            <div className="space-y-3">
              <div className="text-xs font-semibold text-slate-400">Cookie xác thực Facebook</div>
              <Form.Item
                name="cUser"
                label={<span className="text-xs text-slate-400">c_user (UID)</span>}
                rules={[{ required: true, message: 'Nhập c_user' }]}
              >
                <Input className="rounded-xl font-mono" />
              </Form.Item>
              <Form.Item
                name="xs"
                label={<span className="text-xs text-slate-400">xs (Session token)</span>}
                rules={[{ required: true, message: 'Nhập xs' }]}
              >
                <div className="flex gap-2">
                  <Input.Password className="rounded-xl font-mono flex-1" />
                  <Button
                    icon={<CopyOutlined />}
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        if (text) configForm.setFieldValue('xs', text.trim());
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
                    <Input placeholder={isThreads ? 'Ví dụ: Làm Sen Threads' : 'Ví dụ: Tin Tức Công Nghệ 24/7'} className="rounded-xl" />
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
                            label={<span className="font-medium text-slate-300">Gắn vào Via cá nhân sở hữu</span>}
                            extra={<span className="text-xs text-slate-400">💡 Chọn Via có sẵn để tự động kế thừa Cookie, khi Via đổi cookie thì Page này cũng tự cập nhật.</span>}
                          >
                            <Select
                              placeholder="Chọn Via sở hữu..."
                              allowClear
                              className="rounded-xl"
                              onChange={(viaCUser) => {
                                const targetVia = personalVias.find((v) => v.cUser === viaCUser);
                                if (targetVia) {
                                  form.setFieldValue('accessToken', targetVia.account.accessToken);
                                  message.success(`Đã tự động lấy Cookie của Via ${viaNameMap.get(viaCUser) || viaCUser}`);
                                }
                              }}
                            >
                              {personalVias.map(({ cUser }) => (
                                <Option key={cUser} value={cUser}>
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
            setIsManualViaMode(false);
          }
        }}
        footer={null}
        width={520}
        centered
        className="dark-modal"
      >
        <Form
          form={personalViaForm}
          layout="vertical"
          onFinish={(values) => {
            // Tự động kiểm tra nếu có rawCookieVia mà form chưa set kịp
            if ((!values.cUser || !values.xs) && rawCookieVia) {
              const parsed = smartExtractCookie(rawCookieVia);
              if (parsed.isValid) {
                values.cUser = parsed.cUser;
                values.xs = parsed.xs;
              }
            }
            if (!values.cUser || !values.xs) {
              message.error('Vui lòng cung cấp Cookie có chứa c_user và mã phiên xs hợp lệ!');
              return;
            }
            addPersonalViaMutation.mutate(values);
          }}
          className="mt-4 space-y-3"
        >
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

          {/* Ô DÁN COOKIE NHANH - 1 Ô DUY NHẤT */}
          <div className="p-3.5 rounded-2xl border border-blue-500/30 bg-blue-950/20 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-blue-300 flex items-center gap-1.5">
                <ThunderboltOutlined className="text-amber-400" />
                Dán Cookie Facebook (1 Ô Duy Nhất — Tự Bóc Tách)
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
                        });
                        if (!personalViaForm.getFieldValue('profileLabel')) {
                          personalViaForm.setFieldValue('profileLabel', `Via Facebook #${parsed.cUser}`);
                        }
                        message.success(`Đã tự động nhận diện UID: ${parsed.cUser}`);
                      } else {
                        message.warning('Đã dán nhưng chưa tìm thấy c_user hoặc xs. Hãy kiểm tra lại chuỗi cookie.');
                      }
                    }
                  } catch {
                    message.info('Vui lòng dán trực tiếp (Ctrl+V) vào ô bên dưới');
                  }
                }}
                className="text-[11px] h-6 px-2.5 rounded-lg bg-blue-600/30 border-blue-500/40 text-blue-200 hover:bg-blue-600 hover:text-white"
              >
                Dán từ Clipboard
              </Button>
            </div>

            <Input.TextArea
              rows={3}
              value={rawCookieVia}
              placeholder="Dán toàn bộ chuỗi Cookie vào đây (ví dụ: sb=...; c_user=1000...; xs=... hoặc định dạng JSON từ J2Team / Cookie-Editor)..."
              className="rounded-xl font-mono text-xs bg-slate-900/90 border-slate-700/80"
              onChange={(e) => {
                const text = e.target.value;
                setRawCookieVia(text);
                const parsed = smartExtractCookie(text);
                if (parsed.isValid) {
                  personalViaForm.setFieldsValue({
                    cUser: parsed.cUser,
                    xs: parsed.xs,
                  });
                  if (!personalViaForm.getFieldValue('profileLabel')) {
                    personalViaForm.setFieldValue('profileLabel', `Via Facebook #${parsed.cUser}`);
                  }
                }
              }}
            />

            {(() => {
              const parsed = smartExtractCookie(rawCookieVia);
              if (parsed.isValid) {
                return (
                  <div className="flex items-center justify-between p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <CheckCircleOutlined className="text-emerald-400" />
                      Nhận diện thành công UID: <span className="font-mono text-white underline">{parsed.cUser}</span>
                    </span>
                    <Tag color="success" className="mr-0 font-mono">Đã lấy c_user + xs</Tag>
                  </div>
                );
              }
              if (rawCookieVia.trim()) {
                return (
                  <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-1.5">
                    <WarningOutlined className="text-amber-400" />
                    Chưa tìm thấy cặp <code className="bg-amber-950/40 px-1 rounded font-mono">c_user</code> và <code className="bg-amber-950/40 px-1 rounded font-mono">xs</code> hợp lệ. Hãy kiểm tra lại chuỗi copy.
                  </div>
                );
              }
              return (
                <div className="text-[11px] text-slate-400 flex items-center gap-1">
                  <span>💡 Hỗ trợ: Chuỗi Cookie thô, định dạng JSON J2Team, hoặc chuỗi có chứa c_user & xs.</span>
                </div>
              );
            })()}
          </div>

          <Form.Item
            name="profileLabel"
            label={<span className="font-medium text-slate-300">Tên gợi nhớ</span>}
            extra={<span className="text-xs text-slate-500">Ví dụ: Huỳnh Thạnh Phú, Nick Chính, Nick Phụ 1...</span>}
          >
            <Input placeholder="Huỳnh Thạnh Phú" className="rounded-xl" />
          </Form.Item>

          {/* TOGGLE MỞ FORM NHẬP THỦ CÔNG */}
          <div className="flex items-center justify-between pt-1">
            <Button
              type="link"
              size="small"
              onClick={() => setIsManualViaMode(!isManualViaMode)}
              className="text-xs text-slate-400 hover:text-slate-200 px-0 flex items-center gap-1"
            >
              <span>{isManualViaMode ? '▲ Thu gọn chi tiết c_user & xs' : '▼ Tùy chỉnh nâng cao (Nhập tay c_user & xs)'}</span>
            </Button>
          </div>

          {isManualViaMode && (
            <div className="space-y-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
              <Form.Item
                name="cUser"
                label={<span className="font-medium text-slate-300 text-xs">c_user (Facebook UID)</span>}
                rules={[
                  { required: true, message: 'Vui lòng nhập c_user!' },
                  { pattern: /^\d{5,}$/, message: 'c_user phải là chuỗi số Facebook ID.' },
                ]}
              >
                <Input placeholder="100023403136194" className="rounded-xl font-mono text-xs" />
              </Form.Item>

              <Form.Item
                name="xs"
                label={<span className="font-medium text-slate-300 text-xs">xs (Session token)</span>}
                rules={[{ required: true, message: 'Vui lòng nhập xs!' }]}
              >
                <div className="flex gap-2">
                  <Input.Password placeholder="Chuỗi xs..." className="rounded-xl font-mono text-xs flex-1" />
                  <Button
                    icon={<CopyOutlined />}
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        if (text) personalViaForm.setFieldValue('xs', text.trim());
                      } catch {}
                    }}
                    className="shrink-0 rounded-xl"
                  >
                    Dán
                  </Button>
                </div>
              </Form.Item>
            </div>
          )}

          {/* Ẩn input cUser & xs khi không ở manual mode để form vẫn giữ giá trị */}
          {!isManualViaMode && (
            <>
              <Form.Item name="cUser" hidden>
                <Input />
              </Form.Item>
              <Form.Item name="xs" hidden>
                <Input />
              </Form.Item>
            </>
          )}

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
        width={480}
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
          <div className="mt-4 space-y-3">
            <div>
              <Text className="font-medium text-slate-300 block mb-1 text-xs">c_user (UID)</Text>
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
              <Text className="font-medium text-slate-300 block mb-1 text-xs">xs (Session token)</Text>
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
              <div className="text-[11px] text-slate-400">Tổng Page hợp lệ</div>
              <div className="text-xl font-bold text-slate-100 mt-0.5">{auditedPages.length}</div>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 p-3.5 rounded-2xl">
              <div className="text-[11px] text-emerald-400">Đã xác minh quyền</div>
              <div className="text-xl font-bold text-emerald-400 mt-0.5">
                {auditedPages.filter((p) => p.verificationStatus === 'VERIFIED').length}
              </div>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 p-3.5 rounded-2xl">
              <div className="text-[11px] text-slate-400">Trạng thái Via</div>
              <div className="mt-1">
                <StatusBadge account={pageAuditSource!} />
              </div>
            </div>
          </div>

          {/* Bảng danh sách Pages đã quét */}
          <Table<FacebookPageAccess>
            rowKey={(r) => r.id || r.pageId}
            dataSource={auditedPages}
            loading={managedPagesQuery.isLoading || scanManagedPagesMutation.isPending}
            pagination={{ pageSize: 8 }}
            size="small"
            columns={[
              {
                title: 'Fanpage',
                key: 'page',
                render: (_, r) => (
                  <div className="flex items-center gap-2.5 py-0.5">
                    <Avatar src={r.avatarUrl} icon={<FacebookOutlined />} size={28} className="bg-blue-600 text-white shrink-0" />
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-200 text-xs truncate max-w-[200px]">{r.pageName}</div>
                      <div className="font-mono text-[10px] text-slate-500">ID: {r.pageId}</div>
                    </div>
                  </div>
                ),
              },
              {
                title: 'Quyền quản trị',
                dataIndex: 'verificationStatus',
                key: 'verificationStatus',
                width: 160,
                render: (st: FacebookPageAccess['verificationStatus']) => <PageAccessStatusTag status={st} />,
              },
              {
                title: '',
                key: 'action',
                width: 70,
                render: (_, r) => (
                  <div className="flex items-center justify-end gap-1">
                    {r.pageUrl && (
                      <Button
                        type="link"
                        href={r.pageUrl}
                        target="_blank"
                        rel="noreferrer"
                        icon={<LinkOutlined />}
                        className="text-blue-400 p-0 text-xs"
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
                    />
                  </div>
                ),
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
          <p className="text-xs text-slate-400 leading-relaxed m-0">
            Nếu bạn quản lý <b>nhiều Chrome Profile</b> (Profile 1, Profile 2, Nick A, Nick B...), bạn không cần copy cookie hay gõ mật khẩu. Chỉ cần dùng Extension ToolZutter có sẵn trong máy:
          </p>

          <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-3.5 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-blue-300">
              <span className="w-5 h-5 rounded-full bg-blue-500/30 flex items-center justify-center text-[11px]">1</span>
              Cài tiện ích ToolZutter vào Chrome (Chỉ làm 1 lần)
            </div>
            <ol className="text-xs text-slate-300 space-y-1.5 pl-6 m-0 list-decimal">
              <li>Mở tab mới trên Chrome: <code className="bg-slate-800 px-1.5 py-0.5 rounded text-sky-400 font-mono">chrome://extensions/</code></li>
              <li>Bật công tắc <b>"Chế độ dành cho nhà phát triển" (Developer mode)</b> ở góc trên cùng bên phải.</li>
              <li>Bấm nút <b>"Tải tiện ích đã giải nén" (Load unpacked)</b> ở góc trên cùng bên trái.</li>
              <li>Chọn thư mục extension trên máy tính:
                <div className="mt-1.5 flex items-center gap-2 bg-slate-900 p-2 rounded-lg border border-slate-700/80">
                  <span className="text-[11px] font-mono text-emerald-400 truncate flex-1">
                    /Users/huynhthanhphu/Documents/TOOLZUTTER/auto-post-saas/extension
                  </span>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText('/Users/huynhthanhphu/Documents/TOOLZUTTER/auto-post-saas/extension');
                      message.success('Đã sao chép đường dẫn thư mục!');
                    }}
                    className="shrink-0 text-xs"
                  >
                    Sao chép đường dẫn
                  </Button>
                </div>
              </li>
            </ol>
          </div>

          <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3.5 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
              <span className="w-5 h-5 rounded-full bg-amber-500/30 flex items-center justify-center text-[11px]">2</span>
              Đồng bộ nick Facebook ở bất kỳ Profile nào (Mất 1 giây)
            </div>
            <ol className="text-xs text-slate-300 space-y-1.5 pl-6 m-0 list-decimal">
              <li>Mở bất kỳ Chrome Profile nào bạn đang đăng nhập Facebook.</li>
              <li>Bấm vào icon <b>ToolZutter (⚡)</b> trên thanh công cụ của Chrome.</li>
              <li>Chuyển sang tab <b>🔑 Cookie FB</b>.</li>
              <li>Bấm nút <b>"⚡ Đồng Bộ Nick Này Sang ToolZutter (1-Chạm)"</b>.</li>
            </ol>
            <div className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-[11px] text-emerald-300 flex items-center gap-2 mt-2">
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
