import { memo } from 'react';
import type React from 'react';
import { Input, Tag, Modal, Alert } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import type { PostLinkItem } from './types';

interface CustomCreModalProps {
  isCustomCreModalOpen: boolean;
  setIsCustomCreModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  customCreInput: string;
  setCustomCreInput: React.Dispatch<React.SetStateAction<string>>;
  customCreTargetItemId: string;
  linkItems: PostLinkItem[];
  applyCustomCreditToPosts: (textToApply: string) => void;
}

// Ghi nguồn (Cre) tùy chỉnh — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
function CustomCreModal({
  isCustomCreModalOpen,
  setIsCustomCreModalOpen,
  customCreInput,
  setCustomCreInput,
  customCreTargetItemId,
  linkItems,
  applyCustomCreditToPosts,
}: CustomCreModalProps) {
  return (
    <Modal
      title={
        <div className="flex items-center gap-2 text-slate-100 font-bold text-base">
          <EditOutlined className="text-purple-400" />
          <span>{customCreTargetItemId ? 'Gán Cre tùy chỉnh cho bài viết này' : 'Gán Cre tùy chỉnh hàng loạt (Tất cả bài)'}</span>
        </div>
      }
      open={isCustomCreModalOpen}
      onCancel={() => setIsCustomCreModalOpen(false)}
      onOk={() => applyCustomCreditToPosts(customCreInput)}
      okText="Áp dụng ngay"
      cancelText="Hủy"
      okButtonProps={{
        className: 'bg-purple-600 hover:bg-purple-500 font-bold border-none shadow-sm',
      }}
      destroyOnClose
      centered
      className="custom-cre-modal"
    >
      <div className="space-y-4 py-2">
        <Alert
          type="info"
          showIcon
          message={
            customCreTargetItemId
              ? 'Nội dung này sẽ được chèn thành "Cre: [Nội dung]" vào cuối caption bài viết đã chọn.'
              : `Nội dung này sẽ được chèn thành "Cre: [Nội dung]" vào cuối caption cho TOÀN BỘ ${linkItems.length} bài viết.`
          }
          className="bg-purple-950/40 border-purple-800/40 text-purple-200 text-xs"
        />

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-300">
            Nhập nội dung Cre mong muốn (Ví dụ: Sưu tầm, ST, Nguồn TikTok @xxx...):
          </label>
          <Input
            placeholder="VD: Sưu tầm, ST, Fanpage ABC, TikTok @cuocsongdoithuong..."
            value={customCreInput}
            onChange={(e) => setCustomCreInput(e.target.value)}
            onPressEnter={() => applyCustomCreditToPosts(customCreInput)}
            allowClear
            autoFocus
            className="bg-slate-900 border-slate-700 text-slate-100 text-sm h-10 rounded-lg placeholder:text-slate-500"
          />
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-bold text-slate-400">Gợi ý nhanh (Bấm để chọn ngay):</div>
          <div className="flex flex-wrap gap-1.5">
            {['Sưu tầm', 'ST', 'Nguồn tổng hợp', 'Internet', 'Gia đình', 'Fanpage', 'TikTok'].map((preset) => (
              <Tag
                key={preset}
                color="purple"
                className="cursor-pointer hover:opacity-80 px-2.5 py-1 rounded-md text-xs font-semibold select-none transition-all"
                onClick={() => {
                  setCustomCreInput(preset);
                }}
              >
                + Cre: {preset}
              </Tag>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(CustomCreModal, (prev, next) => !prev.isCustomCreModalOpen && !next.isCustomCreModalOpen);
