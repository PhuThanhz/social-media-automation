import type React from 'react';
import { useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import api from '../../config/axios';
import type { PostQueue } from './types';

interface FailedPostActionsParams {
  setIsBulkProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  queryClient: QueryClient;
  posts: PostQueue[];
}

// Xử lý bài lỗi: chuyển về Chờ đăng, đăng lại, xoá hàng loạt — tách từ PlaywrightPoster (state và hàm giữ nguyên, chỉ chuyển chỗ)
export function useFailedPostActions({ setIsBulkProcessing, queryClient, posts }: FailedPostActionsParams) {
  const { message } = App.useApp();
  // Modal chuyển toàn bộ bài lỗi về Chờ đăng (Reset Failed to Pending)
  const [resetFailedModalVisible, setResetFailedModalVisible] = useState(false);
  const [resetFailedMode, setResetFailedMode] = useState<'STAGGER' | 'TODAY_23H' | 'NOW'>('STAGGER');
  const [resetFailedSpacing, setResetFailedSpacing] = useState<number>(900);

  // Xử lý chuyển toàn bộ bài lỗi về Chờ đăng (Hẹn giờ an toàn)
  const handleResetFailedBatch = async () => {
    setIsBulkProcessing(true);
    try {
      let payload: any = { ids: [] };
      if (resetFailedMode === 'TODAY_23H') {
        payload.targetDeadline = 'TODAY_23H';
      } else if (resetFailedMode === 'NOW') {
        payload.spacingSeconds = 15;
      } else {
        payload.spacingSeconds = resetFailedSpacing || 75;
      }
      const res = await api.post('/queue/reset-failed-batch', payload);
      const count = res.data?.count || 0;
      message.success(`✅ Đã chuyển thành công ${count} bài lỗi về trạng thái Chờ đăng (PENDING)! Lịch đã được phân bổ an toàn.`);
      setResetFailedModalVisible(false);
      queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Lỗi khi chuyển bài lỗi về Chờ đăng!');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // Xử lý Thử đăng lại TẤT CẢ các bài lỗi (tự động đưa vào hàng đợi với giãn cách an toàn)
  const handleRetryAllFailed = async () => {
    const failedPosts = (posts || []).filter((p) => p.status === 'FAILED');
    if (failedPosts.length === 0) {
      message.info('Không có bài viết nào bị lỗi để đăng lại!');
      return;
    }
    setIsBulkProcessing(true);
    try {
      const res = await api.post('/queue/reset-failed-batch', { spacingSeconds: 45 });
      message.success(`🚀 Đã chuyển ${res.data?.count || failedPosts.length} bài lỗi sang Chờ đăng! Hệ thống đang tự động xuất bản lần lượt.`);
      queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Lỗi khi đăng lại bài lỗi!');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // Xử lý Xóa TẤT CẢ các bài lỗi vĩnh viễn
  const handleDeleteAllFailed = async () => {
    const failedPosts = (posts || []).filter((p) => p.status === 'FAILED');
    if (failedPosts.length === 0) {
      message.info('Không có bài viết lỗi nào để xóa!');
      return;
    }
    setIsBulkProcessing(true);
    let count = 0;
    for (const p of failedPosts) {
      try {
        await api.delete(`/queue/${p.id}`);
        count++;
      } catch {
        // Ignore
      }
    }
    setIsBulkProcessing(false);
    message.success(`🗑️ Đã xóa vĩnh viễn ${count} bài viết bị lỗi khỏi CSDL!`);
    queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
  };

  return {
    resetFailedModalVisible,
    setResetFailedModalVisible,
    resetFailedMode,
    setResetFailedMode,
    resetFailedSpacing,
    setResetFailedSpacing,
    handleResetFailedBatch,
    handleRetryAllFailed,
    handleDeleteAllFailed,
  };
}
