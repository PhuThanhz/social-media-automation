import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Input, Button, Badge, Popconfirm, message } from 'antd';
import { ThunderboltOutlined, ReloadOutlined, PlusOutlined } from '@ant-design/icons';
import api from '../../config/axios';

interface AiSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export interface KeyHealthItem {
  key: string;
  masked: string;
  status: 'HEALTHY' | 'RATE_LIMITED' | 'INVALID' | 'ERROR' | 'EMPTY';
  message: string;
  callsToday: number;
  dailyLimitEstimate: number;
}

export const STORAGE_KEYS = [
  'toolzutter_gemini_api_key',
  'newsCardStudio.geminiKey',
  'gemini_api_keys',
];

export const getStoredGeminiKeys = (): string => {
  for (const k of STORAGE_KEYS) {
    const val = localStorage.getItem(k);
    if (val && val.trim()) return val.trim();
  }
  return '';
};

export const saveStoredGeminiKeys = (val: string) => {
  const trimmed = val.trim();
  STORAGE_KEYS.forEach((k) => {
    if (trimmed) {
      localStorage.setItem(k, trimmed);
    } else {
      localStorage.removeItem(k);
    }
  });
  window.dispatchEvent(new CustomEvent('gemini-keys-changed', { detail: trimmed }));
};

/** Tách chuỗi key (mỗi dòng / dấu phẩy / chấm phẩy 1 key), bỏ trùng — cùng quy tắc với backend parseKeys. */
const splitKeys = (raw: string): string[] =>
  Array.from(new Set(raw.split(/[\n\r,;\s]+/).map((k) => k.trim()).filter(Boolean)));

const maskKey = (k: string) => (k.length > 12 ? `${k.slice(0, 6)}…${k.slice(-4)}` : k);

const DAILY_LIMIT = 1500;

const statusView = (item: KeyHealthItem | undefined, checking: boolean) => {
  if (!item) {
    return { badge: 'default' as const, text: checking ? 'Đang kiểm tra…' : 'Chưa kiểm tra', bad: false };
  }
  switch (item.status) {
    case 'HEALTHY':
      return { badge: 'success' as const, text: 'Hoạt động', bad: false };
    case 'RATE_LIMITED':
      return { badge: 'warning' as const, text: 'Hết lượt hôm nay', bad: false };
    case 'INVALID':
    case 'ERROR':
      return { badge: 'error' as const, text: 'Không dùng được', bad: true };
    default:
      return { badge: 'default' as const, text: 'Chưa kiểm tra', bad: false };
  }
};

const AiSettingsModal: React.FC<AiSettingsModalProps> = ({ open, onClose }) => {
  const [keys, setKeys] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [keyHealthList, setKeyHealthList] = useState<KeyHealthItem[]>([]);
  const [checking, setChecking] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchHealthCheck = async (list: string[]) => {
    if (list.length === 0) {
      setKeyHealthList([]);
      return;
    }
    setChecking(true);
    try {
      const res = await api.post('/news-card/check-keys', { apiKey: list.join('\n') });
      if (res.data?.success && Array.isArray(res.data.results)) {
        setKeyHealthList(res.data.results);
      }
    } catch (e: any) {
      console.error('Lỗi kiểm tra trạng thái key:', e);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (open) {
      const stored = splitKeys(getStoredGeminiKeys());
      setKeys(stored);
      setDraft('');
      setTestResult(null);
      setKeyHealthList([]);
      fetchHealthCheck(stored);
    }
  }, [open]);

  const persist = (next: string[]) => {
    setKeys(next);
    saveStoredGeminiKeys(next.join('\n'));
    setTestResult(null);
    setKeyHealthList([]);
    fetchHealthCheck(next);
  };

  const draftKeys = useMemo(() => splitKeys(draft), [draft]);

  const handleAdd = () => {
    if (draftKeys.length === 0) return;
    const tooShort = draftKeys.filter((k) => k.length < 20);
    if (tooShort.length > 0) {
      message.warning('Key có vẻ chưa đầy đủ. Key Gemini thường bắt đầu bằng "AIza" và dài khoảng 39 ký tự.');
      return;
    }
    const fresh = draftKeys.filter((k) => !keys.includes(k));
    if (fresh.length === 0) {
      message.info('Key này đã có trong danh sách.');
      return;
    }
    persist([...keys, ...fresh]);
    setDraft('');
    message.success(fresh.length > 1 ? `Đã thêm ${fresh.length} key.` : 'Đã thêm key.');
  };

  const handleRemove = (key: string) => {
    persist(keys.filter((k) => k !== key));
    message.success('Đã xoá key.');
  };

  const handleTestQuickPrompt = async () => {
    if (keys.length === 0) {
      message.warning('Thêm ít nhất 1 key trước khi gọi thử.');
      return;
    }
    setChecking(true);
    setTestResult(null);
    try {
      const res = await api.post('/news-card/headline', {
        title: 'Kiểm tra kết nối hệ thống',
        content: 'Đây là bài kiểm tra phản hồi từ Google Gemini AI.',
        apiKey: keys.join('\n'),
      });
      if (res.data?.success && res.data?.headline) {
        setTestResult({ success: true, message: `AI trả lời được: "${res.data.headline.slice(0, 70)}"` });
        fetchHealthCheck(keys);
      } else {
        throw new Error(res.data?.error || 'AI không trả về kết quả');
      }
    } catch (e: any) {
      const errMsg = e.response?.data?.error || e.message || 'Lỗi không xác định';
      setTestResult({ success: false, message: `Gọi thử thất bại: ${errMsg}` });
    } finally {
      setChecking(false);
    }
  };

  // Kết quả check-keys trả về đúng thứ tự danh sách key (backend tách + bỏ trùng giống splitKeys).
  const healthOf = (idx: number) => keyHealthList[idx];
  const workingCount = keyHealthList.filter((k) => k.status === 'HEALTHY').length;
  const usedToday = keyHealthList.reduce((acc, k) => acc + (k.callsToday || 0), 0);

  return (
    <Modal
      title="Gemini API key"
      open={open}
      onCancel={onClose}
      width={620}
      footer={[
        <Button key="test" icon={<ThunderboltOutlined />} loading={checking} onClick={handleTestQuickPrompt} disabled={keys.length === 0}>
          Gọi thử AI
        </Button>,
        <Button key="refresh" icon={<ReloadOutlined />} loading={checking} onClick={() => fetchHealthCheck(keys)} disabled={keys.length === 0}>
          Kiểm tra lại
        </Button>,
        <Button key="close" onClick={onClose}>
          Đóng
        </Button>,
      ]}
    >
      <div className="aik">
        <p className="aik-intro">
          Key dùng chung cho mọi tính năng AI (viết lại bài, Studio Ảnh Tin, chấm điểm bài viral). Nên thêm 2–3 key:
          khi một key hết lượt trong ngày, hệ thống tự chuyển sang key khác.
        </p>

        <section className="aik-section">
          <h4 className="aik-heading">Thêm key mới</h4>
          <ol className="aik-steps">
            <li>
              Mở{' '}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
                aistudio.google.com/app/apikey
              </a>{' '}
              và đăng nhập tài khoản Google.
            </li>
            <li>
              Bấm <b>Create API key</b>, chọn <b>Create API key in new project</b>.
            </li>
            <li>Sao chép key (bắt đầu bằng <code>AIza</code>), dán vào ô dưới rồi bấm <b>Thêm key</b>.</li>
          </ol>
          <div className="aik-add">
            <Input.TextArea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              autoSize={{ minRows: 1, maxRows: 4 }}
              placeholder="Dán key vào đây (nhiều key thì mỗi dòng 1 key)"
              autoComplete="off"
              spellCheck={false}
              className="aik-input"
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} disabled={draftKeys.length === 0}>
              {draftKeys.length > 1 ? `Thêm ${draftKeys.length} key` : 'Thêm key'}
            </Button>
          </div>
        </section>

        <section className="aik-section">
          <div className="aik-heading-row">
            <h4 className="aik-heading">Key đang dùng ({keys.length})</h4>
            {keyHealthList.length > 0 && (
              <span className="aik-summary">
                {workingCount}/{keys.length} hoạt động · hôm nay đã gọi {usedToday.toLocaleString('vi-VN')} lượt
              </span>
            )}
          </div>

          {keys.length === 0 ? (
            <div className="aik-empty">Chưa có key nào. Thêm key ở trên để dùng các tính năng AI.</div>
          ) : (
            <ul className="aik-list">
              {keys.map((k, idx) => {
                const item = healthOf(idx);
                const view = statusView(item, checking);
                const used = item?.callsToday || 0;
                const limit = item?.dailyLimitEstimate || DAILY_LIMIT;
                return (
                  <li key={k} className="aik-row">
                    <div className="aik-row-main">
                      <span className="aik-index">{idx + 1}</span>
                      <code className="aik-key">{item?.masked || maskKey(k)}</code>
                      <Badge status={view.badge} text={view.text} className="aik-status" />
                      <span className="aik-usage">
                        {used.toLocaleString('vi-VN')}/{limit.toLocaleString('vi-VN')} lượt
                      </span>
                      <Popconfirm
                        title="Xoá key này?"
                        okText="Xoá"
                        cancelText="Huỷ"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => handleRemove(k)}
                      >
                        <Button type="text" size="small" danger>
                          Xoá
                        </Button>
                      </Popconfirm>
                    </div>
                    {view.bad && (
                      <div className="aik-row-note">
                        {(item?.message || 'Key không hợp lệ').replace(/[.\s]+$/, '')}. Nên xoá key này và thêm key khác.
                      </div>
                    )}
                    {item?.status === 'RATE_LIMITED' && (
                      <div className="aik-row-note aik-row-note-warn">
                        Đã hết lượt hôm nay, hệ thống đang dùng key khác. Lượt dùng được làm mới lúc 07:00 sáng.
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="aik-foot-note">Google làm mới lượt dùng miễn phí mỗi ngày lúc 07:00 sáng (khoảng 1.500 lượt/key).</div>
        </section>

        {testResult && (
          <div className={`aik-result ${testResult.success ? 'aik-result-ok' : 'aik-result-bad'}`}>{testResult.message}</div>
        )}
      </div>
    </Modal>
  );
};

export default AiSettingsModal;
