import { useState } from 'react';
import { App, Badge, Button, Dropdown, Form, Input, Modal, Table, Tag, Card, Col, Row, Statistic, Alert, Typography, Flex } from 'antd';
import { MoreOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../config/axios';

const { Title, Text } = Typography;

interface DesktopUser {
  id: number;
  login: string;
  displayName: string;
  role: 'OWNER' | 'MEMBER';
  disabled: boolean;
  createdAt: string;
}

interface Plan {
  personal?: boolean;
  client?: string;
  licenseExp?: number | null;
  maxUsers: number;
  usedUsers: number;
  maxAccounts: number;
  usedAccounts: number;
}

interface Me extends Omit<DesktopUser, 'createdAt'> {
  plan: Plan;
}

const errorMessage = (err: any) => err?.response?.data?.message || err?.message || 'Có lỗi xảy ra';

/** Bản Desktop: chủ tài khoản quản lý người dùng dùng chung máy, trong giới hạn gói bản quyền */
const DesktopUsers = () => {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [passwordFor, setPasswordFor] = useState<DesktopUser | null>(null);
  const [addForm] = Form.useForm();
  const [passwordForm] = Form.useForm();

  const { data: me } = useQuery({ queryKey: ['desktopMe'], queryFn: async () => (await api.get<Me>('/desktop/me')).data });
  const isOwner = me?.role === 'OWNER';
  const { data, isLoading } = useQuery({
    queryKey: ['desktopUsers'],
    queryFn: async () => (await api.get<{ users: DesktopUser[]; plan: Plan }>('/desktop/users')).data,
    enabled: isOwner,
  });
  const plan = data?.plan || me?.plan;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['desktopUsers'] });
    queryClient.invalidateQueries({ queryKey: ['desktopMe'] });
  };

  const mutate = useMutation({
    mutationFn: async (req: { method: 'post' | 'patch' | 'delete'; url: string; body?: unknown }) =>
      (await api.request({ method: req.method, url: req.url, data: req.body })).data,
    onSuccess: (res: any) => {
      if (res?.message) message.success(res.message);
      refresh();
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const atLimit = !!plan && plan.usedUsers >= plan.maxUsers;

  const columns = [
    {
      title: 'Người dùng',
      key: 'name',
      render: (_: unknown, u: DesktopUser) => (
        <div>
          <div className="font-medium text-slate-100">{u.displayName}</div>
          <div className="text-xs text-slate-500">{u.login}</div>
        </div>
      ),
    },
    {
      title: 'Vai trò',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => (role === 'OWNER' ? <Tag color="gold">Chủ</Tag> : <Tag>Thành viên</Tag>),
    },
    {
      title: 'Trạng thái',
      key: 'status',
      render: (_: unknown, u: DesktopUser) =>
        u.disabled ? <Badge status="default" text="Đã khóa" /> : <Badge status="success" text="Hoạt động" />,
    },
    {
      title: 'Ngày tạo',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => <span className="text-slate-400">{v ? new Date(v).toLocaleDateString('vi-VN') : ''}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 56,
      align: 'right' as const,
      render: (_: unknown, u: DesktopUser) => {
        const self = u.id === me?.id;
        const items = [
          { key: 'password', label: 'Đặt lại mật khẩu' },
          ...(!self ? [{ key: 'toggle', label: u.disabled ? 'Mở khóa' : 'Khóa' }] : []),
          ...(!self ? [{ key: 'delete', label: 'Xóa', danger: true }] : []),
        ];
        return (
          <Dropdown
            trigger={['click']}
            menu={{
              items,
              onClick: ({ key }) => {
                if (key === 'password') {
                  passwordForm.resetFields();
                  setPasswordFor(u);
                }
                if (key === 'toggle') mutate.mutate({ method: 'patch', url: `/desktop/users/${u.id}`, body: { disabled: !u.disabled } });
                if (key === 'delete') {
                  Modal.confirm({
                    title: `Xóa người dùng ${u.displayName}?`,
                    content: 'Chỉ xóa được người chưa có dữ liệu. Người đã có Via, Fanpage hay chiến dịch thì nên khóa.',
                    okText: 'Xóa',
                    okButtonProps: { danger: true },
                    cancelText: 'Hủy',
                    onOk: () => mutate.mutateAsync({ method: 'delete', url: `/desktop/users/${u.id}` }),
                  });
                }
              },
            }}
          >
            <Button type="text" icon={<MoreOutlined />} aria-label="Thao tác" />
          </Dropdown>
        );
      },
    },
  ];

  return (
    <div className="app-page space-y-4">
      <Card variant="borderless">
        <Flex justify="space-between" align="center" wrap="wrap" gap="middle">
          <Flex align="center" gap="middle">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 text-lg">
              <TeamOutlined />
            </div>
            <div>
              <Title level={4} className="!mb-0.5 !text-slate-100">Người dùng</Title>
              <Text className="text-xs text-slate-400">
                Mỗi người đăng nhập bằng tài khoản riêng trên máy này và có dữ liệu riêng (Via, Fanpage, lịch đăng).
              </Text>
            </div>
          </Flex>
          {isOwner && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={atLimit}
              title={atLimit ? 'Đã đủ số người dùng của gói' : undefined}
              onClick={() => {
                addForm.resetFields();
                setAddOpen(true);
              }}
              className="font-semibold rounded-xl"
            >
              Thêm người dùng
            </Button>
          )}
        </Flex>
      </Card>

      {plan && (
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={6}>
            <Card variant="borderless" size="small">
              <Statistic
                title={<span className="text-xs text-slate-400 font-medium">Bản quyền</span>}
                value={plan.client || '—'}
                valueStyle={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card variant="borderless" size="small">
              <Statistic
                title={<span className="text-xs text-slate-400 font-medium">Hạn sử dụng</span>}
                value={plan.licenseExp ? new Date(plan.licenseExp * 1000).toLocaleDateString('vi-VN') : 'Vĩnh viễn'}
                valueStyle={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card variant="borderless" size="small">
              <Statistic
                title={<span className="text-xs text-slate-400 font-medium">Người dùng</span>}
                value={plan.personal ? `${plan.usedUsers} / Không giới hạn` : `${plan.usedUsers} / ${plan.maxUsers}`}
                valueStyle={{ fontSize: 16, fontWeight: 700, color: atLimit ? '#f59e0b' : '#39d497' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card variant="borderless" size="small">
              <Statistic
                title={<span className="text-xs text-slate-400 font-medium">Tài khoản (Via, Fanpage…)</span>}
                value={plan.personal ? `${plan.usedAccounts} / Không giới hạn` : `${plan.usedAccounts} / ${plan.maxAccounts}`}
                valueStyle={{ fontSize: 16, fontWeight: 700, color: plan.usedAccounts >= plan.maxAccounts ? '#f59e0b' : '#39d497' }}
              />
            </Card>
          </Col>
        </Row>
      )}

      {isOwner ? (
        <Card variant="borderless">
          <Table<DesktopUser> rowKey="id" columns={columns} dataSource={data?.users || []} loading={isLoading} pagination={false} />
          {atLimit && (
            <Alert
              type="warning"
              showIcon
              message="Đã đủ số người dùng của gói"
              description="Khóa bớt người không dùng, hoặc liên hệ admin để nâng gói."
              className="mt-4 rounded-xl"
            />
          )}
        </Card>
      ) : (
        me && (
          <Card variant="borderless">
            <div className="py-8 text-center text-slate-400 text-sm">Chỉ chủ tài khoản mới quản lý được người dùng.</div>
          </Card>
        )
      )}

      <Modal
        title="Thêm người dùng"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        okText="Thêm"
        cancelText="Hủy"
        confirmLoading={mutate.isPending}
        onOk={async () => {
          const v = await addForm.validateFields();
          await mutate.mutateAsync({ method: 'post', url: '/desktop/users', body: v });
          setAddOpen(false);
        }}
        forceRender
      >
        <Form form={addForm} layout="vertical" requiredMark={false}>
          <Form.Item name="displayName" label="Tên hiển thị">
            <Input placeholder="VD: Nhân viên ca tối" />
          </Form.Item>
          <Form.Item
            name="login"
            label="Tên đăng nhập"
            rules={[{ required: true, pattern: /^[a-z0-9._-]{3,50}$/, message: '3-50 ký tự: chữ thường, số, . _ -' }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label="Mật khẩu" rules={[{ required: true, min: 6, message: 'Tối thiểu 6 ký tự' }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Đặt lại mật khẩu: ${passwordFor?.displayName || ''}`}
        open={!!passwordFor}
        onCancel={() => setPasswordFor(null)}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={mutate.isPending}
        onOk={async () => {
          const v = await passwordForm.validateFields();
          await mutate.mutateAsync({ method: 'patch', url: `/desktop/users/${passwordFor!.id}`, body: { password: v.password } });
          setPasswordFor(null);
        }}
        forceRender
      >
        <Form form={passwordForm} layout="vertical" requiredMark={false}>
          <Form.Item name="password" label="Mật khẩu mới" rules={[{ required: true, min: 6, message: 'Tối thiểu 6 ký tự' }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default DesktopUsers;
