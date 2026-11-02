import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Empty, Modal, Spin, Tag, Flex } from 'antd';
import { LinkOutlined, LoadingOutlined, LoginOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import api from '../../config/axios';
import type { FacebookPageAccess, FacebookPageScanResult, SocialAccount } from '../../pages/Connections';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Có thì là đăng nhập lại đúng nick (c_user) của kết nối này. */
  reloginAccount?: SocialAccount | null;
  /** Toàn bộ kết nối hiện có — để đánh dấu Page đã kết nối. */
  accounts: SocialAccount[];
}

type LoginState = {
  id: string;
  status: string;
  message?: string;
  account?: SocialAccount;
  created?: boolean;
  updatedCount?: number;
};

const INVALID_PAGE_NAMES = /^(?:thông báo|tin nhắn|bảng feed|trang chủ|home|notifications|inbox|messages|bảng tin|reels|stories|quản lý trang|xem tất cả|cài đặt|chọn trang|menu)$/i;

const errMsg = (err: any, fallback: string) =>
  err?.response?.data?.message || err?.response?.data?.detail || err?.message || fallback;

const FacebookBrowserLoginModal = ({ open, onClose, reloginAccount, accounts }: Props) => {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const pollRef = useRef<number | null>(null);
  const [login, setLogin] = useState<LoginState | null>(null);
  const [starting, setStarting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [pages, setPages] = useState<FacebookPageAccess[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const connectedPageIds = useMemo(
    () => new Set(accounts.filter((a) => a.platform === 'FACEBOOK_PAGE').map((a) => String(a.platformAccountId))),
    [accounts],
  );

  const stopPolling = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };

  useEffect(() => () => stopPolling(), []);

  const reset = () => {
    stopPolling();
    setLogin(null);
    setPages(null);
    setSelected([]);
    setScanError(null);
    setScanning(false);
  };

  const close = () => {
    if (login?.status === 'WAITING') api.post(`/connections/fb-login/${login.id}/cancel`).catch(() => {});
    reset();
    onClose();
  };

  const scanPages = async (via: SocialAccount) => {
    setScanning(true);
    setScanError(null);
    try {
      const res = await api.post(`/connections/${via.id}/scan-managed-pages`, { verifyEachPage: true });
      const result = res.data as FacebookPageScanResult;
      const list = (result.pages || []).filter((p) => {
        const id = (p.pageId || '').trim();
        if (!/^\d+$/.test(id) || id === via.platformAccountId) return false;
        if (INVALID_PAGE_NAMES.test((p.pageName || '').trim())) return false;
        if (p.pageUrl && (p.pageUrl.includes('/latest/inbox') || p.pageUrl.includes('/reel/'))) return false;
        return p.verificationStatus !== 'NO_ACCESS' && p.verificationStatus !== 'SESSION_INVALID';
      });
      setPages(list);
      setSelected(list.filter((p) => !connectedPageIds.has(p.pageId)).map((p) => p.pageId));
      queryClient.invalidateQueries({ queryKey: ['managedFacebookPages'] });
    } catch (err) {
      setScanError(errMsg(err, 'Không quét được danh sách Page của nick này.'));
    } finally {
      setScanning(false);
    }
  };

  const startLogin = async () => {
    reset();
    setStarting(true);
    try {
      const res = await api.post('/connections/fb-login/start', reloginAccount ? { accountId: reloginAccount.id } : {});
      const id = res.data?.sessionId;
      setLogin({ id, status: 'WAITING', message: 'Đang mở cửa sổ Chrome…' });
      pollRef.current = window.setInterval(async () => {
        try {
          const st = (await api.get(`/connections/fb-login/${id}`)).data;
          setLogin({ id, status: st.status, message: st.message, account: st.account, created: st.created, updatedCount: st.updatedCount });
          if (st.status !== 'WAITING') {
            stopPolling();
            if (st.status === 'SUCCESS' && st.account) {
              queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
              message.success(st.created ? 'Đã thêm nick Facebook mới.' : `Đã cập nhật cookie cho ${st.updatedCount || 0} kết nối cùng UID.`);
              scanPages(st.account);
            }
          }
        } catch { /* thử lại ở lượt sau */ }
      }, 2000);
    } catch (err) {
      message.error(errMsg(err, 'Không mở được cửa sổ đăng nhập'));
    } finally {
      setStarting(false);
    }
  };

  const createConnections = async () => {
    const via = login?.account;
    if (!via || selected.length === 0) return;
    setCreating(true);
    let ok = 0;
    for (const pageId of selected) {
      const page = pages?.find((p) => p.pageId === pageId);
      try {
        await api.post('/connections', {
          platform: 'FACEBOOK_PAGE',
          platformAccountId: pageId,
          pageName: page?.pageName,
          accountType: 'PERSONAL_COOKIE',
          accessToken: via.accessToken,
          postingIdentityAccountId: via.id,
          tokenStatus: 'OK',
          tokenCheckedAt: new Date().toISOString(),
        });
        ok++;
      } catch (err) {
        message.error(`${page?.pageName || pageId}: ${errMsg(err, 'không tạo được kết nối')}`);
      }
    }
    setCreating(false);
    queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    queryClient.invalidateQueries({ queryKey: ['managedFacebookPages'] });
    if (ok > 0) {
      message.success(`Đã tạo ${ok} kết nối Fanpage.`);
      close();
    }
  };

  const via = login?.status === 'SUCCESS' ? login.account : undefined;
  const title = reloginAccount
    ? `Đăng nhập lại ${reloginAccount.pageName || reloginAccount.platformAccountId}`
    : 'Đăng nhập Facebook';

  return (
    <Modal open={open} onCancel={close} footer={null} width={600} title={title} destroyOnHidden>
      <div className="fbl-body">
        {!via && (
          <>
            <ol className="fbl-steps">
              <li>Bấm nút bên dưới — một cửa sổ Chrome sẽ mở trên máy tính đang chạy hệ thống.</li>
              <li>Tự đăng nhập Facebook trong cửa sổ đó (gõ tài khoản, mật khẩu, mã 2FA nếu có).</li>
              <li>Đăng nhập xong, hệ thống tự lấy cookie và lưu nick — không cần copy gì cả.</li>
            </ol>
            {login ? (
              <Alert
                showIcon
                type={login.status === 'WAITING' ? 'info' : 'warning'}
                icon={login.status === 'WAITING' ? <LoadingOutlined /> : undefined}
                message={login.message || 'Đang chờ…'}
                action={login.status !== 'WAITING'
                  ? <Button size="small" onClick={startLogin}>Thử lại</Button>
                  : <Button size="small" onClick={() => api.post(`/connections/fb-login/${login.id}/cancel`).catch(() => {})}>Huỷ</Button>}
              />
            ) : (
              <Button type="primary" block size="large" icon={<LoginOutlined />} loading={starting} onClick={startLogin}>
                Mở cửa sổ đăng nhập Facebook
              </Button>
            )}
            <div className="fbl-note">
              Mỗi nick có hồ sơ trình duyệt riêng trên máy, nên lần đăng nhập lại sau thường nhanh hơn. Hệ thống không lưu mật khẩu.
            </div>
          </>
        )}

        {via && (
          <>
            <Alert
              showIcon
              type="success"
              message={login?.message}
              description={login?.created
                ? `Đã thêm nick ${via.pageName || via.platformAccountId} (UID ${via.platformAccountId}).`
                : `Đã cập nhật cookie mới cho ${login?.updatedCount || 0} kết nối cùng UID ${via.platformAccountId}.`}
            />

            <Card variant="borderless" className="fbl-pages">
              <Flex align="center" justify="space-between" className="fbl-pages-head">
                <span className="fbl-pages-title">Chọn Page để tạo kết nối</span>
                <Button size="small" icon={<ReloadOutlined />} disabled={scanning} onClick={() => scanPages(via)}>
                  Quét lại
                </Button>
              </Flex>
              {scanning ? (
                <Flex align="center" gap={8} justify="center" className="fbl-loading">
                  <Spin size="small" /> Đang quét các Page mà nick này quản trị…
                </Flex>
              ) : scanError ? (
                <Alert type="warning" showIcon message={scanError} />
              ) : pages && pages.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không tìm thấy Page nào nick này quản trị" />
              ) : (
                <div className="fbl-page-list">
                  {(pages || []).map((p) => {
                    const connected = connectedPageIds.has(p.pageId);
                    return (
                      <label key={p.pageId} className="fbl-page-row">
                        <Checkbox
                          disabled={connected}
                          checked={connected || selected.includes(p.pageId)}
                          onChange={(e) => setSelected((cur) => e.target.checked ? [...cur, p.pageId] : cur.filter((x) => x !== p.pageId))}
                        />
                        <div className="fbl-page-main">
                          <div className="fbl-page-name">{p.pageName || p.pageId}</div>
                          <div className="fbl-page-id">{p.pageId}</div>
                        </div>
                        {connected && <Tag className="fbl-mr0">Đã có kết nối</Tag>}
                        {p.pageUrl && (
                          <Button type="link" size="small" href={p.pageUrl} target="_blank" rel="noreferrer" icon={<LinkOutlined />} />
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </Card>

            <Flex justify="flex-end" gap={8} className="fbl-actions">
              <Button onClick={close}>Xong</Button>
              <Button type="primary" disabled={selected.length === 0 || scanning} loading={creating} onClick={createConnections}>
                Tạo kết nối cho {selected.length} Page
              </Button>
            </Flex>
          </>
        )}
      </div>
    </Modal>
  );
};

export default FacebookBrowserLoginModal;
