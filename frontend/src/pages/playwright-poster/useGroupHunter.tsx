import type React from 'react';
import type { ScheduleValue } from '../../components/common/postingSchedule';
import { useState, useMemo } from 'react';
import { Modal, Input, type FormInstance, App } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { getStoredGeminiKeys } from '../../components/modals/AiSettingsModal';
import api from '../../config/axios';
import { buildScrapeAccountOptions, cleanMarkdownAsterisks, resolveActiveScrapeAccount } from './shared';
import type { PostLinkItem, SocialAccount, ItemPreview } from './types';

interface GroupHunterParams {
  setBulkText: React.Dispatch<React.SetStateAction<string>>;
  setBulkDrawerPreviews: React.Dispatch<React.SetStateAction<Record<string, { loading: boolean; error?: string; caption?: string; author?: string; mediaUrls?: string[]; mediaKinds?: ("video" | "image")[]; originalMediaUrls?: string[]; originalMediaKinds?: ("video" | "image")[]; videoCount?: number; imageCount?: number; affiliateComment?: string; skipComment?: boolean; includeCredit?: boolean; watermarkRemoved?: boolean; }>>>;
  formatMultiLineCaption: (text: string) => string;
  setScheduleChoice: (v: ScheduleValue) => void;
  form: FormInstance<any>;
  setBulkModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setPreviews: React.Dispatch<React.SetStateAction<Record<string, ItemPreview>>>;
  setLinkItems: React.Dispatch<React.SetStateAction<PostLinkItem[]>>;
  setSwipeReviewIndex: React.Dispatch<React.SetStateAction<number>>;
  setSwipeMediaIndex: React.Dispatch<React.SetStateAction<number>>;
  setSwipeDecisions: React.Dispatch<React.SetStateAction<Record<string, "KEEP" | "REJECT">>>;
  setSwipeReviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  linkItems: PostLinkItem[];
  socialAccounts?: SocialAccount[];
  // Khai báo sau lời gọi hook trong trang cha — đọc lười qua hàm trong callback để tránh lỗi truy cập trước khi khởi tạo
  late: () => {
    socialAccounts?: SocialAccount[];
    setSmartGroupId: React.Dispatch<React.SetStateAction<string>>;
  };
}

// Săn / quét bài viết Facebook Group & Fanpage, đưa bài đã chọn vào danh sách đăng — tách từ PlaywrightPoster (state và hàm giữ nguyên, chỉ chuyển chỗ)
export function useGroupHunter({ setBulkText, setBulkDrawerPreviews, formatMultiLineCaption, setScheduleChoice, form, setBulkModalVisible, setPreviews, setLinkItems, setSwipeReviewIndex, setSwipeMediaIndex, setSwipeDecisions, setSwipeReviewOpen, linkItems, socialAccounts, late }: GroupHunterParams) {
  const { message } = App.useApp();
  // ── SĂN / QUÉT BÀI VIẾT FACEBOOK GROUP (Group Hunter) ─────────────────────────
  const [groupHunterDrawerVisible, setGroupHunterDrawerVisible] = useState(false);
  const [groupHunterTarget, setGroupHunterTarget] = useState<string>('');
  const [groupHunterLimit, setGroupHunterLimit] = useState<number>(20);
  // Lọc bài theo ngày đăng (null = không lọc, quét như cũ)
  const [groupHunterDateRange, setGroupHunterDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [groupHunterMediaFilter, setGroupHunterMediaFilter] = useState<'ALL' | 'MEDIA_ONLY' | 'IMAGE_ONLY' | 'VIDEO_ONLY'>('MEDIA_ONLY');
  const [groupHunterSkipImported, setGroupHunterSkipImported] = useState<boolean>(true);
  const [groupHunterAutoSchedule, setGroupHunterAutoSchedule] = useState<boolean>(true);
  const [groupHunterInterval, setGroupHunterInterval] = useState<number>(60);
  const [groupHunterLoading, setGroupHunterLoading] = useState(false);
  const [groupHunterResults, setGroupHunterResults] = useState<Array<{
    id: string;
    url: string;
    author: string;
    caption: string;
    previewCover: string;
    images: string[];
    mediaType: 'IMAGE' | 'VIDEO' | 'TEXT';
    mediaCount: number;
    isAlreadyImported?: boolean;
    postedTime?: string;
    postedAt?: number | null;
    dateUnknown?: boolean;
    aiCurated?: boolean;
    aiScore?: number;
    qualityVerdict?: string;
    viralAngle?: string;
    suggestedHook?: string;
    isSpam?: boolean;
    originalCaption?: string;
    aiRewritten?: boolean;
  }>>([]);
  const [groupHunterAiCurating, setGroupHunterAiCurating] = useState<boolean>(false);
  const [groupHunterAiOnlyQuality, setGroupHunterAiOnlyQuality] = useState<boolean>(false);
  const [groupHunterScheduleMode, setGroupHunterScheduleMode] = useState<'INTERVAL' | 'GOLDEN_HOURS'>('GOLDEN_HOURS');
  const [groupHunterBatchAiOpen, setGroupHunterBatchAiOpen] = useState(false);
  const [groupHunterBatchAiMode, setGroupHunterBatchAiMode] = useState<'HOOK' | 'REWRITE' | 'ENGAGEMENT' | 'STORYTELLING' | 'SHORTEN'>('REWRITE');
  const [groupHunterBatchAiLoading, setGroupHunterBatchAiLoading] = useState(false);
  const [groupHunterBatchAiProgress, setGroupHunterBatchAiProgress] = useState({ current: 0, total: 0 });
  const [groupHunterPreviewItem, setGroupHunterPreviewItem] = useState<any>(null);
  const [groupHunterGroupName, setGroupHunterGroupName] = useState<string>('');
  // Nguồn của lần quét gần nhất: Group hay Fanpage (Fanpage không tự khớp Nhóm đích)
  const [groupHunterSourceType, setGroupHunterSourceType] = useState<'GROUP' | 'PAGE'>('GROUP');
  const [groupHunterCustomName, setGroupHunterCustomName] = useState<string>('');
  const [groupHunterSelectedIds, setGroupHunterSelectedIds] = useState<Set<string>>(new Set());
  const [favoriteGroupSearch, setFavoriteGroupSearch] = useState('');
  const [favoriteGroupsExpanded, setFavoriteGroupsExpanded] = useState(false);
  const [favoriteGroupCategoryFilter, setFavoriteGroupCategoryFilter] = useState<'ALL' | 'PHIM' | 'GENERAL'>('ALL');

  // Via/Cookie được chọn để quét Group/Fanpage (lưu theo user lựa chọn, mặc định ưu tiên Via cá nhân OK)
  const [selectedScrapeAccountId, setSelectedScrapeAccountId] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem('toolzutter_hunt_scrape_via_id');
      const parsed = saved ? Number(saved) : NaN;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } catch {
      return null;
    }
  });
  const setGroupHunterScrapeAccountId = (id: number | null) => {
    setSelectedScrapeAccountId(id);
    try {
      if (id != null && Number.isFinite(id)) localStorage.setItem('toolzutter_hunt_scrape_via_id', String(id));
      else localStorage.removeItem('toolzutter_hunt_scrape_via_id');
    } catch {}
  };
  const scrapeAccountOptions = useMemo(
    () => buildScrapeAccountOptions(socialAccounts || []),
    [socialAccounts],
  );
  const activeScrapeAccount = useMemo(
    () => resolveActiveScrapeAccount(scrapeAccountOptions, selectedScrapeAccountId),
    [scrapeAccountOptions, selectedScrapeAccountId],
  );

  // Danh sách Group yêu thích do người dùng lưu
  const [favoriteGroups, setFavoriteGroups] = useState<Array<{ name: string; url: string }>>(() => {
    try {
      const saved = localStorage.getItem('toolzutter_favorite_groups');
      return saved ? JSON.parse(saved) : [
        { name: 'Không Sợ Đói', url: 'https://www.facebook.com/groups/1480736115349715/' },
        { name: 'GenZ làm mẹ (400k member)', url: 'https://www.facebook.com/groups/773774567089399' }
      ];
    } catch (e) {
      return [
        { name: 'Không Sợ Đói', url: 'https://www.facebook.com/groups/1480736115349715/' },
        { name: 'GenZ làm mẹ (400k member)', url: 'https://www.facebook.com/groups/773774567089399' }
      ];
    }
  });

  // Danh sách URL nhóm đã chủ động bấm nút X để xóa (không hiển thị lại)
  const [removedFavoriteUrls, setRemovedFavoriteUrls] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('toolzutter_removed_crawlgroups');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const handleAddFavoriteGroup = (urlToAdd?: string, nameToAdd?: string) => {
    const rawTarget = (urlToAdd || groupHunterTarget).trim();
    if (!rawTarget) {
      message.warning('Vui lòng nhập Link hoặc ID Group trước khi lưu!');
      return;
    }
    let normalizedUrl = rawTarget;
    if (!normalizedUrl.startsWith('http')) {
      if (/^\d+$/.test(normalizedUrl)) {
        normalizedUrl = `https://www.facebook.com/groups/${normalizedUrl}`;
      } else {
        normalizedUrl = `https://www.facebook.com/groups/${normalizedUrl.replace(/^groups\//, '')}`;
      }
    }
    const cleanNorm = normalizedUrl.replace(/\/$/, '');
    const groupName = nameToAdd || groupHunterCustomName.trim() || groupHunterGroupName || normalizedUrl.split('/groups/')[1]?.replace(/\/$/, '') || 'Group';

    // Bỏ khỏi danh sách đã xóa nếu thêm lại
    setRemovedFavoriteUrls((prev) => {
      const updated = prev.filter((u) => u !== cleanNorm);
      localStorage.setItem('toolzutter_removed_crawlgroups', JSON.stringify(updated));
      return updated;
    });

    setFavoriteGroups((prev) => {
      if (prev.some((g) => g.url === normalizedUrl || g.url.replace(/\/$/, '') === cleanNorm)) {
        message.info('Group này đã có trong Danh Sách Yêu Thích!');
        return prev;
      }
      const updated = [...prev, { name: groupName, url: normalizedUrl }];
      localStorage.setItem('toolzutter_favorite_groups', JSON.stringify(updated));
      message.success(`⭐ Đã lưu nhóm "${groupName}" vào Danh Sách Yêu Thích!`);
      return updated;
    });
  };

  const handleRemoveFavoriteGroup = (urlToRemove: string) => {
    const norm = (urlToRemove || '').trim().replace(/\/$/, '');
    setFavoriteGroups((prev) => {
      const updated = prev.filter((g) => (g.url || '').trim().replace(/\/$/, '') !== norm);
      localStorage.setItem('toolzutter_favorite_groups', JSON.stringify(updated));
      return updated;
    });
    setRemovedFavoriteUrls((prev) => {
      if (prev.includes(norm)) return prev;
      const updated = [...prev, norm];
      localStorage.setItem('toolzutter_removed_crawlgroups', JSON.stringify(updated));
      return updated;
    });
    message.success('Đã xóa nhóm khỏi danh sách nhóm nguồn');
  };

  const handleRenameFavoriteGroup = (urlToRename: string, currentName: string) => {
    Modal.confirm({
      title: '✏️ Đổi tên gợi nhớ tuyến nội dung cho Group',
      content: (
        <div className="pt-2 space-y-2">
          <div className="text-xs text-slate-400">Nhập tên gợi nhớ tuyến nội dung để dễ nhận biết (VD: Tuyển Dụng, Mẹ & Bé, Nấu Ăn...):</div>
          <Input
            defaultValue={currentName}
            id="rename-group-input"
            placeholder="Ví dụ: Tuyển Dụng Kế Toán, Mẹ & Bé GenZ, Nấu Ăn..."
            className="rounded-lg mt-1"
          />
        </div>
      ),
      onOk: () => {
        const inputEl = document.getElementById('rename-group-input') as HTMLInputElement;
        const newName = inputEl?.value?.trim();
        if (!newName) return;
        setFavoriteGroups((prev) => {
          const updated = prev.map((g) => (g.url === urlToRename ? { ...g, name: newName } : g));
          localStorage.setItem('toolzutter_favorite_groups', JSON.stringify(updated));
          message.success(`✅ Đã đổi tên nhóm thành "${newName}"`);
          return updated;
        });
      },
    });
  };

  const handleHuntFacebookGroup = async () => {
    if (!groupHunterTarget.trim()) {
      message.warning('Vui lòng nhập link Facebook Group hoặc Fanpage (ví dụ: https://www.facebook.com/groups/xxxxx hoặc https://www.facebook.com/tenfanpage)');
      return;
    }
    setGroupHunterLoading(true);
    try {
      const activeCookieAcc = activeScrapeAccount;

      const res = await api.post('/tools/hunt-facebook-group', {
        groupUrl: groupHunterTarget.trim(),
        limit: groupHunterLimit,
        cookieString: activeCookieAcc?.accessToken || undefined,
        dateFrom: groupHunterDateRange ? groupHunterDateRange[0].format('YYYY-MM-DD') : undefined,
        dateTo: groupHunterDateRange ? groupHunterDateRange[1].format('YYYY-MM-DD') : undefined,
      }, { timeout: groupHunterDateRange ? 320000 : 180000 });
      if (res.data?.success && Array.isArray(res.data?.items)) {
        const items = res.data.items;
        setGroupHunterResults(items);
        setGroupHunterGroupName(res.data.groupName || 'Facebook Group');
        setGroupHunterSourceType(res.data.sourceType === 'PAGE' ? 'PAGE' : 'GROUP');

        // Mặc định chọn tối đa `groupHunterLimit` bài MỚI (chưa có trong Lịch Đăng)
        const newItems = items.filter((it: any) => !it.isAlreadyImported && !it.dateUnknown);
        const autoSelectedItems = newItems.slice(0, groupHunterLimit);
        const importedCount = items.length - newItems.length;
        setGroupHunterSelectedIds(new Set(autoSelectedItems.map((it: any) => it.id)));

        // Tự động cập nhật tên nhóm nếu chưa có tên chuẩn
        if (res.data.groupName && res.data.groupName !== 'Facebook Group') {
          const rawTarget = groupHunterTarget.trim();
          setFavoriteGroups((prev) => {
            const idx = prev.findIndex((g) => g.url === rawTarget || rawTarget.includes(g.url) || g.url.includes(rawTarget));
            if (idx !== -1 && prev[idx].name !== res.data.groupName) {
              const copy = [...prev];
              copy[idx] = { ...copy[idx], name: res.data.groupName };
              localStorage.setItem('toolzutter_favorite_groups', JSON.stringify(copy));
              return copy;
            }
            return prev;
          });
        }

        if (res.data.dateFiltered) {
          const inRange = items.filter((it: any) => !it.dateUnknown).length;
          const unknown = Number(res.data.unknownDateCount) || 0;
          const rangeText = `${groupHunterDateRange?.[0].format('DD/MM')} – ${groupHunterDateRange?.[1].format('DD/MM')}`;
          message.success(
            `Đã đọc ${res.data.scannedCount ?? items.length} bài, ${inRange} bài đăng trong ${rangeText}. `
            + `Chọn sẵn ${autoSelectedItems.length} bài mới chưa có trong Lịch đăng`
            + (unknown > 0 ? `, ${unknown} bài không đọc được ngày (chưa chọn).` : '.')
            + (res.data.stopReason === 'TIMEOUT' ? ' Đã dừng do quét quá lâu, có thể còn bài cũ hơn chưa lấy.' : ''),
            6,
          );
        } else if (importedCount > 0) {
          message.success(`🎯 Quét xong ${items.length} bài thô! Đã tự động lọc bỏ ${importedCount} bài trùng & chọn đúng ${autoSelectedItems.length} bài MỚI chưa đăng.`);
        } else {
          message.success(`🎯 Đã quét thành công ${autoSelectedItems.length} bài viết MỚI từ "${res.data.groupName || 'Group'}"!`);
        }
      } else {
        message.error(res.data?.error || 'Không tìm thấy bài viết nào');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.error || err?.message || 'Lỗi khi quét Group / Fanpage Facebook');
    } finally {
      setGroupHunterLoading(false);
    }
  };

  const handleGeminiCurateGroupPosts = async () => {
    if (!groupHunterResults || groupHunterResults.length === 0) {
      message.warning('Chưa có bài viết nào để Gemini thẩm định!');
      return;
    }
    const geminiKey = getStoredGeminiKeys();
    setGroupHunterAiCurating(true);
    message.loading({
      content: '💎 Đang dùng Gemini AI thẩm định nội dung, chấm điểm chất lượng (1-100) và lọc bài rác...',
      key: 'gemini-curate-group',
      duration: 6,
    });
    try {
      const res = await api.post('/tools/gemini-curate-posts', {
        posts: groupHunterResults,
        topic: groupHunterGroupName || 'Nội dung chia sẻ group cộng đồng Facebook',
        apiKey: geminiKey || undefined,
      });

      if (res.data?.success && Array.isArray(res.data?.items)) {
        const curatedList = res.data.items;
        setGroupHunterResults(curatedList);
        const highQualityIds = curatedList
          .filter((p: any) => !p.isAlreadyImported && (p.aiScore || 0) >= 70 && !p.isSpam)
          .slice(0, groupHunterLimit)
          .map((p: any) => p.id);
        if (highQualityIds.length > 0) {
          setGroupHunterSelectedIds(new Set(highQualityIds));
        }
        message.success({
          content: `💎 Gemini đã thẩm định xong ${curatedList.length} bài! Đã gắn điểm chất lượng & lọc bỏ bài rác.`,
          key: 'gemini-curate-group',
        });
      } else {
        message.warning({
          content: res.data?.error || 'Gemini không trả về kết quả thẩm định.',
          key: 'gemini-curate-group',
        });
      }
    } catch (err: any) {
      message.error({
        content: err?.response?.data?.error || err?.message || 'Lỗi khi gọi Gemini thẩm định bài',
        key: 'gemini-curate-group',
      });
    } finally {
      setGroupHunterAiCurating(false);
    }
  };

  const handleApplyGroupHunterHook = (item: any) => {
    if (!item.suggestedHook) return;
    setGroupHunterResults((prev) =>
      prev.map((p) => {
        if (p.id === item.id) {
          const newCaption = cleanMarkdownAsterisks(`${item.suggestedHook}\n\n${p.caption}`);
          return {
            ...p,
            originalCaption: p.originalCaption || p.caption,
            caption: newCaption,
            aiRewritten: true,
          };
        }
        return p;
      })
    );
    message.success('🎣 Đã chèn Hook mở đầu của Gemini vào bài viết!');
  };

  const handleCleanSpamFromSelectedPosts = () => {
    const selected = filteredGroupHunterPosts.filter((it) => groupHunterSelectedIds.has(it.id));
    if (selected.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 bài viết để làm sạch!');
      return;
    }
    let cleanedCount = 0;
    setGroupHunterResults((prev) =>
      prev.map((item) => {
        if (!groupHunterSelectedIds.has(item.id)) return item;
        let text = item.caption || '';
        const original = text;
        // 1. Xoá link web / url / shopee / bit.ly / zalo...
        text = text.replace(/https?:\/\/[^\s]+/gi, '');
        // 2. Xoá số điện thoại / zalo / hotline
        text = text.replace(/(?:zalo|sđt|sdt|hotline|liên hệ|call|lh|tel)[\s:.-]*[0-9]{8,12}/gi, '');
        text = text.replace(/\b0[235789][0-9]{8}\b/g, '');
        // 3. Xoá số tài khoản ngân hàng donate
        text = text.replace(/(?:stk|số tài khoản|ngân hàng|mbbank|vietcombank|techcombank)[\s:.-]*[0-9]{6,16}/gi, '');
        // 4. Xoá lời kêu gọi vào group / tele / page cũ
        text = text.replace(/(?:vào group|link nhóm|nhóm thảo luận|tele(?:gram)?|theo dõi fanpage)[:\s]+[^\n]+/gi, '');
        // 5. Xoá dấu sao markdown (*, **) thô
        text = cleanMarkdownAsterisks(text);
        // 6. Chuẩn hoá dòng trống dư thừa
        text = text.replace(/\n{3,}/g, '\n\n').trim();
        if (text !== original) cleanedCount++;
        return {
          ...item,
          originalCaption: item.originalCaption || item.caption,
          caption: text,
        };
      })
    );
    message.success(`🧹 Đã làm sạch số điện thoại, link quảng cáo & STK cho ${selected.length} bài viết! (Đã bóc rác ở ${cleanedCount} bài)`);
  };

  const handleExecuteGroupHunterBatchAi = async () => {
    const selected = filteredGroupHunterPosts.filter((it) => groupHunterSelectedIds.has(it.id));
    if (selected.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 bài viết để AI viết lại!');
      return;
    }
    setGroupHunterBatchAiLoading(true);
    setGroupHunterBatchAiProgress({ current: 0, total: selected.length });
    const geminiKey = getStoredGeminiKeys();
    let updatedCount = 0;
    const newCaptionsMap = new Map<string, string>();

    for (let i = 0; i < selected.length; i++) {
      const p = selected[i];
      setGroupHunterBatchAiProgress({ current: i + 1, total: selected.length });
      if (!p.caption?.trim()) continue;

      try {
        const res = await api.post('/tools/gemini-rewrite', {
          content: p.caption,
          mode: groupHunterBatchAiMode,
          platform: 'FACEBOOK',
          apiKey: geminiKey || undefined,
        });
        if (res.data?.success && res.data?.rewritten) {
          newCaptionsMap.set(p.id, cleanMarkdownAsterisks(res.data.rewritten));
          updatedCount++;
        }
      } catch (e: any) {
        console.warn(`Lỗi rewrite bài ${p.id}:`, e);
      }
    }

    setGroupHunterResults((prev) =>
      prev.map((p) => {
        if (newCaptionsMap.has(p.id)) {
          return {
            ...p,
            originalCaption: p.originalCaption || p.caption,
            caption: newCaptionsMap.get(p.id)!,
            aiRewritten: true,
          };
        }
        return p;
      })
    );

    setGroupHunterBatchAiLoading(false);
    setGroupHunterBatchAiOpen(false);
    message.success(`🎉 Gemini đã xào xong ${updatedCount} bài viết theo phong cách chọn!`);
  };

  const filteredGroupHunterPosts = useMemo(() => {
    let list = [...groupHunterResults];
    if (groupHunterSkipImported) {
      list = list.filter((it) => !it.isAlreadyImported);
    }
    if (groupHunterAiOnlyQuality) {
      list = list.filter((it) => !it.aiCurated || ((it.aiScore || 0) >= 70 && !it.isSpam));
    }
    if (groupHunterMediaFilter === 'MEDIA_ONLY') {
      list = list.filter((it) => it.mediaCount > 0);
    } else if (groupHunterMediaFilter === 'IMAGE_ONLY') {
      list = list.filter((it) => it.mediaType === 'IMAGE');
    } else if (groupHunterMediaFilter === 'VIDEO_ONLY') {
      list = list.filter((it) => it.mediaType === 'VIDEO');
    }
    return list;
  }, [groupHunterResults, groupHunterMediaFilter, groupHunterSkipImported, groupHunterAiOnlyQuality]);

  const handleImportGroupHunterPosts = () => {
    const selected = filteredGroupHunterPosts.filter((it) => groupHunterSelectedIds.has(it.id));
    if (selected.length === 0) {
      message.warning('Chưa chọn bài viết nào để nhập!');
      return;
    }
    const linksText = selected.map((it) => it.url).join('\n');
    setBulkText((prev) => (prev ? `${prev}\n${linksText}` : linksText));

    // Nạp sẵn toàn bộ hình ảnh, video & caption đã cào được từ Group Hunter vào cache
    // để Drawer "Dán link hàng loạt" hiển thị ngay lập tức 0 giây, KHÔNG CẦN cào lại lần 2!
    setBulkDrawerPreviews((prev) => {
      const next = { ...prev };
      for (const item of selected) {
        const rawMedia = (item.images && item.images.length > 0)
          ? item.images
          : item.previewCover
            ? [item.previewCover]
            : [];
        const mediaKinds: Array<'video' | 'image'> = item.mediaType === 'VIDEO'
          ? ['video']
          : rawMedia.map(() => 'image');

        next[item.url] = {
          loading: false,
          caption: formatMultiLineCaption(item.caption || ''),
          author: item.author || '',
          mediaUrls: rawMedia,
          mediaKinds: mediaKinds,
          originalMediaUrls: [...rawMedia],
          originalMediaKinds: [...mediaKinds],
          videoCount: item.mediaType === 'VIDEO' ? 1 : 0,
          imageCount: item.mediaType === 'IMAGE' ? (item.mediaCount || rawMedia.length) : 0,
          watermarkRemoved: true,
        };
      }
      return next;
    });

    // Tự lên lịch = "Xếp vào lịch" theo Lịch đăng chung (khung giờ + giãn cách do server xếp)
    if (groupHunterAutoSchedule) {
      setScheduleChoice({ mode: 'QUEUE' });
    }

    // Tự động khớp và chọn Nhóm đích tương ứng với Group vừa cào bài
    const rawTarget = (groupHunterTarget || '').trim();
    if (rawTarget && late().socialAccounts && groupHunterSourceType === 'GROUP') {
      const matchedAccount = (late().socialAccounts || []).find((a) =>
        a.platform === 'FACEBOOK_GROUP' &&
        (
          a.platformAccountId === rawTarget ||
          (rawTarget.includes(a.platformAccountId) && a.platformAccountId.length > 5) ||
          (a.pageName && groupHunterGroupName && a.pageName.toLowerCase().includes(groupHunterGroupName.toLowerCase())) ||
          (a.pageName && groupHunterGroupName && groupHunterGroupName.toLowerCase().includes(a.pageName.toLowerCase()))
        )
      );
      if (matchedAccount) {
        late().setSmartGroupId(matchedAccount.platformAccountId);
        form.setFieldValue('targetGroupId', matchedAccount.platformAccountId);
        form.setFieldValue('groupNames', [matchedAccount.platformAccountId]);
      }
    }

    setGroupHunterDrawerVisible(false);
    setBulkModalVisible(true);
    message.success(
      `Đã chuyển ${selected.length} bài viết vào danh sách đăng.${groupHunterAutoSchedule ? ' Bài sẽ được xếp vào lịch đăng chung.' : ''}`
    );
  };

  const handleImportAndSwipeGroupHunterPosts = () => {
    const selected = filteredGroupHunterPosts.filter((it) => groupHunterSelectedIds.has(it.id));
    if (selected.length === 0) {
      message.warning('Chưa chọn bài viết nào để duyệt!');
      return;
    }

    if (groupHunterAutoSchedule) {
      setScheduleChoice({ mode: 'QUEUE' });
    }

    // Tạo trực tiếp linkItems
    const newItems: PostLinkItem[] = selected.map((it, idx) => ({
      id: Math.random().toString(36).substring(2, 9),
      url: it.url,
      isNow: true,
      scheduledAt: dayjs(),
      includeCredit: true,
      skipComment: false,
      affiliateLink: '',
      customCaption: formatMultiLineCaption(it.caption || ''),
    }));

    // Tạo previews đầy đủ cho Tinder modal xem ảnh / video
    const newPreviews: Record<string, {
      loading: boolean;
      caption?: string;
      author?: string;
      mediaUrls?: string[];
      mediaKinds?: Array<'video' | 'image'>;
      originalMediaUrls?: string[];
      originalMediaKinds?: Array<'video' | 'image'>;
      videoCount?: number;
      imageCount?: number;
      watermarkRemoved?: boolean;
    }> = {};

    newItems.forEach((item, idx) => {
      const post = selected[idx];
      const rawMedia = (post.images && post.images.length > 0)
        ? post.images
        : post.previewCover
          ? [post.previewCover]
          : [];
      const mediaKinds: Array<'video' | 'image'> = post.mediaType === 'VIDEO'
        ? ['video']
        : rawMedia.map(() => 'image');

      newPreviews[item.id] = {
        loading: false,
        caption: formatMultiLineCaption(post.caption || ''),
        author: post.author || '',
        mediaUrls: rawMedia,
        mediaKinds: mediaKinds,
        originalMediaUrls: [...rawMedia],
        originalMediaKinds: [...mediaKinds],
        videoCount: post.mediaType === 'VIDEO' ? 1 : 0,
        imageCount: post.mediaType === 'IMAGE' ? (post.mediaCount || rawMedia.length) : 0,
        watermarkRemoved: true,
      };
    });

    // Cập nhật Nhóm đích tương ứng nếu có
    const rawTarget = (groupHunterTarget || '').trim();
    if (rawTarget && late().socialAccounts && groupHunterSourceType === 'GROUP') {
      const matchedAccount = (late().socialAccounts || []).find((a) =>
        a.platform === 'FACEBOOK_GROUP' &&
        (
          a.platformAccountId === rawTarget ||
          (rawTarget.includes(a.platformAccountId) && a.platformAccountId.length > 5) ||
          (a.pageName && groupHunterGroupName && a.pageName.toLowerCase().includes(groupHunterGroupName.toLowerCase())) ||
          (a.pageName && groupHunterGroupName && groupHunterGroupName.toLowerCase().includes(a.pageName.toLowerCase()))
        )
      );
      if (matchedAccount) {
        late().setSmartGroupId(matchedAccount.platformAccountId);
        form.setFieldValue('targetGroupId', matchedAccount.platformAccountId);
        form.setFieldValue('groupNames', [matchedAccount.platformAccountId]);
      }
    }

    setPreviews((prev) => ({ ...prev, ...newPreviews }));
    setLinkItems(newItems);

    setGroupHunterDrawerVisible(false);
    setSwipeReviewIndex(0);
    setSwipeMediaIndex(0);
    setSwipeDecisions({});
    setSwipeReviewOpen(true);
  };

  const validLinkCount = linkItems.filter((item) => {
    const hasUrl = !!item.url && item.url.trim().length > 0;
    const hasContent = (!!item.manualContent && item.manualContent.trim().length > 0) || (!!item.customCaption && item.customCaption.trim().length > 0);
    const hasMedia = (item.manualMediaUrls?.length || 0) > 0;
    return hasUrl || hasContent || hasMedia;
  }).length;

  return {
    removedFavoriteUrls,
    favoriteGroups,
    favoriteGroupCategoryFilter,
    favoriteGroupSearch,
    favoriteGroupsExpanded,
    groupHunterDrawerVisible,
    validLinkCount,
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
    setFavoriteGroupSearch,
    setFavoriteGroupsExpanded,
    setFavoriteGroupCategoryFilter,
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
    scrapeAccountOptions,
    activeScrapeAccount,
    setGroupHunterScrapeAccountId,
  };
}
