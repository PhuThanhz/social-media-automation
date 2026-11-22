import React, { useEffect, useState } from 'react';
import { Modal, Button, Progress, Typography, Space, Tag } from 'antd';
import { CloudDownloadOutlined, CheckCircleOutlined, SyncOutlined, RocketOutlined } from '@ant-design/icons';

const { Text, Paragraph, Title } = Typography;

export const AutoUpdateModal: React.FC = () => {
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [version, setVersion] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [totalBytes, setTotalBytes] = useState<number>(0);
  const [downloadedBytes, setDownloadedBytes] = useState<number>(0);
  const [isReadyToRestart, setIsReadyToRestart] = useState<boolean>(false);
  const [updateHandle, setUpdateHandle] = useState<any>(null);

  useEffect(() => {
    // Only check if running inside Tauri Desktop
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (!isTauri) return;

    let isMounted = true;

    async function checkForUpdates() {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();

        if (update && update.available && isMounted) {
          setUpdateAvailable(true);
          setVersion(update.version);
          setNotes(update.body || 'Bản cập nhật tối ưu hóa hiệu năng, cập nhật giao diện mới và sửa lỗi.');
          setUpdateHandle(update);
        }
      } catch (err) {
        // Silently catch in dev or if offline/no release yet
        console.log('[Tauri AutoUpdate] Kiểm tra cập nhật:', err);
      }
    }

    // Check 3 seconds after app launch to not block initial render
    const timer = setTimeout(() => {
      checkForUpdates();
    }, 3000);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, []);

  const handleStartUpdate = async () => {
    if (!updateHandle) return;

    setIsDownloading(true);
    let downloaded = 0;
    let contentLength = 0;

    try {
      await updateHandle.downloadAndInstall((event: any) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength || 0;
            setTotalBytes(contentLength);
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            setDownloadedBytes(downloaded);
            if (contentLength > 0) {
              setDownloadProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
            }
            break;
          case 'Finished':
            setDownloadProgress(100);
            setIsReadyToRestart(true);
            break;
        }
      });

      setIsReadyToRestart(true);
    } catch (error) {
      console.error('Lỗi tải bản cập nhật:', error);
      setIsDownloading(false);
    }
  };

  const handleRestartNow = async () => {
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      console.error('Lỗi khởi động lại app:', e);
    }
  };

  if (!updateAvailable) return null;

  return (
    <Modal
      open={updateAvailable}
      closable={!isDownloading}
      maskClosable={false}
      onCancel={() => setUpdateAvailable(false)}
      footer={null}
      width={460}
      centered
      styles={{
        body: {
          background: 'linear-gradient(145deg, #0d1527 0%, #080d19 100%)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: 20,
          boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(59, 130, 246, 0.15)',
          padding: '28px 24px'
        }
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(59,130,246,0.2) 0%, rgba(139,92,246,0.2) 100%)',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            color: '#60a5fa',
            fontSize: 26
          }}
        >
          {isReadyToRestart ? <CheckCircleOutlined style={{ color: '#34d399' }} /> : <RocketOutlined />}
        </div>

        <Space direction="vertical" size={4}>
          <Space>
            <Title level={4} style={{ margin: 0, color: '#f8fafc', fontWeight: 700 }}>
              {isReadyToRestart ? 'Đã cài đặt xong!' : 'Có bản cập nhật mới!'}
            </Title>
            <Tag color="blue" style={{ borderRadius: 6, fontWeight: 700, padding: '2px 8px' }}>
              v{version}
            </Tag>
          </Space>
          <Text style={{ color: '#94a3b8', fontSize: 13 }}>
            {isReadyToRestart
              ? 'Bản cập nhật đã được cài đặt thành công. Khởi động lại để trải nghiệm ngay.'
              : 'PhuSocial Pro đã có phiên bản mới với nhiều cải tiến và giao diện tối ưu.'}
          </Text>
        </Space>
      </div>

      {!isDownloading && !isReadyToRestart && (
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 12,
            padding: '12px 16px',
            marginBottom: 20,
            maxHeight: 120,
            overflowY: 'auto'
          }}
        >
          <Text style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
            Nội dung cập nhật:
          </Text>
          <Paragraph style={{ color: '#cbd5e1', fontSize: 13, margin: '6px 0 0', whiteSpace: 'pre-line' }}>
            {notes}
          </Paragraph>
        </div>
      )}

      {isDownloading && !isReadyToRestart && (
        <div style={{ marginBottom: 24 }}>
          <Progress
            percent={downloadProgress}
            status="active"
            strokeColor={{
              '0%': '#3b82f6',
              '100%': '#8b5cf6'
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <Text style={{ color: '#64748b', fontSize: 12 }}>
              <SyncOutlined spin style={{ marginRight: 6 }} /> Đang tải dữ liệu...
            </Text>
            {totalBytes > 0 && (
              <Text style={{ color: '#94a3b8', fontSize: 12 }}>
                {(downloadedBytes / (1024 * 1024)).toFixed(1)} / {(totalBytes / (1024 * 1024)).toFixed(1)} MB
              </Text>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        {!isDownloading && !isReadyToRestart && (
          <>
            <Button
              style={{
                flex: 1,
                borderRadius: 10,
                borderColor: 'rgba(255, 255, 255, 0.15)',
                color: '#94a3b8',
                background: 'transparent'
              }}
              onClick={() => setUpdateAvailable(false)}
            >
              Để sau
            </Button>
            <Button
              type="primary"
              icon={<CloudDownloadOutlined />}
              style={{
                flex: 1.5,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                fontWeight: 600,
                boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)'
              }}
              onClick={handleStartUpdate}
            >
              Cập nhật ngay
            </Button>
          </>
        )}

        {isReadyToRestart && (
          <Button
            type="primary"
            icon={<SyncOutlined />}
            block
            style={{
              height: 44,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              fontWeight: 700,
              fontSize: 14,
              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)'
            }}
            onClick={handleRestartNow}
          >
            Khởi động lại ngay để áp dụng
          </Button>
        )}
      </div>
    </Modal>
  );
};
