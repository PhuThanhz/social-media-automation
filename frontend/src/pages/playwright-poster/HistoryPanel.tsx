import type React from 'react';
import { App, Button, Card, Input, Select, Table, Tooltip, Popover, Popconfirm } from 'antd';
import type { TableProps } from 'antd';
import {
  AppstoreOutlined,
  ClockCircleOutlined,
  ClockCircleFilled,
  CheckCircleOutlined,
  CheckCircleFilled,
  CheckOutlined,
  CloseCircleOutlined,
  CloseCircleFilled,
  RedoOutlined,
  HistoryOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  ScheduleOutlined,
  WarningOutlined,
  SwapOutlined,
  TeamOutlined,
  AimOutlined,
  SearchOutlined,
  GlobalOutlined,
  ReloadOutlined,
  CalendarOutlined,
  SyncOutlined,
  ClearOutlined,
  CloseOutlined,
  ThunderboltFilled,
  ApartmentOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { GroupStatItem, PendingPageBreakdownItem, PostQueue, SocialAccount } from './types';
import { EMPTY_GROUP_STAT, PAGE_PALETTE, stripEmojiPrefix } from './shared';

interface HistoryPanelProps {
  selectedRowKeys: React.Key[];
  setSelectedRowKeys: React.Dispatch<React.SetStateAction<React.Key[]>>;
  setBulkRescheduleModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setBulkRescheduleTargetScope: React.Dispatch<React.SetStateAction<"ALL" | "SELECTED">>;
  isBulkProcessing: boolean;
  setReassignModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setReassignSelectedNicks: React.Dispatch<React.SetStateAction<string[]>>;
  isReassigning: boolean;
  setResetFailedModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setAutoFixQueueModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
  historyGroupFilter: string;
  setHistoryGroupFilter: React.Dispatch<React.SetStateAction<string>>;
  setHistoryPageFilter: React.Dispatch<React.SetStateAction<string>>;
  historyPageFilter: string;
  setHistoryStatusFilter: React.Dispatch<React.SetStateAction<string>>;
  historyStatusFilter: string;
  historySearchText: string;
  setHistorySearchText: React.Dispatch<React.SetStateAction<string>>;
  historyOpen: boolean;
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  groupAccountsWithId: SocialAccount[];
  resolvePosterIdentityName: (record: PostQueue) => string;
  posts: PostQueue[];
  isLoading: boolean;
  postCounts: { all: number; processing: number; pending: number; published: number; failed: number; };
  filteredHistoryPosts: PostQueue[];
  groupStatsMap: Map<string, GroupStatItem>;
  currentPendingDistribution: { scopeTitle: string; isGroupScope: boolean; totalPending: number; pagesList: PendingPageBreakdownItem[]; };
  handleBulkPublishNow: () => Promise<void>;
  handleBulkDelete: () => Promise<void>;
  handleRetryAllFailed: () => Promise<void>;
  handleDeleteAllFailed: () => Promise<void>;
  columns: TableProps<PostQueue>['columns'];
  historyTablePage: { current: number; pageSize: number };
  setHistoryTablePage: React.Dispatch<React.SetStateAction<{ current: number; pageSize: number }>>;
}

// Tab "Hàng đợi & lịch sử" của PlaywrightPoster; chỉ mount khi đang mở tab, state lọc/phân trang giữ ở cha
export default function HistoryPanel({
  selectedRowKeys,
  setSelectedRowKeys,
  setBulkRescheduleModalVisible,
  setBulkRescheduleTargetScope,
  isBulkProcessing,
  setReassignModalVisible,
  setReassignSelectedNicks,
  isReassigning,
  setResetFailedModalVisible,
  setAutoFixQueueModalVisible,
  historyGroupFilter,
  setHistoryGroupFilter,
  setHistoryPageFilter,
  historyPageFilter,
  setHistoryStatusFilter,
  historyStatusFilter,
  historySearchText,
  setHistorySearchText,
  historyOpen,
  setHistoryOpen,
  groupAccountsWithId,
  resolvePosterIdentityName,
  posts,
  isLoading,
  postCounts,
  filteredHistoryPosts,
  groupStatsMap,
  currentPendingDistribution,
  handleBulkPublishNow,
  handleBulkDelete,
  handleRetryAllFailed,
  handleDeleteAllFailed,
  columns,
  historyTablePage,
  setHistoryTablePage,
}: HistoryPanelProps) {
  const { message } = App.useApp();
  return (
    <Card
      className="poster-history-card border border-slate-700/60 bg-slate-900/90 shadow-lg rounded-2xl overflow-hidden backdrop-blur-md"
      styles={{ body: { display: historyOpen ? 'block' : 'none', padding: '16px 20px 20px' } }}
      title={
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 text-blue-400 flex items-center justify-center font-bold text-sm shrink-0 border border-blue-500/30 shadow-sm shadow-blue-950/40">
              <HistoryOutlined />
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-bold text-base text-slate-100 tracking-tight">Lịch sử & Hàng đợi bài đăng</span>
              <span className="px-2.5 py-0.5 rounded-lg bg-blue-500/15 text-blue-300 font-mono text-xs font-semibold border border-blue-400/30 shadow-2xs">
                {(filteredHistoryPosts?.length || 0).toLocaleString()} / {(posts?.length || 0).toLocaleString()} bài
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {postCounts.failed > 0 && (
              <>
                <Button
                  size="small"
                  icon={<ThunderboltOutlined />}
                  loading={isBulkProcessing}
                  onClick={() => setResetFailedModalVisible(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl h-8 px-3 border-none shadow-xs flex items-center gap-1.5 transition-all"
                >
                  Chuyển về Chờ đăng ({postCounts.failed})
                </Button>

                <Popconfirm
                  title="Xác nhận đăng lại tất cả bài lỗi"
                  description={`Bạn có chắc muốn kích hoạt xuất bản lại cho toàn bộ ${postCounts.failed} bài viết bị lỗi?`}
                  onConfirm={handleRetryAllFailed}
                  okText="Đăng lại tất cả"
                  cancelText="Hủy"
                >
                  <Button
                    size="small"
                    type="primary"
                    icon={<RedoOutlined />}
                    loading={isBulkProcessing}
                    className="bg-blue-600 hover:bg-blue-500 text-xs font-bold rounded-xl h-8 px-3 border-none shadow-xs transition-all"
                  >
                    Đăng lại tất cả bài lỗi ({postCounts.failed})
                  </Button>
                </Popconfirm>

                <Popconfirm
                  title="Xác nhận xóa tất cả bài lỗi vĩnh viễn"
                  description={`Bạn có chắc muốn xóa VĨNH VIỄN toàn bộ ${postCounts.failed} bài viết bị lỗi khỏi CSDL?`}
                  onConfirm={handleDeleteAllFailed}
                  okText="Xóa hết"
                  cancelText="Hủy"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    loading={isBulkProcessing}
                    className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold rounded-xl h-8 px-3 transition-all"
                  >
                    Xóa tất cả bài lỗi ({postCounts.failed})
                  </Button>
                </Popconfirm>
              </>
            )}
            <Button
              size="small"
              onClick={() => setHistoryOpen((open) => !open)}
              className="bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border-slate-700/80 rounded-xl text-xs font-semibold h-8 px-3 transition-all"
            >
              {historyOpen ? 'Thu gọn' : 'Xem lịch sử'}
            </Button>
          </div>
        </div>
      }
    >
      {/* THANH THAO TÁC HÀNG LOẠT GỌN GÀNG, THẲNG HÀNG */}
      {selectedRowKeys.length > 0 && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-4 py-2.5 mb-4 rounded-2xl bg-slate-900/95 border border-slate-700/80 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-2.5 text-xs">
            <span className="px-2.5 py-1 rounded-lg font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
              Đã chọn {selectedRowKeys.length} bài
            </span>
            <span className="hidden sm:inline text-slate-400 font-medium">Thao tác hàng loạt:</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="small"
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={isBulkProcessing}
              onClick={handleBulkPublishNow}
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl h-8 px-3.5 border-none shadow-sm transition-all"
            >
              Đăng ngay tất cả
            </Button>

            <Button
              size="small"
              icon={<ScheduleOutlined />}
              disabled={isBulkProcessing}
              onClick={() => {
                setBulkRescheduleTargetScope(selectedRowKeys.length > 0 ? 'SELECTED' : 'ALL');
                setBulkRescheduleModalVisible(true);
              }}
              className="bg-slate-800/90 hover:bg-slate-700/90 text-slate-200 border border-slate-700 font-medium text-xs rounded-xl h-8 px-3 transition-all"
            >
              Chia lại giờ
            </Button>

            <Button
              size="small"
              icon={<SwapOutlined />}
              disabled={isBulkProcessing || isReassigning}
              onClick={() => {
                setReassignSelectedNicks([]);
                setReassignModalVisible(true);
              }}
              className="bg-purple-600/20 hover:bg-purple-600/35 text-purple-300 border border-purple-500/40 font-semibold text-xs rounded-xl h-8 px-3 transition-all"
            >
              🔀 Đổi Nick / Chia tải
            </Button>

            <Popconfirm
              title="Xác nhận xóa hàng loạt"
              description={`Bạn có chắc muốn xóa ${selectedRowKeys.length} bài viết này khỏi hàng đợi?`}
              onConfirm={handleBulkDelete}
              okText="Xóa luôn"
              cancelText="Hủy"
              okButtonProps={{ danger: true }}
            >
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                loading={isBulkProcessing}
                className="bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 font-medium text-xs rounded-xl h-8 px-3 transition-all"
              >
                Xóa đã chọn
              </Button>
            </Popconfirm>

            <Button
              size="small"
              type="text"
              icon={<CloseOutlined />}
              onClick={() => setSelectedRowKeys([])}
              className="text-slate-400 hover:text-white text-xs h-8 px-2.5 transition-all"
            >
              Bỏ chọn
            </Button>
          </div>
        </div>
      )}

      {/* THANH BỘ LỌC TRẠNG THÁI CHÍNH (SEGMENTED TABS) - RÕ RÀNG, ĐẦY ĐỦ MÀU SẮC DỄ NHÌN */}
      <div className="p-1.5 mb-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 shadow-inner flex flex-wrap items-center gap-2 backdrop-blur-md">
        {/* 1. Tất cả (Xanh lam) */}
        <button
          type="button"
          onClick={() => setHistoryStatusFilter('ALL')}
          className={`history-status-tab px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer ${
            historyStatusFilter === 'ALL'
              ? 'bg-blue-600/35 border-blue-500 text-blue-100 shadow-md shadow-blue-950/60 ring-2 ring-blue-500/40'
              : 'bg-blue-950/30 border-blue-500/25 text-blue-300 hover:bg-blue-900/45 hover:text-white hover:border-blue-400/50'
          }`}
        >
          <AppstoreOutlined className="text-blue-400 text-sm" />
          <span>Tất cả</span>
          <span
            className={`px-2 py-0.5 text-[11px] rounded-full font-mono font-bold transition-colors ${
              historyStatusFilter === 'ALL'
                ? 'bg-blue-500/40 text-blue-100 border border-blue-300/40 shadow-xs'
                : 'bg-blue-900/50 text-blue-300 border border-blue-500/30'
            }`}
          >
            {postCounts.all.toLocaleString()}
          </span>
        </button>

        {/* 2. Đang đăng (Tím / Indigo) */}
        <button
          type="button"
          onClick={() => setHistoryStatusFilter('PROCESSING')}
          className={`history-status-tab px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer ${
            historyStatusFilter === 'PROCESSING'
              ? 'bg-purple-600/35 border-purple-500 text-purple-100 shadow-md shadow-purple-950/60 ring-2 ring-purple-500/40'
              : 'bg-purple-950/30 border-purple-500/25 text-purple-300 hover:bg-purple-900/45 hover:text-white hover:border-purple-400/50'
          }`}
        >
          <SyncOutlined spin={postCounts.processing > 0} className="text-purple-400 text-sm" />
          <span>Đang đăng</span>
          <span
            className={`px-2 py-0.5 text-[11px] rounded-full font-mono font-bold transition-colors ${
              historyStatusFilter === 'PROCESSING'
                ? 'bg-purple-500/40 text-purple-100 border border-purple-300/40 shadow-xs'
                : 'bg-purple-900/50 text-purple-300 border border-purple-500/30'
            }`}
          >
            {postCounts.processing.toLocaleString()}
          </span>
        </button>

        {/* 3. Chờ đăng (Hổ phách / Vàng cam ấm áp) */}
        <button
          type="button"
          onClick={() => setHistoryStatusFilter('PENDING')}
          className={`history-status-tab px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer ${
            historyStatusFilter === 'PENDING'
              ? 'bg-amber-600/35 border-amber-500 text-amber-100 shadow-md shadow-amber-950/60 ring-2 ring-amber-500/40'
              : 'bg-amber-950/35 border-amber-500/35 text-amber-300 hover:bg-amber-900/50 hover:text-white hover:border-amber-400/60'
          }`}
        >
          <ClockCircleOutlined className="text-amber-400 text-sm" />
          <span>Chờ đăng</span>
          <span
            className={`px-2 py-0.5 text-[11px] rounded-full font-mono font-bold transition-colors ${
              historyStatusFilter === 'PENDING'
                ? 'bg-amber-500/40 text-amber-100 border border-amber-300/50 shadow-xs'
                : 'bg-amber-900/60 text-amber-200 border border-amber-500/40'
            }`}
          >
            {postCounts.pending.toLocaleString()}
          </span>
        </button>

        {/* 4. Đã đăng (Xanh lục Emerald nổi bật) */}
        <button
          type="button"
          onClick={() => setHistoryStatusFilter('PUBLISHED')}
          className={`history-status-tab px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer ${
            historyStatusFilter === 'PUBLISHED'
              ? 'bg-emerald-600/35 border-emerald-500 text-emerald-100 shadow-md shadow-emerald-950/60 ring-2 ring-emerald-500/40'
              : 'bg-emerald-950/35 border-emerald-500/35 text-emerald-300 hover:bg-emerald-900/50 hover:text-white hover:border-emerald-400/60'
          }`}
        >
          <CheckCircleOutlined className="text-emerald-400 text-sm" />
          <span>Đã đăng</span>
          <span
            className={`px-2 py-0.5 text-[11px] rounded-full font-mono font-bold transition-colors ${
              historyStatusFilter === 'PUBLISHED'
                ? 'bg-emerald-500/40 text-emerald-100 border border-emerald-300/50 shadow-xs'
                : 'bg-emerald-900/60 text-emerald-200 border border-emerald-500/40'
            }`}
          >
            {postCounts.published.toLocaleString()}
          </span>
        </button>

        {/* 5. Lỗi đăng (Đỏ Rose cảnh báo) */}
        <button
          type="button"
          onClick={() => setHistoryStatusFilter('FAILED')}
          className={`history-status-tab px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer ${
            historyStatusFilter === 'FAILED'
              ? 'bg-rose-600/35 border-rose-500 text-rose-100 shadow-md shadow-rose-950/60 ring-2 ring-rose-500/40'
              : 'bg-rose-950/30 border-rose-500/30 text-rose-300 hover:bg-rose-900/45 hover:text-white hover:border-rose-400/50'
          }`}
        >
          <CloseCircleOutlined className="text-rose-400 text-sm" />
          <span>Lỗi đăng</span>
          <span
            className={`px-2 py-0.5 text-[11px] rounded-full font-mono font-bold transition-colors ${
              historyStatusFilter === 'FAILED'
                ? 'bg-rose-500/40 text-rose-100 border border-rose-300/40 shadow-xs'
                : 'bg-rose-900/50 text-rose-300 border border-rose-500/30'
            }`}
          >
            {postCounts.failed.toLocaleString()}
          </span>
        </button>
      </div>

      {/* THANH BỘ LỌC PHỤ: LỌC THEO NHÓM/PAGE + Ô TÌM KIẾM TỪ KHÓA */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 mb-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1">
          {/* Lọc theo Nhóm & Fanpage */}
          <Select
            size="middle"
            value={historyGroupFilter}
            onChange={(val) => {
              setHistoryGroupFilter(val);
              setHistoryPageFilter('ALL');
            }}
            className="w-full sm:w-80 rounded-xl font-medium"
            suffixIcon={<TeamOutlined className="text-slate-400" />}
            showSearch
            optionFilterProp="children"
            options={[
              { value: 'ALL', label: 'Tất cả Nhóm & Fanpage' },
              ...groupAccountsWithId.map((g) => {
                const stat = groupStatsMap.get(g.platformAccountId) || EMPTY_GROUP_STAT;
                const groupName = stripEmojiPrefix(g.pageName) || g.platformAccountId;
                return {
                  value: g.platformAccountId,
                  label: `${groupName} · ID ${g.id} (Đã đăng ${stat.publishedToday} · Chờ ${stat.pendingCount} · Lỗi ${stat.failedCount})`,
                };
              }),
            ]}
          />

          {/* Ô tìm kiếm tiêu đề, nội dung, ID */}
          <Input
            size="middle"
            prefix={<SearchOutlined className="text-slate-400" />}
            placeholder="Tìm theo tiêu đề, nội dung hoặc ID..."
            value={historySearchText}
            onChange={(e) => setHistorySearchText(e.target.value)}
            allowClear
            className="rounded-xl flex-1 text-xs"
          />
        </div>

        {(historyGroupFilter !== 'ALL' || historyPageFilter !== 'ALL' || historyStatusFilter !== 'ALL' || historySearchText) && (
          <Button
            size="middle"
            type="text"
            icon={<ReloadOutlined />}
            onClick={() => {
              setHistoryGroupFilter('ALL');
              setHistoryPageFilter('ALL');
              setHistoryStatusFilter('ALL');
              setHistorySearchText('');
            }}
            className="text-slate-300 hover:text-white text-xs rounded-xl border border-slate-700 bg-slate-800/60 hover:bg-slate-700 shrink-0"
          >
            Xóa bộ lọc
          </Button>
        )}
      </div>

      {/* THỐNG KÊ CHI TIẾT THEO TỪNG NHÓM: HÔM NAY ĐÃ ĐĂNG (xanh), CHỜ ĐĂNG (cam), LỖI (đỏ) */}
      {groupAccountsWithId.length > 0 && (() => {
        const totalPublishedToday = groupAccountsWithId.reduce((acc, g) => acc + (groupStatsMap.get(g.platformAccountId)?.publishedToday || 0), 0);
        const totalPending = groupAccountsWithId.reduce((acc, g) => acc + (groupStatsMap.get(g.platformAccountId)?.pendingCount || 0), 0);
        const totalFailed = groupAccountsWithId.reduce((acc, g) => acc + (groupStatsMap.get(g.platformAccountId)?.failedCount || 0), 0);

        return (
          <div className="pb-3 mb-4 border-b border-slate-800/70">
            {/* Thanh điều khiển trên cùng */}
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-[11px] font-bold text-slate-300 shrink-0 shadow-2xs backdrop-blur-sm">
                  <CalendarOutlined className="text-blue-400 text-xs" />
                  <span>Hôm nay</span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setHistoryGroupFilter('ALL');
                    setHistoryPageFilter('ALL');
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 border backdrop-blur-sm cursor-pointer ${
                    historyGroupFilter === 'ALL'
                      ? 'border-blue-500/80 bg-blue-600/25 text-blue-100 shadow-sm shadow-blue-950/40 ring-1 ring-blue-500/30'
                      : 'border-slate-800/80 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:bg-slate-800/70 hover:text-slate-200'
                  }`}
                >
                  <GlobalOutlined className={historyGroupFilter === 'ALL' ? 'text-blue-400' : 'text-slate-400'} />
                  <span>Tất cả ({groupAccountsWithId.length} nhóm)</span>
                </button>

                {/* Thống kê nhanh toàn hệ thống hôm nay */}
                <div className="hidden sm:flex items-center gap-2.5 px-3 py-1 rounded-xl bg-slate-900/50 border border-slate-800/60 text-[11px]">
                  <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                    <CheckCircleFilled className="text-[10px]" />
                    <strong className="font-mono">{totalPublishedToday}</strong> đã đăng
                  </span>
                  <span className="text-slate-700">|</span>
                  <span className="flex items-center gap-1.5 text-amber-300 font-medium">
                    <ClockCircleFilled className="text-[10px]" />
                    <strong className="font-mono">{totalPending}</strong> bài chờ
                    {postCounts.processing > 0 ? (
                      <span className="text-[10px] text-blue-300 font-normal">
                        ({postCounts.pending} chờ + {postCounts.processing} đang chạy)
                      </span>
                    ) : null}
                  </span>
                  {totalFailed > 0 && (
                    <>
                      <span className="text-slate-700">|</span>
                      <span className="flex items-center gap-1.5 text-rose-400 font-medium animate-pulse">
                        <CloseCircleFilled className="text-[10px]" />
                        <strong className="font-mono">{totalFailed}</strong> lỗi
                      </span>
                    </>
                  )}
                </div>
              </div>

              {historyGroupFilter !== 'ALL' && (
                <Button
                  size="small"
                  type="text"
                  icon={<ClearOutlined />}
                  onClick={() => {
                    setHistoryGroupFilter('ALL');
                    setHistoryPageFilter('ALL');
                  }}
                  className="text-xs text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
                >
                  Bỏ chọn nhóm (Xem tất cả)
                </Button>
              )}
            </div>

            {/* Lưới các nhóm dạng Card cao cấp, rộng rãi, dễ đọc */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {groupAccountsWithId.map((g) => {
                const stat = groupStatsMap.get(g.platformAccountId) || EMPTY_GROUP_STAT;
                const isSelected = historyGroupFilter === g.platformAccountId;
                const groupName = stripEmojiPrefix(g.pageName) || g.platformAccountId;

                // Chấm trạng thái tổng quan
                let dotBg = 'bg-slate-600';
                if (stat.failedCount > 0) dotBg = 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)] animate-pulse';
                else if (stat.pendingCount > 0) dotBg = 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]';
                else if (stat.publishedToday > 0) dotBg = 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]';

                const popoverContent = (
                  <div className="p-1 space-y-2 max-w-[320px] text-xs">
                    <div className="font-bold text-slate-100 flex items-center justify-between gap-2 border-b border-slate-700/60 pb-1.5">
                      <span className="truncate">{groupName}</span>
                      <span className="text-slate-400 font-mono text-[10px] shrink-0">#{g.id}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 text-[11px] text-center">
                      <div className="p-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                        <div className="font-bold">{stat.publishedToday}</div>
                        <div className="text-[10px] text-slate-400">Hôm nay</div>
                      </div>
                      <div className="p-1 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                        <div className="font-bold">{stat.pendingCount}</div>
                        <div className="text-[10px] text-slate-400">Chờ đăng</div>
                      </div>
                      <div className="p-1 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">
                        <div className="font-bold">{stat.failedCount}</div>
                        <div className="text-[10px] text-slate-400">Bị lỗi</div>
                      </div>
                    </div>

                    {/* MỐC THỜI GIAN RẢI BÀI (TIMELINE SPREAD & BÀI CUỐI) */}
                    {stat.pendingCount > 0 && stat.lastScheduledAt ? (
                      <div className="p-2 rounded-lg bg-slate-800/90 border border-slate-700/60 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-200">
                          <span className="flex items-center gap-1 text-amber-300">
                            ⏱️ Lịch rải bài trong ngày:
                          </span>
                          {stat.avgGapMinutes ? (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              ~{stat.avgGapMinutes} phút/bài
                            </span>
                          ) : null}
                        </div>

                        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                          <div className="bg-slate-900/80 p-1.5 rounded border border-slate-700/40">
                            <div className="text-[10px] text-slate-400">Bài kế tiếp:</div>
                            <div className="font-mono font-bold text-blue-300 mt-0.5">
                              {stat.nextScheduledAt ? dayjs(stat.nextScheduledAt).format('HH:mm') : '—'}
                            </div>
                          </div>
                          <div className="bg-slate-900/80 p-1.5 rounded border border-slate-700/40">
                            <div className="text-[10px] text-slate-400">Bài cuối cùng:</div>
                            <div className="font-mono font-bold text-amber-300 mt-0.5">
                              🏁 {stat.todayFinishTimeText || '—'}
                            </div>
                          </div>
                        </div>

                        {stat.hourlySlots && stat.hourlySlots.length > 0 && (
                          <div className="pt-1 border-t border-slate-700/40">
                            <div className="text-[10px] text-slate-400 mb-1">
                              📊 Khung giờ rải bài (không dồn 1 cục):
                            </div>
                            <div className="flex flex-wrap gap-1 max-h-[85px] overflow-y-auto pr-0.5">
                              {stat.hourlySlots.map((slot, sIdx) => (
                                <span
                                  key={sIdx}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-900/90 text-slate-300 border border-slate-700/60 flex items-center gap-1"
                                >
                                  <span className="text-blue-400 font-semibold">{slot.hour}:</span>
                                  <span className="text-amber-300 font-bold">{slot.count} bài</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}

                    {stat.pendingPagesList && stat.pendingPagesList.length > 0 ? (
                      <div className="space-y-1 pt-1 border-t border-slate-700/40">
                        <div className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
                          <span>📄 Phân bổ Page chờ đăng:</span>
                          <span className="text-amber-300 font-mono font-bold">{stat.pendingCount} bài</span>
                        </div>
                        <div className="space-y-1 max-h-[110px] overflow-y-auto pr-0.5">
                          {stat.pendingPagesList.map((p, idx) => {
                            const pal = PAGE_PALETTE[idx % PAGE_PALETTE.length];
                            return (
                              <div key={idx} className="flex items-center justify-between text-[11px] bg-slate-800/70 px-2 py-1 rounded-md border border-slate-700/50">
                                <span className="truncate max-w-[170px] text-slate-200 flex items-center gap-1.5">
                                  <span className={`w-2 h-2 rounded-full ${pal.bg} shrink-0`} />
                                  {p.isAnon ? '👤 ' : ''}{p.pageName}
                                </span>
                                <span className="font-mono font-bold text-amber-300 shrink-0 ml-1">
                                  {p.count} bài ({p.percent}%)
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-400 italic text-center py-1">
                        ✓ Hiện không có bài nào chờ đăng
                      </div>
                    )}
                  </div>
                );

                return (
                  <Popover
                    key={g.id}
                    trigger="hover"
                    placement="bottom"
                    mouseEnterDelay={0.25}
                    content={popoverContent}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setHistoryGroupFilter(isSelected ? 'ALL' : g.platformAccountId);
                        setHistoryPageFilter('ALL');
                      }}
                      className={`group relative text-left w-full p-2.5 rounded-xl border transition-all duration-200 cursor-pointer backdrop-blur-md flex flex-col justify-between min-h-[58px] gap-1.5 ${
                        isSelected
                          ? 'border-blue-500 bg-gradient-to-br from-blue-950/70 via-slate-900/90 to-blue-900/40 text-white shadow-lg shadow-blue-950/50 ring-1 ring-blue-500/50'
                          : 'border-slate-800/80 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-850 text-slate-300 hover:text-white shadow-2xs'
                      }`}
                    >
                      {/* Dòng 1: Tên nhóm, ID và các Badge số lượng */}
                      <div className="flex items-center justify-between gap-2 min-w-0 w-full">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${dotBg}`} />
                          <span className="truncate text-xs font-semibold group-hover:text-blue-200 transition-colors" title={groupName}>
                            {groupName}
                          </span>
                          <span className="text-slate-400 font-mono text-[10px] px-1 py-0.2 rounded bg-slate-800/80 border border-slate-700/50 shrink-0">
                            #{g.id}
                          </span>
                        </div>

                        {/* Badges số lượng bài */}
                        <div className="flex items-center gap-1 shrink-0">
                          {stat.publishedToday > 0 && (
                            <span
                              className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-1"
                              title={`Hôm nay đã đăng ${stat.publishedToday} bài`}
                            >
                              <CheckCircleFilled className="text-[9px]" /> {stat.publishedToday}
                            </span>
                          )}

                          {stat.pendingCount > 0 && (
                            <span
                              className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/25 flex items-center gap-1"
                              title={`Đang chờ đăng: ${stat.pendingCount} bài (Bài cuối: ${stat.todayFinishTimeText || '—'})`}
                            >
                              <ClockCircleFilled className="text-[9px]" /> {stat.pendingCount}
                            </span>
                          )}

                          {stat.failedCount > 0 && (
                            <span
                              className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/35 flex items-center gap-1"
                              title={`Bài bị lỗi: ${stat.failedCount} bài`}
                            >
                              <CloseCircleFilled className="text-[9px]" /> {stat.failedCount}
                            </span>
                          )}

                          {stat.publishedToday === 0 && stat.pendingCount === 0 && stat.failedCount === 0 && (
                            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono text-slate-500 bg-slate-800/40 border border-slate-700/30">
                              0
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Dòng 2: Mốc thời gian & Tốc độ rải bài */}
                      <div className="flex items-center justify-between gap-1 w-full text-[11px] pt-1.5 border-t border-slate-800/60">
                        {stat.pendingCount > 0 && stat.todayFinishTimeText ? (
                          <>
                            <span className="text-amber-300/95 font-mono text-[10.5px] font-medium flex items-center gap-1 truncate">
                              <ClockCircleOutlined className="text-[10px] text-amber-400 shrink-0" />
                              <span>Xong {stat.todayFinishTimeText}</span>
                            </span>
                            {stat.avgGapMinutes ? (
                              <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 px-1.5 py-0.2 rounded border border-slate-700/40 shrink-0">
                                ~{stat.avgGapMinutes}p/bài
                              </span>
                            ) : null}
                          </>
                        ) : stat.publishedToday > 0 ? (
                          <span className="text-emerald-400/90 text-[10.5px] font-medium flex items-center gap-1">
                            <CheckOutlined className="text-[10px]" /> Hoàn tất hôm nay
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[10.5px]">Chưa lên lịch</span>
                        )}
                      </div>
                    </button>
                  </Popover>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* BẢNG PHÂN BỔ PAGE ĐANG CHỜ ĐĂNG TRONG PHẠM VI (FANPAGE PENDING DISTRIBUTION BAR) */}
      {currentPendingDistribution.totalPending > 0 && (
        <div className="p-4 mb-4 rounded-2xl bg-gradient-to-b from-slate-900/95 via-slate-900/80 to-slate-950/95 border border-slate-800/80 shadow-xl backdrop-blur-md transition-all">
          {/* Dòng tiêu đề & hành động */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500/20 via-orange-500/20 to-amber-600/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 shadow-sm shadow-amber-950/30">
                <ApartmentOutlined className="text-base" />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-100 tracking-wide uppercase">Phân bổ Page chờ đăng:</span>
                <span className="text-xs font-semibold text-sky-300 bg-sky-500/15 px-2.5 py-0.5 rounded-lg border border-sky-400/30 truncate max-w-[260px] flex items-center gap-1.5 shadow-2xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                  {currentPendingDistribution.scopeTitle}
                </span>
                <span className="text-[11px] font-mono font-bold text-amber-300 bg-amber-500/15 px-2.5 py-0.5 rounded-lg border border-amber-400/30 shadow-2xs">
                  {currentPendingDistribution.totalPending.toLocaleString()} bài chờ
                </span>
                {historyPageFilter !== 'ALL' && (
                  <span className="text-[11px] font-semibold text-purple-200 bg-purple-500/20 px-2.5 py-0.5 rounded-lg border border-purple-400/30 flex items-center gap-1.5 shadow-2xs">
                    <span>Đang lọc:</span>
                    <strong className="text-white">{historyPageFilter}</strong>
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              {historyPageFilter !== 'ALL' && (
                <Button
                  size="small"
                  type="text"
                  icon={<ClearOutlined />}
                  onClick={() => setHistoryPageFilter('ALL')}
                  className="text-xs text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 rounded-xl h-8 px-2.5 font-medium transition-all"
                >
                  Bỏ lọc Page
                </Button>
              )}
              {(historyGroupFilter !== 'ALL' || historyPageFilter !== 'ALL' || historySearchText.trim() !== '') && (
              <Button
                size="small"
                icon={<ScheduleOutlined />}
                onClick={() => {
                  const targetIds = filteredHistoryPosts
                    .filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING')
                    .map((p) => p.id);
                  if (targetIds.length > 0) {
                    setSelectedRowKeys(targetIds);
                    setBulkRescheduleTargetScope('SELECTED');
                    setBulkRescheduleModalVisible(true);
                    message.info(`Đã chọn ${targetIds.length} bài chờ đăng đang lọc để chia lại giờ.`);
                  } else {
                    setBulkRescheduleTargetScope('ALL');
                    setBulkRescheduleModalVisible(true);
                  }
                }}
                className="text-xs h-8 px-3"
              >
                Chia lại giờ các bài đang lọc
              </Button>
              )}
            </div>
          </div>

          {/* Thanh thước đo tỷ lệ phân bổ trực quan (Multi-segment progress bar) */}
          {currentPendingDistribution.pagesList.length > 0 && (
            <div className="my-3">
              <div className="h-2.5 w-full rounded-full bg-slate-950/90 p-0.5 flex gap-[2px] overflow-hidden border border-slate-800/90 shadow-inner">
                {currentPendingDistribution.pagesList.map((p, idx) => {
                  const palette = PAGE_PALETTE[idx % PAGE_PALETTE.length];
                  const isFilterActive = historyPageFilter === p.pageName;
                  return (
                    <Tooltip key={idx} title={`${p.pageName}: ${p.count} bài (${p.percent}%) - Click để lọc`}>
                      <div
                        style={{ width: `${Math.max(p.percent, 3)}%` }}
                        className={`h-full transition-all cursor-pointer ${palette.bg} ${historyPageFilter === 'ALL' || isFilterActive ? 'opacity-100 brightness-105' : 'opacity-25'
                          } hover:brightness-125 hover:scale-y-110 rounded-xs ${idx === 0 ? 'rounded-l-full' : ''} ${idx === currentPendingDistribution.pagesList.length - 1 ? 'rounded-r-full' : ''
                          }`}
                        onClick={() => setHistoryPageFilter(historyPageFilter === p.pageName ? 'ALL' : p.pageName)}
                      />
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          )}

          {/* Thanh điều khiển lọc: Lọc bài theo Page + Nút Tất cả */}
          <div className="flex items-center justify-between gap-2 pt-1 pb-2">
            <div className="flex items-center gap-2">
              <AimOutlined className="text-sky-400 text-xs" />
              <span className="text-xs font-bold text-slate-200 tracking-wide">
                Lọc bài theo Page:
              </span>
              <span className="text-[11px] text-slate-500 font-medium">
                ({currentPendingDistribution.pagesList.length} Page/Nick)
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setHistoryPageFilter('ALL')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 border cursor-pointer ${historyPageFilter === 'ALL'
                    ? 'border-blue-500/80 bg-blue-600/30 text-blue-200 shadow-sm ring-1 ring-blue-500/30'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
              >
                <span>Xem tất cả ({currentPendingDistribution.totalPending.toLocaleString()})</span>
              </button>

              {currentPendingDistribution.totalPending > 0 && (
                <Button
                  type="primary"
                  size="small"
                  icon={<ThunderboltFilled />}
                  onClick={() => setAutoFixQueueModalVisible(true)}
                  className="bg-gradient-to-r from-emerald-600 via-teal-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 font-bold text-xs rounded-lg shadow-md border-0"
                >
                  ⚡ Tự động xếp lại lịch ({currentPendingDistribution.totalPending} bài)
                </Button>
              )}
            </div>
          </div>

          {/* Danh sách các card Page chia lưới ngay hàng thẳng lối (CSS Grid) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            {currentPendingDistribution.pagesList.map((p, idx) => {
              const palette = PAGE_PALETTE[idx % PAGE_PALETTE.length];
              const isActive = historyPageFilter === p.pageName;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setHistoryPageFilter(isActive ? 'ALL' : p.pageName)}
                  className={`group relative flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs transition-all border text-left cursor-pointer backdrop-blur-sm ${isActive
                      ? 'border-blue-400/90 bg-blue-600/25 text-white font-semibold ring-1 ring-blue-400/60 shadow-md shadow-blue-950/40'
                      : 'border-slate-800/80 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900/90 hover:text-white'
                    }`}
                  title={`${p.pageName}: ${p.count} bài (${p.percent}%) - Click để ${isActive ? 'bỏ lọc' : 'lọc bài'}`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${palette.bg} ${isActive ? 'ring-2 ring-white/60' : ''}`} />
                    <span className="text-xs shrink-0 text-slate-400">{p.isAnon ? '👤' : '📄'}</span>
                    <span className="truncate font-medium text-slate-200 group-hover:text-white">
                      {p.pageName}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 font-mono text-[11px]">
                    <span className={`font-bold ${isActive ? 'text-blue-200' : 'text-slate-200'}`}>{p.count}</span>
                    <span className="text-[10px] text-slate-500">({p.percent}%)</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Cảnh báo dồn tải nếu 1 Page gánh quá nhiều bài */}
          {currentPendingDistribution.pagesList.length > 1 &&
            currentPendingDistribution.pagesList[0].percent >= 60 &&
            currentPendingDistribution.totalPending >= 4 && (
              <div className="mt-3 px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-200/90 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <WarningOutlined className="text-amber-400 text-sm shrink-0" />
                  <span>
                    <strong className="text-amber-300">Chú ý lệch tải:</strong> Page <strong className="text-white">{currentPendingDistribution.pagesList[0].pageName}</strong> đang gánh{' '}
                    <span className="font-mono font-bold text-amber-300">{currentPendingDistribution.pagesList[0].count}/{currentPendingDistribution.totalPending}</span> bài ({currentPendingDistribution.pagesList[0].percent}%).
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const heavyPageName = currentPendingDistribution.pagesList[0].pageName;
                    const targetIds = filteredHistoryPosts
                      .filter(
                        (p) =>
                          (p.status === 'PENDING' || p.status === 'PROCESSING') &&
                          (resolvePosterIdentityName(p) || 'Chưa gán Page') === heavyPageName
                      )
                      .map((p) => p.id);
                    if (targetIds.length > 0) {
                      setSelectedRowKeys(targetIds);
                      setBulkRescheduleTargetScope('SELECTED');
                      setBulkRescheduleModalVisible(true);
                      message.info(`🎯 Đã chọn ${targetIds.length} bài của "${heavyPageName}". Hãy chọn thêm Page/Nick khác để chia đều!`);
                    }
                  }}
                  className="text-[11px] font-bold text-amber-300 hover:text-white underline cursor-pointer shrink-0 transition-colors"
                >
                  ⚡ Chọn {currentPendingDistribution.pagesList[0].count} bài này để chia lại
                </button>
              </div>
            )}
        </div>
      )}

      <Table
        className="history-table"
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        columns={columns}
        dataSource={filteredHistoryPosts}
        rowKey="id"
        loading={isLoading}
        locale={{ emptyText: 'Chưa có bài đăng nào khớp với bộ lọc hiện tại' }}
        pagination={{
          current: historyTablePage.current,
          pageSize: historyTablePage.pageSize,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
          onChange: (current, pageSize) => setHistoryTablePage({ current, pageSize }),
        }}
        scroll={{ x: 720 }}
        sticky={{ offsetHeader: 0 }}
        rowClassName={(record: PostQueue) =>
          `history-row history-row-${(record.status || 'PENDING').toLowerCase()}`
        }
      />
    </Card>
  );
}
