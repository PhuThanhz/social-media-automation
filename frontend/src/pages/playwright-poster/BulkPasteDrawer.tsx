import { memo } from 'react';
import type React from 'react';
import {
  Button,
  Input,
  Select,
  Tag,
  Checkbox,
  Progress,
  DatePicker,
  TimePicker,
  Segmented,
  Drawer,
  Image,
  App,
} from 'antd';
import {
  ClockCircleOutlined,
  CheckCircleOutlined,
  CheckCircleFilled,
  LoadingOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  CopyOutlined,
  RocketOutlined,
  EyeOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { stripEmojiPrefix } from './shared';
import ScheduleChoice from '../../components/common/ScheduleChoice';
import type { ScheduleValue } from '../../components/common/postingSchedule';
import type { SocialAccount, PostQueue } from './types';

const { TextArea } = Input;

interface BulkPasteDrawerProps {
  bulkDrawerPreviews: Record<string, { loading: boolean; error?: string; caption?: string; author?: string; mediaUrls?: string[]; mediaKinds?: ("video" | "image")[]; originalMediaUrls?: string[]; originalMediaKinds?: ("video" | "image")[]; videoCount?: number; imageCount?: number; affiliateComment?: string; skipComment?: boolean; includeCredit?: boolean; watermarkRemoved?: boolean; }>;
  setBulkDrawerPreviews: React.Dispatch<React.SetStateAction<Record<string, { loading: boolean; error?: string; caption?: string; author?: string; mediaUrls?: string[]; mediaKinds?: ("video" | "image")[]; originalMediaUrls?: string[]; originalMediaKinds?: ("video" | "image")[]; videoCount?: number; imageCount?: number; affiliateComment?: string; skipComment?: boolean; includeCredit?: boolean; watermarkRemoved?: boolean; }>>>;
  isMediaVideo: (url: string, kind?: string) => boolean;
  bulkModalVisible: boolean;
  setBulkModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
  bulkAutoDistributeTwoVias: boolean;
  setBulkAutoDistributeTwoVias: React.Dispatch<React.SetStateAction<boolean>>;
  setBulkText: React.Dispatch<React.SetStateAction<string>>;
  bulkText: string;
  groupAccountsWithId: SocialAccount[];
  twoMainViasDisplayNames: string;
  posts: PostQueue[];
  filterHistoryDuplicates: boolean;
  setFilterHistoryDuplicates: React.Dispatch<React.SetStateAction<boolean>>;
  bulkPasteSummary: { detectedUrls: string[]; uniqueUrls: string[]; finalUrls: string[]; historyMatchedUrls: string[]; invalidLineCount: number; duplicateInInputCount: number; duplicateInHistoryCount: number; };
  currentKpiTarget: { socialAccountId: number; name: any; targetCount: number; actualCount: number; pendingCount: number; totalPending: number; totalPlanned: number; isFullyPublished: boolean; isFullyScheduled: boolean; remainingToSchedule: number; };
  bulkScrapeStats: { total: number; completed: number; loading: number; error: number; isDone: boolean; percent: number; };
  fetchOneDrawerPreview: (url: string) => Promise<void>;
  updateDrawerPreviewCaption: (url: string, caption: string) => void;
  moveDrawerMedia: (url: string, fromIndex: number, toIndex: number) => void;
  removeDrawerMedia: (url: string, index: number) => void;
  resetDrawerMedia: (url: string) => void;
  updateDrawerComment: (url: string, comment: string) => void;
  toggleDrawerSkipComment: (url: string) => void;
  toggleDrawerCredit: (url: string) => void;
  removeUrlFromBulkText: (urlToRemove: string) => void;
  fetchAllDrawerPreviews: () => void;
  handleApplyBulkPaste: () => void;
  handleApplyAndOpenSwipeReview: () => void;
  scheduleChoice: ScheduleValue;
  setScheduleChoice: (v: ScheduleValue) => void;
}

// Drawer "Dán link hàng loạt" — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
function BulkPasteDrawer({
  bulkDrawerPreviews,
  setBulkDrawerPreviews,
  isMediaVideo,
  bulkModalVisible,
  setBulkModalVisible,
  bulkAutoDistributeTwoVias,
  setBulkAutoDistributeTwoVias,
  setBulkText,
  bulkText,
  groupAccountsWithId,
  twoMainViasDisplayNames,
  posts,
  filterHistoryDuplicates,
  setFilterHistoryDuplicates,
  bulkPasteSummary,
  currentKpiTarget,
  bulkScrapeStats,
  fetchOneDrawerPreview,
  updateDrawerPreviewCaption,
  moveDrawerMedia,
  removeDrawerMedia,
  resetDrawerMedia,
  updateDrawerComment,
  toggleDrawerSkipComment,
  toggleDrawerCredit,
  removeUrlFromBulkText,
  fetchAllDrawerPreviews,
  handleApplyBulkPaste,
  handleApplyAndOpenSwipeReview,
  scheduleChoice,
  setScheduleChoice,
}: BulkPasteDrawerProps) {
  const { message } = App.useApp();
  return (
    <Drawer
      rootClassName="bulk-paste-drawer-root"
      title={
        <div className="bulk-paste-title">
          <span className="bulk-paste-title-icon">
            <CopyOutlined />
          </span>
          <div>
            <div className="bulk-paste-title-main">Dán link hàng loạt</div>
            <div className="bulk-paste-title-sub">Mỗi link hợp lệ sẽ trở thành một bài viết riêng</div>
          </div>
        </div>
      }
      placement="right"
      size="large"
      open={bulkModalVisible}
      onClose={() => setBulkModalVisible(false)}
      className="bulk-paste-drawer"
      styles={{
        wrapper: { width: '100vw', maxWidth: '100vw' },
        header: { background: '#0b141f', borderBottom: '1px solid #223247', padding: '14px 22px' },
        body: { background: '#07101a', padding: '18px 22px' },
        footer: { background: '#0b141f', borderTop: '1px solid #223247', padding: '11px 22px' },
      }}
      footer={
        <div className="bulk-paste-footer">
          <Button
            size="large"
            onClick={() => setBulkModalVisible(false)}
            className="bulk-paste-cancel"
          >
            Hủy
          </Button>
          <div className="bulk-paste-footer-primary">
            <span>
              <b>{bulkPasteSummary.finalUrls.length}</b> bài hợp lệ
              {bulkPasteSummary.invalidLineCount > 0 && <small> · {bulkPasteSummary.invalidLineCount} dòng lỗi</small>}
            </span>
            <div className="flex items-center gap-3">
              <Checkbox
                checked={bulkAutoDistributeTwoVias}
                onChange={(e) => setBulkAutoDistributeTwoVias(e.target.checked)}
                className="text-xs font-bold text-purple-300 select-none bg-purple-950/40 px-2.5 py-1.5 rounded-lg border border-purple-500/30"
              >
                ⚡ Chia đều 2 Via ({twoMainViasDisplayNames || 'Song song'})
              </Checkbox>
              <Button
                size="large"
                icon={<ThunderboltOutlined />}
                disabled={bulkPasteSummary.finalUrls.length === 0}
                onClick={handleApplyAndOpenSwipeReview}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold border-none shadow-lg shadow-emerald-950/40 rounded-xl"
                title="Duyệt từng bài theo giao diện Tinder (Giữ/Bỏ bằng phím mũi tên hoặc nút bấm)"
              >
                ⚡ Duyệt nhanh kiểu Tinder ({bulkPasteSummary.finalUrls.length} bài)
              </Button>
              <Button
                type="primary"
                size="large"
                icon={<RocketOutlined />}
                disabled={bulkPasteSummary.finalUrls.length === 0}
                onClick={handleApplyBulkPaste}
                className="bulk-paste-apply"
              >
                {bulkPasteSummary.finalUrls.length > 0
                  ? `Tạo ${bulkPasteSummary.finalUrls.length} bài & áp dụng lịch`
                  : 'Dán link để tạo bài viết'}
              </Button>
            </div>
          </div>
        </div>
      }
    >
      <div className="bulk-paste-workspace space-y-6">
        {/* BANNER THÔNG BÁO TIẾN ĐỘ CÀO DỮ LIỆU */}
        {bulkScrapeStats.total > 0 && (
          bulkScrapeStats.isDone ? (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/90 via-[#06241a] to-teal-950/90 border border-emerald-500/60 shadow-xl flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center text-emerald-400 text-xl shadow-lg shrink-0">
                  <CheckCircleFilled />
                </div>
                <div>
                  <div className="text-base font-black text-emerald-200 flex items-center gap-2 flex-wrap">
                    <span>🎉 ĐÃ CÀO XONG TOÀN BỘ {bulkScrapeStats.total}/{bulkScrapeStats.total} BÀI VIẾT (100%)</span>
                    <Tag color="success" className="!m-0 !text-xs !font-bold">ĐÃ SẴN SÀNG</Tag>
                  </div>
                  <div className="text-xs text-emerald-300/80 mt-0.5">
                    Toàn bộ hình ảnh, video & caption đã được tải trước đầy đủ. Bạn có thể duyệt bài ngay ở thanh điều khiển bên dưới.
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-950/90 via-[#0a1a33] to-blue-950/90 border border-sky-500/40 shadow-xl flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-11 h-11 rounded-2xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-400 text-xl shadow-lg shrink-0">
                  <LoadingOutlined spin />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black text-sky-200 flex items-center gap-2 flex-wrap">
                    <span>🔄 Đang cào dữ liệu & tải trước: {bulkScrapeStats.completed}/{bulkScrapeStats.total} bài hoàn tất ({bulkScrapeStats.percent}%)</span>
                    {bulkScrapeStats.error > 0 && (
                      <Tag color="error" className="!m-0 !text-xs !font-bold">{bulkScrapeStats.error} bài lỗi</Tag>
                    )}
                  </div>
                  <div className="text-xs text-sky-300/80 mt-0.5">
                    Đang xử lý {bulkScrapeStats.loading} bài còn lại... Quá trình chạy ngầm cực nhanh.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Progress
                  percent={bulkScrapeStats.percent}
                  strokeColor="#38bdf8"
                  trailColor="#1e293b"
                  size="small"
                  style={{ width: 140 }}
                />
              </div>
            </div>
          )
        )}
        {/* BANNER CỐ ĐỊNH: MỤC TIÊU KPI HÔM NAY CHO NHÓM */}
        {currentKpiTarget && (
          <div className="bulk-paste-kpi bg-gradient-to-r from-violet-950/90 via-[#101b38] to-indigo-950/90 border border-violet-500/40 rounded-2xl p-4 sm:p-5 shadow-2xl flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3.5 min-w-0 flex-1">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 border border-violet-400/40 text-white flex items-center justify-center text-2xl shadow-lg shadow-violet-600/30 shrink-0">
                🎯
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-base font-black text-slate-100 flex items-center gap-2.5 flex-wrap">
                  <span>Mục tiêu KPI hôm nay:</span>
                  <span className="text-violet-300 font-extrabold underline underline-offset-4">{stripEmojiPrefix(currentKpiTarget.name)}</span>
                  <Tag color={currentKpiTarget.isFullyPublished ? 'success' : currentKpiTarget.isFullyScheduled ? 'purple' : 'error'} className="!m-0 !text-xs !font-black !px-2.5">
                    {currentKpiTarget.isFullyPublished
                      ? '✓ Đã hoàn thành'
                      : currentKpiTarget.isFullyScheduled
                        ? `⏳ Đã lên lịch đủ ${currentKpiTarget.totalPlanned}/${currentKpiTarget.targetCount} bài`
                        : `Còn thiếu ${currentKpiTarget.remainingToSchedule} bài`}
                  </Tag>
                </div>
                <div className="text-xs text-slate-300 mt-1 flex items-center gap-3 flex-wrap font-medium">
                  <span>Đã đăng: <strong className="text-slate-100 font-bold">{currentKpiTarget.actualCount}/{currentKpiTarget.targetCount} bài</strong></span>
                  <span>•</span>
                  <span>Đang chờ đăng: <strong className="text-violet-300 font-black text-sm">{currentKpiTarget.totalPending} bài</strong></span>
                  <span>•</span>
                  <span>Tiến độ tổng: <strong className={`font-black text-sm ${currentKpiTarget.isFullyScheduled ? 'text-emerald-400' : 'text-amber-300'}`}>{currentKpiTarget.totalPlanned}/{currentKpiTarget.targetCount} bài {currentKpiTarget.isFullyScheduled ? '(Đã lên đủ lịch! 🚀)' : `(còn thiếu ${currentKpiTarget.remainingToSchedule} bài)`}</strong></span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {currentKpiTarget.isFullyScheduled ? (
                <span className="px-3.5 py-2 rounded-xl bg-violet-500/20 text-violet-200 border border-violet-500/40 font-extrabold text-xs flex items-center gap-2 shadow-lg">
                  <CheckCircleOutlined className="text-violet-400 text-sm" />
                  <span>✓ Đã lên lịch đủ {currentKpiTarget.totalPlanned}/{currentKpiTarget.targetCount} bài</span>
                </span>
              ) : bulkPasteSummary.finalUrls.length >= currentKpiTarget.remainingToSchedule ? (
                <span className="px-4 py-2 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-extrabold text-xs flex items-center gap-2 shadow-lg">
                  <CheckCircleOutlined className="text-emerald-400 text-sm" />
                  <span>✓ Đã dán đủ {bulkPasteSummary.finalUrls.length}/{currentKpiTarget.remainingToSchedule} bài bù còn thiếu! 🚀</span>
                </span>
              ) : (
                <span className="px-3.5 py-2 rounded-xl bg-rose-500/20 text-rose-300 border border-rose-500/40 font-extrabold text-xs flex items-center gap-2 shadow-lg animate-pulse">
                  <span>⚠️ Hãy dán thêm {currentKpiTarget.remainingToSchedule - bulkPasteSummary.finalUrls.length} link nữa để đủ KPI!</span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* PHẦN 1: BẢNG ĐIỀU KHIỂN ĐẦU VÀO & CÀI ĐẶT LỊCH (2 CỘT SONG SONG TRÊN MÀN HÌNH RỘNG) */}
        <div className="bulk-paste-control-grid grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* CỘT TRÁI (xl:col-span-7): Ô DÁN LINK & THỐNG KÊ */}
          <div className="bulk-paste-links-panel xl:col-span-7 space-y-4 bg-slate-900/80 border border-slate-800/90 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-extrabold text-slate-100 flex items-center gap-2">
                  <span>📋</span>
                  <span>Danh sách đường dẫn (Links)</span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5">Dán mỗi dòng một link, hoặc dán nguyên đoạn văn bản chứa link.</div>
              </div>
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    if (text) {
                      const urls = (text.match(/https?:\/\/[^\s"'<>]+/gi) || []).map((u) => u.trim());
                      if (urls.length > 0) {
                        setBulkText((prev) => {
                          const existing = prev.trim();
                          const newLinks = urls.join('\n');
                          return existing ? `${existing}\n${newLinks}\n` : `${newLinks}\n`;
                        });
                        message.success(`Đã thêm ${urls.length} link và tự động xuống dòng!`);
                      } else {
                        setBulkText((prev) => (prev.trim() ? `${prev.trim()}\n${text.trim()}\n` : `${text.trim()}\n`));
                      }
                    }
                  } catch {
                    // Ignore
                  }
                }}
                className="bg-blue-600 hover:bg-blue-500 border-0 text-white font-bold text-xs rounded-xl px-3.5 py-1 shrink-0 shadow-md"
              >
                📋 Dán từ bộ nhớ tạm
              </Button>
            </div>

            <TextArea
              rows={6}
              value={bulkText}
              onChange={(e) => {
                const val = e.target.value;
                // Tự động ngắt dòng nếu dán/nhập 2 link liền kề trên cùng 1 hàng
                const autoBroken = val.replace(/(https?:\/\/[^\s"'<>]+)[ \t]+(https?:\/\/)/gi, '$1\n$2');
                setBulkText(autoBroken);
              }}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text');
                if (!pasted) return;
                const urls = (pasted.match(/https?:\/\/[^\s"'<>]+/gi) || []).map((u) => u.trim());
                if (urls.length > 0) {
                  e.preventDefault();
                  setBulkText((prev) => {
                    const existing = prev.trim();
                    const newLinks = urls.join('\n');
                    return existing ? `${existing}\n${newLinks}\n` : `${newLinks}\n`;
                  });
                }
              }}
              placeholder={'https://www.facebook.com/share/p/...\nhttps://www.threads.net/@account/post/...\nhttps://www.tiktok.com/@user/video/... (hoặc vt.tiktok.com)\nhttps://www.facebook.com/reel/...'}
              className="font-mono text-xs rounded-xl p-3.5 bg-slate-950 border-slate-700/80 text-slate-100 placeholder:text-slate-600 focus:border-blue-500"
              style={{ resize: 'vertical', minHeight: 140 }}
            />

            {/* Thống kê nhanh */}
            <div className="grid grid-cols-4 gap-2.5">
              <div className="flex flex-col items-center bg-blue-500/15 border border-blue-500/30 rounded-xl p-2.5 text-center shadow-inner">
                <span className="text-xl font-black text-blue-400">{bulkPasteSummary.finalUrls.length}</span>
                <span className="text-xs font-semibold text-slate-200 leading-tight mt-0.5">Bài sẽ tạo</span>
              </div>
              <div className="flex flex-col items-center bg-slate-800/70 border border-slate-700/70 rounded-xl p-2.5 text-center">
                <span className="text-xl font-black text-slate-200">{bulkPasteSummary.uniqueUrls.length}</span>
                <span className="text-xs text-slate-300 leading-tight mt-0.5">Link unique</span>
              </div>
              <div className={`flex flex-col items-center rounded-xl p-2.5 text-center border ${bulkPasteSummary.duplicateInHistoryCount > 0 ? 'bg-amber-500/15 border-amber-500/40 shadow-inner' : 'bg-slate-800/70 border-slate-700/70'}`}>
                <span className={`text-xl font-black ${bulkPasteSummary.duplicateInHistoryCount > 0 ? 'text-amber-300' : 'text-slate-200'}`}>{bulkPasteSummary.duplicateInHistoryCount}</span>
                <span className="text-xs text-slate-300 leading-tight mt-0.5">Đã có LS</span>
              </div>
              <div className={`flex flex-col items-center rounded-xl p-2.5 text-center border ${bulkPasteSummary.invalidLineCount > 0 ? 'bg-red-500/15 border-red-500/40 shadow-inner' : 'bg-slate-800/70 border-slate-700/70'}`}>
                <span className={`text-xl font-black ${bulkPasteSummary.invalidLineCount > 0 ? 'text-red-400' : 'text-slate-200'}`}>{bulkPasteSummary.invalidLineCount}</span>
                <span className="text-xs text-slate-300 leading-tight mt-0.5">Dòng vô hiệu</span>
              </div>
            </div>

            {/* Toggle lọc link đã đăng */}
            {bulkPasteSummary.duplicateInHistoryCount > 0 && (
              <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5">
                <div className="text-xs text-amber-300">
                  <span className="font-bold">{bulkPasteSummary.duplicateInHistoryCount} link</span> đã tồn tại trong lịch sử đăng.
                  {!filterHistoryDuplicates && <span className="text-amber-400 font-semibold"> Giữ lại để đăng lại.</span>}
                </div>
                <div
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={() => setFilterHistoryDuplicates(!filterHistoryDuplicates)}
                >
                  <div className={`w-9 h-5 rounded-full relative transition-colors ${filterHistoryDuplicates ? 'bg-amber-500' : 'bg-slate-700'}`}>
                    <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all shadow ${filterHistoryDuplicates ? 'right-0.5' : 'left-0.5'}`} />
                  </div>
                  <span className="text-xs font-bold text-amber-300 whitespace-nowrap">
                    {filterHistoryDuplicates ? 'Đang lọc bỏ' : 'Lọc LS'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* CỘT PHẢI: THỜI GIAN ĐĂNG — dùng chung bộ chọn giờ với trang, giờ cụ thể do Lịch đăng chung xếp */}
          <div className="bulk-paste-schedule-panel xl:col-span-5 bg-slate-900/80 rounded-2xl border border-slate-800/90 p-4 space-y-2">
            <div className="text-sm font-bold text-slate-200">Thời gian đăng</div>
            <ScheduleChoice value={scheduleChoice} onChange={setScheduleChoice} />
          </div>
        </div>

        {/* PHẦN 2: KIỂM SOÁT CHI TIẾT CÁC BÀI VIẾT (FULL WIDTH RỘNG RÃI TRẢI DÀI) */}
        {bulkPasteSummary.uniqueUrls.length > 0 && (
          <div className="bulk-paste-posts rounded-2xl border border-slate-700/80 overflow-hidden bg-slate-900/90 shadow-2xl">
            <div className="bulk-paste-posts-head px-6 py-4 bg-slate-800/90 border-b border-slate-700/80 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="text-base font-black text-slate-100">Kiểm soát chi tiết các bài viết ({bulkPasteSummary.finalUrls.length} bài)</span>
                <Tag color="blue" className="!m-0 !text-xs font-bold px-2.5 py-0.5">{bulkPasteSummary.finalUrls.length} bài hợp lệ</Tag>
                {bulkScrapeStats.isDone ? (
                  <Tag color="success" className="!m-0 !text-xs font-bold px-2.5 py-0.5">✓ 100% Đã cào xong</Tag>
                ) : (
                  <Tag color="processing" className="!m-0 !text-xs font-bold px-2.5 py-0.5">⏳ Đang cào ({bulkScrapeStats.completed}/{bulkScrapeStats.total})</Tag>
                )}
                {bulkPasteSummary.duplicateInHistoryCount > 0 && (
                  <Tag color="warning" className="!m-0 !text-xs font-bold">{bulkPasteSummary.duplicateInHistoryCount} bài đã có LS</Tag>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="middle"
                  icon={<EyeOutlined />}
                  onClick={fetchAllDrawerPreviews}
                  className="!text-xs !h-9 !px-4 border-blue-500/50 text-blue-300 bg-blue-500/20 hover:bg-blue-500/30 rounded-xl font-bold"
                >
                  🔄 Tải lại tất cả ảnh/video
                </Button>
              </div>
            </div>

            <div className="bulk-paste-post-list max-h-[75vh] overflow-y-auto divide-y divide-slate-800/80 bg-[#070d19] p-4 sm:p-6 space-y-6">
              {bulkPasteSummary.uniqueUrls.map((url, index) => {
                const isInHistory = bulkPasteSummary.historyMatchedUrls.includes(url);
                const isFiltered = filterHistoryDuplicates && isInHistory;
                const posInFinal = bulkPasteSummary.finalUrls.indexOf(url);
                const preview = bulkDrawerPreviews[url];
                const hasMedia = (preview?.mediaUrls?.length || 0) > 0;
                const rawMedia = preview?.mediaUrls || [];
                const originalMedia = preview?.originalMediaUrls || [];
                const hasCustomMedia = rawMedia.length !== originalMedia.length || rawMedia.some((u, i) => u !== originalMedia[i]);
                const isVideo = (u: string, idx: number) => isMediaVideo(u, preview?.mediaKinds?.[idx]);
                const videoUrls = rawMedia.filter((u, i) => isVideo(u, i));
                const photoUrls = rawMedia.filter((u, i) => !isVideo(u, i));
                const isSkipComment = !!preview?.skipComment;
                const isCredit = preview?.includeCredit !== false;


                return (
                  <div
                    key={url}
                    className={`bulk-paste-post-card p-5 sm:p-6 rounded-2xl border transition-all ${isFiltered
                      ? 'opacity-35 bg-slate-900/30 border-slate-800'
                      : isInHistory
                        ? 'bg-[#0d1627] border-amber-500/40 shadow-xl'
                        : 'bg-[#0d1627] border-slate-700/80 shadow-xl'
                      }`}
                  >
                    {/* HEADER CHI TIẾT BÀI VIẾT */}
                    <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800 flex-wrap">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className={`w-9 h-9 rounded-2xl grid place-items-center text-sm font-black shrink-0 ${isInHistory ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-rose-500 text-white shadow-lg'
                          }`}>
                          #{posInFinal >= 0 ? posInFinal + 1 : index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-3 flex-wrap mb-1.5">
                            <span className="text-base font-bold text-slate-100 truncate max-w-md">
                              {preview?.caption ? preview.caption.slice(0, 100) : `Bài viết #${posInFinal >= 0 ? posInFinal + 1 : index + 1}`}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-400 font-mono flex-wrap">
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:underline truncate max-w-md"
                              title={url}
                            >
                              🔗 {url}
                            </a>
                            {isInHistory && <Tag color="warning" className="!m-0 !text-xs font-bold">⚠️ ĐÃ CÓ TRONG LỊCH SỬ</Tag>}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {preview?.caption && (
                          <Button
                            size="small"
                            icon={<CopyOutlined />}
                            onClick={() => {
                              navigator.clipboard.writeText(preview.caption || '');
                              message.success('Đã sao chép caption!');
                            }}
                            className="text-xs bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 rounded-lg"
                          >
                            Sao chép Caption
                          </Button>
                        )}
                        <Button
                          type="text"
                          size="small"
                          icon={<ReloadOutlined className="text-slate-400 text-xs" />}
                          onClick={() => {
                            setBulkDrawerPreviews((prev) => ({ ...prev, [url]: { loading: false } }));
                            setTimeout(() => fetchOneDrawerPreview(url), 50);
                          }}
                          title="Cào lại link này"
                          className="!w-8 !h-8 !p-0 grid place-items-center rounded-lg hover:bg-slate-800 text-slate-400"
                        />
                        <Button
                          type="text"
                          danger
                          size="small"
                          icon={<DeleteOutlined className="text-xs" />}
                          onClick={() => removeUrlFromBulkText(url)}
                          title="Xóa link này khỏi đợt dán"
                          className="!w-8 !h-8 !p-0 grid place-items-center rounded-lg hover:bg-red-500/20 text-red-400"
                        />
                      </div>
                    </div>

                    {/* Trạng thái đang tải */}
                    {preview?.loading && (
                      <div className="my-5 p-6 rounded-2xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-center gap-3 text-blue-300 text-sm font-semibold">
                        <LoadingOutlined className="text-xl" spin />
                        Đang cào dữ liệu và tải trước hình ảnh, video & caption...
                      </div>
                    )}

                    {/* Lỗi cào */}
                    {preview?.error && !preview.loading && (
                      <div className="my-5 p-4 rounded-2xl bg-red-500/10 border border-red-500/25 flex items-center justify-between gap-2 text-red-300 text-xs">
                        <span>⚠️ {preview.error}</span>
                        <Button
                          size="small"
                          onClick={() => fetchOneDrawerPreview(url)}
                          className="text-xs bg-red-500/20 text-red-300 border-red-500/40 rounded-lg font-bold"
                        >
                          Thử lại
                        </Button>
                      </div>
                    )}

                    {/* NỘI DUNG CHI TIẾT THEO CÁC MỤC DỌC (GIỐNG HỆT MODAL XEM CHI TIẾT) */}
                    {!preview?.loading && (
                      <div className="mt-5 space-y-6">
                        {/* ── MỤC 1: VIDEO & HÌNH ẢNH ĐÍNH KÈM ── */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-1 h-4 bg-rose-500 rounded-full inline-block" />
                              <span className="text-xs font-black tracking-wider text-rose-400 uppercase">
                                VIDEO & HÌNH ẢNH ĐÍNH KÈM
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {videoUrls.length > 0 && (
                                <Tag color="purple" className="!m-0 !text-xs !font-bold !px-2.5 !py-0.5">🎥 {videoUrls.length} Video</Tag>
                              )}
                              {photoUrls.length > 0 && (
                                <Tag color="blue" className="!m-0 !text-xs !font-bold !px-2.5 !py-0.5">🖼️ {photoUrls.length} Ảnh</Tag>
                              )}
                              {(url.includes('tiktok.com') || preview?.watermarkRemoved) && (
                                <Tag color="green" className="!m-0 !text-xs !font-bold !px-2.5 !py-0.5 !text-emerald-300 !bg-emerald-950/80 !border-emerald-500/50">
                                  ✨ Sạch Logo TikTok
                                </Tag>
                              )}
                            </div>
                          </div>

                          <div className="p-4 sm:p-5 rounded-2xl bg-[#060b14] border border-slate-800/90 space-y-5">
                            {/* Thanh khôi phục nếu đã chỉnh sửa/xóa bớt media */}
                            {hasCustomMedia && (
                              <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-xl px-3.5 py-2">
                                <span className="text-xs text-amber-300 font-medium">
                                  ⚠️ Bạn đã chỉnh sửa/xóa bớt video hoặc hình ảnh của bài này.
                                </span>
                                <Button
                                  size="small"
                                  type="link"
                                  onClick={() => resetDrawerMedia(url)}
                                  className="!text-xs !text-amber-400 hover:!text-amber-300 !p-0 font-bold underline"
                                >
                                  Khôi phục media gốc
                                </Button>
                              </div>
                            )}

                            {/* Danh sách Video Player */}
                            {videoUrls.map((vUrl, vIdx) => {
                              const mediaIdx = rawMedia.indexOf(vUrl);
                              return (
                                <div key={vIdx} className="space-y-2">
                                  <div className="flex items-center justify-between text-xs text-slate-400">
                                    <span className="font-bold text-purple-300 flex items-center gap-1.5">
                                      🎥 Video đính kèm {videoUrls.length > 1 ? `#${vIdx + 1}` : ''}:
                                    </span>
                                    <Button
                                      size="small"
                                      danger
                                      icon={<DeleteOutlined className="text-xs" />}
                                      onClick={() => removeDrawerMedia(url, mediaIdx)}
                                      className="!text-xs bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 rounded-lg font-bold flex items-center gap-1 !h-7 !px-3"
                                    >
                                      Xóa video này
                                    </Button>
                                  </div>
                                  <div className="relative rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-2xl flex justify-center items-center">
                                    <video
                                      controls
                                      src={vUrl}
                                      className="w-full max-h-[420px] object-contain bg-black"
                                      preload="metadata"
                                    />
                                  </div>
                                </div>
                              );
                            })}

                            {/* Album ảnh */}
                            {photoUrls.length > 0 && (
                              <div className="space-y-3">
                                <div className="flex items-center justify-between text-xs text-slate-300">
                                  <span className="font-bold text-slate-200">📄 Album ảnh đính kèm:</span>
                                  <span className="text-xs text-slate-300">(Click vào ảnh để phóng to toàn màn hình)</span>
                                </div>

                                <Image.PreviewGroup>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                                    {photoUrls.map((imgSrc, imgIdx) => {
                                      const mediaIdx = rawMedia.indexOf(imgSrc);
                                      return (
                                        <div
                                          key={imgIdx}
                                          className="relative rounded-2xl overflow-hidden border border-slate-700/80 bg-slate-950 aspect-square group shadow-md"
                                        >
                                          <Image
                                            src={imgSrc}
                                            alt={`Ảnh ${imgIdx + 1}`}
                                            className="!w-full !h-full !object-cover cursor-pointer"
                                          />

                                          {/* Tag Ảnh Bìa */}
                                          {imgIdx === 0 && (
                                            <span className="absolute top-1.5 left-1.5 bg-rose-600/90 text-white text-xs font-black px-2 py-0.5 rounded-lg shadow-lg pointer-events-none">
                                              #1 Bìa
                                            </span>
                                          )}

                                          {/* Bộ công cụ đổi thứ tự ảnh khi hover */}
                                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-1.5 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                                            <div className="flex items-center gap-1">
                                              {imgIdx > 0 && (
                                                <button
                                                  type="button"
                                                  onClick={() => moveDrawerMedia(url, mediaIdx, rawMedia.indexOf(photoUrls[imgIdx - 1]))}
                                                  className="w-6 h-6 rounded-lg bg-slate-800/90 hover:bg-blue-600 text-white text-xs grid place-items-center cursor-pointer border-0 shadow"
                                                  title="Đưa lên trước"
                                                >
                                                  ←
                                                </button>
                                              )}
                                              {imgIdx < photoUrls.length - 1 && (
                                                <button
                                                  type="button"
                                                  onClick={() => moveDrawerMedia(url, mediaIdx, rawMedia.indexOf(photoUrls[imgIdx + 1]))}
                                                  className="w-6 h-6 rounded-lg bg-slate-800/90 hover:bg-blue-600 text-white text-xs grid place-items-center cursor-pointer border-0 shadow"
                                                  title="Đưa ra sau"
                                                >
                                                  →
                                                </button>
                                              )}
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => removeDrawerMedia(url, mediaIdx)}
                                              className="w-6 h-6 rounded-lg bg-red-600/80 hover:bg-red-600 text-white text-xs grid place-items-center cursor-pointer border-0 shadow"
                                              title="Xóa ảnh này"
                                            >
                                              ✕
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </Image.PreviewGroup>
                              </div>
                            )}

                            {!hasMedia && !preview?.error && (
                              <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 text-center text-xs text-slate-500">
                                📄 Bài viết dạng văn bản thuần (không có video hoặc hình ảnh).
                              </div>
                            )}
                          </div>
                        </div>

                        {/* ── MỤC 2: NỘI DUNG CAPTION BÀI VIẾT ── */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-1 h-4 bg-rose-500 rounded-full inline-block" />
                              <span className="text-xs font-black tracking-wider text-rose-400 uppercase">
                                NỘI DUNG CAPTION BÀI VIẾT
                              </span>
                            </div>
                            <span className="text-xs text-slate-400 font-mono">
                              {preview?.caption?.length || 0} ký tự
                            </span>
                          </div>

                          <div className="p-4 sm:p-5 rounded-2xl bg-[#060b14] border border-slate-800/90 space-y-3">
                            <TextArea
                              autoSize={{ minRows: 4, maxRows: 12 }}
                              value={preview?.caption || ''}
                              onChange={(e) => updateDrawerPreviewCaption(url, e.target.value)}
                              placeholder="Chưa cào được caption hoặc bài viết không có text..."
                              className="bg-transparent border-0 text-slate-100 text-sm font-sans focus:shadow-none p-0 leading-relaxed placeholder:text-slate-600"
                            />

                            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-3 flex-wrap">
                              <Checkbox
                                checked={isCredit}
                                onChange={() => toggleDrawerCredit(url)}
                                className="text-xs font-semibold text-slate-300"
                              >
                                📌 Nguồn bài viết: Tự động gắn "Cre: @tác giả" vào cuối caption
                              </Checkbox>
                            </div>
                          </div>
                        </div>

                        {/* ── MỤC 3: BÌNH LUẬN TỰ ĐỘNG & TIẾP THỊ LIÊN KẾT ── */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-1 h-4 bg-amber-500 rounded-full inline-block" />
                              <span className="text-xs font-black tracking-wider text-amber-400 uppercase">
                                BÌNH LUẬN TỰ ĐỘNG & TIẾP THỊ LIÊN KẾT
                              </span>
                            </div>
                            <Checkbox
                              checked={isSkipComment}
                              onChange={() => toggleDrawerSkipComment(url)}
                              className="text-xs text-red-400 font-bold"
                            >
                              🚫 Tắt bình luận bài này
                            </Checkbox>
                          </div>

                          {!isSkipComment && (
                            <div className="p-4 rounded-2xl bg-[#060b14] border border-slate-800/90">
                              <Input
                                value={preview?.affiliateComment || ''}
                                onChange={(e) => updateDrawerComment(url, e.target.value)}
                                placeholder="Mặc định dùng bình luận chung của hệ thống (hoặc nhập riêng link Shopee/bình luận cho bài này)..."
                                className="bg-slate-950 border-slate-800 text-slate-100 text-xs rounded-xl p-3 placeholder:text-slate-600"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(BulkPasteDrawer, (prev, next) => !prev.bulkModalVisible && !next.bulkModalVisible);
