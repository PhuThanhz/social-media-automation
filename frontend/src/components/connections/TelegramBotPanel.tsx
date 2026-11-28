import { useState } from 'react';
import { App, Badge, Button, Input, Popconfirm, Switch } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../config/axios';

interface TelegramConfig {
  enabled: boolean;
  hasToken: boolean;
  tokenMasked: string;
  botUsername?: string | null;
  legacyBotUsername?: string | null;
  chats: { id: number; name: string }[];
  pairCode?: string | null;
  pairExpiresAt?: string | null;
  running: boolean;
  lastError?: string | null;
  lastPollOkAt?: string | null;
}

const errorText = (err: unknown) => {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message || e?.message || 'Có lỗi xảy ra';
};

/** Cấu hình bot Telegram điều khiển tool (gửi link, xem lịch, xử lý bài lỗi, tạm dừng nick). */
export default function TelegramBotPanel() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [tokenInput, setTokenInput] = useState('');
  const [editingToken, setEditingToken] = useState(false);

  const { data: cfg, isLoading } = useQuery({
    queryKey: ['telegramConfig'],
    queryFn: async () => (await api.get('/telegram/config')).data as TelegramConfig,
    // Đang chờ ghép nối thì hỏi nhanh để hiện chat mới ngay khi người dùng gửi /start
    refetchInterval: (q) => ((q.state.data as TelegramConfig | undefined)?.pairCode ? 3000 : 15000),
  });

  const setData = (data: TelegramConfig) => queryClient.setQueryData(['telegramConfig'], data);

  const saveToken = useMutation({
    mutationFn: async () => (await api.put('/telegram/config', { botToken: tokenInput.trim() })).data as TelegramConfig,
    onSuccess: (data) => {
      setData(data);
      setTokenInput('');
      setEditingToken(false);
      message.success(`Đã kết nối bot @${data.botUsername || ''}`);
    },
    onError: (err) => message.error(errorText(err)),
  });

  const useLegacy = useMutation({
    mutationFn: async () => (await api.post('/telegram/config/use-legacy')).data as TelegramConfig,
    onSuccess: (data) => {
      setData(data);
      message.success(`Đã kết nối bot @${data.botUsername || ''}`);
    },
    onError: (err) => message.error(errorText(err)),
  });

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => (await api.put('/telegram/config', { enabled })).data as TelegramConfig,
    onSuccess: setData,
    onError: (err) => message.error(errorText(err)),
  });

  const pair = useMutation({
    mutationFn: async () => (await api.post('/telegram/pair-code')).data as TelegramConfig,
    onSuccess: setData,
    onError: (err) => message.error(errorText(err)),
  });

  const removeChat = useMutation({
    mutationFn: async (chatId: number) => (await api.delete(`/telegram/chats/${chatId}`)).data as TelegramConfig,
    onSuccess: setData,
    onError: (err) => message.error(errorText(err)),
  });

  const clearToken = useMutation({
    mutationFn: async () => (await api.delete('/telegram/config/token')).data as TelegramConfig,
    onSuccess: (data) => {
      setData(data);
      message.success('Đã gỡ bot token');
    },
    onError: (err) => message.error(errorText(err)),
  });

  const test = useMutation({
    mutationFn: async () => (await api.post('/telegram/test')).data as { message: string },
    onSuccess: (data) => message.success(data.message),
    onError: (err) => message.error(errorText(err)),
  });

  if (isLoading || !cfg) {
    return <div className="app-surface tg-panel">Đang tải…</div>;
  }

  const showTokenInput = !cfg.hasToken || editingToken;
  const expiresAt = cfg.pairExpiresAt ? new Date(cfg.pairExpiresAt) : null;
  const status = !cfg.hasToken
    ? { color: 'default' as const, text: 'Chưa có token' }
    : !cfg.enabled
      ? { color: 'default' as const, text: 'Đang tắt' }
      : cfg.lastError
        ? { color: 'error' as const, text: 'Lỗi kết nối' }
        : cfg.running
          ? { color: 'success' as const, text: 'Đang nhận lệnh' }
          : { color: 'processing' as const, text: 'Đang khởi động' };

  return (
    <div className="app-surface tg-panel">
      <div className="tg-head">
        <h3>Telegram bot</h3>
        <p>
          Điều khiển tool từ điện thoại: gửi link cho bot để thêm bài vào hàng đợi, xem lịch đăng (/lich), thống kê (/hangdoi),
          thử lại hoặc xoá bài lỗi (/loi), tạm dừng / chạy lại nick (/nick). Bot nhắn lại khi bài tạo từ Telegram đăng xong.
        </p>
      </div>

      <div className="tg-row">
        <label>Bot token</label>
        <div className="tg-control">
          {showTokenInput ? (
            <>
              <Input.Password
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="123456789:AAH... (lấy từ @BotFather)"
                className="tg-token-input"
                onPressEnter={() => tokenInput.trim() && saveToken.mutate()}
                autoComplete="off"
              />
              <Button type="primary" loading={saveToken.isPending} disabled={!tokenInput.trim()} onClick={() => saveToken.mutate()}>
                Lưu
              </Button>
              {cfg.hasToken && <Button onClick={() => setEditingToken(false)}>Huỷ</Button>}
              {!cfg.hasToken && cfg.legacyBotUsername != null && (
                <Button loading={useLegacy.isPending} onClick={() => useLegacy.mutate()}>
                  Dùng bot đã cấu hình trước{cfg.legacyBotUsername ? ` (@${cfg.legacyBotUsername})` : ''}
                </Button>
              )}
            </>
          ) : (
            <>
              <span className="tg-value">
                {cfg.botUsername ? (
                  <a href={`https://t.me/${cfg.botUsername}`} target="_blank" rel="noreferrer">@{cfg.botUsername}</a>
                ) : 'Bot'}
                <span className="tg-mono">{cfg.tokenMasked}</span>
              </span>
              <Button size="small" onClick={() => setEditingToken(true)}>Đổi token</Button>
              <Popconfirm
                title="Gỡ bot token?"
                description="Bot sẽ ngừng nhận lệnh. Danh sách chat đã ghép vẫn được giữ."
                okText="Gỡ"
                cancelText="Thôi"
                onConfirm={() => clearToken.mutate()}
              >
                <Button size="small" type="text" danger loading={clearToken.isPending}>Gỡ</Button>
              </Popconfirm>
            </>
          )}
        </div>
      </div>

      <div className="tg-row">
        <label>Trạng thái</label>
        <div className="tg-control">
          <Switch
            checked={cfg.enabled}
            disabled={!cfg.hasToken}
            loading={toggle.isPending}
            onChange={(v) => toggle.mutate(v)}
          />
          <Badge status={status.color} text={status.text} />
          {cfg.enabled && cfg.lastError && <span className="tg-error">{cfg.lastError}</span>}
        </div>
      </div>

      <div className="tg-row">
        <label>Ghép nối chat</label>
        <div className="tg-control tg-control-col">
          {cfg.pairCode ? (
            <>
              <div className="tg-control">
                <span className="tg-code">{cfg.pairCode}</span>
                {cfg.botUsername && (
                  <Button type="primary" href={`https://t.me/${cfg.botUsername}?start=${cfg.pairCode}`} target="_blank">
                    Mở Telegram để ghép
                  </Button>
                )}
              </div>
              <span className="tg-help">
                Hoặc gửi <span className="tg-mono">/start {cfg.pairCode}</span> cho bot
                {expiresAt && ` — mã hết hạn lúc ${expiresAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`}.
                Chỉ chat đã ghép mới ra lệnh được.
              </span>
            </>
          ) : (
            <>
              <Button disabled={!cfg.hasToken} loading={pair.isPending} onClick={() => pair.mutate()}>
                Tạo mã ghép nối
              </Button>
              <span className="tg-help">Mã 6 số, dùng 1 lần, hết hạn sau 10 phút.</span>
            </>
          )}
        </div>
      </div>

      <div className="tg-row">
        <label>Chat đã ghép</label>
        <div className="tg-control tg-control-col">
          {cfg.chats.length === 0 ? (
            <span className="tg-help">Chưa có chat nào.</span>
          ) : (
            cfg.chats.map((c) => (
              <div key={c.id} className="tg-chat">
                <span>{c.name}</span>
                <span className="tg-mono">{c.id}</span>
                <Popconfirm
                  title="Gỡ chat này?"
                  description="Chat sẽ không điều khiển tool được nữa."
                  okText="Gỡ"
                  cancelText="Thôi"
                  onConfirm={() => removeChat.mutate(c.id)}
                >
                  <Button size="small" type="text" danger>Gỡ</Button>
                </Popconfirm>
              </div>
            ))
          )}
          {cfg.chats.length > 0 && (
            <Button size="small" className="tg-test" loading={test.isPending} disabled={!cfg.enabled} onClick={() => test.mutate()}>
              Gửi tin thử
            </Button>
          )}
        </div>
      </div>

      <div className="tg-row tg-row-last">
        <label>Cách tạo bot</label>
        <ol className="tg-steps">
          <li>Trong Telegram mở <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>, gửi <span className="tg-mono">/newbot</span>, đặt tên — BotFather trả về token.</li>
          <li>Dán token vào ô Bot token ở trên rồi bấm Lưu.</li>
          <li>Bấm Tạo mã ghép nối, rồi gửi mã cho bot. Xong — gửi link bài cho bot để đăng.</li>
        </ol>
      </div>
    </div>
  );
}
