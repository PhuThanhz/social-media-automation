import { memo } from 'react';
import type React from 'react';
import { Button, Select, Tag, Space, Modal, Alert } from 'antd';
import { ShareAltOutlined } from '@ant-design/icons';
import type { SocialAccount, PostLinkItem } from './types';

const { Option } = Select;

interface DistributeModalProps {
  distributeModalOpen: boolean;
  setDistributeModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedDistributePages: string[];
  setSelectedDistributePages: React.Dispatch<React.SetStateAction<string[]>>;
  linkItems: PostLinkItem[];
  postingIdentities: SocialAccount[];
  accountTargetValue: (account: SocialAccount) => string;
  viaNameOf: (account: SocialAccount) => string;
  accountSearchLabel: (account: SocialAccount) => string;
  applyEqualDistributionToPosts: () => void;
}

// Modal chia đều bài cho các Page — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
function DistributeModal({
  distributeModalOpen,
  setDistributeModalOpen,
  selectedDistributePages,
  setSelectedDistributePages,
  linkItems,
  postingIdentities,
  accountTargetValue,
  viaNameOf,
  accountSearchLabel,
  applyEqualDistributionToPosts,
}: DistributeModalProps) {
  return (
    <Modal
      title={
        <div className="flex items-center gap-2 text-slate-100 font-bold text-base">
          <ShareAltOutlined className="text-emerald-400 text-lg" />
          <span>Chia đều tỉ lệ Fanpage / Nick cho {linkItems.length} bài viết</span>
        </div>
      }
      open={distributeModalOpen}
      onCancel={() => setDistributeModalOpen(false)}
      onOk={applyEqualDistributionToPosts}
      okText={`⚡ Áp dụng chia đều cho ${linkItems.length} bài`}
      cancelText="Hủy"
      okButtonProps={{
        className: '!bg-emerald-600 hover:!bg-emerald-500 font-bold border-none shadow-sm h-10 px-5 text-sm rounded-xl',
        disabled: selectedDistributePages.length === 0,
      }}
      destroyOnClose={false}
      centered
      width={680}
      className="custom-distribute-modal"
    >
      <div className="space-y-4 py-2">
        <Alert
          type="info"
          showIcon
          message={
            <div className="text-xs leading-relaxed">
              Bạn đang có <b className="text-emerald-300 font-mono">{linkItems.length} bài viết</b>.
              Hãy chọn các Fanpage hoặc Nick cá nhân bên dưới, hệ thống sẽ tự động <b>chia đều xoay vòng (Bài 1 ➔ Page A, Bài 2 ➔ Page B, Bài 3 ➔ Page C...)</b> và điền thẳng vào ô nơi đăng của từng bài viết bên dưới!
            </div>
          }
          className="!bg-emerald-950/40 !border-emerald-800/40 text-emerald-200 text-xs rounded-xl"
        />

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-slate-300">
              Chọn các Fanpage / Nick cá nhân muốn chia bài:
            </label>
            <Space size="small">
              <Button
                size="small"
                type="link"
                className="!p-0 text-xs text-emerald-400 font-bold"
                onClick={() => setSelectedDistributePages(postingIdentities.map((a) => accountTargetValue(a)))}
              >
                Chọn tất cả ({postingIdentities.length})
              </Button>
              <span className="text-slate-600">|</span>
              <Button
                size="small"
                type="link"
                className="!p-0 text-xs text-blue-400"
                onClick={() =>
                  setSelectedDistributePages(
                    postingIdentities
                      .filter((a) => a.platformAccountId !== 'PERSONAL_PROFILE' && a.platform !== 'FACEBOOK_PERSONAL')
                      .map((a) => accountTargetValue(a))
                  )
                }
              >
                Chỉ Fanpage
              </Button>
              <span className="text-slate-600">|</span>
              <Button
                size="small"
                type="link"
                className="!p-0 text-xs text-purple-400"
                onClick={() =>
                  setSelectedDistributePages(
                    postingIdentities
                      .filter((a) => a.platformAccountId === 'PERSONAL_PROFILE' || a.platform === 'FACEBOOK_PERSONAL')
                      .map((a) => accountTargetValue(a))
                  )
                }
              >
                Chỉ Nick cá nhân
              </Button>
              <span className="text-slate-600">|</span>
              <Button
                size="small"
                type="link"
                className="!p-0 text-xs text-slate-400"
                onClick={() => setSelectedDistributePages([])}
              >
                Bỏ chọn
              </Button>
            </Space>
          </div>

          <Select
            mode="multiple"
            size="large"
            placeholder="Chọn các Fanpage/Nick để chia đều..."
            value={selectedDistributePages}
            onChange={(vals) => setSelectedDistributePages(vals)}
            className="w-full"
            optionFilterProp="label"
            filterOption={(input, option) => {
              const label = String(option?.label || '').toLowerCase();
              const query = input.toLowerCase();
              if (label.includes(query)) return true;
              const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
              return strip(label).includes(strip(query));
            }}
            maxTagCount={4}
          >
            {postingIdentities.map((acc) => {
              const val = accountTargetValue(acc);
              const isPersonal = acc.platformAccountId === 'PERSONAL_PROFILE' || acc.platform === 'FACEBOOK_PERSONAL';
              return (
                <Option key={acc.id} value={val} label={accountSearchLabel(acc)}>
                  <div className="flex items-center justify-between py-0.5">
                    <span className={isPersonal ? 'text-indigo-400 font-bold' : 'text-slate-200'}>
                      {isPersonal ? `👤 ${acc.pageName || 'Nick Cá Nhân'}` : `🚩 ${acc.pageName || acc.platformAccountId}`}
                      {viaNameOf(acc) && <span className="ml-1.5 text-xs font-normal text-slate-300">· {viaNameOf(acc)}</span>}
                    </span>
                  </div>
                </Option>
              );
            })}
          </Select>
        </div>

        {/* Bảng tính toán tỉ lệ phân bổ dự kiến */}
        {selectedDistributePages.length > 0 && (
          <div className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-xl space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold text-slate-300">
              <span>Dự kiến phân chia tỉ lệ:</span>
              <span className="text-emerald-400 font-mono">
                {linkItems.length} bài ÷ {selectedDistributePages.length} kênh = ~
                {(linkItems.length / selectedDistributePages.length).toFixed(1)} bài/kênh
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
              {selectedDistributePages.map((targetVal, pIdx) => {
                const matchedAcc = postingIdentities.find((a) => accountTargetValue(a) === targetVal);
                const isPersonal = matchedAcc?.platformAccountId === 'PERSONAL_PROFILE' || matchedAcc?.platform === 'FACEBOOK_PERSONAL';
                const assignedCount = linkItems.filter((_, idx) => idx % selectedDistributePages.length === pIdx).length;
                const assignedIndices = linkItems
                  .map((_, idx) => (idx % selectedDistributePages.length === pIdx ? idx + 1 : null))
                  .filter((n): n is number => n !== null);

                return (
                  <div
                    key={targetVal}
                    className="p-2 rounded-lg bg-slate-950/70 border border-slate-800/80 flex items-center justify-between text-xs"
                  >
                    <div className="min-w-0 pr-2">
                      <div className={`font-bold truncate ${isPersonal ? 'text-indigo-400' : 'text-slate-200'}`}>
                        {isPersonal ? '👤 ' : '🚩 '}
                        {matchedAcc?.pageName || targetVal}
                      </div>
                      <div className="text-xs text-slate-300 truncate">
                        Bài #{assignedIndices.join(', #')}
                      </div>
                    </div>
                    <Tag color="cyan" className="!rounded-md font-mono font-bold shrink-0">
                      {assignedCount} bài
                    </Tag>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(DistributeModal, (prev, next) => !prev.distributeModalOpen && !next.distributeModalOpen);
