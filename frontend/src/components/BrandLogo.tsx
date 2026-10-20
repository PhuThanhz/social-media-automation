import { ThunderboltFilled } from '@ant-design/icons';
import { Link } from 'react-router-dom';

type BrandLogoProps = {
  compact?: boolean;
  light?: boolean;
  to?: string;
  hideMark?: boolean;
};

const BrandLogo = ({ compact = false, light = false, to = '/', hideMark = false }: BrandLogoProps) => (
  <Link to={to} className={`brand-logo ${compact ? 'is-compact' : ''} ${light ? 'is-light' : ''}`} aria-label="PhuSocial - Trang chủ">
    {!hideMark ? (
      <span className="brand-logo-mark"><ThunderboltFilled /></span>
    ) : compact ? (
      <span className="font-extrabold text-xl text-white">P</span>
    ) : null}
    {!compact && (
      <span className="brand-logo-copy">
        <b>PhuSocial</b>
        <small>Lịch đăng tự động</small>
      </span>
    )}
  </Link>
);

export default BrandLogo;
