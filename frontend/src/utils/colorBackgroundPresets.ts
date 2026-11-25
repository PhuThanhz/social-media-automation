// Phông nền status Facebook mà worker chọn được (khóa phải khớp FB_BACKGROUND_PRESETS trong
// worker/fb-background.js). `css` chỉ là màu gần đúng để vẽ ô chọn + xem trước.
export interface ColorBackgroundPreset {
  key: string;
  label: string;
  css: string;
  textColor: string;
}

export const COLOR_BACKGROUND_PRESETS: ColorBackgroundPreset[] = [
  { key: 'RED', label: 'Đỏ', css: '#e2013b', textColor: '#fff' },
  { key: 'RAINBOW', label: 'Cầu vồng', css: 'linear-gradient(135deg, #7de3e0 0%, #b98cf5 30%, #ff5ad9 50%, #ff9ad5 62%, #8ff39a 80%, #f7d36b 100%)', textColor: '#111' },
  { key: 'PURPLE', label: 'Tím', css: '#c600ff', textColor: '#fff' },
  { key: 'BLACK', label: 'Đen', css: '#111111', textColor: '#fff' },
  { key: 'GRAD_RED_BLUE', label: 'Đỏ - xanh', css: 'linear-gradient(45deg, #ff0047, #2c34c7)', textColor: '#fff' },
  { key: 'GRAD_PURPLE_PINK', label: 'Tím - hồng', css: 'linear-gradient(45deg, #5d3fda, #fc36fd)', textColor: '#fff' },
  { key: 'GRAD_SUNSET', label: 'Vàng - cam - hồng', css: 'linear-gradient(180deg, #ffc94a, #ff7a3d 55%, #e8457a)', textColor: '#fff' },
  { key: 'GRAD_DARK', label: 'Xám tối', css: 'linear-gradient(45deg, #5d6374, #16181d)', textColor: '#fff' },
  { key: 'HEART_RED', label: 'Tim đỏ', css: 'radial-gradient(circle at 50% 55%, #ff6b74, #f9b3b6 80%)', textColor: '#3a3a3a' },
  { key: 'HEART_MAGENTA', label: 'Tim hồng tím', css: 'radial-gradient(circle at 50% 45%, #ff2f6d, #c80fd0 55%, #7a0cc9 90%)', textColor: '#fff' },
  { key: 'YELLOW', label: 'Vàng', css: 'linear-gradient(135deg, #ffd34a, #ffc000)', textColor: '#5a4a10' },
  { key: 'MINT', label: 'Xanh bạc hà', css: '#c4f0e2', textColor: '#0b8a63' },
];

export const getColorBackgroundPreset = (key?: string): ColorBackgroundPreset =>
  COLOR_BACKGROUND_PRESETS.find((p) => p.key === key) || COLOR_BACKGROUND_PRESETS[0];
