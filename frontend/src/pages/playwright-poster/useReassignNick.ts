import type React from 'react';
import { useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { POSTING_WINDOW_QUERY_KEY } from '../../components/common/PostingWindowPanel';
import api from '../../config/axios';

interface ReassignNickParams {
  selectedRowKeys: React.Key[];
  setSelectedRowKeys: React.Dispatch<React.SetStateAction<React.Key[]>>;
  queryClient: QueryClient;
}

// Chuyển bài đã chọn sang nick khác / chia đều nhiều nick — tách từ PlaywrightPoster (state và hàm giữ nguyên, chỉ chuyển chỗ)
export function useReassignNick({ selectedRowKeys, setSelectedRowKeys, queryClient }: ReassignNickParams) {
  const { message } = App.useApp();
  // Modal Chuyển Nick / Cân bằng tải cho các bài đã chọn
  const [reassignModalVisible, setReassignModalVisible] = useState(false);
  const [reassignSelectedNicks, setReassignSelectedNicks] = useState<string[]>([]);
  const [reassignRescheduleToday, setReassignRescheduleToday] = useState(true);
  const [isReassigning, setIsReassigning] = useState(false);

  // Xử lý chuyển nick / chia đều sang nhiều Nick (Cân bằng tải)
  const handleApplyReassignNicks = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 bài viết cần chuyển Nick!');
      return;
    }
    if (reassignSelectedNicks.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 Nick / Via đích để chuyển bài sang!');
      return;
    }
    setIsReassigning(true);
    try {
      const numericIds = selectedRowKeys.map((k) => Number(k)).filter((n) => !isNaN(n));
      const res = await api.post('/queue/reassign-nicks', {
        postIds: numericIds,
        targetFanpageIds: reassignSelectedNicks,
        rescheduleToday: reassignRescheduleToday,
      });
      if (res.data?.success) {
        message.success(
          `🔀 Đã chuyển ${res.data.updatedCount} bài sang ${res.data.targetCount} Nick thành công!${reassignRescheduleToday ? ' (Đã tự động xếp lịch vào hôm nay)' : ''}`,
          6
        );
        setReassignModalVisible(false);
        setSelectedRowKeys([]);
        queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
        queryClient.invalidateQueries({ queryKey: POSTING_WINDOW_QUERY_KEY });
      } else {
        message.error(res.data?.message || 'Có lỗi khi chuyển Nick');
      }
    } catch (e: any) {
      console.error(e);
      message.error('Lỗi khi chuyển Nick: ' + (e?.response?.data?.message || e.message || 'Lỗi mạng'));
    } finally {
      setIsReassigning(false);
    }
  };

  return {
    reassignModalVisible,
    setReassignModalVisible,
    setReassignSelectedNicks,
    reassignSelectedNicks,
    reassignRescheduleToday,
    setReassignRescheduleToday,
    isReassigning,
    handleApplyReassignNicks,
  };
}
