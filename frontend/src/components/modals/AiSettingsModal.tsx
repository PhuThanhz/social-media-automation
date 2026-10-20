import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Input, Button, Tag, Progress, Tabs, Spin, Alert, Tooltip, message } from 'antd';
import {
  RobotOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  KeyOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  DashboardOutlined,
} from '@ant-design/icons';
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

const AiSettingsModal: React.FC<AiSettingsModalProps> = ({ open, onClose }) => {
  const [keysText, setKeysText] = useState('');
  const [activeTab, setActiveTab] = useState<'monitor' | 'edit'>('monitor');
  const [keyHealthList, setKeyHealthList] = useState<KeyHealthItem[]>([]);
  const [checking, setChecking] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const parsedKeys = useMemo(() => {
    return keysText
      .split(/[\n,;]+/)
      .map((k) => k.trim())
      .filter(Boolean);
  }, [keysText]);

  const fetchHealthCheck = async (keysToTest?: string) => {
    const rawKeys = keysToTest !== undefined ? keysToTest : getStoredGeminiKeys();
    setChecking(true);
    try {
      const res = await api.post('/news-card/check-keys', { apiKey: rawKeys });
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
      const stored = getStoredGeminiKeys();
      setKeysText(stored);
      setTestResult(null);
      // Mặc định tab Giám sát nếu đã có key, ngược lại mở tab Nhập key
      if (stored.trim()) {
        setActiveTab('monitor');
      } else {
        setActiveTab('edit');
      }
      fetchHealthCheck(stored);
    }
  }, [open]);

  const handleSave = () => {
    saveStoredGeminiKeys(keysText);
    const count = parsedKeys.length;
    if (count > 0) {
      message.success(
        count > 1
          ? `Đã lưu ${count} Gemini API keys! Hệ thống sẽ tự động dùng chung và xoay vòng khi hết Quota.`
          : 'Đã lưu Gemini API key dùng chung cho toàn bộ hệ thống!'
      );
    } else {
      message.info('Đã xóa key riêng. Hệ thống sẽ sử dụng key mặc định của máy chủ.');
    }
    fetchHealthCheck(keysText);
    setActiveTab('monitor');
  };

  const handleTestQuickPrompt = async () => {
    if (parsedKeys.length === 0) {
      message.warning('Vui lòng nhập ít nhất 1 API key để kiểm tra kết nối.');
      return;
    }
    setChecking(true);
    setTestResult(null);
    try {
      const res = await api.post('/news-card/headline', {
        title: 'Kiểm tra kết nối hệ thống',
        content: 'Đây là bài kiểm tra phản hồi từ Google Gemini AI.',
        apiKey: keysText,
      });
      if (res.data?.success && res.data?.headline) {
        setTestResult({
          success: true,
          message: `Kết nối thành công! Gemini phản hồi: "${res.data.headline.slice(0, 70)}..."`,
        });
        fetchHealthCheck(keysText);
      } else {
        throw new Error(res.data?.error || 'AI không trả về kết quả');
      }
    } catch (e: any) {
      const errMsg = e.response?.data?.error || e.message || 'Lỗi không xác định';
      setTestResult({
        success: false,
        message: `Kiểm tra thất bại: ${errMsg}`,
      });
    } finally {
      setChecking(false);
    }
  };

  const totalUsedToday = keyHealthList.reduce((acc, k) => acc + (k.callsToday || 0), 0);
  const totalLimitToday = Math.max(1, keyHealthList.length) * 1500;
  const overallPct = Math.min(100, Math.round((totalUsedToday / totalLimitToday) * 100));

  return (
    <Modal
      title={
        <div className="flex items-center justify-between pr-6 text-slate-100">
          <div className="flex items-center gap-2">
            <RobotOutlined className="text-cyan-400 text-lg" />
            <span className="font-bold">Cấu hình & Giám sát Hạn mức AI (Gemini)</span>
          </div>
          <Tag color="cyan" className="font-mono text-xs">
            {parsedKeys.length} {parsedKeys.length > 1 ? 'Keys xoay vòng' : 'Key'}
          </Tag>
        </div>
      }
      open={open}
      onCancel={onClose}
      width={680}
      footer={[
        <Button
          key="refresh"
          icon={<ReloadOutlined spin={checking} />}
          loading={checking}
          onClick={() => fetchHealthCheck(keysText)}
        >
          Làm mới trạng thái
        </Button>,
        <Button key="close" onClick={onClose}>
          Đóng
        </Button>,
        activeTab === 'edit' && (
          <Button key="save" type="primary" onClick={handleSave}>
            Lưu cấu hình
          </Button>
        ),
      ]}
    >
      <div className="space-y-4 py-1 text-xs text-slate-300">
        {/* Dashboard tóm tắt hạn ngạch */}
        <div className="grid grid-cols-3 gap-2.5 bg-slate-900/90 border border-slate-800 p-3 rounded-2xl">
          <div className="bg-slate-800/60 p-2.5 rounded-xl border border-slate-700/60">
            <div className="text-[11px] text-slate-400">Đã gọi hôm nay</div>
            <div className="text-lg font-bold text-cyan-400 font-mono mt-0.5">
              {totalUsedToday.toLocaleString()} <span className="text-xs text-slate-400 font-normal">/ {totalLimitToday.toLocaleString()}</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Ước tính theo mốc 1.500/key</div>
          </div>

          <div className="bg-slate-800/60 p-2.5 rounded-xl border border-slate-700/60">
            <div className="text-[11px] text-slate-400">Trạng thái Pool Keys</div>
            <div className="text-lg font-bold text-emerald-400 font-mono mt-0.5 flex items-center gap-1.5">
              <span>{keyHealthList.filter((k) => k.status === 'HEALTHY').length}</span>
              <span className="text-xs text-slate-400 font-normal">/ {Math.max(keyHealthList.length, parsedKeys.length)} online</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Tự động failover khi 429</div>
          </div>

          <div className="bg-slate-800/60 p-2.5 rounded-xl border border-slate-700/60">
            <div className="text-[11px] text-slate-400">Thời gian Reset Quota</div>
            <div className="text-base font-bold text-amber-400 font-mono mt-0.5">
              07:00 Sáng
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Google reset hạn mức ngày</div>
          </div>
        </div>

        {/* Tabs chuyển đổi giữa Giám sát và Chỉnh sửa */}
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as any)}
          items={[
            {
              key: 'monitor',
              label: (
                <span className="flex items-center gap-1.5">
                  <DashboardOutlined /> Giám sát & Hạn ngạch từng Key
                </span>
              ),
              children: (
                <div className="space-y-3 pt-1">
                  {checking && keyHealthList.length === 0 ? (
                    <div className="py-8 text-center text-slate-400 space-y-2">
                      <Spin size="small" />
                      <div>Đang kiểm tra tình trạng từng API Key...</div>
                    </div>
                  ) : keyHealthList.length === 0 ? (
                    <div className="p-6 text-center border border-dashed border-slate-700 rounded-xl text-slate-400">
                      Chưa có API key nào được cấu hình.{' '}
                      <Button type="link" size="small" onClick={() => setActiveTab('edit')}>
                        Chuyển sang tab Thêm Key →
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
                      {keyHealthList.map((item, idx) => {
                        const pct = Math.min(100, Math.round(((item.callsToday || 0) / (item.dailyLimitEstimate || 1500)) * 100));
                        const isExhausted = item.status === 'RATE_LIMITED' || pct >= 100;
                        const isWarning = pct >= 80 && !isExhausted;
                        const isInvalid = item.status === 'INVALID' || item.status === 'ERROR';

                        let statusBadge = <Tag color="success" className="!m-0">🟢 Hoạt động tốt</Tag>;
                        if (item.status === 'RATE_LIMITED') {
                          statusBadge = <Tag color="warning" className="!m-0">🟡 Hết hạn ngạch (429)</Tag>;
                        } else if (isInvalid) {
                          statusBadge = <Tag color="error" className="!m-0">🔴 Key lỗi / Không hợp lệ</Tag>;
                        }

                        let progressColor = '#06b6d4'; // cyan
                        if (isExhausted) progressColor = '#ef4444'; // red
                        else if (isWarning) progressColor = '#f59e0b'; // amber

                        return (
                          <div
                            key={idx}
                            className={`p-3 rounded-xl border transition-all ${
                              isExhausted
                                ? 'bg-amber-950/20 border-amber-500/30'
                                : isInvalid
                                ? 'bg-red-950/20 border-red-500/30'
                                : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-slate-200">
                                  Key #{idx + 1}:
                                </span>
                                <span className="font-mono text-cyan-300 text-xs bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                                  {item.masked}
                                </span>
                              </div>
                              <div>{statusBadge}</div>
                            </div>

                            {/* Hạn mức gọi trong ngày */}
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[11px] text-slate-400">
                                <span>Đã dùng hôm nay: <b className="text-slate-200">{item.callsToday} / {item.dailyLimitEstimate}</b> lượt</span>
                                <span className="font-mono font-semibold" style={{ color: progressColor }}>
                                  {pct}%
                                </span>
                              </div>
                              <Progress
                                percent={pct}
                                showInfo={false}
                                strokeColor={progressColor}
                                size={[undefined, 6]}
                              />
                            </div>

                            {/* Lời nhắc trạng thái */}
                            <div className="mt-2 text-[11px] flex items-center justify-between">
                              <span className="text-slate-400">{item.message}</span>
                              {isExhausted && (
                                <span className="text-amber-400 font-medium">
                                  ⚠️ Hệ thống đang chuyển sang Key khác
                                </span>
                              )}
                              {isWarning && (
                                <span className="text-amber-300">
                                  ⚠️ Sắp chạm trần (còn ~{item.dailyLimitEstimate - item.callsToday} lượt)
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex justify-between items-center pt-2 border-t border-slate-800">
                    <span className="text-[11px] text-slate-400">
                      💡 Cần thêm key dự phòng? Bấm tab <b>"Quản lý danh sách Key"</b>.
                    </span>
                    <Button
                      size="small"
                      icon={<ThunderboltOutlined />}
                      loading={checking}
                      onClick={handleTestQuickPrompt}
                    >
                      Gọi thử 1 lệnh test
                    </Button>
                  </div>
                </div>
              ),
            },
            {
              key: 'edit',
              label: (
                <span className="flex items-center gap-1.5">
                  <KeyOutlined /> Quản lý danh sách Key ({parsedKeys.length})
                </span>
              ),
              children: (
                <div className="space-y-3 pt-1">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-slate-200">Dán danh sách API Keys (mỗi dòng 1 key):</span>
                      <Tag color="cyan" className="!m-0">
                        {parsedKeys.length} key được nhận diện
                      </Tag>
                    </div>
                    <Input.TextArea
                      rows={6}
                      value={keysText}
                      onChange={(e) => {
                        setKeysText(e.target.value);
                        setTestResult(null);
                      }}
                      placeholder={
                        "Dán các Gemini API key vào đây, mỗi dòng 1 key:\nAIzaSyA_abcdef123456...\nAIzaSyB_abcdef123456...\nAIzaSyC_abcdef123456..."
                      }
                      className="font-mono text-xs bg-slate-900 border-slate-700 text-slate-100 placeholder-slate-600 focus:border-cyan-500"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>

                  <div className="text-[11px] text-slate-400 bg-slate-800/60 p-2.5 rounded-xl border border-slate-700 space-y-1">
                    <div>
                      🔗 <b>Lấy API Key miễn phí tại:</b>{' '}
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-400 underline font-medium hover:text-cyan-300"
                      >
                        aistudio.google.com/app/apikey
                      </a>
                    </div>
                    <div>• Bạn có thể tạo 3–5 key trên 1 tài khoản Google hoặc gom key từ nhiều tài khoản khác nhau rồi dán vào đây.</div>
                    <div>• Hệ thống tự động lưu vào trình duyệt và đồng bộ cho mọi trang (Studio Ảnh Tin, Radar Tin Tức, Đăng Playwright...).</div>
                  </div>
                </div>
              ),
            },
          ]}
        />

        {testResult && (
          <div
            className={`p-2.5 rounded-lg border text-xs flex items-start gap-2 ${
              testResult.success
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-red-500/10 border-red-500/30 text-red-300'
            }`}
          >
            {testResult.success ? (
              <CheckCircleOutlined className="mt-0.5 text-emerald-400" />
            ) : (
              <ExclamationCircleOutlined className="mt-0.5 text-red-400" />
            )}
            <span className="break-all">{testResult.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default AiSettingsModal;
