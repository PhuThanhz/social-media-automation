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
  Tooltip, Flex,
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
  CopyOutlined,
  ThunderboltOutlined,
  SafetyCertificateOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  UserAddOutlined,
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
      <span className="grp-health-ok">
        <span className="grp-health-dot-ok" />
        Đã gia nhập
      </span>
    );
  }
  if (status === 'PENDING_APPROVAL') {
    return (
      <span className="grp-health-warn">
        <span className="grp-health-dot-warn" />
        Chờ duyệt
      </span>
    );
  }
  if (status === 'KICKED_OR_NOT_JOINED') {
    return (
      <span className="grp-health-bad">
        <span className="grp-health-dot-bad" />
        Bị Kick / Chưa vào
      </span>
    );
  }
  if (status === 'PRIVATE_NO_ACCESS') {
    return (
      <span className="grp-health-lock">
        <span className="grp-health-dot-lock" />
        Riêng tư / Khóa
      </span>
    );
  }
  return (
    <span className="grp-health-none">
      <span className="grp-health-dot-none" />
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
  const { message, modal } = App.useApp();
  const [isBulkModalVisible, setIsBulkModalVisible] = useState(false);
  const [groupAddMode, setGroupAddMode] = useState<'structured' | 'bulk'>('structured');
  const [bulkInputText, setBulkInputText] = useState('');
  const [editingGroup, setEditingGroup] = useState<SocialAccount | null>(null);
  const [scanningGroupId, setScanningGroupId] = useState<number | null>(null);
  const [joiningGroupId, setJoiningGroupId] = useState<number | null>(null);
  const [isScanningAll, setIsScanningAll] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  const [bulkForm] = Form.useForm();
  const [structuredForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const queryClient = useQueryClient();

  const structuredPageName = Form.useWatch('pageName', structuredForm) || '';
  const structuredPlatformAccountId = Form.useWatch('platformAccountId', structuredForm) || '';

  // Parser hỗ trợ bóc tách từng dòng Group
  const parseGroupLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let pageName = trimmed;
    let platformAccountId: string | undefined = undefined;

    if (trimmed.includes('|') || trimmed.includes(' - ') || trimmed.includes('\t')) {
      const parts = trimmed.split(/[|\t]| - /).map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        pageName = parts[0];
        const second = parts[1];
        const urlM = second.match(/facebook\.com\/groups\/([a-zA-Z0-9._-]+)/i);
        platformAccountId = urlM ? urlM[1] : second.replace(/[^0-9]/g, '');
      }
    } else {
      const urlMatch = trimmed.match(/facebook\.com\/groups\/([a-zA-Z0-9._-]+)/i);
      if (urlMatch) {
        platformAccountId = urlMatch[1];
        pageName = `Nhóm ${platformAccountId}`;
      } else if (/^\d{6,30}$/.test(trimmed)) {
        platformAccountId = trimmed;
        pageName = `Nhóm ${trimmed}`;
      }
    }

    const isFull = Boolean(pageName && platformAccountId && !pageName.startsWith('Nhóm '));
    const hasIdOnly = Boolean(platformAccountId && pageName.startsWith('Nhóm '));
    const hasNameOnly = Boolean(!platformAccountId && pageName);

    return {
      pageName,
      platformAccountId,
      isFull,
      hasIdOnly,
      hasNameOnly,
    };
  };

  const parsedBulkList = useMemo(() => {
    if (!bulkInputText.trim()) return [];
    return bulkInputText
      .split('\n')
      .map(parseGroupLine)
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [bulkInputText]);

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

  // Tự động xin vào nhóm qua Playwright
  const joinGroupMutation = useMutation({
    mutationFn: async (id: number) => {
      setJoiningGroupId(id);
      const res = await api.post(`/connections/${id}/join-group`);
      return res.data;
    },
    onSuccess: (data) => {
      setJoiningGroupId(null);
      if (data.success) {
        message.success(data.message || 'Đã gửi yêu cầu tham gia nhóm thành công!');
      } else {
        message.warning(data.message || data.error || 'Chưa gửi được yêu cầu tham gia nhóm');
      }
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    },
    onError: (err: any) => {
      setJoiningGroupId(null);
      message.error(err?.response?.data?.error || err?.message || 'Lỗi khi gửi yêu cầu tham gia nhóm!');
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

  // Khai báo Group (hỗ trợ cả từng group phân tầng và danh sách hàng loạt)
  const addGroupsMutation = useMutation({
    mutationFn: async (items: Array<{ pageName: string; platformAccountId?: string; fallbackGroupId?: number }>) => {
      const payloadList = items.filter((it) => it.pageName && it.pageName.trim().length > 0);
      const results = await Promise.allSettled(
        payloadList.map((payload) =>
          api.post('/connections', {
            platform: 'FACEBOOK_GROUP',
            pageName: payload.pageName.trim(),
            platformAccountId: payload.platformAccountId?.trim() || undefined,
            fallbackGroupId: payload.fallbackGroupId || undefined,
            tokenStatus: 'OK',
          })
        )
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      return { total: payloadList.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      if (failed > 0) {
        message.warning(`Đã thêm ${total - failed}/${total} group. ${failed} group lỗi.`);
      } else {
        message.success(`Đã thêm thành công ${total} group!`);
      }
      setIsBulkModalVisible(false);
      bulkForm.resetFields();
      structuredForm.resetFields();
      setBulkInputText('');
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
      message.success('Đã xóa Group thành công!');
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Không thể xóa Group này! Vui lòng thử lại.');
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
          <Flex align="center" gap={10}>
            <div className="grp-avatar">
              <TeamOutlined />
            </div>
            <div className="grp-name-cell">
              <div className="grp-name">
                <span>{record.pageName || 'Chưa đặt tên'}</span>
                {url && (
                  <a href={url} target="_blank" rel="noreferrer" className="grp-open-link">
                    <ExportOutlined />
                  </a>
                )}
              </div>
              <div className="grp-id">
                {record.platformAccountId ? `ID: ${record.platformAccountId}` : 'Chưa có ID'}
              </div>
            </div>
          </Flex>
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
          className="grp-target-select"
        />
      ),
    },
    {
      title: 'Thao tác',
      key: 'action',
      width: 220,
      render: (_: any, record: SocialAccount) => (
        <Space size="small">
          <Button
            size="small"
            type="link"
            loading={scanningGroupId === record.id}
            onClick={() => scanHealthMutation.mutate(record.id)}
            className="grp-link-btn"
          >
            Quét sức khỏe
          </Button>
          {(record.groupHealthStatus === 'KICKED_OR_NOT_JOINED' || record.groupHealthStatus === 'UNKNOWN' || !record.groupHealthStatus) && (
            <Tooltip title="Tự động bấm Tham gia nhóm trên Facebook qua Playwright">
              <Button
                size="small"
                type="link"
                icon={<UserAddOutlined />}
                loading={joiningGroupId === record.id}
                onClick={() => joinGroupMutation.mutate(record.id)}
                className="grp-link-btn text-emerald-400 hover:text-emerald-300"
              >
                Xin vào nhóm
              </Button>
            </Tooltip>
          )}
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
            className="grp-edit-btn"
          />
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            loading={deleteMutation.isPending && deleteMutation.variables === record.id}
            onClick={() => {
              modal.confirm({
                title: 'Xóa Group',
                content: `Bạn có chắc muốn xóa "${record.pageName || record.platformAccountId}"?`,
                okText: 'Xóa',
                okType: 'danger',
                cancelText: 'Hủy',
                onOk: () => deleteMutation.mutate(record.id),
              });
            }}
            className="grp-delete-btn"
          />
        </Space>
      ),
    },
  ];

  return (
    <div className="grp-page">
      {/* Header Bar */}
      <Card variant="borderless" styles={{ body: { padding: '16px 20px' } }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Title level={4} className="!mb-1 !text-slate-100 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
                <TeamOutlined />
              </div>
              <span>Quản lý nhóm Facebook</span>
            </Title>
            <Text className="text-xs text-slate-300">
              Lưu danh sách Group dùng để chia sẻ bài viết tự động & kiểm tra tình trạng truy cập
            </Text>
          </div>
          <Flex align="center" gap={10}>
            <Button
              icon={<SyncOutlined spin={isScanningAll} />}
              loading={isScanningAll}
              onClick={() => scanAllHealthMutation.mutate()}
            >
              Quét sức khỏe tất cả Group
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setIsBulkModalVisible(true)}
            >
              Thêm nhóm
            </Button>
          </Flex>
        </div>
      </Card>

      {/* Toolbar: Search, Filters & View Toggle */}
      <div className="grp-toolbar">
        <Flex wrap align="center" gap={10} className="grp-toolbar-filters">
          <Input
            prefix={<SearchOutlined className="grp-search-ic" />}
            placeholder="Tìm theo tên Group hoặc ID..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="grp-search"
            allowClear
          />

          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            className="grp-filter-select"
            options={[
              { value: 'ALL', label: 'Tất cả trạng thái' },
              { value: 'JOINED', label: 'Đã gia nhập' },
              { value: 'PENDING_APPROVAL', label: 'Chờ duyệt' },
              { value: 'KICKED_OR_NOT_JOINED', label: 'Bị Kick / Chưa vào' },
              { value: 'UNKNOWN', label: 'Chưa scan' },
            ]}
          />

          <span className="grp-count">
            Hiển thị {filteredGroups.length}/{groups.length} nhóm
          </span>
        </Flex>

        <Flex align="center" gap={8}>
          <Segmented
            value={viewMode}
            onChange={(val) => setViewMode(val as 'table' | 'cards')}
            options={[
              { value: 'table', icon: <BarsOutlined />, label: 'Bảng' },
              { value: 'cards', icon: <AppstoreOutlined />, label: 'Lưới thẻ' },
            ]}
            className="grp-view-toggle"
          />
        </Flex>
      </div>

      {/* Content View */}
      {viewMode === 'table' ? (
        <Card variant="borderless" className="grp-table-wrap">
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
            <Card variant="borderless" className="grp-empty">
              <span className="grp-empty-text">Chưa có Group nào được khai báo</span>
            </Card>
          ) : (
            <Row gutter={[14, 14]}>
              {filteredGroups.map((g) => {
                const url = getGroupUrl(g.platformAccountId);
                return (
                  <Col xs={24} sm={12} lg={8} key={g.id}>
                    <div className="grp-card">
                      <div>
                        <Flex align="center" justify="space-between" className="grp-card-head">
                          <div className="grp-card-avatar">
                            <TeamOutlined />
                          </div>
                          <GroupHealthBadge status={g.groupHealthStatus} />
                        </Flex>

                        <div className="grp-card-name">
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer" className="grp-card-link">
                              <span className="grp-truncate">{g.pageName || 'Chưa đặt tên'}</span>
                              <ExportOutlined className="grp-card-link-ic" />
                            </a>
                          ) : (
                            <span>{g.pageName || 'Chưa đặt tên'}</span>
                          )}
                        </div>

                        <div className="grp-card-id">
                          {g.platformAccountId ? `ID: ${g.platformAccountId}` : 'Chưa có ID'}
                        </div>

                        <div className="grp-card-target">
                          <span className="grp-card-target-label">Group dự phòng:</span>
                          <Select
                            size="small"
                            allowClear
                            placeholder="Chọn group dự phòng..."
                            className="grp-target-select"
                            value={g.fallbackGroupId || undefined}
                            onChange={(val) => updateFallbackGroupMutation.mutate({ id: g.id, fallbackGroupId: val ?? null })}
                            options={groupOptions.filter((o) => o.value !== g.id)}
                          />
                        </div>
                      </div>

                      <Flex align="center" justify="space-between" className="grp-card-foot">
                        <Space size="small">
                          <Button
                            type="link"
                            size="small"
                            loading={scanningGroupId === g.id}
                            onClick={() => scanHealthMutation.mutate(g.id)}
                            className="grp-link-btn"
                          >
                            Quét sức khỏe
                          </Button>
                          {(g.groupHealthStatus === 'KICKED_OR_NOT_JOINED' || g.groupHealthStatus === 'UNKNOWN' || !g.groupHealthStatus) && (
                            <Tooltip title="Tự động bấm Tham gia nhóm qua Playwright">
                              <Button
                                type="link"
                                size="small"
                                icon={<UserAddOutlined />}
                                loading={joiningGroupId === g.id}
                                onClick={() => joinGroupMutation.mutate(g.id)}
                                className="grp-link-btn text-emerald-400 hover:text-emerald-300"
                              >
                                Xin vào nhóm
                              </Button>
                            </Tooltip>
                          )}
                        </Space>

                        <Space size="small">
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => openEditModal(g)}
                            className="grp-edit-btn"
                          />
                          <Button
                            type="text"
                            danger
                            size="small"
                            icon={<DeleteOutlined />}
                            loading={deleteMutation.isPending && deleteMutation.variables === g.id}
                            onClick={() => {
                              modal.confirm({
                                title: 'Xóa Group',
                                content: `Bạn có chắc muốn xóa "${g.pageName || g.platformAccountId}"?`,
                                okText: 'Xóa',
                                okType: 'danger',
                                cancelText: 'Hủy',
                                onOk: () => deleteMutation.mutate(g.id),
                              });
                            }}
                            className="grp-delete-btn"
                          />
                        </Space>
                      </Flex>
                    </div>
                  </Col>
                );
              })}
            </Row>
          )}
        </div>
      )}

      {/* Thêm / Khai Báo Group Modal */}
      <Modal
        title={
          <Flex align="center" gap={8} className="grp-modal-title">
            <TeamOutlined className="grp-modal-title-ic" />
            <span className="grp-modal-title-text">Thêm & Khai Báo Group Facebook</span>
          </Flex>
        }
        open={isBulkModalVisible}
        onCancel={() => {
          setIsBulkModalVisible(false);
          structuredForm.resetFields();
          setBulkInputText('');
        }}
        footer={null}
        width={620}
        centered
        className="dark-modal"
      >
        <div className="space-y-4 pt-1">
          {/* Segmented Switcher */}
          <div className="flex justify-center">
            <Segmented
              value={groupAddMode}
              onChange={(val) => setGroupAddMode(val as 'structured' | 'bulk')}
              options={[
                {
                  value: 'structured',
                  label: (
                    <Flex align="center" gap={6} className="px-2 py-1">
                      <SafetyCertificateOutlined className="text-blue-400" />
                      <span className="font-semibold text-xs">📋 Nhập Từng Ô Phân Tầng (Khuyên dùng)</span>
                    </Flex>
                  ),
                },
                {
                  value: 'bulk',
                  label: (
                    <Flex align="center" gap={6} className="px-2 py-1">
                      <ThunderboltOutlined className="text-amber-400" />
                      <span className="font-semibold text-xs">⚡ Dán Nhanh Hàng Loạt (Từ Excel)</span>
                    </Flex>
                  ),
                },
              ]}
              className="bg-slate-900 border border-slate-800 p-1 rounded-xl"
            />
          </div>

          {/* CHẾ ĐỘ 1: NHẬP TỪNG Ô PHÂN TẦNG */}
          {groupAddMode === 'structured' && (
            <Form
              form={structuredForm}
              layout="vertical"
              onFinish={(values) => {
                let platformAccountId = values.platformAccountId?.trim() || undefined;
                if (platformAccountId) {
                  const urlM = platformAccountId.match(/facebook\.com\/groups\/([a-zA-Z0-9._-]+)/i);
                  if (urlM) platformAccountId = urlM[1];
                }
                addGroupsMutation.mutate([
                  {
                    pageName: values.pageName.trim(),
                    platformAccountId,
                    fallbackGroupId: values.fallbackGroupId || undefined,
                  },
                ]);
              }}
              className="space-y-3.5"
            >
              {/* Tầng 1: Tên hiển thị */}
              <div className="p-3.5 rounded-2xl border border-blue-500/30 bg-blue-950/20 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-blue-300 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-blue-500/30 text-blue-200 flex items-center justify-center text-xs font-bold">1</span>
                    Tên Group Facebook
                  </span>
                  <Tag color="blue" className="!text-xs m-0 font-semibold">Bắt buộc</Tag>
                </div>
                <Form.Item
                  name="pageName"
                  rules={[{ required: true, message: 'Vui lòng nhập Tên Group!' }]}
                  className="!mb-0"
                >
                  <Input
                    placeholder="Ví dụ: Đảo Mèo 1, Sài Gòn Ơi Ăn Gì, Hội Nghiện Phim..."
                    className="rounded-xl bg-slate-900/90 border-slate-700/80"
                  />
                </Form.Item>
                <div className="text-xs text-slate-300">
                  💡 Tên hiển thị để bạn dễ dàng nhận biết khi chọn nơi đăng bài và xem báo cáo.
                </div>
              </div>

              {/* Tầng 2: Link hoặc ID Group */}
              <div className="p-3.5 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-emerald-300 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-500/30 text-emerald-200 flex items-center justify-center text-xs font-bold">2</span>
                    Đường Link hoặc ID số của Group
                  </span>
                  <Tag color="green" className="!text-xs m-0 font-semibold">Khuyên dùng (Để đạt 100% ĐỦ)</Tag>
                </div>
                <Form.Item name="platformAccountId" className="!mb-0">
                  <Input
                    placeholder="Ví dụ: https://www.facebook.com/groups/263510030791508 hoặc 263510030791508"
                    className="rounded-xl font-mono text-xs bg-slate-900/90 border-slate-700/80"
                  />
                </Form.Item>
                <div className="text-xs text-slate-300">
                  🎯 Giúp bot Playwright điều hướng trực tiếp vào đúng nhóm 100%, không bị nhầm lẫn giữa các nhóm trùng tên.
                </div>
              </div>

              {/* Tầng 3: Nhóm dự phòng */}
              <div className="p-3.5 rounded-2xl border border-slate-700/80 bg-slate-900/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-slate-200 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-slate-700 text-slate-200 flex items-center justify-center text-xs font-bold">3</span>
                    Nhóm Facebook dự phòng (Fallback)
                  </span>
                  <Tag className="!text-xs m-0">Tùy chọn</Tag>
                </div>
                <Form.Item name="fallbackGroupId" className="!mb-0">
                  <Select
                    placeholder="Chọn nhóm dự phòng (nếu nhóm chính bị lỗi/kick)..."
                    options={groupOptions}
                    allowClear
                    className="w-full rounded-xl"
                  />
                </Form.Item>
                <div className="text-xs text-slate-300">
                  🛡️ Khi đăng bài vào nhóm này mà bị kiểm duyệt hoặc bị kick, hệ thống sẽ tự động đổi bài sang nhóm dự phòng này.
                </div>
              </div>

              {/* Thước đo ĐỘ ĐẦY ĐỦ CỦA THÔNG TIN */}
              <div className={`p-3 rounded-xl border transition-all ${
                structuredPageName.trim() && structuredPlatformAccountId.trim()
                  ? 'border-emerald-500/40 bg-emerald-950/30'
                  : structuredPageName.trim()
                  ? 'border-amber-500/40 bg-amber-950/30'
                  : 'border-slate-800 bg-slate-900/40'
              }`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-slate-200">KIỂM TRA ĐỘ ĐẦY ĐỦ THÔNG SỐ:</span>
                  {structuredPageName.trim() && structuredPlatformAccountId.trim() ? (
                    <Tag color="success" className="font-semibold m-0">🟢 100% HOÀN HẢO (ĐÃ ĐỦ)</Tag>
                  ) : structuredPageName.trim() ? (
                    <Tag color="warning" className="font-semibold m-0">🟡 ĐỦ CƠ BẢN (NÊN THÊM LINK/ID)</Tag>
                  ) : (
                    <Tag color="default" className="m-0">⚪ CHƯA NHẬP THÔNG TIN</Tag>
                  )}
                </div>
                <div className="text-xs text-slate-200 leading-relaxed">
                  {structuredPageName.trim() && structuredPlatformAccountId.trim()
                    ? '🎉 Tuyệt vời! Bạn đã điền đủ cả Tên hiển thị và Link/ID nhóm. Bot Playwright sẽ vào thẳng nhóm chính xác 100%.'
                    : structuredPageName.trim()
                    ? '💡 Đã có tên nhóm để lên bài. Khuyên bạn nên dán thêm Link hoặc ID nhóm ở ô số 2 để bot vào chuẩn tuyệt đối.'
                    : '👉 Vui lòng nhập Tên Group ở ô số 1 để bắt đầu khai báo.'}
                </div>
              </div>

              <Flex justify="flex-end" gap={10} className="pt-3 border-t border-slate-800">
                <Button onClick={() => setIsBulkModalVisible(false)} className="rounded-xl">
                  Hủy
                </Button>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={addGroupsMutation.isPending}
                  className="bg-blue-600 font-semibold rounded-xl"
                >
                  Lưu Group
                </Button>
              </Flex>
            </Form>
          )}

          {/* CHẾ ĐỘ 2: DÁN NHANH HÀNG LOẠT */}
          {groupAddMode === 'bulk' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-slate-300">
                  Mỗi dòng 1 group. Hỗ trợ dạng: <b className="text-slate-100">Tên | Link hoặc ID</b>
                </span>
                <Space size="small">
                  <Button
                    size="small"
                    onClick={() => {
                      const sample = `Cinema Sài Gòn | https://www.facebook.com/groups/247792223017151\nKiến Thức Kỳ Quái Đã Được Tiếp Thu | 352102219461769\nhttps://www.facebook.com/groups/964362037266166\nĐảo Mèo 1`;
                      setBulkInputText(sample);
                    }}
                    className="!text-xs !h-7 px-2.5 text-slate-300"
                  >
                    Mẫu
                  </Button>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        if (text) setBulkInputText(text);
                      } catch {}
                    }}
                    className="!text-xs !h-7 px-2.5 text-blue-200 bg-blue-600/20 border-blue-500/40"
                  >
                    Dán từ Clipboard
                  </Button>
                </Space>
              </div>

              <Input.TextArea
                rows={6}
                value={bulkInputText}
                onChange={(e) => setBulkInputText(e.target.value)}
                placeholder={`Cinema Sài Gòn | https://www.facebook.com/groups/247792223017151\nKiến Thức Kỳ Quái | 352102219461769\nhttps://www.facebook.com/groups/964362037266166\nĐảo Mèo 1`}
                className="rounded-xl font-mono text-[13px] bg-slate-900/90 border-slate-700/80"
              />

              {/* Realtime Bảng Preview Bóc Tách */}
              {parsedBulkList.length > 0 && (
                <div className="rounded-xl border border-slate-700/80 bg-slate-900/80 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-800/60 border-b border-slate-700/80 flex items-center justify-between text-[13px]">
                    <span className="font-semibold text-slate-100">
                      👀 Xem trước kết quả bóc tách ({parsedBulkList.length} nhóm):
                    </span>
                    <Tag color="cyan" className="m-0 !text-xs">Tự động phân tầng</Tag>
                  </div>
                  <div className="max-h-48 overflow-y-auto p-2 space-y-1.5">
                    {parsedBulkList.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800 text-[13px]">
                        <div className="flex-1 min-w-0 pr-2">
                          <div className="font-medium text-slate-100 truncate">{item.pageName}</div>
                          <div className="text-xs font-mono text-slate-300 truncate">
                            {item.platformAccountId ? `ID/Link: ${item.platformAccountId}` : 'Chưa có ID (chỉ tìm theo tên)'}
                          </div>
                        </div>
                        <div>
                          {item.isFull ? (
                            <Tag color="success" className="m-0 !text-xs">✅ Đủ Tên & ID</Tag>
                          ) : item.hasIdOnly ? (
                            <Tag color="processing" className="m-0 !text-xs">⚠️ Đã có Link/ID</Tag>
                          ) : (
                            <Tag color="warning" className="m-0 !text-xs">⚠️ Chỉ có tên</Tag>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Flex justify="flex-end" gap={10} className="pt-3 border-t border-slate-800">
                <Button onClick={() => setIsBulkModalVisible(false)} className="rounded-xl">
                  Hủy
                </Button>
                <Button
                  type="primary"
                  disabled={parsedBulkList.length === 0}
                  loading={addGroupsMutation.isPending}
                  onClick={() => {
                    addGroupsMutation.mutate(
                      parsedBulkList.map((p) => ({
                        pageName: p.pageName,
                        platformAccountId: p.platformAccountId,
                      }))
                    );
                  }}
                  className="bg-blue-600 font-semibold rounded-xl"
                >
                  Khai báo {parsedBulkList.length > 0 ? `(${parsedBulkList.length} Group)` : ''}
                </Button>
              </Flex>
            </div>
          )}
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal
        title={
          <Flex align="center" gap={8} className="grp-modal-title">
            <EditOutlined className="grp-modal-title-ic" />
            <span className="grp-modal-title-text">Sửa Group — {editingGroup?.pageName}</span>
          </Flex>
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
          className="grp-edit-form"
        >
          <Form.Item
            name="pageName"
            label={<span className="grp-option-name">Tên Group Facebook</span>}
            rules={[{ required: true, message: 'Vui lòng nhập tên Group!' }]}
            extra={<span className="grp-hint">Khớp với tên thật của Group trên Facebook.</span>}
          >
            <Input placeholder="Ví dụ: Đảo Mèo 1" className="grp-rounded" autoFocus />
          </Form.Item>

          <Form.Item name="platformAccountId" label={<span className="grp-option-name">ID Group Facebook (Tùy chọn)</span>}>
            <Input placeholder="Ví dụ: 100092837461928" className="grp-mono-input-plain" />
          </Form.Item>

          <Flex justify="flex-end" gap={10} className="grp-form-actions">
            <Button
              onClick={() => {
                setEditingGroup(null);
                editForm.resetFields();
              }}
              className="grp-rounded"
            >
              Hủy
            </Button>
            <Button type="primary" htmlType="submit" loading={updateGroupMutation.isPending} className="grp-save-btn">
              Cập nhật
            </Button>
          </Flex>
        </Form>
      </Modal>
    </div>
  );
};

export default Groups;
