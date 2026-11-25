// Kho nền cho "Ảnh chữ" (TextCardModal): chữ của bài được vẽ lên nền rồi đăng như ảnh — không phụ thuộc
// tính năng phông nền của Facebook nên không giới hạn 130 ký tự và có rất nhiều nền.
// `css` là giá trị thuộc tính `background` (dùng chung cho ô chọn, xem trước và ảnh render).

export interface TextCardBackground {
  id: string;
  category: string;
  css: string;
  textColor: string;
}

export const TEXT_CARD_CATEGORIES = ['Gradient', 'Loang màu', 'Nhiễu hạt', 'Đơn sắc', 'Họa tiết', 'Giấy'] as const;

// Lớp nhiễu hạt (SVG feTurbulence) phủ lên nền — giống nền "cầu vồng nhiễu" của Facebook.
const NOISE = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0.32 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`;

const luminance = (hex: string) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const textFor = (colors: string[]) =>
  colors.reduce((s, c) => s + luminance(c), 0) / colors.length > 0.62 ? '#1a1a1a' : '#ffffff';

const GRADIENTS: string[][] = [
  ['#ff0047', '#2c34c7'], ['#5d3fda', '#fc36fd'], ['#f12711', '#f5af19'], ['#fc5c7d', '#6a82fb'],
  ['#00c6ff', '#0072ff'], ['#11998e', '#38ef7d'], ['#ee0979', '#ff6a00'], ['#8e2de2', '#4a00e0'],
  ['#f7971e', '#ffd200'], ['#00b09b', '#96c93d'], ['#ff512f', '#dd2476'], ['#4568dc', '#b06ab3'],
  ['#43cea2', '#185a9d'], ['#ffafbd', '#ffc3a0'], ['#2193b0', '#6dd5ed'], ['#cc2b5e', '#753a88'],
  ['#ee9ca7', '#ffdde1'], ['#42275a', '#734b6d'], ['#bdc3c7', '#2c3e50'], ['#de6262', '#ffb88c'],
  ['#06beb6', '#48b1bf'], ['#eb3349', '#f45c43'], ['#dd5e89', '#f7bb97'], ['#56ab2f', '#a8e063'],
  ['#614385', '#516395'], ['#e65c00', '#f9d423'], ['#2b5876', '#4e4376'], ['#ff9966', '#ff5e62'],
  ['#7f00ff', '#e100ff'], ['#00f260', '#0575e6'], ['#fc4a1a', '#f7b733'], ['#134e5e', '#71b280'],
  ['#ff758c', '#ff7eb3'], ['#3a1c71', '#d76d77', '#ffaf7b'], ['#c33764', '#1d2671'], ['#0f2027', '#203a43', '#2c5364'],
  ['#a18cd1', '#fbc2eb'], ['#fad0c4', '#ffd1ff'], ['#84fab0', '#8fd3f4'], ['#f6d365', '#fda085'],
];

// [4 đốm màu, màu nền]
const MESHES: string[][] = [
  ['#7de3e0', '#ff5ad9', '#8ff39a', '#f7d36b', '#b98cf5'],
  ['#ff9a8b', '#ff6a88', '#ff99ac', '#fcd5ce', '#ffb4a2'],
  ['#4facfe', '#00f2fe', '#a18cd1', '#fbc2eb', '#6a82fb'],
  ['#fddb92', '#d1fdff', '#ffecd2', '#fcb69f', '#f6d365'],
  ['#ff0844', '#ffb199', '#c471f5', '#fa71cd', '#ff5e62'],
  ['#0ba360', '#3cba92', '#a8e063', '#d4fc79', '#38ef7d'],
  ['#2af598', '#009efd', '#5ee7df', '#b490ca', '#43cea2'],
  ['#f83600', '#f9d423', '#fe8c00', '#ff512f', '#fc4a1a'],
  ['#30cfd0', '#330867', '#667eea', '#764ba2', '#2b5876'],
  ['#ffc3a0', '#ffafbd', '#a1c4fd', '#c2e9fb', '#e0c3fc'],
  ['#c471ed', '#f64f59', '#12c2e9', '#f7797d', '#8e2de2'],
  ['#e0c3fc', '#8ec5fc', '#fbc2eb', '#a6c1ee', '#d4c1f5'],
  ['#ff6e7f', '#bfe9ff', '#ffd3a5', '#fd6585', '#f7a8b8'],
  ['#1e3c72', '#2a5298', '#7303c0', '#ec38bc', '#0f2027'],
  ['#fffbd5', '#b20a2c', '#f2709c', '#ff9472', '#e65c00'],
  ['#a8edea', '#fed6e3', '#d299c2', '#fef9d7', '#c2e9fb'],
];

const SOLIDS = [
  '#ffffff', '#fff8e7', '#111111', '#0f1b3d', '#e41e3f', '#ff4f9a', '#ff7a1a', '#ffd400',
  '#18a558', '#0fa3a3', '#1877f2', '#7b2ff7', '#6b3e26', '#4b5563', '#c4f0e2', '#e6dcff',
];

const PATTERN_BASES = ['#1877f2', '#e41e3f', '#111111', '#7b2ff7'];
const PATTERNS: ((c: string) => string)[] = [
  (c) => `radial-gradient(rgba(255,255,255,.22) 3px, transparent 3.5px) 0 0/34px 34px, ${c}`,
  (c) => `linear-gradient(rgba(255,255,255,.12) 2px, transparent 2px) 0 0/54px 54px, linear-gradient(90deg, rgba(255,255,255,.12) 2px, transparent 2px) 0 0/54px 54px, ${c}`,
  (c) => `repeating-linear-gradient(45deg, rgba(255,255,255,.09) 0 22px, transparent 22px 44px), ${c}`,
  (c) => `repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,.08) 0 14px, transparent 14px 40px), ${c}`,
];

const meshCss = ([a, b, c, d, base]: string[]) =>
  `radial-gradient(at 15% 18%, ${a} 0, transparent 55%), radial-gradient(at 85% 15%, ${b} 0, transparent 55%), ` +
  `radial-gradient(at 20% 88%, ${c} 0, transparent 55%), radial-gradient(at 88% 85%, ${d} 0, transparent 55%), ${base}`;
const gradCss = (cols: string[], angle = 135) => `linear-gradient(${angle}deg, ${cols.join(', ')})`;

const build = (): TextCardBackground[] => {
  const out: TextCardBackground[] = [];
  GRADIENTS.forEach((cols, i) => out.push({ id: `grad-${i}`, category: 'Gradient', css: gradCss(cols), textColor: textFor(cols) }));
  MESHES.forEach((cols, i) => out.push({ id: `mesh-${i}`, category: 'Loang màu', css: meshCss(cols), textColor: textFor(cols) }));
  // Nhiễu hạt: cầu vồng kiểu Facebook + loang/gradient phủ hạt
  out.push({
    id: 'grain-rainbow', category: 'Nhiễu hạt', textColor: '#111111',
    css: `${NOISE}, linear-gradient(135deg, #7de3e0 0%, #b98cf5 30%, #ff5ad9 50%, #ff9ad5 62%, #8ff39a 80%, #f7d36b 100%)`,
  });
  MESHES.slice(0, 8).forEach((cols, i) => out.push({ id: `grain-mesh-${i}`, category: 'Nhiễu hạt', css: `${NOISE}, ${meshCss(cols)}`, textColor: textFor(cols) }));
  [0, 1, 6, 7, 28, 33, 35].forEach((g) => out.push({ id: `grain-grad-${g}`, category: 'Nhiễu hạt', css: `${NOISE}, ${gradCss(GRADIENTS[g])}`, textColor: textFor(GRADIENTS[g]) }));
  SOLIDS.forEach((c, i) => out.push({ id: `solid-${i}`, category: 'Đơn sắc', css: c, textColor: textFor([c]) }));
  PATTERNS.forEach((p, pi) => PATTERN_BASES.forEach((c, ci) => out.push({ id: `pat-${pi}-${ci}`, category: 'Họa tiết', css: p(c), textColor: '#ffffff' })));
  out.push(
    { id: 'paper-lined', category: 'Giấy', textColor: '#1f2a44', css: 'linear-gradient(90deg, transparent 96px, #f3a0a0 96px 100px, transparent 100px), repeating-linear-gradient(#fffdf6 0 58px, #c9d8f0 58px 60px)' },
    { id: 'paper-sticky', category: 'Giấy', textColor: '#3b3000', css: 'linear-gradient(160deg, #fff9b0, #ffe873)' },
    { id: 'paper-kraft', category: 'Giấy', textColor: '#2b1b0a', css: `${NOISE}, #c9a36b` },
    { id: 'paper-old', category: 'Giấy', textColor: '#3a2a12', css: `${NOISE}, radial-gradient(circle at 50% 50%, #f8ecd0 40%, #e2c98f 100%)` },
    { id: 'paper-chalk', category: 'Giấy', textColor: '#f4f4f0', css: `${NOISE}, radial-gradient(circle at 50% 45%, #3d5045, #24302a)` },
    { id: 'paper-blueprint', category: 'Giấy', textColor: '#ffffff', css: 'linear-gradient(rgba(255,255,255,.14) 2px, transparent 2px) 0 0/48px 48px, linear-gradient(90deg, rgba(255,255,255,.14) 2px, transparent 2px) 0 0/48px 48px, #1e4e8c' },
    { id: 'paper-grid', category: 'Giấy', textColor: '#1f2937', css: 'linear-gradient(#dbe4f0 2px, transparent 2px) 0 0/44px 44px, linear-gradient(90deg, #dbe4f0 2px, transparent 2px) 0 0/44px 44px, #ffffff' },
  );
  return out;
};

export const TEXT_CARD_BACKGROUNDS: TextCardBackground[] = build();

export const getTextCardBackground = (id?: string) =>
  TEXT_CARD_BACKGROUNDS.find((b) => b.id === id) || TEXT_CARD_BACKGROUNDS[0];
