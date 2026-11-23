import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Input, Button, Badge, Popconfirm, Tooltip, Typography, message } from 'antd';
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

// Tên gợi nhớ của từng key — lưu riêng (không trộn vào chuỗi key mà các trang khác đọc qua getStoredGeminiKeys).
const NOTES_STORAGE_KEY = 'gemini_key_notes';
const loadNotes = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(NOTES_STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
};
const saveNotes = (notes: Record<string, string>) => localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));

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
      return { badge: 'warning' as const, text: 'Hết lượt', bad: false };
    case 'INVALID':
    case 'ERROR':
      return { badge: 'error' as const, text: 'Key lỗi', bad: true };
    default:
      return { badge: 'default' as const, text: 'Chưa kiểm tra', bad: false };
  }
};

const AiSettingsModal: React.FC<AiSettingsModalProps> = ({ open, onClose }) => {
  const [keys, setKeys] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
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
      setNotes(loadNotes());
      setDraft('');
      setDraftNote('');
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
    const note = draftNote.trim();
    if (note) {
      const nextNotes = { ...notes };
      fresh.forEach((k, i) => { nextNotes[k] = fresh.length > 1 ? `${note} ${i + 1}` : note; });
      setNotes(nextNotes);
      saveNotes(nextNotes);
    }
    persist([...keys, ...fresh]);
    setDraft('');
    setDraftNote('');
    message.success(fresh.length > 1 ? `Đã thêm ${fresh.length} key.` : 'Đã thêm key.');
  };

  const updateNote = (key: string, value: string) => {
    const nextNotes = { ...notes };
    if (value.trim()) nextNotes[key] = value.trim();
    else delete nextNotes[key];
    setNotes(nextNotes);
    saveNotes(nextNotes);
  };

  const handleRemove = (key: string) => {
    const nextNotes = { ...notes };
    delete nextNotes[key];
    setNotes(nextNotes);
    saveNotes(nextNotes);
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
        <section className="aik-section">
          <div className="aik-heading-row">
            <h4 className="aik-heading">Thêm key</h4>
            <a className="aik-get-link" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
              Lấy key miễn phí
            </a>
          </div>
          <div className="aik-add">
            <Input
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder="Tên gợi nhớ"
              maxLength={40}
              className="aik-note-input"
            />
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
              placeholder="Dán key AIza…"
              autoComplete="off"
              spellCheck={false}
              className="aik-input"
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} disabled={draftKeys.length === 0}>
              {draftKeys.length > 1 ? `Thêm ${draftKeys.length}` : 'Thêm'}
            </Button>
          </div>
        </section>

        <section className="aik-section">
          <div className="aik-heading-row">
            <h4 className="aik-heading">Key đang dùng ({keys.length})</h4>
            {keyHealthList.length > 0 && (
              <span className="aik-summary">
                {workingCount}/{keys.length} hoạt động · {usedToday.toLocaleString('vi-VN')} lượt hôm nay
              </span>
            )}
          </div>

          {keys.length === 0 ? (
            <div className="aik-empty">Chưa có key nào.</div>
          ) : (
            <ul className="aik-list">
              {keys.map((k, idx) => {
                const item = healthOf(idx);
                const view = statusView(item, checking);
                const used = item?.callsToday || 0;
                const limit = item?.dailyLimitEstimate || DAILY_LIMIT;
                return (
                  <li key={k} className="aik-row">
                    <Typography.Text
                      className={`aik-note ${notes[k] ? '' : 'aik-note-empty'}`}
                      editable={{
                        text: notes[k] || '',
                        onChange: (v) => updateNote(k, v),
                        // Bôi đen sẵn tên cũ để gõ là thay luôn
                        onStart: () => setTimeout(() => (document.activeElement as HTMLTextAreaElement | null)?.select?.(), 0),
                        maxLength: 40,
                        triggerType: ['text', 'icon'],
                        tooltip: 'Đặt tên',
                      }}
                    >
                      {notes[k] || `Key ${idx + 1}`}
                    </Typography.Text>
                    <code className="aik-key">{item?.masked || maskKey(k)}</code>
                    <Tooltip title={view.bad || item?.status === 'RATE_LIMITED' ? item?.message : undefined}>
                      <Badge status={view.badge} text={view.text} className="aik-status" />
                    </Tooltip>
                    <span className="aik-usage" title="Lượt đã dùng hôm nay / hạn mức ngày (làm mới lúc 07:00)">
                      {used.toLocaleString('vi-VN')}/{limit.toLocaleString('vi-VN')}
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
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {testResult && (
          <div className={`aik-result ${testResult.success ? 'aik-result-ok' : 'aik-result-bad'}`}>{testResult.message}</div>
        )}
      </div>
    </Modal>
  );
};

export default AiSettingsModal;
