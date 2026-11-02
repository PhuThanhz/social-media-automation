import React from 'react';
import { Tag, Button } from 'antd';
import {
  ArrowRightOutlined,
  CalendarOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  FacebookFilled,
  FireOutlined,
  PlayCircleFilled,
  RobotOutlined,
  SafetyCertificateOutlined,
  ThunderboltFilled,
  VideoCameraFilled,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import PublicLayout from '../components/layout/PublicLayout';

const tools = [
  {
    icon: <CalendarOutlined className="text-blue-400 text-xl" />,
    badge: 'AUTOMATION',
    title: 'Lập lịch & Đăng tự động',
    desc: 'Hẹn giờ đăng bài thông minh, giãn cách an toàn chống checkpoint. Tự động hóa hoàn toàn với Playwright trên máy bạn.',
    meta: '0đ chi phí máy chủ',
  },
  {
    icon: <RobotOutlined className="text-indigo-400 text-xl" />,
    badge: 'AI ENGINE',
    title: 'Studio Ảnh & Video Tin',
    desc: 'Cào bài báo full text, AI tóm tắt, chọn ảnh và ghép khung tin tức chuẩn truyền thông. Tích hợp đọc giọng tự nhiên.',
    meta: 'Tiết kiệm 90% thời gian',
  },
  {
    icon: <FireOutlined className="text-amber-400 text-xl" />,
    badge: 'VIRAL RADAR',
    title: 'Săn bài Viral Triệu View',
    desc: 'Quét tự động bài viết tương tác khủng từ Fanpage đối thủ, Group Facebook và Threads. AI viết lại nội dung mới mẻ.',
    meta: 'Bắt trend tức thì',
  },
  {
    icon: <SafetyCertificateOutlined className="text-emerald-400 text-xl" />,
    badge: 'SECURITY',
    title: 'Bảo mật HWID & Khóa từ xa',
    desc: 'Bản quyền khóa cứng theo mã phần cứng máy tính (Hardware ID). Quản lý, cấp key và khóa tức thì chỉ với một cú nhấp.',
    meta: 'Chống crack tuyệt đối',
  },
];

const queueItems = [
  {
    time: '09:00',
    title: 'Mẹo chăm sóc thú cưng mùa lạnh',
    channel: 'Fanpage Chó Mèo',
    status: 'Đã đăng',
    type: 'done',
  },
  {
    time: '14:30',
    title: 'Unbox bộ sưu tập anime giới hạn',
    channel: 'Reels Facebook',
    status: 'Đang chạy',
    type: 'active',
    progress: 75,
  },
  {
    time: '19:00',
    title: 'Top 5 bài tập tăng tốc độ phản xạ',
    channel: 'Group Thể Thao VIP',
    status: 'Chờ đến giờ',
    type: 'pending',
  },
];

const HomeContent: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 relative overflow-hidden font-sans selection:bg-blue-500/30 selection:text-white">
      {/* Soft Ambient Glows - Elegant, Subtle & Non-intrusive */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-b from-blue-500/12 via-indigo-500/6 to-transparent blur-[140px] pointer-events-none rounded-full" />
      <div className="absolute top-[40%] right-[-100px] w-[500px] h-[500px] bg-blue-600/5 blur-[160px] pointer-events-none rounded-full" />

      {/* Subtle Blueprint Mesh */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

      {/* HERO SECTION */}
      <section className="relative pt-32 pb-24 md:pt-40 md:pb-32 px-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-14 items-center">
          
          {/* Left Column: Clean, Confident Typography */}
          <div className="lg:col-span-7 space-y-7 text-center lg:text-left z-10">
            {/* Bold, Clean Headline */}
            <h1 className="text-4xl sm:text-6xl lg:text-[64px] font-bold tracking-[-0.03em] leading-[1.1] text-white">
              Đăng bài đều đặn. <br />
              <span className="text-slate-400 font-light">Phát triển nhẹ nhàng.</span>
            </h1>

            {/* Restrained Subtitle */}
            <p className="text-base sm:text-lg text-slate-400 max-w-xl mx-auto lg:mx-0 font-normal leading-relaxed">
              Giải pháp tự động đăng bài, săn nội dung viral và quản lý đa kênh trực tiếp trên máy tính của bạn — không cần máy chủ, vận hành mượt mà với chi phí 0đ.
            </p>

            {/* Refined CTAs */}
            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3.5 pt-2">
              <Link to="/login" className="w-full sm:w-auto">
                <Button
                  type="primary"
                  size="large"
                  iconPosition="end"
                  icon={<ArrowRightOutlined />}
                  className="w-full sm:w-auto !h-12 !px-7 !rounded-xl !font-semibold !text-[14px] !bg-white !text-slate-950 !border-none shadow-[0_0_30px_rgba(255,255,255,0.2)] hover:!opacity-95 cursor-pointer"
                >
                  Vào Workspace
                </Button>
              </Link>

              <a href="#features" className="w-full sm:w-auto">
                <Button
                  size="large"
                  className="w-full sm:w-auto !h-12 !px-6 !rounded-xl !bg-white/[0.04] hover:!bg-white/[0.08] !border-white/[0.1] hover:!border-white/[0.2] !text-slate-300 !font-medium !text-[14px] backdrop-blur-sm cursor-pointer"
                >
                  Khám phá tính năng
                </Button>
              </a>
            </div>

            {/* Minimalist Micro Badges */}
            <div className="pt-2 flex flex-wrap items-center justify-center lg:justify-start gap-5 text-[12px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-slate-400" /> Chạy trực tiếp trên máy (Native)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-slate-400" /> 0đ chi phí máy chủ
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-slate-400" /> Bản quyền bảo mật HWID
              </span>
            </div>
          </div>

          {/* Right Column: Luxury macOS Workspace Preview Window */}
          <div className="lg:col-span-5 z-10">
            <div className="rounded-2xl bg-[#0b0e17]/90 border border-white/[0.08] backdrop-blur-xl shadow-[0_25px_70px_rgba(0,0,0,0.7)] overflow-hidden">
              
              {/* macOS Window Title Bar */}
              <div className="px-4 py-3 bg-white/[0.02] border-b border-white/[0.06] flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]/70" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]/70" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]/70" />
                </div>
                <span className="text-[11px] font-medium text-slate-400 tracking-wide">
                  PhuSocial Workspace
                </span>
                <span className="w-8" />
              </div>

              {/* Workspace Content */}
              <div className="p-5 space-y-4">
                
                {/* Stats Summary Strip */}
                <div className="grid grid-cols-3 gap-2 pb-3 border-b border-white/[0.06]">
                  <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Tài khoản</div>
                    <div className="text-sm font-semibold text-slate-200 mt-0.5">3 Kết nối</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Lên lịch</div>
                    <div className="text-sm font-semibold text-slate-200 mt-0.5">12 Bài</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Tỷ lệ đăng</div>
                    <div className="text-sm font-semibold text-emerald-400 mt-0.5">99.8%</div>
                  </div>
                </div>

                {/* Queue Card: Active Item */}
                <div className="space-y-2">
                  <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                    Hàng đợi xuất bản hôm nay
                  </div>

                  <div className="space-y-2 font-sans">
                    {queueItems.map((item) => (
                      <div
                        key={item.time}
                        className={`p-3 rounded-xl border transition-all ${
                          item.type === 'active'
                            ? 'bg-blue-500/[0.06] border-blue-500/20 shadow-sm'
                            : 'bg-white/[0.015] border-white/[0.04] hover:bg-white/[0.03]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-xs font-mono text-slate-400 w-10">
                              {item.time}
                            </span>
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-slate-200 truncate">
                                {item.title}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {item.channel}
                              </div>
                            </div>
                          </div>

                          <div className="shrink-0 ml-3">
                            {item.type === 'done' && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md font-medium">
                                <CheckOutlined className="text-[9px]" /> Đã đăng
                              </span>
                            )}
                            {item.type === 'active' && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" /> Đang chạy
                              </span>
                            )}
                            {item.type === 'pending' && (
                              <span className="text-[11px] text-slate-500 bg-white/[0.03] px-2 py-0.5 rounded-md font-medium">
                                Chờ
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Progress line for active job */}
                        {item.type === 'active' && (
                          <div className="mt-2.5 pt-2 border-t border-blue-500/10 flex items-center gap-2">
                            <div className="flex-1 bg-white/[0.06] h-1 rounded-full overflow-hidden">
                              <div className="bg-gradient-to-r from-blue-500 to-indigo-400 h-full w-[75%] rounded-full" />
                            </div>
                            <span className="text-[10px] font-mono text-blue-400 font-medium">75%</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Footer Status Bar */}
                <div className="pt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-white/[0.06]">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Playwright Worker Sẵn sàng
                  </span>
                  <span className="font-mono text-slate-500">v1.0.0</span>
                </div>

              </div>
            </div>
          </div>

        </div>
      </section>

      {/* FEATURES SECTION */}
      <section id="features" className="py-24 px-6 max-w-7xl mx-auto relative z-10 border-t border-white/[0.06]">
        <div className="text-center max-w-2xl mx-auto mb-16 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Tính Năng Cốt Lõi
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Mọi công cụ bạn cần. Gói gọn trong một ứng dụng.
          </h2>
          <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
            Tất cả tính năng được tối ưu cho hiệu suất làm việc nhanh, ổn định và độc lập trên máy của bạn.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {tools.map((tool) => (
            <div
              key={tool.title}
              className="p-7 rounded-2xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-200 group"
            >
              <div className="flex items-start justify-between mb-5">
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                  {tool.icon}
                </div>
                <span className="text-[11px] font-mono font-medium text-slate-400 bg-white/[0.03] px-2.5 py-1 rounded-md">
                  {tool.meta}
                </span>
              </div>

              <div className="space-y-2">
                <h3 className="text-base font-semibold text-white tracking-tight group-hover:text-blue-300 transition-colors">
                  {tool.title}
                </h3>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed font-normal">
                  {tool.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-12 border-t border-white/[0.06] text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            © {new Date().getFullYear()} PhuSocial. Tối giản, mạnh mẽ và độc lập.
          </div>
          <div className="flex items-center gap-6 text-slate-400">
            <Link to="/login" className="hover:text-white transition-colors">Đăng nhập</Link>
            <Link to="/about" className="hover:text-white transition-colors">Giới thiệu</Link>
            <a href="#features" className="hover:text-white transition-colors">Tính năng</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default function Home() {
  return (
    <PublicLayout>
      <HomeContent />
    </PublicLayout>
  );
}
