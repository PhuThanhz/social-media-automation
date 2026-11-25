import { useEffect, useState, type ReactNode } from 'react';
import { TEXT_CARD_BACKGROUNDS, TEXT_CARD_CATEGORIES, getTextCardBackground } from '../../utils/textCardBackgrounds';

interface Props {
  value: string;
  onChange: (id: string) => void;
  /** Nút phụ đặt bên phải hàng nhóm nền (vd. "Ngẫu nhiên") */
  extra?: ReactNode;
}

// Lưới chọn nền "Ảnh chữ" theo nhóm — dùng trong studio Ảnh chữ và Dán nhiều bài chữ.
export default function TextCardBackgroundGrid({ value, onChange, extra }: Props) {
  const [category, setCategory] = useState<string>(getTextCardBackground(value).category);
  // Nền được đổi từ ngoài (vd. "Ngẫu nhiên") → nhảy sang đúng nhóm của nền đó
  useEffect(() => {
    setCategory(getTextCardBackground(value).category);
  }, [value]);
  const visible = TEXT_CARD_BACKGROUNDS.filter((b) => b.category === category);
  return (
    <div className="tc-bg">
      <div className="tc-bg__head">
        <div className="tc-bg__tabs" role="tablist">
          {TEXT_CARD_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={c === category}
              className={`tc-bg__tab${c === category ? ' is-active' : ''}`}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        {extra}
      </div>
      <div className="tc-bg__grid">
        {visible.map((b) => (
          <button
            key={b.id}
            type="button"
            aria-label={`Nền ${b.id}`}
            aria-pressed={b.id === value}
            className={`tc-bg__swatch${b.id === value ? ' is-active' : ''}`}
            style={{ background: b.css }}
            onClick={() => onChange(b.id)}
          />
        ))}
      </div>
    </div>
  );
}
