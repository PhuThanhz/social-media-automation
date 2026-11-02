import type { ReactNode } from 'react';
import { Flex } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import BrandLogo from '../BrandLogo';

type AuthLayoutProps = {
  children: ReactNode;
  title: string;
  description: string;
};

const AuthLayout = ({ children, title, description }: AuthLayoutProps) => (
  <Flex vertical justify="space-between" align="center" className="auth-simple-shell">
    {/* Soft Ambient Glows */}
    <div className="auth-simple-glow" />
    <div className="auth-simple-grid" />

    {/* Top Header Link */}
    <Flex align="center" justify="space-between" className="auth-simple-top">
      <Link to="/" className="auth-simple-back">
        <ArrowLeftOutlined /> Quay lại trang chủ
      </Link>
    </Flex>

    {/* Centered Luxury Card */}
    <div className="auth-simple-main">
      <div className="auth-simple-card">

        {/* Brand Logo & Title */}
        <div className="auth-simple-head">
          <div className="auth-simple-logo">
            <BrandLogo light />
          </div>
          <h1 className="auth-simple-title">{title}</h1>
          <p className="auth-simple-desc">{description}</p>
        </div>

        {/* Form Body */}
        <div className="auth-modern-body">
          {children}
        </div>
      </div>
    </div>

    {/* Footer */}
    <div className="auth-simple-footer">
      © {new Date().getFullYear()} PhuSocial · Nền tảng tự động hóa mạng xã hội
    </div>
  </Flex>
);

export default AuthLayout;
