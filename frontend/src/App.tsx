import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, App as AntdApp, Spin, theme as antdTheme } from 'antd';
import viVN from 'antd/locale/vi_VN';
import DashboardLayout from './components/layout/DashboardLayout';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Home = lazy(() => import('./pages/Home'));
const About = lazy(() => import('./pages/About'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ThreadsStudio = lazy(() => import('./pages/ThreadsStudio'));
const Connections = lazy(() => import('./pages/Connections'));
const PostQueueView = lazy(() => import('./pages/PostQueueView'));
const ContentCalendar = lazy(() => import('./pages/ContentCalendar'));
const DownloadVideo = lazy(() => import('./pages/DownloadVideo'));
const VideoLibrary = lazy(() => import('./pages/VideoLibrary'));
const PostStory = lazy(() => import('./pages/PostStory'));
const PlaywrightPoster = lazy(() => import('./pages/PlaywrightPoster'));
const NewsCardStudio = lazy(() => import('./pages/NewsCardStudio'));
const VideoNewsStudio = lazy(() => import('./pages/VideoNewsStudio'));
const BuffEngagement = lazy(() => import('./pages/BuffEngagement'));
const SystemLogs = lazy(() => import('./pages/SystemLogs'));
const NewsRadar = lazy(() => import('./pages/NewsRadar'));
const EconomyJob = lazy(() => import('./pages/EconomyJob'));
const ViralHunter = lazy(() => import('./pages/ViralHunter'));

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
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          colorBgBase: '#080d16',
          colorBgLayout: '#080d16',
          colorBgContainer: 'rgba(12, 24, 44, 0.55)',
          colorBgElevated: '#172232',
          colorBorder: '#2b3a50',
          colorBorderSecondary: '#202d3f',
          colorTextHeading: '#f3f6fb',
          colorText: '#d9e1ec',
          colorTextSecondary: '#93a2b8',
          boxShadowSecondary: '0 20px 55px rgba(0, 0, 0, 0.42)',
        },
        components: {
          Button: {
            fontWeight: 600,
            borderRadius: 8,
            controlHeightLG: 44,
            primaryShadow: '0 4px 12px rgba(37, 99, 235, 0.18)',
          },
          Card: {
            borderRadiusLG: 14,
            boxShadowTertiary: '0 1px 2px rgba(15, 23, 42, 0.04)',
          },
          Table: {
            borderRadius: 10,
            headerBg: 'rgba(255, 255, 255, 0.05)',
            headerColor: '#d0d9e6',
            headerSplitColor: 'transparent',
            rowHoverBg: 'rgba(255, 255, 255, 0.06)',
            cellPaddingBlock: 14,
            cellPaddingInline: 16,
          },
          Tag: {
            borderRadius: 6,
          },
          Menu: {
            itemBorderRadius: 9,
            itemHeight: 42,
            itemMarginInline: 8,
            darkItemBg: 'transparent',
            darkItemSelectedBg: 'rgba(255, 255, 255, 0.16)',
            darkItemSelectedColor: '#ffffff',
          },
          Tabs: {
            itemSelectedColor: '#2563eb',
            inkBarColor: '#2563eb',
          },
          Segmented: {
            itemSelectedBg: '#293752',
          }
        }
      }}
    >
      <AntdApp>
        <Suspense fallback={<div className="min-h-screen grid place-items-center bg-[#080d16]"><Spin size="large" /></div>}>
          <BrowserRouter>
            <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/download-video" element={<Navigate to="/dashboard/download-video" replace />} />
            
            <Route path="/dashboard" element={<DashboardLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="economy-job" element={<Navigate to="/dashboard/playwright" replace />} />
              <Route path="connections" element={<Connections />} />
              <Route path="groups" element={<Navigate to="/dashboard/connections?tab=groups" replace />} />
              <Route path="campaigns" element={<Navigate to="/dashboard" replace />} />
              <Route path="queue" element={<Navigate to="/dashboard/playwright" replace />} />
              <Route path="calendar" element={<Navigate to="/dashboard/playwright" replace />} />
              <Route path="playwright" element={<PlaywrightPoster />} />
              <Route path="download-video" element={<DownloadVideo />} />
              <Route path="video-library" element={<VideoLibrary />} />
              <Route path="post-story" element={<PostStory />} />
              <Route path="threads" element={<ThreadsStudio />} />
              <Route path="buff" element={<BuffEngagement />} />
              <Route path="news-radar" element={<Navigate to="/dashboard/playwright" replace />} />
              <Route path="news-studio" element={<NewsCardStudio />} />
              <Route path="video-studio" element={<VideoNewsStudio />} />
              <Route path="viral-hunter" element={<ViralHunter />} />
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
