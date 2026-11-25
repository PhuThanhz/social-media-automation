import { useEffect, useMemo, useState } from 'react';
import { App, Button, Input, Modal } from 'antd';
import api from '../../config/axios';
import { TEXT_CARD_BACKGROUNDS, getTextCardBackground } from '../../utils/textCardBackgrounds';
import {
  TEXT_CARD_FONTS,
  TEXT_CARD_WIDTH,
  buildTextCardHtml,
  layoutHasAlign,
  textCardHeight,
  type TextCardLayout,
  type TextCardRatio,
} from '../../utils/textCardTemplate';
import TextCardBackgroundGrid from '../common/TextCardBackgroundGrid';
import { TextCardChoice, TextCardFontPicker, TextCardLayoutPicker } from '../common/TextCardControls';

// Studio "Ảnh chữ": vẽ chữ của bài lên nền theo bố cục rồi gắn ảnh vào bài (thay vì dùng phông nền
// Facebook — không giới hạn 130 ký tự). Xem trước = đúng HTML worker sẽ chụp.

interface Props {
  open: boolean;
  text: string;
  onClose: () => void;
  onApply: (imageUrl: string) => void;
}


export default function TextCardModal({ open, text: initialText, onClose, onApply }: Props) {
  const { message } = App.useApp();
  const [text, setText] = useState('');
  const [bgId, setBgId] = useState(TEXT_CARD_BACKGROUNDS[0].id);
  const [layout, setLayout] = useState<TextCardLayout>('center');
  const [fontKey, setFontKey] = useState<string>(TEXT_CARD_FONTS[0].key);
  const [ratio, setRatio] = useState<TextCardRatio>('1:1');
  const [align, setAlign] = useState<'center' | 'left'>('center');
  const [colorMode, setColorMode] = useState('auto');
  const [signature, setSignature] = useState('');
  const [rendering, setRendering] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');

  useEffect(() => {
    if (open) setText(initialText.replace(/https?:\/\/\S+/gi, '').trim());
  }, [open, initialText]);

  const bg = getTextCardBackground(bgId);
  const html = useMemo(
    () => buildTextCardHtml({ text, background: bg.css, textColor: colorMode === 'auto' ? bg.textColor : colorMode, fontKey, ratio, align, layout, signature }),
    [text, bg, colorMode, fontKey, ratio, align, layout, signature],
  );
  // Gõ chữ thì đợi một nhịp mới dựng lại iframe để khỏi nháy liên tục
  useEffect(() => {
    const t = setTimeout(() => setPreviewHtml(html), 200);
    return () => clearTimeout(t);
  }, [html]);

  const height = textCardHeight(ratio);
  // Khung dọc 4:5 thu nhỏ bề ngang để ảnh xem trước + bố cục vẫn nằm gọn trong cột trái
  const PREVIEW_W = ratio === '4:5' ? 352 : 440;
  const scale = PREVIEW_W / TEXT_CARD_WIDTH;

  const pickRandom = () => setBgId(TEXT_CARD_BACKGROUNDS[Math.floor(Math.random() * TEXT_CARD_BACKGROUNDS.length)].id);

  const handleCreate = async () => {
    if (!text.trim()) return message.warning('Nhập chữ cần đưa lên ảnh');
    setRendering(true);
    try {
      const res = await api.post('/news-card/render', { html });
      if (!res.data?.success || !res.data.url) throw new Error(res.data?.error || 'Không tạo được ảnh');
      onApply(res.data.url as string);
      message.success('Đã tạo ảnh chữ và gắn vào bài');
    } catch (e: any) {
      message.error('Tạo ảnh lỗi: ' + (e?.response?.data?.error || e.message));
    } finally {
      setRendering(false);
    }
  };

  return (
    <Modal
      title={null}
      open={open}
      onCancel={onClose}
      width={1140}
      centered
      destroyOnHidden
      footer={null}
      className="tc-modal"
    >
      <div className="tc-studio">
        <div className="tc-stage">
          <div className="tc-stage__title">Tạo ảnh chữ</div>
          <div className="tc-stage__canvas">
            <div style={{ width: PREVIEW_W, height: height * scale }} className="tc-stage__frame">
              <iframe
                title="Xem trước ảnh chữ"
                srcDoc={previewHtml}
                sandbox="allow-scripts"
                style={{ width: TEXT_CARD_WIDTH, height, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }}
              />
            </div>
          </div>
          <section className="tc-section tc-stage__layout">
            <div className="tc-section__title">Bố cục</div>
            <TextCardLayoutPicker value={layout} onChange={setLayout} />
            <div className="tc-row">
              <span className="tc-row__label">Khung</span>
              <TextCardChoice value={ratio} onChange={setRatio} options={[{ label: 'Vuông 1:1', value: '1:1' }, { label: 'Dọc 4:5', value: '4:5' }]} />
              {layoutHasAlign(layout) && (
                <>
                  <span className="tc-row__label">Căn</span>
                  <TextCardChoice value={align} onChange={setAlign} options={[{ label: 'Giữa', value: 'center' }, { label: 'Trái', value: 'left' }]} />
                </>
              )}
            </div>
          </section>
          <div className="tc-stage__meta">
            <span>{TEXT_CARD_WIDTH} × {height} px</span>
            <span>Ảnh được gắn làm media của bài, caption giữ nguyên</span>
          </div>
        </div>

        <div className="tc-panel">
          <div className="tc-panel__scroll">
            <section className="tc-section">
              <div className="tc-section__title">Nội dung</div>
              <Input.TextArea
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder="Chữ sẽ hiện trên ảnh"
              />
              <div className="tc-hint">Viết [[cụm từ]] để tô màu nhấn. Xuống dòng để ngắt câu theo ý bạn.</div>
              <Input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="Chữ ký dưới chữ (tùy chọn), vd. tên page" />
            </section>

            <section className="tc-section">
              <div className="tc-section__title">Nền</div>
              <TextCardBackgroundGrid value={bgId} onChange={setBgId} extra={<button type="button" className="tc-link-btn" onClick={pickRandom}>Ngẫu nhiên</button>} />
            </section>

            <section className="tc-section">
              <div className="tc-section__title">Kiểu chữ</div>
              <TextCardFontPicker value={fontKey} onChange={setFontKey} />
              {layout !== 'card' && (
                <div className="tc-row">
                  <span className="tc-row__label">Màu chữ</span>
                  <TextCardChoice value={colorMode} onChange={setColorMode} options={[{ label: 'Tự động', value: 'auto' }, { label: 'Trắng', value: '#ffffff' }, { label: 'Đen', value: '#1a1a1a' }]} />
                </div>
              )}
            </section>

          </div>

          <div className="tc-panel__footer">
            <Button onClick={onClose}>Hủy</Button>
            <Button type="primary" loading={rendering} onClick={handleCreate}>Tạo ảnh và gắn vào bài</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
