import type React from 'react';
import { useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import dayjs from 'dayjs';
import api from '../../config/axios';
import type { SocialAccount, PostLinkItem, PostQueue } from './types';

interface QueueDispatchParams {
  selectedDistributePages: string[];
  linkItems: PostLinkItem[];
  customItemTargets: Record<string, string>;
  setCustomItemTargets: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setDistributeModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  activeSelectedFanpageIds: string[];
  playwrightAccounts: SocialAccount[];
  accountTargetValue: (account: SocialAccount) => string;
  twoMainViasTargetValues: string[];
  postingIdentities: SocialAccount[];
  setLinkItems: React.Dispatch<React.SetStateAction<PostLinkItem[]>>;
  posts: PostQueue[];
  setIsBulkProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  queryClient: QueryClient;
}

// Chia đều tỉ lệ Page, Smart Dispatch và tự sửa lịch hàng đợi 1-click — tách từ PlaywrightPoster (state và hàm giữ nguyên, chỉ chuyển chỗ)
export function useQueueDispatch({ selectedDistributePages, linkItems, customItemTargets, setCustomItemTargets, setDistributeModalOpen, activeSelectedFanpageIds, playwrightAccounts, accountTargetValue, twoMainViasTargetValues, postingIdentities, setLinkItems, posts, setIsBulkProcessing, queryClient }: QueueDispatchParams) {
  const { message } = App.useApp();
  // ── Smart Dispatch State (Phân bổ thông minh 1-Click: Chia bài + Nick + Giờ so le) ──
  const [smartDispatchInterval, setSmartDispatchInterval] = useState<number>(20);
  const [smartDispatchStartMode, setSmartDispatchStartMode] = useState<'NOW' | 'TOMORROW_830'>('NOW');
  const [smartDispatchSummary, setSmartDispatchSummary] = useState<{
    total: number;
    nickCounts: Record<string, number>;
    startTime: string;
    endTime: string;
    stepMinutes: number;
  } | null>(null);

  // ── Auto-Fix Queue State (Tự động xếp lại lịch hàng đợi an toàn) ──
  const [autoFixQueueModalVisible, setAutoFixQueueModalVisible] = useState(false);
  const [autoFixInterval, setAutoFixInterval] = useState<number>(20);
  const [autoFixStartMode, setAutoFixStartMode] = useState<'NOW' | 'TOMORROW_830'>('TOMORROW_830');
  const [autoFixDistributeVias, setAutoFixDistributeVias] = useState<boolean>(false);

  // ── Tính năng 1-Click Chia Đều Tỉ Lệ Cho Các Page Đã Chọn ──
  const applyEqualDistributionToPosts = () => {
    if (selectedDistributePages.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 Fanpage hoặc Nick để chia đều!');
      return;
    }
    if (linkItems.length === 0) {
      message.warning('Danh sách bài viết đang trống!');
      return;
    }

    const newTargets: Record<string, string> = { ...customItemTargets };
    linkItems.forEach((item, index) => {
      newTargets[item.id] = selectedDistributePages[index % selectedDistributePages.length];
    });

    setCustomItemTargets(newTargets);
    setDistributeModalOpen(false);

    const pagesCount = selectedDistributePages.length;
    const postsCount = linkItems.length;
    const avg = Math.floor(postsCount / pagesCount);
    const remainder = postsCount % pagesCount;
    const infoText = remainder === 0
      ? `mỗi kênh nhận đúng ${avg} bài`
      : `khoảng ${avg} - ${avg + 1} bài/kênh`;

    message.success(`⚡ Đã chia đều ${postsCount} bài cho ${pagesCount} Fanpage/Nick (${infoText})! Các ô nơi đăng bên dưới đã được cập nhật.`);
  };

  const resetEqualDistribution = () => {
    setCustomItemTargets({});
    setSmartDispatchSummary(null);
    message.info('Đã xóa chia đều! Các bài viết sẽ dùng lại Fanpage mặc định đã chọn ở trên.');
  };

  // ── SMART DISPATCH: Chia bài tròn đều + So le thời gian an toàn 1-Click ──
  const handleSmartDispatch = (customNicks?: string[], customInterval?: number) => {
    const validItems = linkItems.filter((i) =>
      (i.url && i.url.trim().length > 0) ||
      (i.manualContent && i.manualContent.trim().length > 0) ||
      (i.customCaption && i.customCaption.trim().length > 0)
    );
    if (validItems.length === 0) {
      message.warning('Danh sách bài viết đang trống hoặc chưa có link hợp lệ!');
      return;
    }

    let targetPool: string[] = [];
    if (customNicks && customNicks.length > 0) {
      targetPool = customNicks;
    } else if (activeSelectedFanpageIds && activeSelectedFanpageIds.length > 0) {
      // Ưu tiên dùng đúng Fanpage / Nick mà người dùng ĐÃ CHỌN trên Form
      const expanded: string[] = [];
      activeSelectedFanpageIds.forEach((targetVal) => {
        if (!expanded.includes(targetVal)) expanded.push(targetVal);
        const acc = playwrightAccounts.find((a) => accountTargetValue(a) === targetVal);
        if (acc) {
          const normName = (acc.pageName || acc.platformAccountId).trim().toLowerCase();
          // Tự động bổ sung các Via đồng quản trị của Page này để chạy 2 Worker song song
          playwrightAccounts
            .filter((o) => (o.pageName || o.platformAccountId).trim().toLowerCase() === normName && o.tokenStatus !== 'EXPIRED')
            .forEach((o) => {
              const oVal = accountTargetValue(o);
              if (!expanded.includes(oVal)) expanded.push(oVal);
            });
        }
      });
      targetPool = expanded;
    } else {
      targetPool = twoMainViasTargetValues;
    }

    if (targetPool.length === 0) {
      targetPool = postingIdentities.slice(0, 2).map(accountTargetValue);
    }
    if (targetPool.length === 0) {
      message.warning('Không tìm thấy Nick hoặc Fanpage nào khả dụng để phân bổ!');
      return;
    }

    const interval = customInterval || smartDispatchInterval || 20;
    const k = targetPool.length;
    // Bước nhảy giữa 2 bài bất kỳ liên tiếp trong toàn hệ thống (so le)
    const step = Math.max(5, Math.round(interval / k));

    let start = smartDispatchStartMode === 'TOMORROW_830'
      ? dayjs().add(1, 'day').hour(8).minute(30).second(0)
      : dayjs().add(10, 'minute');

    const newTargets: Record<string, string> = { ...customItemTargets };
    const nickCounts: Record<string, number> = {};

    const updated = linkItems.map((item) => {
      const idx = validItems.findIndex((v) => v.id === item.id);
      if (idx === -1) return item;

      const targetVal = targetPool[idx % k];
      newTargets[item.id] = targetVal;

      const assignedTime = start.add(idx * step, 'minute');
      const targetObj = postingIdentities.find((a) => accountTargetValue(a) === targetVal);
      const rawName = (targetObj?.pageName || targetVal).replace(/^👤\s*Nick Cá Nhân\s*\((.*)\)$/, '$1');
      nickCounts[rawName] = (nickCounts[rawName] || 0) + 1;

      return {
        ...item,
        isNow: false,
        scheduledAt: assignedTime,
      };
    });

    setCustomItemTargets(newTargets);
    setLinkItems(updated);

    const endTime = start.add(Math.max(0, validItems.length - 1) * step, 'minute');
    setSmartDispatchSummary({
      total: validItems.length,
      nickCounts,
      startTime: start.format('HH:mm DD/MM'),
      endTime: endTime.format('HH:mm DD/MM'),
      stepMinutes: step,
    });

    const summaryStr = Object.entries(nickCounts).map(([name, c]) => `${name}: ${c} bài`).join(' · ');
    message.success(`⚡ Đã chia đều ${validItems.length} bài (${summaryStr}) từ ${start.format('HH:mm')} đến ${endTime.format('HH:mm')} (so le ${step}p/bài, mỗi nick nghỉ ${interval}p)!`, 6);
  };

  // ── AUTO-FIX QUEUE: Tự động xếp lại toàn bộ lịch hàng đợi an toàn 1-Click (Rải đều từng group từ sáng đến tối) ──
  const handleAutoFixQueue = async () => {
    const pendingPosts = (posts || []).filter((p) => p.status === 'PENDING');
    if (pendingPosts.length === 0) {
      message.warning('Không có bài viết nào đang ở trạng thái Chờ đăng (PENDING)!');
      return;
    }

    setIsBulkProcessing(true);
    try {
      const targetPool = twoMainViasTargetValues.length >= 2
        ? twoMainViasTargetValues
        : postingIdentities.slice(0, 2).map(accountTargetValue);
      const k = Math.max(1, targetPool.length);

      const isTomorrow = autoFixStartMode === 'TOMORROW_830';
      const baseDate = isTomorrow ? dayjs().add(1, 'day') : dayjs();
      const startH = 8;
      const startM = 30;
      const endH = 22;
      const endM = 30;

      // 1. Phân nhóm theo điểm đăng (Group / Fanpage)
      const targetBuckets = new Map<string, PostQueue[]>();
      pendingPosts.forEach((p) => {
        const raw = (p.targetGroupNames || '').replace(/^GROUP_ONLY_ANON:|^GROUP_ONLY:/, '').trim();
        const key = raw || p.targetFanpageId || 'PAGE_FEED';
        if (!targetBuckets.has(key)) targetBuckets.set(key, []);
        targetBuckets.get(key)!.push(p);
      });

      const targets = Array.from(targetBuckets.entries());
      const staggerMinutes = targets.length > 6 ? 2 : 3;
      const minGroupGapMinutes = Math.max(15, autoFixInterval || 20);

      const postTimes = new Map<number, dayjs.Dayjs>();
      const now = dayjs();

      targets.forEach(([targetKey, targetPosts], targetIdx) => {
        let remaining = [...targetPosts];
        let dayOffset = 0;
        const groupStagger = (targetIdx * staggerMinutes) % 25;

        while (remaining.length > 0 && dayOffset < 365) {
          const currentDay = baseDate.clone().add(dayOffset, 'day');
          let startDt = currentDay.clone().hour(startH).minute(startM).second(0).add(groupStagger, 'minute');
          let endDt = currentDay.clone().hour(endH).minute(endM).second(0);

          if (currentDay.isSame(now, 'day')) {
            const earliestToday = now.clone().add(10 + groupStagger, 'minute').second(0);
            if (startDt.isBefore(earliestToday)) {
              startDt = earliestToday;
            }
            if (endDt.diff(startDt, 'minute') < 15) {
              dayOffset++;
              continue;
            }
          }

          const availableMinutes = Math.max(0, endDt.diff(startDt, 'minute'));
          const maxFit = Math.max(1, Math.floor(availableMinutes / minGroupGapMinutes) + 1);
          const batchSize = Math.min(remaining.length, maxFit);

          const dayBatch = remaining.slice(0, batchSize);
          remaining = remaining.slice(batchSize);

          if (dayBatch.length === 1) {
            postTimes.set(Number(dayBatch[0].id), startDt.add(Math.round(availableMinutes * 0.45), 'minute'));
          } else if (dayBatch.length > 1) {
            const stepMinutes = availableMinutes / (dayBatch.length - 1);
            for (let j = 0; j < dayBatch.length; j++) {
              postTimes.set(Number(dayBatch[j].id), startDt.add(Math.round(j * stepMinutes), 'minute'));
            }
          }

          dayOffset++;
        }
      });

      // 2. Chống trùng giây/phút toàn cục
      const sortedByTime = pendingPosts.map((p) => ({
        post: p,
        time: postTimes.get(Number(p.id)) || (isTomorrow ? baseDate.hour(9).minute(0) : now.add(15, 'minute')),
      })).sort((a, b) => a.time.valueOf() - b.time.valueOf());

      const minGlobalGapSeconds = 75;
      let lastTime: dayjs.Dayjs | null = null;

      const updates = sortedByTime.map((item, idx) => {
        let t = item.time;
        if (lastTime && t.diff(lastTime, 'second') < minGlobalGapSeconds) {
          t = lastTime.add(minGlobalGapSeconds, 'second');
        }
        lastTime = t;

        const post = item.post;
        let assignedTarget = post.targetFanpageId;
        if (autoFixDistributeVias) {
          const isPersonal = post.targetFanpageId?.includes('PERSONAL_PROFILE') || post.targetFanpageId === 'PERSONAL_PROFILE';
          if (isPersonal) {
            assignedTarget = targetPool[idx % k];
          } else if (post.targetFanpageId) {
            const curTarget = post.targetFanpageId;
            const platformId = curTarget.split(':')[0];
            const coAdminsForPage = playwrightAccounts.filter(
              (a) => a.platformAccountId === platformId && a.tokenStatus !== 'EXPIRED'
            );
            if (coAdminsForPage.length > 1) {
              assignedTarget = accountTargetValue(coAdminsForPage[idx % coAdminsForPage.length]);
            }
          }
        }

        if (assignedTarget && assignedTarget.includes(':113')) {
          assignedTarget = assignedTarget.replace(':113', ':129');
        }

        return {
          id: post.id,
          scheduledAt: t.format('YYYY-MM-DDTHH:mm:ss'),
          targetFanpageId: assignedTarget,
        };
      });

      const res = await api.post('/queue/reschedule-batch', { updates });
      if (res.data?.success) {
        message.success(`🎉 Đã xếp lại lịch rải đều sáng-tối cho ${updates.length} bài viết PENDING qua ${targets.length} Group/Kênh!`, 7);
        setAutoFixQueueModalVisible(false);
        queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
        queryClient.invalidateQueries({ queryKey: ['postQueue'] });
      } else {
        message.error('Lỗi khi xếp lại lịch: ' + (res.data?.message || 'Không xác định'));
      }
    } catch (err: any) {
      message.error('Lỗi khi xếp lại lịch: ' + (err.message || 'Lỗi kết nối'));
    } finally {
      setIsBulkProcessing(false);
    }
  };

  return {
    autoFixQueueModalVisible,
    smartDispatchInterval,
    setSmartDispatchInterval,
    smartDispatchStartMode,
    setSmartDispatchStartMode,
    smartDispatchSummary,
    resetEqualDistribution,
    handleSmartDispatch,
    setAutoFixQueueModalVisible,
    autoFixInterval,
    setAutoFixInterval,
    autoFixStartMode,
    setAutoFixStartMode,
    autoFixDistributeVias,
    setAutoFixDistributeVias,
    handleAutoFixQueue,
    applyEqualDistributionToPosts,
  };
}
