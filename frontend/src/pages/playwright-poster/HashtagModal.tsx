import { memo } from 'react';
import type React from 'react';
import { Input, Tag, Modal, Alert } from 'antd';
import { TagOutlined } from '@ant-design/icons';
import type { PostLinkItem } from './types';

interface HashtagModalProps {
  isHashtagModalOpen: boolean;
  setIsHashtagModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  hashtagInput: string;
  setHashtagInput: React.Dispatch<React.SetStateAction<string>>;
  hashtagTargetItemId: string;
  linkItems: PostLinkItem[];
  applyHashtagsToPosts: (tagsText: string) => void;
}

// Chèn hashtag — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
function HashtagModal({
  isHashtagModalOpen,
  setIsHashtagModalOpen,
  hashtagInput,
  setHashtagInput,
  hashtagTargetItemId,
  linkItems,
  applyHashtagsToPosts,
}: HashtagModalProps) {
  return (
    <Modal
      title={
        <div className="flex items-center gap-2 text-slate-100 font-bold text-base">
          <TagOutlined className="text-pink-400" />
          <span>{hashtagTargetItemId ? 'Thêm Hashtag cho bài viết này' : 'Gán Hashtag hàng loạt (Tất cả bài)'}</span>
        </div>
      }
      open={isHashtagModalOpen}
      onCancel={() => setIsHashtagModalOpen(false)}
      onOk={() => applyHashtagsToPosts(hashtagInput)}
      okText="Áp dụng ngay"
      cancelText="Hủy"
      okButtonProps={{
        className: 'bg-pink-600 hover:bg-pink-500 font-bold border-none shadow-sm',
      }}
      destroyOnClose
      centered
      className="custom-hashtag-modal"
    >
      <div className="space-y-4 py-2">
        <Alert
          type="info"
          showIcon
          message={
            hashtagTargetItemId
              ? 'Hashtag sẽ được chèn vào cuối caption (nếu có dòng Cre thì Hashtag sẽ nằm phía trên Cre).'
              : `Hashtag sẽ được chèn vào cuối caption cho TOÀN BỘ ${linkItems.length} bài viết.`
          }
          className="bg-pink-950/40 border-pink-800/40 text-pink-200 text-xs"
        />

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-300">
            Nhập các Hashtag (Cách nhau bằng dấu phẩy hoặc khoảng trắng):
          </label>
          <Input.TextArea
            rows={3}
            placeholder="VD: #Trending #Review #GiaDinh #AmThuc hoặc trending, review, amthuc..."
            value={hashtagInput}
            onChange={(e) => setHashtagInput(e.target.value)}
            allowClear
            autoFocus
            className="bg-slate-900 border-slate-700 text-slate-100 text-sm rounded-lg placeholder:text-slate-500"
          />
        </div>

        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-300">Gợi ý chủ đề Hashtag phổ biến (Bấm để chọn thêm):</div>
          <div className="flex flex-wrap gap-1.5">
            {[
              '#Trending', '#Viral', '#Review', '#HotTrend', '#ChiaSe',
              '#AmThuc', '#DuLich', '#MeoHay', '#GocNhin', '#ChuyenThuCung',
              '#CuocSong', '#ThuVi', '#GiaiTri', '#KhuyenMai', '#SaleOff'
            ].map((tag) => {
              const isSelected = hashtagInput.includes(tag);
              return (
                <Tag
                  key={tag}
                  color={isSelected ? 'pink' : 'default'}
                  className={`cursor-pointer px-2.5 py-1 rounded-md text-xs font-semibold select-none transition-all ${isSelected ? 'bg-pink-600 text-white border-pink-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                    }`}
                  onClick={() => {
                    if (isSelected) {
                      setHashtagInput((prev) => prev.replace(tag, '').replace(/\s+/g, ' ').trim());
                    } else {
                      setHashtagInput((prev) => (prev ? `${prev.trim()} ${tag}` : tag));
                    }
                  }}
                >
                  {isSelected ? '✓ ' : '+ '} {tag}
                </Tag>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(HashtagModal, (prev, next) => !prev.isHashtagModalOpen && !next.isHashtagModalOpen);
