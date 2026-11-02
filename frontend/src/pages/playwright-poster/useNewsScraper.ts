import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import { App } from 'antd';
import dayjs from 'dayjs';
import type { Location, NavigateFunction } from 'react-router-dom';
import api from '../../config/axios';
import { cleanMarkdownAsterisks } from './shared';
import type { CustomNewsChannel, ScrapedNewsPreviewItem, PostLinkItem, ItemPreview } from './types';

interface NewsScraperParams {
  location: Location;
  setLinkItems: React.Dispatch<React.SetStateAction<PostLinkItem[]>>;
  setPreviews: React.Dispatch<React.SetStateAction<Record<string, ItemPreview>>>;
  navigate: NavigateFunction;
  // Khai báo sau lời gọi hook trong trang cha — đọc lười qua hàm để tránh lỗi truy cập trước khi khởi tạo
  late: () => {
    batchInterval: number;
  };
}

// Săn tin tức: kênh tin, rada quét, cào bài báo hàng loạt vào form; nhận bài từ NewsRadar/Studio Ảnh Tin — tách từ PlaywrightPoster (state và hàm giữ nguyên, chỉ chuyển chỗ)
export function useNewsScraper({ location, setLinkItems, setPreviews, navigate, late }: NewsScraperParams) {
  const { message } = App.useApp();
  // Article Scraper Batch Modal State in PlaywrightPoster
  const DEFAULT_CUSTOM_CHANNELS: CustomNewsChannel[] = [
    // 🏓 1. Pickleball (Thể thao xu hướng & Khai thác Group FB)
    { id: 'def_pickle_rss_1', category: 'pickleball', name: '🌐 Google News Pickleball 24h', url: 'https://news.google.com/rss/search?q=pickleball+vi%E1%BB%87t+nam+when:7d&hl=vi&gl=VN&ceid=VN:vi', type: 'rss' },
    { id: 'def_pickle_rss_tourn', category: 'pickleball', name: '🏆 Google News Giải Đấu & Ngôi Sao', url: 'https://news.google.com/rss/search?q=gi%E1%BA%A3i+pickleball+OR+quang+d%C6%B0%C6%A1ng+when:7d&hl=vi&gl=VN&ceid=VN:vi', type: 'rss' },
    { id: 'def_pickle_rss_gear', category: 'pickleball', name: '🏸 Google News Review Vợt & Dụng Cụ', url: 'https://news.google.com/rss/search?q=v%E1%BB%A3t+pickleball+OR+s%C3%A2n+pickleball&hl=vi&gl=VN&ceid=VN:vi', type: 'rss' },
    { id: 'def_pickle_rss_drama', category: 'pickleball', name: '🔥 Google News Drama & Văn Hóa Sân', url: 'https://news.google.com/rss/search?q=trang+ph%E1%BB%A5c+pickleball+OR+v%C4%83n+h%C3%B3a+pickleball&hl=vi&gl=VN&ceid=VN:vi', type: 'rss' },
    { id: 'def_pickle_rss_dink', category: 'pickleball', name: '🇺🇸 The Dink Mẹo & Kỹ Thuật RSS', url: 'https://thedinkpickleball.com/feed/', type: 'rss' },
    { id: 'def_pickle_rss_kitchen', category: 'pickleball', name: '🌍 The Kitchen Tin Pickleball Quốc Tế RSS', url: 'https://thekitchenpickleball.com/feed/', type: 'rss' },
    { id: 'def_pickle_1', category: 'pickleball', name: '🎾 Tuổi Trẻ Pickleball', url: 'https://tuoitre.vn/pickleball-viet-nam.html', type: 'category' },
    { id: 'def_pickle_2', category: 'pickleball', name: '🏸 Dân Trí Pickleball', url: 'https://dantri.com.vn/the-thao/pickleball.htm', type: 'category' },
    { id: 'def_pickle_3', category: 'pickleball', name: '📰 Thanh Niên Pickleball', url: 'https://thanhnien.vn/pickleball-viet-nam-tags1222606.html', type: 'category' },
    { id: 'def_pickle_4', category: 'pickleball', name: '🏓 Webthethao Pickleball', url: 'https://webthethao.vn/pickleball.htm', type: 'category' },
    { id: 'def_pickle_5', category: 'pickleball', name: '⚽ BongdaPlus Hậu Trường & Pickleball', url: 'https://bongdaplus.vn/hau-truong-the-thao.html', type: 'category' },
    { id: 'def_pickle_6', category: 'pickleball', name: '⚡ Kênh 14 Thể Thao & Phong Cách Pickleball', url: 'https://kenh14.vn/sport.chn', type: 'category' },
    { id: 'def_pickle_rss_2', category: 'pickleball', name: '🏃 VnExpress Thể Thao RSS', url: 'https://vnexpress.net/rss/the-thao.rss', type: 'rss' },

    // 📈 2. Tài Chính & Kinh Tế (Finance & Economy)
    { id: 'def_fin_1', category: 'finance', name: '💳 CafeF Tài Chính Ngân Hàng', url: 'https://cafef.vn/tai-chinh-ngan-hang.chn', type: 'category' },
    { id: 'def_fin_2', category: 'finance', name: '📊 CafeF Chứng Khoán', url: 'https://cafef.vn/thi-truong-chung-khoan.chn', type: 'category' },
    { id: 'def_fin_3', category: 'finance', name: '🏦 CafeF Vĩ Mô & Đầu Tư', url: 'https://cafef.vn/vi-mo-dau-tu.chn', type: 'category' },
    { id: 'def_fin_rss_1', category: 'finance', name: '📡 CafeF Tài Chính RSS', url: 'https://cafef.vn/tai-chinh-ngan-hang.rss', type: 'rss' },
    { id: 'def_fin_4', category: 'finance', name: '🚀 CafeBiz Kinh Doanh', url: 'https://cafebiz.vn/kinh-doanh.chn', type: 'category' },
    { id: 'def_fin_rss_2', category: 'finance', name: '📡 VnExpress Kinh Doanh RSS', url: 'https://vnexpress.net/rss/kinh-doanh.rss', type: 'rss' },
    { id: 'def_fin_5', category: 'finance', name: '💼 VnExpress Kinh Doanh', url: 'https://vnexpress.net/kinh-doanh', type: 'category' },
    { id: 'def_fin_6', category: 'finance', name: '📉 VnEconomy Tài Chính', url: 'https://vneconomy.vn/tai-chinh-chung-khoan.htm', type: 'category' },
    { id: 'def_fin_7', category: 'finance', name: '💹 Vietstock Chứng Khoán', url: 'https://vietstock.vn/chung-khoan.htm', type: 'category' },
    { id: 'def_fin_8', category: 'finance', name: '💰 Báo Đầu Tư Tài Chính', url: 'https://baodautu.vn/tai-chinh-chung-khoan-d4/', type: 'category' },
    { id: 'def_fin_rss_3', category: 'finance', name: '📡 Tuổi Trẻ Kinh Doanh RSS', url: 'https://tuoitre.vn/rss/kinh-doanh.rss', type: 'rss' },
    { id: 'def_fin_rss_4', category: 'finance', name: '📡 VietNamNet Kinh Doanh RSS', url: 'https://vietnamnet.vn/rss/kinh-doanh.rss', type: 'rss' },
    { id: 'def_fin_9', category: 'finance', name: '📊 Dân Trí Kinh Doanh', url: 'https://dantri.com.vn/kinh-doanh.htm', type: 'category' },

    // 🏢 3. Bất Động Sản (Real Estate)
    { id: 'def_bds_rss_google', category: 'bds', name: '🌐 Google News BĐS Nóng 24h', url: 'https://news.google.com/rss/search?q=b%E1%BA%A5t+%C4%91%E1%BB%99ng+s%E1%BA%A3n+when:24h&hl=vi&gl=VN&ceid=VN:vi', type: 'rss' },
    { id: 'def_bds_rss_2', category: 'bds', name: '📡 CafeF BĐS RSS', url: 'https://cafef.vn/bat-dong-san.rss', type: 'rss' },
    { id: 'def_bds_rss_1', category: 'bds', name: '📡 VnExpress BĐS RSS', url: 'https://vnexpress.net/rss/bat-dong-san.rss', type: 'rss' },
    { id: 'def_bds_rss_3', category: 'bds', name: '📡 Tuổi Trẻ BĐS RSS', url: 'https://tuoitre.vn/rss/bat-dong-san.rss', type: 'rss' },
    { id: 'def_bds_rss_5', category: 'bds', name: '📡 VietNamNet BĐS RSS', url: 'https://vietnamnet.vn/rss/bat-dong-san.rss', type: 'rss' },
    { id: 'def_bds_rss_4', category: 'bds', name: '📡 Dân Trí BĐS RSS', url: 'https://dantri.com.vn/rss/bat-dong-san.rss', type: 'rss' },
    { id: 'def_bds_1', category: 'bds', name: '🏢 CafeF BĐS', url: 'https://cafef.vn/bat-dong-san.chn', type: 'category' },
    { id: 'def_bds_2', category: 'bds', name: '🏠 Batdongsan.com.vn', url: 'https://batdongsan.com.vn/tin-tuc', type: 'category' },
    { id: 'def_bds_3', category: 'bds', name: '🏙️ VnExpress BĐS', url: 'https://vnexpress.net/bat-dong-san', type: 'category' },
    { id: 'def_bds_4', category: 'bds', name: '📰 Tuổi Trẻ BĐS', url: 'https://tuoitre.vn/bat-dong-san.htm', type: 'category' },
    { id: 'def_bds_5', category: 'bds', name: '🔴 Dân Trí BĐS', url: 'https://dantri.com.vn/bat-dong-san.htm', type: 'category' },

    // 📰 4. Báo Nổi Tiếng & Thời Sự Tổng Hợp (Major Newspapers)
    { id: 'def_life_rss_1', category: 'lifestyle', name: '📰 VnExpress Tin Mới Nhất RSS', url: 'https://vnexpress.net/rss/tin-moi-nhat.rss', type: 'rss' },
    { id: 'def_life_rss_2', category: 'lifestyle', name: '🌏 Tuổi Trẻ Tin Mới 24h RSS', url: 'https://tuoitre.vn/rss/tin-moi-nhat.rss', type: 'rss' },
    { id: 'def_life_rss_3', category: 'lifestyle', name: '🔥 Dân Trí Tin Nổi Bật RSS', url: 'https://dantri.com.vn/rss/home.rss', type: 'rss' },
    { id: 'def_life_rss_4', category: 'lifestyle', name: '⭐ Thanh Niên Thời Sự RSS', url: 'https://thanhnien.vn/rss/thoi-su.rss', type: 'rss' },
    { id: 'def_life_rss_5', category: 'lifestyle', name: '🇻🇳 VietNamNet Thời Sự RSS', url: 'https://vietnamnet.vn/rss/thoi-su.rss', type: 'rss' },
    { id: 'def_life_rss_6', category: 'lifestyle', name: '👷 Báo Lao Động RSS', url: 'https://laodong.vn/rss/thoi-su.rss', type: 'rss' },
    { id: 'def_life_rss_7', category: 'lifestyle', name: '🚩 Tiền Phong Tin Mới RSS', url: 'https://tienphong.vn/rss/tin-moi-nhat.rss', type: 'rss' },
    { id: 'def_life_rss_8', category: 'lifestyle', name: '📺 VTC News Thời Sự 24/7 RSS', url: 'https://vtcnews.vn/rss/feed.rss', type: 'rss' },

    // 💻 5. Công Nghệ & AI
    { id: 'def_tech_1', category: 'tech', name: '💻 VnExpress Công Nghệ', url: 'https://vnexpress.net/cong-nghe', type: 'category' },
    { id: 'def_tech_2', category: 'tech', name: '📱 Tuổi Trẻ Công Nghệ', url: 'https://tuoitre.vn/cong-nghe.htm', type: 'category' },
    { id: 'def_tech_3', category: 'tech', name: '⚡ Dân Trí Sức Mạnh Số', url: 'https://dantri.com.vn/suc-manh-so.htm', type: 'category' },
    { id: 'def_tech_4', category: 'tech', name: '⚡ GenK Công Nghệ', url: 'https://genk.vn', type: 'category' },
    { id: 'def_tech_rss_1', category: 'tech', name: '📡 VnExpress Số Hóa RSS', url: 'https://vnexpress.net/rss/so-hoa.rss', type: 'rss' },
    { id: 'def_tech_rss_2', category: 'tech', name: '📡 Tuổi Trẻ Công Nghệ RSS', url: 'https://tuoitre.vn/rss/khoa-hoc-cong-nghe.rss', type: 'rss' },

    // 🌿 6. Sức Khỏe & Đời Sống
    { id: 'def_health_1', category: 'health', name: '🏥 Tuổi Trẻ Sức Khỏe', url: 'https://tuoitre.vn/suc-khoe.htm', type: 'category' },
    { id: 'def_health_2', category: 'health', name: '🌿 VnExpress Sức Khỏe', url: 'https://vnexpress.net/suc-khoe', type: 'category' },
    { id: 'def_health_3', category: 'health', name: '🍎 Dân Trí Sức Khỏe', url: 'https://dantri.com.vn/suc-khoe.htm', type: 'category' },
  ];

  const [showArticleBatchModal, setShowArticleBatchModal] = useState(false);
  const [articleBatchUrlsText, setArticleBatchUrlsText] = useState('');
  // Mặc định TẮT AI rewrite để giữ nguyên 100% nội dung gốc bài báo chính xác theo yêu cầu người dùng
  const [articleBatchEnableAi, setArticleBatchEnableAi] = useState(false);
  const [articleBatchAiStyle, setArticleBatchAiStyle] = useState('FANPAGE_POST');
  const [isScrapingArticleBatch, setIsScrapingArticleBatch] = useState(false);
  const [customCategoryInputUrl, setCustomCategoryInputUrl] = useState('');
  const [scrapedNewsItems, setScrapedNewsItems] = useState<ScrapedNewsPreviewItem[]>([]);
  const [activeCategoryTab, setActiveCategoryTab] = useState<string>('bds');
  const [showRawUrlArea, setShowRawUrlArea] = useState<boolean>(false);
  const [showChannelUrlList, setShowChannelUrlList] = useState<boolean>(false);
  const [isRadarActive, setIsRadarActive] = useState<boolean>(false);
  const [isRadarSweeping, setIsRadarSweeping] = useState<boolean>(false);
  const [radarAutoRefresh, setRadarAutoRefresh] = useState<boolean>(false);
  // Chu kỳ tự động cào lại (phút) — người dùng tự chọn thay vì cố định 15 phút, để cân bằng giữa độ
  // mới của tin và tải máy chủ (cào bằng Playwright tốn tài nguyên hơn khi lặp quá dày).
  const [radarAutoRefreshMinutes, setRadarAutoRefreshMinutes] = useState<number>(15);
  const [radarLastSweepTime, setRadarLastSweepTime] = useState<string>('');
  const [radarSearchKeyword, setRadarSearchKeyword] = useState<string>('');

  const [customChannels, setCustomChannels] = useState<CustomNewsChannel[]>(() => {
    try {
      const saved = localStorage.getItem('toolzutter_custom_news_channels');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) { }
    return DEFAULT_CUSTOM_CHANNELS;
  });

  const [showAddChannelModal, setShowAddChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelUrl, setNewChannelUrl] = useState('');
  const [newChannelCategory, setNewChannelCategory] = useState<'bds' | 'tech' | 'finance' | 'health' | 'other'>('bds');

  const saveChannelsToStorage = (channels: CustomNewsChannel[]) => {
    setCustomChannels(channels);
    try {
      localStorage.setItem('toolzutter_custom_news_channels', JSON.stringify(channels));
    } catch (e) { }
  };

  const handleAddCustomChannel = () => {
    if (!newChannelName.trim() || !newChannelUrl.trim()) {
      message.warning('Vui lòng nhập đầy đủ tên hiển thị và đường link chuyên mục!');
      return;
    }
    let cleanUrl = newChannelUrl.trim();
    if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;
    const isRss = cleanUrl.includes('.rss') || cleanUrl.includes('/rss');

    const newCh: CustomNewsChannel = {
      id: `custom_ch_${Date.now()}`,
      category: newChannelCategory,
      name: newChannelName.trim(),
      url: cleanUrl,
      type: isRss ? 'rss' : 'category'
    };

    const updated = [...customChannels, newCh];
    saveChannelsToStorage(updated);
    setNewChannelName('');
    setNewChannelUrl('');
    setShowAddChannelModal(false);
    message.success(`🎉 Đã lưu kênh "${newCh.name}" vào danh sách!`);
  };

  const handleDeleteCustomChannel = (id: string, name: string) => {
    const updated = customChannels.filter(c => c.id !== id);
    saveChannelsToStorage(updated);
    message.info(`Đã xóa kênh "${name}"`);
  };

  // Ref lưu URL bài đang được kéo (drag) trong lưới danh sách tin tức, dùng cho tính năng kéo-thả
  // sắp xếp lại thứ tự bài trước khi nạp hàng loạt.
  const newsDragUrlRef = useRef<string | null>(null);

  const handleNewsDragStart = (url: string) => {
    newsDragUrlRef.current = url;
  };

  const handleNewsDrop = (targetUrl: string) => {
    const draggedUrl = newsDragUrlRef.current;
    newsDragUrlRef.current = null;
    if (!draggedUrl || draggedUrl === targetUrl) return;
    setScrapedNewsItems((prev) => {
      const fromIdx = prev.findIndex((i) => i.url === draggedUrl);
      const toIdx = prev.findIndex((i) => i.url === targetUrl);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  // Cộng dồn kết quả quét mới vào danh sách hiện có thay vì thay thế toàn bộ — mỗi lượt "Quét Đa
  // Kênh Ngay"/quét tự động 15 phút chỉ chèn thêm bài THẬT SỰ MỚI (theo url), giữ nguyên trạng thái
  // selected/imported/thứ tự kéo-thả của các bài đã có trong danh sách. Bài mới được chèn lên đầu để
  // tin mới nhất luôn nổi lên trên, đúng tinh thần "Rada theo dõi tin tức mới 24/7".
  const mergeNewsItems = (
    prev: ScrapedNewsPreviewItem[],
    incoming: ScrapedNewsPreviewItem[]
  ): ScrapedNewsPreviewItem[] => {
    const existingUrls = new Set(prev.map((i) => i.url));
    const freshOnes = incoming.filter((it) => it.url && !existingUrls.has(it.url));
    return [...freshOnes, ...prev];
  };

  // Nhận bài từ trang Radar Tin Tức (NewsRadar) chuyển sang qua router state (nút "Gửi sang Đăng tự
  // động") — cào thẳng full nội dung & nạp ngay thành card "Bài viết" trong form đăng, KHÔNG mở panel
  // Săn Tin Tức trung gian nữa (trước đây phải mở panel rồi bấm "Cào & Nạp" thêm 1 lần, tốn thao
  // tác/thời gian thừa vì bài đã được chọn sẵn từ bên Radar rồi). Dọn state sau khi dùng để tránh
  // nạp lại trùng khi back/refresh.
  // Dùng ref để chặn triệt để React 18 / StrictMode re-run useEffect làm kích hoạt 2 lần khiến bài bị nhân đôi
  const handledImportRef = useRef<string>('');
  useEffect(() => {
    const incoming = (location.state as any)?.importedNewsArticles as ScrapedNewsPreviewItem[] | undefined;
    if (incoming && incoming.length > 0) {
      const incomingKey = incoming.map((it) => it.url).filter(Boolean).sort().join('||');
      if (handledImportRef.current === incomingKey) return;
      handledImportRef.current = incomingKey;

      // Xoá trắng card cũ ngay lập tức để không bị hiển thị thừa bài trống hoặc nhân đôi bài
      setLinkItems([]);
      setPreviews({});

      navigate(location.pathname, { replace: true, state: {} });
      handleBatchScrapeArticlesToForm(incoming.map((it) => it.url));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // Nhận bài từ Studio Ảnh Tin: mỗi bài thành 1 card "Nhập tay" có sẵn caption + ảnh tin, người dùng
  // chọn Page/Nhóm/giờ đăng như bình thường. Giờ đăng giãn theo batchInterval để không dồn cùng lúc.
  const handledStudioImportRef = useRef<string>('');
  useEffect(() => {
    const incoming = (location.state as any)?.importedStudioPosts as Array<{ caption: string; imageUrl: string; comment?: string; mediaType?: string }> | undefined;
    if (!incoming || incoming.length === 0) return;
    const key = incoming.map((p) => p.imageUrl).join('||');
    if (handledStudioImportRef.current === key) return;
    handledStudioImportRef.current = key;
    const base = dayjs().add(5, 'minute');
    const cards: PostLinkItem[] = incoming.map((p, idx) => ({
      id: `studio-${Date.now()}-${idx}`,
      url: '',
      inputType: 'MANUAL',
      manualContent: p.caption,
      manualMediaUrls: [p.imageUrl],
      manualMediaKinds: [p.mediaType === 'VIDEO' || /\.(mp4|mov|webm)(\?|$)/i.test(p.imageUrl) ? 'video' : 'image'],
      isNow: false,
      scheduledAt: base.add(idx * (late().batchInterval || 15), 'minute'),
      includeCredit: false,
      // Chế độ "hook + nội dung ở bình luận": nội dung dài thả ở bình luận đầu tiên
      ...(p.comment ? { affiliateLink: p.comment, showCommentBox: true } : {}),
    }));
    // Bỏ các card trống mặc định rồi thêm bài từ Studio
    setLinkItems((prev) => [
      ...prev.filter((it) => it.url.trim() || it.manualContent?.trim() || (it.manualMediaUrls?.length || 0) > 0),
      ...cards,
    ]);
    navigate(location.pathname, { replace: true, state: {} });
    message.success(`Đã nhận ${cards.length} bài từ Studio. Chọn Page/Nhóm rồi bấm đăng.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const getDomainFromUrl = (url: string): string => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      if (host.includes('cafef')) return 'CafeF';
      if (host.includes('vnexpress')) return 'VnExpress';
      if (host.includes('batdongsan')) return 'Batdongsan';
      if (host.includes('tuoitre')) return 'Tuổi Trẻ';
      if (host.includes('dantri')) return 'Dân Trí';
      if (host.includes('vietnamnet')) return 'VietNamNet';
      if (host.includes('znews')) return 'ZNews';
      return host;
    } catch (e) {
      return 'Tin Tức';
    }
  };

  const handleFetchCategoryPreset = async (categoryUrl: string) => {
    message.loading({ content: '🌐 Đang quét danh sách bài viết mới nhất...', key: 'cat_preset' });
    try {
      const res = await api.post('/tools/scrape-category-links', { url: categoryUrl, limit: 10 });
      if (res.data?.success && res.data?.urls?.length > 0) {
        setArticleBatchUrlsText(res.data.urls.join('\n'));
        const rawItems = res.data.items || [];
        const parsedItems: ScrapedNewsPreviewItem[] = res.data.urls.map((url: string, index: number) => {
          const found = rawItems.find((it: any) => it.url === url) || rawItems[index];
          return {
            url: url,
            title: found?.title || url,
            coverImage: found?.coverImage || '',
            sapo: found?.sapo || '',
            source: found?.source || getDomainFromUrl(url),
            selected: true
          };
        });
        setScrapedNewsItems((prev) => mergeNewsItems(prev, parsedItems));
        message.success({ content: `🎉 Đã tìm thấy ${parsedItems.length} bài viết mới nhất!`, key: 'cat_preset' });
      } else {
        message.warning({ content: 'Không tìm thấy bài viết nào trên trang chuyên mục này', key: 'cat_preset' });
      }
    } catch (e: any) {
      message.error({ content: 'Lỗi khi quét trang chuyên mục tin tức', key: 'cat_preset' });
    }
  };

  const handleFetchRssPreset = async (rssUrl: string) => {
    message.loading({ content: '📡 Đang đọc RSS Feed 24/7...', key: 'rss_preset' });
    try {
      const res = await api.post('/tools/parse-rss', { url: rssUrl, limit: 10 });
      if (res.data?.success && res.data?.items?.length > 0) {
        const urls = res.data.items.map((it: any) => it.link);
        setArticleBatchUrlsText(urls.join('\n'));
        const parsedItems: ScrapedNewsPreviewItem[] = res.data.items.map((it: any) => ({
          url: it.link,
          title: it.title || it.link,
          sapo: it.description || '',
          source: getDomainFromUrl(it.link),
          publishedTime: it.pubDate ? new Date(it.pubDate).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '',
          selected: true
        }));
        setScrapedNewsItems((prev) => mergeNewsItems(prev, parsedItems));
        message.success({ content: `📡 Nạp thành công ${urls.length} bài mới từ RSS Feed!`, key: 'rss_preset' });
      } else {
        message.warning({ content: 'Không tìm thấy bài viết mới từ RSS Feed này', key: 'rss_preset' });
      }
    } catch (e: any) {
      message.error({ content: 'Lỗi khi đọc RSS Feed', key: 'rss_preset' });
    }
  };

  const handleRunRadarSweep = async (cat?: string) => {
    const categoryToSweep = cat || activeCategoryTab;
    setIsRadarSweeping(true);
    message.loading({ content: `📡 Rada đang quét đa kênh cho chủ đề [${categoryToSweep.toUpperCase()}]...`, key: 'radar_sweep' });

    const channelsToSweep = customChannels.filter(c => c.category === categoryToSweep || (categoryToSweep === 'custom' && true));
    if (channelsToSweep.length === 0) {
      message.warning({ content: 'Chưa khai báo kênh nào cho chủ đề này!', key: 'radar_sweep' });
      setIsRadarSweeping(false);
      return;
    }

    try {
      const allFetchedItems: ScrapedNewsPreviewItem[] = [];
      const seenUrls = new Set<string>();

      const promises = channelsToSweep.map(async (ch) => {
        try {
          if (ch.type === 'rss') {
            const res = await api.post('/tools/parse-rss', { url: ch.url, limit: 5 });
            if (res.data?.success && res.data?.items) {
              return res.data.items.map((it: any) => ({
                url: it.link,
                title: it.title || it.link,
                sapo: it.description || '',
                source: ch.name,
                coverImage: '',
                publishedTime: it.pubDate ? new Date(it.pubDate).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '',
                selected: true
              }));
            }
          } else {
            const res = await api.post('/tools/scrape-category-links', { url: ch.url, limit: 5 });
            if (res.data?.success && res.data?.urls) {
              const rawItems = res.data.items || [];
              return res.data.urls.map((u: string, idx: number) => {
                const found = rawItems.find((i: any) => i.url === u) || rawItems[idx];
                return {
                  url: u,
                  title: found?.title || u,
                  sapo: found?.sapo || '',
                  coverImage: found?.coverImage || '',
                  source: ch.name,
                  publishedTime: found?.publishedTime || '',
                  selected: true
                };
              });
            }
          }
        } catch (err) {
          return [];
        }
        return [];
      });

      const results = await Promise.all(promises);
      results.flat().forEach((item) => {
        if (item && item.url && !seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          allFetchedItems.push(item);
        }
      });

      if (allFetchedItems.length > 0) {
        setScrapedNewsItems((prev) => {
          const before = prev.length;
          const merged = mergeNewsItems(prev, allFetchedItems);
          const newCount = merged.length - before;
          message.success({
            content: newCount > 0
              ? `📡 Rada phát hiện thêm ${newCount} bài MỚI (đã cộng dồn vào danh sách, tổng ${merged.length} bài)!`
              : `📡 Rada đã quét lại — không có bài mới nào so với danh sách hiện có (${merged.length} bài).`,
            key: 'radar_sweep'
          });
          return merged;
        });
        setRadarLastSweepTime(new Date().toLocaleTimeString('vi-VN'));
        setIsRadarActive(true);
      } else {
        message.warning({ content: 'Rada không tìm thấy bài viết nào từ các kênh!', key: 'radar_sweep' });
      }
    } catch (e) {
      message.error({ content: 'Lỗi khi quét Rada tin tức', key: 'radar_sweep' });
    } finally {
      setIsRadarSweeping(false);
    }
  };

  useEffect(() => {
    let interval: any = null;
    if (radarAutoRefresh && showArticleBatchModal) {
      interval = setInterval(() => {
        handleRunRadarSweep();
      }, radarAutoRefreshMinutes * 60 * 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [radarAutoRefresh, radarAutoRefreshMinutes, showArticleBatchModal, activeCategoryTab]);

  const handleBatchScrapeArticlesToForm = async (overrideUrls?: string[]) => {
    const selectedUrls = scrapedNewsItems.filter((i) => i.selected).map((i) => i.url);
    const rawLines = overrideUrls && overrideUrls.length > 0
      ? overrideUrls
      : selectedUrls.length > 0
        ? selectedUrls
        : articleBatchUrlsText
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 5 && !l.includes('...') && (l.startsWith('http://') || l.startsWith('https://')));

    if (rawLines.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 bài viết hoặc dán đường link hợp lệ!');
      return;
    }

    setIsScrapingArticleBatch(true);
    message.loading({ content: `📰 Đang cào & biên tập ${rawLines.length} bài báo BĐS...`, key: 'batch_article', duration: 0 });

    const newLinkItems: PostLinkItem[] = [];
    const succeededUrls: string[] = [];
    const geminiKey = localStorage.getItem('toolzutter_gemini_api_key') || '';

    for (let i = 0; i < rawLines.length; i++) {
      const url = rawLines[i];
      const itemId = `art_${Date.now()}_${i}`;

      try {
        // 1. Cào full thông tin bài báo
        const scrapeRes = await api.post('/tools/scrape-article', { url });
        if (scrapeRes.data?.success) {
          const article = scrapeRes.data;
          const rawSource = ((article.siteName || article.domain || '') + ' ' + (url || article.url || '')).toLowerCase();
          // Dùng tên domain (có dấu chấm hoặc .vn) để tránh Facebook tự động popup gợi ý tag trang
          // khi worker gõ từ khóa trùng tên Page (VD: "CafeF" → Facebook gợi ý tag trang CafeF BĐS)
          let cleanSource = 'Báo điện tử';
          if (rawSource.includes('reddit')) cleanSource = 'Reddit';
          else if (rawSource.includes('threads')) cleanSource = 'Threads';
          else if (rawSource.includes('tiktok')) cleanSource = 'TikTok';
          else if (rawSource.includes('cafef')) cleanSource = 'cafef.vn';
          else if (rawSource.includes('vnexpress')) cleanSource = 'vnexpress.net';
          else if (rawSource.includes('dantri')) cleanSource = 'dantri.com.vn';
          else if (rawSource.includes('tuoitre')) cleanSource = 'tuoitre.vn';
          else if (rawSource.includes('vietnamnet')) cleanSource = 'vietnamnet.vn';
          else if (rawSource.includes('thanhnien')) cleanSource = 'thanhnien.vn';
          else if (rawSource.includes('batdongsan.com')) cleanSource = 'batdongsan.com.vn';
          else if (rawSource.includes('chinhphu')) cleanSource = 'chinhphu.vn';
          else if (rawSource.includes('vneconomy')) cleanSource = 'vneconomy.vn';
          else if (article.siteName) cleanSource = article.siteName.replace(/reddit\.com/gi, 'Reddit');

          const pageHashtags = '#vietnamrealestate #batdongsan #radiantvietnam';
          const newsFooter = `Nguồn: ${cleanSource}\n\n${pageHashtags}`;
          let finalCaption = `📌 ${article.title}\n\n💡 ${article.sapo || ''}\n\n${article.content}\n\n${newsFooter}`;

          // 2. Viết lại bằng AI nếu bật
          if (articleBatchEnableAi) {
            try {
              const aiRes = await api.post('/tools/rewrite-article-ai', {
                title: article.title,
                sapo: article.sapo || '',
                content: article.content,
                style: articleBatchAiStyle,
                apiKey: geminiKey
              });
              if (aiRes.data?.success && aiRes.data?.rewrittenContent) {
                finalCaption = cleanMarkdownAsterisks(aiRes.data.rewrittenContent);
                if (!finalCaption.includes('Nguồn:')) {
                  finalCaption += `\n\n${newsFooter}`;
                }
              }
            } catch (aiErr) {
              console.warn(`[PlaywrightPoster] AI Rewrite warning for ${url}:`, aiErr);
            }
          }

          const mediaUrls = (article.images || []).map((img: any) => img.url || img);
          const mediaKinds = mediaUrls.map(() => 'image' as const);

          newLinkItems.push({
            id: itemId,
            url,
            customCaption: finalCaption,
            isNow: i === 0,
            scheduledAt: dayjs().add(i * 30, 'minute'),
            includeCredit: true,
            inputType: 'LINK',
          });
          succeededUrls.push(url);

          setPreviews((prev) => ({
            ...prev,
            [itemId]: {
              loading: false,
              caption: finalCaption,
              author: article.siteName || article.domain || '',
              mediaUrls,
              mediaKinds,
              originalMediaUrls: [...mediaUrls],
              originalMediaKinds: [...mediaKinds],
              videoCount: 0,
              imageCount: mediaUrls.length,
              watermarkRemoved: true,
            }
          }));
        }
      } catch (err: any) {
        console.error(`Lỗi cào bài báo ${url}:`, err);
      }
    }

    if (newLinkItems.length > 0) {
      setLinkItems((prev) => {
        if (overrideUrls && overrideUrls.length > 0) {
          // Khi chủ động chuyển bài từ NewsRadar sang, thay thế form bằng đúng các bài mới chuyển (tránh bị trùng lặp)
          return newLinkItems;
        }
        const newUrlSet = new Set(newLinkItems.map((item) => item.url.trim()));
        const filteredOld = prev.filter((item) => item.url.trim().length > 0 && !newUrlSet.has(item.url.trim()));
        return [...filteredOld, ...newLinkItems];
      });
      // Đánh dấu các bài đã nạp thành công để lần sau mở lại panel Rada, người dùng thấy ngay bài
      // nào đã lấy rồi (badge "✓ Đã nạp") thay vì phải nhớ hoặc chọn nhầm lại lần 2.
      if (succeededUrls.length > 0) {
        const succeededSet = new Set(succeededUrls);
        setScrapedNewsItems((prev) => prev.map((it) => succeededSet.has(it.url) ? { ...it, imported: true, selected: false } : it));
      }
      message.success({ content: `🎉 Đã cào thành công ${newLinkItems.length}/${rawLines.length} bài báo BĐS & điền vào form Đăng tự động!`, key: 'batch_article' });
      setShowArticleBatchModal(false);
      setArticleBatchUrlsText('');
    } else {
      message.error({ content: 'Không thể cào dữ liệu từ các link đã nhập!', key: 'batch_article' });
    }

    setIsScrapingArticleBatch(false);
  };

  return {
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
    showAddChannelModal,
    handleAddCustomChannel,
    newChannelName,
    setNewChannelName,
    newChannelUrl,
    setNewChannelUrl,
    newChannelCategory,
  };
}
