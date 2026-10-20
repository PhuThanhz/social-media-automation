import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Input, Modal, Upload, message } from 'antd';
import { ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import api from '../../config/axios';

// Ảnh "thẻ tin tức": ảnh gốc phía trên, dải trắng với tiêu đề IN HOA, cụm [[...]] tô đỏ.
// Preview ở đây mô phỏng đúng layout của worker/news-card.js (khung 1440px thu nhỏ lại).

export interface NewsCardSource {
  title?: string;
  sapo?: string;
  content?: string;
  imageUrl?: string;
  images?: string[];
  headline?: string; // tiêu đề đã có (khi sửa lại ảnh) — có thì không gọi AI
}

interface Props {
  open: boolean;
  source: NewsCardSource | null;
  onClose: () => void;
  onApply: (cardUrl: string, headline: string) => void;
}

const CARD = 1440;
const RED = '#e3151a';
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@800;900&display=swap&subset=vietnamese';

const ensureFont = () => {
  if (document.querySelector(`link[href="${FONT_HREF}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONT_HREF;
  document.head.appendChild(link);
};

const renderHeadline = (headline: string) =>
  headline.split(/(\[\[[\s\S]*?\]\])/g).map((part, i) => {
    const m = part.match(/^\[\[([\s\S]*?)\]\]$/);
    return m ? <span key={i} style={{ color: RED }}>{m[1]}</span> : <span key={i}>{part}</span>;
  });

export const requestNewsCardHeadline = async (src: NewsCardSource): Promise<string> => {
  const res = await api.post('/news-card/headline', {
    title: src.title || '',
    sapo: src.sapo || '',
    content: src.content || src.sapo || '',
  });
  if (!res.data?.success || !res.data.headline) throw new Error(res.data?.error || 'AI không trả về tiêu đề');
  // Bỏ dấu chấm cuối câu (tiêu đề ảnh không cần)
  return (res.data.headline as string).trim().replace(/[.。]+$/, '');
};

export const requestNewsCardRender = async (imageUrl: string, headline: string, insetImageUrl?: string): Promise<string> => {
  const res = await api.post('/news-card/render', { imageUrl, headline, insetImageUrl: insetImageUrl || undefined });
  if (!res.data?.success || !res.data.url) throw new Error(res.data?.error || 'Không tạo được ảnh');
  return res.data.url as string;
};

export default function NewsCardModal({ open, source, onClose, onApply }: Props) {
  const [headline, setHeadline] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [insetUrl, setInsetUrl] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const textAreaRef = useRef<any>(null);

  const previewBoxRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const [fontSize, setFontSize] = useState(84);

  const candidates = Array.from(new Set([source?.imageUrl, ...(source?.images || [])].filter(Boolean) as string[]));

  const generateHeadline = async (src: NewsCardSource | null) => {
    if (!src || (!src.title && !src.content && !src.sapo)) {
      message.warning('Chưa có tiêu đề hoặc nội dung bài để AI viết');
      return;
    }
    setAiLoading(true);
    try {
      setHeadline(await requestNewsCardHeadline(src));
    } catch (e: any) {
      message.error('AI viết tiêu đề lỗi: ' + (e?.response?.data?.error || e.message));
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    ensureFont();
    setImageUrl(source?.imageUrl || source?.images?.[0] || '');
    setInsetUrl('');
    setHeadline(source?.headline || '');
    if (!source?.headline && (source?.title || source?.content)) generateHeadline(source);
    // Chỉ reset khi vừa mở modal (source là object mới mỗi lần trang cha render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Thu nhỏ khung 1440px vừa bề rộng ô preview
  useLayoutEffect(() => {
    if (!open) return;
    const el = previewBoxRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / CARD);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  // Co cỡ chữ giống worker: tối đa ~4 dòng và không quá 32% chiều cao
  useLayoutEffect(() => {
    const el = headlineRef.current;
    if (!el) return;
    let size = 84;
    el.style.fontSize = `${size}px`;
    const lines = () => Math.round((el.scrollHeight - 96) / (size * 1.2));
    while (size > 40 && (el.offsetHeight > CARD * 0.32 || lines() > 4)) {
      size -= 2;
      el.style.fontSize = `${size}px`;
    }
    setFontSize(size);
  }, [headline, open]);

  const highlightSelection = () => {
    const ta: HTMLTextAreaElement | undefined = textAreaRef.current?.resizableTextArea?.textArea;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    if (s === e) {
      message.info('Bôi đen một cụm trong ô tiêu đề rồi bấm lại');
      return;
    }
    setHeadline(headline.slice(0, s) + '[[' + headline.slice(s, e) + ']]' + headline.slice(e));
  };

  const handleUpload = async (file: File, target: 'main' | 'inset') => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post('/media/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (res.data?.success && res.data.url) {
        if (target === 'main') setImageUrl(res.data.url);
        else setInsetUrl(res.data.url);
      }
    } catch (e: any) {
      message.error('Tải ảnh lỗi: ' + (e?.response?.data?.message || e.message));
    }
    return false;
  };

  const handleCreate = async () => {
    if (!imageUrl.trim()) return message.warning('Chọn ảnh chính trước');
    if (!headline.trim()) return message.warning('Nhập tiêu đề trước');
    setRendering(true);
    try {
      const url = await requestNewsCardRender(imageUrl.trim(), headline.trim(), insetUrl.trim());
      onApply(url, headline.trim());
      message.success('Đã tạo ảnh tin');
    } catch (e: any) {
      message.error('Tạo ảnh lỗi: ' + (e?.response?.data?.error || e.message));
    } finally {
      setRendering(false);
    }
  };

  return (
    <Modal
      title="Tạo ảnh tin tức"
      open={open}
      onCancel={onClose}
      width={980}
      className="max-w-[calc(100vw-24px)]"
      footer={[
        <Button key="cancel" onClick={onClose}>Hủy</Button>,
        <Button key="ok" type="primary" loading={rendering} onClick={handleCreate}>Tạo ảnh và dùng cho bài này</Button>,
      ]}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 py-2">
        {/* Preview */}
        <div>
          <div ref={previewBoxRef} className="relative w-full aspect-square overflow-hidden rounded-lg border border-slate-700 bg-white">
            <div
              style={{
                width: CARD, height: CARD, transform: `scale(${scale})`, transformOrigin: 'top left',
                display: 'flex', flexDirection: 'column', background: '#fff', position: 'absolute', left: 0, top: 0,
              }}
            >
              <div style={{ flex: '1 1 auto', minHeight: 0, background: '#111', overflow: 'hidden' }}>
                {imageUrl && (
                  <img src={imageUrl} referrerPolicy="no-referrer" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                )}
              </div>
              <div
                ref={headlineRef}
                style={{
                  flex: '0 0 auto', padding: '44px 56px 52px', textAlign: 'center', fontSize,
                  fontFamily: "'Montserrat', 'Arial Black', 'Helvetica Neue', Arial, sans-serif",
                  fontWeight: 900, textTransform: 'uppercase', color: '#111', lineHeight: 1.2, letterSpacing: -0.5,
                  wordBreak: 'break-word', whiteSpace: 'pre-wrap',
                }}
              >
                {headline ? renderHeadline(headline) : <span style={{ color: '#bbb' }}>Tiêu đề sẽ hiện ở đây</span>}
              </div>
              {insetUrl && (
                <div style={{
                  position: 'absolute', left: 40, top: 40, width: 380, height: 380, borderRadius: '50%',
                  border: `12px solid ${RED}`, overflow: 'hidden', background: '#222', boxShadow: '0 6px 24px rgba(0,0,0,.35)',
                }}>
                  <img src={insetUrl} referrerPolicy="no-referrer" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
            </div>
          </div>
          <div className="text-[11px] text-slate-500 mt-2">Xem trước gần đúng. Ảnh thật 1440×1440 do hệ thống dựng khi bấm Tạo ảnh.</div>
        </div>

        {/* Controls */}
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-300">Tiêu đề trên ảnh</span>
              <div className="flex gap-2">
                <Button size="small" onClick={highlightSelection}>Tô đỏ đoạn đang chọn</Button>
                <Button size="small" icon={<ReloadOutlined />} loading={aiLoading} onClick={() => generateHeadline(source)}>AI viết lại</Button>
              </div>
            </div>
            <Input.TextArea
              ref={textAreaRef}
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              autoSize={{ minRows: 4, maxRows: 8 }}
              placeholder="Ví dụ: Từng kiếm [[45.000 NDT/tháng]], [[nữ giám đốc 45 tuổi]] giờ đi bán hoa quả..."
            />
            <div className="text-[11px] text-slate-500 mt-1">Phần nằm trong [[ ]] sẽ in màu đỏ. Chữ tự in hoa và tự co cho vừa khung.</div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-300 mb-1">Ảnh chính</div>
            {candidates.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-2">
                {candidates.slice(0, 12).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setImageUrl(u)}
                    onContextMenu={(e) => { e.preventDefault(); setInsetUrl(insetUrl === u ? '' : u); }}
                    className={`w-14 h-14 rounded-md overflow-hidden border-2 cursor-pointer p-0 ${imageUrl === u ? 'border-blue-500' : insetUrl === u ? 'border-red-500' : 'border-slate-700'}`}
                    title="Bấm: làm ảnh chính · Chuột phải: làm ảnh tròn"
                  >
                    <img src={u} referrerPolicy="no-referrer" alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input size="small" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="URL ảnh chính" />
              <Upload accept="image/*" showUploadList={false} beforeUpload={(f) => handleUpload(f, 'main')}>
                <Button size="small" icon={<UploadOutlined />}>Tải lên</Button>
              </Upload>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-300 mb-1">Ảnh tròn ở góc (không bắt buộc)</div>
            <div className="flex gap-2">
              <Input size="small" value={insetUrl} onChange={(e) => setInsetUrl(e.target.value)} placeholder="URL ảnh nhỏ, hoặc chuột phải vào ảnh ở trên" allowClear />
              <Upload accept="image/*" showUploadList={false} beforeUpload={(f) => handleUpload(f, 'inset')}>
                <Button size="small" icon={<UploadOutlined />}>Tải lên</Button>
              </Upload>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
