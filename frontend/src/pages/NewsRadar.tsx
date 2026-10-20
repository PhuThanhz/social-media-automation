import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Card,
  Button,
  Input,
  Select,
  Tag,
  Modal,
  Drawer,
  Form,
  Space,
  Badge,
  Spin,
  Empty,
  DatePicker,
  Switch,
  Typography,
  App as AntdApp,
  Tooltip,
  Popconfirm,
} from 'antd';
import {
  SyncOutlined,
  PlusOutlined,
  RobotOutlined,
  EyeOutlined,
  SendOutlined,
  LinkOutlined,
  SearchOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  DeleteOutlined,
  GlobalOutlined,
  CheckSquareOutlined,
  BorderOutlined,
  EditOutlined,
  HistoryOutlined,
  RadarChartOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  ShareAltOutlined,
  FileImageOutlined,
  AppstoreOutlined,
  BankOutlined,
  LineChartOutlined,
  ReadOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import api from '../config/axios';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;
const { Option } = Select;

interface NewsChannel {
  id: string;
  name: string;
  topic: string;
  topicLabel: string;
  url: string;
  icon?: string;
  feedType: 'RSS' | 'CATEGORY';
  siteName?: string;
  custom?: boolean;
}

interface NewsArticleItem {
  id?: string;
  title: string;
  url: string;
  sapo?: string;
  content?: string;
  coverImage?: string;
  mediaUrls?: string[];
  images?: Array<{ url: string; caption?: string }>;
  publishedTime?: string;
  // ISO string suy ra được từ publishedTime (khi parse được) — dùng để sắp xếp/lọc theo ngày chính
  // xác, vì publishedTime là chuỗi thô cào nguyên văn từ trang nguồn (mỗi site 1 kiểu định dạng
  // khác nhau: "43 phút trước", ngày đầy đủ, RSS pubDate...) nên không dùng trực tiếp để lọc được.
  publishedAt?: string;
  source?: string;
  topic?: string;
  hashtags?: string[];
  // AI Rewrite state
  aiCaption?: string;
  aiRewritten?: boolean;
}

interface NewsHistoryItem {
  id: number;
  title: string;
  content: string;
  mediaUrls?: string;
  originalUrl?: string;
  targetFanpageId?: string;
  pageName?: string;
  targetGroupNames?: string;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED' | 'PROCESSING' | string;
  scheduledAt?: string;
  publishedAt?: string;
  publishedPostUrl?: string;
  fbPostId?: string;
  errorMessage?: string;
  createdAt?: string;
}

interface SocialAccount {
  id: number;
  platform: string;
  platformAccountId: string;
  pageName?: string;
  accountType?: string;
  tokenStatus?: string;
}

interface FacebookGroup {
  id: number;
  groupId: string;
  groupName: string;
}

// Chuỗi thời gian cào được từ trang nguồn không đồng nhất giữa các site (relative time kiểu "43
// phút trước"/"1 giờ trước"/"Hôm qua", hoặc ngày đầy đủ, hoặc chuỗi RSS pubDate chuẩn RFC822...) nên
// không thể lọc theo khoảng ngày trực tiếp trên chuỗi thô — hàm này cố gắng quy đổi về 1 mốc thời
// gian thực (Dayjs) theo nhiều kiểu phổ biến, trả về null nếu không nhận diện được kiểu nào.
function parseArticlePublishedTime(raw?: string): Dayjs | null {
  if (!raw || !raw.trim()) return null;
  const text = raw.trim();

  const relativeMatch = text.match(/(\d+)\s*(giây|phút|giờ|ngày|tuần|tháng)\s*trước/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unitRaw = relativeMatch[2].toLowerCase();
    const unitMap: Record<string, dayjs.ManipulateType> = {
      'giây': 'second', 'phút': 'minute', 'giờ': 'hour', 'ngày': 'day', 'tuần': 'week', 'tháng': 'month',
    };
    const unit = unitMap[unitRaw];
    if (unit) return dayjs().subtract(amount, unit);
  }
  if (/hôm nay|vừa xong|mới cập nhật|just now/i.test(text)) return dayjs();
  if (/hôm qua/i.test(text)) return dayjs().subtract(1, 'day');

  // Ngày dạng Việt Nam DD/MM/YYYY (có thể kèm giờ HH:mm)
  const viDateMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D+(\d{1,2}):(\d{2}))?/);
  if (viDateMatch) {
    const [, d, m, y, h, mi] = viDateMatch;
    const parsed = dayjs(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')} ${h || '00'}:${mi || '00'}`, 'YYYY-MM-DD HH:mm');
    if (parsed.isValid()) return parsed;
  }

  // ISO 8601 hoặc chuỗi RSS pubDate (RFC822) — dayjs tự nhận diện được cả hai qua Date.parse
  const generic = dayjs(text);
  if (generic.isValid()) return generic;

  return null;
}

const getTopicIcon = (key: string) => {
  switch (key) {
    case 'all': return <AppstoreOutlined className="text-cyan-400" />;
    case 'bds': return <BankOutlined className="text-emerald-400" />;
    case 'finance': return <LineChartOutlined className="text-blue-400" />;
    case 'tech': return <ThunderboltOutlined className="text-amber-400" />;
    case 'lifestyle': return <ReadOutlined className="text-purple-400" />;
    case 'pickleball': return <TrophyOutlined className="text-rose-400" />;
    default: return <GlobalOutlined className="text-slate-400" />;
  }
};

const cleanTopicName = (name: string) =>
  name.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();

export default function NewsRadar() {
  const navigate = useNavigate();
  // Dùng App.useApp() thay vì import message tĩnh — message tĩnh không đọc được theme động
  // (ConfigProvider dark algorithm bọc ngoài App.tsx), gây cảnh báo "Static function can not consume
  // context like dynamic theme".
  const { message } = AntdApp.useApp();

  // State nguồn kênh và chủ đề
  const [channels, setChannels] = useState<NewsChannel[]>([]);
  const [topics, setTopics] = useState<Record<string, string>>({});
  const [selectedTopic, setSelectedTopic] = useState<string>('all');
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [customInputUrl, setCustomInputUrl] = useState<string>('');

  // Danh sách bài viết & bộ lọc
  const [articles, setArticles] = useState<NewsArticleItem[]>([]);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncLimit, setSyncLimit] = useState<number>(15);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedArticleUrls, setSelectedArticleUrls] = useState<Set<string>>(new Set());
  // Bộ lọc theo khoảng ngày đăng (tuỳ chỉnh) — null = không lọc, hiển thị tất cả bài
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  // Mặc định HIỆN TẤT CẢ bài kể cả đã đăng (đánh dấu badge "Đã đăng" trên card thay vì ẩn đi) — theo
  // yêu cầu người dùng: muốn thấy toàn bộ danh sách, chỉ cần biết bài nào đã đăng rồi là đủ, không
  // muốn bị ẩn khỏi lưới.
  const [showPosted, setShowPosted] = useState<boolean>(true);

  // Modal thêm kênh mới
  const [addChannelModalOpen, setAddChannelModalOpen] = useState<boolean>(false);
  const [addChannelForm] = Form.useForm();
  const [addingChannel, setAddingChannel] = useState<boolean>(false);

  // Drawer xem chi tiết bài báo & AI Rewrite
  const [detailDrawerOpen, setDetailDrawerOpen] = useState<boolean>(false);
  const [activeArticle, setActiveArticle] = useState<NewsArticleItem | null>(null);
  const [loadingArticleDetail, setLoadingArticleDetail] = useState<boolean>(false);
  const [aiStyle, setAiStyle] = useState<string>('ANALYSIS');
  const [aiApiKey, setAiApiKey] = useState<string>('');
  const [aiRewriting, setAiRewriting] = useState<boolean>(false);
  const [editableCaption, setEditableCaption] = useState<string>('');
  // Ẩn khối cấu hình Gemini AI theo mặc định — chưa có API key nên bấm "Viết lại ngay" chỉ báo lỗi,
  // gây rối chứ không dùng được. Người dùng tự bật lại khi đã có key (xem nút "Bật" ở banner thu gọn).
  const [showAiRewriteBox, setShowAiRewriteBox] = useState<boolean>(false);

  // Modal lên lịch hàng loạt
  const [batchModalOpen, setBatchModalOpen] = useState<boolean>(false);
  const [batchSubmitting, setBatchSubmitting] = useState<boolean>(false);
  const [batchForm] = Form.useForm();

  // Danh sách kết nối xã hội & Nhóm
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [postingTargetType, setPostingTargetType] = useState<'FANPAGE' | 'GROUP'>('FANPAGE');

  // Danh sách Nhóm Facebook — không có endpoint /groups riêng (từng gọi nhầm, luôn 404); các trang
  // khác trong app (Connections, GroupFlopManagement...) đều lấy Group bằng cách lọc từ /connections
  // theo platform, nên suy ra fbGroups trực tiếp từ socialAccounts đã tải thay vì gọi API riêng.
  const fbGroups: FacebookGroup[] = useMemo(
    () => socialAccounts
      .filter((a) => a.platform === 'FACEBOOK_GROUP')
      .map((a) => ({ id: a.id, groupId: a.platformAccountId, groupName: a.pageName || a.platformAccountId })),
    [socialAccounts]
  );

  // State quản lý Tab chính: Radar (Tin Mới) vs Lịch Sử Bài Đã Đăng
  const [activeMainTab, setActiveMainTab] = useState<'radar' | 'history'>('radar');
  const [historyItems, setHistoryItems] = useState<NewsHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [historyFilterStatus, setHistoryFilterStatus] = useState<string>('ALL');
  const [historySearchQuery, setHistorySearchQuery] = useState<string>('');
  const [viewingHistoryItem, setViewingHistoryItem] = useState<NewsHistoryItem | null>(null);
  const [historyDetailModalOpen, setHistoryDetailModalOpen] = useState<boolean>(false);

  // 1. Tải danh sách kênh & danh sách tài khoản & lịch sử khi mount
  useEffect(() => {
    loadChannels();
    loadConnections();
    loadHistory();
  }, []);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await api.get('/news-radar/history');
      if (res.data?.success) {
        setHistoryItems(res.data.items || []);
      }
    } catch (e) {
      console.error('Lỗi tải lịch sử bài báo:', e);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleDeleteHistoryItem = async (id: number) => {
    try {
      const res = await api.delete(`/news-radar/history/${id}`);
      if (res.data?.success) {
        message.success('Đã xóa bài khỏi lịch sử!');
        setHistoryItems((prev) => prev.filter((it) => it.id !== id));
      }
    } catch (e: any) {
      message.error('Lỗi xóa bài: ' + (e.response?.data?.error || e.message));
    }
  };

  const handlePublishHistoryNow = async (id: number) => {
    try {
      message.loading({ content: 'Đang kích hoạt đăng bài ngay...', key: 'pub_now', duration: 0 });
      const res = await api.post(`/news-radar/history/${id}/publish-now`);
      if (res.data?.success) {
        message.success({ content: 'Đã gửi yêu cầu đăng bài thành công!', key: 'pub_now' });
        loadHistory();
      }
    } catch (e: any) {
      message.error({ content: 'Lỗi đăng ngay: ' + (e.response?.data?.error || e.message), key: 'pub_now' });
    }
  };

  const loadChannels = async () => {
    try {
      const res = await api.get('/news-radar/channels');
      if (res.data?.success) {
        const chanList: NewsChannel[] = res.data.channels || [];
        setChannels(chanList);
        setTopics(res.data.topics || {});
        if (chanList.length > 0 && !selectedChannelId) {
          setSelectedChannelId(chanList[0].id);
        }
      }
    } catch (err: any) {
      message.error('Không thể tải danh mục kênh tin tức: ' + (err.message || 'Lỗi'));
    }
  };

  const loadConnections = async () => {
    try {
      const res = await api.get('/connections');
      setSocialAccounts(res.data || []);
    } catch (e) {
      console.error('Lỗi tải connections', e);
    }
  };

  // Kênh hiện tại đang được chọn
  const activeChannel = useMemo(() => {
    return channels.find((c) => c.id === selectedChannelId) || channels[0];
  }, [channels, selectedChannelId]);

  // Lọc kênh theo Topic đang chọn
  const filteredChannels = useMemo(() => {
    if (selectedTopic === 'all') return channels;
    return channels.filter((c) => c.topic === selectedTopic);
  }, [channels, selectedTopic]);

  // Tự động quét tin tức khi kênh được chọn lần đầu nếu chưa có bài
  useEffect(() => {
    if (activeChannel && articles.length === 0 && !syncing) {
      handleSyncFeed(activeChannel.url);
    }
  }, [selectedChannelId]);

  // 2. Thao tác Đồng bộ tin tức từ URL
  const handleSyncFeed = async (targetUrl?: string) => {
    const urlToScrape = targetUrl || customInputUrl.trim() || activeChannel?.url;
    if (!urlToScrape) {
      message.warning('Vui lòng chọn hoặc nhập đường link nguồn tin!');
      return;
    }

    setSyncing(true);
    try {
      const res = await api.post('/news-radar/sync', {
        url: urlToScrape,
        limit: syncLimit,
      });

      if (res.data?.success && Array.isArray(res.data.items)) {
        const fetchedItems: NewsArticleItem[] = res.data.items.map((it: any, idx: number) => ({
          id: `art_${Date.now()}_${idx}`,
          title: it.title || 'Không có tiêu đề',
          url: it.originalUrl || it.url || '',
          sapo: it.sapo || '',
          content: it.content || '',
          coverImage: ((it.coverImage || (it.mediaUrls && it.mediaUrls[0]) || '') as string).replace(/&amp;/g, '&').trim(),
          mediaUrls: ((it.mediaUrls || (it.coverImage ? [it.coverImage] : [])) as string[]).map((m: string) => m.replace(/&amp;/g, '&').trim()),
          images: it.imagesWithCaption || [],
          publishedTime: it.publishedTime || 'Mới cập nhật',
          publishedAt: parseArticlePublishedTime(it.publishedTime)?.toISOString(),
          source: it.siteName || activeChannel?.siteName || 'Tin tức',
          topic: activeChannel?.topic || 'general',
          // Backend/worker đôi khi trả hashtags dạng chuỗi thay vì mảng — worker's generateSmartHashtags()
          // nối các tag bằng KHOẢNG TRẮNG (VD "#BatDongSan #NhaDat"), không phải dấu phẩy, nên tách theo
          // khoảng trắng để không bị gộp cả chuỗi thành 1 "tag" duy nhất (đã xác nhận qua test thực tế).
          hashtags: Array.isArray(it.hashtags)
            ? it.hashtags
            : (typeof it.hashtags === 'string' && it.hashtags.trim() ? it.hashtags.split(/[\s,]+/).map((s: string) => s.trim()).filter(Boolean) : []),
          aiRewritten: false,
          aiCaption: '',
        }));

        setArticles(fetchedItems);
        setSelectedArticleUrls(new Set()); // Reset selection
        message.success(`Đã quét thành công ${fetchedItems.length} bài viết mới nhất!`);
      } else {
        message.error(res.data?.error || 'Không tìm thấy bài viết nào từ nguồn này.');
      }
    } catch (err: any) {
      message.error('Lỗi khi đồng bộ nguồn tin: ' + (err.response?.data?.error || err.message));
    } finally {
      setSyncing(false);
    }
  };

  // 3. Thêm kênh tin tức mới
  const handleAddChannel = async (values: any) => {
    setAddingChannel(true);
    try {
      const res = await api.post('/news-radar/channels', {
        name: values.name,
        url: values.url,
        topic: values.topic || 'custom',
        topicLabel: values.topicLabel || 'Chủ đề tùy chọn',
      });

      if (res.data?.success) {
        message.success('Đã thêm kênh theo dõi mới thành công!');
        setAddChannelModalOpen(false);
        addChannelForm.resetFields();
        await loadChannels();
        if (res.data.channel?.id) {
          setSelectedChannelId(res.data.channel.id);
        }
      }
    } catch (err: any) {
      message.error('Lỗi thêm kênh: ' + (err.response?.data?.error || err.message));
    } finally {
      setAddingChannel(false);
    }
  };

  // Xóa kênh tùy chỉnh
  const handleDeleteCustomChannel = async (channelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    Modal.confirm({
      title: 'Xóa kênh theo dõi?',
      content: 'Bạn có chắc chắn muốn xóa kênh này khỏi danh sách?',
      okText: 'Xóa',
      okType: 'danger',
      cancelText: 'Hủy',
      onOk: async () => {
        try {
          await api.delete(`/news-radar/channels/${channelId}`);
          message.success('Đã xóa kênh');
          loadChannels();
          if (selectedChannelId === channelId) {
            setSelectedChannelId(channels[0]?.id || '');
          }
        } catch (err: any) {
          message.error('Không thể xóa kênh: ' + err.message);
        }
      },
    });
  };

  // Tập URL các bài ĐÃ THỰC SỰ ĐĂNG (status PUBLISHED), lấy từ dữ liệu Lịch Sử thật trên server —
  // dùng thay cho cờ posted tạm trong phiên (client-side, mất khi tải lại trang) để badge "Đã đăng"
  // luôn đúng kể cả sau khi F5, và khớp chính xác với tab Lịch Sử thay vì có thể lệch nhau.
  const postedUrlSet = useMemo(
    () => new Set(historyItems.filter((it) => it.status === 'PUBLISHED' && it.originalUrl).map((it) => it.originalUrl as string)),
    [historyItems]
  );

  // 4. Lọc bài viết hiển thị theo Search Query + khoảng ngày đăng
  const filteredArticles = useMemo(() => {
    let result = articles;
    if (!showPosted) {
      result = result.filter((a) => !postedUrlSet.has(a.url));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          (a.sapo && a.sapo.toLowerCase().includes(q)) ||
          (a.source && a.source.toLowerCase().includes(q))
      );
    }
    if (dateRange && (dateRange[0] || dateRange[1])) {
      const [from, to] = dateRange;
      result = result.filter((a) => {
        // Bài không xác định được ngày đăng (publishedAt không parse được) vẫn giữ lại thay vì ẩn
        // đi — tránh trường hợp bật lọc ngày làm mất bài hợp lệ chỉ vì định dạng thời gian lạ.
        if (!a.publishedAt) return true;
        const t = dayjs(a.publishedAt);
        if (from && t.isBefore(from.startOf('day'))) return false;
        if (to && t.isAfter(to.endOf('day'))) return false;
        return true;
      });
    }
    return result;
  }, [articles, searchQuery, dateRange, showPosted, postedUrlSet]);

  // Lọc lịch sử bài báo đã lấy đăng
  const filteredHistoryItems = useMemo(() => {
    let list = historyItems;
    if (historyFilterStatus !== 'ALL') {
      list = list.filter((it) => it.status === historyFilterStatus);
    }
    if (historySearchQuery.trim()) {
      const q = historySearchQuery.toLowerCase().trim();
      list = list.filter(
        (it) =>
          (it.title && it.title.toLowerCase().includes(q)) ||
          (it.content && it.content.toLowerCase().includes(q)) ||
          (it.pageName && it.pageName.toLowerCase().includes(q)) ||
          (it.originalUrl && it.originalUrl.toLowerCase().includes(q))
      );
    }
    return list;
  }, [historyItems, historyFilterStatus, historySearchQuery]);

  // Quản lý chọn bài
  const toggleSelectArticle = (url: string) => {
    const next = new Set(selectedArticleUrls);
    if (next.has(url)) {
      next.delete(url);
    } else {
      next.add(url);
    }
    setSelectedArticleUrls(next);
  };

  // Bỏ hẳn 1 bài cụ thể khỏi danh sách (khác với bỏ chọn — bài biến mất luôn, không cần xóa sạch cả
  // danh sách rồi cào lại chỉ để loại 1 bài không muốn thấy nữa).
  const handleRemoveArticle = (url: string) => {
    setArticles((prev) => prev.filter((a) => a.url !== url));
    setSelectedArticleUrls((prev) => {
      if (!prev.has(url)) return prev;
      const next = new Set(prev);
      next.delete(url);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedArticleUrls.size === filteredArticles.length) {
      setSelectedArticleUrls(new Set());
    } else {
      setSelectedArticleUrls(new Set(filteredArticles.map((a) => a.url)));
    }
  };

  const handleQuickSelect = (count: number) => {
    const target = filteredArticles.slice(0, count).map((a) => a.url);
    setSelectedArticleUrls(new Set(target));
    message.info(`Đã chọn nhanh ${target.length} bài viết đầu tiên`);
  };

  // 5. Mở Drawer xem chi tiết bài báo & cào nội dung sâu
  const handleOpenDetail = async (article: NewsArticleItem) => {
    setActiveArticle(article);
    setEditableCaption(article.aiCaption || '');
    setDetailDrawerOpen(true);

    // Nếu bài báo chưa có nội dung chi tiết (ví dụ chỉ có sapo từ RSS), tự động cào bài chi tiết
    if (!article.content || article.content.length < 150) {
      setLoadingArticleDetail(true);
      try {
        const res = await api.post('/news-radar/scrape-article', { url: article.url });
        if (res.data?.success) {
          const detail = res.data;
          // scrapeNewsArticle() đọc thẳng meta "article:published_time" từ chính trang bài báo —
          // chính xác hơn hẳn publishedTime cào được từ trang danh mục/RSS (thường chỉ là relative
          // time hiển thị trên listing), nên ưu tiên ghi đè khi có.
          const refinedPublishedAt = detail.publishedTime ? parseArticlePublishedTime(detail.publishedTime) : null;
          const updated: NewsArticleItem = {
            ...article,
            content: detail.content || article.content,
            sapo: detail.sapo || article.sapo,
            coverImage: detail.coverImage || article.coverImage,
            mediaUrls: detail.images?.map((img: any) => img.url) || article.mediaUrls,
            images: detail.images || article.images,
            publishedTime: detail.publishedTime || article.publishedTime,
            publishedAt: refinedPublishedAt ? refinedPublishedAt.toISOString() : article.publishedAt,
          };
          setActiveArticle(updated);
          // Cập nhật lại danh sách bài viết
          setArticles((prev) => prev.map((a) => (a.url === article.url ? updated : a)));
        }
      } catch (e) {
        console.warn('Không thể tải sâu nội dung:', e);
      } finally {
        setLoadingArticleDetail(false);
      }
    }
  };

  // 6. Gemini AI Viết lại bài báo
  const handleAiRewrite = async () => {
    if (!activeArticle) return;
    setAiRewriting(true);
    try {
      const res = await api.post('/news-radar/rewrite', {
        title: activeArticle.title,
        sapo: activeArticle.sapo || '',
        content: activeArticle.content || activeArticle.sapo || '',
        style: aiStyle,
        apiKey: aiApiKey.trim() || undefined,
      });

      if (res.data?.success && res.data.rewrittenContent) {
        setEditableCaption(res.data.rewrittenContent);
        message.success('Gemini AI đã viết lại bài thành công!');
      } else {
        message.error(res.data?.error || 'Không thể tạo bài viết từ AI');
      }
    } catch (err: any) {
      message.error('Lỗi khi AI viết lại: ' + (err.response?.data?.error || err.message));
    } finally {
      setAiRewriting(false);
    }
  };

  // Lưu nội dung đã xào vào bài viết
  const handleSaveRewrittenContent = () => {
    if (!activeArticle) return;
    const updated: NewsArticleItem = {
      ...activeArticle,
      aiCaption: editableCaption,
      aiRewritten: !!editableCaption.trim(),
    };
    setActiveArticle(updated);
    setArticles((prev) => prev.map((a) => (a.url === activeArticle.url ? updated : a)));

    // Tự động tick chọn bài này luôn nếu người dùng chưa chọn
    if (!selectedArticleUrls.has(activeArticle.url)) {
      setSelectedArticleUrls((prev) => new Set(prev).add(activeArticle.url));
    }
    message.success('Đã lưu nội dung AI và đưa bài vào danh sách chọn!');
    setDetailDrawerOpen(false);
  };

  // Mở Studio Ảnh Tin với các bài (cào full nội dung + ảnh, AI viết tiêu đề, ghép ảnh rồi lên lịch ở đó)
  const openNewsStudio = (list: NewsArticleItem[]) => {
    if (list.length === 0) return;
    navigate('/dashboard/news-studio', {
      state: {
        studioArticles: list.map((a) => ({
          url: a.url, title: a.title, sapo: a.sapo, content: a.content, coverImage: a.coverImage, source: a.source,
        })),
      },
    });
  };


  // Phương án 2: thay vì đăng thẳng ở đây, chuyển các bài đã chọn sang panel "Hệ Thống Săn Tin Tức"
  // ở trang Đăng tự động (PlaywrightPoster) để tận dụng các tùy chọn biên tập/nhóm/lịch đăng chi
  // tiết hơn bên đó. Truyền qua router state (không qua localStorage) vì chỉ cần dùng 1 lần ngay khi
  // trang đích mount — PlaywrightPoster đọc rồi merge vào danh sách hiện có của nó.
  const handleSendToPlaywrightPoster = () => {
    if (selectedArticleUrls.size === 0) {
      message.warning('Vui lòng chọn ít nhất 1 bài viết để chuyển sang!');
      return;
    }
    const selectedItems = articles.filter((a) => selectedArticleUrls.has(a.url));
    navigate('/dashboard/playwright', {
      state: {
        importedNewsArticles: selectedItems.map((item) => ({
          url: item.url,
          title: item.title,
          coverImage: item.coverImage,
          sapo: item.sapo,
          source: item.source,
          publishedTime: item.publishedTime,
        })),
      },
    });
  };

  // 7. Lên lịch hàng loạt (Batch Queue)
  const handleOpenBatchModal = () => {
    if (selectedArticleUrls.size === 0) {
      message.warning('Vui lòng chọn ít nhất 1 bài viết để lên lịch!');
      return;
    }
    batchForm.setFieldsValue({
      scheduledAt: dayjs().add(15, 'minute'),
      intervalMinutes: 60,
      publishNow: false,
      postingTarget: 'FANPAGE',
    });
    setBatchModalOpen(true);
  };

  const handleConfirmBatchQueue = async (values: any) => {
    setBatchSubmitting(true);
    try {
      const selectedItems = articles.filter((a) => selectedArticleUrls.has(a.url));

      const payload = {
        articles: selectedItems.map((item) => ({
          title: item.title,
          url: item.url,
          sapo: item.sapo,
          content: item.content,
          source: item.source,
          caption: item.aiCaption || undefined,
          coverImage: item.coverImage,
        })),
        targetFanpageId: values.targetFanpageId,
        targetGroupNames: values.targetGroupNames ? (Array.isArray(values.targetGroupNames) ? values.targetGroupNames.join(',') : values.targetGroupNames) : undefined,
        intervalMinutes: values.intervalMinutes || 60,
        publishNow: values.publishNow || false,
        colorBackground: !!values.colorBackground,
        scheduledAt: values.scheduledAt
          ? (values.scheduledAt as Dayjs).format('YYYY-MM-DDTHH:mm:ss')
          : dayjs().format('YYYY-MM-DDTHH:mm:ss'),
      };

      const res = await api.post('/news-radar/batch-queue', payload);
      if (res.data?.success) {
        message.success(res.data.message || 'Đã lên lịch thành công!');
        setBatchModalOpen(false);
        setSelectedArticleUrls(new Set());
        // Tải lại Lịch Sử để badge "Đã đăng" (dựa trên postedUrlSet suy ra từ historyItems thật, xem
        // useMemo phía trên) sớm phản ánh đúng — riêng bài lên lịch giờ sau (không publishNow) sẽ vẫn
        // ở trạng thái PENDING cho tới khi thực sự đăng xong, badge chỉ hiện khi status = PUBLISHED.
        loadHistory();
      } else {
        message.error(res.data?.error || 'Có lỗi xảy ra khi lên lịch');
      }
    } catch (err: any) {
      message.error('Lỗi lên lịch: ' + (err.response?.data?.error || err.message));
    } finally {
      setBatchSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* ── HEADER BANNER ────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-slate-900/80 border border-slate-800/90 p-5 sm:p-6 shadow-xl backdrop-blur-xl">
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
              <RadarChartOutlined className="text-cyan-400" />
              <span>Radar Tin Tức Thời Gian Thực</span>
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-xl leading-relaxed">
              Quét tự động tin nóng từ các đầu báo uy tín, hỗ trợ biên tập AI và lên lịch đăng nhanh đa kênh.
            </p>
          </div>

          {/* Action Header Buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              type="default"
              icon={<PlusOutlined />}
              onClick={() => setAddChannelModalOpen(true)}
              className="!bg-slate-800/60 !border-slate-700/80 !text-slate-200 hover:!text-white hover:!border-cyan-400 rounded-xl font-medium h-9 px-3.5 text-xs transition-colors"
            >
              Thêm nguồn tin
            </Button>
            <Button
              type="default"
              icon={<LinkOutlined />}
              disabled={selectedArticleUrls.size === 0}
              onClick={handleSendToPlaywrightPoster}
              className="!bg-slate-800/60 !border-slate-700/80 !text-slate-200 hover:!text-white hover:!border-cyan-400 rounded-xl font-medium h-9 px-3.5 text-xs disabled:!opacity-40 transition-colors"
              title="Chuyển các bài đã chọn sang panel Săn Tin Tức ở trang Đăng tự động"
            >
              Gửi sang Đăng tự động {selectedArticleUrls.size > 0 && <span className="ml-1 px-1.5 py-0.2 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-mono font-bold">{selectedArticleUrls.size}</span>}
            </Button>
            <Button
              type="default"
              disabled={selectedArticleUrls.size === 0}
              onClick={() => openNewsStudio(articles.filter((a) => selectedArticleUrls.has(a.url)))}
              className="!bg-slate-800/60 !border-slate-700/80 !text-slate-200 hover:!text-white hover:!border-cyan-400 rounded-xl font-medium h-9 px-3.5 text-xs disabled:!opacity-40 transition-colors"
              title="Mở Studio Ảnh Tin: cào full bài, AI viết tiêu đề, ghép ảnh kiểu page tin tức rồi lên lịch"
            >
              Mở Studio ảnh tin {selectedArticleUrls.size > 0 && <span className="ml-1 px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-mono font-bold">{selectedArticleUrls.size}</span>}
            </Button>
            <Button
              type="primary"
              icon={<SendOutlined />}
              disabled={selectedArticleUrls.size === 0}
              onClick={handleOpenBatchModal}
              className={`rounded-xl font-bold h-9 px-4 text-xs transition-all ${selectedArticleUrls.size > 0
                ? '!bg-gradient-to-r !from-cyan-500 !to-blue-600 !border-none shadow-md shadow-cyan-500/30 hover:scale-[1.02]'
                : '!bg-slate-800 !text-slate-400 !border-slate-700 disabled:!opacity-40'
                }`}
            >
              Lên lịch hàng loạt {selectedArticleUrls.size > 0 && <span className="ml-1 px-1.5 py-0.2 rounded-full bg-white/20 text-white text-[10px] font-mono font-bold">{selectedArticleUrls.size}</span>}
            </Button>
          </div>
        </div>
      </div>

      {/* ── MAIN TAB SWITCHER: RADAR TIN MỚI vs LỊCH SỬ BÀI BÁO ĐÃ ĐĂNG ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2 p-1.5 bg-slate-900/80 rounded-2xl border border-slate-800/90 shadow-md backdrop-blur-md">
          <button
            type="button"
            onClick={() => setActiveMainTab('radar')}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${activeMainTab === 'radar'
              ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
          >
            <RadarChartOutlined className="text-base" />
            <span>Tin Mới Chờ Lấy</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              {filteredArticles.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveMainTab('history');
              loadHistory();
            }}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${activeMainTab === 'history'
              ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
          >
            <HistoryOutlined className="text-base" />
            <span>Lịch Sử Đã Đăng ({historyItems.length})</span>
            {historyItems.filter((i) => i.status === 'PUBLISHED').length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {historyItems.filter((i) => i.status === 'PUBLISHED').length} đã đăng
              </span>
            )}
          </button>
        </div>

        {activeMainTab === 'history' && (
          <div className="flex items-center gap-2">
            <Button
              icon={<SyncOutlined spin={loadingHistory} />}
              onClick={loadHistory}
              loading={loadingHistory}
              className="!bg-slate-800/80 !border-slate-700 !text-slate-200 hover:!text-white rounded-xl text-xs font-semibold h-9 px-3"
            >
              Làm mới lịch sử
            </Button>
          </div>
        )}
      </div>

      {activeMainTab === 'radar' ? (
        <>
          {/* ── TOPIC TABS & SOURCE CONTROLS ───────────────────────────── */}
          <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-5 shadow-xl backdrop-blur-xl space-y-4">
            {/* Hàng 1: Topic Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {Object.entries(topics).map(([topicKey, topicName]) => {
                const isActive = selectedTopic === topicKey;
                return (
                  <button
                    key={topicKey}
                    onClick={() => setSelectedTopic(topicKey)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 border cursor-pointer ${isActive
                      ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white border-cyan-400/50 shadow-md shadow-cyan-600/30'
                      : 'bg-slate-800/80 text-slate-300 border-slate-700/70 hover:bg-slate-700 hover:text-white'
                      }`}
                  >
                    {getTopicIcon(topicKey)}
                    <span>{cleanTopicName(topicName)}</span>
                  </button>
                );
              })}
            </div>

            {/* Hàng 2: Channels Selector Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {filteredChannels.map((channel) => {
                const isSelected = selectedChannelId === channel.id;
                return (
                  <div
                    key={channel.id}
                    onClick={() => {
                      setSelectedChannelId(channel.id);
                      handleSyncFeed(channel.url);
                    }}
                    className={`group px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all flex items-center gap-2 border cursor-pointer select-none ${isSelected
                      ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200 shadow-sm'
                      : 'bg-slate-800/70 border-slate-800 text-slate-300 hover:border-slate-600 hover:text-white'
                      }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? 'bg-cyan-400 animate-pulse' : 'bg-slate-500'}`} />
                    <span>{cleanTopicName(channel.name)}</span>
                    <span className="text-[10px] uppercase px-1.5 py-0.2 rounded bg-slate-900/90 border border-slate-700/80 text-slate-400 font-mono">
                      {channel.feedType}
                    </span>
                    {channel.custom && (
                      <DeleteOutlined
                        onClick={(e) => handleDeleteCustomChannel(channel.id, e)}
                        className="text-slate-500 hover:text-rose-400 ml-1 text-xs"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Hàng 3: URL tùy chọn nhanh & Nút Đồng bộ */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2 border-t border-slate-800/80">
              <Input
                placeholder="Hoặc dán URL bất kỳ (link chuyên mục báo hoặc link RSS)..."
                value={customInputUrl}
                onChange={(e) => setCustomInputUrl(e.target.value)}
                onPressEnter={() => handleSyncFeed()}
                prefix={<LinkOutlined className="text-slate-400" />}
                className="rounded-xl bg-slate-950/60 border-slate-700 text-slate-200 py-2"
              />

              <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                <Select
                  value={syncLimit}
                  onChange={setSyncLimit}
                  className="w-28"
                  styles={{ popup: { root: { background: '#172232' } } }}
                >
                  <Option value={10}>10 bài</Option>
                  <Option value={15}>15 bài</Option>
                  <Option value={20}>20 bài</Option>
                  <Option value={30}>30 bài</Option>
                </Select>

                <Button
                  type="primary"
                  icon={<SyncOutlined spin={syncing} />}
                  loading={syncing}
                  onClick={() => handleSyncFeed()}
                  className="!bg-gradient-to-r !from-cyan-600 !to-blue-600 !border-none rounded-xl font-bold h-10 px-5 shadow-md shadow-blue-900/30"
                >
                  {syncing ? 'Đang quét...' : 'Đồng bộ tin mới'}
                </Button>
              </div>
            </div>
          </div>

          {/* ── TOOLBAR: FILTER, SEARCH & SELECTION ACTIONS ───────────── */}
          <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 shadow-md backdrop-blur-xl flex flex-wrap items-center justify-between gap-4">
            {/* Bên trái: Lựa chọn bài */}
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                size="small"
                icon={selectedArticleUrls.size === filteredArticles.length && filteredArticles.length > 0 ? <CheckSquareOutlined /> : <BorderOutlined />}
                onClick={handleSelectAll}
                className="rounded-lg !bg-slate-800 !border-slate-700 !text-slate-300 hover:!text-white font-semibold text-xs"
              >
                {selectedArticleUrls.size === filteredArticles.length && filteredArticles.length > 0
                  ? 'Bỏ chọn tất cả'
                  : `Chọn tất cả (${filteredArticles.length})`}
              </Button>

              <Button
                size="small"
                onClick={() => handleQuickSelect(3)}
                className="rounded-lg !bg-slate-800/70 !border-slate-700 !text-slate-300 hover:!text-white text-xs"
              >
                Chọn 3 bài mới nhất
              </Button>

              <Button
                size="small"
                onClick={() => handleQuickSelect(5)}
                className="rounded-lg !bg-slate-800/70 !border-slate-700 !text-slate-300 hover:!text-white text-xs"
              >
                Chọn 5 bài
              </Button>

              {selectedArticleUrls.size > 0 && (
                <Tag color="cyan" className="font-bold text-xs py-0.5 px-2 rounded-md">
                  ✓ Đã chọn {selectedArticleUrls.size} bài
                </Tag>
              )}

              {articles.some((a) => postedUrlSet.has(a.url)) && (
                <Button
                  size="small"
                  type={showPosted ? 'primary' : 'default'}
                  onClick={() => setShowPosted((v) => !v)}
                  className={showPosted
                    ? 'rounded-lg !bg-emerald-600 !border-none font-semibold text-xs'
                    : 'rounded-lg !bg-slate-800/70 !border-slate-700 !text-slate-300 hover:!text-white text-xs'}
                >
                  {showPosted ? 'Đang hiện' : 'Hiện'} bài đã đăng ({articles.filter((a) => postedUrlSet.has(a.url)).length})
                </Button>
              )}
            </div>

            {/* Bên phải: Lọc theo ngày đăng & Tìm kiếm trong danh sách bài */}
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-end">
              <Space.Compact>
                <Button
                  size="middle"
                  onClick={() => setDateRange([dayjs(), dayjs()])}
                  className="rounded-l-xl !bg-slate-800 !border-slate-700 !text-slate-300 hover:!text-white text-xs font-semibold"
                >
                  Hôm nay
                </Button>
                <Button
                  size="middle"
                  onClick={() => setDateRange([dayjs().subtract(6, 'day'), dayjs()])}
                  className="!bg-slate-800 !border-slate-700 !text-slate-300 hover:!text-white text-xs font-semibold"
                >
                  7 ngày qua
                </Button>
                <Button
                  size="middle"
                  onClick={() => setDateRange(null)}
                  className="rounded-r-xl !bg-slate-800 !border-slate-700 !text-slate-300 hover:!text-white text-xs font-semibold"
                >
                  Tất cả
                </Button>
              </Space.Compact>
              <DatePicker.RangePicker
                size="middle"
                value={dateRange as any}
                onChange={(vals) => setDateRange(vals && (vals[0] || vals[1]) ? [vals[0], vals[1]] : null)}
                format="DD/MM/YYYY"
                placeholder={['Từ ngày', 'Đến ngày']}
                className="rounded-xl bg-slate-950/60 border-slate-700"
                allowClear
              />
              <div className="w-full sm:w-64">
                <Input
                  size="middle"
                  placeholder="Lọc tiêu đề bài viết..."
                  prefix={<SearchOutlined className="text-slate-400" />}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  allowClear
                  className="rounded-xl bg-slate-950/60 border-slate-700 text-slate-200"
                />
              </div>
            </div>
          </div>

          {/* ── ARTICLE CARDS GRID ───────────────────────────────────── */}
          {syncing && articles.length === 0 ? (
            <div className="py-24 text-center">
              <Spin size="large" />
              <div className="text-slate-400 text-sm mt-4 font-medium">Đang cào dữ liệu thời gian thực từ đầu báo...</div>
            </div>
          ) : filteredArticles.length === 0 ? (
            <div className="py-20 text-center bg-slate-900/80 rounded-2xl border border-slate-800/90 backdrop-blur-md">
              <Empty
                description={
                  <span className="text-slate-400">
                    Chưa có bài viết nào. Nhấn <b>"Đồng bộ tin mới"</b> ở trên để tải bài viết mới nhất!
                  </span>
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredArticles.map((article) => {
                const isSelected = selectedArticleUrls.has(article.url);
                return (
                  <div
                    key={article.url}
                    onClick={() => toggleSelectArticle(article.url)}
                    className={`relative flex flex-col justify-between rounded-2xl border transition-all duration-200 cursor-pointer overflow-hidden group shadow-md backdrop-blur-md ${isSelected
                      ? 'bg-slate-900/95 border-cyan-500 shadow-cyan-500/25 ring-1 ring-cyan-500 shadow-lg'
                      : 'bg-slate-900/80 border-slate-800/90 hover:border-slate-700 hover:bg-slate-800/90'
                      }`}
                  >
                    <div>
                      {/* Thumbnail Cover */}
                      <div className="relative aspect-video bg-slate-900 overflow-hidden">
                        {article.coverImage ? (
                          <img
                            src={article.coverImage}
                            alt={article.title}
                            loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              if (target.src && target.src.includes('&amp;')) {
                                target.src = target.src.replace(/&amp;/g, '&');
                              }
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950/30 to-slate-900 text-slate-400 p-4 text-center border-b border-slate-800/60 relative overflow-hidden">
                            <div className="absolute inset-0 bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:16px_16px] opacity-10" />
                            <div className="w-10 h-10 rounded-full bg-slate-800/80 border border-slate-700/60 flex items-center justify-center mb-2 shadow-inner text-cyan-400">
                              <FileImageOutlined className="text-lg" />
                            </div>
                            <span className="text-[11px] font-semibold text-slate-300">Tự động lấy ảnh gốc khi xem / đăng</span>
                            <span className="text-[10px] text-slate-500 mt-0.5">Google News chỉ cấp link văn bản qua RSS</span>
                          </div>
                        )}

                        {/* Top Badges over image */}
                        <div className="absolute top-3 left-3 flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-900/80 backdrop-blur-md text-cyan-300 border border-slate-700/80 shadow-sm">
                            {article.source}
                          </span>
                          {article.aiRewritten && (
                            <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-600/90 text-white shadow-sm flex items-center gap-1">
                              <RobotOutlined /> AI Đã Xào
                            </span>
                          )}
                          {postedUrlSet.has(article.url) && (
                            <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-600/90 text-white shadow-sm flex items-center gap-1">
                              <CheckCircleOutlined /> Đã đăng
                            </span>
                          )}
                        </div>

                        {/* Nút bỏ hẳn bài này khỏi danh sách (không phải bỏ chọn) */}
                        <Tooltip title="Bỏ bài này khỏi danh sách">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveArticle(article.url);
                            }}
                            className="absolute top-3 right-11 w-6 h-6 rounded-lg flex items-center justify-center bg-slate-900/80 border border-slate-600 text-slate-400 hover:bg-red-600 hover:border-red-500 hover:text-white transition-all"
                          >
                            ✕
                          </button>
                        </Tooltip>

                        {/* Selection Checkbox */}
                        <div className="absolute top-3 right-3">
                          <div
                            className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${isSelected
                              ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/50 scale-110'
                              : 'bg-slate-900/80 text-transparent border border-slate-600'
                              }`}
                          >
                            ✓
                          </div>
                        </div>

                        {/* Published Time tag — hiện giờ:phút:giây + ngày tuyệt đối (thay vì chữ tương
                        đối kiểu "1 giờ trước" cào nguyên văn từ trang nguồn, vốn không đủ chi tiết
                        để biết chính xác bài đăng lúc nào), kèm tooltip đầy đủ ngày/tháng/năm. */}
                        <Tooltip
                          title={
                            article.publishedAt
                              ? `Đăng lúc: ${dayjs(article.publishedAt).format('HH:mm:ss, DD/MM/YYYY')}`
                              : 'Không xác định được thời điểm đăng chính xác từ trang nguồn'
                          }
                        >
                          <div className="absolute bottom-2 left-3 text-[10px] font-medium text-slate-300 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded">
                            🕒 {article.publishedAt ? dayjs(article.publishedAt).format('HH:mm:ss DD/MM') : article.publishedTime}
                          </div>
                        </Tooltip>
                      </div>

                      {/* Body Content */}
                      <div className="p-4 space-y-2.5">
                        <h3
                          className="font-bold text-slate-100 text-base leading-snug line-clamp-2 group-hover:text-cyan-300 transition-colors"
                          title={article.title}
                        >
                          {article.title}
                        </h3>

                        <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed">
                          {article.sapo || 'Bài viết chưa có tóm tắt. Nhấn xem chi tiết để tải toàn văn.'}
                        </p>

                        {/* Gợi ý Hashtag — Array.isArray() bắt buộc vì có nguồn trả hashtags dạng chuỗi
                        (không phải mảng), .slice().map() sẽ crash cả trang nếu không kiểm tra trước */}
                        {Array.isArray(article.hashtags) && article.hashtags.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap pt-1">
                            {article.hashtags.slice(0, 3).map((tag, idx) => (
                              <span
                                key={idx}
                                className="text-[10px] text-cyan-400/80 bg-cyan-950/40 border border-cyan-900/40 px-1.5 py-0.2 rounded"
                              >
                                {/* Worker đã trả tag kèm sẵn dấu "#" (VD "#BatDongSan") — thêm "#" ở đây nữa
                                sẽ ra "##BatDongSan" thừa 1 dấu */}
                                {tag.startsWith('#') ? tag : `#${tag}`}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div
                      className="px-4 py-3 border-t border-slate-800/80 bg-slate-900/40 flex items-center justify-between gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => handleOpenDetail(article)}
                        className="rounded-lg !bg-slate-800 !border-slate-700 !text-slate-300 hover:!text-white text-xs font-semibold"
                      >
                        Xem chi tiết
                      </Button>

                      <a
                        href={article.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-slate-400 hover:text-cyan-300 flex items-center gap-1 font-medium transition-colors"
                      >
                        Bài gốc <LinkOutlined />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* ── LỊCH SỬ BÀI BÁO ĐÃ ĐĂNG & LÊN LỊCH ── */
        <div className="space-y-5">
          {/* Toolbar Lịch Sử */}
          <div className="bg-[#111a28] border border-slate-800/90 rounded-2xl p-4 shadow-md flex flex-wrap items-center justify-between gap-4">
            {/* Lọc theo trạng thái */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-400 mr-1 uppercase tracking-wider">Trạng thái:</span>
              {[
                { key: 'ALL', label: 'Tất cả', count: historyItems.length },
                { key: 'PUBLISHED', label: 'Đã đăng', count: historyItems.filter((i) => i.status === 'PUBLISHED').length },
                { key: 'PENDING', label: 'Chờ đăng', count: historyItems.filter((i) => i.status === 'PENDING').length },
                { key: 'FAILED', label: 'Thất bại', count: historyItems.filter((i) => i.status === 'FAILED').length },
              ].map((st) => (
                <button
                  key={st.key}
                  type="button"
                  onClick={() => setHistoryFilterStatus(st.key)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${historyFilterStatus === st.key
                    ? 'bg-purple-600 text-white border-purple-400 shadow-md shadow-purple-900/40'
                    : 'bg-slate-800/80 text-slate-300 border-slate-700/80 hover:bg-slate-700'
                    }`}
                >
                  {st.label} ({st.count})
                </button>
              ))}
            </div>

            {/* Tìm kiếm trong lịch sử */}
            <div className="flex items-center gap-2 w-full sm:w-80">
              <Input
                placeholder="Tìm tiêu đề hoặc nội dung đã đăng..."
                prefix={<SearchOutlined className="text-slate-400" />}
                value={historySearchQuery}
                onChange={(e) => setHistorySearchQuery(e.target.value)}
                allowClear
                className="rounded-xl bg-[#0e1622] border-slate-700 text-slate-200"
              />
              <Button
                icon={<SyncOutlined spin={loadingHistory} />}
                onClick={loadHistory}
                className="!bg-slate-800 !border-slate-700 !text-slate-200 rounded-xl"
                title="Tải lại lịch sử"
              />
            </div>
          </div>

          {/* Danh sách bài trong lịch sử */}
          {loadingHistory ? (
            <div className="py-24 text-center">
              <Spin size="large" />
              <div className="text-slate-400 text-sm mt-4 font-medium">Đang tải lịch sử các bài báo đã đăng...</div>
            </div>
          ) : filteredHistoryItems.length === 0 ? (
            <div className="py-20 text-center bg-[#111a28] rounded-2xl border border-slate-800">
              <Empty
                description={
                  <span className="text-slate-400">
                    Chưa có bài báo nào trong lịch sử{historyFilterStatus !== 'ALL' ? ' với bộ lọc này' : ''}.
                  </span>
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredHistoryItems.map((item) => {
                const firstMedia = item.mediaUrls ? item.mediaUrls.split(',')[0].trim() : '';
                return (
                  <div
                    key={item.id}
                    className="bg-[#111a28] border border-slate-800/90 hover:border-purple-500/50 rounded-2xl overflow-hidden shadow-lg transition-all flex flex-col justify-between"
                  >
                    <div>
                      {/* Top bar with target & status */}
                      <div className="p-3.5 border-b border-slate-800/80 bg-slate-900/60 flex items-center justify-between gap-2">
                        <Tag color="purple" className="font-bold text-xs !m-0">
                          📌 {item.pageName || 'Fanpage'}
                        </Tag>

                        {item.status === 'PUBLISHED' ? (
                          <Tag color="success" className="font-bold text-xs !m-0">
                            ✓ ĐÃ ĐĂNG
                          </Tag>
                        ) : item.status === 'PENDING' ? (
                          <Tag color="warning" className="font-bold text-xs !m-0">
                            ⏳ CHỜ ĐĂNG
                          </Tag>
                        ) : item.status === 'FAILED' ? (
                          <Tag color="error" className="font-bold text-xs !m-0">
                            ✕ THẤT BẠI
                          </Tag>
                        ) : (
                          <Tag color="cyan" className="font-bold text-xs !m-0">
                            ⚙️ {item.status}
                          </Tag>
                        )}
                      </div>

                      {/* Cover image & Title */}
                      <div className="p-4 space-y-3">
                        <div className="flex gap-3">
                          {firstMedia ? (
                            <img
                              src={firstMedia}
                              alt={item.title}
                              className="w-20 h-20 rounded-xl object-cover border border-slate-700/80 shrink-0 bg-slate-800"
                              onError={(e: any) => { e.target.style.display = 'none'; }}
                            />
                          ) : (
                            <div className="w-20 h-20 rounded-xl border border-slate-800 bg-slate-800/50 flex items-center justify-center text-slate-500 text-2xl shrink-0">
                              📰
                            </div>
                          )}

                          <div className="space-y-1.5 flex-1 min-w-0">
                            <h4 className="font-bold text-slate-100 text-sm leading-snug line-clamp-2" title={item.title}>
                              {item.title}
                            </h4>
                            <div className="text-[11px] text-slate-400 flex items-center gap-1">
                              {item.status === 'PUBLISHED' && item.publishedAt ? (
                                <span className="text-emerald-400 font-semibold">
                                  🕒 Đã đăng: {dayjs(item.publishedAt).format('HH:mm DD/MM/YYYY')}
                                </span>
                              ) : item.scheduledAt ? (
                                <span className="text-amber-300">
                                  📅 Hẹn đăng: {dayjs(item.scheduledAt).format('HH:mm DD/MM/YYYY')}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        {/* Content snippet */}
                        <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60">
                          {item.content || 'Không có nội dung'}
                        </p>
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="p-3.5 border-t border-slate-800/80 bg-slate-900/40 flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="small"
                          icon={<EyeOutlined />}
                          onClick={() => {
                            setViewingHistoryItem(item);
                            setHistoryDetailModalOpen(true);
                          }}
                          className="!bg-slate-800 !border-slate-700 !text-slate-300 hover:!text-white text-xs font-semibold rounded-lg"
                        >
                          Xem bài
                        </Button>

                        {item.originalUrl && item.originalUrl.startsWith('http') && (
                          <a
                            href={item.originalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2 py-1 text-xs text-cyan-400 hover:underline flex items-center gap-1 font-medium"
                          >
                            Báo gốc <LinkOutlined />
                          </a>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {item.publishedPostUrl ? (
                          <a
                            href={item.publishedPostUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center gap-1 shadow-sm transition-all"
                          >
                            <ShareAltOutlined /> Facebook
                          </a>
                        ) : (item.status === 'PENDING' || item.status === 'FAILED') && (
                          <Button
                            size="small"
                            type="primary"
                            icon={<ThunderboltOutlined />}
                            onClick={() => handlePublishHistoryNow(item.id)}
                            className="!bg-gradient-to-r !from-emerald-600 !to-teal-600 !border-none text-xs font-bold rounded-lg shadow-sm"
                          >
                            Đăng ngay
                          </Button>
                        )}

                        <Popconfirm
                          title="Xóa bài khỏi lịch sử?"
                          description="Bài viết sẽ bị xóa khỏi hàng đợi/lịch sử."
                          onConfirm={() => handleDeleteHistoryItem(item.id)}
                          okText="Xóa"
                          cancelText="Hủy"
                          okButtonProps={{ danger: true }}
                        >
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            className="!bg-red-950/40 !border-red-900/60 !text-red-400 hover:!bg-red-900/60 rounded-lg"
                            title="Xóa bài khỏi lịch sử"
                          />
                        </Popconfirm>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── DRAWER: XEM CHI TIẾT & GEMINI AI XÀO BÀI ──────────────── */}
      <Drawer
        open={detailDrawerOpen}
        onClose={() => setDetailDrawerOpen(false)}
        size={720}
        styles={{
          body: { background: '#0c1420', padding: 24 },
          header: { background: '#111a28', borderBottom: '1px solid #1e293b' },
        }}
        title={
          <div className="flex items-center justify-between w-full">
            <span className="text-base font-bold text-slate-100 flex items-center gap-2">
              <RobotOutlined className="text-cyan-400" /> Xem Chi Tiết & Xào Bài Gemini AI
            </span>
          </div>
        }
      >
        {activeArticle && (
          <div className="space-y-6">
            {/* Header thông tin bài */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Tag color="blue">{activeArticle.source}</Tag>
                <Tooltip
                  title={
                    activeArticle.publishedAt
                      ? `Chuỗi gốc cào từ trang nguồn: ${activeArticle.publishedTime}`
                      : 'Không xác định được thời điểm đăng chính xác từ trang nguồn'
                  }
                >
                  <span className="text-xs text-slate-400 cursor-help border-b border-dashed border-slate-600">
                    🕒 {activeArticle.publishedAt
                      ? dayjs(activeArticle.publishedAt).format('HH:mm:ss, DD/MM/YYYY')
                      : activeArticle.publishedTime}
                  </span>
                </Tooltip>
              </div>
              <h2 className="text-xl font-bold text-slate-100 leading-snug">{activeArticle.title}</h2>
              {activeArticle.sapo && (
                <div className="mt-3 p-3.5 rounded-xl bg-slate-800/50 border border-slate-700/60 text-slate-300 text-sm italic">
                  💡 {activeArticle.sapo}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-xs text-slate-400">Muốn đăng dạng ảnh tin (ảnh + tiêu đề in hoa tô đỏ)?</span>
              <Button size="small" type="primary" onClick={() => openNewsStudio([activeArticle])}>Mở trong Studio ảnh tin</Button>
            </div>

            {/* BOX: TOÀN BỘ NỘI DUNG & HÌNH ẢNH BÀI BÁO GỐC            {/* BOX: TOÀN BỘ NỘI DUNG & HÌNH ẢNH BÀI BÁO GỐC — đặt lên đầu, ngay sau tiêu đề, để
                người dùng kiểm tra đúng/đủ nội dung và ảnh TRƯỚC KHI quyết định xào bằng AI, thay vì
                phải kéo xuống cuối cùng mới xem được như trước. */}
            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                📄 Toàn bộ nội dung & hình ảnh bài báo gốc:
              </h4>
              {loadingArticleDetail ? (
                <div className="text-center py-10 bg-slate-900/60 rounded-xl border border-slate-800/80">
                  <Spin size="small" />
                  <div className="text-xs text-slate-400 mt-2">Đang tải toàn bộ bài báo...</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Album đầy đủ ảnh bài viết (không chỉ 1 ảnh bìa) */}
                  {activeArticle.images && activeArticle.images.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {activeArticle.images.map((img, i) => (
                        <a key={i} href={img.url} target="_blank" rel="noreferrer" title={img.caption || ''}>
                          <img
                            src={img.url}
                            alt={img.caption || ''}
                            className="w-full h-24 object-cover rounded-lg border border-slate-800 hover:opacity-80 transition-opacity"
                          />
                        </a>
                      ))}
                    </div>
                  ) : activeArticle.coverImage ? (
                    <div className="rounded-xl overflow-hidden border border-slate-800">
                      <img
                        src={activeArticle.coverImage}
                        alt={activeArticle.title}
                        className="w-full max-h-72 object-cover"
                      />
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 italic">Bài viết không có hình ảnh.</div>
                  )}

                  <div className="text-xs text-slate-300 whitespace-pre-line leading-relaxed max-h-80 overflow-y-auto p-3 bg-slate-900/60 rounded-xl border border-slate-800/80">
                    {activeArticle.content || activeArticle.sapo || 'Không có thêm nội dung chi tiết.'}
                  </div>
                </div>
              )}
            </div>

            {/* BOX: GEMINI AI REWRITE CONTROLLER — thu gọn mặc định (chưa cấu hình API key) */}
            {showAiRewriteBox ? (
              <div className="p-5 rounded-2xl bg-gradient-to-br from-[#131d2e] to-[#18263a] border border-cyan-800/60 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-base">
                      ✨
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-100">Xào bài bằng Gemini AI</h4>
                      <span className="text-xs text-slate-400">Tự động cấu trúc lại nội dung thành bài đăng Facebook viral</span>
                    </div>
                  </div>
                  <Button
                    size="small"
                    type="text"
                    onClick={() => setShowAiRewriteBox(false)}
                    className="!text-slate-400 hover:!text-white text-xs"
                  >
                    Ẩn
                  </Button>
                </div>

                {/* Tùy chọn phong cách */}
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">Phong cách viết lại:</label>
                  <Select
                    value={aiStyle}
                    onChange={setAiStyle}
                    className="w-full"
                    styles={{ popup: { root: { background: '#172232' } } }}
                  >
                    <Option value="ANALYSIS">🏢 Chuyên gia phân tích sâu & Góc nhìn chuyên môn</Option>
                    <Option value="VIRAL">🔥 Hài hước, Giật tít & Lôi cuốn tương tác Facebook</Option>
                    <Option value="SUMMARY">⚡ Ngắn gọn, Súc tích & Kèm Kêu gọi hành động (CTA)</Option>
                    <Option value="JOURNALISM">📰 Báo chí khách quan, Chuẩn mực & Chuyên nghiệp</Option>
                  </Select>
                </div>

                {/* Tùy chọn API Key cá nhân */}
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">
                    Gemini API Key riêng (Tùy chọn - để trống sẽ dùng Key hệ thống):
                  </label>
                  <Input.Password
                    placeholder="AIzaSy..."
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    className="bg-[#0e1622] border-slate-700 text-slate-200 text-xs rounded-xl"
                  />
                </div>

                <Button
                  type="primary"
                  icon={<RobotOutlined spin={aiRewriting} />}
                  loading={aiRewriting}
                  onClick={handleAiRewrite}
                  className="w-full !bg-gradient-to-r !from-cyan-500 !to-blue-600 !border-none rounded-xl font-bold h-10 shadow-lg shadow-cyan-500/25"
                >
                  {aiRewriting ? 'Gemini AI đang sáng tạo bài...' : '✨ Viết lại ngay bằng Gemini AI'}
                </Button>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-slate-900/50 border border-dashed border-slate-700 flex items-center justify-between">
                <span className="text-xs text-slate-500">✨ Xào bài bằng Gemini AI (đang tắt — cần API key)</span>
                <Button
                  size="small"
                  onClick={() => setShowAiRewriteBox(true)}
                  className="rounded-lg !bg-slate-800 !border-slate-700 !text-slate-300 hover:!text-white text-xs font-semibold"
                >
                  Bật
                </Button>
              </div>
            )}

            {/* BOX: KẾT QUẢ / CAPTION TÙY CHỈNH */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <EditOutlined className="text-cyan-400" /> Nội dung đăng bài (Caption xuất bản):
                </label>
                {editableCaption && (
                  <span className="text-[11px] text-cyan-400 font-medium">
                    {editableCaption.length} ký tự
                  </span>
                )}
              </div>
              <TextArea
                rows={10}
                value={editableCaption}
                onChange={(e) => setEditableCaption(e.target.value)}
                placeholder="Nội dung bài viết xào lại sẽ hiển thị ở đây. Bạn có thể tự do chỉnh sửa bổ sung hashtag, hotline hoặc lời bình cá nhân..."
                className="bg-[#0e1622] border-slate-700 text-slate-200 rounded-xl text-sm leading-relaxed p-3.5"
              />
            </div>

            {/* Nút Áp dụng lưu nội dung */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <Button onClick={() => setDetailDrawerOpen(false)} className="rounded-xl font-medium">
                Đóng
              </Button>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={handleSaveRewrittenContent}
                className="!bg-emerald-600 hover:!bg-emerald-500 !border-none rounded-xl font-bold px-5"
              >
                Áp dụng nội dung này cho bài đăng
              </Button>
            </div>
          </div>
        )}
      </Drawer>


      {/* ── MODAL: THÊM KÊNH TIN TỨC MỚI ──────────────────────────── */}
      <Modal
        open={addChannelModalOpen}
        onCancel={() => setAddChannelModalOpen(false)}
        footer={null}
        title={<span className="text-base font-bold text-slate-100 flex items-center gap-2"><RadarChartOutlined className="text-cyan-400" /> Thêm Nguồn Tin Theo Dõi</span>}
        styles={{
          body: { background: '#111a28' },
          header: { background: '#111a28' },
        }}
      >
        <Form
          form={addChannelForm}
          layout="vertical"
          onFinish={handleAddChannel}
          initialValues={{ topic: 'bds' }}
          className="mt-4"
        >
          <Form.Item
            name="name"
            label={<span className="text-xs font-bold text-slate-300">Tên nguồn tin / Kênh:</span>}
            rules={[{ required: true, message: 'Vui lòng nhập tên kênh!' }]}
          >
            <Input placeholder="Ví dụ: CafeF Bất Động Sản, VnExpress Công Nghệ..." className="rounded-xl" />
          </Form.Item>

          <Form.Item
            name="url"
            label={<span className="text-xs font-bold text-slate-300">Đường link (RSS hoặc Link Chuyên mục web):</span>}
            rules={[{ required: true, message: 'Vui lòng nhập đường dẫn URL!' }]}
          >
            <Input
              placeholder="https://vnexpress.net/rss/bat-dong-san.rss hoặc https://dantri.com.vn/bat-dong-san.htm"
              className="rounded-xl"
            />
          </Form.Item>

          <Form.Item
            name="topic"
            label={<span className="text-xs font-bold text-slate-300">Chủ đề phân loại:</span>}
            rules={[{ required: true, message: 'Vui lòng chọn chủ đề!' }]}
          >
            <Select styles={{ popup: { root: { background: '#172232' } } }} className="rounded-xl">
              <Option value="bds">Bất Động Sản</Option>
              <Option value="finance">Tài Chính & Kinh Tế</Option>
              <Option value="tech">Công Nghệ & AI</Option>
              <Option value="lifestyle">Thời Sự & Đời Sống</Option>
              <Option value="custom">Chủ đề khác</Option>
            </Select>
          </Form.Item>

          <div className="flex items-center justify-end gap-3 pt-3">
            <Button onClick={() => setAddChannelModalOpen(false)} className="rounded-xl">
              Hủy
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={addingChannel}
              className="!bg-cyan-600 rounded-xl font-bold"
            >
              Lưu kênh theo dõi
            </Button>
          </div>
        </Form>
      </Modal>

      {/* ── MODAL: LÊN LỊCH ĐĂNG BÀI HÀNG LOẠT (BATCH QUEUE) ────────── */}
      <Modal
        open={batchModalOpen}
        onCancel={() => setBatchModalOpen(false)}
        footer={null}
        width={580}
        title={
          <span className="text-base font-bold text-slate-100 flex items-center gap-2">
            <ThunderboltOutlined className="text-cyan-400" /> Lên lịch xuất bản {selectedArticleUrls.size} bài viết
          </span>
        }
        styles={{
          body: { background: '#111a28' },
          header: { background: '#111a28' },
        }}
      >
        <Form
          form={batchForm}
          layout="vertical"
          onFinish={handleConfirmBatchQueue}
          className="mt-4 space-y-4"
        >
          {/* Chọn nơi đăng: Fanpage/Nick cá nhân hay Nhóm Facebook */}
          <Form.Item
            label={<span className="text-xs font-bold text-slate-300">Loại đích xuất bản:</span>}
            name="postingTarget"
          >
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setPostingTargetType('FANPAGE');
                  batchForm.setFieldValue('postingTarget', 'FANPAGE');
                }}
                className={`p-3 rounded-xl border text-xs font-bold text-left transition-all ${postingTargetType === 'FANPAGE'
                  ? 'bg-blue-950/70 border-blue-500 text-blue-200'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                  }`}
              >
                👤 Trang / Nick Cá Nhân (Via)
              </button>
              <button
                type="button"
                onClick={() => {
                  setPostingTargetType('GROUP');
                  batchForm.setFieldValue('postingTarget', 'GROUP');
                }}
                className={`p-3 rounded-xl border text-xs font-bold text-left transition-all ${postingTargetType === 'GROUP'
                  ? 'bg-blue-950/70 border-blue-500 text-blue-200'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                  }`}
              >
                👥 Nhóm Facebook (Groups)
              </button>
            </div>
          </Form.Item>

          {/* Chọn Nick/Fanpage đăng bài */}
          <Form.Item
            name="targetFanpageId"
            label={<span className="text-xs font-bold text-slate-300">Tài khoản đăng bài (Nick cá nhân / Via / Page):</span>}
            rules={[{ required: true, message: 'Vui lòng chọn tài khoản đăng bài!' }]}
          >
            <Select
              placeholder="Chọn tài khoản hoặc Via..."
              className="rounded-xl"
              styles={{ popup: { root: { background: '#172232' } } }}
            >
              {socialAccounts.map((acc) => (
                <Option key={acc.id} value={acc.platformAccountId || String(acc.id)}>
                  <div className="flex items-center justify-between py-0.5">
                    <span className="font-semibold text-slate-100">
                      {acc.pageName || acc.platformAccountId}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {acc.accountType === 'PERSONAL_COOKIE' ? 'Via Cookie' : 'Page API'}
                    </span>
                  </div>
                </Option>
              ))}
            </Select>
          </Form.Item>

          {/* Nếu chọn nhóm Facebook: Cho chọn nhóm */}
          {postingTargetType === 'GROUP' && (
            <Form.Item
              name="targetGroupNames"
              label={<span className="text-xs font-bold text-slate-300">Chọn nhóm Facebook xuất bản:</span>}
              rules={[{ required: true, message: 'Vui lòng chọn ít nhất 1 nhóm!' }]}
            >
              <Select
                mode="multiple"
                placeholder="Chọn một hoặc nhiều nhóm..."
                className="rounded-xl"
                styles={{ popup: { root: { background: '#172232' } } }}
              >
                {fbGroups.map((g) => (
                  <Option key={g.id} value={g.groupName || g.groupId}>
                    {g.groupName}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          )}

          {/* Thiết lập thời gian */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Form.Item
              name="scheduledAt"
              label={<span className="text-xs font-bold text-slate-300">Thời gian bắt đầu đăng:</span>}
              rules={[{ required: true, message: 'Chọn giờ bắt đầu!' }]}
            >
              <DatePicker
                showTime
                format="YYYY-MM-DD HH:mm"
                className="w-full rounded-xl"
              />
            </Form.Item>

            <Form.Item
              name="intervalMinutes"
              label={<span className="text-xs font-bold text-slate-300">Giãn cách giữa mỗi bài (phút):</span>}
            >
              <Select className="w-full rounded-xl" styles={{ popup: { root: { background: '#172232' } } }}>
                <Option value={15}>15 phút / bài</Option>
                <Option value={30}>30 phút / bài</Option>
                <Option value={45}>45 phút / bài</Option>
                <Option value={60}>60 phút / bài (1 tiếng)</Option>
                <Option value={120}>120 phút / bài (2 tiếng)</Option>
              </Select>
            </Form.Item>
          </div>

          <Form.Item
            name="colorBackground"
            valuePropName="checked"
            className="!mb-3"
          >
            <div className="flex items-center justify-between p-3 rounded-xl bg-red-950/25 border border-red-800/40">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-red-300">
                  <span>🔴 Đăng bài dạng Status Nền Đỏ (Facebook Color Post)</span>
                  <Tag color="error" className="!m-0 text-[10px] font-mono">Tối đa 130 ký tự</Tag>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Facebook sẽ chọn nền màu đỏ giật tít hook (&lt; 130 ký tự). Toàn bộ nội dung bài báo, nguồn CafeF/VnExpress và hashtag sẽ tự động thả ở bình luận đầu tiên!
                </div>
              </div>
              <Switch />
            </div>
          </Form.Item>

          <Form.Item
            name="publishNow"
            valuePropName="checked"
            className="!mb-2"
          >
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800/40 border border-slate-700/60">
              <div>
                <div className="text-xs font-bold text-slate-200">Đăng ngay bài đầu tiên?</div>
                <div className="text-[11px] text-slate-400">Bài đầu tiên sẽ được đăng ngay lập tức, các bài sau giãn cách theo lịch.</div>
              </div>
              <Switch />
            </div>
          </Form.Item>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <Button onClick={() => setBatchModalOpen(false)} className="rounded-xl">
              Hủy
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={batchSubmitting}
              className="!bg-gradient-to-r !from-cyan-500 !to-blue-600 rounded-xl font-bold px-6 h-10 shadow-lg shadow-blue-900/30"
            >
              Xác nhận lên lịch {selectedArticleUrls.size} bài
            </Button>
          </div>
        </Form>
      </Modal>

      {/* ── MODAL: XEM CHI TIẾT BÀI ĐÃ LẤY / ĐÃ ĐĂNG ── */}
      <Modal
        open={historyDetailModalOpen}
        onCancel={() => setHistoryDetailModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setHistoryDetailModalOpen(false)} className="rounded-xl">
            Đóng
          </Button>,
          viewingHistoryItem?.publishedPostUrl && (
            <a
              key="fb"
              href={viewingHistoryItem.publishedPostUrl}
              target="_blank"
              rel="noreferrer"
              className="ant-btn ant-btn-primary rounded-xl !bg-blue-600"
            >
              Mở trên Facebook 🔗
            </a>
          ),
        ]}
        width={750}
        title={
          <div className="flex items-center gap-2 text-slate-100">
            <HistoryOutlined className="text-purple-400" />
            <span>Chi Tiết Bài Báo Trong Lịch Sử</span>
          </div>
        }
      >
        {viewingHistoryItem && (
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Tag color="purple" className="font-bold">
                📌 Fanpage: {viewingHistoryItem.pageName || 'Mặc định'}
              </Tag>
              {viewingHistoryItem.status === 'PUBLISHED' ? (
                <Tag color="success" className="font-bold">
                  ✓ ĐÃ ĐĂNG THÀNH CÔNG
                </Tag>
              ) : viewingHistoryItem.status === 'PENDING' ? (
                <Tag color="warning" className="font-bold">
                  ⏳ CHỜ ĐĂNG
                </Tag>
              ) : (
                <Tag color="error" className="font-bold">
                  ✕ {viewingHistoryItem.status}
                </Tag>
              )}
              {viewingHistoryItem.publishedAt && (
                <span className="text-xs text-slate-400">
                  Thời gian: {dayjs(viewingHistoryItem.publishedAt).format('HH:mm:ss DD/MM/YYYY')}
                </span>
              )}
            </div>

            <h3 className="text-base font-bold text-slate-100">
              {viewingHistoryItem.title}
            </h3>

            {viewingHistoryItem.originalUrl && (
              <div className="text-xs text-slate-400">
                <span>Link báo gốc: </span>
                <a
                  href={viewingHistoryItem.originalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-400 hover:underline break-all"
                >
                  {viewingHistoryItem.originalUrl}
                </a>
              </div>
            )}

            {/* Full text content */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400 font-bold">
                <span>NỘI DUNG ĐĂNG:</span>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    navigator.clipboard.writeText(viewingHistoryItem.content);
                    message.success('Đã sao chép nội dung bài viết!');
                  }}
                  className="text-[11px]"
                >
                  Sao chép
                </Button>
              </div>
              <div className="p-4 bg-slate-900 rounded-xl border border-slate-800 text-slate-200 text-xs whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
                {viewingHistoryItem.content}
              </div>
            </div>

            {/* Media images */}
            {viewingHistoryItem.mediaUrls && (
              <div className="space-y-2">
                <span className="text-xs text-slate-400 font-bold">HÌNH ẢNH KÈM THEO:</span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {viewingHistoryItem.mediaUrls.split(',').map((url, idx) => {
                    const clean = url.trim();
                    if (!clean) return null;
                    return (
                      <a key={idx} href={clean} target="_blank" rel="noreferrer">
                        <img
                          src={clean}
                          alt=""
                          className="w-full h-28 object-cover rounded-lg border border-slate-800 hover:border-cyan-400 transition-all cursor-pointer"
                        />
                      </a>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
