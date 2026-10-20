import { useEffect, useMemo, useRef, useState } from 'react';

export interface SrtSegment {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

const MIN_SEGMENT_DURATION = 0.3;

export function parseSrt(srt: string): SrtSegment[] {
  if (!srt || !srt.trim()) return [];
  const blocks = srt.trim().split(/\r?\n\r?\n+/);
  const segments: SrtSegment[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) continue;
    const timeMatch = lines[timeLineIdx].match(
      /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
    );
    if (!timeMatch) continue;
    const start =
      Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]) + Number(timeMatch[4]) / 1000;
    const end =
      Number(timeMatch[5]) * 3600 + Number(timeMatch[6]) * 60 + Number(timeMatch[7]) + Number(timeMatch[8]) / 1000;
    const text = lines.slice(timeLineIdx + 1).join('\n');
    segments.push({ start, end, text });
  }
  return segments;
}

function formatSrtTime(t: number): string {
  const clamped = Math.max(0, t);
  const totalMs = Math.round(clamped * 1000);
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function segmentsToSrt(segments: SrtSegment[]): string {
  return segments
    .map((seg, i) => `${i + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${seg.text}`)
    .join('\n\n');
}

function formatClock(t: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

interface Props {
  srtContent: string;
  duration: number;
  currentTime: number;
  onChange: (newSrt: string) => void;
  onSeek?: (time: number) => void;
}

type DragMode = 'move' | 'left' | 'right';

const SubtitleTimeline = ({ srtContent, duration, currentTime, onChange, onSeek }: Props) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [segments, setSegments] = useState<SrtSegment[]>(() => parseSrt(srtContent));
  const dragState = useRef<{
    idx: number;
    mode: DragMode;
    startX: number;
    trackWidth: number;
    originalStart: number;
    originalEnd: number;
  } | null>(null);

  // Đồng bộ lại khi SRT thay đổi từ bên ngoài (ví dụ vừa gọi AI tạo sub mới)
  useEffect(() => {
    setSegments(parseSrt(srtContent));
  }, [srtContent]);

  const effectiveDuration = duration > 0 ? duration : Math.max(1, ...segments.map((s) => s.end), 30);

  const handlePointerDown = (idx: number, mode: DragMode) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const trackWidth = trackRef.current?.getBoundingClientRect().width || 1;
    const seg = segments[idx];
    dragState.current = {
      idx,
      mode,
      startX: e.clientX,
      trackWidth,
      originalStart: seg.start,
      originalEnd: seg.end,
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handlePointerMove = (e: PointerEvent) => {
    const drag = dragState.current;
    if (!drag) return;
    const deltaPx = e.clientX - drag.startX;
    const deltaTime = (deltaPx / drag.trackWidth) * effectiveDuration;

    setSegments((prev) => {
      const next = [...prev];
      const seg = { ...next[drag.idx] };
      const prevSeg = next[drag.idx - 1];
      const nextSeg = next[drag.idx + 1];
      const lowerBound = prevSeg ? prevSeg.end : 0;
      const upperBound = nextSeg ? nextSeg.start : effectiveDuration;

      if (drag.mode === 'move') {
        const segDuration = drag.originalEnd - drag.originalStart;
        let newStart = drag.originalStart + deltaTime;
        newStart = Math.max(lowerBound, Math.min(newStart, upperBound - segDuration));
        seg.start = newStart;
        seg.end = newStart + segDuration;
      } else if (drag.mode === 'left') {
        let newStart = drag.originalStart + deltaTime;
        newStart = Math.max(lowerBound, Math.min(newStart, seg.end - MIN_SEGMENT_DURATION));
        seg.start = newStart;
      } else if (drag.mode === 'right') {
        let newEnd = drag.originalEnd + deltaTime;
        newEnd = Math.min(upperBound, Math.max(newEnd, seg.start + MIN_SEGMENT_DURATION));
        seg.end = newEnd;
      }

      next[drag.idx] = seg;
      return next;
    });
  };

  const handlePointerUp = () => {
    dragState.current = null;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    setSegments((current) => {
      onChange(segmentsToSrt(current));
      return current;
    });
  };

  const handleTrackClick = (e: React.MouseEvent) => {
    if (!trackRef.current || !onSeek) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * effectiveDuration);
  };

  const playheadPct = useMemo(
    () => Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100)),
    [currentTime, effectiveDuration]
  );

  if (!segments.length) {
    return (
      <div className="text-[11px] text-slate-500 italic px-1 py-2">
        Chưa có phụ đề — bấm "Tự Động Tạo Vietsub" để hiện timeline chỉnh từng dòng tại đây.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono px-0.5">
        <span>0:00</span>
        <span>{formatClock(effectiveDuration)}</span>
      </div>
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        className="relative h-14 w-full bg-slate-900 rounded-lg border border-slate-700 cursor-pointer overflow-hidden select-none"
      >
        {segments.map((seg, idx) => {
          const leftPct = (seg.start / effectiveDuration) * 100;
          const widthPct = Math.max(0.5, ((seg.end - seg.start) / effectiveDuration) * 100);
          return (
            <div
              key={idx}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              className="absolute top-1 bottom-1 rounded-md bg-gradient-to-r from-amber-600/80 to-orange-600/80 border border-amber-400/60 flex items-center group"
            >
              <div
                onPointerDown={handlePointerDown(idx, 'left')}
                className="w-1.5 h-full cursor-ew-resize bg-amber-300/40 hover:bg-amber-200/70 shrink-0 rounded-l-md"
              />
              <div
                onPointerDown={handlePointerDown(idx, 'move')}
                title={seg.text}
                className="flex-1 h-full px-1 flex items-center overflow-hidden cursor-grab active:cursor-grabbing"
              >
                <span className="text-[9px] text-white font-semibold truncate">{seg.text}</span>
              </div>
              <div
                onPointerDown={handlePointerDown(idx, 'right')}
                className="w-1.5 h-full cursor-ew-resize bg-amber-300/40 hover:bg-amber-200/70 shrink-0 rounded-r-md"
              />
            </div>
          );
        })}
        <div
          style={{ left: `${playheadPct}%` }}
          className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 pointer-events-none shadow-[0_0_6px_rgba(34,211,238,0.9)]"
        />
      </div>
      <div className="text-[10px] text-slate-500 px-0.5">
        Kéo giữa khối để dời thời điểm, kéo 2 mép để chỉnh độ dài từng câu sub.
      </div>
    </div>
  );
};

export default SubtitleTimeline;
