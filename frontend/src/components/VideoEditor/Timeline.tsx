// Timeline nhiều track kiểu CapCut: kéo để dời clip, kéo mép để cắt/co giãn, hít (snap) vào đầu phát và mép clip khác,
// phóng to/thu nhỏ bằng thanh zoom hoặc Ctrl + cuộn chuột. Sóng âm và ảnh thu nhỏ vẽ đúng theo thời gian.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Slider, Tooltip } from 'antd';
import { usePlayerClock, useEditor, timelineDuration, voiceEnd, voiceIn, voiceLen } from './store';
import type { Project, Selection } from './store';
import { VideoThumbs, Waveform } from './media';
import { TRANSITIONS, captionShown, layoutUntil } from './layers';
import { Blend, Maximize2 } from 'lucide-react';
import { AudioLines, Captions, Film, ImageIcon, LayoutTemplate, Music, Type } from 'lucide-react';

const HEADER_W = 116;
const ROW_H = 40;
const VIDEO_ROW_H = 56;

export const fmtTime = (s: number, frac = true) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return frac ? `${m}:${sec.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.floor(sec)).padStart(2, '0')}`;
};

type DragMode = 'move' | 'l' | 'r';

interface ClipProps {
  start: number;
  end: number;
  pps: number;
  color: string;
  selected: boolean;
  label?: ReactNode;
  children?: ReactNode;
  resizable?: boolean;
  movable?: boolean;
  minLen?: number;
  snapPoints: number[];
  onSelect: () => void;
  onChange: (mode: DragMode, start: number, end: number) => void;
  height: number;
}

function Clip({ start, end, pps, color, selected, label, children, resizable = true, movable = true, minLen = 0.1, snapPoints, onSelect, onChange, height }: ClipProps) {
  const checkpoint = useEditor((s) => s.checkpoint);
  const begin = (e: React.PointerEvent, mode: DragMode) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    if (mode === 'move' && !movable) return;
    const x0 = e.clientX;
    const s0 = start;
    const e0 = end;
    let started = false;
    const snap = (t: number) => {
      let best = t;
      let bestD = 8 / pps;
      for (const p of snapPoints) {
        const d = Math.abs(p - t);
        if (d < bestD) { bestD = d; best = p; }
      }
      return best;
    };
    const onMove = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / pps;
      if (!started) {
        if (Math.abs(ev.clientX - x0) < 3) return;
        started = true;
        checkpoint();
      }
      if (mode === 'move') {
        let ns = s0 + dt;
        const snappedStart = snap(ns);
        const snappedEnd = snap(ns + (e0 - s0));
        if (snappedStart !== ns) ns = snappedStart;
        else if (snappedEnd !== ns + (e0 - s0)) ns = snappedEnd - (e0 - s0);
        onChange('move', ns, ns + (e0 - s0));
      } else if (mode === 'l') {
        const ns = Math.min(e0 - minLen, snap(s0 + dt));
        onChange('l', ns, e0);
      } else {
        const ne = Math.max(s0 + minLen, snap(e0 + dt));
        onChange('r', s0, ne);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const left = start * pps;
  const width = Math.max(4, (end - start) * pps);
  return (
    <div
      className={`absolute top-[3px] rounded-md overflow-hidden ${movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${selected ? 'ring-2 ring-white z-10' : 'ring-1 ring-black/30'}`}
      style={{ left, width, height: height - 6, background: color }}
      onPointerDown={(e) => begin(e, 'move')}
    >
      {children}
      {label && <div className="absolute left-2.5 top-1 right-2.5 text-[10px] leading-tight text-white/95 truncate pointer-events-none" style={{ textShadow: '0 1px 2px rgba(0,0,0,.6)' }}>{label}</div>}
      {resizable && (
        <>
          <div className="group/h absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize flex items-center justify-center" style={{ background: selected ? 'rgba(255,255,255,0.9)' : 'transparent' }} onPointerDown={(e) => begin(e, 'l')}>
            <span className="w-0.5 h-3 rounded" style={{ background: selected ? '#1e293b' : 'transparent' }} />
          </div>
          <div className="group/h absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize flex items-center justify-center" style={{ background: selected ? 'rgba(255,255,255,0.9)' : 'transparent' }} onPointerDown={(e) => begin(e, 'r')}>
            <span className="w-0.5 h-3 rounded" style={{ background: selected ? '#1e293b' : 'transparent' }} />
          </div>
        </>
      )}
    </div>
  );
}

const isSel = (sel: Selection, type: string, id?: string) => !!sel && sel.type === type && (!id || ('id' in sel && sel.id === id));

interface Props {
  hasAudio: boolean;
  seek: (t: number) => void;
}

export default function Timeline({ hasAudio, seek }: Props) {
  const project = useEditor((s) => s.project) as Project;
  const update = useEditor((s) => s.update);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  const time = usePlayerClock((s) => s.time);
  const D = timelineDuration(project);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(800);
  const [zoom, setZoom] = useState(1); // 1 = vừa khung nhìn
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pps = Math.max(8, ((viewW - 24) / Math.max(1, D)) * zoom);
  const totalW = Math.max(viewW, D * pps + 40);

  // Giữ đầu phát luôn trong khung nhìn khi đang phát
  const playing = usePlayerClock((s) => s.playing);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = time * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - 60);
  }, [time, pps, playing]);

  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom((z) => Math.max(1, Math.min(40, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
  };

  const snapPoints = useMemo(() => {
    const pts = [0, D, time];
    if (project.frame.enabled) pts.push(project.frame.start, project.frame.end);
    project.overlays.forEach((l) => pts.push(l.start, l.end));
    project.voices.forEach((v) => pts.push(v.start, voiceEnd(v)));
    project.captions.forEach((c) => pts.push(c.start, c.end));
    if (project.bgm) pts.push(project.bgm.start, project.bgm.end);
    return pts;
  }, [project, D, time]);

  // Ruler: kéo để tua
  const rulerDown = (e: React.PointerEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const at = (cx: number) => Math.max(0, Math.min(D, (cx - rect.left + el.scrollLeft - 12) / pps));
    seek(at(e.clientX));
    const mv = (ev: PointerEvent) => seek(at(ev.clientX));
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const tickStep = [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * pps >= 60) || 60;
  const ticks: number[] = [];
  for (let t = 0; t <= D + 0.001; t += tickStep) ticks.push(t);

  const clampSE = (s: number, e: number): [number, number] => {
    const len = e - s;
    let ns = Math.max(0, s);
    let ne = ns + len;
    if (ne > D) { ne = D; ns = Math.max(0, D - len); }
    return [ns, ne];
  };

  type Row = { key: string; label: ReactNode; h?: number; color: string; content: ReactNode };
  const rows: Row[] = [];

  project.overlays.forEach((l) => {
    rows.push({
      key: l.id,
      label: <span className="flex items-center gap-1.5 min-w-0">{l.kind === 'text' ? <Type size={13} /> : <ImageIcon size={13} />}<span className="truncate">{l.name}</span></span>,
      color: l.kind === 'text' ? '#b45309' : '#0e7490',
      content: (
        <Clip
          start={l.start} end={l.end} pps={pps} height={ROW_H} snapPoints={snapPoints}
          color={l.kind === 'text' ? '#d97706' : '#0891b2'}
          selected={isSel(selected, 'overlay', l.id)}
          label={l.kind === 'text' ? l.text : l.name}
          onSelect={() => select({ type: 'overlay', id: l.id })}
          onChange={(_m, s, e) => {
            const [ns, ne] = _m === 'move' ? clampSE(s, e) : [Math.max(0, s), Math.min(D, e)];
            update((p) => ({ ...p, overlays: p.overlays.map((x) => (x.id === l.id ? { ...x, start: ns, end: ne } : x)) }), { silent: true });
          }}
        />
      ),
    });
  });

  rows.push({
    key: 'frame',
    label: <span className="flex items-center gap-1.5"><LayoutTemplate size={13} />Khung</span>,
    color: '#6d28d9',
    content: (
      <>
        {project.frame.enabled && (
          <Clip
            start={project.frame.start} end={Math.min(D, project.frame.end)} pps={pps} height={ROW_H} snapPoints={snapPoints}
            color="#7c3aed" selected={isSel(selected, 'frame')} label="Khung tiêu đề"
            onSelect={() => select({ type: 'frame' })}
            onChange={(m, s, e) => {
              const [ns, ne] = m === 'move' ? clampSE(s, e) : [Math.max(0, s), Math.min(D, e)];
              update((p) => ({ ...p, frame: { ...p.frame, start: ns, end: ne }, brand: p.brand.enabled && Math.abs(p.brand.start - p.frame.end) < 0.05 ? { ...p.brand, start: ne } : p.brand }), { silent: true });
            }}
          />
        )}
        {project.brand.enabled && project.brand.end > project.brand.start && (
          <Clip
            start={project.brand.start} end={Math.min(D, project.brand.end)} pps={pps} height={ROW_H} snapPoints={snapPoints}
            color="#4c1d95" selected={isSel(selected, 'brand')} label="Nguồn + logo"
            onSelect={() => select({ type: 'brand' })}
            onChange={(m, s, e) => {
              const [ns, ne] = m === 'move' ? clampSE(s, e) : [Math.max(0, s), Math.min(D, e)];
              update((p) => ({ ...p, brand: { ...p.brand, start: ns, end: ne } }), { silent: true });
            }}
          />
        )}
        {/* Ô chuyển cảnh ở chỗ nối khung → clip trọn màn hình (bấm để chọn hiệu ứng) */}
        {(() => {
          const lu = layoutUntil(project);
          if (!(lu > 0 && lu < D - 0.05)) return null;
          const tname = TRANSITIONS.find((x) => x.value === (project.frame.transition || 'fade'))?.label || 'Chuyển cảnh';
          return (
            <Tooltip title={`Chuyển cảnh: ${tname}`}>
              <button type="button" onPointerDown={(e) => { e.stopPropagation(); select({ type: 'transition' }); }}
                className={`absolute z-20 top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 rounded-md flex items-center justify-center shadow-md border transition ${isSel(selected, 'transition') ? 'bg-blue-500 border-white text-white' : 'bg-white border-slate-300 text-slate-800 hover:bg-blue-50'}`}
                style={{ left: lu * pps }}>
                <Blend size={13} />
              </button>
            </Tooltip>
          );
        })()}
      </>
    ),
  });

  rows.push({
    key: 'captions',
    label: <span className={`flex items-center gap-1.5 ${project.captionStyle.enabled ? '' : 'opacity-50'}`}><Captions size={13} />Phụ đề</span>,
    color: '#be185d',
    content: project.captions.map((c) => (
      <Clip
        key={c.id} start={c.start} end={c.end} pps={pps} height={ROW_H} snapPoints={snapPoints}
        color={captionShown(c, project) ? '#db2777' : '#4b5563'} selected={isSel(selected, 'caption', c.id)} label={c.text}
        onSelect={() => select({ type: 'caption', id: c.id })}
        onChange={(m, s, e) => {
          const [ns, ne] = m === 'move' ? clampSE(s, e) : [Math.max(0, s), Math.min(D, e)];
          const shift = ns - c.start;
          update((p) => ({
            ...p,
            captions: p.captions.map((x) => {
              if (x.id !== c.id) return x;
              // Dời cả dòng thì các mốc từ dời theo; co giãn thì co giãn mốc từ theo tỉ lệ
              const words = x.words?.map((w) => m === 'move'
                ? { ...w, start: w.start + shift, end: w.end + shift }
                : { ...w, start: ns + ((w.start - x.start) / (x.end - x.start || 1)) * (ne - ns), end: ns + ((w.end - x.start) / (x.end - x.start || 1)) * (ne - ns) });
              return { ...x, start: ns, end: ne, words };
            }),
          }), { silent: true });
        }}
      />
    )),
  });

  const v = project.video;
  const trimBase = useRef(v.trimIn);
  rows.push({
    key: 'video',
    h: VIDEO_ROW_H,
    label: <span className="flex items-center gap-1.5"><Film size={13} />Video</span>,
    color: '#1d4ed8',
    content: (
      <Clip
        start={0} end={D} pps={pps} height={VIDEO_ROW_H} snapPoints={snapPoints.filter((p) => p !== D && p !== 0)}
        color="#1e3a8a" selected={isSel(selected, 'video')} movable={false} minLen={0.3}
        label={v.speed !== 1 ? `${v.speed}x` : undefined}
        onSelect={() => { trimBase.current = project.video.trimIn; select({ type: 'video' }); }}
        onChange={(m, s, e) => {
          update((p) => {
            const sp = p.video.speed || 1;
            if (m === 'l') return { ...p, video: { ...p.video, trimIn: Math.max(0, Math.min(p.video.trimOut - 0.3, trimBase.current + s * sp)) } };
            if (m === 'r') return { ...p, video: { ...p.video, trimOut: Math.max(p.video.trimIn + 0.3, p.video.trimIn + e * sp) } };
            return p;
          }, { silent: true });
        }}
      >
        <VideoThumbs url={project.sourceUrl} from={v.trimIn} to={v.trimOut} height={VIDEO_ROW_H - 6} width={D * pps} />
        {hasAudio && (
          <div className="absolute left-0 right-0 bottom-0 h-4 opacity-80">
            <Waveform url={project.sourceUrl} offset={v.trimIn} length={D} rate={v.speed} color="#6ee7b7" height={16} width={D * pps} />
          </div>
        )}
      </Clip>
    ),
  });

  rows.push({
    key: 'voices',
    label: <span className="flex items-center gap-1.5"><AudioLines size={13} />Giọng đọc</span>,
    color: '#2563eb',
    content: project.voices.map((vc) => (
      <Clip
        key={vc.id} start={vc.start} end={voiceEnd(vc)} pps={pps} height={ROW_H} snapPoints={snapPoints}
        color="#1e40af" selected={isSel(selected, 'voice', vc.id)} label={vc.text} minLen={0.2}
        onSelect={() => select({ type: 'voice', id: vc.id })}
        onChange={(m, s, e) => {
          update((p) => {
            const cur = p.voices.find((x) => x.id === vc.id);
            if (!cur) return p;
            if (m === 'move') {
              const ns = Math.max(0, Math.min(D - 0.1, s));
              const shift = ns - cur.start;
              const end0 = voiceEnd(cur);
              return {
                ...p,
                voices: p.voices.map((x) => (x.id === vc.id ? { ...x, start: ns } : x)),
                // Phụ đề sinh từ đoạn đọc này đi theo đoạn đọc
                captions: p.captions.map((c) => (c.start >= cur.start - 0.01 && c.end <= end0 + 0.4
                  ? { ...c, start: c.start + shift, end: c.end + shift, words: c.words?.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift })) }
                  : c)),
              };
            }
            // Kéo mép = cắt bớt đầu/đuôi đoạn đọc (không đổi tốc độ)
            if (m === 'l') {
              const tIn = Math.max(0, Math.min(voiceIn(cur) + voiceLen(cur) - 0.2, voiceIn(cur) + (s - cur.start)));
              return { ...p, voices: p.voices.map((x) => (x.id === vc.id ? { ...x, trimIn: tIn, start: cur.start + (tIn - voiceIn(cur)) } : x)) };
            }
            const tOut = Math.max(voiceIn(cur) + 0.2, Math.min(cur.duration, voiceIn(cur) + (e - cur.start)));
            return { ...p, voices: p.voices.map((x) => (x.id === vc.id ? { ...x, trimOut: tOut } : x)) };
          }, { silent: true });
        }}
      >
        <Waveform url={vc.url} offset={voiceIn(vc)} length={voiceLen(vc)} color="#93c5fd" height={ROW_H - 6} width={voiceLen(vc) * pps} />
      </Clip>
    )),
  });

  const b = project.bgm;
  rows.push({
    key: 'bgm',
    label: <span className="flex items-center gap-1.5"><Music size={13} />Nhạc nền</span>,
    color: '#7e22ce',
    content: b && (
      <Clip
        start={b.start} end={Math.min(D, b.end)} pps={pps} height={ROW_H} snapPoints={snapPoints}
        color="#581c87" selected={isSel(selected, 'bgm')} label={b.name}
        onSelect={() => select({ type: 'bgm' })}
        onChange={(m, s, e) => {
          update((p) => {
            if (!p.bgm) return p;
            if (m === 'move') { const [ns, ne] = clampSE(s, e); return { ...p, bgm: { ...p.bgm, start: ns, end: ne } }; }
            if (m === 'l') { const ns = Math.max(0, s); return { ...p, bgm: { ...p.bgm, start: ns, offset: Math.max(0, p.bgm.offset + (ns - p.bgm.start)) } }; }
            return { ...p, bgm: { ...p.bgm, end: Math.min(D, e) } };
          }, { silent: true });
        }}
      >
        <Waveform url={b.url} offset={b.offset} length={Math.min(D, b.end) - b.start} loop color="#d8b4fe" height={ROW_H - 6} width={(Math.min(D, b.end) - b.start) * pps} />
      </Clip>
    ),
  });

  return (
    <div className="flex flex-col min-h-0 h-full select-none">
      <div className="flex flex-1 min-h-0 overflow-y-auto overflow-x-hidden items-start">
        {/* Nhãn track */}
        <div className="flex-shrink-0 border-r border-slate-800 bg-[#121620]" style={{ width: HEADER_W }}>
          <div className="h-6 border-b border-slate-800 flex items-center px-2 text-[10px] text-slate-500 gap-2">
            <Tooltip title="Phóng to timeline (Ctrl + cuộn chuột)">
              <Slider className="!m-0 flex-1" min={1} max={40} step={0.1} value={zoom} onChange={setZoom} tooltip={{ open: false }} />
            </Tooltip>
            <Tooltip title="Vừa khung nhìn"><button type="button" className="text-slate-400 hover:text-white" onClick={() => setZoom(1)}><Maximize2 size={12} /></button></Tooltip>
          </div>
          <div className="overflow-hidden">
            {rows.map((r) => (
              <div key={r.key} className="flex items-center gap-1.5 px-2 border-b border-slate-800/70 text-[11px] text-slate-300" style={{ height: r.h || ROW_H }}>
                <span className="w-0.5 self-stretch my-2.5 rounded" style={{ background: r.color }} />
                <span className="min-w-0 flex-1 text-slate-300">{r.label}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Vùng clip */}
        <div ref={scrollRef} className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden relative" onWheel={onWheel} onPointerDown={(e) => {
          // Bấm vào chỗ trống trên track: bỏ chọn + tua đầu phát tới đó
          select(null);
          const el = scrollRef.current;
          if (el) { const r = el.getBoundingClientRect(); seek(Math.max(0, Math.min(D, (e.clientX - r.left + el.scrollLeft - 12) / pps))); }
        }}>
          <div className="relative" style={{ width: totalW, paddingLeft: 12 }}>
            <div className="h-6 border-b border-slate-800 relative cursor-pointer bg-[#121620]" onPointerDown={(e) => { e.stopPropagation(); rulerDown(e); }}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 bottom-0 border-l border-slate-700" style={{ left: t * pps }}>
                  <span className="absolute left-1 top-0.5 text-[9px] text-slate-500 font-mono">{fmtTime(t, false)}</span>
                </div>
              ))}
            </div>
            {rows.map((r) => (
              <div key={r.key} className="relative border-b border-slate-800/70" style={{ height: r.h || ROW_H }}>
                {r.content}
              </div>
            ))}
            {/* Đầu phát */}
            <div className="absolute top-0 bottom-0 w-px bg-red-500 pointer-events-none z-20" style={{ left: 12 + time * pps }}>
              <div className="absolute -left-[5px] top-0 w-[11px] h-[11px] bg-red-500 rounded-sm" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
