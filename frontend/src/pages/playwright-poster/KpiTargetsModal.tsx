import { memo } from 'react';
import type React from 'react';
import {
  Button,
  Select,
  Modal,
  InputNumber,
  Empty,
  Divider,
  Typography,
} from 'antd';
import { ThunderboltOutlined, TeamOutlined, AimOutlined, FacebookFilled } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { UseMutationResult } from '@tanstack/react-query';
import type { SocialAccount } from './types';

const { Text } = Typography;

interface KpiTargetsModalProps {
  kpiFanpageAccounts: SocialAccount[];
  kpiGroupAccounts: SocialAccount[];
  groupIdentityMap: Map<number, SocialAccount>;
  setGroupIdentityMutation: UseMutationResult<any, any, { groupId: number; fanpageConnectionId: number; }, unknown>;
  bulkGroupFanpageId: number;
  setBulkGroupFanpageId: React.Dispatch<React.SetStateAction<number>>;
  bulkGroupApplying: boolean;
  applyBulkGroupIdentity: () => Promise<void>;
  kpiModalOpen: boolean;
  setKpiModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  kpiDrafts: Record<number, number>;
  setKpiDrafts: React.Dispatch<React.SetStateAction<Record<number, number>>>;
  setTargetMutation: UseMutationResult<any, any, { socialAccountId: number; targetCount: number; }, unknown>;
  handleSaveKpi: () => Promise<void>;
}

// Mục tiêu KPI theo Page — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
function KpiTargetsModal({
  kpiFanpageAccounts,
  kpiGroupAccounts,
  groupIdentityMap,
  setGroupIdentityMutation,
  bulkGroupFanpageId,
  setBulkGroupFanpageId,
  bulkGroupApplying,
  applyBulkGroupIdentity,
  kpiModalOpen,
  setKpiModalOpen,
  kpiDrafts,
  setKpiDrafts,
  setTargetMutation,
  handleSaveKpi,
}: KpiTargetsModalProps) {
  return (
    <Modal
      title={
        <span className="flex items-center gap-2 text-base">
          <span className="w-8 h-8 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">
            <AimOutlined />
          </span>
          Đặt KPI hôm nay — {dayjs().format('DD/MM/YYYY')}
        </span>
      }
      open={kpiModalOpen}
      onCancel={() => setKpiModalOpen(false)}
      onOk={handleSaveKpi}
      confirmLoading={setTargetMutation.isPending}
      okText="Lưu KPI"
      cancelText="Huỷ"
      width={860}
      className="max-w-[calc(100vw-24px)]"
      styles={{ body: { paddingTop: 4 } }}
    >
      <Text className="text-xs text-slate-500 block mb-3">
        Đặt số bài mục tiêu cần đăng hôm nay cho Fanpage và từng Group. Để trống hoặc 0 để bỏ mục tiêu.
      </Text>

      {kpiFanpageAccounts.length === 0 && kpiGroupAccounts.length === 0 ? (
        <Empty description="Chưa có Fanpage/Group nào được kết nối" />
      ) : (
        <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-5">
          {kpiFanpageAccounts.length > 0 && (
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <FacebookFilled className="text-blue-600" /> Fanpage
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                {kpiFanpageAccounts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                    <div className="min-w-0">
                      <span className="font-bold text-xs text-slate-800 block truncate">{a.pageName || `#${a.id}`}</span>
                      <span className="text-[10px] text-slate-400 font-mono">ID kết nối: {a.id}</span>
                    </div>
                    <InputNumber
                      min={0}
                      value={kpiDrafts[a.id] ?? null}
                      onChange={(val) => setKpiDrafts((prev) => ({ ...prev, [a.id]: val }))}
                      placeholder="0"
                      className="w-20 shrink-0"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {kpiGroupAccounts.length > 0 && (
            <div>
              <Divider className="!my-3" />
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                  <TeamOutlined className="text-purple-600" /> Group
                </div>
              </div>

              {kpiGroupAccounts.length > 1 && (
                <div className="flex flex-wrap items-center gap-2 p-3 mb-3 rounded-xl border border-dashed border-purple-300 bg-purple-50/60">
                  <ThunderboltOutlined className="text-purple-600" />
                  <span className="text-[11px] font-semibold text-purple-700 shrink-0">Áp dụng nhanh cho tất cả Group:</span>
                  <Select
                    size="small"
                    placeholder="Chọn Fanpage"
                    value={bulkGroupFanpageId}
                    onChange={setBulkGroupFanpageId}
                    className="w-40"
                    options={kpiFanpageAccounts.map((fp) => ({ value: fp.id, label: fp.pageName || `#${fp.id}` }))}
                  />
                  <Button
                    size="small"
                    type="primary"
                    disabled={!bulkGroupFanpageId}
                    loading={bulkGroupApplying}
                    onClick={applyBulkGroupIdentity}
                  >
                    Áp dụng
                  </Button>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-2">
                {kpiGroupAccounts.map((a) => {
                  const identity = groupIdentityMap.get(a.id);
                  return (
                    <div key={a.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <span className="font-bold text-xs text-slate-800 block truncate">{a.pageName || `#${a.id}`}</span>
                          <span className="text-[10px] text-slate-400 font-mono">ID kết nối: {a.id}</span>
                        </div>
                        <InputNumber
                          min={0}
                          value={kpiDrafts[a.id] ?? null}
                          onChange={(val) => setKpiDrafts((prev) => ({ ...prev, [a.id]: val }))}
                          placeholder="0"
                          className="w-20 shrink-0"
                        />
                      </div>
                      <Select
                        size="small"
                        placeholder="Chọn Fanpage mặc định để đăng vào Group này"
                        value={identity?.id ?? undefined}
                        onChange={(val) => setGroupIdentityMutation.mutate({ groupId: a.id, fanpageConnectionId: val ?? null })}
                        allowClear
                        loading={setGroupIdentityMutation.isPending}
                        className="w-full"
                        options={kpiFanpageAccounts.map((fp) => ({ value: fp.id, label: fp.pageName || `#${fp.id}` }))}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(KpiTargetsModal, (prev, next) => !prev.kpiModalOpen && !next.kpiModalOpen);
