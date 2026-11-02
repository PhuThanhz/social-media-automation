import { memo } from 'react';
import type React from 'react';
import { Select, Segmented, Modal } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';

interface ResetFailedModalProps {
  isBulkProcessing: boolean;
  resetFailedModalVisible: boolean;
  setResetFailedModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
  resetFailedMode: "STAGGER" | "TODAY_23H" | "NOW";
  setResetFailedMode: React.Dispatch<React.SetStateAction<"STAGGER" | "TODAY_23H" | "NOW">>;
  resetFailedSpacing: number;
  setResetFailedSpacing: React.Dispatch<React.SetStateAction<number>>;
  postCounts: { all: number; processing: number; pending: number; published: number; failed: number; };
  handleResetFailedBatch: () => Promise<void>;
}

// Chuyển bài lỗi về Chờ đăng — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
function ResetFailedModal({
  isBulkProcessing,
  resetFailedModalVisible,
  setResetFailedModalVisible,
  resetFailedMode,
  setResetFailedMode,
  resetFailedSpacing,
  setResetFailedSpacing,
  postCounts,
  handleResetFailedBatch,
}: ResetFailedModalProps) {
  return (
    <Modal
      title={
        <div className="flex items-center gap-2.5 text-base">
          <span className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <ThunderboltOutlined />
          </span>
          <span className="font-bold text-slate-100">
            Chuyển {postCounts.failed} bài lỗi về Chờ đăng (Hẹn giờ an toàn)
          </span>
        </div>
      }
      open={resetFailedModalVisible}
      onCancel={() => setResetFailedModalVisible(false)}
      onOk={handleResetFailedBatch}
      confirmLoading={isBulkProcessing}
      okText={`Kích hoạt ${postCounts.failed} bài chờ đăng`}
      cancelText="Hủy"
      width={560}
      className="max-w-[calc(100vw-24px)]"
    >
      <div className="py-2 space-y-4">
        <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 text-xs text-slate-300">
          Hệ thống sẽ xóa thông báo lỗi cũ, đặt lại số lần thử = 0, xóa dấu vết lỗi Group cũ và tự động phân bổ lại lịch đăng an toàn:
        </div>

        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-300">Chọn chế độ phân bổ lịch đăng:</div>
          <Segmented
            block
            value={resetFailedMode}
            onChange={(val) => setResetFailedMode(val as any)}
            options={[
              {
                label: '⏱️ Giãn cách an toàn (~75s)',
                value: 'STAGGER',
              },
              {
                label: '🌙 Xong trước 23h hôm nay',
                value: 'TODAY_23H',
              },
              {
                label: '⚡ Bắt đầu ngay',
                value: 'NOW',
              },
            ]}
          />
        </div>

        {resetFailedMode === 'STAGGER' && (
          <div className="p-3.5 bg-slate-900/60 rounded-xl border border-slate-800 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-200">Khoảng cách giữa các bài:</div>
              <div className="text-[11px] text-slate-400">Rải đều thời gian giữa các bài đăng lại để chống dồn dập, bảo vệ an toàn cho Page/Group.</div>
            </div>
            <Select
              value={resetFailedSpacing}
              onChange={setResetFailedSpacing}
              className="w-36 rounded-xl font-bold"
              options={[
                { value: 300, label: '5 phút' },
                { value: 600, label: '10 phút' },
                { value: 900, label: '15 phút (Chuẩn)' },
                { value: 1800, label: '30 phút' },
                { value: 3600, label: '1 giờ' },
              ]}
            />
          </div>
        )}

        {resetFailedMode === 'TODAY_23H' && (
          <div className="p-3.5 bg-indigo-950/40 border border-indigo-500/30 rounded-xl text-xs text-indigo-200">
            🎯 Hệ thống sẽ tự động tính toán tổng thời gian từ bây giờ đến <b>22:55 tối nay</b> và chia đều khoảng cách giữa các bài viết, đảm bảo toàn bộ bài đều được xuất bản trước 23h hôm nay!
          </div>
        )}

        {resetFailedMode === 'NOW' && (
          <div className="p-3.5 bg-amber-950/40 border border-amber-500/30 rounded-xl text-xs text-amber-200">
            ⚡ Toàn bộ bài lỗi sẽ được chuyển sang hàng đợi và bắt đầu đăng ngay lập tức (giãn cách siêu ngắn ~15s).
          </div>
        )}
      </div>
    </Modal>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(ResetFailedModal, (prev, next) => !prev.resetFailedModalVisible && !next.resetFailedModalVisible);
