/**
 * WaveformTrack – hiển thị waveform âm thanh bằng WaveSurfer.js
 * Dùng cho Voice track và BGM track trong Video Studio timeline.
 */
import { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';

interface Props {
  url: string;
  color?: string;           // màu sóng âm
  height?: number;
  label?: string;
  duration?: number;        // tổng duration video (để scale track)
  trackDuration?: number;   // duration của clip này
  onReady?: (ws: WaveSurfer) => void;
  playing?: boolean;
  currentTime?: number;
}

export function WaveformTrack({ url, color = '#3b82f6', height = 48, label, onReady, playing, currentTime }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const playingRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || !url) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: color,
      progressColor: color.replace(')', ', 0.5)').replace('rgb', 'rgba').replace('#', '').length > 6
        ? color
        : `${color}88`,
      height,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      interact: false,
      normalize: true,
      url,
    });
    wsRef.current = ws;
    ws.on('ready', () => onReady?.(ws));
    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [url]);

  // Sync play/pause
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (playing && !playingRef.current) {
      ws.play().catch(() => {});
      playingRef.current = true;
    } else if (!playing && playingRef.current) {
      ws.pause();
      playingRef.current = false;
    }
  }, [playing]);

  // Seek
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || currentTime == null) return;
    const dur = ws.getDuration();
    if (dur > 0) ws.seekTo(Math.min(currentTime / dur, 1));
  }, [currentTime]);

  return (
    <div className="flex items-center gap-2 w-full">
      {label && (
        <span
          className="text-[10px] font-semibold text-slate-400 whitespace-nowrap flex-shrink-0"
          style={{ width: 44, textAlign: 'right' }}
        >
          {label}
        </span>
      )}
      <div ref={containerRef} className="flex-1 rounded overflow-hidden" style={{ minHeight: height }} />
    </div>
  );
}
