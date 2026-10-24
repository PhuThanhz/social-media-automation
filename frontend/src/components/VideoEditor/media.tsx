// Sóng âm và ảnh thu nhỏ cho timeline. Sóng âm giải mã 1 lần mỗi URL (WebAudio), vẽ đúng tỉ lệ thời gian:
// mỗi clip chỉ vẽ đoạn [offset, offset + length] của file, nên kéo/cắt clip là sóng chạy theo.
import { useEffect, useRef, useState } from 'react';

interface Peaks { duration: number; data: Float32Array } // data: biên độ max mỗi 1/100 giây

const peaksCache = new Map<string, Promise<Peaks | null>>();
const RES = 100;

export function loadPeaks(url: string): Promise<Peaks | null> {
  if (!peaksCache.has(url)) {
    peaksCache.set(url, (async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const audio = await ctx.decodeAudioData(buf);
        ctx.close().catch(() => {});
        const ch = audio.getChannelData(0);
        const n = Math.ceil(audio.duration * RES);
        const step = Math.max(1, Math.floor(ch.length / n));
        const data = new Float32Array(n);
        let max = 0;
        for (let i = 0; i < n; i++) {
          let m = 0;
          const s = i * step;
          for (let j = 0; j < step; j += 4) { const v = Math.abs(ch[s + j] || 0); if (v > m) m = v; }
          data[i] = m;
          if (m > max) max = m;
        }
        if (max > 0) for (let i = 0; i < n; i++) data[i] /= max;
        return { duration: audio.duration, data };
      } catch {
        return null;
      }
    })());
  }
  return peaksCache.get(url)!;
}

export function usePeaks(url?: string) {
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  useEffect(() => {
    let alive = true;
    setPeaks(null);
    if (url) loadPeaks(url).then((p) => { if (alive) setPeaks(p); });
    return () => { alive = false; };
  }, [url]);
  return peaks;
}

/** Vẽ sóng âm: offset = giây bắt đầu trong file, length = số giây hiển thị, loop = lặp file (nhạc nền) */
export function Waveform({ url, offset, length, rate = 1, color, loop = false, height, width }: { url: string; offset: number; length: number; rate?: number; color: string; loop?: boolean; height: number; width: number }) {
  const peaks = usePeaks(url);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const w = Math.max(1, Math.floor(width));
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr;
    cv.height = height * dpr;
    const g = cv.getContext('2d');
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, height);
    if (!peaks) return;
    g.fillStyle = color;
    const mid = height / 2;
    for (let x = 0; x < w; x += 2) {
      let t = offset + (x / w) * length * rate;
      if (loop && peaks.duration > 0) t = t % peaks.duration;
      if (t > peaks.duration) break;
      const v = peaks.data[Math.min(peaks.data.length - 1, Math.floor(t * RES))] || 0;
      const h = Math.max(1, v * (height - 6));
      g.fillRect(x, mid - h / 2, 1.4, h);
    }
  }, [peaks, offset, length, rate, color, loop, height, width]);
  return <canvas ref={ref} className="absolute left-0 top-0 pointer-events-none" style={{ height, width }} />;
}

/** Dải ảnh thu nhỏ của video: tua video ẩn tới từng mốc rồi vẽ thẳng lên canvas (không cần đọc pixel nên không vướng CORS) */
export function VideoThumbs({ url, from, to, height, width }: { url: string; from: number; to: number; height: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let cancelled = false;
    const w = Math.max(1, Math.floor(width));
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr;
    cv.height = height * dpr;
    const g = cv.getContext('2d');
    if (!g) return;
    g.scale(dpr, dpr);
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = url;
    const run = async () => {
      await new Promise<void>((r) => { v.onloadeddata = () => r(); v.onerror = () => r(); });
      if (cancelled || !v.videoWidth) return;
      const tw = Math.max(20, Math.round((height * v.videoWidth) / v.videoHeight));
      const n = Math.max(1, Math.ceil(w / tw));
      for (let i = 0; i < n && !cancelled; i++) {
        const t = from + ((i + 0.5) / n) * (to - from);
        await new Promise<void>((r) => { v.onseeked = () => r(); v.currentTime = Math.min(Math.max(0, t), (v.duration || t) - 0.05); setTimeout(r, 1500); });
        if (cancelled) return;
        g.drawImage(v, i * tw, 0, tw, height);
      }
    };
    run();
    return () => { cancelled = true; v.removeAttribute('src'); v.load(); };
  }, [url, from, to, height, width]);
  return <canvas ref={ref} className="absolute left-0 top-0 pointer-events-none opacity-70" style={{ height, width }} />;
}
