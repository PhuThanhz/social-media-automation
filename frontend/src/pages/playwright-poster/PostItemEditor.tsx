import { memo } from 'react';
import { App, Button, Input, Select, Tag, Tooltip, Popover, Segmented, Space, Alert, Image, Typography } from 'antd';
import {
  LinkOutlined,
  DownOutlined,
  ClockCircleOutlined,
  CheckOutlined,
  LoadingOutlined,
  RedoOutlined,
  SettingOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  CopyOutlined,
  RocketOutlined,
  MessageOutlined,
  StopOutlined,
  TeamOutlined,
  EyeOutlined,
  FacebookFilled,
  GlobalOutlined,
  EditOutlined,
  ClearOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  StarOutlined,
  CloseOutlined,
  HolderOutlined,
  PictureOutlined,
  FileTextOutlined,
  SmileOutlined,
  PlusCircleOutlined,
  CloudUploadOutlined,
  LikeOutlined,
  CommentOutlined,
  ShareAltOutlined,
  EllipsisOutlined,
  TagOutlined,
  UserOutlined,
} from '@ant-design/icons';
import PasteLinkInput from '../../components/common/PasteLinkInput';
import ColorPostPreview from '../../components/common/ColorPostPreview';
import type { ItemPreview, PostLinkItem, PostMode, SocialAccount } from './types';
import { buildExtraGroupOptions, filterSelectByLabel } from './shared';

const { Text } = Typography;
const { TextArea } = Input;

type AnyFn = (...args: any[]) => any;

// Các hàm từ PlaywrightPoster; truyền qua useStableActions nên reference không đổi giữa các lần render
export interface PostItemEditorActions {
  openNewsCardForItem: AnyFn;
  isMediaVideo: AnyFn;
  setMediaViewer: AnyFn;
  handleMediaDragStart: AnyFn;
  handleMediaDragOver: AnyFn;
  handleMediaDragEnd: AnyFn;
  handleMediaDrop: AnyFn;
  moveMediaItem: AnyFn;
  removeMediaItem: AnyFn;
  handlePreviewLink: AnyFn;
  setLinkItems: AnyFn;
  setManualMediaUrlInputs: AnyFn;
  accountTargetValue: AnyFn;
  setCustomItemTargets: AnyFn;
  updateLinkUrl: AnyFn;
  updateLinkAffiliate: AnyFn;
  updateLinkCustomCaption: AnyFn;
  updateLinkInputType: AnyFn;
  updateLinkManualContent: AnyFn;
  handleUploadMedia: AnyFn;
  handlePasteMediaFromClipboard: AnyFn;
  handlePasteFromClipboardButton: AnyFn;
  handleAddManualMediaUrl: AnyFn;
  moveManualMediaItem: AnyFn;
  removeManualMediaItem: AnyFn;
  toggleCommentBox: AnyFn;
  toggleIncludeCredit: AnyFn;
  toggleColorBackground: AnyFn;
  replaceOrAppendCreditText: AnyFn;
  applyAnonymousCreditToAll: AnyFn;
  toUnicodeBold: AnyFn;
  toUnicodeSerifBold: AnyFn;
  toUnicodeItalic: AnyFn;
  toUnicodeBoldItalic: AnyFn;
  toUnicodeStrikethrough: AnyFn;
  toUnicodeUnderline: AnyFn;
  toUnicodeBoxedTag: AnyFn;
  toUnicodeHeading1: AnyFn;
  toUnicodeHeading2: AnyFn;
  applyTransformToSelection: AnyFn;
  insertSnippetAtCursor: AnyFn;
  setDragOverDropzone: AnyFn;
  toggleSkipComment: AnyFn;
  toggleGroupComment: AnyFn;
  updateLinkMode: AnyFn;
  updateLinkTime: AnyFn;
  removeLinkItem: AnyFn;
  updateLinkExtraGroupIds: AnyFn;
}

interface PostItemEditorProps {
  item: PostLinkItem;
  index: number;
  isOnlyItem: boolean;
  preview?: ItemPreview;
  manualMediaUrlInput?: string;
  customTarget?: string;
  distributionTargetValue?: string;
  draggedMedia: { itemId: string; index: number } | null;
  dragOverMedia: { itemId: string; index: number } | null;
  dragOverDropzone: string | null;
  postMode: PostMode;
  postingIdentities: SocialAccount[];
  groupAccountsWithId?: SocialAccount[];
  primaryGroupIds?: string[];
  targetOptions: { value: string; label: string }[];
  watchedTargetFanpageId: any;
  defaultCommentPreview: string;
  previewAuthorName: string;
  firstAccountPageName?: string;
  actions: PostItemEditorActions;
}

// Editor của 1 bài trong danh sách soạn bài. memo: gõ caption bài này không render lại các bài khác.
function PostItemEditor({
  item,
  index,
  isOnlyItem,
  preview,
  manualMediaUrlInput,
  customTarget,
  distributionTargetValue,
  draggedMedia,
  dragOverMedia,
  dragOverDropzone,
  postMode,
  postingIdentities,
  groupAccountsWithId = [],
  primaryGroupIds = [],
  targetOptions,
  watchedTargetFanpageId,
  defaultCommentPreview,
  previewAuthorName,
  firstAccountPageName,
  actions,
}: PostItemEditorProps) {
  const { message } = App.useApp();
  const {
    openNewsCardForItem,
    isMediaVideo,
    setMediaViewer,
    handleMediaDragStart,
    handleMediaDragOver,
    handleMediaDragEnd,
    handleMediaDrop,
    moveMediaItem,
    removeMediaItem,
    handlePreviewLink,
    setLinkItems,
    setManualMediaUrlInputs,
    accountTargetValue,
    setCustomItemTargets,
    updateLinkUrl,
    updateLinkAffiliate,
    updateLinkCustomCaption,
    updateLinkInputType,
    updateLinkManualContent,
    handleUploadMedia,
    handlePasteMediaFromClipboard,
    handlePasteFromClipboardButton,
    handleAddManualMediaUrl,
    moveManualMediaItem,
    removeManualMediaItem,
    toggleCommentBox,
    toggleIncludeCredit,
    toggleColorBackground,
    replaceOrAppendCreditText,
    applyAnonymousCreditToAll,
    toUnicodeBold,
    toUnicodeSerifBold,
    toUnicodeItalic,
    toUnicodeBoldItalic,
    toUnicodeStrikethrough,
    toUnicodeUnderline,
    toUnicodeBoxedTag,
    toUnicodeHeading1,
    toUnicodeHeading2,
    applyTransformToSelection,
    insertSnippetAtCursor,
    setDragOverDropzone,
    toggleSkipComment,
    toggleGroupComment,
    updateLinkMode,
    updateLinkTime,
    removeLinkItem,
    updateLinkExtraGroupIds,
  } = actions;
  const hasCustomComment = !!item.affiliateLink?.trim();
  const isCommentOpen = !item.skipComment && (item.showCommentBox || hasCustomComment);
  const extraGroupOptions = buildExtraGroupOptions(groupAccountsWithId, primaryGroupIds);
  const itemExtraGroupIds = item.extraGroupIds || [];
  return (
    <div
      key={item.id}
      className="poster-post-card flex flex-col bg-white rounded-xl border border-slate-200 transition-all overflow-hidden"
    >
      <div className="poster-post-header">
        <div className="flex items-center gap-2 min-w-0">
          <span className="poster-post-number">{index + 1}</span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-800 flex items-center gap-2 flex-wrap">
              <span>Bài viết {index + 1}</span>
              {customTarget && (
                <Tag color="blue" className="!rounded-md !text-xs font-semibold !m-0 border-blue-300">
                  👤 {(() => {
                    const t = postingIdentities.find(a => accountTargetValue(a) === customTarget);
                    return (t?.pageName || customTarget).replace(/^👤\s*Nick Cá Nhân\s*\((.*)\)$/, '$1');
                  })()} · ⏰ {item.scheduledAt ? item.scheduledAt.format('HH:mm') : ''}
                </Tag>
              )}
            </div>
            <div className={`text-xs ${item.inputType === 'MANUAL'
              ? (item.manualContent?.trim() || (item.manualMediaUrls && item.manualMediaUrls.length > 0) ? 'text-emerald-400 font-semibold' : 'text-slate-300')
              : (item.url.trim() ? 'text-emerald-400 font-semibold' : 'text-slate-300')
              }`}>
              {item.inputType === 'MANUAL'
                ? (item.manualContent?.trim() || (item.manualMediaUrls && item.manualMediaUrls.length > 0) ? '✍️ Đã soạn nội dung' : '✍️ Chưa nhập nội dung')
                : (item.url.trim() ? '🌐 Đã nhận liên kết nguồn' : '🌐 Chưa có liên kết nguồn')}
            </div>
          </div>
        </div>

        <div className="poster-post-header-actions flex items-center gap-2 flex-wrap">
          <Select
            showSearch
            filterOption={(input, option) => {
              const label = String(option?.label || '').toLowerCase();
              const query = input.toLowerCase();
              if (label.includes(query)) return true;
              const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
              return strip(label).includes(strip(query));
            }}
            size="small"
            placeholder="Chọn nơi đăng bài..."
            value={
              customTarget ||
              distributionTargetValue ||
              (Array.isArray(watchedTargetFanpageId)
                ? watchedTargetFanpageId[index % Math.max(1, watchedTargetFanpageId.length)]
                : watchedTargetFanpageId) ||
              undefined
            }
            onChange={(val) => {
              setCustomItemTargets((prev) => ({
                ...prev,
                [item.id]: val,
              }));
            }}
            allowClear
            className="w-52 text-xs shrink-0"
            options={targetOptions}
          />
          {item.inputType !== 'MANUAL' && (
            <Tooltip title="Cào thử và xem trước ảnh/video trước khi đăng">
              <Button
                type="text"
                icon={<EyeOutlined />}
                loading={preview?.loading}
                onClick={() => handlePreviewLink(item)}
                disabled={!item.url.trim()}
                aria-label={`Xem trước bài ${index + 1}`}
                className="poster-icon-action text-blue-600"
              />
            </Tooltip>
          )}
          <Tooltip title="Xóa bài này">
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => removeLinkItem(item.id)}
              disabled={isOnlyItem && !item.url && !item.manualContent}
              aria-label={`Xóa bài ${index + 1}`}
              className="poster-icon-action"
            />
          </Tooltip>
        </div>
      </div>

      <div className="poster-post-body space-y-4">
        {/* Chuyển đổi giữa Dán link cào tự động và Tự soạn nội dung */}
        <div className="poster-source-switch flex items-center justify-between gap-3 flex-wrap">
          <Segmented
            size="middle"
            value={item.inputType || 'LINK'}
            onChange={(val) => updateLinkInputType(item.id, val as 'LINK' | 'MANUAL')}
            options={[
              {
                label: (
                  <span className="flex items-center gap-2 px-3 py-1 text-xs font-semibold">
                    <GlobalOutlined className="text-sm" /> Dán link cào tự động
                  </span>
                ),
                value: 'LINK',
              },
              {
                label: (
                  <span className="flex items-center gap-2 px-3 py-1 text-xs font-semibold">
                    <EditOutlined className="text-sm" /> Tự soạn nội dung & Studio
                  </span>
                ),
                value: 'MANUAL',
              },
            ]}
          />
          {item.inputType === 'MANUAL' && (
            <div className="flex items-center gap-2">
              {(!item.manualMediaUrls || item.manualMediaUrls.length === 0) ? (
                <Tag className="!font-medium !px-2.5 !py-0.5 !text-xs !rounded-lg !m-0 border border-slate-700 bg-slate-800 text-slate-300 flex items-center gap-1.5">
                  <FileTextOutlined className="text-blue-400" />
                  <span>Bài viết chữ (Pure Text)</span>
                </Tag>
              ) : (
                <Tag className="!font-medium !px-2.5 !py-0.5 !text-xs !rounded-lg !m-0 border border-slate-700 bg-slate-800 text-slate-300 flex items-center gap-1.5">
                  <PictureOutlined className="text-emerald-400" />
                  <span>{item.manualMediaUrls.length} Media ({item.manualMediaUrls.filter((u, i) => isMediaVideo(u, item.manualMediaKinds?.[i])).length} Video, {item.manualMediaUrls.filter((u, i) => !isMediaVideo(u, item.manualMediaKinds?.[i])).length} Ảnh)</span>
                </Tag>
              )}
            </div>
          )}
        </div>

        {item.inputType === 'MANUAL' ? (
          /* ================= GIAO DIỆN TỰ SOẠN BÀI VIẾT CHUYÊN NGHIỆP (STUDIO + LIVE PREVIEW) ================= */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* CỘT TRÁI (lg:col-span-7): TRÌNH SOẠN THẢO VÀ QUẢN LÝ MEDIA */}
            <div className="lg:col-span-7 space-y-4">
              {/* PHẦN 1: NỘI DUNG VĂN BẢN (CAPTION) */}
              <div className="bg-slate-900/90 border border-slate-700/80 rounded-2xl p-4 sm:p-5 space-y-3 shadow-md">
                <div className="flex items-center justify-between flex-wrap gap-2 pb-1 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <FileTextOutlined className="text-blue-400 text-base" />
                      <span>Nội dung bài viết (Caption):</span>
                    </label>
                    {(item.manualContent || '').length > 0 && (
                      <span className="text-xs font-bold text-blue-300 bg-blue-950 px-2 py-0.5 rounded-md border border-blue-800/60">
                        {(item.manualContent || '').length} ký tự · {(item.manualContent || '').trim().split(/\s+/).filter(Boolean).length} từ
                      </span>
                    )}
                  </div>
                  {(item.manualContent || '').trim() && (
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<ClearOutlined />}
                      onClick={() => updateLinkManualContent(item.id, '')}
                      className="text-xs h-7 px-2 font-bold"
                    >
                      Xóa trắng
                    </Button>
                  )}
                </div>

                {/* THANH CÔNG CỤ ĐỊNH DẠNG COMPACT SIÊU GỌN VÀ HIỆN ĐẠI (1 HÀNG) */}
                <div className="flex items-center gap-1.5 flex-wrap bg-slate-950 p-1.5 rounded-xl border border-slate-800/90 shadow-inner text-xs">
                  {/* Nhóm 1: Kiểu chữ Unicode */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <Tooltip title="Tiêu đề Lớn H1 (Viral)">
                      <button
                        type="button"
                        onClick={() => applyTransformToSelection(item.id, toUnicodeHeading1, 'Đã áp dụng Tiêu đề Lớn H1!')}
                        className="px-2.5 py-1 text-xs font-black bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-md transition-all active:scale-95 cursor-pointer shadow-sm"
                      >
                        H1
                      </button>
                    </Tooltip>

                    <Tooltip title="Tiêu đề Vừa H2">
                      <button
                        type="button"
                        onClick={() => applyTransformToSelection(item.id, toUnicodeHeading2, 'Đã áp dụng Tiêu đề Vừa H2!')}
                        className="px-2.5 py-1 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-blue-300 border border-slate-700/80 rounded-md transition-all active:scale-95 cursor-pointer"
                      >
                        H2
                      </button>
                    </Tooltip>

                    <Tooltip title="In đậm Sans (𝗕𝗼𝗹𝗱)">
                      <button
                        type="button"
                        onClick={() => applyTransformToSelection(item.id, toUnicodeBold, 'Đã in đậm (Sans Bold)!')}
                        className="px-2.5 py-1 text-xs font-black bg-slate-900 hover:bg-slate-800 text-slate-100 border border-slate-700/80 rounded-md transition-all active:scale-95 cursor-pointer"
                      >
                        𝗕
                      </button>
                    </Tooltip>

                    <Tooltip title="In nghiêng (𝘐𝘵𝘢𝘭𝘪𝘤)">
                      <button
                        type="button"
                        onClick={() => applyTransformToSelection(item.id, toUnicodeItalic, 'Đã in nghiêng (Italic)!')}
                        className="px-2.5 py-1 text-xs italic font-bold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 rounded-md transition-all active:scale-95 cursor-pointer"
                      >
                        𝘐
                      </button>
                    </Tooltip>

                    <Tooltip title="Gạch ngang (S̶a̶l̶e̶)">
                      <button
                        type="button"
                        onClick={() => applyTransformToSelection(item.id, toUnicodeStrikethrough, 'Đã gạch ngang chữ!')}
                        className="px-2.5 py-1 text-xs font-semibold line-through bg-slate-900 hover:bg-rose-950 text-rose-300 border border-slate-700/80 rounded-md transition-all active:scale-95 cursor-pointer"
                      >
                        S̶
                      </button>
                    </Tooltip>

                    <Tooltip title="Gạch chân (U̲n̲d̲e̲r̲l̲i̲n̲e̲)">
                      <button
                        type="button"
                        onClick={() => applyTransformToSelection(item.id, toUnicodeUnderline, 'Đã gạch chân chữ!')}
                        className="px-2.5 py-1 text-xs font-semibold underline bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 rounded-md transition-all active:scale-95 cursor-pointer"
                      >
                        U̲
                      </button>
                    </Tooltip>

                    <Tooltip title="Khung nổi bật 【 𝗧𝗘𝗫𝗧 】">
                      <button
                        type="button"
                        onClick={() => applyTransformToSelection(item.id, toUnicodeBoxedTag, 'Đã đóng khung nổi bật!')}
                        className="px-2.5 py-1 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-slate-700/80 rounded-md transition-all active:scale-95 cursor-pointer"
                      >
                        【Tag】
                      </button>
                    </Tooltip>

                    {/* Font khác Menu */}
                    <Popover
                      trigger="click"
                      placement="bottomLeft"
                      content={
                        <div className="flex flex-col gap-1 p-1">
                          <button
                            type="button"
                            onClick={() => applyTransformToSelection(item.id, toUnicodeSerifBold, 'Đã in đậm Serif!')}
                            className="px-2.5 py-1 text-xs font-serif font-black bg-slate-800 hover:bg-slate-700 text-slate-100 rounded text-left cursor-pointer"
                          >
                            𝐁 đậm Serif
                          </button>
                          <button
                            type="button"
                            onClick={() => applyTransformToSelection(item.id, toUnicodeBoldItalic, 'Đã in đậm nghiêng!')}
                            className="px-2.5 py-1 text-xs italic font-black bg-slate-800 hover:bg-slate-700 text-amber-300 rounded text-left cursor-pointer"
                          >
                            𝘼 nghiêng đậm
                          </button>
                        </div>
                      }
                    >
                      <button
                        type="button"
                        className="px-2 py-1 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 rounded-md flex items-center gap-1 cursor-pointer"
                      >
                        <span>Font...</span>
                        <DownOutlined className="text-[10px]" />
                      </button>
                    </Popover>
                  </div>

                  <div className="h-4 w-px bg-slate-800 my-auto hidden sm:block" />

                  {/* Nhóm 2: Dấu câu / Bullet List */}
                  <div className="flex items-center gap-1">
                    <Tooltip title="Chèn dấu tích ✔">
                      <button
                        type="button"
                        onClick={() => insertSnippetAtCursor(item.id, '\n✔ ')}
                        className="h-7 w-7 text-xs font-bold bg-slate-900 hover:bg-emerald-950 text-emerald-400 border border-slate-700/80 rounded-md flex items-center justify-center cursor-pointer"
                      >
                        ✔
                      </button>
                    </Tooltip>
                    <Tooltip title="Chèn dấu chấm •">
                      <button
                        type="button"
                        onClick={() => insertSnippetAtCursor(item.id, '\n• ')}
                        className="h-7 w-7 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 rounded-md flex items-center justify-center cursor-pointer"
                      >
                        •
                      </button>
                    </Tooltip>
                    <Tooltip title="Chèn chỉ tay 👉">
                      <button
                        type="button"
                        onClick={() => insertSnippetAtCursor(item.id, '\n👉 ')}
                        className="h-7 w-7 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-amber-300 border border-slate-700/80 rounded-md flex items-center justify-center cursor-pointer"
                      >
                        👉
                      </button>
                    </Tooltip>
                    <Tooltip title="Chèn 1️⃣">
                      <button
                        type="button"
                        onClick={() => insertSnippetAtCursor(item.id, '\n1️⃣ ')}
                        className="h-7 w-7 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-blue-300 border border-slate-700/80 rounded-md flex items-center justify-center cursor-pointer"
                      >
                        1️⃣
                      </button>
                    </Tooltip>
                  </div>

                  <div className="h-4 w-px bg-slate-800 my-auto hidden sm:block" />

                  {/* Nhóm 3: Kẻ ngang Popover */}
                  <Popover
                    trigger="click"
                    placement="bottom"
                    content={
                      <div className="flex flex-col gap-1 p-1">
                        <button
                          type="button"
                          onClick={() => insertSnippetAtCursor(item.id, '\n━━━━━━━━━━━━━━━━━━━━━\n')}
                          className="px-2.5 py-1 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-left cursor-pointer"
                        >
                          ━━━━━━━━ Dày
                        </button>
                        <button
                          type="button"
                          onClick={() => insertSnippetAtCursor(item.id, '\n──────── ⋆⋅☆⋅⋆ ────────\n')}
                          className="px-2.5 py-1 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-left cursor-pointer"
                        >
                          ── ⋆⋅☆⋅⋆ ── Ngôi sao
                        </button>
                        <button
                          type="button"
                          onClick={() => insertSnippetAtCursor(item.id, '\n═════════════════════\n')}
                          className="px-2.5 py-1 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-left cursor-pointer"
                        >
                          ════════ Kẻ đôi
                        </button>
                      </div>
                    }
                  >
                    <button
                      type="button"
                      className="px-2 py-1 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 rounded-md flex items-center gap-1 cursor-pointer"
                    >
                      <HolderOutlined className="text-amber-400 text-xs" />
                      <span>Kẻ ngang</span>
                      <DownOutlined className="text-[10px] text-slate-300" />
                    </button>
                  </Popover>

                  {/* Nhóm 4: Mẫu CTA Popover */}
                  <Popover
                    trigger="click"
                    placement="bottom"
                    content={
                      <div className="flex flex-col gap-1 p-1 min-w-44">
                        <button
                          type="button"
                          onClick={() => insertSnippetAtCursor(item.id, '\n\n👇 BÌNH LUẬN XUỐNG DƯỚI ĐỂ ĐƯỢC TƯ VẤN 👇\n')}
                          className="px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-purple-950 text-purple-300 rounded text-left cursor-pointer"
                        >
                          👇 Cmt tư vấn
                        </button>
                        <button
                          type="button"
                          onClick={() => insertSnippetAtCursor(item.id, '\n\n👉 INBOX NGAY ĐỂ NHẬN ƯU ĐÃI! 🔥\n')}
                          className="px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-amber-950 text-amber-300 rounded text-left cursor-pointer"
                        >
                          🔥 Inbox ưu đãi
                        </button>
                        <button
                          type="button"
                          onClick={() => insertSnippetAtCursor(item.id, '\n\n📌 LƯU LẠI BÀI VIẾT ĐỂ DÙNG KHI CẦN NHÉ! ❤️\n')}
                          className="px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-blue-950 text-blue-300 rounded text-left cursor-pointer"
                        >
                          📌 Lưu bài viết
                        </button>
                      </div>
                    }
                  >
                    <button
                      type="button"
                      className="px-2 py-1 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-purple-300 border border-slate-700/80 rounded-md flex items-center gap-1 cursor-pointer"
                    >
                      <RocketOutlined className="text-purple-400 text-xs" />
                      <span>Mẫu CTA</span>
                      <DownOutlined className="text-[10px] text-slate-300" />
                    </button>
                  </Popover>

                  {/* Nhóm 5: Hashtag Popover */}
                  <Popover
                    trigger="click"
                    placement="bottom"
                    content={
                      <div className="grid grid-cols-2 gap-1 p-1 w-56">
                        {['#Trending', '#Review', '#Hot', '#ChiaSe', '#GocNhin', '#Sale', '#MeoHay', '#KhuyenMai'].map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => {
                              const cur = item.manualContent || '';
                              const spacer = cur && !cur.endsWith(' ') && !cur.endsWith('\n') ? ' ' : '';
                              updateLinkManualContent(item.id, cur + spacer + tag + ' ');
                            }}
                            className="px-2 py-1 text-xs font-bold bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white rounded text-center cursor-pointer transition-colors"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    }
                  >
                    <button
                      type="button"
                      className="px-2 py-1 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-blue-300 border border-slate-700/80 rounded-md flex items-center gap-1 cursor-pointer"
                    >
                      <TagOutlined className="text-blue-400 text-xs" />
                      <span>Thẻ Hot</span>
                      <DownOutlined className="text-[10px] text-slate-300" />
                    </button>
                  </Popover>

                  {/* Nhóm 6: Emojis Popover */}
                  <Popover
                    trigger="click"
                    placement="bottomRight"
                    content={
                      <div className="grid grid-cols-5 gap-1 p-1.5 w-48">
                        {['🔥', '📌', '💥', '⭐', '🚀', '❤️', '👇', '🎯', '✨', '🛒', '🏷️', '📢', '✅', '🎁', '💡', '🐾', '🐶', '🐱', '💯', '💬'].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => insertSnippetAtCursor(item.id, emoji)}
                            className="h-7 w-7 text-base bg-slate-800 hover:bg-slate-700 rounded text-slate-100 border border-slate-700/60 hover:scale-125 transition-all flex items-center justify-center cursor-pointer"
                            title={`Chèn icon ${emoji}`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    }
                  >
                    <button
                      type="button"
                      className="px-2 py-1 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-amber-300 border border-slate-700/80 rounded-md flex items-center gap-1 cursor-pointer"
                    >
                      <SmileOutlined className="text-amber-400 text-xs" />
                      <span>Icon</span>
                      <DownOutlined className="text-[10px] text-slate-300" />
                    </button>
                  </Popover>
                </div>

                <TextArea
                  id={`manual-content-textarea-${item.id}`}
                  rows={6}
                  placeholder="Nhập nội dung bài viết muốn đăng lên Facebook (hỗ trợ văn bản thuần, H1, H2, in đậm, in nghiêng, gạch ngang, icon, hashtag, xuống dòng nhiều đoạn)..."
                  value={item.manualContent || ''}
                  onChange={(e) => updateLinkManualContent(item.id, e.target.value)}
                  onPaste={(e) => handlePasteMediaFromClipboard(item.id, e)}
                  className="text-sm p-3.5 bg-slate-950/90 border-slate-700 text-slate-100 rounded-xl font-normal focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder:text-slate-500 leading-relaxed shadow-inner"
                  autoSize={{ minRows: 6, maxRows: 14 }}
                />

                <div className="mt-2 px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
                  <div className="flex items-center gap-2 text-slate-300">
                    <span className="w-5 h-5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
                      <PictureOutlined className="text-xs" />
                    </span>
                    <span>
                      Bấm <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-100 font-mono text-xs">Ctrl+V</kbd> (Cmd+V) vào ô để tự động đính kèm ảnh chụp màn hình
                    </span>
                  </div>
                  <Button
                    size="middle"
                    type="default"
                    icon={<CopyOutlined className="text-blue-400" />}
                    onClick={() => handlePasteFromClipboardButton(item.id)}
                    className="text-xs font-semibold bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-100"
                  >
                    Dán ảnh từ Clipboard
                  </Button>
                </div>

                {(!item.manualMediaUrls || item.manualMediaUrls.length === 0) && (item.manualContent || "").trim().length > 0 && (item.manualContent || "").trim().length <= 200 && !item.colorBackground && (
                  <div className="mt-2.5 px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-slate-900 via-slate-900 to-slate-900 border border-slate-700/80 flex items-center justify-between flex-wrap gap-2 text-[13px] text-slate-200 shadow-lg">
                    <div className="flex items-center gap-2.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                      <span><b>Tự động 100%:</b> Bài viết text ngắn (&le; 200 ký tự) sẽ được tự động vẽ <b>ảnh Nền Đen Chữ Trắng (Style BOX Y Khoa)</b> to đậm căn giữa khi đăng.</span>
                    </div>
                    <Tag color="cyan" className="!m-0 font-mono font-bold !text-xs px-2 py-0.5">
                      {(item.manualContent || "").trim().length}/200 ký tự
                    </Tag>
                  </div>
                )}

                {item.colorBackground && (
                  <div className="mt-2.5 p-3 rounded-xl bg-red-950/40 border border-red-800/60 space-y-2.5">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-bold text-red-300">
                          {item.colorBackground === 'RED_PHOTO_TRICK' ? '🔴 Đang chọn: Nền Đỏ + Kèm Ảnh (Mẹo 3 chấm)' : '🔴 Đang chọn: Status Nền Đỏ (Thuần chữ)'}
                        </span>
                        <div className="inline-flex rounded-lg bg-black/40 p-0.5 border border-red-800/50 text-xs">
                          <button
                            type="button"
                            onClick={() => toggleColorBackground(item.id, true)}
                            className={`px-2.5 py-1 rounded-md font-semibold transition-all ${item.colorBackground === true
                              ? 'bg-red-600 text-white shadow-sm'
                              : 'text-red-300 hover:text-white'
                              }`}
                          >
                            Thuần chữ
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleColorBackground(item.id, 'RED_PHOTO_TRICK')}
                            className={`px-2.5 py-1 rounded-md font-semibold transition-all ${item.colorBackground === 'RED_PHOTO_TRICK'
                              ? 'bg-red-600 text-white shadow-sm'
                              : 'text-red-300 hover:text-white'
                              }`}
                          >
                            Kèm ảnh (Mẹo 3 chấm)
                          </button>
                        </div>
                        <Tag
                          color={(item.manualContent || "").length <= 130 ? "success" : "error"}
                          className="!m-0 !text-xs font-mono font-bold px-2 py-0.5"
                        >
                          {(item.manualContent || "").length} / 130 ký tự
                        </Tag>
                      </div>
                      {(item.manualContent || "").length > 130 && (
                        <Button
                          size="small"
                          danger
                          type="primary"
                          className="text-xs rounded-lg font-bold h-7 px-3 shadow-md"
                          onClick={() => {
                            const cur = (item.manualContent || "").trim();
                            const firstLine = cur.split(/\r?\n/)[0] || cur;
                            const trimmed = firstLine.length <= 112 ? firstLine + "... (Xem cmt 👇)" : firstLine.slice(0, 110).trim() + "... (Xem cmt 👇)";
                            updateLinkManualContent(item.id, trimmed);
                            if (!item.affiliateLink) {
                              updateLinkAffiliate(item.id, cur);
                            }
                          }}
                        >
                          ⚡ Rút gọn nhanh &lt; 130 ký tự
                        </Button>
                      )}
                    </div>

                    {item.colorBackground === 'RED_PHOTO_TRICK' && (
                      <div className="text-xs text-amber-200 bg-amber-950/40 p-2.5 rounded-lg border border-amber-800/40 flex items-center gap-1.5">
                        <span>💡</span>
                        <span><b>Mẹo Facebook 3 chấm:</b> Bot sẽ đăng kèm ảnh trước, sau đó tự động vào <b>3 chấm &rarr; Sửa bài &rarr; Gỡ ảnh &rarr; Đổi phông nền Đỏ &rarr; Lưu</b> và bình luận bài viết chi tiết bên dưới.</span>
                      </div>
                    )}

                    {(item.manualContent || "").length > 130 && (
                      <Alert
                        type="error"
                        showIcon
                        className="!p-2.5 text-xs rounded-lg border-red-700/60 bg-red-900/30 text-red-200"
                        message={
                          <div>
                            <b>⚠️ Vượt quá 130 ký tự!</b> Facebook sẽ <b>tự động hủy phông nền đỏ</b> và biến thành bài chữ đen nhỏ nền trắng. Vui lòng bấm <b>"⚡ Rút gọn nhanh &lt; 130 ký tự"</b> hoặc tự sửa tít cho ngắn lại. Toàn bộ nội dung bài viết đã được giữ trong bình luận.
                          </div>
                        }
                      />
                    )}
                  </div>
                )}

                {item.colorBackground && (
                  <div className="mt-2.5">
                    <ColorPostPreview
                      text={item.manualContent || ''}
                      comment={item.skipComment ? null : (item.affiliateLink?.trim() || defaultCommentPreview)}
                      authorName={previewAuthorName}
                      hasMedia={!!item.manualMediaUrls?.length}
                      mode={item.colorBackground}
                    />
                  </div>
                )}
              </div>

              {/* PHẦN 2: DRAG & DROP MEDIA ZONE & THƯ VIỆN ẢNH/VIDEO */}
              <div className="bg-slate-900/90 border border-slate-700/80 rounded-2xl p-4 sm:p-5 space-y-4 shadow-md">
                <div className="flex items-center justify-between flex-wrap gap-2 pb-1 border-b border-slate-800">
                  <div>
                    <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <PictureOutlined className="text-emerald-400 text-base" />
                      <span>Đính kèm Hình ảnh & Video</span>
                      <Tag color="default" className="!text-xs !m-0 !font-normal border-slate-700 text-slate-300 bg-slate-800">
                        Tùy chọn
                      </Tag>
                    </div>
                    <div className="text-xs text-slate-300 mt-0.5">
                      Kéo thả tệp từ máy tính, dán ảnh từ Clipboard (Ctrl+V) hoặc dán link media trực tiếp.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="small"
                      type="default"
                      icon={<CopyOutlined className="text-blue-400" />}
                      onClick={() => handlePasteFromClipboardButton(item.id)}
                      className="text-xs h-7 px-2.5 font-medium bg-slate-800 border-slate-700 text-slate-200 hover:text-blue-400 hover:border-blue-500/50"
                    >
                      Dán ảnh (Ctrl+V)
                    </Button>
                    {(item.manualMediaUrls && item.manualMediaUrls.length > 0) && (
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<ClearOutlined />}
                        onClick={() => {
                          setLinkItems(prev => prev.map(it => it.id === item.id ? { ...it, manualMediaUrls: [], manualMediaKinds: [] } : it));
                          message.info('Đã xóa toàn bộ media đính kèm');
                        }}
                        className="text-xs h-7 px-2 font-bold"
                      >
                        Xóa tất cả ({item.manualMediaUrls.length})
                      </Button>
                    )}
                  </div>
                </div>

                {/* DROPZONE KÉO THẢ TỆP HIỆN ĐẠI */}
                <div
                  tabIndex={0}
                  onPaste={(e) => handlePasteMediaFromClipboard(item.id, e)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverDropzone(item.id);
                  }}
                  onDragLeave={() => setDragOverDropzone(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverDropzone(null);
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      handleUploadMedia(item.id, e.dataTransfer.files);
                    }
                  }}
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (!target.closest('button') && !target.closest('.ant-tag')) {
                      document.getElementById(`manual-file-input-${item.id}`)?.click();
                    }
                  }}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-2.5 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 ${dragOverDropzone === item.id
                    ? 'border-blue-400 bg-blue-500/10 ring-4 ring-blue-500/20 scale-[1.01]'
                    : 'border-slate-700 hover:border-emerald-500/80 bg-slate-950/60 hover:bg-slate-950/90'
                    }`}
                >
                  <input
                    type="file"
                    id={`manual-file-input-${item.id}`}
                    multiple
                    accept="image/*,video/mp4,video/quicktime,video/webm"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files) {
                        handleUploadMedia(item.id, e.target.files);
                        e.target.value = '';
                      }
                    }}
                  />
                  <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-2xl shadow-inner">
                    <CloudUploadOutlined />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-200">
                      Kéo & thả, <span className="text-cyan-400 underline decoration-cyan-400/50 underline-offset-2">Dán (Ctrl+V / Cmd+V)</span> ảnh / video vào đây hoặc <span className="text-emerald-400 underline decoration-emerald-400/50 underline-offset-2">Duyệt từ máy tính</span>
                    </div>
                    <div className="text-xs text-slate-300 mt-1.5 flex items-center justify-center gap-2 flex-wrap">
                      <Tag
                        color="blue"
                        className="!m-0 !text-xs cursor-pointer hover:opacity-85 font-medium flex items-center gap-1"
                        onClick={(e) => { e.stopPropagation(); handlePasteFromClipboardButton(item.id); }}
                      >
                        <CopyOutlined /> Dán nhanh Ctrl+V / Cmd+V
                      </Tag>
                      <Tag color="blue" className="!m-0 !text-xs">JPG, PNG, WEBP</Tag>
                      <Tag color="purple" className="!m-0 !text-xs">MP4, MOV, WEBM</Tag>
                      <span>· Chọn hoặc dán nhiều tệp cùng lúc</span>
                    </div>
                  </div>
                </div>

                {/* Ô NHẬP LINK MEDIA TRỰC TIẾP */}
                <div className="flex items-center gap-2 bg-slate-950/80 p-2 rounded-xl border border-slate-800">
                  <Input
                    size="middle"
                    prefix={<LinkOutlined className="text-slate-400 mr-1" />}
                    placeholder="Hoặc dán URL ảnh / video trực tiếp (https://...jpg, .mp4) rồi bấm Thêm link"
                    value={manualMediaUrlInput || ''}
                    onChange={(e) => setManualMediaUrlInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                    onPressEnter={() => {
                      if (manualMediaUrlInput?.trim()) {
                        handleAddManualMediaUrl(item.id, manualMediaUrlInput);
                        setManualMediaUrlInputs(prev => ({ ...prev, [item.id]: '' }));
                      }
                    }}
                    className="text-xs bg-slate-900 border-slate-700 text-slate-200 rounded-lg h-9"
                  />
                  <Button
                    size="middle"
                    type="primary"
                    icon={<PlusCircleOutlined />}
                    onClick={() => {
                      if (manualMediaUrlInput?.trim()) {
                        handleAddManualMediaUrl(item.id, manualMediaUrlInput);
                        setManualMediaUrlInputs(prev => ({ ...prev, [item.id]: '' }));
                      }
                    }}
                    className="rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 h-9 px-4 shrink-0 shadow-sm"
                  >
                    Thêm link
                  </Button>
                </div>

                {/* DANH SÁCH MEDIA ĐÃ ĐÍNH KÈM */}
                {(item.manualMediaUrls && item.manualMediaUrls.length > 0) ? (
                  <div className="space-y-3 pt-2">
                    <div className="text-xs font-bold text-slate-300 flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        Thư viện media đã chọn ({item.manualMediaUrls.length} tệp):
                        <Button size="small" onClick={() => openNewsCardForItem(item, 'MANUAL')}>Tạo ảnh tin</Button>
                      </span>
                      <span className="text-xs text-amber-300 font-semibold bg-amber-950/60 px-2.5 py-0.5 rounded border border-amber-800/60">
                        👑 Vị trí đầu tiên (#1) sẽ là Ảnh/Video Bìa chính
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {item.manualMediaUrls.map((mUrl, mIdx) => {
                        const isVid = (item.manualMediaKinds?.[mIdx] === 'video') || isMediaVideo(mUrl);
                        const isCover = mIdx === 0;

                        return (
                          <div
                            key={`manual-m-${mIdx}-${mUrl.slice(-15)}`}
                            className={`relative rounded-xl overflow-hidden border bg-slate-900 flex flex-col p-2 shadow-lg transition-all ${isCover ? 'border-amber-500/90 ring-2 ring-amber-500/40 shadow-amber-500/10' : 'border-slate-700 hover:border-slate-500'
                              }`}
                          >
                            <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-slate-950 flex items-center justify-center">
                              {isVid ? (
                                <video src={mUrl} className="w-full h-full object-cover" muted preload="metadata" />
                              ) : (
                                <Image src={mUrl} alt={`media-${mIdx}`} className="w-full h-full object-cover" />
                              )}

                              <div className="absolute top-1.5 left-1.5 z-10">
                                {isCover ? (
                                  <Tag color="gold" className="!text-xs !font-bold !m-0 !px-1.5 !py-0.5 shadow-md border-0">
                                    👑 Bìa #1
                                  </Tag>
                                ) : (
                                  <Tag color={isVid ? 'purple' : 'blue'} className="!text-xs !font-bold !m-0 !px-1.5 !py-0.5 shadow-md border-0">
                                    {isVid ? '🎥' : '🖼️'} #{mIdx + 1}
                                  </Tag>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-1 pt-2">
                              <div className="flex items-center gap-1">
                                <Tooltip title="Chuyển lên trước">
                                  <Button
                                    size="small"
                                    type="text"
                                    icon={<ArrowLeftOutlined className="text-xs" />}
                                    disabled={mIdx === 0}
                                    onClick={() => moveManualMediaItem(item.id, mIdx, mIdx - 1)}
                                    className="h-7 w-7 !p-0 text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg disabled:opacity-30 disabled:bg-transparent"
                                  />
                                </Tooltip>
                                <Tooltip title="Chuyển xuống sau">
                                  <Button
                                    size="small"
                                    type="text"
                                    icon={<ArrowRightOutlined className="text-xs" />}
                                    disabled={mIdx === item.manualMediaUrls!.length - 1}
                                    onClick={() => moveManualMediaItem(item.id, mIdx, mIdx + 1)}
                                    className="h-7 w-7 !p-0 text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg disabled:opacity-30 disabled:bg-transparent"
                                  />
                                </Tooltip>
                                {!isCover && (
                                  <Tooltip title="Đặt làm Ảnh / Video bìa chính (vị trí #1)">
                                    <Button
                                      size="small"
                                      type="text"
                                      icon={<StarOutlined className="text-amber-400 text-xs" />}
                                      onClick={() => moveManualMediaItem(item.id, mIdx, 0)}
                                      className="h-7 w-7 !p-0 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 rounded-lg border border-amber-500/30"
                                    />
                                  </Tooltip>
                                )}
                              </div>

                              <Tooltip title="Xóa tệp này">
                                <Button
                                  size="small"
                                  type="text"
                                  danger
                                  icon={<DeleteOutlined className="text-xs" />}
                                  onClick={() => removeManualMediaItem(item.id, mIdx)}
                                  className="h-7 w-7 !p-0 bg-red-500/10 hover:bg-red-500/20 rounded-lg"
                                />
                              </Tooltip>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-3 px-3 bg-slate-950/60 rounded-xl border border-slate-800 text-xs text-slate-400 flex items-center justify-center gap-2 flex-wrap">
                    <FileTextOutlined className="text-slate-400" />
                    <span>Chưa đính kèm media — Hệ thống sẽ tự động xuất bản dưới dạng</span>
                    <span className="text-cyan-400 font-bold bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/60">
                      Trạng thái chữ (Pure Text)
                    </span>
                    <span>lên Facebook.</span>
                  </div>
                )}
              </div>


              <div className="poster-post-options !p-2.5 sm:!p-3 bg-slate-950/60 rounded-2xl border border-slate-700/60 flex items-center gap-2 flex-wrap shadow-inner backdrop-blur-sm">
                <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5 mr-1 select-none">
                  <SettingOutlined className="text-slate-400 text-xs" /> Tùy chọn:
                </span>

                <Tooltip title="Đăng status phông nền màu đỏ giật tít trên Facebook (Tối đa 130 ký tự, toàn bộ nội dung bài viết & hashtag sẽ tự động thả ở bình luận đầu tiên)">
                  <button
                    type="button"
                    onClick={() => toggleColorBackground(item.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none ${item.colorBackground
                        ? 'poster-opt-chip is-active'
                        : 'poster-opt-chip'
                      }`}
                  >
                    <span className="poster-opt-dot" /><span>Status nền đỏ</span>
                    <span className="text-xs opacity-80">(&lt; 130 ký tự)</span>
                    {item.colorBackground && <CheckOutlined className="text-xs text-rose-400" />}
                  </button>
                </Tooltip>

                <Tooltip title={item.skipComment ? 'Bình luận đang bị tắt cho bài này' : (hasCustomComment ? 'Đã có bình luận riêng cho bài này' : 'Thêm bình luận / link Shopee riêng cho bài này')}>
                  <button
                    type="button"
                    onClick={() => toggleCommentBox(item.id)}
                    disabled={item.skipComment}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none disabled:opacity-40 disabled:cursor-not-allowed ${hasCustomComment || isCommentOpen
                        ? 'poster-opt-chip is-active'
                        : 'poster-opt-chip'
                      }`}
                  >
                    <MessageOutlined className="text-xs text-cyan-400" />
                    <span>{hasCustomComment ? 'Có bình luận riêng' : 'Thêm bình luận riêng'}</span>
                    {(hasCustomComment || isCommentOpen) && <CheckOutlined className="text-xs text-cyan-400" />}
                  </button>
                </Tooltip>

                <Tooltip title="Không đăng bất kỳ bình luận nào (kể cả cmt mặc định) cho riêng bài này">
                  <button
                    type="button"
                    onClick={() => toggleSkipComment(item.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none ${item.skipComment
                        ? 'poster-opt-chip is-active'
                        : 'poster-opt-chip'
                      }`}
                  >
                    <StopOutlined className="text-xs text-amber-400" />
                    <span>Không bình luận</span>
                    {item.skipComment && <CheckOutlined className="text-xs text-amber-400" />}
                  </button>
                </Tooltip>

                {postMode !== 'FANPAGE_ONLY' && (
                  <Tooltip title="Mặc định KHÔNG bình luận vào bài đăng trong Nhóm — bật tùy chọn này mới tự động bình luận link Affiliate cho bài này trong Nhóm.">
                    <button
                      type="button"
                      onClick={() => toggleGroupComment(item.id)}
                      disabled={item.skipComment}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none disabled:opacity-40 disabled:cursor-not-allowed ${item.groupCommentEnabled
                          ? 'poster-opt-chip is-active'
                          : 'poster-opt-chip'
                        }`}
                    >
                      <TeamOutlined className="text-xs text-emerald-400" />
                      <span>Bình luận trong Nhóm</span>
                      {item.groupCommentEnabled && <CheckOutlined className="text-xs text-emerald-400" />}
                    </button>
                  </Tooltip>
                )}
              </div>

              {/* Khung soạn bình luận riêng */}
              {isCommentOpen && (
                <div className="p-4 bg-slate-900/90 border border-slate-700/80 rounded-2xl space-y-2.5 shadow-md">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <MessageOutlined className="text-blue-400" />
                      <span>Bình luận riêng cho Bài #{index + 1}:</span>
                      {hasCustomComment && (
                        <Tag color="cyan" className="!text-xs !m-0 !py-0.5 !font-bold">
                          Đang dùng cmt riêng
                        </Tag>
                      )}
                    </span>
                    {!hasCustomComment && (
                      <Button
                        size="small"
                        type="link"
                        className="!p-0 text-xs text-slate-400 hover:text-slate-200"
                        onClick={() => toggleCommentBox(item.id)}
                      >
                        Đóng ô
                      </Button>
                    )}
                  </div>
                  <TextArea
                    placeholder="Nhập nội dung bình luận / link Shopee riêng cho bài này (hỗ trợ xuống dòng, emoji, link)... Nếu để trống sẽ tự động dùng bình luận chung bên dưới."
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    value={item.affiliateLink || ''}
                    onChange={(e) => updateLinkAffiliate(item.id, e.target.value)}
                    className="text-xs bg-slate-950 border-slate-700 text-slate-100 rounded-xl leading-relaxed"
                  />
                </div>
              )}
            </div>

            {/* CỘT PHẢI (lg:col-span-5): MÔ PHỎNG BÀI ĐĂNG FACEBOOK THỰC TẾ (LIVE SIMULATOR) */}
            <div className="lg:col-span-5 sticky top-4 space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5 uppercase tracking-wider">
                  <FacebookFilled className="text-blue-500 text-sm" /> Mô phỏng Feed Facebook
                </span>
                <Tag color="blue" className="!text-xs !m-0 !font-bold !px-2 !py-0.5">
                  Live Mockup
                </Tag>
              </div>

              {/* FACEBOOK POST MOCKUP CARD */}
              <div className="fb-mockup-card font-sans">
                {/* Header Facebook Post */}
                <div className="fb-mockup-head">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-bold text-base shrink-0 shadow-md">
                      {firstAccountPageName?.charAt(0)?.toUpperCase() || 'F'}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white truncate hover:underline cursor-pointer">
                        {firstAccountPageName || 'Trang Fanpage / Nhóm của bạn'}
                      </div>
                      <div className="text-[11px] fb-mockup-muted flex items-center gap-1">
                        <span>Vừa xong</span>
                        <span>·</span>
                        <GlobalOutlined className="text-[10px]" />
                      </div>
                    </div>
                  </div>
                  <div className="text-slate-400 hover:text-white p-1 rounded-full cursor-pointer">
                    <EllipsisOutlined className="text-lg" />
                  </div>
                </div>

                {/* Caption */}
                <div className="fb-mockup-caption">
                  {item.manualContent?.trim() ? (
                    item.manualContent
                  ) : (
                    <span className="text-slate-500 italic">
                      (Nội dung bài viết sẽ hiển thị tại đây khi bạn nhập...)
                    </span>
                  )}
                </div>

                {/* Media Collage Mockup */}
                {item.manualMediaUrls && item.manualMediaUrls.length > 0 && (
                  <div className="fb-mockup-media">
                    {(() => {
                      const urls = item.manualMediaUrls || [];
                      const isVid = (u: string, idx: number) => (item.manualMediaKinds?.[idx] === 'video') || isMediaVideo(u);

                      if (urls.length === 1) {
                        return isVid(urls[0], 0) ? (
                          <video src={urls[0]} controls playsInline className="w-full max-h-[360px] object-contain mx-auto" />
                        ) : (
                          <img src={urls[0]} alt="fb-1" className="w-full max-h-[360px] object-cover" />
                        );
                      }

                      if (urls.length === 2) {
                        return (
                          <div className="grid grid-cols-2 gap-1 max-h-[300px] overflow-hidden">
                            {urls.map((u, idx) => (
                              <div key={idx} className="relative aspect-square overflow-hidden bg-slate-900">
                                {isVid(u, idx) ? (
                                  <video src={u} className="w-full h-full object-cover" muted />
                                ) : (
                                  <img src={u} alt={`fb-${idx}`} className="w-full h-full object-cover" />
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      }

                      if (urls.length === 3) {
                        return (
                          <div className="grid grid-cols-3 gap-1 max-h-[260px] overflow-hidden">
                            {urls.map((u, idx) => (
                              <div key={idx} className="relative aspect-square overflow-hidden bg-slate-900">
                                {isVid(u, idx) ? (
                                  <video src={u} className="w-full h-full object-cover" muted />
                                ) : (
                                  <img src={u} alt={`fb-${idx}`} className="w-full h-full object-cover" />
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      }

                      // 4+ media items (Facebook Grid Collage)
                      const displayUrls = urls.slice(0, 4);
                      const remaining = urls.length - 4;

                      return (
                        <div className="grid grid-cols-2 gap-1 max-h-[320px] overflow-hidden">
                          {displayUrls.map((u, idx) => {
                            const isLast = idx === 3 && remaining > 0;
                            return (
                              <div key={idx} className="relative aspect-square overflow-hidden bg-slate-900">
                                {isVid(u, idx) ? (
                                  <video src={u} className="w-full h-full object-cover" muted />
                                ) : (
                                  <img src={u} alt={`fb-${idx}`} className="w-full h-full object-cover" />
                                )}
                                {isLast && (
                                  <div className="absolute inset-0 bg-black/65 flex items-center justify-center text-white text-2xl font-bold backdrop-blur-sm">
                                    +{remaining}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Interaction Counts */}
                <div className="fb-mockup-counts">
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center text-[9px] text-white">👍</span>
                    <span className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center text-[9px] text-white">❤️</span>
                    <span>1.2K</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span>48 bình luận</span>
                    <span>12 lượt chia sẻ</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="fb-mockup-actions">
                  <button type="button" className="fb-mockup-action-btn">
                    <LikeOutlined className="text-sm" /> Thích
                  </button>
                  <button type="button" className="fb-mockup-action-btn">
                    <CommentOutlined className="text-sm" /> Bình luận
                  </button>
                  <button type="button" className="fb-mockup-action-btn">
                    <ShareAltOutlined className="text-sm" /> Chia sẻ
                  </button>
                </div>

                {/* Simulated First Comment if affiliate/custom comment exists */}
                {item.affiliateLink?.trim() && !item.skipComment && (
                  <div className="fb-mockup-comment-wrap">
                    <div className="w-7 h-7 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                      {firstAccountPageName?.charAt(0)?.toUpperCase() || 'F'}
                    </div>
                    <div className="fb-mockup-comment-bubble space-y-1">
                      <div className="font-bold text-white text-[11px] flex items-center gap-1.5">
                        <span>{firstAccountPageName || 'Trang của bạn'}</span>
                        <Tag color="blue" className="!text-[9px] !m-0 !px-1 !py-0">Tác giả</Tag>
                      </div>
                      <div className="whitespace-pre-wrap break-words">{item.affiliateLink}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ================= GIAO DIỆN DÁN LINK CÀO TỰ ĐỘNG ================= */
          <>
            <label htmlFor={`post-link-${item.id}`} className="poster-field-label">Liên kết bài viết</label>
            <PasteLinkInput
              inputId={`post-link-${item.id}`}
              placeholder="Dán link Facebook, Threads, TikTok (No-Watermark), Reel hoặc video vào đây..."
              value={item.url}
              onChange={(val) => updateLinkUrl(item.id, val)}
              size="middle"
            />

            {preview?.loading && (
              <div className="rounded-xl border border-blue-500/30 bg-slate-900/80 p-3.5 flex items-center gap-3 backdrop-blur-md">
                <LoadingOutlined className="text-blue-400 text-lg" spin />
                <span className="text-xs text-blue-300 font-semibold">Đang cào dữ liệu và tải trước video / ảnh / caption...</span>
              </div>
            )}

            {item.url.trim() && preview && !preview.loading && (
              <div className="poster-preview-workspace rounded-xl border border-blue-500/30 bg-slate-900/80 p-3.5 space-y-3.5 backdrop-blur-md shadow-lg">
                {preview.error ? (
                  <Text type="danger" className="text-xs font-semibold">⚠️ {preview.error}</Text>
                ) : (
                  <div className="poster-preview-grid grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                    {/* CỘT TRÁI (lg:col-span-5): KHUNG XEM VÀ TÙY CHỈNH MEDIA (ẢNH & VIDEO) */}
                    <div className="poster-media-panel lg:col-span-4 space-y-2.5">
                      {/* Header thống kê media */}
                      <div className="flex items-center justify-between gap-2 flex-wrap pb-1.5 border-b border-slate-700/60">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {(preview.videoCount || 0) > 0 && (
                            <Tag color="purple" className="!m-0 !font-bold !px-2 !py-0.5">
                              🎥 {preview.videoCount} Video
                            </Tag>
                          )}
                          {(preview.imageCount || 0) > 0 && (
                            <Tag color="blue" className="!m-0 !font-bold !px-2 !py-0.5">
                              🖼️ {preview.imageCount} Ảnh
                            </Tag>
                          )}
                          {(item.url.includes('tiktok.com') || preview.watermarkRemoved) && (
                            <Tag color="green" className="!m-0 !font-bold !px-2 !py-0.5 !text-emerald-300 !bg-emerald-950/80 !border-emerald-500/50">
                              ✨ Sạch Logo TikTok
                            </Tag>
                          )}
                          <span className="text-xs text-slate-300 font-medium">Sẵn sàng xuất bản</span>
                        </div>
                        {(preview.imageCount || 0) > 0 && (
                          <Button size="small" onClick={() => openNewsCardForItem(item, 'LINK')} title="Ghép ảnh + tiêu đề in hoa tô đỏ kiểu page tin tức, thay cho ảnh đăng">
                            Tạo ảnh tin
                          </Button>
                        )}
                      </div>

                      {/* Xem và Tùy biến Thứ tự / Xóa bớt Video & Album Ảnh */}
                      {(preview.mediaUrls?.length || 0) > 0 && (
                        <div className="space-y-2.5">
                          {(() => {
                            const mediaUrls = preview.mediaUrls || [];
                            const originalUrls = preview.originalMediaUrls || [];
                            const hasCustomizedMedia =
                              mediaUrls.length !== originalUrls.length ||
                              mediaUrls.some((u, i) => u !== originalUrls[i]);

                            const isVideo = (u: string, idx: number) => isMediaVideo(u, preview.mediaKinds?.[idx]);
                            const photoUrls = mediaUrls.filter((u, i) => !isVideo(u, i));
                            const videoUrls = mediaUrls.filter((u, i) => isVideo(u, i));

                            return (
                              <>
                                {/* Danh sách Video */}
                                {videoUrls.length > 0 && (
                                  <div className="bg-slate-950/70 rounded-xl p-2.5 border border-slate-800 space-y-2">
                                    <div className="flex items-center justify-between text-xs text-slate-300 font-semibold">
                                      <span>Video đính kèm ({videoUrls.length}):</span>
                                      {hasCustomizedMedia && (
                                        <span className="text-amber-400 text-xs">Đã chỉnh sửa</span>
                                      )}
                                    </div>
                                    <div className="space-y-2">
                                      {mediaUrls.map((mUrl, mIdx) => {
                                        if (!isVideo(mUrl, mIdx)) return null;
                                        return (
                                          <div key={`v-${mIdx}-${mUrl.slice(-15)}`} className="relative rounded-lg overflow-hidden border border-slate-700 bg-black flex flex-col group">
                                            <div className="relative aspect-video w-full bg-slate-950 flex items-center justify-center">
                                              <video
                                                src={mUrl}
                                                controls
                                                playsInline
                                                preload="metadata"
                                                className="w-full h-full object-contain max-h-[160px]"
                                              />
                                              <button
                                                type="button"
                                                className="poster-media-expand"
                                                onClick={() => setMediaViewer({ url: mUrl, kind: 'video', title: `Video #${mIdx + 1}` })}
                                                aria-label={`Phóng to video ${mIdx + 1}`}
                                                title="Xem video toàn màn hình"
                                              >
                                                <EyeOutlined /> Phóng to
                                              </button>
                                              <div className="absolute top-1.5 left-1.5">
                                                <Tag color="purple" className="!text-xs !font-bold !m-0 !px-1.5 shadow-md">
                                                  🎥 Video #{mIdx + 1}
                                                </Tag>
                                              </div>
                                            </div>
                                            <div className="p-1.5 bg-slate-900/90 flex items-center justify-between border-t border-slate-800">
                                              <div className="flex items-center gap-1">
                                                <Tooltip title="Chuyển lên trước">
                                                  <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<ArrowLeftOutlined className="text-xs" />}
                                                    disabled={mIdx === 0}
                                                    onClick={() => moveMediaItem(item.id, mIdx, mIdx - 1)}
                                                    className="h-7 w-7 !p-0 text-slate-300 hover:text-white disabled:opacity-30"
                                                  />
                                                </Tooltip>
                                                <Tooltip title="Chuyển xuống sau">
                                                  <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<ArrowRightOutlined className="text-xs" />}
                                                    disabled={mIdx === mediaUrls.length - 1}
                                                    onClick={() => moveMediaItem(item.id, mIdx, mIdx + 1)}
                                                    className="h-7 w-7 !p-0 text-slate-300 hover:text-white disabled:opacity-30"
                                                  />
                                                </Tooltip>
                                              </div>
                                              <Tooltip title="Xóa video này khỏi bài đăng">
                                                <Button
                                                  size="small"
                                                  type="text"
                                                  danger
                                                  icon={<DeleteOutlined className="text-xs" />}
                                                  onClick={() => removeMediaItem(item.id, mIdx)}
                                                  className="h-7 w-7 !p-0"
                                                />
                                              </Tooltip>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Danh sách Ảnh (Hỗ trợ Kéo thả trực tiếp, Đổi thứ tự, Đặt ảnh bìa, Xóa ảnh) */}
                                {photoUrls.length > 0 && (
                                  <div className="bg-slate-950/70 rounded-xl p-2.5 border border-slate-800">
                                    <Image.PreviewGroup>
                                      <div className="grid grid-cols-3 gap-2">
                                        {mediaUrls.map((mUrl, mIdx) => {
                                          if (isVideo(mUrl, mIdx)) return null;
                                          const isCover = mIdx === 0;
                                          const isDragging = draggedMedia?.itemId === item.id && draggedMedia.index === mIdx;
                                          const isDragOver = dragOverMedia?.itemId === item.id && dragOverMedia.index === mIdx && !isDragging;

                                          return (
                                            <div
                                              key={`p-${mIdx}-${mUrl.slice(-15)}`}
                                              draggable={true}
                                              onDragStart={(e) => handleMediaDragStart(e, item.id, mIdx)}
                                              onDragOver={(e) => handleMediaDragOver(e, item.id, mIdx)}
                                              onDragEnd={handleMediaDragEnd}
                                              onDrop={(e) => handleMediaDrop(e, item.id, mIdx)}
                                              className={`relative rounded-xl overflow-hidden border transition-all duration-200 bg-slate-900 group shadow-md flex flex-col cursor-grab active:cursor-grabbing select-none ${isDragging
                                                ? 'opacity-40 scale-95 border-dashed border-blue-500 ring-2 ring-blue-500/40'
                                                : isDragOver
                                                  ? 'border-blue-400 ring-2 ring-blue-400 scale-105 shadow-xl'
                                                  : isCover
                                                    ? 'border-amber-500/80 ring-2 ring-amber-500/30'
                                                    : 'border-slate-700/80 hover:border-slate-500'
                                                }`}
                                            >
                                              {/* Khung Ảnh */}
                                              <div className="relative aspect-square w-full overflow-hidden bg-slate-950 flex items-center justify-center">
                                                <Image
                                                  src={mUrl}
                                                  alt={`photo-${mIdx + 1}`}
                                                  preview={false}
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    setMediaViewer({ url: mUrl, kind: 'image', title: `Ảnh #${mIdx + 1}` });
                                                  }}
                                                  className="poster-zoomable-media w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                                                />

                                                {/* Badge thứ tự và biểu tượng Drag góc trên bên trái */}
                                                <div className="absolute top-1 left-1 z-10 flex items-center gap-1 pointer-events-auto">
                                                  <div className="w-5 h-5 rounded bg-black/65 text-slate-200 flex items-center justify-center text-[11px]" title="Kéo thả để đổi thứ tự">
                                                    <HolderOutlined />
                                                  </div>
                                                  {isCover ? (
                                                    <Tag color="gold" className="!text-[11px] !font-bold !m-0 !px-1.5 shadow-md border-0">
                                                      👑 Bìa
                                                    </Tag>
                                                  ) : (
                                                    <Tag color="blue" className="!text-[11px] !font-bold !m-0 !px-1.5 shadow-md border-0">
                                                      #{mIdx + 1}
                                                    </Tag>
                                                  )}
                                                </div>

                                                {/* Nút xóa nhanh góc trên bên phải */}
                                                <div className="absolute top-1 right-1 z-10 pointer-events-auto opacity-80 group-hover:opacity-100 transition-opacity">
                                                  <Tooltip title="Xóa ảnh này khỏi bài đăng">
                                                    <button
                                                      type="button"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        removeMediaItem(item.id, mIdx);
                                                      }}
                                                      className="w-6 h-6 rounded-full bg-black/75 hover:bg-red-600 text-white flex items-center justify-center text-xs transition-colors shadow"
                                                    >
                                                      <CloseOutlined />
                                                    </button>
                                                  </Tooltip>
                                                </div>
                                              </div>

                                              {/* Hàng điều khiển nút bấm nhanh dưới chân ảnh */}
                                              <div className="p-1.5 bg-slate-900 flex items-center justify-between border-t border-slate-800">
                                                <div className="flex items-center gap-1">
                                                  <Tooltip title="Di chuyển ảnh sang trái">
                                                    <button
                                                      type="button"
                                                      disabled={mIdx === 0}
                                                      onClick={() => moveMediaItem(item.id, mIdx, mIdx - 1)}
                                                      className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 flex items-center justify-center text-[11px] transition-colors"
                                                    >
                                                      <ArrowLeftOutlined />
                                                    </button>
                                                  </Tooltip>
                                                  <Tooltip title="Di chuyển ảnh sang phải">
                                                    <button
                                                      type="button"
                                                      disabled={mIdx === mediaUrls.length - 1}
                                                      onClick={() => moveMediaItem(item.id, mIdx, mIdx + 1)}
                                                      className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 flex items-center justify-center text-[11px] transition-colors"
                                                    >
                                                      <ArrowRightOutlined />
                                                    </button>
                                                  </Tooltip>
                                                </div>

                                                {!isCover && (
                                                  <Tooltip title="Đưa ảnh này lên đầu làm Ảnh bìa (Cover)">
                                                    <button
                                                      type="button"
                                                      onClick={() => moveMediaItem(item.id, mIdx, 0)}
                                                      className="px-1.5 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/30 text-amber-300 flex items-center gap-1 text-[11px] font-semibold transition-colors border border-amber-500/30"
                                                    >
                                                      <StarOutlined /> Bìa
                                                    </button>
                                                  </Tooltip>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </Image.PreviewGroup>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>

                    {/* CỘT PHẢI (lg:col-span-7): SOẠN CAPTION & TÙY CHỈNH HẸN GIỜ, BÌNH LUẬN RIÊNG */}
                    <div className="poster-caption-panel lg:col-span-8 space-y-3">
                      {/* Khung Soạn & Tinh chỉnh Caption */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                            <FileTextOutlined className="text-blue-400" />
                            <span>Caption bài viết (Tùy chỉnh nội dung):</span>
                          </label>
                          <Space size={4} wrap>
                            <Tooltip title="Chèn 'Cre: Member ẩn danh' trực tiếp vào ô caption bài này">
                              <Button
                                size="small"
                                type="text"
                                icon={<UserOutlined />}
                                onClick={() => {
                                  const currentCap = item.customCaption !== undefined ? item.customCaption : (preview?.caption || '');
                                  updateLinkCustomCaption(item.id, replaceOrAppendCreditText(currentCap, 'Member ẩn danh'));
                                }}
                                className="text-xs text-amber-400 hover:text-amber-300 bg-amber-950/40 border border-amber-800/40 rounded px-1.5"
                              >
                                + Cre: Ẩn danh
                              </Button>
                            </Tooltip>
                            <Tooltip title="⚡ Chèn 'Cre: Member ẩn danh' vào ô Caption cho TẤT CẢ bài viết trong danh sách chỉ với 1 click">
                              <Button
                                size="small"
                                type="text"
                                icon={<TeamOutlined />}
                                onClick={applyAnonymousCreditToAll}
                                className="text-xs text-amber-300 hover:text-amber-100 bg-amber-900/60 border border-amber-600/60 rounded px-1.5 font-bold shadow-sm"
                              >
                                ⚡ Ẩn danh (Tất cả bài)
                              </Button>
                            </Tooltip>
                            <Tooltip title={preview?.author ? `Chèn 'Cre: ${preview?.author}' vào ô caption` : "Chèn tên Tác giả gốc vào ô caption"}>
                              <Button
                                size="small"
                                type="text"
                                icon={<UserOutlined />}
                                onClick={() => {
                                  const currentCap = item.customCaption !== undefined ? item.customCaption : (preview?.caption || '');
                                  const authorName = preview?.author || (item as any).author || 'Tác giả gốc';
                                  updateLinkCustomCaption(item.id, replaceOrAppendCreditText(currentCap, authorName));
                                }}
                                className="text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 border border-cyan-800/40 rounded px-1.5"
                              >
                                {preview?.author ? `+ Cre: ${preview?.author}` : '+ Cre: Tác giả'}
                              </Button>
                            </Tooltip>
                            <Tooltip title="Khôi phục caption gốc từ nguồn cào">
                              <Button
                                size="small"
                                type="text"
                                icon={<RedoOutlined />}
                                onClick={() => updateLinkCustomCaption(item.id, preview?.caption || '')}
                                className="text-xs text-slate-400 hover:text-slate-200"
                              >
                                Gốc
                              </Button>
                            </Tooltip>
                            <Tooltip title="Xóa toàn bộ caption (đăng không lời)">
                              <Button
                                size="small"
                                type="text"
                                danger
                                icon={<ClearOutlined />}
                                onClick={() => updateLinkCustomCaption(item.id, '')}
                                className="text-xs"
                              >
                                Xóa
                              </Button>
                            </Tooltip>
                          </Space>
                        </div>
                        <TextArea
                          placeholder="Nhập hoặc chỉnh sửa caption bài viết (thêm hashtag, icon, lời bình, xóa câu chữ thừa)..."
                          value={item.customCaption !== undefined ? item.customCaption : (preview?.caption || '')}
                          onChange={(e) => updateLinkCustomCaption(item.id, e.target.value)}
                          className="text-[13px] sm:text-sm bg-slate-950/90 border-slate-700 text-slate-100 rounded-xl font-medium focus:border-blue-500 placeholder:text-slate-500 leading-relaxed p-3.5 shadow-inner min-h-[180px]"
                          autoSize={{ minRows: 8, maxRows: 24 }}
                        />

                        {item.colorBackground && (
                          <div className="mt-2.5 p-3 rounded-xl bg-red-950/40 border border-red-800/60 space-y-2.5">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-bold text-red-300">
                                  {item.colorBackground === 'RED_PHOTO_TRICK' ? '🔴 Đang chọn: Nền Đỏ + Kèm Ảnh (Mẹo 3 chấm)' : '🔴 Đang chọn: Status Nền Đỏ (Thuần chữ)'}
                                </span>
                                <div className="inline-flex rounded-lg bg-black/40 p-0.5 border border-red-800/50 text-xs">
                                  <button
                                    type="button"
                                    onClick={() => toggleColorBackground(item.id, true)}
                                    className={`px-2.5 py-1 rounded-md font-semibold transition-all ${item.colorBackground === true
                                      ? 'bg-red-600 text-white shadow-sm'
                                      : 'text-red-300 hover:text-white'
                                      }`}
                                  >
                                    Thuần chữ
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => toggleColorBackground(item.id, 'RED_PHOTO_TRICK')}
                                    className={`px-2.5 py-1 rounded-md font-semibold transition-all ${item.colorBackground === 'RED_PHOTO_TRICK'
                                      ? 'bg-red-600 text-white shadow-sm'
                                      : 'text-red-300 hover:text-white'
                                      }`}
                                  >
                                    Kèm ảnh (Mẹo 3 chấm)
                                  </button>
                                </div>
                                <Tag
                                  color={(item.customCaption !== undefined ? item.customCaption : (preview?.caption || "")).length <= 130 ? "success" : "error"}
                                  className="!m-0 !text-xs font-mono font-bold px-2 py-0.5"
                                >
                                  {(item.customCaption !== undefined ? item.customCaption : (preview?.caption || "")).length} / 130 ký tự
                                </Tag>
                              </div>
                              {(item.customCaption !== undefined ? item.customCaption : (preview?.caption || "")).length > 130 && (
                                <Button
                                  size="small"
                                  danger
                                  type="primary"
                                  className="text-xs rounded-lg font-bold h-7 px-3 shadow-md"
                                  onClick={() => {
                                    const cur = (item.customCaption !== undefined ? item.customCaption : (preview?.caption || "")).trim();
                                    const firstLine = cur.split(/\r?\n/)[0] || cur;
                                    const trimmed = firstLine.length <= 112 ? firstLine + "... (Xem cmt 👇)" : firstLine.slice(0, 110).trim() + "... (Xem cmt 👇)";
                                    updateLinkCustomCaption(item.id, trimmed);
                                    if (!item.affiliateLink) {
                                      updateLinkAffiliate(item.id, cur);
                                    }
                                  }}
                                >
                                  ⚡ Rút gọn nhanh &lt; 130 ký tự
                                </Button>
                              )}
                            </div>

                            {item.colorBackground === 'RED_PHOTO_TRICK' && (
                              <div className="text-xs text-amber-200 bg-amber-950/40 p-2.5 rounded-lg border border-amber-800/40 flex items-center gap-1.5">
                                <span>💡</span>
                                <span><b>Mẹo Facebook 3 chấm:</b> Bot sẽ đăng kèm ảnh trước, sau đó tự động vào <b>3 chấm &rarr; Sửa bài &rarr; Gỡ ảnh &rarr; Đổi phông nền Đỏ &rarr; Lưu</b> và bình luận toàn bộ nội dung bài báo bên dưới.</span>
                              </div>
                            )}

                            {(item.customCaption !== undefined ? item.customCaption : (preview?.caption || "")).length > 130 && (
                              <Alert
                                type="error"
                                showIcon
                                className="!p-2.5 text-xs rounded-lg border-red-700/60 bg-red-900/30 text-red-200"
                                message={
                                  <div>
                                    <b>⚠️ Vượt quá 130 ký tự!</b> Facebook sẽ <b>tự động hủy phông nền đỏ</b> và biến thành bài chữ đen nhỏ nền trắng. Vui lòng bấm <b>"⚡ Rút gọn nhanh &lt; 130 ký tự"</b> hoặc tự sửa tít cho ngắn lại. Toàn bộ nội dung bài báo đã được giữ trong bình luận.
                                  </div>
                                }
                              />
                            )}
                          </div>
                        )}

                        {item.colorBackground && (
                          <div className="mt-2.5">
                            <ColorPostPreview
                              text={item.customCaption !== undefined ? item.customCaption : (preview?.caption || '')}
                              comment={item.skipComment ? null : (item.affiliateLink?.trim() || defaultCommentPreview)}
                              authorName={previewAuthorName}
                              hasMedia={!!preview?.mediaUrls?.length}
                              mode={item.colorBackground}
                            />
                          </div>
                        )}
                      </div>


                      {/* Tùy chọn bài viết */}
                      <div className="poster-post-options !p-2.5 sm:!p-3 bg-slate-950/60 rounded-2xl border border-slate-700/60 flex items-center gap-2 flex-wrap shadow-inner backdrop-blur-sm">
                        <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5 mr-1 select-none">
                          <SettingOutlined className="text-slate-400 text-xs" /> Tùy chọn:
                        </span>

                        <Tooltip title="Đăng status phông nền màu đỏ giật tít trên Facebook (Tối đa 130 ký tự, toàn bộ nội dung bài báo & hashtag sẽ tự động thả ở bình luận đầu tiên)">
                          <button
                            type="button"
                            onClick={() => toggleColorBackground(item.id)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none ${item.colorBackground
                                ? 'poster-opt-chip is-active'
                                : 'poster-opt-chip'
                              }`}
                          >
                            <span className="poster-opt-dot" /><span>Status nền đỏ</span>
                            <span className="text-[10px] opacity-75">(&lt; 130 ký tự)</span>
                            {item.colorBackground && <CheckOutlined className="text-xs text-rose-400" />}
                          </button>
                        </Tooltip>

                        <Tooltip title="Tự động ghi nguồn tác giả bài viết ở cuối nội dung">
                          <button
                            type="button"
                            onClick={() => toggleIncludeCredit(item.id)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none ${item.includeCredit !== false
                                ? 'poster-opt-chip is-active'
                                : 'poster-opt-chip'
                              }`}
                          >
                            <UserOutlined className="text-xs text-blue-400" />
                            <span>Ghi nguồn tác giả</span>
                            {item.includeCredit !== false && <CheckOutlined className="text-xs text-blue-400" />}
                          </button>
                        </Tooltip>

                        <Tooltip title={item.skipComment ? 'Bình luận đang bị tắt cho bài này' : (hasCustomComment ? 'Đã có bình luận riêng cho bài này' : 'Thêm bình luận / link Shopee riêng cho bài này')}>
                          <button
                            type="button"
                            onClick={() => toggleCommentBox(item.id)}
                            disabled={item.skipComment}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none disabled:opacity-40 disabled:cursor-not-allowed ${hasCustomComment || isCommentOpen
                                ? 'poster-opt-chip is-active'
                                : 'poster-opt-chip'
                              }`}
                          >
                            <MessageOutlined className="text-xs text-cyan-400" />
                            <span>{hasCustomComment ? 'Có bình luận riêng' : 'Thêm bình luận riêng'}</span>
                            {(hasCustomComment || isCommentOpen) && <CheckOutlined className="text-xs text-cyan-400" />}
                          </button>
                        </Tooltip>

                        <Tooltip title="Không đăng bất kỳ bình luận nào (kể cả cmt mặc định) cho riêng bài này">
                          <button
                            type="button"
                            onClick={() => toggleSkipComment(item.id)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none ${item.skipComment
                                ? 'poster-opt-chip is-active'
                                : 'poster-opt-chip'
                              }`}
                          >
                            <StopOutlined className="text-xs text-amber-400" />
                            <span>Không bình luận</span>
                            {item.skipComment && <CheckOutlined className="text-xs text-amber-400" />}
                          </button>
                        </Tooltip>

                        {postMode !== 'FANPAGE_ONLY' && (
                          <Tooltip title="Mặc định KHÔNG bình luận vào bài đăng trong Nhóm — bật tùy chọn này mới tự động bình luận link Affiliate cho bài này trong Nhóm.">
                            <button
                              type="button"
                              onClick={() => toggleGroupComment(item.id)}
                              disabled={item.skipComment}
                              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none disabled:opacity-40 disabled:cursor-not-allowed ${item.groupCommentEnabled
                                  ? 'poster-opt-chip is-active'
                                  : 'poster-opt-chip'
                                }`}
                            >
                              <TeamOutlined className="text-xs text-emerald-400" />
                              <span>Bình luận trong Nhóm</span>
                              {item.groupCommentEnabled && <CheckOutlined className="text-xs text-emerald-400" />}
                            </button>
                          </Tooltip>
                        )}
                      </div>

                      {/* Khung soạn bình luận riêng */}
                      {isCommentOpen && (
                        <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                              <MessageOutlined className="text-blue-400" />
                              <span>Bình luận riêng cho Bài #{index + 1}:</span>
                              {hasCustomComment && (
                                <Tag color="cyan" className="!text-xs !m-0 !py-0">
                                  Đang dùng cmt riêng
                                </Tag>
                              )}
                            </span>
                            {!hasCustomComment && (
                              <Button
                                size="small"
                                type="link"
                                className="!p-0 text-xs text-slate-400 hover:text-slate-200"
                                onClick={() => toggleCommentBox(item.id)}
                              >
                                Đóng ô
                              </Button>
                            )}
                          </div>
                          <TextArea
                            placeholder="Nhập nội dung bình luận / link Shopee riêng cho bài này (hỗ trợ xuống dòng, emoji, link)... Nếu để trống sẽ tự động dùng bình luận chung bên dưới."
                            autoSize={{ minRows: 2, maxRows: 4 }}
                            value={item.affiliateLink || ''}
                            onChange={(e) => updateLinkAffiliate(item.id, e.target.value)}
                            className="text-xs bg-slate-900/90 border-slate-700 text-slate-100 rounded-lg"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Khi chưa cào xong hoặc không có link preview thì hiển thị Time Picker & Options ở dưới ô URL */}
            {(!item.url.trim() || !preview || preview?.loading || preview?.error) && (
              <>

                <div className="poster-post-options !p-2.5 sm:!p-3 bg-slate-950/60 rounded-2xl border border-slate-700/60 flex items-center gap-2 flex-wrap shadow-inner backdrop-blur-sm">
                  <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5 mr-1 select-none">
                    <SettingOutlined className="text-slate-400 text-xs" /> Tùy chọn:
                  </span>

                  <Tooltip title="Đăng status phông nền màu đỏ (tối đa 130 ký tự). Dán link xong sẽ hiện khung chọn Thuần chữ / Kèm ảnh và xem trước.">
                    <button
                      type="button"
                      onClick={() => toggleColorBackground(item.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none ${item.colorBackground
                          ? 'poster-opt-chip is-active'
                          : 'poster-opt-chip'
                        }`}
                    >
                      <span className="poster-opt-dot" /><span>Status nền đỏ</span>
                      <span className="text-xs opacity-80">(&lt; 130 ký tự)</span>
                      {item.colorBackground && <CheckOutlined className="text-xs text-rose-400" />}
                    </button>
                  </Tooltip>

                  <Tooltip title="Tự động ghi nguồn tác giả bài viết ở cuối nội dung">
                    <button
                      type="button"
                      onClick={() => toggleIncludeCredit(item.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none ${item.includeCredit !== false
                          ? 'poster-opt-chip is-active'
                          : 'poster-opt-chip'
                        }`}
                    >
                      <UserOutlined className="text-xs text-blue-400" />
                      <span>Ghi nguồn tác giả</span>
                      {item.includeCredit !== false && <CheckOutlined className="text-xs text-blue-400" />}
                    </button>
                  </Tooltip>

                  <Tooltip title={item.skipComment ? 'Bình luận đang bị tắt cho bài này' : (hasCustomComment ? 'Đã có bình luận riêng cho bài này' : 'Thêm bình luận / link Shopee riêng cho bài này')}>
                    <button
                      type="button"
                      onClick={() => toggleCommentBox(item.id)}
                      disabled={item.skipComment}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none disabled:opacity-40 disabled:cursor-not-allowed ${hasCustomComment || isCommentOpen
                          ? 'poster-opt-chip is-active'
                          : 'poster-opt-chip'
                        }`}
                    >
                      <MessageOutlined className="text-xs text-cyan-400" />
                      <span>{hasCustomComment ? 'Có bình luận riêng' : 'Thêm bình luận riêng'}</span>
                      {(hasCustomComment || isCommentOpen) && <CheckOutlined className="text-xs text-cyan-400" />}
                    </button>
                  </Tooltip>

                  <Tooltip title="Không đăng bất kỳ bình luận nào (kể cả cmt mặc định) cho riêng bài này">
                    <button
                      type="button"
                      onClick={() => toggleSkipComment(item.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none ${item.skipComment
                          ? 'poster-opt-chip is-active'
                          : 'poster-opt-chip'
                        }`}
                    >
                      <StopOutlined className="text-xs text-amber-400" />
                      <span>Không bình luận</span>
                      {item.skipComment && <CheckOutlined className="text-xs text-amber-400" />}
                    </button>
                  </Tooltip>

                  {postMode !== 'FANPAGE_ONLY' && (
                    <Tooltip title="Mặc định KHÔNG bình luận vào bài đăng trong Nhóm — bật tùy chọn này mới tự động bình luận link Affiliate cho bài này trong Nhóm.">
                      <button
                        type="button"
                        onClick={() => toggleGroupComment(item.id)}
                        disabled={item.skipComment}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 select-none disabled:opacity-40 disabled:cursor-not-allowed ${item.groupCommentEnabled
                            ? 'poster-opt-chip is-active'
                            : 'poster-opt-chip'
                          }`}
                      >
                        <TeamOutlined className="text-xs text-emerald-400" />
                        <span>Bình luận trong Nhóm</span>
                        {item.groupCommentEnabled && <CheckOutlined className="text-xs text-emerald-400" />}
                      </button>
                    </Tooltip>
                  )}
                </div>

                {/* KHUNG SOẠN BÌNH LUẬN RIÊNG CHO TỪNG BÀI */}
                {isCommentOpen && (
                  <div className="p-3.5 bg-slate-900/90 border border-slate-700/80 rounded-xl space-y-2 shadow-inner">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <MessageOutlined className="text-blue-400" />
                        <span>Bình luận riêng cho Bài #{index + 1}:</span>
                        {hasCustomComment && (
                          <Tag color="cyan" className="!text-[10px] !m-0 !py-0">
                            Đang dùng cmt riêng
                          </Tag>
                        )}
                      </span>
                      {!hasCustomComment && (
                        <Button
                          size="small"
                          type="link"
                          className="!p-0 text-xs text-slate-400 hover:text-slate-300"
                          onClick={() => toggleCommentBox(item.id)}
                        >
                          Đóng ô
                        </Button>
                      )}
                    </div>
                    <TextArea
                      placeholder="Nhập nội dung bình luận / link Shopee riêng cho bài này (hỗ trợ xuống dòng, emoji, link)... Nếu để trống sẽ tự động dùng bình luận chung bên dưới."
                      autoSize={{ minRows: 2, maxRows: 5 }}
                      value={item.affiliateLink || ''}
                      onChange={(e) => updateLinkAffiliate(item.id, e.target.value)}
                      className="text-xs bg-slate-950/80 text-slate-100 border-slate-700 placeholder:text-slate-500 rounded-lg"
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* Đăng thêm bài này sang các nhóm chỉ định khác (đồng bộ với Tinder Review) */}
        {extraGroupOptions.length > 0 && (
          <div className="mt-2 pt-2.5 border-t border-slate-800/70 flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5 shrink-0">
              <TeamOutlined className="text-indigo-400" />
              <span>Đăng thêm sang nhóm khác:</span>
              {itemExtraGroupIds.length > 0 && (
                <Tag color="geekblue" className="!m-0 !rounded-md !text-[11px] font-bold">
                  +{itemExtraGroupIds.length} nhóm
                </Tag>
              )}
            </span>
            <Select
              mode="multiple"
              size="small"
              allowClear
              showSearch
              placeholder="Chọn thêm nhóm đăng chéo riêng bài này (nếu có)..."
              value={itemExtraGroupIds}
              onChange={(vals: string[]) => updateLinkExtraGroupIds(item.id, vals)}
              options={extraGroupOptions}
              optionLabelProp="name"
              filterOption={filterSelectByLabel}
              maxTagCount="responsive"
              className="flex-1 min-w-0"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(PostItemEditor);
