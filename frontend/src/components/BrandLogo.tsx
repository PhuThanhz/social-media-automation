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
      <span className="brand-logo-mark !w-9 !h-9 !rounded-xl !bg-[#050b17] !border !border-sky-500/30 !shadow-md !shadow-sky-500/20 overflow-hidden flex items-center justify-center p-0.5 shrink-0 transition-transform duration-200 hover:scale-105">
        <img src="/logo.png" alt="PhuSocial Logo" className="w-full h-full object-contain select-none" />
      </span>
    ) : compact ? (
      <span className="brand-logo-mark !w-9 !h-9 !rounded-xl !bg-[#050b17] !border !border-sky-500/30 !shadow-md !shadow-sky-500/20 overflow-hidden flex items-center justify-center p-0.5 shrink-0">
        <img src="/logo.png" alt="PhuSocial Logo" className="w-full h-full object-contain select-none" />
      </span>
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
