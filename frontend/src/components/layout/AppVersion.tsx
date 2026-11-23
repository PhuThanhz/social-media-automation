import { useEffect, useState } from 'react';
import { Tooltip } from 'antd';
import dayjs from 'dayjs';
import { isTauri } from '../../services/license.service';

/**
 * Số phiên bản + giờ build, hiện ở cuối menu để biết máy người dùng đã cập nhật chưa.
 * Desktop: đọc phiên bản đang cài (getVersion) và hỏi bộ cập nhật xem có bản mới hơn không.
 */
export default function AppVersion({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  const [version, setVersion] = useState<string>(__APP_VERSION__);
  const [latest, setLatest] = useState<string | null>(null);
  const builtAt = dayjs(__BUILD_TIME__);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        const v = await getVersion();
        if (!cancelled) setVersion(v);
      } catch {
        // giữ __APP_VERSION__
      }
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (!cancelled && update) setLatest(update.version);
      } catch {
        // không có mạng / chưa cấu hình updater: bỏ qua
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const label = version === 'dev' ? 'Bản dev' : `v${version}`;
  const tip = [
    `Phiên bản ${version}`,
    builtAt.isValid() ? `Build lúc ${builtAt.format('HH:mm DD/MM/YYYY')}` : null,
    latest ? `Đã có bản ${latest} — mở lại app để cập nhật` : isTauri() ? 'Đang dùng bản mới nhất' : null,
  ].filter(Boolean).join('\n');

  return (
    <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tip}</span>} placement="right">
      <div className={`app-version ${className}`}>
        <span>{label}</span>
        {!compact && builtAt.isValid() && <span className="app-version-time">· {builtAt.format('HH:mm DD/MM')}</span>}
        {latest && <span className="app-version-new">{compact ? '•' : `· có bản ${latest}`}</span>}
      </div>
    </Tooltip>
  );
}
