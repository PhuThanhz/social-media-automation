import { useMemo, useState } from 'react';
import { App, Button, Checkbox, Input, Modal, Tag } from 'antd';
import api from '../../config/axios';
import ColorBackgroundPicker from '../common/ColorBackgroundPicker';
import TextCardBackgroundGrid from '../common/TextCardBackgroundGrid';
import { COLOR_BACKGROUND_PRESETS } from '../../utils/colorBackgroundPresets';
import { TEXT_CARD_BACKGROUNDS, getTextCardBackground } from '../../utils/textCardBackgrounds';
import { TEXT_CARD_FONTS, TEXT_CARD_LAYOUTS, buildTextCardHtml, type TextCardLayout, type TextCardRatio } from '../../utils/textCardTemplate';
import { TextCardChoice, TextCardFontPicker, TextCardLayoutPicker } from '../common/TextCardControls';

// "Dán nhiều bài chữ": mỗi đoạn chữ thành 1 bài. Quy tắc nền (người dùng chốt 25/11/2026, đã thử trên FB):
// bài ≤ 130 ký tự → phông nền Facebook; dài hơn → vẽ thành "Ảnh chữ" (FB ẩn nút phông nền khi chữ dài hơn).
export const FB_BACKGROUND_MAX_CHARS = 130;

export interface TextBulkPost {
  text: string;
  colorBackgroundPreset?: string; // có = đăng phông nền Facebook
  imageUrl?: string; // có = ảnh chữ đã render
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (posts: TextBulkPost[]) => void;
}

type SplitMode = 'blank' | 'dash' | 'line';

const splitPosts = (raw: string, mode: SplitMode) => {
  const parts = mode === 'line'
    ? raw.split(/\r?\n/)
    : mode === 'dash'
      ? raw.split(/^\s*-{3,}\s*$/m)
      : raw.split(/\r?\n\s*\r?\n/);
  return parts.map((p) => p.trim()).filter(Boolean);
};

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

export default function TextBulkModal({ open, onClose, onCreate }: Props) {
  const { message } = App.useApp();
  const [raw, setRaw] = useState('');
  const [splitMode, setSplitMode] = useState<SplitMode>('blank');
  const [fbPreset, setFbPreset] = useState('RAINBOW');
  const [fbRandom, setFbRandom] = useState(false);
  const [cardBgId, setCardBgId] = useState(TEXT_CARD_BACKGROUNDS[0].id);
  const [cardRandom, setCardRandom] = useState(true);
  const [fontKey, setFontKey] = useState<string>(TEXT_CARD_FONTS[0].key);
  const [ratio, setRatio] = useState<TextCardRatio>('1:1');
  const [layout, setLayout] = useState<TextCardLayout>('center');
  const [layoutRandom, setLayoutRandom] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const posts = useMemo(() => splitPosts(raw, splitMode), [raw, splitMode]);
  const shortCount = posts.filter((p) => p.length <= FB_BACKGROUND_MAX_CHARS).length;
  const longCount = posts.length - shortCount;

  const handleCreate = async () => {
    if (posts.length === 0) return message.warning('Dán ít nhất 1 đoạn chữ');
    const out: TextBulkPost[] = [];
    setProgress({ done: 0, total: longCount });
    let done = 0;
    try {
      for (const text of posts) {
        if (text.length <= FB_BACKGROUND_MAX_CHARS) {
          out.push({ text, colorBackgroundPreset: fbRandom ? pick(COLOR_BACKGROUND_PRESETS).key : fbPreset });
          continue;
        }
        const bg = cardRandom ? pick(TEXT_CARD_BACKGROUNDS) : getTextCardBackground(cardBgId);
        const html = buildTextCardHtml({
          text: text.replace(/https?:\/\/\S+/gi, '').trim(),
          background: bg.css,
          textColor: bg.textColor,
          fontKey,
          ratio,
          align: 'center',
          layout: layoutRandom ? pick(TEXT_CARD_LAYOUTS.map((l) => l.key)) : layout,
        });
        const res = await api.post('/news-card/render', { html });
        if (!res.data?.success || !res.data.url) throw new Error(res.data?.error || `Không vẽ được ảnh cho bài ${out.length + 1}`);
        out.push({ text, imageUrl: res.data.url as string });
        done += 1;
        setProgress({ done, total: longCount });
      }
      onCreate(out);
      message.success(`Đã thêm ${out.length} bài (${shortCount} nền Facebook, ${longCount} ảnh chữ)`);
      setRaw('');
      onClose();
    } catch (e: any) {
      message.error('Tạo bài lỗi: ' + (e?.response?.data?.error || e.message));
    } finally {
      setProgress(null);
    }
  };

  return (
    <Modal
      title="Dán nhiều bài chữ"
      open={open}
      onCancel={progress ? undefined : onClose}
      width={1080}
      centered
      className="tc-modal"
      footer={[
        <Button key="cancel" onClick={onClose} disabled={!!progress}>Hủy</Button>,
        <Button key="ok" type="primary" loading={!!progress} onClick={handleCreate} disabled={posts.length === 0}>
          {progress && progress.total > 0 ? `Đang vẽ ảnh ${progress.done}/${progress.total}` : `Tạo ${posts.length} bài`}
        </Button>,
      ]}
    >
      <div className="text-bulk">
        <div className="text-bulk__col">
          <section className="tc-section">
            <div className="tc-section__title">Nội dung</div>
            <div className="tc-row">
              <span className="tc-row__label">Mỗi bài cách nhau bằng</span>
              <TextCardChoice
                value={splitMode}
                onChange={setSplitMode}
                options={[{ label: 'Dòng trống', value: 'blank' }, { label: 'Dấu ---', value: 'dash' }, { label: 'Mỗi dòng 1 bài', value: 'line' }]}
              />
            </div>
            <Input.TextArea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              autoSize={{ minRows: 8, maxRows: 12 }}
              placeholder={'Bài thứ nhất...\n\nBài thứ hai...\n\nBài thứ ba...'}
            />
          </section>
          {posts.length > 0 && (
            <section className="tc-section">
              <div className="tc-section__title">
                {posts.length} bài <span className="tc-section__opt">{shortCount} nền Facebook · {longCount} ảnh chữ</span>
              </div>
              <div className="text-bulk__list">
                {posts.map((p, i) => (
                  <div key={i} className="text-bulk__item">
                    <span className="text-bulk__num">{i + 1}</span>
                    <span className="text-bulk__text">{p.replace(/\s+/g, ' ')}</span>
                    <Tag className="!m-0" color={p.length <= FB_BACKGROUND_MAX_CHARS ? 'blue' : 'purple'}>
                      {p.length} ký tự · {p.length <= FB_BACKGROUND_MAX_CHARS ? 'Nền Facebook' : 'Ảnh chữ'}
                    </Tag>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="text-bulk__col">
          <section className="tc-section">
            <div className="tc-row tc-row--between">
              <div className="tc-section__title">Bài ≤ {FB_BACKGROUND_MAX_CHARS} ký tự: phông nền Facebook</div>
              <Checkbox checked={fbRandom} onChange={(e) => setFbRandom(e.target.checked)}>Ngẫu nhiên</Checkbox>
            </div>
            {!fbRandom && <ColorBackgroundPicker value={fbPreset} onChange={setFbPreset} />}
          </section>

          <section className="tc-section">
            <div className="tc-section__title">Bài dài hơn: ảnh chữ</div>
            <div className="tc-row tc-row--between">
              <span className="tc-row__label">Bố cục</span>
              <Checkbox checked={layoutRandom} onChange={(e) => setLayoutRandom(e.target.checked)}>Ngẫu nhiên mỗi bài</Checkbox>
            </div>
            {!layoutRandom && <TextCardLayoutPicker value={layout} onChange={setLayout} />}
            <span className="tc-row__label">Kiểu chữ</span>
            <TextCardFontPicker value={fontKey} onChange={setFontKey} />
            <div className="tc-row">
              <span className="tc-row__label">Khung</span>
              <TextCardChoice value={ratio} onChange={setRatio} options={[{ label: 'Vuông 1:1', value: '1:1' }, { label: 'Dọc 4:5', value: '4:5' }]} />
            </div>
            <div className="tc-row tc-row--between">
              <span className="tc-row__label">Nền</span>
              <Checkbox checked={cardRandom} onChange={(e) => setCardRandom(e.target.checked)}>Ngẫu nhiên mỗi bài</Checkbox>
            </div>
            {!cardRandom && <TextCardBackgroundGrid value={cardBgId} onChange={setCardBgId} />}
          </section>
        </div>
      </div>
    </Modal>
  );
}
