// Cột trái (thêm nội dung theo tab) và cột phải (thuộc tính phần tử đang chọn). Giữ chữ ít: nhãn ngắn,
// phần ít dùng gom vào mục "Tuỳ chỉnh" thu gọn.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import AiSettingsModal from '../modals/AiSettingsModal';
import { Alert, Button, Collapse, ColorPicker, Input, InputNumber, Segmented, Select, Slider, Switch, Tooltip, Upload, message } from 'antd';
import { DeleteOutlined, PlusOutlined, UploadOutlined, CopyOutlined, ArrowUpOutlined, ArrowDownOutlined, ScissorOutlined, SendOutlined, LoadingOutlined } from '@ant-design/icons';
import { Pause, Play, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
import api from '../../config/axios';
import { ANIM_OPTIONS, CAPTION_PRESETS, buildCaptions, newId, timelineDuration, useEditor, usePlayerClock, voiceEnd, voiceLen } from './store';
import type { Anim, Caption, ImageLayer, OverlayLayer, Project, TextLayer, VoiceClip } from './store';
import type { VideoTransform } from './PreviewStage';
import { CANVAS_W } from './layers';
import { VOICES, ENGINE_LABEL } from './voices';
import { fmtTime } from './Timeline';
import { TEXT_PRESETS, aiContext, applyAiActions, makeTextLayer, placeVoice, removeVoice, splitVoiceAt } from './actions';
import type { AiAction, NewVoice } from './actions';
import TransitionPanel from './TransitionPanel';

const { TextArea } = Input;

export interface PanelDeps {
  H: number;
  hasAudio: boolean;
  sourceUrl: string;
  sourceTitle: string;
  sourceDuration: number;
  framePanel: ReactNode;
  frameAvailable: boolean;
  brandAvailable: boolean;
  bgmPresets: Array<{ url: string; name: string }>;
  logos: Array<{ name: string; url: string }>;
  defaultVoiceText: string;
  defaultVoiceName: string;
  headline: string;
  postCaption: string;
  onHeadline: (h: string) => void;
  onPostCaption: (c: string) => void;
  apiKey: () => string;
  uploadFile: (f: File) => Promise<string>;
  makeVoice: (text: string, voice: string, rate: number, pitch: number) => Promise<NewVoice | null>;
  vt: VideoTransform;
  onVideoTransform: (patch: Partial<VideoTransform>) => void;
  seek: (t: number) => void;
  seekAndPlay: (t: number) => void;
}

// ───────────── Key Gemini ─────────────
const countKeys = (s: string) => s.split(/[,\n\r;]+/).map((x) => x.trim()).filter(Boolean).length;

/** Phân loại lỗi AI: lỗi do key thì trả loại để hiện thông báo cài key, lỗi khác trả null */
export function classifyKeyError(text: string): 'missing' | 'exhausted' | 'invalid' | null {
  if (/Chưa cấu hình GEMINI|chưa có key/i.test(text)) return 'missing';
  if (/hết Quota|quota|429|RESOURCE_EXHAUSTED|rate limit/i.test(text)) return 'exhausted';
  if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED|403|401|không hợp lệ/i.test(text)) return 'invalid';
  return null;
}

/** Kiểm tra có key trước khi gọi AI; thiếu thì bật thông báo */
export function ensureKey(apiKey: () => string): boolean {
  if (apiKey().trim()) return true;
  useEditor.getState().setAiKeyIssue('missing');
  return false;
}

const KEY_TEXT = {
  missing: { title: 'Chưa có key Gemini', desc: 'Thêm key để dùng AI viết tiêu đề, lời đọc, chọn nhạc…' },
  exhausted: { title: 'Key Gemini đã hết lượt dùng', desc: 'Tất cả key đều hết quota hôm nay. Thêm key mới hoặc thử lại sau (quota thường làm mới lúc 14h–15h).' },
  invalid: { title: 'Key Gemini không hợp lệ', desc: 'Key bị sai hoặc đã bị khoá. Kiểm tra lại trong Cài đặt AI.' },
};

/** Thông báo lỗi key + nút mở Cài đặt AI (cùng hộp thoại với menu "Cấu hình AI (Gemini)") */
export function AiKeyBanner({ apiKey }: { apiKey: () => string }) {
  const issue = useEditor((s) => s.aiKeyIssue);
  const setIssue = useEditor((s) => s.setAiKeyIssue);
  const [open, setOpen] = useState(false);
  return (
    <>
      {issue && (
        <Alert type={issue === 'exhausted' ? 'warning' : 'error'} showIcon className="!mb-3 !text-[12px]" closable onClose={() => setIssue(null)}
          message={KEY_TEXT[issue].title}
          description={<div className="space-y-2"><div>{KEY_TEXT[issue].desc}</div><Button size="small" type="primary" onClick={() => setOpen(true)}>Cài đặt key Gemini</Button></div>} />
      )}
      <AiSettingsModal open={open} onClose={() => {
        setOpen(false);
        const n = countKeys(apiKey());
        if (n) { setIssue(null); message.success(`Đang dùng ${n} key Gemini — thử lại thao tác AI nhé`); }
      }} />
    </>
  );
}

// ───────────── Khối giao diện dùng chung ─────────────
const Title = ({ children, extra }: { children: ReactNode; extra?: ReactNode }) => (
  <div className="flex items-center justify-between h-7 mb-1.5"><span className="text-[12px] font-semibold text-slate-100">{children}</span>{extra}</div>
);
const Block = ({ children }: { children: ReactNode }) => <div className="pb-4 mb-4 border-b border-slate-800/80 last:border-0 last:mb-0 space-y-2">{children}</div>;
const Field = ({ label, children, value }: { label: string; children: ReactNode; value?: ReactNode }) => (
  <div>
    <div className="flex items-center justify-between text-[11px] text-slate-400 leading-5"><span>{label}</span>{value != null && <span className="text-slate-300 font-mono">{value}</span>}</div>
    {children}
  </div>
);
const Line = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-center justify-between gap-2 min-h-7"><span className="text-[11px] text-slate-400">{label}</span><div className="flex items-center">{children}</div></div>
);
const More = ({ children, label = 'Tuỳ chỉnh' }: { children: ReactNode; label?: string }) => (
  <Collapse ghost size="small" className="[&_.ant-collapse-header]:!px-0 [&_.ant-collapse-header]:!py-1 [&_.ant-collapse-content-box]:!px-0 [&_.ant-collapse-header-text]:!text-[11px] [&_.ant-collapse-header-text]:!text-slate-400"
    items={[{ key: '1', label, children: <div className="space-y-2">{children}</div> }]} />
);
const toColor = (c: unknown) => (typeof c === 'string' ? c : (c as { toRgbString?: () => string })?.toRgbString?.() || '#ffffff');

const TimeRange = ({ start, end, max, onChange }: { start: number; end: number; max: number; onChange: (s: number, e: number) => void }) => (
  <div className="grid grid-cols-2 gap-2">
    <Field label="Bắt đầu"><InputNumber size="small" className="!w-full" suffix="s" min={0} max={end - 0.1} step={0.1} value={+start.toFixed(2)} onChange={(v) => onChange(Math.max(0, Number(v) || 0), end)} /></Field>
    <Field label="Kết thúc"><InputNumber size="small" className="!w-full" suffix="s" min={start + 0.1} max={Math.floor(max * 100) / 100} step={0.1} value={Math.floor(Math.min(end, max) * 100) / 100} onChange={(v) => onChange(start, Math.min(max, Number(v) || end))} /></Field>
  </div>
);

const AnimFields = ({ inAnim, outAnim, animDur, onChange }: { inAnim: Anim; outAnim: Anim; animDur: number; onChange: (p: { inAnim?: Anim; outAnim?: Anim; animDur?: number }) => void }) => (
  <>
    <div className="grid grid-cols-2 gap-2">
      <Field label="Hiệu ứng vào"><Select<Anim> size="small" className="w-full" value={inAnim} options={ANIM_OPTIONS} onChange={(v) => onChange({ inAnim: v })} /></Field>
      <Field label="Hiệu ứng ra"><Select<Anim> size="small" className="w-full" value={outAnim} options={ANIM_OPTIONS} onChange={(v) => onChange({ outAnim: v })} /></Field>
    </div>
    <Field label="Thời lượng hiệu ứng" value={`${animDur.toFixed(1)}s`}><Slider className="!my-1" min={0.2} max={2} step={0.1} value={animDur} onChange={(v) => onChange({ animDur: v })} /></Field>
  </>
);

/** Nghe thử 1 file (bấm lại để dừng) */
function useListen() {
  const [playing, setPlaying] = useState('');
  const el = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => el.current?.pause(), []);
  const toggle = (url: string, from = 0, to?: number) => {
    if (!el.current) el.current = new Audio();
    const a = el.current;
    if (playing === url) { a.pause(); setPlaying(''); return; }
    a.src = url;
    a.currentTime = from;
    a.ontimeupdate = () => { if (to && a.currentTime >= to) { a.pause(); setPlaying(''); } };
    a.onended = () => setPlaying('');
    a.play().catch(() => {});
    setPlaying(url);
  };
  return { playing, toggle };
}

// ───────────── Video ─────────────
function VideoProps({ deps }: { deps: PanelDeps }) {
  const p = useEditor((s) => s.project) as Project;
  const update = useEditor((s) => s.update);
  const v = p.video;
  const setV = (patch: Partial<Project['video']>, key: string) => update((pp) => ({ ...pp, video: { ...pp.video, ...patch } }), { key });
  const srcAt = () => v.trimIn + usePlayerClock.getState().time * v.speed;
  return (
    <>
      <Block>
        <Title>Cắt clip</Title>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Từ"><InputNumber size="small" className="!w-full" suffix="s" min={0} max={v.trimOut - 0.3} step={0.1} value={+v.trimIn.toFixed(2)} onChange={(x) => setV({ trimIn: Math.max(0, Number(x) || 0) }, 'trimIn')} /></Field>
          <Field label="Đến"><InputNumber size="small" className="!w-full" suffix="s" min={v.trimIn + 0.3} max={deps.sourceDuration} step={0.1} value={+v.trimOut.toFixed(2)} onChange={(x) => setV({ trimOut: Math.min(deps.sourceDuration, Number(x) || v.trimOut) }, 'trimOut')} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Tooltip title="Bỏ phần trước đầu phát"><Button size="small" icon={<ScissorOutlined />} onClick={() => { setV({ trimIn: Math.min(v.trimOut - 0.3, srcAt()) }, 'cut'); deps.seek(0); }}>Cắt đầu</Button></Tooltip>
          <Tooltip title="Bỏ phần sau đầu phát"><Button size="small" icon={<ScissorOutlined />} onClick={() => setV({ trimOut: Math.max(v.trimIn + 0.3, srcAt()) }, 'cut')}>Cắt đuôi</Button></Tooltip>
        </div>
        <Field label="Tốc độ">
          <Segmented size="small" block value={v.speed} onChange={(x) => setV({ speed: Number(x) }, 'speed')} options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((x) => ({ value: x, label: `${x}x` }))} />
        </Field>
      </Block>
      <Block>
        <Title>Khung hình</Title>
        <Segmented<'cover' | 'contain'> block size="small" value={deps.vt.fit} onChange={(x) => deps.onVideoTransform({ fit: x })}
          options={[{ value: 'contain', label: 'Hiện trọn' }, { value: 'cover', label: 'Lấp kín' }]} />
        <Field label="Dời lên / xuống" value={`${deps.vt.offsetY}%`}><Slider className="!my-1" min={-50} max={50} value={deps.vt.offsetY} onChange={(x) => deps.onVideoTransform({ offsetY: x })} /></Field>
        <Field label="Phóng to" value={`${Math.round(deps.vt.scale * 100)}%`}><Slider className="!my-1" min={0.5} max={3} step={0.05} value={deps.vt.scale} onChange={(x) => deps.onVideoTransform({ scale: x })} /></Field>
        {deps.vt.fit === 'cover' && <Field label="Tâm cắt" value={`${deps.vt.focusY}%`}><Slider className="!my-1" min={0} max={100} value={deps.vt.focusY} onChange={(x) => deps.onVideoTransform({ focusY: x })} /></Field>}
      </Block>
      <Block>
        <Title extra={deps.hasAudio ? undefined : <span className="text-[11px] text-slate-500">Clip không có tiếng</span>}>Tiếng gốc</Title>
        <Field label="Âm lượng" value={`${Math.round(v.volume * 100)}%`}><Slider className="!my-1" min={0} max={2} step={0.05} disabled={!deps.hasAudio} value={v.volume} onChange={(x) => setV({ volume: x }, 'vol')} /></Field>
        <Field label="Khi có giọng đọc" value={`${Math.round(v.duckVolume * 100)}%`}><Slider className="!my-1" min={0} max={1} step={0.05} disabled={!deps.hasAudio} value={v.duckVolume} onChange={(x) => setV({ duckVolume: x }, 'duck')} /></Field>
      </Block>
      <Block>
        <Title extra={<Tooltip title="Đặt lại màu"><Button size="small" type="text" icon={<RotateCcw size={13} />} onClick={() => setV({ brightness: 0, contrast: 1, saturation: 1 }, 'eq')} /></Tooltip>}>Màu sắc</Title>
        <Field label="Độ sáng"><Slider className="!my-1" min={-0.3} max={0.3} step={0.01} value={v.brightness} onChange={(x) => setV({ brightness: x }, 'br')} /></Field>
        <Field label="Tương phản"><Slider className="!my-1" min={0.6} max={1.6} step={0.01} value={v.contrast} onChange={(x) => setV({ contrast: x }, 'ct')} /></Field>
        <Field label="Bão hoà"><Slider className="!my-1" min={0} max={2} step={0.01} value={v.saturation} onChange={(x) => setV({ saturation: x }, 'sat')} /></Field>
      </Block>
    </>
  );
}

// ───────────── Chữ / ảnh ─────────────
function OverlayProps({ l, D }: { l: OverlayLayer; D: number }) {
  const update = useEditor((s) => s.update);
  const select = useEditor((s) => s.select);
  const set = (patch: Partial<OverlayLayer>, key: string) =>
    update((p) => ({ ...p, overlays: p.overlays.map((x) => (x.id === l.id ? ({ ...x, ...patch } as OverlayLayer) : x)) }), { key: `${l.id}:${key}` });
  const move = (dir: -1 | 1) => update((p) => {
    const i = p.overlays.findIndex((x) => x.id === l.id);
    const j = i + dir;
    if (j < 0 || j >= p.overlays.length) return p;
    const arr = [...p.overlays];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...p, overlays: arr };
  });
  return (
    <>
      <Block>
        <Title extra={
          <div className="flex">
            <Tooltip title="Lên trên"><Button size="small" type="text" icon={<ArrowUpOutlined />} onClick={() => move(1)} /></Tooltip>
            <Tooltip title="Xuống dưới"><Button size="small" type="text" icon={<ArrowDownOutlined />} onClick={() => move(-1)} /></Tooltip>
            <Tooltip title="Nhân bản (Ctrl+D)"><Button size="small" type="text" icon={<CopyOutlined />} onClick={() => update((p) => ({ ...p, overlays: [...p.overlays, { ...l, id: newId(), x: l.x + 30, y: l.y + 30 }] }))} /></Tooltip>
            <Tooltip title="Xoá"><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => { update((p) => ({ ...p, overlays: p.overlays.filter((x) => x.id !== l.id) })); select(null); }} /></Tooltip>
          </div>
        }>{l.kind === 'text' ? 'Chữ' : 'Ảnh'}</Title>
        {l.kind === 'text' ? (
          <>
            <TextArea value={l.text} autoSize={{ minRows: 2, maxRows: 6 }} onChange={(e) => set({ text: e.target.value, name: e.target.value.slice(0, 24) }, 'text')} />
            <div className="grid grid-cols-5 gap-1">
              {TEXT_PRESETS.map((pr) => (
                <Tooltip key={pr.key} title={pr.label}>
                  <button type="button" onClick={() => set(pr.patch, 'preset')} className="h-8 rounded border border-slate-700 hover:border-blue-500 bg-[#232a38] text-[13px] font-black"
                    style={{ color: pr.patch.color, textShadow: pr.patch.strokeColor ? `0 0 2px ${pr.patch.strokeColor},0 0 2px ${pr.patch.strokeColor}` : undefined }}>
                    <span style={{ background: pr.patch.bg || undefined, padding: pr.patch.bg ? '0 4px' : undefined, borderRadius: 3 }}>Aa</span>
                  </button>
                </Tooltip>
              ))}
            </div>
            <Field label="Cỡ chữ" value={l.fontSize}><Slider className="!my-1" min={20} max={200} value={l.fontSize} onChange={(x) => set({ fontSize: x }, 'fs')} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Chữ"><ColorPicker size="small" value={l.color} onChange={(c) => set({ color: toColor(c) }, 'color')} /></Field>
              <Field label="Viền"><ColorPicker size="small" allowClear value={l.strokeColor || undefined} onChange={(c) => set({ strokeColor: toColor(c), strokeWidth: l.strokeWidth || 5 }, 'sc')} onClear={() => set({ strokeColor: '' }, 'sc')} /></Field>
              <Field label="Nền"><ColorPicker size="small" allowClear value={l.bg || undefined} onChange={(c) => set({ bg: toColor(c) }, 'bg')} onClear={() => set({ bg: '' }, 'bg')} /></Field>
            </div>
            <div className="flex items-center gap-2">
              <Segmented size="small" value={l.align} onChange={(x) => set({ align: x as TextLayer['align'] }, 'align')} options={[{ value: 'left', label: 'Trái' }, { value: 'center', label: 'Giữa' }, { value: 'right', label: 'Phải' }]} />
              <Segmented size="small" value={l.uppercase ? 'AA' : 'Aa'} onChange={(x) => set({ uppercase: x === 'AA' }, 'up')} options={['Aa', 'AA']} />
            </div>
            <More>
              <Field label="Độ dày viền" value={l.strokeWidth}><Slider className="!my-1" min={0} max={14} value={l.strokeWidth} onChange={(x) => set({ strokeWidth: x }, 'sw')} /></Field>
              <Field label="Độ đậm"><Segmented size="small" block value={l.weight} onChange={(x) => set({ weight: Number(x) }, 'w')} options={[{ value: 700, label: 'Vừa' }, { value: 800, label: 'Đậm' }, { value: 900, label: 'Rất đậm' }]} /></Field>
              <Field label="Bề ngang" value={`${l.width}px`}><Slider className="!my-1" min={40} max={1080} value={l.width} onChange={(x) => set({ width: x }, 'width')} /></Field>
              <Field label="Xoay" value={`${l.rotate}°`}><Slider className="!my-1" min={-180} max={180} value={l.rotate} onChange={(x) => set({ rotate: x }, 'rot')} /></Field>
              <Field label="Độ trong" value={`${Math.round(l.opacity * 100)}%`}><Slider className="!my-1" min={0.1} max={1} step={0.05} value={l.opacity} onChange={(x) => set({ opacity: x }, 'op')} /></Field>
              <Button size="small" block onClick={() => set({ x: CANVAS_W / 2 }, 'center')}>Căn giữa ngang</Button>
            </More>
          </>
        ) : (
          <>
            <Field label="Kích thước" value={`${l.width}px`}><Slider className="!my-1" min={40} max={1080} value={l.width} onChange={(x) => set({ width: x }, 'width')} /></Field>
            <Field label="Bo góc" value={`${l.radius}%`}><Slider className="!my-1" min={0} max={50} value={l.radius} onChange={(x) => set({ radius: x }, 'rad')} /></Field>
            <Field label="Độ trong" value={`${Math.round(l.opacity * 100)}%`}><Slider className="!my-1" min={0.1} max={1} step={0.05} value={l.opacity} onChange={(x) => set({ opacity: x }, 'op')} /></Field>
            <Field label="Xoay" value={`${l.rotate}°`}><Slider className="!my-1" min={-180} max={180} value={l.rotate} onChange={(x) => set({ rotate: x }, 'rot')} /></Field>
          </>
        )}
      </Block>
      <Block>
        <Title>Thời gian</Title>
        <TimeRange start={l.start} end={l.end} max={D} onChange={(s, e) => set({ start: s, end: e }, 'time')} />
        <AnimFields inAnim={l.inAnim} outAnim={l.outAnim} animDur={l.animDur} onChange={(x) => set(x, 'anim')} />
      </Block>
    </>
  );
}

// ───────────── Phụ đề ─────────────
/** Sửa chữ phụ đề → chia lại mốc từ đều trong khoảng thời gian của dòng (giữ hiệu ứng tô từng từ) */
const retime = (c: Caption): Caption => {
  const tokens = c.text.split(/\s+/).filter(Boolean);
  if (!c.words || !tokens.length) return { ...c, words: undefined };
  if (tokens.length === c.words.length) return { ...c, words: c.words.map((w, i) => ({ ...w, text: tokens[i] })) };
  const span = c.end - c.start;
  return { ...c, words: tokens.map((w, i) => ({ text: w, start: c.start + (i / tokens.length) * span, end: c.start + ((i + 1) / tokens.length) * span })) };
};

function CaptionsPanel({ deps }: { deps: PanelDeps }) {
  const p = useEditor((s) => s.project) as Project;
  const update = useEditor((s) => s.update);
  const select = useEditor((s) => s.select);
  const sel = useEditor((s) => s.selected);
  const cs = p.captionStyle;
  const setCs = (patch: Partial<Project['captionStyle']>, key: string) => update((pp) => ({ ...pp, captionStyle: { ...pp.captionStyle, ...patch } }), { key: `cs:${key}` });
  const regenerate = () => {
    if (!p.voices.length) return message.warning('Chưa có giọng đọc');
    update((pp) => ({ ...pp, captions: buildCaptions(pp.voices, pp.captionStyle.maxWords), captionStyle: { ...pp.captionStyle, enabled: true } }));
  };
  return (
    <>
      <Block>
        <Title extra={<Switch size="small" checked={cs.enabled} onChange={(x) => setCs({ enabled: x }, 'en')} />}>Phụ đề tự động</Title>
        <div className="grid grid-cols-2 gap-2">
          <Button type="primary" size="small" icon={<Wand2 size={13} />} onClick={regenerate}>{p.captions.length ? 'Tạo lại' : 'Tạo từ giọng đọc'}</Button>
          <Button size="small" icon={<PlusOutlined />} onClick={() => {
            const t = usePlayerClock.getState().time;
            const c: Caption = { id: newId(), start: t, end: Math.min(timelineDuration(p), t + 2), text: 'Phụ đề mới' };
            update((pp) => ({ ...pp, captions: [...pp.captions, c].sort((a, b) => a.start - b.start), captionStyle: { ...pp.captionStyle, enabled: true } }));
            select({ type: 'caption', id: c.id });
          }}>Thêm dòng</Button>
        </div>
      </Block>
      <Block>
        <Title>Kiểu chữ</Title>
        <div className="grid grid-cols-2 gap-1.5">
          {CAPTION_PRESETS.map((pr) => (
            <button key={pr.key} type="button" onClick={() => setCs({ ...pr.style, preset: pr.key }, 'preset')}
              className={`h-9 rounded border text-[12px] font-black ${cs.preset === pr.key ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-700 hover:border-slate-500'}`}
              style={{ background: pr.style.bg || '#232a38', color: pr.style.color, textShadow: pr.style.strokeColor ? `0 0 2px ${pr.style.strokeColor},0 0 2px ${pr.style.strokeColor}` : undefined }}>
              {pr.label}
            </button>
          ))}
        </div>
        <Line label="Tô từ đang đọc"><Switch size="small" checked={cs.karaoke} onChange={(x) => setCs({ karaoke: x }, 'k')} /></Line>
        <Field label="Vị trí dọc" value={`${cs.y}%`}><Slider className="!my-1" min={8} max={92} value={cs.y} onChange={(x) => setCs({ y: x }, 'y')} /></Field>
        <More>
          <Line label="Hiện cả lúc có khung tiêu đề"><Switch size="small" checked={!!cs.showDuringFrame} onChange={(x) => setCs({ showDuringFrame: x }, 'sdf')} /></Line>
          <Line label="Tự né khung tiêu đề"><Switch size="small" checked={cs.avoidFrame !== false} onChange={(x) => setCs({ avoidFrame: x }, 'av')} /></Line>
          <Line label="In hoa"><Switch size="small" checked={cs.uppercase} onChange={(x) => setCs({ uppercase: x }, 'up')} /></Line>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Màu chữ"><ColorPicker size="small" value={cs.color} onChange={(c) => setCs({ color: toColor(c) }, 'c')} /></Field>
            <Field label="Màu tô"><ColorPicker size="small" value={cs.highlight} onChange={(c) => setCs({ highlight: toColor(c) }, 'hl')} /></Field>
          </div>
          <Field label="Cỡ chữ" value={cs.fontSize}><Slider className="!my-1" min={30} max={130} value={cs.fontSize} onChange={(x) => setCs({ fontSize: x }, 'fs')} /></Field>
          <Field label="Số từ mỗi dòng" value={cs.maxWords}><Slider className="!my-1" min={1} max={10} value={cs.maxWords} onChange={(x) => setCs({ maxWords: x }, 'mw')} /></Field>
        </More>
      </Block>
      {p.captions.length > 0 && (
        <Block>
          <Title>{`${p.captions.length} dòng`}</Title>
          <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
            {p.captions.map((c) => (
              <div key={c.id} className={`flex items-start gap-1.5 group rounded px-1 ${sel?.type === 'caption' && sel.id === c.id ? 'bg-blue-500/10' : ''}`}>
                <button type="button" className="text-[10px] font-mono text-blue-400 pt-1.5 w-9 shrink-0 text-left" onClick={() => { deps.seek(c.start); select({ type: 'caption', id: c.id }); }}>{fmtTime(c.start)}</button>
                <TextArea size="small" variant="borderless" autoSize value={c.text} onFocus={() => { select({ type: 'caption', id: c.id }); deps.seek(c.start); }}
                  onChange={(e) => update((pp) => ({ ...pp, captions: pp.captions.map((x) => (x.id === c.id ? retime({ ...x, text: e.target.value }) : x)) }), { key: `cap:${c.id}` })} />
                <Button size="small" type="text" danger className="opacity-0 group-hover:opacity-100" icon={<DeleteOutlined />} onClick={() => update((pp) => ({ ...pp, captions: pp.captions.filter((x) => x.id !== c.id) }))} />
              </div>
            ))}
          </div>
        </Block>
      )}
    </>
  );
}

// ───────────── Giọng đọc ─────────────
const rateStr = (r: number) => `${r >= 0 ? '+' : ''}${r}%`;

/** Ô soạn giọng đọc: nội dung + giọng + tốc độ/cao độ. Dùng cho "tạo mới" và "sửa trực tiếp đoạn đang chọn" */
function VoiceComposer({ deps, clip, onDone }: { deps: PanelDeps; clip?: VoiceClip; onDone?: () => void }) {
  const [text, setText] = useState(clip?.text ?? deps.defaultVoiceText);
  const [voice, setVoice] = useState(clip?.voice ?? deps.defaultVoiceName);
  const [rate, setRate] = useState(clip?.rate ?? 0);
  const [pitch, setPitch] = useState(clip?.pitch ?? 0);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState('');
  useEffect(() => {
    if (!clip) return;
    setText(clip.text); setVoice(clip.voice); setRate(clip.rate ?? 0); setPitch(clip.pitch ?? 0);
  }, [clip?.id, clip?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = !clip || text.trim() !== clip.text || voice !== clip.voice || rate !== (clip.rate ?? 0) || pitch !== (clip.pitch ?? 0);

  const generate = async (t = text) => {
    if (!t.trim()) return message.warning('Nhập nội dung cần đọc');
    setBusy(true);
    try {
      const res = await deps.makeVoice(t.trim(), voice, rate, pitch);
      if (res) { placeVoice(res, clip ? { replaceId: clip.id } : {}); onDone?.(); }
    } finally {
      setBusy(false);
    }
  };

  // AI viết lại lời đọc theo kiểu → điền vào ô rồi đọc luôn
  const aiRewrite = async (style: string) => {
    if (!ensureKey(deps.apiKey)) return;
    setAiBusy(style);
    try {
      const p = useEditor.getState().project as Project;
      const res = await api.post('/video-studio/ai-assist', {
        instruction: `Viết lại lời đọc ${clip ? 'của đoạn này' : ''} theo kiểu: ${style}. Lời hiện tại: "${text}". Chỉ trả về 1 thao tác set_voice.`,
        context: aiContext(p, { headline: deps.headline, postCaption: deps.postCaption, bgmOptions: deps.bgmPresets.map((b) => b.name), sourceDuration: deps.sourceDuration, sourceTitle: deps.sourceTitle }),
        videoUrl: deps.sourceUrl, apiKey: deps.apiKey(),
      }, { timeout: 120000 });
      const a = (res.data?.actions || []).find((x: AiAction) => typeof x.text === 'string' && x.text);
      if (!a) throw new Error(res.data?.error || 'AI không trả lời đọc');
      setText(a.text as string);
      await generate(a.text as string);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      const text = String(err?.response?.data?.error || err?.message || '');
      const k = classifyKeyError(text);
      if (k) useEditor.getState().setAiKeyIssue(k);
      else message.error('AI lỗi: ' + text);
    } finally {
      setAiBusy('');
    }
  };

  return (
    <div className="space-y-2">
      <TextArea value={text} onChange={(e) => setText(e.target.value)} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="Nội dung cần đọc" />
      <div className="flex flex-wrap gap-1">
        {['Tự nhiên hơn', 'Ngắn gọn hơn', 'Kể chuyện cuốn hút', 'Hài hước'].map((st) => (
          <Button key={st} size="small" type="text" className="!px-1.5 !text-[11px] !text-violet-300" loading={aiBusy === st} icon={aiBusy === st ? undefined : <Sparkles size={11} />} onClick={() => aiRewrite(st)}>{st}</Button>
        ))}
      </div>
      <Select size="small" className="w-full" value={voice} options={VOICES} onChange={setVoice} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Tốc độ" value={rateStr(rate)}><Slider className="!my-1" min={-40} max={50} value={rate} onChange={setRate} disabled={!voice.startsWith('vi-VN-')} /></Field>
        <Field label="Cao độ" value={`${pitch >= 0 ? '+' : ''}${pitch}Hz`}><Slider className="!my-1" min={-20} max={20} value={pitch} onChange={setPitch} disabled={!voice.startsWith('vi-VN-')} /></Field>
      </div>
      <Button type="primary" block size="small" loading={busy} disabled={!!clip && !changed} onClick={() => generate()}>
        {clip ? (changed ? 'Đọc lại với nội dung mới' : 'Chưa có thay đổi') : 'Tạo giọng đọc'}
      </Button>
    </div>
  );
}

function VoiceProps({ v, deps }: { v: VoiceClip; deps: PanelDeps }) {
  const update = useEditor((s) => s.update);
  const select = useEditor((s) => s.select);
  const { playing, toggle } = useListen();
  const set = (patch: Partial<VoiceClip>, key: string) => update((pp) => ({ ...pp, voices: pp.voices.map((x) => (x.id === v.id ? { ...x, ...patch } : x)) }), { key: `voice:${v.id}:${key}` });
  return (
    <>
      <Block>
        <Title extra={
          <div className="flex">
            <Tooltip title="Nghe đoạn này"><Button size="small" type="text" icon={playing ? <Pause size={13} /> : <Play size={13} />} onClick={() => toggle(v.url, v.trimIn ?? 0, v.trimOut)} /></Tooltip>
            <Tooltip title="Tách tại đầu phát (S)"><Button size="small" type="text" icon={<ScissorOutlined />} onClick={() => splitVoiceAt(v.id, usePlayerClock.getState().time)} /></Tooltip>
            <Tooltip title="Xoá"><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => { removeVoice(v.id); select(null); }} /></Tooltip>
          </div>
        }>
          <span>Giọng đọc <span className="text-slate-500 font-normal">· {voiceLen(v).toFixed(1)}s · {ENGINE_LABEL[v.engine] || v.engine}</span></span>
        </Title>
        <VoiceComposer deps={deps} clip={v} />
      </Block>
      <Block>
        <Field label="Âm lượng" value={`${Math.round(v.volume * 100)}%`}><Slider className="!my-1" min={0} max={3} step={0.05} value={v.volume} onChange={(x) => set({ volume: x }, 'vol')} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Bắt đầu"><InputNumber size="small" className="!w-full" suffix="s" min={0} step={0.1} value={+v.start.toFixed(2)} onChange={(x) => set({ start: Math.max(0, Number(x) || 0) }, 'start')} /></Field>
          <Field label="Kết thúc"><InputNumber size="small" className="!w-full" suffix="s" disabled value={+voiceEnd(v).toFixed(2)} /></Field>
        </div>
        {(v.trimIn || v.trimOut) && <Button size="small" block onClick={() => set({ trimIn: undefined, trimOut: undefined }, 'trim')}>Bỏ cắt, dùng cả đoạn</Button>}
      </Block>
    </>
  );
}

function AudioPanel({ deps }: { deps: PanelDeps }) {
  const p = useEditor((s) => s.project) as Project;
  const update = useEditor((s) => s.update);
  const select = useEditor((s) => s.select);
  const sel = useEditor((s) => s.selected);
  const D = timelineDuration(p);
  const { playing, toggle } = useListen();
  const setBgm = (m: { url: string; name: string } | null) =>
    update((pp) => ({ ...pp, bgm: m ? { url: m.url, name: m.name, start: pp.bgm?.start ?? 0, end: pp.bgm?.end ?? D, offset: 0, volume: pp.bgm?.volume ?? 0.15, fadeIn: pp.bgm?.fadeIn ?? 0.8, fadeOut: pp.bgm?.fadeOut ?? 1.5 } : null }));

  return (
    <>
      <Block>
        <Title>{p.voices.length ? 'Thêm đoạn đọc' : 'Lồng tiếng AI'}</Title>
        <VoiceComposer deps={deps} />
      </Block>
      {p.voices.length > 0 && (
        <Block>
          <Title>Các đoạn đọc</Title>
          {p.voices.map((v) => (
            <div key={v.id} className={`flex items-center gap-2 rounded px-2 py-1.5 border cursor-pointer ${sel?.type === 'voice' && sel.id === v.id ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 hover:border-slate-500'}`}
              onClick={() => { select({ type: 'voice', id: v.id }); deps.seek(v.start); }}>
              <button type="button" className="text-blue-300" onClick={(e) => { e.stopPropagation(); toggle(v.url, v.trimIn ?? 0, v.trimOut); }}>{playing === v.url ? <Pause size={13} /> : <Play size={13} />}</button>
              <span className="text-[12px] text-slate-200 flex-1 truncate">{v.text}</span>
              <span className="text-[10px] text-slate-500 font-mono">{fmtTime(v.start)}</span>
            </div>
          ))}
        </Block>
      )}
      <Block>
        <Title extra={p.bgm && <Button size="small" type="text" danger className="!text-[11px]" onClick={() => setBgm(null)}>Bỏ nhạc</Button>}>Nhạc nền</Title>
        {deps.hasAudio && p.bgm && (
          <div className={`rounded border px-2.5 py-2 space-y-1.5 ${p.video.volume > 0 ? 'border-amber-500/50 bg-amber-500/5' : 'border-slate-700'}`}>
            <div className="text-[11px] text-slate-300">Clip gốc thường đã có nhạc sẵn — để cả hai sẽ bị lẫn tiếng.</div>
            <Segmented size="small" block value={p.video.volume > 0 ? 'both' : 'new'}
              onChange={(x) => {
                if (x === 'new') update((pp) => ({ ...pp, video: { ...pp.video, volume: 0, duckVolume: 0 } }));
                else if (x === 'orig') update((pp) => ({ ...pp, bgm: null, video: { ...pp.video, volume: pp.video.volume || 1, duckVolume: pp.video.duckVolume || 0.2 } }));
                else update((pp) => ({ ...pp, video: { ...pp.video, volume: pp.video.volume || 1, duckVolume: pp.video.duckVolume || 0.2 } }));
              }}
              options={[{ value: 'new', label: 'Chỉ nhạc mới' }, { value: 'orig', label: 'Chỉ tiếng gốc' }, { value: 'both', label: 'Cả hai' }]} />
          </div>
        )}
        <div className="space-y-1">
          {deps.bgmPresets.map((m) => (
            <div key={m.url} className={`flex items-center gap-2 rounded px-2 py-1.5 border cursor-pointer ${p.bgm?.url === m.url ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 hover:border-slate-500'}`} onClick={() => setBgm(m)}>
              <button type="button" className="text-violet-300" onClick={(e) => { e.stopPropagation(); toggle(m.url); }}>{playing === m.url ? <Pause size={13} /> : <Play size={13} />}</button>
              <span className="text-[12px] text-slate-200 flex-1 truncate">{m.name}</span>
            </div>
          ))}
          {p.bgm && !deps.bgmPresets.some((m) => m.url === p.bgm!.url) && (
            <div className="rounded px-2 py-1.5 border border-blue-500 bg-blue-500/10 text-[12px] text-slate-200 truncate">{p.bgm.name}</div>
          )}
        </div>
        <Upload accept="audio/*" showUploadList={false} customRequest={async ({ file, onSuccess, onError }) => {
          try { const url = await deps.uploadFile(file as File); setBgm({ url, name: (file as File).name }); onSuccess?.({}); }
          catch (e) { message.error('Upload nhạc lỗi'); onError?.(e as Error); }
        }}>
          <Button size="small" type="text" icon={<UploadOutlined />}>Tải nhạc từ máy</Button>
        </Upload>
      </Block>
    </>
  );
}

function BgmProps({ D }: { D: number }) {
  const p = useEditor((s) => s.project) as Project;
  const update = useEditor((s) => s.update);
  const b = p.bgm!;
  const set = (patch: Partial<NonNullable<Project['bgm']>>, key: string) => update((pp) => ({ ...pp, bgm: pp.bgm ? { ...pp.bgm, ...patch } : null }), { key: `bgm:${key}` });
  return (
    <Block>
      <Title extra={<Tooltip title="Bỏ nhạc"><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => update((pp) => ({ ...pp, bgm: null }))} /></Tooltip>}>
        <span>Nhạc nền <span className="text-slate-500 font-normal">· {b.name}</span></span>
      </Title>
      <Field label="Âm lượng" value={`${Math.round(b.volume * 100)}%`}><Slider className="!my-1" min={0} max={1} step={0.01} value={b.volume} onChange={(x) => set({ volume: x }, 'vol')} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Mở dần" value={`${b.fadeIn.toFixed(1)}s`}><Slider className="!my-1" min={0} max={5} step={0.1} value={b.fadeIn} onChange={(x) => set({ fadeIn: x }, 'fi')} /></Field>
        <Field label="Tắt dần" value={`${b.fadeOut.toFixed(1)}s`}><Slider className="!my-1" min={0} max={5} step={0.1} value={b.fadeOut} onChange={(x) => set({ fadeOut: x }, 'fo')} /></Field>
      </div>
      <TimeRange start={b.start} end={b.end} max={D} onChange={(s, e) => set({ start: s, end: e }, 'time')} />
      <Field label="Phát nhạc từ giây"><InputNumber size="small" className="!w-full" suffix="s" min={0} step={0.5} value={+b.offset.toFixed(2)} onChange={(x) => set({ offset: Math.max(0, Number(x) || 0) }, 'off')} /></Field>
    </Block>
  );
}

// ───────────── Khung ─────────────
function FrameTiming({ D }: { D: number }) {
  const p = useEditor((s) => s.project) as Project;
  const update = useEditor((s) => s.update);
  const f = p.frame;
  const setF = (patch: Partial<Project['frame']>, key: string) =>
    update((pp) => ({ ...pp, frame: { ...pp.frame, ...patch }, brand: pp.brand.enabled && patch.end != null && Math.abs(pp.brand.start - pp.frame.end) < 0.05 ? { ...pp.brand, start: patch.end } : pp.brand }), { key: `frame:${key}` });
  const v0 = p.voices[0];
  const preset = f.end >= D - 0.05 && f.start === 0 ? 'all' : v0 && Math.abs(f.end - Math.min(D, voiceEnd(v0) + 0.4)) < 0.05 ? 'voice' : String(Math.round(f.end));
  return (
    <>
      <Field label="Hiện khung">
        <Segmented size="small" block value={preset} onChange={(x) => {
          if (x === 'all') setF({ start: 0, end: D }, 'dur');
          else if (x === 'voice' && v0) setF({ start: 0, end: Math.min(D, voiceEnd(v0) + 0.4) }, 'dur');
          else setF({ start: 0, end: Math.min(D, Number(x)) }, 'dur');
        }} options={[{ value: 'all', label: 'Suốt' }, ...(v0 ? [{ value: 'voice', label: 'Giọng' }] : []), { value: '3', label: '3s' }, { value: '5', label: '5s' }, { value: '10', label: '10s' }]} />
      </Field>
      <More>
        <TimeRange start={f.start} end={f.end} max={D} onChange={(s, e) => setF({ start: s, end: e }, 'time')} />
        <AnimFields inAnim={f.inAnim} outAnim={f.outAnim} animDur={f.animDur} onChange={(x) => setF(x, 'anim')} />
        <Field label="Sau khi khung ẩn">
          <Segmented size="small" block value={f.keepLayoutAfter ? 'keep' : 'full'} onChange={(x) => setF({ keepLayoutAfter: x === 'keep' }, 'layout')}
            options={[{ value: 'full', label: 'Clip trọn màn' }, { value: 'keep', label: 'Giữ vị trí' }]} />
        </Field>
        {p.brand.end > 0 && (
          <Line label='"Nguồn" + logo sau khung'>
            <Switch size="small" checked={p.brand.enabled} onChange={(x) => update((pp) => ({ ...pp, brand: { ...pp.brand, enabled: x, start: x ? pp.frame.end : pp.brand.start, end: x ? D : pp.brand.end } }))} />
          </Line>
        )}
        {(f.dx !== 0 || f.dy !== 0) && <Button size="small" block onClick={() => setF({ dx: 0, dy: 0 }, 'pos')}>Đưa khung về vị trí gốc</Button>}
      </More>
    </>
  );
}

// ───────────── AI trợ lý ─────────────
interface ChatMsg { role: 'user' | 'ai'; text: string; done?: string[] }

export const AI_QUICK = [
  { label: 'Làm trọn gói', prompt: 'Làm trọn gói: viết lại tiêu đề khung, lời đọc tự nhiên cuốn hút, KHÔNG bật phụ đề (video chỉ hiện chữ tiêu đề), thêm 1 chữ hook mở đầu, chọn nhạc nền hợp không khí và tắt tiếng gốc (volume original 0, duck 0) để không lẫn 2 bài nhạc, viết caption đăng bài.' },
  { label: 'Tiêu đề khung hay hơn', prompt: 'Viết lại tiêu đề khung gây tò mò hơn.' },
  { label: 'Lời đọc kể chuyện', prompt: 'Viết lời đọc kể lại clip cuốn hút, dài vừa đủ clip.' },
  { label: 'Chữ hook mở đầu', prompt: 'Thêm 1 chữ hook ngắn gây tò mò ở 2 giây đầu.' },
  { label: 'Chọn nhạc hợp clip', prompt: 'Chọn nhạc nền hợp không khí clip và tắt tiếng gốc (volume original 0, duck 0) để không lẫn với nhạc có sẵn trong clip.' },
  { label: 'Caption đăng bài', prompt: 'Viết caption đăng bài.' },
];

export function AiPanel({ deps, autoPrompt, onAutoDone }: { deps: PanelDeps; autoPrompt?: string; onAutoDone?: () => void }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);

  const send = async (instruction: string) => {
    if (!instruction.trim() || busy) return;
    if (!ensureKey(deps.apiKey)) return;
    useEditor.getState().setAiKeyIssue(null);
    setMsgs((m) => [...m, { role: 'user', text: instruction }]);
    setInput('');
    setBusy(true);
    try {
      const p = useEditor.getState().project as Project;
      const res = await api.post('/video-studio/ai-assist', {
        instruction,
        context: aiContext(p, { headline: deps.headline, postCaption: deps.postCaption, bgmOptions: deps.bgmPresets.map((b) => b.name), sourceDuration: deps.sourceDuration, sourceTitle: deps.sourceTitle }),
        videoUrl: deps.sourceUrl, apiKey: deps.apiKey(),
      }, { timeout: 150000 });
      if (!res.data?.success) throw new Error(res.data?.error);
      const done = await applyAiActions(Array.isArray(res.data.actions) ? res.data.actions : [], {
        H: deps.H, sourceDuration: deps.sourceDuration, bgmPresets: deps.bgmPresets, defaultVoiceName: deps.defaultVoiceName,
        makeVoice: deps.makeVoice, onHeadline: deps.onHeadline, onPostCaption: deps.onPostCaption,
      });
      setMsgs((m) => [...m, { role: 'ai', text: res.data.reply || (done.length ? 'Đã xong.' : 'AI không đổi gì.'), done }]);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      const text = String(err?.response?.data?.error || err?.message || '');
      const k = classifyKeyError(text);
      if (k) useEditor.getState().setAiKeyIssue(k);
      setMsgs((m) => [...m, { role: 'ai', text: k ? KEY_TEXT[k].title + ' — bấm "Cài đặt key Gemini" ở trên rồi gửi lại.' : 'Lỗi: ' + text }]);
    } finally {
      setBusy(false);
    }
  };

  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoPrompt || autoRan.current) return;
    autoRan.current = true;
    send(autoPrompt).finally(() => onAutoDone?.());
  }, [autoPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap gap-1.5 pb-3 border-b border-slate-800/80">
        {AI_QUICK.map((q, i) => (
          <Button key={q.label} size="small" type={i === 0 ? 'primary' : 'default'} disabled={busy} icon={i === 0 ? <Sparkles size={12} /> : undefined} onClick={() => send(q.prompt)}>{q.label}</Button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto py-3 space-y-2 min-h-[120px]">
        {!msgs.length && <div className="text-[12px] text-slate-500">Ví dụ: "thêm chữ XEM ĐẾN CUỐI ở giây 5", "lời đọc hài hước hơn", "cắt bỏ 2 giây đầu", "nhạc vui hơn, nhỏ lại".</div>}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={`rounded-lg px-2.5 py-1.5 text-[12px] max-w-[92%] ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-200'}`}>
              {m.text}
              {!!m.done?.length && <ul className="mt-1 space-y-0.5 text-[11px] text-emerald-300">{m.done.map((d, k) => <li key={k}>✓ {d}</li>)}</ul>}
            </div>
          </div>
        ))}
        {busy && <div className="text-[12px] text-slate-400 flex items-center gap-2"><LoadingOutlined /> AI đang xem clip và chỉnh…</div>}
        <div ref={endRef} />
      </div>
      <div className="pt-2 border-t border-slate-800/80">
        <TextArea value={input} onChange={(e) => setInput(e.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="Nhờ AI chỉnh video… (Enter để gửi)"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }} />
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10px] text-slate-500">Ctrl/⌘+Z để hoàn tác thay đổi của AI</span>
          <Button type="primary" size="small" icon={<SendOutlined />} loading={busy} disabled={!input.trim()} onClick={() => send(input)}>Gửi</Button>
        </div>
      </div>
    </div>
  );
}

// ───────────── Ảnh / logo ─────────────
const ASSETS_KEY = 'videoEditor.assets';
const loadAssets = (): Array<{ name: string; url: string }> => { try { return JSON.parse(localStorage.getItem(ASSETS_KEY) || '[]'); } catch { return []; } };

function MediaPanel({ deps }: { deps: PanelDeps }) {
  const update = useEditor((s) => s.update);
  const select = useEditor((s) => s.select);
  const p = useEditor((s) => s.project) as Project;
  const [assets, setAssets] = useState(loadAssets);
  const D = timelineDuration(p);
  const add = (src: string, name: string) => {
    const t = usePlayerClock.getState().time;
    const l: ImageLayer = { id: newId(), kind: 'image', name, src, start: t, end: D, x: CANVAS_W - 170, y: Math.round(deps.H * 0.16), width: 220, rotate: 0, opacity: 1, inAnim: 'fade', outAnim: 'none', animDur: 0.4, radius: 0 };
    update((pp) => ({ ...pp, overlays: [...pp.overlays, l] }));
    select({ type: 'overlay', id: l.id });
  };
  const all = [...assets, ...deps.logos.filter((l) => !assets.some((a) => a.url === l.url))];
  return (
    <Block>
      <Title extra={
        <Upload accept="image/*" showUploadList={false} customRequest={async ({ file, onSuccess, onError }) => {
          try {
            const url = await deps.uploadFile(file as File);
            const name = (file as File).name.replace(/\.[^.]+$/, '');
            const next = [{ name, url }, ...assets].slice(0, 60);
            setAssets(next);
            localStorage.setItem(ASSETS_KEY, JSON.stringify(next));
            add(url, name);
            onSuccess?.({});
          } catch (e) { message.error('Upload ảnh lỗi'); onError?.(e as Error); }
        }}>
          <Button size="small" type="primary" icon={<UploadOutlined />}>Tải lên</Button>
        </Upload>
      }>Logo, sticker, ảnh</Title>
      {all.length > 0 ? (
        <div className="grid grid-cols-3 gap-1.5">
          {all.map((lg) => (
            <Tooltip key={lg.url} title={lg.name}>
              <div className="group relative aspect-square rounded border border-slate-700 hover:border-blue-500 bg-[#232a38] bg-center bg-contain bg-no-repeat cursor-pointer" style={{ backgroundImage: `url('${lg.url}')` }} onClick={() => add(lg.url, lg.name)}>
                {assets.some((a) => a.url === lg.url) && (
                  <button type="button" className="absolute top-0.5 right-0.5 hidden group-hover:flex w-5 h-5 items-center justify-center rounded bg-slate-900/90 text-red-400 text-[10px]"
                    onClick={(e) => { e.stopPropagation(); const next = assets.filter((a) => a.url !== lg.url); setAssets(next); localStorage.setItem(ASSETS_KEY, JSON.stringify(next)); }}>
                    <DeleteOutlined />
                  </button>
                )}
              </div>
            </Tooltip>
          ))}
        </div>
      ) : <div className="text-[12px] text-slate-500 py-2">Ảnh tải lên sẽ được giữ ở đây để dùng lại.</div>}
    </Block>
  );
}

// ───────────── Cột trái ─────────────
export type LeftTab = 'ai' | 'frame' | 'transition' | 'text' | 'captions' | 'audio' | 'image' | 'video';

export function LeftPanel({ tab, deps }: { tab: LeftTab; deps: PanelDeps }) {
  const p = useEditor((s) => s.project) as Project;
  const update = useEditor((s) => s.update);
  const select = useEditor((s) => s.select);
  const D = timelineDuration(p);
  const addText = (patch: Partial<TextLayer>) => {
    const l = makeTextLayer(usePlayerClock.getState().time, D, deps.H, patch);
    update((pp) => ({ ...pp, overlays: [...pp.overlays, l] }));
    select({ type: 'overlay', id: l.id });
  };

  if (tab === 'frame') return (
    <>
      <Block>
        <Title extra={<Switch size="small" checked={p.frame.enabled} disabled={!deps.frameAvailable} onChange={(x) => update((pp) => ({ ...pp, frame: { ...pp.frame, enabled: x } }))} />}>Khung tiêu đề</Title>
        {p.frame.enabled && <FrameTiming D={D} />}
      </Block>
      {deps.framePanel}
    </>
  );
  if (tab === 'captions') return <CaptionsPanel deps={deps} />;
  if (tab === 'transition') return <TransitionPanel seekAndPlay={deps.seekAndPlay} />;
  if (tab === 'audio') return <AudioPanel deps={deps} />;
  if (tab === 'video') return <VideoProps deps={deps} />;
  if (tab === 'image') return <MediaPanel deps={deps} />;
  if (tab === 'text') return (
    <>
      <Block>
        <Title>Thêm chữ</Title>
        <div className="grid grid-cols-1 gap-1.5">
          {TEXT_PRESETS.map((pr) => (
            <button key={pr.key} type="button" onClick={() => addText({ ...pr.patch, name: pr.label, text: pr.label })}
              className="h-11 rounded border border-slate-700 hover:border-blue-500 bg-[#232a38] flex items-center justify-center"
              style={{ fontFamily: "'DT Phudu','Montserrat',sans-serif", fontWeight: pr.patch.weight, color: pr.patch.color, fontSize: 17,
                textTransform: pr.patch.uppercase ? 'uppercase' : 'none', textShadow: pr.patch.strokeColor ? `0 0 2px ${pr.patch.strokeColor},0 0 2px ${pr.patch.strokeColor}` : undefined }}>
              <span style={{ background: pr.patch.bg || undefined, padding: pr.patch.bg ? '2px 8px' : undefined, borderRadius: 4 }}>{pr.label}</span>
            </button>
          ))}
        </div>
      </Block>
      {p.overlays.some((l) => l.kind === 'text') && (
        <Block>
          <Title>Chữ đang có</Title>
          {[...p.overlays].reverse().filter((l) => l.kind === 'text').map((l) => (
            <div key={l.id} className="flex items-center gap-2 text-[12px] text-slate-300 px-2 py-1.5 rounded border border-slate-700 hover:border-slate-500 cursor-pointer" onClick={() => { select({ type: 'overlay', id: l.id }); deps.seek(l.start); }}>
              <span className="flex-1 truncate">{(l as TextLayer).text}</span>
              <span className="text-[10px] text-slate-500 font-mono">{fmtTime(l.start)}</span>
            </div>
          ))}
        </Block>
      )}
    </>
  );
  return null;
}

// ───────────── Cột phải ─────────────
export function Inspector({ deps }: { deps: PanelDeps }) {
  const p = useEditor((s) => s.project) as Project;
  const sel = useEditor((s) => s.selected);
  const update = useEditor((s) => s.update);
  const select = useEditor((s) => s.select);
  const D = timelineDuration(p);
  if (!sel) return (
    <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-slate-500 px-4">
      <div className="text-[12px]">Chọn một clip trên timeline hoặc một phần tử trên video để chỉnh.</div>
      <div className="text-[11px] font-mono text-slate-600">{fmtTime(D)} · {p.voices.length} giọng · {p.overlays.length} lớp · {p.captions.length} phụ đề</div>
    </div>
  );
  if (sel.type === 'video') return <VideoProps deps={deps} />;
  if (sel.type === 'frame' || sel.type === 'brand') return (
    <Block>
      <Title extra={<Switch size="small" checked={p.frame.enabled} onChange={(x) => update((pp) => ({ ...pp, frame: { ...pp.frame, enabled: x } }))} />}>Khung tiêu đề</Title>
      <FrameTiming D={D} />
    </Block>
  );
  if (sel.type === 'bgm' && p.bgm) return <BgmProps D={D} />;
  if (sel.type === 'transition') return <TransitionPanel seekAndPlay={deps.seekAndPlay} />;
  if (sel.type === 'captions') return <CaptionsPanel deps={deps} />;
  if (sel.type === 'overlay') {
    const l = p.overlays.find((x) => x.id === sel.id);
    return l ? <OverlayProps key={l.id} l={l} D={D} /> : null;
  }
  if (sel.type === 'voice') {
    const v = p.voices.find((x) => x.id === sel.id);
    return v ? <VoiceProps key={v.id} v={v} deps={deps} /> : null;
  }
  if (sel.type === 'caption') {
    const c = p.captions.find((x) => x.id === sel.id);
    if (!c) return null;
    return (
      <Block>
        <Title extra={<Tooltip title="Xoá dòng"><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => { update((pp) => ({ ...pp, captions: pp.captions.filter((x) => x.id !== c.id) })); select(null); }} /></Tooltip>}>Dòng phụ đề</Title>
        <TextArea autoSize value={c.text} onChange={(e) => update((pp) => ({ ...pp, captions: pp.captions.map((x) => (x.id === c.id ? retime({ ...x, text: e.target.value }) : x)) }), { key: `cap:${c.id}` })} />
        <TimeRange start={c.start} end={c.end} max={D} onChange={(s, e) => update((pp) => ({ ...pp, captions: pp.captions.map((x) => (x.id === c.id ? retime({ ...x, start: s, end: e }) : x)) }), { key: `cap:${c.id}:time` })} />
        <Button size="small" block onClick={() => select({ type: 'captions' })}>Kiểu chữ phụ đề</Button>
      </Block>
    );
  }
  return null;
}
