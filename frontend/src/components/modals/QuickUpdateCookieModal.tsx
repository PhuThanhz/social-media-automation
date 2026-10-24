import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Form, Input, Button, Select, Alert, Tag, Space, Typography, message, Segmented } from 'antd';
import {
  KeyOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ThunderboltOutlined,
  GlobalOutlined,
  SafetyCertificateOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../config/axios';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;
const { Option } = Select;

export interface QuickCookieAccount {
  id: number;
  platform?: string;
  platformAccountId: string;
  pageName?: string;
  accountType?: string;
  tokenStatus?: string;
  accessToken?: string;
  postingIdentityAccountId?: number;
}

interface QuickUpdateCookieModalProps {
  open: boolean;
  onClose: () => void;
  targetAccountId?: number;
  accounts?: QuickCookieAccount[];
  onSuccess?: () => void;
}

export function extractCookieFields(rawStr: string, defaultCUser: string = ''): { cUser: string; xs: string; isValid: boolean; normalized: string } {
  if (!rawStr && !defaultCUser) return { cUser: '', xs: '', isValid: false, normalized: '' };
  
  const text = (rawStr || '').trim();
  
  // Trích xuất c_user từ chuỗi dán vào (nếu có)
  const cUserMatch = text.match(/(?:c_user=|^c_user:\s*|["']?c_user["']?\s*[:=]\s*["']?)([\d]+)/i);
  const cUser = (cUserMatch ? cUserMatch[1] : defaultCUser) || '';

  // Trích xuất xs
  const xsMatch = text.match(/(?:xs=|^xs:\s*|["']?xs["']?\s*[:=]\s*["']?)([^;'"\s\n\r]+)/i);
  let xs = xsMatch ? xsMatch[1] : '';

  // Nếu người dùng chỉ dán nguyên chuỗi xs (không có dấu =)
  if (!xs && text && !text.includes('=')) {
    xs = text;
  }

  const isValid = Boolean(cUser && xs);
  const normalized = isValid ? `c_user=${cUser}; xs=${xs}` : '';

  return { cUser, xs, isValid, normalized };
}

export const QuickUpdateCookieModal: React.FC<QuickUpdateCookieModalProps> = ({
  open,
  onClose,
  targetAccountId,
  accounts: externalAccounts,
  onSuccess,
}) => {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [selectedAccountId, setSelectedAccountId] = useState<number | undefined>(targetAccountId);
  const [inputMode, setInputMode] = useState<'RAW' | 'MANUAL'>('RAW');
  const [rawCookieInput, setRawCookieInput] = useState<string>('');
  const [manualCUser, setManualCUser] = useState<string>('');
  const [manualXs, setManualXs] = useState<string>('');

  // Lấy danh sách kết nối nếu không truyền sẵn
  const { data: fetchedAccounts = [] } = useQuery<QuickCookieAccount[]>({
    queryKey: ['socialAccounts'],
    queryFn: async () => (await api.get('/connections')).data,
    enabled: open && !externalAccounts,
  });

  const allAccounts = externalAccounts || fetchedAccounts;
  const cookieAccounts = useMemo(
    () => allAccounts.filter((a) => a.platform !== 'FACEBOOK_GROUP' && a.accountType !== 'PAGE_TOKEN'),
    [allAccounts]
  );

  const expiredAccounts = useMemo(
    () => cookieAccounts.filter((a) => a.tokenStatus === 'EXPIRED'),
    [cookieAccounts]
  );

  const currentAccount = useMemo(
    () => cookieAccounts.find((a) => a.id === selectedAccountId),
    [cookieAccounts, selectedAccountId]
  );

  // c_user mặc định phải là UID nick cá nhân. Với kết nối Fanpage, platformAccountId là ID Page —
  // dùng nó làm c_user sẽ tạo cookie lai (xs của Via + ID Page) khiến Page bị báo hết hạn oan.
  const existingCUser = useMemo(() => {
    if (!currentAccount) return '';
    const isProfile = currentAccount.platform === 'FACEBOOK_PROFILE' || currentAccount.accountType === 'PERSONAL_PROFILE_COOKIE';
    if (isProfile && currentAccount.platformAccountId && /^\d+$/.test(currentAccount.platformAccountId)) {
      return currentAccount.platformAccountId;
    }
    const identityVia = currentAccount.postingIdentityAccountId
      ? allAccounts.find((a) => a.id === currentAccount.postingIdentityAccountId)
      : undefined;
    const viaCUser = identityVia?.accessToken?.match(/c_user=([^;]+)/)?.[1]?.trim();
    if (viaCUser) return viaCUser;
    const match = currentAccount.accessToken?.match(/c_user=([^;]+)/);
    const ownCUser = match ? match[1].trim() : '';
    return ownCUser && ownCUser !== currentAccount.platformAccountId ? ownCUser : '';
  }, [currentAccount, allAccounts]);

  // Khởi tạo account và c_user được chọn khi mở modal
  useEffect(() => {
    if (open) {
      if (targetAccountId) {
        setSelectedAccountId(targetAccountId);
      } else if (expiredAccounts.length > 0) {
        setSelectedAccountId(expiredAccounts[0].id);
      } else if (cookieAccounts.length > 0) {
        setSelectedAccountId(cookieAccounts[0].id);
      }
      setRawCookieInput('');
      setManualXs('');
      form.resetFields();
    }
  }, [open, targetAccountId, expiredAccounts.length, cookieAccounts.length]);

  useEffect(() => {
    if (existingCUser) {
      setManualCUser(existingCUser);
    }
  }, [existingCUser]);

  // Phân tích chuỗi cookie theo thời gian thực (tự dùng existingCUser nếu người dùng chỉ dán xs)
  const parsedData = useMemo(() => {
    if (inputMode === 'RAW') {
      return extractCookieFields(rawCookieInput, existingCUser);
    } else {
      const cUser = manualCUser.trim() || existingCUser;
      const xs = manualXs.trim();
      const isValid = Boolean(cUser && xs);
      return {
        cUser,
        xs,
        isValid,
        normalized: isValid ? `c_user=${cUser}; xs=${xs}` : '',
      };
    }
  }, [inputMode, rawCookieInput, manualCUser, manualXs, existingCUser]);

  const targetCUser = parsedData.cUser || existingCUser;
  const linkedAccounts = useMemo(() => {
    if (!targetCUser) return [];
    return allAccounts.filter((a) => {
      const aCUser = extractCookieFields(a.accessToken || '').cUser || (a.platformAccountId?.match(/^\d+$/) ? a.platformAccountId : '');
      return aCUser === targetCUser;
    });
  }, [allAccounts, targetCUser]);

  // Mutation cập nhật cookie
  const updateMutation = useMutation({
    mutationFn: async ({ id, accessToken }: { id: number; accessToken: string }) => {
      const res = await api.put(`/connections/${id}`, { accessToken, tokenStatus: 'OK' });
      return res.data;
    },
    onSuccess: (data, vars) => {
      const count = linkedAccounts.length > 0 ? linkedAccounts.length : 1;
      message.success(`Đã cập nhật Cookie thành công cho toàn bộ ${count} Fanpage/Nhóm thuộc Nick Via (${targetCUser || vars.id})! 🎉`);
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      queryClient.invalidateQueries({ queryKey: ['postQueue'] });
      queryClient.invalidateQueries({ queryKey: ['postQueuePlaywright'] });
      queryClient.invalidateQueries({ queryKey: ['managedFacebookPages'] });
      queryClient.invalidateQueries({ queryKey: ['facebookPageAccess'] });
      onSuccess?.();
      onClose();
    },
    onError: (err: any) => {
      message.error(err.response?.data?.message || 'Có lỗi xảy ra khi cập nhật Cookie!');
    },
  });

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        message.warning('Clipboard rỗng!');
        return;
      }
      setRawCookieInput(text);
      const parsed = extractCookieFields(text);
      if (parsed.isValid) {
        message.success(`Đã đọc Cookie từ Clipboard: c_user=${parsed.cUser}`);
      } else {
        message.info('Đã dán chuỗi từ Clipboard. Vui lòng kiểm tra lại c_user và xs.');
      }
    } catch {
      message.error('Không thể đọc Clipboard (Vui lòng cấp quyền trình duyệt hoặc dán thủ công Ctrl+V)!');
    }
  };

  const handleSave = () => {
    if (!selectedAccountId) {
      message.error('Vui lòng chọn tài khoản cần cập nhật!');
      return;
    }
    if (!parsedData.isValid) {
      message.error('Chuỗi Cookie không hợp lệ! Bắt buộc phải có cả c_user và xs.');
      return;
    }

    const finalCookie = parsedData.normalized || rawCookieInput.trim();
    updateMutation.mutate({
      id: selectedAccountId,
      accessToken: finalCookie,
    });
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={580}
      centered
      className="quick-cookie-modal rounded-2xl overflow-hidden"
      destroyOnHidden
      title={
        <div className="flex items-center justify-between pr-4 pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-red-500 text-white flex items-center justify-center shadow-sm">
              <KeyOutlined className="text-base" />
            </div>
            <div>
              <div className="font-bold text-base text-slate-800 leading-tight">Cập Nhật Cookie Facebook 1-Chạm</div>
              <div className="text-[11px] text-slate-400 font-normal">Khắc phục nhanh lỗi hết hạn phiên đăng nhập</div>
            </div>
          </div>
          {expiredAccounts.length > 0 && (
            <Tag color="error" className="!rounded-full font-bold text-xs animate-pulse">
              {expiredAccounts.length} Cookie hết hạn
            </Tag>
          )}
        </div>
      }
    >
      <div className="py-2 space-y-4">
        {/* Chọn tài khoản */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
            Tài khoản / Fanpage cần cập nhật:
          </label>
          <Select
            value={selectedAccountId}
            onChange={setSelectedAccountId}
            size="large"
            className="w-full"
            placeholder="Chọn tài khoản Facebook"
          >
            {cookieAccounts.map((acc) => {
              const isExpired = acc.tokenStatus === 'EXPIRED';
              return (
                <Option key={acc.id} value={acc.id}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800">
                      {acc.pageName || acc.platformAccountId}
                    </span>
                    <Space size={4}>
                      <span className="text-xs text-slate-400 font-mono">ID: {acc.platformAccountId}</span>
                      {isExpired ? (
                        <Tag color="error" className="!rounded-full font-bold text-[10px] ml-1">
                          HẾT HẠN COOKIE
                        </Tag>
                      ) : (
                        <Tag color="success" className="!rounded-full text-[10px] ml-1">
                          OK
                        </Tag>
                      )}
                    </Space>
                  </div>
                </Option>
              );
            })}
          </Select>
        </div>

        {/* Thông báo trạng thái tài khoản đang chọn */}
        {currentAccount?.tokenStatus === 'EXPIRED' ? (
          <Alert
            type="error"
            showIcon
            message={
              <div className="text-xs">
                <span className="font-bold text-red-600">
                  Cookie của &quot;{currentAccount.pageName || currentAccount.platformAccountId}&quot; đã bị hết hạn!
                </span>
                <p className="text-slate-600 mt-0.5 mb-0">
                  Tất cả tác vụ đăng bài bằng Cookie này sẽ bị lỗi. Hãy dán chuỗi Cookie mới từ Chrome / Extension bên dưới để kích hoạt lại ngay.
                </p>
              </div>
            }
            className="rounded-xl border-red-200 bg-red-50/70"
          />
        ) : (
          <div className="px-3 py-2 bg-slate-50 border border-slate-200/70 rounded-xl flex items-center justify-between text-xs">
            <span className="text-slate-600">Trạng thái hiện tại:</span>
            <Tag color={currentAccount?.tokenStatus === 'OK' ? 'success' : 'default'} className="!rounded-full font-bold">
              {currentAccount?.tokenStatus === 'OK' ? 'Cookie đang hoạt động' : 'Chưa kiểm tra'}
            </Tag>
          </div>
        )}

        {/* Banner thông báo tự động đồng bộ theo Nick Via */}
        {targetCUser && linkedAccounts.length > 1 && (
          <div className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/80 rounded-xl text-xs text-blue-900 shadow-2xs">
            <div className="font-bold flex items-center gap-1.5 text-blue-700 mb-1">
              <ThunderboltOutlined className="text-amber-500" />
              Tự động đồng bộ Cookie cho {linkedAccounts.length} Fanpage & Nhóm:
            </div>
            <div className="text-slate-600 line-clamp-2">
              Chỉ cần cập nhật Cookie của Nick này (UID: <span className="font-mono font-semibold text-slate-800">{targetCUser}</span>), hệ thống sẽ tự động cập nhật và kích hoạt sống cho tất cả {linkedAccounts.length} trang ({linkedAccounts.slice(0, 4).map(a => a.pageName || a.platformAccountId).join(', ')}{linkedAccounts.length > 4 ? ` và ${linkedAccounts.length - 4} trang khác` : ''}).
            </div>
          </div>
        )}

        {/* Chế độ nhập */}
        <div className="flex items-center justify-between pt-1">
          <Segmented
            value={inputMode}
            onChange={(val) => setInputMode(val as any)}
            options={[
              { label: '🚀 Dán nguyên chuỗi Cookie (Khuyên dùng)', value: 'RAW' },
              { label: '⚙️ Nhập c_user + xs riêng', value: 'MANUAL' },
            ]}
            className="w-full text-xs font-semibold"
          />
        </div>

        {/* Giao diện nhập Cookie */}
        {inputMode === 'RAW' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">Dán chuỗi Cookie Facebook vào đây:</span>
              <Button
                type="dashed"
                size="small"
                icon={<CopyOutlined />}
                onClick={handlePasteClipboard}
                className="text-xs font-bold text-blue-600 border-blue-300 hover:border-blue-500 bg-blue-50/50 rounded-lg"
              >
                📋 Dán từ Clipboard
              </Button>
            </div>
            <TextArea
              rows={4}
              value={rawCookieInput}
              onChange={(e) => setRawCookieInput(e.target.value)}
              placeholder="Dán toàn bộ chuỗi cookie lấy từ Extension hoặc DevTools F12 (VD: c_user=1000...; xs=27%3A...; datr=...)"
              className="font-mono text-xs rounded-xl border-slate-300 focus:border-blue-500"
              autoFocus
            />
            <div className="text-[11px] text-slate-500 flex items-center justify-between">
              <span>Hệ thống tự động tìm và bóc tách <code>c_user</code> và <code>xs</code>.</span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">c_user (ID tài khoản):</label>
              <Input
                value={manualCUser}
                onChange={(e) => setManualCUser(e.target.value)}
                placeholder="VD: 100023403136194"
                className="font-mono text-xs rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">xs (Session Token):</label>
              <Input.Password
                value={manualXs}
                onChange={(e) => setManualXs(e.target.value)}
                placeholder="VD: 27%3AFjj1d3Y_5KP0JA%3A2%3A1787585254..."
                className="font-mono text-xs rounded-xl"
              />
            </div>
          </div>
        )}

        {/* Kết quả nhận diện Cookie thời gian thực */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-700">Kết quả nhận diện:</span>
            {parsedData.isValid ? (
              <Tag icon={<CheckCircleOutlined />} color="success" className="!rounded-full font-bold">
                Hợp lệ
              </Tag>
            ) : (
              <Tag icon={<WarningOutlined />} color="warning" className="!rounded-full font-bold">
                Chưa đủ thông tin
              </Tag>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
            <div className="bg-white p-2 rounded-lg border border-slate-200 truncate">
              <span className="text-slate-400 font-sans">c_user: </span>
              <span className={parsedData.cUser ? 'text-blue-600 font-bold' : 'text-slate-300 italic'}>
                {parsedData.cUser || '(chưa có)'}
              </span>
            </div>
            <div className="bg-white p-2 rounded-lg border border-slate-200 truncate">
              <span className="text-slate-400 font-sans">xs: </span>
              <span className={parsedData.xs ? 'text-emerald-600 font-bold' : 'text-slate-300 italic'}>
                {parsedData.xs ? `${parsedData.xs.slice(0, 15)}...` : '(chưa có)'}
              </span>
            </div>
          </div>
        </div>

        {/* Nút hành động */}
        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <Button onClick={onClose} size="large" className="rounded-xl px-5">
            Đóng
          </Button>
          <Button
            type="primary"
            size="large"
            icon={<ThunderboltOutlined />}
            onClick={handleSave}
            loading={updateMutation.isPending}
            disabled={!parsedData.isValid}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl px-6 shadow-md border-none"
          >
            Lưu & Kích Hoạt Ngay
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default QuickUpdateCookieModal;
