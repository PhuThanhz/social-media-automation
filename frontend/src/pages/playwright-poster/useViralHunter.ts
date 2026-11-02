import type React from 'react';
import { useState, useMemo } from 'react';
import { App } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import api from '../../config/axios';

interface ViralHunterParams {
  setBulkText: React.Dispatch<React.SetStateAction<string>>;
  setBulkStartMode: React.Dispatch<React.SetStateAction<"NOW" | "TIME">>;
  setBulkStartTime: React.Dispatch<React.SetStateAction<Dayjs>>;
  setBulkInterval: React.Dispatch<React.SetStateAction<number>>;
  setBulkModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
}

// Săn video viral từ kênh TikTok, đưa video đã chọn vào danh sách dán hàng loạt — tách từ PlaywrightPoster (state và hàm giữ nguyên, chỉ chuyển chỗ)
export function useViralHunter({ setBulkText, setBulkStartMode, setBulkStartTime, setBulkInterval, setBulkModalVisible }: ViralHunterParams) {
  const { message } = App.useApp();
  // TikTok Channel & Viral Hunter State
  const [hunterDrawerVisible, setHunterDrawerVisible] = useState(false);
  const [hunterTarget, setHunterTarget] = useState('');
  const [hunterLimit, setHunterLimit] = useState<number>(48);
  const [hunterMinViews, setHunterMinViews] = useState<number>(0);
  const [hunterDurationFilter, setHunterDurationFilter] = useState<'ALL' | 'SHORT' | 'LONG'>('ALL');
  const [hunterSortBy, setHunterSortBy] = useState<'VIEWS_DESC' | 'LIKES_DESC' | 'NEWEST'>('VIEWS_DESC');
  const [hunterUltraHD, setHunterUltraHD] = useState<boolean>(true);
  const [hunterHideImported, setHunterHideImported] = useState<boolean>(true);
  const [hunterAutoSchedule, setHunterAutoSchedule] = useState<boolean>(false);
  const [hunterLoading, setHunterLoading] = useState(false);
  const [hunterResults, setHunterResults] = useState<Array<{
    id: string;
    url: string;
    title: string;
    desc: string;
    views: number;
    likes: number;
    comments: number;
    duration: string;
    cover: string;
    channel: string;
    isAlreadyImported?: boolean;
    postStatus?: string;
  }>>([]);
  const [hunterSelectedIds, setHunterSelectedIds] = useState<Set<string>>(new Set());

  const handleHuntChannel = async () => {
    if (!hunterTarget.trim()) {
      message.warning('Vui lòng nhập tên kênh (ví dụ: @tiemmeoxinh) hoặc link TikTok');
      return;
    }
    setHunterLoading(true);
    try {
      const res = await api.post('/tools/hunt-tiktok-channel', {
        handle: hunterTarget.trim(),
        limit: hunterLimit,
      });
      if (res.data?.success && Array.isArray(res.data?.items)) {
        const items = res.data.items;
        setHunterResults(items);
        // Tự động bỏ chọn các video đã từng đăng / đã có trong hàng đợi
        const validNew = items.filter((it: any) => !it.isAlreadyImported);
        setHunterSelectedIds(new Set((validNew.length > 0 ? validNew : items).map((it: any) => it.id)));
        const dupCount = Number(res.data.alreadyImportedCount) || (items.length - validNew.length);
        message.success(
          `🎯 Đã quét được ${items.length} video từ ${res.data.channel || hunterTarget}!${
            dupCount > 0 ? ` (Tự động bỏ chọn ${dupCount} video đã từng đăng)` : ''
          }`
        );
      } else {
        message.error(res.data?.error || 'Không tìm thấy video nào');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.error || err?.message || 'Lỗi khi quét kênh TikTok');
    } finally {
      setHunterLoading(false);
    }
  };

  // Lọc và sắp xếp video theo tiêu chí của người dùng
  const filteredAndSortedHunterVideos = useMemo(() => {
    let list = [...hunterResults];

    // Lọc bỏ video đã đăng nếu bật chế độ Ẩn video đã đăng
    if (hunterHideImported) {
      list = list.filter((it) => !it.isAlreadyImported);
    }

    // Lọc theo lượt xem tối thiểu
    if (hunterMinViews > 0) {
      list = list.filter((it) => it.views >= hunterMinViews);
    }

    // Lọc theo thời lượng
    if (hunterDurationFilter === 'SHORT') {
      list = list.filter((it) => {
        const dur = it.duration ? (it.duration.includes(':') ? parseInt(it.duration.split(':')[0]) * 60 + parseInt(it.duration.split(':')[1]) : parseInt(it.duration)) : 0;
        return dur <= 60;
      });
    } else if (hunterDurationFilter === 'LONG') {
      list = list.filter((it) => {
        const dur = it.duration ? (it.duration.includes(':') ? parseInt(it.duration.split(':')[0]) * 60 + parseInt(it.duration.split(':')[1]) : parseInt(it.duration)) : 0;
        return dur > 60;
      });
    }

    // Sắp xếp
    if (hunterSortBy === 'VIEWS_DESC') {
      list.sort((a, b) => b.views - a.views);
    } else if (hunterSortBy === 'LIKES_DESC') {
      list.sort((a, b) => b.likes - a.likes);
    }

    return list;
  }, [hunterResults, hunterHideImported, hunterMinViews, hunterDurationFilter, hunterSortBy]);

  const handleImportHunterVideos = () => {
    const selected = filteredAndSortedHunterVideos.filter((it) => hunterSelectedIds.has(it.id));
    if (selected.length === 0) {
      message.warning('Chưa chọn video nào để nhập!');
      return;
    }
    const linksText = selected.map((it) => it.url).join('\n');
    setBulkText((prev) => (prev ? `${prev}\n${linksText}` : linksText));

    if (hunterAutoSchedule) {
      // Bật chế độ rải lịch: Cách nhau 180 phút (3 tiếng 1 bài) bắt đầu từ 11:30 ngày mai
      setBulkStartMode('TIME');
      setBulkStartTime(dayjs().add(1, 'day').hour(11).minute(30));
      setBulkInterval(180);
    }

    setHunterDrawerVisible(false);
    setBulkModalVisible(true);
    message.success(`🚀 Đã chuyển ${selected.length} video viral vào danh sách dán hàng loạt! ${hunterAutoSchedule ? 'Đã kích hoạt rải lịch tự động!' : ''}`);
  };

  return {
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
  };
}
