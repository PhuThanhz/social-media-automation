import { memo } from 'react';
import type React from 'react';
import {
  Button,
  Select,
  Tag,
  Table,
  Space,
  Modal,
  Alert,
} from 'antd';
import { ClockCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, StopOutlined, TeamOutlined, SyncOutlined } from '@ant-design/icons';
import type { UseMutationResult } from '@tanstack/react-query';
import { stripEmojiPrefix } from './shared';
import type { SocialAccount } from './types';

interface GroupCheckModalProps {
  kpiFanpageAccounts: SocialAccount[];
  groupIdentityMap: Map<number, SocialAccount>;
  setGroupIdentityMutation: UseMutationResult<any, any, { groupId: number; fanpageConnectionId: number; }, unknown>;
  groupAccountsWithId: SocialAccount[];
  groupCheckModalVisible: boolean;
  setGroupCheckModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
  groupCheckingMap: Record<number, boolean>;
  groupJoiningMap: Record<number, boolean>;
  checkSingleGroupMutation: UseMutationResult<any, any, number, unknown>;
  checkAllGroupsMutation: UseMutationResult<any, any, void, unknown>;
  joinGroupMutation: UseMutationResult<any, any, number, unknown>;
}

// Kiểm tra tư cách thành viên & sức khỏe nhóm — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
function GroupCheckModal({
  kpiFanpageAccounts,
  groupIdentityMap,
  setGroupIdentityMutation,
  groupAccountsWithId,
  groupCheckModalVisible,
  setGroupCheckModalVisible,
  groupCheckingMap,
  groupJoiningMap,
  checkSingleGroupMutation,
  checkAllGroupsMutation,
  joinGroupMutation,
}: GroupCheckModalProps) {
  return (
    <Modal
      title={
        <div className="flex items-center gap-2">
          <TeamOutlined className="text-blue-500 text-lg" />
          <span className="font-bold">Kiểm Tra Tư Cách Thành Viên & Sức Khỏe Nhóm Facebook</span>
        </div>
      }
      open={groupCheckModalVisible}
      onCancel={() => setGroupCheckModalVisible(false)}
      width={750}
      footer={[
        <Button key="close" onClick={() => setGroupCheckModalVisible(false)}>
          Đóng
        </Button>,
        <Button
          key="scanAll"
          icon={<SyncOutlined spin={checkAllGroupsMutation.isPending} />}
          loading={checkAllGroupsMutation.isPending}
          onClick={() => checkAllGroupsMutation.mutate()}
          type="primary"
          className="!bg-blue-600 font-bold"
        >
          Quét tất cả nhóm
        </Button>,
      ]}
    >
      <div className="py-2 space-y-4">
        <Alert
          type="info"
          showIcon
          message="Điều kiện đăng bài vào Group Facebook"
          description="Để đăng bài vào Group tự động không bị lỗi, Fanpage hoặc Nick cá nhân của bạn bắt buộc phải là Thành viên của Group đó và có quyền đăng bài (ô tạo bài viết sẵn sàng)."
          className="rounded-xl mb-3"
        />

        <Table
          dataSource={groupAccountsWithId}
          rowKey="id"
          pagination={false}
          size="small"
          columns={[
            {
              title: 'Tên Nhóm Facebook',
              key: 'name',
              render: (_, g) => (
                <div>
                  <div className="font-semibold text-slate-200">{stripEmojiPrefix(g.pageName)}</div>
                  <div className="text-xs text-slate-400">ID: {g.platformAccountId}</div>
                </div>
              ),
            },
            {
              title: 'Trạng thái Thành viên',
              key: 'status',
              render: (_, g) => {
                const status = g.groupHealthStatus;
                if (status === 'JOINED') {
                  return <Tag color="success" icon={<CheckCircleOutlined />} className="!rounded-full font-bold">Đã vào nhóm</Tag>;
                }
                if (status === 'PENDING_APPROVAL') {
                  return <Tag color="warning" icon={<ClockCircleOutlined />} className="!rounded-full font-bold">Chờ duyệt</Tag>;
                }
                if (status === 'KICKED_OR_NOT_JOINED') {
                  return <Tag color="error" icon={<CloseCircleOutlined />} className="!rounded-full font-bold">Chưa tham gia</Tag>;
                }
                if (status === 'PRIVATE_NO_ACCESS') {
                  return <Tag color="default" icon={<StopOutlined />} className="!rounded-full font-bold">Kín / Bị chặn</Tag>;
                }
                return <Tag color="default" className="!rounded-full font-bold">Chưa kiểm tra</Tag>;
              },
            },
            {
              title: 'Kiểm tra dưới danh nghĩa',
              key: 'identity',
              render: (_, g) => {
                const identity = groupIdentityMap.get(g.id);
                return (
                  <Select
                    size="small"
                    placeholder="Chọn Trang/Nick"
                    value={identity?.id ?? undefined}
                    onChange={(val) => setGroupIdentityMutation.mutate({ groupId: g.id, fanpageConnectionId: val ?? null })}
                    allowClear
                    loading={setGroupIdentityMutation.isPending}
                    className="w-36"
                    options={kpiFanpageAccounts.map((fp) => ({ value: fp.id, label: fp.pageName || `#${fp.id}` }))}
                  />
                );
              },
            },
            {
              title: 'Thao tác',
              key: 'action',
              render: (_, g) => {
                const isChecking = groupCheckingMap[g.id];
                const isJoining = groupJoiningMap[g.id];
                return (
                  <Space size="small">
                    <Button
                      size="small"
                      icon={<SyncOutlined spin={isChecking} />}
                      loading={isChecking}
                      onClick={() => checkSingleGroupMutation.mutate(g.id)}
                    >
                      Kiểm tra
                    </Button>
                    {g.groupHealthStatus !== 'JOINED' && (
                      <Button
                        size="small"
                        type="primary"
                        className="!bg-emerald-600 font-bold"
                        icon={<TeamOutlined />}
                        loading={isJoining}
                        onClick={() => joinGroupMutation.mutate(g.id)}
                      >
                        Xin vào nhóm
                      </Button>
                    )}
                  </Space>
                );
              },
            },
          ]}
        />
      </div>
    </Modal>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(GroupCheckModal, (prev, next) => !prev.groupCheckModalVisible && !next.groupCheckModalVisible);
