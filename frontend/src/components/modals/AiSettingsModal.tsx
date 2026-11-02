import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Input, Button, Tag, Progress, Tabs, Spin, Alert, Tooltip, message, Flex } from 'antd';
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
        <Flex align="center" justify="space-between" className="ai-title-row">
          <Flex align="center" gap={8}>
            <RobotOutlined className="ai-title-ic" />
            <span className="ai-bold">Cấu hình & Giám sát Hạn mức AI (Gemini)</span>
          </Flex>
          <Tag color="cyan" className="ai-mono-xs">
            {parsedKeys.length} {parsedKeys.length > 1 ? 'Keys xoay vòng' : 'Key'}
          </Tag>
        </Flex>
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
      <div className="ai-body">
        {/* Dashboard tóm tắt hạn ngạch */}
        <div className="ai-stats">
          <div className="ai-stat">
            <div className="ai-stat-label">Đã gọi hôm nay</div>
            <div className="ai-stat-value-cyan">
              {totalUsedToday.toLocaleString()} <span className="ai-stat-unit">/ {totalLimitToday.toLocaleString()}</span>
            </div>
            <div className="ai-stat-note">Ước tính theo mốc 1.500/key</div>
          </div>

          <div className="ai-stat">
            <div className="ai-stat-label">Trạng thái Pool Keys</div>
            <div className="ai-stat-value-emerald">
              <span>{keyHealthList.filter((k) => k.status === 'HEALTHY').length}</span>
              <span className="ai-stat-unit">/ {Math.max(keyHealthList.length, parsedKeys.length)} online</span>
            </div>
            <div className="ai-stat-note">Tự động failover khi 429</div>
          </div>

          <div className="ai-stat">
            <div className="ai-stat-label">Thời gian Reset Quota</div>
            <div className="ai-stat-value-amber">
              07:00 Sáng
            </div>
            <div className="ai-stat-note">Google reset hạn mức ngày</div>
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
                <span className="ai-tab-label">
                  <DashboardOutlined /> Giám sát & Hạn ngạch từng Key
                </span>
              ),
              children: (
                <div className="ai-monitor">
                  {checking && keyHealthList.length === 0 ? (
                    <div className="ai-loading">
                      <Spin size="small" />
                      <div>Đang kiểm tra tình trạng từng API Key...</div>
                    </div>
                  ) : keyHealthList.length === 0 ? (
                    <div className="ai-empty">
                      Chưa có API key nào được cấu hình.{' '}
                      <Button type="link" size="small" onClick={() => setActiveTab('edit')}>
                        Chuyển sang tab Thêm Key →
                      </Button>
                    </div>
                  ) : (
                    <div className="ai-key-list">
                      {keyHealthList.map((item, idx) => {
                        const pct = Math.min(100, Math.round(((item.callsToday || 0) / (item.dailyLimitEstimate || 1500)) * 100));
                        const isExhausted = item.status === 'RATE_LIMITED' || pct >= 100;
                        const isWarning = pct >= 80 && !isExhausted;
                        const isInvalid = item.status === 'INVALID' || item.status === 'ERROR';

                        let statusBadge = <Tag color="success" className="ai-m0">🟢 Hoạt động tốt</Tag>;
                        if (item.status === 'RATE_LIMITED') {
                          statusBadge = <Tag color="warning" className="ai-m0">🟡 Hết hạn ngạch (429)</Tag>;
                        } else if (isInvalid) {
                          statusBadge = <Tag color="error" className="ai-m0">🔴 Key lỗi / Không hợp lệ</Tag>;
                        }

                        let progressColor = '#06b6d4'; // cyan
                        if (isExhausted) progressColor = '#ef4444'; // red
                        else if (isWarning) progressColor = '#f59e0b'; // amber

                        return (
                          <div
                            key={idx}
                            className={`ai-key-card ${
                              isExhausted
                                ? 'ai-key-card-exhausted'
                                : isInvalid
                                ? 'ai-key-card-invalid'
                                : 'ai-key-card-ok'
                            }`}
                          >
                            <Flex align="center" justify="space-between" className="ai-key-head">
                              <Flex align="center" gap={8}>
                                <span className="ai-key-name">
                                  Key #{idx + 1}:
                                </span>
                                <span className="ai-key-mask">
                                  {item.masked}
                                </span>
                              </Flex>
                              <div>{statusBadge}</div>
                            </Flex>

                            {/* Hạn mức gọi trong ngày */}
                            <div className="ai-stack-1">
                              <div className="ai-quota-row">
                                <span>Đã dùng hôm nay: <b className="ai-text-strong">{item.callsToday} / {item.dailyLimitEstimate}</b> lượt</span>
                                <span className="ai-mono-semibold" style={{ color: progressColor }}>
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
                            <div className="ai-key-foot">
                              <span className="ai-muted">{item.message}</span>
                              {isExhausted && (
                                <span className="ai-warn">
                                  ⚠️ Hệ thống đang chuyển sang Key khác
                                </span>
                              )}
                              {isWarning && (
                                <span className="ai-warn-light">
                                  ⚠️ Sắp chạm trần (còn ~{item.dailyLimitEstimate - item.callsToday} lượt)
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="ai-monitor-foot">
                    <span className="ai-stat-label">
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
                <span className="ai-tab-label">
                  <KeyOutlined /> Quản lý danh sách Key ({parsedKeys.length})
                </span>
              ),
              children: (
                <div className="ai-monitor">
                  <div>
                    <div className="ai-edit-head">
                      <span className="ai-edit-title">Dán danh sách API Keys (mỗi dòng 1 key):</span>
                      <Tag color="cyan" className="ai-m0">
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
                        "Dán các Gemini API key vào đây, mỗi dòng 1 key:\nAIzaSyA_abcdef123456...\nAQ.Ab8RN6KMnIOVi...\nAIzaSyB_abcdef123456..."
                      }
                      className="ai-textarea"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>

                  <div className="ai-help">
                    <div>
                      🔗 <b>Lấy API Key miễn phí tại:</b>{' '}
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noreferrer"
                        className="ai-help-link"
                      >
                        aistudio.google.com/app/apikey
                      </a>
                    </div>
                    <div>
                      💡 <b>Lưu ý quan trọng:</b> Khi bấm <i>Create API key</i>, hãy chọn <b>"Create API key in new project"</b> (Tạo trong dự án mới) để Google tự động kích hoạt sẵn Generative Language API.
                    </div>
                    <div>• Bạn có thể tạo nhiều key hoặc gom key từ nhiều tài khoản Google khác nhau để xoay vòng hạn ngạch.</div>
                    <div>• Hệ thống tự động lưu vào trình duyệt và đồng bộ cho mọi trang (Studio Ảnh Tin, Radar Tin Tức, Đăng Playwright...).</div>
                  </div>
                </div>
              ),
            },
          ]}
        />

        {testResult && (
          <div
            className={`ai-result ${testResult.success ? 'ai-result-ok' : 'ai-result-bad'}`}
          >
            {testResult.success ? (
              <CheckCircleOutlined className="ai-result-ic-ok" />
            ) : (
              <ExclamationCircleOutlined className="ai-result-ic-bad" />
            )}
            <span className="ai-break">{testResult.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default AiSettingsModal;
