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
  const [smartDispatchSummary, setSmartDispatchSummary] = useState<{
    total: number;
    nickCounts: Record<string, number>;
  } | null>(null);

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

  // ── Chia bài vòng tròn cho các nick (giờ đăng do Lịch đăng chung trên server xếp) ──
  const handleSmartDispatch = (customNicks?: string[]) => {
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

    const k = targetPool.length;

    const newTargets: Record<string, string> = { ...customItemTargets };
    const nickCounts: Record<string, number> = {};

    const updated = linkItems.map((item) => {
      const idx = validItems.findIndex((v) => v.id === item.id);
      if (idx === -1) return item;

      const targetVal = targetPool[idx % k];
      newTargets[item.id] = targetVal;

      const targetObj = postingIdentities.find((a) => accountTargetValue(a) === targetVal);
      const rawName = (targetObj?.pageName || targetVal).replace(/^👤\s*Nick Cá Nhân\s*\((.*)\)$/, '$1');
      nickCounts[rawName] = (nickCounts[rawName] || 0) + 1;

      return item;
    });

    setCustomItemTargets(newTargets);
    setLinkItems(updated);

    setSmartDispatchSummary({ total: validItems.length, nickCounts });

    const summaryStr = Object.entries(nickCounts).map(([name, c]) => `${name}: ${c} bài`).join(' · ');
    message.success(`Đã chia ${validItems.length} bài cho các nick (${summaryStr}).`, 5);
  };

  return {
    smartDispatchSummary,
    resetEqualDistribution,
    handleSmartDispatch,
    applyEqualDistributionToPosts,
  };
}
