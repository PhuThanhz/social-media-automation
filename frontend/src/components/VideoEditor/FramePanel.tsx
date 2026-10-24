// Tab "Khung" của Video Editor: gọn, trực quan — chọn kiểu khung bằng hình minh hoạ, màu bằng ô màu,
// phần ít dùng gom trong "Tuỳ chỉnh". Trạng thái khung vẫn nằm ở trang Studio (ctl) để trang và editor luôn khớp.
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Button, Collapse, Input, Segmented, Select, Slider, Switch, Tooltip, Upload, message } from 'antd';
import { SaveOutlined, LoadingOutlined, PlusOutlined } from '@ant-design/icons';
import { AlignCenter, AlignLeft, Eraser, Highlighter, Info, Sparkles, WandSparkles } from 'lucide-react';
import type { BandPosition, FrameLayout, VideoFrameStyle, VideoRatio } from '../../utils/videoFrameTemplate';
import { CARD_PRESETS, GLASS_PRESETS, isGlassBg } from '../../utils/videoFrameTemplate';
import { COLOR_PRESETS } from '../../utils/newsCardTemplate';

export interface FrameCtl {
  frame: VideoFrameStyle;
  setFrame: (patch: Partial<VideoFrameStyle>) => void;
  setLayout: (l: FrameLayout) => void;
  headline: string;
  setHeadline: (h: string) => void;
  aiWrite: () => void;
  aiHighlight: () => void;
  aiBusy: boolean;
  highlightBusy: boolean;
  isNews: boolean;
  newsOptions: Array<{ value: string; label: string } | { label: string; options: Array<{ value: string; label: string }> }>;
  onNewsOpen: () => void;
  savedFrames: Array<{ id: string; name: string }>;
  applySaved: (id: string) => void;
  openSave: () => void;
  logos: Array<{ name: string; url: string }>;
  uploadLogo: (f: File) => Promise<void>;
}

const LAYOUTS: Array<{ value: FrameLayout; label: string; thumb: ReactNode }> = [
  { value: 'card', label: 'Thẻ nổi', thumb: <><div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-violet-500/70" /><div className="absolute left-[18%] right-[18%] top-[42%] h-[24%] rounded-[3px] bg-[#24132f] border border-white/70" /></> },
  { value: 'panel', label: 'Dải dưới', thumb: <><div className="absolute inset-x-0 top-0 h-[64%] bg-slate-500/50" /><div className="absolute inset-x-0 bottom-0 h-[36%] bg-white border-t-2 border-red-500" /></> },
  { value: 'band', label: 'Dải chữ', thumb: <div className="absolute left-[10%] right-[10%] top-[40%] h-[20%] bg-white border-b-2 border-red-500" /> },
  { value: 'news', label: 'Mẫu ảnh tin', thumb: <><div className="absolute inset-x-[8%] top-[8%] h-[58%] bg-slate-500/60" /><div className="absolute inset-x-[8%] bottom-[8%] h-[22%] bg-white" /></> },
];

const Label = ({ children, extra }: { children: ReactNode; extra?: ReactNode }) => (
  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5"><span>{children}</span>{extra}</div>
);

function Swatch({ bg, accent, decor, on, onClick, title }: { bg: string; accent: string; decor?: string; on: boolean; onClick: () => void; title: string }) {
  return (
    <Tooltip title={title}>
      <button type="button" onClick={onClick} className={`relative w-9 h-9 rounded-md overflow-hidden border-2 transition ${on ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-700 hover:border-slate-500'}`}
        style={{ background: decor ? `linear-gradient(180deg, ${isGlassBg(bg) ? '#5b6573' : bg} 62%, ${decor} 62%)` : isGlassBg(bg) ? '#5b6573' : bg }}>
        {isGlassBg(bg) && <span className="absolute inset-[4px] rounded-sm border border-white/60" style={{ background: bg }} />}
        <span className="absolute left-1.5 right-1.5 top-[38%] h-1 rounded-full" style={{ background: accent }} />
      </button>
    </Tooltip>
  );
}

/** Hiện tiêu đề với các cụm [[...]] tô đúng màu nhấn, để thấy ngay chỗ nào đang được tô */
function HighlightPreview({ text, accent, upper }: { text: string; accent: string; upper: boolean }) {
  const parts = text.split(/(\[\[[\s\S]*?\]\])/g).filter(Boolean);
  return (
    <div className="rounded-md bg-[#0f1117] border border-slate-800 px-3 py-2 text-[12px] font-bold leading-snug text-slate-100" style={{ textTransform: upper ? 'uppercase' : 'none' }}>
      {parts.map((p, i) => { const m = p.match(/^\[\[([\s\S]*)\]\]$/); return m ? <span key={i} style={{ color: accent }}>{m[1]}</span> : <span key={i}>{p}</span>; })}
    </div>
  );
}

export default function FramePanel({ ctl }: { ctl: FrameCtl }) {
  const f = ctl.frame;
  const taRef = useRef<{ resizableTextArea?: { textArea: HTMLTextAreaElement } } | null>(null);
  const hasHl = ctl.headline.includes('[[');

  // Bôi đen chữ trong ô rồi bấm "Tô màu" → bọc [[ ]]; bôi đen đúng cụm đang tô thì bỏ tô
  const toggleHighlight = () => {
    const ta = taRef.current?.resizableTextArea?.textArea;
    const h = ctl.headline;
    if (!ta) return;
    let a = ta.selectionStart;
    let b = ta.selectionEnd;
    if (a === b) { message.info('Bôi đen cụm chữ cần tô màu trong ô rồi bấm "Tô màu"'); return; }
    // Nới vùng chọn nếu đang chạm dấu [[ ]] để không cắt đôi
    while (a > 0 && h[a - 1] === '[') a--;
    while (b < h.length && h[b] === ']') b++;
    const sel = h.slice(a, b);
    const inner = sel.replace(/\[\[|\]\]/g, '');
    const lead = inner.match(/^\s*/)![0];
    const trail = inner.match(/\s*$/)![0];
    const core = inner.trim();
    if (!core) return;
    const wasHl = /^\s*\[\[[\s\S]*\]\]\s*$/.test(sel) && !sel.slice(2, -2).includes('[[');
    const next = h.slice(0, a) + (wasHl ? `${lead}${core}${trail}` : `${lead}[[${core}]]${trail}`) + h.slice(b);
    ctl.setHeadline(next);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(a, a); });
  };
  const palettes = [
    ...(f.layout === 'card' ? CARD_PRESETS : []),
    ...GLASS_PRESETS,
    ...COLOR_PRESETS,
  ] as Array<{ label: string; bandBg: string; textColor: string; accent: string; decorColor?: string }>;

  return (
    <div className="space-y-5">
      {/* Tiêu đề */}
      <section>
        <Label extra={
          <span className="flex items-center gap-2">
            <Tooltip title="In hoa"><Segmented size="small" value={f.uppercase ? 'AA' : 'Aa'} onChange={(v) => ctl.setFrame({ uppercase: v === 'AA' })} options={['Aa', 'AA']} /></Tooltip>
            <Tooltip title='Bôi đen chữ rồi bấm "Tô màu". Cụm được tô sẽ hiện trong [[ ]] ở ô nhập.'><Info size={13} className="text-slate-500 cursor-help" /></Tooltip>
          </span>
        }>Chữ trên khung</Label>
        <Input.TextArea ref={taRef as never} value={ctl.headline} onChange={(e) => ctl.setHeadline(e.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} className="!text-[13px]" />
        <div className="flex items-center gap-1 mt-1.5">
          <Tooltip title="Bôi đen chữ trong ô rồi bấm để tô màu (bấm lại để bỏ)">
            <Button size="small" className="!px-2" icon={<Highlighter size={13} />} onMouseDown={(e) => e.preventDefault()} onClick={toggleHighlight}>Tô màu</Button>
          </Tooltip>
          {hasHl && <Tooltip title="Bỏ tô màu tất cả"><Button size="small" type="text" icon={<Eraser size={13} />} onClick={() => ctl.setHeadline(ctl.headline.replace(/\[\[|\]\]/g, ''))} /></Tooltip>}
          <Tooltip title="AI tự chọn cụm đắt giá để tô"><Button size="small" type="text" className="!text-violet-300 !px-1.5" icon={ctl.highlightBusy ? <LoadingOutlined /> : <WandSparkles size={13} />} onClick={ctl.aiHighlight}>AI tô</Button></Tooltip>
          <Tooltip title="AI viết lại tiêu đề"><Button size="small" type="text" className="!text-violet-300 !px-1.5" icon={ctl.aiBusy ? <LoadingOutlined /> : <Sparkles size={13} />} onClick={ctl.aiWrite}>AI viết</Button></Tooltip>
        </div>
        {hasHl && <div className="mt-2"><HighlightPreview text={ctl.headline} accent={ctl.isNews ? '#e3151a' : f.accent} upper={f.uppercase} /></div>}
      </section>

      {/* Kiểu khung */}
      <section>
        <Label>Kiểu khung</Label>
        <div className="grid grid-cols-4 gap-2">
          {LAYOUTS.map((l) => (
            <button key={l.value} type="button" onClick={() => ctl.setLayout(l.value)} className="group flex flex-col items-center gap-1">
              <span className={`relative w-full aspect-[9/14] rounded-md overflow-hidden bg-slate-700/60 border-2 transition ${f.layout === l.value ? 'border-blue-500' : 'border-transparent group-hover:border-slate-500'}`}>{l.thumb}</span>
              <span className={`text-[10px] ${f.layout === l.value ? 'text-blue-300' : 'text-slate-400'}`}>{l.label}</span>
            </button>
          ))}
        </div>
      </section>

      {ctl.isNews ? (
        <section>
          <Label>Mẫu từ Studio Ảnh Tin</Label>
          <Select size="small" className="w-full" value={f.newsSource || 'default'} onChange={(v) => ctl.setFrame({ newsSource: v })}
            onDropdownVisibleChange={(o) => { if (o) ctl.onNewsOpen(); }} options={ctl.newsOptions} />
        </section>
      ) : (
        <>
          {/* Màu */}
          <section>
            <Label>Màu</Label>
            <div className="flex flex-wrap gap-1.5">
              {palettes.map((p) => (
                <Swatch key={p.label} title={p.label} bg={p.bandBg} accent={p.accent} decor={p.decorColor}
                  on={p.bandBg === f.bandBg && p.accent === f.accent && (!p.decorColor || p.decorColor === f.decorColor)}
                  onClick={() => ctl.setFrame({ bandBg: p.bandBg, textColor: p.textColor, accent: p.accent, ...(p.decorColor ? { decorColor: p.decorColor } : {}) })} />
              ))}
            </div>
          </section>

          {/* Vị trí + cỡ */}
          {(f.layout === 'card' || f.layout === 'band') && (
            <section className="grid grid-cols-[1fr_auto] gap-2 items-end">
              <div>
                <Label>Vị trí</Label>
                <Segmented<BandPosition> size="small" block value={f.position || 'center'} onChange={(v) => ctl.setFrame({ position: v })}
                  options={[{ value: 'top', label: 'Trên' }, { value: 'center', label: 'Giữa' }, { value: 'bottom', label: 'Dưới' }]} />
              </div>
              {f.layout === 'card' && (
                <Segmented size="small" value={f.cardAlign} onChange={(v) => ctl.setFrame({ cardAlign: v as 'center' | 'left' })}
                  options={[{ value: 'center', icon: <AlignCenter size={13} className="mt-1" /> }, { value: 'left', icon: <AlignLeft size={13} className="mt-1" /> }]} />
              )}
            </section>
          )}
          <section>
            <Label extra={<span className="font-mono text-slate-300">{Math.round(f.fontScale * 100)}%</span>}>Cỡ chữ</Label>
            <Slider className="!my-0" min={0.8} max={1.3} step={0.05} value={f.fontScale} onChange={(v) => ctl.setFrame({ fontScale: v })} tooltip={{ open: false }} />
          </section>
        </>
      )}

      <Collapse ghost size="small" className="[&_.ant-collapse-header]:!px-0 [&_.ant-collapse-content-box]:!px-0 [&_.ant-collapse-header-text]:!text-[12px] [&_.ant-collapse-header-text]:!text-slate-300"
        items={[{
          key: 'more', label: 'Tuỳ chỉnh thêm', children: (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Tỉ lệ</Label>
                  <Select<VideoRatio> size="small" className="w-full" value={f.ratio} onChange={(v) => ctl.setFrame({ ratio: v })}
                    options={[...(ctl.isNews ? [] : [{ value: '9:16' as VideoRatio, label: '9:16 dọc' }]), { value: '4:5', label: '4:5' }, { value: '1:1', label: '1:1 vuông' }]} />
                </div>
                {f.layout !== 'band' && (
                  <div>
                    <Label>Clip trong khung</Label>
                    <Select size="small" className="w-full" value={f.videoFit} onChange={(v) => ctl.setFrame({ videoFit: v })}
                      options={[{ value: 'contain', label: 'Hiện trọn' }, { value: 'cover', label: 'Lấp kín' }]} />
                  </div>
                )}
              </div>
              {!ctl.isNews && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>Nhãn</Label><Input size="small" value={f.badgeText} onChange={(e) => ctl.setFrame({ badgeText: e.target.value })} placeholder="VD: TIN NÓNG" /></div>
                    <div><Label>Tên page</Label><Input size="small" value={f.pageName} onChange={(e) => ctl.setFrame({ pageName: e.target.value })} placeholder="VD: Làm Sen" /></div>
                  </div>
                  {f.layout === 'card' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label extra={<span className="font-mono text-slate-300">{f.cardOffsetY ?? 0}%</span>}>Dời thẻ</Label><Slider className="!my-0" min={-40} max={40} value={f.cardOffsetY ?? 0} onChange={(v) => ctl.setFrame({ cardOffsetY: v })} tooltip={{ open: false }} /></div>
                      <div><Label extra={<span className="font-mono text-slate-300">{Math.round((f.cardScale ?? 1) * 100)}%</span>}>To/nhỏ thẻ</Label><Slider className="!my-0" min={0.6} max={1.3} step={0.05} value={f.cardScale ?? 1} onChange={(v) => ctl.setFrame({ cardScale: v })} tooltip={{ open: false }} /></div>
                    </div>
                  )}
                  <div>
                    <Label extra={f.logoUrl && <button type="button" className="text-[11px] text-slate-400 hover:text-red-400" onClick={() => ctl.setFrame({ logoUrl: '' })}>Bỏ logo</button>}>Logo trên khung</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {ctl.logos.map((lg) => (
                        <Tooltip key={lg.url} title={lg.name}>
                          <button type="button" onClick={() => ctl.setFrame({ logoUrl: lg.url })}
                            className={`w-9 h-9 rounded-full border-2 bg-white bg-center bg-cover ${f.logoUrl === lg.url ? 'border-blue-500' : 'border-slate-700 hover:border-slate-500'}`} style={{ backgroundImage: `url('${lg.url}')` }} />
                        </Tooltip>
                      ))}
                      <Upload accept="image/*" showUploadList={false} customRequest={async ({ file, onSuccess, onError }) => {
                        try { await ctl.uploadLogo(file as File); onSuccess?.({}); } catch (e) { message.error('Upload logo lỗi'); onError?.(e as Error); }
                      }}>
                        <Tooltip title="Thêm logo"><button type="button" className="w-9 h-9 rounded-full border-2 border-dashed border-slate-600 hover:border-blue-500 text-slate-400 flex items-center justify-center"><PlusOutlined /></button></Tooltip>
                      </Upload>
                    </div>
                  </div>
                  {f.layout === 'card' && f.decorUrl && (
                    <div className="flex items-center justify-between text-[11px] text-slate-400">Nền màu chuyển sau ảnh trang trí <Switch size="small" checked={f.decorGradient} onChange={(v) => ctl.setFrame({ decorGradient: v })} /></div>
                  )}
                </>
              )}
            </div>
          ),
        }]} />

      {/* Kho khung */}
      <section className="pt-3 border-t border-slate-800/80">
        <Label>Khung đã lưu</Label>
        <div className="flex gap-1.5">
          <Select size="small" className="flex-1" placeholder={ctl.savedFrames.length ? 'Chọn khung đã lưu' : 'Chưa có khung nào'} disabled={!ctl.savedFrames.length}
            value={null} onChange={(v: string) => ctl.applySaved(v)} options={ctl.savedFrames.map((x) => ({ value: x.id, label: x.name }))} />
          <Tooltip title="Lưu khung hiện tại"><Button size="small" icon={<SaveOutlined />} onClick={ctl.openSave} /></Tooltip>
        </div>
      </section>
    </div>
  );
}
