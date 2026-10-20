import { useState, useMemo } from 'react';
import {
  Button,
  Card,
  Typography,
  Tag,
  Space,
  Modal,
  Form,
  Input,
  App,
  Row,
  Col,
  Select,
  Table,
  Segmented,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  TeamOutlined,
  EditOutlined,
  LinkOutlined,
  SearchOutlined,
  SyncOutlined,
  BarsOutlined,
  AppstoreOutlined,
  ExportOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../config/axios';

const { Title, Text } = Typography;
const { TextArea } = Input;

interface SocialAccount {
  id: number;
  platform: string;
  platformAccountId: string;
  pageName?: string;
  groupHealthStatus?: 'JOINED' | 'PENDING_APPROVAL' | 'KICKED_OR_NOT_JOINED' | 'PRIVATE_NO_ACCESS' | 'UNKNOWN';
  groupHealthCheckedAt?: string;
  fallbackGroupId?: number;
}

const GroupHealthBadge = ({ status }: { status?: string }) => {
  if (status === 'JOINED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/40 text-emerald-400 border border-emerald-800/40">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Đã gia nhập
      </span>
    );
  }
  if (status === 'PENDING_APPROVAL') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-950/40 text-amber-400 border border-amber-800/40">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        Chờ duyệt
      </span>
    );
  }
  if (status === 'KICKED_OR_NOT_JOINED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-950/40 text-red-400 border border-red-800/40">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        Bị Kick / Chưa vào
      </span>
    );
  }
  if (status === 'PRIVATE_NO_ACCESS') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-950/40 text-rose-400 border border-rose-800/40">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
        Riêng tư / Khóa
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800/60 text-slate-400 border border-slate-700/50">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
      Chưa scan
    </span>
  );
};

const getGroupUrl = (platformAccountId?: string) => {
  if (!platformAccountId) return null;
  const trimmed = platformAccountId.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://www.facebook.com/groups/${trimmed}`;
};

const Groups = () => {
  const { message } = App.useApp();
  const [isBulkModalVisible, setIsBulkModalVisible] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SocialAccount | null>(null);
  const [scanningGroupId, setScanningGroupId] = useState<number | null>(null);
  const [isScanningAll, setIsScanningAll] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  const [bulkForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const queryClient = useQueryClient();

  // Fetch danh sách kết nối, lọc Group Facebook
  const { data: accounts, isLoading } = useQuery({
    queryKey: ['socialAccounts'],
    queryFn: async () => {
      const response = await api.get('/connections');
      return response.data as SocialAccount[];
    },
  });

  const groups = useMemo(() => (accounts || []).filter((a) => a.platform === 'FACEBOOK_GROUP'), [accounts]);

  const groupOptions = useMemo(() => {
    return groups.map((g) => ({
      value: g.id,
      label: g.pageName || g.platformAccountId,
    }));
  }, [groups]);

  // Lọc client-side
  const filteredGroups = useMemo(() => {
    return groups.filter((g) => {
      if (statusFilter !== 'ALL' && (g.groupHealthStatus || 'UNKNOWN') !== statusFilter) return false;
      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase();
        const matchName = (g.pageName || '').toLowerCase().includes(q);
        const matchId = (g.platformAccountId || '').toLowerCase().includes(q);
        if (!matchName && !matchId) return false;
      }
      return true;
    });
  }, [groups, searchText, statusFilter]);

  // Scan sức khỏe 1 Group
  const scanHealthMutation = useMutation({
    mutationFn: async (id: number) => {
      setScanningGroupId(id);
      const res = await api.post(`/connections/${id}/check-group-health`);
      return res.data;
    },
    onSuccess: (data) => {
      setScanningGroupId(null);
      if (data.success) {
        message.success(`Kiểm tra sức khỏe Group thành công: ${data.message || 'Hợp lệ'}`);
      } else {
        message.error(`Lỗi scan: ${data.error}`);
      }
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    },
    onError: () => {
      setScanningGroupId(null);
      message.error('Lỗi khi kiểm tra sức khỏe Group!');
    },
  });

  // Scan sức khỏe tất cả Group
  const scanAllHealthMutation = useMutation({
    mutationFn: async () => {
      setIsScanningAll(true);
      const res = await api.post('/connections/check-all-groups-health');
      return res.data;
    },
    onSuccess: () => {
      setIsScanningAll(false);
      message.success('Đã hoàn tất kiểm tra sức khỏe toàn bộ Group Facebook!');
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    },
    onError: () => {
      setIsScanningAll(false);
      message.error('Lỗi khi scan sức khỏe các Group!');
    },
  });

  // Cập nhật Group dự phòng
  const updateFallbackGroupMutation = useMutation({
    mutationFn: async ({ id, fallbackGroupId }: { id: number; fallbackGroupId: number | null }) => {
      const response = await api.put(`/connections/${id}`, { fallbackGroupId: fallbackGroupId ?? 0 });
      return response.data;
    },
    onSuccess: () => {
      message.success('Đã cập nhật Group dự phòng!');
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    },
    onError: () => {
      message.error('Lỗi khi cập nhật Group dự phòng!');
    },
  });

  // Khai báo hàng loạt
  const bulkAddMutation = useMutation({
    mutationFn: async (names: string[]) => {
      const results = await Promise.allSettled(
        names.map((name) => api.post('/connections', { platform: 'FACEBOOK_GROUP', pageName: name }))
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      return { total: names.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      if (failed > 0) {
        message.warning(`Đã khai báo ${total - failed}/${total} group. ${failed} group lỗi.`);
      } else {
        message.success(`Đã khai báo thành công ${total} group!`);
      }
      setIsBulkModalVisible(false);
      bulkForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    },
    onError: () => {
      message.error('Có lỗi xảy ra khi khai báo group!');
    },
  });

  // Sửa group
  const updateGroupMutation = useMutation({
    mutationFn: async ({ id, pageName, platformAccountId }: { id: number; pageName: string; platformAccountId?: string }) => {
      const response = await api.put(`/connections/${id}`, { pageName, platformAccountId: platformAccountId || undefined });
      return response.data;
    },
    onSuccess: () => {
      message.success('Đã cập nhật Group thành công!');
      setEditingGroup(null);
      editForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    },
    onError: () => {
      message.error('Lỗi khi cập nhật Group!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/connections/${id}`);
    },
    onSuccess: () => {
      message.success('Đã xóa Group!');
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    },
  });

  const openEditModal = (record: SocialAccount) => {
    setEditingGroup(record);
    editForm.setFieldsValue({ pageName: record.pageName || '', platformAccountId: record.platformAccountId || '' });
  };

  const columns = [
    {
      title: 'Tên Group Facebook',
      key: 'name',
      render: (_: any, record: SocialAccount) => {
        const url = getGroupUrl(record.platformAccountId);
        return (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0">
              <TeamOutlined />
            </div>
            <div className="min-w-0 max-w-[280px]">
              <div className="font-semibold text-slate-100 text-sm truncate flex items-center gap-1.5">
                <span>{record.pageName || 'Chưa đặt tên'}</span>
                {url && (
                  <a href={url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-blue-400 text-xs">
                    <ExportOutlined />
                  </a>
                )}
              </div>
              <div className="text-[11px] font-mono text-slate-400">
                {record.platformAccountId ? `ID: ${record.platformAccountId}` : 'Chưa có ID'}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      title: 'Sức khỏe & Trạng thái',
      key: 'status',
      width: 170,
      render: (_: any, record: SocialAccount) => <GroupHealthBadge status={record.groupHealthStatus} />,
    },
    {
      title: 'Group dự phòng (Fallback)',
      key: 'fallback',
      width: 220,
      render: (_: any, record: SocialAccount) => (
        <Select
          size="small"
          allowClear
          placeholder="Chọn group dự phòng..."
          value={record.fallbackGroupId || undefined}
          onChange={(val) => updateFallbackGroupMutation.mutate({ id: record.id, fallbackGroupId: val ?? null })}
          options={groupOptions.filter((o) => o.value !== record.id)}
          className="w-full text-xs"
        />
      ),
    },
    {
      title: 'Thao tác',
      key: 'action',
      width: 160,
      render: (_: any, record: SocialAccount) => (
        <Space size="small">
          <Button
            size="small"
            type="link"
            loading={scanningGroupId === record.id}
            onClick={() => scanHealthMutation.mutate(record.id)}
            className="text-xs text-blue-400 hover:text-blue-300 p-0 font-medium"
          >
            Quét sức khỏe
          </Button>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
            className="text-slate-400 hover:text-purple-400 hover:bg-slate-800 rounded-md"
          />
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => {
              Modal.confirm({
                title: 'Xóa Group',
                content: `Bạn có chắc muốn xóa "${record.pageName}"?`,
                okText: 'Xóa',
                okType: 'danger',
                cancelText: 'Hủy',
                onOk: () => deleteMutation.mutate(record.id),
              });
            }}
            className="text-slate-500 hover:text-red-400 hover:bg-red-950/40 rounded-md"
          />
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Title level={4} className="!mb-0.5 !text-slate-100 flex items-center gap-2">
            <TeamOutlined className="text-blue-500" /> Quản lý nhóm Facebook
          </Title>
          <Text className="text-xs text-slate-400">
            Lưu danh sách Group dùng để chia sẻ bài viết tự động & kiểm tra tình trạng truy cập
          </Text>
        </div>
        <div className="flex items-center gap-2.5">
          <Button
            icon={<SyncOutlined spin={isScanningAll} />}
            loading={isScanningAll}
            onClick={() => scanAllHealthMutation.mutate()}
            className="font-medium h-10 px-4 rounded-lg bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
          >
            Quét sức khỏe tất cả Group
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsBulkModalVisible(true)}
            className="font-semibold h-10 px-5 rounded-lg bg-blue-600 hover:bg-blue-500"
          >
            Thêm nhóm
          </Button>
        </div>
      </div>

      {/* Toolbar: Search, Filters & View Toggle */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800/80">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <Input
            prefix={<SearchOutlined className="text-slate-500" />}
            placeholder="Tìm theo tên Group hoặc ID..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="max-w-[260px] rounded-lg bg-slate-800/80 border-slate-700 text-xs"
            allowClear
          />

          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            className="w-40 text-xs"
            options={[
              { value: 'ALL', label: 'Tất cả trạng thái' },
              { value: 'JOINED', label: 'Đã gia nhập' },
              { value: 'PENDING_APPROVAL', label: 'Chờ duyệt' },
              { value: 'KICKED_OR_NOT_JOINED', label: 'Bị Kick / Chưa vào' },
              { value: 'UNKNOWN', label: 'Chưa scan' },
            ]}
          />

          <span className="text-xs text-slate-500 font-medium ml-1">
            Hiển thị {filteredGroups.length}/{groups.length} nhóm
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Segmented
            value={viewMode}
            onChange={(val) => setViewMode(val as 'table' | 'cards')}
            options={[
              { value: 'table', icon: <BarsOutlined />, label: 'Bảng' },
              { value: 'cards', icon: <AppstoreOutlined />, label: 'Lưới thẻ' },
            ]}
            className="bg-slate-800 border border-slate-700 text-xs"
          />
        </div>
      </div>

      {/* Content View */}
      {viewMode === 'table' ? (
        <Card variant="borderless" className="app-surface shadow-sm rounded-xl border border-slate-800/80 overflow-hidden p-0">
          <Table
            columns={columns}
            dataSource={filteredGroups}
            rowKey="id"
            loading={isLoading}
            locale={{ emptyText: 'Chưa có Group Facebook nào phù hợp.' }}
            pagination={{ pageSize: 12, showSizeChanger: true }}
            scroll={{ x: 800 }}
          />
        </Card>
      ) : (
        <div>
          {filteredGroups.length === 0 ? (
            <Card variant="borderless" className="app-surface rounded-xl border border-slate-800 text-center py-8">
              <span className="text-slate-400 text-xs">Chưa có Group nào được khai báo</span>
            </Card>
          ) : (
            <Row gutter={[14, 14]}>
              {filteredGroups.map((g) => {
                const url = getGroupUrl(g.platformAccountId);
                return (
                  <Col xs={24} sm={12} lg={8} key={g.id}>
                    <div className="rounded-xl border border-slate-800/90 bg-slate-900/60 p-4 transition-all hover:border-slate-700 flex flex-col justify-between h-full">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold">
                            <TeamOutlined />
                          </div>
                          <GroupHealthBadge status={g.groupHealthStatus} />
                        </div>

                        <div className="font-semibold text-slate-100 text-sm truncate mb-0.5">
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer" className="text-slate-100 hover:text-blue-400 inline-flex items-center gap-1">
                              <span className="truncate">{g.pageName || 'Chưa đặt tên'}</span>
                              <ExportOutlined className="text-xs text-slate-500" />
                            </a>
                          ) : (
                            <span>{g.pageName || 'Chưa đặt tên'}</span>
                          )}
                        </div>

                        <div className="text-xs text-slate-500 font-mono mb-3">
                          {g.platformAccountId ? `ID: ${g.platformAccountId}` : 'Chưa có ID'}
                        </div>

                        <div className="mb-3 bg-slate-800/40 p-2.5 rounded-lg border border-slate-800">
                          <span className="text-[11px] text-slate-400 block mb-1">Group dự phòng:</span>
                          <Select
                            size="small"
                            allowClear
                            placeholder="Chọn group dự phòng..."
                            className="w-full text-xs"
                            value={g.fallbackGroupId || undefined}
                            onChange={(val) => updateFallbackGroupMutation.mutate({ id: g.id, fallbackGroupId: val ?? null })}
                            options={groupOptions.filter((o) => o.value !== g.id)}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2.5 border-t border-slate-800/80">
                        <Button
                          type="link"
                          size="small"
                          loading={scanningGroupId === g.id}
                          onClick={() => scanHealthMutation.mutate(g.id)}
                          className="text-xs text-blue-400 hover:text-blue-300 p-0 font-medium"
                        >
                          Quét sức khỏe
                        </Button>

                        <Space size="small">
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => openEditModal(g)}
                            className="text-slate-400 hover:text-purple-400 hover:bg-slate-800 rounded-md"
                          />
                          <Button
                            type="text"
                            danger
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => {
                              Modal.confirm({
                                title: 'Xóa Group',
                                content: `Bạn có chắc muốn xóa "${g.pageName}"?`,
                                okText: 'Xóa',
                                okType: 'danger',
                                cancelText: 'Hủy',
                                onOk: () => deleteMutation.mutate(g.id),
                              });
                            }}
                            className="text-slate-500 hover:text-red-400 hover:bg-red-950/40 rounded-md"
                          />
                        </Space>
                      </div>
                    </div>
                  </Col>
                );
              })}
            </Row>
          )}
        </div>
      )}

      {/* Bulk Add Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-slate-100 pb-2 border-b border-slate-800">
            <TeamOutlined className="text-blue-500 text-lg" />
            <span className="font-semibold text-base">Khai Báo Nhiều Group Cùng Lúc</span>
          </div>
        }
        open={isBulkModalVisible}
        onCancel={() => setIsBulkModalVisible(false)}
        footer={null}
        width={520}
        centered
        className="dark-modal"
      >
        <Form
          form={bulkForm}
          layout="vertical"
          onFinish={(values) => {
            const names = (values.groupNames as string)
              .split('\n')
              .map((n) => n.trim())
              .filter((n) => n.length > 0);
            if (names.length === 0) {
              message.error('Vui lòng nhập ít nhất 1 tên Group!');
              return;
            }
            bulkAddMutation.mutate(names);
          }}
          className="mt-4"
        >
          <Form.Item
            name="groupNames"
            label={
              <div className="flex items-center justify-between gap-2 w-full">
                <span className="font-medium text-slate-300">Danh sách tên Group (mỗi dòng 1 group)</span>
                <Button
                  size="small"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text) bulkForm.setFieldValue('groupNames', text);
                    } catch {
                      // ignore
                    }
                  }}
                  className="text-xs"
                >
                  Dán
                </Button>
              </div>
            }
            rules={[{ required: true, message: 'Nhập ít nhất 1 tên Group!' }]}
            extra={
              <span className="text-xs text-slate-500">
                Mỗi tên phải khớp với tên group trên Facebook để hệ thống dò tìm khi chia sẻ bài.
              </span>
            }
          >
            <TextArea
              rows={8}
              placeholder={'Sài Gòn Ơi Ăn Gì\nKiến Thức Kỳ Quái Đã Được Tiếp Thu\nĐảo Mèo 1\n...'}
              className="rounded-lg font-mono text-xs"
            />
          </Form.Item>

          <div className="pt-3 flex justify-end gap-2.5 border-t border-slate-800">
            <Button onClick={() => setIsBulkModalVisible(false)} className="rounded-lg">
              Hủy
            </Button>
            <Button type="primary" htmlType="submit" loading={bulkAddMutation.isPending} className="bg-blue-600 font-semibold rounded-lg">
              Khai báo
            </Button>
          </div>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-slate-100 pb-2 border-b border-slate-800">
            <EditOutlined className="text-blue-500 text-lg" />
            <span className="font-semibold text-base">Sửa Group — {editingGroup?.pageName}</span>
          </div>
        }
        open={!!editingGroup}
        onCancel={() => {
          setEditingGroup(null);
          editForm.resetFields();
        }}
        footer={null}
        width={460}
        centered
        className="dark-modal"
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(values) => {
            if (!editingGroup) return;
            updateGroupMutation.mutate({
              id: editingGroup.id,
              pageName: values.pageName.trim(),
              platformAccountId: values.platformAccountId?.trim(),
            });
          }}
          className="mt-4 space-y-3"
        >
          <Form.Item
            name="pageName"
            label={<span className="font-medium text-slate-300">Tên Group Facebook</span>}
            rules={[{ required: true, message: 'Vui lòng nhập tên Group!' }]}
            extra={<span className="text-xs text-slate-500">Khớp với tên thật của Group trên Facebook.</span>}
          >
            <Input placeholder="Ví dụ: Đảo Mèo 1" className="rounded-lg" autoFocus />
          </Form.Item>

          <Form.Item name="platformAccountId" label={<span className="font-medium text-slate-300">ID Group Facebook (Tùy chọn)</span>}>
            <Input placeholder="Ví dụ: 100092837461928" className="rounded-lg font-mono" />
          </Form.Item>

          <div className="pt-3 flex justify-end gap-2.5 border-t border-slate-800">
            <Button
              onClick={() => {
                setEditingGroup(null);
                editForm.resetFields();
              }}
              className="rounded-lg"
            >
              Hủy
            </Button>
            <Button type="primary" htmlType="submit" loading={updateGroupMutation.isPending} className="bg-blue-600 font-semibold rounded-lg">
              Cập nhật
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default Groups;
