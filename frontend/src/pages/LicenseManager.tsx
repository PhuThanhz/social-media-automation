import React, { useState, useEffect } from 'react';
import {
  Card, Table, Button, Input, Modal, Form, Tag, Statistic, Row, Col,
  Space, message, Tooltip, Typography, Badge, Tabs, Popconfirm, Select
} from 'antd';
import {
  SafetyCertificateOutlined, KeyOutlined, LockOutlined, UnlockOutlined,
  ReloadOutlined, DeleteOutlined, CopyOutlined, LaptopOutlined,
  PlusOutlined, SearchOutlined, CheckCircleOutlined, StopOutlined,
  GlobalOutlined, ThunderboltOutlined
} from '@ant-design/icons';
import axios from 'axios';
import { licenseService } from '../services/license.service';

const { Title, Text } = Typography;

interface LicenseItem {
  id: number;
  license_key: string;
  client_name: string;
  hwid: string | null;
  status: 'ACTIVE' | 'LOCKED' | 'EXPIRED';
  duration_days: number;
  max_accounts: number;
  notes: string | null;
  created_at: string;
  expires_at: string | null;
  last_ping_at: string | null;
  last_ip: string | null;
  client_os?: string | null;
  app_version?: string | null;
}

const OS_LABEL: Record<string, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

// Lựa chọn gia hạn: số ngày, hoặc 'lifetime'
const EXTEND_OPTIONS = [
  { value: 30, label: '+1 Tháng' },
  { value: 90, label: '+3 Tháng' },
  { value: 180, label: '+6 Tháng' },
  { value: 365, label: '+1 Năm' },
  { value: 'lifetime', label: 'Vĩnh Viễn' },
] as const;
type ExtendChoice = number | 'lifetime';

interface AuditLog {
  id: number;
  license_key: string;
  action: string;
  hwid: string;
  ip: string;
  timestamp: string;
  details: string;
}

const LICENSE_SERVER_URL = import.meta.env.VITE_LICENSE_SERVER_URL || 'http://localhost:5050';
// Admin secret nhập lúc dùng, không bao giờ nhúng vào bundle
const SECRET_STORAGE_KEY = 'zutter_admin_secret';

const LicenseManager: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [licenses, setLicenses] = useState<LicenseItem[]>([]);
  const [stats, setStats] = useState({ total: 0, active: 0, locked: 0, onlineNow: 0 });
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  
  // Modal tạo key
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [creating, setCreating] = useState(false);

  // Thông tin máy tính hiện tại
  const [myHWID, setMyHWID] = useState<string>('');

  // Quyền Admin Gate (server kiểm tra secret, client chỉ giữ trong phiên)
  const [adminSecret, setAdminSecret] = useState<string>(() => sessionStorage.getItem(SECRET_STORAGE_KEY) || '');
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(() => !!sessionStorage.getItem(SECRET_STORAGE_KEY));
  const [adminPasswordInput, setAdminPasswordInput] = useState('');

  useEffect(() => {
    localStorage.removeItem(SECRET_STORAGE_KEY); // dọn secret cũ từng lưu vĩnh viễn
    loadMyDevice();
  }, []);

  useEffect(() => {
    if (!isAdminUnlocked) return;
    fetchLicenses();
    fetchLogs();
    const interval = setInterval(() => {
      fetchLicenses(false);
      fetchLogs();
    }, 15000);
    return () => clearInterval(interval);
  }, [isAdminUnlocked, adminSecret]);

  const loadMyDevice = async () => {
    const hwid = await licenseService.getHWID();
    setMyHWID(hwid);
  };

  const fetchLicenses = async (showSpin = true) => {
    if (showSpin) setLoading(true);
    try {
      const res = await axios.get(`${LICENSE_SERVER_URL}/api/admin/licenses`, {
        headers: { 'x-admin-secret': adminSecret },
      });
      if (res.data?.success) {
        setLicenses(res.data.licenses || []);
        if (res.data.stats) {
          setStats(res.data.stats);
        }
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        sessionStorage.removeItem(SECRET_STORAGE_KEY);
        setIsAdminUnlocked(false);
      }
      console.warn('Lỗi tải danh sách bản quyền:', err.message);
    } finally {
      if (showSpin) setLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await axios.get(`${LICENSE_SERVER_URL}/api/admin/logs`, {
        headers: { 'x-admin-secret': adminSecret },
      });
      if (res.data?.success) {
        setLogs(res.data.logs || []);
      }
    } catch {}
  };

  // Tạo key mới
  const handleCreateLicense = async (values: any) => {
    setCreating(true);
    try {
      const res = await axios.post(`${LICENSE_SERVER_URL}/api/admin/licenses/create`, values, {
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': adminSecret,
        },
      });
      if (res.data?.success) {
        message.success(`🎉 Đã tạo key thành công: ${res.data.licenseKey}`);
        navigator.clipboard.writeText(res.data.licenseKey);
        message.info('Đã tự động copy mã key vào bộ nhớ tạm để gửi cho khách!');
        setCreateModalOpen(false);
        createForm.resetFields();
        fetchLicenses(false);
        fetchLogs();
      } else {
        message.error(res.data?.message || 'Lỗi khi tạo key');
      }
    } catch (err: any) {
      message.error(err.response?.data?.message || 'Không thể kết nối License Server');
    } finally {
      setCreating(false);
    }
  };

  // Nút Khóa tức thì (Remote Kill-Switch)
  const handleToggleLock = async (record: LicenseItem) => {
    try {
      const res = await axios.post(`${LICENSE_SERVER_URL}/api/admin/licenses/${record.id}/toggle`, {}, {
        headers: { 'x-admin-secret': adminSecret },
      });
      if (res.data?.success) {
        message.success(res.data.message);
        fetchLicenses(false);
        fetchLogs();
      }
    } catch (err: any) {
      message.error(err.response?.data?.message || 'Lỗi thao tác khóa');
    }
  };

  // Gia hạn: cộng thêm từ hạn hiện tại (hết hạn rồi thì tính từ hôm nay)
  const [extendTarget, setExtendTarget] = useState<LicenseItem | null>(null);
  const [extendChoice, setExtendChoice] = useState<ExtendChoice>(30);
  const [extending, setExtending] = useState(false);

  const extendPreview = (item: LicenseItem, choice: ExtendChoice) => {
    if (choice === 'lifetime') return 'Vĩnh viễn';
    const base = Math.max(Date.now(), item.expires_at ? new Date(item.expires_at).getTime() : Date.now());
    return new Date(base + choice * 86_400_000).toLocaleDateString('vi-VN');
  };

  const handleExtend = async () => {
    if (!extendTarget) return;
    setExtending(true);
    try {
      const body = extendChoice === 'lifetime' ? { lifetime: true } : { days: extendChoice };
      const res = await axios.post(`${LICENSE_SERVER_URL}/api/admin/licenses/${extendTarget.id}/extend`, body, {
        headers: { 'x-admin-secret': adminSecret },
      });
      message.success(res.data.message);
      setExtendTarget(null);
      fetchLicenses(false);
      fetchLogs();
    } catch (err: any) {
      message.error(err.response?.data?.message || 'Lỗi khi gia hạn');
    } finally {
      setExtending(false);
    }
  };

  // Reset HWID (cho phép khách đổi máy)
  const handleResetHWID = async (record: LicenseItem) => {
    try {
      const res = await axios.post(`${LICENSE_SERVER_URL}/api/admin/licenses/${record.id}/reset-hwid`, {}, {
        headers: { 'x-admin-secret': adminSecret },
      });
      if (res.data?.success) {
        message.success(res.data.message);
        fetchLicenses(false);
        fetchLogs();
      }
    } catch (err: any) {
      message.error(err.response?.data?.message || 'Lỗi reset mã máy');
    }
  };

  // Xóa key
  const handleDeleteLicense = async (id: number) => {
    try {
      const res = await axios.delete(`${LICENSE_SERVER_URL}/api/admin/licenses/${id}`, {
        headers: { 'x-admin-secret': adminSecret },
      });
      if (res.data?.success) {
        message.success('Đã xóa mã key thành công');
        fetchLicenses(false);
        fetchLogs();
      }
    } catch (err: any) {
      message.error('Lỗi khi xóa key');
    }
  };

  // Copy key
  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    message.success(`Đã copy key: ${key}`);
  };

  // Lọc danh sách
  const filteredLicenses = licenses.filter((item) => {
    const q = searchQuery.toLowerCase().trim();
    const matchQuery = !q ||
      item.license_key.toLowerCase().includes(q) ||
      item.client_name.toLowerCase().includes(q) ||
      (item.hwid && item.hwid.toLowerCase().includes(q));

    if (!matchQuery) return false;

    if (filterStatus === 'ACTIVE') return item.status === 'ACTIVE';
    if (filterStatus === 'LOCKED') return item.status === 'LOCKED';
    if (filterStatus === 'ONLINE') {
      const now = Date.now();
      return item.last_ping_at && (now - new Date(item.last_ping_at).getTime() < 5 * 60 * 1000);
    }
    return true;
  });

  const columns = [
    {
      title: 'Mã License Key',
      dataIndex: 'license_key',
      key: 'license_key',
      width: 220,
      className: 'whitespace-nowrap',
      render: (key: string) => (
        <Space size="small" className="whitespace-nowrap">
          <Text code className="text-blue-400 font-mono font-bold text-xs tracking-wide cursor-pointer select-all" onClick={() => handleCopyKey(key)}>
            {key}
          </Text>
          <Tooltip title="Copy mã key">
            <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => handleCopyKey(key)} />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: 'Khách Hàng',
      key: 'client_name',
      width: 170,
      render: (_: any, r: LicenseItem) => (
        <div>
          <div className="font-semibold text-slate-100">{r.client_name}</div>
          {r.notes && <div className="text-xs text-slate-400">{r.notes}</div>}
        </div>
      ),
    },
    {
      title: 'Mã Máy Tính (HWID)',
      dataIndex: 'hwid',
      key: 'hwid',
      width: 190,
      className: 'whitespace-nowrap',
      render: (hwid: string | null, r: LicenseItem) => (
        hwid ? (
          <div>
            <Tooltip title={`Khóa cứng với thiết bị: ${hwid}`}>
              <Tag color="geekblue" icon={<LaptopOutlined />} className="font-mono text-xs whitespace-nowrap">
                {hwid}
              </Tag>
            </Tooltip>
            {(r.client_os || r.app_version) && (
              <div className="text-[11px] text-slate-400 mt-1">
                {OS_LABEL[r.client_os || ''] || r.client_os}
                {r.app_version ? ` · app v${r.app_version}` : ''}
              </div>
            )}
          </div>
        ) : (
          <span className="text-slate-500 italic text-xs">Chưa gắn máy</span>
        )
      ),
    },
    {
      title: 'Trạng Thái',
      key: 'status',
      width: 180,
      className: 'whitespace-nowrap',
      render: (_: any, r: LicenseItem) => {
        if (r.status === 'LOCKED') {
          return <Tag color="error" icon={<StopOutlined />} className="px-2 py-0.5 text-xs font-semibold whitespace-nowrap">🔴 ĐÃ KHÓA (Kill-Switch)</Tag>;
        }
        if (r.status === 'EXPIRED') {
          return <Tag color="default" className="px-2 py-0.5 text-xs whitespace-nowrap">⌛ Hết hạn</Tag>;
        }
        return <Tag color="success" icon={<CheckCircleOutlined />} className="px-2 py-0.5 text-xs font-semibold whitespace-nowrap">🟢 Hoạt Động</Tag>;
      },
    },
    {
      title: 'Hạn Dùng',
      key: 'expires_at',
      width: 150,
      className: 'whitespace-nowrap',
      render: (_: any, r: LicenseItem) => {
        if (!r.expires_at) return <Text className="text-amber-400 font-medium whitespace-nowrap">Vĩnh Viễn (Lifetime)</Text>;
        const expDate = new Date(r.expires_at);
        const diffDays = Math.ceil((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        return (
          <div className="whitespace-nowrap">
            <div className="text-xs text-slate-200">{expDate.toLocaleDateString('vi-VN')}</div>
            <div className={`text-xs ${diffDays > 5 ? 'text-slate-400' : 'text-red-400 font-semibold'}`}>
              {diffDays > 0 ? `(Còn ${diffDays} ngày)` : '(Đã hết hạn)'}
            </div>
          </div>
        );
      },
    },
    {
      title: 'Lần Cuối Online',
      key: 'last_ping_at',
      width: 150,
      className: 'whitespace-nowrap',
      render: (_: any, r: LicenseItem) => {
        if (!r.last_ping_at) return <span className="text-slate-500 text-xs">Chưa mở app</span>;
        const diffMins = Math.floor((Date.now() - new Date(r.last_ping_at).getTime()) / 60000);
        const isOnline = diffMins < 5;
        return (
          <div className="whitespace-nowrap">
            {isOnline ? (
              <Badge status="processing" text={<span className="text-emerald-400 font-semibold text-xs whitespace-nowrap">● Đang mở Tool</span>} />
            ) : (
              <span className="text-slate-400 text-xs">{diffMins < 60 ? `${diffMins} phút trước` : `${Math.floor(diffMins / 60)} giờ trước`}</span>
            )}
            {r.last_ip && <div className="text-[10px] text-slate-500">IP: {r.last_ip}</div>}
          </div>
        );
      },
    },
    {
      title: 'Hành Động Khóa / Mở',
      key: 'actions',
      width: 220,
      align: 'right' as const,
      className: 'whitespace-nowrap',
      render: (_: any, r: LicenseItem) => (
        <Space size="small" className="whitespace-nowrap">
          <Button size="small" type="primary" onClick={() => { setExtendChoice(r.expires_at ? 30 : 'lifetime'); setExtendTarget(r); }} disabled={!r.expires_at}>
            Gia hạn
          </Button>
          {r.status === 'ACTIVE' ? (
            <Popconfirm
              title="Khóa ngay máy khách này?"
              description="Ứng dụng trên máy của khách sẽ lập tức văng ra và tự tắt ngay!"
              okText="Khóa Tức Thì"
              okType="danger"
              cancelText="Hủy"
              onConfirm={() => handleToggleLock(r)}
            >
              <Button size="small" danger icon={<LockOutlined />} className="bg-red-500/10 border-red-500/30 text-red-300 hover:bg-red-600 hover:text-white">
                Khóa Tức Thì
              </Button>
            </Popconfirm>
          ) : (
            <Button size="small" type="primary" icon={<UnlockOutlined />} className="bg-emerald-600 hover:bg-emerald-500" onClick={() => handleToggleLock(r)}>
              Mở Khóa
            </Button>
          )}

          {r.hwid && (
            <Tooltip title="Cho phép khách đổi sang máy tính mới">
              <Button size="small" icon={<ReloadOutlined />} onClick={() => handleResetHWID(r)}>
                Đổi Máy
              </Button>
            </Tooltip>
          )}

          <Popconfirm
            title="Xóa vĩnh viễn key này?"
            okText="Xóa"
            okType="danger"
            cancelText="Hủy"
            onConfirm={() => handleDeleteLicense(r.id)}
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const secret = adminPasswordInput.trim();
    if (!secret) return;
    try {
      await axios.get(`${LICENSE_SERVER_URL}/api/admin/licenses`, { headers: { 'x-admin-secret': secret } });
      sessionStorage.setItem(SECRET_STORAGE_KEY, secret);
      setAdminSecret(secret);
      setAdminPasswordInput('');
      setIsAdminUnlocked(true);
      message.success('Xác thực quyền Admin thành công');
    } catch (err: any) {
      message.error(err.response?.status === 401 ? 'Mật khẩu Admin không chính xác' : 'Không kết nối được License Server');
    }
  };

  if (!isAdminUnlocked) {
    return (
      <div className="min-h-[75vh] flex items-center justify-center p-6">
        <Card className="max-w-md w-full bg-slate-900/80 border-amber-500/30 backdrop-blur-xl shadow-2xl p-4 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-3xl text-amber-400">
            <SafetyCertificateOutlined />
          </div>
          <Title level={4} className="!text-white !mb-1">
            Khu Vực Quản Trị Viên (Admin Master)
          </Title>
          <Text className="text-slate-400 text-xs block mb-6">
            Trang này chỉ dành riêng cho bạn (Chủ phần mềm) để cấp key và khóa app khách từ xa. Khách hàng sử dụng sẽ không thể truy cập vào đây.
          </Text>

          <form onSubmit={handleAdminLogin} className="space-y-4">
            <Input.Password
              placeholder="Nhập Mật Khẩu Admin Secret..."
              value={adminPasswordInput}
              onChange={(e) => setAdminPasswordInput(e.target.value)}
              size="large"
              className="bg-black/40 border-white/10 text-white"
              autoFocus
            />
            <Button type="primary" htmlType="submit" size="large" block className="bg-amber-600 hover:bg-amber-500 font-bold border-none">
              Mở Khóa Bảng Quản Trị
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-white/10">
        <div>
          <Title level={3} className="!mb-1 !text-white flex items-center gap-2">
            <SafetyCertificateOutlined className="text-amber-400" /> Trung Tâm Quản Lý Bản Quyền & Khóa Từ Xa
          </Title>
          <Text className="text-slate-400">
            Kiểm soát ai đang dùng phần mềm của bạn, khóa tức thì (Remote Kill-Switch) và phân bổ key cho khách hàng
          </Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { fetchLicenses(); fetchLogs(); }}>
            Làm mới
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)} className="bg-blue-600 hover:bg-blue-500">
            + Tạo Key Mới Cho Khách
          </Button>
        </Space>
      </div>

      {/* Thẻ máy tính này & HWID */}
      <Card className="bg-blue-950/20 border-blue-500/30 backdrop-blur-md">
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} md={12}>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-2xl text-blue-400">
                <LaptopOutlined />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400 font-bold">Mã Phần Cứng Máy Tính Này (HWID Của Bạn)</div>
                <div className="font-mono text-sm font-bold text-blue-300 mt-0.5 flex items-center gap-2">
                  {myHWID || 'Đang nhận diện...'}
                  {myHWID && (
                    <Tooltip title="Copy mã HWID">
                      <CopyOutlined className="cursor-pointer text-slate-400 hover:text-white" onClick={() => {
                        navigator.clipboard.writeText(myHWID);
                        message.success('Đã copy mã HWID máy bạn!');
                      }} />
                    </Tooltip>
                  )}
                </div>
              </div>
            </div>
          </Col>
          <Col xs={24} md={12} className="md:text-right">
            <Tag color="gold" className="text-xs px-3 py-1 font-semibold">
              👑 Quyền Hạn: Admin Master (Chủ Sở Hữu Phần Mềm)
            </Tag>
            <div className="text-xs text-slate-400 mt-1">
              Bạn có toàn quyền tạo key, thu hồi quyền truy cập và khóa app từ xa bất kỳ lúc nào.
            </div>
          </Col>
        </Row>
      </Card>

      {/* 4 Thẻ Thống Kê */}
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={6}>
          <Card className="bg-slate-900/60 border-white/10 hover:border-blue-500/40 transition-all">
            <Statistic
              title={<span className="text-slate-400 text-xs font-semibold">TỔNG KEY ĐÃ CẤP</span>}
              value={stats.total}
              prefix={<KeyOutlined className="text-blue-400 mr-1" />}
              valueStyle={{ color: '#60a5fa', fontWeight: 800 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card className="bg-slate-900/60 border-white/10 hover:border-emerald-500/40 transition-all">
            <Statistic
              title={<span className="text-slate-400 text-xs font-semibold">ĐANG HOẠT ĐỘNG</span>}
              value={stats.active}
              prefix={<CheckCircleOutlined className="text-emerald-400 mr-1" />}
              valueStyle={{ color: '#34d399', fontWeight: 800 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card className="bg-slate-900/60 border-white/10 hover:border-red-500/40 transition-all">
            <Statistic
              title={<span className="text-slate-400 text-xs font-semibold">ĐANG BỊ KHÓA</span>}
              value={stats.locked}
              prefix={<StopOutlined className="text-red-400 mr-1" />}
              valueStyle={{ color: '#f87171', fontWeight: 800 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card className="bg-slate-900/60 border-white/10 hover:border-cyan-500/40 transition-all">
            <Statistic
              title={<span className="text-slate-400 text-xs font-semibold">ONLINE VỪA XONG</span>}
              value={stats.onlineNow}
              prefix={<ThunderboltOutlined className="text-cyan-400 mr-1" />}
              valueStyle={{ color: '#22d3ee', fontWeight: 800 }}
            />
          </Card>
        </Col>
      </Row>

      {/* Bảng Quản Lý Khách Hàng */}
      <Card className="bg-slate-900/60 border-white/10 backdrop-blur-md">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-4">
          <Input
            prefix={<SearchOutlined className="text-slate-400" />}
            placeholder="Tìm theo Mã Key, Tên khách hàng hoặc HWID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-md bg-black/30 border-white/10"
            allowClear
          />
          <Space>
            <span className="text-xs text-slate-400 font-medium">Lọc theo:</span>
            <Select
              value={filterStatus}
              onChange={setFilterStatus}
              style={{ width: 140 }}
              options={[
                { value: 'ALL', label: 'Tất cả' },
                { value: 'ACTIVE', label: '🟢 Hoạt động' },
                { value: 'LOCKED', label: '🔴 Đã khóa' },
                { value: 'ONLINE', label: '⚡ Đang online' },
              ]}
            />
          </Space>
        </div>

        <Table
          dataSource={filteredLicenses}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10, showTotal: (total) => `Tổng cộng ${total} khách hàng` }}
          scroll={{ x: 1000 }}
        />
      </Card>

      {/* Nhật ký Audit Logs */}
      <Card title={<span className="text-sm font-bold text-slate-200">📋 Nhật Ký Hoạt Động (Audit Logs)</span>} className="bg-slate-900/60 border-white/10">
        <div className="max-h-56 overflow-y-auto space-y-2 font-mono text-xs pr-2">
          {logs.length === 0 ? (
            <div className="text-slate-500 text-center py-4">Chưa có nhật ký nào</div>
          ) : (
            logs.slice(0, 30).map((log) => {
              const isKill = log.action.includes('KILL') || log.action.includes('LOCKED') || log.action.includes('BLOCKED');
              const isBind = log.action.includes('BIND') || log.action.includes('OK');
              return (
                <div
                  key={log.id}
                  className={`p-2.5 rounded-lg flex items-center justify-between border ${
                    isKill
                      ? 'bg-red-950/20 border-red-500/30 text-red-200'
                      : isBind
                      ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                      : 'bg-black/30 border-white/5 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>{isKill ? '🔴' : isBind ? '🟢' : '📝'}</span>
                    <strong>{log.action}</strong>
                    <span className="text-blue-400 font-bold">{log.license_key}</span>
                    {log.details && <span className="text-slate-400">({log.details})</span>}
                  </div>
                  <div className="text-slate-500 text-[11px]">
                    {log.ip && `${log.ip} • `}{new Date(log.timestamp).toLocaleTimeString('vi-VN')}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Modal Gia Hạn */}
      <Modal
        title={<span className="text-white font-bold text-base">Gia hạn: {extendTarget?.client_name}</span>}
        open={!!extendTarget}
        onCancel={() => setExtendTarget(null)}
        onOk={handleExtend}
        okText="Xác Nhận Gia Hạn"
        cancelText="Hủy"
        confirmLoading={extending}
        destroyOnClose
      >
        {extendTarget && (
          <div className="space-y-4">
            <Select<ExtendChoice>
              className="w-full"
              value={extendChoice}
              onChange={setExtendChoice}
              options={EXTEND_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <div className="text-sm text-slate-300">
              Hạn hiện tại: <b>{extendTarget.expires_at ? new Date(extendTarget.expires_at).toLocaleDateString('vi-VN') : 'Vĩnh viễn'}</b>
              {' → '}Hạn mới: <b>{extendPreview(extendTarget, extendChoice)}</b>
            </div>
            <div className="text-xs text-slate-500">
              Key đã hết hạn sẽ được mở lại. App khách đang mở tự nhận hạn mới trong vòng 3 phút, không cần nhập lại key.
            </div>
          </div>
        )}
      </Modal>

      {/* Modal Tạo Key Mới */}
      <Modal
        title={<span className="text-white font-bold text-base">Tạo Mã License Key Mới</span>}
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreateLicense} initialValues={{ durationDays: 90, maxAccounts: 20 }}>
          <Form.Item name="clientName" label="Tên Khách Hàng / Đơn Vị" rules={[{ required: true, message: 'Vui lòng nhập tên khách hàng' }]}>
            <Input placeholder="VD: Anh Minh - Media Agency" />
          </Form.Item>

          <Form.Item name="durationDays" label="Gói Thời Hạn">
            <Select
              options={[
                { value: 30, label: '1 Tháng (30 ngày)' },
                { value: 90, label: '3 Tháng (90 ngày) — Khuyên dùng' },
                { value: 180, label: '6 Tháng (180 ngày)' },
                { value: 365, label: '1 Năm (365 ngày)' },
                { value: 9999, label: 'Vĩnh Viễn (Lifetime)' },
              ]}
            />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="maxAccounts" label="Số Tài Khoản Tối Đa">
                <Input type="number" min={1} max={500} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="notes" label="Ghi Chú">
                <Input placeholder="VD: Khách VCB 1.5 triệu" />
              </Form.Item>
            </Col>
          </Row>

          <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-white/10">
            <Button onClick={() => setCreateModalOpen(false)}>Hủy</Button>
            <Button type="primary" htmlType="submit" loading={creating} className="bg-blue-600 hover:bg-blue-500">
              Xác Nhận & Xuất Mã Key
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default LicenseManager;
