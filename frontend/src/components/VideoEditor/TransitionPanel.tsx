// Bảng chọn chuyển cảnh (kiểu CapCut): ô xem trước động cho từng hiệu ứng, thời lượng, xem thử ngay trên video;
// kèm mở đầu hiện dần từ đen / kết thúc tối dần.
import { useEffect, useState } from 'react';
import { Button, Slider, Switch } from 'antd';
import { Play } from 'lucide-react';
import { timelineDuration, useEditor } from './store';
import type { Project } from './store';
import { TRANSITIONS, frameOutFor, layoutFade, layoutUntil, transitionStyle } from './layers';

/** Ô minh hoạ: cảnh A (khung tím) chuyển sang cảnh B (video) — chạy lặp khi rê chuột hoặc đang chọn */
function Tile({ value, label, active, onClick }: { value: string; label: string; active: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const [p, setP] = useState(0.55);
  const run = hover || active;
  useEffect(() => {
    if (!run) { setP(0.55); return; }
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const c = ((now - t0) / 1800) % 1; // 0.2s giữ A, 1s chuyển, 0.6s giữ B
      setP(c < 0.12 ? 0 : c > 0.7 ? 1 : (c - 0.12) / 0.58);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [run]);
  const tr = transitionStyle(value, p);
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="group flex flex-col items-center gap-1">
      <span className={`relative w-full aspect-[4/5] rounded-md overflow-hidden border-2 transition ${active ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-transparent group-hover:border-slate-500'}`}>
        {/* Cảnh A: video + khung tiêu đề */}
        <span className="absolute inset-0" style={{ background: 'linear-gradient(160deg,#4b5563,#1f2937)' }} />
        <span className="absolute left-[18%] right-[18%] top-[40%] h-[22%] rounded-[3px] bg-[#24132f] border border-white/70" />
        <span className="absolute inset-x-0 bottom-0 h-[35%]" style={{ background: 'linear-gradient(to bottom, transparent, rgba(180,75,224,.8))' }} />
        {/* Cảnh B: clip trọn màn hình */}
        <span className="absolute inset-0" style={tr.style as React.CSSProperties}>
          <span className="absolute inset-0" style={{ background: 'linear-gradient(200deg,#0ea5e9,#0f766e)' }} />
          <span className="absolute left-[30%] top-[30%] w-[40%] h-[40%] rounded-full bg-amber-300/80" />
        </span>
        {tr.overlay && tr.overlay.opacity > 0 && <span className="absolute inset-0" style={{ background: tr.overlay.color, opacity: tr.overlay.opacity }} />}
      </span>
      <span className={`text-[10px] leading-tight text-center ${active ? 'text-blue-300' : 'text-slate-400'}`}>{label}</span>
    </button>
  );
}

export default function TransitionPanel({ seekAndPlay }: { seekAndPlay: (t: number) => void }) {
  const p = useEditor((s) => s.project) as Project;
  const update = useEditor((s) => s.update);
  const D = timelineDuration(p);
  const lu = layoutUntil(p);
  const hasJunction = lu > 0 && lu < D - 0.05;
  const cur = p.frame.transition || 'fade';
  const dur = layoutFade(p);

  const apply = (value: string, d = dur) =>
    update((pp) => ({ ...pp, frame: { ...pp.frame, transition: value, transitionDur: d, outAnim: frameOutFor(value), animDur: Math.max(0.2, d) } }), { key: 'transition' });

  const groups = Array.from(new Set(TRANSITIONS.map((t) => t.group)));

  return (
    <div className="space-y-5">
      {!hasJunction ? (
        <div className="rounded-md border border-slate-700 p-3 space-y-2 text-[12px] text-slate-300">
          <div>Khung tiêu đề đang hiện suốt video nên chưa có chỗ chuyển cảnh.</div>
          <Button size="small" type="primary" onClick={() => update((pp) => ({ ...pp, frame: { ...pp.frame, enabled: true, keepLayoutAfter: false, end: Math.min(D - 0.5, 5) } }))}>Cho khung ẩn sau 5 giây</Button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Khi khung ẩn lúc <span className="font-mono text-slate-200">{lu.toFixed(1)}s</span></span>
            <Button size="small" type="text" icon={<Play size={12} />} onClick={() => seekAndPlay(Math.max(0, lu - dur - 0.8))}>Xem thử</Button>
          </div>
          {groups.map((g) => (
            <section key={g}>
              <div className="text-[11px] text-slate-400 mb-1.5">{g}</div>
              <div className="grid grid-cols-4 gap-2">
                {TRANSITIONS.filter((t) => t.group === g).map((t) => (
                  <Tile key={t.value} value={t.value} label={t.label} active={cur === t.value} onClick={() => apply(t.value)} />
                ))}
              </div>
            </section>
          ))}
          {cur !== 'none' && (
            <section>
              <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1"><span>Thời lượng chuyển</span><span className="font-mono text-slate-200">{dur.toFixed(1)}s</span></div>
              <Slider className="!my-0" min={0.2} max={2} step={0.1} value={dur} onChange={(v) => apply(cur, v)} tooltip={{ open: false }} />
            </section>
          )}
        </>
      )}

      <section className="pt-3 border-t border-slate-800/80 space-y-3">
        <div className="text-[12px] font-semibold text-slate-100">Mở đầu và kết thúc</div>
        {([['fadeIn', 'Hiện dần từ màu đen'], ['fadeOut', 'Tối dần khi kết thúc']] as const).map(([k, label]) => (
          <div key={k}>
            <div className="flex items-center justify-between text-[12px] text-slate-300">
              <span>{label}</span>
              <Switch size="small" checked={(p[k] || 0) > 0} onChange={(on) => update((pp) => ({ ...pp, [k]: on ? 0.8 : 0 }))} />
            </div>
            {(p[k] || 0) > 0 && (
              <Slider className="!mt-1 !mb-0" min={0.2} max={3} step={0.1} value={p[k]} onChange={(v) => update((pp) => ({ ...pp, [k]: v }), { key: k })}
                tooltip={{ formatter: (v) => `${v}s` }} />
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
