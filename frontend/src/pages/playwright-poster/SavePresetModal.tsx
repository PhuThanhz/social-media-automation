import { memo } from 'react';
import type React from 'react';
import { Input, Modal } from 'antd';
import { AppstoreOutlined } from '@ant-design/icons';

interface SavePresetModalProps {
  groupDistributionMode: "PAGE_PER_GROUP" | "ROUND_ROBIN_POSTS" | "CROSS_ALL";
  activeSelectedGroupIds: string[];
  activeSelectedFanpageIds: string[];
  savePresetModalOpen: boolean;
  setSavePresetModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newPresetName: string;
  setNewPresetName: React.Dispatch<React.SetStateAction<string>>;
  handleSaveNewPreset: () => void;
}

// Lưu cấu hình thường dùng — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
function SavePresetModal({
  groupDistributionMode,
  activeSelectedGroupIds,
  activeSelectedFanpageIds,
  savePresetModalOpen,
  setSavePresetModalOpen,
  newPresetName,
  setNewPresetName,
  handleSaveNewPreset,
}: SavePresetModalProps) {
  return (
    <Modal
      title={
        <div className="flex items-center gap-2 text-slate-100 pb-2 border-b border-slate-800">
          <span className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
            <AppstoreOutlined className="text-sm" />
          </span>
          <span className="font-bold text-base">Lưu cấu hình thường dùng mới</span>
        </div>
      }
      open={savePresetModalOpen}
      onCancel={() => setSavePresetModalOpen(false)}
      onOk={handleSaveNewPreset}
      okText="Lưu Combo"
      cancelText="Hủy"
      className="dark-modal"
      centered
      width={440}
    >
      <div className="py-3 space-y-3.5">
        <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 leading-relaxed space-y-1.5">
          <div className="font-semibold text-slate-100 flex items-center gap-1.5">
            <span>🎯 Cấu hình được lưu trong Combo này:</span>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span>Nhóm nhận bài:</span>
            <span className="font-bold text-amber-300">{activeSelectedGroupIds.length} nhóm</span>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span>Page/Nick đăng:</span>
            <span className="font-bold text-sky-300">{activeSelectedFanpageIds.length} tài khoản</span>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span>Chế độ phân bổ:</span>
            <span className="font-bold text-purple-300">{groupDistributionMode === 'PAGE_PER_GROUP' ? '🛡️ Chia đều Page/Nhóm' : '🔄 Xoay vòng'}</span>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-200 block mb-1.5">Đặt tên gợi nhớ cho Combo này:</label>
          <Input
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            placeholder="Ví dụ: 3 Nhóm Kinh Tế Sáng, Combo Pet..."
            className="rounded-xl font-medium"
            autoFocus
            onPressEnter={handleSaveNewPreset}
          />
          <div className="text-xs text-slate-300 mt-1.5">Lần sau chỉ cần bấm 1 click vào nút Combo này là tự động chọn đủ cả Nhóm lẫn Page!</div>
        </div>
      </div>
    </Modal>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(SavePresetModal, (prev, next) => !prev.savePresetModalOpen && !next.savePresetModalOpen);
