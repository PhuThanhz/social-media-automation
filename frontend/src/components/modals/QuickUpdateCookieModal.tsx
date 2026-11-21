import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  Button,
  Input,
  Select,
  Tag,
  Alert,
  message,
  Flex,
  Segmented,
  Tooltip,
  Collapse,
  Badge,
  Space,
} from 'antd';
import {
  KeyOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ThunderboltOutlined,
  SafetyCertificateOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../config/axios';
import {
  FacebookCookies,
  INITIAL_FACEBOOK_COOKIES,
  parseAllFacebookCookies,
  buildCookieString,
  countCookies,
} from '@/utils/cookieHelper';

const { Option } = Select;
const { TextArea } = Input;

export interface QuickCookieAccount {
  id: number;
  platformAccountId: string;
  pageName?: string;
  platform: string;
  accountType?: string;
  accessToken?: string;
  tokenStatus?: string;
  postingIdentityAccountId?: number;
}

interface QuickUpdateCookieModalProps {
  open: boolean;
  onClose: () => void;
  targetAccountId?: number;
  accounts?: QuickCookieAccount[];
  onSuccess?: () => void;
}

export function extractCookieFields(rawStr: string, defaultCUser: string = '') {
  return parseAllFacebookCookies(rawStr, defaultCUser);
}

export const QuickUpdateCookieModal: React.FC<QuickUpdateCookieModalProps> = ({
  open,
  onClose,
  targetAccountId,
  accounts: externalAccounts,
  onSuccess,
}) => {
  const queryClient = useQueryClient();
  const [selectedAccountId, setSelectedAccountId] = useState<number | undefined>(targetAccountId);
  const [inputMode, setInputMode] = useState<'COLUMNS' | 'RAW'>('COLUMNS');
  const [rawCookieInput, setRawCookieInput] = useState<string>('');
  const [cookies, setCookies] = useState<FacebookCookies>({ ...INITIAL_FACEBOOK_COOKIES, extraPairs: {} });

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

  // Load existing cookies of account if available
  useEffect(() => {
    if (open && currentAccount?.accessToken) {
      const parsed = parseAllFacebookCookies(currentAccount.accessToken, existingCUser);
      setCookies(parsed.cookies);
      setRawCookieInput(currentAccount.accessToken);
    }
  }, [open, currentAccount?.id]);

  // Khởi tạo account khi mở modal
  useEffect(() => {
    if (open) {
      if (targetAccountId) {
        setSelectedAccountId(targetAccountId);
      } else if (expiredAccounts.length > 0) {
        setSelectedAccountId(expiredAccounts[0].id);
      } else if (cookieAccounts.length > 0) {
        setSelectedAccountId(cookieAccounts[0].id);
      }
    }
  }, [open, targetAccountId, expiredAccounts.length, cookieAccounts.length]);

  const updateCookieField = (field: keyof FacebookCookies, val: string) => {
    setCookies((prev) => {
      const next = { ...prev, [field]: val.trim() };
      return next;
    });
  };

  // Tính toán chuỗi đầy đủ và tính hợp lệ theo thời gian thực
  const parsedData = useMemo(() => {
    if (inputMode === 'RAW') {
      return parseAllFacebookCookies(rawCookieInput, existingCUser);
    } else {
      const full = buildCookieString(cookies);
      const isValid = Boolean(cookies.cUser && cookies.xs);
      const count = countCookies(cookies);
      const hasSecuritySuite = Boolean(cookies.cUser && cookies.xs && (cookies.datr || cookies.sb));
      return {
        cookies,
        isValid,
        fullCookie: full,
        count,
        hasSecuritySuite,
      };
    }
  }, [inputMode, rawCookieInput, cookies, existingCUser]);

  const targetCUser = parsedData.cookies.cUser || existingCUser;
  const linkedAccounts = useMemo(() => {
    if (!targetCUser) return [];
    return allAccounts.filter((a) => {
      const aCUser = parseAllFacebookCookies(a.accessToken || '').cookies.cUser || (a.platformAccountId?.match(/^\d+$/) ? a.platformAccountId : '');
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

  const handlePasteClipboardToColumns = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        message.warning('Clipboard rỗng!');
        return;
      }
      const parsed = parseAllFacebookCookies(text, existingCUser);
      setCookies(parsed.cookies);
      setRawCookieInput(text);
      if (parsed.isValid) {
        message.success(`Đã tự động phân tách và điền vào các cột: ${parsed.count} cookie (c_user: ${parsed.cookies.cUser})!`);
      } else {
        message.info(`Đã điền ${parsed.count} trường từ Clipboard. Vui lòng kiểm tra lại.`);
      }
    } catch {
      message.error('Không thể đọc Clipboard! Vui lòng dán thủ công Ctrl+V.');
    }
  };

  const handleClearAll = () => {
    setCookies({ ...INITIAL_FACEBOOK_COOKIES, extraPairs: {} });
    setRawCookieInput('');
    message.info('Đã làm trống toàn bộ các cột cookie');
  };

  const handleSave = () => {
    if (!selectedAccountId) {
      message.error('Vui lòng chọn tài khoản cần cập nhật!');
      return;
    }
    if (!parsedData.isValid) {
      message.error('Bắt buộc phải có ít nhất c_user (UID) và xs (Mã phiên)!');
      return;
    }

    const finalCookie = parsedData.fullCookie;
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
      width={740}
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
              <div className="qcm-title-text">Cập nhật Cookie</div>
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
            Tài khoản
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
                  Bài đăng bằng cookie này sẽ lỗi cho tới khi cập nhật.
                </p>
              </div>
            }
            className="qcm-alert"
          />
        ) : null}

        {/* Banner thông báo tự động đồng bộ theo Nick Via */}
        {targetCUser && linkedAccounts.length > 1 && (
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <ThunderboltOutlined className="text-amber-400" />
            <span title={linkedAccounts.map(a => a.pageName || a.platformAccountId).join(', ')}>
              Áp dụng luôn cho {linkedAccounts.length} Page & Nhóm dùng nick này
            </span>
          </div>
        )}

        {/* Chế độ nhập */}
        <Flex align="center" justify="space-between" className="qcm-mode-row">
          <Segmented
            value={inputMode}
            onChange={(val) => {
              const newMode = val as 'COLUMNS' | 'RAW';
              if (newMode === 'RAW' && inputMode === 'COLUMNS') {
                setRawCookieInput(buildCookieString(cookies));
              } else if (newMode === 'COLUMNS' && inputMode === 'RAW') {
                const parsed = parseAllFacebookCookies(rawCookieInput, existingCUser);
                setCookies(parsed.cookies);
              }
              setInputMode(newMode);
            }}
            options={[
              { label: 'Từng cột', value: 'COLUMNS' },
              { label: 'Dán chuỗi', value: 'RAW' },
            ]}
            className="qcm-mode"
          />
          {inputMode === 'COLUMNS' && (
            <Flex gap={8}>
              <Button
                type="dashed"
                size="small"
                icon={<CopyOutlined />}
                onClick={handlePasteClipboardToColumns}
                className="qcm-paste-btn"
              >
                Dán tự động
              </Button>
              <Button
                size="small"
                icon={<ClearOutlined />}
                onClick={handleClearAll}
                danger
              >
                Làm trống
              </Button>
            </Flex>
          )}
        </Flex>

        {/* GIAO DIỆN NHẬP TỪNG CỘT */}
        {inputMode === 'COLUMNS' ? (
          <div className="space-y-4 max-h-[380px] overflow-y-auto pr-1">
            {/* TẦNG 1: BẮT BUỘC */}
            <div className="p-3 rounded-xl border border-blue-500/30 bg-blue-950/20 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-300">Bắt buộc</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-300 font-semibold mb-1 block">
                    <code title="UID Facebook">c_user</code>
                  </label>
                  <Input
                    value={cookies.cUser}
                    onChange={(e) => updateCookieField('cUser', e.target.value)}
                    placeholder="VD: 100023403136194"
                    className="font-mono text-xs rounded-lg bg-slate-900/90 border-slate-700"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-semibold mb-1 block">
                    <code title="Session Token">xs</code>
                  </label>
                  <Input.Password
                    value={cookies.xs}
                    onChange={(e) => updateCookieField('xs', e.target.value)}
                    placeholder="VD: 49%3A8J7wSQZ3Key3BA..."
                    className="font-mono text-xs rounded-lg bg-slate-900/90 border-slate-700"
                  />
                </div>
              </div>
            </div>

            {/* TẦNG 2: KHÁNG CHECKPOINT THIẾT BỊ (CỰC KỲ QUAN TRỌNG) */}
            <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-300">Chống checkpoint (nên có)</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-300 font-semibold mb-1 flex items-center justify-between">
                    <Tooltip title="Nhận diện thiết bị quen thuộc, giúp không bị văng phiên khi đổi máy">
                      <code>datr</code>
                    </Tooltip>
                  </label>
                  <Input
                    value={cookies.datr}
                    onChange={(e) => updateCookieField('datr', e.target.value)}
                    placeholder="VD: imv2alUXVRr_X1icflr8cOaL"
                    className="font-mono text-xs rounded-lg bg-slate-900/90 border-slate-700"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-semibold mb-1 flex items-center justify-between">
                    <Tooltip title="Ràng buộc phiên đăng nhập với trình duyệt">
                      <code>sb</code>
                    </Tooltip>
                  </label>
                  <Input
                    value={cookies.sb}
                    onChange={(e) => updateCookieField('sb', e.target.value)}
                    placeholder="VD: f1kNaidyOexVUhTEy37sYHde"
                    className="font-mono text-xs rounded-lg bg-slate-900/90 border-slate-700"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-semibold mb-1 block">
                    <code title="Mã bảo mật phiên">fr</code>
                  </label>
                  <Input.Password
                    value={cookies.fr}
                    onChange={(e) => updateCookieField('fr', e.target.value)}
                    placeholder="VD: 1MB8n8sM0txfPht2c.AWfb..."
                    className="font-mono text-xs rounded-lg bg-slate-900/90 border-slate-700"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-semibold mb-1 block">
                    <code title="Kích thước màn hình">wd</code>
                  </label>
                  <Input
                    value={cookies.wd}
                    onChange={(e) => updateCookieField('wd', e.target.value)}
                    placeholder="VD: 440x956 hoặc 1920x1080"
                    className="font-mono text-xs rounded-lg bg-slate-900/90 border-slate-700"
                  />
                </div>
              </div>
            </div>

            {/* TẦNG 3: CÁC THÔNG SỐ BỔ SUNG TRONG DEVTOOLS */}
            <Collapse
              ghost
              size="small"
              className="border border-slate-800 rounded-xl bg-slate-900/40"
              items={[
                {
                  key: 'extra',
                  label: (
                    <span className="text-xs text-slate-300 font-semibold flex items-center gap-2">
                      <span>Thêm (dpr, locale, vpd…) · không bắt buộc</span>
                    </span>
                  ),
                  children: (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">
                          <code>locale</code> (Ngôn ngữ):
                        </label>
                        <Input
                          value={cookies.locale}
                          onChange={(e) => updateCookieField('locale', e.target.value)}
                          placeholder="VD: vi_VN hoặc en_US"
                          className="font-mono text-xs rounded-lg bg-slate-900 border-slate-700"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">
                          <code>vpd</code> (Viewport dimension):
                        </label>
                        <Input
                          value={cookies.vpd}
                          onChange={(e) => updateCookieField('vpd', e.target.value)}
                          placeholder="VD: v1%3B956x440x3"
                          className="font-mono text-xs rounded-lg bg-slate-900 border-slate-700"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">
                          <code>dpr</code> (Device Pixel Ratio):
                        </label>
                        <Input
                          value={cookies.dpr}
                          onChange={(e) => updateCookieField('dpr', e.target.value)}
                          placeholder="VD: 2"
                          className="font-mono text-xs rounded-lg bg-slate-900 border-slate-700"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">
                          <code>presence</code> (Thời gian online):
                        </label>
                        <Input
                          value={cookies.presence}
                          onChange={(e) => updateCookieField('presence', e.target.value)}
                          placeholder="VD: C%7B%22t3%22..."
                          className="font-mono text-xs rounded-lg bg-slate-900 border-slate-700"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">
                          <code>pas</code> (Account pass):
                        </label>
                        <Input
                          value={cookies.pas}
                          onChange={(e) => updateCookieField('pas', e.target.value)}
                          placeholder="VD: 100023403136194%3AaZlr..."
                          className="font-mono text-xs rounded-lg bg-slate-900 border-slate-700"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">
                          <code>wl_cbv</code> (Client version):
                        </label>
                        <Input
                          value={cookies.wl_cbv}
                          onChange={(e) => updateCookieField('wl_cbv', e.target.value)}
                          placeholder="VD: v2%3Bclient_version%3A3..."
                          className="font-mono text-xs rounded-lg bg-slate-900 border-slate-700"
                        />
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        ) : (
          <div className="qcm-stack-2">
            <Flex align="center" justify="space-between">
              <span className="qcm-field-label">Dán toàn bộ chuỗi Cookie Facebook vào đây:</span>
              <Button
                type="dashed"
                size="small"
                icon={<CopyOutlined />}
                onClick={handlePasteClipboardToColumns}
                className="qcm-paste-btn"
              >
                📋 Dán từ Clipboard
              </Button>
            </Flex>
            <TextArea
              rows={5}
              value={rawCookieInput}
              onChange={(e) => setRawCookieInput(e.target.value)}
              placeholder="Dán toàn bộ chuỗi cookie từ DevTools hoặc Extension (VD: c_user=1000...; xs=...; datr=...; sb=...; fr=...; wd=...)"
              className="qcm-textarea font-mono text-xs"
              autoFocus
            />
            <div className="qcm-hint-row">
              <span>Tự nhận c_user, xs, datr, sb, fr, wd…</span>
            </div>
          </div>
        )}

        {/* Kết quả nhận diện Cookie thời gian thực */}
        <div className="qcm-preview p-3 rounded-xl bg-slate-900/80 border border-slate-800">
          <Flex align="center" justify="space-between" className="qcm-preview-head mb-2">
            <span className="qcm-preview-title text-xs font-semibold text-slate-300">
              <Tag color="blue">{parsedData.count} cookie</Tag>
            </span>
            {parsedData.hasSecuritySuite ? (
              <Tag icon={<CheckCircleOutlined />} color="success" className="qcm-pill-bold">
                Đủ chống checkpoint
              </Tag>
            ) : parsedData.isValid ? (
              <Tag icon={<WarningOutlined />} color="warning" className="qcm-pill-bold">
                Nên thêm datr, sb
              </Tag>
            ) : (
              <Tag icon={<WarningOutlined />} color="error" className="qcm-pill-bold">
                Chưa đủ c_user & xs
              </Tag>
            )}
          </Flex>

          <div className="flex flex-wrap gap-1.5 pt-1">
            <Tag color={parsedData.cookies.cUser ? 'blue' : 'default'} className="font-mono text-xs">
              c_user: {parsedData.cookies.cUser ? `${parsedData.cookies.cUser}` : 'Chưa có'}
            </Tag>
            <Tag color={parsedData.cookies.xs ? 'blue' : 'default'} className="font-mono text-xs">
              xs: {parsedData.cookies.xs ? 'OK' : 'Chưa có'}
            </Tag>
            <Tag color={parsedData.cookies.datr ? 'green' : 'default'} className="font-mono text-xs">
              datr: {parsedData.cookies.datr ? 'OK' : 'Chưa có'}
            </Tag>
            <Tag color={parsedData.cookies.sb ? 'green' : 'default'} className="font-mono text-xs">
              sb: {parsedData.cookies.sb ? 'OK' : 'Chưa có'}
            </Tag>
            <Tag color={parsedData.cookies.fr ? 'cyan' : 'default'} className="font-mono text-xs">
              fr: {parsedData.cookies.fr ? 'OK' : 'Chưa có'}
            </Tag>
            <Tag color={parsedData.cookies.wd ? 'cyan' : 'default'} className="font-mono text-xs">
              wd: {parsedData.cookies.wd ? `${parsedData.cookies.wd}` : 'Chưa có'}
            </Tag>
            {parsedData.cookies.locale && (
              <Tag color="purple" className="font-mono text-xs">locale: {parsedData.cookies.locale}</Tag>
            )}
            {parsedData.cookies.vpd && (
              <Tag color="purple" className="font-mono text-xs">vpd: OK</Tag>
            )}
            {parsedData.cookies.dpr && (
              <Tag color="purple" className="font-mono text-xs">dpr: {parsedData.cookies.dpr}</Tag>
            )}
          </div>
        </div>

        {/* Nút hành động */}
        <div className="qcm-footer pt-2">
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
            Lưu
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default QuickUpdateCookieModal;
