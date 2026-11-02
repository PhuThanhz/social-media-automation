import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Form, Input, Button, Select, Alert, Tag, Space, Typography, message, Segmented, Flex } from 'antd';
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

export function extractCookieFields(rawStr: string, defaultCUser: string = ''): {
  cUser: string;
  xs: string;
  isValid: boolean;
  normalized: string;
  fullCookie: string;
} {
  if (!rawStr && !defaultCUser) return { cUser: '', xs: '', isValid: false, normalized: '', fullCookie: '' };
  
  const text = (rawStr || '').trim();
  
  // 1. JSON format từ tiện ích J2Team / Cookie-Editor
  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const arr = JSON.parse(text);
      let cUser = '';
      let xs = '';
      const pairs: string[] = [];
      if (Array.isArray(arr)) {
        for (const item of arr) {
          const name = String(item?.name || '').trim();
          const val = String(item?.value || '').trim();
          if (!name || !val) continue;
          if (name === 'c_user') cUser = val;
          if (name === 'xs') xs = val;
          pairs.push(`${name}=${val}`);
        }
      }
      if (cUser && xs) {
        const full = pairs.join('; ');
        return { cUser, xs, isValid: true, normalized: full, fullCookie: full };
      }
    } catch {}
  }

  // 2. Trích xuất c_user từ chuỗi dán vào (nếu có)
  const cUserMatch = text.match(/(?:c_user=|^c_user:\s*|["']?c_user["']?\s*[:=]\s*["']?)([\d]+)/i);
  const cUser = (cUserMatch ? cUserMatch[1] : defaultCUser) || '';

  // 3. Trích xuất xs
  const xsMatch = text.match(/(?:xs=|^xs:\s*|["']?xs["']?\s*[:=]\s*["']?)([^;'"\s\n\r]+)/i);
  let xs = xsMatch ? xsMatch[1] : '';

  // Nếu người dùng chỉ dán nguyên chuỗi xs (không có dấu =)
  if (!xs && text && !text.includes('=')) {
    xs = text;
  }

  const isValid = Boolean(cUser && xs);
  if (!isValid) {
    return { cUser, xs, isValid: false, normalized: '', fullCookie: '' };
  }

  // Nếu chuỗi dán vào là Full Cookie (chứa nhiều cặp cookie khác như sb, datr, fr...)
  let fullCookie = text;
  if (!text.includes('c_user=') && cUser) {
    fullCookie = `c_user=${cUser}; ${text}`;
  }

  const minimal = `c_user=${cUser}; xs=${xs}`;
  const normalized = fullCookie.includes(';') ? fullCookie : minimal;

  return { cUser, xs, isValid, normalized, fullCookie };
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
      const pair = isValid ? `c_user=${cUser}; xs=${xs}` : '';
      return {
        cUser,
        xs,
        isValid,
        normalized: pair,
        fullCookie: pair,
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

    const finalCookie = parsedData.fullCookie || parsedData.normalized || rawCookieInput.trim();
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
      className="quick-cookie-modal qcm-modal"
      destroyOnHidden
      title={
        <div className="qcm-title-row">
          <Flex align="center" gap={10}>
            <div className="qcm-title-icon">
              <KeyOutlined className="qcm-ic-base" />
            </div>
            <div>
              <div className="qcm-title-text">Cập Nhật Cookie Facebook 1-Chạm</div>
              <div className="qcm-title-sub">Khắc phục nhanh lỗi hết hạn phiên đăng nhập</div>
            </div>
          </Flex>
          {expiredAccounts.length > 0 && (
            <Tag color="error" className="qcm-count-tag">
              {expiredAccounts.length} Cookie hết hạn
            </Tag>
          )}
        </div>
      }
    >
      <div className="qcm-body">
        {/* Chọn tài khoản */}
        <div>
          <label className="qcm-label">
            Tài khoản / Fanpage cần cập nhật:
          </label>
          <Select
            value={selectedAccountId}
            onChange={setSelectedAccountId}
            size="large"
            className="qcm-full"
            placeholder="Chọn tài khoản Facebook"
          >
            {cookieAccounts.map((acc) => {
              const isExpired = acc.tokenStatus === 'EXPIRED';
              return (
                <Option key={acc.id} value={acc.id}>
                  <Flex align="center" justify="space-between">
                    <span className="qcm-option-name">
                      {acc.pageName || acc.platformAccountId}
                    </span>
                    <Space size={4}>
                      <span className="qcm-option-id">ID: {acc.platformAccountId}</span>
                      {isExpired ? (
                        <Tag color="error" className="qcm-option-tag">
                          HẾT HẠN COOKIE
                        </Tag>
                      ) : (
                        <Tag color="success" className="qcm-option-tag-plain">
                          OK
                        </Tag>
                      )}
                    </Space>
                  </Flex>
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
              <div className="qcm-text-xs">
                <span className="qcm-alert-strong">
                  Cookie của &quot;{currentAccount.pageName || currentAccount.platformAccountId}&quot; đã bị hết hạn!
                </span>
                <p className="qcm-alert-desc">
                  Tất cả tác vụ đăng bài bằng Cookie này sẽ bị lỗi. Hãy dán chuỗi Cookie mới từ Chrome / Extension bên dưới để kích hoạt lại ngay.
                </p>
              </div>
            }
            className="qcm-alert"
          />
        ) : (
          <div className="qcm-cuser-row">
            <span className="qcm-slate-600">Trạng thái hiện tại:</span>
            <Tag color={currentAccount?.tokenStatus === 'OK' ? 'success' : 'default'} className="qcm-pill-bold">
              {currentAccount?.tokenStatus === 'OK' ? 'Cookie đang hoạt động' : 'Chưa kiểm tra'}
            </Tag>
          </div>
        )}

        {/* Banner thông báo tự động đồng bộ theo Nick Via */}
        {targetCUser && linkedAccounts.length > 1 && (
          <div className="shadow-2xs qcm-guide">
            <div className="qcm-guide-title">
              <ThunderboltOutlined className="qcm-ic-amber" />
              Tự động đồng bộ Cookie cho {linkedAccounts.length} Fanpage & Nhóm:
            </div>
            <div className="qcm-guide-text">
              Chỉ cần cập nhật Cookie của Nick này (UID: <span className="qcm-guide-code">{targetCUser}</span>), hệ thống sẽ tự động cập nhật và kích hoạt sống cho tất cả {linkedAccounts.length} trang ({linkedAccounts.slice(0, 4).map(a => a.pageName || a.platformAccountId).join(', ')}{linkedAccounts.length > 4 ? ` và ${linkedAccounts.length - 4} trang khác` : ''}).
            </div>
          </div>
        )}

        {/* Chế độ nhập */}
        <Flex align="center" justify="space-between" className="qcm-mode-row">
          <Segmented
            value={inputMode}
            onChange={(val) => setInputMode(val as any)}
            options={[
              { label: '🚀 Dán nguyên chuỗi Cookie (Khuyên dùng)', value: 'RAW' },
              { label: '⚙️ Nhập c_user + xs riêng', value: 'MANUAL' },
            ]}
            className="qcm-mode"
          />
        </Flex>

        {/* Giao diện nhập Cookie */}
        {inputMode === 'RAW' ? (
          <div className="qcm-stack-2">
            <Flex align="center" justify="space-between">
              <span className="qcm-field-label">Dán chuỗi Cookie Facebook vào đây:</span>
              <Button
                type="dashed"
                size="small"
                icon={<CopyOutlined />}
                onClick={handlePasteClipboard}
                className="qcm-paste-btn"
              >
                📋 Dán từ Clipboard
              </Button>
            </Flex>
            <TextArea
              rows={4}
              value={rawCookieInput}
              onChange={(e) => setRawCookieInput(e.target.value)}
              placeholder="Dán toàn bộ chuỗi cookie lấy từ Extension hoặc DevTools F12 (VD: c_user=1000...; xs=27%3A...; datr=...)"
              className="qcm-textarea"
              autoFocus
            />
            <div className="qcm-hint-row">
              <span>Hệ thống tự động tìm và bóc tách <code>c_user</code> và <code>xs</code>.</span>
            </div>
          </div>
        ) : (
          <div className="qcm-stack-3">
            <div>
              <label className="qcm-label-block">c_user (ID tài khoản):</label>
              <Input
                value={manualCUser}
                onChange={(e) => setManualCUser(e.target.value)}
                placeholder="VD: 100023403136194"
                className="qcm-mono-input"
              />
            </div>
            <div>
              <label className="qcm-label-block">xs (Session Token):</label>
              <Input.Password
                value={manualXs}
                onChange={(e) => setManualXs(e.target.value)}
                placeholder="VD: 27%3AFjj1d3Y_5KP0JA%3A2%3A1787585254..."
                className="qcm-mono-input"
              />
            </div>
          </div>
        )}

        {/* Kết quả nhận diện Cookie thời gian thực */}
        <div className="qcm-preview">
          <Flex align="center" justify="space-between" className="qcm-preview-head">
            <span className="qcm-preview-title">Kết quả nhận diện:</span>
            {parsedData.isValid ? (
              <Tag icon={<CheckCircleOutlined />} color="success" className="qcm-pill-bold">
                Hợp lệ
              </Tag>
            ) : (
              <Tag icon={<WarningOutlined />} color="warning" className="qcm-pill-bold">
                Chưa đủ thông tin
              </Tag>
            )}
          </Flex>
          <div className="qcm-preview-grid">
            <div className="qcm-preview-cell">
              <span className="qcm-preview-key">c_user: </span>
              <span className={parsedData.cUser ? 'qcm-val-cuser' : 'qcm-val-empty'}>
                {parsedData.cUser || '(chưa có)'}
              </span>
            </div>
            <div className="qcm-preview-cell">
              <span className="qcm-preview-key">xs: </span>
              <span className={parsedData.xs ? 'qcm-val-xs' : 'qcm-val-empty'}>
                {parsedData.xs ? `${parsedData.xs.slice(0, 15)}...` : '(chưa có)'}
              </span>
            </div>
          </div>
        </div>

        {/* Nút hành động */}
        <div className="qcm-footer">
          <Button onClick={onClose} size="large" className="qcm-cancel-btn">
            Đóng
          </Button>
          <Button
            type="primary"
            size="large"
            icon={<ThunderboltOutlined />}
            onClick={handleSave}
            loading={updateMutation.isPending}
            disabled={!parsedData.isValid}
            className="qcm-save-btn"
          >
            Lưu & Kích Hoạt Ngay
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default QuickUpdateCookieModal;
