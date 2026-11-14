import { memo } from 'react';
import type React from 'react';
import {
  Button,
  Input,
  Select,
  Tag,
  Checkbox,
  Tooltip,
  Alert,
  Drawer,
  App,
} from 'antd';
import { PlusOutlined, RocketOutlined, SearchOutlined } from '@ant-design/icons';
import type { ScrapedNewsPreviewItem, CustomNewsChannel } from './types';

const { Option } = Select;

interface ArticleBatchModalProps {
  showArticleBatchModal: boolean;
  setShowArticleBatchModal: React.Dispatch<React.SetStateAction<boolean>>;
  articleBatchUrlsText: string;
  setArticleBatchUrlsText: React.Dispatch<React.SetStateAction<string>>;
  articleBatchEnableAi: boolean;
  setArticleBatchEnableAi: React.Dispatch<React.SetStateAction<boolean>>;
  articleBatchAiStyle: string;
  setArticleBatchAiStyle: React.Dispatch<React.SetStateAction<string>>;
  isScrapingArticleBatch: boolean;
  customCategoryInputUrl: string;
  setCustomCategoryInputUrl: React.Dispatch<React.SetStateAction<string>>;
  scrapedNewsItems: ScrapedNewsPreviewItem[];
  setScrapedNewsItems: React.Dispatch<React.SetStateAction<ScrapedNewsPreviewItem[]>>;
  activeCategoryTab: string;
  setActiveCategoryTab: React.Dispatch<React.SetStateAction<string>>;
  setShowRawUrlArea: React.Dispatch<React.SetStateAction<boolean>>;
  showRawUrlArea: boolean;
  setShowChannelUrlList: React.Dispatch<React.SetStateAction<boolean>>;
  showChannelUrlList: boolean;
  isRadarSweeping: boolean;
  radarAutoRefresh: boolean;
  setRadarAutoRefresh: React.Dispatch<React.SetStateAction<boolean>>;
  radarAutoRefreshMinutes: number;
  setRadarAutoRefreshMinutes: React.Dispatch<React.SetStateAction<number>>;
  radarLastSweepTime: string;
  radarSearchKeyword: string;
  setRadarSearchKeyword: React.Dispatch<React.SetStateAction<string>>;
  customChannels: CustomNewsChannel[];
  setShowAddChannelModal: React.Dispatch<React.SetStateAction<boolean>>;
  setNewChannelCategory: React.Dispatch<React.SetStateAction<"bds" | "tech" | "finance" | "health" | "other">>;
  handleDeleteCustomChannel: (id: string, name: string) => void;
  handleNewsDragStart: (url: string) => void;
  handleNewsDrop: (targetUrl: string) => void;
  handleFetchCategoryPreset: (categoryUrl: string) => Promise<void>;
  handleFetchRssPreset: (rssUrl: string) => Promise<void>;
  handleRunRadarSweep: (cat?: string) => Promise<void>;
  handleBatchScrapeArticlesToForm: (overrideUrls?: string[]) => Promise<void>;
}

// Modal săn tin tức & cào bài báo hàng loạt — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
function ArticleBatchModal({
  showArticleBatchModal,
  setShowArticleBatchModal,
  articleBatchUrlsText,
  setArticleBatchUrlsText,
  articleBatchEnableAi,
  setArticleBatchEnableAi,
  articleBatchAiStyle,
  setArticleBatchAiStyle,
  isScrapingArticleBatch,
  customCategoryInputUrl,
  setCustomCategoryInputUrl,
  scrapedNewsItems,
  setScrapedNewsItems,
  activeCategoryTab,
  setActiveCategoryTab,
  setShowRawUrlArea,
  showRawUrlArea,
  setShowChannelUrlList,
  showChannelUrlList,
  isRadarSweeping,
  radarAutoRefresh,
  setRadarAutoRefresh,
  radarAutoRefreshMinutes,
  setRadarAutoRefreshMinutes,
  radarLastSweepTime,
  radarSearchKeyword,
  setRadarSearchKeyword,
  customChannels,
  setShowAddChannelModal,
  setNewChannelCategory,
  handleDeleteCustomChannel,
  handleNewsDragStart,
  handleNewsDrop,
  handleFetchCategoryPreset,
  handleFetchRssPreset,
  handleRunRadarSweep,
  handleBatchScrapeArticlesToForm,
}: ArticleBatchModalProps) {
  const { message } = App.useApp();
  return (
    <Drawer
      title={
        <div className="flex items-center justify-between text-base font-bold text-slate-100 pr-6">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📰</span>
            <span className="text-lg">Hệ Thống Săn Tin Tức Tự Động 24/7 & AI Biên Tập Đa Lĩnh Vực</span>
          </div>
          <Tag color="purple" className="font-bold border-0 text-xs px-3 py-1 rounded-lg">
            Giao Diện 95% Màn Hình Rộng Rãi
          </Tag>
        </div>
      }
      open={showArticleBatchModal}
      onClose={() => setShowArticleBatchModal(false)}
      size="95vw"
      destroyOnClose
      className="dark-theme-drawer"
      extra={
        <Button
          type="primary"
          icon={<RocketOutlined />}
          loading={isScrapingArticleBatch}
          onClick={() => handleBatchScrapeArticlesToForm()}
          className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border-0 font-bold rounded-xl h-9 px-5 text-sm"
        >
          🚀 Cào & Nạp {scrapedNewsItems.filter(i => i.selected).length > 0 ? `${scrapedNewsItems.filter(i => i.selected).length} Bài Đã Chọn` : 'Các Bài Báo'} Vào Form Đăng
        </Button>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-slate-200">
        {/* CỘT TRÁI (lg:col-span-5): CHỌN CHỦ ĐỀ, KÊNH BÁO VÀ CẤU HÌNH AI */}
        <div className="lg:col-span-5 space-y-4">
          <Alert
            type="info"
            showIcon
            message="Hệ thống cào tin tức Đa Lĩnh Vực: Tự động bóc tách full nội dung & album ảnh từ bất kỳ trang báo hay chuyên mục nào"
            description="Hỗ trợ BĐS, Công nghệ, Tài chính, Thể thao, Sức khỏe... trên CafeF, VnExpress, Tuoitre, Dantri, Batdongsan, ZNews..."
            className="!bg-blue-950/60 !border-blue-700/50 !text-blue-200 rounded-2xl"
          />

          {/* Thanh Giám Sát Tin Tức Rada 24/7 */}
          <div className="p-4 bg-gradient-to-r from-blue-950/80 via-indigo-950/80 to-slate-900 rounded-2xl border border-blue-700/60 shadow-lg space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-blue-200 flex items-center gap-1.5 uppercase tracking-wider">
                  <span className="animate-pulse text-emerald-400">📡</span> RADA THEO DÕI TIN TỨC MỚI 24/7:
                </span>
                {radarLastSweepTime && (
                  <Tag color="cyan" className="!text-xs font-bold border-0 px-2.5 py-0.5 rounded-full">
                    Vừa quét: {radarLastSweepTime}
                  </Tag>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={radarAutoRefresh}
                  onChange={(e) => {
                    setRadarAutoRefresh(e.target.checked);
                    if (e.target.checked) {
                      message.info(`⚡ Đã bật Tự động quét lại toàn bộ kênh mỗi ${radarAutoRefreshMinutes} phút`);
                    }
                  }}
                  className="text-xs text-blue-300 font-bold"
                >
                  ⚡ Quét tự động
                </Checkbox>
                <Select
                  size="small"
                  value={radarAutoRefreshMinutes}
                  onChange={(v) => setRadarAutoRefreshMinutes(v)}
                  disabled={!radarAutoRefresh}
                  className="w-24"
                  title="Chu kỳ tự động cào lại — chọn thưa hơn để đỡ tốn tài nguyên máy"
                >
                  <Option value={5}>5 phút</Option>
                  <Option value={15}>15 phút</Option>
                  <Option value={30}>30 phút</Option>
                  <Option value={60}>60 phút</Option>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 border-t border-blue-900/60 text-xs">
              <Input
                size="small"
                placeholder="🔍 Lọc tin theo từ khóa (VD: quy hoạch, chung cư, AI, giá đất...)..."
                value={radarSearchKeyword}
                onChange={(e) => setRadarSearchKeyword(e.target.value)}
                allowClear
                className="text-xs bg-slate-950/80 border-slate-700 text-slate-100 rounded-xl flex-1"
              />
              <Button
                type="primary"
                icon={<SearchOutlined />}
                loading={isRadarSweeping}
                onClick={() => handleRunRadarSweep()}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 font-bold text-xs rounded-xl h-8 px-3 border-0 shrink-0 shadow-md"
              >
                {isRadarSweeping ? 'Đang Quét Radar...' : '📡 Quét Đa Kênh Ngay'}
              </Button>
            </div>
          </div>

          {/* Tab Chọn Chủ Đề & Kênh Báo */}
          <div className="p-4 bg-slate-900/90 rounded-2xl border border-slate-800 space-y-4 shadow-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5 uppercase tracking-wider">
                <span>🎯 1. Chọn Chủ Đề & Kênh Báo Muốn Quét:</span>
              </span>
            </div>

            {/* Sub-tabs category selection */}
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="middle"
                type={activeCategoryTab === 'pickleball' ? 'primary' : 'default'}
                onClick={() => setActiveCategoryTab('pickleball')}
                className={`text-xs font-bold rounded-xl ${activeCategoryTab === 'pickleball' ? 'bg-emerald-600 border-0 shadow-md' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
              >
                🏓 Pickleball (Mới)
              </Button>
              <Button
                size="middle"
                type={activeCategoryTab === 'finance' ? 'primary' : 'default'}
                onClick={() => setActiveCategoryTab('finance')}
                className={`text-xs font-bold rounded-xl ${activeCategoryTab === 'finance' ? 'bg-amber-600 border-0 shadow-md' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
              >
                📈 Tài Chính & Kinh Tế
              </Button>
              <Button
                size="middle"
                type={activeCategoryTab === 'lifestyle' ? 'primary' : 'default'}
                onClick={() => setActiveCategoryTab('lifestyle')}
                className={`text-xs font-bold rounded-xl ${activeCategoryTab === 'lifestyle' ? 'bg-rose-600 border-0 shadow-md' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
              >
                📰 Báo Lớn & Thời Sự
              </Button>
              <Button
                size="middle"
                type={activeCategoryTab === 'bds' ? 'primary' : 'default'}
                onClick={() => setActiveCategoryTab('bds')}
                className={`text-xs font-bold rounded-xl ${activeCategoryTab === 'bds' ? 'bg-orange-600 border-0 shadow-md' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
              >
                🏢 Bất Động Sản
              </Button>
              <Button
                size="middle"
                type={activeCategoryTab === 'tech' ? 'primary' : 'default'}
                onClick={() => setActiveCategoryTab('tech')}
                className={`text-xs font-bold rounded-xl ${activeCategoryTab === 'tech' ? 'bg-purple-600 border-0 shadow-md' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
              >
                💻 Công Nghệ & AI
              </Button>
              <Button
                size="middle"
                type={activeCategoryTab === 'health' ? 'primary' : 'default'}
                onClick={() => setActiveCategoryTab('health')}
                className={`text-xs font-bold rounded-xl ${activeCategoryTab === 'health' ? 'bg-teal-600 border-0 shadow-md' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
              >
                🏥 Sức Khỏe
              </Button>
              <Button
                size="middle"
                type={activeCategoryTab === 'custom' ? 'primary' : 'default'}
                onClick={() => setActiveCategoryTab('custom')}
                className={`text-xs font-bold rounded-xl ${activeCategoryTab === 'custom' ? 'bg-blue-600 border-0 shadow-md' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
              >
                🌐 Chuyên Mục Tùy Chỉnh
              </Button>
            </div>

            {/* Danh sách Kênh Báo Động theo Tab */}
            <div className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 font-bold text-xs">Kênh Báo Uy Tín 1-click (Bấm để quét):</span>
                  <Button
                    size="small"
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setNewChannelCategory((activeCategoryTab as any) || 'bds');
                      setShowAddChannelModal(true);
                    }}
                    className="text-xs text-blue-300 border-blue-600/60 hover:bg-blue-950/50 rounded-lg font-semibold"
                  >
                    + Thêm Kênh Mới
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1">
                  {customChannels
                    .filter((c) => c.category === activeCategoryTab && c.type === 'category')
                    .map((ch) => (
                      <Tooltip
                        key={ch.id}
                        title={
                          <div className="text-xs p-0.5">
                            <div className="font-bold text-blue-300">{ch.name}</div>
                            <div className="font-mono text-xs text-slate-200 break-all">{ch.url}</div>
                          </div>
                        }
                        placement="top"
                      >
                        <Tag
                          color="blue"
                          closable={!ch.id.startsWith('def_')}
                          onClose={(e) => {
                            e.stopPropagation();
                            handleDeleteCustomChannel(ch.id, ch.name);
                          }}
                          className="cursor-pointer hover:opacity-80 font-bold px-3 py-1 rounded-xl my-0.5 text-xs inline-flex items-center gap-1 shadow-xs border-0"
                          onClick={() => handleFetchCategoryPreset(ch.url)}
                        >
                          <span>{ch.name}</span>
                        </Tag>
                      </Tooltip>
                    ))}
                </div>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-slate-800">
                <span className="text-emerald-400 font-bold text-xs">📡 RSS Feed 24/7 (Cập nhật cực nhanh):</span>
                <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1">
                  {customChannels
                    .filter((c) => c.category === activeCategoryTab && c.type === 'rss')
                    .map((ch) => (
                      <Tooltip
                        key={ch.id}
                        title={
                          <div className="text-xs p-0.5">
                            <div className="font-bold text-emerald-300">{ch.name}</div>
                            <div className="font-mono text-xs text-slate-200 break-all">{ch.url}</div>
                          </div>
                        }
                        placement="top"
                      >
                        <Tag
                          color="green"
                          closable={!ch.id.startsWith('def_')}
                          onClose={(e) => {
                            e.stopPropagation();
                            handleDeleteCustomChannel(ch.id, ch.name);
                          }}
                          className="cursor-pointer hover:opacity-80 font-bold px-2.5 py-0.5 rounded-xl my-0.5 text-xs inline-flex items-center gap-1 border-0"
                          onClick={() => handleFetchRssPreset(ch.url)}
                        >
                          <span>{ch.name}</span>
                        </Tag>
                      </Tooltip>
                    ))}
                </div>
              </div>

              {/* Nút Xem Chi Tiết URL Khai Báo */}
              <div className="pt-2 border-t border-slate-800/80">
                <Button
                  type="link"
                  size="small"
                  icon={<SearchOutlined />}
                  onClick={() => setShowChannelUrlList(!showChannelUrlList)}
                  className="p-0 text-xs text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1"
                >
                  {showChannelUrlList ? '▼ Ẩn danh sách đường link URL khai báo' : '🔍 Xem chi tiết đường link URL khai báo cho từng kênh nút bấm'}
                </Button>

                {showChannelUrlList && (
                  <div className="mt-2.5 p-3 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2">
                    <div className="text-xs font-bold text-slate-200 pb-1 border-b border-slate-800/80 flex items-center justify-between">
                      <span>🔗 ĐƯỜNG LINK KHAI BÁO CỦA CÁC KÊNH [{activeCategoryTab.toUpperCase()}]:</span>
                      <span className="text-xs text-slate-300 font-normal">Rê chuột vào nút bấm để xem nhanh</span>
                    </div>
                    <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                      {customChannels
                        .filter((c) => c.category === activeCategoryTab)
                        .map((ch) => (
                          <div key={ch.id} className="flex items-center justify-between gap-2 p-2 bg-slate-900/60 rounded-lg border border-slate-800/50 text-xs">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-100 text-xs truncate">{ch.name}</span>
                                <Tag color={ch.type === 'rss' ? 'green' : 'blue'} className="!text-xs border-0 px-1.5 py-0.5 rounded">
                                  {ch.type === 'rss' ? 'RSS 24/7' : 'Web Scraper'}
                                </Tag>
                              </div>
                              <a
                                href={ch.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-mono text-blue-400 hover:underline truncate block"
                              >
                                {ch.url}
                              </a>
                            </div>
                            <Button
                              size="small"
                              type="text"
                              onClick={() => {
                                navigator.clipboard.writeText(ch.url);
                                message.success(`Đã copy link của ${ch.name}`);
                              }}
                              className="text-xs text-slate-300 hover:text-white hover:bg-slate-800 rounded px-2 h-7 shrink-0"
                            >
                              Copy Link
                            </Button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {activeCategoryTab === 'custom' && (
              <div className="space-y-2 pt-3 border-t border-slate-800">
                <label className="block text-xs font-semibold text-slate-300">
                  Dán đường link Chuyên mục báo hoặc luồng RSS bất kỳ:
                </label>
                <div className="flex gap-2">
                  <Input
                    placeholder="VD: https://vnexpress.net/oto-xe-may hoặc https://cafef.vn/thi-truong.chn"
                    value={customCategoryInputUrl}
                    onChange={(e) => setCustomCategoryInputUrl(e.target.value)}
                    className="text-xs bg-slate-950 border-slate-700 text-slate-100 rounded-xl"
                  />
                  <Button
                    type="primary"
                    icon={<SearchOutlined />}
                    onClick={() => {
                      if (!customCategoryInputUrl.trim()) {
                        message.warning('Vui lòng dán đường link chuyên mục!');
                        return;
                      }
                      if (customCategoryInputUrl.includes('.rss')) {
                        handleFetchRssPreset(customCategoryInputUrl.trim());
                      } else {
                        handleFetchCategoryPreset(customCategoryInputUrl.trim());
                      }
                    }}
                    className="bg-blue-600 hover:bg-blue-500 font-bold text-xs rounded-xl h-9 px-4 shrink-0 border-0"
                  >
                    Quét 10 bài mới nhất
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Cấu hình Gemini AI biên tập bài */}
          <div className="p-4 bg-slate-900/90 rounded-2xl border border-slate-800 space-y-3 shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5 uppercase tracking-wider">
                🤖 2. Cấu Hình Gemini AI Biên Tập Bài Viết:
              </span>
              <Checkbox
                checked={articleBatchEnableAi}
                onChange={(e) => setArticleBatchEnableAi(e.target.checked)}
                className="text-xs text-slate-300 font-bold"
              >
                Bật AI Viết Lại (Tắt = Giữ 100% nguyên văn bài gốc)
              </Checkbox>
            </div>

            {articleBatchEnableAi && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Phong cách biên tập lại nội dung:
                </label>
                <Select
                  value={articleBatchAiStyle}
                  onChange={(val) => setArticleBatchAiStyle(val)}
                  className="w-full text-xs"
                  options={[
                    { label: '🏓 [Group Pickleball] Tranh Luận & Thảo Luận Sôi Nổi (Kéo 100+ Bình Luận)', value: 'PICKLEBALL_GROUP_DEBATE' },
                    { label: '🏓 [Group Pickleball] Chia Sẻ Kỹ Thuật, Mẹo Dink/Drop & Luật Chơi', value: 'PICKLEBALL_TIPS_TECH' },
                    { label: '🏓 [Group Pickleball] Review Vợt Carbon, Giày & Dụng Cụ Sân Bãi', value: 'PICKLEBALL_GEAR_REVIEW' },
                    { label: '🏓 [Group Pickleball] Tin Nóng Giải Đấu (PPA/World Cup) & Tuyển Thủ', value: 'PICKLEBALL_TOURNAMENT' },
                    { label: '🏓 [Group Pickleball] Mẫu Bài Tìm Kèo Ghép Sân & Giao Lưu CLB', value: 'PICKLEBALL_FIND_MATCH' },
                    { label: '🔥 Bài viết Fanpage chuyên nghiệp (Icon + Call-to-Action)', value: 'FANPAGE_POST' },
                    { label: '🏢 Bài đăng Nhóm FB Mua Bán / Chia Sẻ Kinh Nghiệm', value: 'GROUP_SALE' },
                    { label: '📊 Phân tích chuyên sâu cho Chuyên gia', value: 'EXPERT_ANALYSIS' },
                    { label: '⚡ Kịch bản ngắn Tik Tok / Reels / Shorts', value: 'TIKTOK_SCRIPT' },
                    { label: '📲 Tóm tắt tin nhanh gửi Zalo / Telegram', value: 'ZALO_TELEGRAM' },
                    { label: '📰 Tóm tắt tin tức ngắn gọn chính xác', value: 'NEWS_SUMMARY' },
                  ]}
                />
              </div>
            )}
          </div>

          {/* Toggle xem URL thô nâng cao */}
          <div className="p-3 bg-slate-900/90 rounded-2xl border border-slate-800">
            <Button
              type="link"
              size="small"
              onClick={() => setShowRawUrlArea(!showRawUrlArea)}
              className="p-0 text-xs text-slate-400 hover:text-slate-200 font-bold"
            >
              {showRawUrlArea ? '▼ Ẩn danh sách đường link URL thô' : '▶ Xem / Sửa danh sách đường link URL thô'}
            </Button>

            {showRawUrlArea && (
              <div className="mt-2">
                <Input.TextArea
                  rows={4}
                  placeholder="Dán danh sách các đường link bài báo chi tiết tại đây (mỗi link 1 dòng)..."
                  value={articleBatchUrlsText}
                  onChange={(e) => setArticleBatchUrlsText(e.target.value)}
                  className="font-mono text-xs bg-slate-950 border-slate-800 text-slate-100 rounded-xl"
                />
              </div>
            )}
          </div>
        </div>

        {/* CỘT PHẢI (lg:col-span-7): DANH SÁCH XEM TRƯỚC BÀI BÁO DẠNG LƯỚI 2 CỘT RỘNG RÃI */}
        <div className="lg:col-span-7 p-4 bg-slate-900/90 rounded-2xl border border-slate-800 space-y-3 flex flex-col h-full shadow-md">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <label className="block text-xs font-bold text-slate-200 flex items-center gap-2 uppercase tracking-wider">
              <span>📋 Danh sách bài báo đã cào (cộng dồn liên tục):</span>
              {scrapedNewsItems.length > 0 && (
                <>
                  <Tag color="blue" className="font-bold border-0 text-xs px-2.5 py-0.5 rounded-lg">
                    Tổng {scrapedNewsItems.length} bài
                  </Tag>
                  {scrapedNewsItems.some(i => i.imported) && (
                    <Tag color="green" className="font-bold border-0 text-xs px-2.5 py-0.5 rounded-lg">
                      Đã nạp {scrapedNewsItems.filter(i => i.imported).length} bài
                    </Tag>
                  )}
                </>
              )}
            </label>

            {scrapedNewsItems.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <Button
                  size="small"
                  type="link"
                  onClick={() => setScrapedNewsItems(prev => prev.map(i => ({ ...i, selected: true })))}
                  className="p-0 text-blue-400 hover:text-blue-300 font-bold"
                >
                  Select Tất cả
                </Button>
                <span className="text-slate-600">|</span>
                <Button
                  size="small"
                  type="link"
                  onClick={() => setScrapedNewsItems(prev => prev.map(i => ({ ...i, selected: false })))}
                  className="p-0 text-slate-400 hover:text-slate-300"
                >
                  Bỏ chọn
                </Button>
                <span className="text-slate-600">|</span>
                <Button
                  size="small"
                  type="link"
                  danger
                  onClick={() => {
                    setScrapedNewsItems([]);
                    message.info('Đã xóa toàn bộ danh sách, bấm Quét Đa Kênh Ngay để cào lại từ đầu.');
                  }}
                  className="p-0 font-bold"
                >
                  Xóa danh sách
                </Button>
              </div>
            )}
          </div>

          {/* Render Preview List Cards (Grid 2 Cột Rộng Rãi) */}
          {scrapedNewsItems.length > 0 ? (
            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar max-h-[620px]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {scrapedNewsItems
                  .filter((item) => {
                    if (!radarSearchKeyword.trim()) return true;
                    const kw = radarSearchKeyword.trim().toLowerCase();
                    return (item.title || '').toLowerCase().includes(kw) || (item.sapo || '').toLowerCase().includes(kw);
                  })
                  .map((item, idx) => (
                    <div
                      key={idx}
                      draggable
                      onDragStart={() => handleNewsDragStart(item.url)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleNewsDrop(item.url);
                      }}
                      onClick={() => {
                        setScrapedNewsItems(prev => prev.map((it) => it.url === item.url ? { ...it, selected: !it.selected } : it));
                      }}
                      title="Kéo để sắp xếp lại thứ tự bài"
                      className={`relative p-3.5 rounded-2xl border transition-all cursor-grab active:cursor-grabbing flex flex-col justify-between gap-3 ${item.selected
                        ? 'bg-blue-950/50 border-blue-500/80 shadow-md ring-1 ring-blue-500/40'
                        : 'bg-slate-950/60 border-slate-800/80 opacity-60 hover:opacity-95'
                        }`}
                    >
                      {item.imported && (
                        <div className="absolute -top-2 -right-2 z-10 bg-emerald-600 text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-md border border-emerald-400/60">
                          ✓ Đã nạp
                        </div>
                      )}
                      <div className="space-y-2.5">
                        {/* 1. Hình ảnh thumbnail bài báo / bài Facebook */}
                        {item.coverImage ? (
                          <div className="relative overflow-hidden rounded-xl border border-slate-800/80 bg-slate-900 group">
                            <img
                              src={item.coverImage}
                              alt=""
                              className="w-full h-36 object-cover group-hover:scale-105 transition-transform duration-300"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          </div>
                        ) : (
                          <div className="w-full h-20 bg-slate-900/80 rounded-xl border border-slate-800/60 flex items-center justify-center text-slate-600 font-mono text-xs">
                            📰 Bài viết Tin tức / Báo chí
                          </div>
                        )}

                        {/* 2. Nguồn & Thời gian đăng */}
                        <div className="flex items-center justify-between gap-1 flex-wrap">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Tag color="cyan" className="font-bold !text-xs uppercase border-0 rounded-md px-2 py-0.5">
                              {item.source || 'Tin Tức'}
                            </Tag>
                            <span className="text-xs font-mono text-emerald-300 bg-emerald-950/80 border border-emerald-800/60 px-2 py-0.5 rounded-md flex items-center gap-1">
                              🕒 {item.publishedTime || 'Mới xuất bản 24h'}
                            </span>
                          </div>
                          <Checkbox
                            checked={item.selected}
                            onChange={(e) => {
                              e.stopPropagation();
                              setScrapedNewsItems(prev => prev.map((it) => it.url === item.url ? { ...it, selected: e.target.checked } : it));
                            }}
                            className="text-xs"
                          />
                        </div>

                        {/* 3. Tiêu đề & Nội dung Sapo */}
                        <h4 className="text-[13px] font-bold text-slate-100 leading-snug line-clamp-2 hover:text-blue-300">
                          {item.title}
                        </h4>

                        {item.sapo && (
                          <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed">
                            {item.sapo}
                          </p>
                        )}
                      </div>

                      {/* 4. Footer link bài gốc & trạng thái */}
                      <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-xs">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-slate-300 hover:text-blue-400 truncate max-w-[200px] flex items-center gap-1"
                        >
                          🌐 Xem bài gốc
                        </a>
                        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${item.selected ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'}`}>
                          {item.selected ? '✓ Được chọn' : 'Đã bỏ chọn'}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-950/50 rounded-2xl border border-dashed border-slate-800 space-y-3 my-auto min-h-[350px]">
              <span className="text-4xl">📰</span>
              <p className="text-sm font-semibold text-slate-300 max-w-md">
                Vui lòng nhấp chọn các Kênh báo hot 1-click ở bảng bên trái (CafeF, Batdongsan, VnExpress...) để bắt đầu quét — bấm nhiều lần hoặc bật "Quét tự động" để cào thêm liên tục, bài mới sẽ tự cộng dồn vào danh sách!
              </p>
            </div>
          )}

          {/* Button Nạp bài viết */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Đã chọn <strong className="text-emerald-400 font-bold">{scrapedNewsItems.filter(i => i.selected).length}</strong> bài viết
            </span>
            <Button
              type="primary"
              icon={<RocketOutlined />}
              loading={isScrapingArticleBatch}
              onClick={() => handleBatchScrapeArticlesToForm()}
              className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border-0 font-bold rounded-xl h-11 px-6 text-sm shadow-lg"
            >
              🚀 Cào & Nạp {scrapedNewsItems.filter(i => i.selected).length > 0 ? `${scrapedNewsItems.filter(i => i.selected).length} Bài Đã Chọn` : 'Các Bài Báo'} Vào Form Đăng
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(ArticleBatchModal, (prev, next) => !prev.showArticleBatchModal && !next.showArticleBatchModal);
