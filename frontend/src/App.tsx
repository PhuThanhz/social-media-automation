import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, App as AntdApp, Spin, theme as antdTheme } from 'antd';
import viVN from 'antd/locale/vi_VN';
import DashboardLayout from './components/layout/DashboardLayout';
import { LicenseGuardModal } from './components/LicenseGuardModal';
import { isTauri } from './services/license.service';
import { AutoUpdateModal } from './components/AutoUpdateModal';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Home = lazy(() => import('./pages/Home'));
const About = lazy(() => import('./pages/About'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Connections = lazy(() => import('./pages/Connections'));
const PostStory = lazy(() => import('./pages/PostStory'));
const PlaywrightPoster = lazy(() => import('./pages/PlaywrightPoster'));
const NewsCardStudio = lazy(() => import('./pages/NewsCardStudio'));
const VideoNewsStudio = lazy(() => import('./pages/VideoNewsStudio'));
const SystemLogs = lazy(() => import('./pages/SystemLogs'));
const ViralHunter = lazy(() => import('./pages/ViralHunter'));
const LicenseManager = lazy(() => import('./pages/LicenseManager'));
const DesktopUsers = lazy(() => import('./pages/DesktopUsers'));

// Kiểm tra lúc render route (không phải lúc App render) để đăng nhập xong vào được ngay
function RequireDesktopLogin({ children }: { children: React.ReactElement }) {
  if (isTauri() && !localStorage.getItem('access_token')) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <ConfigProvider
      locale={viVN}
      theme={{
        algorithm: antdTheme.darkAlgorithm,
        token: {
          colorPrimary: '#3b82f6',
          colorInfo: '#61a8ff',
          colorSuccess: '#39d497',
          colorWarning: '#f5bd54',
          colorError: '#ff7188',
          borderRadius: 12,
          controlHeight: 40,
          controlHeightSM: 32,
          controlHeightLG: 46,
          fontSize: 14,
          fontSizeSM: 13,
          fontSizeLG: 16,
          fontSizeXL: 20,
          fontSizeHeading1: 30,
          fontSizeHeading2: 24,
          fontSizeHeading3: 20,
          fontSizeHeading4: 18,
          fontSizeHeading5: 16,
          fontFamily: "'Be Vietnam Pro', 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontFamilyCode: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
          colorBgBase: '#080d16',
          colorBgLayout: '#080d16',
          colorBgContainer: 'rgba(13, 22, 38, 0.85)',
          colorBgElevated: '#172232',
          colorBorder: '#2b3a50',
          colorBorderSecondary: '#202d3f',
          colorTextHeading: '#ffffff',
          colorText: '#f1f5fb',
          colorTextSecondary: '#cbd5e1',
          colorTextTertiary: '#9fb1c9',
          colorTextPlaceholder: '#8da2be',
          boxShadowSecondary: '0 20px 55px rgba(0, 0, 0, 0.42)',
        },
        components: {
          Button: {
            fontWeight: 600,
            borderRadius: 10,
            contentFontSize: 14,
            contentFontSizeSM: 13,
            contentFontSizeLG: 15,
            controlHeightLG: 44,
            primaryShadow: '0 4px 12px rgba(37, 99, 235, 0.18)',
          },
          Card: {
            borderRadiusLG: 14,
            boxShadowTertiary: '0 1px 2px rgba(15, 23, 42, 0.04)',
          },
          Table: {
            borderRadius: 10,
            fontSize: 14,
            headerBg: 'rgba(255, 255, 255, 0.05)',
            headerColor: '#dbe5f2',
            headerSplitColor: 'transparent',
            rowHoverBg: 'rgba(255, 255, 255, 0.06)',
            cellPaddingBlock: 14,
            cellPaddingInline: 16,
          },
          Tag: {
            borderRadius: 7,
            fontSizeSM: 12.5,
          },
          Menu: {
            itemBorderRadius: 10,
            itemHeight: 44,
            itemMarginInline: 8,
            fontSize: 14,
            iconSize: 16,
            groupTitleFontSize: 12,
            darkItemBg: 'transparent',
            darkItemSelectedBg: 'rgba(255, 255, 255, 0.16)',
            darkItemSelectedColor: '#ffffff',
          },
          Tabs: {
            itemColor: '#cbd5e1',
            itemHoverColor: '#ffffff',
            itemSelectedColor: '#38bdf8',
            inkBarColor: '#38bdf8',
            titleFontSize: 14,
          },
          Segmented: {
            itemSelectedBg: '#293752',
          },
          Modal: {
            contentBg: '#0f172a',
            headerBg: '#0f172a',
            borderRadiusLG: 16,
            titleFontSize: 18,
          },
          Drawer: {
            colorBgElevated: '#0f172a',
          },
          Form: {
            labelFontSize: 13.5,
            labelColor: '#dbe5f2',
          },
          Input: {
            colorBgContainer: 'rgba(15, 23, 42, 0.7)',
            activeBorderColor: '#3b82f6',
            hoverBorderColor: '#60a5fa',
          },
          Select: {
            colorBgContainer: 'rgba(15, 23, 42, 0.7)',
            colorBgElevated: '#172232',
          },
          Alert: {
            borderRadiusLG: 14,
          },
          Statistic: {
            titleFontSize: 14,
            contentFontSize: 28,
          }
        }
      }}
    >
      <AntdApp>
        <Suspense fallback={<div className="min-h-screen grid place-items-center bg-[#080d16]"><Spin size="large" /></div>}>
          <LicenseGuardModal />
          <AutoUpdateModal />
          <BrowserRouter>
            <Routes>
            <Route
              path="/"
              element={
                (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window))
                  ? <Navigate to="/dashboard" replace />
                  : <Home />
              }
            />
            <Route path="/about" element={<About />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={isTauri() ? <Navigate to="/login" replace /> : <Register />} />
            <Route path="/download-video" element={<Navigate to="/dashboard" replace />} />
            
            {/* Bản Desktop bắt buộc đăng nhập (máy có thể dùng chung nhiều người) */}
            <Route path="/dashboard" element={<RequireDesktopLogin><DashboardLayout /></RequireDesktopLogin>}>
              <Route path="users" element={isTauri() ? <DesktopUsers /> : <Navigate to="/dashboard" replace />} />
              <Route index element={<Dashboard />} />
              <Route path="publishing-control-center" element={<Navigate to="/dashboard" replace />} />
              <Route path="economy-job" element={<Navigate to="/dashboard/playwright" replace />} />
              <Route path="connections" element={<Connections />} />
              <Route path="groups" element={<Navigate to="/dashboard/connections?tab=groups" replace />} />
              <Route path="campaigns" element={<Navigate to="/dashboard" replace />} />
              <Route path="queue" element={<Navigate to="/dashboard/playwright" replace />} />
              <Route path="calendar" element={<Navigate to="/dashboard/playwright" replace />} />
              <Route path="playwright" element={<PlaywrightPoster />} />
              <Route path="download-video" element={<Navigate to="/dashboard" replace />} />
              <Route path="video-library" element={<Navigate to="/dashboard" replace />} />
              <Route path="post-story" element={<PostStory />} />
              <Route path="threads" element={<Navigate to="/dashboard" replace />} />
              <Route path="buff" element={<Navigate to="/dashboard" replace />} />
              <Route path="news-radar" element={<Navigate to="/dashboard/playwright" replace />} />
              <Route path="news-studio" element={<NewsCardStudio />} />
              <Route path="video-studio" element={<VideoNewsStudio />} />
              <Route path="viral-hunter" element={<ViralHunter />} />
              <Route path="license" element={isTauri() ? <Navigate to="/dashboard" replace /> : <LicenseManager />} />
              <Route path="logs" element={<SystemLogs />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </Suspense>
      </AntdApp>
    </ConfigProvider>
  );
}

export default App;
