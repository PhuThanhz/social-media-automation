import { memo } from 'react';
import type React from 'react';
import {
  Button,
  Select,
  Space,
  Modal,
  Alert,
  Switch,
  App,
} from 'antd';
import { ThunderboltOutlined, SwapOutlined } from '@ant-design/icons';
import type { SocialAccount } from './types';

interface ReassignNickModalProps {
  selectedRowKeys: React.Key[];
  reassignModalVisible: boolean;
  setReassignModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setReassignSelectedNicks: React.Dispatch<React.SetStateAction<string[]>>;
  reassignSelectedNicks: string[];
  reassignRescheduleToday: boolean;
  setReassignRescheduleToday: React.Dispatch<React.SetStateAction<boolean>>;
  isReassigning: boolean;
  postingIdentities: SocialAccount[];
  accountTargetValue: (account: SocialAccount) => string;
  pageCountByCUser: Map<string, number>;
  validPersonalVias: SocialAccount[];
  twoMainViasTargetValues: string[];
  twoMainViasDisplayNames: string;
  handleApplyReassignNicks: () => Promise<void>;
}

// Chuyển bài sang nick khác — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
function ReassignNickModal({
  selectedRowKeys,
  reassignModalVisible,
  setReassignModalVisible,
  setReassignSelectedNicks,
  reassignSelectedNicks,
  reassignRescheduleToday,
  setReassignRescheduleToday,
  isReassigning,
  postingIdentities,
  accountTargetValue,
  pageCountByCUser,
  validPersonalVias,
  twoMainViasTargetValues,
  twoMainViasDisplayNames,
  handleApplyReassignNicks,
}: ReassignNickModalProps) {
  const { message } = App.useApp();
  return (
    <Modal
      title={
        <div className="flex items-center gap-2 text-base text-slate-100">
          <span className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0 border border-purple-500/30">
            <SwapOutlined />
          </span>
          <span>Chuyển Nick / Cân Bằng Tải ({selectedRowKeys.length} bài đã chọn)</span>
        </div>
      }
      open={reassignModalVisible}
      onCancel={() => setReassignModalVisible(false)}
      onOk={handleApplyReassignNicks}
      confirmLoading={isReassigning}
      okText={`Xác nhận chuyển (${selectedRowKeys.length} bài)`}
      cancelText="Hủy"
      width={680}
      className="max-w-[calc(100vw-32px)]"
    >
      <div className="py-2 space-y-4 text-xs">
        <Alert
          type="info"
          showIcon
          message="Cân bằng tải chống dồn bài"
          description={
            <span>
              Chọn <b>1 Nick</b> để chuyển toàn bộ các bài đã chọn sang Nick đó. Hoặc chọn <b>nhiều Nick</b> để hệ thống tự động <b>chia đều xoay vòng (Round-Robin)</b> các bài sang các Nick này, giúp các Nick cùng đăng song song và đăng kịp trong ngày hôm nay!
            </span>
          }
          className="border-blue-500/30 bg-blue-500/10 text-xs"
        />

        <div className="bg-slate-900/80 p-3.5 rounded-2xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-200">Chọn Nick / Via nhận bài:</span>
            <Space size="small">
              <Button
                size="small"
                type="dashed"
                icon={<ThunderboltOutlined />}
                onClick={() => {
                  setReassignSelectedNicks(twoMainViasTargetValues);
                  message.success(`Đã chọn 2 Via chính: ${twoMainViasDisplayNames}`);
                }}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-purple-300 border-purple-500/40"
              >
                2 Via chính
              </Button>
              <Button
                size="small"
                type="dashed"
                onClick={() => {
                  setReassignSelectedNicks(validPersonalVias.map((a) => accountTargetValue(a)));
                  message.success(`Đã chọn tất cả ${validPersonalVias.length} Nick cá nhân`);
                }}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
              >
                Tất cả Nick cá nhân
              </Button>
            </Space>
          </div>

          <Select
            mode="multiple"
            value={reassignSelectedNicks}
            onChange={setReassignSelectedNicks}
            placeholder="Chọn 1 hoặc nhiều Nick / Via để chuyển bài sang..."
            className="w-full font-medium"
            options={postingIdentities.map((acc) => {
              const val = accountTargetValue(acc);
              const rawName = (acc.pageName || acc.platformAccountId).replace(/^👤\s*Nick Cá Nhân\s*\((.*)\)$/, '$1');
              const isPersonal = acc.accountType === 'PERSONAL_COOKIE' || acc.accountType === 'PERSONAL_PROFILE_COOKIE';
              const cUser = acc.accessToken?.match(/c_user=(\d+)/)?.[1];
              const pageCount = cUser ? (pageCountByCUser.get(cUser) || 0) : 0;
              return {
                label: (
                  <div className="flex items-center gap-2 py-0.5">
                    <span>{isPersonal ? '👤' : '🚩'}</span>
                    <span className="font-bold">{rawName}</span>
                    {pageCount > 0 && <span className="text-slate-400 text-[10px]">({pageCount} Page)</span>}
                  </div>
                ),
                value: val,
              };
            })}
          />

          {reassignSelectedNicks.length > 0 && (
            <div className="text-[11px] text-purple-300 bg-purple-500/10 border border-purple-500/20 rounded-xl p-2.5">
              💡 {reassignSelectedNicks.length === 1 ? (
                <span>Toàn bộ <b>{selectedRowKeys.length} bài</b> sẽ được chuyển sang nick đã chọn.</span>
              ) : (
                <span>
                  <b>{selectedRowKeys.length} bài</b> sẽ được chia đều: mỗi nick nhận trung bình ~<b>{Math.ceil(selectedRowKeys.length / reassignSelectedNicks.length)} bài</b>, đăng song song độc lập.
                </span>
              )}
            </div>
          )}
        </div>

        <div className="bg-slate-900/80 p-3.5 rounded-2xl border border-slate-800 flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-slate-200">Tự động xếp lịch vào hôm nay</div>
            <div className="text-[11px] text-slate-400">
              Xếp lại giờ đăng nối tiếp nhau bắt đầu từ bây giờ trong khung giờ hôm nay của các Nick mới, kéo các bài bị hoãn sang ngày mai về đăng hết hôm nay.
            </div>
          </div>
          <Switch
            checked={reassignRescheduleToday}
            onChange={setReassignRescheduleToday}
            className="bg-slate-700"
          />
        </div>
      </div>
    </Modal>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(ReassignNickModal, (prev, next) => !prev.reassignModalVisible && !next.reassignModalVisible);
