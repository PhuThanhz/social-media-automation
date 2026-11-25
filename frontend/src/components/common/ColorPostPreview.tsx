import { Tag } from 'antd';
import { LikeOutlined, MessageOutlined, ShareAltOutlined } from '@ant-design/icons';
import { getColorBackgroundPreset } from '../../utils/colorBackgroundPresets';

// Facebook tự hủy phông nền khi status dài hơn 130 ký tự; worker cắt còn 126 ký tự + "..." trước khi gõ.
const COLOR_POST_MAX_CHARS = 130;

interface ColorPostPreviewProps {
  text: string;
  comment?: string | null;
  authorName?: string;
  hasMedia?: boolean;
  mode?: boolean | 'RED_PHOTO_TRICK';
  preset?: string;
}

const ColorPostPreview = ({ text, comment, authorName = 'Fanpage', hasMedia, mode, preset }: ColorPostPreviewProps) => {
  // Mẹo 3 chấm chỉ hỗ trợ nền đỏ.
  const bg = getColorBackgroundPreset(mode === 'RED_PHOTO_TRICK' ? 'RED' : preset);
  const trimmed = (text || '').trim();
  const postedText = trimmed.length > COLOR_POST_MAX_CHARS ? trimmed.slice(0, 126) + '...' : trimmed;
  const fontSize = postedText.length <= 60 ? 'text-[26px]' : postedText.length <= 100 ? 'text-[22px]' : 'text-lg';
  const commentText = (comment || '').trim();
  const initial = authorName.trim().charAt(0).toUpperCase() || 'F';

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-300">Xem trước trên Facebook</span>
        {hasMedia && (
          <Tag className="!m-0 text-[11px]">
            {mode === 'RED_PHOTO_TRICK' ? 'Ảnh bị gỡ sau khi đăng' : 'Ảnh không được đăng'}
          </Tag>
        )}
      </div>

      <div className="mx-auto w-full max-w-[460px] overflow-hidden rounded-lg bg-[#242526] text-[#e4e6eb]">
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <div className="w-9 h-9 rounded-full bg-blue-600 text-white font-semibold flex items-center justify-center text-sm">{initial}</div>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold">{authorName}</div>
            <div className="text-[11px] text-[#b0b3b8]">Vừa xong</div>
          </div>
        </div>

        <div className="min-h-[240px] flex items-center justify-center px-6 py-8" style={{ background: bg.css }}>
          <p style={{ color: bg.textColor }} className={`m-0 font-bold text-center leading-snug whitespace-pre-wrap break-words ${fontSize}`}>
            {postedText || 'Nhập caption để xem trước'}
          </p>
        </div>

        <div className="flex items-center justify-around border-t border-[#3e4042] mx-3 py-1.5 text-[12px] text-[#b0b3b8] font-semibold">
          <span className="flex items-center gap-1.5"><LikeOutlined /> Thích</span>
          <span className="flex items-center gap-1.5"><MessageOutlined /> Bình luận</span>
          <span className="flex items-center gap-1.5"><ShareAltOutlined /> Chia sẻ</span>
        </div>

        <div className="border-t border-[#3e4042] px-3 py-2.5">
          {commentText ? (
            <div className="flex items-start gap-2">
              <div className="w-7 h-7 shrink-0 rounded-full bg-blue-600 text-white font-semibold flex items-center justify-center text-xs">{initial}</div>
              <div className="min-w-0 rounded-2xl bg-[#3a3b3c] px-3 py-2">
                <div className="text-[12px] font-semibold">{authorName}</div>
                <div className="text-[13px] whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{commentText}</div>
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-[#b0b3b8]">Không có bình luận</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ColorPostPreview;
