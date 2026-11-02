import { memo } from 'react';
import type React from 'react';
import { Button, Tag, Tooltip, Modal, Popconfirm } from 'antd';
import { SettingOutlined, DeleteOutlined, EditOutlined, SaveOutlined } from '@ant-design/icons';

interface ManagePresetsModalProps {
  savedPresets: { id: string; name: string; postMode: "GROUP_ONLY" | "FANPAGE_ONLY" | "FANPAGE_AND_GROUP"; groupDistributionMode: "PAGE_PER_GROUP" | "ROUND_ROBIN_POSTS" | "CROSS_ALL"; selectedFanpageIds: string[]; selectedGroupIds: string[]; isAnonymous?: boolean; }[];
  selectedPresetId: string;
  managePresetsModalOpen: boolean;
  setManagePresetsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingPreset: React.Dispatch<React.SetStateAction<{ id: string; name: string; }>>;
  setEditingPresetName: React.Dispatch<React.SetStateAction<string>>;
  applyPreset: (preset: { id: string; name: string; postMode: "GROUP_ONLY" | "FANPAGE_ONLY" | "FANPAGE_AND_GROUP"; groupDistributionMode: "PAGE_PER_GROUP" | "ROUND_ROBIN_POSTS" | "CROSS_ALL"; selectedFanpageIds: string[]; selectedGroupIds: string[]; isAnonymous?: boolean; }) => void;
  handleUpdatePresetWithCurrent: (presetId: string) => void;
  handleDeletePreset: (presetId: string, e?: React.MouseEvent<Element, MouseEvent>) => void;
}

// Quản lý các cấu hình thường dùng — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
function ManagePresetsModal({
  savedPresets,
  selectedPresetId,
  managePresetsModalOpen,
  setManagePresetsModalOpen,
  setEditingPreset,
  setEditingPresetName,
  applyPreset,
  handleUpdatePresetWithCurrent,
  handleDeletePreset,
}: ManagePresetsModalProps) {
  return (
    <Modal
      title={
        <div className="flex items-center gap-2 text-slate-100">
          <SettingOutlined className="text-blue-400 text-base" />
          <span className="font-bold text-base">Quản lý cấu hình đăng bài lưu sẵn ({savedPresets.length})</span>
        </div>
      }
      open={managePresetsModalOpen}
      onCancel={() => setManagePresetsModalOpen(false)}
      footer={
        <div className="flex items-center justify-between w-full">
          <span className="text-xs text-slate-400">
            💡 Bấm "Cập nhật" để ghi đè cấu hình bằng các Nhóm và Page đang chọn trên màn hình
          </span>
          <Button onClick={() => setManagePresetsModalOpen(false)} className="rounded-lg">
            Đóng
          </Button>
        </div>
      }
      className="dark-modal"
      centered
      width={720}
    >
      <div className="py-3 space-y-3">
        {savedPresets.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs">
            Chưa có cấu hình nào được lưu. Hãy chọn Nhóm, Page và bấm "Lưu mới" để tạo cấu hình!
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80 max-h-[60vh] overflow-y-auto pr-1">
            {savedPresets.map((p) => {
              const isSelected = selectedPresetId === p.id;
              return (
                <div key={p.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-800/20 px-2 rounded-xl transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-slate-100">{p.name}</span>
                      {isSelected && (
                        <Tag color="cyan" className="!text-[10px] !m-0 !rounded-md font-bold">
                          Đang áp dụng
                        </Tag>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5 text-xs text-slate-400 mt-1 flex-wrap">
                      <Tag color="gold" className="!text-[11px] !m-0 !rounded-md">
                        👥 {p.selectedGroupIds?.length > 0 ? `${p.selectedGroupIds.length} Nhóm` : 'Tự chọn Nhóm'}
                      </Tag>
                      <Tag color="blue" className="!text-[11px] !m-0 !rounded-md">
                        📄 {p.selectedFanpageIds?.length || 0} Page/Nick
                      </Tag>
                      <span className="text-[11px] text-slate-500 font-mono">
                        {p.postMode === 'GROUP_ONLY' ? 'Chỉ đăng Group' : p.postMode === 'FANPAGE_ONLY' ? 'Chỉ Fanpage' : 'Cả Page & Group'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => {
                        applyPreset(p);
                        setManagePresetsModalOpen(false);
                      }}
                      className="bg-blue-600 hover:bg-blue-500 text-xs font-semibold rounded-lg"
                    >
                      Áp dụng
                    </Button>
                    <Tooltip title="Lưu các Nhóm & Page đang tick chọn hiện tại vào cấu hình này">
                      <Button
                        size="small"
                        icon={<SaveOutlined className="text-emerald-400" />}
                        onClick={() => handleUpdatePresetWithCurrent(p.id)}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 text-xs font-semibold rounded-lg"
                      >
                        Cập nhật
                      </Button>
                    </Tooltip>
                    <Tooltip title="Đổi tên cấu hình này">
                      <Button
                        size="small"
                        icon={<EditOutlined className="text-sky-400" />}
                        onClick={() => {
                          setEditingPreset({ id: p.id, name: p.name });
                          setEditingPresetName(p.name);
                        }}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 text-xs rounded-lg"
                      />
                    </Tooltip>
                    <Popconfirm
                      title="Xóa cấu hình này?"
                      onConfirm={() => handleDeletePreset(p.id)}
                      okText="Xóa"
                      cancelText="Hủy"
                      okButtonProps={{ danger: true, size: 'small' }}
                      cancelButtonProps={{ size: 'small' }}
                    >
                      <Button
                        size="small"
                        danger
                        type="text"
                        icon={<DeleteOutlined />}
                        className="text-xs"
                      />
                    </Popconfirm>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(ManagePresetsModal, (prev, next) => !prev.managePresetsModalOpen && !next.managePresetsModalOpen);
