import { type ReactNode, useState } from 'react';
import { Button, Drawer } from 'antd';
import { ArrowRightOutlined, CloseOutlined, MenuOutlined } from '@ant-design/icons';
import { Link, NavLink, Outlet } from 'react-router-dom';
import BrandLogo from '../BrandLogo';

const PublicLayout = ({ children }: { children?: ReactNode }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const links = [
    { to: '/', label: 'Trang chủ', end: true },
    { to: '/#features', label: 'Tính năng' },
    { to: '/about', label: 'Giới thiệu' },
  ];

  const navigation = (
    <nav className="public-nav" aria-label="Điều hướng chính">
      {links.map((item) => item.to.includes('#') ? (
        <a key={item.to} href={item.to} onClick={() => setMenuOpen(false)}>{item.label}</a>
      ) : (
        <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setMenuOpen(false)}>{item.label}</NavLink>
      ))}
    </nav>
  );

  return (
    <div className="public-shell">
      <header className="public-header">
        <div className="public-container public-header-inner">
          <BrandLogo />
          <div className="public-nav-desktop">{navigation}</div>
          <div className="public-header-actions">
            <Link to="/login" className="public-login-link">Đăng nhập</Link>
            <Button type="primary" href="/login" className="public-cta">Mở workspace <ArrowRightOutlined /></Button>
          </div>
          <Button className="public-menu-button" type="text" icon={<MenuOutlined />} onClick={() => setMenuOpen(true)} aria-label="Mở menu" />
        </div>
      </header>

      <main>{children || <Outlet />}</main>

      <footer className="public-footer">
        <div className="public-container public-footer-compact">
          <BrandLogo light />
          <span>© 2026 PhuSocial</span>
          <div><Link to="/about">Giới thiệu</Link><a href="mailto:support@phusocial.vn">Hỗ trợ</a></div>
        </div>
      </footer>

      <Drawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        placement="right"
        width={300}
        closable={false}
        title={<div className="flex items-center justify-between"><BrandLogo /><Button type="text" icon={<CloseOutlined />} onClick={() => setMenuOpen(false)} /></div>}
        className="public-mobile-drawer"
      >
        {navigation}
        <div className="public-mobile-actions">
          <Button block onClick={() => { setMenuOpen(false); location.href = '/login'; }}>Đăng nhập</Button>
          <Button block type="primary" onClick={() => { setMenuOpen(false); location.href = '/login'; }}>Mở workspace</Button>
        </div>
      </Drawer>
    </div>
  );
};

export default PublicLayout;
