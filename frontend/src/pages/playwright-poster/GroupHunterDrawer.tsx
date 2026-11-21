import { memo } from 'react';
import type React from 'react';
import {
  Button,
  Input,
  Select,
  Checkbox,
  Progress,
  Tooltip,
  DatePicker,
  Modal,
  InputNumber,
  Drawer,
  Radio,
  App,
} from 'antd';
import {
  ThunderboltOutlined,
  RocketOutlined,
  TeamOutlined,
  EyeOutlined,
  SearchOutlined,
  CalendarOutlined,
  EditOutlined,
  ClearOutlined,
  ArrowRightOutlined,
  StarOutlined,
  StarFilled,
  CloseOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  UserOutlined,
  VideoCameraOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  WarningOutlined,
  SafetyCertificateOutlined,
  ScheduleOutlined,
  ExportOutlined,
  BulbOutlined,
  CheckOutlined,
  SyncOutlined,
  CommentOutlined,
  ReadOutlined,
  ScissorOutlined,
  AppstoreOutlined,
  CameraOutlined,
  CrownOutlined,
  KeyOutlined,
} from '@ant-design/icons';
import { getStoredGeminiKeys } from '../../components/modals/AiSettingsModal';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import type { ScrapeAccountOption } from './shared';
import type { SocialAccount } from './types';

function SparklesSvg({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
    </svg>
  );
}

interface GroupHunterDrawerProps {
  groupHunterDrawerVisible: boolean;
  setGroupHunterDrawerVisible: React.Dispatch<React.SetStateAction<boolean>>;
  groupHunterTarget: string;
  setGroupHunterTarget: React.Dispatch<React.SetStateAction<string>>;
  groupHunterLimit: number;
  setGroupHunterLimit: React.Dispatch<React.SetStateAction<number>>;
  groupHunterDateRange: [Dayjs, Dayjs];
  setGroupHunterDateRange: React.Dispatch<React.SetStateAction<[Dayjs, Dayjs]>>;
  groupHunterMediaFilter: "ALL" | "MEDIA_ONLY" | "IMAGE_ONLY" | "VIDEO_ONLY";
  setGroupHunterMediaFilter: React.Dispatch<React.SetStateAction<"ALL" | "MEDIA_ONLY" | "IMAGE_ONLY" | "VIDEO_ONLY">>;
  setGroupHunterSkipImported: React.Dispatch<React.SetStateAction<boolean>>;
  groupHunterSkipImported: boolean;
  setGroupHunterAutoSchedule: React.Dispatch<React.SetStateAction<boolean>>;
  groupHunterAutoSchedule: boolean;
  groupHunterInterval: number;
  setGroupHunterInterval: React.Dispatch<React.SetStateAction<number>>;
  groupHunterLoading: boolean;
  groupHunterResults: { id: string; url: string; author: string; caption: string; previewCover: string; images: string[]; mediaType: "IMAGE" | "VIDEO" | "TEXT"; mediaCount: number; isAlreadyImported?: boolean; postedTime?: string; postedAt?: number; dateUnknown?: boolean; aiCurated?: boolean; aiScore?: number; qualityVerdict?: string; viralAngle?: string; suggestedHook?: string; isSpam?: boolean; originalCaption?: string; aiRewritten?: boolean; }[];
  setGroupHunterResults: React.Dispatch<React.SetStateAction<{ id: string; url: string; author: string; caption: string; previewCover: string; images: string[]; mediaType: "IMAGE" | "VIDEO" | "TEXT"; mediaCount: number; isAlreadyImported?: boolean; postedTime?: string; postedAt?: number; dateUnknown?: boolean; aiCurated?: boolean; aiScore?: number; qualityVerdict?: string; viralAngle?: string; suggestedHook?: string; isSpam?: boolean; originalCaption?: string; aiRewritten?: boolean; }[]>>;
  groupHunterAiCurating: boolean;
  setGroupHunterAiOnlyQuality: React.Dispatch<React.SetStateAction<boolean>>;
  groupHunterAiOnlyQuality: boolean;
  groupHunterScheduleMode: "INTERVAL" | "GOLDEN_HOURS";
  setGroupHunterScheduleMode: React.Dispatch<React.SetStateAction<"INTERVAL" | "GOLDEN_HOURS">>;
  setGroupHunterBatchAiOpen: React.Dispatch<React.SetStateAction<boolean>>;
  groupHunterBatchAiOpen: boolean;
  groupHunterBatchAiMode: "HOOK" | "REWRITE" | "ENGAGEMENT" | "STORYTELLING" | "SHORTEN";
  setGroupHunterBatchAiMode: React.Dispatch<React.SetStateAction<"HOOK" | "REWRITE" | "ENGAGEMENT" | "STORYTELLING" | "SHORTEN">>;
  groupHunterBatchAiLoading: boolean;
  setGroupHunterBatchAiProgress: React.Dispatch<React.SetStateAction<{ current: number; total: number; }>>;
  groupHunterBatchAiProgress: { current: number; total: number; };
  setGroupHunterPreviewItem: React.Dispatch<any>;
  groupHunterPreviewItem: any;
  groupHunterGroupName: string;
  groupHunterCustomName: string;
  setGroupHunterCustomName: React.Dispatch<React.SetStateAction<string>>;
  groupHunterSelectedIds: Set<string>;
  setGroupHunterSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  favoriteGroupSearch: string;
  setFavoriteGroupSearch: React.Dispatch<React.SetStateAction<string>>;
  setFavoriteGroupsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  favoriteGroupsExpanded: boolean;
  setFavoriteGroupCategoryFilter: React.Dispatch<React.SetStateAction<"PHIM" | "GENERAL" | "ALL">>;
  favoriteGroupCategoryFilter: "PHIM" | "GENERAL" | "ALL";
  favoriteGroups: { name: string; url: string; }[];
  handleAddFavoriteGroup: (urlToAdd?: string, nameToAdd?: string) => void;
  handleRemoveFavoriteGroup: (urlToRemove: string) => void;
  handleRenameFavoriteGroup: (urlToRename: string, currentName: string) => void;
  handleHuntFacebookGroup: () => Promise<void>;
  handleGeminiCurateGroupPosts: () => Promise<void>;
  handleApplyGroupHunterHook: (item: any) => void;
  handleCleanSpamFromSelectedPosts: () => void;
  handleExecuteGroupHunterBatchAi: () => Promise<void>;
  filteredGroupHunterPosts: { id: string; url: string; author: string; caption: string; previewCover: string; images: string[]; mediaType: "IMAGE" | "VIDEO" | "TEXT"; mediaCount: number; isAlreadyImported?: boolean; postedTime?: string; postedAt?: number; dateUnknown?: boolean; aiCurated?: boolean; aiScore?: number; qualityVerdict?: string; viralAngle?: string; suggestedHook?: string; isSpam?: boolean; originalCaption?: string; aiRewritten?: boolean; }[];
  handleImportGroupHunterPosts: () => void;
  handleImportAndSwipeGroupHunterPosts: () => void;
  allFavoriteGroups: { name: string; url: string; isConnected?: boolean; category: "PHIM" | "GENERAL"; }[];
  filteredFavoriteGroups: { name: string; url: string; isConnected?: boolean; category: "PHIM" | "GENERAL"; }[];
  visibleFavoriteGroups: { name: string; url: string; isConnected?: boolean; category: "PHIM" | "GENERAL"; }[];
  activeScrapeAccount?: SocialAccount;
  scrapeAccountOptions: ScrapeAccountOption[];
  setGroupHunterScrapeAccountId: (id: number | null) => void;
}

// Drawer quét bài viết từ Facebook Group / Fanpage — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
function GroupHunterDrawer({
  groupHunterDrawerVisible,
  setGroupHunterDrawerVisible,
  groupHunterTarget,
  setGroupHunterTarget,
  groupHunterLimit,
  setGroupHunterLimit,
  groupHunterDateRange,
  setGroupHunterDateRange,
  groupHunterMediaFilter,
  setGroupHunterMediaFilter,
  setGroupHunterSkipImported,
  groupHunterSkipImported,
  setGroupHunterAutoSchedule,
  groupHunterAutoSchedule,
  groupHunterInterval,
  setGroupHunterInterval,
  groupHunterLoading,
  groupHunterResults,
  setGroupHunterResults,
  groupHunterAiCurating,
  setGroupHunterAiOnlyQuality,
  groupHunterAiOnlyQuality,
  groupHunterScheduleMode,
  setGroupHunterScheduleMode,
  setGroupHunterBatchAiOpen,
  groupHunterBatchAiOpen,
  groupHunterBatchAiMode,
  setGroupHunterBatchAiMode,
  groupHunterBatchAiLoading,
  setGroupHunterBatchAiProgress,
  groupHunterBatchAiProgress,
  setGroupHunterPreviewItem,
  groupHunterPreviewItem,
  groupHunterGroupName,
  groupHunterCustomName,
  setGroupHunterCustomName,
  groupHunterSelectedIds,
  setGroupHunterSelectedIds,
  favoriteGroupSearch,
  setFavoriteGroupSearch,
  setFavoriteGroupsExpanded,
  favoriteGroupsExpanded,
  setFavoriteGroupCategoryFilter,
  favoriteGroupCategoryFilter,
  favoriteGroups,
  handleAddFavoriteGroup,
  handleRemoveFavoriteGroup,
  handleRenameFavoriteGroup,
  handleHuntFacebookGroup,
  handleGeminiCurateGroupPosts,
  handleApplyGroupHunterHook,
  handleCleanSpamFromSelectedPosts,
  handleExecuteGroupHunterBatchAi,
  filteredGroupHunterPosts,
  handleImportGroupHunterPosts,
  handleImportAndSwipeGroupHunterPosts,
  allFavoriteGroups,
  filteredFavoriteGroups,
  visibleFavoriteGroups,
  activeScrapeAccount,
  scrapeAccountOptions,
  setGroupHunterScrapeAccountId,
}: GroupHunterDrawerProps) {
  const { message } = App.useApp();
  return (
    <Drawer
      rootClassName="group-hunter-drawer"
      title={
        <div className="group-hunter-title">
          <div className="group-hunter-title-icon">
            <TeamOutlined className="text-base text-blue-400" />
          </div>
          <div>
            <div className="group-hunter-title-main">Quét bài viết từ Facebook Group / Fanpage</div>
            <div className="group-hunter-title-sub">Tìm bài nổi bật, chọn nội dung phù hợp rồi đưa vào lịch đăng</div>
          </div>
        </div>
      }
      placement="right"
      size="large"
      open={groupHunterDrawerVisible}
      onClose={() => setGroupHunterDrawerVisible(false)}
      styles={{
        wrapper: { width: '100vw', maxWidth: '100vw' },
        header: { background: '#0c141f', borderBottom: '1px solid #223247', padding: '14px 24px' },
        body: { background: '#08111b', padding: '20px 24px' },
        footer: { background: '#0c141f', borderTop: '1px solid #223247', padding: '12px 24px' },
      }}
      footer={
        <div className="group-hunter-footer">
          <Button
            size="large"
            onClick={() => setGroupHunterDrawerVisible(false)}
            className="group-hunter-close"
          >
            Đóng
          </Button>
          <div className="group-hunter-footer-action">
            <div className="group-hunter-selection-count">
              <span>Đã chọn</span>
              <strong>{groupHunterSelectedIds.size}</strong>
              <small>/ {groupHunterResults.length} bài</small>
            </div>
            <Button
              size="large"
              disabled={groupHunterSelectedIds.size === 0}
              onClick={handleImportAndSwipeGroupHunterPosts}
              icon={<ThunderboltOutlined />}
              className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold border-none shadow-lg shadow-emerald-950/40 rounded-xl"
            >
              Duyệt {groupHunterSelectedIds.size} bài
            </Button>
            <Button
              type="primary"
              size="large"
              disabled={groupHunterSelectedIds.size === 0}
              onClick={handleImportGroupHunterPosts}
              icon={<RocketOutlined />}
              className="group-hunter-import"
            >
              {groupHunterSelectedIds.size > 0
                ? `Đưa ${groupHunterSelectedIds.size} bài vào lịch đăng`
                : 'Chọn bài để đưa vào lịch'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="group-hunter-content">
        {/* Box tìm kiếm Group */}
        <section className="group-hunter-setup">
          <div className="group-hunter-section-head">
            <div>
              <span className="group-hunter-kicker">BƯỚC 1</span>
              <h3>Chọn nguồn cần quét</h3>
              <p>Dán link Group hoặc chọn nhanh một nhóm bạn thường sử dụng.</p>
            </div>
            <Tooltip title="Nhóm riêng tư chỉ Via nào đã tham gia mới quét được. Đổi Via cá nhân tại đây nếu nhóm báo không có quyền xem.">
              <div className="group-hunter-account is-picker">
                <UserOutlined />
                <span>Via quét:</span>
                {scrapeAccountOptions.length > 0 ? (
                  <Select
                    size="small"
                    variant="borderless"
                    popupMatchSelectWidth={false}
                    value={activeScrapeAccount?.id}
                    onChange={(val) => setGroupHunterScrapeAccountId(Number(val))}
                    className="group-hunter-via-select"
                    options={scrapeAccountOptions.map((opt) => ({
                      value: opt.id,
                      label: opt.isPersonalVia ? `${opt.name} · Via cá nhân` : opt.name,
                      opt,
                    }))}
                    optionRender={(option) => {
                      const opt = (option.data as { opt?: ScrapeAccountOption }).opt;
                      if (!opt) return option.label;
                      return (
                        <div className="flex items-center justify-between gap-3 py-0.5">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                opt.isHealthy ? 'bg-emerald-400' : opt.tokenStatus === 'EXPIRING_SOON' ? 'bg-amber-400' : 'bg-rose-400'
                              }`}
                            />
                            <span className="font-semibold text-slate-100">{opt.name}</span>
                          </div>
                          <span className="text-xs text-slate-400">
                            {opt.isPersonalVia ? 'Via cá nhân' : 'Cookie Page'}
                            {!opt.isHealthy ? ` · ${opt.tokenStatus === 'EXPIRED' ? 'Hết hạn' : 'Sắp hết hạn'}` : ''}
                          </span>
                        </div>
                      );
                    }}
                  />
                ) : (
                  <b>{activeScrapeAccount?.pageName || 'Chưa có Via kết nối'}</b>
                )}
              </div>
            </Tooltip>
          </div>
          <div className="group-hunter-form-grid">
            <div className="group-hunter-field group-hunter-field-url">
              <label>Link Group hoặc Fanpage <span>hoặc ID nhóm</span></label>
              <Input
                size="large"
                placeholder="Dán link Group, link Fanpage hoặc nhập ID nhóm"
                value={groupHunterTarget}
                onChange={(e) => setGroupHunterTarget(e.target.value)}
                onPressEnter={handleHuntFacebookGroup}
                prefix={<TeamOutlined />}
                allowClear
              />
            </div>
            <div className="group-hunter-field group-hunter-field-name">
              <label>Tên gợi nhớ <span>không bắt buộc</span></label>
              <Input
                size="large"
                placeholder="VD: Mẹ & bé, Tuyển dụng..."
                value={groupHunterCustomName}
                onChange={(e) => setGroupHunterCustomName(e.target.value)}
                onPressEnter={handleHuntFacebookGroup}
                prefix={<EditOutlined />}
                allowClear
              />
            </div>
            <div className="group-hunter-field group-hunter-field-limit">
              <label>Số bài cần lấy <span>tối đa {groupHunterDateRange ? 200 : 60}</span></label>
              <div className="group-hunter-limit-control">
                <InputNumber
                  size="large"
                  min={1}
                  max={groupHunterDateRange ? 200 : 60}
                  value={groupHunterLimit}
                  onChange={(val) => setGroupHunterLimit(Number(val) || 20)}
                  placeholder="20"
                />
                <div className="group-hunter-limit-presets" aria-label="Chọn nhanh số bài">
                  {[10, 20, 30, 50].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setGroupHunterLimit(num)}
                      className={groupHunterLimit === num ? 'is-active' : ''}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="group-hunter-submit-wrap">
              <Button
                type="primary"
                size="large"
                loading={groupHunterLoading}
                onClick={handleHuntFacebookGroup}
                className="group-hunter-scan"
              >
                <SearchOutlined /> Quét bài viết
              </Button>
            </div>
          </div>

          <div className="group-hunter-date-row">
            <div className="group-hunter-date-label">
              <CalendarOutlined />
              <span>Lọc theo ngày đăng</span>
            </div>
            <DatePicker.RangePicker
              value={groupHunterDateRange}
              onChange={(vals) => setGroupHunterDateRange(vals && vals[0] && vals[1] ? [vals[0], vals[1]] : null)}
              format="DD/MM/YYYY"
              allowClear
              disabledDate={(d) => d.isAfter(dayjs(), 'day')}
              placeholder={['Từ ngày', 'Đến ngày']}
              presets={[
                { label: 'Hôm nay', value: [dayjs().startOf('day'), dayjs().startOf('day')] },
                { label: 'Hôm qua', value: [dayjs().subtract(1, 'day').startOf('day'), dayjs().subtract(1, 'day').startOf('day')] },
                { label: '3 ngày gần đây', value: [dayjs().subtract(2, 'day').startOf('day'), dayjs().startOf('day')] },
                { label: '7 ngày gần đây', value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().startOf('day')] },
              ]}
            />
            <span className="group-hunter-date-hint">
              {groupHunterDateRange
                ? 'Quét bài mới nhất trước, dừng khi gặp bài cũ hơn ngày bắt đầu. Có thể mất 1–4 phút.'
                : 'Bỏ trống để quét như bình thường (bài theo thứ tự Facebook hiển thị).'}
            </span>
          </div>

          {/* Thanh chọn nhanh Nhóm Yêu Thích */}
          {allFavoriteGroups.length > 0 && (
            <div className="group-hunter-favorites">
              <div className="group-hunter-favorites-head">
                <div>
                  <strong><StarFilled /> Nhóm nguồn thường quét</strong>
                  <span>{allFavoriteGroups.length} nhóm nguồn đã lưu để quét bài</span>
                </div>
                <div className="group-hunter-favorites-tools">
                  <Input
                    size="small"
                    allowClear
                    value={favoriteGroupSearch}
                    onChange={(event) => setFavoriteGroupSearch(event.target.value)}
                    placeholder="Tìm tên nhóm..."
                    prefix={<SearchOutlined />}
                  />
                  {groupHunterTarget.trim() && !favoriteGroups.some((g) => g.url === groupHunterTarget.trim()) && (
                    <button
                      type="button"
                      onClick={() => handleAddFavoriteGroup()}
                      className="group-hunter-save"
                    >
                      <StarOutlined /> Lưu nhóm này
                    </button>
                  )}
                </div>
              </div>

              {/* Bộ lọc chủ đề: Tất cả vs Nhóm Phim (Bí ý tưởng) */}
              <div className="flex items-center gap-2 pt-2 pb-1 flex-wrap">
                <span className="text-xs text-slate-400 font-semibold">Chủ đề:</span>
                <button
                  type="button"
                  onClick={() => setFavoriteGroupCategoryFilter('ALL')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    favoriteGroupCategoryFilter === 'ALL'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Tất cả ({allFavoriteGroups.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFavoriteGroupCategoryFilter('PHIM')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${
                    favoriteGroupCategoryFilter === 'PHIM'
                      ? 'bg-gradient-to-r from-rose-600 to-amber-600 text-white shadow-rose-600/30 ring-1 ring-white/30'
                      : 'bg-rose-950/60 text-rose-300 border border-rose-800/50 hover:bg-rose-900/60'
                  }`}
                >
                  <VideoCameraOutlined />
                  <span>Nhóm Phim (Bí ý tưởng)</span>
                  <span className="px-2 py-0.5 rounded-full bg-rose-500/30 text-rose-200 text-xs">
                    {allFavoriteGroups.filter((g) => g.category === 'PHIM').length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setFavoriteGroupCategoryFilter('GENERAL')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    favoriteGroupCategoryFilter === 'GENERAL'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Mẹ & Bé / Khác
                </button>
              </div>

              <div className="group-hunter-favorite-grid">
                {visibleFavoriteGroups.map((g) => {
                  const isSelected = groupHunterTarget.trim() === g.url.trim() || (g.url.includes('/groups/') && groupHunterTarget.includes(g.url.split('/groups/')[1]));
                  return (
                    <div
                      key={g.url}
                      onClick={() => {
                        setGroupHunterTarget(g.url);
                        setGroupHunterCustomName(g.name.replace(/^\[🎬 Phim\]\s*/, ''));
                      }}
                      className={`group-hunter-favorite-card ${isSelected ? 'is-selected' : ''}`}
                    >
                      <span className="group-hunter-favorite-icon">
                        {g.category === 'PHIM' ? <VideoCameraOutlined className="text-rose-400" /> : <TeamOutlined />}
                      </span>
                      <span className="group-hunter-favorite-name" title={g.name}>{g.name}</span>
                      <span className="group-hunter-favorite-actions">
                        <button
                          type="button"
                          title="Đổi tên gợi nhớ cho nhóm này"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRenameFavoriteGroup(g.url, g.name);
                          }}
                          aria-label={`Đổi tên ${g.name}`}
                        >
                          <EditOutlined />
                        </button>
                        <button
                          type="button"
                          title="Xóa khỏi nhóm yêu thích"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveFavoriteGroup(g.url);
                          }}
                          aria-label={`Xóa ${g.name}`}
                        >
                          <CloseOutlined />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
              {filteredFavoriteGroups.length === 0 && (
                <div className="group-hunter-favorite-empty">Không tìm thấy nhóm phù hợp.</div>
              )}
              {!favoriteGroupSearch.trim() && allFavoriteGroups.length > 6 && (
                <button
                  type="button"
                  className="group-hunter-expand"
                  onClick={() => setFavoriteGroupsExpanded((current) => !current)}
                >
                  {favoriteGroupsExpanded ? 'Thu gọn danh sách' : `Xem thêm ${allFavoriteGroups.length - 6} nhóm`}
                  <ArrowRightOutlined className={favoriteGroupsExpanded ? 'is-open' : ''} />
                </button>
              )}
            </div>
          )}
        </section>

        {/* Kết quả quét Group */}
        {groupHunterResults.length > 0 && (
          <div className="group-hunter-results space-y-4">
            {/* Thanh công cụ lọc & cấu hình rải lịch */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Lọc loại bài:</span>
                  <Select
                    size="small"
                    value={groupHunterMediaFilter}
                    onChange={(val) => setGroupHunterMediaFilter(val)}
                    className="w-52 text-xs"
                    popupMatchSelectWidth={false}
                    options={[
                      {
                        value: 'ALL',
                        label: (
                          <span className="inline-flex items-center gap-1.5">
                            <AppstoreOutlined className="text-slate-400" />
                            <span>Tất cả bài viết ({groupHunterResults.length})</span>
                          </span>
                        ),
                      },
                      {
                        value: 'MEDIA_ONLY',
                        label: (
                          <span className="inline-flex items-center gap-1.5">
                            <PictureOutlined className="text-emerald-400" />
                            <span>Có Ảnh hoặc Video ({groupHunterResults.filter((it) => it.mediaCount > 0).length})</span>
                          </span>
                        ),
                      },
                      {
                        value: 'IMAGE_ONLY',
                        label: (
                          <span className="inline-flex items-center gap-1.5">
                            <CameraOutlined className="text-sky-400" />
                            <span>Chỉ bài có Ảnh ({groupHunterResults.filter((it) => it.mediaType === 'IMAGE').length})</span>
                          </span>
                        ),
                      },
                      {
                        value: 'VIDEO_ONLY',
                        label: (
                          <span className="inline-flex items-center gap-1.5">
                            <PlayCircleOutlined className="text-rose-400" />
                            <span>Chỉ bài có Video ({groupHunterResults.filter((it) => it.mediaType === 'VIDEO').length})</span>
                          </span>
                        ),
                      },
                    ]}
                  />

                  <button
                    type="button"
                    onClick={() => setGroupHunterSkipImported(!groupHunterSkipImported)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all border flex items-center gap-1.5 cursor-pointer ${groupHunterSkipImported
                      ? 'bg-blue-500/15 text-blue-300 border-blue-500/40'
                      : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200'
                      }`}
                  >
                    <SafetyCertificateOutlined className={groupHunterSkipImported ? 'text-blue-400' : 'text-slate-500'} />
                    <span>Bỏ bài đã có trong Lịch ({groupHunterResults.filter((it) => it.isAlreadyImported).length})</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${groupHunterSkipImported ? 'bg-blue-400' : 'bg-slate-500'}`} />
                  </button>
                </div>

                {/* Xếp vào lịch đăng chung (giờ cụ thể theo Lịch đăng trên header) */}
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setGroupHunterAutoSchedule(!groupHunterAutoSchedule)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all border flex items-center gap-1.5 cursor-pointer ${groupHunterAutoSchedule
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200'
                      }`}
                  >
                    <ScheduleOutlined className={groupHunterAutoSchedule ? 'text-emerald-400' : 'text-slate-500'} />
                    <span>Xếp vào lịch đăng</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${groupHunterAutoSchedule ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                  </button>

                </div>
              </div>

              {/* Hàng công cụ Gemini AI & Làm sạch bài viết */}
              <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-2 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="small"
                    icon={<SparklesSvg className="w-3.5 h-3.5 text-amber-400" />}
                    loading={groupHunterAiCurating}
                    onClick={handleGeminiCurateGroupPosts}
                    className="text-xs font-semibold bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20 inline-flex items-center"
                  >
                    Gemini AI Thẩm định &amp; Lọc rác
                  </Button>

                  <Button
                    size="small"
                    icon={<ClearOutlined className="text-emerald-400" />}
                    onClick={handleCleanSpamFromSelectedPosts}
                    disabled={groupHunterSelectedIds.size === 0}
                    className="text-xs font-semibold bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20"
                    title="Xoá sạch số điện thoại, Zalo, link quảng cáo, STK ngân hàng và hashtag thừa"
                  >
                    Dọn rác &amp; SĐT ({groupHunterSelectedIds.size})
                  </Button>

                  <Button
                    size="small"
                    icon={<EditOutlined className="text-purple-400" />}
                    onClick={() => {
                      if (groupHunterSelectedIds.size === 0) {
                        message.warning('Vui lòng chọn ít nhất 1 bài viết để AI viết lại!');
                        return;
                      }
                      setGroupHunterBatchAiProgress({ current: 0, total: groupHunterSelectedIds.size });
                      setGroupHunterBatchAiOpen(true);
                    }}
                    disabled={groupHunterSelectedIds.size === 0}
                    className="text-xs font-semibold bg-purple-500/10 text-purple-300 border-purple-500/30 hover:bg-purple-500/20"
                    title="Viết lại hàng loạt theo phong cách: Hook giật tít, Storytelling, Kích thích bình luận..."
                  >
                    Viết lại AI ({groupHunterSelectedIds.size})
                  </Button>

                  {groupHunterResults.some((it) => it.aiCurated) && (
                    <button
                      type="button"
                      onClick={() => setGroupHunterAiOnlyQuality(!groupHunterAiOnlyQuality)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all border flex items-center gap-1.5 cursor-pointer ${
                        groupHunterAiOnlyQuality
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      <CrownOutlined className={groupHunterAiOnlyQuality ? 'text-amber-400' : 'text-slate-500'} />
                      <span>Chỉ lấy bài điểm cao (&ge; 70 &amp; Sạch rác)</span>
                      <span className={`w-1.5 h-1.5 rounded-full ${groupHunterAiOnlyQuality ? 'bg-amber-400' : 'bg-slate-500'}`} />
                    </button>
                  )}
                </div>

                <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                  <KeyOutlined className="text-emerald-400" />
                  <span>Key Gemini: <strong className="text-emerald-400">{getStoredGeminiKeys() ? 'Đã kích hoạt' : 'Hệ thống'}</strong></span>
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-200">
                  Tìm thấy <span className="text-blue-400 font-mono font-bold">{filteredGroupHunterPosts.length}</span> bài viết từ nhóm <span className="text-blue-400 font-semibold font-mono">{groupHunterGroupName || 'Facebook Group'}</span>:
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="small"
                  onClick={() => {
                    if (groupHunterSelectedIds.size === filteredGroupHunterPosts.length) {
                      setGroupHunterSelectedIds(new Set());
                    } else {
                      setGroupHunterSelectedIds(new Set(filteredGroupHunterPosts.map((it) => it.id)));
                    }
                  }}
                  className="text-xs font-semibold rounded-lg bg-slate-800 border-slate-700 text-slate-300"
                >
                  {groupHunterSelectedIds.size === filteredGroupHunterPosts.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredGroupHunterPosts.map((item, idx) => {
                const isChecked = groupHunterSelectedIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      setGroupHunterSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      });
                    }}
                    className={`cursor-pointer rounded-2xl border p-3.5 transition-all space-y-3 relative group ${isChecked
                      ? 'border-blue-500/80 bg-blue-950/20 shadow-lg shadow-blue-950/30 ring-1 ring-blue-500/50'
                      : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
                      }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Thumbnail */}
                      <div className="w-20 h-24 rounded-xl overflow-hidden bg-slate-950 shrink-0 relative border border-slate-800 flex items-center justify-center">
                        {item.previewCover ? (
                          <img src={item.previewCover} alt="cover" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 text-xs gap-1">
                            {item.mediaType === 'VIDEO' ? (
                              <>
                                <PlayCircleOutlined className="text-xl" />
                                <span>{/\/reel\//.test(item.url) ? 'Reels' : 'Video'}</span>
                              </>
                            ) : item.mediaType === 'IMAGE' ? (
                              <>
                                <PictureOutlined className="text-xl" />
                                <span>Ảnh</span>
                              </>
                            ) : (
                              <>
                                <FileTextOutlined className="text-xl" />
                                <span>Bài Text</span>
                              </>
                            )}
                          </div>
                        )}
                        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-blue-600/90 text-xs text-white font-bold">
                          #{idx + 1}
                        </span>
                        {item.mediaCount > 1 && (
                          <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-black/80 text-xs text-white font-mono font-bold">
                            +{item.mediaCount}
                          </span>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Checkbox
                            checked={isChecked}
                            onChange={(e) => {
                              e.stopPropagation();
                              setGroupHunterSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(item.id)) next.delete(item.id);
                                else next.add(item.id);
                                return next;
                              });
                            }}
                          />
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-slate-300 hover:text-blue-400 font-medium inline-flex items-center gap-1 transition-colors"
                          >
                            <span>Xem trên FB</span>
                            <ExportOutlined className="text-[11px]" />
                          </a>
                        </div>

                        <div className="flex items-center justify-between gap-1">
                          <div className="text-xs text-blue-300 font-bold truncate inline-flex items-center gap-1.5">
                            <UserOutlined className="text-blue-400 shrink-0" />
                            <span className="truncate">{item.author || 'Thành viên'}</span>
                          </div>
                          {item.isAlreadyImported && (
                            <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold shrink-0 inline-flex items-center gap-1">
                              <WarningOutlined className="text-[11px]" />
                              <span>Đã có trong Lịch</span>
                            </span>
                          )}
                        </div>

                        {/* Huy hiệu điểm Gemini AI & cảnh báo rác */}
                        {item.aiCurated && (
                          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                            {item.aiScore !== undefined && item.aiScore >= 80 ? (
                              <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1">
                                <CrownOutlined className="text-[11px]" />
                                <span>Cực Phẩm ({item.aiScore}/100)</span>
                              </span>
                            ) : item.aiScore !== undefined && item.aiScore >= 65 ? (
                              <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1">
                                <StarOutlined className="text-[11px]" />
                                <span>Đạt chuẩn ({item.aiScore}/100)</span>
                              </span>
                            ) : (
                              <span className="text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                                Điểm: {item.aiScore}/100
                              </span>
                            )}
                            {item.isSpam && (
                              <span className="text-xs font-bold px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 inline-flex items-center gap-1">
                                <WarningOutlined className="text-[11px]" />
                                <span>AI: Rác / Spam</span>
                              </span>
                            )}
                          </div>
                        )}

                        <p className="text-[13px] text-slate-200 line-clamp-2 font-medium mb-0">
                          {item.caption || 'Bài viết không có tiêu đề'}
                        </p>

                        {/* Nút bấm chèn Hook mở đầu cuốn hút do Gemini đề xuất */}
                        {item.suggestedHook && !item.aiRewritten && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleApplyGroupHunterHook(item);
                            }}
                            className="text-xs text-amber-300 hover:text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded px-2 py-1 text-left font-medium transition-all cursor-pointer flex items-center gap-1.5 w-full"
                            title={`Bấm để chèn vào đầu bài: "${item.suggestedHook}"`}
                          >
                            <BulbOutlined className="shrink-0 text-amber-400" />
                            <span className="truncate">Chèn Hook AI: "{item.suggestedHook}"</span>
                          </button>
                        )}

                        {item.aiRewritten && (
                          <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                            <CheckOutlined /> Đã chèn Hook AI mở đầu
                          </span>
                        )}

                        <div className="flex items-center gap-2 pt-1 flex-wrap text-xs">
                          {item.mediaType === 'VIDEO' && (
                            <span className="px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-300 font-semibold border border-rose-500/20 inline-flex items-center gap-1">
                              <PlayCircleOutlined className="text-[11px]" />
                              <span>Video</span>
                            </span>
                          )}
                          {item.mediaType === 'IMAGE' && (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 font-semibold border border-emerald-500/20 inline-flex items-center gap-1">
                              <PictureOutlined className="text-[11px]" />
                              <span>{item.mediaCount} ảnh</span>
                            </span>
                          )}
                          {item.mediaType === 'TEXT' && (
                            <span className="px-2 py-0.5 rounded-md bg-slate-700/40 text-slate-300 border border-slate-700/50 inline-flex items-center gap-1">
                              <FileTextOutlined className="text-[11px]" />
                              <span>Chữ</span>
                            </span>
                          )}
                          {item.dateUnknown ? (
                            <span className="px-2 py-0.5 rounded-md bg-slate-700/40 text-slate-300 border border-slate-600/50 truncate" style={{ maxWidth: 165 }}>
                              Không rõ ngày{item.postedTime && item.postedTime !== 'Gần đây' ? ` (${item.postedTime})` : ''}
                            </span>
                          ) : item.postedAt ? (
                            <Tooltip title={item.postedTime ? `Facebook hiển thị: ${item.postedTime}` : undefined}>
                              <span className="px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 font-semibold border border-blue-500/25 inline-flex items-center gap-1">
                                <ClockCircleOutlined className="text-[11px]" />
                                <span>{dayjs(item.postedAt).format('HH:mm DD/MM/YYYY')}</span>
                              </span>
                            </Tooltip>
                          ) : item.postedTime && (
                            <span className="px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 font-semibold border border-blue-500/25 inline-flex items-center gap-1" style={{ maxWidth: 165 }}>
                              <ClockCircleOutlined className="text-[11px] shrink-0" />
                              <span className="truncate">{item.postedTime}</span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/60 mt-1">
                          <span className="text-xs text-slate-300 truncate max-w-[120px] inline-flex items-center gap-1">
                            {item.originalCaption && item.originalCaption !== item.caption ? (
                              <>
                                <SparklesSvg className="w-3 h-3 text-purple-400 shrink-0" />
                                <span>Đã sửa nội dung</span>
                              </>
                            ) : ''}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setGroupHunterPreviewItem(item);
                            }}
                            className="text-xs text-blue-300 hover:text-white font-semibold flex items-center gap-1 cursor-pointer bg-blue-500/10 hover:bg-blue-500/20 px-2.5 py-1 rounded border border-blue-500/20 transition-all"
                          >
                            <EyeOutlined /> Xem &amp; Sửa bài
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Trạng thái trống */}
        {groupHunterResults.length === 0 && !groupHunterLoading && (
          <div className="group-hunter-empty">
            <div className="group-hunter-empty-icon"><SearchOutlined /></div>
            <div>
              <h3>Kết quả quét sẽ xuất hiện ở đây</h3>
              <p>Chọn một nhóm, đặt số lượng bài rồi bấm <b>Quét bài viết</b>.</p>
            </div>
            <div className="group-hunter-empty-steps">
              <span><b>1</b> Chọn Group</span>
              <span><b>2</b> Quét & lọc bài</span>
              <span><b>3</b> Đưa vào lịch đăng</span>
            </div>
          </div>
        )}
      </div>

      {/* Modal Viết Lại Nội Dung Hàng Loạt Bằng Gemini */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <SparklesSvg className="w-4 h-4 text-amber-400" />
            <span className="font-bold text-white">Viết Lại Nội Dung Hàng Loạt Bằng Gemini AI</span>
          </div>
        }
        open={groupHunterBatchAiOpen}
        onCancel={() => !groupHunterBatchAiLoading && setGroupHunterBatchAiOpen(false)}
        width={580}
        footer={[
          <Button key="cancel" disabled={groupHunterBatchAiLoading} onClick={() => setGroupHunterBatchAiOpen(false)}>
            Huỷ
          </Button>,
          <Button
            key="submit"
            type="primary"
            loading={groupHunterBatchAiLoading}
            onClick={handleExecuteGroupHunterBatchAi}
            className="!bg-gradient-to-r !from-purple-600 !to-indigo-600 font-bold"
          >
            Bắt đầu viết lại ({groupHunterBatchAiProgress.total || groupHunterSelectedIds.size} bài)
          </Button>,
        ]}
      >
        <div className="py-2 space-y-4">
          <p className="text-xs text-slate-300 leading-relaxed mb-0">
            Chọn phong cách diễn đạt bạn muốn Gemini áp dụng cho <b>{groupHunterSelectedIds.size} bài viết</b> đã chọn. Nội dung sau khi viết lại sẽ được dùng làm caption mới khi đưa vào lịch đăng:
          </p>

          <Radio.Group
            value={groupHunterBatchAiMode}
            onChange={(e) => setGroupHunterBatchAiMode(e.target.value)}
            className="w-full space-y-2.5"
          >
            <div className={`p-3 rounded-xl border transition-all cursor-pointer ${groupHunterBatchAiMode === 'REWRITE' ? 'bg-purple-950/30 border-purple-500/60' : 'bg-slate-900/60 border-slate-800'}`}>
              <Radio value="REWRITE" className="font-bold text-slate-100 text-[13px]">
                <span className="inline-flex items-center gap-1.5">
                  <SyncOutlined className="text-purple-400" />
                  <span>Viết lại hoàn toàn (Paraphrase) — Chống trùng lặp FB 100%</span>
                </span>
              </Radio>
              <div className="text-xs text-slate-300 pl-6 mt-0.5">
                Đổi từ ngữ và cấu trúc câu nhưng giữ trọn ý nghĩa và số liệu gốc, giúp bài viết độc bản, không bị Facebook đánh gậy sao chép.
              </div>
            </div>

            <div className={`p-3 rounded-xl border transition-all cursor-pointer ${groupHunterBatchAiMode === 'HOOK' ? 'bg-purple-950/30 border-purple-500/60' : 'bg-slate-900/60 border-slate-800'}`}>
              <Radio value="HOOK" className="font-bold text-slate-100 text-[13px]">
                <span className="inline-flex items-center gap-1.5">
                  <BulbOutlined className="text-amber-400" />
                  <span>Thêm Hook giật tít gây tò mò cực mạnh</span>
                </span>
              </Radio>
              <div className="text-xs text-slate-300 pl-6 mt-0.5">
                Chèn 1-2 câu mở đầu giật gân, khơi gợi trí tò mò hoặc đặt câu hỏi đánh trúng tâm lý, giữ nguyên thân bài.
              </div>
            </div>

            <div className={`p-3 rounded-xl border transition-all cursor-pointer ${groupHunterBatchAiMode === 'ENGAGEMENT' ? 'bg-purple-950/30 border-purple-500/60' : 'bg-slate-900/60 border-slate-800'}`}>
              <Radio value="ENGAGEMENT" className="font-bold text-slate-100 text-[13px]">
                <span className="inline-flex items-center gap-1.5">
                  <CommentOutlined className="text-sky-400" />
                  <span>Kích thích bình luận &amp; Tranh luận (Engagement Booster)</span>
                </span>
              </Radio>
              <div className="text-xs text-slate-300 pl-6 mt-0.5">
                Thêm câu hỏi mở thông minh và kêu gọi độc giả bày tỏ quan điểm ở phần bình luận.
              </div>
            </div>

            <div className={`p-3 rounded-xl border transition-all cursor-pointer ${groupHunterBatchAiMode === 'STORYTELLING' ? 'bg-purple-950/30 border-purple-500/60' : 'bg-slate-900/60 border-slate-800'}`}>
              <Radio value="STORYTELLING" className="font-bold text-slate-100 text-[13px]">
                <span className="inline-flex items-center gap-1.5">
                  <ReadOutlined className="text-emerald-400" />
                  <span>Kể chuyện tự nhiên (Storytelling Voice)</span>
                </span>
              </Radio>
              <div className="text-xs text-slate-300 pl-6 mt-0.5">
                Biến tấu nội dung thành dạng câu chuyện kể hấp dẫn, có diễn biến kịch tính và cảm xúc.
              </div>
            </div>

            <div className={`p-3 rounded-xl border transition-all cursor-pointer ${groupHunterBatchAiMode === 'SHORTEN' ? 'bg-purple-950/30 border-purple-500/60' : 'bg-slate-900/60 border-slate-800'}`}>
              <Radio value="SHORTEN" className="font-bold text-slate-100 text-[13px]">
                <span className="inline-flex items-center gap-1.5">
                  <ScissorOutlined className="text-rose-400" />
                  <span>Rút gọn súc tích, cô đọng</span>
                </span>
              </Radio>
              <div className="text-xs text-slate-300 pl-6 mt-0.5">
                Giữ lại chi tiết đắt giá nhất, loại bỏ câu từ rườm rà giúp người lướt nhanh dễ tiếp thu.
              </div>
            </div>
          </Radio.Group>

          {groupHunterBatchAiLoading && (
            <div className="p-3.5 bg-purple-950/40 border border-purple-500/30 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs text-purple-300 font-semibold">
                <span className="inline-flex items-center gap-1.5">
                  <ThunderboltOutlined />
                  <span>Đang viết lại bài {groupHunterBatchAiProgress.current} / {groupHunterBatchAiProgress.total}...</span>
                </span>
                <span>{Math.round((groupHunterBatchAiProgress.current / (groupHunterBatchAiProgress.total || 1)) * 100)}%</span>
              </div>
              <Progress
                percent={Math.round((groupHunterBatchAiProgress.current / (groupHunterBatchAiProgress.total || 1)) * 100)}
                showInfo={false}
                strokeColor={{ '0%': '#a855f7', '100%': '#6366f1' }}
              />
            </div>
          )}
        </div>
      </Modal>

      {/* Modal Xem & Chỉnh Sửa Trực Tiếp Bài Viết */}
      <Modal
        title={
          <div className="flex items-center justify-between pr-6">
            <div className="flex items-center gap-2">
              <EyeOutlined className="text-blue-400 text-lg" />
              <span className="font-bold text-white">Xem &amp; Chỉnh Sửa Bài Viết</span>
            </div>
            {groupHunterPreviewItem?.url && (
              <a
                href={groupHunterPreviewItem.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 font-medium inline-flex items-center gap-1"
              >
                <span>Mở link gốc Facebook</span>
                <ExportOutlined className="text-[11px]" />
              </a>
            )}
          </div>
        }
        open={Boolean(groupHunterPreviewItem)}
        onCancel={() => setGroupHunterPreviewItem(null)}
        width={700}
        footer={[
          <Button key="close" onClick={() => setGroupHunterPreviewItem(null)}>
            Đóng
          </Button>,
          <Button
            key="cleanSpam"
            icon={<ClearOutlined />}
            onClick={() => {
              if (!groupHunterPreviewItem) return;
              let text = groupHunterPreviewItem.caption || '';
              text = text.replace(/https?:\/\/[^\s]+/gi, '');
              text = text.replace(/(?:zalo|sđt|sdt|hotline|liên hệ|call|lh|tel)[\s:.-]*[0-9]{8,12}/gi, '');
              text = text.replace(/\b0[235789][0-9]{8}\b/g, '');
              text = text.replace(/(?:stk|số tài khoản|ngân hàng|mbbank|vietcombank|techcombank)[\s:.-]*[0-9]{6,16}/gi, '');
              text = text.replace(/(?:vào group|link nhóm|nhóm thảo luận|tele(?:gram)?|theo dõi fanpage)[:\s]+[^\n]+/gi, '');
              text = text.replace(/\n{3,}/g, '\n\n').trim();
              setGroupHunterPreviewItem({ ...groupHunterPreviewItem, caption: text });
              setGroupHunterResults((prev) =>
                prev.map((it) => (it.id === groupHunterPreviewItem.id ? { ...it, caption: text } : it))
              );
              message.success('Đã làm sạch SĐT, link và STK của bài này!');
            }}
            className="text-xs font-semibold bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
          >
            Làm sạch rác
          </Button>,
          groupHunterPreviewItem?.suggestedHook && (
            <Button
              key="applyHook"
              icon={<BulbOutlined />}
              onClick={() => {
                if (!groupHunterPreviewItem?.suggestedHook) return;
                const newCaption = `${groupHunterPreviewItem.suggestedHook}\n\n${groupHunterPreviewItem.caption}`;
                setGroupHunterPreviewItem({ ...groupHunterPreviewItem, caption: newCaption, aiRewritten: true });
                setGroupHunterResults((prev) =>
                  prev.map((it) => (it.id === groupHunterPreviewItem.id ? { ...it, caption: newCaption, aiRewritten: true } : it))
                );
                message.success('Đã chèn Hook mở đầu!');
              }}
              className="text-xs font-semibold bg-amber-500/10 text-amber-300 border-amber-500/30"
            >
              Chèn Hook AI
            </Button>
          ),
          <Button
            key="save"
            type="primary"
            icon={<CheckOutlined />}
            onClick={() => {
              message.success('Đã lưu cập nhật cho bài viết!');
              setGroupHunterPreviewItem(null);
            }}
            className="!bg-blue-600 font-bold"
          >
            Lưu thay đổi
          </Button>,
        ]}
      >
        {groupHunterPreviewItem && (
          <div className="py-2 space-y-4">
            {/* Ảnh / Video Media Preview */}
            {groupHunterPreviewItem.images && groupHunterPreviewItem.images.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800 max-h-60 overflow-y-auto">
                {groupHunterPreviewItem.images.map((img: string, i: number) => (
                  <div key={i} className="rounded-lg overflow-hidden bg-slate-900 border border-slate-800 h-28">
                    <img src={img} alt={`media-${i}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            ) : groupHunterPreviewItem.previewCover ? (
              <div className="rounded-xl overflow-hidden bg-slate-950 border border-slate-800 max-h-64 flex items-center justify-center">
                <img src={groupHunterPreviewItem.previewCover} alt="cover" className="max-h-64 object-contain" />
              </div>
            ) : null}

            {/* Thông tin tác giả & Thời gian */}
            <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
              <div className="inline-flex items-center gap-1.5">
                <UserOutlined className="text-blue-400" />
                <span>Tác giả: <strong className="text-blue-300">{groupHunterPreviewItem.author || 'Thành viên'}</strong></span>
              </div>
              <div className="inline-flex items-center gap-1.5">
                <ClockCircleOutlined className="text-slate-400" />
                <span>Thời gian: <strong className="text-slate-200">{groupHunterPreviewItem.postedTime || 'Gần đây'}</strong></span>
              </div>
            </div>

            {/* Caption Textarea cho phép chỉnh sửa */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label className="font-bold text-slate-200">Nội dung Caption (Có thể chỉnh sửa trực tiếp):</label>
                {groupHunterPreviewItem.caption && (
                  <span className="text-xs text-slate-300">{groupHunterPreviewItem.caption.length} ký tự</span>
                )}
              </div>
              <Input.TextArea
                rows={6}
                value={groupHunterPreviewItem.caption || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setGroupHunterPreviewItem({ ...groupHunterPreviewItem, caption: val });
                  setGroupHunterResults((prev) =>
                    prev.map((it) => (it.id === groupHunterPreviewItem.id ? { ...it, caption: val } : it))
                  );
                }}
                className="bg-slate-950 border-slate-800 text-slate-200 rounded-xl"
                placeholder="Nhập nội dung bài viết..."
              />
            </div>
          </div>
        )}
      </Modal>
    </Drawer>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(GroupHunterDrawer, (prev, next) => !prev.groupHunterDrawerVisible && !next.groupHunterDrawerVisible);
