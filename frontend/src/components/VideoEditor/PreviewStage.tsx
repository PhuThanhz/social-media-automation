// Khung xem trước: dựng đúng như bản xuất (nền mờ + clip trong vùng khung → chuyển về clip trọn màn hình,
// khung tiêu đề, nguồn/logo, lớp chữ/ảnh, phụ đề). Tự co theo chỗ trống nên khung không bao giờ bị cắt.
// Kéo trực tiếp: chữ/ảnh (dời, phóng, xoay, đổi bề ngang), khung tiêu đề (dời), nền trống (dời clip lên/xuống), cuộn = zoom clip.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useEditor, usePlayerClock, timelineDuration } from './store';
import type { OverlayLayer, Project } from './store';
import { CANVAS_W, FONT_FACE_CSS, activeWordAt, animState, transitionStyle, captionMarkup, captionShown, captionTop, layoutFade, layoutUntil, overlayMarkup } from './layers';

export interface VideoTransform { fit: 'cover' | 'contain'; focusY: number; offsetY: number; scale: number }

interface Props {
  sourceUrl: string;
  H: number;
  frameHtml: string;
  FW: number;
  FH: number;
  brandHtml: string;
  region: { topPct: number; heightPct: number };
  vt: VideoTransform;
  onVideoTransform: (patch: Partial<VideoTransform>) => void;
  bgRef: RefObject<HTMLVideoElement | null>;
  copyRefs: Array<RefObject<HTMLVideoElement | null>>;
  showSafeZone: boolean;
  togglePlay: () => void;
}

// Font tiêu đề dùng chung cho các lớp chữ trong preview (bản xuất tự nhúng font trong HTML)
let fontInjected = false;
const ensureFont = () => {
  if (fontInjected) return;
  fontInjected = true;
  const st = document.createElement('style');
  st.textContent = FONT_FACE_CSS;
  document.head.appendChild(st);
};

const FRAME_SELECTORS = ['#box', '#band', '#panel', '#photos', '#fitbox'];

export default function PreviewStage({ sourceUrl, H, frameHtml, FW, FH, brandHtml, region, vt, onVideoTransform, bgRef, copyRefs, showSafeZone, togglePlay }: Props) {
  useEffect(ensureFont, []);
  const project = useEditor((s) => s.project) as Project;
  const update = useEditor((s) => s.update);
  const checkpoint = useEditor((s) => s.checkpoint);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  const t = usePlayerClock((s) => s.time);
  const playing = usePlayerClock((s) => s.playing);
  const D = timelineDuration(project);

  // Co khung 1080×H vừa chỗ trống
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 400, h: 700 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const s = Math.max(0.05, Math.min((box.w - 16) / CANVAS_W, (box.h - 16) / H));
  const W = CANVAS_W * s;
  const HH = H * s;

  // Bố cục video: trong lúc có khung → clip trong vùng khung; hết khung → mờ dần sang clip trọn màn hình
  const lu = layoutUntil(project);
  const xD = layoutFade(project);
  const fullP = lu >= D - 0.01 ? 0 : lu <= 0 ? 1 : Math.max(0, Math.min(1, (t - (lu - xD)) / xD));
  const tr = lu > 0 && lu < D - 0.01 ? transitionStyle(project.frame.transition || 'fade', fullP) : { style: { opacity: fullP } };
  // Mở đầu hiện dần từ đen / kết thúc tối dần
  const fi = project.fadeIn || 0;
  const fo = project.fadeOut || 0;
  const blackOp = Math.max(fi > 0 && t < fi ? 1 - t / fi : 0, fo > 0 && t > D - fo ? (t - (D - fo)) / fo : 0);
  const v = project.video;
  const eq = `brightness(${1 + v.brightness}) contrast(${v.contrast}) saturate(${v.saturation})`;

  // Đo vùng nội dung thật của khung (thẻ/dải chữ) trong iframe để bấm chọn và kéo
  const frameIframe = useRef<HTMLIFrameElement>(null);
  const frameRect = useEditor((st) => st.frameBox);
  const setFrameRect = useEditor((st) => st.setFrameBox);
  const measureFrame = () => {
    let tries = 0;
    const tick = () => {
      const doc = frameIframe.current?.contentDocument;
      const el = doc && FRAME_SELECTORS.map((q) => doc.querySelector(q)).find((x) => x && (x as HTMLElement).offsetHeight > 0) as HTMLElement | undefined;
      if (el) {
        const r = el.getBoundingClientRect();
        const k = CANVAS_W / FW;
        setFrameRect({ x: r.left * k, y: r.top * k, w: r.width * k, h: r.height * k });
      }
      if (tries++ < 12) setTimeout(tick, 250);
    };
    tick();
  };

  // Kích thước thật (chưa xoay) của từng lớp để vẽ khung chọn
  const layerEls = useRef(new Map<string, HTMLElement>());
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  useLayoutEffect(() => {
    const next: Record<string, { w: number; h: number }> = {};
    layerEls.current.forEach((el, id) => {
      const inner = el.firstElementChild as HTMLElement | null;
      if (inner) next[id] = { w: inner.offsetWidth, h: inner.offsetHeight };
    });
    const changed = Object.keys(next).length !== Object.keys(sizes).length || Object.entries(next).some(([k, v2]) => !sizes[k] || sizes[k].w !== v2.w || sizes[k].h !== v2.h);
    if (changed) setSizes(next);
  });

  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });

  const toCanvas = (dxPx: number) => dxPx / s;

  const dragGesture = (e: React.PointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onEnd?: (moved: boolean) => void) => {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const mv = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      if (!moved) { moved = true; checkpoint(); }
      onMove(toCanvas(ev.clientX - x0), toCanvas(ev.clientY - y0), ev);
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      setGuides({ v: false, h: false });
      onEnd?.(moved);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const patchLayer = (id: string, patch: Partial<OverlayLayer>) =>
    update((p) => ({ ...p, overlays: p.overlays.map((l) => (l.id === id ? ({ ...l, ...patch } as OverlayLayer) : l)) }), { silent: true });

  const moveLayer = (e: React.PointerEvent, l: OverlayLayer) => {
    select({ type: 'overlay', id: l.id });
    const sx = l.x;
    const sy = l.y;
    dragGesture(e, (dx, dy) => {
      let nx = sx + dx;
      let ny = sy + dy;
      const snapV = Math.abs(nx - CANVAS_W / 2) < 14 / s;
      const snapH = Math.abs(ny - H / 2) < 14 / s;
      if (snapV) nx = CANVAS_W / 2;
      if (snapH) ny = H / 2;
      setGuides({ v: snapV, h: snapH });
      patchLayer(l.id, { x: Math.round(nx), y: Math.round(ny) });
    });
  };

  const scaleLayer = (e: React.PointerEvent, l: OverlayLayer) => {
    const rect = wrapRef.current!.querySelector('[data-canvas]')!.getBoundingClientRect();
    const cx = rect.left + l.x * s;
    const cy = rect.top + l.y * s;
    const d0 = Math.hypot(e.clientX - cx, e.clientY - cy) || 1;
    const w0 = l.width;
    const f0 = l.kind === 'text' ? l.fontSize : 0;
    dragGesture(e, (_dx, _dy, ev) => {
      const r = Math.max(0.1, Math.hypot(ev.clientX - cx, ev.clientY - cy) / d0);
      patchLayer(l.id, l.kind === 'text' ? { width: Math.round(w0 * r), fontSize: Math.max(12, Math.round(f0 * r)) } : { width: Math.max(20, Math.round(w0 * r)) });
    });
  };

  const widthLayer = (e: React.PointerEvent, l: OverlayLayer) => {
    const w0 = l.width;
    const rad = (l.rotate * Math.PI) / 180;
    dragGesture(e, (dx, dy) => {
      const along = dx * Math.cos(rad) + dy * Math.sin(rad);
      patchLayer(l.id, { width: Math.max(60, Math.round(w0 + along * 2)) });
    });
  };

  const rotateLayer = (e: React.PointerEvent, l: OverlayLayer) => {
    const rect = wrapRef.current!.querySelector('[data-canvas]')!.getBoundingClientRect();
    const cx = rect.left + l.x * s;
    const cy = rect.top + l.y * s;
    dragGesture(e, (_dx, _dy, ev) => {
      let a = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
      if (a > 180) a -= 360;
      for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(a - snap) < 4) a = snap;
      patchLayer(l.id, { rotate: Math.round(a) });
    });
  };

  const moveFrame = (e: React.PointerEvent) => {
    select({ type: 'frame' });
    const dx0 = project.frame.dx;
    const dy0 = project.frame.dy;
    dragGesture(e, (dx, dy) => {
      let nx = dx0 + dx;
      if (Math.abs(nx) < 14 / s) nx = 0;
      setGuides({ v: nx === 0, h: false });
      update((p) => ({ ...p, frame: { ...p.frame, dx: Math.round(nx), dy: Math.round(dy0 + dy) } }), { silent: true });
    });
  };

  // Nền trống: kéo dọc = dời clip, bấm (không kéo) = phát/dừng
  const stageDown = (e: React.PointerEvent) => {
    select({ type: 'video' });
    const off0 = vt.offsetY;
    const regionPx = (H * region.heightPct) / 100;
    dragGesture(e, (_dx, dy) => {
      onVideoTransform({ offsetY: Math.max(-50, Math.min(50, Math.round(off0 + (dy / regionPx) * 100))) });
    }, (moved) => { if (!moved) togglePlay(); });
  };
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) return;
    const next = Math.max(0.5, Math.min(3, Math.round((vt.scale + (e.deltaY < 0 ? 0.05 : -0.05)) * 100) / 100));
    onVideoTransform({ scale: next });
  };

  // Có chuyển cảnh: khung nằm dưới cảnh sau (cảnh sau mở ra đè lên khung) nên không cần hiệu ứng ra riêng
  const frameUnder = lu > 0 && lu < D - 0.01;
  const frameAnim = project.frame.enabled ? animState(t, project.frame.start, project.frame.end, project.frame.inAnim, frameUnder ? 'none' : project.frame.outAnim, project.frame.animDur) : null;
  const brandAnim = project.brand.enabled && brandHtml ? animState(t, project.brand.start, project.brand.end, 'fade', 'none', 0.5) : null;
  const sel = selected;
  const fitStyle = (fit: 'cover' | 'contain') => ({ objectFit: fit, objectPosition: `center ${vt.focusY}%` } as const);

  return (
    <div ref={wrapRef} className="relative w-full h-full flex items-center justify-center overflow-hidden" onWheel={onWheel}>
      <div data-canvas className="relative overflow-hidden bg-black shadow-2xl" style={{ width: W, height: HH }} onPointerDown={stageDown}>
        {/* Nền mờ (cũng là đồng hồ chính + tiếng gốc) */}
        <video ref={bgRef} src={sourceUrl} playsInline preload="auto" className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ ...fitStyle('cover'), filter: `blur(${Math.max(6, 30 * s)}px) brightness(0.85) saturate(1.3)`, transform: 'scale(1.12)' }} />
        {/* Clip trong vùng khung */}
        {lu > 0 && (
          <video ref={copyRefs[0]} src={sourceUrl} muted playsInline preload="auto" className="absolute left-0 w-full pointer-events-none"
            style={{ top: `${region.topPct}%`, height: `${region.heightPct}%`, ...fitStyle(vt.fit), transform: `translateY(${vt.offsetY}%) scale(${vt.scale})`, filter: eq }} />
        )}
        {/* Clip trọn màn hình sau khi khung ẩn */}
        {lu < D - 0.01 && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ ...(tr.style as React.CSSProperties), zIndex: 2 }}>
            <video ref={copyRefs[1]} src={sourceUrl} muted playsInline preload="auto" className="absolute inset-0 w-full h-full"
              style={{ ...fitStyle('cover'), filter: `blur(${Math.max(6, 30 * s)}px) brightness(0.85) saturate(1.3)`, transform: 'scale(1.12)' }} />
            <video ref={copyRefs[2]} src={sourceUrl} muted playsInline preload="auto" className="absolute inset-0 w-full h-full"
              style={{ objectFit: 'contain', filter: eq }} />
          </div>
        )}

        {tr.overlay && tr.overlay.opacity > 0 && <div className="absolute inset-0 pointer-events-none" style={{ background: tr.overlay.color, opacity: tr.overlay.opacity, zIndex: 3 }} />}

        {/* Khung tiêu đề (cùng HTML với bản xuất) */}
        {project.frame.enabled && frameHtml && (
          <div className="absolute left-0 top-0 pointer-events-none"
            style={{ width: CANVAS_W, height: H, transformOrigin: 'top left', opacity: frameAnim?.opacity ?? 0, zIndex: frameUnder ? 1 : 4,
              transform: `scale(${s}) translate(${project.frame.dx + (frameAnim?.dx || 0)}px, ${project.frame.dy + (frameAnim?.dy || 0)}px)` }}>
            <iframe ref={frameIframe} title="frame" srcDoc={frameHtml} onLoad={measureFrame} className="border-0 absolute left-0 top-0"
              style={{ width: FW, height: FH, transform: `scale(${CANVAS_W / FW})`, transformOrigin: 'top left', background: 'transparent', colorScheme: 'normal' }} />
          </div>
        )}
        {brandAnim?.visible && (
          <div className="absolute left-0 top-0 pointer-events-none" style={{ width: CANVAS_W, height: H, transform: `scale(${s})`, transformOrigin: 'top left', opacity: brandAnim.opacity, zIndex: 5 }}>
            <iframe title="brand" srcDoc={brandHtml} className="border-0" style={{ width: CANVAS_W, height: H, background: 'transparent', colorScheme: 'normal' }} />
          </div>
        )}

        {/* Lớp chữ / ảnh / phụ đề trên hệ toạ độ 1080×H */}
        <div className="absolute left-0 top-0" style={{ width: CANVAS_W, height: H, transform: `scale(${s})`, transformOrigin: 'top left', pointerEvents: 'none', zIndex: 6 }}>
          {project.overlays.map((l) => {
            const isSelected = !!sel && sel.type === 'overlay' && sel.id === l.id;
            // Đang dừng mà chọn lớp → hiện rõ, đứng yên để dễ chỉnh (khi phát mới chạy hiệu ứng)
            const raw = animState(t, l.start, l.end, l.inAnim, l.outAnim, l.animDur);
            const a = isSelected && !playing && raw.visible ? { ...raw, opacity: 1, dx: 0, dy: 0 } : raw;
            if (!a.visible && !isSelected) return null;
            return (
              <div key={l.id} ref={(el) => { if (el) layerEls.current.set(l.id, el); else layerEls.current.delete(l.id); }}
                className="absolute left-0 top-0" style={{ width: CANVAS_W, height: H, opacity: a.visible ? a.opacity : 0.35, transform: `translate(${a.dx}px, ${a.dy}px)` }}
                dangerouslySetInnerHTML={{ __html: overlayMarkup(l) }} />
            );
          })}
          {project.captions.filter((c) => t >= c.start && t <= c.end && captionShown(c, project)).map((c) => (
            <div key={c.id} className="absolute left-0 top-0" style={{ width: CANVAS_W, height: H }}
              dangerouslySetInnerHTML={{ __html: captionMarkup(c, project.captionStyle, H, project.captionStyle.karaoke ? activeWordAt(c, t) : null, captionTop(c, project, H, frameRect)) }} />
          ))}
        </div>

        {blackOp > 0 && <div className="absolute inset-0 pointer-events-none bg-black" style={{ opacity: Math.min(1, blackOp), zIndex: 7 }} />}

        {/* Vùng bấm chọn + khung điều khiển (toạ độ màn hình) */}
        <div className="absolute inset-0" style={{ pointerEvents: 'none', zIndex: 8 }}>
          {project.frame.enabled && frameRect && frameAnim?.visible && (
            <div className={`absolute ${sel?.type === 'frame' ? 'outline outline-2 outline-blue-500' : 'hover:outline hover:outline-1 hover:outline-white/60'} cursor-move`}
              style={{ left: (frameRect.x + project.frame.dx) * s, top: (frameRect.y + project.frame.dy) * s, width: frameRect.w * s, height: frameRect.h * s, pointerEvents: 'auto' }}
              onPointerDown={moveFrame} />
          )}
          {project.overlays.map((l) => {
            const a = animState(t, l.start, l.end, l.inAnim, l.outAnim, l.animDur);
            const isSelected = !!sel && sel.type === 'overlay' && sel.id === l.id;
            const sz = sizes[l.id];
            if ((!a.visible && !isSelected) || !sz) return null;
            const w = sz.w * s;
            const h = sz.h * s;
            return (
              <div key={l.id} className={`absolute ${isSelected ? 'outline outline-2 outline-blue-500' : 'hover:outline hover:outline-1 hover:outline-white/60'} cursor-move`}
                style={{ left: l.x * s - w / 2, top: l.y * s - h / 2, width: w, height: h, transform: `rotate(${l.rotate}deg)`, pointerEvents: 'auto' }}
                onPointerDown={(e) => moveLayer(e, l)}>
                {isSelected && (
                  <>
                    <div title="Phóng to/thu nhỏ" className="absolute -right-2 -bottom-2 w-4 h-4 rounded-full bg-white border-2 border-blue-500 cursor-nwse-resize" onPointerDown={(e) => scaleLayer(e, l)} />
                    <div title="Đổi bề ngang" className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-6 rounded bg-white border-2 border-blue-500 cursor-ew-resize" onPointerDown={(e) => widthLayer(e, l)} />
                    <div className="absolute left-1/2 -top-6 w-px h-4 bg-blue-500" />
                    <div title="Xoay" className="absolute left-1/2 -translate-x-1/2 -top-8 w-4 h-4 rounded-full bg-white border-2 border-blue-500 cursor-grab" onPointerDown={(e) => rotateLayer(e, l)} />
                  </>
                )}
              </div>
            );
          })}
          {guides.v && <div className="absolute top-0 bottom-0 w-px bg-pink-500" style={{ left: W / 2 }} />}
          {guides.h && <div className="absolute left-0 right-0 h-px bg-pink-500" style={{ top: HH / 2 }} />}
          {showSafeZone && H > CANVAS_W * 1.5 && (
            <>
              {/* Vùng giao diện TikTok/Reels hay che: thanh trên, cột nút bên phải, caption + thanh dưới */}
              <div className="absolute left-0 right-0 top-0 border-b border-dashed border-amber-400/70 bg-amber-400/10" style={{ height: HH * 0.1 }} />
              <div className="absolute right-0 border-l border-dashed border-amber-400/70 bg-amber-400/10" style={{ top: HH * 0.38, bottom: HH * 0.2, width: W * 0.15 }} />
              <div className="absolute left-0 right-0 bottom-0 border-t border-dashed border-amber-400/70 bg-amber-400/10" style={{ height: HH * 0.2 }} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
