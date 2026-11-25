import { Tooltip } from 'antd';
import { COLOR_BACKGROUND_PRESETS, getColorBackgroundPreset } from '../../utils/colorBackgroundPresets';

interface ColorBackgroundPickerProps {
  value?: string;
  onChange: (key: string) => void;
}

// Hàng ô vuông chọn phông nền status Facebook.
const ColorBackgroundPicker = ({ value, onChange }: ColorBackgroundPickerProps) => {
  const current = getColorBackgroundPreset(value);
  return (
    <div className="color-bg-picker">
      <span className="color-bg-picker__label">Phông nền: {current.label}</span>
      <div className="color-bg-picker__row">
        {COLOR_BACKGROUND_PRESETS.map((p) => (
          <Tooltip key={p.key} title={p.label}>
            <button
              type="button"
              aria-label={p.label}
              aria-pressed={p.key === current.key}
              className={`color-bg-picker__swatch${p.key === current.key ? ' is-active' : ''}`}
              style={{ background: p.css }}
              onClick={() => onChange(p.key)}
            />
          </Tooltip>
        ))}
      </div>
    </div>
  );
};

export default ColorBackgroundPicker;
