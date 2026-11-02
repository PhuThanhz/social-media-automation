import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface BackgroundPreset {
  id: string;
  label: string;
  url?: string;
  thumb?: string;
}

// Ảnh nền tải từ Unsplash (Unsplash License), lưu ở public/backgrounds.
export const BACKGROUNDS: BackgroundPreset[] = [
  { id: 'default', label: 'Mặc định' },
  { id: 'ocean', label: 'Bờ biển', url: '/backgrounds/ocean.jpg', thumb: '/backgrounds/ocean-thumb.jpg' },
  { id: 'mountain', label: 'Núi rừng', url: '/backgrounds/mountain.jpg', thumb: '/backgrounds/mountain-thumb.jpg' },
  { id: 'sky', label: 'Biển mây', url: '/backgrounds/sky.jpg', thumb: '/backgrounds/sky-thumb.jpg' },
  { id: 'aurora', label: 'Cực quang', url: '/backgrounds/aurora.jpg', thumb: '/backgrounds/aurora-thumb.jpg' },
  { id: 'forest', label: 'Rừng thông', url: '/backgrounds/forest.jpg', thumb: '/backgrounds/forest-thumb.jpg' },
  { id: 'city', label: 'Thành phố', url: '/backgrounds/city.jpg', thumb: '/backgrounds/city-thumb.jpg' },
];

export const CUSTOM_BACKGROUND_ID = 'custom';

// Sleek obsidian dark gradient for pro dashboard
const DEFAULT_BACKGROUND =
  'radial-gradient(circle at 50% 0%, rgba(30, 58, 110, 0.25) 0%, transparent 60%), linear-gradient(180deg, #07090e 0%, #0a0e17 100%)';

interface BackgroundState {
  backgroundId: string;
  customImage: string | null;
  setBackground: (id: string) => void;
  setCustomImage: (dataUrl: string) => void;
}

export const useBackgroundStore = create<BackgroundState>()(
  persist(
    (set) => ({
      backgroundId: 'mountain',
      customImage: null,
      setBackground: (backgroundId) => set({ backgroundId }),
      setCustomImage: (customImage) => set({ customImage, backgroundId: CUSTOM_BACKGROUND_ID }),
    }),
    { name: 'app-background' }
  )
);

export function resolveBackgroundImage(backgroundId: string, customImage: string | null): string {
  if (backgroundId === CUSTOM_BACKGROUND_ID && customImage) return `url("${customImage}")`;
  const preset = BACKGROUNDS.find((b) => b.id === backgroundId);
  return preset?.url ? `url("${preset.url}")` : DEFAULT_BACKGROUND;
}

/** Thu nhỏ ảnh người dùng chọn về tối đa 1920px để vừa localStorage. */
export function fileToBackgroundDataUrl(file: File, maxSize = 1920): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Không đọc được ảnh'));
    };
    img.src = objectUrl;
  });
}
