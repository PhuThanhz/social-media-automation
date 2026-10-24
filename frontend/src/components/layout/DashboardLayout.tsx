import { useMemo, useState, type CSSProperties } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Layout, Menu, Button, Avatar, Dropdown, Badge, Drawer, Grid, Tooltip,
  Progress, Popover, Input,
} from 'antd';
import {
  MenuFoldOutlined, MenuUnfoldOutlined, DashboardOutlined,
  ClockCircleOutlined, DownloadOutlined, BellOutlined,
  UserOutlined, LogoutOutlined, ThunderboltFilled,
  TeamOutlined, VideoCameraOutlined, PlayCircleOutlined, PictureOutlined,
  FacebookFilled, QuestionCircleOutlined, CalendarOutlined, BankOutlined,
  CodeOutlined, AimOutlined, LikeOutlined, FireOutlined, SearchOutlined, RadarChartOutlined,
  RobotOutlined, BgColorsOutlined, CloseOutlined,
} from '@ant-design/icons';
import api from '../../config/axios';
import dayjs from 'dayjs';
import BrandLogo from '../BrandLogo';
import { useAuthStore } from '../../store/authStore';
import { resolveBackgroundImage, useBackgroundStore } from '../../store/backgroundStore';
import BackgroundPicker from './BackgroundPicker';
import QueueFinishBadge from './QueueFinishBadge';

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
      { key: '/dashboard/video-studio', icon: <VideoCameraOutlined />, label: 'Studio Video Tin' },
      { key: '/dashboard/viral-hunter', icon: <FireOutlined className="text-amber-400" />, label: 'Săn bài Viral' },
      { key: '/dashboard/playwright', icon: <PlayCircleOutlined />, label: 'Đăng tự động' },
      { key: '/dashboard/post-story', icon: <PictureOutlined />, label: 'Đăng story' },
      { key: '/dashboard/threads', icon: <span className="font-black">@</span>, label: 'Đăng Threads' },
    ]
  },
  {
    type: 'group' as const, label: 'KÊNH & TÀI NGUYÊN', children: [
      { key: '/dashboard/connections', icon: <FacebookFilled />, label: 'Quản lý kết nối' },
      { key: '/dashboard/buff', icon: <LikeOutlined />, label: 'Tăng tương tác' },
      { key: '/dashboard/download-video', icon: <DownloadOutlined />, label: 'Tải video' },
      { key: '/dashboard/video-library', icon: <VideoCameraOutlined />, label: 'Thư viện video' },
    ]
  },
  {
    type: 'group' as const, label: 'HỆ THỐNG', children: [
      { key: 'ai-settings', icon: <RobotOutlined className="text-cyan-400 font-bold" />, label: 'Cấu hình AI (Gemini)' },
      { key: '/dashboard/logs', icon: <CodeOutlined />, label: 'Nhật ký hệ thống' },
    ]
  },
];

const pageMeta: Record<string, { title: string; description: string }> = {
  '/dashboard': { title: 'Tổng quan', description: 'Theo dõi hoạt động đăng bài và tình trạng hệ thống' },
  '/dashboard/news-studio': { title: 'Studio Ảnh Tin', description: 'Cào full bài báo, AI viết tiêu đề, ghép ảnh kiểu page tin tức rồi lên lịch đăng' },
  '/dashboard/video-studio': { title: 'Studio Video Tin', description: 'Dán link video, thêm khung tiêu đề + giọng AI đọc vài giây đầu, trộn nhạc nền rồi xuất hoặc lên lịch đăng' },
  '/dashboard/viral-hunter': { title: 'Săn Bài Viral (FB & Threads)', description: 'Cào bài Facebook Group & Threads theo từ khoá, lọc tương tác khủng và tích hợp Gemini AI viết lại' },
  '/dashboard/queue': { title: 'Quản lý bài đăng', description: 'Lập lịch, kiểm tra trạng thái và xử lý bài đăng' },
  '/dashboard/playwright': { title: 'Đăng tự động', description: 'Xuất bản nội dung trực tiếp bằng Playwright' },
  '/dashboard/buff': { title: 'Tăng tương tác', description: 'Like, bình luận bằng Fanpage, tăng view và tự săn bài mới vào hàng đợi' },
  '/dashboard/connections': { title: 'Quản lý kết nối', description: 'Quản lý tài khoản Via cá nhân, Cookie, Fanpage và Nhóm Facebook' },
  '/dashboard/download-video': { title: 'Tải video', description: 'Tải và xử lý video từ các nền tảng' },
  '/dashboard/video-library': { title: 'Thư viện video', description: 'Quản lý toàn bộ video đã tải về' },
  '/dashboard/post-story': { title: 'Đăng story', description: 'Tạo và đăng Facebook Story nhanh chóng' },
  '/dashboard/threads': { title: 'Đăng Threads', description: 'Đăng và hẹn giờ bài lên một hoặc nhiều nick Threads' },
  '/dashboard/logs': { title: 'Nhật ký hệ thống', description: 'Theo dõi Worker, Backend và Frontend theo thời gian thực' },
};

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

  const userMenuItems = useMemo(() => [
    { key: 'home', icon: <DashboardOutlined />, label: 'Trang chủ PhuSocial', onClick: () => navigate('/') },
    { key: 'profile', icon: <UserOutlined />, label: 'Phú Admin', disabled: true },
    { key: 'background', icon: <BgColorsOutlined />, label: 'Hình nền giao diện', onClick: () => setBgPickerOpen(true) },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Đăng xuất', danger: true, onClick: () => { logout(); navigate('/login'); } },
  ], [logout, navigate]);

  const kpiPanelContent = (
    <div style={{ width: 440 }}>
      <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-base shadow-md shadow-blue-600/30">
            🎯
          </div>
          <div>
            <div className="text-sm font-black text-slate-100 tracking-tight">Mục tiêu KPI & Danh sách Nhóm</div>
            <div className="text-[11px] text-slate-400 font-medium">{dayjs().format('dddd, DD/MM/YYYY')} · {allDisplayTargets.length} kênh/nhóm</div>
          </div>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${unmetKpiCount === 0 && totalKpiCount > 0
            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
            : 'bg-slate-800 text-slate-300 border-slate-700'
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
          size="small"
          prefix={<SearchOutlined className="text-slate-400 text-xs" />}
          placeholder="Tìm tên nhóm hoặc ID..."
          value={kpiSearchText}
          onChange={(e) => setKpiSearchText(e.target.value)}
          allowClear
          className="rounded-xl bg-slate-900 border-slate-700/80 text-slate-200 text-xs py-1.5"
        />
      </div>

      {filteredDisplayTargets.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">🔍</div>
          <div className="text-xs text-slate-400 font-medium">Không tìm thấy nhóm / kênh nào phù hợp.</div>
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
                    <span className="w-6 h-6 rounded-lg bg-slate-800 border border-slate-700/70 flex items-center justify-center shrink-0">
                      {t.platform === 'FACEBOOK_GROUP'
                        ? <TeamOutlined className="text-cyan-400 text-xs" />
                        : <FacebookFilled className="text-blue-400 text-xs" />}
                    </span>
                    <span className="text-xs font-bold text-slate-200 truncate group-hover:text-white transition-colors" title={t.accountName}>
                      {t.accountName}
                    </span>
                    {t.platformAccountId && (
                      <span className="text-[10px] text-slate-400 font-mono px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 shrink-0">
                        {t.platformAccountId.slice(-4)}
                      </span>
                    )}
                  </div>
                  <div className="shrink-0">
                    {hasKpi ? (
                      isFullyPublished ? (
                        <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 rounded-lg">
                          {actual}/{t.targetCount} ✓
                        </span>
                      ) : isFullyScheduled ? (
                        <span className="text-xs font-mono font-bold text-cyan-300 bg-cyan-500/10 border border-cyan-500/25 px-2.5 py-1 rounded-lg">
                          {actual}/{t.targetCount} <span className="text-[11px] text-cyan-400 font-normal">(+{totalQueue})</span>
                        </span>
                      ) : (
                        <span className="text-xs font-mono font-bold text-slate-300 bg-slate-800 border border-slate-700 px-2.5 py-1 rounded-lg">
                          {actual}/{t.targetCount} {totalQueue > 0 && <span className="text-cyan-300 text-[11px] font-normal">(+{totalQueue})</span>}
                        </span>
                      )
                    ) : (
                      <span className="text-xs font-mono font-bold text-slate-400 bg-slate-800/80 border border-slate-700/60 px-2.5 py-1 rounded-lg">
                        {actual} đã đăng {totalQueue > 0 && <span className="text-cyan-300 text-[11px] font-normal">(+{totalQueue})</span>}
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <Progress
                  percent={scheduledPct}
                  size={[undefined, 4]}
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
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                      ✓ {actual} đã đăng
                    </span>

                    {/* Badge chờ đăng */}
                    {totalQueue > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-md">
                        ⏳ {totalQueue} chờ đăng
                      </span>
                    )}

                    {/* Badge thiếu bài / Đủ KPI / Chưa đặt KPI */}
                    {hasKpi ? (
                      isFullyPublished ? (
                        <span className="inline-flex items-center text-[11px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-md">
                          Hoàn thành
                        </span>
                      ) : isFullyScheduled ? (
                        <span className="inline-flex items-center text-[11px] font-semibold text-cyan-200 bg-cyan-500/10 border border-cyan-500/25 px-2 py-0.5 rounded-md">
                          Đủ 100% KPI
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-[11px] font-semibold text-slate-400 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-md">
                          Thiếu {remainingToSchedule} bài
                        </span>
                      )
                    ) : (
                      <span className="inline-flex items-center text-[11px] font-semibold text-slate-400 bg-slate-800/80 border border-slate-700/60 px-2 py-0.5 rounded-md">
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
                    className={`!text-[11px] !h-6 !px-2.5 rounded-lg font-bold shrink-0 transition-all ${hasKpi && isFullyPublished
                        ? '!border-slate-700 !text-slate-400 !bg-slate-800 hover:!text-white'
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
                          : `⚡ Lên ${remainingToSchedule} bài`)
                      : '⚡ Lên bài'}
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
    <div className="app-sidebar-shell h-full flex flex-col min-h-0 overflow-hidden">
      <div className={`app-sidebar-brand h-20 flex items-center ${collapsed && isDesktop ? 'justify-center' : 'px-6'} shrink-0`}>
        <BrandLogo compact={collapsed && isDesktop} light to="/" hideMark />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
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
          className="app-main-menu border-none text-[13px] font-medium"
        />
      </div>
    </div>
  );

  return (
    <Layout className="dashboard-shell min-h-screen" style={shellStyle}>
      {isDesktop ? (
        <Sider trigger={null} collapsible collapsed={collapsed} theme="dark" width={252} collapsedWidth={80} className="app-sidebar sticky top-0 h-screen z-20">
          {sidebar}
        </Sider>
      ) : (
        <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} placement="left" size={256} closable={false}>{sidebar}</Drawer>
      )}

      <Layout className="min-w-0">
        <Header className="app-topbar px-4 md:px-6 flex items-center justify-between sticky top-0 z-10" style={{ lineHeight: 'normal', height: 72 }}>
          <div className="flex items-center min-w-0">
            <Button
              type="text"
              icon={isDesktop ? (collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />) : <MenuUnfoldOutlined />}
              onClick={() => isDesktop ? setCollapsed(!collapsed) : setMobileOpen(true)}
              aria-label="Mở menu"
            />
            <div className="ml-2 md:ml-3 min-w-0">
              <h1 className="text-sm md:text-base font-bold mb-0 truncate">{meta.title}</h1>
              <p className="hidden md:block text-[11px] mb-0 mt-0.5 truncate">{meta.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 md:gap-2">
            <QueueFinishBadge />
            <Button
              className="hidden sm:inline-flex"
              icon={<LikeOutlined />}
              onClick={() => navigate('/dashboard/buff')}
            >
              Tăng tương tác
            </Button>
            <Tooltip title={expiredCookieCount > 0 ? `${expiredCookieCount} Fanpage có Cookie hết hạn — Bấm để cập nhật ngay` : 'Không có cảnh báo'}>
              <Badge count={expiredCookieCount} size="small">
                <Button
                  type="text"
                  shape="circle"
                  icon={<BellOutlined className={expiredCookieCount > 0 ? 'text-red-500 font-bold' : ''} />}
                  onClick={() => {
                    if (expiredCookieCount > 0) {
                      setQuickCookieTargetId(expiredCookieAccounts[0]?.id);
                      setQuickCookieModalOpen(true);
                    } else {
                      navigate('/dashboard/connections');
                    }
                  }}
                  aria-label="Cảnh báo"
                />
              </Badge>
            </Tooltip>
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" trigger={['click']}>
              <Button type="text" className="h-10 px-1.5 md:px-2">
                <Avatar size={32} className="admin-avatar font-bold">PA</Avatar>
                <span className="hidden md:inline ml-2 text-xs font-semibold">Phú Admin</span>
              </Button>
            </Dropdown>
          </div>
        </Header>

        {/* Global Warning Banner for Expired Cookies (Chỉ cảnh báo Fanpage, không tính Group) */}
        {expiredCookieCount > 0 && !dismissCookieBanner && (
          <div className="bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shadow-sm sticky top-16 z-10 border-b border-red-700">
            <div className="flex items-center gap-2 text-xs md:text-sm font-medium min-w-0">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-300"></span>
              </span>
              <span className="font-bold">⚠️ CẢNH BÁO COOKIE:</span>
              <span className="truncate">
                Có <b>{expiredCookieCount}</b> Fanpage bị hết hạn Cookie ({expiredCookieAccounts.slice(0, 3).map(a => a.pageName || a.platformAccountId).join(', ')}{expiredCookieCount > 3 ? ` và ${expiredCookieCount - 3} trang khác` : ''})!
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="primary"
                size="small"
                icon={<ThunderboltFilled />}
                onClick={() => {
                  setQuickCookieTargetId(expiredCookieAccounts[0]?.id);
                  setQuickCookieModalOpen(true);
                }}
                className="bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-extrabold border-none shadow text-xs rounded-lg h-7 px-3 flex items-center"
              >
                ⚡ Cập Nhật Cookie Ngay
              </Button>
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined className="text-white hover:text-yellow-200 text-sm" />}
                onClick={() => {
                  setDismissCookieBanner(true);
                  sessionStorage.setItem('dismiss_cookie_banner', '1');
                }}
                className="hover:!bg-white/20 !text-white flex items-center justify-center h-7 w-7 !p-0 rounded-lg cursor-pointer"
                title="Đóng cảnh báo này"
              />
            </div>
          </div>
        )}

        <Content className="dashboard-content p-3 sm:p-5 md:p-7 xl:p-8 w-full max-w-[1600px] mx-auto pb-24 md:pb-8">
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
      <div className="mobile-bottom-nav md:hidden fixed bottom-0 left-0 right-0 z-50 px-1.5 py-1.5 flex items-center justify-around">
        {[
          { path: '/dashboard', icon: <DashboardOutlined />, label: 'Tổng quan' },
          { path: '/dashboard/playwright', icon: <PlayCircleOutlined />, label: 'Đăng bài' },
          { path: '/dashboard/buff', icon: <LikeOutlined />, label: 'Tăng tương tác' },
          { path: '/dashboard/download-video', icon: <DownloadOutlined />, label: 'Tải video' },
          { path: '/dashboard/connections', icon: <FacebookFilled />, label: 'Fanpage' },
        ].map(({ path, icon, label }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className={`flex flex-col items-center justify-center py-1 px-1.5 rounded-xl text-[10px] font-bold transition-all ${location.pathname === path ? 'is-active' : ''
              }`}
          >
            <span className="text-base mb-0.5">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </Layout>
  );
};

export default DashboardLayout;
