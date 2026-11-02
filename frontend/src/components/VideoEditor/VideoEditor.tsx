// Video Editor toàn màn hình (kiểu CapCut): cột trái thêm nội dung, giữa là preview + timeline, phải là thuộc tính.
// Một đồng hồ chung điều khiển video, giọng đọc và nhạc nền; xuất bằng /video-studio/render-project (chạy nền, có %).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Modal, Popover, Progress, Tooltip, message } from 'antd';
import {
  CaretRightOutlined, PauseOutlined, StepBackwardOutlined, UndoOutlined, RedoOutlined,
  DownloadOutlined, SendOutlined, ScissorOutlined, DeleteOutlined, ReloadOutlined,
  CloseOutlined, QuestionCircleOutlined, ThunderboltOutlined, AppstoreOutlined,
  SwapOutlined, FontSizeOutlined, CommentOutlined, SoundOutlined, PictureOutlined,
  VideoCameraOutlined, BorderOutlined,
} from '@ant-design/icons';
import api from '../../config/axios';
import { buildCaptions, DEFAULT_CAPTION_STYLE, newId, timelineDuration, useEditor, usePlayerClock, voiceEnd, voiceIn } from './store';
import type { Anim, OverlayLayer, Project, VoiceClip } from './store';
import PreviewStage from './PreviewStage';
import type { VideoTransform } from './PreviewStage';
import Timeline, { fmtTime } from './Timeline';
import { AI_QUICK, AiKeyBanner, AiPanel, Inspector, LeftPanel } from './Panels';
import type { LeftTab, PanelDeps } from './Panels';
import { buildRenderPayload } from './layers';
import { removeVoice, splitVoiceAt } from './actions';
import TikTokPublish from './TikTokPublish';

export interface EditorSource { url: string; duration: number; width: number; height: number; hasAudio: boolean; title: string }

export interface EditorDefaults {
  introSeconds: number; // 0 = khung hiện suốt video
  transitionEffect: string;
  keepBrand: boolean;
  voice: { url: string; duration: number; text: string; voice: string; engine: string } | null;
  voiceText: string;
  voiceName: string;
  music: { url: string; name: string } | null;
  musicVolume: number; // 0–100
  originalVolume: number;
  duckVolume: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  source: EditorSource;
  ratio: string;
  H: number;
  frameHtml: string;
  FW: number;
  FH: number;
  brandHtml: string;
  region: { topPct: number; heightPct: number };
  vt: VideoTransform;
  onVideoTransform: (patch: Partial<VideoTransform>) => void;
  framePanel: ReactNode;
  defaults: EditorDefaults;
  bgmPresets: Array<{ url: string; name: string }>;
  logos: Array<{ name: string; url: string }>;
  uploadFile: (f: File) => Promise<string>;
  apiKey: () => string;
  downloadName: string;
  onExported: (url: string) => void;
  onSendToPoster: (url: string) => void;
  headline: string;
  postCaption: string;
  onHeadline: (h: string) => void;
  onPostCaption: (c: string) => void;
  /** Mở editor xong thì AI tự làm trọn gói (nút "AI làm trọn gói" ở trang Studio) */
  autoAgent?: boolean;
  onAutoAgentDone?: () => void;
}

const PROJECT_KEY = (url: string) => `videoEditor.project:${url}`;

const mapTransition = (t: string): Anim => (t === 'slideup' ? 'slideup' : t === 'wipeleft' ? 'slideleft' : t === 'fade' || t === 'zoomin' ? 'fade' : 'slidedown');

function createProject(src: EditorSource, d: EditorDefaults, hasBrand: boolean): Project {
  const D = Math.max(0.5, src.duration || 10);
  const voices: VoiceClip[] = d.voice ? [{ id: newId(), url: d.voice.url, duration: d.voice.duration, text: d.voice.text, voice: d.voice.voice, engine: d.voice.engine, rate: 0, pitch: 0, start: 0.3, volume: 1.6 }] : [];
  const frameEnd = d.introSeconds <= 0 ? D : Math.min(D, d.voice ? Math.max(d.introSeconds, 0.3 + d.voice.duration + 0.4) : d.introSeconds);
  return {
    version: 1,
    sourceUrl: src.url,
    video: { trimIn: 0, trimOut: D, speed: 1, volume: d.originalVolume / 100, duckVolume: d.duckVolume / 100, brightness: 0, contrast: 1, saturation: 1 },
    frame: { enabled: true, start: 0, end: frameEnd, inAnim: 'none', outAnim: mapTransition(d.transitionEffect), animDur: Math.min(1, Math.max(0.6, frameEnd / 3)), dx: 0, dy: 0, keepLayoutAfter: false },
    brand: { enabled: hasBrand && d.keepBrand && frameEnd < D - 0.05, start: frameEnd, end: D },
    overlays: [],
    captions: buildCaptions(voices, DEFAULT_CAPTION_STYLE.maxWords),
    captionStyle: { ...DEFAULT_CAPTION_STYLE, enabled: false, captionsOff2: true },
    voices,
    bgm: d.music ? { url: d.music.url, name: d.music.name, start: 0, end: D, offset: 0, volume: d.musicVolume / 100, fadeIn: 0.8, fadeOut: 1.5 } : null,
  };
}

const LEFT_TABS: Array<{ value: LeftTab; label: string; icon: ReactNode }> = [
  { value: 'ai', label: 'AI', icon: <ThunderboltOutlined className="text-base" /> },
  { value: 'frame', label: 'Khung', icon: <AppstoreOutlined className="text-base" /> },
  { value: 'transition', label: 'Chuyển cảnh', icon: <SwapOutlined className="text-base" /> },
  { value: 'text', label: 'Chữ', icon: <FontSizeOutlined className="text-base" /> },
  { value: 'captions', label: 'Phụ đề', icon: <CommentOutlined className="text-base" /> },
  { value: 'audio', label: 'Âm thanh', icon: <SoundOutlined className="text-base" /> },
  { value: 'image', label: 'Ảnh', icon: <PictureOutlined className="text-base" /> },
  { value: 'video', label: 'Video', icon: <VideoCameraOutlined className="text-base" /> },
];

const SHORTCUTS = [['Space', 'Phát / dừng'], ['← →', '1 khung hình'], ['Shift + ← →', '1 giây'], ['S', 'Tách tại đầu phát'], ['Delete', 'Xoá'], ['⌘/Ctrl + Z', 'Hoàn tác'], ['⌘/Ctrl + Shift + Z', 'Làm lại'], ['⌘/Ctrl + D', 'Nhân bản'], ['Ctrl + cuộn', 'Phóng timeline']];

export default function VideoEditor(props: Props) {
  const { open, onClose, source, defaults } = props;
  const project = useEditor((s) => s.project);
  const load = useEditor((s) => s.load);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const update = useEditor((s) => s.update);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  const time = usePlayerClock((s) => s.time);
  const playing = usePlayerClock((s) => s.playing);
  const [tab, setTab] = useState<LeftTab>(props.autoAgent ? 'ai' : 'frame');
  const [safeZone, setSafeZone] = useState(false);
  useEffect(() => { if (open && props.autoAgent) setTab('ai'); }, [open, props.autoAgent]);

  // Nạp dự án đã lưu của clip này (hoặc tạo mới từ thiết lập trang Studio)
  useEffect(() => {
    if (!open) return;
    let p: Project | null = null;
    try {
      const raw = JSON.parse(localStorage.getItem(PROJECT_KEY(source.url)) || 'null');
      if (raw && raw.version === 1 && raw.sourceUrl === source.url) {
        p = raw as Project;
        // Mặc định chỉ hiện chữ tiêu đề: dự án lưu từ trước đang bật phụ đề thì tắt đi 1 lần (bật lại ở tab Phụ đề)
        if (!p.captionStyle.captionsOff2) p = { ...p, captionStyle: { ...p.captionStyle, enabled: false, captionsOff2: true } };
      }
    } catch { /* hỏng → tạo mới */ }
    load(p || createProject(source, defaults, !!props.brandHtml));
    usePlayerClock.getState().setTime(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source.url]);

  // Tự lưu
  useEffect(() => {
    if (!project || !open) return;
    const id = setTimeout(() => { try { localStorage.setItem(PROJECT_KEY(project.sourceUrl), JSON.stringify(project)); } catch { /* đầy bộ nhớ */ } }, 400);
    return () => clearTimeout(id);
  }, [project, open]);

  const resetProject = () => {
    Modal.confirm({
      title: 'Làm lại dự án từ đầu?',
      content: 'Xoá chữ, phụ đề, đoạn đọc và thời gian đã chỉnh trong editor cho clip này (thiết lập khung ở trang Studio giữ nguyên).',
      okText: 'Làm lại', cancelText: 'Huỷ', okButtonProps: { danger: true },
      onOk: () => { localStorage.removeItem(PROJECT_KEY(source.url)); load(createProject(source, defaults, !!props.brandHtml)); },
    });
  };

  // ── Phát ──
  const bgRef = useRef<HTMLVideoElement>(null);
  const r1 = useRef<HTMLVideoElement>(null);
  const r2 = useRef<HTMLVideoElement>(null);
  const r3 = useRef<HTMLVideoElement>(null);
  const copyRefs = useMemo(() => [r1, r2, r3], []);
  const voiceEls = useRef(new Map<string, HTMLAudioElement>());
  const bgmEl = useRef<HTMLAudioElement | null>(null);
  const projRef = useRef(project);
  projRef.current = project;

  const copies = () => copyRefs.map((r) => r.current).filter((x): x is HTMLVideoElement => !!x);

  const syncAudio = useCallback((T: number, isPlaying: boolean) => {
    const p = projRef.current;
    if (!p) return;
    let voiceActive = false;
    for (const v of p.voices) {
      let el = voiceEls.current.get(v.id);
      if (!el || el.dataset.src !== v.url) {
        el?.pause();
        el = new Audio(v.url);
        el.dataset.src = v.url;
        el.preload = 'auto';
        voiceEls.current.set(v.id, el);
      }
      const inside = T >= v.start && T < voiceEnd(v);
      const local = T - v.start + voiceIn(v);
      if (T >= v.start && T < voiceEnd(v) + 0.2) voiceActive = true;
      el.volume = Math.min(1, v.volume / 1.6);
      if (inside && isPlaying) {
        if (Math.abs(el.currentTime - local) > 0.2) el.currentTime = local;
        if (el.paused) el.play().catch(() => {});
      } else if (!el.paused) el.pause();
    }
    for (const [id, el] of voiceEls.current) if (!p.voices.some((v) => v.id === id)) { el.pause(); voiceEls.current.delete(id); }

    const b = p.bgm;
    if (b) {
      if (!bgmEl.current || bgmEl.current.dataset.src !== b.url) {
        bgmEl.current?.pause();
        bgmEl.current = new Audio(b.url);
        bgmEl.current.dataset.src = b.url;
        bgmEl.current.preload = 'auto';
      }
      const el = bgmEl.current;
      const inside = T >= b.start && T < b.end;
      if (inside && isPlaying) {
        const len = el.duration || Infinity;
        const local = b.offset + (T - b.start);
        const want = Number.isFinite(len) ? local % len : local;
        if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = want;
        const k = Math.min(1, b.fadeIn > 0 ? (T - b.start) / b.fadeIn : 1, b.fadeOut > 0 ? (b.end - T) / b.fadeOut : 1);
        el.volume = Math.max(0, Math.min(1, b.volume * k));
        if (el.paused) el.play().catch(() => {});
      } else if (!el.paused) el.pause();
    } else if (bgmEl.current) { bgmEl.current.pause(); bgmEl.current = null; }

    const bg = bgRef.current;
    if (bg) bg.volume = Math.max(0, Math.min(1, voiceActive ? p.video.duckVolume : p.video.volume));
  }, []);

  const seek = useCallback((T: number) => {
    const p = projRef.current;
    if (!p) return;
    const D = timelineDuration(p);
    const t = Math.max(0, Math.min(D, T));
    usePlayerClock.getState().setTime(t);
    const st = p.video.trimIn + t * p.video.speed;
    [bgRef.current, ...copies()].forEach((v) => { if (v) v.currentTime = st; });
    syncAudio(t, usePlayerClock.getState().playing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncAudio]);

  const pause = useCallback(() => {
    usePlayerClock.getState().setPlaying(false);
    [bgRef.current, ...copies()].forEach((v) => v?.pause());
    voiceEls.current.forEach((el) => el.pause());
    bgmEl.current?.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const play = useCallback(() => {
    const p = projRef.current;
    if (!p) return;
    const D = timelineDuration(p);
    if (usePlayerClock.getState().time >= D - 0.05) seek(0);
    usePlayerClock.getState().setPlaying(true);
    [bgRef.current, ...copies()].forEach((v) => { if (v) { v.playbackRate = p.video.speed; v.play().catch(() => {}); } });
    syncAudio(usePlayerClock.getState().time, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seek, syncAudio]);

  const togglePlay = useCallback(() => (usePlayerClock.getState().playing ? pause() : play()), [play, pause]);

  // Vòng đồng hồ: lấy thời gian từ video nền, kéo các bản sao + âm thanh theo
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      const p = projRef.current;
      const bg = bgRef.current;
      if (p && bg) {
        const D = timelineDuration(p);
        const T = (bg.currentTime - p.video.trimIn) / p.video.speed;
        if (T >= D || bg.ended) {
          pause();
          seek(D);
          return;
        }
        usePlayerClock.getState().setTime(Math.max(0, T));
        copies().forEach((c) => {
          if (Math.abs(c.currentTime - bg.currentTime) > 0.12) c.currentTime = bg.currentTime;
          if (c.paused) c.play().catch(() => {});
          c.playbackRate = p.video.speed;
        });
        syncAudio(Math.max(0, T), true);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, pause, seek, syncAudio]);

  // Đổi cắt/tốc độ → giữ khung hình đang xem đúng vị trí mới
  useEffect(() => {
    if (!project) return;
    if (!usePlayerClock.getState().playing) seek(Math.min(usePlayerClock.getState().time, timelineDuration(project)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.video.trimIn, project?.video.trimOut, project?.video.speed]);

  // Video copy vừa gắn vào (khung bật/tắt) → tua về đúng chỗ
  useEffect(() => {
    const id = setTimeout(() => seek(usePlayerClock.getState().time), 50);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.frame.enabled, project?.frame.keepLayoutAfter]);

  // Đóng editor → dừng hết âm thanh
  useEffect(() => {
    if (open) return;
    pause();
    voiceEls.current.forEach((el) => el.pause());
    voiceEls.current.clear();
  }, [open, pause]);

  // ── Thao tác nhanh ──
  const deleteSelected = useCallback(() => {
    const sel = useEditor.getState().selected;
    if (!sel) return;
    if (sel.type === 'overlay') update((p) => ({ ...p, overlays: p.overlays.filter((x) => x.id !== sel.id) }));
    else if (sel.type === 'caption') update((p) => ({ ...p, captions: p.captions.filter((x) => x.id !== sel.id) }));
    else if (sel.type === 'voice') removeVoice(sel.id);
    else if (sel.type === 'bgm') update((p) => ({ ...p, bgm: null }));
    else if (sel.type === 'frame') update((p) => ({ ...p, frame: { ...p.frame, enabled: false } }));
    else if (sel.type === 'brand') update((p) => ({ ...p, brand: { ...p.brand, enabled: false } }));
    else return;
    select(null);
  }, [update, select]);

  const splitSelected = useCallback(() => {
    const sel = useEditor.getState().selected;
    const t = usePlayerClock.getState().time;
    if (sel?.type === 'voice') { splitVoiceAt(sel.id, t); return; }
    if (sel?.type === 'overlay') {
      update((p) => {
        const l = p.overlays.find((x) => x.id === sel.id);
        if (!l || t <= l.start + 0.05 || t >= l.end - 0.05) return p;
        const right: OverlayLayer = { ...l, id: newId(), start: t };
        return { ...p, overlays: p.overlays.flatMap((x) => (x.id === l.id ? [{ ...x, end: t }, right] : [x])) };
      });
    } else if (sel?.type === 'caption') {
      update((p) => {
        const c = p.captions.find((x) => x.id === sel.id);
        if (!c || t <= c.start + 0.05 || t >= c.end - 0.05) return p;
        const lw = c.words?.filter((w) => w.start < t) || [];
        const rw = c.words?.filter((w) => w.start >= t) || [];
        const toks = c.text.split(/\s+/).filter(Boolean);
        const k = c.words?.length ? lw.length : Math.round((toks.length * (t - c.start)) / (c.end - c.start));
        const left = { ...c, end: t, text: toks.slice(0, k).join(' ') || c.text, words: c.words ? lw : undefined };
        const right = { ...c, id: newId(), start: t, text: toks.slice(k).join(' ') || c.text, words: c.words ? rw : undefined };
        return { ...p, captions: p.captions.flatMap((x) => (x.id === c.id ? [left, right] : [x])) };
      });
    } else {
      message.info('Chọn chữ, phụ đề hoặc giọng đọc để tách');
    }
  }, [update]);

  // Phím tắt
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      const p = projRef.current;
      if (!p) return;
      // Space trên nút đang focus sẽ "bấm" nút đó lúc nhả phím → bỏ focus để không bị bật/tắt 2 lần
      if (e.code === 'Space') { e.preventDefault(); if (el?.tagName === 'BUTTON') el.blur(); togglePlay(); }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const sel = useEditor.getState().selected;
        if (sel?.type === 'overlay') {
          const l = p.overlays.find((x) => x.id === sel.id);
          if (l) { const c = { ...l, id: newId(), x: l.x + 30, y: l.y + 30 }; update((pp) => ({ ...pp, overlays: [...pp.overlays, c] })); select({ type: 'overlay', id: c.id }); }
        }
      }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = (e.shiftKey ? 1 : 1 / 30) * (e.key === 'ArrowLeft' ? -1 : 1);
        seek(usePlayerClock.getState().time + step);
      }
      else if (e.key === 'Home') seek(0);
      else if (e.key === 'End') seek(timelineDuration(p));
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
      else if (!mod && e.key.toLowerCase() === 's') splitSelected();
      else if (e.key === 'Escape') select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, togglePlay, undo, redo, seek, deleteSelected, splitSelected, update, select]);

  // ── Giọng đọc ──
  const makeVoice: PanelDeps['makeVoice'] = async (text, voice, rate, pitch) => {
    try {
      const res = await api.post('/video-studio/tts', {
        text, voice, apiKey: props.apiKey(),
        rate: `${rate >= 0 ? '+' : ''}${rate}%`, pitch: `${pitch >= 0 ? '+' : ''}${pitch}Hz`,
      }, { timeout: 180000 });
      if (!res.data?.success) throw new Error(res.data?.error);
      return { url: res.data.url, duration: res.data.duration, engine: res.data.engine, text, voice, rate, pitch, words: Array.isArray(res.data.words) && res.data.words.length ? res.data.words : undefined };
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      message.error('Tạo giọng đọc lỗi: ' + (err?.response?.data?.error || err?.message));
      return null;
    }
  };

  // ── Xuất ──
  const [exportState, setExportState] = useState<{ open: boolean; progress: number; stage: string; url: string; error: string }>({ open: false, progress: 0, stage: '', url: '', error: '' });
  const exportVideo = async () => {
    if (!project) return;
    pause();
    setExportState({ open: true, progress: 0, stage: 'Đang gửi dự án', url: '', error: '' });
    try {
      const payload = buildRenderPayload({
        project, frameBox: useEditor.getState().frameBox, ratio: props.ratio, H: props.H, frameHtml: props.frameHtml, brandHtml: props.brandHtml, region: props.region,
        videoFit: props.vt.fit, videoFocusY: props.vt.focusY, videoOffsetY: props.vt.offsetY, videoScale: props.vt.scale,
      });
      const res = await api.post('/video-studio/render-project', payload, { timeout: 60000 });
      if (!res.data?.success) throw new Error(res.data?.error);
      const jobId = res.data.jobId as string;
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const st = await api.get(`/video-studio/render-project/${jobId}`, { timeout: 20000 });
        const j = st.data || {};
        if (j.status === 'done') {
          setExportState((s) => ({ ...s, progress: 1, stage: 'Xong', url: j.url }));
          props.onExported(j.url);
          return;
        }
        if (j.status === 'error') throw new Error(j.error || 'Xuất lỗi');
        setExportState((s) => ({ ...s, progress: Number(j.progress) || 0, stage: j.stage || s.stage }));
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setExportState((s) => ({ ...s, error: err?.response?.data?.error || err?.message || 'Xuất lỗi' }));
    }
  };
  const download = async (url: string) => {
    const res = await fetch(url);
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = href;
    a.download = `${props.downloadName || 'video'}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
  };

  const deps: PanelDeps = {
    H: props.H,
    hasAudio: source.hasAudio,
    sourceUrl: source.url,
    sourceTitle: source.title,
    sourceDuration: source.duration,
    headline: props.headline,
    postCaption: props.postCaption,
    onHeadline: props.onHeadline,
    onPostCaption: props.onPostCaption,
    apiKey: props.apiKey,
    framePanel: props.framePanel,
    frameAvailable: !!props.frameHtml,
    brandAvailable: !!props.brandHtml,
    bgmPresets: props.bgmPresets,
    logos: props.logos,
    defaultVoiceText: defaults.voiceText,
    defaultVoiceName: defaults.voiceName,
    uploadFile: props.uploadFile,
    makeVoice,
    vt: props.vt,
    onVideoTransform: props.onVideoTransform,
    seek,
    seekAndPlay: (t: number) => { seek(t); setTimeout(play, 60); },
  };

  const D = project ? timelineDuration(project) : 0;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width="100vw"
      destroyOnHidden
      style={{ top: 0, padding: 0, maxWidth: '100vw' }}
      styles={{ body: { padding: 0, height: '100vh', overflow: 'hidden', background: '#0f1117' }, mask: { background: 'rgba(0,0,0,0.92)' } }}
      modalRender={(node) => <div style={{ height: '100vh' }}>{node}</div>}
      keyboard={false}
    >
      {project && (
        <div className="flex flex-col h-screen bg-[#0f1117] text-white">
          {/* Thanh trên */}
          <div className="flex items-center gap-2 px-3 h-11 border-b border-slate-800 bg-[#161b27] flex-shrink-0">
            <span className="text-[13px] font-semibold pl-1">Video Editor</span>
            <span className="text-[11px] text-slate-500 truncate max-w-[28vw]">{source.title}</span>
            <div className="flex items-center ml-2">
              <Tooltip title="Hoàn tác"><Button size="small" type="text" icon={<UndoOutlined />} disabled={!canUndo} onClick={undo} /></Tooltip>
              <Tooltip title="Làm lại"><Button size="small" type="text" icon={<RedoOutlined />} disabled={!canRedo} onClick={redo} /></Tooltip>
              <Tooltip title="Làm lại dự án từ đầu"><Button size="small" type="text" icon={<ReloadOutlined />} onClick={resetProject} /></Tooltip>
            </div>
            <div className="flex-1" />
            <Tooltip title="Hiện vùng bị giao diện TikTok/Reels che">
              <Button size="small" type={safeZone ? 'primary' : 'text'} ghost={safeZone} icon={<BorderOutlined className="text-sm" />} onClick={() => setSafeZone((x) => !x)} />
            </Tooltip>
            <Popover placement="bottomRight" title="Phím tắt" content={
              <div className="space-y-1 text-[12px] min-w-[220px]">{SHORTCUTS.map(([k, d]) => <div key={k} className="flex justify-between gap-4"><span className="font-mono">{k}</span><span className="text-slate-400">{d}</span></div>)}</div>
            }>
              <Button size="small" type="text" icon={<QuestionCircleOutlined />} />
            </Popover>
            <Button size="small" type="primary" icon={<DownloadOutlined />} onClick={exportVideo}>Xuất video</Button>
            <Tooltip title="Đóng"><Button size="small" type="text" icon={<CloseOutlined />} onClick={onClose} /></Tooltip>
          </div>

          <div className="flex flex-1 min-h-0">
            {/* Thanh icon */}
            <div className="w-[64px] flex-shrink-0 bg-[#121620] border-r border-slate-800 flex flex-col items-center py-2 gap-1">
              {LEFT_TABS.map((t) => (
                <button key={t.value} type="button" onClick={() => setTab(t.value)}
                  className={`w-[54px] h-[50px] rounded-md flex flex-col items-center justify-center gap-1 text-[10px] transition-colors ${tab === t.value ? 'bg-blue-600/20 text-blue-300' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'}`}>
                  {t.icon}
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
            {/* Trái */}
            <div className="w-[330px] flex-shrink-0 border-r border-slate-800 bg-[#161b27] flex flex-col min-h-0">
              <div className="h-10 flex items-center px-4 text-[13px] font-semibold border-b border-slate-800/80 flex-shrink-0">
                {tab === 'ai' ? 'Trợ lý AI (Gemini)' : LEFT_TABS.find((t) => t.value === tab)?.label}
              </div>
              <div className={`flex-1 min-h-0 p-4 text-[12px] ${tab === 'ai' ? 'flex flex-col' : 'overflow-y-auto'}`}>
                <AiKeyBanner apiKey={props.apiKey} />
                {/* Giữ panel AI luôn gắn để không mất lịch sử chat khi đổi tab */}
                <div className={tab === 'ai' ? 'flex-1 min-h-0' : 'hidden'}>
                  <AiPanel deps={deps} autoPrompt={props.autoAgent ? AI_QUICK[0].prompt : undefined} onAutoDone={props.onAutoAgentDone} />
                </div>
                {tab !== 'ai' && <LeftPanel tab={tab} deps={deps} />}
              </div>
            </div>

            {/* Giữa */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex-1 min-h-0 bg-[#0a0c11]">
                <PreviewStage
                  sourceUrl={source.url} H={props.H} frameHtml={props.frameHtml} FW={props.FW} FH={props.FH} brandHtml={props.brandHtml}
                  region={props.region} vt={props.vt} onVideoTransform={props.onVideoTransform}
                  bgRef={bgRef} copyRefs={copyRefs} showSafeZone={safeZone} togglePlay={togglePlay}
                />
              </div>
              {/* Điều khiển phát */}
              <div className="flex items-center gap-1 px-3 h-10 border-y border-slate-800 bg-[#161b27] flex-shrink-0">
                <Tooltip title="Tách tại đầu phát (S)"><Button size="small" type="text" icon={<ScissorOutlined />} onClick={splitSelected} /></Tooltip>
                <Tooltip title="Xoá (Delete)"><Button size="small" type="text" icon={<DeleteOutlined />} disabled={!selected || selected.type === 'video' || selected.type === 'captions'} onClick={deleteSelected} /></Tooltip>
                <div className="flex-1 flex items-center justify-center gap-2">
                  <Tooltip title="Về đầu"><Button size="small" type="text" icon={<StepBackwardOutlined />} onClick={() => seek(0)} /></Tooltip>
                  <Button size="small" type="primary" shape="circle" icon={playing ? <PauseOutlined /> : <CaretRightOutlined />} onClick={togglePlay} />
                  <span className="font-mono text-[12px] text-slate-300 whitespace-nowrap min-w-[120px]">{fmtTime(time)} <span className="text-slate-500">/ {fmtTime(D)}</span></span>
                </div>
                <div className="w-[60px]" />
              </div>
              <div className="h-[290px] flex-shrink-0 bg-[#0f1117]">
                <Timeline hasAudio={source.hasAudio} seek={seek} />
              </div>
            </div>

            {/* Phải */}
            <div className="w-[290px] flex-shrink-0 border-l border-slate-800 bg-[#161b27] flex flex-col min-h-0">
              <div className="h-10 flex items-center px-4 text-[13px] font-semibold border-b border-slate-800/80 flex-shrink-0">Thuộc tính</div>
              <div className="flex-1 min-h-0 overflow-y-auto p-4 text-[12px]"><Inspector deps={deps} /></div>
            </div>
          </div>
        </div>
      )}

      <Modal open={exportState.open} footer={null} title="Xuất video" closable={!!exportState.url || !!exportState.error} maskClosable={false}
        onCancel={() => setExportState((s) => ({ ...s, open: false }))} width={440}>
        {exportState.error ? (
          <div className="space-y-3">
            <div className="text-red-400 text-[13px] break-words">{exportState.error}</div>
            <Button type="primary" onClick={exportVideo}>Thử lại</Button>
          </div>
        ) : exportState.url ? (
          <div className="space-y-3">
            <video src={exportState.url} controls className="w-full max-h-[42vh] rounded bg-black" />
            <div className="flex gap-2">
              <Button type="primary" icon={<DownloadOutlined />} onClick={() => download(exportState.url)}>Tải về máy</Button>
              <Button icon={<SendOutlined />} onClick={() => props.onSendToPoster(exportState.url)}>Chuyển sang lịch đăng</Button>
            </div>
            <TikTokPublish videoUrl={exportState.url} defaultCaption={props.postCaption} onOpenConnections={() => window.open('/dashboard/connections', '_blank')} />
          </div>
        ) : (
          <div className="space-y-2">
            <Progress percent={Math.round(exportState.progress * 100)} status="active" />
            <div className="text-[12px] text-slate-400">{exportState.stage}</div>
          </div>
        )}
      </Modal>
    </Modal>
  );
}
