import { useState } from 'react';
import { useMutation, type QueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import api from '../../config/axios';

interface GroupMembershipParams {
  queryClient: QueryClient;
}

// Kiểm tra tư cách thành viên / sức khỏe nhóm và tự xin vào nhóm — tách từ PlaywrightPoster (state và hàm giữ nguyên, chỉ chuyển chỗ)
export function useGroupMembership({ queryClient }: GroupMembershipParams) {
  const { message } = App.useApp();
  // --- Group Membership Pre-flight Check State ---
  const [groupCheckModalVisible, setGroupCheckModalVisible] = useState<boolean>(false);
  const [groupCheckingMap, setGroupCheckingMap] = useState<Record<number, boolean>>({});
  const [groupJoiningMap, setGroupJoiningMap] = useState<Record<number, boolean>>({});

  // Mutation kiểm tra sức khỏe 1 group
  const checkSingleGroupMutation = useMutation({
    mutationFn: async (groupId: number) => {
      setGroupCheckingMap((prev) => ({ ...prev, [groupId]: true }));
      try {
        const res = await api.post(`/connections/${groupId}/check-group-health`);
        return res.data;
      } finally {
        setGroupCheckingMap((prev) => ({ ...prev, [groupId]: false }));
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
      if (data?.status === 'JOINED') {
        message.success('🟢 Nhóm hoạt động tốt! Bạn đã là thành viên.');
      } else if (data?.status === 'PENDING_APPROVAL') {
        message.warning('🟡 Đang chờ Admin duyệt thành viên.');
      } else {
        message.error(`🔴 Trạng thái: ${data?.message || 'Chưa tham gia nhóm'}`);
      }
    },
    onError: (err: any) => {
      message.error(`Lỗi kiểm tra nhóm: ${err?.response?.data?.error || err.message}`);
    }
  });

  // Mutation kiểm tra sức khỏe tất cả group
  const checkAllGroupsMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/connections/check-all-groups-health');
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
      message.success(`Đã quét xong sức khỏe của ${data?.length || 0} nhóm!`);
    },
    onError: (err: any) => {
      message.error(`Lỗi quét nhóm: ${err?.response?.data?.error || err.message}`);
    }
  });

  // Mutation tự động xin vào nhóm
  const joinGroupMutation = useMutation({
    mutationFn: async (groupId: number) => {
      setGroupJoiningMap((prev) => ({ ...prev, [groupId]: true }));
      try {
        const res = await api.post(`/connections/${groupId}/join-group`);
        return res.data;
      } finally {
        setGroupJoiningMap((prev) => ({ ...prev, [groupId]: false }));
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
      message.success(data?.message || 'Đã gửi yêu cầu tham gia nhóm!');
    },
    onError: (err: any) => {
      message.error(`Lỗi xin vào nhóm: ${err?.response?.data?.error || err.message}`);
    }
  });

  return {
    groupCheckModalVisible,
    setGroupCheckModalVisible,
    groupCheckingMap,
    groupJoiningMap,
    checkSingleGroupMutation,
    checkAllGroupsMutation,
    joinGroupMutation,
  };
}
