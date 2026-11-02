import { memo } from 'react';
import type React from 'react';
import { Select, Segmented, Modal, Switch } from 'antd';
import { CheckCircleOutlined, ScheduleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { PendingPageBreakdownItem } from './types';

interface AutoFixQueueModalProps {
  isBulkProcessing: boolean;
  autoFixQueueModalVisible: boolean;
  setAutoFixQueueModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
  autoFixInterval: number;
  setAutoFixInterval: React.Dispatch<React.SetStateAction<number>>;
  autoFixStartMode: "NOW" | "TOMORROW_830";
  setAutoFixStartMode: React.Dispatch<React.SetStateAction<"NOW" | "TOMORROW_830">>;
  autoFixDistributeVias: boolean;
  setAutoFixDistributeVias: React.Dispatch<React.SetStateAction<boolean>>;
  currentPendingDistribution: { scopeTitle: string; isGroupScope: boolean; totalPending: number; pagesList: PendingPageBreakdownItem[]; };
  handleAutoFixQueue: () => Promise<void>;
}

// Tự sửa hàng đợi — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
function AutoFixQueueModal({
  isBulkProcessing,
  autoFixQueueModalVisible,
  setAutoFixQueueModalVisible,
  autoFixInterval,
  setAutoFixInterval,
  autoFixStartMode,
  setAutoFixStartMode,
  autoFixDistributeVias,
  setAutoFixDistributeVias,
  currentPendingDistribution,
  handleAutoFixQueue,
}: AutoFixQueueModalProps) {
  return (
    <Modal
      title={
        <div className="flex items-center gap-2.5 text-base">
          <span className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center shrink-0">
            <ScheduleOutlined />
          </span>
          <span className="font-bold text-slate-100">
            Tự động xếp lại lịch hàng đợi ({currentPendingDistribution.totalPending} bài)
          </span>
        </div>
      }
      open={autoFixQueueModalVisible}
      onCancel={() => setAutoFixQueueModalVisible(false)}
      onOk={handleAutoFixQueue}
      confirmLoading={isBulkProcessing}
      okText={`⚡ Xếp lại lịch ngay (${currentPendingDistribution.totalPending} bài)`}
      cancelText="Hủy"
      width={580}
      className="max-w-[calc(100vw-24px)]"
    >
      <div className="py-2 space-y-4">
        <div className="p-3.5 bg-blue-500/10 rounded-xl border border-blue-500/20 text-xs text-blue-200 leading-relaxed">
          <div className="font-bold mb-1 flex items-center gap-1.5 text-blue-300">
            <CheckCircleOutlined /> Giải quyết triệt để lỗi trùng giờ & dồn bài:
          </div>
          Hệ thống sẽ lấy toàn bộ các bài đang <strong>Chờ đăng (PENDING)</strong>, rải đều thời gian so le
          tuyệt đối không bị trùng giây/phút, đồng thời luân phiên chia đều tải cho 2 Via chính.
        </div>

        <div className="p-3.5 bg-slate-900/80 rounded-xl border border-slate-800 space-y-3">
          <div>
            <div className="text-xs font-bold text-slate-200 mb-1.5">1. Thời điểm bắt đầu chạy bài đầu tiên:</div>
            <Segmented
              block
              value={autoFixStartMode}
              onChange={(val) => setAutoFixStartMode(val as any)}
              options={[
                {
                  label: '⚡ Sau 10 phút nữa',
                  value: 'NEXT_10MIN',
                },
                {
                  label: '🌅 08:30 sáng mai',
                  value: 'TOMORROW_830',
                },
              ]}
            />
          </div>

          <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-200">2. Khoảng cách nghỉ của từng Nick:</div>
              <div className="text-[11px] text-slate-400">Thời gian nghỉ giữa 2 bài đăng liên tiếp của cùng 1 nick.</div>
            </div>
            <Select
              value={autoFixInterval}
              onChange={setAutoFixInterval}
              className="w-44 rounded-xl font-bold"
              options={[
                { value: 10, label: '10 phút (So le 5p)' },
                { value: 15, label: '15 phút (So le 7.5p)' },
                { value: 20, label: '20 phút (Khuyên dùng)' },
                { value: 30, label: '30 phút (An toàn cao)' },
                { value: 45, label: '45 phút (So le 22.5p)' },
                { value: 60, label: '60 phút (So le 30p)' },
              ]}
            />
          </div>

          <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-200">3. Chia đều tải cho các Via chính:</div>
              <div className="text-[11px] text-slate-400">Luân phiên (Round-Robin) đều qua các Via còn hạn Cookie.</div>
            </div>
            <Switch
              checked={autoFixDistributeVias}
              onChange={setAutoFixDistributeVias}
            />
          </div>
        </div>

        {/* Hộp xem trước kết quả dự kiến */}
        {(() => {
          const count = currentPendingDistribution.totalPending || 0;
          const k = autoFixDistributeVias ? 2 : 1;
          const interval = autoFixInterval || 20;
          const step = Math.max(5, Math.round(interval / k));
          const start = autoFixStartMode === 'TOMORROW_830'
            ? dayjs().add(1, 'day').hour(8).minute(30).second(0)
            : dayjs().add(10, 'minute');
          const end = start.add(Math.max(0, count - 1) * step, 'minute');

          return (
            <div className="p-3 bg-slate-900/50 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1">
              <div className="text-slate-400 font-semibold">📋 Dự kiến sau khi xếp lại:</div>
              <div className="flex items-center justify-between">
                <span>• Tổng số bài:</span>
                <span className="font-bold text-white">{count} bài</span>
              </div>
              <div className="flex items-center justify-between">
                <span>• Nhịp đăng hệ thống:</span>
                <span className="font-bold text-emerald-400">{step} phút / bài</span>
              </div>
              <div className="flex items-center justify-between">
                <span>• Thời gian chạy:</span>
                <span className="font-mono text-amber-300">{start.format('HH:mm DD/MM')} ➔ {end.format('HH:mm DD/MM')}</span>
              </div>
              {autoFixDistributeVias && (
                <div className="flex items-center justify-between text-[11px] text-purple-300 pt-1 border-t border-slate-800/60">
                  <span>• Phân bổ nick:</span>
                  <span>Chia đều luân phiên giữa các Via (~{Math.ceil(count / 2)} bài / nick)</span>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </Modal>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(AutoFixQueueModal, (prev, next) => !prev.autoFixQueueModalVisible && !next.autoFixQueueModalVisible);
