import { useEffect } from 'react';
import { TEXT_CARD_FONTS, TEXT_CARD_FONTS_HREF, TEXT_CARD_LAYOUTS, type TextCardLayout } from '../../utils/textCardTemplate';

// Bộ chọn dùng chung cho studio Ảnh chữ và Dán nhiều bài chữ.

/** Ô chọn bố cục: mỗi ô là hình minh họa sơ đồ bố cục */
export function TextCardLayoutPicker({ value, onChange }: { value: TextCardLayout; onChange: (v: TextCardLayout) => void }) {
  return (
    <div className="tc-tiles tc-tiles--layout">
      {TEXT_CARD_LAYOUTS.map((l) => (
        <button
          key={l.key}
          type="button"
          aria-pressed={l.key === value}
          className={`tc-tile${l.key === value ? ' is-active' : ''}`}
          onClick={() => onChange(l.key)}
        >
          <span className={`tc-layout-thumb tc-layout-thumb--${l.key}`}>
            {l.key === 'quote' && <i className="q">“</i>}
            {l.key === 'headline' && <i className="bar" />}
            {l.key === 'card' && <i className="panel" />}
            <i className="l1" /><i className="l2" /><i className="l3" />
          </span>
          <span className="tc-tile__label">{l.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Ô chọn font: hiện chữ mẫu bằng chính font đó */
export function TextCardFontPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  useEffect(() => {
    if (document.querySelector(`link[href="${TEXT_CARD_FONTS_HREF}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = TEXT_CARD_FONTS_HREF;
    document.head.appendChild(link);
  }, []);
  return (
    <div className="tc-tiles tc-tiles--font">
      {TEXT_CARD_FONTS.map((f) => (
        <button
          key={f.key}
          type="button"
          aria-pressed={f.key === value}
          className={`tc-tile${f.key === value ? ' is-active' : ''}`}
          onClick={() => onChange(f.key)}
        >
          <span className="tc-font-sample" style={{ fontFamily: `${f.family}, sans-serif` }}>Việt</span>
          <span className="tc-tile__label">{f.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Nhóm lựa chọn nhỏ dạng nút liền nhau (thay Segmented cho gọn, không tràn) */
export function TextCardChoice<T extends string>({ value, onChange, options }: { value: T; onChange: (v: NoInfer<T>) => void; options: { label: string; value: NoInfer<T> }[] }) {
  return (
    <div className="tc-choice" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`tc-choice__btn${o.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
