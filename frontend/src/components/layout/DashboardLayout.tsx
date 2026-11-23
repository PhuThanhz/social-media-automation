import { useMemo, useState, type CSSProperties } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Layout, Menu, Button, Avatar, Dropdown, Badge, Drawer, Grid, Tooltip,
  Progress, Popover, Input, Flex,
} from 'antd';
import {
  MenuFoldOutlined, MenuUnfoldOutlined, DashboardOutlined,
  ClockCircleOutlined, DownloadOutlined, BellOutlined,
  UserOutlined, LogoutOutlined, ThunderboltFilled,
  TeamOutlined, VideoCameraOutlined, PlayCircleOutlined, PictureOutlined,
  FacebookFilled, QuestionCircleOutlined, CalendarOutlined, BankOutlined,
  CodeOutlined, AimOutlined, LikeOutlined, FireOutlined, SearchOutlined, RadarChartOutlined,
  RobotOutlined, BgColorsOutlined, CloseOutlined, SafetyCertificateOutlined,
  DownOutlined, RightOutlined, SettingOutlined,
} from '@ant-design/icons';
import api from '../../config/axios';
import dayjs from 'dayjs';
import BrandLogo from '../BrandLogo';
import { useAuthStore } from '../../store/authStore';
import { resolveBackgroundImage, useBackgroundStore } from '../../store/backgroundStore';
import BackgroundPicker from './BackgroundPicker';
import QueueFinishBadge from './QueueFinishBadge';
import SystemEngineBadge from './SystemEngineBadge';

interface SocialAccountLite {
  id: number;
  platform?: string;
  accountType?: string;
  tokenStatus?: string;
  pageName?: string;
  platformAccountId?: string;
}

interface PostTargetItem {
  socialAccountId: number;
  accountName: string;
  platform: string;
  platformAccountId?: string;
  targetCount: number;
  actualCount: number;
  pendingCount?: number;
  totalPending?: number;
  achieved: boolean;
}

const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;

const navigation = [
  {
    type: 'group' as const, label: 'TỔNG QUAN', children: [
      { key: '/dashboard', icon: <DashboardOutlined />, label: 'Bảng điều khiển' },
    ]
  },
  {
    type: 'group' as const, label: 'NỘI DUNG', children: [
      { key: '/dashboard/news-studio', icon: <PictureOutlined />, label: 'Studio Ảnh Tin' },
      { key: '/dashboard/viral-hunter', icon: <FireOutlined className="app-nav-icon-amber" />, label: 'Săn bài Viral' },
      { key: '/dashboard/playwright', icon: <PlayCircleOutlined />, label: 'Đăng tự động' },
    ]
  },
  {
    type: 'group' as const, label: 'KÊNH & TÀI NGUYÊN', children: [
      { key: '/dashboard/connections', icon: <FacebookFilled />, label: 'Quản lý kết nối' },
    ]
  },
  {
    type: 'group' as const, label: 'HỆ THỐNG', children: [
      { key: 'ai-settings', icon: <RobotOutlined className="app-nav-icon-cyan app-nav-icon-bold" />, label: 'Cấu hình AI (Gemini)' },
      // Trang quản trị key chỉ dành cho chủ phần mềm, ẩn khỏi bản Desktop giao khách
      ...(isTauri() ? [{ key: '/dashboard/users', icon: <TeamOutlined />, label: 'Người dùng' }] : []),
      ...(isTauri() ? [] : [{ key: '/dashboard/license', icon: <SafetyCertificateOutlined className="app-nav-icon-amber app-nav-icon-bold" />, label: 'Quản lý bản quyền' }]),
      { key: '/dashboard/logs', icon: <CodeOutlined />, label: 'Nhật ký hệ thống' },
    ]
  },
];

const pageMeta: Record<string, { title: string; description: string }> = {
  '/dashboard': { title: 'Tổng quan', description: 'Theo dõi hoạt động đăng bài và tình trạng hệ thống' },
  '/dashboard/news-studio': { title: 'Studio Ảnh Tin', description: 'Cào full bài báo, AI viết tiêu đề, ghép ảnh kiểu page tin tức rồi lên lịch đăng' },
  '/dashboard/viral-hunter': { title: 'Săn bài viral', description: '' },
  '/dashboard/queue': { title: 'Quản lý bài đăng', description: 'Lập lịch, kiểm tra trạng thái và xử lý bài đăng' },
  '/dashboard/playwright': { title: 'Đăng tự động', description: '' },
  '/dashboard/connections': { title: 'Quản lý kết nối', description: '' },
  '/dashboard/license': { title: 'Quản lý bản quyền', description: 'Kiểm soát ai đang dùng phần mềm, tạo key và khóa tức thì từ xa (Kill-Switch)' },
  '/dashboard/users': { title: 'Người dùng', description: 'Tài khoản đăng nhập trên máy này và giới hạn gói bản quyền' },
  '/dashboard/logs': { title: 'Nhật ký hệ thống', description: 'Theo dõi Worker, Backend và Frontend theo thời gian thực' },
};

import { isTauri } from '../../services/license.service';
import AppVersion from './AppVersion';
import QuickUpdateCookieModal from '../modals/QuickUpdateCookieModal';
import AiSettingsModal from '../modals/AiSettingsModal';

const DashboardLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [quickCookieModalOpen, setQuickCookieModalOpen] = useState(false);
  const [quickCookieTargetId, setQuickCookieTargetId] = useState<number | undefined>(undefined);
  const [dismissCookieBanner, setDismissCookieBanner] = useState(() => sessionStorage.getItem('dismiss_cookie_banner') === '1');
  const [kpiPanelOpen, setKpiPanelOpen] = useState(false);
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const backgroundId = useBackgroundStore((s) => s.backgroundId);
  const customImage = useBackgroundStore((s) => s.customImage);
  const shellStyle = { '--app-bg-image': resolveBackgroundImage(backgroundId, customImage) } as CSSProperties;
  const [kpiSearchText, setKpiSearchText] = useState('');
  const logout = useAuthStore((state) => state.logout);
  const screens = useBreakpoint();
  const isDesktop = !!screens.lg;
  const meta = pageMeta[location.pathname] || { title: 'PhuSocial', description: 'Nền tảng quản lý nội dung' };

  const { data: connections = [] } = useQuery({
    queryKey: ['socialAccounts'],
    queryFn: async () => (await api.get('/connections')).data as SocialAccountLite[],
  });
  // Lọc các Fanpage bị hết hạn cookie: nếu 1 page được quản lý bởi nhiều Via, chỉ coi là hết hạn nếu TẤT CẢ các Via quản lý page đó đều hết hạn!
  const pageIdsWithActiveCookie = useMemo(() => new Set(
    connections
      .filter((c) => c.platform !== 'FACEBOOK_GROUP' && c.tokenStatus === 'OK')
      .map((c) => c.platformAccountId || c.pageName)
      .filter(Boolean)
  ), [connections]);

  const expiredCookieAccounts = useMemo(() => {
    const map = new Map<string, SocialAccountLite>();
    for (const c of connections) {
      if (c.platform === 'FACEBOOK_GROUP') continue;
      const key = c.platformAccountId || c.pageName;
      if (!key) continue;
      // Nếu page này đã có ít nhất 1 via khác đang hoạt động tốt (OK), thì không tính là expired
      if (pageIdsWithActiveCookie.has(key)) continue;
      if (c.accountType === 'PERSONAL_COOKIE' && c.tokenStatus === 'EXPIRED' && !map.has(key)) {
        map.set(key, c);
      }
    }
    return Array.from(map.values());
  }, [connections, pageIdsWithActiveCookie]);
  const expiredCookieCount = expiredCookieAccounts.length;

  // Global KPI fetch — dùng cho floating button mọi trang
  const todayDate = dayjs().format('YYYY-MM-DD');
  const { data: todayTargets = [] } = useQuery({
    queryKey: ['postTargets', 'today', todayDate],
    queryFn: async () => (await api.get('/post-targets', { params: { from: todayDate, to: todayDate } })).data?.items as PostTargetItem[] || [],
    refetchInterval: 60000,
  });
  const activeTodayTargets = useMemo(() => todayTargets.filter((t) => t.targetCount > 0), [todayTargets]);
  const unmetKpiCount = activeTodayTargets.filter((t) => !t.achieved).length;
  const totalKpiCount = activeTodayTargets.length;

  // Gộp tất cả các Group & Fanpage/Profile đang có trong hệ thống
  const allDisplayTargets = useMemo(() => {
    const list: PostTargetItem[] = [...todayTargets];
    const existingAccountIds = new Set(list.map((t) => t.socialAccountId));

    connections.forEach((c) => {
      if (!existingAccountIds.has(c.id)) {
        list.push({
          socialAccountId: c.id,
          accountName: c.pageName || c.platformAccountId || `Kênh ${c.id}`,
          platform: c.platform || (c.accountType === 'PERSONAL_COOKIE' ? 'PERSONAL_COOKIE' : 'FACEBOOK_PAGE'),
          platformAccountId: c.platformAccountId,
          targetCount: 0,
          actualCount: 0,
          pendingCount: 0,
          totalPending: 0,
          achieved: false,
        });
      }
    });

    return list.sort((a, b) => {
      const aHasKpi = a.targetCount > 0;
      const bHasKpi = b.targetCount > 0;
      const aUnmet = aHasKpi && !a.achieved;
      const bUnmet = bHasKpi && !b.achieved;
      if (aUnmet && !bUnmet) return -1;
      if (!aUnmet && bUnmet) return 1;
      if (aHasKpi && !bHasKpi) return -1;
      if (!aHasKpi && bHasKpi) return 1;
      const aTotal = a.actualCount + (a.totalPending || 0);
      const bTotal = b.actualCount + (b.totalPending || 0);
      if (bTotal !== aTotal) return bTotal - aTotal;
      return a.accountName.localeCompare(b.accountName, 'vi');
    });
  }, [todayTargets, connections]);

  const filteredDisplayTargets = useMemo(() => {
    if (!kpiSearchText.trim()) return allDisplayTargets;
    const q = kpiSearchText.trim().toLowerCase();
    return allDisplayTargets.filter(
      (t) =>
        t.accountName.toLowerCase().includes(q) ||
        (t.platformAccountId && t.platformAccountId.toLowerCase().includes(q))
    );
  }, [allDisplayTargets, kpiSearchText]);

  const handleQuickFillTarget = (target: PostTargetItem) => {
    const account = connections.find((c) => c.id === target.socialAccountId || (target.platformAccountId && c.platformAccountId === target.platformAccountId));
    const platformAccountId = target.platformAccountId || account?.platformAccountId || String(target.socialAccountId || '');
    const isGroup = target.platform === 'FACEBOOK_GROUP' || target.platform?.includes('GROUP');
    const remaining = Math.max(0, target.targetCount - target.actualCount);

    setKpiPanelOpen(false);
    const params = new URLSearchParams({
      ...(isGroup ? { targetGroupId: platformAccountId } : { targetFanpageId: platformAccountId }),
      mode: isGroup ? 'GROUP_ONLY' : 'FANPAGE_ONLY',
      missing: String(remaining),
      groupName: target.accountName || account?.pageName || '',
      openBulk: '1',
      _t: String(Date.now()),
    });
    navigate(`/dashboard/playwright?${params.toString()}`);
  };

  // Bản Desktop: hiện người đang đăng nhập (bản web giữ tên quản trị cũ)
  const { data: desktopMe } = useQuery({
    queryKey: ['desktopMe'],
    queryFn: async () => (await api.get<{ displayName: string; login: string }>('/desktop/me')).data,
    enabled: isTauri(),
    staleTime: 60_000,
  });
  const profileName = isTauri() ? desktopMe?.displayName || desktopMe?.login || '' : 'Phú Admin';
  const profileInitials = profileName.split(/\s+/).filter(Boolean).slice(-2).map((w) => w[0]).join('').toUpperCase() || 'U';

  // Menu tài khoản: danh sách phẳng (không vòng sáng blur — WebKit của app desktop vẽ thành cục xanh đè avatar)
  const closeMenuThen = (fn: () => void) => () => {
    setProfileDropdownOpen(false);
    fn();
  };
  const renderUserDropdownCard = () => (
    <div className="udm">
      <div className="udm-head">
        <span className="udm-avatar">{profileInitials}</span>
        <div className="udm-who">
          <div className="udm-name">{profileName}</div>
          <div className="udm-role">{isTauri() ? 'Bản quyền Desktop' : 'Quản trị viên'}</div>
        </div>
      </div>

      <div className="udm-list">
        {!isTauri() && (
          <button type="button" className="udm-item" onClick={closeMenuThen(() => navigate('/'))}>
            <DashboardOutlined /> Trang chủ
          </button>
        )}
        <button type="button" className="udm-item" onClick={closeMenuThen(() => setBgPickerOpen(true))}>
          <BgColorsOutlined /> Hình nền
        </button>
        <button type="button" className="udm-item" onClick={closeMenuThen(() => setAiModalOpen(true))}>
          <RobotOutlined /> Cấu hình AI (Gemini)
        </button>
        <button type="button" className="udm-item" onClick={closeMenuThen(() => navigate('/dashboard/logs'))}>
          <CodeOutlined /> Nhật ký hệ thống
        </button>
      </div>

      <div className="udm-list udm-list-last">
        <button
          type="button"
          className="udm-item udm-item-danger"
          onClick={closeMenuThen(() => {
            logout();
            navigate('/login');
          })}
        >
          <LogoutOutlined /> Đăng xuất
        </button>
      </div>

      <AppVersion className="udm-version" />
    </div>
  );

  const kpiPanelContent = (
    <div style={{ width: 480, maxWidth: '90vw' }}>
      <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 text-base shadow-sm">
            <AimOutlined />
          </div>
          <div>
            <div className="text-[15px] font-black text-slate-100 tracking-tight">Mục tiêu KPI & Danh sách Nhóm</div>
            <div className="text-[13px] text-slate-300 font-medium">{dayjs().format('dddd, DD/MM/YYYY')} · {allDisplayTargets.length} kênh/nhóm</div>
          </div>
        </div>
        <span className={`text-[13px] font-bold px-3 py-1 rounded-full border shrink-0 whitespace-nowrap ${unmetKpiCount === 0 && totalKpiCount > 0
            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
            : 'bg-slate-800 text-slate-200 border-slate-700'
          }`}>
          {totalKpiCount === 0
            ? `${allDisplayTargets.length} Kênh/Nhóm`
            : unmetKpiCount === 0
              ? '✓ Đạt tất cả KPI'
              : `Còn ${unmetKpiCount} mục tiêu chưa đạt`}
        </span>
      </div>

      <div className="mb-3">
        <Input
          size="middle"
          prefix={<SearchOutlined className="text-slate-300 text-sm" />}
          placeholder="Tìm tên nhóm hoặc ID..."
          value={kpiSearchText}
          onChange={(e) => setKpiSearchText(e.target.value)}
          allowClear
          className="rounded-xl bg-slate-900 border-slate-700/80 text-slate-100 text-sm"
        />
      </div>

      {filteredDisplayTargets.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">🔍</div>
          <div className="text-sm text-slate-300 font-medium">Không tìm thấy nhóm / kênh nào phù hợp.</div>
        </div>
      ) : (
        <div className="space-y-2.5" style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 2 }}>
          {filteredDisplayTargets.map((t) => {
            const hasKpi = t.targetCount > 0;
            const actual = t.actualCount;
            const pendingToday = t.pendingCount || 0;
            const totalQueue = t.totalPending !== undefined ? t.totalPending : pendingToday;
            const totalPlanned = actual + totalQueue;
            const isFullyPublished = hasKpi && (t.achieved || actual >= t.targetCount);
            const isFullyScheduled = hasKpi && !isFullyPublished && totalPlanned >= t.targetCount;
            const remainingToSchedule = hasKpi ? Math.max(0, t.targetCount - totalPlanned) : 0;

            const scheduledPct = hasKpi
              ? (isFullyPublished ? 100 : isFullyScheduled ? 100 : Math.min(100, Math.round((totalPlanned / t.targetCount) * 100)))
              : (totalPlanned > 0 ? 100 : 0);

            return (
              <div
                key={t.socialAccountId}
                onClick={() => handleQuickFillTarget(t)}
                className="p-3.5 rounded-2xl border border-slate-800 bg-[#161f30] hover:border-slate-600 hover:bg-[#1b263b] transition-all cursor-pointer select-none group shadow-sm"
              >
                {/* Header: Avatar/Icon + Name + ID + Progress Ratio */}
                <div className="flex items-center justify-between gap-2.5 mb-2.5">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700/70 flex items-center justify-center shrink-0">
                      {t.platform === 'FACEBOOK_GROUP'
                        ? <TeamOutlined className="text-cyan-400 text-sm" />
                        : <FacebookFilled className="text-blue-400 text-sm" />}
                    </span>
                    <span className="text-sm font-bold text-slate-100 truncate group-hover:text-white transition-colors" title={t.accountName}>
                      {t.accountName}
                    </span>
                    {t.platformAccountId && (
                      <span className="text-xs text-slate-300 font-mono px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 shrink-0">
                        {t.platformAccountId.slice(-4)}
                      </span>
                    )}
                  </div>
                  <div className="shrink-0">
                    {hasKpi ? (
                      isFullyPublished ? (
                        <span className="text-[13px] font-mono font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 rounded-lg">
                          {actual}/{t.targetCount} ✓
                        </span>
                      ) : isFullyScheduled ? (
                        <span className="text-[13px] font-mono font-bold text-cyan-200 bg-cyan-500/10 border border-cyan-500/25 px-2.5 py-1 rounded-lg">
                          {actual}/{t.targetCount} <span className="text-xs text-cyan-300 font-normal">(+{totalQueue})</span>
                        </span>
                      ) : (
                        <span className="text-[13px] font-mono font-bold text-slate-200 bg-slate-800 border border-slate-700 px-2.5 py-1 rounded-lg">
                          {actual}/{t.targetCount} {totalQueue > 0 && <span className="text-cyan-300 text-xs font-normal">(+{totalQueue})</span>}
                        </span>
                      )
                    ) : (
                      <span className="text-[13px] font-mono font-bold text-slate-300 bg-slate-800/80 border border-slate-700/60 px-2.5 py-1 rounded-lg">
                        {actual} đã đăng {totalQueue > 0 && <span className="text-cyan-300 text-xs font-normal">(+{totalQueue})</span>}
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <Progress
                  percent={scheduledPct}
                  size={[undefined, 5]}
                  strokeColor={
                    !hasKpi
                      ? (totalPlanned > 0 ? '#38bdf8' : '#475569')
                      : isFullyPublished
                        ? '#22c55e'
                        : isFullyScheduled
                          ? '#a855f7'
                          : scheduledPct >= 70
                            ? '#f59e0b'
                            : '#64748b'
                  }
                  railColor="rgba(255,255,255,0.06)"
                  showInfo={false}
                  className="!mb-2.5"
                />

                {/* Footer: Stat Badges (Left) & Action Button (Right) */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Badge đã đăng */}
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                      ✓ {actual} đã đăng
                    </span>

                    {/* Badge chờ đăng */}
                    {totalQueue > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-200 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-md">
                        ⏳ {totalQueue} chờ đăng
                      </span>
                    )}

                    {/* Badge thiếu bài / Đủ KPI / Chưa đặt KPI */}
                    {hasKpi ? (
                      isFullyPublished ? (
                        <span className="inline-flex items-center text-xs font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-md">
                          Hoàn thành
                        </span>
                      ) : isFullyScheduled ? (
                        <span className="inline-flex items-center text-xs font-semibold text-cyan-200 bg-cyan-500/10 border border-cyan-500/25 px-2 py-0.5 rounded-md">
                          Đủ 100% KPI
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-xs font-semibold text-slate-300 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-md">
                          Thiếu {remainingToSchedule} bài
                        </span>
                      )
                    ) : (
                      <span className="inline-flex items-center text-xs font-semibold text-slate-300 bg-slate-800/80 border border-slate-700/60 px-2 py-0.5 rounded-md">
                        Chưa đặt KPI
                      </span>
                    )}
                  </div>

                  <Button
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleQuickFillTarget(t);
                    }}
                    className={`!text-xs !h-7 !px-3 rounded-lg font-bold shrink-0 whitespace-nowrap transition-all ${hasKpi && isFullyPublished
                        ? '!border-slate-700 !text-slate-300 !bg-slate-800 hover:!text-white'
                        : hasKpi && isFullyScheduled
                          ? '!border-cyan-500/30 !text-cyan-200 !bg-cyan-950/40 hover:!bg-cyan-900/60'
                          : '!border-none !bg-gradient-to-r !from-sky-500 !to-blue-600 !text-white hover:opacity-90'
                      }`}
                  >
                    {hasKpi
                      ? (isFullyPublished
                        ? '+ Thêm bài'
                        : isFullyScheduled
                          ? '✓ Đã đủ lịch'
                          : `Lên ${remainingToSchedule} bài`)
                      : 'Lên bài'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const sidebar = (
    <Flex vertical className="app-sidebar-shell">
      <Flex
        align="center"
        justify={collapsed && isDesktop ? 'center' : undefined}
        className={`app-sidebar-brand app-sidebar-brand-box ${collapsed && isDesktop ? '' : 'app-sidebar-brand-pad'}`}
      >
        <BrandLogo compact={collapsed && isDesktop} light to="/" />
      </Flex>

      <div className="app-sidebar-scroll">
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={navigation}
          inlineCollapsed={collapsed && isDesktop}
          onClick={({ key }) => {
            if (key === 'ai-settings') {
              setAiModalOpen(true);
              setMobileOpen(false);
              return;
            }
            navigate(key);
            setMobileOpen(false);
          }}
          className="app-main-menu app-main-menu-text"
        />
      </div>
      <AppVersion compact={collapsed && isDesktop} className="app-sidebar-version" />
    </Flex>
  );

  return (
    <Layout className="dashboard-shell app-shell-min" style={shellStyle}>
      {isDesktop ? (
        <Sider trigger={null} collapsible collapsed={collapsed} theme="dark" width={284} collapsedWidth={80} className="app-sidebar app-sidebar-sticky">
          {sidebar}
        </Sider>
      ) : (
        <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} placement="left" size={284} closable={false}>{sidebar}</Drawer>
      )}

      <Layout className="app-main-column">
        <Header className="app-topbar app-topbar-bar overflow-hidden" style={{ lineHeight: 'normal', height: 74 }}>
          <Flex align="center" className="min-w-0 flex-1 pr-2 sm:pr-4">
            <Button
              type="text"
              icon={isDesktop ? (collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />) : <MenuUnfoldOutlined />}
              onClick={() => isDesktop ? setCollapsed(!collapsed) : setMobileOpen(true)}
              aria-label="Mở menu"
              className="!text-slate-200 hover:!text-white hover:!bg-white/10 !mr-2 sm:!mr-3 !rounded-xl !w-10 !h-10 !flex !items-center !justify-center !border !border-white/10 transition-all shrink-0"
            />
            <div className="app-topbar-heading min-w-0 flex-1">
              <h1 className="app-topbar-title !text-base sm:!text-xl !font-extrabold !text-white !tracking-tight !m-0 truncate">{meta.title}</h1>
              {meta.description && <p className="app-topbar-desc !text-[13px] !text-slate-300 !mt-0.5 !m-0 !font-medium truncate max-w-xs md:max-w-sm lg:max-w-md xl:max-w-xl hidden sm:block">{meta.description}</p>}
            </div>
          </Flex>

          <Flex align="center" gap={10} className="app-topbar-actions shrink-0">
            <SystemEngineBadge />
            <QueueFinishBadge />
            <Tooltip title={expiredCookieCount > 0 ? `${expiredCookieCount} Fanpage có Cookie hết hạn — Bấm để cập nhật ngay` : 'Không có cảnh báo'}>
              <Badge count={expiredCookieCount} size="small" offset={[-2, 2]}>
                <button
                  type="button"
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer border shrink-0 ${
                    expiredCookieCount > 0
                      ? 'bg-rose-500/15 text-rose-300 border-rose-500/35 shadow-lg shadow-rose-500/25 animate-pulse'
                      : 'bg-white/6 text-slate-200 hover:text-white hover:bg-white/10 border-white/10'
                  }`}
                  onClick={() => {
                    if (expiredCookieCount > 0) {
                      setQuickCookieTargetId(expiredCookieAccounts[0]?.id);
                      setQuickCookieModalOpen(true);
                    } else {
                      navigate('/dashboard/connections');
                    }
                  }}
                  aria-label="Cảnh báo"
                >
                  <BellOutlined className="text-base" />
                </button>
              </Badge>
            </Tooltip>
            <Dropdown
              popupRender={renderUserDropdownCard}
              placement="bottomRight"
              trigger={['click']}
              open={profileDropdownOpen}
              onOpenChange={setProfileDropdownOpen}
            >
              <button
                type="button"
                className="h-10 flex items-center gap-2 sm:gap-2.5 px-2.5 sm:px-3 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 hover:border-slate-600 transition-all cursor-pointer group select-none shrink-0 whitespace-nowrap shadow-sm"
              >
                <div className="relative shrink-0">
                  <div className="topbar-avatar">
                    {profileInitials}
                  </div>
                  <span className="topbar-avatar-dot" aria-hidden="true" />
                </div>
                <div className="hidden sm:flex flex-col text-left whitespace-nowrap leading-tight">
                  <span className="font-bold text-[13px] text-slate-100 group-hover:text-white transition-colors">
                    {profileName}
                  </span>
                </div>
                <DownOutlined className="hidden sm:inline-block text-[10px] text-slate-400 group-hover:text-slate-200 transition-transform ml-0.5 shrink-0" />
              </button>
            </Dropdown>
          </Flex>
        </Header>

        {/* Global Warning Banner for Expired Cookies (Chỉ cảnh báo Fanpage, không tính Group) */}
        {expiredCookieCount > 0 && !dismissCookieBanner && (
          <Flex wrap align="center" justify="space-between" gap={8} className="cookie-banner">
            <Flex align="center" gap={8} className="cookie-banner-text">
              <span className="cookie-banner-dot">
                <span className="cookie-banner-dot-ping"></span>
                <span className="cookie-banner-dot-core"></span>
              </span>
              <span className="cookie-banner-title">CẢNH BÁO COOKIE:</span>
              <span className="cookie-banner-list">
                Có <b>{expiredCookieCount}</b> Fanpage bị hết hạn Cookie ({expiredCookieAccounts.slice(0, 3).map(a => a.pageName || a.platformAccountId).join(', ')}{expiredCookieCount > 3 ? ` và ${expiredCookieCount - 3} trang khác` : ''})!
              </span>
            </Flex>
            <Flex align="center" gap={8} className="cookie-banner-actions">
              <Button
                type="primary"
                size="small"
                icon={<ThunderboltFilled />}
                onClick={() => {
                  setQuickCookieTargetId(expiredCookieAccounts[0]?.id);
                  setQuickCookieModalOpen(true);
                }}
                className="cookie-banner-update"
              >
                Cập Nhật Cookie Ngay
              </Button>
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined className="cookie-banner-close-icon" />}
                onClick={() => {
                  setDismissCookieBanner(true);
                  sessionStorage.setItem('dismiss_cookie_banner', '1');
                }}
                className="cookie-banner-close"
                title="Đóng cảnh báo này"
              />
            </Flex>
          </Flex>
        )}

        <Content className="dashboard-content app-content-box">
          <Outlet />
        </Content>

        <QuickUpdateCookieModal
          open={quickCookieModalOpen}
          onClose={() => setQuickCookieModalOpen(false)}
          targetAccountId={quickCookieTargetId}
        />

        <AiSettingsModal
          open={aiModalOpen}
          onClose={() => setAiModalOpen(false)}
        />
        <BackgroundPicker open={bgPickerOpen} onClose={() => setBgPickerOpen(false)} />
      </Layout>

      {/* Mobile Bottom Navigation Bar */}
      <Flex align="center" justify="space-around" className="mobile-bottom-nav mobile-bottom-nav-bar">
        {[
          { path: '/dashboard', icon: <DashboardOutlined />, label: 'Tổng quan' },
          { path: '/dashboard/playwright', icon: <PlayCircleOutlined />, label: 'Đăng bài' },
          { path: '/dashboard/news-studio', icon: <PictureOutlined />, label: 'Ảnh tin' },
          { path: '/dashboard/viral-hunter', icon: <FireOutlined />, label: 'Viral' },
          { path: '/dashboard/connections', icon: <FacebookFilled />, label: 'Fanpage' },
        ].map(({ path, icon, label }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className={`mobile-bottom-nav-item ${location.pathname === path ? 'is-active' : ''}`}
          >
            <span className="mobile-bottom-nav-icon">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </Flex>
    </Layout>
  );
};

export default DashboardLayout;
