import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Form, Select, Input, Button, Tag, Space, Radio, DatePicker,
  Checkbox, message, Table, Popconfirm, Tooltip, Upload,
  Divider, Statistic, Row, Col, Tabs, Typography, Segmented, Image
} from 'antd';
import {
  BankOutlined, ThunderboltFilled, ClockCircleOutlined, TeamOutlined,
  UploadOutlined, LinkOutlined, DeleteOutlined, ReloadOutlined,
  CheckCircleOutlined, SyncOutlined, CloseCircleOutlined, FacebookFilled,
  EyeOutlined, PlayCircleOutlined, SendOutlined,
  RobotOutlined, SearchOutlined, GlobalOutlined, CopyOutlined,
  FileTextOutlined, FilterOutlined, UserOutlined, ClearOutlined,
  BarChartOutlined, EditOutlined, UnorderedListOutlined, LoadingOutlined,
  RedoOutlined, CloseOutlined
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import api from '../config/axios';
import { PostDetailModal } from '../components/modals/PostDetailModal';

const { TextArea } = Input;
const { Option } = Select;
const { Paragraph, Text } = Typography;

// 3 Group nhận job Kinh Tế theo yêu cầu
export const ECONOMY_GROUPS = [
  {
    id: '442952455895343',
    name: 'Vietnam Economy News 11',
    cleanName: 'Vietnam Economy News',
    description: 'Tin tức kinh tế, tài chính vĩ mô và thị trường kinh doanh',
    fbUrl: 'https://www.facebook.com/groups/442952455895343',
    tagColor: 'orange',
  },
  {
    id: '414495725353336',
    name: 'Hóng Hớt Kinh Tế 12',
    cleanName: 'Hóng Hớt Kinh Tế',
    description: 'Thảo luận kinh tế, chuyện thương trường, đầu tư và tài chính',
    fbUrl: 'https://www.facebook.com/groups/414495725353336',
    tagColor: 'blue',
  },
  {
    id: '391775555405184',
    name: 'Vietnam Business News 13',
    cleanName: 'Vietnam Business News',
    description: 'Cộng đồng doanh nghiệp, tin vắn thương mại và kinh tế Việt Nam',
    fbUrl: 'https://www.facebook.com/groups/391775555405184',
    tagColor: 'green',
  },
];

interface SocialAccount {
  id: number;
  platform?: string;
  accountType?: string;
  tokenStatus?: string;
  pageName?: string;
  platformAccountId?: string;
  accessToken?: string;
}

interface PostQueue {
  id: number;
  campaignId?: number;
  originalUrl?: string;
  title?: string;
  content?: string;
  mediaUrls?: string[];
  status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'CANCELLED';
  scheduledAt?: string;
  publishedAt?: string;
  targetGroupNames?: string;
  targetFanpageId?: string;
  errorMessage?: string;
  publishedPostUrl?: string;
  publishedGroupPostUrls?: string;
  affiliateLink?: string;
}

const STORAGE_SELECTED_PAGE = 'economy_job_selected_page';
const STORAGE_LAST_STAGGER = 'economy_job_stagger_minutes';

// Chuẩn hóa tên Group để khớp chuẩn với file Excel báo cáo
export const normalizeGroupName = (rawNameOrId: string = ''): string => {
  if (rawNameOrId.includes('442952455895343') || rawNameOrId.toLowerCase().includes('vietnam economy')) {
    return 'Vietnam Economy News';
  }
  if (rawNameOrId.includes('414495725353336') || rawNameOrId.toLowerCase().includes('hóng hớt kinh tế') || rawNameOrId.toLowerCase().includes('hong hot')) {
    return 'Hóng Hớt Kinh Tế';
  }
  if (rawNameOrId.includes('391775555405184') || rawNameOrId.toLowerCase().includes('vietnam business') || rawNameOrId.toLowerCase().includes('business news')) {
    return 'Vietnam Business News';
  }
  return rawNameOrId.replace(/^GROUP_ONLY_ANON:|^GROUP_ONLY:/, '').replace(/\s*\d+\s*$/, '').trim() || 'Nhóm Kinh Tế';
};

// Chuẩn hóa tên Nick đăng bài (Loại bỏ các tiền tố để khớp chuẩn cột Nick trong Excel: Lâm Phước Hải, Làm Sen, Thành An...)
export const normalizeNickName = (rawName: string = ''): string => {
  if (!rawName) return '—';
  let clean = rawName.replace(/^👤\s*Nick Cá Nhân\s*\((.*?)\)$/i, '$1');
  clean = clean.replace(/^👤\s*/i, '');
  clean = clean.replace(/\(Ẩn danh\)/i, '').trim();
  if (clean.toLowerCase() === 'làm phước hai') return 'Lâm Phước Hải';
  if (clean.toLowerCase() === 'làm phước') return 'Làm Phước';
  return clean || rawName;
};

// Trích xuất link Facebook đã xuất bản
export const getEffectivePostUrl = (record: PostQueue): string => {
  if (record.publishedPostUrl && record.publishedPostUrl.trim().startsWith('http')) {
    return record.publishedPostUrl.trim();
  }
  if (record.publishedGroupPostUrls) {
    const urls = record.publishedGroupPostUrls.split(',').map((u) => u.trim()).filter((u) => u.startsWith('http'));
    if (urls.length > 0) return urls[0];
  }
  return '';
};

const EconomyJob: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState<'COMPOSER' | 'REPORT' | 'ALL_QUEUE'>('COMPOSER');
  const [reportViewMode, setReportViewMode] = useState<'PUBLISHED' | 'PENDING'>('PUBLISHED');
  const [detailPost, setDetailPost] = useState<PostQueue | null>(null);

  // ── State Báo Cáo Hàng Ngày ──
  const [selectedReportDate, setSelectedReportDate] = useState<string>(() => dayjs().format('YYYY-MM-DD'));
  const [selectedReportGroupFilter, setSelectedReportGroupFilter] = useState<string>('ALL');
  const [selectedReportNickFilter, setSelectedReportNickFilter] = useState<string>('ALL');
  const [reportSearchText, setReportSearchText] = useState<string>('');

  // Mode: Dán link cào (mặc định) hay Tự soạn bài
  const [inputMode, setInputMode] = useState<'MANUAL' | 'LINK'>('LINK');
  
  // Selected Groups (mặc định chọn cả 3 nhóm Kinh Tế)
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(
    ECONOMY_GROUPS.map((g) => g.id)
  );

  // Identity được chọn (Page hoặc Nick cá nhân phụ trách)
  const [selectedPageTarget, setSelectedPageTarget] = useState<string>(() => {
    return localStorage.getItem(STORAGE_SELECTED_PAGE) || '';
  });

  // Hẹn giờ hay Đăng ngay
  const [isPublishNow, setIsPublishNow] = useState<boolean>(true);
  const [scheduledTime, setScheduledTime] = useState<Dayjs | null>(() => dayjs().add(15, 'minute'));

  // Giãn cách giữa các nhóm (phút)
  const [staggerMinutes, setStaggerMinutes] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_LAST_STAGGER);
    return saved ? parseInt(saved, 10) : 10;
  });

  // Ẩn danh vào Group
  const [isAnonymous, setIsAnonymous] = useState<boolean>(false);

  // Caption và Media thủ công (khi ở chế độ Tự soạn bài)
  const [manualContent, setManualContent] = useState<string>('');

  // Upload ảnh/video thủ công
  const [uploadedMediaUrls, setUploadedMediaUrls] = useState<string[]>([]);
  const [isUploadingMedia, setIsUploadingMedia] = useState<boolean>(false);

  // Dán link cào bài (hỗ trợ 1 link hoặc nhiều link hàng loạt)
  const [scrapeUrl, setScrapeUrl] = useState<string>('');
  const parsedUrls = useMemo(() => {
    if (!scrapeUrl.trim()) return [];
    return scrapeUrl
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('http://') || l.startsWith('https://'));
  }, [scrapeUrl]);
  const [isScraping, setIsScraping] = useState<boolean>(false);
  const [scrapedPreview, setScrapedPreview] = useState<{
    title?: string;
    content?: string;
    mediaUrls?: string[];
    author?: string;
  } | null>(null);

  // Caption và Media đã cào được (cho phép người dùng xem và chỉnh sửa trực tiếp)
  const [scrapedCustomCaption, setScrapedCustomCaption] = useState<string>('');
  const [scrapedMediaUrls, setScrapedMediaUrls] = useState<string[]>([]);
  const lastScrapedUrlRef = useRef<string>('');

  // Dán nhanh từ bộ nhớ tạm Clipboard
  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        const urls = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
        if (urls.length > 0) {
          setScrapeUrl((prev) => {
            const trimmed = prev.trim();
            return trimmed ? `${trimmed}\n${urls.join('\n')}` : urls.join('\n');
          });
          message.success(`Đã dán ${urls.length} đường dẫn từ clipboard!`);
        } else {
          setScrapeUrl((prev) => {
            const trimmed = prev.trim();
            return trimmed ? `${trimmed}\n${text.trim()}` : text.trim();
          });
          message.info('Đã dán nội dung từ clipboard.');
        }
      }
    } catch {
      message.info('Vui lòng dùng phím tắt Ctrl+V hoặc Cmd+V để dán link trực tiếp.');
    }
  };

  // Xử lý cào link (hỗ trợ tự động cào hoặc bấm nút cào)
  const handlePreviewScrape = async (overrideUrl?: string) => {
    const targetUrl = (overrideUrl || parsedUrls[0] || scrapeUrl).trim();
    if (!targetUrl) {
      if (!overrideUrl) message.warning('Vui lòng dán link bài viết cần cào trước!');
      return;
    }
    setIsScraping(true);
    try {
      const res = await api.post('/queue/preview-url', { url: targetUrl });
      if (res.data?.success && res.data?.item) {
        const item = res.data.item;
        setScrapedPreview(item);
        const caption = item.content || item.title || '';
        setScrapedCustomCaption(caption);

        const urls = (item.mediaUrls || []) as string[];
        setScrapedMediaUrls(urls);
        message.success(`Đã tự động cào nội dung & media từ bài viết!`);
      } else {
        setScrapedPreview(null);
        if (!overrideUrl) {
          message.warning(res.data?.message || 'Không trích xuất được nội dung từ link này');
        }
      }
    } catch (err: any) {
      if (!overrideUrl) {
        message.error(err.response?.data?.message || err.message || 'Lỗi khi cào link bài viết');
      }
    } finally {
      setIsScraping(false);
    }
  };

  // Tự động cào khi người dùng dán hoặc nhập link (debounce 600ms y hệt bên Đăng Tự Động)
  useEffect(() => {
    if (inputMode !== 'LINK') return;
    const firstUrl = parsedUrls[0];
    if (!firstUrl) {
      lastScrapedUrlRef.current = '';
      setScrapedPreview(null);
      setScrapedMediaUrls([]);
      setScrapedCustomCaption('');
      return;
    }
    if (firstUrl === lastScrapedUrlRef.current) return;

    const timer = setTimeout(() => {
      lastScrapedUrlRef.current = firstUrl;
      handlePreviewScrape(firstUrl);
    }, 600);

    return () => clearTimeout(timer);
  }, [parsedUrls, inputMode]);

  // AI rewrite loading
  const [isAiRewriting, setIsAiRewriting] = useState<boolean>(false);

  // Filter trong bảng lịch sử
  const [historyFilter, setHistoryFilter] = useState<string>('ALL');
  const [searchHistoryText, setSearchHistoryText] = useState<string>('');

  // 1. Lấy danh sách kết nối (Connections) để lấy Page & Group
  const { data: rawSocialAccounts = [], isLoading: isLoadingAccounts } = useQuery({
    queryKey: ['socialAccounts'],
    queryFn: async () => (await api.get('/connections')).data as SocialAccount[],
  });

  // Giải mã tên Nick / Page từ targetFanpageId
  const resolvePosterIdentityName = (record: PostQueue): string => {
    if (record.targetFanpageId) {
      const raw = record.targetFanpageId.trim();
      const parts = raw.split(':');

      if (parts.length >= 3) {
        const dbId = parts[2].trim();
        const platformId = parts[0].trim();
        const matched = (rawSocialAccounts || []).find(
          (a) => String(a.id) === dbId || a.platformAccountId === platformId
        );
        if (matched?.pageName) return matched.pageName;
      }

      if (parts.length === 2) {
        const part1 = parts[1].trim();
        if (part1 && part1 !== 'PERSONAL_COOKIE' && part1 !== 'PAGE_TOKEN') {
          return part1;
        }
        const platformId = parts[0].trim();
        const matched = (rawSocialAccounts || []).find(
          (a) => a.platformAccountId === platformId || String(a.id) === platformId
        );
        if (matched?.pageName) return matched.pageName;
      }

      const matched = (rawSocialAccounts || []).find(
        (a) => String(a.id) === raw || a.platformAccountId === raw || a.platformAccountId === parts[0]
      );
      if (matched?.pageName) return matched.pageName;
    }

    const defaultAccount = (rawSocialAccounts || []).find((a) => a.accessToken);
    if (defaultAccount?.pageName) return defaultAccount.pageName;

    return 'Chưa đặt';
  };

  // Lọc các Fanpage & Nick cá nhân có thể đăng bài
  const postingIdentities = useMemo(() => {
    const list: { label: string; value: string; account: SocialAccount; isExpired: boolean; isPersonal: boolean }[] = [];
    const seenCUsers = new Set<string>();

    (rawSocialAccounts || []).forEach((acc) => {
      // Fanpage
      if (acc.platform === 'FACEBOOK_PAGE' && (acc.accountType === 'PERSONAL_COOKIE' || !acc.accountType)) {
        const val = `${acc.platformAccountId}:${acc.accountType || 'PERSONAL_COOKIE'}:${acc.id}`;
        list.push({
          label: acc.pageName || `Fanpage ${acc.platformAccountId}`,
          value: val,
          account: acc,
          isExpired: acc.tokenStatus === 'EXPIRED',
          isPersonal: false,
        });
      }

      // Nick cá nhân / Via
      const isPersonalType = acc.platform === 'FACEBOOK_PERSONAL' || acc.platform === 'FACEBOOK_PROFILE' || acc.accountType === 'PERSONAL_PROFILE_COOKIE';
      const cUserMatch = acc.accessToken?.match(/c_user=(\d+)/);
      const cUser = cUserMatch ? cUserMatch[1] : null;

      if ((isPersonalType || (cUser && !seenCUsers.has(cUser))) && acc.accessToken) {
        if (cUser) seenCUsers.add(cUser);
        const val = `${acc.platformAccountId || 'PERSONAL_PROFILE'}:${acc.accountType || 'PERSONAL_COOKIE'}:${acc.id}`;
        list.push({
          label: `👤 Nick cá nhân (${acc.pageName || cUser || acc.platformAccountId})`,
          value: val,
          account: acc,
          isExpired: acc.tokenStatus === 'EXPIRED',
          isPersonal: true,
        });
      }
    });

    return list.sort((a, b) => {
      if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
      return (a.account.pageName || a.label).localeCompare(b.account.pageName || b.label, 'vi');
    });
  }, [rawSocialAccounts]);

  // Tự động gán page phụ trách mặc định nếu chưa chọn
  useEffect(() => {
    if (postingIdentities.length > 0) {
      const saved = localStorage.getItem(STORAGE_SELECTED_PAGE);
      const exists = postingIdentities.some((p) => p.value === saved);
      if (exists && saved) {
        setSelectedPageTarget(saved);
        form.setFieldValue('targetFanpageId', saved);
      } else if (!selectedPageTarget) {
        const defaultPage = postingIdentities.find((p) => !p.isExpired) || postingIdentities[0];
        if (defaultPage) {
          setSelectedPageTarget(defaultPage.value);
          form.setFieldValue('targetFanpageId', defaultPage.value);
          localStorage.setItem(STORAGE_SELECTED_PAGE, defaultPage.value);
        }
      }
    }
  }, [postingIdentities, selectedPageTarget, form]);

  // Thông tin sức khỏe của 3 group từ hệ thống
  const groupHealthMap = useMemo(() => {
    const map = new Map<string, any>();
    (rawSocialAccounts || [])
      .filter((a) => a.platform === 'FACEBOOK_GROUP')
      .forEach((g) => {
        if (g.platformAccountId) map.set(g.platformAccountId, g);
      });
    return map;
  }, [rawSocialAccounts]);

  // 2. Fetch danh sách bài trong hàng đợi của 3 nhóm kinh tế
  const { data: allPosts = [], isLoading: isLoadingPosts, refetch: refetchPosts } = useQuery({
    queryKey: ['postQueueEconomyJob'],
    queryFn: async () => {
      // 1 request cho mọi campaign
      const response = await api.get('/queue/recent', { params: { days: 3 } });
      const posts: PostQueue[] = Array.isArray(response.data) ? response.data : [];

      // Lọc các bài đăng có liên quan tới 3 Group Kinh Tế
      const targetIds = ECONOMY_GROUPS.map((g) => g.id);
      return posts.filter((p) => {
        if (!p.targetGroupNames) return false;
        return targetIds.some((id) => p.targetGroupNames!.includes(id));
      });
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  // ── DỮ LIỆU BÁO CÁO THEO NGÀY ĐƯỢC CHỌN ──
  const dailyReportData = useMemo(() => {
    const targetDateStr = selectedReportDate; // YYYY-MM-DD

    // Lọc các bài đã đăng (PUBLISHED) có ngày đăng khớp với ngày chọn
    const publishedForDate = allPosts.filter((p) => {
      if (p.status !== 'PUBLISHED') return false;
      const dateStr = p.publishedAt ? dayjs(p.publishedAt).format('YYYY-MM-DD') : (p.scheduledAt ? dayjs(p.scheduledAt).format('YYYY-MM-DD') : '');
      return dateStr === targetDateStr;
    });

    // Thống kê theo Group và Nick
    const groupMap = new Map<string, { count: number; nicks: Map<string, number>; posts: PostQueue[] }>();
    const allNicksSet = new Set<string>();

    ECONOMY_GROUPS.forEach((g) => {
      groupMap.set(g.cleanName, { count: 0, nicks: new Map<string, number>(), posts: [] });
    });

    publishedForDate.forEach((p) => {
      const gName = normalizeGroupName(p.targetGroupNames || '');
      const rawNick = resolvePosterIdentityName(p);
      const nickName = normalizeNickName(rawNick);
      allNicksSet.add(nickName);

      if (!groupMap.has(gName)) {
        groupMap.set(gName, { count: 0, nicks: new Map<string, number>(), posts: [] });
      }

      const item = groupMap.get(gName)!;
      item.count += 1;
      item.nicks.set(nickName, (item.nicks.get(nickName) || 0) + 1);
      item.posts.push(p);
    });

    // Danh sách dòng phẳng để điền vào bảng báo cáo (khớp y hệt từng dòng file Excel)
    const reportRows = publishedForDate.map((p, index) => {
      const gName = normalizeGroupName(p.targetGroupNames || '');
      const rawNick = resolvePosterIdentityName(p);
      const nickName = normalizeNickName(rawNick);
      const postUrl = getEffectivePostUrl(p);
      const publishTime = p.publishedAt ? dayjs(p.publishedAt) : (p.scheduledAt ? dayjs(p.scheduledAt) : dayjs());

      return {
        key: `${p.id}_${index}`,
        post: p,
        dateFormatted: publishTime.format('DD/MM/YYYY'),
        timeFormatted: publishTime.format('HH:mm'),
        postUrl: postUrl,
        groupName: gName,
        nickName: nickName,
        title: p.title || p.content?.slice(0, 80) || 'Bản tin kinh tế',
      };
    });

    return {
      totalPosts: publishedForDate.length,
      groupMap,
      reportRows,
      availableNicks: Array.from(allNicksSet),
    };
  }, [allPosts, selectedReportDate, rawSocialAccounts]);

  // Bộ lọc bảng báo cáo theo Group, Nick và Search
  const filteredReportRows = useMemo(() => {
    return dailyReportData.reportRows.filter((r) => {
      if (selectedReportGroupFilter !== 'ALL' && r.groupName !== selectedReportGroupFilter) {
        return false;
      }
      if (selectedReportNickFilter !== 'ALL' && r.nickName !== selectedReportNickFilter) {
        return false;
      }
      if (reportSearchText.trim()) {
        const q = reportSearchText.trim().toLowerCase();
        const matchTitle = r.title.toLowerCase().includes(q);
        const matchNick = r.nickName.toLowerCase().includes(q);
        const matchGroup = r.groupName.toLowerCase().includes(q);
        const matchUrl = r.postUrl.toLowerCase().includes(q);
        return matchTitle || matchNick || matchGroup || matchUrl;
      }
      return true;
    });
  }, [dailyReportData.reportRows, selectedReportGroupFilter, selectedReportNickFilter, reportSearchText]);

  // ── DANH SÁCH BÀI ĐANG CHỜ ĐĂNG (PENDING) CHO 3 NHÓM KINH TẾ ──
  const pendingPosts = useMemo(() => {
    return allPosts
      .filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING')
      .sort((a, b) => {
        const timeA = a.scheduledAt ? dayjs(a.scheduledAt).valueOf() : a.id;
        const timeB = b.scheduledAt ? dayjs(b.scheduledAt).valueOf() : b.id;
        return timeA - timeB;
      });
  }, [allPosts]);

  const filteredPendingPosts = useMemo(() => {
    return pendingPosts.filter((p) => {
      if (selectedReportGroupFilter !== 'ALL') {
        const targetIds = ECONOMY_GROUPS.filter((g) => g.cleanName === selectedReportGroupFilter).map((g) => g.id);
        const matches = targetIds.some((id) => p.targetGroupNames?.includes(id));
        if (!matches) return false;
      }
      if (selectedReportNickFilter !== 'ALL') {
        const rawNick = resolvePosterIdentityName(p);
        const nickName = normalizeNickName(rawNick);
        if (nickName !== selectedReportNickFilter) return false;
      }
      if (reportSearchText.trim()) {
        const q = reportSearchText.trim().toLowerCase();
        const matchTitle = (p.title || '').toLowerCase().includes(q);
        const matchContent = (p.content || '').toLowerCase().includes(q);
        const matchUrl = (p.originalUrl || '').toLowerCase().includes(q);
        const matchId = String(p.id).includes(q);
        return matchTitle || matchContent || matchUrl || matchId;
      }
      return true;
    });
  }, [pendingPosts, selectedReportGroupFilter, selectedReportNickFilter, reportSearchText, rawSocialAccounts]);

  // ── HÀNH ĐỘNG SAO CHÉP CHO GOOGLE SHEETS / EXCEL (1-CLICK) ──
  const handleCopyForGoogleSheets = () => {
    const rowsToCopy = filteredReportRows.length > 0 ? filteredReportRows : dailyReportData.reportRows;

    if (rowsToCopy.length === 0) {
      message.warning(`Không có bài đăng nào trong ngày ${dayjs(selectedReportDate).format('DD/MM/YYYY')} để sao chép!`);
      return;
    }

    // Định dạng Tab-Separated Values (TSV) khớp chuẩn các cột file Sheet của bạn:
    // Cột B: Ngày (01/10/2026) | Cột C: Link bài | Cột D: [Trống] | Cột E: Group | Cột F: Nick
    const lines = rowsToCopy.map((r) => {
      const date = r.dateFormatted;
      const link = r.postUrl || '';
      const emptyColD = '';
      const group = r.groupName;
      const nick = r.nickName;
      return `${date}\t${link}\t${emptyColD}\t${group}\t${nick}`;
    });

    const tsvContent = lines.join('\n');
    navigator.clipboard.writeText(tsvContent).then(() => {
      message.success({
        content: `📋 ĐÃ SAO CHÉP ${rowsToCopy.length} DÒNG! Bây giờ bạn chỉ cần mở file Google Sheets / Excel, chọn ô ngày đầu tiên và bấm Ctrl+V (hoặc Cmd+V) là xong!`,
        duration: 7,
      });
    }).catch(() => {
      message.error('Không thể tự động sao chép. Vui lòng cấp quyền clipboard cho trình duyệt!');
    });
  };

  // ── SAO CHÉP CHỈ DANH SÁCH LINK BÀI VIẾT ──
  const handleCopyLinksOnly = () => {
    const rowsToCopy = filteredReportRows.length > 0 ? filteredReportRows : dailyReportData.reportRows;
    const links = rowsToCopy.map((r) => r.postUrl).filter(Boolean);

    if (links.length === 0) {
      message.warning('Không tìm thấy link bài viết nào để sao chép!');
      return;
    }

    navigator.clipboard.writeText(links.join('\n')).then(() => {
      message.success(`🔗 Đã sao chép ${links.length} link bài viết trực tiếp vào bộ nhớ tạm!`);
    });
  };

  // ── SAO CHÉP TIN NHẮN BÁO CÁO ZALO / TELEGRAM ──
  const handleCopyTextReport = () => {
    const dateFormatted = dayjs(selectedReportDate).format('DD/MM/YYYY');
    let text = `📊 BÁO CÁO ĐĂNG BÀI JOB KINH TẾ · NGÀY ${dateFormatted}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    ECONOMY_GROUPS.forEach((g) => {
      const info = dailyReportData.groupMap.get(g.cleanName);
      const count = info?.count || 0;
      text += `📌 ${g.cleanName}: ${count} bài\n`;
      if (info && info.nicks.size > 0) {
        info.nicks.forEach((nickCount, nickName) => {
          text += `   • ${nickName}: ${nickCount} bài\n`;
        });
      }
    });

    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `👉 TỔNG CỘNG HÔM NAY: ${dailyReportData.totalPosts} bài đã xuất bản thành công!`;

    navigator.clipboard.writeText(text).then(() => {
      message.success('💬 Đã sao chép tin nhắn báo cáo vắn tắt vào bộ nhớ tạm!');
    });
  };

  // Sao chép 1 dòng đơn lẻ dạng TSV cho Google Sheets
  const handleCopySingleRow = (record: any) => {
    const tsv = `${record.dateFormatted}\t${record.postUrl || ''}\t\t${record.groupName}\t${record.nickName}`;
    navigator.clipboard.writeText(tsv).then(() => {
      message.success(`Đã copy dòng bài ${record.nickName} (${record.groupName})!`);
    });
  };

  // Thống kê nhanh toàn bộ
  const overallStats = useMemo(() => {
    const total = allPosts.length;
    const published = allPosts.filter((p) => p.status === 'PUBLISHED').length;
    const pending = allPosts.filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING').length;
    const failed = allPosts.filter((p) => p.status === 'FAILED' || p.status === 'CANCELLED').length;

    const todayStr = dayjs().format('YYYY-MM-DD');
    const publishedToday = allPosts.filter(
      (p) => p.status === 'PUBLISHED' && p.publishedAt && p.publishedAt.startsWith(todayStr)
    ).length;

    return { total, published, pending, failed, publishedToday };
  }, [allPosts]);

  // Danh sách bài đã lọc để hiển thị trong tab Hàng đợi
  const filteredAllPosts = useMemo(() => {
    return allPosts.filter((p) => {
      if (historyFilter !== 'ALL' && p.status !== historyFilter) {
        return false;
      }
      if (searchHistoryText.trim()) {
        const q = searchHistoryText.trim().toLowerCase();
        const contentMatch = (p.content || '').toLowerCase().includes(q);
        const titleMatch = (p.title || '').toLowerCase().includes(q);
        const idMatch = String(p.id).includes(q);
        return contentMatch || titleMatch || idMatch;
      }
      return true;
    }).sort((a, b) => b.id - a.id);
  }, [allPosts, historyFilter, searchHistoryText]);

  // Mutation đăng bài vào các Group Kinh Tế & Nghiện Xe
  const postMutation = useMutation({
    mutationFn: async () => {
      if (selectedGroupIds.length === 0) {
        throw new Error('Vui lòng chọn ít nhất 1 nhóm nhận bài!');
      }
      if (!selectedPageTarget) {
        throw new Error('Vui lòng chọn Page/Nick phụ trách đăng bài!');
      }

      if (inputMode === 'LINK' && parsedUrls.length === 0) {
        throw new Error('Vui lòng dán ít nhất 1 link bài viết hợp lệ!');
      }

      if (inputMode === 'MANUAL' && !manualContent.trim() && uploadedMediaUrls.length === 0) {
        throw new Error('Vui lòng nhập nội dung bài viết hoặc đính kèm ảnh/video!');
      }

      const targetUrls = inputMode === 'LINK' && parsedUrls.length > 0
        ? parsedUrls
        : [`manual://post_economy_${Date.now()}`];

      const baseTime = isPublishNow ? dayjs() : (scheduledTime || dayjs());
      const expandedUrls: string[] = [];
      const expandedScheduledTimes: string[] = [];
      const expandedCustomCaptions: string[] = [];
      const expandedCustomMediaUrls: string[] = [];
      const expandedAffiliateLinks: string[] = [];
      const expandedTargetGroupNamesList: string[] = [];
      const expandedTargetFanpageIdsList: string[] = [];
      const expandedCommentDisabled: boolean[] = [];
      const expandedGroupCommentEnabled: boolean[] = [];
      const expandedIncludeCredits: boolean[] = [];
      const expandedColorBackgrounds: (boolean | string)[] = [];

      const commentText = (form.getFieldValue('commentText') || '').trim();
      const interArticleGapMinutes = Math.max(30, staggerMinutes * selectedGroupIds.length);

      targetUrls.forEach((urlItem, urlIdx) => {
        const articleOffset = urlIdx * interArticleGapMinutes;

        selectedGroupIds.forEach((groupId, gIdx) => {
          const groupOffset = gIdx * staggerMinutes;
          const postTime = (isPublishNow && urlIdx === 0 && gIdx === 0)
            ? dayjs()
            : baseTime.add(articleOffset + groupOffset, 'minute');

          expandedUrls.push(urlItem);
          expandedScheduledTimes.push(postTime.format('YYYY-MM-DDTHH:mm:ss'));
          
          // Khi dán nhiều link hàng loạt:
          // Link đầu tiên (#0) dùng caption và media đã xem trước/chỉnh sửa
          // Các link tiếp theo (#1, #2...) để rỗng để Playwright Worker tự động cào tiêu đề & tải ảnh/video riêng biệt của bài đó!
          const itemCaption = inputMode === 'LINK'
            ? (urlIdx === 0 ? scrapedCustomCaption : '')
            : manualContent;

          const itemMedia = inputMode === 'LINK'
            ? (urlIdx === 0 ? (scrapedMediaUrls.length > 0 ? scrapedMediaUrls.join(',') : '') : '')
            : uploadedMediaUrls.join(',');

          expandedCustomCaptions.push(itemCaption);
          expandedCustomMediaUrls.push(itemMedia);
          expandedAffiliateLinks.push(commentText);
          expandedTargetGroupNamesList.push(isAnonymous ? `GROUP_ONLY_ANON:${groupId}` : `GROUP_ONLY:${groupId}`);
          expandedTargetFanpageIdsList.push(selectedPageTarget);
          expandedCommentDisabled.push(!commentText);
          expandedGroupCommentEnabled.push(Boolean(commentText));
          expandedIncludeCredits.push(false);
          expandedColorBackgrounds.push(false);
        });
      });

      const pageId = selectedPageTarget.split(':')[0];

      const payload = {
        urls: expandedUrls,
        scheduledTimes: expandedScheduledTimes,
        pageId,
        targetFanpageId: selectedPageTarget,
        targetFanpageIds: expandedTargetFanpageIdsList,
        targetGroupNamesList: expandedTargetGroupNamesList,
        publishNow: isPublishNow,
        intervalMinutes: staggerMinutes,
        affiliateLink: commentText || undefined,
        affiliateLinks: expandedAffiliateLinks,
        commentDisabled: expandedCommentDisabled,
        groupCommentEnabled: expandedGroupCommentEnabled,
        includeCredits: expandedIncludeCredits,
        colorBackgrounds: expandedColorBackgrounds,
        customCaptions: expandedCustomCaptions,
        customMediaUrls: expandedCustomMediaUrls,
        forceRefresh: false,
      };

      const res = await api.post('/queue/add-from-urls', payload);
      return res.data;
    },
    onSuccess: (data) => {
      message.success(data?.message || 'Đã xếp bài vào hàng đợi đăng thành công!');
      form.setFieldsValue({ commentText: '' });
      setManualContent('');
      setUploadedMediaUrls([]);
      setScrapeUrl('');
      setScrapedPreview(null);
      setScrapedCustomCaption('');
      setScrapedMediaUrls([]);
      lastScrapedUrlRef.current = '';
      setIsPublishNow(true);
      setScheduledTime(dayjs().add(15, 'minute'));
      queryClient.invalidateQueries({ queryKey: ['postQueueEconomyJob'] });
      queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
    },
    onError: (err: any) => {
      message.error(err.response?.data?.message || err.message || 'Lỗi khi gửi bài đăng!');
    },
  });

  // Upload file trực tiếp lên server
  const handleCustomUpload = async ({ file, onSuccess, onError }: any) => {
    const formData = new FormData();
    formData.append('file', file);
    setIsUploadingMedia(true);
    try {
      const res = await api.post('/media/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data?.success && res.data?.url) {
        setUploadedMediaUrls((prev) => [...prev, res.data.url]);
        message.success(`Đã tải lên: ${file.name}`);
        onSuccess(res.data);
      } else {
        message.error(res.data?.message || 'Tải file thất bại');
        onError(new Error(res.data?.message));
      }
    } catch (e: any) {
      message.error(e.message || 'Lỗi khi upload media');
      onError(e);
    } finally {
      setIsUploadingMedia(false);
    }
  };

  // Viết lại AI cho nội dung bản tin kinh tế
  const handleAiRewrite = async () => {
    const current = inputMode === 'LINK' ? scrapedCustomCaption : manualContent;
    if (!current || !current.trim()) {
      message.warning('Vui lòng nhập hoặc cào nội dung cần viết lại trước!');
      return;
    }
    setIsAiRewriting(true);
    try {
      const prompt = `Hãy viết lại nội dung sau đây theo phong cách bản tin kinh tế tài chính chuyên nghiệp, hấp dẫn cho Facebook, dùng các biểu tượng cảm xúc hợp lý (📊, 📈, 💼, 💵, 🏢), có tiêu đề giật gân thu hút và tóm tắt các ý chính rõ ràng:\n\n${current}`;
      const res = await api.post('/tools/rewrite-article-ai', {
        title: 'Bản tin kinh tế',
        content: prompt,
        category: 'Kinh Tế',
      });
      if (res.data?.success && (res.data?.content || res.data?.rewrittenContent)) {
        const newText = res.data.content || res.data.rewrittenContent;
        if (inputMode === 'LINK') {
          setScrapedCustomCaption(newText);
        } else {
          setManualContent(newText);
        }
        message.success('🤖 AI đã viết lại bài chuẩn phong cách kinh tế!');
      } else {
        message.info('AI không trả về nội dung mới.');
      }
    } catch (e: any) {
      message.error(e.response?.data?.message || e.message || 'Lỗi khi gọi AI viết lại');
    } finally {
      setIsAiRewriting(false);
    }
  };

  // Thao tác với bài trong hàng đợi
  const handlePublishNow = async (id: number) => {
    try {
      await api.post(`/queue/${id}/publish`);
      message.success('🚀 Đã kích hoạt đăng bài ngay lập tức!');
      refetchPosts();
    } catch (e: any) {
      message.error(e.response?.data?.message || e.message || 'Lỗi khi kích hoạt đăng bài');
    }
  };

  const handleDeletePost = async (id: number) => {
    try {
      await api.delete(`/queue/${id}`);
      message.success('Đã xóa bài khỏi hàng đợi!');
      refetchPosts();
    } catch (e: any) {
      message.error(e.response?.data?.message || e.message || 'Lỗi khi xóa bài');
    }
  };

  // Cột bảng Báo Cáo Hàng Ngày (Khớp với file Excel)
  const reportColumns = [
    {
      title: 'Ngày (Cột B)',
      dataIndex: 'dateFormatted',
      key: 'date',
      width: 105,
      render: (text: string) => (
        <span className="font-mono font-bold text-xs text-slate-200 bg-slate-900 px-2 py-1 rounded border border-slate-700 inline-block">
          {text}
        </span>
      ),
    },
    {
      title: 'Link Bài Viết Facebook (Cột C)',
      dataIndex: 'postUrl',
      key: 'postUrl',
      render: (url: string) => {
        if (!url) {
          return <span className="text-[11px] text-amber-500 font-semibold italic">Đang cập nhật link...</span>;
        }
        return (
          <div className="flex items-center gap-1.5 max-w-sm">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 font-mono underline truncate max-w-[240px] inline-block"
              title={url}
            >
              {url}
            </a>
            <Tooltip title="Chép link Facebook này">
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(url);
                  message.success('Đã chép link!');
                }}
                className="text-slate-400 hover:text-white !p-1"
              />
            </Tooltip>
          </div>
        );
      },
    },
    {
      title: 'Tên Group (Cột E)',
      dataIndex: 'groupName',
      key: 'groupName',
      width: 190,
      render: (name: string) => {
        let color = 'default';
        if (name.includes('Economy')) color = 'gold';
        else if (name.includes('Hóng Hớt')) color = 'cyan';
        else if (name.includes('Business')) color = 'green';

        return (
          <Tag color={color} className="!text-xs font-bold !rounded-lg !px-2.5 !py-0.5">
            {name}
          </Tag>
        );
      },
    },
    {
      title: 'Nick Đăng Bài (Cột F)',
      dataIndex: 'nickName',
      key: 'nickName',
      width: 160,
      render: (name: string) => {
        return (
          <div className="flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-full bg-slate-800 text-blue-400 border border-slate-700 flex items-center justify-center text-xs font-bold shrink-0">
              <UserOutlined />
            </span>
            <span className="font-bold text-xs text-slate-100">
              {name}
            </span>
          </div>
        );
      },
    },
    {
      title: 'Giờ Đăng',
      dataIndex: 'timeFormatted',
      key: 'timeFormatted',
      width: 85,
      render: (time: string) => (
        <span className="text-xs font-mono text-slate-400">{time}</span>
      ),
    },
    {
      title: 'Nội dung tóm tắt',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (t: string) => (
        <span className="text-xs text-slate-300" title={t}>
          {t}
        </span>
      ),
    },
    {
      title: 'Thao tác',
      key: 'rowActions',
      width: 230,
      align: 'right' as const,
      render: (_: any, record: any) => (
        <Space size={6}>
          <Tooltip title="Chép dòng này để dán vào Excel (Ngày \t Link \t \t Group \t Nick)">
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => handleCopySingleRow(record)}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 text-[11px] rounded-lg"
            >
              Copy
            </Button>
          </Tooltip>
          {record.postUrl && (
            <>
              <Tooltip title="Mở sang trang Tăng Tương Tác để buff Like/Comment tự động bằng toàn bộ Fanpage & Via">
                <Button
                  size="small"
                  type="primary"
                  icon={<ThunderboltFilled className="text-amber-300" />}
                  onClick={() => {
                    navigate(`/dashboard/buff?targetUrl=${encodeURIComponent(record.postUrl)}`);
                  }}
                  className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold text-[11px] rounded-lg border-none shadow-sm flex items-center gap-1"
                >
                  🚀 Buff Seeding
                </Button>
              </Tooltip>
              <Tooltip title="Mở bài trên Facebook">
                <Button
                  size="small"
                  type="text"
                  icon={<EyeOutlined />}
                  href={record.postUrl}
                  target="_blank"
                  className="text-blue-400 hover:text-blue-300"
                />
              </Tooltip>
            </>
          )}
        </Space>
      ),
    },
  ];

  // Cột bảng toàn bộ hàng đợi & bài chờ đăng (Chuẩn phong cách Đăng tự động)
  const queueColumns = [
    {
      title: 'Mã & Nội dung bài viết',
      key: 'content',
      render: (_: any, record: PostQueue) => {
        const firstMedia = record.mediaUrls?.[0];
        const isVideo = firstMedia && /\.mp4|\.mov|\.webm/i.test(firstMedia);
        const rawGroups = (record.targetGroupNames || '')
          .replace(/^GROUP_ONLY_ANON:|^GROUP_ONLY:/, '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
        const nick = normalizeNickName(resolvePosterIdentityName(record));

        return (
          <div className="flex gap-3 max-w-lg min-w-[280px]">
            {firstMedia ? (
              <div
                className="w-14 h-14 rounded-xl overflow-hidden bg-slate-900 shrink-0 border border-slate-700 flex items-center justify-center cursor-pointer hover:opacity-90 relative shadow-sm"
                onClick={() => setDetailPost(record)}
                title="Nhấn để xem trước media & chi tiết bài đăng"
              >
                {isVideo ? (
                  <video src={firstMedia} className="w-full h-full object-cover" muted />
                ) : (
                  <img src={firstMedia} alt="" className="w-full h-full object-cover" />
                )}
                {isVideo && (
                  <span className="absolute top-0.5 left-0.5 bg-black/70 text-[8px] font-bold px-1 rounded text-white">
                    VIDEO
                  </span>
                )}
              </div>
            ) : (
              <div
                className="w-14 h-14 rounded-xl bg-slate-800 text-slate-400 shrink-0 flex items-center justify-center font-bold text-xs border border-slate-700 cursor-pointer hover:bg-slate-700 shadow-sm"
                onClick={() => setDetailPost(record)}
                title="Nhấn để xem chi tiết bài đăng"
              >
                Text
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                <span className="text-xs font-mono font-bold text-emerald-400">#{record.id}</span>
                <Tag color="blue" icon={<UserOutlined />} className="!text-[11px] !m-0 !rounded-md font-semibold">
                  {nick}
                </Tag>
                {record.targetGroupNames?.includes('GROUP_ONLY_ANON') && (
                  <Tag color="purple" className="!text-[10px] !m-0 !rounded-md">
                    🕵️ Ẩn danh
                  </Tag>
                )}
              </div>

              <Paragraph
                ellipsis={{ rows: 2 }}
                className="!mb-1 text-xs text-slate-100 font-medium cursor-pointer hover:text-sky-300 transition-colors"
                onClick={() => setDetailPost(record)}
                title="Nhấn để xem chi tiết bài đăng, video/ảnh và caption đầy đủ"
              >
                {record.content || record.title || 'Bài viết không tiêu đề'}
              </Paragraph>

              <div className="flex items-center gap-2 flex-wrap mt-1">
                {record.originalUrl && !record.originalUrl.startsWith('manual://') && (
                  <a
                    href={record.originalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-sky-400 font-medium hover:underline inline-flex items-center gap-1"
                  >
                    <LinkOutlined /> Bài gốc
                  </a>
                )}
                {rawGroups.map((gid) => {
                  const matchedGroup = ECONOMY_GROUPS.find((g) => g.id === gid);
                  return (
                    <a
                      key={gid}
                      href={matchedGroup?.fbUrl || `https://www.facebook.com/groups/${gid}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Tag color="geekblue" icon={<TeamOutlined />} className="!text-[10px] !m-0 !rounded-md hover:opacity-80">
                        {matchedGroup ? matchedGroup.cleanName : `Nhóm ${gid}`}
                      </Tag>
                    </a>
                  );
                })}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      title: 'Link bài viết (Facebook / Nguồn)',
      key: 'publishedLinks',
      width: 220,
      render: (_: any, record: PostQueue) => {
        const postUrl = getEffectivePostUrl(record);
        const groupPostUrls = (record.publishedGroupPostUrls || '')
          .split(',')
          .map((u) => u.trim())
          .filter((u) => u.startsWith('http'));

        if (record.status === 'PUBLISHED') {
          return (
            <div className="flex flex-col gap-1">
              {postUrl ? (
                <div className="flex items-center gap-1.5">
                  <a
                    href={postUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 font-semibold hover:underline inline-flex items-center gap-1 truncate max-w-[170px]"
                    title={postUrl}
                  >
                    <FacebookFilled className="text-blue-500 shrink-0" /> Bài trên Facebook
                  </a>
                  <Tooltip title="Sao chép link Facebook">
                    <Button
                      size="small"
                      type="text"
                      icon={<CopyOutlined />}
                      onClick={() => {
                        navigator.clipboard.writeText(postUrl);
                        message.success('Đã chép link Facebook!');
                      }}
                      className="text-slate-400 hover:text-white !p-0.5 h-6 w-6"
                    />
                  </Tooltip>
                </div>
              ) : null}

              {groupPostUrls.map((url, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 font-medium hover:underline inline-flex items-center gap-1 truncate max-w-[170px]"
                    title={url}
                  >
                    <LinkOutlined className="shrink-0" /> {groupPostUrls.length > 1 ? `Link Nhóm ${idx + 1}` : 'Link bài Nhóm'}
                  </a>
                  <Tooltip title="Sao chép link bài này">
                    <Button
                      size="small"
                      type="text"
                      icon={<CopyOutlined />}
                      onClick={() => {
                        navigator.clipboard.writeText(url);
                        message.success('Đã chép link nhóm!');
                      }}
                      className="text-slate-400 hover:text-white !p-0.5 h-6 w-6"
                    />
                  </Tooltip>
                </div>
              ))}

              {!postUrl && groupPostUrls.length === 0 && (
                <span className="text-[11px] text-slate-500 italic">Đang cập nhật link...</span>
              )}
            </div>
          );
        }

        // Với bài đang Chờ đăng (PENDING) hoặc Đang đăng (PROCESSING):
        return (
          <div className="flex flex-col gap-1 max-w-[240px]">
            {record.originalUrl && !record.originalUrl.startsWith('manual://') ? (
              <div className="flex items-center gap-1.5">
                <a
                  href={record.originalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-sky-400 hover:text-sky-300 font-medium hover:underline inline-flex items-center gap-1 truncate max-w-[180px]"
                  title={record.originalUrl}
                >
                  <LinkOutlined className="shrink-0" /> {record.originalUrl}
                </a>
                <Tooltip title="Sao chép link bài gốc này">
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(record.originalUrl!);
                      message.success('Đã sao chép link nguồn!');
                    }}
                    className="text-slate-400 hover:text-white !p-0.5 h-6 w-6"
                  />
                </Tooltip>
              </div>
            ) : (
              <span className="text-xs text-slate-400 italic">Tự soạn nội dung trực tiếp</span>
            )}
            <div className="text-[10px] text-amber-400/90 font-mono flex items-center gap-1">
              <ClockCircleOutlined className="text-[9px]" /> Chờ Playwright xuất bản
            </div>
          </div>
        );
      },
    },
    {
      title: 'Thời gian',
      key: 'time',
      width: 145,
      render: (_: any, record: PostQueue) => {
        const isPending = record.status === 'PENDING' || record.status === 'PROCESSING';
        const time = isPending ? record.scheduledAt : (record.publishedAt || record.scheduledAt);
        return (
          <div className="text-xs">
            <div className={`font-semibold flex items-center gap-1 ${isPending ? 'text-amber-300' : 'text-slate-200'}`}>
              {isPending && <ClockCircleOutlined className="text-[11px]" />}
              {time ? dayjs(time).format('HH:mm') : '—'}
            </div>
            <div className="text-slate-400 text-[11px]">
              {time ? dayjs(time).format('DD/MM/YYYY') : '—'}
            </div>
          </div>
        );
      },
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 140,
      render: (_: any, record: PostQueue) => {
        if (record.status === 'PUBLISHED') {
          return (
            <Tag color="success" icon={<CheckCircleOutlined />} className="!rounded-md font-bold">
              Đã đăng
            </Tag>
          );
        }
        if (record.status === 'PROCESSING') {
          return (
            <Tag color="purple" icon={<SyncOutlined spin />} className="!rounded-md font-bold">
              Đang đăng...
            </Tag>
          );
        }
        if (record.status === 'PENDING') {
          return (
            <Tag color="warning" icon={<ClockCircleOutlined />} className="!rounded-md font-bold">
              Chờ đăng
            </Tag>
          );
        }
        return (
          <div>
            <Tag color="error" icon={<CloseCircleOutlined />} className="!rounded-md font-bold">
              Lỗi đăng
            </Tag>
            {record.errorMessage && (
              <Tooltip title={record.errorMessage}>
                <div className="text-[10px] text-rose-400 truncate max-w-[130px] cursor-help mt-0.5">
                  {record.errorMessage}
                </div>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 130,
      align: 'right' as const,
      render: (_: any, record: PostQueue) => {
        return (
          <Space size={6}>
            <Tooltip title="Xem chi tiết bài viết, caption & ảnh">
              <Button
                size="small"
                icon={<EyeOutlined />}
                onClick={() => setDetailPost(record)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 text-xs rounded-lg"
              />
            </Tooltip>
            {(record.status === 'PENDING' || record.status === 'FAILED') && (
              <Tooltip title={record.status === 'PENDING' ? 'Đăng bài này ngay lập tức qua Playwright' : 'Thử đăng lại'}>
                <Button
                  size="small"
                  type="primary"
                  icon={record.status === 'PENDING' ? <PlayCircleOutlined /> : <ReloadOutlined />}
                  onClick={() => handlePublishNow(record.id)}
                  className={record.status === 'PENDING' ? 'bg-emerald-600 hover:bg-emerald-500 border-none !text-xs font-bold' : 'bg-amber-600 hover:bg-amber-500 border-none !text-xs font-bold'}
                />
              </Tooltip>
            )}
            <Popconfirm
              title="Xóa bài viết này khỏi hàng đợi?"
              onConfirm={() => handleDeletePost(record.id)}
              okText="Xóa"
              cancelText="Hủy"
              okButtonProps={{ danger: true }}
            >
              <Button
                size="small"
                danger
                type="text"
                icon={<DeleteOutlined />}
              />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const handleComposerSubmit = () => {
    if (selectedGroupIds.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 nhóm nhận bài!');
      return;
    }
    if (!selectedPageTarget) {
      message.warning('Vui lòng chọn Page / Nick cá nhân phụ trách đăng bài!');
      return;
    }
    if (inputMode === 'LINK') {
      if (parsedUrls.length === 0) {
        message.warning('Vui lòng dán ít nhất 1 đường dẫn bài viết hợp lệ!');
        return;
      }
    } else {
      if (!manualContent.trim() && uploadedMediaUrls.length === 0) {
        message.warning('Vui lòng nhập nội dung bài viết hoặc đính kèm ảnh/video!');
        return;
      }
    }
    postMutation.mutate();
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* ── BANNER HEADER HERO ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-[#101c2e] to-[#0c2238] border border-emerald-500/30 p-6 md:p-8 shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight mb-2 flex items-center gap-2.5">
              <BankOutlined className="text-emerald-400" /> Quản Lý Job Kinh Tế & Báo Cáo
            </h1>
            <p className="text-slate-300 text-xs md:text-sm max-w-2xl leading-relaxed mb-0">
              Trực tiếp xem số bài theo từng Group, từng Nick đăng trong ngày và <b>1-Click sao chép nhanh</b> để dán thẳng vào Google Sheets / Excel.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Button
              type="primary"
              icon={<ReloadOutlined spin={isLoadingPosts} />}
              onClick={() => refetchPosts()}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 font-bold rounded-xl h-10 px-4"
            >
              Làm mới dữ liệu
            </Button>
          </div>
        </div>
      </div>

      {/* ── STATS BAR TỔNG QUAN (CLICK ĐỂ XEM NHANH TỪNG LOẠI BÀI) ── */}
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={6} md={6}>
          <Card
            onClick={() => {
              setActiveTab('REPORT');
              setReportViewMode('PUBLISHED');
            }}
            className={`!bg-[#111a28] rounded-2xl shadow-sm cursor-pointer transition-all border ${
              activeTab === 'REPORT' && reportViewMode === 'PUBLISHED'
                ? '!border-emerald-500 ring-2 ring-emerald-500/20 shadow-emerald-950/40'
                : '!border-slate-800 hover:!border-slate-700 hover:bg-[#142032]'
            }`}
          >
            <Statistic
              title={<span className="text-xs font-bold text-slate-400">Đã đăng hôm nay</span>}
              value={overallStats.publishedToday}
              valueStyle={{ color: '#10b981', fontWeight: 800 }}
              prefix={<CheckCircleOutlined className="text-emerald-400 text-base mr-1" />}
              suffix={<span className="text-xs text-slate-500 font-normal">bài</span>}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={6}>
          <Card
            onClick={() => {
              setActiveTab('COMPOSER');
            }}
            className={`!bg-[#111a28] rounded-2xl shadow-sm cursor-pointer transition-all border ${
              activeTab === 'COMPOSER'
                ? '!border-sky-500 ring-2 ring-sky-500/30 shadow-sky-950/40'
                : overallStats.pending > 0
                  ? '!border-sky-500/60 ring-1 ring-sky-500/20 hover:!border-sky-400'
                  : '!border-slate-800 hover:!border-slate-700'
            }`}
          >
            <Statistic
              title={
                <span className="text-xs font-bold text-sky-400 flex items-center gap-1">
                  Đang chờ xuất bản {overallStats.pending > 0 && <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />}
                </span>
              }
              value={overallStats.pending}
              valueStyle={{ color: '#38bdf8', fontWeight: 800 }}
              prefix={<ClockCircleOutlined className="text-sky-400 text-base mr-1" />}
              suffix={<span className="text-xs text-slate-500 font-normal">bài</span>}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={6}>
          <Card
            onClick={() => {
              setActiveTab('ALL_QUEUE');
              setHistoryFilter('PUBLISHED');
            }}
            className={`!bg-[#111a28] rounded-2xl shadow-sm cursor-pointer transition-all border ${
              activeTab === 'ALL_QUEUE' && historyFilter === 'PUBLISHED'
                ? '!border-purple-500 ring-2 ring-purple-500/20'
                : '!border-slate-800 hover:!border-slate-700 hover:bg-[#142032]'
            }`}
          >
            <Statistic
              title={<span className="text-xs font-bold text-slate-400">Tổng bài đã xong</span>}
              value={overallStats.published}
              valueStyle={{ color: '#a78bfa', fontWeight: 800 }}
              prefix={<TeamOutlined className="text-purple-400 text-base mr-1" />}
              suffix={<span className="text-xs text-slate-500 font-normal">bài</span>}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={6}>
          <Card
            onClick={() => {
              setActiveTab('ALL_QUEUE');
              setHistoryFilter('FAILED');
            }}
            className={`!bg-[#111a28] rounded-2xl shadow-sm cursor-pointer transition-all border ${
              activeTab === 'ALL_QUEUE' && historyFilter === 'FAILED'
                ? '!border-rose-500 ring-2 ring-rose-500/20'
                : '!border-slate-800 hover:!border-slate-700 hover:bg-[#142032]'
            }`}
          >
            <Statistic
              title={<span className="text-xs font-bold text-slate-400">Thất bại / Lỗi</span>}
              value={overallStats.failed}
              valueStyle={{ color: overallStats.failed > 0 ? '#f43f5e' : '#94a3b8', fontWeight: 800 }}
              prefix={<CloseCircleOutlined className={overallStats.failed > 0 ? 'text-rose-500 text-base mr-1' : 'text-slate-500 text-base mr-1'} />}
              suffix={<span className="text-xs text-slate-500 font-normal">bài</span>}
            />
          </Card>
        </Col>
      </Row>

      {/* ── TABS CHUYỂN ĐỔI CHỨC NĂNG ── */}
      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as any)}
        type="card"
        className="custom-economy-tabs"
        items={[
          {
            key: 'COMPOSER',
            label: (
              <span className={`flex items-center gap-1.5 font-bold px-1 text-sm ${activeTab === 'COMPOSER' ? 'text-amber-300' : 'text-slate-300'}`}>
                <EditOutlined /> Soạn Bài & Chờ Xuất Bản ({overallStats.pending})
              </span>
            ),
          },
          {
            key: 'REPORT',
            label: (
              <span className={`flex items-center gap-1.5 font-bold px-1 text-sm ${activeTab === 'REPORT' ? 'text-emerald-400' : 'text-slate-300'}`}>
                <BarChartOutlined /> Báo Cáo Hàng Ngày (Sheets)
              </span>
            ),
          },
          {
            key: 'ALL_QUEUE',
            label: (
              <span className={`flex items-center gap-1.5 font-bold px-1 text-sm ${activeTab === 'ALL_QUEUE' ? 'text-indigo-400' : 'text-slate-300'}`}>
                <UnorderedListOutlined /> Tất Cả Bài & Lịch Sử ({allPosts.length})
              </span>
            ),
          },
        ]}
      />

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB 1: BÁO CÁO HÀNG NGÀY ĐIỀN EXCEL / GOOGLE SHEETS            */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {activeTab === 'REPORT' && (
        <div className="space-y-6">
          {/* Thanh Chọn Ngày & Nút Copy Nhanh */}
          <Card className="!bg-[#111a28] !border-slate-800 shadow-xl rounded-2xl">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Bên trái: Bộ chọn ngày */}
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-xs font-bold text-slate-300">Ngày báo cáo:</span>
                <Button
                  size="small"
                  type={selectedReportDate === dayjs().format('YYYY-MM-DD') ? 'primary' : 'default'}
                  onClick={() => setSelectedReportDate(dayjs().format('YYYY-MM-DD'))}
                  className="font-bold rounded-lg text-xs"
                >
                  Hôm nay ({dayjs().format('DD/MM')})
                </Button>
                <Button
                  size="small"
                  type={selectedReportDate === dayjs().subtract(1, 'day').format('YYYY-MM-DD') ? 'primary' : 'default'}
                  onClick={() => setSelectedReportDate(dayjs().subtract(1, 'day').format('YYYY-MM-DD'))}
                  className="font-bold rounded-lg text-xs"
                >
                  Hôm qua ({dayjs().subtract(1, 'day').format('DD/MM')})
                </Button>
                <DatePicker
                  size="small"
                  format="DD/MM/YYYY"
                  value={dayjs(selectedReportDate)}
                  onChange={(d) => d && setSelectedReportDate(d.format('YYYY-MM-DD'))}
                  allowClear={false}
                  className="bg-slate-900 border-slate-700 text-slate-100 rounded-lg !w-36 text-xs"
                />
              </div>

              {/* Bên phải: Nút thao tác trực tiếp trên phần mềm */}
              <div className="flex flex-wrap items-center gap-2.5">
                <Button
                  type="primary"
                  icon={<CopyOutlined />}
                  onClick={handleCopyForGoogleSheets}
                  className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-extrabold text-xs h-9 px-4 rounded-xl border-none shadow-md"
                >
                  📋 1-Click Copy Để Paste Thẳng Vào Google Sheets (Ctrl+V)
                </Button>

                <Button
                  icon={<LinkOutlined />}
                  onClick={handleCopyLinksOnly}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 text-xs font-bold rounded-xl h-9"
                >
                  🔗 Copy Danh Sách Link Bài
                </Button>

                <Button
                  icon={<FileTextOutlined />}
                  onClick={handleCopyTextReport}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 text-xs font-bold rounded-xl h-9"
                >
                  💬 Copy Báo Cáo Tin Nhắn
                </Button>
              </div>
            </div>

            {/* Hướng dẫn nhanh cho người dùng */}
            <div className="mt-3.5 p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/25 flex items-start gap-2.5 text-xs text-slate-300">
              <span className="text-emerald-400 text-base shrink-0">💡</span>
              <div>
                <b className="text-emerald-300">Cách điền báo cáo siêu tốc:</b> Bấm nút{' '}
                <span className="text-emerald-400 font-bold">"📋 1-Click Copy Để Paste Thẳng Vào Google Sheets (Ctrl+V)"</span>, sau đó mở file Google Sheets / Excel của bạn, bấm vào ô <b>Cột B (Ngày)</b> của dòng đầu tiên và nhấn phím <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 text-white font-mono text-[11px]">Ctrl + V</kbd>. Toàn bộ dữ liệu (Ngày, Link bài viết, Tên group, Nick đăng) sẽ tự động điền đúng từng cột như hình!
              </div>
            </div>
          </Card>

          {/* ── MA TRẬN TỔNG HỢP THEO GROUP & NICK TRONG NGÀY ĐÓ ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {ECONOMY_GROUPS.map((g) => {
              const info = dailyReportData.groupMap.get(g.cleanName);
              const count = info?.count || 0;
              const nicks = info?.nicks || new Map();
              const isGroupActive = selectedReportGroupFilter === g.cleanName;

              return (
                <Card
                  key={g.id}
                  onClick={() => {
                    setSelectedReportGroupFilter((prev) => (prev === g.cleanName ? 'ALL' : g.cleanName));
                  }}
                  className={`!bg-[#111a28] rounded-2xl shadow-md overflow-hidden cursor-pointer transition-all border ${
                    isGroupActive
                      ? '!border-emerald-500 ring-2 ring-emerald-500/20'
                      : '!border-slate-800 hover:!border-slate-700'
                  }`}
                  title={
                    <div className="flex items-center justify-between py-1">
                      <span className="font-bold text-sm text-slate-100 flex items-center gap-1.5 truncate">
                        <TeamOutlined className="text-emerald-400" />
                        {g.cleanName}
                      </span>
                      <span className="text-xs font-mono font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        {count} bài
                      </span>
                    </div>
                  }
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
                      <span>Chi tiết nick đăng:</span>
                      {isGroupActive && (
                        <span className="text-emerald-400 font-bold text-[10px]">Đang lọc nhóm này</span>
                      )}
                    </div>
                    {nicks.size === 0 ? (
                      <div className="text-xs text-slate-500 italic py-2">
                        Chưa có bài nào đăng trong ngày này.
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {Array.from(nicks.entries()).map(([nick, nickCount]) => {
                          const isNickActive = selectedReportNickFilter === nick && selectedReportGroupFilter === g.cleanName;
                          return (
                            <div
                              key={nick}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedReportGroupFilter(g.cleanName);
                                setSelectedReportNickFilter((prev) => (prev === nick ? 'ALL' : nick));
                              }}
                              className={`flex items-center justify-between p-2 rounded-xl border text-xs cursor-pointer transition-all ${
                                isNickActive
                                  ? 'bg-blue-950/60 border-blue-500/60 text-white'
                                  : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-900 text-slate-200'
                              }`}
                            >
                              <span className="font-bold flex items-center gap-1.5">
                                <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px]">
                                  <UserOutlined />
                                </span>
                                {nick}
                              </span>
                              <span className="font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">
                                {nickCount} bài
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {/* ── BẢNG CHI TIẾT TỪNG BÀI ĐĂNG (KHỚP TỪNG DÒNG FILE EXCEL) ── */}
          <Card
            className="!bg-[#111a28] !border-slate-800 shadow-xl rounded-2xl overflow-hidden"
            title={
              <div className="space-y-2.5 py-1">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center font-bold border border-emerald-500/30">
                      📋
                    </div>
                    <div>
                      <span className="text-base font-bold text-slate-100">
                        {reportViewMode === 'PUBLISHED'
                          ? `Danh Sách Bài Đã Đăng Ngày ${dayjs(selectedReportDate).format('DD/MM/YYYY')}`
                          : `Danh Sách Bài Đang Chờ Xuất Bản (${overallStats.pending} bài)`}
                      </span>
                      <span className="ml-2 text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        {reportViewMode === 'PUBLISHED'
                          ? `${filteredReportRows.length} / ${dailyReportData.totalPosts} bài`
                          : `${filteredPendingPosts.length} / ${overallStats.pending} bài`}
                      </span>
                    </div>

                    {(selectedReportGroupFilter !== 'ALL' || selectedReportNickFilter !== 'ALL' || reportSearchText) && (
                      <Button
                        size="small"
                        type="link"
                        icon={<ClearOutlined />}
                        onClick={() => {
                          setSelectedReportGroupFilter('ALL');
                          setSelectedReportNickFilter('ALL');
                          setReportSearchText('');
                        }}
                        className="text-xs text-rose-400 font-bold hover:underline !p-0 ml-2"
                      >
                        Xóa bộ lọc
                      </Button>
                    )}
                  </div>

                  {/* Bộ lọc trực tiếp trên giao diện */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      size="small"
                      value={selectedReportGroupFilter}
                      onChange={setSelectedReportGroupFilter}
                      className="!w-44 text-xs"
                      placeholder="Lọc Group"
                    >
                      <Option value="ALL">Tất cả Group</Option>
                      {ECONOMY_GROUPS.map((g) => (
                        <Option key={g.id} value={g.cleanName}>{g.cleanName}</Option>
                      ))}
                    </Select>

                    <Select
                      size="small"
                      value={selectedReportNickFilter}
                      onChange={setSelectedReportNickFilter}
                      className="!w-36 text-xs"
                      placeholder="Lọc Nick"
                    >
                      <Option value="ALL">Tất cả Nick</Option>
                      {dailyReportData.availableNicks.map((nick) => (
                        <Option key={nick} value={nick}>{nick}</Option>
                      ))}
                    </Select>

                    <Input
                      size="small"
                      placeholder="Tìm link, tiêu đề..."
                      prefix={<SearchOutlined className="text-slate-500" />}
                      value={reportSearchText}
                      onChange={(e) => setReportSearchText(e.target.value)}
                      allowClear
                      className="w-36 rounded-lg bg-slate-900 border-slate-700 text-slate-200 text-xs py-1"
                    />
                  </div>
                </div>

                {/* Nút chuyển đổi nhanh giữa: ĐÃ ĐĂNG và CHỜ ĐĂNG */}
                <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => setReportViewMode('PUBLISHED')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border cursor-pointer ${
                      reportViewMode === 'PUBLISHED'
                        ? 'bg-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-950/40'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <CheckCircleOutlined />
                    <span>Đã Xuất Bản Ngày {dayjs(selectedReportDate).format('DD/MM')}</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                      reportViewMode === 'PUBLISHED' ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-300'
                    }`}>
                      {filteredReportRows.length} bài
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setReportViewMode('PENDING')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border cursor-pointer ${
                      reportViewMode === 'PENDING'
                        ? 'bg-sky-600 border-sky-500 text-white shadow-md shadow-sky-950/40'
                        : 'bg-slate-900 border-slate-800 text-sky-400/90 hover:text-sky-300'
                    }`}
                  >
                    <ClockCircleOutlined />
                    <span>Đang Chờ Xuất Bản</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                      reportViewMode === 'PENDING' ? 'bg-white/20 text-white' : 'bg-sky-950 text-sky-300 border border-sky-800/40'
                    }`}>
                      {overallStats.pending} bài
                    </span>
                  </button>
                </div>
              </div>
            }
          >
          {reportViewMode === 'PUBLISHED' ? (
            <Table
              dataSource={filteredReportRows}
              columns={reportColumns}
              pagination={false}
              className="app-custom-table"
              locale={{
                emptyText: (
                  <div className="py-8 text-center text-slate-400 text-xs">
                    Không có bài viết nào phù hợp với bộ lọc trong ngày {dayjs(selectedReportDate).format('DD/MM/YYYY')}.
                  </div>
                ),
              }}
            />
          ) : (
            <Table
              dataSource={filteredPendingPosts}
              columns={queueColumns}
              rowKey="id"
              loading={isLoadingPosts}
              pagination={{ pageSize: 10, showSizeChanger: true }}
              className="app-custom-table"
              locale={{
                emptyText: (
                  <div className="py-8 text-center text-slate-400 text-xs">
                    Hiện không có bài nào đang chờ đăng cho cụm Job Kinh Tế.
                  </div>
                ),
              }}
            />
          )}
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB 1: SOẠN BÀI & HÀNG CHỜ XUẤT BẢN                           */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {activeTab === 'COMPOSER' && (
        <div className="space-y-6">
          <Card
            className="!bg-[#111a28] !border-slate-800 shadow-xl rounded-2xl overflow-hidden"
          title={
            <div className="flex items-center gap-2.5 py-1">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center font-bold border border-emerald-500/30">
                ✍️
              </div>
              <div>
                <span className="text-base font-bold text-slate-100">Soạn Bài & Đăng Vào 3 Nhóm Kinh Tế</span>
                <p className="text-[11px] text-slate-400 font-normal mb-0">Hệ thống Playwright Worker sẽ tự động xuất bản an toàn</p>
              </div>
            </div>
          }
        >
          <Form form={form} layout="vertical" onFinish={handleComposerSubmit}>
            {/* 1. CHỌN PAGE PHỤ TRÁCH & CÁC NHÓM */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-5 p-4 rounded-xl bg-[#0c1420] border border-slate-800">
              {/* Cột trái: Page phụ trách */}
              <div className="lg:col-span-5">
                <label className="block text-xs font-bold text-slate-200 mb-1.5 flex items-center gap-1.5">
                  <FacebookFilled className="text-blue-400" />
                  <span>Page / Nick cá nhân phụ trách đăng bài:</span>
                  <span className="text-rose-400">*</span>
                </label>
                
                <Form.Item
                  name="targetFanpageId"
                  rules={[{ required: true, message: 'Vui lòng chọn Page phụ trách!' }]}
                  className="!mb-2"
                >
                  <Select
                    size="large"
                    placeholder="Chọn Fanpage hoặc Nick cá nhân..."
                    value={selectedPageTarget}
                    onChange={(val) => {
                      setSelectedPageTarget(val);
                      localStorage.setItem(STORAGE_SELECTED_PAGE, val);
                    }}
                    showSearch
                    optionFilterProp="label"
                    filterOption={(input, option) => {
                      const label = String(option?.label || '').toLowerCase();
                      const query = input.toLowerCase();
                      if (label.includes(query)) return true;
                      const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                      return strip(label).includes(strip(query));
                    }}
                    className="w-full"
                    loading={isLoadingAccounts}
                  >
                    {postingIdentities.map((item) => (
                      <Option key={item.value} value={item.value} label={item.label}>
                        <div className="flex items-center justify-between">
                          <span className={item.isExpired ? 'text-rose-400 font-bold' : ''}>
                            {item.label}
                          </span>
                          {item.isExpired ? (
                            <Tag color="error" className="!rounded-full text-[10px] font-bold">HẾT HẠN</Tag>
                          ) : item.isPersonal ? (
                            <Tag color="purple" className="!rounded-full text-[10px] font-bold">NICK VIA</Tag>
                          ) : (
                            <Tag color="blue" className="!rounded-full text-[10px] font-bold">FANPAGE</Tag>
                          )}
                        </div>
                      </Option>
                    ))}
                  </Select>
                </Form.Item>

                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                  <span>Trang/Nick này sẽ đứng tên đăng vào 4 nhóm</span>
                  <Checkbox
                    checked={isAnonymous}
                    onChange={(e) => setIsAnonymous(e.target.checked)}
                    className="text-amber-400 text-xs font-semibold"
                  >
                    Đăng ẩn danh (nếu là cá nhân)
                  </Checkbox>
                </div>
              </div>

              {/* Cột phải: 4 Group nhận bài */}
              <div className="lg:col-span-7">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <TeamOutlined className="text-emerald-400" />
                    <span>4 Nhóm nhận bài:</span>
                  </label>
                  <Space size="small">
                    <Button
                      type="link"
                      size="small"
                      className="!p-0 text-xs text-emerald-400 font-bold"
                      onClick={() => setSelectedGroupIds(ECONOMY_GROUPS.map((g) => g.id))}
                    >
                      Chọn cả 4 nhóm
                    </Button>
                  </Space>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {ECONOMY_GROUPS.map((g, idx) => {
                    const isChecked = selectedGroupIds.includes(g.id);
                    const health = groupHealthMap.get(g.id);
                    const isJoined = health?.groupHealthStatus === 'JOINED';

                    return (
                      <div
                        key={g.id}
                        onClick={() => {
                          setSelectedGroupIds((prev) =>
                            prev.includes(g.id) ? prev.filter((id) => id !== g.id) : [...prev, g.id]
                          );
                        }}
                        className={`p-3 rounded-xl border transition-all cursor-pointer select-none flex flex-col justify-between ${
                          isChecked
                            ? 'bg-emerald-950/30 border-emerald-500/60 ring-1 ring-emerald-500/30 shadow-md'
                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 opacity-60'
                        }`}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-1.5 mb-1">
                            <Checkbox checked={isChecked} />
                            <Tag color="success" className="!rounded-full text-[10px] !mr-0 font-bold">
                              {idx + 11}
                            </Tag>
                          </div>
                          <div className="font-bold text-xs text-slate-200 line-clamp-1" title={g.name}>
                            {g.name}
                          </div>
                          <div className="font-mono text-[10px] text-slate-400 mt-0.5">
                            ID: {g.id}
                          </div>
                        </div>

                        <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                          <span className="text-[10px] text-emerald-400 font-medium">
                            {isJoined ? '✓ Đã vào' : 'Sẵn sàng'}
                          </span>
                          <a
                            href={g.fbUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[10px] text-slate-400 hover:text-blue-400 hover:underline flex items-center gap-0.5"
                          >
                            <GlobalOutlined /> Mở fb
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 2. CHỌN CÁCH NHẬP BÀI: DÁN LINK CÀO TỰ ĐỘNG HOẶC TỰ SOẠN THỦ CÔNG */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3 bg-slate-950/80 p-2.5 rounded-2xl border border-slate-800 shadow-md">
                <Segmented
                  size="middle"
                  value={inputMode}
                  onChange={(val) => setInputMode(val as 'LINK' | 'MANUAL')}
                  options={[
                    {
                      label: (
                        <span className="flex items-center gap-2 px-3.5 py-1 text-xs font-bold">
                          <GlobalOutlined className="text-blue-400 text-sm" /> Dán link cào tự động
                        </span>
                      ),
                      value: 'LINK',
                    },
                    {
                      label: (
                        <span className="flex items-center gap-2 px-3.5 py-1 text-xs font-bold text-emerald-300">
                          <EditOutlined className="text-emerald-400 text-sm" /> Tự soạn nội dung & Studio
                        </span>
                      ),
                      value: 'MANUAL',
                    },
                  ]}
                  className="bg-slate-900 border border-slate-700/80 p-1 rounded-xl text-slate-200 shadow-inner"
                />
                <div className="flex items-center gap-2">
                  {inputMode === 'LINK' ? (
                    <Tag color="cyan" className="!font-bold !px-3 !py-1 !text-xs !rounded-xl !m-0 border-cyan-500/40 bg-cyan-950/80 text-cyan-300 shadow-sm flex items-center gap-1.5">
                      ⚡ <span>Chế độ: <strong>Dán link tự động cào</strong> (1 link hoặc nhiều link)</span>
                    </Tag>
                  ) : (
                    <Tag color="emerald" className="!font-bold !px-3 !py-1 !text-xs !rounded-xl !m-0 border-emerald-500/40 bg-emerald-950/80 text-emerald-300 shadow-sm flex items-center gap-1.5">
                      ✍️ <span>Chế độ: <strong>Tự soạn bài & Studio</strong></span>
                    </Tag>
                  )}
                </div>
              </div>

              {/* CHẾ ĐỘ 1: DÁN LINK CÀO TỰ ĐỘNG (1 LINK HOẶC NHIỀU LINK) */}
              {inputMode === 'LINK' && (
                <div className="space-y-4 mb-5">
                  <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-700/80 shadow-inner">
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                      <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        <LinkOutlined className="text-cyan-400" />
                        <span>Liên kết bài viết (Hỗ trợ 1 link hoặc dán danh sách nhiều link hàng loạt — mỗi dòng 1 link):</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <Button
                          size="small"
                          icon={<CopyOutlined />}
                          onClick={handlePasteClipboard}
                          className="bg-slate-800 border-slate-700 text-slate-200 text-xs rounded-lg hover:bg-slate-700"
                        >
                          Dán từ Clipboard
                        </Button>
                        {parsedUrls.length > 0 && (
                          <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                            {parsedUrls.length} bài viết hợp lệ
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 mb-2.5 flex-wrap text-[11px] text-slate-400">
                      <span className="text-slate-500 font-semibold">Tự động cào từ:</span>
                      <Tag color="blue" className="!text-[10px] !m-0 !px-1.5 !rounded-md">Báo CafeF, VnExpress, Tuổi Trẻ...</Tag>
                      <Tag color="purple" className="!text-[10px] !m-0 !px-1.5 !rounded-md">Facebook Post / Group</Tag>
                      <Tag color="cyan" className="!text-[10px] !m-0 !px-1.5 !rounded-md">Threads</Tag>
                      <Tag color="magenta" className="!text-[10px] !m-0 !px-1.5 !rounded-md">TikTok (sạch logo)</Tag>
                    </div>

                    <TextArea
                      rows={parsedUrls.length > 1 ? 4 : 2}
                      placeholder="Dán 1 link hoặc dán danh sách nhiều link (mỗi dòng 1 link):
https://cafef.vn/...
https://vnexpress.net/kinh-doanh/...
https://www.facebook.com/... hoặc link Threads, TikTok..."
                      value={scrapeUrl}
                      onChange={(e) => setScrapeUrl(e.target.value)}
                      className="bg-slate-950 border-slate-700 text-slate-100 rounded-xl text-xs font-mono leading-relaxed"
                    />

                    <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
                      <div className="text-[11px] text-slate-400">
                        {parsedUrls.length > 1 ? (
                          <span>
                            ⚡ Sẽ tự động cào và tạo <b>{parsedUrls.length} bài</b> × <b>{selectedGroupIds.length} nhóm</b> = <b className="text-cyan-400">{parsedUrls.length * selectedGroupIds.length} bài đăng</b> (tự động giãn cách an toàn).
                          </span>
                        ) : (
                          <span>Hệ thống sẽ <b>tự động cào dữ liệu</b> ngay khi dán link. Bạn có thể bấm cào lại bất cứ lúc nào.</span>
                        )}
                      </div>

                      <Button
                        type="primary"
                        size="middle"
                        loading={isScraping}
                        onClick={() => handlePreviewScrape()}
                        disabled={parsedUrls.length === 0}
                        icon={<SearchOutlined />}
                        className="bg-blue-600 hover:bg-blue-500 font-bold rounded-xl px-4 text-xs h-9"
                      >
                        {parsedUrls.length > 1 ? 'Cào thử bài đầu tiên' : 'Cào lại nội dung & ảnh'}
                      </Button>
                    </div>
                  </div>

                  {/* BANNER ĐANG CÀO */}
                  {isScraping && (
                    <div className="rounded-xl border border-blue-500/30 bg-slate-900/80 p-3.5 flex items-center gap-3 backdrop-blur-md">
                      <LoadingOutlined className="text-blue-400 text-lg" spin />
                      <span className="text-xs text-blue-300 font-semibold">Đang cào dữ liệu và tải trước video / ảnh / caption...</span>
                    </div>
                  )}

                  {/* WORKSPACE XEM TRƯỚC BÀI ĐÃ CÀO (Y CHANG BÊN ĐĂNG TỰ ĐỘNG) */}
                  {scrapedPreview && !isScraping && (
                    <div className="rounded-2xl border border-blue-500/30 bg-slate-900/90 p-4 space-y-4 backdrop-blur-md shadow-xl">
                      <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-slate-800">
                        <div className="flex items-center gap-2">
                          <CheckCircleOutlined className="text-emerald-400 text-base" />
                          <span className="text-xs font-bold text-slate-200">
                            {parsedUrls.length > 1 ? 'Bản xem trước bài viết #1 (tự động cào):' : 'Bản xem trước bài viết đã cào:'}
                          </span>
                          <span className="text-xs text-slate-400 font-medium truncate max-w-md">
                            {scrapedPreview.title || parsedUrls[0]}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {scrapedMediaUrls.some((u) => /\.mp4|\.mov|\.webm/i.test(u)) && (
                            <Tag color="purple" className="!m-0 !font-bold !px-2 !py-0.5">🎥 Có Video</Tag>
                          )}
                          {scrapedMediaUrls.some((u) => !/\.mp4|\.mov|\.webm/i.test(u)) && (
                            <Tag color="blue" className="!m-0 !font-bold !px-2 !py-0.5">
                              🖼️ {scrapedMediaUrls.filter((u) => !/\.mp4|\.mov|\.webm/i.test(u)).length} Ảnh
                            </Tag>
                          )}
                          <Tag color="green" className="!m-0 !font-bold !px-2 !py-0.5 !text-emerald-300 !bg-emerald-950/80 !border-emerald-500/50">
                            ✨ Đã sẵn sàng xuất bản
                          </Tag>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                        {/* CỘT TRÁI (lg:col-span-5): KHUNG MEDIA ĐÃ CÀO */}
                        <div className="lg:col-span-5 space-y-2.5">
                          <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                            <span>Hình ảnh / Video trích xuất ({scrapedMediaUrls.length}):</span>
                            {scrapedMediaUrls.length > 0 && (
                              <span className="text-[10px] text-slate-400 font-normal">Click ảnh để phóng to, hover để xóa</span>
                            )}
                          </div>

                          {scrapedMediaUrls.length === 0 ? (
                            <div className="p-6 rounded-xl border border-dashed border-slate-700 text-center text-slate-500 text-xs">
                              Bài viết dạng thuần chữ (không có hình ảnh/video kèm theo)
                            </div>
                          ) : (
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 bg-slate-950/70 p-2.5 rounded-xl border border-slate-800">
                              {scrapedMediaUrls.map((mUrl, mIdx) => {
                                const isVid = /\.mp4|\.mov|\.webm/i.test(mUrl);
                                return (
                                  <div key={`m-${mIdx}`} className="relative aspect-square rounded-lg overflow-hidden border border-slate-700 bg-black group">
                                    {isVid ? (
                                      <video src={mUrl} className="w-full h-full object-cover" muted />
                                    ) : (
                                      <Image
                                        src={mUrl}
                                        alt=""
                                        className="w-full h-full object-cover"
                                      />
                                    )}
                                    {isVid && (
                                      <span className="absolute top-1 left-1 bg-purple-900/90 text-white text-[9px] font-bold px-1 rounded">
                                        VIDEO
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => setScrapedMediaUrls((prev) => prev.filter((_, i) => i !== mIdx))}
                                      className="w-5 h-5 rounded-full bg-red-600/90 text-white flex items-center justify-center text-[10px] absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="Xóa bớt ảnh này"
                                    >
                                      <CloseOutlined />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* CỘT PHẢI (lg:col-span-7): CAPTION ĐÃ CÀO & CHO PHÉP CHỈNH SỬA */}
                        <div className="lg:col-span-7 space-y-2.5">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                              <FileTextOutlined className="text-blue-400" />
                              <span>Nội dung Caption (Đã trích xuất & Cho phép chỉnh sửa):</span>
                            </label>
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="small"
                                icon={<RobotOutlined className="text-cyan-400" />}
                                loading={isAiRewriting}
                                onClick={handleAiRewrite}
                                className="bg-cyan-950/40 border-cyan-500/40 text-cyan-300 font-bold rounded-lg text-xs hover:bg-cyan-900/60"
                              >
                                AI Viết Lại
                              </Button>
                              <Button
                                size="small"
                                type="text"
                                icon={<RedoOutlined />}
                                onClick={() => setScrapedCustomCaption(scrapedPreview?.content || scrapedPreview?.title || '')}
                                className="text-xs text-slate-400 hover:text-slate-200"
                              >
                                Gốc
                              </Button>
                              <Button
                                size="small"
                                type="text"
                                danger
                                icon={<ClearOutlined />}
                                onClick={() => setScrapedCustomCaption('')}
                                className="text-xs"
                              >
                                Xóa
                              </Button>
                            </div>
                          </div>

                          <TextArea
                            rows={6}
                            value={scrapedCustomCaption}
                            onChange={(e) => setScrapedCustomCaption(e.target.value)}
                            placeholder="Caption bài viết cào tự động..."
                            className="bg-slate-950 border-slate-700/80 text-slate-100 rounded-xl text-xs leading-relaxed"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* CHẾ ĐỘ 2: TỰ SOẠN NỘI DUNG & STUDIO */}
              {inputMode === 'MANUAL' && (
                <div className="space-y-4 mb-5">
                  <div className="bg-slate-900/90 border border-slate-700/80 rounded-2xl p-4 space-y-3 shadow-md">
                    <div className="flex items-center justify-between flex-wrap gap-2 pb-1 border-b border-slate-800">
                      <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        <FileTextOutlined className="text-emerald-400" />
                        <span>Nội dung bài viết (Caption):</span>
                        <span className="text-rose-400">*</span>
                      </label>
                      <Button
                        size="small"
                        icon={<RobotOutlined className="text-cyan-400" />}
                        loading={isAiRewriting}
                        onClick={handleAiRewrite}
                        className="bg-cyan-950/40 border-cyan-500/40 text-cyan-300 font-bold rounded-lg text-xs hover:bg-cyan-900/60"
                      >
                        AI Viết Lại Chuẩn Bản Tin Kinh Tế
                      </Button>
                    </div>

                    <TextArea
                      rows={5}
                      value={manualContent}
                      onChange={(e) => setManualContent(e.target.value)}
                      placeholder="Nhập nội dung bản tin kinh tế, phân tích tài chính, câu chuyện kinh doanh... (Hỗ trợ xuống dòng và biểu tượng cảm xúc)"
                      className="bg-[#0b121c] border-slate-700/80 text-slate-100 rounded-xl text-sm leading-relaxed"
                    />
                  </div>

                  <div className="bg-slate-900/90 border border-slate-700/80 rounded-2xl p-4 space-y-2 shadow-md">
                    <label className="block text-xs font-bold text-slate-200">
                      Ảnh / Video đính kèm bài viết (Tải lên từ máy tính):
                    </label>

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      {uploadedMediaUrls.map((url, index) => {
                        const isVid = /\.mp4|\.mov|\.webm/i.test(url);
                        return (
                          <div
                            key={url}
                            className="relative w-24 h-24 rounded-xl overflow-hidden border border-slate-700 bg-black group shadow-md"
                          >
                            {isVid ? (
                              <video src={url} className="w-full h-full object-cover" muted />
                            ) : (
                              <img src={url} alt="" className="w-full h-full object-cover" />
                            )}
                            {isVid && (
                              <span className="absolute top-1 left-1 bg-black/70 text-white text-[9px] font-bold px-1 rounded">
                                VIDEO
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => setUploadedMediaUrls((prev) => prev.filter((_, i) => i !== index))}
                              className="absolute inset-0 bg-red-950/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity font-bold text-xs"
                            >
                              <DeleteOutlined className="text-base" />
                            </button>
                          </div>
                        );
                      })}

                      <Upload
                        multiple
                        showUploadList={false}
                        customRequest={handleCustomUpload}
                        accept="image/*,video/*"
                      >
                        <Button
                          icon={<UploadOutlined />}
                          loading={isUploadingMedia}
                          className="h-24 w-28 rounded-xl border-dashed border-slate-700 bg-slate-900/60 hover:bg-slate-800 text-slate-300 flex flex-col items-center justify-center gap-1.5"
                        >
                          <span className="text-xs font-bold">Thêm tệp</span>
                          <span className="text-[10px] text-slate-500">Ảnh hoặc Video</span>
                        </Button>
                      </Upload>
                    </div>
                  </div>
                </div>
              )}

              {/* Bình luận tự động kèm bài (Nguồn, Link đối tác, Affiliate) */}
              <Form.Item
                name="commentText"
                label={
                  <span className="text-xs font-bold text-slate-300">
                    Tự động bình luận dưới bài viết (tùy chọn — ví dụ link nguồn bài báo, link đăng ký):
                  </span>
                }
                className="!mb-4"
              >
                <Input
                  placeholder="Ví dụ: Link bài viết gốc: https://... hoặc Liên hệ hợp tác kinh doanh..."
                  className="bg-[#0b121c] border-slate-700/80 text-slate-200 rounded-xl text-xs py-2"
                />
              </Form.Item>
            </div>

            <Divider className="!border-slate-800 !my-5" />

            {/* 3. LỊCH ĐĂNG & GIÃN CÁCH AN TOÀN */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 p-4 rounded-xl bg-[#0c1420] border border-slate-800">
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-2">
                  Thời điểm bắt đầu đăng:
                </label>
                <div className="flex items-center gap-3">
                  <Button
                    type={isPublishNow ? 'primary' : 'default'}
                    onClick={() => setIsPublishNow(true)}
                    icon={<ThunderboltFilled />}
                    className={isPublishNow ? 'bg-emerald-600 hover:bg-emerald-500 font-bold rounded-xl text-xs' : 'font-bold rounded-xl text-xs'}
                  >
                    Đăng ngay lập tức
                  </Button>
                  <Button
                    type={!isPublishNow ? 'primary' : 'default'}
                    onClick={() => setIsPublishNow(false)}
                    icon={<ClockCircleOutlined />}
                    className={!isPublishNow ? 'bg-blue-600 hover:bg-blue-500 font-bold rounded-xl text-xs' : 'font-bold rounded-xl text-xs'}
                  >
                    Lên lịch hẹn giờ
                  </Button>
                </div>

                {!isPublishNow && (
                  <div className="mt-3">
                    <DatePicker
                      showTime
                      format="YYYY-MM-DD HH:mm"
                      value={scheduledTime}
                      onChange={(val) => setScheduledTime(val)}
                      className="w-full rounded-xl bg-slate-900 border-slate-700 text-slate-100"
                      placeholder="Chọn ngày và giờ đăng bài đầu tiên"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-200 mb-2">
                  Giãn cách an toàn giữa các nhóm (Tránh checkpoint & spam Facebook):
                </label>
                <Select
                  value={staggerMinutes}
                  onChange={(val) => {
                    setStaggerMinutes(val);
                    localStorage.setItem(STORAGE_LAST_STAGGER, String(val));
                  }}
                  className="w-full rounded-xl"
                  size="large"
                >
                  <Option value={5}>Lệch nhau 5 phút (Nhóm 1: 0p, Nhóm 2: +5p, Nhóm 3: +10p, Nhóm 4: +15p)</Option>
                  <Option value={10}>Lệch nhau 10 phút (Khuyên dùng · An toàn cao)</Option>
                  <Option value={15}>Lệch nhau 15 phút (Rất an toàn)</Option>
                  <Option value={30}>Lệch nhau 30 phút (Giãn cách rộng)</Option>
                </Select>
                <div className="text-[11px] text-slate-400 mt-1.5">
                  Playwright sẽ phân bổ các bài viết cách nhau đúng {staggerMinutes} phút vào hàng đợi.
                </div>
              </div>
            </div>

            {/* SUBMIT BUTTON */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
              <div className="text-xs text-slate-400">
                {inputMode === 'LINK' && parsedUrls.length > 1 ? (
                  <span>
                    ⚡ Sẽ tạo <b className="text-cyan-400">{parsedUrls.length} bài</b> × <b className="text-emerald-400">{selectedGroupIds.length} nhóm</b> = <b className="text-cyan-300 font-bold text-sm">{parsedUrls.length * selectedGroupIds.length} bài đăng</b> (tự động giãn cách an toàn).
                  </span>
                ) : (
                  <span>
                    Sẽ tạo <b className="text-emerald-400">{selectedGroupIds.length} bài đăng</b> cho các nhóm đã chọn.
                  </span>
                )}
              </div>

              <Button
                type="primary"
                htmlType="submit"
                size="large"
                loading={postMutation.isPending}
                icon={<SendOutlined />}
                disabled={selectedGroupIds.length === 0 || !selectedPageTarget}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-sm h-12 px-8 rounded-xl shadow-lg border-none w-full sm:w-auto"
              >
                {inputMode === 'LINK' && parsedUrls.length > 1
                  ? `Lên Lịch ${parsedUrls.length} Bài (${parsedUrls.length * selectedGroupIds.length} Bài Đăng)`
                  : isPublishNow
                    ? `Xuất Bản Ngay Vào ${selectedGroupIds.length} Nhóm`
                    : `Đặt Lịch Xuất Bản Vào ${selectedGroupIds.length} Nhóm`}
              </Button>
            </div>
          </Form>
        </Card>

        {/* ── DANH SÁCH BÀI ĐANG CHỜ XUẤT BẢN HIỂN THỊ TRỰC TIẾP Ở DƯỚI ── */}
        <Card
          className="!bg-[#111a28] !border-slate-800 shadow-xl rounded-2xl overflow-hidden"
          title={
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-1">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-sky-500/15 text-sky-400 flex items-center justify-center font-bold border border-sky-500/30">
                  <ClockCircleOutlined />
                </div>
                <div>
                  <span className="text-base font-bold text-slate-100">
                    Danh Sách Bài Đang Chờ Xuất Bản (Job Kinh Tế)
                  </span>
                  <span className="ml-2 text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-800/40">
                    {filteredPendingPosts.length} bài
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="small"
                  icon={<ReloadOutlined spin={isLoadingPosts} />}
                  onClick={() => refetchPosts()}
                  className="bg-slate-800 border-slate-700 text-slate-300 text-xs rounded-lg"
                >
                  Tải lại
                </Button>
              </div>
            </div>
          }
        >
          <Table
            dataSource={filteredPendingPosts}
            columns={queueColumns}
            rowKey="id"
            loading={isLoadingPosts}
            pagination={{ pageSize: 15, showSizeChanger: true }}
            className="app-custom-table"
            locale={{
              emptyText: (
                <div className="py-12 text-center text-slate-400 text-xs">
                  Hiện không có bài nào đang chờ đăng cho cụm Job Kinh Tế. Hãy dán link hoặc soạn bài ở biểu mẫu phía trên để lên lịch!
                </div>
              ),
            }}
          />
        </Card>
      </div>
    )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB 3: TOÀN BỘ HÀNG ĐỢI & LỊCH SỬ JOB                         */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {activeTab === 'ALL_QUEUE' && (
        <Card
          className="!bg-[#111a28] !border-slate-800 shadow-xl rounded-2xl overflow-hidden"
          title={
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-1">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center font-bold border border-blue-500/30">
                  📊
                </div>
                <div>
                  <span className="text-base font-bold text-slate-100">
                    Toàn Bộ Hàng Đợi & Lịch Sử Bài Đăng Job Kinh Tế
                  </span>
                  <span className="ml-2 text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                    {filteredAllPosts.length} bài
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="small"
                  icon={<ReloadOutlined spin={isLoadingPosts} />}
                  onClick={() => refetchPosts()}
                  className="bg-slate-800 border-slate-700 text-slate-300 text-xs rounded-lg"
                >
                  Tải lại
                </Button>
              </div>
            </div>
          }
        >
          {/* Filters */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-4">
            <Radio.Group
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value)}
              buttonStyle="solid"
              size="small"
              className="custom-radio-switch"
            >
              <Radio.Button value="ALL">Tất cả ({allPosts.length})</Radio.Button>
              <Radio.Button value="PENDING">Chờ đăng ({overallStats.pending})</Radio.Button>
              <Radio.Button value="PUBLISHED">Đã đăng ({overallStats.published})</Radio.Button>
              <Radio.Button value="FAILED">Lỗi ({overallStats.failed})</Radio.Button>
            </Radio.Group>

            <Input
              size="small"
              placeholder="Tìm theo nội dung hoặc mã ID..."
              prefix={<SearchOutlined className="text-slate-500" />}
              value={searchHistoryText}
              onChange={(e) => setSearchHistoryText(e.target.value)}
              allowClear
              className="w-full sm:w-64 rounded-xl bg-slate-900 border-slate-700 text-slate-200 text-xs py-1"
            />
          </div>

          <Table
            dataSource={filteredAllPosts}
            columns={queueColumns}
            rowKey="id"
            loading={isLoadingPosts}
            pagination={{ pageSize: 15, showSizeChanger: true }}
            className="app-custom-table"
          />
        </Card>
      )}

      {/* ── MODAL CHI TIẾT BÀI ĐĂNG (CHUẨN ĐĂNG TỰ ĐỘNG) ── */}
      <PostDetailModal
        open={!!detailPost}
        post={detailPost as any}
        onClose={() => setDetailPost(null)}
        onRepost={(post) => handlePublishNow(post.id)}
      />
    </div>
  );
};

export default EconomyJob;
