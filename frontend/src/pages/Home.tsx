import React from 'react';
import { Button } from 'antd';
import {
  ArrowRightOutlined,
  CalendarOutlined,
  FireOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import PublicLayout from '../components/layout/PublicLayout';

const capabilities = [
  {
    icon: <CalendarOutlined className="text-sky-400 text-lg" />,
    title: 'Lập lịch & Đăng tự động',
    desc: 'Hẹn giờ đăng bài, giãn cách an toàn.',
  },
  {
    icon: <RobotOutlined className="text-indigo-400 text-lg" />,
    title: 'Studio Ảnh & Video',
    desc: 'AI viết lại tiêu đề, ghép ảnh, dựng video.',
  },
  {
    icon: <FireOutlined className="text-amber-400 text-lg" />,
    title: 'Săn bài Viral',
    desc: 'Quét bài nổi bật từ Group, Fanpage, Threads.',
  },
  {
    icon: <SafetyCertificateOutlined className="text-emerald-400 text-lg" />,
    title: 'Dữ liệu trên máy bạn',
    desc: 'Cookie và dữ liệu lưu cục bộ, không qua máy chủ.',
  },
];

const HomeContent: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#060810] text-slate-100 relative overflow-hidden font-sans selection:bg-sky-500/30 selection:text-white">
      {/* HERO */}
      <section className="relative pt-24 pb-24 md:pt-32 md:pb-28 px-6 max-w-5xl mx-auto text-center z-10">
        <h1 className="home-hero-title text-white">
          Đăng bài đều đặn. <br />
          <span className="text-sky-400">Phát triển nhẹ nhàng.</span>
        </h1>

        <p className="mt-6 text-base sm:text-[17px] text-slate-300 leading-relaxed">
          Tự động đăng bài, săn bài viral — chạy ngay trên máy bạn.
        </p>

        <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to="/login" className="w-full sm:w-auto">
            <Button
              type="primary"
              size="large"
              iconPlacement="end"
              icon={<ArrowRightOutlined />}
              className="w-full sm:w-auto !h-12 !px-8 !rounded-full !font-bold !text-[15px] !bg-blue-600 hover:!bg-blue-500 !text-white !border-none cursor-pointer"
            >
              Vào Workspace
            </Button>
          </Link>

          <a href="#features" className="w-full sm:w-auto">
            <Button
              size="large"
              className="w-full sm:w-auto !h-12 !px-7 !rounded-full !bg-slate-800/80 hover:!bg-slate-700/80 !border-slate-700 hover:!border-slate-500 !text-slate-200 hover:!text-white !font-semibold !text-[14px] cursor-pointer"
            >
              Khám phá tính năng
            </Button>
          </a>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="py-20 px-6 max-w-5xl mx-auto relative z-10 border-t border-white/[0.06]">
        <h2 className="text-center text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-8">
          Mọi công cụ trong một ứng dụng
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {capabilities.map((item) => (
            <div
              key={item.title}
              className="p-6 rounded-2xl bg-[#0a0f1d]/60 border border-white/[0.07] hover:border-blue-500/30 transition-colors flex items-start gap-4"
            >
              <div className="w-11 h-11 shrink-0 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                {item.icon}
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white tracking-tight">{item.title}</h3>
                <p className="text-sm text-slate-300 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
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
