import { memo } from 'react';
import type React from 'react';
import {
  Button,
  Input,
  Select,
  Tag,
  Checkbox,
  InputNumber,
  Drawer,
} from 'antd';
import { SearchOutlined, FireOutlined } from '@ant-design/icons';

interface ViralHunterDrawerProps {
  hunterDrawerVisible: boolean;
  setHunterDrawerVisible: React.Dispatch<React.SetStateAction<boolean>>;
  hunterTarget: string;
  setHunterTarget: React.Dispatch<React.SetStateAction<string>>;
  setHunterLimit: React.Dispatch<React.SetStateAction<number>>;
  hunterLimit: number;
  hunterMinViews: number;
  setHunterMinViews: React.Dispatch<React.SetStateAction<number>>;
  hunterDurationFilter: "ALL" | "SHORT" | "LONG";
  setHunterDurationFilter: React.Dispatch<React.SetStateAction<"ALL" | "SHORT" | "LONG">>;
  hunterSortBy: "VIEWS_DESC" | "LIKES_DESC" | "NEWEST";
  setHunterSortBy: React.Dispatch<React.SetStateAction<"VIEWS_DESC" | "LIKES_DESC" | "NEWEST">>;
  setHunterUltraHD: React.Dispatch<React.SetStateAction<boolean>>;
  hunterUltraHD: boolean;
  setHunterHideImported: React.Dispatch<React.SetStateAction<boolean>>;
  hunterHideImported: boolean;
  setHunterAutoSchedule: React.Dispatch<React.SetStateAction<boolean>>;
  hunterAutoSchedule: boolean;
  hunterLoading: boolean;
  hunterResults: { id: string; url: string; title: string; desc: string; views: number; likes: number; comments: number; duration: string; cover: string; channel: string; isAlreadyImported?: boolean; postStatus?: string; }[];
  hunterSelectedIds: Set<string>;
  setHunterSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  handleHuntChannel: () => Promise<void>;
  filteredAndSortedHunterVideos: { id: string; url: string; title: string; desc: string; views: number; likes: number; comments: number; duration: string; cover: string; channel: string; isAlreadyImported?: boolean; postStatus?: string; }[];
  handleImportHunterVideos: () => void;
}

// Drawer săn video viral — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
function ViralHunterDrawer({
  hunterDrawerVisible,
  setHunterDrawerVisible,
  hunterTarget,
  setHunterTarget,
  setHunterLimit,
  hunterLimit,
  hunterMinViews,
  setHunterMinViews,
  hunterDurationFilter,
  setHunterDurationFilter,
  hunterSortBy,
  setHunterSortBy,
  setHunterUltraHD,
  hunterUltraHD,
  setHunterHideImported,
  hunterHideImported,
  setHunterAutoSchedule,
  hunterAutoSchedule,
  hunterLoading,
  hunterResults,
  hunterSelectedIds,
  setHunterSelectedIds,
  handleHuntChannel,
  filteredAndSortedHunterVideos,
  handleImportHunterVideos,
}: ViralHunterDrawerProps) {
  return (
    <Drawer
      title={
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center text-white text-lg font-black shadow-md">
            🔥
          </div>
          <div>
            <div className="font-bold text-base text-slate-100">Kính Lúp Săn Kênh TikTok Viral</div>
            <div className="text-xs text-slate-400 font-normal">Quét video nhiều view nhất của kênh đối thủ và đưa vào hàng đợi đăng tự động</div>
          </div>
        </div>
      }
      placement="right"
      size={typeof window !== 'undefined' && window.innerWidth < 1024 ? 'default' : 'large'}
      open={hunterDrawerVisible}
      onClose={() => setHunterDrawerVisible(false)}
      styles={{
        wrapper: { width: 'calc(100vw - 16px)', maxWidth: '100vw' },
        header: { background: '#0b1329', borderBottom: '1px solid rgba(148,163,184,0.15)', padding: '16px 24px' },
        body: { background: '#070c1b', padding: '24px' },
        footer: { background: '#0b1329', borderTop: '1px solid rgba(148,163,184,0.15)', padding: '16px 24px' },
      }}
      footer={
        <div className="flex items-center justify-between gap-4">
          <Button
            size="large"
            onClick={() => setHunterDrawerVisible(false)}
            className="border-slate-700 text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl font-semibold px-6"
          >
            Đóng
          </Button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 font-medium">
              Đã chọn: <b className="text-rose-400">{hunterSelectedIds.size}</b> / {hunterResults.length} video
            </span>
            <Button
              type="primary"
              size="large"
              disabled={hunterSelectedIds.size === 0}
              onClick={handleImportHunterVideos}
              className="!bg-gradient-to-r !from-rose-600 !to-amber-600 hover:!from-rose-500 hover:!to-amber-500 !text-white font-bold rounded-xl px-6 border-0 shadow-lg"
            >
              🚀 Chuyển {hunterSelectedIds.size} Video Vào Hàng Đợi
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Box tìm kiếm kênh */}
        <div className="bg-slate-900/90 border border-slate-700/80 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                Tên kênh TikTok (@username hoặc link kênh)
              </label>
              <Input
                size="large"
                placeholder="Ví dụ: @tiemmeoxinh, @reviewanngon, @tiktok..."
                value={hunterTarget}
                onChange={(e) => setHunterTarget(e.target.value)}
                onPressEnter={handleHuntChannel}
                className="rounded-xl bg-slate-950 border-slate-700 text-slate-100 placeholder:text-slate-500 h-12"
                prefix={<SearchOutlined className="text-rose-400 mr-1" />}
              />
            </div>
            <div className="w-full sm:w-56">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Số lượng video (1 - 100)
                </label>
                <div className="flex items-center gap-1">
                  {[12, 24, 48, 60].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setHunterLimit(num)}
                      className={`px-2 py-0.5 rounded text-xs font-bold transition-all ${hunterLimit === num
                        ? 'bg-rose-500 text-white shadow-xs'
                        : 'bg-slate-800 text-slate-300 hover:text-white'
                        }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
              <InputNumber
                size="large"
                min={1}
                max={100}
                value={hunterLimit}
                onChange={(val) => setHunterLimit(Number(val) || 24)}
                className="w-full h-12 rounded-xl text-base font-bold bg-slate-950 border-slate-700 text-slate-100 flex items-center"
                prefix={<FireOutlined className="text-rose-400 mr-2" />}
                placeholder="Nhập số video..."
                addonAfter={<span className="text-xs text-slate-400">video</span>}
              />
            </div>
            <div className="sm:self-end">
              <Button
                type="primary"
                size="large"
                loading={hunterLoading}
                onClick={handleHuntChannel}
                className="w-full sm:w-auto h-12 px-6 rounded-xl font-bold !bg-gradient-to-r !from-rose-600 !to-amber-600 hover:!from-rose-500 hover:!to-amber-500 border-0 shadow-md flex items-center justify-center gap-2"
              >
                <FireOutlined /> Quét Video Viral
              </Button>
            </div>
          </div>

          {/* Gợi ý nhanh các kênh mẫu */}
          <div className="flex items-center gap-2 flex-wrap pt-1 text-xs">
            <span className="text-slate-400 font-medium">Gợi ý kênh hot:</span>
            {[
              { handle: '@film.factoryyy', label: '🎬 FILM FACTORY (462k)' },
              { handle: '@phimtalk000', label: '🎬 PhimTalk (27k)' },
              { handle: '@bowlcrab', label: '🦀 @bowlcrab' },
              { handle: '@tiemmeoxinh', label: '🐱 @tiemmeoxinh' },
              { handle: '@reviewanngon', label: '🍜 @reviewanngon' },
            ].map((item) => (
              <button
                key={item.handle}
                type="button"
                onClick={() => {
                  setHunterTarget(item.handle);
                }}
                className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 hover:bg-rose-500/20 hover:text-rose-300 border border-slate-700 transition-colors font-mono text-xs"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Kết quả quét */}
        {hunterResults.length > 0 && (
          <div className="space-y-4">
            {/* Thanh công cụ lọc và sắp xếp nâng cao */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Bộ lọc:</span>

                  {/* Lọc lượt xem */}
                  <Select
                    size="small"
                    value={hunterMinViews}
                    onChange={(val) => setHunterMinViews(val)}
                    className="w-36 text-xs"
                    options={[
                      { value: 0, label: '👁️ Tất cả lượt xem' },
                      { value: 100000, label: '👁️ > 100K views' },
                      { value: 500000, label: '👁️ > 500K views' },
                      { value: 1000000, label: '🔥 > 1M views' },
                    ]}
                  />

                  {/* Lọc thời lượng */}
                  <Select
                    size="small"
                    value={hunterDurationFilter}
                    onChange={(val) => setHunterDurationFilter(val)}
                    className="w-36 text-xs"
                    options={[
                      { value: 'ALL', label: '⏱️ Mọi thời lượng' },
                      { value: 'SHORT', label: '⚡ Ngắn ≤ 60s (Reels)' },
                      { value: 'LONG', label: '⏳ Dài > 60s' },
                    ]}
                  />

                  {/* Sắp xếp */}
                  <Select
                    size="small"
                    value={hunterSortBy}
                    onChange={(val) => setHunterSortBy(val)}
                    className="w-36 text-xs"
                    options={[
                      { value: 'VIEWS_DESC', label: '📈 Xem nhiều nhất' },
                      { value: 'LIKES_DESC', label: '❤️ Tim nhiều nhất' },
                    ]}
                  />
                </div>

                {/* Tuỳ chọn rải lịch, ẩn video đã đăng và tăng nét Ultra HD */}
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setHunterHideImported(!hunterHideImported)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5 ${hunterHideImported
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-xs'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    title="Tự động ẩn các video đã từng đăng hoặc đang có trong hàng đợi đăng bài"
                  >
                    <span>🚫 Ẩn video đã đăng ({hunterResults.filter((i) => i.isAlreadyImported).length})</span>
                    <span className={`w-2 h-2 rounded-full ${hunterHideImported ? 'bg-rose-400' : 'bg-slate-500'}`} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setHunterUltraHD(!hunterUltraHD)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5 ${hunterUltraHD
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-xs'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    title="Tự động làm nét viền và chống vỡ hạt khi đăng lên Facebook"
                  >
                    <span>⚡ Tăng nét Ultra HD</span>
                    <span className={`w-2 h-2 rounded-full ${hunterUltraHD ? 'bg-amber-400 animate-pulse' : 'bg-slate-500'}`} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setHunterAutoSchedule(!hunterAutoSchedule)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5 ${hunterAutoSchedule
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-xs'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    title="Bài nhập vào sẽ được xếp vào lịch đăng chung (khung giờ + giãn cách cài ở Lịch đăng trên header)"
                  >
                    <span>Xếp vào lịch đăng</span>
                    <span className={`w-2 h-2 rounded-full ${hunterAutoSchedule ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-200">
                  Tìm thấy <span className="text-rose-400 font-mono font-bold">{filteredAndSortedHunterVideos.length}</span> video phù hợp từ <span className="text-rose-400 font-mono">{hunterTarget}</span>:
                </span>
                <Tag color="volcano" className="!font-bold !m-0">
                  Đã xếp hạng Viral
                </Tag>
                {hunterHideImported && hunterResults.some((i) => i.isAlreadyImported) && (
                  <Tag color="default" className="!text-xs !m-0 !bg-slate-800 !text-slate-300 border-slate-700">
                    Đã ẩn {hunterResults.filter((i) => i.isAlreadyImported).length} video đã đăng
                  </Tag>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="small"
                  onClick={() => {
                    if (hunterSelectedIds.size === filteredAndSortedHunterVideos.length) {
                      setHunterSelectedIds(new Set());
                    } else {
                      setHunterSelectedIds(new Set(filteredAndSortedHunterVideos.map((it) => it.id)));
                    }
                  }}
                  className="text-xs font-semibold rounded-lg bg-slate-800 border-slate-700 text-slate-300"
                >
                  {hunterSelectedIds.size === filteredAndSortedHunterVideos.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAndSortedHunterVideos.map((item, idx) => {
                const isChecked = hunterSelectedIds.has(item.id);
                const viewStr = item.views >= 1000000
                  ? `${(item.views / 1000000).toFixed(1)}M`
                  : item.views >= 1000
                    ? `${(item.views / 1000).toFixed(1)}K`
                    : String(item.views);

                const likeStr = item.likes >= 1000
                  ? `${(item.likes / 1000).toFixed(1)}K`
                  : String(item.likes);

                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      setHunterSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      });
                    }}
                    className={`cursor-pointer rounded-2xl border p-3.5 transition-all space-y-3 relative group ${
                      item.isAlreadyImported ? 'opacity-70 bg-slate-900/40' : ''
                    } ${isChecked
                      ? 'border-rose-500/80 bg-rose-950/20 shadow-lg shadow-rose-950/30 ring-1 ring-rose-500/50'
                      : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
                      }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Thumbnail */}
                      <div className="w-20 h-28 rounded-xl overflow-hidden bg-black shrink-0 relative border border-slate-800">
                        {item.cover ? (
                          <img src={item.cover} alt="cover" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-600 text-xs">No Cover</div>
                        )}
                        {item.duration && (
                          <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-black/80 text-xs text-white font-mono font-bold">
                            {item.duration}
                          </span>
                        )}
                        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-rose-600/90 text-xs text-white font-bold">
                          #{idx + 1}
                        </span>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center justify-between">
                          <Checkbox
                            checked={isChecked}
                            onChange={(e) => {
                              e.stopPropagation();
                              setHunterSelectedIds((prev) => {
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
                            className="text-xs text-slate-300 hover:text-rose-400 underline font-mono flex items-center gap-1"
                          >
                            Xem trên TikTok ↗
                          </a>
                        </div>

                        <p className="text-[13px] text-slate-100 line-clamp-3 font-medium mb-0">
                          {item.title || item.desc || 'Video không có tiêu đề'}
                        </p>

                        <div className="flex items-center gap-2 pt-1 flex-wrap text-xs">
                          <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 font-bold border border-amber-500/20">
                            👁️ {viewStr} views
                          </span>
                          {item.likes > 0 && (
                            <span className="px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-300 font-bold border border-rose-500/20">
                              ❤️ {likeStr}
                            </span>
                          )}
                          {item.isAlreadyImported && (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 text-xs">
                              {item.postStatus === 'PUBLISHED' ? '✅ ĐÃ XUẤT BẢN' : '📅 ĐÃ CÓ TRONG LỊCH'}
                            </span>
                          )}
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
        {hunterResults.length === 0 && !hunterLoading && (
          <div className="py-16 text-center space-y-3 bg-slate-900/40 rounded-2xl border border-slate-800/80">
            <div className="text-4xl">🎯</div>
            <div className="text-sm font-bold text-slate-300">Chưa quét kênh nào</div>
            <div className="text-xs text-slate-500 max-w-md mx-auto">
              Nhập tên kênh đối thủ ở trên (ví dụ: <code className="text-rose-400 font-mono">@tiemmeoxinh</code>) và bấm <b>Quét Video Viral</b> để tự động bốc toàn bộ video hot nhất về đăng!
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(ViralHunterDrawer, (prev, next) => !prev.hunterDrawerVisible && !next.hunterDrawerVisible);
