import { useState, type ReactNode } from 'react';
import { CommentOutlined, GlobalOutlined, LikeOutlined, ShareAltOutlined } from '@ant-design/icons';

// Khung mô phỏng 1 bài đăng Facebook (nền trắng như Facebook thật) để xem trước ảnh + caption trước khi đăng
export default function FacebookPostPreview({
  pageName,
  avatarUrl,
  caption,
  comment,
  children,
}: {
  pageName: string;
  avatarUrl?: string;
  caption: string;
  comment?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = caption.split('\n');
  const long = lines.length > 5 || caption.length > 320;
  const shown = expanded || !long ? caption : lines.slice(0, 5).join('\n').slice(0, 320).trimEnd() + '...';
  const initial = (pageName.trim()[0] || 'P').toUpperCase();

  const avatar = (size: string) =>
    avatarUrl ? (
      <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className={`${size} rounded-full object-contain bg-white border border-[#e4e6eb] shrink-0`} />
    ) : (
      <div className={`${size} rounded-full bg-[#1877f2] text-white font-bold grid place-items-center shrink-0`}>{initial}</div>
    );

  return (
    <div className="fb-post-mock w-full max-w-[560px] mx-auto rounded-lg border border-[#dadde1] overflow-hidden shadow-sm"
      style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}
    >
      <div className="flex items-center gap-2.5 px-3 pt-3">
        {avatar('w-10 h-10 text-base')}
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-tight truncate">{pageName}</div>
          <div className="text-[13px] text-[#65676b] flex items-center gap-1">Vừa xong · <GlobalOutlined className="text-[11px]" /></div>
        </div>
      </div>

      {caption.trim() && (
        <div className="px-3 pt-2 pb-2.5 text-[15px] leading-[1.35] whitespace-pre-wrap break-words">
          {shown}
          {long && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="ml-1 font-semibold text-[#050505] bg-transparent border-0 p-0 cursor-pointer hover:underline">
              {expanded ? 'Ẩn bớt' : 'Xem thêm'}
            </button>
          )}
        </div>
      )}

      {children}

      <div className="flex items-center justify-between px-3 py-2 text-[13px] text-[#65676b]">
        <span className="flex items-center gap-1.5">
          <span className="w-[18px] h-[18px] rounded-full bg-[#1877f2] text-white grid place-items-center text-[10px]"><LikeOutlined /></span>
          1,2K
        </span>
        <span>86 bình luận · 24 lượt chia sẻ</span>
      </div>
      <div className="mx-3 border-t border-[#ced0d4] grid grid-cols-3 py-1 text-[15px] font-semibold text-[#65676b]">
        <span className="flex items-center justify-center gap-2 py-1.5"><LikeOutlined /> Thích</span>
        <span className="flex items-center justify-center gap-2 py-1.5"><CommentOutlined /> Bình luận</span>
        <span className="flex items-center justify-center gap-2 py-1.5"><ShareAltOutlined /> Chia sẻ</span>
      </div>

      {comment?.trim() && (
        <div className="flex gap-2 px-3 pt-1 pb-3 border-t border-[#ced0d4]">
          {avatar('w-8 h-8 text-sm mt-2')}
          <div className="mt-2 rounded-2xl bg-[#f0f2f5] px-3 py-2 min-w-0">
            <div className="text-[13px] font-semibold">{pageName}</div>
            <div className="text-[15px] leading-[1.35] whitespace-pre-wrap break-words line-clamp-6">{comment}</div>
          </div>
        </div>
      )}
    </div>
  );
}
