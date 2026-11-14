import type React from 'react';
import {
  Button,
  Card,
  Input,
  Select,
  Tag,
  Tooltip,
  DatePicker,
  TimePicker,
  Segmented,
  Badge,
  App,
} from 'antd';
import {
  LinkOutlined,
  TableOutlined,
  CheckCircleOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  CopyOutlined,
  ScheduleOutlined,
  RocketOutlined,
  MessageOutlined,
  StopOutlined,
  TeamOutlined,
  EditOutlined,
  ClearOutlined,
  FireOutlined,
  ThunderboltFilled,
  FileTextOutlined,
  ShareAltOutlined,
  TagOutlined,
  EyeFilled,
  DisconnectOutlined,
  UserOutlined,
  SyncOutlined,
  SafetyCertificateOutlined,
  AimOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import PostItemEditor from './PostItemEditor';
import type { SocialAccount, PostLinkItem, ItemPreview, PostMode } from './types';

const { Option } = Select;

interface ComposeContentSectionProps {
  postMode: PostMode;
  previews: Record<string, ItemPreview>;
  setDistributeModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedDistributePages: string[];
  setSelectedDistributePages: React.Dispatch<React.SetStateAction<string[]>>;
  draggedMedia: { itemId: string; index: number; };
  dragOverMedia: { itemId: string; index: number; };
  linkItems: PostLinkItem[];
  manualMediaUrlInputs: Record<string, string>;
  setShowArticleBatchModal: React.Dispatch<React.SetStateAction<boolean>>;
  swipeReviewItems: PostLinkItem[];
  openSwipeReview: () => void;
  setBatchToolsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  batchToolsOpen: boolean;
  setBulkModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setBulkText: React.Dispatch<React.SetStateAction<string>>;
  bulkText: string;
  smartDispatchSummary: { total: number; nickCounts: Record<string, number> } | null;
  setHunterDrawerVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setGroupHunterDrawerVisible: React.Dispatch<React.SetStateAction<boolean>>;
  validLinkCount: number;
  playwrightAccounts: SocialAccount[];
  postingIdentities: SocialAccount[];
  accountTargetValue: (account: SocialAccount) => string;
  viaNameOf: (account: SocialAccount) => string;
  watchedTargetFanpageId: any;
  defaultCommentPreview: any;
  previewAuthorName: string;
  isMultiDistributeActive: boolean;
  distributionStrategy: "ROUND_ROBIN" | "DAILY_QUOTA" | "STAGGERED";
  staggerIntervalMinutes: number;
  setCustomItemTargets: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  customItemTargets: Record<string, string>;
  groupDistributionMode: "PAGE_PER_GROUP" | "ROUND_ROBIN_POSTS" | "CROSS_ALL";
  activeSelectedFanpageIds: string[];
  twoMainViasDisplayNames: string;
  effectiveMultiTargets: string[];
  isMatrixDistributionVisible: boolean;
  calculatedDistribution: Record<string, { targetValue: string; accountName: string; scheduledAt: Dayjs; }>;
  bulkPasteSummary: { detectedUrls: string[]; uniqueUrls: string[]; finalUrls: string[]; historyMatchedUrls: string[]; invalidLineCount: number; duplicateInInputCount: number; duplicateInHistoryCount: number; };
  addLinkItem: () => void;
  applyEnableAllCredit: () => void;
  applyDisableAllCredit: () => void;
  applyAnonymousCreditToAll: () => void;
  applyOriginalAuthorCreditToAll: () => void;
  openCustomCreModal: (targetItemId?: string) => void;
  openHashtagModal: (targetItemId?: string) => void;
  resetEqualDistribution: () => void;
  handleSmartDispatch: (customNicks?: string[], customInterval?: number) => void;
  dragOverDropzone: string;
  applyDisableAllComments: () => void;
  applyEnableAllComments: () => void;
  applyEnableAllGroupComments: () => void;
  applyDisableAllGroupComments: () => void;
  handleApplyBulkPaste: () => void;
  postItemTargetOptions: { value: string; label: string; }[];
  groupAccountsWithId?: SocialAccount[];
  primaryGroupIds?: string[];
  postItemActions: { openNewsCardForItem: (item: PostLinkItem, mode: "LINK" | "MANUAL") => void; isMediaVideo: (url: string, kind?: string) => boolean; setMediaViewer: React.Dispatch<React.SetStateAction<{ url: string; kind: "image" | "video"; title?: string; }>>; handleMediaDragStart: (e: React.DragEvent<Element>, itemId: string, index: number) => void; handleMediaDragOver: (e: React.DragEvent<Element>, itemId: string, index: number) => void; handleMediaDragEnd: () => void; handleMediaDrop: (e: React.DragEvent<Element>, itemId: string, dropIndex: number) => void; moveMediaItem: (itemId: string, fromIdx: number, toIdx: number) => void; removeMediaItem: (itemId: string, idxToRemove: number) => void; handlePreviewLink: (item: PostLinkItem) => Promise<void>; setLinkItems: React.Dispatch<React.SetStateAction<PostLinkItem[]>>; setManualMediaUrlInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>; accountTargetValue: (account: SocialAccount) => string; setCustomItemTargets: React.Dispatch<React.SetStateAction<Record<string, string>>>; updateLinkUrl: (id: string, url: string) => void; updateLinkAffiliate: (id: string, affiliateLink: string) => void; updateLinkCustomCaption: (id: string, customCaption: string) => void; updateLinkInputType: (id: string, inputType: "LINK" | "MANUAL") => void; updateLinkManualContent: (id: string, manualContent: string) => void; handleUploadMedia: (itemId: string, files: FileList | File[]) => Promise<void>; handlePasteMediaFromClipboard: (itemId: string, e: React.ClipboardEvent<Element>) => Promise<void>; handlePasteFromClipboardButton: (itemId: string) => Promise<void>; handleAddManualMediaUrl: (itemId: string, rawUrl: string) => void; moveManualMediaItem: (itemId: string, fromIdx: number, toIdx: number) => void; removeManualMediaItem: (itemId: string, index: number) => void; toggleCommentBox: (id: string) => void; toggleIncludeCredit: (id: string) => void; toggleColorBackground: (id: string, specificMode?: boolean | "RED_PHOTO_TRICK") => void; replaceOrAppendCreditText: (caption: string, creditText: string) => string; applyAnonymousCreditToAll: () => void; toUnicodeBold: (text: string) => string; toUnicodeSerifBold: (text: string) => string; toUnicodeItalic: (text: string) => string; toUnicodeBoldItalic: (text: string) => string; toUnicodeStrikethrough: (text: string) => string; toUnicodeUnderline: (text: string) => string; toUnicodeBoxedTag: (text: string) => string; toUnicodeHeading1: (text: string) => string; toUnicodeHeading2: (text: string) => string; applyTransformToSelection: (id: string, transformFn: (text: string) => string, successMsg?: string) => void; insertSnippetAtCursor: (id: string, snippet: string) => void; setDragOverDropzone: React.Dispatch<React.SetStateAction<string>>; toggleSkipComment: (id: string) => void; toggleGroupComment: (id: string) => void; updateLinkMode: (id: string, isNow: boolean) => void; updateLinkTime: (id: string, time: Dayjs) => void; removeLinkItem: (id: string) => void; updateLinkExtraGroupIds: (id: string, groupIds: string[]) => void; };
}

// Bước "Thêm nội dung": nguồn bài, danh sách bài và lịch đăng — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
export default function ComposeContentSection({
  postMode,
  previews,
  setDistributeModalOpen,
  selectedDistributePages,
  setSelectedDistributePages,
  draggedMedia,
  dragOverMedia,
  linkItems,
  manualMediaUrlInputs,
  setShowArticleBatchModal,
  swipeReviewItems,
  openSwipeReview,
  setBatchToolsOpen,
  batchToolsOpen,
  setBulkModalVisible,
  setBulkText,
  bulkText,
  smartDispatchSummary,
  setHunterDrawerVisible,
  setGroupHunterDrawerVisible,
  validLinkCount,
  playwrightAccounts,
  postingIdentities,
  accountTargetValue,
  viaNameOf,
  watchedTargetFanpageId,
  defaultCommentPreview,
  previewAuthorName,
  isMultiDistributeActive,
  distributionStrategy,
  staggerIntervalMinutes,
  setCustomItemTargets,
  customItemTargets,
  groupDistributionMode,
  activeSelectedFanpageIds,
  twoMainViasDisplayNames,
  effectiveMultiTargets,
  isMatrixDistributionVisible,
  calculatedDistribution,
  bulkPasteSummary,
  addLinkItem,
  applyEnableAllCredit,
  applyDisableAllCredit,
  applyAnonymousCreditToAll,
  applyOriginalAuthorCreditToAll,
  openCustomCreModal,
  openHashtagModal,
  resetEqualDistribution,
  handleSmartDispatch,
  dragOverDropzone,
  applyDisableAllComments,
  applyEnableAllComments,
  applyEnableAllGroupComments,
  applyDisableAllGroupComments,
  handleApplyBulkPaste,
  postItemTargetOptions,
  groupAccountsWithId = [],
  primaryGroupIds = [],
  postItemActions,
}: ComposeContentSectionProps) {
  const { message } = App.useApp();
  return (
    <section id="poster-step-3" className="poster-form-section">
      <div className="poster-section-head-row">
        <div className="poster-section-heading">
          <span className="poster-step-number">3</span>
          <div>
            <h2 className="flex items-center gap-2 flex-wrap">
              <span>Thêm nội dung</span>
              {validLinkCount > 0 && (
                <Tag color="blue" className="!rounded-full !font-bold !text-xs !m-0">
                  {validLinkCount} bài đã thêm
                </Tag>
              )}
            </h2>
            <p>Dán liên kết nguồn (TikTok, Threads, FB), cào báo AI, hoặc soạn bài thủ công kèm ảnh/video.</p>
          </div>
        </div>
        <Button
          type="primary"
          size="middle"
          icon={<PlusOutlined />}
          onClick={addLinkItem}
          className="rounded-xl font-semibold shrink-0"
        >
          Thêm bài thủ công
        </Button>
      </div>

      {/* DÁN LINK HÀNG LOẠT — gọn: tiêu đề, ô dán, 1 hàng nút. Bảng chi tiết là nút chính. */}
      <div className="bulk-paste-simple">
        <div className="bulk-paste-simple-head">
          <div>
            <div className="bulk-paste-simple-title">Dán link hàng loạt</div>
            <div className="bulk-paste-simple-sub">Mỗi dòng 1 link Facebook, Threads, TikTok, Reels/Shorts, Reddit. Tự lấy caption và ảnh/video.</div>
          </div>
          {bulkText && (
            <button type="button" className="bulk-paste-simple-clear" onClick={() => setBulkText('')}>
              <ClearOutlined /> Xóa
            </button>
          )}
        </div>

        <textarea
          rows={5}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={'Dán danh sách link vào đây, mỗi dòng 1 link\nhttps://www.facebook.com/...\nhttps://www.threads.net/...\nhttps://www.tiktok.com/@user/video/...'}
          className="bulk-paste-simple-input"
        />

        <div className="bulk-paste-simple-foot">
          <div className="bulk-paste-simple-status">
            {bulkPasteSummary.finalUrls.length > 0 ? (
              <>
                <span className="is-ok"><CheckCircleOutlined /> {bulkPasteSummary.finalUrls.length} link hợp lệ</span>
                {bulkPasteSummary.duplicateInHistoryCount > 0 && (
                  <span className="is-warn">{bulkPasteSummary.duplicateInHistoryCount} link đã từng đăng</span>
                )}
                {bulkPasteSummary.invalidLineCount > 0 && (
                  <span>{bulkPasteSummary.invalidLineCount} dòng không phải link</span>
                )}
              </>
            ) : (
              <span>Chưa có link nào</span>
            )}
          </div>

          <div className="bulk-paste-simple-actions">
            <Button
              size="large"
              icon={<CopyOutlined />}
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (text && text.trim()) {
                    setBulkText((prev) => (prev ? prev + '\n' + text.trim() : text.trim()));
                    message.success('Đã dán link từ Clipboard');
                  } else {
                    message.info('Bộ nhớ tạm đang trống');
                  }
                } catch {
                  message.warning('Trình duyệt chặn đọc clipboard, hãy bấm Ctrl+V vào ô trên');
                }
              }}
            >
              Dán từ Clipboard
            </Button>
            {bulkPasteSummary.finalUrls.length > 0 && (
              <Button
                size="large"
                icon={<RocketOutlined />}
                onClick={() => {
                  handleApplyBulkPaste();
                  setBulkText('');
                }}
              >
                Nạp nhanh {bulkPasteSummary.finalUrls.length} bài
              </Button>
            )}
            <Button
              type="primary"
              size="large"
              icon={<TableOutlined />}
              onClick={() => setBulkModalVisible(true)}
              className="bulk-paste-simple-primary"
            >
              {bulkPasteSummary.finalUrls.length > 0
                ? `Mở bảng chi tiết (${bulkPasteSummary.finalUrls.length})`
                : 'Mở bảng chi tiết'}
            </Button>
          </div>
        </div>
      </div>

      {/* CÁC NGUỒN CÀO BÀI KHÁC - QUICK IMPORT TOOLBAR */}
      <div className="quick-sources-toolbar">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mr-1">
          <ThunderboltOutlined className="text-sky-400" />
          Nguồn cào khác:
        </span>
        <button
          type="button"
          onClick={() => setShowArticleBatchModal(true)}
          className="quick-source-chip quick-source-chip-news"
        >
          <FileTextOutlined className="text-emerald-400 text-sm" />
          <span>Cào báo & tin tức</span>
        </button>
        <button
          type="button"
          onClick={() => setGroupHunterDrawerVisible(true)}
          className="quick-source-chip quick-source-chip-group"
        >
          <TeamOutlined className="text-purple-400 text-sm" />
          <span>Quét bài Group FB</span>
        </button>
        <button
          type="button"
          onClick={() => setHunterDrawerVisible(true)}
          className="quick-source-chip quick-source-chip-tiktok"
        >
          <FireOutlined className="text-amber-400 text-sm" />
          <span>Săn kênh TikTok</span>
        </button>
      </div>

      {/* Bảng Ma Trận Phân Bổ Đa Kênh Xem Trước */}
      {isMatrixDistributionVisible && effectiveMultiTargets.length > 0 && validLinkCount > 0 && (
        <div className="mb-5 p-4 rounded-xl border border-cyan-800/60 bg-gradient-to-br from-slate-900/90 to-blue-950/40 shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-700/60">
            <div className="flex items-center gap-2">
              <ThunderboltFilled className="text-amber-400 text-base" />
              <span className="font-bold text-sm text-slate-100">
                Ma trận phân bổ: {validLinkCount} bài viết → {effectiveMultiTargets.length} kênh đích
              </span>
            </div>
            <Tag color="cyan" className="!rounded-full font-bold text-xs self-start sm:self-auto">
              {postMode === 'FANPAGE_ONLY' ? (
                <span className="inline-flex items-center gap-1">
                  {distributionStrategy === 'ROUND_ROBIN' && <><SyncOutlined /> Xoay vòng đều (Round-Robin)</>}
                  {distributionStrategy === 'DAILY_QUOTA' && <><AimOutlined /> Cân bằng theo chỉ tiêu ngày</>}
                  {distributionStrategy === 'STAGGERED' && <><ScheduleOutlined /> So le giờ (+{staggerIntervalMinutes}p/kênh)</>}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  {groupDistributionMode === 'ROUND_ROBIN_POSTS' && <><SyncOutlined /> Xoay vòng đều Page qua các bài</>}
                  {groupDistributionMode === 'PAGE_PER_GROUP' && <><SafetyCertificateOutlined /> Phân bổ Page theo Nhóm</>}
                  {groupDistributionMode === 'CROSS_ALL' && <><ThunderboltOutlined /> Tất cả Page × Tất cả Nhóm</>}
                </span>
              )}
            </Tag>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-700/80 text-slate-400 font-semibold">
                  <th className="py-2 px-2 w-12 text-center">#</th>
                  <th className="py-2 px-2">Bài viết / Link nguồn</th>
                  <th className="py-2 px-2 w-64">Kênh xuất bản được chia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {linkItems.filter((i) => i.url.trim().length > 0).map((item, idx) => {
                  const dist = calculatedDistribution[item.id];
                  const currentTarget = (dist?.targetValue && effectiveMultiTargets.includes(dist.targetValue))
                    ? dist.targetValue
                    : effectiveMultiTargets[idx % effectiveMultiTargets.length];

                  return (
                    <tr key={item.id} className="hover:bg-slate-800/30">
                      <td className="py-2 px-2 text-center font-bold text-blue-400">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-2 max-w-xs truncate font-mono text-slate-300">
                        {previews[item.id]?.caption ? (
                          <span className="font-sans font-medium text-slate-200">
                            {previews[item.id].caption!.substring(0, 55)}...
                          </span>
                        ) : (
                          <span className="truncate">{item.url}</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <Select
                          size="small"
                          value={currentTarget}
                          onChange={(newTarget) => {
                            setCustomItemTargets((prev) => ({
                              ...prev,
                              [item.id]: newTarget,
                            }));
                          }}
                          className="w-full text-xs"
                        >
                          {effectiveMultiTargets.map((tVal) => {
                            const acc = postingIdentities.find((a) => accountTargetValue(a) === tVal || a.platformAccountId === tVal || String(a.id) === tVal);
                            const isPersonal = acc?.platformAccountId === 'PERSONAL_PROFILE' || acc?.platform === 'FACEBOOK_PERSONAL';
                            const viaName = acc ? viaNameOf(acc) : '';
                            return (
                              <Option key={tVal} value={tVal}>
                                <span className="truncate">
                                  {isPersonal ? '👤 ' : '📄 '}{acc?.pageName || acc?.platformAccountId || tVal}{viaName ? ` · ${viaName}` : ''}
                                </span>
                              </Option>
                            );
                          })}
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Công cụ dùng ít hơn được thu gọn, tránh chiếm toàn bộ vùng nhìn đầu tiên. */}
      <div className="mb-4 rounded-xl border border-slate-700/60 bg-slate-800/40 overflow-hidden backdrop-blur-sm shadow-sm">
        <button
          type="button"
          className="w-full flex items-center gap-2.5 p-3.5 text-left hover:bg-slate-700/30 transition-colors"
          onClick={() => setBatchToolsOpen((open) => !open)}
          aria-expanded={batchToolsOpen}
        >
          <div className="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center font-bold text-sm shrink-0 border border-blue-500/25">
            <ThunderboltOutlined />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-100">Thao tác hàng loạt</div>
            <div className="text-[13px] text-slate-300">Credit, hashtag, bình luận cho toàn bộ danh sách. Giờ đăng chọn ở nút Đăng.</div>
          </div>
          <span className="text-xs font-semibold text-blue-300 shrink-0 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20">{batchToolsOpen ? 'Thu gọn' : 'Mở công cụ'}</span>
        </button>

        {batchToolsOpen && <div className="border-t border-slate-700/60 bg-slate-900/60 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wide shrink-0">
              Tùy chọn hàng loạt:
            </span>
            <Tooltip title="Tự động đính kèm link nguồn bài viết gốc cho TẤT CẢ bài trong danh sách">
              <Button
                size="middle"
                icon={<LinkOutlined />}
                onClick={applyEnableAllCredit}
                className="rounded-lg text-xs font-bold bg-blue-600/20 text-blue-300 border-blue-500/40 hover:bg-blue-600/30"
              >
                Kèm link toàn bộ
              </Button>
            </Tooltip>
            <Tooltip title="Tự động chèn dòng 'Cre: Member ẩn danh' vào cuối caption cho TẤT CẢ bài viết">
              <Button
                size="middle"
                icon={<UserOutlined />}
                onClick={applyAnonymousCreditToAll}
                className="rounded-lg text-xs font-bold bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30"
              >
                Cre: Member ẩn danh toàn bộ
              </Button>
            </Tooltip>
            <Tooltip title="Tự động lấy Tên người đăng gốc (hoặc Member ẩn danh nếu ẩn danh) chèn vào ô Caption cho TẤT CẢ bài viết">
              <Button
                size="middle"
                icon={<UserOutlined />}
                onClick={applyOriginalAuthorCreditToAll}
                className="rounded-lg text-xs font-bold bg-cyan-500/20 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/30"
              >
                Cre: Tác giả gốc toàn bộ
              </Button>
            </Tooltip>
            <Tooltip title="Tự động chèn dòng 'Cre: [Nội dung tùy chỉnh]' vào cuối caption cho TẤT CẢ bài viết">
              <Button
                size="middle"
                icon={<EditOutlined />}
                onClick={() => openCustomCreModal(null)}
                className="rounded-lg text-xs font-bold bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30"
              >
                Cre Custom toàn bộ
              </Button>
            </Tooltip>
            <Tooltip title="Tự động chèn Hashtag (VD: #Trending #Review...) vào ô caption cho TẤT CẢ bài viết">
              <Button
                size="middle"
                icon={<TagOutlined />}
                onClick={() => openHashtagModal(null)}
                className="rounded-lg text-xs font-bold bg-pink-500/20 text-pink-300 border-pink-500/40 hover:bg-pink-500/30"
              >
                Hashtag toàn bộ
              </Button>
            </Tooltip>
            <Tooltip title="Không đính kèm link bài viết gốc / Nguồn tác giả cho TẤT CẢ bài trong danh sách">
              <Button
                size="middle"
                icon={<DisconnectOutlined />}
                onClick={applyDisableAllCredit}
                className="rounded-lg text-xs font-bold border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Không link toàn bộ
              </Button>
            </Tooltip>
            <span className="text-slate-600 font-bold">|</span>
            <Tooltip title="Tắt bình luận tự động (kể cả cmt mặc định) cho TẤT CẢ bài trong danh sách, không cần tick từng dòng">
              <Button
                danger
                size="middle"
                icon={<StopOutlined />}
                onClick={applyDisableAllComments}
                className="rounded-lg text-xs font-bold"
              >
                Tắt cmt tất cả
              </Button>
            </Tooltip>
            <Tooltip title="Bật lại bình luận tự động cho TẤT CẢ bài trong danh sách">
              <Button
                size="middle"
                icon={<MessageOutlined />}
                onClick={applyEnableAllComments}
                className="rounded-lg text-xs font-bold border-slate-700 text-slate-200 hover:bg-slate-800"
              >
                Bật cmt tất cả
              </Button>
            </Tooltip>
            {postMode !== 'FANPAGE_ONLY' && (
              <>
                <span className="text-slate-600 font-bold">|</span>
                <Tooltip title="Tắt bình luận trong Nhóm cho TẤT CẢ bài trong danh sách">
                  <Button
                    size="middle"
                    icon={<StopOutlined />}
                    onClick={applyDisableAllGroupComments}
                    className="rounded-lg text-xs font-bold border-slate-700 text-slate-300 hover:bg-slate-800"
                  >
                    Tắt cmt Nhóm tất cả
                  </Button>
                </Tooltip>
              </>
            )}
          </div>
        </div>}
      </div>
      {/* ── BỘ CHIA BÀI & HẸN GIỜ THÔNG MINH (SMART DISPATCH 1-CLICK) ── */}
      {validLinkCount > 0 && (
        <div className="mb-4 p-4 rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950/40 to-slate-900 border border-blue-500/40 shadow-xl backdrop-blur-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-base shadow-md shrink-0">
                <ThunderboltFilled />
              </div>
              <div>
                <div className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
                  <span>Chia bài cho các nick</span>
                </div>
                <div className="text-xs text-slate-400">
                  Chia vòng tròn cho các nick. Giờ đăng do Lịch đăng chung xếp, mỗi nick một làn.
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center">
              <Button
                type="primary"
                icon={<ThunderboltFilled />}
                onClick={() => handleSmartDispatch()}
                className="bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 font-bold text-xs h-9 px-4 rounded-xl shadow-md border-0"
              >
                {activeSelectedFanpageIds.length > 0 ? (
                  <span>
                    Phân bổ theo {activeSelectedFanpageIds.map((v) => {
                      const acc = postingIdentities.find((a) => accountTargetValue(a) === v);
                      return acc ? (acc.pageName || acc.platformAccountId).replace(/^👤\s*Nick Cá Nhân\s*\((.*)\)$/, '$1') : v;
                    }).join(', ')}
                  </span>
                ) : (
                  <span>Chia đều các Via chính ({twoMainViasDisplayNames || 'Các Via đã kết nối'})</span>
                )}
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
            <div className="flex items-center gap-2">
              <Button
                size="small"
                icon={<ShareAltOutlined />}
                onClick={() => {
                  if (selectedDistributePages.length === 0) {
                    setSelectedDistributePages(postingIdentities.slice(0, 4).map(accountTargetValue));
                  }
                  setDistributeModalOpen(true);
                }}
                className="text-xs bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
              >
                Chọn Nick/Page khác...
              </Button>
              {Object.keys(customItemTargets).length > 0 && (
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<CloseOutlined />}
                  onClick={resetEqualDistribution}
                  className="text-xs text-rose-400 hover:text-rose-300"
                >
                  Xóa phân bổ ({Object.keys(customItemTargets).length})
                </Button>
              )}
            </div>
          </div>

          {smartDispatchSummary && (
            <div className="mt-2.5 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-emerald-200">
              <div className="flex items-center gap-2">
                <CheckCircleOutlined className="text-emerald-400" />
                <span>
                  Đã chia đều <b>{smartDispatchSummary.total}</b> bài: {Object.entries(smartDispatchSummary.nickCounts).map(([name, c]) => `${name} (${c} bài)`).join(' · ')}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Thanh thao tác nhanh hàng loạt nổi bật ngay trên danh sách bài viết (chỉ hiện khi đã có link hợp lệ) */}
      {validLinkCount > 0 && (
        <div className="poster-bulk-credit mb-4 p-3 sm:p-3.5 bg-slate-900/90 rounded-2xl border border-slate-700/80 flex flex-wrap items-center justify-between gap-3 shadow-lg backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center font-bold text-sm border border-blue-500/25 shrink-0">
              <ThunderboltOutlined />
            </div>
            <div>
              <div className="text-[13px] font-bold text-slate-100 flex items-center gap-2">
                <span>Thao tác nhanh cho {linkItems.length} bài viết:</span>
              </div>
              <div className="text-xs text-slate-300">Áp dụng bình luận, chèn Cre hoặc chia đều Page cho toàn bộ danh sách</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip title="Tắt bình luận tự động (tick 'Không bình luận') cho TẤT CẢ các bài viết trong danh sách">
              <Button
                type="primary"
                icon={<StopOutlined />}
                onClick={applyDisableAllComments}
                className="poster-quickcre-btn text-slate-200 font-semibold text-xs rounded-xl h-9 px-3 border-none shadow-sm"
              >
                Không bình luận
              </Button>
            </Tooltip>
            {postMode !== 'FANPAGE_ONLY' && (
              <Tooltip title="Bật Bình luận trong Nhóm cho TẤT CẢ bài viết trong danh sách">
                <Button
                  type="primary"
                  icon={<MessageOutlined />}
                  onClick={applyEnableAllGroupComments}
                  className="poster-quickcre-btn text-slate-200 font-semibold text-xs rounded-xl h-9 px-3 border-none shadow-sm"
                >
                  Bật cmt Nhóm
                </Button>
              </Tooltip>
            )}
            <Tooltip title="Chèn 'Cre: Member ẩn danh' vào ô caption cho TẤT CẢ các bài viết trong danh sách">
              <Button
                type="primary"
                icon={<UserOutlined />}
                onClick={applyAnonymousCreditToAll}
                className="poster-quickcre-btn text-slate-200 font-semibold text-xs rounded-xl h-9 px-3 border-none shadow-sm"
              >
                Cre: Member ẩn danh
              </Button>
            </Tooltip>
            <Tooltip title="Chèn Tên tác giả gốc (hoặc Member ẩn danh nếu bài ẩn danh) vào ô caption cho TẤT CẢ bài viết">
              <Button
                type="primary"
                icon={<UserOutlined />}
                onClick={applyOriginalAuthorCreditToAll}
                className="poster-quickcre-btn text-slate-200 font-semibold text-xs rounded-xl h-9 px-3 border-none shadow-sm"
              >
                Cre: Tác giả gốc
              </Button>
            </Tooltip>
            <Tooltip title="Nhập nội dung tùy chỉnh để chèn 'Cre: [Nội dung]' vào ô caption cho TẤT CẢ bài viết">
              <Button
                type="primary"
                icon={<EditOutlined />}
                onClick={() => openCustomCreModal(null)}
                className="poster-quickcre-btn text-slate-200 font-semibold text-xs rounded-xl h-9 px-3 border-none shadow-sm"
              >
                Cre Custom
              </Button>
            </Tooltip>
            <Tooltip title="Nhập danh sách Hashtag để chèn tự động vào ô caption cho TẤT CẢ bài viết trong danh sách">
              <Button
                type="primary"
                icon={<TagOutlined />}
                onClick={() => openHashtagModal(null)}
                className="poster-quickcre-btn text-slate-200 font-semibold text-xs rounded-xl h-9 px-3 border-none shadow-sm"
              >
                Hashtag
              </Button>
            </Tooltip>
            <Tooltip title={`Tự động chia đều ${linkItems.length} bài viết cho các Fanpage / Nick cá nhân đã chọn theo tỉ lệ tròn đều`}>
              <Button
                type="primary"
                icon={<ShareAltOutlined />}
                onClick={() => {
                  if (selectedDistributePages.length === 0) {
                    setSelectedDistributePages(postingIdentities.slice(0, 4).map(accountTargetValue));
                  }
                  setDistributeModalOpen(true);
                }}
                className="poster-quickcre-btn text-slate-200 font-semibold text-xs rounded-xl h-9 px-3 border-none shadow-sm"
              >
                Chia đều Page ({linkItems.length})
              </Button>
            </Tooltip>
            {Object.keys(customItemTargets).length > 0 && (
              <Tooltip title="Hủy bỏ cấu hình chia riêng cho từng bài, quay lại dùng Fanpage mặc định đã chọn ở trên">
                <Button
                  type="dashed"
                  danger
                  icon={<ClearOutlined />}
                  onClick={resetEqualDistribution}
                  className="text-xs font-semibold rounded-xl h-9 px-3 border-rose-500/50 text-rose-300 hover:text-rose-200"
                >
                  Xóa chia đều ({Object.keys(customItemTargets).length})
                </Button>
              </Tooltip>
            )}
          </div>
        </div>
      )}

      {/* Mỗi bài là một tác vụ độc lập; không dùng khung cuộn lồng nhau. */}
      <div className="poster-post-list space-y-3.5">
        {swipeReviewItems.length > 0 && (
          <div className="poster-swipe-launcher">
            <div>
              <span className="poster-swipe-launcher-icon"><EyeFilled /></span>
              <span>
                <strong>Duyệt nhanh từng bài</strong>
                <small>Xem toàn bộ ảnh/video và caption, sau đó chọn giữ hoặc bỏ.</small>
              </span>
            </div>
            <Button type="primary" icon={<ThunderboltOutlined />} onClick={openSwipeReview}>
              Duyệt kiểu Tinder · {swipeReviewItems.length} bài
            </Button>
          </div>
        )}
        {linkItems.map((item, index) => (
          <PostItemEditor
            key={item.id}
            item={item}
            index={index}
            isOnlyItem={linkItems.length <= 1}
            preview={previews[item.id]}
            manualMediaUrlInput={manualMediaUrlInputs[item.id]}
            customTarget={customItemTargets[item.id]}
            distributionTargetValue={isMultiDistributeActive ? calculatedDistribution[item.id]?.targetValue : undefined}
            draggedMedia={draggedMedia?.itemId === item.id ? draggedMedia : null}
            dragOverMedia={dragOverMedia?.itemId === item.id ? dragOverMedia : null}
            dragOverDropzone={dragOverDropzone === item.id ? dragOverDropzone : null}
            postMode={postMode}
            postingIdentities={postingIdentities}
            groupAccountsWithId={groupAccountsWithId}
            primaryGroupIds={primaryGroupIds}
            targetOptions={postItemTargetOptions}
            watchedTargetFanpageId={watchedTargetFanpageId}
            defaultCommentPreview={defaultCommentPreview}
            previewAuthorName={previewAuthorName}
            firstAccountPageName={playwrightAccounts?.[0]?.pageName}
            actions={postItemActions}
          />
        ))}
      </div>

      <Button
        type="dashed"
        block
        icon={<PlusOutlined />}
        onClick={addLinkItem}
        className="poster-add-post mt-3.5 min-h-[54px] rounded-xl flex items-center justify-center"
      >
        <span className="font-bold">Thêm bài viết tiếp theo</span>
      </Button>
    </section>
  );
}
