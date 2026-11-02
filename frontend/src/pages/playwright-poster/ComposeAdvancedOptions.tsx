import type React from 'react';
import {
  Button,
  Form,
  Select,
  Checkbox,
  Tooltip,
  Input,
  App,
} from 'antd';
import { CheckCircleOutlined, SettingOutlined, CopyOutlined, MessageOutlined } from '@ant-design/icons';
import type { FormInstance } from 'antd';
import { stripEmojiPrefix } from './shared';
import type { SocialAccount, PostMode } from './types';
import { DEFAULT_SAVED_COMMENT, STORAGE_KEY_COMMENT } from './shared';

const { TextArea } = Input;
const { Option } = Select;

interface ComposeAdvancedOptionsProps {
  form: FormInstance<any>;
  postMode: PostMode;
  forceRefresh: boolean;
  setForceRefresh: React.Dispatch<React.SetStateAction<boolean>>;
  setAdvancedOpen: React.Dispatch<React.SetStateAction<boolean>>;
  advancedOpen: boolean;
  groupAccountsWithId: SocialAccount[];
  affiliateExcludedGroupIds: string[];
  setAffiliateExcludedGroupIds: React.Dispatch<React.SetStateAction<string[]>>;
  currentSelectedGroupIdsForAffiliate: string[];
  groupCommentAllowedGroupIds: string[];
  setGroupCommentAllowedGroupIds: React.Dispatch<React.SetStateAction<string[]>>;
  applyEnableAllGroupComments: () => void;
}

// Tùy chọn nâng cao của form soạn bài (mở khi cần) — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
export default function ComposeAdvancedOptions({
  form,
  postMode,
  forceRefresh,
  setForceRefresh,
  setAdvancedOpen,
  advancedOpen,
  groupAccountsWithId,
  affiliateExcludedGroupIds,
  setAffiliateExcludedGroupIds,
  currentSelectedGroupIdsForAffiliate,
  groupCommentAllowedGroupIds,
  setGroupCommentAllowedGroupIds,
  applyEnableAllGroupComments,
}: ComposeAdvancedOptionsProps) {
  const { message } = App.useApp();
  return (
    <div className="mb-5 rounded-xl border border-slate-700/60 bg-slate-800/40 overflow-hidden backdrop-blur-sm shadow-xs">
      <button
        type="button"
        className="w-full flex items-center gap-2.5 p-3.5 text-left hover:bg-slate-700/30 transition-colors"
        onClick={() => setAdvancedOpen((open) => !open)}
        aria-expanded={advancedOpen}
      >
        <div className="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center font-bold text-sm shrink-0 border border-blue-500/25">
          <SettingOutlined />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-sm text-slate-200 flex items-center gap-2">
            <span>Bình luận tự động & tùy chọn nâng cao</span>
          </div>
          <div className="text-xs text-slate-400">Thiết lập bình luận mặc định, link tiếp thị và làm mới dữ liệu nguồn</div>
        </div>
        <span className="text-xs font-semibold text-blue-400 shrink-0 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20">{advancedOpen ? 'Thu gọn' : 'Thiết lập'}</span>
      </button>

      {advancedOpen && <div className="border-t border-slate-700/60 bg-slate-900/60 p-4 sm:p-5">
        {/* Nút hành động tiện lợi */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <Button
            size="small"
            type="primary"
            icon={<CopyOutlined />}
            onClick={async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (text) {
                  form.setFieldValue('affiliateLink', text);
                  localStorage.setItem(STORAGE_KEY_COMMENT, text);
                  message.success('📋 Đã dán nội dung từ khay nhớ tạm!');
                }
              } catch {
                // Ignore
              }
            }}
            className="bg-blue-600 hover:bg-blue-500 font-bold rounded-lg text-xs"
          >
            📋 Dán
          </Button>
          <Button
            size="small"
            type="default"
            onClick={() => {
              const currentVal = form.getFieldValue('affiliateLink');
              if (currentVal && currentVal.trim()) {
                localStorage.setItem(STORAGE_KEY_COMMENT, currentVal.trim());
                message.success('💾 Đã lưu nội dung này làm mẫu mặc định!');
              } else {
                message.warning('Vui lòng nhập nội dung trước khi lưu.');
              }
            }}
            className="font-bold border-slate-700 text-slate-200 hover:bg-slate-800 rounded-lg text-xs"
          >
            💾 Lưu mẫu
          </Button>
          <Button
            size="small"
            type="text"
            onClick={() => {
              form.setFieldValue('affiliateLink', DEFAULT_SAVED_COMMENT);
              localStorage.setItem(STORAGE_KEY_COMMENT, DEFAULT_SAVED_COMMENT);
              message.success('↺ Đã khôi phục về mẫu mặc định ban đầu!');
            }}
            className="text-slate-400 hover:text-slate-200 text-xs rounded-lg"
          >
            ↺ Khôi phục
          </Button>
        </div>

        <Form.Item
          name="affiliateLink"
          className="!mb-2"
        >
          <TextArea
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder="Nhập hoặc dán nội dung bình luận (ví dụ: Chúc mọi người ngày mới tràn đầy năng lượng ✨ 👉 https://s.shopee.vn/...)"
            className="text-xs sm:text-sm font-medium rounded-xl border-slate-700/80 focus:border-blue-500 bg-slate-950/80 p-3 text-slate-100"
            onChange={(e) => {
              if (e.target.value) {
                localStorage.setItem(STORAGE_KEY_COMMENT, e.target.value);
              }
            }}
          />
        </Form.Item>

        {postMode !== 'FANPAGE_ONLY' && (
          <div className="mb-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs text-amber-300 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-base">💡</span>
              <span>
                <strong>Lưu ý về Bình luận Nhóm:</strong> Mặc định bình luận link vào Nhóm ở dạng Opt-in (Tắt). Bấm nút bên phải để bật tự động bình luận link vào Group cho toàn bộ bài viết.
              </span>
            </div>
            <Button
              type="primary"
              size="small"
              icon={<MessageOutlined />}
              onClick={applyEnableAllGroupComments}
              className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-lg border-none shrink-0"
            >
              💬 Bật cmt Nhóm cho các bài
            </Button>
          </div>
        )}

        {currentSelectedGroupIdsForAffiliate.length > 0 && (
          <div className="mb-2.5">
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              🚫 Nhóm KHÔNG gắn link Affiliate (bỏ trống = gắn cho tất cả nhóm đã chọn ở trên):
            </label>
            <Select
              mode="multiple"
              size="middle"
              placeholder="Chọn nhóm muốn loại trừ, không bình luận link Affiliate"
              optionFilterProp="label"
              value={affiliateExcludedGroupIds.filter((id) => currentSelectedGroupIdsForAffiliate.includes(id))}
              onChange={setAffiliateExcludedGroupIds}
              className="w-full"
            >
              {currentSelectedGroupIdsForAffiliate.map((gId) => {
                const matched = groupAccountsWithId.find((g) => g.platformAccountId === gId);
                const label = matched ? stripEmojiPrefix(matched.pageName) : gId;
                return (
                  <Option key={gId} value={gId} label={label}>
                    {label} · ID {gId}
                  </Option>
                );
              })}
            </Select>
          </div>
        )}

        {postMode !== 'FANPAGE_ONLY' && currentSelectedGroupIdsForAffiliate.length > 0 && (
          <div className="mb-2.5">
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              ✅ Chỉ định Nhóm ĐƯỢC bình luận (bỏ trống = không giới hạn, áp dụng cho mọi Nhóm đã chọn ở trên — vẫn tuỳ checkbox "Bình luận trong Nhóm" của từng bài):
            </label>
            <Select
              mode="multiple"
              size="middle"
              placeholder="Chọn đích danh Nhóm được phép bình luận, để trống = không giới hạn"
              optionFilterProp="label"
              value={groupCommentAllowedGroupIds.filter((id) => currentSelectedGroupIdsForAffiliate.includes(id))}
              onChange={setGroupCommentAllowedGroupIds}
              className="w-full"
            >
              {currentSelectedGroupIdsForAffiliate.map((gId) => {
                const matched = groupAccountsWithId.find((g) => g.platformAccountId === gId);
                const label = matched ? stripEmojiPrefix(matched.pageName) : gId;
                return (
                  <Option key={gId} value={gId} label={label}>
                    {label} · ID {gId}
                  </Option>
                );
              })}
            </Select>
          </div>
        )}

        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-950/40 border border-blue-800/40 text-xs text-blue-200">
          <CheckCircleOutlined className="text-blue-400 mt-0.5 shrink-0 text-sm" />
          <span className="leading-relaxed">
            <b className="text-blue-300">Mẹo:</b> Hệ thống sẽ tự động bình luận nội dung này ngay sau khi bài được đăng. Hỗ trợ xuống dòng, emoji và link tiếp thị Shopee / Lazada.
          </span>
        </div>
        <div className="mt-3 pt-3 border-t border-slate-800/80">
          <Tooltip title="Worker giữ kết quả cào gần đây (6h) để tránh cào/tải trùng khi submit lại cùng link. Bật khi bài gốc vừa được sửa.">
            <Checkbox checked={forceRefresh} onChange={(e) => setForceRefresh(e.target.checked)} className="text-xs text-slate-300">
              Cào lại nội dung mới nhất, bỏ qua cache đã lưu
            </Checkbox>
          </Tooltip>
        </div>
      </div>}
    </div>
  );
}
