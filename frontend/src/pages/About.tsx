import React from 'react';
import { Button } from 'antd';
import {
  ArrowRightOutlined,
  CheckCircleFilled,
  CompassOutlined,
  HeartFilled,
  SafetyCertificateOutlined,
  TeamOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import PublicLayout from '../components/layout/PublicLayout';

const values = [
  {
    icon: <CompassOutlined className="text-blue-400 text-xl" />,
    title: 'Đơn giản là ưu tiên',
    text: 'Công nghệ chỉ thực sự có ý nghĩa khi giúp công việc dễ dàng hơn. Mọi giao diện đều được tính toán tối giản để người dùng biết ngay bước tiếp theo là gì.',
  },
  {
    icon: <SafetyCertificateOutlined className="text-emerald-400 text-xl" />,
    title: 'Minh bạch & Kiểm soát',
    text: 'Bạn luôn nắm rõ bài viết nào đang chờ, bài nào đã đăng thành công và điều gì cần xử lý — tuyệt đối không có bất kỳ quy trình ngầm bí ẩn nào.',
  },
  {
    icon: <HeartFilled className="text-pink-400 text-xl" />,
    title: 'Xây dựng cho người Việt',
    text: 'Giao diện thân thiện, giải pháp sát thực tế và hỗ trợ tối ưu đúng theo thói quen vận hành mạng xã hội tại thị trường Việt Nam.',
  },
];

const stats = [
  { value: '01', label: 'Không gian làm việc tập trung toàn diện' },
  { value: '24/7', label: 'Hàng đợi đăng bài tự động, đúng lịch hẹn' },
  { value: '100%', label: 'Dữ liệu cục bộ trên máy tính, bảo mật tuyệt đối' },
];

const About: React.FC = () => {
  return (
    <PublicLayout>
      <div className="min-h-screen bg-[#07090e] text-slate-100 relative overflow-hidden font-sans selection:bg-blue-500/30 selection:text-white">
        {/* Soft Ambient Glows */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[850px] h-[360px] bg-gradient-to-b from-blue-500/12 via-indigo-500/6 to-transparent blur-[140px] pointer-events-none rounded-full" />
        <div className="absolute top-[45%] right-[-120px] w-[500px] h-[500px] bg-blue-600/5 blur-[160px] pointer-events-none rounded-full" />
        
        {/* Subtle Blueprint Mesh Background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

        {/* HERO SECTION */}
        <section className="relative pt-24 pb-20 md:pt-32 md:pb-28 px-6 max-w-5xl mx-auto text-center z-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-[13px] font-semibold mb-6 tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            CÂU CHUYỆN PHUSOCIAL
          </div>

          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight leading-[1.15] text-white max-w-3xl mx-auto">
            Giúp đội ngũ sáng tạo <br />
            <span className="text-slate-300 font-light">lấy lại thời gian của mình.</span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-slate-300 max-w-2xl mx-auto font-normal leading-relaxed">
            Chúng tôi tin rằng quản lý mạng xã hội không nên là chuỗi thao tác lặp đi lặp lại mệt mỏi.
            PhuSocial được tạo ra để biến quy trình phức tạp thành trải nghiệm rõ ràng, êm ái và đáng tin cậy.
          </p>
        </section>

        {/* STORY SECTION */}
        <section className="relative py-12 px-6 max-w-6xl mx-auto z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
            
            {/* Visual Node / Workflow Mockup */}
            <div className="lg:col-span-5 relative flex items-center justify-center p-8 sm:p-12 rounded-3xl bg-white/[0.02] border border-white/[0.08] backdrop-blur-xl shadow-2xl">
              <div className="w-56 h-56 sm:w-64 sm:h-64 rounded-full border border-dashed border-blue-500/20 flex items-center justify-center relative">
                <div className="w-40 h-40 rounded-full border border-blue-500/15 flex items-center justify-center">
                  <div className="w-24 h-24 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-sky-500 flex flex-col items-center justify-center text-white shadow-xl shadow-blue-950/60 p-3 text-center">
                    <ThunderboltFilled className="text-2xl mb-1 text-white" />
                    <span className="font-bold text-xs">PhuSocial</span>
                  </div>
                </div>

                <div className="absolute top-2 right-1 sm:right-2 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0e1625] border border-white/[0.1] text-xs font-semibold text-slate-100 shadow-lg whitespace-nowrap">
                  <CheckCircleFilled className="text-emerald-400 text-xs" />
                  <span>Đúng lịch</span>
                </div>

                <div className="absolute bottom-4 left-1 sm:left-2 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0e1625] border border-white/[0.1] text-xs font-semibold text-slate-100 shadow-lg whitespace-nowrap">
                  <TeamOutlined className="text-indigo-400 text-xs" />
                  <span>Đồng bộ 1 nơi</span>
                </div>
              </div>
            </div>

            {/* Story Text */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-blue-300">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                Vì sao chúng tôi bắt đầu
              </div>

              <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-white leading-tight">
                Nội dung tốt cần thời gian. <br />
                Việc đăng bài thì không nên.
              </h2>

              <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
                Khi đội ngũ phải chuyển qua quá nhiều công cụ rời rạc, đăng từng bài thủ công và luôn căng thẳng lo lắng checkpoint hay trễ lịch, năng lượng dành cho sáng tạo nội dung sẽ dần cạn kiệt.
              </p>

              <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
                PhuSocial gom tất cả về một nơi duy nhất trên máy tính của bạn: kết nối Fanpage/Nhóm, chuẩn bị hình ảnh video, lên lịch thông minh và theo dõi tiến độ theo thời gian thực.
              </p>

              <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {[
                  'Ít thao tác lặp lại hơn mỗi ngày',
                  'Trạng thái hàng đợi luôn minh bạch',
                  'Tối ưu bảo mật trực tiếp trên máy',
                  'Dễ dàng làm quen với thành viên mới',
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2.5 text-[13.5px] sm:text-sm font-medium text-slate-200">
                    <CheckCircleFilled className="text-emerald-400 shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* VALUES SECTION (3 CARDS) */}
        <section className="relative py-20 px-6 max-w-6xl mx-auto z-10">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-400 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              Điều chúng tôi theo đuổi
            </div>
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-white leading-snug">
              Một sản phẩm tử tế bắt đầu <br />
              từ trải nghiệm tử tế.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {values.map((val) => (
              <div
                key={val.title}
                className="p-7 rounded-2xl bg-white/[0.03] border border-white/[0.08] hover:border-blue-500/30 hover:bg-white/[0.05] transition-all duration-300 backdrop-blur-md flex flex-col justify-between group shadow-lg"
              >
                <div>
                  <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-6 group-hover:scale-105 transition-transform duration-300">
                    {val.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-3">
                    {val.title}
                  </h3>
                  <p className="text-[15px] text-slate-300 leading-relaxed font-normal">
                    {val.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* STATS SECTION */}
        <section className="relative py-12 px-6 max-w-5xl mx-auto z-10">
          <div className="p-8 sm:p-10 rounded-2xl bg-white/[0.02] border border-white/[0.08] backdrop-blur-md grid grid-cols-1 md:grid-cols-3 gap-8 text-center divide-y md:divide-y-0 md:divide-x divide-white/[0.08]">
            {stats.map((s, idx) => (
              <div key={idx} className={`${idx > 0 ? 'pt-6 md:pt-0' : ''}`}>
                <div className="text-4xl sm:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-300">
                  {s.value}
                </div>
                <div className="text-[13.5px] sm:text-sm text-slate-300 font-medium mt-2 max-w-[220px] mx-auto">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA BANNER */}
        <section className="relative pt-12 pb-24 px-6 max-w-5xl mx-auto z-10">
          <div className="rounded-3xl p-10 sm:p-14 bg-gradient-to-b from-blue-950/20 via-white/[0.03] to-transparent border border-white/[0.1] text-center relative overflow-hidden backdrop-blur-xl shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white mx-auto mb-6 shadow-lg shadow-blue-500/30">
              <ThunderboltFilled className="text-xl" />
            </div>

            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-white mb-4">
              Cùng PhuSocial xây dựng quy trình tốt hơn.
            </h2>

            <p className="text-sm sm:text-base text-slate-300 max-w-lg mx-auto mb-8 font-normal leading-relaxed">
              Thiết lập không gian làm việc đầu tiên của bạn chỉ trong vài phút. Không cần thẻ tín dụng, sẵn sàng sử dụng ngay.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5">
              <Link to="/login" className="w-full sm:w-auto">
                <Button
                  type="primary"
                  size="large"
                  iconPlacement="end"
                  icon={<ArrowRightOutlined />}
                  className="w-full sm:w-auto !h-12 !px-8 !rounded-xl !font-bold !text-sm !bg-white !text-slate-950 !border-none shadow-[0_0_30px_rgba(255,255,255,0.2)] hover:!opacity-95 cursor-pointer"
                >
                  Bắt đầu miễn phí
                </Button>
              </Link>

              <Link to="/login" className="w-full sm:w-auto">
                <Button
                  size="large"
                  className="w-full sm:w-auto !h-12 !px-7 !rounded-xl !bg-white/[0.04] hover:!bg-white/[0.08] !border-white/[0.1] hover:!border-white/[0.2] !text-slate-300 !font-semibold !text-sm backdrop-blur-sm cursor-pointer"
                >
                  Đăng nhập
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </div>
    </PublicLayout>
  );
};

export default About;
