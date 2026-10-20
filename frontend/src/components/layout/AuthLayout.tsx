import type { ReactNode } from 'react';
import { ArrowLeftOutlined, CheckCircleFilled, ClockCircleOutlined, ThunderboltFilled } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import BrandLogo from '../BrandLogo';

type AuthLayoutProps = {
  children: ReactNode;
  title: string;
  description: string;
};

const AuthLayout = ({ children, title, description }: AuthLayoutProps) => (
  <div className="auth-shell auth-v2">
    <section className="auth-v2-brand">
      <BrandLogo light />
      <div className="auth-v2-brand-copy">
        <span className="auth-v2-kicker"><i /> CONTENT WORKSPACE</span>
        <h1>Mọi lịch đăng.<br /><em>Một nơi.</em></h1>
        <p>Gọn hơn mỗi ngày.</p>
      </div>
      <div className="auth-v2-widget">
        <div className="auth-v2-widget-head">
          <span><ThunderboltFilled /> Hôm nay</span>
          <b>Đang chạy</b>
        </div>
        <div><ClockCircleOutlined /><span><b>14:30</b><small>Bài tiếp theo</small></span><CheckCircleFilled /></div>
        <div><ClockCircleOutlined /><span><b>19:00</b><small>Đã lên lịch</small></span><i /></div>
      </div>
      <small className="auth-v2-brand-foot">PHUSOCIAL · 2026</small>
    </section>

    <section className="auth-v2-form-panel">
      <Link to="/" className="auth-v2-back"><ArrowLeftOutlined /> Trang chủ</Link>
      <div className="auth-v2-form-wrap">
        <div className="auth-v2-mobile-logo"><BrandLogo light /></div>
        <div className="auth-v2-heading"><span>PHUSOCIAL</span><h2>{title}</h2><p>{description}</p></div>
        {children}
      </div>
      <small className="auth-v2-copyright">© 2026 PhuSocial</small>
    </section>
  </div>
);

export default AuthLayout;
